/**
 * BIN-641: admin check-bingo for fysiske papirbilletter.
 *
 *   POST /api/admin/physical-tickets/:uniqueId/check-bingo
 *
 * En agent scanner eller taster inn unique-ID + tallene som er printet på
 * papirbillongen. Backend sammenligner mot game-state (drawnNumbers) og
 * returnerer om billetten har vunnet et mønster (Row 1-4 / Full House).
 *
 * Endepunktet er **read-only** — det verken endrer billett-status, logger
 * audit-event eller utbetaler premie. Cashout er eget endepunkt (BIN-640).
 * Derav samme mønster som `POST /api/admin/unique-ids/check` (BIN-587 B4b)
 * og `GET /api/admin/unique-ids/:uniqueId/transactions`.
 *
 * **Hvorfor numbers[] kommer i body**: Det nye backend-skjemaet
 * (`app_physical_tickets`, migrasjon 20260418230000) persisterer IKKE
 * ticket-tallene — kun unique-ID, batch, status og salgs-metadata. Tallene
 * er kun på selve papiret og leses av agentens scanner. Legacy-skjemaet
 * (staticPhysicalTicket.tickets) lagret tallene, men det er ikke portert
 * — regulatorisk audit bekrefter at papir er kanonisk kilde. Derfor krever
 * endepunktet at innsenderen (scanner/POS) sender tallene inn.
 *
 * Mønstergjenkjenning gjenbruker `PatternMatcher.ts` (BIN-615 / PR-C3)
 * 25-bit bitmask-maskene — samme logikk som brukes i alle G1-spill-engines
 * (ROW_1_MASKS..ROW_4_MASKS + FULL_HOUSE_MASK).
 *
 * Scope: kun 5×5 Bingo75-format (Game 1 — kanonisk papirbillett-spillet).
 * Game 2 (3×3) og Databingo60 (3×5) har egne cashout-paths og deler ikke
 * denne endepunkt-flowen; derav avviser vi numbers.length !== 25.
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
import {
  ROW_1_MASKS,
  ROW_2_MASKS,
  ROW_3_MASKS,
  ROW_4_MASKS,
  FULL_HOUSE_MASK,
  matchesAny,
  matchesPattern,
} from "../game/PatternMatcher.js";

export type CheckBingoWinningPattern =
  | "row_1"
  | "row_2"
  | "row_3"
  | "row_4"
  | "full_house";

export interface AdminPhysicalTicketCheckBingoDeps {
  platformService: PlatformService;
  physicalTicketService: PhysicalTicketService;
  engine: BingoEngine;
}

/** Bingo75-papirbillett har alltid 25 tall (5×5-grid, senter = 0/free). */
const BINGO75_TICKET_SIZE = 25;

/** Maks draws vi aksepterer i game-state — beskyttelse mot ødelagt state. */
const MAX_DRAWN_NUMBERS = 90;

interface CheckBingoGameContext {
  gameId: string;
  drawnNumbers: number[];
  /** "RUNNING" | "ENDED" | "WAITING" fra RoomSnapshot — callers kan vise status. */
  gameStatus: string;
}

/**
 * Sjekker **hele** rom-state (alle rom, både currentGame + gameHistory) for
 * et spesifikt gameId. Bruker `listRoomSummaries`/`getRoomSnapshot` som er
 * den offentlige API'en på BingoEngine — dette er samme mønster som
 * admin-dashboard + display-sockets bruker (apps/backend/src/routes/admin.ts:941).
 *
 * Returner null hvis gameId ikke er kjent — kaller oversetter til
 * DomainError `GAME_NOT_FOUND`. Vi slår IKKE sammen med "spillet er over" —
 * historikk-game har drawnNumbers bevart i snapshot, og check-bingo er
 * eksplisitt en retro-sjekk (agent kan dobbelt-verifisere etter at spillet
 * ble avsluttet, særlig for unclaimed winners).
 */
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

