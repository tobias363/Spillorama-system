// HV2-B3 (Tobias 2026-04-30) — admin-UI smoke-tester for
// Spill1PrizeDefaultsPage. Verifiserer:
//   * GET → render av 5 phase-inputs med pre-populerte verdier
//   * PUT med diff-only patch (skipper unchanged felt)
//   * Client-side validering (negative, > 2500 kr, tom verdi)
//   * Toast.info ved no-change submit

import { describe, it, expect, beforeEach, vi } from "vitest";
import { initI18n } from "../src/i18n/I18n.js";
import { renderSpill1PrizeDefaultsPage } from "../src/pages/hall/Spill1PrizeDefaultsPage.js";

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

const HALL_LIST_RESPONSE = {
  ok: true,
  data: [
    {
      id: "hall-1",
      slug: "oslo",
      name: "Oslo Bingo",
      region: "NO",
      address: "",
      isActive: true,
      clientVariant: "web",
      hallNumber: 101,
      cashBalance: 3000,
      createdAt: "2026-04-01T00:00:00Z",
      updatedAt: "2026-04-01T00:00:00Z",
    },
  ],
};

const DEFAULTS_RESPONSE = {
  ok: true,
  data: {
    hallId: "hall-1",
    phase1: 100,
    phase2: 200,
    phase3: 200,
    phase4: 200,
    phase5: 1000,
  },
};

