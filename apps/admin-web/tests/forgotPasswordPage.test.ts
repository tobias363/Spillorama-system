import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderForgotPasswordPage } from "../src/pages/login/ForgotPasswordPage.js";
import { parsePreAuthRoute } from "../src/pages/login/index.js";

// Flush multiple microtask / macrotask rounds — forgotPassword() chains a
// fetch → .json() → apiRequest() → caller state update. Single `setTimeout(0)`
// isn't enough once jsdom + vitest serialise them.
async function flushAsync(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

// PR-B7 (BIN-675): ForgotPasswordPage renders + submits + shows the same
// generic success panel regardless of backend branch (enumeration-safe).

describe("ForgotPasswordPage", () => {
  const originalFetch = globalThis.fetch;
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    document.body.innerHTML = "";
  });

  it("renders heading, subtitle, email field and submit button", () => {
    renderForgotPasswordPage(root);
    expect(root.querySelector("#forgotForm")).toBeTruthy();
    expect(root.querySelector<HTMLInputElement>("#forgotEmail")?.type).toBe("email");
    expect(root.querySelector<HTMLInputElement>("#forgotEmail")?.autocomplete).toBe("email");
    expect(root.querySelector<HTMLButtonElement>("#forgotSubmit")?.type).toBe("submit");
    expect(root.querySelector("a[href='#/login']")).toBeTruthy();
    // aria-live success/alert containers
    expect(root.querySelector("#forgotAlert")?.getAttribute("aria-live")).toBe("polite");
    expect(root.querySelector("#forgotSuccess")?.getAttribute("aria-live")).toBe("polite");
  });

  it("blocks submit with 'email required' when empty", async () => {
    renderForgotPasswordPage(root);
    const form = root.querySelector<HTMLFormElement>("#forgotForm")!;
    const alert = root.querySelector<HTMLElement>("#forgotAlert")!;
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await Promise.resolve();
    expect(alert.style.display).not.toBe("none");
    expect(alert.textContent).toContain("e-post");
  });

  it("shows generic success + hides form on successful submit", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: { sent: true } }), { status: 200 })
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    renderForgotPasswordPage(root);
    const form = root.querySelector<HTMLFormElement>("#forgotForm")!;
    const email = root.querySelector<HTMLInputElement>("#forgotEmail")!;
    email.value = "anyone@example.com";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    // flush microtasks — the awaited forgotPassword()
    await flushAsync();

    const success = root.querySelector<HTMLElement>("#forgotSuccess")!;
    expect(success.style.display).toBe("");
    expect(success.textContent).toBeTruthy();
    expect(form.style.display).toBe("none");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("shows same generic success regardless of whether user exists (enumeration-safe)", async () => {
    // Simulate two different emails — backend is enumeration-safe so both
    // hit the same apiSuccess { sent: true } branch. UI MUST render
    // identical text both times. Use mockImplementation to return a fresh
    // Response per call (Response body can only be consumed once).
    globalThis.fetch = vi.fn().mockImplementation(
      async () =>
        new Response(JSON.stringify({ ok: true, data: { sent: true } }), { status: 200 })
    ) as unknown as typeof fetch;

    const rootA = document.createElement("div");
    document.body.appendChild(rootA);
    renderForgotPasswordPage(rootA);
    rootA.querySelector<HTMLInputElement>("#forgotEmail")!.value = "known@example.com";
    rootA.querySelector<HTMLFormElement>("#forgotForm")!.dispatchEvent(
      new Event("submit", { cancelable: true })
    );
    await flushAsync();
    const firstText = rootA.querySelector<HTMLElement>("#forgotSuccess")!.textContent;

    const rootB = document.createElement("div");
    document.body.appendChild(rootB);
    renderForgotPasswordPage(rootB);
    rootB.querySelector<HTMLInputElement>("#forgotEmail")!.value = "unknown@example.com";
    rootB.querySelector<HTMLFormElement>("#forgotForm")!.dispatchEvent(
      new Event("submit", { cancelable: true })
    );
    await flushAsync();
    const secondText = rootB.querySelector<HTMLElement>("#forgotSuccess")!.textContent;

    expect(firstText).toBe(secondText);
    expect(firstText?.length ?? 0).toBeGreaterThan(0);
  });

  it("shows error alert on network failure", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;

    renderForgotPasswordPage(root);
    root.querySelector<HTMLInputElement>("#forgotEmail")!.value = "a@b.no";
    root.querySelector<HTMLFormElement>("#forgotForm")!.dispatchEvent(
      new Event("submit", { cancelable: true })
    );
    await flushAsync();

    const alert = root.querySelector<HTMLElement>("#forgotAlert")!;
    expect(alert.style.display).toBe("");
    expect(alert.textContent).toBeTruthy();
  });
});

describe("parsePreAuthRoute", () => {
  it("treats '' and '#/' and '#/login' as login", () => {
    expect(parsePreAuthRoute("")?.kind).toBe("login");
    expect(parsePreAuthRoute("#/")?.kind).toBe("login");
    expect(parsePreAuthRoute("#/login")?.kind).toBe("login");
  });

  it("parses #/register", () => {
    expect(parsePreAuthRoute("#/register")?.kind).toBe("register");
  });

  it("parses #/forgot-password", () => {
    expect(parsePreAuthRoute("#/forgot-password")?.kind).toBe("forgot-password");
  });

  it("parses #/reset-password/:token and URL-decodes", () => {
    const route = parsePreAuthRoute("#/reset-password/abc-123");
    expect(route?.kind).toBe("reset-password");
    if (route?.kind === "reset-password") {
      expect(route.token).toBe("abc-123");
    }

    const encoded = parsePreAuthRoute("#/reset-password/" + encodeURIComponent("x/y?z"));
    if (encoded?.kind === "reset-password") {
      expect(encoded.token).toBe("x/y?z");
    }
  });

  it("returns null for unknown routes (caller falls back to login)", () => {
    expect(parsePreAuthRoute("#/admin")).toBeNull();
    expect(parsePreAuthRoute("#/player")).toBeNull();
  });
});
