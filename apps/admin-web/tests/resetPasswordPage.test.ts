import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderResetPasswordPage } from "../src/pages/login/ResetPasswordPage.js";

// PR-B7 (BIN-675): ResetPasswordPage 3-state machine — validating → form →
// success, with an invalid branch fallback.

async function flush(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

describe("ResetPasswordPage", () => {
  const originalFetch = globalThis.fetch;
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("renders 'validating' state synchronously before any fetch resolves", () => {
    globalThis.fetch = vi.fn().mockImplementation(() => new Promise(() => {})) as unknown as typeof fetch;
    renderResetPasswordPage(root, "sometoken");
    expect(root.querySelector("[data-reset-state='validating']")).toBeTruthy();
  });

  it("transitions to 'form' state when validateResetToken returns ok", async () => {
    globalThis.fetch = vi
      .fn()
      .mockImplementation(
        async () =>
          new Response(
            JSON.stringify({ ok: true, data: { valid: true, userId: "u1" } }),
            { status: 200 }
          )
      ) as unknown as typeof fetch;

    renderResetPasswordPage(root, "goodtoken");
    await flush();
    expect(root.querySelector("[data-reset-state='form']")).toBeTruthy();
    expect(root.querySelector<HTMLInputElement>("#resetNew")).toBeTruthy();
    expect(root.querySelector<HTMLInputElement>("#resetConfirm")).toBeTruthy();
  });

  it("shows 'invalid' state when token validation fails (400)", async () => {
    globalThis.fetch = vi
      .fn()
      .mockImplementation(
        async () =>
          new Response(
            JSON.stringify({ ok: false, error: { code: "INVALID_TOKEN", message: "nope" } }),
            { status: 400 }
          )
      ) as unknown as typeof fetch;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    renderResetPasswordPage(root, "badtoken");
    await flush();
    expect(root.querySelector("[data-reset-state='invalid']")).toBeTruthy();
    expect(root.querySelector("#resetTokenError")).toBeTruthy();
    // Link to forgot-password must be present so the user can request a
    // fresh link — the whole point of the invalid state.
    expect(root.querySelector("a[href='#/forgot-password']")).toBeTruthy();
    warnSpy.mockRestore();
  });

  it("shows 'invalid' immediately when token is empty (skips fetch)", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    renderResetPasswordPage(root, "");
    await flush();
    expect(root.querySelector("[data-reset-state='invalid']")).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects mismatched passwords without calling backend", async () => {
    globalThis.fetch = vi
      .fn()
      .mockImplementation(
        async () =>
          new Response(
            JSON.stringify({ ok: true, data: { valid: true, userId: "u1" } }),
            { status: 200 }
          )
      ) as unknown as typeof fetch;
    renderResetPasswordPage(root, "t");
    await flush();

    const newPwd = root.querySelector<HTMLInputElement>("#resetNew")!;
    const confirm = root.querySelector<HTMLInputElement>("#resetConfirm")!;
    const form = root.querySelector<HTMLFormElement>("#resetForm")!;
    newPwd.value = "GoodPassw0rd123";
    confirm.value = "OtherPassw0rd123";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();

    expect(root.querySelector<HTMLElement>("#resetAlert")?.style.display).toBe("");
    // 1 call for GET validate, no POST
    expect((globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1);
  });

  it("rejects weak password (no digit) without calling backend", async () => {
    globalThis.fetch = vi
      .fn()
      .mockImplementation(
        async () =>
          new Response(
            JSON.stringify({ ok: true, data: { valid: true, userId: "u1" } }),
            { status: 200 }
          )
      ) as unknown as typeof fetch;
    renderResetPasswordPage(root, "t");
    await flush();

    const newPwd = root.querySelector<HTMLInputElement>("#resetNew")!;
    const confirm = root.querySelector<HTMLInputElement>("#resetConfirm")!;
    const form = root.querySelector<HTMLFormElement>("#resetForm")!;
    newPwd.value = "NoDigitsHere";
    confirm.value = "NoDigitsHere";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();

    expect(root.querySelector<HTMLElement>("#resetAlert")?.style.display).toBe("");
    expect((globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1);
  });

  it("transitions to 'success' after POST succeeds", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(
          JSON.stringify({ ok: true, data: { valid: true, userId: "u1" } }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({ ok: true, data: { reset: true } }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    renderResetPasswordPage(root, "t");
    await flush();
    const form = root.querySelector<HTMLFormElement>("#resetForm")!;
    root.querySelector<HTMLInputElement>("#resetNew")!.value = "Passord1234!";
    root.querySelector<HTMLInputElement>("#resetConfirm")!.value = "Passord1234!";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();

    expect(root.querySelector("[data-reset-state='success']")).toBeTruthy();
    expect(root.querySelector("#resetSuccessCta")).toBeTruthy();
  });

  it("falls back to 'invalid' state if token becomes invalid on POST", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(
          JSON.stringify({ ok: true, data: { valid: true, userId: "u1" } }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({ ok: false, error: { code: "TOKEN_EXPIRED", message: "x" } }),
        { status: 400 }
      );
    }) as unknown as typeof fetch;

    renderResetPasswordPage(root, "t");
    await flush();
    const form = root.querySelector<HTMLFormElement>("#resetForm")!;
    root.querySelector<HTMLInputElement>("#resetNew")!.value = "Passord1234!";
    root.querySelector<HTMLInputElement>("#resetConfirm")!.value = "Passord1234!";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();

    expect(root.querySelector("[data-reset-state='invalid']")).toBeTruthy();
  });
});
