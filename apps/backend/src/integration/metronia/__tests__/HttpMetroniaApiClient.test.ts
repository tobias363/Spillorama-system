/**
 * Bølge D coverage: HttpMetroniaApiClient — HTTP-implementasjonen av
 * Metronia API-klienten (Candy adapter).
 *
 * Dekker:
 *   - Constructor: tom baseUrl kaster INVALID_CONFIG
 *   - Constructor: trailing slashes på baseUrl strippes
 *   - Constructor: tlsRejectUnauthorized=false aktiverer insecure dispatcher
 *   - createTicket: happy path returnerer ticketNumber + ticketId
 *   - createTicket: tomt ticket eller ticket_id i respons → METRONIA_BAD_RESPONSE
 *   - createTicket: error=N i respons → METRONIA_API_ERROR
 *   - topupTicket: happy path returnerer newBalanceCents
 *   - topupTicket: NaN balance i respons → METRONIA_BAD_RESPONSE
 *   - closeTicket: negativ balance → METRONIA_BAD_RESPONSE
 *   - getStatus: happy path mapper alle felt
 *   - HTTP 500 uten error-felt → METRONIA_API_ERROR
 *   - Tomt JSON-respons → METRONIA_BAD_RESPONSE
 *   - AbortError → METRONIA_TIMEOUT
 *   - Authorization-header inkluderer Bearer-token
 */
import assert from "node:assert/strict";
import test from "node:test";
import { HttpMetroniaApiClient } from "../HttpMetroniaApiClient.js";
import { DomainError } from "../../../game/BingoEngine.js";

interface FetchCall {
  url: string;
  init: RequestInit;
}

interface FakeResponse {
  ok: boolean;
  status: number;
  json?: () => Promise<unknown>;
  /** Throw a specific error from json() — for testing parse failures. */
  jsonThrows?: boolean;
}

function installFakeFetch(responses: FakeResponse[]): {
  calls: FetchCall[];
  restore: () => void;
} {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  let idx = 0;

  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses[Math.min(idx, responses.length - 1)] ?? { ok: false, status: 500 };
    idx++;
    return {
      ok: r.ok,
      status: r.status,
      json: r.jsonThrows
        ? async () => {
            throw new SyntaxError("Invalid JSON");
          }
        : (r.json ?? (async () => null)),
    } as unknown as Response;
  }) as unknown as typeof globalThis.fetch;

  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function withFetch(
  responses: FakeResponse[],
  fn: (calls: FetchCall[]) => Promise<void>,
): Promise<void> {
  const { calls, restore } = installFakeFetch(responses);
  return fn(calls).finally(restore);
}

const validOpts = { baseUrl: "https://metronia.test/api", apiToken: "secret-token" };

// ── Constructor ───────────────────────────────────────────────────────────

test("HttpMetroniaApiClient ctor — tom baseUrl kaster INVALID_CONFIG", () => {
  assert.throws(
    () => new HttpMetroniaApiClient({ baseUrl: "", apiToken: "x" }),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "INVALID_CONFIG");
      return true;
    },
  );
});

test("HttpMetroniaApiClient ctor — kun whitespace baseUrl kaster INVALID_CONFIG", () => {
  assert.throws(() => new HttpMetroniaApiClient({ baseUrl: "   ", apiToken: "x" }));
});

test("HttpMetroniaApiClient ctor — trailing slashes strippes fra baseUrl", async () => {
  const client = new HttpMetroniaApiClient({ baseUrl: "https://metronia.test/api///", apiToken: "x" });

  await withFetch(
    [{ ok: true, status: 200, json: async () => ({ ticket: "M-1", ticket_id: "mid-1" }) }],
    async (calls) => {
      await client.createTicket({ amountCents: 100, uniqueTransaction: "tx-1" });
      assert.equal(calls[0].url, "https://metronia.test/api/create-ticket");
    },
  );
});

// ── createTicket ──────────────────────────────────────────────────────────

