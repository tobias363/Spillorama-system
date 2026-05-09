import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { register, forgotPassword, validateResetToken, resetPassword } from "../src/api/auth.js";
import { clearToken, getToken, ApiError } from "../src/api/client.js";

// PR-B7 (BIN-675): unit coverage for new pre-auth API wrappers.
//
// These wrappers target the BIN-587 B2.1 endpoints:
//  - POST /api/auth/register           → session (auto-login)
//  - POST /api/auth/forgot-password    → { sent: true } (enumeration-safe)
//  - GET  /api/auth/reset-password/:t  → { valid, userId }
//  - POST /api/auth/reset-password/:t  → { reset: true }
describe("PR-B7 auth API wrappers", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    clearToken();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("register", () => {
    it("stores access token and maps session on success", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: true,
            data: {
              accessToken: "token-xyz",
              user: {
                id: "u-new",
                email: "new@example.com",
                displayName: "New User",
                role: "PLAYER",
                isSuperAdmin: false,
                hall: [],
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      ) as unknown as typeof fetch;

      const session = await register({
        email: "new@example.com",
        password: "AbcdEfgh1234",
        displayName: "New",
        surname: "User",
        birthDate: "1990-01-01",
      });

      expect(session.email).toBe("new@example.com");
      expect(getToken()).toBe("token-xyz");
    });

    it("does NOT send phone when omitted", async () => {
      const fetchSpy = vi.fn().mockResolvedValue(
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

      await register({
        email: "a@b.no",
        password: "AbcdEfgh1234",
        displayName: "A",
        surname: "B",
        birthDate: "1990-01-01",
      });

      const body = JSON.parse(String(fetchSpy.mock.calls[0]![1].body));
      expect(body.phone).toBeUndefined();
    });

    it("sends phone when provided", async () => {
      const fetchSpy = vi.fn().mockResolvedValue(
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

      await register({
        email: "a@b.no",
        password: "AbcdEfgh1234",
        displayName: "A",
        surname: "B",
        birthDate: "1990-01-01",
        phone: "+4712345678",
      });

      const body = JSON.parse(String(fetchSpy.mock.calls[0]![1].body));
      expect(body.phone).toBe("+4712345678");
    });

    it("throws ApiError with backend code on 400", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ ok: false, error: { code: "EMAIL_EXISTS", message: "taken" } }),
          { status: 400 }
        )
      ) as unknown as typeof fetch;

      await expect(
        register({
          email: "dup@x.no",
          password: "AbcdEfgh1234",
          displayName: "A",
          surname: "B",
          birthDate: "1990-01-01",
        })
      ).rejects.toBeInstanceOf(ApiError);
      expect(getToken()).toBe("");
    });
  });

  describe("forgotPassword", () => {
    it("returns { sent: true } on success", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true, data: { sent: true } }), { status: 200 })
      ) as unknown as typeof fetch;

      const result = await forgotPassword("anyone@example.com");
      expect(result.sent).toBe(true);
    });

    it("returns { sent: true } even when backend omits the flag (graceful)", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 })
      ) as unknown as typeof fetch;

      const result = await forgotPassword("anyone@example.com");
      expect(result.sent).toBe(false);
    });
  });

  describe("validateResetToken", () => {
    it("returns valid=true + userId on 200", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ ok: true, data: { valid: true, userId: "u-1" } }),
          { status: 200 }
        )
      ) as unknown as typeof fetch;

      const result = await validateResetToken("abc123");
      expect(result.valid).toBe(true);
      expect(result.userId).toBe("u-1");
    });

    it("throws ApiError on invalid token (400)", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ ok: false, error: { code: "INVALID_TOKEN", message: "bad" } }),
          { status: 400 }
        )
      ) as unknown as typeof fetch;

      await expect(validateResetToken("bad")).rejects.toBeInstanceOf(ApiError);
    });

    it("URL-encodes the token", async () => {
      const fetchSpy = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ ok: true, data: { valid: true, userId: "u" } }),
          { status: 200 }
        )
      );
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      await validateResetToken("weird/token?x=1");
      const calledUrl = String(fetchSpy.mock.calls[0]![0]);
      expect(calledUrl).toContain(encodeURIComponent("weird/token?x=1"));
    });
  });

  describe("resetPassword", () => {
    it("returns { reset: true } on success", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true, data: { reset: true } }), { status: 200 })
      ) as unknown as typeof fetch;

      const result = await resetPassword("tok", "NewPassw0rd123");
      expect(result.reset).toBe(true);
    });

    it("throws ApiError when token expired", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ ok: false, error: { code: "TOKEN_EXPIRED", message: "expired" } }),
          { status: 400 }
        )
      ) as unknown as typeof fetch;

      await expect(resetPassword("tok", "NewPassw0rd123")).rejects.toBeInstanceOf(ApiError);
    });
  });
});
