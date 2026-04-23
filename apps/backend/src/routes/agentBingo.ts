/**
 * Agent-portal: Check-for-Bingo + Physical Cashout.
 *
 *   POST /api/agent/bingo/check
 *   GET  /api/agent/physical/pending?gameId=
 *   POST /api/agent/physical/reward-all
 *   POST /api/agent/physical/:uniqueId/reward
 *
 * Dette er agent-/bingovert-sidens wrapping av samme domene-logikk som
 * `adminPhysicalTicketCheckBingo` (BIN-641) og `adminPhysicalTicketsRewardAll`
 * (BIN-639). Vi gjenbruker `PhysicalTicketService` og `BingoEngine` direkte.
 *
 * RBAC:
 *   - AGENT (aktiv shift påkrevd) — hall-scope = shift.hallId
 *   - HALL_OPERATOR — hall-scope = user.hallId
 *   - ADMIN — global hall-scope (for support-flyt / feilsøking)
 *
 * AGENT er eksplisitt ikke i `PHYSICAL_TICKET_WRITE`-policyen (den er ADMIN +
 * HALL_OPERATOR). Vi bygger derfor egne agent-routes som gjennomfører egen
 * rolle-sjekk og shift-guard før vi delegerer til service-laget.
 *
 * Pilot-blokker: fysisk cashout + check-for-bingo er P0-funksjonalitet for
 * agent-portalen (Hal V1.0 wireframe + legacy GameController.checkForWinners).
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { BingoEngine } from "../game/BingoEngine.js";
import type { PlatformService, PublicAppUser, UserRole } from "../platform/PlatformService.js";
import type { PhysicalTicketService } from "../compliance/PhysicalTicketService.js";
import type { AgentService } from "../agent/AgentService.js";
import type { AgentShiftService } from "../agent/AgentShiftService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
  isRecordObject,
} from "../util/httpHelpers.js";
import {
  ROW_1_MASKS,
  ROW_2_MASKS,
  ROW_3_MASKS,
  ROW_4_MASKS,
  FULL_HOUSE_MASK,
  matchesAny,
  matchesPattern,
} from "../game/PatternMatcher.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "agent-bingo-router" });

export type AgentCheckBingoWinningPattern =
  | "row_1"
  | "row_2"
  | "row_3"
  | "row_4"
  | "full_house";

export interface AgentBingoRouterDeps {
  platformService: PlatformService;
  physicalTicketService: PhysicalTicketService;
  agentService: AgentService;
  agentShiftService: AgentShiftService;
  auditLogService: AuditLogService;
  engine: BingoEngine;
}

const BINGO75_TICKET_SIZE = 25;
const MAX_DRAWN_NUMBERS = 90;
const MAX_REWARDS_PER_CALL = 5000;

interface AgentActor {
  user: PublicAppUser;
  /** Effektiv hall-scope. AGENT → shift.hallId. HALL_OPERATOR → user.hallId.
   *  ADMIN → null (ikke hall-scoped). */
  hallId: string | null;
  role: UserRole;
}

interface CheckBingoGameContext {
  gameId: string;
  drawnNumbers: number[];
  gameStatus: string;
}

function clientIp(req: express.Request): string | null {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.trim()) return fwd.split(",")[0]!.trim();
  return req.ip ?? null;
}

function userAgentHeader(req: express.Request): string | null {
  const ua = req.headers["user-agent"];
  return typeof ua === "string" && ua.trim() ? ua : null;
}

function actorTypeFromRole(role: UserRole): "ADMIN" | "HALL_OPERATOR" | "AGENT" | "SUPPORT" | "USER" {
  if (role === "ADMIN") return "ADMIN";
  if (role === "HALL_OPERATOR") return "HALL_OPERATOR";
  if (role === "AGENT") return "AGENT";
  if (role === "SUPPORT") return "SUPPORT";
  return "USER";
}

/** Parse + valider numbers[] fra request body. Krever eksakt 25 heltall. */
function parseTicketNumbers(raw: unknown): number[] {
  if (!Array.isArray(raw)) {
    throw new DomainError("INVALID_INPUT", "numbers må være en array med 25 heltall.");
  }
  if (raw.length !== BINGO75_TICKET_SIZE) {
    throw new DomainError(
      "INVALID_INPUT",
      `numbers må inneholde nøyaktig ${BINGO75_TICKET_SIZE} verdier (5×5-grid). Fikk ${raw.length}.`,
    );
  }
  const out: number[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const v = raw[i];
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 75) {
      throw new DomainError(
        "INVALID_INPUT",
        `numbers[${i}] må være et heltall i [0, 75] (0 = free-centre). Fikk ${String(v)}.`,
      );
    }
    out.push(n);
  }
  return out;
}

