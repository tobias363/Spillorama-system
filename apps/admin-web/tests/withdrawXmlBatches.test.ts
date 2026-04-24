// Tests for XmlBatchesPage (wireframe 16.20).
// Dekker:
//   - mount + GET /api/admin/withdraw/xml-batches
//   - "Generer XML nå"-knapp (kun synlig med edit-permission)
//   - Export trigger: POST /api/admin/withdraw/xml-batches/export
//   - Resend: POST /api/admin/withdraw/xml-batches/:id/resend
//   - Empty-state når ingen batcher
//   - fail-closed: backend 500 → callout-danger

import { describe, it, expect, beforeEach, vi } from "vitest";
import { initI18n } from "../src/i18n/I18n.js";
import { setSession, type Session } from "../src/auth/Session.js";
import {
  isAmountwithdrawRoute,
  mountAmountwithdrawRoute,
} from "../src/pages/amountwithdraw/index.js";
import type { XmlExportBatch } from "../src/api/admin-withdraw-xml.js";

function adminSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "u1",
    name: "Admin",
    email: "admin@example.com",
    role: "admin",
    isSuperAdmin: true,
    avatar: "",
    hall: [],
    dailyBalance: null,
    permissions: {},
    ...overrides,
  };
}

function operatorSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "u2",
    name: "Operator",
    email: "op@example.com",
    role: "agent",
    isSuperAdmin: false,
    avatar: "",
    hall: [{ id: "hall-1", name: "Oslo Sentrum" }],
    dailyBalance: null,
    permissions: {},
    ...overrides,
  };
}

function mockApiRouter(
  routes: Array<{ match: RegExp; method?: string; handler: (url: string, init?: RequestInit) => unknown; status?: number }>
): ReturnType<typeof vi.fn> {
  const fn = vi.fn();
  fn.mockImplementation((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const route = routes.find((r) => r.match.test(url) && (!r.method || r.method === method));
    if (!route) {
      return Promise.resolve(
        new Response(JSON.stringify({ ok: false, error: { code: "NOT_MOCKED", message: url } }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        })
      );
    }
    const body = route.handler(url, init);
    const status = route.status ?? 200;
    const ok = status < 400;
    return Promise.resolve(
      new Response(JSON.stringify(ok ? { ok: true, data: body } : body), {
        status,
        headers: { "Content-Type": "application/json" },
      })
    );
  });
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return fn;
}

async function tick(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise<void>((r) => setTimeout(r, 0));
}

const SAMPLE_BATCH: XmlExportBatch = {
  id: "batch-uuid-aaaabbbb",
  agentUserId: "agent-1",
  generatedAt: "2026-04-24T23:00:00.000Z",
  xmlFilePath: "/tmp/x.xml",
  emailSentAt: "2026-04-24T23:01:00.000Z",
  recipientEmails: ["acc@example.com"],
  withdrawRequestCount: 3,
};

beforeEach(() => {
  initI18n();
  document.body.innerHTML = "";
  window.localStorage.setItem("bingo_admin_access_token", "tok");
  setSession(adminSession());
});

describe("isAmountwithdrawRoute", () => {
  it("includes new /withdraw/xml-batches route", () => {
    expect(isAmountwithdrawRoute("/withdraw/xml-batches")).toBe(true);
  });
});

