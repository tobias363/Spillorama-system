/**
 * Fase 3 (2026-05-07): JackpotSetupModal render-tester.
 *
 * Tester:
 *   - Render med 3 bongfarger (gul/hvit/lilla) — alle inputs vises
 *   - Render med 2 bongfarger (gul/hvit) — kun de 2 inputs vises (ikke lilla)
 *   - Submit kaller setAgentGamePlanJackpot med riktig payload (kr → øre)
 *   - Validering: alle prisfelter må være >0 — Toast.error vises ved 0/negativ
 *   - Pre-fylte verdier fra `initial` settes i input-feltene
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  buildJackpotSetupForm,
  openJackpotSetupModal,
} from "../../src/pages/agent-portal/JackpotSetupModal.js";
import type {
  AgentGamePlanItem,
} from "../../src/api/agent-game-plan.js";
import type {
  GameCatalogEntry,
  TicketColor,
} from "../../src/api/admin-game-catalog.js";

function makeCatalog(
  ticketColors: TicketColor[],
  opts: { requiresJackpotSetup?: boolean } = {},
): GameCatalogEntry {
  return {
    id: "cat-1",
    slug: "spill-1",
    displayName: "Spill 1",
    description: null,
    rules: {},
    ticketColors,
    ticketPricesCents: { gul: 1000, hvit: 1500, lilla: 2000 },
    prizesCents: {
      rad1: 10000,
      rad2: 10000,
      rad3: 10000,
      rad4: 10000,
      bingo: { gul: 200000 },
    },
    prizeMultiplierMode: "explicit_per_color",
    bonusGameSlug: null,
    bonusGameEnabled: false,
    requiresJackpotSetup: opts.requiresJackpotSetup ?? true,
    isActive: true,
    sortOrder: 0,
    createdAt: "2026-05-07T00:00:00Z",
    updatedAt: "2026-05-07T00:00:00Z",
    createdByUserId: "admin-1",
  };
}

function makeItem(catalog: GameCatalogEntry, position = 1): AgentGamePlanItem {
  return {
    id: `item-${position}`,
    position,
    notes: null,
    catalogEntry: catalog,
  };
}

describe("Fase 3 — JackpotSetupModal render", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("rendrer 3 farge-input-felt når catalog har gul/hvit/lilla", () => {
    const catalog = makeCatalog(["gul", "hvit", "lilla"]);
    const item = makeItem(catalog);
    const { form } = buildJackpotSetupForm(item);
    document.body.appendChild(form);

    expect(form.querySelector('[data-testid="jackpot-prize-input-gul"]')).not.toBeNull();
    expect(form.querySelector('[data-testid="jackpot-prize-input-hvit"]')).not.toBeNull();
    expect(form.querySelector('[data-testid="jackpot-prize-input-lilla"]')).not.toBeNull();
    expect(form.querySelector('[data-testid="jackpot-draw-input"]')).not.toBeNull();
  });

  it("rendrer kun 2 farge-input-felt når catalog har gul/hvit (skjuler lilla)", () => {
    const catalog = makeCatalog(["gul", "hvit"]);
    const item = makeItem(catalog);
    const { form } = buildJackpotSetupForm(item);
    document.body.appendChild(form);

    expect(form.querySelector('[data-testid="jackpot-prize-input-gul"]')).not.toBeNull();
    expect(form.querySelector('[data-testid="jackpot-prize-input-hvit"]')).not.toBeNull();
    expect(form.querySelector('[data-testid="jackpot-prize-input-lilla"]')).toBeNull();
  });

  it("rendrer kun 1 farge-input-felt når catalog kun har gul", () => {
    const catalog = makeCatalog(["gul"]);
    const item = makeItem(catalog);
    const { form } = buildJackpotSetupForm(item);
    document.body.appendChild(form);

    expect(form.querySelector('[data-testid="jackpot-prize-input-gul"]')).not.toBeNull();
    expect(form.querySelector('[data-testid="jackpot-prize-input-hvit"]')).toBeNull();
    expect(form.querySelector('[data-testid="jackpot-prize-input-lilla"]')).toBeNull();
  });

  it("pre-fyller input-feltene med initial-verdier (øre → kr-konvertering)", () => {
    const catalog = makeCatalog(["gul", "hvit", "lilla"]);
    const item = makeItem(catalog, 3);
    const { form } = buildJackpotSetupForm(item, {
      draw: 50,
      prizesCents: {
        gul: 500000, // 5000 kr
        hvit: 600000, // 6000 kr
        lilla: 700000, // 7000 kr
      },
    });
    document.body.appendChild(form);

    const drawInput = form.querySelector<HTMLInputElement>(
      '[data-testid="jackpot-draw-input"]',
    );
    expect(drawInput?.value).toBe("50");

    const gulInput = form.querySelector<HTMLInputElement>(
      '[data-testid="jackpot-prize-input-gul"]',
    );
    expect(gulInput?.value).toBe("5000");

    const hvitInput = form.querySelector<HTMLInputElement>(
      '[data-testid="jackpot-prize-input-hvit"]',
    );
    expect(hvitInput?.value).toBe("6000");

    const lillaInput = form.querySelector<HTMLInputElement>(
      '[data-testid="jackpot-prize-input-lilla"]',
    );
    expect(lillaInput?.value).toBe("7000");
  });

  it("data-position-attribute matcher item.position", () => {
    const catalog = makeCatalog(["gul"]);
    const item = makeItem(catalog, 7);
    const { form } = buildJackpotSetupForm(item);
    document.body.appendChild(form);
    expect(form.dataset.position).toBe("7");
  });

  it("openJackpotSetupModal monterer modal med riktig tittel", () => {
    const catalog = makeCatalog(["gul"]);
    const item = makeItem(catalog);
    openJackpotSetupModal({ item });
    // Modal-en har klassen `.modal-title` med tekst "Jackpot-setup for ..."
    const title = document.querySelector(".modal-title");
    expect(title).not.toBeNull();
    expect(title?.textContent).toContain("Jackpot-setup for Spill 1");
    // Avbryt-knapp må eksistere
    const cancelBtn = document.querySelector('[data-action="cancel"]');
    expect(cancelBtn).not.toBeNull();
    // Bekreft-knapp må eksistere
    const confirmBtn = document.querySelector('[data-action="confirm"]');
    expect(confirmBtn).not.toBeNull();
  });
});

describe("Fase 3 — JackpotSetupModal submit", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    document.body.innerHTML = "";
  });

  it("Submit kaller API med kr → øre konvertering", async () => {
    let capturedBody: unknown = null;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/api/agent/game-plan/jackpot-setup")) {
        capturedBody = init?.body
          ? JSON.parse(String(init.body)) as unknown
          : null;
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              run: {
                id: "run-1",
                planId: "plan-1",
                hallId: "hall-1",
                businessDate: "2026-05-07",
                currentPosition: 1,
                status: "running",
                jackpotOverrides: {},
                startedAt: null,
                finishedAt: null,
                masterUserId: null,
                createdAt: "",
                updatedAt: "",
              },
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    const catalog = makeCatalog(["gul", "hvit"]);
    const item = makeItem(catalog, 2);

    let succeeded = false;
    openJackpotSetupModal({
      item,
      onSuccess: () => {
        succeeded = true;
      },
    });

    // Fyll inn felter
    const drawInput = document.querySelector<HTMLInputElement>(
      '[data-testid="jackpot-draw-input"]',
    );
    const gulInput = document.querySelector<HTMLInputElement>(
      '[data-testid="jackpot-prize-input-gul"]',
    );
    const hvitInput = document.querySelector<HTMLInputElement>(
      '[data-testid="jackpot-prize-input-hvit"]',
    );
    expect(drawInput).not.toBeNull();
    if (drawInput) drawInput.value = "55";
    if (gulInput) gulInput.value = "5000";
    if (hvitInput) hvitInput.value = "6500";

    // Klikk Bekreft
    const confirmBtn = document.querySelector<HTMLButtonElement>(
      '[data-action="confirm"]',
    );
    expect(confirmBtn).not.toBeNull();
    confirmBtn?.click();

    // Vent på async
    await new Promise((r) => setTimeout(r, 30));

    expect(capturedBody).not.toBeNull();
    expect(capturedBody).toEqual({
      position: 2,
      draw: 55,
      prizesCents: {
        gul: 500000, // 5000 kr → 500000 øre
        hvit: 650000, // 6500 kr → 650000 øre
      },
    });
    expect(succeeded).toBe(true);
  });

  it("Submit avvises hvis prize-felt er 0", async () => {
    let apiCalled = false;
    globalThis.fetch = (async () => {
      apiCalled = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    const catalog = makeCatalog(["gul"]);
    const item = makeItem(catalog);
    openJackpotSetupModal({ item });

    const drawInput = document.querySelector<HTMLInputElement>(
      '[data-testid="jackpot-draw-input"]',
    );
    const gulInput = document.querySelector<HTMLInputElement>(
      '[data-testid="jackpot-prize-input-gul"]',
    );
    if (drawInput) drawInput.value = "30";
    if (gulInput) gulInput.value = "0";

    const confirmBtn = document.querySelector<HTMLButtonElement>(
      '[data-action="confirm"]',
    );
    confirmBtn?.click();

    await new Promise((r) => setTimeout(r, 30));

    expect(apiCalled).toBe(false);
  });

  it("Submit avvises hvis draw er over 90", async () => {
    let apiCalled = false;
    globalThis.fetch = (async () => {
      apiCalled = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    const catalog = makeCatalog(["gul"]);
    const item = makeItem(catalog);
    openJackpotSetupModal({ item });

    const drawInput = document.querySelector<HTMLInputElement>(
      '[data-testid="jackpot-draw-input"]',
    );
    const gulInput = document.querySelector<HTMLInputElement>(
      '[data-testid="jackpot-prize-input-gul"]',
    );
    if (drawInput) drawInput.value = "100"; // over MAX_DRAW=90
    if (gulInput) gulInput.value = "5000";

    const confirmBtn = document.querySelector<HTMLButtonElement>(
      '[data-action="confirm"]',
    );
    confirmBtn?.click();

    await new Promise((r) => setTimeout(r, 30));

    expect(apiCalled).toBe(false);
  });
});
