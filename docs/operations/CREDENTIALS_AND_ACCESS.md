# Credentials & Access — hvor alle nøkler ligger

**Sist oppdatert:** 2026-05-15
**Eier:** Tobias Haugen
**Status:** Aktiv

> **Til ny PM:** Dette dokumentet forteller deg **hvor** du finner hver
> credential — ikke selve nøkkelen. Selve nøklene er i `secrets/*.local.md`
> (gitignored) eller i Tobias' password manager. Hvis du mangler en, spør
> Tobias.
>
> **Dette dokumentet skal aldri inneholde selve nøklene. Ingen unntak.**

---

## Oversikt — hvilke credentials finnes

| # | Credential | Lever | Bruker | Roteres |
|---|---|---|---|---|
| 1 | Render API key | `secrets/render-api.local.md` | PM ops, deploy-scripts | 6 mnd / PM-bytte |
| 2 | Linear API key | `secrets/linear-api.local.md` (eller MCP) | PM ops | PM-bytte |
| 3 | Backend `.env` (prod) | Render dashboard env-vars | Backend-runtime | Hver verdi har egen rotasjon |
| 4 | Backend `.env` (lokal) | `apps/backend/.env` (gitignored) | Lokal dev | Når roller endres |
| 5 | Postgres prod-passord | Render-managed (auto-roteres) | Backend-runtime | Render-håndtert |
| 6 | Redis prod-passord | Render-managed | Backend-runtime | Render-håndtert |
| 7 | JWT_SECRET / SESSION_SECRET | Render env-var (prod) / `.env` (lokal) | Backend-runtime | 6 mnd anbefalt |
| 8 | Swedbank Pay API token | Render env-var (prod) / Tobias 1Password | Backend wallet | Per Swedbank-policy |
| 9 | BankID-config | Render env-var / Tobias 1Password | Backend KYC | Per BankID-policy |
| 10 | GitHub PAT (CI / agents) | GitHub Actions secrets / Tobias 1Password | CI workflows | 90 dager |
| 11 | Sentry DSN | Render env-var | Backend observability | Per Sentry |
| 12 | SMTP (Postmark/SendGrid) | Render env-var | E-post-utsendelse | Per leverandør |

---

## Per credential

### 1. Render API key

**Hva:** Admin-API for Render-services (deploy, env-vars, logs).
**Hvor:** [`secrets/render-api.local.md`](../../secrets/render-api.local.md) lokalt.
Kanonisk kilde: Tobias' password manager → "Spillorama Render API".
**Bruk:** Manuell ops, deploy-scripts, env-var-mgmt. Backend bruker den ikke.
**Operasjoner:** Se [`RENDER_ENV_VAR_RUNBOOK.md`](./RENDER_ENV_VAR_RUNBOOK.md).
**Rotering:** Hver 6. måned eller ved PM-bytte. Se template-fil for prosedyre.

### 2. Linear API key

**Hva:** Personal API token for Linear-workspace "Bingosystem".
**Foretrukket:** Bruk Linear MCP hvis tilgjengelig — da trengs ikke nøkkelen.
**Hvor (hvis MCP ikke er satt opp):** [`secrets/linear-api.local.md`](../../secrets/linear-api.local.md)
**Hver PM har egen nøkkel** — ikke delt. Ved PM-bytte: gammel nøkkel revokes, ny PM genererer egen.

### 3-12. Render-managed env-vars

**Hva:** Alle backend-runtime-credentials.
**Kanonisk kilde:** Render dashboard → Service → Environment.
**Lokal kopi (dev):** `apps/backend/.env` (gitignored, fra `.env.example`).
**Aldri:** Lim inn prod-credentials i lokal `.env` med mindre du eksplisitt
debugger prod-data — og slett umiddelbart etterpå.

**Endring:** Aldri PUT direkte mot Render API. Følg `RENDER_ENV_VAR_RUNBOOK.md`
(de 5 fatale feilene står der).

---

## Credential-tilgangsmatrise — hvem har nøkler

