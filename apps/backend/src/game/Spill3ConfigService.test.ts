/**
 * Spill 3 (monsterbingo) re-design 2026-05-08: unit-tester for
 * Spill3ConfigService.
 *
 * Tester at:
 *   - service-laget avviser ugyldig input (INVALID_INPUT)
 *   - prize-mode-konsistens håndheves (INVALID_CONFIG ved partial-update
 *     som etterlater inkonsistente felter)
 *   - cache-en respekterer TTL og invalideres ved update
 *   - audit-log skrives med før/etter-snapshot ved update
 *
 * Integrasjons-tester (mot real Postgres) håndteres separat.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  Spill3ConfigService,
  assertConfigConsistency,
  isWithinOpeningWindow,
  type Spill3Config,
} from "./Spill3ConfigService.js";
import { DomainError } from "../errors/DomainError.js";

// ── Test helpers ───────────────────────────────────────────────────────────

interface CapturedQuery {
  sql: string;
  params: unknown[] | undefined;
}

/**
 * Default-rad for percentage-modus — matcher migration-seed.
 * Brukes som "before"-state i alle update-tester.
 */
const DEFAULT_PERCENTAGE_ROW = {
  id: "spill3-default",
  min_tickets_to_start: 20,
  prize_mode: "percentage",
  prize_rad1_cents: null,
  prize_rad2_cents: null,
  prize_rad3_cents: null,
  prize_rad4_cents: null,
  prize_full_house_cents: null,
  prize_rad1_pct: "5.00",
  prize_rad2_pct: "8.00",
  prize_rad3_pct: "12.00",
  prize_rad4_pct: "15.00",
  prize_full_house_pct: "30.00",
  ticket_price_cents: 500,
  pause_between_rows_ms: 3000,
  opening_time_start: "11:00",
  opening_time_end: "23:00",
  active: true,
  created_at: "2026-05-08T00:00:00Z",
  updated_at: "2026-05-08T00:00:00Z",
  updated_by_user_id: null as string | null,
};

const DEFAULT_FIXED_ROW = {
  ...DEFAULT_PERCENTAGE_ROW,
  prize_mode: "fixed",
  prize_rad1_cents: 5000,
  prize_rad2_cents: 8000,
  prize_rad3_cents: 12000,
  prize_rad4_cents: 15000,
  prize_full_house_cents: 30000,
  prize_rad1_pct: null as string | null,
  prize_rad2_pct: null as string | null,
  prize_rad3_pct: null as string | null,
  prize_rad4_pct: null as string | null,
  prize_full_house_pct: null as string | null,
};

/**
 * Bygger en service med stub-pool som returnerer en fast rad (eller null)
 * og fanger alle UPDATE-spørringer for assertion.
 */
function makeServiceWithRow(
  initialRow: Record<string, unknown> | null,
  cacheTtlMs = 0,  // Default 0 — disabler cache for de fleste tester
): { service: Spill3ConfigService; queries: CapturedQuery[] } {
  const queries: CapturedQuery[] = [];
  let currentRow = initialRow;
  const stubPool = {
    async query(textOrConfig: unknown, params?: unknown[]): Promise<unknown> {
      const sql =
        typeof textOrConfig === "string"
          ? textOrConfig
          : (textOrConfig as { text: string }).text;
      queries.push({ sql, params });
      if (/^\s*SELECT/i.test(sql)) {
        return { rows: currentRow ? [currentRow] : [] };
      }
      // UPDATE: oppdater currentRow med nye verdier (forenklet — vi lar
      // den neste SELECT lese det vi nettopp skrev).
      if (/^\s*UPDATE/i.test(sql) && params && currentRow) {
        currentRow = {
          ...currentRow,
          min_tickets_to_start: params[1],
          prize_mode: params[2],
          prize_rad1_cents: params[3],
          prize_rad2_cents: params[4],
          prize_rad3_cents: params[5],
          prize_rad4_cents: params[6],
          prize_full_house_cents: params[7],
          prize_rad1_pct: params[8],
          prize_rad2_pct: params[9],
          prize_rad3_pct: params[10],
          prize_rad4_pct: params[11],
          prize_full_house_pct: params[12],
          ticket_price_cents: params[13],
          pause_between_rows_ms: params[14],
          opening_time_start: params[15],
          opening_time_end: params[16],
          updated_by_user_id: params[17],
        };
      }
      return { rowCount: 1, rows: [] };
    },
  };
  const service = Spill3ConfigService.forTesting(
    stubPool as never,
    "public",
    null,
    cacheTtlMs,
  );
  return { service, queries };
}

