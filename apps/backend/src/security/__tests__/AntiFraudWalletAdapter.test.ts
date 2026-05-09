/**
 * BIN-806 A13: integration-style tester for AntiFraudWalletAdapter.
 *
 * Verifiserer at decoratoren:
 *   - kjører `assessTransaction` på debit/credit/topUp/withdraw/transfer
 *     når caller har sendt `antiFraudContext`
 *   - kaster `FRAUD_RISK_CRITICAL` når assessment returnerer critical
 *   - er pass-through når caller ikke sender `antiFraudContext`
 *   - ikke kaller assess på read-operasjoner
 */

import "../walletAdapterAugmentation.js";
import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { AntiFraudService } from "../AntiFraudService.js";
import { AntiFraudWalletAdapter } from "../AntiFraudWalletAdapter.js";
import { DomainError } from "../../errors/DomainError.js";
import { InMemoryWalletAdapter } from "../../adapters/InMemoryWalletAdapter.js";

// Lightweight pg.Pool stub som matcher AntiFraudService sin in-memory test-stub.
function emptyPool(): Pool {
  return {
    query: async () => ({ rows: [], rowCount: 0 }),
    connect: async () => ({
      query: async () => ({ rows: [], rowCount: 0 }),
      release: () => {},
    }),
  } as unknown as Pool;
}

test("AntiFraudWalletAdapter: pass-through når antiFraudContext mangler", async () => {
  const inner = new InMemoryWalletAdapter();
  const account = await inner.createAccount({ initialBalance: 1000 });
  const svc = AntiFraudService.forTesting(emptyPool());

  let assessCalls = 0;
  const origAssess = svc.assessTransaction.bind(svc);
  svc.assessTransaction = async (input) => {
    assessCalls += 1;
    return origAssess(input);
  };

  const wrapped = new AntiFraudWalletAdapter(inner, svc);
  const tx = await wrapped.debit(account.id, 100, "test");
  assert.equal(tx.amount, 100);
  assert.equal(assessCalls, 0, "ingen assess-calls når context mangler");
});

test("AntiFraudWalletAdapter: kjører assess når antiFraudContext er satt", async () => {
  const inner = new InMemoryWalletAdapter();
  const account = await inner.createAccount({ initialBalance: 1000 });
  const svc = AntiFraudService.forTesting(emptyPool());

  let assessCalls = 0;
  let lastAssessArgs: unknown = null;
  svc.assessTransaction = async (input) => {
    assessCalls += 1;
    lastAssessArgs = input;
    return {
      risk: "low",
      signals: [],
      actionTaken: "logged",
      signalId: "sig-1",
    };
  };

  const wrapped = new AntiFraudWalletAdapter(inner, svc);
  await wrapped.debit(account.id, 100, "test", {
    antiFraudContext: {
      userId: "u1",
      hallId: "hall-a",
      ipAddress: "192.0.2.1",
    },
  });
  assert.equal(assessCalls, 1);
  const args = lastAssessArgs as { userId: string; hallId: string; ipAddress: string; operationType: string; amountCents: number };
  assert.equal(args.userId, "u1");
  assert.equal(args.hallId, "hall-a");
  assert.equal(args.ipAddress, "192.0.2.1");
  assert.equal(args.operationType, "DEBIT");
  assert.equal(args.amountCents, 10000); // 100 kr → 10 000 øre
});

test("AntiFraudWalletAdapter: kaster FRAUD_RISK_CRITICAL ved critical risk", async () => {
  const inner = new InMemoryWalletAdapter();
  const account = await inner.createAccount({ initialBalance: 10000 });
  const svc = AntiFraudService.forTesting(emptyPool());
  svc.assessTransaction = async () => ({
    risk: "critical",
    signals: [{ code: "VELOCITY_HOUR", level: "critical", meta: { count: 70 } }],
    actionTaken: "blocked",
    signalId: "sig-block",
  });

  const wrapped = new AntiFraudWalletAdapter(inner, svc);
  const before = await inner.getBalance(account.id);
  await assert.rejects(
    () =>
      wrapped.debit(account.id, 100, "test", {
        antiFraudContext: { userId: "u1" },
      }),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "FRAUD_RISK_CRITICAL");
      return true;
    },
  );
  const after = await inner.getBalance(account.id);
  assert.equal(after, before, "wallet uberørt etter blokkert tx");
});

