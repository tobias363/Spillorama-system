// BIN-677 — /maintenance (liste over vedlikeholdsvinduer).
//
// Backend: GET /api/admin/maintenance returnerer `{ windows, count, active }`.
// Admin ser liste med edit-knapp per vindu og activate/deactivate-toggle
// på aktive rader. Max ett aktivt vindu av gangen håndheves av backend.

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import {
  boxClose,
  boxOpen,
  contentHeader,
  escapeHtml,
} from "../adminUsers/shared.js";
import {
  listMaintenanceWindows,
  setMaintenanceStatus,
  type MaintenanceListResponse,
  type MaintenanceWindow,
} from "../../api/admin-system-settings.js";
import { ApiError } from "../../api/client.js";

export function renderMaintenanceListPage(container: HTMLElement): void {
  container.innerHTML = `
    ${contentHeader("maintenance_list_title", "settings")}
    <section class="content">
      <div class="callout callout-info" data-testid="maintenance-wired-banner">
        <i class="fa fa-info-circle"></i>
        ${escapeHtml(t("maintenance_wired_banner"))}
      </div>
      ${boxOpen("maintenance_list_title", "primary")}
        <div class="row" style="margin-bottom:12px;">
          <div class="col-sm-12 text-right">
            <a class="btn btn-primary"
               href="#/maintenance/new"
               data-action="new-maintenance"
               data-testid="btn-new-maintenance">
              <i class="fa fa-plus"></i> ${escapeHtml(t("maintenance_new_window"))}
            </a>
          </div>
        </div>
        <div id="maintenance-body">${escapeHtml(t("loading_ellipsis"))}</div>
      ${boxClose()}
    </section>`;

  const host = container.querySelector<HTMLElement>("#maintenance-body")!;
  void mount(host);
}

async function mount(host: HTMLElement): Promise<void> {
  let data: MaintenanceListResponse;
  try {
    data = await listMaintenanceWindows();
  } catch (err) {
    const message = err instanceof ApiError ? err.message : t("something_went_wrong");
    host.innerHTML = `<div class="callout callout-danger" data-testid="maintenance-load-error">${escapeHtml(message)}</div>`;
    return;
  }

  host.innerHTML = renderBody(data);
  host.addEventListener("click", (ev) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    const btn = target.closest<HTMLElement>("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.windowId;
    if (!id) return;
    if (action === "activate") {
      if (!window.confirm(t("maintenance_confirm_activate"))) return;
      void toggle(host, id, "active");
    } else if (action === "deactivate") {
      void toggle(host, id, "inactive");
    }
  });
}

async function toggle(
  host: HTMLElement,
  id: string,
  status: "active" | "inactive"
): Promise<void> {
  try {
    await setMaintenanceStatus(id, status);
    Toast.success(
      status === "active"
        ? t("maintenance_window_activated")
        : t("maintenance_window_deactivated")
    );
    const fresh = await listMaintenanceWindows();
    host.innerHTML = renderBody(fresh);
  } catch (err) {
    const message = err instanceof ApiError ? err.message : t("something_went_wrong");
    Toast.error(message);
  }
}

function renderBody(data: MaintenanceListResponse): string {
  const activeBanner = data.active
    ? `
      <div class="callout callout-warning" data-testid="maintenance-active-banner">
        <h4><i class="fa fa-bolt"></i> ${escapeHtml(t("maintenance_active_window"))}</h4>
        <p><strong>${escapeHtml(data.active.message || "—")}</strong></p>
        <p>
          <code>${escapeHtml(data.active.maintenanceStart)}</code>
          → <code>${escapeHtml(data.active.maintenanceEnd)}</code>
        </p>
      </div>`
    : `<div class="callout callout-success" data-testid="maintenance-no-active-banner">
        <i class="fa fa-check"></i> ${escapeHtml(t("maintenance_no_active_window"))}
      </div>`;

  if (data.windows.length === 0) {
    return `${activeBanner}
      <p class="text-muted" data-testid="maintenance-empty">${escapeHtml(t("no_data_available_in_table"))}</p>`;
  }

  const rows = data.windows.map((w) => renderRow(w)).join("");

  return `
    ${activeBanner}
    <table class="table table-striped" data-testid="maintenance-table">
      <thead>
        <tr>
          <th>${escapeHtml(t("maintenance_status"))}</th>
          <th>${escapeHtml(t("maintenance_start_date"))}</th>
          <th>${escapeHtml(t("maintenance_end_date"))}</th>
          <th>${escapeHtml(t("show_before_minutes"))}</th>
          <th>${escapeHtml(t("maintenance_message"))}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>`;
}

function renderRow(w: MaintenanceWindow): string {
  const statusBadge =
    w.status === "active"
      ? `<span class="label label-success">${escapeHtml(t("active"))}</span>`
      : `<span class="label label-default">${escapeHtml(t("inactive"))}</span>`;

  const toggleBtn =
    w.status === "active"
      ? `<button type="button"
                 class="btn btn-warning btn-xs"
                 data-action="deactivate"
                 data-window-id="${escapeHtml(w.id)}"
                 data-testid="btn-deactivate-${escapeHtml(w.id)}">
          ${escapeHtml(t("maintenance_deactivate"))}
        </button>`
      : `<button type="button"
                 class="btn btn-success btn-xs"
                 data-action="activate"
                 data-window-id="${escapeHtml(w.id)}"
                 data-testid="btn-activate-${escapeHtml(w.id)}">
          ${escapeHtml(t("maintenance_activate"))}
        </button>`;

  return `
    <tr data-testid="maintenance-row-${escapeHtml(w.id)}">
      <td>${statusBadge}</td>
      <td><code>${escapeHtml(w.maintenanceStart)}</code></td>
      <td><code>${escapeHtml(w.maintenanceEnd)}</code></td>
      <td>${w.showBeforeMinutes}</td>
      <td>${escapeHtml(w.message || "—")}</td>
      <td class="text-right">
        ${toggleBtn}
        <a class="btn btn-default btn-xs"
           href="#/maintenance/edit/${encodeURIComponent(w.id)}"
           data-testid="btn-edit-${escapeHtml(w.id)}">
          <i class="fa fa-edit"></i> ${escapeHtml(t("edit"))}
        </a>
      </td>
    </tr>`;
}
