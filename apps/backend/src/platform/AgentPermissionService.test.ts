/**
 * Role Management — unit-tester for AgentPermissionService.
 *
 * Dekker validering (fail fast før Postgres-kall), default-regler (player
 * by default), og CRUD-atferd mot en in-memory rad-butikk.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  AgentPermissionService,
  AGENT_PERMISSION_MODULES,
  type AgentPermissionModule,
} from "./AgentPermissionService.js";
import { DomainError } from "../game/BingoEngine.js";

interface FakeRow {
  id: string;
  agent_user_id: string;
  module: string;
  can_create: boolean;
  can_edit: boolean;
  can_view: boolean;
  can_delete: boolean;
  can_block_unblock: boolean;
  updated_at: string;
  updated_by: string | null;
}

/**
 * In-memory twin som mimics pg-Pool. Dekker kun de spørringene service-
 * laget faktisk utfører: SELECT ... WHERE agent_user_id = $1 (optional +
 * module = $2), og INSERT ... ON CONFLICT DO UPDATE.
 */
function makeBackedService(): {
  svc: AgentPermissionService;
  rows: FakeRow[];
} {
  const rows: FakeRow[] = [];
  const stubPool = {
    query: async (sql: string, params?: unknown[]): Promise<{ rows: FakeRow[] }> => {
      const p = params ?? [];
      if (sql.includes("SELECT") && sql.includes("FROM")) {
        if (sql.includes("module = $2")) {
          const [agentId, module] = p as [string, string];
          return {
            rows: rows.filter(
              (r) => r.agent_user_id === agentId && r.module === module
            ),
          };
        }
        const [agentId] = p as [string];
        return { rows: rows.filter((r) => r.agent_user_id === agentId) };
      }
      if (sql.includes("INSERT INTO")) {
        const [id, agentId, module, cCreate, cEdit, cView, cDel, cBU, updatedBy] =
          p as [string, string, string, boolean, boolean, boolean, boolean, boolean, string];
        const existing = rows.find(
          (r) => r.agent_user_id === agentId && r.module === module
        );
        if (existing) {
          existing.can_create = cCreate;
          existing.can_edit = cEdit;
          existing.can_view = cView;
          existing.can_delete = cDel;
          existing.can_block_unblock = cBU;
          existing.updated_at = new Date().toISOString();
          existing.updated_by = updatedBy;
        } else {
          rows.push({
            id,
            agent_user_id: agentId,
            module,
            can_create: cCreate,
            can_edit: cEdit,
            can_view: cView,
            can_delete: cDel,
            can_block_unblock: cBU,
            updated_at: new Date().toISOString(),
            updated_by: updatedBy,
          });
        }
        return { rows: [] };
      }
      return { rows: [] };
    },
    connect: async () => ({
      query: async (sql: string, params?: unknown[]) => {
        if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
          return { rows: [] };
        }
        return stubPool.query(sql, params);
      },
      release: () => {},
    }),
  };
  const svc = Object.create(
    AgentPermissionService.prototype
  ) as AgentPermissionService;
  (svc as unknown as { pool: unknown }).pool = stubPool;
  (svc as unknown as { schema: string }).schema = "public";
  (svc as unknown as { initPromise: Promise<void> }).initPromise =
    Promise.resolve();
  return { svc, rows };
}

async function expectDomainError(
  label: string,
  fn: () => Promise<unknown>,
  expectedCode?: string
): Promise<void> {
  try {
    await fn();
    assert.fail(`${label}: forventet DomainError men fikk success`);
  } catch (err) {
    if (!(err instanceof DomainError)) {
      throw err;
    }
    if (expectedCode) {
      assert.equal(err.code, expectedCode, `${label}: feil DomainError-kode`);
    }
  }
}

// ── Validering ──────────────────────────────────────────────────────────────

test("getPermissions avviser tom agentId", async () => {
  const { svc } = makeBackedService();
  await expectDomainError(
    "empty agentId",
    () => svc.getPermissions(""),
    "INVALID_INPUT"
  );
});

test("setPermissions avviser tom agentId", async () => {
  const { svc } = makeBackedService();
  await expectDomainError(
    "empty agentId",
    () => svc.setPermissions("", [], "admin-1"),
    "INVALID_INPUT"
  );
});

