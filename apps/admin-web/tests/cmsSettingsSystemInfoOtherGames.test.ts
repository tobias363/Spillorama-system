// BIN-676/677/679 — tests for CMS + Settings + SystemInfo + otherGames.
//
// CMS-delen (BIN-676) bruker `mockApiRouter` fra tidligere PR. Settings /
// SystemInfo / otherGames-delen (BIN-677/679) bruker `installFetch`-stub
// som også settes opp i `beforeEach` som default for alle tester.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initI18n } from "../src/i18n/I18n.js";
import { isCmsRoute, mountCmsRoute } from "../src/pages/cms/index.js";
import {
  textKeyToSlug,
  isRegulatoryLocked,
  CMS_REGULATORY_LOCKED_SLUGS,
} from "../src/api/admin-cms.js";
import { isSettingsRoute, mountSettingsRoute } from "../src/pages/settings/index.js";
import {
  isSystemInformationRoute,
  mountSystemInformationRoute,
} from "../src/pages/systemInformation/index.js";
import {
  isOtherGamesRoute,
  mountOtherGamesRoute,
} from "../src/pages/otherGames/index.js";
import {
  isMiniGameType,
  renderMiniGameConfigPage,
  schemaForType,
} from "../src/pages/otherGames/MiniGameConfigPage.js";
import noI18n from "../src/i18n/no.json";
import enI18n from "../src/i18n/en.json";

async function tick(rounds = 12): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise<void>((r) => setTimeout(r, 0));
}

function container(): HTMLElement {
  document.body.innerHTML = `<div id="app"></div>`;
  return document.getElementById("app")!;
}

// ── Fetch-mock utility (BIN-676) — for CMS-testene ──────────────────────────

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
      (r) =>
        r.match.test(url) &&
        (r.method ? r.method.toUpperCase() === method : true)
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
      new Response(
        JSON.stringify(status < 400 ? { ok: true, data: body } : body),
        { status, headers: { "Content-Type": "application/json" } }
      )
    );
  });
  (globalThis as unknown as { fetch: typeof fetch }).fetch =
    fn as unknown as typeof fetch;
  return fn;
}

// ── Fetch stub helpers — for Settings/SystemInfo/otherGames-testene ─────────

