# Master-plan: Spill 1 pilot-klar stack — 2026-04-24

**Formål:** Samlet plan for å oppnå **100% funksjonell paritet med legacy** for en full dag i bingolokalet — bong-salg, kaffe-salg, terminal-drift, hovedspill 1-kjøring på TV-skjerm og spiller-klient.

**Basert på:** 3 research-rapporter levert 2026-04-24 — R1 Spill 1 backend, R2 Agent-workflow, R3 Hall-binding.

## TL;DR

| Område | Gaps | P0 | P1 | P2 | Dev-dager |
|---|---:|---:|---:|---:|---:|
| Spill 1 backend (R1) | 26 | 6 | 11 | 9 | 50-74 |
| Agent-workflow (R2) | 15-20 PR-er | — | — | — | matcher Fase 1 |
| Hall-binding (R3) | 5 kritiske | 3 | 2 | — | 8-12 |
| **Sum unike** | **~45** | **~13** | **~18** | **~14** | **60-90 dev-dager** |

**Pilot-absolutt-minimum:** ~30-40 dev-dager (kun P0 + kritisk P1).

## 1. Kritiske regulatoriske / pilot-blokkere (må fikses før simulert dag kan kjøres)

### 1.1 Compliance multi-hall-bug 🚨
**Fra R3 §9.3.** `Game1TicketPurchaseService` binder kjøp til master-hallens house-account i ComplianceLedger, uavhengig av hvilken hall som faktisk solgte. §71-rapporter per hall blir feil for multi-hall-spill.

**Blokker:** Ja — Lotteritilsynet-risiko.
**Estimat:** 2-3 dev-dager.

### 1.2 Settlement maskin-breakdown mangelfull 🚨
**Fra R2 Top-5 #2.** Legacy `settlement`-model har 93 linjer (Metronia/OKBingo/Franco/Otium IN/OUT + NT/Rikstoto Dag+Totalt + Rekvisita + Servering + Bilag m/upload + Bank + Gevinst overført + Annet + Drop-safe + Shift-diff). Ny `AgentSettlement` har 8 kolonner.

**Blokker:** Regnskaps-paritet. Kan ikke simulere skift-slutt korrekt.
**Estimat:** 3-5 dev-dager.

### 1.3 Customer Unique ID (prepaid-kort) helt mangler 🚨
**Fra R2 Top-5 #1.** 1827-linjers `UniqueIdController` i legacy. Ny stack har kun `physical_ticket.uniqueId` (et annet konsept). Agent kan ikke opprette prepaid-kort med balance + 24h+ expiry + print.

**Blokker:** Ja — kunder med medlemskort kan ikke spille.
**Estimat:** 4-6 dev-dager.

### 1.4 `transferHallAccess` mangler 🚨
**Fra R3 Top-5 #1.** 60-sekunders handshake for runtime master-overføring i legacy. Ny stack kan kun endre master via DB-edit + ny runde.

**Blokker:** Produksjon — hvis master-hall blir uoperasjonell midt i dagen er det DB-admin-job.
**Estimat:** 2-3 dev-dager.

### 1.5 Manuell Bingo-check UI 🚨
**Fra R1 Top-5 #2.** `PAUSE Game → Enter Ticket ID → Pattern-validate → Reward/Cashout`. **Delvis fikset i PR #433** men må verifiseres end-to-end under faktisk runde.

**Blokker:** Hvis PAUSE-flyt ikke koblet til PR #433, blokker for bingo-check.
**Estimat:** 1-2 dev-dager (verifisering/kobling).

### 1.6 Mystery Game client-overlay integrasjon 🚨
**Fra R1 Top-5 #1.** Engine + migration finnes (PR #430), men klient-overlay i live spill-runde må verifiseres (preview fungerer, men ikke sjekket i live-flyt).

**Blokker:** Mystery Game sub-game kan ikke kjøres.
**Estimat:** 1-2 dev-dager.

**Sum kritiske:** 13-21 dev-dager.

## 2. P0 pilot-blokkere (uten disse kan man ikke kjøre en full dag)

### 2.1 Legacy-portede cash-inout-sider må kobles til agent-sidebar
**Fra R2 Top-5 #4.** Komplette sider finnes allerede (`CashInOutPage`, `BalancePage`, `ProductCartPage`, `SettlementModal`) under `apps/admin-web/src/pages/cash-inout/` — men er ikke i agent-sidebar. Agenten ser "Kommer snart" for `/agent/cash-in-out`, `/agent/unique-id`.

**Estimat:** 1-2 dev-dager (wire-up + sidebar-oppdatering).

