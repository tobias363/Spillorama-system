# Emergency Runbook — "Tobias er utilgjengelig + noe brenner"

**Sist oppdatert:** 2026-05-10
**Eier:** Tobias Haugen
**Formål:** Ett dokument du kan åpne under press når du IKKE har tid til å
lete. Forutsetter at du er PM eller agent uten Tobias-tilgang i øyeblikket.

> **DETTE DOKUMENTET ER LAGET FOR Å BLI LEST UNDER STRESS.** Det er kortere
> enn du tror er nødvendig. Følg trinnene i rekkefølge. Ikke improviser.
> Hvis du må improvisere — dokumenter etterpå i [`docs/postmortems/`](../postmortems/).

---

## Først: Er det egentlig en emergency?

Sjekk på 30 sekunder:

| Symptom | Severity | Handling |
|---|---|---|
| Prod 502/503 i >2 min | P1 | Følg "P1 — Prod nede" under |
| Spillere kan ikke logge inn | P1 | Følg "P1 — Prod nede" |
| Wallet-balanse vises feil | P1 | Følg "P1 — Wallet/payout-feil" |
| Compliance-feil (limit ikke håndhevet, audit-trail mangler) | P1 | Følg "P1 — Compliance-incident" |
| Spill 1/2/3 henger ikke gir nye trekninger | P1 | Følg "P1 — Live-rom henger" |
| Sikkerhets-incident (mistanke om bryt-inn, datalekkasje) | P1 | Følg "P1 — Sikkerhets-incident" |
| Én hall opplever bug, andre fungerer | P2 | Logg, fortsett. Ikke emergency. |
| Admin-portal er treg | P2-P3 | Logg, sjekk Render-dashbord. |
| Du er usikker | Anta P2 | Eskaler hvis utvikles |

**P1 = aktiv kunde-impact i prod. Alt annet er ikke emergency.**

---

## Eskalerings-rekkefølge når Tobias er utilgjengelig

1. **Forsøk Tobias først, men gi det maks 5 minutter:**
   - SMS: _<Tobias' nummer her — fyll inn>_
   - Telefon: _<>_
   - Hvis ikke svar innen 5 min for P1: gå videre

2. **For P1-incidents — du har autonomi til:**
   - Trigger rollback via Render dashboard
   - Stenge problematic endpoint via feature-flag
   - Kommunisere til pilot-haller at "vi har en feil, jobber med saken"
   - Utløse stuck-room-cleanup via admin-endpoint

3. **Du har IKKE autonomi til:**
   - Endre compliance-regler / pengespillforskriften-tolkning
   - Rapportere til Lotteritilsynet (vent på Tobias eller følg COMPLIANCE_INCIDENT_PROCEDURE)
   - Endre vendor-avtaler
   - Refunde spillere utenfor normal flow
   - Tildele/revokere admin-tilganger

4. **Etter incident er stabilisert:**
   - Skriv kort status-oppdatering for Tobias (selv om du ikke har fått tak i ham)
   - Innen 48t: skriv postmortem i `docs/postmortems/`
   - Oppdater `RISKS.md` hvis nytt risiko-mønster

---

## P1-prosedyrer

### P1 — Prod nede (502/503, ingen logger inn)

```bash
# 1. Verifiser at det faktisk er nede (ikke bare DNS-cache)
curl -I https://spillorama-system.onrender.com/health
# Forventet: 200 OK + JSON med status-fields

# 2. Sjekk Render-dashbord
open https://dashboard.render.com/
# Se etter: deploy-status (failed deploy?), service health, instance state
```

**Hvis recent deploy feilet:**
1. Gå til service → Deploys
2. Klikk "Rollback" på siste kjente gode deploy (status: green)
3. Vent 2-3 min, verifiser `curl -I /health` returnerer 200
4. Notify pilot-haller hvis nedetiden var >5 min

**Hvis service kjører men ikke svarer:**
1. Sjekk Logs i Render dashboard for stack traces
2. Hvis cold-boot: vent 60s, prøv `curl /health` igjen
3. Hvis fortsatt ikke svar: trigger restart fra Render dashboard
4. Hvis fortsatt feil etter restart: rollback til forrige deploy

**Hvis Render selv er nede:**
- Sjekk https://status.render.com
- Vent på Render — vi har ikke multi-region failover (R-003)
- Kommuniser til pilot-haller at vendor-utfall pågår

