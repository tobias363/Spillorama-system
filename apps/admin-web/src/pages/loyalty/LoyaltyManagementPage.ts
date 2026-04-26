// BIN-700 — /loyaltyManagement (tier-list + CRUD inngangsside).
//
// Viser tier-hierarki (bronze/silver/gold/platinum) med rank, poeng-bånd,
// benefits og aktiv-status. Inline delete (soft-delete default).

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { ApiError } from "../../api/client.js";
import {
  deleteLoyaltyTier,
  listLoyaltyTiers,
  type LoyaltyTier,
} from "../../api/admin-loyalty.js";
import { boxClose, boxOpen, contentHeader, escapeHtml, formatPoints } from "./shared.js";

export function renderLoyaltyManagementPage(container: HTMLElement): void {
  container.innerHTML = `
    ${contentHeader("loyalty_tier_list_title")}
    <section class="content">
      ${boxOpen("loyalty_tier_list_title", "primary")}
        <div class="row" style="margin-bottom:12px;">
          <div class="col-sm-6">
            <a class="btn btn-default"
               href="#/loyaltyManagement/players"
               data-testid="btn-loyalty-players">
              <i class="fa fa-users" aria-hidden="true"></i> ${escapeHtml(t("loyalty_players_link"))}
            </a>
          </div>
          <div class="col-sm-6 text-right">
            <a class="btn btn-primary"
               href="#/loyaltyManagement/new"
               data-testid="btn-add-loyalty-tier">
              <i class="fa fa-plus" aria-hidden="true"></i> ${escapeHtml(t("add_loyalty_tier"))}
            </a>
          </div>
        </div>
        <div id="loyalty-tier-table">${escapeHtml(t("loading_ellipsis"))}</div>
      ${boxClose()}
    </section>`;

  const host = container.querySelector<HTMLElement>("#loyalty-tier-table")!;
  void load(host);

  host.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement | null)?.closest<HTMLElement>(
      "[data-action='delete-tier']"
    );
    if (!btn) return;
    const id = btn.dataset.tierId;
    if (!id) return;
    if (!window.confirm(t("loyalty_tier_confirm_delete"))) return;
    void remove(host, id);
  });
}

async function load(host: HTMLElement): Promise<void> {
  try {
    const { tiers } = await listLoyaltyTiers();
    host.innerHTML = renderTable(tiers);
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
    host.innerHTML = `<div class="callout callout-danger" data-testid="loyalty-tier-load-error">${escapeHtml(msg)}</div>`;
  }
}

async function remove(host: HTMLElement, id: string): Promise<void> {
  try {
    await deleteLoyaltyTier(id);
    Toast.success(t("loyalty_tier_deleted"));
    await load(host);
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
    Toast.error(msg);
  }
}

function renderTable(tiers: LoyaltyTier[]): string {
  if (tiers.length === 0) {
    return `<p class="text-muted" data-testid="loyalty-tier-empty">${escapeHtml(t("no_data_available_in_table"))}</p>`;
  }
  const rows = tiers.map((row) => renderRow(row)).join("");
  return `
    <table class="table table-striped" data-testid="loyalty-tier-table-body">
      <thead>
        <tr>
          <th>${escapeHtml(t("loyalty_tier_rank"))}</th>
          <th>${escapeHtml(t("loyalty_tier_name"))}</th>
          <th>${escapeHtml(t("loyalty_tier_min_points"))}</th>
          <th>${escapeHtml(t("loyalty_tier_max_points"))}</th>
          <th>${escapeHtml(t("loyalty_tier_active"))}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderRow(tier: LoyaltyTier): string {
  const activeBadge = tier.active
    ? `<span class="label label-success">${escapeHtml(t("active"))}</span>`
    : `<span class="label label-default">${escapeHtml(t("inactive"))}</span>`;
  const maxPointsDisplay = tier.maxPoints === null ? "∞" : formatPoints(tier.maxPoints);
  return `
    <tr data-testid="loyalty-tier-row-${escapeHtml(tier.id)}">
      <td>${tier.rank}</td>
      <td>${escapeHtml(tier.name)}</td>
      <td>${escapeHtml(formatPoints(tier.minPoints))}</td>
      <td>${escapeHtml(maxPointsDisplay)}</td>
      <td>${activeBadge}</td>
      <td class="text-right">
        <a class="btn btn-default btn-xs"
           href="#/loyaltyManagement/edit/${encodeURIComponent(tier.id)}"
           data-testid="btn-edit-loyalty-tier-${escapeHtml(tier.id)}">
          <i class="fa fa-edit" aria-hidden="true"></i> ${escapeHtml(t("edit"))}
        </a>
        <button type="button"
                class="btn btn-danger btn-xs"
                data-action="delete-tier"
                data-tier-id="${escapeHtml(tier.id)}"
                data-testid="btn-delete-loyalty-tier-${escapeHtml(tier.id)}">
          <i class="fa fa-trash" aria-hidden="true"></i> ${escapeHtml(t("delete"))}
        </button>
      </td>
    </tr>`;
}
