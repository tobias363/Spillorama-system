// BIN-700 — /loyaltyManagement/players (spillerliste med tier-badge +
// manual-adjust-inngang).
//
// Viser topp-N spillere sortert etter lifetime_points, med tier-badge og
// month_points. Klikk på rad → /loyaltyManagement/players/:userId.

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { ApiError } from "../../api/client.js";
import {
  listLoyaltyPlayers,
  listLoyaltyTiers,
  type LoyaltyPlayerState,
} from "../../api/admin-loyalty.js";
import { boxClose, boxOpen, contentHeader, escapeHtml, formatPoints } from "./shared.js";

export function renderLoyaltyPlayersPage(container: HTMLElement): void {
  container.innerHTML = `
    ${contentHeader("loyalty_players_title")}
    <section class="content">
      ${boxOpen("loyalty_players_title", "primary")}
        <div class="row" style="margin-bottom:12px;">
          <div class="col-sm-6">
            <a class="btn btn-default" href="#/loyaltyManagement">
              <i class="fa fa-arrow-left" aria-hidden="true"></i> ${escapeHtml(t("loyalty_back_to_tiers"))}
            </a>
          </div>
          <div class="col-sm-6 text-right">
            <label for="loyalty-player-tier-filter" style="margin-right:8px;">${escapeHtml(t("loyalty_filter_tier"))}</label>
            <select id="loyalty-player-tier-filter" class="form-control" style="display:inline-block; width:200px;"
                    data-testid="loyalty-player-tier-filter">
              <option value="">${escapeHtml(t("loyalty_filter_all_tiers"))}</option>
            </select>
          </div>
        </div>
        <div id="loyalty-players-table">${escapeHtml(t("loading_ellipsis"))}</div>
      ${boxClose()}
    </section>`;

  const host = container.querySelector<HTMLElement>("#loyalty-players-table")!;
  const filter = container.querySelector<HTMLSelectElement>("#loyalty-player-tier-filter")!;

  void populateFilter(filter);
  void load(host, filter.value || undefined);

  filter.addEventListener("change", () => {
    void load(host, filter.value || undefined);
  });
}

async function populateFilter(select: HTMLSelectElement): Promise<void> {
  try {
    const { tiers } = await listLoyaltyTiers();
    for (const tier of tiers) {
      const opt = document.createElement("option");
      opt.value = tier.id;
      opt.textContent = `${tier.name} (rank ${tier.rank})`;
      select.appendChild(opt);
    }
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
    Toast.error(msg);
  }
}

async function load(host: HTMLElement, tierId?: string): Promise<void> {
  host.innerHTML = escapeHtml(t("loading_ellipsis"));
  try {
    const { players, total } = await listLoyaltyPlayers({ tierId, limit: 50 });
    host.innerHTML = renderTable(players, total);
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
    host.innerHTML = `<div class="callout callout-danger" data-testid="loyalty-players-load-error">${escapeHtml(msg)}</div>`;
  }
}

function renderTable(players: LoyaltyPlayerState[], total: number): string {
  if (players.length === 0) {
    return `<p class="text-muted" data-testid="loyalty-players-empty">${escapeHtml(t("no_data_available_in_table"))}</p>`;
  }
  const rows = players.map((p) => renderRow(p)).join("");
  return `
    <p class="text-muted" data-testid="loyalty-players-total">
      ${escapeHtml(t("loyalty_players_total"))}: ${total}
    </p>
    <table class="table table-striped" data-testid="loyalty-players-table-body">
      <thead>
        <tr>
          <th>${escapeHtml(t("loyalty_player_user_id"))}</th>
          <th>${escapeHtml(t("loyalty_tier_current"))}</th>
          <th>${escapeHtml(t("loyalty_tier_locked"))}</th>
          <th>${escapeHtml(t("loyalty_lifetime_points"))}</th>
          <th>${escapeHtml(t("loyalty_month_points"))}</th>
          <th>${escapeHtml(t("loyalty_last_updated"))}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderRow(p: LoyaltyPlayerState): string {
  const tierBadge = p.currentTier
    ? `<span class="label label-primary">${escapeHtml(p.currentTier.name)} (rank ${p.currentTier.rank})</span>`
    : `<span class="label label-default">${escapeHtml(t("loyalty_no_tier"))}</span>`;
  const lockBadge = p.tierLocked
    ? `<span class="label label-warning"><i class="fa fa-lock" aria-hidden="true"></i> ${escapeHtml(t("loyalty_tier_lock_yes"))}</span>`
    : `<span class="text-muted">${escapeHtml(t("loyalty_tier_lock_no"))}</span>`;
  const lastUpdated = p.lastUpdatedAt ? new Date(p.lastUpdatedAt).toLocaleString("nb-NO") : "";
  return `
    <tr data-testid="loyalty-player-row-${escapeHtml(p.userId)}">
      <td><code>${escapeHtml(p.userId)}</code></td>
      <td>${tierBadge}</td>
      <td>${lockBadge}</td>
      <td>${escapeHtml(formatPoints(p.lifetimePoints))}</td>
      <td>${escapeHtml(formatPoints(p.monthPoints))}</td>
      <td>${escapeHtml(lastUpdated)}</td>
      <td class="text-right">
        <a class="btn btn-default btn-xs"
           href="#/loyaltyManagement/players/${encodeURIComponent(p.userId)}"
           data-testid="btn-view-loyalty-player-${escapeHtml(p.userId)}">
          <i class="fa fa-eye" aria-hidden="true"></i> ${escapeHtml(t("view"))}
        </a>
      </td>
    </tr>`;
}
