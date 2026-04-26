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
//
// PR-W5 wallet-split: "Ny wallet-correction"-knapp + modal-form for manuell
// kredit (default deposit-siden; winnings er disabled + tooltip med
// regulatorisk forbud per §11 pengespillforskriften).

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { Modal } from "../../components/Modal.js";
import { DataTable } from "../../components/DataTable.js";
import { ApiError } from "../../api/client.js";
import {
  getWallet,
  type WalletDetail,
  type WalletTransaction,
} from "../../api/admin-wallets.js";
import { submitWalletCorrection } from "../../api/admin-wallet-corrections.js";
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
      <div class="wallet-actions" style="margin-top:12px;display:flex;gap:8px;">
        <a href="#/wallet" class="btn btn-default">
          <i class="fa fa-arrow-left" aria-hidden="true"></i> ${escapeHtml(t("back_to_wallets"))}
        </a>
        <button
          type="button"
          class="btn btn-primary"
          data-testid="wallet-correction-open"
          id="wallet-correction-btn">
          <i class="fa fa-plus" aria-hidden="true"></i> ${escapeHtml(t("wallet_correction_new"))}
        </button>
      </div>
    </section>`;

  const detailHost = container.querySelector<HTMLElement>("#wallet-detail")!;
  const txHost = container.querySelector<HTMLElement>("#tx-table")!;
  const correctionBtn = container.querySelector<HTMLButtonElement>(
    "#wallet-correction-btn"
  )!;

  if (!walletId) {
    detailHost.innerHTML = `<div class="callout callout-danger">${escapeHtml(t("something_went_wrong"))}</div>`;
    txHost.innerHTML = "";
    correctionBtn.disabled = true;
    return;
  }

  // PR-W5: load-funksjon gjenbrukes etter vellykket correction for refresh.
  async function refresh(): Promise<void> {
    try {
      const detail: WalletDetail = await getWallet(walletId!);
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
  }

  // PR-W5: åpne modal-form for manuell kredit-korreksjon.
  correctionBtn.addEventListener("click", () => {
    openCorrectionModal(walletId, () => {
      void refresh();
    });
  });

  void refresh();
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

/**
 * PR-W5 wallet-split: åpne modal-form for manuell wallet-correction.
 *
 * Regulatorisk design:
 *   - Side-dropdown har `deposit` som default + `winnings`-option disabled.
 *   - Disabled-option viser tooltip med forklaring ("§11 pengespillforskriften").
 *   - Hvis en angriper fjerner `disabled` i DOM og submitter winnings, får
 *     de 403 `ADMIN_WINNINGS_CREDIT_FORBIDDEN` fra server (se adminWallet.ts).
 *   - Begrunnelse er påkrevd (lagres i audit-log via server).
 *
 * @param walletId Wallet-ID som skal krediteres.
 * @param onDone Callback etter vellykket submit — brukes for å refreshe view.
 */
function openCorrectionModal(walletId: string, onDone: () => void): void {
  const form = document.createElement("form");
  form.className = "form-horizontal";
  form.setAttribute("data-testid", "wallet-correction-form");
  form.innerHTML = `
    <div class="form-group" data-field="amount">
      <label class="col-sm-4 control-label" for="wc-amount">${escapeHtml(t("wallet_correction_amount_label"))}</label>
      <div class="col-sm-8">
        <input
          type="number"
          id="wc-amount"
          name="amount"
          class="form-control"
          min="0"
          step="0.01"
          required
          data-testid="wallet-correction-amount"
          placeholder="${escapeHtml(t("wallet_correction_amount_placeholder"))}">
      </div>
    </div>
    <div class="form-group" data-field="side">
      <label class="col-sm-4 control-label" for="wc-side">${escapeHtml(t("wallet_correction_side_label"))}</label>
      <div class="col-sm-8">
        <select
          id="wc-side"
          name="to"
          class="form-control"
          data-testid="wallet-correction-side">
          <option value="deposit" selected>${escapeHtml(t("wallet_correction_side_deposit"))}</option>
          <option
            value="winnings"
            disabled
            data-testid="wallet-correction-side-winnings-disabled"
            title="${escapeHtml(t("wallet_correction_side_winnings_tooltip"))}">
            ${escapeHtml(t("wallet_correction_side_winnings"))}
          </option>
        </select>
        <p class="help-block small text-muted" data-testid="wallet-correction-side-help">
          ${escapeHtml(t("wallet_correction_side_winnings_tooltip"))}
        </p>
      </div>
    </div>
    <div class="form-group" data-field="reason">
      <label class="col-sm-4 control-label" for="wc-reason">${escapeHtml(t("wallet_correction_reason_label"))}</label>
      <div class="col-sm-8">
        <textarea
          id="wc-reason"
          name="reason"
          class="form-control"
          rows="3"
          required
          data-testid="wallet-correction-reason"
          placeholder="${escapeHtml(t("wallet_correction_reason_placeholder"))}"></textarea>
      </div>
    </div>
  `;

  const instance = Modal.open({
    title: t("wallet_correction_title"),
    content: form,
    size: "lg",
    buttons: [
      {
        label: t("wallet_correction_cancel"),
        variant: "default",
        action: "cancel",
      },
      {
        label: t("wallet_correction_submit"),
        variant: "primary",
        action: "submit",
        dismiss: false,
        onClick: async () => {
          const amountEl = form.querySelector<HTMLInputElement>("#wc-amount")!;
          const sideEl = form.querySelector<HTMLSelectElement>("#wc-side")!;
          const reasonEl = form.querySelector<HTMLTextAreaElement>("#wc-reason")!;

          // Validering — klient-side (server har identisk gate for defense-in-depth).
          const amountNum = Number.parseFloat(amountEl.value);
          if (!Number.isFinite(amountNum) || amountNum <= 0) {
            Toast.error(t("wallet_correction_amount_invalid"));
            amountEl.focus();
            return;
          }
          const reason = reasonEl.value.trim();
          if (!reason) {
            Toast.error(t("wallet_correction_reason_required"));
            reasonEl.focus();
            return;
          }
          // Beskyttelse mot DOM-manipulasjon: selv om klient-UI disabler
          // winnings-option, validér en gang til før submit.
          const sideValue = sideEl.value;
          if (sideValue !== "deposit" && sideValue !== "winnings") {
            Toast.error(t("something_went_wrong"));
            return;
          }

          try {
            await submitWalletCorrection(walletId, {
              amount: amountNum,
              reason,
              to: sideValue as "deposit" | "winnings",
              // Idempotency-key: wallet-id + tidsstempel + beløp —
              // retry innen samme sekund blir dedupert av server.
              idempotencyKey: `admin-correction:${walletId}:${Date.now()}:${amountNum}`,
            });
            Toast.success(t("wallet_correction_success"));
            instance.close("button");
            onDone();
          } catch (err) {
            if (err instanceof ApiError) {
              // PR-W5: 403 `ADMIN_WINNINGS_CREDIT_FORBIDDEN` → vis eksplisitt
              // regulatorisk advarsel med tydelig formulering.
              if (
                err.status === 403 &&
                err.code === "ADMIN_WINNINGS_CREDIT_FORBIDDEN"
              ) {
                Toast.error(t("wallet_correction_winnings_forbidden"));
                return;
              }
              Toast.error(err.message);
              return;
            }
            Toast.error(t("something_went_wrong"));
          }
        },
      },
    ],
  });
}
