/**
 * Agent-portal Next Game-panel (P0 pilot-blokker per legacy Agent V1.0).
 *
 * UI-layout (fra docs/architecture/LEGACY_1_TO_1_MAPPING_2026-04-23.md §3.2):
 *   - Breadcrumb + tittel
 *   - Current-game-boks: rom, hall, spillsliw, status, pause-indikator,
 *     2-min-countdown (når room-ready er broadcaset)
 *   - Ready-indikator per agent (kun aggregert "alle klar?" i pilot —
 *     pr-agent-lista kommer når backend gir hall-ready-per-agent)
 *   - Jackpot-indikator (placeholder — aktivert når spillkonfig har
 *     jackpot-aktiv runde)
 *   - Action-rad: Start Next Game, PAUSE, Resume, Force End
 *
 * Popup-flows:
 *   - Ready/Not-Ready popup — vises FØR Start Next Game hvis ikke alle
 *     agenter i hallen er markert klare. Lister "Agenter ikke klar: 1,2,4".
 *     Pilot-MVP: én agent per hall ⇒ popup vises kun når current-agent
 *     selv ikke er klar. Utvides når backend gir per-agent-liste.
 *   - Jackpot-confirm — vises FØR Start Next Game hvis runden har
 *     aktivt jackpot-potensial. Pilot-MVP: feature-flag, default off.
 *   - 2-min countdown — starter automatisk etter `Start Next Game`-klikk;
 *     viser tid igjen i sekunder og disabler andre handlinger.
 *
 * Backend-kontrakt (BIN-460 + BIN-515):
 *   - GET  /api/admin/rooms              — scope-filtrert til agentens hall
 *   - POST /api/admin/rooms/:c/start     — Start
 *   - POST /api/admin/rooms/:c/game/pause — PAUSE
 *   - POST /api/admin/rooms/:c/game/resume — Resume
 *   - POST /api/admin/rooms/:c/end       — Force End
 *   - POST /api/admin/rooms/:c/room-ready — Broadcast ready+countdown
 *
 * Refresh-strategi: 5s HTTP-polling som primær, socket-event som
 * eager-trigger (progressive-enhancement).
 */

import { t } from "../../i18n/I18n.js";
import { ApiError } from "../../api/client.js";
import { Toast } from "../../components/Toast.js";
import { Modal } from "../../components/Modal.js";
import {
  listAgentRooms,
  startNextGame,
  pauseRoomGame,
  resumeRoomGame,
  forceEndRoomGame,
  markRoomReady,
  type AgentRoomSummary,
} from "../../api/agent-next-game.js";
import {
  AgentHallSocket,
  type AgentHallEvent,
  type AgentTransferRequest,
} from "./agentHallSocket.js";
import {
  fetchAgentGame1CurrentGame,
  startAgentGame1,
  resumeAgentGame1,
  type Spill1CurrentGameResponse,
} from "../../api/agent-game1.js";
import {
  AgentGame1Socket,
  type AgentGame1StatusUpdate,
} from "./agentGame1Socket.js";
import { renderSpill1AgentStatus } from "./Spill1AgentStatus.js";
import { renderSpill1AgentControls } from "./Spill1AgentControls.js";
import {
  approveGame1MasterTransfer,
  rejectGame1MasterTransfer,
} from "../../api/admin-game1-master.js";
import { fetchMe } from "../../api/auth.js";

const POLL_INTERVAL_MS = 5_000;
const DEFAULT_COUNTDOWN_SECONDS = 120;

interface PanelState {
  rooms: AgentRoomSummary[];
  activeRoom: AgentRoomSummary | null;
  lastHallEvent: AgentHallEvent | null;
  lastFetchError: string | null;
  socketFallback: boolean;
  countdownEndsAt: number | null;
  countdownTick: number;
  /** Pilot-MVP: én agent per hall. Settes når operator klikker "Jeg er klar". */
  selfReady: boolean;
  /** Jackpot-potensial for runden (feature-flag / spillkonfig). Default false. */
  jackpotArmed: boolean;
  /**
   * Task 1.4: Spill 1 scheduled_game-data for agentens hall. Null hvis ingen
   * aktiv Spill 1-runde — da faller vi tilbake til room-code-baserte rooms
   * (Spill 2/3). Fetch parallelt med listAgentRooms i refresh().
   */
  spill1: Spill1CurrentGameResponse | null;
  spill1Error: string | null;
  spill1LastStatusEvent: AgentGame1StatusUpdate | null;
  /** Task 1.6: agentens egen hallId (hentet via fetchMe ved mount). */
  hallId: string | null;
}

let state: PanelState = initialState();
let activeContainer: HTMLElement | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let countdownTimer: ReturnType<typeof setInterval> | null = null;
let hallSocket: AgentHallSocket | null = null;
let spill1Socket: AgentGame1Socket | null = null;

function initialState(): PanelState {
  return {
    rooms: [],
    activeRoom: null,
    lastHallEvent: null,
    lastFetchError: null,
    socketFallback: false,
    countdownEndsAt: null,
    countdownTick: 0,
    selfReady: false,
    jackpotArmed: false,
    spill1: null,
    spill1Error: null,
    spill1LastStatusEvent: null,
    hallId: null,
  };
}

/** Task 1.6: singleton for innkommende transfer-popup. Én aktiv om gangen. */
let incomingTransferModal: import("../../components/Modal.js").ModalInstance | null =
  null;

