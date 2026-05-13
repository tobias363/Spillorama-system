/**
 * Additional REST helpers for the Rad-vinst-flow E2E test
 * (`tests/e2e/spill1-rad-vinst-flow.spec.ts`, Tobias-direktiv 2026-05-13).
 *
 * Kept in a separate file so the existing `rest.ts` baseline remains intact
 * and the new test can import only what it needs. Public API:
 *
 *   - `masterPause(token, reason?)`     → REST `/api/agent/game1/master/pause`
 *   - `masterResume(token)`             → REST `/api/agent/game1/master/resume`
 *   - `masterAdvance(token)`            → REST `/api/agent/game1/master/advance`
 *   - `adminDrawNext(adminToken, code)` → REST `/api/admin/rooms/<code>/draw-next`
 *   - `getGameStateSnapshot(code)`      → GET  `/api/_dev/game-state-snapshot`
 *   - `resetPilotStateExt(token, opts)` → reset med `destroyRooms`-flag
 *
 * Rationale: extending `rest.ts` in-place konflikter med parallelle agent-
 * branches som omformer samme datatyper; helpers plasseres her isolert.
 */

import { autoLogin, masterStop } from "./rest.js";

const BACKEND_URL = process.env["E2E_BACKEND_URL"] ?? "http://localhost:4000";

/** Lokal kopi av master-action-respons-shape. */
export interface MasterActionResult {
  scheduledGameId: string;
  planRunId: string;
  status: string;
  scheduledGameStatus: string;
  inconsistencyWarnings: string[];
}

/**
 * Master pause via REST. Brukes til å verifisere at Fortsett-flyten (resume)
 * funker uten å avhenge av at engine auto-pauser etter Rad-vinst (demo-haller
 * har `is_test_hall=TRUE` som bypasser auto-pause).
 */
export async function masterPause(
  token: string,
  reason = "e2e-test pause",
): Promise<MasterActionResult> {
  const res = await fetch(`${BACKEND_URL}/api/agent/game1/master/pause`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`masterPause failed: HTTP ${res.status} ${text}`);
  }
  const json = (await res.json()) as {
    ok: boolean;
    data?: MasterActionResult;
    error?: { message?: string; code?: string };
  };
  if (!json.ok || !json.data) {
    throw new Error(`masterPause not OK: ${JSON.stringify(json.error)}`);
  }
  return json.data;
}

/**
 * Master Fortsett (resume) via REST. Tester at paused → running funker og
 * at samme scheduled-game preserveres (ingen ny spawnes).
 */
export async function masterResume(
  token: string,
): Promise<MasterActionResult> {
  const res = await fetch(`${BACKEND_URL}/api/agent/game1/master/resume`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`masterResume failed: HTTP ${res.status} ${text}`);
  }
  const json = (await res.json()) as {
    ok: boolean;
    data?: MasterActionResult;
    error?: { message?: string; code?: string };
  };
  if (!json.ok || !json.data) {
    throw new Error(`masterResume not OK: ${JSON.stringify(json.error)}`);
  }
  return json.data;
}

/**
 * Master Advance — flytt plan-run til NESTE posisjon (eks. `bingo` →
 * `kvikkis`). IKKE det samme som "Fortsett til neste rad" (resume).
 */
export async function masterAdvance(
  token: string,
): Promise<MasterActionResult> {
  const res = await fetch(`${BACKEND_URL}/api/agent/game1/master/advance`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`masterAdvance failed: HTTP ${res.status} ${text}`);
  }
  const json = (await res.json()) as {
    ok: boolean;
    data?: MasterActionResult;
    error?: { message?: string; code?: string };
  };
  if (!json.ok || !json.data) {
    throw new Error(`masterAdvance not OK: ${JSON.stringify(json.error)}`);
  }
  return json.data;
}

/**
 * Trekk neste kule via admin-endpoint. Akselererer test-progresjon ved å
 * skippe 4s auto-tick. Krever ADMIN-token.
 */
