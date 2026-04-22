// PR-PT6 — tests for physical-tickets PT1-PT5 admin-UI.
//
// Dekker:
//   - ImportCsvPage (PT1): CSV-opplasting + HALL_OPERATOR-scope + error-map.
//   - RangeRegisterPage (PT2): submit-payload + scope-validering.
//   - ActiveRangesPage (PT2/3/5): tabell-render + close-bekreftelsesdialog.
//   - PendingPayoutsPage (PT4): list/verify/admin-approve/confirm/reject,
//     ADMIN-only admin-approve-knapp, socket-auto-reload.
//   - Dispatcher: isPhysicalTicketsRoute + mountPhysicalTicketsRoute.
//   - i18n-coverage: alle PT6-nøkler må finnes i both no.json og en.json.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { initI18n, setLang, t } from "../src/i18n/I18n.js";
import { setSession, type Session } from "../src/auth/Session.js";
import { renderImportCsvPage } from "../src/pages/physical-tickets/ImportCsvPage.js";
import { renderRangeRegisterPage } from "../src/pages/physical-tickets/RangeRegisterPage.js";
import { renderActiveRangesPage } from "../src/pages/physical-tickets/ActiveRangesPage.js";
import {
  renderPendingPayoutsPage,
  type RenderPendingPayoutsPageOptions,
} from "../src/pages/physical-tickets/PendingPayoutsPage.js";
import {
  isPhysicalTicketsRoute,
  mountPhysicalTicketsRoute,
} from "../src/pages/physical-tickets/index.js";
import { mapPhysicalTicketErrorMessage } from "../src/pages/physical-tickets/errorMap.js";
import { ApiError } from "../src/api/client.js";
import type { PhysicalTicketWonSocketHandle } from "../src/pages/physical-tickets/physicalTicketWonSocket.js";

// ──────────────────────────────────────────────────────────────────────────
// Test helpers (match mønsteret fra tests/physicalTickets.test.ts).

function adminSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "admin-1",
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
    id: "op-1",
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

type JsonResponder = (
  url: string,
  init: RequestInit | undefined,
) => unknown;

type MockHandler = { match: RegExp; handler: JsonResponder; status?: number; errorCode?: string };

function mockApi(routes: MockHandler[]): ReturnType<typeof vi.fn> {
  const fn = vi.fn();
  fn.mockImplementation((url: string, init?: RequestInit) => {
    const route = routes.find((r) => r.match.test(url));
    if (!route) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ ok: false, error: { code: "NOT_MOCKED", message: url } }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        ),
      );
    }
    const body = route.handler(url, init);
    const status = route.status ?? 200;
    if (status >= 400) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            ok: false,
            error: { code: route.errorCode ?? "SERVER_ERROR", message: JSON.stringify(body) },
          }),
          { status, headers: { "Content-Type": "application/json" } },
        ),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ ok: true, data: body }), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return fn;
}

async function tick(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise<void>((r) => setTimeout(r, 0));
  }
}

function setupDom(): HTMLElement {
  document.body.innerHTML = "";
  const root = document.createElement("div");
  document.body.appendChild(root);
  return root;
}

// ──────────────────────────────────────────────────────────────────────────
// Sample-data.

const SAMPLE_RANGE = {
  id: "range-1111-2222-3333-4444",
  agentId: "agent-aa",
  hallId: "hall-1",
  ticketColor: "small" as const,
  initialSerial: "100100",
  finalSerial: "100051",
  serials: ["100100", "100099", "100098", "100097", "100096"],
  currentTopSerial: "100097",
  nextAvailableIndex: 0,
  registeredAt: "2026-04-22T10:00:00Z",
  closedAt: null as string | null,
  handoverFromRangeId: null as string | null,
  handedOffToRangeId: null as string | null,
};

const SAMPLE_PENDING = {
  id: "pending-123",
  ticketId: "100042",
  hallId: "hall-1",
  scheduledGameId: "game-1",
  patternPhase: "row_1" as const,
  expectedPayoutCents: 200_000,
  responsibleUserId: "agent-aa",
  color: "small",
  detectedAt: "2026-04-22T10:15:00Z",
  verifiedAt: null as string | null,
  verifiedByUserId: null as string | null,
  paidOutAt: null as string | null,
  paidOutByUserId: null as string | null,
  adminApprovalRequired: false,
  adminApprovedAt: null as string | null,
  adminApprovedByUserId: null as string | null,
  rejectedAt: null as string | null,
  rejectedByUserId: null as string | null,
  rejectedReason: null as string | null,
};

