/**
 * BIN-583 B3.1: orchestrates agent profile, CRUD, and hall assignments.
 *
 * Split of concerns:
 *   - PlatformService: core user-row lifecycle (create/delete/auth),
 *     password hashing, wallet-account provisioning. Shared across all
 *     roles.
 *   - AgentStore: raw Postgres access to agent-specific columns +
 *     app_agent_halls + app_agent_shifts.
 *   - AgentService (this): domain rules on top of the two — e.g. "can't
 *     delete an agent with an active shift", "first hall assignment
 *     becomes primary automatically".
 *
 * Audit-logging hooks are callers' responsibility (route-level), since
 * actor context (who did the action, from where) only lives in the
 * request path.
 */

import { DomainError } from "../game/BingoEngine.js";
import type { PlatformService, AppUser, UserRole } from "../platform/PlatformService.js";
import type {
  AgentStore,
  AgentProfile,
  AgentHallAssignment,
  AgentStatus,
  AgentListFilter
} from "./AgentStore.js";

const SUPPORTED_LANGUAGES = new Set(["nb", "nn", "en", "sv", "da"]);

function assertLanguage(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SUPPORTED_LANGUAGES.has(normalized)) {
    throw new DomainError(
      "INVALID_LANGUAGE",
      `Språk må være en av: ${Array.from(SUPPORTED_LANGUAGES).join(", ")}.`
    );
  }
  return normalized;
}

function assertAgentStatus(value: string): AgentStatus {
  if (value === "active" || value === "inactive") return value;
  throw new DomainError("INVALID_STATUS", "agent_status må være active eller inactive.");
}

export interface CreateAgentInput {
  email: string;
  password: string;
  displayName: string;
  surname: string;
  phone?: string;
  language?: string;
  parentUserId?: string | null;
  hallIds?: string[];
  primaryHallId?: string;
  agentStatus?: AgentStatus;
}

export interface UpdateAgentInput {
  displayName?: string;
  email?: string;
  phone?: string | null;
  language?: string;
  avatarFilename?: string | null;
  agentStatus?: AgentStatus;
  parentUserId?: string | null;
  hallIds?: string[];
  primaryHallId?: string;
}

export interface AgentServiceDeps {
  platformService: PlatformService;
  agentStore: AgentStore;
}

export class AgentService {
  private readonly platform: PlatformService;
  private readonly store: AgentStore;

  constructor(deps: AgentServiceDeps) {
    this.platform = deps.platformService;
    this.store = deps.agentStore;
  }

  async getById(userId: string): Promise<AgentProfile> {
    const profile = await this.store.getAgentById(userId);
    if (!profile) {
      throw new DomainError("AGENT_NOT_FOUND", "Agenten finnes ikke.");
    }
    return profile;
  }

  async list(filter?: AgentListFilter): Promise<AgentProfile[]> {
    return this.store.listAgents(filter);
  }

  /**
   * Admin flow — opprett ny AGENT. E-post må være unik. Hvis primaryHallId
   * er satt må den være med i hallIds.
   */
  async createAgent(input: CreateAgentInput): Promise<AgentProfile> {
    const language = input.language ? assertLanguage(input.language) : "nb";
    const agentStatus = input.agentStatus ?? "active";
    const hallIds = dedupe(input.hallIds ?? []);
    const primaryHallId = input.primaryHallId;
    if (primaryHallId && !hallIds.includes(primaryHallId)) {
      throw new DomainError(
        "INVALID_PRIMARY_HALL",
        "primaryHallId må være en av hallIds."
      );
    }
    const user: AppUser = await this.platform.createAdminProvisionedUser({
      email: input.email,
      password: input.password,
      displayName: input.displayName,
      surname: input.surname,
      role: "AGENT",
      phone: input.phone
    });
    await this.store.createAgentProfile({
      userId: user.id,
      language,
      parentUserId: input.parentUserId ?? null,
      agentStatus
    });
    for (const hallId of hallIds) {
      const isPrimary = primaryHallId
        ? hallId === primaryHallId
        : hallId === hallIds[0]; // default: første hall er primary
      await this.store.assignHall({
        userId: user.id,
        hallId,
        isPrimary
      });
    }
    const profile = await this.store.getAgentById(user.id);
    if (!profile) {
      throw new DomainError("AGENT_NOT_FOUND", "Agent ble opprettet, men kunne ikke leses.");
    }
    return profile;
  }

