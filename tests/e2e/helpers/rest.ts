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

export interface ResetPilotStateOptions {
  /**
   * Tobias-direktiv 2026-05-13: Tester deler samme DB som Tobias' manuelle
   * dev-stack. For å unngå å ødelegge en pågående manual-sesjon er DEFAULT
   * non-destructive — `destroyRooms: false`.
   *
   * Når `destroyRooms: true`:
   *   - Master action stopper pågående runde
   *   - Admin destruerer GoH-rommet (player-slots evicted, fresh state)
   *   - Brukes i CI eller dedikerte "fresh-baseline"-tester
   *
   * Når `destroyRooms: false` (DEFAULT):
   *   - Master action stopper pågående runde (idempotent)
   *   - GoH-rom BEHOLDES — player-slots forblir, vinner-state intakt
   *   - Safe å kjøre mens Tobias tester manuelt
   *
   * Se docs/engineering/PILOT_TEST_FLOW_AND_KNOWLEDGE_PROTOCOL.md §5.2.
   */
  destroyRooms?: boolean;
}

/**
 * Reset pilot state via direct REST calls. Default `destroyRooms: false`
 * gjør funksjonen SAFE å kjøre parallelt med Tobias' manuelle test —
 * eneste side-effekt er at evt. pågående master-runde stoppes.
 *
 * For å garantere fresh baseline (eks. i CI), pass `{destroyRooms: true}`.
 * Da destrueres GoH-rommet via admin-API og alle player-slots evictes.
 *
 * Etter `masterStop` ligger spilleren fortsatt i GoH-rommet (engine fjerner
 * ikke player-slot ved game-end — det er regulatorisk korrekt for at vinnere
 * skal se resultatet). I non-destructive mode er det OK — testen er
 * idempotent og `markHallReady` returnerer eksisterende game eller spawner ny.
 */
export async function resetPilotState(
  masterToken: string,
  options: ResetPilotStateOptions = {},
): Promise<void> {
  const { destroyRooms = false } = options;

  // 1. Stop master action (idempotent).
  await masterStop(masterToken).catch(() => {
    /* ignore — no active round */
  });

  // 2. Hvis destroyRooms: destruér GoH-rommet for fresh state.
  //    Default false så vi ikke ødelegger Tobias' manual-sesjon (samme DB).
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