Detaljer: [`ROLLBACK_RUNBOOK.md`](./ROLLBACK_RUNBOOK.md), [`DISASTER_RECOVERY_PLAN_2026-04-25.md`](./DISASTER_RECOVERY_PLAN_2026-04-25.md).

### P1 — Wallet/payout-feil

**Symptomer:** Spiller-balanse feil, dobbel-payout, manglende payout, transaksjon henger.

```bash
# 1. STOPP umiddelbart videre payouts hvis du ser dobbel-payout-mønster
# Bruk admin-endpoint (krever Render-API tilgang for env-flag):
# Sett FREEZE_PAYOUTS=true i Render env-vars (eller via admin UI hvis bygget)
```

**Forbudt under wallet-incident:**
- ❌ Manuell DB-edit av app_wallet_balances
- ❌ Manuell payout via admin-portal "for å fikse"
- ❌ Refund uten å forstå rotårsaken

**Tillatt:**
- ✅ Read-only queries for å forstå omfang (les `WALLET_RECONCILIATION_RUNBOOK.md`)
- ✅ Stenge betaling-endpoints via feature-flag
- ✅ Kommunisere til hall-operatører at "betalinger pauset midlertidig"

**Eskalering:**
- Tobias (P1 = wallet er regulatorisk + finansiell)
- Hvis ikke svar innen 15 min: skriv detaljert status til Tobias' SMS+e-post med:
  - Antall berørte spillere (estimert)
  - Antall berørte transaksjoner
  - Hva er stoppet
  - Hva er gjort

Detaljer: [`WALLET_RECONCILIATION_RUNBOOK.md`](./WALLET_RECONCILIATION_RUNBOOK.md), skill `wallet-outbox-pattern`.

### P1 — Live-rom henger (Spill 1/2/3 gir ikke trekninger)

**Sjekk hvilket spill:**
```bash
for slug in spill1 spill2 spill3; do
  echo "=== $slug ==="
  curl -s "https://spillorama-system.onrender.com/api/games/$slug/health?hallId=demo-hall-001"
  echo
done
```

**Hvis Spill 2 eller Spill 3 henger:**
- ETT globalt rom — alle haller er nede samtidig
- Restart via Render → service restart (siste utvei, mister state)
- Eller bruk admin clear-stuck-room-endpoint (mindre destruktivt)

**Hvis Spill 1 henger i én hall:**
- Per-hall lobby — andre haller uberørt
- Bruk admin clear-stuck-room for den ene hallen
- Verifiser plan-runtime-status i admin-ops-konsoll

Detaljer: skill `live-room-robusthet-mandate`.

### P1 — Compliance-incident

**Eksempler:** Limit ikke håndhevet, audit-trail-hash brutt, §11-rapport feil,
self-exclusion ikke respektert.

**Følg eksisterende prosedyre:** [`COMPLIANCE_INCIDENT_PROCEDURE.md`](./COMPLIANCE_INCIDENT_PROCEDURE.md).

