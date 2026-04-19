// Game-history tab — GET /api/admin/players/:id/game-history.
// Ledger-entries (STAKE/PRIZE) with optional date-range + hall filter.

import { t } from "../../../i18n/I18n.js";
import { DataTable } from "../../../components/DataTable.js";
import { Toast } from "../../../components/Toast.js";
import { ApiError } from "../../../api/client.js";
import {
  listPlayerGameHistory,
  type LedgerEntry,
} from "../../../api/admin-player-activity.js";
import { escapeHtml, formatDateTime, formatNOK } from "../shared.js";

export function mountGameHistoryTab(host: HTMLElement, userId: string): void {
  host.innerHTML = `
    <form id="gh-filter" class="form-inline" style="margin-bottom:12px;">
      <div class="form-group">
        <label for="gh-from">${escapeHtml(t("from_date"))}</label>
        <input type="date" id="gh-from" class="form-control">
      </div>
      <div class="form-group" style="margin-left:8px;">
        <label for="gh-to">${escapeHtml(t("to_date"))}</label>
        <input type="date" id="gh-to" class="form-control">
      </div>
      <button type="submit" class="btn btn-primary" style="margin-left:8px;">
        <i class="fa fa-search"></i> ${escapeHtml(t("search"))}
      </button>
    </form>
    <div id="gh-table"><p class="text-muted">${escapeHtml(t("loading_ellipsis"))}</p></div>`;

  const form = host.querySelector<HTMLFormElement>("#gh-filter")!;
  const tableHost = host.querySelector<HTMLElement>("#gh-table")!;

  async function load(): Promise<void> {
    tableHost.innerHTML = `<p class="text-muted">${escapeHtml(t("loading_ellipsis"))}</p>`;
    const from = form.querySelector<HTMLInputElement>("#gh-from")!.value || undefined;
    const to = form.querySelector<HTMLInputElement>("#gh-to")!.value || undefined;
    try {
      const res = await listPlayerGameHistory(userId, { dateFrom: from, dateTo: to });
      if (res.entries.length === 0) {
        tableHost.innerHTML = `<p class="text-muted">${escapeHtml(t("no_data_available_in_table"))}</p>`;
        return;
      }
      DataTable.mount<LedgerEntry>(tableHost, {
        className: "table-striped",
        columns: [
          {
            key: "createdAt",
            title: t("date_time"),
            render: (r) => escapeHtml(formatDateTime(r.createdAt)),
          },
          { key: "type", title: t("ledger_type"), render: (r) => escapeHtml(r.type) },
          {
            key: "gameSlug",
            title: t("game_slug"),
            render: (r) => escapeHtml(r.gameSlug ?? "—"),
          },
          { key: "hallId", title: t("hall_id"), render: (r) => escapeHtml(r.hallId ?? "—") },
          {
            key: "amount",
            title: t("amount"),
            align: "right",
            render: (r) => `${escapeHtml(formatNOK(r.amount))} kr`,
          },
        ],
        rows: res.entries,
        emptyMessage: t("no_data_available_in_table"),
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
      tableHost.innerHTML = `<p class="text-danger">${escapeHtml(msg)}</p>`;
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    void load();
  });
  void load();
}
