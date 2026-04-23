// Role Management — tester for AgentRolePermissionsPage.
//
// Dekker:
//   - render via dispatcher (mountRoleRoute("/role/agent"))
//   - agent-dropdown populert fra GET /api/admin/agents
//   - matrix-tabell vises etter agent-valg (GET permissions)
//   - PUT-call ved submit med full 15-rads payload
//   - Player Management renderes by default som checked + disabled

import { describe, it, expect, beforeEach, vi } from "vitest";
import { initI18n } from "../src/i18n/I18n.js";
import { setSession, type Session } from "../src/auth/Session.js";
import { isRoleRoute, mountRoleRoute } from "../src/pages/role/index.js";
import { AGENT_PERMISSION_MODULES } from "../src/api/admin-agent-permissions.js";

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

function mockApi(routes: MockRoute[]): ReturnType<typeof vi.fn> {
  const fn = vi.fn();
  fn.mockImplementation((url: string, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const r = routes.find(
      (x) =>
        x.match.test(url) && (x.method ? x.method.toUpperCase() === method : true)
    );
    if (!r) {
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
    const body = r.handler(url, init);
    const status = r.status ?? 200;
    return Promise.resolve(
      new Response(
        JSON.stringify(status < 400 ? { ok: true, data: body } : body),
        {
          status,
          headers: { "Content-Type": "application/json" },
        }
      )
    );
  });
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return fn;
}

async function tick(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise<void>((r) => setTimeout(r, 0));
}

const SAMPLE_AGENT = {
  userId: "agent-1",
  email: "agent1@test.no",
  displayName: "Ola",
  surname: "Agent",
  phone: null,
  role: "AGENT",
  agentStatus: "active",
  language: "nb",
  avatarFilename: null,
  parentUserId: null,
  halls: [],
  createdAt: "2026-04-19T00:00:00Z",
  updatedAt: "2026-04-19T00:00:00Z",
};

function defaultPermissions() {
  return AGENT_PERMISSION_MODULES.map((module) => {
    if (module === "player") {
      return {
        module,
        canCreate: true,
        canEdit: true,
        canView: true,
        canDelete: true,
        canBlockUnblock: true,
        updatedAt: null,
        updatedBy: null,
      };
    }
    return {
      module,
      canCreate: false,
      canEdit: false,
      canView: false,
      canDelete: false,
      canBlockUnblock: false,
      updatedAt: null,
      updatedBy: null,
    };
  });
}

beforeEach(() => {
  initI18n();
  document.body.innerHTML = "";
  window.location.hash = "";
  window.localStorage.setItem("bingo_admin_access_token", "tok");
  setSession(adminSession());
});

describe("dispatcher", () => {
  it("isRoleRoute includes /role/agent", () => {
    expect(isRoleRoute("/role/agent")).toBe(true);
  });
});

describe("AgentRolePermissionsPage", () => {
  it("renders agent dropdown from listAgents", async () => {
    mockApi([
      {
        match: /\/api\/admin\/agents(\?|$)/,
        handler: () => ({ agents: [SAMPLE_AGENT], limit: 100, offset: 0 }),
      },
    ]);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountRoleRoute(root, "/role/agent");
    await tick();

    const select = root.querySelector<HTMLSelectElement>(
      '[data-testid="agent-perm-select"]'
    );
    expect(select).toBeTruthy();
    const options = Array.from(select!.options).map((o) => o.value);
    expect(options).toContain("agent-1");
  });

  it("loads permissions matrix when agent is selected", async () => {
    mockApi([
      {
        match: /\/api\/admin\/agents(\?|$)/,
        handler: () => ({ agents: [SAMPLE_AGENT], limit: 100, offset: 0 }),
      },
      {
        match: /\/api\/admin\/agents\/agent-1\/permissions/,
        method: "GET",
        handler: () => ({
          agentId: "agent-1",
          permissions: defaultPermissions(),
        }),
      },
    ]);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountRoleRoute(root, "/role/agent");
    await tick();

    const select = root.querySelector<HTMLSelectElement>(
      '[data-testid="agent-perm-select"]'
    )!;
    select.value = "agent-1";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await tick(10);

    const table = root.querySelector(
      '[data-testid="agent-perm-matrix-table"]'
    );
    expect(table).toBeTruthy();

    // 15 rows — én per modul.
    const rows = table!.querySelectorAll("tbody tr");
    expect(rows.length).toBe(AGENT_PERMISSION_MODULES.length);

    // Player-row skal ha checked checkboxes, men disabled.
    const playerCreate = table!.querySelector<HTMLInputElement>(
      'input[data-module="player"][data-field="canCreate"]'
    );
    expect(playerCreate).toBeTruthy();
    expect(playerCreate!.checked).toBe(true);
    expect(playerCreate!.disabled).toBe(true);
  });

  it("sends full 15-module matrix in PUT on submit", async () => {
    let putBody: Record<string, unknown> | null = null;
    mockApi([
      {
        match: /\/api\/admin\/agents(\?|$)/,
        method: "GET",
        handler: () => ({ agents: [SAMPLE_AGENT], limit: 100, offset: 0 }),
      },
      {
        match: /\/api\/admin\/agents\/agent-1\/permissions/,
        method: "GET",
        handler: () => ({
          agentId: "agent-1",
          permissions: defaultPermissions(),
        }),
      },
      {
        match: /\/api\/admin\/agents\/agent-1\/permissions/,
        method: "PUT",
        handler: (_u, init) => {
          putBody = JSON.parse(String(init?.body ?? "{}"));
          return {
            agentId: "agent-1",
            permissions: defaultPermissions(),
          };
        },
      },
    ]);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountRoleRoute(root, "/role/agent");
    await tick();

    const select = root.querySelector<HTMLSelectElement>(
      '[data-testid="agent-perm-select"]'
    )!;
    select.value = "agent-1";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await tick(10);

    // Toggle schedule.canView on.
    const scheduleView = root.querySelector<HTMLInputElement>(
      'input[data-module="schedule"][data-field="canView"]'
    )!;
    scheduleView.checked = true;

    const submit = root.querySelector<HTMLButtonElement>(
      '[data-testid="agent-perm-submit"]'
    )!;
    submit.click();
    await tick(10);

    expect(putBody).toBeTruthy();
    const perms = (putBody as unknown as { permissions: unknown[] }).permissions;
    expect(Array.isArray(perms)).toBe(true);
    expect(perms.length).toBe(AGENT_PERMISSION_MODULES.length);
    const schedule = (perms as Array<Record<string, unknown>>).find(
      (p) => p.module === "schedule"
    );
    expect(schedule).toBeTruthy();
    expect(schedule!.canView).toBe(true);
    expect(schedule!.canCreate).toBe(false);
  });
});