async function expectDomainError(
  label: string,
  fn: () => Promise<unknown>,
  expectedCode?: string,
): Promise<void> {
  try {
    await fn();
    assert.fail(`${label}: forventet DomainError men fikk success`);
  } catch (err) {
    if (!(err instanceof DomainError)) {
      assert.fail(
        `${label}: forventet DomainError, fikk ${err instanceof Error ? err.constructor.name : typeof err}: ${String(err)}`,
      );
    }
    if (expectedCode && err.code !== expectedCode) {
      assert.fail(
        `${label}: forventet DomainError(${expectedCode}), fikk DomainError(${err.code})`,
      );
    }
  }
}

// ── getActive() tester ─────────────────────────────────────────────────────

test("getActive: returnerer parsed config fra DB-rad", async () => {
  const { service } = makeServiceWithRow(DEFAULT_PERCENTAGE_ROW);
  const config = await service.getActive();
  assert.equal(config.id, "spill3-default");
  assert.equal(config.prizeMode, "percentage");
  assert.equal(config.minTicketsToStart, 20);
  assert.equal(config.ticketPriceCents, 500);
  assert.equal(config.pauseBetweenRowsMs, 3000);
  assert.equal(config.prizeRad1Pct, 5);
  assert.equal(config.prizeFullHousePct, 30);
  assert.equal(config.prizeRad1Cents, null);
});

test("getActive: kaster CONFIG_MISSING når ingen aktiv rad finnes", async () => {
  const { service } = makeServiceWithRow(null);
  await expectDomainError(
    "getActive uten rad",
    () => service.getActive(),
    "CONFIG_MISSING",
  );
});

test("getActive: cache returnerer samme verdi innenfor TTL", async () => {
  const { service, queries } = makeServiceWithRow(DEFAULT_PERCENTAGE_ROW, 60_000);
  await service.getActive();
  await service.getActive();
  await service.getActive();
  // Kun ÉN SELECT-query (cache hit på de neste).
  const selectCount = queries.filter((q) => /^\s*SELECT/i.test(q.sql)).length;
  assert.equal(selectCount, 1);
});

test("getActive: invalidateCache() tvinger ny SELECT", async () => {
  const { service, queries } = makeServiceWithRow(DEFAULT_PERCENTAGE_ROW, 60_000);
  await service.getActive();
  service.invalidateCache();
  await service.getActive();
  const selectCount = queries.filter((q) => /^\s*SELECT/i.test(q.sql)).length;
  assert.equal(selectCount, 2);
});

// ── update() validering ────────────────────────────────────────────────────

test("update: avviser uten updatedByUserId", async () => {
  const { service } = makeServiceWithRow(DEFAULT_PERCENTAGE_ROW);
  await expectDomainError(
    "update uten actor",
    () => service.update({ updatedByUserId: "" }),
    "INVALID_INPUT",
  );
});

test("update: avviser ugyldig minTicketsToStart (negativ)", async () => {
  const { service } = makeServiceWithRow(DEFAULT_PERCENTAGE_ROW);
  await expectDomainError(
    "update minTicketsToStart=-1",
    () => service.update({ updatedByUserId: "u1", minTicketsToStart: -1 }),
    "INVALID_INPUT",
  );
});

test("update: avviser ugyldig minTicketsToStart (over max)", async () => {
  const { service } = makeServiceWithRow(DEFAULT_PERCENTAGE_ROW);
  await expectDomainError(
    "update minTicketsToStart=10000",
    () => service.update({ updatedByUserId: "u1", minTicketsToStart: 10000 }),
    "INVALID_INPUT",
  );
});