export function mountNextGamePanel(container: HTMLElement): void {
  unmountNextGamePanel();
  state = initialState();
  activeContainer = container;
  render(container);
  void refresh();
  startPolling();
  startSpill1Socket();
  // Task 1.6: hent user først for at socket skal kunne filtrere
  // transfer-events på hallId. Fail-open: hvis fetchMe feiler starter
  // socket uten hallId-filter (viser events fra alle haller, spillpanel-
  // logikken avviser det som ikke er mitt).
  // Erstatter den tidligere `startSocket()`-kall — `initHallIdAndSocket`
  // henter hallId først og kaller deretter `startSocket()` selv.
  void initHallIdAndSocket();

  const observer = new MutationObserver(() => {
    if (!document.body.contains(container)) {
      unmountNextGamePanel();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

async function initHallIdAndSocket(): Promise<void> {
  try {
    const session = await fetchMe();
    state.hallId = session.hall[0]?.id ?? null;
  } catch {
    state.hallId = null;
  }
  startSocket();
}

export function unmountNextGamePanel(): void {
  stopPolling();
  stopCountdown();
  stopSocket();
  stopSpill1Socket();
  activeContainer = null;
}

function startPolling(): void {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    void refresh();
  }, POLL_INTERVAL_MS);
}

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function startCountdown(endsAt: number): void {
  stopCountdown();
  state.countdownEndsAt = endsAt;
  state.countdownTick = 0;
  countdownTimer = setInterval(() => {
    state.countdownTick += 1;
    if (Date.now() >= (state.countdownEndsAt ?? 0)) {
      stopCountdown();
    }
    rerender();
  }, 1_000);
}

function stopCountdown(): void {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  state.countdownEndsAt = null;
  state.countdownTick = 0;
}

function startSocket(): void {
  if (hallSocket) return;
  try {
    hallSocket = new AgentHallSocket({
      hallId: state.hallId,
      onHallEvent: (evt) => {
        state.lastHallEvent = evt;
        // "room-ready" starter countdown hvis payload gir sekunder
        if (evt.kind === "room-ready" && evt.countdownSeconds && evt.countdownSeconds > 0) {
          startCountdown(Date.now() + evt.countdownSeconds * 1_000);
        }
        void refresh();
      },
      onRoomUpdate: () => {
        void refresh();
      },
      onFallbackActive: (active) => {
        state.socketFallback = active;
        rerender();
      },
      // Task 1.6: incoming transfer — vis popup hvis dette er vår hall.
      onTransferRequest: (payload) => {
        if (state.hallId && payload.toHallId === state.hallId) {
          showIncomingTransferModal(payload);
        }
      },
      onTransferApproved: (payload) => {
        // Lukk popup hvis den var åpen (f.eks. hvis vi allerede aksepterte).
        closeIncomingTransferModal();
        if (state.hallId && payload.toHallId === state.hallId) {
          Toast.success(t("agent_portal_transfer_accepted_toast"));
        }
      },
      onTransferRejected: () => {
        closeIncomingTransferModal();
      },
      onTransferExpired: () => {
        closeIncomingTransferModal();
      },
    });
    if (state.activeRoom) {
      hallSocket.subscribe(state.activeRoom.code);
    }
  } catch {
    // Socket-oppkobling kan feile i test-kontekst (jsdom uten reell io) —
    // la polling ta over. Ingenting å gjøre her.
    hallSocket = null;
  }
}

function showIncomingTransferModal(payload: AgentTransferRequest): void {
  // Unngå duplicate modals — erstatt med ny hvis eksisterer.
  closeIncomingTransferModal();
  const body = document.createElement("div");
  const fromHall = payload.fromHallId;
  const validTillMs = payload.validTillMs;
  body.innerHTML = `
    <div>
      <p>
        <strong>${escapeHtml(fromHall)}</strong>
        ${escapeHtml(t("agent_portal_transfer_incoming_body"))}
      </p>
      <p class="text-muted small">
        <span id="agent-transfer-countdown">—</span>
        ${escapeHtml(t("game1_master_transfer_countdown_suffix"))}
      </p>
    </div>
  `;

  let localCountdownTimer: ReturnType<typeof setInterval> | null = null;
  const updateCountdown = () => {
    const el = body.querySelector<HTMLElement>("#agent-transfer-countdown");
    const remaining = Math.max(0, Math.floor((validTillMs - Date.now()) / 1000));
    if (el) el.textContent = String(remaining);
    if (remaining <= 0 && localCountdownTimer !== null) {
      clearInterval(localCountdownTimer);
      localCountdownTimer = null;
    }
  };
  updateCountdown();
  localCountdownTimer = setInterval(updateCountdown, 1000);

  incomingTransferModal = Modal.open({
    title: t("agent_portal_transfer_incoming_title"),
    content: body,
    size: "sm",
    backdrop: "static",
    keyboard: false,
    className: "modal-agent-transfer",
    buttons: [
      {
        label: t("agent_portal_transfer_reject"),
        variant: "default",
        action: "reject",
        dismiss: false,
        onClick: async (modal) => {
          const reason = window.prompt(
            t("agent_portal_transfer_reject_reason_prompt")
          ) ?? undefined;
          try {
            await rejectGame1MasterTransfer(payload.requestId, reason);
            Toast.success(t("agent_portal_transfer_rejected_toast"));
            modal.close("button");
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            Toast.error(msg);
          }
        },
      },
      {
        label: t("agent_portal_transfer_accept"),
        variant: "primary",
        action: "accept",
        dismiss: false,
        onClick: async (modal) => {
          try {
            await approveGame1MasterTransfer(payload.requestId);
            Toast.success(t("agent_portal_transfer_accepted_toast"));
            modal.close("button");
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            Toast.error(msg);
          }
        },
      },
    ],
    onClose: () => {
      if (localCountdownTimer !== null) {
        clearInterval(localCountdownTimer);
        localCountdownTimer = null;
      }
      incomingTransferModal = null;
    },
  });
}

function closeIncomingTransferModal(): void {
  if (incomingTransferModal) {
    try {
      incomingTransferModal.close("programmatic");
    } catch {
      // ignorer
    }
    incomingTransferModal = null;
  }
}

function stopSocket(): void {
  if (hallSocket) {
    try {
      hallSocket.dispose();
    } catch {
      // ignorer
    }
    hallSocket = null;
  }
}

function startSpill1Socket(): void {
  if (spill1Socket) return;
  try {
    spill1Socket = new AgentGame1Socket({
      onStatusUpdate: (evt) => {
        state.spill1LastStatusEvent = evt;
        void refreshSpill1();
      },
      onDrawProgressed: () => {
        // Agent-portalen trenger ikke per-kule-render her — polling henter
        // aktuell status. Men event trigger refresh for umiddelbar status-
        // opprydding (f.eks. når status flipper fra running → paused).
        void refreshSpill1();
      },
      onPhaseWon: () => {
        void refreshSpill1();
      },
      onFallbackActive: (active) => {
        // Gjenbruk eksisterende fallback-banner (state.socketFallback) —
        // hvis enten room-socket eller admin-game1-socket er nede vises
        // samme varsel. Polling tar over uansett.
        state.socketFallback = active;
        rerender();
      },
    });
    if (state.spill1?.currentGame) {
      spill1Socket.subscribe(state.spill1.currentGame.id);
    }
  } catch {
    // Socket-oppkobling kan feile i test-kontekst — la polling ta over.
    spill1Socket = null;
  }
}

function stopSpill1Socket(): void {
  if (spill1Socket) {
    try {
      spill1Socket.dispose();
    } catch {
      // ignorer
    }
    spill1Socket = null;
  }
}

async function refresh(): Promise<void> {
  if (!activeContainer) return;
  // Task 1.4: parallell fetch — room-basert (Spill 2/3) + scheduled_games-
  // basert (Spill 1). Begge kan feile uavhengig og påvirker ikke hverandre.
  await Promise.all([refreshRooms(), refreshSpill1()]);
  rerender();
}

async function refreshRooms(): Promise<void> {
  try {
    const rooms = await listAgentRooms();
    state.rooms = rooms;
    state.activeRoom = pickActiveRoom(rooms);
    state.lastFetchError = null;
    if (state.activeRoom && hallSocket) {
      hallSocket.subscribe(state.activeRoom.code);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    state.lastFetchError = msg;
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      stopPolling();
    }
  }
}

async function refreshSpill1(): Promise<void> {
  try {
    const data = await fetchAgentGame1CurrentGame();
    state.spill1 = data;
    state.spill1Error = null;
    if (data.currentGame && spill1Socket) {
      spill1Socket.subscribe(data.currentGame.id);
    }
  } catch (err) {
    // Agent uten hall eller SUPPORT-rollen gir 403 — vi kveler det uten å
    // vise feil-banner (Spill 1-UI bare skjules). Andre feil lagres i
    // spill1Error-flagget for rendering.
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      state.spill1 = null;
      state.spill1Error = null;
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    state.spill1Error = msg;
  }
  rerender();
}

function pickActiveRoom(rooms: AgentRoomSummary[]): AgentRoomSummary | null {
  if (rooms.length === 0) return null;
  // Foretrekk en room med aktivt currentGame, ellers første i lista.
  const withRunning = rooms.find((r) => r.currentGame && r.currentGame.status === "RUNNING");
  if (withRunning) return withRunning;
  const withPaused = rooms.find((r) => r.currentGame && r.currentGame.status === "PAUSED");
  if (withPaused) return withPaused;
  return rooms[0] ?? null;
}

function rerender(): void {
  if (!activeContainer) return;
  render(activeContainer);
}

// ── Rendering ────────────────────────────────────────────────────────────

function render(container: HTMLElement): void {
  container.innerHTML = `
    ${renderHeader()}
    <section class="content" data-marker="agent-next-game-panel">
      ${renderSocketBanner()}
      ${renderErrorBanner()}
      ${renderSpill1Block()}
      ${renderNoRoom()}
      ${renderCurrentGame()}
      ${renderActions()}
      ${renderReadyPanel()}
    </section>`;
  wireButtons(container);
  wireSpill1Buttons(container);
}

function renderSpill1Block(): string {
  const spill1 = state.spill1;
  if (!spill1 || !spill1.currentGame) return "";
  const statusHtml = renderSpill1AgentStatus({
    currentGame: spill1.currentGame,
    halls: spill1.halls,
    hallId: spill1.hallId,
    isMasterAgent: spill1.isMasterAgent,
    allReady: spill1.allReady,
  });
  const excludedHallIds = spill1.halls
    .filter((h) => h.excludedFromGame)
    .map((h) => h.hallId);
  const controlsHtml = renderSpill1AgentControls({
    currentGame: spill1.currentGame,
    isMasterAgent: spill1.isMasterAgent,
    allReady: spill1.allReady,
    excludedHallIds,
  });
  const errorBanner = state.spill1Error
    ? `<div class="alert alert-warning" data-marker="spill1-error-banner">
         <small>${escapeHtml(state.spill1Error)}</small>
       </div>`
    : "";
  return `
    <section data-marker="spill1-block">
      ${errorBanner}
      ${statusHtml}
      ${controlsHtml}
    </section>`;
}

function renderHeader(): string {
  const title = escapeHtml(t("agent_next_game_title"));
  return `
    <section class="content-header">
      <h1>${title}</h1>
      <ol class="breadcrumb">
        <li><a href="#/agent/dashboard"><i class="fa fa-dashboard" aria-hidden="true"></i> ${escapeHtml(t("dashboard"))}</a></li>
        <li><a href="#/agent/games">${escapeHtml(t("agent_game_management"))}</a></li>
        <li class="active">${title}</li>
      </ol>
    </section>`;
}

function renderSocketBanner(): string {
  if (!state.socketFallback) return "";
  return `
    <div class="alert alert-warning" data-marker="agent-ng-socket-fallback">
      <strong>${escapeHtml(t("agent_next_game_socket_fallback_title"))}</strong>
      ${escapeHtml(t("agent_next_game_socket_fallback_body"))}
    </div>`;
}

function renderErrorBanner(): string {
  if (!state.lastFetchError) return "";
  return `
    <div class="alert alert-danger" data-marker="agent-ng-error">
      ${escapeHtml(state.lastFetchError)}
    </div>`;
}

function renderNoRoom(): string {
  if (state.activeRoom) return "";
  if (state.lastFetchError) return "";
  return `
    <div class="box box-default" data-marker="agent-ng-no-room">
      <div class="box-body text-center" style="padding:32px;">
        <i class="fa fa-exclamation-circle" style="font-size:36px;color:#bbb;"></i>
        <h4 style="margin:12px 0 4px;">${escapeHtml(t("agent_next_game_no_room_title"))}</h4>
        <p class="text-muted">${escapeHtml(t("agent_next_game_no_room_body"))}</p>
      </div>
    </div>`;
}

function renderCurrentGame(): string {
  const room = state.activeRoom;
  if (!room) return "";
  const game = room.currentGame;
  const roomStatus = room.status ?? "—";
  const gameStatus = game?.status ?? "NONE";
  const statusLabel = statusBadge(game ? gameStatus : roomStatus);
  const gameSlug = room.gameSlug ?? game?.gameSlug ?? "—";
  const ticketPrice = game?.ticketPrice ?? null;
  const startedAt = formatIso(game?.startedAt);
  return `
    <div class="box box-default" data-marker="agent-ng-current-game">
      <div class="box-header with-border">
        <h3 class="box-title">${escapeHtml(t("agent_next_game_current_title"))}</h3>
        <div class="box-tools pull-right">
          ${renderJackpotIndicator()}
          ${renderCountdown()}
        </div>
      </div>
      <div class="box-body">
        ${renderEndedCallout()}
        <table class="table table-condensed" style="margin-bottom:0;">
          <tbody>
            <tr>
              <td style="width:180px;">${escapeHtml(t("agent_next_game_room_code"))}</td>
              <td data-field="room-code"><code>${escapeHtml(room.code)}</code></td>
            </tr>
            <tr>
              <td>${escapeHtml(t("hall"))}</td>
              <td><code>${escapeHtml(room.hallId)}</code>${room.hallName ? ` — ${escapeHtml(room.hallName)}` : ""}</td>
            </tr>
            <tr>
              <td>${escapeHtml(t("agent_next_game_game_slug"))}</td>
              <td data-field="game-slug">${escapeHtml(gameSlug)}</td>
            </tr>
            <tr>
              <td>${escapeHtml(t("agent_next_game_status"))}</td>
              <td data-field="game-status">${statusLabel}</td>
            </tr>
            ${game?.id ? `
            <tr>
              <td>${escapeHtml(t("agent_next_game_game_id"))}</td>
              <td><small><code>${escapeHtml(game.id)}</code></small></td>
            </tr>` : ""}
            ${ticketPrice != null ? `
            <tr>
              <td>${escapeHtml(t("agent_next_game_ticket_price"))}</td>
              <td>${escapeHtml(String(ticketPrice))}</td>
            </tr>` : ""}
            ${startedAt !== "—" ? `
            <tr>
              <td>${escapeHtml(t("agent_next_game_started_at"))}</td>
              <td>${escapeHtml(startedAt)}</td>
            </tr>` : ""}
          </tbody>
        </table>
      </div>
    </div>`;
}

function renderJackpotIndicator(): string {
  if (!state.jackpotArmed) return "";
  return `
    <span class="label label-warning" data-marker="agent-ng-jackpot-armed" style="margin-right:6px;">
      <i class="fa fa-star" aria-hidden="true"></i> ${escapeHtml(t("agent_next_game_jackpot_armed"))}
    </span>`;
}

/**
 * Tobias 2026-04-27 (pilot-test feedback): tydelig "Klar for ny runde"-
 * callout når rommet er i ENDED-state. Brukeren rapporterte under pilot
 * 2026-04-27 at restart-flyten var uoppdagelig — selve start-knappen var
 * synlig, men det var ikke tydelig at en runde nettopp var avsluttet.
 * Calloutten forklarer state + reason og gir tydelig affordance til
 * Start-knappen i action-raden.
 */
function renderEndedCallout(): string {
  const game = state.activeRoom?.currentGame;
  if (!game) return "";
  if (game.status !== "ENDED") return "";
  const reasonLabel = formatEndedReason(game.endedReason);
  const endedAt = formatIso(game.endedAt);
  return `
    <div class="alert alert-success" data-marker="agent-ng-ended-callout"
         style="margin-bottom:12px;border-left:4px solid #00a65a;">
      <strong><i class="fa fa-check-circle" aria-hidden="true"></i>
        ${escapeHtml(t("agent_next_game_ended_callout_title"))}
      </strong>
      <p style="margin-top:6px;margin-bottom:0;">
        ${escapeHtml(t("agent_next_game_ended_callout_body"))}
      </p>
      ${reasonLabel ? `
        <p class="text-muted small" style="margin-top:6px;margin-bottom:0;">
          ${escapeHtml(t("agent_next_game_ended_reason"))}: ${escapeHtml(reasonLabel)}
          ${endedAt !== "—" ? ` (${escapeHtml(endedAt)})` : ""}
        </p>` : ""}
    </div>`;
}

/**
 * Map backend's machine-readable `endedReason` til norsk forklaring for
 * sluttbruker. Kjente koder: BINGO_CLAIMED (en spiller fikk Fullt Hus),
 * MAX_DRAWS_REACHED / DRAW_BAG_EMPTY (alle baller trukket uten Fullt Hus),
 * MANUAL_END (admin/agent avbrøt). Ukjent kode → returner råverdi.
 */
function formatEndedReason(reason?: string | null): string {
  if (!reason) return "";
  switch (reason) {
    case "BINGO_CLAIMED":
      return t("agent_next_game_ended_reason_bingo");
    case "MAX_DRAWS_REACHED":
    case "DRAW_BAG_EMPTY":
      return t("agent_next_game_ended_reason_max_draws");
    case "MANUAL_END":
      return t("agent_next_game_ended_reason_manual");
    default:
      return reason;
  }
}

function renderCountdown(): string {
  if (!state.countdownEndsAt) return "";
  const remainingMs = Math.max(0, state.countdownEndsAt - Date.now());
  const remainingSec = Math.ceil(remainingMs / 1_000);
  if (remainingSec <= 0) return "";
  const mins = Math.floor(remainingSec / 60);
  const secs = remainingSec % 60;
  const label = `${mins}:${secs.toString().padStart(2, "0")}`;
  return `
    <span class="label label-info" data-marker="agent-ng-countdown">
      <i class="fa fa-clock-o" aria-hidden="true"></i>
      ${escapeHtml(t("agent_next_game_countdown_label"))}: ${escapeHtml(label)}
    </span>`;
}

function renderActions(): string {
  const room = state.activeRoom;
  if (!room) return "";
  const gameStatus = room.currentGame?.status ?? "NONE";
  // Tillat start hvis det ikke er et RUNNING spill i rommet.
  const canStart = gameStatus !== "RUNNING" && gameStatus !== "PAUSED";
  const canPause = gameStatus === "RUNNING";
  const canResume = gameStatus === "PAUSED";
  const canForceEnd = gameStatus === "RUNNING" || gameStatus === "PAUSED";
  // Tobias 2026-04-27 (pilot-test feedback): når rommet er i ENDED-state,
  // gi Start-knappen større visuell vekt og endre label til "Start ny runde"
  // så det er tydelig at det starter en NY runde, ikke fortsetter forrige.
  const isEnded = gameStatus === "ENDED";
  const startLabel = isEnded
    ? t("agent_next_game_start_new_round")
    : t("agent_next_game_start");
  const startBtnClass = isEnded ? "btn btn-success btn-lg" : "btn btn-success";
  return `
    <div class="box box-default" data-marker="agent-ng-actions">
      <div class="box-header with-border">
        <h3 class="box-title">${escapeHtml(t("agent_next_game_actions"))}</h3>
      </div>
      <div class="box-body">
        <div class="btn-group" role="group" style="gap:8px;">
          <button class="${startBtnClass}" data-action="start-next" ${canStart ? "" : "disabled"}
                  ${isEnded ? `data-marker="agent-ng-start-new-round"` : ""}>
            <i class="fa fa-play" aria-hidden="true"></i> ${escapeHtml(startLabel)}
          </button>
          <button class="btn btn-warning" data-action="pause" ${canPause ? "" : "disabled"}>
            <i class="fa fa-pause" aria-hidden="true"></i> ${escapeHtml(t("agent_next_game_pause"))}
          </button>
          <button class="btn btn-info" data-action="resume" ${canResume ? "" : "disabled"}>
            <i class="fa fa-play" aria-hidden="true"></i> ${escapeHtml(t("agent_next_game_resume"))}
          </button>
          <button class="btn btn-danger" data-action="force-end" ${canForceEnd ? "" : "disabled"}>
            <i class="fa fa-stop" aria-hidden="true"></i> ${escapeHtml(t("agent_next_game_force_end"))}
          </button>
        </div>
        <p class="text-muted small" style="margin-top:12px;">
          ${escapeHtml(t("agent_next_game_actions_hint"))}
        </p>
      </div>
    </div>`;
}

function renderReadyPanel(): string {
  const room = state.activeRoom;
  if (!room) return "";
  const event = state.lastHallEvent;
  const selfReadyLabel = state.selfReady
    ? `<span class="label label-success" data-marker="agent-ng-self-ready-yes">${escapeHtml(t("agent_next_game_ready_yes"))}</span>`
    : `<span class="label label-warning" data-marker="agent-ng-self-ready-no">${escapeHtml(t("agent_next_game_ready_no"))}</span>`;
  const lastEventHtml = event
    ? `
      <div data-marker="agent-ng-last-event" style="margin-top:12px;">
        <small class="text-muted">${escapeHtml(t("agent_next_game_last_event"))}:
          <strong>${escapeHtml(event.kind)}</strong>
          ${event.message ? ` — ${escapeHtml(event.message)}` : ""}
          (${escapeHtml(event.actor?.displayName ?? "")}
          ${formatRelativeTime(event.at)})
        </small>
      </div>`
    : "";
  return `
    <div class="box box-default" data-marker="agent-ng-ready-panel">
      <div class="box-header with-border">
        <h3 class="box-title">${escapeHtml(t("agent_next_game_ready_title"))}</h3>
      </div>
      <div class="box-body">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
          <div>${escapeHtml(t("agent_next_game_self_ready_label"))}: ${selfReadyLabel}</div>
          <button class="btn btn-sm btn-default" data-action="toggle-ready">
            ${state.selfReady
              ? escapeHtml(t("agent_next_game_unmark_ready"))
              : escapeHtml(t("agent_next_game_mark_ready"))}
          </button>
          <button class="btn btn-sm btn-primary" data-action="broadcast-ready">
            <i class="fa fa-bullhorn" aria-hidden="true"></i> ${escapeHtml(t("agent_next_game_broadcast_ready"))}
          </button>
        </div>
        ${lastEventHtml}
      </div>
    </div>`;
}

// ── Wiring ───────────────────────────────────────────────────────────────

function wireButtons(container: HTMLElement): void {
  container.querySelector<HTMLButtonElement>('[data-action="start-next"]')?.addEventListener(
    "click",
    () => { void onStartNext(); },
  );
  container.querySelector<HTMLButtonElement>('[data-action="pause"]')?.addEventListener(
    "click",
    () => { void onPause(); },
  );
  container.querySelector<HTMLButtonElement>('[data-action="resume"]')?.addEventListener(
    "click",
    () => { void onResume(); },
  );
  container.querySelector<HTMLButtonElement>('[data-action="force-end"]')?.addEventListener(
    "click",
    () => { void onForceEnd(); },
  );
  container.querySelector<HTMLButtonElement>('[data-action="toggle-ready"]')?.addEventListener(
    "click",
    () => { onToggleReady(); },
  );
  container.querySelector<HTMLButtonElement>('[data-action="broadcast-ready"]')?.addEventListener(
    "click",
    () => { void onBroadcastReady(); },
  );
}

function wireSpill1Buttons(container: HTMLElement): void {
  container.querySelector<HTMLButtonElement>('[data-action="spill1-start"]')?.addEventListener(
    "click",
    () => { void onSpill1Start(); },
  );
  container.querySelector<HTMLButtonElement>('[data-action="spill1-resume"]')?.addEventListener(
    "click",
    () => { void onSpill1Resume(); },
  );
}

async function onSpill1Start(): Promise<void> {
  const spill1 = state.spill1;
  if (!spill1 || !spill1.currentGame) return;
  if (!spill1.isMasterAgent) {
    Toast.warning("Kun master-hall-agent kan starte Spill 1.");
    return;
  }
  const excludedHallIds = spill1.halls
    .filter((h) => h.excludedFromGame)
    .map((h) => h.hallId);
  let confirmExcludedHalls: string[] | undefined;
  if (excludedHallIds.length > 0) {
    const ok = window.confirm(
      `Bekreft ekskluderte haller:\n${excludedHallIds.join(", ")}`
    );
    if (!ok) return;
    confirmExcludedHalls = excludedHallIds;
  }
  // REQ-007 (2026-04-26): forsøk start. Hvis backend kaster HALLS_NOT_READY,
  // gjenta call med confirmUnreadyHalls etter master-bekreftelse i popup.
  await attemptSpill1Start(confirmExcludedHalls, undefined);
}

/**
 * REQ-007: spill 1 start-call med automatisk håndtering av HALLS_NOT_READY-
 * fra backend. Ved feil med `unreadyHalls` i details, vises Hall Info-popup
 * der master kan velge [Avbryt] eller [Start uansett] (override).
 */
async function attemptSpill1Start(
  confirmExcludedHalls: string[] | undefined,
  confirmUnreadyHalls: string[] | undefined
): Promise<void> {
  try {
    await startAgentGame1(confirmExcludedHalls, confirmUnreadyHalls);
    Toast.success("Spill 1 startet");
    await refreshSpill1();
  } catch (err) {
    // ApiError fra apiRequest har `status`/`code`/`details` på instansen.
    if (err instanceof ApiError && err.code === "HALLS_NOT_READY") {
      const detailsObj = err.details;
      const unreadyHalls = Array.isArray(
        (detailsObj as { unreadyHalls?: unknown } | null)?.unreadyHalls
      )
        ? ((detailsObj as { unreadyHalls: unknown[] }).unreadyHalls.filter(
            (v): v is string => typeof v === "string"
          ))
        : [];
      if (unreadyHalls.length === 0) {
        // Master-hall er ikke klar — kan ikke overstyres. Vis feil.
        Toast.error(err.message);
        return;
      }
      const proceed = await promptHallInfoOverride(unreadyHalls);
      if (!proceed) return;
      // Retry med override-listen.
      await attemptSpill1Start(confirmExcludedHalls, unreadyHalls);
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    Toast.error(msg);
  }
}

/**
 * REQ-007: Hall Info-popup som lister Ready/Not Ready-haller før start.
 * Master kan velge [Avbryt] eller [Start uansett]. "Start uansett" sender
 * `confirmUnreadyHalls` til backend som ekskluderer hallene fra runden.
 *
 * Wireframe-referanse: PDF 16/17 §17.18 ("Hall Info"-popup).
 */
function promptHallInfoOverride(unreadyHalls: string[]): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const spill1 = state.spill1;
    const allHalls = spill1?.halls ?? [];
    // Bygg ready/not-ready-lister med hallName for visning.
    const readyList = allHalls
      .filter(
        (h) =>
          h.isReady && !h.excludedFromGame && !unreadyHalls.includes(h.hallId)
      )
      .map((h) => h.hallName);
    const notReadyList = allHalls
      .filter((h) => unreadyHalls.includes(h.hallId))
      .map((h) => h.hallName);

    const body = document.createElement("div");
    body.setAttribute("data-marker", "spill1-hall-info-override");
    const readyHtml = readyList.length
      ? `<div data-marker="spill1-ready-list">
           <strong style="color:#5cb85c;">Klare:</strong>
           <ul>${readyList.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul>
         </div>`
      : "";
    const notReadyHtml = `
      <div data-marker="spill1-not-ready-list" style="margin-top:12px;">
        <strong style="color:#f0ad4e;">Ikke klare ennå:</strong>
        <ul>${notReadyList.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul>
      </div>`;
    body.innerHTML = `
      <p>Følgende haller har ikke trykket "klar". Hvis du starter likevel blir de ekskludert fra runden.</p>
      ${readyHtml}
      ${notReadyHtml}
      <p class="text-muted small" style="margin-top:12px;">
        Avbryt for å vente på at de skal trykke klar, eller start uansett for å ekskludere dem.
      </p>`;
    Modal.open({
      title: "Haller ikke klare",
      content: body,
      backdrop: "static",
      keyboard: true,
      buttons: [
        {
          label: "Avbryt",
          variant: "default",
          action: "cancel",
          onClick: () => resolve(false),
        },
        {
          label: "Start uansett",
          variant: "warning",
          action: "confirm",
          onClick: () => resolve(true),
        },
      ],
      onClose: () => resolve(false),
    });
  });
}

