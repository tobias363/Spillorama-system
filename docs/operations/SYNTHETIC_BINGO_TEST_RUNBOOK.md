# Synthetic Spill 1 bingo-round-test — runbook

**Status:** Aktiv (etablert 2026-05-14)
**Eier:** Casino-grade-testing-agent
**Skala:** Tier-A — pilot-go-live-gating (R4-precursor)
**Lese-først:** Ja for alle som skal aktivere, tolke eller forlenge denne testen.

---

## 1. Hva tester denne?

Denne syntetiske end-to-end-testen driver én komplett bingo-runde av
Spill 1 (slug `bingo`) mot et kjørende Spillorama-backend og verifiserer
seks **strukturelle invarianter** (I1-I6) som er pilot-go-live-gating.

Den fungerer som **R4-precursor**: en småskala-versjon (10 spillere × 3
bonger) som kjøres FØR den fulle 1000-klienter-load-testen i R4
([BIN-817](https://linear.app/bingosystem/issue/BIN-817)). Hvis I1-I6
ikke holder på 10 spillere, holder de heller ikke på 1000.

**Mandatet** kommer fra Tobias-direktiv 2026-05-14:

> "Vi trenger ALLEREDE NÅ et synthetic end-to-end-test som verifiserer
> at en hel bingo-runde fungerer feilfritt — master starter ny runde
> via plan-runtime, N spillere kjøper M bonger hver, engine trekker
> baller, klienter markerer, vinner deteksjon + payout, compliance-
> ledger entries skrives korrekt, wallet-balance konsistent etter
> runden."

Den dekker dette ende-til-ende uten chaos-injeksjon. R2/R3 (failover +
reconnect) dekker chaos-aspektet separat — se
[`LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md`](../architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md) §3.3.

## 2. De seks invariantene

Hver invariant returnerer `PASS` / `FAIL` / `WARN`. `FAIL` på ÉN
invariant er pilot-blokker — pilot pauses inntil rotårsak er løst per
mandatets §6.1 go/no-go-policy.

| ID | Tittel | Spør | Hvor brytes denne |
|---|---|---|---|
| **I1** | Wallet-konservering | `SUM(før) − SUM(spent) + SUM(payout) == SUM(etter)`? | Double-debit-race, mistet payout, idempotency-bypass |
| **I2** | Compliance-ledger | Minst én STAKE-entry per kjøp og én PRIZE-entry per payout? | Engine bypasser `recordStake`/`recordPayout` ved bestemte feil-paths |
| **I3** | Hash-chain intakt | `previous_entry_hash → entry_hash` valid for de N siste entries? | Audit-log korrupsjon eller direct INSERT bypassing `WalletAdapter` |
| **I4** | Draw-sequence consistency | Alle spillere mottok samme draw-sekvens i samme rekkefølge? | Broadcaster brutt, cross-instance-fanout-bug |
| **I5** | Idempotency | `clientRequestId` → samme `purchaseId` på re-submit? | Server creates duplicate-row på re-send |
| **I6** | Round-end-state | `scheduled_game.status === 'finished'` etter siste fase? | Engine stuck i `running`/`paused`, plan-runtime ikke advancet |

Detaljerte definisjoner: [`scripts/synthetic/invariants.ts`](../../scripts/synthetic/invariants.ts) (selve dokumentasjonen er der koden bor).

### Severity av brudd

- **I1, I2, I6 brudd** → P0-pilot-blokker (compliance + regulatorisk eksponering)
- **I3, I5 brudd** → P0-pilot-blokker (audit-trail-integritet)
- **I4 brudd** → P1 (klient-UX-divergens men ingen regulatorisk-feil)

Eskaler ALLE FAIL til Tobias via PM-kanalen. Ingen "fixer i drift".

## 3. Hva tester den IKKE?

Bevisst out-of-scope (dekkes av andre tester):

- **Failover / instans-restart midt i runde** → R2 chaos-test
- **Klient nett-glipp / reconnect** → R3 chaos-test
- **Load-test 1000 klienter** → R4 ([BIN-817](https://linear.app/bingosystem/issue/BIN-817))
- **Spill 2 24t-leak-test** → R9 ([BIN-819](https://linear.app/bingosystem/issue/BIN-819))
- **Spill 3 phase-state-machine chaos** → R10 ([BIN-820](https://linear.app/bingosystem/issue/BIN-820))
- **Mini-game payout-paths** (Wheel, Chest, Mystery, ColorDraft) — krever en runde der minimum én Fullt Hus inntreffer, og bot-en garanterer ikke dette
- **Multi-vinner pot-split-floor-rest** — testen aksepterer floor-rest-tolerance, men verifiserer ikke regelen i `SPILL_REGLER_OG_PAYOUT.md` §9 isolert. Bruk dedikerte unit-tester i `Game1PayoutService.test.ts`.

## 4. Kjøre lokalt

### 4.1 Forutsetninger

1. Backend kjører på `http://localhost:4000` (start med `npm run dev:nuke`).
2. Postgres + Redis er opp.
3. `seed-demo-pilot-day.ts` har kjørt minst én gang slik at det finnes:
   - 4 haller (`demo-hall-001..004`) med `demo-hall-001` som master
   - 4 agenter (`demo-agent-1..4@spillorama.no`)
   - 12 spillere (`demo-pilot-spiller-1..12@example.com`)
   - Spilleplan-template med 13 katalog-items, hvor item 1 er `bingo` med Yellow=10kr / White=5kr / Purple=15kr-priser

### 4.2 Default-run (10 spillere × 3 bonger)

```bash
cd /Users/tobiashaugen/Projects/Spillorama-system
RESET_TEST_PLAYERS_TOKEN=spillorama-2026-test \
  bash scripts/synthetic/spill1-round-runner.sh
```

Output:
- Live progress på stderr
- Markdown-rapport på `/tmp/synthetic-spill1-YYYY-MM-DDTHH:MM:SS.md`
- Exit-code:
  - `0` — alle invariants PASS (eller PASS + WARN)
  - `1` — minst én invariant FAIL → pilot pauses
  - `2` — pre-flight-failure (backend down, manglende seed, etc.)

### 4.3 Run-modes

```bash
# Dry-run — pre-flight + health, INGEN wallet-mutering. CI smoke-test.
bash scripts/synthetic/spill1-round-runner.sh --dry-run

# CI mode — kortere timeouts (30s vs 60s default).
bash scripts/synthetic/spill1-round-runner.sh --mode=ci

# Større belastning (12 spillere × 5 bonger)
bash scripts/synthetic/spill1-round-runner.sh --players=12 --tickets-per-player=5

# Annen master-hall (eksempel: Bodø)
bash scripts/synthetic/spill1-round-runner.sh \
  --hall-id=afebd2a2-52d7-4340-b5db-64453894cd8e \
  --master-email=demo-agent-2@spillorama.no

# Mot staging-backend
bash scripts/synthetic/spill1-round-runner.sh \
  --backend-url=https://staging.spillorama-system.onrender.com \
  --reset-token=$STAGING_RESET_TOKEN
```

### 4.4 npm-script-aliaser

```bash
# Default flow (locally)
npm run test:synthetic

# Apps/backend-prefiks (kjører samme runner)
npm --prefix apps/backend run test:synthetic-spill1
```

## 5. Kjøre i CI

Synthetic-testen kjører IKKE blokkerende i CI per 2026-05-14 — det krever
en fersh demo-seed pre-test som er for tungt for hver PR-run. Modus
`--dry-run` (under 5 sek, kun fetch-mocks) er imidlertid sikker og kan
slås på som smoke-test i en separat workflow.

Planlagt CI-utvidelse (post-pilot):
1. Sett opp ephemeral Docker-stack med Postgres + Redis + seed-data
2. Kjør `npm run test:synthetic -- --mode=ci`
3. Upload rapport som workflow-artifact
4. Block merge på exit-code != 0

## 6. Tolke rapporten

Eksempel-snippet (PASS-run):

```markdown
# Synthetic Spill 1 bingo-round-test — rapport

**Tidspunkt:** 2026-05-14T14:30:00.000Z
**Modus:** local
**Backend:** http://localhost:4000
**Hall:** demo-hall-001
**Spillere:** 10
**Bonger per spiller:** 3
**Varighet:** 47.3s
**Resultat:** PASS

## Sammendrag
- scheduledGameId: 8e2f3...
- players: 10
- observers: 10
- purchases: 20 (10 ekte + 10 idempotency-probes)
- payouts: 1
- endedNaturally: true

## Invarianter (I1-I6)

### I1 — Wallet-konservering: **PASS**
wallets=10 | totalBefore=500000 | totalAfter=474500 | totalSpent=15000 | totalWon=2500
| expectedAfter=474500 | delta=0 øre | tolerance=1 øre

### I2 — Compliance-ledger entries skrevet: **PASS**
purchases=10 (unique) | payouts=1 | ledger.stake=10 | ledger.prize=1
| min.stake=10 | min.prize=1

### I3 — Hash-chain intakt: **WARN**
entriesChecked=0 | entriesValid=0 | mismatches=0 | chainOk=skipped
| hopper over (token-gated endpoint disabled eller dry-run)

### I4 — Draw-sequence consistency: **PASS**
players=10 | longestSequence=45 draws | inconsistencies=0

### I5 — Idempotency: **PASS**
totalPurchases=20 | uniqueClientRequestIds=10 | uniquePurchaseIds=10
| alreadyExisted=10 | intentionalDuplicates=10

### I6 — Round-end-state: **PASS**
scheduledGameId=8e2f3... | status=finished | drawsTotal=45

## Aggregert
- PASS: 5
- FAIL: 0
- WARN: 1
```

### 6.1 Hva betyr WARN?

`WARN` er IKKE en feil. Det betyr at testen ikke kunne verifisere
invarianten denne gangen — typisk fordi:

- `--mode=dry-run` ble brukt (alt blir WARN by design)
- `RESET_TEST_PLAYERS_TOKEN` ikke satt → I2/I6 mangler replay-data
- Hash-chain-verifikasjon er ikke koblet inn enda (alltid WARN inntil
  videre — se §8 nedenfor)

WARN bidrar IKKE til FAIL-count. Rapportens `**Resultat:**` er kun
`PASS` eller `FAIL`. Hvis du ser WARN i prod-pilot-runs, er det et
**signal om at testen ikke ga full dekning** — du trenger mer
konfigurasjon, ikke en bugfix.

## 7. Når invariants FEILER

### Generell prosedyre

1. **STOPP umiddelbart.** Pilot-pause hvis prod, fix-forward hvis dev.
2. **Lag Linear-issue** med tag `synthetic-test-fail` + invariant-ID.
3. **Eskaler til Tobias** via PM-kanalen.
4. **Vedlegg rapport** (`/tmp/synthetic-spill1-*.md`) og room-snapshot
   fra `/api/_dev/debug/round-replay/<scheduledGameId>?token=...`.
5. **Reproduser med mindre seed** (`--players=2 --tickets-per-player=1`)
   før du fikser.

### Per-invariant feilsøking

| Invariant FAIL | Sjekk først | Typisk root-cause |
|---|---|---|
| **I1 Wallet-konservering** | `app_wallet_entries` for de N siste txn-ene. Subtraksjon på begge sider av equation. | Race-condition i `Game1TicketPurchaseService.purchase`, outbox-worker drainer ikke, eller idempotency-bypass i payout |
| **I2 Compliance-ledger** | `app_compliance_outbox` for status=PENDING. `/api/_dev/debug/round-replay/<id>` for `summary.compliance.ledgerEntries`. | Engine emitter `pattern:won` men payout-tjenesten kaster før `ComplianceLedger.recordPayout`. Outbox-worker stuck. |
| **I3 Hash-chain** | Kjør `npm --prefix apps/backend run verify-wallet-audit-chain`. Mismatches viser nøyaktig konto. | Direct INSERT i `app_wallet_entries` (bypass `WalletAdapter`), eller `entry_hash`-format-endring uten backfill. |
| **I4 Draw-sequence** | Socket.IO Redis adapter health. `io.adapter.serverCount()` på hver instans. | Redis pub/sub kobling brutt, eller engine kjører på to instanser uten lock-koordinering. |
| **I5 Idempotency** | `app_game1_ticket_purchases` for dup-rader med samme `idempotency_key`. | Service-laget gjør INSERT uten `ON CONFLICT (idempotency_key)`-håndtering, eller `withSocketIdempotency` ikke wrap-er purchase-handler. |
| **I6 Round-end-state** | `app_game1_scheduled_games.status` for runden. `app_game_plan_run.status`. | Engine endte aldri runden naturlig (75 draws aldri trukket), eller plan-runtime ikke kalte `finish()`. |

### Kjente fail-modes

#### I4 FAIL etter Redis-restart

Hvis Redis restartes mid-test (dev-flow) kan socket.io-adapter miste pub/sub
og noen klienter får inkonsistente draws. Dette **er ikke** en prod-bug —
det er test-infra-bug. Restart `npm run dev:nuke` og kjør synthetic-test
på nytt.

#### I2 FAIL men replay-API viser entries finnes

Hvis `/api/_dev/debug/round-replay/<id>` viser ledger-entries men I2 FEILER:
- Sjekk om `RESET_TEST_PLAYERS_TOKEN` matcher backend-env (env-var-skewing)
- Sjekk at scheduled-game-id-en bot-en bruker matcher den replay-API
  reporterer

## 8. Kjente begrensninger

### I3 Hash-chain er for øyeblikket alltid WARN

Per 2026-05-14 har bot-en ikke direkte DB-tilgang og kan ikke kalle
`WalletAuditVerifier`. Hash-chain-verifikasjon er WARN inntil en av
disse løses:

1. Token-gated dev-endpoint `/api/_dev/wallet-audit-chain?...` legges
   til (foreslått follow-up)
2. Bot-en utvides med direkte Postgres-connection (kostbart å sette opp
   i CI)

Inntil da må hash-chain-verifikasjon kjøres separat:

```bash
npm --prefix apps/backend run verify-wallet-audit-chain
```

### Bot-en spawner ikke alltid en vinnende runde

For at I2 og I6 skal gi meningsfulle PASS-resultater må runden faktisk
ende naturlig (Fullt Hus eller 75 draws). Bot-en venter inntil
`--timeout`-sekunder (default 60s). Hvis engine-tick ikke kjører fort
nok (eks. `draw-interval=10s` i staging) → I6 vil FAIL med
`status === 'running'`.

**Mitigation:** kjør med `--timeout=180` for slow-tick-staging.

### Bot kan kjøre på enhver hall med pilot-seed

Hvis seed-en endres (ulike priser, ulike farger) må `defaultTicketSpec`
i `spill1-round-bot.ts` oppdateres. Se Pitfall §6.18.

## 9. Vedlikehold

### Når må testen oppdateres?

- **API-shape endres** (eks. `POST /api/agent/game1/master/start` får nytt body-felt) — oppdater `ApiClient`-metoder
- **Spill-1 ticket-config endres** (eks. ny bongfarge legges til) — oppdater `defaultTicketSpec`
- **Replay-API summary-shape endres** — oppdater `fetchReplaySummary`
- **Ny invariant skal legges til** (eks. I7) — legg til ny evaluator i `invariants.ts` + tester

### Per Tobias-direktiv §2.12 (test-driven iterasjon, 2026-05-13):
> Hvis en bug ses 2+ ganger, skriv først test som reproduserer.

Synthetic-testen er IKKE erstatning for unit-tester av enkeltsystemer.
Den er en **systemnivå-sikring** mot integration-regression.

## 10. Referanser

- Bot-kode: [`scripts/synthetic/spill1-round-bot.ts`](../../scripts/synthetic/spill1-round-bot.ts)
- Invariant-evaluators: [`scripts/synthetic/invariants.ts`](../../scripts/synthetic/invariants.ts)
- Bash-runner: [`scripts/synthetic/spill1-round-runner.sh`](../../scripts/synthetic/spill1-round-runner.sh)
- Unit-tester: [`scripts/__tests__/synthetic/spill1-round-bot.test.ts`](../../scripts/__tests__/synthetic/spill1-round-bot.test.ts)
- **Live-rom-robusthet-mandat:** [`LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md`](../architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md) §3.3 (R4 mandate)
- Round-replay-API: [`apps/backend/src/observability/roundReplayBuilder.ts`](../../apps/backend/src/observability/roundReplayBuilder.ts) (etablert PR #1424, 2026-05-14)
- Casino-grade-testing-skill: `.claude/skills/casino-grade-testing/SKILL.md`
- Spill-regler: [`SPILL_REGLER_OG_PAYOUT.md`](../architecture/SPILL_REGLER_OG_PAYOUT.md) (auto-multiplikator, pot-split)
- PITFALLS_LOG: `docs/engineering/PITFALLS_LOG.md` §6.18

## 11. Endringslogg

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-14 | Initial — etablert per Tobias-direktiv "synthetic bingo-runde-test" (R4-precursor). I1-I6 invariants, dry-run + local + ci modes, bash-runner med RESET_TEST_PLAYERS_TOKEN-gating. | synthetic-test-agent |
