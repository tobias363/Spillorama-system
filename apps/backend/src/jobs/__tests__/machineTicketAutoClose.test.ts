/**
 * BIN-582: tests for the Metronia / OK Bingo daily auto-close cron.
 *
 * Covers:
 *   - Tickets older than maxAgeHours + is_closed=false → closed
 *   - Tickets younger than cutoff are left alone
 *   - Already-closed tickets are skipped (concurrent-close safety)
 *   - Compliance audit entry written per close
 *   - Per-ticket errors don't abort batch
 *   - Feature-flag OFF → scheduler does not execute
 *   - 42P01 from store → soft-no-op (dev without migrations)
 *   - Date-key guard prevents double-run same day
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  createMachineTicketAutoCloseJob,
  SYSTEM_AUTO_CLOSE_USER_ID,
} from "../machineTicketAutoClose.js";
import { createJobScheduler } from "../JobScheduler.js";
import type { MachineTicketStore, MachineTicket } from "../../agent/MachineTicketStore.js";
import type { MetroniaTicketService } from "../../agent/MetroniaTicketService.js";
import type { OkBingoTicketService } from "../../agent/OkBingoTicketService.js";
import type { AuditLogService } from "../../compliance/AuditLogService.js";
import { InMemoryAuditLogStore, AuditLogService as AuditLogServiceImpl } from "../../compliance/AuditLogService.js";
import { DomainError } from "../../game/BingoEngine.js";
import { logger as rootLogger } from "../../util/logger.js";

const silentLogger = rootLogger.child({ module: "test" });
silentLogger.level = "silent";

// ── Test harness ──────────────────────────────────────────────────────────

interface Recorder {
  metroniaCloseCalls: string[]; // ticket IDs passed
  okBingoCloseCalls: string[];
  /** Closure knobs to simulate different per-call outcomes. */
  throwOnMetroniaId?: string;
  throwOnOkBingoId?: string;
  errorFromMetronia?: Error;
  errorFromOkBingo?: Error;
}

function makeTicket(overrides: Partial<MachineTicket> & Pick<MachineTicket, "id" | "machineName" | "createdAt">): MachineTicket {
  return {
    id: overrides.id,
    machineName: overrides.machineName,
    ticketNumber: overrides.ticketNumber ?? `TN-${overrides.id}`,
    externalTicketId: overrides.externalTicketId ?? `EXT-${overrides.id}`,
    hallId: overrides.hallId ?? "hall-a",
    shiftId: overrides.shiftId ?? `shift-${overrides.id}`,
    agentUserId: overrides.agentUserId ?? "agent-1",
    playerUserId: overrides.playerUserId ?? "player-1",
    roomId: overrides.roomId ?? null,
    initialAmountCents: overrides.initialAmountCents ?? 10000,
    totalTopupCents: overrides.totalTopupCents ?? 0,
    currentBalanceCents: overrides.currentBalanceCents ?? 10000,
    payoutCents: overrides.payoutCents ?? null,
    isClosed: overrides.isClosed ?? false,
    closedAt: overrides.closedAt ?? null,
    closedByUserId: overrides.closedByUserId ?? null,
    voidAt: overrides.voidAt ?? null,
    voidByUserId: overrides.voidByUserId ?? null,
    voidReason: overrides.voidReason ?? null,
    uniqueTransaction: overrides.uniqueTransaction ?? `ut-${overrides.id}`,
    otherData: overrides.otherData ?? {},
    createdAt: overrides.createdAt,
    updatedAt: overrides.updatedAt ?? overrides.createdAt,
  };
}

/**
 * Minimal store-stub — bare det `list()` + `getById()` vi trenger. Øvrige
 * metoder kaster slik at eventuell utilsiktet bruk i cron-jobben avsløres.
 */
