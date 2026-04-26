/**
 * REQ-146 — enhetstester for AgentMiniGameWinningService.
 *
 * Spec: docs/architecture/WIREFRAME_BACKEND_REQUIREMENTS_2026-04-25.md REQ-146
 *
 * Dekker:
 *   1. Happy-path: ny vinning → INSERT result-rad + wallet.credit kalt.
 *   2. Compliance-gate: AGENT_MINIGAME_NOT_ACTIVE når mini-gamen ikke i config.
 *   3. Compliance-gate: AGENT_MINIGAME_NOT_IN_ROUND når spilleren mangler
 *      assignment.
 *   4. Compliance-gate: AGENT_MINIGAME_ALREADY_PAID når completed_at != NULL
 *      med annen type/amount.
 *   5. Idempotent re-call: samme (gameId, playerId, type, amount) → no-op.
 *   6. INVALID_MINIGAME_TYPE: ugyldig type avvises.
 *   7. INVALID_INPUT: tom playerId/reason/amountCents avvises.
 *   8. GAME_NOT_FOUND: ukjent gameId.
 *   9. PLAYER_NOT_FOUND / PLAYER_HAS_NO_WALLET.
 *  10. amountCents <= 0 avvises (INVALID_INPUT).
 *  11. ComplianceLedger-feil ruller IKKE tilbake payout.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { Pool, PoolClient } from "pg";
import { AgentMiniGameWinningService } from "../AgentMiniGameWinningService.js";
import { DomainError } from "../../game/BingoEngine.js";
import type {
  WalletAdapter,
  WalletTransaction,
  CreditOptions,
} from "../../adapters/WalletAdapter.js";
import { WalletError } from "../../adapters/WalletAdapter.js";
import type { ComplianceLedgerPort } from "../../adapters/ComplianceLedgerPort.js";

interface MockGame {
  id: string;
  status: string;
  game_config_json: Record<string, unknown> | null;
}

interface MockUser {
  id: string;
  wallet_id: string | null;
}

interface MockAssignment {
  scheduled_game_id: string;
  buyer_user_id: string;
}

interface MockMiniResult {
  id: string;
  scheduled_game_id: string;
  mini_game_type: string;
  winner_user_id: string;
  config_snapshot_json: Record<string, unknown>;
  choice_json: Record<string, unknown> | null;
  result_json: Record<string, unknown> | null;
  payout_cents: number;
  triggered_at: Date;
  completed_at: Date | null;
}

interface MockStore {
  games: Map<string, MockGame>;
  users: Map<string, MockUser>;
  assignments: MockAssignment[];
  results: Map<string, MockMiniResult>;
}

function newStore(): MockStore {
  return {
    games: new Map(),
    users: new Map(),
    assignments: [],
    results: new Map(),
  };
}

function seedGame(
  store: MockStore,
  id: string,
  miniGames: string[] = ["wheel", "chest", "mystery", "colordraft"],
  status = "running",
): void {
  store.games.set(id, {
    id,
    status,
    game_config_json: { spill1: { miniGames } },
  });
}

function seedUser(store: MockStore, id: string, walletId: string | null = `w-${id}`): void {
  store.users.set(id, { id, wallet_id: walletId });
}

function seedAssignment(store: MockStore, gameId: string, playerId: string): void {
  store.assignments.push({
    scheduled_game_id: gameId,
    buyer_user_id: playerId,
  });
}

function seedResult(
  store: MockStore,
  r: Partial<MockMiniResult> & { id: string; scheduled_game_id: string; mini_game_type: string; winner_user_id: string },
): MockMiniResult {
  const now = new Date();
  const full: MockMiniResult = {
    config_snapshot_json: r.config_snapshot_json ?? {},
    choice_json: r.choice_json ?? null,
    result_json: r.result_json ?? null,
    payout_cents: r.payout_cents ?? 0,
    triggered_at: r.triggered_at ?? now,
    completed_at: r.completed_at ?? null,
    ...r,
  };
  store.results.set(full.id, full);
  return full;
}

function makeMockPool(store: MockStore): Pool {
  const runQuery = async (sql: string, params: unknown[] = []) => {
    const s = sql.trim();

    if (s === "BEGIN" || s === "COMMIT" || s === "ROLLBACK") {
      return { rows: [], rowCount: 0 };
    }

    if (
      sql.includes("FROM")
      && sql.includes("app_game1_scheduled_games")
      && sql.includes("WHERE id = $1")
    ) {
      const [id] = params as [string];
      const g = store.games.get(id);
      const rows = g
        ? [{
            id: g.id,
            status: g.status,
            game_config_json: g.game_config_json,
          }]
        : [];
      return { rows, rowCount: rows.length };
    }

    if (
      sql.includes("app_game1_ticket_assignments")
      && sql.includes("COUNT(*)")
    ) {
      const [gameId, playerId] = params as [string, string];
      const count = store.assignments.filter(
        (a) => a.scheduled_game_id === gameId && a.buyer_user_id === playerId,
      ).length;
      return { rows: [{ count: String(count) }], rowCount: 1 };
    }

    if (
      sql.includes("app_physical_tickets")
      && sql.includes("COUNT(*)")
    ) {
      // Mock: alltid 0 (testene bruker assignment-stien primært).
      return { rows: [{ count: "0" }], rowCount: 1 };
    }

    if (sql.includes("app_users") && sql.includes("WHERE id = $1")) {
      const [id] = params as [string];
      const u = store.users.get(id);
      const rows = u ? [{ wallet_id: u.wallet_id }] : [];
      return { rows, rowCount: rows.length };
    }

    if (
      sql.includes("FROM")
      && sql.includes("app_game1_mini_game_results")
      && sql.includes("WHERE scheduled_game_id = $1 AND winner_user_id = $2")
    ) {
      const [gameId, playerId] = params as [string, string];
      const found = [...store.results.values()].find(
        (r) =>
          r.scheduled_game_id === gameId && r.winner_user_id === playerId,
      );
      const rows = found
        ? [{
            id: found.id,
            scheduled_game_id: found.scheduled_game_id,
            mini_game_type: found.mini_game_type,
            winner_user_id: found.winner_user_id,
            config_snapshot_json: found.config_snapshot_json,
            choice_json: found.choice_json,
            result_json: found.result_json,
            payout_cents: found.payout_cents,
            triggered_at: found.triggered_at,
            completed_at: found.completed_at,
          }]
        : [];
      return { rows, rowCount: rows.length };
    }

    if (
      sql.includes("INSERT INTO")
      && sql.includes("app_game1_mini_game_results")
    ) {
      const [
        id,
        gameId,
        type,
        playerId,
        configJson,
        choiceJson,
        resultJson,
        payoutCents,
      ] = params as [string, string, string, string, string, string, string, number];
      const row: MockMiniResult = {
        id,
        scheduled_game_id: gameId,
        mini_game_type: type,
        winner_user_id: playerId,
        config_snapshot_json: JSON.parse(configJson),
        choice_json: JSON.parse(choiceJson),
        result_json: JSON.parse(resultJson),
        payout_cents: payoutCents,
        triggered_at: new Date(),
        completed_at: new Date(),
      };
      store.results.set(id, row);
      return { rows: [], rowCount: 1 };
    }

    if (
      sql.includes("UPDATE")
      && sql.includes("app_game1_mini_game_results")
    ) {
      const [id, type, choiceJson, resultJson, payoutCents] = params as [
        string,
        string,
        string,
        string,
        number,
      ];
      const r = store.results.get(id);
      if (!r) return { rows: [], rowCount: 0 };
      r.mini_game_type = type;
      r.choice_json = JSON.parse(choiceJson);
      r.result_json = JSON.parse(resultJson);
      r.payout_cents = payoutCents;
      r.completed_at = new Date();
      return { rows: [], rowCount: 1 };
    }

    throw new Error(`Unhandled SQL: ${s.slice(0, 200)}`);
  };

  const client: Partial<PoolClient> = {
    query: runQuery as unknown as PoolClient["query"],
    release: () => undefined,
  };
  const pool: Partial<Pool> = {
    query: runQuery as unknown as Pool["query"],
    connect: async () => client as PoolClient,
  };
  return pool as Pool;
}

interface RecordedCredit {
  accountId: string;
  amount: number;
  reason: string;
  options: CreditOptions | undefined;
}

function makeMockWallet(opts: { fail?: boolean; recorded: RecordedCredit[] }): WalletAdapter {
  const adapter: Partial<WalletAdapter> = {
    credit: async (accountId, amount, reason, options) => {
      opts.recorded.push({ accountId, amount, reason, options });
      if (opts.fail) {
        throw new WalletError("INSUFFICIENT_FUNDS", "fake fail");
      }
      const tx: WalletTransaction = {
        id: `tx-${opts.recorded.length}`,
        accountId,
        type: "CREDIT" as unknown as WalletTransaction["type"],
        amount,
        reason,
        createdAt: new Date().toISOString(),
      };
      return tx;
    },
  };
  return adapter as WalletAdapter;
}

class TrackingComplianceLedgerPort implements ComplianceLedgerPort {
  public events: Array<Parameters<ComplianceLedgerPort["recordComplianceLedgerEvent"]>[0]> = [];
  public shouldFail = false;
  async recordComplianceLedgerEvent(
    input: Parameters<ComplianceLedgerPort["recordComplianceLedgerEvent"]>[0],
  ): Promise<void> {
    this.events.push(input);
    if (this.shouldFail) throw new Error("ledger fail");
  }
}

// ── Tests ────────────────────────────────────────────────────────────────

test("REQ-146: happy-path — INSERT result-rad + wallet.credit kalt", async () => {
  const store = newStore();
  seedGame(store, "g-1");
  seedUser(store, "p-1", "wallet-1");
  seedAssignment(store, "g-1", "p-1");
  const pool = makeMockPool(store);
  const recorded: RecordedCredit[] = [];
  const wallet = makeMockWallet({ recorded });
  const svc = AgentMiniGameWinningService.forTesting(pool, wallet);

  const res = await svc.recordMiniGameWinning({
    gameId: "g-1",
    playerId: "p-1",
    miniGameType: "wheel",
    amountCents: 25000,
    reason: "Walk-in vinner",
    agentUserId: "agent-1",
    hallId: "hall-a",
  });

  assert.equal(res.created, true);
  assert.equal(res.idempotent, false);
  assert.equal(res.miniGameType, "wheel");
  assert.equal(res.payoutCents, 25000);
  assert.equal(res.walletTransactionId, "tx-1");

  // Verifiser wallet.credit ble kalt med riktige args
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0]!.accountId, "wallet-1");
  assert.equal(recorded[0]!.amount, 250, "25000 cents = 250 kroner");
  assert.equal(recorded[0]!.options?.to, "winnings");
  assert.match(recorded[0]!.options?.idempotencyKey ?? "", /^g1-minigame-/);
});

test("REQ-146: AGENT_MINIGAME_NOT_ACTIVE — mini-gamen ikke i game_config_json", async () => {
  const store = newStore();
  // Seed med kun "wheel" — agenten prøver "chest".
  seedGame(store, "g-1", ["wheel"]);
  seedUser(store, "p-1");
  seedAssignment(store, "g-1", "p-1");
  const pool = makeMockPool(store);
  const wallet = makeMockWallet({ recorded: [] });
  const svc = AgentMiniGameWinningService.forTesting(pool, wallet);

  await assert.rejects(
    () =>
      svc.recordMiniGameWinning({
        gameId: "g-1",
        playerId: "p-1",
        miniGameType: "chest",
        amountCents: 1000,
        reason: "test",
        agentUserId: "agent-1",
        hallId: "hall-a",
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "AGENT_MINIGAME_NOT_ACTIVE",
  );
});

test("REQ-146: AGENT_MINIGAME_NOT_IN_ROUND — spiller uten assignment", async () => {
  const store = newStore();
  seedGame(store, "g-1");
  seedUser(store, "p-1");
  // Ingen assignment seedet
  const pool = makeMockPool(store);
  const wallet = makeMockWallet({ recorded: [] });
  const svc = AgentMiniGameWinningService.forTesting(pool, wallet);

  await assert.rejects(
    () =>
      svc.recordMiniGameWinning({
        gameId: "g-1",
        playerId: "p-1",
        miniGameType: "wheel",
        amountCents: 1000,
        reason: "test",
        agentUserId: "agent-1",
        hallId: "hall-a",
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "AGENT_MINIGAME_NOT_IN_ROUND",
  );
});

test("REQ-146: AGENT_MINIGAME_ALREADY_PAID — completed-rad med annen amount", async () => {
  const store = newStore();
  seedGame(store, "g-1");
  seedUser(store, "p-1");
  seedAssignment(store, "g-1", "p-1");
  // Forhåndseksisterende COMPLETED rad med annen amount
  seedResult(store, {
    id: "mgr-existing",
    scheduled_game_id: "g-1",
    mini_game_type: "wheel",
    winner_user_id: "p-1",
    payout_cents: 50000,
    completed_at: new Date(),
  });
  const pool = makeMockPool(store);
  const wallet = makeMockWallet({ recorded: [] });
  const svc = AgentMiniGameWinningService.forTesting(pool, wallet);

  await assert.rejects(
    () =>
      svc.recordMiniGameWinning({
        gameId: "g-1",
        playerId: "p-1",
        miniGameType: "wheel",
        amountCents: 25000,
        reason: "ny test",
        agentUserId: "agent-1",
        hallId: "hall-a",
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "AGENT_MINIGAME_ALREADY_PAID",
  );
});

test("REQ-146: idempotent re-call — completed-rad med samme type+amount returnerer som no-op", async () => {
  const store = newStore();
  seedGame(store, "g-1");
  seedUser(store, "p-1");
  seedAssignment(store, "g-1", "p-1");
  seedResult(store, {
    id: "mgr-existing",
    scheduled_game_id: "g-1",
    mini_game_type: "wheel",
    winner_user_id: "p-1",
    payout_cents: 25000,
    result_json: { walletTransactionId: "tx-prev" },
    completed_at: new Date(),
  });
  const pool = makeMockPool(store);
  const recorded: RecordedCredit[] = [];
  const wallet = makeMockWallet({ recorded });
  const svc = AgentMiniGameWinningService.forTesting(pool, wallet);

  const res = await svc.recordMiniGameWinning({
    gameId: "g-1",
    playerId: "p-1",
    miniGameType: "wheel",
    amountCents: 25000,
    reason: "samme",
    agentUserId: "agent-1",
    hallId: "hall-a",
  });

  assert.equal(res.idempotent, true);
  assert.equal(res.created, false);
  assert.equal(res.resultId, "mgr-existing");
  assert.equal(res.payoutCents, 25000);
  assert.equal(res.walletTransactionId, "tx-prev");
  assert.equal(recorded.length, 0, "wallet.credit skal IKKE kalles ved idempotent ack");
});

test("REQ-146: completed_at=NULL eksisterende rad — UPDATE + payout", async () => {
  const store = newStore();
  seedGame(store, "g-1");
  seedUser(store, "p-1");
  seedAssignment(store, "g-1", "p-1");
  // Orchestrator har trigget men ikke fullført — agent overstyrer manuelt
  seedResult(store, {
    id: "mgr-triggered",
    scheduled_game_id: "g-1",
    mini_game_type: "wheel",
    winner_user_id: "p-1",
    payout_cents: 0,
    completed_at: null,
  });
  const pool = makeMockPool(store);
  const recorded: RecordedCredit[] = [];
  const wallet = makeMockWallet({ recorded });
  const svc = AgentMiniGameWinningService.forTesting(pool, wallet);

  const res = await svc.recordMiniGameWinning({
    gameId: "g-1",
    playerId: "p-1",
    miniGameType: "wheel",
    amountCents: 30000,
    reason: "manuell-overstyr",
    agentUserId: "agent-1",
    hallId: "hall-a",
  });

  assert.equal(res.created, false, "raden eksisterte, men ble UPDATEt");
  assert.equal(res.idempotent, false);
  assert.equal(res.resultId, "mgr-triggered");
  assert.equal(res.payoutCents, 30000);
  assert.equal(recorded.length, 1, "wallet.credit kalles ved UPDATE");
  // Verify payout completed
  const updated = store.results.get("mgr-triggered");
  assert.notEqual(updated?.completed_at, null);
  assert.equal(updated?.payout_cents, 30000);
});

test("REQ-146: INVALID_MINIGAME_TYPE — ukjent type", async () => {
  const store = newStore();
  seedGame(store, "g-1");
  seedUser(store, "p-1");
  seedAssignment(store, "g-1", "p-1");
  const pool = makeMockPool(store);
  const wallet = makeMockWallet({ recorded: [] });
  const svc = AgentMiniGameWinningService.forTesting(pool, wallet);

  await assert.rejects(
    () =>
      svc.recordMiniGameWinning({
        gameId: "g-1",
        playerId: "p-1",
        miniGameType: "lottoking",
        amountCents: 1000,
        reason: "test",
        agentUserId: "agent-1",
        hallId: "hall-a",
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_MINIGAME_TYPE",
  );
});

test("REQ-146: INVALID_INPUT — amountCents <= 0 avvises", async () => {
  const store = newStore();
  seedGame(store, "g-1");
  seedUser(store, "p-1");
  seedAssignment(store, "g-1", "p-1");
  const pool = makeMockPool(store);
  const wallet = makeMockWallet({ recorded: [] });
  const svc = AgentMiniGameWinningService.forTesting(pool, wallet);

  for (const bad of [0, -100, 0.5, Number.NaN]) {
    await assert.rejects(
      () =>
        svc.recordMiniGameWinning({
          gameId: "g-1",
          playerId: "p-1",
          miniGameType: "wheel",
          amountCents: bad,
          reason: "test",
          agentUserId: "agent-1",
          hallId: "hall-a",
        }),
      (err: unknown) =>
        err instanceof DomainError && err.code === "INVALID_INPUT",
      `amountCents=${bad} skal kaste INVALID_INPUT`,
    );
  }
});

test("REQ-146: GAME_NOT_FOUND — ukjent gameId", async () => {
  const store = newStore();
  const pool = makeMockPool(store);
  const wallet = makeMockWallet({ recorded: [] });
  const svc = AgentMiniGameWinningService.forTesting(pool, wallet);

  await assert.rejects(
    () =>
      svc.recordMiniGameWinning({
        gameId: "ghost",
        playerId: "p-1",
        miniGameType: "wheel",
        amountCents: 1000,
        reason: "test",
        agentUserId: "agent-1",
        hallId: "hall-a",
      }),
    (err: unknown) => err instanceof DomainError && err.code === "GAME_NOT_FOUND",
  );
});

test("REQ-146: PLAYER_NOT_FOUND — ukjent player", async () => {
  const store = newStore();
  seedGame(store, "g-1");
  seedAssignment(store, "g-1", "p-1");
  // Ingen seedUser
  const pool = makeMockPool(store);
  const wallet = makeMockWallet({ recorded: [] });
  const svc = AgentMiniGameWinningService.forTesting(pool, wallet);

  await assert.rejects(
    () =>
      svc.recordMiniGameWinning({
        gameId: "g-1",
        playerId: "p-1",
        miniGameType: "wheel",
        amountCents: 1000,
        reason: "test",
        agentUserId: "agent-1",
        hallId: "hall-a",
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "PLAYER_NOT_FOUND",
  );
});

test("REQ-146: PLAYER_HAS_NO_WALLET — bruker eksisterer men har ingen wallet_id", async () => {
  const store = newStore();
  seedGame(store, "g-1");
  seedUser(store, "p-1", null);
  seedAssignment(store, "g-1", "p-1");
  const pool = makeMockPool(store);
  const wallet = makeMockWallet({ recorded: [] });
  const svc = AgentMiniGameWinningService.forTesting(pool, wallet);

  await assert.rejects(
    () =>
      svc.recordMiniGameWinning({
        gameId: "g-1",
        playerId: "p-1",
        miniGameType: "wheel",
        amountCents: 1000,
        reason: "test",
        agentUserId: "agent-1",
        hallId: "hall-a",
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "PLAYER_HAS_NO_WALLET",
  );
});

test("REQ-146: ComplianceLedger feilet — payout fortsetter (soft-fail)", async () => {
  const store = newStore();
  seedGame(store, "g-1");
  seedUser(store, "p-1");
  seedAssignment(store, "g-1", "p-1");
  const pool = makeMockPool(store);
  const recorded: RecordedCredit[] = [];
  const wallet = makeMockWallet({ recorded });
  const ledger = new TrackingComplianceLedgerPort();
  ledger.shouldFail = true;
  const svc = AgentMiniGameWinningService.forTesting(pool, wallet, "public", ledger);

  // Skal ikke kaste — payout fullføres uansett.
  const res = await svc.recordMiniGameWinning({
    gameId: "g-1",
    playerId: "p-1",
    miniGameType: "wheel",
    amountCents: 1000,
    reason: "test",
    agentUserId: "agent-1",
    hallId: "hall-a",
  });

  assert.equal(res.created, true);
  assert.equal(res.payoutCents, 1000);
  assert.equal(recorded.length, 1, "wallet credit skjedde");
  assert.equal(ledger.events.length, 1, "ledger ble forsøkt skrevet");
});

test("REQ-146: ComplianceLedger registrerer PRIZE-entry med vinnerens hall", async () => {
  const store = newStore();
  seedGame(store, "g-1");
  seedUser(store, "p-1", "wallet-99");
  seedAssignment(store, "g-1", "p-1");
  const pool = makeMockPool(store);
  const recorded: RecordedCredit[] = [];
  const wallet = makeMockWallet({ recorded });
  const ledger = new TrackingComplianceLedgerPort();
  const svc = AgentMiniGameWinningService.forTesting(pool, wallet, "public", ledger);

  await svc.recordMiniGameWinning({
    gameId: "g-1",
    playerId: "p-1",
    miniGameType: "chest",
    amountCents: 50000,
    reason: "walk-in win",
    agentUserId: "agent-1",
    hallId: "hall-vinner",
  });

  assert.equal(ledger.events.length, 1);
  const event = ledger.events[0]!;
  assert.equal(event.hallId, "hall-vinner");
  assert.equal(event.eventType, "PRIZE");
  assert.equal(event.gameType, "DATABINGO");
  assert.equal(event.channel, "HALL");
  assert.equal(event.amount, 500, "50000 cents = 500 kr");
  assert.equal(event.playerId, "p-1");
  assert.equal(event.walletId, "wallet-99");
});

test("REQ-146: AGENT_MINIGAME_WALLET_CREDIT_FAILED — wallet-feil bobler opp", async () => {
  const store = newStore();
  seedGame(store, "g-1");
  seedUser(store, "p-1");
  seedAssignment(store, "g-1", "p-1");
  const pool = makeMockPool(store);
  const recorded: RecordedCredit[] = [];
  const wallet = makeMockWallet({ recorded, fail: true });
  const svc = AgentMiniGameWinningService.forTesting(pool, wallet);

  await assert.rejects(
    () =>
      svc.recordMiniGameWinning({
        gameId: "g-1",
        playerId: "p-1",
        miniGameType: "wheel",
        amountCents: 1000,
        reason: "test",
        agentUserId: "agent-1",
        hallId: "hall-a",
      }),
    (err: unknown) =>
      err instanceof DomainError
      && err.code === "AGENT_MINIGAME_WALLET_CREDIT_FAILED",
  );
  // Ingen rad lagt til store siden vi rullbakket
  assert.equal(store.results.size, 0, "rad ikke INSERTet etter wallet-fail");
});
