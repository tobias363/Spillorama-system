import { BingoEngine } from "../game/BingoEngine.js";
import type { GameState, Ticket } from "../game/types.js";
import { InMemoryWalletAdapter } from "../adapters/InMemoryWalletAdapter.js";
import { LocalBingoSystemAdapter } from "../adapters/LocalBingoSystemAdapter.js";
import {
  CANDY_PATTERN_FAMILIES,
  findNearMissCandyPatternFamilies,
} from "../game/candyPatterns.js";

interface SimulationOptions {
  rounds: number;
  payoutPercent: number;
  entryFee: number;
  ticketsPerPlayer: number;
  nearMissBiasEnabled: boolean;
  nearMissTargetRate: number;
  nearMissCalibrationFactor: number;
}

interface RoundResult {
  payout: number;
  hostPayout: number;
  patternClaimCount: number;
  hostCandyPatternsCompleted: number;
  hostRoundsWithMultipleCandyPatterns: boolean;
  hostHadMultiPatternTicket: boolean;
  hostMaxCandyPatternsOnSingleTicket: number;
  hostHadAnyCandyOneToGoMoment: boolean;
  hostEndedWithAnyCandyOneToGo: boolean;
  hostTicketOneToGoMoments: number;
  hostTicketsWithAnyOneToGo: number;
  hostTicketsEndingWithOneToGo: number;
  hostOneToGoConvertedToAnyPattern: boolean;
}

const LARGE_HOST_PAYOUT_TIERS = Object.freeze([400, 800, 1200, 2000, 3200, 4800]);

function parseArgs(argv: string[]): SimulationOptions {
  const options: SimulationOptions = {
    rounds: 200,
    payoutPercent: 75,
    entryFee: 100,
    ticketsPerPlayer: 4,
    nearMissBiasEnabled: true,
    nearMissTargetRate: 0.38,
    nearMissCalibrationFactor: 0.92,
  };

  for (const arg of argv) {
    if (arg === "--no-near-miss-bias") {
      options.nearMissBiasEnabled = false;
      continue;
    }
    if (!arg.startsWith("--")) {
      continue;
    }
    const [rawKey, rawValue] = arg.slice(2).split("=");
    const key = rawKey.trim();
    const value = (rawValue ?? "").trim();
    if (!value) {
      continue;
    }

    if (key === "rounds") {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) {
        options.rounds = Math.floor(parsed);
      }
      continue;
    }
    if (key === "payoutPercent") {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) {
        options.payoutPercent = Math.round(parsed * 100) / 100;
      }
      continue;
    }
    if (key === "entryFee") {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed >= 0) {
        options.entryFee = Math.round(parsed);
      }
      continue;
    }
    if (key === "ticketsPerPlayer") {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed >= 1) {
        options.ticketsPerPlayer = Math.max(1, Math.floor(parsed));
      }
      continue;
    }
    if (key === "nearMissTargetRate") {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 0.95) {
        options.nearMissTargetRate = parsed;
      }
      continue;
    }
    if (key === "nearMissCalibrationFactor") {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
        options.nearMissCalibrationFactor = parsed;
      }
      continue;
    }
  }

  return options;
}

function asInternalGame(engine: BingoEngine, roomCode: string): GameState {
  const internalEngine = engine as unknown as {
    rooms: Map<string, { currentGame?: GameState }>;
  };
  const game = internalEngine.rooms.get(roomCode)?.currentGame;
  if (!game) {
    throw new Error(`Missing current game for room ${roomCode}`);
  }
  return game;
}

function flattenTicket(ticket: Ticket): number[] {
  return ticket.grid.flat().map((value) => Math.max(0, Math.trunc(value)));
}

function countCompletedCandyPatterns(ticket: Ticket, drawnSet: ReadonlySet<number>): number {
  const flat = flattenTicket(ticket);
  let count = 0;
  for (const family of CANDY_PATTERN_FAMILIES) {
    const complete = family.variants.some((definition) =>
      definition.mask.every(
        (required, index) => required !== 1 || drawnSet.has(flat[index] ?? -1),
      )
    );
    if (complete) {
      count += 1;
    }
  }
  return count;
}

