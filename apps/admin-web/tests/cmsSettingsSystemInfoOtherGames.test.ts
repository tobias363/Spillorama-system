// PR-A6 (BIN-674) / BIN-676 — tests for CMS + Settings + SystemInfo + otherGames.
//
// Focus: dispatcher-contract, regulatorisk-lock for Spillvett-tekst (BIN-680),
// FEATURE_DISABLED-håndtering, FAQ CRUD-roundtrip, i18n-key coverage. CMS
// skjermer bruker mocked fetch mot `/api/admin/cms/*` (BIN-676 backend).

import { describe, it, expect, beforeEach, vi } from "vitest";
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
import noI18n from "../src/i18n/no.json";
import enI18n from "../src/i18n/en.json";

async function tick(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise<void>((r) => setTimeout(r, 0));
}

function container(): HTMLElement {
  document.body.innerHTML = `<div id="app"></div>`;
  return document.getElementById("app")!;
}

// ── Fetch-mock utility (BIN-676) ─────────────────────────────────────────────

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

beforeEach(() => {
  window.localStorage.clear();
  initI18n();
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

// ── CMS dispatcher ───────────────────────────────────────────────────────────

describe("PR-A6 CMS dispatcher", () => {
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
    expect(isCmsRoute("/faq/something-else")).toBe(false);
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

  it("/ResponsibleGameing shows regulatory lock banner and renders read-only textarea with disabled save (BIN-680)", async () => {
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
    ]);
    const host = container();
    mountCmsRoute(host, "/ResponsibleGameing");
    await tick();
    expect(host.querySelector('[data-testid="cms-regulatory-lock-banner"]')).toBeTruthy();
    const textarea = host.querySelector<HTMLTextAreaElement>('[data-testid="cms-body-textarea"]');
    expect(textarea?.readOnly).toBe(true);
    // GET fungerte selv om siden er låst — tekst skal vises.
    expect(textarea?.value).toBe("Gjeldende tekst");
    const save = host.querySelector<HTMLButtonElement>('[data-testid="cms-save-btn"]');
    expect(save).toBeTruthy();
    expect(save!.disabled).toBe(true);
    expect(save!.title).toContain("BIN-680");
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
    // Lock banner must NOT be present for non-regulatory pages.
    expect(host.querySelector('[data-testid="cms-regulatory-lock-banner"]')).toBeNull();

    // Submit flow
    textarea!.value = "Vilkår v2";
    const form = host.querySelector<HTMLFormElement>("#cms-text-form")!;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await tick();
    expect(puttedContent).toBe("Vilkår v2");
  });

  it("/ResponsibleGameing: hvis noen likevel sender PUT returnerer backend FEATURE_DISABLED og UI toaster feilmelding", async () => {
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
        status: 400,
        handler: () => ({
          ok: false,
          error: {
            code: "FEATURE_DISABLED",
            message:
              "Redigering av 'responsible-gaming' krever versjons-historikk og er foreløpig deaktivert. Blokkert av BIN-680.",
          },
        }),
      },
    ]);
    const host = container();
    mountCmsRoute(host, "/ResponsibleGameing");
    await tick();
    const form = host.querySelector<HTMLFormElement>("#cms-text-form")!;
    // Submit — UI-form er disabled, men defensive sti tester at det likevel
    // ikke kaster ut av prosessen når backend avviser med FEATURE_DISABLED.
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await tick();
    // GET ble kalt, men PUT skal ikke ha blitt kalt fordi isLocked-sjekken
    // i UI-en abortsubmit. (Defensivt: selv om det hadde gått igjennom, ville
    // backend returnert FEATURE_DISABLED og UI ville vist feil-toast.)
    const putCalls = router.mock.calls.filter(
      (c) => (c[1] as RequestInit | undefined)?.method === "PUT"
    );
    expect(putCalls.length).toBe(0);
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
    // Placeholder banner should NOT be present on wired FAQ list (BIN-676).
    expect(host.querySelector('[data-testid="cms-placeholder-banner"]')).toBeNull();
    const addBtn = host.querySelector<HTMLAnchorElement>('[data-testid="faq-add-btn"]');
    expect(addBtn).toBeTruthy();
    expect(addBtn!.href).toContain("#/addFAQ");
    // Rad vises fra mocket backend.
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

// ── Settings dispatcher ──────────────────────────────────────────────────────

describe("PR-A6 Settings dispatcher", () => {
  it("matches settings + maintenance routes", () => {
    expect(isSettingsRoute("/settings")).toBe(true);
    expect(isSettingsRoute("/maintenance")).toBe(true);
    expect(isSettingsRoute("/maintenance/edit/m1")).toBe(true);
    expect(isSettingsRoute("/cms")).toBe(false);
    expect(isSettingsRoute("/maintenance/edit/")).toBe(false);
  });

  it("/settings renders form with read-only spiller-tak + info banner", async () => {
    const host = container();
    mountSettingsRoute(host, "/settings");
    await tick();
    expect(host.querySelector('[data-testid="settings-placeholder-banner"]')).toBeTruthy();
    expect(
      host.querySelector('[data-testid="per-hall-spillvett-override-info"]')
    ).toBeTruthy();
    const daily = host.querySelector<HTMLInputElement>('[data-testid="sf-daily-readonly"]');
    expect(daily?.readOnly).toBe(true);
    const monthly = host.querySelector<HTMLInputElement>('[data-testid="sf-monthly-readonly"]');
    expect(monthly?.readOnly).toBe(true);
  });

  it("/maintenance renders status block + edit button", async () => {
    const host = container();
    mountSettingsRoute(host, "/maintenance");
    await tick();
    const edit = host.querySelector<HTMLAnchorElement>('[data-action="edit-maintenance"]');
    expect(edit).toBeTruthy();
    expect(edit!.href).toContain("#/maintenance/edit/");
  });

  it("/maintenance/edit/:id renders form with status select", async () => {
    const host = container();
    mountSettingsRoute(host, "/maintenance/edit/maintenance-default");
    await tick();
    const form = host.querySelector<HTMLFormElement>('[data-testid="maintenance-form"]');
    expect(form).toBeTruthy();
    const status = form!.querySelector<HTMLSelectElement>("#mf-status");
    expect(status).toBeTruthy();
    expect(status!.options.length).toBe(2);
  });
});

// ── SystemInformation dispatcher ─────────────────────────────────────────────

describe("PR-A6 SystemInformation dispatcher", () => {
  it("matches system-info route", () => {
    expect(isSystemInformationRoute("/system/systemInformation")).toBe(true);
    expect(isSystemInformationRoute("/system/anything-else")).toBe(false);
    expect(isSystemInformationRoute("/settings")).toBe(false);
  });

  it("renders placeholder banner + textarea", async () => {
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

  it("persists edit through localStorage roundtrip", async () => {
    const host = container();
    mountSystemInformationRoute(host, "/system/systemInformation");
    await tick();

    const textarea = host.querySelector<HTMLTextAreaElement>(
      '[data-testid="system-info-textarea"]'
    )!;
    textarea.value = "Hello PR-A6";
    const form = host.querySelector<HTMLFormElement>('[data-testid="system-info-form"]')!;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await tick();

    // Re-mount to verify persistence
    const host2 = container();
    mountSystemInformationRoute(host2, "/system/systemInformation");
    await tick();
    const textarea2 = host2.querySelector<HTMLTextAreaElement>(
      '[data-testid="system-info-textarea"]'
    )!;
    expect(textarea2.value).toBe("Hello PR-A6");
  });
});

// ── otherGames dispatcher ────────────────────────────────────────────────────

describe("PR-A6 otherGames dispatcher", () => {
  it("matches 4 mini-game routes", () => {
    expect(isOtherGamesRoute("/wheelOfFortune")).toBe(true);
    expect(isOtherGamesRoute("/treasureChest")).toBe(true);
    expect(isOtherGamesRoute("/mystery")).toBe(true);
    expect(isOtherGamesRoute("/colorDraft")).toBe(true);
    expect(isOtherGamesRoute("/cms")).toBe(false);
    expect(isOtherGamesRoute("/wheelOfFortune/extra")).toBe(false);
  });

  it("/wheelOfFortune renders 24 prize inputs", async () => {
    const host = container();
    mountOtherGamesRoute(host, "/wheelOfFortune");
    await tick();
    const inputs = host.querySelectorAll<HTMLInputElement>(
      '[data-testid="wheel-prizes"] input[type="number"]'
    );
    expect(inputs.length).toBe(24);
    expect(host.querySelector('[data-testid="wheel-placeholder-banner"]')).toBeTruthy();
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

  it("wheelOfFortune form submit persists prize values", async () => {
    const host = container();
    mountOtherGamesRoute(host, "/wheelOfFortune");
    await tick();

    const first = host.querySelector<HTMLInputElement>(
      '[data-testid="wheel-prizes"] input[name="price-0"]'
    )!;
    first.value = "777";
    const form = host.querySelector<HTMLFormElement>('[data-testid="wheel-form"]')!;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await tick();

    const host2 = container();
    mountOtherGamesRoute(host2, "/wheelOfFortune");
    await tick();
    const first2 = host2.querySelector<HTMLInputElement>(
      '[data-testid="wheel-prizes"] input[name="price-0"]'
    )!;
    expect(first2.value).toBe("777");
  });
});

// ── i18n key coverage ───────────────────────────────────────────────────────

describe("PR-A6 i18n-keys present in NO + EN", () => {
  const REQUIRED_KEYS = [
    "cms_placeholder_banner",
    "cms_spillvett_audit_required_title",
    "cms_spillvett_audit_required_body",
    // BIN-676 (wired backend) + BIN-680 (regulatory lock):
    "cms_regulatory_locked_title",
    "cms_regulatory_locked_body",
    "cms_locked_by_bin680_label",
    "cms_locked_by_bin680_hint",
    "move_up",
    "move_down",
    "terms_of_service",
    "responsible_gaming",
    "question",
    "maintenance_management",
    "maintenance_message",
    "maintenance_start_date",
    "maintenance_end_date",
    "maintenance_status",
    "show_before_minutes",
    "settings_placeholder_banner",
    "per_hall_spillvett_override_info",
    "system_information_body",
    "system_information_placeholder_banner",
    "wheel_of_fortune_prize",
    "other_games_placeholder_banner",
  ];

  it("NO has all PR-A6 keys", () => {
    const no = noI18n as Record<string, string>;
    for (const k of REQUIRED_KEYS) {
      expect(no[k], `missing NO key: ${k}`).toBeTruthy();
    }
  });

  it("EN has all PR-A6 keys", () => {
    const en = enI18n as Record<string, string>;
    for (const k of REQUIRED_KEYS) {
      expect(en[k], `missing EN key: ${k}`).toBeTruthy();
    }
  });
});