async function onSpill1Resume(): Promise<void> {
  const spill1 = state.spill1;
  if (!spill1 || !spill1.currentGame) return;
  if (!spill1.isMasterAgent) {
    Toast.warning("Kun master-hall-agent kan resume Spill 1.");
    return;
  }
  try {
    await resumeAgentGame1();
    Toast.success("Spill 1 fortsatt");
    await refreshSpill1();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    Toast.error(msg);
  }
}

// ── Actions ──────────────────────────────────────────────────────────────

async function onStartNext(): Promise<void> {
  const room = state.activeRoom;
  if (!room) return;

  // 1) Ready-check: hvis operator ikke er klar, blokkér med popup.
  if (!state.selfReady) {
    const proceed = await promptNotReadyDialog();
    if (!proceed) return;
  }

  // 2) Jackpot-confirm hvis runden har jackpot-potensial.
  if (state.jackpotArmed) {
    const proceed = await promptJackpotConfirm();
    if (!proceed) return;
  }

  try {
    await startNextGame(room.code);
    Toast.success(t("agent_next_game_started"));
    await refresh();
  } catch (err) {
    // Tobias 2026-04-27 (pilot-test feedback): map de nye pre-flight-
    // feilkodene til i18n-mappede norske meldinger så bingoverten
    // skjønner hva som mangler i admin-konfig før hun kan starte.
    if (err instanceof ApiError) {
      if (err.code === "HALL_NOT_IN_GROUP") {
        Toast.error(t("agent_next_game_err_hall_not_in_group"));
        return;
      }
      if (err.code === "NO_SCHEDULE_FOR_HALL_GROUP") {
        Toast.error(t("agent_next_game_err_no_schedule"));
        return;
      }
      if (err.code === "PRE_FLIGHT_DB_ERROR") {
        Toast.error(t("agent_next_game_err_preflight_db"));
        return;
      }
    }
    const msg = err instanceof Error ? err.message : String(err);
    Toast.error(msg);
  }
}

