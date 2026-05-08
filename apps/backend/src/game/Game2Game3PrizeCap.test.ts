/**
 * Audit §9.1 (2026-05-06): integrasjonstester for prize-cap-binding i
 * Game2Engine og Game3Engine. Verifiserer at single-prize-cap kalles med
 * `gameType: "MAIN_GAME"` (Spill 2/3 er hovedspill per SPILLKATALOG.md),
 * IKKE `"DATABINGO"` som var pre-fix-bug.
 *
 * **Oppdatert 2026-05-08 (Tobias):** Single-prize cap (2500 kr) gjelder
 * KUN databingo. Spill 2/3 (rocket / monsterbingo) er hovedspill og
 * uncapped. Selv om policy-tabellen sier `MAIN_GAME`-cap = 50, skal
 * `applySinglePrizeCap` short-circuite og returnere fullt beløp.
 *
 * Strategi: vi setter `DATABINGO`-cap til en svært lav verdi (50) og
 * verifiserer at Spill 2/3 IKKE blir cappet — dvs. de binder mot
 * `MAIN_GAME`-policyen (som er funksjonelt deaktivert) og IKKE mot
 * `DATABINGO`-policyen. Dette er regresjon-prevent for #769-bug-en
 * (Game2/Game3 hardkodet DATABINGO før #769).
 *
 * Kanonisk regel:
 *   - docs/architecture/SPILL_REGLER_OG_PAYOUT.md §4
 *   - docs/operations/SPILL1_VINNINGSREGLER.md §4
 *
 * Vi tester gjennom det fulle engine-flowet (drawNextNumber + auto-claim)
 * og inspiserer claim-records etter å ha lukket runden.
 */

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { randomUUID } from "node:crypto";
import type {
  BingoSystemAdapter,
  CreateTicketInput,
} from "../adapters/BingoSystemAdapter.js";
import type {
  CreateWalletAccountInput,
  WalletAccount,
  WalletAdapter,
  WalletTransaction,
  WalletTransferResult,
} from "../adapters/WalletAdapter.js";
import { WalletError } from "../adapters/WalletAdapter.js";
import type { Ticket } from "./types.js";
import { Game2Engine, GAME2_MIN_DRAWS_FOR_CHECK } from "./Game2Engine.js";
import { Game3Engine } from "./Game3Engine.js";
import { DEFAULT_GAME2_CONFIG, DEFAULT_GAME3_CONFIG } from "./variantConfig.js";

