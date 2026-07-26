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

	async create(path: string, contents: string): Promise<void> {
		if (this.writeDelayMs > 0) {
			await new Promise((resolve) => setTimeout(resolve, this.writeDelayMs));
		}
		if (this.failWrites.has(path)) throw new Error(`induced write failure: ${path}`);
		if (this.files.has(path)) throw new Error(`file already exists: ${path}`);
		this.files.set(path, contents);
	}

	async createFolder(path: string): Promise<void> {
		if (this.folders.has(path)) throw new Error(`folder already exists: ${path}`);
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