function makeTicketStore(seed: MachineTicket[]): MachineTicketStore {
  const byId = new Map<string, MachineTicket>(seed.map((t) => [t.id, t]));
  return {
    async insert() { throw new Error("not used"); },
    async getById(id) { return byId.get(id) ?? null; },
    async getByTicketNumber() { throw new Error("not used"); },
    async list(filter) {
      const filtered = Array.from(byId.values()).filter((t) => {
        if (filter.machineName && t.machineName !== filter.machineName) return false;
        if (filter.isClosed !== undefined && t.isClosed !== filter.isClosed) return false;
        if (filter.toDate && t.createdAt > filter.toDate) return false;
        return true;
      });
      const limit = filter.limit ?? 200;
      return filtered.slice(0, limit);
    },
    async applyTopup() { throw new Error("not used"); },
    async markClosed() { throw new Error("not used"); },
    async markVoid() { throw new Error("not used"); },
  };
}

function makeServices(recorder: Recorder): {
  metroniaService: MetroniaTicketService;
  okBingoService: OkBingoTicketService;
} {
  // Vi bygger minimale service-stubs som bare implementerer `autoCloseTicket`;
  // casting til service-typen via `as unknown as` er trygt fordi cron-jobben
  // bare kaller akkurat den metoden.
  const metroniaService = {
    autoCloseTicket: async (input: { ticketId: string; systemActorUserId: string }) => {
      recorder.metroniaCloseCalls.push(input.ticketId);
      if (recorder.throwOnMetroniaId === input.ticketId) {
        throw recorder.errorFromMetronia ?? new Error("simulated metronia fail");
      }
      return makeTicket({
        id: input.ticketId,
        machineName: "METRONIA",
        isClosed: true,
        closedAt: new Date().toISOString(),
        closedByUserId: input.systemActorUserId,
        payoutCents: 0,
        createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
      });
    },
  } as unknown as MetroniaTicketService;

  const okBingoService = {
    autoCloseTicket: async (input: { ticketId: string; systemActorUserId: string }) => {
      recorder.okBingoCloseCalls.push(input.ticketId);
      if (recorder.throwOnOkBingoId === input.ticketId) {
        throw recorder.errorFromOkBingo ?? new Error("simulated okbingo fail");
      }
      return makeTicket({
        id: input.ticketId,
        machineName: "OK_BINGO",
        isClosed: true,
        closedAt: new Date().toISOString(),
        closedByUserId: input.systemActorUserId,
        payoutCents: 0,
        createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
      });
    },
  } as unknown as OkBingoTicketService;

  return { metroniaService, okBingoService };
}

function makeAuditService(): {
  auditLogService: AuditLogService;
  store: InMemoryAuditLogStore;
} {
  const store = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogServiceImpl(store);
  return { auditLogService, store };
}

// ── Tests ─────────────────────────────────────────────────────────────────

test("machine-ticket-auto-close: lukker gamle (>24h) tickets og hopper over ferske", async () => {
  const nowMs = Date.now();
  const oldTicket = makeTicket({
    id: "old-m", machineName: "METRONIA",
    createdAt: new Date(nowMs - 25 * 60 * 60 * 1000).toISOString(),
  });
  const freshTicket = makeTicket({
    id: "fresh-m", machineName: "METRONIA",
    createdAt: new Date(nowMs - 1 * 60 * 60 * 1000).toISOString(),
  });
  const oldOkBingo = makeTicket({
    id: "old-o", machineName: "OK_BINGO",
    createdAt: new Date(nowMs - 30 * 60 * 60 * 1000).toISOString(),
  });

  const recorder: Recorder = { metroniaCloseCalls: [], okBingoCloseCalls: [] };
  const { metroniaService, okBingoService } = makeServices(recorder);
  const { auditLogService, store } = makeAuditService();
  const job = createMachineTicketAutoCloseJob({
    machineTicketStore: makeTicketStore([oldTicket, freshTicket, oldOkBingo]),
    metroniaService, okBingoService, auditLogService,
    alwaysRun: true,
  });

  const result = await job(nowMs);

  assert.deepEqual(recorder.metroniaCloseCalls, ["old-m"], "kun gamle Metronia-billetter lukkes");
  assert.deepEqual(recorder.okBingoCloseCalls, ["old-o"], "kun gamle OK Bingo-billetter lukkes");
  assert.equal(result.itemsProcessed, 2);
  assert.match(result.note ?? "", /metronia: scanned=1 closed=1/);
  assert.match(result.note ?? "", /okBingo: scanned=1 closed=1/);

  // Audit-entry per close.
  const events = await store.list({ action: "system.machine_ticket.auto_close" });
  assert.equal(events.length, 2, "skal skrive én audit-entry per close");
  assert.equal(events[0]?.actorType, "SYSTEM");
  assert.equal(events[0]?.resource, "machine_ticket");
  assert.ok(
    events.map((e) => e.resourceId).sort().every((id) => ["old-m", "old-o"].includes(id ?? "")),
    "audit entries peker på de korrekte ticket-IDene"
  );
});

