---
status: complete
---

# Handoff — Obsidian Riverbed companion plugin

Written for a session with ZERO memory of the authoring conversation.

## The project is DONE and shipped

Net-new Obsidian plugin: the bridge client that drains a Riverbed user's saved captures
into their Obsidian vault via the reader's pull-based outbox API. It is **step 1 of the
outbox-destinations build order** (`riverbed` repo `docs/outbox-destinations.md`) and
**Nick's own dogfood path**.

- **Repo:** `~/Desktop/JavaScript/obsidian-riverbed` /
  `github.com/nick-vogel/obsidian-riverbed` (**PRIVATE**)
- **All three phases complete**, each closed on a clean `/eng:review-code`. All 20 spec ACs
  proven with recorded evidence (see each phase file's "Manual gate results" and
  "Execution log").
- **Rollup PR #1 MERGED** 2026-07-26, merge commit `9cadd9c`, `--merge` not squash so the
  per-phase reviewed history survives. `main` is the default branch.
- **Release `0.1.1`** is the only release, assets `main.js` + `manifest.json`.
- **Running in production**: the production build is installed at
  `Knowsmore/.obsidian/plugins/riverbed/`, pointed at `https://riverbedfeed.com`, folder
  `inbox`. It delivered a real capture on 2026-07-26 at 22:07 and `/km:sort-inbox` filed it.
- **Asana:** parent `1216858370185470` and all three phase subtasks CLOSED.
- **Tests:** 66, typecheck and production build clean, fault-injection sentinel verified
  absent from the shipped artifact.

There is no next pipeline step. What follows is standalone follow-up work.

## Open item 1 — destination folder is not sanitized (Asana `1216891285405648`)

The only known correctness gap. **Not** a server-controlled hole, so it is user self-harm
rather than an attack surface, but `README.md` states flatly "It never writes outside your
destination folder" and that is currently false for a user-typed traversal.

`deps.folder` is only trimmed of leading and trailing slashes (`runSync.ts`, and
`joinPath` in `resolve.ts`). It is never checked for `..`. A user who types `../../notes`
into the Destination folder setting writes outside the vault: Obsidian's `normalizePath`
does not resolve `..`, but the adapter's `path.join` does.

**Nick's decision, 2026-07-26: nested destination folders ARE supported**, so the fix must
NOT reuse `sanitizeFilename`'s rules (which flatten every separator). Shape:

- KEEP `/` as a nesting separator, so `research/inbox` still works.
- STRIP `..` segments. That is the actual hole.
- REJECT an absolute path (leading `/`) and a Windows drive prefix.
- Normalize repeated separators, trim leading/trailing ones.
- Sanitize per SEGMENT: each segment gets the forbidden-character treatment, separators
  between segments survive.
- Validate in the settings control too, so the user finds out immediately rather than on
  the next sync.

Post-merge, so it needs its own branch and PR. Also carried on that task: three cosmetic
items (README says `35,000` where the settings description renders `35000`; the README
omits the default interval of 15 and the pending-count variant of the "Connected" notice;
`settingsTab.ts` async listeners have no rejection handler).

## Open item 2 — public flip before community-store GA

**Community-store GA is the eventual plan, timed to the app's readiness** (Nick,
2026-07-26). The store requires a **PUBLIC** repo, so the current private setting is
explicitly temporary. Nothing blocks the flip: the code is secret-free (verified in review)
and AC 19's release hygiene already matches what a listing needs. Plugin id `riverbed` was
verified available against all 6,076 listed community plugins on 2026-07-26; re-check
immediately before submitting, the list moves.

## What a fresh session most needs to know

**Two defects reached "done" and were caught only by an adversarial reader, AFTER a full
attended pass of all 12 manual GUI gates passed green:**

1. The collision guard used `getAbstractFileByPath`, Obsidian's CASE-SENSITIVE in-memory
   index, while APFS and NTFS are case-INSENSITIVE. With `note.md` on disk and a capture
   named `Note.md`, the index answered "absent", `Vault.create` hit the same inode, and the
   user's edited note was **truncated**, then acked so the outbox dropped it. The AC 9
   gates had been staged with exact-case names, the direction that works.
2. `sanitizeFilename` sanitized the filename but interpolated the server-controlled entry
   `id` RAW into its fallback, so an id containing `../` wrote **outside the vault**. It
   survived two reviews because every fallback test used a benign id.

Also shipped once: a test asserting `not.toContain('�')`, which JS string slicing can
never produce. It passed while the bug it guarded was live. **Every assertion added since is
mutation-verified** (revert the code, confirm the test fails). Do not add one that is not.

**Therefore, if you touch this code:** manual gates and `/eng:review-code` catch disjoint
classes, run both; stage the adversarial direction of anything you probe, not just the happy
one; and a gate run only in the permissive build configuration (dev floor 1, fault injection
present) does not evidence the production one.

## Gotchas worth not rediscovering

- **The `obsidian` package ships TYPES ONLY**, no runtime entry, so any module importing it
  cannot be loaded by vitest. Pure logic lives in obsidian-free modules (`src/url.ts`,
  `src/settings.ts`, `src/sync/*`) precisely so it is testable.
- **`Setting.addText().onChange` fires per KEYSTROKE.** Validate on `blur`, never inline, or
  an ordinary edit is impossible.
- **`SettingTab` is not a `Component`**, so `registerDomEvent` there binds to the plugin's
  lifetime while `display()` re-runs on every settings open. Use plain `addEventListener`.
- **Release tags are bare semver, no `v` prefix.** `versions.json` ACCUMULATES entries.
  Never move a published tag; roll forward.
- **BRAT** wants `owner/repo`, NOT a URL, and a fine-grained PAT with the repository
  selected but **no permissions added** fails with the same "Repository not found". It needs
  `Contents: Read-only`.
- **Developer console on macOS is Cmd-Option-I**, not Ctrl-Shift-I.
- **Reset a test vault THROUGH Obsidian**, or restart it afterward. Moving files out from
  under a running Obsidian leaves a stale index that produces false gate signals.

## Dev stack

`pnpm install`, `pnpm build` (production, interval floor 5), `pnpm dev` (watch, floor 1 plus
the `riverbed-fail-write` fault injection), `pnpm test` (vitest, 66). Install by copying
`main.js` + `manifest.json` into `<vault>/.obsidian/plugins/riverbed/`. The reader is live at
`https://riverbedfeed.com`; mint outbox tokens there under Settings, API tokens.

## Continuous-mode authorization

**None standing.** The original autonomous authorization was discharged at Phase 2 and the
project has since shipped. Any further work needs explicit authorization.
