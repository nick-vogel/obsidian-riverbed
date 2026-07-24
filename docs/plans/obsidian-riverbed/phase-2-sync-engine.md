---
title: Obsidian Riverbed plugin — Phase 2: sync engine
status: approved
spec: ../../specs/obsidian-riverbed-v1.md
phase: 2
asana: 1216860831880593
created: 2026-07-24
updated: 2026-07-24
---

# Phase 2 — sync engine

The core of the plugin: pull the outbox, write each entry verbatim, ack only after a
confirmed write, report failures, handle collisions/sanitization/folder-creation, run
automatically on a single-flight interval, and surface status without a console. Builds
on Phase 1's outbox client and settings.

## AC ledger

- **Closes this phase:** 6, 7, 8, 9, 10, 11, 12, 13, 14, 20.
- **Already closed:** 1, 2, 3, 4, 5 (Phase 1).
- **Open for later phases:** 15, 16, 17, 18, 19 (Phase 3 — release + dogfood).

## Steps

The sync pass is one function, `runSync()`, built up across steps 1-8. Each step adds one
behavior and its gate; the order is chosen so every gate is checkable on what exists so
far. Integration gates run against the local dev stack (`:3000`, Mongo `:27019`); the
pure-logic gates run headlessly via Step 0's test harness.

**Two kinds of gate, both required.** Every step below whose logic is pure (sanitization,
dedupe/suffix resolution, the single-flight guard, ack-vs-error ordering) carries BOTH a
`pnpm test` unit gate that runs headlessly against fake doubles AND its live-server
integration gate. The unit gate is not a substitute for the integration gate: it proves the
algorithm, the integration gate proves the wiring. This mirrors Phase 1's `settings.ts`
split, which kept `clampInterval` `obsidian`-import-free precisely so it could be checked
without Obsidian running.

### Step 0 — Headless test harness  → closes no AC (enables the pure-logic gates below)

Build: add `vitest` as a devDependency and a `"test": "vitest run"` script to
`package.json`. Add `src/sync/` for the phase's pure logic, kept free of any `obsidian`
import exactly as `src/settings.ts` is, and `tests/` for the specs. Define the two fake
doubles every later test uses:

- a **fake vault** — an in-memory `Map<string, string>` behind the narrow interface
  `runSync()` actually needs (`exists(path)`, `read(path)`, `create(path, contents)`,
  `createFolder(path)`), where `create` on an existing path throws the way Obsidian's does;
