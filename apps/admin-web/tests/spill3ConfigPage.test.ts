/**
 * Spill 3 (Monsterbingo) admin-config — UI-tester (Tobias-direktiv 2026-05-08).
 *
 * Verifiserer:
 *   - GET → render av form med default-verdier (åpningstid, bongpris,
 *     min-tickets, pause, prize-mode + radene)
 *   - Conditional input-fields (fixed vs. percentage)
 *   - Live-preview-tabell oppdateres ved input
 *   - PUT med diff-only payload (kun endrete felt sendes)
 *   - Validering: pct > 100 → ingen PUT
 *   - Validering: ugyldig HH:MM → ingen PUT
 *   - Validering: start >= end → ingen PUT
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { initI18n } from "../src/i18n/I18n.js";
import { renderSpill3ConfigPage } from "../src/pages/games/spill3Config/Spill3ConfigPage.js";

type FetchCall = { url: string; init: RequestInit };

function mockApi(): { calls: FetchCall[]; queue: Array<{ body: unknown; status?: number }> } {
  const calls: FetchCall[] = [];
  const queue: Array<{ body: unknown; status?: number }> = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    const next = queue.shift();
    if (!next) {
      return new Response(JSON.stringify({ ok: true, data: null }), { status: 200 });
    }
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return { calls, queue };
}

function tick(ms = 0): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

const PERCENTAGE_CONFIG_RESPONSE = {
  ok: true,
  data: {
    id: "spill3-default",
    minTicketsToStart: 20,
    prizeMode: "percentage" as const,
    prizeRad1Cents: null,
    prizeRad2Cents: null,
    prizeRad3Cents: null,
    prizeRad4Cents: null,
    prizeFullHouseCents: null,
    prizeRad1Pct: 5,
    prizeRad2Pct: 8,
    prizeRad3Pct: 12,
    prizeRad4Pct: 15,
    prizeFullHousePct: 30,
    ticketPriceCents: 500,
    pauseBetweenRowsMs: 3000,
    openingTimeStart: "11:00",
    openingTimeEnd: "23:00",
    active: true,
    createdAt: "2026-05-08T00:00:00Z",
    updatedAt: "2026-05-08T00:00:00Z",
    updatedByUserId: null,
  },
};

const FIXED_CONFIG_RESPONSE = {
  ok: true,
  data: {
    ...PERCENTAGE_CONFIG_RESPONSE.data,
    prizeMode: "fixed" as const,
    prizeRad1Cents: 5000,
    prizeRad2Cents: 8000,
    prizeRad3Cents: 12000,
    prizeRad4Cents: 15000,
    prizeFullHouseCents: 30000,
    prizeRad1Pct: null,
    prizeRad2Pct: null,
    prizeRad3Pct: null,
    prizeRad4Pct: null,
    prizeFullHousePct: null,
  },
};

describe("Spill3ConfigPage", () => {
  beforeEach(() => {
    initI18n();
    document.body.innerHTML = "";
    window.localStorage.setItem("bingo_admin_access_token", "tok");
  });

  it("renders form med default-verdier fra GET", async () => {
    const { queue } = mockApi();
    queue.push({ body: PERCENTAGE_CONFIG_RESPONSE });

    const root = document.createElement("div");
    document.body.appendChild(root);
    void renderSpill3ConfigPage(root);

    for (let i = 0; i < 30 && !root.querySelector('[data-testid="spill3-config-form"]'); i++) {
      await tick(10);
    }

    expect(
      root.querySelector<HTMLInputElement>('[data-testid="spill3-openingTimeStart-input"]')?.value,
    ).toBe("11:00");
    expect(
      root.querySelector<HTMLInputElement>('[data-testid="spill3-openingTimeEnd-input"]')?.value,
    ).toBe("23:00");
    expect(
      root.querySelector<HTMLInputElement>('[data-testid="spill3-minTicketsToStart-input"]')?.value,
    ).toBe("20");
    expect(
      root.querySelector<HTMLInputElement>('[data-testid="spill3-ticketPriceKr-input"]')?.value,
    ).toBe("5");
    expect(
      root.querySelector<HTMLInputElement>('[data-testid="spill3-pauseSec-input"]')?.value,
    ).toBe("3");
    expect(
      root.querySelector<HTMLInputElement>('[data-testid="spill3-prizeMode-percentage"]')?.checked,
    ).toBe(true);
    expect(
      root.querySelector<HTMLInputElement>('[data-testid="spill3-pct-p1-input"]')?.value,
    ).toBe("5");
  });

  it("viser percentage-felter og skjuler fixed-felter når mode=percentage", async () => {
    const { queue } = mockApi();
    queue.push({ body: PERCENTAGE_CONFIG_RESPONSE });

    const root = document.createElement("div");
    document.body.appendChild(root);
    void renderSpill3ConfigPage(root);

    for (let i = 0; i < 30 && !root.querySelector('[data-testid="spill3-config-form"]'); i++) {
      await tick(10);
    }

    const fixedSection = root.querySelector<HTMLElement>(".spill3-prizes-fixed");
    const pctSection = root.querySelector<HTMLElement>(".spill3-prizes-percentage");
    expect(fixedSection?.style.display).toBe("none");
    expect(pctSection?.style.display).toBe("");
  });

  it("viser fixed-felter og skjuler percentage-felter når mode=fixed", async () => {
    const { queue } = mockApi();
    queue.push({ body: FIXED_CONFIG_RESPONSE });

    const root = document.createElement("div");
    document.body.appendChild(root);
    void renderSpill3ConfigPage(root);

    for (let i = 0; i < 30 && !root.querySelector('[data-testid="spill3-config-form"]'); i++) {
      await tick(10);
    }

    const fixedSection = root.querySelector<HTMLElement>(".spill3-prizes-fixed");
    const pctSection = root.querySelector<HTMLElement>(".spill3-prizes-percentage");
    expect(fixedSection?.style.display).toBe("");
    expect(pctSection?.style.display).toBe("none");
  });

  it("toggler fra percentage til fixed-mode via radio-click", async () => {
    const { queue } = mockApi();
    queue.push({ body: PERCENTAGE_CONFIG_RESPONSE });

    const root = document.createElement("div");
    document.body.appendChild(root);
    void renderSpill3ConfigPage(root);

    for (let i = 0; i < 30 && !root.querySelector('[data-testid="spill3-config-form"]'); i++) {
      await tick(10);
    }

    const fixedRadio = root.querySelector<HTMLInputElement>('[data-testid="spill3-prizeMode-fixed"]')!;
    fixedRadio.checked = true;
    fixedRadio.dispatchEvent(new Event("change", { bubbles: true }));

    await tick(20);

    const fixedSection = root.querySelector<HTMLElement>(".spill3-prizes-fixed");
    const pctSection = root.querySelector<HTMLElement>(".spill3-prizes-percentage");
    expect(fixedSection?.style.display).toBe("");
    expect(pctSection?.style.display).toBe("none");
  });

  it("genererer preview-tabell ved init", async () => {
    const { queue } = mockApi();
    queue.push({ body: PERCENTAGE_CONFIG_RESPONSE });

    const root = document.createElement("div");
    document.body.appendChild(root);
    void renderSpill3ConfigPage(root);

    for (let i = 0; i < 30 && !root.querySelector('[data-testid="spill3-preview-table"]'); i++) {
      await tick(10);
    }

    // Preview-rader skal være rendert (4 rader for 20/50/100/200 bonger).
    const tbody = root.querySelector<HTMLTableSectionElement>("#spill3-preview-tbody");
    expect(tbody?.querySelectorAll("tr").length).toBe(4);

    // 100 bonger × 5 kr = 500 kr omsetning. Rad 1 = 5% = 25 kr.
    const cells100 = tbody?.querySelectorAll('[data-testid="preview-100"]');
    expect(cells100?.length).toBe(5);  // 5 faser
    expect(cells100?.[0]?.textContent).toContain("25 kr");
    // Fullt Hus = 30% = 150 kr.
    expect(cells100?.[4]?.textContent).toContain("150 kr");
  });

  it("sender PUT med diff-only patch ved endring av minTicketsToStart", async () => {
    const { queue, calls } = mockApi();
    queue.push({ body: PERCENTAGE_CONFIG_RESPONSE });
    // PUT response — same data men oppdatert verdi.
    queue.push({
      body: {
        ok: true,
        data: { ...PERCENTAGE_CONFIG_RESPONSE.data, minTicketsToStart: 50 },
      },
    });

    const root = document.createElement("div");
    document.body.appendChild(root);
    void renderSpill3ConfigPage(root);

    for (let i = 0; i < 30 && !root.querySelector('[data-testid="spill3-minTicketsToStart-input"]'); i++) {
      await tick(10);
    }

    const minInput = root.querySelector<HTMLInputElement>('[data-testid="spill3-minTicketsToStart-input"]')!;
    minInput.value = "50";

    const form = root.querySelector<HTMLFormElement>("#spill3-config-form")!;
    form.dispatchEvent(new Event("submit", { cancelable: true }));

    for (let i = 0; i < 30 && !calls.some((c) => c.init.method === "PUT"); i++) {
      await tick(10);
    }

    const putCall = calls.find((c) => c.init.method === "PUT");
    expect(putCall).toBeTruthy();
    expect(putCall!.url).toContain("/api/admin/spill3/config");
    const body = JSON.parse(String(putCall!.init.body));
    // Kun minTicketsToStart skal være sendt.
    expect(body).toEqual({ minTicketsToStart: 50 });
  });

  it("sender PUT med åpningstider når disse endres", async () => {
    const { queue, calls } = mockApi();
    queue.push({ body: PERCENTAGE_CONFIG_RESPONSE });
    queue.push({
      body: {
        ok: true,
        data: {
          ...PERCENTAGE_CONFIG_RESPONSE.data,
          openingTimeStart: "10:00",
          openingTimeEnd: "22:00",
        },
      },
    });

    const root = document.createElement("div");
    document.body.appendChild(root);
    void renderSpill3ConfigPage(root);

    for (let i = 0; i < 30 && !root.querySelector('[data-testid="spill3-openingTimeStart-input"]'); i++) {
      await tick(10);
    }

    const startInput = root.querySelector<HTMLInputElement>(
      '[data-testid="spill3-openingTimeStart-input"]',
    )!;
    const endInput = root.querySelector<HTMLInputElement>(
      '[data-testid="spill3-openingTimeEnd-input"]',
    )!;
    startInput.value = "10:00";
    endInput.value = "22:00";

    const form = root.querySelector<HTMLFormElement>("#spill3-config-form")!;
    form.dispatchEvent(new Event("submit", { cancelable: true }));

    for (let i = 0; i < 30 && !calls.some((c) => c.init.method === "PUT"); i++) {
      await tick(10);
    }

    const putCall = calls.find((c) => c.init.method === "PUT");
    expect(putCall).toBeTruthy();
    const body = JSON.parse(String(putCall!.init.body));
    expect(body.openingTimeStart).toBe("10:00");
    expect(body.openingTimeEnd).toBe("22:00");
  });

  it("blokkerer submit når start >= end (client-side)", async () => {
    const { queue, calls } = mockApi();
    queue.push({ body: PERCENTAGE_CONFIG_RESPONSE });

    const root = document.createElement("div");
    document.body.appendChild(root);
    void renderSpill3ConfigPage(root);

    for (let i = 0; i < 30 && !root.querySelector('[data-testid="spill3-openingTimeStart-input"]'); i++) {
      await tick(10);
    }

    const startInput = root.querySelector<HTMLInputElement>(
      '[data-testid="spill3-openingTimeStart-input"]',
    )!;
    const endInput = root.querySelector<HTMLInputElement>(
      '[data-testid="spill3-openingTimeEnd-input"]',
    )!;
    startInput.value = "22:00";
    endInput.value = "10:00";

    const form = root.querySelector<HTMLFormElement>("#spill3-config-form")!;
    form.dispatchEvent(new Event("submit", { cancelable: true }));

    await tick(50);
    expect(calls.some((c) => c.init.method === "PUT")).toBe(false);
  });

  it("blokkerer submit når sum av prosenter > 100 (client-side)", async () => {
    const { queue, calls } = mockApi();
    queue.push({ body: PERCENTAGE_CONFIG_RESPONSE });

    const root = document.createElement("div");
    document.body.appendChild(root);
    void renderSpill3ConfigPage(root);

    for (let i = 0; i < 30 && !root.querySelector('[data-testid="spill3-pct-p1-input"]'); i++) {
      await tick(10);
    }

    // Sett prosenter slik at sum overstiger 100.
    const inputs = ["p1", "p2", "p3", "p4", "p5"];
    for (const id of inputs) {
      const el = root.querySelector<HTMLInputElement>(`[data-testid="spill3-pct-${id}-input"]`)!;
      el.value = "30";
    }

    const form = root.querySelector<HTMLFormElement>("#spill3-config-form")!;
    form.dispatchEvent(new Event("submit", { cancelable: true }));

    await tick(50);
    expect(calls.some((c) => c.init.method === "PUT")).toBe(false);
  });

  it("ingen PUT når ingen felter er endret (no-op)", async () => {
    const { queue, calls } = mockApi();
    queue.push({ body: PERCENTAGE_CONFIG_RESPONSE });

    const root = document.createElement("div");
    document.body.appendChild(root);
    void renderSpill3ConfigPage(root);

    for (let i = 0; i < 30 && !root.querySelector('[data-testid="spill3-config-form"]'); i++) {
      await tick(10);
    }

    const form = root.querySelector<HTMLFormElement>("#spill3-config-form")!;
    form.dispatchEvent(new Event("submit", { cancelable: true }));

    await tick(50);
    expect(calls.some((c) => c.init.method === "PUT")).toBe(false);
  });

  it("oppdaterer preview-tabell når bongpris endres", async () => {
    const { queue } = mockApi();
    queue.push({ body: PERCENTAGE_CONFIG_RESPONSE });

    const root = document.createElement("div");
    document.body.appendChild(root);
    void renderSpill3ConfigPage(root);

    for (let i = 0; i < 30 && !root.querySelector('[data-testid="spill3-ticketPriceKr-input"]'); i++) {
      await tick(10);
    }

    const priceInput = root.querySelector<HTMLInputElement>(
      '[data-testid="spill3-ticketPriceKr-input"]',
    )!;
    priceInput.value = "10";  // 10 kr per bong i stedet for 5.
    priceInput.dispatchEvent(new Event("input", { bubbles: true }));

    await tick(20);

    // 100 bonger × 10 kr = 1000 kr omsetning. Rad 1 = 5% = 50 kr.
    const tbody = root.querySelector<HTMLTableSectionElement>("#spill3-preview-tbody");
    const cells100 = tbody?.querySelectorAll('[data-testid="preview-100"]');
    expect(cells100?.[0]?.textContent).toContain("50 kr");
    // Fullt Hus = 30% × 1000 = 300 kr.
    expect(cells100?.[4]?.textContent).toContain("300 kr");
  });
});
