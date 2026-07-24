---
title: Obsidian Riverbed plugin — Phase 3: release + dogfood
status: approved
spec: ../../specs/obsidian-riverbed-v1.md
phase: 3
asana: 1216860986917917
created: 2026-07-24
updated: 2026-07-24
---

# Phase 3 — release + dogfood

Prove the plugin works over real TLS, ship an installable BRAT release with correct
version hygiene and a complete README, and run it in the real Knowsmore vault against a
live Riverbed instance. Drafted coarse, then sharpened by its just-in-time review-plan pass
(2026-07-24) once Phase 2 had actually shipped and the prod-deploy track's state was
known: every step below now carries an executable gate, and the deploy-track facts are
current as of that date.

## AC ledger

- **Closes this phase:** 15, 16, 17, 18, 19.
- **Already closed:** 1-14, 20 (Phases 1-2).
- **Open for later phases:** none — this is the final phase; no spec AC may remain open.

## Steps

### Step 1 — HTTPS end-to-end  → closes AC 15

Point the plugin at a non-localhost **HTTPS** Riverbed instance and confirm the
`requestUrl` + `Token` path works over TLS.

**Check prod readiness DIRECTLY, never by inference from PR #1's merge status.** Run
`curl -o /dev/null -w '%{http_code}' https://riverbedfeed.com/` and require a 2xx/3xx. PR #1
merged 2026-07-24 and that did NOT mean the deploy track landed: as of this writing the
`riverbed` repo's v1 Phase 6 (Dockerfile → GHCR → Dokploy → DNS → R2) is a few steps in,
prod does not resolve, and the long pole is Nick's provisioning task (Asana
`1216878932705765`, due 2026-07-31). If prod is not answering, use an HTTPS tunnel
(`cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000`) in front of the dev
stack — the spec explicitly permits closing AC 15 that way.

Set the plugin's base URL to the HTTPS origin and enter a token minted **against that
instance** (a dev-stack token is not valid against prod and vice versa; a wrong-environment
token surfaces as the Phase 1 "authentication failed" outcome, not as a sync failure).

Verify (reuse Phase 2's byte-level method, not a "looks synced" eyeball):
1. `curl -s https://<host>/app-outbox -H "Authorization: Token $T" > pre.json` with at
   least one entry pending.
2. Run `Riverbed: Sync now`.
3. `diff` each written file against its entry's `renderedMarkdown` from `pre.json` — all
   byte-identical.
4. Re-`curl` `GET /app-outbox` → the delivered entries are no longer pending.

### Step 2 — BRAT-installable release + version hygiene  → closes AC 16, AC 19

Create the GitHub repo `nick-vogel/obsidian-riverbed` (confirmed not to exist yet), push
the branch, and cut a GitHub release whose assets are `main.js` + `manifest.json`, with
`versions.json` present in the repo.

**Tag exactly `0.1.0` — bare semver, NO `v` prefix.** This is the single most common
Obsidian-plugin release mistake and it fails AC 19 literally: AC 19 requires the tag to
EQUAL the manifest version, and `v0.1.0` does not equal `0.1.0`. Obsidian's own releasing
guide documents the bare form (`git tag -a 1.0.1 -m "1.0.1"`).

Hygiene to enforce: `manifest.json` version == release tag == `package.json` version
(all three currently read `0.1.0`), and `versions.json` maps that version to
`minAppVersion` (`1.5.0`).

Verify:
1. `gh release view 0.1.0 --json tagName,assets` shows tag `0.1.0` and both assets
   attached.
2. `node -e "const m=require('./manifest.json'),p=require('./package.json'),v=require('./versions.json'); if(m.version!==p.version||!v[m.version]) process.exit(1)"`
   exits 0.
3. In a FRESH test vault with BRAT installed, "Add beta plugin" against
   `nick-vogel/obsidian-riverbed` installs it; it enables with zero console errors; and
   with a base URL + token configured it completes a sync that writes a pending entry.

*(Dependencies for THIS step: the GitHub repo must exist and be pushable; BRAT installed
in the fresh test vault; **and** a reachable Riverbed instance plus a token entered in that
vault's settings — without those last two the "performs a sync" half of the gate cannot
run at all. Public-vs-private is Nick's call here; BRAT supports private repos with a
token, public is the low-friction path and is required for any future store listing.)*

### Step 3 — Complete README  → closes AC 17

Flesh the README out to cover, followed cold in a fresh vault: BRAT install, manual
install, creating a token in Riverbed (Settings → API tokens), configuring a self-hosted
base URL, every setting (including that the interval floor is 5 minutes in a release build
and that the field validates when you LEAVE it, not as you type), and the Phase 1
token-security warning.

Verify: a cold run through the README in a clean test vault, following only what it says
and without consulting the code or asking the author, reaches a plugin that completes a
sync. Any step that required outside knowledge is a README gap: fix it and re-run.

### Step 4 — Dogfood in the real vault  → closes AC 18

**Install the PRODUCTION build** — the BRAT release from Step 2, or a `pnpm build`
artifact. Never a `pnpm dev` build. A dev build carries the `riverbed-fail-write`
fault-injection sentinel and a 1-minute interval floor; neither belongs anywhere near the
real vault, and AC 18 exists to prove the shippable artifact works, not the test rig.
Confirm before pointing it at real data: `grep -c riverbed-fail-write main.js` returns `0`.

Install into the real Knowsmore vault's `.obsidian/plugins/riverbed/` (that path is
gitignored there, re-verified 2026-07-24, so the token in `data.json` will not be
committed), configure folder `inbox` and a real token, and make a save in the reader.

