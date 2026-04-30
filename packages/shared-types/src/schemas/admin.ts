// ── Admin-CRUD wire schemas ─────────────────────────────────────────────────
// PR-R3: samler alle admin-CRUD-skjemaer fra schemas.ts:
//   - GameManagement (BIN-622)
//   - DailySchedule  (BIN-626)
//   - Pattern        (BIN-627)
//   - HallGroup      (BIN-665)
//   - GameType       (BIN-620)
//   - SubGame        (BIN-621)
//   - LeaderboardTier (BIN-668)
//   - Loyalty        (BIN-700)
//   - SavedGame      (BIN-624)
//   - Schedule       (BIN-625)

import { z } from "zod";
import { IsoDateString, HhMmOrEmpty } from "./_shared.js";

// ── BIN-622: GameManagement CRUD wire schemas ───────────────────────────────
// Admin-router eier validering mot eksisterende DomainError-flyt, men vi
// eksporterer zod-skjemaene så admin-UI kan dele runtime-kontrakten (samme
// mønster som PlayerSchema/TicketSchema over). Felter speiler migration
// `20260419000000_game_management.sql` + GameManagementRow i admin-web.

const GameManagementStatus = z.enum(["active", "running", "closed", "inactive"]);
const GameManagementTicketType = z.enum(["Large", "Small"]);

export const GameManagementRowSchema = z.object({
  id: z.string().min(1),
  gameTypeId: z.string().min(1),
  parentId: z.string().nullable().optional(),
  name: z.string().min(1).max(200),
  ticketType: GameManagementTicketType.nullable(),
  /** Ticket price in smallest currency unit (øre). */
  ticketPrice: z.number().int().nonnegative(),
  startDate: IsoDateString,
  endDate: IsoDateString.nullable().optional(),
  status: GameManagementStatus,
  totalSold: z.number().int().nonnegative(),
  totalEarning: z.number().int().nonnegative(),
  config: z.record(z.string(), z.unknown()),
  repeatedFromId: z.string().nullable().optional(),
  createdBy: z.string().nullable().optional(),
  createdAt: IsoDateString,
  updatedAt: IsoDateString,
});
export type GameManagementRow = z.infer<typeof GameManagementRowSchema>;

export const CreateGameManagementSchema = z.object({
  gameTypeId: z.string().min(1).max(200),
  parentId: z.string().min(1).max(200).nullable().optional(),
  name: z.string().min(1).max(200),
  ticketType: GameManagementTicketType.nullable().optional(),
  ticketPrice: z.number().int().nonnegative().optional(),
  startDate: IsoDateString,
  endDate: IsoDateString.nullable().optional(),
  status: GameManagementStatus.optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});
export type CreateGameManagementInput = z.infer<typeof CreateGameManagementSchema>;

export const UpdateGameManagementSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  ticketType: GameManagementTicketType.nullable().optional(),
  ticketPrice: z.number().int().nonnegative().optional(),
  startDate: IsoDateString.optional(),
  endDate: IsoDateString.nullable().optional(),
  status: GameManagementStatus.optional(),
  parentId: z.string().min(1).max(200).nullable().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  totalSold: z.number().int().nonnegative().optional(),
  totalEarning: z.number().int().nonnegative().optional(),
}).refine((v) => Object.keys(v).length > 0, {
  message: "Ingen endringer oppgitt.",
});
export type UpdateGameManagementInput = z.infer<typeof UpdateGameManagementSchema>;

export const RepeatGameManagementSchema = z.object({
  startDate: IsoDateString,
  endDate: IsoDateString.nullable().optional(),
  /** Optional name override — if null, service appends "(repeat)" to source. */
  name: z.string().min(1).max(200).nullable().optional(),
});
export type RepeatGameManagementInput = z.infer<typeof RepeatGameManagementSchema>;

// ── BIN-626: DailySchedule CRUD wire schemas ────────────────────────────────
// Admin-router eier validering mot DomainError-flyt, men vi eksporterer zod-
// skjemaene så admin-UI kan dele runtime-kontrakten (samme mønster som
// GameManagementRowSchema over). Felter speiler migration
// `20260422000000_daily_schedules.sql` + apps/admin-web/.../DailyScheduleState.ts.

const DailyScheduleStatus = z.enum(["active", "running", "finish", "inactive"]);
const DailyScheduleDay = z.enum([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);

/** Weekday bitmask mon=1..sun=64. 0 = bruk `day`-feltet. */
const WeekDayMask = z.number().int().min(0).max(127);

export const DailyScheduleHallIdsSchema = z.object({
  masterHallId: z.string().min(1).nullable().optional(),
  hallIds: z.array(z.string().min(1)).optional(),
  groupHallIds: z.array(z.string().min(1)).optional(),
});
export type DailyScheduleHallIds = z.infer<typeof DailyScheduleHallIdsSchema>;

/**
 * Sub-game-slot i en plan. Fri-form felter i `extra` siden subgame-
 * normalisering er BIN-621/627. Eksplisitte felter dekker det admin-UI
 * faktisk leser (index, ticketPrice, prizePool, patternId, status).
 */
export const DailyScheduleSubgameSlotSchema = z.object({
  subGameId: z.string().min(1).nullable().optional(),
  index: z.number().int().nonnegative().optional(),
  ticketPrice: z.number().int().nonnegative().optional(),
  prizePool: z.number().int().nonnegative().optional(),
  patternId: z.string().min(1).nullable().optional(),
  status: z.string().optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});
export type DailyScheduleSubgameSlot = z.infer<typeof DailyScheduleSubgameSlotSchema>;

export const DailyScheduleRowSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  gameManagementId: z.string().min(1).nullable(),
  hallId: z.string().min(1).nullable(),
  hallIds: DailyScheduleHallIdsSchema,
  weekDays: WeekDayMask,
  day: DailyScheduleDay.nullable(),
  startDate: IsoDateString,
  endDate: IsoDateString.nullable(),
  startTime: HhMmOrEmpty,
  endTime: HhMmOrEmpty,
  status: DailyScheduleStatus,
  stopGame: z.boolean(),
  specialGame: z.boolean(),
  isSavedGame: z.boolean(),
  isAdminSavedGame: z.boolean(),
  innsatsenSales: z.number().int().nonnegative(),
  subgames: z.array(DailyScheduleSubgameSlotSchema),
  otherData: z.record(z.string(), z.unknown()),
  createdBy: z.string().nullable(),
  createdAt: IsoDateString,
  updatedAt: IsoDateString,
});
export type DailyScheduleRow = z.infer<typeof DailyScheduleRowSchema>;

