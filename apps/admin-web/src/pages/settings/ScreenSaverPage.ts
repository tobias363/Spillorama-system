// Fase 1 MVP §24 — Screen Saver admin-konfig.
//
// Wireframe-katalog WIREFRAME_CATALOG.md §PDF 14:
//   - On/off-toggle
//   - Idle-timeout-dropdown (1-2 min)
//   - Image-liste (multi-image carousel) m/per-image vis-tid (5/10/20s)
//   - Globalt eller per-hall (dropdown)
//
// Arkitektur:
//   - On/off + idle-timeout ligger som system-settings-nøkler
//     (`branding.screen_saver_enabled` + `branding.screen_saver_timeout_minutes`)
//     og pushes via samme PATCH /api/admin/settings.
//   - Bildelista håndteres via /api/admin/settings/screen-saver
//     (CRUD + reorder).
//
// Pilot-omfang for opplastning:
//   - Admin lim inn ferdig CDN-URL (Cloudinary widget eller manuell URL).
//   - Server validerer http(s)-format + 2048 tegn maks.
//   - Ingen direkte fil-opplasting i denne PR-en (kommer som BIN-XXX når
//     Cloudinary signed-uploads er konfigurert).

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import {
  boxClose,
  boxOpen,
  contentHeader,
  escapeHtml,
} from "../adminUsers/shared.js";
import {
  listScreenSaverImages,
  createScreenSaverImage,
  updateScreenSaverImage,
  deleteScreenSaverImage,
  reorderScreenSaverImages,
  type ScreenSaverImage,
} from "../../api/admin-screen-saver.js";
import {
  getSystemSettings,
  patchSystemSettings,
  type SystemSettingRow,
} from "../../api/admin-system-settings.js";
import { listHalls, type AdminHall } from "../../api/admin-halls.js";
import { ApiError } from "../../api/client.js";

const TIMEOUT_OPTIONS_MINUTES: ReadonlyArray<number> = [1, 2, 5, 10, 15];
const DURATION_OPTIONS_SECONDS: ReadonlyArray<number> = [5, 10, 15, 20, 30];
const SETTING_ENABLED_KEY = "branding.screen_saver_enabled";
const SETTING_TIMEOUT_KEY = "branding.screen_saver_timeout_minutes";
const HALL_FILTER_GLOBAL = "__global__";
const HALL_FILTER_ALL = "__all__";

interface PageState {
  enabled: boolean;
  timeoutMinutes: number;
  hallFilter: string; // "__all__" | "__global__" | hall-id
  hallTarget: string; // "__global__" | hall-id (kontekst for nye bilder)
  images: ScreenSaverImage[];
  halls: AdminHall[];
  /** Sett til true mens en async-operasjon pågår — disabler knapper. */
  busy: boolean;
}

let pageHost: HTMLElement | null = null;
const state: PageState = {
  enabled: false,
  timeoutMinutes: 2,
  hallFilter: HALL_FILTER_ALL,
  hallTarget: HALL_FILTER_GLOBAL,
  images: [],
  halls: [],
  busy: false,
};

export function renderScreenSaverPage(container: HTMLElement): void {
  pageHost = container;
  container.innerHTML = `
    ${contentHeader("screen_saver_title", "settings")}
    <section class="content">
      <div class="callout callout-info" data-testid="screen-saver-info-banner">
        <i class="fa fa-info-circle" aria-hidden="true"></i>
        ${escapeHtml(t("screen_saver_info_banner"))}
      </div>
      <div id="screen-saver-body">${escapeHtml(t("loading_ellipsis"))}</div>
    </section>`;
  void mount();
}

async function mount(): Promise<void> {
  if (!pageHost) return;
  const host = pageHost.querySelector<HTMLElement>("#screen-saver-body");
  if (!host) return;

  try {
    const [settingsRes, imagesRes, hallsRes] = await Promise.all([
      getSystemSettings(),
      listScreenSaverImages(),
      listHalls({ includeInactive: false }).catch(() => [] as AdminHall[]),
    ]);
    applySettings(settingsRes.settings);
    state.images = imagesRes.images;
    state.halls = hallsRes;
    render();
  } catch (err) {
    const message = err instanceof ApiError ? err.message : t("something_went_wrong");
    host.innerHTML = `<div class="callout callout-danger" data-testid="screen-saver-load-error">${escapeHtml(message)}</div>`;
  }
}

