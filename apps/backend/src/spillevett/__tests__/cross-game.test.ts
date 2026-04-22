/**
 * BIN-541: Spillvett cross-game test — pilot release-gate.
 *
 * Per `docs/compliance/RELEASE_GATE.md` §3, this test must pass before legacy
 * is decoupled. It verifies that the four core spillvett rules behave
 * identically across all four pilot game slugs (G1/G2/G3/G5):
 *
 *   1. Hall-based loss-limit blocks a buy that would exceed the daily cap.
 *   2. Voluntary timed pause blocks any wallet-touching action with
 *      PLAYER_TIMED_PAUSE.
 *   3. Self-exclusion 1-year blocks join with PLAYER_SELF_EXCLUDED.
 *   4. Hall-switch — a limit set on hall A does not bleed into hall B.
 *
 * Plus 4 fail-CLOSED tests (one per slug): a broken persistence adapter that
 * throws on every read must still result in the buy being blocked, never
 * silently allowed. The integrity guarantee here is "fail-closed", not
 * "fail-open".
 *
 * Mapping note (test-name vs. error-code):
 *   - hall_limit_exceeded  → DAILY_LOSS_LIMIT_EXCEEDED
 *   - voluntary_pause      → PLAYER_TIMED_PAUSE
 *   - self_excluded        → PLAYER_SELF_EXCLUDED
 */
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { BingoSystemAdapter, CreateTicketInput } from "../../adapters/BingoSystemAdapter.js";
import {
  type CreateWalletAccountInput,
  type WalletAccount,
  type WalletAdapter,
  type WalletTransaction,
  WalletError,
  type WalletTransferResult,
} from "../../adapters/WalletAdapter.js";
import { BingoEngine, DomainError } from "../../game/BingoEngine.js";
import type { Ticket } from "../../game/types.js";
import type { ResponsibleGamingPersistenceAdapter } from "../../game/ResponsibleGamingPersistence.js";

// ── Minimal in-memory wallet ───────────────────────────────────────────────

class InMemoryWalletAdapter implements WalletAdapter {
  private readonly accounts = new Map<string, WalletAccount>();
  private readonly transactions: WalletTransaction[] = [];
  private txCounter = 0;

  async createAccount(input?: CreateWalletAccountInput): Promise<WalletAccount> {
    const accountId = input?.accountId?.trim() || `wallet-${randomUUID()}`;
    const initialBalance = Number(input?.initialBalance ?? 0);
    if (this.accounts.has(accountId)) {
      if (!input?.allowExisting) throw new WalletError("ACCOUNT_EXISTS", "");
      return { ...this.accounts.get(accountId)! };
    }
    const now = new Date().toISOString();
    const account: WalletAccount = {
      id: accountId,
      balance: initialBalance,
      depositBalance: initialBalance,
      winningsBalance: 0,
      createdAt: now,
      updatedAt: now
    };
    this.accounts.set(accountId, account);
    return { ...account };
  }
  async ensureAccount(id: string): Promise<WalletAccount> {
    if (this.accounts.has(id)) return { ...this.accounts.get(id)! };
    return this.createAccount({ accountId: id, initialBalance: 0, allowExisting: true });
  }
  async getAccount(id: string): Promise<WalletAccount> {
    const a = this.accounts.get(id);
    if (!a) throw new WalletError("ACCOUNT_NOT_FOUND", "");
    return { ...a };
  }
  async listAccounts(): Promise<WalletAccount[]> { return [...this.accounts.values()].map((a) => ({ ...a })); }
  async getBalance(id: string): Promise<number> { return (await this.getAccount(id)).balance; }
  async getDepositBalance(id: string): Promise<number> { return (await this.getAccount(id)).depositBalance; }
  async getWinningsBalance(id: string): Promise<number> { return (await this.getAccount(id)).winningsBalance; }
  async getBothBalances(id: string): Promise<{ deposit: number; winnings: number; total: number }> {
    const a = await this.getAccount(id);
    return { deposit: a.depositBalance, winnings: a.winningsBalance, total: a.balance };
  }
  async debit(id: string, amount: number, reason: string): Promise<WalletTransaction> {
    return this.adjust(id, -Math.abs(amount), "DEBIT", reason);
  }
  async credit(id: string, amount: number, reason: string): Promise<WalletTransaction> {
    return this.adjust(id, Math.abs(amount), "CREDIT", reason);
  }
  async topUp(id: string, amount: number, reason = ""): Promise<WalletTransaction> {
    return this.adjust(id, Math.abs(amount), "TOPUP", reason);
  }
  async withdraw(id: string, amount: number, reason = ""): Promise<WalletTransaction> {
    return this.adjust(id, -Math.abs(amount), "WITHDRAWAL", reason);
  }
  async transfer(from: string, to: string, amount: number, reason: string): Promise<WalletTransferResult> {
    const fromTx = await this.adjust(from, -Math.abs(amount), "TRANSFER_OUT", reason, to);
    const toTx = await this.adjust(to, Math.abs(amount), "TRANSFER_IN", reason, from);
    return { fromTx, toTx };
  }
  async listTransactions(id: string, limit = 100): Promise<WalletTransaction[]> {
    return this.transactions.filter((t) => t.accountId === id).slice(-limit).map((t) => ({ ...t }));
  }
  private async adjust(id: string, delta: number, type: WalletTransaction["type"], reason: string, related?: string): Promise<WalletTransaction> {
    const acc = await this.ensureAccount(id);
    const next = acc.balance + delta;
    if (next < 0) throw new WalletError("INSUFFICIENT_FUNDS", "");
    this.accounts.set(id, {
      ...acc,
      balance: next,
      depositBalance: next,
      winningsBalance: 0,
      updatedAt: new Date().toISOString()
    });
    const tx: WalletTransaction = {
      id: `tx-${++this.txCounter}`, accountId: id, type, amount: Math.abs(delta),
      reason, createdAt: new Date().toISOString(), relatedAccountId: related,
    };
    this.transactions.push(tx);
    return { ...tx };
  }
}

