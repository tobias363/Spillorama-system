/**
 * Unified master-actions wrapper for Spill 1.
 *
 * Master-handlinger (Start/Resume/Pause) trigges fra to steder i UI-et:
 *   - apps/admin-web/src/pages/cash-inout/Spill1HallStatusBox.ts
 *   - apps/admin-web/src/pages/agent-portal/NextGamePanel.ts
 *
 * Begge steder kaller plan-API først (state-overgang i plan-runtime) og
 * deretter legacy/engine-API for faktisk trekning:
 *
 *   Start:  POST /api/agent/game-plan/start  → POST /api/agent/game1/start
 *   Resume: POST /api/agent/game-plan/resume → POST /api/agent/game1/resume
 *   Pause:  POST /api/agent/game-plan/pause  (engine-pause via room-code separat)
 *
 * Hvorfor to kall?
 * ----------------
 * Plan-runtime (`game-plan/start`) holder bok på hvilken posisjon i planen
 * som kjører. Bridgen oppretter `scheduled_games`-raden i 'ready_to_start'-
 * status. Men engine (`Game1MasterControlService.startGame`) er det som
 * faktisk overgår status til 'running' og starter trekning. Bro-mønsteret
 * lar oss innføre plan-runtime uten å rive opp engine.
 *
 * Idempotens:
 * -----------
 * Bridgen er idempotent på (plan_run_id, plan_position) — re-trigger
 * gir samme scheduled-game-id. Hvis legacy-call feiler etter at plan-call
 * lykkes, kan caller re-trigge hele actionen og bridgen vil gjenbruke raden.
 *
 * Feilhåndtering:
 * ---------------
 * Plan-call kan kaste:
 *   - JACKPOT_SETUP_REQUIRED → propager til UI for jackpot-popup
 *   - HALL_NOT_IN_GROUP → propager (admin-config-feil)
 *   - GAME_PLAN_RUN_INVALID_TRANSITION → tolereres (plan allerede i mål-
 *     status) og legacy-call fortsetter
 *   - GAME_PLAN_RUN_NOT_FOUND → tolereres for resume/pause (ingen aktiv
 *     plan-run for hallen — engine-call kjøres som vanlig)
 *
 * `bridgeError` i responsen = soft-fail i bridgen som IKKE blokkerer
 * plan-state-overgangen. Vi logger det og fortsetter med legacy-call.
 */

import {
  startAgentGamePlan,
  pauseAgentGamePlan,
  resumeAgentGamePlan,
} from "./agent-game-plan.js";
import {
  startAgentGame1,
  resumeAgentGame1,
  type Spill1ActionResponse,
} from "./agent-game1.js";
import { ApiError } from "./client.js";

/**
 * Start Spill 1. Kaller plan-API først for å spawn-e scheduled-game-raden
 * via bridgen, og deretter legacy-API for å faktisk starte engine.
 *
 * `confirmExcludedHalls` og `confirmUnreadyHalls` videresendes til
 * legacy-API (de er ikke en del av plan-runtime — plan-runtime forutsetter
 * at hallene allerede er på plass).
 */
export async function startSpill1MasterAction(
  confirmExcludedHalls?: string[],
  confirmUnreadyHalls?: string[],
): Promise<Spill1ActionResponse> {
  // Steg 1: Plan-runtime — opprett scheduled-game-rad via bridgen.
  // Hvis allerede startet (running/paused) returnerer routeren
  // INVALID_TRANSITION; vi tolker det som "fortsett til legacy-call"
  // siden brukeren sannsynligvis trykker Start på en allerede-startet
  // plan og ønsker engine-start.
  try {
    await startAgentGamePlan();
  } catch (err) {
    if (err instanceof ApiError && err.code === "GAME_PLAN_RUN_INVALID_TRANSITION") {
      // Plan er allerede running — det er OK, vi fortsetter til engine.
    } else {
      throw err;
    }
  }
  // Steg 2: Engine — finn scheduled-game via hallId og start trekning.
  return startAgentGame1(confirmExcludedHalls, confirmUnreadyHalls);
}

/**
 * Resume Spill 1. Plan-runtime resume er en ren state-overgang i plan-
 * tabellen (paused → running). Engine-resume er det faktiske trekningen
 * som starter igjen.
 *
 * Hvis plan-runtime ikke har en run i 'paused'-status (eks. plan-runtime
 * ikke i bruk for denne hallen), kveler vi `INVALID_TRANSITION` og kjører
 * kun engine-resume.
 */
export async function resumeSpill1MasterAction(): Promise<Spill1ActionResponse> {
  try {
    await resumeAgentGamePlan();
  } catch (err) {
    if (
      err instanceof ApiError &&
      (err.code === "GAME_PLAN_RUN_INVALID_TRANSITION" ||
        err.code === "GAME_PLAN_RUN_NOT_FOUND")
    ) {
      // Plan ikke i paused-state, eller ingen run — fall tilbake til engine.
    } else {
      throw err;
    }
  }
  return resumeAgentGame1();
}

/**
 * Pause Spill 1 via plan-runtime. Engine-pause går via room-code (separat
 * `pauseRoomGame(roomCode, reason)` — det er ikke noe `/api/agent/game1/pause`
 * endepunkt). Caller (NextGamePanel/Spill1HallStatusBox) er ansvarlig for
 * engine-pause-callet — denne wrapperen håndterer KUN plan-state-overgangen.
 *
 * Returnerer void så callsiten ser at plan-call ble forsøkt; faktisk
 * engine-pause må gjøres separat.
 */
export async function pauseSpill1MasterPlanState(): Promise<void> {
  try {
    await pauseAgentGamePlan();
  } catch (err) {
    if (
      err instanceof ApiError &&
      (err.code === "GAME_PLAN_RUN_INVALID_TRANSITION" ||
        err.code === "GAME_PLAN_RUN_NOT_FOUND")
    ) {
      // Plan ikke i running-state, eller ingen run — engine-pause er
      // fortsatt gyldig, så vi swallow-er feilen.
      return;
    }
    throw err;
  }
}
