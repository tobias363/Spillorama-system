/**
 * Fase 2 (2026-05-07): tester for GamePlan admin-UI.
 *
 * Dekker:
 *   - List-side rendrer rader
 *   - Editor: render meta-form med default values
 *   - Drag-and-drop reorder muterer state
 *   - Save-items kaller PUT /items med riktig payload
 *   - Hall vs Group XOR-validering
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initI18n } from "../src/i18n/I18n.js";
import {
  renderGamePlanNewPage,
  renderGamePlanEditPage,
} from "../src/pages/games/plans/GamePlanEditorPage.js";
import {
  defaultPlanPayload,
  payloadToCreateInput,
} from "../src/pages/games/plans/GamePlanState.js";

interface FetchCall {
  url: string;
  method: string;
  body?: string;
}

function mockFetchSequence(
  responses: Array<{ data?: unknown; status?: number; ok?: boolean }>,
): { fn: ReturnType<typeof vi.fn>; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  let i = 0;
  const fn = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
    const cur = responses[i] ?? { data: null };
    i += 1;
    calls.push({
      url,
      method: init.method ?? "GET",
      body: typeof init.body === "string" ? init.body : undefined,
    });
    const status = cur.status ?? 200;
    const okFlag = cur.ok ?? status < 400;
    return new Response(JSON.stringify({ ok: okFlag, data: cur.data ?? null }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  });
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return { fn, calls };
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
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

// ── State helpers ───────────────────────────────────────────────────────

describe("GamePlanState", () => {
  it("default payload gir Mon-Fri 11:00-21:00 + hall-binding", () => {
    const p = defaultPlanPayload();
    expect(p.weekdays).toEqual(["mon", "tue", "wed", "thu", "fri"]);
    expect(p.startTime).toBe("11:00");
    expect(p.endTime).toBe("21:00");
    expect(p.bindingKind).toBe("hall");
    expect(p.isActive).toBe(true);
  });

  it("payloadToCreateInput nuller motsatte bindings", () => {
    const p = defaultPlanPayload();
    p.hallId = "hall-a";
    p.groupOfHallsId = "group-x"; // skal nulles
    const input = payloadToCreateInput(p);
    expect(input.hallId).toBe("hall-a");
    expect(input.groupOfHallsId).toBeNull();
  });
});

// ── Editor: new ─────────────────────────────────────────────────────────

describe("GamePlanEditorPage — new", () => {
  it("rendrer meta-form og hall/group-radio-toggle", async () => {
    // Halls + groups + catalog (alle returnerer tomme arrays/objs)
    mockFetchSequence([
      { data: { entries: [], count: 0 } }, // catalog
      { data: [] }, // halls
      { data: { groups: [], count: 0 } }, // hall-groups
    ]);
    const container = document.createElement("div");
    document.body.appendChild(container);
    await renderGamePlanNewPage(container);
    await flushMicrotasks();

    expect(container.querySelector("#plan-name")).toBeTruthy();
    expect(container.querySelector("#plan-startTime")).toBeTruthy();
    expect(container.querySelector("#plan-endTime")).toBeTruthy();
    const radios = container.querySelectorAll('input[name="binding"]');
    expect(radios.length).toBe(2);
    // Sequence-builder skal IKKE rendres for new-mode (er gated på edit)
    expect(container.querySelector("#sequence-list")).toBeNull();
    expect(container.querySelector(".alert-info")).toBeTruthy();
  });

  it("submit POST-er meta-payload uten items", async () => {
    const { calls } = mockFetchSequence([
      { data: { entries: [], count: 0 } }, // catalog (preload)
      { data: [] }, // halls
      { data: { groups: [], count: 0 } }, // hall-groups
      // POST /api/admin/game-plans
      {
        data: {
          id: "plan-1",
          name: "Hverdager",
          description: null,
          hallId: "hall-a",
          groupOfHallsId: null,
          weekdays: ["mon", "tue", "wed", "thu", "fri"],
          startTime: "11:00",
          endTime: "21:00",
          isActive: true,
          createdAt: "",
          updatedAt: "",
          createdByUserId: null,
          items: [],
        },
      },
    ]);
    const container = document.createElement("div");
    document.body.appendChild(container);
    await renderGamePlanNewPage(container);
    await flushMicrotasks();

    // Fyll inn name og hall-id
    (container.querySelector<HTMLInputElement>("#plan-name")!).value = "Hverdager";
    // Inject hall-option dynamisk siden listen var tom
    const hallSelect = container.querySelector<HTMLSelectElement>("#plan-hallId")!;
    const opt = document.createElement("option");
    opt.value = "hall-a";
    opt.textContent = "Hall A";
    hallSelect.appendChild(opt);
    hallSelect.value = "hall-a";

    const form = container.querySelector<HTMLFormElement>("#plan-meta-form")!;
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await flushMicrotasks();

    const post = calls.find((c) => c.method === "POST");
    expect(post).toBeTruthy();
    expect(post?.url).toBe("/api/admin/game-plans");
    const body = JSON.parse(post!.body!);
    expect(body.name).toBe("Hverdager");
    expect(body.hallId).toBe("hall-a");
    expect(body.groupOfHallsId).toBeNull();
    expect(body.weekdays).toEqual(["mon", "tue", "wed", "thu", "fri"]);
  });
});

// ── Editor: edit + sequence builder ─────────────────────────────────────

describe("GamePlanEditorPage — edit", () => {
  function setupEditMocks(): { calls: FetchCall[] } {
    return mockFetchSequence([
      // GET plan
      {
        data: {
          id: "plan-1",
          name: "Plan A",
          description: null,
          hallId: "hall-a",
          groupOfHallsId: null,
          weekdays: ["mon"],
          startTime: "11:00",
          endTime: "21:00",
          isActive: true,
          createdAt: "",
          updatedAt: "",
          createdByUserId: null,
          items: [
            {
              id: "item-1",
              planId: "plan-1",
              position: 1,
              gameCatalogId: "cat-jackpot",
              bonusGameOverride: null,
              notes: null,
              createdAt: "",
              catalogEntry: {
                id: "cat-jackpot",
                slug: "jackpot",
                displayName: "Jackpot",
                description: null,
                rules: {},
                ticketColors: ["gul"],
                ticketPricesCents: { gul: 1000 },
                prizesCents: {
                  rad1: 10000,
                  rad2: 10000,
                  rad3: 10000,
                  rad4: 10000,
                  bingo: { gul: 200000 },
                },
                bonusGameSlug: null,
                bonusGameEnabled: false,
                requiresJackpotSetup: false,
                isActive: true,
                sortOrder: 0,
                createdAt: "",
                updatedAt: "",
                createdByUserId: null,
              },
            },
            {
              id: "item-2",
              planId: "plan-1",
              position: 2,
              gameCatalogId: "cat-innsatsen",
              bonusGameOverride: "wheel_of_fortune",
              notes: null,
              createdAt: "",
              catalogEntry: {
                id: "cat-innsatsen",
                slug: "innsatsen",
                displayName: "Innsatsen",
                description: null,
                rules: {},
                ticketColors: ["gul"],
                ticketPricesCents: { gul: 1000 },
                prizesCents: {
                  rad1: 10000,
                  rad2: 10000,
                  rad3: 10000,
                  rad4: 10000,
                  bingo: { gul: 200000 },
                },
                bonusGameSlug: null,
                bonusGameEnabled: false,
                requiresJackpotSetup: false,
                isActive: true,
                sortOrder: 0,
                createdAt: "",
                updatedAt: "",
                createdByUserId: null,
              },
            },
          ],
        },
      },
      // GET catalog
      {
        data: {
          entries: [
            {
              id: "cat-jackpot",
              slug: "jackpot",
              displayName: "Jackpot",
              description: null,
              rules: {},
              ticketColors: ["gul"],
              ticketPricesCents: { gul: 1000 },
              prizesCents: {
                rad1: 10000,
                rad2: 10000,
                rad3: 10000,
                rad4: 10000,
                bingo: { gul: 200000 },
              },
              bonusGameSlug: null,
              bonusGameEnabled: false,
              requiresJackpotSetup: false,
              isActive: true,
              sortOrder: 0,
              createdAt: "",
              updatedAt: "",
              createdByUserId: null,
            },
            {
              id: "cat-innsatsen",
              slug: "innsatsen",
              displayName: "Innsatsen",
              description: null,
              rules: {},
              ticketColors: ["gul"],
              ticketPricesCents: { gul: 1000 },
              prizesCents: {
                rad1: 10000,
                rad2: 10000,
                rad3: 10000,
                rad4: 10000,
                bingo: { gul: 200000 },
              },
              bonusGameSlug: null,
              bonusGameEnabled: false,
              requiresJackpotSetup: false,
              isActive: true,
              sortOrder: 0,
              createdAt: "",
              updatedAt: "",
              createdByUserId: null,
            },
          ],
          count: 2,
        },
      },
      { data: [] }, // halls
      { data: { groups: [], count: 0 } }, // hall-groups
      // PUT items
      {
        data: {
          id: "plan-1",
          name: "Plan A",
          description: null,
          hallId: "hall-a",
          groupOfHallsId: null,
          weekdays: ["mon"],
          startTime: "11:00",
          endTime: "21:00",
          isActive: true,
          createdAt: "",
          updatedAt: "",
          createdByUserId: null,
          items: [],
        },
      },
    ]);
  }

  it("rendrer plan + sekvens-builder for edit-mode", async () => {
    setupEditMocks();
    const container = document.createElement("div");
    document.body.appendChild(container);
    await renderGamePlanEditPage(container, "plan-1");
    await flushMicrotasks();

    expect((container.querySelector<HTMLInputElement>("#plan-name")!).value).toBe(
      "Plan A",
    );
    // Sequence-list er rendret med 2 items
    const seqItems = container.querySelectorAll<HTMLElement>(
      "#sequence-list .seq-item",
    );
    expect(seqItems.length).toBe(2);
    // Catalog-list har 2 entries
    const catalogItems = container.querySelectorAll<HTMLElement>(
      "#catalog-list .catalog-item",
    );
    expect(catalogItems.length).toBe(2);
  });

  it("Save-rekkefølge sender PUT /items med catalog-IDs + bonus-overrides", async () => {
    const { calls } = setupEditMocks();
    const container = document.createElement("div");
    document.body.appendChild(container);
    await renderGamePlanEditPage(container, "plan-1");
    await flushMicrotasks();

    const saveBtn = container.querySelector<HTMLButtonElement>(
      'button[data-action="save-sequence"]',
    );
    saveBtn!.click();
    await flushMicrotasks();

    const putItems = calls.find((c) =>
      c.url.endsWith("/api/admin/game-plans/plan-1/items"),
    );
    expect(putItems).toBeTruthy();
    expect(putItems?.method).toBe("PUT");
    const body = JSON.parse(putItems!.body!);
    // Tolkning A (2026-05-07): payload inkluderer bonusGameOverride per item.
    // item-1 hadde null, item-2 hadde "wheel_of_fortune" i seed-data.
    expect(body.items).toEqual([
      {
        gameCatalogId: "cat-jackpot",
        bonusGameOverride: null,
        notes: null,
      },
      {
        gameCatalogId: "cat-innsatsen",
        bonusGameOverride: "wheel_of_fortune",
        notes: null,
      },
    ]);
  });

  it("'Legg til'-knapp i katalog-listen apender til sekvensen", async () => {
    setupEditMocks();
    const container = document.createElement("div");
    document.body.appendChild(container);
    await renderGamePlanEditPage(container, "plan-1");
    await flushMicrotasks();

    // Klikk "Legg til"-knapp på første katalog-entry
    const addBtn = container.querySelector<HTMLButtonElement>(
      '#catalog-list button[data-action="add-to-sequence"]',
    );
    expect(addBtn).toBeTruthy();
    addBtn!.click();
    // Re-render skjer synkront i renderSequence — sjekk at det er 3 items nå
    const seqItemsAfter = container.querySelectorAll<HTMLElement>(
      "#sequence-list .seq-item",
    );
    expect(seqItemsAfter.length).toBe(3);
  });

  it("Fjern-knapp på et item fjerner det fra sekvensen", async () => {
    setupEditMocks();
    const container = document.createElement("div");
    document.body.appendChild(container);
    await renderGamePlanEditPage(container, "plan-1");
    await flushMicrotasks();

    const removeBtn = container.querySelector<HTMLButtonElement>(
      'button[data-action="remove-from-sequence"]',
    );
    expect(removeBtn).toBeTruthy();
    removeBtn!.click();
    const seqItemsAfter = container.querySelectorAll<HTMLElement>(
      "#sequence-list .seq-item",
    );
    expect(seqItemsAfter.length).toBe(1);
  });

  // ── Tolkning A (2026-05-07): per-item bonus-override ──────────────────

  it("Tolkning A: bonus-dropdown viser 5 alternativer (Ingen + 4 bonus)", async () => {
    setupEditMocks();
    const container = document.createElement("div");
    document.body.appendChild(container);
    await renderGamePlanEditPage(container, "plan-1");
    await flushMicrotasks();

    const dropdowns = container.querySelectorAll<HTMLSelectElement>(
      "#sequence-list .seq-bonus-select",
    );
    expect(dropdowns.length).toBe(2);
    const firstDd = dropdowns[0]!;
    const opts = firstDd.querySelectorAll("option");
    expect(opts.length).toBe(5);
    const values = Array.from(opts).map((o) => o.value);
    expect(values).toEqual([
      "",
      "mystery",
      "wheel_of_fortune",
      "treasure_chest",
      "color_draft",
    ]);
    expect(firstDd.value).toBe("");
    expect(dropdowns[1]!.value).toBe("wheel_of_fortune");
  });

  it("Tolkning A: endring i bonus-dropdown reflekteres i save-payload", async () => {
    const { calls } = setupEditMocks();
    const container = document.createElement("div");
    document.body.appendChild(container);
    await renderGamePlanEditPage(container, "plan-1");
    await flushMicrotasks();

    const dropdowns = container.querySelectorAll<HTMLSelectElement>(
      "#sequence-list .seq-bonus-select",
    );
    const firstDd = dropdowns[0]!;
    firstDd.value = "color_draft";
    firstDd.dispatchEvent(new Event("change"));

    const saveBtn = container.querySelector<HTMLButtonElement>(
      'button[data-action="save-sequence"]',
    );
    saveBtn!.click();
    await flushMicrotasks();

    const putItems = calls.find((c) =>
      c.url.endsWith("/api/admin/game-plans/plan-1/items"),
    );
    expect(putItems).toBeTruthy();
    const body = JSON.parse(putItems!.body!);
    expect(body.items[0].bonusGameOverride).toBe("color_draft");
    expect(body.items[1].bonusGameOverride).toBe("wheel_of_fortune");
  });
});
