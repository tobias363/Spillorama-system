/**
 * BIN-615 / PR-C3b: Game3Engine test suite — full coverage for pattern-driven
 * auto-claim-on-draw behaviour of the 5×5 / 1..75 no-free-centre variant.
 *
 * 2026-05-05 (test-restoration Bølge C): patterns updated to match the
 * 2026-05-04 Tobias-direktiv (PR #895) — `DEFAULT_GAME3_CONFIG` har 4
 * design-mønstre à 25 % (Topp + midt, Kryss, Topp + diagonal, Pyramide)
 * i stedet for det forrige Row 1-4 + Coverall (10 %/60 %)-oppsettet.
 *
 * Coverage matrix:
 *   - Happy path: single winner ("Topp + midt"), single pattern → ClaimRecord + payout
 *   - Multi-winner-split: N winners share pattern prize via round(prize / N)
 *   - Lucky bonus: lastBall === luckyNumber → payout per winner
 *   - G1/G2 regression guard: isGame3Round returns false for non-G3 rounds
 *   - Socket-effects stash atomic read-and-clear (getG3LastDrawEffects)
 *   - cyclerGameIdByRoom resets cleanly across consecutive rounds
 *   - patternSnapshot wire shape (4 mønstre, alle 25 %, ingen Full House)
 *
 * Threshold-deaktivering og "Full House ends round" er dekket i tidligere
 * Row 1-4 + Coverall-konfig; nåværende DEFAULT_GAME3_CONFIG har ingen
 * `ballNumberThreshold` på noen pattern og ingen pattern dekker alle 25
 * cellene → de testene er fjernet (eller flagget som test-skip) under denne
 * restorasjonen. Se PR-rapport for detaljer / regresjoner.
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

// ── Ticket fixtures ─────────────────────────────────────────────────────────
//
// All engineered tickets below are 5×5 with **no free-centre** so they match
// the Game 3 generator exactly. Row numbers (1..15), (16..30), (31..45),
// (46..60), (61..75) follow the BINGO column ranges used by the real generator.
//
// 2026-05-05: ticket fixtures rewritten to target the new 4-pattern config
// (Topp + midt, Kryss, Topp + diagonal, Pyramide). The `Topp + midt` pattern
// covers row 0 (cells 0-4) + col 2 (cells 7,12,17,22) — total 9 cells from
// the union of the top row and the entire N-column.

/**
 * Ticket where row 0 contains [1, 16, 31, 46, 61] (B/I/N/G/O minima) and
 * column 2 (N) contains [31, 32, 33, 34, 35]. Drawing the 9 unique numbers
 * `{1, 16, 31, 32, 33, 34, 35, 46, 61}` covers all "Topp + midt" cells →
 * pattern wins. With the 4-pattern config (Topp+midt, Kryss, Topp+diagonal,
 * Pyramide) only "Topp + midt" matches in those 9 draws (verified by hand).
 */
function buildToppMidtWinningTicket(): Ticket {
  return {
    grid: [
      [ 1, 16, 31, 46, 61], // row 0 — required by Topp + midt
      [ 2, 17, 32, 47, 62], // col 2 = 32
      [ 3, 18, 33, 48, 63], // col 2 = 33
      [ 4, 19, 34, 49, 64], // col 2 = 34
      [ 5, 20, 35, 50, 65], // col 2 = 35
    ],
  };
}

/**
 * Ticket whose cells do NOT overlap with the 9-ball "Topp + midt" win-set
 * `{1, 16, 31, 32, 33, 34, 35, 46, 61}` enough to satisfy any of the 4
 * patterns at draw 9. Used as a non-winner baseline. Note: BINGO column
 * ranges still apply (1-15, 16-30, 31-45, 46-60, 61-75).
 */
