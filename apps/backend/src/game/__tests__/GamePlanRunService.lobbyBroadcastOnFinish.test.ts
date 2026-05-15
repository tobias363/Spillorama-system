/**
 * Pilot Q3 2026 (2026-05-15) — `GamePlanRunService.finish()` MÅ trigge
 * `lobbyBroadcaster.broadcastForHall(hallId)`. Samme for
 * `advanceToNext()` når siste posisjon passeres (past-end → finished).
 *
 * Bakgrunn (Tobias-rapport 2026-05-15):
 *   "Etter at runden var fullført viser fortsatt 'Neste spill: Bingo'
 *    i ca 2 min FØR det endret seg til '1000-spill'. Spiller skal
 *    ALDRI se gammelt spill."
 *
 * Root cause-analyse fant at backend kun broadcaster lobby-state ved
 * master-actions (start/pause/resume/stop via MasterActionService). Når
 * plan-run.status flippes til `finished` (manuelt via master eller
 * automatisk når master advance-r past siste posisjon), ble det IKKE
 * pushet noen broadcast. Klient måtte vente på 10s-polling-tick før
 * spiller-shell oppdaterte seg.
 *
 * Fix: nytt valgfritt option `lobbyBroadcaster` på
 * `GamePlanRunServiceOptions`. Fyres POST-update i `changeStatus()` når
 * target='finished', og POST-update i `advanceToNext()` når
 * `newPosition > items.length`.
 *
 * Disse testene verifiserer:
 *   1. `finish()` kaller broadcaster.broadcastForHall(hallId)
 *   2. `pause()` IKKE kaller broadcaster (annen overgang)
 *   3. Broadcaster-feil ruller ikke tilbake state-mutering (fail-soft)
 *   4. Default null broadcaster = ingen kall (bakoverkompat)
 *
 * Referanser:
 *   - `.claude/skills/spill1-master-flow/SKILL.md`
 *   - `PITFALLS_LOG.md` §7.22
 */

import assert from "node:assert/strict";
import test from "node:test";

import { GamePlanRunService } from "../GamePlanRunService.js";
import { GamePlanService } from "../GamePlanService.js";
import { GameCatalogService } from "../GameCatalogService.js";
import type { AuditLogService } from "../../compliance/AuditLogService.js";
import type { GamePlanWithItems } from "../gamePlan.types.js";

const HALL_ID = "11111111-1111-1111-1111-111111111111";
const PLAN_ID = "22222222-2222-2222-2222-222222222222";
const MASTER_USER_ID = "u-master-1";

