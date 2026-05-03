import { randomInt } from "node:crypto";
import type { Ticket } from "./types.js";
import { DomainError } from "../errors/DomainError.js";
import { buildTicketMaskFromGrid5x5 } from "@spillorama/shared-types/spill1-patterns";

const BOARD_ROWS = 3;
const BOARD_COLS = 5;

function shuffle<T>(values: T[]): T[] {
  const arr = [...values];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function pickUniqueInRange(start: number, end: number, count: number): number[] {
  const values = Array.from({ length: end - start + 1 }, (_, i) => start + i);
  return shuffle(values).slice(0, count).sort((a, b) => a - b);
}

export function makeRoomCode(existingCodes: Set<string>): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  while (true) {
    const code = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join("");
    if (!existingCodes.has(code)) {
      return code;
    }
  }
}

export function makeShuffledBallBag(maxNumber = 60): number[] {
  return shuffle(Array.from({ length: maxNumber }, (_, i) => i + 1));
}

/**
 * Generate a standard 75-ball bingo ticket (5×5 grid, free center).
 * Columns: B(1-15), I(16-30), N(31-45), G(46-60), O(61-75).
 * Center cell (row 2, col 2) is 0 (free space).
 *
 * @param color  Display color name for the client, e.g. "Small Yellow", "Elvis 1".
 * @param type   Ticket type code for variant logic, e.g. "small", "large", "elvis".
 */

/**
 * Game slugs that use the 75-ball / 5x5 ticket format with free centre cell.
 * Single source of truth — referenced by every site that picks ticket format,
 * so the choice can never drift out of sync.
 *
 * Game 1 ("bingo") is the canonical 75-ball game. The "game_1" alias is kept
 * because some legacy callers send the numeric form.
 */
export const BINGO75_SLUGS: ReadonlySet<string> = new Set(["bingo", "game_1"]);

/** BIN-615 / PR-C2: Game slugs that use 3×3 1..21 tickets (Tallspill / Spill 2). */
export const GAME2_SLUGS: ReadonlySet<string> = new Set(["game_2", "rocket", "tallspill"]);

/**
 * 2026-05-03 (Tobias direktiv): Game 3 (Mønsterbingo / Spill 3) bruker nå
 * **3×3 / 1..21**-bonger — samme runtime-mekanikk som Spill 2 men med Spill 1's
 * visuelle stil. Hybrid: Spill 2's tickets/draws/ball-range + Spill 1's design.
 *
 * Tidligere (BIN-615 / PR-C3, 2026-04-23): Game 3 brukte 5×5 / 1..75 uten fri
 * sentercelle. Den varianten er nå **deprecated** for `monsterbingo`-slug men
 * `generate5x5NoCenterTicket` beholdes som dead code i tilfelle Tobias
 * ombestemmer seg eller vi får et nytt 5×5-spill senere.
 *
 * `mønsterbingo` (med ø) er admin-UI-skrivemåten; `game_3` er legacy-formen.
 *
 * Disse aliasene er sentralt definert her slik at både ticket-generering
 * (`generateTicketForGame`), engine-guards (`Game3Engine.isGame3Round`) og
 * variant-konfig (`getDefaultVariantConfig`) holder samme klassifisering.
 */
export const GAME3_SLUGS: ReadonlySet<string> = new Set([
  "monsterbingo",
  "mønsterbingo",
  "game_3",
]);

/**
 * BIN-672: Game slugs that explicitly want the 3×5 Databingo60 format.
 * Previously this was the SILENT fallback for any unknown slug — which
 * caused the BIN-619/BIN-671 regression where a missing-gameSlug chain
 * produced 3×5 tickets in a Bingo75 game. Now the fallback throws; only
 * explicit slugs in this set get 3×5.
 *
 * Includes Game 5 (spillorama) which uses slot-style cosmetic tickets
 * and historically relied on the 3×5 fallback. Game 4 (temabingo) is
 * deactivated per BIN-496 and Game 6 (candy) uses an iframe — neither
 * generates tickets via this path.
 */
export const DATABINGO60_SLUGS: ReadonlySet<string> = new Set([
  "databingo",
  "databingo60",
  "bingo60",
  "spillorama",
  "game_5",
  "temabingo",  // Game 4 — deactivated but may still appear in legacy fixtures
]);

/** True if a room/game with this slug should use the 3×5 Databingo60 format. */
export function usesDatabingo60(gameSlug: string | null | undefined): boolean {
  return DATABINGO60_SLUGS.has(gameSlug ?? "");
}

/** True if a room/game with this slug should use the 75-ball / 5x5 format. */
export function uses75Ball(gameSlug: string | null | undefined): boolean {
  return BINGO75_SLUGS.has(gameSlug ?? "");
}

