// GAME1_SCHEDULE PR 3: master-konsoll for Game 1.
// GAME1_SCHEDULE PR 4d.3b: socket-live-oppdatering + polling-fallback.
//
// Backend: apps/backend/src/routes/adminGame1Master.ts + /admin-game1
// socket-namespace.
// API-adapter: apps/admin-web/src/api/admin-game1-master.ts.
//
// Viser ett spills ready-status per hall + master-actions (START / PAUSE /
// RESUME / STOP / EXCLUDE). Primær flyt er socket-subscription mot
// `/admin-game1`-namespacet — status-update/draw-progressed trigger
// umiddelbar refresh. REST-polling (5s) er fallback som starter hvis
// socket er frakoblet > 10s, og stopper automatisk ved reconnect.

import { t } from "../../../i18n/I18n.js";
import { escapeHtml } from "../common/escape.js";
import { ApiError } from "../../../api/client.js";
import { Toast } from "../../../components/Toast.js";
import {
  fetchGame1Detail,
  startGame1,
  excludeGame1Hall,
  includeGame1Hall,
  pauseGame1,
  resumeGame1,
  stopGame1,
  type Game1GameDetail,
  type Game1HallDetail,
} from "../../../api/admin-game1-master.js";
import { AdminGame1Socket } from "./adminGame1Socket.js";

const POLL_INTERVAL_MS = 5000;

let activePoll: ReturnType<typeof setInterval> | null = null;
let activeSocket: AdminGame1Socket | null = null;

