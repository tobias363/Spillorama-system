// ADMIN Super-User Operations Console — main page.
//
// Path: /admin/ops
//
// Layout (4 sections):
//   ┌─ Header (live-status, totals, alerts-count) ────────────┐
//   │ Halls grid (4-column desktop, 1-2 mobile) │ Alerts side │
//   │ Group-of-Halls aggregate row              │ Quick-acts  │
//
// Live-data:
//   - REST GET /api/admin/ops/overview på mount + manual refresh.
//   - Socket.IO `admin:ops:update` patcher delta inn i state-store.
//   - Disconnect-fallback: 10s grace → REST polling hver 5s til reconnect.
//
// Auto-refresh-interval bare i fallback-modus. Når socket er koblet,
// drives UI utelukkende av push.
//
// Confirm-modaler for alle force-actions (pause/resume/end/skip/disable).
// Toast-feedback etter API-svar.
//
// RBAC: ADMIN + super-admin (sjekkes på backend; routen er ikke synlig
// for andre roller i sidebar). Frontend gir best-effort 403 hvis fanget.

import "./adminOps.css";

import * as Modal from "../../components/Modal.js";
import * as Toast from "../../components/Toast.js";
import { ApiError } from "../../api/client.js";
import {
  acknowledgeAlert,
  disableHall,
  enableHall,
  fetchOverview,
  forceEndRoom,
  forcePauseRoom,
  forceResumeRoom,
  skipBall,
  type OpsAlert,
  type OpsHall,
  type OpsRoom,
  type OpsOverviewDelta,
} from "../../api/admin-ops.js";
import { t } from "../../i18n/I18n.js";
import { computeHealthBadge, type HealthBadge } from "./healthBadge.js";
import {
  applyDelta,
  createInitialState,
  replaceSnapshot,
  roomsByHallId,
  type OpsState,
} from "./opsState.js";
import {
  createAdminOpsSocket,
  type AdminOpsSocketHandle,
} from "./adminOpsSocket.js";

// ── Public mount-API ─────────────────────────────────────────────────────

export interface AdminOpsConsoleHandle {
  /** Manually refresh overview (used by tests + Refresh-button). */
  refresh: () => Promise<void>;
  /** Apply a socket delta directly (used by tests to avoid io). */
  applyDelta: (delta: OpsOverviewDelta) => void;
  /** Cleanup — call before unmount. */
  dispose: () => void;
}

export interface AdminOpsConsoleOptions {
  /** Inject a fake socket-factory for tests. */
  _socketFactory?: typeof createAdminOpsSocket;
  /** Inject a fake fetch for tests (bypasses fetchOverview). */
  _fetchOverview?: typeof fetchOverview;
  /** Polling interval when in REST-fallback mode (ms). Default 5000. */
  fallbackPollMs?: number;
}

