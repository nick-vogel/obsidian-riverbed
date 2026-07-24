import { Notice, Plugin, TFile, TFolder } from 'obsidian';
import {
	DEFAULT_SETTINGS,
	DEV_INTERVAL_FLOOR,
	PROD_INTERVAL_FLOOR,
	RiverbedSettings,
	clampInterval,
} from './settings';
import { RiverbedSettingTab } from './settingsTab';
import { HttpOutboxGateway } from './outboxClient';
import { SyncRunner } from './sync/runSync';
import { SyncVault } from './sync/types';

export default class RiverbedPlugin extends Plugin {
	settings: RiverbedSettings = { ...DEFAULT_SETTINGS };

	/**
	 * Smallest sync interval this build permits: 5 minutes in production, 1 in a dev
	 * build. IS_DEV is substituted by esbuild at bundle time (see esbuild.config.mjs);
	 * src/global.d.ts declares it for the type checker.
	 */
	readonly intervalFloor: number = IS_DEV ? DEV_INTERVAL_FLOOR : PROD_INTERVAL_FLOOR;

	private runner = new SyncRunner();
	private outbox = new HttpOutboxGateway(
		() => this.settings.baseUrl,
		() => this.settings.token,
	);
	private intervalId: number | null = null;
	private statusBar: HTMLElement | null = null;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new RiverbedSettingTab(this.app, this));

		this.statusBar = this.addStatusBarItem();
		this.setStatus('Riverbed: idle');

		this.addCommand({
			id: 'sync-now',
			name: 'Sync now',
			callback: () => {
				void this.runSync('manual');
			},
		});

		// Startup pass, then the recurring one.
		void this.runSync('startup');
		this.rescheduleSync();

		console.log(`Riverbed: loaded (sync interval floor ${this.intervalFloor} min)`);
	}

	onunload() {
		this.clearInterval();
		console.log('Riverbed: unloaded');
	}

	/**
	 * (Re)arm the auto-sync timer. Always clears the previous one FIRST: without that, a
	 * settings edit leaves the old timer running alongside the new one and every tick
	 * fires two passes.
	 */
	rescheduleSync() {
		this.clearInterval();
		const ms = clampInterval(this.settings.intervalMinutes, this.intervalFloor) * 60_000;
		const id = window.setInterval(() => {
			void this.runSync('scheduled');
		}, ms);
		this.intervalId = id;
		// registerInterval also clears it on unload, as a backstop to onunload().
		this.registerInterval(id);
	}

	private clearInterval() {
		if (this.intervalId !== null) {
			window.clearInterval(this.intervalId);
			this.intervalId = null;
		}
	}

	/**
	 * One sync pass. Never throws: a failure becomes a visible status, because a plugin
	 * that dies silently costs the user captures without ever telling them.
	 */
	async runSync(trigger: 'manual' | 'startup' | 'scheduled') {
		try {
			const result = await this.runner.run({
				vault: this.vaultAdapter(),
				outbox: this.outbox,
				folder: this.settings.folder,
				log: (message) => console.log(message),
			});
			if (result === null) return; // a pass was already running

			if (result.failed > 0) {
				this.setStatus(`Riverbed: ${result.delivered} synced, ${result.failed} failed`);
			} else {
				this.setStatus(`Riverbed: synced ${result.delivered}`);
			}
			if (result.delivered > 0 && this.settings.notifications) {
				new Notice(`Riverbed: synced ${result.delivered} capture${result.delivered === 1 ? '' : 's'}.`);
			}
		} catch (e) {
			const reason = e instanceof Error ? e.message : String(e);
			this.setStatus('Riverbed: sync failed');
			console.log(`Riverbed: sync (${trigger}) failed: ${reason}`);
			if (this.settings.notifications && trigger === 'manual') {
				new Notice(`Riverbed: sync failed. ${reason}`);
			}
		}
	}

	private setStatus(text: string) {
		const stamp = new Date().toLocaleTimeString();
		this.statusBar?.setText(`${text} (${stamp})`);
	}

	/** The production SyncVault: the narrow interface the sync pass runs against. */
	private vaultAdapter(): SyncVault {
		const vault = this.app.vault;
		return {
			exists: async (path) => vault.getAbstractFileByPath(path) !== null,
			read: async (path) => {
				const file = vault.getAbstractFileByPath(path);
				if (!(file instanceof TFile)) throw new Error(`not a file: ${path}`);
				// read, not cachedRead: the byte comparison must see current disk contents.
				return vault.read(file);
			},
			create: async (path, contents) => {
				// Fault injection for the AC 8 integration gate, dev builds only: a capture
				// whose filename contains this sentinel fails to write, so the ack-only-on-
				// write path and the reader's failed-with-Retry state can be exercised
				// against a live server. Craft one via a custom capture template. esbuild
				// substitutes IS_DEV to false in a production build, so this whole branch is
				// dead code the bundler drops.
				if (IS_DEV && path.includes('riverbed-fail-write')) {
					throw new Error('induced write failure (dev fault injection)');
				}
				await vault.create(path, contents);
			},
			createFolder: async (path) => {
				if (vault.getAbstractFileByPath(path) instanceof TFolder) return;
				await vault.createFolder(path);
			},
		};
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
