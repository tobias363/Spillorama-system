/**
 * BIN-690 Spor 3 M4: integrasjonstester for Colordraft-runtime via orchestrator.
 *
 * Dekning:
 *   - Full flyt: MiniGamesConfigService → orchestrator.maybeTriggerFor →
 *     handleChoice. Tester at config-endringer speiles i runtime.
 *   - Default-config-fallback når admin-config mangler (12 luker, 4 farger,
 *     1000 winPrize, 0 consolation).
 *   - Admin-config override endrer slotCount + palette + prize-amounts.
 *   - Credit kalles med `to: "winnings"` (regulatorisk krav) ved match.
 *   - Idempotency-key er `g1-minigame-${resultId}`.
 *   - Dobbel handleChoice → MINIGAME_ALREADY_COMPLETED.
 *   - Wallet-credit feil → raden er IKKE markert completed (fail-closed).
 *   - Consolation=0 mismatch → ingen credit-kall.
 *
 * Merk: bruker in-memory fake-pool (samme pattern som M2/M3).
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  Game1MiniGameOrchestrator,
  type MiniGameBroadcaster,
  type MiniGameResultBroadcast,
  type MiniGameTriggerBroadcast,
} from "./Game1MiniGameOrchestrator.js";
import {
  MiniGameColordraftEngine,
  type ColordraftResultJson,
} from "./MiniGameColordraftEngine.js";
import { DomainError } from "../../errors/DomainError.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

interface FakePoolState {
  /** Simulert `app_mini_games_config` — kun for colordraft-typen. */
  configRow: { config_json: Record<string, unknown> } | null;
  /** Simulert `app_game1_mini_game_results`. */
  rows: Map<string, Record<string, unknown>>;
}

function makeFakePool(state: FakePoolState): {
  pool: {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
    connect: () => Promise<{
      query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
      release: () => void;
    }>;
  };
} {
  const handleQuery = async (sql: string, params: unknown[] = []) => {
    // Config-lookup: app_mini_games_config WHERE game_type = $1.
    if (sql.includes("app_mini_games_config") && sql.includes("SELECT")) {
      return {
        rows: state.configRow ? [state.configRow] : [],
      };
    }
    // INSERT mini_game_results.
    if (sql.includes("INSERT INTO") && sql.includes("app_game1_mini_game_results")) {
      const [id, scheduledGameId, type, winnerUserId, configSnapshotJson] =
        params as [string, string, string, string, string];
      state.rows.set(id, {
        id,
        scheduled_game_id: scheduledGameId,
        mini_game_type: type,
        winner_user_id: winnerUserId,
        config_snapshot_json: JSON.parse(configSnapshotJson),
        choice_json: null,
        result_json: null,
        payout_cents: 0,
        triggered_at: new Date(),
        completed_at: null,
      });
      return { rows: [] };
    }
    return { rows: [] };
  };

  const clientQuery = async (sql: string, params: unknown[] = []) => {
    if (sql.trim() === "BEGIN" || sql.trim() === "COMMIT" || sql.trim() === "ROLLBACK") {
      return { rows: [] };
    }
    if (sql.includes("FOR UPDATE") && sql.includes("app_game1_mini_game_results")) {
      const id = params[0] as string;
      const row = state.rows.get(id);
      return { rows: row ? [row] : [] };
    }
    if (sql.includes("app_users") && sql.includes("wallet_id")) {
      return { rows: [{ wallet_id: "w-winner" }] };
    }
    if (sql.includes("app_game1_phase_winners")) {
      return { rows: [{ hall_id: "h-main", draw_sequence_at_win: 50 }] };
    }
    if (sql.includes("UPDATE") && sql.includes("app_game1_mini_game_results")) {
      const id = params[0] as string;
      const row = state.rows.get(id);
      if (row) {
        row.choice_json = JSON.parse(params[1] as string);
        row.result_json = JSON.parse(params[2] as string);
        row.payout_cents = params[3] as number;
        row.completed_at = new Date();
      }
      return { rows: [] };
    }
    return { rows: [] };
  };

  return {
    pool: {
      query: handleQuery,
      connect: async () => ({
        query: clientQuery,
        release: () => undefined,
      }),
    },
  };
}

