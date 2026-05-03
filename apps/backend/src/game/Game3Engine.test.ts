/**
 * 2026-05-03 (Tobias-direktiv): Game3Engine test suite — full coverage for
 * 3×3 / 1..21 auto-claim-on-draw på Coverall (full bong).
 *
 * Tidligere (BIN-615 / PR-C3b, 2026-04-23) testet denne filen pattern-cycler
 * for 5×5 1..75 med Row 1-4 + Coverall thresholds. Den implementasjonen er
 * fjernet — Spill 3 bruker nå 3×3-runtime som Spill 2 (full-bong-vinner-
 * predicate, ingen mellomliggende rad-pattern).
 *
 * Dekningsmatrise:
 *   - Happy path: én vinner med full 3×3 → ClaimRecord + payout
 *   - Multi-winner-split: N vinnere deler Coverall-premie via round(prize/N)
 *   - Lucky bonus: lastBall === luckyNumber → bonus oppå Coverall
 *   - G1/G2 regression guard: isGame3Round returnerer false for non-G3 runder
 *   - Socket-effects stash atomisk read-and-clear (getG3LastDrawEffects)
 *   - Round ender med endedReason="G3_FULL_HOUSE"
 */

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { randomUUID } from "node:crypto";
import type { BingoSystemAdapter, CreateTicketInput } from "../adapters/BingoSystemAdapter.js";
import type {
  CreateWalletAccountInput,
  WalletAccount,
  WalletAdapter,
  WalletTransaction,
  WalletTransferResult,
} from "../adapters/WalletAdapter.js";
import { WalletError } from "../adapters/WalletAdapter.js";
import type { Ticket } from "./types.js";
import { Game3Engine } from "./Game3Engine.js";
import { DEFAULT_GAME2_CONFIG, DEFAULT_GAME3_CONFIG } from "./variantConfig.js";

// ── Test fixtures ───────────────────────────────────────────────────────────

/** Minimal in-memory wallet adapter — mirrors BingoEngine.test.ts shape. */
class InMemoryWalletAdapter implements WalletAdapter {
  private readonly accounts = new Map<string, WalletAccount>();
  private readonly transactions: WalletTransaction[] = [];
  private txCounter = 0;

