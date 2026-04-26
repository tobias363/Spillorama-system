// BIN-677 — /settings (system-wide key-value registry).
//
// Registry: 19 nøkler i 5 kategorier (general, app_versions, compliance,
// branding, feature_flags). Se apps/backend/src/admin/SettingsService.ts
// for full definisjon. Skjer via GET/PATCH /api/admin/settings.
//
// UX-valg: Én kategori-seksjon per `category`, per-nøkkel input basert
// på `type`:
//   - string  → <input type="text"> / <textarea> (hvis `system.information`)
//   - number  → <input type="number">
//   - boolean → <input type="checkbox">
//   - object  → <textarea> med JSON + parse/stringify ved submit
//
// Compliance-nøkler vises med en info-banner som forklarer at per-hall
// Spillvett-limits tar presedens.

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import {
  boxClose,
  boxOpen,
  contentHeader,
  escapeHtml,
} from "../adminUsers/shared.js";
import {
  getSystemSettings,
  patchSystemSettings,
  type SystemSettingPatchEntry,
  type SystemSettingRow,
} from "../../api/admin-system-settings.js";
import { ApiError } from "../../api/client.js";

const CATEGORY_ORDER: readonly string[] = [
  "general",
  "app_versions",
  "compliance",
  "branding",
  "feature_flags",
];

function categoryLabel(category: string): string {
  const key = `setting_category_${category}`;
  return t(key);
}

export function renderSettingsPage(container: HTMLElement): void {
  container.innerHTML = `
    ${contentHeader("settings", "settings")}
    <section class="content">
      <div class="callout callout-info" data-testid="settings-wired-banner">
        <i class="fa fa-info-circle" aria-hidden="true"></i>
        ${escapeHtml(t("system_settings_wired_banner"))}
        <p><small>${escapeHtml(t("system_settings_registry_description"))}</small></p>
      </div>
      ${boxOpen("settings", "primary")}
        <div id="settings-form-host">${escapeHtml(t("loading_ellipsis"))}</div>
      ${boxClose()}
    </section>`;

  const host = container.querySelector<HTMLElement>("#settings-form-host")!;
  void mount(host);
}

async function mount(host: HTMLElement): Promise<void> {
  let settings: SystemSettingRow[];
  try {
    const res = await getSystemSettings();
    settings = res.settings;
  } catch (err) {
    const message = err instanceof ApiError ? err.message : t("something_went_wrong");
    host.innerHTML = `<div class="callout callout-danger" data-testid="settings-load-error">${escapeHtml(message)}</div>`;
    return;
  }

  host.innerHTML = renderForm(settings);

  const form = host.querySelector<HTMLFormElement>("#settings-form")!;
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void submit(form, settings, host);
  });
}

function renderForm(settings: SystemSettingRow[]): string {
  const byCategory = new Map<string, SystemSettingRow[]>();
  for (const s of settings) {
    const list = byCategory.get(s.category);
    if (list) list.push(s);
    else byCategory.set(s.category, [s]);
  }
  // Stabil rekkefølge per CATEGORY_ORDER; ukjente kategorier legges til slutten.
  const orderedCategories = [
    ...CATEGORY_ORDER.filter((c) => byCategory.has(c)),
    ...Array.from(byCategory.keys()).filter((c) => !CATEGORY_ORDER.includes(c)),
  ];

  const sections = orderedCategories
    .map((cat) => renderCategorySection(cat, byCategory.get(cat) ?? []))
    .join("");

  return `
    <form id="settings-form" class="form-horizontal" data-testid="settings-form">
      ${sections}
      <div class="form-group">
        <div class="col-sm-offset-3 col-sm-9">
          <button type="submit" class="btn btn-success" data-action="save-settings">
            <i class="fa fa-save" aria-hidden="true"></i> ${escapeHtml(t("save"))}
          </button>
        </div>
      </div>
    </form>`;
}

function renderCategorySection(category: string, rows: SystemSettingRow[]): string {
  const complianceInfo =
    category === "compliance"
      ? `<div class="callout callout-info" data-testid="per-hall-spillvett-override-info">
          <i class="fa fa-info-circle" aria-hidden="true"></i> ${escapeHtml(t("per_hall_spillvett_override_info"))}
        </div>`
      : "";
  const fields = rows.map((r) => renderField(r)).join("");
  return `
    <fieldset data-testid="settings-section-${escapeHtml(category)}" class="settings-section">
      <legend>${escapeHtml(categoryLabel(category))}</legend>
      ${complianceInfo}
      ${fields}
    </fieldset>`;
}

