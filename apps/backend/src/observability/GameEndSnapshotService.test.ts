/**
 * Tester for GameEndSnapshotService (Observability fix-PR 2026-05-13).
 *
 * Vi sjekker:
 *   - `dump` skriver fil og kaster aldri tilbake
 *   - `collectSnapshot` returnerer korrekt shape (4 queries + caller-context)
 *   - Fail-soft ved DB-feil — vi returnerer null/[] men kaster ikke
 *   - Fil-skriving går via opts.pathPrefix slik at vi ikke trasker /tmp
 */

import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { Pool } from "pg";

import { GameEndSnapshotService } from "./GameEndSnapshotService.js";

function makePoolMock(responses: Array<{ rows: Array<Record<string, unknown>> }>) {
  let idx = 0;
  const calls: Array<{ text: string; params: unknown[] }> = [];
  const pool = {
    query: async (text: string, params: unknown[] = []) => {
      calls.push({ text, params });
      const resp = responses[idx];
      idx += 1;
      if (!resp) {
        return { rows: [] };
      }
      return resp;
    },
  } as unknown as Pool;
  return { pool, calls };
}

function makeFailingPool() {
  return {
    query: async () => {
      throw new Error("DB unavailable");
    },
  } as unknown as Pool;
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "game-end-snapshot-test-"));

test("collectSnapshot returnerer struktur fra alle fire queries", async () => {
  const { pool } = makePoolMock([
    { rows: [{ id: "g1", status: "completed" }] }, // scheduledGame
    { rows: [{ id: "pr1", status: "running" }] }, // planRun
    { rows: [{ hall_id: "h1", is_ready: true }] }, // hallReadyRows
    {
      rows: [
        { id: "t1", buyer_user_id: "u1", total_amount_cents: 500 },
      ],
    }, // activeTickets
  ]);
  const svc = new GameEndSnapshotService(pool, {
    pathPrefix: path.join(tmpDir, "snap-"),
  });
  const snap = await svc.collectSnapshot("g1", "test", { caller: "unit-test" });
  assert.strictEqual(snap.gameId, "g1");
  assert.strictEqual(snap.reason, "test");
  assert.deepStrictEqual(snap.context, { caller: "unit-test" });
  assert.strictEqual(snap.scheduledGame?.id, "g1");
  assert.strictEqual(snap.planRun?.id, "pr1");
  assert.strictEqual(snap.hallReadyRows.length, 1);
  assert.strictEqual(snap.activeTickets.length, 1);
  assert.strictEqual(snap.engineSnapshot, null);
});

test("dump skriver JSON-fil med riktig path-prefix", async () => {
  const { pool } = makePoolMock([
    { rows: [{ id: "g2" }] },
    { rows: [] },
    { rows: [] },
    { rows: [] },
  ]);
  const prefix = path.join(tmpDir, "dump-");
  const svc = new GameEndSnapshotService(pool, { pathPrefix: prefix });
  await svc.dump("g2", "stop", { actorId: "u-admin" });
  const expectedPath = `${prefix}g2.json`;
  assert.ok(fs.existsSync(expectedPath));
  const content = JSON.parse(fs.readFileSync(expectedPath, "utf8"));
  assert.strictEqual(content.gameId, "g2");
  assert.strictEqual(content.reason, "stop");
  assert.deepStrictEqual(content.context, { actorId: "u-admin" });
});

test("dump er fail-soft når DB feiler (kaster ikke)", async () => {
  const pool = makeFailingPool();
  const warnings: unknown[] = [];
  const svc = new GameEndSnapshotService(pool, {
    pathPrefix: path.join(tmpDir, "fail-"),
    logger: { warn: (msg, err) => warnings.push({ msg, err }) },
  });
  // Skal IKKE kaste
  await svc.dump("g3", "test");
  // Vi forventer at warn ble kalt (DB-feil + evt fs-feil siden vi fortsatt
  // prøver å skrive med tomme felter)
  assert.ok(warnings.length > 0);
});

test("collectSnapshot returnerer null/[] ved query-feil per query", async () => {
  // En enkelt DB-feil per query — service degraderer per resultat
  const pool = makeFailingPool();
  const svc = new GameEndSnapshotService(pool, {
    pathPrefix: path.join(tmpDir, "graceful-"),
    logger: { warn: () => undefined },
  });
  const snap = await svc.collectSnapshot("g4", "graceful");
  assert.strictEqual(snap.scheduledGame, null);
  assert.strictEqual(snap.planRun, null);
  assert.deepStrictEqual(snap.hallReadyRows, []);
  assert.deepStrictEqual(snap.activeTickets, []);
});

test("dump tar med engineSnapshot fra caller", async () => {
  const { pool } = makePoolMock([
    { rows: [] },
    { rows: [] },
    { rows: [] },
    { rows: [] },
  ]);
  const prefix = path.join(tmpDir, "engine-");
  const svc = new GameEndSnapshotService(pool, { pathPrefix: prefix });
  await svc.dump(
    "g5",
    "with-engine",
    {},
    { roomCode: "BINGO-X", drawnNumbers: [1, 2, 3] },
  );
  const expectedPath = `${prefix}g5.json`;
  const content = JSON.parse(fs.readFileSync(expectedPath, "utf8"));
  assert.deepStrictEqual(content.engineSnapshot, {
    roomCode: "BINGO-X",
    drawnNumbers: [1, 2, 3],
  });
});
