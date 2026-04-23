/**
 * TV Screen — public full-screen hall-display.
 *
 * Viser pattern-tabell, siste trukne tall (stor sirkel) + siste 5 baller,
 * countdown til neste spill og voice-valg. Polling mot
 * /api/tv/:hallId/:tvToken/state hvert 2 sekund. Hvis status === "ended" i
 * state, bytter vi automatisk til winners-side i 30 sekunder.
 *
 * Legacy-spec: Admin V1.0 Game 1 - 24.3.2023 s.17.
 *
 * Voice-valg persisteres i localStorage per hall (`tv_voice_<hallId>`).
 * Audio-filene eksisterer ikke ennå — dropdownen er placeholder til
 * separat voice-pack-feature.
 */

import "./tv-screen.css";
import {
  fetchTvState,
  type TvGameState,
} from "../../api/tv-screen.js";

const POLL_INTERVAL_MS = 2000;
const WINNERS_SWITCH_DELAY_MS = 30_000;
const VOICES = ["voice-1", "voice-2", "voice-3"] as const;
type Voice = (typeof VOICES)[number];

interface ActiveInstance {
  hallId: string;
  tvToken: string;
  intervalId: number;
  switchTimeoutId: number | null;
  previousStatus: TvGameState["status"] | null;
  destroyed: boolean;
}

let active: ActiveInstance | null = null;

/** Mount TV-screen. Caller skal garantere at root er tomt. */
export function mountTvScreenPage(root: HTMLElement, hallId: string, tvToken: string): void {
  unmountTvScreenPage();
  root.innerHTML = `
    <div class="tv-host" data-testid="tv-screen-host">
      <div class="tv-header">SPILL-O-RAMA BINGO</div>
      <div class="tv-voice-select">
        <label for="tv-voice">Voice:</label>
        <select id="tv-voice" data-testid="tv-voice-select">
          <option value="voice-1">Voice 1</option>
          <option value="voice-2">Voice 2</option>
          <option value="voice-3">Voice 3</option>
        </select>
      </div>
      <div id="tv-body" class="tv-loading">Laster...</div>
    </div>
  `;

  // Voice select: restore from localStorage + persist på endring.
  const voiceSelect = root.querySelector<HTMLSelectElement>("#tv-voice");
  if (voiceSelect) {
    const stored = readVoice(hallId);
    voiceSelect.value = stored;
    voiceSelect.addEventListener("change", () => {
      writeVoice(hallId, voiceSelect.value as Voice);
    });
  }

  const bodyEl = root.querySelector<HTMLElement>("#tv-body")!;

  const instance: ActiveInstance = {
    hallId,
    tvToken,
    intervalId: 0,
    switchTimeoutId: null,
    previousStatus: null,
    destroyed: false,
  };
  active = instance;

  const tick = async (): Promise<void> => {
    if (instance.destroyed) return;
    try {
      const state = await fetchTvState(hallId, tvToken);
      if (instance.destroyed) return;
      renderState(bodyEl, state);
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
  active = null;
}

// ── Rendering ──────────────────────────────────────────────────────────

function renderState(target: HTMLElement, state: TvGameState): void {
  if (!state.currentGame && state.status === "waiting") {
    target.className = "tv-loading";
    target.innerHTML = "Venter på neste spill...";
    return;
  }

  const game = state.currentGame;
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
          Game ${game?.number ?? "—"} - ${escapeHtml(game?.name ?? "")}
        </div>
        <div class="tv-total-draws">
          Total number of balls drawn:
          <strong data-testid="tv-total-draws">${game?.ballsDrawn.length ?? 0}</strong>
        </div>
      </div>
      <div class="tv-last-ball-circle" data-testid="tv-last-ball">
        ${game?.lastBall != null ? String(game.lastBall) : "--"}
      </div>
      <div class="tv-last-5">
        ${lastFiveBallsHtml(game?.ballsDrawn ?? [])}
      </div>
      ${renderCountdown(state)}
    </section>
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

// ── Voice-valg persistering (localStorage per hall) ───────────────────

function voiceKey(hallId: string): string {
  return `tv_voice_${hallId}`;
}

function readVoice(hallId: string): Voice {
  try {
    const raw = window.localStorage.getItem(voiceKey(hallId));
    if (raw && (VOICES as readonly string[]).includes(raw)) {
      return raw as Voice;
    }
  } catch {
    // localStorage kan være blokkert i kiosk-modus — fall tilbake til default.
  }
  return "voice-1";
}

function writeVoice(hallId: string, voice: Voice): void {
  try {
    window.localStorage.setItem(voiceKey(hallId), voice);
  } catch {
    // No-op — ikke kritisk.
  }
}
