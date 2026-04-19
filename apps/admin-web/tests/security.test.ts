// PR-B6 (BIN-664) — tests for the security / blocked-IP admin pages.
// Covers:
//   - route-dispatcher contract
//   - BlockedIpsPage renders list + fail-closed
//   - Add modal POSTs the correct payload
//   - Edit = DELETE + POST (two audit-events; see module header)
//   - Delete confirm modal calls DELETE

import { describe, it, expect, beforeEach, vi } from "vitest";
import { initI18n } from "../src/i18n/I18n.js";
import { setSession, type Session } from "../src/auth/Session.js";
import {
  isSecurityRoute,
  mountSecurityRoute,
} from "../src/pages/security/index.js";

function adminSession(): Session {
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
  };
}

interface MockRoute {
  match: RegExp;
  method?: string;
  handler: (url: string, init: RequestInit | undefined) => unknown;
  status?: number;
}

function mockApiRouter(routes: MockRoute[]): ReturnType<typeof vi.fn> {
  const fn = vi.fn();
  fn.mockImplementation((url: string, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const route = routes.find(
      (r) => r.match.test(url) && (r.method ? r.method.toUpperCase() === method : true)
    );
    if (!route) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            ok: false,
            error: { code: "NOT_MOCKED", message: `${method} ${url}` },
          }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        )
      );
    }
    const body = route.handler(url, init);
    const status = route.status ?? 200;
    return Promise.resolve(
      new Response(JSON.stringify(status < 400 ? { ok: true, data: body } : body), {
        status,
        headers: { "Content-Type": "application/json" },
      })
    );
  });
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return fn;
}

async function tick(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise<void>((r) => setTimeout(r, 0));
}

const SAMPLE_IPS = [
  {
    id: "ip-1",
    ipAddress: "192.0.2.1",
    reason: "abuse",
    blockedBy: "u1",
    expiresAt: null,
    createdAt: "2026-04-19T00:00:00.000Z",
  },
  {
    id: "ip-2",
    ipAddress: "2001:db8::1",
    reason: null,
    blockedBy: "u1",
    expiresAt: "2026-05-01T23:59:59.000Z",
    createdAt: "2026-04-18T00:00:00.000Z",
  },
];

beforeEach(() => {
  initI18n();
  document.body.innerHTML = "";
  window.location.hash = "";
  window.localStorage.setItem("bingo_admin_access_token", "tok");
  setSession(adminSession());
});

describe("isSecurityRoute", () => {
  it("matches only declared routes", () => {
    expect(isSecurityRoute("/blockedIp")).toBe(true);
    expect(isSecurityRoute("/riskCountry")).toBe(false);
    expect(isSecurityRoute("/blockedIp/add")).toBe(false);
  });
});

