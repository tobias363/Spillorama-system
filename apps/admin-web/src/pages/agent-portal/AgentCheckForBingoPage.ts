// Agent-portal Check-for-Bingo (P0 pilot-blokker).
//
// Flyt (per Agent V1.0 wireframe + legacy GameController.checkForWinners):
//   1. Agent skanner/taster unique-ID + gameId + 25 tall fra papir-bongen.
//   2. "GO" → POST /api/agent/bingo/check stempler billetten (første gang) og
//      returnerer hasWon + winningPattern(s) + matchedCellIndexes.
//   3. Resultat-popup viser 5×5 grid (markerte celler highlightet, vinnende
//      mønster høyere highlightet), liste med vinnende mønstre, og to
//      actions: "Reward This Ticket" + "Reward All Pending" (for hele spillet).
//
// Backend: hall-scope håndheves av agentBingo.ts (AGENT krever aktiv shift).

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { Modal } from "../../components/Modal.js";
import { ApiError } from "../../api/client.js";
import {
  agentCheckBingo,
  agentRewardTicket,
  agentRewardAll,
  agentListPending,
  type AgentCheckBingoResponse,
} from "../../api/agent-bingo.js";
import type { PhysicalTicketPattern } from "../../api/admin-physical-tickets.js";

const GRID_SIZE = 5;
const TICKET_SIZE = GRID_SIZE * GRID_SIZE;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function formatNOK(cents: number): string {
  return (cents / 100).toFixed(2);
}

function patternLabel(p: PhysicalTicketPattern): string {
  switch (p) {
    case "row_1": return t("pattern_label_row_1");
    case "row_2": return t("pattern_label_row_2");
    case "row_3": return t("pattern_label_row_3");
    case "row_4": return t("pattern_label_row_4");
    case "full_house": return t("pattern_label_full_house");
    default: return p;
  }
}

/** Renders the 5x5 grid with marked cells highlighted. */
function renderBingoGrid(numbers: number[], matchedIndexes: number[]): string {
  const matchedSet = new Set(matchedIndexes);
  const cells: string[] = [];
  for (let i = 0; i < TICKET_SIZE; i += 1) {
    const n = numbers[i];
    const isMatched = matchedSet.has(i);
    const isCenter = i === 12;
    const bg = isCenter
      ? "#f0ad4e"
      : isMatched
      ? "#5cb85c"
      : "#ffffff";
    const fg = isMatched || isCenter ? "#ffffff" : "#333333";
    const border = isMatched ? "2px solid #2e7d32" : "1px solid #ccc";
    const label = isCenter ? "★" : String(n ?? "");
    cells.push(`<div style="
      display:flex;align-items:center;justify-content:center;
      background:${bg};color:${fg};
      border:${border};border-radius:4px;
      font-weight:${isMatched ? "bold" : "normal"};
      font-size:18px;
      aspect-ratio:1/1;min-height:50px;
    " data-cell-idx="${i}">${escapeHtml(label)}</div>`);
  }
  return `<div style="
    display:grid;grid-template-columns:repeat(${GRID_SIZE},1fr);gap:4px;
    max-width:400px;margin:0 auto;
  ">${cells.join("")}</div>`;
}