export function renderAdminOpsConsolePage(
  container: HTMLElement,
  options: AdminOpsConsoleOptions = {}
): AdminOpsConsoleHandle {
  const state = createInitialState();
  const socketFactory = options._socketFactory ?? createAdminOpsSocket;
  const fetchOverviewImpl = options._fetchOverview ?? fetchOverview;
  const fallbackPollMs = options.fallbackPollMs ?? 5_000;

  container.innerHTML = scaffoldHtml();
  const refs = bindRefs(container);

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let socketHandle: AdminOpsSocketHandle | null = null;
  let disposed = false;

  const refresh = async (): Promise<void> => {
    if (disposed) return;
    try {
      const snapshot = await fetchOverviewImpl();
      replaceSnapshot(state, snapshot);
      renderAll(state, refs, handlers);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      state.lastError = msg;
      renderErrorBanner(refs, msg);
    }
  };

  const handlers: ActionHandlers = {
    onPauseRoom: (room, hall) =>
      confirmAndRun({
        title: `Pause ${hall.name}?`,
        body: `Spillet i rommet ${room.code} pauses umiddelbart for alle spillere.`,
        confirmLabel: t("ops_action_pause"),
        variant: "warning",
        run: async () => {
          await forcePauseRoom(room.code);
          Toast.show(`Pauset ${hall.name}`, "success");
          await refresh();
        },
      }),
    onResumeRoom: (room, hall) =>
      confirmAndRun({
        title: `Resume ${hall.name}?`,
        body: `Spillet i rommet ${room.code} fortsetter trekkingen.`,
        confirmLabel: t("ops_action_resume"),
        variant: "primary",
        run: async () => {
          await forceResumeRoom(room.code);
          Toast.show(`Gjenopptok ${hall.name}`, "success");
          await refresh();
        },
      }),
    onForceEndRoom: (room, hall) =>
      confirmWithReason({
        title: `Force-stopp ${hall.name}?`,
        body: `Avslutter rommet ${room.code} permanent. Pågående trekning forkastes — ingen videre utbetalinger fra denne runden.`,
        confirmLabel: t("ops_action_force_end"),
        variant: "danger",
        run: async (reason) => {
          await forceEndRoom(room.code, reason);
          Toast.show(`Stoppet ${hall.name}`, "success");
          await refresh();
        },
      }),
    onSkipBall: (room, hall) =>
      confirmAndRun({
        title: `Hopp over ball i ${hall.name}?`,
        body: `Trekker neste ball manuelt — bruk kun hvis trekningen står fast.`,
        confirmLabel: t("ops_action_skip_ball"),
        variant: "warning",
        run: async () => {
          await skipBall(room.code);
          Toast.show(`Hoppet over ball i ${hall.name}`, "success");
          await refresh();
        },
      }),
    onDisableHall: (hall) =>
      confirmWithReason({
        title: `Sett ${hall.name} ut av drift?`,
        body: `Hallen vil ikke kunne starte nye runder før den aktiveres på nytt.`,
        confirmLabel: t("ops_action_disable_hall"),
        variant: "danger",
        run: async (reason) => {
          await disableHall(hall.id, reason);
          Toast.show(`${hall.name} satt ut av drift`, "success");
          await refresh();
        },
      }),
    onEnableHall: (hall) =>
      confirmAndRun({
        title: `Aktiver ${hall.name}?`,
        body: `Hallen blir tilgjengelig for nye runder igjen.`,
        confirmLabel: t("ops_action_enable_hall"),
        variant: "success",
        run: async () => {
          await enableHall(hall.id);
          Toast.show(`${hall.name} aktivert`, "success");
          await refresh();
        },
      }),
    onAcknowledgeAlert: async (alert) => {
      try {
        await acknowledgeAlert(alert.id);
        Toast.show(t("ops_alert_acknowledged"), "success");
        await refresh();
      } catch (err) {
        showApiError(err);
      }
    },
    onPauseAll: () =>
      confirmAndRun({
        title: t("ops_action_pause_all_title"),
        body: t("ops_action_pause_all_body"),
        confirmLabel: t("ops_action_pause_all"),
        variant: "danger",
        run: async () => {
          // Pause all running rooms in sequence — backend should ideally
          // expose a single batch-endpoint. Until then, fan out.
          const running = state.rooms.filter(
            (r) => r.currentGame?.status === "RUNNING"
          );
          let ok = 0;
          for (const room of running) {
            try {
              await forcePauseRoom(room.code);
              ok += 1;
            } catch {
              /* logged via toast below */
            }
          }
          Toast.show(`Pauset ${ok}/${running.length} rom`, ok === running.length ? "success" : "warning");
          await refresh();
        },
      }),
    onSearchHall: (query) => {
      const q = query.trim().toLowerCase();
      refs.hallsGrid.querySelectorAll<HTMLElement>("[data-hall-id]").forEach((card) => {
        const name = (card.dataset.hallName ?? "").toLowerCase();
        const num = (card.dataset.hallNumber ?? "").toLowerCase();
        const visible = q === "" || name.includes(q) || num.includes(q);
        card.style.display = visible ? "" : "none";
      });
    },
    onDrillDownHall: (hall, room) => openDrilldownModal(hall, room),
  };

  // Wire toolbar
  refs.refreshBtn.addEventListener("click", () => {
    void refresh();
  });
  refs.searchInput.addEventListener("input", (ev) => {
    const target = ev.currentTarget as HTMLInputElement;
    handlers.onSearchHall(target.value);
  });
  refs.pauseAllBtn.addEventListener("click", () => {
    void handlers.onPauseAll();
  });

  // Socket
  const startPolling = (): void => {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      void refresh();
    }, fallbackPollMs);
  };
  const stopPolling = (): void => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  socketHandle = socketFactory({
    onUpdate: (delta) => {
      applyDelta(state, delta);
      renderAll(state, refs, handlers);
    },
    onSnapshot: (snapshot) => {
      replaceSnapshot(state, snapshot);
      renderAll(state, refs, handlers);
    },
    onFallbackActive: (active) => {
      if (active) {
        renderConnectionBanner(refs, false);
        startPolling();
      } else {
        renderConnectionBanner(refs, true);
        stopPolling();
        void refresh();
      }
    },
  });

  // Initial fetch
  void refresh();

  return {
    refresh,
    applyDelta: (delta) => {
      applyDelta(state, delta);
      renderAll(state, refs, handlers);
    },
    dispose: () => {
      disposed = true;
      stopPolling();
      socketHandle?.dispose();
      socketHandle = null;
    },
  };
}

