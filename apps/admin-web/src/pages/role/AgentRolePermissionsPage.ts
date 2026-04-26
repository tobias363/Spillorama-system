// Role Management — /role/agent.
//
// Per-agent permission-matrix editor. Admin velger en agent, ser 15-rads
// tabell (én per modul) med checkboxes for Create/Edit/View/Delete +
// Block/Unblock (kun player-modulen), og submitter hele matrix til
// PUT /api/admin/agents/:agentId/permissions.
//
// Legacy-spec: Admin CR 21.02.2024 side 5 + Agent V1.0 permissions.
//
// By-default-regler (fra spec, vises som disabled checkboxes i UI):
//   - Player Management (alle actions): alle agenter har by default.
//   - Cash In/Out Management: alle agenter har by default.

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { ApiError } from "../../api/client.js";
import { listAgents, type Agent } from "../../api/admin-agents.js";
import {
  AGENT_PERMISSION_MODULES,
  getAgentPermissions,
  setAgentPermissions,
  type AgentPermissionModule,
  type ModulePermission,
  type SetModulePermissionInput,
} from "../../api/admin-agent-permissions.js";
import {
  boxClose,
  boxOpen,
  contentHeader,
  escapeHtml,
} from "../adminUsers/shared.js";

/**
 * i18n-nøkler for modul-navn. Matches backend-enum.
 */
const MODULE_LABEL_KEYS: Record<AgentPermissionModule, string> = {
  player: "agent_perm_module_player",
  schedule: "agent_perm_module_schedule",
  game_creation: "agent_perm_module_game_creation",
  saved_game: "agent_perm_module_saved_game",
  physical_ticket: "agent_perm_module_physical_ticket",
  unique_id: "agent_perm_module_unique_id",
  report: "agent_perm_module_report",
  wallet: "agent_perm_module_wallet",
  transaction: "agent_perm_module_transaction",
  withdraw: "agent_perm_module_withdraw",
  product: "agent_perm_module_product",
  hall_account: "agent_perm_module_hall_account",
  hall_specific_report: "agent_perm_module_hall_specific_report",
  payout: "agent_perm_module_payout",
  accounting: "agent_perm_module_accounting",
};

function moduleLabel(module: AgentPermissionModule): string {
  return t(MODULE_LABEL_KEYS[module]);
}

export function renderAgentRolePermissionsPage(container: HTMLElement): void {
  container.innerHTML = `
    ${contentHeader("agent_role_permissions_title", "role_management")}
    <section class="content">
      <div class="callout callout-info" data-testid="agent-perm-info">
        <i class="fa fa-info-circle" aria-hidden="true"></i>
        ${escapeHtml(t("agent_perm_info_banner"))}
      </div>
      ${boxOpen("agent_role_permissions_title", "primary")}
        <div class="form-group">
          <label for="agent-perm-select">${escapeHtml(t("select_agent"))}</label>
          <select id="agent-perm-select" class="form-control" data-testid="agent-perm-select">
            <option value="">${escapeHtml(t("loading_ellipsis"))}</option>
          </select>
        </div>
        <div id="agent-perm-matrix">
          <p class="text-muted">${escapeHtml(t("agent_perm_select_prompt"))}</p>
        </div>
      ${boxClose()}
    </section>`;

  const selectEl = container.querySelector<HTMLSelectElement>("#agent-perm-select")!;
  const matrixHost = container.querySelector<HTMLElement>("#agent-perm-matrix")!;

  void bootstrap(selectEl, matrixHost);
}

async function bootstrap(
  selectEl: HTMLSelectElement,
  matrixHost: HTMLElement
): Promise<void> {
  try {
    const agents = await listAgents({ limit: 500 });
    selectEl.innerHTML = `<option value="">-- ${escapeHtml(t("select_agent"))} --</option>` +
      agents
        .map(
          (a) =>
            `<option value="${escapeHtml(a.userId)}">${escapeHtml(formatAgentName(a))}</option>`
        )
        .join("");
    selectEl.addEventListener("change", () => {
      const id = selectEl.value.trim();
      if (!id) {
        matrixHost.innerHTML = `<p class="text-muted">${escapeHtml(t("agent_perm_select_prompt"))}</p>`;
        return;
      }
      void renderMatrix(id, matrixHost);
    });
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
    Toast.error(msg);
    selectEl.innerHTML = `<option value="">-- ${escapeHtml(t("error"))} --</option>`;
  }
}

function formatAgentName(agent: Agent): string {
  const name = `${agent.displayName}${agent.surname ? " " + agent.surname : ""}`;
  return `${name} (${agent.email})`;
}

async function renderMatrix(
  agentId: string,
  host: HTMLElement
): Promise<void> {
  host.innerHTML = `<p>${escapeHtml(t("loading_ellipsis"))}</p>`;
  try {
    const { permissions } = await getAgentPermissions(agentId);
    host.innerHTML = buildMatrixHtml(permissions);
    wireSubmit(host, agentId, permissions);
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
    Toast.error(msg);
    host.innerHTML = `<div class="callout callout-danger">${escapeHtml(msg)}</div>`;
  }
}

