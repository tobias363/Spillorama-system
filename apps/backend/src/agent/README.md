# Module: `apps/backend/src/agent`

**Sist oppdatert:** 2026-05-06
**Eier:** Tobias Haugen
**LOC:** ~12 301

## Ansvar

Agent-/bingovert-portal backend (BIN-583). Eier:
- Agent-auth (login, profile, password, language, avatar)
- Shift-management (start/end shift, daily balance)
- Cash-operations (cash-in/out, kontant-transaksjoner)
- Player-lookup + balance (i hallen)
- Digital + physical ticket-sale
- Settlement (kasse-oppgjør med maskin-breakdown)
- Metronia-integrasjon (eksterne maskiner)
- OK Bingo-integrasjon (SQL Server polling)
- Order history (kiosk-salg)

## Ikke-ansvar

- Spill-runtime (delegert til `game/`)
- Wallet-debit/credit (delegert til `wallet/`, men agent kaller via service)

## Public API

Hoved-services:
- `AgentAuthService` — login + profile management
- `AgentShiftService` — shift lifecycle
- `AgentTransactionService` — cash-ops
- `AgentSettlementService` — daglig kasse-oppgjør
- `MetroniaService` — maskin-integrasjon
- `OKBingoService` — maskin-integrasjon (SQL Server)

HTTP-endepunkter: `/api/agent/*` (AGENT-role)

## Invariants

1. **Aktiv shift kreves** for cash-ops (CASH_IN/OUT, ticket-sale)
2. **Cash-in oppdaterer daily_balance, card-in gjør ikke** (BIN-583 B3.2)
3. **Settlement-diff > 1000 kr krever ADMIN + force + reason**
4. **Cancel-window 10 min** for ticket-sale-cancel (admin kan force etter)
5. **Hall-scope automatisk** — agent kan kun handle i tildelt hall
6. **Audit alle cash-ops** med agent-id, shift-id, actor

## Bug-testing-guide

### "Settlement-diff for stor"
- Kjør `npm run reconcile:agent-shift -- --shift=...`
- Sjekk om kassen er talt feil
- Sjekk maskin-breakdown for misslesing

### "Metronia API timeout"
- Sjekk `METRONIA_API_URL` env
- Sjekk Sentry for `MetroniaService` errors
- Fall-back: manuell registrering hvis API nede

## Referanser

- BIN-583 (B3.1, B3.2, B3.3, B3.4, B3.5)
- `apps/backend/openapi.yaml` Agent-tags
- `docs/operations/PILOT_4HALL_DEMO_RUNBOOK.md`
