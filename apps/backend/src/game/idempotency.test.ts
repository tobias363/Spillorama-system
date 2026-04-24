/**
 * PR-N1: enhetstest for kanonisk IdempotencyKeys-modul.
 *
 * Formål:
 *   1. Byte-identitet mot legacy template-literal-format for hver key-type
 *      (forhindrer at refaktor endrer wallet-idempotency-contract).
 *   2. Format-regex-gate: alle keys skal matche IDEMPOTENCY_KEY_FORMAT.
 *   3. Determinisme: samme input → samme key.
 *   4. Kollisjons-forhindring: forskjellige input → forskjellige keys.
 *   5. Key-prefix er uendret (så DB-queries som filtrerer på prefix
 *      fortsetter å fungere).
 */

import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import { IDEMPOTENCY_KEY_FORMAT, IdempotencyKeys } from "./idempotency.js";

describe("IdempotencyKeys — byte-identitet mot legacy template-literals", () => {
  test("game1Phase matcher `g1-phase-{gameId}-{phase}-{assignmentId}`", () => {
    const key = IdempotencyKeys.game1Phase({
      scheduledGameId: "sg-1",
      phase: 3,
      assignmentId: "assign-42",
    });
    assert.equal(key, "g1-phase-sg-1-3-assign-42");
  });

  test("game1Jackpot matcher `g1-jackpot-{hallId}-{gameId}`", () => {
    const key = IdempotencyKeys.game1Jackpot({
      hallId: "hall-a",
      scheduledGameId: "sg-1",
    });
    assert.equal(key, "g1-jackpot-hall-a-sg-1");
  });

  test("game1Pot matcher `g1-pot-{potId}-{gameId}`", () => {
    const key = IdempotencyKeys.game1Pot({
      potId: "pot-innsatsen-1",
      scheduledGameId: "sg-7",
    });
    assert.equal(key, "g1-pot-pot-innsatsen-1-sg-7");
  });

  test("game1PurchaseDebit matcher `game1-purchase:{clientKey}:debit`", () => {
    const key = IdempotencyKeys.game1PurchaseDebit({
      clientIdempotencyKey: "client-abc",
    });
    assert.equal(key, "game1-purchase:client-abc:debit");
  });

  test("game1LuckyBonus matcher `g1-lucky-bonus-{scheduledGameId}-{winnerId}` (K1-C PM-spec)", () => {
    const key = IdempotencyKeys.game1LuckyBonus({
      scheduledGameId: "sg-7",
      winnerId: "user-42",
    });
    assert.equal(key, "g1-lucky-bonus-sg-7-user-42");
    assert.match(key, IDEMPOTENCY_KEY_FORMAT);
  });

  test("game1LuckyBonus: determinisme — samme input → samme key", () => {
    const a = IdempotencyKeys.game1LuckyBonus({ scheduledGameId: "s1", winnerId: "w1" });
    const b = IdempotencyKeys.game1LuckyBonus({ scheduledGameId: "s1", winnerId: "w1" });
    assert.equal(a, b);
  });

  test("game1LuckyBonus: forskjellige winners → forskjellige keys", () => {
    const a = IdempotencyKeys.game1LuckyBonus({ scheduledGameId: "s1", winnerId: "w1" });
    const b = IdempotencyKeys.game1LuckyBonus({ scheduledGameId: "s1", winnerId: "w2" });
    assert.notEqual(a, b);
  });

  test("game1RefundCredit matcher `game1-refund:{purchaseId}:credit`", () => {
    const key = IdempotencyKeys.game1RefundCredit({ purchaseId: "g1p-xyz" });
    assert.equal(key, "game1-refund:g1p-xyz:credit");
  });

  test("game1MiniGame matcher `g1-minigame-{resultId}`", () => {
    const key = IdempotencyKeys.game1MiniGame({ resultId: "mgr-happy" });
    assert.equal(key, "g1-minigame-mgr-happy");
  });

  test("game1Oddsen matcher `g1-oddsen-{stateId}`", () => {
    const key = IdempotencyKeys.game1Oddsen({ stateId: "oddsen-42" });
    assert.equal(key, "g1-oddsen-oddsen-42");
  });

  test("game2Jackpot matcher `g2-jackpot-{gameId}-{claimId}`", () => {
    assert.equal(
      IdempotencyKeys.game2Jackpot({ gameId: "g2-1", claimId: "c-1" }),
      "g2-jackpot-g2-1-c-1"
    );
  });

  test("game2Lucky matcher `g2-lucky-{gameId}-{claimId}`", () => {
    assert.equal(
      IdempotencyKeys.game2Lucky({ gameId: "g2-1", claimId: "c-2" }),
      "g2-lucky-g2-1-c-2"
    );
  });

  test("game3Pattern matcher `g3-pattern-{gameId}-{claimId}`", () => {
    assert.equal(
      IdempotencyKeys.game3Pattern({ gameId: "g3-1", claimId: "c-3" }),
      "g3-pattern-g3-1-c-3"
    );
  });

  test("game3Lucky matcher `g3-lucky-{gameId}-{claimId}`", () => {
    assert.equal(
      IdempotencyKeys.game3Lucky({ gameId: "g3-1", claimId: "c-4" }),
      "g3-lucky-g3-1-c-4"
    );
  });

  test("adhocBuyIn matcher `buyin-{gameId}-{playerId}`", () => {
    assert.equal(
      IdempotencyKeys.adhocBuyIn({ gameId: "game-1", playerId: "p-7" }),
      "buyin-game-1-p-7"
    );
  });

  test("adhocPhase matcher `phase-{patternId}-{gameId}-{playerId}`", () => {
    assert.equal(
      IdempotencyKeys.adhocPhase({
        patternId: "pat-1",
        gameId: "game-1",
        playerId: "p-1",
      }),
      "phase-pat-1-game-1-p-1"
    );
  });

  test("adhocLinePrize matcher `line-prize-{gameId}-{claimId}`", () => {
    assert.equal(
      IdempotencyKeys.adhocLinePrize({ gameId: "game-1", claimId: "c-1" }),
      "line-prize-game-1-c-1"
    );
  });

  test("adhocBingoPrize matcher `bingo-prize-{gameId}-{claimId}`", () => {
    assert.equal(
      IdempotencyKeys.adhocBingoPrize({ gameId: "game-1", claimId: "c-1" }),
      "bingo-prize-game-1-c-1"
    );
  });

  test("adhocJackpot matcher `jackpot-{gameId}-spin-{playedSpins}`", () => {
    assert.equal(
      IdempotencyKeys.adhocJackpot({ gameId: "game-1", playedSpins: 3 }),
      "jackpot-game-1-spin-3"
    );
  });

  test("adhocMiniGame matcher `minigame-{gameId}-{type}`", () => {
    assert.equal(
      IdempotencyKeys.adhocMiniGame({ gameId: "game-1", miniGameType: "wheel" }),
      "minigame-game-1-wheel"
    );
  });

  test("adhocExtraPrize matcher `extra-prize-{id}`", () => {
    assert.equal(
      IdempotencyKeys.adhocExtraPrize({ extraPrizeId: "xp-1" }),
      "extra-prize-xp-1"
    );
  });

  test("adhocRefund matcher `refund-{gameId}-{playerId}`", () => {
    assert.equal(
      IdempotencyKeys.adhocRefund({ gameId: "game-1", playerId: "p-1" }),
      "refund-game-1-p-1"
    );
  });

  test("adhocTicketReplace matcher `ticket-replace-{roomCode}-{playerId}-{ticketId}`", () => {
    assert.equal(
      IdempotencyKeys.adhocTicketReplace({
        roomCode: "ABC123",
        playerId: "p-1",
        ticketId: "t-1",
      }),
      "ticket-replace-ABC123-p-1-t-1"
    );
  });

  test("paymentRequest matcher `payment-request:{kind}:{id}`", () => {
    assert.equal(
      IdempotencyKeys.paymentRequest({ kind: "deposit", requestId: "req-1" }),
      "payment-request:deposit:req-1"
    );
    assert.equal(
      IdempotencyKeys.paymentRequest({ kind: "withdraw", requestId: "req-2" }),
      "payment-request:withdraw:req-2"
    );
  });

  test("agentTxWallet matcher `agent-tx:{txId}:wallet`", () => {
    assert.equal(
      IdempotencyKeys.agentTxWallet({ txId: "agenttx-1" }),
      "agent-tx:agenttx-1:wallet"
    );
  });

  test("agentTxCancel matcher `agent-tx:{originalTxId}:cancel`", () => {
    assert.equal(
      IdempotencyKeys.agentTxCancel({ originalTxId: "agenttx-42" }),
      "agent-tx:agenttx-42:cancel"
    );
  });

  test("agentPhysicalSell matcher `agent-ticket:{uniqueId}:sell:wallet`", () => {
    assert.equal(
      IdempotencyKeys.agentPhysicalSell({ ticketUniqueId: "TIX-99" }),
      "agent-ticket:TIX-99:sell:wallet"
    );
  });

  test("agentDigitalTicket matcher `agent-ticket:digital:{gameId}:{playerUserId}:{clientRequestId}`", () => {
    assert.equal(
      IdempotencyKeys.agentDigitalTicket({
        gameId: "g-1",
        playerUserId: "user-1",
        clientRequestId: "cr-1",
      }),
      "agent-ticket:digital:g-1:user-1:cr-1"
    );
  });

  test("agentProductSale matcher `product-sale:{cartId}:wallet`", () => {
    assert.equal(
      IdempotencyKeys.agentProductSale({ cartId: "cart-1" }),
      "product-sale:cart-1:wallet"
    );
  });

  test("machineRefund matcher `{uniqueTransaction}:refund`", () => {
    assert.equal(
      IdempotencyKeys.machineRefund({
        uniqueTransaction: "okbingo:create:tix-1:cr-1",
      }),
      "okbingo:create:tix-1:cr-1:refund"
    );
  });

  test("machineCredit matcher `{uniqueTransaction}:credit`", () => {
    assert.equal(
      IdempotencyKeys.machineCredit({
        uniqueTransaction: "metronia:close:tix-1:cr-1",
      }),
      "metronia:close:tix-1:cr-1:credit"
    );
  });
});

