// PR-A5 (BIN-663) — shared add/edit form used by admin + user bolk.
//
// Drives three routes (dispatcher picks variant from path):
//   /adminUser/add          → variant "admin"  (role locked to ADMIN)
//   /adminUser/edit/:id     → variant "admin"  (edit)
//   /user/add               → variant "user"   (role select SUPPORT|HALL_OPERATOR)
//   /user/edit/:id          → variant "user"   (edit)
//
// Data:
//   POST   /api/admin/users           { email, password, displayName, surname, role, phone, hallId }
//   GET    /api/admin/users/:id
//   PUT    /api/admin/users/:id       (displayName, email, phone)
//   PUT    /api/admin/users/:id/role  (role switch)
//   PUT    /api/admin/users/:id/hall  (hall reassignment)
//
// Ports legacy admin/add.html and user/add.html (shared form by PR-A5 slim-
// strategy: legacy differed only in role dropdown + hall picker).

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { ApiError } from "../../api/client.js";
import {
  createAdminUser,
  updateAdminUser,
  getAdminUser,
  assignUserRole,
  assignUserHall,
  type AdminUser,
  type AdminUserRole,
} from "../../api/admin-users.js";
import { listHalls, type AdminHall } from "../../api/admin-halls.js";
import { boxClose, boxOpen, contentHeader, escapeHtml } from "./shared.js";

export type UserFormVariant = "admin" | "user";

interface RenderOptions {
  variant: UserFormVariant;
  editId: string | null;
}

export function renderUserFormPage(container: HTMLElement, opts: RenderOptions): void {
  const isEdit = opts.editId !== null;
  const moduleKey = opts.variant === "admin" ? "admin_management" : "user_management";
  const titleKey = isEdit
    ? (opts.variant === "admin" ? "edit_admin" : "edit_user")
    : (opts.variant === "admin" ? "add_admin" : "add_user");

  container.innerHTML = `
    ${contentHeader(titleKey, moduleKey)}
    <section class="content">
      ${boxOpen(titleKey, "primary")}
        <div id="user-form-host">${escapeHtml(t("loading_ellipsis"))}</div>
      ${boxClose()}
    </section>`;

  const host = container.querySelector<HTMLElement>("#user-form-host")!;
  void mount(host, opts, isEdit);
}

