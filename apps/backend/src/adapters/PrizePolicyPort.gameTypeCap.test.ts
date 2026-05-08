/**
 * Tests for cap-fjerning (Tobias 2026-05-08): single-prize cap (2500 kr)
 * skal kun aktiveres for `gameType = DATABINGO`. For `MAIN_GAME`
 * (Spill 1, 2, 3) skal beløpet returneres uendret uansett størrelse.
 *
 * Kanonisk regel:
 *   - docs/architecture/SPILL_REGLER_OG_PAYOUT.md §4
 *   - docs/operations/SPILL1_VINNINGSREGLER.md §4
 *
 * Pre-fix-feil: PrizePolicyPort.applySinglePrizeCap aktiveres BLANKET for
 * alle gameTypes via PrizePolicyManager. Innsatsen lilla Fullt Hus (3000 kr)
 * og Oddsen lilla HIGH (4500 kr) ble derfor cappet til 2500 — feil for
 * hovedspill.
 *
 * Disse testene låser:
 *   - MAIN_GAME → uncapped uansett beløp (3000, 4500, 100, 30 000)
 *   - DATABINGO → capped ved 2500 (3000 → 2500 cap, 500 retained)
 *   - DATABINGO på grensen → 2500 → 2500 (ingen rest)
 *   - DATABINGO under grensen → 1000 → 1000 (ingen cap)
 *   - PrizePolicyPort-wrapper (BingoEngine.getPrizePolicyPort) returnerer
 *     uncapped for Spill 1-payouts (port hardkoder MAIN_GAME).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { PrizePolicyManager } from "../game/PrizePolicyManager.js";
import { InMemoryWalletAdapter } from "./InMemoryWalletAdapter.js";
import { BingoEngine } from "../game/BingoEngine.js";
import type {
  BingoSystemAdapter,
  CreateTicketInput,
} from "./BingoSystemAdapter.js";
import type { Ticket } from "../game/types.js";

// Inline minimal-adapter — vi trenger bare BingoEngine-instansen for å få
// tak i `getPrizePolicyPort()`-wrapperen, ikke faktisk ticket-generering.
class StubBingoAdapter implements BingoSystemAdapter {
  async createTicket(_input: CreateTicketInput): Promise<Ticket> {
    return {
      grid: [
        [1, 2, 3, 4, 5],
        [13, 14, 15, 16, 17],
        [25, 26, 0, 27, 28],
        [37, 38, 39, 40, 41],
        [49, 50, 51, 52, 53],
      ],
    };
  }
}

// ── PrizePolicyManager.applySinglePrizeCap ─────────────────────────────────────

test("MAIN_GAME — premie 3000 kr returneres uendret (Innsatsen lilla Fullt Hus)", () => {
  const manager = new PrizePolicyManager({});
  const result = manager.applySinglePrizeCap({
    hallId: "hall-1",
    gameType: "MAIN_GAME",
    amount: 3000,
  });
  assert.equal(result.cappedAmount, 3000, "3000 kr utbetales fullt for hovedspill");
  assert.equal(result.wasCapped, false, "wasCapped=false for MAIN_GAME");
  assert.ok(result.policy, "policy-objekt returneres for sporbarhet");
});

test("MAIN_GAME — premie 4500 kr returneres uendret (Oddsen lilla HIGH)", () => {
  const manager = new PrizePolicyManager({});
  const result = manager.applySinglePrizeCap({
    hallId: "hall-1",
    gameType: "MAIN_GAME",
    amount: 4500,
  });
  assert.equal(result.cappedAmount, 4500, "4500 kr utbetales fullt for hovedspill");
  assert.equal(result.wasCapped, false);
});

test("MAIN_GAME — liten premie 100 kr returneres uendret", () => {
  const manager = new PrizePolicyManager({});
  const result = manager.applySinglePrizeCap({
    hallId: "hall-1",
    gameType: "MAIN_GAME",
    amount: 100,
  });
  assert.equal(result.cappedAmount, 100);
  assert.equal(result.wasCapped, false);
});

test("MAIN_GAME — meget høy premie 30 000 kr (Jackpott daglig akkumulert) returneres uendret", () => {
  // Game1 jackpot kan akkumulere til 30 000 kr (ref MASTER_PLAN_SPILL1_PILOT
  // §2.3 og PotEvaluator-test pre-fix). Hovedspill → ingen cap.
  const manager = new PrizePolicyManager({});
  const result = manager.applySinglePrizeCap({
    hallId: "hall-1",
    gameType: "MAIN_GAME",
    amount: 30_000,
  });
  assert.equal(result.cappedAmount, 30_000, "Spill 1 jackpot 30 000 kr utbetales fullt");
  assert.equal(result.wasCapped, false);
});

test("DATABINGO — premie 3000 kr cappes til 2500 (rest 500 til hus)", () => {
  const manager = new PrizePolicyManager({});
  const result = manager.applySinglePrizeCap({
    hallId: "hall-1",
    gameType: "DATABINGO",
    amount: 3000,
  });
  assert.equal(result.cappedAmount, 2500, "databingo cap 2500 kr per §11");
  assert.equal(result.wasCapped, true);
  // Rest = 500 kr til huset (caller logger som HOUSE_RETAINED).
  assert.equal(3000 - result.cappedAmount, 500);
});

test("DATABINGO — på grensen 2500 kr returneres uendret (ingen rest)", () => {
  const manager = new PrizePolicyManager({});
  const result = manager.applySinglePrizeCap({
    hallId: "hall-1",
    gameType: "DATABINGO",
    amount: 2500,
  });
  assert.equal(result.cappedAmount, 2500);
  assert.equal(result.wasCapped, false);
});

test("DATABINGO — under grensen 1000 kr returneres uendret", () => {
  const manager = new PrizePolicyManager({});
  const result = manager.applySinglePrizeCap({
    hallId: "hall-1",
    gameType: "DATABINGO",
    amount: 1000,
  });
  assert.equal(result.cappedAmount, 1000);
  assert.equal(result.wasCapped, false);
});

test("DATABINGO — meget høy premie 30 000 kr cappes til 2500", () => {
  const manager = new PrizePolicyManager({});
  const result = manager.applySinglePrizeCap({
    hallId: "hall-1",
    gameType: "DATABINGO",
    amount: 30_000,
  });
  assert.equal(result.cappedAmount, 2500);
  assert.equal(result.wasCapped, true);
  assert.equal(30_000 - result.cappedAmount, 27_500);
});

test("MAIN_GAME — selv hall-spesifikk lavere policy ignoreres (ingen cap for hovedspill)", async () => {
  // Ingen mulighet for å sette MAIN_GAME-cap så lavt at det aktiverer
  // capping. Dette låser at policy-konfig ikke kan reintrodusere capen
  // ved et uhell. Bare DATABINGO-bucketen aktiverer cap.
  const manager = new PrizePolicyManager({});
  await manager.upsertPrizePolicy({
    gameType: "MAIN_GAME",
    hallId: "hall-special",
    effectiveFrom: new Date().toISOString(),
    singlePrizeCap: 50, // Hypotetisk lavere cap.
    dailyExtraPrizeCap: 5000,
  });

  const result = manager.applySinglePrizeCap({
    hallId: "hall-special",
    gameType: "MAIN_GAME",
    amount: 3000,
  });
  // Selv med policy som sier 50 capper vi IKKE for MAIN_GAME.
  assert.equal(result.cappedAmount, 3000, "MAIN_GAME aldri capped uansett policy-config");
  assert.equal(result.wasCapped, false);
});

// ── PrizePolicyPort wrapper (BingoEngine.getPrizePolicyPort) ───────────────────

test(
  "PrizePolicyPort — Spill 1 wrapper passer MAIN_GAME → premie 3000 kr uncappet",
  () => {
    const wallet = new InMemoryWalletAdapter();
    const engine = new BingoEngine(new StubBingoAdapter(), wallet);
    const port = engine.getPrizePolicyPort();

    const result = port.applySinglePrizeCap({
      hallId: "hall-1",
      amount: 3000,
    });
    assert.equal(result.cappedAmount, 3000, "Spill 1 mini-game 3000 kr utbetales fullt");
    assert.equal(result.wasCapped, false);
    assert.ok(result.policyId, "policyId returnert for sporbarhet");
  },
);

test(
  "PrizePolicyPort — Spill 1 wrapper for høy mini-game-payout 4000 kr (Wheel) uncappet",
  () => {
    // Pre-fix: Wheel-buckets på 4000 kr ble cappet til 2500. Etter fix:
    // hovedspill mini-games utbetales fullt.
    const wallet = new InMemoryWalletAdapter();
    const engine = new BingoEngine(new StubBingoAdapter(), wallet);
    const port = engine.getPrizePolicyPort();

    const result = port.applySinglePrizeCap({
      hallId: "hall-1",
      amount: 4000,
    });
    assert.equal(result.cappedAmount, 4000);
    assert.equal(result.wasCapped, false);
  },
);

test(
  "PrizePolicyPort — Spill 1 jackpot 30 000 kr uncappet via port",
  () => {
    const wallet = new InMemoryWalletAdapter();
    const engine = new BingoEngine(new StubBingoAdapter(), wallet);
    const port = engine.getPrizePolicyPort();

    const result = port.applySinglePrizeCap({
      hallId: "hall-1",
      amount: 30_000,
    });
    assert.equal(result.cappedAmount, 30_000, "Spill 1 jackpot 30 000 kr full payout");
    assert.equal(result.wasCapped, false);
  },
);