/**
 * True if a room/game with this slug should use the 3×3 / 1..21 format.
 *
 * 2026-05-03: omfatter nå både Spill 2 (`rocket` / `tallspill`) og Spill 3
 * (`monsterbingo` / `mønsterbingo` / `game_3`) — begge spill bruker samme
 * 3×3 1..21-ticket-shape. Differensieringen mellom dem skjer i engine-laget
 * (Game2Engine vs. Game3Engine) og i visuell stil på klienten.
 */
export function uses3x3Ticket(gameSlug: string | null | undefined): boolean {
  const slug = gameSlug ?? "";
  return GAME2_SLUGS.has(slug) || GAME3_SLUGS.has(slug);
}

/**
 * **DEPRECATED 2026-05-03** — Spill 3 (Mønsterbingo) bruker ikke lenger 5×5
 * 1..75-bonger. Denne returnerer nå alltid `false` for kjente Spill 3-slugs.
 *
 * Beholdes som hjelper i tilfelle vi får et nytt 5×5-spill (utenfor Spill
 * 1-3) som trenger samme generator. Alle nåværende kallsteder (engine-
 * guards, integration tests) må migreres til `uses3x3Ticket`.
 *
 * Tidligere kontrakt (BIN-615 / PR-C3, 2026-04-23): true for
 * `monsterbingo` / `mønsterbingo` / `game_3`. Det var korrekt for den gamle
 * 5×5-varianten av Mønsterbingo som nå er erstattet av 3×3 (Tobias-direktiv).
 */
export function uses5x5NoCenterTicket(gameSlug: string | null | undefined): boolean {
  // Eksplisitt tom — alle kjente kallsteder er migrert. Funksjonen beholdes
  // for typescriptual safety (callere som fortsatt importerer den vil få
  // false i stedet for ReferenceError) og for fremtidige 5×5-spill.
  void gameSlug;
  return false;
}

/**
 * Generate a single ticket for the given game slug.
 *
 * - 75-ball games (Game 1 / "bingo"): 5x5 grid with free centre cell.
 * - Game 2 (Tallspill / Spill 2): 3×3 grid with 9 unique picks from 1..21.
 * - Game 3 (Mønsterbingo / Spill 3): 3×3 grid with 9 unique picks from 1..21
 *   (2026-05-03 — Tobias-direktiv: hybrid Spill 2-runtime + Spill 1-stil).
 * - Databingo60: 3x5 grid (explicit opt-in via `databingo` slug).
 *
 * BIN-672: Previously any unknown slug silently fell through to
 * `generateDatabingo60Ticket()` (3×5 Databingo60). That was the root
 * cause of BIN-619/BIN-671 — a missing gameSlug anywhere in the chain
 * quietly produced 3×5 tickets in a Bingo75 game.
 *
 * Now: unknown slugs throw `DomainError("UNKNOWN_GAME_SLUG", ...)`.
 * Fail-loud is the final defense after TypeScript (commit 4) and DB
 * defaults (commit 1-3). If you hit this error, the caller chain has
 * a gap — fix the caller, don't catch the error.
 *
 * Use this everywhere a ticket is created so the format stays consistent
 * with `uses75Ball` / `uses3x3Ticket` / `usesDatabingo60` and the engine's
 * draw-bag selection. `uses3x3Ticket` matches BÅDE Spill 2 og Spill 3 etter
 * 2026-05-03-endringen — engine-laget skiller mellom dem.
 */
export function generateTicketForGame(
  gameSlug: string,
  color?: string,
  type?: string,
): Ticket {
  if (uses3x3Ticket(gameSlug)) return generate3x3Ticket(color, type);
  if (uses75Ball(gameSlug)) return generateBingo75Ticket(color, type);
  if (usesDatabingo60(gameSlug)) return generateDatabingo60Ticket();
  throw new DomainError(
    "UNKNOWN_GAME_SLUG",
    `Kan ikke generere ticket — ukjent gameSlug "${gameSlug}". ` +
      `Kjente slugs: ${[...BINGO75_SLUGS, ...GAME2_SLUGS, ...GAME3_SLUGS, ...DATABINGO60_SLUGS].join(", ")}. ` +
      `Sjekk at caller-kjeden passerer gameSlug fra RoomState.gameSlug (BIN-672).`,
  );
}

export function generateBingo75Ticket(color?: string, type?: string): Ticket {
  const columns = [
    pickUniqueInRange(1, 15, 5),    // B
    pickUniqueInRange(16, 30, 5),   // I
    pickUniqueInRange(31, 45, 5),   // N — one cell will be free
    pickUniqueInRange(46, 60, 5),   // G
    pickUniqueInRange(61, 75, 5),   // O
  ];

  const grid: number[][] = [];
  for (let row = 0; row < 5; row++) {
    const rowValues: number[] = [];
    for (let col = 0; col < 5; col++) {
      // Center cell is free space
      if (row === 2 && col === 2) {
        rowValues.push(0);
      } else {
        rowValues.push(columns[col][row]);
      }
    }
    grid.push(rowValues);
  }

  const ticket: Ticket = { grid };
  if (color) ticket.color = color;
  if (type) ticket.type = type;
  return ticket;
}

