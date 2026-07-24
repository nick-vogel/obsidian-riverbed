---
status: ready
---

# Handoff — Obsidian Riverbed companion plugin (build track)

Written for a session with ZERO memory of the authoring conversation.

## What this is

Net-new Obsidian plugin: a bridge client that drains a Riverbed reader user's saved
captures into their Obsidian vault via Riverbed's outbox API. It is **step 1 of the
outbox-destinations build order** (`riverbed` repo `docs/outbox-destinations.md`) and the
**dogfood path for Nick's own vault** ("so I can use it"). The reader already exposes the
outbox; this is the missing client.

- **Repo:** `~/Desktop/JavaScript/obsidian-riverbed`
- **Branch:** `project/obsidian-riverbed-v1` (net-new project = ONE long-lived branch;
  each phase commits as its review passes; ONE rollup PR to `main` at the very end).
- **Spec:** `docs/specs/obsidian-riverbed-v1.md` — **status: approved** (ACs 1-20; two
  independent Opus reviews, 0 blocking).
- **Plans:** `docs/plans/obsidian-riverbed/phase-{1,2,3}-*.md` — all **status: draft**.
- **Asana** (project Personal): parent `1216858370185470`; subtasks Phase 1
  `1216860990863548`, Phase 2 `1216860831880593`, Phase 3 `1216860986917917`. A subtask
  is closed by `/eng:review-code` ONLY on a clean (0-blocking) review, never by
  implement-plan.
- **Outbox contract (ground truth):** the `riverbed` repo's `docs/outbox-api.md`. Auth is
  `Authorization: Token <token>` (NOT Bearer, NOT JWT). **Never ack before a confirmed
  write.** Write `renderedMarkdown` **verbatim**. Endpoints: `GET /app-outbox`,
  `POST /app-outbox/:id/ack` (idempotent), `POST /app-outbox/:id/error {reason}`.

## Phase ledger

| Phase | Status | Closes ACs | One-line summary |
|---|---|---|---|
| 1 — scaffold + settings | draft | 1-5 | toolchain/manifest, clean load, 5 settings + build-floor validation, Test-connection button, token-security README |
| 2 — sync engine | draft | 6-14, 20 | `runSync()`: verbatim write → ack-after-write → error path → sanitize/folder-create → collision dedupe → single-flight lock → auto-sync interval → status feedback |
| 3 — release + dogfood | draft | 15-19 | HTTPS end-to-end, BRAT release + version hygiene, complete README, real-vault dogfood |

## Exact next action

`/eng:review-plan docs/plans/obsidian-riverbed/phase-1-scaffold-settings.md`

(pinned Sonnet subagent, just-in-time). On approval → `/eng:implement-plan` (phase 1) →
`/eng:commit` → `/eng:review-code`. Then phase 2 (its OWN review-plan first), then phase
3. Phases 2 and 3 are NOT reviewed yet — each gets its review-plan pass right before its
implementation.

## CRITICAL — most gates are MANUAL (Obsidian GUI + a live server). Do NOT fake them.

A headless `claude -p` cannot drive Obsidian's GUI or a browser, and cannot create a
Riverbed token (that is a reader-GUI action). The following gates REQUIRE a human at a
running Obsidian + the Riverbed dev stack. In an unattended run, on reaching one of these,
write a `blocked` handoff naming exactly what needs manual verification and STOP — never
tick a GUI/server gate off from a headless process.

- **P1:** Step 2 (enable in Obsidian, zero console errors), Step 3 (settings persist
  across an Obsidian restart), Step 4 (Test-connection against dev `:3000` with a real
  token).
- **P2:** all integration gates (sync against dev, the reader's Outbox view for AC 8, the
  stopwatch auto-sync timing, the notifications-toggle behavior).
- **P3:** nearly all of it (GitHub release, BRAT install, HTTPS instance, real-vault
  dogfood).

**Headless-verifiable WITHOUT a human** (the legitimate autonomous target):
- P1 Step 1 (`pnpm install`, `pnpm build` emits `main.js`, the `manifest.json` node
  check), P1 Step 5 (README Security section exists).
