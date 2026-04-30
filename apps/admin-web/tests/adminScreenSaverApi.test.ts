// Fase 1 MVP §24 — admin-screen-saver API-wrapper-tester.
//
// Verifiserer URL-konstruksjon, HTTP-method, body-shape og query-parse for
// CRUD + reorder. Bruker samme mock-patterns som adminPaymentsApi.test.ts.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ApiError } from "../src/api/client.js";
import {
  listScreenSaverImages,
  createScreenSaverImage,
  updateScreenSaverImage,
  deleteScreenSaverImage,
  reorderScreenSaverImages,
  type ScreenSaverImage,
} from "../src/api/admin-screen-saver.js";

type FetchCall = { url: string; init: RequestInit | undefined };

function mockJson(data: unknown, status = 200): typeof fetch {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    void url;
    void init;
    return new Response(JSON.stringify({ ok: status < 400, data }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fn;
  return fn;
}

function mockError(code: string, message: string, status = 400): typeof fetch {
  const fn = vi.fn(async () =>
    new Response(JSON.stringify({ ok: false, error: { code, message } }), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  ) as unknown as typeof fetch;
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fn;
  return fn;
}

function captureCall(fn: typeof fetch): FetchCall {
  const call = (fn as unknown as { mock: { calls: [string, RequestInit | undefined][] } }).mock.calls[0];
  return { url: String(call![0]), init: call![1] };
}

const SAMPLE_IMAGE: ScreenSaverImage = {
  id: "img-1",
  hallId: null,
  imageUrl: "https://cdn.example.com/x.png",
  displayOrder: 0,
  displaySeconds: 10,
  isActive: true,
  createdBy: "u1",
  createdAt: "2026-04-30T12:00:00Z",
  updatedAt: "2026-04-30T12:00:00Z",
  deletedAt: null,
};

beforeEach(() => {
  // Reset auth-token for hver test så Authorization-headeren er stabil.
  window.localStorage.clear();
  window.localStorage.setItem("bingo_admin_access_token", "test-token");
});

describe("admin-screen-saver API", () => {
  it("listScreenSaverImages: bygger riktig URL uten params", async () => {
    const fetchMock = mockJson({ images: [SAMPLE_IMAGE], count: 1 });
    const res = await listScreenSaverImages();
    const { url, init } = captureCall(fetchMock);
    expect(url).toBe("/api/admin/settings/screen-saver");
    expect(init?.method).toBe("GET");
    expect((init?.headers as Record<string, string>)?.Authorization).toBe(
      "Bearer test-token"
    );
    expect(res.images).toHaveLength(1);
  });

  it("listScreenSaverImages: setter hallId-query når oppgitt", async () => {
    const fetchMock = mockJson({ images: [], count: 0 });
    await listScreenSaverImages({ hallId: "hall-a" });
    const { url } = captureCall(fetchMock);
    expect(url).toBe("/api/admin/settings/screen-saver?hallId=hall-a");
  });

  it("listScreenSaverImages: hallId='null' filtrerer kun globale", async () => {
    const fetchMock = mockJson({ images: [], count: 0 });
    await listScreenSaverImages({ hallId: "null" });
    const { url } = captureCall(fetchMock);
    expect(url).toBe("/api/admin/settings/screen-saver?hallId=null");
  });

  it("listScreenSaverImages: kombinerer activeOnly + includeDeleted", async () => {
    const fetchMock = mockJson({ images: [], count: 0 });
    await listScreenSaverImages({ activeOnly: true, includeDeleted: true });
    const { url } = captureCall(fetchMock);
    expect(url).toContain("activeOnly=true");
    expect(url).toContain("includeDeleted=true");
  });

  it("createScreenSaverImage: POSTer body med JSON", async () => {
    const fetchMock = mockJson(SAMPLE_IMAGE);
    const res = await createScreenSaverImage({
      imageUrl: "https://cdn.example.com/x.png",
      displaySeconds: 15,
      displayOrder: 0,
      isActive: true,
    });
    const { url, init } = captureCall(fetchMock);
    expect(url).toBe("/api/admin/settings/screen-saver");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init?.body as string);
    expect(body.imageUrl).toBe("https://cdn.example.com/x.png");
    expect(body.displaySeconds).toBe(15);
    expect(res.id).toBe("img-1");
  });

  it("updateScreenSaverImage: PUT-er på riktig URL", async () => {
    const fetchMock = mockJson({ ...SAMPLE_IMAGE, displaySeconds: 20 });
    await updateScreenSaverImage("img-1", { displaySeconds: 20 });
    const { url, init } = captureCall(fetchMock);
    expect(url).toBe("/api/admin/settings/screen-saver/img-1");
    expect(init?.method).toBe("PUT");
    const body = JSON.parse(init?.body as string);
    expect(body.displaySeconds).toBe(20);
  });

  it("updateScreenSaverImage: encoder id i URL", async () => {
    const fetchMock = mockJson(SAMPLE_IMAGE);
    await updateScreenSaverImage("id with space", { isActive: false });
    const { url } = captureCall(fetchMock);
    expect(url).toBe("/api/admin/settings/screen-saver/id%20with%20space");
  });

  it("deleteScreenSaverImage: DELETE-er på riktig URL", async () => {
    const fetchMock = mockJson({ deleted: true, id: "img-1" });
    await deleteScreenSaverImage("img-1");
    const { url, init } = captureCall(fetchMock);
    expect(url).toBe("/api/admin/settings/screen-saver/img-1");
    expect(init?.method).toBe("DELETE");
  });

  it("reorderScreenSaverImages: PUT batch-endepunkt med entries-array", async () => {
    const fetchMock = mockJson({ images: [SAMPLE_IMAGE], count: 1 });
    await reorderScreenSaverImages([
      { id: "img-1", displayOrder: 0 },
      { id: "img-2", displayOrder: 1 },
    ]);
    const { url, init } = captureCall(fetchMock);
    expect(url).toBe("/api/admin/settings/screen-saver/order");
    expect(init?.method).toBe("PUT");
    const body = JSON.parse(init?.body as string);
    expect(body.entries).toHaveLength(2);
    expect(body.entries[0]).toEqual({ id: "img-1", displayOrder: 0 });
  });

  it("propagerer ApiError ved 4xx-svar", async () => {
    mockError("INVALID_IMAGE_URL", "Ugyldig URL", 400);
    await expect(
      createScreenSaverImage({ imageUrl: "ftp://x" })
    ).rejects.toBeInstanceOf(ApiError);
  });
});