describe("IdempotencyKeys — format-regex-gate", () => {
  test("alle keys matcher IDEMPOTENCY_KEY_FORMAT", () => {
    const samples: string[] = [
      IdempotencyKeys.game1Phase({
        scheduledGameId: "sg-1",
        phase: 3,
        assignmentId: "a-1",
      }),
      IdempotencyKeys.game1Jackpot({ hallId: "h-1", scheduledGameId: "sg-1" }),
      IdempotencyKeys.game1Pot({ potId: "p-1", scheduledGameId: "sg-1" }),
      IdempotencyKeys.game1PurchaseDebit({ clientIdempotencyKey: "c-1" }),
      IdempotencyKeys.game1RefundCredit({ purchaseId: "g1p-1" }),
      IdempotencyKeys.game1MiniGame({ resultId: "r-1" }),
      IdempotencyKeys.game1Oddsen({ stateId: "s-1" }),
      IdempotencyKeys.game2Jackpot({ gameId: "g-1", claimId: "c-1" }),
      IdempotencyKeys.game2Lucky({ gameId: "g-1", claimId: "c-1" }),
      IdempotencyKeys.game3Pattern({ gameId: "g-1", claimId: "c-1" }),
      IdempotencyKeys.game3Lucky({ gameId: "g-1", claimId: "c-1" }),
      IdempotencyKeys.adhocBuyIn({ gameId: "g-1", playerId: "p-1" }),
      IdempotencyKeys.adhocPhase({
        patternId: "pat-1",
        gameId: "g-1",
        playerId: "p-1",
      }),
      IdempotencyKeys.adhocLinePrize({ gameId: "g-1", claimId: "c-1" }),
      IdempotencyKeys.adhocBingoPrize({ gameId: "g-1", claimId: "c-1" }),
      IdempotencyKeys.adhocJackpot({ gameId: "g-1", playedSpins: 1 }),
      IdempotencyKeys.adhocMiniGame({ gameId: "g-1", miniGameType: "wheel" }),
      IdempotencyKeys.adhocExtraPrize({ extraPrizeId: "xp-1" }),
      IdempotencyKeys.adhocRefund({ gameId: "g-1", playerId: "p-1" }),
      IdempotencyKeys.adhocTicketReplace({
        roomCode: "ABC",
        playerId: "p-1",
        ticketId: "t-1",
      }),
      IdempotencyKeys.paymentRequest({ kind: "deposit", requestId: "r-1" }),
      IdempotencyKeys.agentTxWallet({ txId: "tx-1" }),
      IdempotencyKeys.agentTxCancel({ originalTxId: "tx-1" }),
      IdempotencyKeys.agentPhysicalSell({ ticketUniqueId: "TIX-1" }),
      IdempotencyKeys.agentDigitalTicket({
        gameId: "g-1",
        playerUserId: "u-1",
        clientRequestId: "cr-1",
      }),
      IdempotencyKeys.agentProductSale({ cartId: "cart-1" }),
      IdempotencyKeys.machineRefund({ uniqueTransaction: "okbingo:c:1:cr" }),
      IdempotencyKeys.machineCredit({ uniqueTransaction: "metronia:c:1:cr" }),
    ];
    for (const key of samples) {
      assert.match(
        key,
        IDEMPOTENCY_KEY_FORMAT,
        `key ${key} matcher ikke IDEMPOTENCY_KEY_FORMAT`
      );
    }
  });
});