export function mountAgentCheckForBingo(container: HTMLElement): void {
  container.innerHTML = `
    <section class="content-header">
      <h1>${escapeHtml(t("agent_check_bingo_title"))}</h1>
      <ol class="breadcrumb">
        <li><a href="#/agent/dashboard"><i class="fa fa-dashboard"></i> ${escapeHtml(t("dashboard"))}</a></li>
        <li class="active">${escapeHtml(t("agent_check_bingo"))}</li>
      </ol>
    </section>
    <section class="content">
      <div class="box box-primary">
        <div class="box-header with-border">
          <h3 class="box-title">${escapeHtml(t("agent_check_bingo_title"))}</h3>
        </div>
        <div class="box-body">
          <p>${escapeHtml(t("agent_check_bingo_intro"))}</p>
          <form id="agent-cb-form" class="form-horizontal" novalidate>
            <div class="form-group">
              <label class="col-sm-3 control-label" for="agent-cb-uniqueId">${escapeHtml(t("enter_ticket_number"))}</label>
              <div class="col-sm-5">
                <input type="text" class="form-control" id="agent-cb-uniqueId"
                  placeholder="${escapeHtml(t("scan_or_type_unique_id"))}"
                  required autofocus autocomplete="off">
              </div>
            </div>
            <div class="form-group">
              <label class="col-sm-3 control-label" for="agent-cb-gameId">${escapeHtml(t("enter_game_id"))}</label>
              <div class="col-sm-5">
                <input type="text" class="form-control" id="agent-cb-gameId"
                  placeholder="${escapeHtml(t("enter_game_id"))}" required autocomplete="off">
              </div>
            </div>
            <div class="form-group">
              <label class="col-sm-3 control-label">${escapeHtml(t("ticket_numbers"))} (5×5)</label>
              <div class="col-sm-9">
                <div id="agent-cb-grid" style="display:grid;grid-template-columns:repeat(5,minmax(60px,1fr));gap:4px;max-width:400px;"></div>
                <p class="help-block">${escapeHtml(t("ticket_numbers_help"))}</p>
              </div>
            </div>
            <div class="form-group">
              <div class="col-sm-offset-3 col-sm-9">
                <button type="submit" class="btn btn-primary btn-lg" data-action="check">
                  <i class="fa fa-check-circle"></i> ${escapeHtml(t("agent_check_bingo_go"))}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </section>`;

  const form = container.querySelector<HTMLFormElement>("#agent-cb-form")!;
  const uniqueIdInput = container.querySelector<HTMLInputElement>("#agent-cb-uniqueId")!;
  const gameIdInput = container.querySelector<HTMLInputElement>("#agent-cb-gameId")!;
  const gridHost = container.querySelector<HTMLElement>("#agent-cb-grid")!;

  // Pre-populate the 25-cell input grid.
  for (let i = 0; i < TICKET_SIZE; i += 1) {
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.max = "75";
    input.className = "form-control input-sm";
    input.dataset.idx = String(i);
    if (i === 12) {
      input.value = "0";
      input.placeholder = "0";
      input.readOnly = true;
      input.style.background = "#f0f0f0";
    } else {
      input.placeholder = String(i + 1);
    }
    gridHost.append(input);
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const uniqueId = uniqueIdInput.value.trim();
    if (!uniqueId) {
      Toast.error(t("scan_or_type_unique_id"));
      return;
    }
    const gameId = gameIdInput.value.trim();
    if (!gameId) {
      Toast.error(t("enter_game_id"));
      return;
    }
    const numbers: number[] = [];
    const cells = gridHost.querySelectorAll<HTMLInputElement>("input[data-idx]");
    let valid = true;
    cells.forEach((cell) => {
      const n = Number(cell.value);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 75) {
        valid = false;
        cell.classList.add("has-error");
      } else {
        cell.classList.remove("has-error");
      }
      numbers.push(n);
    });
    if (!valid || numbers.length !== TICKET_SIZE) {
      Toast.error(t("ticket_numbers_invalid"));
      return;
    }
    try {
      const res = await agentCheckBingo({ uniqueId, gameId, numbers });
      openResultModal(res, numbers, gameId);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
    }
  });

  function openResultModal(res: AgentCheckBingoResponse, numbers: number[], gameId: string): void {
    const gridHtml = renderBingoGrid(numbers, res.matchedCellIndexes);
    const statusClass = res.hasWon ? "success" : "info";
    const statusText = res.hasWon ? t("bingo_won") : t("bingo_not_won");
    const patternsHtml = res.winningPatterns.length > 0
      ? `<ul class="list-group" style="margin:10px 0;">
          ${res.winningPatterns.map((p) => {
            const isRewarded = res.isWinningDistributed && p === res.winningPattern;
            const statusBadge = isRewarded
              ? `<span class="badge" style="background:#5cb85c;">${escapeHtml(t("agent_physical_cashout_status_rewarded"))}</span>`
              : `<span class="badge" style="background:#f0ad4e;">${escapeHtml(t("agent_physical_cashout_status_pending"))}</span>`;
            return `<li class="list-group-item" style="display:flex;justify-content:space-between;align-items:center;">
              <span><i class="fa fa-trophy"></i> ${escapeHtml(patternLabel(p))}</span>
              ${statusBadge}
            </li>`;
          }).join("")}
        </ul>`
      : `<p class="text-muted" style="margin:10px 0;"><em>${escapeHtml(t("agent_check_bingo_no_winning_pattern"))}</em></p>`;

    const alreadyRewardedBanner = res.isWinningDistributed
      ? `<div class="alert alert-warning" style="margin-top:10px;">
          <strong>${escapeHtml(t("agent_check_bingo_already_rewarded"))}</strong>
          ${res.wonAmountCents !== null ? ` — ${formatNOK(res.wonAmountCents)} kr` : ""}
        </div>`
      : "";

    const content = document.createElement("div");
    content.innerHTML = `
      <div class="alert alert-${statusClass}" style="margin-top:0;">
        <strong>${escapeHtml(statusText)}</strong>
        ${res.alreadyEvaluated ? `<div><small><em>${escapeHtml(t("already_evaluated"))}</em></small></div>` : ""}
      </div>
      ${gridHtml}
      <div style="margin-top:16px;">
        <h4>${escapeHtml(t("agent_check_bingo_winning_patterns"))}</h4>
        ${patternsHtml}
      </div>
      <div style="margin-top:10px;">
        <h5>${escapeHtml(t("agent_check_bingo_ticket_info"))}</h5>
        <table class="table table-condensed table-bordered">
          <tbody>
            <tr><th>${escapeHtml(t("unique_id"))}</th><td><code>${escapeHtml(res.uniqueId)}</code></td></tr>
            <tr><th>${escapeHtml(t("game_id"))}</th><td><code>${escapeHtml(res.gameId)}</code></td></tr>
            <tr><th>${escapeHtml(t("game_status"))}</th><td>${escapeHtml(res.gameStatus)}</td></tr>
            <tr><th>${escapeHtml(t("drawn_numbers_count"))}</th><td>${res.drawnNumbersCount}</td></tr>
          </tbody>
        </table>
      </div>
      ${alreadyRewardedBanner}`;

    const buttons: Parameters<typeof Modal.open>[0]["buttons"] = [
      { label: t("close"), variant: "default", action: "cancel" },
    ];

    // Only offer reward actions if the ticket actually won and isn't paid out yet.
    if (res.payoutEligible) {
      buttons.push({
        label: t("agent_check_bingo_reward_this"),
        variant: "success",
        action: "reward-this",
        onClick: async (instance) => {
          const amount = await promptAmount(res.wonAmountCents);
          if (amount === null) return;
          try {
            const r = await agentRewardTicket(res.uniqueId, { gameId, amountCents: amount });
            if (r.status === "rewarded") {
              Toast.success(t("agent_physical_cashout_reward_success"));
            } else {
              Toast.warning(t("reward_status_" + r.status));
            }
            instance.close("programmatic");
          } catch (err) {
            const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
            Toast.error(msg);
          }
        },
      });
      buttons.push({
        label: t("agent_check_bingo_reward_all"),
        variant: "warning",
        action: "reward-all",
        onClick: async (instance) => {
          try {
            const pendingList = await agentListPending(gameId);
            if (pendingList.pending.length === 0) {
              Toast.info(t("no_pending_winners"));
              return;
            }
            const confirmed = await confirmRewardAll(pendingList.pending.length);
            if (!confirmed) return;
            const rewards = pendingList.pending.map((p) => ({
              uniqueId: p.uniqueId,
              amountCents: p.wonAmountCents ?? 0,
            })).filter((r) => r.amountCents > 0);
            if (rewards.length === 0) {
              Toast.error(t("payout_amount_must_be_positive"));
              return;
            }
            const out = await agentRewardAll({ gameId, rewards });
            Toast.success(
              `${t("reward_all_complete")}: ${out.rewardedCount}/${rewards.length} (${formatNOK(out.totalPayoutCents)} kr)`,
            );
            instance.close("programmatic");
          } catch (err) {
            const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
            Toast.error(msg);
          }
        },
      });
    }

    Modal.open({
      title: t("agent_check_bingo_result_title"),
      content,
      size: "lg",
      buttons,
    });
  }
}

