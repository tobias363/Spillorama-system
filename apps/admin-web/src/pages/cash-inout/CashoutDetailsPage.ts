// Cashout details — port of legacy cash-inout/cashout_details.html.
// Shows a single transaction's details. URL: #/agent/cashout-details?id=X

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { ApiError } from "../../api/client.js";
import { getTransaction, type TransactionListItem } from "../../api/agent-cash.js";
import { boxClose, boxOpen, contentHeader, escapeHtml, formatNOK, hashParam } from "./shared.js";

export function renderCashoutDetailsPage(container: HTMLElement): void {
  const id = hashParam("id") ?? "";
  container.innerHTML = `
    ${contentHeader("cashout_details")}
    <section class="content">
      ${boxOpen("cashout_details", "default")}
        <div id="tx-details">${escapeHtml(t("loading_ellipsis"))}</div>
      ${boxClose()}
    </section>`;

  if (!id) {
    container.querySelector<HTMLElement>("#tx-details")!.innerHTML =
      `<p class="text-muted">${escapeHtml(t("no_data_available_in_table"))}</p>`;
    return;
  }

  void (async () => {
    try {
      const tx = await getTransaction(id);
      renderTx(container, tx);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
    }
  })();
}

function renderTx(container: HTMLElement, tx: TransactionListItem): void {
  const host = container.querySelector<HTMLElement>("#tx-details")!;
  host.innerHTML = `
    <dl class="dl-horizontal">
      <dt>${escapeHtml(t("date_time"))}</dt><dd>${escapeHtml(new Date(tx.createdAt).toLocaleString("nb-NO"))}</dd>
      <dt>${escapeHtml(t("ticket_type"))}</dt><dd>${escapeHtml(tx.type)}</dd>
      <dt>${escapeHtml(t("player_name"))}</dt><dd>${escapeHtml(tx.playerName ?? "—")}</dd>
      <dt>${escapeHtml(t("amount"))}</dt><dd>${formatNOK(tx.amount)} kr</dd>
      <dt>${escapeHtml(t("cash"))}/${escapeHtml(t("card"))}</dt><dd>${escapeHtml(tx.paymentType)}</dd>
      ${tx.note ? `<dt>${escapeHtml(t("note_optional"))}</dt><dd>${escapeHtml(tx.note)}</dd>` : ""}
    </dl>`;
}
