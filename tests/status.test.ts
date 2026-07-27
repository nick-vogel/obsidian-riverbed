import { describe, expect, it } from 'vitest';
import { SyncState, stateForResult, statusText, syncNotice } from '../src/status';

describe('statusText — a pass in flight must not look idle', () => {
	it('says it is syncing before the outbox has answered', () => {
		// The gap this closes: the bar kept showing the PREVIOUS outcome for the whole pass,
		// so a slow or hanging sync was indistinguishable from an idle one. That is the state
		// you most need to see and the one there was no way to see.
		expect(statusText({ kind: 'syncing' })).toBe('Riverbed: syncing...');
	});

	it('counts entries as they land, once there is a count', () => {
		expect(statusText({ kind: 'syncing', done: 2, total: 4 })).toBe('Riverbed: syncing 2 of 4');
		expect(statusText({ kind: 'syncing', done: 0, total: 4 })).toBe('Riverbed: syncing 0 of 4');
		expect(statusText({ kind: 'syncing', done: 4, total: 4 })).toBe('Riverbed: syncing 4 of 4');
	});

	it('treats a known total with no count yet as zero done, not as undefined', () => {
		// The type allows a total without a done, and every test here happened to pass both,
		// so `syncing undefined of 4` was reachable and unasserted.
		expect(statusText({ kind: 'syncing', total: 4 })).toBe('Riverbed: syncing 0 of 4');
	});

	it('does not invent a count it does not have', () => {
		// `0 of 0` would be a fabricated number dressed up as progress. Before the outbox
		// answers, the honest thing to say is that a pass started.
		expect(statusText({ kind: 'syncing', total: 0 })).toBe('Riverbed: syncing...');
		expect(statusText({ kind: 'syncing', done: 0 })).toBe('Riverbed: syncing...');
	});

	it('renders every terminal state', () => {
		expect(statusText({ kind: 'idle' })).toBe('Riverbed: idle');
		expect(statusText({ kind: 'not-configured' })).toBe('Riverbed: not configured');
		expect(statusText({ kind: 'nothing-to-sync' })).toBe('Riverbed: nothing to sync');
		expect(statusText({ kind: 'failed' })).toBe('Riverbed: sync failed');
		expect(statusText({ kind: 'delivered', delivered: 3, failed: 0 })).toBe('Riverbed: synced 3');
		expect(statusText({ kind: 'delivered', delivered: 2, failed: 1 })).toBe(
			'Riverbed: 2 synced, 1 failed',
		);
	});

	it('never uses an em-dash, which is a repo-wide rule for user-facing copy', () => {
		const states: SyncState[] = [
			{ kind: 'idle' },
			{ kind: 'not-configured' },
			{ kind: 'syncing' },
			{ kind: 'syncing', done: 1, total: 2 },
			{ kind: 'nothing-to-sync' },
			{ kind: 'delivered', delivered: 1, failed: 1 },
			{ kind: 'failed' },
		];
		for (const state of states) expect(statusText(state)).not.toContain('—');
	});
});

