/**
 * PT5 — enhetstester for AgentTicketRangeService.extendRange (range-påfylling).
 *
 * Spec: docs/architecture/PHYSICAL_TICKETS_FINAL_SPEC_2026-04-22.md
 *       (§ "Fase 8: Range-påfylling")
 *
 * Dekker:
 *   - Happy-path: 5 bonger lagt til, ny final_serial, range oppdatert,
 *     bonger reservert.
 *   - Validering: INSUFFICIENT_INVENTORY, FORBIDDEN, adminOverride,
 *     RANGE_ALREADY_CLOSED, RANGE_NOT_FOUND, INVALID_INPUT
 *     (tom rangeId / additionalCount = 0 / additionalCount > MAX).
 *   - Edge-cases: sekvensielle extends, race (inventar tomt), reserverte (åpen)
 *     hoppes over, lukket-range-bonger gjenbrukes, farge-isolering,
 *     final_serial-boundary (`<` ikke `<=`).
 *
 * Splittet ut fra AgentTicketRangeService.test.ts for å unngå
 * Node `node:test` IPC-overflow på trege CI-runnere. Se PR #472.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../../game/BingoEngine.js";
import {
  makeService,
  newStore,
  seedExtendScenario,
  seedRange,
} from "./fixtures/agentTicketRangeFixtures.js";

test("PT5 extendRange: happy-path — 5 bonger lagt til, ny final_serial = 91", async () => {
  const store = newStore();
  seedExtendScenario(store);
  const svc = makeService(store);

  const res = await svc.extendRange({
    rangeId: "range-per",
    additionalCount: 5,
    performedByUserId: "per-1",
  });

  assert.equal(res.rangeId, "range-per");
  assert.equal(res.addedCount, 5);
  assert.equal(res.newTopOfAddedSerial, "95");
  assert.equal(res.newFinalSerial, "91");
  assert.deepEqual(res.newSerials, ["95", "94", "93", "92", "91"]);
  assert.equal(res.totalSerialsAfter, 10); // 5 gamle + 5 nye

  // Range oppdatert.
  const range = store.ranges.get("range-per")!;
  assert.deepEqual(range.serials, ["100", "99", "98", "97", "96", "95", "94", "93", "92", "91"]);
  assert.equal(range.final_serial, "91");
  assert.equal(range.initial_serial, "100"); // uendret
  assert.equal(range.current_top_serial, "98"); // uendret

  // Nye bonger reservert.
  for (const s of ["95", "94", "93", "92", "91"]) {
    const t = store.tickets.get(`tkt-hall-a-small-${s}`)!;
    assert.equal(t.reserved_by_range_id, "range-per");
  }

  // COMMIT, ingen rollback.
  assert.equal(store.commitCount, 1);
  assert.equal(store.rollbackCount, 0);
});

test("PT5 extendRange: ikke nok inventar → INSUFFICIENT_INVENTORY", async () => {
  const store = newStore();
  seedExtendScenario(store);
  const svc = makeService(store);

  // Prøv å utvide med 20 bonger, men inventar = 11.
  await assert.rejects(
    () => svc.extendRange({
      rangeId: "range-per",
      additionalCount: 20,
      performedByUserId: "per-1",
    }),
    (err: unknown) => err instanceof DomainError && err.code === "INSUFFICIENT_INVENTORY",
  );
  assert.equal(store.rollbackCount, 1);
  // Range uendret.
  const range = store.ranges.get("range-per")!;
  assert.equal(range.final_serial, "96");
});

test("PT5 extendRange: ikke eier uten adminOverride → FORBIDDEN", async () => {
  const store = newStore();
  seedExtendScenario(store);
  const svc = makeService(store);

  await assert.rejects(
    () => svc.extendRange({
      rangeId: "range-per",
      additionalCount: 5,
      performedByUserId: "kari-1", // ikke eier
    }),
    (err: unknown) => err instanceof DomainError && err.code === "FORBIDDEN",
  );
});

test("PT5 extendRange: adminOverride tillater extend på vegne av bingovert", async () => {
  const store = newStore();
  seedExtendScenario(store);
  const svc = makeService(store);

  const res = await svc.extendRange({
    rangeId: "range-per",
    additionalCount: 3,
    performedByUserId: "admin-1",
    adminOverride: true,
  });
  assert.equal(res.addedCount, 3);
  assert.deepEqual(res.newSerials, ["95", "94", "93"]);
});

test("PT5 extendRange: lukket range → RANGE_ALREADY_CLOSED", async () => {
  const store = newStore();
  seedExtendScenario(store);
  store.ranges.get("range-per")!.closed_at = new Date();
  const svc = makeService(store);

  await assert.rejects(
    () => svc.extendRange({
      rangeId: "range-per",
      additionalCount: 5,
      performedByUserId: "per-1",
    }),
    (err: unknown) => err instanceof DomainError && err.code === "RANGE_ALREADY_CLOSED",
  );
});

test("PT5 extendRange: RANGE_NOT_FOUND når rangeId ukjent", async () => {
  const svc = makeService(newStore());
  await assert.rejects(
    () => svc.extendRange({
      rangeId: "range-nope",
      additionalCount: 5,
      performedByUserId: "per-1",
    }),
    (err: unknown) => err instanceof DomainError && err.code === "RANGE_NOT_FOUND",
  );
});

test("PT5 extendRange: tom rangeId → INVALID_INPUT", async () => {
  const svc = makeService(newStore());
  await assert.rejects(
    () => svc.extendRange({
      rangeId: "",
      additionalCount: 5,
      performedByUserId: "per-1",
    }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT",
  );
});

test("PT5 extendRange: additionalCount = 0 → INVALID_INPUT", async () => {
  const store = newStore();
  seedExtendScenario(store);
  const svc = makeService(store);

  await assert.rejects(
    () => svc.extendRange({
      rangeId: "range-per",
      additionalCount: 0,
      performedByUserId: "per-1",
    }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT",
  );
});

test("PT5 extendRange: additionalCount > MAX_RANGE_COUNT → INVALID_INPUT", async () => {
  const store = newStore();
  seedExtendScenario(store);
  const svc = makeService(store);

  await assert.rejects(
    () => svc.extendRange({
      rangeId: "range-per",
      additionalCount: 10_000, // langt over MAX_RANGE_COUNT = 5000
      performedByUserId: "per-1",
    }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT",
  );
});

test("PT5 extendRange: sekvensielle extends fungerer (tilsvarer to påfyllinger)", async () => {
  const store = newStore();
  seedExtendScenario(store);
  const svc = makeService(store);

  const r1 = await svc.extendRange({
    rangeId: "range-per",
    additionalCount: 3,
    performedByUserId: "per-1",
  });
  assert.deepEqual(r1.newSerials, ["95", "94", "93"]);
  assert.equal(r1.newFinalSerial, "93");

  // Andre utvidelse — tar de neste tilgjengelige.
  const r2 = await svc.extendRange({
    rangeId: "range-per",
    additionalCount: 3,
    performedByUserId: "per-1",
  });
  assert.deepEqual(r2.newSerials, ["92", "91", "90"]);
  assert.equal(r2.newFinalSerial, "90");

  // Range har totalt 5+3+3 = 11 serials nå.
  const range = store.ranges.get("range-per")!;
  assert.equal(range.serials.length, 11);
  assert.equal(range.final_serial, "90");
});

test("PT5 extendRange: race — to parallelle extends; andre feiler hvis inventar tomt", async () => {
  const store = newStore();
  seedExtendScenario(store);
  const svc = makeService(store);

  // Første extend tar alle 11 tilgjengelige.
  const r1 = await svc.extendRange({
    rangeId: "range-per",
    additionalCount: 11,
    performedByUserId: "per-1",
  });
  assert.equal(r1.addedCount, 11);

  // Andre extend: ingen bonger igjen i inventar → INSUFFICIENT_INVENTORY.
  await assert.rejects(
    () => svc.extendRange({
      rangeId: "range-per",
      additionalCount: 1,
      performedByUserId: "per-1",
    }),
    (err: unknown) => err instanceof DomainError && err.code === "INSUFFICIENT_INVENTORY",
  );
});

test("PT5 extendRange: hopper over reserverte (åpen range) bonger", async () => {
  const store = newStore();
  seedExtendScenario(store);
  // Reserver 95 og 94 av annen åpen range → skal ikke være tilgjengelige.
  seedRange(store, {
    id: "range-other",
    agent_id: "other-1",
    hall_id: "hall-a",
    ticket_color: "small",
    initial_serial: "95",
    final_serial: "94",
    serials: ["95", "94"],
  });
  store.tickets.get("tkt-hall-a-small-95")!.reserved_by_range_id = "range-other";
  store.tickets.get("tkt-hall-a-small-94")!.reserved_by_range_id = "range-other";
  const svc = makeService(store);

  // Extend med 3 → skal hente 93, 92, 91 (ikke 95, 94).
  const res = await svc.extendRange({
    rangeId: "range-per",
    additionalCount: 3,
    performedByUserId: "per-1",
  });
  assert.deepEqual(res.newSerials, ["93", "92", "91"]);
});

test("PT5 extendRange: tillater bonger reservert av LUKKET range", async () => {
  const store = newStore();
  seedExtendScenario(store);
  // 95, 94 er reservert av en lukket range → skal være tilgjengelige igjen.
  seedRange(store, {
    id: "range-old",
    agent_id: "old-1",
    hall_id: "hall-a",
    ticket_color: "small",
    initial_serial: "95",
    final_serial: "94",
    serials: ["95", "94"],
    closed_at: new Date("2026-01-01"),
  });
  store.tickets.get("tkt-hall-a-small-95")!.reserved_by_range_id = "range-old";
  store.tickets.get("tkt-hall-a-small-94")!.reserved_by_range_id = "range-old";
  const svc = makeService(store);

  const res = await svc.extendRange({
    rangeId: "range-per",
    additionalCount: 3,
    performedByUserId: "per-1",
  });
  // Henter DESC: 95, 94 (fra lukket) + 93.
  assert.deepEqual(res.newSerials, ["95", "94", "93"]);
});

test("PT5 extendRange: kun samme farge — annen farge ignoreres", async () => {
  const store = newStore();
  seedExtendScenario(store);
  // Legg til noen "large"-bonger i samme hall → skal IKKE telles.
  for (const s of ["095", "094", "093"]) {
    const id = `tkt-hall-a-large-${s}`;
    store.tickets.set(id, {
      id,
      hall_id: "hall-a",
      ticket_serial: s,
      ticket_color: "large",
      is_purchased: false,
      reserved_by_range_id: null,
      paid_out_at: null,
    });
  }
  const svc = makeService(store);

  // range-per er 'small' → skal bare få small-bonger.
  const res = await svc.extendRange({
    rangeId: "range-per",
    additionalCount: 3,
    performedByUserId: "per-1",
  });
  assert.deepEqual(res.newSerials, ["95", "94", "93"]);
});

test("PT5 extendRange: final_serial-boundary — kun bonger < current final_serial", async () => {
  const store = newStore();
  seedExtendScenario(store);
  // Legg til en bong "96" i inventaret (samme som final_serial) — skal IKKE plukkes.
  // (Allerede seedet som en del av rangen; dette er defensivt for å sikre
  // semantikken om at `< final_serial` brukes, ikke `<=`.)
  const svc = makeService(store);

  const res = await svc.extendRange({
    rangeId: "range-per",
    additionalCount: 1,
    performedByUserId: "per-1",
  });
  // Skal IKKE plukke 96 igjen (det er allerede i rangen). Først ledige < 96 = 95.
  assert.deepEqual(res.newSerials, ["95"]);
});
