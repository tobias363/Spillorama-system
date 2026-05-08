# Wallet Reconciliation Runbook (BIN-790 C4)

**Owner:** Compliance-eier (TBD pre-pilot) + L2 backend on-call
**Co-owner:** Technical lead (Tobias Haugen)
**Related Linear:** BIN-790 (M2 — Multi-hall-launch, Spor C — Operasjon & infrastruktur), BIN-763 (nightly recon-job)
**Last updated:** 2026-05-08
**Audience:** Compliance-eier (daglig kontroll), L2 backend on-call (mismatch-mitigation), Tobias.

> Denne runbooken beskriver hvordan vi kjører og håndterer den
> nattlige wallet-reconciliation-jobben. For:
>
> - **Lotteritilsynet-meldepliktig hendelse**: se [`COMPLIANCE_INCIDENT_PROCEDURE.md`](./COMPLIANCE_INCIDENT_PROCEDURE.md).
> - **Datatap som krever PG-restore**: se [`DATABASE_RESTORE_PROCEDURE.md`](./DATABASE_RESTORE_PROCEDURE.md).
> - **Swedbank-spesifikk recon (utenfor wallet-balanse)**: se [`DISASTER_RECOVERY_PLAN_2026-04-25.md`](./DISASTER_RECOVERY_PLAN_2026-04-25.md) §8.

---

## 0. TL;DR

Hver natt kl. 03:00 lokal kjører `WalletReconciliationService`:

1. Sammenligner `wallet_accounts.{deposit_balance, winnings_balance}`
   mot `SUM(wallet_entries.amount)` per (konto, side).
2. Avvik > 0.01 NOK → ny rad i `wallet_reconciliation_alerts`.
3. Skriver ALDRI tilbake til `wallet_accounts` automatisk — admin må
   undersøke.

| Mål | Verdi |
|---|---|
| Kjøre-tid | < 60 sek for 100k konti |
| RPO ved divergens | Oppdaget innen 24 t |
| RTO for resolve | < 4 timer (under åpningstid) |
| Forventet daglig recon-output | 0 alerts |

Compliance-eier sjekker hver morgen mellom 08:00–10:00.

---

## 1. Hva jobben gjør (oversikt)

### 1.1 Job-arkitektur

- **Schedule:** 03:00 lokal tid (post-midnatt-burst, før morgen-trafikk).
- **Polling-interval:** 15 min — gater på `(HH:MM, date-key)` for én run/dag.
- **Threshold:** divergens > 0.01 NOK (1 øre). Mindre tolkes som flytetalls-støy.
- **Idempotens:** ON CONFLICT DO NOTHING på partial UNIQUE index for åpne alerts per (account_id, account_side).

### 1.2 Hvorfor double-entry?

Hver wallet-touch skriver to entries:
- En CREDIT på avsender-kontoen
- En DEBIT på mottaker-kontoen
- Eller motsatt for inn/ut

Recon-jobben:
- Beregner `expected = SUM(CREDIT) - SUM(DEBIT)` per (konto, side)
- Sammenligner mot `wallet_accounts.balance` (cached aggregate)
- Avvik betyr at cache er ute av synk med ledger

### 1.3 Hva avvik kan bety

| Symptom | Sannsynlig årsak |
|---|---|
| Én konto, deposit-side, ~10 NOK | Rounding-bug eller manglende entry |
| Mange konti, samme beløp | Bug i felles kode (eks. fee-beregning) |
| Én konto, stor avvik (>100 NOK) | Tapt write under DB-failover, eller manuell SQL-feil |
| Hash-chain-brudd samtidig | Audit-trail tampered, mistanke om uautorisert tilgang |

---

## 2. Trigger — når må jobben kjøres manuelt?

| Scenario | Bruk |
|---|---|
| Mistanke om wallet-mismatch midt på dagen | `POST /api/admin/wallet/reconcile-now` |
| Etter PG-restore | Trigger umiddelbart for å verifisere data |
| Etter migration som rørte wallet_entries | Trigger som verifikasjons-step |
| Etter compliance-korrigering | Trigger for å bekrefte at korreksjon har lukket alerts |

---

## 3. Detection — daglig kontroll

### 3.1 Compliance-eier morgen-rutine (10 min hver morgen)