function buildMatrixHtml(permissions: ModulePermission[]): string {
  const byModule = new Map(permissions.map((p) => [p.module, p]));
  const rows = AGENT_PERMISSION_MODULES.map((module) => {
    const p = byModule.get(module);
    if (!p) return "";
    const isPlayer = module === "player";
    // Player Management er "by default (som admin ikke kan endre)" per spec:
    // alle checkboxes rendres disabled + checked og sendes alltid som true.
    const cellEnabled = !isPlayer;
    return `
      <tr data-module="${escapeHtml(module)}">
        <td><strong>${escapeHtml(moduleLabel(module))}</strong></td>
        ${cell("canCreate", module, p.canCreate, cellEnabled)}
        ${cell("canEdit", module, p.canEdit, cellEnabled)}
        ${cell("canView", module, p.canView, cellEnabled)}
        ${cell("canDelete", module, p.canDelete, cellEnabled)}
        ${
          isPlayer
            ? cell("canBlockUnblock", module, p.canBlockUnblock, false)
            : `<td class="text-center text-muted">—</td>`
        }
      </tr>`;
  }).join("");

  return `
    <div class="callout callout-warning" data-testid="agent-perm-default-info">
      <i class="fa fa-exclamation-triangle" aria-hidden="true"></i>
      ${escapeHtml(t("agent_perm_default_info"))}
    </div>
    <table class="table table-bordered table-condensed" data-testid="agent-perm-matrix-table">
      <thead>
        <tr>
          <th>${escapeHtml(t("module_name"))}</th>
          <th class="text-center">${escapeHtml(t("create"))}</th>
          <th class="text-center">${escapeHtml(t("edit"))}</th>
          <th class="text-center">${escapeHtml(t("view"))}</th>
          <th class="text-center">${escapeHtml(t("delete"))}</th>
          <th class="text-center">${escapeHtml(t("block_unblock"))}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="box-footer" style="text-align: right;">
      <button type="button" class="btn btn-default" data-action="cancel">
        ${escapeHtml(t("cancel"))}
      </button>
      <button type="button" class="btn btn-primary" data-action="submit" data-testid="agent-perm-submit">
        <i class="fa fa-save" aria-hidden="true"></i> ${escapeHtml(t("add"))}
      </button>
    </div>`;
}

function cell(
  field: string,
  module: AgentPermissionModule,
  checked: boolean,
  enabled: boolean
): string {
  const disabled = enabled ? "" : "disabled";
  const checkedAttr = checked ? "checked" : "";
  return `<td class="text-center">
    <input type="checkbox" data-field="${escapeHtml(field)}" data-module="${escapeHtml(module)}"
           ${checkedAttr} ${disabled} />
  </td>`;
}

function wireSubmit(
  host: HTMLElement,
  agentId: string,
  initial: ModulePermission[]
): void {
  const submitBtn = host.querySelector<HTMLButtonElement>(
    'button[data-action="submit"]'
  );
  const cancelBtn = host.querySelector<HTMLButtonElement>(
    'button[data-action="cancel"]'
  );
  if (!submitBtn) return;

  submitBtn.addEventListener("click", () => {
    const payload = collectPayload(host);
    void (async () => {
      try {
        submitBtn.disabled = true;
        await setAgentPermissions(agentId, payload);
        Toast.success(t("success"));
      } catch (err) {
        Toast.error(err instanceof ApiError ? err.message : t("something_went_wrong"));
      } finally {
        submitBtn.disabled = false;
      }
    })();
  });

  cancelBtn?.addEventListener("click", () => {
    // Reset checkboxes tilbake til initial-state (ikke-lagret).
    for (const p of initial) {
      for (const [field, val] of Object.entries({
        canCreate: p.canCreate,
        canEdit: p.canEdit,
        canView: p.canView,
        canDelete: p.canDelete,
        canBlockUnblock: p.canBlockUnblock,
      })) {
        const cb = host.querySelector<HTMLInputElement>(
          `input[data-module="${p.module}"][data-field="${field}"]`
        );
        if (cb && !cb.disabled) cb.checked = val;
      }
    }
  });
}

function collectPayload(host: HTMLElement): SetModulePermissionInput[] {
  return AGENT_PERMISSION_MODULES.map((module) => {
    // Player Management er by default (admin kan ikke endre) — vi sender alltid
    // alle true for å matche spec. Backend har samme default-regel hvis rad
    // mangler, men vi sender likevel eksplisitt for audit-klarhet.
    if (module === "player") {
      return {
        module: "player",
        canCreate: true,
        canEdit: true,
        canView: true,
        canDelete: true,
        canBlockUnblock: true,
      };
    }
    const read = (field: string): boolean => {
      const cb = host.querySelector<HTMLInputElement>(
        `input[data-module="${module}"][data-field="${field}"]`
      );
      return cb ? cb.checked : false;
    };
    return {
      module,
      canCreate: read("canCreate"),
      canEdit: read("canEdit"),
      canView: read("canView"),
      canDelete: read("canDelete"),
      canBlockUnblock: false,
    };
  });
}
