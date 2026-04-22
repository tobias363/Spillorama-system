// PR 4e.1 (2026-04-22) — GroupHall state-layer tests.
//
// Coverage:
//   - CRUD (list/get/create/update/delete)
//   - Error mapping (403 PERMISSION_DENIED, 404 NOT_FOUND, 400/422 VALIDATION)
//   - Validation (name required, name ≤ 200, tvId non-negative, hallIds non-empty)
//   - Member add/remove (diff-over-PATCH, idempotent)
//   - Description ekstraksjon fra `extra`
//   - Klient-side name-search

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchHallGroupList,
  fetchHallGroup,
  createGroupHall,
  updateGroupHall,
  deleteGroupHall,
  addHallToGroup,
  removeHallFromGroup,
  validateGroupHallPayload,
  getDescriptionFromRow,
  type HallGroupRow,
} from "../../src/pages/groupHall/GroupHallState.js";

type FetchMock = ReturnType<typeof vi.fn>;

function installFetch(impl: (...args: unknown[]) => Promise<unknown>): FetchMock {
  const fn: FetchMock = vi.fn(impl as never);
  (globalThis as unknown as { fetch: unknown }).fetch = fn as unknown as typeof fetch;
  return fn;
}

function mockFetchOk(data: unknown): FetchMock {
  return installFetch(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, data }),
  }));
}

function mockFetchSeq(
  responses: Array<{ data?: unknown; status?: number; code?: string; message?: string }>
): FetchMock {
  let i = 0;
  return installFetch(async () => {
    const r = responses[i++];
    if (!r) throw new Error("unexpected fetch beyond sequence");
    if (r.status && r.status >= 400) {
      return {
        ok: false,
        status: r.status,
        json: async () => ({
          ok: false,
          error: { code: r.code ?? "ERR", message: r.message ?? "" },
        }),
      };
    }
    return {
      ok: true,
      status: r.status ?? 200,
      json: async () => ({ ok: true, data: r.data }),
    };
  });
}

function mockFetchError(status: number, code: string, message: string): FetchMock {
  return installFetch(async () => ({
    ok: false,
    status,
    json: async () => ({ ok: false, error: { code, message } }),
  }));
}

const sampleRow: HallGroupRow = {
  id: "hg-1",
  legacyGroupHallId: null,
  name: "Nord-gruppen",
  status: "active",
  tvId: 42,
  productIds: [],
  members: [
    {
      hallId: "hall-1",
      hallName: "Oslo City",
      hallStatus: "active",
      addedAt: "2026-04-20T12:00:00.000Z",
    },
    {
      hallId: "hall-2",
      hallName: "Bergen Brygge",
      hallStatus: "active",
      addedAt: "2026-04-20T12:00:00.000Z",
    },
  ],
  extra: { description: "Pilot-link" },
  createdBy: "admin-1",
  createdAt: "2026-04-20T12:00:00.000Z",
  updatedAt: "2026-04-20T12:00:00.000Z",
};

