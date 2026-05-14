/**
 * Synthetic Spill 1 bingo-round-test — invariant evaluators.
 *
 * Pure-compute functions that consume snapshots captured by the bot and
 * return PASS/FAIL verdicts for the six pilot-go-live invariants (I1-I6)
 * defined in the synthetic-test runbook
 * (`docs/operations/SYNTHETIC_BINGO_TEST_RUNBOOK.md`).
 *
 * These functions are EXPLICITLY pure: they take captured snapshots
 * (`PlayerWalletSnapshot[]`, `PurchaseRecord[]`, `PayoutRecord[]`, etc.)
 * and return `InvariantResult` objects with a `verdict` of `"PASS"` /
 * `"FAIL"` / `"WARN"` plus a human-readable `details` string. They do NOT
 * mutate state, query the DB, or call the API — that is the bot's job.
 * Pure separation means we can unit-test the invariants without spinning
 * up a backend (covered by `scripts/__tests__/synthetic/spill1-round-bot.test.ts`).
 *
 * Why pure-compute?
 *   1. Reproducibility — given the same input snapshots, the same verdicts.
 *   2. Testability — feed mock-data, assert verdict shape.
 *   3. Auditability — Lotteritilsynet can re-run the same calculation off
 *      a captured snapshot file without re-running the round itself.
 *
 * The six invariants follow `LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md`
 * §3.3 spirit (structural invariants over heuristic checks):
 *
 *   I1: Wallet-konservering
 *       `SUM(balance_before) - SUM(tickets_bought × price) + SUM(payout) ==
 *        SUM(balance_after)`
 *
 *   I2: Compliance-ledger entries skrevet
 *       `compliance_audit_log` har en STAKE-entry per ticket-kjøp + en
 *       PRIZE-entry per payout.
 *
 *   I3: Hash-chain intakt
 *       Walker the last N wallet-entries and verifies the chain.
 *
 *   I4: Draw-sequence consistency
 *       All players see the same draw sequence in the same order.
 *
 *   I5: Idempotency
 *       Re-running with same clientRequestId-er does not duplicate rows.
 *
 *   I6: Round-end-state
 *       `scheduled_game.status === 'finished'` after the last phase.
 *
 * Convention: invariants accept a single typed snapshot object and return a
 * single `InvariantResult`. The runner aggregates the results, prints
 * PASS/FAIL summaries, and exits non-zero if any FAIL.
 */

/**
 * Wallet snapshot captured before and after the round. Balance is in øre
 * (cents) for precision — no floating-point arithmetic.
 */
export interface PlayerWalletSnapshot {
  userId: string;
  walletId: string;
  email: string;
  balanceBeforeCents: number;
  balanceAfterCents: number;
}

/**
 * One ticket purchase recorded by the bot. Captures everything we need to
 * verify wallet-conservation and ledger-entries without re-querying the DB.
 */
export interface PurchaseRecord {
  userId: string;
  walletId: string;
  purchaseId: string;
  totalAmountCents: number;
  ticketCount: number;
  clientRequestId: string;
  alreadyExisted: boolean;
}

/**
 * One payout (PRIZE-event) recorded by the bot.
 */
export interface PayoutRecord {
  userId: string;
  walletId: string;
  amountCents: number;
  phase: string;
  patternName: string;
}

/**
 * Captured snapshot of audit-log entry counts. Pulled from a token-gated
 * dev-endpoint or via direct DB query — the bot is the producer, this
 * module is the consumer.
 */
export interface AuditLedgerSnapshot {
  /** Count of STAKE-entries (ticket purchases) observed in the round. */
  stakeEntries: number;
  /** Count of PRIZE-entries (payouts) observed in the round. */
  prizeEntries: number;
  /** Count of HOUSE-RETAINED entries (floor-rest from pot-split). */
  houseRetainedEntries?: number;
}

/**
 * Hash-chain verification result from the WalletAuditVerifier (or a
 * simplified bot-side walker). `ok = true` means all examined entries
 * had a valid `previous_entry_hash → entry_hash` link.
 */
export interface HashChainSnapshot {
  entriesChecked: number;
  entriesValid: number;
  mismatches: number;
  /**
   * Whether the chain was verified end-to-end. `null` if hash-chain
   * verification was skipped (e.g. token-gated endpoint disabled).
   */
  chainOk: boolean | null;
}

/**
 * Per-player observation of the draw-sequence.
 */