async function onPause(): Promise<void> {
  const room = state.activeRoom;
  if (!room) return;
  const reason = window.prompt(t("agent_next_game_pause_reason_prompt"), "") ?? "";
  try {
    await pauseRoomGame(room.code, reason);
    Toast.success(t("agent_next_game_paused"));
    await refresh();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    Toast.error(msg);
  }
}

async function onResume(): Promise<void> {
  const room = state.activeRoom;
  if (!room) return;
  try {
    await resumeRoomGame(room.code);
    Toast.success(t("agent_next_game_resumed"));
    await refresh();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    Toast.error(msg);
  }
}

async function onForceEnd(): Promise<void> {
  const room = state.activeRoom;
  if (!room) return;
  const reason = window.prompt(t("agent_next_game_force_end_reason_prompt"), "") ?? "";
  if (!reason.trim()) {
    Toast.warning(t("agent_next_game_force_end_reason_required"));
    return;
  }
  const ok = window.confirm(t("agent_next_game_force_end_confirm"));
  if (!ok) return;
  try {
    await forceEndRoomGame(room.code, reason);
    Toast.success(t("agent_next_game_force_ended"));
    await refresh();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    Toast.error(msg);
  }
}

function onToggleReady(): void {
  state.selfReady = !state.selfReady;
  rerender();
}