test("setPermissions avviser tom adminUserId", async () => {
  const { svc } = makeBackedService();
  await expectDomainError(
    "empty adminUserId",
    () => svc.setPermissions("agent-1", [], ""),
    "INVALID_INPUT"
  );
});

test("setPermissions avviser ikke-array input", async () => {
  const { svc } = makeBackedService();
  await expectDomainError(
    "non-array permissions",
    () => svc.setPermissions("agent-1", "not-array" as never, "admin-1"),
    "INVALID_INPUT"
  );
});

test("setPermissions avviser ukjent modul", async () => {
  const { svc } = makeBackedService();
  await expectDomainError(
    "unknown module",
    () =>
      svc.setPermissions(
        "agent-1",
        [{ module: "unknown" as AgentPermissionModule, canCreate: true }],
        "admin-1"
      ),
    "INVALID_INPUT"
  );
});

test("setPermissions avviser dupliserte moduler", async () => {
  const { svc } = makeBackedService();
  await expectDomainError(
    "duplicate module",
    () =>
      svc.setPermissions(
        "agent-1",
        [
          { module: "schedule", canCreate: true },
          { module: "schedule", canView: true },
        ],
        "admin-1"
      ),
    "INVALID_INPUT"
  );
});

test("setPermissions avviser ikke-boolean felt", async () => {
  const { svc } = makeBackedService();
  await expectDomainError(
    "non-boolean canCreate",
    () =>
      svc.setPermissions(
        "agent-1",
        [{ module: "schedule", canCreate: "yes" as unknown as boolean }],
        "admin-1"
      ),
    "INVALID_INPUT"
  );
});

// ── Default-regler ──────────────────────────────────────────────────────────

test("getPermissions returnerer alle 15 moduler for ny agent", async () => {
  const { svc } = makeBackedService();
  const perms = await svc.getPermissions("agent-new");
  assert.equal(perms.length, AGENT_PERMISSION_MODULES.length);
  const modules = new Set(perms.map((p) => p.module));
  for (const m of AGENT_PERMISSION_MODULES) {
    assert.ok(modules.has(m), `mangler modul ${m}`);
  }
});

test("getPermissions default: player er true for alle actions (by default-regel)", async () => {
  const { svc } = makeBackedService();
  const perms = await svc.getPermissions("agent-new");
  const player = perms.find((p) => p.module === "player");
  assert.ok(player, "player-modul må finnes");
  assert.equal(player!.canCreate, true, "player.canCreate default = true");
  assert.equal(player!.canEdit, true, "player.canEdit default = true");
  assert.equal(player!.canView, true, "player.canView default = true");
  assert.equal(player!.canDelete, true, "player.canDelete default = true");
  assert.equal(
    player!.canBlockUnblock,
    true,
    "player.canBlockUnblock default = true"
  );
});

test("getPermissions default: andre moduler er false (fail closed)", async () => {
  const { svc } = makeBackedService();
  const perms = await svc.getPermissions("agent-new");
  for (const p of perms) {
    if (p.module === "player") continue;
    assert.equal(p.canCreate, false, `${p.module}.canCreate default = false`);
    assert.equal(p.canEdit, false, `${p.module}.canEdit default = false`);
    assert.equal(p.canView, false, `${p.module}.canView default = false`);
    assert.equal(p.canDelete, false, `${p.module}.canDelete default = false`);
    assert.equal(
      p.canBlockUnblock,
      false,
      `${p.module}.canBlockUnblock default = false`
    );
  }
});

// ── CRUD ─────────────────────────────────────────────────────────────────────

test("setPermissions persisterer én modul og henter den tilbake", async () => {
  const { svc } = makeBackedService();
  await svc.setPermissions(
    "agent-1",
    [{ module: "schedule", canCreate: true, canView: true }],
    "admin-1"
  );
  const perms = await svc.getPermissions("agent-1");
  const schedule = perms.find((p) => p.module === "schedule");
  assert.ok(schedule);
  assert.equal(schedule!.canCreate, true);
  assert.equal(schedule!.canEdit, false);
  assert.equal(schedule!.canView, true);
  assert.equal(schedule!.canDelete, false);
});