export interface DrawSequenceSnapshot {
  userId: string;
  drawnNumbers: number[];
}

/**
 * Final state of the scheduled-game record after the round completes.
 */
export interface ScheduledGameFinalState {
  scheduledGameId: string;
  status: string; // 'finished' | 'running' | 'paused' | etc.
  drawsTotal: number;
}

/**
 * Invariant verdict. We use `"WARN"` for non-blocking issues (e.g. hash-
 * chain verification skipped because the dev-endpoint was disabled),
 * `"PASS"` when everything checks out, and `"FAIL"` for any structural
 * brudd that should block pilot-go-live.
 */
export type InvariantVerdict = "PASS" | "FAIL" | "WARN";

export interface InvariantResult {
  /** Stable identifier (I1-I6). Used in reports + CI exit-codes. */
  id: "I1" | "I2" | "I3" | "I4" | "I5" | "I6";
  /** Short title for human-readable reports. */
  title: string;
  /** PASS / FAIL / WARN. */
  verdict: InvariantVerdict;
  /** Multi-line details. Always includes evidence (numbers, ids). */
  details: string;
}

// ── I1: Wallet conservation ─────────────────────────────────────────────

/**
 * Verify the global wallet-conservation invariant:
 *
 *   SUM(balance_before_all_players)
 *     - SUM(tickets_bought × price_per_ticket)
 *     + SUM(payouts)
 *   == SUM(balance_after_all_players)
 *
 * Rationale: bingo is a zero-sum game between players + house. Money
 * doesn't disappear or appear. If the equation is off by even 1 øre,
 * something is structurally wrong (double-debit, lost payout, race
 * condition between purchase and payout).
 *
 * NOTE: We compute the equation in øre (integer math). Floor-rest from
 * pot-split goes to HOUSE_RETAINED (see SPILL_REGLER_OG_PAYOUT.md §9.7).
 * The bot does not see HOUSE_RETAINED entries directly, so we accept a
 * tolerance equal to the number of unique winning combinations × 1 øre
 * (worst case floor-rest = N entries × 1 øre).
 */
export function evaluateWalletConservation(input: {
  wallets: PlayerWalletSnapshot[];
  purchases: PurchaseRecord[];
  payouts: PayoutRecord[];
  /** Maximum tolerated rounding-loss in øre (defaults to 1 per winner). */
  floorRestToleranceCents?: number;
}): InvariantResult {
  const totalBefore = input.wallets.reduce(
    (sum, w) => sum + w.balanceBeforeCents,
    0
  );
  const totalAfter = input.wallets.reduce(
    (sum, w) => sum + w.balanceAfterCents,
    0
  );
  // Only count purchases that actually moved money — `alreadyExisted=true`
  // is idempotent re-submit and did NOT re-debit the wallet.
  const totalSpent = input.purchases
    .filter((p) => !p.alreadyExisted)
    .reduce((sum, p) => sum + p.totalAmountCents, 0);
  const totalWon = input.payouts.reduce((sum, p) => sum + p.amountCents, 0);

  const expectedAfter = totalBefore - totalSpent + totalWon;
  const delta = totalAfter - expectedAfter;
  const tolerance =
    input.floorRestToleranceCents ?? Math.max(1, input.payouts.length);

  const details =
    `wallets=${input.wallets.length}` +
    ` | totalBefore=${totalBefore}` +
    ` | totalAfter=${totalAfter}` +
    ` | totalSpent=${totalSpent}` +
    ` | totalWon=${totalWon}` +
    ` | expectedAfter=${expectedAfter}` +
    ` | delta=${delta} øre` +
    ` | tolerance=${tolerance} øre`;

  if (Math.abs(delta) > tolerance) {
    return {
      id: "I1",
      title: "Wallet-konservering",
      verdict: "FAIL",
      details: `${details} | BRUDD: delta utenfor tolerance (HOUSE_RETAINED floor-rest)`,
    };
  }
  return {
    id: "I1",
    title: "Wallet-konservering",
    verdict: "PASS",
    details,
  };
}

// ── I2: Compliance-ledger entries ───────────────────────────────────────

/**
 * Verify that the compliance-ledger has at least one STAKE-entry per
 * unique ticket purchase (idempotent re-submits with alreadyExisted=true
 * do not count) and at least one PRIZE-entry per payout.
 *
 * Note: this is a count-check, not an exact-match check. The ledger may
 * have additional entries (compliance-flush, mini-game, etc.) — we only
 * verify the minimum.
 */
