// PR-B4 (BIN-646) — Withdraw email-allowlist side.
// Menypunktet lever under /withdraw/list/emails (matcher legacy-struktur), men
// backend-endepunktet er /api/admin/security/withdraw-emails (modulerrt etter
// "security"-domenet).
//
// Operasjoner:
//   - list (SECURITY_READ)
//   - add (SECURITY_WRITE + AuditLog: security.withdraw_email.add)
//   - delete (SECURITY_WRITE + AuditLog: security.withdraw_email.remove)
//
// Edit: backend har ingen PATCH-endpoint (PR-B4-PLAN G4). Vi gjør delete +
// re-add hvis bruker trykker rediger — uniqueness håndteres av DB-constraint
// som returnerer WITHDRAW_EMAIL_EXISTS. Regulatorisk: dette gir 2 audit-events
// (remove + add) som er MER sporbart enn en in-place PATCH, så vi aksepterer.
//
// Regulatorisk hard-krav:
//   - SECURITY_WRITE gate: kun ADMIN.
//   - Fail-closed: backend-500 ved add/delete → Toast.error, listen blir ikke
//     oppdatert (ikke "silent success").
//   - Client-side email-validering er ikke regulatorisk men UX (backend har
//     autoritativ validering).

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { DataTable } from "../../components/DataTable.js";
import { Modal } from "../../components/Modal.js";
import { ApiError } from "../../api/client.js";
import { hasPermission } from "../../auth/permissions.js";
import {
  listWithdrawEmails,
  addWithdrawEmail,
  deleteWithdrawEmail,
  type WithdrawEmail,
} from "../../api/admin-security-emails.js";
import {
  boxClose,
  boxOpen,
  contentHeader,
  escapeHtml,
} from "./shared.js";

interface PageState {
  rows: WithdrawEmail[];
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function renderEmailsPage(container: HTMLElement): void {
  const state: PageState = { rows: [] };
  const canWrite = hasPermission("Withdraw Management", "edit");

  container.innerHTML = `
    ${contentHeader("withdraw_accountant_emails")}
    <section class="content">
      ${boxOpen("withdraw_accountant_emails", "primary")}
        <div class="row" style="margin-bottom:12px;">
          <div class="col-sm-12 text-right">
            ${
              canWrite
                ? `<button type="button" class="btn btn-success" data-action="add">
                    <i class="fa fa-plus"></i> ${escapeHtml(t("add_email"))}
                  </button>`
                : ""
            }
          </div>
        </div>
        <div id="emails-table">${escapeHtml(t("loading_ellipsis"))}</div>
      ${boxClose()}
    </section>`;

  const tableHost = container.querySelector<HTMLElement>("#emails-table")!;
  container
    .querySelector<HTMLButtonElement>("[data-action='add']")
    ?.addEventListener("click", () => openAddModal());

  async function refresh(): Promise<void> {
    tableHost.textContent = t("loading_ellipsis");
    try {
      const res = await listWithdrawEmails();
      state.rows = res.emails;
      DataTable.mount<WithdrawEmail>(tableHost, {
        columns: buildColumns(),
        rows: state.rows,
        emptyMessage: t("no_data_available_in_table"),
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
      tableHost.innerHTML = `<div class="callout callout-danger">${escapeHtml(msg)}</div>`;
    }
  }

  function buildColumns(): Parameters<typeof DataTable.mount<WithdrawEmail>>[1]["columns"] {
    const cols: Parameters<typeof DataTable.mount<WithdrawEmail>>[1]["columns"] = [
      { key: "email", title: t("email"), render: (r) => escapeHtml(r.email) },
      { key: "label", title: t("name"), render: (r) => escapeHtml(r.label ?? "") },
      {
        key: "createdAt",
        title: t("created_at"),
        render: (r) => new Date(r.createdAt).toISOString().slice(0, 10),
      },
    ];
    if (canWrite) {
      cols.push({
        key: "id",
        title: t("action"),
        align: "center",
        render: (r) => renderActionCell(r),
      });
    }
    return cols;
  }

  function renderActionCell(r: WithdrawEmail): Node {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:inline-flex;gap:4px;";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "btn btn-warning btn-xs";
    edit.setAttribute("data-id", r.id);
    edit.setAttribute("data-action", "edit");
    edit.innerHTML = `<i class="fa fa-edit"></i>`;
    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn btn-danger btn-xs";
    del.setAttribute("data-id", r.id);
    del.setAttribute("data-action", "delete");
    del.innerHTML = `<i class="fa fa-trash"></i>`;
    wrap.append(edit, del);
    return wrap;
  }

  tableHost.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-action][data-id]");
    if (!btn) return;
    const id = btn.getAttribute("data-id")!;
    const action = btn.getAttribute("data-action");
    const row = state.rows.find((r) => r.id === id);
    if (!row) return;
    if (action === "edit") openEditModal(row);
    else if (action === "delete") openDeleteModal(row);
  });

