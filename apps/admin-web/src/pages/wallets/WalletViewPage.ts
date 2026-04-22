// PR-B4 (BIN-646) — Wallet detail view.
//
// Data: GET /api/wallets/:id → { account, transactions }.
// Read-only visning + innebygd transaksjons-ledger fra backend (brukes ikke av
// legacy-viewWallet, men svært nyttig for admin). Transaksjons-tabellen viser
// type, amount, reason, createdAt — matcher PaymentLedger-skjema.
//
// hashParam("id") — wallet-ID fra hash-query.
//
// PR-W4 wallet-split: saldo-rendering utvidet med separate linjer for
// innskudd og gevinst. Transaksjonstabellen viser split-fordeling for
// DEBIT/TRANSFER_OUT (winnings-first-split) og TRANSFER_IN/CREDIT (target-side).

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
          // PR-W4: vis split-fordeling hvis tilgjengelig. Helt tom streng hvis
          // legacy-tx uten split — ikke "0 kr" som villedende default.
          {
            key: "id",
            title: t("account_side_column"),
            render: (r) => renderSplitCell(r),
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
  // PR-W4 wallet-split: primær-visning er deposit + winnings separat.
  // `balance` (total) vises sekundært for audit. Hvis backend ikke sender
  // split-feltene (eldgamle adapter), falles tilbake til kun total.
  const { account } = detail;
  const hasSplit =
    typeof account.depositBalance === "number" &&
    typeof account.winningsBalance === "number";

  const splitHtml = hasSplit
    ? `
      <dt>${escapeHtml(t("wallet_deposit_label"))}</dt>
      <dd class="wallet-deposit" aria-label="${escapeHtml(t("wallet_deposit_aria"))}">
        <strong>${escapeHtml(formatAmountCents(account.depositBalance!))} NOK</strong>
      </dd>
      <dt>${escapeHtml(t("wallet_winnings_label"))}</dt>
      <dd class="wallet-winnings" aria-label="${escapeHtml(t("wallet_winnings_aria"))}">
        <strong>${escapeHtml(formatAmountCents(account.winningsBalance!))} NOK</strong>
      </dd>
      <dt>${escapeHtml(t("balance"))}</dt>
      <dd class="wallet-total" aria-label="${escapeHtml(t("wallet_total_aria"))}">
        <span class="text-muted">${escapeHtml(formatAmountCents(account.balance))} NOK</span>
      </dd>`
    : `
      <dt>${escapeHtml(t("balance"))}</dt>
      <dd><strong>${escapeHtml(formatAmountCents(account.balance))} NOK</strong></dd>`;

  return `
    <dl class="dl-horizontal wallet-header">
      <dt>${escapeHtml(t("transaction_id"))}</dt>
      <dd>${escapeHtml(account.id)}</dd>
      ${splitHtml}
      <dt>${escapeHtml(t("created_at"))}</dt>
      <dd>${escapeHtml(new Date(account.createdAt).toISOString().slice(0, 10))}</dd>
    </dl>`;
}

/**
 * PR-W4: rendre split-celle for transaction-tabellen. Eksempler:
 *   - DEBIT 150 kr med split (fromDeposit=100, fromWinnings=50)
 *       → "100 innskudd / 50 gevinst"
 *   - CREDIT 80 kr til winnings → "80 gevinst"
 *   - Legacy-tx uten split → "—"
 */
function renderSplitCell(tx: WalletTransaction): string {
  if (!tx.split) return "—";
  const { fromDeposit, fromWinnings } = tx.split;
  const parts: string[] = [];
  if (fromDeposit > 0) {
    parts.push(`${escapeHtml(formatAmountCents(fromDeposit))} ${escapeHtml(t("wallet_deposit_short"))}`);
  }
  if (fromWinnings > 0) {
    parts.push(`${escapeHtml(formatAmountCents(fromWinnings))} ${escapeHtml(t("wallet_winnings_short"))}`);
  }
  return parts.length === 0 ? "—" : parts.join(" / ");
}