### 2.2 Lucky Number Bonus-payout ved Fullt Hus
**Fra R1 Top-5 #3.** Legacy `GameProcess.js:420-429` har bonus når Fullt Hus vinnes på lucky-ball. Ikke i `Game1PayoutService`.

**Estimat:** 1 dev-dag.

### 2.3 Jackpott daglig akkumulering (+4000/dag, max 30 000)
**Fra R1 Top-5 #4.** Vi har Innsatsen-pot (PR #432+#434), men ikke den store daglige jackpotten.

**Estimat:** 2-3 dev-dager.

### 2.4 Per-agent ready-state
**Fra R2 Top-5 #3.** NextGamePanel har kun `selfReady: boolean`. For multi-agent-hall trengs per-agent-liste.

**Estimat:** 1-2 dev-dager.

### 2.5 Shift-end-checkboxes
**Fra R2 Top-5 #5.** "Distribute winnings" + "Transfer register ticket" ikke koblet.

**Estimat:** 1 dev-dag.

### 2.6 Ticket-farger utvidet til legacy 11-farge-palette
**Fra R2.** Redusert fra 11 (legacy) til 3 familier. Må utvides.

**Estimat:** 1-2 dev-dager.

### 2.7 Auto-escalation når master ikke starter
**Fra R3 Top-5 #4.** Spill henger i `ready_to_start` til end-of-day-tick.

**Estimat:** 1 dev-dag.

### 2.8 Per-hall payout-cap og "hall går tom"-deteksjon
**Fra R3 risiko #3.** Payout uten sjekk mot `app_halls.cash_balance`.

**Estimat:** 1-2 dev-dager.

**Sum P0:** 9-13 dev-dager.

## 3. P1 (pre-GA — før første hall går prod)

- Jackpott multi-threshold (50→55→56→57) — 2 dager
- Franco + Otium maskin-adaptere — 4-6 dager
- TV "andre haller klare"-UI-event — 1 dag
- `excluded_hall_ids_json` implementering — 1 dag
- Overlappende scheduled_games constraint — 1 dag
- 7 øvrige P1 fra R1 — ~15-20 dager

**Sum P1:** 24-30 dev-dager.

## 4. P2 (post-pilot)

- Dual multi-hall-schema opprydding — 2 dager
- Elvis Replace full paritet — 2 dager
- Number Completed / Pick Any Number (Spill 3-spesifikk) — 3 dager
- Terminal-kiosk-modus + screensaver — 3 dager
- TV `transferHallAccess`-events — 1 dag

**Sum P2:** 10-16 dev-dager.

## 5. Foreslått bølge-plan

### Bølge K1 — Compliance + Settlement (kritisk regulatorisk)
- Compliance multi-hall-bug fix
- Settlement maskin-breakdown utvidet
- Lucky Number Bonus-payout

**Parallell:** 2 agenter. Estimat: 4-6 dev-dager kalender, ~6-8 agent-timer.

### Bølge K2 — Agent-workflow (end-to-end pilot)
- Wire legacy-portede cash-inout-sider til agent-sidebar
- Customer Unique ID (prepaid-kort)
- Per-agent ready-state
- Shift-end-checkboxes
- Ticket-farger-palette utvidet

**Parallell:** 3 agenter. Estimat: 5-7 kalender, ~10-14 agent-timer.

### Bølge K3 — Hall-binding + Spill 1 runtime
- `transferHallAccess` handshake
- Auto-escalation + payout-cap
- Mystery Game client-overlay verifisering
- Manuell Bingo-check UI verifisering
- Jackpott daglig akkumulering

**Parallell:** 3 agenter. Estimat: 4-6 kalender, ~10-14 agent-timer.

**Etter K1+K2+K3:** pilot-klar for én simulert dag.

### Bølge P1 (etter K-bølger)
P1-punkter over — 24-30 dev-dager, kan parallelliseres 4-5 bølger à 2-3 agenter.

## 6. End-to-end simulert dag — checklist

Etter K1+K2+K3 skal følgende flow fungere uten DB-admin-intervensjon:

**08:00 Skift-start**
- [ ] Agent logger inn på terminal
- [ ] Åpner skift med daily balance (starting cash)
- [ ] Ser planlagte spill for dagen

**09:00 Pre-spill bong-registrering**
- [ ] Scanner Initial+Final ID for hver ticket-farge
- [ ] Stash listet opp
- [ ] F2 hotkey fungerer

