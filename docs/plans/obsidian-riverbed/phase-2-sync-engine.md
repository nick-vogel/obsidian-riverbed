---
title: Obsidian Riverbed plugin — Phase 2: sync engine
status: draft
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
far. All work against the local dev stack (`:3000`, Mongo `:27019`).

### Step 1 — `Sync now` writes pending entries verbatim  → closes AC 6

Build: extend `src/outboxClient.ts` with `getPending(): Promise<OutboxItem[]>` (GET
`/app-outbox`, `Token` auth, returns `res.json.items`). Add `runSync()` that fetches
pending and, for each entry, writes `renderedMarkdown` to `<folder>/<suggestedFilename>`
via `vault.create(path, renderedMarkdown)`. Register the command `Riverbed: Sync now`
(`addCommand`) calling `runSync()`.

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

Build: add `reportError(id, reason)` (POST `/app-outbox/:id/error` with `{reason}`). Wrap
each entry's write in try/catch: on success -> `ack(id)`; on write failure -> `reportError(id,
<message>)` and **do not** ack (leave it pending for the next pass). Add a dev-only fault
injection (guarded by `IS_DEV`, e.g. a settings-hidden "fail next write" flag or a
filename sentinel) so a single entry's write can be forced to throw; document the method
in a code comment.

Verify: induce a write failure for one of several pending entries, run `Sync now`. The
failed entry (a) still appears in `GET /app-outbox` (not acked); (b) its
`POST /app-outbox/:id/error` returned 200 and the reader's **Outbox view** shows that
entry as failed with a Retry affordance (the plugin never reads the reason back — there is
no such field on GET); the other entries delivered and acked. Remove the fault, run
`Sync now` -> the previously-failed entry is now written and acked.

### Step 4 — Folder auto-create + filename sanitization  → closes AC 10, AC 12

Build: before writing, ensure `<folder>` exists — `getAbstractFileByPath(folder)`; if
absent, `vault.createFolder(folder)` (guard the already-exists throw). Add
`sanitizeFilename(name)`: replace characters Obsidian forbids (`* " \ / < > : | ?` and
control chars) with `-`, AND strip any path separator (`/`, `\`) and `..` segment so the
result is a bare filename that cannot escape `<folder>` (defense in depth; the contract
promises a plain filename but a buggy/hostile server must not cause traversal). Use the
sanitized name for both the write path and the dedupe key (Step 5).

Verify: delete `<folder>`, run `Sync now` -> folder is created and files land in it.
Craft a dev entry whose `suggestedFilename` contains a forbidden char and a `../` prefix
(custom capture template) -> after sync the file exists **inside** `<folder>` with a
safe, separator-free name; nothing is written outside the folder.

### Step 5 — Collision-safe dedupe  → closes AC 9

Build: in `runSync()`, before writing to the sanitized target path, check
`getAbstractFileByPath(path)`. If a file exists there: read it (`vault.read`) and compare
bytes to `renderedMarkdown`. **Identical** -> skip the write, `ack(id)` (safe
crash-between-write-and-ack recovery). **Different** -> iterate `name-2.md`, `name-3.md`,
… : skip any suffixed slot that exists with *different* bytes, reuse-without-writing any
suffixed slot that exists with *identical* bytes (then ack), else write the first free
slot and ack.

Verify: pre-create three cases in `<folder>` before a sync of matching entries — (a) a
file at the target name with identical bytes -> no new file, entry acked; (b) at the
target name with different bytes -> new `name-2.md` written, entry acked; (c) both target
and `name-2.md` occupied with different bytes -> `name-3.md` written. Inspect folder +
`GET /app-outbox` (empty) after.

### Step 6 — Single-flight lock  → closes AC 20

Build: guard `runSync()` with a re-entrancy flag (a `private syncing = false` or an
in-flight promise). A call while a pass is running is skipped or coalesced, never run
concurrently.

Verify: with several entries pending and an artificially slowed write (dev flag),
trigger `Sync now` twice in immediate succession -> exactly N files, **no** spurious
`-2` suffixes, and the log shows a single pass (the second call short-circuits).

### Step 7 — Auto-sync on startup + interval  → closes AC 11

Build: in `onload()`, call `runSync()` once (startup), and
`registerInterval(window.setInterval(() => runSync(), intervalMinutes * 60_000))` so it
auto-clears on unload. Re-register the interval when the interval setting changes.

Verify: set the interval to the dev floor (1 min), make a save in the reader, start a
stopwatch -> the file appears in the vault within one interval + 30s slack with no manual
command.

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
| 8 (ack-only-on-write; error POST + reader Outbox; retry) | Step 3 gate |
| 9 (collision dedupe, identical/different/suffix-iterate) | Step 5 gate |
| 10 (sanitize forbidden chars + strip separators/..) | Step 4 gate |
| 11 (auto-sync startup + interval timing) | Step 7 gate |
| 12 (missing folder created) | Step 4 gate |
| 13 (non-fatal failure + recovery) | Step 8 gate (a) |
| 14 (Notice gated on toggle; status bar always) | Step 8 gate (b) |
| 20 (single-flight lock) | Step 6 gate |

## Risks

| Risk | Fallback |
|---|---|
| `vault.read` byte-comparison mismatches on trailing-newline normalization | Compare against the exact `renderedMarkdown` string; if Obsidian normalizes on write, document the normalization and compare post-normalization consistently (dedupe stays correct as long as the same transform is applied both sides). |
| Dev fault-injection is awkward to wire without leaking into prod builds | Gate strictly behind `IS_DEV`; a filename sentinel (e.g. a magic substring only used in a crafted dev entry) keeps prod paths untouched. |
| `registerInterval` re-registration on settings change leaks timers | Clear the prior interval id before registering a new one; verify only one pass fires per interval in Step 7's log. |
| Reader Outbox view state for AC 8 depends on reader UI being present | The failed-state/Retry surface is the reader's; if unavailable at verify time, fall back to confirming the entry is non-acked in `GET /app-outbox` and the error POST returned 200 (the two client-observable halves). |

## Verification (end-to-end for the phase)

1. `Sync now` with N pending -> N verbatim files, all acked, re-sync is a no-op.
2. Induced write failure -> not acked, error POST 200, reader shows failed+Retry, retried next pass.
3. Missing folder auto-created; forbidden-char/`../` filename sanitized inside the folder.
4. Collision cases (identical / different / double-collision) resolve without data loss.
5. Two rapid `Sync now` -> no overlap, no spurious suffix.
6. Auto-sync delivers a fresh save within interval+30s.
7. Server-down is non-fatal and recovers; "Synced N" Notice respects the toggle; status bar always updates.

## Execution log

## Review log
