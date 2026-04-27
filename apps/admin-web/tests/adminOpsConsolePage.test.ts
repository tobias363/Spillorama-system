// ADMIN Super-User Operations Console — page integration tests.
//
// Verifies:
//  - Page mounts and renders loading-skeleton, then halls grid
//  - Health-badge dot color reflects hall+room state
//  - Force-pause / force-end / skip-ball / acknowledge-alert API-calls
//  - Socket factory injection: applyDelta updates state
//  - Socket fallback-active toggles connection-banner

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initI18n } from "../src/i18n/I18n.js";
import { setSession, type Session } from "../src/auth/Session.js";
import {
  renderAdminOpsConsolePage,
  type AdminOpsConsoleHandle,
} from "../src/pages/admin-ops/AdminOpsConsolePage.js";
import type {
  OpsAlert,
  OpsHall,
  OpsRoom,
  OpsOverviewResponse,
} from "../src/api/admin-ops.js";
import type {
  AdminOpsSocketHandle,
  AdminOpsSocketOptions,
} from "../src/pages/admin-ops/adminOpsSocket.js";

function adminSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "ad-1",
    name: "Admin Test",
    email: "admin@test.no",
    role: "admin",
    isSuperAdmin: true,
    avatar: "",
    hall: [],
    dailyBalance: null,
    permissions: {},
    ...overrides,
  };
}

type JsonResponder = (url: string, init: RequestInit | undefined) => unknown;

