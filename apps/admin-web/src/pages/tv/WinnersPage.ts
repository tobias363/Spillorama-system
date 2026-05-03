/**
 * Winners — public mellom-spill-side for hall-display.
 *
 * Designreferanse (2026-05-03 — Agent I):
 *   Bingo Vinnere.html fra Claude Design (handoff-bundle 2026-05-03).
 *   Burgunder bakgrunn med bingo-bg.png + radial vignette, gull-aksent
 *   typografi (Anton + Inter), pinwheel-logo til venstre, sentrert
 *   "VINNERE"-tittel, "Neste"-panel til høyre. Innhold: tre stat-kort
 *   stablet til venstre + winners-tabell til høyre med rader for Rad 1–4
 *   og Fullt hus (sistnevnte uthevet).
 *
 * Polling: hvert 2. sekund mot /api/tv/:hallId/:tvToken/winners. Siden
 * bytter tilbake til TV-skjermen automatisk etter 30 sekunder (håndtert
 * i TVScreenPage.scheduleWinnersSwitch).
 *
 * CSS-scoping: rot-elementet bruker `.tv-winners-host` (ikke `.tv-host`)
 * for å isolere all Winners-styling fra TVScreenPage. data-testid forblir
 * `tv-winners-host` for å bevare test-kontrakten.
 */

import "./tv-screen.css";
import {
  fetchTvWinners,
  type TvWinnersSummary,
  type TvWinnerRow,
} from "../../api/tv-screen.js";
import { escapeHtml } from "../../utils/escapeHtml.js";

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
  // Markup speiler Bingo Vinnere.html-strukturen: viewport > stage >
  // (header + content). `tv-winners-host` er root-scope-en for all CSS
  // i denne siden — ingen `tv-host`-styling lekker inn.
  root.innerHTML = `
    <div class="tv-winners-host" data-testid="tv-winners-host">
      <div class="tv-winners-stage">
        <div class="tv-winners-vignette" aria-hidden="true"></div>

        <div class="tv-winners-header">
          <div class="tv-winners-logo">
            <div class="tv-winners-logo-mark" aria-hidden="true"></div>
            <div class="tv-winners-logo-text">SPILLORAMA</div>
          </div>
          <div class="tv-header" data-testid="tv-winners-title">Winners</div>
          <div class="tv-winners-next" data-testid="tv-winners-next">
            <div class="tv-winners-next-label">Neste</div>
            <div class="tv-winners-next-value" data-testid="tv-winners-next-value">—</div>
          </div>
        </div>

        <div id="tv-winners-body" class="tv-winners-loading">Laster...</div>
      </div>
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
  target.className = "tv-winners-content";
  target.innerHTML = `
    <section class="tv-winners-stats">
      <div class="tv-winners-stat-card" data-testid="tv-winners-box-total">
        <div class="tv-winners-stat-num tv-winners-box-value">${escapeHtml(formatNumber(summary.totalNumbersWithdrawn))}</div>
        <div class="tv-winners-stat-label tv-winners-box-label">Totalt antall trekk</div>
      </div>
      <div class="tv-winners-stat-card" data-testid="tv-winners-box-fullhouse">
        <div class="tv-winners-stat-num tv-winners-box-value">${escapeHtml(formatNumber(summary.fullHouseWinners))}</div>
        <div class="tv-winners-stat-label tv-winners-box-label">Vinnere fullt hus</div>
      </div>
      <div class="tv-winners-stat-card" data-testid="tv-winners-box-patterns">
        <div class="tv-winners-stat-num tv-winners-box-value">${escapeHtml(formatNumber(summary.patternsWon))}</div>
        <div class="tv-winners-stat-label tv-winners-box-label">Mønstre vunnet</div>
      </div>
    </section>

    <section class="tv-winners-panel">
      <div class="tv-winners-table-wrap">
        <div class="tv-winners-table-head">
          <span>Mønster</span>
          <span>Spillere vunnet</span>
          <span>Gevinst pr. lodd</span>
          <span>Hall</span>
        </div>
        ${summary.winners.map(renderRow).join("")}
      </div>
    </section>
  `;
}

function renderRow(w: TvWinnerRow): string {
  const isFullHouse = isFullHousePattern(w.pattern);
  const rowClass = "tv-winners-table-row" + (isFullHouse ? " tv-winners-table-row--fullhouse" : "");
  const playersText = formatNumber(w.playersWon);
  const prizeText = formatPrize(w.prizePerTicket);
  const prizeClass = w.prizePerTicket > 0 ? "tv-winners-cell tv-winners-cell--amount" : "tv-winners-cell tv-winners-cell--dim";
  const hall = w.hallName?.trim() ? w.hallName : "—";
  const hallClass = w.hallName?.trim() ? "tv-winners-cell" : "tv-winners-cell tv-winners-cell--dim";
  return `
    <div class="${rowClass}" data-testid="tv-winners-row">
      <div class="tv-winners-pattern">${escapeHtml(w.pattern)}</div>
      <div class="tv-winners-cell">${escapeHtml(playersText)}</div>
      <div class="${prizeClass}">${escapeHtml(prizeText)}</div>
      <div class="${hallClass}">${escapeHtml(hall)}</div>
    </div>
  `;
}

function renderError(target: HTMLElement, err: unknown): void {
  const msg = err instanceof Error ? err.message : "Unknown error";
  target.className = "tv-winners-error";
  target.innerHTML = `<div>Winners endpoint error: ${escapeHtml(msg)}</div>`;
}

function formatPrize(cents: number): string {
  if (cents === 0) return "—";
  const kr = cents / 100;
  return `${kr.toLocaleString("nb-NO")} kr`;
}

function formatNumber(n: number): string {
  return n.toLocaleString("nb-NO");
}

/**
 * Mønster-navnet sammenlignes case-insensitivt mot legacy- og norske
 * varianter — backenden kan returnere "Full House", "Fullt hus", "Fullt
 * Hus" etc. Den siste raden skal alltid markeres som «fullhouse» visuelt.
 */
function isFullHousePattern(pattern: string): boolean {
  const p = pattern.trim().toLowerCase();
  return p === "fullt hus" || p === "full house" || p === "fullhouse" || p === "fullt-hus";
}
