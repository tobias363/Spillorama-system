// BIN-626 + GAME1_SCHEDULE PR2: DailySchedule create/edit modal.
//
// Kjerne-felter (name, startDate, endDate, day OR weekDays-bitmask,
// hallId, hallIds, gameManagementId, startTime, endTime, status, specialGame).
// subgames lagres som JSON-array inntil BIN-621/627 normaliserer catalogen.
//
// GAME1_SCHEDULE PR 2: `scheduleId` (scalar) + `scheduleIdByDay` (per-dag
// mapping) lagres i `otherData` slik at backend-scheduler-ticken kan
// spawne Game 1-rader fra riktig schedule-mal. KK-flagget at
// `app_daily_schedules` ikke har eksplisitt FK til `app_schedules`; inntil
// det rettes opp i et eget BIN bruker vi `other_data.scheduleId` /
// `other_data.scheduleIdByDay` som første-klasses signal. Admin-UI laster
// schedule-liste ved modal-åpning og presenterer dropdown.
//
// PR 4e.2 (2026-04-22): erstattet fri-tekst CSV-felt for master-hall +
// hall-IDs + group-hall-IDs med dropdown + multi-select basert på
// `listHalls()` + `listHallGroups()`. Admin slipper å vite UUID utenat,
// og pre-fyller med hallene fra valgt gruppe. Validerer at alle hallIds
// er medlemmer av minst én valgt gruppe (soft-warn, ikke hard-feil, siden
// group-picker kan pre-fylle men bruker kan overstyre).

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
import { listSchedules, type ScheduleRow } from "../../../api/admin-schedules.js";
import { listHalls, type AdminHall } from "../../../api/admin-halls.js";
import {
  listHallGroups,
  type HallGroupRow,
} from "../../../api/admin-hall-groups.js";
import {
  listSubGames,
  type AdminSubGame,
} from "../../../api/admin-sub-games.js";

/**
 * GAME1_SCHEDULE PR 2: weekday-nøkler matcher backend
 * `resolveScheduleIdForDay` (JS `Date.getUTCDay`-indeksering). Backend
 * aksepterer både korte (mon, tue, …) og lange (monday, …) varianter —
 * vi bruker lange her for konsistens med øvrige admin-UI felter.
 */
