import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderRegisterPage } from "../src/pages/login/RegisterPage.js";
import { getSession, setSession } from "../src/auth/Session.js";
import { clearToken, getToken } from "../src/api/client.js";

// PR-B7 (BIN-675) — RegisterPage renders + validates + auto-logs-in.

async function flush(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

describe("RegisterPage", () => {
  const originalFetch = globalThis.fetch;
  const originalHash = window.location.hash;
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
    window.location.hash = originalHash;
    setSession(null);
    clearToken();
  });

  it("renders all required fields with correct autocomplete hints", () => {
    renderRegisterPage(root, () => {});
    expect(root.querySelector<HTMLInputElement>("#registerFirstName")?.autocomplete).toBe("given-name");
    expect(root.querySelector<HTMLInputElement>("#registerSurname")?.autocomplete).toBe("family-name");
    expect(root.querySelector<HTMLInputElement>("#registerEmail")?.autocomplete).toBe("email");
    expect(root.querySelector<HTMLInputElement>("#registerBirthDate")?.type).toBe("date");
    expect(root.querySelector<HTMLInputElement>("#registerPhone")?.autocomplete).toBe("tel");
    expect(root.querySelector<HTMLInputElement>("#registerPassword")?.autocomplete).toBe("new-password");
    expect(root.querySelector<HTMLButtonElement>("#registerSubmit")).toBeTruthy();
  });

  it("blocks submit and surfaces password-too-weak on obviously weak input without fetching", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    renderRegisterPage(root, () => {});

    fillForm(root, {
      firstName: "Kari",
      surname: "Nordmann",
      email: "kari@example.no",
      birthDate: "1985-05-15",
      password: "weak",
    });
    submit(root);
    await flush();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(root.querySelector<HTMLElement>("#registerAlert")?.style.display).toBe("");
  });

  it("blocks submit when required field missing", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    renderRegisterPage(root, () => {});

    fillForm(root, {
      firstName: "",
      surname: "Nordmann",
      email: "kari@example.no",
      birthDate: "1985-05-15",
      password: "Sterkt1234!!",
    });
    submit(root);
    await flush();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(root.querySelector<HTMLElement>("#registerAlert")?.style.display).toBe("");
  });

  it("auto-logs-in on success: stores token + populates session + invokes onSuccess", async () => {
    const fetchSpy = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            data: {
              accessToken: "new-token-123",
              user: {
                id: "u-new",
                email: "kari@example.no",
                displayName: "Kari",
                role: "PLAYER",
                isSuperAdmin: false,
                hall: [],
              },
            },
          }),
          { status: 200 }
        )
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const onSuccess = vi.fn();
    renderRegisterPage(root, onSuccess);

    fillForm(root, {
      firstName: "Kari",
      surname: "Nordmann",
      email: "kari@example.no",
      birthDate: "1985-05-15",
      password: "Sterkt1234!!",
      phone: "+4799887766",
    });
    submit(root);
    await flush();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchSpy.mock.calls[0][1].body));
    expect(body).toEqual({
      email: "kari@example.no",
      password: "Sterkt1234!!",
      displayName: "Kari",
      surname: "Nordmann",
      birthDate: "1985-05-15",
      phone: "+4799887766",
    });

    expect(getToken()).toBe("new-token-123");
    const session = getSession();
    expect(session?.email).toBe("kari@example.no");
    expect(session?.role).toBe("admin"); // PLAYER role → web shell maps to "admin" default
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe("#/admin");
  });

  it("maps EMAIL_EXISTS error code to i18n message", async () => {
    globalThis.fetch = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ ok: false, error: { code: "EMAIL_EXISTS", message: "exists" } }),
          { status: 400 }
        )
    ) as unknown as typeof fetch;

    const onSuccess = vi.fn();
    renderRegisterPage(root, onSuccess);

    fillForm(root, {
      firstName: "Kari",
      surname: "Nordmann",
      email: "dup@example.no",
      birthDate: "1985-05-15",
      password: "Sterkt1234!!",
    });
    submit(root);
    await flush();

    expect(onSuccess).not.toHaveBeenCalled();
    const alert = root.querySelector<HTMLElement>("#registerAlert")!;
    expect(alert.style.display).toBe("");
    expect(alert.textContent?.toLowerCase()).toContain("registrert");
  });

  it("omits phone from payload when left empty", async () => {
    const fetchSpy = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            data: {
              accessToken: "t",
              user: { id: "u", email: "a@b.no", role: "PLAYER" },
            },
          }),
          { status: 200 }
        )
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    renderRegisterPage(root, () => {});
    fillForm(root, {
      firstName: "A",
      surname: "B",
      email: "a@b.no",
      birthDate: "1990-01-01",
      password: "Sterkt1234!!",
    });
    submit(root);
    await flush();

    const body = JSON.parse(String(fetchSpy.mock.calls[0][1].body));
    expect(body.phone).toBeUndefined();
  });
});

function fillForm(
  root: HTMLElement,
  v: {
    firstName: string;
    surname: string;
    email: string;
    birthDate: string;
    password: string;
    phone?: string;
  }
): void {
  root.querySelector<HTMLInputElement>("#registerFirstName")!.value = v.firstName;
  root.querySelector<HTMLInputElement>("#registerSurname")!.value = v.surname;
  root.querySelector<HTMLInputElement>("#registerEmail")!.value = v.email;
  root.querySelector<HTMLInputElement>("#registerBirthDate")!.value = v.birthDate;
  root.querySelector<HTMLInputElement>("#registerPassword")!.value = v.password;
  root.querySelector<HTMLInputElement>("#registerPhone")!.value = v.phone ?? "";
}

function submit(root: HTMLElement): void {
  root.querySelector<HTMLFormElement>("#registerForm")!.dispatchEvent(
    new Event("submit", { cancelable: true })
  );
}
