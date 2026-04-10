import { randomInt } from "node:crypto";
import type { Ticket } from "./types.js";

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
