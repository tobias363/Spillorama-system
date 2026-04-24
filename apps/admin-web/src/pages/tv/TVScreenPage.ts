/**
 * TV Screen — public full-screen hall-display.
 *
 * Viser pattern-tabell, siste trukne tall (stor sirkel) + siste 5 baller,
 * countdown til neste spill og voice-valg. Polling mot
 * /api/tv/:hallId/:tvToken/state hvert 2 sekund. Hvis status === "ended" i
 * state, bytter vi automatisk til winners-side i 30 sekunder.
 *
 * Legacy-spec: Admin V1.0 Game 1 - 24.3.2023 s.17.
 * Bølge 1-paritet (2026-04-23): drawn-counter (X / Y), aktivt pattern-
 * banner (Patterns_Txt) og current/next-game sub-header
 * (Current_Game_Name_Txt + Next_Game_Name_Txt fra BingoHallDisplay.cs).
 *
 * Voice-valg (wireframe PDF 14, 2026-04-24): hentes fra backend ved mount
 * (`GET /api/tv/:hallId/voice`) og refreshes på `tv:voice-changed`-event
 * som broadcasts av admin via `hall:<id>:display`-rommet. TV-klienten
 * spiller ball-utrop fra `/assets/tv-voices/<voice>/<ball>.mp3` (filene
 * finnes ikke i repo ennå — se README for manglende assets).
 */

import "./tv-screen.css";
import { io, type Socket } from "socket.io-client";
import {
  fetchTvState,
  fetchTvVoice,
  type TvGameState,
  type TvVoice,
} from "../../api/tv-screen.js";

const POLL_INTERVAL_MS = 2000;
const WINNERS_SWITCH_DELAY_MS = 30_000;
const VOICE_OPTIONS: ReadonlyArray<{ value: TvVoice; label: string }> = [
  { value: "voice1", label: "Voice 1" },
  { value: "voice2", label: "Voice 2" },
  { value: "voice3", label: "Voice 3" },
];

interface ActiveInstance {
  hallId: string;
  tvToken: string;
  intervalId: number;
  switchTimeoutId: number | null;
  previousStatus: TvGameState["status"] | null;
  destroyed: boolean;
  /** Aktiv voice-pack — set når fetchTvVoice resolverer eller endret av socket-event. */
  voice: TvVoice;
  /** Cache med pre-lastede Audio-objekter, keyed på ball-nummer (1..75). */
  audioCache: Map<number, HTMLAudioElement>;
  /** Optional socket for live voice-updates. Hvis connect feiler, fall-back til polling. */
  socket: Socket | null;
}

let active: ActiveInstance | null = null;