```bash
# 1. Sjekk åpne alerts
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://api.spillorama.no/api/admin/wallet/reconciliation-alerts | jq .

# Forventet: { "ok": true, "data": { "alerts": [], "count": 0 } }

# 2. Hvis count > 0 — eskalér umiddelbart
```

### 3.2 Automatiske alarmer

| Alarm | Kilde | Når trigger |
|---|---|---|
| Sentry: `wallet-reconciliation: divergence detected` | Sentry filter on `module:wallet-reconciliation` | En eller flere divergenser |
| Prometheus `wallet_reconciliation_divergence_total` spike | Grafana | Verdi > 0 (>0 alerts) |
| Prometheus `wallet_reconciliation_clean` ikke inkrement-er | Grafana | Job kjørte med divergens |
| Cron-feil (job kjørte ikke) | Render-logger | `last_ran_at` > 26 t siden |

### 3.3 Direkte SQL-kontroll

```sql
-- 1. Antall åpne alerts
SELECT COUNT(*) FROM wallet_reconciliation_alerts WHERE resolved_at IS NULL;

-- 2. Detaljer på åpne alerts (siste 5)
SELECT id, account_id, account_side, expected_balance, actual_balance,
       divergence, detected_at
  FROM wallet_reconciliation_alerts
 WHERE resolved_at IS NULL
 ORDER BY detected_at DESC
 LIMIT 5;

-- 3. Verifiser job kjørte i natt
SELECT MAX(detected_at) FROM wallet_reconciliation_alerts;
-- Eller:
-- (krever audit_log)
SELECT MAX(created_at) FROM audit_log
 WHERE action IN ('wallet.reconciliation.run_now', 'wallet.reconciliation.cron')
   AND created_at > NOW() - INTERVAL '24 hours';
```

---

## 4. Severity-klassifisering

| Symptom | Severity | Eskalering |
|---|---|---|
| 1 alert, divergens < 1 NOK | C-P3 | Compliance-eier undersøker innen 4 timer |
| 1 alert, divergens 1-100 NOK | C-P2 | Compliance-eier + L2 innen 1 time |
| 1 alert, divergens > 100 NOK | C-P1 | Tobias varsles innen 30 min |
| Flere alerts samme dag | C-P1 | Tobias + compliance-eier umiddelbart |
| Hash-chain-brudd samtidig | C-P1 | SEV-1, full incident-flow per [`COMPLIANCE_INCIDENT_PROCEDURE.md`](./COMPLIANCE_INCIDENT_PROCEDURE.md) |
| Job kjørte ikke i 48 t+ | C-P2 | L2 sjekker cron-helse |

---

## 5. Mitigation — håndtere et alert

### 5.1 Steg 1: Forensikk (15-30 min)

For hver åpen alert:

```sql
-- Identifiser kontoen og spilleren
SELECT a.id, a.user_id, a.deposit_balance, a.winnings_balance,
       u.email, u.kyc_status
  FROM wallet_accounts a
  JOIN app_users u ON u.id = a.user_id
 WHERE a.id = '<account-id>';

-- List alle wallet_entries for denne kontoen siste 7 dager
SELECT id, account_side, amount, side, type, idempotency_key, created_at
  FROM wallet_entries
 WHERE account_id = '<account-id>'
   AND created_at > NOW() - INTERVAL '7 days'
 ORDER BY created_at DESC;

-- Beregn forventet balanse manuelt
SELECT account_side,
       SUM(CASE WHEN side = 'CREDIT' THEN amount ELSE -amount END) AS expected
  FROM wallet_entries
 WHERE account_id = '<account-id>'
 GROUP BY account_side;

-- Sammenlign med actual i wallet_accounts
SELECT deposit_balance, winnings_balance FROM wallet_accounts WHERE id = '<account-id>';
```

### 5.2 Steg 2: Identifiser rotårsak

| Hypotese | Hvordan teste |
|---|---|
| Manglende entry (bug i kode) | Søk etter en transaksjon som finnes i `audit_log` men ikke `wallet_entries` |
| Dobbelt entry (idempotency-feil) | `SELECT idempotency_key, COUNT(*) FROM wallet_entries GROUP BY 1 HAVING COUNT(*) > 1;` |
| Manuell DB-edit | Sjekk `audit_log` for SQL-handlinger |
| Cache-divergens (wallet_accounts.balance ute av synk) | Kjør recon på samme konto via `reconcile-now` etter manuell fix |
| PG-failover-tap | Sammenlign timestamp av siste entry mot kjent failover-event |

