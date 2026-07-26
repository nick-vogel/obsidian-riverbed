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

/**
 * Whether an outbox entry carries the three fields a delivery depends on. The server is
 * untrusted for filenames (see sanitizeFilename), so it is untrusted for shape too.
 *
 * Lives here, not in outboxClient.ts, because that module imports `obsidian` — a
 * types-only package the test runner cannot load, which would leave this untested.
 */
export function isOutboxItem(value: unknown): value is OutboxItem {
	const item = value as Partial<OutboxItem> | null;
	return (
		!!item &&
		typeof item.id === 'string' &&
		item.id !== '' &&
		typeof item.renderedMarkdown === 'string' &&
		typeof item.suggestedFilename === 'string'
	);
}

/**
 * Whether an entry can at least be IDENTIFIED, i.e. acked or reported against. An entry
 * without a usable id cannot be reported back to the server at all, so it is the only
 * shape that must be dropped rather than failed.
 */
export function isIdentifiable(value: unknown): value is { id: string } {
	const item = value as { id?: unknown } | null;
	return !!item && typeof item.id === 'string' && item.id !== '';
}