export function evaluateComplianceLedger(input: {
  purchases: PurchaseRecord[];
  payouts: PayoutRecord[];
  ledger: AuditLedgerSnapshot;
}): InvariantResult {
  const uniquePurchases = input.purchases.filter((p) => !p.alreadyExisted)
    .length;
  const payouts = input.payouts.length;
  const minStakes = uniquePurchases;
  const minPrizes = payouts;

  const details =
    `purchases=${uniquePurchases} (unique)` +
    ` | payouts=${payouts}` +
    ` | ledger.stake=${input.ledger.stakeEntries}` +
    ` | ledger.prize=${input.ledger.prizeEntries}` +
    ` | min.stake=${minStakes} | min.prize=${minPrizes}`;

  if (input.ledger.stakeEntries < minStakes) {
    return {
      id: "I2",
      title: "Compliance-ledger entries skrevet",
      verdict: "FAIL",
      details: `${details} | BRUDD: færre STAKE-entries enn forventet`,
    };
  }
  if (input.ledger.prizeEntries < minPrizes) {
    return {
      id: "I2",
      title: "Compliance-ledger entries skrevet",
      verdict: "FAIL",
      details: `${details} | BRUDD: færre PRIZE-entries enn forventet`,
    };
  }
  return {
    id: "I2",
    title: "Compliance-ledger entries skrevet",
    verdict: "PASS",
    details,
  };
}

// ── I3: Hash-chain integrity ────────────────────────────────────────────

/**
 * Verify hash-chain integrity. If `chainOk === null`, we report WARN —
 * dry-run mode or token-gated endpoint disabled. Real failures (mismatch
 * detected) are FAIL.
 */
export function evaluateHashChain(input: HashChainSnapshot): InvariantResult {
  const details =
    `entriesChecked=${input.entriesChecked}` +
    ` | entriesValid=${input.entriesValid}` +
    ` | mismatches=${input.mismatches}` +
    ` | chainOk=${input.chainOk === null ? "skipped" : input.chainOk}`;

  if (input.chainOk === null) {
    return {
      id: "I3",
      title: "Hash-chain intakt",
      verdict: "WARN",
      details: `${details} | hopper over (token-gated endpoint disabled eller dry-run)`,
    };
  }
  if (!input.chainOk || input.mismatches > 0) {
    return {
      id: "I3",
      title: "Hash-chain intakt",
      verdict: "FAIL",
      details: `${details} | BRUDD: hash-chain mismatch`,
    };
  }
  return {
    id: "I3",
    title: "Hash-chain intakt",
    verdict: "PASS",
    details,
  };
}

// ── I4: Draw-sequence consistency ───────────────────────────────────────

/**
 * Verify that all players saw the same draw-sequence in the same order.
 * Draw-replay is the only "ground truth" that all players observe live —
 * if two players see different sequences, the broadcaster is broken.
 *
 * Players may have joined mid-round, so we compare prefixes (the shorter
 * sequence must equal a prefix of the longer one). We pick the longest
 * observation as the canonical truth and verify all others are prefixes.
 */
export function evaluateDrawSequence(
  input: DrawSequenceSnapshot[]
): InvariantResult {
  if (input.length === 0) {
    return {
      id: "I4",
      title: "Draw-sequence consistency",
      verdict: "WARN",
      details: "ingen draw-sequences observert (mode=dry-run?)",
    };
  }

  const longest = input.reduce((a, b) =>
    a.drawnNumbers.length >= b.drawnNumbers.length ? a : b
  );

  const inconsistencies: string[] = [];
  for (const obs of input) {
    if (obs.userId === longest.userId) continue;
    // obs.drawnNumbers must equal longest.drawnNumbers[0..obs.length-1]
    for (let i = 0; i < obs.drawnNumbers.length; i++) {
      if (obs.drawnNumbers[i] !== longest.drawnNumbers[i]) {
        inconsistencies.push(
          `${obs.userId}: draw[${i}] = ${obs.drawnNumbers[i]} vs ${longest.userId}: draw[${i}] = ${longest.drawnNumbers[i]}`
        );
        break;
      }
    }
  }

  const details =
    `players=${input.length}` +
    ` | longestSequence=${longest.drawnNumbers.length} draws` +
    ` | inconsistencies=${inconsistencies.length}`;

  if (inconsistencies.length > 0) {
    return {
      id: "I4",
      title: "Draw-sequence consistency",
      verdict: "FAIL",
      details: `${details}\n  ${inconsistencies.slice(0, 5).join("\n  ")}`,
    };
  }
  return {
    id: "I4",
    title: "Draw-sequence consistency",
    verdict: "PASS",
    details,
  };
}

