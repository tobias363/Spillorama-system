// PR-B4 (BIN-646) — Wallet list.
//
// Data: GET /api/wallets → WalletAccount[].
// Legacy-kolonner: customerNumber, username, email, phone, nickname,
// walletAmount, action (view-btn).
//
// Modern API eksponerer bare {id, balance, createdAt, updatedAt} — resten
// (username/email/etc.) tilhører player-domenet. Vi holder kolonnene enkle i
// denne iterasjonen. PR-B2-lenker (se spillerprofil) kan kobles på senere.
//
// Regulatorisk:
//   - Read-only, SUPPORT-rolle har view-tilgang.
//   - Fail-closed: API-error → banner + ingen "0 NOK"-default.

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { DataTable } from "../../components/DataTable.js";
import { ApiError } from "../../api/client.js";
import {
  listWallets,
  type WalletAccount,
} from "../../api/admin-wallets.js";
import {
  boxClose,
  boxOpen,
  contentHeader,
  escapeHtml,
  formatAmountCents,
} from "../amountwithdraw/shared.js";

export function renderWalletListPage(container: HTMLElement): void {
  container.innerHTML = `
    ${contentHeader("wallet_management", "wallet_management")}
    <section class="content">
      ${boxOpen("wallet_list", "primary")}
        <div id="wallet-table">${escapeHtml(t("loading_ellipsis"))}</div>
      ${boxClose()}
    </section>`;

  const tableHost = container.querySelector<HTMLElement>("#wallet-table")!;

  async function refresh(): Promise<void> {
    tableHost.textContent = t("loading_ellipsis");
    try {
      const wallets = await listWallets();
      // PR-W4 wallet-split: list viser egne kolonner for deposit og winnings.
      // `balance` (total) beholdes for kompatibilitet + sum-validering.
      DataTable.mount<WalletAccount>(tableHost, {
        columns: [
          { key: "id", title: t("transaction_id"), render: (r) => escapeHtml(r.id) },
          {
            key: "depositBalance",
            title: t("wallet_deposit_label"),
            align: "right",
            render: (r) => formatAmountCents(r.depositBalance ?? r.balance),
          },
          {
            key: "winningsBalance",
            title: t("wallet_winnings_label"),
            align: "right",
            render: (r) => formatAmountCents(r.winningsBalance ?? 0),
          },
          {
            key: "balance",
            title: t("balance"),
            align: "right",
            render: (r) => formatAmountCents(r.balance),
          },
          {
            key: "id",
            title: t("action"),
            align: "center",
            render: (r) => {
              const a = document.createElement("a");
              a.href = `#/wallet/view?id=${encodeURIComponent(r.id)}`;
              a.className = "btn btn-info btn-xs";
              a.innerHTML = `<i class="fa fa-eye" aria-hidden="true"></i> ${escapeHtml(t("view_wallet"))}`;
              return a;
            },
          },
        ],
        rows: wallets,
        emptyMessage: t("no_data_available_in_table"),
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
      tableHost.innerHTML = `<div class="callout callout-danger">${escapeHtml(msg)}</div>`;
    }
  }

  void refresh();
}
