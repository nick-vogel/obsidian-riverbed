import { describe, expect, it } from 'vitest';
import { SyncRunner } from '../src/sync/runSync';
import { FakeOutbox, FakeVault, item } from './fakes';

function deps(vault: FakeVault, outbox: FakeOutbox, folder = 'inbox') {
	return { vault, outbox, folder };
}

describe('runSync — delivery', () => {
	it('writes every pending entry verbatim and acks each one', async () => {
		const vault = new FakeVault();
		const outbox = new FakeOutbox([
			item('1', 'a.md', 'first body\n'),
			item('2', 'b.md', 'second body\n'),
		]);

		const result = await new SyncRunner().run(deps(vault, outbox));

		expect(result).toEqual({ delivered: 2, failed: 0 });
		expect(vault.files.get('inbox/a.md')).toBe('first body\n');
		expect(vault.files.get('inbox/b.md')).toBe('second body\n');
		expect(outbox.acked).toEqual(['1', '2']);
		expect(outbox.reported).toEqual([]);
	});

	it('creates the destination folder when it is missing', async () => {
		const vault = new FakeVault();
		const outbox = new FakeOutbox([item('1', 'a.md', 'body')]);

		await new SyncRunner().run(deps(vault, outbox));

		expect(vault.folders.has('inbox')).toBe(true);
		expect(vault.files.get('inbox/a.md')).toBe('body');
	});

	it('sanitizes the filename before writing', async () => {
		const vault = new FakeVault();
		const outbox = new FakeOutbox([item('1', '../escape:me', 'body')]);

		await new SyncRunner().run(deps(vault, outbox));

		const written = [...vault.files.keys()];
		expect(written).toHaveLength(1);
		expect(written[0].startsWith('inbox/')).toBe(true);
		expect(written[0].slice('inbox/'.length)).not.toContain('/');
		expect(written[0]).not.toContain('..');
	});
});

describe('runSync — ack-after-write ordering', () => {
	it('reports a failed write and does NOT ack it', async () => {
		const vault = new FakeVault();
		vault.failWrites.add('inbox/a.md');
		const outbox = new FakeOutbox([item('1', 'a.md', 'body'), item('2', 'b.md', 'other')]);

		const result = await new SyncRunner().run(deps(vault, outbox));

		expect(outbox.acked).toEqual(['2']); // the healthy entry only
		expect(outbox.acked).not.toContain('1');
		expect(outbox.reported.map((r) => r.id)).toEqual(['1']);
		expect(result).toEqual({ delivered: 1, failed: 1 });
	});

	it('does NOT report an error when the write succeeded but the ack failed', async () => {
		// The file is safely in the vault. Reporting an error here would show the user a
		// failed capture with a Retry affordance for something that is not broken; the
		// entry simply stays pending and the next pass re-acks it via the dedupe path.
		const vault = new FakeVault();
		const outbox = new FakeOutbox([item('1', 'a.md', 'body'), item('2', 'b.md', 'other')]);
		outbox.failAckFor.add('1');

		const result = await new SyncRunner().run(deps(vault, outbox));

		expect(vault.files.get('inbox/a.md')).toBe('body');
		expect(outbox.reported).toEqual([]);
		expect(outbox.acked).toEqual(['2']);
		expect(result).toEqual({ delivered: 2, failed: 0 });
	});

	it('re-acks an entry whose file is already present with identical bytes', async () => {
		// The next pass after the dropped ack above.
		const vault = new FakeVault();
		vault.files.set('inbox/a.md', 'body');
		const outbox = new FakeOutbox([item('1', 'a.md', 'body')]);

		await new SyncRunner().run(deps(vault, outbox));

		expect(outbox.acked).toEqual(['1']);
		expect([...vault.files.keys()]).toEqual(['inbox/a.md']); // no duplicate
	});

	it('keeps delivering the rest of the pass when reportError itself fails', async () => {
		const vault = new FakeVault();
		vault.failWrites.add('inbox/a.md');
		const outbox = new FakeOutbox([item('1', 'a.md', 'body'), item('2', 'b.md', 'other')]);
		outbox.failReportFor.add('1');

		const result = await new SyncRunner().run(deps(vault, outbox));

		expect(outbox.acked).toEqual(['2']);
		expect(result).toEqual({ delivered: 1, failed: 1 });
	});
});

