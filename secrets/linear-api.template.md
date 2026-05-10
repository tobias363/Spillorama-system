# Linear API — credentials template

**Kopier denne til `linear-api.local.md` og lim inn nøkkelen.**
**`linear-api.local.md` er auto-ignorert av git.**

> **NB:** Hvis du har Linear MCP koblet til Cowork/Claude, **bruk MCP-en** —
> du trenger da ikke denne nøkkelen i det hele tatt. Sjekk
> [Linear MCP-status](https://linear.app/integrations/mcp) før du genererer
> personlig API-key.

---

## Tilgang

**Hva:** Linear personal API key for Spillorama-prosjektet
**Tilgang via:** https://linear.app/settings/api
**Workspace:** Bingosystem
**Eier:** Hver PM har sin egen — ikke delt nøkkel
**Scope:** Read + write til BIN-* issues

---

## API Key

```
<LIM INN HER>
```

**Generert:** YYYY-MM-DD
**Roteres:** Ved PM-bytte eller mistenkt lekkasje

---

## Vanlige operasjoner

### List åpne BIN-issues

```bash
curl -X POST https://api.linear.app/graphql \
  -H "Authorization: $LINEAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "{ issues(filter: { state: { name: { neq: \"Done\" } }, team: { key: { eq: \"BIN\" } } }) { nodes { identifier title state { name } } } }"
  }' | jq
```

### Lag ny issue

Bruk Linear UI eller MCP-tool — ikke verdt manuell GraphQL.

---

**Se også:**
- [`docs/operations/CREDENTIALS_AND_ACCESS.md`](../docs/operations/CREDENTIALS_AND_ACCESS.md)
