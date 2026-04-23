/**
 * BIN-582: Metronia / OK Bingo daily `autoCloseTicket` cron.
 *
 * Legacy `Boot/Server.js:583–618` kjørte en daglig 00:00-CronJob som bl.a.
 * gjorde:
 *   autoCloseTicket('Metronia')
 *   autoCloseTicket('OK Bingo')
 *
 * Formål: agent kan glemme å lukke en ticket før shift-slutt. Legacy
 * sikret at maskinen starter fri dag ved å auto-lukke alle åpne billetter
 * fra forrige driftsdøgn. Ny stack har manuell close-ticket via agent-POS,
 * men ingen automatisk daglig cron — dette fyller gapet (§6.1 #3 i
 * BACKEND_PARITY_AUDIT_2026-04-23).
 *
 * Design (speiler `selfExclusionCleanup.ts`):
 *   - Polling-intervall (default 15 min) + date-key — jobben kjører kun
 *     én gang per kalendrisk døgn etter `runAtHourLocal` (default 00).
 *   - Scanner `app_machine_tickets.list({ isClosed: false, toDate: cutoff })`
 *     der cutoff = now - maxTicketAgeHours (default 24). Dvs. billetter
 *     opprettet for MER enn 24h siden som fortsatt er åpne.
 *   - Per ticket: kall `autoCloseTicket()` på tilhørende service (Metronia
 *     eller OK Bingo). Wallet credit + DB mark-closed + audit-log
 *     håndteres der — jobben bare orkestrerer.
 *   - Compliance-audit-entry per lukking (action `system.machine_ticket.auto_close`).
 *   - Fail-tolerant: per-ticket-feil logges og telles, men avbryter ikke
 *     resten av batchen.
 *
 * Idempotency:
 *   - `autoCloseTicket()` bruker `uniqueTransaction` med suffix `:auto`
 *     slik at dobbelt-trigger (f.eks. multi-instance uten Redis-lock)
 *     ikke trigger dobbel ekstern-API-kall.
 *   - Date-key-guard hindrer dobbel-kjøring samme dag fra SAMME instans.
 *   - `MACHINE_TICKET_CLOSED` fra service behandles som "allerede lukket
 *     av noen annen" og telles som `alreadyClosed` (ikke error).
 *
 * Multi-instans: Når `SCHEDULER_LOCK_PROVIDER=redis` guard-er
 * JobScheduler per-tick med Redis-lock (samme som andre jobber).
 */

import { randomUUID } from "node:crypto";
import type { JobResult } from "./JobScheduler.js";
import type { MachineTicket, MachineTicketStore } from "../agent/MachineTicketStore.js";
import type { MetroniaTicketService } from "../agent/MetroniaTicketService.js";
import type { OkBingoTicketService } from "../agent/OkBingoTicketService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import { DomainError } from "../game/BingoEngine.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "job:machine-ticket-auto-close" });

/**
 * System-ID brukt som `closed_by_user_id` i app_machine_tickets når cron
 * lukker en ticket. Matcher mønsteret i legacy (dedikert system-entry,
 * ikke en ekte agent).
 */
export const SYSTEM_AUTO_CLOSE_USER_ID = "system:auto-close-cron";

export interface MachineTicketAutoCloseDeps {
  machineTicketStore: MachineTicketStore;
  metroniaService: MetroniaTicketService;
  okBingoService: OkBingoTicketService;
  auditLogService: AuditLogService;
  /** Preferred run-hour local time (legacy var 00:00). */
  runAtHourLocal?: number;
  /**
   * Kun lukk billetter eldre enn dette antall timer. Legacy var 24h
   * (billetter fra forrige driftsdøgn).
   */
  maxTicketAgeHours?: number;
  /** Øvre grense på billetter per tick (beskytter mot flom). */
  batchLimit?: number;
  /** Override for testing — hopper over date-key + hour-guards. */
  alwaysRun?: boolean;
}

