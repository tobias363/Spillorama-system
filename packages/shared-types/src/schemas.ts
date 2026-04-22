// ── Zod runtime schemas (BIN-545) ───────────────────────────────────────────
// Runtime-validated wire contracts for the three highest-risk socket payloads.
// Pattern: export both the schema (for .parse/.safeParse) and the z.infer<>-
// derived type (for compile-time use). Interfaces elsewhere remain unchanged —
// this file is the starting point; broader rollout is tracked separately.
//
// PR-R3 (2026-04-23): primitive re-usables er ekstrahert til
// ./schemas/_shared.ts slik at domene-subfiler kan dele dem under
// overgangen. Resten av filen flyttes i etterfølgende commits.

import { z } from "zod";
import { IsoDateString } from "./schemas/_shared.js";
// PR-R3: RoomSnapshotSchema flyttet til schemas/game.ts — gjenværende refs
// (Game1JoinScheduledAckDataSchema) importerer derfra til de også flyttes.
import { RoomSnapshotSchema } from "./schemas/game.js";

// Re-eksporter fra schemas/-undermappen. Barrel-en er tom i dette commit;
// innhold legges til etterhvert som domener flyttes.
export * from "./schemas/index.js";

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

// ── BIN-677: System settings + maintenance wire schemas ─────────────────────
// Mirror av migration `20260425000500_system_settings_maintenance.sql`.
//
// System settings er key-value (se SYSTEM_SETTING_REGISTRY i
// apps/backend/src/admin/SettingsService.ts for kjente nøkler). Ukjente
// nøkler avvises server-side.
//
// Maintenance-vinduer er separate rader; max ett samtidig aktivt vindu
// (håndheves i MaintenanceService).

export const SystemSettingType = z.enum(["string", "number", "boolean", "object"]);
export type SystemSettingTypeT = z.infer<typeof SystemSettingType>;

export const SystemSettingRowSchema = z.object({
  key: z.string().min(1).max(200),
  /** JSONB value — type avhenger av `type`-feltet; valideres av service-laget. */
  value: z.unknown(),
  category: z.string().min(1).max(100),
  description: z.string(),
  type: SystemSettingType,
  /** true hvis verdien kommer fra registry-default (ingen DB-rad eksisterer). */
  isDefault: z.boolean(),
  updatedByUserId: z.string().nullable(),
  updatedAt: IsoDateString.nullable(),
});
export type SystemSettingRow = z.infer<typeof SystemSettingRowSchema>;

export const SystemSettingsListResponseSchema = z.object({
  settings: z.array(SystemSettingRowSchema),
  count: z.number().int().nonnegative(),
});
export type SystemSettingsListResponse = z.infer<
  typeof SystemSettingsListResponseSchema
>;

export const SystemSettingPatchEntrySchema = z.object({
  key: z.string().min(1).max(200),
  value: z.unknown(),
});
export type SystemSettingPatchEntry = z.infer<typeof SystemSettingPatchEntrySchema>;

export const PatchSystemSettingsSchema = z
  .object({
    patches: z.array(SystemSettingPatchEntrySchema).min(1),
  })
  .refine((v) => v.patches.length > 0, {
    message: "Ingen endringer oppgitt.",
  });
export type PatchSystemSettingsInput = z.infer<typeof PatchSystemSettingsSchema>;

export const MaintenanceStatus = z.enum(["active", "inactive"]);
export type MaintenanceStatusT = z.infer<typeof MaintenanceStatus>;

export const MaintenanceWindowRowSchema = z.object({
  id: z.string().min(1),
  maintenanceStart: IsoDateString,
  maintenanceEnd: IsoDateString,
  message: z.string(),
  showBeforeMinutes: z.number().int().nonnegative(),
  status: MaintenanceStatus,
  createdByUserId: z.string().nullable(),
  createdAt: IsoDateString,
  updatedAt: IsoDateString,
  activatedAt: IsoDateString.nullable(),
  deactivatedAt: IsoDateString.nullable(),
});
export type MaintenanceWindowRow = z.infer<typeof MaintenanceWindowRowSchema>;

export const MaintenanceListResponseSchema = z.object({
  windows: z.array(MaintenanceWindowRowSchema),
  count: z.number().int().nonnegative(),
  /** Kort-referanse til aktivt vindu (om det finnes) for frontend-convenience. */
  active: MaintenanceWindowRowSchema.nullable(),
});
export type MaintenanceListResponse = z.infer<typeof MaintenanceListResponseSchema>;