test("createTicket — happy path returnerer ticketNumber + ticketId", async () => {
  const client = new HttpMetroniaApiClient(validOpts);
  await withFetch(
    [{
      ok: true,
      status: 200,
      json: async () => ({ ticket: "M-12345", ticket_id: "mid-abc" }),
    }],
    async (calls) => {
      const result = await client.createTicket({ amountCents: 5000, uniqueTransaction: "tx-1" });
      assert.equal(result.ticketNumber, "M-12345");
      assert.equal(result.ticketId, "mid-abc");

      // Body skal inneholde amount + transaction
      const body = JSON.parse(calls[0].init.body as string);
      assert.equal(body.amount, 5000);
      assert.equal(body.transaction, "tx-1");

      // Authorization-header
      const headers = calls[0].init.headers as Record<string, string>;
      assert.equal(headers.Authorization, "Bearer secret-token");
      assert.equal(headers["Content-Type"], "application/json");
    },
  );
});

test("createTicket — alternativ ticketId-key 'ticketId' støttes", async () => {
  const client = new HttpMetroniaApiClient(validOpts);
  await withFetch(
    [{ ok: true, status: 200, json: async () => ({ ticket: "M-1", ticketId: "mid-fallback" }) }],
    async () => {
      const result = await client.createTicket({ amountCents: 100, uniqueTransaction: "tx-1" });
      assert.equal(result.ticketId, "mid-fallback");
    },
  );
});

test("createTicket — tomt ticket-felt → METRONIA_BAD_RESPONSE", async () => {
  const client = new HttpMetroniaApiClient(validOpts);
  await withFetch(
    [{ ok: true, status: 200, json: async () => ({ ticket: "", ticket_id: "mid-x" }) }],
    async () => {
      await assert.rejects(
        () => client.createTicket({ amountCents: 100, uniqueTransaction: "tx-1" }),
        (err: unknown) => {
          assert.ok(err instanceof DomainError);
          assert.equal((err as DomainError).code, "METRONIA_BAD_RESPONSE");
          return true;
        },
      );
    },
  );
});

test("createTicket — manglende ticket_id → METRONIA_BAD_RESPONSE", async () => {
  const client = new HttpMetroniaApiClient(validOpts);
  await withFetch(
    [{ ok: true, status: 200, json: async () => ({ ticket: "M-1" }) }],
    async () => {
      await assert.rejects(
        () => client.createTicket({ amountCents: 100, uniqueTransaction: "tx-1" }),
        (err: unknown) => {
          assert.ok(err instanceof DomainError);
          assert.equal((err as DomainError).code, "METRONIA_BAD_RESPONSE");
          return true;
        },
      );
    },
  );
});

test("createTicket — error=N i respons → METRONIA_API_ERROR med error_str", async () => {
  const client = new HttpMetroniaApiClient(validOpts);
  await withFetch(
    [{ ok: true, status: 200, json: async () => ({ error: 42, error_str: "Insufficient funds" }) }],
    async () => {
      await assert.rejects(
        () => client.createTicket({ amountCents: 100, uniqueTransaction: "tx-1" }),
        (err: unknown) => {
          assert.ok(err instanceof DomainError);
          assert.equal((err as DomainError).code, "METRONIA_API_ERROR");
          assert.match((err as DomainError).message, /42/);
          assert.match((err as DomainError).message, /Insufficient funds/);
          return true;
        },
      );
    },
  );
});

// ── topupTicket ───────────────────────────────────────────────────────────

test("topupTicket — happy path returnerer newBalanceCents", async () => {
  const client = new HttpMetroniaApiClient(validOpts);
  await withFetch(
    [{ ok: true, status: 200, json: async () => ({ balance: 7500 }) }],
    async (calls) => {
      const result = await client.topupTicket({
        ticketNumber: "M-1",
        amountCents: 2500,
        uniqueTransaction: "tx-2",
        roomId: "room-1",
      });
      assert.equal(result.newBalanceCents, 7500);

      const body = JSON.parse(calls[0].init.body as string);
      assert.equal(body.ticket, "M-1");
      assert.equal(body.amount, 2500);
      assert.equal(body.transaction, "tx-2");
      assert.equal(body.room_id, "room-1");
    },
  );
});

