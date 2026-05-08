# Database Restore Procedure (BIN-790 C4)

**Owner:** Technical lead (Tobias Haugen)
**Related Linear:** BIN-790 (M2 — Multi-hall-launch, Spor C — Operasjon & infrastruktur)
**Last updated:** 2026-05-08
**Audience:** L2 backend on-call, L3 incident commander, Tobias.

> Denne runbooken beskriver Render-managed Postgres restore-flow,
> RPO/RTO-mål og drill-prosedyren. For:
>
> - **Migration-feil under deploy**: se [`MIGRATION_DEPLOY_RUNBOOK.md`](./MIGRATION_DEPLOY_RUNBOOK.md).
> - **Postgres failover (ikke restore)**: se [`LIVE_ROOM_DR_RUNBOOK.md`](./LIVE_ROOM_DR_RUNBOOK.md) §5.
> - **Compliance-implikasjoner av restore**: se [`COMPLIANCE_INCIDENT_PROCEDURE.md`](./COMPLIANCE_INCIDENT_PROCEDURE.md).
> - **Wallet-spesifikk recovery**: se [`WALLET_RECONCILIATION_RUNBOOK.md`](./WALLET_RECONCILIATION_RUNBOOK.md).

---

## 0. TL;DR

| Mål | Verdi | Begrunnelse |
|---|---|---|
| **RPO** (max datatap ved restore) | ≤ 5 min | Render WAL-arkivering kontinuerlig (krever `pro`-plan). |
| **RTO** (full restore-til-service) | ≤ 2 timer | Render PITR-spawn ~30–60 min + DB-cutover + smoke. |
| **Backup-retention** | 30 dager | Krever `pro`-plan. Default `starter` har bare 7 dager. |
| **Drill-frekvens** | Månedlig | Pre-pilot-krav: minst én vellykket drill før første hall flippes. |

---

## 1. Trigger — når kreves restore?

### 1.1 Restore-scenarier

- **Operatør-feil**: `DELETE` uten `WHERE`, feil migrasjon som droppet
  data, manuell SQL som korrupterte tabeller.
- **Migrasjons-katastrofe**: schema-endring som gjorde data inkonsistent
  med constraints (UNIQUE-brudd, FK-brudd).
- **Disk-full**: WAL-korrupt etter at primary nådde 100% disk og fikk
  uvanlige skrive-feil.
- **Sikkerhetshendelse**: ondsinnet SQL-injeksjon eller utnyttelse som
  modifiserte data.
- **Compliance-direktiv**: Lotteritilsynet ber om at vi gjenoppretter
  state til et bestemt tidspunkt for forensikk.

### 1.2 IKKE restore-scenarier

- **Postgres failover**: Render flipper primary automatisk; data er
  fortsatt der. Bruk [`LIVE_ROOM_DR_RUNBOOK.md`](./LIVE_ROOM_DR_RUNBOOK.md) §5.
- **App-bugs**: hvis feilen er i kode (ikke data), forward-fix.
- **Enkelt-rad-feil**: korriger med UPDATE, ikke restore.
- **Teste noe i lokal**: bruk staging eller engangs-snapshot, ikke prod-
  restore.

---

## 2. Detection — når oppdager vi at restore er nødvendig?

| Signal | Kilde | Når trigger |
|---|---|---|
| `pgmigrations`-tabell viser missing rader | Manuelt: `SELECT name FROM pgmigrations` | Migrasjons-historikk korrupt |
| Compliance-ledger har huller | `WalletReconciliationService` finner mismatch | Datatap > 5 min |
| Hash-chain-validering feiler | Audit-cron | Audit-trail tampered |
| Operatør rapporterer "jeg slettet noe ved feiltakelse" | L2/L3 muntlig | Manuelt rapportert |
| Postgres `EXPLAIN`-baseline avviker | Manuell sjekk etter mistenkelig hendelse | Indeks korrupt |
| Sentry: SQL-error-burst som "relation does not exist" | Sentry filter | Tabell tapt |

---

## 3. Severity og beslutningsprosess

