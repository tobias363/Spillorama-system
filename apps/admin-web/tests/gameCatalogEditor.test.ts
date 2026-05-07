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
    // Tobias 2026-05-07: default mode er "auto" — bingoBase brukes i
    // stedet for per-farge bingo. Per-farge bingo er tom.
    expect(p.prizeMultiplierMode).toBe("auto");
    expect(p.prizesKr.bingoBase).toBe(1000);
    expect(p.prizesKr.bingo).toEqual({});
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
    // Tobias 2026-05-07: auto-modus default — bingoBase 1000 kr → 100000 øre.
    // Per-farge bingo blir tomt; backend regner ut faktisk premie.
    expect(body.prizeMultiplierMode).toBe("auto");
    expect(body.prizesCents.bingoBase).toBe(100000);
    expect(body.prizesCents.bingo).toEqual({});
    // Rad-premier: 100kr=10000øre
    expect(body.prizesCents.rad1).toBe(10000);
    expect(body.slug).toBe("jackpot");
    expect(body.displayName).toBe("Jackpot");
  });
});

// ── Premie-modus toggle (Tobias 2026-05-07) ─────────────────────────────

describe("GameCatalogEditorPage — prizeMultiplierMode", () => {
  it("default rendrer auto-modus radio som checked + viser bingoBase-felt", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    await renderGameCatalogNewPage(container);
    const autoRadio = container.querySelector<HTMLInputElement>(
      'input[name="prizeMultiplierMode"][value="auto"]',
    );
    const explicitRadio = container.querySelector<HTMLInputElement>(
      'input[name="prizeMultiplierMode"][value="explicit_per_color"]',
    );
    expect(autoRadio?.checked).toBe(true);
    expect(explicitRadio?.checked).toBe(false);
    const baseField = container.querySelector<HTMLInputElement>(
      'input[name="prize-bingoBase"]',
    );
    expect(baseField).toBeTruthy();
    // Auto-blokk synlig, explicit-blokk skjult
    const autoBlock = container.querySelector<HTMLElement>(".prize-auto-block");
    const explicitBlock = container.querySelector<HTMLElement>(
      ".prize-explicit-block",
    );
    expect(autoBlock?.style.display).toBe("");
    expect(explicitBlock?.style.display).toBe("none");
  });

  it("toggle til explicit_per_color skjuler auto-blokken og viser per-farge bingo", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    await renderGameCatalogNewPage(container);
    const explicitRadio = container.querySelector<HTMLInputElement>(
      'input[name="prizeMultiplierMode"][value="explicit_per_color"]',
    );
    explicitRadio!.checked = true;
    explicitRadio!.dispatchEvent(new Event("change"));
    const autoBlock = container.querySelector<HTMLElement>(".prize-auto-block");
    const explicitBlock = container.querySelector<HTMLElement>(
      ".prize-explicit-block",
    );
    expect(autoBlock?.style.display).toBe("none");
    expect(explicitBlock?.style.display).toBe("");
  });

  it("auto-preview-tabell rendres med multiplikator-rader", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    await renderGameCatalogNewPage(container);
    const previewBody = container.querySelector<HTMLTableSectionElement>(
      "#cat-prize-preview tbody",
    );
    expect(previewBody).toBeTruthy();
    const rows = previewBody!.querySelectorAll("tr");
    // Default: gul + hvit aktive — to rader
    expect(rows.length).toBe(2);
    // hvit (5 kr) → multiplikator ×1
    const html = previewBody!.innerHTML;
    expect(html).toContain("Hvit");
    expect(html).toContain("×1");
    // gul (10 kr) → multiplikator ×2
    expect(html).toContain("Gul");
    expect(html).toContain("×2");
  });

  it("submit i explicit-modus sender per-farge bingo + utelater bingoBase", async () => {
    const fetchMock = mockFetch({
      id: "cat-trafikk",
      slug: "trafikklys",
      displayName: "Trafikklys",
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    await renderGameCatalogNewPage(container);

    // Velg explicit-modus
    const explicitRadio = container.querySelector<HTMLInputElement>(
      'input[name="prizeMultiplierMode"][value="explicit_per_color"]',
    );
    explicitRadio!.checked = true;
    explicitRadio!.dispatchEvent(new Event("change"));

    // Fyll inn name + slug
    (container.querySelector<HTMLInputElement>("#cat-displayName")!).value =
      "Trafikklys";
    (container.querySelector<HTMLInputElement>("#cat-slug")!).value =
      "trafikklys";

    // Eksplisitt per-farge bingo i kr — 200 og 500
    (
      container.querySelector<HTMLInputElement>('input[name="bingoPrize-gul"]')!
    ).value = "200";
    (
      container.querySelector<HTMLInputElement>('input[name="bingoPrize-hvit"]')!
    ).value = "500";

    const form = container.querySelector<HTMLFormElement>("#game-catalog-form")!;
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(init.body as string);
    expect(body.prizeMultiplierMode).toBe("explicit_per_color");
    expect(body.prizesCents.bingo.gul).toBe(20000);
    expect(body.prizesCents.bingo.hvit).toBe(50000);
    // bingoBase skal IKKE være med i explicit-modus
    expect(body.prizesCents.bingoBase).toBeUndefined();
  });
});

// ── Editor edit ─────────────────────────────────────────────────────────

describe("GameCatalogEditorPage — edit", () => {
  it("pre-fills form fra eksisterende entry", async () => {
    // Mock GET /api/admin/game-catalog/cat-1 — explicit_per_color-modus
    // (Trafikklys-stil) for å verifisere edit-flyten
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
      prizeMultiplierMode: "explicit_per_color",
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
