// Role Management — API-wrappers for per-agent permission-matrix.
//
// Backend: apps/backend/src/routes/adminAgentPermissions.ts.
// RBAC: AGENT_PERMISSION_READ (ADMIN + SUPPORT) / AGENT_PERMISSION_WRITE (ADMIN-only).

import { apiRequest } from "./client.js";

export const AGENT_PERMISSION_MODULES = [
  "player",
  "schedule",
  "game_creation",
  "saved_game",
  "physical_ticket",
  "unique_id",
  "report",
  "wallet",
  "transaction",
  "withdraw",
  "product",
  "hall_account",
  "hall_specific_report",
  "payout",
  "accounting",
] as const;

export type AgentPermissionModule = (typeof AGENT_PERMISSION_MODULES)[number];

export interface ModulePermission {
  module: AgentPermissionModule;
  canCreate: boolean;
  canEdit: boolean;
  canView: boolean;
  canDelete: boolean;
  canBlockUnblock: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface AgentPermissionsEnvelope {
  agentId: string;
  permissions: ModulePermission[];
}

export interface SetModulePermissionInput {
  module: AgentPermissionModule;
  canCreate: boolean;
  canEdit: boolean;
  canView: boolean;
  canDelete: boolean;
  canBlockUnblock: boolean;
}

export async function getAgentPermissions(
  agentId: string
): Promise<AgentPermissionsEnvelope> {
  return apiRequest<AgentPermissionsEnvelope>(
    `/api/admin/agents/${encodeURIComponent(agentId)}/permissions`,
    { auth: true }
  );
}

export async function setAgentPermissions(
  agentId: string,
  permissions: SetModulePermissionInput[]
): Promise<AgentPermissionsEnvelope> {
  return apiRequest<AgentPermissionsEnvelope>(
    `/api/admin/agents/${encodeURIComponent(agentId)}/permissions`,
    {
      method: "PUT",
      body: { permissions },
      auth: true,
    }
  );
}
