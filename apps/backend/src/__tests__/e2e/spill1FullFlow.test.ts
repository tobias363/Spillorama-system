/**
 * Spill 1 full-flow regression tests — locks behavior verified end-to-end
 * against a live backend on 2026-05-09.
 *
 * Findings encoded (UPDATED 2026-05-09 to verify FIXES, not BUGS):
 *   F10 — `/api/agent/game1/start` NOW accepts `jackpotConfirmed` body
 *         param after PR #1101 (commit 40c465b3). Lockdown verifies the
 *         wire-up is in place.
 *   F13 — `GAME1_AUTO_DRAW_ENABLED` default endret til `true` etter PR
 *         #1101 (commit 006b2f81). Pilot trenger ikke lenger sette env-var.
 *   F17 — `Spill1AgentLobbyStateSchema` aksepterer NÅ både UUID og slug-
 *         form for `planMeta.planId` etter shared-types-fix (commit
 *         dfdf64f8). Speiler DB-skjemaet (`TEXT PRIMARY KEY`).
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

    it("F17-FIX: aksepterer non-UUID slug planId — seed 'demo-plan-pilot' OK", () => {
      // OPPDATERT 2026-05-09: PR #1101 (commit dfdf64f8) endret
      // Spill1IdSchema fra `z.string().uuid()` til `z.string().min(1)`
      // fordi DB-skjemaet bruker TEXT PRIMARY KEY (ikke UUID). Demo-/seed-
      // data og prod-runs bruker slug-form (`demo-plan-pilot`) ved siden av
      // UUID. UUID-validering ga falsk strenghet og brøt
      // /api/agent/game1/lobby med INTERNAL_ERROR for legitime DB-rader.
      //
      // Lockdown-test verifiserer at fixen faktisk er på plass: schema skal
      // godta non-UUID planId.
      const parsed = Spill1AgentLobbyStateSchema.safeParse(
        buildLobbyPayload("demo-plan-pilot")
      );
      if (!parsed.success) {
        // Aid debugging hvis schema regresses tilbake til UUID-only.
        console.error(parsed.error.issues);
      }
      assert.equal(
        parsed.success,
        true,
        "F17-fix: slug-form planId må godtas — speiler DB-skjemaet (TEXT PRIMARY KEY)"
      );
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

    it("F17-FIX: rejects empty-string planId (validation still functional)", () => {
      // Selv etter fixen skal tom streng avvises — `z.string().min(1)`.
      // Verifiserer at validering ikke ble fjernet helt, bare oppdatert til
      // å matche DB-skjemaet.
      const parsed = Spill1AgentLobbyStateSchema.safeParse(
        buildLobbyPayload("")
      );
      assert.equal(
        parsed.success,
        false,
        "tom streng planId må fortsatt avvises (min(1)-konstrukten)"
      );
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

  describe("F10-FIX: /api/agent/game1/start jackpotConfirmed wire-up", () => {
    /**
     * OPPDATERT 2026-05-09: PR #1101 (commit 40c465b3) lukket F10-funnet ved
     * å wire `jackpotConfirmed` (boolean | "true") inn i agent-route-handler-en.
     * Speiler legacy admin-route adminGame1Master.ts:319.
     *
     * Lockdown-testen er flippet: vi verifiserer NÅ at agentGame1.ts
     * INNEHOLDER `jackpotConfirmed` i `/api/agent/game1/start`-handler-en, og
     * at parsing er tolerant (boolean ELLER literal "true").
     *
     * NB: Denne PR-en (F-NEW-1) lukker SPEIL-buggen på Bølge 2-route
     * (`/api/agent/game1/master/start` via MasterActionService). Legacy
     * agent-route (denne) ble fixet i PR #1101 separat.
     */
    it("F10-FIX: agentGame1.ts wirer jackpotConfirmed i /api/agent/game1/start", async () => {
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
      const handlerStartIdx = content.indexOf(
        '"/api/agent/game1/start"'
      );
      assert.ok(
        handlerStartIdx >= 0,
        "agent-route må fortsatt registrere /api/agent/game1/start"
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
      assert.equal(
        referencesJackpotConfirmed,
        true,
        "F10-fix verifisering: agentGame1.ts MÅ inneholde jackpotConfirmed " +
          "i /api/agent/game1/start-handler-en (PR #1101 / commit 40c465b3)."
      );
      // Verifiser at vi gjør tolerant boolean | "true"-parsing (speiler
      // legacy admin-route og forhindrer 'Unrecognized key' fra Zod).
      const tolerantParse =
        handlerBody.includes('jackpotConfirmed === true') &&
        handlerBody.includes('jackpotConfirmed === "true"');
      assert.equal(
        tolerantParse,
        true,
        "F10-fix verifisering: parsing må akseptere boolean ELLER literal \"true\""
      );
    });
  });
});
