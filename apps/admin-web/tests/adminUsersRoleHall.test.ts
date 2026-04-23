// PR-A5 (BIN-663) — tests for admin/user/agent/role/hall/groupHall pages.
// Focus: route-dispatcher contract, list render, placeholder banner,
// static role matrix, toggle-hall PUT payload. Tight scope to fit LOC budget.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { initI18n } from "../src/i18n/I18n.js";
import { setSession, type Session } from "../src/auth/Session.js";
import {
  isAdminUsersRoute,
  mountAdminUsersRoute,
} from "../src/pages/adminUsers/index.js";
import { isRoleRoute, mountRoleRoute } from "../src/pages/role/index.js";
import { isHallRoute, mountHallRoute } from "../src/pages/hall/index.js";
import {
  isGroupHallRoute,
  mountGroupHallRoute,
} from "../src/pages/groupHall/index.js";

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
      (x) => x.match.test(url) && (x.method ? x.method.toUpperCase() === method : true)
    );
    if (!r) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ ok: false, error: { code: "NOT_MOCKED", message: `${method} ${url}` } }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        )
      );
    }
    const body = r.handler(url, init);
    const status = r.status ?? 200;
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

const USER = (role: string, id = "u-" + role) => ({
  id,
  email: `${id}@ex.com`,
  displayName: "Ola",
  surname: "Nordmann",
  phone: null,
  role,
  hallId: null,
  kycStatus: "VERIFIED",
  createdAt: "2026-04-19T00:00:00Z",
  updatedAt: "2026-04-19T00:00:00Z",
});

const SAMPLE_HALL = {
  id: "hall-a",
  slug: "a1",
  name: "Hall A",
  region: "Oslo",
  address: "",
  isActive: true,
  clientVariant: "web",
  createdAt: "2026-04-19T00:00:00Z",
  updatedAt: "2026-04-19T00:00:00Z",
};

beforeEach(() => {
  initI18n();
  document.body.innerHTML = "";
  window.location.hash = "";
  window.localStorage.setItem("bingo_admin_access_token", "tok");
  setSession(adminSession());
});

describe("dispatchers", () => {
  it("isAdminUsersRoute matches static + regex", () => {
    expect(isAdminUsersRoute("/adminUser")).toBe(true);
    expect(isAdminUsersRoute("/adminUser/add")).toBe(true);
    expect(isAdminUsersRoute("/adminUser/edit/abc")).toBe(true);
    expect(isAdminUsersRoute("/adminUser/editRole/abc")).toBe(true);
    expect(isAdminUsersRoute("/agent")).toBe(true);
    expect(isAdminUsersRoute("/agent/edit/x")).toBe(true);
    expect(isAdminUsersRoute("/user")).toBe(true);
    expect(isAdminUsersRoute("/user/edit/x")).toBe(true);
    expect(isAdminUsersRoute("/wallet")).toBe(false);
  });

  it("isRoleRoute matches 4 paths", () => {
    expect(isRoleRoute("/role")).toBe(true);
    expect(isRoleRoute("/role/matrix")).toBe(true);
    expect(isRoleRoute("/role/assign")).toBe(true);
    expect(isRoleRoute("/role/agent")).toBe(true);
    expect(isRoleRoute("/role/x")).toBe(false);
  });

  it("isHallRoute matches list + add + regex edit", () => {
    expect(isHallRoute("/hall")).toBe(true);
    expect(isHallRoute("/hall/add")).toBe(true);
    expect(isHallRoute("/hall/edit/x")).toBe(true);
    expect(isHallRoute("/hallAccountReport")).toBe(false);
  });

  it("isGroupHallRoute matches 4 placeholder paths", () => {
    expect(isGroupHallRoute("/groupHall")).toBe(true);
    expect(isGroupHallRoute("/groupHall/add")).toBe(true);
    expect(isGroupHallRoute("/groupHall/edit/x")).toBe(true);
    expect(isGroupHallRoute("/groupHall/view/x")).toBe(true);
    expect(isGroupHallRoute("/hall")).toBe(false);
  });
});

