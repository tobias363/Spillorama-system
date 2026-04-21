// Unit tests for GameManagementState (BIN-684 wire-up, was BIN-622 placeholders).
//
// Coverage:
//   - fetchGameManagementList / fetchGameManagement use apiRequest mot BIN-622
//   - saveGameManagement / deleteGameManagement / repeatGame hits backend
//   - closeDay still BACKEND_MISSING (BIN-623 ikke merget)
//   - fetchGameTickets still [] (backend-rute mangler)
//   - isGame3Variant helper
//   - Error-mapping: 403 → PERMISSION_DENIED, 404 → NOT_FOUND

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

function mockFetchOk(data: unknown): void {
  (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, data }),
  })) as unknown as typeof fetch;
}

function mockFetchError(status: number, code: string, message: string): void {
  (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async () => ({
    ok: false,
    status,
    json: async () => ({ ok: false, error: { code, message } }),
  })) as unknown as typeof fetch;
}

const sampleGm = {
  id: "gm-1",
  gameTypeId: "bingo",
  parentId: null,
  name: "Daily Bingo",
  ticketType: "Large",
  ticketPrice: 20,
  startDate: "2026-04-20",
  endDate: null,
  status: "active",
  totalSold: 0,
  totalEarning: 0,
  config: {},
  repeatedFromId: null,
  createdBy: "admin-1",
  createdAt: "2026-04-19T12:00:00Z",
  updatedAt: "2026-04-19T12:00:00Z",
};

describe("GameManagement fetchers (BIN-684 wired to BIN-622)", () => {
  beforeEach(() => {
    window.localStorage.setItem("bingo_admin_access_token", "test-token");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetchGameManagementList calls GET /api/admin/game-management?gameTypeId=X", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, data: { games: [sampleGm], count: 1 } }),
    }));
    (globalThis as unknown as { fetch: unknown }).fetch = fetchSpy as unknown as typeof fetch;
    const rows = await fetchGameManagementList("bingo");
    expect(rows).toHaveLength(1);
    expect(rows[0]?._id).toBe("gm-1");
    expect(rows[0]?.name).toBe("Daily Bingo");
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/admin/game-management?gameTypeId=bingo",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("fetchGameManagement returns row on 200", async () => {
    mockFetchOk(sampleGm);
    const row = await fetchGameManagement("bingo", "gm-1");
    expect(row?._id).toBe("gm-1");
    expect(row?.ticketPrice).toBe(20);
  });

  it("fetchGameManagement returns null on 404", async () => {
    mockFetchError(404, "GAME_MANAGEMENT_NOT_FOUND", "not found");
    const row = await fetchGameManagement("bingo", "missing");
    expect(row).toBeNull();
  });

  it("fetchGameTickets still returns [] (backend-rute mangler)", async () => {
    expect(await fetchGameTickets("any", "any")).toEqual([]);
  });
});

describe("GameManagement write-ops (BIN-684 wired)", () => {
  beforeEach(() => {
    window.localStorage.setItem("bingo_admin_access_token", "test-token");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("saveGameManagement POSTs when no existingId", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, data: sampleGm }),
    }));
    (globalThis as unknown as { fetch: unknown }).fetch = fetchSpy as unknown as typeof fetch;
    const res = await saveGameManagement({
      gameTypeId: "bingo",
      name: "x",
      ticketType: "Large",
      ticketPrice: 10,
      startDate: "2026-01-01",
    });
    expect(res.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/admin/game-management",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("saveGameManagement PATCHes when existingId supplied", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, data: sampleGm }),
    }));
    (globalThis as unknown as { fetch: unknown }).fetch = fetchSpy as unknown as typeof fetch;
    const res = await saveGameManagement(
      {
        gameTypeId: "bingo",
        name: "x",
        ticketType: "Large",
        ticketPrice: 10,
        startDate: "2026-01-01",
      },
      "gm-1"
    );
    expect(res.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/admin/game-management/gm-1",
      expect.objectContaining({ method: "PATCH" })
    );
  });

  it("saveGameManagement returns PERMISSION_DENIED on 403", async () => {
    mockFetchError(403, "PERMISSION_DENIED", "nope");
    const res = await saveGameManagement({
      gameTypeId: "bingo",
      name: "x",
      ticketType: "Large",
      ticketPrice: 10,
      startDate: "2026-01-01",
    });
    expect(res).toEqual({ ok: false, reason: "PERMISSION_DENIED", message: "nope" });
  });

  it("deleteGameManagement hits DELETE and normalises to ok:true", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, data: { softDeleted: true } }),
    }));
    (globalThis as unknown as { fetch: unknown }).fetch = fetchSpy as unknown as typeof fetch;
    const res = await deleteGameManagement("bingo", "gm-1");
    expect(res.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/admin/game-management/gm-1",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("deleteGameManagement returns NOT_FOUND on 404", async () => {
    mockFetchError(404, "GAME_MANAGEMENT_NOT_FOUND", "gone");
    const res = await deleteGameManagement("bingo", "gm-1");
    expect(res).toEqual({ ok: false, reason: "NOT_FOUND", message: "gone" });
  });

  it("repeatGame POSTs to /:id/repeat with optional repeatToken", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, data: sampleGm }),
    }));
    (globalThis as unknown as { fetch: unknown }).fetch = fetchSpy as unknown as typeof fetch;
    const res = await repeatGame({
      sourceGameId: "g1",
      startDate: "2026-01-01",
      repeatToken: "idem-x",
    });
    expect(res.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/admin/game-management/g1/repeat",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("idem-x"),
      })
    );
  });

  it("closeDay still resolves BACKEND_MISSING BIN-623 (ikke merget)", async () => {
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
