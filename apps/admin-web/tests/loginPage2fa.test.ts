// REQ-129: LoginPage two-step flow.
//   Step 1: email + password → if backend returns requires2FA, show 2FA input.
//   Step 2: code → /api/auth/2fa/login → setSession + onSuccess.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderLoginPage } from "../src/pages/login/LoginPage.js";
import { getSession, setSession } from "../src/auth/Session.js";
import { clearToken, getToken } from "../src/api/client.js";

async function flush(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

function fillCredentials(root: HTMLElement, email: string, password: string): void {
  root.querySelector<HTMLInputElement>("input[name='email']")!.value = email;
  root.querySelector<HTMLInputElement>("input[name='password']")!.value = password;
}

function submitForm(form: HTMLFormElement): void {
  form.dispatchEvent(new Event("submit", { cancelable: true }));
}

describe("LoginPage 2FA flow (REQ-129)", () => {
  const originalFetch = globalThis.fetch;
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    clearToken();
    setSession(null);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    document.body.innerHTML = "";
    setSession(null);
    clearToken();
  });

  it("renders login form initially with 2FA form hidden", () => {
    renderLoginPage(root, () => {});
    const loginForm = root.querySelector<HTMLFormElement>("#loginForm")!;
    const twoFAForm = root.querySelector<HTMLFormElement>("#twoFAForm")!;
    expect(loginForm.style.display).not.toBe("none");
    expect(twoFAForm.style.display).toBe("none");
  });

  it("logs in directly when backend returns full session (no 2FA)", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            accessToken: "session-no-2fa",
            user: { id: "u-1", email: "x@y.no", role: "ADMIN", isSuperAdmin: false, hall: [] },
          },
        }),
        { status: 200 }
      )
    ) as unknown as typeof fetch;

    const onSuccess = vi.fn();
    renderLoginPage(root, onSuccess);
    fillCredentials(root, "x@y.no", "Sterkt1234!!");
    submitForm(root.querySelector<HTMLFormElement>("#loginForm")!);
    await flush();

    expect(getToken()).toBe("session-no-2fa");
    expect(getSession()?.email).toBe("x@y.no");
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("switches to 2FA step when backend returns requires2FA", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            requires2FA: true,
            challengeId: "ch-abc",
            challengeExpiresAt: "2026-04-26T12:00:00Z",
          },
        }),
        { status: 200 }
      )
    ) as unknown as typeof fetch;

    const onSuccess = vi.fn();
    renderLoginPage(root, onSuccess);
    fillCredentials(root, "secured@y.no", "Sterkt1234!!");
    submitForm(root.querySelector<HTMLFormElement>("#loginForm")!);
    await flush();

    const loginForm = root.querySelector<HTMLFormElement>("#loginForm")!;
    const twoFAForm = root.querySelector<HTMLFormElement>("#twoFAForm")!;
    expect(loginForm.style.display).toBe("none");
    expect(twoFAForm.style.display).not.toBe("none");
    expect(onSuccess).not.toHaveBeenCalled();
    expect(getToken()).toBe("");
  });

  it("completes login after 2FA code is submitted", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      callCount += 1;
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/auth/login") {
        return new Response(
          JSON.stringify({
            ok: true,
            data: { requires2FA: true, challengeId: "ch-xyz", challengeExpiresAt: "2026-04-26T12:00:00Z" },
          }),
          { status: 200 }
        );
      }
      if (url === "/api/auth/2fa/login") {
        const body = JSON.parse(String(init?.body ?? "{}"));
        expect(body).toEqual({ challengeId: "ch-xyz", code: "654321" });
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              accessToken: "session-after-2fa",
              user: { id: "u-1", email: "secured@y.no", role: "ADMIN", isSuperAdmin: false, hall: [] },
            },
          }),
          { status: 200 }
        );
      }
      throw new Error("unexpected URL: " + url);
    }) as unknown as typeof fetch;

    const onSuccess = vi.fn();
    renderLoginPage(root, onSuccess);
    fillCredentials(root, "secured@y.no", "Sterkt1234!!");
    submitForm(root.querySelector<HTMLFormElement>("#loginForm")!);
    await flush();

    // Step 2: skriv inn kode og send
    const codeInput = root.querySelector<HTMLInputElement>("#twoFACode")!;
    codeInput.value = "654321";
    submitForm(root.querySelector<HTMLFormElement>("#twoFAForm")!);
    await flush();

    expect(callCount).toBe(2);
    expect(getToken()).toBe("session-after-2fa");
    expect(getSession()?.email).toBe("secured@y.no");
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("surfaces error and stays on 2FA step when code is wrong", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/auth/login") {
        return new Response(
          JSON.stringify({
            ok: true,
            data: { requires2FA: true, challengeId: "ch-1", challengeExpiresAt: "2026-04-26T12:00:00Z" },
          }),
          { status: 200 }
        );
      }
      if (url === "/api/auth/2fa/login") {
        return new Response(
          JSON.stringify({ ok: false, error: { code: "INVALID_TOTP_CODE", message: "Ugyldig kode" } }),
          { status: 400 }
        );
      }
      throw new Error("unexpected URL: " + url);
    }) as unknown as typeof fetch;

    const onSuccess = vi.fn();
    renderLoginPage(root, onSuccess);
    fillCredentials(root, "secured@y.no", "Sterkt1234!!");
    submitForm(root.querySelector<HTMLFormElement>("#loginForm")!);
    await flush();

    const codeInput = root.querySelector<HTMLInputElement>("#twoFACode")!;
    codeInput.value = "000000";
    submitForm(root.querySelector<HTMLFormElement>("#twoFAForm")!);
    await flush();

    const alertEl = root.querySelector<HTMLElement>("#loginAlert")!;
    expect(alertEl.style.display).toBe("");
    expect(alertEl.textContent?.toLowerCase()).toContain("ugyldig");
    expect(onSuccess).not.toHaveBeenCalled();
    // Fortsatt på 2FA-step, ikke tilbake til credentials
    const twoFAForm = root.querySelector<HTMLFormElement>("#twoFAForm")!;
    expect(twoFAForm.style.display).not.toBe("none");
  });

  it("Avbryt-knapp på 2FA-trinn returnerer til credentials-step", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          data: { requires2FA: true, challengeId: "ch-cancel", challengeExpiresAt: "2026-04-26T12:00:00Z" },
        }),
        { status: 200 }
      )
    ) as unknown as typeof fetch;

    renderLoginPage(root, () => {});
    fillCredentials(root, "secured@y.no", "Sterkt1234!!");
    submitForm(root.querySelector<HTMLFormElement>("#loginForm")!);
    await flush();

    const cancelBtn = root.querySelector<HTMLButtonElement>("#twoFACancel")!;
    cancelBtn.click();
    await flush();

    const loginForm = root.querySelector<HTMLFormElement>("#loginForm")!;
    const twoFAForm = root.querySelector<HTMLFormElement>("#twoFAForm")!;
    expect(loginForm.style.display).not.toBe("none");
    expect(twoFAForm.style.display).toBe("none");
  });
});