function makeStubAuditLog() {
  const records: Array<{
    actorId: string | null;
    action: string;
    resource: string;
    resourceId: string;
    details: Record<string, unknown>;
  }> = [];
  return {
    service: {
      record: async (input: {
        actorId: string | null;
        actorType: string;
        action: string;
        resource: string;
        resourceId: string;
        details: Record<string, unknown>;
      }) => {
        records.push({
          actorId: input.actorId,
          action: input.action,
          resource: input.resource,
          resourceId: input.resourceId,
          details: input.details,
        });
      },
    } as unknown as import("../../compliance/AuditLogService.js").AuditLogService,
    records,
  };
}

interface CreditCall {
  accountId: string;
  amount: number;
  reason: string;
  options: { idempotencyKey?: string; to?: string } | undefined;
}

function makeStubWalletAdapter(options: { throwOnCredit?: boolean } = {}) {
  const credits: CreditCall[] = [];
  return {
    adapter: {
      credit: async (
        accountId: string,
        amount: number,
        reason: string,
        opts?: { idempotencyKey?: string; to?: string },
      ) => {
        if (options.throwOnCredit) {
          throw new Error("simulated wallet failure");
        }
        credits.push({ accountId, amount, reason, options: opts });
        return { id: `tx-${credits.length}`, accountId, amount };
      },
      debit: async () => {
        throw new Error("unused");
      },
      transfer: async () => {
        throw new Error("unused");
      },
      getBalance: async () => 0,
    } as unknown as import("../../adapters/WalletAdapter.js").WalletAdapter,
    credits,
  };
}