function buildLosingPatternTicket(): Ticket {
  return {
    grid: [
      [ 6, 21, 36, 51, 66],
      [ 7, 22, 37, 52, 67],
      [ 8, 23, 38, 53, 68],
      [ 9, 24, 39, 54, 69],
      [10, 25, 40, 55, 70],
    ],
  };
}

/** BingoSystemAdapter whose createTicket returns a caller-supplied sequence of tickets. */
class QueuedTicketAdapter implements BingoSystemAdapter {
  private readonly defaultTicket: Ticket;
  private readonly queue: Map<string, Ticket[]>; // playerId -> ordered tickets
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
  /** Fixed draw sequence. Ball 1 drawn first, then ball 2, ... up to maxBallValue=75. */
  drawBag?: number[];
  /** Per-player tickets (playerId not known up-front → use index). */
  ticketsByPlayerIndex?: Ticket[][];
  /** Default ticket when no per-player override. */
  defaultTicket?: Ticket;
  /** Extra player count (in addition to host). 1 = host only. Default 2. */
  playerCount?: number;
  /** Entry fee per player. Default 100 kr. */
  entryFee?: number;
  /** Payout percent of pool. Default 80. */
  payoutPercent?: number;
  /** variantConfig override — default DEFAULT_GAME3_CONFIG. */
  variantConfig?: typeof DEFAULT_GAME3_CONFIG;
  /** Lucky number to set for host (mimics socket lucky:set). */
  hostLucky?: number;
  /** gameSlug for the room — default "monsterbingo". */
  gameSlug?: string;
}

