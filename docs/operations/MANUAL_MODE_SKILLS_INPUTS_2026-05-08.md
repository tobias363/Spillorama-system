# SummonAIkit Manual Mode — Spillorama domene-skills

**Status:** Inputs klare for `/saikit-manual`-kommandoen.
**Sist oppdatert:** 2026-05-08
**Eier:** Tobias Haugen (teknisk lead) + PM-AI
**Formål:** Custom domene-skills som auto-aktiveres når agenter rører relevant kode, supplement til eksisterende fundament-doc-er.

---

## Hvorfor disse skills

Vi har solide fundament-doc-er (SPILL1/2/3-implementation-status, mandat, payout-regler) men agenter glemmer/unnviker å lese dem før de begynner. Manual Mode-skills løser dette ved å **automatisk aktivere** relevant kontekst når agenten berører tilhørende kode-områder.

Direktiv fra Tobias 2026-05-08:
> *"Veldig opptatt av at vi har best mulig fundament og har arkitektur og dokumentasjon slik at det aldri er noe spørsmål hvis noen skal inn å gjøre endringer."*

---

## Hvordan bruke denne filen

For hver skill, kjør i Claude Code:

```
/saikit-manual
```

Lim inn de 4 feltene fra tabellen under. Velg modell (Sonnet for de fleste, Opus for Bølge 1+2 fordi de inneholder kompleks regulatorisk kontekst).

**Vedlikehold:** Hvis fundament-doc endres (eks. SPILL1_IMPLEMENTATION_STATUS får ny seksjon), oppdater også tilsvarende skill via `/saikit-manual --update <name>` eller regenerer.

---

## Bølge 1 — Kjerne-arkitektur per spill (LAGES NÅ — kritisk pilot-fundament)

### 1. `spill1-master-flow`