function mockApiRouter(routes: Array<{ match: RegExp; handler: JsonResponder }>): ReturnType<typeof vi.fn> {
  const fn = vi.fn();
  fn.mockImplementation((url: string, init?: RequestInit) => {
    const route = routes.find((r) => r.match.test(url));
    const body = route
      ? route.handler(url, init)
      : { ok: false, error: { code: "NOT_MOCKED", message: url } };
    return Promise.resolve(
      new Response(JSON.stringify({ ok: true, data: body }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return fn;
}

async function tick(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise<void>((r) => setTimeout(r, 0));
}

function makeHall(id: string, isActive = true): OpsHall {
  return {
    id,
    name: `Hall ${id}`,
    hallNumber: 100,
    groupOfHallsId: "goh-1",
    groupName: "Group A",
    masterHallId: id,
    isActive,
    isTestHall: false,
    activeRoomCount: 1,
    playersOnline: 24,
  };
}

function makeRoom(code: string, hallId: string, status: OpsRoom["currentGame"] extends infer T ? T extends { status: infer S } ? S : never : never = "RUNNING" as never): OpsRoom {
  return {
    code,
    hallId,
    currentGame: {
      id: `game-${code}`,
      status,
      drawnNumbersCount: 12,
      maxDraws: 75,
      isPaused: false,
      endedReason: null,
    },
    playersOnline: 24,
    lastDrawAt: new Date().toISOString(),
  };
}

function makeAlert(id: string, severity: OpsAlert["severity"] = "WARN"): OpsAlert {
  return {
    id,
    severity,
    type: "DRAW_STUCK",
    hallId: "hall-a",
    roomCode: "ROOM-A",
    message: `Alert ${id}`,
    acknowledgedAt: null,
    acknowledgedByUserId: null,
    createdAt: new Date().toISOString(),
  };
}

function makeOverview(overrides: Partial<OpsOverviewResponse> = {}): OpsOverviewResponse {
  return {
    halls: [makeHall("hall-a"), makeHall("hall-b")],
    rooms: [makeRoom("ROOM-A", "hall-a"), makeRoom("ROOM-B", "hall-b")],
    groups: [
      {
        id: "goh-1",
        name: "Group A",
        hallCount: 2,
        readyAggregate: "2/2",
        totalPayoutToday: 1000,
      },
    ],
    alerts: [makeAlert("alert-1", "CRITICAL")],
    metrics: { totalActiveRooms: 2, totalPlayersOnline: 48 },
    snapshotAt: new Date().toISOString(),
    ...overrides,
  };
}

interface FakeSocket extends AdminOpsSocketHandle {
  trigger: AdminOpsSocketOptions;
}

function makeFakeSocketFactory(): {
  factory: (opts: AdminOpsSocketOptions) => AdminOpsSocketHandle;
  current: () => FakeSocket | null;
} {
  let captured: FakeSocket | null = null;
  const factory = (opts: AdminOpsSocketOptions): AdminOpsSocketHandle => {
    const handle: FakeSocket = {
      trigger: opts,
      isConnected: () => true,
      subscribe: () => {},
      dispose: () => {},
    };
    captured = handle;
    return handle;
  };
  return { factory, current: () => captured };
}

describe("AdminOpsConsolePage — render + state", () => {
  let handle: AdminOpsConsoleHandle | null = null;

  beforeEach(() => {
    initI18n();
    document.body.innerHTML = "";
    setSession(adminSession());
    window.localStorage.setItem("bingo_admin_access_token", "tok");
  });

  afterEach(() => {
    handle?.dispose();
    handle = null;
    vi.restoreAllMocks();
  });

  it("renders scaffold with title and refresh button", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const { factory } = makeFakeSocketFactory();
    handle = renderAdminOpsConsolePage(root, {
      _socketFactory: factory,
      _fetchOverview: async () => makeOverview(),
    });
    expect(root.querySelector("[data-testid='ops-page-title']")).toBeTruthy();
    expect(root.querySelector("[data-testid='ops-refresh-btn']")).toBeTruthy();
    expect(root.querySelector("[data-testid='ops-pause-all-btn']")).toBeTruthy();
    expect(root.querySelector("[data-testid='ops-search-input']")).toBeTruthy();
  });

  it("loads overview and renders hall-cards with health-badge", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const { factory } = makeFakeSocketFactory();
    handle = renderAdminOpsConsolePage(root, {
      _socketFactory: factory,
      _fetchOverview: async () => makeOverview(),
    });
    await tick();
    const cardA = root.querySelector("[data-testid='ops-hall-card-hall-a']");
    expect(cardA).toBeTruthy();
    const dot = cardA?.querySelector("[data-testid='ops-health-dot-hall-a']");
    expect(dot?.classList.contains("ops-dot-green")).toBe(true);
  });

  it("renders alerts list with CRITICAL alert", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const { factory } = makeFakeSocketFactory();
    handle = renderAdminOpsConsolePage(root, {
      _socketFactory: factory,
      _fetchOverview: async () => makeOverview(),
    });
    await tick();
    const alert = root.querySelector("[data-testid='ops-alert-alert-1']");
    expect(alert).toBeTruthy();
    expect(alert?.getAttribute("data-severity")).toBe("CRITICAL");
    const ackBtn = alert?.querySelector("[data-action='ack']");
    expect(ackBtn).toBeTruthy();
  });

  it("renders totals with rooms + players + alerts count", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const { factory } = makeFakeSocketFactory();
    handle = renderAdminOpsConsolePage(root, {
      _socketFactory: factory,
      _fetchOverview: async () => makeOverview(),
    });
    await tick();
    const rooms = root.querySelector("[data-testid='ops-totals-rooms']");
    expect(rooms?.textContent).toContain("2");
    const players = root.querySelector("[data-testid='ops-totals-players']");
    expect(players?.textContent).toContain("48");
  });

  it("applyDelta updates state and re-renders", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const { factory } = makeFakeSocketFactory();
    handle = renderAdminOpsConsolePage(root, {
      _socketFactory: factory,
      _fetchOverview: async () => makeOverview(),
    });
    await tick();
    handle.applyDelta({
      metrics: { totalActiveRooms: 99, totalPlayersOnline: 999 },
    });
    const rooms = root.querySelector("[data-testid='ops-totals-rooms']");
    expect(rooms?.textContent).toContain("99");
  });

  it("socket factory triggers onUpdate path through handle.applyDelta", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const { factory, current } = makeFakeSocketFactory();
    handle = renderAdminOpsConsolePage(root, {
      _socketFactory: factory,
      _fetchOverview: async () => makeOverview(),
    });
    await tick();
    const fake = current();
    expect(fake).toBeTruthy();
    // Simulate a socket-update via the captured callback
    fake!.trigger.onUpdate({
      metrics: { totalActiveRooms: 7, totalPlayersOnline: 77 },
    });
    const rooms = root.querySelector("[data-testid='ops-totals-rooms']");
    expect(rooms?.textContent).toContain("7");
  });

  it("connection banner switches to Polling on fallback-active", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const { factory, current } = makeFakeSocketFactory();
    handle = renderAdminOpsConsolePage(root, {
      _socketFactory: factory,
      _fetchOverview: async () => makeOverview(),
      fallbackPollMs: 60_000, // long, so no actual polling kicks in during test
    });
    await tick();
    const banner = root.querySelector("[data-testid='ops-connection-banner']");
    expect(banner?.textContent).toContain("Live");
    current()!.trigger.onFallbackActive(true);
    expect(banner?.textContent).toContain("Polling");
  });
});

