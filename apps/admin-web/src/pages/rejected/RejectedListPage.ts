// PR-B2 / Approve-Reject-flyt: Rejected KYC list — port of
// Source: GET /api/admin/players/rejected.
//
// Columns per legacy wireframe (Admin V1.0 pdf p. 14-15):
//   Customer Number · Username · Email · Mobile · Hall ·
//   Rejected on · Rejected by · Rejection Reason · Status ·
//   Actions (View, Delete).
//
// The "Rejected by" and "Rejection Reason" come from the user's
// `complianceData` JSON object — stored by PlatformService.rejectKycAsAdmin
// as { kycRejectionReason, kycRejectedBy, kycRejectedAt }. For historic
// rejections where compliance_data is empty we fall back to "—".
//
// Delete uses the existing soft-delete endpoint (POST
// /api/admin/players/:id/soft-delete). No hard delete is provided —
// regulatorisk sporbarhet krever at vi beholder brukerrekord.
//
// i18n: "rejected_on" + "rejected_by" + "rejection_reason" +
// "delete_player" + "delete_player_confirm" — alle finnes allerede
// bortsett fra `rejected_by` og `delete_player_confirm` som legges til.

import { t } from "../../i18n/I18n.js";
import { DataTable } from "../../components/DataTable.js";
import { Modal } from "../../components/Modal.js";
import { Toast } from "../../components/Toast.js";
import { ApiError } from "../../api/client.js";
import {
  listRejected,
  softDeletePlayer,
  type PlayerSummary,
} from "../../api/admin-players.js";
import {
  boxClose,
  boxOpen,
  contentHeader,
  escapeHtml,
  formatDateTime,
  viewRejectedHash,
} from "../players/shared.js";

/** Reads `kycRejectionReason` from complianceData; "—" if missing. */
function rejectionReasonOf(p: PlayerSummary): string {
  const reason = p.complianceData?.["kycRejectionReason"];
  return typeof reason === "string" && reason.trim() ? reason : "—";
}

/** Reads `kycRejectedBy` (actor id) from complianceData; "—" if missing. */
function rejectedByOf(p: PlayerSummary): string {
  const by = p.complianceData?.["kycRejectedBy"];
  return typeof by === "string" && by.trim() ? by : "—";
}

/** Reads `kycRejectedAt` from complianceData; falls back to updatedAt. */
function rejectedAtOf(p: PlayerSummary): string {
  const at = p.complianceData?.["kycRejectedAt"];
  if (typeof at === "string" && at.trim()) return formatDateTime(at);
  return formatDateTime(p.updatedAt);
}

export function renderRejectedListPage(container: HTMLElement): void {
  container.innerHTML = `
    ${contentHeader("rejected_requests_table", t("reject_requests"))}
    <section class="content">
      ${boxOpen("rejected_requests_table", "danger")}
        <div class="box-tools pull-right" style="margin-bottom:8px;">
          <button class="btn btn-default btn-sm" id="rejected-refresh">
            <i class="fa fa-refresh" aria-hidden="true"></i> ${escapeHtml(t("refresh"))}
          </button>
        </div>
        <div id="rejected-table"><p class="text-muted">${escapeHtml(t("loading_ellipsis"))}</p></div>
      ${boxClose()}
    </section>`;

  const tableHost = container.querySelector<HTMLElement>("#rejected-table")!;
  const refreshBtn = container.querySelector<HTMLButtonElement>("#rejected-refresh")!;
  let currentRows: PlayerSummary[] = [];

  // Single event-delegation listener; we match data-action on click-target.
  // Delete-button-rows change on every reload, so attaching here (not in
  // renderRows) avoids duplicate listeners leaking after refresh.
  tableHost.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const btn = target.closest<HTMLButtonElement>('button[data-action="delete"]');
    if (!btn) return;
    const id = btn.dataset.id!;
    const player = currentRows.find((r) => r.id === id);
    if (!player) return;
    confirmDelete(player);
  });

  function confirmDelete(player: PlayerSummary): void {
    const label = player.displayName || player.email || player.id;
    Modal.open({
      title: t("delete_player"),
      content: `
        <p>${escapeHtml(t("delete_player_confirm"))}</p>
        <p><strong>${escapeHtml(t("player"))}:</strong> ${escapeHtml(label)}</p>
      `,
      backdrop: "static",
      keyboard: false,
      buttons: [
        { label: t("no_cancle"), variant: "default", action: "cancel" },
        {
          label: t("yes_delete_it"),
          variant: "danger",
          action: "confirm",
          onClick: async () => {
            try {
              await softDeletePlayer(player.id);
              Toast.success(t("player_soft_deleted"));
              await load();
            } catch (err) {
              const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
              Toast.error(msg);
              throw err;
            }
          },
        },
      ],
    });
  }

  function renderRows(rows: PlayerSummary[]): void {
    currentRows = rows;
    if (rows.length === 0) {
      tableHost.innerHTML = `<p class="text-muted">${escapeHtml(t("no_data_available_in_table"))}</p>`;
      return;
    }
    DataTable.mount<PlayerSummary>(tableHost, {
      className: "table-striped",
      columns: [
        { key: "id", title: t("customer_number"), render: (r) => escapeHtml(r.id.slice(-8)) },
        {
          key: "displayName",
          title: t("username"),
          render: (r) =>
            `<a href="${viewRejectedHash(r.id)}">${escapeHtml(r.displayName || r.email)}</a>`,
        },
        { key: "email", title: t("email_address"), render: (r) => escapeHtml(r.email) },
        { key: "phone", title: t("mobile_number"), render: (r) => escapeHtml(r.phone ?? "—") },
        { key: "hallId", title: t("hall_name"), render: (r) => escapeHtml(r.hallId ?? "—") },
        {
          key: "updatedAt",
          title: t("rejected_on"),
          render: (r) => escapeHtml(rejectedAtOf(r)),
        },
        {
          key: "complianceData",
          title: t("rejected_by"),
          render: (r) => escapeHtml(rejectedByOf(r)),
        },
        {
          key: "complianceData",
          title: t("rejection_reason"),
          render: (r) => escapeHtml(rejectionReasonOf(r)),
        },
        {
          key: "kycStatus",
          title: t("status"),
          render: () =>
            `<span class="label label-danger">${escapeHtml(t("kyc_status_rejected"))}</span>`,
        },
        {
          key: "id",
          title: t("action"),
          align: "center",
          render: (r) => `
            <a href="${viewRejectedHash(r.id)}" class="btn btn-info btn-xs btn-rounded" title="${escapeHtml(t("view_player"))}">
              <i class="fa fa-eye" aria-hidden="true"></i>
            </a>
            <button type="button" class="btn btn-danger btn-xs btn-rounded" data-action="delete" data-id="${escapeHtml(r.id)}" title="${escapeHtml(t("delete_player"))}">
              <i class="fa fa-trash" aria-hidden="true"></i>
            </button>`,
        },
      ],
      rows,
      emptyMessage: t("no_data_available_in_table"),
    });
  }

  async function load(): Promise<void> {
    tableHost.innerHTML = `<p class="text-muted">${escapeHtml(t("loading_ellipsis"))}</p>`;
    try {
      const res = await listRejected();
      renderRows(res.players);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
      tableHost.innerHTML = `<p class="text-danger">${escapeHtml(msg)}</p>`;
    }
  }

  refreshBtn.addEventListener("click", () => void load());
  void load();
}
