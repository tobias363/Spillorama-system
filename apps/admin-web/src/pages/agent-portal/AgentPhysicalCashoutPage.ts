// Agent-portal Physical Cashout (P0 pilot-blokker).
//
// Flyt (per Agent V1.0 wireframe):
//   1. Agent velger spill-ID (fra dagens spillplan) for å se stemplede vinnere.
//   2. GET /api/agent/physical/pending lister pending (ikke-utbetalt) + rewarded
//      (allerede utbetalt) tickets i agentens hall.
//   3. "Reward All" → POST /api/agent/physical/reward-all for alle pending.
//   4. Per-ticket "Reward" → POST /api/agent/physical/:uniqueId/reward.
//
// Backend: hall-scope håndheves av agentBingo.ts.

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { Modal } from "../../components/Modal.js";
import { ApiError } from "../../api/client.js";
import {
  agentListPending,
  agentRewardAll,
  agentRewardTicket,
  type AgentPendingResponse,
} from "../../api/agent-bingo.js";
import type { PhysicalTicket, PhysicalTicketPattern } from "../../api/admin-physical-tickets.js";

interface PageState {
  gameId: string | null;
  data: AgentPendingResponse | null;
  loading: boolean;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function formatNOK(cents: number | null): string {
  if (cents === null || !Number.isFinite(cents)) return "—";
  return (cents / 100).toFixed(2);
}

function patternLabel(p: PhysicalTicketPattern | null): string {
  if (!p) return "—";
  switch (p) {
    case "row_1": return t("pattern_label_row_1");
    case "row_2": return t("pattern_label_row_2");
    case "row_3": return t("pattern_label_row_3");
    case "row_4": return t("pattern_label_row_4");
    case "full_house": return t("pattern_label_full_house");
    default: return p;
  }
}

export function mountAgentPhysicalCashout(container: HTMLElement): void {
  const state: PageState = { gameId: null, data: null, loading: false };

  container.innerHTML = `
    <section class="content-header">
      <h1>${escapeHtml(t("agent_physical_cashout_title"))}</h1>
      <ol class="breadcrumb">
        <li><a href="#/agent/dashboard"><i class="fa fa-dashboard" aria-hidden="true"></i> ${escapeHtml(t("dashboard"))}</a></li>
        <li class="active">${escapeHtml(t("agent_physical_cashout_title"))}</li>
      </ol>
    </section>
    <section class="content">
      <div class="box box-primary">
        <div class="box-header with-border">
          <h3 class="box-title">${escapeHtml(t("agent_physical_cashout_title"))}</h3>
        </div>
        <div class="box-body">
          <p>${escapeHtml(t("agent_physical_cashout_intro"))}</p>
          <form id="agent-cashout-form" class="form-inline" style="margin-bottom:12px;" novalidate>
            <div class="form-group" style="margin-right:8px;">
              <label for="agent-cashout-gameId" style="margin-right:6px;">${escapeHtml(t("agent_physical_cashout_game_id"))}</label>
              <input type="text" class="form-control" id="agent-cashout-gameId"
                placeholder="${escapeHtml(t("agent_physical_cashout_game_id_hint"))}"
                style="width:280px;" required autofocus autocomplete="off">
            </div>
            <button type="submit" class="btn btn-primary" data-action="load">
              <i class="fa fa-search" aria-hidden="true"></i> ${escapeHtml(t("agent_physical_cashout_load"))}
            </button>
          </form>
          <div id="agent-cashout-results"></div>
        </div>
      </div>
    </section>`;

  const form = container.querySelector<HTMLFormElement>("#agent-cashout-form")!;
  const gameIdInput = container.querySelector<HTMLInputElement>("#agent-cashout-gameId")!;
  const resultsHost = container.querySelector<HTMLElement>("#agent-cashout-results")!;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const gameId = gameIdInput.value.trim();
    if (!gameId) {
      Toast.error(t("agent_physical_cashout_game_id"));
      return;
    }
    state.gameId = gameId;
    await load();
  });

  async function load(): Promise<void> {
    if (!state.gameId) return;
    state.loading = true;
    resultsHost.innerHTML = `<p>${escapeHtml(t("loading_ellipsis"))}</p>`;
    try {
      state.data = await agentListPending(state.gameId);
      renderResults();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
      resultsHost.innerHTML = `<div class="alert alert-danger">${escapeHtml(msg)}</div>`;
    } finally {
      state.loading = false;
    }
  }

  function renderResults(): void {
    if (!state.data) {
      resultsHost.innerHTML = "";
      return;
    }
    const { pending, rewarded } = state.data;
    const pendingHtml = renderTicketSection(
      t("agent_physical_cashout_pending_header"),
      pending,
      "pending",
      pending.length === 0 ? t("agent_physical_cashout_empty_pending") : null,
    );
    const rewardedHtml = renderTicketSection(
      t("agent_physical_cashout_rewarded_header"),
      rewarded,
      "rewarded",
      rewarded.length === 0 ? t("agent_physical_cashout_empty_rewarded") : null,
    );
    const rewardAllBtn = pending.length > 0
      ? `<button type="button" class="btn btn-warning" data-action="reward-all">
          <i class="fa fa-trophy" aria-hidden="true"></i> ${escapeHtml(t("agent_physical_cashout_reward_all"))} (${pending.length})
        </button>`
      : "";
    resultsHost.innerHTML = `
      <div style="margin-bottom:10px;">
        ${rewardAllBtn}
      </div>
      ${pendingHtml}
      <hr>
      ${rewardedHtml}`;

    const rewardAllButton = resultsHost.querySelector<HTMLButtonElement>('[data-action="reward-all"]');
    if (rewardAllButton) {
      rewardAllButton.addEventListener("click", () => {
        void onRewardAll();
      });
    }
    resultsHost.querySelectorAll<HTMLButtonElement>('[data-action="reward-ticket"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const uniqueId = btn.getAttribute("data-unique-id");
        const amountCentsAttr = btn.getAttribute("data-default-cents");
        const defaultCents = amountCentsAttr ? Number(amountCentsAttr) : null;
        if (!uniqueId) return;
        void onRewardTicket(uniqueId, defaultCents);
      });
    });
  }

  function renderTicketSection(
    header: string,
    tickets: PhysicalTicket[],
    kind: "pending" | "rewarded",
    emptyMsg: string | null,
  ): string {
    if (emptyMsg) {
      return `<h4>${escapeHtml(header)}</h4>
        <div class="callout callout-info" style="margin:0 0 12px 0;">
          ${escapeHtml(emptyMsg)}
        </div>`;
    }
    const rows = tickets.map((tk) => {
      const statusBadge = kind === "pending"
        ? `<span class="label label-warning">${escapeHtml(t("agent_physical_cashout_status_pending"))}</span>`
        : `<span class="label label-success">${escapeHtml(t("agent_physical_cashout_status_rewarded"))}</span>`;
      const rewardBtn = kind === "pending"
        ? `<button type="button" class="btn btn-success btn-xs" data-action="reward-ticket"
             data-unique-id="${escapeHtml(tk.uniqueId)}"
             data-default-cents="${tk.wonAmountCents ?? ""}">
             <i class="fa fa-money" aria-hidden="true"></i> ${escapeHtml(t("agent_physical_cashout_reward"))}
           </button>`
        : "";
      return `<tr>
        <td><code>${escapeHtml(tk.uniqueId)}</code></td>
        <td>${escapeHtml(patternLabel(tk.patternWon))}</td>
        <td class="text-right">${formatNOK(tk.wonAmountCents)}</td>
        <td>${statusBadge}</td>
        <td>${rewardBtn}</td>
      </tr>`;
    }).join("");
    return `<h4>${escapeHtml(header)}</h4>
      <table class="table table-condensed table-bordered" style="margin-bottom:12px;">
        <thead>
          <tr>
            <th>${escapeHtml(t("unique_id"))}</th>
            <th>${escapeHtml(t("pattern_won"))}</th>
            <th class="text-right">${escapeHtml(t("agent_physical_cashout_amount_column"))} (kr)</th>
            <th>${escapeHtml(t("agent_physical_cashout_status_column"))}</th>
            <th>${escapeHtml(t("action"))}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  async function onRewardAll(): Promise<void> {
    if (!state.gameId || !state.data) return;
    const pending = state.data.pending;
    if (pending.length === 0) {
      Toast.info(t("no_pending_winners"));
      return;
    }
    const wrap = document.createElement("div");
    const rowsHtml = pending.map((tk, i) => `
      <tr>
        <td><code>${escapeHtml(tk.uniqueId)}</code></td>
        <td>${escapeHtml(patternLabel(tk.patternWon))}</td>
        <td>
          <input type="number" class="form-control input-sm" data-row="${i}"
            name="amt-${escapeHtml(tk.uniqueId)}" min="0.01" step="0.01"
            value="${tk.wonAmountCents !== null && tk.wonAmountCents > 0 ? (tk.wonAmountCents / 100).toFixed(2) : ""}"
            required>
        </td>
      </tr>`).join("");
    wrap.innerHTML = `
      <p>${escapeHtml(t("reward_all_intro"))}</p>
      <table class="table table-condensed">
        <thead><tr>
          <th>${escapeHtml(t("unique_id"))}</th>
          <th>${escapeHtml(t("pattern_won"))}</th>
          <th>${escapeHtml(t("payout_amount"))} (kr)</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>`;
    Modal.open({
      title: t("agent_physical_cashout_reward_all"),
      content: wrap,
      size: "lg",
      buttons: [
        { label: t("cancel_button"), variant: "default", action: "cancel" },
        {
          label: t("confirm_reward_all"),
          variant: "success",
          action: "confirm",
          onClick: async (instance) => {
            const inputs = wrap.querySelectorAll<HTMLInputElement>("input[data-row]");
            const rewards: Array<{ uniqueId: string; amountCents: number }> = [];
            let valid = true;
            inputs.forEach((inp, i) => {
              const val = Number(inp.value);
              if (!Number.isFinite(val) || val <= 0) {
                valid = false;
                inp.classList.add("has-error");
              }
              const ticket = pending[i];
              if (ticket) {
                rewards.push({
                  uniqueId: ticket.uniqueId,
                  amountCents: Math.round(val * 100),
                });
              }
            });
            if (!valid) {
              Toast.error(t("payout_amount_must_be_positive"));
              return;
            }
            try {
              const res = await agentRewardAll({ gameId: state.gameId!, rewards });
              Toast.success(
                `${t("reward_all_complete")}: ${res.rewardedCount}/${rewards.length} (${(res.totalPayoutCents / 100).toFixed(2)} kr)`,
              );
              instance.close("programmatic");
              await load();
            } catch (err) {
              const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
              Toast.error(msg);
            }
          },
        },
      ],
    });
  }

  async function onRewardTicket(uniqueId: string, defaultCents: number | null): Promise<void> {
    if (!state.gameId) return;
    const defaultVal = defaultCents !== null && defaultCents > 0
      ? (defaultCents / 100).toFixed(2)
      : "";
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <p>${escapeHtml(t("agent_physical_cashout_reward_ticket_body"))}: <code>${escapeHtml(uniqueId)}</code></p>
      <div class="form-group">
        <label for="rt-amount">${escapeHtml(t("payout_amount"))} (kr)</label>
        <input type="number" class="form-control" id="rt-amount"
          min="0.01" step="0.01" value="${escapeHtml(defaultVal)}" required autofocus>
      </div>`;
    Modal.open({
      title: t("agent_physical_cashout_reward_ticket_title"),
      content: wrap,
      buttons: [
        { label: t("cancel_button"), variant: "default", action: "cancel" },
        {
          label: t("confirm"),
          variant: "success",
          action: "confirm",
          onClick: async (instance) => {
            const input = wrap.querySelector<HTMLInputElement>("#rt-amount");
            const val = input ? Number(input.value) : NaN;
            if (!Number.isFinite(val) || val <= 0) {
              Toast.error(t("payout_amount_must_be_positive"));
              return;
            }
            try {
              const res = await agentRewardTicket(uniqueId, {
                gameId: state.gameId!,
                amountCents: Math.round(val * 100),
              });
              if (res.status === "rewarded") {
                Toast.success(t("agent_physical_cashout_reward_success"));
              } else {
                const key = `reward_status_${res.status}`;
                Toast.warning(t(key));
              }
              instance.close("programmatic");
              await load();
            } catch (err) {
              const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
              Toast.error(msg);
            }
          },
        },
      ],
    });
  }
}
