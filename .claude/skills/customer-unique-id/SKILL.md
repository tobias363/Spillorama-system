---
name: customer-unique-id
description: When the user/agent works with the Customer Unique ID (prepaid-kort) for walk-in players in the Spillorama bingo platform (BIN-587). Also use when they mention UniqueIdService, UniqueIdStore, app_customer_unique_ids, app_unique_id_transactions, prepaid-kort, prepaid card, walk-in player, agent.uniqueid, agentUniqueIds, expiry-cron, uniqueIdExpiry, hours-validity, re-generate-unique-id, BIN-587, B2.1, agent-portal Unique ID list, View Profile Unique ID, Add Money Unique ID, Withdraw Unique ID, Create New Unique ID, PRINT, MIN_HOURS_VALIDITY, Cash-only withdraw. The Unique ID is a hall-scoped prepaid card with minimum 24h validity, cash-only at withdraw, balance accumulates (never overwritten), and every mutation writes an audit-row. Make sure to use this skill whenever someone touches UniqueIdService, the create/topup/withdraw flows, or the expiry-cron — even if it looks like a small CRUD tweak — because the prepaid-card flow is regulatory cash-tracked and walk-in players have no email/phone fallback.
metadata:
  version: 1.0.0
  project: spillorama
---

<!-- scope: apps/backend/src/agent/UniqueIdService.ts, apps/backend/src/agent/UniqueIdStore.ts, apps/backend/src/agent/__tests__/UniqueIdStore.postgres.test.ts, apps/backend/src/agent/__tests__/UniqueIdService.test.ts, apps/backend/src/routes/adminUniqueIdsAndPayouts.ts, apps/backend/src/routes/agentUniqueIds.ts, apps/backend/src/routes/__tests__/adminUniqueIdsAndPayouts.test.ts, apps/backend/src/routes/__tests__/agentUniqueIds.test.ts, apps/admin-web/src/pages/agent-portal/AgentUniqueIdPage.ts -->

# Customer Unique ID (Prepaid-kort, BIN-587)

The Customer Unique ID is a **walk-in-spillers prepaid-kort** — for customers who don't want to register an online account but still want to play with a balance they can top up and withdraw. The agent prints a card with a 9-digit ID, the player carries it back to the hall, the agent scans/types it for top-ups and cash-out.

This is hall-scoped: only agents at the same hall that issued the card can see/edit it. Minimum 24h validity. Cash-only at withdraw. Balance accumulates on top-ups (never overwritten).

## Kontekst (read first)

