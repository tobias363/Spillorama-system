// Main cash-in/out page — 1:1 port of
// "Game" tab from legacy is intentionally dropped (DRY — Agent A owns the
// ongoing-games widget on dashboard). See PR-B1-PLAN.md §7 Q1.

import { t } from "../../i18n/I18n.js";
import { getSession } from "../../auth/Session.js";
import { Toast } from "../../components/Toast.js";
import { Modal } from "../../components/Modal.js";
import { getDailyBalance, openDay, type DailyBalance } from "../../api/agent-shift.js";
import { ApiError } from "../../api/client.js";
import { requireSlotProvider } from "../../components/SlotProviderSwitch.js";
import { openSlotMachineModal } from "./modals/SlotMachineModal.js";
import { openSettlementModal } from "./modals/SettlementModal.js";
import { openControlDailyBalanceModal } from "./modals/ControlDailyBalanceModal.js";
import { boxClose, boxOpen, contentHeader, escapeHtml, formatNOK } from "./shared.js";

const F5_F6_F8 = new Set(["F5", "F6", "F8"]);

export function renderCashInOutPage(container: HTMLElement): void {
  const session = getSession();
  const hall = session?.hall?.[0];
  const hallName = hall?.name ?? "";

  container.innerHTML = `
    ${contentHeader("cash_in_out_management")}
    <section class="content">
      <ul class="nav nav-tabs" id="cashinout-tabs">
        <li class="active"><a href="javascript:void(0)" data-tab="default">${escapeHtml(t("cash_inout_default_tab"))}</a></li>
        <li><a href="javascript:void(0)" data-tab="agent">${escapeHtml(t("cash_inout_agent_tab"))}</a></li>
      </ul>
      <div class="tab-content" style="padding: 16px 0;">
        <div class="tab-pane active" id="tab-default">
          ${boxOpen("daily_balance", "default")}
            <div class="row">
              <div class="col-sm-6">
                <table class="table table-bordered table-striped" id="daily-balance-table">
                  <thead>
                    <tr>
                      <th>${escapeHtml(t("title_cashin"))}</th>
                      <th style="text-align:right;">${escapeHtml(t("amount"))}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td>${escapeHtml(t("total_hall_cash_balance"))}</td><td style="text-align:right;" id="v-totalHallCashBalance">—</td></tr>
                    <tr><td>${escapeHtml(t("total_cash_in"))}</td><td style="text-align:right;" id="v-totalCashIn">—</td></tr>
                    <tr><td>${escapeHtml(t("total_cash_out"))}</td><td style="text-align:right;" id="v-totalCashOut">—</td></tr>
                    <tr><td><strong>${escapeHtml(t("daily_balance"))}</strong></td><td style="text-align:right;" id="v-dailyBalance"><strong>—</strong></td></tr>
                  </tbody>
                </table>
              </div>
              <div class="col-sm-6 cashinout-actions">
                <p class="muted"><small>${escapeHtml(t("hall_name"))}: <strong>${escapeHtml(hallName)}</strong></small></p>
                <button class="btn btn-success" data-action="add-daily-balance"><i class="fa fa-plus"></i> ${escapeHtml(t("add_daily_balance"))}</button>
                <button class="btn btn-primary" data-action="refresh-balance"><i class="fa fa-refresh"></i> ${escapeHtml(t("refresh_table"))}</button>
                <button class="btn btn-success" data-action="control-daily-balance">${escapeHtml(t("control_daily_balance"))}</button>
                <hr>
                <a class="btn btn-primary" href="#/hallSpecificReport" target="_self">${escapeHtml(t("todays_sales_report"))} (F8)</a>
                <button class="btn btn-warning" data-action="settlement"><i class="fa fa-lock"></i> ${escapeHtml(t("settlement"))}</button>
              </div>
            </div>
          ${boxClose()}
        </div>

        <div class="tab-pane" id="tab-agent" style="display:none;">
          ${boxOpen("cash_in_out", "primary")}
            <div class="row cashinout-grid">
              <div class="col-sm-4"><button class="btn btn-success btn-block" data-action="slot-machine">${escapeHtml(t("slot_machine"))}</button></div>
              <div class="col-sm-4"><a class="btn btn-success btn-block" href="#/agent/unique-id/add">${escapeHtml(t("add_money"))}<br>${escapeHtml(t("unique_id"))}</a></div>
              <div class="col-sm-4"><a class="btn btn-success btn-block" href="#/agent/register-user/add">${escapeHtml(t("add_money"))}<br>${escapeHtml(t("registered_user"))} (F5)</a></div>
              <div class="col-sm-4"><a class="btn btn-success btn-block" href="#/uniqueId">${escapeHtml(t("create"))}<br>${escapeHtml(t("new_unique_id"))}</a></div>
              <div class="col-sm-4"><a class="btn btn-danger btn-block" href="#/agent/unique-id/withdraw">${escapeHtml(t("withdraw"))}<br>${escapeHtml(t("unique_id"))}</a></div>
              <div class="col-sm-4"><a class="btn btn-danger btn-block" href="#/agent/register-user/withdraw">${escapeHtml(t("withdraw"))}<br>${escapeHtml(t("registered_user"))} (F6)</a></div>
              <div class="col-sm-4"><a class="btn btn-success btn-block" href="#/agent/sellProduct">${escapeHtml(t("sell"))}<br>${escapeHtml(t("products"))}</a></div>
            </div>
          ${boxClose()}
        </div>
      </div>
    </section>`;

  wireTabs(container);
  wireActions(container);
  wireFunctionKeys(container);
  void refreshBalance(container);
}

