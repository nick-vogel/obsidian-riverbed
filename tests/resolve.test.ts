import { describe, expect, it } from 'vitest';
import { MAX_SUFFIX_ATTEMPTS, resolveTarget } from '../src/sync/resolve';
import { FakeVault } from './fakes';

describe('resolveTarget', () => {
	it('writes to the plain target when nothing is there', async () => {
		const vault = new FakeVault();
		expect(await resolveTarget(vault, 'inbox', 'a.md', 'body')).toEqual({
			action: 'write',
			path: 'inbox/a.md',
		});
	});

	it('treats identical bytes at the target as already delivered', async () => {
		const vault = new FakeVault();
		vault.files.set('inbox/a.md', 'body');
		// This is the crash-between-write-and-ack recovery: no second file, just an ack.
		expect(await resolveTarget(vault, 'inbox', 'a.md', 'body')).toEqual({
			action: 'skip-and-ack',
			path: 'inbox/a.md',
		});
	});

	it('suffixes past a different file rather than overwriting it', async () => {
		const vault = new FakeVault();
		vault.files.set('inbox/a.md', 'someone elses note');
		expect(await resolveTarget(vault, 'inbox', 'a.md', 'body')).toEqual({
			action: 'write',
			path: 'inbox/a-2.md',
		});
	});

	it('keeps iterating past an occupied suffix', async () => {
		const vault = new FakeVault();
		vault.files.set('inbox/a.md', 'other');
		vault.files.set('inbox/a-2.md', 'other again');
		expect(await resolveTarget(vault, 'inbox', 'a.md', 'body')).toEqual({
			action: 'write',
			path: 'inbox/a-3.md',
		});
	});

	it('reuses a suffixed slot that already holds identical bytes', async () => {
		const vault = new FakeVault();
		vault.files.set('inbox/a.md', 'other');
		vault.files.set('inbox/a-2.md', 'body');
		expect(await resolveTarget(vault, 'inbox', 'a.md', 'body')).toEqual({
			action: 'skip-and-ack',
			path: 'inbox/a-2.md',
		});
	});

	it('gives up after a bounded number of attempts instead of looping forever', async () => {
		const vault = new FakeVault();
		vault.files.set('inbox/a.md', 'occupied');
		for (let n = 2; n <= MAX_SUFFIX_ATTEMPTS; n++) {
			vault.files.set(`inbox/a-${n}.md`, `occupied ${n}`);
		}
		await expect(resolveTarget(vault, 'inbox', 'a.md', 'body')).rejects.toThrow(
			/no free filename/,
		);
	});

	it('writes to the vault root when no folder is configured', async () => {
		const vault = new FakeVault();
		expect(await resolveTarget(vault, '', 'a.md', 'body')).toEqual({
			action: 'write',
			path: 'a.md',
		});
	});
});
