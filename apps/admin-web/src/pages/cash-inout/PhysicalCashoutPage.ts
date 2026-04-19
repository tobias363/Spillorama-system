// Physical cashout list — legacy agent-flow view for closed/cashed-out tickets
// on the current shift. Port of agent `/agent/physicalCashOut` route.

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { DataTable } from "../../components/DataTable.js";
import { ApiError } from "../../api/client.js";
import {
  getPhysicalCashouts,
  getPhysicalCashoutSummary,
  type PhysicalCashoutItem,
} from "../../api/agent-shift.js";
import { boxClose, boxOpen, contentHeader, escapeHtml, formatNOK } from "./shared.js";

export function renderPhysicalCashoutPage(container: HTMLElement): void {
  container.innerHTML = `
    ${contentHeader("physical_cash_out")}
    <section class="content">
      ${boxOpen("physical_cash_out", "default")}
        <div class="row" style="margin-bottom:12px;">
          <div class="col-sm-6">
            <strong>${escapeHtml(t("registered_ticket_count"))}:</strong> <span id="po-count">—</span>
          </div>
          <div class="col-sm-6 text-right">
            <strong>${escapeHtml(t("total_winning"))}:</strong> <span id="po-total">—</span> kr
          </div>
        </div>
        <div id="po-table">${escapeHtml(t("loading_ellipsis"))}</div>
      ${boxClose()}
    </section>`;

  const tableHost = container.querySelector<HTMLElement>("#po-table")!;
  const countEl = container.querySelector<HTMLElement>("#po-count")!;
  const totalEl = container.querySelector<HTMLElement>("#po-total")!;

  void (async () => {
    try {
      const [items, summary] = await Promise.all([
        getPhysicalCashouts(),
        getPhysicalCashoutSummary(),
      ]);
      countEl.textContent = String(summary.count);
      totalEl.textContent = formatNOK(summary.totalAmount);

      DataTable.mount<PhysicalCashoutItem>(tableHost, {
        columns: [
          {
            key: "createdAt",
            title: t("date_time"),
            render: (r) => escapeHtml(new Date(r.createdAt).toLocaleString("nb-NO")),
          },
          { key: "ticketNumber", title: t("ticket_number") },
          { key: "gameId", title: t("game_name") },
          {
            key: "amount",
            title: t("amount"),
            align: "right",
            render: (r) => `${formatNOK(r.amount)} kr`,
          },
        ],
        rows: items,
        emptyMessage: t("no_data_available_in_table"),
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
      tableHost.innerHTML = "";
    }
  })();
}
