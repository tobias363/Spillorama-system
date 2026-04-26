// PR-B6 (BIN-664) — Risk-country list + inline add modal.
//
// Data:
//   GET    /api/admin/security/risk-countries       → ListRiskCountriesResponse
//   POST   /api/admin/security/risk-countries       → add (SECURITY_WRITE)
//   DELETE /api/admin/security/risk-countries/:code → delete (SECURITY_WRITE)
//
// Add-flow matches legacy: modal over the list page with a country dropdown
// that excludes already-present codes. Backend is still authoritative — it
// normalises ISO code to uppercase and rejects duplicates.
//
// Regulatorisk (AML — pengespillforskriften §27–30 + hvitvaskingsloven):
//   - SECURITY_READ lists; SECURITY_WRITE mutations (backend-enforced)
//   - All mutations audit-logged by backend (adminSecurity.ts:178-220)
//   - Fail-closed: backend-500 → callout-danger, NOT silent empty list
//   - ISO-3166 alpha-2 format validated backend-side (DomainError)

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { DataTable } from "../../components/DataTable.js";
import { Modal } from "../../components/Modal.js";
import { ApiError } from "../../api/client.js";
import { hasPermission } from "../../auth/permissions.js";
import {
  listRiskCountries,
  addRiskCountry,
  deleteRiskCountry,
  type RiskCountry,
} from "../../api/admin-security-risk-countries.js";
import {
  ISO_COUNTRIES,
  boxClose,
  boxOpen,
  contentHeader,
  escapeHtml,
} from "./shared.js";

interface PageState {
  rows: RiskCountry[];
}

