---
title: Obsidian Riverbed plugin — Phase 1: scaffold + settings
status: draft
spec: ../../specs/obsidian-riverbed-v1.md
phase: 1
asana: 1216860990863548
created: 2026-07-24
updated: 2026-07-24
---

# Phase 1 — scaffold + settings

Stand up the plugin project (toolchain, manifest, clean load) and the full settings
surface with a working Test-connection button. No sync engine yet: this phase proves the
plugin builds, loads, persists configuration, and can talk to a Riverbed instance well
enough to distinguish success / bad-token / unreachable.

## AC ledger

- **Closes this phase:** 1, 2, 3, 4, 5.
- **Open for later phases:** 6, 7, 8, 9, 10, 11, 12, 13, 14, 20 (Phase 2 — sync engine);
  15, 16, 17, 18, 19 (Phase 3 — release + dogfood).

## Steps

### Step 1 — Toolchain + manifest scaffold  → closes AC 1

Build: `package.json` (pnpm, scripts `build` = esbuild production, `dev` = esbuild
watch; devDeps `obsidian`, `esbuild`, `typescript`, `@types/node`, `builtin-modules`),
`tsconfig.json` (target ES2018, module ESNext, `moduleResolution` node, strict,
`isolatedModules`, `noImplicitAny`), `esbuild.config.mjs` (entry `src/main.ts`, bundle,
format `cjs`, platform `browser`, external `obsidian`/`electron`/builtins, outfile
`main.js`; a `--production` flag toggles minify/sourcemap and injects the build-time
`IS_DEV` define — see Step 3), `manifest.json` (`id: riverbed`, `name: Riverbed`,
`version: 0.1.0`, `minAppVersion: 1.5.0`, `isDesktopOnly: false`, description, author),
`versions.json` (`{"0.1.0": "1.5.0"}`), `.gitignore` (`node_modules`, `main.js`,
`*.js.map`), and `CLAUDE.md` carrying exactly two pipeline lines plus a one-paragraph
repo description:

    Asana project: Personal
    Second brain: /Users/nick/Library/Mobile Documents/iCloud~md~obsidian/Documents/Knowsmore/personal/riverbed

Verify: `pnpm install` exits 0; `pnpm build` emits `main.js` at repo root;
`node -e "const m=require('./manifest.json'); if(m.id!=='riverbed'||!m.minAppVersion||m.version!==require('./package.json').version) process.exit(1)"`
exits 0 (id, minAppVersion present, manifest version == package version); `pnpm dev`
starts a watch build and rebuilds on a touched source file (Ctrl-C to end).

### Step 2 — Clean-loading plugin skeleton  → closes AC 2

Build: `src/main.ts` — `export default class RiverbedPlugin extends Plugin` with
`onload()`/`onunload()` that only log, for now. No settings, no network yet.

Verify: copy `main.js` + `manifest.json` into a test vault's
`.obsidian/plugins/riverbed/`, reload Obsidian, enable the plugin in Community plugins.
Open the developer console (Ctrl/Cmd-Shift-I): the load line prints and there are
**zero** errors or warnings attributable to the plugin on enable and on disable.

*(Dependency: a local Obsidian test vault. Nick has Obsidian installed; a throwaway
vault suffices. No Riverbed server needed for this step.)*

### Step 3 — Settings model, tab, and build-floor validation  → closes AC 3

Build:
- `src/settings.ts` — `interface RiverbedSettings { baseUrl, token, folder,
  intervalMinutes, notifications }` and `DEFAULT_SETTINGS` = `{ baseUrl:
  'https://riverbedfeed.com', token: '', folder: 'inbox', intervalMinutes: 15,
  notifications: true }`.
- `loadSettings()` = `Object.assign({}, DEFAULT_SETTINGS, await this.loadData())`;
  `saveSettings()` = `await this.saveData(this.settings)` (persists to
  `.obsidian/plugins/riverbed/data.json`).