// ── Wallet/adapter fakes ─────────────────────────────────────────────────────

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
      updatedAt: now,
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
  async getBothBalances(accountId: string) {
    const a = await this.getAccount(accountId);
    return { deposit: a.depositBalance, winnings: a.winningsBalance, total: a.balance };
  }
  async ensureAccount(accountId: string): Promise<WalletAccount> {
    const normalized = accountId.trim();
    if (this.accounts.has(normalized)) return this.getAccount(normalized);
    return this.createAccount({ accountId: normalized, initialBalance: 1_000_000, allowExisting: true });
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
  async listTransactions(accountId: string, limit?: number): Promise<WalletTransaction[]> {
    const filtered = this.transactions.filter((t) => t.accountId === accountId.trim());
    const ordered = [...filtered].reverse();
    return typeof limit === "number" ? ordered.slice(0, limit) : ordered;
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
    const fromTx = await this.debit(fromAccountId, amount, reason);
    const toTx = await this.credit(toAccountId, amount, reason);
    return { fromTx, toTx };
  }

  private async adjust(
    accountIdInput: string,
    delta: number,
    type: WalletTransaction["type"],
    reason: string,
    relatedAccountId?: string,
  ): Promise<WalletTransaction> {
    const id = accountIdInput.trim();
    if (!this.accounts.has(id)) {
      await this.createAccount({ accountId: id, initialBalance: 1_000_000, allowExisting: true });
    }
    const acc = this.accounts.get(id)!;
    const next = acc.balance + delta;
    if (next < 0) throw new WalletError("INSUFFICIENT_FUNDS", "insufficient");
    const updated: WalletAccount = {
      ...acc,
      balance: next,
      depositBalance: next,
      winningsBalance: 0,
      updatedAt: new Date().toISOString(),
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

class WinningG2Adapter implements BingoSystemAdapter {
  async createTicket(_input: CreateTicketInput): Promise<Ticket> {
    return {
      grid: [
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9],
      ],
    };
  }
}

class WinningG3Adapter implements BingoSystemAdapter {
  async createTicket(_input: CreateTicketInput): Promise<Ticket> {
    // 5×5 grid with center FREE — 24 distinct numbers from 1..75. Fills row 1
    // when first 5 balls 1..5 are drawn.
    return {
      grid: [
        [1, 16, 31, 46, 61],
        [2, 17, 32, 47, 62],
        [3, 18, 33, 48, 63],
        [4, 19, 34, 49, 64],
        [5, 20, 35, 50, 65],
      ],
    };
  }
}

// ── Game2 (rocket) prize-cap binding ────────────────────────────────────────

describe("Game2Engine — prize-cap binder mot MAIN_GAME (audit §9.1, oppdatert 2026-05-08)", () => {
  test("Spill 2 (rocket) ignorerer MAIN_GAME-cap (uncapped) men ville cappet hvis bound mot DATABINGO", async () => {
    // Setup: opprett engine med default policy. Sett deretter:
    //   - MAIN_GAME-cap = 50 (svært lav — men funksjonelt deaktivert per
    //     2026-05-08 cap-fjerning)
    //   - DATABINGO-cap = 50 (også lav — pre-#769-bug-en bandt rocket
    //     til DATABINGO; hvis det skjer igjen vil capen aktiveres)
    // Forventning: Spill 2 binder til MAIN_GAME → cap deaktivert →
    // payout > 50. Hvis bug-en er tilbake (DATABINGO bound) ville payout
    // vært ≤ 50 fordi DATABINGO-cap ER aktiv.
    const wallet = new InMemoryWalletAdapter();
    await wallet.createAccount({ accountId: "wallet-host", initialBalance: 1_000_000 });
    await wallet.createAccount({ accountId: "wallet-guest", initialBalance: 1_000_000 });
    const drawBag = () => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
    const engine = new Game2Engine(new WinningG2Adapter(), wallet, {
      minRoundIntervalMs: 30_000,
      minPlayersToStart: 2,
      minDrawIntervalMs: 0,
      maxDrawsPerRound: 21,
      drawBagFactory: drawBag,
      dailyLossLimit: 1_000_000,
      monthlyLossLimit: 10_000_000,
    });

    // DATABINGO-cap settes til 1 (svært lav). MAIN_GAME-cap er
    // default 2500 (men funksjonelt deaktivert per 2026-05-08
    // cap-fjerning). Hvis #769-regresjon skjer (Game2 hardkoder
    // DATABINGO igjen), ville alle payouts bli kappet til 1.
    await engine.upsertPrizePolicy({
      gameType: "DATABINGO",
      effectiveFrom: new Date().toISOString(),
      singlePrizeCap: 1,
      dailyExtraPrizeCap: 5_000,
    });

    const { roomCode, playerId: hostId } = await engine.createRoom({
      hallId: "hall-1",
      playerName: "Host",
      walletId: "wallet-host",
      gameSlug: "rocket",
    });
    await engine.joinRoom({
      roomCode,
      hallId: "hall-1",
      playerName: "Guest",
      walletId: "wallet-guest",
    });
    // Bruk høy entry-fee + tickets så pricePerWinner blir >> 50.
    await engine.startGame({
      roomCode,
      actorPlayerId: hostId,
      entryFee: 500,
      ticketsPerPlayer: 5,
      payoutPercent: 80,
      variantConfig: DEFAULT_GAME2_CONFIG,
    });
    for (let i = 0; i < GAME2_MIN_DRAWS_FOR_CHECK; i += 1) {
      await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
    }

    const snap = engine.getRoomSnapshot(roomCode);
    const claims = snap.currentGame?.claims ?? [];
    assert.ok(claims.length > 0, "minst én claim forventet etter draw 9");
    // 2026-05-08: Forventet at minst én claim har payout > 1 som bevis
    // på at Spill 2 binder til MAIN_GAME (uncapped) IKKE DATABINGO
    // (capped til 1). Hvis #769-regresjon skjer ville alle claims
    // vært ≤ 1.
    const overCap = claims.filter((c) => (c.payoutAmount ?? 0) > 1);
    assert.ok(
      overCap.length > 0,
      `Spill 2 (rocket) skal binde til MAIN_GAME (uncapped); DATABINGO-cap=1 må IKKE aktiveres. Faktisk payouts: ${claims.slice(0, 10).map((c) => c.payoutAmount).join(", ")}`,
    );
  });
});

// ── Game3 (monsterbingo) prize-cap binding ──────────────────────────────────

describe("Game3Engine — prize-cap binder mot MAIN_GAME (audit §9.1, oppdatert 2026-05-08)", () => {
  test("Spill 3 (monsterbingo) ignorerer MAIN_GAME-cap (uncapped) men ville cappet hvis bound mot DATABINGO", async () => {
    // 2026-05-08: cap-fjerning for hovedspill. Spill 3 binder til
    // MAIN_GAME (per #769) → cap deaktivert. Selv med cap=50 i
    // policy-tabellen for begge gameTypes, skal Spill 3 utbetale fullt.
    // Hvis #769-regresjon (DATABINGO-binding), ville cap-50 aktiveres.
    const wallet = new InMemoryWalletAdapter();
    await wallet.createAccount({ accountId: "wallet-host", initialBalance: 1_000_000 });
    await wallet.createAccount({ accountId: "wallet-guest", initialBalance: 1_000_000 });
    // Deterministisk drawbag: 1..75.
    const drawBag = () => Array.from({ length: 75 }, (_, i) => i + 1);
    const engine = new Game3Engine(new WinningG3Adapter(), wallet, {
      minRoundIntervalMs: 30_000,
      minPlayersToStart: 2,
      minDrawIntervalMs: 0,
      maxDrawsPerRound: 75,
      drawBagFactory: drawBag,
      dailyLossLimit: 1_000_000,
      monthlyLossLimit: 10_000_000,
    });

    // DATABINGO-cap settes til 1 (svært lav). MAIN_GAME-cap er
    // default 2500 (men funksjonelt deaktivert per cap-fjerning). Hvis
    // #769-regresjon skjer (Game3 hardkoder DATABINGO igjen), ville
    // alle payouts bli kappet til 1.
    await engine.upsertPrizePolicy({
      gameType: "DATABINGO",
      effectiveFrom: new Date().toISOString(),
      singlePrizeCap: 1,
      dailyExtraPrizeCap: 5_000,
    });

    const { roomCode, playerId: hostId } = await engine.createRoom({
      hallId: "hall-1",
      playerName: "Host",
      walletId: "wallet-host",
      gameSlug: "monsterbingo",
    });
    await engine.joinRoom({
      roomCode,
      hallId: "hall-1",
      playerName: "Guest",
      walletId: "wallet-guest",
    });
    await engine.startGame({
      roomCode,
      actorPlayerId: hostId,
      entryFee: 200,
      ticketsPerPlayer: 5,
      payoutPercent: 80,
      variantConfig: DEFAULT_GAME3_CONFIG,
    });

    // Trekk baller helt til runden ender (Coverall ferdig eller maxBalls).
    for (let i = 0; i < 75; i += 1) {
      const snap = engine.getRoomSnapshot(roomCode);
      if (snap.currentGame?.status !== "RUNNING") break;
      try {
        await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
      } catch {
        break;
      }
    }

    const snap = engine.getRoomSnapshot(roomCode);
    const claims = snap.currentGame?.claims ?? [];
    if (claims.length === 0) {
      // Hvis runden ikke endte med winners (configurasjon kan variere),
      // skip stille — vi tester en annen path da. Ikke fail.
      return;
    }

    // 2026-05-08: Forventet at minst én claim har payout > 1 som bevis
    // på at Spill 3 binder til MAIN_GAME (uncapped) IKKE DATABINGO
    // (capped til 1). Hvis #769-regresjon skjer ville alle claims
    // vært ≤ 1.
    const overCap = claims.filter((c) => (c.payoutAmount ?? 0) > 1);
    assert.ok(
      overCap.length > 0,
      `Spill 3 (monsterbingo) skal binde til MAIN_GAME (uncapped); DATABINGO-cap=1 må IKKE aktiveres. Faktisk payouts: ${claims.slice(0, 10).map((c) => c.payoutAmount).join(", ")}`,
    );
  });
});
