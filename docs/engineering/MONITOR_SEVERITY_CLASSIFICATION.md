# Monitor Severity Classification (P0-P3)

**Status:** Autoritativ. Bestemmer hvordan `pilot-monitor-enhanced.sh` taggene tolkes av push-mekanismen og PM-sesjons-rapportering.
**Sist oppdatert:** 2026-05-13
**Eier:** PM-AI (vedlikeholdes ved hver utvidelse av monitor-anomalier)
**Relatert til:**
- `scripts/pilot-monitor-enhanced.sh` — produserer disse taggene
- `scripts/monitor-push-to-pm.sh` — pusher P0/P1 til macOS-notification + FIFO
- `docs/engineering/PILOT_TEST_FLOW_AND_KNOWLEDGE_PROTOCOL.md` §5.5
- `docs/engineering/PM_ONBOARDING_PLAYBOOK.md` §2.18

> **Tobias-direktiv 2026-05-13:** Live-monitor må aktivt pushe anomalier til PM-sesjonen, ikke bare logge passivt til fil. P0 = umiddelbar oppmerksomhet kreves, P1 = handling innen 1 min, P2 = info, P3 = noise.

---

## Hvorfor severity-klassifisering er kritisk

`pilot-monitor-enhanced.sh` produserer ~200 log-entries per time når test-sesjonen kjører. Uten klassifisering må PM lese alt manuelt — det går ikke. Med klassifisering kan:

1. **Push-daemon** filtrere kun P0/P1 til macOS-notification + FIFO
2. **PM-sesjoner** kunne tail-e FIFO og se kun handlings-relevante hendelser
3. **Snapshot-rapporter** kunne sortere etter alvorlighet
4. **CI/E2E-tester** kunne fail på P0 og warn på P1

## Severity-tabell

### P0 — Regulatorisk eller umiddelbar live-room-stopp

> **Sound:** `Sosumi` (urgent)
> **Push:** macOS notification + FIFO + Terminal bell
> **Reaksjons-tid:** Umiddelbar (< 30 sek)
> **Hva betyr P0:** Spill kan ikke fortsette, regulatorisk-kritisk, eller penger på spill

| Anomali-type | Eksempel-trigger | Tag |
|---|---|---|
| Live-room down | Backend `/api/games/spill[1-3]/health` returnerer 500/503/timeout > 30s | `monitor.live-room-down` |
| Wallet-double-debit | DB-poll viser `app_wallet_accounts.balance != SUM(transactions.amount)` for demo-wallets | `wallet.balance-mismatch` |
| Compliance-violation | Audit-trail UPDATE/DELETE detected, eller §66-bypass | `compliance.audit-mutate` |
| Backend-unreachable > 30s | `curl /api/...` timeout 6 ganger på rad (5s × 6 = 30s) | `monitor.backend-down-30s` |
| Hash-chain broken | `app_compliance_audit_log` hash-chain verifikasjon feiler | `audit.hashchain-broken` |
| Wallet adapter exception | `WalletAdapter.transfer` throw på pilot-haller | `wallet.adapter-exception` |
| Master-action 5xx på live runde | `POST /api/agent/game1/master/start` returnerer 5xx midt i pilot | `master.5xx-during-pilot` |

### P1 — Funksjonell stuck-state eller repeated error

> **Sound:** `Submarine` (assertive)
> **Push:** macOS notification + FIFO + Terminal bell
> **Reaksjons-tid:** Innen 1-2 min
> **Hva betyr P1:** Brukeren merker noe galt, men spill kan fortsette. Krever inngripen ASAP.

| Anomali-type | Eksempel-trigger | Tag |
|---|---|---|
| Stuck draw | Samme `drawIndex` i 60s+ uten progresjon | `draw.stuck` |
| Stale snapshot > 60s | `lastDrawAge > 60s` i health-endpoint mens `status=running` | `health.stale` |
| DB-mismatch | `app_game_plan_run.status='running'` men `app_game1_scheduled_games.status='completed'` | `db.stuck-state` |
| Repeated error in 60s | Samme error-message > 3 ganger innen 60s | `error.repeated` |
| Client error event | `console.error` fra game-client (`popup.blocked-repeat`, `client.error`) | `client.error` |
| Popup-gate-blocked | `popup.autoShowGate` med `willOpen:false` 3× på rad | `popup.blocked-repeat` |
| Backend error log | `ERROR`/`FATAL`/`Unhandled`/`TypeError`/`ReferenceError` i backend stdout | `backend.error` |
| GameStatus stuck > 60s | `gameStatus` uendret > 60s mens drawnNumbers vokser | `gamestatus.stuck` |
| Master start failed | `POST /api/agent/game1/master/start` 4xx mens hall er ready | `master.start-failed` |

### P2 — Monitor-internal eller recoverable

> **Sound:** ingen
> **Push:** Ingen — kun til log
> **Reaksjons-tid:** Best effort, gjennomgås i 60s-snapshot
> **Hva betyr P2:** Monitor-internal degradation, eller info som PM bør se men ikke avbryte for

