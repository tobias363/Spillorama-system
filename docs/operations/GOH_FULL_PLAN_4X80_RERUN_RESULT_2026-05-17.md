# GoH Full-Plan 4x80 Rerun Result — 2026-05-17

**Status:** PASSED final rerun; 13/13 planposisjoner completed etter mark-retry/output-hardening
**Utført av:** PM-AI / Codex
**Miljø:** Lokal backend `http://localhost:4000`, lokal Postgres/Redis, Sentry/PostHog snapshots, pilot-monitor
**Scope:** `demo-pilot-goh`, 4 testhaller x 80 spillere = 320 samtidige testspillere
**Evidence rev1-fail:** `docs/evidence/20260517-goh-full-plan-rerun-4x80/`
**Evidence postfix-rerun:** `docs/evidence/20260517-goh-full-plan-rerun-4x80-postfix/`
**Evidence final pass:** `docs/evidence/20260517-goh-full-plan-rerun-4x80-markretry/`

## Sammendrag

Final rerun 2026-05-17T14:20-14:53 passerte hele spilleplanen med 4 testhaller x 80 spillere. Alle 13 planposisjoner completed, alle runder hadde 320 purchases og 920 ticket assignments, `ticket:mark` hadde 159418 acks og 0 failures, og pilot-monitor hadde 0 P0/P1 i testvinduet.

Pre/post observability snapshots er lagret og sammenlignet:

- Preflight: `docs/evidence/20260517-observability-goh-80-markretry-preflight-2026-05-17T14-20-03-112Z/`
- Postpass: `docs/evidence/20260517-observability-goh-80-markretry-postpass-2026-05-17T14-54-48-927Z/`
- Sentry: 0 nye issues, 0 increased issues
- Pilot-monitor: 0 P0, 0 P1
- PostHog: 3 forventede event-deltas (`ticket.purchase.success`, `spill1.payout.pattern`, `spill1.master.start`)

Runneren ble hardnet før final pass: `ticket:mark` bruker nå 15s ack-timeout (samme størrelsesorden som produksjonsklient) og retry-er transient `TIMEOUT`/`NOT_CONNECTED` med samme UUID `clientRequestId`. Dette fjernet den ene mark-ack-timeouten fra forrige PASSED-run uten å skjule reelle `ticket.mark.failures`: final rapporten har ingen `ticket.mark.failures` anomalies.

Merk: final pass ble først kjørt med `--output <path>` mens runneren på det tidspunktet bare tolket `--output=<path>`. Dermed ble full JSON overskrevet av markdown på lokal fil `true`. Dette er fikset i samme branch: runneren støtter nå begge argumentformer og lager `.md` trygt selv når output ikke ender på `.json`. Den bevarte markdown-rapporten og en eksplisitt recovered summary JSON ligger i final evidence-mappen.

Ny 4x80-runde ble kjørt etter PR #1563 for å verifisere at scheduled Spill 1 `ticket:mark` faktisk var frisk under GoH-load. Første rerun stoppet i runde 2, men runde 1 ga nok data til å avkrefte rev1-fixen.

Runde 1 (`bingo`) fullførte server-side med 320 kjøp, 920 ticket assignments, 61 draws og 7 winner-events. Samtidig hadde socket-markering fortsatt 0 `markAcks` og 12926 `GAME_NOT_RUNNING` failures.

Observability viste ingen nye Sentry-issues og pilot-monitor hadde 0 P0/P1. Dette peker på en lokal socket/validator-kontrakt, ikke en ekstern observability-feil.

Etter rev2-fixen ble testen kjørt på nytt. Da var `ticket:mark` frisk i de tre første fullførte 4x80-rundene: 39106 `markAcks`, 0 `markFailures`, 0 `GAME_NOT_RUNNING`. Full plan stoppet likevel i runde 4 på 5 `game1:join-scheduled ack timeout` i hall 4. Dette er dokumentert som en separat P1 i `PITFALLS_LOG.md` §4.9 og er nå verifisert i final pass: runde 4 completed med 320/320 joins, 320/320 purchases, 920 tickets og 11590 mark acks.

## Nøkkeltall

