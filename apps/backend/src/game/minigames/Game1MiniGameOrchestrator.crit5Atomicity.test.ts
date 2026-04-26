/**
 * CRIT-5 (SPILL1_CASINO_GRADE_REVIEW_2026-04-26):
 *
 * Mini-game wallet-credit + UPDATE av completed_at skal skje i SAMME
 * atomiske transaksjon. Tidligere brukte vi `walletAdapter.credit()`
 * som åpnet egen tx — hvis den committet og UPDATE feilet (DB-disconnect,
 * lock timeout), var pengene betalt ut men `completed_at` fortsatt NULL.
 * Neste retry kalte handleChoice på nytt → ulik RNG → audit-trail
 * divergerte (regulatorisk issue).
 *
 * Disse testene verifiserer at:
 *   1. Når `walletAdapter.creditWithClient` er definert, brukes den
 *      med outer-tx-clienten (ikke legacy `credit`).
 *   2. Hvis UPDATE feiler etter creditWithClient, ruller hele
 *      transaksjonen tilbake — inkludert credit-en.
 *   3. Hvis adapteret ikke har `creditWithClient`, fall back til
 *      legacy `credit` (bakover-kompat for InMemory/File/Http-tester).
 *   4. Idempotency-key videresendes til creditWithClient.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  Game1MiniGameOrchestrator,
  type MiniGameBroadcaster,
} from "./Game1MiniGameOrchestrator.js";
import type {
  MiniGame,
  MiniGameChoiceInput,
  MiniGameResult,
  MiniGameTriggerContext,
  MiniGameTriggerPayload,
  MiniGameType,
} from "./types.js";
import type { WalletAdapter } from "../../adapters/WalletAdapter.js";

// ── Test helpers ──────────────────────────────────────────────────────────

interface QueryCall {
  sql: string;
  params: unknown[];
}

interface FakePoolClient {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  release: () => void;
}

/**
 * Pool som tracker queries og kan kaste på UPDATE for å simulere partial
 * failure mellom credit og UPDATE.
 */
function makePoolForCreditTest(opts: {
  resultRow: unknown;
  contextRows: { walletRow?: unknown; phaseWinnerRow?: unknown; assignmentRow?: unknown };
  failOnUpdate?: boolean;
}): {
  pool: {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
    connect: () => Promise<FakePoolClient>;
  };
  calls: QueryCall[];
  rollbackCount: number;
  commitCount: number;
} {
  const calls: QueryCall[] = [];
  let rollbackCount = 0;
  let commitCount = 0;

  const handleQuery = async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (sql.startsWith("BEGIN")) return { rows: [] };
    if (sql.startsWith("COMMIT")) {
      commitCount += 1;
      return { rows: [] };
    }
    if (sql.startsWith("ROLLBACK")) {
      rollbackCount += 1;
      return { rows: [] };
    }
    // FOR UPDATE lockResultRow.
    if (sql.includes("FOR UPDATE") && sql.includes("mini_game_results")) {
      return { rows: [opts.resultRow] };
    }
    // walletId fra app_users.
    if (sql.includes("FROM") && sql.includes("app_users") && sql.includes("wallet_id")) {
      return { rows: [opts.contextRows.walletRow ?? { wallet_id: "w-winner" }] };
    }
    // phase-winners.
    if (sql.includes("phase_winners")) {
      return {
        rows: opts.contextRows.phaseWinnerRow
          ? [opts.contextRows.phaseWinnerRow]
          : [],
      };
    }
    // assignments fallback.
    if (sql.includes("ticket_assignments")) {
      return {
        rows: opts.contextRows.assignmentRow
          ? [opts.contextRows.assignmentRow]
          : [{ hall_id: "h1" }],
      };
    }
    // UPDATE: credentials test.
    if (
      sql.includes("UPDATE") &&
      sql.includes("mini_game_results") &&
      sql.includes("completed_at")
    ) {
      if (opts.failOnUpdate) {
        throw new Error("simulated UPDATE failure (CRIT-5)");
      }
      return { rows: [] };
    }
    // mini-game-config (fetchConfigSnapshot — skipped in handleChoice).
    return { rows: [] };
  };

  return {
    pool: {
      query: handleQuery,
      connect: async () => ({
        query: handleQuery,
        release: () => undefined,
      }),
    },
    calls,
    get rollbackCount() {
      return rollbackCount;
    },
    get commitCount() {
      return commitCount;
    },
  };
}

function makeStubAuditLog() {
  return {
    service: {
      record: async () => undefined,
    } as unknown as import("../../compliance/AuditLogService.js").AuditLogService,
  };
}

function makeRecordingBroadcaster(): MiniGameBroadcaster {
  return {
    onTrigger: () => undefined,
    onResult: () => undefined,
  };
}