export const CreateDailyScheduleSchema = z.object({
  name: z.string().min(1).max(200),
  gameManagementId: z.string().min(1).max(200).nullable().optional(),
  hallId: z.string().min(1).max(200).nullable().optional(),
  hallIds: DailyScheduleHallIdsSchema.optional(),
  weekDays: WeekDayMask.optional(),
  day: DailyScheduleDay.nullable().optional(),
  startDate: IsoDateString,
  endDate: IsoDateString.nullable().optional(),
  startTime: HhMmOrEmpty.optional(),
  endTime: HhMmOrEmpty.optional(),
  status: DailyScheduleStatus.optional(),
  stopGame: z.boolean().optional(),
  specialGame: z.boolean().optional(),
  isSavedGame: z.boolean().optional(),
  isAdminSavedGame: z.boolean().optional(),
  subgames: z.array(DailyScheduleSubgameSlotSchema).optional(),
  otherData: z.record(z.string(), z.unknown()).optional(),
});
export type CreateDailyScheduleInput = z.infer<typeof CreateDailyScheduleSchema>;

/**
 * Special-schedule — alias for create() med specialGame=true og typisk
 * hallIds-multi-hall-oppsett. Service normaliserer felter.
 */
export const CreateSpecialDailyScheduleSchema = CreateDailyScheduleSchema.extend({
  specialGame: z.literal(true).optional(),
});
export type CreateSpecialDailyScheduleInput = z.infer<typeof CreateSpecialDailyScheduleSchema>;

export const UpdateDailyScheduleSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  gameManagementId: z.string().min(1).max(200).nullable().optional(),
  hallId: z.string().min(1).max(200).nullable().optional(),
  hallIds: DailyScheduleHallIdsSchema.optional(),
  weekDays: WeekDayMask.optional(),
  day: DailyScheduleDay.nullable().optional(),
  startDate: IsoDateString.optional(),
  endDate: IsoDateString.nullable().optional(),
  startTime: HhMmOrEmpty.optional(),
  endTime: HhMmOrEmpty.optional(),
  status: DailyScheduleStatus.optional(),
  stopGame: z.boolean().optional(),
  specialGame: z.boolean().optional(),
  isSavedGame: z.boolean().optional(),
  isAdminSavedGame: z.boolean().optional(),
  innsatsenSales: z.number().int().nonnegative().optional(),
  subgames: z.array(DailyScheduleSubgameSlotSchema).optional(),
  otherData: z.record(z.string(), z.unknown()).optional(),
}).refine((v) => Object.keys(v).length > 0, {
  message: "Ingen endringer oppgitt.",
});
export type UpdateDailyScheduleInput = z.infer<typeof UpdateDailyScheduleSchema>;

/** Detail-response: samme som row + embedded subgame-aggregat for viewSubgame. */
export const DailyScheduleDetailsResponseSchema = z.object({
  schedule: DailyScheduleRowSchema,
  subgames: z.array(DailyScheduleSubgameSlotSchema),
  /** Referanse til GameManagement-rad (name + status) for enkel rendering. */
  gameManagement: z
    .object({
      id: z.string(),
      name: z.string(),
      status: z.enum(["active", "running", "closed", "inactive"]),
      ticketType: z.enum(["Large", "Small"]).nullable(),
      ticketPrice: z.number().int().nonnegative(),
    })
    .nullable(),
});
export type DailyScheduleDetailsResponse = z.infer<typeof DailyScheduleDetailsResponseSchema>;

// ── BIN-627: Pattern CRUD + dynamic-menu wire schemas ───────────────────────
// Admin-CRUD for bingo-mønstre (25-bit bitmask). Samme PatternMask-type som
// shared-types/game.ts + backend PatternMatcher. Admin-UI editor sender
// mask som integer på wire; legacy-streng-format ("0,1,1...") eksponeres
// ikke lenger (admin-web konverterer via legacyGridToMask/maskToLegacyGrid
// hvis det trengs for rendering).
//
// Felter speiler migration `20260423000000_patterns.sql`. PatternRow i
// apps/admin-web/.../PatternState.ts er kanonisert her.

const PatternStatus = z.enum(["active", "inactive"]);
const PatternClaimType = z.enum(["LINE", "BINGO"]);

