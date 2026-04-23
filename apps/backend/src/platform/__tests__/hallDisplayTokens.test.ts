/**
 * BIN-503: unit tests for DB-backed TV-display tokens.
 *
 * Stubs `ensureInitialized` and the pool's query method on a real
 * PlatformService instance so the CRUD + verify flow runs without a
 * live Postgres. The focus is on (a) plaintext is returned exactly once,
 * (b) hash round-trips, and (c) verifyHallDisplayToken rejects hall-slug
 * mismatches, format errors, and revoked tokens.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { PlatformService, type HallDefinition } from "../PlatformService.js";
import type { WalletAdapter } from "../../adapters/WalletAdapter.js";

function hashOf(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function makeHall(slug = "hall-oslo", id = `id-${slug}`): HallDefinition {
  return {
    id,
    slug,
    name: "Hall " + slug,
    region: "NO",
    address: "",
    isActive: true,
    clientVariant: "web",
    tvToken: `tv-${id}`,
    createdAt: "2026-04-18T00:00:00Z",
    updatedAt: "2026-04-18T00:00:00Z",
  };
}

interface FakeQueryCall {
  sql: string;
  params: unknown[];
}

interface FakeDb {
  rows: Record<string, Array<Record<string, unknown>>>;
  calls: FakeQueryCall[];
}

function makeService(initial: { halls: HallDefinition[]; tokens?: Array<Record<string, unknown>> }) {
  const svc = new PlatformService({} as WalletAdapter, {
    connectionString: "postgres://bin503-noop/noop",
    schema: "public",
    sessionTtlHours: 1,
    minAgeYears: 18,
    kycAdapter: { verify: async () => ({ ok: true }) } as unknown as ConstructorParameters<typeof PlatformService>[1]["kycAdapter"],
  });
  const db: FakeDb = {
    rows: { tokens: initial.tokens ?? [] },
    calls: [],
  };
  const svcInternal = svc as unknown as {
    ensureInitialized: () => Promise<void>;
    getHall: (ref: string) => Promise<HallDefinition>;
    pool: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }> };
  };
  svcInternal.ensureInitialized = async () => { /* noop */ };
  svcInternal.getHall = async (ref) => {
    const h = initial.halls.find((x) => x.id === ref || x.slug === ref);
    if (!h) throw new Error(`no hall ${ref}`);
    return h;
  };
  const normalize = (s: string) => s.replace(/\s+/g, " ");
  svcInternal.pool = {
    query: async (sql: string, params: unknown[] = []) => {
      db.calls.push({ sql, params });
      const flat = normalize(sql);
      if (flat.startsWith("INSERT INTO") && flat.includes("app_hall_display_tokens")) {
        const [id, hall_id, label, token_hash, created_by] = params as [string, string, string, string, string | null];
        const row = {
          id, hall_id, label, token_hash, created_by,
          created_at: new Date("2026-04-18T00:00:00Z"),
          revoked_at: null,
          last_used_at: null,
        };
        db.rows.tokens.push(row);
        return { rows: [row], rowCount: 1 };
      }
      if (flat.startsWith("SELECT") && flat.includes("app_hall_display_tokens") && flat.includes("JOIN") && flat.includes("app_halls")) {
        const tokenHash = params[0] as string;
        const t = db.rows.tokens.find((r) => r.token_hash === tokenHash && r.revoked_at === null);
        if (!t) return { rows: [], rowCount: 0 };
        const hall = initial.halls.find((h) => h.id === t.hall_id);
        if (!hall || !hall.isActive) return { rows: [], rowCount: 0 };
        return {
          rows: [{ id: t.id, hall_id: t.hall_id, hall_slug: hall.slug }],
          rowCount: 1,
        };
      }
      if (flat.includes("SET last_used_at")) {
        return { rows: [], rowCount: 1 };
      }
      if (flat.startsWith("SELECT") && flat.includes("app_hall_display_tokens") && flat.includes("WHERE hall_id =")) {
        const hallId = params[0] as string;
        const rows = db.rows.tokens.filter((r) => r.hall_id === hallId && r.revoked_at === null);
        return { rows, rowCount: rows.length };
      }
      if (flat.startsWith("UPDATE") && flat.includes("app_hall_display_tokens") && flat.includes("SET revoked_at")) {
        const tokenId = params[0] as string;
        const hallId = params[1] as string | undefined;
        const t = db.rows.tokens.find(
          (r) => r.id === tokenId && r.revoked_at === null && (hallId === undefined || r.hall_id === hallId),
        );
        if (!t) return { rows: [], rowCount: 0 };
        t.revoked_at = new Date();
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unexpected SQL in test stub: ${flat.slice(0, 120)}`);
    },
  };
  return { svc, db };
}

test("createHallDisplayToken returns plaintext exactly once and stores only the hash", async () => {
  const hall = makeHall("hall-oslo");
  const { svc, db } = makeService({ halls: [hall] });
  const result = await svc.createHallDisplayToken("hall-oslo", { label: "TV-kiosk 1" });
  assert.equal(result.label, "TV-kiosk 1");
  assert.equal(result.hallId, hall.id);
  assert.ok(result.plaintextToken.length >= 20, "plaintext token must be non-trivial");
  assert.equal(result.compositeToken, `${hall.slug}:${result.plaintextToken}`);
  // Storage must be the hash, not the plaintext.
  const stored = db.rows.tokens[0] as { token_hash: string };
  assert.equal(stored.token_hash, hashOf(result.plaintextToken));
  assert.notEqual(stored.token_hash, result.plaintextToken);
});

test("verifyHallDisplayToken accepts a freshly-minted token and rejects after revoke", async () => {
  const hall = makeHall("hall-bergen");
  const { svc } = makeService({ halls: [hall] });
  const created = await svc.createHallDisplayToken("hall-bergen");

  const ok = await svc.verifyHallDisplayToken(created.compositeToken);
  assert.equal(ok.hallId, hall.id);

  await svc.revokeHallDisplayToken(created.id, "hall-bergen");
  await assert.rejects(() => svc.verifyHallDisplayToken(created.compositeToken), /Ugyldig display-token/);
});

test("verifyHallDisplayToken rejects hall-slug replay across halls", async () => {
  const hallA = makeHall("hall-a");
  const hallB = makeHall("hall-b");
  const { svc } = makeService({ halls: [hallA, hallB] });
  const tokenA = await svc.createHallDisplayToken("hall-a");
  // Try to present hall-a's secret against hall-b's slug.
  const spoofed = `hall-b:${tokenA.plaintextToken}`;
  await assert.rejects(() => svc.verifyHallDisplayToken(spoofed), /hører ikke til oppgitt hall/);
});

test("verifyHallDisplayToken rejects malformed input", async () => {
  const hall = makeHall("hall-stavanger");
  const { svc } = makeService({ halls: [hall] });
  await assert.rejects(() => svc.verifyHallDisplayToken("no-colon-here"), /Token-format ugyldig/);
  await assert.rejects(() => svc.verifyHallDisplayToken(":missing-slug"), /Token-format ugyldig/);
  await assert.rejects(() => svc.verifyHallDisplayToken("hall-stavanger:"), /Token-format ugyldig/);
});

test("revokeHallDisplayToken cross-hall is rejected when a hallReference is supplied", async () => {
  const hallA = makeHall("hall-a");
  const hallB = makeHall("hall-b");
  const { svc } = makeService({ halls: [hallA, hallB] });
  const t = await svc.createHallDisplayToken("hall-a");
  // UI bug: caller passes hall-b but token belongs to hall-a. Must reject.
  await assert.rejects(
    () => svc.revokeHallDisplayToken(t.id, "hall-b"),
    (err: unknown) => (err as { code?: string }).code === "DISPLAY_TOKEN_NOT_FOUND",
  );
  // But revoking for the right hall still works.
  await svc.revokeHallDisplayToken(t.id, "hall-a");
});

test("listHallDisplayTokens returns only active tokens and no hash material", async () => {
  const hall = makeHall("hall-tromso");
  const { svc } = makeService({ halls: [hall] });
  const a = await svc.createHallDisplayToken("hall-tromso", { label: "Active" });
  const b = await svc.createHallDisplayToken("hall-tromso", { label: "ToRevoke" });
  await svc.revokeHallDisplayToken(b.id, "hall-tromso");
  const list = await svc.listHallDisplayTokens("hall-tromso");
  assert.equal(list.length, 1);
  assert.equal(list[0].id, a.id);
  assert.equal(list[0].label, "Active");
  // Typed interface must not expose any hash or plaintext fields.
  const keys = Object.keys(list[0]);
  assert.ok(!keys.some((k) => k.toLowerCase().includes("hash") || k.toLowerCase().includes("plaintext")));
});