test("update: avviser ugyldig prizeMode", async () => {
  const { service } = makeServiceWithRow(DEFAULT_PERCENTAGE_ROW);
  await expectDomainError(
    "update prizeMode='invalid'",
    () =>
      service.update({
        updatedByUserId: "u1",
        prizeMode: "invalid" as never,
      }),
    "INVALID_INPUT",
  );
});

test("update: avviser pct > 100", async () => {
  const { service } = makeServiceWithRow(DEFAULT_PERCENTAGE_ROW);
  await expectDomainError(
    "update prizeRad1Pct=150",
    () => service.update({ updatedByUserId: "u1", prizeRad1Pct: 150 }),
    "INVALID_INPUT",
  );
});

test("update: avviser cents > absolutt cap", async () => {
  const { service } = makeServiceWithRow(DEFAULT_PERCENTAGE_ROW);
  await expectDomainError(
    "update prizeRad1Cents over cap",
    () =>
      service.update({
        updatedByUserId: "u1",
        prizeRad1Cents: 999_999_999,
      }),
    "INVALID_INPUT",
  );
});

test("update: avviser ticketPriceCents=0", async () => {
  const { service } = makeServiceWithRow(DEFAULT_PERCENTAGE_ROW);
  await expectDomainError(
    "update ticketPriceCents=0",
    () => service.update({ updatedByUserId: "u1", ticketPriceCents: 0 }),
    "INVALID_INPUT",
  );
});

test("update: avviser pauseBetweenRowsMs > 60s", async () => {
  const { service } = makeServiceWithRow(DEFAULT_PERCENTAGE_ROW);
  await expectDomainError(
    "update pauseBetweenRowsMs=70000",
    () =>
      service.update({
        updatedByUserId: "u1",
        pauseBetweenRowsMs: 70000,
      }),
    "INVALID_INPUT",
  );
});

// ── update() prize-mode konsistens ─────────────────────────────────────────

test("update: percentage-mode krever alle pct-felter", async () => {
  // Start fra fixed-rad, prøv å bytte til percentage uten å sette pct-felter.
  const { service } = makeServiceWithRow(DEFAULT_FIXED_ROW);
  await expectDomainError(
    "fixed→percentage uten pct",
    () =>
      service.update({
        updatedByUserId: "u1",
        prizeMode: "percentage",
      }),
    "INVALID_CONFIG",
  );
});

test("update: fixed-mode krever alle cents-felter", async () => {
  // Start fra percentage-rad, prøv å bytte til fixed uten å sette cents.
  const { service } = makeServiceWithRow(DEFAULT_PERCENTAGE_ROW);
  await expectDomainError(
    "percentage→fixed uten cents",
    () =>
      service.update({
        updatedByUserId: "u1",
        prizeMode: "fixed",
      }),
    "INVALID_CONFIG",
  );
});

test("update: prosent-sum > 100 avvises", async () => {
  const { service } = makeServiceWithRow(DEFAULT_PERCENTAGE_ROW);
  await expectDomainError(
    "pct-sum > 100",
    () =>
      service.update({
        updatedByUserId: "u1",
        prizeRad1Pct: 50,
        prizeRad2Pct: 50,
        prizeRad3Pct: 50,  // Sum: 50 + 50 + 50 + 15 + 30 = 195% > 100
      }),
    "INVALID_CONFIG",
  );
});

test("update: bytter fra percentage til fixed med komplett cents-sett", async () => {
  const { service } = makeServiceWithRow(DEFAULT_PERCENTAGE_ROW);
  const updated = await service.update({
    updatedByUserId: "admin-1",
    prizeMode: "fixed",
    prizeRad1Cents: 5000,
    prizeRad2Cents: 8000,
    prizeRad3Cents: 12000,
    prizeRad4Cents: 15000,
    prizeFullHouseCents: 30000,
  });
  assert.equal(updated.prizeMode, "fixed");
  assert.equal(updated.prizeRad1Cents, 5000);
  assert.equal(updated.prizeFullHouseCents, 30000);
});

