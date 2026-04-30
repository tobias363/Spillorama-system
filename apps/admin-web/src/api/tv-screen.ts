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
  /**
   * Wireframe PDF 16 §16.5: "Hall Belongs To"-attribusjon. Tom array når
   * fasen ikke er vunnet ennå. Multi-hall-scenarier (group-of-halls) kan
   * inneholde flere hall-navn som rendres komma-separert i UI.
   */
  hallNames: string[];
}

/**
 * Task 1.7 (2026-04-24): farge-semantikk for deltakende haller på TV-stripe.
 * Matcher master-konsollens badge-koder (Appendix B.5 i audit-rapporten).
 */
export type TvHallColor = "red" | "orange" | "green";

export interface TvParticipatingHall {
  hallId: string;
  hallName: string;
  color: TvHallColor;
  playerCount: number;
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
  /**
   * Wireframe PDF 16 §16.5 (KPI-row på live TV-skjerm): antall Full
   * House-vinnere i pågående/siste runde. 0 hvis ingen har vunnet FH ennå.
   */
  fullHouseWinners: number;
  /**
   * Wireframe PDF 16 §16.5: antall pattern-rader vunnet totalt i
   * pågående/siste runde (sum playersWon over alle phases).
   */
  patternsWon: number;
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
  /**
   * Task 1.7 (2026-04-24): deltakende haller med fargekode + spillerantall.
   * Tom array når HS-PR ikke er merget (backend faller tilbake til tomt).
   * TV rendrer badge-stripe kun når lengde > 0.
   */
  participatingHalls: TvParticipatingHall[];
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
function tvUrl(
  hallId: string,
  tvToken: string,
  suffix: "state" | "winners" | "screen-saver"
): string {
  const hid = encodeURIComponent(hallId);
  const tok = encodeURIComponent(tvToken);
  return `/api/tv/${hid}/${tok}/${suffix}`;
}

async function fetchTv<T>(url: string, opts: { signal?: AbortSignal } = {}): Promise<T> {
  const init: RequestInit = {
    method: "GET",
    headers: { accept: "application/json" },
  };
  // FE-P0-003: thread the optional AbortSignal so the TV poller can
  // cancel a slow stale fetch when its instance is destroyed (e.g. the
  // operator navigates the popup window away from the TV-screen URL).
  if (opts.signal) init.signal = opts.signal;
  const res = await fetch(url, init);
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

export function fetchTvState(
  hallId: string,
  tvToken: string,
  opts: { signal?: AbortSignal } = {}
): Promise<TvGameState> {
  return fetchTv<TvGameState>(tvUrl(hallId, tvToken, "state"), opts);
}

export function fetchTvWinners(
  hallId: string,
  tvToken: string,
  opts: { signal?: AbortSignal } = {}
): Promise<TvWinnersSummary> {
  return fetchTv<TvWinnersSummary>(tvUrl(hallId, tvToken, "winners"), opts);
}

// ── Voice-pack (wireframe PDF 14) ───────────────────────────────────────────
//
// Public endpoint (ingen token-krav) — TV-klienten kaller det ved mount og
// etter `tv:voice-changed`-broadcast for å vite hvilken voice-pack som skal
// lastes. Responsen: `{ voice: 'voice1' | 'voice2' | 'voice3' }`.

export type TvVoice = "voice1" | "voice2" | "voice3";

export async function fetchTvVoice(hallId: string): Promise<TvVoice> {
  const res = await fetch(`/api/tv/${encodeURIComponent(hallId)}/voice`, {
    method: "GET",
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    const code = res.status === 404 ? "NOT_FOUND" : "HTTP_ERROR";
    throw new TvApiError(res.status, code, `TV voice endpoint returned ${res.status}`);
  }
  const body = (await res.json()) as { ok: boolean; data?: { voice?: string } };
  const voice = body.data?.voice;
  if (voice === "voice1" || voice === "voice2" || voice === "voice3") return voice;
  // Fail-safe fallback — TV skal alltid kunne spille noe.
  return "voice1";
}

// ── Screen Saver (Fase 1 MVP §24) ──────────────────────────────────────────
//
// TV-klienten poller dette endepunktet ved mount + periodisk for å vite om
// skjermsparer er aktivert + bilde-carousel for hallen. Fail-soft: ved feil
// returner enabled=false slik at hovedvisning fortsetter uavbrutt.

export interface TvScreenSaverImage {
  id: string;
  imageUrl: string;
  displaySeconds: number;
  displayOrder: number;
  isGlobal: boolean;
}

export interface TvScreenSaverConfig {
  enabled: boolean;
  timeoutMinutes: number;
  images: TvScreenSaverImage[];
}

export async function fetchTvScreenSaver(
  hallId: string,
  tvToken: string,
  opts: { signal?: AbortSignal } = {}
): Promise<TvScreenSaverConfig> {
  return fetchTv<TvScreenSaverConfig>(tvUrl(hallId, tvToken, "screen-saver"), opts);
}
