// The narrow interfaces the sync pass runs against. Deliberately free of any `obsidian`
// import: the live plugin injects adapters backed by the real Vault and requestUrl, the
// tests inject in-memory fakes, and both drive the exact same code.

/** One pending outbox entry, per the riverbed repo's docs/outbox-api.md. */
export interface OutboxItem {
	id: string;
	renderedMarkdown: string;
	suggestedFilename: string;
	createdAt?: string;
}

/** Everything the sync pass needs from a vault, and nothing more. */
export interface SyncVault {
	exists(path: string): Promise<boolean>;
	read(path: string): Promise<string>;
	create(path: string, contents: string): Promise<void>;
	createFolder(path: string): Promise<void>;
}

/** Everything the sync pass needs from the outbox API. */
export interface OutboxGateway {
	getPending(): Promise<OutboxItem[]>;
	ack(id: string): Promise<void>;
	reportError(id: string, reason: string): Promise<void>;
}

export interface SyncDeps {
	vault: SyncVault;
	outbox: OutboxGateway;
	/** Vault-relative destination folder. Empty string means the vault root. */
	folder: string;
	log?: (message: string) => void;
}

export interface SyncResult {
	/** Entries whose content is now safely in the vault. */
	delivered: number;
	/** Entries that could not be written and were reported back to the outbox. */
	failed: number;
}
