/**
 * Task 1.4 (2026-04-24): integrasjonstester for agent-Game1-router.
 *
 * Verifiserer:
 *   - current-game: returnerer aktivt scheduled_game for hallen med
 *     riktig `isMasterAgent`-flagg.
 *   - start: master-agent aksepteres, ikke-master-agent 403.
 *   - resume: samme regler som start.
 *   - hall-status: returnerer samme datakilde som master-konsollet.
 *   - SUPPORT avvises på alle endpoints (permission GAME1_MASTER_WRITE).
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAgentGame1Router } from "../agentGame1.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../../platform/PlatformService.js";
import type { Game1MasterControlService } from "../../game/Game1MasterControlService.js";
import type {
  Game1HallReadyService,
  HallReadyStatusRow,
} from "../../game/Game1HallReadyService.js";
import { DomainError } from "../../errors/DomainError.js";

const adminUser: PublicAppUser = {
  id: "admin-1",
  email: "a@test.no",
  displayName: "Admin",
  walletId: "w-a",
  role: "ADMIN",
  hallId: null,
  kycStatus: "VERIFIED",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  balance: 0,
};
const masterAgent: PublicAppUser = {
  ...adminUser,
  id: "ag-m",
  role: "AGENT",
  hallId: "hall-master",
};
const slaveAgent: PublicAppUser = {
  ...adminUser,
  id: "ag-s",
  role: "AGENT",
  hallId: "hall-slave",
};
const unboundAgent: PublicAppUser = {
  ...adminUser,
  id: "ag-u",
  role: "AGENT",
  hallId: null,
};
const supportUser: PublicAppUser = {
  ...adminUser,
  id: "sup",
  role: "SUPPORT",
};
const playerUser: PublicAppUser = {
  ...adminUser,
  id: "pl",
  role: "PLAYER",
};

interface MockActiveRow {
  id: string;
  status: string;
  master_hall_id: string;
  group_hall_id: string;
  participating_halls_json: unknown;
  sub_game_name: string;
  custom_game_name: string | null;
  scheduled_start_time: Date | string;
  scheduled_end_time: Date | string;
  actual_start_time: Date | string | null;
  actual_end_time: Date | string | null;
}

function defaultActiveRow(): MockActiveRow {
  return {
    id: "g1",
    status: "purchase_open",
    master_hall_id: "hall-master",
    group_hall_id: "grp-1",
    participating_halls_json: ["hall-master", "hall-slave"],
    sub_game_name: "Jackpot",
    custom_game_name: null,
    scheduled_start_time: "2026-04-24T10:00:00.000Z",
    scheduled_end_time: "2026-04-24T11:00:00.000Z",
    actual_start_time: null,
    actual_end_time: null,
  };
}

function defaultReadyRows(): HallReadyStatusRow[] {
  return [
    {
      gameId: "g1",
      hallId: "hall-master",
      isReady: true,
      readyAt: "2026-04-24T09:55:00Z",
      readyByUserId: "u-m",
      digitalTicketsSold: 10,
      physicalTicketsSold: 5,
      excludedFromGame: false,
      excludedReason: null,
      // TASK HS: scan-felter — null for digital-only / pre-scan testing.
      startTicketId: null,
      startScannedAt: null,
      finalScanTicketId: null,
      finalScannedAt: null,
      createdAt: "",
      updatedAt: "",
    },
    {
      gameId: "g1",
      hallId: "hall-slave",
      isReady: false,
      readyAt: null,
      readyByUserId: null,
      digitalTicketsSold: 0,
      physicalTicketsSold: 0,
      excludedFromGame: false,
      excludedReason: null,
      startTicketId: null,
      startScannedAt: null,
      finalScanTicketId: null,
      finalScannedAt: null,
      createdAt: "",
      updatedAt: "",
    },
  ];
}

interface StartOpts {
  users?: Record<string, PublicAppUser>;
  activeRow?: MockActiveRow | null;
  /**
   * 2026-05-07: optional scheduled-row simulering. Brukes til å teste at
   * `/start` returnerer GAME_NOT_STARTABLE_YET når runden er i status
   * `'scheduled'` men purchase-vinduet ennå ikke er åpnet. Mock-pool-en
   * inspiserer SQL og returnerer denne raden kun for SQL-query-er som
   * filtrerer på `status = 'scheduled'`.
   */
  scheduledRow?: MockActiveRow | null;
  readyRows?: HallReadyStatusRow[];
  allReady?: boolean;
  startImpl?: Game1MasterControlService["startGame"];
  resumeImpl?: Game1MasterControlService["resumeGame"];
  halls?: Record<string, { id: string; name: string }>;
  poolError?: Error;
  /**
   * 2026-05-08 (Tobias-feedback): mock for `hallGroupService.list({hallId})`
   * (brukt av legacy `getGroupHallsForHall`). Default behavior er å returnere
   * en gruppe hvis hallId er kjent, ellers tom liste.
   */
  groupHallsForHall?: Record<
    string,
    { id: string; members: { hallId: string; hallName: string }[] }
  >;
  /**
   * 2026-05-08 (Tobias-feedback): mock for `hallGroupService.get(groupId)`
   * (brukt av nye `getCurrentGoHMembersByGroupId`). Returnerer current GoH-
   * membership for en gitt group_hall_id. Hvis `null`, simulerer at
   * lookup feiler (gruppen finnes ikke / DB-feil) — caller skal falle
   * tilbake til legacy-oppførselen.
   */
  goHById?: Record<
    string,
    { members: { hallId: string; hallName: string }[] } | null
  >;
}