  /** Agent self-service eller admin updates profilen. */
  async updateAgent(
    userId: string,
    patch: UpdateAgentInput,
    actor: { role: UserRole; userId: string }
  ): Promise<AgentProfile> {
    const existing = await this.getById(userId);

    // Ownership check: en AGENT kan kun oppdatere seg selv.
    if (actor.role === "AGENT" && actor.userId !== userId) {
      throw new DomainError("FORBIDDEN", "Du kan kun oppdatere egen profil.");
    }

    // Felter som kun admin/hall-operator kan endre:
    const adminOnly = patch.agentStatus !== undefined || patch.parentUserId !== undefined
      || patch.hallIds !== undefined || patch.primaryHallId !== undefined;
    if (actor.role === "AGENT" && adminOnly) {
      throw new DomainError("FORBIDDEN", "Kun admin kan endre status/hall-tildeling.");
    }

    const storePatch: Parameters<AgentStore["updateAgentProfile"]>[1] = {};
    if (patch.displayName !== undefined) storePatch.displayName = patch.displayName.trim();
    if (patch.email !== undefined) storePatch.email = patch.email.trim().toLowerCase();
    if (patch.phone !== undefined) storePatch.phone = patch.phone;
    if (patch.language !== undefined) storePatch.language = assertLanguage(patch.language);
    if (patch.avatarFilename !== undefined) storePatch.avatarFilename = patch.avatarFilename;
    if (patch.agentStatus !== undefined) storePatch.agentStatus = assertAgentStatus(patch.agentStatus);
    if (patch.parentUserId !== undefined) storePatch.parentUserId = patch.parentUserId;

    await this.store.updateAgentProfile(userId, storePatch);

    // Hall-tildeling: diff mot existing.halls.
    if (patch.hallIds !== undefined) {
      const nextIds = dedupe(patch.hallIds);
      const currentIds = existing.halls.map((h) => h.hallId);
      const toAdd = nextIds.filter((id) => !currentIds.includes(id));
      const toRemove = currentIds.filter((id) => !nextIds.includes(id));
      for (const hallId of toRemove) {
        await this.store.unassignHall(userId, hallId);
      }
      for (const hallId of toAdd) {
        await this.store.assignHall({
          userId,
          hallId,
          assignedByUserId: actor.userId
        });
      }
      // Primary-håndtering — hvis primaryHallId er gitt, sett den. Ellers
      // behold eksisterende primary hvis den fortsatt er med i lista,
      // eller promoter den første nye.
      if (patch.primaryHallId) {
        if (!nextIds.includes(patch.primaryHallId)) {
          throw new DomainError("INVALID_PRIMARY_HALL", "primaryHallId må være en av hallIds.");
        }
        await this.store.setPrimaryHall(userId, patch.primaryHallId);
      } else if (nextIds.length > 0) {
        const currentPrimary = existing.halls.find((h) => h.isPrimary)?.hallId;
        if (!currentPrimary || !nextIds.includes(currentPrimary)) {
          await this.store.setPrimaryHall(userId, nextIds[0]!);
        }
      }
    } else if (patch.primaryHallId) {
      const current = existing.halls.map((h) => h.hallId);
      if (!current.includes(patch.primaryHallId)) {
        throw new DomainError("INVALID_PRIMARY_HALL", "primaryHallId må være en av agentens tildelte haller.");
      }
      await this.store.setPrimaryHall(userId, patch.primaryHallId);
    }

    return this.getById(userId);
  }

  /**
   * Soft-delete av agent. Feiler hvis agenten har aktiv shift — må
   * avslutte den først (evt. via AGENT_SHIFT_FORCE). Destruktiv hard-
   * delete er ikke eksponert her; soft-delete oppnås ved å sette
   * agent_status=inactive + app_users.deleted_at i PlatformService.
   */
  async softDeleteAgent(userId: string): Promise<void> {
    const existing = await this.getById(userId);
    const activeShift = await this.store.getActiveShiftForUser(existing.userId);
    if (activeShift) {
      throw new DomainError(
        "AGENT_HAS_ACTIVE_SHIFT",
        "Agenten har aktiv shift. Avslutt shiften før agenten slettes."
      );
    }
    // Mark inactive først (fail-closed: kan ikke logge inn)
    await this.store.updateAgentProfile(userId, { agentStatus: "inactive" });
    // deleted_at settes via platform-service (gjenbruk soft-delete fra BIN-587 B2.3)
    await this.platform.softDeletePlayer(userId);
  }

  /** Er en AGENT's konto aktiv? Brukt ved login-guard. */
  async isActive(userId: string): Promise<boolean> {
    const profile = await this.store.getAgentById(userId);
    return Boolean(profile && profile.agentStatus === "active");
  }

  /** Returnerer agent-profil for en innlogget bruker (guard inkl.). */
  async requireActiveAgent(userId: string): Promise<AgentProfile> {
    const profile = await this.store.getAgentById(userId);
    if (!profile) {
      throw new DomainError("FORBIDDEN", "Brukeren er ikke en agent.");
    }
    if (profile.agentStatus !== "active") {
      throw new DomainError("ACCOUNT_INACTIVE", "Agent-kontoen er deaktivert.");
    }
    return profile;
  }

  /** Hjelpemetode: sjekk at hallId er tildelt agenten. */
  async assertHallMembership(userId: string, hallId: string): Promise<AgentHallAssignment> {
    const halls = await this.store.listAssignedHalls(userId);
    const assignment = halls.find((h) => h.hallId === hallId);
    if (!assignment) {
      throw new DomainError(
        "HALL_NOT_ASSIGNED",
        "Agenten har ikke tilgang til denne hallen."
      );
    }
    return assignment;
  }
}

function dedupe<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}
