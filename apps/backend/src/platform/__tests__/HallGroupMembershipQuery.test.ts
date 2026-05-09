/**
 * Bølge 5 (2026-05-08): unit-tester for HallGroupMembershipQuery.
 *
 * Audit-rapport: `docs/architecture/PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT_2026-05-08.md`
 * §5 (C5) + §7 Bølge 5.
 *
 * Tester at:
 *   - `getActiveMembers` happy path returnerer aktive medlemmer
 *   - `getActiveMembers` returnerer null hvis gruppen ikke finnes
 *   - `getActiveMembers` returnerer tom liste hvis gruppen er tom
 *   - `getActiveMembers` setter `isMaster=true` for pinned master
 *   - `getMasterHallId` returnerer pinned master-id eller null
 *   - `isMember` returnerer boolean
 *   - `findGroupForHall` finner GoH for hall som medlem
 *   - `findGroupForHall` returnerer null hvis hall ikke i noen GoH
 *   - DB-feil propagerer som DomainError("DB_ERROR")
 *   - Schema-validering avviser ugyldige skjema-navn
 *   - Tom input (groupId / hallId) → INVALID_INPUT
 *
 * Tester bruker en stub-Pool som matcher `pg.Pool.query` sin minimal
 * signatur, så vi slipper å avhenge av en kjørende Postgres-instans.
 */

import test from "node:test";
import assert from "node:assert/strict";

import type { Pool } from "pg";

import { HallGroupMembershipQuery } from "../HallGroupMembershipQuery.js";
import { DomainError } from "../../errors/DomainError.js";

interface CapturedQuery {
  text: string;
  params: unknown[] | undefined;
}

interface StubResponse {
  rows: Record<string, unknown>[];
}

type QueryHandler = (
  text: string,
  params: unknown[] | undefined,
) => StubResponse | Promise<StubResponse>;

interface StubPoolOptions {
  /** Custom dispatcher — mottar alle query-call og returnerer rows. */
  handler?: QueryHandler;
  /** Om satt: kast denne feilen istedenfor å returnere rows. */
  errorMessage?: string;
}

function makeStubPool(opts: StubPoolOptions = {}): {
  pool: Pool;
  capturedQueries: CapturedQuery[];
} {
  const capturedQueries: CapturedQuery[] = [];
  const pool = {
    async query(
      text: string,
      params?: unknown[],
    ): Promise<StubResponse> {
      capturedQueries.push({ text, params });
      if (opts.errorMessage) {
        throw new Error(opts.errorMessage);
      }
      if (opts.handler) {
        return await opts.handler(text, params);
      }
      return { rows: [] };
    },
  };
  return {
    pool: pool as unknown as Pool,
    capturedQueries,
  };
}

// ── Constructor: schema-validering ──────────────────────────────────────

test("constructor — ugyldig schema-navn kaster INVALID_CONFIG", () => {
  const { pool } = makeStubPool();
  assert.throws(
    () => new HallGroupMembershipQuery({ pool, schema: "x; DROP TABLE" }),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "INVALID_CONFIG");
      return true;
    },
  );
});

test("constructor — default schema 'public' aksepteres", () => {
  const { pool } = makeStubPool();
  const query = new HallGroupMembershipQuery({ pool });
  assert.ok(query instanceof HallGroupMembershipQuery);
});

// ── getActiveMembers ────────────────────────────────────────────────────

test("getActiveMembers — happy path returnerer aktive medlemmer", async () => {
  const { pool, capturedQueries } = makeStubPool({
    handler: (text) => {
      if (/SELECT\s+master_hall_id/i.test(text)) {
        return { rows: [{ master_hall_id: "hall-master" }] };
      }
      if (/SELECT\s+m\.hall_id,\s*h\.name/i.test(text)) {
        return {
          rows: [
            { hall_id: "hall-master", hall_name: "Master Hall", is_active: true },
            { hall_id: "hall-bodo", hall_name: "Bodø", is_active: true },
            {
              hall_id: "hall-fauske",
              hall_name: "Fauske",
              is_active: true,
            },
          ],
        };
      }
      return { rows: [] };
    },
  });
  const query = new HallGroupMembershipQuery({ pool });
  const result = await query.getActiveMembers("grp-1");
  assert.ok(result !== null);
  assert.equal(result!.length, 3);
  // Master får isMaster=true
  const master = result!.find((m) => m.hallId === "hall-master")!;
  assert.equal(master.isMaster, true);
  // De andre får isMaster=false
  assert.equal(result!.find((m) => m.hallId === "hall-bodo")!.isMaster, false);
  // Begge SQL-er ble kalt
  assert.equal(capturedQueries.length, 2);
  // Andre query bruker masterHallId i ORDER BY
  assert.deepEqual(capturedQueries[1]!.params, ["grp-1", "hall-master"]);
});

