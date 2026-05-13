---
name: anti-fraud-detection
description: When the user/agent works with anti-fraud / velocity / bot-detection signals on wallet mutations in the Spillorama bingo platform (BIN-806 / A13). Also use when they mention AntiFraudService, AntiFraudWalletAdapter, app_anti_fraud_signals, fraud-risk, FRAUD_RISK_CRITICAL, FRAUD_RISK_HIGH, VELOCITY_HOUR, VELOCITY_DAY, AMOUNT_DEVIATION, MULTI_ACCOUNT_IP, BOT_TIMING, antiFraudContext, pre-commit decoration, velocity-check, bot-detection, multi-account-IP, AML red-flag, RedFlagPlayersReport, AmlService.flag, money-mule. Anti-fraud rides on top of the casino-grade wallet via the AntiFraudWalletAdapter pattern — it never blocks legitimate play, but it MUST throw pre-commit on critical risk and ALWAYS fail open on DB-errors. Make sure to use this skill whenever someone touches WalletAdapter wrapping, anti-fraud signal evaluation, or AML red-flag emission — even if the change looks like "just a velocity tweak" — because mis-tuning can either flood ops or silently miss money-mule rings.
metadata:
  version: 1.0.0
  project: spillorama
---

<!-- scope: apps/backend/src/security/AntiFraudService.ts, apps/backend/src/security/AntiFraudWalletAdapter.ts, apps/backend/src/security/__tests__/AntiFraud*.test.ts, apps/backend/src/routes/adminAntiFraud.ts, apps/backend/src/routes/__tests__/adminAntiFraud.test.ts, apps/backend/src/compliance/AmlService.ts -->

# Anti-Fraud Detection (BIN-806 / A13)

Anti-fraud rides on top of the casino-grade wallet as a **decorating adapter**. It evaluates signals (velocity, deviation, IP-clustering, bot-timing) on every wallet mutation, classifies risk, and decides:

- `critical` → throw pre-commit (wallet untouched, transaction rolled back)
- `high` → flag for review (`AmlService.flag` / `app_aml_red_flags`), commit normally
- `medium`/`low` → log only, commit normally

Important: this is a Lotteritilsynet-grade signal-system, NOT a hard player-block. False positives cost trust; false negatives cost a money-mule investigation. Tune carefully.

## Kontekst (read first)

- Linear: BIN-806 (A13 Anti-fraud / velocity-checks), referenced in `docs/operations/PM_HANDOFF_2026-05-01.md`
- ADR-003 hash-chain audit (`docs/decisions/ADR-003-hash-chain-audit.md`) — anti-fraud signals must hash-chain via AuditLogService
- Existing AML red-flag infra:
  - `apps/backend/src/compliance/AmlService.ts` (rule-catalog, flag emission, severity)
  - `apps/backend/src/admin/reports/RedFlagPlayersReport.ts` + `RedFlagCategoriesReport.ts`
  - `app_aml_rules`, `app_aml_red_flags` tables
- Wallet adapter pattern:
  - `apps/backend/src/adapters/WalletAdapter.ts` (the interface)
  - `apps/backend/src/adapters/PostgresWalletAdapter.ts` (the base implementation with hash-chain)
- Skill `audit-hash-chain` — every signal write must respect hash-chain integrity

> **NOTE for implementing agent:** A dedicated `docs/architecture/ANTI_FRAUD_ARCHITECTURE.md` does not yet exist (2026-05-08). When BIN-806 is built, that doc must be created and this skill updated to point at it as the canonical source.

## Kjerne-arkitektur

### Decorator pattern over WalletAdapter

The anti-fraud system ships as `AntiFraudWalletAdapter` wrapping the existing `PostgresWalletAdapter`. All wallet calls (`debit`, `credit`, `refund`, `transfer`) flow through it; the inner adapter does the casino-grade transaction and the wrapper decorates with risk-evaluation.

```
caller → AntiFraudWalletAdapter.debit(req)
          ├─ pre-evaluate signals (read-only, no commit)
          ├─ if risk == critical → throw FraudRiskCriticalError (no DB write)
          ├─ inner.debit(req)  ← real wallet mutation in REPEATABLE READ tx
          ├─ post-evaluate (with knowledge of the just-written entry)
          ├─ if risk in [high, medium, low] → AmlService.flag(...) + signal-row
          └─ return inner result
```

