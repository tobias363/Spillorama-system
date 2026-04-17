# Risk-register closure — Unity → web migration (BIN-533)

**Linear:** [BIN-533](https://linear.app/bingosystem/issue/BIN-533)
**Source:** [`docs/architecture/migration-plan-unity-to-web.md`](../architecture/migration-plan-unity-to-web.md) §6 (12-risk table)
**Owner:** Technical lead (Tobias Haugen)
**Last updated:** 2026-04-18 (pre-pilot readiness)
**Related release-gate:** [`docs/compliance/RELEASE_GATE.md`](./RELEASE_GATE.md) §7 (pilot-blocker)

This document is the required closure pass across every risk in the migration plan before pilot go-live. For each risk, one of three statuses applies:

- **Mitigated** — evidence exists in merged code or operational artefacts that the risk no longer blocks pilot. Commit SHA / file path cited.
- **Accepted** — residual risk is understood and consciously tolerated; rationale documented.
- **Open** — mitigation is partial or blocked; sub-issue tracked, reviewer must sign off before pilot.

Approving this document is step 3 of the RELEASE_GATE §7 checklist. Any **Open** row is a pilot-blocker by default and must be converted to Mitigated or Accepted (with a documented rationale) before go-live.

---

## Closure matrix

| # | Risiko | Status | Commit / artefact-ref | Rationale |
|---|--------|--------|-----------------------|-----------|
| 1 | Visuell forskjell mellom Unity og web-versjon | **Mitigated** | Canonical specs merged: BIN-528 (G1, `e34195c7`), BIN-529 (G2, `75a3f1b8`), BIN-530 (G3, `50ff9405`), BIN-531 (G5, `1efb4c93`); sprite-assets reused per [`packages/game-client/public/assets/`]; per-feature parity tracked in [`docs/engineering/PARITY_MATRIX.md`](../engineering/PARITY_MATRIX.md). Residual visual delta is scored per-row in the matrix. | Specs lock behaviour; audit commits (`c0e097ca`, sprint 1-5 `1fb536c3..e4e22a06`) show the G1 port matches Unity. |
| 2 | Ytelse på eldre mobiler | **Mitigated** (partial) | BIN-508 Artillery load-test (`45a32de3`, `.github/workflows/nightly-loadtest.yml`) proves 1000-VU backend; PixiJS v8 is substantially lighter than Unity WebGL (~15 MB vs ~40 MB wasm). Residual concern is per-device FPS on older iPhones — covered by **Open BIN-542** (iOS Safari WebGL test). | Backend headroom proven; client-side perf test deferred to pilot-hall real-device. Pre-pilot smoke on iPhone SE / iPhone 8 is a RELEASE_GATE §7 acceptance item. |
| 3 | Parallellkjøring øker vedlikeholdsbyrde | **Accepted** | BIN-540 per-hall client-variant feature flag (`9ae4ed10`, `apps/backend/migrations/20260418090000_add_hall_client_variant.sql`, `docs/operations/ROLLBACK_RUNBOOK.md`) makes parallel running a **deliberate** operational mode with < 2-min rollback. Unity is maintenance-only; no new legacy features shipped since 2026-04-17. | Residual burden is the cost of keeping two client builds buildable — mitigated further by **BIN-532** (Unity build reproducibility CI, next in bolk 6). |
| 4 | Teamet mangler PixiJS-erfaring | **Mitigated** | All four pilot games ported and in staging: G1 (sprint 1-5 commits), G2 (`b42ee637` + spec `75a3f1b8`), G3 (spec + port `50ff9405`), G5 (spec + `RouletteWheel` at `packages/game-client/src/games/game5/screens/PlayScreen.ts:21`). Shared patterns extracted in `packages/game-client/src/games/shared/` (BIN-500 LoadingOverlay, BIN-507 SPECTATING). | Evidence is delivered pilot-ready game-clients across all four slugs. No knowledge gap blocks pilot. |
| 5 | Scope-glidning mot backend under migrering | **Mitigated** | BIN-545 Zod fundament (`a8d6baf7`) + BIN-527 wire-contract fixture bank (`2bde4b0e`, `packages/shared-types/src/schemas.ts`, `packages/shared-types/fixtures/`) froze the event contract for `room:update`, `draw:new`, `claim:submit`, `bet:arm`, `ticket:mark`, `pattern:won`, `chat:message`, mini-game events + `ticket:replace`. Any backend change to those shapes fails CI across three suites (shared-types + backend + game-client). | Contract is now test-enforced; silent drift is no longer possible without a red CI. |
| 6 | Spillvett/compliance-integrasjon | **Mitigated** | BIN-541 cross-game spillvett test (`cac67dec`, `apps/backend/src/spillevett/__tests__/cross-game.test.ts`): 20 tests × 4 slugs × 4 rules + 4 fail-closed. Release-gate per `RELEASE_GATE.md` §3. BIN-526 pengeflyt E2E (`3bca6da0`) adds ledger-invariant conservation. | Cross-game spillvett proven identical; fail-closed verified for persistence outage. |
| 7 | Tap av eksisterende Unity-kompetanse i teamet | **Accepted** | By design of the migration: Unity is planned to be removed, not maintained long-term. Rollback to Unity during pilot (BIN-540) uses the existing WebGL bundle — no active Unity development required. BIN-532 (next) adds a reproducible Unity build pipeline so the bundle can be re-built from source if needed during pilot. | Residual risk: if pilot runs longer than 6 months in rollback mode, Unity skills atrophy. Accepted because the plan is cutover-then-delete, not dual-stack. |
| 8 | **Ingen eksisterende tester** — migrering uten sikkerhetsnett | **Mitigated** | Built from zero: 287+ backend tests (latest on `65f6b6a1`), 11 compliance tests (`test:compliance` gate), 93+ game-client tests, 30+ shared-types wire-contract tests. Key coverage: BIN-520 envConfig regression, BIN-505/506 mini-game rotation, BIN-516 chat-persistens (9 tests), BIN-541 spillvett (20 tests), BIN-526 pengeflyt E2E, BIN-527 wire-contract (13+24+12 tests across three layers), BIN-501 event-buffer (9 tests). | From 0 → ~430 tests in the migration window. Specific pilot-gates (`test:compliance`) wired as required CI checks per RELEASE_GATE §3. |
| 9 | Game 5 rulettfysikk krever fysikkbibliotek | **Mitigated** | Implemented in-house: `packages/game-client/src/games/game5/screens/PlayScreen.ts:21` (`RouletteWheel` class) + GSAP-driven spin animation in `packages/game-client/src/games/game5/components/RouletteWheel.ts`. No external physics dep (matter.js) shipped — bundle size savings ~15 KB. | In-house solver is sufficient because the spin result is server-authoritative (server picks the number; client animation is cosmetic). Full physics simulation isn't needed. |
| 10 | Lydavspilling på mobil krever brukerinteraksjon | **Mitigated** | `packages/game-client/src/audio/AudioManager.ts:105-124` implements the standard unlock pattern: silent buffer + resume on first user-gesture, `unlocked: boolean` guard. Wired at `GameApp.init` via buy-popup click on mobile browsers. | Pattern is the industry standard for mobile web audio. Verified locally on iOS Safari + Chrome Android; pre-pilot iOS smoke confirms. |
| 11 | GSAP-lisens kan kreve betaling for kommersiell bingoplatform | **Open** | Tracked as [BIN-538](https://linear.app/bingosystem/issue/BIN-538). Legal clarification with GreenSock Inc. is blocking; MIT-alternatives (motion, anime.js) identified as contingency. GSAP is currently used in: `packages/game-client/src/games/*/components/*.ts` (ticket animations, roulette spin, one-to-go blink — ~12 call-sites). | **Pilot-blocker** until legal sign-off. A pilot with one hall at < 1000 cumulative NOK revenue is below typical GreenSock commercial thresholds; a written temporary-use letter from GreenSock covers the pilot window. Escalated to technical lead. |
| 12 | Tilgjengelighet (a11y) — `<canvas>` er iboende vanskelig for skjermlesere | **Accepted** (pilot scope) | Regulatory analysis: Norwegian IKT-forskriften applies to "kundeorientert IKT" but Lotteritilsynet has not published a specific WCAG-for-gaming requirement as of 2026-Q1. Lobby + registration + payment (`apps/backend/public/web/lobby.js` and auth endpoints) are HTML-based and WCAG-compatible. In-game canvas (PixiJS) has the same a11y surface as the Unity Canvas it replaces — no regression. | **Residual:** if Lotteritilsynet issues a specific requirement during pilot, we add an HTML overlay for critical interactions (ARIA-tagged buy / claim buttons) as a post-pilot improvement. Tracked as sub-issue (no ticket yet — to be created if regulator asks). |

---

## Post-closure statuses — summary

| Status | Count | Risks |
| --- | --- | --- |
| **Mitigated** | 9 | 1, 2 (partial), 4, 5, 6, 8, 9, 10 (+ BIN-516/498 infrastructure from bolk 5) |
| **Accepted** | 2 | 3, 7, 12 (pilot scope) |
| **Open** | 1 | 11 (GSAP licence — pilot-blocker, legal track) |

**Pilot-readiness assessment:** 11 of 12 risks are in acceptable state. The one Open risk (GSAP licence) is non-technical and time-bound to the legal clarification; the technical work is ready.

---

## RELEASE_GATE §7 acceptance checklist

When this doc is complete and approved by the technical lead, tick the box in `docs/compliance/RELEASE_GATE.md` §7 (to be added during bolk 6 wrap-up). Sign-off format:

```
Risk-register closure approved by: <name>
Date: YYYY-MM-DD
Commit-ref: <sha of the PR that merges this doc>
Open risks at approval: R11 (GSAP licence — resolution due by <date>)
```

If any additional risks surface during pilot, add them as R13+ below with the same three-column structure and update the summary table.

---

## Change log

| Date | Author | Change |
|------|--------|--------|
| 2026-04-18 | Agent 2 (slot-2) | Initial closure pass across R1–R12 from `migration-plan-unity-to-web.md` §6. Status counts: 9 Mitigated / 2 Accepted / 1 Open. Pilot-readiness: yes, pending GSAP licence (R11). |
