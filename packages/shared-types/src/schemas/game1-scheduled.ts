// ── GAME1_SCHEDULE: Game 1 scheduled-games + admin-namespace real-time ─────
// PR-R3: samler alle Game 1 scheduler-skjemaer fra schemas.ts:
//   - PR 1:    DB-row-shape (app_game1_scheduled_games)
//   - PR 4d.2: socket player-join (game1:join-scheduled)
//   - PR 4d.3: admin subscribe + status-update + draw-progressed
//   - PR 4d.4: admin phase-won (fra drawNext)
//   - PT4:     admin physical-ticket-won (fra drawNext + PhysicalTicketPayoutService)
//
// Spec: docs/architecture/GAME1_PR4D_SOCKET_REALTIME_DESIGN_2026-04-21.md.

import { z } from "zod";
import { IsoDateString } from "./_shared.js";
import { RoomSnapshotSchema } from "./game.js";

// ── GAME1_SCHEDULE PR 1: Game 1 scheduled-games wire schemas ──────────────────
// Mirror av migration `20260428000000_game1_scheduled_games.sql`.
//
// Tabellen app_game1_scheduled_games lagrer én rad per spawned Game 1-instans,
// spawned av scheduler-ticken (15s) fra daily_schedules × schedule-mal × subGames.
// State-maskin: scheduled → purchase_open → ready_to_start → running →
// paused → completed | cancelled.
//
// PR 1 eksponerer kun schemas (ingen route-endpoints ennå); disse brukes av
// PR 2-5 for ready-flow, master-start, exclude-hall og status-lister.

export const Game1ScheduledGameStatusSchema = z.enum([
  "scheduled",
  "purchase_open",
  "ready_to_start",
  "running",
  "paused",
  "completed",
  "cancelled",
]);
export type Game1ScheduledGameStatus = z.infer<typeof Game1ScheduledGameStatusSchema>;

export const Game1GameModeSchema = z.enum(["Auto", "Manual"]);
export type Game1GameMode = z.infer<typeof Game1GameModeSchema>;

export const Game1ScheduledGameRowSchema = z.object({
  id: z.string().min(1),
  /** FK til app_daily_schedules.id — planen som trigget spawnen. */
  dailyScheduleId: z.string().min(1),
  /** FK til app_schedules.id — malen vi snapshotet ticket/jackpot-config fra. */
  scheduleId: z.string().min(1),
  /** Index i schedule.subGames[] (0-basert). */
  subGameIndex: z.number().int().nonnegative(),
  subGameName: z.string().min(1),
  customGameName: z.string().nullable(),
  /** 'YYYY-MM-DD' — datoen raden gjelder. */
  scheduledDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  scheduledStartTime: IsoDateString,
  scheduledEndTime: IsoDateString,
  /** Normalisert fra legacy "5m"/"60s" — sekunder som INT. */
  notificationStartSeconds: z.number().int().nonnegative(),
  /** Snapshot av schedule.subGame.ticketTypesData på spawn-tidspunkt. */
  ticketConfig: z.record(z.string(), z.unknown()),
  /** Snapshot av schedule.subGame.jackpotData på spawn-tidspunkt. */
  jackpotConfig: z.record(z.string(), z.unknown()),
  gameMode: Game1GameModeSchema,
  masterHallId: z.string().min(1),
  groupHallId: z.string().min(1),
  /** Snapshot av deltakende haller (array av hall-IDer). */
  participatingHallIds: z.array(z.string().min(1)),
  status: Game1ScheduledGameStatusSchema,
  actualStartTime: IsoDateString.nullable(),
  actualEndTime: IsoDateString.nullable(),
  startedByUserId: z.string().nullable(),
  excludedHallIds: z.array(z.string().min(1)),
  stoppedByUserId: z.string().nullable(),
  stopReason: z.string().nullable(),
  createdAt: IsoDateString,
  updatedAt: IsoDateString,
});
export type Game1ScheduledGameRow = z.infer<typeof Game1ScheduledGameRowSchema>;

// ── GAME1_SCHEDULE PR 4d.2: socket player-join for schedulert Spill 1 ───────
// Spec: docs/architecture/GAME1_PR4D_SOCKET_REALTIME_DESIGN_2026-04-21.md §3.3.
// Spiller joiner en schedulert Spill 1-økt via scheduled_game_id — server
// slår opp/oppretter BingoEngine-rom og returnerer standard snapshot-ack.

export const Game1JoinScheduledPayloadSchema = z.object({
  /** UUID av raden i app_game1_scheduled_games. */
  scheduledGameId: z.string().min(1),
  /** accessToken-format matcher eksisterende room:create/room:join. */
  accessToken: z.string().min(1),
  /** Hallen spilleren spiller fra — må være i participating_halls_json. */
  hallId: z.string().min(1),
  /** Display-navn på spilleren (matcher CreateRoomInput.playerName). */
  playerName: z.string().min(1).max(50),
});
export type Game1JoinScheduledPayload = z.infer<typeof Game1JoinScheduledPayloadSchema>;

