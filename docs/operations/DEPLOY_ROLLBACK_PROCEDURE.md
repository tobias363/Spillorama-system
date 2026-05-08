# Deploy Rollback Procedure (BIN-790 C4)

**Owner:** Technical lead (Tobias Haugen)
**Related Linear:** BIN-790 (M2 — Multi-hall-launch, Spor C — Operasjon & infrastruktur)
**Last updated:** 2026-05-08
**Audience:** L2 backend on-call, L3 incident commander, Tobias.

> Denne runbooken er for **rollback av en Render-deploy** etter at en
> ny versjon har gått live og viser seg ødelagt. For:
>
> - **Hall-spesifikk rollback** (Unity vs. web-klient flag) — bruk
>   [`ROLLBACK_RUNBOOK.md`](./ROLLBACK_RUNBOOK.md).
> - **Migration-feil under deploy** (bygg som aldri lykkes) — bruk
>   [`MIGRATION_DEPLOY_RUNBOOK.md`](./MIGRATION_DEPLOY_RUNBOOK.md).
> - **Hot-fix uten full review** — bruk [`HOTFIX_PROCESS.md`](./HOTFIX_PROCESS.md).

---

## 1. Trigger

Følgende skal trigge en deploy-rollback-vurdering:

- **P1 etter deploy** — Sentry exception-burst, `/health` 5xx, eller
  ledger-skriv feiler innenfor 30 min etter ny versjon gikk live.
- **Compliance-regresjon** — wallet-balanser regnes feil, KYC-gate
  omgås, ekstra-draw-denial logges ikke, eller obligatorisk pause-flow
  bryter.
- **Stort funksjonalitets-bortfall** — hovedflyter (login, kjøpe-bong,
  starte-runde) feiler i staging-smoke etter promote, eller raskt etter
  prod-deploy.
- **TV-skjerm / agent-portal-rendering broken** — UI-regresjon som gjør
  pilot-haller ubrukelige.
- **Tobias eller L3 ber om rollback** etter post-deploy-monitoring.

### 1.1 Når IKKE rollback?

- Migration har feilet **i build** — ny versjon er aldri live, ingenting
  å rollback. Se [`MIGRATION_DEPLOY_RUNBOOK.md`](./MIGRATION_DEPLOY_RUNBOOK.md) §2.
- Build pågår fortsatt — vent. Render commit-er ikke før build er
  ferdig + helsesjekk grønn.
- Hendelsen er ikke deploy-relatert — sjekk om den nylig deployet
  versjonen faktisk endret koden i feil-pathen. Bruk
  [`LIVE_ROOM_DR_RUNBOOK.md`](./LIVE_ROOM_DR_RUNBOOK.md) først.

---

## 2. Detection

| Signal | Kilde | Når trigger |
|---|---|---|
| Sentry exception-burst etter deploy | Sentry → "Issues" filtrert på `release:<commit-sha>` | > 10 nye exceptions/min |
| `/health` 5xx | Render uptime probe | 5xx-svar > 30 sek |
| Compliance-test failer i staging-smoke | CI staging-pipeline | Smoke-step rød |
| Hall-eier ringer L1 om "alle terminaler henger" | Hall-vakt | Timing korrelerer med deploy |
| Wallet-balanse-mismatch | Nightly recon-job | Divergens dukker opp dagen etter deploy |

---

## 3. Severity-vurdering

Bruk [`INCIDENT_RESPONSE_PLAN.md`](./INCIDENT_RESPONSE_PLAN.md) §1
severity-matrise. For deploy-rollback:

| Symptom | Severity | Beslutning |
|---|---|---|
| Pengetap eller compliance-brudd bekreftet | P1 | Rollback umiddelbart, krever 2 av (L3, Tobias) |
| Live-rom fryst i flere haller | P1 | Rollback innen 5 min, L2 kan starte alene |
| Ny feature delvis broken, ikke kritisk vei | P2 | Roll fram-fix preferert; vurder rollback om > 30 min |
| Cosmetic regresjon i admin-UI | P3 | Ingen rollback, forward-fix |

### 3.1 Beslutningsmatrise

```
Er hendelsen reproduserbar med pre-deploy versjon?
   │
   ├─ Ja → ikke deploy-relatert, ikke rollback
   │
   └─ Nei → deploy introduserte feilen
              │
              ▼
       Påvirker pengeflyt eller compliance?
              │
              ├─ Ja → P1, rollback NÅ
              │
              └─ Nei → er pilot-haller berørt?
                          │
                          ├─ Ja → P2, rollback innen 30 min
                          │
                          └─ Nei → forward-fix
```

