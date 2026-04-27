// Physical cashout — sub-game detail page (wireframe §17.34).
//
// Displays the per-ticket cashout grid for a single sub-game with totals and
// a "Reward All" action. URL: `#/agent/physical-cashout/sub-game/:id`.
//
// MINIMAL SCOPE (FOLLOWUP-12 first cut):
//   - 8-column table per wireframe (Physical Ticket No, Type, Price,
//     Winning Pattern, Total Winning, Rewarded, Pending, Action).
//   - Footer totals (Total Winnings + Rewarded + Pending).
//   - "Reward All" button → POST stub endpoint.
//   - Bank-icon action shows placeholder toast — full 5×5 pattern grid is
//     out of scope for this PR (see follow-up).
//
// Backend (stub, returns NOT_IMPLEMENTED — to be wired in follow-up):
//   GET  /api/agent/physical-cashout/sub-game/:subGameId
//   POST /api/agent/physical-cashout/sub-game/:subGameId/reward-all
//
// Wiring: dispatched by `apps/admin-web/src/pages/cash-inout/index.ts` via
// hash-regex `/agent/physical-cashout/sub-game/:id`. NOT yet wired (commit
// 1 lands the page; commit 2 will wire the dispatcher) so this file ships
// dormant. Wireframe: docs/architecture/WIREFRAME_CATALOG.md §17.34.

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { ApiError, apiRequest } from "../../api/client.js";
import { boxClose, boxOpen, contentHeader, escapeHtml, formatNOK } from "./shared.js";

interface CashoutTicketRow {
  uniqueId: string;
  ticketNumber: string;
  ticketType: string;
  ticketPriceCents: number;
  winningPattern: string;
  totalWinningCents: number;
  rewardedCents: number;
  pendingCents: number;
}

interface SubGameDetailResponse {
  subGameId: string;
  subGameName: string;
  tickets: CashoutTicketRow[];
}

/**
 * Extracts the `:id` segment from `#/agent/physical-cashout/sub-game/:id`.
 * Returns empty string if not on this route.
 */