describe("AdminListPage", () => {
  it("renders admin row from listAdminUsers?role=ADMIN", async () => {
    mockApi([
      {
        match: /\/api\/admin\/users\?role=ADMIN/,
        handler: () => ({ users: [USER("ADMIN")], count: 1 }),
      },
    ]);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountAdminUsersRoute(root, "/adminUser");
    await tick();
    expect(root.textContent).toContain("Ola Nordmann");
    expect(root.textContent).toContain("u-ADMIN@ex.com");
  });
});

describe("UserListPage", () => {
  it("multi-role fetches SUPPORT and HALL_OPERATOR", async () => {
    const api = mockApi([
      {
        match: /\/api\/admin\/users\?role=SUPPORT/,
        handler: () => ({ users: [USER("SUPPORT")], count: 1 }),
      },
      {
        match: /\/api\/admin\/users\?role=HALL_OPERATOR/,
        handler: () => ({ users: [USER("HALL_OPERATOR")], count: 1 }),
      },
    ]);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountAdminUsersRoute(root, "/user");
    await tick();
    expect(api.mock.calls.some(([u]) => String(u).includes("role=SUPPORT"))).toBe(true);
    expect(api.mock.calls.some(([u]) => String(u).includes("role=HALL_OPERATOR"))).toBe(true);
  });
});

describe("UserFormPage (admin variant create)", () => {
  it("POSTs /api/admin/users with role ADMIN", async () => {
    const posted: Record<string, unknown>[] = [];
    const api = mockApi([
      {
        match: /\/api\/admin\/halls/,
        handler: () => [SAMPLE_HALL],
      },
      {
        match: /\/api\/admin\/users$/,
        method: "POST",
        handler: (_u, init) => {
          posted.push(JSON.parse(String(init?.body ?? "{}")));
          return USER("ADMIN");
        },
      },
    ]);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountAdminUsersRoute(root, "/adminUser/add");
    await tick();
    const form = root.querySelector<HTMLFormElement>('[data-testid="user-form"]')!;
    expect(form).toBeTruthy();
    (form.querySelector<HTMLInputElement>("#uf-displayName")!).value = "Kari";
    (form.querySelector<HTMLInputElement>("#uf-email")!).value = "kari@ex.com";
    (form.querySelector<HTMLInputElement>("#uf-password")!).value = "supersecret";
    form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await tick(10);
    expect(api.mock.calls.some(([u, init]) =>
      String(u).endsWith("/api/admin/users") && (init?.method ?? "GET") === "POST"
    )).toBe(true);
    expect(posted[0]?.role).toBe("ADMIN");
  });
});

describe("AgentListPage", () => {
  it("renders agent with hall-names resolved", async () => {
    mockApi([
      { match: /\/api\/admin\/halls/, handler: () => [SAMPLE_HALL] },
      {
        match: /\/api\/admin\/agents/,
        handler: () => ({
          agents: [
            {
              userId: "ag-1",
              email: "ag@ex.com",
              displayName: "Per",
              surname: "Hansen",
              phone: "+47",
              role: "AGENT",
              agentStatus: "active",
              language: "no",
              avatarFilename: null,
              parentUserId: null,
              halls: [{ userId: "ag-1", hallId: "hall-a", isPrimary: true, assignedAt: "", assignedByUserId: null }],
              createdAt: "",
              updatedAt: "",
            },
          ],
          limit: 50,
          offset: 0,
        }),
      },
    ]);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountAdminUsersRoute(root, "/agent");
    await tick();
    expect(root.textContent).toContain("Per Hansen");
    expect(root.textContent).toContain("Hall A");
  });
});

describe("RoleMatrixPage", () => {
  it("renders permission grid from /api/admin/permissions", async () => {
    mockApi([
      {
        match: /\/api\/admin\/permissions/,
        handler: () => ({
          role: "ADMIN",
          permissions: ["HALL_READ"],
          permissionMap: { HALL_READ: true },
          policy: { HALL_READ: ["ADMIN", "SUPPORT"], HALL_WRITE: ["ADMIN"] },
        }),
      },
    ]);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountRoleRoute(root, "/role/matrix");
    await tick();
    const table = root.querySelector<HTMLTableElement>('[data-testid="role-matrix-table"]')!;
    expect(table).toBeTruthy();
    // 5 cols roles + 1 perm-name col = 6 headers
    expect(table.querySelectorAll("thead th").length).toBe(6);
    expect(table.querySelectorAll("tbody tr").length).toBe(2);
    // HALL_READ has ADMIN+SUPPORT granted → 2 granted cells
    const hallReadRow = Array.from(table.querySelectorAll("tbody tr"))
      .find((tr) => tr.textContent?.includes("HALL_READ"))!;
    const grantedCells = hallReadRow.querySelectorAll('[data-granted="true"]');
    expect(grantedCells.length).toBe(2);
  });
});