  async createAccount(input?: CreateWalletAccountInput): Promise<WalletAccount> {
    const accountId = input?.accountId?.trim() || `wallet-${randomUUID()}`;
    const initialBalance = Number(input?.initialBalance ?? 0);
    if (!Number.isFinite(initialBalance) || initialBalance < 0) {
      throw new WalletError("INVALID_AMOUNT", "initialBalance må være 0 eller større.");
    }
    const existing = this.accounts.get(accountId);
    if (existing) {
      if (!input?.allowExisting) throw new WalletError("ACCOUNT_EXISTS", "exists");
      return { ...existing };
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

  async getDepositBalance(accountId: string): Promise<number> {
    return (await this.getAccount(accountId)).depositBalance;
  }
  async getWinningsBalance(accountId: string): Promise<number> {
    return (await this.getAccount(accountId)).winningsBalance;
  }
  async getBothBalances(accountId: string): Promise<{ deposit: number; winnings: number; total: number }> {
    const a = await this.getAccount(accountId);
    return { deposit: a.depositBalance, winnings: a.winningsBalance, total: a.balance };
  }

  async ensureAccount(accountId: string): Promise<WalletAccount> {
    const normalized = accountId.trim();
    if (this.accounts.has(normalized)) return this.getAccount(normalized);
    return this.createAccount({ accountId: normalized, initialBalance: 1000, allowExisting: true });
  }

  async getAccount(accountId: string): Promise<WalletAccount> {
    const existing = this.accounts.get(accountId.trim());
    if (!existing) throw new WalletError("ACCOUNT_NOT_FOUND", "missing");
    return { ...existing };
  }

  async listAccounts(): Promise<WalletAccount[]> {
    return [...this.accounts.values()].map((a) => ({ ...a }));
  }

  async getBalance(accountId: string): Promise<number> {
    return (await this.getAccount(accountId)).balance;
  }

  async debit(accountId: string, amount: number, reason: string): Promise<WalletTransaction> {
    return this.adjust(accountId, -Math.abs(amount), "DEBIT", reason);
  }

  async credit(accountId: string, amount: number, reason: string): Promise<WalletTransaction> {
    return this.adjust(accountId, Math.abs(amount), "CREDIT", reason);
  }

  async topUp(accountId: string, amount: number, reason = "Top-up"): Promise<WalletTransaction> {
    return this.adjust(accountId, Math.abs(amount), "TOPUP", reason);
  }

  async withdraw(accountId: string, amount: number, reason = "Withdrawal"): Promise<WalletTransaction> {
    return this.adjust(accountId, -Math.abs(amount), "WITHDRAWAL", reason);
  }

  async transfer(
    fromAccountId: string,
    toAccountId: string,
    amount: number,
    reason = "Transfer",
  ): Promise<WalletTransferResult> {
    const abs = Math.abs(amount);
    const fromTx = await this.adjust(fromAccountId, -abs, "TRANSFER_OUT", reason, toAccountId);
    const toTx = await this.adjust(toAccountId, abs, "TRANSFER_IN", reason, fromAccountId);
    return { fromTx, toTx };
  }

  async listTransactions(accountId: string, limit = 100): Promise<WalletTransaction[]> {
    return this.transactions
      .filter((tx) => tx.accountId === accountId.trim())
      .slice(-Math.max(0, limit))
      .map((tx) => ({ ...tx }));
  }

  private async adjust(
    accountId: string,
    delta: number,
    type: WalletTransaction["type"],
    reason: string,
    relatedAccountId?: string,
  ): Promise<WalletTransaction> {
    const id = accountId.trim();
    if (!id) throw new WalletError("INVALID_ACCOUNT_ID", "accountId mangler.");
    if (!Number.isFinite(delta) || delta === 0) {
      throw new WalletError("INVALID_AMOUNT", "amount må være > 0.");
    }
    const acc = await this.ensureAccount(id);
    const next = acc.balance + delta;
    if (next < 0) throw new WalletError("INSUFFICIENT_FUNDS", "Ikke nok saldo.");
    const updated: WalletAccount = {
      ...acc,
      balance: next,
      depositBalance: next,
      winningsBalance: 0,
      updatedAt: new Date().toISOString()
    };
    this.accounts.set(id, updated);
    const tx: WalletTransaction = {
      id: `tx-${++this.txCounter}`,
      accountId: id,
      type,
      amount: Math.abs(delta),
      reason,
      createdAt: new Date().toISOString(),
      relatedAccountId,
    };
    this.transactions.push(tx);
    return { ...tx };
  }
}

// ── Ticket fixtures (3×3 / 1..21) ───────────────────────────────────────────

/**
 * Fast 3×3-bong der alle 9 cellene er det første ni tallene 1..9. Vinner
 * Coverall straks 9 forskjellige tall fra {1..9} er trukket. Brukes som
 * default for happy-path-tester med deterministisk drawbag [1..21].
 */
function buildEarlyWinTicket(): Ticket {
  return {
    grid: [
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ],
  };
}

/**
 * En "ikke-vinner"-bong som ikke kan vinne på de første 9 trekningene
 * (cellene er 13..21). Trenger draws helt opp til ball 21 før Coverall lander.
 */
function buildLateWinTicket(): Ticket {
  return {
    grid: [
      [13, 14, 15],
      [16, 17, 18],
      [19, 20, 21],
    ],
  };
}

/** BingoSystemAdapter med per-spiller ticket-køer. */
class QueuedTicketAdapter implements BingoSystemAdapter {
  private readonly defaultTicket: Ticket;
  private readonly queue: Map<string, Ticket[]>;
  constructor(defaultTicket: Ticket, perPlayer?: Record<string, Ticket[]>) {
    this.defaultTicket = defaultTicket;
    this.queue = new Map(Object.entries(perPlayer ?? {}));
  }
  async createTicket(input: CreateTicketInput): Promise<Ticket> {
    const arr = this.queue.get(input.player.id);
    if (arr && arr.length > 0) {
      const next = arr.shift();
      if (next) return { ...next, grid: next.grid.map((r) => [...r]) };
    }
    return { ...this.defaultTicket, grid: this.defaultTicket.grid.map((r) => [...r]) };
  }
}

// ── Engine builder ──────────────────────────────────────────────────────────

interface BuildEngineOpts {
  /** Fast trekkings-rekkefølge. Default: [1..21] sekvensielt. */
  drawBag?: number[];
  /** Per-spiller tickets (etter index — se playerCount). */
  ticketsByPlayerIndex?: Ticket[][];
  /** Default ticket når ingen per-spiller-override. */
  defaultTicket?: Ticket;
  /** Antall spillere (host + guests). Default 2. */
  playerCount?: number;
  /** Inngangsavgift per spiller. Default 100. */
  entryFee?: number;
  /** Payout-prosent av pool. Default 80. */
  payoutPercent?: number;
  /** variantConfig override — default DEFAULT_GAME3_CONFIG (3×3 / 1..21). */
  variantConfig?: typeof DEFAULT_GAME3_CONFIG;
  /** gameSlug for rommet — default "monsterbingo". */
  gameSlug?: string;
}

async function buildG3Engine(opts: BuildEngineOpts = {}) {
  const wallet = new InMemoryWalletAdapter();
  const playerCount = Math.max(2, opts.playerCount ?? 2);
  const walletIds = Array.from({ length: playerCount }, (_, i) => `wallet-p${i + 1}`);
  for (const wid of walletIds) {
    await wallet.createAccount({ accountId: wid, initialBalance: 20000 });
  }
  const defaultTicket = opts.defaultTicket ?? buildEarlyWinTicket();
  const drawBagFactory = opts.drawBag
    ? () => [...opts.drawBag!]
    : undefined;
  const engine = new Game3Engine(
    new QueuedTicketAdapter(defaultTicket),
    wallet,
    {
      minRoundIntervalMs: 30000,
      minPlayersToStart: 2,
      minDrawIntervalMs: 0,
      maxDrawsPerRound: 21,
      drawBagFactory,
      // Relaxed compliance — produksjonsnivå-tap-grenser testes andre steder.
      dailyLossLimit: 1_000_000,
      monthlyLossLimit: 10_000_000,
    },
  );
  const gameSlug = opts.gameSlug ?? "monsterbingo";
  const { roomCode, playerId: hostId } = await engine.createRoom({
    hallId: "hall-1",
    playerName: "Host",
    walletId: walletIds[0],
    gameSlug,
  });
  const guestIds: string[] = [];
  for (let i = 1; i < playerCount; i += 1) {
    const { playerId } = await engine.joinRoom({
      roomCode,
      hallId: "hall-1",
      playerName: `Guest${i}`,
      walletId: walletIds[i],
    });
    guestIds.push(playerId);
  }
  const playerIds = [hostId, ...guestIds];

  // Re-installer adapter med per-player ticket-queue nå som playerIds finnes.
  const perPlayer: Record<string, Ticket[]> = {};
  if (opts.ticketsByPlayerIndex) {
    for (let i = 0; i < opts.ticketsByPlayerIndex.length && i < playerIds.length; i += 1) {
      perPlayer[playerIds[i]] = opts.ticketsByPlayerIndex[i];
    }
  }
  (engine as unknown as { bingoAdapter: BingoSystemAdapter }).bingoAdapter =
    new QueuedTicketAdapter(defaultTicket, perPlayer);

  return {
    engine, wallet, roomCode, hostId, guestIds, playerIds, walletIds,
    entryFee: opts.entryFee ?? 100,
    payoutPercent: opts.payoutPercent ?? 80,
    variantConfig: opts.variantConfig ?? DEFAULT_GAME3_CONFIG,
  };
}

// Deterministisk 1..21 trekkings-bag.
const DRAWBAG_1_TO_21 = Array.from({ length: 21 }, (_, i) => i + 1);

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Game3Engine — happy path: én vinner med full 3×3", () => {
  test("Coverall vinnes på trekning 9 (alle 9 cellene matchet) → en vinner, payout fra pool", async () => {
    // Host: tidlig-vinner-bong (1..9). Guest: sen-vinner-bong (13..21).
    // Med drawbag 1..21 er host's brett komplett etter trekning 9.
    const ctx = await buildG3Engine({
      drawBag: DRAWBAG_1_TO_21,
      ticketsByPlayerIndex: [
        [buildEarlyWinTicket()],
        [buildLateWinTicket()],
      ],
    });
    await ctx.engine.startGame({
      roomCode: ctx.roomCode, actorPlayerId: ctx.hostId,
      entryFee: ctx.entryFee, ticketsPerPlayer: 1, payoutPercent: ctx.payoutPercent,
      variantConfig: ctx.variantConfig,
    });
    for (let i = 0; i < 9; i += 1) {
      await ctx.engine.drawNextNumber({ roomCode: ctx.roomCode, actorPlayerId: ctx.hostId });
    }
    const effects = ctx.engine.getG3LastDrawEffects(ctx.roomCode);
    assert.ok(effects, "effects forventes etter at Coverall lander");
    assert.equal(effects!.drawIndex, 9);
    assert.equal(effects!.lastBall, 9);
    assert.equal(effects!.gameEnded, true, "round skal ende ved Coverall");
    assert.equal(effects!.endedReason, "G3_FULL_HOUSE");
    assert.equal(effects!.winners.length, 1, "én Coverall-vinner-record");
    const w = effects!.winners[0];
    assert.equal(w.isFullHouse, true);
    assert.equal(w.patternName, "Coverall");
    assert.equal(w.ticketWinners.length, 1, "kun host's brett er komplett");
    assert.equal(w.ticketWinners[0].playerId, ctx.hostId);
    // pool = 2 × 100 = 200, default 80% Coverall = 160 kr.
    // Én vinner → 160 kr direkte (etter single-prize-cap).
    assert.ok(w.pricePerWinner > 0, "vinner må få > 0 kr");
    assert.ok(w.ticketWinners[0].payoutAmount > 0);
    // Game-status reflekterer slutt.
    const snap = ctx.engine.getRoomSnapshot(ctx.roomCode);
    assert.equal(snap.currentGame?.status, "ENDED");
    assert.equal(snap.currentGame?.endedReason, "G3_FULL_HOUSE");
    assert.equal(snap.currentGame?.bingoWinnerId, ctx.hostId);
    // ClaimRecord er BINGO + autoGenerated.
    const claims = snap.currentGame?.claims ?? [];
    assert.equal(claims.length, 1);
    assert.equal(claims[0].type, "BINGO");
    assert.equal(claims[0].autoGenerated, true);
  });
});