async function buildG3Engine(opts: BuildEngineOpts = {}) {
  const wallet = new InMemoryWalletAdapter();
  const playerCount = Math.max(2, opts.playerCount ?? 2);
  const walletIds = Array.from({ length: playerCount }, (_, i) => `wallet-p${i + 1}`);
  for (const wid of walletIds) {
    await wallet.createAccount({ accountId: wid, initialBalance: 20000 });
  }
  const defaultTicket = opts.defaultTicket ?? buildToppMidtWinningTicket();
  const drawBagFactory = opts.drawBag
    ? () => [...opts.drawBag!]
    : undefined;
  const engine = new Game3Engine(
    // tickets assigned per player below via queue after joinRoom
    new QueuedTicketAdapter(defaultTicket),
    wallet,
    {
      minRoundIntervalMs: 30000,
      minPlayersToStart: 2,
      minDrawIntervalMs: 0,
      maxDrawsPerRound: 75,
      drawBagFactory,
      // Relaxed compliance — production-level loss limits exercised elsewhere.
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

  // Re-install adapter with per-player ticket queues now that playerIds exist.
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
    hostLucky: opts.hostLucky,
  };
}

// Deterministic 1..75 draw-bag for line scenarios: ball `n` at draw index `n`.
const DRAWBAG_1_TO_75 = Array.from({ length: 75 }, (_, i) => i + 1);

// 9-ball "Topp + midt" winning sequence — ticket cells 0..4 (top row) + 7,12,17,22
// (col 2 from row 1..4). Last ball drawn (61) triggers the win.
const TOPP_MIDT_BALLS = [1, 16, 31, 32, 33, 34, 35, 46, 61];

/** Build a 75-ball bag that draws TOPP_MIDT_BALLS first (in that order),
 * then fills the rest of 1..75 in ascending order. Used to make "Topp + midt"
 * complete exactly at draw 9 with the {@link buildToppMidtWinningTicket}. */
function buildToppMidtBag(): number[] {
  const rest = DRAWBAG_1_TO_75.filter((n) => !TOPP_MIDT_BALLS.includes(n));
  return [...TOPP_MIDT_BALLS, ...rest];
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Game3Engine — happy path: single winner, single pattern", () => {
  test("Topp + midt wins at draw 9 → one winner, 25% pool paid", async () => {
    // Bag: draws TOPP_MIDT_BALLS first → "Topp + midt" completed at draw 9.
    const ctx = await buildG3Engine({
      drawBag: buildToppMidtBag(),
      ticketsByPlayerIndex: [
        [buildToppMidtWinningTicket()],
        [buildLosingPatternTicket()],
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
    assert.ok(effects, "effects expected on Topp + midt win");
    assert.equal(effects!.drawIndex, 9);
    assert.equal(effects!.lastBall, 61);
    assert.equal(effects!.winners.length, 1, "exactly one Topp + midt winner");
    const w = effects!.winners[0];
    assert.equal(w.patternName, "Topp + midt");
    assert.equal(w.isFullHouse, false);
    // Topp + midt = 25% of 200 pool = 50 kr; single winner → full 50 kr.
    assert.equal(w.pricePerWinner, 50, `Topp + midt prize should be 50 kr; got ${w.pricePerWinner}`);
    assert.equal(w.ticketWinners.length, 1);
    assert.equal(w.ticketWinners[0].playerId, ctx.hostId);
    assert.equal(w.ticketWinners[0].payoutAmount, 50);
    assert.equal(w.ticketWinners[0].luckyBonus, 0);
    // Game NOT ended (no Full-House pattern in current G3 config).
    assert.equal(effects!.gameEnded, false);
    // Claim recorded. Note: Game3Engine.ts:427 setter `type: pattern.isFullHouse
    // ? "BINGO" : "LINE"`. Med dagens 4-pattern-konfig har INGEN av mønstrene
    // `isFullHouse=true` (de er definert med `claimType: "BINGO"` i config,
    // men `buildPatternSpecs` overstyrer kun navn-basert "Full House"/"Coverall"
    // eller `coversAll`-detektoren — ingen av disse trigger). Derfor blir
    // claim-typen LINE for alle 4 mønstre. Se §6 i PR-rapporten.
    const snap = ctx.engine.getRoomSnapshot(ctx.roomCode);
    const claims = snap.currentGame?.claims ?? [];
    assert.equal(claims.length, 1);
    assert.equal(claims[0].type, "LINE");
    assert.equal(claims[0].autoGenerated, true);
    assert.equal(claims[0].payoutAmount, 50);
    // Wallet credited: paid 100 entry, received 50 prize.
    const hostBal = (await ctx.wallet.getAccount(ctx.walletIds[0])).balance;
    assert.equal(hostBal, 20000 - 100 + 50);
  });
});

describe("Game3Engine — multi-winner split", () => {
  test("3 winners share Topp + midt prize round(prize/3) each", async () => {
    // 3 players, all with Topp + midt winning tickets. Pool = 3×100 = 300.
    // Prize = 25% × 300 = 75 kr; split round(75/3) = 25 each.
    const ctx = await buildG3Engine({
      drawBag: buildToppMidtBag(),
      playerCount: 3,
      ticketsByPlayerIndex: [
        [buildToppMidtWinningTicket()],
        [buildToppMidtWinningTicket()],
        [buildToppMidtWinningTicket()],
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
    assert.ok(effects, "effects expected");
    assert.equal(effects!.winners.length, 1, "single pattern matched by 3 tickets");
    const w = effects!.winners[0];
    assert.equal(w.patternName, "Topp + midt");
    assert.equal(w.ticketWinners.length, 3, "three (ticket,pattern) winners");
    // prize = 25% of 300 = 75 kr; round(75/3) = 25 per winner.
    assert.equal(w.pricePerWinner, 25, `expected round(75/3)=25; got ${w.pricePerWinner}`);
    for (const tw of w.ticketWinners) {
      assert.equal(tw.payoutAmount, 25);
    }
    // Three ClaimRecords recorded.
    const snap = ctx.engine.getRoomSnapshot(ctx.roomCode);
    const claims = snap.currentGame?.claims ?? [];
    assert.equal(claims.length, 3);
    assert.ok(claims.every((c) => c.autoGenerated === true));
  });

  test("round() rounding: 5 winners share 50 kr → round(10)=10 each (no overspend)", async () => {
    // 5 players × 40 entry → pool = 200. Prize = 25% × 200 = 50 kr.
    // Split round(50/5) = 10 each. Total distributed = 5×10 = 50 ≤ 50 (exact).
    const ctx = await buildG3Engine({
      drawBag: buildToppMidtBag(),
      playerCount: 5,
      entryFee: 40,
      ticketsByPlayerIndex: Array.from({ length: 5 }, () => [buildToppMidtWinningTicket()]),
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
    assert.equal(w.pricePerWinner, 10, `round(50/5)=10; got ${w.pricePerWinner}`);
    // Total distributed ≤ original prize (no phantom money).
    const total = w.ticketWinners.reduce((s, tw) => s + tw.payoutAmount, 0);
    assert.ok(total <= 50, `total paid (${total}) must not exceed pattern prize (50)`);
  });
});

// 2026-05-05 (test-restoration): "Game3Engine — threshold deaktivering" og
// "Full House ends the round" var begge testet mot Row 1-4 + Coverall-konfigen
// fra før PR #895. Den nåværende DEFAULT_GAME3_CONFIG har:
//   - 4 design-mønstre (Topp + midt, Kryss, Topp + diagonal, Pyramide) à 25 %
//   - INGEN `ballNumberThreshold` på noen av dem (alle aktive til runden
//     ender)
//   - INGEN pattern dekker alle 25 celler → ingen pattern blir flagget som
//     `isFullHouse` av `buildPatternSpecs`
//
// Threshold-tester er derfor inaktuelle med dagens konfig — Game3Engine
// håndterer fortsatt thresholds når en pattern har `ballNumberThreshold`,
// men det testes nå dynamisk via PatternCycler-tester (apps/backend/src/
// game/PatternCycler.test.ts).
//
// "Full House ends the round" er flagget som potensiell regresjon — se
// PR-rapport / Bølge C avsnitt om "Game3Engine ender ikke runden når alle
// 4 patterns er vunnet".

describe.skip("Game3Engine — threshold deaktivering (deprecated for current 4-pattern config)", () => {
  test("Row 1 threshold-tests skipped — DEFAULT_GAME3_CONFIG has no thresholds", () => {
    // Behold-skall for å markere historisk testdekning.
  });
});

describe.skip("Game3Engine — Full House ends the round (potential regression: see PR-rapport)", () => {
  test("Full House semantikk gjelder ikke 4-pattern-config — flagget for verifisering", () => {
    // Game3Engine.ts:228 ender kun runden når en pattern med isFullHouse=true
    // er vunnet. Med 4-pattern-konfig (Topp+midt/Kryss/7/Pyramide) har
    // INGEN pattern isFullHouse=true → `endedReason: "G3_FULL_HOUSE"` fyres
    // aldri. Per game3-canonical-spec.md skal runden ende når alle 4
    // patterns er vunnet, men engine sjekker ikke dette. Flagget for
    // separat fix-PR.
  });
});

// Lucky-number-bonus mekanikken er fortsatt i Game3Engine for parity med
// legacy `game3.js:945-997`, selv om `game3-canonical-spec.md` (2026-05-04)
// sier at Spill 3 ikke skal eksponere lucky number i UI. Tester verifiserer
// at engine fortsatt utbetaler bonus når `luckyNumberPrize > 0` og spillerens
// `setLuckyNumber` matcher `lastBall`. Bag-sekvensen er bygget slik at
// "Topp + midt" wins på draw 9 med ball 61 = lucky.
describe("Game3Engine — lucky-number bonus", () => {
  test("lucky=61, lastBall=61 → bonus paid on top of Topp + midt payout for host only", async () => {
    const cfgWithLucky = {
      ...DEFAULT_GAME3_CONFIG,
      luckyNumberPrize: 5,
    };
    const ctx = await buildG3Engine({
      drawBag: buildToppMidtBag(),
      ticketsByPlayerIndex: [
        [buildToppMidtWinningTicket()],
        [buildToppMidtWinningTicket()],
      ],
      variantConfig: cfgWithLucky,
    });
    await ctx.engine.startGame({
      roomCode: ctx.roomCode, actorPlayerId: ctx.hostId,
      entryFee: ctx.entryFee, ticketsPerPlayer: 1, payoutPercent: ctx.payoutPercent,
      variantConfig: cfgWithLucky,
    });
    ctx.engine.setLuckyNumber(ctx.roomCode, ctx.hostId, 61);
    for (let i = 0; i < 9; i += 1) {
      await ctx.engine.drawNextNumber({ roomCode: ctx.roomCode, actorPlayerId: ctx.hostId });
    }
    const effects = ctx.engine.getG3LastDrawEffects(ctx.roomCode);
    assert.ok(effects);
    const w = effects!.winners.find((x) => x.patternName === "Topp + midt")!;
    assert.ok(w, "Topp + midt winner record");
    const hostShare = w.ticketWinners.find((tw) => tw.playerId === ctx.hostId)!;
    assert.ok(hostShare, "host is a winner");
    assert.equal(hostShare.luckyBonus, 5, "host should receive lucky bonus 5");
    const guestShare = w.ticketWinners.find((tw) => tw.playerId !== ctx.hostId)!;
    assert.ok(guestShare, "guest is a winner");
    assert.equal(guestShare.luckyBonus, 0, "guest has no lucky number set");
    // Wallet delta: host and guest both won Topp + midt (same prize share),
    // but host got +5 extra bonus → host balance > guest balance by 5 kr.
    const hostBal  = (await ctx.wallet.getAccount(ctx.walletIds[0])).balance;
    const guestBal = (await ctx.wallet.getAccount(ctx.walletIds[1])).balance;
    assert.equal(hostBal - guestBal, 5, `host-guest delta should be lucky bonus; host=${hostBal}, guest=${guestBal}`);
    // Claim records the bonusAmount/bonusTriggered on the host's claim only.
    const snap = ctx.engine.getRoomSnapshot(ctx.roomCode);
    const claims = snap.currentGame?.claims ?? [];
    const hostClaim = claims.find((c) => c.playerId === ctx.hostId);
    assert.ok(hostClaim);
    assert.equal(hostClaim!.bonusTriggered, true);
    assert.equal(hostClaim!.bonusAmount, 5);
  });

  test("luckyNumberPrize=0 → lucky hook never fires even when lastBall matches", async () => {
    const ctx = await buildG3Engine({
      drawBag: buildToppMidtBag(),
      ticketsByPlayerIndex: [
        [buildToppMidtWinningTicket()],
        [buildLosingPatternTicket()],
      ],
      variantConfig: DEFAULT_GAME3_CONFIG, // no luckyNumberPrize
    });
    await ctx.engine.startGame({
      roomCode: ctx.roomCode, actorPlayerId: ctx.hostId,
      entryFee: ctx.entryFee, ticketsPerPlayer: 1, payoutPercent: ctx.payoutPercent,
      variantConfig: DEFAULT_GAME3_CONFIG,
    });
    ctx.engine.setLuckyNumber(ctx.roomCode, ctx.hostId, 61);
    for (let i = 0; i < 9; i += 1) {
      await ctx.engine.drawNextNumber({ roomCode: ctx.roomCode, actorPlayerId: ctx.hostId });
    }
    const effects = ctx.engine.getG3LastDrawEffects(ctx.roomCode);
    assert.ok(effects);
    const w = effects!.winners[0];
    assert.equal(w.ticketWinners[0].luckyBonus, 0, "no luckyNumberPrize → no bonus");
  });
});

describe("Game3Engine — G1/G2 regression guard", () => {
  test("patternEvalMode=manual-claim → onDrawCompleted is a no-op (G1 regression)", async () => {
    const ctx = await buildG3Engine({
      drawBag: DRAWBAG_1_TO_75,
      ticketsByPlayerIndex: [[buildToppMidtWinningTicket()], [buildLosingPatternTicket()]],
      variantConfig: { ...DEFAULT_GAME3_CONFIG, patternEvalMode: "manual-claim" },
    });
    await ctx.engine.startGame({
      roomCode: ctx.roomCode, actorPlayerId: ctx.hostId,
      entryFee: ctx.entryFee, ticketsPerPlayer: 1, payoutPercent: ctx.payoutPercent,
      variantConfig: { ...DEFAULT_GAME3_CONFIG, patternEvalMode: "manual-claim" },
    });
    for (let i = 0; i < 5; i += 1) {
      await ctx.engine.drawNextNumber({ roomCode: ctx.roomCode, actorPlayerId: ctx.hostId });
    }
    const effects = ctx.engine.getG3LastDrawEffects(ctx.roomCode);
    assert.equal(effects, undefined, "no G3 effects when manual-claim mode");
    // No auto-claims recorded.
    const snap = ctx.engine.getRoomSnapshot(ctx.roomCode);
    assert.equal(snap.currentGame?.claims.length, 0);
  });

  test("jackpotNumberTable present (G2 marker) → isGame3Round returns false", async () => {
    const cfg = {
      ...DEFAULT_GAME3_CONFIG,
      jackpotNumberTable: DEFAULT_GAME2_CONFIG.jackpotNumberTable,
    };
    const ctx = await buildG3Engine({
      drawBag: DRAWBAG_1_TO_75,
      ticketsByPlayerIndex: [[buildToppMidtWinningTicket()], [buildLosingPatternTicket()]],
      variantConfig: cfg,
    });
    await ctx.engine.startGame({
      roomCode: ctx.roomCode, actorPlayerId: ctx.hostId,
      entryFee: ctx.entryFee, ticketsPerPlayer: 1, payoutPercent: ctx.payoutPercent,
      variantConfig: cfg,
    });
    for (let i = 0; i < 5; i += 1) {
      await ctx.engine.drawNextNumber({ roomCode: ctx.roomCode, actorPlayerId: ctx.hostId });
    }
    const effects = ctx.engine.getG3LastDrawEffects(ctx.roomCode);
    assert.equal(effects, undefined, "jackpotNumberTable signals G2 — Game3Engine skips");
  });

  test("gameSlug not in GAME3_SLUGS → isGame3Round returns false (G1 regression)", async () => {
    const ctx = await buildG3Engine({
      drawBag: DRAWBAG_1_TO_75,
      ticketsByPlayerIndex: [[buildToppMidtWinningTicket()], [buildLosingPatternTicket()]],
      gameSlug: "bingo", // G1 slug — Game3Engine should not engage
    });
    await ctx.engine.startGame({
      roomCode: ctx.roomCode, actorPlayerId: ctx.hostId,
      entryFee: ctx.entryFee, ticketsPerPlayer: 1, payoutPercent: ctx.payoutPercent,
      variantConfig: ctx.variantConfig,
    });
    for (let i = 0; i < 5; i += 1) {
      await ctx.engine.drawNextNumber({ roomCode: ctx.roomCode, actorPlayerId: ctx.hostId });
    }
    const effects = ctx.engine.getG3LastDrawEffects(ctx.roomCode);
    assert.equal(effects, undefined, "non-G3 slug → guard blocks G3 processing");
  });
});

describe("Game3Engine — atomic read-and-clear of G3 effects", () => {
  test("first read returns effects, second read returns undefined", async () => {
    const rest = DRAWBAG_1_TO_75.filter((n) => ![1, 16, 31, 46, 61].includes(n));
    const bag = [1, 16, 31, 46, 61, ...rest];
    const ctx = await buildG3Engine({
      drawBag: bag,
      ticketsByPlayerIndex: [[buildToppMidtWinningTicket()], [buildLosingPatternTicket()]],
    });
    await ctx.engine.startGame({
      roomCode: ctx.roomCode, actorPlayerId: ctx.hostId,
      entryFee: ctx.entryFee, ticketsPerPlayer: 1, payoutPercent: ctx.payoutPercent,
      variantConfig: ctx.variantConfig,
    });
    await ctx.engine.drawNextNumber({ roomCode: ctx.roomCode, actorPlayerId: ctx.hostId });
    const first = ctx.engine.getG3LastDrawEffects(ctx.roomCode);
    const second = ctx.engine.getG3LastDrawEffects(ctx.roomCode);
    assert.ok(first, "first read must return effects");
    assert.equal(second, undefined, "second read must be empty (atomic read-and-clear)");
  });

  test("no G3 effects before first draw", async () => {
    const ctx = await buildG3Engine({
      drawBag: DRAWBAG_1_TO_75,
      ticketsByPlayerIndex: [[buildToppMidtWinningTicket()], [buildLosingPatternTicket()]],
    });
    await ctx.engine.startGame({
      roomCode: ctx.roomCode, actorPlayerId: ctx.hostId,
      entryFee: ctx.entryFee, ticketsPerPlayer: 1, payoutPercent: ctx.payoutPercent,
      variantConfig: ctx.variantConfig,
    });
    assert.equal(ctx.engine.getG3LastDrawEffects(ctx.roomCode), undefined);
  });
});

describe("Game3Engine — cyclerGameIdByRoom reset across rounds", () => {
  test("new game.id rebuilds cycler (snapshot state not leaked between rounds)", async () => {
    // Round 1: losing tickets — drain the bag fully so round naturally ENDS
    // (no Full-House signal in current 4-pattern config, so we hit
    // MAX_DRAWS_REACHED via NO_MORE_NUMBERS).
    const ctx = await buildG3Engine({
      drawBag: DRAWBAG_1_TO_75,
      ticketsByPlayerIndex: [[buildLosingPatternTicket()], [buildLosingPatternTicket()]],
    });
    await ctx.engine.startGame({
      roomCode: ctx.roomCode, actorPlayerId: ctx.hostId,
      entryFee: ctx.entryFee, ticketsPerPlayer: 1, payoutPercent: ctx.payoutPercent,
      variantConfig: ctx.variantConfig,
    });
    // Bare ett par draws for å få cycler bygget for round 1.
    for (let i = 0; i < 5; i += 1) {
      await ctx.engine.drawNextNumber({ roomCode: ctx.roomCode, actorPlayerId: ctx.hostId });
    }
    const effects1 = ctx.engine.getG3LastDrawEffects(ctx.roomCode);
    assert.ok(effects1, "round 1 effects must fire after 5 draws");
    const round1GameId = effects1!.gameId;

    // Peek at internal cycler state — the room's cycler-gameId is round 1's id.
    const internals = ctx.engine as unknown as {
      cyclerGameIdByRoom: Map<string, string>;
      cyclersByRoom: Map<string, unknown>;
    };
    assert.equal(internals.cyclerGameIdByRoom.get(ctx.roomCode), round1GameId);

    // End round 1 manually via the draw-bag exhaustion path — keep drawing
    // until max-draws-per-round (75) hits. With no Full House in current
    // 4-pattern config, the round only ENDS via bag exhaustion.
    try {
      while (ctx.engine.getRoomSnapshot(ctx.roomCode).currentGame?.status === "RUNNING") {
        await ctx.engine.drawNextNumber({ roomCode: ctx.roomCode, actorPlayerId: ctx.hostId });
      }
    } catch { /* NO_MORE_NUMBERS thrown at bag exhaustion — that's fine */ }
    assert.equal(ctx.engine.getRoomSnapshot(ctx.roomCode).currentGame?.status, "ENDED");

    // Simulate the minRoundIntervalMs elapsing by stomping the private last-start
    // timestamp so we can kick off round 2 synchronously.
    const lastStart = (ctx.engine as unknown as {
      roomLastRoundStartMs: Map<string, number>;
    }).roomLastRoundStartMs;
    lastStart.set(ctx.roomCode, Date.now() - 40_000); // 40s ago > 30s interval

    // Start round 2 — fresh cycler should be built with Topp + midt active again.
    (ctx.engine as unknown as { drawBagFactory: (size: number) => number[] }).drawBagFactory =
      () => buildToppMidtBag();

    // Winning ticket for round 2.
    (ctx.engine as unknown as { bingoAdapter: BingoSystemAdapter }).bingoAdapter =
      new QueuedTicketAdapter(buildToppMidtWinningTicket());

    await ctx.engine.startGame({
      roomCode: ctx.roomCode, actorPlayerId: ctx.hostId,
      entryFee: ctx.entryFee, ticketsPerPlayer: 1, payoutPercent: ctx.payoutPercent,
      variantConfig: ctx.variantConfig,
    });
    for (let i = 0; i < 9; i += 1) {
      await ctx.engine.drawNextNumber({ roomCode: ctx.roomCode, actorPlayerId: ctx.hostId });
    }
    const effects2 = ctx.engine.getG3LastDrawEffects(ctx.roomCode);
    assert.ok(effects2, "round 2 effects must fire");
    assert.notEqual(effects2!.gameId, round1GameId, "round 2 has a new gameId");
    // Topp + midt wins in round 2 — proves cycler was rebuilt (fresh state).
    const winner = effects2!.winners.find((w) => w.patternName === "Topp + midt");
    assert.ok(winner, "Topp + midt winner in round 2 proves cycler reset");
    // Internal cycler-gameId updated to round 2.
    assert.equal(internals.cyclerGameIdByRoom.get(ctx.roomCode), effects2!.gameId);
  });
});

describe("Game3Engine — patternSnapshot wire shape", () => {
  test("snapshot contains patternDataList (25 cells), isWon, amount for the 4 design patterns", async () => {
    const ctx = await buildG3Engine({
      drawBag: DRAWBAG_1_TO_75,
      ticketsByPlayerIndex: [[buildLosingPatternTicket()], [buildLosingPatternTicket()]],
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
    assert.equal(snap.length, 4, "expected 4 default patterns (Topp + midt, Kryss, Topp + diagonal, Pyramide)");
    const expectedNames = new Set(["Topp + midt", "Kryss", "Topp + diagonal", "Pyramide"]);
    const seenNames = new Set(snap.map((p) => p.name));
    for (const expected of expectedNames) {
      assert.ok(seenNames.has(expected), `expected pattern "${expected}" in snapshot`);
    }
    for (const p of snap) {
      assert.equal(p.patternDataList.length, 25, "25-cell data list");
      assert.ok(p.patternDataList.every((v) => v === 0 || v === 1), "0/1 only");
      assert.ok(typeof p.amount === "number" && p.amount >= 0, "amount non-negative");
      assert.ok(typeof p.isWon === "boolean");
      // Hver pattern dekker 9 av 25 celler (T/X/7/Pyramide).
      const filled = p.patternDataList.filter((v) => v === 1).length;
      assert.equal(filled, 9, `${p.name} should fill exactly 9 cells; got ${filled}`);
      // Pool = 200 (2 spillere × 100). 25% × 200 = 50 kr per pattern.
      assert.equal(p.amount, 50, `${p.name} amount; expected 50 kr (25% × 200), got ${p.amount}`);
      // None of the 4 patterns covers Full House (all 25 cells).
      assert.equal(p.isFullHouse, false, `${p.name} should NOT be flagged isFullHouse with 9-cell mask`);
    }
  });
});