/**
 * BIN-615 / PR-C2: Game 2 (Tallspill / Spill 2) ticket — 3×3 grid of 9 unique
 * numbers drawn from 1..21.
 *
 * Legacy ref: Helper/bingo.js:996-1012 (`data.slug == 'game_2'`) — 9 random
 * picks from 1..21 with no column segmentation. No free space.
 *
 * Winner predicate is `hasFull3x3` — there are no line-wins in Game 2, only
 * full-plate (9/9 matched).
 */
export function generate3x3Ticket(color?: string, type?: string): Ticket {
  const picks = pickUniqueInRange(1, 21, 9);
  const grid: number[][] = [
    [picks[0], picks[1], picks[2]],
    [picks[3], picks[4], picks[5]],
    [picks[6], picks[7], picks[8]],
  ];
  const ticket: Ticket = { grid };
  if (color) ticket.color = color;
  if (type) ticket.type = type;
  return ticket;
}

/**
 * **DEPRECATED 2026-05-03** — Spill 3 (Mønsterbingo) bruker ikke lenger denne
 * 5×5-varianten. Beholdt som dead code i tilfelle vi får et nytt 5×5-spill.
 *
 * Tidligere kontrakt (BIN-615 / PR-C3, 2026-04-23): Game 3 (Mønsterbingo)
 * ticket — 5×5 grid of 25 unique numbers in BINGO column ranges (B:1-15,
 * I:16-30, N:31-45, G:46-60, O:61-75). **No free centre cell** — the (2,2)
 * position holds a normal N-column number.
 *
 * Per Tobias-direktiv 2026-05-03 ble Spill 3 portet til 3×3 / 1..21 (samme
 * runtime som Spill 2). Den gamle 5×5-funksjonen returnerer fortsatt et
 * gyldig 5×5-brett dersom kallet eksplisitt rutes hit, men `generateTicketForGame`
 * kaller den IKKE lenger for `monsterbingo`-slug — den ruter via
 * `uses3x3Ticket` til `generate3x3Ticket`.
 */
export function generate5x5NoCenterTicket(color?: string, type?: string): Ticket {
  const columns = [
    pickUniqueInRange(1, 15, 5),   // B
    pickUniqueInRange(16, 30, 5),  // I
    pickUniqueInRange(31, 45, 5),  // N — **no free centre** in Game 3
    pickUniqueInRange(46, 60, 5),  // G
    pickUniqueInRange(61, 75, 5),  // O
  ];

  const grid: number[][] = [];
  for (let row = 0; row < 5; row += 1) {
    const rowValues: number[] = [];
    for (let col = 0; col < 5; col += 1) {
      rowValues.push(columns[col][row]);
    }
    grid.push(rowValues);
  }

  const ticket: Ticket = { grid };
  if (color) ticket.color = color;
  if (type) ticket.type = type;
  return ticket;
}

/**
 * BIN-615 / PR-C2: Full-plate predicate for Game 2 (all 9 cells marked).
 *
 * Legacy ref: Game/Game2/Controllers/GameProcess.js:287-312 — `matched.length > 8`
 * (9 cells matched on a 3×3 ticket).
 */
export function hasFull3x3(ticket: Ticket, marks: Set<number>): boolean {
  if (ticket.grid.length !== 3) return false;
  for (let row = 0; row < 3; row += 1) {
    const cells = ticket.grid[row];
    if (!cells || cells.length !== 3) return false;
    for (let col = 0; col < 3; col += 1) {
      const cell = cells[col];
      if (cell === undefined) return false;
      if (cell !== 0 && !marks.has(cell)) return false;
    }
  }
  return true;
}

export function generateDatabingo60Ticket(): Ticket {
  // Denne varianten bruker 60 baller fordelt på 5 kolonner med 12 tall hver.
  // Frontend expects a 3×5 grid (15 cells) — all cells must contain a number.
  const columns = [
    pickUniqueInRange(1, 12, BOARD_ROWS),
    pickUniqueInRange(13, 24, BOARD_ROWS),
    pickUniqueInRange(25, 36, BOARD_ROWS),
    pickUniqueInRange(37, 48, BOARD_ROWS),
    pickUniqueInRange(49, 60, BOARD_ROWS)
  ];

  const grid: number[][] = [];
  for (let row = 0; row < BOARD_ROWS; row += 1) {
    const rowValues: number[] = [];
    for (let col = 0; col < BOARD_COLS; col += 1) {
      rowValues.push(columns[col][row]);
    }
    grid.push(rowValues);
  }

  return { grid };
}

