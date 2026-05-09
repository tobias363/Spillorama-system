# §71 Regulatory ledger module

**Status:** G2 + G3 + G4 LANDED 2026-05-09 (PR feat/spill71-g2-g4-regulatory-ledger).
**Mandate:** [docs/compliance/SPILL71_DAILY_REPORT_VERIFICATION_2026-Q3.md](../../../../../docs/compliance/SPILL71_DAILY_REPORT_VERIFICATION_2026-Q3.md)
**Tables:** `app_regulatory_ledger`, `app_daily_regulatory_reports`
**Migrations:**
- [20260417000005_regulatory_ledger.sql](../../../migrations/20260417000005_regulatory_ledger.sql)
- [20260417000006_daily_regulatory_reports.sql](../../../migrations/20260417000006_daily_regulatory_reports.sql)

---

## Why this module exists

The §71-verification report (May 2026) discovered that the canonical
regulatory-ledger tables were defined in migrations but **no TypeScript code
wrote to them**. The aktive code-path used `app_rg_compliance_ledger`, which
lacks the immutability-trigger and hash-chain that Lotteritilsynet expects
(per pengespillforskriften §71).

This module closes that gap with a parallel-write design:

```
ComplianceLedger.recordComplianceLedgerEvent(...)
  ├── INSERT app_rg_compliance_ledger    ← legacy, primary, kept untouched
  └── (optional sink)
        └── INSERT app_regulatory_ledger ← new, hash-chained, immutable
```

The new path is **non-blocking**: a §71-store outage cannot break a wallet
mutation. Errors are logged but never propagated.

## Files

| File | Purpose |
|---|---|
| `RegulatoryLedgerHash.ts` | SHA-256 + canonical-JSON helpers (mirror of WalletAuditVerifier-pattern) |
| `RegulatoryLedgerStore.ts` | Postgres adapter — INSERT events, look up prev signed-hash, verify chain |
| `RegulatoryLedgerService.ts` | Maps `ComplianceLedgerEntry` → `RegulatoryLedgerInsertInput` |
| `DailyRegulatoryReportService.ts` | Aggregates ledger into `app_daily_regulatory_reports` (G3 + G4) |
| `*.test.ts` | 41 unit tests — pure-function, no DB |

## Hash-chain design

### Per-event chain (`app_regulatory_ledger.event_hash`)

One global chain across all events. SHA-256 input:

```
prev_hash || canonicalJSON({
  amount_nok: "100.00",       // STRING — no JS-float jitter
  channel: "INTERNET",
  created_at: "2026-05-09T10:30:00.000Z",
  event_date: "2026-05-09",
  hall_id: "...",
  id: "...",
  ticket_ref: null,           // NULL preserved
  transaction_type: "TICKET_SALE"
})
```

Keys sorted alphabetically. `metadata` is **excluded** from the hash (matches
migration comment `app_regulatory_ledger.metadata`) — tampering with metadata
never breaks the chain since money-amounts are not stored there.

GENESIS sentinel: `"0".repeat(64)` (64 hex zeros).

### Per-day chain (`app_daily_regulatory_reports.signed_hash`)

ONE chain per `(hall_id, channel)` tuple. Rationale:
- Lotteritilsynet can audit one hall in isolation
- Channel separation matches §11-distribution rules (15% vs 30%)

Same canonical-JSON pattern, hash-input includes:
- `report_date`, `hall_id`, `channel`
- `ticket_turnover_nok`, `prizes_paid_nok` (STRING)
- `tickets_sold_count`, `unique_players` (INTEGER)
- `ledger_first_sequence`, `ledger_last_sequence` (STRING)

`prev_hash` = previous DAY's `signed_hash` for same `(hall, channel)` chain
or NULL/GENESIS for the first row.

## Wiring

`apps/backend/src/index.ts` boot block:

```typescript
const regulatoryLedgerStore = new RegulatoryLedgerStore({ pool, schema });
const regulatoryLedgerService = new RegulatoryLedgerService({ store: regulatoryLedgerStore });
engine.getComplianceLedgerInstance().setRegulatoryLedgerSink(async (entry) => {
  await regulatoryLedgerService.recordFromComplianceEvent(entry);
});
const dailyRegulatoryReportService = new DailyRegulatoryReportService({
  pool, schema, store: regulatoryLedgerStore,
});
// Then passed to createDailyReportScheduler(...) as `regulatoryReportService`.
```