export async function adminDrawNext(
  adminToken: string,
  roomCode: string,
): Promise<{
  roomCode: string;
  number: number;
  drawIndex: number;
  gameId: string;
}> {
  const res = await fetch(
    `${BACKEND_URL}/api/admin/rooms/${encodeURIComponent(roomCode)}/draw-next`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`adminDrawNext failed: HTTP ${res.status} ${text}`);
  }
  const json = (await res.json()) as {
    ok: boolean;
    data?: {
      roomCode: string;
      number: number;
      drawIndex: number;
      gameId: string;
    };
    error?: { message?: string; code?: string };
  };
  if (!json.ok || !json.data) {
    throw new Error(`adminDrawNext not OK: ${JSON.stringify(json.error)}`);
  }
  return json.data;
}

/** Subset av snapshot-respons vi bruker i tester. */
export interface GameStateSnapshot {
  roomCode: string;
  engineRoom: {
    exists: boolean;
    currentGame: {
      id: string;
      status: string;
      drawnCount: number;
      drawnNumbers: number[];
      drawBagRemaining: number;
      endedReason: string | null;
      isPaused: boolean;
      pauseReason: string | null;
      claimsCount: number;
    } | null;
  } | null;
  scheduledGame: {
    id: string;
    status: string;
  } | null;
  gameState: {
    scheduledGameId: string;
    drawsCompleted: number;
    currentPhase: number;
    paused: boolean;
  } | null;
  socketRoomSize: number;
}

/**
 * Snapshot fra `/api/_dev/game-state-snapshot`. Krever
 * `RESET_TEST_PLAYERS_TOKEN` env-var satt på backend.
 *
 * Returnerer null hvis token ikke konfigurert eller request feiler — tester
 * kan da fall-back til andre informasjons-kilder (lobby, socket-events).
 */
export async function getGameStateSnapshot(
  roomCode: string,
  token?: string,
): Promise<GameStateSnapshot | null> {
  const devToken = token ?? process.env["RESET_TEST_PLAYERS_TOKEN"] ?? "";
  if (!devToken) return null;
  const res = await fetch(
    `${BACKEND_URL}/api/_dev/game-state-snapshot?roomCode=${encodeURIComponent(roomCode)}&token=${encodeURIComponent(devToken)}`,
  );
  if (!res.ok) return null;
  const json = (await res.json()) as Record<string, unknown>;
  if (typeof json === "object" && json !== null && "roomCode" in json) {
    return json as unknown as GameStateSnapshot;
  }
  return null;
}

/** Options for `resetPilotStateExt`. */
export interface ResetPilotStateOptions {
  destroyRooms?: boolean;
}

/**
 * Pilot-test-utvidet variant av `resetPilotState` med `destroyRooms`-flag.
 * Default: `destroyRooms: true`. Pass `{ destroyRooms: false }` for å skippe
 * nuke-steget — nyttig i tester som ikke vil rive ned rom.
 *
 * Wrapping istedenfor å erstatte original `resetPilotState` for å unngå
 * cross-branch conflicts.
 */
export async function resetPilotStateExt(
  masterToken: string,
  options: ResetPilotStateOptions = {},
): Promise<void> {
  const destroyRooms = options.destroyRooms ?? true;

  await masterStop(masterToken).catch(() => {
    /* ignore — no active round */
  });

  if (!destroyRooms) {
    return;
  }

  const admin = await autoLogin("tobias@nordicprofil.no").catch(() => null);
  if (admin) {
    const ROOMS_TO_NUKE = [
      "BINGO_DEMO-PILOT-GOH",
      "BINGO_DEMO-DEFAULT-GOH",
    ];
    for (const code of ROOMS_TO_NUKE) {
      await fetch(
        `${BACKEND_URL}/api/admin/rooms/${encodeURIComponent(code)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${admin.accessToken}` },
        },
      ).catch(() => {
        /* ignore — room might already be gone */
      });
    }
  }
}
