# Drill: Deploy Rollback (D-ROLLBACK-1) — Pilot 2026-Q3

**Eier:** Tobias Haugen (technical lead)
**Eksekverende:** L2 backend on-call + L3 incident commander
**Linear:** [BIN-790](https://linear.app/bingosystem/issue/BIN-790) (M2 Spor C — Operasjon & infrastruktur), [BIN-816](https://linear.app/bingosystem/issue/BIN-816) (R12 — DR-runbook)
**Sist oppdatert:** 2026-05-08
**Frekvens:** Per deploy mot staging (rutinemessig). **Obligatorisk full øvelse mot staging-pilot-image før første pilot-hall flippes.**

> Dette dokumentet er **drill-prosedyren** — en treningsøvelse som verifiserer at vi
> faktisk kan rulle tilbake en Render-deploy hvis ny versjon viser seg ødelagt.
> Det er IKKE en prod-incident-runbook.
>
> - **Prod-rollback (faktisk hendelse):** se [`DEPLOY_ROLLBACK_PROCEDURE.md`](./DEPLOY_ROLLBACK_PROCEDURE.md).
> - **Migration-feil under deploy** (build aldri lykkes): se [`MIGRATION_DEPLOY_RUNBOOK.md`](./MIGRATION_DEPLOY_RUNBOOK.md).
> - **Hall-rollback** (Unity vs. web client-variant flag): se [`ROLLBACK_RUNBOOK.md`](./ROLLBACK_RUNBOOK.md). Det er en helt annen mekanisme.
> - **Hot-fix uten review:** se [`HOTFIX_PROCESS.md`](./HOTFIX_PROCESS.md).

---

## 0. Hvorfor denne drillen

Per R-mandatet ([`LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md`](../architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md) §3.3) skal vi kunne rulle tilbake en deploy raskt uten å miste data eller compliance-rader. Vi har dokumentert prosedyren, men har **aldri** faktisk klikket "Redeploy this version" på en pilot-image og verifisert at:

1. Backend faktisk booter mot eldre image.
2. Migrasjons-asymmetrien (forward-only migrations) ikke gjør rollback umulig.
3. Smoke-test-en passerer på rullet-tilbake-versjon.
4. Pågående runder fortsetter / pauser kontrollert.

Hvis vi får en P1 pilot-dag og dette mislykkes første gang vi prøver, har vi ikke en backup-plan.

Drill-formålet:

1. **Verifiser at "Redeploy this version" faktisk fungerer** end-to-end.
2. **Bevis at ny migration kan kjøres** uten at eldre kode brekker (forward-compat-test).
3. **Mål faktisk RTO** (mål: ≤ 5 min standard rollback, ≤ 15 min nuke-option).
4. **Tren operatør-rotasjonen** så minst to mennesker har klikket Redeploy under stress.

---

## 1. Hvordan rollback fungerer i Render

### 1.1 Mekanikk

Render holder en historikk av alle vellykkede deploys per service. Hvert deploy korresponderer til et bygd container-image lagret i Render-internt registry.

**"Redeploy this version"-knappen:**
- Restarter den valgte (eldre) imagen.
- Kjører IKKE `buildCommand` på nytt — eldre imagen er allerede bygd.
- Kjører IKKE `npm run migrate` — siden buildCommand ikke kjøres.
- Bytter ut live-container med valgt eldre version (rolling).
- Trafikk rutes til ny container etter `/health` 200.

**Konsekvens:** DB-en er på den NYESTE migrate-tilstanden (siden migrate kjørte ved siste forward-deploy). Eldre kode må fortsatt fungere mot ny DB.

### 1.2 Hvorfor dette vanligvis er trygt — additive migrations

Per [ADR-012](../decisions/ADR-012-idempotent-migrations.md) og `apps/backend/migrations/README.md`: alle migrasjoner er **forward-only** og **additive**.

| Mønster | Trygt for rollback? |
|---|---|
| `CREATE TABLE IF NOT EXISTS` | ✅ Ja — eldre kode ignorerer ny tabell |
| `ALTER TABLE ADD COLUMN IF NOT EXISTS` (nullable) | ✅ Ja — eldre kode ignorerer ny kolonne |
| `CREATE INDEX IF NOT EXISTS` | ✅ Ja — kun ytelses-effekt |
| `INSERT INTO seed_data ...` | ✅ Ja — eldre kode kan lese fra ny seed |
| **`ALTER TABLE ADD COLUMN ... NOT NULL`** uten default | ❌ Nei — eldre kode INSERT feiler |
| **`DROP COLUMN`** brukt av eldre kode | ❌ Nei — eldre kode SELECT feiler |
| **`ALTER COLUMN TYPE`** med data-incompatible kast | ❌ Nei — typisk feiler først ved skriv |
| **Endring av enum-verdier** brukt av eldre kode | ❌ Nei — typisk feiler ved validering |

Drill-en under verifiserer at vi faktisk **får tatt rollback uten breakage**.

### 1.3 Migrations-asymmetri — den farlige fellen

**Forward-only migrasjons-policy** (BIN-661) betyr:
- Vi har **ingen** down-migrations.
- `npm run migrate:down` er fjernet fra `package.json`.
- Hvis vi må reversere en endring: skriv en NY forward-migration som angrer.

**Konsekvens for rollback:** vi kan ALDRI rulle DB-en tilbake forbi den siste applied migrasjonen. Backend-en kan rulles tilbake til en hvilken som helst tidligere image, men DB-en blir værende på siste schema.

**Dette betyr at hvis siste deploy inneholder en breaking schema-endring** (NOT NULL, DROP COLUMN, etc.), er rollback alene **utilstrekkelig**. Du må:

1. Rulle backend tilbake (få trafikken stabil først).
2. Identifiser den breaking migrasjonen.
3. Skriv ny forward-migration som **gjør schema kompatibelt med eldre kode** (eks. fjern NOT NULL, gi default, restore tabell fra arkiv).
4. Test på staging.
5. Rulle frem igjen med fix.

Drill-en under tester også dette scenarioet (§4.5 "forward-fix-cycle").

---

## 2. RTO-mål for drill-en

| Mål | Verdi | Hvordan vi måler |
|---|---|---|
| **Standard rollback** (klikk Redeploy → /health 200) | ≤ 5 min | Stoppeklokke |
| **Smoke-test etter rollback** | ≤ 15 min | Etter /health 200 |
| **Total RTO standard rollback** | ≤ 20 min | Klikk → smoke grønn |
| **Forward-fix-cycle** (rollback + fix-migration + re-deploy) | ≤ 60 min | Klikk Redeploy → ny deploy live |
| **Nuke option** (rollback umulig, hot-fix) | ≤ 15 min | Klikk → ny deploy live |

**Suksesskriterium for D-ROLLBACK-1:** alle tre standard rollback-mål oppnådd, og verifikasjons-sjekklisten i §6 er 100% grønn.

---

## 3. Forutsetninger og forberedelser

### 3.1 Hvem kan kjøre drill-en

- **Eier:** Tobias.
- **Eksekverende:** L2 backend on-call.
- **Observatør:** L3 incident commander eller annen utvikler (verifiserer prosedyren + tar tiden).

**Aldri solo.**

### 3.2 Miljø — bruk staging, IKKE prod

Drill-en kjøres mot **staging-tjenesten** `spillorama-staging`. Vi rør aldri prod under drill.

| Miljø | Bruk |
|---|---|
| `spillorama-system` (prod) | **Aldri** under drill |
| `spillorama-staging` (staging) | Mål for rollback-eksekvering |
| `spillorama-staging-pg` (staging Postgres) | Skjema får evt. forward-fix-migration under §4.5 |

### 3.3 Pre-flight-sjekkliste

- [ ] Tobias har signert off på drill-tidspunktet.
- [ ] L2 + L3 har lest [`DEPLOY_ROLLBACK_PROCEDURE.md`](./DEPLOY_ROLLBACK_PROCEDURE.md) og denne drill-doc-en.
- [ ] Slack-kanal `#ops-drill` opprettet — drill logges live.
- [ ] Stoppeklokke klar.
- [ ] Render-dashboard tilgjengelig.
- [ ] Identifisert hvilken commit som er nåværende `Live` på staging — dette er rollback-mål.
- [ ] Identifisert forrige `Live`-deploy som vi vil rulle tilbake **til**.
- [ ] Drill-log-template (§7) åpnet.

### 3.4 Sjekkliste FØR rollback (gjelder også prod-incident)

Spør deg selv før du klikker Redeploy — på drill **og** under faktisk incident:

| Spørsmål | Hvis NEI → ikke rull tilbake enda |
|---|---|
| Kan vi reprodusere feilen ved å sjekke commit-diff? | Sjekk om symptomet faktisk introduserts av siste deploy |
| Vet vi sikkert at forrige Live-versjon ikke har den samme bugen? | Sjekk Render Deploys-fanen — hvilken commit var det? |
| Er forrige image fortsatt tilgjengelig i Render? (≤ 30 dager gammel?) | Hvis nei → §4.6 nuke-option |
| Har siste migrasjon en breaking schema-endring (NOT NULL, DROP, etc.)? | Hvis ja → forward-fix-cycle (§4.5) i stedet for ren rollback |
| Har vi en backup av nåværende DB-state for forensikk? | Ta manuell snapshot via Render-dashboard FØR du ruller |
| Er det aktive runder midt i bingo-spill? | Vurder timing — restart bryter socket-tilkobling 30–90 sek |

> 🚨 Hvis du svarer NEI på et hvilket som helst spørsmål: **eskaler til Tobias**. Pre-deploy-sjekklisten er der for å unngå at "rollback gjør vondt verre".

---

## 4. Drill-prosedyre — fire scenarier

### 4.1 Standard rollback (Scenario A) — ≈ 20 min

Mål: bevise at "Redeploy this version" fungerer i happy-path.

#### Steg 1 — Pre-state baseline (≈ 2 min)

```bash
# Fang nåværende staging-state
curl -fsS https://staging.spillorama.no/health | jq .
curl -fsS https://staging.spillorama.no/api/version | jq .
# Notér commit-SHA og helsestatus
```

#### Steg 2 — Lag en ufarlig endring (≈ 5–10 min for Render-build)

For å ha noe å rulle tilbake til, må vi først deploye en NY versjon på staging. Dette gjøres typisk som del av rutinemessig staging-deploy, men hvis det er en stund siden:

1. Lag commit på `staging`-branch som endrer en kommentar eller version-string.
2. Push → Render auto-build på staging.
3. Vent på `Live`-status med ny commit-SHA.

Hvis staging allerede er nylig deployet med ny commit, hopp til Steg 3.

#### Steg 3 — Klikk Redeploy this version (≈ 2–3 min)

1. **Render-dashboard → `spillorama-staging` → Deploys**.
2. Finn raden under den siste `Live`-deploy (= forrige version).
3. **Start stoppeklokke.**
4. Klikk **... (3-prikks-menyen) → Redeploy this version**.
5. Bekreft i dialog: "Yes, redeploy this version".

`[Skjermbilde: Render Deploys-fanen med "Redeploy this version"-meny åpen]`

Render starter rolling deploy — eldre image hentes fra registry, ny container starter, helsesjekk kjøres, gammel container avvikles.

#### Steg 4 — Verifiser /health (≈ 1–2 min)

```bash
# Loop til /health er 200:
while ! curl -fsS https://staging.spillorama.no/health > /dev/null 2>&1; do
  echo "Waiting for /health..."
  sleep 5
done
echo "/health OK at $(date -Iseconds)"

# Stopp stoppeklokken HER. Dette er T_health_ok.

# Verifiser at det er forrige commit som kjører:
curl -fsS https://staging.spillorama.no/api/version | jq .
# Forventet: forrige commit-SHA, IKKE den nyeste
```

`[Skjermbilde: Render-dashboard Deploys-fanen med forrige commit som "Live"]`

#### Steg 5 — Smoke-test (≈ 10–15 min)

Kjør abbreviert E2E-smoke per [`E2E_SMOKE_TEST.md`](./E2E_SMOKE_TEST.md):

| Test | Forventet |
|---|---|
| Login med kjent test-bruker | 200 + JWT-token |
| `GET /api/wallet/me` | Saldo OK |
| `GET /api/halls` | Demo-haller listes |
| `GET /api/games` | Spill listes |
| `GET /api/games/spill1/health?hallId=...` | `status: ok` |
| Aktiv socket-tilkobling fra dev-bruker | Kobler til uten timeout |

#### Steg 6 — Rull frem igjen (≈ 5 min)

Etter at standard rollback er bevist: rull tilbake til nyeste version så staging er klar for neste runde testing.

1. Render-dashboard → Deploys → finn nyeste deploy → Redeploy this version.
2. Vent på Live.
3. `/health` 200 + commit-SHA matches nyeste.

#### Steg 7 — Logg resultat

Fyll inn drill-logg per §7 template.

---

### 4.2 Forward-compat-test (Scenario B) — ≈ 30 min

Mål: bevise at en ny additive migration kjører + at eldre kode fortsatt fungerer mot ny DB.

#### Steg 1 — Lag en additive migrasjon i staging-branch

Eksempel: legg til en ny nullable kolonne på en eksisterende tabell.

```sql
-- apps/backend/migrations/<timestamp>_drill_b_add_canary_column.sql
-- Up migration
ALTER TABLE app_audit_log
  ADD COLUMN IF NOT EXISTS drill_canary_marker TEXT;
```

#### Steg 2 — Deploy til staging (≈ 5–10 min)

Push branch → merge til staging → Render auto-build.

Verifiser at migrasjonen ble applied:

```bash
psql "$STAGING_PG" -c "SELECT name FROM pgmigrations ORDER BY run_on DESC LIMIT 3;"
# Forventet: ny migration listed øverst
```

#### Steg 3 — Rull tilbake (≈ 5 min)

Per §4.1 standard rollback til forrige Live (før migrasjons-deploy).

#### Steg 4 — Verifiser at eldre kode kjører mot ny DB (≈ 10 min)

```bash
# /health må fortsatt være 200
curl -fsS https://staging.spillorama.no/health | jq .

# Eldre kode SKAL ignorere ny kolonne — verifiser at audit-skriv fortsatt fungerer
# (trigger ved login eller annen audit-mutating operasjon)

# Sjekk at kolonnen fortsatt finnes på DB (eldre kode rør den ikke)
psql "$STAGING_PG" -c "\d app_audit_log" | grep drill_canary
# Forventet: kolonnen finnes fortsatt
```

Hvis eldre kode plutselig krasjer fordi kolonnen finnes: vi har en bug i forward-compat — fang den i staging FØR pilot.

#### Steg 5 — Rul frem igjen (≈ 5 min)

Som §4.1 Steg 6.

#### Steg 6 — Cleanup-migrasjon (drop drill-kolonnen)

Etter drill: skriv en cleanup-migration som dropper `drill_canary_marker`. Husk: forward-only, så det blir ny forward-migration.

```sql
-- apps/backend/migrations/<timestamp>_drill_b_cleanup_canary_column.sql
-- Up migration
ALTER TABLE app_audit_log DROP COLUMN IF EXISTS drill_canary_marker;
```

---

### 4.3 Aktive socket-tilkoblinger under rollback (Scenario C) — ≈ 25 min

Mål: bevise at klienter reconnecter automatisk når backend restartes.

#### Steg 1 — Etabler aktive socket-tilkoblinger

På staging:
1. Åpne dev-spiller-shell (`https://staging.spillorama.no/web/?dev-user=demo-spiller-1`).
2. Naviger til en aktiv room.
3. Verifiser at socket er tilkoblet (Chrome DevTools → Network → WS).

#### Steg 2 — Trigger rollback (per §4.1)

Mens socket-tilkobling er aktiv, klikk Redeploy this version.

#### Steg 3 — Mål reconnect-tid

Stoppeklokke fra "klikk Redeploy" til socket reconnected i klient.

| Mål | Verdi |
|---|---|
| Klient mister socket | ≤ 30 sek etter rollback-trigger |
| Klient har reconnected (innen 3 sek per R3) | ≤ 90 sek total |
| Game-state replay-et | ≤ 5 sek etter reconnect |

`[Skjermbilde: Chrome DevTools Network-fanen med WS-reconnect-events]`

#### Steg 4 — Verifiser at game-state ikke er tapt

Runde fortsetter med samme phase + balls-drawn. Ingen tickets dupliseres.

---

### 4.4 Forward-fix-cycle når rollback er utilstrekkelig (Scenario D) — ≈ 60 min

Mål: simulere at siste deploy hadde en breaking migration som gjør ren rollback umulig. Vi må rulle tilbake **og** lande forward-fix.

#### Steg 1 — Simuler problemet (kontrollert, kun staging)

```sql
-- apps/backend/migrations/<timestamp>_drill_d_breaking_change.sql
-- Up migration

-- Legg til en NOT NULL-kolonne uten default — dette ville brutt eldre kode
-- som INSERT-er rader uten å sette kolonnen.
-- DETTE ER ANTI-MØNSTERET vi vil teste.
ALTER TABLE app_audit_log
  ADD COLUMN IF NOT EXISTS drill_d_required_marker TEXT;
-- Legg så på NOT NULL constraint i en separat migration (todo-state)
-- (For at vi skal kunne deploye en kompatibel forward-fix.)
```

> ⚠️ Dette er **kun for drill mot staging**. Aldri commit slike anti-mønstre til main.

#### Steg 2 — Deploy til staging

Push branch → merge til staging → Render builder. Ny versjon live.

#### Steg 3 — Klikk Redeploy this version til forrige Live

Standard rollback per §4.1.

#### Steg 4 — Verifiser at eldre kode bryter

`/health` kan returnere 200 (siden NOT NULL ikke håndheves enda i dette mønsteret), men fortsetter test-er som INSERT-er rader vil feile hvis vi senere legger på constraint:

```sql
psql "$STAGING_PG" -c "SELECT COUNT(*) FROM app_audit_log WHERE drill_d_required_marker IS NULL;"
# Forventet: rader med NULL — eldre kode skriver ikke kolonnen
```

#### Steg 5 — Skriv forward-fix-migrasjon

```sql
-- apps/backend/migrations/<timestamp>_drill_d_forward_fix.sql
-- Up migration

-- Backfill med default-verdi for eksisterende NULL-rader
UPDATE app_audit_log
  SET drill_d_required_marker = 'drill_d_default'
  WHERE drill_d_required_marker IS NULL;

-- Sett DEFAULT så fremtidige eldre INSERT-s får verdi automatisk
ALTER TABLE app_audit_log
  ALTER COLUMN drill_d_required_marker SET DEFAULT 'drill_d_default';
```

#### Steg 6 — Deploy forward-fix

Push → Render bygger + migrate kjører + ny deploy live. Eldre kode skal nå fungere igjen.

#### Steg 7 — Cleanup

Skriv ny migration som dropper `drill_d_required_marker`-kolonnen helt. Aldri etterlat drill-data i staging schema.

---

### 4.5 Nuke option — rollback ikke mulig (Scenario E) — ≈ 30 min

Mål: simulere at forrige image er borte fra Render-cache (sjelden, men har skjedd etter > 30 dagers inaktivitet) eller DB inkompatibel. Vi må ta hot-fix-veien.

#### Steg 1 — Identifiser feilen

Anta: nyeste deploy bryter login. Forrige image er borte fra Render. Eldre kode ville krasjet mot ny DB.

#### Steg 2 — Sett haller i maintenance (kun staging)

```sql
-- Mot staging-DB:
UPDATE app_halls SET is_active = false;
```

Verifiser at klient-shell viser maintenance-banner.

#### Steg 3 — Status-side

```sql
INSERT INTO app_status_incidents (
  title, description, status, impact, affected_components, created_by_user_id
) VALUES (
  'DRILL: Vedlikehold pågår',
  'Drill D-ROLLBACK-1 Scenario E.',
  'investigating',
  'critical',
  '["api","database","bingo","wallet","auth"]'::jsonb,
  '<admin-user-id>'
);
```

#### Steg 4 — Skriv minimal hot-fix

Eksempel: ny migration som backfill-er en breaking endring + minimal kode-fix.

Branch + commit + skip review (audit-loggført). Push.

#### Steg 5 — Render auto-deploy

Vent ~5-10 min på ny build. Verifiser /health 200.

#### Steg 6 — Re-aktiver haller

```sql
UPDATE app_halls SET is_active = true;
UPDATE app_status_incidents
  SET status = 'resolved', resolved_at = NOW()
WHERE title = 'DRILL: Vedlikehold pågår';
```

---

### 4.6 (Anti-mønster — IKKE gjør) Hva vi ALDRI ruller tilbake forbi

> 🚨 Per [ADR-012](../decisions/ADR-012-idempotent-migrations.md) og forward-only-policy: vi ruller ALDRI DB-en tilbake forbi siste applied migrasjon. Det betyr:
>
> - **Aldri** `pg_restore` av en eldre snapshot for å "fjerne" en migrasjon.
> - **Aldri** manuelt slette rader fra `pgmigrations` for å lure systemet.
> - **Aldri** kjøre migrate:down (scriptet er fjernet fra `package.json`).
>
> Den eneste reverseringen er **ny forward-migration** som angrer endringen. Hvis du finner deg selv tenkende "vi ruller bare DB tilbake", **stopp og varsle Tobias**. Det er en kommandolinje unna data-tap.

---

## 5. Måling og logging

### 5.1 Tidsmål — Scenario A (standard rollback)

| Delskritt | Mål | Faktisk |
|---|---|---|
| Klikk Redeploy → /health 200 | ≤ 5 min | ⏱️ \_\_\_ |
| Smoke-suite grønn | ≤ 15 min | ⏱️ \_\_\_ |
| **Total RTO** | **≤ 20 min** | ⏱️ \_\_\_ |

### 5.2 Tidsmål — Scenario D (forward-fix-cycle)

| Delskritt | Mål | Faktisk |
|---|---|---|
| Identifiser breaking migration | ≤ 10 min | ⏱️ \_\_\_ |
| Skriv + test fix-migration | ≤ 20 min | ⏱️ \_\_\_ |
| Deploy fix → live | ≤ 10 min | ⏱️ \_\_\_ |
| Smoke-suite grønn | ≤ 15 min | ⏱️ \_\_\_ |
| **Total RTO** | **≤ 60 min** | ⏱️ \_\_\_ |

### 5.3 Tidsmål — Scenario E (nuke option)

| Delskritt | Mål | Faktisk |
|---|---|---|
| Sett haller i maintenance | ≤ 1 min | ⏱️ \_\_\_ |
| Skriv minimal hot-fix | ≤ 5 min | ⏱️ \_\_\_ |
| Deploy → live | ≤ 10 min | ⏱️ \_\_\_ |
| Re-aktiver haller | ≤ 1 min | ⏱️ \_\_\_ |
| **Total RTO** | **≤ 15 min** | ⏱️ \_\_\_ |

---

## 6. Verifikasjons-sjekkliste — er rollbacken vellykket?

Drill regnes som vellykket når **alle** punkter er krysset for de scenarier som ble kjørt:

### 6.1 Standard rollback (alle drills)

- [ ] Backend `/health` returnerer 200 mot rullet-tilbake-versjon.
- [ ] `GET /api/version` returnerer forventet eldre commit-SHA.
- [ ] Login-flyt fungerer mot eldre versjon.
- [ ] `GET /api/wallet/me` returnerer korrekt data.
- [ ] Wallet-recon-job: 0 nye divergens-alerts etter rollback.
- [ ] Audit hash-chain intakt etter restart.
- [ ] Sentry exception-rate normalisert (ingen burst på rullet-tilbake-versjon).
- [ ] Standard rollback fullført innen 5 min.
- [ ] Smoke-suite grønn innen 15 min.

### 6.2 Scenario B (forward-compat) — hvis kjørt

- [ ] Ny migration applied + commit i `pgmigrations`.
- [ ] Eldre kode fungerer mot ny DB (ignorerer ny kolonne).
- [ ] `/health` 200 etter rollback.
- [ ] Cleanup-migration har droppet drill-kolonnen.

### 6.3 Scenario C (active sockets) — hvis kjørt

- [ ] Klient mistet socket innen 30 sek av rollback-trigger.
- [ ] Klient reconnected innen 90 sek.
- [ ] Game-state replay-et uten tap (samme phase, samme balls drawn).
- [ ] Ingen ticket-duplikater.

### 6.4 Scenario D (forward-fix-cycle) — hvis kjørt

- [ ] Forward-fix-migrasjon applied uten feil.
- [ ] Eldre kode fungerer mot fixed schema.
- [ ] Total RTO ≤ 60 min.
- [ ] Cleanup-migration har droppet alle drill-data.

### 6.5 Scenario E (nuke option) — hvis kjørt

- [ ] Haller satt i maintenance + status-side oppdatert.
- [ ] Hot-fix bygd og deployet innen 10 min.
- [ ] Haller re-aktivert + status-side resolved.
- [ ] Audit-trail på hot-fix-bypass dokumentert.
- [ ] Total RTO ≤ 15 min.

### 6.6 Operasjonell verifikasjon (alle drills)

- [ ] To personer var til stede under hele drill-en.
- [ ] Drill-loggen er fylt ut og lagret under `docs/operations/dr-drill-log/`.
- [ ] Eventuelle avvik fra runbooken er notert.
- [ ] Tobias har signert off på resultatet.
- [ ] Cleanup utført — ingen drill-data etterlatt i staging schema eller env.

**Hvis ÉT punkt feiler:** drill regnes som ikke-passert. Ikke godkjenn pilot-go-live før alle punkter er grønne.

---

## 7. Drill-logg-template

Kopier til `docs/operations/dr-drill-log/<YYYY-MM>-D-ROLLBACK-1.md`:

```markdown
# Drill D-ROLLBACK-1 — YYYY-MM-DD

**Drill-eier:** [navn]
**Utfører:** [navn]
**Observatør:** [navn]
**Miljø:** staging
**Render-plan:** starter / pro
**Start-tidspunkt:** YYYY-MM-DDTHH:MM:SS+02:00 (Oslo-tz)

## Pre-state

- Nåværende `Live`-deploy: commit-SHA \_\_\_, tidspunkt \_\_\_
- Rollback-mål: commit-SHA \_\_\_, tidspunkt \_\_\_
- Tid mellom: \_\_\_ timer

## Scenarier kjørt

- [ ] A — Standard rollback
- [ ] B — Forward-compat-test
- [ ] C — Active sockets reconnect
- [ ] D — Forward-fix-cycle
- [ ] E — Nuke option

## Tidslinje (Scenario A som eksempel)

| Tidspunkt (UTC) | Hendelse |
|---|---|
| HH:MM:SS | Drill startet |
| HH:MM:SS | Klikket Redeploy this version |
| HH:MM:SS | Render-deploy startet |
| HH:MM:SS | `/health` 200 på rullet-tilbake-versjon |
| HH:MM:SS | Smoke-test startet |
| HH:MM:SS | Smoke-test grønn |
| HH:MM:SS | Rullet frem til nyeste version (klargjøring for neste drill) |
| HH:MM:SS | Drill avsluttet |

## RTO-resultater (Scenario A)

| Delskritt | Mål | Faktisk |
|---|---|---|
| Klikk → /health 200 | ≤ 5 min | \_\_\_ min |
| Smoke-suite | ≤ 15 min | \_\_\_ min |
| **Total RTO** | **≤ 20 min** | \_\_\_ min |

## Verifikasjons-sjekkliste

- [ ] 6.1 Standard rollback (alle 9 punkter)
- [ ] 6.2/6.3/6.4/6.5 Scenario-spesifikk (kun hvis kjørt)
- [ ] 6.6 Operasjonell verifikasjon (alle 5 punkter)

## Drill-resultat

[ ] ✅ PASS
[ ] ⚠️ PASS WITH CAVEATS
[ ] ❌ FAIL

## Findings

(Eventuelle ting som ikke fungerte som beskrevet, overraskende oppførsel,
ting som tok lengre tid enn forventet.)

- [Finding 1]

## Action items

- [ ] Oppdater [`DRILL_ROLLBACK_2026-Q3.md`](../DRILL_ROLLBACK_2026-Q3.md) §X.Y: ...
- [ ] Linear-issue [BIN-XXX] for fix: ...

## Signatur

- Utfører: [navn] — YYYY-MM-DDTHH:MM
- Observatør: [navn] — YYYY-MM-DDTHH:MM
- Tobias: [navn] — YYYY-MM-DDTHH:MM
```

---

## 8. Eskalerings-tre

Hvis drill-en eller en faktisk rollback-hendelse avdekker problemer:

```
Rollback-funn?
   │
   ├─ Liten avvik (eks. RTO 1-2 min over mål) → Logg, juster forventning
   │
   ├─ Standard rollback fungerer ikke → Linear P1-issue, eskaler Tobias
   │                                    INNEN 1 time + utsette pilot-go-live
   │
   ├─ Eldre image er borte fra Render → Sjekk Render-retention-policy.
   │                                    Hvis >30 dager til neste deploy: vurder
   │                                    om vi trenger å pin-e en LKG-image
   │
   ├─ Forward-only migration har skapt rollback-blocker → Forward-fix-cycle (§4.5)
   │                                                       + post-mortem på hvorfor
   │                                                       breaking endring slapp gjennom
   │
   ├─ Wallet-recon viser divergens etter rollback → 🚨 P1 Lotteritilsynet-melding
   │                                                 INNEN 24t + hands-on Tobias
   │
   └─ Hot-fix måtte tas → Audit-trail i Linear + 7-dagers post-mortem
                          + review hvordan vi unngår neste gang
```

**Når går vi fra "drill" til "stopp pilot"?**

- Hvis standard rollback faktisk ikke fungerer på staging — pilot-gating brutt.
- Hvis forrige image er borte fra Render og vi ikke kan ta nuke option — pilot-gating brutt.
- Hvis forward-fix-cycle tar > 2× målet (120 min) — pilot-gating brutt; vi kan ikke tåle 2 timers nedetid pilot-dag for migration-fix.

I alle disse tilfellene: **stopp pilot-arbeidet** og varsle Tobias innen 1 time.

---

## 9. Migrasjons-asymmetri — sjekkliste FØR du deployer en migrasjon som kan gjøre rollback hardt

Bruk denne checklisten i PR-review:

- [ ] Migrasjonen er **additive** (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS` nullable, `CREATE INDEX IF NOT EXISTS`)?
- [ ] Hvis NOT NULL: er det et `DEFAULT` som gjør at eldre kode kan INSERT-e uten å sette feltet?
- [ ] Ingen `DROP COLUMN` eller `DROP TABLE` av kolonner/tabeller eldre kode bruker?
- [ ] Ingen `ALTER TYPE` med data-incompatible kast?
- [ ] Test-deployet på staging FØRST (rull frem + rull tilbake + verifiser eldre kode fortsatt fungerer)?
- [ ] Hvis migrasjonen ikke er additive — hva er rollback-strategien dokumentert i PR-en?

Hvis du svarer NEI på et av disse: PR-en skal blokkeres til migrasjonen er omskrevet additivt, eller til en eksplisitt rollback-strategi er forhandlet og dokumentert.

---

## 10. Frekvens og pilot-gating

| Når | Hva |
|---|---|
| **Per staging-deploy** | Ad-hoc Scenario A som rutinemessig røyk-test (≤ 5 min). |
| **Pre-pilot (obligatorisk)** | Full D-ROLLBACK-1 med Scenario A + B + C. Pilot-gating brutt hvis ikke passert. |
| **Kvartalsvis** | Full D-ROLLBACK-1 med alle scenarier. Roterer L2-personell. |
| **Halvårlig** | Full table-top med L3 + Tobias. Simulert P1 + alle 5 scenarier. |
| **Etter major arkitektur-endring** | Re-kjør drill mot ny arkitektur. |

### 10.1 Pilot-gating-sjekkliste (R12)

Før første hall flippes til prod:

- [ ] D-ROLLBACK-1 Scenario A utført med PASS-status, signert av Tobias.
- [ ] D-ROLLBACK-1 Scenario B utført — bevist forward-compat.
- [ ] D-ROLLBACK-1 Scenario C utført — bevist socket-reconnect under rollback.
- [ ] On-call-rotasjon trent på prosedyren (minst 2 personer har klikket Redeploy under stress).
- [ ] Pre-deploy checklist (§3.4) integrert i PR-template.
- [ ] Drill-logg lagret under `docs/operations/dr-drill-log/`.
- [ ] **Render image-retention verifisert:** vi har bekreftet at minst de siste 5 deploys er tilgjengelige på vår plan, så vi har genuine rollback-targets.

---

## 11. 🚨 Funn som må adresseres før pilot

Identifisert under skriving av drillen 2026-05-08.

### 11.1 Render image-retention er ikke verifisert

**Status:** vi vet ikke konkret hvor mange tidligere deploys Render holder tilgjengelige på `starter`-plan. Drill-en kan finne dette ut, men det er en åpen risiko.

**Verifisering:** under første drill, sjekk Render-Deploys-fanen og noter hvor mange tidligere deploys som er tilgjengelige som "Redeploy this version"-mål.

**Action:** dokumenter funnet i drill-loggen og denne docs §1.1 nedenfor hvis tallet er mindre enn forventet.

### 11.2 Pre-deploy migration-checklist ikke i PR-template

**Status:** sjekklisten i §9 finnes ikke i `.github/pull_request_template.md` per 2026-05-08.

**Action:** legg til sjekkliste-sektion "Migrasjon — rollback-trygg?" i PR-template før pilot-go-live. Estimat: 30 min.

### 11.3 Forward-only-policy + monorepo-versjons-kompatibilitet

**Status:** Forward-only-migrations er en bevisst beslutning (BIN-661, [ADR-012](../decisions/ADR-012-idempotent-migrations.md)). Konsekvensen er at hver migrasjon må være rollback-vennlig per design.

**Anbefalt før pilot:**
- Schema-CI-gate (`scripts/schema-ci/`) blir oppdatert til å sjekke at hver ny migrasjon er additive.
- Hvis ny migration ikke er additive → CI-feil + krev eksplisitt PR-comment om rollback-strategi.

**Action:** vurder om eksisterende schema-CI dekker dette. Hvis ikke: spawn separat issue.

---

## 12. Referanser

- [`DEPLOY_ROLLBACK_PROCEDURE.md`](./DEPLOY_ROLLBACK_PROCEDURE.md) — prod-rollback-runbook (faktisk hendelse)
- [`MIGRATION_DEPLOY_RUNBOOK.md`](./MIGRATION_DEPLOY_RUNBOOK.md) — migrate-feilhåndtering
- [`HOTFIX_PROCESS.md`](./HOTFIX_PROCESS.md) — kritisk fix uten review
- [`ROLLBACK_RUNBOOK.md`](./ROLLBACK_RUNBOOK.md) — hall-rollback (separat mekanisme, client-variant flag)
- [`DISASTER_RECOVERY_PLAN_2026-04-25.md`](./DISASTER_RECOVERY_PLAN_2026-04-25.md) — overordnet DR-plan
- [`E2E_SMOKE_TEST.md`](./E2E_SMOKE_TEST.md) — smoke-test-prosedyre
- [`DRILL_BACKUP_RESTORE_2026-Q3.md`](./DRILL_BACKUP_RESTORE_2026-Q3.md) — søsterdoc for backup-restore-drill
- [`LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md`](../architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md) §3.3, §3.4 R12, §6 pilot-gating
- [ADR-012 — Idempotente migrasjoner](../decisions/ADR-012-idempotent-migrations.md)
- `apps/backend/migrations/README.md` — forward-only-policy (BIN-661)
- Render docs: <https://render.com/docs/deploys>
