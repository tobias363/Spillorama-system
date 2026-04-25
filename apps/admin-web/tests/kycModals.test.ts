// PR-B2: Integration tests for KYC-moderation modals.
// Covers ApprovePlayerModal, RejectPlayerModal (2-step validation),
// ResubmitPlayerModal, and BankIdReverifyModal.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initI18n } from "../src/i18n/I18n.js";
import { openApprovePlayerModal } from "../src/pages/players/modals/ApprovePlayerModal.js";
import { openRejectPlayerModal } from "../src/pages/players/modals/RejectPlayerModal.js";
import { openResubmitPlayerModal } from "../src/pages/players/modals/ResubmitPlayerModal.js";
import { openBankIdReverifyModal } from "../src/pages/players/modals/BankIdReverifyModal.js";
import type { PlayerSummary } from "../src/api/admin-players.js";

const PLAYER: Pick<PlayerSummary, "id" | "email" | "displayName"> = {
  id: "user-1",
  email: "test@example.com",
  displayName: "Kari Nordmann",
};

function mockFetch(response: unknown, status = 200): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ ok: status < 400, data: response }), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  );
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return fn;
}

async function nextMicrotasks(): Promise<void> {
  // Allow promise chains inside onClick handlers to resolve before asserting.
  for (let i = 0; i < 5; i++) {
    await new Promise<void>((r) => setTimeout(r, 0));
  }
}

