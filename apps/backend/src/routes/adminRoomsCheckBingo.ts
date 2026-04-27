/**
 * BIN-FOLLOWUP-13 (minimal stub): admin room-level "Check for Bingo" lookup.
 *
 *   POST /api/admin/rooms/:roomCode/check-bingo
 *   body: { ticketId: string }
 *
 * Wireframe-paritet (PDF 17 §17.16): agenten taster inn billett-nummer, trykker
 * GO og får raskt svar på om billetten er en vinner i nåværende/forrige spill
 * i rommet. Dette er **read-only** og er bevisst smalere enn BIN-641
 * (`/api/admin/physical-tickets/:uniqueId/check-bingo`):
 *
 *   - BIN-641 krever 25 tall fra papir-bongen (kanonisk audit-flyt).
 *   - Denne ruten gjør et raskt oppslag basert på *allerede stemplede* tall
 *     (numbers_json) hvis billetten har vært gjennom check-bingo tidligere.
 *     Den evaluerer ikke nye billetter — agenten må bruke full-side-flyten
 *     (/agent/bingo-check) for det.
 *
 * Returkontrakt:
 *
 *   { found: false }                                       // ticket-ID finnes ikke
 *   { found: true, requiresFullCheck: true, ... }          // ikke evaluert ennå
 *   { found: true, hasWon, winningPattern, ... }           // evaluert tidligere
 *
 * Av samme grunn som BIN-641 stamper vi IKKE billetten her — caller skal bruke
 * full-flyten hvis numbers_json er null. Dette gir agenten en rask "har denne
 * billetten allerede vunnet?"-sjekk uten å introdusere nytt audit-event.
 *
 * Scope: pilot-blokker FOLLOWUP-13. Følges opp av full pattern-popup + Reward
 * All i senere PR.
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { BingoEngine } from "../game/BingoEngine.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { PhysicalTicketService } from "../compliance/PhysicalTicketService.js";
import {
  assertAdminPermission,
  assertUserHallScope,
  type AdminPermission,
} from "../platform/AdminAccessPolicy.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
  isRecordObject,
} from "../util/httpHelpers.js";

export type CheckBingoQuickPattern =
  | "row_1"
  | "row_2"
  | "row_3"
  | "row_4"
  | "full_house";

export interface AdminRoomsCheckBingoDeps {
  platformService: PlatformService;
  physicalTicketService: PhysicalTicketService;
  engine: BingoEngine;
}

interface CheckBingoQuickResponse {
  /** False hvis ticketId ikke finnes i DB. */
  found: boolean;
  /** Hvis found=true: ticketens hall-id (for klient-context). */
  hallId?: string;
  /** Hvis found=true: spillet billetten er knyttet til, hvis noe. */
  gameId?: string | null;
  /** True hvis billetten må gjennom full check-bingo (numbers_json IS NULL). */
  requiresFullCheck?: boolean;
  /** True hvis billetten har vunnet (kun satt ved tidligere evaluering). */
  hasWon?: boolean | null;
  /** Vinnende mønster (kun satt ved tidligere evaluering). */
  winningPattern?: CheckBingoQuickPattern | null;
  /** Cents — kun satt etter at ADMIN/agent har distribuert utbetaling (BIN-639). */
  wonAmountCents?: number | null;
  /** True hvis utbetaling allerede er gjennomført. */
  isWinningDistributed?: boolean;
  /** Tidsstempel for første evaluering. */
  evaluatedAt?: string | null;
  /** Status fra room-snapshot (RUNNING/ENDED/WAITING) — null hvis spillet er borte. */
  gameStatus?: string | null;
  /**
   * 25 tall fra papir-bongen (kun satt når billetten ER stemplet, dvs.
   * `requiresFullCheck=false`). Brukes av PAUSE-modalen i CashInOutPage til
   * å rendre 5×5-grid med pattern-highlight (FOLLOWUP-12, wireframe §17.35).
   * Index 12 (sentercelle) er konvensjonelt frittlagt — verdien kan være `0`
   * eller annet sentinel.
   */
  numbersJson?: number[] | null;
}

