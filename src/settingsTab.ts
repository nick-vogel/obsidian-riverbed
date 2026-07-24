import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type RiverbedPlugin from './main';
import { DEFAULT_SETTINGS, clampInterval } from './settings';
import { normalizeBaseUrl, testConnection } from './outboxClient';

export class RiverbedSettingTab extends PluginSettingTab {
	private plugin: RiverbedPlugin;

	constructor(app: App, plugin: RiverbedPlugin) {
		super(app, plugin);
		this.plugin = plugin;
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
					.onChange(async (value) => {
						this.plugin.settings.baseUrl = value.trim();
						await this.plugin.saveSettings();
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
					.onChange(async (value) => {
						this.plugin.settings.token = value.trim();
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('Destination folder')
			.setDesc('Vault folder captures are written to. Created if it does not exist.')
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.folder)
					.setValue(this.plugin.settings.folder)
					.onChange(async (value) => {
						this.plugin.settings.folder = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Sync interval')
			.setDesc(`Minutes between automatic syncs. Minimum ${floor} in this build.`)
			.addText((text) => {
				text.inputEl.type = 'number';
				text.inputEl.min = String(floor);
				text
					.setPlaceholder(String(DEFAULT_SETTINGS.intervalMinutes))
					.setValue(String(this.plugin.settings.intervalMinutes))
					.onChange(async (value) => {
						// While typing, PERSIST only a legal value and otherwise do nothing.
						// Rejecting per keystroke makes an ordinary edit impossible: this
						// control's onChange fires on every input event, so clearing the field
						// to retype reads as an empty string, and rewriting the text under the
						// caret turns "select all, type 30" into "1530". A production build
						// (floor 5) is worse still, because the first digit of any value from
						// 10 to 49 is itself sub-floor and would be rejected outright.
						const parsed = Number(value);
						if (!Number.isFinite(parsed) || parsed < floor) return;
						this.plugin.settings.intervalMinutes = parsed;
						await this.plugin.saveSettings();
						// Rearm the timer, or the change only takes effect on the next restart.
						this.plugin.rescheduleSync();
					});

				// Validate on COMMIT, not on input. Persistence is already safe (onChange
				// above never stores a sub-floor value); this restores the displayed value
				// once the user leaves the field and tells them why their entry did not take.
				text.inputEl.addEventListener('blur', async () => {
					const parsed = Number(text.inputEl.value);
					if (Number.isFinite(parsed) && parsed >= floor) {
						text.setValue(String(parsed));
						return;
					}
					new Notice(
						`Riverbed: the sync interval cannot be below ${floor} minute${floor === 1 ? '' : 's'}.`,
					);
					const kept = clampInterval(this.plugin.settings.intervalMinutes, floor);
					this.plugin.settings.intervalMinutes = kept;
					text.setValue(String(kept));
					await this.plugin.saveSettings();
					this.plugin.rescheduleSync();
				});
			});

		new Setting(containerEl)
			.setName('Notifications')
			.setDesc('Show a notice when a sync delivers new captures.')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.notifications).onChange(async (value) => {
					this.plugin.settings.notifications = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName('Test connection')
			.setDesc('Check the base URL and token against your Riverbed instance.')
			.addButton((button) =>
				button
					.setButtonText('Test connection')
					.setCta()
					.onClick(async () => {
						const { baseUrl, token } = this.plugin.settings;
						const shown = normalizeBaseUrl(baseUrl);
						button.setDisabled(true);
						try {
							const result = await testConnection(baseUrl, token);
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
						} finally {
							button.setDisabled(false);
						}
					}),
			);
	}
}