**10:00 Første spill starter**
- [ ] Spillere kjøper tickets (fysisk + online + unique-id)
- [ ] Agent trigger "Start Next Game"
- [ ] Ready-popup viser per-agent-status
- [ ] Jackpot-confirm om aktuelt
- [ ] 2-min countdown broadcast
- [ ] Draw starter
- [ ] Rad 1-4 + Full House deles ut per regel
- [ ] Mini-game (rotasjon: Wheel/Chest/Mystery/ColorDraft) trigger
- [ ] Innsatsen pot utbetales hvis treff innen terskel

**10:30 Vinner henter premie**
- [ ] Agent trykker "Check for Bingo" → enter ticket → GO
- [ ] 5×5 grid popup viser vinnende pattern
- [ ] Reward-All eller per-ticket
- [ ] Cash-out til vinner

**Underveis:**
- [ ] Kaffe-salg via produkt-flyt
- [ ] Unique ID opprettet/oppdatert
- [ ] Add Money/Withdraw til både cash og online spillere

**Flere runder (11:00, 13:00, 15:00, 17:00, 19:00, 21:00):**
- Samme flyt som 10:00

**22:00 Skift-slutt**
- [ ] Physical Cashout pending → Reward All
- [ ] Control Daily Balance mot forventet
- [ ] Settlement: Metronia/OK Bingo/Franco/Otium + NT + Rikstoto + Rekvisita + Servering + Bilag + Bank
- [ ] Shift Log Out med distribute winnings + transfer checkbox
- [ ] Generate shift-rapport

**Hvis alle boksene er krysset: pilot-klar for én hall.**

**Hvis multi-hall (simuler 3 haller parallelt):**
- [ ] Alle haller kan signere ready
- [ ] Compliance-ledger binder hvert salg til riktig hall (§71)
- [ ] `transferHallAccess` fungerer hvis master-hall blir offline
- [ ] Per-hall payout-cap flagger før negativ balanse

## 7. Åpne spørsmål til Tobias

### Regulatoriske
1. **Jackpott multi-threshold (50→55→56→57):** R1 § spørsmål. Vi bekreftet tidligere at "50/55/56/57" var ulike terskler per sub-game, ikke eskalering i ett spill. Er dette fortsatt korrekt?
2. **Compliance multi-hall-bug:** skal vi fikse ved å binde compliance-entry til kjøpe-hallen? Krever arkitektur-avklaring.
3. **Settlement-kolonner 93 i legacy:** er alle 93 påkrevd, eller kan vi droppe noen for pilot?

### Forretning
4. **Customer Unique ID:** hvor mange prepaid-kort forventes i pilot? Ny modell eller port 1:1?
5. **Multi-agent-haller:** hvor mange agenter i en typisk hall?
6. **Franco + Otium:** reell bruk i pilot-haller? (Kun Metronia + OK Bingo bekreftet i ny stack)

### Tekniske
7. **Ticket-farger:** utvide til full 11-palette nå, eller gradvis?
8. **TV-skjerm legacy-design:** ville du ha Bølge 2 (ticket-ID + hall-spesifikke vinnere + mute + BINGO-indikator)?
9. **Dual multi-hall-schema:** skal `app_draw_sessions` (BIN-515) droppes?

## 8. Referanser

- R1: `docs/architecture/RESEARCH_SPILL1_BACKEND_PARITY_2026-04-24.md` (PR #436)
- R2: `docs/architecture/RESEARCH_AGENT_WORKFLOW_2026-04-24.md` (PR #438)
- R3: `docs/architecture/RESEARCH_HALL_SPILL1_BINDING_2026-04-24.md` (PR #437)
- Legacy audit: `LEGACY_MINIGAMES_AUDIT_2026-04-24.md` (merget)
- Wireframe-katalog: `WIREFRAME_CATALOG.md`
- Backend paritet-audit: `BACKEND_PARITY_AUDIT_2026-04-23.md`

## 9. Oppsummering for beslutningstaker

**Hvor nært er vi pilot-klar?**

- Backend infrastruktur: 95% (421 endpoints, 91 DB-tabeller, cron-jobs, e-post, FCM)
- Spill 1 runtime: ~80% (6 P0-gaps gjenstår)
- Agent-portal UI: ~40% (legacy-sider eksisterer, må bare kobles inn)
- Hall-koordinering: ~70% (3 kritiske bugs/mangler)
- Regulatorisk: 🚨 2-3 bugs må fikses før første hall

**Kritisk sti til simulert pilot-dag:**
K1 (4-6 dager) → K2 (5-7 dager) → K3 (4-6 dager) = **13-19 dev-dager parallelt med 2-3 agenter**

**Kritisk sti til produksjons-pilot:**
K1+K2+K3 + P1 + regulatorisk-avklaring = **35-50 dev-dager**

**Start:** Bølge K1 bør spawnes umiddelbart (compliance-bug er pilot-blokker).
