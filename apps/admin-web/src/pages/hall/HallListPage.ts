// PR-A5 (BIN-663) — /hall list.
//
// Data:
//   GET /api/admin/halls?includeInactive=true
//   PUT /api/admin/halls/:id  (isActive toggle)
//
// Legacy had a "move-players" modal before delete — ikke portert (backend
// har ingen bulk-player-move endpoint). UI viser toggle + info-tekst om
// manuell spiller-migrering før deaktivering.

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { DataTable } from "../../components/DataTable.js";
import { ApiError } from "../../api/client.js";
import {
  listHalls,
  setHallActive,
  type AdminHall,
} from "../../api/admin-halls.js";
import {
  boxClose,
  boxOpen,
  contentHeader,
  escapeHtml,
  activeBadge,
} from "../adminUsers/shared.js";

export function renderHallListPage(container: HTMLElement): void {
  container.innerHTML = `
    ${contentHeader("hall_management", "hall_management")}
    <section class="content">
      <div class="callout callout-warning" data-testid="hall-deactivate-info">
        <i class="fa fa-exclamation-triangle"></i>
        ${escapeHtml(t("hall_deactivate_info"))}
      </div>
      ${boxOpen("hall_management", "primary")}
        <div id="hall-table">${escapeHtml(t("loading_ellipsis"))}</div>
      ${boxClose()}
    </section>`;

  const tableHost = container.querySelector<HTMLElement>("#hall-table")!;

  async function refresh(): Promise<void> {
    tableHost.textContent = t("loading_ellipsis");
    try {
      const rows = await listHalls({ includeInactive: true });
      DataTable.mount<AdminHall>(tableHost, {
        id: "hall-datatable",
        columns: [
          { key: "name", title: t("hall_name"), render: (r) => escapeHtml(r.name) },
          { key: "slug", title: t("hall_number"), render: (r) => escapeHtml(r.slug) },
          {
            key: "region",
            title: t("region"),
            render: (r) => escapeHtml(r.region ?? ""),
          },
          {
            key: "isActive",
            title: t("status"),
            align: "center",
            render: (r) => activeBadge(r.isActive),
          },
          {
            key: "id",
            title: t("action"),
            align: "center",
            render: (r) => rowActions(r, () => void refresh()),
          },
        ],
        rows,
        emptyMessage: t("no_data_available_in_table"),
        toolbar: {
          extra: (host) => {
            const addBtn = document.createElement("a");
            addBtn.className = "btn btn-primary btn-sm";
            addBtn.setAttribute("data-action", "add-hall");
            addBtn.href = "#/hall/add";
            addBtn.innerHTML = `<i class="fa fa-plus"></i> ${escapeHtml(t("add_hall"))}`;
            host.append(addBtn);
          },
        },
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
      tableHost.innerHTML = `<div class="callout callout-danger">${escapeHtml(msg)}</div>`;
    }
  }

  void refresh();
}

function rowActions(row: AdminHall, onChange: () => void): Node {
  const wrap = document.createElement("div");
  wrap.style.whiteSpace = "nowrap";

  const edit = document.createElement("a");
  edit.className = "btn btn-warning btn-xs";
  edit.setAttribute("data-action", "edit-hall");
  edit.setAttribute("data-id", row.id);
  edit.href = `#/hall/edit/${encodeURIComponent(row.id)}`;
  edit.innerHTML = `<i class="fa fa-edit"></i>`;
  edit.title = t("edit_hall");
  wrap.append(edit);

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = row.isActive ? "btn btn-danger btn-xs" : "btn btn-success btn-xs";
  toggle.setAttribute("data-action", "toggle-hall");
  toggle.setAttribute("data-id", row.id);
  toggle.innerHTML = row.isActive
    ? `<i class="fa fa-ban"></i>`
    : `<i class="fa fa-check"></i>`;
  toggle.title = row.isActive ? t("inactive") : t("active");
  toggle.style.marginLeft = "4px";
  toggle.addEventListener("click", () => {
    // Confirmation required for deactivation (destructive-ish).
    if (row.isActive) {
      const msg = `${t("are_you_sure")}\n\n${t("hall_deactivate_info")}`;
      if (!window.confirm(msg)) return;
    }
    void (async () => {
      try {
        await setHallActive(row.id, !row.isActive);
        Toast.success(t("success"));
        onChange();
      } catch (err) {
        Toast.error(err instanceof ApiError ? err.message : t("something_went_wrong"));
      }
    })();
  });
  wrap.append(toggle);

  return wrap;
}