describe("Game3Engine — multi-vinner split", () => {
  test("3 vinnere deler Coverall-premien via round(totalPrize / N)", async () => {
    // 3 spillere, alle med tidlig-vinner-bonger. pool = 3 × 100 = 300,
    // Coverall = 80% = 240. Split round(240 / 3) = 80 per vinner.
    const ctx = await buildG3Engine({
      drawBag: DRAWBAG_1_TO_21,
      playerCount: 3,
      ticketsByPlayerIndex: [
        [buildEarlyWinTicket()],
        [buildEarlyWinTicket()],
        [buildEarlyWinTicket()],
      ],
    });
    await ctx.engine.startGame({
      roomCode: ctx.roomCode, actorPlayerId: ctx.hostId,
      entryFee: ctx.entryFee, ticketsPerPlayer: 1, payoutPercent: ctx.payoutPercent,
      variantConfig: ctx.variantConfig,
    });
    for (let i = 0; i < 9; i += 1) {
      await ctx.engine.drawNextNumber({ roomCode: ctx.roomCode, actorPlayerId: ctx.hostId });
    }
    const effects = ctx.engine.getG3LastDrawEffects(ctx.roomCode);
    assert.ok(effects, "effects forventes");
    const w = effects!.winners[0];
    assert.equal(w.ticketWinners.length, 3, "alle tre spillerne har vinnerbrett");
    // round(240 / 3) = 80 per vinner (pool 300 × 80% = 240).
    const expected = Math.round((300 * 80) / 100 / 3);
    assert.equal(w.pricePerWinner, expected, `expected round(240/3)=${expected}; got ${w.pricePerWinner}`);
    for (const tw of w.ticketWinners) {
      assert.equal(tw.payoutAmount, expected);
    }
    // Tre ClaimRecords.
    const snap = ctx.engine.getRoomSnapshot(ctx.roomCode);
    const claims = snap.currentGame?.claims ?? [];
    assert.equal(claims.length, 3);
    assert.ok(claims.every((c) => c.autoGenerated === true && c.type === "BINGO"));
  });

  test("rounding: 5 vinnere deler 80 kr → round(16) = 16 hver (ingen overspend)", async () => {
    // 5 spillere, entryFee 20 → pool 100, Coverall 80% = 80 kr.
    // Split round(80/5) = 16 per vinner. Total 80 kr — innenfor pool.
    const ctx = await buildG3Engine({
      drawBag: DRAWBAG_1_TO_21,
      playerCount: 5,
      entryFee: 20,
      ticketsByPlayerIndex: Array.from({ length: 5 }, () => [buildEarlyWinTicket()]),
    });
    await ctx.engine.startGame({
      roomCode: ctx.roomCode, actorPlayerId: ctx.hostId,
      entryFee: ctx.entryFee, ticketsPerPlayer: 1, payoutPercent: ctx.payoutPercent,
      variantConfig: ctx.variantConfig,
    });
    for (let i = 0; i < 9; i += 1) {
      await ctx.engine.drawNextNumber({ roomCode: ctx.roomCode, actorPlayerId: ctx.hostId });
    }
    const effects = ctx.engine.getG3LastDrawEffects(ctx.roomCode);
    assert.ok(effects);
    const w = effects!.winners[0];
    assert.equal(w.pricePerWinner, 16);
    const total = w.ticketWinners.reduce((s, tw) => s + tw.payoutAmount, 0);
    assert.ok(total <= 80, `total betalt (${total}) må ikke overstige Coverall-prize (80)`);
  });
});

