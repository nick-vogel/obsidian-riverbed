import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type RiverbedPlugin from './main';
import { DEFAULT_SETTINGS, MAX_INTERVAL_MINUTES, clampInterval } from './settings';
import { folderNotice, sanitizeFolder } from './sync/sanitize';
import { normalizeBaseUrl, testConnection } from './outboxClient';

function reasonOf(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

export class RiverbedSettingTab extends PluginSettingTab {
	private plugin: RiverbedPlugin;

	constructor(app: App, plugin: RiverbedPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/**
	 * Persist without returning a promise to a caller that will not await it.
	 *
	 * Neither Obsidian's `onChange` nor a DOM listener awaits what it is handed, so an
	 * async handler's rejection surfaces as a bare unhandled rejection with no indication
	 * of which control produced it. Failing to write data.json is worth a line in the
	 * console naming the setting that was lost.
	 */
	private persist(what: string): void {
		this.plugin.saveSettings().catch((e) => {
			console.log(`Riverbed: could not save the ${what} setting: ${reasonOf(e)}`);
		});
	}

	display(): void {
		const { containerEl } = this;
		const floor = this.plugin.intervalFloor;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Base URL')
			.setDesc('Your Riverbed instance. Change this if you self-host.')
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.baseUrl)
					.setValue(this.plugin.settings.baseUrl)
					.onChange((value) => {
						this.plugin.settings.baseUrl = value.trim();
						this.persist('base URL');
					}),
			);

		new Setting(containerEl)
			.setName('API token')
			.setDesc('Create one in Riverbed under Settings, API tokens. Shown only once.')
			.addText((text) => {
				text.inputEl.type = 'password';
				text
					.setPlaceholder('Paste your outbox token')
					.setValue(this.plugin.settings.token)
					.onChange((value) => {
						this.plugin.settings.token = value.trim();
						this.persist('API token');
					});
			});

		new Setting(containerEl)
			.setName('Destination folder')
			.setDesc(
				'Vault folder captures are written to. Created if it does not exist. Nest with "/", ' +
					'for example "research/inbox". Leave empty to write to the vault root.',
			)
			.addText((text) => {
				text
					// NOT the default folder. A placeholder reads as "leave this empty and you
					// get that", and empty means the vault root here, not `inbox`.
					.setPlaceholder('Vault root')
					.setValue(this.plugin.settings.folder)
					.onChange((value) => {
						// Persist only a SAFE value while typing, and do NOT rewrite the text
						// under the caret: this fires on every keystroke, so calling setValue
						// here would fight an ordinary edit. Same shape as the interval field.
						this.plugin.settings.folder = sanitizeFolder(value).folder;
						this.persist('destination folder');
					});

				// Validate on COMMIT. Persistence is already safe (and runSync sanitizes again
				// regardless), so this exists to TELL the user their folder changed, right away
				// rather than silently on the next sync. Plain addEventListener, deliberately:
				// SettingTab is not a Component, so registerDomEvent would bind to the PLUGIN's
				// lifetime while display() re-runs on every settings open, leaking one handler
				// per open against a detached input.
				text.inputEl.addEventListener('blur', () => {
					const result = sanitizeFolder(text.inputEl.value);
					this.plugin.settings.folder = result.folder;

					const notice = folderNotice(result);
					if (notice !== null) {
						// Rewrite the field only when something was actually corrected, and say
						// so. Rewriting unconditionally would strip a deliberately-typed trailing
						// separator: type `research/`, click away to read something, click back
						// and type `inbox`, and you get `researchinbox`.
						text.setValue(result.folder);
						new Notice(notice);
					}
					this.persist('destination folder');
				});
			});

		new Setting(containerEl)
			.setName('Sync interval')
			.setDesc(`Minutes between automatic syncs. Minimum ${floor} in this build, maximum ${MAX_INTERVAL_MINUTES}.`)
			.addText((text) => {
				text.inputEl.type = 'number';
				text.inputEl.min = String(floor);
				text.inputEl.max = String(MAX_INTERVAL_MINUTES);
				text
					.setPlaceholder(String(DEFAULT_SETTINGS.intervalMinutes))
					.setValue(String(this.plugin.settings.intervalMinutes))
					.onChange((value) => {
						// While typing, PERSIST only a legal value and otherwise do nothing.
						// Rejecting per keystroke makes an ordinary edit impossible: this
						// control's onChange fires on every input event, so clearing the field
						// to retype reads as an empty string, and rewriting the text under the
						// caret turns "select all, type 30" into "1530". A production build
						// (floor 5) is worse still, because the first digit of any value from
						// 10 to 49 is itself sub-floor and would be rejected outright.
						const parsed = Number(value);
						if (!Number.isFinite(parsed) || parsed < floor || parsed > MAX_INTERVAL_MINUTES) {
							return;
						}
						this.plugin.settings.intervalMinutes = parsed;
						// Rearm the timer, or the change only takes effect on the next restart.
						// Ahead of the save, and not chained off it, because the timer reads the
						// in-memory value: a failed write to data.json should not also cost the
						// user the interval they are running right now.
						this.plugin.rescheduleSync();
						this.persist('sync interval');
					});

				// Validate on COMMIT, not on input. Persistence is already safe (onChange
				// above never stores a sub-floor value); this restores the displayed value
				// once the user leaves the field and tells them why their entry did not take.
				text.inputEl.addEventListener('blur', () => {
					const parsed = Number(text.inputEl.value);
					if (Number.isFinite(parsed) && parsed >= floor && parsed <= MAX_INTERVAL_MINUTES) {
						text.setValue(String(parsed));
						return;
					}
					// The cap is enforced here as well as in clampInterval, or the field would
					// display a value the timer is not actually using until the next launch.
					new Notice(
						Number.isFinite(parsed) && parsed > MAX_INTERVAL_MINUTES
							? `Riverbed: the sync interval cannot be above ${MAX_INTERVAL_MINUTES} minutes.`
							: `Riverbed: the sync interval cannot be below ${floor} minute${floor === 1 ? '' : 's'}.`,
					);
					const kept = clampInterval(this.plugin.settings.intervalMinutes, floor);
					this.plugin.settings.intervalMinutes = kept;
					text.setValue(String(kept));
					this.plugin.rescheduleSync();
					this.persist('sync interval');
				});
			});

		new Setting(containerEl)
			.setName('Notifications')
			.setDesc('Show a notice when a sync delivers new captures.')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.notifications).onChange((value) => {
					this.plugin.settings.notifications = value;
					this.persist('notifications');
				}),
			);

		new Setting(containerEl)
			.setName('Test connection')
			.setDesc('Check the base URL and token against your Riverbed instance.')
			.addButton((button) =>
				button
					.setButtonText('Test connection')
					.setCta()
					.onClick(() => {
						const { baseUrl, token } = this.plugin.settings;
						const shown = normalizeBaseUrl(baseUrl);
						button.setDisabled(true);
						testConnection(baseUrl, token)
							.then((result) => {
								switch (result.kind) {
									case 'connected':
										new Notice(
											result.pending === null
												? 'Riverbed: connected.'
												: `Riverbed: connected. ${result.pending} capture${result.pending === 1 ? '' : 's'} pending.`,
										);
										break;
									case 'auth-failed':
										new Notice('Riverbed: authentication failed, check your token.');
										break;
									case 'unexpected-status':
										new Notice(`Riverbed: unexpected response (${result.status}) from ${shown}.`);
										break;
									case 'unreachable':
										new Notice(`Riverbed: could not reach ${shown}.`);
										break;
								}
							})
							// testConnection catches its own network failures, so reaching here
							// means something unforeseen. Without this the button would re-enable
							// (the finally still runs) having shown the user nothing at all.
							.catch((e) => {
								new Notice(`Riverbed: could not test the connection. ${reasonOf(e)}`);
							})
							.finally(() => {
								button.setDisabled(false);
							});
					}),
			);
	}
}