/** Bygg 25-bit mask: bit i er satt hvis numbers[i] er drawn eller == 0 (free). */
function buildMaskFromNumbers(numbers: number[], drawn: Set<number>): number {
  let mask = 0;
  for (let i = 0; i < BINGO75_TICKET_SIZE; i += 1) {
    const n = numbers[i]!;
    if (n === 0 || drawn.has(n)) {
      mask |= 1 << i;
    }
  }
  return mask;
}

/** Returnerer alle trekte tall i bit-posisjoner (for highlighting). */
function collectMatchedMaskBits(numbers: number[], drawn: Set<number>): number[] {
  const bits: number[] = [];
  for (let i = 0; i < BINGO75_TICKET_SIZE; i += 1) {
    const n = numbers[i]!;
    if (n === 0 || drawn.has(n)) bits.push(i);
  }
  return bits;
}

function pickWinningPattern(mask: number): AgentCheckBingoWinningPattern | null {
  if (matchesPattern(mask, FULL_HOUSE_MASK)) return "full_house";
  if (matchesAny(mask, ROW_4_MASKS)) return "row_4";
  if (matchesAny(mask, ROW_3_MASKS)) return "row_3";
  if (matchesAny(mask, ROW_2_MASKS)) return "row_2";
  if (matchesAny(mask, ROW_1_MASKS)) return "row_1";
  return null;
}

/** Sjekk både current + historic game i alle rom. */
function findGameContext(engine: BingoEngine, gameId: string): CheckBingoGameContext | null {
  for (const summary of engine.listRoomSummaries()) {
    const snapshot = engine.getRoomSnapshot(summary.code);
    const current = snapshot.currentGame;
    if (current && current.id === gameId) {
      return {
        gameId,
        drawnNumbers: [...current.drawnNumbers],
        gameStatus: current.status,
      };
    }
    for (const historic of snapshot.gameHistory) {
      if (historic.id === gameId) {
        return {
          gameId,
          drawnNumbers: [...historic.drawnNumbers],
          gameStatus: historic.status,
        };
      }
    }
  }
  return null;
}

/**
 * Alle vinnende patterns en gitt ticket-mask dekker (ikke bare høyeste).
 * Agent-UI viser "alle mønstre billetten dekker" — ulikt adminCheckBingo som
 * bare returnerer høyeste tier.
 */
function allWinningPatterns(mask: number): AgentCheckBingoWinningPattern[] {
  const out: AgentCheckBingoWinningPattern[] = [];
  if (matchesAny(mask, ROW_1_MASKS)) out.push("row_1");
  if (matchesAny(mask, ROW_2_MASKS)) out.push("row_2");
  if (matchesAny(mask, ROW_3_MASKS)) out.push("row_3");
  if (matchesAny(mask, ROW_4_MASKS)) out.push("row_4");
  if (matchesPattern(mask, FULL_HOUSE_MASK)) out.push("full_house");
  return out;
}

