/**
 * Spill 1 full-flow regression tests — locks behavior verified end-to-end
 * against a live backend on 2026-05-09.
 *
 * Findings encoded:
 *   F10 — `/api/agent/game1/start` does NOT accept `jackpotConfirmed` body
 *         param (only `/api/admin/game1/games/:id/start` does). Bug: agent
 *         master cannot bypass the JACKPOT_CONFIRM_REQUIRED popup via the
 *         agent route.
 *   F13 — `GAME1_AUTO_DRAW_ENABLED` defaults to `false`. Without the env-var
 *         being explicitly set, even a successfully-started scheduled game
 *         will sit in `running` with 0 draws indefinitely. Pilot must set
 *         this var at deploy.
 *   F17 — `Spill1AgentLobbyStateSchema` rejects non-UUID `planMeta.planId`.
 *         Seed-data with `demo-plan-pilot` (non-UUID) breaks
 *         `/api/agent/game1/lobby` with INTERNAL_ERROR.
 *   F22 — Auto-draw stops at `DEFAULT_GAME1_MAX_DRAWS = 52`, not 75. With
 *         only 2 small-white tickets in play, phases 2-5 may never have
 *         winners and the game terminates silently after draw 52.
 *
 * These are unit-level shape/wire tests — they don't spin up the full
 * backend like `Spill1FullDay.e2e.test.ts`, but they assert the contracts
 * the live verification on 2026-05-09 found to be inconsistent.
 *
 * RUN: npm --prefix apps/backend run test -- src/__tests__/e2e/spill1FullFlow.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { Spill1AgentLobbyStateSchema } from "@spillorama/shared-types";
import { DEFAULT_GAME1_MAX_DRAWS } from "../../game/Game1DrawEngineService.js";

describe("Spill1 E2E lock-down — findings from 2026-05-09 verification", () => {
  describe("F22: DEFAULT_GAME1_MAX_DRAWS contract", () => {
    it("default max-draws is 52 (legacy Spill 1 standard, not 75)", () => {
      assert.equal(DEFAULT_GAME1_MAX_DRAWS, 52);
    });
  });

  describe("F17: Spill1AgentLobbyStateSchema planId UUID validation", () => {
    function buildLobbyPayload(planIdValue: string) {
      return {
        hallId: "demo-hall-001",
        hallName: "Demo 1 (Master)",
        businessDate: "2026-05-09",
        generatedAt: new Date().toISOString(),
        currentScheduledGameId: null,
        planMeta: {
          planRunId: "00000000-0000-4000-8000-000000000000",
          planId: planIdValue,
          planName: "Pilot Demo",
          currentPosition: 1,
          totalPositions: 13,
          catalogSlug: "5x500",
          catalogDisplayName: "5×500",
          planRunStatus: "idle" as const,
          jackpotSetupRequired: false,
          pendingJackpotOverride: null,
        },
        scheduledGameMeta: null,
        halls: [],
        allHallsReady: false,
        masterHallId: "demo-hall-001",
        groupOfHallsId: "demo-pilot-goh",
        isMasterAgent: true,
        nextScheduledStartTime: null,
        inconsistencyWarnings: [],
      };
    }

    it("rejects non-UUID planId — seed-data 'demo-plan-pilot' breaks lobby", () => {
      const parsed = Spill1AgentLobbyStateSchema.safeParse(
        buildLobbyPayload("demo-plan-pilot")
      );
      assert.equal(
        parsed.success,
        false,
        "seed-style non-UUID planId must fail validation (regression: schema is too strict for seed-data)"
      );
      if (!parsed.success) {
        const planIdIssue = parsed.error.issues.find(
          (i) =>
            Array.isArray(i.path) &&
            i.path.includes("planMeta") &&
            i.path.includes("planId")
        );
        assert.ok(
          planIdIssue,
          "must explicitly fail on planMeta.planId, not on some other field"
        );
      }
    });

    it("accepts proper UUID planId (control case)", () => {
      const parsed = Spill1AgentLobbyStateSchema.safeParse(
        buildLobbyPayload("11111111-1111-4111-8111-111111111111")
      );
      if (!parsed.success) {
        // Aid debugging when schema evolves and the test needs to grow.
        console.error(parsed.error.issues);
      }
      assert.equal(parsed.success, true, "UUID planId should pass");
    });

    it("accepts empty-state shape (ADMIN without hallId)", () => {
      const emptyState = {
        hallId: null,
        hallName: null,
        businessDate: null,
        generatedAt: new Date().toISOString(),
        currentScheduledGameId: null,
        planMeta: null,
        scheduledGameMeta: null,
        halls: [],
        allHallsReady: false,
        masterHallId: null,
        groupOfHallsId: null,
        isMasterAgent: false,
        nextScheduledStartTime: null,
        inconsistencyWarnings: [],
      };
      const parsed = Spill1AgentLobbyStateSchema.safeParse(emptyState);
      assert.equal(
        parsed.success,
        true,
        "empty-state must always pass — used for ADMIN-without-hall and seed-empty cases"
      );
    });
  });

  describe("F10: /api/agent/game1/start jackpotConfirmed wire-up gap", () => {
    /**
     * This is a route-shape test — it documents the intentional wire-up
     * gap. The agent route at `apps/backend/src/routes/agentGame1.ts:553-633`
     * does NOT extract `jackpotConfirmed` from req.body and pass it to
     * `Game1MasterControlService.startGame()`. Only the admin route at
     * `apps/backend/src/routes/adminGame1Master.ts:319` does.
     *
     * Until the agent route is updated, master agents (HALL_OPERATOR /
     * AGENT) cannot complete the JACKPOT_CONFIRM_REQUIRED popup flow via
     * `/api/agent/game1/start`. They have to use the admin route which is
     * RBAC-restricted to ADMIN by default. For pilot, this means master
     * bingoverter need ADMIN role to confirm jackpot, OR the route must be
     * extended.
     *
     * This test reads the route file and asserts the gap is still there
     * (so the file gets updated when the gap closes).
     */
    it("documents agent-route gap: jackpotConfirmed not in agentGame1.ts (yet)", async () => {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const here = path.dirname(new URL(import.meta.url).pathname);
      const routeFile = path.resolve(
        here,
        "..",
        "..",
        "routes",
        "agentGame1.ts"
      );
      const content = await fs.readFile(routeFile, "utf8");
      // We expect this assertion to FAIL when the gap is closed (i.e. when
      // the route accepts jackpotConfirmed). At that point, this test must
      // be updated to verify the new wire-up.
      const handlerStartIdx = content.indexOf(
        '"/api/agent/game1/start"'
      );
      assert.ok(
        handlerStartIdx >= 0,
        "agent-route should still register /api/agent/game1/start"
      );
      const nextHandlerIdx = content.indexOf(
        "router.post(",
        handlerStartIdx + 30
      );
      const handlerBody = content.slice(
        handlerStartIdx,
        nextHandlerIdx > 0 ? nextHandlerIdx : undefined
      );
      const referencesJackpotConfirmed = handlerBody.includes(
        "jackpotConfirmed"
      );
      // Lock current state: gap exists. When fixed, flip this assertion.
      assert.equal(
        referencesJackpotConfirmed,
        false,
        "WHEN THIS FAILS: the agent-route now wires jackpotConfirmed. " +
          "Update this test to assert the param IS extracted + passed " +
          "to startGame(). Track via BIN-XXX (see SPILL1_E2E_VERIFICATION_2026-Q3.md)."
      );
    });
  });
});
