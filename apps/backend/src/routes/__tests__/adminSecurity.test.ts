/**
 * BIN-587 B3-security: integrasjonstester for admin-security-router.
 *
 * Full express round-trip med stub av SecurityService, PlatformService
 * og ekte InMemoryAuditLogStore.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminSecurityRouter } from "../adminSecurity.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
  type PersistedAuditEvent,
} from "../../compliance/AuditLogService.js";
import type { SecurityService, WithdrawEmail, RiskCountry, BlockedIp } from "../../compliance/SecurityService.js";
import type { PlatformService, PublicAppUser } from "../../platform/PlatformService.js";
import { DomainError } from "../../game/BingoEngine.js";

const adminUser: PublicAppUser = {
  id: "admin-1", email: "admin@test.no", displayName: "Admin",
  walletId: "w-admin", role: "ADMIN", hallId: null,
  kycStatus: "VERIFIED", createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z", balance: 0,
};
const supportUser: PublicAppUser = { ...adminUser, id: "sup-1", role: "SUPPORT" };
const operatorUser: PublicAppUser = { ...adminUser, id: "op-1", role: "HALL_OPERATOR", hallId: "hall-a" };
const playerUser: PublicAppUser = { ...adminUser, id: "pl-1", role: "PLAYER" };

interface Ctx {
  baseUrl: string;
  spies: {
    auditStore: InMemoryAuditLogStore;
    addEmailCalls: Array<{ email: string; addedBy: string }>;
    delEmailCalls: string[];
    addCountryCalls: Array<{ countryCode: string; addedBy: string }>;
    delCountryCalls: string[];
    addIpCalls: Array<{ ipAddress: string; blockedBy: string; expiresAt: string | null }>;
    delIpCalls: string[];
  };
  close: () => Promise<void>;
}

async function startServer(
  users: Record<string, PublicAppUser>,
  opts?: { seedEmails?: WithdrawEmail[]; seedCountries?: RiskCountry[]; seedIps?: BlockedIp[] }
): Promise<Ctx> {
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const emails = new Map<string, WithdrawEmail>();
  for (const e of opts?.seedEmails ?? []) emails.set(e.id, e);
  const countries = new Map<string, RiskCountry>();
  for (const c of opts?.seedCountries ?? []) countries.set(c.countryCode, c);
  const ips = new Map<string, BlockedIp>();
  for (const i of opts?.seedIps ?? []) ips.set(i.id, i);

  const addEmailCalls: Ctx["spies"]["addEmailCalls"] = [];
  const delEmailCalls: string[] = [];
  const addCountryCalls: Ctx["spies"]["addCountryCalls"] = [];
  const delCountryCalls: string[] = [];
  const addIpCalls: Ctx["spies"]["addIpCalls"] = [];
  const delIpCalls: string[] = [];

  const platformService = {
    async getUserFromAccessToken(token: string): Promise<PublicAppUser> {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
  } as unknown as PlatformService;

  const securityService = {
    async listWithdrawEmails() { return [...emails.values()]; },
    async addWithdrawEmail({ email, addedBy, label }: { email: string; addedBy: string; label?: string | null }) {
      addEmailCalls.push({ email, addedBy });
      const id = `email-${emails.size + 1}`;
      const row: WithdrawEmail = { id, email: email.toLowerCase(), label: label ?? null, addedBy, createdAt: new Date().toISOString() };
      emails.set(id, row);
      return row;
    },
    async deleteWithdrawEmail(id: string) {
      delEmailCalls.push(id);
      if (!emails.has(id)) throw new DomainError("WITHDRAW_EMAIL_NOT_FOUND", "not found");
      emails.delete(id);
    },
    async updateWithdrawEmail(id: string, input: { email?: string; label?: string | null }) {
      const existing = emails.get(id);
      if (!existing) throw new DomainError("WITHDRAW_EMAIL_NOT_FOUND", "not found");
      const updated: WithdrawEmail = {
        ...existing,
        email: input.email !== undefined ? input.email.trim().toLowerCase() : existing.email,
        label: input.label !== undefined ? input.label : existing.label,
      };
      emails.set(id, updated);
      return updated;
    },
    async listRiskCountries() { return [...countries.values()]; },
    async addRiskCountry({ countryCode, addedBy, label, reason }: { countryCode: string; addedBy: string; label: string; reason?: string | null }) {
      const code = countryCode.toUpperCase();
      addCountryCalls.push({ countryCode: code, addedBy });
      const row: RiskCountry = { countryCode: code, label, reason: reason ?? null, addedBy, createdAt: new Date().toISOString() };
      countries.set(code, row);
      return row;
    },
    async removeRiskCountry(code: string) {
      const uc = code.toUpperCase();
      delCountryCalls.push(uc);
      if (!countries.has(uc)) throw new DomainError("RISK_COUNTRY_NOT_FOUND", "not found");
      countries.delete(uc);
    },
    async listBlockedIps() { return [...ips.values()]; },
    async addBlockedIp({ ipAddress, blockedBy, reason, expiresAt }: { ipAddress: string; blockedBy: string; reason?: string | null; expiresAt?: string | null }) {
      addIpCalls.push({ ipAddress, blockedBy, expiresAt: expiresAt ?? null });
      const id = `ip-${ips.size + 1}`;
      const row: BlockedIp = {
        id, ipAddress, reason: reason ?? null,
        blockedBy, expiresAt: expiresAt ?? null,
        createdAt: new Date().toISOString(),
      };
      ips.set(id, row);
      return row;
    },
    async removeBlockedIp(id: string) {
      delIpCalls.push(id);
      if (!ips.has(id)) throw new DomainError("BLOCKED_IP_NOT_FOUND", "not found");
      ips.delete(id);
    },
    async isIpBlocked() { return false; },
  } as unknown as SecurityService;

  const app = express();
  app.use(express.json());
  app.use(createAdminSecurityRouter({ platformService, auditLogService, securityService }));

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    spies: { auditStore, addEmailCalls, delEmailCalls, addCountryCalls, delCountryCalls, addIpCalls, delIpCalls },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function req(baseUrl: string, method: string, path: string, token?: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function waitForAudit(store: InMemoryAuditLogStore, action: string): Promise<PersistedAuditEvent | null> {
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    const events = await store.list();
    const hit = events.find((e) => e.action === action);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 10));
  }
  return null;
}

// ── Tests ────────────────────────────────────────────────────────────────

test("BIN-587 B3-security: HALL_OPERATOR + PLAYER blokkert fra alle security-endepunkter", async () => {
  const ctx = await startServer({ "op-tok": operatorUser, "pl-tok": playerUser });
  try {
    const paths = [
      "/api/admin/security/withdraw-emails",
      "/api/admin/security/risk-countries",
      "/api/admin/security/blocked-ips",
    ];
    for (const path of paths) {
      const op = await req(ctx.baseUrl, "GET", path, "op-tok");
      assert.equal(op.status, 400);
      assert.equal(op.json.error.code, "FORBIDDEN");
      const pl = await req(ctx.baseUrl, "GET", path, "pl-tok");
      assert.equal(pl.status, 400);
      assert.equal(pl.json.error.code, "FORBIDDEN");
    }
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B3-security: POST withdraw-email — SUPPORT OK + audit logger kun domene", async () => {
  const ctx = await startServer({ "sup-tok": supportUser });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/security/withdraw-emails", "sup-tok", {
      email: "revisor@firma.no",
      label: "Revisor",
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.email, "revisor@firma.no");
    assert.equal(ctx.spies.addEmailCalls.length, 1);

    const event = await waitForAudit(ctx.spies.auditStore, "security.withdraw_email.add");
    assert.ok(event);
    assert.equal(event!.details.emailDomain, "firma.no");
    // Personvern: full e-post skal ikke være i audit
    const serialized = JSON.stringify(event!.details);
    assert.ok(!serialized.includes("revisor@firma.no"), "Full e-post skal ikke logges i audit");
  } finally {
    await ctx.close();
  }
});

test("GAP #21: PUT withdraw-email — admin oppdaterer label + audit logger kun domene", async () => {
  const seed: WithdrawEmail = {
    id: "email-1",
    email: "regnskap@firma.no",
    label: "Gammelt",
    addedBy: "admin-1",
    createdAt: "2026-01-01T00:00:00Z",
  };
  const ctx = await startServer({ "admin-tok": adminUser }, { seedEmails: [seed] });
  try {
    const res = await req(ctx.baseUrl, "PUT", "/api/admin/security/withdraw-emails/email-1", "admin-tok", {
      label: "Hovedrevisor",
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.id, "email-1");
    assert.equal(res.json.data.label, "Hovedrevisor");
    assert.equal(res.json.data.email, "regnskap@firma.no", "email skal ikke endres når kun label sendes");

    const event = await waitForAudit(ctx.spies.auditStore, "security.withdraw_email.update");
    assert.ok(event);
    assert.equal(event!.details.emailDomain, "firma.no");
    assert.equal(event!.details.emailChanged, false);
    assert.equal(event!.details.labelChanged, true);
    // Personvern: full e-post ikke i audit
    const serialized = JSON.stringify(event!.details);
    assert.ok(!serialized.includes("regnskap@firma.no"), "Full e-post skal ikke logges");
  } finally {
    await ctx.close();
  }
});

test("GAP #21: PUT withdraw-email — endrer email + label samtidig", async () => {
  const seed: WithdrawEmail = {
    id: "email-2",
    email: "old@firma.no",
    label: null,
    addedBy: "admin-1",
    createdAt: "2026-01-01T00:00:00Z",
  };
  const ctx = await startServer({ "admin-tok": adminUser }, { seedEmails: [seed] });
  try {
    const res = await req(ctx.baseUrl, "PUT", "/api/admin/security/withdraw-emails/email-2", "admin-tok", {
      email: "NY@firma.no",
      label: "Ny revisor",
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.email, "ny@firma.no", "email skal lowercases");
    assert.equal(res.json.data.label, "Ny revisor");
  } finally {
    await ctx.close();
  }
});

test("GAP #21: PUT withdraw-email — 404 hvis ID ikke finnes", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(ctx.baseUrl, "PUT", "/api/admin/security/withdraw-emails/missing", "admin-tok", {
      label: "x",
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "WITHDRAW_EMAIL_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

test("GAP #21: PUT withdraw-email — INVALID_INPUT når ingen felter sendes", async () => {
  const seed: WithdrawEmail = {
    id: "email-3",
    email: "x@y.no",
    label: null,
    addedBy: "admin-1",
    createdAt: "2026-01-01T00:00:00Z",
  };
  const ctx = await startServer({ "admin-tok": adminUser }, { seedEmails: [seed] });
  try {
    const res = await req(ctx.baseUrl, "PUT", "/api/admin/security/withdraw-emails/email-3", "admin-tok", {});
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("GAP #21: PUT withdraw-email — HALL_OPERATOR + PLAYER blokkert (FORBIDDEN)", async () => {
  const seed: WithdrawEmail = {
    id: "email-4",
    email: "x@y.no",
    label: null,
    addedBy: "admin-1",
    createdAt: "2026-01-01T00:00:00Z",
  };
  const ctx = await startServer(
    { "op-tok": operatorUser, "pl-tok": playerUser },
    { seedEmails: [seed] }
  );
  try {
    const op = await req(ctx.baseUrl, "PUT", "/api/admin/security/withdraw-emails/email-4", "op-tok", {
      label: "x",
    });
    assert.equal(op.status, 400);
    assert.equal(op.json.error.code, "FORBIDDEN");
    const pl = await req(ctx.baseUrl, "PUT", "/api/admin/security/withdraw-emails/email-4", "pl-tok", {
      label: "x",
    });
    assert.equal(pl.status, 400);
    assert.equal(pl.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B3-security: DELETE withdraw-email + audit", async () => {
  const seed: WithdrawEmail = {
    id: "email-1", email: "r@test.no", label: null, addedBy: "admin-1", createdAt: "2026-01-01T00:00:00Z",
  };
  const ctx = await startServer({ "admin-tok": adminUser }, { seedEmails: [seed] });
  try {
    const res = await req(ctx.baseUrl, "DELETE", "/api/admin/security/withdraw-emails/email-1", "admin-tok");
    assert.equal(res.status, 200);
    assert.deepEqual(ctx.spies.delEmailCalls, ["email-1"]);
    const event = await waitForAudit(ctx.spies.auditStore, "security.withdraw_email.remove");
    assert.ok(event);
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B3-security: POST risk-country normaliserer til uppercase", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/security/risk-countries", "admin-tok", {
      countryCode: "no", label: "Norge",
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.countryCode, "NO");
    assert.equal(ctx.spies.addCountryCalls[0]!.countryCode, "NO");

    const event = await waitForAudit(ctx.spies.auditStore, "security.risk_country.add");
    assert.ok(event);
    assert.equal(event!.resourceId, "NO");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B3-security: DELETE risk-country via :code + audit", async () => {
  const seed: RiskCountry = {
    countryCode: "SE", label: "Sverige", reason: null, addedBy: "admin-1", createdAt: "2026-01-01T00:00:00Z",
  };
  const ctx = await startServer({ "admin-tok": adminUser }, { seedCountries: [seed] });
  try {
    const res = await req(ctx.baseUrl, "DELETE", "/api/admin/security/risk-countries/se", "admin-tok");
    assert.equal(res.status, 200);
    assert.deepEqual(ctx.spies.delCountryCalls, ["SE"]);
    const event = await waitForAudit(ctx.spies.auditStore, "security.risk_country.remove");
    assert.equal(event!.resourceId, "SE");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B3-security: POST blocked-IP lagrer + logger audit med IP + reason", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/security/blocked-ips", "admin-tok", {
      ipAddress: "10.0.0.42",
      reason: "Brute-force-forsøk",
      expiresAt: "2026-05-01T00:00:00Z",
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.ipAddress, "10.0.0.42");
    assert.equal(ctx.spies.addIpCalls[0]!.ipAddress, "10.0.0.42");

    const event = await waitForAudit(ctx.spies.auditStore, "security.blocked_ip.add");
    assert.ok(event);
    assert.equal(event!.details.ipAddress, "10.0.0.42");
    assert.equal(event!.details.reason, "Brute-force-forsøk");
    assert.equal(event!.details.expiresAt, "2026-05-01T00:00:00Z");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B3-security: DELETE blocked-IP + audit", async () => {
  const seed: BlockedIp = {
    id: "ip-1", ipAddress: "10.0.0.1", reason: null, blockedBy: "admin-1",
    expiresAt: null, createdAt: "2026-01-01T00:00:00Z",
  };
  const ctx = await startServer({ "admin-tok": adminUser }, { seedIps: [seed] });
  try {
    const res = await req(ctx.baseUrl, "DELETE", "/api/admin/security/blocked-ips/ip-1", "admin-tok");
    assert.equal(res.status, 200);
    assert.deepEqual(ctx.spies.delIpCalls, ["ip-1"]);
    const event = await waitForAudit(ctx.spies.auditStore, "security.blocked_ip.remove");
    assert.ok(event);
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B3-security: POST validerer required fields", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const noEmail = await req(ctx.baseUrl, "POST", "/api/admin/security/withdraw-emails", "admin-tok", {});
    assert.equal(noEmail.status, 400);
    assert.equal(noEmail.json.error.code, "INVALID_INPUT");

    const noCode = await req(ctx.baseUrl, "POST", "/api/admin/security/risk-countries", "admin-tok", { label: "x" });
    assert.equal(noCode.status, 400);

    const noIp = await req(ctx.baseUrl, "POST", "/api/admin/security/blocked-ips", "admin-tok", {});
    assert.equal(noIp.status, 400);
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B3-security: GET lister — ADMIN + SUPPORT OK", async () => {
  const ctx = await startServer(
    { "admin-tok": adminUser, "sup-tok": supportUser },
    {
      seedEmails: [{ id: "e-1", email: "a@b.no", label: null, addedBy: null, createdAt: "2026-01-01T00:00:00Z" }],
      seedCountries: [{ countryCode: "XX", label: "Test", reason: null, addedBy: null, createdAt: "2026-01-01T00:00:00Z" }],
      seedIps: [{ id: "i-1", ipAddress: "1.2.3.4", reason: null, blockedBy: null, expiresAt: null, createdAt: "2026-01-01T00:00:00Z" }],
    }
  );
  try {
    for (const token of ["admin-tok", "sup-tok"]) {
      const emails = await req(ctx.baseUrl, "GET", "/api/admin/security/withdraw-emails", token);
      assert.equal(emails.status, 200);
      assert.equal(emails.json.data.count, 1);
      const countries = await req(ctx.baseUrl, "GET", "/api/admin/security/risk-countries", token);
      assert.equal(countries.json.data.count, 1);
      const ips = await req(ctx.baseUrl, "GET", "/api/admin/security/blocked-ips", token);
      assert.equal(ips.json.data.count, 1);
    }
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B3-security: GET /api/admin/audit/events — AUDIT_LOG_READ for ADMIN + SUPPORT", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    // Seed noen audit-events ved å utføre en security-mutasjon.
    await req(ctx.baseUrl, "POST", "/api/admin/security/withdraw-emails", "admin-tok", { email: "a@b.no" });
    await new Promise((r) => setTimeout(r, 20));
    const res = await req(ctx.baseUrl, "GET", "/api/admin/audit/events", "admin-tok");
    assert.equal(res.status, 200);
    assert.ok(res.json.data.count >= 1);
    assert.ok(res.json.data.events[0].action);
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B3-security: GET /audit/events filter by action", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    // Create two events med forskjellige actions
    await req(ctx.baseUrl, "POST", "/api/admin/security/withdraw-emails", "admin-tok", { email: "x@y.no" });
    await req(ctx.baseUrl, "POST", "/api/admin/security/risk-countries", "admin-tok", { countryCode: "XX", label: "X" });
    await new Promise((r) => setTimeout(r, 20));

    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/audit/events?action=security.risk_country.add",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.ok(res.json.data.events.every((e: { action: string }) => e.action === "security.risk_country.add"));
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B3-security: GET /audit/events avviser ugyldig since", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/audit/events?since=not-a-date", "admin-tok");
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B3-security: HALL_OPERATOR blokkert fra audit-search", async () => {
  const ctx = await startServer({ "op-tok": operatorUser });
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/audit/events", "op-tok");
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

// ── GAP #25: Country-list-for-dropdown ────────────────────────────────

test("GAP-25 country-list: ADMIN får full ISO-3166-1 lista", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/security/countries", "admin-tok");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json.data.countries));
    assert.ok(res.json.data.countries.length >= 240, "lengde nær 249");
    assert.ok(res.json.data.countries.length <= 260);
    assert.equal(res.json.data.count, res.json.data.countries.length);
    // Norge må finnes i lista
    const no = res.json.data.countries.find((c: { code: string }) => c.code === "NO");
    assert.ok(no);
    assert.equal(no.nameNo, "Norge");
  } finally {
    await ctx.close();
  }
});

test("GAP-25 country-list: SUPPORT (READ) kan hente lista", async () => {
  const ctx = await startServer({ "sup-tok": supportUser });
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/security/countries", "sup-tok");
    assert.equal(res.status, 200);
    assert.ok(res.json.data.count > 0);
  } finally {
    await ctx.close();
  }
});

test("GAP-25 country-list: HALL_OPERATOR + PLAYER blokkert", async () => {
  const ctx = await startServer({ "op-tok": operatorUser, "pl-tok": playerUser });
  try {
    const op = await req(ctx.baseUrl, "GET", "/api/admin/security/countries", "op-tok");
    assert.equal(op.status, 400);
    assert.equal(op.json.error.code, "FORBIDDEN");

    const pl = await req(ctx.baseUrl, "GET", "/api/admin/security/countries", "pl-tok");
    assert.equal(pl.status, 400);
    assert.equal(pl.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("GAP-25 country-list: uten token gir UNAUTHORIZED", async () => {
  const ctx = await startServer({});
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/security/countries");
    assert.equal(res.status, 400);
    assert.ok(res.json?.error);
  } finally {
    await ctx.close();
  }
});

test("GAP-25 country-list: hver oppføring har riktig shape (code, nameNo, nameEn)", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/security/countries", "admin-tok");
    assert.equal(res.status, 200);
    for (const c of res.json.data.countries) {
      assert.equal(typeof c.code, "string");
      assert.equal(typeof c.nameNo, "string");
      assert.equal(typeof c.nameEn, "string");
      assert.ok(/^[A-Z]{2}$/.test(c.code), `code må være 2 ISO-bokstaver: ${c.code}`);
    }
  } finally {
    await ctx.close();
  }
});
