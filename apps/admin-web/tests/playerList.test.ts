// PR-B2: Player list + pending/rejected list smoke tests.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { initI18n } from "../src/i18n/I18n.js";
import { renderPlayerListPage } from "../src/pages/players/PlayerListPage.js";
import { renderPendingListPage } from "../src/pages/pending/PendingListPage.js";
import { renderRejectedListPage } from "../src/pages/rejected/RejectedListPage.js";

function mockApi(response: unknown, status = 200): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ ok: status < 400, data: response }), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  );
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return fn;
}

async function tick(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise<void>((r) => setTimeout(r, 0));
}

describe("PlayerListPage", () => {
  beforeEach(() => {
    initI18n();
    document.body.innerHTML = "";
    window.localStorage.setItem("bingo_admin_access_token", "tok");
  });

  it("requires search query of 2+ chars before fetching", async () => {
    const api = mockApi({ players: [], count: 0 });
    const root = document.createElement("div");
    document.body.appendChild(root);
    renderPlayerListPage(root);
    const form = root.querySelector<HTMLFormElement>("#player-search-form")!;
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await tick();
    expect(api).not.toHaveBeenCalled();
  });

  it("calls /search when user submits query", async () => {
    const api = mockApi({
      players: [
        {
          id: "u-1",
          email: "a@b.no",
          displayName: "Kari",
          surname: null,
          phone: null,
          kycStatus: "VERIFIED",
          birthDate: null,
          kycVerifiedAt: null,
          kycProviderRef: null,
          hallId: null,
          createdAt: "2026-04-01T00:00:00Z",
          updatedAt: "2026-04-01T00:00:00Z",
          complianceData: null,
        },
      ],
      count: 1,
    });
    const root = document.createElement("div");
    document.body.appendChild(root);
    renderPlayerListPage(root);
    const input = root.querySelector<HTMLInputElement>("#player-query")!;
    input.value = "kari";
    const form = root.querySelector<HTMLFormElement>("#player-search-form")!;
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await tick();
    expect(api).toHaveBeenCalledTimes(1);
    expect(api.mock.calls[0]![0]).toContain("/api/admin/players/search?query=kari");
    expect(root.querySelector("table")).toBeTruthy();
    expect(root.textContent).toContain("Kari");
  });
});

describe("PendingListPage", () => {
  beforeEach(() => {
    initI18n();
    document.body.innerHTML = "";
    window.localStorage.setItem("bingo_admin_access_token", "tok");
  });

  it("fetches /pending on mount", async () => {
    const api = mockApi({ players: [], count: 0 });
    const root = document.createElement("div");
    document.body.appendChild(root);
    renderPendingListPage(root);
    await tick();
    expect(api).toHaveBeenCalledTimes(1);
    expect(api.mock.calls[0]![0]).toContain("/api/admin/players/pending");
  });
});

describe("RejectedListPage", () => {
  beforeEach(() => {
    initI18n();
    document.body.innerHTML = "";
    window.localStorage.setItem("bingo_admin_access_token", "tok");
  });

  it("fetches /rejected on mount", async () => {
    const api = mockApi({ players: [], count: 0 });
    const root = document.createElement("div");
    document.body.appendChild(root);
    renderRejectedListPage(root);
    await tick();
    expect(api).toHaveBeenCalledTimes(1);
    expect(api.mock.calls[0]![0]).toContain("/api/admin/players/rejected");
  });
});
