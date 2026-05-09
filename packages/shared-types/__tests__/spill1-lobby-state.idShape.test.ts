/**
 * F17 (E2E pilot-blokker, 2026-05-09): regresjons-tester for ID-validering
 * i Spill1AgentLobbyState og dens delskjemaer.
 *
 * Bakgrunn: E2E-verifikasjonen 2026-Q3 avdekket at Spill1AgentLobbyStateSchema
 * krevde UUID-format på `planRunId`, `planId`, `scheduledGameId` og
 * `currentScheduledGameId`. Demo-/seed-data bruker slug-ID-er som
 * `demo-plan-pilot` og `demo-plan-run-pilot-1`, og DB-kolonnene er
 * `TEXT PRIMARY KEY`. Resultatet var at `/api/agent/game1/lobby` returnerte
 * INTERNAL_ERROR for master-agent i seedet pilot-miljø.
 *
 * Disse testene låser kontrakten:
 *   1. Slug-ID-er aksepteres på alle fire ID-felter.
 *   2. UUID-er aksepteres fortsatt (ingen regress for prod-flow som
 *      genererer UUID-IDs).
 *   3. Tomme strenger og ikke-strenger rejectes (defensive validation
 *      mot version-skew).
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  Spill1PlanMetaSchema,
  Spill1ScheduledGameMetaSchema,
  Spill1AgentLobbyStateSchema,
} from "../src/spill1-lobby-state.js";

// Realistic slug-IDs from seed-demo-pilot-day.ts
const SLUG_PLAN_ID = "demo-plan-pilot";
const SLUG_PLAN_RUN_ID = "demo-plan-run-pilot-1";
const SLUG_SCHEDULED_GAME_ID = "demo-scheduled-game-pilot-1";

// Real UUID (prod-format).
const UUID_PLAN_ID = "550e8400-e29b-41d4-a716-446655440000";
const UUID_PLAN_RUN_ID = "550e8400-e29b-41d4-a716-446655440001";
const UUID_SCHEDULED_GAME_ID = "550e8400-e29b-41d4-a716-446655440002";

function planMetaWithIds(
  planRunId: string,
  planId: string
): Record<string, unknown> {
  return {
    planRunId,
    planId,
    planName: "Pilot-plan",
    currentPosition: 1,
    totalPositions: 13,
    catalogSlug: "bingo",
    catalogDisplayName: "Bingo",
    planRunStatus: "running",
    jackpotSetupRequired: false,
    pendingJackpotOverride: null,
  };
}

function scheduledGameMetaWithId(
  scheduledGameId: string
): Record<string, unknown> {
  return {
    scheduledGameId,
    status: "running",
    scheduledStartTime: "2026-05-09T10:00:00.000Z",
    scheduledEndTime: "2026-05-09T11:00:00.000Z",
    actualStartTime: "2026-05-09T10:00:30.000Z",
    actualEndTime: null,
    pauseReason: null,
  };
}

function lobbyStateWithIds(opts: {
  currentScheduledGameId: string | null;
  planMeta: Record<string, unknown> | null;
  scheduledGameMeta: Record<string, unknown> | null;
}): Record<string, unknown> {
  return {
    hallId: "demo-hall-pilot-1",
    hallName: "Demo Hall",
    businessDate: "2026-05-09",
    generatedAt: "2026-05-09T10:00:00.000Z",
    currentScheduledGameId: opts.currentScheduledGameId,
    planMeta: opts.planMeta,
    scheduledGameMeta: opts.scheduledGameMeta,
    halls: [],
    allHallsReady: false,
    masterHallId: "demo-hall-pilot-1",
    groupOfHallsId: "demo-goh-pilot",
    isMasterAgent: true,
    nextScheduledStartTime: null,
    inconsistencyWarnings: [],
  };
}

// ── 1. Slug-IDs aksepteres ──────────────────────────────────────────────

test("F17: Spill1PlanMetaSchema aksepterer slug-format planRunId og planId", () => {
  const result = Spill1PlanMetaSchema.safeParse(
    planMetaWithIds(SLUG_PLAN_RUN_ID, SLUG_PLAN_ID)
  );
  assert.ok(
    result.success,
    `Slug-ID burde være gyldig. Errors: ${
      result.success ? "" : JSON.stringify(result.error.issues)
    }`
  );
});

test("F17: Spill1ScheduledGameMetaSchema aksepterer slug-format scheduledGameId", () => {
  const result = Spill1ScheduledGameMetaSchema.safeParse(
    scheduledGameMetaWithId(SLUG_SCHEDULED_GAME_ID)
  );
  assert.ok(
    result.success,
    `Slug-ID burde være gyldig. Errors: ${
      result.success ? "" : JSON.stringify(result.error.issues)
    }`
  );
});

test("F17: Spill1AgentLobbyStateSchema aksepterer alle slug-IDs samtidig (full E2E-payload)", () => {
  // Dette er den eksakte payloaden som E2E-rapporten viste at backend
  // ville returnere men som schemet rejected. Hvis denne testen feiler
  // er vi tilbake til pilot-blokkeren.
  const payload = lobbyStateWithIds({
    currentScheduledGameId: SLUG_SCHEDULED_GAME_ID,
    planMeta: planMetaWithIds(SLUG_PLAN_RUN_ID, SLUG_PLAN_ID),
    scheduledGameMeta: scheduledGameMetaWithId(SLUG_SCHEDULED_GAME_ID),
  });
  const result = Spill1AgentLobbyStateSchema.safeParse(payload);
  assert.ok(
    result.success,
    `Slug-IDs i full payload burde være gyldige. Errors: ${
      result.success ? "" : JSON.stringify(result.error.issues)
    }`
  );
});

// ── 2. UUIDs aksepteres fortsatt (ingen regress) ────────────────────────

test("F17: Spill1PlanMetaSchema aksepterer UUID planRunId og planId (ingen regress)", () => {
  const result = Spill1PlanMetaSchema.safeParse(
    planMetaWithIds(UUID_PLAN_RUN_ID, UUID_PLAN_ID)
  );
  assert.ok(result.success, "UUID-format må fortsatt fungere for prod-flow");
});

test("F17: Spill1AgentLobbyStateSchema aksepterer alle UUID-IDs samtidig (prod-payload)", () => {
  const payload = lobbyStateWithIds({
    currentScheduledGameId: UUID_SCHEDULED_GAME_ID,
    planMeta: planMetaWithIds(UUID_PLAN_RUN_ID, UUID_PLAN_ID),
    scheduledGameMeta: scheduledGameMetaWithId(UUID_SCHEDULED_GAME_ID),
  });
  const result = Spill1AgentLobbyStateSchema.safeParse(payload);
  assert.ok(result.success, "UUID-payload (prod-flow) må fortsatt parse uendret");
});

// ── 3. Defensive validation: tomme strenger og feil typer rejectes ──────

test("F17: tom planId rejectes (defensive validation)", () => {
  const result = Spill1PlanMetaSchema.safeParse(
    planMetaWithIds(SLUG_PLAN_RUN_ID, "")
  );
  assert.equal(
    result.success,
    false,
    "Tom string må rejectes — schema må fortsatt fange klare bugs"
  );
});

test("F17: number i stedet for string for scheduledGameId rejectes", () => {
  const bad = scheduledGameMetaWithId("placeholder");
  bad.scheduledGameId = 12345; // Type-mismatch
  const result = Spill1ScheduledGameMetaSchema.safeParse(bad);
  assert.equal(result.success, false, "Number må rejectes — type-feil");
});

test("F17: currentScheduledGameId aksepterer null (empty-state)", () => {
  // Når master ikke har valgt hall (ADMIN-fallback) eller ingen aktiv runde
  // finnes, returnerer aggregator null. Empty-state må fortsatt fungere.
  const payload = lobbyStateWithIds({
    currentScheduledGameId: null,
    planMeta: null,
    scheduledGameMeta: null,
  });
  const result = Spill1AgentLobbyStateSchema.safeParse(payload);
  assert.ok(
    result.success,
    `Empty-state med null IDs må parse. Errors: ${
      result.success ? "" : JSON.stringify(result.error.issues)
    }`
  );
});