function extractSubGameIdFromHash(): string {
  const hash = window.location.hash.replace(/^#/, "");
  const bare = hash.split("?")[0] ?? "";
  const match = /^\/agent\/physical-cashout\/sub-game\/([^/]+)$/.exec(bare);
  return match ? decodeURIComponent(match[1]!) : "";
}

export function renderPhysicalCashoutSubGameDetailPage(container: HTMLElement): void {
  const subGameId = extractSubGameIdFromHash();
  container.innerHTML = `
    ${contentHeader("physical_cash_out", t("sub_game_name"))}
    <section class="content">
      ${boxOpen("physical_cash_out", "default")}
        <div class="row" style="margin-bottom:12px;">
          <div class="col-sm-6">
            <strong>${escapeHtml(t("sub_game_name"))}:</strong>
            <span id="po-subgame-name">${escapeHtml(subGameId || "—")}</span>
          </div>
          <div class="col-sm-6 text-right">
            <button type="button" id="po-reward-all" class="btn btn-success">
              <i class="fa fa-money" aria-hidden="true"></i> ${escapeHtml(t("reward_all"))}
            </button>
          </div>
        </div>
        <div id="po-table-host">${escapeHtml(t("loading_ellipsis"))}</div>
        <div id="po-totals" class="row" style="margin-top:16px;border-top:1px solid #eee;padding-top:12px;">
          <div class="col-sm-4">
            <strong>${escapeHtml(t("total_winnings"))}:</strong>
            <span id="po-total">—</span> kr
          </div>
          <div class="col-sm-4">
            <strong>${escapeHtml(t("rewarded_amount"))}:</strong>
            <span id="po-rewarded">—</span> kr
          </div>
          <div class="col-sm-4">
            <strong>${escapeHtml(t("pending_amount"))}:</strong>
            <span id="po-pending">—</span> kr
          </div>
        </div>
      ${boxClose()}
    </section>`;

  const tableHost = container.querySelector<HTMLElement>("#po-table-host")!;
  const totalEl = container.querySelector<HTMLElement>("#po-total")!;
  const rewardedEl = container.querySelector<HTMLElement>("#po-rewarded")!;
  const pendingEl = container.querySelector<HTMLElement>("#po-pending")!;
  const rewardAllBtn = container.querySelector<HTMLButtonElement>("#po-reward-all")!;

  if (!subGameId) {
    tableHost.innerHTML = `<p class="text-muted">${escapeHtml(t("no_data_available_in_table"))}</p>`;
    rewardAllBtn.disabled = true;
    return;
  }

  void loadAndRender();

  rewardAllBtn.addEventListener("click", () => {
    void onRewardAll(subGameId, () => loadAndRender());
  });

  async function loadAndRender(): Promise<void> {
    try {
      const data = await fetchSubGameDetail(subGameId);
      renderTickets(tableHost, data.tickets);
      const totals = computeTotals(data.tickets);
      totalEl.textContent = formatNOK(totals.totalWinning / 100);
      rewardedEl.textContent = formatNOK(totals.rewarded / 100);
      pendingEl.textContent = formatNOK(totals.pending / 100);
      rewardAllBtn.disabled = totals.pending <= 0;
      const subGameNameEl = container.querySelector<HTMLElement>("#po-subgame-name");
      if (subGameNameEl) {
        subGameNameEl.textContent = data.subGameName || subGameId;
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Noe gikk galt.";
      // NOT_IMPLEMENTED er forventet inntil backend-stub er koblet til.
      // Vis en mild informasjons-melding i stedet for tom feil-toast.
      if (err instanceof ApiError && err.code === "NOT_IMPLEMENTED") {
        tableHost.innerHTML = `<p class="text-muted">${escapeHtml(msg)}</p>`;
        rewardAllBtn.disabled = true;
        totalEl.textContent = "0.00";
        rewardedEl.textContent = "0.00";
        pendingEl.textContent = "0.00";
        return;
      }
      Toast.error(msg);
      tableHost.innerHTML = "";
    }
  }
}

function fetchSubGameDetail(subGameId: string): Promise<SubGameDetailResponse> {
  return apiRequest<SubGameDetailResponse>(
    `/api/agent/physical-cashout/sub-game/${encodeURIComponent(subGameId)}`,
    { auth: true },
  );
}

async function onRewardAll(subGameId: string, reload: () => Promise<void>): Promise<void> {
  if (!window.confirm(t("reward_all_pending_winings"))) return;
  try {
    await apiRequest(
      `/api/agent/physical-cashout/sub-game/${encodeURIComponent(subGameId)}/reward-all`,
      { method: "POST", body: {}, auth: true },
    );
    Toast.success(t("reward_all_complete"));
    await reload();
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : "Noe gikk galt.";
    Toast.error(msg);
  }
}

interface Totals {
  totalWinning: number;
  rewarded: number;
  pending: number;
}

function computeTotals(rows: CashoutTicketRow[]): Totals {
  let totalWinning = 0;
  let rewarded = 0;
  let pending = 0;
  for (const row of rows) {
    totalWinning += row.totalWinningCents;
    rewarded += row.rewardedCents;
    pending += row.pendingCents;
  }
  return { totalWinning, rewarded, pending };
}

function renderTickets(host: HTMLElement, rows: CashoutTicketRow[]): void {
  if (rows.length === 0) {
    host.innerHTML = `<p class="text-muted">${escapeHtml(t("no_data_available_in_table"))}</p>`;
    return;
  }
  const headers = [
    t("physical_ticket_number"),
    t("ticket_type"),
    t("ticket_price"),
    t("winning_pattern"),
    t("total_winning"),
    t("rewarded_amount"),
    t("pending_amount"),
    t("action"),
  ]
    .map((h) => `<th>${escapeHtml(h)}</th>`)
    .join("");

  const body = rows
    .map(
      (r) => `
        <tr data-unique-id="${escapeHtml(r.uniqueId)}">
          <td>${escapeHtml(r.ticketNumber)}</td>
          <td>${escapeHtml(r.ticketType)}</td>
          <td class="text-right">${formatNOK(r.ticketPriceCents / 100)} kr</td>
          <td>${escapeHtml(r.winningPattern)}</td>
          <td class="text-right">${formatNOK(r.totalWinningCents / 100)} kr</td>
          <td class="text-right">${formatNOK(r.rewardedCents / 100)} kr</td>
          <td class="text-right">${formatNOK(r.pendingCents / 100)} kr</td>
          <td class="text-center">
            <button type="button" class="btn btn-default btn-sm po-pattern-btn" title="${escapeHtml(t("view_details"))}">
              <i class="fa fa-university" aria-hidden="true"></i>
            </button>
          </td>
        </tr>`,
    )
    .join("");

  host.innerHTML = `
    <div class="table-responsive">
      <table class="table table-bordered table-striped">
        <thead><tr>${headers}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;

  // Bank-ikon: minimal placeholder. Full 5×5 pattern-grid kommer i oppfølger.
  // Bruker en hardkodet streng siden i18n-key `pattern_details_coming_soon`
  // ikke er lagt inn i én commit-vindu (sweeper-konkurranse i delt worktree).
  host.querySelectorAll<HTMLButtonElement>(".po-pattern-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      Toast.info("Mønster-detaljer kommer i oppfølger.");
    });
  });
}
