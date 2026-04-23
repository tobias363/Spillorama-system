// BIN-625: Schedule create/edit modal.
//
// Kjerne-felter (scheduleName, scheduleType, luckyNumberPrize, manualStart/End,
// subGames[]). subGames redigeres som strukturert rad-liste
// (SubGamesListEditor) som default — power-brukere kan fortsatt hoppe til
// rå JSON-textarea via "Vis JSON"-toggle. Begge moder serialiserer til
// samme shape før POST, så backend-kontrakten er uendret.
//
// Feil fra backend (INVALID_INPUT, FORBIDDEN, NOT_FOUND) overflates via
// ApiError.message.
//
// PR 4e.2 (2026-04-22): lagt til "Eksempel"-knapp og "Valider JSON"-knapp
// som hjelp for JSON-fallback-modus.
//
// Fix/schedule-structured-subgames (2026-04-23): bytt default fra rå JSON-
// textarea til strukturert rad-liste. "Vis JSON"-toggle beholder fallback
// for power-brukere.

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
import {
  mountSubGamesListEditor,
  type SubGamesListEditorHandle,
} from "./SubGamesListEditor.js";

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

/**
 * PR 4e.2: inline status for subGames-validering. Typer:
 * "ok" = grønn, "error" = rød, "info" = nøytral grå.
 */