**Kontekst:** Plan-runtime + master-actions + scheduled-game lifecycle for Spill 1. Adresserer ID-forvirringen som kostet oss ~4 timer denne sesjonen (PR #1041 patch-spiral).

| Felt | Verdi |
|---|---|
| **Skill Name** | `spill1-master-flow` |
| **Description** | Plan-runtime, master-actions and scheduled-game lifecycle for Spill 1 (75-ball bingo) with GoH-master-hall coordination, GamePlanEngineBridge, and live-room robusthet |
| **Technology** | TypeScript service-laget i `apps/backend/src/game/` — GamePlanRunService, GameLobbyAggregator, GamePlanEngineBridge, Game1MasterControlService, Game1HallReadyService, Game1TransferHallService, Game1ScheduleTickService, Game1LobbyService — Postgres `app_game_plan_run` + `app_game1_scheduled_games` + `app_hall_groups` + `app_hall_group_members` — Socket.IO `spill1:lobby:{hallId}` + `spill1:scheduled-{gameId}` rooms |
| **Use Cases** | master starter/pauser/avansere/stopper Spill 1-sekvens, scheduled-game spawn fra plan-runtime via bridge, hall-ready-state per scheduled-game, runtime master-hall-overføring 60s handshake, klient-lobby aggregert state for shell, ID-disambiguation mellom plan-run-id og scheduled-game-id |
| **Modell** | Opus (kompleks — to ID-rom, regulatoriske grenser) |

**Lese-først-doc:** `docs/architecture/SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md`
**Audit:** `docs/architecture/PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT_2026-05-08.md`

---

### 2. `spill2-perpetual-loop`

**Kontekst:** ETT globalt rom + auto-tick + jackpot-mapping. Helt forskjellig arkitektur fra Spill 1.

| Felt | Verdi |
|---|---|
| **Skill Name** | `spill2-perpetual-loop` |
| **Description** | Spill 2 (rocket / 21-ball 3x3 full plate) ETT globalt rom med perpetual auto-spawn loop, jackpot-mapping per draw-count, Lucky Number Bonus, og åpningstid-guard (Lotteritilsynet) |
| **Technology** | TypeScript backend i `apps/backend/src/game/` — Spill2GlobalRoomService, Spill2ConfigService (singleton partial unique idx), Game2AutoDrawTickService, Game2Engine extends BingoEngine, Game2JackpotTable, PerpetualRoundOpeningWindowGuard — Postgres `app_spill2_config` — Socket.IO ROCKET-rom på `/game2`-namespace — `canonicalRoomCode.ts` mapper rocket → ROCKET globalt |
| **Use Cases** | auto-spawn ROCKET-runde ved minTicketsToStart, jackpot-utbetaling basert på draw-count (9/10/11/12/13/14-21 buckets), Lucky Number Bonus ved Fullt Hus, admin-config av åpningstid uten redeploy, perpetual loop som auto-restarter etter game-end, Spill2GlobalRoomService.buildVariantConfigFromSpill2Config bridge |
| **Modell** | Sonnet |

**Lese-først-doc:** `docs/architecture/SPILL2_IMPLEMENTATION_STATUS_2026-05-08.md`

---

### 3. `spill3-phase-state-machine`

**Kontekst:** Sequential rad-faser. UNIK for Spill 3 — verken Spill 1 eller Spill 2 har det.

| Felt | Verdi |
|---|---|
| **Skill Name** | `spill3-phase-state-machine` |
| **Description** | Spill 3 (monsterbingo / 75-ball 5x5 uten fri sentercelle) sequential phase-state-machine for Rad 1 til Rad 4 til Fullt Hus med pauseBetweenRowsMs auto-pause, ETT globalt rom og fixed/percentage premie-modus |
| **Technology** | TypeScript backend i `apps/backend/src/game/` — Spill3GlobalRoomService, Spill3ConfigService, Game3PhaseStateMachine, Game3Engine extends BingoEngine, Game3AutoDrawTickService — Postgres `app_spill3_config` (singleton) — checkpoint-recovery i BingoEngineRecovery for SIGKILL-survive — autoClaimPhaseMode-flag aktiverer phase-locked sequential evaluation |
| **Use Cases** | sequential rad-faser med automatisk pause (default 3000ms), phase-state checkpoint-serialization for restart-recovery, fixed kr-beløp eller percentage av runde-omsetning per fase, auto-spawn ved minTicketsToStart, Tobias-revert 2026-05-03 (PR #860 — kun monsterbingo, IKKE pattern-bingo med T/X/7/Pyramide) |
| **Modell** | Opus (state-machine + checkpoint-recovery er komplekst) |

**Lese-først-doc:** `docs/architecture/SPILL3_IMPLEMENTATION_STATUS_2026-05-08.md`

---

## Bølge 2 — Regulatorisk og sikkerhet (LAGES FØR PILOT)

### 4. `wallet-outbox-pattern`

| Felt | Verdi |
|---|---|
| **Skill Name** | `wallet-outbox-pattern` |
| **Description** | Casino-grade wallet med REPEATABLE READ + atomic outbox-enqueue + nightly reconciliation + hash-chain audit-trail for compliance (BIN-761 til BIN-764) |
| **Technology** | TypeScript wallet-laget — WalletAdapter-interface, AtomicOutboxEnqueue, ReconciliationService, HashChainAuditService, IdempotencyKeyService — Postgres med ISOLATION LEVEL REPEATABLE READ — alle wallet-touches MÅ gå via WalletAdapter-interface — outbox-pattern garanterer at INSERT INTO app_wallet_outbox skjer i samme DB-transaction som ledger-mutering |
| **Use Cases** | ticket-purchase debit, payout-credit ved seier, refund og compensating credits, idempotency-replay-safe operasjoner med 90-dager TTL cleanup, daglig audit-anchor og hash-chain verify-script, anti-fraud pre-commit decoration |
| **Modell** | Opus (regulatorisk + concurrency) |

**Lese-først-doc:** `docs/architecture/CASINO_GRADE_WALLET_*.md` (se docs/architecture/)

---

### 5. `live-room-robusthet`

| Felt | Verdi |
|---|---|
| **Skill Name** | `live-room-robusthet` |
| **Description** | Evolution Gaming-grade oppetidsmandat (99.95%+) for Spill 1, 2, 3 live-rom med R1 til R12 pilot-gating-tiltak, idempotente socket-events, cross-instance failover og chaos-test (BIN-810) |
| **Technology** | TypeScript backend rom-arkitektur, Socket.IO med Redis-adapter for cross-instance state, draw-tick-services, ticket-purchase-paths, wallet-touch fra rom-events via outbox, RoomAlertingService, health-endpoints `/api/games/spill[1-3]/health`, chaos-test scripts i `infra/chaos-tests/` |
| **Use Cases** | klient-reconnect med state-replay innen 3 sek, cross-instance failover etter SIGKILL uten å miste draws, idempotent socket-events med clientRequestId-dedup (5-min TTL Redis), per-rom resource-isolation (sirkel-bryter), R2 failover-test og R3 reconnect-test som pilot-gating |
| **Modell** | Opus (cross-instance state) |

**Lese-først-doc:** `docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md`

---

### 6. `pengespillforskriften-compliance`

| Felt | Verdi |
|---|---|
| **Skill Name** | `pengespillforskriften-compliance` |
| **Description** | Norsk pengespill-regulatoriske krav for Spillorama hovedspill og databingo med §11 distribusjon (15% Hovedspill, 30% Databingo), §66 obligatorisk pause, §71 daglig rapport, og 2500 kr single-prize cap kun for databingo |
| **Technology** | TypeScript compliance-laget — ComplianceLedger, AuditLogService, PrizePolicyManager.applySinglePrizeCap, ResponsibleGamingStore, ledgerGameTypeForSlug — Postgres `app_rg_compliance_ledger` med actor_hall_id-binding (PR #443 fix) — payout-audit-trail med hash-chain — gameType MAIN_GAME (Spill 1-3) vs DATABINGO (SpinnGo only) |
| **Use Cases** | §11-distribusjons-prosent ved settlement, §66 obligatorisk pause etter 60 min spilling, §71 daglig rapport-generering for Lotteritilsynet, single-prize-cap kun for databingo (ikke hovedspill) per SPILL_REGLER_OG_PAYOUT.md, compliance-ledger-events bindes til kjøpe-hall (ikke master-hall), åpningstid-håndhevelse for live-rom |
| **Modell** | Opus (regulatorisk-tunge regler) |

**Lese-først-doc:** `docs/architecture/SPILL_REGLER_OG_PAYOUT.md` + `docs/compliance/`

---

## Bølge 3 — Operasjonelle (POST-PILOT, LAVERE PRIORITET)

### 7. `goh-master-binding`

| Felt | Verdi |
|---|---|
| **Skill Name** | `goh-master-binding` |
| **Description** | Group of Halls med master-hall-rolle for Spill 1 koordinasjon, runtime master-overføring via 60s handshake, og hall-medlemskaps-håndhevelse med ON DELETE CASCADE |
| **Technology** | TypeScript backend i `apps/backend/src/game/` — Game1TransferHallService, Game1HallReadyService, GamePlanEngineBridge.resolveParticipatingHallIds + resolveGroupHallId — Postgres `app_hall_groups` + `app_hall_group_members` med ON DELETE CASCADE FK-constraints (PR #1038) |
| **Use Cases** | master-hall valg ved GoH-opprettelse, transferHallAccess 60s handshake for runtime master-overføring, hall-membership-filter ved scheduled-game spawn, defense-in-depth FK-cascade for orphan-prevention, ekskluder-hall master-action med audit |
| **Modell** | Sonnet |

---

### 8. `casino-grade-testing`

| Felt | Verdi |
|---|---|
| **Skill Name** | `casino-grade-testing` |
| **Description** | Test-mønstre for live-rom-arkitektur — chaos-tester, integration-tester med ekte Postgres, snapshot-tester per state, og R2/R3 failover-tests for Evolution Gaming-grade-mål |
| **Technology** | Vitest 3.1, tsx --test (Node built-in), Playwright for visual regression — `apps/backend/src/__tests__/chaos/`, `infra/chaos-tests/`, integration-tester med `WALLET_PG_TEST_CONNECTION_STRING` env-gate som skipper grasiøst, mock-kvalitet med presis SQL-regex-matching |
| **Use Cases** | snapshot-tester per state for aggregator-services (16+ tester), integration-test som skipper grasiøst uten DB-env, chaos-test som dreper backend-instans midt i runde, test som verifiserer phase-state survives SIGKILL, source-level wiring-regression-tests, slug-set-paritet-tester mot kanonisk mapping |
| **Modell** | Sonnet |

---

### 9. `agent-portal-master-konsoll`

| Felt | Verdi |
|---|---|
| **Skill Name** | `agent-portal-master-konsoll` |
| **Description** | Admin-portal master-konsoll UI-mønster for Spill 1 med single-source aggregator, master-actions, hall-status-pills, og polling fra GameLobbyAggregator |
| **Technology** | TypeScript admin-web i `apps/admin-web/src/pages/` — Spill1HallStatusBox, NextGamePanel, Spill1AgentControls, Spill1AgentStatus, JackpotSetupModal — Vite 6.3 + Pixi.js — `Spill1AgentLobbyState` type fra `packages/shared-types` — bruker ETT id (`currentScheduledGameId`) for master-actions |
| **Use Cases** | master-actions start/pause/resume/advance/stop, hall-ready-status-pills i sanntid, jackpot-setup-popup ved katalog-rad som krever det, data-action-knapper med disabled-state per status, polling 2s + socket-subscribe spill1:lobby:{hallId}, inconsistency-warnings vises som UI-feilmeldinger |
| **Modell** | Sonnet |

---

### 10. `pm-orchestration-pattern`

| Felt | Verdi |
|---|---|
| **Skill Name** | `pm-orchestration-pattern` |
| **Description** | PM-meta-skill for å orkestrere parallelle agenter i Spillorama-prosjektet med PR-first git-flyt, done-policy (file:line + merge to main + test), auto-pull etter merge, og Linear-issue-opprettelse |
| **Technology** | Bash + GitHub CLI (`gh pr create`, `gh pr merge --squash --auto --delete-branch`), Linear MCP (`mcp__55fb5f7d-*__save_issue`), git worktrees for isolerte agenter, Agent-tool med `isolation: worktree` for parallelle agenter, Skill loading protocol per turn |
| **Use Cases** | spawn parallelle agenter i isolerte worktrees uten kollisjon, PM eier `gh pr merge`, auto-pull etter PR-merge i Tobias' main repo, Linear-issue-opprettelse via MCP for pilot-blokkere, code-reviewer-agent som gate før merge for Evolution-grade-kvalitet, BACKLOG.md som strategisk oversikt parallelt med Linear |
| **Modell** | Sonnet |

---

## Eksekverings-rekkefølge

### Steg 1 — NÅ (Bølge 1)

```
/saikit-manual
# Fyll inn skill 1: spill1-master-flow

/saikit-manual
# Fyll inn skill 2: spill2-perpetual-loop

/saikit-manual
# Fyll inn skill 3: spill3-phase-state-machine
```

**Estimat:** 3 × 5 min (inkludert Opus-generering for skill 1 + 3) ≈ 15 min totalt.

### Steg 2 — Etter Bølge 1-fundament-refaktor er merget

```
/saikit-manual    # skill 4: wallet-outbox-pattern
/saikit-manual    # skill 5: live-room-robusthet
/saikit-manual    # skill 6: pengespillforskriften-compliance
```

**Estimat:** 3 × 5-7 min ≈ 20 min totalt.

### Steg 3 — Post-pilot polish

```
/saikit-manual    # skill 7: goh-master-binding
/saikit-manual    # skill 8: casino-grade-testing
/saikit-manual    # skill 9: agent-portal-master-konsoll
/saikit-manual    # skill 10: pm-orchestration-pattern
```

**Estimat:** 4 × 4-5 min ≈ 20 min totalt.

---

## Verifisering etter generering

For hver skill, etter generering:

1. Sjekk at filen havnet i `.summonai/skills/<name>.md` (eller hvor SummonAIkit lagrer skills)
2. Spawn en testaagent som rører relevant kode-område og verifiser at skillet aktiveres (skill skal vises i agent-kontekst)
3. Hvis skill ikke aktiveres → juster description til å inneholde flere keywords som matcher kode-områdets typiske termer

---

## Vedlikehold

**Når oppdateres en skill:**
- Når tilhørende fundament-doc endres (eks. SPILL1_IMPLEMENTATION_STATUS får ny seksjon)
- Når nye filer/services legges til i tilhørende kode-område
- Når Linear-issues lukkes som påvirker arkitekturen

**Hvordan oppdateres:**
```
/saikit-manual --update spill1-master-flow
```
Eller regenerer fra scratch hvis store endringer.

**Eier:** Tobias + PM-AI. Hver PR som endrer fundament-doc skal sjekke om tilhørende skill må oppdateres (CLAUDE.md kan ha checklist).

---

## Risiko-mitigering

| Risiko | Mitigering |
|---|---|
| Skill-eksplosjon → agent scanner mange skills per turn | Hold til 10 max; ikke duplisere tech-skills som redis/node |
| Skill og doc går ut av takt | Policy: PR som endrer fundament-doc MÅ oppdatere skill (eller lag eksplisitt "skip"-kommentar) |
| Skill aktiveres feilaktig | Vær spesifikk i description; "front-load søkeord" |
| Tar for lang tid å generere | Bølge 1 = 15 min totalt. Mindre enn én bug-fiks-runde |

---

## Referanser

- [SummonAIkit Manual Mode docs](https://summonaikit.com/docs/manual-mode)
- `docs/architecture/SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md`
- `docs/architecture/SPILL2_IMPLEMENTATION_STATUS_2026-05-08.md`
- `docs/architecture/SPILL3_IMPLEMENTATION_STATUS_2026-05-08.md`
- `docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md`
- `docs/architecture/SPILL_REGLER_OG_PAYOUT.md`
- `docs/architecture/PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT_2026-05-08.md`
- `CLAUDE.md` — 🚨 lese-først-blokker
