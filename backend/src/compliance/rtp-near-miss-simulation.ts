import { DomainError, BingoEngine } from "../game/BingoEngine.js";
import { findFirstCompleteLinePatternIndex, hasFullBingo } from "../game/ticket.js";
import type { GameState, Ticket } from "../game/types.js";
import { InMemoryWalletAdapter } from "../adapters/InMemoryWalletAdapter.js";
import { LocalBingoSystemAdapter } from "../adapters/LocalBingoSystemAdapter.js";

interface SimulationOptions {
  rounds: number;
  targets: number[];
  hallId: string;
  entryFee: number;
  ticketsPerPlayer: number;
  forceHostWin: boolean;
  windowSize: number;
  outputJson: boolean;
}

interface SimulationResult {
  targetRtpPercent: number;
  rounds: number;
  payoutPercentActualAvg: number;
  payoutPercentTargetAvg: number;
  nearMissRateAvg: number;
  rtpDeviation: number;
  rtpPass: boolean;
  nearMissPass: boolean;
}

function parseArgs(argv: string[]): SimulationOptions {
  const options: SimulationOptions = {
    rounds: 10_000,
    targets: [60, 75, 90],
    hallId: "hall-rtp-sim",
    entryFee: 100,
    ticketsPerPlayer: 4,
    forceHostWin: true,
    windowSize: 10_000,
    outputJson: false
  };

  for (const arg of argv) {
    if (arg === "--json") {
      options.outputJson = true;
      continue;
    }
    if (arg === "--no-force-host-win") {
      options.forceHostWin = false;
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
    if (key === "targets") {
      const parsedTargets = value
        .split(",")
        .map((entry) => Number(entry.trim()))
        .filter((entry) => Number.isFinite(entry) && entry >= 0 && entry <= 100);
      if (parsedTargets.length > 0) {
        options.targets = parsedTargets;
      }
      continue;
    }
    if (key === "hallId") {
      options.hallId = value;
      continue;
    }
    if (key === "entryFee") {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed >= 0) {
        options.entryFee = parsed;
      }
      continue;
    }
    if (key === "ticketsPerPlayer") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        options.ticketsPerPlayer = Math.max(1, Math.min(5, Math.floor(parsed)));
      }
      continue;
    }
    if (key === "windowSize") {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) {
        options.windowSize = Math.floor(parsed);
      }
    }
  }

  options.windowSize = Math.max(1, options.windowSize);
  options.rounds = Math.max(1, options.rounds);
  return options;
}

function asInternalGame(engine: BingoEngine, roomCode: string): GameState | undefined {
  const internal = engine as unknown as {
    rooms: Map<string, { currentGame?: GameState }>;
  };
  return internal.rooms.get(roomCode)?.currentGame;
}

function trimSimulationGameHistory(engine: BingoEngine, roomCode: string): void {
  const internal = engine as unknown as {
    rooms: Map<string, { gameHistory?: unknown[] }>;
  };
  const room = internal.rooms.get(roomCode);
  if (!room || !Array.isArray(room.gameHistory)) {
    return;
  }
  if (room.gameHistory.length > 4) {
    room.gameHistory = room.gameHistory.slice(-2);
  }
}

function prioritizeHostTicketNumbers(engine: BingoEngine, roomCode: string, hostPlayerId: string): void {
  const game = asInternalGame(engine, roomCode);
  if (!game) {
    return;
  }
  const hostTicket = game.tickets.get(hostPlayerId)?.[0];
  if (!hostTicket) {
    return;
  }
  const preferredNumbers = hostTicket.grid.flat().filter((value) => value > 0);
  const prioritized = preferredNumbers.filter((value) => game.drawBag.includes(value));
  const remainder = game.drawBag.filter((value) => !prioritized.includes(value));
  game.drawBag = [...prioritized, ...remainder];
}

function hostCanClaimLine(engine: BingoEngine, roomCode: string, hostPlayerId: string): boolean {
  const game = asInternalGame(engine, roomCode);
  if (!game) {
    return false;
  }
  const hostTickets = game.tickets.get(hostPlayerId) ?? [];
  const marksByTicket = game.marks.get(hostPlayerId) ?? [];
  for (let i = 0; i < hostTickets.length; i += 1) {
    const marks = marksByTicket[i] ?? new Set<number>();
    if (findFirstCompleteLinePatternIndex(hostTickets[i], marks) >= 0) {
      return true;
    }
  }
  return false;
}

function hostCanClaimBingo(engine: BingoEngine, roomCode: string, hostPlayerId: string): boolean {
  const game = asInternalGame(engine, roomCode);
  if (!game) {
    return false;
  }
  const hostTickets = game.tickets.get(hostPlayerId) ?? [];
  const marksByTicket = game.marks.get(hostPlayerId) ?? [];
  for (let i = 0; i < hostTickets.length; i += 1) {
    const marks = marksByTicket[i] ?? new Set<number>();
    if (hasFullBingo(hostTickets[i], marks)) {
      return true;
    }
  }
  return false;
}

