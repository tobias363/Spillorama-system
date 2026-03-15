export type Theme1MachinePhase =
  | "idle"
  | "mix"
  | "suction"
  | "drop"
  | "exit"
  | "settle"
  | "hold";

export interface Theme1MachineBallState {
  number: number;
  restX: number;
  restY: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  baseScale: number;
  response: number;
  depth: number;
  renderDepth: number;
  wanderAmplitudeX: number;
  wanderAmplitudeY: number;
  wanderFrequencyA: number;
  wanderFrequencyB: number;
  orbitRadiusX: number;
  orbitRadiusY: number;
  orbitFrequency: number;
  phaseA: number;
  phaseB: number;
  phaseC: number;
  noiseOffsetX: number;
  noiseOffsetY: number;
  noiseSpeed: number;
  speedMultiplier: number;
  bounce: number;
  wallDrift: number;
  spin: number;
  spinSpeed: number;
}

export interface Theme1MachineTimings {
  mixBoostMs: number;
  suctionMs: number;
  dropMs: number;
  exitMs: number;
  settleMs: number;
  holdMs: number;
  totalMs: number;
}

export interface Theme1MachineAnchors {
  clusterLeftPct: number;
  clusterTopPct: number;
  clusterWidthPct: number;
  clusterHeightPct: number;
  cupXPct: number;
  cupYPct: number;
  holeXPct: number;
  holeYPct: number;
  outputXPct: number;
  outputYPct: number;
}

export interface Theme1MachinePresentationInput {
  recentBalls: readonly number[];
  featuredBallNumber: number | null;
  featuredBallIsPending: boolean;
}

export interface Theme1MachinePresentationState {
  availableBallNumbers: number[];
  outputBallNumber: number | null;
}

export const THEME1_MACHINE_TIMINGS: Theme1MachineTimings = Object.freeze({
  mixBoostMs: 300,
  suctionMs: 240,
  dropMs: 180,
  exitMs: 420,
  settleMs: 260,
  holdMs: 200,
  totalMs: 1600,
});

export const THEME1_DRAW_PRESENTATION_MS = THEME1_MACHINE_TIMINGS.totalMs;

export const THEME1_MACHINE_ANCHORS: Theme1MachineAnchors = Object.freeze({
  clusterLeftPct: 7.2,
  clusterTopPct: 1.3,
  clusterWidthPct: 85.6,
  clusterHeightPct: 70.2,
  cupXPct: 50,
  cupYPct: 67.1,
  holeXPct: 50,
  holeYPct: 79.1,
  outputXPct: 50,
  outputYPct: 95.2,
});

export function deriveTheme1MachinePresentationState(
  input: Theme1MachinePresentationInput,
): Theme1MachinePresentationState {
  const normalizedRecentBalls = input.recentBalls.filter(
    (value, index, values) =>
      Number.isFinite(value) &&
      value > 0 &&
      value <= 60 &&
      values.indexOf(value) === index,
  );
  const drawnNumbers = new Set(normalizedRecentBalls);
  const availableBallNumbers = Array.from({ length: 60 }, (_, index) => index + 1).filter(
    (number) => !drawnNumbers.has(number),
  );
  const lastDrawnBall = normalizedRecentBalls[normalizedRecentBalls.length - 1] ?? null;

  return {
    availableBallNumbers,
    outputBallNumber:
      input.featuredBallIsPending &&
      typeof input.featuredBallNumber === "number" &&
      Number.isFinite(input.featuredBallNumber) &&
      input.featuredBallNumber > 0
        ? input.featuredBallNumber
        : lastDrawnBall,
  };
}