type FetchHandler = (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>;

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

function emptySettingsListResponse(): Response {
  return apiOk({
    settings: [
      {
        key: "system.timezone",
        value: "Europe/Oslo",
        category: "general",
        description: "Standard tidssone",
        type: "string",
        isDefault: true,
        updatedByUserId: null,
        updatedAt: null,
      },
      {
        key: "system.information",
        value: "",
        category: "general",
        description: "System-information HTML-blob",
        type: "string",
        isDefault: true,
        updatedByUserId: null,
        updatedAt: null,
      },
      {
        key: "compliance.daily_spending_default",
        value: 0,
        category: "compliance",
        description: "Daglig tak",
        type: "number",
        isDefault: true,
        updatedByUserId: null,
        updatedAt: null,
      },
      {
        key: "branding.screen_saver_enabled",
        value: false,
        category: "branding",
        description: "Screensaver",
        type: "boolean",
        isDefault: true,
        updatedByUserId: null,
        updatedAt: null,
      },
      {
        key: "features.flags",
        value: {},
        category: "feature_flags",
        description: "Feature-flagg-objekt",
        type: "object",
        isDefault: true,
        updatedByUserId: null,
        updatedAt: null,
      },
    ],
    count: 5,
  });
}

function emptyMaintenanceListResponse(): Response {
  return apiOk({ windows: [], count: 0, active: null });
}

function miniGameDefault(gameType: string): Response {
  return apiOk({
    id: `default-${gameType}`,
    gameType,
    config: {},
    active: true,
    updatedByUserId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("bingo_admin_access_token", "tok");
  initI18n();
  // Default-stub — CMS-testene overrider med mockApiRouter ved behov.
  installFetch((input) => {
    const url = typeof input === "string" ? input : (input as URL | Request).toString();
    if (url.includes("/api/admin/settings")) return emptySettingsListResponse();
    if (url.includes("/api/admin/maintenance")) return emptyMaintenanceListResponse();
    if (url.includes("/api/admin/mini-games/wheel")) return miniGameDefault("wheel");
    if (url.includes("/api/admin/mini-games/chest")) return miniGameDefault("chest");
    if (url.includes("/api/admin/mini-games/mystery")) return miniGameDefault("mystery");
    if (url.includes("/api/admin/mini-games/colordraft")) return miniGameDefault("colordraft");
    return jsonResponse(404, { ok: false, error: { code: "NOT_FOUND", message: "Not stubbed" } });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── CMS slug-mapping (BIN-676) ───────────────────────────────────────────────

describe("BIN-676 CMS API — text-key to backend-slug mapping", () => {
  it("mapper frontend-nøkler til backend-slugs", () => {
    expect(textKeyToSlug("terms_of_service")).toBe("terms");
    expect(textKeyToSlug("support")).toBe("support");
    expect(textKeyToSlug("about_us")).toBe("aboutus");
    expect(textKeyToSlug("links_of_other_agencies")).toBe("links");
    expect(textKeyToSlug("responsible_gaming")).toBe("responsible-gaming");
  });

  it("responsible_gaming er regulatorisk-låst, andre er ikke", () => {
    expect(isRegulatoryLocked("responsible_gaming")).toBe(true);
    expect(isRegulatoryLocked("terms_of_service")).toBe(false);
    expect(isRegulatoryLocked("support")).toBe(false);
    expect(isRegulatoryLocked("about_us")).toBe(false);
    expect(isRegulatoryLocked("links_of_other_agencies")).toBe(false);
  });

  it("responsible-gaming er med i CMS_REGULATORY_LOCKED_SLUGS", () => {
    expect(CMS_REGULATORY_LOCKED_SLUGS).toContain("responsible-gaming");
    expect(CMS_REGULATORY_LOCKED_SLUGS.length).toBe(1);
  });
});

// ── CMS dispatcher (BIN-676 wired) ───────────────────────────────────────────

describe("CMS dispatcher (BIN-676 wired)", () => {
  it("matches static + dynamic CMS routes", () => {
    expect(isCmsRoute("/cms")).toBe(true);
    expect(isCmsRoute("/faq")).toBe(true);
    expect(isCmsRoute("/addFAQ")).toBe(true);
    expect(isCmsRoute("/faqEdit/abc123")).toBe(true);
    expect(isCmsRoute("/TermsofService")).toBe(true);
    expect(isCmsRoute("/Support")).toBe(true);
    expect(isCmsRoute("/Aboutus")).toBe(true);
    expect(isCmsRoute("/ResponsibleGameing")).toBe(true);
    expect(isCmsRoute("/LinksofOtherAgencies")).toBe(true);
    expect(isCmsRoute("/admin")).toBe(false);
    expect(isCmsRoute("/settings")).toBe(false);
  });

  it("/cms renders 6-row static table with links to sub-pages", () => {
    const host = container();
    mountCmsRoute(host, "/cms");
    const table = host.querySelector('[data-testid="cms-table"]');
    expect(table).toBeTruthy();
    const rows = host.querySelectorAll("tbody tr");
    expect(rows.length).toBe(6);
    // Placeholder banner should NOT be present on wired list (BIN-676).
    expect(host.querySelector('[data-testid="cms-placeholder-banner"]')).toBeNull();
    // Responsible row points to /ResponsibleGameing
    const responsibleRow = host.querySelector('[data-testid="cms-row-responsible"]');
    expect(responsibleRow?.innerHTML).toContain("#/ResponsibleGameing");
  });

  it("/ResponsibleGameing viser versjons-flyt-banner + redigerbar textarea + save-knapp (BIN-680 Lag 1)", async () => {
    mockApiRouter([
      {
        match: /\/api\/admin\/cms\/responsible-gaming$/,
        method: "GET",
        handler: () => ({
          slug: "responsible-gaming",
          content: "Gjeldende tekst",
          updatedByUserId: null,
          createdAt: "2026-04-20T00:00:00Z",
          updatedAt: "2026-04-20T00:00:00Z",
        }),
      },
      {
        match: /\/api\/admin\/cms\/responsible-gaming\/history$/,
        method: "GET",
        handler: () => ({
          slug: "responsible-gaming",
          versions: [],
          count: 0,
        }),
      },
      {
        match: /\/api\/auth\/me$/,
        method: "GET",
        handler: () => ({ id: "admin-1", email: "a@b", role: "ADMIN" }),
      },
      {
        match: /\/api\/admin\/permissions$/,
        method: "GET",
        handler: () => ({}),
      },
    ]);
    const host = container();
    mountCmsRoute(host, "/ResponsibleGameing");
    await tick();
    // Banner vises fortsatt (info om regulatorisk versjons-flyt), men nå som
    // informasjon — ikke lås.
    expect(host.querySelector('[data-testid="cms-regulatory-lock-banner"]')).toBeTruthy();
    const textarea = host.querySelector<HTMLTextAreaElement>('[data-testid="cms-body-textarea"]');
    expect(textarea?.readOnly).toBe(false); // BIN-680: ikke readonly
    expect(textarea?.value).toBe("Gjeldende tekst");
    const save = host.querySelector<HTMLButtonElement>('[data-testid="cms-save-btn"]');
    expect(save).toBeTruthy();
    expect(save!.disabled).toBe(false); // BIN-680: ikke disabled
    // Historikk-panel skal være synlig.
    expect(host.querySelector('[data-testid="cms-version-history"]')).toBeTruthy();
  });

  it("/TermsofService allows edit (no regulatory lock) and roundtrips via PUT", async () => {
    let puttedContent: string | null = null;
    mockApiRouter([
      {
        match: /\/api\/admin\/cms\/terms$/,
        method: "GET",
        handler: () => ({
          slug: "terms",
          content: "Vilkår v1",
          updatedByUserId: null,
          createdAt: "2026-04-20T00:00:00Z",
          updatedAt: "2026-04-20T00:00:00Z",
        }),
      },
      {
        match: /\/api\/admin\/cms\/terms$/,
        method: "PUT",
        handler: (_url, init) => {
          const body = JSON.parse(String(init?.body ?? "{}")) as {
            content: string;
          };
          puttedContent = body.content;
          return {
            slug: "terms",
            content: body.content,
            updatedByUserId: "actor-1",
            createdAt: "2026-04-20T00:00:00Z",
            updatedAt: "2026-04-20T00:00:00Z",
          };
        },
      },
    ]);
    const host = container();
    mountCmsRoute(host, "/TermsofService");
    await tick();
    const textarea = host.querySelector<HTMLTextAreaElement>('[data-testid="cms-body-textarea"]');
    expect(textarea?.readOnly).toBe(false);
    expect(textarea?.value).toBe("Vilkår v1");
    const save = host.querySelector<HTMLButtonElement>('[data-testid="cms-save-btn"]');
    expect(save?.disabled).toBe(false);
    expect(host.querySelector('[data-testid="cms-regulatory-lock-banner"]')).toBeNull();

    textarea!.value = "Vilkår v2";
    const form = host.querySelector<HTMLFormElement>("#cms-text-form")!;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await tick();
    expect(puttedContent).toBe("Vilkår v2");
  });

  it("/ResponsibleGameing: lagring oppretter draft via PUT og viser draft i historikk (BIN-680 Lag 1)", async () => {
    let puttedContent: string | null = null;
    let historyCalls = 0;
    const router = mockApiRouter([
      {
        match: /\/api\/admin\/cms\/responsible-gaming$/,
        method: "GET",
        handler: () => ({
          slug: "responsible-gaming",
          content: "",
          updatedByUserId: null,
          createdAt: "2026-04-20T00:00:00Z",
          updatedAt: "2026-04-20T00:00:00Z",
        }),
      },
      {
        match: /\/api\/admin\/cms\/responsible-gaming$/,
        method: "PUT",
        handler: (_url, init) => {
          const body = JSON.parse(String(init?.body ?? "{}")) as {
            content: string;
          };
          puttedContent = body.content;
          return {
            slug: "responsible-gaming",
            content: body.content,
            updatedByUserId: "admin-1",
            createdAt: "2026-04-20T00:00:00Z",
            updatedAt: "2026-04-20T00:00:00Z",
          };
        },
      },
      {
        match: /\/api\/admin\/cms\/responsible-gaming\/history$/,
        method: "GET",
        handler: () => {
          historyCalls++;
          if (historyCalls === 1) {
            return { slug: "responsible-gaming", versions: [], count: 0 };
          }
          return {
            slug: "responsible-gaming",
            versions: [
              {
                id: "ver-1",
                slug: "responsible-gaming",
                versionNumber: 1,
                content: "ny tekst",
                status: "draft",
                createdByUserId: "admin-1",
                createdAt: "2026-04-20T10:00:00Z",
                approvedByUserId: null,
                approvedAt: null,
                publishedByUserId: null,
                publishedAt: null,
                retiredAt: null,
              },
            ],
            count: 1,
          };
        },
      },
      {
        match: /\/api\/auth\/me$/,
        method: "GET",
        handler: () => ({ id: "admin-1", email: "a@b", role: "ADMIN" }),
      },
      {
        match: /\/api\/admin\/permissions$/,
        method: "GET",
        handler: () => ({}),
      },
    ]);
    const host = container();
    mountCmsRoute(host, "/ResponsibleGameing");
    await tick();
    const textarea = host.querySelector<HTMLTextAreaElement>('[data-testid="cms-body-textarea"]')!;
    textarea.value = "ny tekst";
    const form = host.querySelector<HTMLFormElement>("#cms-text-form")!;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await tick();

    // PUT skal ha blitt kalt (i motsetning til gamle BIN-680-gate-oppførsel).
    const putCalls = router.mock.calls.filter(
      (c) => (c[1] as RequestInit | undefined)?.method === "PUT"
    );
    expect(putCalls.length).toBe(1);
    expect(puttedContent).toBe("ny tekst");

    // Historikk-panelet skal være oppdatert med draften.
    await tick();
    expect(host.querySelector('[data-testid="cms-history-list"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="cms-version-status-draft"]')).toBeTruthy();
  });

  it("/ResponsibleGameing: 4-øyne — approve-knapp er disabled for creator", async () => {
    mockApiRouter([
      {
        match: /\/api\/admin\/cms\/responsible-gaming$/,
        method: "GET",
        handler: () => ({
          slug: "responsible-gaming",
          content: "",
          updatedByUserId: null,
          createdAt: "2026-04-20T00:00:00Z",
          updatedAt: "2026-04-20T00:00:00Z",
        }),
      },
      {
        match: /\/api\/admin\/cms\/responsible-gaming\/history$/,
        method: "GET",
        handler: () => ({
          slug: "responsible-gaming",
          versions: [
            {
              id: "ver-1",
              slug: "responsible-gaming",
              versionNumber: 1,
              content: "tekst",
              status: "review",
              createdByUserId: "admin-1",
              createdAt: "2026-04-20T10:00:00Z",
              approvedByUserId: null,
              approvedAt: null,
              publishedByUserId: null,
              publishedAt: null,
              retiredAt: null,
            },
          ],
          count: 1,
        }),
      },
      {
        match: /\/api\/auth\/me$/,
        method: "GET",
        // Samme bruker som draften — 4-øyne skal blokkere.
        handler: () => ({ id: "admin-1", email: "a@b", role: "ADMIN" }),
      },
      {
        match: /\/api\/admin\/permissions$/,
        method: "GET",
        handler: () => ({}),
      },
    ]);
    const host = container();
    mountCmsRoute(host, "/ResponsibleGameing");
    await tick();
    await tick();

    // Approve-knappen finnes men er disabled.
    const approveBtn = host.querySelector<HTMLButtonElement>(
      '[data-testid="cms-approve-ver-1"]'
    );
    expect(approveBtn).toBeTruthy();
    expect(approveBtn!.disabled).toBe(true);
  });

  it("/ResponsibleGameing: 4-øyne — approve-knapp er enabled for annen admin", async () => {
    mockApiRouter([
      {
        match: /\/api\/admin\/cms\/responsible-gaming$/,
        method: "GET",
        handler: () => ({
          slug: "responsible-gaming",
          content: "",
          updatedByUserId: null,
          createdAt: "2026-04-20T00:00:00Z",
          updatedAt: "2026-04-20T00:00:00Z",
        }),
      },
      {
        match: /\/api\/admin\/cms\/responsible-gaming\/history$/,
        method: "GET",
        handler: () => ({
          slug: "responsible-gaming",
          versions: [
            {
              id: "ver-1",
              slug: "responsible-gaming",
              versionNumber: 1,
              content: "tekst",
              status: "review",
              createdByUserId: "admin-1",
              createdAt: "2026-04-20T10:00:00Z",
              approvedByUserId: null,
              approvedAt: null,
              publishedByUserId: null,
              publishedAt: null,
              retiredAt: null,
            },
          ],
          count: 1,
        }),
      },
      {
        match: /\/api\/auth\/me$/,
        method: "GET",
        // Annen bruker enn creator.
        handler: () => ({ id: "admin-2", email: "c@d", role: "ADMIN" }),
      },
      {
        match: /\/api\/admin\/permissions$/,
        method: "GET",
        handler: () => ({}),
      },
    ]);
    const host = container();
    mountCmsRoute(host, "/ResponsibleGameing");
    await tick();
    await tick();

    const approveBtn = host.querySelector<HTMLButtonElement>(
      '[data-testid="cms-approve-ver-1"]'
    );
    expect(approveBtn).toBeTruthy();
    expect(approveBtn!.disabled).toBe(false);
  });

  it("/faq renders DataTable med add-button og viser FAQ-rader fra backend", async () => {
    mockApiRouter([
      {
        match: /\/api\/admin\/cms\/faq$/,
        method: "GET",
        handler: () => ({
          faqs: [
            {
              id: "faq-1",
              question: "Hva er bingo?",
              answer: "Et spill.",
              sortOrder: 0,
              createdByUserId: "u1",
              updatedByUserId: "u1",
              createdAt: "2026-04-20T00:00:00Z",
              updatedAt: "2026-04-20T00:00:00Z",
            },
          ],
          count: 1,
        }),
      },
    ]);
    const host = container();
    mountCmsRoute(host, "/faq");
    await tick();
    expect(host.querySelector('[data-testid="cms-placeholder-banner"]')).toBeNull();
    const addBtn = host.querySelector<HTMLAnchorElement>('[data-testid="faq-add-btn"]');
    expect(addBtn).toBeTruthy();
    expect(addBtn!.href).toContain("#/addFAQ");
    expect(host.textContent).toContain("Hva er bingo?");
  });

  it("/addFAQ renders form with question + answer required fields and POSTs on submit", async () => {
    let postedBody: unknown = null;
    mockApiRouter([
      {
        match: /\/api\/admin\/cms\/faq$/,
        method: "POST",
        handler: (_url, init) => {
          postedBody = JSON.parse(String(init?.body ?? "{}"));
          return {
            id: "faq-created",
            question: (postedBody as { question: string }).question,
            answer: (postedBody as { answer: string }).answer,
            sortOrder: 0,
            createdByUserId: "u1",
            updatedByUserId: "u1",
            createdAt: "2026-04-20T00:00:00Z",
            updatedAt: "2026-04-20T00:00:00Z",
          };
        },
      },
    ]);
    const host = container();
    mountCmsRoute(host, "/addFAQ");
    await tick();
    const form = host.querySelector<HTMLFormElement>('[data-testid="faq-form"]')!;
    expect(form).toBeTruthy();
    expect(form.querySelector<HTMLInputElement>("#ff-question")!.required).toBe(true);
    expect(form.querySelector<HTMLTextAreaElement>("#ff-answer")!.required).toBe(true);

    form.querySelector<HTMLInputElement>("#ff-question")!.value = "Q1";
    form.querySelector<HTMLTextAreaElement>("#ff-answer")!.value = "A1";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await tick();
    expect(postedBody).toEqual({ question: "Q1", answer: "A1" });
  });

  it("/faq viser feilmelding hvis backend er nede", async () => {
    mockApiRouter([
      {
        match: /\/api\/admin\/cms\/faq$/,
        method: "GET",
        status: 500,
        handler: () => ({
          ok: false,
          error: { code: "INTERNAL", message: "Server down" },
        }),
      },
    ]);
    const host = container();
    mountCmsRoute(host, "/faq");
    await tick();
    expect(host.querySelector('[data-testid="faq-error-banner"]')).toBeTruthy();
  });
});

// ── Settings dispatcher (BIN-677 wired) ──────────────────────────────────────

describe("BIN-677 Settings dispatcher", () => {
  it("matches settings + maintenance routes", () => {
    expect(isSettingsRoute("/settings")).toBe(true);
    expect(isSettingsRoute("/maintenance")).toBe(true);
    expect(isSettingsRoute("/maintenance/new")).toBe(true);
    expect(isSettingsRoute("/maintenance/edit/m1")).toBe(true);
    expect(isSettingsRoute("/cms")).toBe(false);
    expect(isSettingsRoute("/maintenance/edit/")).toBe(false);
  });

  it("/settings renders wired-banner + registry-based sections", async () => {
    const host = container();
    mountSettingsRoute(host, "/settings");
    await tick();
    expect(host.querySelector('[data-testid="settings-wired-banner"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="settings-form"]')).toBeTruthy();
    // Compliance section should have the per-hall override info.
    expect(
      host.querySelector('[data-testid="per-hall-spillvett-override-info"]')
    ).toBeTruthy();
  });

  it("/settings renders field for every returned key", async () => {
    const host = container();
    mountSettingsRoute(host, "/settings");
    await tick();
    // Verify each test-id exists (dot replaced with dash).
    expect(host.querySelector('[data-testid="sf-system-timezone"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="sf-system-information"]')).toBeTruthy();
    expect(
      host.querySelector('[data-testid="sf-compliance-daily_spending_default"]')
    ).toBeTruthy();
    expect(
      host.querySelector('[data-testid="sf-branding-screen_saver_enabled"]')
    ).toBeTruthy();
    expect(host.querySelector('[data-testid="sf-features-flags"]')).toBeTruthy();
  });

  it("/maintenance renders wired-banner + add button + no-active banner", async () => {
    const host = container();
    mountSettingsRoute(host, "/maintenance");
    await tick();
    expect(host.querySelector('[data-testid="maintenance-wired-banner"]')).toBeTruthy();
    const addBtn = host.querySelector<HTMLAnchorElement>(
      '[data-testid="btn-new-maintenance"]'
    );
    expect(addBtn).toBeTruthy();
    expect(addBtn!.href).toContain("#/maintenance/new");
    expect(
      host.querySelector('[data-testid="maintenance-no-active-banner"]')
    ).toBeTruthy();
  });

  it("/maintenance/new renders create form with datetime-local inputs + status", async () => {
    const host = container();
    mountSettingsRoute(host, "/maintenance/new");
    await tick();
    const form = host.querySelector<HTMLFormElement>('[data-testid="maintenance-form"]');
    expect(form).toBeTruthy();
    const start = form!.querySelector<HTMLInputElement>('[data-testid="mf-start"]');
    const end = form!.querySelector<HTMLInputElement>('[data-testid="mf-end"]');
    const status = form!.querySelector<HTMLSelectElement>('[data-testid="mf-status"]');
    expect(start?.type).toBe("datetime-local");
    expect(end?.type).toBe("datetime-local");
    expect(status?.options.length).toBe(2);
  });
});

// ── SystemInformation dispatcher ─────────────────────────────────────────────

describe("SystemInformation dispatcher (wired via system.information key)", () => {
  it("matches system-info route", () => {
    expect(isSystemInformationRoute("/system/systemInformation")).toBe(true);
    expect(isSystemInformationRoute("/system/anything-else")).toBe(false);
    expect(isSystemInformationRoute("/settings")).toBe(false);
  });

  it("renders wired banner + textarea", async () => {
    const host = container();
    mountSystemInformationRoute(host, "/system/systemInformation");
    await tick();
    expect(
      host.querySelector('[data-testid="system-info-placeholder-banner"]')
    ).toBeTruthy();
    const textarea = host.querySelector<HTMLTextAreaElement>(
      '[data-testid="system-info-textarea"]'
    );
    expect(textarea).toBeTruthy();
  });

  it("textarea initializes from backend value", async () => {
    installFetch((input) => {
      const url = typeof input === "string" ? input : (input as URL | Request).toString();
      if (url.includes("/api/admin/settings")) {
        return apiOk({
          settings: [
            {
              key: "system.information",
              value: "Hello from backend",
              category: "general",
              description: "",
              type: "string",
              isDefault: false,
              updatedByUserId: null,
              updatedAt: new Date().toISOString(),
            },
          ],
          count: 1,
        });
      }
      return jsonResponse(404, { ok: false, error: { code: "NOT_FOUND", message: "" } });
    });

    const host = container();
    mountSystemInformationRoute(host, "/system/systemInformation");
    await tick();
    const textarea = host.querySelector<HTMLTextAreaElement>(
      '[data-testid="system-info-textarea"]'
    )!;
    expect(textarea.value).toBe("Hello from backend");
  });
});

// ── otherGames dispatcher (BIN-679) ──────────────────────────────────────────

describe("BIN-679 otherGames dispatcher", () => {
  it("matches 4 mini-game routes", () => {
    expect(isOtherGamesRoute("/wheelOfFortune")).toBe(true);
    expect(isOtherGamesRoute("/treasureChest")).toBe(true);
    expect(isOtherGamesRoute("/mystery")).toBe(true);
    expect(isOtherGamesRoute("/colorDraft")).toBe(true);
    expect(isOtherGamesRoute("/cms")).toBe(false);
  });

  it("/wheelOfFortune renders 24 prize inputs + JSON editor + active checkbox", async () => {
    const host = container();
    mountOtherGamesRoute(host, "/wheelOfFortune");
    await tick();
    const inputs = host.querySelectorAll<HTMLInputElement>(
      '[data-testid="wheel-prizes"] input[type="number"]'
    );
    expect(inputs.length).toBe(24);
    expect(host.querySelector('[data-testid="wheel-wired-banner"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="mg-config-json"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="mg-active"]')).toBeTruthy();
  });

  it("/treasureChest renders 10 prize inputs", async () => {
    const host = container();
    mountOtherGamesRoute(host, "/treasureChest");
    await tick();
    const inputs = host.querySelectorAll<HTMLInputElement>(
      '[data-testid="chest-prizes"] input[type="number"]'
    );
    expect(inputs.length).toBe(10);
  });

  it("/mystery renders 6 prize inputs", async () => {
    const host = container();
    mountOtherGamesRoute(host, "/mystery");
    await tick();
    const inputs = host.querySelectorAll<HTMLInputElement>(
      '[data-testid="mystery-prizes"] input[type="number"]'
    );
    expect(inputs.length).toBe(6);
  });

  it("/colorDraft renders 4 inputs per color × 3 colors", async () => {
    const host = container();
    mountOtherGamesRoute(host, "/colorDraft");
    await tick();
    const red = host.querySelectorAll<HTMLInputElement>(
      '[data-testid="colordraft-red"] input[type="number"]'
    );
    const yellow = host.querySelectorAll<HTMLInputElement>(
      '[data-testid="colordraft-yellow"] input[type="number"]'
    );
    const green = host.querySelectorAll<HTMLInputElement>(
      '[data-testid="colordraft-green"] input[type="number"]'
    );
    expect(red.length).toBe(4);
    expect(yellow.length).toBe(4);
    expect(green.length).toBe(4);
  });

  it("/wheelOfFortune seeds prize inputs from backend legacy prizeList", async () => {
    installFetch((input) => {
      const url = typeof input === "string" ? input : (input as URL | Request).toString();
      if (url.includes("/api/admin/mini-games/wheel")) {
        return apiOk({
          id: "wheel-1",
          gameType: "wheel",
          config: { prizeList: [777, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
          active: true,
          updatedByUserId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
      return jsonResponse(404, { ok: false, error: { code: "NOT_FOUND", message: "" } });
    });

    const host = container();
    mountOtherGamesRoute(host, "/wheelOfFortune");
    await tick();
    const first = host.querySelector<HTMLInputElement>(
      '[data-testid="wheel-prizes"] input[name="price-0"]'
    )!;
    expect(first.value).toBe("777");
  });
});

// ── PR-A1 generic MiniGameConfigPage ────────────────────────────────────────

describe("PR-A1 generic MiniGameConfigPage", () => {
  it("isMiniGameType accepts the 4 canonical types and rejects others", () => {
    expect(isMiniGameType("wheel")).toBe(true);
    expect(isMiniGameType("chest")).toBe(true);
    expect(isMiniGameType("mystery")).toBe(true);
    expect(isMiniGameType("colordraft")).toBe(true);
    expect(isMiniGameType("bogus")).toBe(false);
    expect(isMiniGameType("")).toBe(false);
  });

  it("schemaForType returns expected shape per type", () => {
    const wheel = schemaForType("wheel");
    expect(wheel.testPrefix).toBe("wheel");
    expect(wheel.groups.length).toBe(1);
    expect(wheel.groups[0]!.count).toBe(24);
    expect(wheel.groups[0]!.gridTestId).toBe("wheel-prizes");
    expect(wheel.groups[0]!.colSize).toBe("col-lg-1");

    const chest = schemaForType("chest");
    expect(chest.testPrefix).toBe("chest");
    expect(chest.groups.length).toBe(1);
    expect(chest.groups[0]!.count).toBe(10);

    const mystery = schemaForType("mystery");
    expect(mystery.testPrefix).toBe("mystery");
    expect(mystery.groups[0]!.count).toBe(6);

    const colordraft = schemaForType("colordraft");
    expect(colordraft.testPrefix).toBe("colordraft");
    expect(colordraft.groups.length).toBe(3);
    expect(colordraft.groups.map((g) => g.gridTestId)).toEqual([
      "colordraft-red",
      "colordraft-yellow",
      "colordraft-green",
    ]);
  });

  it("renderMiniGameConfigPage renders correct field count per type (direct call)", async () => {
    // wheel: 24 flat
    const hostWheel = container();
    renderMiniGameConfigPage(hostWheel, "wheel");
    await tick();
    expect(
      hostWheel.querySelectorAll('[data-testid="wheel-prizes"] input[type="number"]').length
    ).toBe(24);
    expect(hostWheel.querySelector('form[data-testid="wheel-form"]')).toBeTruthy();

    // chest: 10 flat
    const hostChest = container();
    renderMiniGameConfigPage(hostChest, "chest");
    await tick();
    expect(
      hostChest.querySelectorAll('[data-testid="chest-prizes"] input[type="number"]').length
    ).toBe(10);

    // mystery: 6 flat
    const hostMystery = container();
    renderMiniGameConfigPage(hostMystery, "mystery");
    await tick();
    expect(
      hostMystery.querySelectorAll('[data-testid="mystery-prizes"] input[type="number"]').length
    ).toBe(6);

    // colordraft: 3×4
    const hostColor = container();
    renderMiniGameConfigPage(hostColor, "colordraft");
    await tick();
    expect(
      hostColor.querySelectorAll('[data-testid="colordraft-red"] input[type="number"]').length
    ).toBe(4);
    expect(
      hostColor.querySelectorAll('[data-testid="colordraft-yellow"] input[type="number"]').length
    ).toBe(4);
    expect(
      hostColor.querySelectorAll('[data-testid="colordraft-green"] input[type="number"]').length
    ).toBe(4);
  });

  it("colordraft seeds prize inputs per color from legacy *Prizes-fields", async () => {
    installFetch((input) => {
      const url = typeof input === "string" ? input : (input as URL | Request).toString();
      if (url.includes("/api/admin/mini-games/colordraft")) {
        return apiOk({
          id: "colordraft-1",
          gameType: "colordraft",
          config: {
            redPrizes: [100, 200, 300, 400],
            yellowPrizes: [10, 20, 30, 40],
            greenPrizes: [1, 2, 3, 4],
          },
          active: true,
          updatedByUserId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
      return jsonResponse(404, { ok: false, error: { code: "NOT_FOUND", message: "" } });
    });

    const host = container();
    mountOtherGamesRoute(host, "/colorDraft");
    await tick();
    const red0 = host.querySelector<HTMLInputElement>(
      '[data-testid="colordraft-red"] input[name="redColorPrize-0"]'
    )!;
    const yellow2 = host.querySelector<HTMLInputElement>(
      '[data-testid="colordraft-yellow"] input[name="yellowColorPrize-2"]'
    )!;
    const green3 = host.querySelector<HTMLInputElement>(
      '[data-testid="colordraft-green"] input[name="greenColorPrize-3"]'
    )!;
    expect(red0.value).toBe("100");
    expect(yellow2.value).toBe("30");
    expect(green3.value).toBe("4");
  });
});

// ── i18n key coverage ───────────────────────────────────────────────────────

describe("BIN-676/677/679 i18n-keys present in NO + EN", () => {
  const REQUIRED_KEYS = [
    // CMS (BIN-676 / BIN-680)
    "cms_regulatory_locked_title",
    "cms_regulatory_locked_body",
    "cms_locked_by_bin680_label",
    "cms_locked_by_bin680_hint",
    "move_up",
    "move_down",
    "terms_of_service",
    "responsible_gaming",
    // maintenance (BIN-677)
    "maintenance_list_title",
    "maintenance_new_window",
    "maintenance_create",
    "maintenance_message",
    "maintenance_start_date",
    "maintenance_end_date",
    "maintenance_status",
    "show_before_minutes",
    "maintenance_wired_banner",
    // settings (BIN-677)
    "system_settings_wired_banner",
    "setting_category_general",
    "setting_category_app_versions",
    "setting_category_compliance",
    "setting_category_branding",
    "setting_category_feature_flags",
    "setting_json_parse_error",
    "setting_save_success",
    "per_hall_spillvett_override_info",
    // other games (BIN-679)
    "mini_games_wired_banner",
    "mini_games_config_json",
    "mini_games_active",
    "wheel_of_fortune_prize",
    // leaderboard (BIN-668)
    "leaderboard_tier_create",
    "leaderboard_tier_update",
    "leaderboard_tier_delete",
    "leaderboard_tier_name",
    "leaderboard_place",
    "leaderboard_points",
    "leaderboard_prize_amount",
    "leaderboard_prize_description",
    "leaderboard_active",
    "leaderboard_tier_list_title",
  ];

  it("NO has all wired-settings keys", () => {
    const no = noI18n as Record<string, string>;
    for (const k of REQUIRED_KEYS) {
      expect(no[k], `missing NO key: ${k}`).toBeTruthy();
    }
  });

  it("EN has all wired-settings keys", () => {
    const en = enI18n as Record<string, string>;
    for (const k of REQUIRED_KEYS) {
      expect(en[k], `missing EN key: ${k}`).toBeTruthy();
    }
  });
});