- `RiverbedSettingTab extends PluginSettingTab` registered via `addSettingTab`, with a
  `Setting` control for each of the five fields: base URL (text), API token (text, its
  input `type=password`), destination folder (text), sync interval (number, minutes),
  notifications (toggle).
- Interval floor: a build-time `IS_DEV` define (esbuild `define`, `true` in `pnpm dev`,
  `false` in `pnpm build --production`) selects the floor — **5** in a production build,
  **1** in a dev build. The interval control clamps/rejects a value below the floor
  (revert + a Notice explaining the floor), so an out-of-range value never persists.

Verify: in the test vault, set all five fields to non-defaults (interval to a legal
value), fully quit and relaunch Obsidian, re-open the settings tab — all five persist.
Then set the interval below the active floor: the field rejects it (does not persist a
sub-floor value), confirmed by re-opening settings. `data.json` on disk shows the saved
values.

### Step 4 — Test-connection button  → closes AC 4

Build: `src/outboxClient.ts` with a `testConnection(baseUrl, token)` that calls
`requestUrl({ url: `${baseUrl}/app-outbox`, method: 'GET', headers: { Authorization:
`Token ${token}` }, throw: false })` (`throw:false` so a non-2xx is a value, not an
exception; a thrown error means the host is unreachable). Add a "Test connection" button
to the settings tab that maps the outcome to a distinguishable `Notice`: **200** ->
"Connected" (optionally with the pending count from `res.json.items.length`); **401** ->
"Authentication failed — check your token"; a thrown/network error -> "Could not reach
`<baseUrl>`".

Verify against the running dev stack (riverbed repo, `pnpm dev` on `:3000`, Mongo
`:27019`), with base URL set to `http://localhost:3000`:
- real token (created in the reader, Settings -> API tokens) -> "Connected";
- a garbage token -> "Authentication failed";
- stop the dev server, retry -> "Could not reach…".

*(Dependency, flagged at this step: a running local Riverbed instance on `:3000` and one
real API token. Both are on-demand — Nick starts the dev stack and creates the token in
the reader. Every check here runs against dev; no prod needed.)*

### Step 5 — README token-security section  → closes AC 5

Build: `README.md` with (at minimum for this phase) a **Security** section stating the
token is stored in plaintext at `.obsidian/plugins/riverbed/data.json` and must be
excluded from any version control the vault is under. Note that the Knowsmore vault
already gitignores `.obsidian/plugins/` (verified 2026-07-24); the warning protects other
users. (Install/usage sections are fleshed out in Phase 3, AC 17.)

Verify: the Security section exists and names the file path and the VCS-exclusion
warning.

## Traceability

| Spec AC | Proven by |
|---|---|
| 1 (build emits main.js + valid manifest, dev watch) | Step 1 gate |
| 2 (loads with zero console errors) | Step 2 gate |
| 3 (five settings persist; interval floor enforced) | Step 3 gate |
| 4 (Test-connection distinguishes success/401/unreachable) | Step 4 gate |
| 5 (README token-plaintext warning) | Step 5 gate |

## Risks

| Risk | Fallback |
|---|---|
| `minAppVersion` guess (1.5.0) is wrong for an API used | Bump to the installed Obsidian version; `requestUrl`, settings, and Vault APIs are all long-stable, so a low floor is safe. |
| esbuild `define` for `IS_DEV` doesn't thread into the bundle as expected | Fall back to reading a committed `dev` flag from `manifest.json`'s version suffix, or a hardcoded floor of 5 with a documented dev override. |
| Dev Riverbed instance not running when Step 4 is verified | Step 4 is the only server-dependent step; start the dev stack per `personal/riverbed/HANDOFF.md` "Dev stack". |

## Verification (end-to-end for the phase)

1. `pnpm install && pnpm build` -> `main.js` emitted; manifest/package versions match, id `riverbed`.
2. Plugin enables in a test vault with zero console errors.
3. All five settings persist across a full Obsidian restart; sub-floor interval rejected.
4. Test-connection shows three distinct outcomes against dev (real token / garbage / stopped server).
5. README Security section present.

## Execution log

## Review log
