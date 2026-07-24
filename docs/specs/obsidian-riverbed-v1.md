---
title: Obsidian Riverbed companion plugin v1
status: approved
asana: 1216858370185470
created: 2026-07-24
updated: 2026-07-24
---

# Obsidian Riverbed companion plugin v1

## Problem / Goal

Riverbed's save action writes to a pull-based outbox API (`docs/outbox-api.md` in the
riverbed repo) that exists precisely for a bridge client to drain saves into a user's
vault — and no such client exists. Until one does, saving in Riverbed is a dead end for
its first and only real user (Nick), and the vault-user half of the product story
(decided in `docs/outbox-destinations.md`, step 1 of the build order) is a promise, not
a feature. This project builds that client: an Obsidian plugin that polls the outbox,
writes each save's rendered markdown into the vault under its suggested filename, acks
delivered entries, and reports failures back so they surface in the reader's Outbox
view. Success is dogfood: a save made in the Riverbed reader appears in the Knowsmore
vault's `inbox/` and rides the normal sort pass, with no manual step in between.

Asana: `1216858370185470` (Riverbed — Obsidian companion plugin), project Riverbed.

## User stories

- **As a vault user (Nick first),** I want every save I make in Riverbed to appear in my
  vault's inbox folder automatically, so that captures ride my existing sort pass instead
  of dying in the reader. → AC 6, 7, 11, 12, 18
- **As a vault user,** I want sync to be safe against re-runs, crashes, existing files,
  and overlapping passes, so that I never lose a capture and never get corrupted or
  duplicated notes. → AC 7, 8, 9, 10, 20
- **As a vault user,** I want to see whether sync is working without opening a console,
  so that a silently broken bridge doesn't cost me weeks of captures. → AC 4, 13, 14
- **As a Riverbed user on someone else's instance or my own self-hosted one,** I want to
  point the plugin at any base URL with my own token, so that the plugin works for every
  deployment, not just the flagship. → AC 3, 4, 15, 17
- **As the Riverbed operator,** I want delivery failures reported through the outbox
  error endpoint, so that a user's failed sync is visible in the reader's Outbox view
  with a Retry affordance instead of vanishing client-side. → AC 8
- **As a beta user,** I want to install the plugin from a GitHub release via BRAT or by
  hand, so that I can run it before any community-store listing exists. → AC 16, 17, 19

## In scope

- A new repo, `obsidian-riverbed` (`~/Desktop/JavaScript/obsidian-riverbed`), built on
  the standard Obsidian plugin toolchain (TypeScript + esbuild, `manifest.json`,
  pnpm), plugin id `riverbed`.
- Settings tab: base URL (default `https://riverbedfeed.com`), API token, destination
  folder (default `inbox`), sync interval (default 15 minutes, floor 5 in prod / 1 in
  dev builds), notifications toggle, and a Test-connection button.
- The sync engine: poll `GET /app-outbox`, write each entry's `renderedMarkdown` to
  `<folder>/<suggestedFilename>`, `POST /app-outbox/:id/ack` after a confirmed write,
  `POST /app-outbox/:id/error` on a failed one. Automatic on startup + interval, plus a
  manual `Sync now` command.
- Filename sanitization, collision handling, folder auto-creation, and non-fatal error
  behavior (an unreachable server degrades to a status message, never a broken plugin).
- All HTTP via Obsidian's `requestUrl` (no CORS surface; `Authorization: Token <token>`
  exactly as the outbox contract specifies).
- GitHub releases consumable by BRAT + a README covering install, token creation,
  self-hosted URLs, and the token-storage warning.
- Dogfood in the real Knowsmore vault against a running Riverbed instance.

## Out of scope

- **Community-store submission** (public-listing review, guideline compliance pass) —
  deferred to its own task once v1 has dogfood mileage; the `obsidian-riverbed` repo
  name and release shape are chosen so submission needs no rename.
