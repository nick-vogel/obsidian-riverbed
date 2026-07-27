# Riverbed for Obsidian

Syncs your saved [Riverbed](https://riverbedfeed.com) captures into your Obsidian vault
as markdown notes.

Riverbed's reader keeps every save in a pull-based outbox. This plugin is the bridge: it
polls that outbox on an interval, writes each capture's rendered markdown into a folder
you choose, and confirms delivery back to Riverbed so the same capture is never delivered
twice. Captures arrive exactly as your Riverbed capture template rendered them, so they
drop straight into whatever inbox workflow you already run.

## Quick start

1. Install the plugin (below).
2. Create an API token in Riverbed.
3. Paste the token into the plugin's settings and press **Test connection**.
4. Click the Riverbed wave icon in the left ribbon, or run **Riverbed: Sync now** from
   the command palette.

## Install

The plugin is not in the Obsidian community store yet. Both install routes below are
supported.

**First, in a brand new vault:** open **Settings → Community plugins** and click **Turn on
community plugins**. A fresh vault starts in Restricted Mode, where no third-party plugin
will load by either route below.

### Option A: BRAT (recommended, gets updates automatically)

[BRAT](https://github.com/TfTHacker/obsidian42-brat) installs and updates plugins straight
from a GitHub repository.

1. Install **BRAT** from Obsidian's community plugins browser and enable it.
2. This repository is **private**, so BRAT needs a GitHub personal access token to read it.
   Create one at <https://github.com/settings/tokens> with **read access to this
   repository** (a fine-grained token scoped to `nick-vogel/obsidian-riverbed` with
   *Contents: Read-only* is enough; a classic token needs the `repo` scope). Paste it into
   **Settings → BRAT → GitHub personal access token**.
   *If you were given access to a public build, skip this step.*
3. **Settings → BRAT → Add beta plugin**, and enter:

   ```
   nick-vogel/obsidian-riverbed
   ```

4. BRAT downloads the latest release and installs it. Enable **Riverbed** under
   **Settings → Community plugins**.

### Option B: manual install

1. Download `main.js` and `manifest.json` from the
   [latest release](https://github.com/nick-vogel/obsidian-riverbed/releases/latest).
   The repository is private, so that page only opens if you are signed in to GitHub with
   access to it. Without access, ask for the two files directly.
2. Create the folder `.obsidian/plugins/riverbed/` inside your vault.
3. Put both files in it. The folder must contain exactly `main.js` and `manifest.json`.
4. Restart Obsidian (or use **Settings → Community plugins → Reload plugins**), then enable
   **Riverbed**.

Manual installs do not auto-update; repeat these steps to upgrade.

## Create an API token in Riverbed

1. Sign in to Riverbed at <https://riverbedfeed.com> (or your own instance).
2. Go to **Settings → API tokens**.
3. Create a token and **copy it immediately, because it is shown once.** If you lose it, create
   another and delete the old one.

A token belongs to the instance that issued it. A token from your self-hosted instance will
not authenticate against `riverbedfeed.com`, and vice versa; the plugin reports that as an
authentication failure.

## Configure

Open **Settings → Community plugins → Riverbed**.

| Setting | What it does |
| --- | --- |
| Base URL | The Riverbed instance to sync from. Defaults to `https://riverbedfeed.com`. Change it if you self-host. |
| API token | Your outbox token, from the step above. |
| Destination folder | Vault folder captures are written to, relative to the vault root. Created if missing. Nest it with `/`, for example `research/inbox`. Leave it empty to write to the vault root. Defaults to `inbox`. |
| Sync interval | Minutes between automatic syncs. Minimum 5, maximum 35000. Defaults to 15. |
| Notifications | Whether syncs show notices. Deliveries always do; the quieter outcomes only when you triggered the sync yourself. The status bar updates either way. |
| Test connection | Checks the base URL and token. Reports success, an authentication failure, an unexpected response, or an unreachable host. |

Press **Test connection** after entering the base URL and token. It tells the failure modes
apart, so you know whether to fix the URL, the token, or your network:

- **Connected.** The URL and token are both good. When the instance also reports what is
  waiting, the notice names it: **Connected. 3 captures pending.**
- **Authentication failed, check your token.** The URL is reachable but the token is wrong,
  revoked, or issued by a different instance.
- **Unexpected response (404, 502, …).** Something is answering at that URL but it is not a
  Riverbed instance, or the path is wrong. This is the usual sign of a self-hosting
  misconfiguration: check you entered the origin only, with no trailing path, and that your
  reverse proxy routes `/app-outbox` through to the app.
- **Could not reach…** Nothing answered at that URL at all. Check the address and that the
  instance is running.

### Self-hosting

Set **Base URL** to your instance's origin, with no trailing path:

```
https://riverbed.example.com
```

A trailing slash is fine, it is trimmed. Create the token on *that* instance. The plugin
speaks only to the URL you configure and contacts nothing else.

### A note on the interval field

The interval is validated when you **leave the field**, not as you type. A value below the
minimum, or above the maximum of 35000 minutes, reverts and shows a notice once you click
away or press Tab. This is deliberate: validating per keystroke makes the field impossible
to edit normally. The default is 15 minutes.

The maximum exists because the browser timer this uses takes a 32-bit millisecond delay.
Past roughly 35,791 minutes it overflows and the timer fires continuously rather than never,
so a very large number would sync constantly instead of rarely.

### A note on the destination folder

The folder is checked when you **leave the field**, for the same reason. `/` nests, so
`research/inbox` is a valid destination and every level is created for you.

A folder that would point outside your vault is corrected rather than accepted, and the
notice tells you what was used instead. `../../notes` becomes `notes`; an absolute path like
`/Users/me/notes` becomes `Users/me/notes`. Characters your filesystem forbids become `-`,
one segment at a time, so the separators between segments survive.

Three more corrections fire the same notice, so they are worth knowing about up front:

- **A leading dot is stripped from every level.** `.archive` becomes `archive`, and
  `.obsidian/plugins` becomes `obsidian/plugins`. A folder starting with a dot is hidden
  from Obsidian, so captures written there would be invisible in your own vault.
- **Trailing dots and spaces are stripped.** Windows removes them from a folder name
  silently, so keeping them would mean the folder on disk differs from the one shown here.
- **Windows device names get a `riverbed-` prefix.** `CON` becomes `riverbed-CON`. Those
  names cannot be folders on Windows at all, and the plugin runs on mobile too, so a vault
  that syncs across platforms would otherwise fail every write into that folder.

## Use it

- **Automatic:** a sync runs when Obsidian starts and then every interval. Nothing to do.
- **Manual:** click the **Riverbed wave icon** in the left ribbon, or run **Riverbed: Sync
  now** from the command palette (`Cmd/Ctrl-P`). Both do the same thing.

The status bar (bottom right, a thin strip of small text) shows what the plugin is doing,
with the time it last changed:

| Status | Meaning |
| --- | --- |
| `Riverbed: idle (2:14:07 PM)` | Loaded, nothing synced yet this session |
| `Riverbed: not configured (…)` | The base URL or token is empty, so no sync is attempted |
| `Riverbed: syncing... (…)` | A pass is running, with no count yet (the server has not answered, or there was nothing pending) |
| `Riverbed: syncing 2 of 4 (…)` | A pass is running, two of four captures settled so far |
| `Riverbed: nothing to sync (…)` | The pass ran and the outbox was empty |
| `Riverbed: synced 3 (…)` | Three captures delivered |
| `Riverbed: 2 synced, 1 failed (…)` | Partial: the failed one stays pending in Riverbed |
| `Riverbed: sync failed (…)` | The whole pass failed, usually the network or the token |

A pass that is merely slow is meant to be distinguishable from one that is stuck, which is
why the bar changes the moment a sync starts rather than when it finishes.

### When it interrupts you

Notices are deliberately quieter than the status bar, which always updates. With
**Notifications** on:

- **Captures arrived** gets a notice however the sync was triggered. That is the thing you
  installed this for. A partial pass says so: *synced 2 captures, 1 failed.*
- **Everything else** gets a notice only when you asked for the sync yourself: nothing to
  sync, not configured, a pass that threw, and a pass where every capture failed to write.
  An automatic pass announcing "nothing to sync" every interval is how notifications end up
  turned off.

Whatever the trigger, the status bar always shows the outcome, so an automatic pass that is
failing is visible there even though it stays quiet.

### What lands in your vault

Each capture becomes one markdown file in your destination folder, named by the filename
Riverbed suggests. The file's contents are **exactly** the markdown your Riverbed capture
template produced. This plugin adds nothing and rewrites nothing, so the shape of a note is
controlled entirely by your template in Riverbed.

### Things it will not do to your notes

- **It never overwrites an existing file.** If a file with the target name already exists
  and its contents differ, the capture is written alongside it as `name-2.md`, `name-3.md`,
  and so on.
- **If the existing file is byte-identical**, nothing is written and the capture is marked
  delivered. This is what makes an interrupted sync safe to repeat.
- **It never writes outside your vault.** Filenames from the server are sanitized: path
  separators and `..` segments are stripped, and characters your filesystem forbids become
  `-`. The destination folder you type gets the same treatment, minus the separators, which
  it keeps so nesting works: a `..` segment, an absolute path, and a drive letter are all
  removed before anything is created or written.
- **A capture is only marked delivered after the file is confirmed written.** If a write
  fails, the capture stays in your Riverbed outbox, is reported there with the reason, and
  is retried on the next sync. Nothing is silently lost.

### If a sync fails

The status bar shows the failure and the plugin retries on the next interval; a failed
capture stays pending in Riverbed rather than disappearing. Common causes:

- **Not configured.** The base URL or token is empty.
- **Authentication failed.** The token was revoked or belongs to another instance. Create a
  new one and paste it in.
- **Unexpected response.** Something answered but it is not a Riverbed instance, or a proxy
  is not routing `/app-outbox` through. Usually a self-hosting misconfiguration.
- **Could not reach…** The instance is down or unreachable from this machine.

Failed captures appear in Riverbed's **Outbox** view with a **Retry** control.

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

## Development

```bash
pnpm install
pnpm dev     # esbuild watch build
pnpm build   # production bundle
pnpm test    # vitest
```

Copy `main.js` and `manifest.json` into a test vault's `.obsidian/plugins/riverbed/` to load
a local build. A dev build lowers the interval floor to 1 minute for testing; production
builds enforce 5.

## License

MIT