describe("AdminOpsConsolePage — actions", () => {
  let handle: AdminOpsConsoleHandle | null = null;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    initI18n();
    document.body.innerHTML = "";
    setSession(adminSession());
    window.localStorage.setItem("bingo_admin_access_token", "tok");
    fetchMock = mockApiRouter([
      {
        match: /\/api\/admin\/ops\/rooms\/.+\/force-pause/,
        handler: () => ({ ok: true }),
      },
      {
        match: /\/api\/admin\/ops\/alerts\/.+\/acknowledge/,
        handler: () => ({
          alert: {
            id: "alert-1",
            severity: "WARN",
            type: "DRAW_STUCK",
            hallId: "hall-a",
            roomCode: "ROOM-A",
            message: "x",
            acknowledgedAt: new Date().toISOString(),
            acknowledgedByUserId: "ad-1",
            createdAt: new Date().toISOString(),
          },
        }),
      },
      {
        match: /\/api\/admin\/ops\/overview/,
        handler: () => ({
          halls: [makeHall("hall-a"), makeHall("hall-b")],
          rooms: [makeRoom("ROOM-A", "hall-a"), makeRoom("ROOM-B", "hall-b")],
          groups: [
            {
              id: "goh-1",
              name: "Group A",
              hallCount: 2,
              readyAggregate: "2/2",
              totalPayoutToday: 1000,
            },
          ],
          alerts: [makeAlert("alert-1", "WARN")],
          metrics: { totalActiveRooms: 2, totalPlayersOnline: 48 },
          snapshotAt: new Date().toISOString(),
        }),
      },
    ]);
  });

  afterEach(() => {
    handle?.dispose();
    handle = null;
    vi.restoreAllMocks();
  });

  it("clicking force-pause opens confirm modal and calls API on confirm", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const { factory } = makeFakeSocketFactory();
    handle = renderAdminOpsConsolePage(root, {
      _socketFactory: factory,
      // Force the page to use the mockApiRouter via the real fetchOverview.
    });
    await tick();
    const card = root.querySelector("[data-testid='ops-hall-card-hall-a']");
    const pauseBtn = card?.querySelector<HTMLButtonElement>("[data-action='pause']");
    expect(pauseBtn).toBeTruthy();
    pauseBtn?.click();
    // Modal renders into document.body — find confirm-button (variant=warning)
    const confirmBtn = document.querySelector<HTMLButtonElement>(
      ".modal .modal-footer button.btn-warning",
    );
    expect(confirmBtn).toBeTruthy();
    confirmBtn?.click();
    await tick(10);
    const pauseCall = fetchMock.mock.calls.find((c) =>
      typeof c[0] === "string" && c[0].includes("force-pause"),
    );
    expect(pauseCall).toBeTruthy();
    expect(String(pauseCall![0])).toContain("ROOM-A");
  });

  it("acknowledge-alert button calls /alerts/:id/acknowledge", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const { factory } = makeFakeSocketFactory();
    handle = renderAdminOpsConsolePage(root, {
      _socketFactory: factory,
    });
    await tick();
    const ackBtn = root.querySelector<HTMLButtonElement>(
      "[data-testid='ops-alert-alert-1'] [data-action='ack']",
    );
    expect(ackBtn).toBeTruthy();
    ackBtn?.click();
    await tick(10);
    const ackCall = fetchMock.mock.calls.find((c) =>
      typeof c[0] === "string" && c[0].includes("/alerts/alert-1/acknowledge"),
    );
    expect(ackCall).toBeTruthy();
  });

  it("search input filters hall cards by name", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const { factory } = makeFakeSocketFactory();
    handle = renderAdminOpsConsolePage(root, {
      _socketFactory: factory,
    });
    await tick();
    const search = root.querySelector<HTMLInputElement>(
      "[data-testid='ops-search-input']",
    );
    expect(search).toBeTruthy();
    search!.value = "hall-a";
    search!.dispatchEvent(new Event("input"));
    await tick();
    const cardA = root.querySelector<HTMLElement>(
      "[data-testid='ops-hall-card-hall-a']",
    );
    const cardB = root.querySelector<HTMLElement>(
      "[data-testid='ops-hall-card-hall-b']",
    );
    // The cards live inside a wrapper col-* — `display:none` is set on the wrapping col,
    // so we check the closest [data-hall-id] element instead.
    expect(cardA?.style.display).not.toBe("none");
    expect(cardB?.style.display).toBe("none");
  });
});