/** 25-bit bitmask. 0 ≤ mask < 2^25 = 33554432. */
const PatternMaskSchema = z
  .number()
  .int()
  .min(0)
  .max(33554431);

export const PatternRowSchema = z.object({
  id: z.string().min(1),
  gameTypeId: z.string().min(1),
  gameName: z.string().min(1).max(200),
  patternNumber: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  /** 25-bit bitmask encoding of the 5x5 grid. */
  mask: PatternMaskSchema,
  claimType: PatternClaimType,
  prizePercent: z.number().min(0).max(100),
  orderIndex: z.number().int().nonnegative(),
  design: z.number().int().nonnegative(),
  status: PatternStatus,
  /** Legacy Game 1 optional flags — default false. */
  isWoF: z.boolean(),
  isTchest: z.boolean(),
  isMys: z.boolean(),
  isRowPr: z.boolean(),
  rowPercentage: z.number().nonnegative(),
  isJackpot: z.boolean(),
  isGameTypeExtra: z.boolean(),
  isLuckyBonus: z.boolean(),
  /** Legacy pattern-place (Game 3/4 number-range slug, f.eks. "1-15"). */
  patternPlace: z.string().nullable(),
  extra: z.record(z.string(), z.unknown()),
  createdBy: z.string().nullable(),
  createdAt: IsoDateString,
  updatedAt: IsoDateString,
});
export type PatternRow = z.infer<typeof PatternRowSchema>;

export const CreatePatternSchema = z.object({
  gameTypeId: z.string().min(1).max(200),
  /** Display-navn for game (f.eks. "Game1", "Game3"). */
  gameName: z.string().min(1).max(200).optional(),
  /** Auto-genereres av service hvis ikke satt. */
  patternNumber: z.string().min(1).max(200).optional(),
  name: z.string().min(1).max(200),
  mask: PatternMaskSchema,
  claimType: PatternClaimType.optional(),
  prizePercent: z.number().min(0).max(100).optional(),
  orderIndex: z.number().int().nonnegative().optional(),
  design: z.number().int().nonnegative().optional(),
  status: PatternStatus.optional(),
  isWoF: z.boolean().optional(),
  isTchest: z.boolean().optional(),
  isMys: z.boolean().optional(),
  isRowPr: z.boolean().optional(),
  rowPercentage: z.number().nonnegative().optional(),
  isJackpot: z.boolean().optional(),
  isGameTypeExtra: z.boolean().optional(),
  isLuckyBonus: z.boolean().optional(),
  patternPlace: z.string().min(1).max(200).nullable().optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});
export type CreatePatternInput = z.infer<typeof CreatePatternSchema>;

export const UpdatePatternSchema = z.object({
  gameName: z.string().min(1).max(200).optional(),
  patternNumber: z.string().min(1).max(200).optional(),
  name: z.string().min(1).max(200).optional(),
  mask: PatternMaskSchema.optional(),
  claimType: PatternClaimType.optional(),
  prizePercent: z.number().min(0).max(100).optional(),
  orderIndex: z.number().int().nonnegative().optional(),
  design: z.number().int().nonnegative().optional(),
  status: PatternStatus.optional(),
  isWoF: z.boolean().optional(),
  isTchest: z.boolean().optional(),
  isMys: z.boolean().optional(),
  isRowPr: z.boolean().optional(),
  rowPercentage: z.number().nonnegative().optional(),
  isJackpot: z.boolean().optional(),
  isGameTypeExtra: z.boolean().optional(),
  isLuckyBonus: z.boolean().optional(),
  patternPlace: z.string().min(1).max(200).nullable().optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
}).refine((v) => Object.keys(v).length > 0, {
  message: "Ingen endringer oppgitt.",
});
export type UpdatePatternInput = z.infer<typeof UpdatePatternSchema>;

/**
 * Dynamic-menu-entry: ett mønster som en oppføring i admin-UI-dropdown.
 * Sub-menu på gameType (toppnivå) → liste av mønstre sortert etter order_index.
 */
export const PatternDynamicMenuEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  patternNumber: z.string().min(1),
  /** 25-bit bitmask — admin-UI kan tegne preview uten separat fetch. */
  mask: PatternMaskSchema,
  orderIndex: z.number().int().nonnegative(),
  status: PatternStatus,
  claimType: PatternClaimType,
  design: z.number().int().nonnegative(),
});
export type PatternDynamicMenuEntry = z.infer<typeof PatternDynamicMenuEntrySchema>;

export const PatternDynamicMenuResponseSchema = z.object({
  /** GameType slug menuen er for (eller null hvis alle). */
  gameTypeId: z.string().min(1).nullable(),
  /** Ordnet liste av mønstre (aktive først, deretter etter orderIndex). */
  entries: z.array(PatternDynamicMenuEntrySchema),
  /** Totalt antall mønstre (før evt. limit). */
  count: z.number().int().nonnegative(),
});
export type PatternDynamicMenuResponse = z.infer<typeof PatternDynamicMenuResponseSchema>;

// ── BIN-665: HallGroup CRUD wire schemas ────────────────────────────────────
// Admin-CRUD for hall-grupper (cross-hall spill). GroupHall = navngitt
// gruppering av haller som Game 2 + Game 3 bruker for sammenkoblede draws
// mot flere fysiske haller. Legacy Mongo-schema `GroupHall` er normalisert
// til to tabeller: `app_hall_groups` + `app_hall_group_members`.
//
// Felter speiler migration `20260424000000_hall_groups.sql`. HallGroupRow
// i apps/admin-web/.../GroupHallState.ts (PR-A5) skal canonicaliseres hit.

