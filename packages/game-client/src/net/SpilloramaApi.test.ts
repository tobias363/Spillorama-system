/**
 * @vitest-environment happy-dom
 *
 * Tester for SpilloramaApi.request response-shape-håndtering.
 *
 * Pilot-bug 2026-05-04 (ChooseTickets fetch error):
 *   `window.SpilloramaAuth.authenticatedFetch` (definert i
 *   apps/backend/public/web/auth.js linje 159-161) returnerer ALLEREDE
 *   det inner-unwrappede `body.data`-objektet — ikke en Response. Tidligere
 *   kalte SpilloramaApi.request `.json()` på resultatet → TypeError og
 *   ChooseTickets-popup sto tom.
 *
 * Disse testene verifiserer at:
 *   1) Når shellAuth.authenticatedFetch returnerer en unwrapped data-payload,
 *      pakker request den inn i { ok: true, data } før caller får den.
 *   2) Når shellAuth.authenticatedFetch (defensivt) returnerer en ekte
 *      Response, kalles .json() korrekt slik at vi støtter både gamle og
 *      nye auth.js-versjoner.
 *   3) Når shellAuth.authenticatedFetch kaster en Error (typisk 401 uten
 *      refresh eller body.ok=false), konverterer vi til
 *      { ok: false, error: { code, message } }-shape i stedet for å la
 *      caller fange en exception.
 *   4) Direct-fetch-pathen (uten shellAuth) beholder gammel oppførsel og
 *      forventer Response → .json() returnerer ApiResult direkte.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Mock } from "vitest";
import { SpilloramaApi } from "./SpilloramaApi.js";

// ── Test-stuber ─────────────────────────────────────────────────────────

interface ShellAuthStub {
  authenticatedFetch?: Mock;
}

const ORIGINAL_FETCH = globalThis.fetch;

function setShellAuth(stub: ShellAuthStub | null): void {
  if (stub) {
    (window as unknown as Record<string, unknown>).SpilloramaAuth = stub;
  } else {
    delete (window as unknown as Record<string, unknown>).SpilloramaAuth;
  }
}

function makeFakeResponse(body: unknown): Response {
  return {
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe("SpilloramaApi.request — shellAuth response-shape (pilot-bug 2026-05-04)", () => {
  beforeEach(() => {
    setShellAuth(null);
    globalThis.fetch = ORIGINAL_FETCH;
  });

  afterEach(() => {
    setShellAuth(null);
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it("pakker unwrapped data fra shellAuth.authenticatedFetch i ok:true-konvolusjon", async () => {
    // auth.js sin authenticatedFetch returnerer body.data direkte (ikke Response).
    const unwrappedData = {
      tickets: [{ id: "t1" }, { id: "t2" }],
      purchasedIndices: [0],
      pickAnyNumber: 7,
    };
    setShellAuth({
      authenticatedFetch: vi.fn().mockResolvedValue(unwrappedData),
    });

    const api = new SpilloramaApi("");
    const result = await api.getGame2ChooseTickets("ROCKET");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(unwrappedData);
    }
  });

  it("støtter ekte Response fra shellAuth.authenticatedFetch (bakoverkompat)", async () => {
    // Eldre auth.js eller alternativ shell-implementasjon kan returnere
    // en faktisk Response — vi må fortsatt kalle .json() på den.
    const apiResultBody = { ok: true, data: { foo: "bar" } };
    const fakeResponse = makeFakeResponse(apiResultBody);
    setShellAuth({
      authenticatedFetch: vi.fn().mockResolvedValue(fakeResponse),
    });

    const api = new SpilloramaApi("");
    const result = await api.getGames();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ foo: "bar" });
    }
    expect(fakeResponse.json).toHaveBeenCalledTimes(1);
  });

  it("konverterer kast-feil fra shellAuth.authenticatedFetch til ApiError-shape", async () => {
    // authenticatedFetch kaster ved body.ok=false eller 401-uten-refresh.
    // Caller skal få { ok: false, error: ... } i stedet for unhandled exception.
    setShellAuth({
      authenticatedFetch: vi
        .fn()
        .mockRejectedValue(new Error("Sesjonen har utløpt")),
    });

    const api = new SpilloramaApi("");
    const result = await api.getGame2ChooseTickets("ROCKET");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("REQUEST_FAILED");
      expect(result.error.message).toBe("Sesjonen har utløpt");
    }
  });

  it("regresjon: TypeError 'json is not a function' kastes ikke ved unwrapped data", async () => {
    // Eksakt prod-bug: minified bygget kastet
    // `TypeError: i.json is not a function` ved
    // `Game2Controller-CT4xg2f7.js:719:132`. Dette skjedde når
    // request kalte `.json()` på det unwrappede data-objektet fra
    // authenticatedFetch. Etter fix skal vi få en ApiResult i stedet.
    setShellAuth({
      authenticatedFetch: vi.fn().mockResolvedValue({
        // Et plain objekt UTEN `.json` — speiler hva `body.data` er i auth.js.
        roomCode: "ROCKET",
        tickets: [],
      }),
    });

    const api = new SpilloramaApi("");
    // Skal IKKE kaste — uten fix kastet denne TypeError.
    const result = await api.getGame2ChooseTickets("ROCKET");

    expect(result.ok).toBe(true);
  });

  it("direct-fetch path (ingen shellAuth) leser ApiResult fra Response.json()", async () => {
    setShellAuth(null);
    const apiResultBody = { ok: true, data: { id: "u1" } };
    globalThis.fetch = vi.fn().mockResolvedValue(makeFakeResponse(apiResultBody));

    const api = new SpilloramaApi("");
    const result = await api.getProfile();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ id: "u1" });
    }
  });
});