test("getActiveMembers — gruppen ikke funnet → null", async () => {
  const { pool, capturedQueries } = makeStubPool({
    handler: (text) => {
      if (/SELECT\s+master_hall_id/i.test(text)) {
        return { rows: [] }; // ikke funnet
      }
      return { rows: [] };
    },
  });
  const query = new HallGroupMembershipQuery({ pool });
  const result = await query.getActiveMembers("grp-missing");
  assert.equal(result, null);
  // Andre query (members) skal IKKE kjøres når gruppen ikke finnes.
  assert.equal(capturedQueries.length, 1);
});

test("getActiveMembers — tom gruppe → tom array (ikke null)", async () => {
  const { pool } = makeStubPool({
    handler: (text) => {
      if (/SELECT\s+master_hall_id/i.test(text)) {
        return { rows: [{ master_hall_id: null }] };
      }
      if (/SELECT\s+m\.hall_id,\s*h\.name/i.test(text)) {
        return { rows: [] };
      }
      return { rows: [] };
    },
  });
  const query = new HallGroupMembershipQuery({ pool });
  const result = await query.getActiveMembers("grp-empty");
  assert.deepEqual(result, []);
});

test("getActiveMembers — gruppen uten pinned master → ingen isMaster=true", async () => {
  const { pool } = makeStubPool({
    handler: (text) => {
      if (/SELECT\s+master_hall_id/i.test(text)) {
        return { rows: [{ master_hall_id: null }] };
      }
      if (/SELECT\s+m\.hall_id,\s*h\.name/i.test(text)) {
        return {
          rows: [
            { hall_id: "hall-a", hall_name: "Hall A", is_active: true },
            { hall_id: "hall-b", hall_name: "Hall B", is_active: true },
          ],
        };
      }
      return { rows: [] };
    },
  });
  const query = new HallGroupMembershipQuery({ pool });
  const result = await query.getActiveMembers("grp-no-master");
  assert.ok(result !== null);
  assert.equal(result!.every((m) => m.isMaster === false), true);
});

test("getActiveMembers — tom groupId → INVALID_INPUT", async () => {
  const { pool } = makeStubPool();
  const query = new HallGroupMembershipQuery({ pool });
  await assert.rejects(
    () => query.getActiveMembers(""),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "INVALID_INPUT");
      return true;
    },
  );
});

test("getActiveMembers — DB-feil i group-query → DomainError(DB_ERROR)", async () => {
  const { pool } = makeStubPool({ errorMessage: "connection refused" });
  const query = new HallGroupMembershipQuery({ pool });
  await assert.rejects(
    () => query.getActiveMembers("grp-1"),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "DB_ERROR");
      return true;
    },
  );
});

test("getActiveMembers — DB-feil i members-query → DomainError(DB_ERROR)", async () => {
  let callCount = 0;
  const { pool } = makeStubPool({
    handler: (text) => {
      callCount++;
      if (callCount === 1 && /SELECT\s+master_hall_id/i.test(text)) {
        return { rows: [{ master_hall_id: "hall-master" }] };
      }
      // Andre kall (members-query) feiler:
      throw new Error("members-query crashed");
    },
  });
  const query = new HallGroupMembershipQuery({ pool });
  await assert.rejects(
    () => query.getActiveMembers("grp-1"),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "DB_ERROR");
      return true;
    },
  );
});

// ── getMasterHallId ─────────────────────────────────────────────────────

test("getMasterHallId — happy path returnerer pinned master", async () => {
  const { pool, capturedQueries } = makeStubPool({
    handler: () => ({ rows: [{ master_hall_id: "hall-pinned" }] }),
  });
  const query = new HallGroupMembershipQuery({ pool });
  const result = await query.getMasterHallId("grp-1");
  assert.equal(result, "hall-pinned");
  // Query bruker LEFT JOIN for å sjekke at master er aktiv
  assert.match(capturedQueries[0]!.text, /LEFT JOIN/i);
});

test("getMasterHallId — null returneres når ikke satt", async () => {
  const { pool } = makeStubPool({
    handler: () => ({ rows: [{ master_hall_id: null }] }),
  });
  const query = new HallGroupMembershipQuery({ pool });
  const result = await query.getMasterHallId("grp-no-pin");
  assert.equal(result, null);
});

test("getMasterHallId — gruppen ikke funnet → null", async () => {
  const { pool } = makeStubPool({
    handler: () => ({ rows: [] }),
  });
  const query = new HallGroupMembershipQuery({ pool });
  const result = await query.getMasterHallId("grp-missing");
  assert.equal(result, null);
});

