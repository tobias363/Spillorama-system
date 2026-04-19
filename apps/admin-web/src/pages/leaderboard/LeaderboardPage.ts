// PR-B6 (BIN-664) — Leaderboard tier list (PLACEHOLDER).
// Port of legacy/unity-backend/App/Views/LeaderboardManagement/leaderboard.html
// as a read-only placeholder. Backend CRUD (GET/POST/PATCH/DELETE) is
// tracked as BIN-668 (P3) — see apps/admin-web/src/api/admin-leaderboard.ts.
//
// Behaviour:
//   - Tries `listLeaderboardTiers()` which immediately rejects with
//     ApiError(NOT_IMPLEMENTED, 501). The catch arm renders the
//     backend-pending banner (+ a BIN-668 link) and a disabled "Add" button.
//   - Fail-closed: if we ever *do* get a list (e.g. mock-backend during
//     dev), we render it read-only since the CRUD actions still reject.
//
// Regulatorisk:
//   - Points-config påvirker utbetaling av premier — fail-closed er
//     kritisk inntil backend støtter AuditLog-actions
//     `leaderboard.tier.add/update/remove` og "no write while game
//     active"-sjekk (PR-B6-PLAN §3.1).

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { DataTable } from "../../components/DataTable.js";
import { ApiError } from "../../api/client.js";
import {
  listLeaderboardTiers,
  type LeaderboardTier,
} from "../../api/admin-leaderboard.js";
import {
  backendPendingBanner,
  boxClose,
  boxOpen,
  contentHeader,
  escapeHtml,
} from "./shared.js";

export function renderLeaderboardPage(container: HTMLElement): void {
  container.innerHTML = `
    ${contentHeader("leaderboard_points_table")}
    <section class="content">
      ${boxOpen("leaderboard_table", "primary")}
        <div class="row" style="margin-bottom:12px;">
          <div class="col-sm-12 text-right">
            <button type="button" class="btn btn-primary disabled" aria-disabled="true"
              data-action="add-leaderboard-tier" disabled
              title="${escapeHtml(t("leaderboard_backend_pending"))}">
              <i class="fa fa-plus"></i> ${escapeHtml(t("add_leaderboard_tier"))}
            </button>
          </div>
        </div>
        <div id="leaderboard-banner"></div>
        <div id="leaderboard-table">${escapeHtml(t("loading_ellipsis"))}</div>
      ${boxClose()}
    </section>`;

  const tableHost = container.querySelector<HTMLElement>("#leaderboard-table")!;
  const bannerHost = container.querySelector<HTMLElement>("#leaderboard-banner")!;

  void refresh();

  async function refresh(): Promise<void> {
    tableHost.textContent = t("loading_ellipsis");
    try {
      const res = await listLeaderboardTiers();
      DataTable.mount<LeaderboardTier>(tableHost, {
        id: "leaderboard-datatable",
        columns: [
          {
            key: "place",
            title: t("place"),
            render: (r) => escapeHtml(String(r.place)),
          },
          {
            key: "points",
            title: t("points"),
            render: (r) => escapeHtml(String(r.points)),
          },
        ],
        rows: res.tiers,
        emptyMessage: t("no_data_available_in_table"),
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === "NOT_IMPLEMENTED") {
        // Expected path until BIN-668 ships — surface the banner, not a
        // red Toast (this isn't a transient failure, it's planned work).
        bannerHost.innerHTML = backendPendingBanner();
        tableHost.innerHTML = "";
      } else {
        const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
        Toast.error(msg);
        tableHost.innerHTML = `<div class="callout callout-danger">${escapeHtml(msg)}</div>`;
      }
    }
  }
}
