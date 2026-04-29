/**
 * Winners — public mellom-spill-side for hall-display.
 *
 * Design (Admin CR 21.02.2024):
 *   - Header: "Winners" (gold)
 *   - Venstre: 3 store bokser (Total Numbers Withdrawn / Full House Winners /
 *     Patterns Won)
 *   - Høyre: tabell med pattern-rows (Row 1..5 + Full House), total-vinnere,
 *     prize per ticket, hallName som vant
 *
 * Polling: hvert 2. sekund mot /api/tv/:hallId/:tvToken/winners. Siden
 * bytter tilbake til TV-skjermen automatisk etter 30 sekunder (håndtert
 * i TVScreenPage.scheduleWinnersSwitch).
 */

import "./tv-screen.css";
import {
  fetchTvWinners,
  type TvWinnersSummary,
} from "../../api/tv-screen.js";

const POLL_INTERVAL_MS = 2000;

interface ActiveInstance {
  hallId: string;
  tvToken: string;
  intervalId: number;
  destroyed: boolean;
  /** FE-P0-003 (Bølge 2B): aborts in-flight winners-fetch on unmount. */
  abortController: AbortController;
}

let active: ActiveInstance | null = null;

export function mountWinnersPage(root: HTMLElement, hallId: string, tvToken: string): void {
  unmountWinnersPage();
  root.innerHTML = `
    <div class="tv-host" data-testid="tv-winners-host">
      <div class="tv-header">Winners</div>
      <div id="tv-winners-body" class="tv-loading">Laster...</div>
    </div>
  `;

  const bodyEl = root.querySelector<HTMLElement>("#tv-winners-body")!;

  const instance: ActiveInstance = {
    hallId,
    tvToken,
    intervalId: 0,
    destroyed: false,
    abortController: new AbortController(), // FE-P0-003
  };
  active = instance;

  const tick = async (): Promise<void> => {
    if (instance.destroyed) return;
    try {
      const summary = await fetchTvWinners(hallId, tvToken, {
        signal: instance.abortController.signal,
      });
      if (instance.destroyed) return;
      renderSummary(bodyEl, summary);
    } catch (err) {
      // FE-P0-003: aborts on unmount silent.
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (err instanceof Error && err.name === "AbortError") return;
      if (instance.destroyed) return;
      renderError(bodyEl, err);
    }
  };

  void tick();
  instance.intervalId = window.setInterval(() => void tick(), POLL_INTERVAL_MS);
}

export function unmountWinnersPage(): void {
  if (!active) return;
  active.destroyed = true;
  // FE-P0-003: cancel any pending winners-fetch on unmount.
  active.abortController.abort();
  if (active.intervalId) window.clearInterval(active.intervalId);
  active = null;
}

function renderSummary(target: HTMLElement, summary: TvWinnersSummary): void {
  target.className = "tv-winners-body";
  target.innerHTML = `
    <section class="tv-winners-boxes">
      <div class="tv-winners-box" data-testid="tv-winners-box-total">
        <span class="tv-winners-box-value">${summary.totalNumbersWithdrawn}</span>
        <span class="tv-winners-box-label">Total Numbers Withdrawn</span>
      </div>
      <div class="tv-winners-box" data-testid="tv-winners-box-fullhouse">
        <span class="tv-winners-box-value">${summary.fullHouseWinners}</span>
        <span class="tv-winners-box-label">Full House Winners</span>
      </div>
      <div class="tv-winners-box" data-testid="tv-winners-box-patterns">
        <span class="tv-winners-box-value">${summary.patternsWon}</span>
        <span class="tv-winners-box-label">Patterns Won</span>
      </div>
    </section>
    <section>
      <table class="tv-winners-table">
        <thead>
          <tr>
            <th>Pattern</th>
            <th>Total Players Won</th>
            <th>Winning Amount on a Ticket</th>
            <th>Hall Belongs To</th>
          </tr>
        </thead>
        <tbody>
          ${summary.winners
            .map(
              (w) => `
            <tr data-testid="tv-winners-row">
              <td>${escapeHtml(w.pattern)}</td>
              <td>${w.playersWon}</td>
              <td>${formatPrize(w.prizePerTicket)}</td>
              <td>${escapeHtml(w.hallName || "—")}</td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>
    </section>
  `;
}

function renderError(target: HTMLElement, err: unknown): void {
  const msg = err instanceof Error ? err.message : "Unknown error";
  target.className = "tv-error";
  target.innerHTML = `<div>Winners endpoint error: ${escapeHtml(msg)}</div>`;
}

function formatPrize(cents: number): string {
  if (cents === 0) return "—";
  const kr = cents / 100;
  return `${kr.toLocaleString("nb-NO")} kr`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