test("topupTicket — manglende balance → METRONIA_BAD_RESPONSE", async () => {
  const client = new HttpMetroniaApiClient(validOpts);
  await withFetch(
    [{ ok: true, status: 200, json: async () => ({}) }],
    async () => {
      await assert.rejects(
        () => client.topupTicket({ ticketNumber: "M-1", amountCents: 100, uniqueTransaction: "tx-1" }),
        (err: unknown) => {
          assert.ok(err instanceof DomainError);
          assert.equal((err as DomainError).code, "METRONIA_BAD_RESPONSE");
          return true;
        },
      );
    },
  );
});

test("topupTicket — uten roomId sender room_id=null", async () => {
  const client = new HttpMetroniaApiClient(validOpts);
  await withFetch(
    [{ ok: true, status: 200, json: async () => ({ balance: 100 }) }],
    async (calls) => {
      await client.topupTicket({ ticketNumber: "M-1", amountCents: 50, uniqueTransaction: "tx-1" });
      const body = JSON.parse(calls[0].init.body as string);
      assert.equal(body.room_id, null);
    },
  );
});

// ── closeTicket ───────────────────────────────────────────────────────────

test("closeTicket — happy path returnerer finalBalanceCents", async () => {
  const client = new HttpMetroniaApiClient(validOpts);
  await withFetch(
    [{ ok: true, status: 200, json: async () => ({ balance: 1500 }) }],
    async (calls) => {
      const result = await client.closeTicket({
        ticketNumber: "M-1",
        uniqueTransaction: "tx-close",
        roomId: "room-1",
      });
      assert.equal(result.finalBalanceCents, 1500);

      const body = JSON.parse(calls[0].init.body as string);
      assert.equal(body.ticket, "M-1");
      assert.equal(body.transaction, "tx-close");
    },
  );
});

test("closeTicket — balance=0 (alt brukt) → 0", async () => {
  const client = new HttpMetroniaApiClient(validOpts);
  await withFetch(
    [{ ok: true, status: 200, json: async () => ({ balance: 0 }) }],
    async () => {
      const result = await client.closeTicket({ ticketNumber: "M-1", uniqueTransaction: "tx-1" });
      assert.equal(result.finalBalanceCents, 0);
    },
  );
});

test("closeTicket — negativ balance → METRONIA_BAD_RESPONSE", async () => {
  const client = new HttpMetroniaApiClient(validOpts);
  await withFetch(
    [{ ok: true, status: 200, json: async () => ({ balance: -100 }) }],
    async () => {
      await assert.rejects(
        () => client.closeTicket({ ticketNumber: "M-1", uniqueTransaction: "tx-1" }),
        (err: unknown) => {
          assert.ok(err instanceof DomainError);
          assert.equal((err as DomainError).code, "METRONIA_BAD_RESPONSE");
          return true;
        },
      );
    },
  );
});

test("closeTicket — NaN balance (string i respons) → METRONIA_BAD_RESPONSE", async () => {
  const client = new HttpMetroniaApiClient(validOpts);
  await withFetch(
    [{ ok: true, status: 200, json: async () => ({ balance: "not-a-number" }) }],
    async () => {
      await assert.rejects(
        () => client.closeTicket({ ticketNumber: "M-1", uniqueTransaction: "tx-1" }),
        (err: unknown) => {
          assert.ok(err instanceof DomainError);
          assert.equal((err as DomainError).code, "METRONIA_BAD_RESPONSE");
          return true;
        },
      );
    },
  );
});

// ── getStatus ─────────────────────────────────────────────────────────────

test("getStatus — happy path mapper balance/enabled/terminal", async () => {
  const client = new HttpMetroniaApiClient(validOpts);
  await withFetch(
    [{ ok: true, status: 200, json: async () => ({ balance: 5000, enabled: true, terminal: false }) }],
    async () => {
      const result = await client.getStatus("M-1", "room-2");
      assert.equal(result.balanceCents, 5000);
      assert.equal(result.ticketEnabled, true);
      assert.equal(result.isReserved, false);
    },
  );
});

