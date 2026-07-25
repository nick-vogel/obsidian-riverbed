import { Notice, Plugin, normalizePath } from 'obsidian';
import {
	DEFAULT_SETTINGS,
	DEV_INTERVAL_FLOOR,
	PROD_INTERVAL_FLOOR,
	RiverbedSettings,
	clampInterval,
	isConfigured,
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
	/** Set in onunload so a callback queued before teardown cannot run against a dead plugin. */
	private unloaded = false;

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

		// Startup pass behind onLayoutReady: during onload the vault is still emitting its
		// load-time events, so a pass fired here races an index that is not finished being
		// built. The recurring timer is armed immediately either way.
		this.app.workspace.onLayoutReady(() => {
			// onLayoutReady is not lifecycle-bound, so disabling the plugin in the window
			// between onload and layout-ready would otherwise still fire a full sync (network,
			// vault writes, acks) against a plugin that is already torn down.
			if (this.unloaded) return;
			void this.runSync('startup');
		});
		this.rescheduleSync();

		console.log(`Riverbed: loaded (sync interval floor ${this.intervalFloor} min)`);
	}

	onunload() {
		this.unloaded = true;
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
		// An unconfigured plugin must never touch the network. Without this, enabling the
		// plugin fires a startup pass with an empty token against the default base URL, and
		// the timer repeats it forever: a console error on every launch, and once the
		// default host is live, a request from every install that was never set up.
		if (!isConfigured(this.settings)) {
			this.setStatus('Riverbed: not configured');
			if (trigger === 'manual' && this.settings.notifications) {
				new Notice('Riverbed: set your server URL and API token in settings first.');
			}
			return;
		}

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

	/**
	 * The production SyncVault: the narrow interface the sync pass runs against.
	 *
	 * Existence and reads go through `vault.adapter` (the filesystem) rather than
	 * `getAbstractFileByPath` (Obsidian's in-memory index). The index is CASE-SENSITIVE
	 * while APFS and NTFS are not, so the index answers "no such file" for `Note.md` when
	 * `note.md` is on disk — and `Vault.create` would then truncate the user's existing
	 * note, with the collision resolver never getting a say. The index is also stale for
	 * anything written out of band (iCloud, git, another tool), which is normal for a
	 * vault. The adapter matches the semantics of the filesystem the write actually lands
	 * on, which is the only comparison that makes the guard sound.
	 */
	private vaultAdapter(): SyncVault {
		const vault = this.app.vault;
		return {
			exists: async (path) => vault.adapter.exists(normalizePath(path)),
			// read, not cachedRead: the byte comparison must see current disk contents.
			read: async (path) => vault.adapter.read(normalizePath(path)),
			create: async (path, contents) => {
				const normalized = normalizePath(path);
				// Fault injection for the AC 8 integration gate, dev builds only: a capture
				// whose filename contains this sentinel fails to write, so the ack-only-on-
				// write path and the reader's failed-with-Retry state can be exercised
				// against a live server. Craft one via a custom capture template. esbuild
				// substitutes IS_DEV to false in a production build, so this whole branch is
				// dead code the bundler drops.
				if (IS_DEV && normalized.includes('riverbed-fail-write')) {
					throw new Error('induced write failure (dev fault injection)');
				}
				// Normalized for the same reason exists/read are: normalizePath also applies NFC,
				// so an unnormalized write would land at a different path than the one just
				// checked for collisions on a filesystem that distinguishes the two.
				await vault.create(normalized, contents);
			},
			createFolder: async (path) => {
				const p = normalizePath(path);
				// stat, not the index, for the same reason as exists/read above. A folder
				// already there is fine; a FILE sitting at that path is not, and must not be
				// mistaken for one.
				const st = await vault.adapter.stat(p);
				if (st?.type === 'folder') return;
				await vault.createFolder(p);
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