Both ledger-sink and daily-report-service are skipped when:
- `platformConnectionString` is empty (dev-without-DB)
- the §71-store wiring throws

In both cases the legacy flow continues — only the §71-canonical path is
disabled.

## Sign convention

`app_regulatory_ledger.amount_nok` is signed:
- positive for `TICKET_SALE` (omsetning IN)
- negative for `PRIZE_PAYOUT`, `REFUND` (penger UT)
- positive default for `ADJUSTMENT` (organization-distribution, house-retained,
  house-deficit — caller can pass negative via legacy entry but `mapEntry`
  applies `Math.abs()` and re-applies the sign for consistency)

## Daily-report aggregation (G3 + G4)

`DailyRegulatoryReportService.generateForDate()`:

1. Query `app_regulatory_ledger` for the date, group by `(hall_id, channel)`
2. Per bucket compute:
   - `ticket_turnover_nok` = SUM of TICKET_SALE amounts (positive)
   - `prizes_paid_nok` = ABS(SUM of PRIZE_PAYOUT amounts) — stored signed-negative, aggregated as positive magnitude
   - `tickets_sold_count` = COUNT(*) of TICKET_SALE rows
   - `unique_players` = COUNT(DISTINCT user_id) of TICKET_SALE rows where user_id IS NOT NULL
   - `ledger_first_sequence` / `ledger_last_sequence` = MIN/MAX of `sequence` for ALL events in bucket
3. Look up the previous day's `signed_hash` for `(hall, channel)` — or
   GENESIS if first day in chain
4. Compute `signed_hash` = SHA-256(prev_hash || canonicalJSON(this row))
5. INSERT with `ON CONFLICT (report_date, hall_id, channel) DO NOTHING`
   (idempotent re-run)

If a `(hall, channel)` chain has no prior `signed_hash` we log
`chainsStartedFromGenesis` so admin can confirm it's expected (initial deploy)
or investigate (chain gap).

## Verifier

Both stores expose `verifyChain()`:
- `RegulatoryLedgerStore.verifyChain({ sinceDate? })` — walks all events
- `DailyRegulatoryReportService.verifyChain({ hallId, channel, sinceDate? })` — walks one (hall, channel) chain

Returns mismatches with reason=`event_hash_mismatch` or `previous_hash_mismatch`.
Empty array means chain is intact.

## Out-of-scope (G5+ followups)

| Gap | Status | Notes |
|---|---|---|
| G1 (sendings-kanal til Lotteritilsynet) | Not started | Awaiting brev-svar fra Lotteritilsynet |
| G5 (`npm run verify:audit-chain` script) | Not started | Skeleton exists in store/service — just needs CLI binding |
| G6 (Lotteritilsynet format-bekreftelse) | Not started | Request brev to Lotteritilsynet |
| G7 (PDF-export) | Not started | Build on top of `reportExport.ts` |
| G8 (ADR-0004 update) | Not started | ADR-0014 should be written to capture canonical truth |
| G9 (wallet vs ledger reconciliation) | Not started | Daily check job |
| G10 (real-time dashboard) | Not started | Frontend |
| G11 (XML/iXBRL export) | Not started | If Lotteritilsynet requires |
| G12 (backfill `app_rg_compliance_ledger` → `app_regulatory_ledger`) | Not started | Script with ON-CONFLICT DO NOTHING |

After ~1 month of dual-write data, we can flip the primary path so
`app_regulatory_ledger` becomes canonical and `app_rg_compliance_ledger`
becomes the fire-and-forget compatibility-mirror.

## References

- Pengespillforskriften §71 — daily reporting requirement
- BIN-764 — wallet hash-chain (`WalletAuditVerifier`-pattern we mirror)
- ADR-0004 — original audit-trail spec (partly outdated; see G8)
- `docs/compliance/SPILL71_DAILY_REPORT_VERIFICATION_2026-Q3.md` — verification report
- `docs/architecture/SPILL_REGLER_OG_PAYOUT.md` — gameType + cap rules
