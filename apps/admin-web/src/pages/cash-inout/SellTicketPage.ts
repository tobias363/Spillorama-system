// Sell-physical-ticket — port of
// legacy/unity-backend/App/Views/cash-inout/sell_ticket.html.
// Barcode scanner binds to #finalId, extracts ticket ID, POST
// /api/agent/physical/sell. URL: #/agent/sellPhysicalTickets?gameId=X

import { t } from "../../i18n/I18n.js";
import { Modal } from "../../components/Modal.js";
import { Toast } from "../../components/Toast.js";
import { attachBarcodeScanner } from "../../components/BarcodeScanner.js";
import { ApiError } from "../../api/client.js";
import {
  sellPhysicalTicket,
  cancelPhysicalSale,
  type SellPhysicalTicketRequest,
} from "../../api/agent-cash.js";
import { boxClose, boxOpen, contentHeader, escapeHtml, hashParam } from "./shared.js";
import { DataTable } from "../../components/DataTable.js";

interface PendingRow {
  id: string;
  ticketColor: string;
  initialId: number;
  finalId: number;
}

export function renderSellTicketPage(container: HTMLElement): void {
  const gameId = hashParam("gameId") ?? "";

  container.innerHTML = `
    ${contentHeader("register_sold_ticket")}
    <section class="content">
      ${boxOpen("register_sold_ticket", "primary")}
        <form id="sell-ticket-form" class="form-inline" novalidate>
          <input type="hidden" name="gameId" id="gameId" value="${escapeHtml(gameId)}">
          <div class="form-group">
            <label for="finalId">${escapeHtml(t("final_id_of_the_stack"))}:</label>
            <input type="text" class="form-control" id="finalId" name="finalId"
              placeholder="${escapeHtml(t("scan_placeholder"))}" autocomplete="off" required>
          </div>
          <button type="button" class="btn btn-default" data-action="scan">${escapeHtml(t("scan"))}</button>
          <button type="submit" class="btn btn-success">${escapeHtml(t("submit"))}</button>
        </form>
        <hr>
        <h4>${escapeHtml(t("registered_tickets"))}</h4>
        <div id="registered-table"></div>
        <div class="text-center" style="margin-top:16px;">
          <button type="button" class="btn btn-primary" data-action="purchase">${escapeHtml(t("submit"))}</button>
          <button type="button" class="btn btn-danger" data-action="cancel">${escapeHtml(t("cancel"))}</button>
        </div>
      ${boxClose()}
    </section>`;

  const tableHost = container.querySelector<HTMLElement>("#registered-table")!;
  const rows: PendingRow[] = [];

  function renderTable(): void {
    DataTable.mount<PendingRow>(tableHost, {
      columns: [
        { key: "ticketColor", title: t("ticket_type") },
        { key: "initialId", title: t("initial_id"), align: "right" },
        { key: "finalId", title: t("final_id"), align: "right" },
        {
          key: "id",
          title: t("action"),
          align: "center",
          render: (row) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "btn btn-danger btn-xs";
            btn.innerHTML = `<i class="fa fa-trash"></i>`;
            btn.setAttribute("data-remove-id", row.id);
            btn.addEventListener("click", () => {
              const idx = rows.findIndex((r) => r.id === row.id);
              if (idx >= 0) rows.splice(idx, 1);
              renderTable();
            });
            return btn;
          },
        },
      ],
      rows,
      emptyMessage: t("no_data_available_in_table"),
    });
  }
  renderTable();

  const finalInput = container.querySelector<HTMLInputElement>("#finalId")!;
  attachBarcodeScanner({
    input: finalInput,
    onScan: (ticketId) => {
      addRow(ticketId);
    },
  });

  function addRow(ticketId: number): void {
    // initialId is the prior ticket's finalId + 1 (or 1 for the first row)
    const initialId = rows.length === 0 ? ticketId : rows[rows.length - 1]!.finalId + 1;
    rows.push({
      id: `pending-${rows.length + 1}`,
      ticketColor: t("physical_ticket"),
      initialId,
      finalId: ticketId,
    });
    renderTable();
    finalInput.value = "";
    finalInput.focus();
  }

  container.querySelector<HTMLFormElement>("#sell-ticket-form")!.addEventListener("submit", (e) => {
    e.preventDefault();
    const n = Number(finalInput.value);
    if (!Number.isFinite(n) || n <= 0) {
      Toast.error(t("please_enter_final_id") || t("something_went_wrong"));
      return;
    }
    addRow(n);
  });

  container.addEventListener("click", async (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    if (action === "scan") {
      finalInput.focus();
    }
    if (action === "cancel") {
      if (rows.length === 0) {
        window.history.back();
        return;
      }
      Modal.open({
        title: t("are_you_sure"),
        content: t("are_you_sure_you_want_to_remove_all_physical_ticket"),
        buttons: [
          { label: t("cancel_button"), variant: "default", action: "cancel" },
          {
            label: t("delete_button"),
            variant: "danger",
            action: "confirm",
            onClick: () => {
              rows.length = 0;
              renderTable();
              Toast.info(t("physical_ticket_deleted_succesfully") || "Cleared");
            },
          },
        ],
      });
    }
    if (action === "purchase") {
      if (!gameId) {
        Toast.error(t("something_went_wrong"));
        return;
      }
      if (rows.length === 0) {
        Toast.warning(t("no_data_available_in_table"));
        return;
      }
      try {
        const saleIds: string[] = [];
        for (const row of rows) {
          const body: SellPhysicalTicketRequest = {
            gameId,
            finalId: row.finalId,
            initialId: row.initialId,
          };
          const res = await sellPhysicalTicket(body);
          saleIds.push(res.saleId);
        }
        Toast.success(t("data_updated_successfully"));
        rows.length = 0;
        renderTable();
        void saleIds; // kept for potential rollback
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
        Toast.error(msg);
      }
    }
  });

  // expose cancelPhysicalSale for tests/debug
  void cancelPhysicalSale;
}
