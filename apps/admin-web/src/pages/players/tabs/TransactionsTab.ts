// Transactions tab — GET /api/admin/players/:id/transactions.
// Also used for "Cash transaction history" tab (optionally filtered on
// cash-related types).

import { t } from "../../../i18n/I18n.js";
import { DataTable } from "../../../components/DataTable.js";
import { Toast } from "../../../components/Toast.js";
import { ApiError } from "../../../api/client.js";
import {
  listPlayerTransactions,
  type WalletTransaction,
} from "../../../api/admin-player-activity.js";
import { escapeHtml, formatDateTime, formatNOK } from "../shared.js";

const CASH_TYPES = new Set(["DEPOSIT", "WITHDRAWAL", "CASH_IN", "CASH_OUT"]);

export interface TransactionsTabOptions {
  onlyCash?: boolean;
}

export function mountTransactionsTab(
  host: HTMLElement,
  userId: string,
  opts: TransactionsTabOptions = {}
): void {
  host.innerHTML = `<p class="text-muted">${escapeHtml(t("loading_ellipsis"))}</p>`;
  void (async () => {
    try {
      const res = await listPlayerTransactions(userId);
      let rows = res.transactions;
      if (opts.onlyCash) {
        rows = rows.filter((r) => CASH_TYPES.has(r.type.toUpperCase()));
      }
      if (rows.length === 0) {
        host.innerHTML = `<p class="text-muted">${escapeHtml(t("no_data_available_in_table"))}</p>`;
        return;
      }
      DataTable.mount<WalletTransaction>(host, {
        className: "table-striped",
        columns: [
          {
            key: "createdAt",
            title: t("date_time"),
            render: (r) => escapeHtml(formatDateTime(r.createdAt)),
          },
          { key: "type", title: t("transaction_type"), render: (r) => escapeHtml(r.type) },
          {
            key: "amount",
            title: t("amount"),
            align: "right",
            render: (r) => `${escapeHtml(formatNOK(r.amount))} kr`,
          },
          {
            key: "description",
            title: t("description"),
            render: (r) => escapeHtml(r.description ?? "—"),
          },
          {
            key: "externalRef",
            title: t("external_ref"),
            render: (r) => escapeHtml(r.externalRef ?? "—"),
          },
        ],
        rows,
        emptyMessage: t("no_data_available_in_table"),
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
      host.innerHTML = `<p class="text-danger">${escapeHtml(msg)}</p>`;
    }
  })();
}
