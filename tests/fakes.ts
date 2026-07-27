import { OutboxGateway, OutboxItem, SyncVault } from '../src/sync/types';

/** In-memory vault. `create` on an existing path throws, the way Obsidian's does. */
export class FakeVault implements SyncVault {
	files = new Map<string, string>();
	folders = new Set<string>();
	/** Set to make the next matching create throw, standing in for a real write failure. */
	failWrites = new Set<string>();
	/** Optional delay on every write, to open a window for an overlapping pass. */
	writeDelayMs = 0;

	async exists(path: string): Promise<boolean> {
		return this.files.has(path) || this.folders.has(path);
	}

	async read(path: string): Promise<string> {
		const contents = this.files.get(path);
		if (contents === undefined) throw new Error(`not a file: ${path}`);
		return contents;
	}

	/**
	 * A real filesystem cannot put anything inside a FILE, so neither can this. Without it
	 * the fake happily creates `research/inbox/a.md` while a note sits at `research`, and a
	 * test written against that is a statement about the fake rather than about the vault.
	 */
	private assertNoFileAncestor(path: string): void {
		const parts = path.split('/');
		for (let i = 1; i < parts.length; i++) {
			const ancestor = parts.slice(0, i).join('/');
			if (this.files.has(ancestor)) throw new Error(`not a folder: ${ancestor}`);
		}
	}

	async create(path: string, contents: string): Promise<void> {
		if (this.writeDelayMs > 0) {
			await new Promise((resolve) => setTimeout(resolve, this.writeDelayMs));
		}
		if (this.failWrites.has(path)) throw new Error(`induced write failure: ${path}`);
		if (this.files.has(path)) throw new Error(`file already exists: ${path}`);
		this.assertNoFileAncestor(path);
		this.files.set(path, contents);
	}

	/**
	 * Matches the SyncVault contract and main.ts's real adapter: idempotent for a folder
	 * that is already there, throwing only when a FILE occupies the path.
	 *
	 * It used to throw on an existing folder, which the real adapter does not do (it stats
	 * first and returns). A fake that is stricter or looser than the real thing makes every
	 * test written against it a statement about the fake.
	 *
	 * Still deliberately unlike the real thing in one respect: this is case-SENSITIVE, while
	 * APFS and NTFS are not. Case handling is the plugin's own documented hazard and is
	 * guarded in main.ts by going through the adapter rather than the index.
	 */
	async createFolder(path: string): Promise<void> {
		if (this.files.has(path)) throw new Error(`a file already exists at: ${path}`);
		this.assertNoFileAncestor(path);
		this.folders.add(path);
	}
}

/** Records every ack/reportError call in order; any call can be told to fail. */
export class FakeOutbox implements OutboxGateway {
	acked: string[] = [];
	reported: Array<{ id: string; reason: string }> = [];
	failGetPending = false;
	failAckFor = new Set<string>();
	failReportFor = new Set<string>();

	constructor(public pending: OutboxItem[] = []) {}

	async getPending(): Promise<OutboxItem[]> {
		if (this.failGetPending) throw new Error('induced getPending failure');
		return this.pending;
	}

	async ack(id: string): Promise<void> {
		if (this.failAckFor.has(id)) throw new Error(`induced ack failure: ${id}`);
		this.acked.push(id);
	}

	async reportError(id: string, reason: string): Promise<void> {
		if (this.failReportFor.has(id)) throw new Error(`induced reportError failure: ${id}`);
		this.reported.push({ id, reason });
	}
}

export function item(id: string, filename: string, markdown: string): OutboxItem {
	return { id, suggestedFilename: filename, renderedMarkdown: markdown };
}
