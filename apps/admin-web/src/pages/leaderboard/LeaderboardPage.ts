// BIN-668 — /leaderboard (tier list + inline delete).
//
// Backend: GET /api/admin/leaderboard/tiers → { tiers, count }.
// Tiers sortert etter (tierName, place). Inline slett (soft-delete by
// default) via DELETE /api/admin/leaderboard/tiers/:id.

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { ApiError } from "../../api/client.js";
import {
  deleteLeaderboardTier,
  listLeaderboardTiers,
  type LeaderboardTier,
} from "../../api/admin-leaderboard.js";
import { boxClose, boxOpen, contentHeader, escapeHtml } from "./shared.js";

export function renderLeaderboardPage(container: HTMLElement): void {
  container.innerHTML = `
    ${contentHeader("leaderboard_tier_list_title")}
    <section class="content">
      ${boxOpen("leaderboard_tier_list_title", "primary")}
        <div class="row" style="margin-bottom:12px;">
          <div class="col-sm-12 text-right">
            <a class="btn btn-primary"
               href="#/addLeaderboard"
               data-action="add-leaderboard-tier"
               data-testid="btn-add-leaderboard-tier">
              <i class="fa fa-plus"></i> ${escapeHtml(t("add_leaderboard_tier"))}
            </a>
          </div>
        </div>
        <div id="leaderboard-table">${escapeHtml(t("loading_ellipsis"))}</div>
      ${boxClose()}
    </section>`;

  const host = container.querySelector<HTMLElement>("#leaderboard-table")!;
  void load(host);

  host.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement | null)?.closest<HTMLElement>(
      "[data-action='delete-tier']"
    );
    if (!btn) return;
    const id = btn.dataset.tierId;
    if (!id) return;
    if (!window.confirm(t("leaderboard_tier_confirm_delete"))) return;
    void remove(host, id);
  });
}

async function load(host: HTMLElement): Promise<void> {
  try {
    const { tiers } = await listLeaderboardTiers();
    host.innerHTML = renderTable(tiers);
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
    host.innerHTML = `<div class="callout callout-danger" data-testid="leaderboard-load-error">${escapeHtml(msg)}</div>`;
  }
}

async function remove(host: HTMLElement, id: string): Promise<void> {
  try {
    await deleteLeaderboardTier(id);
    Toast.success(t("leaderboard_tier_deleted"));
    await load(host);
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
    Toast.error(msg);
  }
}

function renderTable(tiers: LeaderboardTier[]): string {
  if (tiers.length === 0) {
    return `<p class="text-muted" data-testid="leaderboard-empty">${escapeHtml(t("no_data_available_in_table"))}</p>`;
  }
  const rows = tiers.map((row) => renderRow(row)).join("");
  return `
    <table class="table table-striped" data-testid="leaderboard-table-body">
      <thead>
        <tr>
          <th>${escapeHtml(t("leaderboard_tier_name"))}</th>
          <th>${escapeHtml(t("leaderboard_place"))}</th>
          <th>${escapeHtml(t("leaderboard_points"))}</th>
          <th>${escapeHtml(t("leaderboard_prize_amount"))}</th>
          <th>${escapeHtml(t("leaderboard_prize_description"))}</th>
          <th>${escapeHtml(t("leaderboard_active"))}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderRow(tier: LeaderboardTier): string {
  const activeBadge = tier.active
    ? `<span class="label label-success">${escapeHtml(t("active"))}</span>`
    : `<span class="label label-default">${escapeHtml(t("inactive"))}</span>`;
  const prize = tier.prizeAmount === null ? "—" : formatPrize(tier.prizeAmount);
  return `
    <tr data-testid="tier-row-${escapeHtml(tier.id)}">
      <td>${escapeHtml(tier.tierName)}</td>
      <td>${tier.place}</td>
      <td>${tier.points}</td>
      <td>${escapeHtml(prize)}</td>
      <td>${escapeHtml(tier.prizeDescription || "—")}</td>
      <td>${activeBadge}</td>
      <td class="text-right">
        <a class="btn btn-default btn-xs"
           href="#/leaderboard/edit/${encodeURIComponent(tier.id)}"
           data-testid="btn-edit-tier-${escapeHtml(tier.id)}">
          <i class="fa fa-edit"></i> ${escapeHtml(t("edit"))}
        </a>
        <button type="button"
                class="btn btn-danger btn-xs"
                data-action="delete-tier"
                data-tier-id="${escapeHtml(tier.id)}"
                data-testid="btn-delete-tier-${escapeHtml(tier.id)}">
          <i class="fa fa-trash"></i> ${escapeHtml(t("delete"))}
        </button>
      </td>
    </tr>`;
}

function formatPrize(amount: number): string {
  const nf = new Intl.NumberFormat("nb-NO", {
    style: "currency",
    currency: "NOK",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  try {
    return nf.format(amount);
  } catch {
    return `${amount} NOK`;
  }
}
