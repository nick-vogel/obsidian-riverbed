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

		expect(result).toEqual({ delivered: 2, failed: 0, pending: 2 });
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

	it('sanitizes the DESTINATION FOLDER before writing or creating anything', async () => {
		// The hole this closes: a user-typed `../../notes` escaped the vault. normalizePath
		// does not resolve `..`, but the adapter joins with the vault path and Node's
		// path.join does. Every upstream writer of settings.folder sanitizes too, so in the
		// shipped plugin this pass should never see a dirty folder. It sanitizes anyway
		// because it is the last point before a path is joined to the vault root.
		const vault = new FakeVault();
		const outbox = new FakeOutbox([item('1', 'a.md', 'body')]);

		await new SyncRunner().run(deps(vault, outbox, '../../notes'));

		expect(vault.files.get('notes/a.md')).toBe('body');
		for (const path of [...vault.files.keys(), ...vault.folders]) {
			expect(path).not.toContain('..');
			expect(path.startsWith('/')).toBe(false);
		}
		expect(outbox.acked).toEqual(['1']);
	});

	it('LOGS that it corrected the folder, instead of diverging silently', async () => {
		// If this ever fires in production it means a path upstream skipped its sanitize.
		// Papering over that would let the folder in use diverge from the one the settings
		// screen displays, with nothing anywhere saying why.
		const vault = new FakeVault();
		const outbox = new FakeOutbox([item('1', 'a.md', 'body')]);
		const logged: string[] = [];

		await new SyncRunner().run({
			...deps(vault, outbox, '../../notes'),
			log: (m: string) => logged.push(m),
		});

		expect(logged).toHaveLength(1);
		expect(logged[0]).toContain('../../notes');
		expect(logged[0]).toContain('"notes"');
	});

	it('stays quiet when the folder needed no correction', async () => {
		const vault = new FakeVault();
		const outbox = new FakeOutbox([item('1', 'a.md', 'body')]);
		const logged: string[] = [];

		await new SyncRunner().run({
			...deps(vault, outbox, 'inbox'),
			log: (m: string) => logged.push(m),
		});

		expect(logged).toEqual([]);
	});

	it('sanitizes an ABSOLUTE destination folder too', async () => {
		const vault = new FakeVault();
		const outbox = new FakeOutbox([item('1', 'a.md', 'body')]);

		await new SyncRunner().run(deps(vault, outbox, '/Users/me/.ssh'));

		expect(vault.files.get('Users/me/ssh/a.md')).toBe('body');
		for (const path of [...vault.files.keys(), ...vault.folders]) {
			expect(path.startsWith('/')).toBe(false);
		}
	});

	it('creates NOTHING when there is nothing to deliver', async () => {
		// An empty pass must not touch the vault at all. Without the early return the folder
		// is created on the very first poll of a freshly configured plugin, before a single
		// capture exists, which is a directory appearing in someone's vault unbidden.
		const vault = new FakeVault();
		const outbox = new FakeOutbox([]);

		const result = await new SyncRunner().run(deps(vault, outbox));

		expect(result).toEqual({ delivered: 0, failed: 0, pending: 0 });
		expect([...vault.folders]).toEqual([]);
		expect([...vault.files.keys()]).toEqual([]);
	});

	it('creates no folder at all when the destination is the vault root', async () => {
		// Without the empty-folder guard the walk creates a folder named '' at the root.
		const vault = new FakeVault();
		const outbox = new FakeOutbox([item('1', 'a.md', 'body')]);

		await new SyncRunner().run(deps(vault, outbox, ''));

		expect([...vault.folders]).toEqual([]);
		expect(vault.files.get('a.md')).toBe('body');
	});

	it('names the level a NOTE is blocking, instead of a misleading write error', async () => {
		// A file sitting where an intermediate folder should go. Guarding the walk with
		// `exists` skipped this level silently, because exists() is true for a file too, and
		// the user then saw only a failed write naming the leaf.
		const vault = new FakeVault();
		vault.files.set('research', 'a note, not a folder');
		const outbox = new FakeOutbox([item('1', 'a.md', 'body')]);
		const logged: string[] = [];

		const result = await new SyncRunner().run({
			...deps(vault, outbox, 'research/inbox'),
			log: (m: string) => logged.push(m),
		});

		expect(logged.some((m) => m.includes('could not create') && m.includes('"research"'))).toBe(
			true,
		);
		// And the entry is failed and reported rather than silently lost.
		expect(result).toEqual({ delivered: 0, failed: 1, pending: 1 });
		expect(outbox.acked).toEqual([]);
		expect(outbox.reported.map((r) => r.id)).toEqual(['1']);
	});

	it('creates a NESTED destination folder one level at a time', async () => {
		// Creating only the leaf relies on Obsidian's createFolder making parents, which it
		// is not documented to do. Nested destinations are supported, so walk the path.
		const vault = new FakeVault();
		const outbox = new FakeOutbox([item('1', 'a.md', 'body')]);

		await new SyncRunner().run(deps(vault, outbox, 'research/inbox'));

		expect([...vault.folders]).toEqual(['research', 'research/inbox']);
		expect(vault.files.get('research/inbox/a.md')).toBe('body');
	});

	it('stays silent when a nested level already exists, pass after pass', async () => {
		// createFolder is idempotent by contract, matching main.ts's real adapter, which
		// stats and returns early for a folder already there. It is called unconditionally
		// on every level of every pass, so anything less than idempotent would log a failure
		// forever. Do NOT "fix" this by reinstating an exists() guard: exists() is true for a
		// FILE too, which is the bug the unconditional call exists to surface.
		const vault = new FakeVault();
		vault.folders.add('research');
		const outbox = new FakeOutbox([item('1', 'a.md', 'body')]);
		const logged: string[] = [];

		await new SyncRunner().run({
			...deps(vault, outbox, 'research/inbox'),
			log: (m: string) => logged.push(m),
		});

		expect(logged).toEqual([]);
		expect(vault.files.get('research/inbox/a.md')).toBe('body');
	});

	it('announces a pass start ONLY for a pass that actually starts', async () => {
		// The status bar has to change before the outbox answers, or a slow server looks
		// identical to an idle plugin. But a SKIPPED pass must not announce anything: doing
		// that from the caller overwrote a running pass's `syncing 9 of 10` with a bare
		// `syncing...`, throwing the count away in exactly the stall it exists to reveal.
		const vault = new FakeVault();
		vault.writeDelayMs = 20;
		const outbox = new FakeOutbox([item('1', 'a.md', 'body')]);
		const runner = new SyncRunner();
		let starts = 0;
		const withStart = () => ({ ...deps(vault, outbox), onPassStart: () => starts++ });

		const [first, second] = await Promise.all([runner.run(withStart()), runner.run(withStart())]);

		expect(first).toEqual({ delivered: 1, failed: 0, pending: 1 });
		expect(second).toBeNull();
		expect(starts).toBe(1);
	});

	it('announces the start BEFORE asking the outbox for anything', async () => {
		// Firing it after the fetch would leave the bar showing the previous outcome for the
		// whole network round trip, which is the slowest part of a pass.
		const vault = new FakeVault();
		const outbox = new FakeOutbox([item('1', 'a.md', 'body')]);
		const order: string[] = [];
		const originalGetPending = outbox.getPending.bind(outbox);
		outbox.getPending = async () => {
			order.push('getPending');
			return originalGetPending();
		};

		await new SyncRunner().run({
			...deps(vault, outbox),
			onPassStart: () => order.push('start'),
		});

		expect(order).toEqual(['start', 'getPending']);
	});

	it('reports PROGRESS as entries settle, so a slow pass is visibly moving', async () => {
		// Without this the status bar shows the previous outcome for the whole pass and a
		// hang is indistinguishable from an idle plugin.
		const vault = new FakeVault();
		const outbox = new FakeOutbox([
			item('1', 'a.md', 'one'),
			item('2', 'b.md', 'two'),
			item('3', 'c.md', 'three'),
		]);
		const seen: Array<[number, number]> = [];

		await new SyncRunner().run({
			...deps(vault, outbox),
			onProgress: (done: number, total: number) => seen.push([done, total]),
		});

		// The total is reported BEFORE any work, so the bar can stop showing a stale outcome
		// immediately rather than after the first entry lands.
		expect(seen).toEqual([
			[0, 3],
			[1, 3],
			[2, 3],
			[3, 3],
		]);
	});

	it('counts a FAILED entry as progress too', async () => {
		// Progress that stalls on the first bad entry reads as a hung sync.
		const vault = new FakeVault();
		vault.failWrites.add('inbox/a.md');
		const outbox = new FakeOutbox([item('1', 'a.md', 'one'), item('2', 'b.md', 'two')]);
		const seen: Array<[number, number]> = [];

		await new SyncRunner().run({
			...deps(vault, outbox),
			onProgress: (done: number, total: number) => seen.push([done, total]),
		});

		expect(seen).toEqual([
			[0, 2],
			[1, 2],
			[2, 2],
		]);
	});

	it('reports a total of zero for an empty outbox, and nothing further', async () => {
		const vault = new FakeVault();
		const outbox = new FakeOutbox([]);
		const seen: Array<[number, number]> = [];

		const result = await new SyncRunner().run({
			...deps(vault, outbox),
			onProgress: (done: number, total: number) => seen.push([done, total]),
		});

		expect(seen).toEqual([[0, 0]]);
		// pending is what tells the plugin to say "nothing to sync" rather than "synced 0".
		expect(result?.pending).toBe(0);
	});

	it('reports pending separately from delivered, which the dedupe path also moves', async () => {
		// An entry already present with identical bytes counts as DELIVERED, so
		// `delivered === 0` is not the same question as "was there anything to do".
		const vault = new FakeVault();
		vault.files.set('inbox/a.md', 'body');
		const outbox = new FakeOutbox([item('1', 'a.md', 'body')]);

		const result = await new SyncRunner().run(deps(vault, outbox));

		expect(result).toEqual({ delivered: 1, failed: 0, pending: 1 });
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
		expect(result).toEqual({ delivered: 1, failed: 1, pending: 2 });
	});

	it('does NOT report an error when the write succeeded but the ack failed', async () => {
		// The file is safely in the vault. Reporting an error here would show the user a
		// failed capture with a Retry affordance for something that is not broken; the
		// entry simply stays pending and the next pass re-acks it via the dedupe path.
		const vault = new FakeVault();
		const outbox = new FakeOutbox([item('1', 'a.md', 'body'), item('2', 'b.md', 'other')]);
		outbox.failAckFor.add('1');
		const logged: string[] = [];

		const result = await new SyncRunner().run({
			...deps(vault, outbox),
			log: (m: string) => logged.push(m),
		});

		expect(vault.files.get('inbox/a.md')).toBe('body');
		expect(outbox.reported).toEqual([]);
		expect(outbox.acked).toEqual(['2']);
		expect(result).toEqual({ delivered: 2, failed: 0, pending: 2 });
		// Silent is not good enough: the entry stays pending on the server, so the one
		// record that it happened at all is this line.
		expect(logged.some((m) => m.includes('ack failed'))).toBe(true);
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
		const logged: string[] = [];

		const result = await new SyncRunner().run({
			...deps(vault, outbox),
			log: (m: string) => logged.push(m),
		});

		expect(outbox.acked).toEqual(['2']);
		expect(result).toEqual({ delivered: 1, failed: 1, pending: 2 });
		// A write failed AND could not be reported, so nothing upstream knows. Log it.
		expect(logged.some((m) => m.includes('could not report a failed write'))).toBe(true);
	});
});