  function openAddModal(): void {
    openEmailForm({
      title: t("add_email"),
      initialEmail: "",
      initialLabel: "",
      onSubmit: async (email, label) => {
        await addWithdrawEmail({ email, label: label || null });
        Toast.success(t("add_email"));
      },
    });
  }

  function openEditModal(row: WithdrawEmail): void {
    // Edit = delete + re-add. See module header for regulatorisk note.
    openEmailForm({
      title: t("edit_email"),
      initialEmail: row.email,
      initialLabel: row.label ?? "",
      onSubmit: async (email, label) => {
        await deleteWithdrawEmail(row.id);
        await addWithdrawEmail({ email, label: label || null });
        Toast.success(t("edit_email"));
      },
    });
  }

  function openDeleteModal(row: WithdrawEmail): void {
    Modal.open({
      title: t("are_you_sure"),
      content: `<p>${escapeHtml(t("you_will_not_be_able_to_recover_this_request"))}</p>
        <p><strong>${escapeHtml(row.email)}</strong></p>`,
      buttons: [
        { label: t("cancel_button"), variant: "default", action: "cancel" },
        {
          label: t("delete_button"),
          variant: "danger",
          action: "confirm",
          onClick: async () => {
            try {
              await deleteWithdrawEmail(row.id);
              Toast.success(t("delete_button"));
              await refresh();
            } catch (err) {
              const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
              Toast.error(msg);
            }
          },
        },
      ],
    });
  }

  interface EmailFormOpts {
    title: string;
    initialEmail: string;
    initialLabel: string;
    onSubmit: (email: string, label: string) => Promise<void>;
  }

  function openEmailForm(opts: EmailFormOpts): void {
    const body = document.createElement("div");
    body.innerHTML = `
      <div class="form-group">
        <label>${escapeHtml(t("email"))} *</label>
        <input type="email" id="email-input" class="form-control" value="${escapeHtml(opts.initialEmail)}" required>
      </div>
      <div class="form-group">
        <label>${escapeHtml(t("name"))}</label>
        <input type="text" id="label-input" class="form-control" value="${escapeHtml(opts.initialLabel)}">
      </div>`;
    Modal.open({
      title: opts.title,
      content: body,
      buttons: [
        { label: t("cancel_button"), variant: "default", action: "cancel" },
        {
          label: t("submit"),
          variant: "primary",
          action: "confirm",
          dismiss: false,
          onClick: async (instance) => {
            const email = body.querySelector<HTMLInputElement>("#email-input")!.value.trim();
            const label = body.querySelector<HTMLInputElement>("#label-input")!.value.trim();
            if (!EMAIL_REGEX.test(email)) {
              Toast.error(t("email"));
              return;
            }
            try {
              await opts.onSubmit(email, label);
              instance.close("button");
              await refresh();
            } catch (err) {
              const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
              Toast.error(msg);
            }
          },
        },
      ],
    });
  }

  void refresh();
}
