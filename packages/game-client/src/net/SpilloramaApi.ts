import type {
  ApiResult,
  PublicAppUser,
  GameDefinition,
  GameStatusInfo,
  HallDefinition,
  WalletAccount,
  Transaction,
  PlayerComplianceSnapshot,
  Spill1LobbyState,
} from "@spillorama/shared-types/api";
import type { RoomSnapshot, RoomSummary } from "@spillorama/shared-types/game";

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
    // Pilot-bug 2026-05-04: web-shellens
    // `window.SpilloramaAuth.authenticatedFetch` returnerer det INNER-
    // unwrappede `body.data`-objektet (`auth.js` linje 159-161), IKKE
    // en Response. Tidligere kode kalte `res.json()` på resultatet → kast
    // `TypeError: i.json is not a function`. Fix: detekterer Response vs.
    // unwrapped data og konstruerer ApiResult-konvolusjonen begge veier.
    // Direkte fetch-pathen (uten shell-auth) leverer fortsatt en ekte
    // Response som `.json()` plukker fra.
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
      // slik at callers får én konsistent shape uavhengig av hvilken
      // pathen som ble valgt.
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
        // `authenticatedFetch` kaster ved 401-uten-refresh, 429-rate-limit
        // og ved `body.ok === false`. Konverter til ApiError-shape så caller
        // ikke trenger try/catch i tillegg til ok-sjekk.
        //
        // 2026-05-11 Tobias-direktiv: 429-feilen er allerede sanitized i
        // auth.js (ingen sekund-countdown), men vi propagerer `RATE_LIMITED`-
        // koden så callers kan skille rate-limit fra andre transientfeil og
        // gjøre auto-backoff i stedet for å vise "Prøv igjen"-knapp.
        const rateLimited =
          err && typeof err === "object" && (err as { isRateLimited?: boolean }).isRateLimited === true;
        const message =
          err instanceof Error ? err.message : "Ukjent nettverksfeil";
        return {
          ok: false,
          error: {
            code: rateLimited ? "RATE_LIMITED" : "REQUEST_FAILED",
            message,
          },
        };
      }
    }

    // Direct-fetch path (ingen shell-auth tilgjengelig). Behold gammel
    // oppførsel: forvent ApiResult-shape direkte fra serveren — men
    // sanitiser 429 så ingen sekund-countdown fra backend bubble-er til UI.
    const res = await fetch(`${this.baseUrl}${path}`, init);
    if (res.status === 429) {
      return {
        ok: false,
        error: {
          code: "RATE_LIMITED",
          message: "Spillet er midlertidig utilgjengelig. Vi prøver igjen automatisk.",
        },
      };
    }
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

  /**
   * Hent Spill 1 lobby-state for en hall (2026-05-08, Tobias-direktiv).
   *
   * Returnerer åpningstid, neste planlagte spill, og engine-status hvis
   * runden er spawnet. Klient bruker `overallStatus` til å bestemme om
   * rommet skal vises som åpent, vise bong-kjøp, eller bytte til runde-
   * modus. Polling hver 10s anbefales — endepunktet sender
   * `Cache-Control: no-store`.
   */
  getSpill1Lobby(hallId: string): Promise<ApiResult<Spill1LobbyState>> {
    return this.get(`/api/games/spill1/lobby?hallId=${encodeURIComponent(hallId)}`);
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
}
