/**
 * PT5 — enhetstester for AgentTicketRangeService.handoverRange (vakt-skift).
 *
 * Spec: docs/architecture/PHYSICAL_TICKETS_FINAL_SPEC_2026-04-22.md
 *       (§ "Fase 7: Handover (vakt-skift)")
 *
 * Dekker:
 *   - Happy-path: usolgte overført til ny range, solgte-pending sin
 *     responsible_user_id flyttes til Per (PT4-broadcast-kompatibel).
 *   - Validering: HANDOVER_SAME_USER, RANGE_ALREADY_CLOSED, RANGE_NOT_FOUND,
 *     FORBIDDEN, adminOverride, TARGET_USER_NOT_FOUND, TARGET_USER_NOT_IN_HALL,
 *     PLAYER avvises, ADMIN tillates, INVALID_INPUT.
 *   - Edge-cases: ingen solgte (first shift), alt solgt + utbetalt-filter,
 *     PT4-broadcast-kompatibilitet etter handover.
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
  seedHandoverScenario,
  seedRange,
  seedUser,
} from "./fixtures/agentTicketRangeFixtures.js";

test("PT5 handoverRange: happy-path — usolgte overført, solgte-pending byttet til Per", async () => {
  const store = newStore();
  seedHandoverScenario(store);
  const svc = makeService(store);

  const res = await svc.handoverRange({
    fromRangeId: "range-kari",
    toUserId: "per-1",
    performedByUserId: "kari-1",
  });

  assert.equal(res.fromRangeId, "range-kari");
  assert.ok(res.newRangeId);
  assert.notEqual(res.newRangeId, "range-kari");
  assert.equal(res.unsoldCount, 3); // 97, 96, 95
  assert.equal(res.soldPendingCount, 3); // 100, 99, 98
  assert.equal(res.fromUserId, "kari-1");
  assert.equal(res.toUserId, "per-1");
  assert.equal(res.hallId, "hall-a");
  assert.equal(res.ticketColor, "small");
  assert.equal(res.newInitialSerial, "97");
  assert.equal(res.newFinalSerial, "95");
  assert.ok(res.handoverAt);

  // Karis range lukket + peker på ny range.
  const kari = store.ranges.get("range-kari")!;
  assert.ok(kari.closed_at !== null);
  assert.equal(kari.handed_off_to_range_id, res.newRangeId);

  // Pers nye range.
  const per = store.ranges.get(res.newRangeId)!;
  assert.equal(per.agent_id, "per-1");
  assert.equal(per.hall_id, "hall-a");
  assert.equal(per.ticket_color, "small");
  assert.deepEqual(per.serials, ["97", "96", "95"]);
  assert.equal(per.initial_serial, "97");
  assert.equal(per.final_serial, "95");
  assert.equal(per.current_top_serial, "97");
  assert.equal(per.handover_from_range_id, "range-kari");
  assert.equal(per.closed_at, null);

  // Usolgte bonger: reserved_by_range_id = Pers range.
  for (const s of ["97", "96", "95"]) {
    const t = store.tickets.get(`tkt-hall-a-small-${s}`)!;
    assert.equal(t.reserved_by_range_id, res.newRangeId);
    assert.equal(t.is_purchased, false);
  }

  // Solgte-uutbetalte bonger: responsible_user_id = Per.
  for (const s of ["100", "99", "98"]) {
    const t = store.tickets.get(`tkt-hall-a-small-${s}`)!;
    assert.equal(t.responsible_user_id, "per-1");
    assert.equal(t.sold_from_range_id, "range-kari"); // ikke rørt
  }

  // COMMIT, ingen rollback.
  assert.equal(store.commitCount, 1);
  assert.equal(store.rollbackCount, 0);
});

test("PT5 handoverRange: same user → HANDOVER_SAME_USER", async () => {
  const store = newStore();
  seedHandoverScenario(store);
  const svc = makeService(store);

  await assert.rejects(
    () => svc.handoverRange({
      fromRangeId: "range-kari",
      toUserId: "kari-1", // samme som agent_id
      performedByUserId: "kari-1",
    }),
    (err: unknown) => err instanceof DomainError && err.code === "HANDOVER_SAME_USER",
  );
  // Ingen range-endring.
  const kari = store.ranges.get("range-kari")!;
  assert.equal(kari.closed_at, null);
  assert.equal(store.rollbackCount, 1);
});

test("PT5 handoverRange: lukket range → RANGE_ALREADY_CLOSED", async () => {
  const store = newStore();
  seedHandoverScenario(store);
  store.ranges.get("range-kari")!.closed_at = new Date();
  const svc = makeService(store);

  await assert.rejects(
    () => svc.handoverRange({
      fromRangeId: "range-kari",
      toUserId: "per-1",
      performedByUserId: "kari-1",
    }),
    (err: unknown) => err instanceof DomainError && err.code === "RANGE_ALREADY_CLOSED",
  );
});

test("PT5 handoverRange: RANGE_NOT_FOUND når fromRangeId ukjent", async () => {
  const store = newStore();
  seedUser(store, { id: "kari-1", role: "HALL_OPERATOR", hall_id: "hall-a" });
  seedUser(store, { id: "per-1", role: "HALL_OPERATOR", hall_id: "hall-a" });
  const svc = makeService(store);

  await assert.rejects(
    () => svc.handoverRange({
      fromRangeId: "range-nope",
      toUserId: "per-1",
      performedByUserId: "kari-1",
    }),
    (err: unknown) => err instanceof DomainError && err.code === "RANGE_NOT_FOUND",
  );
});

test("PT5 handoverRange: ikke-eier uten adminOverride → FORBIDDEN", async () => {
  const store = newStore();
  seedHandoverScenario(store);
  const svc = makeService(store);

  await assert.rejects(
    () => svc.handoverRange({
      fromRangeId: "range-kari",
      toUserId: "per-1",
      performedByUserId: "per-1", // ikke eier av range-kari
    }),
    (err: unknown) => err instanceof DomainError && err.code === "FORBIDDEN",
  );
});

test("PT5 handoverRange: adminOverride tillater handover på vegne av bingovert", async () => {
  const store = newStore();
  seedHandoverScenario(store);
  seedUser(store, { id: "admin-1", role: "ADMIN", hall_id: null });
  const svc = makeService(store);

  const res = await svc.handoverRange({
    fromRangeId: "range-kari",
    toUserId: "per-1",
    performedByUserId: "admin-1",
    adminOverride: true,
  });
  assert.equal(res.unsoldCount, 3);
  assert.equal(res.soldPendingCount, 3);
  // Karis range fortsatt "eier" av kari-1, selv om admin kjørte handover.
  const kari = store.ranges.get("range-kari")!;
  assert.equal(kari.agent_id, "kari-1");
  assert.ok(kari.closed_at !== null);
});

test("PT5 handoverRange: ukjent toUserId → TARGET_USER_NOT_FOUND", async () => {
  const store = newStore();
  seedHandoverScenario(store);
  const svc = makeService(store);

  await assert.rejects(
    () => svc.handoverRange({
      fromRangeId: "range-kari",
      toUserId: "ghost-1",
      performedByUserId: "kari-1",
    }),
    (err: unknown) => err instanceof DomainError && err.code === "TARGET_USER_NOT_FOUND",
  );
});

test("PT5 handoverRange: toUser i annen hall → TARGET_USER_NOT_IN_HALL", async () => {
  const store = newStore();
  seedHandoverScenario(store);
  // Per er HALL_OPERATOR men i hall-B, ikke hall-A.
  store.users.set("per-1", { id: "per-1", role: "HALL_OPERATOR", hall_id: "hall-b" });
  const svc = makeService(store);

  await assert.rejects(
    () => svc.handoverRange({
      fromRangeId: "range-kari",
      toUserId: "per-1",
      performedByUserId: "kari-1",
    }),
    (err: unknown) => err instanceof DomainError && err.code === "TARGET_USER_NOT_IN_HALL",
  );
});

test("PT5 handoverRange: PLAYER som toUser → TARGET_USER_NOT_IN_HALL", async () => {
  const store = newStore();
  seedHandoverScenario(store);
  store.users.set("pl-1", { id: "pl-1", role: "PLAYER", hall_id: null });
  const svc = makeService(store);

  await assert.rejects(
    () => svc.handoverRange({
      fromRangeId: "range-kari",
      toUserId: "pl-1",
      performedByUserId: "kari-1",
    }),
    (err: unknown) => err instanceof DomainError && err.code === "TARGET_USER_NOT_IN_HALL",
  );
});

test("PT5 handoverRange: ADMIN som toUser er tillatt (ADMIN har ingen hall-binding)", async () => {
  const store = newStore();
  seedHandoverScenario(store);
  // En admin-bruker uten hall-tilhørighet.
  store.users.set("admin-helper-1", { id: "admin-helper-1", role: "ADMIN", hall_id: null });
  const svc = makeService(store);

  const res = await svc.handoverRange({
    fromRangeId: "range-kari",
    toUserId: "admin-helper-1",
    performedByUserId: "kari-1",
  });
  assert.equal(res.toUserId, "admin-helper-1");
});

test("PT5 handoverRange: tom fromRangeId → INVALID_INPUT", async () => {
  const svc = makeService(newStore());
  await assert.rejects(
    () => svc.handoverRange({
      fromRangeId: "",
      toUserId: "per-1",
      performedByUserId: "kari-1",
    }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT",
  );
});

test("PT5 handoverRange: tom toUserId → INVALID_INPUT", async () => {
  const svc = makeService(newStore());
  await assert.rejects(
    () => svc.handoverRange({
      fromRangeId: "range-1",
      toUserId: "",
      performedByUserId: "kari-1",
    }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT",
  );
});

test("PT5 handoverRange: rangen har ingen solgte bonger (first shift) — unsoldCount = alle", async () => {
  const store = newStore();
  // Kari akkurat registrerte range, ingen salg enda.
  seedRange(store, {
    id: "range-kari",
    agent_id: "kari-1",
    hall_id: "hall-a",
    ticket_color: "small",
    initial_serial: "100",
    final_serial: "98",
    serials: ["100", "99", "98"],
    current_top_serial: "100",
  });
  for (const s of ["100", "99", "98"]) {
    const id = `tkt-hall-a-small-${s}`;
    store.tickets.set(id, {
      id,
      hall_id: "hall-a",
      ticket_serial: s,
      ticket_color: "small",
      is_purchased: false,
      reserved_by_range_id: "range-kari",
      paid_out_at: null,
    });
  }
  seedUser(store, { id: "kari-1", role: "HALL_OPERATOR", hall_id: "hall-a" });
  seedUser(store, { id: "per-1", role: "HALL_OPERATOR", hall_id: "hall-a" });
  const svc = makeService(store);

  const res = await svc.handoverRange({
    fromRangeId: "range-kari",
    toUserId: "per-1",
    performedByUserId: "kari-1",
  });
  assert.equal(res.unsoldCount, 3);
  assert.equal(res.soldPendingCount, 0);
  // Pers range har alle 3 serials.
  const per = store.ranges.get(res.newRangeId)!;
  assert.deepEqual(per.serials, ["100", "99", "98"]);
});

test("PT5 handoverRange: alt solgt (currentTop = final_serial) → unsoldCount = 1 (siste bong)", async () => {
  const store = newStore();
  // Alle bonger unntatt den siste er solgt; currentTop = final_serial.
  seedRange(store, {
    id: "range-kari",
    agent_id: "kari-1",
    hall_id: "hall-a",
    ticket_color: "small",
    initial_serial: "100",
    final_serial: "98",
    serials: ["100", "99", "98"],
    current_top_serial: "98", // alt solgt unntatt 98
  });
  // Solgte bonger med Kari som ansvarlig, en uutbetalt.
  store.tickets.set("tkt-hall-a-small-100", {
    id: "tkt-hall-a-small-100",
    hall_id: "hall-a",
    ticket_serial: "100",
    ticket_color: "small",
    is_purchased: true,
    reserved_by_range_id: null,
    sold_from_range_id: "range-kari",
    responsible_user_id: "kari-1",
    paid_out_at: null,
  });
  store.tickets.set("tkt-hall-a-small-99", {
    id: "tkt-hall-a-small-99",
    hall_id: "hall-a",
    ticket_serial: "99",
    ticket_color: "small",
    is_purchased: true,
    reserved_by_range_id: null,
    sold_from_range_id: "range-kari",
    responsible_user_id: "kari-1",
    paid_out_at: new Date(), // allerede utbetalt — skal IKKE overføres
  });
  store.tickets.set("tkt-hall-a-small-98", {
    id: "tkt-hall-a-small-98",
    hall_id: "hall-a",
    ticket_serial: "98",
    ticket_color: "small",
    is_purchased: false,
    reserved_by_range_id: "range-kari",
    paid_out_at: null,
  });
  seedUser(store, { id: "kari-1", role: "HALL_OPERATOR", hall_id: "hall-a" });
  seedUser(store, { id: "per-1", role: "HALL_OPERATOR", hall_id: "hall-a" });
  const svc = makeService(store);

  const res = await svc.handoverRange({
    fromRangeId: "range-kari",
    toUserId: "per-1",
    performedByUserId: "kari-1",
  });
  assert.equal(res.unsoldCount, 1); // bare 98
  assert.equal(res.soldPendingCount, 1); // bare 100 (99 er utbetalt)

  // 99 er utbetalt — responsible_user_id skal IKKE endres.
  const t99 = store.tickets.get("tkt-hall-a-small-99")!;
  assert.equal(t99.responsible_user_id, "kari-1");

  // 100 er uutbetalt — responsible_user_id skal være Per.
  const t100 = store.tickets.get("tkt-hall-a-small-100")!;
  assert.equal(t100.responsible_user_id, "per-1");
});

test("PT5 handoverRange: etter handover går solgte-pending sin responsible til Per (PT4-kompatibel broadcast)", async () => {
  const store = newStore();
  seedHandoverScenario(store);
  const svc = makeService(store);
  await svc.handoverRange({
    fromRangeId: "range-kari",
    toUserId: "per-1",
    performedByUserId: "kari-1",
  });

  // Simuler PT4-vinn-broadcast-oppslag: "hvem er ansvarlig for bong 99
  // (som ble solgt av Kari, men ikke utbetalt)?"
  const t99 = store.tickets.get("tkt-hall-a-small-99")!;
  assert.equal(t99.responsible_user_id, "per-1");
});
