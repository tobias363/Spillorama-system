# ADR-0023 — MCP write-access policy (lokal vs prod)

**Status:** Accepted
**Dato:** 2026-05-14
**Deciders:** Tobias Haugen + PM-AI
**Konsulterer:** —

## Kontekst

Tobias-direktiv 2026-05-14: "Kan du da også gjøre at endringer kan gjøres direkte gjennom MCP?"

Bakgrunn: MCP-servere som `@modelcontextprotocol/server-postgres` er READ-ONLY by design. Alternative MCP-servere (`crystaldba/postgres-mcp`, `bytebase/dbhub`) støtter write — det åpner muligheten for at PM-AI eller agent kan kjøre INSERT/UPDATE/DELETE/DDL direkte via MCP-tool.

For Spillorama er dette en **regulatorisk kritisk beslutning**:

- **§71 audit-trail** er bygget på hash-chain (ADR-0004, BIN-764). Direct `UPDATE app_compliance_audit_log` bryter hash-chain irreversibelt — kryptografisk umulig å recoveryen. Lotteritilsynet-revisjon vil avvise audit-data.
- **Wallet bruker outbox-pattern** (ADR-0005). Direct INSERT i `app_wallet_entries` omgår REPEATABLE READ-isolation og idempotency-guards → risk for double-payout med ekte penger.
- **Forward-only migrations** (ADR-0014). MCP-write logger ikke i `pgmigrations`-historikken → schema-drift mellom prod og `apps/backend/migrations/` → neste deploy kan korrupte data.
- **Pengespillforskriften §66** (5-min obligatorisk pause). Direct `UPDATE app_rg_restrictions SET timed_pause_until=NULL` overstyrer spillvett → compliance-brudd → dagsbøter 5k-50k NOK per hendelse.
- **Ingen review-gate.** PR-flyten har CI, danger.yml, compliance-tests, schema-CI, AI Fragility Review. MCP-write har 0 sjekker — ett klikk = produksjons-endring.

På den andre siden: PM-AI trenger raskt feedback-loop for å diagnose og iterere lokalt. Read-only-only-policy gjør at hver SQL-skrive må gå gjennom psql + Bash, som er tregere round-trip.

## Beslutning

Vi etablerer en **3-lags MCP write-policy**:

### Lag 1 — Lokal-DB (development): WRITE OK

`postgres-spillorama` (localhost:5432, dev) kan koble write-capable MCP. Anbefalt server: `crystaldba/postgres-mcp` med `execute_sql`-tool.

**Begrunnelse:** Lokal DB er ephemeral. Krasjer den, gjør `dev:nuke` og start på nytt. Ingen regulatoriske konsekvenser.

**Hva som tillates:**
- INSERT/UPDATE/DELETE/DDL — fritt
- Migrations testet lokalt FØR PR opprettes

**Hva som forbudt:**
- Skrive til lokal DB med samme connection-string som prod (bug-guard: connection-string må eksplisitt være `localhost`)

### Lag 2 — Prod-DB: READ-ONLY FOREVIG

`postgres-spillorama-prod` (Render bingo-db) bruker **kun** read-only MCP-server (`@modelcontextprotocol/server-postgres`).

**Begrunnelse:** Regulatorisk + compliance. Hash-chain audit, outbox-pattern, og forward-only migrations krever at ALL state-endring går via PR.

**Hva som tillates via MCP:**
- SELECT — fritt
- EXPLAIN — fritt
- Read-only system catalogs (pg_stat_*, pg_indexes, etc.)

**Hva som forbudt:**
- INSERT / UPDATE / DELETE / DDL — uansett om "korreksjon" eller "test"
- Direct mutation av audit-tabeller (`app_compliance_audit_log`, `app_wallet_entries`, `app_payout_audit`, `app_regulatory_ledger`) — hash-chain-bevarende
- Mutation av rg-restriksjoner (`app_rg_restrictions`) — §66/§23-bevarende
- `pg_terminate_backend` — krever ops-godkjenning, ikke MCP

### Lag 3 — Schema/data-korreksjon: VIA MIGRATION-PR

Hvis prod-state må endres (eks. korreksjons-rad i compliance-ledger etter incident, schema-evolusjon, manuell payout-justering):

1. PM-AI eller agent skriver SQL-forslag som **migration-fil** i `apps/backend/migrations/<timestamp>_<topic>.sql`
2. PR åpnes med:
   - Migration-fil
   - ADR hvis arkitektur-endring
   - Manuell test mot lokal-DB
   - CI grønt (compliance-tests, schema-CI, danger.yml)
3. Tobias godkjenner explicit
4. Auto-merge → Render auto-deploy kjører migration

**Korreksjons-mønster for audit-tabeller:**
```sql
-- Aldri:
UPDATE app_compliance_audit_log SET amount = 1500 WHERE id = '...';

-- Alltid:
INSERT INTO app_compliance_audit_log (id, action, resource_id, original_id, correction_reason, amount, ...)
VALUES ('<new-uuid>', 'correction', '<original-id>', '<original-id>', 'Tobias godkjent fix 2026-05-14', 1500, ...);
```

Append-only bevarer hash-chain. `original_id`-felt linker korreksjonen til opprinnelig entry.

## Konsekvenser

### Positive

