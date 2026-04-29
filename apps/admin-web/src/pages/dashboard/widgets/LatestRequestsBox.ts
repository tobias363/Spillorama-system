// Latest pending requests — legacy dashboard.html:300-395 (box-danger).
// Columns match legacy: Username / Email / Hall / Agent (admin only) / Requested Date-Time.

import { t } from "../../../i18n/I18n.js";
import type { PaymentRequest } from "../../../api/paymentRequests.js";
import type { Role } from "../../../auth/Session.js";
import { escapeHtml } from "../../../utils/escapeHtml.js";

export interface LatestRequestsOptions {
  requests: PaymentRequest[];
  role: Role;
  totalPending: number;
  onViewAll?: () => void;
}

export function renderLatestRequestsBox(opts: LatestRequestsOptions): HTMLElement {
  const box = document.createElement("div");
  box.className = "box box-danger";

  const header = document.createElement("div");
  header.className = "box-header with-border";
  header.innerHTML = `
    <h3 class="box-title">${escapeHtml(t("latest_request"))}</h3>
    <div class="box-tools pull-right">
      <span class="label label-danger" title="${escapeHtml(t("total_pending_request"))}">${opts.totalPending}</span>
    </div>`;
  box.append(header);

  const body = document.createElement("div");
  body.className = "box-body";
  const tableWrap = document.createElement("div");
  tableWrap.className = "table-responsive";
  const table = document.createElement("table");
  table.className = "table table-striped table-hover no-margin";

  const thead = document.createElement("thead");
  const headCols: string[] = [t("username"), t("emailId"), t("requested_date_and_time")];
  if (opts.role !== "agent") headCols.splice(2, 0, t("hall"), t("agent"));
  thead.innerHTML = `<tr>${headCols.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr>`;
  table.append(thead);

  const tbody = document.createElement("tbody");
  if (opts.requests.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${headCols.length}" style="text-align:center;">${escapeHtml(t("no_data_available_in_table"))}</td></tr>`;
  } else {
    for (const r of opts.requests) {
      const tr = document.createElement("tr");
      const cells: string[] = [
        r.username ?? "—",
        r.email ?? "—",
        formatDate(r.createdAt),
      ];
      if (opts.role !== "agent") cells.splice(2, 0, r.hallName ?? "—", r.agentName ?? "—");
      tr.innerHTML = cells.map((c) => `<td>${escapeHtml(c)}</td>`).join("");
      tbody.append(tr);
    }
  }
  table.append(tbody);
  tableWrap.append(table);
  body.append(tableWrap);
  box.append(body);

  const footer = document.createElement("div");
  footer.className = "box-footer text-center";
  const a = document.createElement("a");
  a.href = "#/pendingRequests";
  a.className = "uppercase";
  a.textContent = t("view_all_pending_request");
  if (opts.onViewAll) {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      opts.onViewAll!();
    });
  }
  footer.append(a);
  box.append(footer);

  return box;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const pad = (n: number): string => String(n).padStart(2, "0");
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return iso;
  }
}
