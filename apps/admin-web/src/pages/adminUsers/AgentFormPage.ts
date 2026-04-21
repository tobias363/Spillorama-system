// PR-A5 (BIN-663) — /agent/add + /agent/edit/:id.
//
// Data:
//   POST /api/admin/agents     { email, password, displayName, surname, phone, language, hallIds[], primaryHallId }
//   GET  /api/admin/agents/:id
//   PUT  /api/admin/agents/:id
//
// Multi-hall-select uses <select multiple> (native vanilla DOM) — we drop
// the legacy chosen.js dependency and let the browser paint the list.

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { ApiError } from "../../api/client.js";
import {
  createAgent,
  updateAgent,
  getAgent,
  type Agent,
} from "../../api/admin-agents.js";
import { listHalls, type AdminHall } from "../../api/admin-halls.js";
import { boxClose, boxOpen, contentHeader, escapeHtml } from "./shared.js";

const LANGUAGES: ReadonlyArray<{ value: string; labelKey: string }> = [
  { value: "no", labelKey: "norwegian" },
  { value: "en", labelKey: "english" },
];

export function renderAgentFormPage(container: HTMLElement, editId: string | null): void {
  const isEdit = editId !== null;
  const titleKey = isEdit ? "edit_agent" : "add_agent";

  container.innerHTML = `
    ${contentHeader(titleKey, "agent_management")}
    <section class="content">
      ${boxOpen(titleKey, "primary")}
        <div id="agent-form-host">${escapeHtml(t("loading_ellipsis"))}</div>
      ${boxClose()}
    </section>`;

  const host = container.querySelector<HTMLElement>("#agent-form-host")!;
  void mount(host, editId, isEdit);
}

async function mount(host: HTMLElement, editId: string | null, isEdit: boolean): Promise<void> {
  let halls: AdminHall[] = [];
  let existing: Agent | null = null;
  try {
    [halls, existing] = await Promise.all([
      listHalls().catch(() => [] as AdminHall[]),
      isEdit && editId ? getAgent(editId) : Promise.resolve(null),
    ]);
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
    host.innerHTML = `<div class="callout callout-danger">${escapeHtml(msg)}</div>`;
    return;
  }

  const assignedHallIds = new Set((existing?.halls ?? []).map((h) => h.hallId));
  const primaryHallId =
    (existing?.halls ?? []).find((h) => h.isPrimary)?.hallId ??
    (existing?.halls ?? [])[0]?.hallId ??
    "";

  host.innerHTML = `
    <form id="agent-form" class="form-horizontal" data-testid="agent-form">
      <div class="form-group">
        <label class="col-sm-3 control-label" for="af-displayName">${escapeHtml(t("first_name"))}</label>
        <div class="col-sm-9">
          <input type="text" id="af-displayName" name="displayName" class="form-control" required
            value="${escapeHtml(existing?.displayName ?? "")}">
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-3 control-label" for="af-surname">${escapeHtml(t("last_name"))}</label>
        <div class="col-sm-9">
          <input type="text" id="af-surname" name="surname" class="form-control"
            value="${escapeHtml(existing?.surname ?? "")}">
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-3 control-label" for="af-email">${escapeHtml(t("email"))}</label>
        <div class="col-sm-9">
          <input type="email" id="af-email" name="email" class="form-control" required
            value="${escapeHtml(existing?.email ?? "")}">
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-3 control-label" for="af-phone">${escapeHtml(t("agent_phone"))}</label>
        <div class="col-sm-9">
          <input type="text" id="af-phone" name="phone" class="form-control"
            value="${escapeHtml(existing?.phone ?? "")}">
        </div>
      </div>
      ${isEdit ? "" : `
      <div class="form-group">
        <label class="col-sm-3 control-label" for="af-password">${escapeHtml(t("password"))}</label>
        <div class="col-sm-9">
          <input type="password" id="af-password" name="password" class="form-control" required minlength="8">
        </div>
      </div>`}
      <div class="form-group">
        <label class="col-sm-3 control-label" for="af-language">${escapeHtml(t("agent_language"))}</label>
        <div class="col-sm-9">
          <select id="af-language" name="language" class="form-control">
            ${LANGUAGES.map(
              (l) =>
                `<option value="${escapeHtml(l.value)}"${(existing?.language ?? "no") === l.value ? " selected" : ""}>${escapeHtml(t(l.labelKey))}</option>`
            ).join("")}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-3 control-label" for="af-halls">${escapeHtml(t("assign_halls"))}</label>
        <div class="col-sm-9">
          <select id="af-halls" name="hallIds" class="form-control" multiple size="5"
                  data-testid="agent-hall-multiselect">
            ${halls
              .map(
                (h) =>
                  `<option value="${escapeHtml(h.id)}"${assignedHallIds.has(h.id) ? " selected" : ""}>${escapeHtml(h.name)}</option>`
              )
              .join("")}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-3 control-label" for="af-primary">${escapeHtml(t("select_hall"))}</label>
        <div class="col-sm-9">
          <select id="af-primary" name="primaryHallId" class="form-control">
            <option value="">${escapeHtml(t("select_hall"))}</option>
            ${halls
              .map(
                (h) =>
                  `<option value="${escapeHtml(h.id)}"${primaryHallId === h.id ? " selected" : ""}>${escapeHtml(h.name)}</option>`
              )
              .join("")}
          </select>
        </div>
      </div>
      <div class="form-group">
        <div class="col-sm-offset-3 col-sm-9">
          <button type="submit" class="btn btn-success" data-action="save-agent">
            <i class="fa fa-save"></i> ${escapeHtml(t("submit"))}
          </button>
          <a class="btn btn-default" href="#/agent">${escapeHtml(t("cancel"))}</a>
        </div>
      </div>
    </form>`;

  const form = host.querySelector<HTMLFormElement>("#agent-form")!;
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void submit(form, existing);
  });
}

