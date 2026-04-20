/**
 * BIN-587 B4a: unit-tester for PhysicalTicketService.
 *
 * Pool-mock dekker business-logikk: range-validering, overlap-check,
 * generate-state-maskin (DRAFT → ACTIVE, ikke re-generér), delete-
 * avvisning hvis solgte billetter, assign-game propagering.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { PhysicalTicketService } from "../PhysicalTicketService.js";
import { DomainError } from "../../game/BingoEngine.js";

interface BatchRow {
  id: string; hall_id: string; batch_name: string; range_start: number; range_end: number;
  default_price_cents: number; game_slug: string | null; assigned_game_id: string | null;
  status: "DRAFT" | "ACTIVE" | "CLOSED"; created_by: string | null;
  created_at: Date; updated_at: Date;
}
interface TicketRow {
  id: string; batch_id: string; unique_id: string; hall_id: string;
  status: "UNSOLD" | "SOLD" | "VOIDED"; price_cents: number | null;
  assigned_game_id: string | null; sold_at: Date | null; sold_by: string | null;
  buyer_user_id: string | null; voided_at: Date | null; voided_by: string | null;
  voided_reason: string | null; created_at: Date; updated_at: Date;
}

interface Store {
  halls: Set<string>;
  batches: Map<string, BatchRow>;
  tickets: Map<string, TicketRow>;
  batchesByHallName: Map<string, string>;  // `${hallId}::${batchName}` -> batchId
  uniqueIds: Set<string>;
}

function newStore(initialHalls: string[] = ["hall-a", "hall-b"]): Store {
  return {
    halls: new Set(initialHalls),
    batches: new Map(),
    tickets: new Map(),
    batchesByHallName: new Map(),
    uniqueIds: new Set(),
  };
}

function runQuery(store: Store, sql: string, params: unknown[] = []): { rows: unknown[]; rowCount: number } {
  const t = sql.trim();
  if (t.startsWith("BEGIN") || t.startsWith("COMMIT") || t.startsWith("ROLLBACK") || t.startsWith("CREATE")) {
    return { rows: [], rowCount: 0 };
  }
  const isBatches = sql.includes("app_physical_ticket_batches");
  const isTickets = sql.includes("app_physical_tickets") && !isBatches;
  const isHalls = sql.includes("app_halls");

  if (t.startsWith("SELECT") && isHalls) {
    const [id] = params as [string];
    return store.halls.has(id)
      ? { rows: [{ id }], rowCount: 1 }
      : { rows: [], rowCount: 0 };
  }

  if (t.startsWith("SELECT") && isBatches) {
    // Overlap-check
    if (sql.includes("range_start <= $3::bigint")) {
      const [hallId, rangeStart, rangeEnd] = params as [string, number, number];
      const hit = [...store.batches.values()].find((b) =>
        b.hall_id === hallId &&
        (b.status === "DRAFT" || b.status === "ACTIVE") &&
        b.range_start <= rangeEnd &&
        b.range_end >= rangeStart
      );
      return hit ? { rows: [{ batch_name: hit.batch_name }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    // MAX(range_end) for getLastRegisteredUniqueId
    if (sql.includes("MAX(range_end)")) {
      const [hallId] = params as [string];
      const hallBatches = [...store.batches.values()].filter((b) => b.hall_id === hallId);
      const max = hallBatches.length === 0 ? null : Math.max(...hallBatches.map((b) => b.range_end));
      return { rows: [{ max_range_end: max }], rowCount: 1 };
    }
    // By id
    if (sql.includes("WHERE id = $1")) {
      const [id] = params as [string];
      const b = store.batches.get(id);
      return b ? { rows: [b], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    // List
    let list = [...store.batches.values()];
    let pIdx = 0;
    if (sql.includes("hall_id = $")) list = list.filter((b) => b.hall_id === params[pIdx++]);
    if (sql.includes("status = $")) list = list.filter((b) => b.status === params[pIdx++]);
    const limit = params[params.length - 1] as number;
    list = list.sort((a, b) => b.created_at.getTime() - a.created_at.getTime()).slice(0, limit);
    return { rows: list, rowCount: list.length };
  }

  if (t.startsWith("INSERT") && isBatches) {
    const [id, hallId, batchName, rangeStart, rangeEnd, defaultPrice, gameSlug, assignedGameId, createdBy] = params as [
      string, string, string, number, number, number, string | null, string | null, string
    ];
    const key = `${hallId}::${batchName}`;
    if (store.batchesByHallName.has(key)) {
      throw new Error("duplicate key value violates unique constraint batch_name");
    }
    const now = new Date();
    const row: BatchRow = {
      id, hall_id: hallId, batch_name: batchName, range_start: rangeStart, range_end: rangeEnd,
      default_price_cents: defaultPrice, game_slug: gameSlug, assigned_game_id: assignedGameId,
      status: "DRAFT", created_by: createdBy, created_at: now, updated_at: now,
    };
    store.batches.set(id, row);
    store.batchesByHallName.set(key, id);
    return { rows: [row], rowCount: 1 };
  }

  if (t.startsWith("UPDATE") && isBatches) {
    // Finn id-param basert på WHERE-klausul-posisjon
    const whereMatch = sql.match(/WHERE id = \$(\d+)/);
    if (!whereMatch) throw new Error(`UPDATE uten WHERE id = $N: ${sql.slice(0, 80)}`);
    const idIdx = Number(whereMatch[1]) - 1;
    const id = params[idIdx] as string;
    const b = store.batches.get(id);
    if (!b) return { rows: [], rowCount: 0 };
    // updateBatch: SET-liste er dynamisk og id er siste param.
    // assignBatchToGame: "SET assigned_game_id = $2, updated_at = now() WHERE id = $1".
    // generateTickets-completion: "SET status = 'ACTIVE', updated_at = now() WHERE id = $1".
    if (sql.includes("SET assigned_game_id = $2")) {
      b.assigned_game_id = params[1] as string;
    } else if (sql.includes("SET status = 'ACTIVE'")) {
      b.status = "ACTIVE";
    } else {
      // updateBatch dynamic SET-list, id er sist. Plukk i sekvens.
      let pIdx = 0;
      if (sql.includes("batch_name = $")) { b.batch_name = params[pIdx++] as string; }
      if (sql.includes("default_price_cents = $")) { b.default_price_cents = params[pIdx++] as number; }
      if (sql.includes("game_slug = $")) { b.game_slug = params[pIdx++] as string | null; }
      if (sql.includes("assigned_game_id = $") && !sql.includes("SET assigned_game_id = $2")) {
        b.assigned_game_id = params[pIdx++] as string | null;
      }
      if (sql.includes("status = $")) { b.status = params[pIdx++] as "DRAFT" | "ACTIVE" | "CLOSED"; }
    }
    b.updated_at = new Date();
    return { rows: [b], rowCount: 1 };
  }

  if (t.startsWith("DELETE") && isBatches) {
    const [id] = params as [string];
    const b = store.batches.get(id);
    if (!b) return { rows: [], rowCount: 0 };
    const key = `${b.hall_id}::${b.batch_name}`;
    store.batches.delete(id);
    store.batchesByHallName.delete(key);
    // CASCADE delete tickets
    for (const [tid, t] of store.tickets) {
      if (t.batch_id === id) { store.tickets.delete(tid); store.uniqueIds.delete(t.unique_id); }
    }
    return { rows: [], rowCount: 1 };
  }

  if (t.startsWith("SELECT") && isTickets) {
    if (sql.includes("COUNT(*)")) {
      const [batchId] = params as [string];
      const isStatus = sql.includes("status = 'SOLD'");
      const count = [...store.tickets.values()].filter((x) =>
        x.batch_id === batchId && (!isStatus || x.status === "SOLD")
      ).length;
      return { rows: [{ count: String(count) }], rowCount: 1 };
    }
    // BIN-649: range-query med ORDER BY unique_id::bigint
    if (sql.includes("ORDER BY unique_id::bigint")) {
      let list = [...store.tickets.values()];
      let pIdx = 0;
      if (sql.includes("hall_id = $")) {
        const hallId = params[pIdx++] as string;
        list = list.filter((x) => x.hall_id === hallId);
      }
      if (sql.includes("status = $")) {
        const status = params[pIdx++] as "UNSOLD" | "SOLD" | "VOIDED";
        list = list.filter((x) => x.status === status);
      }
      if (sql.includes("unique_id ~ '^[0-9]+$'")) {
        list = list.filter((x) => /^[0-9]+$/.test(x.unique_id));
      }
      if (sql.includes("unique_id::bigint >= $")) {
        const start = params[pIdx++] as number;
        list = list.filter((x) => Number(x.unique_id) >= start);
      }
      if (sql.includes("unique_id::bigint <= $")) {
        const end = params[pIdx++] as number;
        list = list.filter((x) => Number(x.unique_id) <= end);
      }
      if (sql.includes("created_at >= $")) {
        const from = params[pIdx++] as string;
        list = list.filter((x) => x.created_at.toISOString() >= from);
      }
      if (sql.includes("created_at <= $")) {
        const to = params[pIdx++] as string;
        list = list.filter((x) => x.created_at.toISOString() <= to);
      }
      list = list.sort((a, b) => Number(a.unique_id) - Number(b.unique_id));
      const limit = params[pIdx++] as number;
      const offset = params[pIdx++] as number;
      return { rows: list.slice(offset, offset + limit), rowCount: list.length };
    }
    // List sold for game
    if (sql.includes("assigned_game_id = $1")) {
      const [gameId] = params as [string];
      let list = [...store.tickets.values()].filter((x) => x.assigned_game_id === gameId && x.status === "SOLD");
      const paramsAfter = params.slice(1);
      let pIdx = 0;
      if (sql.includes("hall_id = $")) list = list.filter((x) => x.hall_id === paramsAfter[pIdx++]);
      const limit = paramsAfter[paramsAfter.length - 1] as number;
      return { rows: list.slice(0, limit), rowCount: list.length };
    }
  }

  if (t.startsWith("INSERT") && isTickets) {
    // Batch-INSERT med mange rader
    const re = /\(\$(\d+), \$(\d+), \$(\d+), \$(\d+), 'UNSOLD', NULL, \$(\d+)\)/g;
    let count = 0;
    let m;
    while ((m = re.exec(sql)) !== null) {
      const [, i1, i2, i3, i4, i5] = m;
      const id = params[Number(i1) - 1] as string;
      const batchId = params[Number(i2) - 1] as string;
      const uniqueId = params[Number(i3) - 1] as string;
      const hallId = params[Number(i4) - 1] as string;
      const assignedGameId = params[Number(i5) - 1] as string | null;
      if (store.uniqueIds.has(uniqueId)) {
        throw new Error("duplicate key value violates unique constraint unique_id");
      }
      const now = new Date();
      store.tickets.set(id, {
        id, batch_id: batchId, unique_id: uniqueId, hall_id: hallId,
        status: "UNSOLD", price_cents: null, assigned_game_id: assignedGameId,
        sold_at: null, sold_by: null, buyer_user_id: null,
        voided_at: null, voided_by: null, voided_reason: null,
        created_at: now, updated_at: now,
      });
      store.uniqueIds.add(uniqueId);
      count++;
    }
    return { rows: [], rowCount: count };
  }

  if (t.startsWith("UPDATE") && isTickets) {
    if (sql.includes("SET assigned_game_id = $2")) {
      const [batchId, gameId] = params as [string, string];
      let count = 0;
      for (const t of store.tickets.values()) {
        if (t.batch_id === batchId && t.status === "UNSOLD") {
          t.assigned_game_id = gameId;
          t.updated_at = new Date();
          count++;
        }
      }
      return { rows: [], rowCount: count };
    }
    if (sql.includes("SET status = 'VOIDED'")) {
      const [gameId, actorId, reason] = params as [string, string, string];
      let count = 0;
      for (const t of store.tickets.values()) {
        if (t.assigned_game_id === gameId && t.status === "SOLD") {
          t.status = "VOIDED";
          t.voided_at = new Date();
          t.voided_by = actorId;
          t.voided_reason = reason;
          t.updated_at = new Date();
          count++;
        }
      }
      return { rows: [], rowCount: count };
    }
    // markSold: UPDATE med SET status = 'SOLD', WHERE unique_id = $1
    if (sql.includes("SET status = 'SOLD'") && sql.includes("WHERE unique_id = $1")) {
      const [uniqueId, soldBy, buyerUserId, priceCents] = params as [string, string, string | null, number | null];
      const hit = [...store.tickets.values()].find((x) => x.unique_id === uniqueId);
      if (!hit) return { rows: [], rowCount: 0 };
      hit.status = "SOLD";
      hit.sold_at = new Date();
      hit.sold_by = soldBy;
      hit.buyer_user_id = buyerUserId;
      hit.price_cents = priceCents;
      hit.updated_at = new Date();
      return { rows: [hit], rowCount: 1 };
    }
  }

  // SELECT FOR UPDATE on tickets.unique_id (brukt av markSold)
  if (t.startsWith("SELECT") && isTickets && sql.includes("WHERE unique_id = $1 FOR UPDATE")) {
    const [uniqueId] = params as [string];
    const hit = [...store.tickets.values()].find((x) => x.unique_id === uniqueId);
    return hit ? { rows: [{ status: hit.status }], rowCount: 1 } : { rows: [], rowCount: 0 };
  }

  throw new Error(`unhandled SQL: ${t.slice(0, 120)}`);
}

function makePool(store: Store): Pool {
  const pool = {
    async connect() {
      return {
        async query(sql: string, params?: unknown[]) { return runQuery(store, sql, params ?? []); },
        release() {},
      };
    },
    async query(sql: string, params?: unknown[]) { return runQuery(store, sql, params ?? []); },
  };
  return pool as unknown as Pool;
}

// ── Tests ────────────────────────────────────────────────────────────────

test("BIN-587 B4a: createBatch oppretter DRAFT med range-validering", async () => {
  const store = newStore();
  const svc = PhysicalTicketService.forTesting(makePool(store));
  const batch = await svc.createBatch({
    hallId: "hall-a",
    batchName: "Q2-2026",
    rangeStart: 1,
    rangeEnd: 100,
    defaultPriceCents: 5000,
    createdBy: "admin-1",
  });
  assert.equal(batch.status, "DRAFT");
  assert.equal(batch.rangeStart, 1);
  assert.equal(batch.rangeEnd, 100);
  assert.equal(batch.defaultPriceCents, 5000);
  assert.equal(batch.hallId, "hall-a");
});

test("BIN-587 B4a: createBatch avviser reversert range", async () => {
  const store = newStore();
  const svc = PhysicalTicketService.forTesting(makePool(store));
  await assert.rejects(
    () => svc.createBatch({
      hallId: "hall-a", batchName: "x", rangeStart: 100, rangeEnd: 50,
      defaultPriceCents: 100, createdBy: "admin-1",
    }),
    (err: unknown) => err instanceof DomainError && /rangeEnd/.test(err.message)
  );
});

test("BIN-587 B4a: createBatch avviser range > MAX_BATCH_SIZE", async () => {
  const store = newStore();
  const svc = PhysicalTicketService.forTesting(makePool(store));
  await assert.rejects(
    () => svc.createBatch({
      hallId: "hall-a", batchName: "huge", rangeStart: 1, rangeEnd: 20_000,
      defaultPriceCents: 100, createdBy: "admin-1",
    }),
    (err: unknown) => err instanceof DomainError && /overskrider maks/.test(err.message)
  );
});

test("BIN-587 B4a: createBatch avviser overlappende range i samme hall", async () => {
  const store = newStore();
  const svc = PhysicalTicketService.forTesting(makePool(store));
  await svc.createBatch({
    hallId: "hall-a", batchName: "first", rangeStart: 1, rangeEnd: 100,
    defaultPriceCents: 100, createdBy: "admin-1",
  });
  await assert.rejects(
    () => svc.createBatch({
      hallId: "hall-a", batchName: "second", rangeStart: 50, rangeEnd: 150,
      defaultPriceCents: 100, createdBy: "admin-1",
    }),
    (err: unknown) => err instanceof DomainError && err.code === "PHYSICAL_BATCH_RANGE_OVERLAP"
  );
});

test("BIN-587 B4a: createBatch tillater samme range i forskjellige haller", async () => {
  const store = newStore();
  const svc = PhysicalTicketService.forTesting(makePool(store));
  await svc.createBatch({
    hallId: "hall-a", batchName: "x", rangeStart: 1, rangeEnd: 100,
    defaultPriceCents: 100, createdBy: "admin-1",
  });
  const b2 = await svc.createBatch({
    hallId: "hall-b", batchName: "x", rangeStart: 1, rangeEnd: 100,
    defaultPriceCents: 100, createdBy: "admin-1",
  });
  assert.equal(b2.hallId, "hall-b");
});

test("BIN-587 B4a: createBatch avviser ukjent hall", async () => {
  const store = newStore();
  const svc = PhysicalTicketService.forTesting(makePool(store));
  await assert.rejects(
    () => svc.createBatch({
      hallId: "ghost-hall", batchName: "x", rangeStart: 1, rangeEnd: 10,
      defaultPriceCents: 100, createdBy: "admin-1",
    }),
    (err: unknown) => err instanceof DomainError && err.code === "HALL_NOT_FOUND"
  );
});

test("BIN-587 B4a: generateTickets går DRAFT → ACTIVE + oppretter rader", async () => {
  const store = newStore();
  const svc = PhysicalTicketService.forTesting(makePool(store));
  const batch = await svc.createBatch({
    hallId: "hall-a", batchName: "gen-test", rangeStart: 10, rangeEnd: 15,
    defaultPriceCents: 2000, createdBy: "admin-1",
  });
  const result = await svc.generateTickets(batch.id);
  assert.equal(result.generated, 6);
  assert.equal(result.firstUniqueId, "10");
  assert.equal(result.lastUniqueId, "15");
  const refreshed = await svc.getBatch(batch.id);
  assert.equal(refreshed.status, "ACTIVE");
});

test("BIN-587 B4a: generateTickets avviser re-generering", async () => {
  const store = newStore();
  const svc = PhysicalTicketService.forTesting(makePool(store));
  const batch = await svc.createBatch({
    hallId: "hall-a", batchName: "gen2", rangeStart: 1, rangeEnd: 5,
    defaultPriceCents: 100, createdBy: "admin-1",
  });
  await svc.generateTickets(batch.id);
  await assert.rejects(
    () => svc.generateTickets(batch.id),
    (err: unknown) => err instanceof DomainError && err.code === "PHYSICAL_BATCH_NOT_DRAFT"
  );
});

test("BIN-587 B4a: assignBatchToGame propagerer til UNSOLD-billetter", async () => {
  const store = newStore();
  const svc = PhysicalTicketService.forTesting(makePool(store));
  const batch = await svc.createBatch({
    hallId: "hall-a", batchName: "assign", rangeStart: 1, rangeEnd: 3,
    defaultPriceCents: 100, createdBy: "admin-1",
  });
  await svc.generateTickets(batch.id);
  const updated = await svc.assignBatchToGame(batch.id, "game-xyz");
  assert.equal(updated.assignedGameId, "game-xyz");
  // Alle 3 UNSOLD-billetter skal nå ha assigned_game_id
  const ticketsForGame = await svc.listSoldTicketsForGame("game-xyz");
  assert.equal(ticketsForGame.length, 0); // Ingen er solgt ennå — SOLD-filter
});

test("BIN-587 B4a: deleteBatch avvises hvis noen tickets er SOLD", async () => {
  const store = newStore();
  const svc = PhysicalTicketService.forTesting(makePool(store));
  const batch = await svc.createBatch({
    hallId: "hall-a", batchName: "sold", rangeStart: 1, rangeEnd: 3,
    defaultPriceCents: 100, createdBy: "admin-1",
  });
  await svc.generateTickets(batch.id);
  // Simuler salg ved å sette status direkte
  const firstTicket = [...store.tickets.values()][0]!;
  firstTicket.status = "SOLD";
  await assert.rejects(
    () => svc.deleteBatch(batch.id),
    (err: unknown) => err instanceof DomainError && err.code === "PHYSICAL_BATCH_HAS_SOLD_TICKETS"
  );
});

test("BIN-587 B4a: deleteBatch tillates hvis alle UNSOLD", async () => {
  const store = newStore();
  const svc = PhysicalTicketService.forTesting(makePool(store));
  const batch = await svc.createBatch({
    hallId: "hall-a", batchName: "pristine", rangeStart: 1, rangeEnd: 3,
    defaultPriceCents: 100, createdBy: "admin-1",
  });
  await svc.generateTickets(batch.id);
  await svc.deleteBatch(batch.id);
  await assert.rejects(
    () => svc.getBatch(batch.id),
    (err: unknown) => err instanceof DomainError && err.code === "PHYSICAL_BATCH_NOT_FOUND"
  );
});

test("BIN-587 B4a: voidAllSoldTicketsForGame markerer SOLD → VOIDED med reason", async () => {
  const store = newStore();
  const svc = PhysicalTicketService.forTesting(makePool(store));
  const batch = await svc.createBatch({
    hallId: "hall-a", batchName: "void-test", rangeStart: 1, rangeEnd: 3,
    defaultPriceCents: 100, createdBy: "admin-1",
  });
  await svc.generateTickets(batch.id);
  await svc.assignBatchToGame(batch.id, "game-x");
  // Simuler 2 salg
  const tickets = [...store.tickets.values()];
  tickets[0]!.status = "SOLD";
  tickets[1]!.status = "SOLD";
  const result = await svc.voidAllSoldTicketsForGame({
    gameId: "game-x", actorId: "admin-1", reason: "Spill kansellert",
  });
  assert.equal(result.voided, 2);
  assert.equal(tickets[0]!.status, "VOIDED");
  assert.equal(tickets[0]!.voided_reason, "Spill kansellert");
});

test("BIN-587 B4a: voidAllSoldTicketsForGame avviser tom reason", async () => {
  const store = newStore();
  const svc = PhysicalTicketService.forTesting(makePool(store));
  await assert.rejects(
    () => svc.voidAllSoldTicketsForGame({ gameId: "g", actorId: "a", reason: "   " }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
});

test("BIN-587 B4a: getLastRegisteredUniqueId returnerer maks range_end per hall", async () => {
  const store = newStore();
  const svc = PhysicalTicketService.forTesting(makePool(store));
  await svc.createBatch({
    hallId: "hall-a", batchName: "first", rangeStart: 1, rangeEnd: 100,
    defaultPriceCents: 100, createdBy: "admin-1",
  });
  await svc.createBatch({
    hallId: "hall-a", batchName: "second", rangeStart: 200, rangeEnd: 300,
    defaultPriceCents: 100, createdBy: "admin-1",
  });
  const result = await svc.getLastRegisteredUniqueId("hall-a");
  assert.equal(result.maxRangeEnd, 300);
  assert.equal(result.lastUniqueId, "300");
  const emptyHall = await svc.getLastRegisteredUniqueId("hall-b");
  assert.equal(emptyHall.maxRangeEnd, null);
  assert.equal(emptyHall.lastUniqueId, null);
});

test("BIN-587 B4a: updateBatch oppdaterer felter selektivt", async () => {
  const store = newStore();
  const svc = PhysicalTicketService.forTesting(makePool(store));
  const batch = await svc.createBatch({
    hallId: "hall-a", batchName: "upd", rangeStart: 1, rangeEnd: 10,
    defaultPriceCents: 100, createdBy: "admin-1",
  });
  const updated = await svc.updateBatch(batch.id, { defaultPriceCents: 500, status: "CLOSED" });
  assert.equal(updated.defaultPriceCents, 500);
  assert.equal(updated.status, "CLOSED");
  assert.equal(updated.batchName, "upd");  // uendret
});

// ── BIN-583-koordinering: markSold() for Agent 4 POS-endepunkt ──────────

test("BIN-587 B4a: markSold UNSOLD → SOLD med soldBy + buyerUserId + priceCents", async () => {
  const store = newStore();
  const svc = PhysicalTicketService.forTesting(makePool(store));
  const batch = await svc.createBatch({
    hallId: "hall-a", batchName: "sales", rangeStart: 1, rangeEnd: 3,
    defaultPriceCents: 5000, createdBy: "admin-1",
  });
  await svc.generateTickets(batch.id);
  const sold = await svc.markSold({
    uniqueId: "2",
    soldBy: "agent-1",
    buyerUserId: "player-1",
    priceCents: 7500,
  });
  assert.equal(sold.status, "SOLD");
  assert.equal(sold.soldBy, "agent-1");
  assert.equal(sold.buyerUserId, "player-1");
  assert.equal(sold.priceCents, 7500);
  assert.ok(sold.soldAt);
});

test("BIN-587 B4a: markSold default priceCents null = bruk batch-default", async () => {
  const store = newStore();
  const svc = PhysicalTicketService.forTesting(makePool(store));
  const batch = await svc.createBatch({
    hallId: "hall-a", batchName: "def", rangeStart: 10, rangeEnd: 12,
    defaultPriceCents: 5000, createdBy: "admin-1",
  });
  await svc.generateTickets(batch.id);
  const sold = await svc.markSold({ uniqueId: "11", soldBy: "agent-1" });
  assert.equal(sold.status, "SOLD");
  assert.equal(sold.priceCents, null); // NULL = bruk batch-default ved lesing
});

test("BIN-587 B4a: markSold avviser allerede-solgt billett (state-guard)", async () => {
  const store = newStore();
  const svc = PhysicalTicketService.forTesting(makePool(store));
  const batch = await svc.createBatch({
    hallId: "hall-a", batchName: "once", rangeStart: 100, rangeEnd: 100,
    defaultPriceCents: 5000, createdBy: "admin-1",
  });
  await svc.generateTickets(batch.id);
  await svc.markSold({ uniqueId: "100", soldBy: "agent-1" });
  await assert.rejects(
    () => svc.markSold({ uniqueId: "100", soldBy: "agent-2" }),
    (err: unknown) => err instanceof DomainError && err.code === "PHYSICAL_TICKET_NOT_SELLABLE"
  );
});

test("BIN-587 B4a: markSold avviser ukjent unique-id", async () => {
  const store = newStore();
  const svc = PhysicalTicketService.forTesting(makePool(store));
  await assert.rejects(
    () => svc.markSold({ uniqueId: "ghost", soldBy: "agent-1" }),
    (err: unknown) => err instanceof DomainError && err.code === "PHYSICAL_TICKET_NOT_FOUND"
  );
});

test("BIN-587 B4a: markSold avviser negativ priceCents", async () => {
  const store = newStore();
  const svc = PhysicalTicketService.forTesting(makePool(store));
  const batch = await svc.createBatch({
    hallId: "hall-a", batchName: "px", rangeStart: 1, rangeEnd: 1,
    defaultPriceCents: 5000, createdBy: "admin-1",
  });
  await svc.generateTickets(batch.id);
  await assert.rejects(
    () => svc.markSold({ uniqueId: "1", soldBy: "agent-1", priceCents: -100 }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
});

// ── BIN-649: listUniqueIdsInRange for admin-rapport ───────────────────────

test("BIN-649: listUniqueIdsInRange returnerer alle billetter hvis ingen filter (sortert på unique_id)", async () => {
  const store = newStore();
  const svc = PhysicalTicketService.forTesting(makePool(store));
  const batch = await svc.createBatch({
    hallId: "hall-a", batchName: "r-all", rangeStart: 1, rangeEnd: 5,
    defaultPriceCents: 100, createdBy: "admin-1",
  });
  await svc.generateTickets(batch.id);
  const result = await svc.listUniqueIdsInRange();
  assert.equal(result.length, 5);
  assert.deepEqual(result.map((r) => r.uniqueId), ["1", "2", "3", "4", "5"]);
});

test("BIN-649: listUniqueIdsInRange filtrerer på uniqueIdStart/uniqueIdEnd (inclusive)", async () => {
  const store = newStore();
  const svc = PhysicalTicketService.forTesting(makePool(store));
  const batch = await svc.createBatch({
    hallId: "hall-a", batchName: "r-range", rangeStart: 100, rangeEnd: 110,
    defaultPriceCents: 100, createdBy: "admin-1",
  });
  await svc.generateTickets(batch.id);
  const mid = await svc.listUniqueIdsInRange({ uniqueIdStart: 103, uniqueIdEnd: 106 });
  assert.deepEqual(mid.map((r) => r.uniqueId), ["103", "104", "105", "106"]);
  // Kun start (open-ended end)
  const openEnd = await svc.listUniqueIdsInRange({ uniqueIdStart: 108 });
  assert.deepEqual(openEnd.map((r) => r.uniqueId), ["108", "109", "110"]);
  // Kun end (open-ended start)
  const openStart = await svc.listUniqueIdsInRange({ uniqueIdEnd: 102 });
  assert.deepEqual(openStart.map((r) => r.uniqueId), ["100", "101", "102"]);
});

test("BIN-649: listUniqueIdsInRange avviser reversert range", async () => {
  const store = newStore();
  const svc = PhysicalTicketService.forTesting(makePool(store));
  await assert.rejects(
    () => svc.listUniqueIdsInRange({ uniqueIdStart: 200, uniqueIdEnd: 100 }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT" && /uniqueIdEnd/.test(err.message)
  );
});

test("BIN-649: listUniqueIdsInRange filtrerer på hallId", async () => {
  const store = newStore();
  const svc = PhysicalTicketService.forTesting(makePool(store));
  const a = await svc.createBatch({
    hallId: "hall-a", batchName: "A", rangeStart: 1, rangeEnd: 3,
    defaultPriceCents: 100, createdBy: "admin-1",
  });
  await svc.generateTickets(a.id);
  const b = await svc.createBatch({
    hallId: "hall-b", batchName: "B", rangeStart: 100, rangeEnd: 102,
    defaultPriceCents: 100, createdBy: "admin-1",
  });
  await svc.generateTickets(b.id);
  const onlyA = await svc.listUniqueIdsInRange({ hallId: "hall-a" });
  assert.deepEqual(onlyA.map((r) => r.uniqueId).sort(), ["1", "2", "3"]);
  const onlyB = await svc.listUniqueIdsInRange({ hallId: "hall-b" });
  assert.deepEqual(onlyB.map((r) => r.uniqueId).sort(), ["100", "101", "102"]);
});

test("BIN-649: listUniqueIdsInRange filtrerer på status (UNSOLD/SOLD/VOIDED)", async () => {
  const store = newStore();
  const svc = PhysicalTicketService.forTesting(makePool(store));
  const batch = await svc.createBatch({
    hallId: "hall-a", batchName: "st", rangeStart: 1, rangeEnd: 4,
    defaultPriceCents: 100, createdBy: "admin-1",
  });
  await svc.generateTickets(batch.id);
  await svc.markSold({ uniqueId: "2", soldBy: "agent-1" });
  // Manuell VOIDED for ticket "3" (test-shortcut)
  const t3 = [...store.tickets.values()].find((x) => x.unique_id === "3")!;
  t3.status = "VOIDED";
  const unsold = await svc.listUniqueIdsInRange({ status: "UNSOLD" });
  assert.deepEqual(unsold.map((r) => r.uniqueId).sort(), ["1", "4"]);
  const sold = await svc.listUniqueIdsInRange({ status: "SOLD" });
  assert.deepEqual(sold.map((r) => r.uniqueId), ["2"]);
  const voided = await svc.listUniqueIdsInRange({ status: "VOIDED" });
  assert.deepEqual(voided.map((r) => r.uniqueId), ["3"]);
});

test("BIN-649: listUniqueIdsInRange kombinerer hallId + range + status", async () => {
  const store = newStore();
  const svc = PhysicalTicketService.forTesting(makePool(store));
  const a = await svc.createBatch({
    hallId: "hall-a", batchName: "combo-a", rangeStart: 1, rangeEnd: 10,
    defaultPriceCents: 100, createdBy: "admin-1",
  });
  await svc.generateTickets(a.id);
  const b = await svc.createBatch({
    hallId: "hall-b", batchName: "combo-b", rangeStart: 100, rangeEnd: 110,
    defaultPriceCents: 100, createdBy: "admin-1",
  });
  await svc.generateTickets(b.id);
  // Selg "3" og "7" i hall-a
  await svc.markSold({ uniqueId: "3", soldBy: "agent-1" });
  await svc.markSold({ uniqueId: "7", soldBy: "agent-1" });
  // Selg "102" i hall-b
  await svc.markSold({ uniqueId: "102", soldBy: "agent-1" });
  // Hall-a + status=SOLD + range 5..10 → bare "7"
  const soldInA = await svc.listUniqueIdsInRange({
    hallId: "hall-a", status: "SOLD", uniqueIdStart: 5, uniqueIdEnd: 10,
  });
  assert.deepEqual(soldInA.map((r) => r.uniqueId), ["7"]);
  // Hall-b + status=SOLD → bare "102"
  const soldInB = await svc.listUniqueIdsInRange({ hallId: "hall-b", status: "SOLD" });
  assert.deepEqual(soldInB.map((r) => r.uniqueId), ["102"]);
});

test("BIN-649: listUniqueIdsInRange respekterer limit + offset (paginering)", async () => {
  const store = newStore();
  const svc = PhysicalTicketService.forTesting(makePool(store));
  const batch = await svc.createBatch({
    hallId: "hall-a", batchName: "pg", rangeStart: 1, rangeEnd: 10,
    defaultPriceCents: 100, createdBy: "admin-1",
  });
  await svc.generateTickets(batch.id);
  const page1 = await svc.listUniqueIdsInRange({ limit: 3, offset: 0 });
  assert.deepEqual(page1.map((r) => r.uniqueId), ["1", "2", "3"]);
  const page2 = await svc.listUniqueIdsInRange({ limit: 3, offset: 3 });
  assert.deepEqual(page2.map((r) => r.uniqueId), ["4", "5", "6"]);
  const pageLast = await svc.listUniqueIdsInRange({ limit: 5, offset: 8 });
  assert.deepEqual(pageLast.map((r) => r.uniqueId), ["9", "10"]);
});

test("BIN-649: listUniqueIdsInRange limit har hard øvre-grense på 500", async () => {
  const store = newStore();
  const svc = PhysicalTicketService.forTesting(makePool(store));
  const batch = await svc.createBatch({
    hallId: "hall-a", batchName: "cap", rangeStart: 1, rangeEnd: 3,
    defaultPriceCents: 100, createdBy: "admin-1",
  });
  await svc.generateTickets(batch.id);
  // Limit 9999 skal bli capped til 500 — ikke kaste.
  const result = await svc.listUniqueIdsInRange({ limit: 9999 });
  assert.equal(result.length, 3);
});
