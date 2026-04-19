// Unit tests for GameManagementState (PR-A3b bolk 4).
//
// Coverage:
//   - fetchGameManagementList / fetchGameManagement / fetchGameTickets placeholders (BIN-622)
//   - saveGameManagement / deleteGameManagement / repeatGame placeholders (BIN-622)
//   - closeDay placeholder (BIN-623)
//   - isGame3Variant helper

import { describe, it, expect } from "vitest";
import {
  fetchGameManagementList,
  fetchGameManagement,
  fetchGameTickets,
  saveGameManagement,
  deleteGameManagement,
  repeatGame,
  closeDay,
  isGame3Variant,
} from "../../src/pages/games/gameManagement/GameManagementState.js";

describe("GameManagement fetchers (BIN-622 placeholders)", () => {
  it("fetchGameManagementList returns [] for any typeId", async () => {
    expect(await fetchGameManagementList("any-type")).toEqual([]);
  });
  it("fetchGameManagement returns null for any id", async () => {
    expect(await fetchGameManagement("any-type", "any-id")).toBeNull();
  });
  it("fetchGameTickets returns [] for any id", async () => {
    expect(await fetchGameTickets("any-type", "any-id")).toEqual([]);
  });
});

describe("GameManagement write-ops (BIN-622 / BIN-623 placeholders)", () => {
  it("saveGameManagement resolves BACKEND_MISSING BIN-622", async () => {
    const res = await saveGameManagement({
      gameTypeId: "bingo",
      name: "x",
      ticketType: "Large",
      ticketPrice: 10,
      startDate: "2026-01-01",
    });
    expect(res).toEqual({ ok: false, reason: "BACKEND_MISSING", issue: "BIN-622" });
  });
  it("deleteGameManagement resolves BACKEND_MISSING BIN-622", async () => {
    const res = await deleteGameManagement("bingo", "x");
    expect(res).toEqual({ ok: false, reason: "BACKEND_MISSING", issue: "BIN-622" });
  });
  it("repeatGame resolves BACKEND_MISSING BIN-622", async () => {
    const res = await repeatGame({ sourceGameId: "g1", startDate: "2026-01-01" });
    expect(res).toEqual({ ok: false, reason: "BACKEND_MISSING", issue: "BIN-622" });
  });
  it("closeDay resolves BACKEND_MISSING BIN-623", async () => {
    const res = await closeDay({ gameTypeId: "bingo", gameId: "g1", closeDate: "2026-01-02" });
    expect(res).toEqual({ ok: false, reason: "BACKEND_MISSING", issue: "BIN-623" });
  });
});

describe("isGame3Variant", () => {
  it("true for game_3", () => {
    expect(isGame3Variant({ type: "game_3" })).toBe(true);
  });
  it("false for other types and nullish", () => {
    expect(isGame3Variant({ type: "game_1" })).toBe(false);
    expect(isGame3Variant({ type: "game_2" })).toBe(false);
    expect(isGame3Variant({ type: "game_5" })).toBe(false);
    expect(isGame3Variant(null)).toBe(false);
    expect(isGame3Variant(undefined)).toBe(false);
  });
});
