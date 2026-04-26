/**
 * REQ-132: tester for SessionService.
 *
 * Bruker in-memory pg.Pool-stub som simulerer `app_sessions`-tabellen.
 * Dekker:
 *   - listActiveSessions (filter på user + active + isCurrent)
 *   - logoutSession (per-id, eier-sjekk)
 *   - logoutAll (med og uten exceptAccessToken)
 *   - touchActivity (throttle + 30-min inactivity-timeout som kaster
 *     SESSION_TIMED_OUT og revoker raden)
 *   - recordLogin (skriver user-agent + ip)
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { SessionService } from "../SessionService.js";
import { DomainError } from "../../game/BingoEngine.js";

interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
  device_user_agent: string | null;
  ip_address: string | null;
  last_activity_at: Date;
  created_at: Date;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function makeStore(): Map<string, SessionRow> {
  return new Map();
}

function makePool(store: Map<string, SessionRow>): Pool {
  // Vi forenkler — pool.query kalles for alle handlinger. Pool.connect
  // brukes ikke av SessionService, så vi trenger ikke implementere det.
  const pool = {
    async query(sql: string, params: unknown[] = []) {
      const trimmed = sql.trim();
      // ── SELECT for touchActivity / listActive ──
      if (trimmed.startsWith("SELECT id, last_activity_at, revoked_at")) {
        const [tokenHash] = params as [string];
        const row = [...store.values()].find((r) => r.token_hash === tokenHash);
        return row
          ? {
              rows: [
                {
                  id: row.id,
                  last_activity_at: row.last_activity_at,
                  revoked_at: row.revoked_at,
                },
              ],
              rowCount: 1,
            }
          : { rows: [], rowCount: 0 };
      }
      if (trimmed.startsWith("SELECT id, user_id, device_user_agent")) {
        const [userId] = params as [string];
        const now = Date.now();
        const rows = [...store.values()]
          .filter(
            (r) =>
              r.user_id === userId &&
              r.revoked_at === null &&
              r.expires_at.getTime() > now
          )
          .sort(
            (a, b) =>
              b.last_activity_at.getTime() - a.last_activity_at.getTime()
          );
        return {
          rows: rows.map((r) => ({
            id: r.id,
            user_id: r.user_id,
            device_user_agent: r.device_user_agent,
            ip_address: r.ip_address,
            last_activity_at: r.last_activity_at,
            created_at: r.created_at,
            expires_at: r.expires_at,
            token_hash: r.token_hash,
          })),
          rowCount: rows.length,
        };
      }
      // ── UPDATE-varianter ──
      if (trimmed.startsWith("UPDATE")) {
        // recordLogin
        if (sql.includes("device_user_agent = $2")) {
          const [tokenHash, ua, ip] = params as [string, string | null, string | null];
          const row = [...store.values()].find((r) => r.token_hash === tokenHash);
          if (row) {
            row.device_user_agent = ua;
            row.ip_address = ip;
            row.last_activity_at = new Date();
            return { rows: [], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        }
        // touch — last_activity_at = now() WHERE id = $1
        if (sql.includes("SET last_activity_at = now()") && sql.includes("WHERE id = $1")) {
          const [id] = params as [string];
          const row = store.get(id);
          if (row) {
            row.last_activity_at = new Date();
            return { rows: [], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        }
        // touch revoke — revoked_at = now() WHERE id = $1 AND revoked_at IS NULL
        if (
          sql.includes("SET revoked_at = now()") &&
          sql.includes("WHERE id = $1 AND revoked_at IS NULL")
        ) {
          const [id] = params as [string];
          const row = store.get(id);
          if (row && row.revoked_at === null) {
            row.revoked_at = new Date();
            return { rows: [], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        }
        // logoutSession — WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
        if (sql.includes("WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL")) {
          const [id, userId] = params as [string, string];
          const row = store.get(id);
          if (row && row.user_id === userId && row.revoked_at === null) {
            row.revoked_at = new Date();
            return { rows: [], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        }
        // logoutAll med except — token_hash <> $2
        if (sql.includes("token_hash <> $2")) {
          const [userId, exceptHash] = params as [string, string];
          let count = 0;
          for (const row of store.values()) {
            if (
              row.user_id === userId &&
              row.revoked_at === null &&
              row.token_hash !== exceptHash
            ) {
              row.revoked_at = new Date();
              count++;
            }
          }
          return { rows: [], rowCount: count };
        }
        // logoutAll alle — WHERE user_id = $1 AND revoked_at IS NULL
        if (sql.includes("WHERE user_id = $1 AND revoked_at IS NULL")) {
          const [userId] = params as [string];
          let count = 0;
          for (const row of store.values()) {
            if (row.user_id === userId && row.revoked_at === null) {
              row.revoked_at = new Date();
              count++;
            }
          }
          return { rows: [], rowCount: count };
        }
      }
      throw new Error(`unhandled SQL: ${trimmed.slice(0, 120)}`);
    },
  };
  return pool as unknown as Pool;
}

function insertSession(
  store: Map<string, SessionRow>,
  input: {
    id: string;
    userId: string;
    accessToken: string;
    lastActivityAt?: Date;
    expiresAt?: Date;
    revokedAt?: Date | null;
    userAgent?: string | null;
    ip?: string | null;
  }
): void {
  store.set(input.id, {
    id: input.id,
    user_id: input.userId,
    token_hash: hashToken(input.accessToken),
    expires_at: input.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    revoked_at: input.revokedAt ?? null,
    device_user_agent: input.userAgent ?? null,
    ip_address: input.ip ?? null,
    last_activity_at: input.lastActivityAt ?? new Date(),
    created_at: new Date(Date.now() - 60_000),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────

test("REQ-132: listActiveSessions returnerer kun aktive sesjoner med isCurrent-flagg", async () => {
  const store = makeStore();
  insertSession(store, { id: "s1", userId: "u1", accessToken: "tok-current" });
  insertSession(store, { id: "s2", userId: "u1", accessToken: "tok-other" });
  insertSession(store, {
    id: "s3",
    userId: "u1",
    accessToken: "tok-revoked",
    revokedAt: new Date(),
  });
  // Sesjon for annen bruker — skal ignoreres.
  insertSession(store, { id: "s4", userId: "u2", accessToken: "tok-other-user" });

  const svc = SessionService.forTesting(makePool(store));
  const sessions = await svc.listActiveSessions({
    userId: "u1",
    currentAccessToken: "tok-current",
  });
  assert.equal(sessions.length, 2);
  const current = sessions.find((s) => s.id === "s1");
  const other = sessions.find((s) => s.id === "s2");
  assert.equal(current?.isCurrent, true);
  assert.equal(other?.isCurrent, false);
});

test("REQ-132: logoutAll uten except revoker alle aktive", async () => {
  const store = makeStore();
  insertSession(store, { id: "s1", userId: "u1", accessToken: "t1" });
  insertSession(store, { id: "s2", userId: "u1", accessToken: "t2" });
  insertSession(store, { id: "s3", userId: "u1", accessToken: "t3" });

  const svc = SessionService.forTesting(makePool(store));
  const result = await svc.logoutAll({ userId: "u1" });
  assert.equal(result.count, 3);
  for (const row of store.values()) {
    assert.notEqual(row.revoked_at, null);
  }
});

test("REQ-132: logoutAll med exceptAccessToken beholder gjeldende sesjon", async () => {
  const store = makeStore();
  insertSession(store, { id: "s1", userId: "u1", accessToken: "current-token" });
  insertSession(store, { id: "s2", userId: "u1", accessToken: "old-token-1" });
  insertSession(store, { id: "s3", userId: "u1", accessToken: "old-token-2" });

  const svc = SessionService.forTesting(makePool(store));
  const result = await svc.logoutAll({
    userId: "u1",
    exceptAccessToken: "current-token",
  });
  assert.equal(result.count, 2);
  assert.equal(store.get("s1")!.revoked_at, null); // beholdt
  assert.notEqual(store.get("s2")!.revoked_at, null);
  assert.notEqual(store.get("s3")!.revoked_at, null);
});

test("REQ-132: logoutSession krever at brukeren eier sesjonen", async () => {
  const store = makeStore();
  insertSession(store, { id: "s1", userId: "u1", accessToken: "t1" });
  const svc = SessionService.forTesting(makePool(store));
  // Annen bruker forsøker å revoker — skal kaste.
  await assert.rejects(
    () => svc.logoutSession({ userId: "u2", sessionId: "s1" }),
    (err: unknown) => err instanceof DomainError && err.code === "SESSION_NOT_FOUND"
  );
  assert.equal(store.get("s1")!.revoked_at, null);
  // Eier kan revoker.
  await svc.logoutSession({ userId: "u1", sessionId: "s1" });
  assert.notEqual(store.get("s1")!.revoked_at, null);
});

test("REQ-132: touchActivity revoker sesjon når 30-min inaktivitet er overskredet", async () => {
  const store = makeStore();
  // Sesjonen har vært inaktiv i 31 minutter.
  insertSession(store, {
    id: "s1",
    userId: "u1",
    accessToken: "old-token",
    lastActivityAt: new Date(Date.now() - 31 * 60 * 1000),
  });
  const svc = SessionService.forTesting(makePool(store));
  await assert.rejects(
    () => svc.touchActivity("old-token"),
    (err: unknown) => err instanceof DomainError && err.code === "SESSION_TIMED_OUT"
  );
  // Sesjonen er nå revoked.
  assert.notEqual(store.get("s1")!.revoked_at, null);
});

test("REQ-132: touchActivity oppdaterer last_activity_at hvis > 60s siden", async () => {
  const store = makeStore();
  const oldActivity = new Date(Date.now() - 70_000); // 70s siden
  insertSession(store, {
    id: "s1",
    userId: "u1",
    accessToken: "tok",
    lastActivityAt: oldActivity,
  });
  const svc = SessionService.forTesting(makePool(store));
  await svc.touchActivity("tok");
  assert.ok(store.get("s1")!.last_activity_at.getTime() > oldActivity.getTime());
});

test("REQ-132: touchActivity er en no-op hvis sesjonen er ukjent", async () => {
  const store = makeStore();
  const svc = SessionService.forTesting(makePool(store));
  // Skal ikke kaste — auth-middlewareen håndterer ukjent token via
  // getUserFromAccessToken senere.
  await svc.touchActivity("ukjent-token");
});

test("REQ-132: touchActivity er throttled (oppdaterer ikke under 60s)", async () => {
  const store = makeStore();
  const recentActivity = new Date(Date.now() - 30_000); // 30s siden
  insertSession(store, {
    id: "s1",
    userId: "u1",
    accessToken: "tok",
    lastActivityAt: recentActivity,
  });
  const svc = SessionService.forTesting(makePool(store));
  await svc.touchActivity("tok");
  // last_activity_at skal IKKE være endret (throttle).
  assert.equal(
    store.get("s1")!.last_activity_at.getTime(),
    recentActivity.getTime()
  );
});

test("REQ-132: recordLogin persister user-agent og ip-adresse", async () => {
  const store = makeStore();
  insertSession(store, { id: "s1", userId: "u1", accessToken: "tok" });
  const svc = SessionService.forTesting(makePool(store));
  await svc.recordLogin({
    accessToken: "tok",
    userAgent: "Mozilla/5.0 Test",
    ipAddress: "192.0.2.1",
  });
  const row = store.get("s1")!;
  assert.equal(row.device_user_agent, "Mozilla/5.0 Test");
  assert.equal(row.ip_address, "192.0.2.1");
});

test("REQ-132: recordLogin trim-er user-agent til 500 tegn", async () => {
  const store = makeStore();
  insertSession(store, { id: "s1", userId: "u1", accessToken: "tok" });
  const svc = SessionService.forTesting(makePool(store));
  const longUa = "A".repeat(800);
  await svc.recordLogin({ accessToken: "tok", userAgent: longUa, ipAddress: null });
  assert.equal(store.get("s1")!.device_user_agent?.length, 500);
});