const SCHEDULE_ID_WEEKDAYS: readonly DailyScheduleDay[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

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

/**
 * PR 4e.2: les alle markerte options fra `<select multiple>`.
 * Returnerer unike verdier i selection-rekkefølge.
 */
function readMultiSelect(form: HTMLElement, id: string): string[] {
  const el = form.querySelector<HTMLSelectElement>(`#${id}`);
  if (!el) return [];
  const values: string[] = [];
  for (const opt of Array.from(el.selectedOptions)) {
    const v = opt.value.trim();
    if (v && !values.includes(v)) values.push(v);
  }
  return values;
}

function buildHallIds(
  master: string,
  hallIds: string[],
  groupHallIds: string[]
): DailyScheduleHallIds | undefined {
  if (!master && hallIds.length === 0 && groupHallIds.length === 0) {
    return undefined;
  }
  const out: DailyScheduleHallIds = {};
  if (master) out.masterHallId = master;
  if (hallIds.length > 0) out.hallIds = hallIds;
  if (groupHallIds.length > 0) out.groupHallIds = groupHallIds;
  return out;
}

/**
 * GAME1_SCHEDULE PR 2: hent scheduleId + scheduleIdByDay fra existing
 * otherData. Returnerer tomme strenger hvis ikke satt.
 */
function readScheduleIdFromOtherData(
  otherData: Record<string, unknown> | undefined
): {
  scheduleId: string;
  scheduleIdByDay: Partial<Record<DailyScheduleDay, string>>;
} {
  if (!otherData || typeof otherData !== "object") {
    return { scheduleId: "", scheduleIdByDay: {} };
  }
  const scheduleId =
    typeof otherData.scheduleId === "string" ? otherData.scheduleId : "";
  const raw = otherData.scheduleIdByDay;
  const byDay: Partial<Record<DailyScheduleDay, string>> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const map = raw as Record<string, unknown>;
    for (const day of SCHEDULE_ID_WEEKDAYS) {
      const v = map[day];
      if (typeof v === "string" && v.trim()) {
        byDay[day] = v.trim();
      }
    }
  }
  return { scheduleId, scheduleIdByDay: byDay };
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

  // GAME1_SCHEDULE PR 2: hent alle aktive schedule-maler for dropdown.
  // Soft-fail — viser fortsatt modal uten scheduleId-felt hvis API-ikke-tilgjengelig.
  let scheduleMalList: ScheduleRow[] = [];
  try {
    const res = await listSchedules({ status: "active", limit: 200 });
    scheduleMalList = Array.isArray(res?.schedules) ? res.schedules : [];
  } catch (err) {
    // Ikke-kritisk — scheduleId er fortsatt valgfritt manuelt inntastet i fallback.
    scheduleMalList = [];
  }

  // PR 4e.2: last haller + hall-grupper for dropdown/multi-select.
  // Soft-fail — modalen fungerer fortsatt (med tom liste) hvis API feiler.
  let hallList: AdminHall[] = [];
  try {
    const halls = await listHalls({ includeInactive: false });
    hallList = Array.isArray(halls) ? halls : [];
  } catch {
    hallList = [];
  }
  let hallGroupList: HallGroupRow[] = [];
  try {
    const groups = await listHallGroups({ status: "active", limit: 200 });
    hallGroupList = Array.isArray(groups?.groups) ? groups.groups : [];
  } catch {
    hallGroupList = [];
  }

  // Pilot UX-fix (BIN-PILOT P0): last alle aktive sub-games slik at admin
  // kan velge fra liste i stedet for å skrive subGameId-strenger i JSON.
  // Soft-fail — modalen faller tilbake til JSON-textarea hvis API feiler.
  let subGameList: AdminSubGame[] = [];
  try {
    const res = await listSubGames({ status: "active", limit: 500 });
    subGameList = Array.isArray(res?.subGames) ? res.subGames : [];
  } catch {
    subGameList = [];
  }

  const otherDataInitial = (existing?.otherData ?? {}) as Record<string, unknown>;
  const scheduleIdState = readScheduleIdFromOtherData(otherDataInitial);

  // Pilot UX-fix: snapshot av eksisterende subgames-slots så vi kan
  // gjenopprette ticketPrice/prizePool/extra på sub-games som re-velges
  // i dropdown-modus.
  const existingSubgameSlots: DailyScheduleSubgameSlot[] = Array.isArray(existing?.subgames)
    ? (existing!.subgames as DailyScheduleSubgameSlot[])
    : [];

  const body = document.createElement("div");
  body.innerHTML = renderForm(
    existing,
    isSpecial,
    scheduleMalList,
    scheduleIdState,
    hallList,
    hallGroupList,
    subGameList
  );

  // Pilot UX-fix: toggle mellom dropdown-modus (default) og JSON-modus
  // (advanced). Når dropdown-modus er aktiv, regenereres JSON-textarea
  // automatisk fra valgte checkbokser ved submit.
  const toggleBtn = body.querySelector<HTMLButtonElement>("#ds-subgames-toggle");
  const dropdownPane = body.querySelector<HTMLElement>("#ds-subgames-dropdown");
  const jsonPane = body.querySelector<HTMLElement>("#ds-subgames-json-pane");
  if (toggleBtn && dropdownPane && jsonPane) {
    toggleBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      const isJsonVisible = jsonPane.style.display !== "none";
      if (isJsonVisible) {
        // Bytt til dropdown
        jsonPane.style.display = "none";
        dropdownPane.style.display = "";
        toggleBtn.textContent = t("schedule_subgames_advanced_edit_json");
      } else {
        // Bytt til JSON — synkroniser textarea fra checkboxes først.
        syncSubgamesJsonFromCheckboxes(body, subGameList, existingSubgameSlots);
        jsonPane.style.display = "";
        dropdownPane.style.display = "none";
        toggleBtn.textContent = t("schedule_subgames_show_dropdown");
      }
    });
  }

  // PR 4e.2: når admin velger en hall-gruppe, pre-fyll hallIds + master-hall
  // med gruppens medlemmer (bruker kan overstyre etterpå).
  const groupSelect = body.querySelector<HTMLSelectElement>("#ds-group-hall-ids");
  if (groupSelect) {
    groupSelect.addEventListener("change", () => {
      const selectedGroupIds = readMultiSelect(body, "ds-group-hall-ids");
      if (selectedGroupIds.length === 0) return;
      // Union av medlemshaller for alle valgte grupper.
      const memberHallIds = new Set<string>();
      for (const gid of selectedGroupIds) {
        const grp = hallGroupList.find((g) => g.id === gid);
        if (!grp) continue;
        for (const m of grp.members) {
          memberHallIds.add(m.hallId);
        }
      }
      if (memberHallIds.size === 0) return;
      // Pre-velg i hallIds-multi-select.
      const hallSelect = body.querySelector<HTMLSelectElement>("#ds-hall-ids");
      if (hallSelect) {
        for (const opt of Array.from(hallSelect.options)) {
          if (memberHallIds.has(opt.value)) opt.selected = true;
        }
      }
      // Pre-velg master-hall-dropdown hvis ikke satt manuelt.
      const masterSelect = body.querySelector<HTMLSelectElement>("#ds-master-hall-id");
      if (masterSelect && !masterSelect.value) {
        for (const opt of Array.from(masterSelect.options)) {
          if (memberHallIds.has(opt.value)) {
            masterSelect.value = opt.value;
            break;
          }
        }
      }
    });
  }

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
    // PR 4e.2: dropdown + multi-select for master-hall, hallIds, groupHallIds.
    const masterHallId = readField(body, "ds-master-hall-id");
    const selectedHallIds = readMultiSelect(body, "ds-hall-ids");
    const selectedGroupHallIds = readMultiSelect(body, "ds-group-hall-ids");
    const hallIds = buildHallIds(masterHallId, selectedHallIds, selectedGroupHallIds);

    // PR 4e.2: soft-validering — hvis bruker har valgt både grupper og haller,
    // advar hvis en valgt hall ikke er medlem av noen valgt gruppe. Dette er
    // som regel user-error (gruppe-pre-fylling ble overstyrt).
    if (selectedGroupHallIds.length > 0 && selectedHallIds.length > 0) {
      const memberUnion = new Set<string>();
      for (const gid of selectedGroupHallIds) {
        const grp = hallGroupList.find((g) => g.id === gid);
        if (grp) {
          for (const m of grp.members) memberUnion.add(m.hallId);
        }
      }
      const orphanHallIds = selectedHallIds.filter((hid) => !memberUnion.has(hid));
      if (orphanHallIds.length > 0) {
        setError(
          body,
          `${t("daily_schedule_hall_not_in_group")}: ${orphanHallIds.join(", ")}`
        );
        return null;
      }
    }

    const status = (readField(body, "ds-status") || "active") as DailyScheduleStatus;
    if (!["active", "running", "finish", "inactive"].includes(status)) {
      setError(body, t("invalid_schedule_status"));
      return null;
    }

    const stopGame = readCheckbox(body, "ds-stop-game");
    const specialGame = isSpecial ? true : readCheckbox(body, "ds-special-game");

    // Pilot UX-fix: hvis dropdown-modus er synlig, bygg subgames-array fra
    // valgte checkboxes. Ellers parses JSON-textarea (advanced-modus eller
    // fallback hvis sub-game-listen ikke kunne lastes).
    const jsonPaneEl = body.querySelector<HTMLElement>("#ds-subgames-json-pane");
    const isJsonMode = jsonPaneEl ? jsonPaneEl.style.display !== "none" : true;
    let subgames: DailyScheduleSubgameSlot[] | null;
    if (isJsonMode) {
      const subRaw = readField(body, "ds-subgames");
      subgames = parseJsonArray<DailyScheduleSubgameSlot>(subRaw);
    } else {
      subgames = collectSubgamesFromCheckboxes(body, subGameList, existingSubgameSlots);
    }
    if (subgames === null) {
      setError(body, t("invalid_subgames_json"));
      return null;
    }

    // GAME1_SCHEDULE PR 2: samle scheduleId + scheduleIdByDay i otherData.
    const scheduleIdScalar = readField(body, "ds-schedule-id");
    const scheduleIdByDay: Record<string, string> = {};
    for (const dayKey of SCHEDULE_ID_WEEKDAYS) {
      const v = readField(body, `ds-schedule-id-${dayKey}`);
      if (v) scheduleIdByDay[dayKey] = v;
    }
    // Start fra existing otherData slik at vi ikke mister andre felter.
    const otherData: Record<string, unknown> = {
      ...(otherDataInitial ?? {}),
    };
    // Fjern tidligere scheduleId-felter før ny verdi settes for å unngå
    // stale data når bruker tømmer feltet.
    delete otherData.scheduleId;
    delete otherData.scheduleIdByDay;
    if (scheduleIdScalar) {
      otherData.scheduleId = scheduleIdScalar;
    }
    if (Object.keys(scheduleIdByDay).length > 0) {
      otherData.scheduleIdByDay = scheduleIdByDay;
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
      otherData,
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

/**
 * PR 4e.2: bygg options for `<select multiple>` over hall-grupper.
 * Viser name + antall haller. Active-flagget styres allerede i listHallGroups-fetch.
 */
function buildGroupOptions(
  groups: HallGroupRow[],
  selected: readonly string[]
): string {
  if (groups.length === 0) {
    return `<option value="" disabled>${escapeHtml(t("daily_schedule_no_groups_available"))}</option>`;
  }
  return groups
    .map((g) => {
      const isSel = selected.includes(g.id) ? "selected" : "";
      const count = Array.isArray(g.members) ? g.members.length : 0;
      const label = `${g.name} (${count})`;
      return `<option value="${escapeHtml(g.id)}" ${isSel}>${escapeHtml(label)}</option>`;
    })
    .join("");
}

/**
 * PR 4e.2: bygg options for `<select multiple>` over haller.
 */
function buildHallOptions(
  halls: AdminHall[],
  selected: readonly string[]
): string {
  if (halls.length === 0) {
    return `<option value="" disabled>${escapeHtml(t("daily_schedule_no_halls_available"))}</option>`;
  }
  return halls
    .map((h) => {
      const isSel = selected.includes(h.id) ? "selected" : "";
      const label = h.slug ? `${h.name} (${h.slug})` : h.name;
      return `<option value="${escapeHtml(h.id)}" ${isSel}>${escapeHtml(label)}</option>`;
    })
    .join("");
}

/**
 * PR 4e.2: bygg options for master-hall single-select. Inkluderer en tom
 * "ingen master"-option øverst slik at feltet er valgfritt (spesialspill).
 */
function buildMasterHallOptions(halls: AdminHall[], selected: string): string {
  const emptyOpt = `<option value="" ${selected ? "" : "selected"}>—</option>`;
  if (halls.length === 0) {
    return `${emptyOpt}<option value="" disabled>${escapeHtml(t("daily_schedule_no_halls_available"))}</option>`;
  }
  const opts = halls
    .map((h) => {
      const isSel = h.id === selected ? "selected" : "";
      const label = h.slug ? `${h.name} (${h.slug})` : h.name;
      return `<option value="${escapeHtml(h.id)}" ${isSel}>${escapeHtml(label)}</option>`;
    })
    .join("");
  return `${emptyOpt}${opts}`;
}

/**
 * Pilot UX-fix: bygg checkbox-liste over alle aktive sub-games. Hver row
 * viser navn + sub-game-nummer + ticket-farger. Pre-checked basert på
 * eksisterende daily-schedule-subgames (matchet på subGameId).
 */
function buildSubGameCheckboxes(
  subGames: AdminSubGame[],
  preSelected: Set<string>
): string {
  if (subGames.length === 0) {
    return `<p class="help-block" style="color:#a94442;font-size:12px;">
      ${escapeHtml(t("schedule_subgames_dropdown_unavailable"))}
    </p>`;
  }
  return subGames
    .map((sg) => {
      const isChecked = preSelected.has(sg.id) ? "checked" : "";
      const number = sg.subGameNumber ? ` · ${sg.subGameNumber}` : "";
      const colors = Array.isArray(sg.ticketColors) && sg.ticketColors.length > 0
        ? sg.ticketColors.join(", ")
        : "";
      const colorsLabel = colors ? ` · ${colors}` : "";
      const gameName = sg.gameName ? ` (${sg.gameName})` : "";
      return `
        <label class="checkbox" style="display:block;margin-bottom:4px;padding:4px 8px;border:1px solid #eee;border-radius:3px;cursor:pointer;">
          <input type="checkbox" class="ds-subgame-pick" value="${escapeHtml(sg.id)}" ${isChecked}>
          <strong>${escapeHtml(sg.name)}</strong>${escapeHtml(gameName)}
          <span style="color:#888;font-size:11px;">${escapeHtml(number)}${escapeHtml(colorsLabel)}</span>
          <br>
          <span style="color:#aaa;font-size:10px;font-family:monospace;">${escapeHtml(sg.id)}</span>
        </label>`;
    })
    .join("");
}

/**
 * Pilot UX-fix: les hvilke subGameIds som er valgt og bygg
 * DailyScheduleSubgameSlot-array. Bevarer eksisterende slot-data (index,
 * ticketPrice, prizePool, patternId, status, extra) for sub-games som
 * fortsatt er valgt — slik at admin ikke mister konfigurasjon ved
 * dropdown-toggle.
 */
function collectSubgamesFromCheckboxes(
  form: HTMLElement,
  _subGames: AdminSubGame[],
  existingSlots: DailyScheduleSubgameSlot[]
): DailyScheduleSubgameSlot[] {
  const checkboxes = form.querySelectorAll<HTMLInputElement>(".ds-subgame-pick");
  const selectedIds: string[] = [];
  for (const cb of Array.from(checkboxes)) {
    if (cb.checked && cb.value) selectedIds.push(cb.value);
  }
  return selectedIds.map((subGameId, idx) => {
    const prior = existingSlots.find((s) => s.subGameId === subGameId);
    if (prior) {
      // Behold eksisterende konfig, men oppdater index til ny rekkefølge.
      return { ...prior, subGameId, index: idx };
    }
    // Bygg minimal slot fra sub-game-katalogen — admin må fylle inn
    // ticketPrice/prizePool i SubGamesListEditor (advanced) hvis ønskelig.
    return {
      subGameId,
      index: idx,
    };
  });
}

/**
 * Pilot UX-fix: synkroniser JSON-textarea fra valgte checkboxes når admin
 * klikker "vis JSON". Oppdaterer textarea-verdien så advanced-modus får
 * konsistent state.
 */
function syncSubgamesJsonFromCheckboxes(
  form: HTMLElement,
  subGames: AdminSubGame[],
  existingSlots: DailyScheduleSubgameSlot[]
): void {
  const slots = collectSubgamesFromCheckboxes(form, subGames, existingSlots);
  const ta = form.querySelector<HTMLTextAreaElement>("#ds-subgames");
  if (ta) {
    ta.value = JSON.stringify(slots, null, 2);
  }
}

function renderForm(
  existing: DailyScheduleRow | null,
  isSpecial: boolean,
  scheduleMalList: ScheduleRow[],
  scheduleIdState: {
    scheduleId: string;
    scheduleIdByDay: Partial<Record<DailyScheduleDay, string>>;
  },
  hallList: AdminHall[],
  hallGroupList: HallGroupRow[],
  subGameList: AdminSubGame[]
): string {
  const name = existing?.name ?? "";
  const startDate = existing?.startDate ?? new Date().toISOString().slice(0, 10);
  const endDate = existing?.endDate ?? "";
  const startTime = existing?.startTime ?? "";
  const endTime = existing?.endTime ?? "";
  const gameManagementId = existing?.gameManagementId ?? "";
  const hallId = existing?.hallId ?? "";
  const masterHallId = existing?.hallIds.masterHallId ?? "";
  const existingHallIds = existing?.hallIds.hallIds ?? [];
  const existingGroupHallIds = existing?.hallIds.groupHallIds ?? [];
  const status: DailyScheduleStatus = existing?.status ?? "active";
  const stopGame = Boolean(existing?.stopGame);
  const specialGame = isSpecial || Boolean(existing?.specialGame);
  const day: DailyScheduleDay | "" = existing?.day ?? "";
  const activeMask = existing?.weekDays ?? 0;
  const activeDays = daysFromMask(activeMask);
  const subgamesJson = existing?.subgames ? JSON.stringify(existing.subgames, null, 2) : "[]";
  // Pilot UX-fix: bygg pre-checked-set for sub-game-checkboxes basert på
  // eksisterende subgames-slots (matchet på subGameId).
  const preSelectedSubGameIds = new Set<string>();
  if (Array.isArray(existing?.subgames)) {
    for (const slot of existing!.subgames) {
      if (slot && typeof slot === "object" && typeof slot.subGameId === "string") {
        preSelectedSubGameIds.add(slot.subGameId);
      }
    }
  }
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

  // GAME1_SCHEDULE PR 2: scheduleId-dropdown(er). Scalar + per-dag.
  const buildScheduleIdOptions = (selected: string): string => {
    const opts = scheduleMalList
      .map((s) => {
        const sel = s.id === selected ? "selected" : "";
        const label = `${s.scheduleName}${s.scheduleNumber ? ` (${s.scheduleNumber})` : ""}`;
        return `<option value="${escapeHtml(s.id)}" ${sel}>${escapeHtml(label)}</option>`;
      })
      .join("");
    const emptyOpt = `<option value="" ${selected ? "" : "selected"}>—</option>`;
    return `${emptyOpt}${opts}`;
  };
  const scheduleIdScalarSelect = `
      <select id="ds-schedule-id" class="form-control">
        ${buildScheduleIdOptions(scheduleIdState.scheduleId)}
      </select>`;
  const perDayRows = SCHEDULE_ID_WEEKDAYS.map((dayKey) => {
    const selected = scheduleIdState.scheduleIdByDay[dayKey] ?? "";
    return `
        <div class="form-group col-sm-6" style="margin-bottom:6px;">
          <label for="ds-schedule-id-${dayKey}" style="font-weight:normal;">
            ${escapeHtml(t(`weekday_${dayKey.slice(0, 3)}`))}
          </label>
          <select id="ds-schedule-id-${dayKey}" class="form-control">
            ${buildScheduleIdOptions(selected)}
          </select>
        </div>`;
  }).join("");

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
          <div class="form-group col-sm-6">
            <label for="ds-group-hall-ids">${escapeHtml(t("daily_schedule_group_halls_label"))}</label>
            <select id="ds-group-hall-ids" class="form-control" multiple size="4">
              ${buildGroupOptions(hallGroupList, existingGroupHallIds)}
            </select>
            <p class="help-block" style="font-size:11px;">
              ${escapeHtml(t("daily_schedule_group_halls_hint"))}
            </p>
          </div>
          <div class="form-group col-sm-6">
            <label for="ds-hall-ids">${escapeHtml(t("daily_schedule_halls_label"))}</label>
            <select id="ds-hall-ids" class="form-control" multiple size="4">
              ${buildHallOptions(hallList, existingHallIds)}
            </select>
            <p class="help-block" style="font-size:11px;">
              ${escapeHtml(t("daily_schedule_halls_hint"))}
            </p>
          </div>
        </div>
        <div class="row">
          <div class="form-group col-sm-6">
            <label for="ds-master-hall-id">${escapeHtml(t("master_hall_id"))}</label>
            <select id="ds-master-hall-id" class="form-control">
              ${buildMasterHallOptions(hallList, masterHallId)}
            </select>
            <p class="help-block" style="font-size:11px;">
              ${escapeHtml(t("daily_schedule_master_hall_hint"))}
            </p>
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
      <fieldset style="border:1px solid #ddd;padding:8px 12px;margin-bottom:12px;">
        <legend style="font-size:14px;width:auto;padding:0 4px;">
          ${escapeHtml(t("select_schedule"))}
        </legend>
        <div class="form-group">
          <label for="ds-schedule-id">
            ${escapeHtml(t("select_schedule"))}
          </label>
          ${scheduleIdScalarSelect}
          <p class="help-block" style="font-size:11px;">
            ${escapeHtml(t("schedule_id_hint"))}
          </p>
        </div>
        <details>
          <summary style="cursor:pointer;font-size:13px;margin-bottom:6px;">
            ${escapeHtml(t("select_schedule_for_each_weeday"))}
          </summary>
          <div class="row" style="margin-top:6px;">
            ${perDayRows}
          </div>
        </details>
      </fieldset>
      <div class="form-group">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <label style="margin-bottom:0;">${escapeHtml(t("sub_games"))}</label>
          <button type="button" id="ds-subgames-toggle"
                  class="btn btn-default btn-xs"
                  style="font-size:11px;">
            ${escapeHtml(t("schedule_subgames_advanced_edit_json"))}
          </button>
        </div>
        <div id="ds-subgames-dropdown" style="max-height:240px;overflow-y:auto;border:1px solid #ddd;padding:8px;border-radius:3px;background:#fafafa;">
          ${buildSubGameCheckboxes(subGameList, preSelectedSubGameIds)}
        </div>
        <p class="help-block" style="font-size:11px;">
          ${escapeHtml(t("schedule_subgames_dropdown_hint"))}
        </p>
        <div id="ds-subgames-json-pane" style="display:none;margin-top:8px;">
          <textarea id="ds-subgames" class="form-control" rows="5"
                    spellcheck="false" style="font-family:monospace;font-size:12px;">${escapeHtml(subgamesJson)}</textarea>
          <p class="help-block">${escapeHtml(t("subgames_json_hint"))}</p>
        </div>
      </div>
      <p id="ds-editor-error" class="help-block"
         style="color:#a94442;display:none;margin-top:4px;"></p>
    </form>`;
}
