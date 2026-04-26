// BIN-677 — /maintenance/new og /maintenance/edit/:id.
//
// Opprett eller rediger et maintenance-vindu. Formet deler UI mellom create
// (POST /api/admin/maintenance) og update (PUT /api/admin/maintenance/:id).
// Aktiv-invariant (max ett aktivt av gangen) håndheves i backend.
//
// UX-valg: <input type="datetime-local"> for start/slutt — vi konverterer
// til/fra ISO-8601 ved load/submit. showBeforeMinutes 0-10080 (7 dager).

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import {
  boxClose,
  boxOpen,
  contentHeader,
  escapeHtml,
} from "../adminUsers/shared.js";
import {
  createMaintenanceWindow,
  getMaintenanceWindow,
  updateMaintenanceWindow,
  type MaintenanceWindow,
} from "../../api/admin-system-settings.js";
import { ApiError } from "../../api/client.js";

export function renderMaintenanceFormPage(container: HTMLElement, id: string | null): void {
  const titleKey = id ? "maintenance_management" : "maintenance_new_window";
  container.innerHTML = `
    ${contentHeader(titleKey, "settings")}
    <section class="content">
      <div class="callout callout-info" data-testid="maintenance-wired-banner">
        <i class="fa fa-info-circle" aria-hidden="true"></i>
        ${escapeHtml(t("maintenance_wired_banner"))}
      </div>
      ${boxOpen(titleKey, "primary")}
        <div id="maintenance-form-host">${escapeHtml(t("loading_ellipsis"))}</div>
      ${boxClose()}
    </section>`;

  const host = container.querySelector<HTMLElement>("#maintenance-form-host")!;
  void mount(host, id);
}

async function mount(host: HTMLElement, id: string | null): Promise<void> {
  let existing: MaintenanceWindow | null = null;
  if (id) {
    try {
      existing = await getMaintenanceWindow(id);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t("something_went_wrong");
      host.innerHTML = `<div class="callout callout-danger" data-testid="maintenance-load-error">${escapeHtml(message)}</div>`;
      return;
    }
  }

  host.innerHTML = renderForm(existing);

  const form = host.querySelector<HTMLFormElement>("#maintenance-form")!;
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void submit(form, id);
  });
}