interface Ctx {
  baseUrl: string;
  serviceCalls: {
    startGame: Array<Parameters<Game1MasterControlService["startGame"]>[0]>;
    resumeGame: Array<Parameters<Game1MasterControlService["resumeGame"]>[0]>;
    getReadyStatusForGame: string[];
    allParticipatingHallsReady: string[];
  };
  poolQueries: Array<{ sql: string; params: unknown[] }>;
  close: () => Promise<void>;
}

async function startServer(opts: StartOpts = {}): Promise<Ctx> {
  const users: Record<string, PublicAppUser> = opts.users ?? {
    "t-admin": adminUser,
  };
  const active = opts.activeRow === undefined ? defaultActiveRow() : opts.activeRow;
  const readyRows = opts.readyRows ?? defaultReadyRows();
  const allReady = opts.allReady ?? false;

  const serviceCalls: Ctx["serviceCalls"] = {
    startGame: [],
    resumeGame: [],
    getReadyStatusForGame: [],
    allParticipatingHallsReady: [],
  };
  const poolQueries: Ctx["poolQueries"] = [];

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
    async getHall(hallId: string) {
      const h = opts.halls?.[hallId];
      if (h)
        return { ...h, isActive: true } as unknown as Awaited<
          ReturnType<PlatformService["getHall"]>
        >;
      throw new DomainError("HALL_NOT_FOUND", "nope");
    },
  } as unknown as PlatformService;

  const masterControlService = {
    async startGame(
      input: Parameters<Game1MasterControlService["startGame"]>[0]
    ) {
      serviceCalls.startGame.push(input);
      if (opts.startImpl) return opts.startImpl(input);
      return {
        gameId: "g1",
        status: "running",
        actualStartTime: "2026-04-24T10:00:00Z",
        actualEndTime: null,
        auditId: "audit-start",
      };
    },
    async resumeGame(
      input: Parameters<Game1MasterControlService["resumeGame"]>[0]
    ) {
      serviceCalls.resumeGame.push(input);
      if (opts.resumeImpl) return opts.resumeImpl(input);
      return {
        gameId: "g1",
        status: "running",
        actualStartTime: "2026-04-24T10:00:00Z",
        actualEndTime: null,
        auditId: "audit-resume",
      };
    },
  } as unknown as Game1MasterControlService;

  const hallReadyService = {
    async getReadyStatusForGame(gameId: string) {
      serviceCalls.getReadyStatusForGame.push(gameId);
      return readyRows;
    },
    async allParticipatingHallsReady(gameId: string) {
      serviceCalls.allParticipatingHallsReady.push(gameId);
      return allReady;
    },
  } as unknown as Game1HallReadyService;

  const scheduledRow =
    opts.scheduledRow === undefined ? null : opts.scheduledRow;

  const pool = {
    async query(sql: string, params: unknown[]) {
      poolQueries.push({ sql, params });
      if (opts.poolError) throw opts.poolError;
      // Bølge 5 (2026-05-08): rute-laget bruker nå
      // `HallGroupMembershipQuery.getActiveMembers` istedenfor å gå via
      // `hallGroupService.get`. Stuben dispatch-er på SQL-pattern og
      // mapper data fra `opts.goHById` slik at eksisterende test-setup
      // (med `goHById`-key) fortsatt fungerer uten å duplisere mock.
      //
      // Q1: `SELECT master_hall_id FROM "public"."app_hall_groups" WHERE id = $1 ...`
      // (uten LEFT JOIN — det er getActiveMembers' group-existence-check)
      if (
        /SELECT\s+master_hall_id/i.test(sql) &&
        /app_hall_groups/i.test(sql) &&
        /WHERE\s+id\s*=/i.test(sql) &&
        !/LEFT JOIN/i.test(sql)
      ) {
        const groupId = params?.[0] as string | undefined;
        if (groupId === undefined) {
          return { rows: [], rowCount: 0 };
        }
        const hit = opts.goHById?.[groupId];
        if (hit === undefined) {
          // Default = gruppen finnes ikke (matcher legacy-baseline).
          return { rows: [], rowCount: 0 };
        }
        if (hit === null) {
          // Eksplisitt simulert DB-feil — kast samme feil som
          // mockHallGroupService.get gjorde tidligere.
          throw new Error("simulated DB error");
        }
        return { rows: [{ master_hall_id: null }], rowCount: 1 };
      }
      // Q2: getActiveMembers' members-query: `SELECT m.hall_id, h.name ...`
      if (
        /SELECT\s+m\.hall_id,\s*h\.name/i.test(sql) &&
        /app_hall_group_members/i.test(sql)
      ) {
        const groupId = params?.[0] as string | undefined;
        if (groupId === undefined) {
          return { rows: [], rowCount: 0 };
        }
        const hit = opts.goHById?.[groupId];
        if (hit === undefined || hit === null) {
          return { rows: [], rowCount: 0 };
        }
        const rows = hit.members.map((m) => ({
          hall_id: m.hallId,
          hall_name: m.hallName,
          is_active: true,
        }));
        return { rows, rowCount: rows.length };
      }
      if (!sql.includes("app_game1_scheduled_games")) {
        return { rows: [], rowCount: 0 };
      }
      const matchesHall = (row: MockActiveRow): boolean =>
        Array.isArray(params) &&
        (row.master_hall_id === params[0] ||
          (Array.isArray(row.participating_halls_json) &&
            (row.participating_halls_json as string[]).includes(
              String(params[0])
            )));
      // 2026-05-07: skill mellom `findScheduledGameForHall` (status='scheduled')
      // og de to andre helperne. Tester kan sette `scheduledRow` for å
      // simulere "runden er planlagt men purchase ikke åpnet enda" uten å
      // påvirke `activeRow`-logikken.
      //
      // Bølge 6 (2026-05-08): etter `Game1ScheduledGameFinder`-konsolideringen
      // bruker alle finder-queries `status IN ($2, $3, ...)` med parameterized
      // statuser, så vi må disambiguere på params (ikke SQL-tekst). Eneste
      // status-bucket som kun inneholder `'scheduled'` er SCHEDULED_ONLY.
      const statusParams = Array.isArray(params)
        ? (params.slice(1) as string[])
        : [];
      const isScheduledOnlyQuery =
        sql.includes("status = 'scheduled'") ||
        (statusParams.length === 1 && statusParams[0] === "scheduled");
      if (isScheduledOnlyQuery) {
        if (scheduledRow && matchesHall(scheduledRow)) {
          return { rows: [scheduledRow], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
      if (active && matchesHall(active)) {
        return { rows: [active], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  } as unknown as Parameters<typeof createAgentGame1Router>[0]["pool"];

  // 2026-05-08 (Tobias-feedback): mock hallGroupService med både `list` og
  // `get`. Default er tom oppførsel (matchende eksisterende test-baseline).
  // Tester som vil simulere GoH-membership setter `groupHallsForHall` eller
  // `goHById`-opsjonene over.
  const mockHallGroupService = {
    async list(filter?: { hallId?: string }) {
      const hallId = filter?.hallId;
      if (!hallId) return [];
      const hit = opts.groupHallsForHall?.[hallId];
      if (!hit) return [];
      return [
        {
          id: hit.id,
          members: hit.members,
        },
      ];
    },
    async get(groupId: string) {
      const hit = opts.goHById?.[groupId];
      if (hit === undefined) {
        // Default: kast som om gruppen ikke finnes (matcher legacy
        // baseline-oppførsel hvor goHById ikke er satt).
        throw new DomainError("HALL_GROUP_NOT_FOUND", "Hall-gruppe finnes ikke.");
      }
      if (hit === null) {
        // Eksplisitt simulering av lookup-feil (DB-feil osv).
        throw new Error("simulated DB error");
      }
      return {
        id: groupId,
        members: hit.members,
      };
    },
  };

  const app = express();
  app.use(express.json());
  app.use(
    createAgentGame1Router({
      platformService,
      masterControlService,
      hallReadyService,
      hallGroupService: mockHallGroupService as unknown as Parameters<
        typeof createAgentGame1Router
      >[0]["hallGroupService"],
      pool,
    })
  );

  const server = app.listen(0);
  await new Promise<void>((resolve) =>
    server.once("listening", () => resolve())
  );
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    serviceCalls,
    poolQueries,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

async function post(
  ctx: Ctx,
  path: string,
  token: string,
  body: unknown = {}
): Promise<Response> {
  return fetch(`${ctx.baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

async function get(ctx: Ctx, path: string, token: string): Promise<Response> {
  return fetch(`${ctx.baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ── GET /current-game ────────────────────────────────────────────────────

test("GET /current-game — master-agent ser aktivt scheduled_game + isMasterAgent=true", async () => {
  const ctx = await startServer({
    users: { "t-m": masterAgent },
    halls: {
      "hall-master": { id: "hall-master", name: "Master Hall" },
      "hall-slave": { id: "hall-slave", name: "Slave Hall" },
    },
  });
  try {
    const res = await get(ctx, "/api/agent/game1/current-game", "t-m");
    assert.equal(res.status, 200);
    const payload = (await res.json()) as {
      ok: boolean;
      data: {
        hallId: string;
        isMasterAgent: boolean;
        currentGame: { id: string; status: string; masterHallId: string } | null;
        halls: Array<{ hallId: string; hallName: string; isReady: boolean }>;
      };
    };
    assert.equal(payload.ok, true);
    assert.equal(payload.data.hallId, "hall-master");
    assert.equal(payload.data.isMasterAgent, true);
    assert.ok(payload.data.currentGame);
    assert.equal(payload.data.currentGame!.id, "g1");
    assert.equal(payload.data.currentGame!.masterHallId, "hall-master");
    assert.equal(payload.data.halls.length, 2);
    assert.equal(payload.data.halls[0]!.hallName, "Master Hall");
  } finally {
    await ctx.close();
  }
});

test("GET /current-game — slave-agent ser samme game men isMasterAgent=false", async () => {
  const ctx = await startServer({
    users: { "t-s": slaveAgent },
  });
  try {
    const res = await get(ctx, "/api/agent/game1/current-game", "t-s");
    assert.equal(res.status, 200);
    const payload = (await res.json()) as {
      data: { isMasterAgent: boolean; currentGame: { id: string } };
    };
    assert.equal(payload.data.isMasterAgent, false);
    assert.equal(payload.data.currentGame.id, "g1");
  } finally {
    await ctx.close();
  }
});

test("GET /current-game — ingen aktiv runde returnerer currentGame=null + tom halls", async () => {
  const ctx = await startServer({
    users: { "t-m": masterAgent },
    activeRow: null,
  });
  try {
    const res = await get(ctx, "/api/agent/game1/current-game", "t-m");
    assert.equal(res.status, 200);
    const payload = (await res.json()) as {
      data: { currentGame: null; halls: unknown[]; allReady: boolean };
    };
    assert.equal(payload.data.currentGame, null);
    assert.deepEqual(payload.data.halls, []);
    assert.equal(payload.data.allReady, false);
  } finally {
    await ctx.close();
  }
});

test("GET /current-game — manglende scheduled_games-tabell gir tom respons (fail-open)", async () => {
  const err = Object.assign(new Error("relation missing"), { code: "42P01" });
  const ctx = await startServer({
    users: { "t-m": masterAgent },
    poolError: err,
  });
  try {
    const res = await get(ctx, "/api/agent/game1/current-game", "t-m");
    assert.equal(res.status, 200);
    const payload = (await res.json()) as { data: { currentGame: null } };
    assert.equal(payload.data.currentGame, null);
  } finally {
    await ctx.close();
  }
});

test("GET /current-game — AGENT uten hallId → 400 FORBIDDEN", async () => {
  const ctx = await startServer({ users: { "t-u": unboundAgent } });
  try {
    const res = await get(ctx, "/api/agent/game1/current-game", "t-u");
    assert.equal(res.status, 400);
    const payload = (await res.json()) as { error: { code: string } };
    assert.equal(payload.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("GET /current-game — SUPPORT avvises (ikke i GAME1_MASTER_WRITE)", async () => {
  const ctx = await startServer({ users: { "t-sup": supportUser } });
  try {
    const res = await get(ctx, "/api/agent/game1/current-game", "t-sup");
    assert.equal(res.status, 400);
    const payload = (await res.json()) as { error: { code: string } };
    assert.equal(payload.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("GET /current-game — PLAYER avvises med FORBIDDEN", async () => {
  const ctx = await startServer({ users: { "t-pl": playerUser } });
  try {
    const res = await get(ctx, "/api/agent/game1/current-game", "t-pl");
    assert.equal(res.status, 400);
    const payload = (await res.json()) as { error: { code: string } };
    assert.equal(payload.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("GET /current-game — ADMIN med ?hallId overstyrer scope", async () => {
  const ctx = await startServer({
    users: { "t-a": adminUser },
  });
  try {
    const res = await get(
      ctx,
      "/api/agent/game1/current-game?hallId=hall-master",
      "t-a"
    );
    assert.equal(res.status, 200);
    const payload = (await res.json()) as {
      data: { hallId: string; isMasterAgent: boolean };
    };
    assert.equal(payload.data.hallId, "hall-master");
    assert.equal(payload.data.isMasterAgent, true);
  } finally {
    await ctx.close();
  }
});

// ── POST /start ──────────────────────────────────────────────────────────

test("POST /start — master-agent kan starte", async () => {
  const ctx = await startServer({ users: { "t-m": masterAgent } });
  try {
    const res = await post(ctx, "/api/agent/game1/start", "t-m", {});
    assert.equal(res.status, 200);
    const payload = (await res.json()) as {
      data: { gameId: string; status: string; auditId: string };
    };
    assert.equal(payload.data.gameId, "g1");
    assert.equal(payload.data.status, "running");
    assert.equal(payload.data.auditId, "audit-start");
    assert.equal(ctx.serviceCalls.startGame.length, 1);
    assert.equal(ctx.serviceCalls.startGame[0]!.actor.role, "AGENT");
    assert.equal(ctx.serviceCalls.startGame[0]!.actor.hallId, "hall-master");
  } finally {
    await ctx.close();
  }
});

test("POST /start — master-agent kan videreformidle confirmExcludedHalls", async () => {
  const ctx = await startServer({ users: { "t-m": masterAgent } });
  try {
    const res = await post(ctx, "/api/agent/game1/start", "t-m", {
      confirmExcludedHalls: ["hall-3"],
    });
    assert.equal(res.status, 200);
    assert.deepEqual(
      ctx.serviceCalls.startGame[0]!.confirmExcludedHalls,
      ["hall-3"]
    );
  } finally {
    await ctx.close();
  }
});

// F10 (E2E pilot-blokker, 2026-05-09): jackpotConfirmed-wireup ─────────
//
// Master-bingovert må kunne fullføre jackpot-popup-flyten via agent-
// konsollet på samme måte som admin-konsollet (`adminGame1Master.ts:319`).
// Tidligere ignorerte agent-routen `body.jackpotConfirmed`, så servicen
// fikk aldri se flagget og returnerte JACKPOT_CONFIRM_REQUIRED i evig
// loop.

test("POST /start — F10: jackpotConfirmed=true propageres til service", async () => {
  const ctx = await startServer({ users: { "t-m": masterAgent } });
  try {
    const res = await post(ctx, "/api/agent/game1/start", "t-m", {
      jackpotConfirmed: true,
    });
    assert.equal(res.status, 200);
    assert.equal(ctx.serviceCalls.startGame.length, 1);
    assert.equal(
      ctx.serviceCalls.startGame[0]!.jackpotConfirmed,
      true,
      "Service skal motta jackpotConfirmed=true når master har godkjent popup"
    );
  } finally {
    await ctx.close();
  }
});

test("POST /start — F10: jackpotConfirmed=\"true\" (string) aksepteres", async () => {
  // Speiler adminGame1Master.ts:319-320 som også aksepterer string-formen
  // for fleksibilitet mot JSON-klienter som serialiserer boolean som string.
  const ctx = await startServer({ users: { "t-m": masterAgent } });
  try {
    const res = await post(ctx, "/api/agent/game1/start", "t-m", {
      jackpotConfirmed: "true",
    });
    assert.equal(res.status, 200);
    assert.equal(
      ctx.serviceCalls.startGame[0]!.jackpotConfirmed,
      true,
      "String 'true' skal koerse til boolean true (parity med admin-routen)"
    );
  } finally {
    await ctx.close();
  }
});

test("POST /start — F10: jackpotConfirmed utelatt → service ser undefined (kaster JACKPOT_CONFIRM_REQUIRED)", async () => {
  // Når master ikke har godkjent jackpot-popup-en ennå skal flagget IKKE
  // settes i startInput. Service-laget kaster JACKPOT_CONFIRM_REQUIRED
  // og UI rendrer popup. Tester regress fra Tolkning A der `false` ble
  // explisitt satt og servicen fortolket det som "godkjent" (subtil bug).
  let observedFlag: unknown = "NOT-CHECKED";
  const ctx = await startServer({
    users: { "t-m": masterAgent },
    startImpl: async (input) => {
      observedFlag = input.jackpotConfirmed;
      throw new DomainError(
        "JACKPOT_CONFIRM_REQUIRED",
        "Master må godkjenne jackpot-popup."
      );
    },
  });
  try {
    const res = await post(ctx, "/api/agent/game1/start", "t-m", {});
    assert.equal(res.status, 400);
    const payload = (await res.json()) as { error: { code: string } };
    assert.equal(payload.error.code, "JACKPOT_CONFIRM_REQUIRED");
    assert.equal(
      observedFlag,
      undefined,
      "Når flagget utelates skal det ikke settes i startInput (forblir undefined)"
    );
  } finally {
    await ctx.close();
  }
});

test("POST /start — F10: re-submit med jackpotConfirmed=true etter JACKPOT_CONFIRM_REQUIRED gir suksess", async () => {
  // End-to-end: popup-flyten (kast → re-submit) gir suksess. Kjerne-bevis
  // for at fixet faktisk avlaster pilot-blokkeren.
  let callCount = 0;
  const ctx = await startServer({
    users: { "t-m": masterAgent },
    startImpl: async (input) => {
      callCount += 1;
      if (callCount === 1) {
        if (input.jackpotConfirmed) {
          throw new Error("Test-feil: første kall skal ikke ha jackpotConfirmed");
        }
        throw new DomainError("JACKPOT_CONFIRM_REQUIRED", "popup");
      }
      if (input.jackpotConfirmed !== true) {
        throw new Error("Test-feil: andre kall skal ha jackpotConfirmed=true");
      }
      return {
        gameId: "g1",
        status: "running",
        actualStartTime: "2026-05-09T10:00:00Z",
        actualEndTime: null,
        auditId: "audit-jackpot-ok",
      };
    },
  });
  try {
    const first = await post(ctx, "/api/agent/game1/start", "t-m", {});
    assert.equal(first.status, 400);
    const firstPayload = (await first.json()) as { error: { code: string } };
    assert.equal(firstPayload.error.code, "JACKPOT_CONFIRM_REQUIRED");

    const second = await post(ctx, "/api/agent/game1/start", "t-m", {
      jackpotConfirmed: true,
    });
    assert.equal(second.status, 200);
    const secondPayload = (await second.json()) as {
      data: { auditId: string };
    };
    assert.equal(secondPayload.data.auditId, "audit-jackpot-ok");
    assert.equal(callCount, 2);
  } finally {
    await ctx.close();
  }
});

test("POST /start — slave-agent avvises med 403 FORBIDDEN", async () => {
  const ctx = await startServer({ users: { "t-s": slaveAgent } });
  try {
    const res = await post(ctx, "/api/agent/game1/start", "t-s", {});
    assert.equal(res.status, 400);
    const payload = (await res.json()) as { error: { code: string } };
    assert.equal(payload.error.code, "FORBIDDEN");
    assert.equal(ctx.serviceCalls.startGame.length, 0);
  } finally {
    await ctx.close();
  }
});

test("POST /start — SUPPORT avvises", async () => {
  const ctx = await startServer({ users: { "t-sup": supportUser } });
  try {
    const res = await post(ctx, "/api/agent/game1/start", "t-sup", {});
    assert.equal(res.status, 400);
    const payload = (await res.json()) as { error: { code: string } };
    assert.equal(payload.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("POST /start — ingen aktiv runde gir NO_ACTIVE_GAME", async () => {
  const ctx = await startServer({
    users: { "t-m": masterAgent },
    activeRow: null,
  });
  try {
    const res = await post(ctx, "/api/agent/game1/start", "t-m", {});
    assert.equal(res.status, 400);
    const payload = (await res.json()) as { error: { code: string } };
    assert.equal(payload.error.code, "NO_ACTIVE_GAME");
  } finally {
    await ctx.close();
  }
});

test("POST /start — runden er 'scheduled' (purchase ikke åpnet enda) gir GAME_NOT_STARTABLE_YET med tid (Tobias 2026-05-07)", async () => {
  // Master-agent trykker Start mens runden ennå er i `'scheduled'`.
  // findActiveGameForHall returnerer null (filterer bort scheduled),
  // så fallback `findScheduledGameForHall` skal returnere planlagt-raden
  // og bygge feilmeldingen "Spillet er planlagt og åpner for kjøp kl HH:MM".
  const ctx = await startServer({
    users: { "t-m": masterAgent },
    activeRow: null,
    scheduledRow: {
      ...defaultActiveRow(),
      status: "scheduled",
      // 2026-05-07T16:30:00Z = 18:30 Europe/Oslo (CEST, UTC+2)
      scheduled_start_time: "2026-05-07T16:30:00.000Z",
    },
  });
  try {
    const res = await post(ctx, "/api/agent/game1/start", "t-m", {});
    assert.equal(res.status, 400);
    const payload = (await res.json()) as {
      error: { code: string; message: string };
    };
    assert.equal(payload.error.code, "GAME_NOT_STARTABLE_YET");
    assert.match(payload.error.message, /Spillet er planlagt/);
    assert.match(payload.error.message, /18:30/);
    // Master-control-service skal IKKE være kalt — vi feiler før delegering.
    assert.equal(ctx.serviceCalls.startGame.length, 0);
  } finally {
    await ctx.close();
  }
});

test("POST /start — NO_ACTIVE_GAME beholdt når verken aktiv eller scheduled finnes (regress)", async () => {
  // Verifiserer at den eksisterende stien (ingen runde i det hele tatt)
  // fortsatt returnerer NO_ACTIVE_GAME — ikke ved et uhell skifter til
  // GAME_NOT_STARTABLE_YET.
  const ctx = await startServer({
    users: { "t-m": masterAgent },
    activeRow: null,
    scheduledRow: null,
  });
  try {
    const res = await post(ctx, "/api/agent/game1/start", "t-m", {});
    assert.equal(res.status, 400);
    const payload = (await res.json()) as {
      error: { code: string; message: string };
    };
    assert.equal(payload.error.code, "NO_ACTIVE_GAME");
    assert.match(payload.error.message, /Ingen aktiv Spill 1-runde/);
  } finally {
    await ctx.close();
  }
});

test("POST /start — DomainError fra service propageres (HALLS_NOT_READY)", async () => {
  const ctx = await startServer({
    users: { "t-m": masterAgent },
    startImpl: async () => {
      throw new DomainError("HALLS_NOT_READY", "ikke klare");
    },
  });
  try {
    const res = await post(ctx, "/api/agent/game1/start", "t-m", {});
    assert.equal(res.status, 400);
    const payload = (await res.json()) as { error: { code: string } };
    assert.equal(payload.error.code, "HALLS_NOT_READY");
  } finally {
    await ctx.close();
  }
});

test("POST /start — ADMIN uten hall kan ikke starte via agent-routen (ingen scope)", async () => {
  // ADMIN uten hallId feiler resolveHallScope ved agent-routen (mangler
  // ?hallId). Dette er bevisst: POST-endepunktene tar ikke query-param
  // for sikkerhet — ADMIN bruker master-konsollet.
  const ctx = await startServer({ users: { "t-a": adminUser } });
  try {
    const res = await post(ctx, "/api/agent/game1/start", "t-a", {});
    assert.equal(res.status, 400);
    const payload = (await res.json()) as { error: { code: string } };
    assert.equal(payload.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

// ── POST /resume ─────────────────────────────────────────────────────────

test("POST /resume — master-agent kan resume", async () => {
  const ctx = await startServer({
    users: { "t-m": masterAgent },
    activeRow: { ...defaultActiveRow(), status: "paused" },
  });
  try {
    const res = await post(ctx, "/api/agent/game1/resume", "t-m", {});
    assert.equal(res.status, 200);
    const payload = (await res.json()) as {
      data: { gameId: string; status: string; auditId: string };
    };
    assert.equal(payload.data.gameId, "g1");
    assert.equal(payload.data.auditId, "audit-resume");
    assert.equal(ctx.serviceCalls.resumeGame.length, 1);
  } finally {
    await ctx.close();
  }
});

test("POST /resume — slave-agent avvises", async () => {
  const ctx = await startServer({
    users: { "t-s": slaveAgent },
    activeRow: { ...defaultActiveRow(), status: "paused" },
  });
  try {
    const res = await post(ctx, "/api/agent/game1/resume", "t-s", {});
    assert.equal(res.status, 400);
    const payload = (await res.json()) as { error: { code: string } };
    assert.equal(payload.error.code, "FORBIDDEN");
    assert.equal(ctx.serviceCalls.resumeGame.length, 0);
  } finally {
    await ctx.close();
  }
});

test("POST /resume — ingen aktiv runde gir NO_ACTIVE_GAME", async () => {
  const ctx = await startServer({
    users: { "t-m": masterAgent },
    activeRow: null,
  });
  try {
    const res = await post(ctx, "/api/agent/game1/resume", "t-m", {});
    assert.equal(res.status, 400);
    const payload = (await res.json()) as { error: { code: string } };
    assert.equal(payload.error.code, "NO_ACTIVE_GAME");
  } finally {
    await ctx.close();
  }
});

test("POST /resume — DomainError propageres (GAME_NOT_PAUSED)", async () => {
  const ctx = await startServer({
    users: { "t-m": masterAgent },
    resumeImpl: async () => {
      throw new DomainError("GAME_NOT_PAUSED", "kan kun resume pauset");
    },
  });
  try {
    const res = await post(ctx, "/api/agent/game1/resume", "t-m", {});
    assert.equal(res.status, 400);
    const payload = (await res.json()) as { error: { code: string } };
    assert.equal(payload.error.code, "GAME_NOT_PAUSED");
  } finally {
    await ctx.close();
  }
});

// ── GET /hall-status ─────────────────────────────────────────────────────

test("GET /hall-status — returnerer hall-liste for aktivt spill", async () => {
  const ctx = await startServer({
    users: { "t-m": masterAgent },
    halls: {
      "hall-master": { id: "hall-master", name: "Master" },
      "hall-slave": { id: "hall-slave", name: "Slave" },
    },
  });
  try {
    const res = await get(ctx, "/api/agent/game1/hall-status", "t-m");
    assert.equal(res.status, 200);
    const payload = (await res.json()) as {
      data: {
        hallId: string;
        gameId: string;
        halls: Array<{ hallId: string; hallName: string; isReady: boolean }>;
        allReady: boolean;
      };
    };
    assert.equal(payload.data.gameId, "g1");
    assert.equal(payload.data.halls.length, 2);
    const master = payload.data.halls.find((h) => h.hallId === "hall-master");
    assert.ok(master);
    assert.equal(master!.isReady, true);
    assert.equal(master!.hallName, "Master");
    const slave = payload.data.halls.find((h) => h.hallId === "hall-slave");
    assert.ok(slave);
    assert.equal(slave!.isReady, false);
  } finally {
    await ctx.close();
  }
});

test("GET /hall-status — ingen aktiv runde returnerer tom liste", async () => {
  const ctx = await startServer({
    users: { "t-m": masterAgent },
    activeRow: null,
  });
  try {
    const res = await get(ctx, "/api/agent/game1/hall-status", "t-m");
    assert.equal(res.status, 200);
    const payload = (await res.json()) as {
      data: { gameId: null; halls: unknown[] };
    };
    assert.equal(payload.data.gameId, null);
    assert.deepEqual(payload.data.halls, []);
  } finally {
    await ctx.close();
  }
});

test("GET /hall-status — slave-agent får samme data som master-agent", async () => {
  const ctx = await startServer({ users: { "t-s": slaveAgent } });
  try {
    const res = await get(ctx, "/api/agent/game1/hall-status", "t-s");
    assert.equal(res.status, 200);
    const payload = (await res.json()) as {
      data: { gameId: string; halls: unknown[] };
    };
    assert.equal(payload.data.gameId, "g1");
    assert.equal(payload.data.halls.length, 2);
  } finally {
    await ctx.close();
  }
});

test("GET /hall-status — SUPPORT avvises", async () => {
  const ctx = await startServer({ users: { "t-sup": supportUser } });
  try {
    const res = await get(ctx, "/api/agent/game1/hall-status", "t-sup");
    assert.equal(res.status, 400);
  } finally {
    await ctx.close();
  }
});

// ── GoH-membership-filter (Tobias-feedback 2026-05-08) ────────────────────
//
// Bug: scheduled-game's `participating_halls_json` er en snapshot fra
// spawn-tidspunkt. Hvis admin endrer GoH-membership senere, dukker
// "stale" haller opp i master-konsollet. Fix: intersekter med
// `hallGroupService.get(group_hall_id).members` slik at kun haller som
// ER medlemmer NÅ vises.

test("GET /current-game — filtrerer bort haller som ikke er i GoH NÅ (Tobias 2026-05-08)", async () => {
  // Scenario:
  //   participating_halls_json = ["hall-master", "hall-slave", "hall-stale"]
  //   readyRows har ready-rad for hall-stale (selv om den er fjernet fra GoH)
  //   GoH-medlemmer NÅ = [hall-master, hall-slave] (admin har fjernet hall-stale)
  // Forventning: master-konsoll returnerer kun hall-master + hall-slave.
  const ctx = await startServer({
    users: { "t-m": masterAgent },
    activeRow: {
      ...defaultActiveRow(),
      group_hall_id: "grp-1",
      participating_halls_json: ["hall-master", "hall-slave", "hall-stale"],
    },
    readyRows: [
      ...defaultReadyRows(),
      {
        gameId: "g1",
        hallId: "hall-stale",
        isReady: false,
        readyAt: null,
        readyByUserId: null,
        digitalTicketsSold: 0,
        physicalTicketsSold: 0,
        excludedFromGame: false,
        excludedReason: null,
        startTicketId: null,
        startScannedAt: null,
        finalScanTicketId: null,
        finalScannedAt: null,
        createdAt: "",
        updatedAt: "",
      },
    ],
    groupHallsForHall: {
      "hall-master": {
        id: "grp-1",
        members: [
          { hallId: "hall-master", hallName: "Master Hall" },
          { hallId: "hall-slave", hallName: "Slave Hall" },
        ],
      },
    },
    goHById: {
      "grp-1": {
        members: [
          { hallId: "hall-master", hallName: "Master Hall" },
          { hallId: "hall-slave", hallName: "Slave Hall" },
        ],
      },
    },
  });
  try {
    const res = await get(ctx, "/api/agent/game1/current-game", "t-m");
    assert.equal(res.status, 200);
    const payload = (await res.json()) as {
      data: { halls: Array<{ hallId: string; hallName: string }> };
    };
    const hallIds = payload.data.halls.map((h) => h.hallId).sort();
    // hall-stale skal IKKE være i listen lenger.
    assert.deepEqual(hallIds, ["hall-master", "hall-slave"]);
    // Bekreft at hall-stale ikke vises overhodet.
    assert.ok(!payload.data.halls.some((h) => h.hallId === "hall-stale"));
  } finally {
    await ctx.close();
  }
});

test("GET /current-game — master-hall vises ALLTID som sikkerhets-fallback (Tobias 2026-05-08)", async () => {
  // Edge-case: GoH-membership-lookup returnerer kun hall-slave (bug eller
  // race der master-hall ikke står i lista lenger). Master-hall skal
  // fortsatt vises fordi `active.master_hall_id` overstyrer filteret.
  const ctx = await startServer({
    users: { "t-m": masterAgent },
    activeRow: {
      ...defaultActiveRow(),
      group_hall_id: "grp-1",
    },
    goHById: {
      "grp-1": {
        members: [
          // hall-master er ikke i listen — sjelden race-case, men håndteres.
          { hallId: "hall-slave", hallName: "Slave Hall" },
        ],
      },
    },
  });
  try {
    const res = await get(ctx, "/api/agent/game1/current-game", "t-m");
    assert.equal(res.status, 200);
    const payload = (await res.json()) as {
      data: { halls: Array<{ hallId: string }> };
    };
    const hallIds = payload.data.halls.map((h) => h.hallId);
    // Master-hall MÅ vises selv om den ikke er i current GoH-listen.
    assert.ok(hallIds.includes("hall-master"));
    // hall-slave er fortsatt med (currently a member).
    assert.ok(hallIds.includes("hall-slave"));
  } finally {
    await ctx.close();
  }
});

test("GET /current-game — ekskluderte haller vises (separat fra GoH-filter)", async () => {
  // Halls med `excludedFromGame=true` er ikke det samme som "fjernet fra
  // GoH". Ekskluderte haller skal fortsatt vises i listen så master kan
  // se hva som ble ekskludert (med excludedReason).
  const ctx = await startServer({
    users: { "t-m": masterAgent },
    activeRow: {
      ...defaultActiveRow(),
      group_hall_id: "grp-1",
      participating_halls_json: ["hall-master", "hall-slave"],
    },
    readyRows: [
      {
        gameId: "g1",
        hallId: "hall-master",
        isReady: true,
        readyAt: "2026-04-24T09:55:00Z",
        readyByUserId: "u-m",
        digitalTicketsSold: 10,
        physicalTicketsSold: 5,
        excludedFromGame: false,
        excludedReason: null,
        startTicketId: null,
        startScannedAt: null,
        finalScanTicketId: null,
        finalScannedAt: null,
        createdAt: "",
        updatedAt: "",
      },
      {
        gameId: "g1",
        hallId: "hall-slave",
        isReady: false,
        readyAt: null,
        readyByUserId: null,
        digitalTicketsSold: 0,
        physicalTicketsSold: 0,
        excludedFromGame: true,
        excludedReason: "Tekniske problemer",
        startTicketId: null,
        startScannedAt: null,
        finalScanTicketId: null,
        finalScannedAt: null,
        createdAt: "",
        updatedAt: "",
      },
    ],
    goHById: {
      "grp-1": {
        members: [
          { hallId: "hall-master", hallName: "Master Hall" },
          { hallId: "hall-slave", hallName: "Slave Hall" },
        ],
      },
    },
  });
  try {
    const res = await get(ctx, "/api/agent/game1/current-game", "t-m");
    assert.equal(res.status, 200);
    const payload = (await res.json()) as {
      data: {
        halls: Array<{
          hallId: string;
          excludedFromGame: boolean;
          excludedReason: string | null;
        }>;
      };
    };
    const slave = payload.data.halls.find((h) => h.hallId === "hall-slave");
    assert.ok(slave);
    assert.equal(slave!.excludedFromGame, true);
    assert.equal(slave!.excludedReason, "Tekniske problemer");
  } finally {
    await ctx.close();
  }
});

test("GET /current-game — soft-fail når hallGroupService.get feiler (legacy fallback)", async () => {
  // Hvis lookup mot current GoH-membership feiler (DB-feil eller gruppen
  // ikke finnes), faller endepunktet tilbake til legacy-oppførselen
  // (vise alt fra `participating_halls_json` + ready-rows). Dette
  // beholder back-compat for tester og dev-miljø.
  const ctx = await startServer({
    users: { "t-m": masterAgent },
    activeRow: {
      ...defaultActiveRow(),
      group_hall_id: "grp-error",
      participating_halls_json: ["hall-master", "hall-slave"],
    },
    goHById: {
      "grp-error": null, // simulerer DB-feil
    },
  });
  try {
    const res = await get(ctx, "/api/agent/game1/current-game", "t-m");
    assert.equal(res.status, 200);
    const payload = (await res.json()) as {
      data: { halls: Array<{ hallId: string }> };
    };
    // Forventning: legacy-oppførsel — alle ready-row-haller vises.
    const hallIds = payload.data.halls.map((h) => h.hallId).sort();
    assert.deepEqual(hallIds, ["hall-master", "hall-slave"]);
  } finally {
    await ctx.close();
  }
});

test("GET /hall-status — filtrerer bort haller som ikke er i GoH NÅ (Tobias 2026-05-08)", async () => {
  // Samme bug-fix som /current-game — også /hall-status skal kun returnere
  // ready-rader for haller som ER medlemmer av GoH-en NÅ.
  const ctx = await startServer({
    users: { "t-m": masterAgent },
    activeRow: {
      ...defaultActiveRow(),
      group_hall_id: "grp-1",
      participating_halls_json: ["hall-master", "hall-slave", "hall-stale"],
    },
    readyRows: [
      ...defaultReadyRows(),
      {
        gameId: "g1",
        hallId: "hall-stale",
        isReady: false,
        readyAt: null,
        readyByUserId: null,
        digitalTicketsSold: 0,
        physicalTicketsSold: 0,
        excludedFromGame: false,
        excludedReason: null,
        startTicketId: null,
        startScannedAt: null,
        finalScanTicketId: null,
        finalScannedAt: null,
        createdAt: "",
        updatedAt: "",
      },
    ],
    goHById: {
      "grp-1": {
        members: [
          { hallId: "hall-master", hallName: "Master Hall" },
          { hallId: "hall-slave", hallName: "Slave Hall" },
        ],
      },
    },
  });
  try {
    const res = await get(ctx, "/api/agent/game1/hall-status", "t-m");
    assert.equal(res.status, 200);
    const payload = (await res.json()) as {
      data: { halls: Array<{ hallId: string }> };
    };
    const hallIds = payload.data.halls.map((h) => h.hallId).sort();
    assert.deepEqual(hallIds, ["hall-master", "hall-slave"]);
  } finally {
    await ctx.close();
  }
});

test("GET /current-game — requesting agent ser ALLTID sin egen hall som sikkerhets-fallback", async () => {
  // Edge-case: agentens hallId er ikke i current GoH-listen (race der
  // admin har fjernet slave fra GoH-en mens runden er aktiv, men slave
  // var med i `participating_halls_json` på spawn-tidspunkt). Agent skal
  // fortsatt se sin egen pille — ellers mister de oversikt over egen
  // status.
  const ctx = await startServer({
    users: { "t-s": slaveAgent },
    activeRow: {
      ...defaultActiveRow(),
      group_hall_id: "grp-1",
      // slave er fortsatt i snapshotten (game spawnet før admin endret GoH)
      participating_halls_json: ["hall-master", "hall-slave"],
    },
    goHById: {
      "grp-1": {
        members: [
          // hall-slave er NÅ ikke lenger i GoH-listen (admin fjernet)
          { hallId: "hall-master", hallName: "Master Hall" },
        ],
      },
    },
  });
  try {
    const res = await get(ctx, "/api/agent/game1/current-game", "t-s");
    assert.equal(res.status, 200);
    const payload = (await res.json()) as {
      data: { halls: Array<{ hallId: string }> };
    };
    const hallIds = payload.data.halls.map((h) => h.hallId);
    // Slave-agent MÅ se sin egen hall + master-hall (begge security-fallback).
    assert.ok(hallIds.includes("hall-slave"));
    assert.ok(hallIds.includes("hall-master"));
  } finally {
    await ctx.close();
  }
});
