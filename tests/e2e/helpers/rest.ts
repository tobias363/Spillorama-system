/**
 * REST helpers for pilot-flow E2E tests.
 *
 * Encapsulates dev auto-login, master actions and lobby-state checks
 * so each test stays focused on the UI assertions it cares about.
 *
 * All helpers throw on non-OK responses — tests should let those bubble
 * up and fail loudly rather than silently retrying.
 */

const BACKEND_URL = process.env.E2E_BACKEND_URL ?? "http://localhost:4000";

export interface AutoLoginResult {
  accessToken: string;
  userId: string;
  email: string;
  hallId: string | null;
  role: string;
  walletBalance: number;
}

export async function autoLogin(email: string): Promise<AutoLoginResult> {
  const res = await fetch(
    `${BACKEND_URL}/api/dev/auto-login?email=${encodeURIComponent(email)}`,
  );
  if (!res.ok) {
    throw new Error(`auto-login failed for ${email}: HTTP ${res.status}`);
  }
  const json = (await res.json()) as {
    ok: boolean;
    data?: {
      accessToken: string;
      user: {
        id: string;
        email: string;
        hallId: string | null;
        role: string;
        balance: number;
      };
    };
    error?: { message?: string };
  };
  if (!json.ok || !json.data) {
    throw new Error(
      `auto-login response not OK for ${email}: ${JSON.stringify(json.error)}`,
    );
  }
  return {
    accessToken: json.data.accessToken,
    userId: json.data.user.id,
    email: json.data.user.email,
    hallId: json.data.user.hallId,
    role: json.data.user.role,
    walletBalance: json.data.user.balance,
  };
}

export interface LobbyState {
  hallId: string;
  currentScheduledGameId: string | null;
  planMeta: {
    catalogSlug: string;
    catalogDisplayName: string;
    planRunStatus: string;
  } | null;
  scheduledGameMeta: {
    status: string;
    actualStartTime: string | null;
    actualEndTime: string | null;
  } | null;
  halls: Array<{
    hallId: string;
    isReady: boolean;
    isMaster: boolean;
  }>;
}