| Symptom | Severity | Beslutning |
|---|---|---|
| Hele `compliance_ledger`-tabell tapt | P1 | Restore umiddelbart, krever Tobias-godkjenning |
| Operatør slettet < 100 rader fra én tabell | P1 (data > regulatorisk) eller P2 | Vurder manuelt rebuild fra audit-log først |
| Schema-feil (kolonne tapt, men data finnes) | P1 hvis kompleks | Forward-fix migration først, restore som siste utvei |
| Mistenkelig endring uten kjent årsak | P1 | Maintenance-mode + restore + forensikk |
| Test-data lekkede til prod | P2 | Ikke restore — manuell cleanup |

### 3.1 Beslutningsmatrise — restore vs. rebuild?

```
Datatap omfang?
   │
   ├─ < 10 rader → manuell rebuild fra audit-log
   │
   ├─ 10–1000 rader → vurder rebuild + verifiser
   │
   └─ > 1000 rader eller hele tabell → PITR-restore
```

### 3.2 Compliance-implikasjoner

> **Lotteritilsynet-melding:** Datatap > 5 min RPO er meldepliktig
> innen 24 timer. Bruk [`COMPLIANCE_INCIDENT_PROCEDURE.md`](./COMPLIANCE_INCIDENT_PROCEDURE.md)
> §5 template og §1.3 SLA.

Compliance-eier varsles **før** restore-prosessen starter, slik at de
kan begynne forensikk parallelt og ikke tape mer tid.

---

## 4. Mitigation — full PITR-restore

### 4.1 Pre-flight (5 min)

1. **L3 + Tobias godkjenner** beslutning om restore. Logg i Slack.
2. **Compliance-eier varsles** ved P1.
3. **Identifiser timestamp** for restore — typisk 5 min før hendelsen
   som krevde restore. Dokumenter med ISO-8601 UTC.
4. **Estimer datatap-vinduet:** alt mellom restore-timestamp og NOW() vil
   være tapt eller må gjenopprettes manuelt.
5. **Annonser blackout** — sett alle haller i maintenance:
   ```sql
   UPDATE app_halls SET is_active = false;
   ```
6. **Status-side:** publiser `critical` incident per
   [`STATUS_PAGE.md`](./STATUS_PAGE.md).

### 4.2 Render PITR-restore (30–60 min)

> **Forutsetning**: Render `pro`-plan med PITR aktivert. På `starter`-
> plan finnes kun nattlige snapshots, ikke kontinuerlig WAL.

Steg-for-steg:

1. **Logg inn** på https://dashboard.render.com/.
2. Velg Postgres-tjenesten (ikke web-service).
3. Gå til **Backups**-fanen.
4. Klikk **Point-in-Time Restore**.
5. Velg target-timestamp (typisk 5 min før hendelses-tidspunkt).
6. Velg navn for ny instans, eks. `spillorama-prod-restored-2026-05-08T14-00`.
7. Bekreft. Render spawner ny instans (typisk 30–60 min).
8. Vent på "Available"-status.

### 4.3 Verifisering av restored instans (15–30 min)

> **Ikke pek prod-app mot restored instans før verifisering er ferdig.**

```bash
# Tilkoblings-streng for restored instans (Render dashboard → Connect)
RESTORED_PG="postgresql://user:pass@restored-host:5432/spillorama"

# 1. Verifiser tabell-eksistens
psql "$RESTORED_PG" -c "\dt" | head -30

# 2. Verifiser kritisk data-volum
psql "$RESTORED_PG" -c "
  SELECT
    (SELECT COUNT(*) FROM app_users) AS users,
    (SELECT COUNT(*) FROM app_wallets) AS wallets,
    (SELECT COUNT(*) FROM compliance_ledger) AS ledger_rows,
    (SELECT MAX(created_at) FROM compliance_ledger) AS last_ledger;
"

# 3. Sammenlign med kjent siste-known-good-timestamp
# Eks. siste rapport-eksport viste 1234567 ledger-rader 2026-05-08T13:50:00 UTC

# 4. Wallet-balanse-konsistens
psql "$RESTORED_PG" -c "
  SELECT COUNT(*) FROM app_wallets WHERE balance < 0;
"
# Forventet: 0 (negativ saldo umulig per casino-grade-wallet)

# 5. Hash-chain-validering (om implementert)
psql "$RESTORED_PG" -c "
  SELECT COUNT(*) FROM audit_log WHERE chain_valid = false;
"
# Forventet: 0
```