function makeRecordingBroadcaster(): {
  broadcaster: MiniGameBroadcaster;
  triggers: MiniGameTriggerBroadcast[];
  results: MiniGameResultBroadcast[];
} {
  const triggers: MiniGameTriggerBroadcast[] = [];
  const results: MiniGameResultBroadcast[] = [];
  return {
    broadcaster: {
      onTrigger: (e) => triggers.push(e),
      onResult: (e) => results.push(e),
    },
    triggers,
    results,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

test("BIN-690 M4 integration: default-config → colordraft payload (12 luker, 4 farger, trigger & handleChoice speiler state)", async () => {
  const state: FakePoolState = {
    configRow: null, // Admin har ikke konfigurert → default brukes.
    rows: new Map(),
  };
  const { pool } = makeFakePool(state);
  const { service: auditLog, records: auditRecords } = makeStubAuditLog();
  const { adapter: walletAdapter, credits } = makeStubWalletAdapter();
  const { broadcaster, triggers, results } = makeRecordingBroadcaster();

  const orchestrator = new Game1MiniGameOrchestrator({
    pool: pool as unknown as import("pg").Pool,
    auditLog,
    walletAdapter,
    broadcaster,
  });
  orchestrator.registerMiniGame(new MiniGameColordraftEngine());

  // Trigger.
  const trig = await orchestrator.maybeTriggerFor({
    scheduledGameId: "sg-int-cd-1",
    winnerUserId: "u-winner",
    winnerWalletId: "w-winner",
    hallId: "h-main",
    drawSequenceAtWin: 50,
    gameConfigJson: { spill1: { miniGames: ["colordraft"] } },
  });
  assert.equal(trig.triggered, true);
  assert.equal(trig.miniGameType, "colordraft");
  assert.equal(triggers.length, 1);

  // Payload skal ha 12 slots + targetColor + slotColors (default).
  const triggerPayload = triggers[0]!.payload as Record<string, unknown>;
  assert.equal(triggerPayload.numberOfSlots, 12);
  assert.equal(triggerPayload.winPrizeNok, 1000);
  assert.equal(triggerPayload.consolationPrizeNok, 0);
  const target = triggerPayload.targetColor as string;
  const slots = triggerPayload.slotColors as string[];
  assert.equal(slots.length, 12);
  assert.ok(
    slots.includes(target),
    `target ${target} må finnes i slots [${slots.join(",")}]`,
  );

  // Klient velger en slot med target-fargen → full payout.
  const matchIndex = slots.indexOf(target);
  const resp = await orchestrator.handleChoice({
    resultId: trig.resultId!,
    userId: "u-winner",
    choiceJson: { chosenIndex: matchIndex },
  });

  assert.equal(resp.payoutCents, 100_000); // 1000 kr * 100.
  const resultJson = resp.resultJson as ColordraftResultJson;
  assert.equal(resultJson.matched, true);
  assert.equal(resultJson.targetColor, target);
  assert.equal(resultJson.chosenColor, target);
  assert.equal(resultJson.chosenIndex, matchIndex);
  assert.equal(resultJson.prizeAmountKroner, 1000);
  assert.deepEqual([...resultJson.allSlotColors], slots);
  assert.equal(resultJson.numberOfSlots, 12);

  // Wallet-credit kalt med `to: "winnings"` (regulatorisk krav).
  assert.equal(credits.length, 1);
  assert.equal(credits[0]!.accountId, "w-winner");
  assert.equal(credits[0]!.amount, 1000);
  assert.equal(credits[0]!.options?.to, "winnings");
  assert.equal(
    credits[0]!.options?.idempotencyKey,
    `g1-minigame-${trig.resultId}`,
  );

  // Broadcast.
  assert.equal(results.length, 1);
  assert.equal(results[0]!.payoutCents, 100_000);
  assert.equal(results[0]!.miniGameType, "colordraft");

  // Audit: trigger + completed.
  const triggerAudits = auditRecords.filter(
    (r) => r.action === "game1_minigame.triggered",
  );
  const completedAudits = auditRecords.filter(
    (r) => r.action === "game1_minigame.completed",
  );
  assert.equal(triggerAudits.length, 1);
  assert.equal(completedAudits.length, 1);
  assert.equal(completedAudits[0]!.details.miniGameType, "colordraft");
  assert.equal(completedAudits[0]!.details.payoutCents, 100_000);
});

test("BIN-690 M4 integration: admin-config endring (6 luker, custom palette, 2500 winPrize) speiles i runtime", async () => {
  const state: FakePoolState = {
    configRow: {
      config_json: {
        numberOfSlots: 6,
        colorPalette: ["crimson", "navy", "forest"],
        winPrizeNok: 2500,
        consolationPrizeNok: 250,
      },
    },
    rows: new Map(),
  };
  const { pool } = makeFakePool(state);
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter, credits } = makeStubWalletAdapter();
  const { broadcaster, triggers } = makeRecordingBroadcaster();

  const orchestrator = new Game1MiniGameOrchestrator({
    pool: pool as unknown as import("pg").Pool,
    auditLog,
    walletAdapter,
    broadcaster,
  });
  orchestrator.registerMiniGame(new MiniGameColordraftEngine());

  const trig = await orchestrator.maybeTriggerFor({
    scheduledGameId: "sg-int-cd-2",
    winnerUserId: "u-winner",
    winnerWalletId: "w-winner",
    hallId: "h-main",
    drawSequenceAtWin: 50,
    gameConfigJson: { spill1: { miniGames: ["colordraft"] } },
  });

  // Trigger-payload skal reflektere admin-config (ikke default).
  const tpayload = triggers[0]!.payload as Record<string, unknown>;
  assert.equal(tpayload.numberOfSlots, 6);
  assert.equal(tpayload.winPrizeNok, 2500);
  assert.equal(tpayload.consolationPrizeNok, 250);
  const target = tpayload.targetColor as string;
  const slots = tpayload.slotColors as string[];
  assert.equal(slots.length, 6);
  // Alle farger skal være fra admin-paletten.
  for (const c of slots) {
    assert.ok(["crimson", "navy", "forest"].includes(c));
  }
  assert.ok(["crimson", "navy", "forest"].includes(target));

  // Match → 2500 kr.
  const matchIndex = slots.indexOf(target);
  const resp = await orchestrator.handleChoice({
    resultId: trig.resultId!,
    userId: "u-winner",
    choiceJson: { chosenIndex: matchIndex },
  });
  assert.equal(resp.payoutCents, 250_000);
  assert.equal(credits[0]!.amount, 2500);
});

test("BIN-690 M4 integration: mismatch med consolation>0 → consolation payout + credit kalles", async () => {
  const state: FakePoolState = {
    configRow: {
      config_json: {
        numberOfSlots: 6,
        colorPalette: ["red", "blue"],
        winPrizeNok: 1000,
        consolationPrizeNok: 100,
      },
    },
    rows: new Map(),
  };
  const { pool } = makeFakePool(state);
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter, credits } = makeStubWalletAdapter();
  const { broadcaster, triggers } = makeRecordingBroadcaster();

  const orchestrator = new Game1MiniGameOrchestrator({
    pool: pool as unknown as import("pg").Pool,
    auditLog,
    walletAdapter,
    broadcaster,
  });
  orchestrator.registerMiniGame(new MiniGameColordraftEngine());

  // Retry-loop: hver maybeTriggerFor() genererer ny randomUUID → ny RNG-seed → ny state.
  // Med palette=2 farger og 6 slots er p(alle slots == target) = (1/2)^6 = 1/64 per forsøk.
  // 50 forsøk gir p(aldri mismatch) ≈ (1/64)^50 ≈ 10^-90 → deterministisk i praksis.
  const MAX_ATTEMPTS = 50;
  let trig: Awaited<ReturnType<typeof orchestrator.maybeTriggerFor>> | null = null;
  let target = "";
  let slots: string[] = [];
  let mismatchIndex = -1;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // Ny scheduledGameId per forsøk for å unngå state-overlapp (selv om resultId
    // uansett er fresh per trigger via randomUUID).
    const candidate = await orchestrator.maybeTriggerFor({
      scheduledGameId: `sg-int-cd-consolation-${attempt}`,
      winnerUserId: "u-winner",
      winnerWalletId: "w-winner",
      hallId: "h-main",
      drawSequenceAtWin: 50,
      gameConfigJson: { spill1: { miniGames: ["colordraft"] } },
    });
    const tpayload = triggers[triggers.length - 1]!.payload as Record<string, unknown>;
    const candidateTarget = tpayload.targetColor as string;
    const candidateSlots = tpayload.slotColors as string[];
    const candidateMismatch = candidateSlots.findIndex((c) => c !== candidateTarget);
    if (candidateMismatch >= 0) {
      trig = candidate;
      target = candidateTarget;
      slots = candidateSlots;
      mismatchIndex = candidateMismatch;
      break;
    }
  }
  assert.ok(
    trig !== null && mismatchIndex >= 0,
    `Fant ikke mismatch-slot etter ${MAX_ATTEMPTS} forsøk — statistisk umulig (p ≈ 10^-90)`,
  );

  const resp = await orchestrator.handleChoice({
    resultId: trig.resultId!,
    userId: "u-winner",
    choiceJson: { chosenIndex: mismatchIndex },
  });
  assert.equal(resp.payoutCents, 10_000); // 100 kr.
  const json = resp.resultJson as ColordraftResultJson;
  assert.equal(json.matched, false);
  assert.equal(json.targetColor, target);
  assert.deepEqual([...json.allSlotColors], slots);
  assert.equal(json.prizeAmountKroner, 100);
  // Credit ble kalt for consolation (nøyaktig 1 gang — kun completed trigger fikk handleChoice).
  assert.equal(credits.length, 1);
  assert.equal(credits[0]!.amount, 100);
  assert.equal(credits[0]!.options?.to, "winnings");
});