Dette er kun credential-matrisen. For GitHub-roller, approval-regler,
bypass-labels, hotfix-autoritet og access-review, se
[`ACCESS_APPROVAL_MATRIX.md`](./ACCESS_APPROVAL_MATRIX.md).

| Credential | Tobias | PM (deg) | Agenter | CI |
|---|---|---|---|---|
| Render API key | ✅ Eier | ✅ Read+write | ❌ | ✅ (deploy-workflows) |
| Linear API key | ✅ | ✅ (egen) | ⚠️ Kun via MCP | ❌ |
| Backend .env (prod) | ✅ | ⚠️ Read-only via Render | ❌ | ✅ Render-injected |
| GitHub PAT | ✅ | ✅ (egen) | ❌ | ✅ (Actions) |
| 1Password vault | ✅ | ⚠️ Delt-tilgang ved trening | ❌ | ❌ |

---

## Onboarding-checklist (ny PM)

Når du starter:

- [ ] Tobias har gitt deg tilgang til Render dashboard (hvis aktuelt)
- [ ] Tobias har delt Render API key med deg via sikker kanal (1Password share, ikke chat)
- [ ] Du har kopiert nøkkelen til `secrets/render-api.local.md` lokalt
- [ ] Du har generert egen Linear API key (eller MCP er satt opp)
- [ ] Du har generert egen GitHub PAT med rett scope
- [ ] Du har testet at credentials fungerer:
  ```bash
  source secrets/load-env.sh.local 2>/dev/null
  curl -H "Authorization: Bearer $RENDER_API_KEY" https://api.render.com/v1/services | jq '.[0].service.name'
  # Skal returnere "spillorama-system" eller tilsvarende
  ```

## Offboarding-checklist (PM-bytte)

Når PM slutter eller bytter:

- [ ] Tobias roter Render API key (eller revokes gammel + genererer ny)
- [ ] Forrige PM revoker sin Linear API key
- [ ] Forrige PM revoker sin GitHub PAT
- [ ] Slett `secrets/*.local.md` fra forrige PMs maskin (de er aldri committet, men sjekk uansett)
- [ ] Oppdater `Sist rotert`-feltet i denne filen
- [ ] Hvis tilgang via 1Password vault var delt, fjern delingen

---

## Sikkerhetsregler

1. **ALDRI lim inn credentials i denne filen.** Den er committet til git og synlig i alle clones.
2. **ALDRI lim inn credentials i Linear/GitHub Issues/Slack/Cowork-chat.**
3. **ALLTID bruk `secrets/*.local.md`** for lokale credentials.
4. **VED LEKKASJE:** Roter umiddelbart, skriv postmortem i `docs/postmortems/`,
   sjekk audit logs for uautorisert aktivitet.
5. **VED PM-BYTTE:** Følg offboarding-checklist over.

---

## Hvis Render lanserer offisiell MCP

Per 2026-05-10 finnes ingen Render MCP. Når den lanseres:

1. Koble den i Cowork/Claude MCP-registry
2. Marker `secrets/render-api.local.md` som DEPRECATED
3. Oppdater rad 1 i tabellen øverst
4. Skriv ADR for migrasjonen hvis den endrer ops-flyt

Det samme gjelder Swedbank Pay, BankID, Sentry, SMTP — alle er kandidater for
MCP-konsumpsjon. Følg utviklingen i [Anthropic MCP-katalog](https://docs.anthropic.com/en/docs/mcp).

---

**Se også:**
- [`secrets/README.md`](../../secrets/README.md) — `secrets/`-mappens system
- [`docs/operations/RENDER_ENV_VAR_RUNBOOK.md`](./RENDER_ENV_VAR_RUNBOOK.md) — env-var-operasjoner
- [`docs/operations/RENDER_GITHUB_SETUP.md`](./RENDER_GITHUB_SETUP.md) — GitHub-integrasjon
- [`docs/operations/ACCESS_APPROVAL_MATRIX.md`](./ACCESS_APPROVAL_MATRIX.md) — GitHub/deploy/approval/bypass-roller
- [`SECURITY.md`](../../SECURITY.md) — sikkerhetspolicy og sårbarhetsmelding
