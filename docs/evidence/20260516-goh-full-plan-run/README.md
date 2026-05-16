# GoH Full-Plan Evidence — 2026-05-16

**Status:** PASSED  
**Scope:** `demo-pilot-goh`, 4 haller x 20 spillere = 80 samtidige testspillere  
**Plan:** Alle 13 Spill 1-planposisjoner kjørt ende-til-ende  
**Testvindu:** 2026-05-16 15:52:08Z → 16:13:32Z  
**Backend:** `http://localhost:4000`  

## Evidence

- `goh-full-plan-run-2026-05-16T15-52-08-891Z.md` — menneskelesbar full-plan-rapport.
- `goh-full-plan-run-2026-05-16T15-52-08-891Z.json` — full maskinlesbar rapport med per-runde detaljer og anomalies.
- `pilot-monitor-round-44.md` — monitor-rapport for clean rerun runde 1.
- `pilot-monitor-round-56.md` — monitor-rapport for clean rerun runde 13.

## Verifisert

- Alle 13 plan-spill fullførte med `status=completed`.
- Hver runde hadde `80/80` kjøp.
- Hver runde hadde `200` ticket assignments.
- Plan-run endte korrekt med `status=finished`, `current_position=13`.
- Pilot-monitor genererte runde-rapporter for clean rerun: `/tmp/pilot-monitor-round-44.md` til `/tmp/pilot-monitor-round-56.md`.
- Ingen P0/P1-linjer ble funnet i `/tmp/pilot-monitor.log` for clean rerun.

## Funn som må leve videre

1. `ticket:mark` socket-flow feilet på alle 13 runder med `GAME_NOT_RUNNING`, mens server-side draw/pattern-eval fullførte. Dette er en P1 observability/client-flow mismatch som må undersøkes separat.
2. Engine pauset naturlig flere ganger per runde og måtte auto-resumes 4 ganger per runde. Fullflyten overlever dette, men det bør avklares om dette er forventet phase-pause-kontrakt eller støy i full-plan-runneren.
3. Første gjennomkjøring 2026-05-16T15:27:13Z fullførte alle 13 spill, men runneren markerte `failed` fordi den forsøkte `advance` etter at plan-run allerede var `finished`. Runneren er oppdatert til å behandle `GAME_PLAN_RUN_INVALID_TRANSITION` med `status=finished` som forventet sluttstate.
4. Forrige failing run stoppet på Oddsen 56 med `LOSS_LIMIT_EXCEEDED`. Root cause var stale RG-loss-ledger for syntetiske `demo-load-*`-spillere. Runneren resetter nå RG-loss-limit-rader for syntetiske load-brukere før full-plan-kjøring.

## Relaterte repo-docs

- `docs/operations/GOH_FULL_PLAN_TEST_RESULT_2026-05-16.md`
- `docs/engineering/PITFALLS_LOG.md`
- `docs/engineering/AGENT_EXECUTION_LOG.md`
- `.claude/skills/spill1-master-flow/SKILL.md`