const HallGroupStatus = z.enum(["active", "inactive"]);

/** Medlems-hall representert som minimal oppsummering (id + navn). */
export const HallGroupMemberSchema = z.object({
  hallId: z.string().min(1),
  hallName: z.string().min(1),
  hallStatus: z.string().min(1),
  addedAt: IsoDateString,
});
export type HallGroupMember = z.infer<typeof HallGroupMemberSchema>;

export const HallGroupRowSchema = z.object({
  id: z.string().min(1),
  /** Legacy-format (GH_<timestamp>). Nullable for nye rader. */
  legacyGroupHallId: z.string().nullable(),
  name: z.string().min(1).max(200),
  status: HallGroupStatus,
  /** TV-skjerm-ID (numerisk) — brukes av hall-TV-streaming. */
  tvId: z.number().int().nullable(),
  /** Produkt-ids knyttet til gruppen. Bevart som streng-array. */
  productIds: z.array(z.string().min(1)),
  /** Medlems-haller (denormalisert for admin-UI). */
  members: z.array(HallGroupMemberSchema),
  /** Ekstra fri-form felter (legacy-kompatibilitet). */
  extra: z.record(z.string(), z.unknown()),
  createdBy: z.string().nullable(),
  createdAt: IsoDateString,
  updatedAt: IsoDateString,
});
export type HallGroupRow = z.infer<typeof HallGroupRowSchema>;

export const CreateHallGroupSchema = z.object({
  name: z.string().min(1).max(200),
  /** Liste av hall-ids som skal være medlem av gruppen. Kan være tom. */
  hallIds: z.array(z.string().min(1)).default([]),
  status: HallGroupStatus.optional(),
  tvId: z.number().int().nullable().optional(),
  productIds: z.array(z.string().min(1)).optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});
export type CreateHallGroupInput = z.infer<typeof CreateHallGroupSchema>;

export const UpdateHallGroupSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    /** Erstatter hele medlemsskaps-listen hvis satt. */
    hallIds: z.array(z.string().min(1)).optional(),
    status: HallGroupStatus.optional(),
    tvId: z.number().int().nullable().optional(),
    productIds: z.array(z.string().min(1)).optional(),
    extra: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Ingen endringer oppgitt.",
  });
export type UpdateHallGroupInput = z.infer<typeof UpdateHallGroupSchema>;

/**
 * List-respons med både rader og total-antall. Gjenspeiler hvordan
 * BIN-622/626/627 rapporterer liste-endpoints.
 */
export const HallGroupListResponseSchema = z.object({
  groups: z.array(HallGroupRowSchema),
  count: z.number().int().nonnegative(),
});
export type HallGroupListResponse = z.infer<typeof HallGroupListResponseSchema>;

// ── BIN-620: GameType CRUD wire schemas ────────────────────────────────────
// Admin-CRUD for spill-typer (topp-nivå katalog). Mirror av migration
// `20260425000000_game_types.sql`. GameType-raden er referent fra
// app_game_management, app_patterns, app_sub_games via `type_slug` / id.
//
// Legacy-feltnavn (name, type, pattern, photo, row, columns) bevares i
// admin-web-mapperen — wire-shape bruker camelCase som matcher service-
// interface (GameTypeRow i apps/admin-web/.../common/types.ts når Agent A
// kobler på dette).

const GameTypeStatus = z.enum(["active", "inactive"]);

export const GameTypeRowSchema = z.object({
  id: z.string().min(1),
  /** Stabil slug-id (f.eks. "game_1", "bingo"). Kanonisk referent. */
  typeSlug: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  photo: z.string(),
  pattern: z.boolean(),
  gridRows: z.number().int().positive(),
  gridColumns: z.number().int().positive(),
  rangeMin: z.number().int().nullable(),
  rangeMax: z.number().int().nullable(),
  totalNoTickets: z.number().int().positive().nullable(),
  userMaxTickets: z.number().int().positive().nullable(),
  luckyNumbers: z.array(z.number().int()),
  status: GameTypeStatus,
  extra: z.record(z.string(), z.unknown()),
  createdBy: z.string().nullable(),
  createdAt: IsoDateString,
  updatedAt: IsoDateString,
});
export type GameTypeRow = z.infer<typeof GameTypeRowSchema>;

export const CreateGameTypeSchema = z.object({
  typeSlug: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  photo: z.string().max(500).optional(),
  pattern: z.boolean().optional(),
  gridRows: z.number().int().positive().optional(),
  gridColumns: z.number().int().positive().optional(),
  rangeMin: z.number().int().nullable().optional(),
  rangeMax: z.number().int().nullable().optional(),
  totalNoTickets: z.number().int().positive().nullable().optional(),
  userMaxTickets: z.number().int().positive().nullable().optional(),
  luckyNumbers: z.array(z.number().int()).optional(),
  status: GameTypeStatus.optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});
export type CreateGameTypeInput = z.infer<typeof CreateGameTypeSchema>;

export const UpdateGameTypeSchema = z
  .object({
    typeSlug: z.string().min(1).max(200).optional(),
    name: z.string().min(1).max(200).optional(),
    photo: z.string().max(500).optional(),
    pattern: z.boolean().optional(),
    gridRows: z.number().int().positive().optional(),
    gridColumns: z.number().int().positive().optional(),
    rangeMin: z.number().int().nullable().optional(),
    rangeMax: z.number().int().nullable().optional(),
    totalNoTickets: z.number().int().positive().nullable().optional(),
    userMaxTickets: z.number().int().positive().nullable().optional(),
    luckyNumbers: z.array(z.number().int()).optional(),
    status: GameTypeStatus.optional(),
    extra: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Ingen endringer oppgitt.",
  });