export async function getLobbyState(
  token: string,
  hallId: string,
): Promise<LobbyState> {
  const res = await fetch(
    `${BACKEND_URL}/api/agent/game1/lobby?hallId=${encodeURIComponent(hallId)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!res.ok) {
    throw new Error(`getLobbyState failed: HTTP ${res.status}`);
  }
  const json = (await res.json()) as {
    ok: boolean;
    data: LobbyState;
    error?: { message?: string };
  };
  if (!json.ok) {
    throw new Error(`getLobbyState response not OK: ${JSON.stringify(json.error)}`);
  }
  return json.data;
}

export async function markHallReady(
  token: string,
  hallId: string,
): Promise<{ gameId: string; allReady: boolean }> {
  const res = await fetch(
    `${BACKEND_URL}/api/admin/game1/halls/${encodeURIComponent(hallId)}/ready`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`markHallReady failed: HTTP ${res.status} ${text}`);
  }
  const json = (await res.json()) as {
    ok: boolean;
    data?: { gameId: string; allReady: boolean };
    error?: { message?: string; code?: string };
  };
  if (!json.ok || !json.data) {
    throw new Error(`markHallReady not OK: ${JSON.stringify(json.error)}`);
  }
  return { gameId: json.data.gameId, allReady: json.data.allReady };
}

export interface MasterStartResult {
  scheduledGameId: string;
  planRunId: string;
  status: string;
  scheduledGameStatus: string;
  inconsistencyWarnings: string[];
}

export async function masterStart(token: string): Promise<MasterStartResult> {
  const res = await fetch(`${BACKEND_URL}/api/agent/game1/master/start`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`masterStart failed: HTTP ${res.status} ${text}`);
  }
  const json = (await res.json()) as {
    ok: boolean;
    data?: MasterStartResult;
    error?: { message?: string; code?: string };
  };
  if (!json.ok || !json.data) {
    throw new Error(`masterStart not OK: ${JSON.stringify(json.error)}`);
  }
  return json.data;
}

export async function openPurchaseWindow(token: string): Promise<MasterStartResult> {
  const result = await masterStart(token);
  if (result.scheduledGameStatus !== "purchase_open") {
    throw new Error(
      `openPurchaseWindow expected purchase_open, got ${result.scheduledGameStatus}`,
    );
  }
  return result;
}

export async function masterStop(
  token: string,
  reason = "e2e-test cleanup",
): Promise<void> {
  const res = await fetch(`${BACKEND_URL}/api/agent/game1/master/stop`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ reason }),
  });
  // Stop kan fail med "no active game" — det er fint for cleanup.
  if (!res.ok && res.status !== 400) {
    throw new Error(`masterStop failed: HTTP ${res.status}`);
  }
}

/**
 * Returns `true` when CI-mode is signaled via env. Reads
 * `E2E_DESTROY_ROOMS=1` (accepts "1", "true", "yes"). Used by the CI
 * workflow `.github/workflows/pilot-flow-e2e.yml` to make the room-destroy
 * decision explicit. Locally the test always destroys rooms anyway
 * (default behavior of `resetPilotState`); the env-var is a knob to opt
 * OUT of destroy when debugging if you want to keep state between runs.
 */
export function shouldDestroyRoomsForCi(): boolean {
  const raw = (process.env.E2E_DESTROY_ROOMS ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export interface ResetPilotStateOptions {
  /**
   * When `true` (default), destroys the master-GoH room via admin-API after
   * stopping the running game. Required when re-running the test repeatedly
   * because the engine keeps player-slots after game-end (regulatorisk for at
   * vinnere skal se resultatet) — uten cleanup feiler neste `room:join`
   * med `PLAYER_ALREADY_IN_ROOM`.
   *
   * Pass `destroyRooms: false` (or set `E2E_DESTROY_ROOMS=0` in env) to
   * skip the destroy — useful when iterating on a single test invocation
   * and you want to inspect post-test state. Default `true` keeps the
   * common-case loop fast and repeatable.
   */
  destroyRooms?: boolean;
}

const E2E_MASTER_HALL_ID = "demo-hall-001";
const APP_BUSINESS_TIME_ZONE = "Europe/Oslo";

function getAppBusinessDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function getSafeE2eDbConfig():
  | { connectionString: string; schema: string }
  | null {
  const connectionString =
    process.env.APP_PG_CONNECTION_STRING ??
    process.env.WALLET_PG_CONNECTION_STRING ??
    "";
  if (!connectionString) return null;

  const isCi = (process.env.CI ?? "").toLowerCase() === "true";
  const allowLocal = (process.env.E2E_RESET_PLAN_RUN ?? "").trim() === "1";
  if (!isCi && !allowLocal) return null;

  if (!/(localhost|127\.0\.0\.1|\[::1\])/.test(connectionString)) {
    throw new Error(
      "E2E plan-run reset refused: DB connection string is not local.",
    );
  }

  const rawSchema = process.env.APP_PG_SCHEMA ?? "public";
  const schema = /^[A-Za-z_][A-Za-z0-9_]*$/.test(rawSchema)
    ? rawSchema
    : "public";
  return { connectionString, schema };
}

/**
 * CI-only deterministic cleanup for the stateful pilot-flow suite.
 *
 * `masterStop` is correct production behavior: it finishes today's plan-run
 * so the next real master action advances to the next catalog position. The
 * Playwright suite is different: every spec asserts the Bingo purchase UI and
 * must start from position 1 in a fresh local test database. This helper is
 * therefore guarded to localhost + CI (or explicit E2E_RESET_PLAN_RUN=1).
 */
export async function resetPilotPlanRunForE2e(): Promise<void> {
  const config = getSafeE2eDbConfig();
  if (!config) return;

  const businessDate = getAppBusinessDate();

  const { Client } = await import("pg");
  const client = new Client({ connectionString: config.connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE "${config.schema}"."app_game1_scheduled_games"
          SET status = 'cancelled',
              actual_end_time = COALESCE(actual_end_time, now()),
              stop_reason = COALESCE(stop_reason, 'e2e_reset_plan_run'),
              updated_at = now()
       WHERE master_hall_id = $1
         AND scheduled_day = $2::date
         AND status IN ('scheduled','purchase_open','ready_to_start','running','paused')`,
      [E2E_MASTER_HALL_ID, businessDate],
    );
    await client.query(
      `DELETE FROM "${config.schema}"."app_game_plan_run"
       WHERE hall_id = $1
         AND business_date = $2::date`,
      [E2E_MASTER_HALL_ID, businessDate],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
      /* ignore rollback failure */
    });
    throw err;
  } finally {
    await client.end().catch(() => {
      /* ignore disconnect failure */
    });
  }
}

