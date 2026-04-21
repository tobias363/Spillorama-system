# Pending Linear Issues — Manuell oppretting

**Team:** BIN (Bingosystem)
**Parent-prosjekt:** [Legacy-avkobling: Game 1–5 + backend-paritet](https://linear.app/bingosystem/project/legacy-avkobling-game-1-5-backend-paritet-a973e623234a)

Følgende 4 issues må opprettes i Linear (MCP var ikke tilgjengelig i PM-sesjonen 2026-04-19).

---

## 1. `slot_provider` schema på `app_halls`

**Prio:** P3
**Parent:** BIN-613 (admin-UI)
**Blokkerer:** Agent B cash-inout (Metronia/OK Bingo slot-switch)

**Beskrivelse:**
Agent B sitt `SlotProviderSwitch`-komponent (levert i PR #219) trenger en per-hall `slot_provider`-kolonne på `app_halls` for å kunne bytte mellom Metronia og OK Bingo på riktig hall. Per dags dato eksisterer ikke denne kolonnen.

**Leveranse:**
- Migrasjon: `ALTER TABLE app_halls ADD COLUMN slot_provider TEXT CHECK (slot_provider IN ('metronia', 'okbingo') OR slot_provider IS NULL)`
- Endpoint: `PATCH /api/admin/halls/:id/slot-provider`
- Admin-UI hookup i PR-B2 eller senere

---

## 2. `GET /api/admin/hall-groups` endpoint

**Prio:** P3
**Parent:** BIN-613
**Blokkerer:** Agent A dashboard (info-boxes widget)

**Beskrivelse:**
Dashboard-widget i PR #218 viser "—" som placeholder for hall-grupper fordi endpoint mangler. Legacy-paritet krever liste over hall-grupper med navn + antall haller.

**Leveranse:**
- Endpoint: `GET /api/admin/hall-groups`
- Response: `{ id, name, hallCount, halls: [...] }[]`
- Bytt `—` til levende data i `HallGroupsBox.ts`

---

## 3. `GET /api/admin/players/top` endpoint

**Prio:** P3
**Parent:** BIN-613
**Blokkerer:** Agent A dashboard (top-5-widget)

**Beskrivelse:**
Top-5-players-widget viser "—". Trenger ranket liste av spillere per total-innsats siste 30 dager (legacy Modular-dashboard).

**Leveranse:**
- Endpoint: `GET /api/admin/players/top?days=30&limit=5`
- Response: `{ playerId, displayName, totalStake, winRatio }[]`
- Bytt `—` til levende data i `TopPlayersBox.ts`

---

## 4. Game 1 pre-round ticket-grid rendering

**Prio:** P2 (nedjustert fra P1 — 5x5-hovedregresjon er fikset i PR #222)
**Parent:** Game 1 epic

**Beskrivelse:**
Per Handover (PR #222): Når spiller kjøper bonger i WAITING-modus, rendres ikke ticket-cards i ticket-scroller. Info-panelet er dekket av `UpcomingPurchase`-komponenten, men selve ticket-grid-rendering via `enterWaitingMode`/`updateWaitingState` mangler.

**Repro:**
1. Logg inn som `balltest@spillorama.no` / `BallTest123!`
2. Klikk Forhåndskjøp → velg Small → bekreft
3. Sjekk scroller-området før RUNNING — bonger usynlige selv om kjøp er registrert

**Fiks-retning:**
- Kall `buildTickets(state.preRoundTickets)` i `enterWaitingMode`/`updateWaitingState` i `PlayScreen.ts`
- Validere mot `state.preRoundTickets` (ikke `roomState.tickets`)
- Trengs: avklar med eier om grid + UpcomingPurchase skal rendres samtidig eller kun grid (UpcomingPurchase er duplikat info)

**PM Q til eier:** Skal pre-round ticket-grid renders i `enterWaitingMode` sammen med `UpcomingPurchase`, eller erstatte?

---

## 5. (Bonus) Pre-eksisterende Game 1-bugs utenfor #222-scope

**Flagg heller som checklist på Game 1 epic:**

- [ ] `redis-adapter` missing dep i staging (`apps/backend/src/index.ts:9`)
- [ ] Sentry/zod type-feil i game-client (pre-existing env-deps)
- [ ] `wireContract.test.ts` 12 tester feiler (pre-existing zod)
- [ ] Ball-animasjon HIGHLIGHT_SCALE — side-by-side visuell verifisering mot Unity
- [ ] Norske audio-stemmer (mann/kvinne) — ikke implementert, audit-flagget
- [ ] `centerball.png` 404 — `packages/game-client/public/...`

---

## BIN-610 (eksisterer)

Post-pilot HTTP 8 deferred endpoints (P4).
