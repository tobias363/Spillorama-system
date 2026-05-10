# Render API — credentials template

**Kopier denne til `render-api.local.md` og lim inn nøkkelen.**
**`render-api.local.md` er auto-ignorert av git.**

---

## Tilgang

**Hva:** Render.com API key for Spillorama-services
**Tilgang via:** https://dashboard.render.com/account/api-keys
**Eier:** Tobias Haugen (eneste konto med admin-tilgang per 2026-05-10)
**Scope:** Full API-tilgang (read + write + deploy)

---

## API Key

```
<LIM INN HER>
```

**Sist rotert:** YYYY-MM-DD
**Roteres minst:** Hver 6. måned, eller umiddelbart ved mistenkt lekkasje
**Roteres alltid:** Ved PM-bytte

---

## Workspace / Service-IDer

| Service | Render-ID | URL |
|---|---|---|
| Backend (prod) | `<srv-...>` | https://spillorama-system.onrender.com |
| Backend (staging) | `<srv-...>` | (se dashboard) |
| Postgres (prod) | `<dbs-...>` | (intern) |
| Redis (prod) | `<red-...>` | (intern) |

Hent service-IDer:

```bash
curl -H "Authorization: Bearer $RENDER_API_KEY" \
  https://api.render.com/v1/services | jq '.[] | {name: .service.name, id: .service.id}'
```

---

## Vanlige operasjoner

### Liste env-vars (read-only — alltid trygt)

```bash
curl -H "Authorization: Bearer $RENDER_API_KEY" \
  https://api.render.com/v1/services/<srv-id>/env-vars | jq
```

### Oppdater env-var (FARLIG — les RENDER_ENV_VAR_RUNBOOK først)

Se [`docs/operations/RENDER_ENV_VAR_RUNBOOK.md`](../docs/operations/RENDER_ENV_VAR_RUNBOOK.md)
for de 5 fatale feilene som har skjedd før.

### Trigger deploy

```bash
curl -X POST -H "Authorization: Bearer $RENDER_API_KEY" \
  https://api.render.com/v1/services/<srv-id>/deploys
```

---

## Hvis nøkkelen er lekket

1. Logg inn på Render dashboard
2. Account Settings → API Keys → Revoke nøkkel
3. Generer ny nøkkel
4. Oppdater `secrets/render-api.local.md` på din maskin
5. Notify Tobias hvis du ikke er Tobias selv
6. Sjekk Render audit log for uautorisert aktivitet
7. Skriv postmortem i `docs/postmortems/` hvis lekkasje var resultat av prosess-feil

---

**Se også:**
- [`docs/operations/CREDENTIALS_AND_ACCESS.md`](../docs/operations/CREDENTIALS_AND_ACCESS.md)
- [`docs/operations/RENDER_ENV_VAR_RUNBOOK.md`](../docs/operations/RENDER_ENV_VAR_RUNBOOK.md)
- [`docs/operations/RENDER_GITHUB_SETUP.md`](../docs/operations/RENDER_GITHUB_SETUP.md)
