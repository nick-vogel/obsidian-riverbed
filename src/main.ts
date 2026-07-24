import { Plugin } from 'obsidian';
import {
	DEFAULT_SETTINGS,
	DEV_INTERVAL_FLOOR,
	PROD_INTERVAL_FLOOR,
	RiverbedSettings,
	clampInterval,
} from './settings';
import { RiverbedSettingTab } from './settingsTab';

export default class RiverbedPlugin extends Plugin {
	settings: RiverbedSettings = { ...DEFAULT_SETTINGS };

	/**
	 * Smallest sync interval this build permits: 5 minutes in production, 1 in a dev
	 * build. IS_DEV is substituted by esbuild at bundle time (see esbuild.config.mjs);
	 * src/global.d.ts declares it for the type checker.
	 */
	readonly intervalFloor: number = IS_DEV ? DEV_INTERVAL_FLOOR : PROD_INTERVAL_FLOOR;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new RiverbedSettingTab(this.app, this));
		console.log(`Riverbed: loaded (sync interval floor ${this.intervalFloor} min)`);
	}

	onunload() {
		console.log('Riverbed: unloaded');
	}

	async loadSettings() {
		const merged: RiverbedSettings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		// Clamp on load, not only in the settings control: an interval persisted under a
		// dev build's floor of 1 must not keep running sub-floor once the same data.json
		// is opened by a production build.
		merged.intervalMinutes = clampInterval(Number(merged.intervalMinutes), this.intervalFloor);
		this.settings = merged;
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
