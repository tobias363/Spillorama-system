/**
 * BIN-CRITICAL (2026-04-25): Wallet-overspend-bug i `reservePreRoundDelta`.
 *
 * Tobias rapporterte at en spiller med 1 000 kr saldo kunne arme 30 brett
 * for 1 800 kr uten at saldo ble redusert. Rot-årsaken var at funksjonen
 * silently early-returned i fem ulike grener:
 *   1. ingen wallet-adapter         → return (test-harness, OK)
 *   2. mangler getWalletIdForPlayer → return (skjuler deploy-feil)
 *   3. deltaWeighted <= 0           → return (OK, ingen nye brett)
 *   4. deltaKr <= 0                 → return (skjuler entryFee=0)
 *   5. walletId null                → return (skjuler player-mismatch)
 *
 * Klient-popup falbacker til `entryFee || 10` så bruker så priser
 * mens server beregnet `0 × 30 = 0` og no-op-et reservasjonen — men
 * `armPlayer` kjørte uansett etter funksjonen returnerte. Resultat:
 * 30 brett armed uten reservasjon, saldo intakt, regulatorisk brudd.
 *
 * Disse testene dekker:
 *   - test-harness path (no adapter): silent OK
 *   - deploy-feil (manglende deps): kaster INSUFFICIENT_FUNDS
 *   - free-play (entryFee=0): logger advarsel + returnerer ren
 *   - happy path: oppretter reservasjon
 *   - increase-path: øker eksisterende reservasjon
 *   - INSUFFICIENT_FUNDS bobbler opp fra adapter
 *   - missing wallet-id: kaster INSUFFICIENT_FUNDS (fail-closed)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { reservePreRoundDelta } from "./roomEvents.js";
import { InMemoryWalletAdapter } from "../../adapters/InMemoryWalletAdapter.js";
import { WalletError } from "../../adapters/WalletAdapter.js";
import { DomainError } from "../../errors/DomainError.js";
import type { GameEventsDeps } from "./deps.js";

interface TestDepsOpts {
  adapter?: InMemoryWalletAdapter | null;
  entryFee?: number;
  walletId?: string | null;
  /** Set false to simulate missing dep functions (deploy-failure scenario). */
  withDeps?: boolean;
}

function makeDeps(opts: TestDepsOpts = {}): {
  deps: GameEventsDeps;
  reservationStore: Map<string, string>;
} {
  const reservationStore = new Map<string, string>();
  const adapter = opts.adapter === undefined ? new InMemoryWalletAdapter(0) : opts.adapter;
  const entryFee = opts.entryFee ?? 10;
  // Use `in` so callers can pass `walletId: null` to simulate missing player.
  const walletId = "walletId" in opts ? opts.walletId : "wallet-test-1";
  const withDeps = opts.withDeps ?? true;

  const deps = {
    walletAdapter: adapter,
    getRoomConfiguredEntryFee: (_roomCode: string) => entryFee,
    ...(withDeps
      ? {
          getWalletIdForPlayer: (_code: string, _pid: string) => walletId,
          getReservationId: (code: string, pid: string) =>
            reservationStore.get(`${code}:${pid}`) ?? null,
          setReservationId: (code: string, pid: string, rid: string) => {
            reservationStore.set(`${code}:${pid}`, rid);
          },
          clearReservationId: (code: string, pid: string) => {
            reservationStore.delete(`${code}:${pid}`);
          },
        }
      : {}),
  } as unknown as GameEventsDeps;

  return { deps, reservationStore };
}

// ── Test-harness: ingen adapter konfigurert (ren legacy-test) ───────────────

test("test-harness: returnerer silent uten å feile når walletAdapter mangler", async () => {
  const { deps } = makeDeps({ adapter: null });
  await reservePreRoundDelta(deps, "ROOM1", "p1", 0, 5);
  // Ingen kast forventet. Eksisterende tester (multiWinnerEventOrdering osv)
  // bruker ikke walletAdapter — denne pathen MÅ holde for å ikke knekke 700+
  // socket-tester.
});

// ── Deploy-feil: walletAdapter satt, men deps mangler ───────────────────────

test("deploy-feil: kaster INSUFFICIENT_FUNDS når getWalletIdForPlayer/getReservationId/setReservationId mangler", async () => {
  const { deps } = makeDeps({ withDeps: false });
  await assert.rejects(
    () => reservePreRoundDelta(deps, "ROOM1", "p1", 0, 5),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "INSUFFICIENT_FUNDS");
      return true;
    },
  );
});

// ── deltaWeighted <= 0: ingen ekstra brett, ingen reservasjon ───────────────

test("deltaWeighted <= 0: returnerer silent (ingen nye brett å betale for)", async () => {
  const { deps, reservationStore } = makeDeps();
  await reservePreRoundDelta(deps, "ROOM1", "p1", 5, 5); // delta=0
  await reservePreRoundDelta(deps, "ROOM1", "p1", 5, 3); // delta=-2 (re-arm med færre)
  assert.equal(reservationStore.size, 0, "ingen reservasjon skal opprettes");
});