- **Regulatorisk grunnlag intakt:** Hash-chain audit-trail kan aldri brytes via MCP. Lotteritilsynet-revisjon trygg.
- **Wallet-integritet bevart:** Outbox-pattern og REPEATABLE READ-isolation kan ikke omgås.
- **Reproducible schema-evolution:** Alle endringer som påvirker prod går via PR → CI-test → deploy-historikk.
- **Lokal dev-velocity:** PM-AI kan iterere raskt lokalt uten compliance-bekymringer.
- **PM kan fortsatt feilsøke prod raskt:** SELECT-kall via MCP er lynraskt (én round-trip vs. shell-prompt).

### Negative

- **Ingen "hot fix"-evne fra Claude Code direkte mot prod.** Hvis Tobias rapporterer datakorruption som krever rask retting, må vi gå migration-PR-veien (5-10 min round-trip). Mitigasjon: forward-only korreksjons-migrations kan reviewes raskt.
- **Krever disiplin:** Det er teknisk mulig å overstyre policyen ved å bytte ut prod-MCP til write-capable variant. Mitigasjon: dette dokumentet er **IMMUTABLE**, og brudd er compliance-brudd som må eskaleres til Tobias.

### Nøytrale

- **PgBouncer eller andre proxies endrer ikke policyen** — selv om vi setter opp connection-pool-proxy i prod, må write-tilgang fortsatt gå via migration-PR.
- **Read-replica (post-pilot) endrer ikke policyen** — read-replica brukes for analytics + ad-hoc-queries med samme read-only-restriksjoner.

## Alternativer vurdert

### Alternativ A: Full write-MCP også for prod
Avvist:
- Bryter §71 hash-chain audit-trail
- Omgår outbox-pattern (BIN-761 — wallet-integritet)
- Bryter forward-only migrations (ADR-0014)
- Ingen review-gate = ingen review-trail = regulatorisk svikt
- Pengespillforskriften §15 krever revisjon-spor på all state-endring

### Alternativ B: Read-only for begge (lokal + prod)
Avvist:
- For restriktivt for lokal dev. PM-AI må iterere med psql i terminal, som er tregere.
- Lokal-DB er ephemeral — ingen regulatorisk konsekvens ved write-tilgang.

### Alternativ C: Write-MCP men med approval-gate per kall
Vurdert men avvist:
- Krever custom MCP-server som logger og venter på Tobias-godkjennelse mellom hvert kall.
- For tregt for ad-hoc-bruk.
- Migration-PR-flyten gir samme review-gate med bedre traceability (commit-historikk).

## Implementasjon

### Filer som påvirkes

- `~/.claude.json` (user-scope MCP-config):
  - `postgres-spillorama` → bytt fra `@modelcontextprotocol/server-postgres` til `crystaldba/postgres-mcp` via `uvx postgres-mcp --access-mode=unrestricted` (write-capable, KUN lokal `localhost:5432`)
  - `postgres-spillorama-prod` → forblir `@modelcontextprotocol/server-postgres` (READ-ONLY)

### Installasjons-kommandoer

```bash
# Krav: uvx (`brew install uv` på macOS)

# Lokal (WRITE OK):
claude mcp remove postgres-spillorama
claude mcp add postgres-spillorama -s user -- \
  uvx postgres-mcp --access-mode=unrestricted \
  "postgresql://spillorama:spillorama@localhost:5432/spillorama"

# Prod (READ-ONLY — IKKE ENDRES):
# postgres-spillorama-prod skal ALDRI byttes til write-capable.
# Verifiseres via Verifikasjons-kommando under.
```

### Verifikasjon-kommando

```bash
# Verifiser prod er read-only:
claude mcp list | grep "postgres-spillorama-prod"
# Forventet: "@modelcontextprotocol/server-postgres" (read-only)

# Verifiser lokal er write-capable:
claude mcp list | grep "^postgres-spillorama:"
# Forventet: "uvx postgres-mcp --access-mode=unrestricted ..."

# Hvis prod-MCP byttes til write-capable → brudd på ADR-0023 → varsle Tobias.
```

### Skill-updates

- `.claude/skills/database-migration-policy/SKILL.md` — utvid med MCP-write-policy-referanse
- `.claude/skills/wallet-outbox-pattern/SKILL.md` — peker til ADR-0023 som beskyttelse av wallet-integritet
- `.claude/skills/pengespillforskriften-compliance/SKILL.md` — utvid med MCP-write-restriksjon for audit-tabeller

### PR-template

Legg til checkbox: "[ ] Ingen direct MCP-write mot prod-DB i denne PR-en (ADR-0023)"

## Referanser

- [ADR-0004](./0004-hash-chain-audit.md) — Hash-chain audit-trail (BIN-764)
- [ADR-0005](./0005-outbox-pattern.md) — Outbox-pattern for events (BIN-761)
- [ADR-0014](./0014-idempotent-migrations.md) — Idempotente migrasjoner (MED-2)
- [Pengespillforskriften §11, §66, §71](https://lovdata.no/forskrift/2022-12-12-1969) — Audit-krav
- [`docs/engineering/PM_ONBOARDING_PLAYBOOK.md`](../engineering/PM_ONBOARDING_PLAYBOOK.md) §2.21 — DB call-overvåking
- Tobias-direktiv 2026-05-14: "Endringer kan gjøres direkte gjennom MCP" + "Pengespill og feil bli ekstremt kostbart"
