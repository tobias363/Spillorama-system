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
  markHallReadyForGame,
  unmarkHallReadyForGame,
  setHallNoCustomersForGame,
  setHallHasCustomersForGame,
  type Spill1CurrentGameResponse,
  type Spill1CurrentGameHall,
} from "../../api/agent-game1.js";
import { fetchAgentGamePlanCurrent } from "../../api/agent-game-plan.js";
import { adaptGamePlanToLegacyShape } from "../../api/agent-game-plan-adapter.js";
import {
  startSpill1MasterAction,
  resumeSpill1MasterAction,
} from "../../api/agent-master-actions.js";
import { pauseGame1 } from "../../api/admin-game1-master.js";
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
      // Cleanup 2026-05-08: ny plan-runtime er nå standard data-source.
      // Adapter mapper plan-respons til legacy-shape så all rendering
      // nedenfor er uendret.
      const planResp = await fetchAgentGamePlanCurrent({ signal });
      const res: Spill1CurrentGameResponse = adaptGamePlanToLegacyShape(planResp);
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
          //
          // `startSpill1MasterAction` kaller plan-API først (state-overgang
          // i plan-runtime) og deretter engine-API for faktisk trekning.
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
            await startSpill1MasterAction(
              undefined,
              unreadyHalls.map((h) => h.hallId),
            );
            Toast.success(`Spill 1 startet — ${unreadyHalls.length} hall(er) ekskludert.`);
          } else {
            await startSpill1MasterAction();
            Toast.success("Spill 1 startet.");
          }
          break;
        }
        case "resume":
          // Resume går via plan-API først (state-overgang i plan) og
          // deretter engine-API for å resume trekningen.
          await resumeSpill1MasterAction();
          Toast.success("Spill 1 gjenopptatt.");
          break;
        case "pause": {
          // 2026-05-08 (Tobias-direktiv): master pauser aktiv Spill 1-runde
          // direkte via admin-game1-pause-endepunktet (AGENT har
          // GAME1_MASTER_WRITE-permission). Engine pauser draw-timeren og
          // status flippes til 'paused' på scheduled-game-raden.
          const reason = window.prompt("Årsak (valgfritt):", "") ?? undefined;
          await pauseGame1(gameId, reason);
          Toast.success("Spill 1 pauset.");
          break;
        }
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

  // 2026-05-08 (Tobias-direktiv): Start aktiv når purchase-vinduet er åpnet.
  // Master kan starte UAVHENGIG av om andre haller er klare. Pause/Fortsett
  // synlig kun når aktuelt. Stop-knappen FJERNET fra agent-UI (admin-only
  // via /api/admin/game1/...). "Kringkast 'Klar' + 2-min countdown" også
  // fjernet — master starter uavhengig av ready-status.
  const canStart =
    isMaster &&
    (game.status === "ready_to_start" || game.status === "purchase_open");
  const canPause = isMaster && game.status === "running";
  const canResume = isMaster && game.status === "paused";

  const hallsHtml = renderHallList(data.halls, ownHallId);
  const ownButtonsHtml = renderOwnHallButtons(ownHall, game.status);
  // Antall ikke-klare/ikke-ekskluderte haller — vises som hint på Start-knappen
  // så master ser umiddelbart hvor mange som vil bli ekskludert.
  const unreadyCount = data.halls.filter(
    (h) => !h.isReady && !h.excludedFromGame,
  ).length;
  // 2026-05-08: vis planlagt-navnet i Start-knappen så master ser presis
  // hva som starter (eks: "Start neste spill — Bingo").
  const nextGameName = game.customGameName ?? game.subGameName ?? null;
  const masterButtonsHtml = renderMasterButtons({
    canStart,
    canPause,
    canResume,
    isMaster,
    gameStatus: game.status,
    scheduledStartTime: game.scheduledStartTime,
    unreadyCount,
    nextGameName,
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
  // 2026-05-03 (Tobias UX): tillat også 'scheduled' så agenter kan
  // markere klar/exclude tidlig (før cron promoter til 'purchase_open').
  const editable =
    gameStatus === "scheduled" ||
    gameStatus === "purchase_open" ||
    gameStatus === "ready_to_start";

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
  canPause: boolean;
  canResume: boolean;
  isMaster: boolean;
  gameStatus: string;
  /**
   * 2026-05-07: scheduled-start-tid for runden. Brukes til tooltip på
   * Start-knappen når status='scheduled' så master ser når den blir aktiv.
   */
  scheduledStartTime: string | null;
  /**
   * Antall haller som ikke har trykket Klar og ikke er ekskludert. Hvis > 0
   * vises en advarsel under Start-knappen — master kan fortsatt starte men
   * får bekreftelses-popup og hallene ekskluderes fra denne runden.
   */
  unreadyCount: number;
  /**
   * 2026-05-08: planlagt sub-game-navn (eks "Bingo", "Mystery"). Brukes til
   * å bygge dynamisk Start-label "Start neste spill — {navn}".
   */
  nextGameName: string | null;
}): string {
  if (!opts.isMaster) return "";
  const startTooltip = buildStartTooltip(
    opts.canStart,
    opts.gameStatus,
    opts.scheduledStartTime
  );
  const startTooltipAttr = startTooltip
    ? ` title="${escapeHtml(startTooltip)}"`
    : "";
  const startWarning =
    opts.canStart && opts.unreadyCount > 0
      ? `<p class="text-muted small" style="margin-top:8px;margin-bottom:0;">
           <i class="fa fa-info-circle text-warning" aria-hidden="true"></i>
           ${opts.unreadyCount} hall${opts.unreadyCount === 1 ? "" : "er"}
           ikke klar enda — start vil ekskludere ${opts.unreadyCount === 1 ? "den" : "dem"}.
         </p>`
      : "";
  // 2026-05-08 (Tobias-direktiv): Start-label inkluderer planlagt-navnet på
  // neste spill. Stop-knappen er FJERNET fra agent-UI — admin har eget
  // audit-trail-endpoint via /api/admin/game1/games/:gameId/stop hvis
  // master må stoppe en aktiv runde.
  const startLabel = opts.nextGameName
    ? `Start neste spill — ${opts.nextGameName}`
    : "Start neste spill";
  return `
    <div class="spill1-master-actions" style="margin-top:16px;">
      <h4 style="margin:0 0 8px 0;">Master-handlinger</h4>
      <div class="cashinout-grid">
        <button type="button" class="btn btn-success cashinout-grid-btn"
                data-spill1-action="start"
                ${opts.canStart ? "" : "disabled"}${startTooltipAttr}>
          <i class="fa fa-play" aria-hidden="true"></i> ${escapeHtml(startLabel)}
        </button>
        <button type="button" class="btn btn-warning cashinout-grid-btn"
                data-spill1-action="pause"
                ${opts.canPause ? "" : "disabled"}>
          <i class="fa fa-pause" aria-hidden="true"></i> Pause
        </button>
        <button type="button" class="btn btn-info cashinout-grid-btn"
                data-spill1-action="resume"
                ${opts.canResume ? "" : "disabled"}>
          <i class="fa fa-play-circle" aria-hidden="true"></i> Fortsett
        </button>
      </div>
      ${startWarning}
    </div>`;
}

