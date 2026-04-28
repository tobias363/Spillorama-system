/**
 * Unified pipeline refactor — Fase 1a tests for PayoutService.
 *
 * Verifiserer atomicity, idempotency, multi-winner-split, multi-hall-binding
 * og soft-fail-policy. Bruker InMemory-portene fra Fase 0 — samme baseline
 * som invariant-testene.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  DefaultIdempotencyKeyPort,
  InMemoryAuditPort,
  InMemoryCompliancePort,
  InMemoryWalletPort,
} from "../ports/index.js";
import { WalletError } from "../adapters/WalletAdapter.js";
import {
  PayoutService,
  PayoutWalletCreditError,
  splitPrize,
} from "./PayoutService.js";

function makeService() {
  const wallet = new InMemoryWalletPort();
  const compliance = new InMemoryCompliancePort();
  const audit = new InMemoryAuditPort();
  const keys = new DefaultIdempotencyKeyPort();
  const service = new PayoutService({ wallet, compliance, audit, keys });
  return { wallet, compliance, audit, keys, service };
}

test("PayoutService: enkelt-vinner får hele potten + ledger PRIZE + audit", async () => {
  const { wallet, compliance, audit, service } = makeService();
  wallet.seed("wallet-1", 0);

  const result = await service.payoutPhase({
    gameId: "game-1",
    phaseId: "phase-1",
    phaseName: "1 Rad",
    winners: [
      { walletId: "wallet-1", playerId: "player-1", hallId: "hall-1", claimId: "claim-1" },
    ],
    totalPrizeCents: 10_000,
    actorHallId: "hall-1",
    isFixedPrize: true,
    gameType: "MAIN_GAME",
    channel: "INTERNET",
  });

  // Wallet kreditert 100 kr til winnings-side.
  const balance = await wallet.getBalance("wallet-1");
  assert.equal(balance.winnings, 100);
  assert.equal(balance.deposit, 0);

  // Result reflekterer beløp.
  assert.equal(result.totalWinners, 1);
  assert.equal(result.prizePerWinnerCents, 10_000);
  assert.equal(result.houseRetainedCents, 0);
  assert.equal(result.winnerRecords.length, 1);
  assert.equal(result.winnerRecords[0]!.prizeCents, 10_000);
  assert.equal(result.winnerRecords[0]!.extraPrizeCents, 0);
  assert.notEqual(result.winnerRecords[0]!.walletTxId, null);

  // Compliance har én PRIZE-event (ingen HOUSE_RETAINED siden ingen rest).
  const events = compliance.getAllEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0]!.event.eventType, "PRIZE");
  assert.equal(events[0]!.event.amount, 100);
  assert.equal(events[0]!.event.hallId, "hall-1");
  assert.equal(events[0]!.event.gameType, "MAIN_GAME");

  // Audit har én summary-event.
  assert.equal(audit.count(), 1);
  const auditEvents = audit.findByAction("game.payout.phase");
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0]!.resourceId, "game-1");
});

test("PayoutService: multi-winner split → hver får floor + HOUSE_RETAINED for rest", async () => {
  const { wallet, compliance, service } = makeService();
  wallet.seed("wallet-A", 0);
  wallet.seed("wallet-B", 0);
  wallet.seed("wallet-C", 0);

  // 1700 kr / 3 vinnere = 566.66... → 566 kr hver, rest 2 øre til hus.
  const result = await service.payoutPhase({
    gameId: "game-multi",
    phaseId: "phase-1",
    phaseName: "Fullt Hus",
    winners: [
      { walletId: "wallet-A", playerId: "player-A", hallId: "hall-1", claimId: "claim-A" },
      { walletId: "wallet-B", playerId: "player-B", hallId: "hall-2", claimId: "claim-B" },
      { walletId: "wallet-C", playerId: "player-C", hallId: "hall-3", claimId: "claim-C" },
    ],
    totalPrizeCents: 170_000,
    actorHallId: "hall-1",
    isFixedPrize: true,
    gameType: "MAIN_GAME",
    channel: "INTERNET",
  });

  assert.equal(result.prizePerWinnerCents, 56_666);
  assert.equal(result.houseRetainedCents, 2);

  // Hver vinner kreditert sin andel.
  const balA = await wallet.getBalance("wallet-A");
  const balB = await wallet.getBalance("wallet-B");
  const balC = await wallet.getBalance("wallet-C");
  assert.equal(balA.winnings, 566.66);
  assert.equal(balB.winnings, 566.66);
  assert.equal(balC.winnings, 566.66);

  // Sum av winnings + houseRetained = totalPrize EKSAKT.
  const sumWinnings = (balA.winnings + balB.winnings + balC.winnings) * 100;
  const totalCents = sumWinnings + result.houseRetainedCents;
  assert.equal(Math.round(totalCents), 170_000);

  // Compliance har 3 PRIZE-events (én per vinner) + 1 HOUSE_RETAINED.
  const events = compliance.getAllEvents();
  assert.equal(events.length, 4);

  const prizeEvents = events.filter((e) => e.event.eventType === "PRIZE");
  assert.equal(prizeEvents.length, 3);

  // Hver PRIZE-event bindes til VINNERENS hall (per-hall §71).
  const prizeHalls = prizeEvents.map((e) => e.event.hallId).sort();
  assert.deepEqual(prizeHalls, ["hall-1", "hall-2", "hall-3"]);

  const houseRetained = events.find((e) => e.event.eventType === "HOUSE_RETAINED");
  assert.notEqual(houseRetained, undefined);
  assert.equal(houseRetained!.event.amount, 0.02); // 2 øre = 0.02 kr
  assert.equal(houseRetained!.event.hallId, "hall-1"); // bindes til winners[0].hallId
  assert.deepEqual(
    (houseRetained!.event.metadata?.winnerHallIds as string[]).sort(),
    ["hall-1", "hall-2", "hall-3"],
  );
});

test("PayoutService: extraPrizeCents → EXTRA_PRIZE-event + samme wallet-tx", async () => {
  const { wallet, compliance, service } = makeService();
  wallet.seed("wallet-1", 0);

  await service.payoutPhase({
    gameId: "game-jp",
    phaseId: "phase-fullt-hus",
    phaseName: "Fullt Hus",
    winners: [
      {
        walletId: "wallet-1",
        playerId: "player-1",
        hallId: "hall-1",
        claimId: "claim-jp-1",
        extraPrizeCents: 100_000, // 1000 kr jackpot
      },
    ],
    totalPrizeCents: 100_000, // 1000 kr base prize
    actorHallId: "hall-1",
    isFixedPrize: true,
    gameType: "MAIN_GAME",
    channel: "INTERNET",
  });

  // Wallet kreditert sum: 1000 + 1000 = 2000 kr.
  const balance = await wallet.getBalance("wallet-1");
  assert.equal(balance.winnings, 2000);

  // Compliance har 2 events: PRIZE (1000) + EXTRA_PRIZE (1000).
  const events = compliance.getAllEvents();
  assert.equal(events.length, 2);
  const prize = events.find((e) => e.event.eventType === "PRIZE");
  const extra = events.find((e) => e.event.eventType === "EXTRA_PRIZE");
  assert.notEqual(prize, undefined);
  assert.notEqual(extra, undefined);
  assert.equal(prize!.event.amount, 1000);
  assert.equal(extra!.event.amount, 1000);
});

test("PayoutService: idempotent re-kall — re-run skriver ikke duplikater", async () => {
  const { wallet, compliance, audit, service } = makeService();
  wallet.seed("wallet-1", 0);

  const input = {
    gameId: "game-retry",
    phaseId: "phase-1",
    phaseName: "1 Rad",
    winners: [
      { walletId: "wallet-1", playerId: "player-1", hallId: "hall-1", claimId: "claim-retry" },
    ],
    totalPrizeCents: 10_000,
    actorHallId: "hall-1",
    isFixedPrize: true,
    gameType: "MAIN_GAME" as const,
    channel: "INTERNET" as const,
  };

  // Kjør 5 ganger.
  for (let i = 0; i < 5; i++) {
    await service.payoutPhase(input);
  }

  // Wallet: kun én credit (idempotent på key).
  const balance = await wallet.getBalance("wallet-1");
  assert.equal(balance.winnings, 100);

  // Compliance: kun én PRIZE-event.
  assert.equal(compliance.count(), 1);

  // Audit: 5 events (fire-and-forget — ikke idempotent).
  assert.equal(audit.count(), 5);
});

test("PayoutService: wallet-feil → PayoutWalletCreditError + ingen compliance/audit", async () => {
  const { wallet, compliance, audit, service } = makeService();
  // Mock wallet til å feile.
  const originalCredit = wallet.credit.bind(wallet);
  wallet.credit = async () => {
    throw new WalletError("INVALID_INPUT", "simulert wallet-feil");
  };

  await assert.rejects(
    () =>
      service.payoutPhase({
        gameId: "game-fail",
        phaseId: "phase-1",
        phaseName: "1 Rad",
        winners: [
          { walletId: "wallet-1", playerId: "player-1", hallId: "hall-1", claimId: "claim-fail" },
        ],
        totalPrizeCents: 10_000,
        actorHallId: "hall-1",
        isFixedPrize: true,
        gameType: "MAIN_GAME",
        channel: "INTERNET",
      }),
    (err: unknown) =>
      err instanceof PayoutWalletCreditError &&
      err.walletId === "wallet-1" &&
      err.claimId === "claim-fail",
  );

  // Compliance og audit ikke skrevet (vi feilet før step 2).
  assert.equal(compliance.count(), 0);
  assert.equal(audit.count(), 0);

  // Restore.
  wallet.credit = originalCredit;
});

test("PayoutService: 1 vinner, totalPrize=0 → ingen wallet-credit, ingen PRIZE-event, audit logges fortsatt", async () => {
  const { wallet, compliance, audit, service } = makeService();
  wallet.seed("wallet-1", 0);

  await service.payoutPhase({
    gameId: "game-zero",
    phaseId: "phase-zero",
    phaseName: "Zero phase",
    winners: [
      { walletId: "wallet-1", playerId: "player-1", hallId: "hall-1", claimId: "claim-zero" },
    ],
    totalPrizeCents: 0,
    actorHallId: "hall-1",
    isFixedPrize: false,
    gameType: "MAIN_GAME",
    channel: "INTERNET",
  });

  const balance = await wallet.getBalance("wallet-1");
  assert.equal(balance.winnings, 0);
  assert.equal(compliance.count(), 0); // Ingen PRIZE/EXTRA/HOUSE_RETAINED
  assert.equal(audit.count(), 1); // Audit-summary skrives uansett
});

test("PayoutService: validation — kaster ved tom winners-array", async () => {
  const { service } = makeService();
  await assert.rejects(
    () =>
      service.payoutPhase({
        gameId: "g",
        phaseId: "p",
        phaseName: "n",
        winners: [],
        totalPrizeCents: 10_000,
        actorHallId: "h",
        isFixedPrize: true,
        gameType: "MAIN_GAME",
        channel: "INTERNET",
      }),
    /winners.*ikke-tom/,
  );
});

test("PayoutService: validation — kaster ved manglende hallId på vinner", async () => {
  const { service } = makeService();
  await assert.rejects(
    () =>
      service.payoutPhase({
        gameId: "g",
        phaseId: "p",
        phaseName: "n",
        winners: [
          { walletId: "w", playerId: "p", hallId: "", claimId: "c" },
        ],
        totalPrizeCents: 10_000,
        actorHallId: "h",
        isFixedPrize: true,
        gameType: "MAIN_GAME",
        channel: "INTERNET",
      }),
    /hallId.*påkrevd/,
  );
});

test("PayoutService: HALL-channel + DATABINGO-gameType mappes korrekt til ledger", async () => {
  const { wallet, compliance, service } = makeService();
  wallet.seed("wallet-spinngo", 0);

  await service.payoutPhase({
    gameId: "spinngo-1",
    phaseId: "phase-1",
    phaseName: "Jackpot 1",
    winners: [
      { walletId: "wallet-spinngo", playerId: "p", hallId: "h", claimId: "c" },
    ],
    totalPrizeCents: 50_000,
    actorHallId: "h",
    isFixedPrize: true,
    gameType: "DATABINGO",
    channel: "HALL",
  });

  const event = compliance.getAllEvents()[0]!;
  assert.equal(event.event.gameType, "DATABINGO");
  assert.equal(event.event.channel, "HALL");
});

test("splitPrize pure-funksjon: properties holder", () => {
  // Eksakt deling.
  assert.deepEqual(splitPrize(10_000, 2), { perWinnerCents: 5_000, houseRetainedCents: 0 });
  // Med rest.
  assert.deepEqual(splitPrize(170_000, 3), { perWinnerCents: 56_666, houseRetainedCents: 2 });
  // 1 vinner = hele potten.
  assert.deepEqual(splitPrize(99_999, 1), { perWinnerCents: 99_999, houseRetainedCents: 0 });
  // Validation.
  assert.throws(() => splitPrize(-1, 1), /ikke-negativt/);
  assert.throws(() => splitPrize(100, 0), /≥ 1/);
  assert.throws(() => splitPrize(1.5, 1), /heltall/);
});

test("PayoutService: per-vinner idempotency — distinkte claimIds → distinkte keys", async () => {
  const { wallet, compliance, service } = makeService();
  wallet.seed("wallet-A", 0);
  wallet.seed("wallet-B", 0);

  // Først runde: 2 vinnere på samme phase.
  await service.payoutPhase({
    gameId: "game-1",
    phaseId: "phase-1",
    phaseName: "1 Rad",
    winners: [
      { walletId: "wallet-A", playerId: "p-A", hallId: "h", claimId: "claim-A" },
      { walletId: "wallet-B", playerId: "p-B", hallId: "h", claimId: "claim-B" },
    ],
    totalPrizeCents: 20_000,
    actorHallId: "h",
    isFixedPrize: true,
    gameType: "MAIN_GAME",
    channel: "INTERNET",
  });

  assert.equal((await wallet.getBalance("wallet-A")).winnings, 100);
  assert.equal((await wallet.getBalance("wallet-B")).winnings, 100);
  assert.equal(compliance.count(), 2);

  // Re-kjør samme input — ingen ekstra writes.
  await service.payoutPhase({
    gameId: "game-1",
    phaseId: "phase-1",
    phaseName: "1 Rad",
    winners: [
      { walletId: "wallet-A", playerId: "p-A", hallId: "h", claimId: "claim-A" },
      { walletId: "wallet-B", playerId: "p-B", hallId: "h", claimId: "claim-B" },
    ],
    totalPrizeCents: 20_000,
    actorHallId: "h",
    isFixedPrize: true,
    gameType: "MAIN_GAME",
    channel: "INTERNET",
  });

  assert.equal((await wallet.getBalance("wallet-A")).winnings, 100);
  assert.equal((await wallet.getBalance("wallet-B")).winnings, 100);
  assert.equal(compliance.count(), 2);
});

test("PayoutService: actorHallId loggges i metadata, men PRIZE-binding er per winner.hallId", async () => {
  const { wallet, compliance, service } = makeService();
  wallet.seed("wallet-1", 0);

  // Master-hall = hall-A, men vinner kjøpte i hall-B.
  await service.payoutPhase({
    gameId: "multi-hall-1",
    phaseId: "phase-1",
    phaseName: "1 Rad",
    winners: [
      { walletId: "wallet-1", playerId: "p", hallId: "hall-B", claimId: "c" },
    ],
    totalPrizeCents: 10_000,
    actorHallId: "hall-A", // master
    isFixedPrize: true,
    gameType: "MAIN_GAME",
    channel: "INTERNET",
  });

  const event = compliance.getAllEvents()[0]!.event;
  assert.equal(event.hallId, "hall-B", "PRIZE-bindes til vinnerens hall (§71)");
  assert.equal(
    event.metadata?.actorHallId,
    "hall-A",
    "Master-hall lagres i metadata for sporbarhet",
  );
});
