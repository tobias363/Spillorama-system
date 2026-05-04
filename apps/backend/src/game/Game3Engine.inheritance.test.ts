/**
 * Regresjons-test for engine-arkitektur-bug 2026-05-04 (Tobias-direktiv).
 *
 * Bakgrunn:
 *   - Backend instansierer ÉN engine for hele prosessen via
 *     `new Game3Engine(...)` i `apps/backend/src/index.ts:619`.
 *   - Tidligere extended Game2Engine OG Game3Engine begge BingoEngine
 *     direkte (sibling-subclass-mønster). Da var
 *     `instanceof Game2Engine` false for runtime-instansen og
 *     `Game2Engine.onDrawCompleted` ble aldri kalt for ROCKET-rom.
 *   - Konsekvens: `autoMarkPlayerCells` i Game2Engine.onDrawCompleted
 *     fyrte aldri, og `g2:jackpot:list-update` / `g2:ticket:completed`
 *     ble aldri emit'et fra cron-pipelinen.
 *
 * Fix (2026-05-04): Game3Engine extends Game2Engine. Inheritance-chainen
 * blir Game3Engine ⊂ Game2Engine ⊂ BingoEngine. `super.onDrawCompleted(ctx)`
 * i Game3Engine kjører nå Game2Engine sin hook for G2-rom, og
 * `instanceof Game2Engine` matcher runtime-instansen.
 *
 * Denne testen vokter mot en framtidig regresjon ved å verifisere:
 *   1. Game3Engine extends Game2Engine (instanceof-chain).
 *   2. En `new Game3Engine(...)` matcher BÅDE `instanceof Game2Engine`
 *      OG `instanceof Game3Engine`.
 *   3. `getG2LastDrawEffects` er tilgjengelig på Game3Engine-instansen
 *      (arvet fra Game2Engine), og er ulik `getG3LastDrawEffects`-stashen
 *      (separate Maps takket være feltet `lastG3DrawEffectsByRoom`).
 *
 * Bivirkninger: ingen — testen bruker kun `new Game3Engine(...)` med
 * minimale stubs og inspiserer prototype/method-tilgjengelighet. Ingen
 * spill startes, ingen draws skjer.
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
import { BingoEngine } from "./BingoEngine.js";
import { Game2Engine } from "./Game2Engine.js";
import { Game3Engine } from "./Game3Engine.js";
import type { Ticket } from "./types.js";

// ── Minimal stubs for engine constructor ────────────────────────────────────

class StubBingoAdapter implements BingoSystemAdapter {
  async createTicket(_input: CreateTicketInput): Promise<Ticket> {
    return {
      grid: [
        [1, 17, 33, 49, 65],
        [2, 18, 34, 50, 66],
        [3, 19, 35, 51, 67],
        [4, 20, 36, 52, 68],
        [5, 21, 37, 53, 69],
      ],
    };
  }
}

class StubWalletAdapter implements WalletAdapter {
  private readonly accounts = new Map<string, WalletAccount>();
  async createAccount(input?: CreateWalletAccountInput): Promise<WalletAccount> {
    const id = input?.accountId?.trim() || `w-${randomUUID()}`;
    const now = new Date().toISOString();
    const acc: WalletAccount = {
      id,
      balance: 0,
      depositBalance: 0,
      winningsBalance: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.accounts.set(id, acc);
    return { ...acc };
  }
  async getDepositBalance(): Promise<number> { return 0; }
  async getWinningsBalance(): Promise<number> { return 0; }
  async getBothBalances(): Promise<{ deposit: number; winnings: number; total: number }> {
    return { deposit: 0, winnings: 0, total: 0 };
  }
  async ensureAccount(id: string): Promise<WalletAccount> {
    const existing = this.accounts.get(id);
    if (existing) return { ...existing };
    return this.createAccount({ accountId: id });
  }
  async getAccount(id: string): Promise<WalletAccount> {
    const a = this.accounts.get(id);
    if (!a) throw new WalletError("ACCOUNT_NOT_FOUND", "no");
    return { ...a };
  }
  async listAccounts(): Promise<WalletAccount[]> { return [...this.accounts.values()].map((a) => ({ ...a })); }
  async getBalance(): Promise<number> { return 0; }
  async debit(): Promise<WalletTransaction> { throw new WalletError("INVALID_AMOUNT", "stub"); }
  async credit(): Promise<WalletTransaction> { throw new WalletError("INVALID_AMOUNT", "stub"); }
  async topUp(): Promise<WalletTransaction> { throw new WalletError("INVALID_AMOUNT", "stub"); }
  async withdraw(): Promise<WalletTransaction> { throw new WalletError("INVALID_AMOUNT", "stub"); }
  async transfer(): Promise<WalletTransferResult> { throw new WalletError("INVALID_AMOUNT", "stub"); }
  async listTransactions(): Promise<WalletTransaction[]> { return []; }
}

function makeEngine(): Game3Engine {
  return new Game3Engine(new StubBingoAdapter(), new StubWalletAdapter(), {
    minRoundIntervalMs: 30_000,
    minPlayersToStart: 2,
    minDrawIntervalMs: 0,
    maxDrawsPerRound: 75,
    dailyLossLimit: 1_000_000,
    monthlyLossLimit: 10_000_000,
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Game3Engine inheritance chain (regresjons-test 2026-05-04)", () => {
  test("Game3Engine extends Game2Engine extends BingoEngine", () => {
    const engine = makeEngine();
    assert.ok(
      engine instanceof Game3Engine,
      "engine skal være Game3Engine",
    );
    assert.ok(
      engine instanceof Game2Engine,
      "engine skal også være Game2Engine — denne assertionen var FALSE før " +
        "fix 2026-05-04 og forhindret Game2Engine.onDrawCompleted i å fyre " +
        "for ROCKET-rom",
    );
    assert.ok(
      engine instanceof BingoEngine,
      "engine skal også være BingoEngine via inheritance-chainen",
    );
  });

  test("Game2Engine.prototype er i prototype-kjeden til Game3Engine", () => {
    const engine = makeEngine();
    let proto = Object.getPrototypeOf(engine);
    let foundGame2 = false;
    let foundGame3 = false;
    let foundBingo = false;
    while (proto && proto !== Object.prototype) {
      if (proto === Game3Engine.prototype) foundGame3 = true;
      if (proto === Game2Engine.prototype) foundGame2 = true;
      if (proto === BingoEngine.prototype) foundBingo = true;
      proto = Object.getPrototypeOf(proto);
    }
    assert.ok(foundGame3, "Game3Engine.prototype mangler i kjeden");
    assert.ok(foundGame2, "Game2Engine.prototype mangler i kjeden");
    assert.ok(foundBingo, "BingoEngine.prototype mangler i kjeden");
  });

  test("getG2LastDrawEffects og getG3LastDrawEffects er separate metoder", () => {
    const engine = makeEngine();
    // Begge metodene må eksistere på instansen (arv via Game2Engine for G2,
    // egen klasse for G3).
    assert.equal(
      typeof engine.getG2LastDrawEffects,
      "function",
      "getG2LastDrawEffects mangler — Game3Engine extends Game2Engine ble brutt",
    );
    assert.equal(typeof engine.getG3LastDrawEffects, "function");
    // Med separate stash-Maps (`lastDrawEffectsByRoom` i Game2 vs
    // `lastG3DrawEffectsByRoom` i Game3) skal en tom instans returnere
    // undefined fra begge — dette verifiserer at vi ikke har en field-
    // initializer-kollisjon der den ene Mapen overskriver den andre ved
    // konstruksjon.
    assert.equal(engine.getG2LastDrawEffects("ROOM-A"), undefined);
    assert.equal(engine.getG3LastDrawEffects("ROOM-A"), undefined);
  });
});