| Anomali-type | Eksempel-trigger | Tag |
|---|---|---|
| Missing backend-log | `/tmp/spillorama-backend.log` finnes ikke (`dev:nuke` ikke wired) | `monitor.no-backend-log` |
| Backend periodic unreachable | Curl feil < 30s (recover'es typisk innen polling) | `monitor.backend-unreachable` |
| Backend warning | `WARN` i backend stdout | `backend.warn` |
| Slow DB-poll | DB-poll-query > 5s | `monitor.slow-db-poll` |
| Snapshot generation failed | `python3` ikke tilgjengelig, eller JSON-parse-feil | `monitor.snapshot-error` |
| FIFO read failed | Push-daemon kan ikke skrive til FIFO (no reader) | `monitor.fifo-no-reader` |

### P3 — Informational

> **Sound:** ingen
> **Push:** Ingen
> **Reaksjons-tid:** Ingen — kun for round-end-rapporter og history
> **Hva betyr P3:** Normale lifecycle-events som er nyttig for kontekst men ikke handling

| Anomali-type | Eksempel-trigger | Tag |
|---|---|---|
| Round ended (naturlig) | Spill 1 scheduled-game status går til `completed` med `endedReason='full_house_winner'` | `round.ended` |
| Round started | Spill 1 scheduled-game status → `running` | `round.started` |
| GameStatus transition | `UNKNOWN -> RUNNING`, `NONE -> RUNNING`, etc. | `gameStatus.change` |
| Snapshot tick (60s) | Periodisk snapshot for context | `snapshot.tick` |
| Monitor lifecycle | Start/stop av monitor | `monitor.start`, `monitor.stop` |

---

## Implementasjonsregler

### For `pilot-monitor-enhanced.sh`

Bruk `log_anomaly <severity> <kind> <message>`:

```bash
log_anomaly "P0" "wallet.balance-mismatch" "$count demo-wallets har balance != ledger-sum"
log_anomaly "P1" "draw.stuck" "drawIndex=22 uendret i 65s på BINGO_DEMO-PILOT-GOH"
log_anomaly "P2" "monitor.no-backend-log" "Backend stdout-log mangler"
log_anomaly "P3" "round.ended" "Runde 3 ferdig (game-id, 81s)"
```

Format produsert i `/tmp/pilot-monitor.log`:
```
[2026-05-13T14:32:10Z] [P0] wallet.balance-mismatch: 1 demo-wallets har balance != ledger-sum
[2026-05-13T14:33:01Z] [P1] draw.stuck: drawIndex=22 uendret i 65s
[2026-05-13T14:33:30Z] [P2] monitor.no-backend-log: Backend stdout-log mangler
[2026-05-13T14:34:55Z] [P3] round.ended: Runde 3 ferdig (1d3120c4, 81s)
```

**Regex for push-daemon-filtrering:**
```bash
# P0: ALDRI ignorer
grep -E '^\[[^]]+\] \[P0\]'

# P0 eller P1: trigger push
grep -E '^\[[^]]+\] \[P[01]\]'

# Push-format på FIFO:
# [P0 2026-05-13T14:32:10Z] wallet.balance-mismatch: 1 demo-wallets...
```

### For `monitor-push-to-pm.sh`

Push-daemon tailer log med `tail -F`:
- Match `^\[[^]]+\] \[P0\]` → P0-trigger (Sosumi sound)
- Match `^\[[^]]+\] \[P1\]` → P1-trigger (Submarine sound)
- Ignorer P2/P3

For HVER P0/P1-line:
1. Skriv til `/tmp/pilot-monitor-urgent.fifo` (FIFO)
2. Terminal bell (`\a`)
3. macOS notification med korresponderende sound

### Anti-mønstre

**❌ Aldri eskalér P2/P3 til P0/P1 uten ADR:**
Hvis du føler at "snapshot.tick" burde være P1, det betyr at vi har en arkitektur-feil et annet sted. Eskalering må forklares.

**❌ Aldri downgrade P0 til P1 av "støy-redusering":**
P0 = regulatorisk eller live-stopp. Hvis vi får P0-spam, fix root-cause (eks: `dev:nuke` ikke wired). Aldri filtrer det vekk.

**❌ Aldri lag ny severity-nivå:**
P0/P1/P2/P3 er fix-set. Hvis du trenger fin-granularitet, bruk `<kind>`-feltet.

**❌ Aldri lag inline notification uten å logge først:**
Push-daemon leser kun fra log-fil. Hvis du `osascript` direkte i enhanced-monitor, FIFO-en mister event-et og PM-sesjoner får ikke se det.

---

## Hvordan teste klassifiseringen

Kjør automatisk test:
```bash
bash scripts/__tests__/monitor-severity-classification.test.sh
```

Test-script verifiserer:
1. Sample log-lines parses korrekt
2. P0-lines trigger push
3. P2/P3 ikke trigger push
4. Regex-matching er presist (ingen false-positives på `[INFO]` etc.)

Manuell smoke-test:
```bash
# Start monitor + push-daemon
bash scripts/start-monitor-with-push.sh &

# I annet terminal:
tail -f /tmp/pilot-monitor-urgent.fifo

# Skriv en test-P0 til loggen manuelt:
echo "[2026-05-13T14:32:10Z] [P0] test.manual: Manuell P0 trigger" >> /tmp/pilot-monitor.log

# Du skal nå se:
# - macOS notification "Spillorama P0"
# - Bjelle i terminal
# - Linjen i FIFO-en
```

---

## Endringslogg

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-13 | Initial — definert P0-P3 severity-tabell + anti-mønstre + test-prosedyre | Agent (general-purpose) |
