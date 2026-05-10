# DR Drill A — Master-fail (Spill 1) — 2026-05-DA

**Status:** Forberedt — venter på kjøring i staging
**Drill-id:** 2026-05-DA-`<YYYYMMDD-HHMMSS>` (sett ved kjøring)
**Mandat-ref:** [LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md](../../architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md) §3 (mandat-S1)
**Plan-ref:** [R12_DR_VALIDATION_PLAN.md](../R12_DR_VALIDATION_PLAN.md) §4 Drill A
**Linear:** [BIN-816](https://linear.app/bingosystem/issue/BIN-816)
**Drill-eier:** L2 backend (vakthavende ved kjøring)
**Approver:** Tobias Haugen (L4)
**Compliance-observer:** Compliance-eier
**Miljø:** staging Docker-stack (`docker-compose.chaos.yml`)

---

## 0. Forberedelse — sjekkliste FØR kjøring

- [ ] Docker daemon kjører på staging-host (Linux foretrukket; Mac fungerer for Drill A)
- [ ] Repo synkronisert med `origin/main` (post-merge av denne branchen)
- [ ] Eksisterende chaos-stack stoppet og volumer ryddet (`docker-compose -f docker-compose.yml -f infra/chaos-tests/docker-compose.chaos.yml down -v`)
- [ ] Admin-passord tilgjengelig (typisk `Spillorama123!` for staging)
- [ ] `seed-demo-pilot-day.ts` har ikke-disabled stat (sjekk `apps/backend/scripts/seed-demo-pilot-day.ts`)
- [ ] On-call backend kjenner runbook-prosedyre for "ekte" master-fail (ikke bare drill)
- [ ] `#ops-cutover`-Slack-kanal varslet 30 min før (per `LIVE_ROOM_DR_RUNBOOK §12.2`)

## 1. Pre-state (4 demo-haller seedet)

| Felt | Verdi |
|---|---|
| Master-hall | `demo-hall-001` |
| Deltaker-haller | `demo-hall-002`, `demo-hall-003`, `demo-hall-004` |
| Master-agent | `demo-agent-1@spillorama.no` |
| Spilleplan | Demo-plan-pilot (13 katalog-spill, første posisjon = Bingo) |
| Aktiv runde target | Spill 1 (`bingo`-slug), 5 draws før kill |
| Backend-noder | 2 stk (ports 4001 + 4002) bak shared Postgres + Redis |

## 2. Kommando

```bash
cd /Users/tobiashaugen/Projects/Spillorama-system

# Default: kill etter 5 draws, master = demo-hall-001, target 15 draws total
ADMIN_PASSWORD='Spillorama123!' \
  bash infra/chaos-tests/r2-master-fail-test.sh

# Override-eksempler:
KILL_AT_DRAW=10 \
  TARGET_TOTAL_DRAWS=20 \
  ADMIN_PASSWORD='Spillorama123!' \
  bash infra/chaos-tests/r2-master-fail-test.sh

# Annen master-hall (test cross-hall-master-binding):
MASTER_HALL_ID=demo-hall-002 \
  MASTER_AGENT_EMAIL=demo-agent-2@spillorama.no \
  ADMIN_PASSWORD='Spillorama123!' \
  bash infra/chaos-tests/r2-master-fail-test.sh
```

Forventet kjøretid: ~5-8 min ved happy-path.

## 3. Invariants (per R12-plan §4 Drill A)

| ID | Invariant | Hvor verifiseres | Strukturell? |
|---|---|---|---|
| **I1** | `app_game1_draws.draw_sequence` har ingen hull (`COUNT(*) === MAX(seq)` etter recovery) | `r2FailoverInvariants.test.ts` (proxy) eller `drillAMasterFailInvariants.test.ts` | ✅ Ja — pilot pauses ved brudd |
| **I2** | `master_hall_id` på scheduled_game er uendret (= `demo-hall-001`) | Inline shell-sjekk på snapshot-JSON (§14 i scriptet) | ✅ Ja |
| **I3** | Antall compliance-ledger-rader for runden er ≥ pre-kill-count (append-only) + matcher `draws_count` der wallet-touch er forventet | `r2FailoverInvariants.test.ts` I4 | ✅ Ja |
| **I4** | `app_game1_scheduled_games.status` ruller ikke bakover (`completed → running` er strukturelt brudd; `running → paused` er OK) | Inline shell-sjekk (§14) | ✅ Ja |
| **I5** | Klient-reconnect for alle 4 demo-haller < 2 min (proxy: HTTP health-ping per hall) | Inline shell-sjekk (§12) | ⚠️ Advisory — full impl venter på 4-hall mock-runner |

## 4. Resultat-felter (fyll inn etter kjøring)

| Felt | Verdi |
|---|---|
| Dato kjørt (UTC) | `<YYYY-MM-DD HH:MM>` |
| Drill-eier (signert) | |
| Recovery-tid | `<N>s` (SLA < 300s; advisory < 5s) |
| Klient-reconnect-tid | `<N>s` (SLA < 120s) |
| Master-hall pre-kill | `demo-hall-001` |
| Master-hall post-recovery | `<verdi>` |
| Game-status pre-kill | `<running\|paused>` |
| Game-status post-recovery | `<verdi>` |
| Pre-kill draws_count | |
| Post-recovery draws_count | |
| Pre-kill ledger_count_for_round | |
| Post-recovery ledger_count_for_round | |
| Exit-kode | `<0\|1\|2>` |

## 5. Per-invariant-resultat

| ID | Status | Kommentar |
|---|---|---|
| I1 — draws-sekvens uten gaps | `<PASS\|FAIL>` | |
| I2 — master_hall_id uendret | `<PASS\|FAIL\|SKIP>` | SKIP hvis runden ikke startet pre-kill |
| I3 — compliance-ledger append-only | `<PASS\|FAIL>` | |
| I4 — status ikke rullet bakover | `<PASS\|FAIL\|SKIP>` | |
| I5 — reconnect-tid < 2 min (proxy) | `<PASS\|WARN\|FAIL>` | Advisory inntil full mock-klient |

## 6. Avvik / observasjoner

> Beskriv eventuelle FAIL eller observasjoner som krever oppfølging.
> Hvis ingen, skriv "Ingen avvik observert."

## 7. Pilot-impact

- [ ] **PASS** — Drill A grønn, pilot-go-live på mandat-S1 OK
- [ ] **FAIL strukturelt** — pilot pauses per mandat §6.1, åpne Linear-issue: `<BIN-...>`
- [ ] **FAIL ikke-strukturelt** — recovery-tid > 5s (advisory). Ikke pilot-blokker, men action-item for tuning.

## 8. Tiltak / oppfølging

- [ ] Hvis I1 FAIL: trigger `verify:audit-chain` + WAL-replay-prosedyre fra `LIVE_ROOM_DR_RUNBOOK §3a` (master-fail) — TODO når §3a er skrevet
- [ ] Hvis I2 FAIL: undersøk `MasterActionService.start` — kan handshake ha blitt re-trigget post-recovery?
- [ ] Hvis I4 FAIL: undersøk `Game1MasterControlService.pauseGame` recovery-handler
- [ ] Hvis I5 WARN: utvid `r3-mock-client.mjs` til å spawne 4 parallelle klienter (én per demo-hall)
- [ ] Hvis recovery > 5s: tune backend cold-start (Render warm-pool, connection-pool warm-up)

## 9. Sign-off

| Rolle | Navn | Dato | Signatur (Linear-kommentar-link) |
|---|---|---|---|
| Drill-eier (L2 backend) | | | |
| Technical lead (Tobias) | | | |
| Compliance-observer | | | |

## 10. Vedlegg

- Pre-kill snapshot: `<commit-SHA / Linear-link>`
- Post-recovery snapshot: `<commit-SHA / Linear-link>`
- Full script-stdout: `<commit-SHA / Linear-link>`
- Container-logs (backend-1 + backend-2): `<arkiv-link>`
- Sentry events under drill: `<filter-link>`

---

## Forberedelses-rapport (denne PR)

| Komponent | Status |
|---|---|
| Scenario-script (`r2-master-fail-test.sh`) | ✅ Skrevet, syntax-validert |
| Drill-log-template (denne fil) | ✅ Klar |
| Dedikert invariants-test (`drillAMasterFailInvariants.test.ts`) | ⚠️ TODO — fallback til `r2FailoverInvariants.test.ts` for I1/I3 |
| 4-hall mock-klient-runner | ⚠️ TODO — fallback til HTTP health-ping for I5 |
| Master-konsoll-recovery-tid (< 30s lobby-fetch) | ⚠️ Inline-sjekk i §11 av script — full e2e venter på UI-test-runner |

## Anbefalinger til PM før kjøring

1. **Verifiser at `seed-demo-pilot-day.ts` lager runder for `demo-hall-001`** — script er testet i utvikling men ikke kjørt mot fersk Postgres + Redis i denne branchen.
2. **Mock-runden må starte raskt nok** — hvis backend krever > 30 sek til å trigge første draw etter `master/start`, trenger `KILL_AT_DRAW` å settes til 1 eller `ROUND_START_TIMEOUT` heves.
3. **Følg-opp PR for `drillAMasterFailInvariants.test.ts`** — speiler r10Spill3Invariants.test.ts-mønsteret, sjekker I2 (master_hall_id) og I4 (status) i tillegg til I1/I3.
4. **Følg-opp PR for `r3-mock-client.mjs`-utvidelse** — én klient per demo-hall (4 stk), kjøres parallelt etter recovery for å måle reell I5-tid.

---

## Endringslogg

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-10 | Initial template — generert som del av Drill A-forberedelse | Drill-A-prep-agent |