test("setPermissions overskriver eksisterende modul (replace-semantikk)", async () => {
  const { svc } = makeBackedService();
  await svc.setPermissions(
    "agent-1",
    [{ module: "report", canCreate: true, canView: true, canEdit: true }],
    "admin-1"
  );
  await svc.setPermissions(
    "agent-1",
    [{ module: "report", canView: true }], // andre false → overskrives
    "admin-1"
  );
  const perms = await svc.getPermissions("agent-1");
  const report = perms.find((p) => p.module === "report");
  assert.ok(report);
  assert.equal(report!.canCreate, false, "canCreate skal være overskrevet");
  assert.equal(report!.canEdit, false, "canEdit skal være overskrevet");
  assert.equal(report!.canView, true, "canView skal være true");
  assert.equal(report!.canDelete, false, "canDelete skal være false");
});

test("setPermissions: canBlockUnblock kun effektiv for player-modul", async () => {
  const { svc } = makeBackedService();
  await svc.setPermissions(
    "agent-1",
    [
      { module: "schedule", canBlockUnblock: true },
      { module: "player", canBlockUnblock: true },
    ],
    "admin-1"
  );
  const perms = await svc.getPermissions("agent-1");
  const schedule = perms.find((p) => p.module === "schedule");
  const player = perms.find((p) => p.module === "player");
  assert.equal(
    schedule!.canBlockUnblock,
    false,
    "canBlockUnblock skal være false for ikke-player"
  );
  assert.equal(
    player!.canBlockUnblock,
    true,
    "canBlockUnblock skal være true for player (eksplisitt satt)"
  );
});

test("setPermissions lagrer updated_by", async () => {
  const { svc, rows } = makeBackedService();
  await svc.setPermissions(
    "agent-1",
    [{ module: "wallet", canView: true }],
    "admin-xyz"
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.updated_by, "admin-xyz");
});

// ── hasPermission ────────────────────────────────────────────────────────────

test("hasPermission returnerer false for ikke-eksisterende agent/modul (fail closed)", async () => {
  const { svc } = makeBackedService();
  const r = await svc.hasPermission("ghost", "schedule", "view");
  assert.equal(r, false);
});

test("hasPermission returnerer true for player by default", async () => {
  const { svc } = makeBackedService();
  for (const action of ["create", "edit", "view", "delete", "block_unblock"] as const) {
    const r = await svc.hasPermission("agent-new", "player", action);
    assert.equal(r, true, `player.${action} skal være true by default`);
  }
});

test("hasPermission returnerer riktig bool når rad finnes", async () => {
  const { svc } = makeBackedService();
  await svc.setPermissions(
    "agent-1",
    [{ module: "transaction", canView: true, canCreate: false }],
    "admin-1"
  );
  assert.equal(await svc.hasPermission("agent-1", "transaction", "view"), true);
  assert.equal(await svc.hasPermission("agent-1", "transaction", "create"), false);
  assert.equal(await svc.hasPermission("agent-1", "transaction", "edit"), false);
  assert.equal(await svc.hasPermission("agent-1", "transaction", "delete"), false);
});

// ── Alle 15 moduler kan lagres ──────────────────────────────────────────────

test("setPermissions aksepterer alle 15 definerte moduler", async () => {
  const { svc } = makeBackedService();
  const fullMatrix = AGENT_PERMISSION_MODULES.map((module) => ({
    module,
    canCreate: true,
    canEdit: true,
    canView: true,
    canDelete: true,
    canBlockUnblock: module === "player",
  }));
  await svc.setPermissions("agent-full", fullMatrix, "admin-1");
  const perms = await svc.getPermissions("agent-full");
  for (const m of AGENT_PERMISSION_MODULES) {
    const p = perms.find((x) => x.module === m);
    assert.ok(p, `mangler modul ${m}`);
    assert.equal(p!.canCreate, true, `${m}.canCreate`);
    assert.equal(p!.canEdit, true, `${m}.canEdit`);
    assert.equal(p!.canView, true, `${m}.canView`);
    assert.equal(p!.canDelete, true, `${m}.canDelete`);
    assert.equal(
      p!.canBlockUnblock,
      m === "player",
      `${m}.canBlockUnblock skal kun være true for player`
    );
  }
});
