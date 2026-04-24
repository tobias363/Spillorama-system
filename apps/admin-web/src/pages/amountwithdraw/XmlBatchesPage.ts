// Withdraw XML-eksport admin-side (wireframe 16.20).
//
// Viser:
//   - Tabell over alle genererte XML-batcher (datointervall, agent,
//     antall rader, e-post-status).
//   - "Generer XML nå"-knapp (PAYMENT_REQUEST_WRITE) — kaller backend
//     POST /api/admin/withdraw/xml-batches/export for å generere en
//     samlet batch og sende til regnskaps-allowlisten.
//   - Per-rad "Send e-post på nytt"-knapp for å re-sende eksisterende
//     batch (f.eks. hvis SMTP var nede da den ble generert).
//
// Regulatorisk / fail-closed:
//   - Backend-500 → Toast.error, tabellen beholder gammel state.
//   - PAYMENT_REQUEST_WRITE-gate på backend + frontend (vi viser ikke
//     knappene hvis caller mangler permission).

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { DataTable } from "../../components/DataTable.js";
import { ApiError } from "../../api/client.js";
import { hasPermission } from "../../auth/permissions.js";
import {
  listXmlBatches,
  triggerXmlExport,
  resendXmlBatch,
  type XmlExportBatch,
} from "../../api/admin-withdraw-xml.js";
import { boxClose, boxOpen, contentHeader, escapeHtml } from "./shared.js";

interface PageState {
  rows: XmlExportBatch[];
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toISOString().slice(0, 16).replace("T", " ");
}

export function renderXmlBatchesPage(container: HTMLElement): void {
  const state: PageState = { rows: [] };
  const canWrite = hasPermission("Withdraw Management", "edit");

  container.innerHTML = `
    ${contentHeader("withdraw_xml_batches")}
    <section class="content">
      ${boxOpen("withdraw_xml_batches", "primary")}
        <div class="row" style="margin-bottom:12px;">
          <div class="col-sm-12 text-right">
            ${
              canWrite
                ? `<button type="button" class="btn btn-success" data-action="export">
                    <i class="fa fa-download"></i> ${escapeHtml(t("withdraw_xml_generate_now"))}
                  </button>`
                : ""
            }
            <button type="button" class="btn btn-default btn-xs" data-action="refresh" style="margin-left:8px;">
              <i class="fa fa-refresh"></i> ${escapeHtml(t("refresh_table"))}
            </button>
          </div>
        </div>
        <div id="xml-batches-table">${escapeHtml(t("loading_ellipsis"))}</div>
      ${boxClose()}
    </section>`;

  const tableHost = container.querySelector<HTMLElement>("#xml-batches-table")!;
  container
    .querySelector<HTMLButtonElement>("[data-action='export']")
    ?.addEventListener("click", () => void onExport());
  container
    .querySelector<HTMLButtonElement>("[data-action='refresh']")
    ?.addEventListener("click", () => void refresh());

  function buildColumns(): Parameters<typeof DataTable.mount<XmlExportBatch>>[1]["columns"] {
    const cols: Parameters<typeof DataTable.mount<XmlExportBatch>>[1]["columns"] = [
      {
        key: "generatedAt",
        title: t("withdraw_xml_batch_generated"),
        render: (r) => formatDate(r.generatedAt),
      },
      {
        key: "agentUserId",
        title: t("withdraw_xml_batch_agent"),
        render: (r) => escapeHtml(r.agentUserId ?? "—"),
      },
      {
        key: "withdrawRequestCount",
        title: t("withdraw_xml_batch_count"),
        align: "right",
        render: (r) => String(r.withdrawRequestCount),
      },
      {
        key: "emailSentAt",
        title: t("withdraw_xml_batch_email_sent"),
        render: (r) =>
          r.emailSentAt
            ? `<span class="label label-success">${escapeHtml(formatDate(r.emailSentAt))}</span>`
            : `<span class="label label-warning">${escapeHtml(t("withdraw_xml_batch_email_not_sent"))}</span>`,
      },
      {
        key: "id",
        title: t("withdraw_xml_batch_id"),
        render: (r) => `<code>${escapeHtml(r.id.slice(0, 8))}…</code>`,
      },
    ];
    if (canWrite) {
      cols.push({
        key: "id",
        title: t("action"),
        align: "center",
        render: (r) => renderActionCell(r),
      });
    }
    return cols;
  }

  function renderActionCell(r: XmlExportBatch): Node {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-primary btn-xs";
    btn.setAttribute("data-id", r.id);
    btn.setAttribute("data-action", "resend");
    btn.innerHTML = `<i class="fa fa-envelope"></i> ${escapeHtml(t("withdraw_xml_resend_email"))}`;
    return btn;
  }

  async function refresh(): Promise<void> {
    tableHost.textContent = t("loading_ellipsis");
    try {
      const res = await listXmlBatches({ limit: 200 });
      state.rows = res.batches;
      if (state.rows.length === 0) {
        tableHost.innerHTML = `<div class="callout callout-info">${escapeHtml(
          t("withdraw_xml_batch_empty")
        )}</div>`;
        return;
      }
      DataTable.mount<XmlExportBatch>(tableHost, {
        columns: buildColumns(),
        rows: state.rows,
        emptyMessage: t("withdraw_xml_batch_empty"),
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
      tableHost.innerHTML = `<div class="callout callout-danger">${escapeHtml(msg)}</div>`;
    }
  }

  async function onExport(): Promise<void> {
    try {
      const res = await triggerXmlExport({});
      if (res.rowCount === 0) {
        Toast.success(t("withdraw_xml_export_empty"));
      } else if (res.email.sent) {
        Toast.success(t("withdraw_xml_export_success"));
      } else {
        Toast.success(t("withdraw_xml_export_success_no_email"));
      }
      await refresh();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
    }
  }

  tableHost.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-action][data-id]");
    if (!btn) return;
    const id = btn.getAttribute("data-id")!;
    const action = btn.getAttribute("data-action");
    if (action !== "resend") return;
    try {
      const res = await resendXmlBatch(id);
      if (res.email.sent) {
        Toast.success(t("withdraw_xml_export_success"));
      } else {
        Toast.success(t("withdraw_xml_export_success_no_email"));
      }
      await refresh();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
    }
  });

  void refresh();
}
