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
 *
 * 2026-05-08 (Tobias-feedback, branch feat/spill1-hall-status-multi-hall):
 * Splittet hall-listen i to seksjoner — "Min hall" og "Andre haller i
 * gruppen" — slik at master ser ready-state for alle GoH-medlemmer.
 * Master-hall får 👑-merke; ticket-tellinger (digitale + fysiske) vises
 * pr hall. Master-start-knappen er IKKE blokkert av andre halls
 * ready-state (per Tobias-direktiv #1017).
 */

import {
  fetchAgentGame1CurrentGame,
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
      // 2026-05-08 (Tobias-feedback): Bingovert mangler oversikt over de
      // andre hallene i sin GoH. Plan-runtime API-et returnerer ikke
      // hall-ready-status — adapteren mocker derfor `halls: [<egen
      // hall>]` (se agent-game-plan-adapter.ts §125-136 for begrunnelse).
      //
      // Vi henter derfor LEGACY `/api/agent/game1/current-game` PARALLELT
      // med plan-runtime-callet. Legacy-endpoint returnerer alle haller i
      // GoH med `isReady` / `excludedFromGame` / `digitalTicketsSold` /
      // `physicalTicketsSold`-felter. Vi merger inn legacy-`halls[]` i
      // adapter-shapen, og beholder plan-runtime som autoritet for
      // `currentGame.id` (plan-run-id) + `currentGame.status` (plan-state).
      //
      // Hvis legacy-callet feiler (eks. ingen aktiv runde for hallen),
      // beholder vi adapter-shapen uendret slik at tomme-state-rendering
      // fortsetter å virke.
      const [planResp, legacyResp] = await Promise.all([
        fetchAgentGamePlanCurrent({ signal }),
        fetchAgentGame1CurrentGame({ signal }).catch(() => null),
      ]);
      const res: Spill1CurrentGameResponse = adaptGamePlanToLegacyShape(planResp);
      if (legacyResp && legacyResp.halls.length > 0) {
        // Merge: Bruk legacy-`halls[]` som kilde (full ready-state +
        // ticket-tellinger). Resten (isMasterAgent, currentGame-meta) fra
        // plan-runtime som er kanonisk for plan-state.
        res.halls = legacyResp.halls;
        res.allReady = legacyResp.allReady;
      }
      // 2026-05-08 (Tobias-bug-fix): adapter setter `currentGame.id` til
      // plan-run-id, men master-handlinger (pause/resume/stop) går mot
      // `/api/admin/game1/games/:gameId/...` som krever scheduled-games-id.
      // Legacy-endpoint `/api/agent/game1/current-game` returnerer ekte
      // scheduled-games-id i `currentGame.id` — vi bruker den når den
      // finnes så pause-knappen treffer riktig rad. `participatingHallIds`
      // overstyres også fordi adapter-en bare hadde plan-runtime sin
      // hall-snapshot tilgjengelig.
      if (legacyResp?.currentGame && res.currentGame) {
        res.currentGame.id = legacyResp.currentGame.id;
        res.currentGame.masterHallId = legacyResp.currentGame.masterHallId;
        res.currentGame.groupHallId = legacyResp.currentGame.groupHallId;
        res.currentGame.participatingHallIds =
          legacyResp.currentGame.participatingHallIds;
        res.isMasterAgent = legacyResp.isMasterAgent;
      }
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
  //
  // 2026-05-08 (Tobias-feedback): Vis "Min hall" og "Andre haller i
  // gruppen" som separate seksjoner slik at master ser umiddelbart hvor
  // mange andre haller som er klare/ikke klare. Master-hall i andre-
  // listen får 👑-merke; ticket-tellinger (digitale + fysiske) vises pr
  // hall.
  const masterHallIdForCrown = data.currentGame?.masterHallId ?? null;
  if (!data.currentGame) {
    if (data.halls.length === 0) {
      container.innerHTML = `
        <div class="box-body cashinout-empty-placeholder">
          <p class="text-muted text-center">Ingen kommende spill tilgjengelig…</p>
        </div>`;
      return;
    }
    const ownHallSnap = data.halls.find((h) => h.hallId === data.hallId) ?? null;
    const otherHallsSnap = data.halls.filter((h) => h.hallId !== data.hallId);
    container.innerHTML = `
      <div class="box-header with-border">
        <h3 class="box-title">Spill 1 — venter på neste runde</h3>
      </div>
      <div class="box-body">
        <p class="text-muted small" style="margin-bottom: 12px;">
          Hall-status for neste planlagte spill. Status oppdateres når
          runden spawnes.
        </p>
        ${renderOwnHallSection(ownHallSnap, data.hallId, masterHallIdForCrown)}
        ${renderOtherHallsSection(otherHallsSnap, masterHallIdForCrown)}
      </div>`;
    return;
  }

  const game = data.currentGame;
  const ownHallId = data.hallId;
  const isMaster = data.isMasterAgent;
  const ownHall = data.halls.find((h) => h.hallId === ownHallId) ?? null;
  const otherHalls = data.halls.filter((h) => h.hallId !== ownHallId);

  // 2026-05-08 (Tobias-direktiv): Start aktiv når purchase-vinduet er åpnet.
  // Master kan starte UAVHENGIG av om andre haller er klare. Pause/Fortsett
  // synlig kun når aktuelt. Stop-knappen FJERNET fra agent-UI (admin-only
  // via /api/admin/game1/...). "Kringkast 'Klar' + 2-min countdown" også
  // fjernet — master starter uavhengig av ready-status.
  //
  // NB: `canStart` sjekker KUN game.status. Andre halls ready-state er
  // IKKE en gate (per #1017) — den vises informativt på Start-knappen
  // som "X hall(er) ikke klar enda — start vil ekskludere {dem|den}".
  const canStart =
    isMaster &&
    (game.status === "ready_to_start" || game.status === "purchase_open");
  const canPause = isMaster && game.status === "running";
  const canResume = isMaster && game.status === "paused";

  const ownHallHtml = renderOwnHallSection(ownHall, ownHallId, masterHallIdForCrown);
  const otherHallsHtml = renderOtherHallsSection(otherHalls, masterHallIdForCrown);
  // 2026-05-08 (Tobias-bug-fix): "Marker Klar" / "Ingen kunder"-knappene
  // kaller `/api/admin/game1/halls/:hallId/ready` med `gameId` i body.
  // Backend krever en eksisterende `scheduled_games`-rad — som først
  // spawnes når master kaller `/api/agent/game-plan/start`. Før master
  // har startet er `currentGame.id` enten tom (backend) eller en plan-
  // run-id (adapter) — ingen av dem er en gyldig scheduled-games-id.
  // Vi disabler knappene defensivt og viser en tooltip så agenter
  // forstår hvorfor de er disabled.
  const hasValidGameId =
    typeof game.id === "string" && game.id.length > 0 && game.status !== "scheduled";
  const ownButtonsHtml = renderOwnHallButtons(ownHall, game.status, hasValidGameId);
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
      ${ownHallHtml}
      ${otherHallsHtml}
      ${ownButtonsHtml}
      ${masterButtonsHtml}
    </div>`;
}

/**
 * 2026-05-08 (Tobias-feedback): Render egen-hall-seksjonen ("Min hall").
 * Viser status-pillen + ticket-tellinger + master-merke om hallen er
 * master. Knapper for egen hall (Marker Klar / Ingen kunder) rendres
 * separat av `renderOwnHallButtons` slik at de kan kobles til samme
 * grid-stil som kontant-inn-/ut-knappene.
 */
function renderOwnHallSection(
  ownHall: Spill1CurrentGameHall | null,
  ownHallId: string,
  masterHallId: string | null,
): string {
  // Hvis egen hall ikke er i halls-listen (eks. tom-state før plan-runtime
  // er registrert), vises minimal placeholder.
  if (!ownHall) {
    return `
      <div class="spill1-hall-section" data-marker="spill1-own-hall-section"
           style="margin-bottom:12px;">
        <h4 style="margin:0 0 8px 0;">Min hall</h4>
        <p class="text-muted small">Henter status…</p>
      </div>`;
  }
  const isMasterHall = masterHallId !== null && ownHallId === masterHallId;
  const masterCrown = isMasterHall
    ? `<span class="label label-default" data-marker="spill1-pill-master"
              title="Master-hall" style="margin-left:6px;">👑 Master</span>`
    : "";
  const pill = renderStatusPill(ownHall);
  const ticketInfo = renderTicketCounts(ownHall);
  return `
    <div class="spill1-hall-section" data-marker="spill1-own-hall-section"
         style="margin-bottom:12px;">
      <h4 style="margin:0 0 8px 0;">Min hall</h4>
      <div class="spill1-hall-list" data-marker="spill1-hall-list">
        <div class="spill1-hall-row spill1-hall-row-own">
          <span class="spill1-hall-name">
            ${escapeHtml(ownHall.hallName)}
            <small class="text-muted">(din hall)</small>
            ${masterCrown}
          </span>
          <span class="spill1-hall-meta">
            ${ticketInfo}
            ${pill}
          </span>
        </div>
      </div>
    </div>`;
}

/**
 * 2026-05-08 (Tobias-feedback): Render andre-haller-seksjonen ("Andre
 * haller i gruppen"). Viser status-pill + ticket-tellinger pr hall +
 * 👑-merke for master-hall. Master-agent ser denne for å avgjøre om
 * de andre hallene er klare før de starter — men start-knappen er
 * IKKE blokkert av andre halls ready-state (per Tobias-direktiv #1017).
 */
function renderOtherHallsSection(
  otherHalls: Spill1CurrentGameHall[],
  masterHallId: string | null,
): string {
  if (otherHalls.length === 0) {
    return `
      <div class="spill1-hall-section" data-marker="spill1-other-halls-section"
           style="margin-bottom:12px;">
        <h4 style="margin:0 0 8px 0;">Andre haller i gruppen</h4>
        <p class="text-muted small">Ingen andre haller i denne gruppen.</p>
      </div>`;
  }
  const rows = otherHalls
    .map((h) => {
      const isMasterHall = masterHallId !== null && h.hallId === masterHallId;
      const masterCrown = isMasterHall
        ? `<span class="label label-default" data-marker="spill1-pill-master"
                  title="Master-hall" style="margin-left:6px;">👑 Master</span>`
        : "";
      const pill = renderStatusPill(h);
      const ticketInfo = renderTicketCounts(h);
      return `
        <div class="spill1-hall-row" data-hall-id="${escapeHtml(h.hallId)}">
          <span class="spill1-hall-name">
            ${escapeHtml(h.hallName)}
            ${masterCrown}
          </span>
          <span class="spill1-hall-meta">
            ${ticketInfo}
            ${pill}
          </span>
        </div>`;
    })
    .join("");
  return `
    <div class="spill1-hall-section" data-marker="spill1-other-halls-section"
         style="margin-bottom:12px;">
      <h4 style="margin:0 0 8px 0;">Andre haller i gruppen</h4>
      <div class="spill1-hall-list" data-marker="spill1-hall-list">
        ${rows}
      </div>
    </div>`;
}

/**
 * 2026-05-08 (Tobias-feedback): Render kompakt ticket-teller (digitale
 * + fysiske bonger) per hall. Skjules hvis hallen er ekskludert (da er
 * antallet irrelevant — agentene ser uansett "Ekskludert"-pillen).
 *
 * Tooltip viser breakdown: "{digitale} dig + {fysiske} fys" — den
 * kompakte visningen i UI viser kun totalen for å holde rad-bredde
 * smal.
 */
function renderTicketCounts(h: Spill1CurrentGameHall): string {
  if (h.excludedFromGame) return "";
  const total = h.digitalTicketsSold + h.physicalTicketsSold;
  if (total === 0) {
    return `<small class="text-muted" style="margin-right:8px;"
                   data-marker="spill1-tickets-count"
                   title="Ingen bonger solgt">0 bonger</small>`;
  }
  const breakdown = `${h.digitalTicketsSold} dig + ${h.physicalTicketsSold} fys`;
  return `<small class="text-muted" style="margin-right:8px;"
                 data-marker="spill1-tickets-count"
                 title="${breakdown}">${total} bonger</small>`;
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
  gameStatus: string,
  hasValidGameId: boolean
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

  // 2026-05-08 (Tobias-bug-fix): disable hvis ingen gyldig scheduled-game-
  // id finnes ennå (backend returnerer 400 før master har trykket Start
  // neste spill). Tooltipen forklarer hvorfor knappene er disabled.
  const disableForNoGameId = !hasValidGameId;
  const noGameIdTooltip = "Master må starte spillet først";
  const noGameIdTooltipAttr = disableForNoGameId
    ? ` title="${escapeHtml(noGameIdTooltip)}"`
    : "";

  const readyDisabled =
    !editable || ownHall.excludedFromGame || disableForNoGameId;
  const readyBtn = ownHall.isReady
    ? `<button type="button" class="btn btn-default cashinout-grid-btn"
                data-spill1-action="unmark-ready"
                ${readyDisabled ? "disabled" : ""}${noGameIdTooltipAttr}>
         <i class="fa fa-undo" aria-hidden="true"></i> Angre Klar
       </button>`
    : `<button type="button" class="btn btn-success cashinout-grid-btn"
                data-spill1-action="mark-ready"
                ${readyDisabled ? "disabled" : ""}${noGameIdTooltipAttr}>
         <i class="fa fa-check-circle" aria-hidden="true"></i> Marker Klar
       </button>`;

  const customersDisabled = !editable || disableForNoGameId;
  const customersBtn = ownHall.excludedFromGame
    ? `<button type="button" class="btn btn-default cashinout-grid-btn"
                data-spill1-action="has-customers"
                ${customersDisabled ? "disabled" : ""}${noGameIdTooltipAttr}>
         <i class="fa fa-undo" aria-hidden="true"></i> Har kunder igjen
       </button>`
    : `<button type="button" class="btn btn-danger cashinout-grid-btn"
                data-spill1-action="no-customers"
                ${customersDisabled ? "disabled" : ""}${noGameIdTooltipAttr}>
         <i class="fa fa-times" aria-hidden="true"></i> Ingen kunder
       </button>`;

  // 2026-05-08 (Tobias-feedback): Header endret fra "Min hall" til
  // "Handlinger for min hall" siden status-pillen for egen hall nå
  // rendres av `renderOwnHallSection` over knappene. Uten endringen
  // ville agentene se to "Min hall"-headere i serie.
  return `
    <div class="spill1-self-actions" style="margin-top:16px;">
      <h4 style="margin:0 0 8px 0;">Handlinger for min hall</h4>
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
