/**
 * FileWalletAdapter — persistens + lock-tester.
 *
 * Eksisterende test-coverage er null på FileWalletAdapter. Den brukes som
 * disk-backed default-adapter i lokal dev og som fallback når Postgres ikke
 * er konfigurert. Disse testene dekker:
 *
 *   - Persistens på tvers av instanser (skriving + ny instance leser opp)
 *   - Migration av legacy `balance` → `depositBalance`
 *   - Negative paths (ACCOUNT_NOT_FOUND, INSUFFICIENT_FUNDS, INVALID_TRANSFER)
 *   - File-system mutex (sekvensielle samtidige operasjoner)
 *   - Reservasjons-flyt (in-memory på file-adapter siden PR 1)
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileWalletAdapter } from "./FileWalletAdapter.js";
import { WalletError } from "./WalletAdapter.js";

async function makeTempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "filewalletadapter-test-"));
}

// ── createAccount + persistens ─────────────────────────────────────────────

test("FileWalletAdapter: createAccount persisteres til disk", async () => {
  const dir = await makeTempDir();
  try {
    const filePath = path.join(dir, "wallets.json");
    const adapter = new FileWalletAdapter({ dataFilePath: filePath, defaultInitialBalance: 0 });
    await adapter.createAccount({ accountId: "w-1", initialBalance: 250 });

    // Ny instance leser fra samme fil
    const adapter2 = new FileWalletAdapter({ dataFilePath: filePath, defaultInitialBalance: 0 });
    const account = await adapter2.getAccount("w-1");
    assert.equal(account.balance, 250);
    assert.equal(account.depositBalance, 250);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("FileWalletAdapter: ACCOUNT_EXISTS uten allowExisting", async () => {
  const dir = await makeTempDir();
  try {
    const adapter = new FileWalletAdapter({
      dataFilePath: path.join(dir, "wallets.json"),
      defaultInitialBalance: 0,
    });
    await adapter.createAccount({ accountId: "w-1" });
    await assert.rejects(
      () => adapter.createAccount({ accountId: "w-1" }),
      (err: unknown) => err instanceof WalletError && err.code === "ACCOUNT_EXISTS",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("FileWalletAdapter: getAccount kastes ACCOUNT_NOT_FOUND for ukjent", async () => {
  const dir = await makeTempDir();
  try {
    const adapter = new FileWalletAdapter({ dataFilePath: path.join(dir, "wallets.json"), defaultInitialBalance: 0 });
    await assert.rejects(
      () => adapter.getAccount("ghost"),
      (err: unknown) => err instanceof WalletError && err.code === "ACCOUNT_NOT_FOUND",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("FileWalletAdapter: ensureAccount auto-opretter med default initial", async () => {
  const dir = await makeTempDir();
  try {
    const adapter = new FileWalletAdapter({ dataFilePath: path.join(dir, "wallets.json"), defaultInitialBalance: 500 });
    const account = await adapter.ensureAccount("w-new");
    assert.equal(account.balance, 500);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── Migration: legacy `balance` → `depositBalance` ─────────────────────────

test("FileWalletAdapter: migrerer legacy `balance`-felt til depositBalance ved load", async () => {
  const dir = await makeTempDir();
  try {
    const filePath = path.join(dir, "wallets.json");
    // Simuler eldre disk-format der `balance` er rotnivå-felt
    const legacy = {
      accounts: {
        "w-old": {
          id: "w-old",
          balance: 1234,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      },
      transactions: [],
    };
    await writeFile(filePath, JSON.stringify(legacy), "utf8");

    const adapter = new FileWalletAdapter({ dataFilePath: filePath, defaultInitialBalance: 0 });
    const account = await adapter.getAccount("w-old");
    assert.equal(account.depositBalance, 1234);
    assert.equal(account.winningsBalance, 0);
    assert.equal(account.balance, 1234);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("FileWalletAdapter: ny disk-format med depositBalance + winningsBalance bevares", async () => {
  const dir = await makeTempDir();
  try {
    const filePath = path.join(dir, "wallets.json");
    const newFormat = {
      accounts: {
        "w-1": {
          id: "w-1",
          depositBalance: 100,
          winningsBalance: 50,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      },
      transactions: [],
    };
    await writeFile(filePath, JSON.stringify(newFormat), "utf8");

    const adapter = new FileWalletAdapter({ dataFilePath: filePath, defaultInitialBalance: 0 });
    const account = await adapter.getAccount("w-1");
    assert.equal(account.depositBalance, 100);
    assert.equal(account.winningsBalance, 50);
    assert.equal(account.balance, 150);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── debit / credit / topUp / withdraw ─────────────────────────────────────

test("FileWalletAdapter: debit reduserer balance og persisteres", async () => {
  const dir = await makeTempDir();
  try {
    const filePath = path.join(dir, "wallets.json");
    const adapter = new FileWalletAdapter({ dataFilePath: filePath, defaultInitialBalance: 0 });
    await adapter.createAccount({ accountId: "w-1", initialBalance: 200 });
    await adapter.debit("w-1", 75, "test-debit");

    const adapter2 = new FileWalletAdapter({ dataFilePath: filePath, defaultInitialBalance: 0 });
    const balance = await adapter2.getBalance("w-1");
    assert.equal(balance, 125);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("FileWalletAdapter: debit INSUFFICIENT_FUNDS når total < amount", async () => {
  const dir = await makeTempDir();
  try {
    const adapter = new FileWalletAdapter({ dataFilePath: path.join(dir, "wallets.json"), defaultInitialBalance: 0 });
    await adapter.createAccount({ accountId: "w-1", initialBalance: 50 });
    await assert.rejects(
      () => adapter.debit("w-1", 100, "x"),
      (err: unknown) => err instanceof WalletError && err.code === "INSUFFICIENT_FUNDS",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("FileWalletAdapter: debit på ukjent konto → ACCOUNT_NOT_FOUND", async () => {
  const dir = await makeTempDir();
  try {
    const adapter = new FileWalletAdapter({ dataFilePath: path.join(dir, "wallets.json"), defaultInitialBalance: 0 });
    await assert.rejects(
      () => adapter.debit("ghost", 50, "x"),
      (err: unknown) => err instanceof WalletError && err.code === "ACCOUNT_NOT_FOUND",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("FileWalletAdapter: credit til winnings persisteres", async () => {
  const dir = await makeTempDir();
  try {
    const filePath = path.join(dir, "wallets.json");
    const adapter = new FileWalletAdapter({ dataFilePath: filePath, defaultInitialBalance: 0 });
    await adapter.createAccount({ accountId: "w-1", initialBalance: 100 });
    await adapter.credit("w-1", 50, "win", { to: "winnings" });

    const adapter2 = new FileWalletAdapter({ dataFilePath: filePath, defaultInitialBalance: 0 });
    const balances = await adapter2.getBothBalances("w-1");
    assert.equal(balances.deposit, 100);
    assert.equal(balances.winnings, 50);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("FileWalletAdapter: topUp persisteres", async () => {
  const dir = await makeTempDir();
  try {
    const filePath = path.join(dir, "wallets.json");
    const adapter = new FileWalletAdapter({ dataFilePath: filePath, defaultInitialBalance: 0 });
    await adapter.createAccount({ accountId: "w-1" });
    await adapter.topUp("w-1", 300, "deposit");

    const adapter2 = new FileWalletAdapter({ dataFilePath: filePath, defaultInitialBalance: 0 });
    const balance = await adapter2.getBalance("w-1");
    assert.equal(balance, 300);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("FileWalletAdapter: withdraw winnings-first persisteres", async () => {
  const dir = await makeTempDir();
  try {
    const filePath = path.join(dir, "wallets.json");
    const adapter = new FileWalletAdapter({ dataFilePath: filePath, defaultInitialBalance: 0 });
    await adapter.createAccount({ accountId: "w-1", initialBalance: 100 });
    await adapter.credit("w-1", 50, "win", { to: "winnings" });
    // withdraw 75 → 50 fra winnings + 25 fra deposit
    await adapter.withdraw("w-1", 75, "cashout");

    const balances = await adapter.getBothBalances("w-1");
    assert.equal(balances.winnings, 0);
    assert.equal(balances.deposit, 75);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── transfer ───────────────────────────────────────────────────────────────

test("FileWalletAdapter: transfer mellom kontoer persisteres", async () => {
  const dir = await makeTempDir();
  try {
    const filePath = path.join(dir, "wallets.json");
    const adapter = new FileWalletAdapter({ dataFilePath: filePath, defaultInitialBalance: 0 });
    await adapter.createAccount({ accountId: "w-1", initialBalance: 200 });
    await adapter.createAccount({ accountId: "w-2", initialBalance: 0 });
    await adapter.transfer("w-1", "w-2", 75, "payout");

    const adapter2 = new FileWalletAdapter({ dataFilePath: filePath, defaultInitialBalance: 0 });
    assert.equal(await adapter2.getBalance("w-1"), 125);
    assert.equal(await adapter2.getBalance("w-2"), 75);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("FileWalletAdapter: transfer til samme wallet → INVALID_TRANSFER", async () => {
  const dir = await makeTempDir();
  try {
    const adapter = new FileWalletAdapter({ dataFilePath: path.join(dir, "wallets.json"), defaultInitialBalance: 0 });
    await adapter.createAccount({ accountId: "w-1", initialBalance: 100 });
    await assert.rejects(
      () => adapter.transfer("w-1", "w-1", 50),
      (err: unknown) => err instanceof WalletError && err.code === "INVALID_TRANSFER",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("FileWalletAdapter: transfer fra ukjent konto → ACCOUNT_NOT_FOUND", async () => {
  const dir = await makeTempDir();
  try {
    const adapter = new FileWalletAdapter({ dataFilePath: path.join(dir, "wallets.json"), defaultInitialBalance: 0 });
    await adapter.createAccount({ accountId: "w-2" });
    await assert.rejects(
      () => adapter.transfer("ghost", "w-2", 50),
      (err: unknown) => err instanceof WalletError && err.code === "ACCOUNT_NOT_FOUND",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("FileWalletAdapter: transfer til ukjent konto → ACCOUNT_NOT_FOUND", async () => {
  const dir = await makeTempDir();
  try {
    const adapter = new FileWalletAdapter({ dataFilePath: path.join(dir, "wallets.json"), defaultInitialBalance: 0 });
    await adapter.createAccount({ accountId: "w-1", initialBalance: 100 });
    await assert.rejects(
      () => adapter.transfer("w-1", "ghost", 50),
      (err: unknown) => err instanceof WalletError && err.code === "ACCOUNT_NOT_FOUND",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("FileWalletAdapter: transfer med targetSide=winnings persisteres", async () => {
  const dir = await makeTempDir();
  try {
    const filePath = path.join(dir, "wallets.json");
    const adapter = new FileWalletAdapter({ dataFilePath: filePath, defaultInitialBalance: 0 });
    await adapter.createAccount({ accountId: "house", initialBalance: 1000 });
    await adapter.createAccount({ accountId: "player", initialBalance: 0 });
    await adapter.transfer("house", "player", 250, "payout", { targetSide: "winnings" });

    const balances = await adapter.getBothBalances("player");
    assert.equal(balances.winnings, 250);
    assert.equal(balances.deposit, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── listTransactions ───────────────────────────────────────────────────────

test("FileWalletAdapter: listTransactions returnerer per-account-tx i revers", async () => {
  const dir = await makeTempDir();
  try {
    const filePath = path.join(dir, "wallets.json");
    const adapter = new FileWalletAdapter({ dataFilePath: filePath, defaultInitialBalance: 0 });
    await adapter.createAccount({ accountId: "w-1" });
    await adapter.topUp("w-1", 100, "topup-1");
    await adapter.topUp("w-1", 50, "topup-2");
    const txs = await adapter.listTransactions("w-1");
    assert.equal(txs[0].reason, "topup-2");
    assert.equal(txs[1].reason, "topup-1");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("FileWalletAdapter: listTransactions på ukjent → ACCOUNT_NOT_FOUND", async () => {
  const dir = await makeTempDir();
  try {
    const adapter = new FileWalletAdapter({ dataFilePath: path.join(dir, "wallets.json"), defaultInitialBalance: 0 });
    await assert.rejects(
      () => adapter.listTransactions("ghost"),
      (err: unknown) => err instanceof WalletError && err.code === "ACCOUNT_NOT_FOUND",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── Mutex / sekvensielle samtidige operasjoner ─────────────────────────────

test("FileWalletAdapter: samtidige debits serialiseres via mutex (ingen race)", async () => {
  const dir = await makeTempDir();
  try {
    const adapter = new FileWalletAdapter({ dataFilePath: path.join(dir, "wallets.json"), defaultInitialBalance: 0 });
    await adapter.createAccount({ accountId: "w-1", initialBalance: 1000 });

    // 10 samtidige debits a 50 = 500 totalt
    const ops = Array.from({ length: 10 }, (_, i) => adapter.debit("w-1", 50, `tx-${i}`));
    await Promise.all(ops);

    const balance = await adapter.getBalance("w-1");
    assert.equal(balance, 500, "alle 10 debits gikk gjennom uten dobbel-debit");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("FileWalletAdapter: parallel topUp + debit lander på korrekt sluttsaldo", async () => {
  const dir = await makeTempDir();
  try {
    const adapter = new FileWalletAdapter({ dataFilePath: path.join(dir, "wallets.json"), defaultInitialBalance: 0 });
    await adapter.createAccount({ accountId: "w-1", initialBalance: 100 });
    // Mix of topup + debit i parallel
    await Promise.all([
      adapter.topUp("w-1", 50, "tx-1"),
      adapter.topUp("w-1", 25, "tx-2"),
      adapter.debit("w-1", 30, "tx-3"),
    ]);
    // 100 + 50 + 25 - 30 = 145
    const balance = await adapter.getBalance("w-1");
    assert.equal(balance, 145);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── listAccounts ───────────────────────────────────────────────────────────

test("FileWalletAdapter: listAccounts persisteres på tvers av instanser", async () => {
  const dir = await makeTempDir();
  try {
    const filePath = path.join(dir, "wallets.json");
    const adapter = new FileWalletAdapter({ dataFilePath: filePath, defaultInitialBalance: 0 });
    await adapter.createAccount({ accountId: "w-1" });
    await adapter.createAccount({ accountId: "w-2" });

    const adapter2 = new FileWalletAdapter({ dataFilePath: filePath, defaultInitialBalance: 0 });
    const accounts = await adapter2.listAccounts();
    assert.equal(accounts.length, 2);
    const ids = new Set(accounts.map((a) => a.id));
    assert.ok(ids.has("w-1"));
    assert.ok(ids.has("w-2"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── Reservasjons-flyt (in-memory på FileWalletAdapter) ─────────────────────

test("FileWalletAdapter: reserve → commit oppdaterer disk-saldo (men reservasjon ikke persistert)", async () => {
  const dir = await makeTempDir();
  try {
    const filePath = path.join(dir, "wallets.json");
    const adapter = new FileWalletAdapter({ dataFilePath: filePath, defaultInitialBalance: 0 });
    await adapter.createAccount({ accountId: "w-1", initialBalance: 500 });
    await adapter.createAccount({ accountId: "house", initialBalance: 0 });

    const reservation = await adapter.reserve("w-1", 100, {
      idempotencyKey: "k-1",
      roomCode: "R1",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await adapter.commitReservation(reservation.id, "house", "buyin");

    const adapter2 = new FileWalletAdapter({ dataFilePath: filePath, defaultInitialBalance: 0 });
    assert.equal(await adapter2.getBalance("w-1"), 400);
    assert.equal(await adapter2.getBalance("house"), 100);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("FileWalletAdapter: getAvailableBalance trekker fra aktive reservasjoner", async () => {
  const dir = await makeTempDir();
  try {
    const adapter = new FileWalletAdapter({ dataFilePath: path.join(dir, "wallets.json"), defaultInitialBalance: 0 });
    await adapter.createAccount({ accountId: "w-1", initialBalance: 500 });
    await adapter.reserve("w-1", 200, {
      idempotencyKey: "k-1",
      roomCode: "R1",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const available = await adapter.getAvailableBalance("w-1");
    assert.equal(available, 300);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("FileWalletAdapter: reserve INSUFFICIENT_FUNDS når available < amount", async () => {
  const dir = await makeTempDir();
  try {
    const adapter = new FileWalletAdapter({ dataFilePath: path.join(dir, "wallets.json"), defaultInitialBalance: 0 });
    await adapter.createAccount({ accountId: "w-1", initialBalance: 100 });
    await assert.rejects(
      () =>
        adapter.reserve("w-1", 200, {
          idempotencyKey: "k-1",
          roomCode: "R1",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }),
      (err: unknown) => err instanceof WalletError && err.code === "INSUFFICIENT_FUNDS",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("FileWalletAdapter: expireStaleReservations markerer expired (in-memory)", async () => {
  const dir = await makeTempDir();
  try {
    const adapter = new FileWalletAdapter({ dataFilePath: path.join(dir, "wallets.json"), defaultInitialBalance: 0 });
    await adapter.createAccount({ accountId: "w-1", initialBalance: 500 });
    await adapter.reserve("w-1", 100, {
      idempotencyKey: "stale",
      roomCode: "R1",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const count = await adapter.expireStaleReservations(Date.now());
    assert.equal(count, 1);

    const active = await adapter.listActiveReservations("w-1");
    assert.equal(active.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
