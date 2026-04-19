import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { bootstrapAuth } from "../src/auth/AuthGuard.js";
import { getSession, setSession } from "../src/auth/Session.js";
import { setToken, clearToken } from "../src/api/client.js";

describe("bootstrapAuth", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    clearToken();
    setSession(null);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns 'unauthenticated' when no token is stored", async () => {
    const state = await bootstrapAuth();
    expect(state).toBe("unauthenticated");
    expect(getSession()).toBeNull();
  });

  it("returns 'authenticated' when /api/auth/me succeeds", async () => {
    setToken("fake-token");
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/me")) {
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              id: "u1",
              email: "admin@example.com",
              displayName: "Admin",
              role: "admin",
              isSuperAdmin: true,
              hall: [],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (url.includes("/api/admin/permissions")) {
        return new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: "" } }), { status: 404 });
    }) as unknown as typeof fetch;

    const state = await bootstrapAuth();
    expect(state).toBe("authenticated");
    const session = getSession();
    expect(session?.email).toBe("admin@example.com");
    expect(session?.role).toBe("super-admin"); // isSuperAdmin: true promotes role
  });

  it("returns 'unauthenticated' and clears session when /api/auth/me returns 401", async () => {
    setToken("stale-token");
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: { code: "UNAUTHORIZED", message: "expired" } }), { status: 401 })
    ) as unknown as typeof fetch;

    const state = await bootstrapAuth();
    expect(state).toBe("unauthenticated");
    expect(getSession()).toBeNull();
  });
});