async function submit(form: HTMLFormElement, existing: Agent | null): Promise<void> {
  const displayName = (form.querySelector<HTMLInputElement>("#af-displayName")!).value.trim();
  const surname = (form.querySelector<HTMLInputElement>("#af-surname")!).value.trim();
  const email = (form.querySelector<HTMLInputElement>("#af-email")!).value.trim();
  const phone = (form.querySelector<HTMLInputElement>("#af-phone")!).value.trim();
  const language = (form.querySelector<HTMLSelectElement>("#af-language")!).value;
  const passwordEl = form.querySelector<HTMLInputElement>("#af-password");
  const password = passwordEl ? passwordEl.value : "";
  const hallsSel = form.querySelector<HTMLSelectElement>("#af-halls")!;
  const hallIds = Array.from(hallsSel.selectedOptions).map((o) => o.value);
  const primaryHallIdRaw = (form.querySelector<HTMLSelectElement>("#af-primary")!).value;
  const primaryHallId = primaryHallIdRaw || (hallIds[0] ?? "");

  if (!displayName || !email) {
    Toast.error(t("all_fields_are_required"));
    return;
  }
  if (hallIds.length === 0) {
    Toast.error(t("select_halls"));
    return;
  }
  if (primaryHallId && !hallIds.includes(primaryHallId)) {
    // Ensure primary hall is part of assigned halls.
    hallIds.push(primaryHallId);
  }

  try {
    if (existing) {
      await updateAgent(existing.userId, {
        displayName,
        email,
        phone: phone || null,
        language,
        hallIds,
        primaryHallId: primaryHallId || undefined,
      });
      Toast.success(t("success"));
    } else {
      if (password.length < 8) {
        Toast.error(t("password_too_short"));
        return;
      }
      await createAgent({
        email,
        password,
        displayName,
        surname,
        phone,
        language,
        hallIds,
        primaryHallId: primaryHallId || undefined,
      });
      Toast.success(t("success"));
    }
    window.location.hash = "#/agent";
  } catch (err) {
    Toast.error(err instanceof ApiError ? err.message : t("something_went_wrong"));
  }
}