function makeFakeWheel(payoutCents: number): MiniGame {
  return {
    type: "wheel",
    trigger(ctx: MiniGameTriggerContext): MiniGameTriggerPayload {
      return {
        type: "wheel",
        resultId: ctx.resultId,
        payload: { mocked: true },
      };
    },
    async handleChoice(_input: MiniGameChoiceInput): Promise<MiniGameResult> {
      return { payoutCents, resultJson: { ok: true } };
    },
  };
}

const RESULT_ROW_TEMPLATE = {
  id: "result-1",
  scheduled_game_id: "sg-1",
  mini_game_type: "wheel",
  winner_user_id: "u-winner",
  config_snapshot_json: {},
  choice_json: null,
  result_json: null,
  payout_cents: 0,
  triggered_at: new Date(),
  completed_at: null,
};

// ── 1: creditWithClient brukes når adapter støtter den ─────────────────────

test("CRIT-5: creditWithClient brukes når walletAdapter implementerer den", async () => {
  const creditCalls: Array<{
    accountId: string;
    amount: number;
    options: { client: unknown; idempotencyKey?: string };
  }> = [];
  const legacyCreditCalls: Array<{ accountId: string; amount: number }> = [];

  const wallet: WalletAdapter = {
    credit: async (accountId, amount) => {
      legacyCreditCalls.push({ accountId, amount });
      return { id: "tx-legacy", accountId, amount } as never;
    },
    creditWithClient: async (accountId, amount, _reason, options) => {
      creditCalls.push({
        accountId,
        amount,
        options: {
          client: options.client,
          ...(options.idempotencyKey !== undefined
            ? { idempotencyKey: options.idempotencyKey }
            : {}),
        },
      });
      return { id: "tx-with-client", accountId, amount } as never;
    },
    debit: async () => {
      throw new Error("unused");
    },
    transfer: async () => {
      throw new Error("unused");
    },
  } as unknown as WalletAdapter;

  const { pool } = makePoolForCreditTest({
    resultRow: RESULT_ROW_TEMPLATE,
    contextRows: {
      walletRow: { wallet_id: "w-winner" },
      phaseWinnerRow: { hall_id: "h1", draw_sequence_at_win: 47 },
    },
  });

  const audit = makeStubAuditLog();
  const orchestrator = new Game1MiniGameOrchestrator({
    pool: pool as never,
    walletAdapter: wallet,
    auditLog: audit.service,
    broadcaster: makeRecordingBroadcaster(),
    miniGames: new Map<MiniGameType, MiniGame>([["wheel", makeFakeWheel(5000)]]),
  });

  await orchestrator.handleChoice({
    resultId: "result-1",
    userId: "u-winner",
    choiceJson: { pick: "yellow" },
  });

  // creditWithClient skal være kalt — én gang.
  assert.equal(creditCalls.length, 1, "creditWithClient skal være kalt");
  assert.equal(creditCalls[0]!.amount, 50, "5000 øre = 50 kr");
  assert.equal(creditCalls[0]!.accountId, "w-winner");
  assert.ok(creditCalls[0]!.options.client, "client skal være satt");
  assert.ok(
    creditCalls[0]!.options.idempotencyKey,
    "idempotency-key skal være videresendt",
  );

  // Legacy credit skal IKKE være kalt — vi prefererer client-aware.
  assert.equal(
    legacyCreditCalls.length,
    0,
    "legacy credit() skal IKKE være kalt når creditWithClient finnes",
  );
});

// ── 2: UPDATE-feil ruller credit-en tilbake (atomisk transaksjon) ──────────

test("CRIT-5: UPDATE-feil etter creditWithClient ruller hele transaksjonen tilbake", async () => {
  const wallet: WalletAdapter = {
    credit: async () => {
      throw new Error("legacy credit ikke kalt i denne testen");
    },
    creditWithClient: async () => {
      // Returnerer "som om" vi har skrevet til DB (innenfor tx — ikke
      // commit'et enda). Hvis caller deretter feiler og kaster, ruller
      // tx tilbake og credit-en utgår.
      return { id: "tx-rollback", accountId: "w-winner", amount: 50 } as never;
    },
    debit: async () => {
      throw new Error("unused");
    },
    transfer: async () => {
      throw new Error("unused");
    },
  } as unknown as WalletAdapter;

  const poolHelper = makePoolForCreditTest({
    resultRow: RESULT_ROW_TEMPLATE,
    contextRows: {
      walletRow: { wallet_id: "w-winner" },
      phaseWinnerRow: { hall_id: "h1", draw_sequence_at_win: 47 },
    },
    failOnUpdate: true,
  });

  const orchestrator = new Game1MiniGameOrchestrator({
    pool: poolHelper.pool as never,
    walletAdapter: wallet,
    auditLog: makeStubAuditLog().service,
    broadcaster: makeRecordingBroadcaster(),
    miniGames: new Map<MiniGameType, MiniGame>([["wheel", makeFakeWheel(5000)]]),
  });

  await assert.rejects(
    () =>
      orchestrator.handleChoice({
        resultId: "result-1",
        userId: "u-winner",
        choiceJson: { pick: "yellow" },
      }),
    /simulated UPDATE failure/,
  );

  // ROLLBACK skal ha skjedd (caller's tx er rullet tilbake).
  assert.equal(
    poolHelper.rollbackCount,
    1,
    "ROLLBACK skal ha kjørt etter UPDATE-feil",
  );
  // COMMIT skal IKKE ha kjørt.
  assert.equal(
    poolHelper.commitCount,
    0,
    "COMMIT skal IKKE ha kjørt — tx er rullet tilbake",
  );
});