function applySettings(rows: SystemSettingRow[]): void {
  const enabledRow = rows.find((r) => r.key === SETTING_ENABLED_KEY);
  const timeoutRow = rows.find((r) => r.key === SETTING_TIMEOUT_KEY);
  state.enabled =
    typeof enabledRow?.value === "boolean" ? enabledRow.value : false;
  state.timeoutMinutes =
    typeof timeoutRow?.value === "number" && Number.isFinite(timeoutRow.value)
      ? Math.max(1, Math.round(timeoutRow.value))
      : 2;
}

function render(): void {
  if (!pageHost) return;
  const host = pageHost.querySelector<HTMLElement>("#screen-saver-body");
  if (!host) return;
  host.innerHTML = `
    ${renderConfigSection()}
    ${renderImagesSection()}
  `;
  bind(host);
}

function renderConfigSection(): string {
  const enabledChecked = state.enabled ? "checked" : "";
  const timeoutOptions = TIMEOUT_OPTIONS_MINUTES.map((m) => {
    const sel = m === state.timeoutMinutes ? "selected" : "";
    const label = `${m} ${t("minutes_short")}`;
    return `<option value="${m}" ${sel}>${escapeHtml(label)}</option>`;
  }).join("");

  return `
    ${boxOpen("screen_saver_config_title", "primary")}
      <form id="screen-saver-config-form" class="form-horizontal" data-testid="screen-saver-config-form">
        <div class="form-group">
          <label class="col-sm-3 control-label" for="ss-enabled">
            ${escapeHtml(t("screen_saver_enabled_label"))}
          </label>
          <div class="col-sm-9">
            <label class="checkbox-inline">
              <input type="checkbox"
                     id="ss-enabled"
                     name="enabled"
                     data-testid="ss-enabled"
                     ${enabledChecked}>
              ${escapeHtml(t("screen_saver_enabled_help"))}
            </label>
          </div>
        </div>
        <div class="form-group">
          <label class="col-sm-3 control-label" for="ss-timeout">
            ${escapeHtml(t("screen_saver_timeout_label"))}
          </label>
          <div class="col-sm-4">
            <select id="ss-timeout"
                    name="timeoutMinutes"
                    class="form-control"
                    data-testid="ss-timeout">
              ${timeoutOptions}
            </select>
            <p class="help-block"><small>${escapeHtml(t("screen_saver_timeout_help"))}</small></p>
          </div>
        </div>
        <div class="form-group">
          <div class="col-sm-offset-3 col-sm-9">
            <button type="submit"
                    class="btn btn-success"
                    data-action="save-config"
                    data-testid="ss-save-config"
                    ${state.busy ? "disabled" : ""}>
              <i class="fa fa-save" aria-hidden="true"></i> ${escapeHtml(t("save"))}
            </button>
          </div>
        </div>
      </form>
    ${boxClose()}
  `;
}

