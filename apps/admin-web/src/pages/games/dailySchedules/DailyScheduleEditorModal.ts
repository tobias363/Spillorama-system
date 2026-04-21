// BIN-626: DailySchedule create/edit modal.
//
// Kjerne-felter (name, startDate, endDate, day OR weekDays-bitmask,
// hallId, hallIds, gameManagementId, startTime, endTime, status, specialGame).
// subgames lagres som JSON-array inntil BIN-621/627 normaliserer catalogen.

import { Modal, type ModalInstance } from "../../../components/Modal.js";
import { Toast } from "../../../components/Toast.js";
import { t } from "../../../i18n/I18n.js";
import { ApiError } from "../../../api/client.js";
import { escapeHtml } from "../common/escape.js";
import {
  fetchDailySchedule,
  saveDailySchedule,
  saveSpecialDailySchedule,
  maskFromDays,
  daysFromMask,
  WEEKDAY_MASKS,
  type DailyScheduleRow,
  type DailyScheduleFormPayload,
  type DailyScheduleSubgameSlot,
  type DailyScheduleStatus,
  type DailyScheduleDay,
  type DailyScheduleHallIds,
} from "./DailyScheduleState.js";

export interface OpenDailyScheduleEditorOpts {
  mode: "create" | "edit" | "special";
  /** Kun for edit-mode. */
  dailyScheduleId?: string;
  onSaved?: (row: DailyScheduleRow) => void;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^$|^[0-9]{2}:[0-9]{2}$/;

function readField(form: HTMLElement, id: string): string {
  const el = form.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    `#${id}`
  );
  return el ? el.value.trim() : "";
}

function readCheckbox(form: HTMLElement, id: string): boolean {
  const el = form.querySelector<HTMLInputElement>(`#${id}`);
  return el ? el.checked : false;
}

function setError(form: HTMLElement, message: string | null): void {
  const host = form.querySelector<HTMLElement>("#ds-editor-error");
  if (!host) return;
  if (!message) {
    host.style.display = "none";
    host.textContent = "";
    return;
  }
  host.textContent = message;
  host.style.display = "block";
}

function parseJsonArray<T>(raw: string): T[] | null {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  return parsed as T[];
}

function parseHallIds(
  master: string,
  hallsCsv: string,
  groupsCsv: string
): DailyScheduleHallIds | undefined {
  const hallIds = hallsCsv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const groupHallIds = groupsCsv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!master && hallIds.length === 0 && groupHallIds.length === 0) {
    return undefined;
  }
  const out: DailyScheduleHallIds = {};
  if (master) out.masterHallId = master;
  if (hallIds.length > 0) out.hallIds = hallIds;
  if (groupHallIds.length > 0) out.groupHallIds = groupHallIds;
  return out;
}