/**
 * 2026-05-07: bygg tooltip-tekst for Start-knappen i cash-inout-dashboardet.
 * Speiler `Spill1AgentControls.buildStartButtonTooltip` slik at master-agent
 * får samme forklaring uansett hvor de kommer fra.
 */
function buildStartTooltip(
  canStart: boolean,
  status: string,
  scheduledStartTime: string | null
): string | null {
  if (canStart) return null;
  if (status === "scheduled") {
    const ts = formatScheduledStartHHMM(scheduledStartTime);
    if (ts) {
      return `Start blir tilgjengelig når purchase-vinduet åpner (kl ${ts} norsk tid)`;
    }
    return "Start blir tilgjengelig når purchase-vinduet åpner";
  }
  if (status === "running") {
    return "Spillet kjører allerede";
  }
  if (status === "paused") {
    return "Spillet er pauset — bruk Resume i stedet";
  }
  if (status === "completed") {
    return "Spillet er fullført";
  }
  if (status === "cancelled") {
    return "Spillet er avbrutt";
  }
  return null;
}

/**
 * 2026-05-07: format scheduled_start_time som HH:MM i Europe/Oslo. Returnerer
 * null hvis input er null eller invalid.
 */
function formatScheduledStartHHMM(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString("nb-NO", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Oslo",
  });
}

function statusLabel(status: string): string {
  switch (status) {
    case "scheduled":
      return "Planlagt";
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