describe("Game3Engine — lucky-number bonus", () => {
  test("lucky=9, lastBall=9 → bonus utbetales til host (eneste vinner)", async () => {
    // For å isolere lucky-bonus-effekten gir vi KUN host en vinner-bong.
    // Guest har en sen-vinner-bong som ikke fullfører på trekning 9.
    // Pool=200, Coverall=80%=160. Én vinner får hele 160 + 50 lucky = 210.
    // Budget=160 — ikke nok for 160+50, så lucky-bonus capes til (160-160)=0?
    // Nei: payG3CoverallShare drenerer budget til 0 (paid 160, budget=0).
    // Så payG3LuckyBonus får (160+50)-160=0 i pool. Lucky-bonus = 0.
    //
    // For å gi lucky-bonus rom MÅ pool ha overskudd. entryFee=500 → pool=1000,
    // budget=800. Coverall 80%=800. Single winner får 800. Budget=0. Lucky=0.
    //
    // Eneste måte: sett admin-override prizePercent < 80% så det er headroom.
    // Eks: prizePercent=50 → Coverall=500, budget=800-500=300 etter Coverall,
    // lucky=50 fits. Total host: 500+50=550. ✓
    const cfgWithLucky = {
      ...DEFAULT_GAME3_CONFIG,
      patterns: [
        { name: "Coverall", claimType: "BINGO" as const, prizePercent: 50, design: 0 },
      ],
      luckyNumberPrize: 50,
    };
    const ctx = await buildG3Engine({
      drawBag: DRAWBAG_1_TO_21,
      entryFee: 1000, // pool=2000, payoutBudget=80%×2000=1600, Coverall=50%×2000=1000
      ticketsByPlayerIndex: [
        [buildEarlyWinTicket()],   // host wins on draw 9
        [buildLateWinTicket()],    // guest doesn't win
      ],
      variantConfig: cfgWithLucky,
    });
    await ctx.engine.startGame({
      roomCode: ctx.roomCode, actorPlayerId: ctx.hostId,
      entryFee: ctx.entryFee, ticketsPerPlayer: 1, payoutPercent: ctx.payoutPercent,
      variantConfig: cfgWithLucky,
    });
    ctx.engine.setLuckyNumber(ctx.roomCode, ctx.hostId, 9);
    for (let i = 0; i < 9; i += 1) {
      await ctx.engine.drawNextNumber({ roomCode: ctx.roomCode, actorPlayerId: ctx.hostId });
    }
    const effects = ctx.engine.getG3LastDrawEffects(ctx.roomCode);
    assert.ok(effects);
    const w = effects!.winners[0];
    assert.equal(w.ticketWinners.length, 1, "kun host har vinnerbrett");
    const hostShare = w.ticketWinners[0];
    assert.equal(hostShare.playerId, ctx.hostId);
    assert.equal(hostShare.luckyBonus, 50, "host får lucky-bonus 50 kr");
    assert.equal(hostShare.payoutAmount, 1000, "Coverall single-winner = 50% × 2000 = 1000");
    // Wallet-delta: host får +1000 (Coverall) + 50 (lucky) = +1050, men betalte 1000 entry.
    // Net change: -1000 + 1000 + 50 = +50. Balance: 20000 + 50 = 20050.
    const hostBal = (await ctx.wallet.getAccount(ctx.walletIds[0])).balance;
    assert.equal(hostBal, 20050, `host balance = 20000 - 1000 + 1000 + 50 = 20050; got ${hostBal}`);
    const snap = ctx.engine.getRoomSnapshot(ctx.roomCode);
    const claims = snap.currentGame?.claims ?? [];
    const hostClaim = claims.find((c) => c.playerId === ctx.hostId);
    assert.ok(hostClaim);
    assert.equal(hostClaim!.bonusTriggered, true);
    assert.equal(hostClaim!.bonusAmount, 50);
  });

  test("luckyNumberPrize=0 → bonus utbetales aldri selv om lastBall matcher", async () => {
    const ctx = await buildG3Engine({
      drawBag: DRAWBAG_1_TO_21,
      ticketsByPlayerIndex: [
        [buildEarlyWinTicket()],
        [buildLateWinTicket()],
      ],
      variantConfig: DEFAULT_GAME3_CONFIG, // ingen luckyNumberPrize
    });
    await ctx.engine.startGame({
      roomCode: ctx.roomCode, actorPlayerId: ctx.hostId,
      entryFee: ctx.entryFee, ticketsPerPlayer: 1, payoutPercent: ctx.payoutPercent,
      variantConfig: DEFAULT_GAME3_CONFIG,
    });
    ctx.engine.setLuckyNumber(ctx.roomCode, ctx.hostId, 9);
    for (let i = 0; i < 9; i += 1) {
      await ctx.engine.drawNextNumber({ roomCode: ctx.roomCode, actorPlayerId: ctx.hostId });
    }
    const effects = ctx.engine.getG3LastDrawEffects(ctx.roomCode);
    assert.ok(effects);
    const w = effects!.winners[0];
    assert.equal(w.ticketWinners[0].luckyBonus, 0, "ingen luckyNumberPrize → ingen bonus");
  });
});