function renderForm(w: MaintenanceWindow | null): string {
  const startDefault = w ? isoToLocalInput(w.maintenanceStart) : "";
  const endDefault = w ? isoToLocalInput(w.maintenanceEnd) : "";
  const idRow = w
    ? `
      <div class="form-group">
        <label class="col-sm-3 control-label">${escapeHtml(t("maintenance_window_id"))}</label>
        <div class="col-sm-9">
          <p class="form-control-static"><code data-testid="mf-id">${escapeHtml(w.id)}</code></p>
        </div>
      </div>`
    : "";
  const activatedRow =
    w && w.activatedAt
      ? `<div class="form-group">
          <label class="col-sm-3 control-label">${escapeHtml(t("maintenance_activated_at"))}</label>
          <div class="col-sm-9"><p class="form-control-static"><code>${escapeHtml(w.activatedAt)}</code></p></div>
        </div>`
      : "";
  const deactivatedRow =
    w && w.deactivatedAt
      ? `<div class="form-group">
          <label class="col-sm-3 control-label">${escapeHtml(t("maintenance_deactivated_at"))}</label>
          <div class="col-sm-9"><p class="form-control-static"><code>${escapeHtml(w.deactivatedAt)}</code></p></div>
        </div>`
      : "";
  return `
    <form id="maintenance-form" class="form-horizontal" data-testid="maintenance-form">
      ${idRow}
      <div class="form-group">
        <label class="col-sm-3 control-label" for="mf-start">${escapeHtml(t("maintenance_start_date"))}</label>
        <div class="col-sm-9">
          <input type="datetime-local" id="mf-start" name="maintenance_start"
            class="form-control" required
            data-testid="mf-start"
            value="${escapeHtml(startDefault)}">
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-3 control-label" for="mf-end">${escapeHtml(t("maintenance_end_date"))}</label>
        <div class="col-sm-9">
          <input type="datetime-local" id="mf-end" name="maintenance_end"
            class="form-control" required
            data-testid="mf-end"
            value="${escapeHtml(endDefault)}">
          <p class="help-block"><small>${escapeHtml(t("maintenance_form_times_help"))}</small></p>
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-3 control-label" for="mf-show-before">${escapeHtml(t("show_before_minutes"))}</label>
        <div class="col-sm-9">
          <input type="number" id="mf-show-before" name="showBeforeMinutes"
            class="form-control" min="0" max="10080" required
            data-testid="mf-show-before"
            value="${escapeHtml(String(w?.showBeforeMinutes ?? 60))}">
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-3 control-label" for="mf-message">${escapeHtml(t("maintenance_message"))}</label>
        <div class="col-sm-9">
          <textarea id="mf-message" name="message" class="form-control" rows="4"
            maxlength="2000" data-testid="mf-message">${escapeHtml(w?.message ?? "")}</textarea>
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-3 control-label" for="mf-status">${escapeHtml(t("maintenance_status"))}</label>
        <div class="col-sm-9">
          <select id="mf-status" name="status" class="form-control" data-testid="mf-status">
            <option value="inactive"${w?.status === "inactive" || !w ? " selected" : ""}>${escapeHtml(t("inactive"))}</option>
            <option value="active"${w?.status === "active" ? " selected" : ""}>${escapeHtml(t("active"))}</option>
          </select>
        </div>
      </div>
      ${activatedRow}
      ${deactivatedRow}
      <div class="form-group">
        <div class="col-sm-offset-3 col-sm-9">
          <button type="submit" class="btn btn-success" data-action="save-maintenance" data-testid="btn-save-maintenance">
            <i class="fa fa-save" aria-hidden="true"></i> ${escapeHtml(w ? t("save") : t("maintenance_create"))}
          </button>
          <a class="btn btn-default" href="#/maintenance">${escapeHtml(t("cancel"))}</a>
        </div>
      </div>
    </form>`;
}

async function submit(form: HTMLFormElement, id: string | null): Promise<void> {
  const startLocal = (form.querySelector<HTMLInputElement>("#mf-start")!).value.trim();
  const endLocal = (form.querySelector<HTMLInputElement>("#mf-end")!).value.trim();
  const message = (form.querySelector<HTMLTextAreaElement>("#mf-message")!).value;
  const showBeforeMinutes = Number(
    (form.querySelector<HTMLInputElement>("#mf-show-before")!).value
  );
  const status = (form.querySelector<HTMLSelectElement>("#mf-status")!).value as
    | "active"
    | "inactive";

  if (!startLocal || !endLocal) {
    Toast.error(t("something_went_wrong"));
    return;
  }

  const body = {
    maintenanceStart: localInputToIso(startLocal),
    maintenanceEnd: localInputToIso(endLocal),
    message,
    showBeforeMinutes,
    status,
  };

  try {
    if (id) {
      await updateMaintenanceWindow(id, body);
      Toast.success(t("maintenance_window_updated"));
    } else {
      await createMaintenanceWindow(body);
      Toast.success(t("maintenance_window_created"));
    }
    window.location.hash = "#/maintenance";
  } catch (err) {
    const message = err instanceof ApiError ? err.message : t("something_went_wrong");
    Toast.error(message);
  }
}

/**
 * Konverterer ISO-8601 fra backend til `YYYY-MM-DDTHH:mm` som `<input
 * type="datetime-local">` forstår. Bruker lokal tidssone i Date.
 */
function isoToLocalInput(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Konverterer `YYYY-MM-DDTHH:mm` (datetime-local) → full ISO-8601 (UTC).
 */
function localInputToIso(local: string): string {
  if (!local) return "";
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}