test("getMasterHallId — tom groupId → INVALID_INPUT", async () => {
  const { pool } = makeStubPool();
  const query = new HallGroupMembershipQuery({ pool });
  await assert.rejects(
    () => query.getMasterHallId(""),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "INVALID_INPUT");
      return true;
    },
  );
});

test("getMasterHallId — DB-feil → DomainError(DB_ERROR)", async () => {
  const { pool } = makeStubPool({ errorMessage: "boom" });
  const query = new HallGroupMembershipQuery({ pool });
  await assert.rejects(
    () => query.getMasterHallId("grp-1"),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "DB_ERROR");
      return true;
    },
  );
});

// ── isMember ────────────────────────────────────────────────────────────

test("isMember — happy path returnerer true", async () => {
  const { pool, capturedQueries } = makeStubPool({
    handler: () => ({ rows: [{ exists: true }] }),
  });
  const query = new HallGroupMembershipQuery({ pool });
  const result = await query.isMember("grp-1", "hall-1");
  assert.equal(result, true);
  assert.deepEqual(capturedQueries[0]!.params, ["grp-1", "hall-1"]);
});

test("isMember — ikke medlem → false", async () => {
  const { pool } = makeStubPool({
    handler: () => ({ rows: [{ exists: false }] }),
  });
  const query = new HallGroupMembershipQuery({ pool });
  const result = await query.isMember("grp-1", "hall-not-member");
  assert.equal(result, false);
});

test("isMember — tom rows → false (defensiv)", async () => {
  const { pool } = makeStubPool({
    handler: () => ({ rows: [] }),
  });
  const query = new HallGroupMembershipQuery({ pool });
  const result = await query.isMember("grp-1", "hall-1");
  assert.equal(result, false);
});

test("isMember — tom groupId → INVALID_INPUT", async () => {
  const { pool } = makeStubPool();
  const query = new HallGroupMembershipQuery({ pool });
  await assert.rejects(
    () => query.isMember("", "hall-1"),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "INVALID_INPUT");
      return true;
    },
  );
});

test("isMember — tom hallId → INVALID_INPUT", async () => {
  const { pool } = makeStubPool();
  const query = new HallGroupMembershipQuery({ pool });
  await assert.rejects(
    () => query.isMember("grp-1", ""),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "INVALID_INPUT");
      return true;
    },
  );
});

test("isMember — DB-feil → DomainError(DB_ERROR)", async () => {
  const { pool } = makeStubPool({ errorMessage: "down" });
  const query = new HallGroupMembershipQuery({ pool });
  await assert.rejects(
    () => query.isMember("grp-1", "hall-1"),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "DB_ERROR");
      return true;
    },
  );
});

// ── findGroupForHall ────────────────────────────────────────────────────

test("findGroupForHall — finner aktiv GoH for medlem", async () => {
  const { pool, capturedQueries } = makeStubPool({
    handler: () => ({ rows: [{ group_id: "grp-1" }] }),
  });
  const query = new HallGroupMembershipQuery({ pool });
  const result = await query.findGroupForHall("hall-1");
  assert.equal(result, "grp-1");
  // ORDER BY added_at + LIMIT 1
  assert.match(capturedQueries[0]!.text, /ORDER BY m\.added_at ASC/i);
  assert.match(capturedQueries[0]!.text, /LIMIT 1/i);
});

test("findGroupForHall — hall ikke i noen GoH → null", async () => {
  const { pool } = makeStubPool({
    handler: () => ({ rows: [] }),
  });
  const query = new HallGroupMembershipQuery({ pool });
  const result = await query.findGroupForHall("hall-orphan");
  assert.equal(result, null);
});

test("findGroupForHall — flere GoH → første (eldste medlemskap)", async () => {
  // Stub returnerer det LIMIT 1 ville gjort: kun den eldste raden.
  const { pool } = makeStubPool({
    handler: () => ({ rows: [{ group_id: "grp-oldest" }] }),
  });
  const query = new HallGroupMembershipQuery({ pool });
  const result = await query.findGroupForHall("hall-multi");
  assert.equal(result, "grp-oldest");
});

test("findGroupForHall — tom hallId → INVALID_INPUT", async () => {
  const { pool } = makeStubPool();
  const query = new HallGroupMembershipQuery({ pool });
  await assert.rejects(
    () => query.findGroupForHall(""),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "INVALID_INPUT");
      return true;
    },
  );
});

test("findGroupForHall — DB-feil → DomainError(DB_ERROR)", async () => {
  const { pool } = makeStubPool({ errorMessage: "fatal" });
  const query = new HallGroupMembershipQuery({ pool });
  await assert.rejects(
    () => query.findGroupForHall("hall-1"),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "DB_ERROR");
      return true;
    },
  );
});