export async function renderGame1MasterConsole(
  container: HTMLElement,
  gameId: string
): Promise<void> {
  stopPolling();
  disposeSocket();
  container.innerHTML = renderShell(gameId);
  await refresh(container, gameId);

  // PR 4d.3b: abonnér på socket-events. Polling er fallback — den starter
  // kun hvis socket er frakoblet > 10s.
  activeSocket = new AdminGame1Socket({
    onStatusUpdate: () => {
      void refresh(container, gameId);
    },
    onDrawProgressed: () => {
      void refresh(container, gameId);
    },
    onFallbackActive: (active) => {
      if (active) {
        startPolling(container, gameId);
      } else {
        stopPolling();
      }
    },
  });
  activeSocket.subscribe(gameId);

  const observer = new MutationObserver(() => {
    if (!document.body.contains(container)) {
      stopPolling();
      disposeSocket();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function startPolling(container: HTMLElement, gameId: string): void {
  if (activePoll) return;
  activePoll = setInterval(() => {
    void refresh(container, gameId);
  }, POLL_INTERVAL_MS);
}

function stopPolling(): void {
  if (activePoll) {
    clearInterval(activePoll);
    activePoll = null;
  }
}

function disposeSocket(): void {
  if (activeSocket) {
    activeSocket.dispose();
    activeSocket = null;
  }
}

function renderShell(gameId: string): string {
  return `
    <div class="page-wrapper">
      <div class="container-fluid" id="g1-master-root" data-game-id="${escapeHtml(gameId)}">
        <section class="content-header">
          <h1>${escapeHtml(t("game1_master_console_title"))}</h1>
          <p class="text-muted" id="g1-master-subtitle">
            ${escapeHtml(t("game1_master_loading"))}
          </p>
        </section>
        <section class="content">
          <div id="g1-master-game-info"
               class="panel panel-default"
               style="padding:16px;"></div>
          <div id="g1-master-halls"
               class="panel panel-default"
               style="padding:16px;margin-top:16px;"></div>
          <div id="g1-master-actions"
               class="panel panel-default"
               style="padding:16px;margin-top:16px;"></div>
          <div id="g1-master-audit"
               class="panel panel-default"
               style="padding:16px;margin-top:16px;"></div>
        </section>
      </div>
    </div>
  `;
}

async function refresh(container: HTMLElement, gameId: string): Promise<void> {
  try {
    const detail = await fetchGame1Detail(gameId);
    renderGameInfo(container, detail);
    renderHalls(container, detail);
    renderActions(container, detail);
    renderAudit(container, detail);
    const subtitle = container.querySelector<HTMLElement>("#g1-master-subtitle");
    if (subtitle) {
      subtitle.textContent = `${t("game1_master_status")}: ${detail.game.status}`;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const host = container.querySelector<HTMLElement>("#g1-master-game-info");
    if (host) {
      host.innerHTML = `<div class="alert alert-danger">${escapeHtml(msg)}</div>`;
    }
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      stopPolling();
    }
  }
}

function renderGameInfo(container: HTMLElement, detail: Game1GameDetail): void {
  const host = container.querySelector<HTMLElement>("#g1-master-game-info");
  if (!host) return;
  const game = detail.game;
  host.innerHTML = `
    <h3 style="margin-top:0;">${escapeHtml(game.customGameName ?? game.subGameName)}</h3>
    <table class="table table-condensed" style="margin-bottom:0;">
      <tbody>
        <tr><td style="width:200px;">${escapeHtml(t("game1_master_game_id"))}</td>
            <td><code>${escapeHtml(game.id)}</code></td></tr>
        <tr><td>${escapeHtml(t("game1_master_scheduled_start"))}</td>
            <td>${escapeHtml(formatIso(game.scheduledStartTime))}</td></tr>
        <tr><td>${escapeHtml(t("game1_master_actual_start"))}</td>
            <td>${escapeHtml(formatIso(game.actualStartTime))}</td></tr>
        <tr><td>${escapeHtml(t("game1_master_status"))}</td>
            <td>${statusBadge(game.status)}</td></tr>
        <tr><td>${escapeHtml(t("game1_master_master_hall"))}</td>
            <td><code>${escapeHtml(game.masterHallId)}</code></td></tr>
        <tr><td>${escapeHtml(t("game1_master_group_hall"))}</td>
            <td><code>${escapeHtml(game.groupHallId)}</code></td></tr>
        <tr><td>${escapeHtml(t("game1_master_all_ready"))}</td>
            <td>${detail.allReady
              ? '<span class="label label-success">JA</span>'
              : '<span class="label label-warning">NEI</span>'}</td></tr>
      </tbody>
    </table>
  `;
}

function renderHalls(container: HTMLElement, detail: Game1GameDetail): void {
  const host = container.querySelector<HTMLElement>("#g1-master-halls");
  if (!host) return;
  const rowsHtml = detail.halls
    .map((h) => {
      const badge = hallStatusBadge(h);
      const excludeBtn =
        h.excludedFromGame
          ? `<button class="btn btn-xs btn-default"
                     data-action="include-hall"
                     data-hall-id="${escapeHtml(h.hallId)}">
               ${escapeHtml(t("game1_master_include_hall"))}
             </button>`
          : h.hallId === detail.game.masterHallId
            ? '<span class="text-muted small">master</span>'
            : `<button class="btn btn-xs btn-warning"
                       data-action="exclude-hall"
                       data-hall-id="${escapeHtml(h.hallId)}">
                 ${escapeHtml(t("game1_master_exclude_hall"))}
               </button>`;
      return `
        <tr>
          <td><code>${escapeHtml(h.hallId)}</code><br>
              <small>${escapeHtml(h.hallName)}</small></td>
          <td>${badge}</td>
          <td class="text-right">${h.digitalTicketsSold}</td>
          <td class="text-right">${h.physicalTicketsSold}</td>
          <td>${excludeBtn}</td>
        </tr>
      `;
    })
    .join("");
  host.innerHTML = `
    <h3 style="margin-top:0;">${escapeHtml(t("game1_master_halls_title"))}</h3>
    <table class="table table-condensed">
      <thead>
        <tr>
          <th>${escapeHtml(t("hall"))}</th>
          <th>${escapeHtml(t("game1_master_ready_status"))}</th>
          <th class="text-right">${escapeHtml(t("game1_master_digital_tickets"))}</th>
          <th class="text-right">${escapeHtml(t("game1_master_physical_tickets"))}</th>
          <th style="width:150px;">${escapeHtml(t("actions"))}</th>
        </tr>
      </thead>
      <tbody>${rowsHtml || `<tr><td colspan="5" class="text-center text-muted">${escapeHtml(t("game1_master_no_halls"))}</td></tr>`}</tbody>
    </table>
  `;
  host.querySelectorAll<HTMLButtonElement>('[data-action="exclude-hall"]').forEach((btn) => {
    btn.addEventListener("click", () =>
      onExcludeHall(container, detail.game.id, btn.dataset.hallId ?? "")
    );
  });
  host.querySelectorAll<HTMLButtonElement>('[data-action="include-hall"]').forEach((btn) => {
    btn.addEventListener("click", () =>
      onIncludeHall(container, detail.game.id, btn.dataset.hallId ?? "")
    );
  });
}

function renderActions(container: HTMLElement, detail: Game1GameDetail): void {
  const host = container.querySelector<HTMLElement>("#g1-master-actions");
  if (!host) return;
  const status = detail.game.status;
  const canStart =
    status === "ready_to_start" ||
    (status === "purchase_open" && detail.allReady);
  const canPause = status === "running";
  const canResume = status === "paused";
  const canStop = ["purchase_open", "ready_to_start", "running", "paused"].includes(
    status
  );
  host.innerHTML = `
    <h3 style="margin-top:0;">${escapeHtml(t("game1_master_actions"))}</h3>
    <div class="btn-group" role="group">
      <button class="btn btn-success" data-action="start" ${canStart ? "" : "disabled"}>
        ${escapeHtml(t("game1_master_start"))}
      </button>
      <button class="btn btn-warning" data-action="pause" ${canPause ? "" : "disabled"}>
        ${escapeHtml(t("game1_master_pause"))}
      </button>
      <button class="btn btn-info" data-action="resume" ${canResume ? "" : "disabled"}>
        ${escapeHtml(t("game1_master_resume"))}
      </button>
      <button class="btn btn-danger" data-action="stop" ${canStop ? "" : "disabled"}>
        ${escapeHtml(t("game1_master_stop"))}
      </button>
    </div>
    <p class="text-muted small" style="margin-top:12px;">
      ${escapeHtml(t("game1_master_poll_hint"))}
    </p>
  `;
  host.querySelector<HTMLButtonElement>('[data-action="start"]')?.addEventListener(
    "click",
    () => onStart(container, detail)
  );
  host.querySelector<HTMLButtonElement>('[data-action="pause"]')?.addEventListener(
    "click",
    () => onPause(container, detail.game.id)
  );
  host.querySelector<HTMLButtonElement>('[data-action="resume"]')?.addEventListener(
    "click",
    () => onResume(container, detail.game.id)
  );
  host.querySelector<HTMLButtonElement>('[data-action="stop"]')?.addEventListener(
    "click",
    () => onStop(container, detail.game.id)
  );
}

function renderAudit(container: HTMLElement, detail: Game1GameDetail): void {
  const host = container.querySelector<HTMLElement>("#g1-master-audit");
  if (!host) return;
  const rows = detail.auditRecent
    .map((a) => {
      return `
        <tr>
          <td>${escapeHtml(formatIso(a.createdAt))}</td>
          <td><code>${escapeHtml(a.action)}</code></td>
          <td><small>${escapeHtml(a.actorUserId)}</small></td>
          <td><small>${escapeHtml(a.actorHallId)}</small></td>
          <td><small><code>${escapeHtml(JSON.stringify(a.metadata))}</code></small></td>
        </tr>
      `;
    })
    .join("");
  host.innerHTML = `
    <h3 style="margin-top:0;">${escapeHtml(t("game1_master_audit_title"))}</h3>
    <table class="table table-condensed">
      <thead>
        <tr>
          <th style="width:180px;">${escapeHtml(t("game1_master_timestamp"))}</th>
          <th>${escapeHtml(t("game1_master_action"))}</th>
          <th>${escapeHtml(t("game1_master_actor_user"))}</th>
          <th>${escapeHtml(t("game1_master_actor_hall"))}</th>
          <th>${escapeHtml(t("game1_master_metadata"))}</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="5" class="text-center text-muted">${escapeHtml(t("game1_master_no_audit"))}</td></tr>`}</tbody>
    </table>
  `;
}

// ── Action handlers ────────────────────────────────────────────────────────

async function onStart(container: HTMLElement, detail: Game1GameDetail): Promise<void> {
  const excludedHallIds = detail.halls
    .filter((h) => h.excludedFromGame)
    .map((h) => h.hallId);
  let confirmExcludedHalls: string[] | undefined;
  if (excludedHallIds.length > 0) {
    const ok = window.confirm(
      `${t("game1_master_confirm_excluded")}:\n${excludedHallIds.join(", ")}`
    );
    if (!ok) return;
    confirmExcludedHalls = excludedHallIds;
  }
  await callAction(container, detail.game.id, async () => {
    await startGame1(detail.game.id, confirmExcludedHalls);
  });
}

async function onPause(container: HTMLElement, gameId: string): Promise<void> {
  const reason = window.prompt(t("game1_master_pause_reason_prompt"), "") ?? "";
  await callAction(container, gameId, async () => {
    await pauseGame1(gameId, reason);
  });
}

async function onResume(container: HTMLElement, gameId: string): Promise<void> {
  await callAction(container, gameId, async () => {
    await resumeGame1(gameId);
  });
}

async function onStop(container: HTMLElement, gameId: string): Promise<void> {
  const reason = window.prompt(t("game1_master_stop_reason_prompt"), "") ?? "";
  if (!reason.trim()) {
    Toast.warning(t("game1_master_stop_reason_required"));
    return;
  }
  const ok = window.confirm(t("game1_master_stop_confirm"));
  if (!ok) return;
  await callAction(container, gameId, async () => {
    await stopGame1(gameId, reason);
  });
}

async function onExcludeHall(
  container: HTMLElement,
  gameId: string,
  hallId: string
): Promise<void> {
  if (!hallId) return;
  const reason = window.prompt(
    `${t("game1_master_exclude_reason_prompt")} (${hallId})`,
    ""
  ) ?? "";
  if (!reason.trim()) {
    Toast.warning(t("game1_master_exclude_reason_required"));
    return;
  }
  await callAction(container, gameId, async () => {
    await excludeGame1Hall(gameId, hallId, reason);
  });
}

async function onIncludeHall(
  container: HTMLElement,
  gameId: string,
  hallId: string
): Promise<void> {
  if (!hallId) return;
  await callAction(container, gameId, async () => {
    await includeGame1Hall(gameId, hallId);
  });
}

async function callAction(
  container: HTMLElement,
  gameId: string,
  fn: () => Promise<void>
): Promise<void> {
  try {
    await fn();
    Toast.success(t("saved"));
    await refresh(container, gameId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    Toast.error(msg);
  }
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

function statusBadge(status: string): string {
  const cls = (() => {
    switch (status) {
      case "running":
        return "label-success";
      case "ready_to_start":
        return "label-info";
      case "paused":
        return "label-warning";
      case "cancelled":
      case "completed":
        return "label-default";
      default:
        return "label-primary";
    }
  })();
  return `<span class="label ${cls}">${escapeHtml(status)}</span>`;
}

function hallStatusBadge(h: Game1HallDetail): string {
  if (h.excludedFromGame) {
    return `<span class="label label-danger">ekskludert${
      h.excludedReason ? `: ${escapeHtml(h.excludedReason)}` : ""
    }</span>`;
  }
  if (h.isReady) {
    return '<span class="label label-success">klar</span>';
  }
  return '<span class="label label-warning">venter</span>';
}