/** Mount TV-screen. Caller skal garantere at root er tomt. */
export function mountTvScreenPage(root: HTMLElement, hallId: string, tvToken: string): void {
  unmountTvScreenPage();
  root.innerHTML = `
    <div class="tv-host" data-testid="tv-screen-host">
      <div class="tv-header">SPILL-O-RAMA BINGO</div>
      <div class="tv-subheader" id="tv-subheader" data-testid="tv-subheader"></div>
      <div class="tv-voice-select">
        <label for="tv-voice">Voice:</label>
        <select id="tv-voice" data-testid="tv-voice-select" disabled>
          ${VOICE_OPTIONS.map(
            (o) => `<option value="${o.value}">${o.label}</option>`
          ).join("")}
        </select>
        <span class="tv-voice-note" data-testid="tv-voice-note">Stemme styres av admin</span>
      </div>
      <div id="tv-body" class="tv-loading">Laster...</div>
    </div>
  `;

  const bodyEl = root.querySelector<HTMLElement>("#tv-body")!;
  const subHeaderEl = root.querySelector<HTMLElement>("#tv-subheader")!;
  const voiceSelect = root.querySelector<HTMLSelectElement>("#tv-voice");

  const instance: ActiveInstance = {
    hallId,
    tvToken,
    intervalId: 0,
    switchTimeoutId: null,
    previousStatus: null,
    destroyed: false,
    voice: "voice1",
    audioCache: new Map(),
    socket: null,
  };
  active = instance;

  // Fetch initial voice config + seed audio cache. Fail-safe: fallback til
  // voice1 hvis endepunktet er nede, TV må alltid kunne spille noe.
  void (async () => {
    try {
      const voice = await fetchTvVoice(hallId);
      if (instance.destroyed) return;
      applyVoice(instance, voice, voiceSelect);
    } catch {
      if (instance.destroyed) return;
      applyVoice(instance, "voice1", voiceSelect);
    }
  })();

  // Socket subscription for live voice-updates. Admin-siden emitter
  // `tv:voice-changed` til hall:<id>:display når operatoren endrer stemme;
  // vi joiner dét rommet via `admin-display:login` + `admin-display:subscribe`
  // hvis tvToken også er gyldig som display-token. Hvis login feiler (token
  // er TV-URL-token, ikke display-token), fall vi tilbake til socket-løs
  // modus — voice-endringer blir da bare synlig ved page-reload eller på
  // neste poll av /voice-endepunktet.
  try {
    const socket = io(window.location.origin, {
      transports: ["websocket", "polling"],
      reconnection: true,
    });
    instance.socket = socket;
    socket.on("tv:voice-changed", (payload: { hallId?: string; voice?: string }) => {
      if (instance.destroyed) return;
      if (!payload || payload.hallId !== hallId) return;
      const v = payload.voice;
      if (v !== "voice1" && v !== "voice2" && v !== "voice3") return;
      applyVoice(instance, v, voiceSelect);
    });
    socket.on("connect", () => {
      // Forsøk subscribe via tvToken som display-token. Feil ignoreres —
      // vi kan fortsatt motta rom-bredde events via polling fallback.
      socket.emit("admin-display:login", { token: tvToken }, (_resp: unknown) => {
        socket.emit("admin-display:subscribe", { hallId }, () => {});
      });
    });
  } catch {
    // socket.io-client finnes kanskje ikke i test-miljø — fortsett uten live-oppdatering.
  }

  const tick = async (): Promise<void> => {
    if (instance.destroyed) return;
    try {
      const state = await fetchTvState(hallId, tvToken);
      if (instance.destroyed) return;
      renderSubHeader(subHeaderEl, state);
      renderState(bodyEl, state);
      // Hvis vi har en ny ball (lastBall endret), spill voice-utropet.
      if (state.currentGame?.lastBall != null) {
        playBallAudio(instance, state.currentGame.lastBall);
      }
      // Auto-switch til winners-siden når siste game er ended. Hopper bare én
      // gang per transition (guard på previousStatus) så vi ikke starter
      // nye timers før vi har vært tilbake til drawing/waiting.
      if (state.status === "ended" && instance.previousStatus !== "ended") {
        scheduleWinnersSwitch(instance);
      }
      instance.previousStatus = state.status;
    } catch (err) {
      if (instance.destroyed) return;
      renderError(bodyEl, err);
    }
  };

  // Start immediate + interval.
  void tick();
  instance.intervalId = window.setInterval(() => void tick(), POLL_INTERVAL_MS);
}

export function unmountTvScreenPage(): void {
  if (!active) return;
  active.destroyed = true;
  if (active.intervalId) window.clearInterval(active.intervalId);
  if (active.switchTimeoutId) window.clearTimeout(active.switchTimeoutId);
  if (active.socket) {
    try { active.socket.disconnect(); } catch { /* no-op */ }
  }
  active.audioCache.clear();
  active = null;
}

/** Last ned + cache en <audio> for hver ball i valgt voice-pack. */
function applyVoice(instance: ActiveInstance, voice: TvVoice, select: HTMLSelectElement | null): void {
  instance.voice = voice;
  instance.audioCache.clear();
  if (select) select.value = voice;
}

/**
 * Spill av ball-utrop for en gitt ball. Lat-laster Audio-elementet ved
 * første forespørsel og cacher det så re-draws (samme ball) ikke trigger
 * nytt nettverksrundtur. Feil ignoreres — TV-rendering skal ikke blokkeres
 * av manglende audio-filer (som i dag; se README).
 */