**Tillegg når Tobias ikke svarer:**
- DOKUMENTER alt — ta skjermbilder, lagre logs, eksporter relevante DB-rader
- IKKE rapporter til Lotteritilsynet uten Tobias-godkjennelse (med mindre §-frist
  utløper innen vinduet du klarer å nå Tobias — i så fall: følg prosedyrens
  default-rapporterings-mal og marker "rapportert uten Tobias-godkjennelse,
  PM-fallback")
- Kontakt Datatilsynet kun ved verifisert PII-lekkasje

### P1 — Sikkerhets-incident

Følg [`SECURITY.md`](../../SECURITY.md) + `docs/audit/SECURITY_AUDIT_2026-04-28.md`
for kontekst.

**Umiddelbart:**
1. Identifiser blast radius — hvilke konti/data berørt?
2. Roter ALLE potensielt berørte credentials (Render API, JWT_SECRET, SESSION_SECRET, BankID, Swedbank Pay)
3. Force-logout alle aktive sessions (admin-endpoint)
4. Skru av berørt funksjonalitet via feature-flag
5. Bevar logs (Render har 7 dagers logging-retention — eksporter umiddelbart hvis lenger horisont kreves)

**Eskalering:** Tobias + sikkerhetskontakt (se [`STAKEHOLDERS.md`](./STAKEHOLDERS.md))

---

## Tilgangs-checklist (verifiser FØR du trenger det)

Sjekk hver måned at du har disse tilgangene:

- [ ] Render dashboard-login virker (https://dashboard.render.com)
- [ ] Render API key i `secrets/render-api.local.md` — test med:
  ```bash
  curl -H "Authorization: Bearer $(grep -A1 'API Key:' secrets/render-api.local.md | tail -1 | tr -d ' ')" https://api.render.com/v1/services | jq '.[0].service.name'
  ```
- [ ] GitHub PAT virker — test med `gh auth status`
- [ ] Linear MCP virker — sjekk i Cowork at du kan liste BIN-issues
- [ ] Postgres prod-tilgang (read-only) — test fra Render Shell
- [ ] Tobias' SMS-/telefon-nummer ligger i `STAKEHOLDERS.md`

Hvis NOEN av disse mangler — fix det IKKE under en P1. Eskaler til Tobias og logg som RISKS.md-entry post-incident.

---

## Standard kommandoer du sannsynligvis trenger

### Health-check

```bash
curl -I https://spillorama-system.onrender.com/health
```

### Spill-helse per slug

```bash
curl -s "https://spillorama-system.onrender.com/api/games/spill1/health?hallId=<hall-id>" | jq
```

### Render service-list

```bash
export RENDER_API_KEY=$(grep -A1 "API Key:" secrets/render-api.local.md | tail -1 | tr -d ' ')
curl -s -H "Authorization: Bearer $RENDER_API_KEY" https://api.render.com/v1/services | jq '.[].service | {name, id, type, status}'
```

### Trigger Render rollback (last good deploy)

```bash
SERVICE_ID=<srv-...>  # se VENDORS.md eller dashboard
curl -s -H "Authorization: Bearer $RENDER_API_KEY" \
  "https://api.render.com/v1/services/$SERVICE_ID/deploys?limit=5" | \
  jq '.[].deploy | {id, status, createdAt, commit: .commit.message}'

DEPLOY_ID=<dep-...>
curl -X POST -H "Authorization: Bearer $RENDER_API_KEY" \
  "https://api.render.com/v1/services/$SERVICE_ID/rollback" \
  -d "{\"deployId\":\"$DEPLOY_ID\"}"
```

---

## Etter incident er over

1. **Send status til Tobias** (selv om du ikke fikk tak i ham under):
   ```
   P1 incident YYYY-MM-DD HH:MM-HH:MM
   - Symptom: <kort>
   - Kunde-impact: <antall berørt>
   - Mitigasjon: <hva ble gjort>
   - Status: <løst / overvåker>
   - PM-handling: <hva du gjorde>
   - Postmortem: planlagt innen 48t
   ```

2. **Innen 48 timer: skriv postmortem** i `docs/postmortems/YYYY-MM-DD-<navn>.md`
   med malen i `_TEMPLATE.md`.

3. **Oppdater [`RISKS.md`](../RISKS.md)** hvis incidenten avdekker ny risiko
   eller materialiserer eksisterende.

4. **Hvis emergency-runbook hadde hull** — oppdater denne filen.
   Hver hull du fant er gull for neste PM.

---

## Anti-mønstre under emergency

- ❌ Improvisere uten å lese eksisterende runbook
- ❌ Manuell DB-edit "for å fikse raskt"
- ❌ Tildele tilganger til andre under press (vent til etter)
- ❌ Kommunisere til kunder uten Tobias-godkjennelse på melding-tekst (gi vag status, hold detaljer)
- ❌ Lukke incident før postmortem er planlagt
- ❌ Anta at "det fikset seg selv" — sjekk logs og data
- ❌ La være å skrive postmortem fordi "vi vet jo hva som skjedde"

---

**Se også:**
- [`INCIDENT_RESPONSE_PLAN.md`](./INCIDENT_RESPONSE_PLAN.md) — full P1/P2/P3-matrise
- [`DISASTER_RECOVERY_PLAN_2026-04-25.md`](./DISASTER_RECOVERY_PLAN_2026-04-25.md) — DR med RPO/RTO
- [`ROLLBACK_RUNBOOK.md`](./ROLLBACK_RUNBOOK.md) — detaljert rollback
- [`COMPLIANCE_INCIDENT_PROCEDURE.md`](./COMPLIANCE_INCIDENT_PROCEDURE.md) — compliance-spesifikk
- [`WALLET_RECONCILIATION_RUNBOOK.md`](./WALLET_RECONCILIATION_RUNBOOK.md) — wallet-debugging
- [`STAKEHOLDERS.md`](./STAKEHOLDERS.md) — kontaktinfo (Tobias' nummer ligger der)
- [`docs/postmortems/_TEMPLATE.md`](../postmortems/_TEMPLATE.md) — postmortem-mal
