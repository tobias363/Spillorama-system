// BIN-625: Schedule create/edit modal.
//
// Kjerne-felter (scheduleName, scheduleType, luckyNumberPrize, manualStart/End,
// subGames[]). subGames serialiseres som JSON-array inntil den fulle
// nested builderen (legacy create.html = 5 382L) portes som follow-up.
//
// Feil fra backend (INVALID_INPUT, FORBIDDEN, NOT_FOUND) overflates via
// ApiError.message.

import { Modal, type ModalInstance } from "../../../components/Modal.js";
import { Toast } from "../../../components/Toast.js";
import { t } from "../../../i18n/I18n.js";
import { ApiError } from "../../../api/client.js";
import { escapeHtml } from "../common/escape.js";
import {
  fetchSchedule,
  saveSchedule,
  type ScheduleRow,
  type ScheduleFormPayload,
  type ScheduleSubgame,
  type ScheduleType,
  type ScheduleStatus,
} from "./ScheduleState.js";

export interface OpenScheduleEditorModalOptions {
  mode: "create" | "edit";
  /** Kun for edit-mode. */
  scheduleId?: string;
  /** Kalles når en mal er opprettet/oppdatert. */
  onSaved?: (row: ScheduleRow) => void;
}

const TIME_RE = /^$|^[0-9]{2}:[0-9]{2}$/;

function readField(form: HTMLElement, id: string): string {
  const el = form.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    `#${id}`
  );
  return el ? el.value.trim() : "";
}

function setError(form: HTMLElement, message: string | null): void {
  const host = form.querySelector<HTMLElement>("#schedule-editor-error");
  if (!host) return;
  if (!message) {
    host.style.display = "none";
    host.textContent = "";
    return;
  }
  host.textContent = message;
  host.style.display = "block";
}

function parseSubGames(raw: string): ScheduleSubgame[] | null {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  return parsed as ScheduleSubgame[];
}

export async function openScheduleEditorModal(
  opts: OpenScheduleEditorModalOptions
): Promise<void> {
  const isEdit = opts.mode === "edit";
  let existing: ScheduleRow | null = null;
  if (isEdit && opts.scheduleId) {
    try {
      existing = await fetchSchedule(opts.scheduleId);
    } catch (err) {
      Toast.error(err instanceof ApiError ? err.message : t("something_went_wrong"));
      return;
    }
    if (!existing) {
      Toast.error(t("schedule_not_found"));
      return;
    }
  }

  const body = document.createElement("div");
  body.innerHTML = renderForm(existing);

  const validate = (): ScheduleFormPayload | null => {
    setError(body, null);
    const scheduleName = readField(body, "sch-name");
    if (!scheduleName) {
      setError(body, t("please_fill_required_fields"));
      return null;
    }
    const scheduleType = (readField(body, "sch-type") || "Auto") as ScheduleType;
    if (scheduleType !== "Auto" && scheduleType !== "Manual") {
      setError(body, t("invalid_schedule_type"));
      return null;
    }
    const luckyRaw = readField(body, "sch-lucky");
    const luckyNumberPrize = luckyRaw ? Number(luckyRaw) : 0;
    if (luckyRaw && !Number.isFinite(luckyNumberPrize)) {
      setError(body, t("invalid_lucky_number_prize"));
      return null;
    }
    const manualStartTime = readField(body, "sch-start");
    const manualEndTime = readField(body, "sch-end");
    if (!TIME_RE.test(manualStartTime)) {
      setError(body, t("invalid_time_format_hh_mm"));
      return null;
    }
    if (!TIME_RE.test(manualEndTime)) {
      setError(body, t("invalid_time_format_hh_mm"));
      return null;
    }
    const status = (readField(body, "sch-status") || "active") as ScheduleStatus;
    if (status !== "active" && status !== "inactive") {
      setError(body, t("invalid_schedule_status"));
      return null;
    }
    const subRaw = readField(body, "sch-subgames");
    const subGames = parseSubGames(subRaw);
    if (subGames === null) {
      setError(body, t("invalid_subgames_json"));
      return null;
    }
    return {
      scheduleName,
      scheduleType,
      luckyNumberPrize: Math.max(0, Math.trunc(luckyNumberPrize)),
      status,
      manualStartTime,
      manualEndTime,
      subGames,
    };
  };

  const submit = async (instance: ModalInstance): Promise<void> => {
    const payload = validate();
    if (!payload) return;
    try {
      const row = await saveSchedule(payload, existing?.id);
      opts.onSaved?.(row);
      instance.close("button");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      setError(body, msg);
      Toast.error(msg);
    }
  };

  Modal.open({
    title: isEdit ? t("edit_schedule") : t("create_schedule"),
    content: body,
    size: "lg",
    backdrop: "static",
    keyboard: true,
    buttons: [
      { label: t("no_cancle"), variant: "default", action: "cancel" },
      {
        label: isEdit ? t("save_changes") : t("create"),
        variant: "primary",
        action: "confirm",
        dismiss: false,
        onClick: submit,
      },
    ],
  });
}

