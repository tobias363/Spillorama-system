/**
 * 2026-05-02 (Tobias UX-feedback): Spill 1 hall-status + handlinger inline
 * i cash-inout-dashboardet (Box 3 — "kommende spill"). Erstatter
 * "Ingen kommende spill"-placeholderen når det finnes en aktiv runde:
 *
 *  - Alle deltakende haller i runden vises som status-pillen
 *    grønn (Klar) / oransje (Ikke klar) / rød (Ingen kunder/ekskludert).
 *  - For agentens EGEN hall vises 2 knapper:
 *      • "Marker hall som Klar" / "Angre Klar"
 *      • "Ingen kunder" / "Har kunder igjen" (rød/grå)
 *  - Master-hall får i tillegg "Start Spill 1" + "Stopp Spill 1"-
 *    knapper i samme grid-stil som kontant-inn-/ut-knappene over.
 *
 * Polling: 2s tick mot `/api/agent/game1/current-game`. Stoppes på
 * unmount via AbortSignal — caller passer inn signalet fra
 * activePageAbort i CashInOutPage slik at samme cleanup-flyt brukes.
 */

import {
  fetchAgentGame1CurrentGame,
  markHallReadyForGame,
  unmarkHallReadyForGame,
  setHallNoCustomersForGame,
  setHallHasCustomersForGame,
  startAgentGame1,
  resumeAgentGame1,
  stopAgentGame1,
  type Spill1CurrentGameResponse,
  type Spill1CurrentGameHall,
} from "../../api/agent-game1.js";
import { Toast } from "../../components/Toast.js";
import { ApiError } from "../../api/client.js";
import { escapeHtml } from "./shared.js";

const POLL_INTERVAL_MS = 2_000;

interface BoxState {
  loaded: boolean;
  data: Spill1CurrentGameResponse | null;
  busy: boolean;
  errorMessage: string | null;
}

let activeMount: { container: HTMLElement; signal: AbortSignal; cleanup: () => void } | null = null;

