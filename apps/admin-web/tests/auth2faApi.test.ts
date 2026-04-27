// REQ-129/132: API-wrapper-tester for /api/auth/2fa/* og /api/auth/sessions/*.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getTwoFAStatus,
  setupTwoFA,
  verifyTwoFA,
  disableTwoFA,
  regenerateBackupCodes,
  twoFALoginRaw,
  listSessions,
  logoutSession,
  logoutAllSessions,
} from "../src/api/auth-2fa.js";
import { setToken, clearToken, ApiError } from "../src/api/client.js";

function ok<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function err(code: string, message: string, status = 400): Response {
  return new Response(JSON.stringify({ ok: false, error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface CapturedCall {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

function makeFetch(handler: (call: CapturedCall) => Response): {
  fetch: typeof fetch;
  calls: CapturedCall[];
} {
  const calls: CapturedCall[] = [];
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method;
    const headers = (init?.headers as Record<string, string> | undefined) ?? undefined;
    let body: unknown;
    if (init?.body) {
      try {
        body = JSON.parse(String(init.body));
      } catch {
        body = init.body;
      }
    }
    const call: CapturedCall = { url, method, headers, body };
    calls.push(call);
    return handler(call);
  };
  return { fetch: fn as unknown as typeof fetch, calls };
}

describe("auth-2fa api wrappers", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    setToken("test-bearer");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearToken();
  });

  it("getTwoFAStatus does GET with auth header and returns parsed status", async () => {
    const { fetch: f, calls } = makeFetch(() =>
      ok({
        enabled: true,
        enabledAt: "2026-04-26T10:00:00Z",
        backupCodesRemaining: 8,
        hasPendingSetup: false,
      })
    );
    globalThis.fetch = f;

    const res = await getTwoFAStatus();
    expect(res.enabled).toBe(true);
    expect(res.backupCodesRemaining).toBe(8);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/api/auth/2fa/status");
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.headers).toMatchObject({ Authorization: "Bearer test-bearer" });
  });

  it("setupTwoFA returns secret + otpauthUri", async () => {
    const { fetch: f } = makeFetch(() =>
      ok({
        secret: "JBSWY3DPEHPK3PXP",
        otpauthUri: "otpauth://totp/Spillorama:user@x.no?secret=JBSWY3DPEHPK3PXP",
      })
    );
    globalThis.fetch = f;
    const res = await setupTwoFA();
    expect(res.secret).toBe("JBSWY3DPEHPK3PXP");
    expect(res.otpauthUri).toContain("otpauth://");
  });

  it("verifyTwoFA POSTs the code and returns backup-codes", async () => {
    const { fetch: f, calls } = makeFetch(() =>
      ok({ enabled: true, backupCodes: ["12345-67890", "11111-22222"] })
    );
    globalThis.fetch = f;
    const res = await verifyTwoFA("123456");
    expect(res.backupCodes).toHaveLength(2);
    expect(res.enabled).toBe(true);
    expect(calls[0]!.body).toEqual({ code: "123456" });
  });

  it("disableTwoFA POSTs both password + TOTP-code", async () => {
    const { fetch: f, calls } = makeFetch(() => ok({ disabled: true }));
    globalThis.fetch = f;
    const res = await disableTwoFA("hunter2", "654321");
    expect(res.disabled).toBe(true);
    expect(calls[0]!.body).toEqual({ password: "hunter2", code: "654321" });
  });

  it("regenerateBackupCodes requires password and returns new codes", async () => {
    const { fetch: f, calls } = makeFetch(() =>
      ok({ backupCodes: ["aaaaa-bbbbb", "ccccc-ddddd", "eeeee-fffff"] })
    );
    globalThis.fetch = f;
    const res = await regenerateBackupCodes("hunter2");
    expect(res.backupCodes).toHaveLength(3);
    expect(calls[0]!.body).toEqual({ password: "hunter2" });
  });

  it("twoFALoginRaw returns rå LoginResponse without setting token", async () => {
    const { fetch: f } = makeFetch(() =>
      ok({
        accessToken: "session-token-after-2fa",
        user: { id: "u-1", email: "x@y.no", role: "PLAYER", isSuperAdmin: false, hall: [] },
      })
    );
    globalThis.fetch = f;
    const res = await twoFALoginRaw({ challengeId: "ch-1", code: "123456" });
    expect(res.accessToken).toBe("session-token-after-2fa");
    expect(res.user.email).toBe("x@y.no");
  });

  it("listSessions GETs and returns array of sessions", async () => {
    const sessions = [
      {
        id: "s-1",
        userId: "u-1",
        deviceUserAgent: "Mozilla/5.0 Chrome",
        ipAddress: "192.0.2.1",
        lastActivityAt: "2026-04-26T11:00:00Z",
        createdAt: "2026-04-26T10:00:00Z",
        expiresAt: "2026-04-27T10:00:00Z",
        isCurrent: true,
      },
      {
        id: "s-2",
        userId: "u-1",
        deviceUserAgent: "iPhone Safari",
        ipAddress: "198.51.100.5",
        lastActivityAt: "2026-04-26T10:30:00Z",
        createdAt: "2026-04-26T09:00:00Z",
        expiresAt: "2026-04-27T09:00:00Z",
        isCurrent: false,
      },
    ];
    const { fetch: f } = makeFetch(() => ok({ sessions }));
    globalThis.fetch = f;
    const res = await listSessions();
    expect(res.sessions).toHaveLength(2);
    expect(res.sessions[0]!.isCurrent).toBe(true);
  });

  it("logoutSession POSTs to /:id/logout", async () => {
    const { fetch: f, calls } = makeFetch(() => ok({ loggedOut: true }));
    globalThis.fetch = f;
    await logoutSession("s-2");
    expect(calls[0]!.url).toBe("/api/auth/sessions/s-2/logout");
    expect(calls[0]!.method).toBe("POST");
  });

  it("logoutAllSessions sends includeCurrent in body", async () => {
    const { fetch: f, calls } = makeFetch(() => ok({ count: 2 }));
    globalThis.fetch = f;
    const res = await logoutAllSessions(false);
    expect(res.count).toBe(2);
    expect(calls[0]!.body).toEqual({ includeCurrent: false });
  });

  it("verifyTwoFA throws ApiError with backend code on 400", async () => {
    const { fetch: f } = makeFetch(() => err("INVALID_TOTP_CODE", "Ugyldig kode", 400));
    globalThis.fetch = f;
    let caught: unknown;
    try {
      await verifyTwoFA("000000");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe("INVALID_TOTP_CODE");
    expect((caught as ApiError).status).toBe(400);
    // Avoid unused lint: ensure vi mock import remains used.
    void vi;
  });
});
