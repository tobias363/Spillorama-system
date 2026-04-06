export const CANDY_SOCKET_EVENT_NAMES = {
  roomCreate: "room:create",
  roomJoin: "room:join",
  roomResume: "room:resume",
  roomConfigure: "room:configure",
  betArm: "bet:arm",
  gameStart: "game:start",
  gameEnd: "game:end",
  drawNext: "draw:next",
  drawNew: "draw:new",
  drawExtraPurchase: "draw:extra:purchase",
  ticketMark: "ticket:mark",
  ticketReroll: "ticket:reroll",
  claimSubmit: "claim:submit",
  roomState: "room:state",
  roomUpdate: "room:update",
} as const;

export type CandySocketEventName =
  (typeof CANDY_SOCKET_EVENT_NAMES)[keyof typeof CANDY_SOCKET_EVENT_NAMES];

export interface CandySocketAckError {
  code: string;
  message: string;
}

export interface CandySocketAckResponse<T> {
  ok: boolean;
  data?: T;
  error?: CandySocketAckError;
}

export type ClaimType = "LINE" | "BINGO" | "PATTERN";
export type GameStatus = "WAITING" | "RUNNING" | "ENDED";

export interface Player {
  id: string;
  name: string;
  walletId: string;
  balance: number;
  socketId?: string;
}

export interface Ticket {
  numbers?: number[];
  grid: number[][];
}

export interface ClaimRecord {
  id: string;
  playerId: string;
  type: ClaimType;
  valid: boolean;
  reason?: string;
  claimKind?: "LEGACY_LINE" | "LEGACY_BINGO" | "PATTERN_FAMILY";
  winningPatternIndex?: number;
  patternIndex?: number;
  displayPatternNumber?: number;
  topperSlotIndex?: number;
  ticketIndex?: number;
  bonusTriggered?: boolean;
  bonusAmount?: number;
  payoutAmount?: number;
  payoutPolicyVersion?: string;
  payoutWasCapped?: boolean;
  rtpBudgetBefore?: number;
  rtpBudgetAfter?: number;
  rtpCapped?: boolean;
  createdAt: string;
}

export interface GameSnapshot {
  id: string;
  status: GameStatus;
  entryFee: number;
  ticketsPerPlayer: number;
  prizePool: number;
  remainingPrizePool: number;
  payoutPercent: number;
  maxPayoutBudget: number;
  remainingPayoutBudget: number;
  activePatternIndexes?: number[];
  patternPayoutAmounts?: number[];
  drawnNumbers: number[];
  remainingNumbers: number;
  nearMissTargetRateApplied?: number;
  lineWinnerId?: string;
  bingoWinnerId?: string;
  claims: ClaimRecord[];
  tickets: Record<string, Ticket[]>;
  marks: Record<string, number[]>;
  startedAt: string;
  endedAt?: string;
  endedReason?: string;
}

export interface RoomSnapshot {
  code: string;
  hallId: string;
  hostPlayerId: string;
  createdAt: string;
  players: Player[];
  currentGame?: GameSnapshot;
  preRoundTickets?: Record<string, Ticket[]>;
  gameHistory: GameSnapshot[];
}

export interface RoomSummary {
  code: string;
  hallId: string;
  hostPlayerId: string;
  playerCount: number;
  createdAt: string;
  gameStatus: GameStatus | "NONE";
}

export interface CandyRoomSchedulerState {
  enabled: boolean;
  liveRoundsIndependentOfBet: boolean;
  intervalMs: number;
  minPlayers: number;
  playerCount: number;
  armedPlayerCount: number;
  armedPlayerIds: string[];
  entryFee: number;
  payoutPercent: number;
  drawCapacity: number;
  currentDrawCount: number;
  remainingDrawCapacity: number;
  nextStartAt: string | null;
  millisUntilNextStart: number | null;
  canStartNow: boolean;
  serverTime: string;
}

export type RoomSnapshotWithScheduler = RoomSnapshot & {
  scheduler: CandyRoomSchedulerState;
};

export interface CandyAuthenticatedSocketPayload {
  accessToken?: string;
}

export interface CandyRoomActionPayload extends CandyAuthenticatedSocketPayload {
  roomCode: string;
  playerId: string;
}

export interface CandyCreateRoomPayload extends CandyAuthenticatedSocketPayload {
  playerName?: string;
  walletId?: string;
  hallId?: string;
}

export interface CandyJoinRoomPayload extends CandyCreateRoomPayload {
  roomCode: string;
}

export interface CandyResumeRoomPayload extends CandyRoomActionPayload {}

export interface CandyConfigureRoomPayload extends CandyRoomActionPayload {
  entryFee?: number;
}

export interface CandyBetArmPayload extends CandyRoomActionPayload {
  armed?: boolean;
}

export interface CandyStartGamePayload extends CandyRoomActionPayload {
  entryFee?: number;
  ticketsPerPlayer?: number;
}