// ── I5: Idempotency ─────────────────────────────────────────────────────

/**
 * Verify idempotency:
 *
 *   Given N purchases with K unique clientRequestId-er, the server
 *   should report exactly K unique purchaseIds and (N - K) re-submits
 *   should have `alreadyExisted = true`.
 *
 * Re-running this test with the same `--seed` (CI mode) MUST produce the
 * same uniques + alreadyExisted counts on the second run. The bot calls
 * the purchase API twice for each ticket with the same clientRequestId
 * during the idempotency-probe phase.
 */
export function evaluateIdempotency(input: {
  purchases: PurchaseRecord[];
  /**
   * How many of the purchases were intentional re-submits (the bot
   * sends each purchase twice in idempotency-probe mode). If the bot
   * does not run the probe (e.g. dry-run), set to 0.
   */
  intentionalDuplicates: number;
}): InvariantResult {
  const uniqueClientRequestIds = new Set(
    input.purchases.map((p) => p.clientRequestId)
  );
  const uniquePurchaseIds = new Set(input.purchases.map((p) => p.purchaseId));
  const alreadyExisted = input.purchases.filter((p) => p.alreadyExisted).length;

  const details =
    `totalPurchases=${input.purchases.length}` +
    ` | uniqueClientRequestIds=${uniqueClientRequestIds.size}` +
    ` | uniquePurchaseIds=${uniquePurchaseIds.size}` +
    ` | alreadyExisted=${alreadyExisted}` +
    ` | intentionalDuplicates=${input.intentionalDuplicates}`;

  // Expect: number of unique purchaseIds == number of unique clientRequestIds
  if (uniquePurchaseIds.size !== uniqueClientRequestIds.size) {
    return {
      id: "I5",
      title: "Idempotency",
      verdict: "FAIL",
      details: `${details} | BRUDD: server opprettet flere purchaseIds enn clientRequestIds`,
    };
  }
  // Expect: alreadyExisted >= intentionalDuplicates
  // (we may see more alreadyExisted if reconnect re-sent purchases — that's fine)
  if (alreadyExisted < input.intentionalDuplicates) {
    return {
      id: "I5",
      title: "Idempotency",
      verdict: "FAIL",
      details: `${details} | BRUDD: færre alreadyExisted enn intentionalDuplicates`,
    };
  }
  return {
    id: "I5",
    title: "Idempotency",
    verdict: "PASS",
    details,
  };
}

// ── I6: Round-end-state ─────────────────────────────────────────────────

/**
 * Verify the round actually ended cleanly. After the bot has waited for
 * the round-end signal (or timed out), the scheduled-game record should
 * have `status === 'finished'`.
 *
 * Allowed statuses: `'finished'`. Anything else (`'running'`, `'paused'`,
 * `'cancelled'`) is FAIL.
 *
 * If the bot was run in dry-mode (no real round), we accept `null` ID
 * and report WARN.
 */
export function evaluateRoundEndState(
  input: ScheduledGameFinalState | null
): InvariantResult {
  if (input === null) {
    return {
      id: "I6",
      title: "Round-end-state",
      verdict: "WARN",
      details: "scheduled-game state ikke fanget (dry-run eller skip)",
    };
  }
  const details =
    `scheduledGameId=${input.scheduledGameId}` +
    ` | status=${input.status}` +
    ` | drawsTotal=${input.drawsTotal}`;

  if (input.status !== "finished") {
    return {
      id: "I6",
      title: "Round-end-state",
      verdict: "FAIL",
      details: `${details} | BRUDD: status ≠ 'finished'`,
    };
  }
  return {
    id: "I6",
    title: "Round-end-state",
    verdict: "PASS",
    details,
  };
}

// ── Aggregate ──────────────────────────────────────────────────────────

export interface InvariantSummary {
  pass: number;
  fail: number;
  warn: number;
  results: InvariantResult[];
}

export function summarizeInvariants(
  results: InvariantResult[]
): InvariantSummary {
  return {
    pass: results.filter((r) => r.verdict === "PASS").length,
    fail: results.filter((r) => r.verdict === "FAIL").length,
    warn: results.filter((r) => r.verdict === "WARN").length,
    results,
  };
}