export type UpdateGameTypeInput = z.infer<typeof UpdateGameTypeSchema>;

export const GameTypeListResponseSchema = z.object({
  gameTypes: z.array(GameTypeRowSchema),
  count: z.number().int().nonnegative(),
});
export type GameTypeListResponse = z.infer<typeof GameTypeListResponseSchema>;

// ── BIN-621: SubGame CRUD wire schemas ────────────────────────────────────
// Admin-CRUD for sub-game-maler (navngitte bundles av pattern-ids + ticket-
// farger + status). Mirror av migration `20260425000100_sub_games.sql`.
// En SubGame er en gjenbrukbar oppskrift som admin binder inn i DailySchedule
// .subgames_json — hver plan kan velge å kjøre en SubGame for å få en
// preconfigured kombinasjon av mønstre og farger.
//
// og runtime-state i samme schema. Vi splitter ut: runtime hører til
// app_game_sessions / hall_game_schedules; admin-katalog bor i app_sub_games.

const SubGameStatus = z.enum(["active", "inactive"]);

export const SubGamePatternRefSchema = z.object({
  patternId: z.string().min(1),
  name: z.string().min(1).max(200),
});
export type SubGamePatternRef = z.infer<typeof SubGamePatternRefSchema>;

export const SubGameRowSchema = z.object({
  id: z.string().min(1),
  /** Referent til app_game_types.type_slug (stabil slug). */
  gameTypeId: z.string().min(1),
  /** Display-navn (f.eks. "Game1", "Game3") — ikke unik, kun label. */
  gameName: z.string().min(1).max(200),
  /** Visnings-navn på SubGame-malen (unikt per gameType). */
  name: z.string().min(1).max(200),
  /** Legacy auto-increment nummer (f.eks. "SG_20220919_032458"). */
  subGameNumber: z.string().min(1).max(200),
  patternRows: z.array(SubGamePatternRefSchema),
  ticketColors: z.array(z.string().min(1)),
  status: SubGameStatus,
  extra: z.record(z.string(), z.unknown()),
  createdBy: z.string().nullable(),
  createdAt: IsoDateString,
  updatedAt: IsoDateString,
});
export type SubGameRow = z.infer<typeof SubGameRowSchema>;

export const CreateSubGameSchema = z.object({
  gameTypeId: z.string().min(1).max(200),
  gameName: z.string().min(1).max(200).optional(),
  name: z.string().min(1).max(200),
  /** Auto-genereres av service hvis ikke satt. */
  subGameNumber: z.string().min(1).max(200).optional(),
  patternRows: z.array(SubGamePatternRefSchema).optional(),
  ticketColors: z.array(z.string().min(1)).optional(),
  status: SubGameStatus.optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});
export type CreateSubGameInput = z.infer<typeof CreateSubGameSchema>;

export const UpdateSubGameSchema = z
  .object({
    gameName: z.string().min(1).max(200).optional(),
    name: z.string().min(1).max(200).optional(),
    subGameNumber: z.string().min(1).max(200).optional(),
    patternRows: z.array(SubGamePatternRefSchema).optional(),
    ticketColors: z.array(z.string().min(1)).optional(),
    status: SubGameStatus.optional(),
    extra: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Ingen endringer oppgitt.",
  });
export type UpdateSubGameInput = z.infer<typeof UpdateSubGameSchema>;

export const SubGameListResponseSchema = z.object({
  subGames: z.array(SubGameRowSchema),
  count: z.number().int().nonnegative(),
});
export type SubGameListResponse = z.infer<typeof SubGameListResponseSchema>;

// ── BIN-668: LeaderboardTier CRUD wire schemas ────────────────────────────
// Admin-CRUD for leaderboard-tiers (plass→premie/poeng-mapping). Mirror av
// migration `20260425000400_leaderboard_tiers.sql`. Dette er KONFIGURASJON
// (admin-katalog), ikke runtime-state. Runtime `/api/leaderboard` (i
// apps/backend/src/routes/game.ts) aggregerer poeng fra faktiske wins og er
// urørt av denne tabellen.
//
// tier_name grupperer et sett med rader til en "profil" (f.eks. "default",
// "daily", "vip"). Unik per (tier_name, place) per ikke-slettet rad.

export const LeaderboardTierRowSchema = z.object({
  id: z.string().min(1),
  /** Profil-navn (f.eks. "default", "daily"). Ikke case-sensitive i praksis. */
  tierName: z.string().min(1).max(200),
  /** Plassering (1-basert). Positivt heltall. */
  place: z.number().int().positive(),
  /** Poeng tildelt for plasseringen. Ikke-negativt heltall. */
  points: z.number().int().nonnegative(),
  /** Premie-beløp i NOK. NULL = ingen kontant-premie (kun points). */
  prizeAmount: z.number().nullable(),
  /** Fri-form beskrivelse ("Gavekort 500 kr"). Tom streng hvis ikke satt. */
  prizeDescription: z.string(),
  active: z.boolean(),
  extra: z.record(z.string(), z.unknown()),
  createdByUserId: z.string().nullable(),
  createdAt: IsoDateString,
  updatedAt: IsoDateString,
});
export type LeaderboardTierRow = z.infer<typeof LeaderboardTierRowSchema>;

