import { resolveTarget } from './resolve';
import { sanitizeFilename, sanitizeFolder } from './sanitize';
import { SyncDeps, SyncResult, isOutboxItem } from './types';

function reasonOf(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

/**
 * Runs sync passes, one at a time.
 *
 * The single-flight guard is the reason this is a class rather than a bare function: an
 * interval tick that lands while a pass is still running must not start a second pass, or
 * both would race to write the same entry and spuriously trip the collision suffix.
 */
export class SyncRunner {
	private inFlight: Promise<SyncResult> | null = null;

	/** True while a pass is running. */
	get busy(): boolean {
		return this.inFlight !== null;
	}

	/**
	 * Run a pass, or return null if one is already running.
	 *
	 * The guard is released in a `finally` covering the whole pass, including the fetch.
	 * Releasing it only on the happy path would mean a single thrown error (a server that
	 * went away mid-fetch, say) wedges the guard forever and silently kills every future
	 * sync with no error and no symptom.
	 */
	run(deps: SyncDeps): Promise<SyncResult | null> {
		if (this.inFlight) {
			deps.log?.('Riverbed: sync already in progress, skipping this pass');
			return Promise.resolve(null);
		}
		const pass = this.pass(deps).finally(() => {
			this.inFlight = null;
		});
		this.inFlight = pass;
		return pass;
	}

	private async pass(deps: SyncDeps): Promise<SyncResult> {
		const items = await deps.outbox.getPending();
		if (items.length === 0) return { delivered: 0, failed: 0 };

		// Defense in depth, covering both the folder creation below and every write in the
		// loop. In the shipped plugin this should never actually change anything: every
		// writer of `settings.folder` already sanitizes (normalizeSettings on load, and both
		// handlers on the settings control), and sanitizeFolder is idempotent, so a folder
		// reaching here is already clean. That is exactly why it stays. This is the last
		// point before a path is joined to the vault root, and it must not depend on every
		// caller upstream having remembered.
		const cleaned = sanitizeFolder(deps.folder);
		const folder = cleaned.folder;
		if (cleaned.escaped || cleaned.changed) {
			// If it ever DOES change something, that means a path upstream skipped its
			// sanitize, and silently papering over that is how a folder diverges from what
			// the settings screen displays with nothing anywhere explaining why.
			deps.log?.(
				`Riverbed: destination folder "${deps.folder}" is not usable as configured, writing to ` +
					`${folder === '' ? 'the vault root' : `"${folder}"`}`,
			);
		}

		await this.ensureFolder(deps, folder);

		let delivered = 0;
		let failed = 0;

		for (const item of items) {
			// Only the vault write is guarded here. An ack failure is deliberately NOT in
			// this try: see below.
			try {
				// The entry reached here with a usable id but is not otherwise well formed.
				// Fail it through the normal path so it is REPORTED and visible in the
				// reader's Outbox, rather than dropped where nobody would ever see it.
				if (!isOutboxItem(item)) {
					throw new Error('malformed outbox entry: renderedMarkdown or suggestedFilename is not a string');
				}
				const filename = sanitizeFilename(item.suggestedFilename, item.id);
				const target = await resolveTarget(deps.vault, folder, filename, item.renderedMarkdown);
				if (target.action === 'write') {
					await deps.vault.create(target.path, item.renderedMarkdown);
				}
			} catch (e) {
				failed++;
				// The error report is a signal to the user, not a delivery mechanism. If it
				// fails too, the entry is still correctly left pending, and the rest of the
				// pass must carry on regardless.
				try {
					await deps.outbox.reportError(item.id, reasonOf(e));
				} catch (reportFailure) {
					deps.log?.(`Riverbed: could not report a failed write: ${reasonOf(reportFailure)}`);
				}
				continue;
			}

			// The content is on disk at this point. If the ack call fails, nothing is
			// broken: the entry stays pending and the next pass recognises the identical
			// bytes already at the target and acks it then. Reporting an error here would
			// show the user a failed capture that is actually safely in their vault.
			delivered++;
			try {
				await deps.outbox.ack(item.id);
			} catch (e) {
				deps.log?.(`Riverbed: write succeeded but ack failed, will re-ack next pass: ${reasonOf(e)}`);
			}
		}

		return { delivered, failed };
	}

	/**
	 * Create the destination folder if it is missing, one level at a time.
	 *
	 * Walks the path rather than creating only the deepest segment, because a nested
	 * destination (`research/inbox`) is supported and creating a leaf whose parent does not
	 * exist is not something Obsidian's `createFolder` is documented to do. Walking removes
	 * the dependence on that undocumented behaviour.
	 *
	 * There is deliberately no `exists` pre-check. `exists` is true for a file as well as a
	 * folder, so guarding with it SKIPS a level where a note is sitting in the way, and the
	 * problem then resurfaces as a write failure whose reason names the wrong thing.
	 * `createFolder` is idempotent and throws only when a non-folder occupies the path, so
	 * calling it unconditionally is both correct and the only way to learn that.
	 *
	 * @param folder already through `sanitizeFolder`; see the call site in `pass`.
	 */
	private async ensureFolder(deps: SyncDeps, folder: string): Promise<void> {
		if (folder === '') return;
		let current = '';
		for (const part of folder.split('/')) {
			current = current === '' ? part : `${current}/${part}`;
			try {
				await deps.vault.createFolder(current);
			} catch (e) {
				// A note in the way, or a permissions problem. Report it and carry on: the
				// per-entry writes below fail too, and this is the line that says why.
				deps.log?.(`Riverbed: could not create "${current}": ${reasonOf(e)}`);
			}
		}
	}
}