function renderField(row: SystemSettingRow): string {
  const fieldId = `sf-${row.key.replace(/\./g, "-")}`;
  const isDefaultBadge = row.isDefault
    ? `<span class="label label-default" data-testid="${escapeHtml(fieldId)}-default-badge">${escapeHtml(t("setting_is_default"))}</span>`
    : "";
  const description = row.description
    ? `<p class="help-block"><small>${escapeHtml(row.description)}</small></p>`
    : "";

  let control = "";
  switch (row.type) {
    case "boolean":
      control = `
        <input type="checkbox"
               id="${escapeHtml(fieldId)}"
               name="${escapeHtml(row.key)}"
               data-setting-type="boolean"
               data-testid="${escapeHtml(fieldId)}"
               ${row.value === true ? "checked" : ""}>`;
      break;
    case "number":
      control = `
        <input type="number"
               id="${escapeHtml(fieldId)}"
               name="${escapeHtml(row.key)}"
               class="form-control"
               data-setting-type="number"
               data-testid="${escapeHtml(fieldId)}"
               value="${escapeHtml(String(row.value ?? 0))}">`;
      break;
    case "object":
      control = `
        <textarea id="${escapeHtml(fieldId)}"
                  name="${escapeHtml(row.key)}"
                  class="form-control"
                  rows="4"
                  data-setting-type="object"
                  data-testid="${escapeHtml(fieldId)}"
                  placeholder="{}">${escapeHtml(JSON.stringify(row.value ?? {}, null, 2))}</textarea>`;
      break;
    case "string":
    default: {
      const val = typeof row.value === "string" ? row.value : "";
      const isLongText = row.key === "system.information";
      control = isLongText
        ? `<textarea id="${escapeHtml(fieldId)}"
                    name="${escapeHtml(row.key)}"
                    class="form-control"
                    rows="6"
                    data-setting-type="string"
                    data-testid="${escapeHtml(fieldId)}">${escapeHtml(val)}</textarea>`
        : `<input type="text"
                id="${escapeHtml(fieldId)}"
                name="${escapeHtml(row.key)}"
                class="form-control"
                data-setting-type="string"
                data-testid="${escapeHtml(fieldId)}"
                value="${escapeHtml(val)}">`;
      break;
    }
  }

  return `
    <div class="form-group" data-setting-key="${escapeHtml(row.key)}">
      <label class="col-sm-3 control-label" for="${escapeHtml(fieldId)}">
        ${escapeHtml(row.key)}
        ${isDefaultBadge}
      </label>
      <div class="col-sm-9">
        ${control}
        ${description}
      </div>
    </div>`;
}

async function submit(
  form: HTMLFormElement,
  original: SystemSettingRow[],
  host: HTMLElement
): Promise<void> {
  const patches: SystemSettingPatchEntry[] = [];
  const originalByKey = new Map(original.map((r) => [r.key, r]));

  const fields = form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    "[data-setting-type]"
  );
  for (const el of Array.from(fields)) {
    const key = el.name;
    const type = el.dataset.settingType as "string" | "number" | "boolean" | "object";
    const current = originalByKey.get(key);
    if (!current) continue;

    let newValue: unknown;
    try {
      newValue = parseFieldValue(el, type);
    } catch {
      Toast.error(`${key}: ${t("setting_json_parse_error")}`);
      return;
    }
    // Bare send patch hvis endret (sparer audit-støy).
    if (!deepEqual(current.value, newValue)) {
      patches.push({ key, value: newValue });
    }
  }

  if (patches.length === 0) {
    Toast.success(t("no_changes_to_save"));
    return;
  }

  try {
    const res = await patchSystemSettings(patches);
    Toast.success(t("setting_save_success"));
    // Re-render med nye verdier (updatedAt-oppdatering + fjern default-badge).
    host.innerHTML = renderForm(res.settings);
    const freshForm = host.querySelector<HTMLFormElement>("#settings-form")!;
    freshForm.addEventListener("submit", (ev) => {
      ev.preventDefault();
      void submit(freshForm, res.settings, host);
    });
  } catch (err) {
    const message = err instanceof ApiError ? err.message : t("something_went_wrong");
    Toast.error(message);
  }
}

function parseFieldValue(
  el: HTMLInputElement | HTMLTextAreaElement,
  type: "string" | "number" | "boolean" | "object"
): unknown {
  switch (type) {
    case "boolean":
      return (el as HTMLInputElement).checked;
    case "number": {
      const n = Number((el as HTMLInputElement).value);
      if (!Number.isFinite(n)) {
        throw new Error("not finite");
      }
      return n;
    }
    case "object": {
      const raw = (el as HTMLTextAreaElement).value.trim();
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("not object");
      }
      return parsed;
    }
    case "string":
    default:
      return (el as HTMLInputElement).value;
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== "object") return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}