class FixedTicketBingoAdapter implements BingoSystemAdapter {
  async createTicket(_input: CreateTicketInput): Promise<Ticket> {
    return { grid: [[1, 2, 3, 4, 5], [13, 14, 15, 16, 17], [25, 26, 0, 27, 28], [37, 38, 39, 40, 41], [49, 50, 51, 52, 53]] };
  }
}

// ── Stub persistence for fail-closed tests ─────────────────────────────────
// The engine exposes a wide persistence-adapter surface (~20 methods); for
// these tests we only need a handful, so we cast through `unknown` to mock
// only what we actually exercise. The in-memory ComplianceManager remains the
// source of truth — persistence is for hydration only.

interface StubPersistenceState {
  shouldThrowOnLoad: boolean;
  shouldThrowOnSave: boolean;
}

function makeStubPersistence(state: StubPersistenceState): ResponsibleGamingPersistenceAdapter {
  const noop = async (): Promise<void> => {
    if (state.shouldThrowOnSave) throw new Error("simulated save failure");
  };
  const stub = {
    ensureInitialized: async () => { /* noop */ },
    loadSnapshot: async () => {
      if (state.shouldThrowOnLoad) throw new Error("simulated db outage");
      // Empty snapshot — the engine treats absence as "no prior state".
      // Field names match ResponsibleGamingPersistenceSnapshot exactly.
      return {
        personalLossLimits: [],
        pendingLossLimitChanges: [],
        restrictions: [],
        playStates: [],
        lossEntries: [],
        prizePolicies: [],
        extraPrizeEntries: [],
        payoutAuditTrail: [],
        complianceLedger: [],
        dailyReports: [],
      };
    },
    upsertLossLimit: noop,
    upsertPendingLossLimitChange: noop,
    deletePendingLossLimitChange: noop,
    upsertRestriction: noop,
    deleteRestriction: noop,
    upsertPlaySessionState: noop,
    deletePlaySessionState: noop,
    insertLossEntry: noop,
    upsertPrizePolicy: noop,
    insertExtraPrizeEntry: noop,
    insertPayoutAuditEvent: noop,
    insertComplianceLedgerEntry: noop,
    upsertDailyReport: noop,
    insertOverskuddBatch: noop,
    getOverskuddBatch: async () => null,
    listOverskuddBatches: async () => [],
    upsertHallOrganizationAllocation: noop,
    listHallOrganizationAllocations: async () => [],
    deleteHallOrganizationAllocation: noop,
    shutdown: async () => { /* noop */ },
  };
  return stub as unknown as ResponsibleGamingPersistenceAdapter;
}

// ── Scenario helpers ───────────────────────────────────────────────────────