| Målepunkt | Resultat |
|---|---:|
| Spillere requested/loaded/connected | 320 / 320 / 320 |
| Runde 1 kjøp | 320 |
| Runde 1 ticket assignments | 920 |
| Runde 1 draws | 61 |
| Runde 1 winners | 7 |
| Runde 1 `draw:new` events | 19459 |
| Runde 1 `markAcks` | 0 |
| Runde 1 `markFailures` | 12926 |
| Runde 1 failure code | `GAME_NOT_RUNNING` |
| Pilot-monitor P0/P1 | 0 |
| Nye Sentry issues | 0 |

Runde 2 (`1000-spill`) hadde 319/320 join-acks og 320/320 purchases. Én `game1:join-scheduled ack timeout` stoppet runneren. Dette er sekundært til mark-funnet fordi runde 1 allerede beviste at P1 ikke var løst.

## Final Pass Etter Mark-Retry

```bash
node scripts/dev/goh-full-plan-run.mjs \
  --players-per-hall=80 \
  --connect-delay-ms=2200 \
  --join-delay-ms=60 \
  --purchase-concurrency=8 \
  --purchase-retries=4 \
  --wallet-circuit-retry-delay-ms=32000 \
  --mark-retries=2 \
  --mark-ack-timeout-ms=15000 \
  --output=docs/evidence/20260517-goh-full-plan-rerun-4x80-markretry/goh-full-plan-rerun-4x80-markretry-20260517T142023.json
```

| Målepunkt | Final pass |
|---|---:|
| Planposisjoner completed | 13/13 |
| Spillere | 320 |
| Purchases | 4160 |
| Ticket assignments | 11960 |
| Total innsats | 167400 kr |
| Draws | 754 |
| Auto-resumes | 52 |
| `ticket:mark` acks | 159418 |
| `ticket:mark` failures | 0 |
| Join failures etter retry | 0 |
| Purchase failures etter retry | 0 |
| Pilot-monitor P0/P1 | 0 |
| Nye/increased Sentry issues | 0 |

| Runde | Spill | Status | Purchases | Tickets | Draws | Mark acks |
|---:|---|---|---:|---:|---:|---:|
| 1 | bingo | completed | 320 | 920 | 54 | 11461 |
| 2 | 1000-spill | completed | 320 | 920 | 59 | 12536 |
| 3 | 5x500 | completed | 320 | 920 | 54 | 11459 |
| 4 | ball-x-10 | completed | 320 | 920 | 55 | 11590 |
| 5 | bokstav | completed | 320 | 920 | 58 | 12419 |
| 6 | innsatsen | completed | 320 | 920 | 59 | 12361 |
| 7 | jackpot | completed | 320 | 920 | 62 | 13119 |
| 8 | kvikkis | completed | 320 | 920 | 55 | 11317 |
| 9 | oddsen-55 | completed | 320 | 920 | 62 | 13132 |
| 10 | oddsen-56 | completed | 320 | 920 | 58 | 12255 |
| 11 | oddsen-57 | completed | 320 | 920 | 60 | 12786 |
| 12 | trafikklys | completed | 320 | 920 | 59 | 12507 |
| 13 | tv-extra | completed | 320 | 920 | 59 | 12476 |

Final evidence:

- Runner markdown: `docs/evidence/20260517-goh-full-plan-rerun-4x80-markretry/goh-full-plan-rerun-4x80-markretry-20260517T142023.md`
- Recovered summary JSON: `docs/evidence/20260517-goh-full-plan-rerun-4x80-markretry/goh-full-plan-rerun-4x80-markretry-20260517T142023.summary.json`
- Preflight observability: `docs/evidence/20260517-observability-goh-80-markretry-preflight-2026-05-17T14-20-03-112Z/`
- Postpass observability: `docs/evidence/20260517-observability-goh-80-markretry-postpass-2026-05-17T14-54-48-927Z/`

## Postfix-Rerun Etter Rev2

Kommandoen ble kjørt mot lokal backend/Postgres/Redis med Sentry/PostHog snapshots og pilot-monitor aktiv:

```bash
node scripts/dev/goh-full-plan-run.mjs \
  --players-per-hall=80 \
  --connect-delay-ms=2200 \
  --join-delay-ms=60 \
  --purchase-concurrency=8 \
  --round-timeout-ms=900000 \
  --output=docs/evidence/20260517-goh-full-plan-rerun-4x80-postfix/goh-full-plan-rerun-4x80-postfix-20260517T1033.json
```