---

## 4. Mitigation — Render-dashboard rollback

### 4.1 Standard rollback (5 min)

Render bygger ikke på nytt — det restarter forrige image, så `migrate`
kjører **ikke** på rollback. DB-en blir værende på den nyere
migrate-tilstanden, som er trygt så lenge migrasjonene er additive
(per [`MIGRATION_DEPLOY_RUNBOOK.md`](./MIGRATION_DEPLOY_RUNBOOK.md) §5
sjekkliste).

Steg-for-steg:

1. **Logg inn på Render dashboard:** https://dashboard.render.com/
2. Velg `spillorama-system`-tjenesten.
3. Gå til **Deploys**-fanen.
4. Finn den siste vellykkede `Live`-deploy **før** den ødelagte (typisk merket med commit-SHA og tidspunkt).
5. Klikk på **... (3 prikker)** → **Redeploy this version**.
6. Bekreft "Yes, redeploy" i confirmation-dialog.
7. Vent 2–3 minutter på at containeren starter og `/health` returnerer 200.

```bash
# Verifiser fra terminal:
curl -fsS https://api.spillorama.no/health | jq .
# Forventet: {"ok":true,"status":"healthy",...}

# Verifiser commit-SHA:
curl -fsS https://api.spillorama.no/api/version | jq .
# Eller: Render-dashboard → service → Live commit-SHA
```

### 4.2 Hva skjer med pågående runder?

- **Klienter mister socket-tilkobling** under restart — typisk 30–90 sek.
- Boot-recovery i ny (gammel) versjon hydrerer engine-state fra Postgres-
  checkpoint (BIN-245).
- Aktive runder i `running`-status settes til `paused` av BIN-695
  auto-pause-on-phase. Master må manuelt klikke Resume.
- Wallet-reservasjoner (`bet:arm`-state) i Redis kan tapes hvis Redis
  også ble berørt — se [`REDIS_FAILOVER_PROCEDURE.md`](./REDIS_FAILOVER_PROCEDURE.md).

Følg verifikasjons-tabellen i
[`LIVE_ROOM_DR_RUNBOOK.md`](./LIVE_ROOM_DR_RUNBOOK.md) §3.5 etter rollback.

### 4.3 Hvorfor IKKE bruke "Manual Deploy" → "Restart" først

Det restarter samme image (= ødelagte versjon). Du vil bare se feilen
igjen. Bruk Redeploy this version på en **eldre** deploy-rad.

### 4.4 Hvis rollback-redeploy også feiler

Mest sannsynlig årsaker:

1. **Forrige image er slettet fra Render-cache** (sjelden, men har skjedd
   etter > 30 dagers inaktivitet). Se §6 nuke-option.
2. **DB-skjemaet er nå inkompatibelt med eldre kode** fordi en migrasjon
   la til en NOT NULL-kolonne uten default. Se §5 om
   forward-fix-strategi.
3. **Env-vars er endret** mellom forrige og nåværende deploy. Sammenlign
   `Environment` i Render-dashboard.

---

## 5. DB-migrations og rollback — viktig tilfellestruktur

`render.yaml` `buildCommand` kjører `npm run migrate` som del av
build. Det betyr:

- **Migrate kjører kun ved ny deploy** (ny build).
- **Rollback (Redeploy this version) kjører IKKE migrate.**
- DB-en er på den nyeste tilstanden uavhengig av om appen rulles tilbake.

### 5.1 Hvorfor dette vanligvis er trygt

Per [`MIGRATION_DEPLOY_RUNBOOK.md`](./MIGRATION_DEPLOY_RUNBOOK.md) §5,
nye migrasjoner skal være **additive** (CREATE TABLE IF NOT EXISTS,
ADD COLUMN IF NOT EXISTS, ADD INDEX). Eldre kode ignorerer nye kolonner
og fortsetter å virke.

### 5.2 Når dette IKKE er trygt

Hvis siste deploy inneholder:

- **Kolonne med NOT NULL og uten default** lagt til en kolonne eldre
  kode skriver til (uten å sette feltet) → INSERT failer.
- **Drop av en kolonne eller tabell** eldre kode leser fra → SELECT
  failer.
- **Endring av enum-verdi** eldre kode forventer.

I disse tilfellene er **rollback alene utilstrekkelig**. Du må:

1. Rollback (få trafikken stabil først).
2. Identifiser hvilken migration som introduserte breaking-change.
3. Skriv revers-migration som gjør endringen kompatibel (eks. fjern NOT
   NULL, gi default, restore tabell).
4. Test på staging.
5. Rull fram igjen med fix.

**Linear:** Skriv hendelsen som "Migration kunne ikke rolles tilbake"
og spawn follow-up-issue for forward-fix.

---

## 6. Nuke option — full forward-fix når rollback ikke kan

Hvis rollback ikke fungerer (forrige image slettet, eller DB
inkompatibel), og hendelsen er P1:

1. **Sett alle haller i maintenance:**
   ```sql
   UPDATE app_halls SET is_active = false;
   ```
2. **Status-side:** publiser `critical` incident per
   [`STATUS_PAGE.md`](./STATUS_PAGE.md).
3. **Hall-eier-varsling** per [`INCIDENT_RESPONSE_PLAN.md`](./INCIDENT_RESPONSE_PLAN.md) §6.1.
4. **Hot-fix-flow** per [`HOTFIX_PROCESS.md`](./HOTFIX_PROCESS.md):
   - Identifiser minimal patch.
   - Branch + commit + skip review (audit-loggført).
   - Render auto-deploy.
   - Verifiser i staging først hvis tid tillater (typisk 5–15 min).
5. **Når deploy lykkes:** sett haller `is_active=true` igjen, oppdater
   incident til `monitoring` eller `resolved`.

---

## 7. Verification

Etter rollback:

| Sjekk | Kommando | Forventet |
|---|---|---|
| Backend lever | `curl /health` | `{"ok":true,...}` |
| Commit-SHA er forventet | `curl /api/version` eller Render-dashboard | Forrige commit, ikke ny |
| Sentry exception-rate normalisert | Sentry filter `release:<old-sha>` siste 5 min | < 1/min, samme baseline som før deploy |
| Klienter reconnected | Grafana `bingo_socket_connections` | Tilbake til pre-rollback-nivå innen 2 min |
| Aktive runder fortsetter | Manuell hall-sjekk | Master ser Resume-knapp |
| Migration-tabell konsistent | `SELECT name FROM pgmigrations ORDER BY run_on DESC LIMIT 5;` | Siste rad matcher det vi forventer |
| Compliance-ledger ingen duplikater | `SELECT idempotency_key, COUNT(*) FROM compliance_ledger WHERE created_at > NOW() - INTERVAL '1 hour' GROUP BY 1 HAVING COUNT(*) > 1;` | 0 rader |
| Wallet-balanser konsistent | Trigger en ekstra `WalletReconciliationService.runOnce()` via admin-endpoint | Ingen nye divergens-alerts |

### 7.1 Lengre sjekk (innen 30 min etter rollback)

- [ ] Hall-eiere bekrefter at deres terminaler fungerer normalt.
- [ ] Game1 / Game2 / Game3 lobby viser aktive scheduled games.
- [ ] Login-flyten fungerer (testbruker via staging-mirror).
- [ ] Wallet-topup-flyten fungerer (sandbox-test).
- [ ] Status-side oppdatert til `operational`.

---

## 8. Communication

### 8.1 Under rollback

```
:rotating_light: SEV-1/2 | Deploy rollback i gang | [hh:mm]

Kode-rev: [ny-sha] -> [forrige-sha] (rollback til [dato])
Begrunnelse: [én setning, eks. "Sentry exception-burst på wallet-skriv"]
Forventet løsning: 5 min
Eier: @[L2-vakt]

Live-tråd: :thread:
```

### 8.2 Etter rollback

```
:white_check_mark: Rollback fullført

Versjon: [forrige-sha] live på prod
Total nedetid: [X] min
Klienter reconnected: [hh:mm]

Forward-fix-issue: [BIN-XXX]
Post-mortem: [dato innen 7 dager]
```

### 8.3 Hall-eier — bruk template fra [`INCIDENT_RESPONSE_PLAN.md`](./INCIDENT_RESPONSE_PLAN.md) §6.1

### 8.4 Spillere — banner i klient via status-side

`UPDATE app_status_incidents SET status='resolved', resolved_at=NOW()
WHERE id='<incident-id>';` etter at rollback er bekreftet stabil.

---

## 9. Post-mortem

Alle deploy-rollbacks krever post-mortem per
[`INCIDENT_RESPONSE_PLAN.md`](./INCIDENT_RESPONSE_PLAN.md) §7.

