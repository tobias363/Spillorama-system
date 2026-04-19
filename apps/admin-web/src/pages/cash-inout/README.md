# cash-inout — PR-B1

Port of 12 legacy pages under `legacy/unity-backend/App/Views/cash-inout/`.
Owned by Agent B per the BIN-613 scope split. See
`slot-B/PR-B1-PLAN.md` for the full plan + PM §7 answers.

## Pages

| Route | File | Legacy source |
|---|---|---|
| `#/agent/cashinout` | `CashInOutPage.ts` | `cash_in-out.html` (default + agent tabs — game tab dropped, §7 Q1) |
| `#/agent/sellPhysicalTickets?gameId=X` | `SellTicketPage.ts` | `sell_ticket.html` |
| `#/sold-tickets` | `SoldTicketsPage.ts` | `sold-tickets.html` |
| `#/agent/sellProduct` | `ProductCartPage.ts` | `product_cart.html` + `product_checkout.html` |
| `#/agent/physicalCashOut` | `PhysicalCashoutPage.ts` | (agent physical cashout list) |
| `#/agent/cashout-details?id=X` | `CashoutDetailsPage.ts` | `cashout_details.html` |
| `#/agent/unique-id/add` / `withdraw` | `BalancePage.ts` (mode=`unique-id`) | `unique-id-balance.html` |
| `#/agent/register-user/add` / `withdraw` | `BalancePage.ts` (mode=`register-user`) | `register-user-balance.html` |

`product_cart_old.html` is legacy backup and not ported.
`physical-ticket.html` and `slotmachine-popups.html` are implemented as
modals (see `modals/`) rather than full routes, matching legacy.

## Modals

- `modals/SlotMachineModal.ts` — provider-aware. Routes to Metronia or OK Bingo
  based on `hall.slotProvider` via `components/SlotProviderSwitch.ts`.
- `modals/ControlDailyBalanceModal.ts` — midtveis-sjekk; requires note when
  diff > 500 kr OR > 5 %.
- `modals/SettlementModal.ts` — close-day, uses `backdrop: "static"` +
  `keyboard: false`.

## Components introduced

- `components/BarcodeScanner.ts` — USB-reader keypress handler; extracts the
  7-digit ticket ID from position 14..20 of a 22-char scan. 10 vitest tests in
  `tests/barcodeScanner.test.ts`.
- `components/SlotProviderSwitch.ts` — hall → provider resolver with missing-
  provider toast. 8 vitest tests.

## API wrappers

- `api/agent-cash.ts` — player lookup, cash in/out, physical tickets, products.
- `api/agent-shift.ts` — shift lifecycle, daily balance, settlement.
- `api/agent-slot.ts` — provider-scoped Metronia / OK Bingo operations.

All backend endpoints are delivered by BIN-583 (B3.2 / B3.3 / B3.4 / B3.6 /
B3.7 / B3.8). PR-B1 adds no backend changes.

## Known follow-ups

- **BIN-TBD — `app_halls.slot_provider` column.** Not present in current
  schema ([20260413000001_initial_schema.sql](../../../../../../apps/backend/migrations/20260413000001_initial_schema.sql)).
  `SlotProviderSwitch.require()` surfaces a toast until a hall has its
  provider set. Admin-UI for setting the provider is out of scope for PR-B1.
- Visual 1:1 parity vs. the legacy AdminLTE skin is functional, not
  pixel-perfect; refinements can come in PR-B1.1 after a side-by-side review.
- Tastatursnarveier F5/F6/F8 gate on the cash-inout route via a MutationObserver
  — if Agent A publishes a proper route-unmount hook later, swap to that.

## Tests

- `tests/barcodeScanner.test.ts` — 10 tests (extract, trim, debounce, detach,
  focus, re-enter, rapid-Enter, edge cases).
- `tests/slotProviderSwitch.test.ts` — 8 tests (valid providers, null hall,
  unknown string, require surfaces toast, label).
