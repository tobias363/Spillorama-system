# Wallet-Integrity Watcher Runbook (OBS-10)

**Status:** Aktiv (2026-05-14)
**Eier:** Ops on-call + Tobias
**Default schedule:** DISABLED (Tobias aktiverer manuelt etter pilot-test)
**Severity ved alert:** **P0** — wallet-integritet er Lotteritilsynet-relevant

---

## 1. Hva watcher-en gjør

`scripts/ops/wallet-integrity-watcher.sh` er en cron-driven sjekk som
håndhever to invariants på wallet-databasen ved hver kjøring. Den er rask
(< 2s mot lokal dev-DB med ~25 kontoer + ~5000 entries) og lager én
markdown-rapport per kjøring som ops/forensics kan inspisere.

### Invariant I1 — Balance-sum

For hver `wallet_accounts`-rad MÅ:

```
wallet_accounts.balance ≡ SUM(CASE wallet_entries.side
                              WHEN 'CREDIT' THEN amount
                              ELSE -amount END)
                          FOR account_id = wallet_id
```

`wallet_accounts.balance` er en `GENERATED ALWAYS`-kolonne av
`deposit_balance + winnings_balance` — så I1 sjekker reelt at de stored
balansene matcher det ledger-historien viser.

**System-kontoer** (`is_system = true`, dvs. `__house__` +
`__external_cash__`) er ekskludert fordi de bevisst holder en negativ
nettoposisjon (de speilet utbetalinger til spillere).

Brudd indikerer ett av disse:

1. Direct INSERT/UPDATE i `wallet_accounts` eller `wallet_entries` som
   ikke gikk via WalletAdapter (forbudt per PITFALLS §2.6 + ADR-0005).
2. En wallet-credit har commitet i `wallet_accounts` men outbox-worker
   feilet å skrive den tilhørende `wallet_entries`-raden (brudd på
   outbox-pattern — trenger forensics).
3. Datatape mellom Postgres og application-layer.

### Invariant I2 — Hash-chain link

For hver `wallet_entries`-rad (siste 24 timer som standard), MÅ:

```
row.previous_entry_hash ≡ predecessor.entry_hash
```

der `predecessor` er forrige rad for samme `account_id` sortert på `id ASC`.

Brudd indikerer ett av disse:

1. En rad mellom denne og forrige er blitt slettet post-hoc.
2. En tidligere rads `entry_hash` er blitt mutert post-hoc.
3. En rad er INSERT-et direkte uten korrekt `previous_entry_hash`.

**NB:** Denne watcher-en **gjør IKKE** full SHA-256 re-compute av selve
`entry_hash`. Det krever canonical-JSON-logikk som lever i TypeScript
(`apps/backend/src/adapters/PostgresWalletAdapter.ts` →
`computeEntryHash`). Den jobben gjøres av `WalletAuditVerifier` som kjøres
som nightly cron + on-demand admin-route.

Watcher-en her er den **raske strukturelle sjekken** som kjører hver time.
Hash-chain-link-bruddet er en sterk og rimelig signal for tamper-detection;
hvis vi ser det, eskalerer vi umiddelbart til full SHA-256-verify.

---

## 2. Komponenter

| Fil | Ansvar |
|---|---|
| `scripts/ops/wallet-integrity-watcher.sh` | Hovedscript. Pinger DB, kjører Q1+Q2, bygger rapport, dedup-state, kaller Linear-issue-script ved brudd. |
| `scripts/ops/wallet-mismatch-create-linear-issue.sh` | Komponerer Linear-issue (eller fallback til Slack/disk). Linear-dedup mot åpne issues siste 24t per wallet_id. |
| `scripts/ops/setup-wallet-integrity-cron.sh` | Installer/uninstaller på launchd (macOS) eller crontab (Linux). Default DISABLED. |
| `scripts/__tests__/ops/wallet-integrity-watcher.test.sh` | 48 tester — pure-function (mock pipe-output) + integration smoke mot lokal DB hvis tilgjengelig. |

---

## 3. Aktivering

Default er **disabled**. Tobias aktiverer manuelt:

```bash
# 1. Verifiser at lokal DB er nådd
psql -X -A -t -c 'SELECT 1' postgresql://spillorama:spillorama@localhost:5432/spillorama

# 2. Kjør en gang manuelt for å verifisere baseline
bash scripts/ops/wallet-integrity-watcher.sh

# 3. Hvis OK → installer cron
bash scripts/ops/setup-wallet-integrity-cron.sh install

# 4. Sjekk status
bash scripts/ops/setup-wallet-integrity-cron.sh status
```