test("BIN-690 M4 integration: mismatch med consolation=0 → ingen credit-kall", async () => {
  const state: FakePoolState = {
    configRow: null, // Default har consolation=0.
    rows: new Map(),
  };
  const { pool } = makeFakePool(state);
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter, credits } = makeStubWalletAdapter();
  const { broadcaster, triggers } = makeRecordingBroadcaster();

  const orchestrator = new Game1MiniGameOrchestrator({
    pool: pool as unknown as import("pg").Pool,
    auditLog,
    walletAdapter,
    broadcaster,
  });
  orchestrator.registerMiniGame(new MiniGameColordraftEngine());

  // Retry-loop: hver maybeTriggerFor() genererer ny randomUUID → ny RNG-seed → ny state.
  // Med default palette=4 farger og 12 slots er p(alle slots == target) = (1/4)^12 ≈ 1/16.7M
  // per forsøk. 50 forsøk gir p(aldri mismatch) ≈ (1/16.7M)^50 → deterministisk i praksis.
  // Erstatter tidligere silent-skip-pattern (1/16.7M sjanse for falsk-pass).
  const MAX_ATTEMPTS = 50;
  let trig: Awaited<ReturnType<typeof orchestrator.maybeTriggerFor>> | null = null;
  let mismatchIndex = -1;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = await orchestrator.maybeTriggerFor({
      scheduledGameId: `sg-int-cd-zero-${attempt}`,
      winnerUserId: "u-zero",
      winnerWalletId: "w-zero",
      hallId: "h-main",
      drawSequenceAtWin: 50,
      gameConfigJson: { spill1: { miniGames: ["colordraft"] } },
    });
    const tpayload = triggers[triggers.length - 1]!.payload as Record<string, unknown>;
    const candidateTarget = tpayload.targetColor as string;
    const candidateSlots = tpayload.slotColors as string[];
    const candidateMismatch = candidateSlots.findIndex((c) => c !== candidateTarget);
    if (candidateMismatch >= 0) {
      trig = candidate;
      mismatchIndex = candidateMismatch;
      break;
    }
  }
  assert.ok(
    trig !== null && mismatchIndex >= 0,
    `Fant ikke mismatch-slot etter ${MAX_ATTEMPTS} forsøk — statistisk umulig`,
  );

  const resp = await orchestrator.handleChoice({
    resultId: trig.resultId!,
    userId: "u-zero",
    choiceJson: { chosenIndex: mismatchIndex },
  });
  assert.equal(resp.payoutCents, 0);
  // Ingen credit siden beløp er 0.
  assert.equal(credits.length, 0);
});