export const CreateLeaderboardTierSchema = z.object({
  tierName: z.string().min(1).max(200).optional(),
  place: z.number().int().positive(),
  points: z.number().int().nonnegative().optional(),
  prizeAmount: z.number().nonnegative().nullable().optional(),
  prizeDescription: z.string().max(500).optional(),
  active: z.boolean().optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});
export type CreateLeaderboardTierInput = z.infer<typeof CreateLeaderboardTierSchema>;

export const UpdateLeaderboardTierSchema = z
  .object({
    tierName: z.string().min(1).max(200).optional(),
    place: z.number().int().positive().optional(),
    points: z.number().int().nonnegative().optional(),
    prizeAmount: z.number().nonnegative().nullable().optional(),
    prizeDescription: z.string().max(500).optional(),
    active: z.boolean().optional(),
    extra: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Ingen endringer oppgitt.",
  });
export type UpdateLeaderboardTierInput = z.infer<typeof UpdateLeaderboardTierSchema>;

export const LeaderboardTierListResponseSchema = z.object({
  tiers: z.array(LeaderboardTierRowSchema),
  count: z.number().int().nonnegative(),
});
export type LeaderboardTierListResponse = z.infer<
  typeof LeaderboardTierListResponseSchema
>;

// ── BIN-700: Loyalty CRUD + player-state wire schemas ───────────────────────
// Admin-CRUD for tier-hierarkiet (bronze/silver/gold/platinum etc.) + per-
// spiller aggregat (current_tier, lifetime_points, month_points). Mirror av
// migration `20260429000000_loyalty.sql`.
//
// Avgrensning mot BIN-668 (leaderboard_tier): leaderboard-tier er plass-basert
// premie-mapping (runtime wins), loyalty-tier er persistent status basert på
// akkumulert aktivitet. Systemene er uavhengige.

export const LoyaltyTierRowSchema = z.object({
  id: z.string().min(1),
  /** Display-navn ("Bronze", "Silver", "Gold", "Platinum"). Unik. */
  name: z.string().min(1).max(200),
  /** Hierarkisk rang. 1 = laveste. Høyere rank = bedre tier. Unik. */
  rank: z.number().int().positive(),
  /** Inklusiv minimums-grense for å kvalifisere (lifetime_points >= min_points). */
  minPoints: z.number().int().nonnegative(),
  /** Eksklusiv maks-grense. NULL = ingen øvre grense (toppnivå). */
  maxPoints: z.number().int().nullable(),
  /** Fri-form benefits-payload (bonus-prosent, fri-spinn, prioritet). */
  benefits: z.record(z.string(), z.unknown()),
  active: z.boolean(),
  createdByUserId: z.string().nullable(),
  createdAt: IsoDateString,
  updatedAt: IsoDateString,
});
export type LoyaltyTierRow = z.infer<typeof LoyaltyTierRowSchema>;

export const CreateLoyaltyTierSchema = z.object({
  name: z.string().min(1).max(200),
  rank: z.number().int().positive(),
  minPoints: z.number().int().nonnegative().optional(),
  maxPoints: z.number().int().nonnegative().nullable().optional(),
  benefits: z.record(z.string(), z.unknown()).optional(),
  active: z.boolean().optional(),
});
export type CreateLoyaltyTierInput = z.infer<typeof CreateLoyaltyTierSchema>;

export const UpdateLoyaltyTierSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    rank: z.number().int().positive().optional(),
    minPoints: z.number().int().nonnegative().optional(),
    maxPoints: z.number().int().nonnegative().nullable().optional(),
    benefits: z.record(z.string(), z.unknown()).optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Ingen endringer oppgitt.",
  });
export type UpdateLoyaltyTierInput = z.infer<typeof UpdateLoyaltyTierSchema>;

export const LoyaltyTierListResponseSchema = z.object({
  tiers: z.array(LoyaltyTierRowSchema),
  count: z.number().int().nonnegative(),
});
export type LoyaltyTierListResponse = z.infer<typeof LoyaltyTierListResponseSchema>;

// Player-state wire-schema — én rad pr spiller.

export const LoyaltyPlayerStateSchema = z.object({
  userId: z.string().min(1),
  /** Nåværende tier (null før første tildeling). Speiler app_loyalty_tiers-rad. */
  currentTier: LoyaltyTierRowSchema.nullable(),
  lifetimePoints: z.number().int().nonnegative(),
  monthPoints: z.number().int().nonnegative(),
  monthKey: z.string().nullable(),
  /** true hvis admin har låst tier manuelt (bypass automatic assignment). */
  tierLocked: z.boolean(),
  lastUpdatedAt: IsoDateString,
  createdAt: IsoDateString,
});
export type LoyaltyPlayerState = z.infer<typeof LoyaltyPlayerStateSchema>;

export const LoyaltyAwardSchema = z.object({
  pointsDelta: z.number().int(),
  /** Admin-note eller event-kategori ("Bursdag", "Jubileum"). */
  reason: z.string().min(1).max(500),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type LoyaltyAwardInput = z.infer<typeof LoyaltyAwardSchema>;

export const LoyaltyTierOverrideSchema = z.object({
  /** Tier-id. NULL betyr "fjern override" (låser opp så autoassign kan kjøre igjen). */
  tierId: z.string().min(1).nullable(),
  /** Admin-begrunnelse for audit. */
  reason: z.string().min(1).max(500),
});
export type LoyaltyTierOverrideInput = z.infer<typeof LoyaltyTierOverrideSchema>;

export const LoyaltyEventRowSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  eventType: z.string().min(1),
  pointsDelta: z.number().int(),
  metadata: z.record(z.string(), z.unknown()),
  createdByUserId: z.string().nullable(),
  createdAt: IsoDateString,
});
export type LoyaltyEventRow = z.infer<typeof LoyaltyEventRowSchema>;

