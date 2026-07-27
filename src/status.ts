// Every user-facing string the sync produces, and the decision about whether to say it.
//
// Obsidian-free on purpose. `main.ts` imports `obsidian`, which ships types with no runtime
// entry, so vitest cannot load that module at all: anything phrased inline there is wording
// no test can reach. That is not hypothetical here, since the two gaps this file exists to
// close were both invisible states, and an invisible state is exactly what a test catches
// and a glance at the screen does not.

import { SyncResult } from './sync/types';

/** What the plugin is doing right now, as far as the user needs to know. */
export type SyncState =
	| { kind: 'idle' }
	| { kind: 'not-configured' }
	/** A pass is running. `done`/`total` appear once the outbox has reported a count. */
	| { kind: 'syncing'; done?: number; total?: number }
	/** A pass finished having found nothing to do. */
	| { kind: 'nothing-to-sync' }
	| { kind: 'delivered'; delivered: number; failed: number }
	/** The pass itself threw, so no entry was even attempted. `reason` is for the notice. */
	| { kind: 'failed'; reason?: string };

/** What kicked the pass off. Governs whether a Notice is warranted; see `syncNotice`. */
export type SyncTrigger = 'manual' | 'startup' | 'scheduled';

/**
 * The state a finished pass leaves the plugin in.
 *
 * Lives here rather than in `main.ts` so it is reachable by a test. It is the one decision
 * `pending` was added to make, and `main.ts` is the one module no test can load.
 */
export function stateForResult(result: SyncResult): SyncState {
	return result.pending === 0
		? { kind: 'nothing-to-sync' }
		: { kind: 'delivered', delivered: result.delivered, failed: result.failed };
}

/**
 * Status-bar text for a state.
 *
 * The status bar always says something, whatever the trigger. It is ambient, so it costs the
 * user nothing to be wrong about, and a sync that is merely slow must not look identical to
 * one that is idle or wedged.
 */
export function statusText(state: SyncState): string {
	switch (state.kind) {
		case 'idle':
			return 'Riverbed: idle';
		case 'not-configured':
			return 'Riverbed: not configured';
		case 'syncing':
			// The count only appears once there is one. Before the outbox answers, the honest
			// thing to show is that a pass started, not a fabricated `0 of 0`.
			return state.total === undefined || state.total === 0
				? 'Riverbed: syncing...'
				: `Riverbed: syncing ${state.done ?? 0} of ${state.total}`;
		case 'nothing-to-sync':
			return 'Riverbed: nothing to sync';
		case 'delivered':
			return state.failed > 0
				? `Riverbed: ${state.delivered} synced, ${state.failed} failed`
				: `Riverbed: synced ${state.delivered}`;
		case 'failed':
			return 'Riverbed: sync failed';
	}
}

/** `n capture` / `n captures`, so the notices below read as English. */
function captures(n: number): string {
	return `${n} capture${n === 1 ? '' : 's'}`;
}

/**
 * The Notice text for a state, or null to stay quiet.
 *
 * The policy, in one place because it was previously spread across two functions and an
 * inline branch:
 *
 * - **Anything DELIVERED interrupts on any trigger.** Captures landing in the vault is the
 *   thing the user installed this for. This preserves the behaviour that shipped.
 * - **Everything else interrupts only when the user ASKED for the pass.** A scheduled pass
 *   announcing itself every interval is noise, and noise is what gets notifications turned
 *   off entirely.
 *
 * The second rule is why a manual pass that FAILED every entry has to speak up. It used to
 * fall through the `delivered === 0` case and say nothing at all, so the plugin was louder
 * about nothing-having-happened than about everything-having-broken.
 */
export function syncNotice(
	state: SyncState,
	trigger: SyncTrigger,
	notifications: boolean,
): string | null {
	if (!notifications) return null;
	const asked = trigger === 'manual';

	switch (state.kind) {
		case 'delivered':
			if (state.delivered > 0) {
				// Mention the failures too. Reporting only the successes of a partial pass
				// tells the user everything worked when it did not.
				return state.failed > 0
					? `Riverbed: synced ${captures(state.delivered)}, ${state.failed} failed.`
					: `Riverbed: synced ${captures(state.delivered)}.`;
			}
			// Nothing landed. There WAS work, so this is a failure report, not a no-op.
			if (state.failed > 0) {
				return asked ? `Riverbed: ${captures(state.failed)} failed to write.` : null;
			}
			return null;
		case 'nothing-to-sync':
			// An explicitly requested action always confirms itself. Doing nothing and saying
			// nothing is indistinguishable from the command having failed to fire at all.
			return asked ? 'Riverbed: nothing to sync.' : null;
		case 'not-configured':
			return asked ? 'Riverbed: set your server URL and API token in settings first.' : null;
		case 'failed':
			return asked
				? `Riverbed: sync failed.${state.reason === undefined ? '' : ` ${state.reason}`}`
				: null;
		// Enumerated rather than defaulted: for a function whose whole job is deciding
		// whether to interrupt someone, a new state silently resolving to "stay quiet" is the
		// wrong failure mode. Adding a SyncState kind should be a compile error here.
		case 'idle':
		case 'syncing':
			return null;
	}
}