describe('runSync — single-flight lock', () => {
	it('skips an overlapping pass instead of running two concurrently', async () => {
		const vault = new FakeVault();
		vault.writeDelayMs = 20;
		const outbox = new FakeOutbox([item('1', 'a.md', 'body')]);
		const runner = new SyncRunner();

		const logged: string[] = [];
		const withLog = () => ({ ...deps(vault, outbox), log: (m: string) => logged.push(m) });

		const [first, second] = await Promise.all([runner.run(withLog()), runner.run(withLog())]);

		expect(first).toEqual({ delivered: 1, failed: 0, pending: 1 });
		expect(second).toBeNull(); // skipped, not run
		expect(logged.some((m) => m.includes('already in progress'))).toBe(true);
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
		expect(result).toEqual({ delivered: 1, failed: 0, pending: 1 });
	});

	it('is a no-op when nothing is pending', async () => {
		const vault = new FakeVault();
		const outbox = new FakeOutbox([]);

		const result = await new SyncRunner().run(deps(vault, outbox));

		expect(result).toEqual({ delivered: 0, failed: 0, pending: 0 });
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

		expect(result).toEqual({ delivered: 0, failed: 1, pending: 1 });
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

		expect(result).toEqual({ delivered: 2, failed: 2, pending: 4 });
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

		expect(result).toEqual({ delivered: 0, failed: 1, pending: 1 });
		expect(outbox.acked).toEqual([]);
		expect(outbox.reported.map((e: { id: string }) => e.id)).toEqual(['9']);
	});

	it('still delivers a legitimately EMPTY capture, which is not malformed', async () => {
		const vault = new FakeVault();
		const outbox = new FakeOutbox([item('1', 'empty.md', '')]);

		const result = await new SyncRunner().run(deps(vault, outbox));

		expect(result).toEqual({ delivered: 1, failed: 0, pending: 1 });
		expect(vault.files.get('inbox/empty.md')).toBe('');
		expect(outbox.acked).toEqual(['1']);
	});
});
