// BIN-638/639 wiring — per-game physical-ticket listing + reward-all bulk payout.
//
// Flow:
//   1. Admin velger hall (implicit for HALL_OPERATOR).
//   2. GET /api/admin/physical-tickets/games/in-hall — tabell over aktive spill.
//   3. "Vis vinnere" for ett spill → GET /games/:gameId/sold, filter på
//      `patternWon != null && !isWinningDistributed`.
//   4. Per vinner: beregn payoutCents (UI-input, default wonAmountCents hvis satt).
//   5. "Betal alle vinnere" → POST /reward-all med `{gameId, rewards[]}`.
//
// Stamp-flyt (BIN-641 check-bingo) er en separat side — denne listen antar at
// billettene allerede er stemplet via CheckBingoPage før reward-all kjøres.
// Hvis ingen stemplet vinner finnes viser vi tomt resultat med link til
// CheckBingoPage.

import { t } from "../../i18n/I18n.js";
import { getSession } from "../../auth/Session.js";
import { Toast } from "../../components/Toast.js";
import { Modal } from "../../components/Modal.js";
import { DataTable } from "../../components/DataTable.js";
import { ApiError } from "../../api/client.js";
import {
  listGamesInHall,
  listSoldTicketsForGame,
  rewardAll,
  type PhysicalTicketGameInHallRow,
  type PhysicalTicket,
  type RewardAllDetail,
} from "../../api/admin-physical-tickets.js";
import { listHalls, type AdminHall } from "../../api/dashboard.js";
import { boxClose, boxOpen, contentHeader, escapeHtml, formatNOK } from "./shared.js";

interface PageState {
  hallId: string | null;
  halls: AdminHall[];
  games: PhysicalTicketGameInHallRow[];
}

