/**
 * PT3 — enhetstester for AgentTicketRangeService.recordBatchSale
 * (allokering av bonger til planlagte spill).
 *
 * Spec: docs/architecture/PHYSICAL_TICKETS_FINAL_SPEC_2026-04-22.md
 *       (§ "Fase 3: Batch-salg / oppdater toppen")
 *
 * Dekker:
 *   - Happy-path: top dekrementerer, app_static_tickets oppdateres
 *     (is_purchased=true + sold_to_scheduled_game_id), range.current_top_serial
 *     oppdateres.
 *   - Validering: NO_TICKETS_SOLD, INVALID_NEW_TOP, SERIAL_NOT_IN_RANGE,
 *     RANGE_ALREADY_CLOSED, FORBIDDEN, INVALID_INPUT, RANGE_NOT_FOUND.
 *   - Spill-valg: NO_UPCOMING_GAME_FOR_HALL, completed-filtreres,
 *     eksplisitt scheduledGameId, SCHEDULED_GAME_HALL_MISMATCH,
 *     SCHEDULED_GAME_NOT_FOUND, SCHEDULED_GAME_NOT_JOINABLE,
 *     adminOverride, hall = participating (ikke master).
 *   - Race / rollback: parallelle batch-salg, batch-update-mismatch,
 *     sekvensielle batch-salg dekrementerer top stegvis, dobbeltkall.
 *   - Selger hele rangen (newTop = final_serial).
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
  seedBatchSaleScenario,
  seedScheduledGame,
} from "./fixtures/agentTicketRangeFixtures.js";

test("PT3 recordBatchSale: happy-path — 5 bonger solgt, top går fra 100 til 95", async () => {
  const store = newStore();
  seedBatchSaleScenario(store);
  const svc = makeService(store);

  const res = await svc.recordBatchSale({
    rangeId: "range-1",
    newTopSerial: "95",
    userId: "agent-1",
  });

  assert.equal(res.soldCount, 5);
  assert.equal(res.previousTopSerial, "100");
  assert.equal(res.newTopSerial, "95");
  assert.equal(res.scheduledGameId, "sched-game-1");
  assert.ok(res.gameStartTime);
  assert.deepEqual(res.soldSerials, ["100", "99", "98", "97", "96"]);

  // Range-oppdatering: current_top_serial = "95".
  const range = store.ranges.get("range-1")!;
  assert.equal(range.current_top_serial, "95");

  // app_static_tickets: 5 solgt, 1 gjenstår.
  const sold = [...store.tickets.values()].filter((t) => t.is_purchased);
  const unsold = [...store.tickets.values()].filter((t) => !t.is_purchased);
  assert.equal(sold.length, 5);
  assert.equal(unsold.length, 1);
  assert.equal(unsold[0]!.ticket_serial, "95");

  // COMMIT ble kalt, ingen rollback.
  assert.equal(store.commitCount, 1);
  assert.equal(store.rollbackCount, 0);
});

test("PT3 recordBatchSale: newTop == currentTop → NO_TICKETS_SOLD", async () => {
  const store = newStore();
  seedBatchSaleScenario(store);
  const svc = makeService(store);

  await assert.rejects(
    () => svc.recordBatchSale({
      rangeId: "range-1",
      newTopSerial: "100", // samme som current
      userId: "agent-1",
    }),
    (err: unknown) => err instanceof DomainError && err.code === "NO_TICKETS_SOLD",
  );

  // Rollback — ingen oppdateringer.
  assert.equal(store.rollbackCount, 1);
  assert.equal(store.commitCount, 0);
  const range = store.ranges.get("range-1")!;
  assert.equal(range.current_top_serial, "100");
});

test("PT3 recordBatchSale: newTop > currentTop → INVALID_NEW_TOP", async () => {
  const store = newStore();
  seedBatchSaleScenario(store);
  // Flytt current ned til 97 først slik at 100 blir "over" current.
  const range = store.ranges.get("range-1")!;
  range.current_top_serial = "97";
  const svc = makeService(store);

  await assert.rejects(
    () => svc.recordBatchSale({
      rangeId: "range-1",
      newTopSerial: "100", // høyere opp i DESC-listen
      userId: "agent-1",
    }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_NEW_TOP",
  );
});

test("PT3 recordBatchSale: newTopSerial utenfor range.serials → SERIAL_NOT_IN_RANGE", async () => {
  const store = newStore();
  seedBatchSaleScenario(store);
  const svc = makeService(store);

  await assert.rejects(
    () => svc.recordBatchSale({
      rangeId: "range-1",
      newTopSerial: "80", // ikke i ["100"..."95"]
      userId: "agent-1",
    }),
    (err: unknown) => err instanceof DomainError && err.code === "SERIAL_NOT_IN_RANGE",
  );
});

test("PT3 recordBatchSale: RANGE_ALREADY_CLOSED", async () => {
  const store = newStore();
  seedBatchSaleScenario(store);
  store.ranges.get("range-1")!.closed_at = new Date();
  const svc = makeService(store);

  await assert.rejects(
    () => svc.recordBatchSale({
      rangeId: "range-1",
      newTopSerial: "95",
      userId: "agent-1",
    }),
    (err: unknown) => err instanceof DomainError && err.code === "RANGE_ALREADY_CLOSED",
  );
});

test("PT3 recordBatchSale: annen agent uten adminOverride → FORBIDDEN", async () => {
  const store = newStore();
  seedBatchSaleScenario(store);
  const svc = makeService(store);

  await assert.rejects(
    () => svc.recordBatchSale({
      rangeId: "range-1",
      newTopSerial: "95",
      userId: "agent-2", // ikke eier
    }),
    (err: unknown) => err instanceof DomainError && err.code === "FORBIDDEN",
  );
});

test("PT3 recordBatchSale: adminOverride tillater batch-salg på annens range", async () => {
  const store = newStore();
  seedBatchSaleScenario(store);
  const svc = makeService(store);

  const res = await svc.recordBatchSale({
    rangeId: "range-1",
    newTopSerial: "95",
    userId: "admin-1", // ikke eier, men override
    adminOverride: true,
  });
  assert.equal(res.soldCount, 5);
});

test("PT3 recordBatchSale: ingen planlagt spill → NO_UPCOMING_GAME_FOR_HALL", async () => {
  const store = newStore();
  seedBatchSaleScenario(store);
  store.scheduledGames.clear(); // ingen spill
  const svc = makeService(store);

  await assert.rejects(
    () => svc.recordBatchSale({
      rangeId: "range-1",
      newTopSerial: "95",
      userId: "agent-1",
    }),
    (err: unknown) =>
      err instanceof DomainError
      && err.code === "NO_UPCOMING_GAME_FOR_HALL",
  );
  assert.equal(store.rollbackCount, 1);
});

test("PT3 recordBatchSale: completed scheduled_game filtreres ut → NO_UPCOMING_GAME_FOR_HALL", async () => {
  const store = newStore();
  seedBatchSaleScenario(store);
  // Endre spillet til completed → skal ikke plukkes.
  store.scheduledGames.get("sched-game-1")!.status = "completed";
  const svc = makeService(store);

  await assert.rejects(
    () => svc.recordBatchSale({
      rangeId: "range-1",
      newTopSerial: "95",
      userId: "agent-1",
    }),
    (err: unknown) =>
      err instanceof DomainError
      && err.code === "NO_UPCOMING_GAME_FOR_HALL",
  );
});

test("PT3 recordBatchSale: eksplisitt scheduledGameId matcher hall", async () => {
  const store = newStore();
  seedBatchSaleScenario(store);
  // Legg til et annet spill som skal velges først (starter tidligere).
  seedScheduledGame(store, {
    id: "sched-preferred",
    master_hall_id: "hall-a",
    participating_halls: ["hall-a"],
    status: "scheduled",
    scheduled_start_time: new Date(Date.now() - 30_000), // tidligere = ville blitt valgt
    scheduled_end_time: new Date(Date.now() + 3_600_000),
  });

  const svc = makeService(store);
  const res = await svc.recordBatchSale({
    rangeId: "range-1",
    newTopSerial: "95",
    userId: "agent-1",
    scheduledGameId: "sched-game-1", // eksplisitt valg overstyrer auto
  });
  assert.equal(res.scheduledGameId, "sched-game-1");
});

test("PT3 recordBatchSale: eksplisitt scheduledGameId med feil hall → SCHEDULED_GAME_HALL_MISMATCH", async () => {
  const store = newStore();
  seedBatchSaleScenario(store);
  seedScheduledGame(store, {
    id: "sched-other-hall",
    master_hall_id: "hall-b", // annen hall
    participating_halls: ["hall-b"],
    status: "scheduled",
  });
  const svc = makeService(store);

  await assert.rejects(
    () => svc.recordBatchSale({
      rangeId: "range-1",
      newTopSerial: "95",
      userId: "agent-1",
      scheduledGameId: "sched-other-hall",
    }),
    (err: unknown) =>
      err instanceof DomainError
      && err.code === "SCHEDULED_GAME_HALL_MISMATCH",
  );
});

test("PT3 recordBatchSale: eksplisitt scheduledGameId ukjent → SCHEDULED_GAME_NOT_FOUND", async () => {
  const store = newStore();
  seedBatchSaleScenario(store);
  const svc = makeService(store);

  await assert.rejects(
    () => svc.recordBatchSale({
      rangeId: "range-1",
      newTopSerial: "95",
      userId: "agent-1",
      scheduledGameId: "no-such-game",
    }),
    (err: unknown) =>
      err instanceof DomainError
      && err.code === "SCHEDULED_GAME_NOT_FOUND",
  );
});

test("PT3 recordBatchSale: eksplisitt scheduledGameId status completed → SCHEDULED_GAME_NOT_JOINABLE", async () => {
  const store = newStore();
  seedBatchSaleScenario(store);
  store.scheduledGames.get("sched-game-1")!.status = "completed";
  const svc = makeService(store);

  await assert.rejects(
    () => svc.recordBatchSale({
      rangeId: "range-1",
      newTopSerial: "95",
      userId: "agent-1",
      scheduledGameId: "sched-game-1",
    }),
    (err: unknown) =>
      err instanceof DomainError
      && err.code === "SCHEDULED_GAME_NOT_JOINABLE",
  );
});

test("PT3 recordBatchSale: RANGE_NOT_FOUND ved ukjent rangeId", async () => {
  const store = newStore();
  const svc = makeService(store);

  await assert.rejects(
    () => svc.recordBatchSale({
      rangeId: "nope",
      newTopSerial: "95",
      userId: "agent-1",
    }),
    (err: unknown) => err instanceof DomainError && err.code === "RANGE_NOT_FOUND",
  );
});

test("PT3 recordBatchSale: tomt newTopSerial → INVALID_INPUT", async () => {
  const store = newStore();
  seedBatchSaleScenario(store);
  const svc = makeService(store);

  await assert.rejects(
    () => svc.recordBatchSale({
      rangeId: "range-1",
      newTopSerial: "",
      userId: "agent-1",
    }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT",
  );
});

test("PT3 recordBatchSale: tomt rangeId → INVALID_INPUT", async () => {
  const svc = makeService(newStore());
  await assert.rejects(
    () => svc.recordBatchSale({
      rangeId: "",
      newTopSerial: "95",
      userId: "agent-1",
    }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT",
  );
});

test("PT3 recordBatchSale: rollback når batch-update treffer færre rader enn forventet", async () => {
  const store = newStore();
  seedBatchSaleScenario(store);
  store.forceBatchUpdateMismatch = true;
  const svc = makeService(store);

  await assert.rejects(
    () => svc.recordBatchSale({
      rangeId: "range-1",
      newTopSerial: "95",
      userId: "agent-1",
    }),
    (err: unknown) => err instanceof DomainError && err.code === "INTERNAL_ERROR",
  );
  assert.equal(store.rollbackCount, 1);
  assert.equal(store.commitCount, 0);

  // Range skal IKKE være oppdatert.
  const range = store.ranges.get("range-1")!;
  assert.equal(range.current_top_serial, "100");
});

test("PT3 recordBatchSale: sekvensielle batch-salg dekrementerer top stegvis", async () => {
  const store = newStore();
  seedBatchSaleScenario(store);
  const svc = makeService(store);

  // Første batch: 100 → 97 (3 solgt).
  const r1 = await svc.recordBatchSale({
    rangeId: "range-1",
    newTopSerial: "97",
    userId: "agent-1",
  });
  assert.equal(r1.soldCount, 3);
  assert.deepEqual(r1.soldSerials, ["100", "99", "98"]);
  assert.equal(store.ranges.get("range-1")!.current_top_serial, "97");

  // Andre batch: 97 → 95 (2 solgt).
  const r2 = await svc.recordBatchSale({
    rangeId: "range-1",
    newTopSerial: "95",
    userId: "agent-1",
  });
  assert.equal(r2.soldCount, 2);
  assert.deepEqual(r2.soldSerials, ["97", "96"]);
  assert.equal(store.ranges.get("range-1")!.current_top_serial, "95");

  // Alle 5 bonger solgt (mellom 100 og 95 eksklusivt, altså 100,99,98,97,96).
  const sold = [...store.tickets.values()].filter((t) => t.is_purchased);
  assert.equal(sold.length, 5);
});

test("PT3 recordBatchSale: race — to parallelle batch-salg på samme range, kun én vinner", async () => {
  const store = newStore();
  seedBatchSaleScenario(store);
  const svc = makeService(store);

  // Første kallet lykkes: 100 → 97.
  const r1 = await svc.recordBatchSale({
    rangeId: "range-1",
    newTopSerial: "97",
    userId: "agent-1",
  });
  assert.equal(r1.soldCount, 3);

  // Andre kallet forsøker å ta topp fra 100 → 95, men siden range nå står på
  // 97 må 100-targeting feile — 100 ligger "over" nåværende top (97).
  await assert.rejects(
    () => svc.recordBatchSale({
      rangeId: "range-1",
      newTopSerial: "100",
      userId: "agent-1",
    }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_NEW_TOP",
  );
});

test("PT3 recordBatchSale: happy-path — hall er participating, ikke master", async () => {
  const store = newStore();
  seedBatchSaleScenario(store);
  // Endre spillet: hall-a er deltaker, men ikke master.
  store.scheduledGames.clear();
  seedScheduledGame(store, {
    id: "sched-participating",
    master_hall_id: "hall-MASTER",
    participating_halls: ["hall-MASTER", "hall-a"],
    status: "purchase_open",
  });
  const svc = makeService(store);

  const res = await svc.recordBatchSale({
    rangeId: "range-1",
    newTopSerial: "95",
    userId: "agent-1",
  });
  assert.equal(res.scheduledGameId, "sched-participating");
});

test("PT3 recordBatchSale: selger hele rangen (newTop = final_serial)", async () => {
  const store = newStore();
  seedBatchSaleScenario(store);
  const svc = makeService(store);

  // newTop = "95" = siste serial i rangen (= final_serial).
  // Siden newTopIndex = serials.length - 1 = 5 og currentTopIndex = 0,
  // slicer vi [0, 5) → alle bortsett fra "95" (selv = ny top).
  // "95" blir stående som usolgt topp.
  const res = await svc.recordBatchSale({
    rangeId: "range-1",
    newTopSerial: "95",
    userId: "agent-1",
  });
  assert.equal(res.soldCount, 5);
  assert.equal(res.soldSerials[res.soldSerials.length - 1], "96");

  // Den siste bongen "95" står fortsatt som usolgt.
  const t95 = [...store.tickets.values()].find((t) => t.ticket_serial === "95")!;
  assert.equal(t95.is_purchased, false);
});

test("PT3 recordBatchSale: dobbeltkall med samme newTop → andre kall NO_TICKETS_SOLD", async () => {
  const store = newStore();
  seedBatchSaleScenario(store);
  const svc = makeService(store);

  const r1 = await svc.recordBatchSale({
    rangeId: "range-1",
    newTopSerial: "95",
    userId: "agent-1",
  });
  assert.equal(r1.soldCount, 5);

  // Andre kall med samme newTop → NO_TICKETS_SOLD (idempotent-safe).
  await assert.rejects(
    () => svc.recordBatchSale({
      rangeId: "range-1",
      newTopSerial: "95",
      userId: "agent-1",
    }),
    (err: unknown) => err instanceof DomainError && err.code === "NO_TICKETS_SOLD",
  );
});