async function onBroadcastReady(): Promise<void> {
  const room = state.activeRoom;
  if (!room) return;
  try {
    await markRoomReady(room.code, { countdownSeconds: DEFAULT_COUNTDOWN_SECONDS });
    startCountdown(Date.now() + DEFAULT_COUNTDOWN_SECONDS * 1_000);
    state.selfReady = true;
    Toast.success(t("agent_next_game_ready_broadcasted"));
    rerender();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    Toast.error(msg);
  }
}

// ── Dialogs ──────────────────────────────────────────────────────────────

/**
 * Popup som vises når operator prøver å starte Next Game uten å være klar.
 * Lister hvilke agenter som IKKE er klare. Pilot-MVP: bare selv-agent
 * (tekst-liste "Agent 1") — utvides med backend-data når hall-ready-per-
 * agent lander.
 *
 * Returnerer `true` hvis operator bekrefter "start likevel".
 */
function promptNotReadyDialog(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const body = document.createElement("div");
    body.setAttribute("data-marker", "agent-ng-not-ready-dialog");
    const notReadyList = [t("agent_next_game_not_ready_self_label")];
    body.innerHTML = `
      <p>${escapeHtml(t("agent_next_game_not_ready_body"))}</p>
      <ul style="margin-top:12px;">
        ${notReadyList.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}
      </ul>
      <p class="text-muted small" style="margin-top:12px;">
        ${escapeHtml(t("agent_next_game_not_ready_note"))}
      </p>`;
    Modal.open({
      title: t("agent_next_game_not_ready_title"),
      content: body,
      backdrop: "static",
      keyboard: true,
      buttons: [
        {
          label: t("no_cancle"),
          variant: "default",
          action: "cancel",
          onClick: () => resolve(false),
        },
        {
          label: t("agent_next_game_start_anyway"),
          variant: "warning",
          action: "confirm",
          onClick: () => resolve(true),
        },
      ],
      onClose: () => resolve(false),
    });
  });
}