function todayStr(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

interface BroadcasterSpyResult {
  calls: string[];
  shouldThrow: boolean;
}

function makeBroadcaster(opts: { shouldThrow?: boolean } = {}): {
  broadcaster: { broadcastForHall(hallId: string): Promise<void> };
  result: BroadcasterSpyResult;
} {
  const result: BroadcasterSpyResult = {
    calls: [],
    shouldThrow: opts.shouldThrow ?? false,
  };
  return {
    broadcaster: {
      async broadcastForHall(hallId: string): Promise<void> {
        result.calls.push(hallId);
        if (result.shouldThrow) {
          throw new Error("simulated broadcaster failure");
        }
      },
    },
    result,
  };
}

interface ServiceMockOptions {
  initialStatus: "idle" | "running" | "paused" | "finished";
  broadcaster?:
    | { broadcastForHall(hallId: string): Promise<void> }
    | null;
}

function makeServiceForStatusChange(opts: ServiceMockOptions): {
  service: GamePlanRunService;
} {
  const dateStr = todayStr();
  const initialRow = {
    id: "run-1",
    plan_id: PLAN_ID,
    hall_id: HALL_ID,
    business_date: dateStr,
    current_position: 1,
    status: opts.initialStatus as string,
    jackpot_overrides_json: {},
    started_at: opts.initialStatus === "idle" ? null : new Date(),
    finished_at: null,
    master_user_id: opts.initialStatus === "idle" ? null : MASTER_USER_ID,
    created_at: new Date("2026-05-15T10:00:00Z"),
    updated_at: new Date("2026-05-15T10:00:00Z"),
  };
  let currentRow: Record<string, unknown> = { ...initialRow };

  const stubPool = {
    async query(textOrConfig: unknown, params?: unknown[]): Promise<unknown> {
      const sql =
        typeof textOrConfig === "string"
          ? textOrConfig
          : (textOrConfig as { text: string }).text;
      if (/UPDATE\s+"public"\."app_game_plan_run"/i.test(sql)) {
        // Parse `status = $N` parametrisert UPDATE.
        const statusMatch = sql.match(/SET\s+status\s*=\s*\$(\d+)/i);
        if (statusMatch && statusMatch[1] !== undefined) {
          const paramIndex = Number(statusMatch[1]) - 1;
          if (params && params[paramIndex] !== undefined) {
            currentRow.status = params[paramIndex] as string;
            if (currentRow.status === "finished") {
              currentRow.finished_at = new Date();
            }
          }
        }
        return { rowCount: 1, rows: [] };
      }
      if (/^\s*SELECT/i.test(sql)) {
        return { rows: [currentRow] };
      }
      return { rowCount: 1, rows: [] };
    },
  };

  const planSvc = Object.create(
    GamePlanService.prototype,
  ) as GamePlanService;
  (planSvc as unknown as { pool: unknown }).pool = stubPool;
  (planSvc as unknown as { schema: string }).schema = "public";

  const catalogSvc = Object.create(
    GameCatalogService.prototype,
  ) as GameCatalogService;
  (catalogSvc as unknown as { pool: unknown }).pool = stubPool;
  (catalogSvc as unknown as { schema: string }).schema = "public";

  const auditSvc = {
    async record(): Promise<void> {
      // no-op stub
    },
  } as unknown as AuditLogService;

  const svc = Object.create(
    GamePlanRunService.prototype,
  ) as GamePlanRunService;
  (svc as unknown as { pool: unknown }).pool = stubPool;
  (svc as unknown as { schema: string }).schema = "public";
  (svc as unknown as { planService: GamePlanService }).planService = planSvc;
  (svc as unknown as {
    catalogService: GameCatalogService;
  }).catalogService = catalogSvc;
  (svc as unknown as {
    auditLogService: AuditLogService | null;
  }).auditLogService = auditSvc;
  (svc as unknown as {
    inlineCleanupHook: null;
  }).inlineCleanupHook = null;
  (svc as unknown as {
    lobbyBroadcaster:
      | { broadcastForHall(hallId: string): Promise<void> }
      | null;
  }).lobbyBroadcaster = opts.broadcaster ?? null;

  return { service: svc };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((r) => setImmediate(r));
}

// ── Tester ──────────────────────────────────────────────────────────────

test("finish(): kaller broadcaster.broadcastForHall(hallId) etter state-flipp", async () => {
  const { broadcaster, result } = makeBroadcaster();
  const { service } = makeServiceForStatusChange({
    initialStatus: "running",
    broadcaster,
  });

  await service.finish(HALL_ID, todayStr(), MASTER_USER_ID);
  await flushPromises();

  assert.equal(result.calls.length, 1, "broadcaster skal ha vært kalt én gang");
  assert.equal(result.calls[0], HALL_ID);
});

test("pause(): IKKE broadcast (ikke-finished overgang)", async () => {
  const { broadcaster, result } = makeBroadcaster();
  const { service } = makeServiceForStatusChange({
    initialStatus: "running",
    broadcaster,
  });

  await service.pause(HALL_ID, todayStr(), MASTER_USER_ID);
  await flushPromises();

  assert.equal(
    result.calls.length,
    0,
    "broadcaster skal IKKE være kalt for pause-overgang (kun finished)",
  );
});

test("resume(): IKKE broadcast", async () => {
  const { broadcaster, result } = makeBroadcaster();
  const { service } = makeServiceForStatusChange({
    initialStatus: "paused",
    broadcaster,
  });

  await service.resume(HALL_ID, todayStr(), MASTER_USER_ID);
  await flushPromises();

  assert.equal(result.calls.length, 0);
});

test("finish(): broadcaster-feil ruller IKKE tilbake state-flipp (fail-soft)", async () => {
  const { broadcaster, result } = makeBroadcaster({ shouldThrow: true });
  const { service } = makeServiceForStatusChange({
    initialStatus: "running",
    broadcaster,
  });

  const finished = await service.finish(
    HALL_ID,
    todayStr(),
    MASTER_USER_ID,
  );
  await flushPromises();

  // State-flipp lyktes selv om broadcaster kastet.
  assert.equal(finished.status, "finished");
  assert.equal(result.calls.length, 1, "broadcaster ble forsøkt kalt");
});

test("finish(): null broadcaster = ingen kall (bakoverkompat)", async () => {
  const { service } = makeServiceForStatusChange({
    initialStatus: "running",
    broadcaster: null,
  });

  await assert.doesNotReject(
    service.finish(HALL_ID, todayStr(), MASTER_USER_ID),
  );
});

test("setLobbyBroadcaster(): late-binding fungerer", async () => {
  const { service } = makeServiceForStatusChange({
    initialStatus: "running",
    broadcaster: null,
  });

  const { broadcaster, result } = makeBroadcaster();
  service.setLobbyBroadcaster(broadcaster);

  await service.finish(HALL_ID, todayStr(), MASTER_USER_ID);
  await flushPromises();

  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0], HALL_ID);
});

test("setLobbyBroadcaster(null): clear binding stopper kall", async () => {
  const { broadcaster, result } = makeBroadcaster();
  const { service } = makeServiceForStatusChange({
    initialStatus: "running",
    broadcaster,
  });

  service.setLobbyBroadcaster(null);
  await service.finish(HALL_ID, todayStr(), MASTER_USER_ID);
  await flushPromises();

  assert.equal(result.calls.length, 0);
});