test("update: oppdaterer kun minTicketsToStart uten å rote modus", async () => {
  const { service } = makeServiceWithRow(DEFAULT_PERCENTAGE_ROW);
  const updated = await service.update({
    updatedByUserId: "admin-1",
    minTicketsToStart: 50,
  });
  assert.equal(updated.minTicketsToStart, 50);
  assert.equal(updated.prizeMode, "percentage");
  // Pct-felter skal bevares.
  assert.equal(updated.prizeRad1Pct, 5);
});

test("update: oppdaterer pause-tid", async () => {
  const { service } = makeServiceWithRow(DEFAULT_PERCENTAGE_ROW);
  const updated = await service.update({
    updatedByUserId: "admin-1",
    pauseBetweenRowsMs: 5000,
  });
  assert.equal(updated.pauseBetweenRowsMs, 5000);
});

test("update: bongpris kan oppdateres", async () => {
  const { service } = makeServiceWithRow(DEFAULT_PERCENTAGE_ROW);
  const updated = await service.update({
    updatedByUserId: "admin-1",
    ticketPriceCents: 1000,  // 10 kr
  });
  assert.equal(updated.ticketPriceCents, 1000);
});

// ── assertConfigConsistency standalone ─────────────────────────────────────

test("assertConfigConsistency: percentage med null-pct kaster", () => {
  const config: Spill3Config = {
    id: "test",
    minTicketsToStart: 0,
    prizeMode: "percentage",
    prizeRad1Cents: null,
    prizeRad2Cents: null,
    prizeRad3Cents: null,
    prizeRad4Cents: null,
    prizeFullHouseCents: null,
    prizeRad1Pct: 5,
    prizeRad2Pct: 8,
    prizeRad3Pct: null,  // ← Mangler
    prizeRad4Pct: 15,
    prizeFullHousePct: 30,
    ticketPriceCents: 500,
    pauseBetweenRowsMs: 3000,
    openingTimeStart: "11:00",
    openingTimeEnd: "23:00",
    active: true,
    createdAt: "",
    updatedAt: "",
    updatedByUserId: null,
  };
  assert.throws(() => assertConfigConsistency(config), DomainError);
});

test("assertConfigConsistency: fixed med null-cents kaster", () => {
  const config: Spill3Config = {
    id: "test",
    minTicketsToStart: 0,
    prizeMode: "fixed",
    prizeRad1Cents: 1000,
    prizeRad2Cents: null,  // ← Mangler
    prizeRad3Cents: 1000,
    prizeRad4Cents: 1000,
    prizeFullHouseCents: 5000,
    prizeRad1Pct: null,
    prizeRad2Pct: null,
    prizeRad3Pct: null,
    prizeRad4Pct: null,
    prizeFullHousePct: null,
    ticketPriceCents: 500,
    pauseBetweenRowsMs: 3000,
    openingTimeStart: "11:00",
    openingTimeEnd: "23:00",
    active: true,
    createdAt: "",
    updatedAt: "",
    updatedByUserId: null,
  };
  assert.throws(() => assertConfigConsistency(config), DomainError);
});

test("assertConfigConsistency: percentage med komplett pct passerer", () => {
  const config: Spill3Config = {
    id: "test",
    minTicketsToStart: 20,
    prizeMode: "percentage",
    prizeRad1Cents: null,
    prizeRad2Cents: null,
    prizeRad3Cents: null,
    prizeRad4Cents: null,
    prizeFullHouseCents: null,
    prizeRad1Pct: 5,
    prizeRad2Pct: 8,
    prizeRad3Pct: 12,
    prizeRad4Pct: 15,
    prizeFullHousePct: 30,
    ticketPriceCents: 500,
    pauseBetweenRowsMs: 3000,
    openingTimeStart: "11:00",
    openingTimeEnd: "23:00",
    active: true,
    createdAt: "",
    updatedAt: "",
    updatedByUserId: null,
  };
  // Should NOT throw.
  assertConfigConsistency(config);
});