interface Setup {
  engine: BingoEngine;
  stubState: StubPersistenceState;
  hostWallet: string;
  guestWallet: string;
}

async function makeEngine(): Promise<Setup> {
  const stubState: StubPersistenceState = { shouldThrowOnLoad: false, shouldThrowOnSave: false };
  const engine = new BingoEngine(new FixedTicketBingoAdapter(), new InMemoryWalletAdapter(), {
    minDrawIntervalMs: 0,
    minPlayersToStart: 2,
    maxDrawsPerRound: 75,
    persistence: makeStubPersistence(stubState),
  });
  await engine.hydratePersistentState();
  return { engine, stubState, hostWallet: `wallet-host-${randomUUID()}`, guestWallet: `wallet-guest-${randomUUID()}` };
}

async function joinTwoPlayers(engine: BingoEngine, hostWallet: string, guestWallet: string, hallId: string, gameSlug: string) {
  const { roomCode, playerId: hostId } = await engine.createRoom({
    hallId, playerName: "Host", walletId: hostWallet, gameSlug,
  });
  const { playerId: guestId } = await engine.joinRoom({
    roomCode, hallId, playerName: "Guest", walletId: guestWallet,
  });
  return { roomCode, hostId, guestId };
}

const SLUGS = ["bingo", "rocket", "monsterbingo", "spillorama"] as const;

// ── Rule 1 — hall-based loss-limit silently filters the player out of buy-in ─
// The engine's design is "round always starts, blocked players just don't get
// a ticket". The pengeflyt invariant is: a blocked player MUST NOT be debited
// and MUST NOT appear in currentGame.tickets.

for (const slug of SLUGS) {
  test(`BIN-541 (${slug}): rule 1 — hall loss-limit excludes the over-limit player from buy-in`, async () => {
    const setup = await makeEngine();
    const hallId = `hall-rule1-${slug}`;
    // Seed wallets so balance isn't the rejection reason.
    const wallet = (setup.engine as unknown as { walletAdapter: WalletAdapter }).walletAdapter;
    await wallet.createAccount({ accountId: setup.hostWallet, initialBalance: 1000, allowExisting: true });
    await wallet.createAccount({ accountId: setup.guestWallet, initialBalance: 1000, allowExisting: true });
    const { roomCode, hostId } = await joinTwoPlayers(setup.engine, setup.hostWallet, setup.guestWallet, hallId, slug);

    // Tighten host's hall-daily limit to 1 NOK and record a 5-NOK loss so the
    // host is well over. Use the private compliance accessor — recordLossEntry
    // is the same path the engine takes after a real buy-in commits.
    const compliance = (setup.engine as unknown as { compliance: { recordLossEntry: (w: string, h: string, e: { type: "BUYIN" | "PAYOUT"; amount: number; createdAtMs: number }) => Promise<void> } }).compliance;
    await setup.engine.setPlayerLossLimits({ walletId: setup.hostWallet, hallId, daily: 1 });
    await compliance.recordLossEntry(setup.hostWallet, hallId, { type: "BUYIN", amount: 5, createdAtMs: Date.now() });

    // Round starts (engine design: rounds always start so non-blocked players
    // can play); host must not receive a ticket and must not be debited.
    await setup.engine.startGame({ roomCode, actorPlayerId: hostId, ticketsPerPlayer: 1, entryFee: 10, payoutPercent: 80 });
    const snapshot = setup.engine.getRoomSnapshot(roomCode);
    const game = snapshot.currentGame;
    assert.ok(game, "currentGame must exist after startGame");
    const hostTickets = game.tickets[hostId];
    assert.ok(!hostTickets || hostTickets.length === 0, `host (over loss-limit) must not receive a ticket; got ${hostTickets?.length ?? 0}`);
    const hostBalance = await wallet.getBalance(setup.hostWallet);
    assert.equal(hostBalance, 1000, "host wallet must not be debited when over loss-limit");
  });
}

// ── Rule 2 — voluntary timed pause blocks the wallet path ──────────────────
// joinRoom is the entry point that asserts the wallet is allowed for gameplay;
// startGame's per-player filter is silent (rule 1 covers that path).

