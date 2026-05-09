# Disaster Recovery Runbook (BIN-772 / A5)

**Owner:** Technical lead (Tobias Haugen)
**On-call rotation:** TBD — fastsettes før pilot-start
**Last updated:** 2026-05-08
**Linear:** [BIN-772](https://linear.app/bingosystem/issue/BIN-772) (M2 — Multi-hall-launch, A-spor)

> Denne runbooken er **operasjonell entry-point for Disaster Recovery**. Den
> formaliserer RPO/RTO-mål, gir stegvis restore-prosedyre og definerer
> kvartalsvis drill-kadens. Den **dupliserer ikke** de detaljerte
> DR-arkitekturvalgene som allerede er beskrevet i:
>
> - [`DISASTER_RECOVERY_PLAN_2026-04-25.md`](./DISASTER_RECOVERY_PLAN_2026-04-25.md)
>   — full risikomatrise (8 scenarier), prevention/detection/response,
>   topp-3 åpne risikoer, anbefalingsliste pre-pilot.
> - [`LIVE_ROOM_DR_RUNBOOK.md`](./LIVE_ROOM_DR_RUNBOOK.md) — rom-spesifikk
>   recovery (S1-S7 live-rundescenarier).
> - [`MIGRATION_DEPLOY_RUNBOOK.md`](./MIGRATION_DEPLOY_RUNBOOK.md) — fail-safe
>   håndtering når migrate feiler under deploy.
> - [`ROLLBACK_RUNBOOK.md`](./ROLLBACK_RUNBOOK.md) — hall-rollback til Unity-klient.
>
> Hvis du leter etter "hva gjør jeg når X skjer", start i
> `DISASTER_RECOVERY_PLAN_2026-04-25.md`. Denne runbooken eier
> **bevisbyrden** for at restore faktisk fungerer (drill-script + kadens +
> rapporterings-template).

---

## 0. TL;DR

| Mål | Verdi | Begrunnelse |
| --- | --- | --- |
| **RPO** (Recovery Point Objective) | **< 1 time** (kontraktuelt minimum) — faktisk **≤ 5 min** når Postgres-instansen kjører på Render `pro`-plan med PITR | Render `pro`-plan har kontinuerlig WAL-arkivering. Daglig snapshot dekker worst-case (ikke-`pro` plan). |
| **RTO backend** (return-to-service) | **< 4 timer** (kontraktuelt maksimum) — faktisk **≤ 30 min** for ren restart | Render redeploy ~5 min + DNS/cache-propagering + smoke. |
| **RTO database** (full PITR-restore) | **< 4 timer** (kontraktuelt maksimum) — faktisk **≤ 2 timer** når drill er øvd inn | Render-managed Postgres point-in-time-restore + DNS-flip + smoke. |
| **Drill-kadens** | **Kvartalsvis** (Q1/Q2/Q3/Q4) | Sikrer at backup faktisk er restorbar; logges i `dr-drill-log/`. |

**Kritisk pre-pilot-krav:** drillet **minst én gang** før første hall flippes. Se §6 nedenfor.

---

## 1. RPO/RTO i detalj

### 1.1 RPO — Recovery Point Objective

**Definisjon:** Maksimalt akseptabelt datatap målt i tid, fra siste persisterte commit til disaster-tidspunkt.

| Datasett | Persisteringsmønster | RPO |
| --- | --- | --- |
| **Postgres** (compliance-ledger, wallet, audit) | Synchronous write, kontinuerlig WAL-arkivering på Render `pro` | **≤ 5 min** (worst case mellom WAL-flush og snapshot) |
| **Postgres** uten `pro`-plan | Daglig snapshot kun | **≤ 24 timer** (uakseptabelt for pilot — derfor er `pro`-oppgradering pre-pilot-krav, ref [DR-plan §11 #1](./DISASTER_RECOVERY_PLAN_2026-04-25.md#uke-02-før-pilot-start--må-ha)) |
| **Redis** (rom-state, fanout-bus) | Ephemeral cache | **0** (ingen persistensgaranti — alle invarianter må være rebuildbare fra Postgres) |
| **Cloudinary assets** (bilder, lyd) | CDN-managed med egen replikering | **N/A** (eksternt, ikke vårt ansvar) |
| **Compliance ledger** | Postgres + idempotency-key UNIQUE-constraint | **Samme som Postgres**: ≤ 5 min |

**Pilot-kontraktuelt mål:** **< 1 time RPO**. Faktisk leveranse er **≤ 5 min** når `pro`-planen er aktiv.

### 1.2 RTO — Recovery Time Objective

**Definisjon:** Maksimalt akseptabelt tid fra disaster-deteksjon til service tilbake i drift.

| Scenario | Manuelle steg | RTO |
| --- | --- | --- |
| Backend-instans dør (auto-restart i Render) | Ingen — Render auto-recover | **< 2 min** |
| Backend-instans dør (krever manuell deploy-rollback) | Render dashboard → forrige deploy → Redeploy | **< 30 min** |
| Postgres schema-feil under deploy | Auto-rollback (build feiler, ny container starter ikke) | **< 15 min** (debug + ny PR) |
| Postgres operatør-feil (`DELETE` uten `WHERE`) | Stopp trafikk → diagnose → manuell rebuild eller PITR | **30-120 min** |
| Postgres full PITR-restore | Render dashboard → backups → restore til timestamp → cut over `APP_PG_CONNECTION_STRING` → smoke | **60-120 min** |
| Hele Render-region nede (Frankfurt) | Manuell — ingen kald-standby implementert | **Timer** (avhenger av Render) |

**Pilot-kontraktuelt mål:** **< 4 timer RTO**. Faktisk leveranse for målbare scenarier er **≤ 2 timer**.

---

## 2. Stegvis restore-prosedyre

Følgende prosedyre dekker den vanligste restore-veien — **full PITR til ny Postgres-instans**. For andre scenarier (schema-feil under deploy, operatør-feil med liten radius) — se [DISASTER_RECOVERY_PLAN_2026-04-25.md §4](./DISASTER_RECOVERY_PLAN_2026-04-25.md#4-database-korrupsjon-eller--tap).

### 2.1 Pre-flight (før du starter restore)

1. **Identifiser at restore er rette respons.** Vurder mindre invasive alternativer først:
   - Schema-feil? → Render auto-rollback håndterer det.
   - Liten datakorrupsjon? → Manuell rebuild fra audit-log.
   - Større skade eller tvil? → Fortsett til full PITR.
2. **Annonser blackout** umiddelbart:
   ```sql
   UPDATE app_halls SET is_active = false; -- alle haller i vedlikeholdsmodus
   ```
   Player-facing message: "Vedlikehold pågår, prøv igjen om 1-2 timer."
3. **Varsle compliance-eier** — datatap > 5 min er meldepliktig til Lotteritilsynet (24t SLA, ref pengespillforskriften §11). Compliance-eier skriver rapport-template i parallell med restoren.
4. **Logg start-tidspunktet** i `#ops-cutover`:
   ```
   PITR-restore initiert <ISO>. Target restore-timestamp: <ISO - 5 min før hendelsen>.
   On-call: <navn>. Compliance: <navn>.
   ```

### 2.2 Trigger Render PG snapshot restore

1. Logg inn på [Render dashboard](https://dashboard.render.com/).
2. Velg Postgres-tjenesten (`spillorama-system-db` eller tilsvarende).
3. Gå til **Backups**-fanen.
4. Velg **Point-in-Time Restore**.
5. Velg timestamp: **5 min FØR den observerte hendelsen** (justeres oppover hvis hendelsen tok tid å oppdage).
6. Klikk **Restore**. Render lager en **NY DB-instans**:
   - Typisk navn: `<original>-restored-<timestamp>`
   - Spawn-tid: 5-30 min avhengig av DB-størrelse.
7. **Vent på at restoren er ferdig.** Render-dashboardet viser status `Available` når den er klar.

> **Viktig:** Den restorede instansen er en NY instans — original-instansen blir ikke overskrevet. Behold begge i 30 dager før den korrupte slettes (forensikk).

### 2.3 Migrer ny PG-instans inn i config

1. Hent connection-string fra den restorede instansen (Render → DB-tjenesten → Connect).
2. Oppdater backend-tjenesten:
   - **Render dashboard → spillorama-system → Environment**
   - Sett `APP_PG_CONNECTION_STRING` til den nye stringen.
   - Klikk **Save Changes** — Render restartet backend automatisk.
3. **Verifiser oppstart:**
   - `GET /health` returnerer 200.
   - Render-loggen viser ingen migrate-feil (migrate kjøres ved boot per `render.yaml` `buildCommand`; siden snapshot inneholder `pgmigrations`-tabellen, hopper migrate over alt som er applied).

### 2.4 Test restoren (smoke-suite)

Kjør smoke-checks **før** du fjerner blackout-modus:

```bash
# Quick smoke fra terminal:
curl -fsS https://api.spillorama.no/health
curl -fsS https://api.spillorama.no/api/games | jq '.data | length'

# Detaljert smoke (kjør drill-script i read-only-modus mot prod):
DR_DRILL_MODE=verify bash infra/dr-drills/quarterly-restore-drill.sh
```

**Manuelle sjekkpunkter:**

- [ ] Backend booter (`/health` returnerer 200).
- [ ] `/api/games` returnerer kjente spill (bingo/rocket/monsterbingo/spillorama).
- [ ] Spiller kan logge inn (test-bruker).
- [ ] Wallet-saldo for test-bruker matcher kjent siste-known-good-verdi.
- [ ] Compliance-ledger har siste registrerte transaksjon med timestamp ≤ restore-tidspunkt + 5 min.
- [ ] Ingen `pgmigrations`-rader savnes (sammenlign mot `apps/backend/migrations/`-katalog).

### 2.5 Cutover og post-restore

1. **Fjern blackout** (gradvis — én hall først som canary):
   ```sql
   UPDATE app_halls SET is_active = true WHERE id = '<canary-hall-id>';
   ```
2. Vent 15 min, observer Grafana `connection-health` og `finance-gates`.
3. Hvis grønt: åpne resten:
   ```sql
   UPDATE app_halls SET is_active = true;
   ```
4. **Loggfør gap-vinduet** — alle transaksjoner mellom `restore-timestamp` og `disaster-timestamp` er **tapt**. Compliance-eier eskalerer til Lotteritilsynet:
   ```
   Datatap-vindu: <restore-timestamp> → <disaster-timestamp>.
   Antall berørte transaksjoner (estimat): <fra Grafana finance-gates dashboard>.
   Antall berørte spillere: <fra app_compliance_ledger SELECT DISTINCT user_id>.
   ```
5. **Behold den restorede instansen** i 30 dager. Behold den korrupte original-instansen i 30 dager (kun forensikk, ikke koblet).

### 2.6 Når kalle Lotteritilsynet (compliance-effekter)

Per **pengespillforskriften §11** + Spillorama-konsesjonens vilkår:

| Hendelse | Meldepliktighet | SLA |
| --- | --- | --- |
| Datatap > 5 min som påvirker spiller-utbetalinger | **Skriftlig** til Lotteritilsynet | **24 timer** |
| Sikkerhetshendelser med personopplysninger | **Skriftlig** til Datatilsynet (GDPR Art. 33) | **72 timer** |
| Større utfall (>1 time, >50% av haller) | **Muntlig** umiddelbart, skriftlig oppfølger | **24 timer** for skriftlig |
| Fullstendig PITR-restore (selv uten åpenbar payout-impact) | **Skriftlig** — restore er per definisjon datatap | **24 timer** |

**Compliance-eier eier alle disse SLA-ene.** Backend-team leverer data-eksport på forespørsel innen 1 time.

---

## 3. Drill-prosedyre (kvartalsvis)

### 3.1 Hvorfor kvartalsvis

Render auto-backup er kun ≈90% pålitelig dersom backup-restore aldri er testet. Vi vil **bevise** restore er funksjonell før vi trenger den under en hendelse. Kadensen er tilpasset:

- **Kvartalsvis** = ofte nok til å fange driver/format-drift i Render
- **Sjeldnere enn månedlig** = realistisk for et lite team (krever Tobias + on-call)
- **Pre-pilot-krav** = drill **minst én gang** før første hall flippes (ref [DR-plan §11 #2](./DISASTER_RECOVERY_PLAN_2026-04-25.md#uke-02-før-pilot-start--må-ha))

### 3.2 Drill-eier og deltakere

| Rolle | Ansvar |
| --- | --- |
| **Drill-eier** | Backend on-call (kvartalets vakthavende). Trigger drill, kjører script, fyller log. |
| **Approver** | Technical lead (Tobias). Signerer at drillet er valid. |
| **Compliance-observer** | Compliance-eier. Verifiserer at audit-trail og ledger er intakt etter restore. |

### 3.3 Drill-script

Skriptet `infra/dr-drills/quarterly-restore-drill.sh` automatiserer step 2-4 av §2 over, mot et **isolert tomt miljø** (lokal Docker eller dedikert staging-instans — **aldri prod**).

```bash
# Standard kvartalsdrill (lokalt mot tom Postgres):
bash infra/dr-drills/quarterly-restore-drill.sh

# Drill mot dedikert staging-instans:
DR_DRILL_TARGET=staging bash infra/dr-drills/quarterly-restore-drill.sh

# Bare verifiser (read-only) — brukes etter prod-restore for å sjekke nye instansen:
DR_DRILL_MODE=verify bash infra/dr-drills/quarterly-restore-drill.sh
```

Skriptet:

1. Starter en tom Postgres-container (eller bruker valgt staging-instans).
2. Henter eller forventer at brukeren har lastet ned siste prod-snapshot (manuelt fra Render — automatisk via Render API krever billing-tier).
3. Restorerer snapshotten til den tomme DB-en.
4. Kjører integritets-sjekker:
   - Alle hovedtabeller har data (`app_users`, `app_wallets`, `app_compliance_ledger`, ...)
   - FK-er holder (ingen orphan rows)
   - `pgmigrations`-tabellen er konsistent med `apps/backend/migrations/`
   - Audit-trail har monotonisk-økende timestamps
5. Rapporterer resultat (PASS / FAIL) med eksplisitt avvik.

### 3.4 Drill-log

Etter hver drill:

1. Opprett `docs/operations/dr-drill-log/<yyyy-Q[N]>.md` (én fil per kvartal).
2. Bruk template fra `docs/operations/dr-drill-log/README.md`.
3. Legg ved:
   - Drill-script-output (klipp inn full stdout)
   - Eventuelle avvik fra forventet oppførsel
   - PASS/FAIL-konklusjon
   - Sign-off fra drill-eier + Tobias + compliance-observer
4. Lenk til log fra Linear-issuen for kvartalets driftsoppgaver (M2-spor).

### 3.5 Pass-kriterier

Drillet er **PASS** hvis:

- ✅ Snapshot kunne lastes ned/aksesseres.
- ✅ Restore kunne kjøres mot tom Postgres.
- ✅ Alle integritets-sjekker passerte (script returnerer exit 0).
- ✅ Tids-totalt fra "trigger restore" til "smoke passerer" var **< 4 timer** (RTO-krav).
- ✅ Restore-timestamp var **maks 5 min** bak disaster-timestamp (RPO-krav).

Drillet er **FAIL** hvis ett eller flere av kravene over ikke er oppfylt. **Pilot-pause** — første hall kan ikke flippes før FAIL er løst.

### 3.6 Kvartalsplan

| Kvartal | Måned | Fokus |
| --- | --- | --- |
| **Q1** | Pre-pilot (uke 0-2) | **Bevis at restore fungerer.** Kjør drillet før første hall flippes. |
| **Q2** | Pilot uke 8-9 | Verifisering etter første pilot-måned. Sjekk at faktisk pilot-data er restorbar. |
| **Q3** | Pilot uke 20-22 | Skala-test: restore mot full pilot-data-volum. |
| **Q4** | Annual review | End-to-end inkl. region-failover-vurdering (ref [DR-plan §10 risiko 1](./DISASTER_RECOVERY_PLAN_2026-04-25.md#risiko-1-single-region-deploy-render-frankfurt)). |

---

## 4. Recovery-flow (oversikt)

```
DISASTER OPPDAGET
    │
    ├─► Klassifiser scenario
    │   (DISASTER_RECOVERY_PLAN_2026-04-25.md §3-§8)
    │
    ├─► Annonser blackout (alle haller is_active=false)
    │
    ├─► Varsle compliance-eier (24t SLA-klokken starter)
    │
    ├─► VELG RESPONSE
    │   ├─ Auto-recovery (Render auto-restart)? → vent < 2 min
    │   ├─ Schema-feil? → Render auto-rollback (< 15 min)
    │   ├─ Liten datakorrupsjon? → manuell rebuild (30-60 min)
    │   └─ Full PITR? → §2 over (60-120 min)
    │
    ├─► VERIFISER (smoke-suite §2.4)
    │
    ├─► CUTOVER (canary først, så all)
    │
    └─► POST-RESTORE
        ├─ Lotteritilsynet-rapport (24t)
        ├─ Behold restored + corrupted instans i 30 dager
        └─ Logg hendelsen i `docs/operations/incident-log/`
```

---

## 5. Hva ikke dekkes her

For å holde denne runbooken fokusert er følgende eksplisitt ekskludert:

| Tema | Hvor er det dekket |
| --- | --- |
| Full risikomatrise (8 scenarier) | [`DISASTER_RECOVERY_PLAN_2026-04-25.md`](./DISASTER_RECOVERY_PLAN_2026-04-25.md) §2-§8 |
| Live-rom-recovery (S1-S7) | [`LIVE_ROOM_DR_RUNBOOK.md`](./LIVE_ROOM_DR_RUNBOOK.md) |
| Hall-internett-kutt | [`DISASTER_RECOVERY_PLAN_2026-04-25.md`](./DISASTER_RECOVERY_PLAN_2026-04-25.md) §5 + [`HALL_PILOT_RUNBOOK.md`](./HALL_PILOT_RUNBOOK.md) |
| Migrate-feil under deploy | [`MIGRATION_DEPLOY_RUNBOOK.md`](./MIGRATION_DEPLOY_RUNBOOK.md) |
| Hall-rollback til Unity-klient | [`ROLLBACK_RUNBOOK.md`](./ROLLBACK_RUNBOOK.md) |
| Render env-vars + secrets-rotering | [`RENDER_ENV_VAR_RUNBOOK.md`](./RENDER_ENV_VAR_RUNBOOK.md) |
| Observability + alerts + dashboards | [`OBSERVABILITY_RUNBOOK.md`](./OBSERVABILITY_RUNBOOK.md) |
| Swedbank reconcile | [`DISASTER_RECOVERY_PLAN_2026-04-25.md`](./DISASTER_RECOVERY_PLAN_2026-04-25.md) §8 |
| Database-restore prosedyre i prod (operasjonell variant) | [DATABASE_RESTORE_PROCEDURE.md (BIN-790 / C4)](https://linear.app/bingosystem/issue/BIN-790) |

---

## 6. Eierskap og approval

| Rolle | Ansvar | Sign-off |
| --- | --- | --- |
| **Technical lead** (Tobias) | Eier RPO/RTO-mål; signerer kvartalsdrill-evidens | _pending_ |
| **Backend on-call** | Kjører kvartalsdrill; oppdaterer denne runbooken etter hver drill | _pending_ |
| **Compliance-eier** | Eier Lotteritilsynet-rapport-flow; verifiserer audit-trail etter restore | _pending_ |
| **Ops** | Eier deploy-blackout-vinduer + alert-routing | _pending_ |

Drift kan **ikke starte** uten:

- ✅ Pre-pilot-drill kjørt med PASS (loggført i `dr-drill-log/`)
- ✅ `pro`-plan aktivert på Postgres-tjenesten
- ✅ Sign-off fra alle fire roller over

---

## 7. Endrings-historie

| Dato | Endring | Eier |
| --- | --- | --- |
| 2026-05-08 | Initial versjon (BIN-772 / A5) — formaliserer RPO/RTO, drill-script, kvartalsplan. Refererer eksisterende DR-plan for full risikomatrise. | A5-agent |

Ved oppdatering: bump "Last updated" øverst, post i `#ops-cutover`, oppdater Linear-issuen.

---

## 8. Referanser

- [`DISASTER_RECOVERY_PLAN_2026-04-25.md`](./DISASTER_RECOVERY_PLAN_2026-04-25.md) — full DR-arkitektur
- [`LIVE_ROOM_DR_RUNBOOK.md`](./LIVE_ROOM_DR_RUNBOOK.md) — rom-spesifikk recovery
- [`MIGRATION_DEPLOY_RUNBOOK.md`](./MIGRATION_DEPLOY_RUNBOOK.md) — deploy + migrate fail-safe
- [`ROLLBACK_RUNBOOK.md`](./ROLLBACK_RUNBOOK.md) — hall-rollback
- [`infra/dr-drills/quarterly-restore-drill.sh`](../../infra/dr-drills/quarterly-restore-drill.sh) — drill-script
- [`docs/operations/dr-drill-log/`](./dr-drill-log/) — drill-logger
- [pengespillforskriften §11](https://lovdata.no/) — meldeplikt ved datatap
- [Render PostgreSQL — Backups](https://render.com/docs/databases#backups) — snapshot/PITR
