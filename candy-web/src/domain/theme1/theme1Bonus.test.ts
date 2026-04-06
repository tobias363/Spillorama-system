import { describe, expect, it } from "vitest";
import {
  THEME1_BONUS_PICK_LIMIT,
  THEME1_BONUS_SLOT_COUNT,
  createIdleTheme1BonusState,
  createTheme1BonusRound,
  createTheme1WinningBonusRound,
  selectTheme1BonusSlot,
} from "@/domain/theme1/theme1Bonus";

describe("theme1Bonus", () => {
  it("creates an idle state with 9 hidden slots and no selected picks", () => {
    const state = createIdleTheme1BonusState();

    expect(state.status).toBe("idle");
    expect(state.slotCount).toBe(THEME1_BONUS_SLOT_COUNT);
    expect(state.pickLimit).toBe(THEME1_BONUS_PICK_LIMIT);
    expect(state.selectedSlotIds).toHaveLength(0);
    expect(state.slots).toHaveLength(THEME1_BONUS_SLOT_COUNT);
    expect(state.slots.every((slot) => slot.symbolId === null)).toBe(true);
  });

  it("resolves a winning round when all 3 selected symbols match", () => {
    const openState = createTheme1BonusRound({
      shuffledSymbolIds: [
        "asset-19",
        "asset-8",
        "asset-19",
        "asset-4",
        "asset-19",
        "asset-4",
        "asset-8",
        "asset-4",
        "asset-8",
      ],
    });

    const afterFirstPick = selectTheme1BonusSlot(openState, "bonus-slot-1");
    const afterSecondPick = selectTheme1BonusSlot(afterFirstPick, "bonus-slot-3");
    const resolvedState = selectTheme1BonusSlot(afterSecondPick, "bonus-slot-5");

    expect(resolvedState.status).toBe("resolved");
    expect(resolvedState.selectedSlotIds).toEqual([
      "bonus-slot-1",
      "bonus-slot-3",
      "bonus-slot-5",
    ]);
    expect(resolvedState.result).toEqual({
      matchedSymbolId: "asset-19",
      winAmount: 30,
      isWin: true,
    });
    expect(resolvedState.slots.filter((slot) => slot.revealed)).toHaveLength(3);
    expect(
      resolvedState.slots
        .filter((slot) => slot.revealed)
        .map((slot) => slot.id),
    ).toEqual(["bonus-slot-1", "bonus-slot-3", "bonus-slot-5"]);
  });

  it("ignores duplicate picks and resolves a loss when the selected symbols differ", () => {
    const openState = createTheme1BonusRound({
      shuffledSymbolIds: [
        "asset-4",
        "asset-19",
        "asset-8",
        "asset-4",
        "asset-19",
        "asset-8",
        "asset-4",
        "asset-19",
        "asset-8",
      ],
    });

    const afterFirstPick = selectTheme1BonusSlot(openState, "bonus-slot-1");
    const afterDuplicatePick = selectTheme1BonusSlot(afterFirstPick, "bonus-slot-1");
    const afterSecondPick = selectTheme1BonusSlot(afterDuplicatePick, "bonus-slot-2");
    const resolvedState = selectTheme1BonusSlot(afterSecondPick, "bonus-slot-3");
    const afterLimitReached = selectTheme1BonusSlot(resolvedState, "bonus-slot-4");

    expect(afterDuplicatePick.selectedSlotIds).toEqual(["bonus-slot-1"]);
    expect(resolvedState.status).toBe("resolved");
    expect(resolvedState.result).toEqual({
      matchedSymbolId: null,
      winAmount: 0,
      isWin: false,
    });
    expect(afterLimitReached).toEqual(resolvedState);
  });

  it("can create a rigged winning round where the first 3 picks match", () => {
    const riggedRound = createTheme1WinningBonusRound({
      winningSymbolId: "asset-4",
    });

    expect(riggedRound.slots.slice(0, 3).map((slot) => slot.symbolId)).toEqual([
      "asset-4",
      "asset-4",
      "asset-4",
    ]);

    const resolvedState = selectTheme1BonusSlot(
      selectTheme1BonusSlot(selectTheme1BonusSlot(riggedRound, "bonus-slot-1"), "bonus-slot-2"),
      "bonus-slot-3",
    );

    expect(resolvedState.result).toEqual({
      matchedSymbolId: "asset-4",
      winAmount: 10000,
      isWin: true,
    });
  });
});
