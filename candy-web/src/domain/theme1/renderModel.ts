export const THEME1_CARD_CELL_COUNT = 15;
export const THEME1_DEFAULT_CARD_SLOT_COUNT = 4;
export const THEME1_DEFAULT_BALL_SLOT_COUNT = 30;

export const theme1PrizeVisualStates = ["Normal", "NearWin", "Matched"] as const;
export type Theme1PrizeVisualState = (typeof theme1PrizeVisualStates)[number];

export const theme1WinLabelAnchors = [
  "BottomCenter",
  "BottomLeft",
  "BottomRight",
] as const;
export type Theme1WinLabelAnchor = (typeof theme1WinLabelAnchors)[number];

export const theme1PatternOverlayKinds = [
  "None",
  "HorizontalLine",
  "SvgStroke",
  "SvgMask",
] as const;
export type Theme1PatternOverlayKind =
  (typeof theme1PatternOverlayKinds)[number];

export const theme1CardCellVisualStates = [
  "Normal",
  "NearHit",
  "NearTarget",
  "WonHit",
  "WonPrize",
] as const;
export type Theme1CardCellVisualState =
  (typeof theme1CardCellVisualStates)[number];

export interface Theme1RoundRenderState {
  gameId: string;
  cards: Theme1CardRenderState[];
  ballRack: Theme1BallRackRenderState;
  hud: Theme1HudRenderState;
  topper: Theme1TopperRenderState;
}

export interface Theme1CardRenderState {
  headerLabel: string;
  betLabel: string;
  winLabel: string;
  showWinLabel: boolean;
  cells: Theme1CardCellRenderState[];
  paylinesActive: boolean[];
  matchedPatternIndexes: number[];
  completedPatterns: Theme1CompletedPatternRenderState[];
  activeNearPattern: Theme1NearPatternRenderState | null;
}

export interface Theme1CellPrizeLabelRenderState {
  text: string;
  anchor: Theme1WinLabelAnchor;
  prizeAmountKr: number;
  rawPatternIndex: number;
}

export interface Theme1CardCellRenderState {
  numberLabel: string;
  isSelected: boolean;
  isMissing: boolean;
  isMatched: boolean;
  nearWinPatternIndex: number;
  nearWinPatternIndexes: number[];
  missingNumber: number;
  visualState: Theme1CardCellVisualState;
  isPrizeCell: boolean;
  isNearTargetCell: boolean;
  prizeLabel: string;
  prizeAnchor: Theme1WinLabelAnchor;
  prizeLabels: Theme1CellPrizeLabelRenderState[];
  completedPatternIndexes: number[];
}

export interface Theme1BallRackRenderState {
  showBigBall: boolean;
  bigBallNumber: string;
  showBallMachine: boolean;
  showExtraBallMachine: boolean;
  showBallOutMachine: boolean;
  slots: Theme1BallSlotRenderState[];
}

export interface Theme1BallSlotRenderState {
  isVisible: boolean;
  numberLabel: string;
}

export interface Theme1HudRenderState {
  countdownLabel: string;
  playerCountLabel: string;
  creditLabel: string;
  winningsLabel: string;
  betLabel: string;
}

export interface Theme1TopperRenderState {
  slots: Theme1TopperSlotRenderState[];
}

export interface Theme1TopperSlotRenderState {
  prizeLabel: string;
  showPattern: boolean;
  showMatchedPattern: boolean;
  missingCellsVisible: boolean[];
  prizeVisualState: Theme1PrizeVisualState;
  activePatternIndexes: number[];
  activeCardIndexes: number[];
}

export interface Theme1CompletedPatternRenderState {
  rawPatternIndex: number;
  slotIndex: number;
  cellIndices: number[];
  triggerCellIndex: number;
  triggerNumber: number;
  prizeAmountKr: number;
  prizeLabel: string;
  prizeAnchor: Theme1WinLabelAnchor;
  overlayKind: Theme1PatternOverlayKind;
}

export interface Theme1NearPatternRenderState {
  rawPatternIndex: number;
  slotIndex: number;
  cellIndices: number[];
  matchedCellIndices: number[];
  targetCellIndex: number;
  targetNumber: number;
  prizeAmountKr: number;
  prizeLabel: string;
  prizeAnchor: Theme1WinLabelAnchor;
  overlayKind: Theme1PatternOverlayKind;
}

export function createEmptyTheme1CardCellRenderState(): Theme1CardCellRenderState {
  return {
    numberLabel: "-",
    isSelected: false,
    isMissing: false,
    isMatched: false,
    nearWinPatternIndex: -1,
    nearWinPatternIndexes: [],
    missingNumber: 0,
    visualState: "Normal",
    isPrizeCell: false,
    isNearTargetCell: false,
    prizeLabel: "",
    prizeAnchor: "BottomCenter",
    prizeLabels: [],
    completedPatternIndexes: [],
  };
}

