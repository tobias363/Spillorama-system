// Unit tests for GameTypeState (BIN-620 wire-up).
//
// Coverage:
//   - mapPlatformRowToGameType: backend → legacy-shaped row mapping (8 tests)
//   - mapAdminGameTypeToGameType: BIN-620 wire-shape → legacy row (2 tests)
//   - fetchGameTypeList: happy-path (BIN-620) + legacy fallback + empty + error
//   - fetchGameType: found + not-found
//   - saveGameType / deleteGameType: BIN-620 live wire-up
//   - isDropdownVisible: Game 4 hidden per PM-scope

import { describe, it, expect, afterEach, vi } from "vitest";
import {
  fetchGameType,
  fetchGameTypeList,
  mapPlatformRowToGameType,
  mapAdminGameTypeToGameType,
  saveGameType,
  deleteGameType,
} from "../../src/pages/games/gameType/GameTypeState.js";
import { isDropdownVisible, GAME_TYPE_HIDDEN_FROM_DROPDOWN } from "../../src/pages/games/common/types.js";
import type { PlatformGameRow } from "../../src/pages/games/common/types.js";
import type { AdminGameType } from "../../src/api/admin-game-types.js";

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

function adminGT(partial: Partial<AdminGameType> = {}): AdminGameType {
  return {
    id: "uuid-bingo",
    typeSlug: "bingo",
    name: "Game 1",
    photo: "bingo.png",
    pattern: true,
    gridRows: 5,
    gridColumns: 5,
    rangeMin: 1,
    rangeMax: 75,
    totalNoTickets: null,
    userMaxTickets: null,
    luckyNumbers: [],
    status: "active",
    extra: {},
    createdBy: null,
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

describe("mapAdminGameTypeToGameType (BIN-620 wire-shape)", () => {
  it("maps typeSlug 'bingo' → legacy type 'game_1'", () => {
    const gt = mapAdminGameTypeToGameType(adminGT({ typeSlug: "bingo" }));
    expect(gt._id).toBe("uuid-bingo");
    expect(gt.slug).toBe("bingo");
    expect(gt.type).toBe("game_1");
    expect(gt.pattern).toBe(true);
    expect(gt.row).toBe(5);
    expect(gt.columns).toBe(5);
    expect(gt.isActive).toBe(true);
  });

  it("falls back to photo slug.png when photo is empty string", () => {
    const gt = mapAdminGameTypeToGameType(adminGT({ photo: "", typeSlug: "rocket" }));
    expect(gt.photo).toBe("rocket.png");
  });
});

describe("fetchGameTypeList", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("calls /api/admin/game-types first, returns mapped rows on success", async () => {
    window.localStorage.setItem("bingo_admin_access_token", "abc123");
    const spy = vi.fn(async (url: string | URL) => {
      const urlStr = String(url);
      if (urlStr.startsWith("/api/admin/game-types")) {
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              gameTypes: [adminGT({ typeSlug: "bingo" }), adminGT({ typeSlug: "rocket", name: "Game 2" })],
              count: 2,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({ ok: false, error: { code: "X", message: "unexpected" } }), { status: 500 });
    });
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

  it("falls back to /api/admin/games when game-types returns empty", async () => {
    const spy = vi.fn(async (url: string | URL) => {
      const urlStr = String(url);
      if (urlStr.startsWith("/api/admin/game-types")) {
        return new Response(
          JSON.stringify({ ok: true, data: { gameTypes: [], count: 0 } }),
          { status: 200 }
        );
      }
      if (urlStr.startsWith("/api/admin/games")) {
        return new Response(
          JSON.stringify({ ok: true, data: [row({ slug: "bingo" })] }),
          { status: 200 }
        );
      }
      return new Response("", { status: 500 });
    });
    globalThis.fetch = spy as unknown as typeof fetch;
    const result = await fetchGameTypeList();
    expect(result).toHaveLength(1);
    expect(result[0]?.slug).toBe("bingo");
  });

  it("falls back to legacy when game-types 404s", async () => {
    const spy = vi.fn(async (url: string | URL) => {
      const urlStr = String(url);
      if (urlStr.startsWith("/api/admin/game-types")) {
        return new Response(
          JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: "missing" } }),
          { status: 404 }
        );
      }
      if (urlStr.startsWith("/api/admin/games")) {
        return new Response(
          JSON.stringify({ ok: true, data: [row({ slug: "bingo" })] }),
          { status: 200 }
        );
      }
      return new Response("", { status: 500 });
    });
    globalThis.fetch = spy as unknown as typeof fetch;
    const result = await fetchGameTypeList();
    expect(result).toHaveLength(1);
  });

  it("gracefully handles non-array legacy payloads by returning []", async () => {
    globalThis.fetch = (async (url: string | URL) => {
      const urlStr = String(url);
      if (urlStr.startsWith("/api/admin/game-types")) {
        return new Response(
          JSON.stringify({ ok: true, data: { gameTypes: [], count: 0 } }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ ok: true, data: null }), { status: 200 });
    }) as typeof fetch;
    const result = await fetchGameTypeList();
    expect(result).toEqual([]);
  });
});