export function createAdminRoomsCheckBingoRouter(
  deps: AdminRoomsCheckBingoDeps
): express.Router {
  const { platformService, physicalTicketService, engine } = deps;
  const router = express.Router();

  async function requirePermission(
    req: express.Request,
    permission: AdminPermission
  ): Promise<PublicAppUser> {
    const accessToken = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(accessToken);
    assertAdminPermission(user.role, permission);
    return user;
  }

  router.post("/api/admin/rooms/:roomCode/check-bingo", async (req, res) => {
    try {
      // Samme permission-nivå som physical-ticket check-bingo (BIN-641) — kun
      // ADMIN/HALL_OPERATOR. SUPPORT er bevisst utelatt; dette er hall-operativ
      // funksjonalitet.
      const actor = await requirePermission(req, "PHYSICAL_TICKET_WRITE");

      const roomCode = mustBeNonEmptyString(req.params.roomCode, "roomCode").toUpperCase();

      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const ticketId = mustBeNonEmptyString(req.body.ticketId, "ticketId");

      // 1) Verifiser at rommet finnes (kaster RoomNotFound hvis ikke).
      const snapshot = engine.getRoomSnapshot(roomCode);
      if (snapshot.hallId) {
        // BIN-591 hall-scope: HALL_OPERATOR kan kun sjekke billetter i egen hall.
        assertUserHallScope(actor, snapshot.hallId);
      }

      // 2) Slå opp billett. NOT_FOUND returneres som `{ found: false }` — ikke
      // 404 — slik at klient kan vise en pen "billett finnes ikke"-melding
      // uten å håndtere HTTP-feil. Dette matcher mønsteret i
      // `POST /api/admin/unique-ids/check`.
      const ticket = await physicalTicketService.findByUniqueId(ticketId);
      if (!ticket) {
        const response: CheckBingoQuickResponse = { found: false };
        apiSuccess(res, response);
        return;
      }

      // 3) Hall-scope også på selve billetten (forhindrer cross-hall-leak hvis
      // rom og billett er forskjellige haller).
      assertUserHallScope(actor, ticket.hallId);

      // 4) Hvis billetten ikke er evaluert ennå (numbers_json IS NULL), kan vi
      // ikke svare på "har den vunnet" uten 25 tall fra papiret. Returner
      // requiresFullCheck slik at klienten kan dirigere agenten til
      // full-side-flyten (/agent/bingo-check).
      if (ticket.numbersJson === null) {
        const response: CheckBingoQuickResponse = {
          found: true,
          hallId: ticket.hallId,
          gameId: ticket.assignedGameId,
          requiresFullCheck: true,
          hasWon: null,
          winningPattern: null,
          wonAmountCents: null,
          isWinningDistributed: false,
          evaluatedAt: null,
          gameStatus: ticket.assignedGameId
            ? findGameStatus(engine, roomCode, ticket.assignedGameId)
            : null,
        };
        apiSuccess(res, response);
        return;
      }

      // 5) Billetten ER stemplet — returner cached evalueringsresultat.
      // numbersJson legges på response slik at PAUSE-modalen kan rendre
      // 5×5-grid uten ekstra round-trip (FOLLOWUP-12, wireframe §17.35).
      const response: CheckBingoQuickResponse = {
        found: true,
        hallId: ticket.hallId,
        gameId: ticket.assignedGameId,
        requiresFullCheck: false,
        hasWon: ticket.patternWon !== null,
        winningPattern: ticket.patternWon,
        wonAmountCents: ticket.wonAmountCents,
        isWinningDistributed: ticket.isWinningDistributed,
        evaluatedAt: ticket.evaluatedAt,
        gameStatus: ticket.assignedGameId
          ? findGameStatus(engine, roomCode, ticket.assignedGameId)
          : null,
        numbersJson: ticket.numbersJson,
      };
      apiSuccess(res, response);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}

/**
 * Slå opp game-status fra room-snapshot. Sjekker både currentGame og
 * gameHistory. Returnerer null hvis spillet ikke er kjent (ryddet bort).
 */
function findGameStatus(
  engine: BingoEngine,
  roomCode: string,
  gameId: string
): string | null {
  try {
    const snapshot = engine.getRoomSnapshot(roomCode);
    if (snapshot.currentGame?.id === gameId) {
      return snapshot.currentGame.status;
    }
    for (const historic of snapshot.gameHistory) {
      if (historic.id === gameId) return historic.status;
    }
    return null;
  } catch {
    return null;
  }
}
