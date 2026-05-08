# Drill: Backup-Restore (D-DB-RESTORE-1) — Pilot 2026-Q3

**Eier:** Tobias Haugen (technical lead)
**Eksekverende:** L2 backend on-call + L3 incident commander
**Linear:** [BIN-790](https://linear.app/bingosystem/issue/BIN-790) (M2 Spor C — Operasjon & infrastruktur), [BIN-816](https://linear.app/bingosystem/issue/BIN-816) (R12 — DR-runbook)
**Sist oppdatert:** 2026-05-08
**Frekvens:** Kvartalsvis. **Obligatorisk én gang før første pilot-hall flippes.**

> Dette dokumentet er **drill-prosedyren** — en treningsøvelse som verifiserer at vi
> faktisk kan restore-en database hvis prod krasjer eller en operatør sletter
> noe ved feiltakelse. Det er IKKE en prod-incident-runbook.
>
> - **Prod-restore (faktisk hendelse):** se [`DATABASE_RESTORE_PROCEDURE.md`](./DATABASE_RESTORE_PROCEDURE.md).
> - **Migration-feil under deploy:** se [`MIGRATION_DEPLOY_RUNBOOK.md`](./MIGRATION_DEPLOY_RUNBOOK.md).
> - **Disaster-overordnet plan:** se [`DISASTER_RECOVERY_PLAN_2026-04-25.md`](./DISASTER_RECOVERY_PLAN_2026-04-25.md).

---

## 0. Hvorfor denne drillen

Per R-mandatet ([`LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md`](../architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md) §3.3) skal Spillorama ha **Evolution-Gaming-grade recovery**. Vi har dokumentert restore-prosedyren, men har **aldri** kjørt en faktisk restore mot et virkelig backup-image. Hvis prod-DB krasjer pilot-dag og prosedyren har en stille feil, taper vi spillerdata + kunde-tillit.

Drill-formålet:

1. **Verifiser at backup faktisk eksisterer** og ikke har en stille korruption.
2. **Verifiser at restore-prosedyren fungerer** ende-til-ende uten å lese runbooken med skjelvende hender midt i en P1.
3. **Mål faktisk RTO** mot målet (≤ 2 timer).
4. **Bevis at backend booter mot ny instans** og smoke-test-en passerer.
5. **Tren operatør-rotasjonen** så minst to mennesker har kjørt prosedyren før første pilot-hall.

> 🚨 **Funn (2026-05-08):** Render-plan er per i dag `starter` (se `render.yaml:6`). På `starter`-plan finnes KUN nattlige snapshots med 7-dagers retention — ingen kontinuerlig WAL-arkivering, ingen Point-in-Time-Recovery. Drill-en under forutsetter `pro`-plan med PITR. Pre-pilot må Tobias bestemme om vi oppgraderer til `pro` (≈ +50 USD/mnd) eller aksepterer 24t RPO + manuell pg_dump-strategi. Se §11 nedenfor.

---

## 1. Backup-strategi (hva vi har)

### 1.1 Render-managed automatic backups

| Egenskap | `starter`-plan (nå) | `pro`-plan (anbefalt pre-pilot) |
|---|---|---|
| Snapshot-frekvens | Nattlig (00:00 UTC) | Nattlig + kontinuerlig WAL |
| Retention | 7 dager | 30 dager |
| Point-in-Time-Recovery (PITR) | ❌ Nei | ✅ Ja, til vilkårlig timestamp innen retention |
| RPO (max datatap) | Opptil 24 timer | ≤ 5 minutter |
| Spawn-tid for restored instans | 30–60 min | 30–60 min |
| Kostnad | Inkludert | +~50 USD/mnd |

**Hvor backup ligger:** Render-internt object storage, samme region som primary (Frankfurt). Vi har **ikke** off-region backup per 2026-05-08 — det er en åpen risiko ([`DISASTER_RECOVERY_PLAN_2026-04-25.md`](./DISASTER_RECOVERY_PLAN_2026-04-25.md) §11.13).

**Hvordan se backup-listen:**

1. Logg inn på [Render dashboard](https://dashboard.render.com/).
2. Velg Postgres-tjenesten (ikke web-service `spillorama-system`).
3. Klikk **Backups**-fanen.
4. Listen viser: tidspunkt, størrelse, status (Complete / Failed), retention-utløp.

`[Skjermbilde: Render Postgres → Backups-fanen med snapshot-listen]`

### 1.2 Manuell `pg_dump` (anbefalt før risiko-operasjoner)

Før manuell SQL eller risikabel migrasjon: ta en ekstra snapshot.

**Render-dashboard-veien:**

1. Postgres-tjenesten → **Backups** → klikk **Create Backup Now**.
2. Vent til ny rad dukker opp i lista med status `Complete` (typisk 2–10 min).
3. Noter timestamp for backupen — du trenger den hvis du må restore senere.

`[Skjermbilde: "Create Backup Now"-knappen i Render Postgres Backups]`

**CLI-veien (alternativ):**

```bash
# Hent connection-string fra Render-dashboard → Postgres → Connect → "External Database URL"
PROD_PG="postgres://user:pass@dpg-xxx-frankfurt.render.com:5432/spillorama"

# Dump til lokal fil. Bruk --no-owner og --no-acl for å gjøre dump-en portabel.
pg_dump --no-owner --no-acl --format=custom \
  --file="spillorama-prod-$(date +%Y%m%d-%H%M%S).dump" \
  "$PROD_PG"

# Verifiser at dump-en kan listes:
pg_restore --list "spillorama-prod-YYYYMMDD-HHMMSS.dump" | head -20
# Forventet: liste over tabeller, indekser, constraints. Ingen feilmeldinger.
```

> ⚠️ **Sikkerhet:** dump-filen inneholder hele DB-en inkl. KYC-data og wallet-balanser. Lagre kun på **kryptert volum** (FileVault på Mac, LUKS på Linux). Slett innen 7 dager. Aldri commit til git eller upload til delt drive.

### 1.3 Off-region backup (TODO før pilot)

Ikke implementert. Anbefaling: ukentlig pg_dump til off-region S3 (Cloudflare R2 / AWS Oslo). Beskytter mot full Render-region-tap. Se [`DISASTER_RECOVERY_PLAN_2026-04-25.md`](./DISASTER_RECOVERY_PLAN_2026-04-25.md) §11.13.

---

## 2. RTO / RPO-mål for drill-en

| Mål | Verdi | Hvordan vi måler |
|---|---|---|
| **RPO** (max datatap) | ≤ 5 min på `pro`-plan, ≤ 24t på `starter` | Drillen verifiserer ved å skrive en kanari-rad og bekrefte at restoren ekskluderer den |
| **RTO total** (klikk PITR → backend live) | ≤ 2 timer | Stoppeklokke fra steg 4.2 til steg 4.5 grønn |
| **RTO Render-spawn** | 30–60 min | Mål alene som delskritt |
| **RTO smoke-test** | ≤ 15 min | Etter cutover til ny instans |

**Suksesskriterium for D-DB-RESTORE-1:** alle fire mål oppnådd, og verifikasjons-sjekklisten i §6 er 100% grønn.

---

## 3. Forutsetninger og forberedelser

### 3.1 Hvem kan kjøre drill-en

- **Eier:** Tobias (signerer off på resultat).
- **Eksekverende:** L2 backend on-call (kjører selve prosedyren).
- **Observatør:** L3 incident commander eller annen utvikler (verifiserer at runbooken faktisk er fulgt).

**Aldri solo.** Minst to personer skal være med — én utfører, én verifiserer + tar tiden.

### 3.2 Miljø — bruk staging, IKKE prod

> 🚨 **Viktig:** denne drill-en kjøres **mot staging-databasen** eller en isolert restored-instans. Vi rør **ALDRI** prod-tjenesten under drill-en. Når vi tester PITR på "prod-snapshot", spawner vi en ny instans fra snapshoten — vi cutter aldri prod-trafikk over til den.

| Miljø | Bruk |
|---|---|
| `spillorama-system` (prod web-service) | **Aldri** under drill |
| `spillorama-prod` (prod Postgres) | Vi tar snapshot av den, men aldri overskriver |
| `spillorama-staging` (staging web-service) | Mål for cutover |
| `spillorama-staging-pg` (staging Postgres) | Erstattes av restored-instans midlertidig |
| `spillorama-prod-restored-<timestamp>` | Ny PITR-instans, slettes etter drill |

### 3.3 Pre-flight-sjekkliste

Før drillen starter, verifiser:

- [ ] Tobias har signert off på drill-tidspunktet (utenom åpningstid hvis pilot er live).
- [ ] L2 + L3 har lest [`DATABASE_RESTORE_PROCEDURE.md`](./DATABASE_RESTORE_PROCEDURE.md) og denne drill-doc-en.
- [ ] Render-API-tilgang verifisert (`render whoami` eller dashboard-login).
- [ ] Slack-kanal `#ops-drill` opprettet eller eksisterende — drill-en logges live.
- [ ] Stoppeklokke / timer klar (telefon eller [stopwatch.timer.tools](https://stopwatch.timer.tools)).
- [ ] `psql`-klient installert lokalt (`brew install postgresql` eller `apt install postgresql-client`).
- [ ] Drill-log-template (§7) åpnet for fortløpende notater.
- [ ] **Backup tatt før drill:** Manuell snapshot av staging-DB i Render-dashboard, så vi kan rulle staging tilbake hvis drill skader noe.

---

## 4. Drill-prosedyre (D-DB-RESTORE-1) — steg-for-steg

**Forventet varighet:** 2–3 timer total.

### 4.1 Etabler "pre-state-snapshot" (T-15min, ≈ 5 min)

Mål: ha kjent god tilstand av staging-DB-en så vi kan bekrefte at restoren faktisk leverer den tilstanden.

```bash
# Connection-string for staging-DB (hent fra Render-dashboard)
STAGING_PG="postgres://user:pass@staging-host:5432/spillorama_staging"

# Tabell-counts før noe gjøres:
psql "$STAGING_PG" <<'SQL'
SELECT
  'pre-state' AS marker,
  NOW() AS recorded_at,
  (SELECT COUNT(*) FROM app_users) AS users,
  (SELECT COUNT(*) FROM app_wallets) AS wallets,
  (SELECT COUNT(*) FROM app_compliance_audit_log) AS ledger,
  (SELECT COALESCE(MAX(created_at)::text, 'empty') FROM app_compliance_audit_log) AS last_ledger,
  (SELECT name FROM pgmigrations ORDER BY run_on DESC LIMIT 1) AS last_migration;
SQL
```

**Notér i drill-loggen:**
- Pre-state timestamp T0 (f.eks. `2026-08-15T10:00:00Z`).
- Tabell-counts.
- Siste migration som er applied.

`[Skjermbilde: psql-utskrift av pre-state-counts]`

### 4.2 Skriv en "kanari-rad" (T-5min, ≈ 2 min)

Mål: bevise at PITR faktisk ruller frem til ønsket timestamp og IKKE inkluderer hendelser etter timestampet.

```bash
# Vent 5 min, deretter skriv kanari-raden:
psql "$STAGING_PG" <<'SQL'
INSERT INTO app_audit_log (
  id, actor_type, action, resource, resource_id, details, created_at
) VALUES (
  gen_random_uuid()::text,
  'SYSTEM',
  'drill.canary',
  'drill',
  'D-DB-RESTORE-1',
  jsonb_build_object(
    'drill_id', 'D-DB-RESTORE-1',
    'inserted_at', NOW()::text,
    'note', 'This row should NOT exist in restored instance'
  ),
  NOW()
);
SELECT id, created_at FROM app_audit_log
WHERE action = 'drill.canary'
ORDER BY created_at DESC LIMIT 1;
SQL
```

**Notér:**
- Kanari-rad ID (UUID).
- Kanari `created_at` timestamp T_canary.

> 🎯 **Restore-mål-timestamp:** T_target = T_canary − 60 sek. Restoren skal stoppe FØR kanari-raden ble skrevet.

### 4.3 Trigger PITR til T_target (≈ 30–60 min)

```
Render-dashboard → Postgres-tjeneste (spillorama-staging-pg) → Backups → Point-in-Time Restore
```

`[Skjermbilde: Point-in-Time Restore-knappen og timestamp-pickeren]`

1. Velg **Point-in-Time Restore**.
2. I timestamp-pickeren: sett T_target (5 min før kanari).
3. Velg navn for ny instans: `spillorama-staging-restored-<YYYY-MM-DDTHH-MM>`.
4. Klikk **Restore**.
5. **Start stoppeklokken** — dette er T_restore_start.
6. Vent på status `Available`. Render rapporterer typisk 30–60 min.

`[Skjermbilde: Render restored-instans med "Creating..." → "Available"-status]`

**Mens vi venter:** ikke gjør andre operasjoner mot staging-DB. Hold drill-loggen oppdatert hvert 15. minutt.

### 4.4 Verifiser restored-instansen FØR cutover (≈ 15 min)

> ⚠️ Cutover staging-app FØRST etter at verifisering er grønn. Hvis restored-instansen er korrupt og vi cutter staging over, mister vi staging også.

Få connection-string for restored-instans fra Render-dashboard (under "Connect" på den nye instansen):

```bash
RESTORED_PG="postgres://user:pass@restored-host:5432/spillorama_staging"

# 4.4.1 — Tabell-eksistens (forventet: alle kjente tabeller finnes)
psql "$RESTORED_PG" -c "\dt" | wc -l
# Forventet: ≥ 90 (vi har ~91 tabeller per 2026-05-08)

# 4.4.2 — Counts skal være konsistente med pre-state (eller litt lavere, for skritt mellom T0 og T_target)
psql "$RESTORED_PG" <<'SQL'
SELECT
  'restored' AS marker,
  (SELECT COUNT(*) FROM app_users) AS users,
  (SELECT COUNT(*) FROM app_wallets) AS wallets,
  (SELECT COUNT(*) FROM app_compliance_audit_log) AS ledger,
  (SELECT COALESCE(MAX(created_at)::text, 'empty') FROM app_compliance_audit_log) AS last_ledger,
  (SELECT name FROM pgmigrations ORDER BY run_on DESC LIMIT 1) AS last_migration;
SQL

# 4.4.3 — Kanari-rad skal IKKE finnes (det er hele poenget)
psql "$RESTORED_PG" <<'SQL'
SELECT COUNT(*) AS canary_count FROM app_audit_log
WHERE action = 'drill.canary' AND resource_id = 'D-DB-RESTORE-1';
SQL
# Forventet: 0

# 4.4.4 — Wallet-konsistens (ingen negativ saldo)
psql "$RESTORED_PG" <<'SQL'
SELECT COUNT(*) AS negative_wallets FROM app_wallets WHERE balance < 0;
SQL
# Forventet: 0

# 4.4.5 — Hash-chain-validering (audit-trail intakt)
psql "$RESTORED_PG" <<'SQL'
SELECT COUNT(*) AS broken_chain FROM app_compliance_audit_log
WHERE prev_hash IS NULL AND id != (
  SELECT id FROM app_compliance_audit_log ORDER BY created_at ASC LIMIT 1
);
SQL
# Forventet: 0 (kun den aller første raden kan ha NULL prev_hash)

# 4.4.6 — pgmigrations-tabell konsistent
psql "$RESTORED_PG" <<'SQL'
SELECT name, run_on FROM pgmigrations
ORDER BY run_on DESC LIMIT 5;
SQL
# Forventet: samme top-5 som pre-state, ingen "missing" rader
```

**Sjekkliste i drill-loggen:**

- [ ] Tabell-count match (~91 tabeller).
- [ ] Counts ligger innenfor forventet vindu (post-T_target er kanskje færre rader).
- [ ] **Kanari-rad finnes IKKE** (kjernebevis på at PITR fungerte).
- [ ] Ingen negativ wallet-saldo.
- [ ] Hash-chain intakt.
- [ ] pgmigrations-tabell topp-5 match med pre-state.

`[Skjermbilde: psql-utskrift av §4.4-spørringene]`

### 4.5 Cutover staging til restored-instans (≈ 5–10 min)

Mål: backend booter mot ny DB, smoke-suite passer.

1. **Render-dashboard → `spillorama-staging` (web-service) → Environment**.
2. Endre `APP_PG_CONNECTION_STRING` til restored-instansens connection-string.
3. Lagre. Render trigger automatisk re-deploy ELLER bruk **Manual Deploy → Restart** for raskere cutover.
4. **Stopp stoppeklokken når `/health` returnerer 200.** Dette er T_health_ok.

`[Skjermbilde: Environment-fanen med APP_PG_CONNECTION_STRING-feltet]`

```bash
# Verifiser /health
curl -fsS https://staging.spillorama.no/health | jq .
# Forventet: {"ok": true, "status": "healthy", ...}

# Verifiser at backend snakker mot riktig DB
curl -fsS https://staging.spillorama.no/api/version | jq .
# Forventet: commit-SHA matches main
```

### 4.6 Smoke-test mot restored-instans (≈ 15 min)

Bruk eksisterende E2E-smoke-prosedyre fra [`E2E_SMOKE_TEST.md`](./E2E_SMOKE_TEST.md):

| Test | Forventet |
|---|---|
| Login med kjent test-bruker | 200 + JWT-token |
| `GET /api/wallet/me` | Saldo matcher pre-state-verdien |
| `GET /api/halls` | 4 demo-haller listes (Teknobingo Årnes + 3 deltakere) |
| `GET /api/games` | Alle aktive spill listes |
| `POST /api/payments/swedbank/topup-intent` (sandbox) | Ny PENDING-rad opprettet |
| Kjøp digital bong via test-spiller | Ny rad i `app_tickets` |
| Wallet-recon-job kjøres manuelt: `POST /api/admin/wallet/reconciliation/run` | 0 nye divergens-alerts |
| Audit hash-chain-validering kjøres manuelt | `chain_valid=true` på alle rader |

`[Skjermbilde: smoke-test-resultater (curl-utskrift eller dashboard)]`

### 4.7 Roll staging tilbake til original DB (≈ 5–10 min)

Etter at vi har bevist at restoren fungerte: rull staging tilbake så vi ikke etterlater drill-data i staging-flowen.

1. Render-dashboard → `spillorama-staging` → Environment.
2. Endre `APP_PG_CONNECTION_STRING` tilbake til original staging-DB.
3. Restart backend.
4. Verifiser `/health` 200 + at staging-data er tilbake.

### 4.8 Slett restored-instans (≈ 5 min)

Restored-instansen er en kostnad. Slett den etter at drill-rapporten er signert.

> ⚠️ **VENTE 30 dager** hvis det er en faktisk prod-restore, ikke en drill. For drill: kan slettes umiddelbart etter at drill-rapport er ferdig.

1. Render-dashboard → `spillorama-prod-restored-<timestamp>` → **Settings → Delete**.
2. Bekreft.

---

## 5. Måling og logging

### 5.1 Tidsmål

Alle målt fra stoppeklokke startet i §4.3:

| Delskritt | Mål | Faktisk |
|---|---|---|
| T_restore_start → "Available" | ≤ 60 min | ⏱️ \_\_\_ |
| Verifisering (§4.4) | ≤ 15 min | ⏱️ \_\_\_ |
| Cutover + /health 200 | ≤ 10 min | ⏱️ \_\_\_ |
| Smoke-suite grønn | ≤ 15 min | ⏱️ \_\_\_ |
| **Total RTO** | **≤ 2 timer** | ⏱️ \_\_\_ |

### 5.2 Drill-logg

Lagres som markdown-fil under `docs/operations/dr-drill-log/<YYYY-MM>-D-DB-RESTORE-1.md`. Bruk template i §7.

> 📁 **Mappe ikke opprettet enda.** Når første drill kjøres, opprett mappen `docs/operations/dr-drill-log/` og legg loggen der.

---

## 6. Verifikasjons-sjekkliste — er restoren faktisk vellykket?

Drill regnes som vellykket når **alle** punkter er krysset:

### 6.1 Data-integritet

- [ ] `SELECT COUNT(*) FROM app_users` på restored matcher pre-state (innenfor forventet vindu mellom T0 og T_target).
- [ ] `SELECT COUNT(*) FROM app_wallets` matcher pre-state.
- [ ] `SELECT COUNT(*) FROM app_compliance_audit_log` matcher pre-state.
- [ ] **Kanari-raden finnes IKKE** i restored — `SELECT COUNT(*) FROM app_audit_log WHERE action='drill.canary' AND resource_id='D-DB-RESTORE-1'` returnerer **0**.
- [ ] Ingen negativ wallet-saldo (`SELECT COUNT(*) FROM app_wallets WHERE balance < 0` = 0).
- [ ] Hash-chain intakt (kun den eldste raden har NULL prev_hash).
- [ ] `pgmigrations`-tabell topp-5 matcher pre-state.

### 6.2 Funksjonell verifikasjon

- [ ] Backend `/health` returnerer 200 mot restored-instansen.
- [ ] Login-flyt fungerer (test-bruker får JWT-token).
- [ ] `GET /api/wallet/me` returnerer korrekt saldo.
- [ ] `GET /api/halls` returnerer 4 demo-haller.
- [ ] Wallet-reconciliation: 0 nye divergenser etter `POST /api/admin/wallet/reconciliation/run`.
- [ ] Audit-chain-verifier: `chain_valid=true` på alle rader.

### 6.3 RTO-mål

- [ ] Total tid fra "klikk PITR" til smoke-suite grønn ≤ 2 timer.
- [ ] Render-spawn ≤ 60 min.
- [ ] Cutover ≤ 10 min.

### 6.4 Operasjonell verifikasjon

- [ ] To personer var til stede under hele drill-en (utfører + observatør).
- [ ] Drill-loggen er fylt ut og lagret under `docs/operations/dr-drill-log/`.
- [ ] Eventuelle avvik fra runbooken er notert med rotårsak og forslag til oppdatering.
- [ ] Tobias har signert off på resultatet.

**Hvis ÉT punkt feiler:** drill regnes som ikke-passert. Ikke godkjenn pilot-go-live før alle punkter er grønne.

---

## 7. Drill-logg-template

Kopier til `docs/operations/dr-drill-log/<YYYY-MM>-D-DB-RESTORE-1.md`:

```markdown
# Drill D-DB-RESTORE-1 — YYYY-MM-DD

**Drill-eier:** [navn]
**Utfører:** [navn]
**Observatør:** [navn]
**Miljø:** staging
**Render-plan:** starter / pro
**Start-tidspunkt:** YYYY-MM-DDTHH:MM:SS+02:00 (Oslo-tz)

## Pre-state (§4.1)

- T0: YYYY-MM-DDTHH:MM:SS UTC
- Users: \_\_\_
- Wallets: \_\_\_
- Compliance-ledger rader: \_\_\_
- Last ledger created_at: \_\_\_
- Last migration: \_\_\_

## Kanari-rad (§4.2)

- T_canary: YYYY-MM-DDTHH:MM:SS UTC
- Kanari ID (UUID): \_\_\_
- T_target (restore-mål): T_canary − 60 sek = \_\_\_

## Tidslinje

| Tidspunkt (UTC) | Hendelse |
|---|---|
| HH:MM:SS | Drill startet |
| HH:MM:SS | PITR triggered |
| HH:MM:SS | Restored-instans status `Available` |
| HH:MM:SS | Verifisering (§4.4) startet |
| HH:MM:SS | Verifisering grønn |
| HH:MM:SS | Cutover startet |
| HH:MM:SS | `/health` 200 på restored |
| HH:MM:SS | Smoke-suite startet |
| HH:MM:SS | Smoke-suite grønn |
| HH:MM:SS | Staging rullet tilbake til original DB |
| HH:MM:SS | Restored-instans slettet |
| HH:MM:SS | Drill avsluttet |

## RTO-resultater

| Delskritt | Mål | Faktisk |
|---|---|---|
| Render-spawn | ≤ 60 min | \_\_\_ min |
| Verifisering | ≤ 15 min | \_\_\_ min |
| Cutover | ≤ 10 min | \_\_\_ min |
| Smoke-suite | ≤ 15 min | \_\_\_ min |
| **Total RTO** | **≤ 2 timer** | \_\_\_ min |

## Verifikasjons-sjekkliste (§6)

- [ ] 6.1 Data-integritet (alle 7 punkter)
- [ ] 6.2 Funksjonell verifikasjon (alle 6 punkter)
- [ ] 6.3 RTO-mål (alle 3 punkter)
- [ ] 6.4 Operasjonell verifikasjon (alle 4 punkter)

## Drill-resultat

[ ] ✅ PASS — alle sjekkpunkter grønne, drill godkjent
[ ] ⚠️ PASS WITH CAVEATS — drill fullført, men avvik fra runbook (se findings)
[ ] ❌ FAIL — drill ikke godkjent, se findings

## Findings

(Beskriv eventuelle ting som ikke fungerte som beskrevet i runbooken,
overraskende oppførsel, ting som tok lengre tid enn forventet.)

- [Finding 1]
- [Finding 2]

## Action items

- [ ] Oppdater [`DRILL_BACKUP_RESTORE_2026-Q3.md`](../DRILL_BACKUP_RESTORE_2026-Q3.md) §X.Y: ...
- [ ] Linear-issue [BIN-XXX] for fix: ...

## Signatur

- Utfører: [navn] — YYYY-MM-DDTHH:MM
- Observatør: [navn] — YYYY-MM-DDTHH:MM
- Tobias: [navn] — YYYY-MM-DDTHH:MM
```

---

## 8. Eskalerings-tre

Hvis drill-en avdekker problemer:

```
Drill-funn?
   │
   ├─ Liten avvik (eks. RTO 5 min over mål) → Logg i drill-rapport, juster forventning
   │
   ├─ Funksjonelt brudd (eks. backend booter ikke mot restored) → Linear P2-issue
   │                                                              + utsette pilot-go-live
   │                                                              med 1–2 uker
   │
   ├─ Restore-prosedyren fungerer ikke i det hele tatt → P1, varsle Tobias umiddelbart
   │                                                     + stop pilot-planlegging
   │
   └─ Backup eksisterer ikke / korrupt → 🚨 P1 Lotteritilsynet-melding INNEN 24t
                                          + hands-on Tobias + revurdere DR-strategi
```

**Når går vi fra "drill" til "stopp pilot"?**

- Hvis drill ikke kan kjøres ferdig (eks. Render PITR-knappen er ikke tilgjengelig på vår plan): pilot-gating brutt.
- Hvis backup-rapport viser stille korruption (snapshots tas ikke faktisk hver natt): pilot-gating brutt.
- Hvis RTO > 4 timer (2× målet): pilot-gating brutt — vi kan ikke tåle 4 timers nedetid pilot-dag.

I alle disse tilfellene: **stopp pilot-arbeidet** og varsle Tobias innen 1 time. Restorer en grunnsten i compliance og kunde-tillit; det går foran feature-utvikling.

---

## 9. Hva drill-en IKKE tester

Disse scenariene krever egne drills, ikke dekket av D-DB-RESTORE-1:

| Scenario | Egen drill |
|---|---|
| Render hele Frankfurt-region nede | D-REGION-1 (TODO, [`DISASTER_RECOVERY_PLAN_2026-04-25.md`](./DISASTER_RECOVERY_PLAN_2026-04-25.md) §11.13) |
| Redis dør (rom-state) | D-REDIS-1 (TODO, [`REDIS_FAILOVER_PROCEDURE.md`](./REDIS_FAILOVER_PROCEDURE.md)) |
| Postgres-primary failover (ikke restore) | Del av [`LIVE_ROOM_DR_RUNBOOK.md`](./LIVE_ROOM_DR_RUNBOOK.md) §5 |
| Kombinasjon: restore + samtidig deploy-incident | Halvårlig table-top |
| Backup-fil korrupt | Drill kan kun delvis fange dette — krever pg_dump + restore på lokal staging |

---

## 10. Frekvens og pilot-gating

| Når | Hva |
|---|---|
| **Pre-pilot (obligatorisk)** | D-DB-RESTORE-1 minst én gang. Pilot-gating brutt hvis drill ikke er passert. |
| **Kvartalsvis** | D-DB-RESTORE-1 igjen. Roterer mellom L2-personer for opplæring. |
| **Halvårlig** | Full table-top med L3 + Tobias som beslutningstakere. Simulert P1 + faktisk drill. |
| **Etter major schema-endringer** | Ad-hoc kjør drillen for å verifisere at PITR fortsatt fungerer mot ny schema. |
| **Ved endring av Render-plan** | Re-kjør drillen — backup-strategien kan ha endret seg (eks. PITR aktivert eller deaktivert). |

### 10.1 Pilot-gating-sjekkliste (R12)

Før første hall flippes til prod:

- [ ] Render-plan oppgradert til `pro` (PITR + 30d retention) — **eller** Tobias har eksplisitt akseptert 24t RPO med dokumentasjon.
- [ ] D-DB-RESTORE-1 utført med PASS-status, signert av Tobias.
- [ ] Drill-loggen lagret under `docs/operations/dr-drill-log/`.
- [ ] On-call-rotasjon trent på prosedyren (minst 2 personer har kjørt den).
- [ ] Compliance-eier signert på Lotteritilsynet-prosess (24t-meldepliktig hvis datatap > 5 min RPO).
- [ ] Restore-timestamp-protokoll dokumentert (alltid Oslo-tz eller UTC — bestemt av Tobias).

---

## 11. 🚨 Funn som må adresseres før pilot

Identifisert under skriving av drillen 2026-05-08. Disse punktene blokkerer pilot-go-live hvis ikke adressert.

### 11.1 Render-plan er `starter` — PITR ikke tilgjengelig

**Status:** `render.yaml:6` viser `plan: starter`.

**Konsekvens:**
- Ingen kontinuerlig WAL-arkivering.
- Ingen Point-in-Time-Recovery — kun nattlige snapshots.
- RPO er opptil 24 timer (mellom snapshots), ikke 5 min.
- Worst-case-scenario: pilot-dag krasjer DB klokken 23:00, vi mister hele dagens transaksjoner inkludert wallet-tap og payouts. Dette er **direkte regulatorisk meldepliktig** til Lotteritilsynet.

**Beslutning trengs fra Tobias:**

- **Alternativ A (anbefalt):** oppgrader til `pro`-plan før pilot. Ekstra-kost ≈ 50 USD/mnd. Gir PITR + 30 dagers retention. Drill kjøres mot `pro`.
- **Alternativ B:** behold `starter`, men implementer manuell pg_dump-strategi (cron som tar dump hver 4. time til off-region S3). Krever utvikling, og RPO blir 4 timer best case.
- **Alternativ C:** behold `starter`, dokumenter 24t RPO som akseptert risiko. **Ikke anbefalt** — første pilot-dag-incident vil bli en PR-katastrofe.

**Linear:** [BIN-816](https://linear.app/bingosystem/issue/BIN-816) (R12) — denne punktet skal stå som blocker.

### 11.2 Drill-mappen `docs/operations/dr-drill-log/` finnes ikke

**Status:** mappen er referert i [`DATABASE_RESTORE_PROCEDURE.md`](./DATABASE_RESTORE_PROCEDURE.md) §4.7 men er ikke opprettet.

**Action:** opprett mappen ved første faktiske drill (eller pre-emptivt med en `README.md` som forklarer formålet).

### 11.3 Off-region backup eksisterer ikke

**Status:** Render-snapshots ligger kun i Frankfurt. Hvis hele AWS Frankfurt-region går ned (sjelden, men har skjedd ~1× per 5 år), har vi ingen recovery-vei.

**Action:** Implementer ukentlig `pg_dump` til Cloudflare R2 eller AWS S3 i annen region. Estimat: 1 dev-dag.

**Linear:** ikke opprettet enda — anbefales spawnes som BIN-XXX etter denne PR-en.

### 11.4 On-call-rotasjon ikke signert

**Status:** [`DISASTER_RECOVERY_PLAN_2026-04-25.md`](./DISASTER_RECOVERY_PLAN_2026-04-25.md) §10 lister dette som åpen risiko.

**Action:** før pilot må Tobias signere off på:
- Hvem er primary on-call (telefon).
- Hvem er backup.
- Eskaleringsvei og PagerDuty/Slack-konfiguration.
- Når får on-call-personene wallet- og DB-tilgang? (kun Tobias har det per i dag).

---

## 12. Referanser

- [`DATABASE_RESTORE_PROCEDURE.md`](./DATABASE_RESTORE_PROCEDURE.md) — prod-restore-runbook (faktisk hendelse)
- [`MIGRATION_DEPLOY_RUNBOOK.md`](./MIGRATION_DEPLOY_RUNBOOK.md) — migrate-feilhåndtering
- [`DISASTER_RECOVERY_PLAN_2026-04-25.md`](./DISASTER_RECOVERY_PLAN_2026-04-25.md) — overordnet DR-plan
- [`LIVE_ROOM_DR_RUNBOOK.md`](./LIVE_ROOM_DR_RUNBOOK.md) — live-rom-recovery
- [`COMPLIANCE_INCIDENT_PROCEDURE.md`](./COMPLIANCE_INCIDENT_PROCEDURE.md) — Lotteritilsynet 24t SLA
- [`E2E_SMOKE_TEST.md`](./E2E_SMOKE_TEST.md) — smoke-test-prosedyre
- [`HALL_PILOT_RUNBOOK.md`](./HALL_PILOT_RUNBOOK.md) — pilot-runbook
- [`DRILL_ROLLBACK_2026-Q3.md`](./DRILL_ROLLBACK_2026-Q3.md) — søsterdoc for rollback-drill
- [`LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md`](../architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md) §3.3, §3.4 R12, §6 pilot-gating
- [ADR-012 — Idempotente migrasjoner](../decisions/ADR-012-idempotent-migrations.md)
- Render PITR-docs: <https://render.com/docs/databases#point-in-time-recovery>
