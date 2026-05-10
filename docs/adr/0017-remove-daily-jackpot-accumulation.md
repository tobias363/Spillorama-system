# ADR-0017 — Fjerne daglig jackpot-akkumulering

**Status:** Accepted
**Dato:** 2026-05-10
**Deciders:** Tobias Haugen
**Konsulterer:** —

## Kontekst

Spillorama hadde fra 2026-04 en automatisk daglig jackpot-akkumulering for Spill 1:

- Cron-job (`jackpotDailyTick`) kjørte hver 15. min, akkumulerte +4000 kr/dag (Oslo-tz, midnattsregel)
- Maks-cap 30 000 kr
- Default start 2 000 kr
- Ble lagret i `app_game1_jackpot_state` per hall-gruppe
- Master fikk `JACKPOT_CONFIRM_REQUIRED`-error ved start; måtte bekrefte verdien før spill kunne starte
- Auto-utbetaling ved Fullt Hus innen draw-thresholds [50, 55, 56, 57] via `Game1DrawEngineDailyJackpot`

Implementert per:
- Migration `20260821000000_game1_jackpot_state.sql`
- Migration `20260901000000_game1_jackpot_awards.sql`
- `Game1JackpotStateService` (731 linjer)
- `Game1DrawEngineDailyJackpot` (291 linjer)
- `JackpotConfirmModal` (frontend, lagt til i PR #1150 2026-05-10)

**Tobias-direktiv 2026-05-10** etter test av master-flyten:

> "Jackpot-popup gjelder kun for Jackpot-katalog-spillet (pos 7), og bingoverten setter ALLTID jackpot manuelt før spillet starter. Det skal IKKE være automatisk akkumulering. Bingovertene i hallene har full kontroll på det."

Dette overstyrer den automatiske akkumulerings-modellen og krever arkitektonisk simplifisering.

## Beslutning

**Daglig jackpot-akkumulering fjernes helt.** Jackpot blir et per-spill-konfig-element som master setter manuelt før hvert "Jackpot"-katalog-spill (posisjon 7 i pilot-planen).

### Hva fjernes

1. **Cron-job:** `jackpotDailyTick` deaktiveres permanent (`JOB_JACKPOT_DAILY_ENABLED=false` hardkodet eller cron fjernet fra `JobScheduler`)
2. **Akkumulering:** `Game1JackpotStateService.accumulateDaily()` deprecates (eksisterende awards-historikk i `app_game1_jackpot_awards` beholdes som immutable audit-logg per ADR-0004 hash-chain)
3. **Master-blokkering:** `JACKPOT_CONFIRM_REQUIRED`-error fjernes fra `Game1MasterControlService.startGame:453` — Bingo (pos 1) og andre ikke-jackpot-spill går rett gjennom
4. **Frontend-modal:** `JackpotConfirmModal.ts` slettes (ingen historisk consequences — kom kun fra PR #1150 i samme dag)
5. **API-param:** `jackpotConfirmed?: boolean` fjernes fra `startMaster()`-helper og backend-endpoint

### Hva beholdes

1. **`JackpotSetupModal` flow** — eneste mekanikk for jackpot-konfig nå. Master setter per-bongfarge prizesCents + draw-nummer per spill med `requiresJackpotSetup=true`.
2. **`JACKPOT_SETUP_REQUIRED`-error** — kastes når master prøver å starte/advance til katalog-spill med flagget satt og ingen override eksisterer.
3. **`app_game_plan_run.jackpot_overrides_json`** — lagrer master-satte verdier per (run, posisjon).
4. **Auto-utbetaling ved Fullt Hus innen draw-threshold** — `Game1DrawEngineDailyJackpot`-hooken refaktores til å lese fra `plan_run.jackpotOverrides` istedenfor `daily_jackpot_state`.
5. **`app_game1_jackpot_awards`** — audit-logg-tabell beholdes som immutable historikk (BIN-764 hash-chain).
6. **`app_game1_jackpot_state`** — tabellen markeres deprecated men beholdes (forward-only per ADR-0014). En migration setter alle `current_amount_cents = 0` slik at eventuelle stale lesninger gir 0 i stedet for legacy-verdier.

### Master-flyt etter denne endringen

| Posisjon | Katalog-spill | `requiresJackpotSetup` | Master-flyt ved "Start" |
|---|---|---|---|
| 1 | Bingo | false | Direkte start, ingen popup |
| 2 | 1000-spill | false | Direkte start, ingen popup |
| ... | ... | false | Direkte start, ingen popup |
| 7 | **Jackpot** | **true** | `JACKPOT_SETUP_REQUIRED` → JackpotSetupModal med blank input → master setter prizesCents + draw → submit → start |

## Konsekvenser

### Positive
- **Bingovert har full kontroll:** ingen "skjult" akkumulering som kan akkumulere uventet
- **Forenkler audit:** ingen cron + ingen daglig stat-rotasjon — kun master-handling logges
- **Forenkler test:** fjerner 4 backend-tester + 3 frontend-tester
- **Master-flyt for Bingo (pos 1) er nå friksjonsfri** — ingen popup-blokkering
- **Eliminerer mental modell-konflikt:** Confirm vs Setup var forvirrende. Nå kun Setup.

### Negative
- **~23 filer endres** — stor refactor (selv om mye er sletting)
- **`Game1DrawEngineDailyJackpot` må refaktores** til å lese fra plan-run-overrides — ny binding som må testes
- **`app_game1_jackpot_state` blir dødtabell** — beholdes for forward-only-policy men er ubrukt
- **Tobias mister "lazy default"** — kan ikke bare la systemet bygge opp pott; må sette manuelt hver gang. Dette er FORVENTET (Tobias-direktiv).

### Nøytrale
- Eksisterende awards i `app_game1_jackpot_awards` beholdes som historikk — ingen DELETE-handling (ADR-0004 hash-chain immutability)
- Migration som markerer `app_game1_jackpot_state` deprecated er forward-only — ingen rollback

## Alternativer vurdert

### Alternativ A: Hybrid — behold akkumulering men la master overstyre
Avvist: Tobias-direktiv eksplisitt sa "ikke automatisk øknning". Hybrid ville beholdt cron-koden + skapt to mentale modeller. Mer kompleksitet, ikke mindre.

### Alternativ B: Fjern KUN frontend-modalen, behold backend-akkumulering
Avvist: Backend ville fortsatt øke daglig pott bak kulissene; master ville ikke se dette. Skapte ulik backend/frontend-state — bug-magnet.

### Alternativ C: Markér ALLE katalog-spill med `requiresJackpotSetup=true`
Avvist: Tobias spesifiserte at jackpot-popup skal kun vises på Jackpot-katalog-spillet (pos 7). Andre spill bruker auto-multiplikator.

## Implementasjon

### PR-A (backend cleanup)
- `Game1MasterControlService.ts:453` — fjern `JACKPOT_CONFIRM_REQUIRED`-throw
- `apps/backend/src/jobs/jackpotDailyTick.ts` — slett job + fra JobScheduler
- `Game1JackpotStateService.accumulateDaily()` — deprecate + return early
- `Game1DrawEngineDailyJackpot.ts` — refaktorer til å lese fra `plan_run.jackpot_overrides_json`
- Backend-tester oppdateres

### PR-B (frontend cleanup)
- Slett `apps/admin-web/src/pages/cash-inout/JackpotConfirmModal.ts`
- Forenkle `runStartWithJackpotFlow` i `Spill1HallStatusBox.ts` + `NextGamePanel.ts`
- Fjern `jackpotConfirmed?` param fra `startMaster()` API-helper
- Frontend-tester oppdateres

### PR-C (doc-oppdatering, denne PR)
- Denne ADR-0017
- Oppdatering av `SPILL_DETALJER_PER_SPILL.md` (fjern §-er om akkumulering)
- Oppdatering av `SPILL_REGLER_OG_PAYOUT.md` (fjern §-er om automatisk akkumulering)
- `PITFALLS_LOG.md` ny entry: "JackpotConfirmModal var feil mental modell — fjernet i ADR-0017"

### PR-D (migration, etter PR-A merget)
- Ny migration `YYYYMMDDHHMMSS_deprecate_game1_daily_jackpot_state.sql`
- `UPDATE app_game1_jackpot_state SET current_amount_cents = 0` (forward-only nullstilling)
- `COMMENT ON TABLE app_game1_jackpot_state IS 'DEPRECATED 2026-05-10 (ADR-0017) — auto-akkumulering fjernet, behold for historikk'`

## Referanser

- Tobias-direktiv 2026-05-10 (master-test sesjon, etter PR #1150)
- `docs/architecture/SPILL_DETALJER_PER_SPILL.md` §1.7 (Jackpot-spill)
- `docs/architecture/SPILL_REGLER_OG_PAYOUT.md` §8 (separate paths utenfor Rad 1-4 + Fullt Hus)
- ADR-0004 (Hash-chain audit-trail) — `app_game1_jackpot_awards` forblir immutable
- ADR-0014 (Idempotente migrasjoner) — forward-only policy
- BIN-764 (Casino-grade wallet)
- PR #1150 (introduserte JackpotConfirmModal som denne ADR fjerner)
