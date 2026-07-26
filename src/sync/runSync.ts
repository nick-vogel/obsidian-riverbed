import { resolveTarget } from './resolve';
import { sanitizeFilename } from './sanitize';
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

		await this.ensureFolder(deps);

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
				const target = await resolveTarget(
					deps.vault,
					deps.folder,
					filename,
					item.renderedMarkdown,
				);
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

	private async ensureFolder(deps: SyncDeps): Promise<void> {
		const folder = deps.folder.replace(/^\/+|\/+$/g, '');
		if (folder === '') return;
		if (await deps.vault.exists(folder)) return;
		try {
			await deps.vault.createFolder(folder);
		} catch (e) {
			// Another pass (or the user) may have created it in between; only a genuinely
			// missing folder is a problem, and the per-entry writes below will surface that.
			deps.log?.(`Riverbed: could not create "${folder}": ${reasonOf(e)}`);
		}
	}
}