async function promptAmount(defaultCents: number | null): Promise<number | null> {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    const defaultVal = defaultCents !== null && defaultCents > 0
      ? (defaultCents / 100).toFixed(2)
      : "";
    wrap.innerHTML = `
      <div class="form-group">
        <label for="prompt-amount">${escapeHtml(t("payout_amount"))} (kr)</label>
        <input type="number" class="form-control" id="prompt-amount"
          min="0.01" step="0.01" value="${escapeHtml(defaultVal)}" required autofocus>
      </div>`;
    Modal.open({
      title: t("agent_physical_cashout_reward_ticket_title"),
      content: wrap,
      size: "sm",
      buttons: [
        {
          label: t("cancel_button"),
          variant: "default",
          action: "cancel",
          onClick: () => { resolve(null); },
        },
        {
          label: t("confirm"),
          variant: "primary",
          action: "confirm",
          onClick: (instance) => {
            const input = wrap.querySelector<HTMLInputElement>("#prompt-amount");
            const val = input ? Number(input.value) : NaN;
            if (!Number.isFinite(val) || val <= 0) {
              Toast.error(t("payout_amount_must_be_positive"));
              return;
            }
            resolve(Math.round(val * 100));
            instance.close("programmatic");
          },
        },
      ],
    });
  });
}

async function confirmRewardAll(count: number): Promise<boolean> {
  return new Promise((resolve) => {
    Modal.open({
      title: t("confirm_reward_all"),
      content: `<p>${escapeHtml(t("reward_all_winners"))}: ${count}</p>
        <p class="text-warning">${escapeHtml(t("reward_all_intro"))}</p>`,
      buttons: [
        {
          label: t("cancel_button"),
          variant: "default",
          action: "cancel",
          onClick: () => { resolve(false); },
        },
        {
          label: t("confirm_reward_all"),
          variant: "success",
          action: "confirm",
          onClick: (instance) => {
            resolve(true);
            instance.close("programmatic");
          },
        },
      ],
    });
  });
}
