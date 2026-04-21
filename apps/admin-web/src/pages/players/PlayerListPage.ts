// PR-B2: Player list — port of
//
// Backend: GET /api/admin/players/search requires `query`, so for the
// "all players"-view we default to empty-search UX: admin types a query
// (username/email/phone) and we call /search. Legacy used a server-side
// DataTable that fetched via /player/getPlayer; that endpoint doesn't
// exist in the new stack (flagged in PR-B2-PLAN as follow-up), so this
// port matches the UX by requiring a search term.
//
// Columns (legacy paritet): Username · E-mail · Mobile · Firstname · DOB ·
// BankID · Hall · KYC status · Action. Hall column shows hallId as label.

import { t } from "../../i18n/I18n.js";
import { DataTable } from "../../components/DataTable.js";
import { Toast } from "../../components/Toast.js";
import { ApiError } from "../../api/client.js";
import {
  searchPlayers,
  buildExportCsvUrl,
  type PlayerSummary,
} from "../../api/admin-players.js";
import {
  boxClose,
  boxOpen,
  contentHeader,
  escapeHtml,
  formatDate,
  kycBadgeHtml,
  viewPlayerHash,
} from "./shared.js";
import { openCreatePlayerModal } from "./modals/CreatePlayerModal.js";

export function renderPlayerListPage(container: HTMLElement): void {
  container.innerHTML = `
    ${contentHeader("player_table", t("players"))}
    <section class="content">
      ${boxOpen("search_player", "primary")}
        <form id="player-search-form" class="form-inline" novalidate>
          <div class="form-group">
            <label for="player-query" class="sr-only">${escapeHtml(t("search_player"))}</label>
            <input type="text" id="player-query" class="form-control"
                   placeholder="${escapeHtml(t("search_by_username_email_phone"))}"
                   minlength="2" style="min-width:280px;">
          </div>
          <div class="form-group" style="margin-left:8px;">
            <label>
              <input type="checkbox" id="player-include-deleted">
              ${escapeHtml(t("include_deleted"))}
            </label>
          </div>
          <button type="submit" class="btn btn-primary" style="margin-left:8px;">
            <i class="fa fa-search"></i> ${escapeHtml(t("search"))}
          </button>
          <a id="player-export-csv" href="${buildExportCsvUrl()}" class="btn btn-default" style="margin-left:8px;">
            <i class="fa fa-download"></i> ${escapeHtml(t("export_csv"))}
          </a>
          <button type="button" id="player-create-btn" class="btn btn-success" style="margin-left:8px;">
            <i class="fa fa-plus"></i> ${escapeHtml(t("create_player"))}
          </button>
        </form>
      ${boxClose()}
      ${boxOpen("players", "default")}
        <div id="player-list-table" style="min-height:80px;">
          <p class="text-muted">${escapeHtml(t("search_by_username_email_phone"))}</p>
        </div>
      ${boxClose()}
    </section>`;

  const form = container.querySelector<HTMLFormElement>("#player-search-form")!;
  const input = container.querySelector<HTMLInputElement>("#player-query")!;
  const includeDeletedCb = container.querySelector<HTMLInputElement>("#player-include-deleted")!;
  const tableHost = container.querySelector<HTMLElement>("#player-list-table")!;

  function renderRows(rows: PlayerSummary[]): void {
    if (rows.length === 0) {
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
            `<a href="${viewPlayerHash(r.id)}">${escapeHtml(r.displayName || r.email)}</a>`,
        },
        { key: "email", title: t("email_address"), render: (r) => escapeHtml(r.email) },
        { key: "phone", title: t("mobile_number"), render: (r) => escapeHtml(r.phone ?? "—") },
        { key: "surname", title: t("surname"), render: (r) => escapeHtml(r.surname ?? "—") },
        { key: "birthDate", title: t("date_of_birth"), render: (r) => escapeHtml(formatDate(r.birthDate)) },
        { key: "kycProviderRef", title: t("bank_id"), render: (r) => escapeHtml(r.kycProviderRef ?? "—") },
        { key: "hallId", title: t("hall_name"), render: (r) => escapeHtml(r.hallId ?? "—") },
        { key: "kycStatus", title: t("kyc_status"), render: (r) => kycBadgeHtml(r.kycStatus) },
        {
          key: "id",
          title: t("action"),
          align: "center",
          render: (r) =>
            `<a href="${viewPlayerHash(r.id)}" class="btn btn-info btn-xs btn-rounded" title="${escapeHtml(t("view_player"))}">
               <i class="fa fa-eye" aria-hidden="true"></i>
             </a>`,
        },
      ],
      rows,
      emptyMessage: t("no_data_available_in_table"),
    });
  }

  async function runSearch(query: string, includeDeleted: boolean): Promise<void> {
    tableHost.innerHTML = `<p class="text-muted">${escapeHtml(t("loading_ellipsis"))}</p>`;
    try {
      const res = await searchPlayers({ query, includeDeleted, limit: 50 });
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
    void runSearch(q, includeDeletedCb.checked);
  });

  const createBtn = container.querySelector<HTMLButtonElement>("#player-create-btn");
  createBtn?.addEventListener("click", () => {
    openCreatePlayerModal({
      onCreated: (result) => {
        // Etter vellykket create: kjør søk på det nye ID'et så den nye
        // spilleren vises i lista. Vi bruker e-post som søk (støtter
        // username/email/phone i backend-search).
        input.value = result.player.email;
        void runSearch(result.player.email, includeDeletedCb.checked);
      },
    });
  });
}
