import { describe, expect, it } from "vitest";
import {
  createTheme1MockTicketNumbers,
  rerollTheme1MockBoards,
  theme1MockSnapshot,
} from "@/features/theme1/data/theme1MockSnapshot";

describe("theme1MockSnapshot helpers", () => {
  it("creates a valid 3x5 candy ticket with unique values", () => {
    const ticketNumbers = createTheme1MockTicketNumbers(() => 0.5);

    expect(ticketNumbers).toHaveLength(15);
    expect(new Set(ticketNumbers).size).toBe(15);
    expect(ticketNumbers.slice(0, 5).every((value) => value > 0)).toBe(true);
  });

  it("rerolls boards into fresh idle mock boards", () => {
    const rerolledBoards = rerollTheme1MockBoards(theme1MockSnapshot.boards);

    expect(rerolledBoards).toHaveLength(theme1MockSnapshot.boards.length);
    expect(rerolledBoards.every((board) => board.progressState === "hidden")).toBe(true);
    expect(rerolledBoards.every((board) => board.completedPatterns.length === 0)).toBe(true);
    expect(rerolledBoards.every((board) => board.activeNearPatterns.length === 0)).toBe(true);
    expect(rerolledBoards.every((board) => board.prizeStacks.length === 0)).toBe(true);
    expect(rerolledBoards.every((board) => board.cells.every((cell) => cell.tone === "idle"))).toBe(true);
  });
});
