import { randomInt } from "node:crypto";
import type { Ticket } from "./types.js";
import { DomainError } from "./BingoEngine.js";

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
 * Game 1 ("bingo") is the canonical 75-ball game per Unity reference. The
 * "game_1" alias is kept because some legacy callers send the numeric form.
 */
export const BINGO75_SLUGS: ReadonlySet<string> = new Set(["bingo", "game_1"]);

/** BIN-615 / PR-C2: Game slugs that use 3×3 1..21 tickets (Rocket/Tallspill). */
export const GAME2_SLUGS: ReadonlySet<string> = new Set(["game_2", "rocket", "tallspill"]);

/**
 * BIN-615 / PR-C3: Game slugs that use 5×5 1..75 tickets **without** free centre
 * (Mønsterbingo / Game 3).
 *
 * Legacy ref: `Helper/bingo.js:1014-1031` — `data.slug == 'game_3'` produces a
 * flat array of 25 unique numbers per BINGO column (no free space). The slug
 * `monsterbingo` is the canonical Norwegian name; `mønsterbingo` (with ø) is
 * accepted as an alias because the admin UI may surface the native spelling.
 * Legacy uses `slug: 'game_3'` (see gamehelper/game3.js:109).
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

/** True if a room/game with this slug should use the 3×3 / 1..21 format (Game 2). */
export function uses3x3Ticket(gameSlug: string | null | undefined): boolean {
  return GAME2_SLUGS.has(gameSlug ?? "");
}

/**
 * BIN-615 / PR-C3: True if a room/game with this slug should use the 5×5 1..75
 * format **without** free centre cell (Game 3 / Mønsterbingo). Distinct from
 * `uses75Ball` because Game 1 has a free centre and Game 3 does not.
 */
export function uses5x5NoCenterTicket(gameSlug: string | null | undefined): boolean {
  return GAME3_SLUGS.has(gameSlug ?? "");
}

/**
 * Generate a single ticket for the given game slug.
 *
 * - 75-ball games (Game 1 / "bingo"): 5x5 grid with free centre cell.
 * - Game 2 (Rocket/Tallspill): 3×3 grid with 9 unique picks from 1..21.
 * - Game 3 (Mønsterbingo): 5x5 grid with 25 unique picks from 1..75, **no free centre**.
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
 * with `uses75Ball` / `uses3x3Ticket` / `uses5x5NoCenterTicket` /
 * `usesDatabingo60` and the engine's draw-bag selection. Game 3 is
 * checked **before** Game 1 (75-ball) because both use the 5×5 / 1-75
 * shape; the GAME3_SLUGS set is disjoint from BINGO75_SLUGS so the
 * router ordering does not affect existing slugs.
 */
export function generateTicketForGame(
  gameSlug: string,
  color?: string,
  type?: string,
): Ticket {
  if (uses3x3Ticket(gameSlug)) return generate3x3Ticket(color, type);
  if (uses5x5NoCenterTicket(gameSlug)) return generate5x5NoCenterTicket(color, type);
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
 * BIN-615 / PR-C2: Game 2 (Rocket/Tallspill) ticket — 3×3 grid of 9 unique
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
 * BIN-615 / PR-C3: Game 3 (Mønsterbingo) ticket — 5×5 grid of 25 unique numbers
 * in BINGO column ranges (B:1-15, I:16-30, N:31-45, G:46-60, O:61-75). **No
 * free centre cell** — the (2,2) position holds a normal N-column number.
 *
 * Legacy ref: `Helper/bingo.js:1014-1031` (`data.slug == 'game_3'`) — 25 picks,
 * one per column-row, no zero-filled free space. This is the key ticket-shape
 * difference vs. Game 1 (75-ball with free centre at grid[2][2]).
 *
 * Winner predicate: `PatternMatcher` (25-bit bitmask) — there is no dedicated
 * helper like `hasFullBingo`, because Game 3 matches against admin-defined
 * patterns (Row 1-4, Coverall, custom shapes) rather than row/column lines.
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
