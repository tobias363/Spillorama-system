// PR 4e.1 (2026-04-22) — Add/Edit-modal for GroupHall.
//
// Data:
//   POST /api/admin/hall-groups (createGroupHall)
//   PATCH /api/admin/hall-groups/:id (updateGroupHall)
//   GET /api/admin/halls (listHalls — for member-picker)
//
// Felter:
//   - name (required, max 200 chars)
//   - tvId (optional, positiv heltall eller tom)
//   - description (optional, fri tekst → `extra.description`)
//   - status (active | inactive)
//   - members (HTML-native <select multiple> over aktive haller)
//
// Design-avvik fra spec: spec ba om "create-modal" og "edit-modal" som
// separate filer, men siden de deler 90% av skjemaet gir vi én fil med
// `mode: "create" | "edit"`-parameter. Matcher DailyScheduleEditorModal.

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { Modal, type ModalInstance } from "../../components/Modal.js";
import { ApiError } from "../../api/client.js";
import { escapeHtml } from "../adminUsers/shared.js";
import { listHalls, type AdminHall } from "../../api/admin-halls.js";
import {
  createGroupHall,
  updateGroupHall,
  getDescriptionFromRow,
  type HallGroupRow,
  type HallGroupStatus,
} from "./GroupHallState.js";

export interface GroupHallEditorModalOpts {
  mode: "create" | "edit";
  /** Pre-fyll for edit-modus. Må være satt når mode="edit". */
  existing?: HallGroupRow;
  /** Kalles etter vellykket lagring — list-siden bruker dette til refresh. */
  onSaved?: (row: HallGroupRow) => void;
  /** Injection-punkt for tester; standard er admin-halls.listHalls. */
  hallLoader?: () => Promise<AdminHall[]>;
}

interface FormEls {
  name: HTMLInputElement;
  tvId: HTMLInputElement;
  description: HTMLTextAreaElement;
  status: HTMLSelectElement;
  members: HTMLSelectElement;
  errors: HTMLElement;
  saveBtn: HTMLButtonElement;
}

const DEFAULT_HALL_LOADER = async (): Promise<AdminHall[]> =>
  listHalls({ includeInactive: false });

export function openGroupHallEditorModal(
  opts: GroupHallEditorModalOpts
): ModalInstance {
  const { mode, existing } = opts;
  if (mode === "edit" && !existing) {
    throw new Error("[GroupHallEditorModal] 'existing' er påkrevd i edit-modus.");
  }
  const titleKey = mode === "create" ? "create_group_of_halls" : "edit_group_of_halls";

  const instance = Modal.open({
    title: t(titleKey),
    size: "lg",
    content: renderLoadingShell(),
    buttons: [
      { label: t("cancel"), variant: "default", action: "gh-modal-cancel" },
      {
        label: t("save"),
        variant: "success",
        action: "gh-modal-save",
        dismiss: false,
        onClick: async (inst) => {
          await onSaveClicked(inst, opts);
        },
      },
    ],
  });

  const hallLoader = opts.hallLoader ?? DEFAULT_HALL_LOADER;
  void populate(instance, mode, existing, hallLoader);

  return instance;
}

function renderLoadingShell(): string {
  return `<div data-testid="gh-modal-loading" class="text-center" style="padding:20px;">
    <i class="fa fa-spinner fa-spin fa-2x" aria-hidden="true"></i>
  </div>`;
}

async function populate(
  instance: ModalInstance,
  mode: "create" | "edit",
  existing: HallGroupRow | undefined,
  hallLoader: () => Promise<AdminHall[]>
): Promise<void> {
  let halls: AdminHall[] = [];
  try {
    halls = await hallLoader();
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
    instance.setContent(
      `<div class="callout callout-danger" data-testid="gh-modal-load-error">${escapeHtml(msg)}</div>`
    );
    return;
  }

  const form = renderForm({ mode, existing, halls });
  instance.setContent(form);
}

interface RenderFormArgs {
  mode: "create" | "edit";
  existing?: HallGroupRow;
  halls: AdminHall[];
}