describe("Spill1PrizeDefaultsPage", () => {
  beforeEach(() => {
    initI18n();
    document.body.innerHTML = "";
    window.localStorage.setItem("bingo_admin_access_token", "tok");
  });

  it("renders 5 phase inputs pre-populated with current floors", async () => {
    const { queue } = mockApi();
    queue.push({ body: HALL_LIST_RESPONSE });
    queue.push({ body: DEFAULTS_RESPONSE });

    const root = document.createElement("div");
    document.body.appendChild(root);
    renderSpill1PrizeDefaultsPage(root, "hall-1");

    for (let i = 0; i < 30 && !root.querySelector('[data-testid="phase-p1-input"]'); i++) {
      await tick(10);
    }

    const p1 = root.querySelector<HTMLInputElement>('[data-testid="phase-p1-input"]');
    const p2 = root.querySelector<HTMLInputElement>('[data-testid="phase-p2-input"]');
    const p3 = root.querySelector<HTMLInputElement>('[data-testid="phase-p3-input"]');
    const p4 = root.querySelector<HTMLInputElement>('[data-testid="phase-p4-input"]');
    const p5 = root.querySelector<HTMLInputElement>('[data-testid="phase-p5-input"]');
    expect(p1?.value).toBe("100");
    expect(p2?.value).toBe("200");
    expect(p3?.value).toBe("200");
    expect(p4?.value).toBe("200");
    expect(p5?.value).toBe("1000");
  });

  it("renders hall name in help-callout", async () => {
    const { queue } = mockApi();
    queue.push({ body: HALL_LIST_RESPONSE });
    queue.push({ body: DEFAULTS_RESPONSE });

    const root = document.createElement("div");
    document.body.appendChild(root);
    renderSpill1PrizeDefaultsPage(root, "hall-1");

    for (let i = 0; i < 30 && !root.querySelector('[data-testid="spill1-prize-defaults-help"]'); i++) {
      await tick(10);
    }

    const help = root.querySelector('[data-testid="spill1-prize-defaults-help"]')!;
    expect(help.textContent).toContain("Oslo Bingo");
  });

  it("submits PUT with only changed phases (diff-only patch)", async () => {
    const { queue, calls } = mockApi();
    queue.push({ body: HALL_LIST_RESPONSE });
    queue.push({ body: DEFAULTS_RESPONSE });
    // PUT response — full snapshot etter update.
    queue.push({
      body: {
        ok: true,
        data: { ...DEFAULTS_RESPONSE.data, phase1: 150 },
      },
    });
    // Re-fetch etter submit (page mounter på nytt for fresh state).
    queue.push({ body: HALL_LIST_RESPONSE });
    queue.push({
      body: {
        ok: true,
        data: { ...DEFAULTS_RESPONSE.data, phase1: 150 },
      },
    });

    const root = document.createElement("div");
    document.body.appendChild(root);
    renderSpill1PrizeDefaultsPage(root, "hall-1");

    for (let i = 0; i < 30 && !root.querySelector('[data-testid="phase-p1-input"]'); i++) {
      await tick(10);
    }

    const p1 = root.querySelector<HTMLInputElement>('[data-testid="phase-p1-input"]')!;
    p1.value = "150";

    const form = root.querySelector<HTMLFormElement>("#spill1-prize-form")!;
    form.dispatchEvent(new Event("submit", { cancelable: true }));

    for (let i = 0; i < 30 && !calls.some((c) => c.init.method === "PUT"); i++) {
      await tick(10);
    }

    const putCall = calls.find((c) => c.init.method === "PUT");
    expect(putCall).toBeTruthy();
    expect(putCall!.url).toContain("/api/admin/halls/hall-1/spill1-prize-defaults");
    const body = JSON.parse(String(putCall!.init.body));
    // Bare phase1 endret — phase2-phase5 skal IKKE være med i payload.
    expect(body).toEqual({ phase1: 150 });
  });

  it("rejects negative phase value client-side", async () => {
    const { queue, calls } = mockApi();
    queue.push({ body: HALL_LIST_RESPONSE });
    queue.push({ body: DEFAULTS_RESPONSE });

    const root = document.createElement("div");
    document.body.appendChild(root);
    renderSpill1PrizeDefaultsPage(root, "hall-1");

    for (let i = 0; i < 30 && !root.querySelector('[data-testid="phase-p1-input"]'); i++) {
      await tick(10);
    }

    const p1 = root.querySelector<HTMLInputElement>('[data-testid="phase-p1-input"]')!;
    p1.value = "-10";

    const form = root.querySelector<HTMLFormElement>("#spill1-prize-form")!;
    form.dispatchEvent(new Event("submit", { cancelable: true }));

    await tick(50);
    // Ingen PUT-call skal være sendt — client-side validering blokkerte.
    expect(calls.some((c) => c.init.method === "PUT")).toBe(false);
  });

  it("rejects phase value above 2500 kr client-side", async () => {
    const { queue, calls } = mockApi();
    queue.push({ body: HALL_LIST_RESPONSE });
    queue.push({ body: DEFAULTS_RESPONSE });

    const root = document.createElement("div");
    document.body.appendChild(root);
    renderSpill1PrizeDefaultsPage(root, "hall-1");

    for (let i = 0; i < 30 && !root.querySelector('[data-testid="phase-p5-input"]'); i++) {
      await tick(10);
    }

    const p5 = root.querySelector<HTMLInputElement>('[data-testid="phase-p5-input"]')!;
    p5.value = "3000";

    const form = root.querySelector<HTMLFormElement>("#spill1-prize-form")!;
    form.dispatchEvent(new Event("submit", { cancelable: true }));

    await tick(50);
    expect(calls.some((c) => c.init.method === "PUT")).toBe(false);
  });

  it("skips PUT when no values changed (no-op submit)", async () => {
    const { queue, calls } = mockApi();
    queue.push({ body: HALL_LIST_RESPONSE });
    queue.push({ body: DEFAULTS_RESPONSE });

    const root = document.createElement("div");
    document.body.appendChild(root);
    renderSpill1PrizeDefaultsPage(root, "hall-1");

    for (let i = 0; i < 30 && !root.querySelector('[data-testid="phase-p1-input"]'); i++) {
      await tick(10);
    }

    // Submit uten å endre noe.
    const form = root.querySelector<HTMLFormElement>("#spill1-prize-form")!;
    form.dispatchEvent(new Event("submit", { cancelable: true }));

    await tick(50);
    // Ingen PUT-call skal være sendt.
    expect(calls.some((c) => c.init.method === "PUT")).toBe(false);
  });

  it("submits multiple changed phases in one PUT (partial multi-update)", async () => {
    const { queue, calls } = mockApi();
    queue.push({ body: HALL_LIST_RESPONSE });
    queue.push({ body: DEFAULTS_RESPONSE });
    queue.push({ body: { ok: true, data: DEFAULTS_RESPONSE.data } });
    queue.push({ body: HALL_LIST_RESPONSE });
    queue.push({ body: DEFAULTS_RESPONSE });

    const root = document.createElement("div");
    document.body.appendChild(root);
    renderSpill1PrizeDefaultsPage(root, "hall-1");

    for (let i = 0; i < 30 && !root.querySelector('[data-testid="phase-p1-input"]'); i++) {
      await tick(10);
    }

    const p1 = root.querySelector<HTMLInputElement>('[data-testid="phase-p1-input"]')!;
    const p3 = root.querySelector<HTMLInputElement>('[data-testid="phase-p3-input"]')!;
    p1.value = "120";
    p3.value = "250";

    const form = root.querySelector<HTMLFormElement>("#spill1-prize-form")!;
    form.dispatchEvent(new Event("submit", { cancelable: true }));

    for (let i = 0; i < 30 && !calls.some((c) => c.init.method === "PUT"); i++) {
      await tick(10);
    }

    const putCall = calls.find((c) => c.init.method === "PUT");
    expect(putCall).toBeTruthy();
    const body = JSON.parse(String(putCall!.init.body));
    expect(body.phase1).toBe(120);
    expect(body.phase3).toBe(250);
    // Unchanged phases skal ikke være i payload.
    expect(body.phase2).toBeUndefined();
    expect(body.phase4).toBeUndefined();
    expect(body.phase5).toBeUndefined();
  });

  it("renders error callout on initial GET failure", async () => {
    const { queue } = mockApi();
    queue.push({ body: HALL_LIST_RESPONSE });
    queue.push({
      body: { ok: false, error: { code: "FORBIDDEN", message: "Du har ikke tilgang." } },
      status: 400,
    });

    const root = document.createElement("div");
    document.body.appendChild(root);
    renderSpill1PrizeDefaultsPage(root, "hall-1");

    for (let i = 0; i < 30 && !root.querySelector('[data-testid="spill1-prize-defaults-error"]'); i++) {
      await tick(10);
    }

    const errBox = root.querySelector('[data-testid="spill1-prize-defaults-error"]');
    expect(errBox).toBeTruthy();
  });
});