### 5.3 Steg 3: Korreksjon

> **Aldri** UPDATE eller DELETE wallet_entries. Alle korreksjoner
> skrives som nye `CORRECTION`-rader.

```sql
-- 1. Identifiser hvor mye som skal korrigeres
-- (eks. expected = 1000 NOK, actual = 1150 NOK → må trekke 150 NOK)

-- 2. Skriv correction-rad i ledger
INSERT INTO compliance_ledger (
  idempotency_key, user_id, wallet_id, amount_cents, type,
  reason, created_at, created_by
) VALUES (
  'correction-recon-<alert-id>',
  '<user-id>',
  '<wallet-id>',
  -15000,  -- -150 NOK i øre
  'CORRECTION',
  'Wallet reconciliation alert <alert-id>: cache divergens',
  NOW(),
  'compliance-owner-uuid'
);

-- 3. Skriv korresponderende wallet_entries
INSERT INTO wallet_entries (
  account_id, account_side, amount, side, type,
  idempotency_key, created_at
) VALUES (
  '<account-id>', 'deposit', 15000, 'DEBIT', 'CORRECTION',
  'correction-recon-<alert-id>', NOW()
);

-- 4. Oppdater wallet_accounts cache (eller vent til neste cache-flush)
UPDATE wallet_accounts
   SET deposit_balance = deposit_balance - 150
 WHERE id = '<account-id>';
```

### 5.4 Steg 4: Resolve alert

```bash
curl -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"resolutionNote": "Forensikk: cache-divergens etter manuell SQL-edit 2026-05-08T13:00 UTC. Korrigert med correction-rad <id>. Verifisert via reconcile-now."}' \
  https://api.spillorama.no/api/admin/wallet/reconciliation-alerts/<alert-id>/resolve
```

### 5.5 Steg 5: Verifiser med ny recon

```bash
# Trigger ad-hoc recon for å bekrefte at fikset stenger alarmen
curl -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://api.spillorama.no/api/admin/wallet/reconcile-now | jq .

# Forventet:
# { "ok": true, "data": { "accountsScanned": ..., "divergencesFound": 0, "alertsCreated": 0 } }
```

---

## 6. Mitigation — hvis job ikke har kjørt

### 6.1 Symptom

`MAX(detected_at)` i `wallet_reconciliation_alerts` > 26 timer siden,
eller compliance-eier ser ingen ny rad i `audit_log` for
`wallet.reconciliation.cron`.

### 6.2 Mitigation

1. **Sjekk om backend kjører:**
   ```bash
   curl -fsS https://api.spillorama.no/health | jq .
   ```

2. **Sjekk Render-logger** for siste cron-tick:
   ```
   render logs --service=spillorama-system --tail | grep "wallet-reconciliation"
   ```

3. **Trigger manuelt:**
   ```bash
   curl -X POST \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     https://api.spillorama.no/api/admin/wallet/reconcile-now
   ```

4. **Hvis manuell trigger feiler:** sjekk Sentry for exceptions, sjekk
   DB-pool for connection-issues.

5. **Skriv P2-incident** og spawn follow-up for rotårsak.

---

## 7. Stop the bleeding — store divergenser

Hvis et alert avdekker > 1000 NOK divergens, eller flere alerts på
samme dag:

1. **Pauser maintenance-mode** for berørte spillere (ikke alle haller — spesifikk konto):
   ```sql
   -- Sett spilleren i pause inntil utredning
   UPDATE app_users
      SET kyc_status = 'SUSPENDED',
          kyc_status_reason = 'Compliance review pågår — wallet recon mismatch'
    WHERE id = '<user-id>';
   ```

2. **Eskalér til Tobias + compliance-eier** umiddelbart.

3. **Eksporter forensikk-data** per [`COMPLIANCE_INCIDENT_PROCEDURE.md`](./COMPLIANCE_INCIDENT_PROCEDURE.md) §4.2.

4. **Lotteritilsynet-vurdering:** > 100 NOK avvik per spiller eller
   systematisk feil → meldepliktig.