function renderImagesSection(): string {
  const filterOptions = [
    { value: HALL_FILTER_ALL, label: t("screen_saver_filter_all") },
    { value: HALL_FILTER_GLOBAL, label: t("screen_saver_filter_global") },
    ...state.halls.map((h) => ({ value: h.id, label: h.name })),
  ];
  const filterHtml = filterOptions
    .map((o) => {
      const sel = state.hallFilter === o.value ? "selected" : "";
      return `<option value="${escapeHtml(o.value)}" ${sel}>${escapeHtml(o.label)}</option>`;
    })
    .join("");

  const targetOptions = [
    { value: HALL_FILTER_GLOBAL, label: t("screen_saver_target_global") },
    ...state.halls.map((h) => ({ value: h.id, label: h.name })),
  ];
  const targetHtml = targetOptions
    .map((o) => {
      const sel = state.hallTarget === o.value ? "selected" : "";
      return `<option value="${escapeHtml(o.value)}" ${sel}>${escapeHtml(o.label)}</option>`;
    })
    .join("");

  const durationOptions = DURATION_OPTIONS_SECONDS.map((s) => {
    const sel = s === 10 ? "selected" : "";
    return `<option value="${s}" ${sel}>${s} ${escapeHtml(t("seconds_short"))}</option>`;
  }).join("");

  return `
    ${boxOpen("screen_saver_images_title", "primary")}
      <div class="callout callout-warning" data-testid="screen-saver-format-warning">
        <i class="fa fa-exclamation-triangle" aria-hidden="true"></i>
        ${escapeHtml(t("screen_saver_format_warning"))}
      </div>

      <form id="screen-saver-add-form"
            class="form-inline"
            data-testid="screen-saver-add-form"
            style="margin-bottom:12px;">
        <div class="form-group" style="margin-right:8px;">
          <label for="ss-target" class="control-label" style="margin-right:6px;">
            ${escapeHtml(t("screen_saver_target_label"))}
          </label>
          <select id="ss-target"
                  name="target"
                  class="form-control"
                  data-testid="ss-target">
            ${targetHtml}
          </select>
        </div>
        <div class="form-group" style="margin-right:8px;">
          <label for="ss-image-url" class="control-label" style="margin-right:6px;">
            ${escapeHtml(t("screen_saver_image_url_label"))}
          </label>
          <input type="url"
                 id="ss-image-url"
                 name="imageUrl"
                 class="form-control"
                 placeholder="https://res.cloudinary.com/.../image.png"
                 size="60"
                 data-testid="ss-image-url"
                 required>
        </div>
        <div class="form-group" style="margin-right:8px;">
          <label for="ss-image-duration" class="control-label" style="margin-right:6px;">
            ${escapeHtml(t("screen_saver_duration_label"))}
          </label>
          <select id="ss-image-duration"
                  name="displaySeconds"
                  class="form-control"
                  data-testid="ss-image-duration">
            ${durationOptions}
          </select>
        </div>
        <button type="submit"
                class="btn btn-success"
                data-testid="ss-add-image"
                ${state.busy ? "disabled" : ""}>
          <i class="fa fa-plus" aria-hidden="true"></i> ${escapeHtml(t("add"))}
        </button>
      </form>

      <div class="row" style="margin-bottom:12px;">
        <div class="col-sm-4">
          <label for="ss-filter" class="control-label">
            ${escapeHtml(t("screen_saver_filter_label"))}
          </label>
          <select id="ss-filter"
                  name="hallFilter"
                  class="form-control"
                  data-testid="ss-filter">
            ${filterHtml}
          </select>
        </div>
      </div>

      ${renderImagesTable()}
    ${boxClose()}
  `;
}

