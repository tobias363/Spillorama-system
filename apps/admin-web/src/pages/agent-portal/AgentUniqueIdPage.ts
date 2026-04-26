// Wireframe gaps #8/#10/#11 (2026-04-24): Agent Unique ID Management page.
//
// Landing page with the four V1.0 entry-points:
//   - Create New Unique ID (17.9)
//   - Add Money (17.10)
//   - Withdraw (17.11/17.28)
//   - Details + Re-Generate (17.26)
//
// The page shows a list of the agent's recent cards (with Details link)
// and the four action-buttons above. Per-hall scope is handled by the
// backend (AGENT sees only cards they created via the scoped list-endpoint).

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { ApiError } from "../../api/client.js";
import { getSession } from "../../auth/Session.js";
import {
  listUniqueIds,
  type UniqueIdCard,
} from "../../api/agent-unique-ids.js";
import { openCreateUniqueIdModal } from "./unique-id/CreateUniqueIdModal.js";
import { openAddMoneyUniqueIdModal } from "./unique-id/AddMoneyUniqueIdModal.js";
import { openWithdrawUniqueIdModal } from "./unique-id/WithdrawUniqueIdModal.js";
import { mountUniqueIdDetailsView } from "./unique-id/UniqueIdDetailsView.js";

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

function resolveHallId(): string | null {
  const session = getSession();
  if (!session) return null;
  const first = session.hall?.[0];
  return first?.id ?? null;
}

function statusBadge(status: UniqueIdCard["status"]): string {
  const cls =
    status === "ACTIVE" ? "label-success" :
    status === "REGENERATED" ? "label-warning" :
    status === "WITHDRAWN" ? "label-default" :
    "label-danger";
  const text =
    status === "ACTIVE" ? t("agent_unique_id_status_active") :
    status === "WITHDRAWN" ? t("agent_unique_id_status_withdrawn") :
    status === "REGENERATED" ? t("agent_unique_id_status_regenerated") :
    t("agent_unique_id_status_expired");
  return `<span class="label ${cls}">${escapeHtml(text)}</span>`;
}

export function mountAgentUniqueId(container: HTMLElement): void {
  const hallId = resolveHallId();

  container.innerHTML = `
    <section class="content-header">
      <h1>${escapeHtml(t("agent_unique_id_management"))}</h1>
      <ol class="breadcrumb">
        <li><a href="#/agent/dashboard"><i class="fa fa-dashboard" aria-hidden="true"></i> ${escapeHtml(t("dashboard"))}</a></li>
        <li class="active">${escapeHtml(t("agent_unique_id_management"))}</li>
      </ol>
    </section>
    <section class="content">
      <div class="box box-primary">
        <div class="box-header with-border">
          <h3 class="box-title">${escapeHtml(t("agent_unique_id_management"))}</h3>
        </div>
        <div class="box-body">
          <div class="btn-group" role="group" style="margin-bottom:12px;">
            <button type="button" class="btn btn-primary" data-action="create" data-testid="btn-create-unique-id">
              <i class="fa fa-plus" aria-hidden="true"></i> ${escapeHtml(t("agent_unique_id_create"))}
            </button>
            <button type="button" class="btn btn-success" data-action="add-money" data-testid="btn-add-money">
              <i class="fa fa-plus-square" aria-hidden="true"></i> ${escapeHtml(t("agent_unique_id_add_money"))}
            </button>
            <button type="button" class="btn btn-warning" data-action="withdraw-modal" data-testid="btn-withdraw">
              <i class="fa fa-minus-square" aria-hidden="true"></i> ${escapeHtml(t("agent_unique_id_withdraw"))}
            </button>
          </div>
          <div id="agent-unique-id-list"></div>
          <hr>
          <div id="agent-unique-id-details"></div>
        </div>
      </div>
    </section>`;

  const listHost = container.querySelector<HTMLElement>("#agent-unique-id-list")!;
  const detailsHost = container.querySelector<HTMLElement>("#agent-unique-id-details")!;

  async function reloadList(): Promise<void> {
    listHost.innerHTML = `<p>${escapeHtml(t("loading_ellipsis"))}</p>`;
    try {
      const res = await listUniqueIds({ limit: 20 });
      if (res.count === 0) {
        listHost.innerHTML = `<p class="muted">${escapeHtml(t("agent_unique_id_no_transactions"))}</p>`;
        return;
      }
      const rows = res.cards.map((card) => `
        <tr>
          <td><code>${escapeHtml(card.id)}</code></td>
          <td>${escapeHtml(formatDateTime(card.purchaseDate))}</td>
          <td class="text-right">${formatKr(card.balanceCents)}</td>
          <td>${statusBadge(card.status)}</td>
          <td>
            <button type="button" class="btn btn-link btn-xs" data-action="details"
              data-unique-id="${escapeHtml(card.id)}" data-testid="details-link-${escapeHtml(card.id)}">
              ${escapeHtml(t("agent_unique_id_details"))}
            </button>
          </td>
        </tr>`).join("");
      listHost.innerHTML = `
        <table class="table table-condensed table-bordered" data-testid="unique-id-list">
          <thead>
            <tr>
              <th>${escapeHtml(t("agent_unique_id_card_id"))}</th>
              <th>${escapeHtml(t("agent_unique_id_purchase_date"))}</th>
              <th class="text-right">${escapeHtml(t("agent_unique_id_current_balance"))}</th>
              <th>${escapeHtml(t("agent_unique_id_status_active"))}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>`;
      listHost.querySelectorAll<HTMLButtonElement>('[data-action="details"]').forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.getAttribute("data-unique-id");
          if (id) showDetails(id);
        });
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      listHost.innerHTML = `<div class="alert alert-danger">${escapeHtml(msg)}</div>`;
    }
  }

  function showDetails(uniqueId: string): void {
    void mountUniqueIdDetailsView(detailsHost, uniqueId, {
      onRegenerated: (newId) => {
        void reloadList();
        // Re-mount details on the new card.
        showDetails(newId);
      },
    });
  }

  // Wire top-action buttons.
  container.querySelector<HTMLButtonElement>('[data-action="create"]')
    ?.addEventListener("click", () => {
      if (!hallId) {
        Toast.error(t("hall_not_assigned"));
        return;
      }
      openCreateUniqueIdModal({
        hallId,
        onSuccess: (res) => {
          void reloadList();
          showDetails(res.card.id);
        },
      });
    });

  container.querySelector<HTMLButtonElement>('[data-action="add-money"]')
    ?.addEventListener("click", () => {
      openAddMoneyUniqueIdModal({
        onSuccess: (res) => {
          void reloadList();
          showDetails(res.card.id);
        },
      });
    });

  container.querySelector<HTMLButtonElement>('[data-action="withdraw-modal"]')
    ?.addEventListener("click", () => {
      const id = window.prompt(t("please_enter_unique_id"));
      if (!id || !id.trim()) return;
      openWithdrawUniqueIdModal({
        uniqueId: id.trim(),
        onSuccess: (res) => {
          void reloadList();
          showDetails(res.card.id);
        },
      });
    });

  void reloadList();
}

/** Test-only: exported for vitest. */
export const __agentUniqueIdPageInternals = { statusBadge, formatKr };