---

## 8. Verifisering

### 8.1 Etter resolve

| Sjekk | Forventet |
|---|---|
| Ny recon-run viser 0 divergenser | `divergencesFound = 0` |
| Audit-log har resolve-event | `wallet.reconciliation.resolve` med korrekt `resolutionNote` |
| Wallet-balanse stemmer mot manuell beregning | SQL match |
| Hash-chain ikke brutt | `audit_log.chain_valid = true` på alle nye rader |
| Spilleren kan spille igjen (om suspended) | KYC-status normalisert |

### 8.2 Daglig kontroll (post-incident, 7 dager)

I 7 dager etter en mismatch-resolve:

- Sjekk hver morgen at det ikke kommer nye alerts på samme konto.
- Sjekk at recon-run kompletter uten exceptions.
- Verifiser at action items (kode-fix) er deployed.

---

## 9. Communication

### 9.1 Compliance-eier morning-stand-up

```
Daily wallet recon — yyyy-mm-dd

- Open alerts: 0 / X
- Job ran: ✅ (last: hh:mm utc)
- Divergence trend (7d): [stabil / eskalerende / nedadgående]
- Action: [ingen / undersøker alert <id>]
```

### 9.2 Slack-mal — divergens oppdaget

```
:warning: WALLET RECON | <alert-id> | <divergens-NOK> NOK | <hh:mm>

Konto: <account-id>
Spiller: <user-id> ([email])
Side: <deposit|winnings>
Expected: <X> NOK
Actual: <Y> NOK
Divergens: <Z> NOK
Severity: C-P[1|2|3]

Eier: @[compliance-eier]
Forventet løsning: [tid eller "etter forensikk"]

Live-tråd: :thread:
```

### 9.3 Spiller-melding (etter korrigering)

Hvis spillerens saldo ble korrigert:

```
Tittel: Saldo-korreksjon registrert

Hei [navn],

Spillorama har gjort en korreksjon på din spillesaldoen.

- Tidspunkt: [dato/tid]
- Endring: [+/- X NOK]
- Årsak: [kort, ikke-teknisk]

Korrigering er audit-loggført. Hvis du har spørsmål, kontakt oss på
support@spillorama.no.

Hilsen,
Spillorama Compliance
```

### 9.4 Lotteritilsynet (om meldepliktig)

Bruk [`COMPLIANCE_INCIDENT_PROCEDURE.md`](./COMPLIANCE_INCIDENT_PROCEDURE.md) §5.

---

## 10. Drill-anbefaling

### 10.1 Pre-pilot — obligatorisk

- D-RECON-1: Plant en manuell divergens i staging og verifiser at
  jobben fanger den. Verifiser at admin kan resolve.

### 10.2 Kvartalsvis

- D-RECON-2: Simuler PG-restore som mister 5 min wallet_entries.
  Verifiser at neste recon fanger.
- D-RECON-3: Forsøk å skape en "double credit" i staging og verifiser
  at idempotency-key-constraint stopper, ikke recon.

### 10.3 Halvårlig

- D-RECON-4: Test resolution med audit-log-validering. Verifiser at
  resolveAlert skriver audit-rad.

### 10.4 D-RECON-1 prosedyre (~30 min)

**Pre-state:**
- Staging-instans med 10 test-spillere som har transaksjoner siste 24t.

**Steg:**

1. **Pre-recon (verifiser baseline):**
   ```bash
   curl -X POST \
     -H "Authorization: Bearer $STAGING_ADMIN_TOKEN" \
     https://staging-api.spillorama.no/api/admin/wallet/reconcile-now
   # Forventet: divergencesFound = 0
   ```

2. **Plant divergens:**
   ```sql
   -- Velg en konto og avvik fra ledger
   UPDATE wallet_accounts
      SET deposit_balance = deposit_balance + 100
    WHERE id = (SELECT id FROM wallet_accounts ORDER BY id LIMIT 1);
   ```

3. **Trigger recon manuelt:**
   ```bash
   curl -X POST \
     -H "Authorization: Bearer $STAGING_ADMIN_TOKEN" \
     https://staging-api.spillorama.no/api/admin/wallet/reconcile-now
   # Forventet: divergencesFound = 1, alertsCreated = 1
   ```