export function mountSpill1HallStatusBox(
  container: HTMLElement,
  signal: AbortSignal
): void {
  // Bug-fix 2026-05-02 (Tobias): router gjenbruker samme container-DOM-node
  // mellom navigasjoner, så vi MÅ skille på AbortSignal-identitet, ikke
  // container-identitet. Tidligere ga "samme container" no-op selv etter
  // at gammel signal var aborted — polling startet ikke på nytt og siden
  // viste evig "Henter Spill 1-status…" / "Ingen kommende spill".
  if (activeMount && activeMount.signal === signal && !signal.aborted) {
    return;
  }
  if (activeMount) {
    activeMount.cleanup();
    activeMount = null;
  }

  const state: BoxState = {
    loaded: false,
    data: null,
    busy: false,
    errorMessage: null,
  };

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let aborted = false;

  const cleanup = (): void => {
    aborted = true;
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    // Bug-fix 2026-05-02: nullstill activeMount så neste mount-kall i samme
    // container ikke no-op-er på stale referanse.
    if (activeMount && activeMount.signal === signal) {
      activeMount = null;
    }
  };

  signal.addEventListener("abort", cleanup, { once: true });

  // Initial render with skeleton, then async fetch.
  render(container, state);
  void refresh();

  pollTimer = setInterval(() => {
    if (aborted) return;
    if (state.busy) return;
    void refresh();
  }, POLL_INTERVAL_MS);

  container.addEventListener(
    "click",
    onClick,
    signal.aborted ? undefined : { signal }
  );

  async function refresh(): Promise<void> {
    try {
      const res = await fetchAgentGame1CurrentGame({ signal });
      if (aborted) return;
      state.loaded = true;
      state.data = res;
      state.errorMessage = null;
      render(container, state);
    } catch (err) {
      if (aborted) return;
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Ukjent feil";
      state.loaded = true;
      state.errorMessage = message;
      render(container, state);
    }
  }

  async function onClick(event: Event): Promise<void> {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest<HTMLElement>("[data-spill1-action]");
    if (!button) return;
    const action = button.dataset.spill1Action;
    if (!action) return;
    if (state.busy) return;
    const data = state.data;
    if (!data || !data.currentGame) return;
    const gameId = data.currentGame.id;
    const ownHallId = data.hallId;

    state.busy = true;
    setBusyState(container, true);

    try {
      switch (action) {
        case "mark-ready":
          await markHallReadyForGame(ownHallId, gameId);
          Toast.success("Hallen er markert som Klar.");
          break;
        case "unmark-ready":
          await unmarkHallReadyForGame(ownHallId, gameId);
          Toast.info("Klar-markering angret.");
          break;
        case "no-customers":
          await setHallNoCustomersForGame(ownHallId, gameId);
          Toast.info("Hallen er markert som 'Ingen kunder'.");
          break;
        case "has-customers":
          await setHallHasCustomersForGame(ownHallId, gameId);
          Toast.info("Hallen er åpnet igjen.");
          break;
        case "start": {
          // Tobias UX 2026-05-02: master kan starte selv om noen haller ikke
          // er klare. Hvis ikke alle er klare, vis bekreftelse + send
          // confirmUnreadyHalls (REQ-007 backend-override).
          const unreadyHalls = data.halls.filter(
            (h) => !h.isReady && !h.excludedFromGame,
          );
          if (unreadyHalls.length > 0) {
            const names = unreadyHalls.map((h) => h.hallName).join(", ");
            const ok = confirm(
              `Disse hallene har ikke trykket Klar:\n\n  ${names}\n\n` +
              `Hvis du starter nå vil de bli ekskludert fra denne runden. Vil du fortsette?`,
            );
            if (!ok) return;
            await startAgentGame1(undefined, unreadyHalls.map((h) => h.hallId));
            Toast.success(`Spill 1 startet — ${unreadyHalls.length} hall(er) ekskludert.`);
          } else {
            await startAgentGame1();
            Toast.success("Spill 1 startet.");
          }
          break;
        }
        case "resume":
          await resumeAgentGame1();
          Toast.success("Spill 1 gjenopptatt.");
          break;
        case "stop":
          if (!confirm("Er du sikker på at du vil stoppe denne runden?")) {
            return;
          }
          await stopAgentGame1();
          Toast.info("Spill 1 stoppet.");
          break;
        default:
          return;
      }
      await refresh();
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Ukjent feil";
      Toast.error(message);
    } finally {
      state.busy = false;
      setBusyState(container, false);
    }
  }

  activeMount = { container, signal, cleanup };
}

export function unmountSpill1HallStatusBox(): void {
  if (activeMount) {
    activeMount.cleanup();
    activeMount = null;
  }
}

function setBusyState(container: HTMLElement, busy: boolean): void {
  container.querySelectorAll<HTMLButtonElement>("[data-spill1-action]").forEach((btn) => {
    if (busy) {
      btn.setAttribute("disabled", "disabled");
    } else if (btn.hasAttribute("data-spill1-not-disabled")) {
      btn.removeAttribute("disabled");
      btn.removeAttribute("data-spill1-not-disabled");
    }
  });
}

