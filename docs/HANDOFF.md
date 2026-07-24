---
status: blocked
---

# Handoff — Obsidian Riverbed companion plugin (build track)

Written for a session with ZERO memory of the authoring conversation.

## What this is

Net-new Obsidian plugin: a bridge client that drains a Riverbed reader user's saved
captures into their Obsidian vault via Riverbed's outbox API. It is **step 1 of the
outbox-destinations build order** (`riverbed` repo `docs/outbox-destinations.md`) and the
**dogfood path for Nick's own vault**. The reader already exposes the outbox; this is the
missing client.

- **Repo:** `~/Desktop/JavaScript/obsidian-riverbed`
- **Branch:** `project/obsidian-riverbed-v1` (net-new project = ONE long-lived branch;
  each phase commits as it lands; ONE rollup PR to `main` at the very end).
- **Spec:** `docs/specs/obsidian-riverbed-v1.md` — **approved** (ACs 1-20).
- **Plans:** `docs/plans/obsidian-riverbed/phase-{1,2,3}-*.md`.
- **No git remote exists yet.** Creating `nick-vogel/obsidian-riverbed` is Phase 3 Step 2,
  and public-vs-private is Nick's call at that point, so nothing has been pushed.
- **Asana** (project Riverbed, gid `1216862089782589`): parent `1216858370185470`; subtasks Phase 1
  `1216860990863548`, Phase 2 `1216860831880593`, Phase 3 `1216860986917917`. **All three
  are still open** — a subtask closes only on a clean `/eng:review-code`, and no phase can
  be review-clean while its GUI gates are unverified.
- **Outbox contract (ground truth):** the `riverbed` repo's `docs/outbox-api.md`. Auth is
  `Authorization: Token <token>` (NOT Bearer, NOT JWT). **Never ack before a confirmed
  write.** Write `renderedMarkdown` **verbatim**. Endpoints: `GET /app-outbox`,
  `POST /app-outbox/:id/ack` (idempotent), `POST /app-outbox/:id/error {reason}`.

## Phase ledger

| Phase | Plan status | Code | Gates | Asana |
|---|---|---|---|---|
| 1 — scaffold + settings | approved (4 review rounds) | **committed** `2c72f45` | AC 1, 5 PASSED headless; AC 2, 3(GUI half), 4 unverified | open |
| 2 — sync engine | approved (3 review rounds) | **committed** `835032c` | 25 unit tests PASS (pure logic of AC 8, 9, 10, 20); every integration gate unverified | open |
| 3 — release + dogfood | draft (never reviewed) | not started | — | open |

**What phase 1 shipped:** esbuild/TypeScript toolchain, `manifest.json` + `versions.json`,
the five settings persisted to `data.json`, a build-time `IS_DEV` interval floor (5 prod /
1 dev) enforced on load AND in the control, `Test connection` mapping four distinguishable
outcomes, and a README Security section.

**What phase 2 shipped:** `SyncRunner` (`src/sync/runSync.ts`) doing fetch → folder-ensure
→ sanitize → collision-resolve → write → ack, with ack deliberately outside the write's
try/catch; `HttpOutboxGateway` (`getPending`/`ack`/`reportError`); a pure sanitizer and a
bounded collision resolver in `src/sync/`; `Riverbed: Sync now`, a startup pass,
`rescheduleSync()` (clears the old timer before re-arming), a status bar, a
notifications-gated Notice; and an `IS_DEV`-only fault injection (filename sentinel
`riverbed-fail-write`) that the production bundle drops, for the AC 8 gate.

**Verified headlessly, right now, on the committed tree:** `pnpm install`, `pnpm build`
(emits `main.js`), `pnpm exec tsc --noEmit` (exit 0), `pnpm test` (25/25 pass),
`pnpm dev` watch rebuild, the manifest/package version-equality check.

## Why this run stopped: `status: blocked`

Not a code problem. Everything the authorized autonomous run was scoped to build is built,
committed, and evidenced. What remains needs **a human at an Obsidian GUI plus a running
Riverbed dev stack**, which a headless process cannot do and must never fake.

## Exact next action

**Nick, in ONE sitting, with Obsidian and the Riverbed dev stack open.** Start the stack in
the `riverbed` repo (dev server `:3000`, Mongo `:27019` —
`docker compose -f docker-compose.dev.yml up -d`), create an outbox token in the reader
(Settings → API tokens; shown once), seed a few saves, then build and install the plugin:

    cd ~/Desktop/JavaScript/obsidian-riverbed && pnpm install && pnpm dev
    # copy main.js + manifest.json into <test vault>/.obsidian/plugins/riverbed/

Use `pnpm dev` (not `pnpm build`) so the 1-minute interval floor and the fault injection
are active. Then work the checklist below. **After it passes, the pipeline resumes at
`/eng:review-code` for phases 1 and 2** (Opus, pinned), which is what closes their Asana
subtasks; then `/eng:review-plan docs/plans/obsidian-riverbed/phase-3-release-dogfood.md`
and phase 3.

### The manual gate checklist (batched — this is the whole blocker)

