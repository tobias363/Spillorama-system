/**
 * BIN-720 follow-up: PlatformService.assertUserEligibleForGameplay must
 * gate gameplay on time-based block-myself when ProfileSettingsService
 * is wired in (`setProfileSettingsService`).
 *
 * The check must:
 *   1. throw PLAYER_BLOCKED when the player is currently blocked
 *   2. pass when no block is set
 *   3. pass after the block has expired
 *   4. be a silent no-op when ProfileSettingsService isn't wired in
 *      (test harnesses, dev deployments without RG-persistence)
 *
 * The block-myself gate is enforced even in non-production NODE_ENV so
 * the dev block-UI works end-to-end.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../../game/BingoEngine.js";
import { PlatformService, type PublicAppUser } from "../PlatformService.js";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

function buildUser(overrides: Partial<PublicAppUser> = {}): PublicAppUser {
  return {
    id: "user-alice",
    email: "alice@test.no",
    displayName: "Alice",
    walletId: "wallet-alice",
    role: "PLAYER",
    hallId: "hall-test",
    kycStatus: "VERIFIED",
    birthDate: "1990-01-01",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    balance: 1000,
    ...overrides,
  };
}

interface FakeProfileGate {
  blockedIds: Set<string>;
  callsFor: string[];
}

function buildFakeGate(): FakeProfileGate & {
  assertUserNotBlocked(userId: string): Promise<void>;
} {
  const state: FakeProfileGate = { blockedIds: new Set(), callsFor: [] };
  return {
    ...state,
    blockedIds: state.blockedIds,
    callsFor: state.callsFor,
    async assertUserNotBlocked(userId: string): Promise<void> {
      state.callsFor.push(userId);
      if (state.blockedIds.has(userId)) {
        throw new DomainError("PLAYER_BLOCKED", `Spiller ${userId} er blokkert.`);
      }
    },
  };
}

/**
 * PlatformService.constructor opens a pg.Pool, but we only exercise the
 * `assertUserEligibleForGameplay` path which never touches the pool.
 * Constructing it with a dummy connection-string is therefore safe — no
 * queries are issued.
 */
function buildPlatformService(): PlatformService {
  return new PlatformService({} as never, {
    connectionString: "postgres://test:test@127.0.0.1:5432/dummy",
    schema: "public",
  });
}

test("BIN-720 follow-up: assertUserEligibleForGameplay no-ops without wired ProfileSettingsService", async () => {
  process.env.NODE_ENV = "development";
  try {
    const platform = buildPlatformService();
    // No setProfileSettingsService call — gate is a silent no-op.
    await platform.assertUserEligibleForGameplay(buildUser());
  } finally {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  }
});

test("BIN-720 follow-up: assertUserEligibleForGameplay passes for non-blocked user (dev mode)", async () => {
  process.env.NODE_ENV = "development";
  try {
    const platform = buildPlatformService();
    const gate = buildFakeGate();
    platform.setProfileSettingsService(gate);

    await platform.assertUserEligibleForGameplay(buildUser());

    assert.deepEqual(gate.callsFor, ["user-alice"], "gate should be invoked once");
  } finally {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  }
});

test("BIN-720 follow-up: assertUserEligibleForGameplay throws PLAYER_BLOCKED when blocked_until er aktiv", async () => {
  process.env.NODE_ENV = "development";
  try {
    const platform = buildPlatformService();
    const gate = buildFakeGate();
    gate.blockedIds.add("user-alice");
    platform.setProfileSettingsService(gate);

    await assert.rejects(
      async () => await platform.assertUserEligibleForGameplay(buildUser()),
      (err: unknown) => err instanceof DomainError && err.code === "PLAYER_BLOCKED",
      "PLAYER_BLOCKED skal kastes for blokkert spiller"
    );
  } finally {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  }
});

test("BIN-720 follow-up: block-myself gate is enforced even in production with KYC failures (gate runs first)", async () => {
  process.env.NODE_ENV = "production";
  try {
    const platform = buildPlatformService();
    const gate = buildFakeGate();
    gate.blockedIds.add("user-alice");
    platform.setProfileSettingsService(gate);

    // Bruker har UNVERIFIED KYC. Dersom block-gate kjørte etter KYC ville vi
    // sett "KYC_REQUIRED" først. Vi krever at PLAYER_BLOCKED kommer først så
    // brukerens block-status er kommunisert konsistent uavhengig av KYC.
    await assert.rejects(
      async () => await platform.assertUserEligibleForGameplay(buildUser({ kycStatus: "UNVERIFIED" })),
      (err: unknown) => err instanceof DomainError && err.code === "PLAYER_BLOCKED",
      "PLAYER_BLOCKED skal vinne over KYC_REQUIRED"
    );
  } finally {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  }
});

test("BIN-720 follow-up: KYC + age checks fortsetter å gjelde i production når block er passert", async () => {
  process.env.NODE_ENV = "production";
  try {
    const platform = buildPlatformService();
    const gate = buildFakeGate();
    // Ingen block — gate skal slippe gjennom og deretter KYC-sjekken kjører.
    platform.setProfileSettingsService(gate);

    await assert.rejects(
      async () => await platform.assertUserEligibleForGameplay(buildUser({ kycStatus: "UNVERIFIED" })),
      (err: unknown) => err instanceof DomainError && err.code === "KYC_REQUIRED",
      "KYC_REQUIRED skal kastes etter at gate har sluppet gjennom"
    );
  } finally {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  }
});
