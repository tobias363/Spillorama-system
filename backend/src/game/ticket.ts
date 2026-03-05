import { randomInt } from "node:crypto";
import type { Ticket } from "./types.js";

const BOARD_SIZE = 5;

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

export function makeShuffledBallBag(maxNumber = 75): number[] {
  return shuffle(Array.from({ length: maxNumber }, (_, i) => i + 1));
}

export function generateTraditional75Ticket(): Ticket {
  const columns = [
    pickUniqueInRange(1, 15, BOARD_SIZE),
    pickUniqueInRange(16, 30, BOARD_SIZE),
    pickUniqueInRange(31, 45, BOARD_SIZE - 1),
    pickUniqueInRange(46, 60, BOARD_SIZE),
    pickUniqueInRange(61, 75, BOARD_SIZE)
  ];

  const grid: number[][] = [];
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    const rowValues: number[] = [];
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (row === 2 && col === 2) {
        rowValues.push(0);
      } else if (col === 2 && row > 2) {
        rowValues.push(columns[col][row - 1]);
      } else {
        rowValues.push(columns[col][row]);
      }
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
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    const complete = Array.from({ length: BOARD_SIZE }, (_, col) => isMarked(ticket, marks, row, col)).every(Boolean);
    if (complete) {
      return row;
    }
  }

  for (let col = 0; col < BOARD_SIZE; col += 1) {
    const complete = Array.from({ length: BOARD_SIZE }, (_, row) => isMarked(ticket, marks, row, col)).every(Boolean);
    if (complete) {
      return BOARD_SIZE + col;
    }
  }

  const leftDiagonal = Array.from({ length: BOARD_SIZE }, (_, i) => isMarked(ticket, marks, i, i)).every(Boolean);
  if (leftDiagonal) {
    return BOARD_SIZE * 2;
  }

  const rightDiagonal = Array.from({ length: BOARD_SIZE }, (_, i) => isMarked(ticket, marks, i, BOARD_SIZE - 1 - i)).every(Boolean);
  if (rightDiagonal) {
    return BOARD_SIZE * 2 + 1;
  }

  return -1;
}

export function hasAnyCompleteLine(ticket: Ticket, marks: Set<number>): boolean {
  return findFirstCompleteLinePatternIndex(ticket, marks) >= 0;
}

export function countNearMissLinePattern(ticket: Ticket, marks: Set<number>): number {
  let nearMissCount = 0;

  const countMissingInPattern = (cells: Array<{ row: number; col: number }>): number => {
    let missing = 0;
    for (const cell of cells) {
      if (!isMarked(ticket, marks, cell.row, cell.col)) {
        missing += 1;
      }
    }
    return missing;
  };

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    const missing = countMissingInPattern(
      Array.from({ length: BOARD_SIZE }, (_, col) => ({ row, col }))
    );
    if (missing === 1) {
      nearMissCount += 1;
    }
  }

  for (let col = 0; col < BOARD_SIZE; col += 1) {
    const missing = countMissingInPattern(
      Array.from({ length: BOARD_SIZE }, (_, row) => ({ row, col }))
    );
    if (missing === 1) {
      nearMissCount += 1;
    }
  }

  const leftDiagonalMissing = countMissingInPattern(
    Array.from({ length: BOARD_SIZE }, (_, i) => ({ row: i, col: i }))
  );
  if (leftDiagonalMissing === 1) {
    nearMissCount += 1;
  }

  const rightDiagonalMissing = countMissingInPattern(
    Array.from({ length: BOARD_SIZE }, (_, i) => ({ row: i, col: BOARD_SIZE - 1 - i }))
  );
  if (rightDiagonalMissing === 1) {
    nearMissCount += 1;
  }

  return nearMissCount;
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