function setSubgamesStatus(
  form: HTMLElement,
  kind: "ok" | "error" | "info",
  message: string
): void {
  const host = form.querySelector<HTMLElement>("#sch-subgames-status");
  if (!host) return;
  host.textContent = message;
  host.style.display = "block";
  const color = kind === "ok" ? "#3c763d" : kind === "error" ? "#a94442" : "#555";
  host.style.color = color;
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

  const initialSubGames: ScheduleSubgame[] = existing?.subGames ?? [];

  // Mount strukturert liste-editor i #sch-subgames-list.
  const listHost = body.querySelector<HTMLElement>("#sch-subgames-list");
  let listHandle: SubGamesListEditorHandle | null = null;
  if (listHost) {
    listHandle = mountSubGamesListEditor(listHost, initialSubGames);
  }

  // Fyll JSON-textarea med samme initial-data slik at toggle funker fra start.
  const jsonTextarea = body.querySelector<HTMLTextAreaElement>("#sch-subgames");
  if (jsonTextarea) {
    jsonTextarea.value = JSON.stringify(initialSubGames, null, 2);
  }

  // "Vis JSON"-toggle: veksler mellom strukturert liste og rå JSON-textarea.
  // Når vi bytter retning sync'er vi dataene så brukeren ikke mister input.
  // "json" = power-user JSON-textarea, "list" = strukturert (default).
  let mode: "list" | "json" = "list";
  const listPanel = body.querySelector<HTMLElement>("#sch-subgames-list-panel");
  const jsonPanel = body.querySelector<HTMLElement>("#sch-subgames-json-panel");
  const toggleBtn = body.querySelector<HTMLButtonElement>("#sch-subgames-toggle");

  function updateToggleLabel(): void {
    if (!toggleBtn) return;
    toggleBtn.textContent =
      mode === "list"
        ? t("schedule_subgames_show_json_btn")
        : t("schedule_subgames_show_list_btn");
  }

  function setPanelVisibility(): void {
    if (listPanel) listPanel.style.display = mode === "list" ? "block" : "none";
    if (jsonPanel) jsonPanel.style.display = mode === "json" ? "block" : "none";
  }
  setPanelVisibility();
  updateToggleLabel();

  if (toggleBtn) {
    toggleBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      if (mode === "list") {
        // Bytt til JSON: hent fra liste → skriv til textarea.
        try {
          const list = listHandle?.getSubGames() ?? [];
          if (jsonTextarea) jsonTextarea.value = JSON.stringify(list, null, 2);
        } catch (err) {
          // Hvis list-state er ugyldig, vis feil men la brukeren bytte
          // til JSON så de kan fikse der.
          const msg = err instanceof Error ? err.message : String(err);
          setSubgamesStatus(body, "error", msg);
        }
        mode = "json";
      } else {
        // Bytt til liste: parse JSON → populer liste.
        if (jsonTextarea) {
          const parsed = parseSubGames(jsonTextarea.value);
          if (parsed === null) {
            setSubgamesStatus(body, "error", t("invalid_subgames_json"));
            return;
          }
          listHandle?.setSubGames(parsed);
        }
        mode = "list";
        setSubgamesStatus(body, "info", "");
        // Clear status ved vellykket bytte tilbake.
        const statusHost = body.querySelector<HTMLElement>("#sch-subgames-status");
        if (statusHost) {
          statusHost.textContent = "";
          statusHost.style.display = "none";
        }
      }
      setPanelVisibility();
      updateToggleLabel();
    });
  }

  // PR 4e.2: event-handlers for subGames JSON-hjelpe-knapper (kun JSON-modus).
  const exampleBtn = body.querySelector<HTMLButtonElement>("#sch-subgames-example");
  if (exampleBtn) {
    exampleBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      const textarea = body.querySelector<HTMLTextAreaElement>("#sch-subgames");
      if (!textarea) return;
      // Minimal eksempel — én subgame med typiske felter (gameManagementId +
      // startTime + endTime). Pilot-bruk kan starte fra dette skjemaet.
      const example = [
        {
          gameManagementId: "<gameManagementId>",
          startTime: "10:00",
          endTime: "11:00",
        },
      ];
      textarea.value = JSON.stringify(example, null, 2);
      setSubgamesStatus(body, "info", t("schedule_subgames_example_inserted"));
    });
  }
  const validateBtn = body.querySelector<HTMLButtonElement>("#sch-subgames-validate");
  if (validateBtn) {
    validateBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      const textarea = body.querySelector<HTMLTextAreaElement>("#sch-subgames");
      if (!textarea) return;
      const raw = textarea.value.trim();
      if (!raw) {
        setSubgamesStatus(body, "info", t("schedule_subgames_validate_empty"));
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
          setSubgamesStatus(body, "error", t("schedule_subgames_validate_not_array"));
          return;
        }
        setSubgamesStatus(
          body,
          "ok",
          `${t("schedule_subgames_validate_ok")} (${parsed.length})`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setSubgamesStatus(body, "error", `${t("schedule_subgames_validate_error")}: ${msg}`);
      }
    });
  }

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

    // Sub-games: hent fra aktiv modus (list eller JSON) og valider.
    let subGames: ScheduleSubgame[];
    if (mode === "list" && listHandle) {
      const listError = listHandle.validate();
      if (listError) {
        setError(body, listError);
        return null;
      }
      try {
        subGames = listHandle.getSubGames();
      } catch (err) {
        setError(body, err instanceof Error ? err.message : String(err));
        return null;
      }
    } else {
      const subRaw = readField(body, "sch-subgames");
      const parsed = parseSubGames(subRaw);
      if (parsed === null) {
        setError(body, t("invalid_subgames_json"));
        return null;
      }
      subGames = parsed;
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
  // JSON-textarea tømmes initielt — fylles programmatic fra
  // openScheduleEditorModal så samme kilde brukes for liste og JSON.
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
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <label>${escapeHtml(t("sub_games"))}</label>
          <button type="button" id="sch-subgames-toggle" class="btn btn-xs btn-link"
                  style="padding:0;">
            ${escapeHtml(t("schedule_subgames_show_json_btn"))}
          </button>
        </div>
        <div id="sch-subgames-list-panel">
          <div id="sch-subgames-list"></div>
        </div>
        <div id="sch-subgames-json-panel" style="display:none;">
          <textarea id="sch-subgames" class="form-control" rows="5"
                    spellcheck="false" style="font-family:monospace;font-size:12px;"></textarea>
          <div style="margin-top:4px;">
            <button type="button" id="sch-subgames-example" class="btn btn-xs btn-default">
              ${escapeHtml(t("schedule_subgames_example_btn"))}
            </button>
            <button type="button" id="sch-subgames-validate" class="btn btn-xs btn-default">
              ${escapeHtml(t("schedule_subgames_validate_btn"))}
            </button>
          </div>
          <p class="help-block" style="margin-top:4px;">${escapeHtml(t("subgames_json_hint"))}</p>
        </div>
        <p id="sch-subgames-status" class="help-block"
           style="display:none;margin-top:4px;font-size:12px;"></p>
      </div>
      <p id="schedule-editor-error" class="help-block"
         style="color:#a94442;display:none;margin-top:4px;"></p>
    </form>`;
}