// ── 3: Fallback til legacy credit hvis adapter ikke har creditWithClient ──

test("CRIT-5: faller tilbake til legacy credit() når creditWithClient mangler", async () => {
  const legacyCreditCalls: Array<{
    accountId: string;
    amount: number;
    idempotencyKey?: string;
  }> = [];

  const wallet: WalletAdapter = {
    credit: async (accountId, amount, _reason, options) => {
      legacyCreditCalls.push({
        accountId,
        amount,
        ...(options?.idempotencyKey !== undefined
          ? { idempotencyKey: options.idempotencyKey }
          : {}),
      });
      return { id: "tx-legacy", accountId, amount } as never;
    },
    // creditWithClient er ikke implementert.
    debit: async () => {
      throw new Error("unused");
    },
    transfer: async () => {
      throw new Error("unused");
    },
  } as unknown as WalletAdapter;

  const { pool } = makePoolForCreditTest({
    resultRow: RESULT_ROW_TEMPLATE,
    contextRows: {
      walletRow: { wallet_id: "w-winner" },
      phaseWinnerRow: { hall_id: "h1", draw_sequence_at_win: 47 },
    },
  });

  const orchestrator = new Game1MiniGameOrchestrator({
    pool: pool as never,
    walletAdapter: wallet,
    auditLog: makeStubAuditLog().service,
    broadcaster: makeRecordingBroadcaster(),
    miniGames: new Map<MiniGameType, MiniGame>([["wheel", makeFakeWheel(2500)]]),
  });

  await orchestrator.handleChoice({
    resultId: "result-1",
    userId: "u-winner",
    choiceJson: { pick: "white" },
  });

  // Legacy credit skal være kalt fordi creditWithClient mangler.
  assert.equal(legacyCreditCalls.length, 1);
  assert.equal(legacyCreditCalls[0]!.amount, 25, "2500 øre = 25 kr");
  assert.ok(
    legacyCreditCalls[0]!.idempotencyKey,
    "idempotency-key skal videresendes også i fallback",
  );
});

// ── 4: payoutCents = 0 → ingen credit-kall ────────────────────────────────

test("CRIT-5: payoutCents=0 → ingen credit eller creditWithClient kalles", async () => {
  let creditWithClientCalls = 0;
  let legacyCreditCalls = 0;

  const wallet: WalletAdapter = {
    credit: async () => {
      legacyCreditCalls += 1;
      return { id: "x", accountId: "x", amount: 0 } as never;
    },
    creditWithClient: async () => {
      creditWithClientCalls += 1;
      return { id: "x", accountId: "x", amount: 0 } as never;
    },
    debit: async () => {
      throw new Error("unused");
    },
    transfer: async () => {
      throw new Error("unused");
    },
  } as unknown as WalletAdapter;

  const { pool } = makePoolForCreditTest({
    resultRow: RESULT_ROW_TEMPLATE,
    contextRows: {
      walletRow: { wallet_id: "w-winner" },
      phaseWinnerRow: { hall_id: "h1", draw_sequence_at_win: 47 },
    },
  });

  const orchestrator = new Game1MiniGameOrchestrator({
    pool: pool as never,
    walletAdapter: wallet,
    auditLog: makeStubAuditLog().service,
    broadcaster: makeRecordingBroadcaster(),
    miniGames: new Map<MiniGameType, MiniGame>([["wheel", makeFakeWheel(0)]]),
  });

  await orchestrator.handleChoice({
    resultId: "result-1",
    userId: "u-winner",
    choiceJson: { pick: "purple" },
  });

  assert.equal(
    creditWithClientCalls,
    0,
    "ingen creditWithClient når payoutCents=0",
  );
  assert.equal(legacyCreditCalls, 0, "ingen credit når payoutCents=0");
});
