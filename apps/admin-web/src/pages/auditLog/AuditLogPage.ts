// BIN-655 (alt) — Audit-log UI.
//
// Path: /auditLog
//
// Data: GET /api/admin/audit-log (cursor-paginert).
// Filter: dato-vindu + actorId + resource + action. Alle valgfrie.
// Read-only; kreves AUDIT_LOG_READ (ADMIN + SUPPORT). Regulatorisk §11.
//
// Viser immutable audit-events. Ingen mutasjons-handlinger i denne UI-en —
// alt er append-only og skal ikke kunne endres fra frontend.

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { DataTable } from "../../components/DataTable.js";
import { ApiError } from "../../api/client.js";
import {
  listAuditLog,
  type AdminAuditLogEvent,
  type ListAuditLogParams,
} from "../../api/admin-audit-log.js";
import {
  boxClose,
  boxOpen,
  contentHeader,
  escapeHtml,
} from "../amountwithdraw/shared.js";

interface PageState {
  rows: AdminAuditLogEvent[];
  nextCursor: string | null;
  lastFilter: ListAuditLogParams;
}

export function renderAuditLogPage(container: HTMLElement): void {
  const state: PageState = { rows: [], nextCursor: null, lastFilter: {} };

  container.innerHTML = `
    ${contentHeader("audit_log_title", "audit_log_title")}
    <section class="content">
      ${boxOpen("audit_log_title", "danger")}
        <p class="text-muted">${escapeHtml(t("audit_log_intro"))}</p>
        <form id="audit-filter" class="row" style="margin-bottom:12px;" data-testid="audit-filter-form">
          <div class="col-sm-2">
            <label for="audit-from">${escapeHtml(t("start_date"))}</label>
            <input type="date" id="audit-from" class="form-control">
          </div>
          <div class="col-sm-2">
            <label for="audit-to">${escapeHtml(t("end_date"))}</label>
            <input type="date" id="audit-to" class="form-control">
          </div>
          <div class="col-sm-2">
            <label for="audit-actor">${escapeHtml(t("audit_log_actor_id"))}</label>
            <input type="text" id="audit-actor" class="form-control" data-testid="audit-actor">
          </div>
          <div class="col-sm-2">
            <label for="audit-resource">${escapeHtml(t("audit_log_resource"))}</label>
            <input type="text" id="audit-resource" class="form-control" data-testid="audit-resource">
          </div>
          <div class="col-sm-2">
            <label for="audit-action">${escapeHtml(t("audit_log_action"))}</label>
            <input type="text" id="audit-action" class="form-control" data-testid="audit-action">
          </div>
          <div class="col-sm-2">
            <label style="display:block;">&nbsp;</label>
            <button type="submit" class="btn btn-info" data-testid="audit-search">
              <i class="fa fa-search"></i> ${escapeHtml(t("search"))}
            </button>
          </div>
        </form>
        <div id="audit-table" data-testid="audit-table">${escapeHtml(t("loading_ellipsis"))}</div>
        <div style="margin-top:8px;">
          <button type="button" class="btn btn-default" data-action="load-more" data-testid="audit-load-more" style="display:none;">
            ${escapeHtml(t("transactions_load_more"))}
          </button>
        </div>
      ${boxClose()}
    </section>`;

  const tableHost = container.querySelector<HTMLElement>("#audit-table")!;
  const form = container.querySelector<HTMLFormElement>("#audit-filter")!;
  const loadMoreBtn = container.querySelector<HTMLButtonElement>(
    "[data-action='load-more']"
  )!;

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    state.rows = [];
    void refresh();
  });
  loadMoreBtn.addEventListener("click", () => void refresh({ append: true }));

  function readFilterFromForm(): ListAuditLogParams {
    const from =
      container.querySelector<HTMLInputElement>("#audit-from")?.value || undefined;
    const to =
      container.querySelector<HTMLInputElement>("#audit-to")?.value || undefined;
    const actorId =
      container.querySelector<HTMLInputElement>("#audit-actor")?.value.trim() ||
      undefined;
    const resource =
      container.querySelector<HTMLInputElement>("#audit-resource")?.value.trim() ||
      undefined;
    const action =
      container.querySelector<HTMLInputElement>("#audit-action")?.value.trim() ||
      undefined;
    const filter: ListAuditLogParams = { limit: 50 };
    if (from) filter.from = `${from}T00:00:00.000Z`;
    if (to) filter.to = `${to}T23:59:59.999Z`;
    if (actorId) filter.actorId = actorId;
    if (resource) filter.resource = resource;
    if (action) filter.action = action;
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
      const params: ListAuditLogParams = { ...baseFilter };
      if (appending && state.nextCursor) params.cursor = state.nextCursor;
      const res = await listAuditLog(params);
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
    DataTable.mount<AdminAuditLogEvent>(tableHost, {
      columns: [
        {
          key: "createdAt",
          title: t("audit_log_timestamp"),
          render: (r) =>
            new Date(r.createdAt).toISOString().slice(0, 19).replace("T", " "),
        },
        {
          key: "actorId",
          title: t("audit_log_actor_id"),
          render: (r) => escapeHtml(r.actorId ?? "—"),
        },
        {
          key: "actorType",
          title: t("actor"),
          render: (r) => escapeHtml(r.actorType),
        },
        { key: "action", title: t("audit_log_action"), render: (r) => `<code>${escapeHtml(r.action)}</code>` },
        {
          key: "resource",
          title: t("audit_log_resource"),
          render: (r) =>
            `${escapeHtml(r.resource)}${r.resourceId ? `:${escapeHtml(r.resourceId)}` : ""}`,
        },
        {
          key: "ipAddress",
          title: t("audit_log_ip"),
          render: (r) => escapeHtml(r.ipAddress ?? "—"),
        },
        {
          key: "details",
          title: t("audit_log_details"),
          render: (r) => {
            const keys = Object.keys(r.details ?? {});
            if (keys.length === 0) return "—";
            return `<code>${escapeHtml(JSON.stringify(r.details))}</code>`;
          },
        },
      ],
      rows: state.rows,
      emptyMessage: t("audit_log_no_rows"),
    });
  }

  void refresh();
}