Spesifikke spørsmål for deploy-rollback:

1. **Hvorfor fanget ikke staging-smoke-testen feilen?**
2. **Manglet det pre-deploy-sjekk for denne kategorien feil?**
3. **Var migration kompatibel med rollback-versjon?**
4. **Hvor lang tid fra første alarm til rollback-beslutning?**
5. **Burde vi ha holdt deploy-vinduet utenom åpningstid?**

Action items skal inkludere:

- Ny test som ville fanget feilen.
- Pre-deploy checklist-oppdatering.
- Eventuelt deploy-blackout-vindu (hvis hendelsen var åpningstid).

---

## 10. Pre-deploy checklist

For å redusere sannsynligheten for rollback:

- [ ] CI grønn (TypeScript check, unit tests, compliance suite).
- [ ] Staging-smoke kjørt og grønn ([`E2E_SMOKE_TEST.md`](./E2E_SMOKE_TEST.md)).
- [ ] Migration-rekkefølge sanity-check ([`MIGRATION_DEPLOY_RUNBOOK.md`](./MIGRATION_DEPLOY_RUNBOOK.md) §5).
- [ ] Migrasjon er additive (kan rolles tilbake uten breaking).
- [ ] Ingen aktive haller midt i runde (sjekk via SQL).
- [ ] Deploy utenom høy-trafikk-vindu (10:00–22:00 lokal er åpningstid for piloten).
- [ ] L2 backend on-call tilgjengelig de neste 30 min.
- [ ] Slack `#ops-cutover` informert.

### 10.1 Deploy-blackout-vinduer

> **Status 2026-05-08:** Ikke ennå formalisert. Forslag fra
> [`DISASTER_RECOVERY_PLAN_2026-04-25.md`](./DISASTER_RECOVERY_PLAN_2026-04-25.md) §11
> tiltak #4: ingen deploy under 10:00–22:00 lokal mens haller er åpne.
> Tobias avgjør pre-pilot.

---

## 11. Drill-anbefaling

| Drill | Frekvens | Eier | Pre-pilot |
|---|---|---|---|
| Roll back til forrige image i staging | Per deploy | L2 backend | ✅ Anbefalt |
| Roll back når DB er forward-migrert (skjerpet test) | Kvartalsvis | L2 backend + Tobias | Optional |
| Rollback under aktivt belastet staging | Halvårlig | L2 backend | Optional |

### 11.1 Standard drill (15 min)

1. Deploy en ufarlig staging-endring (eks. en kommentar-endring som
   trigger ny build).
2. Vent til Live = ny commit.
3. Følg §4.1 prosedyre — Redeploy forrige version.
4. Mål tid fra "klikk Redeploy" til "/health 200".
5. Verifiser per §7-tabellen.
6. Logg i `docs/operations/dr-drill-log/`.

**Suksesskriterier:**
- ✅ Rollback fullført innen 5 min.
- ✅ /health grønn etter rollback.
- ✅ Ingen Sentry-burst.

---

## 12. Eierskap

| Rolle | Ansvar |
|---|---|
| L2 backend on-call | Eier rollback-execution-prosedyre |
| L3 incident commander | Eier go-no-go-beslutningen |
| Tobias | Eier endelig myndighet for global rollback |
| DevOps / CI-vakt | Eier pre-deploy checklist + staging-smoke |

---

## 13. Referanser

- [`INCIDENT_RESPONSE_PLAN.md`](./INCIDENT_RESPONSE_PLAN.md) — overordnet incident-flow
- [`MIGRATION_DEPLOY_RUNBOOK.md`](./MIGRATION_DEPLOY_RUNBOOK.md) — migrate-feil-håndtering
- [`HOTFIX_PROCESS.md`](./HOTFIX_PROCESS.md) — kritisk fix uten review
- [`ROLLBACK_RUNBOOK.md`](./ROLLBACK_RUNBOOK.md) — hall-rollback (separat mekanisme)
- [`LIVE_ROOM_DR_RUNBOOK.md`](./LIVE_ROOM_DR_RUNBOOK.md) — rom-recovery etter restart
- [`E2E_SMOKE_TEST.md`](./E2E_SMOKE_TEST.md) — pre-promote smoke
- [`DISASTER_RECOVERY_PLAN_2026-04-25.md`](./DISASTER_RECOVERY_PLAN_2026-04-25.md) §3 — backend-recovery
- `render.yaml` — `buildCommand`
