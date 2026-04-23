// Hall add/edit form smoke-test: Hall Number-felt sendes korrekt til
// backend og tom-streng sendes som `null` (eksplisitt tømming på edit).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { initI18n } from "../src/i18n/I18n.js";
import { renderHallFormPage } from "../src/pages/hall/HallFormPage.js";
import type { AdminHall } from "../src/api/admin-halls.js";

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

const EXISTING_HALL: AdminHall = {
  id: "hall-1",
  slug: "oslo",
  name: "Oslo",
  region: "NO",
  address: "",
  isActive: true,
  clientVariant: "web",
  hallNumber: 101,
  cashBalance: 3000,
  createdAt: "2026-04-01T00:00:00Z",
  updatedAt: "2026-04-01T00:00:00Z",
};

describe("HallFormPage", () => {
  beforeEach(() => {
    initI18n();
    document.body.innerHTML = "";
    window.localStorage.setItem("bingo_admin_access_token", "tok");
  });

  it("add form renders Hall Number input separate from slug", async () => {
    mockApi();
    const root = document.createElement("div");
    document.body.appendChild(root);
    renderHallFormPage(root, null);
    for (let i = 0; i < 10 && !root.querySelector("form"); i++) {
      await tick(5);
    }
    const form = root.querySelector<HTMLFormElement>("form")!;
    const hallNumber = form.querySelector<HTMLInputElement>('[data-testid="hall-number-input"]');
    expect(hallNumber).toBeTruthy();
    expect(hallNumber!.type).toBe("number");
    expect(form.querySelector<HTMLInputElement>("#hf-slug")).toBeTruthy();
    // Should NOT be the same element
    expect(hallNumber!.id).not.toBe("hf-slug");
  });

  it("edit form pre-populates Hall Number field with existing value", async () => {
    const { queue } = mockApi();
    queue.push({ body: { ok: true, data: [EXISTING_HALL] } });

    const root = document.createElement("div");
    document.body.appendChild(root);
    renderHallFormPage(root, "hall-1");
    for (let i = 0; i < 20 && !root.querySelector('[data-testid="hall-number-input"]'); i++) {
      await tick(5);
    }

    const input = root.querySelector<HTMLInputElement>('[data-testid="hall-number-input"]')!;
    expect(input.value).toBe("101");
  });

  it("submits hallNumber as number to backend", async () => {
    const { queue, calls } = mockApi();
    // Initial list query (edit form leser listen for å finne existing)
    queue.push({ body: { ok: true, data: [EXISTING_HALL] } });
    // PUT response
    queue.push({ body: { ok: true, data: { ...EXISTING_HALL, hallNumber: 202 } } });

    const root = document.createElement("div");
    document.body.appendChild(root);
    renderHallFormPage(root, "hall-1");
    for (let i = 0; i < 20 && !root.querySelector('[data-testid="hall-number-input"]'); i++) {
      await tick(5);
    }

    const input = root.querySelector<HTMLInputElement>('[data-testid="hall-number-input"]')!;
    input.value = "202";

    const form = root.querySelector<HTMLFormElement>("form")!;
    form.dispatchEvent(new Event("submit", { cancelable: true }));

    for (let i = 0; i < 20 && !calls.some((c) => c.init.method === "PUT"); i++) {
      await tick(5);
    }
    const putCall = calls.find((c) => c.init.method === "PUT");
    expect(putCall).toBeTruthy();
    const body = JSON.parse(String(putCall!.init.body));
    expect(body.hallNumber).toBe(202);
  });

  it("rejects non-positive / non-integer Hall Number client-side", async () => {
    const { queue, calls } = mockApi();
    queue.push({ body: { ok: true, data: [EXISTING_HALL] } });

    const root = document.createElement("div");
    document.body.appendChild(root);
    renderHallFormPage(root, "hall-1");
    for (let i = 0; i < 20 && !root.querySelector('[data-testid="hall-number-input"]'); i++) {
      await tick(5);
    }
    const input = root.querySelector<HTMLInputElement>('[data-testid="hall-number-input"]')!;
    const form = root.querySelector<HTMLFormElement>("form")!;

    // Zero
    input.value = "0";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await tick(10);
    expect(calls.some((c) => c.init.method === "PUT")).toBe(false);

    // Negative
    input.value = "-1";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await tick(10);
    expect(calls.some((c) => c.init.method === "PUT")).toBe(false);

    // Float
    input.value = "1.5";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await tick(10);
    expect(calls.some((c) => c.init.method === "PUT")).toBe(false);
  });

  it("empty Hall Number on edit sends null (explicit clear)", async () => {
    const { queue, calls } = mockApi();
    queue.push({ body: { ok: true, data: [EXISTING_HALL] } });
    queue.push({ body: { ok: true, data: { ...EXISTING_HALL, hallNumber: null } } });

    const root = document.createElement("div");
    document.body.appendChild(root);
    renderHallFormPage(root, "hall-1");
    for (let i = 0; i < 20 && !root.querySelector('[data-testid="hall-number-input"]'); i++) {
      await tick(5);
    }
    const input = root.querySelector<HTMLInputElement>('[data-testid="hall-number-input"]')!;
    input.value = "";
    const form = root.querySelector<HTMLFormElement>("form")!;
    form.dispatchEvent(new Event("submit", { cancelable: true }));

    for (let i = 0; i < 20 && !calls.some((c) => c.init.method === "PUT"); i++) {
      await tick(5);
    }
    const putCall = calls.find((c) => c.init.method === "PUT");
    expect(putCall).toBeTruthy();
    const body = JSON.parse(String(putCall!.init.body));
    expect(body.hallNumber).toBeNull();
  });
});
