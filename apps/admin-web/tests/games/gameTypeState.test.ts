// Unit tests for GameTypeState (PR-A3 bolk 1).
//
// Coverage:
//   - mapPlatformRowToGameType: backend → legacy-shaped row mapping (8 tests)
//   - fetchGameTypeList: happy-path + auth-header + empty + error
//   - fetchGameType: found + not-found
//   - saveGameType / deleteGameType: placeholder-contract (BIN-620)
//   - isDropdownVisible: Game 4 hidden per PM-scope

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  fetchGameType,
  fetchGameTypeList,
  mapPlatformRowToGameType,
  saveGameType,
  deleteGameType,
} from "../../src/pages/games/gameType/GameTypeState.js";
import { isDropdownVisible, GAME_TYPE_HIDDEN_FROM_DROPDOWN } from "../../src/pages/games/common/types.js";
import type { PlatformGameRow } from "../../src/pages/games/common/types.js";

function row(partial: Partial<PlatformGameRow> = {}): PlatformGameRow {
  return {
    slug: "bingo",
    title: "Game 1",
    description: "75-ball bingo",
    route: "/bingo",
    isEnabled: true,
    sortOrder: 1,
    settings: {},
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

describe("mapPlatformRowToGameType", () => {
  it("maps bingo → game_1 with 5x5 grid default", () => {
    const gt = mapPlatformRowToGameType(row({ slug: "bingo", title: "Game 1" }));
    expect(gt._id).toBe("bingo");
    expect(gt.slug).toBe("bingo");
    expect(gt.name).toBe("Game 1");
    expect(gt.type).toBe("game_1");
    expect(gt.row).toBe(5);
    expect(gt.columns).toBe(5);
    expect(gt.pattern).toBe(true);
  });

  it("maps rocket → game_2 with 3x3 grid default", () => {
    const gt = mapPlatformRowToGameType(row({ slug: "rocket", title: "Game 2" }));
    expect(gt.type).toBe("game_2");
    expect(gt.row).toBe(3);
    expect(gt.columns).toBe(3);
    expect(gt.pattern).toBe(false);
  });

  it("maps monsterbingo → game_3 with pattern=true", () => {
    const gt = mapPlatformRowToGameType(row({ slug: "monsterbingo", title: "Game 3" }));
    expect(gt.type).toBe("game_3");
    expect(gt.pattern).toBe(true);
  });

  it("maps spillorama → game_5 with 3x5 grid default", () => {
    const gt = mapPlatformRowToGameType(row({ slug: "spillorama", title: "Spillorama" }));
    expect(gt.type).toBe("game_5");
    expect(gt.row).toBe(3);
    expect(gt.columns).toBe(5);
  });

  it("passes unknown slug through to both _id and type (fallback mapping)", () => {
    const gt = mapPlatformRowToGameType(row({ slug: "custom-x", title: "X" }));
    expect(gt._id).toBe("custom-x");
    expect(gt.type).toBe("custom-x");
    // Fallback grid is 5x5.
    expect(gt.row).toBe(5);
    expect(gt.columns).toBe(5);
  });

  it("reads row/columns from settings when present", () => {
    const gt = mapPlatformRowToGameType(row({ settings: { row: 7, columns: 9 } }));
    expect(gt.row).toBe(7);
    expect(gt.columns).toBe(9);
  });

  it("coerces string numbers in settings", () => {
    const gt = mapPlatformRowToGameType(row({ settings: { row: "4", columns: "6" } }));
    expect(gt.row).toBe(4);
    expect(gt.columns).toBe(6);
  });

  it("reads photo from settings when present; falls back to slug.png", () => {
    const gt1 = mapPlatformRowToGameType(row({ settings: { photo: "bingo1_v2.png" } }));
    expect(gt1.photo).toBe("bingo1_v2.png");
    const gt2 = mapPlatformRowToGameType(row({ slug: "rocket" }));
    expect(gt2.photo).toBe("rocket.png");
  });

  it("respects explicit settings.type override (ops pinning)", () => {
    const gt = mapPlatformRowToGameType(row({ slug: "bingo", settings: { type: "game_3" } }));
    expect(gt.type).toBe("game_3");
  });

  it("respects explicit settings.pattern override", () => {
    const gt = mapPlatformRowToGameType(row({ slug: "rocket", settings: { pattern: true } }));
    expect(gt.pattern).toBe(true);
  });
});

describe("fetchGameTypeList", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("calls /api/admin/games with auth and maps rows", async () => {
    window.localStorage.setItem("bingo_admin_access_token", "abc123");
    const spy = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          data: [row({ slug: "bingo" }), row({ slug: "rocket" })],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    globalThis.fetch = spy as unknown as typeof fetch;

    const result = await fetchGameTypeList();
    expect(result).toHaveLength(2);
    expect(result[0]?.slug).toBe("bingo");
    expect(result[1]?.slug).toBe("rocket");

    // Auth header included
    const calls = spy.mock.calls as unknown as Array<[string, RequestInit?]>;
    expect(calls.length).toBeGreaterThan(0);
    const firstCall = calls[0]!;
    expect(firstCall[1]?.headers).toMatchObject({ Authorization: "Bearer abc123" });
  });

  it("returns [] on empty response", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: true, data: [] }), { status: 200 })) as typeof fetch;
    const result = await fetchGameTypeList();
    expect(result).toEqual([]);
  });

  it("gracefully handles non-array payloads by returning []", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: true, data: null }), { status: 200 })) as typeof fetch;
    const result = await fetchGameTypeList();
    expect(result).toEqual([]);
  });

  it("throws on HTTP error", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: false, error: { code: "X", message: "boom" } }), { status: 500 })) as typeof fetch;
    await expect(fetchGameTypeList()).rejects.toThrow("boom");
  });
});

describe("fetchGameType", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  beforeEach(() => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          ok: true,
          data: [row({ slug: "bingo" }), row({ slug: "rocket" })],
        }),
        { status: 200 }
      )) as typeof fetch;
  });

  it("returns the row when found", async () => {
    const gt = await fetchGameType("rocket");
    expect(gt?.slug).toBe("rocket");
  });

  it("returns null when slug is absent", async () => {
    const gt = await fetchGameType("nonexistent");
    expect(gt).toBeNull();
  });
});

describe("placeholder write-ops (BIN-620 contract)", () => {
  it("saveGameType always resolves to BACKEND_MISSING", async () => {
    const res = await saveGameType({ name: "X", row: 5, columns: 5, pattern: false });
    expect(res).toEqual({ ok: false, reason: "BACKEND_MISSING", issue: "BIN-620" });
  });

  it("deleteGameType always resolves to BACKEND_MISSING", async () => {
    const res = await deleteGameType("bingo");
    expect(res).toEqual({ ok: false, reason: "BACKEND_MISSING", issue: "BIN-620" });
  });
});

describe("isDropdownVisible (Game 4 guard)", () => {
  it("hides game_4", () => {
    expect(isDropdownVisible({ type: "game_4" })).toBe(false);
  });

  it("shows game_1/2/3/5", () => {
    for (const type of ["game_1", "game_2", "game_3", "game_5"]) {
      expect(isDropdownVisible({ type })).toBe(true);
    }
  });

  it("hidden set contains exactly game_4", () => {
    expect(Array.from(GAME_TYPE_HIDDEN_FROM_DROPDOWN)).toEqual(["game_4"]);
  });
});
