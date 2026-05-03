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

import { DomainError } from "../errors/DomainError.js";
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
  /** Wireframe Gap #9: opt-in flagg fra Shift Log Out-popup. */
  flags?: LogoutFlags;
  /**
   * PR #522 hotfix: admin-force-close audit-reason. Påkrevd når ADMIN
   * stenger en stuck shift som ikke er deres egen — speglerer
   * `cancelPhysicalSale.reason`-mønsteret. Lagres i shift.logoutNotes
   * (bakoverkompatibelt) + audit-event-detaljer i route-laget.
   */
  reason?: string | null;
}

/**
 * Wireframe Gap #9: Opt-in flagg fra Shift Log Out-popup (skjerm 17.6).
 * Uten disse = legacy-oppførsel (rent shift.end).
 */
export interface LogoutFlags {
  /**
   * "Distribute winnings to physical players" — markerer alle pending
   * cashouts for agenten som tilgjengelig for neste agent.
   */
  distributeWinnings?: boolean;
  /**
   * "Transfer register ticket to next agent" — markerer åpne ticket-ranges
   * som overførbar.
   */
  transferRegisterTickets?: boolean;
  /** Valgfri audit-notat. */
  logoutNotes?: string | null;
}

/**
 * Wireframe Gap #9: Resultat fra logout — rapportér tilbake til UI hvor mange
 * pending cashouts og ticket-ranges som ble flagget for neste agent.
 */
export interface LogoutResult {
  shift: AgentShift;
  pendingCashoutsFlagged: number;
  ticketRangesFlagged: number;
}

/**
 * Wireframe Gap #9: Én oppsummert pending-cashout-rad for UI-modalen
 * "View Cashout Details". Holdes som egen type fra PT4-store-raden fordi UI
 * bare trenger et subset (dato, pattern, beløp, player-ref).
 */
export interface PendingCashoutSummary {
  id: string;
  ticketId: string;
  hallId: string;
  scheduledGameId: string;
  patternPhase: string;
  expectedPayoutCents: number;
  color: string;
  detectedAt: string;
  verifiedAt: string | null;
  adminApprovalRequired: boolean;
}

/**
 * Wireframe Gap #9 — Minimal read/write-port mot
 * `app_physical_ticket_pending_payouts`. Holder AgentShiftService
 * avkoblet fra PT4-storen. Null-implementasjon = logout blir no-op for
 * cashouts.
 */
export interface ShiftPendingPayoutPort {
  /** List ikke-utbetalte pending payouts for en gitt ansvarlig agent. */
  listPendingForAgent(agentUserId: string): Promise<PendingCashoutSummary[]>;
  /**
   * Flagg alle åpne pending payouts for en gitt agent som tilgjengelige for
   * neste agent (`pending_for_next_agent = true`). Returner antallet rader
   * som faktisk ble oppdatert.
   */
  markPendingForNextAgent(agentUserId: string): Promise<number>;
}

/**
 * Wireframe Gap #9 — Minimal port mot `app_agent_ticket_ranges` for å
 * flagge åpne ranges for overtagelse. Null-implementasjon = transfer-flag
 * blir no-op for ranges.
 */
export interface ShiftTicketRangePort {
  /**
   * Flagg alle åpne (closed_at IS NULL) ticket-ranges for en gitt agent som
   * `transfer_to_next_agent = true`. Returner antall oppdaterte rader.
   */
  markRangesForTransfer(agentUserId: string): Promise<number>;
}

export interface AgentShiftServiceDeps {
  agentStore: AgentStore;
  agentService: AgentService;
  /**
   * Wireframe Gap #9: valgfri port til pending-cashout-store. Hvis ikke
   * injisert blir logout.distributeWinnings = true fortsatt satt på
   * shiften, men child-tabell oppdateres ikke (log-only). Brukes i tester
   * som ikke spinner opp PT4-grafen.
   */
  pendingPayoutPort?: ShiftPendingPayoutPort;
  /**
   * Wireframe Gap #9: valgfri port til agent-ticket-range-store. Hvis ikke
   * injisert blir logout.transferRegisterTickets = true fortsatt satt på
   * shiften, men range-tabell oppdateres ikke (log-only).
   */
  ticketRangePort?: ShiftTicketRangePort;
}

export class AgentShiftService {
  private readonly store: AgentStore;
  private readonly agents: AgentService;
  private readonly pendingPayoutPort: ShiftPendingPayoutPort | null;
  private readonly ticketRangePort: ShiftTicketRangePort | null;

