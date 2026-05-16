# GoH Full-Plan Test Result — 2026-05-16

**Status:** PASSED  
**Utført av:** PM-AI  
**Miljø:** Lokal backend på `http://localhost:4000`  
**Scope:** `demo-pilot-goh`, 4 testhaller x 20 spillere = 80 samtidige testspillere  
**Plan:** Alle 13 Spill 1-planposisjoner  
**Evidence:** `docs/evidence/20260516-goh-full-plan-run/`

## Sammendrag

Full spilleplan ble kjørt ende-til-ende med 80 syntetiske spillere fordelt på 4 haller i Group of Halls. Clean rerun startet 2026-05-16T15:52:08Z og fullførte 2026-05-16T16:13:32Z med runner-status `passed`.

DB-sluttstatus etter testen:

```text
plan_id: demo-plan-pilot
hall_id: demo-hall-001
business_date: 2026-05-16
current_position: 13
status: finished
started_at: 2026-05-16 15:55:04.746737+00
finished_at: 2026-05-16 16:13:30.885621+00
```

## Per-Runde Resultat

| Pos | Slug | Resultat | Kjøp | Tickets | Innsats | Draws | Auto-resumes |
| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | bingo | completed | 80 | 200 | 2000 kr | 62 | 4 |
| 2 | 1000-spill | completed | 80 | 200 | 2000 kr | 62 | 4 |
| 3 | 5x500 | completed | 80 | 200 | 2000 kr | 61 | 4 |
| 4 | ball-x-10 | completed | 80 | 200 | 2000 kr | 63 | 4 |
| 5 | bokstav | completed | 80 | 200 | 2000 kr | 65 | 4 |
| 6 | innsatsen | completed | 80 | 200 | 2000 kr | 63 | 4 |
| 7 | jackpot | completed | 80 | 200 | 2000 kr | 62 | 4 |
| 8 | kvikkis | completed | 80 | 200 | 2000 kr | 64 | 4 |
| 9 | oddsen-55 | completed | 80 | 200 | 2000 kr | 65 | 4 |
| 10 | oddsen-56 | completed | 80 | 200 | 2000 kr | 66 | 4 |
| 11 | oddsen-57 | completed | 80 | 200 | 2000 kr | 64 | 4 |
| 12 | trafikklys | completed | 80 | 200 | 3000 kr | 66 | 4 |
| 13 | tv-extra | completed | 80 | 200 | 2000 kr | 62 | 4 |

## Observability

- Pilot-monitor var aktiv og genererte runde-rapporter for clean rerun: `/tmp/pilot-monitor-round-44.md` til `/tmp/pilot-monitor-round-56.md`.
- Ingen P0/P1-linjer ble funnet i `/tmp/pilot-monitor.log` for clean rerun.
- Sentry/PostHog read-sjekk ble ikke kjørt fordi lokale read-tokens ikke er tilgjengelige i miljøet (`SENTRY_AUTH_TOKEN` og PostHog personal API key mangler). Dette påvirker ikke lokal runner/DB-verifikasjon, men må være på plass ved full prod/staging-audit.

## Viktige Funn

### 1. Full plan flyter nå ende-til-ende

Alle spill i planen ble spilt ferdig i riktig rekkefølge. Tidligere natural-end-reconcile-bug som kunne avslutte plan-run midt i planen ble ikke observert i clean rerun.

### 2. `LOSS_LIMIT_EXCEEDED` i forrige run var testdata-støy

Første full-plan-kjøring stoppet på Oddsen 56 fordi tre syntetiske load-spillere hadde gamle RG-loss-entries fra tidligere lokale tester. Runneren sletter nå RG-loss-limit-data for `demo-load-*`-spillere i de fire demo-hallene før ny full-plan-run.

### 3. Runner-sluttlogikk måtte hardenes

Første full-plan-kjøring fullførte alle 13 spill, men rapporterte `failed` fordi runneren forsøkte å advance etter at plan-run allerede var `finished`. Dette var feil i runnerens sluttkontroll, ikke i spillflyten. `scripts/dev/goh-full-plan-run.mjs` behandler nå `GAME_PLAN_RUN_INVALID_TRANSITION` med `status=finished` som forventet sluttstate.

### 4. `ticket:mark` socket-flow er neste P1

Alle runder fullførte server-side, men runneren registrerte `ticket.mark.failures` på alle 13 runder. Feilkoden var `GAME_NOT_RUNNING` med meldingen `Ingen aktiv runde i rommet.` Dette betyr at scheduled Spill 1 server-side draw/pattern-eval fungerer, men klientenes `ticket:mark` socket-path ser feil rom/status.

Dette bør være neste debug-scope før man konkluderer med at spillerklientens live-markering er robust.

### 5. Auto-resume skjer systematisk

Hver runde hadde 4 auto-resumes. Fullflyten overlever dette, men neste PM bør avklare om dette er forventet phase-pause-kontrakt eller om full-plan-runneren overstyrer en pause som egentlig skal være synlig for master/spillere.

## Kommandoer Brukt

```bash
node scripts/dev/goh-full-plan-run.mjs \
  --players-per-hall=20 \
  --connect-delay-ms=2200 \
  --join-delay-ms=60 \
  --purchase-concurrency=8 \
  --round-timeout-ms=900000
```

Verifikasjon:

```bash
curl -fsS http://localhost:4000/health
jq '{status, finishedAt, roundCount: (.rounds|length), failure, finishResult}' \
  docs/evidence/20260516-goh-full-plan-run/goh-full-plan-run-2026-05-16T15-52-08-891Z.json
```

## Neste PM Skal Gjøre

1. Undersøk `ticket:mark` socket-flow med faktisk spillerklient og runner-socket side om side.
2. Avklar om 4 auto-resumes per runde er forventet master/pause-kontrakt.
3. Erstatt test-runnerens direkte wallet-topup med ledger-konsistent wallet-adapter/API før dette brukes som compliance-grade load-test.
4. Legg inn Sentry/PostHog read-tokens i PM testmiljø slik at full-plan-run kan korreleres mot observability-verktøy, ikke bare lokal DB/monitor.