test("AntiFraudWalletAdapter: high-risk tillater men logges", async () => {
  const inner = new InMemoryWalletAdapter();
  const account = await inner.createAccount({ initialBalance: 1000 });
  const svc = AntiFraudService.forTesting(emptyPool());
  svc.assessTransaction = async () => ({
    risk: "high",
    signals: [{ code: "VELOCITY_HOUR", level: "high", meta: { count: 35 } }],
    actionTaken: "flagged_for_review",
    signalId: "sig-flag",
  });

  const wrapped = new AntiFraudWalletAdapter(inner, svc);
  const tx = await wrapped.debit(account.id, 100, "test", {
    antiFraudContext: { userId: "u1" },
  });
  assert.equal(tx.amount, 100); // tx gikk gjennom
});

test("AntiFraudWalletAdapter: read-operasjoner kaller IKKE assess", async () => {
  const inner = new InMemoryWalletAdapter();
  const account = await inner.createAccount({ initialBalance: 500 });
  const svc = AntiFraudService.forTesting(emptyPool());
  let assessCalls = 0;
  svc.assessTransaction = async () => {
    assessCalls += 1;
    return { risk: "low", signals: [], actionTaken: "logged", signalId: "x" };
  };

  const wrapped = new AntiFraudWalletAdapter(inner, svc);
  await wrapped.getBalance(account.id);
  await wrapped.getAccount(account.id);
  await wrapped.listAccounts();
  await wrapped.listTransactions(account.id, 5);
  assert.equal(assessCalls, 0);
});

test("AntiFraudWalletAdapter: assessment-feil ≠ FRAUD_RISK_CRITICAL fail-open", async () => {
  // Hvis selve assessment-tjenesten kaster (ikke en risk-vurdering, men en
  // intern feil), skal pipeline IKKE blokkere wallet — det er fail-open by
  // design så DB-down ikke tar ned wallet-flow.
  const inner = new InMemoryWalletAdapter();
  const account = await inner.createAccount({ initialBalance: 1000 });
  const svc = AntiFraudService.forTesting(emptyPool());
  svc.assessTransaction = async () => {
    throw new Error("DB down");
  };

  const wrapped = new AntiFraudWalletAdapter(inner, svc);
  const tx = await wrapped.debit(account.id, 100, "test", {
    antiFraudContext: { userId: "u1" },
  });
  assert.equal(tx.amount, 100, "tx gikk gjennom selv om assessment feilet");
});

test("AntiFraudWalletAdapter: credit-flyt utløser CREDIT-operationType", async () => {
  const inner = new InMemoryWalletAdapter();
  const account = await inner.createAccount({ initialBalance: 0 });
  const svc = AntiFraudService.forTesting(emptyPool());

  let lastOp: string | null = null;
  svc.assessTransaction = async (input) => {
    lastOp = input.operationType;
    return { risk: "low", signals: [], actionTaken: "logged", signalId: "x" };
  };

  const wrapped = new AntiFraudWalletAdapter(inner, svc);
  await wrapped.credit(account.id, 100, "test", {
    antiFraudContext: { userId: "u1" },
  });
  assert.equal(lastOp, "CREDIT");

  await wrapped.topUp(account.id, 50, "topup", {
    antiFraudContext: { userId: "u1" },
  });
  assert.equal(lastOp, "TOPUP");

  await wrapped.withdraw(account.id, 30, "withdraw", {
    antiFraudContext: { userId: "u1" },
  });
  assert.equal(lastOp, "WITHDRAWAL");
});
