---
name: agent-shift-settlement
description: When the user/agent works with the agent shift lifecycle, cash-in/cash-out, daily-balance control, or end-of-day settlement (BIN-583) in the Spillorama bingo platform. Also use when they mention AgentShiftService, AgentSettlementService, AgentTransactionService, AgentTransactionStore, HallCashLedger, app_agent_shifts, app_agent_settlements, app_agent_transactions, daily-balance, control-daily-balance, close-day, settlement, machine-breakdown, MachineBreakdownTypes, Metronia, OK Bingo, Franco, Otium, Norsk Tipping (Dag/Totalt), Norsk Rikstoto (Dag/Totalt), Rekvisita, Servering/kaffe, Bilag, Bank, Gevinst overført, Drop-safe, Shift-diff, NOTE_REQUIRED, FORCE_REQUIRED, distribute winnings, transfer register ticket, dropsafe, B3.3, BIN-583. The settlement-popup is wireframe-paritet-critical (PDF 15+16+17 §15.8). Make sure to use this skill whenever someone touches AgentShiftService, AgentSettlementService, the machine-breakdown type, the close-day flow, or the threshold-rules — even if it looks like a small tweak — because regnskap-paritet with legacy is a regulatory and operational must.
metadata:
  version: 1.0.0
  project: spillorama
---

# Agent Shift + Settlement (BIN-583 B3.3)

The agent (bingovert) opens a shift at the start of work, handles cash-in/cash-out + ticket-sales + product-sales during the shift, and closes the day with a daily-balance + settlement reconciliation. The settlement popup matches legacy wireframes 1:1 — there are 14 machine/category breakdown rows, severity-based diff-rules, and a daily-balance transfer to `hall.cash_balance`.

This is wireframe-paritet-critical. Tobias confirmed (2026-04-23) all 4 maskin-rader (Metronia, OK Bingo, Franco, Otium) + Norsk Tipping/Rikstoto + Rekvisita/Servering/Bilag/Bank are required for regnskap.

## Kontekst (read first)

- `docs/architecture/LEGACY_1_TO_1_MAPPING_2026-04-23.md` — Agent-portal section + Settlement-table breakdown
- `docs/architecture/WIREFRAME_CATALOG.md` — PDF 13 (Daily Balance & Settlement) + PDF 15 §15.8 (Hall Account Report Settlement) + PDF 16 §16.25 (Settlement edit popup) + PDF 17 §17.10 (Agent Settlement)
- Source files:
  - `apps/backend/src/agent/AgentShiftService.ts` — start/end shift + checkboxes (distribute winnings, transfer register)
  - `apps/backend/src/agent/AgentSettlementService.ts` — control-daily-balance, close-day, edit-settlement
  - `apps/backend/src/agent/AgentTransactionService.ts` — cash-in/cash-out + ticket-sales
  - `apps/backend/src/agent/AgentTransactionStore.ts` — `ShiftAggregate` rollups
  - `apps/backend/src/agent/HallCashLedger.ts` — settlement → hall cash balance transfer
  - `apps/backend/src/agent/MachineBreakdownTypes.ts` — the 14-row machine-breakdown JSON shape
- Migrations: `apps/backend/migrations/20260*_agent_*.sql`

## Kjerne-arkitektur

### Shift lifecycle

```
agent login (role=AGENT, agent_status='active')
   ↓
POST /api/agent/shift/start   → app_agent_shifts row, started_at=NOW()
                                 daily_balance pre-set from prior shift OR 0
   ↓
during shift:
   - cash-in / cash-out (CASH/CARD)
   - ticket-sale (digital + physical)
   - product-sale (kiosk: kaffe, sjokolade, ris)
   - unique-id create / topup / withdraw
   - mid-game master-actions if at master-hall
   ↓
POST /api/agent/shift/control-daily-balance (multiple times — sanity-check)
   ↓
POST /api/agent/shift/close-day  → settlement-row + shift.settled_at + hall.cash transfer
   ↓
POST /api/agent/shift/end        → shift.ended_at, shift.is_logged_out
```