// ──────────────────────────────────────────────────────────────────────────
// Dispatcher

describe("physical-tickets PT6 dispatcher", () => {
  beforeEach(() => {
    initI18n();
    document.body.innerHTML = "";
    window.localStorage.setItem("bingo_admin_access_token", "tok");
    setSession(adminSession());
  });

  it("recognises the 4 new PT6 routes", () => {
    expect(isPhysicalTicketsRoute("/physical/import")).toBe(true);
    expect(isPhysicalTicketsRoute("/physical/ranges/register")).toBe(true);
    expect(isPhysicalTicketsRoute("/physical/ranges")).toBe(true);
    expect(isPhysicalTicketsRoute("/physical/payouts")).toBe(true);
  });

  it("still recognises existing routes", () => {
    expect(isPhysicalTicketsRoute("/addPhysicalTickets")).toBe(true);
    expect(isPhysicalTicketsRoute("/physical/cash-out")).toBe(true);
    expect(isPhysicalTicketsRoute("/totally/bogus")).toBe(false);
  });

  it("mounts the ImportCsvPage for /physical/import", async () => {
    mockApi([{ match: /\/api\/admin\/halls/, handler: () => ({ halls: [] }) }]);
    const root = setupDom();
    mountPhysicalTicketsRoute(root, "/physical/import");
    await tick();
    expect(root.querySelector("#pt-import-form")).toBeTruthy();
  });

  it("mounts the RangeRegisterPage for /physical/ranges/register (operator)", async () => {
    setSession(operatorSession());
    const root = setupDom();
    mountPhysicalTicketsRoute(root, "/physical/ranges/register");
    await tick();
    expect(root.querySelector("#rr-form")).toBeTruthy();
  });

  it("mounts the ActiveRangesPage for /physical/ranges", async () => {
    mockApi([{ match: /\/api\/admin\/physical-tickets\/ranges(\?|$)/, handler: () => ({ ranges: [] }) }]);
    const root = setupDom();
    mountPhysicalTicketsRoute(root, "/physical/ranges");
    await tick();
    expect(root.querySelector("#ar-table")).toBeTruthy();
  });

  it("mounts the PendingPayoutsPage for /physical/payouts", async () => {
    const root = setupDom();
    mountPhysicalTicketsRoute(root, "/physical/payouts");
    await tick();
    expect(root.querySelector("#pp-scope-form")).toBeTruthy();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// ImportCsvPage

describe("ImportCsvPage (PT1)", () => {
  beforeEach(() => {
    initI18n();
    document.body.innerHTML = "";
    window.localStorage.setItem("bingo_admin_access_token", "tok");
    setSession(adminSession());
  });

  it("renders hall-select for admin and hides it for operator", async () => {
    // Admin
    mockApi([{ match: /\/api\/admin\/halls/, handler: () => ({ halls: [{ id: "h1", name: "Oslo", isActive: true }] }) }]);
    let root = setupDom();
    renderImportCsvPage(root);
    await tick();
    const adminRow = root.querySelector<HTMLElement>("#pt-hall-row");
    expect(adminRow?.style.display).toBe("block");

    // Operator
    setSession(operatorSession());
    root = setupDom();
    renderImportCsvPage(root);
    await tick();
    const opRow = root.querySelector<HTMLElement>("#pt-hall-row");
    expect(opRow?.style.display).toBe("none");
  });

  it("posts CSV content + hallId for operator without hall-select", async () => {
    setSession(operatorSession());
    let capturedBody: unknown = null;
    mockApi([
      {
        match: /\/api\/admin\/physical-tickets\/static\/import/,
        handler: (_url, init) => {
          capturedBody = JSON.parse(String(init?.body ?? "{}"));
          return { hallId: "hall-1", inserted: 3, skipped: 0, totalRows: 3 };
        },
      },
    ]);
    const root = setupDom();
    renderImportCsvPage(root);
    await tick();

    // Simulate file upload: replace FileReader.readAsText -> resolve immediate.
    const csvText = "hall_name,ticket_id,ticket_color,n1,n2\nOslo,100001,small,1,2";
    const fileList = {
      0: new File([csvText], "import.csv", { type: "text/csv" }),
      length: 1,
      item: (i: number) => (i === 0 ? new File([csvText], "import.csv", { type: "text/csv" }) : null),
    } as unknown as FileList;
    const input = root.querySelector<HTMLInputElement>("#pt-csvFile")!;
    Object.defineProperty(input, "files", { value: fileList, configurable: true });

    root.querySelector<HTMLFormElement>("#pt-import-form")!
      .dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await tick(12);

    expect(capturedBody).toMatchObject({ hallId: "hall-1" });
    expect((capturedBody as { csvContent: string }).csvContent).toContain("100001");
    expect(root.textContent).toContain("3 bonger importert");
  });

  it("shows friendly error message when server returns TICKET_WRONG_HALL", async () => {
    setSession(operatorSession());
    mockApi([
      {
        match: /\/api\/admin\/physical-tickets\/static\/import/,
        handler: () => ({ bug: "fake" }),
        status: 409,
        errorCode: "TICKET_WRONG_HALL",
      },
    ]);
    const root = setupDom();
    renderImportCsvPage(root);
    await tick();

    const file = new File(["x"], "f.csv", { type: "text/csv" });
    const fileList = {
      0: file,
      length: 1,
      item: (i: number) => (i === 0 ? file : null),
    } as unknown as FileList;
    const input = root.querySelector<HTMLInputElement>("#pt-csvFile")!;
    Object.defineProperty(input, "files", { value: fileList, configurable: true });

    root.querySelector<HTMLFormElement>("#pt-import-form")!
      .dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await tick(12);

    expect(root.querySelector(".callout-danger")?.textContent).toContain(
      "Denne bongen tilhører en annen hall",
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────
// RangeRegisterPage

describe("RangeRegisterPage (PT2)", () => {
  beforeEach(() => {
    initI18n();
    document.body.innerHTML = "";
    window.localStorage.setItem("bingo_admin_access_token", "tok");
    setSession(operatorSession());
  });

  it("submits agentId + hallId from session with scanned serial and count", async () => {
    let capturedBody: unknown = null;
    mockApi([
      {
        match: /\/api\/admin\/physical-tickets\/ranges\/register/,
        handler: (_url, init) => {
          capturedBody = JSON.parse(String(init?.body ?? "{}"));
          return {
            rangeId: "range-new",
            initialTopSerial: "100100",
            finalSerial: "100051",
            reservedCount: 50,
          };
        },
      },
    ]);
    const root = setupDom();
    renderRangeRegisterPage(root);
    await tick();

    root.querySelector<HTMLSelectElement>("#rr-color")!.value = "large";
    root.querySelector<HTMLInputElement>("#rr-barcode")!.value = "100100";
    root.querySelector<HTMLInputElement>("#rr-count")!.value = "50";
    root.querySelector<HTMLFormElement>("#rr-form")!
      .dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await tick(10);

    expect(capturedBody).toMatchObject({
      agentId: "op-1",
      hallId: "hall-1",
      ticketColor: "large",
      firstScannedSerial: "100100",
      count: 50,
    });
    expect(root.textContent).toContain("Range registrert");
  });

  it("warns when no hall is scoped (admin without hall)", async () => {
    setSession(adminSession()); // no hall[]
    const root = setupDom();
    renderRangeRegisterPage(root);
    await tick();
    // admin has no hall — should show the warning callout
    expect(root.querySelector(".callout-warning")).toBeTruthy();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// ActiveRangesPage

describe("ActiveRangesPage (PT2/3/5)", () => {
  beforeEach(() => {
    initI18n();
    document.body.innerHTML = "";
    window.localStorage.setItem("bingo_admin_access_token", "tok");
    setSession(adminSession());
  });

  it("loads ranges and renders action buttons per row", async () => {
    mockApi([
      {
        match: /\/api\/admin\/physical-tickets\/ranges(\?|$)/,
        handler: () => ({ ranges: [SAMPLE_RANGE] }),
      },
    ]);
    const root = setupDom();
    renderActiveRangesPage(root);
    await tick(8);
    expect(root.textContent).toContain(SAMPLE_RANGE.id.slice(0, 8));
    expect(root.querySelector("[data-action='sale']")).toBeTruthy();
    expect(root.querySelector("[data-action='handover']")).toBeTruthy();
    expect(root.querySelector("[data-action='extend']")).toBeTruthy();
    expect(root.querySelector("[data-action='close']")).toBeTruthy();
  });

  it("opens confirmation modal for close with backdrop=static", async () => {
    mockApi([
      {
        match: /\/api\/admin\/physical-tickets\/ranges(\?|$)/,
        handler: () => ({ ranges: [SAMPLE_RANGE] }),
      },
    ]);
    const root = setupDom();
    renderActiveRangesPage(root);
    await tick(8);
    const closeBtn = root.querySelector<HTMLButtonElement>("[data-action='close']")!;
    closeBtn.click();
    await tick();
    const modal = document.querySelector(".modal");
    expect(modal?.getAttribute("data-backdrop")).toBe("static");
    expect(document.body.textContent).toContain("Ja, lukk range");
  });

  it("disables action buttons for a closed range", async () => {
    const closedRange = { ...SAMPLE_RANGE, closedAt: "2026-04-22T12:00:00Z" };
    mockApi([
      {
        match: /\/api\/admin\/physical-tickets\/ranges(\?|$)/,
        handler: () => ({ ranges: [closedRange] }),
      },
    ]);
    const root = setupDom();
    renderActiveRangesPage(root);
    await tick(8);
    const btn = root.querySelector<HTMLButtonElement>("[data-action='sale']");
    expect(btn?.disabled).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// PendingPayoutsPage

describe("PendingPayoutsPage (PT4)", () => {
  beforeEach(() => {
    initI18n();
    document.body.innerHTML = "";
    window.localStorage.setItem("bingo_admin_access_token", "tok");
    setSession(adminSession());
  });

  it("requires either gameId or userId before loading", async () => {
    const root = setupDom();
    renderPendingPayoutsPage(root);
    await tick();
    // Nothing should be requested yet
    expect(root.textContent).toContain("Søk med spill-ID");
  });

  it("lists pending payouts for a gameId", async () => {
    mockApi([
      {
        match: /\/api\/admin\/physical-ticket-payouts\/pending\?/,
        handler: () => ({ pending: [SAMPLE_PENDING] }),
      },
    ]);
    const root = setupDom();
    // Inject a fake socket so the real socket.io client does not try to connect.
    const factory = vi.fn((_g: string, _cb: unknown) => {
      return {
        dispose: () => {},
        onConnectionChange: () => {},
      } satisfies PhysicalTicketWonSocketHandle;
    });
    renderPendingPayoutsPage(root, {
      _socketFactory: factory as unknown as RenderPendingPayoutsPageOptions["_socketFactory"],
    });
    root.querySelector<HTMLInputElement>("#pp-gameId")!.value = "game-1";
    root.querySelector<HTMLFormElement>("#pp-scope-form")!
      .dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await tick(12);
    expect(root.textContent).toContain(SAMPLE_PENDING.ticketId);
    expect(factory).toHaveBeenCalledWith("game-1", expect.any(Function));
  });

  it("shows admin-approve button only for ADMIN role", async () => {
    const pendingNeedsAdmin = {
      ...SAMPLE_PENDING,
      adminApprovalRequired: true,
      verifiedAt: "2026-04-22T10:20:00Z",
      verifiedByUserId: "admin-1",
    };
    mockApi([
      {
        match: /\/api\/admin\/physical-ticket-payouts\/pending\?/,
        handler: () => ({ pending: [pendingNeedsAdmin] }),
      },
    ]);
    const root = setupDom();
    renderPendingPayoutsPage(root, {
      _socketFactory: (() => ({ dispose: () => {}, onConnectionChange: () => {} })) as RenderPendingPayoutsPageOptions["_socketFactory"],
    });
    root.querySelector<HTMLInputElement>("#pp-gameId")!.value = "game-1";
    root.querySelector<HTMLFormElement>("#pp-scope-form")!
      .dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await tick(12);
    expect(root.querySelector("[data-action='admin-approve']")).toBeTruthy();

    // Operator session should NOT render the admin-approve button.
    setSession(operatorSession());
    document.body.innerHTML = "";
    const root2 = setupDom();
    renderPendingPayoutsPage(root2, {
      _socketFactory: (() => ({ dispose: () => {}, onConnectionChange: () => {} })) as RenderPendingPayoutsPageOptions["_socketFactory"],
    });
    root2.querySelector<HTMLInputElement>("#pp-gameId")!.value = "game-1";
    root2.querySelector<HTMLFormElement>("#pp-scope-form")!
      .dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await tick(12);
    expect(root2.querySelector("[data-action='admin-approve']")).toBeFalsy();
  });

  it("auto-reloads when socket emits game1:physical-ticket-won", async () => {
    let nthCall = 0;
    mockApi([
      {
        match: /\/api\/admin\/physical-ticket-payouts\/pending\?/,
        handler: () => {
          nthCall += 1;
          return { pending: nthCall === 1 ? [] : [SAMPLE_PENDING] };
        },
      },
    ]);
    const root = setupDom();
    let onWonCb: ((payload: unknown) => void) | null = null;
    const factory = vi.fn((_g: string, cb: (payload: unknown) => void) => {
      onWonCb = cb;
      return { dispose: () => {}, onConnectionChange: () => {} } satisfies PhysicalTicketWonSocketHandle;
    });
    renderPendingPayoutsPage(root, {
      _socketFactory: factory as unknown as RenderPendingPayoutsPageOptions["_socketFactory"],
    });
    root.querySelector<HTMLInputElement>("#pp-gameId")!.value = "game-1";
    root.querySelector<HTMLFormElement>("#pp-scope-form")!
      .dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await tick(12);
    expect(nthCall).toBe(1);
    expect(onWonCb).toBeInstanceOf(Function);

    // Simulate broadcast
    onWonCb!({
      gameId: "game-1",
      phase: 1,
      patternName: "row_1",
      pendingPayoutId: "pending-123",
      ticketId: "100042",
      hallId: "hall-1",
      responsibleUserId: "agent-aa",
      expectedPayoutCents: 200_000,
      color: "small",
      adminApprovalRequired: false,
      at: Date.now(),
    });
    await tick(12);
    expect(nthCall).toBeGreaterThanOrEqual(2);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// errorMap + i18n coverage

describe("mapPhysicalTicketErrorMessage", () => {
  beforeEach(() => {
    initI18n();
  });

  it("maps TICKET_WRONG_HALL to friendly NO message", () => {
    const err = new ApiError("raw msg", "TICKET_WRONG_HALL", 409);
    expect(mapPhysicalTicketErrorMessage(err)).toContain("annen hall");
  });

  it("maps TICKET_SCAN_MISMATCH to friendly NO message", () => {
    const err = new ApiError("raw msg", "TICKET_SCAN_MISMATCH", 409);
    expect(mapPhysicalTicketErrorMessage(err)).toContain("matcher ikke");
  });

  it("falls back to server message for unknown codes", () => {
    const err = new ApiError("Server fault X", "UNKNOWN_CODE_XYZ", 500);
    expect(mapPhysicalTicketErrorMessage(err)).toBe("Server fault X");
  });

  it("falls back to generic for non-Error values", () => {
    expect(mapPhysicalTicketErrorMessage("some string")).toContain("Noe gikk galt");
  });
});

describe("PT6 i18n coverage", () => {
  const REQUIRED_KEYS = [
    "pt_import_csv_title",
    "pt_range_register_title",
    "pt_active_ranges_title",
    "pt_pending_payouts_title",
    "pt_nav_group_title",
    "pt_action_record_sale",
    "pt_action_handover",
    "pt_action_extend",
    "pt_action_close",
    "pt_action_verify",
    "pt_action_admin_approve",
    "pt_action_confirm_payout",
    "pt_action_reject",
    "pt_err_ticket_wrong_hall",
    "pt_err_ticket_already_sold",
    "pt_err_ticket_scan_mismatch",
    "pt_err_pending_payout_not_found",
    "pt_socket_connected",
    "pt_pattern_row_1",
    "pt_pattern_full_house",
  ];

  it("has all PT6 keys in no.json", async () => {
    const no = await import("../src/i18n/no.json");
    const dict = no as unknown as Record<string, string>;
    for (const k of REQUIRED_KEYS) {
      expect(dict[k], `Missing NO key: ${k}`).toBeTruthy();
    }
  });

  it("has all PT6 keys in en.json", async () => {
    const en = await import("../src/i18n/en.json");
    const dict = en as unknown as Record<string, string>;
    for (const k of REQUIRED_KEYS) {
      expect(dict[k], `Missing EN key: ${k}`).toBeTruthy();
    }
  });

  it("produces English translation when lang=en", () => {
    // Bekrefter at i18n fallback-regimet ikke rydder inn norsk som EN.
    setLang("en");
    expect(t("pt_action_record_sale")).toBe("Record sale");
    expect(t("pt_err_ticket_wrong_hall")).toContain("another hall");
    setLang("no");
  });
});