/**
 * Jackpot-confirm popup: ekstra bekreftelse før Start Next Game hvis runden
 * har aktivt jackpot-potensial.
 */
function promptJackpotConfirm(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const body = document.createElement("div");
    body.setAttribute("data-marker", "agent-ng-jackpot-confirm");
    body.innerHTML = `
      <div class="alert alert-warning" style="margin-bottom:12px;">
        <strong><i class="fa fa-star" aria-hidden="true"></i> ${escapeHtml(t("agent_next_game_jackpot_armed"))}</strong>
      </div>
      <p>${escapeHtml(t("agent_next_game_jackpot_confirm_body"))}</p>`;
    Modal.open({
      title: t("agent_next_game_jackpot_confirm_title"),
      content: body,
      backdrop: "static",
      keyboard: true,
      buttons: [
        {
          label: t("no_cancle"),
          variant: "default",
          action: "cancel",
          onClick: () => resolve(false),
        },
        {
          label: t("agent_next_game_jackpot_start"),
          variant: "success",
          action: "confirm",
          onClick: () => resolve(true),
        },
      ],
      onClose: () => resolve(false),
    });
  });
}

// ── Utilities ────────────────────────────────────────────────────────────

function statusBadge(status: string): string {
  const cls = (() => {
    switch (status) {
      case "RUNNING":
      case "running":
        return "label-success";
      case "PAUSED":
      case "paused":
        return "label-warning";
      case "ENDED":
      case "completed":
      case "cancelled":
        return "label-default";
      case "NONE":
      case "IDLE":
        return "label-primary";
      default:
        return "label-info";
    }
  })();
  return `<span class="label ${cls}" data-field="status-badge">${escapeHtml(status)}</span>`;
}

function formatIso(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("no");
  } catch {
    return iso;
  }
}

function formatRelativeTime(ms: number | undefined): string {
  if (!ms) return "";
  const diffSec = Math.floor((Date.now() - ms) / 1_000);
  if (diffSec < 60) return `${diffSec}s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  return `${Math.floor(diffMin / 60)}t`;
}

function escapeHtml(s: unknown): string {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// ── Test-only exports ────────────────────────────────────────────────────

export const __test = {
  getState: (): PanelState => state,
  setState: (s: Partial<PanelState>): void => { state = { ...state, ...s }; },
  render,
  pickActiveRoom,
};