describe("KYC moderation modals", () => {
  beforeEach(() => {
    initI18n();
    document.body.innerHTML = "";
    document.body.className = "";
    window.localStorage.clear();
    window.localStorage.setItem("bingo_admin_access_token", "tok");
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  describe("ApprovePlayerModal", () => {
    it("renders with static backdrop and hidden close-X (forced-confirm)", () => {
      openApprovePlayerModal({ player: PLAYER });
      const modal = document.querySelector<HTMLElement>(".modal");
      expect(modal).toBeTruthy();
      expect(modal?.getAttribute("data-backdrop")).toBe("static");
      expect(modal?.getAttribute("data-keyboard")).toBe("false");
      const closeX = document.querySelector<HTMLElement>(".modal-header .close");
      expect(closeX?.style.display).toBe("none");
    });

    it("ESC is ignored (forced-confirm)", () => {
      const onApproved = vi.fn();
      openApprovePlayerModal({ player: PLAYER, onApproved });
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      expect(document.querySelector(".modal")).toBeTruthy();
      expect(onApproved).not.toHaveBeenCalled();
    });

    it("POSTs to /approve and fires onApproved on success", async () => {
      const fetchMock = mockFetch({ id: "user-1", kycStatus: "VERIFIED" });
      const onApproved = vi.fn();
      openApprovePlayerModal({ player: PLAYER, onApproved });
      const confirmBtn = document.querySelector<HTMLButtonElement>('button[data-action="confirm"]')!;
      confirmBtn.click();
      await nextMicrotasks();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/admin/players/user-1/approve");
      expect(init.method).toBe("POST");
      expect(onApproved).toHaveBeenCalled();
    });
  });

  describe("RejectPlayerModal", () => {
    it("requires reason before POST", async () => {
      const fetchMock = mockFetch({});
      openRejectPlayerModal({ player: PLAYER });
      const confirmBtn = document.querySelector<HTMLButtonElement>('button[data-action="confirm"]')!;
      confirmBtn.click();
      await nextMicrotasks();
      // No network call fired because reason empty
      expect(fetchMock).not.toHaveBeenCalled();
      // Error visible
      const errEl = document.querySelector<HTMLElement>("#reject-error");
      expect(errEl?.style.display).toBe("block");
      // Modal still open
      expect(document.querySelector(".modal")).toBeTruthy();
    });

    it("BIN-702: avviser reason under 10 tegn, viser min-lengde-feil", async () => {
      const fetchMock = mockFetch({});
      openRejectPlayerModal({ player: PLAYER });
      const textarea = document.querySelector<HTMLTextAreaElement>("#reject-reason")!;
      textarea.value = "kort"; // 4 tegn
      const confirmBtn = document.querySelector<HTMLButtonElement>('button[data-action="confirm"]')!;
      confirmBtn.click();
      await nextMicrotasks();
      expect(fetchMock).not.toHaveBeenCalled();
      const errEl = document.querySelector<HTMLElement>("#reject-error");
      expect(errEl?.style.display).toBe("block");
      // Feilmelding nevner antall tegn
      expect(errEl?.textContent).toMatch(/10/);
      expect(document.querySelector(".modal")).toBeTruthy();
    });

    it("BIN-702: live counter oppdateres ved input", () => {
      openRejectPlayerModal({ player: PLAYER });
      const textarea = document.querySelector<HTMLTextAreaElement>("#reject-reason")!;
      const counter = document.querySelector<HTMLElement>("#reject-counter")!;
      expect(counter.textContent).toBe("0");
      textarea.value = "Under 10";
      textarea.dispatchEvent(new Event("input"));
      expect(counter.textContent).toBe("8");
      textarea.value = "Ti eller mer tegn her";
      textarea.dispatchEvent(new Event("input"));
      expect(counter.textContent).toBe("21");
    });

    it("POSTs /reject with reason and closes on success", async () => {
      const fetchMock = mockFetch({ id: "user-1", kycStatus: "REJECTED" });
      const onRejected = vi.fn();
      openRejectPlayerModal({ player: PLAYER, onRejected });
      const textarea = document.querySelector<HTMLTextAreaElement>("#reject-reason")!;
      textarea.value = "Insufficient documentation";
      const confirmBtn = document.querySelector<HTMLButtonElement>('button[data-action="confirm"]')!;
      confirmBtn.click();
      await nextMicrotasks();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/admin/players/user-1/reject");
      expect(init.method).toBe("POST");
      const body = JSON.parse(init.body as string);
      expect(body.reason).toBe("Insufficient documentation");
      expect(onRejected).toHaveBeenCalled();
    });
  });

  describe("ResubmitPlayerModal", () => {
    it("POSTs /resubmit on confirm", async () => {
      const fetchMock = mockFetch({ id: "user-1", kycStatus: "UNVERIFIED" });
      const onResubmitted = vi.fn();
      openResubmitPlayerModal({ player: PLAYER, onResubmitted });
      const confirmBtn = document.querySelector<HTMLButtonElement>('button[data-action="confirm"]')!;
      confirmBtn.click();
      await nextMicrotasks();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/admin/players/user-1/resubmit");
      expect(init.method).toBe("POST");
      expect(onResubmitted).toHaveBeenCalled();
    });
  });

  describe("BankIdReverifyModal", () => {
    it("flags mock-mode when backend returns bankIdConfigured:false", async () => {
      const fetchMock = mockFetch({
        user: { id: "user-1", kycStatus: "UNVERIFIED" },
        bankIdSession: null,
        bankIdConfigured: false,
      });
      const onReverified = vi.fn();
      openBankIdReverifyModal({ player: PLAYER, onReverified });
      const confirmBtn = document.querySelector<HTMLButtonElement>('button[data-action="confirm"]')!;
      confirmBtn.click();
      await nextMicrotasks();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(onReverified).toHaveBeenCalled();
      // mock-mode toast should be shown (not redirect)
      expect(document.getElementById("toast-container")?.textContent).toContain("mock");
    });

    it("opens verify window when session returned", async () => {
      const fetchMock = mockFetch({
        user: { id: "user-1" },
        bankIdSession: { sessionId: "s-1", authUrl: "https://bankid.example/auth?x=1" },
        bankIdConfigured: true,
      });
      const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
      openBankIdReverifyModal({ player: PLAYER });
      const confirmBtn = document.querySelector<HTMLButtonElement>('button[data-action="confirm"]')!;
      confirmBtn.click();
      await nextMicrotasks();
      expect(fetchMock).toHaveBeenCalled();
      expect(openSpy).toHaveBeenCalledTimes(1);
      const hash = openSpy.mock.calls[0]![0] as string;
      expect(hash).toContain("#/bankid/verify");
      expect(hash).toContain("sessionId=s-1");
      openSpy.mockRestore();
    });
  });
});