test("machine-ticket-auto-close: hopper over tickets uten shift_id (men lukker dem fortsatt)", async () => {
  const nowMs = Date.now();
  // Ticket uten shift_id er fortsatt gyldig — DB sette shift_id=NULL ved ON DELETE.
  const ticket = makeTicket({
    id: "no-shift", machineName: "METRONIA",
    shiftId: null,
    createdAt: new Date(nowMs - 48 * 60 * 60 * 1000).toISOString(),
  });

  const recorder: Recorder = { metroniaCloseCalls: [], okBingoCloseCalls: [] };
  const { metroniaService, okBingoService } = makeServices(recorder);
  const { auditLogService } = makeAuditService();
  const job = createMachineTicketAutoCloseJob({
    machineTicketStore: makeTicketStore([ticket]),
    metroniaService, okBingoService, auditLogService,
    alwaysRun: true,
  });

  const result = await job(nowMs);
  assert.deepEqual(recorder.metroniaCloseCalls, ["no-shift"]);
  assert.equal(result.itemsProcessed, 1);
});

test("machine-ticket-auto-close: MACHINE_TICKET_CLOSED fra service teller som alreadyClosed (ikke error)", async () => {
  const nowMs = Date.now();
  const ticket = makeTicket({
    id: "raced-m", machineName: "METRONIA",
    createdAt: new Date(nowMs - 48 * 60 * 60 * 1000).toISOString(),
  });

  const recorder: Recorder = {
    metroniaCloseCalls: [],
    okBingoCloseCalls: [],
    throwOnMetroniaId: "raced-m",
    errorFromMetronia: new DomainError("MACHINE_TICKET_CLOSED", "raced"),
  };
  const { metroniaService, okBingoService } = makeServices(recorder);
  const { auditLogService, store } = makeAuditService();
  const job = createMachineTicketAutoCloseJob({
    machineTicketStore: makeTicketStore([ticket]),
    metroniaService, okBingoService, auditLogService,
    alwaysRun: true,
  });

  const result = await job(nowMs);
  assert.equal(result.itemsProcessed, 1, "alreadyClosed teller mot total");
  assert.match(result.note ?? "", /metronia: scanned=1 closed=0 alreadyClosed=1 errors=0/);

  const events = await store.list();
  assert.equal(events.length, 0, "alreadyClosed skriver ikke audit — ingen endring gjort");
});

test("machine-ticket-auto-close: andre feil fanges + audit-entry for failure", async () => {
  const nowMs = Date.now();
  const t1 = makeTicket({
    id: "fail-m", machineName: "METRONIA",
    createdAt: new Date(nowMs - 48 * 60 * 60 * 1000).toISOString(),
  });
  const t2 = makeTicket({
    id: "ok-m", machineName: "METRONIA",
    createdAt: new Date(nowMs - 48 * 60 * 60 * 1000).toISOString(),
  });

  const recorder: Recorder = {
    metroniaCloseCalls: [],
    okBingoCloseCalls: [],
    throwOnMetroniaId: "fail-m",
    errorFromMetronia: new Error("network down"),
  };
  const { metroniaService, okBingoService } = makeServices(recorder);
  const { auditLogService, store } = makeAuditService();
  const job = createMachineTicketAutoCloseJob({
    machineTicketStore: makeTicketStore([t1, t2]),
    metroniaService, okBingoService, auditLogService,
    alwaysRun: true,
  });

  const result = await job(nowMs);
  assert.equal(result.itemsProcessed, 1, "kun den vellykkede telles mot total");
  assert.match(result.note ?? "", /metronia: scanned=2 closed=1 alreadyClosed=0 errors=1/);

  const successEvents = await store.list({ action: "system.machine_ticket.auto_close" });
  const failEvents = await store.list({ action: "system.machine_ticket.auto_close_failed" });
  assert.equal(successEvents.length, 1);
  assert.equal(failEvents.length, 1);
  assert.equal(failEvents[0]?.resourceId, "fail-m");
});