4. **List åpne alerts:**
   ```bash
   curl -s \
     -H "Authorization: Bearer $STAGING_ADMIN_TOKEN" \
     https://staging-api.spillorama.no/api/admin/wallet/reconciliation-alerts | jq .
   ```

5. **Resolve:**
   - Korriger via SQL (revers det første UPDATE).
   - Trigger ny recon — forventet 0.
   - Resolve alert via API:
     ```bash
     curl -X POST \
       -H "Authorization: Bearer $STAGING_ADMIN_TOKEN" \
       -H "Content-Type: application/json" \
       -d '{"resolutionNote": "Drill D-RECON-1: plantet divergens, korrigert"}' \
       https://staging-api.spillorama.no/api/admin/wallet/reconciliation-alerts/<id>/resolve
     ```

6. **Verifiser audit:**
   ```sql
   SELECT * FROM audit_log
    WHERE action IN ('wallet.reconciliation.resolve', 'wallet.reconciliation.run_now')
    ORDER BY created_at DESC LIMIT 5;
   ```

7. **Logg drill** i `docs/operations/dr-drill-log/<yyyy-mm>-RECON-N.md`.

**Suksesskriterier:**
- ✅ Recon fanger plantet divergens
- ✅ Alert dukker opp i list-endpoint
- ✅ Resolve fungerer og audit-rad skrives
- ✅ Etter korrigering: ny recon viser 0

---

## 11. Pre-pilot-checks

- [ ] Job kjører i prod (`wallet.reconciliation.cron` siste 24t)
- [ ] Compliance-eier har morning-rutine i kalender
- [ ] Slack-alert (Sentry) konfigurert for `divergence detected`
- [ ] Grafana-dashboard for `wallet_reconciliation_*`-metrikker
- [ ] D-RECON-1 utført med pass-status
- [ ] Compliance-eier kjenner forensikk-prosedyren
- [ ] L2 backend on-call kjenner mitigation-stegene
- [ ] Resolution-note-policy avtalt (hva må skrives, hva ikke)

---

## 12. Anti-mønstre — ikke gjør

### 12.1 Aldri UPDATE eller DELETE wallet_entries

Audit-trail må være append-only. Korrigeringer skrives som nye rader.

### 12.2 Aldri resolve uten å forstå rotårsaken

"Det ser greit ut nå" er ikke nok. Skriv konkret hva forensikk avdekket
og hvilken korrigering som ble gjort.

### 12.3 Aldri kjøre recon mid-shift uten plan

Recon-jobben tar ~30-60 sek på 100k konti. Det er kort, men hvis du
trigger den manuelt under topptrafikk uten å si fra, kan andre ops-
folk lure på hva som skjer.

### 12.4 Aldri skip audit-log-verifisering

Etter en mismatch er audit-log gull verdt. Sjekk at den skrev både
`run_now` og `resolve`.

---

## 13. Eierskap

| Rolle | Ansvar |
|---|---|
| Compliance-eier | Daglig kontroll, klassifisering av alerts, Lotteritilsynet-vurdering |
| L2 backend on-call | Forensikk, korrigering-SQL, manuell trigger |
| Tobias | Endelig myndighet på korrigeringer > 100 NOK |
| DevOps | Sikrer cron-helse og alert-kanaler |

---

## 14. Referanser

- [`INCIDENT_RESPONSE_PLAN.md`](./INCIDENT_RESPONSE_PLAN.md) — overordnet
- [`COMPLIANCE_INCIDENT_PROCEDURE.md`](./COMPLIANCE_INCIDENT_PROCEDURE.md) — Lotteritilsynet
- [`DATABASE_RESTORE_PROCEDURE.md`](./DATABASE_RESTORE_PROCEDURE.md) — restore-trigger
- [`DISASTER_RECOVERY_PLAN_2026-04-25.md`](./DISASTER_RECOVERY_PLAN_2026-04-25.md) §8 — Swedbank reconcile
- `apps/backend/src/jobs/walletReconciliation.ts` — implementation
- `apps/backend/src/routes/adminWalletReconciliation.ts` — admin-endpoints
- `apps/backend/src/jobs/__tests__/walletReconciliation.integration.test.ts` — integration test
- BIN-763 — opprinnelig issue
- BIN-761→764 — casino-grade-wallet-prosjekt
