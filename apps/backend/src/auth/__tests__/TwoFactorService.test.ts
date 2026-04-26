/**
 * REQ-129: tester for TwoFactorService.
 *
 * Bruker en in-memory pg.Pool-stub som simulerer to tabeller:
 *   - app_user_2fa
 *   - app_user_2fa_challenges
 *
 * Dekker:
 *   - setup → verifyAndEnable round-trip + backup-codes returnert
 *   - verifyTotpForLogin med TOTP og backup-code
 *   - backup-code single-use enforcement
 *   - challenge-flyt: create → consume happy path + reuse + expiry
 *   - disable krever korrekt kode
 *   - regenerateBackupCodes
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { TwoFactorService } from "../TwoFactorService.js";
import { generateTotpCode } from "../Totp.js";
import { DomainError } from "../../game/BingoEngine.js";

interface UserTwoFaRow {
  user_id: string;
  pending_secret: string | null;
  enabled_secret: string | null;
  enabled_at: Date | null;
  backup_codes: Array<{ h: string; u: string | null }>;
}

interface ChallengeRow {
  id: string;
  user_id: string;
  expires_at: Date;
  consumed_at: Date | null;
}

interface Store {
  twofa: Map<string, UserTwoFaRow>;
  challenges: Map<string, ChallengeRow>;
}

function makeStore(): Store {
  return { twofa: new Map(), challenges: new Map() };
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function makePool(store: Store): Pool {
  const handler = {
    async query(sql: string, params: unknown[] = []) {
      const trimmed = sql.trim();

      // ── BEGIN/COMMIT/ROLLBACK ──
      if (trimmed.startsWith("BEGIN") || trimmed.startsWith("COMMIT") || trimmed.startsWith("ROLLBACK")) {
        return { rows: [], rowCount: 0 };
      }

      // ── CREATE TABLE / IF NOT EXISTS — init schema ──
      if (trimmed.startsWith("CREATE TABLE") || trimmed.startsWith("CREATE INDEX")) {
        return { rows: [], rowCount: 0 };
      }

      // ── SELECT enabled_secret only ──
      if (trimmed.startsWith("SELECT enabled_secret FROM")) {
        const [userId] = params as [string];
        const row = store.twofa.get(userId);
        return row
          ? { rows: [{ enabled_secret: row.enabled_secret }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }

      // ── SELECT pending_secret + enabled_secret + enabled_at + backup_codes (getStatus) ──
      // Sjekkes FØR den kortere SELECT-en for at lengste prefix matcher først.
      if (trimmed.startsWith("SELECT pending_secret, enabled_secret, enabled_at")) {
        const [userId] = params as [string];
        const row = store.twofa.get(userId);
        return row
          ? {
              rows: [
                {
                  pending_secret: row.pending_secret,
                  enabled_secret: row.enabled_secret,
                  enabled_at: row.enabled_at,
                  backup_codes: row.backup_codes,
                },
              ],
              rowCount: 1,
            }
          : { rows: [], rowCount: 0 };
      }

      // ── SELECT pending_secret + enabled_secret (verifyAndEnable) ──
      if (trimmed.startsWith("SELECT pending_secret, enabled_secret")) {
        const [userId] = params as [string];
        const row = store.twofa.get(userId);
        return row
          ? {
              rows: [
                {
                  pending_secret: row.pending_secret,
                  enabled_secret: row.enabled_secret,
                },
              ],
              rowCount: 1,
            }
          : { rows: [], rowCount: 0 };
      }

      // ── SELECT enabled_secret + backup_codes (verifyTotpForLogin) ──
      if (trimmed.startsWith("SELECT enabled_secret, backup_codes")) {
        const [userId] = params as [string];
        const row = store.twofa.get(userId);
        return row
          ? {
              rows: [
                {
                  enabled_secret: row.enabled_secret,
                  backup_codes: row.backup_codes,
                },
              ],
              rowCount: 1,
            }
          : { rows: [], rowCount: 0 };
      }

      // ── INSERT pending secret (setup) ──
      if (trimmed.startsWith("INSERT INTO") && sql.includes("app_user_2fa") && sql.includes("ON CONFLICT")) {
        const [userId, pending] = params as [string, string];
        const existing = store.twofa.get(userId);
        if (existing) {
          existing.pending_secret = pending;
        } else {
          store.twofa.set(userId, {
            user_id: userId,
            pending_secret: pending,
            enabled_secret: null,
            enabled_at: null,
            backup_codes: [],
          });
        }
        return { rows: [], rowCount: 1 };
      }

      // ── UPDATE — enable (verifyAndEnable) ──
      if (
        trimmed.startsWith("UPDATE") &&
        sql.includes("enabled_secret = pending_secret")
      ) {
        const [userId, backupCodesJson] = params as [string, string];
        const row = store.twofa.get(userId);
        if (row && row.pending_secret) {
          row.enabled_secret = row.pending_secret;
          row.pending_secret = null;
          row.enabled_at = new Date();
          row.backup_codes = JSON.parse(backupCodesJson);
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }

      // ── UPDATE backup_codes (regenerate eller mark used) ──
      if (
        trimmed.startsWith("UPDATE") &&
        sql.includes("SET backup_codes = $2::jsonb")
      ) {
        const [userId, backupCodesJson] = params as [string, string];
        const row = store.twofa.get(userId);
        if (row) {
          row.backup_codes = JSON.parse(backupCodesJson);
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }

      // ── DELETE (disable) ──
      if (trimmed.startsWith("DELETE FROM") && sql.includes("app_user_2fa")) {
        const [userId] = params as [string];
        const had = store.twofa.delete(userId);
        return { rows: [], rowCount: had ? 1 : 0 };
      }

      // ── INSERT challenge ──
      if (
        trimmed.startsWith("INSERT INTO") &&
        sql.includes("app_user_2fa_challenges")
      ) {
        const [id, userId, expiresAt] = params as [string, string, string];
        store.challenges.set(id, {
          id,
          user_id: userId,
          expires_at: new Date(expiresAt),
          consumed_at: null,
        });
        return { rows: [], rowCount: 1 };
      }

      // ── UPDATE consume challenge ──
      if (
        trimmed.startsWith("UPDATE") &&
        sql.includes("app_user_2fa_challenges") &&
        sql.includes("SET consumed_at = now()")
      ) {
        const [id] = params as [string];
        const row = store.challenges.get(id);
        const now = Date.now();
        if (
          row &&
          row.consumed_at === null &&
          row.expires_at.getTime() > now
        ) {
          row.consumed_at = new Date();
          return { rows: [{ user_id: row.user_id }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }

      throw new Error(`unhandled SQL: ${trimmed.slice(0, 120)}`);
    },
    async connect() {
      return {
        query: handler.query,
        release() {},
      };
    },
  };
  return handler as unknown as Pool;
}

// ── Tests ─────────────────────────────────────────────────────────────────

test("REQ-129: setup returnerer otpauth-URI + secret", async () => {
  const store = makeStore();
  const svc = TwoFactorService.forTesting(makePool(store));
  const result = await svc.setup({
    userId: "user-1",
    accountLabel: "alice@example.com",
  });
  assert.match(result.secret, /^[A-Z2-7]+$/);
  assert.match(result.otpauthUri, /^otpauth:\/\/totp\//);
  assert.equal(store.twofa.get("user-1")?.pending_secret, result.secret);
  assert.equal(store.twofa.get("user-1")?.enabled_secret, null);
});

test("REQ-129: verifyAndEnable promoter pending → enabled + 10 backup-codes", async () => {
  const store = makeStore();
  const svc = TwoFactorService.forTesting(makePool(store));
  const { secret } = await svc.setup({
    userId: "user-1",
    accountLabel: "alice@example.com",
  });
  const code = generateTotpCode(secret);
  const { backupCodes } = await svc.verifyAndEnable({ userId: "user-1", code });
  assert.equal(backupCodes.length, 10);
  for (const bc of backupCodes) {
    assert.match(bc, /^\d{5}-\d{5}$/);
  }
  const row = store.twofa.get("user-1")!;
  assert.equal(row.enabled_secret, secret);
  assert.equal(row.pending_secret, null);
  assert.notEqual(row.enabled_at, null);
  assert.equal(row.backup_codes.length, 10);
  for (const entry of row.backup_codes) {
    assert.equal(entry.u, null);
    assert.match(entry.h, /^[0-9a-f]{64}$/);
  }
});

test("REQ-129: verifyAndEnable avviser feil TOTP-kode", async () => {
  const store = makeStore();
  const svc = TwoFactorService.forTesting(makePool(store));
  await svc.setup({ userId: "user-1", accountLabel: "alice@example.com" });
  await assert.rejects(
    () => svc.verifyAndEnable({ userId: "user-1", code: "000000" }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_TOTP_CODE"
  );
});

test("REQ-129: setup avviser hvis 2FA allerede aktivert", async () => {
  const store = makeStore();
  const svc = TwoFactorService.forTesting(makePool(store));
  const { secret } = await svc.setup({ userId: "user-1", accountLabel: "alice@example.com" });
  await svc.verifyAndEnable({ userId: "user-1", code: generateTotpCode(secret) });
  await assert.rejects(
    () => svc.setup({ userId: "user-1", accountLabel: "alice@example.com" }),
    (err: unknown) => err instanceof DomainError && err.code === "TWO_FA_ALREADY_ENABLED"
  );
});

test("REQ-129: verifyTotpForLogin aksepterer current TOTP", async () => {
  const store = makeStore();
  const svc = TwoFactorService.forTesting(makePool(store));
  const { secret } = await svc.setup({ userId: "user-1", accountLabel: "alice@example.com" });
  await svc.verifyAndEnable({ userId: "user-1", code: generateTotpCode(secret) });
  await svc.verifyTotpForLogin({
    userId: "user-1",
    code: generateTotpCode(secret),
  });
  // Skal ikke kaste.
});

test("REQ-129: verifyTotpForLogin avviser ugyldig kode", async () => {
  const store = makeStore();
  const svc = TwoFactorService.forTesting(makePool(store));
  const { secret } = await svc.setup({ userId: "user-1", accountLabel: "alice@example.com" });
  await svc.verifyAndEnable({ userId: "user-1", code: generateTotpCode(secret) });
  await assert.rejects(
    () => svc.verifyTotpForLogin({ userId: "user-1", code: "000000" }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_TOTP_CODE"
  );
});

test("REQ-129: backup-code er single-use", async () => {
  const store = makeStore();
  const svc = TwoFactorService.forTesting(makePool(store));
  const { secret } = await svc.setup({ userId: "user-1", accountLabel: "alice@example.com" });
  const { backupCodes } = await svc.verifyAndEnable({
    userId: "user-1",
    code: generateTotpCode(secret),
  });
  const code = backupCodes[0]!;
  // Første bruk: OK.
  await svc.verifyTotpForLogin({ userId: "user-1", code });
  // Andre bruk: avvist.
  await assert.rejects(
    () => svc.verifyTotpForLogin({ userId: "user-1", code }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_TOTP_CODE"
  );
  // Backup-koden skal være markert som brukt.
  const row = store.twofa.get("user-1")!;
  const usedHash = sha256Hex(code.replace("-", ""));
  const entry = row.backup_codes.find((e) => e.h === usedHash);
  assert.notEqual(entry?.u, null);
});

test("REQ-129: backup-code aksepteres uten bindestrek også", async () => {
  const store = makeStore();
  const svc = TwoFactorService.forTesting(makePool(store));
  const { secret } = await svc.setup({ userId: "user-1", accountLabel: "alice@example.com" });
  const { backupCodes } = await svc.verifyAndEnable({
    userId: "user-1",
    code: generateTotpCode(secret),
  });
  const code = backupCodes[0]!.replace("-", "");
  await svc.verifyTotpForLogin({ userId: "user-1", code });
  // Skal ikke kaste.
});

test("REQ-129: createChallenge + consumeChallenge happy path", async () => {
  const store = makeStore();
  const svc = TwoFactorService.forTesting(makePool(store));
  const { challengeId, expiresAt } = await svc.createChallenge("user-1");
  assert.ok(challengeId);
  assert.ok(new Date(expiresAt).getTime() > Date.now());
  const result = await svc.consumeChallenge(challengeId);
  assert.equal(result.userId, "user-1");
});

test("REQ-129: consumeChallenge avviser reuse", async () => {
  const store = makeStore();
  const svc = TwoFactorService.forTesting(makePool(store));
  const { challengeId } = await svc.createChallenge("user-1");
  await svc.consumeChallenge(challengeId);
  await assert.rejects(
    () => svc.consumeChallenge(challengeId),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_TWO_FA_CHALLENGE"
  );
});

test("REQ-129: consumeChallenge avviser utløpt challenge", async () => {
  const store = makeStore();
  const svc = TwoFactorService.forTesting(makePool(store));
  const { challengeId } = await svc.createChallenge("user-1");
  // Manipulér expires_at til fortid.
  const row = store.challenges.get(challengeId)!;
  row.expires_at = new Date(Date.now() - 1000);
  await assert.rejects(
    () => svc.consumeChallenge(challengeId),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_TWO_FA_CHALLENGE"
  );
});

test("REQ-129: disable krever korrekt TOTP-kode og fjerner 2FA", async () => {
  const store = makeStore();
  const svc = TwoFactorService.forTesting(makePool(store));
  const { secret } = await svc.setup({ userId: "user-1", accountLabel: "alice@example.com" });
  await svc.verifyAndEnable({ userId: "user-1", code: generateTotpCode(secret) });
  // Feil kode → avvist.
  await assert.rejects(
    () => svc.disable({ userId: "user-1", code: "000000" }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_TOTP_CODE"
  );
  // Riktig kode → 2FA borte.
  await svc.disable({ userId: "user-1", code: generateTotpCode(secret) });
  assert.equal(store.twofa.get("user-1"), undefined);
});

test("REQ-129: regenerateBackupCodes erstatter alle koder", async () => {
  const store = makeStore();
  const svc = TwoFactorService.forTesting(makePool(store));
  const { secret } = await svc.setup({ userId: "user-1", accountLabel: "alice@example.com" });
  const initial = await svc.verifyAndEnable({
    userId: "user-1",
    code: generateTotpCode(secret),
  });
  const { backupCodes: regenerated } = await svc.regenerateBackupCodes("user-1");
  assert.equal(regenerated.length, 10);
  // Gamle koder skal IKKE lenger fungere.
  await assert.rejects(
    () => svc.verifyTotpForLogin({ userId: "user-1", code: initial.backupCodes[0]! }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_TOTP_CODE"
  );
  // Nye koder skal fungere.
  await svc.verifyTotpForLogin({ userId: "user-1", code: regenerated[0]! });
});

test("REQ-129: getStatus speiler 2FA-tilstand", async () => {
  const store = makeStore();
  const svc = TwoFactorService.forTesting(makePool(store));
  // Før setup: alt false/0.
  let status = await svc.getStatus("user-1");
  assert.equal(status.enabled, false);
  assert.equal(status.backupCodesRemaining, 0);
  assert.equal(status.hasPendingSetup, false);

  // Etter setup men før verify: pending.
  const { secret } = await svc.setup({ userId: "user-1", accountLabel: "alice@example.com" });
  status = await svc.getStatus("user-1");
  assert.equal(status.enabled, false);
  assert.equal(status.hasPendingSetup, true);

  // Etter verify: enabled + 10 codes.
  await svc.verifyAndEnable({ userId: "user-1", code: generateTotpCode(secret) });
  status = await svc.getStatus("user-1");
  assert.equal(status.enabled, true);
  assert.equal(status.backupCodesRemaining, 10);
  assert.equal(status.hasPendingSetup, false);
  assert.notEqual(status.enabledAt, null);
});

test("REQ-129: isEnabled reflekterer enabled_secret", async () => {
  const store = makeStore();
  const svc = TwoFactorService.forTesting(makePool(store));
  assert.equal(await svc.isEnabled("user-1"), false);
  const { secret } = await svc.setup({ userId: "user-1", accountLabel: "alice@example.com" });
  assert.equal(await svc.isEnabled("user-1"), false); // pending only
  await svc.verifyAndEnable({ userId: "user-1", code: generateTotpCode(secret) });
  assert.equal(await svc.isEnabled("user-1"), true);
});