// ── BIN-624: SavedGame CRUD wire schemas ────────────────────────────────────
// Admin-CRUD for SavedGame-templates (gjenbrukbare GameManagement-oppsett).
// Mirror av migration `20260425000200_saved_games.sql`.
//
// En SavedGame er IKKE et kjørbart spill — det er en template som admin
// lagrer slik at et komplett GameManagement-oppsett (ticket-farger, priser,
// patterns, subgames, halls, days, ...) kan brukes som utgangspunkt for
// et nytt spill via load-to-game-flyten. `config` er en fri-form Record
// siden legacy `savedGame` hadde ~50 felter som varierer per gameType;
// GameManagement-layeret gjør semantisk validering ved load-to-game.
//

const SavedGameStatus = z.enum(["active", "inactive"]);

export const SavedGameRowSchema = z.object({
  id: z.string().min(1),
  /** Referent til app_game_types.type_slug (stabil slug, f.eks. "game_1"). */
  gameTypeId: z.string().min(1),
  /** Display-navn på malen (unik per gameType). */
  name: z.string().min(1).max(200),
  /** Legacy isAdminSave-flag (styrer synlighet i liste-queries). */
  isAdminSave: z.boolean(),
  /** Template-payload (alle legacy savedGame-felter unntatt runtime-state). */
  config: z.record(z.string(), z.unknown()),
  status: SavedGameStatus,
  createdBy: z.string().nullable(),
  createdAt: IsoDateString,
  updatedAt: IsoDateString,
});
export type SavedGameRow = z.infer<typeof SavedGameRowSchema>;

export const CreateSavedGameSchema = z.object({
  gameTypeId: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  isAdminSave: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  status: SavedGameStatus.optional(),
});
export type CreateSavedGameInput = z.infer<typeof CreateSavedGameSchema>;

export const UpdateSavedGameSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    isAdminSave: z.boolean().optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    status: SavedGameStatus.optional(),
  })
  .refine((v: Record<string, unknown>) => Object.keys(v).length > 0, {
    message: "Ingen endringer oppgitt.",
  });
export type UpdateSavedGameInput = z.infer<typeof UpdateSavedGameSchema>;

export const SavedGameListResponseSchema = z.object({
  savedGames: z.array(SavedGameRowSchema),
  count: z.number().int().nonnegative(),
});
export type SavedGameListResponse = z.infer<typeof SavedGameListResponseSchema>;

/**
 * Load-to-game-respons: payload klient sender videre til GameManagement.create()
 * (BIN-622). Router returnerer kun data — ingen GameManagement-rad opprettes
 * inline, slik at klient kan justere felter (name, startDate, endDate, halls)
 * før faktisk opprettelse.
 */
export const SavedGameLoadResponseSchema = z.object({
  savedGameId: z.string().min(1),
  gameTypeId: z.string().min(1),
  name: z.string().min(1).max(200),
  config: z.record(z.string(), z.unknown()),
});
export type SavedGameLoadResponse = z.infer<typeof SavedGameLoadResponseSchema>;

// ── BIN-625: Schedule CRUD wire schemas ───────────────────────────────────
// Admin-CRUD for Schedule-maler (gjenbrukbare spill-oppskrifter). Distinct
// fra DailySchedule (BIN-626) som er kalender-rader. Mirror av migration
// `20260425000300_schedules.sql`.
//
// "schedules"-kolleksjonen med scheduleName, scheduleType (Auto|Manual),
// subGames[] og Innsatsen-spesifikke felter (luckyNumberPrize,
// ticketColorTypePrice m.fl. innenfor subGames).

const ScheduleType = z.enum(["Auto", "Manual"]);
const ScheduleStatus = z.enum(["active", "inactive"]);

/**
 * Spill 1 legacy-paritet override-slots — audit 2026-04-30.
 *
 * Tre prize-slots fra legacy-schedule-snapshots har ingen typed kolonne:
 * 1. **Tv Extra**: `Yellow.Picture` (500), `Yellow.Frame` (1000)
 * 2. **Oddsen 56**: `Yellow/White."Full House Within 56 Balls"` (3000/1500)
 * 3. **Spillerness Spill 2**: `minimumPrize` (100)
 *
 * Disse persisteres her slik at variant-mapperen leser override-først,
 * fallback til `SPILL1_SUB_VARIANT_DEFAULTS`. Manglende felt → defaults.
 *
 * Alle felt optional (typed `.optional()`) så eksisterende schedules uten
 * `spill1Overrides` fortsetter å fungere uten endringer.
 *
 * @audit docs/legacy-snapshots/2026-04-30/SPILL1_GAP_AUDIT.md (PR #748)
 */
