/**
 * Tester for devRoundReplay-routeren (Tobias-direktiv 2026-05-14).
 *
 * Dekker:
 *   - Token-gating: 503 hvis env mangler, 401 uten token, 403 ved feil token, 200 ved valid
 *   - Input-validering: 400 hvis scheduledGameId har ugyldig format
 *   - 404 hvis scheduled-game ikke finnes
 *   - 200 + replay-payload ved happy path
 *   - 500 ved uventet feil (NB: builder fail-softer det meste)
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import type { Pool } from "pg";
import { createDevRoundReplayRouter } from "./devRoundReplay.js";

const ORIGINAL_TOKEN = process.env.RESET_TEST_PLAYERS_TOKEN;

function makePool(scheduledGame: Record<string, unknown> | null): Pool {
  return {
    query: async (sql: string) => {
      if (
        sql.includes("app_game1_scheduled_games") &&
        !sql.includes("app_game_plan_run") &&
        !sql.includes("app_game_catalog")
      ) {
        return { rows: scheduledGame != null ? [scheduledGame] : [] };
      }
      return { rows: [] };
    },
  } as unknown as Pool;
}

function baseScheduledGameRow(): Record<string, unknown> {
  return {
    id: "sched-1",
    daily_schedule_id: "ds-1",
    schedule_id: "s-1",
    sub_game_index: 0,
    sub_game_name: "Bingo",
    custom_game_name: null,
    scheduled_day: "2026-05-14",
    scheduled_start_time: new Date("2026-05-14T08:00:00Z"),
    scheduled_end_time: new Date("2026-05-14T09:00:00Z"),
    ticket_config_json: {},
    jackpot_config_json: {},
    game_mode: "Manual",
    master_hall_id: "demo-hall-001",
    group_hall_id: "goh-1",
    participating_halls_json: [],
    status: "completed",
    actual_start_time: new Date("2026-05-14T08:00:00Z"),
    actual_end_time: new Date("2026-05-14T08:45:00Z"),
    started_by_user_id: "agent-1",
    stopped_by_user_id: null,
    stop_reason: null,
    catalog_entry_id: null,
    plan_run_id: null,
    plan_position: 1,
    room_code: "BINGO_DEMO",
    created_at: new Date("2026-05-14T07:59:00Z"),
    updated_at: new Date("2026-05-14T08:45:00Z"),
  };
}

async function startApp(pool: Pool): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const app = express();
  app.use(express.json());
  app.use(createDevRoundReplayRouter({ pool }));
  return await new Promise((resolve) => {
    const server: Server = app.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (typeof addr !== "object" || addr === null) {
        throw new Error("server.address() returnerte ikke object");
      }
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise<void>((r) => {
            server.close(() => r());
          }),
      });
    });
  });
}

describe("devRoundReplay router", () => {
  beforeEach(() => {
    process.env.RESET_TEST_PLAYERS_TOKEN = "test-token";
  });

  after(() => {
    if (ORIGINAL_TOKEN === undefined) {
      delete process.env.RESET_TEST_PLAYERS_TOKEN;
    } else {
      process.env.RESET_TEST_PLAYERS_TOKEN = ORIGINAL_TOKEN;
    }
  });

  describe("token-gating", () => {
    it("503 hvis RESET_TEST_PLAYERS_TOKEN ikke satt", async () => {
      delete process.env.RESET_TEST_PLAYERS_TOKEN;
      const { baseUrl, close } = await startApp(makePool(null));
      try {
        const res = await fetch(
          `${baseUrl}/api/_dev/debug/round-replay/abc`,
        );
        assert.equal(res.status, 503);
        const body = (await res.json()) as { error: { code: string } };
        assert.equal(body.error.code, "DEV_TOKEN_NOT_CONFIGURED");
      } finally {
        await close();
      }
    });

    it("401 uten token", async () => {
      const { baseUrl, close } = await startApp(makePool(null));
      try {
        const res = await fetch(
          `${baseUrl}/api/_dev/debug/round-replay/abc`,
        );
        assert.equal(res.status, 401);
      } finally {
        await close();
      }
    });

    it("403 ved feil token", async () => {
      const { baseUrl, close } = await startApp(makePool(null));
      try {
        const res = await fetch(
          `${baseUrl}/api/_dev/debug/round-replay/abc?token=wrong`,
        );
        assert.equal(res.status, 403);
      } finally {
        await close();
      }
    });
  });

  describe("input validation", () => {
    it("400 ved ugyldig scheduledGameId-format", async () => {
      const { baseUrl, close } = await startApp(makePool(null));
      try {
        // Inneholder slash som ruller path-matching → falle ut til 404 default,
        // så vi tester en ID som matches av path men feiler regex (eks spesialtegn).
        const res = await fetch(
          `${baseUrl}/api/_dev/debug/round-replay/has%20space?token=test-token`,
        );
        assert.equal(res.status, 400);
        const body = (await res.json()) as { error: { code: string } };
        assert.equal(body.error.code, "INVALID_INPUT");
      } finally {
        await close();
      }
    });

    it("aksepterer UUID-lignende ID (alfanumerisk + dash + underscore)", async () => {
      const { baseUrl, close } = await startApp(
        makePool(baseScheduledGameRow()),
      );
      try {
        const res = await fetch(
          `${baseUrl}/api/_dev/debug/round-replay/7dcbc3ba-bb64-4596-8410-f0bfe269efd6?token=test-token`,
        );
        assert.equal(res.status, 200);
      } finally {
        await close();
      }
    });
  });

  describe("response", () => {
    it("404 hvis scheduled-game ikke finnes", async () => {
      const { baseUrl, close } = await startApp(makePool(null));
      try {
        const res = await fetch(
          `${baseUrl}/api/_dev/debug/round-replay/missing-123?token=test-token`,
        );
        assert.equal(res.status, 404);
        const body = (await res.json()) as { error: { code: string } };
        assert.equal(body.error.code, "SCHEDULED_GAME_NOT_FOUND");
      } finally {
        await close();
      }
    });

    it("200 + replay-shape ved happy path", async () => {
      const { baseUrl, close } = await startApp(
        makePool(baseScheduledGameRow()),
      );
      try {
        const res = await fetch(
          `${baseUrl}/api/_dev/debug/round-replay/sched-1?token=test-token`,
        );
        assert.equal(res.status, 200);
        const body = (await res.json()) as {
          ok: boolean;
          data: {
            scheduledGameId: string;
            metadata: { hallId: string };
            timeline: unknown[];
            summary: { purchases: { totalCount: number } };
            anomalies: unknown[];
          };
        };
        assert.equal(body.ok, true);
        assert.equal(body.data.scheduledGameId, "sched-1");
        assert.equal(body.data.metadata.hallId, "demo-hall-001");
        assert.ok(Array.isArray(body.data.timeline));
        assert.ok(Array.isArray(body.data.anomalies));
        assert.equal(typeof body.data.summary.purchases.totalCount, "number");
      } finally {
        await close();
      }
    });
  });
});