`distribute_winnings_to_physical_players` and `transfer_register_ticket_to_next_agent` are checkbox-flags on shift-end. The first marks all pending physical-cashouts as rewarded; the second hands off the ticket-register to the incoming agent.

### Three balance concepts — don't conflate

| Concept | Where | Meaning |
|---|---|---|
| `shift.daily_balance` | `app_agent_shifts.daily_balance` | What this shift's cash position is, mid-shift. Increments on CASH-in, decrements on CASH-out. |
| `hall.cash_balance` | `app_halls.cash_balance` | The hall's master cash-balance across all shifts. Increments on settlement-transfer. |
| `dropsafe` | settlement-form input | Cash physically moved to the safe at close-day. Reported, not auto-tracked. |

CASH transactions move `shift.daily_balance` immediately. CARD transactions don't (they move money via card-processor → hall's bank). The settlement transfer at close-day moves what's left in `shift.daily_balance` to `hall.cash_balance` minus what went to dropsafe.

### Three severity tiers for daily-balance diff

`AgentSettlementService.computeDiffSeverity` evaluates `diff = reported_cash_count - shift.daily_balance_at_end`:

| Tier | Range | Behaviour |
|---|---|---|
| `OK` | `|diff| ≤ 500 kr` AND `|diff%| ≤ 5%` | close-day succeeds without note |
| `NOTE_REQUIRED` | `500 < |diff| ≤ 1000 kr` OR `5 < |diff%| ≤ 10` | settlement_note must be non-empty |
| `FORCE_REQUIRED` | `|diff| > 1000 kr` OR `|diff%| > 10` | ADMIN must approve via `is_force_requested=true` AND note |

These thresholds are constants in `AgentSettlementService.ts`:
```typescript
DIFF_NOTE_THRESHOLD_NOK = 500
DIFF_NOTE_THRESHOLD_PCT = 5
DIFF_FORCE_THRESHOLD_NOK = 1000
DIFF_FORCE_THRESHOLD_PCT = 10
```

### Settlement machine-breakdown — 14 rows, JSONB

The settlement-form's machine-breakdown is stored as JSONB in `app_agent_settlements.machine_breakdown_json` matching the type in `MachineBreakdownTypes.ts`. The 14 rows are:

| Row | IN | OUT | Sum | Notes |
|---|---|---|---|---|
| Metronia | ✅ | ✅ | ✅ | Machine ID required |
| OK Bingo | ✅ | ✅ | ✅ | Machine ID required |
| Franco | ✅ | ✅ | ✅ | Machine ID required |
| Otium | ✅ | ✅ | ✅ | Machine ID required |
| Norsk Tipping Dag | ✅ | ✅ | ✅ | Machine ID. Subtle: Dag is reported separately from Totalt |
| Norsk Tipping Totalt | ✅ | ✅ | ✅ | Cumulative total — separate from Dag |
| Norsk Rikstoto Dag | ✅ | ✅ | ✅ | Same Dag/Totalt distinction |
| Norsk Rikstoto Totalt | ✅ | ✅ | ✅ | Cumulative total |
| Rekvisita (Props) | ✅ | — | ✅ | IN-only |
| Servering/kaffepenger | ✅ | — | ✅ | IN-only — kiosk sales |
| Bilag (Receipt) | ✅ | — | ✅ | IN-only + receipt-upload |
| Bank | ✅ | ✅ | ✅ | Card terminal totals |
| Gevinst overføring bank | — | ✅ | ✅ | OUT-only (prizes paid via bank transfer) |
| Annet (Other) | ✅ | ✅ | ✅ | Catch-all |

Don't drop or merge rows. The 14-row shape is wireframe-paritet 1:1.

### Edit-settlement (admin-only)

`AgentSettlementService.editSettlement` is ADMIN-gated. It saves `edited_by_user_id`, `edited_at`, and `edit_reason` (required). It does NOT auto-rebalance the wallet — that requires a separate counter-transaction flow (parked under future BIN). Always supply a meaningful `edit_reason` for audit.

### Group-of-halls aggregated report

