// Pure settings model. Deliberately free of any `obsidian` import so its logic can be
// bundled and exercised headlessly (see the phase-1 plan, step 3 gate). Anything that
// touches Obsidian's runtime belongs in settingsTab.ts or main.ts.

export interface RiverbedSettings {
	/** Base URL of the Riverbed instance, no trailing slash required. */
	baseUrl: string;
	/** Outbox API token (Settings -> API tokens in the reader). */
	token: string;
	/** Vault-relative destination folder for delivered captures. */
	folder: string;
	/** Auto-sync interval in minutes. Never below the build's floor. */
	intervalMinutes: number;
	/** Whether a delivering sync shows a Notice. */
	notifications: boolean;
}

export const DEFAULT_SETTINGS: RiverbedSettings = {
	baseUrl: 'https://riverbedfeed.com',
	token: '',
	folder: 'inbox',
	intervalMinutes: 15,
	notifications: true,
};

/** Production builds poll no faster than every 5 minutes; dev builds may poll every 1. */
export const PROD_INTERVAL_FLOOR = 5;
export const DEV_INTERVAL_FLOOR = 1;

/**
 * Whether the plugin has enough configuration to talk to a server at all. Guards every
 * sync trigger: an install that has never been set up must make no network call, so it
 * neither logs an error on each launch nor sends an empty-token request to whatever the
 * default base URL points at.
 *
 * Deliberately a presence check, not validation — a wrong-but-present URL or a revoked
 * token is a connection failure the user should SEE reported, not a silent skip.
 */
export function isConfigured(settings: RiverbedSettings): boolean {
	return settings.baseUrl.trim() !== '' && settings.token.trim() !== '';
}

/**
 * Raise a sub-floor interval up to the floor. Applied at load time as well as in the
 * settings control, so a value persisted under a dev build's floor of 1 cannot keep
 * running sub-floor once the same data.json is loaded by a production build.
 *
 * A non-finite value (a blank or non-numeric field persisted into data.json) falls back
 * to the default interval, itself clamped, rather than propagating NaN into a timer.
 */
export function clampInterval(loaded: number, floor: number): number {
	if (!Number.isFinite(loaded)) {
		return Math.max(DEFAULT_SETTINGS.intervalMinutes, floor);
	}
	return Math.max(loaded, floor);
}