// ── Internal helpers ─────────────────────────────────────────────────────

interface PageRefs {
  root: HTMLElement;
  totals: HTMLElement;
  alertsBadge: HTMLElement;
  connectionBanner: HTMLElement;
  errorBanner: HTMLElement;
  refreshBtn: HTMLButtonElement;
  searchInput: HTMLInputElement;
  pauseAllBtn: HTMLButtonElement;
  hallsGrid: HTMLElement;
  groupsRow: HTMLElement;
  alertsList: HTMLElement;
}

interface ActionHandlers {
  onPauseRoom: (room: OpsRoom, hall: OpsHall) => Promise<void> | void;
  onResumeRoom: (room: OpsRoom, hall: OpsHall) => Promise<void> | void;
  onForceEndRoom: (room: OpsRoom, hall: OpsHall) => Promise<void> | void;
  onSkipBall: (room: OpsRoom, hall: OpsHall) => Promise<void> | void;
  onDisableHall: (hall: OpsHall) => Promise<void> | void;
  onEnableHall: (hall: OpsHall) => Promise<void> | void;
  onAcknowledgeAlert: (alert: OpsAlert) => Promise<void> | void;
  onPauseAll: () => Promise<void> | void;
  onSearchHall: (query: string) => void;
  onDrillDownHall: (hall: OpsHall, room: OpsRoom | null) => void;
}

