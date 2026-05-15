# Skills-katalog

> **AUTO-GENERERT — IKKE REDIGER MANUELT.** Denne filen overskrives av
> `.github/workflows/auto-generate-docs.yml` på hver push til main.
>
> Generator: `scripts/generate-architecture-docs.sh`
> Sist oppdatert: 2026-05-15T19:40:52Z
> Commit: `172233b9` (branch: `main`)

Liste over alle skills under `.claude/skills/`. Skills er prosjekt-spesifikk
domene-kunnskap som lastes inn i agent-kontekst når mønsteret matcher.

Skills som handler om payouts, regulatorisk compliance, live-rom-mandat, og
master-rolle-modell skal **alltid** lastes når de matcher — de inneholder
beslutninger som overstyrer default-oppførsel.

Antall skills: **25**

| Skill | Beskrivelse |
|---|---|
| `agent-portal-master-konsoll` | When the user/agent works with the Spill 1 master-konsoll UI in the admin-portal — the agent-portal cash-in-out box, hall-status pills, master-actions buttons, JackpotSetupModal — in the Spillorama bingo platform. Also use when they mention Spill |
| `agent-shift-settlement` | When the user/agent works with the agent shift lifecycle, cash-in/cash-out, daily-balance control, or end-of-day settlement (BIN-583) in the Spillorama bingo platform. Also use when they mention AgentShiftService, AgentSettlementService, AgentTransac… |
| `anti-fraud-detection` | When the user/agent works with anti-fraud / velocity / bot-detection signals on wallet mutations in the Spillorama bingo platform (BIN-806 / A13). Also use when they mention AntiFraudService, AntiFraudWalletAdapter, app_anti_fraud_signals, fraud-risk… |
| `audit-hash-chain` | When the user/agent works with the hash-chain audit-trail used for Lotteritilsynet-traceability in the Spillorama bingo platform. Also use when they mention AuditLogService, app_compliance_audit_log, app_audit_anchors, prev_hash, curr_hash, entry_has… |
| `bong-design` | When the user/agent works with the Spillorama bong-card visual design — header layout, BINGO-letters, cell styling, FREE-celle, single vs triple-design. Also use when they mention BingoTicketHtml, BONG_COLORS, bong-design.html preview, BINGO_LETTER |
| `buy-popup-design` | When the user/agent works with the Game1BuyPopup ticket-purchase modal — premietabell, ticket-rows (Liten/Stor × 3 farger), stepper, "Du kjøper"-summary chips, or the kjopsmodal-design.html mockup. Also use when they mention Game1BuyPopup, BuyPop |
| `candy-iframe-integration` | When the user/agent works with Candy integration, the wallet-bridge, /api/games/:slug/launch, /api/ext-wallet/* endpoints, iframe-overlay, eller postMessage-protokoll mellom Candy og host. Also use when they mention candy, candy-slug, ext-wallet, ext… |
| `casino-grade-testing` | When the user/agent works with tests for the live-room architecture in the Spillorama bingo platform. Also use when they mention chaos-test, vitest, tsx --test, playwright, integration-test, snapshot-test, mutation-test, stryker, bug-resurrection, WA… |
| `customer-unique-id` | When the user/agent works with the Customer Unique ID (prepaid-kort) for walk-in players in the Spillorama bingo platform (BIN-587). Also use when they mention UniqueIdService, UniqueIdStore, app_customer_unique_ids, app_unique_id_transactions, prepa… |
| `database-migration-policy` | When the user/agent works with database schema migrations in the Spillorama bingo platform. Also use when they mention migration, app_*-tabell, CREATE TABLE, ALTER TABLE, schema-evolution, MED-2, idempotent migration, render-deploy, prod-migrate, ADR… |
| `debug-hud-gating` | Gate-strategi for debug-HUD + event-log-panel i Spillorama spillerklient. Use when the user or agent works with debug-HUD, event-log-panel, debug-gating, isDebugHudEnabled, mountDebugHud, DebugEventLogPanel, ConsoleBridge, FetchInstrument, ErrorHandl… |
| `dr-runbook-execution` | When the user/agent works with disaster recovery, backup-drills, incident-response, or pilot-stability runbooks for the Spillorama bingo platform. Also use when they mention DR, disaster recovery, restore, backup, drill, RPO, RTO, incident-response, … |
| `goh-master-binding` | When the user/agent works with Group of Halls (GoH) and the master-hall role for Spill 1 in the Spillorama bingo platform. Also use when they mention app_hall_groups, app_hall_group_members, master_hall_id, group_hall_id, transferHallAccess, Game1Tra… |
| `health-monitoring-alerting` | When the user/agent works with R7 health-endpoints or R8 alerting for the Spillorama bingo platform. Also use when they mention /api/games/spill[1-3]/health, GameRoomHealth, RoomAlertingService, R7, R8, BIN-814, BIN-815, health-endpoint, p95-latency,… |
| `live-room-robusthet-mandate` | When the user/agent works with rom-arkitektur, socket-events, draw-tick, ticket-purchase, wallet-touch fra rom-events, eller pilot-gating-tiltak (R1-R12). Also use when they mention RoomAlertingService, SocketIdempotencyStore, EngineCircuitBreakerPor… |
| `pengespillforskriften-compliance` | When the user/agent works with pengespillforskriften compliance, prize caps, organisation distribution (§11), mandatory pause (§66), or daily reporting (§71) in the Spillorama bingo platform. Also use when they mention compliance-ledger, Complianc |
| `pm-orchestration-pattern` | When the user/agent acts as PM-AI orchestrating parallel agents on the Spillorama bingo platform. Also use when they mention PM-orchestration, spawn agent, PR-first, done-policy, file:line, auto-pull, BACKLOG.md, gh pr merge --squash --auto, isolatio… |
| `preview-pages-protection` | When the user/agent works with the design-preview source files under `packages/game-client/src/{bong-design,kjopsmodal-design,premie-design,dev-overview,preview}/` — eller skal sammenligne prod-komponent mot mockup. Also use when they mention bong- |
| `spill1-center-top-design` | When the user/agent works with the Spill 1 `center-top` HTML overlay — the combo panel (mini-grid + premietabell) and action-panel (game name + jackpot + Forhåndskjøp/Kjøp flere/Start spill) rendered above the Pixi canvas. Also use when they men |
| `spill1-master-flow` | When the user/agent works with Spill 1 master-konsoll, plan-runtime, scheduled-game lifecycle, GoH-master-rom, or hall-ready-state. Also use when they mention master-actions, GamePlanRunService, GamePlanEngineBridge, Game1MasterControlService, Game1H… |
| `spill2-perpetual-loop` | When the user/agent works with Spill 2 (rocket / Tallspill / game_2), perpetual room loop, auto-tick draws, jackpot-mapping per draw-count, or Lucky Number Bonus. Also use when they mention Spill2ConfigService, Spill2GlobalRoomService, Game2Engine, G… |
| `spill3-phase-state-machine` | When the user/agent works with Spill 3 (monsterbingo / game_3), the sequential phase-state-machine, fixed-vs-percentage premie-modus, or pauseBetweenRowsMs. Also use when they mention Spill3ConfigService, Spill3GlobalRoomService, Game3Engine, Game3Ph… |
| `spinngo-databingo` | When the user/agent works with SpinnGo (Spill 4 / game5 / spillorama-slug), databingo classification, the 30%-til-organisasjoner-regel, the 2500 kr single-prize-cap, or 60-ball 3×5-grid + ruletthjul. Also use when they mention game5, spillorama-slug |
| `trace-id-observability` | When the user/agent works with logging, tracing, or correlation across the Spillorama bingo platform. Also use when they mention traceId, correlation-id, MED-1, observability, structured-logging, trace-propagation, Socket.IO trace, DB-query-trace, As… |
| `wallet-outbox-pattern` | When the user/agent works with wallet-mutating code, payout, ticket-purchase, idempotency-keys, REPEATABLE READ isolation, hash-chain audit, eller wallet-reconciliation. Also use when they mention WalletAdapter, walletAdapter, PostgresWalletAdapter, … |