- P2's PURE LOGIC if unit-tested: `sanitizeFilename` (forbidden chars + path-separator/`..`
  stripping), the dedupe/suffix-iteration algorithm, the single-flight guard, and the
  ack-after-write control flow. Adding vitest unit tests for these against fake
  Vault/outbox doubles produces real, headless gate evidence and is the right thing to
  build autonomously. (This is additive to the spec's manually-phrased integration gates,
  not a replacement — the integration gate still needs a human later.)

## Open items / dependencies

- **Dev stack must be up for any server-dependent gate:** in the `riverbed` repo, dev
  server on `:3000` + Mongo `:27019` (`docker compose -f docker-compose.dev.yml up -d`),
  plus a real outbox token created in the reader (Settings → API tokens). Nick provides on
  demand; a headless loop cannot create the token or assume the stack is running.
- **`minAppVersion` assumption = `1.5.0`** (safe low floor; `requestUrl`/settings/Vault
  APIs are all long-stable). Bump to the installed Obsidian version if preferred. NOT
  blocking.
- **Public vs private GitHub repo** — Phase 3 Step 2, default public (no secrets in code).
  Nick confirms at release. NOT blocking before then.
- **Prod deploy is a SEPARATE track** (the reader, not this plugin): merge rollup PR #1 +
  the R2 cutover. Not a blocker for P1-2; P3's HTTPS/dogfood close against a tunnel if
  prod is not live, with a prod re-confirmation as a follow-up. See
  `personal/riverbed/HANDOFF.md` in the vault.

## Continuous-mode authorization

**AUTHORIZED (Nick, 2026-07-24).** Permission mode: `--dangerously-skip-permissions`,
running directly in this repo on `project/obsidian-riverbed-v1` (fresh personal repo, no
secrets, all in git — writes to the branch are fine and reversible).

**Scope of the authorized autonomous run:**
1. `/eng:review-plan` phase 1. If it returns blocking findings that are pure spec/plan
   ambiguities you can resolve without a human judgment call, fix and re-review; if a
   finding genuinely needs Nick, write a `blocked` handoff and stop.
2. `/eng:implement-plan` phase 1: write ALL the code (scaffold, settings, outbox client,
   Test-connection button, README). Close ONLY the headless gates: Step 1 (`pnpm
   install`/`build`/manifest check) and Step 5 (README section). For the GUI/server gates
   (Steps 2, 3, 4) WRITE the code but DO NOT attempt to verify them — record in the
   Execution log that they are deferred to manual verification. Do not block at the first
   one; keep going.
3. `/eng:commit` the phase-1 code.
4. Continue into phase 2: run `/eng:review-plan` phase 2, then write the `runSync()` code
   AND **vitest unit tests** for the pure logic — `sanitizeFilename` (forbidden chars +
   path-separator/`..` stripping), the dedupe/suffix-iteration algorithm, the
   single-flight guard, and the ack-after-write ordering (with fake Vault + outbox
   doubles). Close the pure-logic gates via those passing tests. Commit.
5. **Then STOP with a `blocked` handoff** whose Open items enumerate the batched MANUAL
   verification Nick must do in one sitting with Obsidian + the reader dev stack open:
   every P1/P2 GUI/server gate (enable-in-Obsidian console check, settings-persist,
   Test-connection vs `:3000`, sync round-trip, reader Outbox view, auto-sync timing,
   notifications toggle). Set `status: blocked`.

**Hard limits:** do NOT run `/eng:review-code` to CLOSE an Asana subtask on the strength
of headless gates alone (a phase with unverified GUI gates is not review-clean — leave the
subtask open and say so). Do NOT touch Phase 3. Do NOT fake any GUI/server gate. Do NOT
create a Riverbed token or assume the dev stack is running.

## Dev stack

- **The plugin build:** `pnpm install`, `pnpm build` (emits `main.js`), `pnpm dev`
  (esbuild watch). Copy `main.js` + `manifest.json` into a test vault's
  `.obsidian/plugins/riverbed/` to load it.
- **The reader (for server-dependent gates):** `riverbed` repo, dev server `:3000`, Mongo
  `:27019`, Mailpit `:8025`. Restart the reader dev server after any config/collection
  change.
