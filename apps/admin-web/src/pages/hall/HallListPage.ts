// PR-A5 (BIN-663) — /hall list.
//
// Data:
//   GET /api/admin/halls?includeInactive=true
//   PUT /api/admin/halls/:id  (isActive toggle)
//   POST /api/admin/halls/:id/add-money  (Add Money-popup)
//
// Tabellen viser Hall ID (auto), Hall Name, Hall Number, Address,
// Available Balance, Status + actions (edit / toggle / +money).
// Legacy-wireframene (Admin CR 21.02.2024) har IP Address + Group of Hall i
// samme rad — de legges til når backend-feltene er i plass.

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { DataTable } from "../../components/DataTable.js";
import { ApiError } from "../../api/client.js";
import {
  listHalls,
  setHallActive,
  addMoneyToHall,
  type AdminHall,
} from "../../api/admin-halls.js";
import {
  boxClose,
  boxOpen,
  contentHeader,
  escapeHtml,
  activeBadge,
} from "../adminUsers/shared.js";
import { Modal } from "../../components/Modal.js";

export function renderHallListPage(container: HTMLElement): void {
  container.innerHTML = `
    ${contentHeader("hall_management", "hall_management")}
    <section class="content">
      <div class="callout callout-warning" data-testid="hall-deactivate-info">
        <i class="fa fa-exclamation-triangle" aria-hidden="true"></i>
        ${escapeHtml(t("hall_deactivate_info"))}
      </div>
      ${boxOpen("hall_management", "primary")}
        <div id="hall-table">${escapeHtml(t("loading_ellipsis"))}</div>
      ${boxClose()}
    </section>`;

  const tableHost = container.querySelector<HTMLElement>("#hall-table")!;

  async function refresh(): Promise<void> {
    tableHost.textContent = t("loading_ellipsis");
    try {
      const rows = await listHalls({ includeInactive: true });
      DataTable.mount<AdminHall>(tableHost, {
        id: "hall-datatable",
        columns: [
          { key: "name", title: t("hall_name"), render: (r) => escapeHtml(r.name) },
          {
            key: "hallNumber",
            title: t("hall_number"),
            align: "center",
            render: (r) => r.hallNumber != null ? String(r.hallNumber) : "—",
          },
          {
            key: "address",
            title: t("address"),
            render: (r) => escapeHtml(r.address ?? ""),
          },
          {
            key: "cashBalance",
            title: t("available_balance"),
            align: "right",
            render: (r) => formatMoney(r.cashBalance ?? 0),
          },
          {
            key: "isActive",
            title: t("status"),
            align: "center",
            render: (r) => activeBadge(r.isActive),
          },
          // TV URL — public display-lenke som bingoverten åpner på hall-TV.
          // URL-en er offentlig ment (hall-token i URL er hele auth), men vi
          // short'er display-stringen for lesbarhet i tabellen.
          {
            key: "tvToken",
            title: t("tv_url"),
            align: "left",
            render: (r) => renderTvUrlCell(r),
          },
          {
            key: "id",
            title: t("action"),
            align: "center",
            render: (r) => rowActions(r, () => void refresh()),
          },
        ],
        rows,
        emptyMessage: t("no_data_available_in_table"),
        toolbar: {
          extra: (host) => {
            const addBtn = document.createElement("a");
            addBtn.className = "btn btn-primary btn-sm";
            addBtn.setAttribute("data-action", "add-hall");
            addBtn.href = "#/hall/add";
            addBtn.innerHTML = `<i class="fa fa-plus" aria-hidden="true"></i> ${escapeHtml(t("add_hall"))}`;
            host.append(addBtn);
          },
        },
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
      tableHost.innerHTML = `<div class="callout callout-danger">${escapeHtml(msg)}</div>`;
    }
  }

  void refresh();
}

function formatMoney(amount: number): string {
  // "kr 3 000" — matcher norsk konvensjon, men ingen tunge locale-avh.
  const rounded = Math.round(amount * 100) / 100;
  const formatted = rounded.toLocaleString("nb-NO", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return `kr ${formatted}`;
}

/**
 * Bygg en kopierbar TV URL-celle for hall-listen. Full URL format:
 *   `${origin}/admin/#/tv/<hallId>/<tvToken>`
 * Bingoverten kopierer denne, åpner i nettleseren på hall-TV-skjermen og
 * lar stå (ingen login).
 */
function renderTvUrlCell(row: AdminHall): Node {
  const wrap = document.createElement("div");
  wrap.style.display = "flex";
  wrap.style.alignItems = "center";
  wrap.style.gap = "6px";
  wrap.style.maxWidth = "320px";

  const url = buildTvUrl(row);

  const input = document.createElement("input");
  input.type = "text";
  input.readOnly = true;
  input.value = url;
  input.setAttribute("data-testid", "tv-url-input");
  input.setAttribute("data-hall-id", row.id);
  input.title = url;
  input.style.flex = "1";
  input.style.fontFamily = "monospace";
  input.style.fontSize = "11px";
  input.style.padding = "2px 6px";
  input.addEventListener("click", () => input.select());
  wrap.append(input);

  const openBtn = document.createElement("a");
  openBtn.href = url;
  openBtn.target = "_blank";
  openBtn.rel = "noopener noreferrer";
  openBtn.className = "btn btn-default btn-xs";
  openBtn.innerHTML = `<i class="fa fa-external-link" aria-hidden="true"></i>`;
  openBtn.title = "Åpne TV URL i ny fane";
  openBtn.setAttribute("aria-label", "Åpne TV URL i ny fane");
  openBtn.setAttribute("data-testid", "tv-url-open");
  wrap.append(openBtn);

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "btn btn-default btn-xs";
  copyBtn.innerHTML = `<i class="fa fa-clipboard" aria-hidden="true"></i>`;
  copyBtn.title = "Kopier URL";
  copyBtn.setAttribute("aria-label", "Kopier URL");
  copyBtn.setAttribute("data-testid", "tv-url-copy");
  copyBtn.addEventListener("click", () => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(url);
        Toast.success(t("success"));
      } catch {
        input.select();
        try {
          document.execCommand("copy");
          Toast.success(t("success"));
        } catch {
          Toast.error(t("something_went_wrong"));
        }
      }
    })();
  });
  wrap.append(copyBtn);

  return wrap;
}