### 4.4 Cutover (5–10 min)

1. **Oppdater `APP_PG_CONNECTION_STRING`** env-var i Render-dashboard:
   - Service: `spillorama-system`
   - Environment: bytt `APP_PG_CONNECTION_STRING` til restored-instans-streng.
2. **Restart backend** (Manual Deploy → Restart).
3. Vent på `/health` returnerer 200.
4. Verifiser via:
   ```bash
   curl -fsS https://api.spillorama.no/health | jq .
   curl -fsS https://api.spillorama.no/api/halls | jq .
   ```

### 4.5 Post-restore (30 min)

1. **Re-aktiver haller:**
   ```sql
   UPDATE app_halls SET is_active = true WHERE id IN (...);
   ```
2. **Status-side:** oppdater incident til `monitoring`.
3. **Hall-eier-melding** med faktum: "Restore fullført. Vi har gjenopprettet data fra [timestamp]. Eventuelle transaksjoner i vinduet [timestamp] – [hh:mm] vil bli flagget for manuell sjekk."
4. **Forensikk på datatap-vinduet:**
   - Eksporter Render-logger fra hendelse-tidspunktet til restore-cutover.
   - Identifiser pengeflyt: hvilke spillere fikk endring i saldo, hvilke runder ble fullført.
   - Sammenlign mot Swedbank for å finne tapte deposits.
   - Manuelle korrigeringer (UPDATE wallet, INSERT compliance-ledger med `correction`-type) — aldri DELETE.
5. **Behold restored-instans i 30 dager** før den slettes — for evt. ekstra forensikk.

---

## 5. Verifisering — etter cutover

| Sjekk | Kommando | Forventet |
|---|---|---|
| `/health` returnerer 200 | curl | OK |
| Antall scheduled games i `running` | SQL | 0 (alle skal være cancelled av recovery) |
| Wallet-recon-job grønn | Trigger via `/api/admin/wallet/reconciliation/run` | 0 nye divergenser |
| Compliance-ledger ingen duplikater | `idempotency_key` UNIQUE | 0 duplikater |
| Audit hash-chain valid | Audit-cron | `chain_valid = true` på alle |
| Spillerne kan logge inn | E2E smoke | Login-flyt grønn |
| Innskudd / uttak fungerer | E2E smoke | Wallet-flyt grønn |
| Hall-eier bekrefter normal drift | Manuelt | Telefon-callback |

---

## 6. Backup-strategi (preventive)

> **Status 2026-05-08:** Render `pro`-plan med 30-dagers retention er
> anbefalt før pilot-start. Tobias avgjør oppgradering per
> [`DISASTER_RECOVERY_PLAN_2026-04-25.md`](./DISASTER_RECOVERY_PLAN_2026-04-25.md) §11
> tiltak #1.

### 6.1 Auto-backup (Render-managed)

- **Snapshots:** nattlig automatisk (00:00 UTC).
- **WAL-arkivering:** kontinuerlig på `pro`-plan (ikke `starter`).
- **Retention:** 7 dager (`starter`) eller 30 dager (`pro`).
- **Lokasjon:** Render-internt, samme region som primary.

### 6.2 Off-region backup (anbefalt fremtid)

> Ikke implementert per 2026-05-08. Foreslått som follow-up i
> [`DISASTER_RECOVERY_PLAN_2026-04-25.md`](./DISASTER_RECOVERY_PLAN_2026-04-25.md) §11.13.

For ekstra robusthet: ukentlig pg_dump til off-region S3 (Cloudflare R2 / AWS Oslo). Beskytter mot full Render-region-tap.

### 6.3 Manuell snapshot før risiko-operasjon

Før manuelle DB-operasjoner (eks. data-rebuild, schema-fix):

```bash
# Render-dashboard: Postgres → Backups → "Create Backup Now"
# Eller via render API:
# (krever RENDER_API_KEY env)

# Etter operasjon: kontroller at backup er listet i UI før du forsetter
```

---

## 7. Communication

### 7.1 Under restore