**Phase 1**
1. **AC 2** — enable the plugin in Community plugins; developer console (Cmd-Option-I on macOS, Ctrl-Shift-I elsewhere) shows
   the `Riverbed: loaded` line and **zero** errors/warnings from the plugin, on enable and
   on disable.
2. **AC 3** — set all five settings to non-defaults, fully quit and relaunch Obsidian,
   re-open the tab: all five persist, and `data.json` on disk shows them. Then try an
   interval below the floor: it is rejected with a Notice and does not persist.
3. **AC 4** — base URL `http://localhost:3000`: real token → "connected"; garbage token →
   "authentication failed"; stop the dev server → "could not reach…".

**Phase 2**
4. **AC 6** — with N pending, `curl -s localhost:3000/app-outbox -H "Authorization: Token
   $T" > pre.json`, run `Riverbed: Sync now`, then `diff` EVERY file against
   `jq -r ".items[i].renderedMarkdown" pre.json` — all N byte-identical.
5. **AC 7** — after that sync `GET /app-outbox` returns `items: []`, and a second `Sync now`
   creates no new files.
6. **AC 8** — craft a capture whose `suggestedFilename` contains `riverbed-fail-write` (a
   custom capture template) among several healthy ones. Sync. That entry: still in
   `GET /app-outbox`, its `POST :id/error` returned 200, and **the reader's Outbox view
   shows it failed with a Retry affordance**. The others delivered and acked. Remove the
   sentinel, sync again: it is written and acked.
7. **AC 10 + 12** — delete the destination folder, sync: it is recreated and files land in
   it. Craft an entry whose filename has a forbidden char and a `../` prefix: after sync the
   file is **inside** the folder with a safe name, and nothing was written outside it.
8. **AC 9** — pre-create in the folder: (a) the target name with identical bytes → no new
   file, entry acked; (b) the target with different bytes → `name-2.md`; (c) target and
   `name-2.md` both different → `name-3.md`. Outbox empty after.
9. **AC 20** — with the write artificially slowed, fire `Sync now` twice in immediate
   succession → exactly N files, no spurious `-2`, one pass in the log.
10. **AC 11** — interval at the dev floor (1 min), make a save in the reader, stopwatch: it
    lands within one interval + 30s with no manual command. Then change the interval to 2
    minutes and watch two ticks: **exactly one** pass per tick (proves no leaked timer).
11. **AC 13** — stop the dev server, wait for a scheduled sync: visible failed status, zero
    uncaught console errors; restart it, the next scheduled sync succeeds.
12. **AC 14** — toggle notifications off then on across two delivering syncs: the Notice
    appears only when on; the status bar shows outcome + time either way.

Record each result in the phase file's Execution log next to the deferred-gate note.

## Open items / dependencies

- **THE BLOCKER: the manual checklist above.** Needs Nick, Obsidian, a running dev stack,
  and a real API token (a token can only be minted through the reader's GUI). Nothing else
  is pending on phases 1-2.
- **`/eng:review-code` has NOT run on either phase.** It was deliberately not run: the
  standing authorization forbids closing an Asana subtask on headless evidence alone, and a
  phase with unverified GUI gates is not review-clean. Run it after the checklist passes.
- **No GitHub remote / no PR.** Phase 3 Step 2. **Public vs private is Nick's open call**
  (default public — the code contains no secrets).
- **`minAppVersion` is an assumption: `1.5.0`** (safe low floor; `requestUrl`, settings and
  Vault APIs are long-stable). Bump if preferred. NOT blocking.
- **Phase 3 is untouched and its plan has never been reviewed** — it needs its own
  just-in-time `/eng:review-plan` pass before implementation, and that review is expected to
  demand step-level detail now that phase 2 has shipped.
- **Prod deploy is a SEPARATE track** (the reader, not this plugin): rollup PR #1 + the R2
  cutover. Not a blocker for P1-2; P3's HTTPS/dogfood can close against a tunnel if prod is
  not live, with a prod re-confirmation as a follow-up. See `personal/riverbed/HANDOFF.md`.
- **Carried non-blocking advisories** (reviewed, judged not worth blocking on, recorded in
  the phase files' Review logs): case-insensitive-filesystem collisions on
  `getAbstractFileByPath`; Windows reserved device names in filenames; whether a
  zero-pending pass should refresh the status-bar timestamp.

## Continuous-mode authorization

The previous authorization (Nick, 2026-07-24) was scoped to: review-plan + implement +
commit for phase 1, then the same for phase 2 with vitest unit tests, then stop with a
`blocked` handoff. **That scope is now fully discharged** — this is that stop.

A fresh session must NOT resume autonomously past this point. The next steps need either
Nick's hands (the GUI checklist) or his decisions (repo visibility, and whether a manual
gate that fails is a code fix or a spec change). Re-authorize explicitly before any further
unattended run.

## Dev stack

- **The plugin:** `pnpm install`, `pnpm build` (production, floor 5), `pnpm dev` (watch,
  floor 1 + fault injection), `pnpm test` (vitest, 25 tests). Copy `main.js` +
  `manifest.json` into `<vault>/.obsidian/plugins/riverbed/` to load it.
- **The reader:** `riverbed` repo, dev server `:3000`, Mongo `:27019`, Mailpit `:8025`.
  Restart the reader dev server after any config/collection change.