export const CreateMaintenanceSchema = z.object({
  maintenanceStart: IsoDateString,
  maintenanceEnd: IsoDateString,
  message: z.string().max(2000).optional(),
  showBeforeMinutes: z.number().int().min(0).max(10_080).optional(),
  status: MaintenanceStatus.optional(),
});
export type CreateMaintenanceInput = z.infer<typeof CreateMaintenanceSchema>;

export const UpdateMaintenanceSchema = z
  .object({
    maintenanceStart: IsoDateString.optional(),
    maintenanceEnd: IsoDateString.optional(),
    message: z.string().max(2000).optional(),
    showBeforeMinutes: z.number().int().min(0).max(10_080).optional(),
    status: MaintenanceStatus.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Ingen endringer oppgitt.",
  });
export type UpdateMaintenanceInput = z.infer<typeof UpdateMaintenanceSchema>;

// ── BIN-679: MiniGames config wire schemas ──────────────────────────────────
// Admin-CRUD for de fire Game 1 mini-spillene (wheel, chest, mystery,
// colordraft). Én singleton-rad per spill-type. Mirror av migration
// `20260425000600_mini_games_config.sql`. Ren KONFIGURASJON — runtime-
// integrasjonen i Game 1 leser i dag hardkodede arrays (BingoEngine.
// MINIGAME_PRIZES); wiring til denne tabellen er egen PR.
//
// `otherGame`-kolleksjonen med slug-diskriminator + per-spill prizeList-
// felt). Fire separate felter flatet ut til én discriminated tabell fordi
// hvert spill er singleton-konfig.

/**
 * Admin-side short-form game-type slugs brukt i `app_mini_games_config`.
 * Skiller seg bevisst fra runtime-`MiniGameTypeSchema` (lengre event-navn
 * "wheelOfFortune", etc. definert lenger oppe i filen) — dette er
 * database-discriminatoren, ikke socket-event-typen.
 */
export const MiniGameConfigTypeSchema = z.enum([
  "wheel",
  "chest",
  "mystery",
  "colordraft",
]);
export type MiniGameConfigType = z.infer<typeof MiniGameConfigTypeSchema>;

/**
 * Wire-shape for en mini-game-config-rad. Dette er den generiske formen
 * som alle 4 spill deler; spill-spesifikk validering av `config` gjøres
 * i egne schemas (WheelConfig, ChestConfig, MysteryConfig, ColordraftConfig)
 * som admin-UI kan parse før render. Service-laget lagrer `config` som
 * fri-form JSONB og gjør ingen semantisk validering ut over objekt-sjekk —
 * det holder payload-sjansen åpen for nye felter uten migrasjon.
 */
export const MiniGameConfigRowSchema = z.object({
  id: z.string().min(1),
  gameType: MiniGameConfigTypeSchema,
  config: z.record(z.string(), z.unknown()),
  active: z.boolean(),
  updatedByUserId: z.string().nullable(),
  createdAt: IsoDateString,
  updatedAt: IsoDateString,
});
export type MiniGameConfigRow = z.infer<typeof MiniGameConfigRowSchema>;

/**
 * PUT-payload. Begge felter optional — admin-UI kan sende hele config hver
 * gang uten diff-logikk. Minst ett felt må være oppgitt (ellers gir service
 * samme rad tilbake uendret).
 */
export const UpdateMiniGameConfigSchema = z.object({
  config: z.record(z.string(), z.unknown()).optional(),
  active: z.boolean().optional(),
});
export type UpdateMiniGameConfigInput = z.infer<
  typeof UpdateMiniGameConfigSchema
>;

// ── Spill-spesifikke hjelper-schemas (valgfrie — admin-UI kan bruke) ────────
// Disse validerer ikke i backend (service tar generisk Record), men gir
// admin-UI og shared-types-forbrukere en typed form å parse mot ved behov.

/** Ett segment på 50-segment lykkehjulet. */
export const WheelSegmentSchema = z.object({
  label: z.string(),
  prizeAmount: z.number().nonnegative(),
  weight: z.number().nonnegative().optional(),
  color: z.string().optional(),
});
export type WheelSegment = z.infer<typeof WheelSegmentSchema>;

export const WheelConfigSchema = z.object({
  segments: z.array(WheelSegmentSchema),
});
export type WheelConfig = z.infer<typeof WheelConfigSchema>;