function render(container: HTMLElement, state: BoxState): void {
  if (!state.loaded) {
    container.innerHTML = `
      <div class="box-body cashinout-empty-placeholder">
        <p class="text-muted text-center">Henter Spill 1-status…</p>
      </div>`;
    return;
  }

  if (state.errorMessage) {
    container.innerHTML = `
      <div class="box-body cashinout-empty-placeholder">
        <p class="text-danger text-center">
          <i class="fa fa-exclamation-triangle" aria-hidden="true"></i>
          ${escapeHtml(state.errorMessage)}
        </p>
      </div>`;
    return;
  }

  const data = state.data;
  if (!data) {
    container.innerHTML = `
      <div class="box-body cashinout-empty-placeholder">
        <p class="text-muted text-center">Ingen kommende spill tilgjengelig…</p>
      </div>`;
    return;
  }

  // 2026-05-03 (Tobias UX): vis alltid hall-status for hallene i gruppen,
  // selv når ingen runde er aktiv eller spawn'et i scheduled-tabellen.
  // Etter en runde ferdig fortsetter hallene å vises (med status oransje
  // = ikke klar) så agentene har kontinuerlig oversikt over neste runde.
  if (!data.currentGame) {
    if (data.halls.length === 0) {
      container.innerHTML = `
        <div class="box-body cashinout-empty-placeholder">
          <p class="text-muted text-center">Ingen kommende spill tilgjengelig…</p>
        </div>`;
      return;
    }
    const hallsHtml = renderHallList(data.halls, data.hallId);
    container.innerHTML = `
      <div class="box-header with-border">
        <h3 class="box-title">Spill 1 — venter på neste runde</h3>
      </div>
      <div class="box-body">
        <p class="text-muted small" style="margin-bottom: 12px;">
          Hall-status for neste planlagte spill. Status oppdateres når
          runden spawnes.
        </p>
        <div class="spill1-hall-list" data-marker="spill1-hall-list">
          ${hallsHtml}
        </div>
      </div>`;
    return;
  }

  const game = data.currentGame;
  const ownHallId = data.hallId;
  const isMaster = data.isMasterAgent;
  const ownHall = data.halls.find((h) => h.hallId === ownHallId) ?? null;

  // Master-knapper: Start aktiv så lenge status=purchase_open eller
  // ready_to_start. Hvis ikke alle haller er klare, klikk-handler viser
  // bekreftelse + ekskluderer ikke-klare haller (Tobias UX 2026-05-02).
  const canStart =
    isMaster &&
    (game.status === "ready_to_start" || game.status === "purchase_open");
  const canResume = isMaster && game.status === "paused";
  const canStop =
    isMaster && (game.status === "running" || game.status === "paused");

  const hallsHtml = renderHallList(data.halls, ownHallId);
  const ownButtonsHtml = renderOwnHallButtons(ownHall, game.status);
  // Antall ikke-klare/ikke-ekskluderte haller — vises som hint på Start-knappen
  // så master ser umiddelbart hvor mange som vil bli ekskludert.
  const unreadyCount = data.halls.filter(
    (h) => !h.isReady && !h.excludedFromGame,
  ).length;
  const masterButtonsHtml = renderMasterButtons({
    canStart,
    canResume,
    canStop,
    isMaster,
    gameStatus: game.status,
    unreadyCount,
  });

  const titleParts: string[] = [];
  titleParts.push(`Spill 1 — ${escapeHtml(statusLabel(game.status))}`);
  if (game.subGameName) {
    titleParts.push(`Subspill: ${escapeHtml(game.customGameName ?? game.subGameName)}`);
  }

  container.innerHTML = `
    <div class="box-header with-border">
      <h3 class="box-title">${titleParts.join(" · ")}</h3>
    </div>
    <div class="box-body">
      <div class="spill1-hall-list" data-marker="spill1-hall-list">
        ${hallsHtml}
      </div>
      ${ownButtonsHtml}
      ${masterButtonsHtml}
    </div>`;
}

function renderHallList(halls: Spill1CurrentGameHall[], ownHallId: string): string {
  if (halls.length === 0) {
    return `<p class="text-muted">Ingen haller registrert i denne runden.</p>`;
  }
  const rows = halls
    .map((h) => {
      const isOwn = h.hallId === ownHallId;
      const pill = renderStatusPill(h);
      return `
        <div class="spill1-hall-row${isOwn ? " spill1-hall-row-own" : ""}">
          <span class="spill1-hall-name">
            ${escapeHtml(h.hallName)}
            ${isOwn ? `<small class="text-muted">(din hall)</small>` : ""}
          </span>
          ${pill}
        </div>`;
    })
    .join("");
  return rows;
}

function renderStatusPill(h: Spill1CurrentGameHall): string {
  if (h.excludedFromGame) {
    const reason = h.excludedReason ? ` (${escapeHtml(h.excludedReason)})` : "";
    return `<span class="label label-danger" data-marker="spill1-pill-excluded">
              <i class="fa fa-times-circle" aria-hidden="true"></i> Ekskludert${reason}
            </span>`;
  }
  if (h.isReady) {
    return `<span class="label label-success" data-marker="spill1-pill-ready">
              <i class="fa fa-check-circle" aria-hidden="true"></i> Klar
            </span>`;
  }
  return `<span class="label label-warning" data-marker="spill1-pill-not-ready">
            <i class="fa fa-clock-o" aria-hidden="true"></i> Ikke klar
          </span>`;
}