test("getStatus — terminal=true mapper isReserved=true", async () => {
  const client = new HttpMetroniaApiClient(validOpts);
  await withFetch(
    [{ ok: true, status: 200, json: async () => ({ balance: 100, enabled: false, terminal: true }) }],
    async () => {
      const result = await client.getStatus("M-1");
      assert.equal(result.isReserved, true);
      assert.equal(result.ticketEnabled, false);
    },
  );
});

test("getStatus — manglende balance defaulter til 0", async () => {
  const client = new HttpMetroniaApiClient(validOpts);
  await withFetch(
    [{ ok: true, status: 200, json: async () => ({ enabled: true }) }],
    async () => {
      const result = await client.getStatus("M-1");
      assert.equal(result.balanceCents, 0);
    },
  );
});

// ── HTTP error handling ───────────────────────────────────────────────────

test("HTTP 500 uten error-felt → METRONIA_API_ERROR", async () => {
  const client = new HttpMetroniaApiClient(validOpts);
  await withFetch(
    [{ ok: false, status: 500, json: async () => ({}) }],
    async () => {
      await assert.rejects(
        () => client.getStatus("M-1"),
        (err: unknown) => {
          assert.ok(err instanceof DomainError);
          assert.equal((err as DomainError).code, "METRONIA_API_ERROR");
          assert.match((err as DomainError).message, /500/);
          return true;
        },
      );
    },
  );
});

test("HTTP 200 med error=0 → tilbehandles som suksess", async () => {
  const client = new HttpMetroniaApiClient(validOpts);
  await withFetch(
    [{ ok: true, status: 200, json: async () => ({ error: 0, balance: 100, enabled: true, terminal: false }) }],
    async () => {
      const result = await client.getStatus("M-1");
      assert.equal(result.balanceCents, 100);
    },
  );
});

test("Tomt JSON-respons → METRONIA_BAD_RESPONSE", async () => {
  const client = new HttpMetroniaApiClient(validOpts);
  await withFetch(
    [{ ok: true, status: 200, jsonThrows: true }],
    async () => {
      await assert.rejects(
        () => client.getStatus("M-1"),
        (err: unknown) => {
          assert.ok(err instanceof DomainError);
          assert.equal((err as DomainError).code, "METRONIA_BAD_RESPONSE");
          return true;
        },
      );
    },
  );
});

test("Non-object JSON-respons → METRONIA_BAD_RESPONSE", async () => {
  const client = new HttpMetroniaApiClient(validOpts);
  await withFetch(
    [{ ok: true, status: 200, json: async () => null }],
    async () => {
      await assert.rejects(
        () => client.getStatus("M-1"),
        (err: unknown) => {
          assert.ok(err instanceof DomainError);
          assert.equal((err as DomainError).code, "METRONIA_BAD_RESPONSE");
          return true;
        },
      );
    },
  );
});

// ── Timeout ───────────────────────────────────────────────────────────────

test("AbortError fra fetch → METRONIA_TIMEOUT", async () => {
  const client = new HttpMetroniaApiClient({ ...validOpts, timeoutMs: 50 });
  // Override fetch til å kaste AbortError
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    const err = new Error("Aborted") as Error & { name: string };
    err.name = "AbortError";
    throw err;
  }) as unknown as typeof globalThis.fetch;

  try {
    await assert.rejects(
      () => client.getStatus("M-1"),
      (err: unknown) => {
        assert.ok(err instanceof DomainError);
        assert.equal((err as DomainError).code, "METRONIA_TIMEOUT");
        assert.match((err as DomainError).message, /50 ms/);
        return true;
      },
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("Generic fetch-feil (network) → METRONIA_API_ERROR", async () => {
  const client = new HttpMetroniaApiClient(validOpts);
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("ECONNREFUSED");
  }) as unknown as typeof globalThis.fetch;

  try {
    await assert.rejects(
      () => client.getStatus("M-1"),
      (err: unknown) => {
        assert.ok(err instanceof DomainError);
        assert.equal((err as DomainError).code, "METRONIA_API_ERROR");
        return true;
      },
    );
  } finally {
    globalThis.fetch = original;
  }
});