/**
 * Ack returnert av `game1:join-scheduled`. Formen matcher eksisterende
 * `room:create`/`room:join` så klient-bridge ikke trenger ny parser.
 * `snapshot` er samme `RoomSnapshotSchema`-shape som øvrige ack-er.
 */
export const Game1JoinScheduledAckDataSchema = z.object({
  roomCode: z.string().min(1),
  playerId: z.string().min(1),
  snapshot: RoomSnapshotSchema,
});
export type Game1JoinScheduledAckData = z.infer<typeof Game1JoinScheduledAckDataSchema>;

// ── GAME1_SCHEDULE PR 4d.3: admin-namespace real-time broadcast ─────────────
// Spec: docs/architecture/GAME1_PR4D_SOCKET_REALTIME_DESIGN_2026-04-21.md §3.4/§3.5.
// Admin-socket mottar sanntids-events for schedulerte spill i stedet for
// REST-polling. Namespace: `/admin-game1`.

/**
 * Ack-struktur for `game1:subscribe` — admin-klient abonnerer på gameId-
 * spesifikke events. Returnerer dagens state-snapshot slik at initial-
 * render er umiddelbar uten ekstra REST-kall.
 */
export const Game1AdminSubscribePayloadSchema = z.object({
  gameId: z.string().min(1),
});
export type Game1AdminSubscribePayload = z.infer<typeof Game1AdminSubscribePayloadSchema>;

/**
 * `game1:status-update` — emittes etter hver state-change i
 * Game1MasterControlService (start/pause/resume/stop/exclude-hall/
 * include-hall). Admin-UI speiler DB-status uten REST-polling.
 */
export const Game1AdminStatusUpdatePayloadSchema = z.object({
  gameId: z.string().min(1),
  status: z.string().min(1),
  action: z.string().min(1),
  auditId: z.string().min(1),
  actorUserId: z.string().min(1),
  at: z.number().int().nonnegative(),
});
export type Game1AdminStatusUpdatePayload = z.infer<typeof Game1AdminStatusUpdatePayloadSchema>;

/**
 * `game1:draw-progressed` — emittes etter hver draw i Game1DrawEngineService.
 * Admin-UI oppdaterer draws-counter uten polling. Ball-nummer eksponeres
 * for sanntids-visning på master-konsoll.
 */
export const Game1AdminDrawProgressedPayloadSchema = z.object({
  gameId: z.string().min(1),
  ballNumber: z.number().int().min(1),
  drawIndex: z.number().int().min(1),
  currentPhase: z.number().int().min(1).max(5),
  at: z.number().int().nonnegative(),
});
export type Game1AdminDrawProgressedPayload = z.infer<typeof Game1AdminDrawProgressedPayloadSchema>;

/**
 * `game1:phase-won` — emittes i drawNext når en fase fullføres (PR 4d.4).
 * Admin-UI viser sanntids fase-fullføring + vinner-antall.
 * Bevarer Agent 4-kontrakten på default namespace: spiller-rettet
 * `pattern:won` er urørt — dette er admin-speiling uten wallet-detaljer.
 */
export const Game1AdminPhaseWonPayloadSchema = z.object({
  gameId: z.string().min(1),
  patternName: z.string().min(1),
  phase: z.number().int().min(1).max(5),
  winnerIds: z.array(z.string().min(1)).min(1),
  winnerCount: z.number().int().min(1),
  drawIndex: z.number().int().min(1),
  at: z.number().int().nonnegative(),
});
export type Game1AdminPhaseWonPayload = z.infer<typeof Game1AdminPhaseWonPayloadSchema>;

/**
 * PT4: `game1:physical-ticket-won` — emittes av `Game1DrawEngineService` når
 * en fysisk bong (sold_to_scheduled_game_id satt) treffer pattern for aktiv
 * fase. Mottaker: `/admin-game1`-namespace. Bingovert-skjerm bruker eventet
 * for å varsle vakten om at bong må kontrolleres før kontant-utbetaling.
 *
 * Payload er PER BONG (ikke aggregert per fase) — flere fysiske bonger i
 * samme fase genererer flere events. `pendingPayoutId` kan brukes mot
 * REST-endepunkt `POST /api/admin/physical-ticket-payouts/:id/verify`.
 *
 * **Ingen wallet-info** — fysisk utbetaling er kontanter, kun
 * `expectedPayoutCents` speiler forventet beløp.
 */
