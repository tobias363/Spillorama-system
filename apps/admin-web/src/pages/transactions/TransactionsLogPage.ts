// BIN-655 — Transactions log (generisk admin-transaksjons-logg).
//
// Path: /transactions/log
//
// Data: GET /api/admin/transactions (cursor-paginert).
// Filter: dato-vindu (fra/til) + source (wallet/agent/deposit/withdraw) +
//   bruker-ID + hall-ID. Alle felter er frivillige.
//
// Mønster: samme som Rapporter-sider — client-side filter-form, server-side
// cursor-paginering via "Last flere"-knapp.

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { DataTable } from "../../components/DataTable.js";
import { ApiError } from "../../api/client.js";
import {
  listAdminTransactions,
  type AdminTransactionRow,
  type AdminTransactionSource,
  type ListAdminTransactionsParams,
} from "../../api/admin-transactions.js";
import {
  boxClose,
  boxOpen,
  contentHeader,
  escapeHtml,
  formatAmountCents,
} from "../amountwithdraw/shared.js";

interface PageState {
  rows: AdminTransactionRow[];
  nextCursor: string | null;
  lastFilter: ListAdminTransactionsParams;
}

const SOURCE_OPTIONS: Array<{ value: AdminTransactionSource; labelKey: string }> = [
  { value: "wallet", labelKey: "transactions_source_wallet" },
  { value: "agent", labelKey: "transactions_source_agent" },
  { value: "deposit_request", labelKey: "transactions_source_deposit_request" },
  { value: "withdraw_request", labelKey: "transactions_source_withdraw_request" },
];

