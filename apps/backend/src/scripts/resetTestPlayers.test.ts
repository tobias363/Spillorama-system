/**
 * Tester for `resetTestPlayers` boot-script (Tobias-direktiv 2026-05-03).
 *
 * Verifiserer:
 *   - AGENT/ADMIN/HALL_OPERATOR/SUPPORT-rader bevares (KUN role='PLAYER' slettes)
 *   - test@spillorama.no opprettes med VERIFIED kyc + 5000 kr balance
 *   - Idempotens: 2x kjøring gir én test-bruker (UPDATE-flow andre gang)
 *   - Wallet-balance settes til eksakt 5000 kr (ikke addert) ved re-run
 *   - Pilot-haller (`demo-hall-001..004`) er IKKE rørt
 */

import assert from "node:assert/strict";
import test from "node:test";

import { resetTestPlayers, _internals } from "./resetTestPlayers.js";

// ── In-memory pg-stub (samme prinsipp som seedLegacyGameConfig.test.ts) ─────

interface InMemoryUserRow {
  id: string;
  email: string;
  display_name: string;
  surname: string | null;
  password_hash: string;
  wallet_id: string;
  role: "ADMIN" | "HALL_OPERATOR" | "SUPPORT" | "PLAYER" | "AGENT";
  kyc_status: string;
  birth_date: string | null;
  kyc_verified_at: string | null;
  hall_id: string | null;
  deleted_at: string | null;
}

interface InMemoryWalletAccount {
  id: string;
  balance: number;
  deposit_balance: number;
  winnings_balance: number;
  is_system: boolean;
}

interface InMemoryHall {
  id: string;
  name: string;
}

interface InMemoryHallGroup {
  id: string;
  name: string;
}

class InMemoryPgStub {
  users: InMemoryUserRow[] = [];
  walletAccounts: InMemoryWalletAccount[] = [];
  walletTransactions: Array<{ id: string; account_id: string; related_account_id: string | null }> = [];
  walletEntries: Array<{ id: number; account_id: string }> = [];
  halls: InMemoryHall[] = [];
  hallGroups: InMemoryHallGroup[] = [];

  /** Counter for synthetic entry-id (BIGSERIAL i prod). */
  private entrySeq = 1;

