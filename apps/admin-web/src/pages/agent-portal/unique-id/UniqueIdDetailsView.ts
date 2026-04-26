// Wireframe gap #8 (2026-04-24): Unique ID Details view (17.26).
//
// Renders card + transaction list, a "Choose Game Type" dropdown to filter
// per-game history, Print/Reprint + Re-Generate buttons. Re-Generate has an
// inline confirmation; on success it swaps the view to the new card.

import { t } from "../../../i18n/I18n.js";
import { Modal } from "../../../components/Modal.js";
import { Toast } from "../../../components/Toast.js";
import { ApiError } from "../../../api/client.js";
import {
  getUniqueIdDetails,
  regenerateUniqueId,
  reprintUniqueId,
  type UniqueIdActionType,
  type UniqueIdCard,
  type UniqueIdDetailsResponse,
  type UniqueIdTransaction,
} from "../../../api/agent-unique-ids.js";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
function formatKr(cents: number): string {
  return (cents / 100).toFixed(2);
}
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function statusLabel(status: UniqueIdCard["status"]): string {
  switch (status) {
    case "ACTIVE": return t("agent_unique_id_status_active");
    case "WITHDRAWN": return t("agent_unique_id_status_withdrawn");
    case "REGENERATED": return t("agent_unique_id_status_regenerated");
    case "EXPIRED": return t("agent_unique_id_status_expired");
    default: return status;
  }
}

function actionLabel(action: UniqueIdActionType): string {
  switch (action) {
    case "CREATE": return t("agent_unique_id_tx_create");
    case "ADD_MONEY": return t("agent_unique_id_tx_add_money");
    case "WITHDRAW": return t("agent_unique_id_tx_withdraw");
    case "REPRINT": return t("agent_unique_id_tx_reprint");
    case "REGENERATE": return t("agent_unique_id_tx_regenerate");
    default: return action;
  }
}

/** Pure render helper — produces the HTML string for a details view. */
export function renderDetailsHtml(
  details: UniqueIdDetailsResponse,
  gameTypeFilter: string | null,
  gameTypes: string[]
): string {
  const { card, gameHistory } = details;
  const optionRows = ["", ...gameTypes].map((gt) =>
    `<option value="${escapeHtml(gt)}"${gameTypeFilter === gt || (!gameTypeFilter && gt === "") ? " selected" : ""}>${escapeHtml(gt || t("agent_unique_id_all_games"))}</option>`
  ).join("");
  const rows = gameHistory.length === 0
    ? `<tr><td colspan="5" class="text-center muted">${escapeHtml(t("agent_unique_id_no_transactions"))}</td></tr>`
    : gameHistory.map((tx: UniqueIdTransaction) => `
      <tr>
        <td>${escapeHtml(formatDateTime(tx.createdAt))}</td>
        <td>${escapeHtml(actionLabel(tx.actionType))}</td>
        <td class="text-right">${formatKr(tx.amountCents)}</td>
        <td class="text-right">${formatKr(tx.newBalance)}</td>
        <td>${escapeHtml(tx.gameType ?? "—")}</td>
      </tr>`).join("");

  const canRegenerate = card.status === "ACTIVE";
  return `
    <section class="box box-default" data-testid="unique-id-details">
      <div class="box-header with-border">
        <h3 class="box-title">${escapeHtml(t("agent_unique_id_details"))} — <code>${escapeHtml(card.id)}</code></h3>
        <div class="box-tools pull-right">
          <span class="label label-${card.status === "ACTIVE" ? "success" : "default"}" data-testid="status-badge">
            ${escapeHtml(statusLabel(card.status))}
          </span>
        </div>
      </div>
      <div class="box-body">
        <dl class="dl-horizontal">
          <dt>${escapeHtml(t("agent_unique_id_purchase_date"))}</dt>
          <dd data-testid="purchase-date">${escapeHtml(formatDateTime(card.purchaseDate))}</dd>
          <dt>${escapeHtml(t("agent_unique_id_expiry_date"))}</dt>
          <dd data-testid="expiry-date">${escapeHtml(formatDateTime(card.expiryDate))}</dd>
          <dt>${escapeHtml(t("agent_unique_id_current_balance"))}</dt>
          <dd data-testid="current-balance">${formatKr(card.balanceCents)} kr</dd>
          <dt>${escapeHtml(t("agent_unique_id_payment_type"))}</dt>
          <dd>${escapeHtml(card.paymentType)}</dd>
          <dt>${escapeHtml(t("agent_unique_id_hours_validity"))}</dt>
          <dd>${card.hoursValidity}</dd>
        </dl>
        <hr>
        <div class="form-inline" style="margin-bottom:12px;">
          <label for="uid-game-filter" style="margin-right:6px;">
            ${escapeHtml(t("agent_unique_id_choose_game_type"))}
          </label>
          <select id="uid-game-filter" class="form-control input-sm" data-testid="game-type-filter">
            ${optionRows}
          </select>
        </div>
        <table class="table table-condensed table-bordered" data-testid="details-tx-table">
          <thead>
            <tr>
              <th>${escapeHtml(t("created_at"))}</th>
              <th>${escapeHtml(t("action"))}</th>
              <th class="text-right">${escapeHtml(t("amount"))}</th>
              <th class="text-right">${escapeHtml(t("agent_unique_id_current_balance"))}</th>
              <th>${escapeHtml(t("agent_unique_id_choose_game_type"))}</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="box-footer text-right">
        <button type="button" class="btn btn-default" data-action="reprint" data-testid="btn-reprint"
          ${canRegenerate ? "" : "disabled"}>
          <i class="fa fa-print" aria-hidden="true"></i> ${escapeHtml(t("agent_unique_id_reprint"))}
          (${card.reprintedCount})
        </button>
        <button type="button" class="btn btn-warning" data-action="regenerate" data-testid="btn-regenerate"
          ${canRegenerate ? "" : "disabled"}>
          <i class="fa fa-refresh" aria-hidden="true"></i> ${escapeHtml(t("agent_unique_id_regenerate"))}
        </button>
      </div>
    </section>`;
}

