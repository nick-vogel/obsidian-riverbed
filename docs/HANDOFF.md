---
status: ready
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
- **Tests:** 146, typecheck and production build clean, fault-injection sentinel verified
  absent from the shipped artifact.

There is no next pipeline step for the PROJECT. One follow-up branch is in flight, below.

## Open item 1 — destination folder sanitizing (Asana `1216891285405648`) — DONE, awaiting merge

Branch `fix/destination-folder-traversal`, off `main`. **Not yet merged.**

Closed the traversal gap: `deps.folder` was only trimmed of slashes and never checked for
`..`, so a user typing `../../notes` wrote outside the vault (`normalizePath` does not
resolve `..`, but the adapter's `path.join` does). All three cosmetic items on the task are
done too.

What it added, beyond the obvious:

- **`sanitizeFolder`** keeps `/` as a nesting separator (nested destinations are supported,
  Nick's call 2026-07-26), strips `..`, rejects an absolute path and a drive prefix, and
  sanitizes per SEGMENT. `\` counts as a separator because `normalizePath` folds it to `/`.
- **One authoritative call site**, `SyncRunner.pass`. It is defense in depth: every upstream
  writer of `settings.folder` already sanitizes, so it should never change anything, and it
  LOGS if it ever does, because that would mean a path upstream skipped its sanitize.
- **`normalizeSettings`** (new, in `src/settings.ts`) took over the whole `loadSettings`
  merge. main.ts imports `obsidian` and therefore cannot be loaded by vitest, so that logic
  had been unreachable by any test since launch, including the interval clamp.
- **`ensureFolder` walks each level** and no longer pre-checks with `exists()`, because
  `exists()` is true for a FILE too and so skipped a level with a note in the way.
  `SyncVault.createFolder` is now specified as idempotent-but-throwing-on-a-non-folder, and
  `tests/fakes.ts` was corrected to match the real adapter.
- **`folderNotice`** is a pure function so the notice wording is testable at all.

## The review history on this branch is the point

**Four independent review rounds, and rounds 3 and 4 each found defects introduced by the
PREVIOUS round's fix.** Approval was NOT clean. Reviewing stopped deliberately, per Nick's
rule about diminishing returns, and the evidence shifted to mutation testing plus fuzz.

The two that matter most, because both were self-inflicted:

1. Widening the forbidden character class to the hand-listed range `\u200b-\u200f` swept in
   **U+200C ZWNJ and U+200D ZWJ, which are orthographic**. It replaced them with `-`, so a
   Persian title `می‌روم` became `می-روم`. The file's own comment two lines above already
   stated the principle (U+2800 excluded as "a legitimate character rather than a formatting
   artifact") and the change violated it in the same commit.
2. The same enumeration covered only about half the format characters, so `​/etc` was
   reported as leaving the vault while `­/etc` (soft hyphen) was accepted silently and
   created a folder rendering blank. **The test used three characters all inside the range
   that was implemented, so it could never have failed.**

Both are fixed by defining the class BY PROPERTY (`\p{Cc}\p{Cf}` plus the Hangul blank
fillers, joiners excluded by lookahead) rather than by enumeration, with `FORBIDDEN` and
`INVISIBLE` built from one shared class so they cannot drift. Note the deliberate asymmetry:
**joiners are preserved in OUTPUT but invisible to COMPARISON** (`visible()`), because
`‌/etc` still reads as `/etc` to the person who typed it.

Then, because keeping the joiners opens its own hole, `RENDERS_BLANK` rejects a name made
only of joiners and whitespace. Its first version tested only bare joiners and ran BEFORE the
trailing-dot trim, so `.‌.` still became a folder named `‌`. **A guard on "what is left" has
to be the last thing that runs.**

### Evidence

- **115 tests**, typecheck and production build clean, sentinel absent from `main.js`.
- **Mutation sweep: 51 caught, 2 survived, 156 invalid.** Exhaustive line-deletion over
  `sanitize.ts`, `settings.ts`, `runSync.ts`, each mutant gated on `tsc --noEmit` so a syntax
  error cannot masquerade as a catch. The 2 survivors are a redundant `continue` and a
  `capBytes` fast path, both documented in place.
- **Fuzz, 9,702 structured inputs** over separators, dots, drive letters, joiners, zero-width
  and blank-rendering characters, astral tags and combining marks: **0 escapes** under
  `path.posix.resolve` and `path.win32.resolve`, **0 non-idempotent** results, **0
  blank-rendering** names.
- **Code-point enumeration over all 1.1M code points**: `FORBIDDEN` matches 246. ZWNJ, ZWJ,
  U+2800, U+FE0F, combining marks and Latin/Arabic/Devanagari/CJK/emoji samples all
  unmatched; every spoofing character matched.

**Two lessons about the METHOD, not the code, worth carrying forward:**

- A hand-picked mutant set measures your judgement, not the code. The `notifications`
  coercion was never in the picked set, and a reviewer found the survivor. The sweep is now
  exhaustive over lines.
- The first sweep filtered to `;`-terminated lines, which silently skipped every CHAINED
  CONTINUATION line (`.normalize('NFC')`, `.replace(/\./g, '-')`). A real untested guarantee
  was hiding on exactly such a line. **The filter was the blind spot, not the tests.**

## Follow-up batch 2 — ribbon icon and sync feedback — DONE, in PR #3

**PR #3, open, NOT merged, and STACKED on PR #2:** https://github.com/nick-vogel/obsidian-riverbed/pull/3
Branch `feat/ribbon-and-sync-feedback`. Both branches touch `main.ts`, so **merge #2 first,
then retarget #3 to `main`.** Asana `1216863724808780` and `1216863923333571`, both left OPEN
until it merges.

Two scope additions from the 2026-07-24 manual gate walkthrough, which both tasks said to
land together in one batch gated by review-code.

- **Ribbon icon** firing the same manual sync as the palette command. Glyph is the Riverbed
  wave mark, STROKED not filled, so it inherits `currentColor` and follows the theme.
- **Status bar shows a pass in flight** (`syncing...`, then `syncing 2 of 4`) and reports
  `nothing to sync` on an empty pass, with a notice when the user asked for it.

Three things a fresh session should not have to rediscover:

1. **A `T` command in an SVG path REFLECTS the previous control point.** Each wave therefore
   swings 5 units past its baseline, and the round cap adds half the stroke. Rescaling the
   brand mark proportionally put the bottom wave at y=105 in a 100-unit box, where the SVG's
   own overflow clip sliced it flat. Geometry now lives in `src/ribbon.ts` with `waveSpan()`
   and a test asserting every wave fits, because "does a drawing fit its box" is arithmetic
   even though the drawing itself is not testable.
2. **The pass-start signal is emitted by the RUNNER, inside its single-flight guard**, not by
   the caller. Deciding it in `main.ts` let a skipped concurrent pass overwrite the running
   pass's `syncing 9 of 10` with a bare `syncing...`. Do not "simplify" this back into the
   caller with a `busy` check; emitting under the guard removes the race rather than testing
   for it.
3. **`main.ts` is the one module vitest cannot load** (it imports `obsidian`, which ships
   types with no runtime entry). Every DECISION has been moved out of it into `status.ts`,
   `ribbon.ts` and the runner; what is left is wiring. When something there needs testing,
   the answer is to move the decision out, not to accept the gap.

Evidence: 146 tests, typecheck and production build clean, sentinel absent. 33 line-deletion
mutants over `status.ts`/`ribbon.ts`/`runSync.ts`/`types.ts` with 1 survivor (an unused
optional field documenting the wire shape), plus 23 targeted value mutations across the
trigger policy, glyph geometry and pass-start guard, all caught.

**Still needs a human:** the glyph's weight and balance at 18px next to Obsidian's own icons.
Geometry is asserted; how it LOOKS is not.

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
the `riverbed-fail-write` fault injection), `pnpm test` (vitest, 146). Install by copying
`main.js` + `manifest.json` into `<vault>/.obsidian/plugins/riverbed/`. The reader is live at
`https://riverbedfeed.com`; mint outbox tokens there under Settings, API tokens.

## Continuous-mode authorization

**None standing.** The original autonomous authorization was discharged at Phase 2 and the
project has since shipped. Any further work needs explicit authorization.

## Next action

1. Merge **PR #2** (`fix/destination-folder-traversal`) into `main`, close Asana
   `1216891285405648`.
2. Retarget **PR #3** (`feat/ribbon-and-sync-feedback`) to `main` and merge it, close Asana
   `1216863724808780` and `1216863923333571`.
3. **Rebuild and reinstall.** The production build in `Knowsmore/.obsidian/plugins/riverbed/`
   is still `0.1.1` and carries NEITHER change. `pnpm build`, then copy `main.js` +
   `manifest.json`, or cut a `0.1.2` release (tags are bare semver, `versions.json`
   accumulates, never move a published tag).

Blocked on Nick, not on code: Asana `1216891949686167` (gate-test residue) needs two
decisions, namely whether to un-ack his 8 real saves in Mongo so they redeliver to the real
vault, and whether to delete `~/Desktop/riverbed-test-vault`.
