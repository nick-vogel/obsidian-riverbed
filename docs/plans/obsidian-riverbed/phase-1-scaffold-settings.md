---
title: Obsidian Riverbed plugin — Phase 1: scaffold + settings
status: approved
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

Build: `package.json` (pnpm, `version: "0.1.0"`, scripts `build` = esbuild production,
`dev` = esbuild watch; devDeps `obsidian`, `esbuild`, `typescript`, `@types/node`,
`builtin-modules`), `tsconfig.json` (target ES2018, module ESNext, `moduleResolution`
node, strict, `isolatedModules`, `noImplicitAny`, `"include": ["src"]`),
`esbuild.config.mjs` (entry `src/main.ts`, bundle, format `cjs`, platform `browser`,
external `obsidian`/`electron`/builtins, outfile `main.js`; a `--production` flag toggles
minify/sourcemap and injects the build-time `IS_DEV` define — see Step 3),
`manifest.json` (`id: riverbed`, `name: Riverbed`, `version: 0.1.0`, `minAppVersion:
1.5.0`, `isDesktopOnly: false`, description, author), `versions.json` (`{"0.1.0":
"1.5.0"}`), `.gitignore` (append `node_modules`, `main.js`, `*.js.map` to the existing
file — do not overwrite; it already excludes `.pipeline-loop-logs/`), and `CLAUDE.md`
carrying exactly two pipeline lines plus a one-paragraph repo description:

    Asana project: Personal
    Second brain: /Users/nick/Library/Mobile Documents/iCloud~md~obsidian/Documents/Knowsmore/personal/riverbed

Also build `src/global.d.ts` — `declare const IS_DEV: boolean;` — the ambient
declaration the bare `IS_DEV` identifier needs to type-check under this file's `strict` +
`noImplicitAny` tsconfig; esbuild's `define` performs a textual substitution at bundle
time only and does not by itself satisfy the type checker. And a minimal placeholder
`src/main.ts` — `import { Plugin } from 'obsidian'; export default class RiverbedPlugin
extends Plugin {}` — so `esbuild.config.mjs`'s entry point resolves and this step's
build/watch gates are achievable; Step 2 upgrades this same file into the full skeleton
with `onload()`/`onunload()`.

Verify: `pnpm install` exits 0; `pnpm build` emits `main.js` at repo root;
`node -e "const m=require('./manifest.json'); if(m.id!=='riverbed'||!m.minAppVersion||m.version!==require('./package.json').version) process.exit(1)"`
exits 0 (id, minAppVersion present, manifest version == package version); `pnpm dev`
starts a watch build and rebuilds on a touch of `src/main.ts` (Ctrl-C to end). (`IS_DEV`
is not yet referenced by any source file at this step — `src/global.d.ts` type-checks
trivially on its own either way, so the meaningful `IS_DEV`-under-`strict` check is
deferred to Step 3, where `main.ts` starts referencing it to compute the interval floor.)

### Step 2 — Clean-loading plugin skeleton  → closes AC 2