```
:warning: P1 | DB-restore i gang | [hh:mm]

Trigger: [eks. "Operatør-feil — `DELETE` uten `WHERE`"]
Restore til timestamp: [iso-timestamp]
Estimert datatap-vindu: [X min]
Forventet RTO: 60–90 min
Eier: @[L3]
Compliance: @[compliance-eier] varslet

Live-tråd: :thread:
```

### 7.2 Hall-eier-melding (under restore)

```
Tittel: Spillorama: Vedlikehold pågår

Hei [hall-eier-navn],

Vi gjør et viktig vedlikehold på databasen og har midlertidig
satt alle haller i pause-modus.

Forventet løsning: [eks. "innen 90 min"]

Spillernes saldoer er trygge, og pågående brett vil bli telt med
når vi er tilbake.

Hva du som hall-eier bør gjøre:
- Sett opp informasjons-skilt i hallen med "Spillorama vedlikehold pågår, vi er tilbake i [time]"
- Vi sender oppdatering når systemet er tilbake.

Kontakt:
- Akut: [L1-on-call-telefon]

Hilsen,
Spillorama Operations
```

### 7.3 Lotteritilsynet — etter restore

Bruk [`COMPLIANCE_INCIDENT_PROCEDURE.md`](./COMPLIANCE_INCIDENT_PROCEDURE.md) §5
template. Inkluder:

- Restore-timestamp.
- Datatap-vindu (hvilke transaksjoner er involvert).
- Manuelle korrigeringer gjort.
- Audit-log for forensikk.

### 7.4 Status-side — under restore

```sql
INSERT INTO app_status_incidents (
  title, description, status, impact, affected_components, created_by_user_id
) VALUES (
  'Vedlikehold pågår',
  'Vi gjør et viktig databasevedlikehold. Spillet er midlertidig pauset. Spillernes saldoer er trygge.',
  'investigating',
  'critical',
  '["api","database","bingo","rocket","monsterbingo","wallet","auth"]'::jsonb,
  'admin-user-id-her'
);
```

Etter restore:
```sql
UPDATE app_status_incidents
SET status = 'resolved', resolved_at = now(),
    description = 'Restore fullført. Eventuelle transaksjoner i vedlikeholdsvinduet flagges for manuell sjekk.'
WHERE id = '<incident-id>';
```

---

## 8. Post-mortem

Alle DB-restores krever post-mortem per
[`INCIDENT_RESPONSE_PLAN.md`](./INCIDENT_RESPONSE_PLAN.md) §7.

Spesifikke spørsmål:

1. **Rotårsak**: hva forårsaket datatapet?
2. **Forhindre gjentak**: hvilken kontroll mangler? Eks.:
   - DB-tilgang for færre personer
   - Audit på alle write-queries
   - SQL review-prosess før operatør-handlinger
   - Migration-CI-gate som ville fanget dette
3. **RTO-realisme**: holdt vi 2-timers målet?
4. **Datatap-omfang**: hvor mange transaksjoner ble berørt?
5. **Compliance-impact**: kunne vi ha unngått Lotteritilsynet-melding?

---

## 9. Drill-anbefaling

### 9.1 Pre-pilot — obligatorisk

- D-DB-RESTORE-1: Full PITR-restore mot staging-instans, verifiser at backend booter mot ny instans, kjør smoke-suite. **Må gjøres minst én gang før pilot-start.**

### 9.2 Månedlig

- D-DB-RESTORE-2: Restore til staging fra siste prod-snapshot, verifiser data-integritet.

### 9.3 Kvartalsvis

- D-DB-RESTORE-3: Full øvelse med L3 + Tobias som beslutningstakere, simulert P1 (table-top + faktisk restore).

### 9.4 Drill-prosedyre (D-DB-RESTORE-1, ~3 timer)

**Pre-requisites:**
- Staging-instans tilgjengelig.
- Render-API-tilgang for å spawne PITR-restore.
- Test-spillere armed i staging (ikke prod).

**Steg:**

1. **Pre-state-snapshot:**
   ```sql
   -- I staging:
   SELECT
     (SELECT COUNT(*) FROM app_users) AS users,
     (SELECT COUNT(*) FROM app_wallets) AS wallets,
     (SELECT COUNT(*) FROM compliance_ledger) AS ledger;
   ```