export function createEmptyTheme1CardRenderState(): Theme1CardRenderState {
  return {
    headerLabel: "",
    betLabel: "",
    winLabel: "",
    showWinLabel: false,
    cells: Array.from({ length: THEME1_CARD_CELL_COUNT }, () =>
      createEmptyTheme1CardCellRenderState(),
    ),
    paylinesActive: [],
    matchedPatternIndexes: [],
    completedPatterns: [],
    activeNearPattern: null,
  };
}

export function createEmptyTheme1BallSlotRenderState(): Theme1BallSlotRenderState {
  return {
    isVisible: false,
    numberLabel: "",
  };
}

export function createEmptyTheme1BallRackRenderState(
  ballSlotCount = 0,
): Theme1BallRackRenderState {
  return {
    showBigBall: false,
    bigBallNumber: "",
    showBallMachine: false,
    showExtraBallMachine: false,
    showBallOutMachine: true,
    slots: Array.from({ length: Math.max(0, ballSlotCount) }, () =>
      createEmptyTheme1BallSlotRenderState(),
    ),
  };
}

export function createEmptyTheme1HudRenderState(): Theme1HudRenderState {
  return {
    countdownLabel: "",
    playerCountLabel: "",
    creditLabel: "",
    winningsLabel: "",
    betLabel: "",
  };
}

export function createEmptyTheme1TopperSlotRenderState(): Theme1TopperSlotRenderState {
  return {
    prizeLabel: "",
    showPattern: true,
    showMatchedPattern: false,
    missingCellsVisible: [],
    prizeVisualState: "Normal",
    activePatternIndexes: [],
    activeCardIndexes: [],
  };
}

export function createEmptyTheme1TopperRenderState(
  topperSlotCount = 0,
): Theme1TopperRenderState {
  return {
    slots: Array.from({ length: Math.max(0, topperSlotCount) }, () =>
      createEmptyTheme1TopperSlotRenderState(),
    ),
  };
}

export function createEmptyTheme1RoundRenderState(
  cardCount = 0,
  ballSlotCount = 0,
  topperSlotCount = 0,
): Theme1RoundRenderState {
  return {
    gameId: "",
    cards: Array.from({ length: Math.max(0, cardCount) }, () =>
      createEmptyTheme1CardRenderState(),
    ),
    ballRack: createEmptyTheme1BallRackRenderState(ballSlotCount),
    hud: createEmptyTheme1HudRenderState(),
    topper: createEmptyTheme1TopperRenderState(topperSlotCount),
  };
}

export type Theme1CellTone = "idle" | "matched" | "target" | "won";
export type Theme1DataSource = "mock" | "live";
export type Theme1ConnectionPhase = "mock" | "connecting" | "connected" | "disconnected" | "error";
export type Theme1BoardPrizeAnchor = "left" | "center" | "right";

export interface Theme1HudState {
  saldo: string;
  gevinst: string;
  innsats: string;
  nesteTrekkOm: string;
  roomPlayers: string;
}

export interface Theme1TopperState {
  id: number;
  title: string;
  prize: string;
  highlighted?: boolean;
}

export interface Theme1CellState {
  index: number;
  value: number;
  tone: Theme1CellTone;
}

export interface Theme1BoardPatternOverlayState {
  key: string;
  rawPatternIndex: number;
  title: string;
  symbolId: string | null;
  cellIndices: number[];
}

export interface Theme1BoardPrizeLabelState {
  text: string;
  prizeAmountKr: number;
  rawPatternIndex: number;
}

export interface Theme1BoardPrizeStackState {
  cellIndex: number;
  anchor: Theme1BoardPrizeAnchor;
  labels: Theme1BoardPrizeLabelState[];
}

export interface Theme1BoardState {
  id: string;
  label: string;
  stake: string;
  win: string;
  cells: Theme1CellState[];
  completedPatterns: Theme1BoardPatternOverlayState[];
  prizeStacks: Theme1BoardPrizeStackState[];
}

export interface Theme1RoundMeta {
  source: Theme1DataSource;
  roomCode: string;
  hallId: string;
  playerId: string;
  hostPlayerId: string;
  playerName: string;
  gameStatus: string;
  drawCount: number;
  remainingNumbers: number;
  connectionPhase: Theme1ConnectionPhase;
  connectionLabel: string;
  backendUrl: string;
}

export interface Theme1RoundRenderModel {
  hud: Theme1HudState;
  toppers: Theme1TopperState[];
  recentBalls: number[];
  boards: Theme1BoardState[];
  meta: Theme1RoundMeta;
}