/** Parse + valider numbers[] fra request body. Krever eksakt 25 heltall. */
function parseTicketNumbers(raw: unknown): number[] {
  if (!Array.isArray(raw)) {
    throw new DomainError("INVALID_INPUT", "numbers må være en array med 25 heltall.");
  }
  if (raw.length !== BINGO75_TICKET_SIZE) {
    throw new DomainError(
      "INVALID_INPUT",
      `numbers må inneholde nøyaktig ${BINGO75_TICKET_SIZE} verdier (5×5-grid). Fikk ${raw.length}.`
    );
  }
  const out: number[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const v = raw[i];
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 75) {
      throw new DomainError(
        "INVALID_INPUT",
        `numbers[${i}] må være et heltall i [0, 75] (0 = free-centre). Fikk ${String(v)}.`
      );
    }
    out.push(n);
  }
  // Senter (index 12, rad 2 kol 2) må være 0 (free-centre for Bingo75).
  // Ikke-fatal hvis scanner sendte noe annet — vi tolker ikke-null sentere
  // som normal-celle og sjekker mot drawn på vanlig vis.
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

/**
 * Returner høyeste vinnende mønster (Full House > Row 4 > Row 3 > Row 2 > Row 1)
 * eller null hvis ingen match. Vi velger den **høyeste** tier fordi det er
 * den største premien — legacy `agentGameCheckBingo` matcher mot
 * `currentPattern` (dagens aktive fase), men admin check-bingo kan brukes
 * retrospektivt etter at spillet er over, og da er den høyeste tier som
 * billetten dekker den relevante utbetalingen.
 */
function pickWinningPattern(mask: number): CheckBingoWinningPattern | null {
  if (matchesPattern(mask, FULL_HOUSE_MASK)) return "full_house";
  if (matchesAny(mask, ROW_4_MASKS)) return "row_4";
  if (matchesAny(mask, ROW_3_MASKS)) return "row_3";
  if (matchesAny(mask, ROW_2_MASKS)) return "row_2";
  if (matchesAny(mask, ROW_1_MASKS)) return "row_1";
  return null;
}

/**
 * Returner alle tall på billetten som faktisk er drawn (inkluderer ikke
 * free-centre 0 — bare faktiske trekkede tall). Brukes for klient-UI som
 * highlighter trekkede baller på papirbillett-visualiseringen.
 */
function collectMatchedNumbers(numbers: number[], drawn: Set<number>): number[] {
  const matched: number[] = [];
  for (const n of numbers) {
    if (n > 0 && drawn.has(n)) matched.push(n);
  }
  return matched;
}