På macOS bruker scriptet `launchd` med plist på
`~/Library/LaunchAgents/com.spillorama.wallet-integrity.plist` og default
intervall 60 min. Logger samles i `/tmp/wallet-integrity-watcher-cron.log`.

På Linux/Render brukes `crontab -e` med samme intervall.

### Custom intervall

```bash
INTERVAL_MINUTES=15 bash scripts/ops/setup-wallet-integrity-cron.sh install
```

### Custom DB (eks. staging)

```bash
WALLET_INTEGRITY_DB_URL='postgresql://user:pass@staging-host/spillorama' \
  bash scripts/ops/setup-wallet-integrity-cron.sh install
```

### Avinstaller

```bash
bash scripts/ops/setup-wallet-integrity-cron.sh uninstall
```

---

## 4. Manuelt kjøring

```bash
# Lokal DB, normal modus (kan opprette Linear-issue ved brudd)
bash scripts/ops/wallet-integrity-watcher.sh

# Dry-run — bygg rapport men opprett ALDRI Linear-issue
DRY_RUN=1 bash scripts/ops/wallet-integrity-watcher.sh

# Mot annen DB
WALLET_INTEGRITY_DB_URL='postgresql://...' bash scripts/ops/wallet-integrity-watcher.sh

# Bredere hash-chain-window (default 24t)
HASH_CHAIN_WINDOW_HOURS=168 bash scripts/ops/wallet-integrity-watcher.sh

# Egen output-mappe (default /tmp)
REPORT_DIR=/var/log/wallet-integrity bash scripts/ops/wallet-integrity-watcher.sh
```

### Exit-codes

| Code | Betydning |
|---|---|
| 0 | Ingen brudd. |
| 1 | Brudd funnet (rapport skrevet, Linear-issue kalt om ikke DRY_RUN). |
| 2 | Postgres ikke nåbar / tabeller mangler. |
| 3 | Konfig-feil (manglende psql/jq/env). |

---

## 5. Tolking av rapporten

Rapporten skrives til `/tmp/wallet-integrity-YYYYMMDDTHHMMSSZ.md` og har tre
seksjoner:

### Seksjon 1 — Summary

Snapshot av antall brudd + DB-host. Hvis alt er friskt:

```
- Balance mismatches (I1): 0
- Hash-chain breaks (I2): 0
- Total violations: 0
```

### Seksjon 2 — I1 Balance-sum mismatches

Tabell med kolonnene:
- **Wallet ID** — `wallet_accounts.id`
- **Stored balance** — verdien i `wallet_accounts.balance`
- **Computed from entries** — beregnet sum fra `wallet_entries`
- **Delta** — stored - computed (positiv = stored er for høy)

Positiv delta indikerer at wallet'en har "magisk" balanse uten ledger-spor
— mest sannsynlig direct INSERT eller seeding (load-test eller manuell
INSERT). Negativ delta indikerer at ledger har entries som ikke har slått
gjennom på balansen — gjerne en outbox-worker som har feilet.

### Seksjon 3 — I2 Hash-chain link breaks

Tabell med:
- **Wallet ID** — `wallet_entries.account_id`
- **Entry ID** — raden som peker feil
- **Reason** — `previous_hash_mismatch`, `missing_entry_hash`, eller
  `missing_previous_entry_hash`
- **Stored prev** — det `previous_entry_hash`-feltet faktisk har (12 første tegn)
- **Expected prev** — det forrige raden sin `entry_hash` faktisk er
- **Predecessor ID** — `id` til raden vi forventet å matche mot

---

## 6. Eskalerings-prosedyre ved alert

### Steg 1 — Triage (innen 5 min)

1. Sjekk Linear-issue (eller fallback til Slack/disk-fil).
2. Hent rapporten: `cat /tmp/wallet-integrity-*.md | tail -200`
3. Klassifiser:
   - **Bare I1 (balance-sum)** og delta er positiv på `loadtest-*` eller
     `__house__/__external_cash__`-relaterte konti → sannsynligvis test-
     fiksturer eller systemkonti. Lav severity. Dokumenter i incident-log
     men ingen Lotteritilsynet-eskalering.
   - **I2 (hash-chain)** under aktiv pilot → **P0**. Page on-call.
   - **I1 med betydelig negativ delta** (> 100 NOK) på spiller-wallet
     → **P0**. Page on-call.

### Steg 2 — Stopp wallet-skrivning (kun ved P0)

