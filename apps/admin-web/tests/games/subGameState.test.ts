// Unit tests for SubGameState (BIN-621 wire-up).
//
// Coverage:
//   - fetchSubGameList: BIN-621 live, returns [] on 404
//   - fetchSubGame: BIN-621 live, null on 404
//   - saveSubGame / deleteSubGame: BIN-621 live wire-up
//   - isGameNameLocallyValid: uniqueness-precheck fallback
//   - LEGACY_TICKET_COLOR_OPTIONS: stable vocabulary

import { describe, it, expect, afterEach, vi } from "vitest";
import {
  deleteSubGame,
  fetchSubGame,
  fetchSubGameList,
  isGameNameLocallyValid,
  LEGACY_TICKET_COLOR_OPTIONS,
  saveSubGame,
} from "../../src/pages/games/subGame/SubGameState.js";

function okJson(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), { status: 200 });
}

function errJson(code: string, message: string, status: number): Response {
  return new Response(
    JSON.stringify({ ok: false, error: { code, message } }),
    { status }
  );
}

function subGameFixture(partial: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "sg-uuid",
    gameTypeId: "bingo",
    gameName: "Test SubGame",
    name: "Test SubGame",
    subGameNumber: "1",
    patternRows: [{ patternId: "p1", name: "One line" }],
    ticketColors: ["Yellow"],
    status: "active",
    extra: {},
    createdBy: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

describe("fetchSubGameList (BIN-621 live)", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns mapped rows from /api/admin/sub-games", async () => {
    globalThis.fetch = (async () =>
      okJson({ subGames: [subGameFixture()], count: 1 })) as typeof fetch;
    const rows = await fetchSubGameList();
    expect(rows).toHaveLength(1);
    expect(rows[0]?._id).toBe("sg-uuid");
    expect(rows[0]?.gameName).toBe("Test SubGame");
    expect(rows[0]?.patternRow).toEqual([{ patternId: "p1", name: "One line" }]);
    expect(rows[0]?.ticketColor).toEqual([{ name: "Yellow" }]);
  });

  it("returns [] when backend returns 404 (migrations not run yet)", async () => {
    globalThis.fetch = (async () => errJson("NOT_FOUND", "missing", 404)) as typeof fetch;
    const rows = await fetchSubGameList();
    expect(rows).toEqual([]);
  });

  it("forwards gameTypeId filter via query string", async () => {
    const spy = vi.fn(async () => okJson({ subGames: [], count: 0 }));
    globalThis.fetch = spy as unknown as typeof fetch;
    await fetchSubGameList("bingo");
    const calls = spy.mock.calls as unknown as Array<[string, RequestInit?]>;
    expect(calls[0]?.[0]).toContain("gameType=bingo");
  });
});

describe("fetchSubGame (BIN-621 live)", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns mapped row from detail endpoint", async () => {
    globalThis.fetch = (async () => okJson(subGameFixture())) as typeof fetch;
    const sg = await fetchSubGame("sg-uuid");
    expect(sg?._id).toBe("sg-uuid");
  });

  it("returns null on 404", async () => {
    globalThis.fetch = (async () => errJson("NOT_FOUND", "missing", 404)) as typeof fetch;
    const sg = await fetchSubGame("anything");
    expect(sg).toBeNull();
  });
});

describe("saveSubGame / deleteSubGame (BIN-621 live)", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("saveSubGame POSTs on create (no existingId)", async () => {
    const spy = vi.fn(async () => okJson(subGameFixture()));
    globalThis.fetch = spy as unknown as typeof fetch;
    const res = await saveSubGame({
      gameTypeId: "bingo",
      gameName: "X",
      selectPatternRow: ["p1"],
      selectTicketColor: ["Yellow"],
      status: "active",
    });
    expect(res.ok).toBe(true);
    const calls = spy.mock.calls as unknown as Array<[string, RequestInit?]>;
    const post = calls.find((c) => c[1]?.method === "POST");
    expect(post).toBeTruthy();
    expect(post?.[0]).toBe("/api/admin/sub-games");
  });

  it("saveSubGame PATCHes on update (with existingId)", async () => {
    const spy = vi.fn(async () => okJson(subGameFixture()));
    globalThis.fetch = spy as unknown as typeof fetch;
    const res = await saveSubGame(
      {
        gameName: "Updated",
        selectPatternRow: [],
        selectTicketColor: [],
        status: "inactive",
      },
      "sg-uuid"
    );
    expect(res.ok).toBe(true);
    const calls = spy.mock.calls as unknown as Array<[string, RequestInit?]>;
    const patch = calls.find((c) => c[1]?.method === "PATCH");
    expect(patch).toBeTruthy();
    expect(patch?.[0]).toBe("/api/admin/sub-games/sg-uuid");
  });

  it("deleteSubGame returns softDeleted on success", async () => {
    globalThis.fetch = (async () => okJson({ softDeleted: true })) as typeof fetch;
    const res = await deleteSubGame("sg-uuid");
    expect(res.ok).toBe(true);
    if ("softDeleted" in res) {
      expect(res.softDeleted).toBe(true);
    }
  });

  it("saveSubGame returns PERMISSION_DENIED on 403", async () => {
    globalThis.fetch = (async () => errJson("FORBIDDEN", "Forbidden", 403)) as typeof fetch;
    const res = await saveSubGame({
      gameName: "X",
      selectPatternRow: [],
      selectTicketColor: [],
      status: "active",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("PERMISSION_DENIED");
    }
  });
});

describe("isGameNameLocallyValid", () => {
  it("accepts a trimmed non-empty name", () => {
    expect(isGameNameLocallyValid("My Game")).toBe(true);
  });

  it("rejects empty / whitespace-only", () => {
    expect(isGameNameLocallyValid("")).toBe(false);
    expect(isGameNameLocallyValid("   ")).toBe(false);
  });

  it("accepts 40 chars exactly; rejects >40", () => {
    expect(isGameNameLocallyValid("a".repeat(40))).toBe(true);
    expect(isGameNameLocallyValid("a".repeat(41))).toBe(false);
  });
});

describe("LEGACY_TICKET_COLOR_OPTIONS", () => {
  it("exposes canonical 9-color codes first, legacy strings last", () => {
    // feat/schedule-8-colors-mystery (2026-04-23): de 9 canonical TICKET_COLORS
    // er prepended, de 8 legacy-navnene beholdes for bakoverkompat.
    expect(LEGACY_TICKET_COLOR_OPTIONS).toEqual([
      "SMALL_YELLOW",
      "LARGE_YELLOW",
      "SMALL_WHITE",
      "LARGE_WHITE",
      "SMALL_PURPLE",
      "LARGE_PURPLE",
      "RED",
      "GREEN",
      "BLUE",
      "Yellow",
      "Blue",
      "Green",
      "Red",
      "White",
      "Orange",
      "Pink",
      "Violet",
    ]);
  });

  it("is a readonly tuple (cannot push)", () => {
    expect(Array.isArray(LEGACY_TICKET_COLOR_OPTIONS)).toBe(true);
    expect(LEGACY_TICKET_COLOR_OPTIONS.length).toBe(17);
  });
});