describe('syncNotice — an asked-for action always confirms itself', () => {
	it('confirms an empty manual sync, which otherwise looks like nothing happened', () => {
		// Running "Sync now" against an empty outbox used to be indistinguishable from the
		// command failing to fire at all.
		expect(syncNotice({ kind: 'nothing-to-sync' }, 'manual', true)).toBe(
			'Riverbed: nothing to sync.',
		);
	});

	it('stays silent about an empty SCHEDULED pass, which would be noise every interval', () => {
		expect(syncNotice({ kind: 'nothing-to-sync' }, 'scheduled', true)).toBeNull();
		expect(syncNotice({ kind: 'nothing-to-sync' }, 'startup', true)).toBeNull();
	});

	it('announces a delivery on ANY trigger, because that is what the plugin is for', () => {
		expect(syncNotice({ kind: 'delivered', delivered: 1, failed: 0 }, 'scheduled', true)).toBe(
			'Riverbed: synced 1 capture.',
		);
		expect(syncNotice({ kind: 'delivered', delivered: 3, failed: 0 }, 'startup', true)).toBe(
			'Riverbed: synced 3 captures.',
		);
	});

	it('follows the unconfigured guard it was modelled on', () => {
		expect(syncNotice({ kind: 'not-configured' }, 'manual', true)).toBe(
			'Riverbed: set your server URL and API token in settings first.',
		);
		expect(syncNotice({ kind: 'not-configured' }, 'scheduled', true)).toBeNull();
	});

	it('SPEAKS UP when a manual pass failed everything, not only when it did nothing', () => {
		// The contradiction this closes: an empty manual sync got a notice while a manual sync
		// where every entry failed to write got none, so the plugin was louder about
		// nothing-having-happened than about everything-having-broken.
		expect(syncNotice({ kind: 'delivered', delivered: 0, failed: 2 }, 'manual', true)).toBe(
			'Riverbed: 2 captures failed to write.',
		);
		expect(syncNotice({ kind: 'delivered', delivered: 0, failed: 1 }, 'manual', true)).toBe(
			'Riverbed: 1 capture failed to write.',
		);
		// Still silent on a scheduled pass, which would otherwise nag every interval.
		expect(syncNotice({ kind: 'delivered', delivered: 0, failed: 2 }, 'scheduled', true)).toBeNull();
	});

	it('stays quiet for a delivery state with no counts at all', () => {
		// Not reachable today (the loop counts every entry), but the TYPE allows it, and this
		// is the arm a `case` falls THROUGH from if its return is ever removed. Without the
		// assertion, dropping that return silently borrows the next case's notice.
		expect(syncNotice({ kind: 'delivered', delivered: 0, failed: 0 }, 'manual', true)).toBeNull();
		expect(syncNotice({ kind: 'delivered', delivered: 0, failed: 0 }, 'scheduled', true)).toBeNull();
	});

	it('mentions failures alongside a partial success, rather than only the wins', () => {
		// Reporting just the deliveries of a partial pass tells the user everything worked.
		expect(syncNotice({ kind: 'delivered', delivered: 2, failed: 1 }, 'scheduled', true)).toBe(
			'Riverbed: synced 2 captures, 1 failed.',
		);
	});

	it('respects the notifications toggle for every state', () => {
		const states: SyncState[] = [
			{ kind: 'nothing-to-sync' },
			{ kind: 'not-configured' },
			{ kind: 'delivered', delivered: 5, failed: 0 },
			{ kind: 'delivered', delivered: 0, failed: 5 },
			{ kind: 'failed', reason: 'boom' },
		];
		for (const state of states) expect(syncNotice(state, 'manual', false)).toBeNull();
	});

	it('reports a failure reason only when the user asked for the pass', () => {
		expect(syncNotice({ kind: 'failed', reason: 'connection refused' }, 'manual', true)).toBe(
			'Riverbed: sync failed. connection refused',
		);
		expect(syncNotice({ kind: 'failed', reason: 'x' }, 'scheduled', true)).toBeNull();
		expect(syncNotice({ kind: 'failed', reason: 'x' }, 'startup', true)).toBeNull();
		// A reasonless failure still reads as a sentence, with no trailing space.
		expect(syncNotice({ kind: 'failed' }, 'manual', true)).toBe('Riverbed: sync failed.');
	});

	it('stays quiet for the two non-terminal states', () => {
		for (const trigger of ['manual', 'startup', 'scheduled'] as const) {
			expect(syncNotice({ kind: 'idle' }, trigger, true)).toBeNull();
			expect(syncNotice({ kind: 'syncing', done: 1, total: 2 }, trigger, true)).toBeNull();
		}
	});

	it('never uses an em-dash', () => {
		expect(syncNotice({ kind: 'nothing-to-sync' }, 'manual', true) ?? '').not.toContain('—');
		expect(syncNotice({ kind: 'failed', reason: 'x' }, 'manual', true) ?? '').not.toContain('—');
	});
});

describe('stateForResult — what a finished pass leaves on screen', () => {
	// This is the decision `pending` exists to make, and it lived in main.ts, the one module
	// no test can load (it imports `obsidian`, which ships types with no runtime entry).

	it('reads an empty outbox as nothing-to-sync, not as a zero delivery', () => {
		expect(stateForResult({ delivered: 0, failed: 0, pending: 0 })).toEqual({
			kind: 'nothing-to-sync',
		});
	});

	it('reads a pass that had work as a delivery, however it went', () => {
		expect(stateForResult({ delivered: 3, failed: 0, pending: 3 })).toEqual({
			kind: 'delivered',
			delivered: 3,
			failed: 0,
		});
		// Everything failed. Still a delivery outcome, not "nothing to sync": there WAS
		// something to sync, which is the distinction the status bar has to carry.
		expect(stateForResult({ delivered: 0, failed: 2, pending: 2 })).toEqual({
			kind: 'delivered',
			delivered: 0,
			failed: 2,
		});
	});
});
