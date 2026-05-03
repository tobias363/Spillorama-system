/**
 * P0-1 (pilot 2026-05-02): unit tests for `ensureHallRegistration` og
 * dens kobling til `updateUserHallAssignment` + `approveKycAsAdmin`.
 *
 * Bakgrunn: før P0-1 ble `app_hall_registrations` aldri skrevet til av
 * produksjonskode. Dette betydde at spillere registrert via
 * `/api/auth/register` eller satt via `/api/admin/users/:id/hall` ikke
 * havnet i tabellen, og `isPlayerActiveInHall` returnerte false →
 * AGENT cash-in/out feilet med PLAYER_NOT_AT_HALL.
 *
 * Disse testene bruker en stubbet pool på en ekte PlatformService-instans
 * og verifiserer at den nye INSERT-en faktisk skjer på riktige call-sites.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { PlatformService } from "../PlatformService.js";
import type { WalletAdapter } from "../../adapters/WalletAdapter.js";

interface FakeQueryCall {
  sql: string;
  params: unknown[];
}

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  surname: string | null;
  phone: string | null;
  wallet_id: string;
  role: "PLAYER" | "ADMIN" | "HALL_OPERATOR" | "SUPPORT" | "AGENT";
  hall_id: string | null;
  kyc_status: "UNVERIFIED" | "PENDING" | "VERIFIED" | "REJECTED";
  birth_date: string | null;
  kyc_verified_at: string | null;
  kyc_provider_ref: string | null;
  created_at: string;
  updated_at: string;
  compliance_data?: Record<string, unknown> | null;
}

function makeUserRow(overrides: Partial<UserRow> & { id: string }): UserRow {
  return {
    id: overrides.id,
    email: overrides.email ?? `${overrides.id}@test.no`,
    display_name: overrides.display_name ?? overrides.id,
    surname: overrides.surname ?? null,
    phone: overrides.phone ?? null,
    wallet_id: overrides.wallet_id ?? `wallet-user-${overrides.id}`,
    role: overrides.role ?? "PLAYER",
    hall_id: overrides.hall_id ?? null,
    kyc_status: overrides.kyc_status ?? "VERIFIED",
    birth_date: overrides.birth_date ?? "1990-01-01",
    kyc_verified_at: overrides.kyc_verified_at ?? "2026-05-02T08:00:00Z",
    kyc_provider_ref: overrides.kyc_provider_ref ?? null,
    created_at: overrides.created_at ?? "2026-05-02T08:00:00Z",
    updated_at: overrides.updated_at ?? "2026-05-02T08:00:00Z",
    compliance_data: overrides.compliance_data ?? null,
  };
}

interface ServiceContext {
  svc: PlatformService;
  calls: FakeQueryCall[];
  registrations: Array<{
    id: string;
    user_id: string;
    wallet_id: string;
    hall_id: string;
    activated_by_user_id: string | null;
    activated_at: Date | null;
  }>;
}

function makeService(opts: {
  hallExists?: boolean;
  user: UserRow;
}): ServiceContext {
  const svc = new PlatformService({
    ensureAccount: async () => ({ id: "x", balance: 0 }),
    getBalance: async () => 0,
  } as unknown as WalletAdapter, {
    connectionString: "postgres://p0-1-noop/noop",
    schema: "public",
    sessionTtlHours: 1,
    minAgeYears: 18,
    kycAdapter: {
      verify: async () => ({ ok: true }),
    } as unknown as ConstructorParameters<typeof PlatformService>[1]["kycAdapter"],
  });
  const calls: FakeQueryCall[] = [];
  const registrations: ServiceContext["registrations"] = [];
  let currentUser: UserRow = { ...opts.user };
  const hallExists = opts.hallExists ?? true;

  const svcInternal = svc as unknown as {
    ensureInitialized: () => Promise<void>;
    pool: {
      query: (
        sql: string,
        params?: unknown[],
      ) => Promise<{ rows: unknown[]; rowCount: number }>;
    };
    schema: string;
  };
  svcInternal.ensureInitialized = async () => {
    /* noop */
  };

  const normalize = (s: string) => s.replace(/\s+/g, " ").trim();

  svcInternal.pool = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const flat = normalize(sql);

      // Hall existence check (used by updateUserHallAssignment).
      if (
        flat.startsWith("SELECT id FROM") &&
        flat.includes("app_halls") &&
        flat.includes("WHERE id =")
      ) {
        return hallExists
          ? { rows: [{ id: params[0] }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }

      // updateUserHallAssignment UPDATE.
      if (
        flat.startsWith("UPDATE") &&
        flat.includes("app_users") &&
        flat.includes("SET hall_id")
      ) {
        const [userId, hallId] = params as [string, string | null];
        if (currentUser.id !== userId) {
          return { rows: [], rowCount: 0 };
        }
        currentUser = { ...currentUser, hall_id: hallId };
        return { rows: [{ ...currentUser }], rowCount: 1 };
      }

      // ensureHallRegistration INSERT.
      if (
        flat.startsWith("INSERT INTO") &&
        flat.includes("app_hall_registrations")
      ) {
        const [id, userId, walletId, hallId, activatedBy] = params as [
          string,
          string,
          string,
          string,
          string | null,
        ];
        const existing = registrations.find(
          (r) => r.user_id === userId && r.hall_id === hallId,
        );
        if (existing) {
          existing.wallet_id = walletId;
          existing.activated_at = existing.activated_at ?? new Date();
          existing.activated_by_user_id =
            existing.activated_by_user_id ?? activatedBy;
        } else {
          registrations.push({
            id,
            user_id: userId,
            wallet_id: walletId,
            hall_id: hallId,
            activated_at: new Date(),
            activated_by_user_id: activatedBy,
          });
        }
        return { rows: [], rowCount: 1 };
      }

      // wallet_balance read used by `withBalance`.
      if (
        flat.startsWith("SELECT") &&
        flat.includes("FROM wallet_accounts") &&
        flat.includes("WHERE id =")
      ) {
        return { rows: [{ balance: "0" }], rowCount: 1 };
      }

      throw new Error(
        `unexpected SQL in P0-1 stub: ${flat.slice(0, 120)}`,
      );
    },
  };

  return { svc, calls, registrations };
}