- a **fake outbox client** — stubs `getPending()` (returns a settable list of pending
  entries, or throws when told to) and records every `ack(id)` / `reportError(id, reason)`
  call in order, with either callable set to fail on command, so ordering assertions ("no
  ack was recorded for the entry whose write threw") are checkable.

The plugin's `runSync()` takes these two as an injected dependency rather than reaching for
`this.app.vault` directly, so the real path and the test path exercise the same code.
**Every later step's Build prose that touches the vault (Steps 4 and 5) must call through
this same narrow interface** (`vault.exists(path)`, `vault.read(path)`,
`vault.createFolder(path)`) — never the raw Obsidian `Vault` methods — so the code under
test in Step 0's unit gates is the same code the live plugin runs. The production adapter
(wired in `main.ts`, not part of the injected interface) implements `exists(path)` as
`this.app.vault.getAbstractFileByPath(path) !== null` and `read(path)` as
`this.app.vault.read(this.app.vault.getAbstractFileByPath(path) as TFile)`.

Verify: `pnpm test` exits 0 with at least one passing placeholder spec, and `pnpm exec tsc
--noEmit` still exits 0 (the harness must not break Phase 1's typecheck gate).

### Step 1 — `Sync now` writes pending entries verbatim  → closes AC 6

Build: extend `src/outboxClient.ts` with `getPending(baseUrl, token): Promise<OutboxItem[]>`
(GET `/app-outbox`, `Token` auth, returns `res.json.items`). Route the base URL through the
existing `normalizeBaseUrl` helper (already used by `testConnection`), the same way, so a
self-hosted instance's trailing slash doesn't double up into `//app-outbox` — do the same
for the `ack`/`reportError` endpoints added in Steps 2-3. **Error contract:** unlike
`testConnection` (which classifies outcomes and never throws), `getPending` THROWS on a
non-2xx or an unreachable host — it is called inside a pass whose whole-pass catch (Step 8)
is what turns a failure into a visible status. Do not pass `throw: false` here. Add
`runSync()` that fetches pending and, for each entry, writes `renderedMarkdown` to
`<folder>/<suggestedFilename>` via `vault.create(path, renderedMarkdown)`. Register the
command `Riverbed: Sync now` (`addCommand`) calling `runSync()`.

Verify: seed N pending saves on dev; `curl -s localhost:3000/app-outbox -H "Authorization:
Token $T" > pre.json`; run `Sync now`; the destination folder holds N files, and for
**every** entry `i`, `diff <(jq -r ".items[$i].renderedMarkdown" pre.json) "<folder>/<filename_i>"`
is empty (verbatim, all N).

### Step 2 — Ack after a confirmed write  → closes AC 7

Build: add `ack(id)` (POST `/app-outbox/:id/ack`, `Token`) to the client; in `runSync()`
call it **after** each successful `vault.create`.

Verify: after the Step 1 sync, `curl` GET `/app-outbox` returns `{"items":[]}`; running
`Sync now` again creates no new files (nothing pending).

### Step 3 — Ack-only-on-write + error reporting  → closes AC 8

Build: add `reportError(id, reason)` (POST `/app-outbox/:id/error` with `{reason}`).

**The try/catch wraps ONLY the vault write — not the ack.** Three distinct outcomes, and
conflating any two of them ships a defect:

- *write succeeded, ack succeeded* — done.
- *write FAILED* -> `reportError(id, <message>)`, do **not** ack, leave it pending for the
  next pass.
- *write succeeded but the `ack` call itself failed* (network dropped, or the app quit
  between the two) -> do **not** call `reportError`. The file is safely in the vault;
  nothing is broken and the user must not see a spurious failed-with-Retry entry in the
  reader's Outbox view. The entry simply stays pending and the next pass's identical-bytes
  dedupe (Step 5) recognises the already-written file and acks it then. This is exactly the
  recovery `outbox-api.md` prescribes ("it is always safe to ack the same id more than
  once"; ack is idempotent) and it is why AC 9's identical-bytes branch exists.

If `reportError` itself fails, swallow it (log at most): it is a user-visible signal, not a
delivery mechanism, and the entry is already correctly left pending for retry. A failed
error-report must never abort the pass or prevent the remaining entries from delivering.

Add a dev-only fault injection (guarded by `IS_DEV`, e.g. a settings-hidden "fail next
write" flag or a filename sentinel) so a single entry's write can be forced to throw;
document the method in a code comment.

Verify (unit, headless): `pnpm test` covers the three outcomes above against the fake
doubles — (a) write throws -> `reportError` recorded, **no** `ack` recorded for that id;
(b) write succeeds but the fake client's `ack` throws -> **no** `reportError` recorded for
that id, and the pass continues; (c) `reportError` itself throws -> the pass still
delivers the remaining entries. Plus (integration, live dev stack):
failed entry (a) still appears in `GET /app-outbox` (not acked); (b) its
`POST /app-outbox/:id/error` returned 200 and the reader's **Outbox view** shows that
entry as failed with a Retry affordance (the plugin never reads the reason back — there is
no such field on GET); the other entries delivered and acked. Remove the fault, run
`Sync now` -> the previously-failed entry is now written and acked.

### Step 4 — Folder auto-create + filename sanitization  → closes AC 10, AC 12

Build: before writing, ensure `<folder>` exists via the injected interface — `vault.exists(folder)`; if
absent, `vault.createFolder(folder)` (guard the already-exists throw). Add
`sanitizeFilename(name)` **in `src/sync/` with no `obsidian` import** (so Step 0's harness
can test it): replace characters Obsidian forbids (`* " \ / < > : | ?` and control chars)
with `-`, AND strip any path separator (`/`, `\`) and `..` segment so the result is a bare
filename that cannot escape `<folder>` (defense in depth; the contract promises a plain
filename but a buggy/hostile server must not cause traversal). Degenerate inputs get a
documented stance rather than undefined behavior: a name that sanitizes to empty (or to
only dots/whitespace) falls back to a generated `riverbed-capture-<id>.md`; a name with no
`.md` extension gets one appended; a leading dot is stripped so the note is not hidden.
Use the sanitized name for both the write path and the dedupe key (Step 5).

Verify (unit, headless): `pnpm test` asserts `sanitizeFilename` on — a forbidden char, a
`../` prefix, a `foo/bar.md` separator, an all-dots name, an empty result, a name without
an extension, and a leading dot — with every output asserted to contain no `/`, no `\`, no
`..` segment, to be non-empty, and to end in `.md`. Plus (integration): delete `<folder>`,
run `Sync now` -> folder is created and files land in it.
Craft a dev entry whose `suggestedFilename` contains a forbidden char and a `../` prefix
(custom capture template) -> after sync the file exists **inside** `<folder>` with a
safe, separator-free name; nothing is written outside the folder.

### Step 5 — Collision-safe dedupe  → closes AC 9

Build: extract the resolution as a pure function in `src/sync/` (no `obsidian` import) so
Step 0's harness can drive it: given the sanitized target path, the entry's
`renderedMarkdown`, and the fake/real vault's `exists`/`read`, it returns one of
`{action: 'skip-and-ack', path}` / `{action: 'write', path}`. In `runSync()`, before
writing, check `vault.exists(path)` (the injected interface — see Step 0). If a file
exists there: read it via `vault.read(path)` (the production adapter backs this with
Obsidian's `vault.read`, not `cachedRead` — the comparison must see current disk contents,
not a cache) and compare bytes to `renderedMarkdown`. **Identical** -> skip the write, `ack(id)` (safe
crash-between-write-and-ack recovery — the same path that absorbs a failed ack per Step 3).
**Different** -> iterate `name-2.md`, `name-3.md`, … : skip any suffixed slot that exists
with *different* bytes, reuse-without-writing any suffixed slot that exists with *identical*
bytes (then ack), else write the first free slot and ack. **The iteration is bounded** at
100 attempts; on exhaustion the entry is treated as a write failure (`reportError`, no ack)
rather than looping, so a pathological folder can never hang a pass.

Verify (unit, headless): `pnpm test` drives the pure resolver against the fake vault for —
target free; target identical; target different (-> `name-2.md`); target and `name-2.md`
both different (-> `name-3.md`); `name-2.md` identical (-> reuse, no write); and 100
occupied slots (-> the bounded-exhaustion failure, no infinite loop). Plus (integration):
pre-create three cases in `<folder>` before a sync of matching entries — (a) a
file at the target name with identical bytes -> no new file, entry acked; (b) at the
target name with different bytes -> new `name-2.md` written, entry acked; (c) both target
and `name-2.md` occupied with different bytes -> `name-3.md` written. Inspect folder +
`GET /app-outbox` (empty) after.

### Step 6 — Single-flight lock  → closes AC 20

Build: guard `runSync()` with a re-entrancy flag (a `private syncing = false` or an
in-flight promise). A call while a pass is running is skipped or coalesced, never run
concurrently. **The flag is released in a `finally`** (or `.finally()` on the coalescing
promise) covering the WHOLE pass, including the fetch — not only the happy path. Without
that, any throw before Step 8's whole-pass catch exists (a failed `getPending()`, say)
wedges the flag `true` forever and every later tick and every later `Sync now` silently
no-ops with no error and no symptom other than sync quietly never running again. That
silent-death mode is precisely what AC 13 exists to prevent, so it gets its own gate rather
than riding on Step 8.

Verify (unit, headless): `pnpm test` — (a) two overlapping `runSync()` calls against a
deliberately slow fake write produce exactly one pass's worth of writes and one set of acks;
(b) **lock-release-on-throw:** a pass whose fake `getPending` throws leaves the guard
released, so an immediately following `runSync()` call runs a real pass (this is the
regression test for the wedged-lock failure above). Plus (integration): with several entries
pending and an artificially slowed write (dev flag), trigger `Sync now` twice in immediate
succession -> exactly N files, **no** spurious `-2` suffixes, and the log shows a single
pass (the second call short-circuits).

### Step 7 — Auto-sync on startup + interval  → closes AC 11

Build: in `onload()`, call `runSync()` once (startup), and
`registerInterval(window.setInterval(() => runSync(), intervalMinutes * 60_000))` so it
auto-clears on unload.

**Rescheduling wiring, stated explicitly** (nothing in Phase 1's `settingsTab.ts` calls back
into the plugin today — its `intervalMinutes` `onChange` only calls `saveSettings()`, so
this connection has to be built, not assumed): `main.ts` stores the interval id in a field
and exposes `rescheduleSync()` which `window.clearInterval`s the stored id **before**
registering a new one, then stores the new id. `settingsTab.ts`'s interval `onChange` calls
`plugin.rescheduleSync()` after `saveSettings()`. Clearing first is what keeps a settings
edit from leaking the old timer and leaving two passes firing per tick.

Verify: set the interval to the dev floor (1 min), make a save in the reader, start a
stopwatch -> the file appears in the vault within one interval + 30s slack with no manual
command. Then, in the same session, change the interval setting to 2 minutes and watch two
further ticks: **exactly one** pass fires per tick in the log (not two), proving the old
timer was cleared rather than leaked.

### Step 8 — Non-fatal failure, recovery, and status feedback  → closes AC 13, AC 14

Build: wrap a whole pass so a network failure (server down) is caught, never throwing
uncaught. Add a status-bar item (`addStatusBarItem`) showing the last sync outcome +
time. On a pass that delivered >0 entries, show a "Synced N" `Notice` **only** when the
notifications setting is on; the status bar updates regardless.

Verify: (a) stop the dev server, wait for a scheduled sync -> a visible failed status
(status bar and/or Notice), zero uncaught console errors; restart the server -> the next
scheduled sync succeeds (across two intervals). (b) Toggle notifications off then on
across two delivering syncs -> Notice appears only when on; status bar shows outcome +
time in both cases.

## Traceability

| Spec AC | Proven by |
|---|---|
| 6 (N files, all verbatim) | Step 1 gate |
| 7 (every entry acked; re-sync no-op) | Step 2 gate |
| 8 (ack-only-on-write; error POST + reader Outbox; retry) | Step 3 gate (unit: ordering; integration: reader Outbox) |
| 9 (collision dedupe, identical/different/suffix-iterate) | Step 5 gate (unit: resolver; integration: live folder) |
| 10 (sanitize forbidden chars + strip separators/..) | Step 4 gate (unit: sanitizer; integration: crafted entry) |
| 11 (auto-sync startup + interval timing) | Step 7 gate |
| 12 (missing folder created) | Step 4 gate |
| 13 (non-fatal failure + recovery) | Step 8 gate (a) |
| 14 (Notice gated on toggle; status bar always) | Step 8 gate (b) |
| 20 (single-flight lock) | Step 6 gate (unit: overlap + release-on-throw; integration: double `Sync now`) |
| — (no AC; enables the unit gates above) | Step 0 gate |

## Risks

| Risk | Fallback |
|---|---|
| `vault.read` byte-comparison mismatches on trailing-newline normalization | Compare against the exact `renderedMarkdown` string; if Obsidian normalizes on write, document the normalization and compare post-normalization consistently (dedupe stays correct as long as the same transform is applied both sides). |
| Dev fault-injection is awkward to wire without leaking into prod builds | Gate strictly behind `IS_DEV`; a filename sentinel (e.g. a magic substring only used in a crafted dev entry) keeps prod paths untouched. |
| `registerInterval` re-registration on settings change leaks timers | Clear the prior interval id before registering a new one; verify only one pass fires per interval in Step 7's log. |
| A write succeeds but its ack never lands (network drop, app quit between the two) | Not treated as an error: the entry stays pending and the next pass's identical-bytes dedupe (Step 5) acks it. Never `reportError` for an ack-transport failure — that would show the user a broken capture that is actually safely in the vault. |
| The single-flight flag is left set by a throw, silently killing all future syncs | Release in a `finally` over the whole pass; Step 6's unit gate (b) is the regression test for exactly this. |
| A settings edit leaks the old interval timer, double-firing every tick | `rescheduleSync()` clears the stored id before registering a new one; Step 7's gate watches two ticks after an interval change and requires exactly one pass each. |
| Reader Outbox view state for AC 8 depends on reader UI being present | The failed-state/Retry surface is the reader's; if unavailable at verify time, fall back to confirming the entry is non-acked in `GET /app-outbox` and the error POST returned 200 (the two client-observable halves). |

## Verification (end-to-end for the phase)

0. `pnpm test` exits 0 — the pure-logic suite (sanitization, dedupe/suffix resolution,
   single-flight incl. release-on-throw, ack-vs-error ordering) passes headlessly, and
   `pnpm exec tsc --noEmit` still exits 0.
1. `Sync now` with N pending -> N verbatim files, all acked, re-sync is a no-op.
2. Induced write failure -> not acked, error POST 200, reader shows failed+Retry, retried next pass.
3. Missing folder auto-created; forbidden-char/`../` filename sanitized inside the folder.
4. Collision cases (identical / different / double-collision) resolve without data loss.
5. Two rapid `Sync now` -> no overlap, no spurious suffix.
6. Auto-sync delivers a fresh save within interval+30s.
7. Server-down is non-fatal and recovers; "Synced N" Notice respects the toggle; status bar always updates.

## Execution log

**2026-07-24 — implemented in an unattended headless run** (authorized in `docs/HANDOFF.md`).
ALL of the phase's code is written; every UNIT gate was run for real and passed; every
INTEGRATION gate is deferred to manual verification and is explicitly NOT claimed.

### Step 0 — headless test harness — **PASSED**

`vitest ^2.1.8` + `"test": "vitest run"` added to `package.json`; `tsconfig.json` `include`
extended to `["src", "tests"]` so the specs are type-checked too. Pure logic lives in
`src/sync/` (`types.ts`, `sanitize.ts`, `resolve.ts`, `runSync.ts`), none of which imports
`obsidian`. `tests/fakes.ts` carries `FakeVault` (in-memory `Map`; `create` throws on an
existing path as Obsidian's does, with `failWrites` and a `writeDelayMs` for overlap tests)
and `FakeOutbox` (records `acked`/`reported` in order; `failGetPending`, `failAckFor`,
`failReportFor` to fail any call on command). `SyncRunner.run(deps)` takes the vault and
outbox as injected dependencies, so the live plugin and the tests drive identical code.

### Steps 1-8 — code written

- `src/outboxClient.ts`: `HttpOutboxGateway` implementing `getPending`/`ack`/`reportError`,
  all routed through the existing `normalizeBaseUrl`, all throwing on non-2xx (the whole-pass
  catch is what renders a failure as status).
- `src/sync/runSync.ts`: the pass. Fetch → ensure folder → per entry: sanitize → resolve →
  write → ack. `try/catch` wraps ONLY the write; the ack sits outside it.
- `src/sync/sanitize.ts`, `src/sync/resolve.ts`: the pure sanitizer and the bounded
  collision resolver.
- `src/main.ts`: production `SyncVault` adapter (`getAbstractFileByPath` for `exists`,
  `vault.read` — not `cachedRead` — for the byte comparison), `Riverbed: Sync now` command,
  startup pass, `rescheduleSync()` (clears the stored interval id BEFORE re-registering),
  status-bar item, notifications-gated Notice, and the `IS_DEV`-guarded fault injection for
  the AC 8 integration gate (filename sentinel `riverbed-fail-write`).
- `src/settingsTab.ts`: the interval control now calls `plugin.rescheduleSync()`.

### Unit gates — **ALL PASSED**

    $ pnpm test
     ✓ tests/sanitize.test.ts (8 tests)
     ✓ tests/resolve.test.ts  (7 tests)
     ✓ tests/runSync.test.ts (10 tests)
     Test Files  3 passed (3)
          Tests  25 passed (25)

Covering, per the plan's stated unit gates:

- **Step 4 / AC 10** — `sanitizeFilename` over an ordinary name, forbidden characters, a
  `../../../etc/passwd.md` traversal attempt, a `foo/bar.md` separator, an all-dots name, an
  empty name, a name with no extension, a leading dot, and control characters. Every result
  asserted non-empty, `/`-free, `\`-free, `..`-free, not dot-leading, and `.md`-terminated.
- **Step 5 / AC 9** — target free → write; target identical → `skip-and-ack` (no duplicate);
  target different → `a-2.md`; target and `a-2.md` different → `a-3.md`; `a-2.md` identical →
  reuse without writing; all 100 slots occupied → bounded failure, no infinite loop; empty
  folder → vault root.
- **Step 3 / AC 8 ordering** — a failed write is reported and NOT acked; a write that
  succeeds while its ack fails is NOT reported as an error (and the next pass re-acks it via
  the identical-bytes path, asserted as its own test); a failing `reportError` does not stop
  the rest of the pass from delivering.
- **Step 6 / AC 20** — two overlapping `run()` calls produce one pass's writes and one set of
  acks, the second returning `null`, with no spurious `-2`; and the release-on-throw
  regression: after a pass whose `getPending` throws, `busy` is `false` and the next call
  runs a real pass.
- **Steps 1/2/12** — verbatim write of every entry, ack per entry, destination folder created
  when missing, and a zero-pending pass as a no-op.

Also still green after all of it: `pnpm exec tsc --noEmit` exits 0, `pnpm build` emits
`main.js`, and the dev fault-injection sentinel is confirmed ABSENT from the production
bundle (`sentinel present in PROD bundle: false`) — `IS_DEV` folds it away.

### Integration gates — **ALL DEFERRED (manual)**

Not attempted, not claimed. Each needs a running Riverbed dev stack on `:3000` with seeded
pending entries and a real API token, plus Obsidian's GUI: Step 1's N-file verbatim `diff`,
Step 2's empty-outbox re-poll, Step 3's reader Outbox failed+Retry state, Step 4's live
folder-create and crafted hostile filename, Step 5's pre-created collision cases, Step 6's
double `Sync now`, Step 7's stopwatch and the post-change one-pass-per-tick check, Step 8's
server-down recovery and notifications toggle. Enumerated for a single sitting in
`docs/HANDOFF.md`.

### Phase-2 status

- **Closed by real headless evidence:** the pure-logic halves of AC 8, 9, 10, 20.
- **Code complete, gate pending a human:** AC 6, 7, 11, 12, 13, 14, and the integration
  halves of 8, 9, 10, 20.
- Asana subtask `1216860831880593` stays OPEN — a phase closes on a clean review of
  *verified* work.

## Review log

- 2026-07-24 — changes requested — 4 blocking / 6 advisory (pinned Sonnet subagent,
  just-in-time, with Phase 1's shipped `src/` read as current state). Blocking, all
  mechanical (none needed Nick's judgment), fixed same pass per the standing
  autonomous-run authorization: (1) Step 3's "on success -> ack" was ambiguous about
  whether `ack` sits inside the try, so a failed ack after a SUCCESSFUL write would be
  misreported via `reportError` — a spurious failed-with-Retry entry for a capture that is
  safely in the vault; rewritten as three explicit outcomes, with the ack-transport failure
  routed to the next pass's identical-bytes dedupe (which is what `outbox-api.md`'s
  idempotent-ack recovery prescribes), plus a stance on `reportError` itself failing.
  (2) Step 6 never said the single-flight flag is released in a `finally`, so any throw
  before Step 8's whole-pass catch existed would wedge it `true` forever and silently kill
  every future sync — added the `finally` requirement and a dedicated release-on-throw
  regression gate. (3) Step 7 required "re-register the interval when the setting changes"
  with no mechanism and no gate, and Phase 1's `settingsTab.ts` has no callback into the
  plugin at all — specified `rescheduleSync()` (clear the stored id, then re-register) and
  the wiring from the settings control, and added a gate that watches two ticks after an
  interval change for exactly one pass each. (4) Every gate in the phase required a loaded
  Obsidian plus a live server, with no headless coverage of the pure logic — a regression
  from Phase 1's deliberately `obsidian`-free `settings.ts`, and a direct miss against
  `docs/HANDOFF.md`, which prescribes vitest unit tests for exactly this logic; added Step 0
  (vitest harness + fake vault/outbox doubles + dependency injection into `runSync()`) and
  unit gates on Steps 3, 4, 5 and 6 alongside (never replacing) their integration gates.
  Advisories folded while there: `vault.read` not `cachedRead` for the byte comparison;
  `sanitizeFilename` stances on empty/degenerate results, a missing `.md`, and a leading
  dot; a bounded (100-attempt) suffix iteration with a defined exhaustion behavior;
  `getPending`'s throw-on-non-2xx error contract. Not folded (carried, non-blocking):
  case-insensitive-filesystem collisions on `getAbstractFileByPath`, Windows reserved
  device names, whether a zero-pending pass refreshes the status-bar timestamp.
- 2026-07-24 — changes requested — 1 blocking / 5 advisory (pinned Sonnet subagent,
  round 2, re-verifying round 1's fixes against current text plus a fresh full-rubric
  pass). All 4 round-1 fixes confirmed CLOSED with quoted evidence. New blocking finding,
  mechanical (no domain judgment needed): Step 0's injected fake-vault interface
  (`exists(path)`, `read(path)`, `create(path, contents)`, `createFolder(path)`) named a
  different, incompatible API than Steps 4-5's Build prose, which called the real Obsidian
  `Vault` methods directly (`getAbstractFileByPath`, `vault.read(file: TFile)`) — as
  written, Steps 4-5's logic couldn't run against Step 0's fake doubles, breaking Step 6's
  unit gate (which exercises whole passes through the fake vault) and the harness's "same
  code, real path and test path" premise. Fixed same pass: Step 0 now requires every later
  step's vault-touching Build prose to call through the injected interface only, and states
  the production adapter's mapping from `exists`/`read` to the real `Vault` API once;
  Steps 4-5 reworded to `vault.exists`/`vault.read`. Two advisories folded alongside: Step
  0's fake outbox client now explicitly stubs `getPending()` (needed by Step 6's
  release-on-throw gate, previously implied but unstated); Step 1 now routes
  `getPending`/`ack`/`reportError` through the existing `normalizeBaseUrl` helper (added in
  Phase 1 for `testConnection`) to avoid reintroducing the double-slash bug for self-hosted
  trailing-slash base URLs. Not folded (carried, non-blocking): case-insensitive-filesystem
  collisions and Windows reserved device names (unchanged since round 1); no documented
  `@throws` for `Vault.create` in `obsidian.d.ts` (behavior relied on only defensively, not
  load-bearing); `tests/` not covered by the Step 0 `tsc --noEmit` gate (scoped to `src`).
- 2026-07-24 — approved — 0 blocking / 0 advisory (pinned Sonnet subagent, round 3, narrow
  recheck of the single blocking fix plus its two accompanying advisory fixes). Confirmed
  CLOSED: no `getAbstractFileByPath` or bare `vault.read(file)` remains in any step's Build
  prose; Steps 4-5 now call `vault.exists`/`vault.read` matching Step 0's interface exactly;
  the production-adapter mapping is scoped correctly to Step 0 as adapter-only, not
  Build-prose-under-test. Both advisory fixes verified correct against the actual
  `src/outboxClient.ts` (`normalizeBaseUrl` exported, already used by `testConnection`) and
  against Step 6's gate (b) (`getPending` stub now explicitly throwable). No new
  contradiction introduced by the edit. Status → approved.

## Manual gate results (2026-07-24, attended session with Nick)

Run against the live dev stack in a throwaway vault, dev build (fault injection active,
interval floor 1). Every integration gate closed. Baselines were captured from
`GET /app-outbox` BEFORE each sync and diffed byte-for-byte afterward.

**Method note (deviation from the plan, deliberate):** entries were staged by editing
`saves` documents in Mongo rather than by editing a capture template. For AC 12 this is
the ONLY possible method — the reader's `renderFilename` rejects `/` and `\` outright, so
the product cannot emit a traversal even in principle; the gate is about the plugin not
trusting a hostile/buggy server, which requires bypassing the server's own validation. The
same mechanism was reused for AC 8's sentinel and for volume staging. What is under test
(plugin behavior given a server response) is unchanged. 60 cloned entries were inserted for
the volume gates and deleted afterward (`_gateClone` marker); no real save was destroyed.

- **AC 6 — PASS.** 4 captures, every file byte-identical to `renderedMarkdown`, zero extra
  files. (An apparent 2-byte mismatch on an earlier run was a measurement artifact:
  character count vs UTF-8 byte count on a curly apostrophe, not a content difference.)
- **AC 7 — PASS.** Outbox returned `items: []` after the pass; a second sync created no
  new files.
- **AC 8 — PASS.** Sentinel entry (`riverbed-fail-write` in the filename) among healthy
  ones: healthy two written + acked, sentinel NOT written, NOT acked, still pending,
  `syncError` recorded server-side as "induced write failure (dev fault injection)", and
  the reader's Outbox view showed it failed WITH a Retry affordance (confirmed visually by
  Nick). Sentinel removed → next sync wrote it byte-identical and acked it.
- **AC 9 — PASS, all three cases, no overwrites.** (a) identical bytes at target → no new
  file, entry acked; (b) different bytes → `dup-b-2.md`, original untouched; (c) target and
  `-2` both different → `dup-c-3.md`, both originals untouched. 3/3 acked.
- **AC 10 — PASS.** Destination folder deleted; sync recreated it and delivered into it.
- **AC 12 — PASS.** `../../ev:il?.md` sanitized to `ev-il-.md` INSIDE the folder.
  Containment proven against pre-sync snapshots of the vault root and `~/Desktop` (an
  escape of two levels would have landed on the Desktop): `~/Desktop` byte-for-byte
  unchanged, vault root gained only the destination folder.
- **AC 20 — PASS.** 60 uniquely-named entries staged to widen the window; `Sync now` fired
  twice in immediate succession → exactly 60 files, ZERO `-N` duplicates, outbox drained.
- **AC 11 — PASS (on a clean re-run).** Interval 1: staged entry delivered in 45s with no
  manual command. Interval 2: two ticks ~2 min apart each delivered its own batch (40 then
  15), no duplicates, and NO `sync already in progress` line — no leaked timer.
  *First attempt was inconclusive and correctly not recorded as a pass:* an
  `already in progress` line appeared, but was explainable by test-harness contamination
  (files had been moved out with `mv` under a running Obsidian, leaving a stale vault cache
  that made passes slow via ENOENT-per-entry). Obsidian was restarted to rebuild the index
  and the gate re-run cleanly. Lesson: reset between gates THROUGH Obsidian, not behind it.
- **AC 13 — PASS.** Server stopped mid-schedule: status bar showed
  `Riverbed: sync failed (4:36:48 PM)` with a red icon, console showed only the caught
  `sync (scheduled) failed: net::ERR_CONNECTION_REFUSED` (no stack trace, no unhandled
  rejection). Server restarted → the NEXT scheduled tick recovered all 5 entries 51s later
  with no intervention.
- **AC 14 — PASS.** Notifications off: delivering sync produced no Notice, status bar still
  updated. Notifications on: delivering sync produced the Notice. Status bar showed outcome
  + timestamp in both states. (A `synced 0` reading observed alongside the Notice was a
  manual run landing immediately after an auto tick that had already delivered the batch —
  file mtimes confirmed a single pass at 16:40:48; the Notice is gated on `delivered > 0`
  and so came from the auto pass.)

**Non-blocking observations raised to Asana (Riverbed project), not defects in this
phase:** `1216863724808780` ribbon icon carrying sync state, `1216863923333571` in-flight
and no-op feedback, `1216876861195652` reader template emits no frontmatter/article body,
`1216863925152767` outbox failure UX (raw error text, stranded captures unreadable),
`1216878934354676` token-creation UX.

**Advisory surfaced by the harness, worth a look at review-code:** `resolveTarget` calls
`vault.exists()` (Obsidian's in-memory cache) then `vault.read()`. If the cache is stale
because a file was removed outside Obsidian (iCloud, git, another tool — all normal for a
vault), `read()` throws ENOENT. Behavior degrades correctly (entry fails, is reported, and
retries), but treating ENOENT-on-read as "not there, write it" would be strictly better.