```bash
# Sett feature-flag i prod for å blokkere wallet-writes (admin-route)
curl -X POST https://spillorama-system.onrender.com/api/admin/feature-flags \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"flag":"wallet_writes_blocked","enabled":true,"reason":"P0 integrity break — runbook §6.2"}'
```

(Hvis denne flag-en ikke finnes som live API: ta backend ut av rotasjon
via Render → maintenance-mode.)

### Steg 3 — Forensics

```bash
# 1. Hvilke transaksjoner berører wallet-en?
PGPASSWORD=$PGPASSWORD psql -h $PGHOST -U spillorama -d spillorama -c "
  SELECT id, side, account_side, amount, operation_id, transaction_id, created_at
    FROM wallet_entries
   WHERE account_id = '<wallet_id>'
   ORDER BY id DESC
   LIMIT 50;"

# 2. Finnes operation_id-ene i outbox?
psql ... -c "
  SELECT op_id, status, retry_count, last_error
    FROM wallet_outbox
   WHERE op_id IN ('...', '...');"

# 3. Compliance-trail
psql ... -c "
  SELECT id, action, actor_type, actor_id, resource_id, created_at, details
    FROM app_compliance_audit_log
   WHERE resource_id = '<wallet_id>'
      OR details::text LIKE '%<wallet_id>%'
   ORDER BY id DESC
   LIMIT 50;"

# 4. Full SHA-256 hash-chain verify
npm --prefix apps/backend run audit:wallet-verify -- --account-id=<wallet_id>
```

### Steg 4 — Lotteritilsynet-notifikasjon (innen 24t)

Hvis I2 er bekreftet og kan ikke forklares av kjente seeds/migrations:

1. Følg `docs/operations/COMPLIANCE_INCIDENT_PROCEDURE.md` §1.1.
2. Skriftlig notifikasjon til Lotteritilsynet innen 24 timer.
3. Hvis GDPR-relevant: Datatilsynet innen 72 timer.
4. Append-only korreksjon — NEVER `UPDATE` eller `DELETE` på
   `wallet_entries`/`app_compliance_audit_log`.

### Steg 5 — Korreksjon (når trygt)

```typescript
// Eksempel: append en korreksjons-credit som peker tilbake til originalen.
await walletAdapter.credit({
  accountId: walletId,
  amount: deltaToCorrect,
  side: 'CREDIT',
  accountSide: 'deposit',
  operationId: `wallet-integrity-correction-${incidentId}`,
  idempotencyKey: IdempotencyKeys.walletCorrection(incidentId, walletId),
  reason: `Correction for incident ${incidentId}. Original entries: ${originalIds}.`,
});
```

### Steg 6 — Post-mortem

Skriv post-mortem i `docs/postmortems/YYYY-MM-DD-wallet-integrity-incident.md`
basert på malen. Dekk:

- Tidslinje (når oppstod, når oppdaget, når mitigert)
- Root cause (hvilken kode-sti, hvilken migrasjon, hvilken manuell handling)
- Hvorfor watcher-en fanget det vs. hvor vi var blinde før
- Forebygging (kode-test, migration-policy, MCP-write-access endring)

---

## 7. Konfig-referanse

| Env | Default | Beskrivelse |
|---|---|---|
| `WALLET_INTEGRITY_DB_URL` | `postgresql://spillorama:spillorama@localhost:5432/spillorama` | DB-tilkobling |
| `REPORT_DIR` | `/tmp` | Hvor rapporter skrives |
| `REPORT_RETENTION_HOURS` | `168` (7 d) | Eldre rapporter slettes |
| `HASH_CHAIN_WINDOW_HOURS` | `24` | Hvor langt tilbake Q2 leser |
| `STATE_FILE` | `/tmp/wallet-integrity-watcher-state.json` | Per-wallet_id dedup-tilstand |
| `LINEAR_ISSUE_DEDUP_HOURS` | `24` | Maks én Linear-issue per wallet_id per døgn |
| `PSQL_CONNECT_TIMEOUT` | `5` | Sekunder for psql-connect |
| `DRY_RUN` | `0` | `1` = skip Linear-create + Slack |
| `LINEAR_API_KEY` | — | Linear API-key (eller via `secrets/linear-api.local.md`) |
| `LINEAR_TEAM_KEY` | `BIN` | Linear team |
| `LINEAR_LABEL_NAME` | `wallet-integrity` | Label på issue (må finnes i workspace) |
| `LINEAR_PRIORITY` | `1` (Urgent) | Issue-prioritet |
| `SLACK_ALERT_WEBHOOK_URL` | — | Fallback hvis Linear nede |
| `FALLBACK_OUTPUT_DIR` | `/tmp/wallet-integrity-alerts` | Disk-fallback for issue-body |

