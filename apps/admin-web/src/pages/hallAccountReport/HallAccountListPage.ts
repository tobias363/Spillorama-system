// PR-A4b (BIN-659) — /hallAccountReport list page.
// REQ-143 — utvidet med Group-of-Hall-dropdown.
//
// Presents a list of halls as a link-grid that jumps to per-hall account
// history + settlement report. Multi-hall-operatorer kan velge en
// Group-of-Hall i dropdown og bli sendt til aggregert group-rapport
// (`#/hallAccountReport/group/:groupId`).
//
// Backend:
//   GET /api/admin/halls?includeInactive=true
//   GET /api/admin/reports/groups (server-scopet for HALL_OPERATOR)

import { DataTable } from "../../components/DataTable.js";
import { t } from "../../i18n/I18n.js";
import { listHalls, type AdminHall } from "../../api/dashboard.js";
import {
  listReportGroups,
  type GroupSummary,
} from "../../api/admin-group-hall-reports.js";
import { renderReportShell } from "../reports/shared/reportShell.js";
import { escapeHtml } from "../games/common/escape.js";

export async function renderHallAccountListPage(container: HTMLElement): Promise<void> {
  const tableHostId = "hall-account-list-table";
  const groupSelectorId = "hall-account-group-selector";
  container.innerHTML = renderReportShell({
    title: t("hall_account_report"),
    moduleTitleKey: "hall_account_report",
    tableHostId,
    extraBelow: `
      <div id="${groupSelectorId}" style="margin-top:16px"></div>`,
  });
  const host = container.querySelector<HTMLElement>(`#${tableHostId}`);
  const groupHost = container.querySelector<HTMLElement>(`#${groupSelectorId}`);
  if (!host) return;

  // Last halls + groups parallelt. Group-listen er server-scopet:
  // HALL_OPERATOR ser kun grupper hvor egen hall er medlem; ADMIN/SUPPORT
  // ser alle. Fail-soft: hvis groups-fetch feiler vises hall-listen
  // uten group-dropdown.
  try {
    const [halls, groupsResp] = await Promise.all([
      listHalls(),
      listReportGroups().catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.warn("[REQ-143] kunne ikke hente group-of-hall-liste:", err);
        return { groups: [] as GroupSummary[], count: 0 };
      }),
    ]);

    DataTable.mount<AdminHall>(host, {
      rows: halls,
      emptyMessage: t("no_data_available_in_table"),
      className: "hall-account-list",
      columns: [
        { key: "id", title: t("hall_id") },
        { key: "name", title: t("hall_name") },
        {
          key: "id",
          title: t("actions"),
          align: "center",
          render: (row) => {
            const id = encodeURIComponent(row.id);
            return (
              `<a href="#/hallAccountReport/${id}" class="btn btn-info btn-xs btn-rounded" ` +
              `title="${escapeHtml(t("view"))}">` +
              `<i class="fa fa-eye" aria-hidden="true"></i></a> ` +
              `<a href="#/report/settlement/${id}" class="btn btn-danger btn-xs btn-rounded" ` +
              `title="${escapeHtml(t("settlement_report"))}">` +
              `<i class="fa fa-file" aria-hidden="true"></i></a>`
            );
          },
        },
      ],
    });

    if (groupHost) {
      renderGroupSelector(groupHost, groupsResp.groups);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    host.innerHTML = `<div class="alert alert-danger">${escapeHtml(msg)}</div>`;
  }
}

function renderGroupSelector(host: HTMLElement, groups: GroupSummary[]): void {
  if (groups.length === 0) {
    host.innerHTML = "";
    return;
  }
  const label = escapeHtml(t("group_of_hall") ?? "Group of Hall");
  const placeholder = escapeHtml(t("select_group_of_hall") ?? "Velg Group of Hall...");
  const options = groups
    .map(
      (g) =>
        `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)} ` +
        `(${g.memberCount} ${escapeHtml(t("halls") ?? "haller")})</option>`,
    )
    .join("");
  host.innerHTML = `
    <div class="form-inline" role="group" aria-label="${label}">
      <label for="hall-account-group-select" style="margin-right:8px">
        <strong>${label}:</strong>
      </label>
      <select id="hall-account-group-select" class="form-control input-sm" style="min-width:240px">
        <option value="">${placeholder}</option>
        ${options}
      </select>
    </div>
    <small style="opacity:0.7;display:block;margin-top:4px">
      ${escapeHtml(t("group_aggregate_hint") ?? "Velg en gruppe for aggregert rapport over alle medlemshaller.")}
    </small>`;

  const select = host.querySelector<HTMLSelectElement>("#hall-account-group-select");
  if (!select) return;
  select.addEventListener("change", () => {
    const groupId = select.value.trim();
    if (groupId) {
      window.location.hash = `#/hallAccountReport/group/${encodeURIComponent(groupId)}`;
    }
  });
}