function renderOwnHallButtons(
  ownHall: Spill1CurrentGameHall | null,
  gameStatus: string
): string {
  if (!ownHall) {
    return "";
  }
  // Knapper er kun aktive mens runden tar imot ready/exclude-endringer.
  const editable =
    gameStatus === "purchase_open" || gameStatus === "ready_to_start";

  const readyBtn = ownHall.isReady
    ? `<button type="button" class="btn btn-default cashinout-grid-btn"
                data-spill1-action="unmark-ready"
                ${editable && !ownHall.excludedFromGame ? "" : "disabled"}>
         <i class="fa fa-undo" aria-hidden="true"></i> Angre Klar
       </button>`
    : `<button type="button" class="btn btn-success cashinout-grid-btn"
                data-spill1-action="mark-ready"
                ${editable && !ownHall.excludedFromGame ? "" : "disabled"}>
         <i class="fa fa-check-circle" aria-hidden="true"></i> Marker Klar
       </button>`;

  const customersBtn = ownHall.excludedFromGame
    ? `<button type="button" class="btn btn-default cashinout-grid-btn"
                data-spill1-action="has-customers"
                ${editable ? "" : "disabled"}>
         <i class="fa fa-undo" aria-hidden="true"></i> Har kunder igjen
       </button>`
    : `<button type="button" class="btn btn-danger cashinout-grid-btn"
                data-spill1-action="no-customers"
                ${editable ? "" : "disabled"}>
         <i class="fa fa-times" aria-hidden="true"></i> Ingen kunder
       </button>`;

  return `
    <div class="spill1-self-actions" style="margin-top:16px;">
      <h4 style="margin:0 0 8px 0;">Min hall</h4>
      <div class="cashinout-grid">
        ${readyBtn}
        ${customersBtn}
      </div>
    </div>`;
}

function renderMasterButtons(opts: {
  canStart: boolean;
  canResume: boolean;
  canStop: boolean;
  isMaster: boolean;
  gameStatus: string;
  /**
   * Antall haller som ikke har trykket Klar og ikke er ekskludert. Hvis > 0
   * vises en advarsel under Start-knappen — master kan fortsatt starte men
   * får bekreftelses-popup og hallene ekskluderes fra denne runden.
   */
  unreadyCount: number;
}): string {
  if (!opts.isMaster) return "";
  const startWarning =
    opts.canStart && opts.unreadyCount > 0
      ? `<p class="text-muted small" style="margin-top:8px;margin-bottom:0;">
           <i class="fa fa-exclamation-triangle text-warning" aria-hidden="true"></i>
           ${opts.unreadyCount} hall${opts.unreadyCount === 1 ? "" : "er"}
           ikke klar enda — start vil ekskludere ${opts.unreadyCount === 1 ? "den" : "dem"}.
         </p>`
      : "";
  return `
    <div class="spill1-master-actions" style="margin-top:16px;">
      <h4 style="margin:0 0 8px 0;">Master-handlinger</h4>
      <div class="cashinout-grid">
        <button type="button" class="btn btn-success cashinout-grid-btn"
                data-spill1-action="start"
                ${opts.canStart ? "" : "disabled"}>
          <i class="fa fa-play" aria-hidden="true"></i> Start Spill 1
        </button>
        <button type="button" class="btn btn-info cashinout-grid-btn"
                data-spill1-action="resume"
                ${opts.canResume ? "" : "disabled"}>
          <i class="fa fa-play-circle" aria-hidden="true"></i> Resume
        </button>
        <button type="button" class="btn btn-danger cashinout-grid-btn"
                data-spill1-action="stop"
                ${opts.canStop ? "" : "disabled"}>
          <i class="fa fa-stop" aria-hidden="true"></i> Stopp Spill 1
        </button>
      </div>
      ${startWarning}
    </div>`;
}

function statusLabel(status: string): string {
  switch (status) {
    case "purchase_open":
      return "Salg åpent";
    case "ready_to_start":
      return "Klar til start";
    case "running":
      return "Pågår";
    case "paused":
      return "Pauset";
    case "completed":
      return "Fullført";
    case "cancelled":
      return "Avbrutt";
    default:
      return status;
  }
}