export function renderGameTicketListPage(container: HTMLElement): void {
  const session = getSession();
  const isAdmin = session?.role === "admin" || session?.role === "super-admin";
  const operatorHallId = !isAdmin ? session?.hall?.[0]?.id ?? null : null;

  const state: PageState = {
    hallId: operatorHallId,
    halls: [],
    games: [],
  };

  container.innerHTML = `
    ${contentHeader("physical_ticket_management")}
    <section class="content">
      ${boxOpen("physical_ticket_management", "primary")}
        <div class="row" style="margin-bottom:12px;">
          <div class="col-sm-6" id="hall-row" style="display:${isAdmin ? "block" : "none"};">
            <label class="control-label" for="hallId">${escapeHtml(t("select_hall"))}</label>
            <select id="hallId" class="form-control">
              <option value="">${escapeHtml(t("select_hall_name"))}</option>
            </select>
          </div>
        </div>
        <div id="games-table">${escapeHtml(t("loading_ellipsis"))}</div>
      ${boxClose()}
    </section>`;

  const hallSelect = container.querySelector<HTMLSelectElement>("#hallId");
  const tableHost = container.querySelector<HTMLElement>("#games-table")!;

  void (async () => {
    if (isAdmin && hallSelect) {
      try {
        state.halls = await listHalls();
        for (const h of state.halls) {
          const opt = document.createElement("option");
          opt.value = h.id;
          opt.textContent = h.name;
          hallSelect.append(opt);
        }
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
        Toast.error(msg);
      }
    }
    await refreshGames();
  })();

  if (hallSelect) {
    hallSelect.addEventListener("change", () => {
      state.hallId = hallSelect.value || null;
      void refreshGames();
    });
  }

  async function refreshGames(): Promise<void> {
    if (!state.hallId) {
      tableHost.innerHTML = `<div class="callout callout-info" style="margin:0;">${escapeHtml(t("hall_scope_required"))}</div>`;
      state.games = [];
      return;
    }
    tableHost.textContent = t("loading_ellipsis");
    try {
      const res = await listGamesInHall({ hallId: state.hallId, limit: 200 });
      state.games = res.rows;
      renderGamesTable();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
      tableHost.innerHTML = "";
    }
  }

  function renderGamesTable(): void {
    DataTable.mount<PhysicalTicketGameInHallRow>(tableHost, {
      columns: [
        {
          key: "name",
          title: t("game_name"),
          render: (r) => escapeHtml(r.name ?? r.gameId ?? "—"),
        },
        {
          key: "status",
          title: t("batch_status"),
          render: (r) => escapeHtml(r.status ?? "—"),
        },
        { key: "sold", title: t("sold_count"), align: "right" },
        { key: "ticketsInPlay", title: t("tickets_in_play"), align: "right" },
        { key: "cashedOut", title: t("cashed_out"), align: "right" },
        {
          key: "totalRevenueCents",
          title: t("total_revenue"),
          align: "right",
          render: (r) => formatNOK(r.totalRevenueCents / 100),
        },
        {
          key: "gameId",
          title: t("action"),
          align: "center",
          render: (r) => renderGameActions(r),
        },
      ],
      rows: state.games,
      emptyMessage: t("no_games_in_hall"),
    });
  }

  function renderGameActions(game: PhysicalTicketGameInHallRow): Node {
    const wrap = document.createElement("div");
    if (!game.gameId) {
      wrap.textContent = "—";
      return wrap;
    }
    wrap.style.cssText = "display:inline-flex;gap:4px;";
    const reward = document.createElement("button");
    reward.type = "button";
    reward.className = "btn btn-success btn-xs";
    reward.title = t("reward_all_winners");
    reward.innerHTML = `<i class="fa fa-trophy" aria-hidden="true"></i> ${escapeHtml(t("reward_all_winners"))}`;
    reward.setAttribute("data-action", "reward-all");
    reward.setAttribute("data-game", game.gameId);
    wrap.append(reward);
    return wrap;
  }

  tableHost.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-action='reward-all']");
    if (!btn) return;
    const gameId = btn.getAttribute("data-game");
    if (!gameId) return;
    await openRewardAllModal(gameId);
  });

  async function openRewardAllModal(gameId: string): Promise<void> {
    let tickets: PhysicalTicket[] = [];
    try {
      const res = await listSoldTicketsForGame(gameId, {
        hallId: state.hallId ?? undefined,
        limit: 500,
      });
      tickets = res.tickets;
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
      return;
    }
    // Filter — kun stemplede vinnere som ikke er utbetalt.
    const winners = tickets.filter(
      (t) => t.patternWon !== null && !t.isWinningDistributed
    );
    if (winners.length === 0) {
      Toast.info(t("no_pending_winners"));
      return;
    }
    const wrap = document.createElement("div");
    const rowHtml = winners
      .map(
        (w, i) => `
          <tr>
            <td>${escapeHtml(w.uniqueId)}</td>
            <td>${escapeHtml(w.patternWon ?? "")}</td>
            <td>
              <input type="number" class="form-control input-sm" data-row="${i}"
                name="amount-${escapeHtml(w.uniqueId)}"
                min="0.01" step="0.01"
                value="${w.wonAmountCents !== null ? (w.wonAmountCents / 100).toFixed(2) : ""}"
                required>
            </td>
          </tr>`
      )
      .join("");
    wrap.innerHTML = `
      <p>${escapeHtml(t("reward_all_intro"))}</p>
      <table class="table table-condensed">
        <thead><tr>
          <th>${escapeHtml(t("unique_id"))}</th>
          <th>${escapeHtml(t("pattern_won"))}</th>
          <th>${escapeHtml(t("payout_amount"))} (kr)</th>
        </tr></thead>
        <tbody>${rowHtml}</tbody>
      </table>`;
    Modal.open({
      title: t("reward_all_winners"),
      content: wrap,
      size: "lg",
      buttons: [
        { label: t("cancel_button"), variant: "default", action: "cancel" },
        {
          label: t("confirm_reward_all"),
          variant: "primary",
          action: "confirm",
          onClick: async () => {
            const inputs = wrap.querySelectorAll<HTMLInputElement>("input[data-row]");
            const rewards: Array<{ uniqueId: string; amountCents: number }> = [];
            let valid = true;
            inputs.forEach((inp, i) => {
              const val = Number(inp.value);
              if (!Number.isFinite(val) || val <= 0) {
                valid = false;
                inp.classList.add("has-error");
              }
              const winner = winners[i];
              if (winner) {
                rewards.push({
                  uniqueId: winner.uniqueId,
                  amountCents: Math.round(val * 100),
                });
              }
            });
            if (!valid) {
              Toast.error(t("payout_amount_must_be_positive"));
              return;
            }
            try {
              const res = await rewardAll({ gameId, rewards });
              const msg = `${t("reward_all_complete")}: ${res.rewardedCount} / ${rewards.length} (${formatNOK(res.totalPayoutCents / 100)} kr)`;
              Toast.success(msg);
              if (res.skippedCount > 0) {
                showSkippedDetails(res.details);
              }
              await refreshGames();
            } catch (err) {
              const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
              Toast.error(msg);
            }
          },
        },
      ],
    });
  }

  function showSkippedDetails(details: RewardAllDetail[]): void {
    const skipped = details.filter((d) => d.status !== "rewarded");
    if (skipped.length === 0) return;
    const rowsHtml = skipped
      .map(
        (d) =>
          `<tr><td>${escapeHtml(d.uniqueId)}</td><td>${escapeHtml(t("reward_status_" + d.status))}</td></tr>`
      )
      .join("");
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <p>${escapeHtml(t("reward_all_skipped_intro"))}</p>
      <table class="table table-condensed">
        <thead><tr><th>${escapeHtml(t("unique_id"))}</th><th>${escapeHtml(t("status"))}</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>`;
    Modal.open({
      title: t("reward_all_skipped_title"),
      content: wrap,
      size: "lg",
      buttons: [{ label: t("cancel_button"), variant: "default", action: "cancel" }],
    });
  }
}