test("machine-ticket-auto-close: per-hall-telling i note", async () => {
  const nowMs = Date.now();
  const oldIso = () => new Date(nowMs - 48 * 60 * 60 * 1000).toISOString();
  const tickets = [
    makeTicket({ id: "a1", machineName: "METRONIA", hallId: "hall-a", createdAt: oldIso() }),
    makeTicket({ id: "a2", machineName: "METRONIA", hallId: "hall-a", createdAt: oldIso() }),
    makeTicket({ id: "b1", machineName: "OK_BINGO", hallId: "hall-b", createdAt: oldIso() }),
  ];

  const recorder: Recorder = { metroniaCloseCalls: [], okBingoCloseCalls: [] };
  const { metroniaService, okBingoService } = makeServices(recorder);
  const { auditLogService } = makeAuditService();
  const job = createMachineTicketAutoCloseJob({
    machineTicketStore: makeTicketStore(tickets),
    metroniaService, okBingoService, auditLogService,
    alwaysRun: true,
  });

  const result = await job(nowMs);
  assert.equal(result.itemsProcessed, 3);
  assert.match(result.note ?? "", /hall-a\(m=2,o=0\)/);
  assert.match(result.note ?? "", /hall-b\(m=0,o=1\)/);
});

test("machine-ticket-auto-close: 42P01 fra store → soft-no-op", async () => {
  const nowMs = Date.now();
  const failingStore: MachineTicketStore = {
    async insert() { throw new Error("not used"); },
    async getById() { return null; },
    async getByTicketNumber() { return null; },
    async list() {
      const err: Error & { code?: string } = new Error("relation \"app_machine_tickets\" does not exist");
      err.code = "42P01";
      throw err;
    },
    async applyTopup() { throw new Error("not used"); },
    async markClosed() { throw new Error("not used"); },
    async markVoid() { throw new Error("not used"); },
  };

  const recorder: Recorder = { metroniaCloseCalls: [], okBingoCloseCalls: [] };
  const { metroniaService, okBingoService } = makeServices(recorder);
  const { auditLogService } = makeAuditService();
  const job = createMachineTicketAutoCloseJob({
    machineTicketStore: failingStore,
    metroniaService, okBingoService, auditLogService,
    alwaysRun: true,
  });

  const result = await job(nowMs);
  assert.equal(result.itemsProcessed, 0);
  assert.match(result.note ?? "", /table missing/);
});

test("machine-ticket-auto-close: date-key-guard hindrer dobbel-kjøring samme dag", async () => {
  const nowMs = Date.UTC(2026, 3, 23, 3, 0, 0); // 03:00 UTC samme dag
  const ticket = makeTicket({
    id: "g1", machineName: "METRONIA",
    createdAt: new Date(nowMs - 48 * 60 * 60 * 1000).toISOString(),
  });

  const recorder: Recorder = { metroniaCloseCalls: [], okBingoCloseCalls: [] };
  const { metroniaService, okBingoService } = makeServices(recorder);
  const { auditLogService } = makeAuditService();
  const job = createMachineTicketAutoCloseJob({
    machineTicketStore: makeTicketStore([ticket]),
    metroniaService, okBingoService, auditLogService,
    // alwaysRun: false (default) — respekter date-key
  });

  // Første kall — kjører.
  const r1 = await job(nowMs);
  assert.equal(r1.itemsProcessed, 1);
  assert.equal(recorder.metroniaCloseCalls.length, 1);

  // Andre kall samme dag — skal hoppes over (noten må matche).
  const r2 = await job(nowMs + 60 * 60 * 1000); // +1h samme dag
  assert.equal(r2.itemsProcessed, 0);
  assert.match(r2.note ?? "", /already ran today/);
  assert.equal(recorder.metroniaCloseCalls.length, 1, "skal ikke ha ringt service igjen");
});