test("assertConfigConsistency: fixed med komplett cents passerer", () => {
  const config: Spill3Config = {
    id: "test",
    minTicketsToStart: 0,
    prizeMode: "fixed",
    prizeRad1Cents: 5000,
    prizeRad2Cents: 8000,
    prizeRad3Cents: 12000,
    prizeRad4Cents: 15000,
    prizeFullHouseCents: 30000,
    prizeRad1Pct: null,
    prizeRad2Pct: null,
    prizeRad3Pct: null,
    prizeRad4Pct: null,
    prizeFullHousePct: null,
    ticketPriceCents: 500,
    pauseBetweenRowsMs: 3000,
    openingTimeStart: "11:00",
    openingTimeEnd: "23:00",
    active: true,
    createdAt: "",
    updatedAt: "",
    updatedByUserId: null,
  };
  assertConfigConsistency(config);
});

// ── audit-log integrasjon ──────────────────────────────────────────────────

test("update: skriver audit-log-event med før/etter-snapshot", async () => {
  const auditEvents: Array<{ action: string; details: unknown }> = [];
  const auditStub = {
    record: async (input: { action: string; details: unknown }) => {
      auditEvents.push({ action: input.action, details: input.details });
    },
  };
  const { service } = makeServiceWithRow(DEFAULT_PERCENTAGE_ROW);
  service.setAuditLogService(auditStub as never);

  await service.update({
    updatedByUserId: "admin-1",
    minTicketsToStart: 100,
  });

  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0]!.action, "spill3.config.update");
  const details = auditEvents[0]!.details as {
    before: { minTicketsToStart: number };
    after: { minTicketsToStart: number };
    changedFields: string[];
  };
  assert.equal(details.before.minTicketsToStart, 20);
  assert.equal(details.after.minTicketsToStart, 100);
  assert.deepEqual(details.changedFields, ["minTicketsToStart"]);
});

test("update: audit-log-feil blokkerer ikke caller", async () => {
  const auditStub = {
    record: async () => {
      throw new Error("audit-log down");
    },
  };
  const { service } = makeServiceWithRow(DEFAULT_PERCENTAGE_ROW);
  service.setAuditLogService(auditStub as never);

  // Skal IKKE kaste — audit-feil er best-effort.
  const updated = await service.update({
    updatedByUserId: "admin-1",
    minTicketsToStart: 99,
  });
  assert.equal(updated.minTicketsToStart, 99);
});

// ── opening time tester (Tobias-direktiv 2026-05-08) ──────────────────────

test("getActive: returnerer opening-time-felter med default-vinduet", async () => {
  const { service } = makeServiceWithRow(DEFAULT_PERCENTAGE_ROW);
  const config = await service.getActive();
  assert.equal(config.openingTimeStart, "11:00");
  assert.equal(config.openingTimeEnd, "23:00");
});

test("getActive: faller tilbake til default ved NULL i DB-rad", async () => {
  // Pre-migrasjons-rad: opening_time_start/end er null. Service-laget
  // skal bruke DEFAULT_OPENING_TIME_START/END.
  const legacyRow = {
    ...DEFAULT_PERCENTAGE_ROW,
    opening_time_start: null,
    opening_time_end: null,
  };
  const { service } = makeServiceWithRow(legacyRow);
  const config = await service.getActive();
  assert.equal(config.openingTimeStart, "11:00");
  assert.equal(config.openingTimeEnd, "23:00");
});

test("update: aksepterer gyldige opening-times", async () => {
  const { service } = makeServiceWithRow(DEFAULT_PERCENTAGE_ROW);
  const updated = await service.update({
    updatedByUserId: "admin-1",
    openingTimeStart: "09:00",
    openingTimeEnd: "22:30",
  });
  assert.equal(updated.openingTimeStart, "09:00");
  assert.equal(updated.openingTimeEnd, "22:30");
});

test("update: avviser ugyldig HH:MM-format", async () => {
  const { service } = makeServiceWithRow(DEFAULT_PERCENTAGE_ROW);
  await expectDomainError(
    "update openingTimeStart='25:00'",
    () =>
      service.update({
        updatedByUserId: "admin-1",
        openingTimeStart: "25:00",
      }),
    "INVALID_INPUT",
  );
  await expectDomainError(
    "update openingTimeEnd='9:0'",
    () =>
      service.update({
        updatedByUserId: "admin-1",
        openingTimeEnd: "9:0",
      }),
    "INVALID_INPUT",
  );
  await expectDomainError(
    "update openingTimeStart='abc'",
    () =>
      service.update({
        updatedByUserId: "admin-1",
        openingTimeStart: "abc",
      }),
    "INVALID_INPUT",
  );
});