// ── Free play (entryFee=0): logg + ingen reservasjon ────────────────────────

test("free play (entryFee=0): logger advarsel og returnerer uten å arme regulatorisk brudd", async () => {
  const { deps, reservationStore } = makeDeps({ entryFee: 0 });
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (msg: string) => warnings.push(msg);
  try {
    await reservePreRoundDelta(deps, "ROOM1", "p1", 0, 30);
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(reservationStore.size, 0, "ingen reservasjon på free play");
  assert.ok(
    warnings.some((m) => m.includes("entryFee=0") && m.includes("ROOM1")),
    `forventet advarsel om entryFee=0, fant: ${JSON.stringify(warnings)}`,
  );
});

// ── Happy path: oppretter reservasjon ───────────────────────────────────────

test("happy path: reserve med tilstrekkelig saldo lykkes, balance reduseres", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "wallet-test-1", initialBalance: 1000 });

  const { deps, reservationStore } = makeDeps({ adapter, entryFee: 60 });
  await reservePreRoundDelta(deps, "ROOM1", "p1", 0, 5); // 5 × 60 = 300

  assert.equal(reservationStore.size, 1, "reservasjon skal være lagret");
  const resId = reservationStore.get("ROOM1:p1")!;
  assert.ok(resId, "reservation-id skal ha blitt satt");

  assert.equal(await adapter.getBalance("wallet-test-1"), 1000, "raw balance uendret");
  assert.equal(
    await adapter.getAvailableBalance!("wallet-test-1"),
    700,
    "available balance skal være 1000 - 300 = 700",
  );
});

// ── Increase-path: andre arm-call øker eksisterende reservasjon ─────────────

test("increase-path: andre bet:arm øker eksisterende reservasjon i stedet for å opprette ny", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "wallet-test-1", initialBalance: 1000 });

  const { deps, reservationStore } = makeDeps({ adapter, entryFee: 60 });
  await reservePreRoundDelta(deps, "ROOM1", "p1", 0, 5); // 5 × 60 = 300
  const firstResId = reservationStore.get("ROOM1:p1");

  await reservePreRoundDelta(deps, "ROOM1", "p1", 5, 10); // delta=5, +300 → 600 totalt
  const secondResId = reservationStore.get("ROOM1:p1");

  assert.equal(secondResId, firstResId, "samme reservation-id");
  assert.equal(
    await adapter.getAvailableBalance!("wallet-test-1"),
    400,
    "available balance skal være 1000 - 600 = 400",
  );
});

// ── Critical: overspending blokkeres ────────────────────────────────────────

test("KRITISK: overspending blokkeres med INSUFFICIENT_FUNDS (Tobias' bug)", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "wallet-test-1", initialBalance: 1000 });

  const { deps, reservationStore } = makeDeps({ adapter, entryFee: 60 });

  // Eksakt scenarioet fra screenshot: 30 brett × 60 kr = 1800 kr på 1000 kr saldo
  await assert.rejects(
    () => reservePreRoundDelta(deps, "ROOM1", "p1", 0, 30),
    (err: unknown) => {
      assert.ok(err instanceof WalletError, `forventet WalletError, fikk ${err}`);
      assert.equal((err as WalletError).code, "INSUFFICIENT_FUNDS");
      return true;
    },
  );
  assert.equal(reservationStore.size, 0, "ingen reservasjon skal være lagret etter feil");
  assert.equal(await adapter.getBalance("wallet-test-1"), 1000, "balance urørt");
});

test("KRITISK: increase som ville overspende kastes også", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "wallet-test-1", initialBalance: 1000 });

  const { deps } = makeDeps({ adapter, entryFee: 60 });

  // Første arm OK
  await reservePreRoundDelta(deps, "ROOM1", "p1", 0, 10); // 600 kr
  assert.equal(await adapter.getAvailableBalance!("wallet-test-1"), 400);

  // Andre arm — 10 mer brett = +600 kr, men available er bare 400 → skal feile
  await assert.rejects(
    () => reservePreRoundDelta(deps, "ROOM1", "p1", 10, 20),
    (err: unknown) => {
      assert.ok(err instanceof WalletError);
      assert.equal((err as WalletError).code, "INSUFFICIENT_FUNDS");
      return true;
    },
  );

  // Eksisterende reservasjon på 600 kr skal være urørt
  assert.equal(await adapter.getAvailableBalance!("wallet-test-1"), 400);
});

// ── Missing wallet-id: fail-closed ──────────────────────────────────────────

test("missing wallet-id: kaster INSUFFICIENT_FUNDS (player ikke i room snapshot)", async () => {
  const { deps } = makeDeps({ walletId: null });
  await assert.rejects(
    () => reservePreRoundDelta(deps, "ROOM1", "p1", 0, 5),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "INSUFFICIENT_FUNDS");
      assert.match((err as DomainError).message, /lommebok/i);
      return true;
    },
  );
});
