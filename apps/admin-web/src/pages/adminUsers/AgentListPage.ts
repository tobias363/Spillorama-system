// PR-A5 (BIN-663) — /agent list (hall-operator CRUD).
//
// Data:
//   GET    /api/admin/agents?hallId=&status=
//   DELETE /api/admin/agents/:id  (backend blocks if agent has active shift)

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { DataTable } from "../../components/DataTable.js";
import { ApiError } from "../../api/client.js";
import {
  listAgents,
  deleteAgent,
  type Agent,
  type AgentStatus,
} from "../../api/admin-agents.js";
import { listHalls, type AdminHall } from "../../api/admin-halls.js";
import { boxClose, boxOpen, contentHeader, escapeHtml, activeBadge } from "./shared.js";

export function renderAgentListPage(container: HTMLElement): void {
  container.innerHTML = `
    ${contentHeader("agent_management", "agent_management")}
    <section class="content">
      ${boxOpen("agent_management", "primary")}
        <div id="agent-table">${escapeHtml(t("loading_ellipsis"))}</div>
      ${boxClose()}
    </section>`;

  const tableHost = container.querySelector<HTMLElement>("#agent-table")!;

  let halls: AdminHall[] = [];
  let hallFilter = "";
  let statusFilter: AgentStatus | "" = "";

  function hallName(id: string): string {
    const h = halls.find((x) => x.id === id);
    return h ? h.name : id;
  }

  async function refresh(): Promise<void> {
    tableHost.textContent = t("loading_ellipsis");
    try {
      if (halls.length === 0) {
        halls = await listHalls().catch(() => [] as AdminHall[]);
      }
      const params: { hallId?: string; status?: AgentStatus } = {};
      if (hallFilter) params.hallId = hallFilter;
      if (statusFilter) params.status = statusFilter;
      const rows = await listAgents(params);

      DataTable.mount<Agent>(tableHost, {
        id: "agent-datatable",
        columns: [
          {
            key: "displayName",
            title: t("name"),
            render: (r) => escapeHtml(`${r.displayName}${r.surname ? " " + r.surname : ""}`),
          },
          { key: "email", title: t("email"), render: (r) => escapeHtml(r.email) },
          { key: "phone", title: t("phone"), render: (r) => escapeHtml(r.phone ?? "") },
          {
            key: "halls",
            title: t("assign_halls"),
            render: (r) => escapeHtml(r.halls.map((h) => hallName(h.hallId)).join(", ")),
          },
          {
            key: "agentStatus",
            title: t("status"),
            align: "center",
            render: (r) => activeBadge(r.agentStatus === "active"),
          },
          {
            key: "userId",
            title: t("action"),
            align: "center",
            render: (r) => rowActions(r, () => void refresh()),
          },
        ],
        rows,
        emptyMessage: t("no_data_available_in_table"),
        toolbar: {
          extra: (host) => {
            const hallSelect = document.createElement("select");
            hallSelect.className = "form-control input-sm";
            hallSelect.setAttribute("data-testid", "agent-hall-filter");
            hallSelect.style.maxWidth = "220px";
            hallSelect.innerHTML = `<option value="">${escapeHtml(t("select_hall"))}</option>` +
              halls.map((h) => `<option value="${escapeHtml(h.id)}">${escapeHtml(h.name)}</option>`).join("");
            hallSelect.value = hallFilter;
            hallSelect.addEventListener("change", () => {
              hallFilter = hallSelect.value;
              void refresh();
            });
            host.append(hallSelect);

            const statusSelect = document.createElement("select");
            statusSelect.className = "form-control input-sm";
            statusSelect.setAttribute("data-testid", "agent-status-filter");
            statusSelect.style.maxWidth = "160px";
            statusSelect.innerHTML = `<option value="">${escapeHtml(t("status"))}</option>
              <option value="active">${escapeHtml(t("active"))}</option>
              <option value="inactive">${escapeHtml(t("inactive"))}</option>`;
            statusSelect.value = statusFilter;
            statusSelect.addEventListener("change", () => {
              statusFilter = (statusSelect.value as AgentStatus) || "";
              void refresh();
            });
            host.append(statusSelect);

            const addBtn = document.createElement("a");
            addBtn.className = "btn btn-primary btn-sm";
            addBtn.setAttribute("data-action", "add-agent");
            addBtn.href = "#/agent/add";
            addBtn.innerHTML = `<i class="fa fa-plus" aria-hidden="true"></i> ${escapeHtml(t("add_agent"))}`;
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

function rowActions(row: Agent, onChange: () => void): Node {
  const wrap = document.createElement("div");
  wrap.style.whiteSpace = "nowrap";

  const edit = document.createElement("a");
  edit.className = "btn btn-warning btn-xs";
  edit.setAttribute("data-action", "edit-agent");
  edit.setAttribute("data-id", row.userId);
  edit.href = `#/agent/edit/${encodeURIComponent(row.userId)}`;
  edit.innerHTML = `<i class="fa fa-edit" aria-hidden="true"></i>`;
  edit.title = t("edit_agent");
  edit.setAttribute("aria-label", t("edit_agent"));
  wrap.append(edit);

  const del = document.createElement("button");
  del.type = "button";
  del.className = "btn btn-danger btn-xs";
  del.setAttribute("data-action", "delete-agent");
  del.setAttribute("data-id", row.userId);
  del.innerHTML = `<i class="fa fa-trash" aria-hidden="true"></i>`;
  del.title = t("delete");
  del.setAttribute("aria-label", t("delete"));
  del.style.marginLeft = "4px";
  del.addEventListener("click", () => {
    if (!window.confirm(t("delete_message"))) return;
    void (async () => {
      try {
        await deleteAgent(row.userId);
        Toast.success(t("success"));
        onChange();
      } catch (err) {
        Toast.error(err instanceof ApiError ? err.message : t("something_went_wrong"));
      }
    })();
  });
  wrap.append(del);

  return wrap;
}