describe("fetchGameType", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns a mapped row from the detail endpoint", async () => {
    globalThis.fetch = (async (url: string | URL) => {
      const urlStr = String(url);
      if (urlStr.includes("/api/admin/game-types/rocket")) {
        return new Response(
          JSON.stringify({ ok: true, data: adminGT({ id: "uuid-rocket", typeSlug: "rocket", name: "Game 2" }) }),
          { status: 200 }
        );
      }
      return new Response("", { status: 500 });
    }) as typeof fetch;

    const gt = await fetchGameType("rocket");
    expect(gt?.slug).toBe("rocket");
    expect(gt?._id).toBe("uuid-rocket");
  });

  it("falls back to list scan on 404 + returns null when not in list", async () => {
    globalThis.fetch = (async (url: string | URL) => {
      const urlStr = String(url);
      if (urlStr.includes("/api/admin/game-types/nonexistent")) {
        return new Response(
          JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: "missing" } }),
          { status: 404 }
        );
      }
      if (urlStr.startsWith("/api/admin/game-types")) {
        return new Response(
          JSON.stringify({ ok: true, data: { gameTypes: [], count: 0 } }),
          { status: 200 }
        );
      }
      if (urlStr.startsWith("/api/admin/games")) {
        return new Response(
          JSON.stringify({ ok: true, data: [row({ slug: "bingo" })] }),
          { status: 200 }
        );
      }
      return new Response("", { status: 500 });
    }) as typeof fetch;

    const gt = await fetchGameType("nonexistent");
    expect(gt).toBeNull();
  });
});

describe("write-ops (BIN-620 live)", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("saveGameType POSTs to /api/admin/game-types on create", async () => {
    const spy = vi.fn(async () => {
      return new Response(
        JSON.stringify({ ok: true, data: adminGT({ id: "uuid-new", typeSlug: "custom", name: "Custom" }) }),
        { status: 200 }
      );
    });
    globalThis.fetch = spy as unknown as typeof fetch;
    const res = await saveGameType({ name: "Custom", typeSlug: "custom", row: 5, columns: 5, pattern: false });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.row.name).toBe("Custom");
    }
    const calls = spy.mock.calls as unknown as Array<[string, RequestInit?]>;
    const postCall = calls.find((c) => c[1]?.method === "POST");
    expect(postCall).toBeTruthy();
    expect(postCall?.[0]).toBe("/api/admin/game-types");
    const body = JSON.parse(String(postCall?.[1]?.body));
    expect(body.typeSlug).toBe("custom");
    expect(body.gridRows).toBe(5);
    expect(body.gridColumns).toBe(5);
  });

  it("saveGameType PATCHes on update with existingId", async () => {
    const spy = vi.fn(async () =>
      new Response(
        JSON.stringify({ ok: true, data: adminGT({ id: "uuid-bingo", typeSlug: "bingo", name: "Edited" }) }),
        { status: 200 }
      )
    );
    globalThis.fetch = spy as unknown as typeof fetch;
    const res = await saveGameType(
      { name: "Edited", row: 5, columns: 5, pattern: true },
      "uuid-bingo"
    );
    expect(res.ok).toBe(true);
    const calls = spy.mock.calls as unknown as Array<[string, RequestInit?]>;
    const patchCall = calls.find((c) => c[1]?.method === "PATCH");
    expect(patchCall).toBeTruthy();
    expect(patchCall?.[0]).toBe("/api/admin/game-types/uuid-bingo");
  });

  it("saveGameType returns PERMISSION_DENIED on 403", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ ok: false, error: { code: "FORBIDDEN", message: "Forbidden" } }),
        { status: 403 }
      )) as typeof fetch;
    const res = await saveGameType({ name: "X", row: 5, columns: 5, pattern: false });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("PERMISSION_DENIED");
    }
  });

  it("deleteGameType DELETEs to endpoint and returns ok on success", async () => {
    const spy = vi.fn(async () =>
      new Response(
        JSON.stringify({ ok: true, data: { softDeleted: true } }),
        { status: 200 }
      )
    );
    globalThis.fetch = spy as unknown as typeof fetch;
    const res = await deleteGameType("uuid-bingo");
    expect(res.ok).toBe(true);
    if ("softDeleted" in res) {
      expect(res.softDeleted).toBe(true);
    }
    const calls = spy.mock.calls as unknown as Array<[string, RequestInit?]>;
    const deleteCall = calls.find((c) => c[1]?.method === "DELETE");
    expect(deleteCall).toBeTruthy();
    expect(deleteCall?.[0]).toBe("/api/admin/game-types/uuid-bingo");
  });

  it("deleteGameType returns BACKEND_ERROR on 500", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ ok: false, error: { code: "DB_ERROR", message: "boom" } }),
        { status: 500 }
      )) as typeof fetch;
    const res = await deleteGameType("uuid-bingo");
    expect(res.ok).toBe(false);
    if (!res.ok && "reason" in res) {
      expect(res.reason).toBe("BACKEND_ERROR");
    }
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