/** Bygg full absolute TV URL for en hall. */
function buildTvUrl(row: AdminHall): string {
  const origin = window.location.origin;
  // Admin-web er base-mounted på `/admin/` (se vite.config.ts base). Full URL
  // er derfor origin + /admin/ + hash-route.
  const hid = encodeURIComponent(row.id);
  const tok = encodeURIComponent(row.tvToken ?? "");
  return `${origin}/admin/#/tv/${hid}/${tok}`;
}

function rowActions(row: AdminHall, onChange: () => void): Node {
  const wrap = document.createElement("div");
  wrap.style.whiteSpace = "nowrap";

  const edit = document.createElement("a");
  edit.className = "btn btn-warning btn-xs";
  edit.setAttribute("data-action", "edit-hall");
  edit.setAttribute("data-id", row.id);
  edit.href = `#/hall/edit/${encodeURIComponent(row.id)}`;
  edit.innerHTML = `<i class="fa fa-edit" aria-hidden="true"></i>`;
  edit.title = t("edit_hall");
  edit.setAttribute("aria-label", t("edit_hall"));
  wrap.append(edit);

  const addMoney = document.createElement("button");
  addMoney.type = "button";
  addMoney.className = "btn btn-success btn-xs";
  addMoney.setAttribute("data-action", "add-money");
  addMoney.setAttribute("data-id", row.id);
  addMoney.innerHTML = `<i class="fa fa-plus" aria-hidden="true"></i>`;
  addMoney.title = t("add_money");
  addMoney.setAttribute("aria-label", t("add_money"));
  addMoney.style.marginLeft = "4px";
  addMoney.addEventListener("click", () => openAddMoneyModal(row, onChange));
  wrap.append(addMoney);

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = row.isActive ? "btn btn-danger btn-xs" : "btn btn-success btn-xs";
  toggle.setAttribute("data-action", "toggle-hall");
  toggle.setAttribute("data-id", row.id);
  toggle.innerHTML = row.isActive
    ? `<i class="fa fa-ban" aria-hidden="true"></i>`
    : `<i class="fa fa-check" aria-hidden="true"></i>`;
  toggle.title = row.isActive ? t("inactive") : t("active");
  toggle.style.marginLeft = "4px";
  toggle.addEventListener("click", () => {
    // Confirmation required for deactivation (destructive-ish).
    if (row.isActive) {
      const msg = `${t("are_you_sure")}\n\n${t("hall_deactivate_info")}`;
      if (!window.confirm(msg)) return;
    }
    void (async () => {
      try {
        await setHallActive(row.id, !row.isActive);
        Toast.success(t("success"));
        onChange();
      } catch (err) {
        Toast.error(err instanceof ApiError ? err.message : t("something_went_wrong"));
      }
    })();
  });
  wrap.append(toggle);

  return wrap;
}

