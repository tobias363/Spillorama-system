// Test for dev-auto-login helper — verifiserer at:
//   1) når URL ikke har `?dev-user=`, returnerer helperen `false` uten å
//      kalle backend.
//   2) helperen er kun aktiv når `import.meta.env.DEV` er true (Vite tree-
//      shaker den ut av prod-bundle, men under vitest har vi DEV=true så
//      vi kan teste at den faktisk gjør et fetch-kall).
//   3) etter et vellykket auto-login, lagrer den token i localStorage
//      (via setToken).

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { maybeAutoLoginFromQueryParam } from "../src/auth/devAutoLogin.js";
import { getToken, clearToken } from "../src/api/client.js";

describe("dev auto-login (DEV-only)", () => {
  let originalLocation: Location;
  let replaceMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clearToken();
    sessionStorage.clear();
    originalLocation = window.location;
    replaceMock = vi.fn();
    // jsdom location.replace er en stub, men vi vil heller mock det helt
    // så testen ikke faktisk redirecter.
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: {
        ...originalLocation,
        href: "http://localhost:5174/admin/",
        search: "",
        replace: replaceMock,
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
    vi.restoreAllMocks();
  });

  it("returnerer false uten å fetche når ?dev-user= mangler", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await maybeAutoLoginFromQueryParam();
    expect(result).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("kaller backend og lagrer token når ?dev-user= er satt", async () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: {
        ...originalLocation,
        href: "http://localhost:5174/admin/?dev-user=demo-admin@spillorama.no",
        search: "?dev-user=demo-admin@spillorama.no",
        replace: replaceMock,
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        data: { accessToken: "tok-1234", user: { id: "u1" }, expiresAt: null },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await maybeAutoLoginFromQueryParam();
    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/dev/auto-login?email=demo-admin%40spillorama.no",
      expect.objectContaining({ method: "GET" }),
    );
    expect(getToken()).toBe("tok-1234");
    expect(replaceMock).toHaveBeenCalledTimes(1);
  });

  it("returnerer false hvis backend returnerer ok=false", async () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: {
        ...originalLocation,
        href: "http://localhost:5174/admin/?dev-user=ekte-bruker@example.com",
        search: "?dev-user=ekte-bruker@example.com",
        replace: replaceMock,
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({
        ok: false,
        error: { code: "FORBIDDEN", message: "ikke tillatt" },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    // dempe console.error i denne testen
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await maybeAutoLoginFromQueryParam();
    expect(result).toBe(false);
    expect(getToken()).toBe("");
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