describe("RoleListPage", () => {
  it("renders 5 static roles + banner pointing to BIN-667", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountRoleRoute(root, "/role");
    expect(root.querySelector('[data-testid="role-info-banner"]')).toBeTruthy();
    const rows = root.querySelectorAll('[data-testid="role-list-table"] tbody tr');
    expect(rows.length).toBe(5);
  });
});

describe("HallListPage toggle", () => {
  it("PUT /api/admin/halls/:id with isActive=false on deactivate", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const puts: Array<{ url: string; body: unknown }> = [];
    mockApi([
      { match: /\/api\/admin\/halls\?/, handler: () => [SAMPLE_HALL] },
      {
        match: /\/api\/admin\/halls\/hall-a/,
        method: "PUT",
        handler: (u, init) => {
          puts.push({ url: u, body: JSON.parse(String(init?.body ?? "{}")) });
          return { ...SAMPLE_HALL, isActive: false };
        },
      },
    ]);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountHallRoute(root, "/hall");
    await tick();
    const toggleBtn = root.querySelector<HTMLButtonElement>('[data-action="toggle-hall"]')!;
    expect(toggleBtn).toBeTruthy();
    toggleBtn.click();
    await tick(10);
    expect(puts.length).toBe(1);
    expect((puts[0]!.body as Record<string, unknown>).isActive).toBe(false);
  });
});

describe("GroupHall dispatcher (PR 4e.1 wire-up, replaces BIN-663 placeholder)", () => {
  it("isGroupHallRoute matches list, add, edit and legacy view paths", () => {
    expect(isGroupHallRoute("/groupHall")).toBe(true);
    expect(isGroupHallRoute("/groupHall/add")).toBe(true);
    expect(isGroupHallRoute("/groupHall/edit/x")).toBe(true);
    expect(isGroupHallRoute("/groupHall/view/x")).toBe(true);
    expect(isGroupHallRoute("/hall")).toBe(false);
  });

  it("mountGroupHallRoute triggers GET /api/admin/hall-groups (no placeholder banner)", async () => {
    const api = mockApi([
      {
        match: /\/api\/admin\/hall-groups(\?|$)/,
        handler: () => ({ groups: [], count: 0 }),
      },
    ]);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountGroupHallRoute(root, "/groupHall");
    await tick();
    expect(root.querySelector('[data-testid="group-halls-placeholder-banner"]')).toBeNull();
    expect(root.querySelector('[data-testid="gh-list-table"]')).toBeTruthy();
    expect(root.querySelector('[data-testid="gh-add-btn"]')).toBeTruthy();
    expect(api.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});

describe("i18n keys present in both locales", () => {
  it("role_enum_*, user_management, role_desc_*, group_halls_placeholder_banner, hall_deactivate_info in no+en", async () => {
    const [no, en] = await Promise.all([
      import("../src/i18n/no.json"),
      import("../src/i18n/en.json"),
    ]);
    const required = [
      "user_management",
      "phone",
      "role",
      "role_enum_admin",
      "role_enum_support",
      "role_enum_hall_operator",
      "role_enum_agent",
      "role_enum_player",
      "role_desc_admin",
      "role_desc_support",
      "role_desc_hall_operator",
      "role_desc_agent",
      "role_desc_player",
      "role_info_static_banner",
      "group_halls_placeholder_banner",
      "hall_deactivate_info",
      "permissions",
      "permission",
      "granted",
      "denied",
      "current_role",
      "new_role",
      "update_role",
      "role_list_title",
      "role_matrix_title",
      "assign_role_title",
      "coming_post_pilot",
    ];
    for (const key of required) {
      expect((no.default as Record<string, string>)[key], `no/${key}`).toBeTypeOf("string");
      expect((en.default as Record<string, string>)[key], `en/${key}`).toBeTypeOf("string");
    }
  });
});