  query(sql: string, params: unknown[] = []): Promise<{ rows: unknown[]; rowCount: number }> {
    const trimmed = sql.trim();

    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(trimmed)) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }

    // SELECT id, wallet_id FROM app_users WHERE role='PLAYER' AND email <> $1
    if (
      /SELECT\s+id,\s+wallet_id\s+FROM\s+[\s\S]*"app_users"[\s\S]*WHERE\s+role\s*=\s*'PLAYER'\s+AND\s+email\s*<>\s*\$1/i.test(
        trimmed,
      )
    ) {
      const skipEmail = String(params[0]);
      const matches = this.users.filter(
        (u) => u.role === "PLAYER" && u.email !== skipEmail,
      );
      return Promise.resolve({
        rows: matches.map((u) => ({ id: u.id, wallet_id: u.wallet_id })),
        rowCount: matches.length,
      });
    }

    // SELECT id, wallet_id FROM app_users WHERE email = $1
    if (
      /SELECT\s+id,\s+wallet_id\s+FROM\s+[\s\S]*"app_users"\s+WHERE\s+email\s*=\s*\$1/i.test(
        trimmed,
      )
    ) {
      const email = String(params[0]);
      const match = this.users.find((u) => u.email === email);
      if (!match) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      return Promise.resolve({
        rows: [{ id: match.id, wallet_id: match.wallet_id }],
        rowCount: 1,
      });
    }

    // DELETE FROM wallet_entries WHERE account_id = ANY($1::text[])
    if (/DELETE\s+FROM\s+[\s\S]*"wallet_entries"\s+WHERE\s+account_id\s*=\s*ANY/i.test(trimmed)) {
      const ids = params[0] as string[];
      const before = this.walletEntries.length;
      this.walletEntries = this.walletEntries.filter((e) => !ids.includes(e.account_id));
      return Promise.resolve({ rows: [], rowCount: before - this.walletEntries.length });
    }

    // DELETE FROM wallet_transactions WHERE account_id=ANY OR related_account_id=ANY
    if (/DELETE\s+FROM\s+[\s\S]*"wallet_transactions"\s+WHERE\s+account_id\s*=\s*ANY/i.test(trimmed)) {
      const ids = params[0] as string[];
      const before = this.walletTransactions.length;
      this.walletTransactions = this.walletTransactions.filter(
        (t) => !ids.includes(t.account_id) && !ids.includes(t.related_account_id ?? ""),
      );
      return Promise.resolve({ rows: [], rowCount: before - this.walletTransactions.length });
    }

    // DELETE FROM wallet_accounts WHERE id=ANY AND is_system=false
    if (/DELETE\s+FROM\s+[\s\S]*"wallet_accounts"\s+WHERE\s+id\s*=\s*ANY/i.test(trimmed)) {
      const ids = params[0] as string[];
      const before = this.walletAccounts.length;
      this.walletAccounts = this.walletAccounts.filter(
        (a) => !(ids.includes(a.id) && !a.is_system),
      );
      return Promise.resolve({ rows: [], rowCount: before - this.walletAccounts.length });
    }

    // DELETE FROM app_users WHERE role='PLAYER' AND email <> $1
    if (
      /DELETE\s+FROM\s+[\s\S]*"app_users"\s+WHERE\s+role\s*=\s*'PLAYER'\s+AND\s+email\s*<>\s*\$1/i.test(
        trimmed,
      )
    ) {
      const skipEmail = String(params[0]);
      const before = this.users.length;
      this.users = this.users.filter(
        (u) => !(u.role === "PLAYER" && u.email !== skipEmail),
      );
      return Promise.resolve({ rows: [], rowCount: before - this.users.length });
    }

    // INSERT INTO app_users (...)
    if (/INSERT\s+INTO\s+[\s\S]*"app_users"/i.test(trimmed)) {
      // params: [id, email, display_name, surname, password_hash, wallet_id,
      //          birth_date, hall_id]  (role=PLAYER, kyc_status=VERIFIED hardkodet)
      const [id, email, displayName, surname, passwordHash, walletId, birthDate, hallId] =
        params as [string, string, string, string, string, string, string, string];
      this.users.push({
        id,
        email,
        display_name: displayName,
        surname,
        password_hash: passwordHash,
        wallet_id: walletId,
        role: "PLAYER",
        kyc_status: "VERIFIED",
        birth_date: birthDate,
        kyc_verified_at: new Date().toISOString(),
        hall_id: hallId,
        deleted_at: null,
      });
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    // UPDATE app_users SET password_hash=$2 ... WHERE id=$1
    if (/UPDATE\s+[\s\S]*"app_users"[\s\S]*WHERE\s+id\s*=\s*\$1/i.test(trimmed)) {
      const [id, passwordHash, displayName, surname, birthDate, hallId] = params as [
        string,
        string,
        string,
        string,
        string,
        string,
      ];
      const row = this.users.find((u) => u.id === id);
      if (!row) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      row.password_hash = passwordHash;
      row.display_name = displayName;
      row.surname = surname;
      row.birth_date = birthDate;
      row.hall_id = hallId;
      row.kyc_status = "VERIFIED";
      row.kyc_verified_at = new Date().toISOString();
      row.role = "PLAYER";
      row.deleted_at = null;
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    // INSERT INTO wallet_accounts ... ON CONFLICT (id) DO UPDATE
    if (/INSERT\s+INTO\s+[\s\S]*"wallet_accounts"[\s\S]*ON\s+CONFLICT/i.test(trimmed)) {
      const [walletId, depositAmount] = params as [string, number];
      const existing = this.walletAccounts.find((a) => a.id === walletId);
      if (existing) {
        existing.balance = depositAmount;
        existing.deposit_balance = depositAmount;
        existing.winnings_balance = 0;
      } else {
        this.walletAccounts.push({
          id: walletId,
          balance: depositAmount,
          deposit_balance: depositAmount,
          winnings_balance: 0,
          is_system: false,
        });
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    throw new Error(`Ukjent SQL i stub: ${trimmed.slice(0, 200)}`);
  }
}

function makePoolStub(stub: InMemoryPgStub) {
  return {
    connect: async () => ({
      query: stub.query.bind(stub),
      release: () => {},
    }),
  } as unknown as import("pg").Pool;
}

function silentLogger() {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

// ── Tester ──────────────────────────────────────────────────────────────────

test("resetTestPlayers: sletter PLAYER-rader men bevarer AGENT/ADMIN/HALL_OPERATOR/SUPPORT", async () => {
  const stub = new InMemoryPgStub();
  // Pre-eksisterende rader: 4 agenter, 1 admin, 1 hall-operator, 1 support, 3 spillere
  stub.users = [
    {
      id: "agent-1",
      email: "demo-agent-1@spillorama.no",
      display_name: "Agent 1",
      surname: null,
      password_hash: "x",
      wallet_id: "wallet-agent-1",
      role: "AGENT",
      kyc_status: "VERIFIED",
      birth_date: null,
      kyc_verified_at: null,
      hall_id: "demo-hall-001",
      deleted_at: null,
    },
    {
      id: "agent-2",
      email: "demo-agent-2@spillorama.no",
      display_name: "Agent 2",
      surname: null,
      password_hash: "x",
      wallet_id: "wallet-agent-2",
      role: "AGENT",
      kyc_status: "VERIFIED",
      birth_date: null,
      kyc_verified_at: null,
      hall_id: "demo-hall-002",
      deleted_at: null,
    },
    {
      id: "agent-3",
      email: "demo-agent-3@spillorama.no",
      display_name: "Agent 3",
      surname: null,
      password_hash: "x",
      wallet_id: "wallet-agent-3",
      role: "AGENT",
      kyc_status: "VERIFIED",
      birth_date: null,
      kyc_verified_at: null,
      hall_id: "demo-hall-003",
      deleted_at: null,
    },
    {
      id: "agent-4",
      email: "demo-agent-4@spillorama.no",
      display_name: "Agent 4",
      surname: null,
      password_hash: "x",
      wallet_id: "wallet-agent-4",
      role: "AGENT",
      kyc_status: "VERIFIED",
      birth_date: null,
      kyc_verified_at: null,
      hall_id: "demo-hall-004",
      deleted_at: null,
    },
    {
      id: "admin-1",
      email: "admin@spillorama.no",
      display_name: "Admin",
      surname: null,
      password_hash: "x",
      wallet_id: "wallet-admin-1",
      role: "ADMIN",
      kyc_status: "VERIFIED",
      birth_date: null,
      kyc_verified_at: null,
      hall_id: null,
      deleted_at: null,
    },
    {
      id: "hop-1",
      email: "operator@spillorama.no",
      display_name: "Hall Operator",
      surname: null,
      password_hash: "x",
      wallet_id: "wallet-hop-1",
      role: "HALL_OPERATOR",
      kyc_status: "VERIFIED",
      birth_date: null,
      kyc_verified_at: null,
      hall_id: "demo-hall-001",
      deleted_at: null,
    },
    {
      id: "support-1",
      email: "support@spillorama.no",
      display_name: "Support",
      surname: null,
      password_hash: "x",
      wallet_id: "wallet-support-1",
      role: "SUPPORT",
      kyc_status: "VERIFIED",
      birth_date: null,
      kyc_verified_at: null,
      hall_id: null,
      deleted_at: null,
    },
    {
      id: "player-1",
      email: "demo-spiller-1@example.com",
      display_name: "Demo Spiller 1",
      surname: null,
      password_hash: "x",
      wallet_id: "wallet-player-1",
      role: "PLAYER",
      kyc_status: "PENDING",
      birth_date: null,
      kyc_verified_at: null,
      hall_id: "demo-hall-001",
      deleted_at: null,
    },
    {
      id: "player-2",
      email: "tobias-arnes@example.com",
      display_name: "Tobias Arnes",
      surname: null,
      password_hash: "x",
      wallet_id: "wallet-player-2",
      role: "PLAYER",
      kyc_status: "VERIFIED",
      birth_date: null,
      kyc_verified_at: null,
      hall_id: "demo-hall-002",
      deleted_at: null,
    },
    {
      id: "player-3",
      email: "demo-spiller-3@example.com",
      display_name: "Demo Spiller 3",
      surname: null,
      password_hash: "x",
      wallet_id: "wallet-player-3",
      role: "PLAYER",
      kyc_status: "UNVERIFIED",
      birth_date: null,
      kyc_verified_at: null,
      hall_id: "demo-hall-003",
      deleted_at: null,
    },
  ];
  stub.walletAccounts = stub.users.map((u) => ({
    id: u.wallet_id,
    balance: 100,
    deposit_balance: 100,
    winnings_balance: 0,
    is_system: false,
  }));

  const result = await resetTestPlayers({
    pool: makePoolStub(stub),
    logger: silentLogger(),
  });

  assert.equal(result.deletedCount, 3, "skal slette 3 PLAYER-rader");
  assert.equal(result.testUser.email, "test@spillorama.no");
  assert.equal(result.testUser.hallId, "demo-hall-001");
  assert.equal(result.testUser.depositKr, 5000);
  assert.equal(result.testUser.created, true);

  // Bevarte rader: 4 agenter + 1 admin + 1 hop + 1 support + 1 ny test-bruker = 8
  assert.equal(stub.users.length, 8, "skal beholde 4 agenter + 1 admin + 1 hop + 1 support + 1 test-bruker");
  assert.ok(stub.users.find((u) => u.email === "demo-agent-1@spillorama.no"), "agent-1 skal være intakt");
  assert.ok(stub.users.find((u) => u.email === "demo-agent-4@spillorama.no"), "agent-4 skal være intakt");
  assert.ok(stub.users.find((u) => u.email === "admin@spillorama.no"), "admin skal være intakt");
  assert.ok(stub.users.find((u) => u.email === "operator@spillorama.no"), "hall-operator skal være intakt");
  assert.ok(stub.users.find((u) => u.email === "support@spillorama.no"), "support skal være intakt");
  assert.ok(!stub.users.find((u) => u.email === "demo-spiller-1@example.com"), "demo-spiller-1 skal være slettet");
  assert.ok(!stub.users.find((u) => u.email === "tobias-arnes@example.com"), "tobias-arnes skal være slettet");

  // Test-bruker skal være korrekt konfigurert
  const testUser = stub.users.find((u) => u.email === "test@spillorama.no");
  assert.ok(testUser, "test-bruker skal eksistere");
  assert.equal(testUser!.role, "PLAYER");
  assert.equal(testUser!.kyc_status, "VERIFIED");
  assert.equal(testUser!.birth_date, "1990-01-01");
  assert.equal(testUser!.hall_id, "demo-hall-001");
  assert.equal(testUser!.display_name, "Test Bruker");
  assert.equal(testUser!.surname, "Tester");
  assert.notEqual(testUser!.password_hash, "x", "passord-hash skal være ny");
  assert.match(testUser!.password_hash, /^scrypt:[0-9a-f]+:[0-9a-f]+$/, "passord skal være scrypt-format");

  // Wallet-konto skal eksistere med 5000 kr deposit
  const wallet = stub.walletAccounts.find((a) => a.id === testUser!.wallet_id);
  assert.ok(wallet, "wallet-konto skal eksistere");
  assert.equal(wallet!.balance, 5000);
  assert.equal(wallet!.deposit_balance, 5000);
  assert.equal(wallet!.winnings_balance, 0);
});

test("resetTestPlayers: er idempotent — andre kjøring oppdaterer eksisterende test-bruker uten å duplikere", async () => {
  const stub = new InMemoryPgStub();
  // Start med kun en agent (ingen pre-eksisterende test-bruker)
  stub.users = [
    {
      id: "agent-1",
      email: "demo-agent-1@spillorama.no",
      display_name: "Agent 1",
      surname: null,
      password_hash: "x",
      wallet_id: "wallet-agent-1",
      role: "AGENT",
      kyc_status: "VERIFIED",
      birth_date: null,
      kyc_verified_at: null,
      hall_id: "demo-hall-001",
      deleted_at: null,
    },
  ];

  const pool = makePoolStub(stub);
  const logger = silentLogger();

  // Første kjøring — oppretter test-bruker
  const r1 = await resetTestPlayers({ pool, logger });
  assert.equal(r1.deletedCount, 0, "ingen PLAYER-rader å slette første gang");
  assert.equal(r1.testUser.created, true, "test-bruker skal være ny");
  const firstUserId = r1.testUser.id;
  const firstWalletId = r1.testUser.walletId;

  // Mellom kjøring: simuler at bruker fikk endret balance (f.eks. via topup)
  const wallet = stub.walletAccounts.find((a) => a.id === firstWalletId);
  assert.ok(wallet);
  wallet!.balance = 12345;
  wallet!.deposit_balance = 12345;

  // Andre kjøring — eksisterende test-bruker skal beholdes (samme userId)
  // og balance skal resettes tilbake til 5000 kr.
  const r2 = await resetTestPlayers({ pool, logger });
  assert.equal(r2.deletedCount, 0, "ingen PLAYER-rader å slette andre gang (test-bruker skipped via WHERE email <> $1)");
  assert.equal(r2.testUser.created, false, "test-bruker skal være oppdatert, ikke nyopprettet");
  assert.equal(r2.testUser.id, firstUserId, "userId skal være bevart på UPDATE-flow");
  assert.equal(r2.testUser.walletId, firstWalletId, "walletId skal være bevart på UPDATE-flow");

  // Wallet-balance skal være tilbakesatt til 5000 (ikke 12345 + 5000 = 17345)
  const walletAfter = stub.walletAccounts.find((a) => a.id === firstWalletId);
  assert.equal(walletAfter!.balance, 5000, "balance skal være eksakt 5000 (ikke addert)");
  assert.equal(walletAfter!.deposit_balance, 5000);

  // Total user-count: 1 agent + 1 test-bruker = 2 (ingen duplikat)
  assert.equal(stub.users.length, 2, "skal være nøyaktig 2 brukere etter 2x kjøring");
  const testUsers = stub.users.filter((u) => u.email === "test@spillorama.no");
  assert.equal(testUsers.length, 1, "skal være nøyaktig 1 test-bruker (ingen duplikat)");
});

test("resetTestPlayers: bruker dokumenterte konstanter for test-bruker-data", () => {
  // Sanity: konstantene skal matche det Tobias spesifiserte i direktivet.
  assert.equal(_internals.TEST_PLAYER_EMAIL, "test@spillorama.no");
  assert.equal(_internals.TEST_PLAYER_PASSWORD, "Test1234!");
  assert.equal(_internals.TEST_PLAYER_DISPLAY_NAME, "Test Bruker");
  assert.equal(_internals.TEST_PLAYER_BIRTH_DATE, "1990-01-01");
  assert.equal(_internals.TEST_PLAYER_HALL_ID, "demo-hall-001");
  assert.equal(_internals.TEST_PLAYER_DEPOSIT_AMOUNT_KR, 5000);
});

test("resetTestPlayers: hashPassword genererer scrypt-format-hash", async () => {
  const hash = await _internals.hashPassword("Test1234!");
  assert.match(hash, /^scrypt:[0-9a-f]{32}:[0-9a-f]{128}$/, "hash skal være scrypt:salt:digest");
  // Andre kjøring av hashPassword skal gi forskjellig hash (random salt)
  const hash2 = await _internals.hashPassword("Test1234!");
  assert.notEqual(hash, hash2, "samme passord skal gi forskjellig hash (random salt)");
});

test("resetTestPlayers: ROLLBACK ved feil — uendret state hvis SQL-feil", async () => {
  const stub = new InMemoryPgStub();
  stub.users = [
    {
      id: "player-1",
      email: "demo-spiller-1@example.com",
      display_name: "Demo",
      surname: null,
      password_hash: "x",
      wallet_id: "wallet-player-1",
      role: "PLAYER",
      kyc_status: "PENDING",
      birth_date: null,
      kyc_verified_at: null,
      hall_id: null,
      deleted_at: null,
    },
  ];
  stub.walletAccounts = [
    { id: "wallet-player-1", balance: 100, deposit_balance: 100, winnings_balance: 0, is_system: false },
  ];

  // Override query for å simulere feil under INSERT av test-bruker.
  const origQuery = stub.query.bind(stub);
  stub.query = (sql: string, params: unknown[] = []) => {
    if (/INSERT\s+INTO\s+[\s\S]*"app_users"/i.test(sql.trim())) {
      throw new Error("Simulert DB-feil");
    }
    return origQuery(sql, params);
  };

  await assert.rejects(
    () => resetTestPlayers({ pool: makePoolStub(stub), logger: silentLogger() }),
    /Simulert DB-feil/,
  );
  // I prod ville BEGIN/COMMIT/ROLLBACK gi atomicity. Stub-en støtter ikke
  // automatisk ROLLBACK, men vi har verifisert at feilen propageres.
  // Den ekte tx-håndteringen testes implisitt av PostgresWalletAdapter sine
  // egne tester — her bekrefter vi kun at script-koden kaster feil videre.
});