test("machine-ticket-auto-close: hour-guard venter når runAtHour > current-hour", async () => {
  // 03:00 UTC 2026-04-23 — bruk lokal tid via Date (test kjører i den lokale
  // tidssonen, men getHours() returnerer lokal-timer uansett). For å gjøre
  // testen determinsitisk bruker vi alltid current Date som input.
  const localMidnight = new Date();
  localMidnight.setHours(2, 0, 0, 0); // 02:00 lokal
  const nowMs = localMidnight.getTime();

  const ticket = makeTicket({
    id: "g1", machineName: "METRONIA",
    createdAt: new Date(nowMs - 48 * 60 * 60 * 1000).toISOString(),
  });

  const recorder: Recorder = { metroniaCloseCalls: [], okBingoCloseCalls: [] };
  const { metroniaService, okBingoService } = makeServices(recorder);
  const { auditLogService } = makeAuditService();
  const job = createMachineTicketAutoCloseJob({
    machineTicketStore: makeTicketStore([ticket]),
    metroniaService, okBingoService, auditLogService,
    runAtHourLocal: 5, // skal vente til kl. 05 lokal; 02 < 05 → wait
  });

  const r = await job(nowMs);
  assert.equal(r.itemsProcessed, 0);
  assert.match(r.note ?? "", /waiting for 5:00 local/);
  assert.equal(recorder.metroniaCloseCalls.length, 0);
});

test("machine-ticket-auto-close: bruker SYSTEM_AUTO_CLOSE_USER_ID som systemActorUserId", async () => {
  const nowMs = Date.now();
  const ticket = makeTicket({
    id: "sys-1", machineName: "METRONIA",
    createdAt: new Date(nowMs - 48 * 60 * 60 * 1000).toISOString(),
  });

  const recorder: Recorder = { metroniaCloseCalls: [], okBingoCloseCalls: [] };
  let capturedSystemActor: string | null = null;
  const metroniaService = {
    autoCloseTicket: async (input: { ticketId: string; systemActorUserId: string }) => {
      recorder.metroniaCloseCalls.push(input.ticketId);
      capturedSystemActor = input.systemActorUserId;
      return makeTicket({
        id: input.ticketId, machineName: "METRONIA",
        isClosed: true,
        createdAt: ticket.createdAt,
      });
    },
  } as unknown as MetroniaTicketService;
  const { okBingoService } = makeServices(recorder);
  const { auditLogService } = makeAuditService();
  const job = createMachineTicketAutoCloseJob({
    machineTicketStore: makeTicketStore([ticket]),
    metroniaService, okBingoService, auditLogService,
    alwaysRun: true,
  });

  await job(nowMs);
  assert.equal(capturedSystemActor, SYSTEM_AUTO_CLOSE_USER_ID);
});

test("machine-ticket-auto-close: JobScheduler harness — feature-flag OFF hopper over job", async () => {
  const recorder: Recorder = { metroniaCloseCalls: [], okBingoCloseCalls: [] };
  const { metroniaService, okBingoService } = makeServices(recorder);
  const { auditLogService } = makeAuditService();
  const scheduler = createJobScheduler({ enabled: true, logger: silentLogger });
  scheduler.register({
    name: "machine-ticket-auto-close-test-off",
    description: "test",
    intervalMs: 60_000,
    enabled: false, // feature-flag OFF
    run: createMachineTicketAutoCloseJob({
      machineTicketStore: makeTicketStore([]),
      metroniaService, okBingoService, auditLogService,
      alwaysRun: true,
    }),
  });
  scheduler.start();
  await new Promise((r) => setTimeout(r, 10));
  scheduler.stop();
  assert.equal(recorder.metroniaCloseCalls.length, 0);
});