function scaffoldHtml(): string {
  return `
    <section class="content-header">
      <h1 data-testid="ops-page-title">${escape(t("ops_console_title"))}
        <small>${escape(t("ops_console_subtitle"))}</small>
      </h1>
    </section>
    <section class="content">
      <div class="row">
        <div class="col-lg-9 col-md-9 col-sm-12">
          <!-- Header / metrics -->
          <div class="box box-primary">
            <div class="box-header with-border">
              <div class="row">
                <div class="col-sm-6">
                  <span data-testid="ops-totals" id="ops-totals" class="ops-totals"></span>
                </div>
                <div class="col-sm-6 text-right">
                  <span id="ops-connection-banner" class="label label-success" style="margin-right:8px;" data-testid="ops-connection-banner">${escape(connectionLabel(true))}</span>
                  <button id="ops-refresh-btn" type="button" class="btn btn-default btn-sm" data-testid="ops-refresh-btn">
                    <i class="fa fa-refresh"></i> ${escape(t("ops_refresh"))}
                  </button>
                </div>
              </div>
              <div id="ops-error-banner" class="alert alert-danger" style="display:none;margin-top:8px;" data-testid="ops-error-banner"></div>
            </div>

            <!-- Halls grid -->
            <div class="box-body">
              <div id="ops-halls-grid" class="row" data-testid="ops-halls-grid"></div>
            </div>

            <!-- Group aggregate row -->
            <div class="box-footer">
              <h4 style="margin-top:0;">${escape(t("ops_group_aggregate_title"))}</h4>
              <div id="ops-groups-row" class="row" data-testid="ops-groups-row"></div>
            </div>
          </div>
        </div>

        <!-- Alerts side panel -->
        <div class="col-lg-3 col-md-3 col-sm-12">
          <div class="box box-warning">
            <div class="box-header with-border">
              <h3 class="box-title">
                <i class="fa fa-bell"></i> ${escape(t("ops_alerts_title"))}
                <span id="ops-alerts-badge" class="badge bg-red" data-testid="ops-alerts-badge">0</span>
              </h3>
            </div>
            <div class="box-body" style="max-height:400px;overflow-y:auto;">
              <ul id="ops-alerts-list" class="list-unstyled" data-testid="ops-alerts-list" style="margin:0;padding:0;"></ul>
            </div>
            <div class="box-footer">
              <h5 style="margin-top:0;">${escape(t("ops_quick_actions_title"))}</h5>
              <div style="display:flex;flex-direction:column;gap:6px;">
                <button id="ops-pause-all-btn" type="button" class="btn btn-warning btn-block" data-testid="ops-pause-all-btn">
                  <i class="fa fa-pause"></i> ${escape(t("ops_action_pause_all"))}
                </button>
                <input id="ops-search-input" type="search" class="form-control" placeholder="${escape(t("ops_search_placeholder"))}" data-testid="ops-search-input">
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function bindRefs(container: HTMLElement): PageRefs {
  return {
    root: container,
    totals: requireEl(container, "#ops-totals"),
    alertsBadge: requireEl(container, "#ops-alerts-badge"),
    connectionBanner: requireEl(container, "#ops-connection-banner"),
    errorBanner: requireEl(container, "#ops-error-banner"),
    refreshBtn: requireEl<HTMLButtonElement>(container, "#ops-refresh-btn"),
    searchInput: requireEl<HTMLInputElement>(container, "#ops-search-input"),
    pauseAllBtn: requireEl<HTMLButtonElement>(container, "#ops-pause-all-btn"),
    hallsGrid: requireEl(container, "#ops-halls-grid"),
    groupsRow: requireEl(container, "#ops-groups-row"),
    alertsList: requireEl(container, "#ops-alerts-list"),
  };
}

function requireEl<T extends HTMLElement = HTMLElement>(
  root: ParentNode,
  selector: string
): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`AdminOpsConsolePage: missing element ${selector}`);
  return el;
}

// ── Renderers ────────────────────────────────────────────────────────────

function renderAll(state: OpsState, refs: PageRefs, handlers: ActionHandlers): void {
  renderTotals(refs, state);
  renderAlertsBadge(refs, state.alerts);
  renderHallsGrid(refs, state, handlers);
  renderGroupsRow(refs, state);
  renderAlertsList(refs, state.alerts, handlers);
  if (!state.lastError) {
    refs.errorBanner.style.display = "none";
  }
}

function renderTotals(refs: PageRefs, state: OpsState): void {
  const { totalActiveRooms, totalPlayersOnline } = state.metrics;
  const alertsCount = state.alerts.filter((a) => a.acknowledgedAt === null).length;
  // Inline numeric values directly so tests + screen-readers can always find
  // the count, even when the i18n-template string is missing or untranslated.
  // Format: `<count> <label-template>` — t() returns the template (e.g. "Total: {count} rom"),
  // and we splice the count back in. If t() falls back to the bare key, we
  // still render `<count> <key>` so the count is visible in the DOM.
  refs.totals.innerHTML = `
    <strong data-testid="ops-totals-rooms">${formatLabelWithCount("ops_total_rooms", totalActiveRooms)}</strong>
    &middot;
    <strong data-testid="ops-totals-players">${formatLabelWithCount("ops_total_players", totalPlayersOnline)}</strong>
    &middot;
    <strong data-testid="ops-totals-alerts">${formatLabelWithCount("ops_total_alerts", alertsCount)}</strong>
  `;
}

function formatLabelWithCount(key: string, count: number): string {
  const template = t(key);
  if (template.includes("{count}")) {
    return escape(template.replace("{count}", String(count)));
  }
  // Fallback: bare key returned (i18n missing). Append count after the key
  // so the data-testid still surfaces a numeric value to tests + a11y.
  return `${escape(template)} ${count}`;
}

function renderAlertsBadge(refs: PageRefs, alerts: OpsAlert[]): void {
  const open = alerts.filter((a) => a.acknowledgedAt === null);
  refs.alertsBadge.textContent = String(open.length);
  refs.alertsBadge.className =
    open.some((a) => a.severity === "CRITICAL")
      ? "badge bg-red"
      : open.some((a) => a.severity === "WARN")
        ? "badge bg-yellow"
        : "badge bg-light-blue";
}

function renderHallsGrid(refs: PageRefs, state: OpsState, handlers: ActionHandlers): void {
  if (state.halls.length === 0 && !state.loaded) {
    refs.hallsGrid.innerHTML = `
      <div class="col-xs-12">
        <div class="text-center text-muted" style="padding:40px;" data-testid="ops-loading-skeleton">
          <i class="fa fa-spinner fa-spin fa-2x"></i>
          <p style="margin-top:8px;">${escape(t("ops_loading"))}</p>
        </div>
      </div>
    `;
    return;
  }
  if (state.halls.length === 0) {
    refs.hallsGrid.innerHTML = `
      <div class="col-xs-12">
        <p class="text-muted text-center" style="padding:40px;" data-testid="ops-empty-state">${escape(t("ops_no_halls"))}</p>
      </div>
    `;
    return;
  }

  const roomMap = roomsByHallId(state.rooms);
  refs.hallsGrid.innerHTML = state.halls.map((hall) => {
    const room = roomMap.get(hall.id) ?? null;
    return renderHallCard(hall, room);
  }).join("");

  // Bind events for each card
  refs.hallsGrid.querySelectorAll<HTMLElement>("[data-hall-id]").forEach((card) => {
    const hallId = card.dataset.hallId ?? "";
    const hall = state.halls.find((h) => h.id === hallId);
    if (!hall) return;
    const room = roomMap.get(hallId) ?? null;

    card.querySelector<HTMLElement>("[data-action='drilldown']")?.addEventListener("click", () => {
      handlers.onDrillDownHall(hall, room);
    });
    card.querySelector<HTMLButtonElement>("[data-action='pause']")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (room) void handlers.onPauseRoom(room, hall);
    });
    card.querySelector<HTMLButtonElement>("[data-action='resume']")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (room) void handlers.onResumeRoom(room, hall);
    });
    card.querySelector<HTMLButtonElement>("[data-action='end']")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (room) void handlers.onForceEndRoom(room, hall);
    });
    card.querySelector<HTMLButtonElement>("[data-action='skip']")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (room) void handlers.onSkipBall(room, hall);
    });
    card.querySelector<HTMLButtonElement>("[data-action='disable']")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      void handlers.onDisableHall(hall);
    });
    card.querySelector<HTMLButtonElement>("[data-action='enable']")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      void handlers.onEnableHall(hall);
    });
  });
}

function renderHallCard(hall: OpsHall, room: OpsRoom | null): string {
  const badge = computeHealthBadge(hall, room);
  const room$ = room?.currentGame
    ? `${escape(room.code)} · ${escape(badge.label)}`
    : escape(t("ops_idle"));
  const playersTxt = `${hall.playersOnline} ${t("ops_players_short")}`;
  const showPause = room?.currentGame?.status === "RUNNING";
  const showResume = room?.currentGame?.status === "PAUSED" || room?.currentGame?.isPaused === true;
  const showEnd = room?.currentGame !== null && room?.currentGame?.status !== "ENDED";
  const showSkip = badge.color === "red" && badge.label === "Stuck";

  return `
    <div class="col-lg-3 col-md-4 col-sm-6 col-xs-12" style="margin-bottom:12px;">
      <div class="ops-hall-card box box-${colorToBoxClass(badge.color)}"
        data-hall-id="${escape(hall.id)}"
        data-hall-name="${escape(hall.name)}"
        data-hall-number="${escape(String(hall.hallNumber ?? ""))}"
        data-health-color="${badge.color}"
        data-testid="ops-hall-card-${escape(hall.id)}"
        style="cursor:pointer;">
        <div class="box-header with-border" data-action="drilldown">
          <h4 class="box-title">
            <span class="ops-health-dot ops-dot-${badge.color}" aria-hidden="true"
              data-testid="ops-health-dot-${escape(hall.id)}"></span>
            ${escape(hall.name)}
            ${hall.isTestHall ? `<small class="text-muted">(test)</small>` : ""}
          </h4>
          <div class="box-tools">
            <small class="text-muted">${escape(hall.groupName ?? "—")}</small>
          </div>
        </div>
        <div class="box-body" data-action="drilldown">
          <p style="margin:0;"><strong>${escape(badge.label)}</strong></p>
          <p class="text-muted" style="margin:4px 0;">${escape(room$)}</p>
          <p class="text-muted" style="margin:0;">${escape(playersTxt)}</p>
          <p class="text-muted" style="margin:4px 0 0 0;font-size:11px;" title="${escape(badge.reason)}">${escape(truncate(badge.reason, 60))}</p>
        </div>
        <div class="box-footer text-right" style="padding:6px;">
          ${
            hall.isActive
              ? `
            ${showPause ? `<button type="button" class="btn btn-xs btn-warning" data-action="pause" title="${escape(t("ops_action_pause"))}"><i class="fa fa-pause"></i></button>` : ""}
            ${showResume ? `<button type="button" class="btn btn-xs btn-primary" data-action="resume" title="${escape(t("ops_action_resume"))}"><i class="fa fa-play"></i></button>` : ""}
            ${showSkip ? `<button type="button" class="btn btn-xs btn-default" data-action="skip" title="${escape(t("ops_action_skip_ball"))}"><i class="fa fa-step-forward"></i></button>` : ""}
            ${showEnd ? `<button type="button" class="btn btn-xs btn-danger" data-action="end" title="${escape(t("ops_action_force_end"))}"><i class="fa fa-stop"></i></button>` : ""}
            <button type="button" class="btn btn-xs btn-default" data-action="disable" title="${escape(t("ops_action_disable_hall"))}"><i class="fa fa-power-off"></i></button>
          `
              : `
            <button type="button" class="btn btn-xs btn-success" data-action="enable">
              <i class="fa fa-power-off"></i> ${escape(t("ops_action_enable_hall"))}
            </button>
          `
          }
        </div>
      </div>
    </div>
  `;
}

function colorToBoxClass(color: HealthBadge["color"]): string {
  switch (color) {
    case "green":
      return "success";
    case "yellow":
      return "warning";
    case "red":
      return "danger";
    case "inactive":
      return "default";
  }
}

function renderGroupsRow(refs: PageRefs, state: OpsState): void {
  if (state.groups.length === 0) {
    refs.groupsRow.innerHTML = `<div class="col-xs-12 text-muted">${escape(t("ops_no_groups"))}</div>`;
    return;
  }
  refs.groupsRow.innerHTML = state.groups.map((group) => {
    const badgeClass =
      group.readyAggregate === null
        ? "label-default"
        : group.readyAggregate.startsWith("0/")
          ? "label-danger"
          : group.readyAggregate.includes("/") &&
              isFullReady(group.readyAggregate)
            ? "label-success"
            : "label-warning";
    return `
      <div class="col-md-4 col-sm-6 col-xs-12" data-testid="ops-group-${escape(group.id)}" style="margin-bottom:8px;">
        <strong>${escape(group.name)}</strong>
        <span class="label ${badgeClass}" style="margin-left:6px;">
          ${escape(group.readyAggregate ?? "—")}
        </span>
        <span class="text-muted" style="margin-left:8px;">
          ${escape(formatNok(group.totalPayoutToday))} kr
        </span>
        <small class="text-muted" style="margin-left:6px;">${group.hallCount} haller</small>
      </div>
    `;
  }).join("");
}

function isFullReady(agg: string): boolean {
  const m = /^(\d+)\/(\d+)$/.exec(agg);
  if (!m) return false;
  return m[1] === m[2];
}

function renderAlertsList(refs: PageRefs, alerts: OpsAlert[], handlers: ActionHandlers): void {
  if (alerts.length === 0) {
    refs.alertsList.innerHTML = `<li class="text-muted" data-testid="ops-no-alerts" style="padding:8px;">${escape(t("ops_no_alerts"))}</li>`;
    return;
  }
  refs.alertsList.innerHTML = alerts.map((a) => renderAlertItem(a)).join("");
  refs.alertsList.querySelectorAll<HTMLButtonElement>("[data-action='ack']").forEach((btn) => {
    const id = btn.dataset.alertId ?? "";
    const alert = alerts.find((a) => a.id === id);
    if (!alert) return;
    btn.addEventListener("click", () => {
      void handlers.onAcknowledgeAlert(alert);
    });
  });
}

function renderAlertItem(alert: OpsAlert): string {
  const sevIcon = alert.severity === "CRITICAL" ? "🔴" : alert.severity === "WARN" ? "🟡" : "🔵";
  const acked = alert.acknowledgedAt !== null;
  return `
    <li data-testid="ops-alert-${escape(alert.id)}" data-severity="${alert.severity}" style="padding:8px;border-bottom:1px solid #eee;${acked ? "opacity:0.5;" : ""}">
      <div>
        <span style="font-size:14px;">${sevIcon}</span>
        <strong>${escape(alert.type)}</strong>
        ${alert.hallId ? `<small class="text-muted">${escape(alert.hallId)}</small>` : ""}
      </div>
      <div style="font-size:12px;margin:4px 0;">${escape(alert.message)}</div>
      <div style="font-size:11px;color:#999;">${escape(formatRelativeTime(alert.createdAt))}</div>
      ${
        !acked && alert.severity !== "INFO"
          ? `<button type="button" class="btn btn-xs btn-default" data-action="ack" data-alert-id="${escape(alert.id)}" style="margin-top:4px;">${escape(t("ops_alert_ack_btn"))}</button>`
          : ""
      }
    </li>
  `;
}

function renderConnectionBanner(refs: PageRefs, connected: boolean): void {
  refs.connectionBanner.textContent = connectionLabel(connected);
  refs.connectionBanner.className = connected ? "label label-success" : "label label-warning";
}

/**
 * Returns the connection-status label (e.g. "🟢 Live" or "🟡 Polling")
 * with a stable English fallback. Always includes "Live"/"Polling" in the
 * output so tests + screen-readers can detect state without i18n loaded.
 */
function connectionLabel(connected: boolean): string {
  const key = connected ? "ops_connection_live" : "ops_connection_polling";
  const stable = connected ? "Live" : "Polling";
  const label = t(key);
  return label.includes(stable) ? label : `${label} (${stable})`;
}

function renderErrorBanner(refs: PageRefs, message: string): void {
  refs.errorBanner.textContent = `${t("ops_error_prefix")}: ${message}`;
  refs.errorBanner.style.display = "";
}

// ── Confirm modals ──────────────────────────────────────────────────────

interface ConfirmAndRunOptions {
  title: string;
  body: string;
  confirmLabel: string;
  variant: "primary" | "warning" | "danger" | "success";
  run: () => Promise<void>;
}

function confirmAndRun(opts: ConfirmAndRunOptions): void {
  const instance = Modal.open({
    title: opts.title,
    content: `<p>${escape(opts.body)}</p>`,
    backdrop: "static",
    keyboard: false,
    buttons: [
      { label: t("cancel"), variant: "default", action: "cancel" },
      {
        label: opts.confirmLabel,
        variant: opts.variant,
        action: "confirm",
        onClick: async () => {
          try {
            await opts.run();
          } catch (err) {
            showApiError(err);
          } finally {
            instance.close("button");
          }
        },
        dismiss: false,
      },
    ],
  });
}

interface ConfirmWithReasonOptions {
  title: string;
  body: string;
  confirmLabel: string;
  variant: "primary" | "warning" | "danger" | "success";
  run: (reason: string) => Promise<void>;
}

function confirmWithReason(opts: ConfirmWithReasonOptions): void {
  const reasonId = `ops-reason-${Date.now()}`;
  const html = `
    <p>${escape(opts.body)}</p>
    <div class="form-group" style="margin-top:12px;">
      <label for="${reasonId}">${escape(t("ops_reason_label"))}</label>
      <textarea id="${reasonId}" class="form-control" rows="3" required data-testid="ops-reason-input"></textarea>
    </div>
  `;
  let runningHandler = false;
  const instance = Modal.open({
    title: opts.title,
    content: html,
    backdrop: "static",
    keyboard: false,
    buttons: [
      { label: t("cancel"), variant: "default", action: "cancel" },
      {
        label: opts.confirmLabel,
        variant: opts.variant,
        action: "confirm",
        onClick: async () => {
          if (runningHandler) return;
          const textarea = instance.root.querySelector<HTMLTextAreaElement>(`#${reasonId}`);
          const reason = (textarea?.value ?? "").trim();
          if (reason.length < 3) {
            Toast.show(t("ops_reason_required"), "warning");
            return;
          }
          runningHandler = true;
          try {
            await opts.run(reason);
          } catch (err) {
            showApiError(err);
          } finally {
            runningHandler = false;
            instance.close("button");
          }
        },
        dismiss: false,
      },
    ],
  });
}