async function simulateRound(options: SimulationOptions): Promise<RoundResult> {
  const wallet = new InMemoryWalletAdapter();
  const adapter = new LocalBingoSystemAdapter();
  const engine = new BingoEngine(adapter, wallet, {
    maxBallNumber: 60,
    maxDrawsPerRound: 30,
    nearMissBiasEnabled: options.nearMissBiasEnabled,
    nearMissTargetRate: options.nearMissTargetRate,
    nearMissCalibrationFactor: options.nearMissCalibrationFactor,
  });

  const { roomCode, playerId: hostPlayerId } = await engine.createRoom({
    hallId: "hall-pattern-gap",
    playerName: "Host",
    walletId: "wallet-host",
  });
  await engine.joinRoom({
    roomCode,
    hallId: "hall-pattern-gap",
    playerName: "Guest",
    walletId: "wallet-guest",
  });
  await wallet.topUp("wallet-host", 1_000_000, "pattern-gap-seed");
  await wallet.topUp("wallet-guest", 1_000_000, "pattern-gap-seed");
  await wallet.topUp(
    "house-hall-pattern-gap-databingo-internet",
    1_000_000,
    "pattern-gap-house-seed",
  );

  await engine.startGame({
    roomCode,
    actorPlayerId: hostPlayerId,
    entryFee: options.entryFee,
    ticketsPerPlayer: options.ticketsPerPlayer,
    payoutPercent: options.payoutPercent,
  });

  const hostTicketsEverOneToGo = new Set<number>();
  let hostHadAnyCandyOneToGoMoment = false;
  let hostTicketOneToGoMoments = 0;

  for (let safety = 0; safety < 40; safety += 1) {
    const snapshot = engine.getRoomSnapshot(roomCode);
    if (snapshot.currentGame?.status !== "RUNNING") {
      break;
    }
    try {
      await engine.drawNextNumber({
        roomCode,
        actorPlayerId: hostPlayerId,
        autoSettleClaims: true,
      });
    } catch {
      break;
    }

    const currentGame = asInternalGame(engine, roomCode);
    const drawnSet = new Set<number>(currentGame.drawnNumbers);
    const hostTickets = currentGame.tickets.get(hostPlayerId) ?? [];
    const settledTopperSlots = currentGame.settledPatternTopperSlots.get(hostPlayerId) ?? [];

    for (let ticketIndex = 0; ticketIndex < hostTickets.length; ticketIndex += 1) {
      const nearMisses = findNearMissCandyPatternFamilies(
        hostTickets[ticketIndex],
        drawnSet,
        settledTopperSlots[ticketIndex] ?? new Set<number>(),
      );
      if (nearMisses.length === 0) {
        continue;
      }

      hostHadAnyCandyOneToGoMoment = true;
      hostTicketOneToGoMoments += 1;
      hostTicketsEverOneToGo.add(ticketIndex);
    }
  }

  const snapshot = engine.getRoomSnapshot(roomCode);
  const game = asInternalGame(engine, roomCode);
  const claims = snapshot.currentGame?.claims ?? [];
  const payout = claims.reduce((sum, claim) => sum + Math.max(0, claim.payoutAmount ?? 0), 0);
  const hostPayout = claims
    .filter((claim) => claim.playerId === hostPlayerId)
    .reduce((sum, claim) => sum + Math.max(0, claim.payoutAmount ?? 0), 0);
  const patternClaims = claims.filter(
    (claim) => claim.valid && claim.type === "PATTERN",
  );
  const drawnSet = new Set<number>(game.drawnNumbers);
  const hostTickets = game.tickets.get(hostPlayerId) ?? [];
  const settledTopperSlots = game.settledPatternTopperSlots.get(hostPlayerId) ?? [];
  const hostCompletedPatternCounts = hostTickets.map((ticket) =>
    countCompletedCandyPatterns(ticket, drawnSet),
  );
  const hostCandyPatternsCompleted = hostCompletedPatternCounts.reduce(
    (sum, count) => sum + count,
    0,
  );
  const hostMaxCandyPatternsOnSingleTicket = hostCompletedPatternCounts.reduce(
    (max, count) => Math.max(max, count),
    0,
  );
  let hostTicketsEndingWithOneToGo = 0;
  for (let ticketIndex = 0; ticketIndex < hostTickets.length; ticketIndex += 1) {
    const nearMisses = findNearMissCandyPatternFamilies(
      hostTickets[ticketIndex],
      drawnSet,
      settledTopperSlots[ticketIndex] ?? new Set<number>(),
    );
    if (nearMisses.length > 0) {
      hostTicketsEndingWithOneToGo += 1;
    }
  }

  return {
    payout,
    hostPayout,
    patternClaimCount: patternClaims.length,
    hostCandyPatternsCompleted,
    hostRoundsWithMultipleCandyPatterns: hostCandyPatternsCompleted > 1,
    hostHadMultiPatternTicket: hostMaxCandyPatternsOnSingleTicket > 1,
    hostMaxCandyPatternsOnSingleTicket,
    hostHadAnyCandyOneToGoMoment,
    hostEndedWithAnyCandyOneToGo: hostTicketsEndingWithOneToGo > 0,
    hostTicketOneToGoMoments,
    hostTicketsWithAnyOneToGo: hostTicketsEverOneToGo.size,
    hostTicketsEndingWithOneToGo,
    hostOneToGoConvertedToAnyPattern:
      hostHadAnyCandyOneToGoMoment && hostCandyPatternsCompleted > 0,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  let roundsWithAnyBackendPayout = 0;
  let roundsWithPatternClaim = 0;
  let totalPatternClaims = 0;
  let totalBackendPayout = 0;
  let hostRoundsWithPayout = 0;
  let hostTotalPayout = 0;
  let hostMaxPayout = 0;
  let hostRoundsWithAnyCandyPattern = 0;
  let hostRoundsWithZeroCandyPatterns = 0;
  let hostRoundsWithMultipleCandyPatterns = 0;
  let hostRoundsWithMultiPatternTicket = 0;
  let hostTotalCandyPatternsCompleted = 0;
  let hostTotalMaxPatternsOnSingleTicket = 0;
  let hostRoundsWithAnyOneToGoMoment = 0;
  let hostRoundsEndingWithAnyOneToGo = 0;
  let hostTicketOneToGoMoments = 0;
  let hostTicketsWithAnyOneToGo = 0;
  let hostTicketsEndingWithOneToGo = 0;
  let hostRoundsWhereOneToGoConverted = 0;
  const hostRoundsAtLeastByPayout = Object.fromEntries(
    LARGE_HOST_PAYOUT_TIERS.map((tier) => [`ge_${tier}`, 0]),
  ) as Record<string, number>;

  for (let round = 0; round < options.rounds; round += 1) {
    const result = await simulateRound(options);
    if (result.payout > 0) {
      roundsWithAnyBackendPayout += 1;
    }
    if (result.hostPayout > 0) {
      hostRoundsWithPayout += 1;
    }
    hostMaxPayout = Math.max(hostMaxPayout, result.hostPayout);
    for (const tier of LARGE_HOST_PAYOUT_TIERS) {
      if (result.hostPayout >= tier) {
        hostRoundsAtLeastByPayout[`ge_${tier}`] += 1;
      }
    }
    if (result.patternClaimCount > 0) {
      roundsWithPatternClaim += 1;
    }
    if (result.hostCandyPatternsCompleted > 0) {
      hostRoundsWithAnyCandyPattern += 1;
    }
    if (result.hostCandyPatternsCompleted === 0) {
      hostRoundsWithZeroCandyPatterns += 1;
    }
    if (result.hostRoundsWithMultipleCandyPatterns) {
      hostRoundsWithMultipleCandyPatterns += 1;
    }
    if (result.hostHadMultiPatternTicket) {
      hostRoundsWithMultiPatternTicket += 1;
    }
    if (result.hostHadAnyCandyOneToGoMoment) {
      hostRoundsWithAnyOneToGoMoment += 1;
    }
    if (result.hostEndedWithAnyCandyOneToGo) {
      hostRoundsEndingWithAnyOneToGo += 1;
    }
    if (result.hostOneToGoConvertedToAnyPattern) {
      hostRoundsWhereOneToGoConverted += 1;
    }

    totalBackendPayout += result.payout;
    totalPatternClaims += result.patternClaimCount;
    hostTotalPayout += result.hostPayout;
    hostTotalCandyPatternsCompleted += result.hostCandyPatternsCompleted;
    hostTotalMaxPatternsOnSingleTicket += result.hostMaxCandyPatternsOnSingleTicket;
    hostTicketOneToGoMoments += result.hostTicketOneToGoMoments;
    hostTicketsWithAnyOneToGo += result.hostTicketsWithAnyOneToGo;
    hostTicketsEndingWithOneToGo += result.hostTicketsEndingWithOneToGo;
  }

  const overallStake = options.rounds * options.entryFee * 2;
  const hostStake = options.rounds * options.entryFee;
  const totalHostTickets = options.rounds * options.ticketsPerPlayer;

  console.log(
    JSON.stringify(
      {
        options,
        backend: {
          roundsWithAnyBackendPayout,
          roundsWithPatternClaim,
          totalPatternClaims,
          averagePatternClaimsPerRound:
            options.rounds > 0 ? totalPatternClaims / options.rounds : 0,
          totalBackendPayout,
          overallRtp: overallStake > 0 ? (totalBackendPayout / overallStake) * 100 : 0,
          hostRoundsWithPayout,
          hostTotalPayout,
          hostRtp: hostStake > 0 ? (hostTotalPayout / hostStake) * 100 : 0,
          hostMaxPayout,
          hostRoundsAtLeastByPayout,
        },
        hostCandyPatterns: {
          roundsWithAnyCandyPattern: hostRoundsWithAnyCandyPattern,
          roundsWithZeroCandyPatterns: hostRoundsWithZeroCandyPatterns,
          roundsWithMultipleCandyPatterns: hostRoundsWithMultipleCandyPatterns,
          roundMultiPatternRate:
            options.rounds > 0 ? (hostRoundsWithMultipleCandyPatterns / options.rounds) * 100 : 0,
          roundsWithMultiPatternTicket: hostRoundsWithMultiPatternTicket,
          roundMultiPatternTicketRate:
            options.rounds > 0 ? (hostRoundsWithMultiPatternTicket / options.rounds) * 100 : 0,
          totalCandyPatternsCompleted: hostTotalCandyPatternsCompleted,
          averagePatternsPerRound:
            options.rounds > 0 ? hostTotalCandyPatternsCompleted / options.rounds : 0,
          averagePatternsPerWinningRound:
            hostRoundsWithAnyCandyPattern > 0
              ? hostTotalCandyPatternsCompleted / hostRoundsWithAnyCandyPattern
              : 0,
          averageMaxPatternsOnSingleTicketPerRound:
            options.rounds > 0 ? hostTotalMaxPatternsOnSingleTicket / options.rounds : 0,
        },
        hostCandyOneToGo: {
          roundsWithAnyOneToGoMoment: hostRoundsWithAnyOneToGoMoment,
          roundOneToGoMomentRate:
            options.rounds > 0 ? (hostRoundsWithAnyOneToGoMoment / options.rounds) * 100 : 0,
          roundsWhereOneToGoConverted: hostRoundsWhereOneToGoConverted,
          oneToGoConversionRate:
            hostRoundsWithAnyOneToGoMoment > 0
              ? (hostRoundsWhereOneToGoConverted / hostRoundsWithAnyOneToGoMoment) * 100
              : 0,
          roundsEndingWithAnyOneToGo: hostRoundsEndingWithAnyOneToGo,
          roundEndingOneToGoRate:
            options.rounds > 0 ? (hostRoundsEndingWithAnyOneToGo / options.rounds) * 100 : 0,
          totalTicketOneToGoMoments: hostTicketOneToGoMoments,
          averageTicketOneToGoMomentsPerRound:
            options.rounds > 0 ? hostTicketOneToGoMoments / options.rounds : 0,
          ticketsWithAnyOneToGo: hostTicketsWithAnyOneToGo,
          ticketAnyOneToGoRate:
            totalHostTickets > 0 ? (hostTicketsWithAnyOneToGo / totalHostTickets) * 100 : 0,
          ticketsEndingWithOneToGo: hostTicketsEndingWithOneToGo,
          ticketEndingOneToGoRate:
            totalHostTickets > 0 ? (hostTicketsEndingWithOneToGo / totalHostTickets) * 100 : 0,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