test("update: avviser start >= end (samme dag, ingen midnatt-wraparound)", async () => {
  const { service } = makeServiceWithRow(DEFAULT_PERCENTAGE_ROW);
  await expectDomainError(
    "start=22:00, end=10:00",
    () =>
      service.update({
        updatedByUserId: "admin-1",
        openingTimeStart: "22:00",
        openingTimeEnd: "10:00",
      }),
    "INVALID_CONFIG",
  );
  await expectDomainError(
    "start=12:00, end=12:00 (lik)",
    () =>
      service.update({
        updatedByUserId: "admin-1",
        openingTimeStart: "12:00",
        openingTimeEnd: "12:00",
      }),
    "INVALID_CONFIG",
  );
});

test("isWithinOpeningWindow: midt på dagen i åpent vindu = true", () => {
  // 14:00 UTC = 16:00 Oslo (sommer) eller 15:00 Oslo (vinter). Begge er
  // innenfor [11:00, 23:00).
  const config = { openingTimeStart: "11:00", openingTimeEnd: "23:00" };
  // Et tydelig sommer-tidspunkt: 2026-07-01T14:00:00Z = 16:00 Oslo (DST).
  assert.equal(
    isWithinOpeningWindow(config, new Date("2026-07-01T14:00:00Z")),
    true,
  );
});

test("isWithinOpeningWindow: før vinduet (06:00 Oslo) = false", () => {
  const config = { openingTimeStart: "11:00", openingTimeEnd: "23:00" };
  // 04:00Z = 06:00 Oslo (sommer) — før 11:00 → false.
  assert.equal(
    isWithinOpeningWindow(config, new Date("2026-07-01T04:00:00Z")),
    false,
  );
});

test("isWithinOpeningWindow: etter vinduet (23:30 Oslo) = false", () => {
  const config = { openingTimeStart: "11:00", openingTimeEnd: "23:00" };
  // 21:30Z = 23:30 Oslo (sommer) — etter 23:00 → false.
  assert.equal(
    isWithinOpeningWindow(config, new Date("2026-07-01T21:30:00Z")),
    false,
  );
});

test("isWithinOpeningWindow: ekskluderende endpoint (23:00 Oslo selv) = false", () => {
  const config = { openingTimeStart: "11:00", openingTimeEnd: "23:00" };
  // 21:00Z = 23:00 Oslo (sommer) — endpoint er eksklusiv → false.
  assert.equal(
    isWithinOpeningWindow(config, new Date("2026-07-01T21:00:00Z")),
    false,
  );
});

test("isWithinOpeningWindow: inklusiv start-endpoint (11:00 Oslo selv) = true", () => {
  const config = { openingTimeStart: "11:00", openingTimeEnd: "23:00" };
  // 09:00Z = 11:00 Oslo (sommer) — start-endpoint inkluderes → true.
  assert.equal(
    isWithinOpeningWindow(config, new Date("2026-07-01T09:00:00Z")),
    true,
  );
});

test("update: opening-times skrives til audit-log changedFields", async () => {
  const auditEvents: Array<{ action: string; details: unknown }> = [];
  const auditStub = {
    record: async (input: { action: string; details: unknown }) => {
      auditEvents.push({ action: input.action, details: input.details });
    },
  };
  const { service } = makeServiceWithRow(DEFAULT_PERCENTAGE_ROW);
  service.setAuditLogService(auditStub as never);
  await service.update({
    updatedByUserId: "admin-1",
    openingTimeStart: "10:00",
    openingTimeEnd: "22:00",
  });
  assert.equal(auditEvents.length, 1);
  const details = auditEvents[0]!.details as {
    changedFields: string[];
    after: { openingTimeStart: string; openingTimeEnd: string };
  };
  assert.ok(details.changedFields.includes("openingTimeStart"));
  assert.ok(details.changedFields.includes("openingTimeEnd"));
  assert.equal(details.after.openingTimeStart, "10:00");
  assert.equal(details.after.openingTimeEnd, "22:00");
});
