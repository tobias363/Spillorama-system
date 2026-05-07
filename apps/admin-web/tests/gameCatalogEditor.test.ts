/**
 * Fase 2 (2026-05-07): tester for GameCatalog admin-UI.
 *
 * Dekker:
 *   - Editor renders med default values
 *   - Validering: minst én bongfarge må velges
 *   - Bonus-spill toggle viser/skjuler dropdown
 *   - Submit happy path (mocked fetch)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initI18n } from "../src/i18n/I18n.js";
import {
  renderGameCatalogNewPage,
  renderGameCatalogEditPage,
} from "../src/pages/games/catalog/GameCatalogEditorPage.js";
import {
  defaultCatalogPayload,
  krToCents,
  centsToKr,
} from "../src/pages/games/catalog/GameCatalogState.js";

function mockFetch(response: unknown, status = 200): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ ok: status < 400, data: response }), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return fn;
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await new Promise<void>((r) => setTimeout(r, 0));
  }
}

beforeEach(() => {
  initI18n();
  document.body.innerHTML = "";
  window.localStorage.clear();
  window.localStorage.setItem("bingo_admin_access_token", "tok");
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

// ── Helpers ─────────────────────────────────────────────────────────────

describe("GameCatalogState helpers", () => {
  it("krToCents and centsToKr roundtrip", () => {
    expect(krToCents(100)).toBe(10000);
    expect(centsToKr(10000)).toBe(100);
    expect(krToCents(2500)).toBe(250000);
  });

  it("default payload har gul + hvit som standard farger", () => {
    const p = defaultCatalogPayload();
    expect(p.ticketColors).toEqual(["gul", "hvit"]);
    expect(p.ticketPricesKr.gul).toBe(10);
    expect(p.ticketPricesKr.hvit).toBe(5);
    expect(p.prizesKr.bingo.gul).toBe(2000);
    expect(p.prizesKr.bingo.hvit).toBe(500);
  });
});

// ── Editor render ───────────────────────────────────────────────────────

describe("GameCatalogEditorPage — new", () => {
  it("rendrer form med påkrevde felt", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    await renderGameCatalogNewPage(container);
    expect(container.querySelector("#cat-displayName")).toBeTruthy();
    expect(container.querySelector("#cat-slug")).toBeTruthy();
    expect(container.querySelector("#cat-isActive")).toBeTruthy();
    expect(container.querySelector("#cat-bonusEnabled")).toBeTruthy();
    expect(container.querySelector("#cat-requiresJackpotSetup")).toBeTruthy();
    // 3 fargecheckbokser
    const colorCbs = container.querySelectorAll('input[name="ticketColor"]');
    expect(colorCbs.length).toBe(3);
  });

  it("bonus-slug-row er skjult når bonus-toggle er av", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    await renderGameCatalogNewPage(container);
    const bonusEnabled = container.querySelector<HTMLInputElement>("#cat-bonusEnabled");
    expect(bonusEnabled?.checked).toBe(false);
    const slugRow = container.querySelector<HTMLElement>(".bonus-slug-row");
    // Default er false så row skal være skjult.
    expect(slugRow?.style.display).toBe("none");
  });

  it("toggle bonus-spill viser slug-dropdown", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    await renderGameCatalogNewPage(container);
    const bonusEnabled = container.querySelector<HTMLInputElement>("#cat-bonusEnabled");
    bonusEnabled!.checked = true;
    bonusEnabled!.dispatchEvent(new Event("change"));
    const slugRow = container.querySelector<HTMLElement>(".bonus-slug-row");
    expect(slugRow?.style.display).toBe("");
  });

  it("Toggle av en farge-checkbox skjuler/viser tilhørende pris- og bingorad", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    await renderGameCatalogNewPage(container);
    // Lilla er IKKE i default-listen — start med å huke den av
    const lillaCb = container.querySelector<HTMLInputElement>(
      'input[name="ticketColor"][value="lilla"]',
    );
    const lillaPriceRow = container.querySelector<HTMLElement>(
      '.ticket-price-row[data-color="lilla"]',
    );
    expect(lillaPriceRow?.style.display).toBe("none");
    lillaCb!.checked = true;
    lillaCb!.dispatchEvent(new Event("change"));
    expect(lillaPriceRow?.style.display).toBe("");
  });

  it("submit POST-er payload med øre-konverterte beløp", async () => {
    const fetchMock = mockFetch({
      id: "cat-1",
      slug: "jackpot",
      displayName: "Jackpot",
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    await renderGameCatalogNewPage(container);

    // Fyll inn name + slug
    (container.querySelector<HTMLInputElement>("#cat-displayName")!).value = "Jackpot";
    (container.querySelector<HTMLInputElement>("#cat-slug")!).value = "jackpot";

    // Submit
    const form = container.querySelector<HTMLFormElement>("#game-catalog-form")!;
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/admin/game-catalog");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    // Default payload: gul=10kr=1000øre, hvit=5kr=500øre
    expect(body.ticketPricesCents.gul).toBe(1000);
    expect(body.ticketPricesCents.hvit).toBe(500);
    // Bingo-premier: gul=2000kr=200000øre, hvit=500kr=50000øre
    expect(body.prizesCents.bingo.gul).toBe(200000);
    expect(body.prizesCents.bingo.hvit).toBe(50000);
    // Rad-premier: 100kr=10000øre
    expect(body.prizesCents.rad1).toBe(10000);
    expect(body.slug).toBe("jackpot");
    expect(body.displayName).toBe("Jackpot");
  });
});

// ── Editor edit ─────────────────────────────────────────────────────────

describe("GameCatalogEditorPage — edit", () => {
  it("pre-fills form fra eksisterende entry", async () => {
    // Mock GET /api/admin/game-catalog/cat-1
    mockFetch({
      id: "cat-1",
      slug: "innsatsen",
      displayName: "Innsatsen",
      description: "Pot-bygging",
      rules: {},
      ticketColors: ["gul", "hvit", "lilla"],
      ticketPricesCents: { gul: 1000, hvit: 500, lilla: 2000 },
      prizesCents: {
        rad1: 5000,
        rad2: 10000,
        rad3: 15000,
        rad4: 20000,
        bingo: { gul: 200000, hvit: 50000, lilla: 500000 },
      },
      bonusGameSlug: "wheel_of_fortune",
      bonusGameEnabled: true,
      requiresJackpotSetup: true,
      isActive: true,
      sortOrder: 5,
      createdAt: "2026-05-07T00:00:00Z",
      updatedAt: "2026-05-07T00:00:00Z",
      createdByUserId: "admin-1",
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    await renderGameCatalogEditPage(container, "cat-1");
    await flushMicrotasks();

    expect((container.querySelector<HTMLInputElement>("#cat-displayName")!).value).toBe(
      "Innsatsen",
    );
    expect((container.querySelector<HTMLInputElement>("#cat-slug")!).value).toBe(
      "innsatsen",
    );
    // Lilla er checked
    const lillaCb = container.querySelector<HTMLInputElement>(
      'input[name="ticketColor"][value="lilla"]',
    );
    expect(lillaCb?.checked).toBe(true);
    // Bonus-toggle er på
    expect(
      (container.querySelector<HTMLInputElement>("#cat-bonusEnabled")!).checked,
    ).toBe(true);
    expect(
      (container.querySelector<HTMLSelectElement>("#cat-bonusSlug")!).value,
    ).toBe("wheel_of_fortune");
  });
});