Build: extend Step 1's placeholder `src/main.ts` — `export default class RiverbedPlugin
extends Plugin` gains `onload()`/`onunload()` that only log, for now. No settings, no
network yet.

Verify: copy `main.js` + `manifest.json` into a test vault's
`.obsidian/plugins/riverbed/`, reload Obsidian, enable the plugin in Community plugins.
Open the developer console (Ctrl/Cmd-Shift-I): the load line prints and there are
**zero** errors or warnings attributable to the plugin on enable and on disable.

*(Dependency: a local Obsidian test vault. Nick has Obsidian installed; a throwaway
vault suffices. No Riverbed server needed for this step.)*

### Step 3 — Settings model, tab, and build-floor validation  → closes AC 3

Build:
- `src/settings.ts` — `interface RiverbedSettings { baseUrl, token, folder,
  intervalMinutes, notifications }`; `DEFAULT_SETTINGS` = `{ baseUrl:
  'https://riverbedfeed.com', token: '', folder: 'inbox', intervalMinutes: 15,
  notifications: true }`; and a pure, exported `clampInterval(loaded: number, floor:
  number): number` = `Math.max(loaded, floor)`. This file imports nothing from
  `obsidian` — kept deliberately free of it so its logic is independently bundleable and
  headlessly testable (see Verify).
- `src/settingsTab.ts` — `RiverbedSettingTab extends PluginSettingTab` (imports
  `obsidian`), registered via `addSettingTab`, with a `Setting` control for each of the
  five fields: base URL (text), API token (text, its input `type=password`), destination
  folder (text), sync interval (number, minutes), notifications (toggle).
- In `main.ts`: `loadSettings()` = `Object.assign({}, DEFAULT_SETTINGS, await
  this.loadData())`, then reassigns `settings.intervalMinutes =
  clampInterval(settings.intervalMinutes, floor)` before assigning to `this.settings` —
  required in addition to the settings-tab control, because a value persisted under a dev
  build's floor (1) must not silently run sub-floor after the same `data.json` is loaded
  under a later production build (floor 5); `saveSettings()` = `await
  this.saveData(this.settings)` (persists to `.obsidian/plugins/riverbed/data.json`).
- Interval floor: a build-time `IS_DEV` define (esbuild `define`, `true` in `pnpm dev`,
  `false` in `pnpm build --production`), referenced in `main.ts` to compute `floor = IS_DEV
  ? 1 : 5`, passed into both `loadSettings()`'s clamp and the settings-tab control's
  reject-below-floor check (revert + a Notice explaining the floor), so an out-of-range
  value never persists in either path.

Verify: in the test vault, set all five fields to non-defaults (interval to a legal
value), fully quit and relaunch Obsidian, re-open the settings tab — all five persist.
Then set the interval below the active floor: the field rejects it (does not persist a
sub-floor value), confirmed by re-opening settings. `data.json` on disk shows the saved
values. Separately, headless (no Obsidian needed, since `settings.ts` has no `obsidian`
import): `pnpm exec esbuild src/settings.ts --bundle --platform=node --format=cjs
--outfile=/tmp/settings.js` then `node -e "const {clampInterval}=require('/tmp/settings.js');
if (clampInterval(1, 5) !== 5 || clampInterval(7, 5) !== 7) process.exit(1)"` exits 0
(clamps a sub-floor value up, leaves an already-legal value untouched). Also, now that
`main.ts` genuinely references `IS_DEV`: `pnpm exec tsc --noEmit` exits 0, confirming
`src/global.d.ts`'s ambient declaration resolves the reference under `strict` +
`noImplicitAny`.

### Step 4 — Test-connection button  → closes AC 4