function renderForm(existing: ScheduleRow | null): string {
  const name = existing?.scheduleName ?? "";
  const type: ScheduleType = existing?.scheduleType ?? "Auto";
  const lucky = existing?.luckyNumberPrize ?? 0;
  const start = existing?.manualStartTime ?? "";
  const end = existing?.manualEndTime ?? "";
  const status: ScheduleStatus = existing?.status ?? "active";
  const subgamesJson = existing?.subGames ? JSON.stringify(existing.subGames, null, 2) : "[]";
  return `
    <form id="schedule-editor-form" novalidate>
      <div class="form-group">
        <label for="sch-name">${escapeHtml(t("schedules_name"))} *</label>
        <input type="text" id="sch-name" class="form-control" required
               maxlength="200" value="${escapeHtml(name)}">
      </div>
      <div class="row">
        <div class="form-group col-sm-6">
          <label for="sch-type">${escapeHtml(t("schedules_type"))}</label>
          <select id="sch-type" class="form-control">
            <option value="Auto" ${type === "Auto" ? "selected" : ""}>${escapeHtml(t("auto"))}</option>
            <option value="Manual" ${type === "Manual" ? "selected" : ""}>${escapeHtml(t("manual"))}</option>
          </select>
        </div>
        <div class="form-group col-sm-6">
          <label for="sch-status">${escapeHtml(t("status"))}</label>
          <select id="sch-status" class="form-control">
            <option value="active" ${status === "active" ? "selected" : ""}>${escapeHtml(t("active"))}</option>
            <option value="inactive" ${status === "inactive" ? "selected" : ""}>${escapeHtml(t("inactive"))}</option>
          </select>
        </div>
      </div>
      <div class="row">
        <div class="form-group col-sm-4">
          <label for="sch-lucky">${escapeHtml(t("lucky_number_prize"))}</label>
          <input type="number" id="sch-lucky" class="form-control" min="0" step="1"
                 value="${escapeHtml(String(lucky))}">
        </div>
        <div class="form-group col-sm-4">
          <label for="sch-start">${escapeHtml(t("manual_start_time"))}</label>
          <input type="text" id="sch-start" class="form-control" placeholder="HH:MM"
                 pattern="^[0-9]{2}:[0-9]{2}$" value="${escapeHtml(start)}">
        </div>
        <div class="form-group col-sm-4">
          <label for="sch-end">${escapeHtml(t("manual_end_time"))}</label>
          <input type="text" id="sch-end" class="form-control" placeholder="HH:MM"
                 pattern="^[0-9]{2}:[0-9]{2}$" value="${escapeHtml(end)}">
        </div>
      </div>
      <div class="form-group">
        <label for="sch-subgames">${escapeHtml(t("sub_games"))} (JSON)</label>
        <textarea id="sch-subgames" class="form-control" rows="5"
                  spellcheck="false" style="font-family:monospace;font-size:12px;">${escapeHtml(subgamesJson)}</textarea>
        <p class="help-block">${escapeHtml(t("subgames_json_hint"))}</p>
      </div>
      <p id="schedule-editor-error" class="help-block"
         style="color:#a94442;display:none;margin-top:4px;"></p>
    </form>`;
}
