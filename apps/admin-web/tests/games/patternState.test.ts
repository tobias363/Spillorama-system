// Unit tests for PatternState (BIN-627 wire-up).
//
// Coverage:
//   - PatternMask bitmask-encoding: legacyGridToMask / maskToLegacyGrid round-trip
//   - toggleCell: idempotent double-toggle, out-of-range guard
//   - isCellSet / countCells
//   - maxPatternsForGameType: Game 1 / 3 / 4 / 5 limits
//   - fetch/save/delete wired to BIN-627 backend

import { describe, it, expect, afterEach, vi } from "vitest";
import {
  legacyGridToMask,
  maskToLegacyGrid,
  toggleCell,
  isCellSet,
  countCells,
  maxPatternsForGameType,
  fetchPatternList,
  fetchPattern,
  savePattern,
  deletePattern,
  PATTERN_MASK_FULL,
  PATTERN_MASK_CENTER_BIT,
} from "../../src/pages/games/patternManagement/PatternState.js";

describe("legacyGridToMask + maskToLegacyGrid (bitmask round-trip)", () => {
  it("empty grid → 0", () => {
    expect(legacyGridToMask("0,0,0,0,0.0,0,0,0,0.0,0,0,0,0.0,0,0,0,0.0,0,0,0,0")).toBe(0);
  });

  it("top row (row 0 all set) → bits 0..4 set", () => {
    const mask = legacyGridToMask("1,1,1,1,1.0,0,0,0,0.0,0,0,0,0.0,0,0,0,0.0,0,0,0,0");
    expect(mask).toBe(0b11111);
    expect(mask).toBe(31);
  });

  it("full 5x5 → all 25 bits set = PATTERN_MASK_FULL", () => {
    const full = legacyGridToMask(
      "1,1,1,1,1.1,1,1,1,1.1,1,1,1,1.1,1,1,1,1.1,1,1,1,1"
    );
    expect(full).toBe(PATTERN_MASK_FULL);
  });

  it("center cell only → bit 12 = PATTERN_MASK_CENTER_BIT", () => {
    const mask = legacyGridToMask("0,0,0,0,0.0,0,0,0,0.0,0,1,0,0.0,0,0,0,0.0,0,0,0,0");
    expect(mask).toBe(1 << PATTERN_MASK_CENTER_BIT);
  });

  it("maskToLegacyGrid reverses legacyGridToMask (round-trip)", () => {
    const masks = [0, 1, 31, PATTERN_MASK_FULL, (1 << 12), (1 << 0) | (1 << 24)];
    for (const original of masks) {
      const grid = maskToLegacyGrid(original);
      expect(legacyGridToMask(grid)).toBe(original);
    }
  });

  it("3x5 grid encoding works for databingo60", () => {
    const mask = legacyGridToMask("1,0,0,0,0.0,1,0,0,0.0,0,1,0,0", 5);
    // bits: (0,0)=0, (1,1)=6, (2,2)=12
    expect(mask).toBe(1 | (1 << 6) | (1 << 12));
  });

  it("throws if grid exceeds 25 bits", () => {
    const oversize = "1,0,0,0,0,0.0,0,0,0,0,0.0,0,0,0,0,0.0,0,0,0,0,0.0,0,0,0,0,0";
    expect(() => legacyGridToMask(oversize, 6)).toThrow(/exceeds 25-bit/);
  });
});

describe("toggleCell", () => {
  it("sets a cell that was off", () => {
    expect(toggleCell(0, 0, 0)).toBe(1);
    expect(toggleCell(0, 4, 4)).toBe(1 << 24);
  });

  it("is idempotent under double-toggle", () => {
    const once = toggleCell(0, 2, 3);
    const twice = toggleCell(once, 2, 3);
    expect(twice).toBe(0);
  });

  it("preserves other cells", () => {
    const base = 1 << 12; // center
    const out = toggleCell(base, 0, 0);
    expect(out).toBe((1 << 12) | 1);
  });

  it("ignores out-of-range coordinates", () => {
    expect(toggleCell(5, -1, 0)).toBe(5);
    expect(toggleCell(5, 0, -1)).toBe(5);
    expect(toggleCell(5, 10, 0)).toBe(5); // bit idx would be 50
  });
});

describe("isCellSet", () => {
  it("reports set/unset bits correctly in 5x5", () => {
    const mask = (1 << 0) | (1 << 6) | (1 << 12) | (1 << 18) | (1 << 24); // diagonal
    expect(isCellSet(mask, 0, 0)).toBe(true);
    expect(isCellSet(mask, 1, 1)).toBe(true);
    expect(isCellSet(mask, 2, 2)).toBe(true);
    expect(isCellSet(mask, 0, 1)).toBe(false);
    expect(isCellSet(mask, 4, 4)).toBe(true);
  });

  it("returns false for out-of-range", () => {
    expect(isCellSet(0xffffff, -1, 0)).toBe(false);
    expect(isCellSet(0xffffff, 10, 10)).toBe(false);
  });
});

