// PDF 17 §17.31 — Sold Ticket UI (agent-view).
//
// Wireframe: docs/wireframes/WF_B_Spillorama_Agent_V1.0_14-10-2024.pdf §17.31
//
// Filter-rad: Date Range (From/To) + Search by Ticket ID + Type
// dropdown (Physical/Terminal/Web).
// Kolonner: Date/Time, Ticket ID, Ticket Type, Ticket Color, Ticket Price,
// Winning Pattern. Export CSV via DataTable.csvExport.
//
// RBAC: AGENT må ha aktiv shift (auto-scope hall). HALL_OPERATOR/ADMIN ser
// alle agenters salg i hallen. Backend håndhever scope.
//
// Forskjell fra `cash-inout/SoldTicketsPage.ts`:
//   - Cash-inout-versjon henter agent-transactions (`/api/agent/transactions`
//     med type=ticket-sale) — viser shift-scoped salg av terminal-bonger.
//   - Denne hentes fra `app_static_tickets` via `/api/agent/sold-tickets`
//     og er ment for "fysiske paper bonger" + framtidig terminal/web
//     (gap dokumentert i backend-router; foreløpig tom liste for
//     ikke-physical type).

import { DataTable } from "../../components/DataTable.js";
import { t } from "../../i18n/I18n.js";
import { escapeHtml } from "../games/common/escape.js";
import {
  defaultDateRange,
  formatCurrency,
  formatDateTime,
  renderReportShell,
  toIsoDate,
} from "../reports/shared/reportShell.js";
import {
  getSoldTickets,
  type SoldTicketRow,
  type SoldTicketSourceType,
} from "../../api/agent-history.js";

const TYPE_LABELS: Record<SoldTicketSourceType, string> = {
  physical: "Physical",
  terminal: "Terminal",
  web: "Web",
  all: "Alle",
};

export async function renderSoldTicketUiPage(
  container: HTMLElement,
): Promise<void> {
  const tableHostId = "sold-ticket-ui-table";
  container.innerHTML = renderReportShell({
    title: t("sold_ticket"),
    tableHostId,
    moduleTitleKey: "agent_dashboard",
  });

  const hostEl = container.querySelector<HTMLElement>(`#${tableHostId}`);
  if (!hostEl) return;
  const host: HTMLElement = hostEl;

  const { from, to } = defaultDateRange();
  let currentFrom = toIsoDate(from);
  let currentTo = toIsoDate(to);
  let currentSearch = "";
  let currentType: SoldTicketSourceType = "physical";

  const handle = DataTable.mount<SoldTicketRow>(host, {
    rows: [],
    emptyMessage: t("no_data_available_in_table"),
    className: "agent-sold-tickets-ui",
    dateRange: {
      initialFrom: from,
      initialTo: to,
      onChange: (f, tD) => {
        if (f) currentFrom = toIsoDate(f);
        if (tD) currentTo = toIsoDate(tD);
        void reload();
      },
    },
    toolbar: {
      extra: (slot) => {
        // Search by Ticket ID.
        const searchLabel = document.createElement("label");
        searchLabel.style.cssText =
          "display:flex;flex-direction:column;font-size:12px;";
        searchLabel.textContent = t("search_by_ticket_id");
        const searchInput = document.createElement("input");
        searchInput.type = "text";
        searchInput.className = "form-control input-sm";
        searchInput.style.width = "200px";
        searchInput.placeholder = t("search_by_ticket_id");
        searchInput.addEventListener("input", () => {
          currentSearch = searchInput.value.trim();
        });
        searchInput.addEventListener("change", () => void reload());
        searchInput.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void reload();
          }
        });
        searchLabel.append(searchInput);
        slot.append(searchLabel);

        // Type dropdown (Physical / Terminal / Web).
        const typeLabel = document.createElement("label");
        typeLabel.style.cssText =
          "display:flex;flex-direction:column;font-size:12px;margin-left:8px;";
        typeLabel.textContent = t("type") ?? "Type";
        const select = document.createElement("select");
        select.className = "form-control input-sm";
        select.style.width = "150px";
        for (const value of ["physical", "terminal", "web", "all"] as const) {
          const opt = document.createElement("option");
          opt.value = value;
          opt.textContent = TYPE_LABELS[value];
          if (value === currentType) opt.selected = true;
          select.append(opt);
        }
        select.addEventListener("change", () => {
          currentType = select.value as SoldTicketSourceType;
          void reload();
        });
        typeLabel.append(select);
        slot.append(typeLabel);
      },
    },
    csvExport: {
      filename: `sold-tickets-${currentFrom}_${currentTo}`,
    },
    columns: [
      {
        key: "dateTime",
        title: t("date_time"),
        render: (r) => escapeHtml(formatDateTime(r.dateTime)),
      },
      {
        key: "ticketId",
        title: t("ticket_id"),
        render: (r) => escapeHtml(r.ticketId),
      },
      {
        key: "ticketType",
        title: t("ticket_type"),
        render: (r) => escapeHtml(r.ticketType),
      },
      {
        key: "ticketColor",
        title: t("ticket_color"),
        render: (r) => escapeHtml(r.ticketColor),
      },
      {
        key: "priceCents",
        title: t("ticket_price"),
        align: "right",
        render: (r) =>
          r.priceCents !== null
            ? `${escapeHtml(formatCurrency(r.priceCents))} kr`
            : "—",
      },
      {
        key: "winningPattern",
        title: t("winning_pattern"),
        render: (r) => escapeHtml(r.winningPattern ?? "—"),
      },
    ],
  });

  async function reload(): Promise<void> {
    try {
      const res = await getSoldTickets({
        from: currentFrom,
        to: currentTo,
        ticketId: currentSearch || undefined,
        type: currentType,
        limit: 500,
        offset: 0,
      });
      handle.setRows(res.rows);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      host.insertAdjacentHTML(
        "afterbegin",
        `<div class="alert alert-danger">${escapeHtml(msg)}</div>`,
      );
    }
  }

  await reload();
}