Build: `src/outboxClient.ts` with a `testConnection(baseUrl, token)` that first
normalizes `baseUrl` by stripping any trailing slash (`baseUrl.replace(/\/+$/, '')`) so a
self-hosted URL entered with a trailing `/` — a plain, expected input, not an edge case —
doesn't produce a double-slashed `.../app-outbox` path, then calls `requestUrl({ url:
`${normalizedBaseUrl}/app-outbox`, method: 'GET', headers: { Authorization: `Token
${token}` }, throw: false })` (`throw:false` so a non-2xx is a value, not an exception; a
thrown error means the host is unreachable). Add a "Test connection" button to the
settings tab that maps the outcome to a distinguishable `Notice`: **200** -> "Connected"
(optionally with the pending count from `res.json.items.length`); **401** ->
"Authentication failed — check your token"; **any other status** (404/500/etc., not
contract-defined for this route but must not be silently swallowed) -> "Unexpected
response (`<status>`) from `<baseUrl>`"; a thrown/network error -> "Could not reach
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
| esbuild `define` for `IS_DEV` doesn't thread into the bundle as expected | Fall back to a hardcoded floor of 5 with a documented dev override (not: reading a flag from `manifest.json`'s version suffix — that would break Step 1's own version-equality gate, which requires `manifest.json` version == `package.json` version exactly). |
| Dev Riverbed instance not running when Step 4 is verified | Step 4 is the only server-dependent step; start the dev stack per `personal/riverbed/HANDOFF.md` "Dev stack". |

## Verification (end-to-end for the phase)

1. `pnpm install && pnpm build` -> `main.js` emitted; manifest/package versions match, id `riverbed`.
2. Plugin enables in a test vault with zero console errors.
3. All five settings persist across a full Obsidian restart; sub-floor interval rejected.
4. Test-connection shows three distinct outcomes against dev (real token / garbage / stopped server).
5. README Security section present.

## Execution log

**2026-07-24 — implemented in an unattended headless run** (authorized in `docs/HANDOFF.md`,
"Continuous-mode authorization"). All five steps' CODE is written. The headless-verifiable
gates were run for real and their evidence is below; the GUI/server gates (Steps 2, 3, 4)
are **deferred to manual verification** and are explicitly NOT claimed as passed — a
headless process cannot drive Obsidian's GUI, and cannot create a Riverbed API token.

### Step 1 — toolchain + manifest scaffold → AC 1 — **PASSED (headless)**

Built: `package.json` (v0.1.0, `build`/`dev` scripts, devDeps `obsidian`, `esbuild`,
`typescript`, `@types/node`, `builtin-modules`), `tsconfig.json`, `esbuild.config.mjs`,
`manifest.json`, `versions.json`, `.gitignore` (appended, not overwritten),
`src/global.d.ts`, placeholder `src/main.ts`, `CLAUDE.md` (both pipeline lines).

    $ pnpm install                       # after rm -rf node_modules, clean
    .../esbuild@0.24.2/node_modules/esbuild postinstall: Done
    Done in 790ms using pnpm v10.13.1
    $ pnpm build
    $ ls -la main.js
    -rw-r--r--  1 nick  staff  650 Jul 24 14:37 main.js
    $ node -e "const m=require('./manifest.json'); if(m.id!=='riverbed'||!m.minAppVersion||m.version!==require('./package.json').version) process.exit(1)"
    MANIFEST_CHECK_EXIT=0

`pnpm dev` watch gate — started the watcher, appended a line to `src/main.ts`, then
restored the file, capturing the watcher's own log:

    [watch] build finished, watching for changes...
    [watch] build started (change: "src/main.ts")
    [watch] build finished
    [watch] build started (change: "src/main.ts")
    [watch] build finished

**Deviation (mechanical, gate-driven):** pnpm 10.13 ignores dependency build scripts by
default, which suppresses esbuild's postinstall binary fetch. Added
`pnpm-workspace.yaml` with `onlyBuiltDependencies: [esbuild]` (pnpm 10 reads it there, not
from `package.json`) and re-verified the gate from a clean `node_modules`. Not a plan
change; the plan's gate is what surfaced it.

### Step 2 — clean-loading plugin skeleton → AC 2 — **CODE WRITTEN, GATE DEFERRED (manual)**

`src/main.ts` extends the Step 1 placeholder: `onload()` loads settings, registers the
setting tab, and logs `Riverbed: loaded (sync interval floor N min)`; `onunload()` logs
`Riverbed: unloaded`. Compiles and bundles clean (see Step 3's `tsc` evidence).

**Not verified:** the gate is "enable in a test vault, zero console errors on enable and
disable" — an Obsidian GUI action. Requires a human. See the handoff's manual-gate list.

### Step 3 — settings model, tab, build-floor validation → AC 3 — **HEADLESS HALF PASSED, GUI HALF DEFERRED**

Built `src/settings.ts` (pure, zero `obsidian` imports: `RiverbedSettings`,
`DEFAULT_SETTINGS`, `PROD_INTERVAL_FLOOR`/`DEV_INTERVAL_FLOOR`, `clampInterval`) and
`src/settingsTab.ts` (`RiverbedSettingTab`, all five controls + the token input forced to
`type=password`). `loadSettings()` in `main.ts` clamps `intervalMinutes` on load as well as
in the control.

Headless gate — the pure clamp, bundled standalone and invoked from plain node:

    $ pnpm exec esbuild src/settings.ts --bundle --platform=node --format=cjs --outfile=/tmp/settings.js
      /tmp/settings.js  1.6kb
    $ node -e "const {clampInterval}=require('/tmp/settings.js'); if (clampInterval(1,5)!==5 || clampInterval(7,5)!==7) process.exit(1); ..."
    clampInterval(1,5)=5 clampInterval(7,5)=7 clampInterval(NaN,5)=15 clampInterval(3,1)=3
    CLAMP_EXIT=0

Headless gate — `IS_DEV` under `strict`, now that `main.ts` genuinely references it
(`src/main.ts:19`):

    $ pnpm exec tsc --noEmit
    TSC_EXIT=0

**Deviation (mechanical, gate-driven):** the first `tsc --noEmit` run failed with three
`TS2420` errors, ALL inside `node_modules/obsidian@1.13.1/obsidian.d.ts` (upstream declares
`HistoryHandler.onHistoryBack` as required, but `Menu`/`Modal`/`PopoverSuggest` do not
implement it) and ZERO in `src/` — confirmed by filtering the output on `^src/`. Fixed with
`"skipLibCheck": true` in `tsconfig.json`, the standard setting for exactly this: the gate
is meant to type-check our source, not a dependency's shipped declarations. Our code
type-checks under full `strict` + `noImplicitAny` either way.

Extra evidence beyond the plan's gate — the `IS_DEV` define genuinely selects the floor
(this closes the plan's "define doesn't thread into the bundle" risk row with a real check
rather than an assumption):

    $ esbuild src/main.ts --bundle --define:IS_DEV=false ... ; grep "intervalFloor = "
    this.intervalFloor = false ? DEV_INTERVAL_FLOOR : PROD_INTERVAL_FLOOR;   # prod -> 5
    $ esbuild src/main.ts --bundle --define:IS_DEV=true  ... ; grep "intervalFloor = "
    this.intervalFloor = true ? DEV_INTERVAL_FLOOR : PROD_INTERVAL_FLOOR;    # dev  -> 1

And the production bundle contains no unsubstituted identifier: `IS_DEV occurrences in
bundle: 0`.

**Not verified:** "set all five fields, fully quit and relaunch Obsidian, all five persist;
the interval field rejects a sub-floor value; `data.json` on disk shows the saved values" —
all Obsidian GUI actions. Requires a human.

**Implementation note (advisory folded in):** the review carried a `NaN`-on-blank-interval
advisory across all four rounds as deferred. It cost two lines to close, so it is closed
rather than left latent: `clampInterval` falls back to the default interval on a
non-finite input, and the settings control rejects a non-finite value the same way it
rejects a sub-floor one. The plan's stated gate assertions are unchanged and still pass.

### Step 4 — Test-connection button → AC 4 — **CODE WRITTEN, GATE DEFERRED (manual + dev server)**

Built `src/outboxClient.ts`: `normalizeBaseUrl()` (trims, strips trailing slashes) and
`testConnection()` calling `requestUrl({ url: '<base>/app-outbox', method: 'GET', headers:
{ Authorization: 'Token <token>' }, throw: false })`, returning a discriminated
`TestConnectionResult`. The settings-tab button maps it to four distinguishable Notices:
200 → "connected" (with the pending count when the payload has one), 401 → "authentication
failed, check your token", any other status → "unexpected response (N) from <base>", a
thrown error → "could not reach <base>". Verified against the contract in the `riverbed`
repo's `docs/outbox-api.md`: `Token` scheme (not Bearer/JWT), `GET /app-outbox` → `{ok,
items[]}`, 401 for a bad or revoked token, and no 403 from this route.

**Not verified:** the gate needs a running dev stack on `:3000` AND a real API token
created in the reader's GUI. A headless run can create neither. Requires a human.

### Step 5 — README token-security section → AC 5 — **PASSED (headless)**

`README.md` carries a `## Security` section naming the exact plaintext path and the
VCS-exclusion warning, plus token scope and revocation.

    README_SECURITY_GATE=pass
    (asserts: "## Security" heading, the literal ".obsidian/plugins/riverbed/data.json"
     path, and a version-control exclusion warning are all present)