describe("Game3Engine — G1/G2 regression guard", () => {
  test("patternEvalMode=manual-claim → onDrawCompleted no-op (G1 regression guard)", async () => {
    const ctx = await buildG3Engine({
      drawBag: DRAWBAG_1_TO_21,
      ticketsByPlayerIndex: [[buildEarlyWinTicket()], [buildLateWinTicket()]],
      variantConfig: { ...DEFAULT_GAME3_CONFIG, patternEvalMode: "manual-claim" },
    });
    await ctx.engine.startGame({
      roomCode: ctx.roomCode, actorPlayerId: ctx.hostId,
      entryFee: ctx.entryFee, ticketsPerPlayer: 1, payoutPercent: ctx.payoutPercent,
      variantConfig: { ...DEFAULT_GAME3_CONFIG, patternEvalMode: "manual-claim" },
    });
    for (let i = 0; i < 9; i += 1) {
      await ctx.engine.drawNextNumber({ roomCode: ctx.roomCode, actorPlayerId: ctx.hostId });
    }
    const effects = ctx.engine.getG3LastDrawEffects(ctx.roomCode);
    assert.equal(effects, undefined, "ingen G3-effekter når manual-claim");
    const snap = ctx.engine.getRoomSnapshot(ctx.roomCode);
    assert.equal(snap.currentGame?.claims.length, 0);
  });

  test("jackpotNumberTable satt (G2-markør) → isGame3Round returnerer false", async () => {
    const cfg = {
      ...DEFAULT_GAME3_CONFIG,
      jackpotNumberTable: DEFAULT_GAME2_CONFIG.jackpotNumberTable,
    };
    const ctx = await buildG3Engine({
      drawBag: DRAWBAG_1_TO_21,
      ticketsByPlayerIndex: [[buildEarlyWinTicket()], [buildLateWinTicket()]],
      variantConfig: cfg,
    });
    await ctx.engine.startGame({
      roomCode: ctx.roomCode, actorPlayerId: ctx.hostId,
      entryFee: ctx.entryFee, ticketsPerPlayer: 1, payoutPercent: ctx.payoutPercent,
      variantConfig: cfg,
    });
    for (let i = 0; i < 9; i += 1) {
      await ctx.engine.drawNextNumber({ roomCode: ctx.roomCode, actorPlayerId: ctx.hostId });
    }
    const effects = ctx.engine.getG3LastDrawEffects(ctx.roomCode);
    assert.equal(effects, undefined, "jackpotNumberTable signalerer G2 — Game3Engine hopper over");
  });

  test("gameSlug ikke i GAME3_SLUGS → isGame3Round returnerer false", async () => {
    const ctx = await buildG3Engine({
      drawBag: DRAWBAG_1_TO_21,
      ticketsByPlayerIndex: [[buildEarlyWinTicket()], [buildLateWinTicket()]],
      gameSlug: "rocket", // G2-slug — Game3Engine skal ikke engasjere
    });
    await ctx.engine.startGame({
      roomCode: ctx.roomCode, actorPlayerId: ctx.hostId,
      entryFee: ctx.entryFee, ticketsPerPlayer: 1, payoutPercent: ctx.payoutPercent,
      variantConfig: ctx.variantConfig,
    });
    for (let i = 0; i < 9; i += 1) {
      await ctx.engine.drawNextNumber({ roomCode: ctx.roomCode, actorPlayerId: ctx.hostId });
    }
    const effects = ctx.engine.getG3LastDrawEffects(ctx.roomCode);
    assert.equal(effects, undefined, "non-G3-slug → guard blokkerer G3-prosessering");
  });
});

