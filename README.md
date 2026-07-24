# Riverbed for Obsidian

Syncs your saved [Riverbed](https://riverbedfeed.com) captures into your Obsidian vault
as markdown notes.

Riverbed's reader keeps every save in a pull-based outbox. This plugin is the bridge: it
polls that outbox on an interval, writes each capture's rendered markdown into a folder
you choose, and confirms delivery back to Riverbed so the same capture is never delivered
twice. Captures arrive exactly as your Riverbed capture template rendered them, so they
drop straight into whatever inbox workflow you already run.

Status: v1 in development. Install and usage documentation lands with the first release.

## Settings

| Setting | What it does |
| --- | --- |
| Base URL | The Riverbed instance to sync from. Change it if you self-host. |
| API token | Your outbox token. Create one in Riverbed under Settings, API tokens. |
| Destination folder | Vault folder captures are written to. Created if missing. |
| Sync interval | Minutes between automatic syncs. Minimum 5. |
| Notifications | Whether a delivering sync shows a notice. |
| Test connection | Checks the base URL and token, and reports success, an authentication failure, or an unreachable host. |

## Security

**Your API token is stored in plaintext.** Obsidian keeps plugin settings in an unencrypted
JSON file, so the token you paste into this plugin lives readable on disk at:

```
<your vault>/.obsidian/plugins/riverbed/data.json
```

This matters if your vault is under version control. **Exclude `.obsidian/plugins/` from
any repository your vault is committed to**, or the token ends up in your git history and
in every clone and remote copy of it. Add this to the vault's `.gitignore`:

```
.obsidian/plugins/
```

The same applies to any backup, sync, or sharing tool that copies the vault wholesale.

A Riverbed outbox token is scoped to the outbox only: it can list and acknowledge your
pending captures and nothing else. It cannot read or write your feeds, subscriptions, or
templates. It is still worth protecting, since anyone holding it can read the captures you
have saved but not yet synced. If a token is exposed, revoke it in Riverbed under Settings,
API tokens, and create a new one. Revocation takes effect on the very next request.

## License

MIT