describe('runSync — single-flight lock', () => {
	it('skips an overlapping pass instead of running two concurrently', async () => {
		const vault = new FakeVault();
		vault.writeDelayMs = 20;
		const outbox = new FakeOutbox([item('1', 'a.md', 'body')]);
		const runner = new SyncRunner();

		const [first, second] = await Promise.all([
			runner.run(deps(vault, outbox)),
			runner.run(deps(vault, outbox)),
		]);

		expect(first).toEqual({ delivered: 1, failed: 0 });
		expect(second).toBeNull(); // skipped, not run
		expect(outbox.acked).toEqual(['1']);
		// One pass means one file: no spurious -2 suffix from two passes racing.
		expect([...vault.files.keys()]).toEqual(['inbox/a.md']);
	});

	it('releases the lock when a pass throws, so sync is not silently dead forever', async () => {
		const vault = new FakeVault();
		const outbox = new FakeOutbox([item('1', 'a.md', 'body')]);
		outbox.failGetPending = true;
		const runner = new SyncRunner();

		await expect(runner.run(deps(vault, outbox))).rejects.toThrow(/induced getPending/);
		expect(runner.busy).toBe(false);

		// The server is back: the very next pass must actually run.
		outbox.failGetPending = false;
		const result = await runner.run(deps(vault, outbox));
		expect(result).toEqual({ delivered: 1, failed: 0 });
	});

	it('is a no-op when nothing is pending', async () => {
		const vault = new FakeVault();
		const outbox = new FakeOutbox([]);

		const result = await new SyncRunner().run(deps(vault, outbox));

		expect(result).toEqual({ delivered: 0, failed: 0 });
		expect(vault.files.size).toBe(0);
	});
});

describe('runSync — malformed entries', () => {
	// The behavior these pin: an entry that arrives with a usable id but a broken payload
	// must be FAILED and REPORTED (so it surfaces in the reader's Outbox with a Retry),
	// never acked, and never silently dropped. Before these existed, deleting the guard
	// in runSync left the whole suite green.
	const malformed = (id: string, overrides: Record<string, unknown>) =>
		({ id, suggestedFilename: 'x.md', renderedMarkdown: 'body\n', ...overrides }) as never;

	it('reports a malformed entry instead of writing or acking it', async () => {
		const vault = new FakeVault();
		const outbox = new FakeOutbox([malformed('1', { renderedMarkdown: null })]);

		const result = await new SyncRunner().run(deps(vault, outbox));

		expect(result).toEqual({ delivered: 0, failed: 1 });
		expect(vault.files.size).toBe(0);
		expect(outbox.acked).toEqual([]);
		expect(outbox.reported.map((e: { id: string }) => e.id)).toEqual(['1']);
	});

	it('does not let one malformed entry abort the rest of the pass', async () => {
		const vault = new FakeVault();
		const outbox = new FakeOutbox([
			item('1', 'a.md', 'first\n'),
			malformed('2', { renderedMarkdown: null }),
			malformed('3', { suggestedFilename: 42 }),
			item('4', 'd.md', 'fourth\n'),
		]);

		const result = await new SyncRunner().run(deps(vault, outbox));

		expect(result).toEqual({ delivered: 2, failed: 2 });
		expect(vault.files.get('inbox/a.md')).toBe('first\n');
		expect(vault.files.get('inbox/d.md')).toBe('fourth\n');
		expect(vault.files.size).toBe(2);
		expect(outbox.acked).toEqual(['1', '4']);
		expect(outbox.reported.map((e: { id: string }) => e.id).sort()).toEqual(['2', '3']);
	});

	it('treats an entry that is only an id as malformed, not as an empty capture', async () => {
		const vault = new FakeVault();
		const outbox = new FakeOutbox([{ id: '9' } as never]);

		const result = await new SyncRunner().run(deps(vault, outbox));

		expect(result).toEqual({ delivered: 0, failed: 1 });
		expect(outbox.acked).toEqual([]);
		expect(outbox.reported.map((e: { id: string }) => e.id)).toEqual(['9']);
	});

	it('still delivers a legitimately EMPTY capture, which is not malformed', async () => {
		const vault = new FakeVault();
		const outbox = new FakeOutbox([item('1', 'empty.md', '')]);

		const result = await new SyncRunner().run(deps(vault, outbox));

		expect(result).toEqual({ delivered: 1, failed: 0 });
		expect(vault.files.get('inbox/empty.md')).toBe('');
		expect(outbox.acked).toEqual(['1']);
	});
});