function renderImagesTable(): string {
  const filtered = filterImages(state.images, state.hallFilter);

  if (filtered.length === 0) {
    return `
      <div class="callout callout-info" data-testid="screen-saver-empty">
        ${escapeHtml(t("screen_saver_no_images"))}
      </div>`;
  }

  const rows = filtered
    .map((img) => {
      const hallName = img.hallId
        ? state.halls.find((h) => h.id === img.hallId)?.name ?? img.hallId
        : t("screen_saver_target_global");
      const activeBadge = img.isActive
        ? `<span class="label label-success" data-testid="ss-active-${escapeHtml(img.id)}">${escapeHtml(t("active"))}</span>`
        : `<span class="label label-default" data-testid="ss-inactive-${escapeHtml(img.id)}">${escapeHtml(t("inactive"))}</span>`;
      const preview = `<img src="${escapeHtml(img.imageUrl)}"
                            alt="screensaver"
                            loading="lazy"
                            referrerpolicy="no-referrer"
                            style="max-width:120px;max-height:68px;border:1px solid #ccc;">`;
      const durationOptions = DURATION_OPTIONS_SECONDS.map((s) => {
        const sel = s === img.displaySeconds ? "selected" : "";
        return `<option value="${s}" ${sel}>${s}s</option>`;
      }).join("");
      // Tillat off-list verdier også (e.g. 7 sek lagret tidligere) ved å
      // legge til en custom-rad hvis ikke i listen.
      const customDuration = DURATION_OPTIONS_SECONDS.includes(img.displaySeconds)
        ? ""
        : `<option value="${img.displaySeconds}" selected>${img.displaySeconds}s</option>`;
      const busyAttr = state.busy ? "disabled" : "";
      const upDisabled = state.busy ? "disabled" : "";
      const downDisabled = state.busy ? "disabled" : "";
      return `
        <tr data-image-id="${escapeHtml(img.id)}" data-testid="ss-row-${escapeHtml(img.id)}">
          <td style="width:140px;">${preview}</td>
          <td><code style="word-break:break-all;font-size:11px;">${escapeHtml(img.imageUrl)}</code></td>
          <td>${escapeHtml(hallName)}</td>
          <td style="width:120px;">
            <select class="form-control input-sm"
                    data-action="update-duration"
                    data-image-id="${escapeHtml(img.id)}"
                    data-testid="ss-duration-${escapeHtml(img.id)}"
                    ${busyAttr}>
              ${customDuration}${durationOptions}
            </select>
          </td>
          <td>${activeBadge}</td>
          <td style="width:200px;">
            <button class="btn btn-default btn-xs"
                    data-action="move-up"
                    data-image-id="${escapeHtml(img.id)}"
                    data-testid="ss-up-${escapeHtml(img.id)}"
                    title="${escapeHtml(t("screen_saver_move_up"))}"
                    ${upDisabled}>
              <i class="fa fa-arrow-up"></i>
            </button>
            <button class="btn btn-default btn-xs"
                    data-action="move-down"
                    data-image-id="${escapeHtml(img.id)}"
                    data-testid="ss-down-${escapeHtml(img.id)}"
                    title="${escapeHtml(t("screen_saver_move_down"))}"
                    ${downDisabled}>
              <i class="fa fa-arrow-down"></i>
            </button>
            <button class="btn btn-default btn-xs"
                    data-action="toggle-active"
                    data-image-id="${escapeHtml(img.id)}"
                    data-testid="ss-toggle-${escapeHtml(img.id)}"
                    ${busyAttr}>
              <i class="fa fa-power-off"></i>
              ${img.isActive ? escapeHtml(t("disable")) : escapeHtml(t("enable"))}
            </button>
            <button class="btn btn-danger btn-xs"
                    data-action="delete"
                    data-image-id="${escapeHtml(img.id)}"
                    data-testid="ss-delete-${escapeHtml(img.id)}"
                    ${busyAttr}>
              <i class="fa fa-trash"></i>
            </button>
          </td>
        </tr>`;
    })
    .join("");

  return `
    <table class="table table-bordered table-hover"
           data-testid="screen-saver-table">
      <thead>
        <tr>
          <th>${escapeHtml(t("preview"))}</th>
          <th>URL</th>
          <th>${escapeHtml(t("hall"))}</th>
          <th>${escapeHtml(t("screen_saver_duration_label"))}</th>
          <th>${escapeHtml(t("status"))}</th>
          <th>${escapeHtml(t("action"))}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function filterImages(
  images: ScreenSaverImage[],
  filter: string
): ScreenSaverImage[] {
  if (filter === HALL_FILTER_ALL) return images;
  if (filter === HALL_FILTER_GLOBAL) return images.filter((i) => i.hallId === null);
  return images.filter((i) => i.hallId === filter);
}

function bind(host: HTMLElement): void {
  // Config submit
  const configForm = host.querySelector<HTMLFormElement>("#screen-saver-config-form");
  if (configForm) {
    configForm.addEventListener("submit", (ev) => {
      ev.preventDefault();
      void saveConfig(configForm);
    });
  }

  // Add image submit
  const addForm = host.querySelector<HTMLFormElement>("#screen-saver-add-form");
  if (addForm) {
    addForm.addEventListener("submit", (ev) => {
      ev.preventDefault();
      void addImage(addForm);
    });
  }

  // Filter dropdown
  const filterSel = host.querySelector<HTMLSelectElement>("#ss-filter");
  if (filterSel) {
    filterSel.addEventListener("change", () => {
      state.hallFilter = filterSel.value;
      render();
    });
  }

  // Target dropdown (kontekst for nye bilder)
  const targetSel = host.querySelector<HTMLSelectElement>("#ss-target");
  if (targetSel) {
    targetSel.addEventListener("change", () => {
      state.hallTarget = targetSel.value;
    });
  }

  // Per-row actions (delegert)
  const tbody = host.querySelector("tbody");
  if (tbody) {
    tbody.addEventListener("click", (ev) => {
      const target = ev.target as HTMLElement | null;
      if (!target) return;
      const btn = target.closest<HTMLButtonElement>("[data-action]");
      if (!btn || btn.tagName !== "BUTTON") return;
      const action = btn.dataset.action;
      const id = btn.dataset.imageId;
      if (!id || !action) return;
      switch (action) {
        case "move-up":
          void moveImage(id, -1);
          break;
        case "move-down":
          void moveImage(id, +1);
          break;
        case "toggle-active":
          void toggleActive(id);
          break;
        case "delete":
          if (window.confirm(t("screen_saver_confirm_delete"))) {
            void deleteImage(id);
          }
          break;
      }
    });

    // Per-row duration change
    tbody.addEventListener("change", (ev) => {
      const target = ev.target as HTMLSelectElement | null;
      if (!target || target.tagName !== "SELECT") return;
      if (target.dataset.action !== "update-duration") return;
      const id = target.dataset.imageId;
      if (!id) return;
      const seconds = Number(target.value);
      if (!Number.isFinite(seconds) || seconds < 1) return;
      void updateDuration(id, seconds);
    });
  }
}

async function saveConfig(form: HTMLFormElement): Promise<void> {
  if (state.busy) return;
  const enabledEl = form.querySelector<HTMLInputElement>("#ss-enabled");
  const timeoutEl = form.querySelector<HTMLSelectElement>("#ss-timeout");
  if (!enabledEl || !timeoutEl) return;

  const newEnabled = enabledEl.checked;
  const newTimeout = Number(timeoutEl.value);
  if (!Number.isFinite(newTimeout) || newTimeout < 1) {
    Toast.error(t("invalid_input"));
    return;
  }

  // Krev minst ett aktivt bilde for å aktivere screensaver
  if (newEnabled && !hasAnyActiveImage()) {
    Toast.error(t("screen_saver_requires_image"));
    enabledEl.checked = false;
    return;
  }

  setBusy(true);
  try {
    const patches = [];
    if (newEnabled !== state.enabled) {
      patches.push({ key: SETTING_ENABLED_KEY, value: newEnabled });
    }
    if (newTimeout !== state.timeoutMinutes) {
      patches.push({ key: SETTING_TIMEOUT_KEY, value: newTimeout });
    }
    if (patches.length === 0) {
      Toast.success(t("no_changes_to_save"));
      return;
    }
    const res = await patchSystemSettings(patches);
    applySettings(res.settings);
    Toast.success(t("setting_save_success"));
    render();
  } catch (err) {
    Toast.error(err instanceof ApiError ? err.message : t("something_went_wrong"));
  } finally {
    setBusy(false);
  }
}

function hasAnyActiveImage(): boolean {
  return state.images.some((i) => i.isActive && !i.deletedAt);
}

async function addImage(form: HTMLFormElement): Promise<void> {
  if (state.busy) return;
  const urlEl = form.querySelector<HTMLInputElement>("#ss-image-url");
  const durationEl = form.querySelector<HTMLSelectElement>("#ss-image-duration");
  const targetEl = form.querySelector<HTMLSelectElement>("#ss-target");
  if (!urlEl || !durationEl || !targetEl) return;

  const imageUrl = urlEl.value.trim();
  if (!imageUrl) {
    Toast.error(t("screen_saver_url_required"));
    return;
  }
  if (!/^https?:\/\//i.test(imageUrl)) {
    Toast.error(t("screen_saver_url_must_be_http"));
    return;
  }
  const seconds = Number(durationEl.value);
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > 300) {
    Toast.error(t("invalid_input"));
    return;
  }
  const target = targetEl.value;
  const hallId = target === HALL_FILTER_GLOBAL ? null : target;
  // Default-rekkefølge: legg til etter siste bilde innenfor (hall_id-)gruppen.
  const sameGroup = state.images.filter((i) => i.hallId === hallId);
  const nextOrder =
    sameGroup.reduce((max, i) => Math.max(max, i.displayOrder), -1) + 1;

  setBusy(true);
  try {
    const created = await createScreenSaverImage({
      imageUrl,
      hallId,
      displaySeconds: seconds,
      displayOrder: nextOrder,
      isActive: true,
    });
    state.images.push(created);
    state.images.sort(sortImages);
    Toast.success(t("screen_saver_added"));
    urlEl.value = "";
    render();
  } catch (err) {
    Toast.error(err instanceof ApiError ? err.message : t("something_went_wrong"));
  } finally {
    setBusy(false);
  }
}

async function updateDuration(id: string, seconds: number): Promise<void> {
  if (state.busy) return;
  setBusy(true);
  try {
    const updated = await updateScreenSaverImage(id, { displaySeconds: seconds });
    replaceImage(updated);
    Toast.success(t("screen_saver_updated"));
  } catch (err) {
    Toast.error(err instanceof ApiError ? err.message : t("something_went_wrong"));
  } finally {
    setBusy(false);
    render();
  }
}

async function toggleActive(id: string): Promise<void> {
  if (state.busy) return;
  const img = state.images.find((i) => i.id === id);
  if (!img) return;
  setBusy(true);
  try {
    const updated = await updateScreenSaverImage(id, { isActive: !img.isActive });
    replaceImage(updated);
    Toast.success(t("screen_saver_updated"));
  } catch (err) {
    Toast.error(err instanceof ApiError ? err.message : t("something_went_wrong"));
  } finally {
    setBusy(false);
    render();
  }
}

async function deleteImage(id: string): Promise<void> {
  if (state.busy) return;
  setBusy(true);
  try {
    await deleteScreenSaverImage(id);
    state.images = state.images.filter((i) => i.id !== id);
    Toast.success(t("screen_saver_deleted"));
  } catch (err) {
    Toast.error(err instanceof ApiError ? err.message : t("something_went_wrong"));
  } finally {
    setBusy(false);
    render();
  }
}

async function moveImage(id: string, delta: -1 | 1): Promise<void> {
  if (state.busy) return;
  const img = state.images.find((i) => i.id === id);
  if (!img) return;
  // Jobber innen samme gruppe (samme hall_id).
  const group = state.images
    .filter((i) => i.hallId === img.hallId)
    .sort((a, b) => a.displayOrder - b.displayOrder);
  const idx = group.findIndex((i) => i.id === id);
  const swapIdx = idx + delta;
  if (idx < 0 || swapIdx < 0 || swapIdx >= group.length) return;

  const reordered = [...group];
  const [moved] = reordered.splice(idx, 1);
  if (!moved) return;
  reordered.splice(swapIdx, 0, moved);
  // Tildel sekvensielle display_order 0..N-1 i ny rekkefølge.
  const entries = reordered.map((i, n) => ({ id: i.id, displayOrder: n }));

  setBusy(true);
  try {
    const res = await reorderScreenSaverImages(entries);
    // Slå sammen oppdaterte rader inn i state.images
    for (const updated of res.images) {
      replaceImage(updated);
    }
    Toast.success(t("screen_saver_reordered"));
  } catch (err) {
    Toast.error(err instanceof ApiError ? err.message : t("something_went_wrong"));
  } finally {
    setBusy(false);
    render();
  }
}

function replaceImage(updated: ScreenSaverImage): void {
  const idx = state.images.findIndex((i) => i.id === updated.id);
  if (idx === -1) {
    state.images.push(updated);
  } else {
    state.images[idx] = updated;
  }
  state.images.sort(sortImages);
}

function sortImages(a: ScreenSaverImage, b: ScreenSaverImage): number {
  // Globale først, så per hall, deretter display_order, deretter created_at.
  const aHall = a.hallId ?? "";
  const bHall = b.hallId ?? "";
  if (aHall !== bHall) {
    if (aHall === "") return -1;
    if (bHall === "") return 1;
    return aHall < bHall ? -1 : 1;
  }
  if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder;
  return a.createdAt < b.createdAt ? -1 : 1;
}

function setBusy(busy: boolean): void {
  state.busy = busy;
}

/** @internal — for tests only. */
export function __resetState(): void {
  state.enabled = false;
  state.timeoutMinutes = 2;
  state.hallFilter = HALL_FILTER_ALL;
  state.hallTarget = HALL_FILTER_GLOBAL;
  state.images = [];
  state.halls = [];
  state.busy = false;
  pageHost = null;
}