/**
 * Hard-reset pilot state via direct REST calls. Brukes i `beforeAll` for å
 * sikre at hver test starter med en fersh scheduled-game. Hvis et eldre
 * spill fortsatt kjører, prøver vi å stoppe det først.
 *
 * Etter `masterStop` ligger spilleren fortsatt i GoH-rommet (engine fjerner
 * ikke player-slot ved game-end — det er regulatorisk korrekt for at vinnere
 * skal se resultatet). Det fører til `PLAYER_ALREADY_IN_ROOM` ved neste join.
 * For å garantere fresh state destrueres GoH-rommet via admin-API.
 *
 * Default: `destroyRooms: true`. Eksplisitt `false` (eller `E2E_DESTROY_ROOMS=0`
 * i env) skipper destroy-steget — nyttig for debug-iterasjon.
 */
export async function resetPilotState(
  masterToken: string,
  options: ResetPilotStateOptions = {},
): Promise<void> {
  // 1. Stop master action.
  await masterStop(masterToken).catch(() => {
    /* ignore — no active round */
  });
  await resetPilotPlanRunForE2e();

  // Default `true` så tester er repeterbare uten manuell SQL-cleanup.
  // Env-var `E2E_DESTROY_ROOMS=0` kan overstyre for debug-iterasjon (CI
  // setter `E2E_DESTROY_ROOMS=1` for å gjøre intent eksplisitt).
  const destroyRooms = (() => {
    if (options.destroyRooms !== undefined) return options.destroyRooms;
    const raw = (process.env.E2E_DESTROY_ROOMS ?? "").trim().toLowerCase();
    if (raw === "0" || raw === "false" || raw === "no") return false;
    return true;
  })();

  if (!destroyRooms) {
    return;
  }

  // 2. Auto-login admin og destruér master-GoH-rommet så ingen player-slots
  //    henger igjen mellom tester.
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

/**
 * Pilot-tester gjør mange kjøp som over tid akkumulerer mot daglig/månedlig
 * tapsgrense. For å sikre fersh state setter vi grensene høyt for test-
 * spillere via admin-endpoint. ADMIN-only endepunkt — krever ADMIN-token.
 */
export async function raisePlayerLossLimits(
  walletId: string,
  hallId: string,
  dailyLimit = 100_000,
  monthlyLimit = 500_000,
): Promise<void> {
  const admin = await autoLogin("tobias@nordicprofil.no");
  await fetch(
    `${BACKEND_URL}/api/admin/wallets/${encodeURIComponent(walletId)}/loss-limits`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${admin.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        hallId,
        dailyLossLimit: dailyLimit,
        monthlyLossLimit: monthlyLimit,
      }),
    },
  );
}

export interface TicketPurchaseRow {
  ticketColor: string;
  ticketType: string;
  priceCents: number;
  count: number;
}

/**
 * Spør backend direkte om hvilke ticket-purchases som er registrert for et
 * scheduled-game. Brukes til å verifisere at klient-kjøpet faktisk traff
 * databasen med riktige beløp.
 *
 * Endepunktet finnes ikke nødvendigvis i prod (vi får 404), så testen må
 * skippe verification i det tilfellet.
 */
export async function fetchPurchasesForGame(
  token: string,
  scheduledGameId: string,
): Promise<TicketPurchaseRow[] | null> {
  const res = await fetch(
    `${BACKEND_URL}/api/_dev/spill1/scheduled-game/${encodeURIComponent(scheduledGameId)}/purchases`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`fetchPurchasesForGame failed: HTTP ${res.status}`);
  }
  const json = (await res.json()) as {
    ok: boolean;
    data?: { rows: TicketPurchaseRow[] };
  };
  if (!json.ok || !json.data) return null;
  return json.data.rows;
}
