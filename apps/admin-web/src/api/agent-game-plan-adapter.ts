/**
 * Fase 3 (2026-05-07): adapter mellom ny `/api/agent/game-plan/current`-
 * respons og legacy `Spill1CurrentGameResponse`-formatet som
 * `Spill1HallStatusBox` og `NextGamePanel` allerede konsumerer.
 *
 * Hvorfor adapter?
 * ----------------
 * Master-dashbord-UI ble bygget mot legacy-API ved å lese {currentGame,
 * halls[], allReady, isMasterAgent}. Hvis vi byttet komponentene til å
 * lese fra plan-runtime-API direkte ville vi måtte refaktorere all
 * rendering — Tobias har eksplisitt sagt at UI skal forbli IDENTISK i
 * Fase 3, så vi mapper plan-runtime-responsen TIL legacy-shape.
 *
 * Hva mappes?
 * -----------
 * - currentItem.catalogEntry → currentGame.subGameName
 * - run.id (str) → currentGame.id (str — brukes som proxy til
 *   "scheduled-game-id" inntil engine-bridgen er på plass i Fase 3.5)
 * - hallId fra `hallId`-feltet
 * - status: idle → "scheduled", running → "running", paused →
 *   "paused", finished → "ended"
 * - halls[]: hentes ikke fra plan-runtime-API direkte (dette API-et
 *   eksponerer ikke ready-state per hall) — caller må STADIG kalle
 *   `/api/agent/game1/current-game` eller `/api/agent/game1/hall-status`
 *   for ready-tracking. Adapter-en returnerer derfor `halls: []` så
 *   caller forstår at ready-state må hentes separat.
 *
 * Bruk:
 *   ```ts
 *   if (isFeatureEnabled("useNewGamePlan")) {
 *     const planResp = await fetchAgentGamePlanCurrent();
 *     const adapted = adaptGamePlanToLegacyShape(planResp);
 *     // … render UI som vanlig …
 *   } else {
 *     const legacy = await fetchAgentGame1CurrentGame();
 *     // … samme render …
 *   }
 *   ```
 *
 * Begrensninger / gaps (deferred til Fase 3.5):
 *   - Ingen scheduled-game-id-bro: plan-runtime har sin egen run-id,
 *     mens engine bruker scheduled_games.id. Caller kan ikke trigge
 *     start/resume mot agentGame1-routen med `currentGame.id` fra
 *     adapter-en.
 *   - Ingen ready-state per hall: plan-runtime API-et returnerer ikke
 *     hall-ready-status. Adapter-en mocker dette med `halls: []`.
 *   - Caller burde ALLTID hente legacy ready-status sideløpende (f.eks.
 *     `/api/agent/game1/hall-status`) i Fase 3 hvis hall-pillene skal
 *     rendres.
 */

import type {
  AgentGamePlanCurrentResponse,
  GamePlanRunStatus,
} from "./agent-game-plan.js";
import type {
  Spill1CurrentGameResponse,
  Spill1CurrentGame,
  Spill1CurrentGameHall,
} from "./agent-game1.js";

/**
 * Mapping fra plan-run-status til legacy game-status. Frontend-UI
 * skiller på "scheduled / purchase_open / ready_to_start / running /
 * paused / completed" — vi mapper plan-status til de mest passende
 * legacy-verdiene:
 *
 *   idle      → "scheduled"  (ikke startet enda)
 *   running   → "running"
 *   paused    → "paused"
 *   finished  → "completed"
 */
function mapStatus(status: GamePlanRunStatus): string {
  switch (status) {
    case "idle":
      return "scheduled";
    case "running":
      return "running";
    case "paused":
      return "paused";
    case "finished":
      return "completed";
  }
}

/**
 * Konverter plan-runtime-respons til legacy `Spill1CurrentGameResponse`.
 *
 * Returnerer null-shape hvis ingen plan dekker dagen (run==null +
 * plan==null). UI viser "Ingen kommende spill"-placeholder akkurat som
 * legacy-flyten gjør.
 */
export function adaptGamePlanToLegacyShape(
  resp: AgentGamePlanCurrentResponse,
): Spill1CurrentGameResponse {
  if (!resp.run || !resp.plan || !resp.currentItem) {
    return {
      hallId: resp.hallId,
      isMasterAgent: resp.isMaster,
      currentGame: null,
      halls: [],
      allReady: false,
    };
  }

  const item = resp.currentItem;
  const catalog = item.catalogEntry;

  const currentGame: Spill1CurrentGame = {
    id: resp.run.id,
    status: mapStatus(resp.run.status),
    masterHallId: resp.plan.hallId ?? resp.hallId,
    groupHallId: resp.plan.groupOfHallsId ?? "",
    participatingHallIds: resp.plan.hallId
      ? [resp.plan.hallId]
      : [resp.hallId],
    subGameName: catalog.displayName,
    customGameName: null,
    scheduledStartTime: resp.run.startedAt,
    scheduledEndTime: null,
    actualStartTime: resp.run.startedAt,
    actualEndTime: resp.run.finishedAt,
  };

  // Plan-runtime API-et returnerer ikke hall-ready-status. Caller må
  // hente dette separat fra `/api/agent/game1/hall-status`. Vi
  // returnerer her en placeholder med master-hallen så UI har minst
  // én rad å rendre. ready-state markeres som `false` så master-
  // konsoll-flyten forstår at status må sjekkes.
  const halls: Spill1CurrentGameHall[] = [
    {
      hallId: resp.hallId,
      hallName: resp.plan.name,
      isReady: false,
      readyAt: null,
      digitalTicketsSold: 0,
      physicalTicketsSold: 0,
      excludedFromGame: false,
      excludedReason: null,
    },
  ];

  return {
    hallId: resp.hallId,
    isMasterAgent: resp.isMaster,
    currentGame,
    halls,
    allReady: false,
  };
}