---

## 8. Forhold til andre kontroller

| Kontroll | Når | Hva |
|---|---|---|
| **Watcher (denne)** | Hver time | Q1 balance-sum + Q2 hash-chain-link structural |
| **WalletAuditVerifier** | Nightly | Full SHA-256 hash-chain re-compute per account |
| **WalletReconciliationCron** | Nightly | Cross-system balanse-sjekk (Postgres ↔ regnskap) |
| **Outbox-worker** | Kontinuerlig | Skriver `wallet_entries` etter `wallet_accounts`-mutering |

Watcher-en er **rask og strukturell** — den fanger 90 % av alle problemer
før nattlig verifyAll. Hash-chain-link-bruddet er den raskeste signalet på
tamper, og det er svært vanskelig å konstruere et ekte brudd uten samtidig
å bryte denne sjekken. Full SHA-256-verify er backup som fanger de siste
10 % (skjevhet i selve hash-beregningen, eksempel etter migrations som
endrer kolonne-rekkefølge).

---

## 9. ADR-er + relaterte dokumenter

- [ADR-0003 — System-actor for engine-mutasjoner](../adr/0003-system-actor.md)
- [ADR-0004 — Hash-chain audit-trail (BIN-764)](../adr/0004-hash-chain-audit.md)
- [ADR-0005 — Outbox-pattern for events (BIN-761)](../adr/0005-outbox-pattern.md)
- [ADR-0014 — Idempotent migrations](../adr/0014-idempotent-migrations.md)
- [ADR-0023 — MCP write-access policy (lokal vs prod)](../adr/0023-mcp-write-access-policy.md)
- `docs/operations/COMPLIANCE_INCIDENT_PROCEDURE.md` — eskaleringsprosedyre
- `docs/operations/WALLET_RECONCILIATION_RUNBOOK.md` — nattlig recon
- `docs/operations/DB_PERF_WATCHER_RUNBOOK.md` — OBS-9 søsterscript
- `apps/backend/src/wallet/WalletAuditVerifier.ts` — full SHA-256-verify
- `apps/backend/src/adapters/PostgresWalletAdapter.ts` — `computeEntryHash`
- `docs/engineering/PITFALLS_LOG.md` §2.6 + §2.8 + §2.9

---

## 10. FAQ

### "Watcher-en rapporterer brudd på `loadtest-wallet-*` — er det reelt?"

Sannsynligvis ikke. Load-test-fixturen seedet wallet-balanser direkte via
`INSERT INTO wallet_accounts` uten å skrive ledger. Det er en kjent
testdata-tilstand, ikke en compliance-incident.

Hvis du vil filtrere bort load-test-wallets fra watcher-rapporten, kan
runbook-en oppdateres med en allowlist (mest sannsynlig en `EXCEPTIONS`-
SQL-CTE i Q1). Per 2026-05-14 er det IKKE implementert — vi vil heller se
disse i rapporten så vi husker å rydde test-fiksturen.

### "Watcher-en sier hash-chain er OK, men WalletAuditVerifier feiler — er det normalt?"

Ja, det kan skje hvis selve `entry_hash`-beregningen er endret (eks. ny
felter i canonical-JSON) uten at vi har rebuildet alle hashene. Watcher-en
sjekker bare _strukturen_ (peker rad N tilbake til rad N-1?), ikke
_innholdet_. Hvis du ser dette mønsteret → eskaler til Tobias.

### "Kan vi bruke watcher-en mot prod-DB?"

Nei. Watcher-en er bevisst designet for lokal dev + staging. Prod-MCP er
read-only per ADR-0023. For prod-DB bruker vi i stedet:

- Nightly `WalletAuditVerifier` cron i `apps/backend/src/jobs/walletAuditVerify.ts`
- On-demand admin-route `GET /api/admin/wallet/audit-verify/:accountId`

### "Hvorfor er default 60 min og ikke 5 min?"

DB-roundtrip på Q1 + Q2 mot prod-skala (10k+ kontoer, 1M+ entries) tar
sekunder, og brudd er sjeldne. 60 min gir oss < 1 time MTTD (mean time to
detect) som er innenfor vår SLA på "fange før nattlig WalletAuditVerifier".

For pilot-test-mode kan du senke til 5 min midlertidig:

```bash
INTERVAL_MINUTES=5 bash scripts/ops/setup-wallet-integrity-cron.sh install
```

---

## 11. Endringslogg

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-14 | Initial (OBS-10) | Agent (wallet-integrity-watcher) |