| Runde | Spill | Terminal status | Joins | Purchases | Tickets | Draws | Winners | Mark acks | Mark failures |
|---:|---|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | Bingo | completed | 320/320 | 320/320 | 920 | 63 | 9 | 13302 | 0 |
| 2 | 1000-spill | completed | 320/320 | 320/320 | 920 | 62 | 6 | 13015 | 0 |
| 3 | 5x500 | completed | 320/320 | 320/320 | 920 | 61 | 8 | 12789 | 0 |
| 4 | Ball x 10 | stopped before draw | 315/320 | 320/320 | n/a | n/a | n/a | n/a | n/a |

Runde 4 stoppet før draw fordi 5 spillere i `demo-hall-004` fikk `game1:join-scheduled ack timeout`: H4P57, H4P60, H4P66, H4P68 og H4P72. Purchases var 320/320, og postfail-observability viste 0 pilot-monitor P0/P1 og ingen nye/increased Sentry issues.

## Root Cause Rev2

PR #1563 gjorde riktig første steg: generic `ticket:mark` går via `Game1ScheduledTicketMarkService` før legacy `BingoEngine.markNumber()`.

Mangelen var at validatoren fortsatt brukte mutable `RoomSnapshot.scheduledGameId` fra canonical room som scheduled-game authority. Ved GoH 4x80 kommer tusenvis av mark-acks samtidig med round-end. Når canonical room resetter etter completion, kan `scheduledGameId` bli null før alle mark-events er prosessert. Da returnerte validatoren `false`, og handleren falt tilbake til legacy `BingoEngine.markNumber()`, som ga `GAME_NOT_RUNNING`.

Endelig kontrakt: `draw:new.gameId` må føres videre som `ticket:mark.scheduledGameId`, og backend må bruke denne eksplisitte DB-keyen for scheduled validation. Room binding er fallback, ikke autoritet.

## Evidence

- Runner JSON: `docs/evidence/20260517-goh-full-plan-rerun-4x80/goh-full-plan-rerun-4x80-20260517T1002.json`
- Runner MD: `docs/evidence/20260517-goh-full-plan-rerun-4x80/goh-full-plan-rerun-4x80-20260517T1002.md`
- Preflight snapshot: `docs/evidence/20260517-observability-goh-80-rerun-preflight-2026-05-17T10-02-01-094Z/`
- Postfail snapshot: `docs/evidence/20260517-observability-goh-80-rerun-postfail-2026-05-17T10-17-05-336Z/`

## Fix Verifisert

- `TicketMarkPayloadSchema` har optional `scheduledGameId`.
- Backend `MarkPayload` og `ticketEvents.ts` videresender optional `scheduledGameId`.
- `scripts/dev/goh-full-plan-run.mjs` sender `scheduledGameId: payload.gameId` ved `ticket:mark`.
- `Game1ScheduledTicketMarkService.validate()` bruker explicit scheduled-game id når feltet finnes, validerer room-match og tillater late completed-ack for allerede trukket tall på spillerens bong.
- `scripts/dev/goh-full-plan-run.mjs` retry-er transient `game1:join-scheduled` ack-timeout opptil 3 ganger og logger `join.retry.succeeded`.
- `Game1Controller` retry-er initial og delta `joinScheduledGame` ved `TIMEOUT`/`NOT_CONNECTED` før fallback/forrige room beholdes.
- `scripts/dev/goh-full-plan-run.mjs` retry-er transient `ticket:mark` ack-timeout med samme UUID `clientRequestId` og 15s ack-timeout.
- `scripts/dev/goh-full-plan-run.mjs` støtter nå både `--output=<path>` og `--output <path>`, og `.md`-rapporten kan ikke lenger overskrive JSON når output mangler `.json`.

## Neste Robusthetsnivå

Final 4x80-pass er grønt for hovedflyten. Neste robuste steg er ikke enda en identisk rerun, men mer målrettet hardening:

- Reconnect/network-chaos under GoH-load: koble ut 5-10% klienter mid-runde og verifiser rejoin + state-resync.
- Wallet/payout reconciliation etter full plan: summer purchases, payouts, wallet entries, regulatory ledger og hash-chain etter 13 runder.
- Auto-resume-audit: 52 auto-resumes er forventet med dagens phase-pause/fase-advance-modell, men bør eksplisitt klassifiseres som P3/expected i rapportformatet.
