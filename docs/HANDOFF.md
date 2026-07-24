---
status: ready
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
  each phase commits as its review passes; ONE rollup PR to `main` at the very end).
- **Spec:** `docs/specs/obsidian-riverbed-v1.md` — **approved** (ACs 1-20).
- **No git remote exists yet.** Creating `nick-vogel/obsidian-riverbed` is Phase 3 Step 2,
  and public-vs-private is Nick's call at that point, so nothing has been pushed.
- **Asana** (project Riverbed, gid `1216862089782589`): parent `1216858370185470`;
  subtasks Phase 1 `1216860990863548` **CLOSED**, Phase 2 `1216860831880593` **CLOSED**,
  Phase 3 `1216860986917917` open. A subtask closes only on a clean `/eng:review-code`.
- **Outbox contract (ground truth):** the `riverbed` repo's `docs/outbox-api.md`. Auth is
  `Authorization: Token <token>` (NOT Bearer, NOT JWT). **Never ack before a confirmed
  write.** Write `renderedMarkdown` **verbatim**. Endpoints: `GET /app-outbox`,
  `POST /app-outbox/:id/ack` (idempotent), `POST /app-outbox/:id/error {reason}`.

## Phase ledger

| Phase | Status | Closes ACs | One-line summary |
|---|---|---|---|
| 1 — scaffold + settings | **DONE**, review clean | 1-5 | toolchain/manifest, clean load, 5 settings + build-floor validation, Test-connection, token-security README |
| 2 — sync engine | **DONE**, review clean | 6-14, 20 | `runSync()`: verbatim write, ack-after-write, error path, sanitize/folder-create, collision dedupe, single-flight lock, auto-sync interval, status feedback |
| 3 — release + dogfood | plan `draft`, never reviewed | 15-19 | HTTPS end-to-end, BRAT release + version hygiene, complete README, real-vault dogfood |

**Verified on the current tree:** `pnpm install`, `pnpm build` (emits `main.js`),
`pnpm exec tsc --noEmit` (exit 0), `pnpm test` (**41/41**), and the `riverbed-fail-write`
dev fault-injection sentinel confirmed ABSENT from the production bundle.

## How phases 1-2 actually closed (read this before trusting any gate)

1. An authorized headless loop wrote all phase 1-2 code and unit tests, then stopped,
   correctly refusing to close anything on headless evidence alone.
2. An **attended session with Nick** worked the 12 manual GUI/server gates against a live
   dev stack. All 12 passed. Full results are in each phase file's "Manual gate results"
   section. That session found one real defect (the plugin fired a startup sync while
   completely unconfigured, hitting the network with an empty token on every launch and
   every tick), fixed in `46484c4`.
3. **`/eng:review-code` then returned 3 BLOCKING findings anyway**, fixed in `978757b`,
   re-review CLEAN. The important one was a **data-destruction path the manual gates could
   not have caught**: `SyncVault.exists` used `getAbstractFileByPath` (Obsidian's
   CASE-SENSITIVE in-memory index) while APFS and NTFS are case-INSENSITIVE, so with
   `inbox/why-ai-slop.md` present and a capture named `Why-AI-Slop.md` the index said
   "absent", `vault.create` hit the same inode, and the user's edited note was truncated.
   The entry was then acked, so the outbox dropped it. AC 9 had been staged with
   exact-case names, the direction that works.

**The lesson to carry into Phase 3:** manual gates prove the paths someone thought to try.
They are not a substitute for an adversarial reader. Both defects survived a full attended
pass.

## Exact next action

`/eng:review-plan docs/plans/obsidian-riverbed/phase-3-release-dogfood.md`

(pinned Sonnet subagent, just-in-time.) The Phase 3 plan has **never been reviewed** and
was drafted before phases 1-2 existed, so expect it to be stale. The review is the
staleness gate. On approval: `/eng:implement-plan`, `/eng:commit`, `/eng:review-code`,
which closes subtask `1216860986917917` and then the parent `1216858370185470`.

## CRITICAL — Phase 3 is almost entirely manual gates

A headless process cannot publish a GitHub release, install via BRAT, stand up an HTTPS
instance, or dogfood in a real vault. In an unattended run, on reaching one of these, write
a `blocked` handoff naming exactly what needs a human and STOP. Never tick a GUI gate off
from a headless process.

## Open items / dependencies

- **Public vs private GitHub repo, Nick's open call** (Phase 3 Step 2, default public; the
  code contains no secrets, verified in review).
- **AC 15 needs a non-localhost HTTPS instance.** The spec explicitly permits closing it
  against "any HTTPS-tunneled dev instance", so a tunnel works and prod is NOT required. A
  prod re-confirmation can follow later.
- **Prod deploy is a SEPARATE track** (the reader, not this plugin) and blocks nothing
  here. See `personal/riverbed/HANDOFF.md` in the vault.
- **`minAppVersion` is an assumption: `1.5.0`.** NOT blocking.
- **Surviving ADVISORY findings** from review-code are recorded on the two closed Asana
  subtasks (most on Phase 2, `1216860831880593`) for a follow-up batch. The one worth
  knowing about: `capBytes` in `src/sync/sanitize.ts` splits surrogate pairs, and **its
  guarding test asserts something that can never fail**, so that assertion pins nothing.
  The split itself is cosmetic; the vacuous test is the real defect.
- **If the phase 1-2 manual gates are ever re-run:** AC 3's interval-floor check is now
  **commit-time** validation. A tester who types a sub-floor value and only stares at the
  field will see nothing happen and report a false failure. They must leave the field (Tab
  or click away) for the Notice and the revert.
- **Test staging note:** the phase-2 gates were staged by editing `saves` documents in
  MongoDB directly. For AC 12 that is the only possible method, since the reader's
  `renderFilename` rejects `/` outright and so cannot emit a traversal even in principle.
  60 cloned entries were inserted and deleted afterward; no real save was destroyed. Nick's
  8 real saves are currently all marked acked, and several were delivered to the throwaway
  test vault rather than Knowsmore, so they will not re-deliver to his real vault.

## Continuous-mode authorization

**NOT authorized past this point.** The original authorization (Nick, 2026-07-24) covered
phases 1-2 code plus unit tests and is fully discharged. Phase 3 needs Nick's hands (GitHub
release, BRAT, dogfood) and his decisions (repo visibility). Running `/eng:review-plan` on
the Phase 3 plan is safe and unblocked; **implementation past that point requires explicit
re-authorization.**

## Dev stack

- **The plugin:** `pnpm install`, `pnpm build` (production, interval floor 5), `pnpm dev`
  (watch, floor 1 + fault injection active), `pnpm test` (vitest, 41 tests). Copy `main.js`
  + `manifest.json` into `<vault>/.obsidian/plugins/riverbed/` to load it.
- **The reader:** `riverbed` repo, dev server `:3000`, Mongo `:27019`, Mailpit `:8025`
  (sign-in codes land there). Restart the reader dev server after any config change. Note
  it binds `[::1]:3000` (IPv6 only); if a client cannot reach `localhost:3000`, try
  `http://[::1]:3000`.
- **A throwaway test vault** is at `~/Desktop/riverbed-test-vault` with the plugin
  installed. Reset it THROUGH Obsidian, or restart Obsidian afterward. Moving files out
  from under a running Obsidian leaves a stale index that produces false gate signals.
