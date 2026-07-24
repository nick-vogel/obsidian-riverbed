---
title: Obsidian Riverbed plugin — Phase 3: release + dogfood
status: draft
spec: ../../specs/obsidian-riverbed-v1.md
phase: 3
asana: 1216860986917917
created: 2026-07-24
updated: 2026-07-24
---

# Phase 3 — release + dogfood

Prove the plugin works over real TLS, ship an installable BRAT release with correct
version hygiene and a complete README, and run it in the real Knowsmore vault against a
live Riverbed instance. This phase is intentionally coarser than 1-2; its just-in-time
review-plan pass will demand step-level detail once Phase 2 has actually shipped and the
prod-deploy track's state is known.

## AC ledger

- **Closes this phase:** 15, 16, 17, 18, 19.
- **Already closed:** 1-14, 20 (Phases 1-2).
- **Open for later phases:** none — this is the final phase; no spec AC may remain open.

## Steps

### Step 1 — HTTPS end-to-end  → closes AC 15

Point the plugin at a non-localhost **HTTPS** Riverbed instance and confirm the
`requestUrl` + `Token` path works over TLS (a full sync round trip). Use the deployed prod
instance if the deploy track (rollup PR #1 + R2 cutover, per `personal/riverbed/HANDOFF.md`)
has landed; otherwise an HTTPS tunnel (e.g. `cloudflared`/`ngrok`) in front of the dev
stack. Verify: a save syncs end to end over `https://`.

### Step 2 — BRAT-installable release + version hygiene  → closes AC 16, AC 19

Create the GitHub repo `nick-vogel/obsidian-riverbed` (public unless Nick chooses private
at this point — the one carried open question), push the branch, and cut a GitHub release
whose assets are `main.js` + `manifest.json` (and `versions.json` present in the repo).
Enforce hygiene: `manifest.json` version == release tag == `package.json` version, and
`versions.json` maps that version to `minAppVersion`. Verify: inspect the tagged release
(assets attached, versions aligned); in a fresh test vault, BRAT "Add beta plugin" against
the repo installs the plugin, which loads and performs a sync.

*(Dependency: the GitHub repo must exist and be pushable; BRAT installed in the test
vault. Public-vs-private is Nick's call at this step.)*

### Step 3 — Complete README  → closes AC 17

Flesh the README out to cover, followed cold in a fresh vault: BRAT install, manual
install, creating a token in Riverbed (Settings -> API tokens), configuring a self-hosted
base URL, every setting, and the Phase 1 token-security warning. Verify: a cold run
through the README in a clean test vault reaches a working, syncing plugin.

### Step 4 — Dogfood in the real vault  → closes AC 18

Install the plugin in the real Knowsmore vault, configure it (folder `inbox`, real
token), make a save in the Riverbed reader, and confirm the capture lands in
`inbox/` indistinguishable from any other inbox capture to the sort pass. Verify: a real
save appears in `inbox/` and would sort normally. (Closing against the dev server is
acceptable; re-confirm against prod once the deploy track completes — a follow-up
checklist item, not a blocker on this phase.)

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
| Prod instance not yet deployed when this phase runs | AC 15 closes against an HTTPS tunnel in front of dev; the prod re-confirmation for 15/18 is an explicit follow-up, not a phase blocker (spec Dependencies). |
| BRAT install requires a public repo and Nick wants private | BRAT supports private repos with a token; or defer the public flip. Either closes AC 16; the choice is Nick's at Step 2. |
| README cold-run reveals a gap only visible to a fresh user | Fix the gap and re-run; the cold-run IS the gate, so a miss is caught here, not in the field. |

## Verification (end-to-end for the phase)

1. A sync round-trips over HTTPS against a non-localhost instance.
2. A tagged GitHub release carries `main.js` + `manifest.json`; versions align; BRAT installs and syncs.
3. The README, followed cold in a clean vault, yields a working plugin.
4. A real save in the reader lands in the Knowsmore `inbox/` and sorts normally.

## Execution log

## Review log
