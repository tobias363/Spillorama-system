/**
 * BIN-587 B3-security: unit-tester for SecurityService.
 *
 * Dekker validering, in-memory cache for blocked-IPs (TTL + invalidering
 * ved mutasjon), og fail-open ved DB-feil.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { SecurityService } from "../SecurityService.js";
import { DomainError } from "../../game/BingoEngine.js";

interface EmailRow { id: string; email: string; label: string | null; added_by: string | null; created_at: Date }
interface CountryRow { country_code: string; label: string; reason: string | null; added_by: string | null; created_at: Date }
interface IpRow { id: string; ip_address: string; reason: string | null; blocked_by: string | null; expires_at: Date | null; created_at: Date }

interface Store {
  emails: Map<string, EmailRow>;  // by id
  emailsByEmail: Set<string>;     // uniqueness check
  countries: Map<string, CountryRow>; // by code
  ips: Map<string, IpRow>;            // by id
  ipsByAddress: Set<string>;          // uniqueness
}

function newStore(): Store {
  return { emails: new Map(), emailsByEmail: new Set(), countries: new Map(), ips: new Map(), ipsByAddress: new Set() };
}

function runQuery(store: Store, sql: string, params: unknown[] = [], nowMs: () => number = () => Date.now()): { rows: unknown[]; rowCount: number } {
  const t = sql.trim();
  if (t.startsWith("BEGIN") || t.startsWith("COMMIT") || t.startsWith("ROLLBACK") || t.startsWith("CREATE")) {
    return { rows: [], rowCount: 0 };
  }
  const isEmails = sql.includes("app_withdraw_email_allowlist");
  const isCountries = sql.includes("app_risk_countries");
  const isIps = sql.includes("app_blocked_ips");

  if (t.startsWith("SELECT") && isEmails) {
    const rows = [...store.emails.values()].sort((a, b) => a.email.localeCompare(b.email));
    return { rows, rowCount: rows.length };
  }
  if (t.startsWith("SELECT") && isCountries) {
    const rows = [...store.countries.values()].sort((a, b) => a.country_code.localeCompare(b.country_code));
    return { rows, rowCount: rows.length };
  }
  if (t.startsWith("SELECT") && isIps) {
    // Partial-index query: WHERE expires_at IS NULL OR expires_at > now()
    if (sql.includes("WHERE expires_at IS NULL OR expires_at > now()")) {
      const now = nowMs();
      const active = [...store.ips.values()].filter((r) => !r.expires_at || r.expires_at.getTime() > now);
      return { rows: active.map((r) => ({ ip_address: r.ip_address })), rowCount: active.length };
    }
    const rows = [...store.ips.values()].sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
    return { rows, rowCount: rows.length };
  }

  if (t.startsWith("INSERT") && isEmails) {
    const [id, email, label, addedBy] = params as [string, string, string | null, string | null];
    if (store.emailsByEmail.has(email)) {
      const err = new Error("duplicate key value violates unique constraint");
      throw err;
    }
    const row: EmailRow = { id, email, label, added_by: addedBy, created_at: new Date(nowMs()) };
    store.emails.set(id, row);
    store.emailsByEmail.add(email);
    return { rows: [row], rowCount: 1 };
  }
  if (t.startsWith("INSERT") && isCountries) {
    const [code, label, reason, addedBy] = params as [string, string, string | null, string | null];
    if (store.countries.has(code)) {
      throw new Error("duplicate key value violates unique constraint");
    }
    const row: CountryRow = { country_code: code, label, reason, added_by: addedBy, created_at: new Date(nowMs()) };
    store.countries.set(code, row);
    return { rows: [row], rowCount: 1 };
  }
  if (t.startsWith("INSERT") && isIps) {
    const [id, ip, reason, blockedBy, expiresAt] = params as [string, string, string | null, string | null, string | null];
    if (store.ipsByAddress.has(ip)) {
      throw new Error("duplicate key value violates unique constraint");
    }
    const row: IpRow = {
      id, ip_address: ip, reason, blocked_by: blockedBy,
      expires_at: expiresAt ? new Date(expiresAt) : null, created_at: new Date(nowMs()),
    };
    store.ips.set(id, row);
    store.ipsByAddress.add(ip);
    return { rows: [row], rowCount: 1 };
  }

  if (t.startsWith("DELETE") && isEmails) {
    const [id] = params as [string];
    const row = store.emails.get(id);
    if (!row) return { rows: [], rowCount: 0 };
    store.emails.delete(id);
    store.emailsByEmail.delete(row.email);
    return { rows: [], rowCount: 1 };
  }
  if (t.startsWith("DELETE") && isCountries) {
    const [code] = params as [string];
    const existed = store.countries.delete(code);
    return { rows: [], rowCount: existed ? 1 : 0 };
  }
  if (t.startsWith("DELETE") && isIps) {
    const [id] = params as [string];
    const row = store.ips.get(id);
    if (!row) return { rows: [], rowCount: 0 };
    store.ips.delete(id);
    store.ipsByAddress.delete(row.ip_address);
    return { rows: [], rowCount: 1 };
  }

  throw new Error(`unhandled SQL: ${t.slice(0, 120)}`);
}

function makePool(store: Store, nowMs?: () => number): Pool {
  const pool = {
    async connect() {
      return {
        async query(sql: string, params?: unknown[]) { return runQuery(store, sql, params ?? [], nowMs); },
        release() {},
      };
    },
    async query(sql: string, params?: unknown[]) { return runQuery(store, sql, params ?? [], nowMs); },
  };
  return pool as unknown as Pool;
}

// ── Tests ────────────────────────────────────────────────────────────────

test("BIN-587 B3-security: addWithdrawEmail normaliserer case + rejecter duplikat", async () => {
  const store = newStore();
  const svc = SecurityService.forTesting(makePool(store));
  const created = await svc.addWithdrawEmail({ email: "REVISOR@Firma.NO", addedBy: "admin-1" });
  assert.equal(created.email, "revisor@firma.no");
  await assert.rejects(
    () => svc.addWithdrawEmail({ email: "revisor@firma.no", addedBy: "admin-1" }),
    (err: unknown) => err instanceof DomainError && err.code === "WITHDRAW_EMAIL_EXISTS"
  );
});

test("BIN-587 B3-security: addWithdrawEmail avviser ugyldig format", async () => {
  const store = newStore();
  const svc = SecurityService.forTesting(makePool(store));
  await assert.rejects(
    () => svc.addWithdrawEmail({ email: "ikke-en-email", addedBy: "admin-1" }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
});

test("BIN-587 B3-security: deleteWithdrawEmail rejecter ukjent id", async () => {
  const store = newStore();
  const svc = SecurityService.forTesting(makePool(store));
  await assert.rejects(
    () => svc.deleteWithdrawEmail("ghost"),
    (err: unknown) => err instanceof DomainError && err.code === "WITHDRAW_EMAIL_NOT_FOUND"
  );
});

test("BIN-587 B3-security: addRiskCountry normaliserer ISO-kode til uppercase", async () => {
  const store = newStore();
  const svc = SecurityService.forTesting(makePool(store));
  const created = await svc.addRiskCountry({ countryCode: "no", label: "Norge", addedBy: "admin-1" });
  assert.equal(created.countryCode, "NO");
});

test("BIN-587 B3-security: addRiskCountry avviser ugyldig kode-format", async () => {
  const store = newStore();
  const svc = SecurityService.forTesting(makePool(store));
  await assert.rejects(
    () => svc.addRiskCountry({ countryCode: "NOR", label: "x", addedBy: "admin-1" }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
  await assert.rejects(
    () => svc.addRiskCountry({ countryCode: "1A", label: "x", addedBy: "admin-1" }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
});

test("BIN-587 B3-security: removeRiskCountry rejecter ukjent kode", async () => {
  const store = newStore();
  const svc = SecurityService.forTesting(makePool(store));
  await assert.rejects(
    () => svc.removeRiskCountry("XX"),
    (err: unknown) => err instanceof DomainError && err.code === "RISK_COUNTRY_NOT_FOUND"
  );
});

test("BIN-587 B3-security: addBlockedIp validerer IPv4 + IPv6", async () => {
  const store = newStore();
  const svc = SecurityService.forTesting(makePool(store));
  const v4 = await svc.addBlockedIp({ ipAddress: "10.0.0.1", blockedBy: "admin-1" });
  assert.equal(v4.ipAddress, "10.0.0.1");
  const v6 = await svc.addBlockedIp({ ipAddress: "2001:db8::1", blockedBy: "admin-1" });
  assert.equal(v6.ipAddress, "2001:db8::1");
  await assert.rejects(
    () => svc.addBlockedIp({ ipAddress: "not-an-ip", blockedBy: "admin-1" }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
});

test("BIN-587 B3-security: addBlockedIp avviser duplikat", async () => {
  const store = newStore();
  const svc = SecurityService.forTesting(makePool(store));
  await svc.addBlockedIp({ ipAddress: "10.0.0.1", blockedBy: "admin-1" });
  await assert.rejects(
    () => svc.addBlockedIp({ ipAddress: "10.0.0.1", blockedBy: "admin-1" }),
    (err: unknown) => err instanceof DomainError && err.code === "BLOCKED_IP_EXISTS"
  );
});

test("BIN-587 B3-security: isIpBlocked bruker cache + invalideres ved add/remove", async () => {
  const store = newStore();
  const svc = SecurityService.forTesting(makePool(store), { cacheTtlMs: 60000 });
  assert.equal(await svc.isIpBlocked("10.0.0.1"), false);
  // Add → cache skal bli invalidert → neste sjekk returnerer true
  await svc.addBlockedIp({ ipAddress: "10.0.0.1", blockedBy: "admin-1" });
  assert.equal(await svc.isIpBlocked("10.0.0.1"), true);
  // Remove via id → cache invalideres → false
  const listed = await svc.listBlockedIps();
  await svc.removeBlockedIp(listed[0]!.id);
  assert.equal(await svc.isIpBlocked("10.0.0.1"), false);
});

test("BIN-587 B3-security: isIpBlocked respekterer expires_at (filtrerer utløpte)", async () => {
  const store = newStore();
  let currentMs = Date.UTC(2026, 3, 18, 12, 0, 0);
  const svc = SecurityService.forTesting(makePool(store, () => currentMs), {
    cacheTtlMs: 60000,
    nowMs: () => currentMs,
  });
  // Blokker med utløp 1 time fram
  await svc.addBlockedIp({
    ipAddress: "10.0.0.1",
    blockedBy: "admin-1",
    expiresAt: new Date(currentMs + 60 * 60 * 1000).toISOString(),
  });
  assert.equal(await svc.isIpBlocked("10.0.0.1"), true);
  // Hopp tiden 2 timer frem + invalider cache manuelt (normalt ved TTL)
  currentMs += 2 * 60 * 60 * 1000;
  // Force cache-refresh ved å la TTL gå ut
  (svc as unknown as { blockedIpCacheLoadedAt: number }).blockedIpCacheLoadedAt = 0;
  assert.equal(await svc.isIpBlocked("10.0.0.1"), false);
});

test("BIN-587 B3-security: isIpBlocked bruker cache innenfor TTL uten ny DB-spørring", async () => {
  const store = newStore();
  let currentMs = 1_000_000;
  let queryCount = 0;
  const basePool = makePool(store, () => currentMs);
  // Wrap pool.query for å telle SELECT på ips-tabellen
  const originalQuery = basePool.query.bind(basePool);
  (basePool as unknown as { query: Function }).query = async (sql: string, params?: unknown[]) => {
    if (sql.includes("app_blocked_ips") && sql.trim().startsWith("SELECT")) queryCount++;
    return originalQuery(sql, params);
  };
  const svc = SecurityService.forTesting(basePool, {
    cacheTtlMs: 5 * 60 * 1000, // 5 min
    nowMs: () => currentMs,
  });
  await svc.addBlockedIp({ ipAddress: "10.0.0.1", blockedBy: "admin-1" });
  // Etter add invalideres cachen — reset teller
  queryCount = 0;
  // 100 oppslag innenfor TTL → bør kun trigge én DB-spørring
  for (let i = 0; i < 100; i++) {
    await svc.isIpBlocked("10.0.0.1");
  }
  assert.equal(queryCount, 1);
});

test("BIN-587 B3-security: isIpBlocked tomt input returnerer false", async () => {
  const store = newStore();
  const svc = SecurityService.forTesting(makePool(store));
  assert.equal(await svc.isIpBlocked(""), false);
  assert.equal(await svc.isIpBlocked("  "), false);
});

test("BIN-587 B3-security: listBlockedIps returnerer full liste inkl. utløpte", async () => {
  const store = newStore();
  let currentMs = Date.UTC(2026, 3, 18);
  const svc = SecurityService.forTesting(makePool(store, () => currentMs), { nowMs: () => currentMs });
  await svc.addBlockedIp({ ipAddress: "10.0.0.1", blockedBy: "admin-1" });
  await svc.addBlockedIp({
    ipAddress: "10.0.0.2",
    blockedBy: "admin-1",
    expiresAt: new Date(currentMs - 1000).toISOString(), // allerede utløpt
  });
  const list = await svc.listBlockedIps();
  // List API returnerer alle (også utløpte) — kun isIpBlocked filtrerer
  assert.equal(list.length, 2);
});