function renderForm(args: RenderFormArgs): Node {
  const { mode, existing, halls } = args;
  const wrap = document.createElement("div");
  wrap.setAttribute("data-testid", "gh-editor-form");

  const existingMemberIds = new Set(
    (existing?.members ?? []).map((m) => m.hallId)
  );
  // Inkluder legacy-hall-IDs som ikke lenger er aktive så operator ikke
  // mister dem ved re-save. Disse vises med "(inaktiv)" badge.
  const activeHallIds = new Set(halls.map((h) => h.id));
  const extraInactiveMembers = (existing?.members ?? []).filter(
    (m) => !activeHallIds.has(m.hallId)
  );

  const statusValue: HallGroupStatus = existing?.status ?? "active";
  const descriptionValue = existing ? getDescriptionFromRow(existing) : "";
  const tvIdValue = existing?.tvId !== null && existing?.tvId !== undefined
    ? String(existing.tvId)
    : "";

  wrap.innerHTML = `
    <form id="gh-editor" class="form-horizontal">
      <div class="form-group">
        <label class="col-sm-3 control-label" for="gh-name">${escapeHtml(t("name"))} *</label>
        <div class="col-sm-9">
          <input type="text" id="gh-name" name="name" class="form-control"
            data-testid="gh-name" required maxlength="200"
            value="${escapeHtml(existing?.name ?? "")}" />
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-3 control-label" for="gh-tvId">${escapeHtml(t("tv_screen"))}</label>
        <div class="col-sm-9">
          <input type="number" id="gh-tvId" name="tvId" class="form-control"
            data-testid="gh-tvId" min="0" step="1"
            value="${escapeHtml(tvIdValue)}" />
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-3 control-label" for="gh-description">${escapeHtml(t("description"))}</label>
        <div class="col-sm-9">
          <textarea id="gh-description" name="description" class="form-control"
            data-testid="gh-description" rows="2">${escapeHtml(descriptionValue)}</textarea>
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-3 control-label" for="gh-status">${escapeHtml(t("status"))}</label>
        <div class="col-sm-9">
          <select id="gh-status" name="status" class="form-control" data-testid="gh-status">
            <option value="active"${statusValue === "active" ? " selected" : ""}>${escapeHtml(t("active"))}</option>
            <option value="inactive"${statusValue === "inactive" ? " selected" : ""}>${escapeHtml(t("inactive"))}</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-3 control-label" for="gh-members">${escapeHtml(t("select_halls"))}</label>
        <div class="col-sm-9">
          <select id="gh-members" name="members" class="form-control"
            data-testid="gh-members" multiple size="8">
            ${halls
              .map(
                (h) =>
                  `<option value="${escapeHtml(h.id)}"${existingMemberIds.has(h.id) ? " selected" : ""}>${escapeHtml(h.name)}${h.slug ? ` (${escapeHtml(h.slug)})` : ""}</option>`
              )
              .join("")}
            ${extraInactiveMembers
              .map(
                (m) =>
                  `<option value="${escapeHtml(m.hallId)}" selected>${escapeHtml(m.hallName)} (${escapeHtml(t("inactive"))})</option>`
              )
              .join("")}
          </select>
          <p class="help-block">${escapeHtml(t("select_halls_hint"))}</p>
        </div>
      </div>
      <div id="gh-editor-errors" class="alert alert-danger" style="display:none;"
        data-testid="gh-editor-errors" role="alert"></div>
    </form>
    <div style="display:none;">
      <input type="hidden" data-testid="gh-editor-mode" value="${escapeHtml(mode)}" />
      ${existing ? `<input type="hidden" data-testid="gh-editor-id" value="${escapeHtml(existing.id)}" />` : ""}
    </div>`;
  return wrap;
}

function readFormEls(instance: ModalInstance): FormEls | null {
  const root = instance.root;
  const name = root.querySelector<HTMLInputElement>("#gh-name");
  const tvId = root.querySelector<HTMLInputElement>("#gh-tvId");
  const description = root.querySelector<HTMLTextAreaElement>("#gh-description");
  const status = root.querySelector<HTMLSelectElement>("#gh-status");
  const members = root.querySelector<HTMLSelectElement>("#gh-members");
  const errors = root.querySelector<HTMLElement>("#gh-editor-errors");
  const saveBtn = root.querySelector<HTMLButtonElement>(
    "button[data-action='gh-modal-save']"
  );
  if (!name || !tvId || !description || !status || !members || !errors || !saveBtn) {
    return null;
  }
  return { name, tvId, description, status, members, errors, saveBtn };
}

function readSelectedHallIds(select: HTMLSelectElement): string[] {
  const out: string[] = [];
  for (const opt of Array.from(select.options)) {
    if (opt.selected) out.push(opt.value);
  }
  return out;
}

function showError(errors: HTMLElement, message: string): void {
  errors.style.display = "block";
  errors.textContent = message;
}

function clearError(errors: HTMLElement): void {
  errors.style.display = "none";
  errors.textContent = "";
}

async function onSaveClicked(
  instance: ModalInstance,
  opts: GroupHallEditorModalOpts
): Promise<void> {
  const els = readFormEls(instance);
  if (!els) return;
  clearError(els.errors);

  const name = els.name.value.trim();
  if (name.length === 0) {
    showError(els.errors, t("all_fields_are_required"));
    return;
  }
  if (name.length > 200) {
    showError(els.errors, t("name_too_long"));
    return;
  }

  let tvId: number | null = null;
  const tvIdRaw = els.tvId.value.trim();
  if (tvIdRaw.length > 0) {
    const parsed = Number(tvIdRaw);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
      showError(els.errors, t("tv_id_invalid"));
      return;
    }
    tvId = parsed;
  }

  const description = els.description.value.trim();
  const status = els.status.value as HallGroupStatus;
  const hallIds = readSelectedHallIds(els.members);

  els.saveBtn.disabled = true;
  try {
    const result =
      opts.mode === "create"
        ? await createGroupHall({ name, tvId, description, status, hallIds })
        : await updateGroupHall(opts.existing!.id, {
            name,
            tvId,
            description,
            status,
            hallIds,
          });

    if (result.ok) {
      Toast.success(t("success"));
      opts.onSaved?.(result.row);
      instance.close("button");
      return;
    }

    const msg =
      result.reason === "PERMISSION_DENIED"
        ? t("permission_denied")
        : result.reason === "NOT_FOUND"
          ? t("not_found")
          : result.reason === "VALIDATION"
            ? mapValidationKey(result.message)
            : result.message;
    showError(els.errors, msg);
  } finally {
    els.saveBtn.disabled = false;
  }
}

/** Oversett validerings-error-nøkler til lokaliserte meldinger. */
function mapValidationKey(key: string): string {
  switch (key) {
    case "name_required":
      return t("all_fields_are_required");
    case "name_too_long":
      return t("name_too_long");
    case "tv_id_invalid":
      return t("tv_id_invalid");
    case "hall_id_invalid":
      return t("hall_id_invalid");
    case "no_changes":
      return t("no_changes");
    default:
      return key;
  }
}