describe("Game3Engine — atomisk read-and-clear av G3-effekter", () => {
  test("første read returnerer effekter, andre read returnerer undefined", async () => {
    const ctx = await buildG3Engine({
      drawBag: DRAWBAG_1_TO_21,
      ticketsByPlayerIndex: [[buildEarlyWinTicket()], [buildLateWinTicket()]],
    });
    await ctx.engine.startGame({
      roomCode: ctx.roomCode, actorPlayerId: ctx.hostId,
      entryFee: ctx.entryFee, ticketsPerPlayer: 1, payoutPercent: ctx.payoutPercent,
      variantConfig: ctx.variantConfig,
    });
    await ctx.engine.drawNextNumber({ roomCode: ctx.roomCode, actorPlayerId: ctx.hostId });
    const first = ctx.engine.getG3LastDrawEffects(ctx.roomCode);
    const second = ctx.engine.getG3LastDrawEffects(ctx.roomCode);
    assert.ok(first, "første read må returnere effekter");
    assert.equal(second, undefined, "andre read må være tom (atomisk read-and-clear)");
  });

  test("ingen G3-effekter før første trekning", async () => {
    const ctx = await buildG3Engine({
      drawBag: DRAWBAG_1_TO_21,
      ticketsByPlayerIndex: [[buildEarlyWinTicket()], [buildLateWinTicket()]],
    });
    await ctx.engine.startGame({
      roomCode: ctx.roomCode, actorPlayerId: ctx.hostId,
      entryFee: ctx.entryFee, ticketsPerPlayer: 1, payoutPercent: ctx.payoutPercent,
      variantConfig: ctx.variantConfig,
    });
    assert.equal(ctx.engine.getG3LastDrawEffects(ctx.roomCode), undefined);
  });
});