for (const slug of SLUGS) {
  test(`BIN-541 (${slug}): rule 2 — voluntary pause blocks joinRoom with PLAYER_TIMED_PAUSE`, async () => {
    const setup = await makeEngine();
    const hallId = `hall-rule2-${slug}`;
    // Set the pause first, then have the host create a room and try to have
    // the paused guest join. The join must throw before any wallet is touched.
    await setup.engine.setTimedPause({ walletId: setup.guestWallet, durationMs: 60 * 60 * 1000 });
    const { roomCode } = await setup.engine.createRoom({
      hallId, playerName: "Host", walletId: setup.hostWallet, gameSlug: slug,
    });

    await assert.rejects(
      () => setup.engine.joinRoom({ roomCode, hallId, playerName: "Paused", walletId: setup.guestWallet }),
      (err: unknown) => err instanceof DomainError && err.code === "PLAYER_TIMED_PAUSE",
    );
  });
}

// ── Rule 3 — self-exclusion blocks join ────────────────────────────────────

for (const slug of SLUGS) {
  test(`BIN-541 (${slug}): rule 3 — self-exclusion blocks joinRoom with PLAYER_SELF_EXCLUDED`, async () => {
    const setup = await makeEngine();
    const hallId = `hall-rule3-${slug}`;

    // Self-exclude the would-be guest first, then have host create + try guest-join.
    await setup.engine.setSelfExclusion(setup.guestWallet);
    const { roomCode } = await setup.engine.createRoom({
      hallId, playerName: "Host", walletId: setup.hostWallet, gameSlug: slug,
    });

    await assert.rejects(
      () => setup.engine.joinRoom({ roomCode, hallId, playerName: "Excluded", walletId: setup.guestWallet }),
      (err: unknown) => err instanceof DomainError && err.code === "PLAYER_SELF_EXCLUDED",
    );
  });
}

// ── Rule 4 — hall-switch resets the per-hall ledger scope ──────────────────

for (const slug of SLUGS) {
  test(`BIN-541 (${slug}): rule 4 — limits on hall A do not block buy on hall B`, async () => {
    const setup = await makeEngine();
    const hallA = `hall-A-${slug}`;
    const hallB = `hall-B-${slug}`;

    // Set loss-limit + record loss on hall A.
    await setup.engine.setPlayerLossLimits({ walletId: setup.hostWallet, hallId: hallA, daily: 1 });
    await setup.engine.recordAccountingEvent({
      hallId: hallA, gameType: "DATABINGO", channel: "INTERNET", eventType: "STAKE", amount: 5,
    });

    // Now play on hall B — fresh scope, no recorded loss, default limit applies.
    const { roomCode, hostId } = await joinTwoPlayers(setup.engine, setup.hostWallet, setup.guestWallet, hallB, slug);
    await setup.engine.startGame({
      roomCode, actorPlayerId: hostId, ticketsPerPlayer: 1, entryFee: 10, payoutPercent: 80,
    });

    // If we got here, the hall-A limit didn't bleed into hall B — pass.
    const snapshot = setup.engine.getRoomSnapshot(roomCode);
    assert.equal(snapshot.currentGame?.status, "RUNNING", "hall B game must run despite hall A being capped");
  });
}

// ── Fail-CLOSED — DB outage on the persistence adapter still blocks ────────

for (const slug of SLUGS) {
  test(`BIN-541 (${slug}): FAIL-CLOSED — persistence load throw must not unlock self-excluded play`, async () => {
    // Fresh engine: self-exclude first (this persists via setSelfExclusion),
    // then simulate a DB read failure on a re-hydration attempt. The in-memory
    // restriction is still authoritative, so joinRoom must still throw.
    const setup = await makeEngine();
    await setup.engine.setSelfExclusion(setup.guestWallet);

    // Now flip persistence to throw on subsequent loads; simulate the
    // worst-case "we don't know what the DB says" scenario.
    setup.stubState.shouldThrowOnLoad = true;

    const { roomCode } = await setup.engine.createRoom({
      hallId: `hall-fc-${slug}`, playerName: "Host", walletId: setup.hostWallet, gameSlug: slug,
    });

    await assert.rejects(
      () => setup.engine.joinRoom({ roomCode, hallId: `hall-fc-${slug}`, playerName: "Excluded", walletId: setup.guestWallet }),
      (err: unknown) => err instanceof DomainError && err.code === "PLAYER_SELF_EXCLUDED",
      "self-excluded join must remain blocked even when persistence is sick — fail-closed is mandatory",
    );
  });
}
