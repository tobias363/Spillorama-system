# Module: `apps/backend/src/payments`

**Sist oppdatert:** 2026-05-06
**Eier:** Tobias Haugen
**LOC:** ~2 487

## Ansvar

Payment-integrasjoner:
- Swedbank Pay (top-ups, redirect-flow, webhook med HMAC-verifisering)
- Manuell deposit/withdraw queue (BIN-586) — Pay in Hall, Bank
- BIR-036 daglig kontant-cap (50k/hall/dag)
- Vipps-integrasjon (planlagt)

## Ikke-ansvar

- Wallet-mutering (delegert til `wallet/`)
- Compliance-sjekk (delegert til `compliance/`)

## Public API

HTTP-endepunkter:
- `POST /api/payments/swedbank/topup-intent`
- `POST /api/payments/swedbank/confirm`
- `POST /api/payments/swedbank/callback` (HMAC-verifisert webhook)
- `POST /api/payments/deposit-request` (Pay in Hall)
- `POST /api/payments/withdraw-request`
- Admin-side: `/api/admin/payments/requests/*` (accept/reject)

## Invariants

1. **Webhook HMAC-verifisering** (BIN-603) før wallet-credit
2. **Defense-in-depth:** Swedbank API re-fetch authoritative status før credit
3. **Idempotency:** ved double-webhook, samme intent_id = samme resultat
4. **Daglig kontant-cap (BIR-036):** 50 000 kr/hall/dag for cash-withdraw
5. **HALL_OPERATOR scope** for accept/reject

## Bug-testing-guide

### "Webhook svarer 401 INVALID_SIGNATURE"
- Sjekk `SWEDBANK_WEBHOOK_SECRET` env
- Sjekk HMAC-algoritme (SHA-256)
- Fail-closed hvis env mangler (returner 503)

### "Cash withdraw avvist med CAP_EXCEEDED"
- Sjekk dagens akkumulert kontant-utbetaling for hallen
- Sjekk timezone i counter (Europe/Oslo, ikke UTC)

## Referanser

- BIN-586 (Payment requests)
- BIN-603 (HMAC verification)
- BIR-036 (cash cap)
- `docs/architecture/HV2_BIR036_SPEC_2026-04-30.md`