/**
 * Add Money-popup — åpner Modal med current balance + input + submit.
 * Bruker Modal.open slik at close-semantikk + backdrop matcher resten av
 * admin-UI-et. Submit-knappen er disabled når amount er tom/ikke-positiv.
 */
function openAddMoneyModal(row: AdminHall, onChange: () => void): void {
  const form = document.createElement("form");
  form.setAttribute("data-testid", "add-money-form");
  form.noValidate = true;
  form.innerHTML = `
    <div class="form-group" data-testid="add-money-current-balance">
      <label>${escapeHtml(t("available_balance"))}:</label>
      <strong style="margin-left:8px">${formatMoney(row.cashBalance ?? 0)}</strong>
    </div>
    <div class="form-group">
      <label for="am-amount">${escapeHtml(t("enter_amount"))}</label>
      <input
        type="number"
        min="1"
        step="0.01"
        id="am-amount"
        name="amount"
        class="form-control"
        data-testid="add-money-amount"
        required
      />
    </div>
    <div class="form-group">
      <label for="am-reason">${escapeHtml(t("add_money_reason_optional"))}</label>
      <input
        type="text"
        id="am-reason"
        name="reason"
        class="form-control"
        data-testid="add-money-reason"
        maxlength="500"
      />
    </div>`;

  const amountInput = form.querySelector<HTMLInputElement>("#am-amount")!;
  const reasonInput = form.querySelector<HTMLInputElement>("#am-reason")!;

  const instance = Modal.open({
    title: t("add_money"),
    content: form,
    size: "sm",
    buttons: [
      {
        label: t("cancel"),
        variant: "default",
        action: "cancel",
      },
      {
        label: t("add"),
        variant: "success",
        action: "add",
        dismiss: false,
        onClick: async () => {
          const raw = amountInput.value.trim();
          const amount = Number(raw);
          if (!raw || !Number.isFinite(amount) || amount <= 0) {
            Toast.error(t("add_money_amount_positive"));
            return;
          }
          try {
            await addMoneyToHall(row.id, {
              amount,
              reason: reasonInput.value.trim() || undefined,
            });
            Toast.success(t("add_money_success"));
            instance.close("button");
            onChange();
          } catch (err) {
            const msg = err instanceof ApiError ? err.message : t("add_money_failed");
            Toast.error(msg);
          }
        },
      },
    ],
  });

  // Auto-focus amount-input så bingoverten kan skrive med én gang.
  requestAnimationFrame(() => amountInput.focus());
}
