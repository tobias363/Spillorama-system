// PR-B2: Approved players list — port of
// legacy/unity-backend/App/Views/player/ApprovedPlayers/player.html.
// Filter: kycStatus=VERIFIED. Uses /api/admin/players/search with query;
// CSV-export passes kycStatus=VERIFIED.

import { t } from "../../../i18n/I18n.js";
import { DataTable } from "../../../components/DataTable.js";
import { Toast } from "../../../components/Toast.js";
import { ApiError } from "../../../api/client.js";
import {
  searchPlayers,
  buildExportCsvUrl,
  type PlayerSummary,
} from "../../../api/admin-players.js";
import {
  boxClose,
  boxOpen,
  contentHeader,
  escapeHtml,
  formatDate,
  kycBadgeHtml,
  viewApprovedHash,
} from "../shared.js";

export function renderApprovedPlayerListPage(container: HTMLElement): void {
  container.innerHTML = `
    ${contentHeader("approved_players_table", t("players"))}
    <section class="content">
      ${boxOpen("search_player", "primary")}
        <form id="approved-search-form" class="form-inline" novalidate>
          <div class="form-group">
            <label for="ap-query" class="sr-only">${escapeHtml(t("search_player"))}</label>
            <input type="text" id="ap-query" class="form-control"
                   placeholder="${escapeHtml(t("search_by_username_email_phone"))}"
                   minlength="2" style="min-width:280px;">
          </div>
          <button type="submit" class="btn btn-primary" style="margin-left:8px;">
            <i class="fa fa-search"></i> ${escapeHtml(t("search"))}
          </button>
          <a id="approved-export-csv" href="${buildExportCsvUrl({ kycStatus: "VERIFIED" })}"
             class="btn btn-default" style="margin-left:8px;">
            <i class="fa fa-download"></i> ${escapeHtml(t("export_csv"))}
          </a>
        </form>
      ${boxClose()}
      ${boxOpen("approved_players_table", "success")}
        <div id="approved-list-table" style="min-height:80px;">
          <p class="text-muted">${escapeHtml(t("search_by_username_email_phone"))}</p>
        </div>
      ${boxClose()}
    </section>`;

  const form = container.querySelector<HTMLFormElement>("#approved-search-form")!;
  const input = container.querySelector<HTMLInputElement>("#ap-query")!;
  const tableHost = container.querySelector<HTMLElement>("#approved-list-table")!;

  function renderRows(rows: PlayerSummary[]): void {
    if (rows.length === 0) {
      tableHost.innerHTML = `<p class="text-muted">${escapeHtml(t("no_results_found"))}</p>`;
      return;
    }
    // Filter client-side to VERIFIED since /search doesn't accept kycStatus.
    const verified = rows.filter((r) => r.kycStatus === "VERIFIED");
    if (verified.length === 0) {
      tableHost.innerHTML = `<p class="text-muted">${escapeHtml(t("no_results_found"))}</p>`;
      return;
    }
    DataTable.mount<PlayerSummary>(tableHost, {
      className: "table-striped",
      columns: [
        {
          key: "displayName",
          title: t("username"),
          render: (r) =>
            `<a href="${viewApprovedHash(r.id)}">${escapeHtml(r.displayName || r.email)}</a>`,
        },
        { key: "email", title: t("email_address"), render: (r) => escapeHtml(r.email) },
        { key: "phone", title: t("mobile_number"), render: (r) => escapeHtml(r.phone ?? "—") },
        { key: "birthDate", title: t("date_of_birth"), render: (r) => escapeHtml(formatDate(r.birthDate)) },
        { key: "kycProviderRef", title: t("bank_id"), render: (r) => escapeHtml(r.kycProviderRef ?? "—") },
        { key: "hallId", title: t("hall_name"), render: (r) => escapeHtml(r.hallId ?? "—") },
        { key: "kycStatus", title: t("kyc_status"), render: (r) => kycBadgeHtml(r.kycStatus) },
        {
          key: "id",
          title: t("action"),
          align: "center",
          render: (r) =>
            `<a href="${viewApprovedHash(r.id)}" class="btn btn-info btn-xs btn-rounded" title="${escapeHtml(t("view_player"))}">
               <i class="fa fa-eye"></i>
             </a>`,
        },
      ],
      rows: verified,
      emptyMessage: t("no_data_available_in_table"),
    });
  }

  async function runSearch(query: string): Promise<void> {
    tableHost.innerHTML = `<p class="text-muted">${escapeHtml(t("loading_ellipsis"))}</p>`;
    try {
      const res = await searchPlayers({ query, limit: 50 });
      renderRows(res.players);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
      tableHost.innerHTML = `<p class="text-danger">${escapeHtml(msg)}</p>`;
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (q.length < 2) {
      Toast.warning(t("search_by_username_email_phone"));
      return;
    }
    void runSearch(q);
  });
}