export function renderRiskCountryPage(container: HTMLElement): void {
  const state: PageState = { rows: [] };
  const canWrite = hasPermission("Security Management", "edit");

  container.innerHTML = `
    ${contentHeader("risk_country_table")}
    <section class="content">
      ${boxOpen("risk_country", "primary")}
        <div class="row" style="margin-bottom:12px;">
          <div class="col-sm-12 text-right">
            ${
              canWrite
                ? `<button type="button" class="btn btn-primary" data-action="add-risk-country">
                    <i class="fa fa-plus" aria-hidden="true"></i> ${escapeHtml(t("add_risk_country"))}
                  </button>`
                : ""
            }
          </div>
        </div>
        <div id="risk-country-table">${escapeHtml(t("loading_ellipsis"))}</div>
      ${boxClose()}
    </section>`;

  const tableHost = container.querySelector<HTMLElement>("#risk-country-table")!;
  container
    .querySelector<HTMLButtonElement>('[data-action="add-risk-country"]')
    ?.addEventListener("click", () => openAddModal());

  async function refresh(): Promise<void> {
    tableHost.textContent = t("loading_ellipsis");
    try {
      const res = await listRiskCountries();
      state.rows = res.countries;
      DataTable.mount<RiskCountry>(tableHost, {
        id: "risk-country-datatable",
        columns: [
          {
            key: "countryCode",
            title: t("risk_country_id"),
            render: (r) => escapeHtml(r.countryCode),
          },
          {
            key: "label",
            title: t("risk_country_name"),
            render: (r) => escapeHtml(r.label),
          },
          {
            key: "reason",
            title: t("reason"),
            render: (r) => escapeHtml(r.reason ?? ""),
          },
          {
            key: "createdAt",
            title: t("created_at"),
            render: (r) =>
              escapeHtml(new Date(r.createdAt).toISOString().slice(0, 10)),
          },
          ...(canWrite
            ? [
                {
                  key: "countryCode" as const,
                  title: t("action"),
                  align: "center" as const,
                  render: (r: RiskCountry) => renderActions(r),
                },
              ]
            : []),
        ],
        rows: state.rows,
        emptyMessage: t("no_data_available_in_table"),
        csvExport: {
          filename: "risk-countries",
          transform: (r) => ({
            countryCode: r.countryCode,
            label: r.label,
            reason: r.reason ?? "",
            addedBy: r.addedBy ?? "",
            createdAt: r.createdAt,
          }),
        },
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
      tableHost.innerHTML = `<div class="callout callout-danger">${escapeHtml(msg)}</div>`;
    }
  }

  function renderActions(row: RiskCountry): Node {
    const wrap = document.createElement("div");
    wrap.style.whiteSpace = "nowrap";
    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn btn-danger btn-xs";
    del.setAttribute("data-action", "delete-risk-country");
    del.setAttribute("data-code", row.countryCode);
    del.innerHTML = `<i class="fa fa-trash" aria-hidden="true"></i>`;
    del.title = t("risk_country_delete");
    del.setAttribute("aria-label", t("risk_country_delete"));
    del.addEventListener("click", () => openDeleteModal(row));
    wrap.append(del);
    return wrap;
  }

  function openDeleteModal(row: RiskCountry): void {
    Modal.open({
      title: t("are_you_sure"),
      content: `<p>${escapeHtml(t("you_will_not_be_able_to_recover_this_request"))}</p>
        <p><strong>${escapeHtml(row.label)} (${escapeHtml(row.countryCode)})</strong></p>`,
      buttons: [
        { label: t("cancel_button"), variant: "default", action: "cancel" },
        {
          label: t("delete_button"),
          variant: "danger",
          action: "confirm",
          onClick: async () => {
            try {
              await deleteRiskCountry(row.countryCode);
              Toast.success(t("risk_country_delete_msg"));
              await refresh();
            } catch (err) {
              Toast.error(
                err instanceof ApiError ? err.message : t("something_went_wrong")
              );
            }
          },
        },
      ],
    });
  }

  function openAddModal(): void {
    const existingCodes = new Set(state.rows.map((r) => r.countryCode.toUpperCase()));
    const options = ISO_COUNTRIES.filter((c) => !existingCodes.has(c.code.toUpperCase()))
      .map(
        (c) =>
          `<option value="${escapeHtml(c.code)}" data-label="${escapeHtml(c.label)}">${escapeHtml(c.label)} (${escapeHtml(c.code)})</option>`
      )
      .join("");

    const form = document.createElement("form");
    form.className = "form-horizontal";
    form.setAttribute("data-testid", "add-risk-country-form");
    form.innerHTML = `
      <div class="form-group">
        <label class="col-sm-4 control-label" for="rc-code">${escapeHtml(t("risk_country_name"))}</label>
        <div class="col-sm-8">
          <select id="rc-code" name="countryCode" class="form-control" required>
            <option value="">${escapeHtml(t("select_country_placeholder"))}</option>
            ${options}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-4 control-label" for="rc-reason">${escapeHtml(t("reason"))}</label>
        <div class="col-sm-8">
          <input type="text" id="rc-reason" name="reason" class="form-control">
        </div>
      </div>`;

    const instance = Modal.open({
      title: t("add_risk_country"),
      content: form,
      size: "lg",
      buttons: [
        { label: t("cancel_button"), variant: "default", action: "cancel" },
        {
          label: t("submit"),
          variant: "success",
          action: "submit",
          dismiss: false,
          onClick: async () => {
            const codeEl = form.querySelector<HTMLSelectElement>("#rc-code")!;
            const reasonEl = form.querySelector<HTMLInputElement>("#rc-reason")!;
            const countryCode = codeEl.value.trim();
            if (!countryCode) {
              Toast.error(t("risk_country_name"));
              return;
            }
            const selected = codeEl.options[codeEl.selectedIndex];
            const label =
              selected?.getAttribute("data-label") ??
              ISO_COUNTRIES.find((c) => c.code === countryCode)?.label ??
              countryCode;
            const reason = reasonEl.value.trim();
            try {
              await addRiskCountry({
                countryCode,
                label,
                reason: reason || null,
              });
              Toast.success(t("risk_country_add_msg"));
              instance.close("button");
              await refresh();
            } catch (err) {
              Toast.error(
                err instanceof ApiError ? err.message : t("something_went_wrong")
              );
            }
          },
        },
      ],
    });
  }

  void refresh();
}
