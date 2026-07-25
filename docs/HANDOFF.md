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

## Exact next action — the ordered list

Phases 1 and 2 are DONE and review-clean. The Phase 3 plan is APPROVED (`status: approved`,
commit `5265e1c`). Nothing needs re-reviewing. Work this list top to bottom.

### 0. FIRST, and it is not in this repo: the capture-format change

**Asana `1216884314903927`** (merge the older duplicate `1216876861195652` into it; the newer
carries the technical detail, the older carries the showcase-mismatch framing). This is
**reader-side, in the `riverbed` repo**, not here.

What it is: captures currently render as title / url / source-date / `why:` and nothing else.
No YAML frontmatter, no article body. The plugin writes `renderedMarkdown` **verbatim** by
spec (AC 6, verified byte-identical), so this cannot be fixed in the plugin.

Why it blocks the dogfood: **`renderedMarkdown` is generated and STORED at save time.** Every
capture made while dogfooding keeps the content-less shape permanently and cannot be
backfilled by changing the template afterward. Dogfooding first manufactures exactly the
notes this change exists to eliminate, in the real vault.

### 1. Phase 3 Step 1 — HTTPS end-to-end (AC 15)

Prod is LIVE at `https://riverbedfeed.com` (v1.0.0, 2026-07-25), so this closes against
production. Mint an outbox token there (Settings → API tokens), point the plugin's base URL
at it, and prove a round trip by BYTES: `curl` `GET /app-outbox` before syncing, run
`Riverbed: Sync now`, `diff` each written file against that entry's `renderedMarkdown`,
re-`curl` to confirm the entries are no longer pending.

### 2. Phase 3 Step 2 — private repo + BRAT release (AC 16, AC 19)

Create `nick-vogel/obsidian-riverbed` **PRIVATE** (Nick's call, 2026-07-25). Push the branch.
Cut a release with `main.js` + `manifest.json` as assets and `versions.json` in the repo.

- **Tag is bare semver, NO `v` prefix.** AC 19 requires tag == manifest version == package
  version literally; `v0.1.0` fails it. Obsidian's own guide documents the bare form.
- **Private repo means BRAT needs a personal access token** to install from it. Have one
  ready, or the Step 2 gate cannot run.
- Gate: `gh release view <tag> --json tagName,assets`; the `node -e` version-equality check;
  then BRAT "Add beta plugin" into a FRESH vault where it loads clean and completes a sync.

### 3. Phase 3 Step 3 — README (AC 17)

Cover BRAT install (including the private-repo token step), manual install, minting a token,
configuring a self-hosted base URL, every setting, and the token-plaintext warning. Gate: a
cold run in a clean vault, using only what the README says, reaches a syncing plugin.

### 4. Phase 3 Step 4 — dogfood in the real vault (AC 18)

**PRODUCTION build only** (the BRAT release, or `pnpm build`). Never `pnpm dev` — that bundle
carries the `riverbed-fail-write` fault-injection sentinel and a 1-minute floor. Confirm
`grep -c riverbed-fail-write main.js` returns `0` before it touches real data. Install into
Knowsmore's `.obsidian/plugins/riverbed/` (gitignored there, verified), folder `inbox`, real
token. Gate: a real save lands, and **running `/km:sort-inbox` files it exactly like any other
capture** with no special-casing.

### 5. Close out

`/eng:commit`, then `/eng:review-code` — which closes subtask `1216860986917917` and then the
parent `1216858370185470`. Full step detail lives in
`docs/plans/obsidian-riverbed/phase-3-release-dogfood.md`.

## Release policy (Nick, 2026-07-25)

**The plugin ships by publishing a GitHub Release, matching how the app deploys** (the
`riverbed` app deploys on Release publish; pushes do not deploy). Plan plugin releases
alongside app releases rather than ad hoc. Standing rules that follow from it: bare-semver
tags, `manifest.json` == tag == `package.json`, `versions.json` ACCUMULATES version →
minAppVersion entries, and **never move or force-push a published tag** (BRAT and installed
clients cache by tag, so a moved tag ships different bytes under a version someone already
has). Roll forward to the next patch instead.

**OPEN — needs Nick:** does "match the app" mean the plugin's version NUMBERS track the app's
(app is at `1.0.0`, plugin is at `0.1.0`), or only that both ship release-driven? This
changes what Step 2 tags, and a published tag must never be moved, so decide before cutting
the release.

## CRITICAL — Phase 3 is almost entirely manual gates

A headless process cannot publish a GitHub release, install via BRAT, stand up an HTTPS
instance, or dogfood in a real vault. In an unattended run, on reaching one of these, write
a `blocked` handoff naming exactly what needs a human and STOP. Never tick a GUI gate off
from a headless process.

## Open items / dependencies

- **Repo visibility: PRIVATE** (decided 2026-07-25). Consequence for Step 2: BRAT needs a
  personal access token to install from a private repo, so have one ready before that gate.
  A public flip later is cheap and is the path a community-store listing would need.
- **AC 15's dependency is RESOLVED.** Prod is live at `https://riverbedfeed.com` (v1.0.0,
  2026-07-25, verified 200), so AC 15 and the dogfood close against production directly. No
  tunnel, no prod-re-confirmation follow-up. Mint the outbox token there, not on dev.
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
- **Two follow-up tasks exist and are NOT part of Phase 3** (do not let them block it):
  Asana `1216891949609905` (review-code advisory batch: the `capBytes` surrogate-pair bug
  and its vacuous test, the unbound `onLayoutReady`, path-normalization mismatch, interval
  upper bound, Windows reserved names, unguarded `res.json`) and `1216891949686167`
  (gate-test cleanup: the throwaway vault, and Nick's 8 real saves currently all acked).
- **Test staging note:** the phase-2 gates were staged by editing `saves` documents in
  MongoDB directly. For AC 12 that is the only possible method, since the reader's
  `renderFilename` rejects `/` outright and so cannot emit a traversal even in principle.
  60 cloned entries were inserted and deleted afterward; no real save was destroyed. Nick's
  8 real saves are currently all marked acked, and several were delivered to the throwaway
  test vault rather than Knowsmore, so they will not re-deliver to his real vault.

## Continuous-mode authorization

**NOT authorized past this point.** The original authorization (Nick, 2026-07-24) covered
phases 1-2 code plus unit tests and is fully discharged. Phase 3 needs Nick's hands (GitHub
release, BRAT, dogfood) and his decisions (repo visibility). The Phase 3 review-plan is already
DONE (approved), so there is no remaining unblocked automated step: **the next action is
implementation, and it requires explicit re-authorization.**

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