test("BIN-690 M4 integration: dobbel handleChoice → MINIGAME_ALREADY_COMPLETED", async () => {
  const state: FakePoolState = { configRow: null, rows: new Map() };
  const { pool } = makeFakePool(state);
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter } = makeStubWalletAdapter();

  const orchestrator = new Game1MiniGameOrchestrator({
    pool: pool as unknown as import("pg").Pool,
    auditLog,
    walletAdapter,
  });
  orchestrator.registerMiniGame(new MiniGameColordraftEngine());

  const trig = await orchestrator.maybeTriggerFor({
    scheduledGameId: "sg-cd-idem",
    winnerUserId: "u-idem",
    winnerWalletId: "w-idem",
    hallId: "h-main",
    drawSequenceAtWin: 50,
    gameConfigJson: { spill1: { miniGames: ["colordraft"] } },
  });
  assert.equal(trig.triggered, true);

  // Første kall OK.
  await orchestrator.handleChoice({
    resultId: trig.resultId!,
    userId: "u-idem",
    choiceJson: { chosenIndex: 0 },
  });

  // Andre kall rejected.
  await assert.rejects(
    () =>
      orchestrator.handleChoice({
        resultId: trig.resultId!,
        userId: "u-idem",
        choiceJson: { chosenIndex: 1 },
      }),
    (err: unknown) =>
      err instanceof DomainError &&
      err.code === "MINIGAME_ALREADY_COMPLETED",
  );
});