  constructor(deps: AgentShiftServiceDeps) {
    this.store = deps.agentStore;
    this.agents = deps.agentService;
    this.pendingPayoutPort = deps.pendingPayoutPort ?? null;
    this.ticketRangePort = deps.ticketRangePort ?? null;
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
   *
   * Wireframe Gap #9: `input.flags` er valgfri; uten flags = legacy-oppførsel.
   * For full logout-flyt med checkbox-effekter (flagging av pending cashouts
   * + ticket-ranges), bruk {@link logout} istedenfor endShift direkte.
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
    // PR #522 hotfix: hvis ADMIN force-closer en annen agent's shift,
    // krev en audit-reason og lagre i logoutNotes for sporbarhet.
    let flags = input.flags;
    if (isAdmin && !isOwner) {
      const reasonText = (input.reason ?? "").trim();
      if (reasonText.length === 0) {
        throw new DomainError(
          "FORCE_CLOSE_REASON_REQUIRED",
          "Force-close av en annen agent's shift krever en begrunnelse."
        );
      }
      flags = {
        ...(input.flags ?? {}),
        logoutNotes: `[ADMIN_FORCE_CLOSE by ${input.actor.userId}] ${reasonText}`,
      };
    }
    return this.store.endShift(shift.id, flags);
  }

  /**
   * Wireframe Gap #9: full Shift Log Out-flyt. Avslutter aktiv shift for
   * agenten med valgfrie flagg, og — hvis flagget er satt — oppdaterer
   * pending-cashouts / ticket-ranges for overtagelse av neste agent.
   *
   * Returnerer shiften + counts for audit/UI-rapport. Backwards-compat:
   * uten flags = samme effekt som endShift-owner-flyt.
   */
  async logout(
    agentUserId: string,
    flags: LogoutFlags = {}
  ): Promise<LogoutResult> {
    const active = await this.store.getActiveShiftForUser(agentUserId);
    if (!active) {
      throw new DomainError("NO_ACTIVE_SHIFT", "Du har ingen aktiv shift.");
    }
    // Avslutt først med flags — oppdaterer shift-rad atomisk.
    const shift = await this.store.endShift(active.id, flags);

    // Flagg pending cashouts hvis sikring er valgt. Port-null = log-only.
    let pendingCashoutsFlagged = 0;
    if (flags.distributeWinnings === true && this.pendingPayoutPort) {
      pendingCashoutsFlagged = await this.pendingPayoutPort.markPendingForNextAgent(agentUserId);
    }

    // Flagg åpne ticket-ranges hvis sikring er valgt. Port-null = log-only.
    let ticketRangesFlagged = 0;
    if (flags.transferRegisterTickets === true && this.ticketRangePort) {
      ticketRangesFlagged = await this.ticketRangePort.markRangesForTransfer(agentUserId);
    }

    return { shift, pendingCashoutsFlagged, ticketRangesFlagged };
  }

  /**
   * Wireframe Gap #9: List pending cashouts for "View Cashout Details"-modal
   * i logout-popupen. Returnerer åpne (ikke-utbetalt, ikke-rejected) rader
   * agenten er ansvarlig for. Port-null ⇒ tom liste.
   */
  async listPendingCashouts(agentUserId: string): Promise<PendingCashoutSummary[]> {
    if (!this.pendingPayoutPort) return [];
    return this.pendingPayoutPort.listPendingForAgent(agentUserId);
  }

  /**
   * Pilot-day-fix 2026-05-01: kjør logout-port-side-effects etter close-day.
   *
   * Close-day (markShiftSettled) setter is_active=false atomisk + persisterer
   * flag-kolonner — så denne metoden kjører kun port-callbacks
   * (markPendingForNextAgent / markRangesForTransfer). Skiller seg fra
   * `logout()` ved at den IKKE rører shift-raden (den er allerede settled).
   *
   * Fail-soft per port: hvis port ikke er injisert returneres count=0
   * (matcher pattern fra logout()). Caller (settlement-route) bruker tallene
   * til audit-logging.
   */
  async applyCloseDayLogoutSideEffects(
    agentUserId: string,
    flags: LogoutFlags
  ): Promise<{ pendingCashoutsFlagged: number; ticketRangesFlagged: number }> {
    let pendingCashoutsFlagged = 0;
    if (flags.distributeWinnings === true && this.pendingPayoutPort) {
      pendingCashoutsFlagged = await this.pendingPayoutPort.markPendingForNextAgent(agentUserId);
    }
    let ticketRangesFlagged = 0;
    if (flags.transferRegisterTickets === true && this.ticketRangePort) {
      ticketRangesFlagged = await this.ticketRangePort.markRangesForTransfer(agentUserId);
    }
    return { pendingCashoutsFlagged, ticketRangesFlagged };
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