function wireTabs(container: HTMLElement): void {
  container.querySelectorAll<HTMLAnchorElement>("#cashinout-tabs [data-tab]").forEach((a) => {
    a.addEventListener("click", () => {
      const target = a.dataset.tab!;
      container.querySelectorAll("#cashinout-tabs li").forEach((li) => li.classList.remove("active"));
      a.closest("li")?.classList.add("active");
      container.querySelectorAll<HTMLElement>(".tab-pane").forEach((p) => (p.style.display = "none"));
      const pane = container.querySelector<HTMLElement>(`#tab-${target}`);
      if (pane) {
        pane.style.display = "";
        pane.classList.add("active");
      }
    });
  });
}

function wireActions(container: HTMLElement): void {
  container.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const button = target.closest<HTMLElement>("[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    switch (action) {
      case "add-daily-balance":
        openAddDailyBalanceModal(container);
        break;
      case "refresh-balance":
        void refreshBalance(container);
        break;
      case "control-daily-balance":
        openControlDailyBalanceModal();
        break;
      case "settlement":
        openSettlementModal();
        break;
      case "slot-machine": {
        const session = getSession();
        const hall = session?.hall?.[0];
        const provider = requireSlotProvider(hall ?? null);
        if (provider) openSlotMachineModal(provider);
        break;
      }
    }
  });
}

function wireFunctionKeys(container: HTMLElement): void {
  // F5 / F6 / F8 gated on this route only (see PR-B1-PLAN.md §7 Q3).
  const handler = (e: KeyboardEvent): void => {
    if (!F5_F6_F8.has(e.key)) return;
    // Route-gate: only active when cash-inout is mounted
    if (!container.isConnected) return;
    e.preventDefault();
    switch (e.key) {
      case "F5":
        window.location.hash = "#/agent/register-user/add";
        break;
      case "F6":
        window.location.hash = "#/agent/register-user/withdraw";
        break;
      case "F8":
        window.location.hash = "#/hallSpecificReport";
        break;
    }
  };
  document.addEventListener("keydown", handler);
  // Cleanup when container is detached — route change replaces content,
  // so remove the listener next time the router re-renders. Uses MutationObserver
  // to detect removal.
  const observer = new MutationObserver(() => {
    if (!container.isConnected) {
      document.removeEventListener("keydown", handler);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

async function refreshBalance(container: HTMLElement): Promise<void> {
  try {
    const balance = await getDailyBalance();
    renderBalance(container, balance);
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
    // Silent on 404 (no open day) — show zeros
    if (err instanceof ApiError && err.status === 404) {
      renderBalance(container, {
        openingBalance: 0,
        totalCashIn: 0,
        totalCashOut: 0,
        dailyBalance: 0,
        totalHallCashBalance: 0,
        updatedAt: new Date().toISOString(),
      });
      return;
    }
    Toast.error(msg);
  }
}

function renderBalance(container: HTMLElement, b: DailyBalance): void {
  const set = (id: string, v: string): void => {
    const el = container.querySelector<HTMLElement>(`#${id}`);
    if (el) el.textContent = v;
  };
  set("v-totalHallCashBalance", formatNOK(b.totalHallCashBalance));
  set("v-totalCashIn", formatNOK(b.totalCashIn));
  set("v-totalCashOut", formatNOK(b.totalCashOut));
  const dbEl = container.querySelector<HTMLElement>("#v-dailyBalance");
  if (dbEl) dbEl.innerHTML = `<strong>${escapeHtml(formatNOK(b.dailyBalance))}</strong>`;
}

function openAddDailyBalanceModal(container: HTMLElement): void {
  const form = document.createElement("form");
  form.innerHTML = `
    <div class="form-group">
      <label for="openingBalance">${escapeHtml(t("opening_balance") || t("daily_balance"))} (kr)</label>
      <input type="number" step="0.01" min="0" class="form-control" id="openingBalance" name="openingBalance" required autofocus>
    </div>
    <div class="form-group">
      <label for="note">${escapeHtml(t("note_optional"))}</label>
      <textarea class="form-control" id="note" name="note" rows="2"></textarea>
    </div>`;

  Modal.open({
    title: t("add_daily_balance"),
    content: form,
    buttons: [
      { label: t("cancel_button"), variant: "default", action: "cancel" },
      {
        label: t("save"),
        variant: "success",
        action: "confirm",
        onClick: async () => {
          const openingBalance = Number((form.querySelector<HTMLInputElement>("#openingBalance")!).value);
          if (!Number.isFinite(openingBalance) || openingBalance < 0) {
            Toast.error(t("invalid_input") || t("something_went_wrong"));
            throw new Error("invalid");
          }
          const note = (form.querySelector<HTMLTextAreaElement>("#note")!).value || undefined;
          try {
            await openDay({ openingBalance, note });
            Toast.success(t("data_updated_successfully"));
            void refreshBalance(container);
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