export async function openDailyScheduleEditorModal(
  opts: OpenDailyScheduleEditorOpts
): Promise<void> {
  const isEdit = opts.mode === "edit";
  const isSpecial = opts.mode === "special";
  let existing: DailyScheduleRow | null = null;
  if (isEdit && opts.dailyScheduleId) {
    try {
      existing = await fetchDailySchedule(opts.dailyScheduleId);
    } catch (err) {
      Toast.error(err instanceof ApiError ? err.message : t("something_went_wrong"));
      return;
    }
    if (!existing) {
      Toast.error(t("daily_schedule_not_found"));
      return;
    }
  }

  const body = document.createElement("div");
  body.innerHTML = renderForm(existing, isSpecial);

  const validate = (): DailyScheduleFormPayload | null => {
    setError(body, null);
    const name = readField(body, "ds-name");
    const startDate = readField(body, "ds-start-date");
    if (!name) {
      setError(body, t("please_fill_required_fields"));
      return null;
    }
    if (!DATE_RE.test(startDate)) {
      setError(body, t("invalid_date_format_yyyy_mm_dd"));
      return null;
    }
    const endDate = readField(body, "ds-end-date");
    if (endDate && !DATE_RE.test(endDate)) {
      setError(body, t("invalid_date_format_yyyy_mm_dd"));
      return null;
    }
    const startTime = readField(body, "ds-start-time");
    if (!TIME_RE.test(startTime)) {
      setError(body, t("invalid_time_format_hh_mm"));
      return null;
    }
    const endTime = readField(body, "ds-end-time");
    if (!TIME_RE.test(endTime)) {
      setError(body, t("invalid_time_format_hh_mm"));
      return null;
    }
    const dayVal = readField(body, "ds-day");
    const day = (dayVal || null) as DailyScheduleDay | null;

    const dayCheckboxes = (Object.keys(WEEKDAY_MASKS) as Array<keyof typeof WEEKDAY_MASKS>).filter(
      (k) => readCheckbox(body, `ds-wd-${k}`)
    );
    const weekDays = dayCheckboxes.length > 0 ? maskFromDays(dayCheckboxes) : 0;

    if (!day && weekDays === 0) {
      setError(body, t("select_at_least_one_weekday"));
      return null;
    }

    const gameManagementId = readField(body, "ds-game-management-id") || null;
    const hallId = readField(body, "ds-hall-id") || null;
    const masterHallId = readField(body, "ds-master-hall-id");
    const hallIdsRaw = readField(body, "ds-hall-ids");
    const groupHallIdsRaw = readField(body, "ds-group-hall-ids");
    const hallIds = parseHallIds(masterHallId, hallIdsRaw, groupHallIdsRaw);

    const status = (readField(body, "ds-status") || "active") as DailyScheduleStatus;
    if (!["active", "running", "finish", "inactive"].includes(status)) {
      setError(body, t("invalid_schedule_status"));
      return null;
    }

    const stopGame = readCheckbox(body, "ds-stop-game");
    const specialGame = isSpecial ? true : readCheckbox(body, "ds-special-game");

    const subRaw = readField(body, "ds-subgames");
    const subgames = parseJsonArray<DailyScheduleSubgameSlot>(subRaw);
    if (subgames === null) {
      setError(body, t("invalid_subgames_json"));
      return null;
    }

    const payload: DailyScheduleFormPayload = {
      name,
      startDate,
      startTime,
      endTime,
      weekDays,
      status,
      stopGame,
      specialGame,
      subgames,
    };
    if (endDate) payload.endDate = endDate;
    else payload.endDate = null;
    if (day) payload.day = day;
    if (gameManagementId) payload.gameManagementId = gameManagementId;
    if (hallId) payload.hallId = hallId;
    if (hallIds) payload.hallIds = hallIds;
    return payload;
  };

  const submit = async (instance: ModalInstance): Promise<void> => {
    const payload = validate();
    if (!payload) return;
    try {
      let row: DailyScheduleRow;
      if (isSpecial) {
        row = await saveSpecialDailySchedule(payload);
      } else {
        row = await saveDailySchedule(payload, existing?.id);
      }
      opts.onSaved?.(row);
      instance.close("button");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      setError(body, msg);
      Toast.error(msg);
    }
  };

  Modal.open({
    title: isEdit
      ? t("edit_daily_schedule")
      : isSpecial
        ? t("add_special_game")
        : t("create_daily_schedule"),
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

function renderForm(existing: DailyScheduleRow | null, isSpecial: boolean): string {
  const name = existing?.name ?? "";
  const startDate = existing?.startDate ?? new Date().toISOString().slice(0, 10);
  const endDate = existing?.endDate ?? "";
  const startTime = existing?.startTime ?? "";
  const endTime = existing?.endTime ?? "";
  const gameManagementId = existing?.gameManagementId ?? "";
  const hallId = existing?.hallId ?? "";
  const masterHallId = existing?.hallIds.masterHallId ?? "";
  const hallIdsList = (existing?.hallIds.hallIds ?? []).join(", ");
  const groupHallIdsList = (existing?.hallIds.groupHallIds ?? []).join(", ");
  const status: DailyScheduleStatus = existing?.status ?? "active";
  const stopGame = Boolean(existing?.stopGame);
  const specialGame = isSpecial || Boolean(existing?.specialGame);
  const day: DailyScheduleDay | "" = existing?.day ?? "";
  const activeMask = existing?.weekDays ?? 0;
  const activeDays = daysFromMask(activeMask);
  const subgamesJson = existing?.subgames ? JSON.stringify(existing.subgames, null, 2) : "[]";
  const dayKeys = Object.keys(WEEKDAY_MASKS) as Array<keyof typeof WEEKDAY_MASKS>;
  const weekdayCheckboxes = dayKeys
    .map((k) => {
      const checked = activeDays.includes(k) ? "checked" : "";
      return `
      <label class="checkbox-inline" style="margin-right:8px;">
        <input type="checkbox" id="ds-wd-${k}" value="${k}" ${checked}>
        ${escapeHtml(t(`weekday_${k}`))}
      </label>`;
    })
    .join("");

  return `
    <form id="ds-editor-form" novalidate>
      <div class="row">
        <div class="form-group col-sm-8">
          <label for="ds-name">${escapeHtml(t("schedules_name"))} *</label>
          <input type="text" id="ds-name" class="form-control" required
                 maxlength="200" value="${escapeHtml(name)}">
        </div>
        <div class="form-group col-sm-4">
          <label for="ds-status">${escapeHtml(t("status"))}</label>
          <select id="ds-status" class="form-control">
            <option value="active" ${status === "active" ? "selected" : ""}>${escapeHtml(t("active"))}</option>
            <option value="running" ${status === "running" ? "selected" : ""}>${escapeHtml(t("running"))}</option>
            <option value="finish" ${status === "finish" ? "selected" : ""}>${escapeHtml(t("finish"))}</option>
            <option value="inactive" ${status === "inactive" ? "selected" : ""}>${escapeHtml(t("inactive"))}</option>
          </select>
        </div>
      </div>
      <div class="row">
        <div class="form-group col-sm-6">
          <label for="ds-start-date">${escapeHtml(t("start_date"))} *</label>
          <input type="date" id="ds-start-date" class="form-control" required
                 value="${escapeHtml(startDate)}">
        </div>
        <div class="form-group col-sm-6">
          <label for="ds-end-date">${escapeHtml(t("end_date"))}</label>
          <input type="date" id="ds-end-date" class="form-control"
                 value="${escapeHtml(endDate)}">
        </div>
      </div>
      <div class="row">
        <div class="form-group col-sm-6">
          <label for="ds-start-time">${escapeHtml(t("start_time"))}</label>
          <input type="text" id="ds-start-time" class="form-control" placeholder="HH:MM"
                 pattern="^[0-9]{2}:[0-9]{2}$" value="${escapeHtml(startTime)}">
        </div>
        <div class="form-group col-sm-6">
          <label for="ds-end-time">${escapeHtml(t("end_time"))}</label>
          <input type="text" id="ds-end-time" class="form-control" placeholder="HH:MM"
                 pattern="^[0-9]{2}:[0-9]{2}$" value="${escapeHtml(endTime)}">
        </div>
      </div>
      <div class="form-group">
        <label>${escapeHtml(t("weekdays"))}</label>
        <div>${weekdayCheckboxes}</div>
        <p class="help-block">${escapeHtml(t("weekday_or_day_hint"))}</p>
      </div>
      <div class="row">
        <div class="form-group col-sm-4">
          <label for="ds-day">${escapeHtml(t("single_day"))}</label>
          <select id="ds-day" class="form-control">
            <option value="" ${!day ? "selected" : ""}>—</option>
            <option value="monday" ${day === "monday" ? "selected" : ""}>${escapeHtml(t("weekday_mon"))}</option>
            <option value="tuesday" ${day === "tuesday" ? "selected" : ""}>${escapeHtml(t("weekday_tue"))}</option>
            <option value="wednesday" ${day === "wednesday" ? "selected" : ""}>${escapeHtml(t("weekday_wed"))}</option>
            <option value="thursday" ${day === "thursday" ? "selected" : ""}>${escapeHtml(t("weekday_thu"))}</option>
            <option value="friday" ${day === "friday" ? "selected" : ""}>${escapeHtml(t("weekday_fri"))}</option>
            <option value="saturday" ${day === "saturday" ? "selected" : ""}>${escapeHtml(t("weekday_sat"))}</option>
            <option value="sunday" ${day === "sunday" ? "selected" : ""}>${escapeHtml(t("weekday_sun"))}</option>
          </select>
        </div>
        <div class="form-group col-sm-4">
          <label for="ds-hall-id">${escapeHtml(t("hall_id_optional"))}</label>
          <input type="text" id="ds-hall-id" class="form-control" maxlength="200"
                 value="${escapeHtml(hallId)}">
        </div>
        <div class="form-group col-sm-4">
          <label for="ds-game-management-id">${escapeHtml(t("game_management_id_optional"))}</label>
          <input type="text" id="ds-game-management-id" class="form-control" maxlength="200"
                 value="${escapeHtml(gameManagementId)}">
        </div>
      </div>
      <fieldset style="border:1px solid #ddd;padding:8px 12px;margin-bottom:12px;">
        <legend style="font-size:14px;width:auto;padding:0 4px;">${escapeHtml(t("multi_hall_settings"))}</legend>
        <div class="row">
          <div class="form-group col-sm-4">
            <label for="ds-master-hall-id">${escapeHtml(t("master_hall_id"))}</label>
            <input type="text" id="ds-master-hall-id" class="form-control" maxlength="200"
                   value="${escapeHtml(masterHallId)}">
          </div>
          <div class="form-group col-sm-4">
            <label for="ds-hall-ids">${escapeHtml(t("halls_csv"))}</label>
            <input type="text" id="ds-hall-ids" class="form-control" placeholder="hall-1,hall-2"
                   value="${escapeHtml(hallIdsList)}">
          </div>
          <div class="form-group col-sm-4">
            <label for="ds-group-hall-ids">${escapeHtml(t("group_hall_ids_csv"))}</label>
            <input type="text" id="ds-group-hall-ids" class="form-control" placeholder="group-1,group-2"
                   value="${escapeHtml(groupHallIdsList)}">
          </div>
        </div>
      </fieldset>
      <div class="row">
        <div class="form-group col-sm-6">
          <label class="checkbox-inline">
            <input type="checkbox" id="ds-stop-game" ${stopGame ? "checked" : ""}>
            ${escapeHtml(t("stop_schedule"))}
          </label>
        </div>
        <div class="form-group col-sm-6">
          <label class="checkbox-inline">
            <input type="checkbox" id="ds-special-game" ${specialGame ? "checked" : ""}
                   ${isSpecial ? "disabled" : ""}>
            ${escapeHtml(t("special_game"))}
          </label>
        </div>
      </div>
      <div class="form-group">
        <label for="ds-subgames">${escapeHtml(t("sub_games"))} (JSON)</label>
        <textarea id="ds-subgames" class="form-control" rows="5"
                  spellcheck="false" style="font-family:monospace;font-size:12px;">${escapeHtml(subgamesJson)}</textarea>
        <p class="help-block">${escapeHtml(t("subgames_json_hint"))}</p>
      </div>
      <p id="ds-editor-error" class="help-block"
         style="color:#a94442;display:none;margin-top:4px;"></p>
    </form>`;
}