export function ticketContainsNumber(ticket: Ticket, number: number): boolean {
  return ticket.grid.some((row) => row.includes(number));
}

function isMarked(ticket: Ticket, marks: Set<number>, row: number, col: number): boolean {
  const cell = ticket.grid[row]?.[col];
  if (cell === undefined) {
    return false;
  }
  if (cell === 0) {
    return true;
  }
  return marks.has(cell);
}

export function findFirstCompleteLinePatternIndex(ticket: Ticket, marks: Set<number>): number {
  const rows = ticket.grid.length;
  const cols = ticket.grid[0]?.length ?? 0;

  for (let row = 0; row < rows; row += 1) {
    const complete = Array.from({ length: cols }, (_, col) => isMarked(ticket, marks, row, col)).every(Boolean);
    if (complete) {
      return row;
    }
  }

  for (let col = 0; col < cols; col += 1) {
    const complete = Array.from({ length: rows }, (_, row) => isMarked(ticket, marks, row, col)).every(Boolean);
    if (complete) {
      return rows + col;
    }
  }

  return -1;
}

export function hasAnyCompleteLine(ticket: Ticket, marks: Set<number>): boolean {
  return findFirstCompleteLinePatternIndex(ticket, marks) >= 0;
}

/**
 * BIN-694: Tell antall hele horisontale rader på et brett.
 *
 * Norsk 75-ball bingo (avklart av Tobias 2026-04-20): kun **horisontale
 * rader** og **vertikale kolonner** teller — INGEN diagonaler, uansett
 * fase. Per fase-modell:
 *   - Fase 1 ("1 Rad"):       ≥1 horisontal rad ELLER ≥1 vertikal kolonne
 *   - Fase 2 ("2 Rader"):     ≥2 hele vertikale kolonner
 *   - Fase 3 ("3 Rader"):     ≥3 hele vertikale kolonner
 *   - Fase 4 ("4 Rader"):     ≥4 hele vertikale kolonner
 *   - Fase 5 ("Fullt Hus"):   alle 25 felt (hasFullBingo)
 *
 * Merk navngivingen: "Rad N" i fase-terminologien betyr **N hele
 * vertikale kolonner**, ikke N horisontale rader. Fase 1 er den eneste
 * fasen som godtar en horisontal rad — alle senere faser krever at
 * vinner-brettet har N hele kolonner merket.
 *
 * Gratis-feltet (grid[2][2] === 0) teller alltid som merket.
 */
export function countCompleteRows(ticket: Ticket, marks: Set<number>): number {
  const rows = ticket.grid.length;
  const cols = ticket.grid[0]?.length ?? 0;
  let count = 0;
  for (let row = 0; row < rows; row += 1) {
    let complete = true;
    for (let col = 0; col < cols; col += 1) {
      if (!isMarked(ticket, marks, row, col)) { complete = false; break; }
    }
    if (complete) count += 1;
  }
  return count;
}

/** BIN-694: Tell antall hele vertikale kolonner på et brett. */
export function countCompleteColumns(ticket: Ticket, marks: Set<number>): number {
  const rows = ticket.grid.length;
  const cols = ticket.grid[0]?.length ?? 0;
  let count = 0;
  for (let col = 0; col < cols; col += 1) {
    let complete = true;
    for (let row = 0; row < rows; row += 1) {
      if (!isMarked(ticket, marks, row, col)) { complete = false; break; }
    }
    if (complete) count += 1;
  }
  return count;
}

/**
 * BIN-694: Tell totalt antall hele linjer (rader + kolonner).
 *
 * Bevart for bakoverkompatibilitet og informative logg/UI-visninger,
 * men **vinner-evaluering bruker countCompleteRows + countCompleteColumns
 * separat** fordi fase 2-4 kun godtar kolonner.
 */
export function countCompleteLines(ticket: Ticket, marks: Set<number>): number {
  return countCompleteRows(ticket, marks) + countCompleteColumns(ticket, marks);
}

export function hasFullBingo(ticket: Ticket, marks: Set<number>): boolean {
  for (let row = 0; row < ticket.grid.length; row += 1) {
    for (let col = 0; col < ticket.grid[row].length; col += 1) {
      if (!isMarked(ticket, marks, row, col)) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Bygg 25-bit ticket-mask for et 5×5 brett (Spill 1 Norsk 75-ball).
 * Delegeres til delt `buildTicketMaskFromGrid5x5` i shared-types så
 * backend og klient produserer identisk mask fra samme (grid, marks).
 * Returnerer `null` for ikke-5×5 grids.
 */
export function buildTicketMask5x5(ticket: Ticket, marks: Set<number>): number | null {
  return buildTicketMaskFromGrid5x5(ticket.grid, marks);
}