beforeEach(() => {
  window.localStorage.setItem("bingo_admin_access_token", "test-token");
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── CRUD happy-path ─────────────────────────────────────────────────────────

describe("GroupHallState — CRUD happy-path", () => {
  it("fetchHallGroupList sender GET /api/admin/hall-groups", async () => {
    const fn = mockFetchOk({ groups: [sampleRow], count: 1 });
    const rows = await fetchHallGroupList();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("hg-1");
    expect(fn).toHaveBeenCalledWith(
      "/api/admin/hall-groups",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("fetchHallGroup returnerer rad på 200", async () => {
    mockFetchOk(sampleRow);
    const row = await fetchHallGroup("hg-1");
    expect(row?.id).toBe("hg-1");
    expect(row?.name).toBe("Nord-gruppen");
  });

  it("fetchHallGroup returnerer null på 404", async () => {
    mockFetchError(404, "HALL_GROUP_NOT_FOUND", "not found");
    const row = await fetchHallGroup("missing");
    expect(row).toBeNull();
  });

  it("createGroupHall POSTer payload med hallIds + description via extra", async () => {
    const fn = mockFetchOk(sampleRow);
    const res = await createGroupHall({
      name: "Nord-gruppen",
      tvId: 42,
      hallIds: ["hall-1", "hall-2"],
      description: "Pilot-link",
    });
    expect(res.ok).toBe(true);
    const call = fn.mock.calls[0]!;
    expect(call[0]).toBe("/api/admin/hall-groups");
    expect((call[1] as RequestInit).method).toBe("POST");
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.name).toBe("Nord-gruppen");
    expect(body.hallIds).toEqual(["hall-1", "hall-2"]);
    expect(body.tvId).toBe(42);
    expect(body.extra).toEqual({ description: "Pilot-link" });
  });

  it("updateGroupHall PATCHer kun oppgitte felter", async () => {
    const fn = mockFetchOk(sampleRow);
    const res = await updateGroupHall("hg-1", { name: "Nytt navn" });
    expect(res.ok).toBe(true);
    const call = fn.mock.calls[0]!;
    expect(call[0]).toBe("/api/admin/hall-groups/hg-1");
    expect((call[1] as RequestInit).method).toBe("PATCH");
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body).toEqual({ name: "Nytt navn" });
  });

  it("deleteGroupHall sender DELETE og normaliserer til ok:true", async () => {
    const fn = mockFetchOk({ softDeleted: true });
    const res = await deleteGroupHall("hg-1");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.softDeleted).toBe(true);
    expect(fn).toHaveBeenCalledWith(
      "/api/admin/hall-groups/hg-1",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("deleteGroupHall støtter hard=true via query-string", async () => {
    const fn = mockFetchOk({ softDeleted: false });
    await deleteGroupHall("hg-1", { hard: true });
    const url = fn.mock.calls[0]![0] as string;
    expect(url).toContain("hard=true");
  });
});

// ── Error-mapping ───────────────────────────────────────────────────────────

describe("GroupHallState — error-mapping", () => {
  it("403 → PERMISSION_DENIED på create", async () => {
    mockFetchError(403, "PERMISSION_DENIED", "nope");
    const res = await createGroupHall({ name: "x" });
    expect(res).toEqual({ ok: false, reason: "PERMISSION_DENIED", message: "nope" });
  });

  it("404 → NOT_FOUND på update", async () => {
    mockFetchError(404, "HALL_GROUP_NOT_FOUND", "gone");
    const res = await updateGroupHall("hg-1", { name: "x" });
    expect(res).toEqual({ ok: false, reason: "NOT_FOUND", message: "gone" });
  });

  it("400 → VALIDATION på backend-feil (duplikat, etc)", async () => {
    mockFetchError(400, "INVALID_INPUT", "name er påkrevd");
    const res = await createGroupHall({ name: "x" });
    expect(res).toEqual({ ok: false, reason: "VALIDATION", message: "name er påkrevd" });
  });

  it("500 → BACKEND_ERROR med wire-melding", async () => {
    mockFetchError(500, "INTERNAL", "boom");
    const res = await deleteGroupHall("hg-1");
    expect(res).toEqual({ ok: false, reason: "BACKEND_ERROR", message: "boom" });
  });
});

// ── Validering (uten fetch-kall) ────────────────────────────────────────────

describe("GroupHallState — validateGroupHallPayload", () => {
  it("krever name", () => {
    expect(validateGroupHallPayload({ name: "   " })).toBe("name_required");
    expect(validateGroupHallPayload({ name: "" })).toBe("name_required");
  });

  it("avviser name over 200 tegn", () => {
    const tooLong = "a".repeat(201);
    expect(validateGroupHallPayload({ name: tooLong })).toBe("name_too_long");
  });

  it("godkjenner name på 200 tegn og tvId = null", () => {
    expect(validateGroupHallPayload({ name: "a".repeat(200), tvId: null })).toBeNull();
  });

  it("avviser negativ tvId", () => {
    expect(validateGroupHallPayload({ name: "x", tvId: -1 })).toBe("tv_id_invalid");
  });

  it("avviser non-integer tvId", () => {
    expect(validateGroupHallPayload({ name: "x", tvId: 3.14 })).toBe("tv_id_invalid");
  });

  it("avviser tom hallId i array", () => {
    expect(validateGroupHallPayload({ name: "x", hallIds: ["hall-1", " "] })).toBe(
      "hall_id_invalid"
    );
  });

  it("createGroupHall gir VALIDATION uten fetch når name er tomt", async () => {
    const fn = mockFetchOk({});
    const res = await createGroupHall({ name: "   " });
    expect(res).toEqual({
      ok: false,
      reason: "VALIDATION",
      message: "name_required",
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it("updateGroupHall avviser tom payload med VALIDATION no_changes", async () => {
    const fn = mockFetchOk(sampleRow);
    const res = await updateGroupHall("hg-1", {});
    expect(res).toEqual({
      ok: false,
      reason: "VALIDATION",
      message: "no_changes",
    });
    expect(fn).not.toHaveBeenCalled();
  });
});

// ── Member add/remove (diff-over-PATCH) ─────────────────────────────────────

describe("GroupHallState — member helpers", () => {
  it("addHallToGroup henter gruppe og PATCHer utvidet hallIds-liste", async () => {
    const fn = mockFetchSeq([{ data: sampleRow }, { data: sampleRow }]);
    const res = await addHallToGroup("hg-1", "hall-3");
    expect(res.ok).toBe(true);
    expect(fn).toHaveBeenCalledTimes(2);
    // Second call = PATCH med hele listen (hall-1, hall-2, hall-3)
    const patchCall = fn.mock.calls[1]!;
    expect((patchCall[1] as RequestInit).method).toBe("PATCH");
    const body = JSON.parse((patchCall[1] as RequestInit).body as string);
    expect(body.hallIds).toEqual(["hall-1", "hall-2", "hall-3"]);
  });

  it("addHallToGroup er idempotent når hall allerede er medlem", async () => {
    const fn = mockFetchSeq([{ data: sampleRow }]);
    // hall-1 er allerede i sampleRow.members → ingen PATCH
    const res = await addHallToGroup("hg-1", "hall-1");
    expect(res.ok).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1); // Kun GET
  });

  it("removeHallFromGroup PATCHer liste uten fjernet hall", async () => {
    const fn = mockFetchSeq([{ data: sampleRow }, { data: sampleRow }]);
    const res = await removeHallFromGroup("hg-1", "hall-1");
    expect(res.ok).toBe(true);
    expect(fn).toHaveBeenCalledTimes(2);
    const patchCall = fn.mock.calls[1]!;
    const body = JSON.parse((patchCall[1] as RequestInit).body as string);
    expect(body.hallIds).toEqual(["hall-2"]);
  });

  it("removeHallFromGroup er idempotent når hall ikke er medlem", async () => {
    const fn = mockFetchSeq([{ data: sampleRow }]);
    const res = await removeHallFromGroup("hg-1", "hall-does-not-exist");
    expect(res.ok).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("addHallToGroup avviser tom hall-id lokalt uten fetch", async () => {
    const fn = mockFetchOk(sampleRow);
    const res = await addHallToGroup("hg-1", "   ");
    expect(res).toEqual({
      ok: false,
      reason: "VALIDATION",
      message: "hall_id_invalid",
    });
    expect(fn).not.toHaveBeenCalled();
  });
});

// ── Description ekstraksjon + klient-side search ────────────────────────────

describe("GroupHallState — description + search", () => {
  it("getDescriptionFromRow trekker ut `extra.description`", () => {
    expect(getDescriptionFromRow(sampleRow)).toBe("Pilot-link");
    expect(
      getDescriptionFromRow({ ...sampleRow, extra: {} })
    ).toBe("");
  });

  it("klient-side search over fetchHallGroupList matcher name, id og hallName", async () => {
    const rows: HallGroupRow[] = [
      sampleRow,
      { ...sampleRow, id: "hg-2", name: "Sør-gruppen", members: [] },
    ];
    mockFetchOk({ groups: rows, count: 2 });
    const filtered = await fetchHallGroupList({ search: "oslo" });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe("hg-1");
  });

  it("klient-side search returnerer alt når search er tomt", async () => {
    const rows: HallGroupRow[] = [
      sampleRow,
      { ...sampleRow, id: "hg-2", name: "Sør", members: [] },
    ];
    mockFetchOk({ groups: rows, count: 2 });
    const all = await fetchHallGroupList({ search: "   " });
    expect(all).toHaveLength(2);
  });
});