2. **Note timestamp** før vi begynner restore (T0).

3. **Trigger PITR-restore** til staging fra prod-snapshot (mot
   en separate restored-instans, ikke override staging).

4. **Verifiser ny restored-instans:**
   - Tabell-count
   - Last ledger-id
   - Wallet-balanser sum

5. **Cutover staging-app til restored-instans** (oppdater
   `APP_PG_CONNECTION_STRING` i staging Render-service).

6. **Mål:**
   - Tid fra "klikk PITR" til restored "Available" status.
   - Tid fra cutover til `/health` 200.
   - Tid fra cutover til full smoke-suite grønn.

7. **Smoke-suite på restored:**
   - Login
   - Hent wallet
   - Kjøp bong
   - Start runde

8. **Logg drill** i `docs/operations/dr-drill-log/<yyyy-mm>-DB-RESTORE-N.md`.

**Suksesskriterier:**
- ✅ Restore fullført innen 90 min.
- ✅ Smoke-suite grønn etter cutover.
- ✅ Ingen wallet-divergens etter recon-job.
- ✅ Audit hash-chain valid.

**Hva som loggføres:**

```markdown
# Drill DB-RESTORE-N — yyyy-mm-dd

**Eier:** [navn]
**Miljø:** staging
**Pre-state:**
- Users: N
- Wallets: M
- Ledger rader: K
- Last ledger created_at: <timestamp>

**Tidslinje:**
- HH:MM:SS — PITR triggered
- HH:MM:SS — Restored instans "Available"
- HH:MM:SS — Cutover startet
- HH:MM:SS — /health 200 på ny instans
- HH:MM:SS — Smoke-suite grønn

**Total RTO:** X timer Y min

**Resultater:**
- Datatap: [Ja/Nei + detaljer]
- Tabell-count match: [Ja/Nei]
- Wallet-balanser konsistent: [Ja/Nei]

**Suksess?** ✅ / ⚠️ / ❌

**Findings:**
- [Eventuelle ting som ikke fungerte som beskrevet]

**Action items:**
- [ ] Oppdater runbook §X.Y
- [ ] Linear-issue [BIN-XXX] for fix
```

---

## 10. Pilot-gating

Før første hall flippes til prod:

- [ ] Render-plan oppgradert til `pro` (PITR + 30d retention)
- [ ] D-DB-RESTORE-1 utført med pass-status
- [ ] On-call-rotasjon er trent på prosedyren
- [ ] Compliance-eier signert på Lotteritilsynet-prosess
- [ ] Restore-timestamp-protokoll dokumentert (hvilken timezone vi bruker)

---

## 11. Eierskap

| Rolle | Ansvar |
|---|---|
| Tobias (technical lead) | Endelig myndighet på restore-trigger |
| L3 incident commander | Beslutter mellom rebuild og restore |
| L2 backend on-call | Utfører PITR-prosedyre |
| Compliance-eier | Eier Lotteritilsynet-rapport (hvis datatap) |
| DevOps | Sikrer Render-plan har PITR aktivert |

---

## 12. Referanser

- [`INCIDENT_RESPONSE_PLAN.md`](./INCIDENT_RESPONSE_PLAN.md) — overordnet incident-flow
- [`MIGRATION_DEPLOY_RUNBOOK.md`](./MIGRATION_DEPLOY_RUNBOOK.md) — migrate-feilhåndtering
- [`COMPLIANCE_INCIDENT_PROCEDURE.md`](./COMPLIANCE_INCIDENT_PROCEDURE.md) — Lotteritilsynet
- [`WALLET_RECONCILIATION_RUNBOOK.md`](./WALLET_RECONCILIATION_RUNBOOK.md) — wallet recovery
- [`LIVE_ROOM_DR_RUNBOOK.md`](./LIVE_ROOM_DR_RUNBOOK.md) §5 — Postgres failover (ikke restore)
- [`DISASTER_RECOVERY_PLAN_2026-04-25.md`](./DISASTER_RECOVERY_PLAN_2026-04-25.md) §4 — overordnet DB-DR
- [`STATUS_PAGE.md`](./STATUS_PAGE.md) — status-incident publish
- Render PITR-docs: https://render.com/docs/databases#point-in-time-recovery