test("BIN-690 M4 integration: wallet.credit kaster → raden er IKKE completed (fail-closed, retry mulig)", async () => {
  const state: FakePoolState = {
    // Palette med 1 farge → alltid match → alltid credit-kall, som vi får til å kaste.
    configRow: {
      config_json: {
        numberOfSlots: 3,
        colorPalette: ["only-color"],
        winPrizeNok: 1000,
        consolationPrizeNok: 0,
      },
    },
    rows: new Map(),
  };
  const { pool } = makeFakePool(state);
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter } = makeStubWalletAdapter({ throwOnCredit: true });

  const orchestrator = new Game1MiniGameOrchestrator({
    pool: pool as unknown as import("pg").Pool,
    auditLog,
    walletAdapter,
  });
  orchestrator.registerMiniGame(new MiniGameColordraftEngine());

  const trig = await orchestrator.maybeTriggerFor({
    scheduledGameId: "sg-cd-fail",
    winnerUserId: "u-fail",
    winnerWalletId: "w-fail",
    hallId: "h-main",
    drawSequenceAtWin: 50,
    gameConfigJson: { spill1: { miniGames: ["colordraft"] } },
  });
  assert.equal(trig.triggered, true);

  // Wallet-feil → transaksjonen rulles tilbake (ROLLBACK i orchestrator).
  // Vi forventer at feilen bobler opp (fail-closed).
  await assert.rejects(
    () =>
      orchestrator.handleChoice({
        resultId: trig.resultId!,
        userId: "u-fail",
        choiceJson: { chosenIndex: 0 },
      }),
    /simulated wallet failure/,
  );

  // Raden er IKKE markert completed (rollback) → dobbel-submit kan retrye.
  const row = state.rows.get(trig.resultId!);
  assert.equal(row?.completed_at, null);
  assert.equal(row?.payout_cents, 0);
});

test("BIN-690 M4 integration: ugyldig chosenIndex → INVALID_CHOICE, ikke completed", async () => {
  const state: FakePoolState = { configRow: null, rows: new Map() };
  const { pool } = makeFakePool(state);
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter } = makeStubWalletAdapter();

  const orchestrator = new Game1MiniGameOrchestrator({
    pool: pool as unknown as import("pg").Pool,
    auditLog,
    walletAdapter,
  });
  orchestrator.registerMiniGame(new MiniGameColordraftEngine());

  const trig = await orchestrator.maybeTriggerFor({
    scheduledGameId: "sg-cd-invalid",
    winnerUserId: "u-invalid",
    winnerWalletId: "w-invalid",
    hallId: "h-main",
    drawSequenceAtWin: 50,
    gameConfigJson: { spill1: { miniGames: ["colordraft"] } },
  });

  // Klient sender out-of-range chosenIndex.
  await assert.rejects(
    () =>
      orchestrator.handleChoice({
        resultId: trig.resultId!,
        userId: "u-invalid",
        choiceJson: { chosenIndex: 99 },
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_CHOICE",
  );

  // Raden er IKKE completed — klient kan retry med gyldig chosenIndex.
  const row = state.rows.get(trig.resultId!);
  assert.equal(row?.completed_at, null);
});

test("BIN-690 M4 integration: trigger-state matcher choice-state for samme resultId (deterministic reconstruction)", async () => {
  const state: FakePoolState = { configRow: null, rows: new Map() };
  const { pool } = makeFakePool(state);
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter } = makeStubWalletAdapter();
  const { broadcaster, triggers } = makeRecordingBroadcaster();

  const orchestrator = new Game1MiniGameOrchestrator({
    pool: pool as unknown as import("pg").Pool,
    auditLog,
    walletAdapter,
    broadcaster,
  });
  orchestrator.registerMiniGame(new MiniGameColordraftEngine());

  const trig = await orchestrator.maybeTriggerFor({
    scheduledGameId: "sg-cd-deterministic",
    winnerUserId: "u-det",
    winnerWalletId: "w-det",
    hallId: "h-main",
    drawSequenceAtWin: 50,
    gameConfigJson: { spill1: { miniGames: ["colordraft"] } },
  });

  const triggerPayload = triggers[0]!.payload as Record<string, unknown>;
  const triggerTarget = triggerPayload.targetColor as string;
  const triggerSlots = triggerPayload.slotColors as string[];

  // Handle choice — state fra handleChoice må matche trigger-state EKSAKT.
  const resp = await orchestrator.handleChoice({
    resultId: trig.resultId!,
    userId: "u-det",
    choiceJson: { chosenIndex: 5 },
  });
  const json = resp.resultJson as ColordraftResultJson;
  assert.equal(
    json.targetColor,
    triggerTarget,
    "targetColor i handleChoice må matche trigger-broadcast (determinisme via resultId-seed)",
  );
  assert.deepEqual(
    [...json.allSlotColors],
    triggerSlots,
    "slotColors i handleChoice må matche trigger-broadcast",
  );
});