async function runRound(input: {
  engine: BingoEngine;
  roomCode: string;
  hostPlayerId: string;
  payoutPercentTarget: number;
  hallId: string;
  entryFee: number;
  ticketsPerPlayer: number;
  forceHostWin: boolean;
}): Promise<void> {
  const payoutPercent = input.engine.resolvePayoutPercentForNextRound(input.payoutPercentTarget, input.hallId);
  await input.engine.startGame({
    roomCode: input.roomCode,
    actorPlayerId: input.hostPlayerId,
    entryFee: input.entryFee,
    ticketsPerPlayer: input.ticketsPerPlayer,
    payoutPercent
  });

  if (input.forceHostWin) {
    prioritizeHostTicketNumbers(input.engine, input.roomCode, input.hostPlayerId);
  }

  let lineClaimed = false;
  for (let safety = 0; safety < 80; safety += 1) {
    let number: number;
    try {
      number = await input.engine.drawNextNumber({
        roomCode: input.roomCode,
        actorPlayerId: input.hostPlayerId
      });
    } catch (error) {
      if (error instanceof DomainError && error.code === "NO_MORE_NUMBERS") {
        break;
      }
      throw error;
    }

    await input.engine.markNumber({
      roomCode: input.roomCode,
      playerId: input.hostPlayerId,
      number
    });

    if (!lineClaimed && hostCanClaimLine(input.engine, input.roomCode, input.hostPlayerId)) {
      const lineClaim = await input.engine.submitClaim({
        roomCode: input.roomCode,
        playerId: input.hostPlayerId,
        type: "LINE"
      });
      lineClaimed = lineClaim.valid;
    }

    if (hostCanClaimBingo(input.engine, input.roomCode, input.hostPlayerId)) {
      const bingoClaim = await input.engine.submitClaim({
        roomCode: input.roomCode,
        playerId: input.hostPlayerId,
        type: "BINGO"
      });
      if (bingoClaim.valid) {
        break;
      }
    }

    const snapshot = input.engine.getRoomSnapshot(input.roomCode);
    if (snapshot.currentGame?.status === "ENDED") {
      break;
    }
  }

  const snapshot = input.engine.getRoomSnapshot(input.roomCode);
  if (snapshot.currentGame?.status === "RUNNING") {
    await input.engine.endGame({
      roomCode: input.roomCode,
      actorPlayerId: input.hostPlayerId,
      reason: "simulation-round-close"
    });
  }
}

async function runTargetSimulation(options: SimulationOptions, target: number): Promise<SimulationResult> {
  const wallet = new InMemoryWalletAdapter(20_000_000);
  const engine = new BingoEngine(new LocalBingoSystemAdapter(), wallet, {
    dailyLossLimit: 50_000_000,
    monthlyLossLimit: 50_000_000,
    maxDrawsPerRound: 30,
    rtpRollingWindowSize: options.windowSize,
    nearMissBiasEnabled: true,
    nearMissTargetRate: 0.3
  });

  const { roomCode, playerId: hostPlayerId } = await engine.createRoom({
    hallId: options.hallId,
    playerName: "SimHost",
    walletId: `${options.hallId}-host`
  });
  await engine.joinRoom({
    roomCode,
    hallId: options.hallId,
    playerName: "SimGuest",
    walletId: `${options.hallId}-guest`
  });
  await wallet.topUp(`${options.hallId}-host`, 50_000_000, "simulation-funding");
  await wallet.topUp(`${options.hallId}-guest`, 50_000_000, "simulation-funding");

  const originalDateNow = Date.now;
  let fakeNowMs = Date.now() + 60_000;
  Date.now = () => fakeNowMs;
  try {
    for (let round = 0; round < options.rounds; round += 1) {
      fakeNowMs += 31_000;
      await runRound({
        engine,
        roomCode,
        hostPlayerId,
        payoutPercentTarget: target,
        hallId: options.hallId,
        entryFee: options.entryFee,
        ticketsPerPlayer: options.ticketsPerPlayer,
        forceHostWin: options.forceHostWin
      });
      trimSimulationGameHistory(engine, roomCode);
    }
  } finally {
    Date.now = originalDateNow;
  }

  const telemetry = engine.getRtpNearMissTelemetry({
    hallId: options.hallId,
    windowSize: options.windowSize
  });
  const rtpDeviation = Math.abs(telemetry.payoutPercentActualAvg - target);
  const nearMissRate = telemetry.nearMissRateAvg;
  return {
    targetRtpPercent: target,
    rounds: options.rounds,
    payoutPercentActualAvg: telemetry.payoutPercentActualAvg,
    payoutPercentTargetAvg: telemetry.payoutPercentTargetAvg,
    nearMissRateAvg: nearMissRate,
    rtpDeviation,
    rtpPass: rtpDeviation <= 1.0,
    nearMissPass: nearMissRate >= 0.25 && nearMissRate <= 0.35
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const results: SimulationResult[] = [];

  for (const target of options.targets) {
    const result = await runTargetSimulation(options, target);
    results.push(result);
  }

  const summary = {
    options,
    generatedAt: new Date().toISOString(),
    results,
    allGatesPass: results.every((result) => result.rtpPass && result.nearMissPass)
  };

  if (options.outputJson) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    for (const result of results) {
      console.log(
        `[sim] target=${result.targetRtpPercent}% rounds=${result.rounds} ` +
          `actualRtp=${result.payoutPercentActualAvg}% deviation=${result.rtpDeviation} ` +
          `nearMiss=${result.nearMissRateAvg} rtpPass=${result.rtpPass} nearMissPass=${result.nearMissPass}`
      );
    }
    console.log(`[sim] allGatesPass=${summary.allGatesPass}`);
  }

  if (!summary.allGatesPass) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[sim] failed", error);
  process.exitCode = 1;
});
