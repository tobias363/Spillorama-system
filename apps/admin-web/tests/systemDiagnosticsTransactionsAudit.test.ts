// BIN-678 + BIN-655 — tests for SystemDiagnostics, TransactionsLog, AuditLog pages.
//
// Bruker installFetch-stub (samme mønster som cmsSettingsSystemInfoOtherGames.test.ts).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initI18n } from "../src/i18n/I18n.js";
import {
  isSystemInformationRoute,
  mountSystemInformationRoute,
} from "../src/pages/systemInformation/index.js";
import {
  isTransactionRoute,
  mountTransactionRoute,
} from "../src/pages/transactions/index.js";
import {
  isAuditLogRoute,
  mountAuditLogRoute,
} from "../src/pages/auditLog/index.js";

// ── Harness ─────────────────────────────────────────────────────────────────

async function tick(rounds = 12): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise<void>((r) => setTimeout(r, 0));
}

function container(): HTMLElement {
  document.body.innerHTML = `<div id="app"></div>`;
  return document.getElementById("app")!;
}

type FetchHandler = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Response | Promise<Response>;

function installFetch(handler: FetchHandler): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    return handler(input, init);
  }) as typeof fetch;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function apiOk<T>(data: T): Response {
  return jsonResponse(200, { ok: true, data });
}