### Phase-1 status

- **Closed by real headless evidence:** AC 1, AC 5.
- **Code complete, gate pending a human:** AC 2, AC 3 (GUI half), AC 4.
- Phase 1's Asana subtask `1216860990863548` stays OPEN: a phase closes on a clean
  review of *verified* work, and three of its five gates are unverified.

## Review log

- 2026-07-24 — changes requested — 3 blocking / 6 advisory (pinned Sonnet subagent).
  Blocking, all mechanical (no Nick judgment needed), fixed same pass per the standing
  autonomous-run authorization: (1) Step 3's interval floor was only enforced in the
  settings-tab control, not on `loadSettings()`, so a dev-persisted sub-floor value would
  load unclamped under a later production build — fixed by clamping in `loadSettings()`
  itself, with a headless load-time gate added. (2) `IS_DEV` was used as a bare
  identifier with no ambient declaration, illegal under this file's `strict` +
  `noImplicitAny` tsconfig — fixed by adding `src/global.d.ts` as a Step 1 deliverable
  plus a `tsc --noEmit` gate. (3) Step 4's Notice mapping only covered 200/401 with no
  catch-all for other statuses, and no `baseUrl` trailing-slash normalization despite the
  spec's self-hosted-URL story making a trailing slash a plausible real input — fixed
  with a catch-all Notice branch and explicit trailing-slash stripping. Advisories not
  folded (non-blocking, noted for awareness): NaN-on-blank interval input, unstripped
  token whitespace, malformed-JSON-on-200 mislabeling a reachable host as unreachable,
  `.gitignore` append-not-overwrite in Step 1, a self-contradicting sub-option in the
  `IS_DEV` risk fallback (dropped: reading a dev flag from `manifest.json`'s version
  suffix would break Step 1's own version-equality gate), no stance on rapid
  double-click/repeat interactions (low risk — `requestUrl` GETs are side-effect-free,
  JS is single-threaded).
- 2026-07-24 — changes requested — 2 blocking / 5 advisory (pinned Sonnet subagent,
  round 2, re-verified the round-1 fixes rather than trusting the log). Blocking, both
  mechanical, fixed same pass: (1) the round-1 `tsc --noEmit`/`IS_DEV` gate was placed in
  Step 1, before any source file actually referenced `IS_DEV` — an ambient `.d.ts`
  type-checks trivially on its own, so the gate proved nothing and was never re-run once
  `IS_DEV` had a real usage site — fixed by moving the meaningful typecheck to Step 3
  (after `main.ts` references `IS_DEV` to compute the floor) and rewording Step 1's gate
  to not claim it validates `IS_DEV` resolution. (2) The "headless" clamp gate called
  `loadSettings()` directly, but that method lives on a `Plugin` subclass depending on
  Obsidian's runtime (`this.app`, `this.loadData()`) with no mock/harness specified — not
  actually headless as written — fixed by extracting a pure, `obsidian`-import-free
  `clampInterval(loaded, floor)` into `settings.ts` (split from a new `settingsTab.ts`
  carrying the `obsidian`-dependent `RiverbedSettingTab`), gated by an isolated
  `esbuild --platform=node` bundle + plain `node -e` invocation. Advisories carried
  (non-blocking, independently re-checked, judged still non-blocking): `NaN`-on-blank
  interval input (now noted needs an explicit `Number.isFinite` guard in both the UI
  control and the `clampInterval` call site), `.gitignore` append-vs-overwrite ambiguity,
  malformed-JSON-on-200 mislabeling, unstripped token whitespace, no doc citation for
  `TextComponent.inputEl`/`requestUrl` shapes (independently confirmed accurate against
  the real Obsidian API, so hygiene-only).
- 2026-07-24 — changes requested — 1 blocking / 5 advisory (pinned Sonnet subagent,
  round 3, re-verified rounds 1-2's fixes rather than trusting the log — both held).
  Blocking, mechanical, fixed same pass: Step 1's gate required `pnpm build` to emit
  `main.js`, but `src/main.ts` (esbuild's entry point) wasn't created until Step 2 — a
  pre-existing sequencing gap from the original draft that rounds 1-2 hadn't caught —
  fixed by adding a minimal placeholder `src/main.ts` (`extends Plugin {}`, no overrides)
  to Step 1's Build list so the entry resolves and the build/watch gates are achievable;
  Step 2 now explicitly extends that same file rather than creating it fresh. Advisories
  folded (mechanical, low-cost): stale "settings.ts" reference in Step 1's `IS_DEV`
  parenthetical corrected to "main.ts"; `package.json`'s `version: "0.1.0"` made
  explicit; `tsconfig.json` given an explicit `"include": ["src"]`; `.gitignore`
  instruction reworded to "append... do not overwrite" (closes a round-1 advisory too).
  Not folded (carried, non-blocking): `NaN`-on-blank-interval-input guard (fourth round
  carried — genuinely not exercised by any of this phase's gates, deferred rather than
  scope-crept in again); unstated wiring detail for how `settingsTab.ts` obtains `floor`
  (either constructor-passed or independently computed both work, no divergent
  behavior).
- 2026-07-24 — approved — 0 blocking / 2 advisory (round 4, pinned Sonnet subagent,
  independently re-verified rounds 1-3's fixes rather than trusting the log, including a
  live check of the actual upstream `obsidian.d.ts`: `Component`/`Plugin`'s `onload`/
  `onunload` are concrete `@virtual`-tagged methods, not TS `abstract` members, so
  round 3's zero-override placeholder `src/main.ts` type-checks under `strict` as
  claimed). Confirmed present and coherent: `package.json` `version: "0.1.0"`,
  `tsconfig.json` `"include": ["src"]`, the `.gitignore` append-not-overwrite wording,
  the `main.ts` (not `settings.ts`) `IS_DEV` reference, and Step 1→Step 2's `main.ts`
  hand-off. AC ledger and Traceability cross-checked clean against the spec and both
  sibling phase files; Step 4's `outboxClient.ts` behavior matches `outbox-api.md`
  exactly. No blocking findings. Advisories (not folded, non-blocking): Step 3 never
  explicitly states where `addSettingTab` is called from `onload()` (only one sensible
  site, forced by the gate itself); the three advisories carried since round 1 (`NaN` on
  blank interval input, unstripped token whitespace, malformed-JSON-on-200 mislabeling)
  remain accurate and still correctly deferred.
