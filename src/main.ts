import { Notice, Plugin, addIcon, normalizePath } from 'obsidian';
import {
	DEFAULT_SETTINGS,
	DEV_INTERVAL_FLOOR,
	PROD_INTERVAL_FLOOR,
	RiverbedSettings,
	clampInterval,
	isConfigured,
	normalizeSettings,
} from './settings';
import { RiverbedSettingTab } from './settingsTab';
import { HttpOutboxGateway } from './outboxClient';
import { SyncRunner } from './sync/runSync';
import { RIBBON_ICON, RIBBON_SVG } from './ribbon';
import { SyncState, SyncTrigger, stateForResult, statusText, syncNotice } from './status';
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
		this.setStatus({ kind: 'idle' });

		this.addCommand({
			id: 'sync-now',
			name: 'Sync now',
			callback: () => {
				void this.runSync('manual');
			},
		});

		// Same action as the command, reachable without knowing it exists. The palette is
		// only discoverable to someone already looking for it.
		addIcon(RIBBON_ICON, RIBBON_SVG);
		this.addRibbonIcon(RIBBON_ICON, 'Riverbed: Sync now', () => {
			void this.runSync('manual');
		});

		// Startup pass behind onLayoutReady: during onload the vault is still emitting its
		// load-time events, so a pass fired here races an index that is not finished being
		// built. The recurring timer is armed immediately either way.
		// onLayoutReady is not lifecycle-bound; runSync's own unloaded guard covers the case
		// where the plugin is disabled between onload and layout-ready.
		this.app.workspace.onLayoutReady(() => {
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
		if (this.unloaded) return;
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
	async runSync(trigger: SyncTrigger) {
		// One guard covering every trigger (startup callback, interval tick, command), rather
		// than only the onLayoutReady call site: a timer armed just before teardown, or a
		// queued callback, must not sync against a plugin that is already unloaded.
		if (this.unloaded) return;

		// An unconfigured plugin must never touch the network. Without this, enabling the
		// plugin fires a startup pass with an empty token against the default base URL, and
		// the timer repeats it forever: a console error on every launch, and once the
		// default host is live, a request from every install that was never set up.
		if (!isConfigured(this.settings)) {
			this.report({ kind: 'not-configured' }, trigger);
			return;
		}

		try {
			const result = await this.runner.run({
				vault: this.vaultAdapter(),
				outbox: this.outbox,
				folder: this.settings.folder,
				log: (message) => console.log(message),
				// Announced by the RUNNER, from inside its single-flight guard, so this only
				// fires for a pass that genuinely started. Setting it here instead let a
				// skipped pass overwrite a running one's `syncing 9 of 10` with a bare
				// `syncing...`, losing the count in the stall case the count exists for.
				onPassStart: () => this.setStatus({ kind: 'syncing' }),
				onProgress: (done, total) => this.setStatus({ kind: 'syncing', done, total }),
			});
			// A pass was already running and owns the status bar, untouched above. Nothing to
			// report here: the running pass reports for itself.
			if (result === null) return;

			this.report(stateForResult(result), trigger);
		} catch (e) {
			const reason = e instanceof Error ? e.message : String(e);
			console.log(`Riverbed: sync (${trigger}) failed: ${reason}`);
			this.report({ kind: 'failed', reason }, trigger);
		}
	}

	/**
	 * Update the status bar, and interrupt with a Notice only when the state and trigger
	 * warrant one. Both decisions live in `status.ts`, which is testable; this is the wiring.
	 */
	private report(state: SyncState, trigger: SyncTrigger) {
		this.setStatus(state);
		const notice = syncNotice(state, trigger, this.settings.notifications);
		if (notice !== null) new Notice(notice);
	}

	private setStatus(state: SyncState) {
		const stamp = new Date().toLocaleTimeString();
		this.statusBar?.setText(`${statusText(state)} (${stamp})`);
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
		// Every normalization lives in normalizeSettings, which is obsidian-free and so
		// actually testable; this module is not loadable by vitest at all.
		this.settings = normalizeSettings(await this.loadData(), this.intervalFloor);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