export interface CandyEndGamePayload extends CandyRoomActionPayload {
  reason?: string;
}

export interface CandyDrawNextPayload extends CandyRoomActionPayload {}

export interface CandyDrawExtraPurchasePayload extends CandyRoomActionPayload {
  requestedCount?: number;
  packageId?: string;
}

export interface CandyTicketMarkPayload extends CandyRoomActionPayload {
  number: number;
}

export interface CandyTicketRerollPayload extends CandyRoomActionPayload {
  ticketsPerPlayer?: number;
  ticketIndex?: number;
}

export interface CandyClaimSubmitPayload extends CandyRoomActionPayload {
  type: ClaimType;
}

export interface CandyRoomStatePayload extends CandyAuthenticatedSocketPayload {
  roomCode: string;
}

export interface CandyDrawNewPayload {
  number: number;
  source?: string;
}

export interface CandyClientToServerEvents {
  "room:create": {
    payload: CandyCreateRoomPayload;
    ack: CandySocketAckResponse<{
      roomCode: string;
      playerId: string;
      snapshot: RoomSnapshotWithScheduler;
    }>;
  };
  "room:join": {
    payload: CandyJoinRoomPayload;
    ack: CandySocketAckResponse<{
      roomCode: string;
      playerId: string;
      snapshot: RoomSnapshotWithScheduler;
    }>;
  };
  "room:resume": {
    payload: CandyResumeRoomPayload;
    ack: CandySocketAckResponse<{
      snapshot: RoomSnapshotWithScheduler;
    }>;
  };
  "room:configure": {
    payload: CandyConfigureRoomPayload;
    ack: CandySocketAckResponse<{
      snapshot: RoomSnapshotWithScheduler;
      entryFee: number;
    }>;
  };
  "bet:arm": {
    payload: CandyBetArmPayload;
    ack: CandySocketAckResponse<{
      snapshot: RoomSnapshotWithScheduler;
      armed: boolean;
      armedPlayerIds: string[];
    }>;
  };
  "game:start": {
    payload: CandyStartGamePayload;
    ack: CandySocketAckResponse<{
      snapshot: RoomSnapshotWithScheduler;
    }>;
  };
  "game:end": {
    payload: CandyEndGamePayload;
    ack: CandySocketAckResponse<{
      snapshot: RoomSnapshotWithScheduler;
    }>;
  };
  "draw:next": {
    payload: CandyDrawNextPayload;
    ack: CandySocketAckResponse<{
      number: number;
      snapshot: RoomSnapshotWithScheduler;
    }>;
  };
  "draw:extra:purchase": {
    payload: CandyDrawExtraPurchasePayload;
    ack: CandySocketAckResponse<{
      denied: true;
    }>;
  };
  "ticket:mark": {
    payload: CandyTicketMarkPayload;
    ack: CandySocketAckResponse<{
      snapshot: RoomSnapshotWithScheduler;
    }>;
  };
  "ticket:reroll": {
    payload: CandyTicketRerollPayload;
    ack: CandySocketAckResponse<{
      snapshot: RoomSnapshotWithScheduler;
      ticketsPerPlayer: number;
      ticketCount: number;
      rerolledTicketIndexes: number[];
    }>;
  };
  "claim:submit": {
    payload: CandyClaimSubmitPayload;
    ack: CandySocketAckResponse<{
      snapshot: RoomSnapshotWithScheduler;
    }>;
  };
  "room:state": {
    payload: CandyRoomStatePayload;
    ack: CandySocketAckResponse<{
      snapshot: RoomSnapshotWithScheduler;
    }>;
  };
}

export interface CandyServerToClientEvents {
  "draw:new": CandyDrawNewPayload;
  "room:update": RoomSnapshotWithScheduler;
}

export type CandyClientToServerEventName = keyof CandyClientToServerEvents;
export type CandyServerToClientEventName = keyof CandyServerToClientEvents;

export type CandyClientPayload<E extends CandyClientToServerEventName> =
  CandyClientToServerEvents[E]["payload"];

export type CandyClientAck<E extends CandyClientToServerEventName> =
  CandyClientToServerEvents[E]["ack"];

export type CandyServerPayload<E extends CandyServerToClientEventName> =
  CandyServerToClientEvents[E];

export type AckResponse<T> = CandySocketAckResponse<T>;
export type RealtimePlayer = Player;
export type RealtimeTicket = Ticket;
export type RealtimeClaimRecord = ClaimRecord;
export type RealtimeGameSnapshot = GameSnapshot;
export type RealtimeRoomSnapshot = RoomSnapshotWithScheduler;
export type RealtimeRoomStateAck = { snapshot: RealtimeRoomSnapshot };

export interface RealtimeSession {
  baseUrl: string;
  roomCode: string;
  playerId: string;
  accessToken: string;
  hallId: string;
}