let lastPlayedBall: { ball: number; hallId: string } | null = null;
function playBallAudio(instance: ActiveInstance, ball: number): void {
  // Dedup: samme ball to ganger på rad spilles ikke igjen (polling kan
  // returnere samme lastBall over flere ticks).
  if (lastPlayedBall && lastPlayedBall.ball === ball && lastPlayedBall.hallId === instance.hallId) {
    return;
  }
  lastPlayedBall = { ball, hallId: instance.hallId };
  try {
    let audio = instance.audioCache.get(ball);
    if (!audio) {
      // Filene serveres statisk av backend: apps/backend/public/tv-voices/
      // (`app.use(express.static(publicDir))` plukker dem opp). De er ikke
      // sjekket inn i repo ennå — se README i voice-kat. for manglende
      // assets; TV-rendering skal ikke blokkeres av fravær.
      audio = new Audio(`/tv-voices/${instance.voice}/${ball}.mp3`);
      audio.preload = "auto";
      instance.audioCache.set(ball, audio);
    }
    audio.currentTime = 0;
    void audio.play().catch(() => { /* Audio-fil mangler — ignorer. */ });
  } catch {
    // AudioContext-feil i gamle nettlesere — ignorer.
  }
}

// ── Rendering ──────────────────────────────────────────────────────────

