import type {
  ApiResult,
  PublicAppUser,
  GameDefinition,
  GameStatusInfo,
  HallDefinition,
  WalletAccount,
  Transaction,
  PlayerComplianceSnapshot,
} from "@spillorama/shared-types/api";
import type { RoomSnapshot, RoomSummary, Ticket } from "@spillorama/shared-types/game";

/**
 * 2026-05-02 (Tobias UX, PDF 17 wireframe side 5): Spill 2 Choose Tickets
 * pool-snapshot — 32 deterministisk forhåndsgenererte 3×3-brett per
 * (roomCode, playerId, gameId).
 */
export interface Game2ChooseTicketsSnapshot {
  roomCode: string;
  playerId: string;
  gameId: string;
  tickets: Ticket[];
  purchasedIndices: number[];
  pickAnyNumber: number | null;
}

const TOKEN_KEY = "spillorama.accessToken";

function getToken(): string {
  return sessionStorage.getItem(TOKEN_KEY) || "";
}

/**
 * Type-safe REST client for the Spillorama backend.
 *
 * Uses the web shell's authenticatedFetch when available (handles 401 token
 * refresh automatically). Falls back to direct fetch with Bearer token.
 */
export class SpilloramaApi {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  // ── Generic request ───────────────────────────────────────────────────

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<ApiResult<T>> {
    // Prefer web shell's authenticatedFetch (auto-refresh on 401).
    //
    // Pilot-bug 2026-05-04 (ChooseTickets fetch error): web-shellens
    // `window.SpilloramaAuth.authenticatedFetch` returnerer det INNER-
    // unwrappede `body.data`-objektet (`auth.js` linje 159-161), IKKE
    // en Response. Tidligere kode kalte `res.json()` på resultatet → kast
    // `TypeError: i.json is not a function` (synlig i bygget som
    // `Game2Controller-CT4xg2f7.js:719:132`). Resultat: ChooseTickets-
    // refresh feilet og popup-en sto tom (ingen brett, "Brett 0 / Beløp 0
    // kr"-state). Fix: detekterer Response vs. unwrapped data og
    // konstruerer ApiResult-konvolusjonen begge veier. Direkte fetch-
    // pathen (uten shell-auth) leverer fortsatt en ekte Response som
    // `.json()` plukker fra.
    const shellAuth = (window as unknown as Record<string, unknown>).SpilloramaAuth as
      | {
          authenticatedFetch?: (
            path: string,
            init?: RequestInit,
          ) => Promise<Response | unknown>;
        }
      | undefined;

    const init: RequestInit = {
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${getToken()}`,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    };

    if (shellAuth?.authenticatedFetch) {
      // Shell-auth path: 401-handling + token-refresh skjer inne i
      // `authenticatedFetch`. På success returnerer den allerede
      // `body.data` (unwrapped). På feil kaster den en Error med
      // forklarende melding. Vi konverterer til ApiResult-konvolusjon
      // slik at callers (ChooseTicketsScreen.refresh m.fl.) får én
      // konsistent shape uavhengig av hvilken pathen som ble valgt.
      try {
        const result = await shellAuth.authenticatedFetch(path, init);
        // Defensive: noen miljøer (eldre auth.js-versjoner under
        // bakoverkompatibilitet) kan likevel returnere en ekte Response.
        // Detekter ved å sjekke om `.json` er en funksjon.
        if (
          result &&
          typeof (result as { json?: unknown }).json === "function"
        ) {
          return (await (result as Response).json()) as ApiResult<T>;
        }
        // Allerede unwrapped data — pakk inn i ok:true-konvolusjon.
        return { ok: true, data: result as T };
      } catch (err) {
        // `authenticatedFetch` kaster ved 401-uten-refresh og ved
        // `body.ok === false`. Konverter til ApiError-shape så caller
        // ikke trenger try/catch i tillegg til ok-sjekk.
        const message =
          err instanceof Error ? err.message : "Ukjent nettverksfeil";
        return {
          ok: false,
          error: { code: "REQUEST_FAILED", message },
        };
      }
    }

    // Direct-fetch path (ingen shell-auth tilgjengelig). Behold gammel
    // oppførsel: forvent ApiResult-shape direkte fra serveren.
    const res = await fetch(`${this.baseUrl}${path}`, init);
    return (await res.json()) as ApiResult<T>;
  }

  private get<T>(path: string): Promise<ApiResult<T>> {
    return this.request("GET", path);
  }

  private post<T>(path: string, body?: unknown): Promise<ApiResult<T>> {
    return this.request("POST", path, body);
  }

  // ── Auth / Profile ────────────────────────────────────────────────────

  getProfile(): Promise<ApiResult<PublicAppUser>> {
    return this.get("/api/auth/me");
  }

  // ── Games ─────────────────────────────────────────────────────────────

  getGames(): Promise<ApiResult<GameDefinition[]>> {
    return this.get("/api/games");
  }

  getGameStatus(): Promise<ApiResult<Record<string, GameStatusInfo>>> {
    return this.get("/api/games/status");
  }

  // ── Halls ─────────────────────────────────────────────────────────────

  getHalls(): Promise<ApiResult<HallDefinition[]>> {
    return this.get("/api/halls");
  }

  // ── Rooms ─────────────────────────────────────────────────────────────

  getRooms(hallId?: string): Promise<ApiResult<RoomSummary[]>> {
    const query = hallId ? `?hallId=${encodeURIComponent(hallId)}` : "";
    return this.get(`/api/rooms${query}`);
  }

  getRoomSnapshot(roomCode: string): Promise<ApiResult<RoomSnapshot>> {
    return this.get(`/api/rooms/${encodeURIComponent(roomCode)}`);
  }

  // ── Wallet ────────────────────────────────────────────────────────────

  getWallet(): Promise<ApiResult<{ account: WalletAccount; transactions: Transaction[] }>> {
    return this.get("/api/wallet/me");
  }

  getCompliance(hallId?: string): Promise<ApiResult<PlayerComplianceSnapshot>> {
    const query = hallId ? `?hallId=${encodeURIComponent(hallId)}` : "";
    return this.get(`/api/wallet/me/compliance${query}`);
  }

  getTransactions(limit = 50): Promise<ApiResult<Transaction[]>> {
    return this.get(`/api/wallet/me/transactions?limit=${limit}`);
  }

  // ── Spill 2 Choose Tickets (PDF 17 wireframe side 5) ──────────────────

  getGame2ChooseTickets(roomCode: string): Promise<ApiResult<Game2ChooseTicketsSnapshot>> {
    return this.get(`/api/agent/game2/choose-tickets/${encodeURIComponent(roomCode)}`);
  }

  buyGame2ChooseTickets(
    roomCode: string,
    indices: number[],
    pickAnyNumber?: number | null,
  ): Promise<ApiResult<Game2ChooseTicketsSnapshot>> {
    const body: { indices: number[]; pickAnyNumber?: number | null } = { indices };
    if (pickAnyNumber !== undefined) body.pickAnyNumber = pickAnyNumber;
    return this.post(`/api/agent/game2/choose-tickets/${encodeURIComponent(roomCode)}/buy`, body);
  }
}