- **Mobile as a verified target** — the plugin ships `isDesktopOnly: false` and uses
  only mobile-safe APIs (Vault API + `requestUrl`), but v1 verification is desktop
  Obsidian; mobile verification is deferred until someone actually needs it.
- **Two-way sync** (editing the vault file updating Riverbed) — not in the product; the
  outbox is one-way by design.
- **Capture-template editing from the plugin** — templates are server-side
  (`renderedMarkdown` arrives pre-rendered); the plugin writes verbatim.
- **Multi-account / multiple Riverbed instances in one vault** — one base URL + token.
- **Per-destination delivery refactor, Notion, hosted view, digest** — other tasks per
  `docs/outbox-destinations.md`; the plugin is the outbox's single consumer, so the
  single-`ackedAt` model is used as-is.
- **Analytics/telemetry** — none; the plugin phones home only to the user's own
  configured instance.

## Acceptance criteria

Grouped by expected delivery phase; create-plan owns the final phase split. ACs tagged
*(infrastructure)* are scaffold/security hygiene that no user story motivates directly.

### Phase group A — scaffold + settings

1. *(infrastructure)* `pnpm build` in the repo emits `main.js` and a valid
   `manifest.json` (id `riverbed`, `minAppVersion` set, version matching
   `package.json`); `pnpm dev` provides a watch build. Verify: run both, inspect output.
2. *(infrastructure)* The built plugin, copied into a test vault's
   `.obsidian/plugins/riverbed/`, enables in Obsidian with zero console errors. Verify:
   developer console on enable.
3. The settings tab exposes base URL (default `https://riverbedfeed.com`), API token,
   destination folder (default `inbox`), sync interval in minutes (default 15, floor 5
   in a production build / 1 in a dev build), and a notifications toggle; every value
   persists across an Obsidian restart, and the interval field rejects a value below the
   build's floor. Verify: set all five, restart, re-open settings; try to set interval
   below the floor.
4. The Test-connection button performs `GET /app-outbox` against the configured base
   URL and reports distinguishable outcomes in a Notice: success, auth failure (401 —
   bad/revoked token), and unreachable host. Verify against the local dev server with a
   real token, a garbage token, and a stopped server.
5. *(infrastructure)* The README documents that the token lives in
   `.obsidian/plugins/riverbed/data.json` in plaintext and must be excluded from any
   VCS the vault is under. (Knowsmore already gitignores `.obsidian/plugins/` —
   verified 2026-07-24; the warning is for other users.) Verify: README section exists.

### Phase group B — sync engine

6. With N pending entries on the dev server, the `Riverbed: Sync now` command creates N
   files in the destination folder; **every** file's bytes exactly equal that entry's
   `renderedMarkdown` from a pre-sync `curl` of `GET /app-outbox` (verbatim write is
   per-file, so all N are diffed, not one). Verify: `diff` each file against the curl
   output.
7. Every delivered entry is acked: after a successful sync, `GET /app-outbox` returns
   `items: []`, and a subsequent sync creates no new files. Verify: curl + re-run.
8. Ack-after-write only: with a write failure induced for one entry (fault injection in
   a dev build is acceptable; document the method), that entry (a) is NOT acked — it
   still appears in `GET /app-outbox`; (b) gets a `POST /app-outbox/:id/error` that
   returns `200`, and its failed state with a Retry affordance is visible in the
   reader's Outbox view (the server owns where the reason is stored; the plugin only
   observes the POST succeeded and the reader's rendered state — it never reads the
   reason back, no such field is on `GET /app-outbox`); (c) is retried and delivered on
   the next sync once the fault is removed. Verify: curl before/after + the reader's
   Outbox view.