export interface UniqueIdDetailsViewOpts {
  /** Distinct game types to offer in the filter dropdown. */
  gameTypes?: string[];
  /** Called when Re-Generate succeeds; the new card id is passed. */
  onRegenerated?: (newCardId: string) => void;
}

export async function mountUniqueIdDetailsView(
  container: HTMLElement,
  uniqueId: string,
  opts: UniqueIdDetailsViewOpts = {}
): Promise<void> {
  const gameTypes = opts.gameTypes ?? [];
  let gameTypeFilter: string | null = null;

  async function reload(): Promise<void> {
    container.innerHTML = `<p>${escapeHtml(t("loading_ellipsis"))}</p>`;
    try {
      const details = await getUniqueIdDetails(uniqueId, gameTypeFilter ?? undefined);
      container.innerHTML = renderDetailsHtml(details, gameTypeFilter, gameTypes);
      wireActions(details);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      container.innerHTML = `<div class="alert alert-danger">${escapeHtml(msg)}</div>`;
    }
  }

  function wireActions(details: UniqueIdDetailsResponse): void {
    const filterEl = container.querySelector<HTMLSelectElement>('[data-testid="game-type-filter"]');
    filterEl?.addEventListener("change", () => {
      gameTypeFilter = filterEl.value || null;
      void reload();
    });
    const reprintBtn = container.querySelector<HTMLButtonElement>('[data-action="reprint"]');
    reprintBtn?.addEventListener("click", () => {
      void onReprint(details.card);
    });
    const regenBtn = container.querySelector<HTMLButtonElement>('[data-action="regenerate"]');
    regenBtn?.addEventListener("click", () => {
      void onRegenerate(details.card);
    });
  }

  async function onReprint(card: UniqueIdCard): Promise<void> {
    try {
      const res = await reprintUniqueId(card.id);
      Toast.success(
        t("agent_unique_id_reprint_success", { count: String(res.card.reprintedCount) })
      );
      await reload();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
    }
  }

  async function onRegenerate(card: UniqueIdCard): Promise<void> {
    Modal.open({
      title: t("agent_unique_id_confirm_regenerate_title"),
      content: `<p>${escapeHtml(t("agent_unique_id_confirm_regenerate_body"))}</p>
                <p class="muted">${escapeHtml(t("agent_unique_id_card_id"))}: <code>${escapeHtml(card.id)}</code></p>`,
      buttons: [
        { label: t("cancel_button"), variant: "default", action: "cancel" },
        {
          label: t("agent_unique_id_regenerate"),
          variant: "warning",
          action: "confirm",
          onClick: async (instance) => {
            try {
              const res = await regenerateUniqueId(card.id);
              Toast.success(
                t("agent_unique_id_regenerate_success", {
                  newId: res.newCard.id,
                  balance: formatKr(res.newCard.balanceCents),
                })
              );
              instance.close("programmatic");
              opts.onRegenerated?.(res.newCard.id);
            } catch (err) {
              const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
              Toast.error(msg);
            }
          },
        },
      ],
    });
  }

  await reload();
}

export const __uniqueIdDetailsViewInternals = {
  renderDetailsHtml,
  statusLabel,
  actionLabel,
  formatKr,
};