export function renderTransactionsLogPage(container: HTMLElement): void {
  const state: PageState = { rows: [], nextCursor: null, lastFilter: {} };

  container.innerHTML = `
    ${contentHeader("transactions_log", "transactions_management")}
    <section class="content">
      ${boxOpen("transactions_log", "info")}
        <p class="text-muted">${escapeHtml(t("transactions_log_intro"))}</p>
        <form id="tx-filter" class="row" style="margin-bottom:12px;" data-testid="tx-filter-form">
          <div class="col-sm-2">
            <label for="tx-from">${escapeHtml(t("start_date"))}</label>
            <input type="date" id="tx-from" class="form-control">
          </div>
          <div class="col-sm-2">
            <label for="tx-to">${escapeHtml(t("end_date"))}</label>
            <input type="date" id="tx-to" class="form-control">
          </div>
          <div class="col-sm-2">
            <label for="tx-source">${escapeHtml(t("transactions_source"))}</label>
            <select id="tx-source" class="form-control" data-testid="tx-source">
              <option value="">${escapeHtml(t("transactions_type_all"))}</option>
              ${SOURCE_OPTIONS.map(
                (o) =>
                  `<option value="${o.value}">${escapeHtml(t(o.labelKey))}</option>`
              ).join("")}
            </select>
          </div>
          <div class="col-sm-2">
            <label for="tx-user">${escapeHtml(t("transactions_user_id"))}</label>
            <input type="text" id="tx-user" class="form-control" data-testid="tx-user">
          </div>
          <div class="col-sm-2">
            <label for="tx-hall">${escapeHtml(t("transactions_hall_id"))}</label>
            <input type="text" id="tx-hall" class="form-control" data-testid="tx-hall">
          </div>
          <div class="col-sm-2">
            <label style="display:block;">&nbsp;</label>
            <button type="submit" class="btn btn-info" data-testid="tx-search">
              <i class="fa fa-search"></i> ${escapeHtml(t("search"))}
            </button>
          </div>
        </form>
        <div id="tx-table" data-testid="tx-table">${escapeHtml(t("loading_ellipsis"))}</div>
        <div style="margin-top:8px;">
          <button type="button" class="btn btn-default" data-action="load-more" data-testid="tx-load-more" style="display:none;">
            ${escapeHtml(t("transactions_load_more"))}
          </button>
        </div>
      ${boxClose()}
    </section>`;

  const tableHost = container.querySelector<HTMLElement>("#tx-table")!;
  const form = container.querySelector<HTMLFormElement>("#tx-filter")!;
  const loadMoreBtn = container.querySelector<HTMLButtonElement>(
    "[data-action='load-more']"
  )!;

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    state.rows = [];
    void refresh();
  });
  loadMoreBtn.addEventListener("click", () => void refresh({ append: true }));

  function readFilterFromForm(): ListAdminTransactionsParams {
    const from =
      container.querySelector<HTMLInputElement>("#tx-from")?.value || undefined;
    const to =
      container.querySelector<HTMLInputElement>("#tx-to")?.value || undefined;
    const rawSource =
      container.querySelector<HTMLSelectElement>("#tx-source")?.value || "";
    const source =
      rawSource && SOURCE_OPTIONS.some((o) => o.value === rawSource)
        ? (rawSource as AdminTransactionSource)
        : undefined;
    const userId =
      container.querySelector<HTMLInputElement>("#tx-user")?.value.trim() ||
      undefined;
    const hallId =
      container.querySelector<HTMLInputElement>("#tx-hall")?.value.trim() ||
      undefined;
    const filter: ListAdminTransactionsParams = { limit: 50 };
    if (from) filter.from = `${from}T00:00:00.000Z`;
    if (to) filter.to = `${to}T23:59:59.999Z`;
    if (source) filter.source = source;
    if (userId) filter.userId = userId;
    if (hallId) filter.hallId = hallId;
    return filter;
  }

  async function refresh(options: { append?: boolean } = {}): Promise<void> {
    const appending = options.append === true;
    if (!appending) {
      tableHost.textContent = t("loading_ellipsis");
      loadMoreBtn.style.display = "none";
    }
    try {
      const baseFilter = appending ? state.lastFilter : readFilterFromForm();
      const params: ListAdminTransactionsParams = { ...baseFilter };
      if (appending && state.nextCursor) params.cursor = state.nextCursor;
      const res = await listAdminTransactions(params);
      state.rows = appending ? [...state.rows, ...res.items] : res.items;
      state.nextCursor = res.nextCursor;
      state.lastFilter = baseFilter;
      mountTable();
      loadMoreBtn.style.display = state.nextCursor ? "" : "none";
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
      tableHost.innerHTML = `<div class="callout callout-danger">${escapeHtml(msg)}</div>`;
      loadMoreBtn.style.display = "none";
    }
  }

  function mountTable(): void {
    DataTable.mount<AdminTransactionRow>(tableHost, {
      columns: [
        {
          key: "timestamp",
          title: t("audit_log_timestamp"),
          render: (r) =>
            new Date(r.timestamp).toISOString().slice(0, 19).replace("T", " "),
        },
        {
          key: "source",
          title: t("transactions_source"),
          render: (r) => escapeHtml(sourceLabel(r.source)),
        },
        { key: "type", title: t("transaction_type"), render: (r) => escapeHtml(r.type) },
        {
          key: "amountCents",
          title: t("amount"),
          align: "right",
          render: (r) => formatAmountCents(r.amountCents),
        },
        {
          key: "userId",
          title: t("transactions_user_id"),
          render: (r) => escapeHtml(r.userId ?? "—"),
        },
        {
          key: "hallId",
          title: t("transactions_hall_id"),
          render: (r) => escapeHtml(r.hallId ?? "—"),
        },
        {
          key: "description",
          title: t("description"),
          render: (r) => escapeHtml(r.description),
        },
      ],
      rows: state.rows,
      emptyMessage: t("transactions_no_rows"),
    });
  }

  void refresh();
}

function sourceLabel(source: AdminTransactionSource): string {
  const match = SOURCE_OPTIONS.find((o) => o.value === source);
  return match ? t(match.labelKey) : source;
}