If multiple agents settle the same business-day in the same hall, all settlements appear in the hall-account-report list for that day — separate rows, not aggregated. Difference + sum sums up across agent-rows.

## Immutable beslutninger

1. **14-row machine-breakdown is fixed.** Don't merge "Norsk Tipping Dag" with "Norsk Tipping Totalt" — they are separate rows.
2. **Severity-tier thresholds are admin-tunable but stable.** Changing them requires Tobias decision + AuditLogService event.
3. **CASH affects `shift.daily_balance` immediately. CARD does not.** Don't cross these wires.
4. **close-day is atomic.** Either the settlement-row inserts AND `hall.cash_balance` updates AND `shift.settled_at` sets — or none. Use a single transaction.
5. **distribute_winnings + transfer_register are shift-end checkboxes.** They are boolean flags consumed by the close-day flow; don't add new variants without UI updates.
6. **edit-settlement is ADMIN-only.** AGENT cannot edit own settlement after submit. HALL_OPERATOR cannot edit either.
7. **Settlement-row never auto-rebalances wallet.** Edits adjust the settlement number; wallet adjustments require explicit counter-transactions.
8. **Bilag-rad has receipt-upload.** Don't strip it.

## Vanlige feil og hvordan unngå dem

1. **Treating shift.daily_balance and hall.cash_balance as the same number.** Mid-shift they diverge. Settlement reconciles them.
2. **Letting CARD-transactions bump shift.daily_balance.** Wrong — CARD goes to bank, not cash drawer. Only CASH affects daily_balance.
3. **Approving close-day with `FORCE_REQUIRED` severity but caller is not ADMIN.** The service throws DomainError — don't try to bypass.
4. **Using a wireframe-PDF as code-source-of-truth.** Wireframes are *intent*; the source is `MachineBreakdownTypes.ts` and the service. If they diverge from wireframe, file a doc-discrepancy issue and ask Tobias.
5. **Merging multi-agent same-day settlements server-side.** No — keep separate rows. UI sums them for display.
6. **Forgetting `transfer_register_ticket_to_next_agent` semantics.** Even if false, the next agent inherits ticket-state implicitly via shift-handoff. The flag explicitly transfers ownership audit-event.
7. **Editing the settlement and silently mutating linked wallet entries.** Don't — edits only touch `app_agent_settlements`. Wallet corrections need their own counter-tx.
8. **Skipping `edit_reason`.** Required for audit. The service rejects empty/missing.
9. **Treating Norsk Tipping/Rikstoto as auto-API.** They are MANUAL ENTRY (Tobias 2026-04-23). The form has fields; the agent types numbers from the partner-machine.

## Kanonisk referanse

- Legacy mapping: `docs/architecture/LEGACY_1_TO_1_MAPPING_2026-04-23.md`
- Wireframes: `docs/architecture/WIREFRAME_CATALOG.md` PDF 13 + 15 + 16 + 17
- Service: `apps/backend/src/agent/AgentSettlementService.ts`
- Shift service: `apps/backend/src/agent/AgentShiftService.ts`
- Transaction store: `apps/backend/src/agent/AgentTransactionStore.ts`
- Hall cash ledger: `apps/backend/src/agent/HallCashLedger.ts`
- Type definitions: `apps/backend/src/agent/MachineBreakdownTypes.ts`

## Når denne skill-en er aktiv

LOAD when:
- Modifying `AgentShiftService` / `AgentSettlementService` / `AgentTransactionService`
- Touching the `MachineBreakdownTypes` shape or validation
- Implementing or changing close-day, control-daily-balance, edit-settlement
- Adding new transaction-type to `AgentTransactionStore`
- Touching `HallCashLedger` (settlement → hall.cash transfer)
- Modifying severity-thresholds or close-day diff-rules
- Building agent-portal UI for cash-in-out, daily-balance, settlement
- Investigating a "shift won't close" or "diff too big" support ticket

SKIP when:
- Pure UI styling that doesn't touch settlement amounts or threshold-rules
- Player-side wallet flows (those are casino-grade-wallet skill territory)
- Non-agent reports (admin reports are a different surface)