Verify: the capture lands in `inbox/`, and then **run the normal sort pass**
(`/km:sort-inbox`) over the inbox including that capture. It must route and file exactly
like any other capture, with no special-casing and no manual repair. The spec's bar is
"indistinguishable to the sort pass", which is an executed check, not an assessment that it
looks about right.

(Closing against the dev server is acceptable; re-confirm against prod once the deploy
track completes — a follow-up checklist item, not a blocker on this phase.)

## Traceability

| Spec AC | Proven by |
|---|---|
| 15 (HTTPS + Token end-to-end over TLS) | Step 1 gate |
| 16 (BRAT-installable release with assets) | Step 2 gate |
| 17 (README followed cold to a working plugin) | Step 3 gate |
| 18 (dogfood: real save lands in Knowsmore inbox/) | Step 4 gate |
| 19 (version == tag == package; versions.json map) | Step 2 gate |

## Risks

| Risk | Fallback |
|---|---|
| Prod instance not yet deployed when this phase runs (LIKELY: prod does not resolve as of 2026-07-24, and the deploy track is blocked on Nick's provisioning, due 2026-07-31) | AC 15 closes against an HTTPS tunnel in front of dev; the prod re-confirmation for 15/18 is an explicit follow-up, not a phase blocker (spec Dependencies). |
| BRAT install requires a public repo and Nick wants private | BRAT supports private repos with a token; or defer the public flip. Either closes AC 16; the choice is Nick's at Step 2. |
| README cold-run reveals a gap only visible to a fresh user | Fix the gap and re-run; the cold-run IS the gate, so a miss is caught here, not in the field. |
| The released 0.1.0 turns out broken | There is no prior version to roll back to, so roll FORWARD: fix, bump all three version fields, add the new entry to `versions.json`, and cut `0.1.1`. Never force-push or move an existing tag — BRAT and any installed client cache by tag, so a moved tag ships different bytes under a version someone already has. |
| A later release does not upgrade cleanly over an installed beta | Out of scope for v1 (one release), but `versions.json` must ACCUMULATE entries rather than be replaced, or older Obsidian versions lose their compatibility mapping. Note for whoever cuts 0.1.1. |

## Verification (end-to-end for the phase)

1. A sync round-trips over HTTPS against a non-localhost instance, with each written file byte-identical to its `renderedMarkdown` and the outbox drained.
2. A GitHub release tagged `0.1.0` (bare semver, no `v`) carries `main.js` + `manifest.json`; manifest == tag == package version and `versions.json` maps it; BRAT installs it into a fresh vault where it loads clean and syncs.
3. The README, followed cold in a clean vault with no outside knowledge, yields a working plugin.
4. A PRODUCTION build in the real Knowsmore vault delivers a real save into `inbox/`, and `/km:sort-inbox` files it exactly like any other capture.

**Note on the release and the rollup PR:** the release is cut from the project branch
before the single rollup PR to `main` merges. That is fine — GitHub release assets are
built artifacts and are ref-agnostic, and BRAT reads the release, not the default branch.

## Execution log

## Review log

- 2026-07-24 — **6 blocking / 4 advisory** (independent Sonnet review-plan, just-in-time).
  (1) The deploy-track description invited an implementer to infer "prod is live" from PR
  #1's merge, when prod does not resolve and the `riverbed` v1 Phase 6 deploy is only a few
  steps in, blocked on Nick's provisioning (due 2026-07-31). (2) No tag-format instruction,
  so a habitual `v0.1.0` tag would fail AC 19's literal version equality (Obsidian's
  convention is bare semver). (3) Step 2's gate needs a reachable instance and a token to
  run its "performs a sync" half, neither listed in its dependencies. (4) **Step 4 never
  said to dogfood the PRODUCTION build**, so a dev build carrying the `riverbed-fail-write`
  fault-injection sentinel and a 1-minute floor could have been pointed at the real
  Knowsmore vault. (5) Step 4's gate ("would sort normally") was weaker than AC 18's own
  verify ("run the normal flow") — an assessment where the spec asked for an executed sort
  pass. (6) Step 1's gate ("a save syncs end to end") was the vague-gate pattern, ignoring
  the byte-level method Phase 2 had already established. All six rewritten; the advisories
  (second-release upgrade path, release-vs-rollup-PR relationship, rollback stance) were
  folded into the Risks table and Verification section rather than deferred.
- 2026-07-24 — **APPROVED, 0 blocking / 3 advisory** (re-review). All six prior findings
  verified fixed against current repo reality rather than merely reworded: the reviewer
  independently confirmed prod does not resolve, that `riverbed` Phase 6 is Step 3 of 12,
  that all three version fields read `0.1.0`, that `nick-vogel/obsidian-riverbed` does not
  yet exist, and that `.obsidian/plugins/` is gitignored in the Knowsmore vault. It also
  EXECUTED the new gate commands rather than trusting them: ran `pnpm build` and confirmed
  `grep -c riverbed-fail-write main.js` returns `0` by real dead-code elimination (not a
  false negative), ran the Step 2 `node -e` version check against both the real files and a
  synthetic drifted case (exit 0 / exit 1), and confirmed `tagName` and `assets` are valid
  `gh release view --json` fields. The three advisories (a duplicated Review log header, a
  stale future-tense framing sentence, an uncited claim about BRAT's tag resolution) are
  fixed in this same pass. Status → approved.