test("ensureHallRegistration upserts ACTIVE-row med stable id og bevarer activated_at via COALESCE", async () => {
  const ctx = makeService({
    user: makeUserRow({ id: "user-1", role: "PLAYER", wallet_id: "wallet-user-1" }),
  });

  await ctx.svc.ensureHallRegistration({
    userId: "user-1",
    walletId: "wallet-user-1",
    hallId: "hall-arnes",
    activatedByUserId: "admin-1",
  });

  assert.equal(ctx.registrations.length, 1);
  const reg = ctx.registrations[0]!;
  assert.equal(reg.id, "reg-user-1-hall-arnes");
  assert.equal(reg.user_id, "user-1");
  assert.equal(reg.hall_id, "hall-arnes");
  assert.equal(reg.wallet_id, "wallet-user-1");
  assert.equal(reg.activated_by_user_id, "admin-1");

  // Verifiser at INSERT-en bruker ON CONFLICT (user_id, hall_id) DO UPDATE
  // og COALESCE for activated_at.
  const insertCall = ctx.calls.find((c) =>
    c.sql.includes("INSERT INTO") &&
    c.sql.includes("app_hall_registrations"),
  );
  assert.ok(insertCall, "INSERT må kjøres");
  assert.match(insertCall!.sql, /ON CONFLICT \(user_id, hall_id\) DO UPDATE/);
  assert.match(insertCall!.sql, /COALESCE\(/);
  assert.match(insertCall!.sql, /'ACTIVE'/);
});

test("ensureHallRegistration er idempotent — andre kall oppretter ikke duplikat-rad", async () => {
  const ctx = makeService({
    user: makeUserRow({ id: "user-2", role: "PLAYER" }),
  });

  await ctx.svc.ensureHallRegistration({
    userId: "user-2",
    walletId: "wallet-user-2",
    hallId: "hall-bodo",
    activatedByUserId: "admin-1",
  });
  await ctx.svc.ensureHallRegistration({
    userId: "user-2",
    walletId: "wallet-user-2",
    hallId: "hall-bodo",
    activatedByUserId: "admin-1",
  });

  // Stub-en simulerer DB-en sin UNIQUE (user_id, hall_id) — det skal være
  // én rad selv etter to kall.
  assert.equal(ctx.registrations.length, 1);
});

test("ensureHallRegistration kaster INVALID_INPUT på tom walletId", async () => {
  const ctx = makeService({
    user: makeUserRow({ id: "user-3" }),
  });

  await assert.rejects(
    () =>
      ctx.svc.ensureHallRegistration({
        userId: "user-3",
        walletId: "   ",
        hallId: "hall-x",
        activatedByUserId: null,
      }),
    /walletId/,
  );
});

test("updateUserHallAssignment (PLAYER) skriver app_hall_registrations-rad i samme transaksjon", async () => {
  const ctx = makeService({
    user: makeUserRow({
      id: "player-1",
      role: "PLAYER",
      wallet_id: "wallet-user-player-1",
      hall_id: null,
    }),
  });

  await ctx.svc.updateUserHallAssignment(
    "player-1",
    "hall-arnes",
    "admin-actor-1",
  );

  // Forvent: hall-existence-sjekk + UPDATE + INSERT INTO app_hall_registrations.
  const inserts = ctx.calls.filter((c) =>
    c.sql.includes("INSERT INTO") &&
    c.sql.includes("app_hall_registrations"),
  );
  assert.equal(inserts.length, 1, "Skal skrive nøyaktig én registrerings-INSERT");

  assert.equal(ctx.registrations.length, 1);
  const reg = ctx.registrations[0]!;
  assert.equal(reg.user_id, "player-1");
  assert.equal(reg.hall_id, "hall-arnes");
  assert.equal(reg.wallet_id, "wallet-user-player-1");
  // P0-1: activated_by_user_id skal komme fra admin actor-id.
  assert.equal(reg.activated_by_user_id, "admin-actor-1");
});

test("updateUserHallAssignment (PLAYER) med hallId=null skriver IKKE app_hall_registrations-rad", async () => {
  const ctx = makeService({
    user: makeUserRow({
      id: "player-2",
      role: "PLAYER",
      wallet_id: "wallet-user-player-2",
      hall_id: "hall-old",
    }),
  });

  await ctx.svc.updateUserHallAssignment("player-2", null, "admin-actor-1");

  const inserts = ctx.calls.filter((c) =>
    c.sql.includes("INSERT INTO") &&
    c.sql.includes("app_hall_registrations"),
  );
  assert.equal(
    inserts.length,
    0,
    "hallId=null betyr fjern-tilordning — ingen ACTIVE-rad skal skrives",
  );
});

test("updateUserHallAssignment (HALL_OPERATOR) skriver IKKE app_hall_registrations-rad", async () => {
  // app_hall_registrations er kun for PLAYER. HALL_OPERATOR/AGENT bruker
  // app_agent_halls eller app_users.hall_id alene.
  const ctx = makeService({
    user: makeUserRow({
      id: "operator-1",
      role: "HALL_OPERATOR",
      wallet_id: "wallet-user-operator-1",
      hall_id: null,
    }),
  });

  await ctx.svc.updateUserHallAssignment(
    "operator-1",
    "hall-arnes",
    "admin-actor-1",
  );

  const inserts = ctx.calls.filter((c) =>
    c.sql.includes("INSERT INTO") &&
    c.sql.includes("app_hall_registrations"),
  );
  assert.equal(
    inserts.length,
    0,
    "HALL_OPERATOR-rolle skal ikke trigge spiller-hall-registrering",
  );
});