If pre-evaluate rejects: caller gets the error, the inner adapter is never touched, the player sees a generic "operation rejected" message (no fraud-detail leak — that's an info-leak vector).

### `TransactionOptions.antiFraudContext`

The wrapper requires callers to populate `antiFraudContext`:

```typescript
interface AntiFraudContext {
  ipAddress: string | null;
  userAgent: string | null;
  sessionId: string | null;
  triggeredFrom: 'ticket-purchase' | 'manual-deposit' | 'admin-override' | ...;
  // optionally: device fingerprint, geo, etc.
}
```

This is added via TypeScript module-augmentation on `WalletAdapter.TransactionOptions`. Routes that call wallet without providing this context fail at compile-time.

### Five canonical heuristics

The first version implements:

| Signal | Trigger | Risk-level (default) |
|---|---|---|
| `VELOCITY_HOUR` | > N transactions in last 60 min | medium |
| `VELOCITY_DAY` | > M transactions in last 24 h | medium → high (configurable) |
| `AMOUNT_DEVIATION` | Single transaction > K× user's 30-day p95 amount | high |
| `MULTI_ACCOUNT_IP` | > P distinct user_ids on same IP in last 24h | high |
| `BOT_TIMING` | Time-between-actions stddev < S ms (super-human regularity) | high → critical (with BOT_TIMING + MULTI_ACCOUNT_IP combined) |

Thresholds (`N`, `M`, `K`, `P`, `S`) live in `app_anti_fraud_rules` — admin-tunable, audit-logged. Never hardcode in service logic.

### Risk-pipeline = max across signals

For one transaction, run ALL applicable signals. Risk for the txn = `max(severity)` across triggered signals. Multiple signals at the same level escalate to next level (e.g. two `high` → one `critical`).

`critical` is the only level that throws pre-commit. Everything else is post-commit decoration.

### Fail-open on DB-errors

If the anti-fraud service can't read its rules or write a signal-row (DB hiccup, Redis outage), the wallet operation MUST commit anyway. We do not block legitimate play because our risk-system is sick. Errors are logged + Prometheus-counter + ops-alert, but the player flow is preserved.

This is the opposite of the wallet itself, which is fail-closed. Anti-fraud is **decoration, not gating**.

## Immutable beslutninger

1. **Decorator, not replacement.** Anti-fraud wraps the existing wallet adapter; it does not replace or fork it. The hash-chain inside `PostgresWalletAdapter` is untouched.
2. **`critical` is the only pre-commit reject.** All other levels are post-commit.
3. **Fail-open on DB errors.** Anti-fraud unavailability never blocks a player.
4. **No fraud-detail in player-facing error messages.** A generic "rejected" message; details only in ops-logs and AML-flag-rows.
5. **Thresholds are admin-tunable.** Never hardcoded in service logic. All threshold-changes are AuditLogService events.
6. **Signal-rows hash-chain.** They go through `AuditLogService` (or are otherwise hash-chained to the same compliance chain). See `audit-hash-chain` skill.
7. **`antiFraudContext` is mandatory for player-facing wallet calls.** Admin-override paths can pass `triggeredFrom: 'admin-override'` with a justification; all admin-overrides are audit-logged separately.

## Vanlige feil og hvordan unngå dem

1. **Hardcoding thresholds in TypeScript.** Wrong — admins must tune them without code-deploy. Read from `app_anti_fraud_rules` with sane fallbacks.
2. **Throwing on `high` risk.** No — only `critical` throws. `high` is a flag-and-pass.
3. **Failing closed when the rules-table is unreachable.** No — fail open. The wallet flow continues.
4. **Returning fraud-reason to the player.** Info-leak. Don't.
5. **Bypassing the wrapper for "performance" or "internal" transactions.** All wallet mutations go through one adapter chain. If you have an admin-tool flow that legitimately bypasses anti-fraud, model it explicitly with `triggeredFrom: 'admin-override'` so it's still audit-logged.
6. **Mixing post-commit signal-writes with the wallet's own transaction.** They run in separate transactions — the wallet has committed when post-evaluate runs. If post-write fails, log + retry-queue, don't roll back the wallet.
7. **Using `BOT_TIMING` alone to throw `critical`.** Easy false positive on power-users. Combine with `MULTI_ACCOUNT_IP` or `AMOUNT_DEVIATION` before escalating to critical.
8. **Forgetting to populate `antiFraudContext` in a new route.** Compile-time-checked if the type is set up correctly via module-augmentation; verify the type-error catches you in CI.

## Operational tuning

Anti-fraud has a curve: too tight → false positives flood AML queue, real signals get ignored. Too loose → real money-mule misses get through.

- Start in **shadow-mode** (signals computed, NEVER throw critical, only log). Run for 2-4 weeks in pilot.
- Compare flag-rate against known-good behaviour to set thresholds.
- Once stabilised, flip critical-throws on and watch ops-board for 1 week.
- Re-tune monthly during first 3 months.

## Kanonisk referanse

- Linear: BIN-806
- ADR (audit hash-chain): `docs/decisions/ADR-003-hash-chain-audit.md`
- Wallet adapter: `apps/backend/src/adapters/WalletAdapter.ts` + `PostgresWalletAdapter.ts`
- AML existing infra: `apps/backend/src/compliance/AmlService.ts`
- Red-flag reports: `apps/backend/src/admin/reports/RedFlagPlayersReport.ts`
- (TBD) `docs/architecture/ANTI_FRAUD_ARCHITECTURE.md` — must be created when BIN-806 lands.

## Når denne skill-en er aktiv

LOAD when:
- Implementing or modifying `AntiFraudService` / `AntiFraudWalletAdapter`
- Adding a new fraud signal or modifying threshold-evaluation
- Adding a new wallet route that needs `antiFraudContext`
- Touching `app_anti_fraud_rules` or `app_anti_fraud_signals` schema
- Reviewing a PR that wraps or unwraps wallet adapter chain
- Investigating a "false positive flood" or "missed signal" ops-incident

SKIP when:
- Pure UI work that doesn't touch wallet flows
- Reports/dashboards that read existing flag-rows (just SQL)
- Test fixtures that don't assert risk-classification behaviour