interface PerMachineCounters {
  scanned: number;
  closed: number;
  alreadyClosed: number;
  errors: number;
}

export interface MachineTicketAutoCloseResult {
  metronia: PerMachineCounters;
  okBingo: PerMachineCounters;
  /** Per-hall breakdown for observerbarhet. */
  perHall: Record<string, { metronia: number; okBingo: number }>;
}

export function createMachineTicketAutoCloseJob(deps: MachineTicketAutoCloseDeps) {
  const runAtHour = deps.runAtHourLocal ?? 0;
  const maxAgeHours = deps.maxTicketAgeHours ?? 24;
  const batchLimit = deps.batchLimit ?? 200;
  let lastRunDateKey = "";

  function dateKey(nowMs: number): string {
    const d = new Date(nowMs);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  async function recordAudit(
    ticket: MachineTicket,
    closed: MachineTicket | null,
    err: unknown | null
  ): Promise<void> {
    // Fire-and-forget — same pattern som andre compliance-audit-writes.
    try {
      await deps.auditLogService.record({
        actorId: null, // system-initiert
        actorType: "SYSTEM",
        action: err ? "system.machine_ticket.auto_close_failed" : "system.machine_ticket.auto_close",
        resource: "machine_ticket",
        resourceId: ticket.id,
        details: {
          machineName: ticket.machineName,
          ticketNumber: ticket.ticketNumber,
          hallId: ticket.hallId,
          shiftId: ticket.shiftId,
          agentUserId: ticket.agentUserId,
          playerUserId: ticket.playerUserId,
          originalAgeMs: Date.now() - new Date(ticket.createdAt).getTime(),
          payoutCents: closed?.payoutCents ?? null,
          ...(err ? { errorMessage: String((err as Error)?.message ?? err) } : {}),
        },
        ipAddress: null,
        userAgent: "system:auto-close-cron",
      });
    } catch (auditErr) {
      log.warn({ err: auditErr, ticketId: ticket.id }, "audit record failed (continuing)");
    }
  }

  async function closeOne(
    ticket: MachineTicket,
    counters: PerMachineCounters,
    perHall: Record<string, { metronia: number; okBingo: number }>
  ): Promise<void> {
    counters.scanned++;
    try {
      const closed = ticket.machineName === "METRONIA"
        ? await deps.metroniaService.autoCloseTicket({
            ticketId: ticket.id,
            systemActorUserId: SYSTEM_AUTO_CLOSE_USER_ID,
          })
        : await deps.okBingoService.autoCloseTicket({
            ticketId: ticket.id,
            systemActorUserId: SYSTEM_AUTO_CLOSE_USER_ID,
          });
      counters.closed++;
      const hallEntry = perHall[ticket.hallId] ?? { metronia: 0, okBingo: 0 };
      if (ticket.machineName === "METRONIA") hallEntry.metronia++;
      else hallEntry.okBingo++;
      perHall[ticket.hallId] = hallEntry;

      await recordAudit(ticket, closed, null);

      log.info(
        {
          ticketId: ticket.id,
          ticketNumber: ticket.ticketNumber,
          machineName: ticket.machineName,
          hallId: ticket.hallId,
          payoutCents: closed.payoutCents,
        },
        "auto-closed hanging ticket"
      );
    } catch (err) {
      // Ticket kan allerede være lukket av en konkurrerende kall (manuell
      // close i siste sekund, eller forrige cron-instans). Telles separat.
      const code = err instanceof DomainError ? err.code : undefined;
      if (code === "MACHINE_TICKET_CLOSED") {
        counters.alreadyClosed++;
        log.info(
          { ticketId: ticket.id, ticketNumber: ticket.ticketNumber, machineName: ticket.machineName },
          "ticket was already closed by concurrent close — skipping"
        );
        return;
      }
      counters.errors++;
      log.warn(
        {
          err,
          ticketId: ticket.id,
          ticketNumber: ticket.ticketNumber,
          machineName: ticket.machineName,
          hallId: ticket.hallId,
        },
        "auto-close failed for ticket — will retry on next tick"
      );
      await recordAudit(ticket, null, err);
    }
  }

  async function runMachineTicketAutoClose(nowMs: number): Promise<JobResult> {
    const now = new Date(nowMs);
    const todayKey = dateKey(nowMs);

    if (!deps.alwaysRun) {
      if (runAtHour > 0 && now.getHours() < runAtHour) {
        return { itemsProcessed: 0, note: `waiting for ${runAtHour}:00 local` };
      }
      if (todayKey === lastRunDateKey) {
        return { itemsProcessed: 0, note: "already ran today" };
      }
    }

    // Cutoff for "billetter eldre enn maxAgeHours". Bruker ISO-streng slik
    // at både Postgres- og in-memory-store-implementasjonen matcher på
    // `created_at <= cutoff`.
    const cutoffMs = nowMs - maxAgeHours * 60 * 60 * 1000;
    const cutoff = new Date(cutoffMs).toISOString();

    const result: MachineTicketAutoCloseResult = {
      metronia: { scanned: 0, closed: 0, alreadyClosed: 0, errors: 0 },
      okBingo: { scanned: 0, closed: 0, alreadyClosed: 0, errors: 0 },
      perHall: {},
    };

    // Hent åpne billetter fra hver maskin-type separat; holder logikken
    // enkel og unngår å måtte merge felles resultat.
    let metroniaTickets: MachineTicket[];
    let okBingoTickets: MachineTicket[];
    try {
      metroniaTickets = await deps.machineTicketStore.list({
        machineName: "METRONIA",
        isClosed: false,
        toDate: cutoff,
        limit: batchLimit,
      });
      okBingoTickets = await deps.machineTicketStore.list({
        machineName: "OK_BINGO",
        isClosed: false,
        toDate: cutoff,
        limit: batchLimit,
      });
    } catch (err) {
      const code = (err as { code?: string } | null)?.code ?? "";
      if (code === "42P01") {
        // Tabell mangler i dev — holder scheduler stille.
        return { itemsProcessed: 0, note: "app_machine_tickets table missing" };
      }
      throw err;
    }

    for (const ticket of metroniaTickets) {
      await closeOne(ticket, result.metronia, result.perHall);
    }
    for (const ticket of okBingoTickets) {
      await closeOne(ticket, result.okBingo, result.perHall);
    }

    lastRunDateKey = todayKey;

    const total =
      result.metronia.closed + result.metronia.alreadyClosed +
      result.okBingo.closed + result.okBingo.alreadyClosed;
    const notes: string[] = [];
    notes.push(
      `metronia: scanned=${result.metronia.scanned} closed=${result.metronia.closed}`
        + ` alreadyClosed=${result.metronia.alreadyClosed} errors=${result.metronia.errors}`
    );
    notes.push(
      `okBingo: scanned=${result.okBingo.scanned} closed=${result.okBingo.closed}`
        + ` alreadyClosed=${result.okBingo.alreadyClosed} errors=${result.okBingo.errors}`
    );
    const hallSummary = Object.entries(result.perHall)
      .map(([hallId, c]) => `${hallId}(m=${c.metronia},o=${c.okBingo})`)
      .join(" ");
    if (hallSummary) notes.push(`halls: ${hallSummary}`);

    if (total > 0 || result.metronia.errors > 0 || result.okBingo.errors > 0) {
      log.info(
        {
          result,
          cutoff,
        },
        "machine-ticket auto-close batch complete"
      );
    }

    return {
      itemsProcessed: total,
      note: notes.join(" | "),
    };
  }

  // Eksponér ID-genereringsfabrikken via closure for enklere test-oppsett.
  // Ikke del av pub-kontrakten — bare for å ha en deterministisk hook om
  // nødvendig.
  Object.defineProperty(runMachineTicketAutoClose, "_newId", {
    value: (): string => `auto-close-${randomUUID()}`,
    enumerable: false,
  });

  return runMachineTicketAutoClose;
}