describe("IdempotencyKeys — determinisme + kollisjons-forhindring", () => {
  test("samme input gir samme key (determinisme)", () => {
    const a = IdempotencyKeys.game1Phase({
      scheduledGameId: "sg-1",
      phase: 3,
      assignmentId: "assign-42",
    });
    const b = IdempotencyKeys.game1Phase({
      scheduledGameId: "sg-1",
      phase: 3,
      assignmentId: "assign-42",
    });
    assert.equal(a, b);
  });

  test("forskjellige key-typer med overlappende input gir forskjellige keys", () => {
    // Sanity-check: game1Phase vs game1Jackpot med sammenlignbar input —
    // prefix-skillet skal aldri kollidere selv hvis argumenter overlapper.
    const phaseKey = IdempotencyKeys.game1Phase({
      scheduledGameId: "sg-1",
      phase: 3,
      assignmentId: "a-1",
    });
    const jackpotKey = IdempotencyKeys.game1Jackpot({
      hallId: "sg-1",
      scheduledGameId: "a-1",
    });
    assert.notEqual(phaseKey, jackpotKey);
  });

  test("forskjellige input gir forskjellige keys (kollisjons-forhindring)", () => {
    const k1 = IdempotencyKeys.adhocBuyIn({ gameId: "g-1", playerId: "p-1" });
    const k2 = IdempotencyKeys.adhocBuyIn({ gameId: "g-1", playerId: "p-2" });
    const k3 = IdempotencyKeys.adhocBuyIn({ gameId: "g-2", playerId: "p-1" });
    assert.notEqual(k1, k2);
    assert.notEqual(k1, k3);
    assert.notEqual(k2, k3);
  });

  test("pot + phase med like IDer gir forskjellige keys (prefix-skille)", () => {
    const potKey = IdempotencyKeys.game1Pot({
      potId: "X",
      scheduledGameId: "Y",
    });
    const jackpotKey = IdempotencyKeys.game1Jackpot({
      hallId: "X",
      scheduledGameId: "Y",
    });
    assert.notEqual(potKey, jackpotKey);
  });
});
