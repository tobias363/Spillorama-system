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

  describe("ADR-0017: /api/agent/game1/start må IKKE wire jackpotConfirmed", () => {
    /**
     * ADR-0017 (2026-05-10) overstyrer F10-FIX (PR #1101) og F-NEW-1 (PR #1118):
     *
     * Tobias-direktiv 2026-05-10: "Jackpot-popup gjelder kun for Jackpot-katalog-
     * spillet (pos 7), og bingoverten setter ALLTID jackpot manuelt før spillet
     * starter. Det skal IKKE være automatisk akkumulering."
     *
     * Den tidligere wire-up av `body.jackpotConfirmed` til service-laget er
     * fjernet. Lockdown-testen er flippet på nytt: vi verifiserer NÅ at
     * agentGame1.ts IKKE INNEHOLDER `jackpotConfirmed`-håndtering i
     * `/api/agent/game1/start`-handler-en. Daglig jackpot-akkumulering er
     * erstattet av per-spill setup via `JackpotSetupModal` og lagres i
     * `app_game_plan_run.jackpot_overrides_json`.
     */
    it("ADR-0017: agentGame1.ts wirer IKKE jackpotConfirmed i /api/agent/game1/start", async () => {
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
      // Per ADR-0017 skal jackpotConfirmed-feltet ikke parses, propageres
      // eller settes på startInput. Komment-referanse til ADR-0017 er OK,
      // men ingen aktiv kode-bruk skal forekomme.
      const setsJackpotConfirmed = handlerBody.match(
        /startInput\.jackpotConfirmed|jackpotConfirmed\s*=\s*body\./
      );
      assert.equal(
        setsJackpotConfirmed,
        null,
        "ADR-0017: agentGame1.ts skal IKKE parse eller propagere jackpotConfirmed " +
          "i /api/agent/game1/start-handler-en — feltet er fjernet."
      );
    });
  });
});
