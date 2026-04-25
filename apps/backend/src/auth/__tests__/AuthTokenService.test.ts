/**
 * BIN-587 B2.1: unit-tester for AuthTokenService.
 *
 * Bruker en minimal pg.Pool-stub som oppfører seg som en in-memory
 * butikk for de to token-tabellene. Dekker happy-path (create → validate
 * → consume), utløp, reuse-avvisning, invalidering ved re-issue, og
 * feil-input.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { AuthTokenService, type AuthTokenKind } from "../AuthTokenService.js";
import { DomainError } from "../../game/BingoEngine.js";

interface Row {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  used_at: Date | null;
  created_at: Date;
}

interface Store {
  "password-reset": Map<string, Row>;
  "email-verify": Map<string, Row>;
}

function detectKind(sql: string): AuthTokenKind {
  if (sql.includes("app_password_reset_tokens")) return "password-reset";
  if (sql.includes("app_email_verify_tokens")) return "email-verify";
  throw new Error(`cannot detect kind from SQL: ${sql.slice(0, 80)}`);
}

function runQuery(store: Store, sql: string, params: unknown[] = []): { rows: Row[]; rowCount: number } {
  const trimmed = sql.trim();
  if (trimmed.startsWith("INSERT")) {
    const kind = detectKind(sql);
    const [id, userId, tokenHash, expiresAt] = params as [string, string, string, string];
    const row: Row = {
      id,
      user_id: userId,
      token_hash: tokenHash,
      expires_at: new Date(expiresAt),
      used_at: null,
      created_at: new Date(),
    };
    store[kind].set(id, row);
    return { rows: [], rowCount: 1 };
  }
  if (trimmed.startsWith("SELECT")) {
    const kind = detectKind(sql);
    const [tokenHash] = params as [string];
    const hit = [...store[kind].values()].find((r) => r.token_hash === tokenHash);
    return { rows: hit ? [hit] : [], rowCount: hit ? 1 : 0 };
  }
  if (trimmed.startsWith("UPDATE")) {
    const kind = detectKind(sql);
    // Two UPDATE-varianter:
    //   1) UPDATE ... SET used_at = now() WHERE user_id = $1 AND used_at IS NULL  (invalidate prev)
    //   2) UPDATE ... SET used_at = now() WHERE id = $1 AND used_at IS NULL      (consume)
    if (sql.includes("WHERE user_id = $1")) {
      const [userId] = params as [string];
      let count = 0;
      for (const row of store[kind].values()) {
        if (row.user_id === userId && row.used_at === null) {
          row.used_at = new Date();
          count++;
        }
      }
      return { rows: [], rowCount: count };
    }
    if (sql.includes("WHERE id = $1")) {
      const [id] = params as [string];
      const row = store[kind].get(id);
      if (row && row.used_at === null) {
        row.used_at = new Date();
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
  }
  if (trimmed.startsWith("BEGIN") || trimmed.startsWith("COMMIT") || trimmed.startsWith("ROLLBACK")) {
    return { rows: [], rowCount: 0 };
  }
  throw new Error(`unhandled SQL: ${trimmed.slice(0, 120)}`);
}

function makePool(store: Store): Pool {
  const pool = {
    async connect() {
      return {
        async query(sql: string, params?: unknown[]) {
          return runQuery(store, sql, params ?? []);
        },
        release() {
          // noop
        },
      };
    },
    async query(sql: string, params?: unknown[]) {
      return runQuery(store, sql, params ?? []);
    },
  };
  return pool as unknown as Pool;
}

function newStore(): Store {
  return {
    "password-reset": new Map(),
    "email-verify": new Map(),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

test("BIN-587 B2.1: createToken + validate + consume happy-path (password-reset)", async () => {
  const store = newStore();
  const svc = AuthTokenService.forTesting(makePool(store));
  const { token, expiresAt } = await svc.createToken("password-reset", "user-1");
  assert.ok(token.length > 20);
  assert.ok(new Date(expiresAt).getTime() > Date.now());
  assert.equal(store["password-reset"].size, 1);

  const { userId, tokenId } = await svc.validate("password-reset", token);
  assert.equal(userId, "user-1");
  assert.ok(tokenId);

  await svc.consume("password-reset", tokenId);
  // Etter consume skal validate avvise den samme tokenet:
  await assert.rejects(
    () => svc.validate("password-reset", token),
    (err: unknown) => err instanceof DomainError && err.code === "TOKEN_ALREADY_USED"
  );
});

test("BIN-587 B2.1: email-verify uses separate table", async () => {
  const store = newStore();
  const svc = AuthTokenService.forTesting(makePool(store));
  await svc.createToken("password-reset", "user-1");
  await svc.createToken("email-verify", "user-1");
  assert.equal(store["password-reset"].size, 1);
  assert.equal(store["email-verify"].size, 1);
});

test("BIN-587 B2.1: re-issue ugyldiggjør tidligere aktive tokens", async () => {
  const store = newStore();
  const svc = AuthTokenService.forTesting(makePool(store));
  const first = await svc.createToken("password-reset", "user-1");
  const second = await svc.createToken("password-reset", "user-1");
  // Første token er nå brukt (used_at satt av re-issue-mekanismen).
  await assert.rejects(
    () => svc.validate("password-reset", first.token),
    (err: unknown) => err instanceof DomainError && err.code === "TOKEN_ALREADY_USED"
  );
  // Andre token fortsatt gyldig.
  const { userId } = await svc.validate("password-reset", second.token);
  assert.equal(userId, "user-1");
});

test("BIN-587 B2.1: utløpt token avvises", async () => {
  const store = newStore();
  const svc = AuthTokenService.forTesting(makePool(store), "public", {
    passwordReset: 1, // 1 ms TTL
  });
  const { token } = await svc.createToken("password-reset", "user-1");
  // Vent litt så det er garantert utløpt
  await new Promise((r) => setTimeout(r, 5));
  await assert.rejects(
    () => svc.validate("password-reset", token),
    (err: unknown) => err instanceof DomainError && err.code === "TOKEN_EXPIRED"
  );
});

test("BIN-587 B2.1: ukjent token gir INVALID_TOKEN", async () => {
  const store = newStore();
  const svc = AuthTokenService.forTesting(makePool(store));
  await assert.rejects(
    () => svc.validate("password-reset", "bogus-token-123"),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_TOKEN"
  );
});

test("BIN-587 B2.1: tomt userId avvises", async () => {
  const store = newStore();
  const svc = AuthTokenService.forTesting(makePool(store));
  await assert.rejects(
    () => svc.createToken("password-reset", ""),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
});

test("BIN-587 B2.1: tomt token avvises i validate", async () => {
  const store = newStore();
  const svc = AuthTokenService.forTesting(makePool(store));
  await assert.rejects(
    () => svc.validate("password-reset", ""),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_TOKEN"
  );
});

test("BIN-587 B2.1: consume er idempotent — andre kall feiler", async () => {
  const store = newStore();
  const svc = AuthTokenService.forTesting(makePool(store));
  const { token } = await svc.createToken("password-reset", "user-1");
  const { tokenId } = await svc.validate("password-reset", token);
  await svc.consume("password-reset", tokenId);
  await assert.rejects(
    () => svc.consume("password-reset", tokenId),
    (err: unknown) => err instanceof DomainError && err.code === "TOKEN_ALREADY_USED"
  );
});

test("BIN-587 B2.1: tokens lagres aldri i klartekst (kun sha256-hash)", async () => {
  const store = newStore();
  const svc = AuthTokenService.forTesting(makePool(store));
  const { token } = await svc.createToken("password-reset", "user-1");
  const stored = [...store["password-reset"].values()][0]!;
  assert.notEqual(stored.token_hash, token);
  assert.equal(stored.token_hash.length, 64); // sha256 hex
});

test("BIN-702 follow-up: createToken aksepterer ttlMs-override (Excel-import-velkomst)", async () => {
  const store = newStore();
  // Default password-reset-TTL er 1 time; vi overstyrer til 7 dager.
  const svc = AuthTokenService.forTesting(makePool(store));
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const before = Date.now();
  const { expiresAt } = await svc.createToken("password-reset", "user-1", {
    ttlMs: sevenDaysMs,
  });
  const after = Date.now();
  const expiresMs = new Date(expiresAt).getTime();
  // Toleranse: TTL skal lande innenfor [before+ttl, after+ttl]
  assert.ok(expiresMs >= before + sevenDaysMs);
  assert.ok(expiresMs <= after + sevenDaysMs + 100);
});

test("BIN-702 follow-up: createToken med ttlMs=0 eller negativ avvises", async () => {
  const store = newStore();
  const svc = AuthTokenService.forTesting(makePool(store));
  await assert.rejects(
    () => svc.createToken("password-reset", "user-1", { ttlMs: 0 }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
  await assert.rejects(
    () => svc.createToken("password-reset", "user-1", { ttlMs: -1 }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
});

test("BIN-702 follow-up: createToken uten ttlMs-override bruker konstruktor-TTL", async () => {
  const store = newStore();
  // Konstruktor-TTL er 1 time (default).
  const svc = AuthTokenService.forTesting(makePool(store));
  const oneHourMs = 60 * 60 * 1000;
  const before = Date.now();
  const { expiresAt } = await svc.createToken("password-reset", "user-1");
  const after = Date.now();
  const expiresMs = new Date(expiresAt).getTime();
  assert.ok(expiresMs >= before + oneHourMs - 50);
  assert.ok(expiresMs <= after + oneHourMs + 50);
});