function openDrilldownModal(hall: OpsHall, room: OpsRoom | null): void {
  const game = room?.currentGame;
  const status = game?.status ?? "—";
  const drawn = game?.drawnNumbersCount ?? 0;
  const max = game?.maxDraws ?? 75;
  const replayHref = game?.id ? `#/admin/replay/${encodeURIComponent(game.id)}` : null;
  const hopIntoHallHref = `#/hall/edit/${encodeURIComponent(hall.id)}`;

  const html = `
    <h4 style="margin-top:0;">${escape(hall.name)}</h4>
    <dl class="dl-horizontal" style="margin-bottom:8px;">
      <dt>${escape(t("ops_drill_hall_id"))}</dt><dd>${escape(hall.id)}</dd>
      <dt>${escape(t("ops_drill_group"))}</dt><dd>${escape(hall.groupName ?? "—")}</dd>
      <dt>${escape(t("ops_drill_master_hall"))}</dt><dd>${escape(hall.masterHallId ?? "—")}</dd>
      <dt>${escape(t("ops_drill_status"))}</dt><dd>${escape(status)}</dd>
      <dt>${escape(t("ops_drill_progress"))}</dt><dd>${drawn}/${max}</dd>
      <dt>${escape(t("ops_drill_room_code"))}</dt><dd>${escape(room?.code ?? "—")}</dd>
      <dt>${escape(t("ops_drill_last_draw"))}</dt><dd>${escape(room?.lastDrawAt ?? "—")}</dd>
      <dt>${escape(t("ops_drill_players"))}</dt><dd>${hall.playersOnline}</dd>
      <dt>${escape(t("ops_drill_active"))}</dt><dd>${hall.isActive ? "✓" : "✗"}</dd>
    </dl>
    <hr>
    <div>
      <a href="${escape(hopIntoHallHref)}" class="btn btn-default btn-sm" data-testid="ops-drill-hop-link">
        <i class="fa fa-external-link"></i> ${escape(t("ops_drill_hop_btn"))}
      </a>
      ${
        replayHref
          ? `<a href="${escape(replayHref)}" class="btn btn-default btn-sm" data-testid="ops-drill-replay-link" style="margin-left:6px;">
              <i class="fa fa-history"></i> ${escape(t("ops_drill_replay_btn"))}
            </a>`
          : ""
      }
    </div>
  `;
  Modal.open({
    title: t("ops_drill_title"),
    content: html,
    size: "lg",
    buttons: [{ label: t("close"), variant: "default", action: "close" }],
  });
}

// ── Utilities ────────────────────────────────────────────────────────────

function showApiError(err: unknown): void {
  if (err instanceof ApiError) {
    Toast.show(`${err.code}: ${err.message}`, "error");
  } else if (err instanceof Error) {
    Toast.show(err.message, "error");
  } else {
    Toast.show(t("ops_error_unknown"), "error");
  }
}

function escape(s: string | null | undefined): string {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function formatNok(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 0 }).format(n);
}

function formatRelativeTime(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const diff = Date.now() - ms;
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return new Date(ms).toLocaleString("nb-NO");
}