export const Spill1OverridesSchema = z.object({
  /**
   * Tv Extra prize-slots (legacy `prizes.Yellow.{Picture,Frame,Full House}`).
   * Default-verdier (når omitted): picture=500, frame=1000, fullHouse=3000.
   * Verdier i kr (heltall, ≥ 0).
   */
  tvExtra: z
    .object({
      pictureYellow: z.number().int().nonnegative().optional(),
      frameYellow: z.number().int().nonnegative().optional(),
      fullHouseYellow: z.number().int().nonnegative().optional(),
    })
    .optional(),
  /**
   * Oddsen 56 pot-størrelser (legacy `prizes.{Yellow,White}."Full House
   * Within 56 Balls"`). Mappes til `OddsenConfig.{potLargeNok,potSmallNok}`
   * ved spawn til `app_game1_scheduled_games.game_config_json`.
   * Yellow = large-ticket-pot (default 3000), White = small-ticket-pot
   * (default 1500). Verdier i kr (heltall, ≥ 0).
   */
  oddsen56: z
    .object({
      fullHouseWithin56Yellow: z.number().int().nonnegative().optional(),
      fullHouseWithin56White: z.number().int().nonnegative().optional(),
    })
    .optional(),
  /**
   * Spillerness Spill 2 phase-1-gulv (legacy `subGames[N].fields.minimumPrize`).
   * Mappes til `PatternConfig.minPrize` på fase-1-pattern (cascade-base).
   * Default (når omitted): 50. Verdi i kr (heltall, ≥ 0).
   */
  spillerness2: z
    .object({
      minimumPrize: z.number().int().nonnegative().optional(),
    })
    .optional(),
});
export type Spill1Overrides = z.infer<typeof Spill1OverridesSchema>;

/**
 * Fri-form subgame-slot. Feltene matcher legacy scheduleController.
 * createSchedulePostData. Ukjente felter bevares via `extra` inntil
 * BIN-621 normaliserer subgame-katalogen.
 */
export const ScheduleSubgameSchema = z.object({
  name: z.string().optional(),
  customGameName: z.string().optional(),
  startTime: HhMmOrEmpty.optional(),
  endTime: HhMmOrEmpty.optional(),
  notificationStartTime: z.string().optional(),
  minseconds: z.number().int().nonnegative().optional(),
  maxseconds: z.number().int().nonnegative().optional(),
  seconds: z.number().int().nonnegative().optional(),
  ticketTypesData: z.record(z.string(), z.unknown()).optional(),
  jackpotData: z.record(z.string(), z.unknown()).optional(),
  elvisData: z.record(z.string(), z.unknown()).optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
  /**
   * feat/schedule-8-colors-mystery: Sub-game-type-diskriminant.
   * "STANDARD" (default) = pattern + ticket-colors; "MYSTERY" =
   * Mystery Game-sub-game med priceOptions i `extra.mysteryConfig`.
   */
  subGameType: z.enum(["STANDARD", "MYSTERY"]).optional(),
  /**
   * Audit 2026-04-30: Legacy-paritet override-felter for Tv Extra,
   * Oddsen 56 og Spillerness Spill 2. Optional — manglende felt →
   * `SPILL1_SUB_VARIANT_DEFAULTS` brukes som fallback.
   */
  spill1Overrides: Spill1OverridesSchema.optional(),
});
export type ScheduleSubgame = z.infer<typeof ScheduleSubgameSchema>;

export const ScheduleRowSchema = z.object({
  id: z.string().min(1),
  scheduleName: z.string().min(1).max(200),
  /** Auto-generert legacy-stil SID_YYYYMMDD_HHMMSS_… unik. */
  scheduleNumber: z.string().min(1).max(200),
  scheduleType: ScheduleType,
  luckyNumberPrize: z.number().int().nonnegative(),
  status: ScheduleStatus,
  isAdminSchedule: z.boolean(),
  manualStartTime: HhMmOrEmpty,
  manualEndTime: HhMmOrEmpty,
  subGames: z.array(ScheduleSubgameSchema),
  createdBy: z.string().nullable(),
  createdAt: IsoDateString,
  updatedAt: IsoDateString,
});
export type ScheduleRow = z.infer<typeof ScheduleRowSchema>;

export const CreateScheduleSchema = z.object({
  scheduleName: z.string().min(1).max(200),
  /** Auto-genereres av service hvis ikke satt. */
  scheduleNumber: z.string().min(1).max(200).optional(),
  scheduleType: ScheduleType.optional(),
  luckyNumberPrize: z.number().int().nonnegative().optional(),
  status: ScheduleStatus.optional(),
  isAdminSchedule: z.boolean().optional(),
  manualStartTime: HhMmOrEmpty.optional(),
  manualEndTime: HhMmOrEmpty.optional(),
  subGames: z.array(ScheduleSubgameSchema).optional(),
});
export type CreateScheduleInput = z.infer<typeof CreateScheduleSchema>;

export const UpdateScheduleSchema = z
  .object({
    scheduleName: z.string().min(1).max(200).optional(),
    scheduleType: ScheduleType.optional(),
    luckyNumberPrize: z.number().int().nonnegative().optional(),
    status: ScheduleStatus.optional(),
    manualStartTime: HhMmOrEmpty.optional(),
    manualEndTime: HhMmOrEmpty.optional(),
    subGames: z.array(ScheduleSubgameSchema).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Ingen endringer oppgitt.",
  });
export type UpdateScheduleInput = z.infer<typeof UpdateScheduleSchema>;

export const ScheduleListResponseSchema = z.object({
  schedules: z.array(ScheduleRowSchema),
  count: z.number().int().nonnegative(),
});
export type ScheduleListResponse = z.infer<typeof ScheduleListResponseSchema>;