function renderState(target: HTMLElement, state: TvGameState): void {
  // Alltid rendre Bølge 1-layoutet (pattern-tabell, drawn-counter, pattern-
  // banner). Empty-state vises med 0-verdier + "Venter på spill"-banner
  // istedenfor å erstatte hele skjermen med en tom melding. Dette speiler
  // legacy BingoHallDisplay.cs som viser layouten kontinuerlig og kun
  // bytter dataene som oppdateres.
  const game = state.currentGame;
  const activePatternName = findActivePatternName(state);
  const isEmptyState = !game && state.status === "waiting";

  target.className = "tv-screen-body";
  target.innerHTML = `
    <section class="tv-screen-left">
      <table class="tv-patterns-table">
        <thead>
          <tr>
            <th>Pattern</th>
            <th>Players Won</th>
            <th>Prize</th>
          </tr>
        </thead>
        <tbody>
          ${state.patterns
            .map(
              (p) => `
            <tr class="${p.highlighted ? "highlighted" : ""}" data-testid="tv-pattern-row">
              <td>${escapeHtml(p.name)}</td>
              <td>${p.playersWon}</td>
              <td>${formatPrize(p.prize)}</td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>
    </section>
    <section class="tv-screen-right">
      <div class="tv-game-header">
        <div class="tv-game-title" data-testid="tv-game-title">
          ${game ? `Game ${game.number} - ${escapeHtml(game.name)}` : "Venter på spill"}
        </div>
        <div class="tv-drawn-counter" data-testid="tv-drawn-counter">
          <span class="tv-drawn-counter-label">Trukket</span>
          <span class="tv-drawn-counter-value">
            <strong data-testid="tv-drawn-count">${state.drawnCount}</strong>
            <span class="tv-drawn-counter-sep"> / </span>
            <span data-testid="tv-total-balls">${state.totalBalls}</span>
          </span>
        </div>
      </div>
      <div class="tv-last-ball-circle" data-testid="tv-last-ball">
        ${game?.lastBall != null ? String(game.lastBall) : "--"}
      </div>
      <div class="tv-last-5">
        ${lastFiveBallsHtml(game?.ballsDrawn ?? [])}
      </div>
      ${renderActivePatternBanner(activePatternName)}
      ${isEmptyState ? `<div class="tv-waiting-notice" data-testid="tv-waiting-notice">Venter på neste spill...</div>` : renderCountdown(state)}
    </section>
  `;
}

/**
 * Bølge 1: sub-header under "SPILL-O-RAMA BINGO" med current/next-game.
 * Legacy ref: Current_Game_Name_Txt + Next_Game_Name_Txt i
 * BingoHallDisplay.cs. Rendres alltid — skjules automatisk hvis begge er
 * null (via CSS empty-state).
 */
function renderSubHeader(target: HTMLElement, state: TvGameState): void {
  const lines: string[] = [];
  if (state.currentGame) {
    lines.push(`
      <div class="tv-subheader-line" data-testid="tv-subheader-current">
        <span class="tv-subheader-label">Spiller nå:</span>
        <span class="tv-subheader-value">${escapeHtml(state.currentGame.name)}</span>
      </div>
    `);
  }
  if (state.nextGame) {
    lines.push(`
      <div class="tv-subheader-line" data-testid="tv-subheader-next">
        <span class="tv-subheader-label">Neste:</span>
        <span class="tv-subheader-value">
          ${escapeHtml(state.nextGame.name)} kl. ${escapeHtml(formatTimeHHMM(state.nextGame.startAt))}
        </span>
      </div>
    `);
  }
  target.innerHTML = lines.join("");
}

/**
 * Bølge 1: finn aktivt (pågående) pattern-navn. Regelen per oppgaven:
 * første pattern med playersWon === 0 (ikke vunnet ennå). Hvis alle er
 * won/ingen finnes, bruker vi tredje-prioritets fallback: siste
 * highlighted pattern. Returner null hvis listen er tom.
 */
function findActivePatternName(state: TvGameState): string | null {
  const pending = state.patterns.find((p) => p.playersWon === 0);
  if (pending) return pending.name;
  // Alle vunnet — vis siste fase (Fullt Hus / Full House).
  const last = state.patterns[state.patterns.length - 1];
  return last?.name ?? null;
}

/**
 * Bølge 1: stor banner mellom ball-raden og countdown som viser hvilket
 * pattern som spilles nå (pulse-animasjon ved pattern-endring — se CSS
 * `tv-active-pattern-pulse`). Legacy ref: AdminTVScreenWinners.Patterns_Txt
 * viste navn under ball-raden som midtpunkt på TVen.
 */
function renderActivePatternBanner(name: string | null): string {
  if (!name) return "";
  return `
    <div class="tv-active-pattern" data-testid="tv-active-pattern">
      <span class="tv-active-pattern-label">Aktivt mønster</span>
      <span class="tv-active-pattern-name" data-testid="tv-active-pattern-name">
        ${escapeHtml(name)}
      </span>
    </div>
  `;
}

function renderCountdown(state: TvGameState): string {
  if (!state.countdownToNextGame) return "";
  const { nextGameName, secondsRemaining } = state.countdownToNextGame;
  return `
    <div class="tv-countdown" data-testid="tv-countdown">
      Wait for ${escapeHtml(nextGameName)} to start
      <span class="tv-countdown-seconds" data-testid="tv-countdown-seconds">
        ${formatCountdown(secondsRemaining)}
      </span>
    </div>
  `;
}

function renderError(target: HTMLElement, err: unknown): void {
  const msg = err instanceof Error ? err.message : "Unknown error";
  target.className = "tv-error";
  target.innerHTML = `<div>TV endpoint error: ${escapeHtml(msg)}</div>`;
}

// ── Helpers ────────────────────────────────────────────────────────────

function lastFiveBallsHtml(balls: number[]): string {
  const last5 = balls.slice(-5);
  return last5
    .map((b) => {
      const col = columnFor(b);
      return `<div class="tv-small-ball col-${col}">${b}</div>`;
    })
    .join("");
}

/** 75-ball bingo column grouping (B/I/N/G/O). */
function columnFor(ball: number): "b" | "i" | "n" | "g" | "o" {
  if (ball <= 15) return "b";
  if (ball <= 30) return "i";
  if (ball <= 45) return "n";
  if (ball <= 60) return "g";
  return "o";
}

function formatPrize(cents: number): string {
  if (cents === 0) return "—";
  const kr = cents / 100;
  return `${kr.toLocaleString("nb-NO")} kr`;
}

function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "00:00";
  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

/**
 * Bølge 1: formatter ISO-timestamp til HH:MM i norsk tidssone (Europe/Oslo).
 * Brukes i sub-header ("Neste: X kl. 18:00"). Fail-open ved ugyldig input.
 */
function formatTimeHHMM(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "--:--";
    return d.toLocaleTimeString("nb-NO", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Oslo",
    });
  } catch {
    return "--:--";
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function scheduleWinnersSwitch(instance: ActiveInstance): void {
  if (instance.switchTimeoutId) window.clearTimeout(instance.switchTimeoutId);
  // Vis winners-siden i 30 sekunder, så tilbake til TV-screen.
  window.location.hash = `#/tv/${encodeURIComponent(instance.hallId)}/${encodeURIComponent(
    instance.tvToken
  )}/winners`;
  instance.switchTimeoutId = window.setTimeout(() => {
    if (instance.destroyed) return;
    window.location.hash = `#/tv/${encodeURIComponent(instance.hallId)}/${encodeURIComponent(
      instance.tvToken
    )}`;
  }, WINNERS_SWITCH_DELAY_MS);
}

// Voice-valg per hall: nå server-managed (se applyVoice ovenfor).
// Tidligere localStorage-bakte readVoice/writeVoice er fjernet fordi
// wireframe PDF 14 krever at admin (ikke TV-operatoren foran skjermen)
// eier valget, og at endringer slår inn på alle TV-er i hallen samtidig.