describe("XmlBatchesPage", () => {
  it("GETs /api/admin/withdraw/xml-batches on mount + renders batch row", async () => {
    const api = mockApiRouter([
      {
        match: /\/api\/admin\/withdraw\/xml-batches/,
        handler: () => ({ batches: [SAMPLE_BATCH], count: 1 }),
      },
    ]);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountAmountwithdrawRoute(root, "/withdraw/xml-batches");
    await tick();
    expect(
      api.mock.calls.some(([u]) =>
        String(u).startsWith("/api/admin/withdraw/xml-batches")
      )
    ).toBe(true);
    // Batch-ID-prefiks rendres som <code>
    expect(root.textContent).toContain("batch-uu");
    // Antall uttak vises
    expect(root.textContent).toContain("3");
  });

  it("empty-state: viser 'ingen batcher'-callout når listen er tom", async () => {
    mockApiRouter([
      {
        match: /\/api\/admin\/withdraw\/xml-batches/,
        handler: () => ({ batches: [], count: 0 }),
      },
    ]);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountAmountwithdrawRoute(root, "/withdraw/xml-batches");
    await tick();
    const callout = root.querySelector(".callout-info");
    expect(callout).toBeTruthy();
    expect(callout!.textContent!.toLowerCase()).toContain("ingen batcher");
  });

  it("fail-closed: backend 500 → callout-danger (ikke tom tabell)", async () => {
    mockApiRouter([
      {
        match: /\/api\/admin\/withdraw\/xml-batches/,
        handler: () => ({ ok: false, error: { code: "INTERNAL", message: "boom" } }),
        status: 500,
      },
    ]);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountAmountwithdrawRoute(root, "/withdraw/xml-batches");
    await tick(10);
    expect(root.querySelector(".callout-danger")).toBeTruthy();
  });

  it("'Generate XML nå'-knapp skjult uten edit-permission", async () => {
    setSession(
      operatorSession({
        permissions: { "Withdraw Management": { view: true, add: false, edit: false, delete: false } },
      })
    );
    mockApiRouter([
      {
        match: /\/api\/admin\/withdraw\/xml-batches/,
        handler: () => ({ batches: [], count: 0 }),
      },
    ]);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountAmountwithdrawRoute(root, "/withdraw/xml-batches");
    await tick();
    expect(root.querySelector("[data-action='export']")).toBeNull();
  });

  it("Admin: export-knapp POSTer til /export og refresher", async () => {
    let exportCalled = false;
    const api = mockApiRouter([
      {
        match: /\/api\/admin\/withdraw\/xml-batches\/export/,
        method: "POST",
        handler: () => {
          exportCalled = true;
          return {
            batch: SAMPLE_BATCH,
            rowCount: 3,
            email: { sent: true, skipped: false, deliveredTo: ["acc@example.com"], failedFor: [] },
          };
        },
      },
      {
        match: /\/api\/admin\/withdraw\/xml-batches/,
        method: "GET",
        handler: () => ({ batches: [SAMPLE_BATCH], count: 1 }),
      },
    ]);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountAmountwithdrawRoute(root, "/withdraw/xml-batches");
    await tick();
    const exportBtn = root.querySelector<HTMLButtonElement>("[data-action='export']");
    expect(exportBtn).toBeTruthy();
    exportBtn!.click();
    await tick(10);
    expect(exportCalled).toBe(true);
    // Refresh-fetchen etterpå
    const getCalls = api.mock.calls.filter(
      ([u, i]) =>
        String(u).startsWith("/api/admin/withdraw/xml-batches") &&
        (!i || (i as RequestInit).method !== "POST")
    );
    expect(getCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("Admin: resend-knapp POSTer til /:id/resend", async () => {
    let resendUrl: string | null = null;
    mockApiRouter([
      {
        match: /\/api\/admin\/withdraw\/xml-batches\/.+\/resend/,
        method: "POST",
        handler: (url) => {
          resendUrl = url;
          return {
            batch: SAMPLE_BATCH,
            email: { sent: true, skipped: false, deliveredTo: ["acc@example.com"], failedFor: [] },
          };
        },
      },
      {
        match: /\/api\/admin\/withdraw\/xml-batches/,
        method: "GET",
        handler: () => ({ batches: [SAMPLE_BATCH], count: 1 }),
      },
    ]);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountAmountwithdrawRoute(root, "/withdraw/xml-batches");
    await tick(8);
    const resendBtn = root.querySelector<HTMLButtonElement>("[data-action='resend']");
    expect(resendBtn).toBeTruthy();
    resendBtn!.click();
    await tick(10);
    expect(resendUrl).toContain("batch-uuid-aaaabbbb");
    expect(resendUrl).toContain("/resend");
  });
});
