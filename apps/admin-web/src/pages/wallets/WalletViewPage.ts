// PR-B4 (BIN-646) — Wallet detail view.
//
// Data: GET /api/wallets/:id → { account, transactions }.
// Read-only visning + innebygd transaksjons-ledger fra backend (brukes ikke av
// legacy-viewWallet, men svært nyttig for admin). Transaksjons-tabellen viser
// type, amount, reason, createdAt — matcher PaymentLedger-skjema.
//
// hashParam("id") — wallet-ID fra hash-query.

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { DataTable } from "../../components/DataTable.js";
import { ApiError } from "../../api/client.js";
import {
  getWallet,
  type WalletDetail,
  type WalletTransaction,
} from "../../api/admin-wallets.js";
import {
  boxClose,
  boxOpen,
  contentHeader,
  escapeHtml,
  formatAmountCents,
} from "../amountwithdraw/shared.js";

function hashParam(key: string): string | null {
  const hash = window.location.hash;
  const qIdx = hash.indexOf("?");
  if (qIdx < 0) return null;
  return new URLSearchParams(hash.slice(qIdx + 1)).get(key);
}

export function renderWalletViewPage(container: HTMLElement): void {
  const walletId = hashParam("id");

  container.innerHTML = `
    ${contentHeader("view_wallet", "wallet_management")}
    <section class="content">
      ${boxOpen("view_wallet", "primary")}
        <div id="wallet-detail">${escapeHtml(t("loading_ellipsis"))}</div>
      ${boxClose()}
      ${boxOpen("wallet_transactions", "info")}
        <div id="tx-table">${escapeHtml(t("loading_ellipsis"))}</div>
      ${boxClose()}
      <div style="margin-top:12px;">
        <a href="#/wallet" class="btn btn-default">
          <i class="fa fa-arrow-left"></i> ${escapeHtml(t("back_to_wallets"))}
        </a>
      </div>
    </section>`;

  const detailHost = container.querySelector<HTMLElement>("#wallet-detail")!;
  const txHost = container.querySelector<HTMLElement>("#tx-table")!;

  if (!walletId) {
    detailHost.innerHTML = `<div class="callout callout-danger">${escapeHtml(t("something_went_wrong"))}</div>`;
    txHost.innerHTML = "";
    return;
  }

  void (async () => {
    try {
      const detail: WalletDetail = await getWallet(walletId);
      detailHost.innerHTML = renderDetail(detail);
      DataTable.mount<WalletTransaction>(txHost, {
        columns: [
          {
            key: "createdAt",
            title: t("date"),
            render: (r) => new Date(r.createdAt).toISOString().slice(0, 16).replace("T", " "),
          },
          { key: "type", title: t("type") },
          {
            key: "amount",
            title: t("amount"),
            align: "right",
            render: (r) => formatAmountCents(r.amount),
          },
          { key: "reason", title: t("rejection_reason"), render: (r) => escapeHtml(r.reason) },
        ],
        rows: detail.transactions,
        emptyMessage: t("no_data_available_in_table"),
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
      detailHost.innerHTML = `<div class="callout callout-danger">${escapeHtml(msg)}</div>`;
      txHost.innerHTML = "";
    }
  })();
}

function renderDetail(detail: WalletDetail): string {
  return `
    <dl class="dl-horizontal">
      <dt>${escapeHtml(t("transaction_id"))}</dt>
      <dd>${escapeHtml(detail.account.id)}</dd>
      <dt>${escapeHtml(t("balance"))}</dt>
      <dd><strong>${escapeHtml(formatAmountCents(detail.account.balance))} NOK</strong></dd>
      <dt>${escapeHtml(t("created_at"))}</dt>
      <dd>${escapeHtml(new Date(detail.account.createdAt).toISOString().slice(0, 10))}</dd>
    </dl>`;
}