describe("countCells", () => {
  it("returns 0 for empty mask", () => {
    expect(countCells(0)).toBe(0);
  });

  it("returns 25 for full mask", () => {
    expect(countCells(PATTERN_MASK_FULL)).toBe(25);
  });

  it("counts individual bits", () => {
    expect(countCells(0b10101)).toBe(3);
    expect(countCells(1 << 12)).toBe(1);
  });

  it("masks bits >24 (pop-count stays within 25-bit budget)", () => {
    // Bit 25 would be out of budget; countCells should ignore it.
    const dirty = PATTERN_MASK_FULL | (1 << 25);
    expect(countCells(dirty)).toBe(25);
  });
});

describe("maxPatternsForGameType", () => {
  it("Game 1 is unlimited (null)", () => {
    expect(maxPatternsForGameType("game_1")).toBeNull();
  });

  it("Game 3 caps at 32", () => {
    expect(maxPatternsForGameType("game_3")).toBe(32);
  });

  it("Game 4 caps at 15 (DEPRECATED)", () => {
    expect(maxPatternsForGameType("game_4")).toBe(15);
  });

  it("Game 5 caps at 17", () => {
    expect(maxPatternsForGameType("game_5")).toBe(17);
  });

  it("unknown game-type returns null (no limit)", () => {
    expect(maxPatternsForGameType("custom")).toBeNull();
  });
});

describe("fetch/save/delete pattern (BIN-627 live)", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const patternFixture = (partial: Record<string, unknown> = {}) => ({
    id: "p-1",
    gameTypeId: "bingo",
    gameName: "Game 1",
    patternNumber: "1",
    name: "Line 1",
    mask: 31,
    claimType: "LINE",
    prizePercent: 10,
    orderIndex: 1,
    design: 0,
    status: "active",
    isWoF: false,
    isTchest: false,
    isMys: false,
    isRowPr: false,
    rowPercentage: 0,
    isJackpot: false,
    isGameTypeExtra: false,
    isLuckyBonus: false,
    patternPlace: null,
    extra: {},
    createdBy: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...partial,
  });

  it("fetchPatternList returns mapped rows from /api/admin/patterns", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ ok: true, data: { patterns: [patternFixture()], count: 1 } }),
        { status: 200 }
      )) as typeof fetch;
    const rows = await fetchPatternList("bingo");
    expect(rows).toHaveLength(1);
    expect(rows[0]?._id).toBe("p-1");
    expect(rows[0]?.mask).toBe(31);
  });

  it("fetchPatternList returns [] on 404", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: "missing" } }),
        { status: 404 }
      )) as typeof fetch;
    const rows = await fetchPatternList("bingo");
    expect(rows).toEqual([]);
  });

  it("fetchPattern returns null on 404", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: "missing" } }),
        { status: 404 }
      )) as typeof fetch;
    const p = await fetchPattern("bingo", "anything");
    expect(p).toBeNull();
  });

  it("savePattern POSTs on create", async () => {
    const spy = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, data: patternFixture() }), { status: 200 })
    );
    globalThis.fetch = spy as unknown as typeof fetch;
    const res = await savePattern("bingo", {
      patternName: "test",
      mask: 31,
      status: "active",
    });
    expect(res.ok).toBe(true);
    const calls = spy.mock.calls as unknown as Array<[string, RequestInit?]>;
    const post = calls.find((c) => c[1]?.method === "POST");
    expect(post?.[0]).toBe("/api/admin/patterns");
  });

  it("savePattern PATCHes on update with existingId", async () => {
    const spy = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, data: patternFixture() }), { status: 200 })
    );
    globalThis.fetch = spy as unknown as typeof fetch;
    const res = await savePattern(
      "bingo",
      { patternName: "Updated", mask: 31, status: "active" },
      "p-1"
    );
    expect(res.ok).toBe(true);
    const calls = spy.mock.calls as unknown as Array<[string, RequestInit?]>;
    const patch = calls.find((c) => c[1]?.method === "PATCH");
    expect(patch?.[0]).toBe("/api/admin/patterns/p-1");
  });

  it("deletePattern DELETEs and returns softDeleted", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: true, data: { softDeleted: true } }), { status: 200 })) as typeof fetch;
    const res = await deletePattern("p-1");
    expect(res.ok).toBe(true);
    if ("softDeleted" in res) {
      expect(res.softDeleted).toBe(true);
    }
  });

  it("savePattern returns PERMISSION_DENIED on 403", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ ok: false, error: { code: "FORBIDDEN", message: "Forbidden" } }),
        { status: 403 }
      )) as typeof fetch;
    const res = await savePattern("bingo", { patternName: "x", mask: 1, status: "active" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("PERMISSION_DENIED");
    }
  });
});