function urlPath(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return `${input.pathname}${input.search}`;
  return input.url;
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  initI18n();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ── Feature A: SystemDiagnostics ────────────────────────────────────────────

describe("BIN-678 — SystemDiagnosticsPage", () => {
  it("routes /system/info via isSystemInformationRoute", () => {
    expect(isSystemInformationRoute("/system/info")).toBe(true);
    expect(isSystemInformationRoute("/system/systemInformation")).toBe(true);
    expect(isSystemInformationRoute("/unknown")).toBe(false);
  });

  it("renders snapshot from /api/admin/system/info", async () => {
    installFetch((input) => {
      const url = urlPath(input);
      if (url.startsWith("/api/admin/system/info")) {
        return apiOk({
          version: "1.2.3",
          buildSha: "abcdef1",
          buildTime: "2026-04-20T10:00:00.000Z",
          nodeVersion: "v22.0.0",
          env: "test",
          uptime: 3600,
          features: { example_a: true, example_b: false },
        });
      }
      return jsonResponse(404, { ok: false, error: { code: "NOT_MOCKED" } });
    });
    const host = container();
    mountSystemInformationRoute(host, "/system/info");
    await tick(20);
    const body = host.querySelector<HTMLElement>("[data-testid='system-info-body']")!;
    expect(body.innerHTML).toContain("1.2.3");
    expect(body.innerHTML).toContain("abcdef1");
    expect(body.innerHTML).toContain("v22.0.0");
    expect(body.innerHTML).toContain("3600");
    // Feature flags vises
    const flags = host.querySelector<HTMLElement>("[data-testid='system-info-flags']")!;
    expect(flags.innerHTML).toContain("example_a");
    expect(flags.innerHTML).toContain("example_b");
  });

  it("shows empty-state when no feature flags are set", async () => {
    installFetch((input) => {
      const url = urlPath(input);
      if (url.startsWith("/api/admin/system/info")) {
        return apiOk({
          version: "1.0.0",
          buildSha: "sha",
          buildTime: "2026-01-01T00:00:00.000Z",
          nodeVersion: "v22.0.0",
          env: "prod",
          uptime: 1,
          features: {},
        });
      }
      return jsonResponse(404, { ok: false, error: { code: "NOT_MOCKED" } });
    });
    const host = container();
    mountSystemInformationRoute(host, "/system/info");
    await tick(20);
    expect(
      host.querySelector<HTMLElement>("[data-testid='system-info-flags-empty']")
    ).not.toBeNull();
  });
});

// ── Feature B: TransactionsLog ──────────────────────────────────────────────

describe("BIN-655 — TransactionsLogPage", () => {
  it("routes /transactions/log via isTransactionRoute", () => {
    expect(isTransactionRoute("/transactions/log")).toBe(true);
    expect(isTransactionRoute("/unknown")).toBe(false);
  });

  it("mountes tabell fra /api/admin/transactions", async () => {
    installFetch((input) => {
      const url = urlPath(input);
      if (url.startsWith("/api/admin/transactions")) {
        return apiOk({
          items: [
            {
              id: "wallet:tx-1",
              source: "wallet",
              type: "wallet.debit",
              amountCents: -100,
              timestamp: "2026-04-20T10:00:00.000Z",
              userId: "u-1",
              hallId: null,
              description: "stake",
            },
            {
              id: "agent:tx-2",
              source: "agent",
              type: "agent.cash_in",
              amountCents: 5000,
              timestamp: "2026-04-20T09:00:00.000Z",
              userId: "u-2",
              hallId: "h-a",
              description: "CASH_IN (CASH)",
            },
          ],
          nextCursor: null,
        });
      }
      return jsonResponse(404, { ok: false, error: { code: "NOT_MOCKED" } });
    });
    const host = container();
    mountTransactionRoute(host, "/transactions/log");
    await tick(20);
    const table = host.querySelector<HTMLElement>("[data-testid='tx-table']")!;
    expect(table.innerHTML).toContain("wallet.debit");
    expect(table.innerHTML).toContain("agent.cash_in");
    // Load-more er skjult uten nextCursor
    const loadMore = host.querySelector<HTMLButtonElement>(
      "[data-testid='tx-load-more']"
    )!;
    expect(loadMore.style.display).toBe("none");
  });

  it("viser load-more når nextCursor er satt, og appender side 2", async () => {
    let callIdx = 0;
    installFetch((input) => {
      const url = urlPath(input);
      if (url.startsWith("/api/admin/transactions")) {
        callIdx++;
        if (callIdx === 1) {
          return apiOk({
            items: [
              {
                id: "w:1",
                source: "wallet",
                type: "wallet.topup",
                amountCents: 100,
                timestamp: "2026-04-20T10:00:00.000Z",
                userId: "u",
                hallId: null,
                description: "first",
              },
            ],
            nextCursor: "cursor-abc",
          });
        }
        return apiOk({
          items: [
            {
              id: "w:2",
              source: "wallet",
              type: "wallet.topup",
              amountCents: 200,
              timestamp: "2026-04-20T09:00:00.000Z",
              userId: "u",
              hallId: null,
              description: "second",
            },
          ],
          nextCursor: null,
        });
      }
      return jsonResponse(404, { ok: false, error: { code: "NOT_MOCKED" } });
    });
    const host = container();
    mountTransactionRoute(host, "/transactions/log");
    await tick(20);
    const loadMore = host.querySelector<HTMLButtonElement>(
      "[data-testid='tx-load-more']"
    )!;
    expect(loadMore.style.display).not.toBe("none");
    loadMore.click();
    await tick(20);
    const table = host.querySelector<HTMLElement>("[data-testid='tx-table']")!;
    expect(table.innerHTML).toContain("first");
    expect(table.innerHTML).toContain("second");
    expect(loadMore.style.display).toBe("none");
  });
});

// ── Feature C: AuditLog ─────────────────────────────────────────────────────

describe("BIN-655 (alt) — AuditLogPage", () => {
  it("routes /auditLog via isAuditLogRoute", () => {
    expect(isAuditLogRoute("/auditLog")).toBe(true);
    expect(isAuditLogRoute("/unknown")).toBe(false);
  });

  it("mountes tabell fra /api/admin/audit-log", async () => {
    installFetch((input) => {
      const url = urlPath(input);
      if (url.startsWith("/api/admin/audit-log")) {
        return apiOk({
          items: [
            {
              id: "1",
              actorId: "admin-1",
              actorType: "ADMIN",
              action: "user.role.change",
              resource: "user",
              resourceId: "u-2",
              details: { from: "PLAYER", to: "SUPPORT" },
              ipAddress: "127.0.0.1",
              userAgent: null,
              createdAt: "2026-04-20T10:00:00.000Z",
            },
          ],
          nextCursor: null,
        });
      }
      return jsonResponse(404, { ok: false, error: { code: "NOT_MOCKED" } });
    });
    const host = container();
    mountAuditLogRoute(host, "/auditLog");
    await tick(20);
    const table = host.querySelector<HTMLElement>("[data-testid='audit-table']")!;
    expect(table.innerHTML).toContain("user.role.change");
    expect(table.innerHTML).toContain("admin-1");
    expect(table.innerHTML).toContain("127.0.0.1");
  });

  it("filter-form sender actorId + resource + action til API", async () => {
    let receivedUrl = "";
    installFetch((input) => {
      const url = urlPath(input);
      if (url.startsWith("/api/admin/audit-log")) {
        receivedUrl = url;
        return apiOk({ items: [], nextCursor: null });
      }
      return jsonResponse(404, { ok: false, error: { code: "NOT_MOCKED" } });
    });
    const host = container();
    mountAuditLogRoute(host, "/auditLog");
    await tick(20);
    (host.querySelector<HTMLInputElement>("[data-testid='audit-actor']")!).value =
      "a-1";
    (host.querySelector<HTMLInputElement>("[data-testid='audit-resource']")!).value =
      "hall";
    (host.querySelector<HTMLInputElement>("[data-testid='audit-action']")!).value =
      "hall.create";
    const form = host.querySelector<HTMLFormElement>(
      "[data-testid='audit-filter-form']"
    )!;
    form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await tick(20);
    expect(receivedUrl).toContain("actorId=a-1");
    expect(receivedUrl).toContain("resource=hall");
    expect(receivedUrl).toContain("action=hall.create");
  });
});