/** Én premie i kiste-listen. */
export const ChestPrizeSchema = z.object({
  label: z.string(),
  prizeAmount: z.number().nonnegative(),
  weight: z.number().nonnegative().optional(),
});
export type ChestPrize = z.infer<typeof ChestPrizeSchema>;

export const ChestConfigSchema = z.object({
  prizes: z.array(ChestPrizeSchema),
  chestCount: z.number().int().positive().optional(),
});
export type ChestConfig = z.infer<typeof ChestConfigSchema>;

/** Én belønning i mystery-tabellen. */
export const MysteryRewardSchema = z.object({
  label: z.string(),
  prizeAmount: z.number().nonnegative(),
  weight: z.number().nonnegative().optional(),
});
export type MysteryReward = z.infer<typeof MysteryRewardSchema>;

export const MysteryConfigSchema = z.object({
  rewards: z.array(MysteryRewardSchema),
});
export type MysteryConfig = z.infer<typeof MysteryConfigSchema>;

/** Ett farge-oppsett i colordraft-hjulet. */
export const ColordraftColorSchema = z.object({
  color: z.string(),
  prizeAmounts: z.array(z.number().nonnegative()),
  weight: z.number().nonnegative().optional(),
});
export type ColordraftColor = z.infer<typeof ColordraftColorSchema>;

export const ColordraftConfigSchema = z.object({
  colors: z.array(ColordraftColorSchema),
});
export type ColordraftConfig = z.infer<typeof ColordraftConfigSchema>;

// ── BIN-676: CMS content + FAQ wire schemas ─────────────────────────────────
// Admin-CRUD for fem statiske sider (aboutus/terms/support/links/responsible-
// gaming) + full FAQ-CRUD. Mirror av migration `20260426000200_cms.sql`.
//
// Slug-whitelist er speilet fra `CmsService.CMS_SLUGS` i backend. Frontend
// bruker enum-varianten slik at UI-valg er i takt med service-validering.
// `responsible-gaming` er regulatorisk-gated (pengespillforskriften §11) —
// PUT returnerer FEATURE_DISABLED inntil BIN-680 lander.
//
// Legacy-opphav:
//   legacy/unity-backend/App/Models/cms.js (singleton-dokument med 5 felter)
//   legacy/unity-backend/App/Models/faq.js

export const CmsSlugSchema = z.enum([
  "aboutus",
  "terms",
  "support",
  "links",
  "responsible-gaming",
]);
export type CmsSlug = z.infer<typeof CmsSlugSchema>;

export const CmsContentSchema = z.object({
  slug: CmsSlugSchema,
  /** Rå tekst-innhold (HTML/markdown). Max 200k tegn. */
  content: z.string().max(200_000),
  updatedByUserId: z.string().nullable(),
  createdAt: IsoDateString,
  updatedAt: IsoDateString,
});
export type CmsContentRow = z.infer<typeof CmsContentSchema>;

export const UpdateCmsContentSchema = z.object({
  content: z.string().max(200_000),
});
export type UpdateCmsContentInput = z.infer<typeof UpdateCmsContentSchema>;

export const FaqEntrySchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1).max(1_000),
  answer: z.string().min(1).max(10_000),
  sortOrder: z.number().int().nonnegative(),
  createdByUserId: z.string().nullable(),
  updatedByUserId: z.string().nullable(),
  createdAt: IsoDateString,
  updatedAt: IsoDateString,
});
export type FaqEntryRow = z.infer<typeof FaqEntrySchema>;

export const CreateFaqSchema = z.object({
  question: z.string().min(1).max(1_000),
  answer: z.string().min(1).max(10_000),
  sortOrder: z.number().int().nonnegative().optional(),
});
export type CreateFaqInput = z.infer<typeof CreateFaqSchema>;

export const UpdateFaqSchema = z
  .object({
    question: z.string().min(1).max(1_000).optional(),
    answer: z.string().min(1).max(10_000).optional(),
    sortOrder: z.number().int().nonnegative().optional(),
  })
  .refine((v: Record<string, unknown>) => Object.keys(v).length > 0, {
    message: "Ingen endringer oppgitt.",
  });
export type UpdateFaqInput = z.infer<typeof UpdateFaqSchema>;

export const FaqListResponseSchema = z.object({
  faqs: z.array(FaqEntrySchema),
  count: z.number().int().nonnegative(),
});
export type FaqListResponse = z.infer<typeof FaqListResponseSchema>;

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