- `docs/architecture/LEGACY_1_TO_1_MAPPING_2026-04-23.md` — Unique ID sections (legacy `UniqueIdController` was 1827 lines; we ported the user-facing flow)
- `docs/architecture/WIREFRAME_CATALOG.md` — wireframes 17.9 (Create), 17.10 (Add Money), 17.11 (Withdraw), 17.25-27 (List + Details + Transaction History)
- Source files:
  - `apps/backend/src/agent/UniqueIdService.ts` — service with create/topup/withdraw/list/details/regenerate
  - `apps/backend/src/agent/UniqueIdStore.ts` — DB layer (UniqueIdCard, UniqueIdTransaction, UniqueIdPaymentType, UniqueIdStatus types)
  - `apps/backend/src/jobs/uniqueIdExpiry.ts` — cron that flips expired cards (PR #599)
  - `apps/backend/src/routes/agentUniqueIds.ts` — agent-side endpoints
  - `apps/backend/src/routes/adminUniqueIdsAndPayouts.ts` — admin-side endpoints
- Memory `feedback_done_policy.md` — reminder: BIN-587 closed only when verified end-to-end

## Kjerne-arkitektur

### 8 endpoints (agent-side primary surface)

| Endpoint | Purpose |
|---|---|
| `POST /api/agent/unique-ids` | Create new card (purchase-date, expiry, initial balance, payment-type) |
| `POST /api/agent/unique-ids/:id/topup` | Add money (cash or card) — balance accumulates |
| `POST /api/agent/unique-ids/:id/withdraw` | Cash-out (CASH-only) |
| `GET /api/agent/unique-ids` | List in agent's hall (filterable: status, date-range, search) |
| `GET /api/agent/unique-ids/:id` | Card details |
| `GET /api/agent/unique-ids/:id/transactions` | Transaction-history per card |
| `GET /api/agent/unique-ids/:id/printable` | Print-friendly receipt |
| `POST /api/agent/unique-ids/:id/regenerate` | Re-generate when print failed (within 30 days) |

Admin has a parallel surface for cross-hall view.

### Datamodell

```
app_customer_unique_ids
  ├─ id (text, 9-digit, unique)
  ├─ hall_id (FK → app_halls)        ← scoped to issuing hall
  ├─ created_by_agent_id
  ├─ purchase_date
  ├─ expiry_date                      ← min 24h after purchase
  ├─ hours_validity                   ← computed min 24
  ├─ status (active, expired, withdrawn, blocked)
  ├─ balance_cents                    ← accumulates on topup, decrements on withdraw
  ├─ initial_payment_type (CASH | CARD)
  └─ created_at, updated_at

app_unique_id_transactions
  ├─ id, unique_id_card_id (FK)
  ├─ type (CREATE | TOPUP | WITHDRAW | GAME_DEBIT | GAME_CREDIT)
  ├─ amount_cents (positive integer; sign by type)
  ├─ payment_type (CASH | CARD)       ← null for game debits/credits
  ├─ balance_after_cents              ← snapshot for audit
  ├─ agent_user_id, shift_id
  └─ created_at
```

Every balance mutation writes a transaction-row in the same DB transaction. UniqueIdStore.atomicTopup / atomicWithdraw ensures atomicity.

### Balance accumulates on top-up

Wireframe 17.10 says: *"if balance from previous game is 100 kr and agent adds 200 kr, the card has 300 kr."* The service implements this exactly — `topup` ADDS to the existing balance, never overwrites.

### CASH-only at withdraw

Wireframe 17.11 says: *"only Cash option as withdraw type."* The service rejects CARD for withdraw flows. The agent hands the player physical cash from the drawer; the transaction decrements `shift.daily_balance` simultaneously (cross-references `agent-shift-settlement` skill).

### Minimum 24h validity

`UniqueIdService.MIN_HOURS_VALIDITY = 24`. Validates at create-time. The expiry-cron (`apps/backend/src/jobs/uniqueIdExpiry.ts`) runs periodically and flips status from `active` → `expired` once `expiry_date < NOW()`.

Once expired, the balance is locked. Recovery requires admin action (audit-logged).

### Re-generate (within 30 days)

Wireframe 17.26: *"Re-generate Unique ID for re-print if print failed."* The service allows re-generation only within 30 days of original purchase. It does NOT create a new ID — it re-prints the same card-data.

### Hall-scope is enforced

Agent can only see/edit Unique IDs created at their own hall. Cross-hall access is forbidden (returns 403). Admin sees all halls.

### Game-debit/credit

When a Unique-ID-holder buys a ticket or wins a prize, the GAME_DEBIT / GAME_CREDIT transaction-types fire. These don't have a `payment_type` (they're not cash/card flows; they're internal balance movements). The card's `balance_cents` adjusts accordingly.

## Immutable beslutninger

1. **9-digit numeric ID format.** Don't change to UUIDs or alphanumeric — printers + scanners are tuned to numeric.
2. **Minimum 24h validity.** Hardcoded constant. Tobias-direktiv.
3. **Cash-only at withdraw.** Card-withdraw is intentionally not supported (anti-fraud rationale).
4. **Balance accumulates on topup.** Never overwrite.
5. **Hall-scoped.** Agents at hall A cannot see/edit cards issued at hall B. Admin override goes through admin endpoint.
6. **Every balance mutation writes a transaction-row in same DB tx.** Atomicity is non-negotiable.
7. **Re-generate within 30 days only.** After 30 days, lost card → admin manual intervention.
8. **Expiry-cron flips status, doesn't delete.** Expired cards remain queryable for audit; balance is locked, not zeroed.

## Vanlige feil og hvordan unngå dem

1. **Allowing card-withdraw.** Wrong — CASH only at withdraw. The service rejects CARD.
2. **Overwriting balance instead of accumulating on topup.** Wireframe is explicit: ADD, don't replace.
3. **Letting agents at different halls see/edit a card.** Cross-hall must 403. Admin path is separate.
4. **Allowing < 24h expiry at create-time.** `MIN_HOURS_VALIDITY = 24` — validation rejects shorter.
5. **Treating `regenerate` as creating a new card.** It re-prints the same id; balance/expiry unchanged.
6. **Forgetting to write a transaction-row on game-debit/credit.** Every balance change must hash an audit-row, even internal game flows.
7. **Letting expired cards still pay out.** Expiry-cron must flip status; service must reject mutations on `expired`/`withdrawn`/`blocked` status.
8. **Mutating balance outside the atomic store-method.** Use UniqueIdStore.atomicTopup / atomicWithdraw — do not fork your own SQL UPDATE.
9. **Cross-referencing player accounts.** A Unique ID is NOT linked to a registered player account. They are independent. Don't add a `user_id` foreign key.

## Kanonisk referanse

- Legacy mapping: `docs/architecture/LEGACY_1_TO_1_MAPPING_2026-04-23.md`
- Wireframes: `docs/architecture/WIREFRAME_CATALOG.md` 17.9 / 17.10 / 17.11 / 17.25 / 17.26 / 17.27
- Service: `apps/backend/src/agent/UniqueIdService.ts`
- Store: `apps/backend/src/agent/UniqueIdStore.ts`
- Cron: `apps/backend/src/jobs/uniqueIdExpiry.ts`
- Routes: `apps/backend/src/routes/agentUniqueIds.ts` + `adminUniqueIdsAndPayouts.ts`

## Når denne skill-en er aktiv

LOAD when:
- Modifying `UniqueIdService` / `UniqueIdStore`
- Adding fields/types to `app_customer_unique_ids` or `app_unique_id_transactions`
- Touching the expiry-cron job
- Implementing or changing agent-portal Unique ID UI
- Building admin cross-hall Unique ID views
- Wiring game-flows (ticket-purchase, payout) to Unique ID balance
- Investigating "card balance wrong" or "card expired prematurely" tickets

SKIP when:
- Registered-player wallet flows (those go via casino-grade-wallet skill)
- Pure agent-portal CSS/layout work
- Reports that don't touch Unique ID balance mutation
