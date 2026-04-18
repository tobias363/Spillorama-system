/**
 * BIN-583 B3.1: agent-shift lifecycle.
 *
 * Core invariants enforced here (defense-in-depth — DB partial unique-
 * index `uniq_app_agent_shifts_active_per_user` is the authoritative
 * guard, but we fail fast with a clear DomainError before the DB
 * rejects with a generic constraint violation).
 *
 *   - Max one active shift per agent.
 *   - Shift-start requires (user, hall) membership in app_agent_halls.
 *   - Shift-end can be called by the owner OR by ADMIN (force close).
 *   - Agent must be status=active to start a new shift.
 *
 * Wallet idempotency keys (pattern established for B3.2/B3.3 mutations):
 *   agent-shift:{shiftId}:start       — (B3.2) wallet-seed ved start
 *   agent-shift:{shiftId}:end         — (B3.3) wallet-settlement ved end
 *   agent-shift:{shiftId}:cash-in:{txId}  — (B3.2)
 *   agent-shift:{shiftId}:cash-out:{txId} — (B3.2)
 *
 * B3.1 itself writes nothing to the wallet — lifecycle only.
 */

import { DomainError } from "../game/BingoEngine.js";
import type { AgentStore, AgentShift } from "./AgentStore.js";
import type { AgentService } from "./AgentService.js";

export interface StartShiftInput {
  userId: string;
  hallId: string;
}

export interface EndShiftInput {
  shiftId: string;
  /** Hvem kaller — påvirker om eier-check kreves. */
  actor: { userId: string; role: string };
}

export interface AgentShiftServiceDeps {
  agentStore: AgentStore;
  agentService: AgentService;
}

export class AgentShiftService {
  private readonly store: AgentStore;
  private readonly agents: AgentService;

  constructor(deps: AgentShiftServiceDeps) {
    this.store = deps.agentStore;
    this.agents = deps.agentService;
  }

  /**
   * Start ny shift. Fail-cases:
   *   - AGENT_INACTIVE hvis agentens konto er deaktivert
   *   - SHIFT_ALREADY_ACTIVE hvis agenten har en aktiv shift
   *   - HALL_NOT_ASSIGNED hvis hallId ikke er i agentens tildelte haller
   */
  async startShift(input: StartShiftInput): Promise<AgentShift> {
    const profile = await this.agents.requireActiveAgent(input.userId);
    const hallOk = profile.halls.some((h) => h.hallId === input.hallId);
    if (!hallOk) {
      throw new DomainError(
        "HALL_NOT_ASSIGNED",
        "Agenten har ikke tilgang til denne hallen."
      );
    }
    const existing = await this.store.getActiveShiftForUser(input.userId);
    if (existing) {
      throw new DomainError(
        "SHIFT_ALREADY_ACTIVE",
        "Du har allerede en aktiv shift. Avslutt den først."
      );
    }
    try {
      return await this.store.insertShift({
        userId: input.userId,
        hallId: input.hallId
      });
    } catch (err) {
      // DB unique-index kan slå inn under race (to samtidige calls).
      if (isUniqueViolation(err)) {
        throw new DomainError(
          "SHIFT_ALREADY_ACTIVE",
          "Du har allerede en aktiv shift. Avslutt den først."
        );
      }
      throw err;
    }
  }

  /**
   * Avslutt shift. Owner-check:
   *   - AGENT: kan kun avslutte egen shift
   *   - ADMIN: kan force-close stuck shift (gated via AGENT_SHIFT_FORCE)
   *   - Andre: FORBIDDEN
   */
  async endShift(input: EndShiftInput): Promise<AgentShift> {
    const shift = await this.store.getShiftById(input.shiftId);
    if (!shift) {
      throw new DomainError("SHIFT_NOT_FOUND", "Shiften finnes ikke.");
    }
    if (!shift.isActive) {
      throw new DomainError("SHIFT_ALREADY_ENDED", "Shiften er allerede avsluttet.");
    }
    const isOwner = input.actor.userId === shift.userId;
    const isAdmin = input.actor.role === "ADMIN";
    if (!isOwner && !isAdmin) {
      throw new DomainError("FORBIDDEN", "Du kan ikke avslutte denne shiften.");
    }
    return this.store.endShift(shift.id);
  }

  async getCurrentShift(userId: string): Promise<AgentShift | null> {
    return this.store.getActiveShiftForUser(userId);
  }

  async getHistory(userId: string, options?: { limit?: number; offset?: number }): Promise<AgentShift[]> {
    return this.store.listShiftsForUser(userId, options?.limit, options?.offset);
  }

  async listActiveInHall(hallId: string): Promise<AgentShift[]> {
    return this.store.listActiveShiftsForHall(hallId);
  }

  async getShift(shiftId: string): Promise<AgentShift> {
    const shift = await this.store.getShiftById(shiftId);
    if (!shift) {
      throw new DomainError("SHIFT_NOT_FOUND", "Shiften finnes ikke.");
    }
    return shift;
  }
}

/** Postgres unique-constraint violation. pg throws with code '23505'. */
function isUniqueViolation(err: unknown): boolean {
  return Boolean(
    err && typeof err === "object" && "code" in err && (err as { code: string }).code === "23505"
  );
}