describe("Game3Engine — patternSnapshot wire shape", () => {
  test("snapshot inneholder singleton Coverall med 9-celle full-mask", async () => {
    const ctx = await buildG3Engine({
      drawBag: DRAWBAG_1_TO_21,
      ticketsByPlayerIndex: [[buildLateWinTicket()], [buildLateWinTicket()]],
    });
    await ctx.engine.startGame({
      roomCode: ctx.roomCode, actorPlayerId: ctx.hostId,
      entryFee: ctx.entryFee, ticketsPerPlayer: 1, payoutPercent: ctx.payoutPercent,
      variantConfig: ctx.variantConfig,
    });
    await ctx.engine.drawNextNumber({ roomCode: ctx.roomCode, actorPlayerId: ctx.hostId });
    const effects = ctx.engine.getG3LastDrawEffects(ctx.roomCode);
    assert.ok(effects);
    const snap = effects!.patternSnapshot;
    assert.equal(snap.length, 1, "Spill 3 har KUN Coverall-pattern");
    const coverall = snap[0];
    assert.equal(coverall.name, "Coverall");
    assert.equal(coverall.isFullHouse, true);
    // 9-celle full-mask (alle 1).
    assert.equal(coverall.patternDataList.length, 9);
    assert.ok(coverall.patternDataList.every((v) => v === 1), "alle 9 celler i full-mask");
    assert.ok(typeof coverall.amount === "number" && coverall.amount > 0, "amount > 0");
    // Coverall = 80% × 200 (pool) = 160 kr.
    assert.equal(coverall.amount, 160);
  });
});