9. Collisions never destroy data. The dedupe key is (target path + byte-equality of
   `renderedMarkdown`), where the target path uses the **post-sanitization** filename
   from AC 10 (sanitize → dedupe → write, in that order). A pre-existing file at the
   target name with **identical** bytes → no write, the entry is acked as
   already-delivered (this is the safe crash-between-write-and-ack recovery); a
   pre-existing file with **different** bytes → the entry writes under a suffixed name,
   iterating `name-2.md`, `name-3.md`, … skipping any suffixed slot that exists with
   different bytes, and stopping to reuse (no re-write) any suffixed slot that already
   holds identical bytes — then is acked. Verify: pre-create both cases (and a
   `name-2.md` collision), sync, inspect folder + outbox.
   *(Known limit, documented not fixed: two genuinely distinct captures with identical
   bytes AND identical `suggestedFilename` would collapse to one delivered file; the
   default template's second-resolution timestamp makes this vanishingly unlikely.)*
10. A `suggestedFilename` is sanitized before use: characters Obsidian forbids in
    filenames are replaced with a documented substitute (e.g. `-`), AND any path
    separator (`/`, `\`) or `..` segment is stripped even though the contract promises a
    plain filename (defense in depth against a buggy or hostile server writing outside
    the destination folder). Verify: craft such an entry on the dev server (custom
    capture template) including a `../` attempt, sync, confirm the file lands inside the
    destination folder with a safe name.
11. Automatic sync runs on Obsidian startup and every interval: with the interval at
    its minimum, a save made in the reader appears in the vault within one interval
    plus 30s slack, with no manual command. Verify: stopwatch test against dev.
12. A missing destination folder is created on first sync rather than erroring.
    Verify: delete the folder, sync.
13. Failures are non-fatal and recoverable: with the server stopped, a sync attempt
    produces a visible failed status (status bar and/or Notice), zero uncaught console
    errors, and the next scheduled sync succeeds once the server is back. Verify:
    stop/start dev server across two intervals.
14. Feedback surfaces: a sync delivering >0 entries shows a "synced N" Notice when
    notifications are on and none when off; the status bar shows the last sync outcome
    and time in both cases. Verify: toggle the setting across two syncs.
20. A single-flight lock guards a sync pass: an interval tick or a second `Sync now`
    fired while a pass is still running does not start an overlapping pass (it is
    skipped or coalesced, not run concurrently), so two passes never both write the same
    entry and spuriously trip the collision suffix. Verify: trigger `Sync now` twice in
    immediate succession (or with an artificially slowed write) against pending entries;
    confirm exactly N files, no `-2` suffixes, one pass in the logs.

### Phase group C — release + dogfood

15. Sync works against a remote HTTPS instance (not localhost), demonstrating the
    `requestUrl` + `Token` auth path end-to-end over TLS. Verify: against the deployed
    prod instance once live, or any HTTPS-tunneled dev instance before then.
16. A GitHub release on `nick-vogel/obsidian-riverbed` carries `main.js` +
    `manifest.json` as assets, and BRAT installs the plugin from the repo reference
    into a test vault where it loads and syncs. Verify: BRAT "Add beta plugin" flow.
17. The README covers: BRAT install, manual install, creating a token in Riverbed
    (Settings → API tokens), configuring a self-hosted base URL, all settings, and the
    AC 5 token warning. Verify: follow it cold in a fresh test vault.
18. Dogfood: the plugin runs in the real Knowsmore vault; a save made in the Riverbed
    reader lands in `inbox/` with its rendered markdown and is indistinguishable from
    any other inbox capture to the sort pass. Verify: make a real save, run the normal
    flow. (Against the dev server is acceptable for closing this AC; re-confirm against
    prod after the deploy track completes — see Dependencies.)
19. Release hygiene for BRAT/store-forward-compat: `manifest.json` version ==
    release tag == `package.json` version, and `versions.json` maps the plugin version
    to `minAppVersion`. Verify: inspect the tagged release.

## Client / external dependencies

- **A running Riverbed instance** — the local dev stack (riverbed repo, `:3000`,
  Mongo `:27019`) suffices for every AC except the prod half of 15/18. **The prod
  deploy is a separate track** (rollup PR #1 merge + R2 cutover, per
  `personal/riverbed/HANDOFF.md`); if it's late, v1 closes against dev/HTTPS-tunnel
  and the prod re-confirmation is a follow-up checklist item, not a blocker.
- **An API token** — Nick creates one in the reader (Settings → API tokens) per
  environment; needed from phase group A (AC 4).
- **GitHub repo `nick-vogel/obsidian-riverbed`** — must exist (private is fine for
  BRAT with a token, but public is the low-friction path and required for any future
  store listing; Nick's call at release time, default public since the code contains
  no secrets).
- **BRAT** — third-party plugin, install-time dependency for AC 16 only.

## Constraints

- Standard Obsidian plugin toolchain: TypeScript, esbuild bundle to `main.js`,
  `manifest.json` + `versions.json`, structured after the official sample plugin. pnpm
  (repo convention), no other runtime dependencies unless forced.
- All HTTP through Obsidian's `requestUrl` — never `fetch`/axios (CORS + mobile).
- Auth header is exactly `Authorization: Token <token>` — the outbox contract's scheme;
  `Bearer`/`JWT` are reserved by the server and will not authenticate.
- **Never ack before a confirmed write** — the contract's core promise (outbox-api.md
  "Ack semantics"); the failure path is `POST :id/error` + retry on next poll.
- Write `renderedMarkdown` verbatim — the plugin adds no frontmatter, no rewriting;
  templates are the server's job.
- Plugin id `riverbed`; repo `obsidian-riverbed` (community naming convention, no
  rename needed for a future store submission).
- No telemetry, no OpenPanel (plugin, not a web property; only talks to the user's own
  instance).
- Eng pipeline: net-new project → one project branch (`project/obsidian-riverbed-v1`),
  per-phase commits reviewed as they land, ONE rollup PR to main at the end.
- Asana project: Riverbed. Second brain:
  `/Users/nick/Library/Mobile Documents/iCloud~md~obsidian/Documents/Knowsmore/personal/riverbed`
  (the plugin is part of the Riverbed product; its docs sync to the same hub). Write
  both lines into the new repo's CLAUDE.md at scaffold time.

## Open questions

- **Public vs private GitHub repo at first release** — default public (see
  Dependencies); Nick confirms at phase group C. (Non-blocking: does not affect any
  phase A/B AC.)

Resolved at spec review (2026-07-24):
- **Default base URL** → ship `https://riverbedfeed.com` as the default (AC 3). Nick's
  call. Test-connection fails until prod cutover; correct for beta users once live,
  no later change needed.
- **Poll floor** → 5-minute floor in production builds, 1-minute permitted in dev
  builds (AC 3, AC 11). Nick's call. Prod-safe as the user base grows; pairs with the
  poll-frequency-as-tier lever in the reader's `monetization.md`.

## Review log

- 2026-07-24 — changes requested — 2 blocking / 7 advisory. Blocking: AC 8(b) named a
  non-contract, non-client-observable `syncError` field (rescoped to POST-200 + reader
  Outbox view); AC 15 was a story-less orphan and Story 4 was unproven (AC 15 now cited
  by Stories 1 and 4). Advisories folded: infra tags on ACs 1/2/5; poll floor + base
  URL resolved into AC 3; dedupe key + suffix iteration + identical-bytes recovery made
  explicit in AC 9; path-separator stripping added to AC 10; single-flight lock added as
  AC 20; AC 6 strengthened to diff all N files. Not folded (documented instead): AC 9
  pathological identical-bytes-and-name loss.
- 2026-07-24 — approved — 0 blocking / 4 advisory (round 2, independent Opus re-review
  confirmed both round-1 blockers resolved, no new blocking). Folded: AC 9 now states
  sanitize→dedupe→write order + identical-bytes-on-a-suffixed-slot recovery; dropped a
  mild AC-15 over-citation from Story 1. Carried (cosmetic, not gates): AC 20 out of
  numeric sequence (kept to avoid re-citing 15-19); public-vs-private repo (Nick at
  release).