describe("BlockedIpsPage", () => {
  it("renders IPs + delete confirm modal calls DELETE", async () => {
    const api = mockApiRouter([
      {
        match: /\/api\/admin\/security\/blocked-ips$/,
        method: "GET",
        handler: () => ({ ips: SAMPLE_IPS, count: SAMPLE_IPS.length }),
      },
      {
        match: /\/api\/admin\/security\/blocked-ips\/ip-1$/,
        method: "DELETE",
        handler: () => ({ removed: true }),
      },
    ]);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountSecurityRoute(root, "/blockedIp");
    await tick();

    expect(root.textContent).toContain("192.0.2.1");
    expect(root.textContent).toContain("2001:db8::1");
    expect(root.textContent).toContain("abuse");

    const delBtn = root.querySelector<HTMLButtonElement>(
      'button[data-action="delete-blocked-ip"][data-id="ip-1"]'
    )!;
    expect(delBtn).toBeTruthy();
    delBtn.click();
    await tick();

    const confirm = document.querySelector<HTMLButtonElement>(
      'button[data-action="confirm"]'
    )!;
    expect(confirm).toBeTruthy();
    confirm.click();
    await tick();

    expect(
      api.mock.calls.some(
        ([u, init]) =>
          String(u).endsWith("/api/admin/security/blocked-ips/ip-1") &&
          String((init as RequestInit)?.method ?? "GET").toUpperCase() === "DELETE"
      )
    ).toBe(true);
  });

  it("fail-closed: backend-500 shows callout-danger and no silent empty list", async () => {
    mockApiRouter([
      {
        match: /\/api\/admin\/security\/blocked-ips/,
        handler: () => ({ ok: false, error: { code: "INTERNAL", message: "boom" } }),
        status: 500,
      },
    ]);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountSecurityRoute(root, "/blockedIp");
    await tick(10);
    expect(root.querySelector(".callout-danger")).toBeTruthy();
  });

  it("Add modal POSTs /api/admin/security/blocked-ips with normalised payload", async () => {
    const posted: unknown[] = [];
    mockApiRouter([
      {
        match: /\/api\/admin\/security\/blocked-ips$/,
        method: "GET",
        handler: () => ({ ips: SAMPLE_IPS, count: SAMPLE_IPS.length }),
      },
      {
        match: /\/api\/admin\/security\/blocked-ips$/,
        method: "POST",
        handler: (_u, init) => {
          posted.push(JSON.parse(String(init?.body ?? "{}")));
          return {
            id: "ip-new",
            ipAddress: "203.0.113.5",
            reason: "suspicious",
            blockedBy: "u1",
            expiresAt: null,
            createdAt: "2026-04-19T10:00:00.000Z",
          };
        },
      },
    ]);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountSecurityRoute(root, "/blockedIp");
    await tick();

    const addBtn = root.querySelector<HTMLButtonElement>(
      'button[data-action="add-blocked-ip"]'
    )!;
    expect(addBtn).toBeTruthy();
    addBtn.click();
    await tick();

    const form = document.querySelector<HTMLFormElement>(
      'form[data-testid="add-blocked-ip-form"]'
    )!;
    expect(form).toBeTruthy();
    form.querySelector<HTMLInputElement>("#bip-ip")!.value = "203.0.113.5";
    form.querySelector<HTMLInputElement>("#bip-reason")!.value = "suspicious";

    const submit = document.querySelector<HTMLButtonElement>(
      'button[data-action="submit"]'
    )!;
    submit.click();
    await tick();

    expect(posted.length).toBe(1);
    expect(posted[0]).toMatchObject({
      ipAddress: "203.0.113.5",
      reason: "suspicious",
      expiresAt: null,
    });
  });

  it("Edit = DELETE + POST (two audit-events, see module header)", async () => {
    const deleted: string[] = [];
    const posted: unknown[] = [];
    mockApiRouter([
      {
        match: /\/api\/admin\/security\/blocked-ips$/,
        method: "GET",
        handler: () => ({ ips: SAMPLE_IPS, count: SAMPLE_IPS.length }),
      },
      {
        match: /\/api\/admin\/security\/blocked-ips\/ip-1$/,
        method: "DELETE",
        handler: (u) => {
          deleted.push(String(u));
          return { removed: true };
        },
      },
      {
        match: /\/api\/admin\/security\/blocked-ips$/,
        method: "POST",
        handler: (_u, init) => {
          posted.push(JSON.parse(String(init?.body ?? "{}")));
          return {
            id: "ip-1-new",
            ipAddress: "192.0.2.2",
            reason: "updated",
            blockedBy: "u1",
            expiresAt: null,
            createdAt: "2026-04-19T12:00:00.000Z",
          };
        },
      },
    ]);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountSecurityRoute(root, "/blockedIp");
    await tick();

    const editBtn = root.querySelector<HTMLButtonElement>(
      'button[data-action="edit-blocked-ip"][data-id="ip-1"]'
    )!;
    expect(editBtn).toBeTruthy();
    editBtn.click();
    await tick();

    const form = document.querySelector<HTMLFormElement>(
      'form[data-testid="edit-blocked-ip-form"]'
    )!;
    expect(form).toBeTruthy();
    form.querySelector<HTMLInputElement>("#bip-ip")!.value = "192.0.2.2";
    form.querySelector<HTMLInputElement>("#bip-reason")!.value = "updated";

    const submit = document.querySelector<HTMLButtonElement>(
      'button[data-action="submit"]'
    )!;
    submit.click();
    await tick();

    expect(deleted.length).toBe(1);
    expect(posted.length).toBe(1);
    expect(posted[0]).toMatchObject({
      ipAddress: "192.0.2.2",
      reason: "updated",
    });
  });
});