async function mount(
  host: HTMLElement,
  opts: RenderOptions,
  isEdit: boolean
): Promise<void> {
  let halls: AdminHall[] = [];
  let existing: AdminUser | null = null;
  try {
    [halls, existing] = await Promise.all([
      listHalls().catch(() => [] as AdminHall[]),
      isEdit && opts.editId ? getAdminUser(opts.editId) : Promise.resolve(null),
    ]);
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
    host.innerHTML = `<div class="callout callout-danger">${escapeHtml(msg)}</div>`;
    return;
  }

  const roleOptions: AdminUserRole[] =
    opts.variant === "admin" ? ["ADMIN"] : ["SUPPORT", "HALL_OPERATOR"];
  const defaultRole: AdminUserRole = (existing?.role as AdminUserRole) ?? roleOptions[0]!;

  host.innerHTML = `
    <form id="user-form" class="form-horizontal" data-testid="user-form" data-variant="${escapeHtml(opts.variant)}">
      <div class="form-group">
        <label class="col-sm-3 control-label" for="uf-displayName">${escapeHtml(t("first_name"))}</label>
        <div class="col-sm-9">
          <input type="text" id="uf-displayName" name="displayName" class="form-control" required
            value="${escapeHtml(existing?.displayName ?? "")}">
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-3 control-label" for="uf-surname">${escapeHtml(t("last_name"))}</label>
        <div class="col-sm-9">
          <input type="text" id="uf-surname" name="surname" class="form-control"
            value="${escapeHtml(existing?.surname ?? "")}">
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-3 control-label" for="uf-email">${escapeHtml(t("email"))}</label>
        <div class="col-sm-9">
          <input type="email" id="uf-email" name="email" class="form-control" required
            value="${escapeHtml(existing?.email ?? "")}">
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-3 control-label" for="uf-phone">${escapeHtml(t("phone"))}</label>
        <div class="col-sm-9">
          <input type="text" id="uf-phone" name="phone" class="form-control"
            value="${escapeHtml(existing?.phone ?? "")}">
        </div>
      </div>
      ${isEdit ? "" : `
      <div class="form-group">
        <label class="col-sm-3 control-label" for="uf-password">${escapeHtml(t("password"))}</label>
        <div class="col-sm-9">
          <input type="password" id="uf-password" name="password" class="form-control" required minlength="8">
        </div>
      </div>`}
      <div class="form-group">
        <label class="col-sm-3 control-label" for="uf-role">${escapeHtml(t("role"))}</label>
        <div class="col-sm-9">
          <select id="uf-role" name="role" class="form-control" ${roleOptions.length === 1 ? "disabled" : ""}>
            ${roleOptions
              .map(
                (r) =>
                  `<option value="${escapeHtml(r)}"${r === defaultRole ? " selected" : ""}>${escapeHtml(t(`role_enum_${r.toLowerCase()}`))}</option>`
              )
              .join("")}
          </select>
        </div>
      </div>
      <div class="form-group" data-field="hall" ${opts.variant === "admin" ? 'style="display:none"' : ""}>
        <label class="col-sm-3 control-label" for="uf-hall">${escapeHtml(t("select_hall"))}</label>
        <div class="col-sm-9">
          <select id="uf-hall" name="hallId" class="form-control">
            <option value="">${escapeHtml(t("select_hall"))}</option>
            ${halls
              .map(
                (h) =>
                  `<option value="${escapeHtml(h.id)}"${existing?.hallId === h.id ? " selected" : ""}>${escapeHtml(h.name)}</option>`
              )
              .join("")}
          </select>
        </div>
      </div>
      <div class="form-group">
        <div class="col-sm-offset-3 col-sm-9">
          <button type="submit" class="btn btn-success" data-action="save-user">
            <i class="fa fa-save" aria-hidden="true"></i> ${escapeHtml(t("submit"))}
          </button>
          <a class="btn btn-default" href="#${opts.variant === "admin" ? "/adminUser" : "/user"}">
            ${escapeHtml(t("cancel"))}
          </a>
        </div>
      </div>
    </form>`;

  const form = host.querySelector<HTMLFormElement>("#user-form")!;
  const roleEl = form.querySelector<HTMLSelectElement>("#uf-role")!;
  const hallField = form.querySelector<HTMLElement>('[data-field="hall"]')!;

  roleEl.addEventListener("change", () => {
    // Hall-picker is only relevant for HALL_OPERATOR (or user-variant with HALL_OPERATOR selected).
    hallField.style.display = roleEl.value === "HALL_OPERATOR" ? "" : "none";
  });
  // Initial toggle in case defaultRole is not HALL_OPERATOR.
  hallField.style.display =
    opts.variant === "user" && roleEl.value === "HALL_OPERATOR" ? "" : (opts.variant === "admin" ? "none" : hallField.style.display);

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void submit(form, opts, existing);
  });
}

async function submit(
  form: HTMLFormElement,
  opts: RenderOptions,
  existing: AdminUser | null
): Promise<void> {
  const displayName = (form.querySelector<HTMLInputElement>("#uf-displayName")!).value.trim();
  const surname = (form.querySelector<HTMLInputElement>("#uf-surname")!).value.trim();
  const email = (form.querySelector<HTMLInputElement>("#uf-email")!).value.trim();
  const phone = (form.querySelector<HTMLInputElement>("#uf-phone")!).value.trim();
  const role = (form.querySelector<HTMLSelectElement>("#uf-role")!).value as AdminUserRole;
  const hallId = (form.querySelector<HTMLSelectElement>("#uf-hall")!).value || null;
  const passwordEl = form.querySelector<HTMLInputElement>("#uf-password");
  const password = passwordEl ? passwordEl.value : "";

  if (!displayName || !email) {
    Toast.error(t("all_fields_are_required"));
    return;
  }

  try {
    if (existing) {
      await updateAdminUser(existing.id, { displayName, email, phone });
      if (existing.role !== role) {
        await assignUserRole(existing.id, role);
      }
      if (role === "HALL_OPERATOR" && existing.hallId !== hallId) {
        await assignUserHall(existing.id, hallId);
      }
      Toast.success(t("success"));
    } else {
      if (password.length < 8) {
        Toast.error(t("password_too_short"));
        return;
      }
      await createAdminUser({
        email,
        password,
        displayName,
        surname,
        role,
        phone,
        hallId: role === "HALL_OPERATOR" ? hallId : null,
      });
      Toast.success(t("success"));
    }
    window.location.hash = opts.variant === "admin" ? "#/adminUser" : "#/user";
  } catch (err) {
    Toast.error(err instanceof ApiError ? err.message : t("something_went_wrong"));
  }
}