/** BIN-698: sammenligner to number-arrays element-for-element. */
function arraysEqual(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function createAdminPhysicalTicketCheckBingoRouter(
  deps: AdminPhysicalTicketCheckBingoDeps
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

  router.post("/api/admin/physical-tickets/:uniqueId/check-bingo", async (req, res) => {
    try {
      // Samme permission som øvrige physical-ticket-endepunkter (BIN-587 B4a/B4b).
      // SUPPORT bevisst utelatt — papirbillett-domene er hall-operativ.
      const actor = await requirePermission(req, "PHYSICAL_TICKET_WRITE");

      const uniqueId = mustBeNonEmptyString(req.params.uniqueId, "uniqueId");

      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const gameId = mustBeNonEmptyString(req.body.gameId, "gameId");
      const numbers = parseTicketNumbers(req.body.numbers);

      // 1) Finn papirbilletten i DB.
      const ticket = await physicalTicketService.findByUniqueId(uniqueId);
      if (!ticket) {
        throw new DomainError("PHYSICAL_TICKET_NOT_FOUND", "Billetten finnes ikke.");
      }

      // 2) Hall-scope — HALL_OPERATOR kan bare sjekke egen halls billetter.
      assertUserHallScope(actor, ticket.hallId);

      // 3) Status-guards. VOIDED aldri utbetalbar; UNSOLD heller ikke.
      if (ticket.status === "VOIDED") {
        throw new DomainError("PHYSICAL_TICKET_VOIDED", "Billetten er annullert.");
      }
      if (ticket.status !== "SOLD") {
        throw new DomainError(
          "PHYSICAL_TICKET_NOT_SOLD",
          `Billetten har status ${ticket.status} — kun solgte billetter kan sjekkes for bingo.`
        );
      }

      // 4) Verifiser at billetten faktisk er knyttet til oppgitt gameId.
      //    Dette beskytter mot agent som scanner en billett mot feil game
      //    (f.eks. tidligere game-runde i samme hall) — og gir tydelig
      //    error til UI.
      if (!ticket.assignedGameId) {
        throw new DomainError(
          "PHYSICAL_TICKET_NOT_ASSIGNED",
          "Billetten er ikke knyttet til noe spill."
        );
      }
      if (ticket.assignedGameId !== gameId) {
        throw new DomainError(
          "PHYSICAL_TICKET_WRONG_GAME",
          `Billetten er knyttet til et annet spill (${ticket.assignedGameId}).`
        );
      }

      // 5) Hent game-state (drawnNumbers). Hvis gameId ikke er kjent i
      //    engine (rom er slettet / ikke-eksisterende), feiler vi tydelig.
      const gameCtx = findGameContext(engine, gameId);
      if (!gameCtx) {
        throw new DomainError("GAME_NOT_FOUND", "Spillet finnes ikke eller er ryddet bort.");
      }
      if (gameCtx.drawnNumbers.length > MAX_DRAWN_NUMBERS) {
        // Defense-in-depth: state-korrupsjon skal ikke gi silent pass.
        throw new DomainError(
          "GAME_STATE_INVALID",
          `Spillet har ${gameCtx.drawnNumbers.length} trekk — over tak (${MAX_DRAWN_NUMBERS}).`
        );
      }

      const drawnSet = new Set<number>(gameCtx.drawnNumbers);

      // BIN-698: Idempotens-håndtering. Hvis billetten allerede er stemplet
      // (numbers_json satt), verifiserer vi at klientens numbers[] matcher
      // det som ligger lagret. Divergens => NUMBERS_MISMATCH (svindel-sikring:
      // agenten kan ikke "finne opp" nye tall for samme billett).
      let effectiveNumbers = numbers;
      let cachedPatternWon: CheckBingoWinningPattern | null = null;
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
      const computedPattern = pickWinningPattern(ticketMask);
      const matchedNumbers = collectMatchedNumbers(effectiveNumbers, drawnSet);

      // BIN-698: Hvis billetten ikke er stemplet fra før, stamp vinn-data
      // atomisk. Vi stamper ALLTID etter første check (selv "tapte" — pattern
      // kan være null — slik at idempotensen er entydig: numbers_json satt
      // ⇔ stemplet). BIN-639 (PR 2) filtrerer videre på won_amount_cents > 0.
      let stampedTicket = ticket;
      if (!wasAlreadyStamped) {
        stampedTicket = await physicalTicketService.stampWinData({
          uniqueId: ticket.uniqueId,
          numbers: effectiveNumbers,
          patternWon: computedPattern,
        });
      }

      const finalPattern = wasAlreadyStamped ? cachedPatternWon : computedPattern;

      apiSuccess(res, {
        uniqueId: ticket.uniqueId,
        gameId,
        gameStatus: gameCtx.gameStatus,
        hasWon: finalPattern !== null,
        winningPattern: finalPattern,
        matchedNumbers,
        drawnNumbersCount: gameCtx.drawnNumbers.length,
        // payoutEligible skiller seg fra hasWon kun ved fremtidige flagg
        // (f.eks. "ticket.cashedOut"). I dagens skjema mangler vi den
        // kolonnen, så payoutEligible === hasWon. BIN-640 cashout-endepunkt
        // kan innføre egen cashedOut-state senere uten å bryte kontrakten.
        payoutEligible: finalPattern !== null,
        // BIN-698: observability — tillater admin-UI å vise "sjekket tidligere
        // i dag" og skjule re-stamp-knapp.
        alreadyEvaluated: wasAlreadyStamped,
        evaluatedAt: stampedTicket.evaluatedAt,
        // Stamplet win-amount (NULL i PR 1; BIN-639 setter når admin
        // distribuerer).
        wonAmountCents: stampedTicket.wonAmountCents,
        isWinningDistributed: stampedTicket.isWinningDistributed,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
