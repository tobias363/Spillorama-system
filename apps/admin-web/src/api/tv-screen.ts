/**
 * Public TV Screen API — ingen auth-token, kun (hallId, tvToken) i URL.
 *
 * Endepunkter:
 *   GET /api/tv/:hallId/:tvToken/state     — current game state
 *   GET /api/tv/:hallId/:tvToken/winners   — last completed game winners
 *
 * Brukes av TVScreenPage/WinnersPage som er montert UTENFOR normal
 * auth-gate (se main.ts bootstrap-flyt for /#/tv/:hallId/:tvToken).
 */

export interface TvPatternRow {
  name: string;
  phase: number;
  playersWon: number;
  prize: number;
  highlighted: boolean;
}

export interface TvGameState {
  hall: { id: string; name: string };
  currentGame: {
    id: string;
    name: string;
    number: number;
    startAt: string;
    ballsDrawn: number[];
    lastBall: number | null;
  } | null;
  patterns: TvPatternRow[];
  /** Bølge 1: totalt antall trukne baller (legacy Ball_Drawn_Count_Txt). */
  drawnCount: number;
  /** Bølge 1: ballpool-størrelse, typisk 75 for Spill 1 / Kvikkis. */
  totalBalls: number;
  /** Bølge 1: "Neste spill"-sub-header — null hvis ingen planlagte. */
  nextGame: {
    name: string;
    startAt: string;
  } | null;
  countdownToNextGame: {
    nextGameName: string;
    secondsRemaining: number;
  } | null;
  status: "drawing" | "waiting" | "ended";
}

export interface TvWinnerRow {
  pattern: string;
  phase: number;
  playersWon: number;
  prizePerTicket: number;
  hallName: string;
}

export interface TvWinnersSummary {
  totalNumbersWithdrawn: number;
  fullHouseWinners: number;
  patternsWon: number;
  winners: TvWinnerRow[];
}

export class TvApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

/** Bygger URL for public TV-endpoint. Base er alltid samme origin som SPA. */
function tvUrl(hallId: string, tvToken: string, suffix: "state" | "winners"): string {
  const hid = encodeURIComponent(hallId);
  const tok = encodeURIComponent(tvToken);
  return `/api/tv/${hid}/${tok}/${suffix}`;
}

async function fetchTv<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    method: "GET",
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    const code = res.status === 404 ? "NOT_FOUND" : "HTTP_ERROR";
    throw new TvApiError(res.status, code, `TV endpoint returned ${res.status}`);
  }
  const body = (await res.json()) as { ok: boolean; data?: T; error?: { code: string } };
  if (!body.ok || !body.data) {
    throw new TvApiError(
      500,
      body.error?.code ?? "INVALID_RESPONSE",
      "TV endpoint returned non-ok body"
    );
  }
  return body.data;
}

export function fetchTvState(hallId: string, tvToken: string): Promise<TvGameState> {
  return fetchTv<TvGameState>(tvUrl(hallId, tvToken, "state"));
}

export function fetchTvWinners(hallId: string, tvToken: string): Promise<TvWinnersSummary> {
  return fetchTv<TvWinnersSummary>(tvUrl(hallId, tvToken, "winners"));
}