/** BIN-698 idempotens: arrays-equal for numbers_json-sammenligning. */
function arraysEqual(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function createAgentBingoRouter(deps: AgentBingoRouterDeps): express.Router {
  const {
    platformService,
    physicalTicketService,
    agentService,
    agentShiftService,
    auditLogService,
    engine,
  } = deps;
  const router = express.Router();

  /**
   * Les access-token, autoriser AGENT/HALL_OPERATOR/ADMIN, og etabler
   * hall-scope. AGENT må ha aktiv shift (hall-scope = shift.hallId).
   * HALL_OPERATOR må ha tildelt hall. ADMIN har ingen hall-scope.
   */
  async function resolveActor(req: express.Request): Promise<AgentActor> {
    const accessToken = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(accessToken);
    if (user.role === "AGENT") {
      await agentService.requireActiveAgent(user.id);
      const shift = await agentShiftService.getCurrentShift(user.id);
      if (!shift) {
        throw new DomainError(
          "SHIFT_NOT_ACTIVE",
          "Du må starte en shift før du kan sjekke eller utbetale billetter.",
        );
      }
      return { user, hallId: shift.hallId, role: "AGENT" };
    }
    if (user.role === "HALL_OPERATOR") {
      if (!user.hallId) {
        throw new DomainError(
          "FORBIDDEN",
          "Din bruker er ikke tildelt en hall — kontakt admin.",
        );
      }
      return { user, hallId: user.hallId, role: "HALL_OPERATOR" };
    }
    if (user.role === "ADMIN") {
      return { user, hallId: null, role: "ADMIN" };
    }
    throw new DomainError(
      "FORBIDDEN",
      "Kun AGENT, HALL_OPERATOR og ADMIN har tilgang til agent-portalen.",
    );
  }

  /** Håndhev hall-scope: ticket.hallId må matche actor.hallId (ADMIN = null bypasser). */
  function assertActorHallMatch(actor: AgentActor, targetHallId: string): void {
    if (actor.hallId === null) return; // ADMIN globalt
    if (actor.hallId !== targetHallId) {
      throw new DomainError(
        "FORBIDDEN",
        "Du har ikke tilgang til denne hallen.",
      );
    }
  }

  function fireAudit(event: Parameters<AuditLogService["record"]>[0]): void {
    auditLogService.record(event).catch((err) => {
      logger.warn({ err, action: event.action }, "[agent-bingo] audit append failed");
    });
  }

  // ── POST /api/agent/bingo/check ──────────────────────────────────────────
  // Body: { uniqueId, gameId, numbers[25] }
  router.post("/api/agent/bingo/check", async (req, res) => {
    try {
      const actor = await resolveActor(req);
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const uniqueId = mustBeNonEmptyString(req.body.uniqueId, "uniqueId");
      const gameId = mustBeNonEmptyString(req.body.gameId, "gameId");
      const numbers = parseTicketNumbers(req.body.numbers);

      const ticket = await physicalTicketService.findByUniqueId(uniqueId);
      if (!ticket) {
        throw new DomainError("PHYSICAL_TICKET_NOT_FOUND", "Billetten finnes ikke.");
      }
      assertActorHallMatch(actor, ticket.hallId);

      if (ticket.status === "VOIDED") {
        throw new DomainError("PHYSICAL_TICKET_VOIDED", "Billetten er annullert.");
      }
      if (ticket.status !== "SOLD") {
        throw new DomainError(
          "PHYSICAL_TICKET_NOT_SOLD",
          `Billetten har status ${ticket.status} — kun solgte billetter kan sjekkes for bingo.`,
        );
      }

      if (!ticket.assignedGameId) {
        throw new DomainError(
          "PHYSICAL_TICKET_NOT_ASSIGNED",
          "Billetten er ikke knyttet til noe spill.",
        );
      }
      if (ticket.assignedGameId !== gameId) {
        throw new DomainError(
          "PHYSICAL_TICKET_WRONG_GAME",
          `Billetten er knyttet til et annet spill (${ticket.assignedGameId}).`,
        );
      }

      const gameCtx = findGameContext(engine, gameId);
      if (!gameCtx) {
        throw new DomainError("GAME_NOT_FOUND", "Spillet finnes ikke eller er ryddet bort.");
      }
      if (gameCtx.drawnNumbers.length > MAX_DRAWN_NUMBERS) {
        throw new DomainError(
          "GAME_STATE_INVALID",
          `Spillet har ${gameCtx.drawnNumbers.length} trekk — over tak (${MAX_DRAWN_NUMBERS}).`,
        );
      }
      const drawnSet = new Set<number>(gameCtx.drawnNumbers);

      // BIN-698 idempotens-håndtering (samme mønster som adminCheckBingo).
      let effectiveNumbers = numbers;
      let cachedPatternWon: AgentCheckBingoWinningPattern | null = null;
      let wasAlreadyStamped = false;
      if (ticket.numbersJson !== null) {
        wasAlreadyStamped = true;
        if (!arraysEqual(ticket.numbersJson, numbers)) {
          throw new DomainError(
            "NUMBERS_MISMATCH",
            "Billetten er allerede stemplet med andre tall. Sjekk papir-bongen på nytt.",
          );
        }
        effectiveNumbers = ticket.numbersJson;
        cachedPatternWon = ticket.patternWon;
      }

      const ticketMask = buildMaskFromNumbers(effectiveNumbers, drawnSet);
      const topPattern = pickWinningPattern(ticketMask);
      const winningPatterns = allWinningPatterns(ticketMask);
      const matchedCellIndexes = collectMatchedMaskBits(effectiveNumbers, drawnSet);

      let stampedTicket = ticket;
      if (!wasAlreadyStamped) {
        stampedTicket = await physicalTicketService.stampWinData({
          uniqueId: ticket.uniqueId,
          numbers: effectiveNumbers,
          patternWon: topPattern,
        });
      }

      const finalPattern = wasAlreadyStamped ? cachedPatternWon : topPattern;

      // Audit: agent sjekker billett. Dette er read-only i betydning at
      // billetten ikke utbetales, men stamp kan skje så vi logger.
      fireAudit({
        actorId: actor.user.id,
        actorType: actorTypeFromRole(actor.role),
        action: "agent.physical_ticket.check_bingo",
        resource: "physical_ticket",
        resourceId: uniqueId,
        details: {
          uniqueId,
          gameId,
          hasWon: finalPattern !== null,
          winningPattern: finalPattern,
          hallId: ticket.hallId,
          wasAlreadyStamped,
        },
        ipAddress: clientIp(req),
        userAgent: userAgentHeader(req),
      });

      apiSuccess(res, {
        uniqueId: ticket.uniqueId,
        gameId,
        gameStatus: gameCtx.gameStatus,
        hasWon: finalPattern !== null,
        /** Høyeste mønster billetten dekker — matcher adminCheckBingo kontrakten. */
        winningPattern: finalPattern,
        /** Alle mønstre billetten dekker (ikke bare høyeste). Brukes for
         *  Agent-UI sin "Winning Patterns"-liste. */
        winningPatterns,
        /** Index-posisjoner i 5×5-grid (0..24) som er trekt eller free. */
        matchedCellIndexes,
        drawnNumbersCount: gameCtx.drawnNumbers.length,
        payoutEligible: finalPattern !== null && !stampedTicket.isWinningDistributed,
        alreadyEvaluated: wasAlreadyStamped,
        evaluatedAt: stampedTicket.evaluatedAt,
        wonAmountCents: stampedTicket.wonAmountCents,
        isWinningDistributed: stampedTicket.isWinningDistributed,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── GET /api/agent/physical/pending?gameId= ──────────────────────────────
  // Lister SOLD tickets for et gitt spill som er stemplet vinnere og ikke
  // utbetalt. Hall-scope håndheves automatisk.
  router.get("/api/agent/physical/pending", async (req, res) => {
    try {
      const actor = await resolveActor(req);
      const gameId = typeof req.query.gameId === "string" && req.query.gameId.trim()
        ? req.query.gameId.trim()
        : null;
      if (!gameId) {
        throw new DomainError("INVALID_INPUT", "gameId er påkrevd.");
      }
      const tickets = await physicalTicketService.listSoldTicketsForGame(gameId, {
        hallId: actor.hallId ?? undefined,
        limit: 1000,
      });
      // Filtrer til kun stemplede vinnere som ikke er utbetalt.
      const pending = tickets.filter((t) => t.patternWon !== null && !t.isWinningDistributed);
      const rewarded = tickets.filter((t) => t.patternWon !== null && t.isWinningDistributed);
      apiSuccess(res, {
        gameId,
        pending,
        rewarded,
        pendingCount: pending.length,
        rewardedCount: rewarded.length,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── POST /api/agent/physical/reward-all ──────────────────────────────────
  // Body: { gameId, rewards: [{ uniqueId, amountCents }] }
  router.post("/api/agent/physical/reward-all", async (req, res) => {
    try {
      const actor = await resolveActor(req);
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const gameId = mustBeNonEmptyString(req.body.gameId, "gameId");
      const rewardsRaw = req.body.rewards;
      if (!Array.isArray(rewardsRaw)) {
        throw new DomainError("INVALID_INPUT", "rewards må være en array.");
      }
      if (rewardsRaw.length > MAX_REWARDS_PER_CALL) {
        throw new DomainError(
          "INVALID_INPUT",
          `rewards har ${rewardsRaw.length} elementer — over grensen ${MAX_REWARDS_PER_CALL}.`,
        );
      }
      const seen = new Set<string>();
      const rewards: Array<{ uniqueId: string; amountCents: number }> = [];
      for (let i = 0; i < rewardsRaw.length; i += 1) {
        const entry = rewardsRaw[i];
        if (!isRecordObject(entry)) {
          throw new DomainError("INVALID_INPUT", `rewards[${i}] må være et objekt.`);
        }
        const uniqueIdRaw = entry.uniqueId;
        if (typeof uniqueIdRaw !== "string" || !uniqueIdRaw.trim()) {
          throw new DomainError("INVALID_INPUT", `rewards[${i}].uniqueId er påkrevd.`);
        }
        const uniqueId = uniqueIdRaw.trim();
        if (seen.has(uniqueId)) {
          throw new DomainError(
            "INVALID_INPUT",
            `rewards[${i}].uniqueId=${uniqueId} er duplisert i payload.`,
          );
        }
        seen.add(uniqueId);
        const amountRaw = entry.amountCents;
        const amountCents = typeof amountRaw === "number" ? amountRaw : Number(amountRaw);
        if (
          !Number.isFinite(amountCents) ||
          !Number.isInteger(amountCents) ||
          amountCents <= 0
        ) {
          throw new DomainError(
            "INVALID_INPUT",
            `rewards[${i}].amountCents må være et positivt heltall.`,
          );
        }
        rewards.push({ uniqueId, amountCents });
      }

      // Hall-scope pre-sjekk: AGENT/HALL_OPERATOR skal ikke få rørt annen
      // hall's billetter. Vi sjekker før vi sender til service.
      if (actor.hallId !== null && rewards.length > 0) {
        for (const r of rewards) {
          const ticket = await physicalTicketService.findByUniqueId(r.uniqueId);
          if (ticket) {
            assertActorHallMatch(actor, ticket.hallId);
          }
          // Hvis ikke finnes → service-laget gir ticket_not_found i respons.
        }
      }

      const result = await physicalTicketService.rewardAll({
        gameId,
        rewards,
        actorId: actor.user.id,
      });

      const actorType = actorTypeFromRole(actor.role);
      const ip = clientIp(req);
      const ua = userAgentHeader(req);

      for (const detail of result.details) {
        if (detail.status === "rewarded") {
          fireAudit({
            actorId: actor.user.id,
            actorType,
            action: "agent.physical_ticket.reward",
            resource: "physical_ticket",
            resourceId: detail.uniqueId,
            details: {
              uniqueId: detail.uniqueId,
              gameId,
              hallId: detail.hallId ?? null,
              payoutCents: detail.amountCents ?? 0,
              cashoutId: detail.cashoutId ?? null,
              actor: actor.user.id,
            },
            ipAddress: ip,
            userAgent: ua,
          });
        }
      }

      fireAudit({
        actorId: actor.user.id,
        actorType,
        action: "agent.physical_ticket.reward_all",
        resource: "game",
        resourceId: gameId,
        details: {
          gameId,
          rewardedCount: result.rewardedCount,
          totalPayoutCents: result.totalPayoutCents,
          skippedCount: result.skippedCount,
          actor: actor.user.id,
        },
        ipAddress: ip,
        userAgent: ua,
      });

      apiSuccess(res, {
        rewardedCount: result.rewardedCount,
        totalPayoutCents: result.totalPayoutCents,
        skippedCount: result.skippedCount,
        details: result.details,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── POST /api/agent/physical/:uniqueId/reward ────────────────────────────
  // Per-ticket reward. Convenience-wrapper rundt rewardAll for én billett.
  // Body: { gameId, amountCents }
  router.post("/api/agent/physical/:uniqueId/reward", async (req, res) => {
    try {
      const actor = await resolveActor(req);
      const uniqueId = mustBeNonEmptyString(req.params.uniqueId, "uniqueId");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const gameId = mustBeNonEmptyString(req.body.gameId, "gameId");
      const amountRaw = req.body.amountCents;
      const amountCents = typeof amountRaw === "number" ? amountRaw : Number(amountRaw);
      if (
        !Number.isFinite(amountCents) ||
        !Number.isInteger(amountCents) ||
        amountCents <= 0
      ) {
        throw new DomainError(
          "INVALID_INPUT",
          "amountCents må være et positivt heltall.",
        );
      }

      const ticket = await physicalTicketService.findByUniqueId(uniqueId);
      if (!ticket) {
        throw new DomainError("PHYSICAL_TICKET_NOT_FOUND", "Billetten finnes ikke.");
      }
      assertActorHallMatch(actor, ticket.hallId);

      const result = await physicalTicketService.rewardAll({
        gameId,
        rewards: [{ uniqueId, amountCents }],
        actorId: actor.user.id,
      });
      const detail = result.details[0];
      if (!detail) {
        throw new DomainError("INTERNAL_ERROR", "rewardAll returnerte tom respons.");
      }

      const actorType = actorTypeFromRole(actor.role);
      if (detail.status === "rewarded") {
        fireAudit({
          actorId: actor.user.id,
          actorType,
          action: "agent.physical_ticket.reward",
          resource: "physical_ticket",
          resourceId: uniqueId,
          details: {
            uniqueId,
            gameId,
            hallId: detail.hallId ?? null,
            payoutCents: detail.amountCents ?? 0,
            cashoutId: detail.cashoutId ?? null,
            actor: actor.user.id,
          },
          ipAddress: clientIp(req),
          userAgent: userAgentHeader(req),
        });
      }

      apiSuccess(res, {
        uniqueId,
        status: detail.status,
        amountCents: detail.amountCents ?? 0,
        cashoutId: detail.cashoutId ?? null,
        hallId: detail.hallId ?? null,
        message: detail.message ?? null,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