export const Game1AdminPhysicalTicketWonPayloadSchema = z.object({
  gameId: z.string().min(1),
  phase: z.number().int().min(1).max(5),
  patternName: z.string().min(1),
  pendingPayoutId: z.string().min(1),
  ticketId: z.string().min(1),
  hallId: z.string().min(1),
  responsibleUserId: z.string().min(1),
  expectedPayoutCents: z.number().int().nonnegative(),
  color: z.string().min(1),
  adminApprovalRequired: z.boolean(),
  at: z.number().int().nonnegative(),
});
export type Game1AdminPhysicalTicketWonPayload = z.infer<
  typeof Game1AdminPhysicalTicketWonPayloadSchema
>;

// ── Task 1.1: auto-pause ved phase-won ──────────────────────────────────────
// Gap #1 i docs/architecture/MASTER_HALL_DASHBOARD_GAP_2026-04-24.md.
//
// `game1:auto-paused` — emittes av Game1DrawEngineService når en phase-won
// trigget auto-pause (etter Rad 1, Rad 2, ..., men IKKE etter Fullt Hus
// fordi spillet da avsluttes). Master-UI og agent-portal bruker eventet for
// å vise Resume-knapp + banner "Pause etter Rad X — trykk Resume".
//
// `game1:resumed` — emittes av Game1MasterControlService når master/agent
// manuelt re-starter draw-engine etter auto-pause. Markerer slutten på
// paused-sidestate (sett `paused=false`, `paused_at_phase=NULL`).

export const Game1AdminAutoPausedPayloadSchema = z.object({
  gameId: z.string().min(1),
  phase: z.number().int().min(1).max(5),
  pausedAt: z.number().int().nonnegative(),
});
export type Game1AdminAutoPausedPayload = z.infer<
  typeof Game1AdminAutoPausedPayloadSchema
>;

export const Game1AdminResumedPayloadSchema = z.object({
  gameId: z.string().min(1),
  resumedAt: z.number().int().nonnegative(),
  actorUserId: z.string().min(1),
  /** Fasen engine returnerer til å trekke (nåværende current_phase). */
  phase: z.number().int().min(1).max(5),
  /**
   * `auto` hvis resume avsluttet en auto-pause (paused_at_phase var satt);
   * `manual` hvis resume avsluttet en eksplisitt master-pause
   * (status='paused').
   */
  resumeType: z.enum(["auto", "manual"]),
});
export type Game1AdminResumedPayload = z.infer<
  typeof Game1AdminResumedPayloadSchema
>;

// ── Task 1.6: master-hall transfer-events ───────────────────────────────────
// Spec: docs/architecture/MASTER_HALL_DASHBOARD_GAP_2026-04-24.md Appendix B.3.
// Backend-tabell: app_game1_master_transfer_requests (60s TTL, én aktiv per game).
//
// Emit-flow:
//   * requestTransfer  → `game1:transfer-request`    (til target-hall + admin-namespace)
//   * approveTransfer  → `game1:transfer-approved` + `game1:master-changed`
//   * rejectTransfer   → `game1:transfer-rejected`   (til initiator)
//   * expiry-tick      → `game1:transfer-expired`    (til både from + to)

export const Game1TransferRequestStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "expired",
]);
export type Game1TransferRequestStatus = z.infer<
  typeof Game1TransferRequestStatusSchema
>;

/**
 * Felles payload-shape for transfer-requests i socket-events og REST-responser.
 * `validTillMs` er `valid_till` konvertert til epoch-ms for klient-countdown.
 */
export const Game1TransferRequestPayloadSchema = z.object({
  requestId: z.string().min(1),
  gameId: z.string().min(1),
  fromHallId: z.string().min(1),
  toHallId: z.string().min(1),
  initiatedByUserId: z.string().min(1),
  initiatedAtMs: z.number().int().nonnegative(),
  validTillMs: z.number().int().nonnegative(),
  status: Game1TransferRequestStatusSchema,
  respondedByUserId: z.string().nullable(),
  respondedAtMs: z.number().int().nonnegative().nullable(),
  rejectReason: z.string().nullable(),
});
export type Game1TransferRequestPayload = z.infer<
  typeof Game1TransferRequestPayloadSchema
>;

/**
 * `game1:master-changed` — broadcastet til game-room når master-hallen er
 * overført. Alle haller i linken oppdaterer sin UI-badge ("Master"-indikator).
 */
export const Game1MasterChangedPayloadSchema = z.object({
  gameId: z.string().min(1),
  previousMasterHallId: z.string().min(1),
  newMasterHallId: z.string().min(1),
  transferRequestId: z.string().min(1),
  at: z.number().int().nonnegative(),
});
export type Game1MasterChangedPayload = z.infer<
  typeof Game1MasterChangedPayloadSchema
>;
