/**
 * Spill 2 (rocket) re-design 2026-05-08: unit-tester for Spill2ConfigService.
 *
 * Speiler `Spill3ConfigService.test.ts` 1:1 (samme stub-pool-mønster, samme
 * test-suiter): cache, validering, åpningstid-format, jackpot-tabell-shape,
 * lucky-number-konsistens, og audit-log-integrasjon.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  Spill2ConfigService,
  assertConfigConsistency,
  assertJackpotTable,
  assertOpeningTime,
  isWithinOpeningHours,
  type Spill2Config,
  type Spill2JackpotTable,
} from "./Spill2ConfigService.js";
import { DomainError } from "../errors/DomainError.js";

// ── Test helpers ───────────────────────────────────────────────────────────

interface CapturedQuery {
  sql: string;
  params: unknown[] | undefined;
}

const DEFAULT_JACKPOT_TABLE: Spill2JackpotTable = {
  "9":    { price: 5000, isCash: true },
  "10":   { price: 2500, isCash: true },
  "11":   { price: 1000, isCash: true },
  "12":   { price: 100,  isCash: false },
  "13":   { price: 75,   isCash: false },
  "1421": { price: 50,   isCash: false },
};

/**
 * Default-rad — matcher migration-seed.
 * Brukes som "before"-state i alle update-tester.
 */
const DEFAULT_ROW = {
  id: "spill2-default",
  opening_time_start: null as string | null,
  opening_time_end: null as string | null,
  min_tickets_to_start: 5,
  ticket_price_cents: 1000,
  round_pause_ms: 60000,
  ball_interval_ms: 4000,
  jackpot_number_table_json: DEFAULT_JACKPOT_TABLE,
  lucky_number_enabled: false,
  lucky_number_prize_cents: null as number | null,
  active: true,
  created_at: "2026-05-08T00:00:00Z",
  updated_at: "2026-05-08T00:00:00Z",
  updated_by_user_id: null as string | null,
};

const DEFAULT_ROW_WITH_HOURS = {
  ...DEFAULT_ROW,
  opening_time_start: "10:00",
  opening_time_end: "22:00",
};

/**
 * Bygger en service med stub-pool som returnerer en fast rad (eller null)
 * og fanger alle UPDATE-spørringer for assertion.
 */
function makeServiceWithRow(
  initialRow: Record<string, unknown> | null,
  cacheTtlMs = 0,
): { service: Spill2ConfigService; queries: CapturedQuery[] } {
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
      // UPDATE: oppdater currentRow med nye verdier.
      if (/^\s*UPDATE/i.test(sql) && params && currentRow) {
        currentRow = {
          ...currentRow,
          opening_time_start: params[1],
          opening_time_end: params[2],
          min_tickets_to_start: params[3],
          ticket_price_cents: params[4],
          round_pause_ms: params[5],
          ball_interval_ms: params[6],
          // params[7] er JSON-stringified — parse tilbake for SELECT.
          jackpot_number_table_json:
            typeof params[7] === "string" ? JSON.parse(params[7]) : params[7],
          lucky_number_enabled: params[8],
          lucky_number_prize_cents: params[9],
          updated_by_user_id: params[10],
        };
      }
      return { rowCount: 1, rows: [] };
    },
  };
  const service = Spill2ConfigService.forTesting(
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

test("getActive: returnerer parsed config fra DB-rad (default)", async () => {
  const { service } = makeServiceWithRow(DEFAULT_ROW);
  const config = await service.getActive();
  assert.equal(config.id, "spill2-default");
  assert.equal(config.minTicketsToStart, 5);
  assert.equal(config.ticketPriceCents, 1000);
  assert.equal(config.roundPauseMs, 60000);
  assert.equal(config.ballIntervalMs, 4000);
  assert.equal(config.luckyNumberEnabled, false);
  assert.equal(config.luckyNumberPrizeCents, null);
  assert.equal(config.openingTimeStart, null);
  assert.equal(config.openingTimeEnd, null);
  assert.equal(config.jackpotNumberTable["9"]?.price, 5000);
  assert.equal(config.jackpotNumberTable["1421"]?.isCash, false);
});

test("getActive: returnerer åpningstider når satt", async () => {
  const { service } = makeServiceWithRow(DEFAULT_ROW_WITH_HOURS);
  const config = await service.getActive();
  assert.equal(config.openingTimeStart, "10:00");
  assert.equal(config.openingTimeEnd, "22:00");
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
  const { service, queries } = makeServiceWithRow(DEFAULT_ROW, 60_000);
  await service.getActive();
  await service.getActive();
  await service.getActive();
  const selectCount = queries.filter((q) => /^\s*SELECT/i.test(q.sql)).length;
  assert.equal(selectCount, 1);
});

test("getActive: invalidateCache() tvinger ny SELECT", async () => {
  const { service, queries } = makeServiceWithRow(DEFAULT_ROW, 60_000);
  await service.getActive();
  service.invalidateCache();
  await service.getActive();
  const selectCount = queries.filter((q) => /^\s*SELECT/i.test(q.sql)).length;
  assert.equal(selectCount, 2);
});

// ── update() validering ────────────────────────────────────────────────────

test("update: avviser uten updatedByUserId", async () => {
  const { service } = makeServiceWithRow(DEFAULT_ROW);
  await expectDomainError(
    "update uten actor",
    () => service.update({ updatedByUserId: "" }),
    "INVALID_INPUT",
  );
});

test("update: avviser ugyldig minTicketsToStart (negativ)", async () => {
  const { service } = makeServiceWithRow(DEFAULT_ROW);
  await expectDomainError(
    "update minTicketsToStart=-1",
    () => service.update({ updatedByUserId: "u1", minTicketsToStart: -1 }),
    "INVALID_INPUT",
  );
});

test("update: avviser ugyldig minTicketsToStart (over max)", async () => {
  const { service } = makeServiceWithRow(DEFAULT_ROW);
  await expectDomainError(
    "update minTicketsToStart=10000",
    () => service.update({ updatedByUserId: "u1", minTicketsToStart: 10000 }),
    "INVALID_INPUT",
  );
});

test("update: avviser ticketPriceCents=0", async () => {
  const { service } = makeServiceWithRow(DEFAULT_ROW);
  await expectDomainError(
    "update ticketPriceCents=0",
    () => service.update({ updatedByUserId: "u1", ticketPriceCents: 0 }),
    "INVALID_INPUT",
  );
});

test("update: avviser roundPauseMs under min", async () => {
  const { service } = makeServiceWithRow(DEFAULT_ROW);
  await expectDomainError(
    "update roundPauseMs=500",
    () => service.update({ updatedByUserId: "u1", roundPauseMs: 500 }),
    "INVALID_INPUT",
  );
});

test("update: avviser ballIntervalMs over max", async () => {
  const { service } = makeServiceWithRow(DEFAULT_ROW);
  await expectDomainError(
    "update ballIntervalMs=20000",
    () => service.update({ updatedByUserId: "u1", ballIntervalMs: 20000 }),
    "INVALID_INPUT",
  );
});

test("update: avviser ugyldig opening-time-format", async () => {
  const { service } = makeServiceWithRow(DEFAULT_ROW);
  await expectDomainError(
    "update openingTimeStart='8am'",
    () =>
      service.update({
        updatedByUserId: "u1",
        openingTimeStart: "8am",
        openingTimeEnd: "22:00",
      }),
    "INVALID_INPUT",
  );
});

test("update: avviser opening-time med invalid hour", async () => {
  const { service } = makeServiceWithRow(DEFAULT_ROW);
  await expectDomainError(
    "update openingTimeStart='25:00'",
    () =>
      service.update({
        updatedByUserId: "u1",
        openingTimeStart: "25:00",
        openingTimeEnd: "22:00",
      }),
    "INVALID_INPUT",
  );
});

test("update: aksepterer 1-sifret time, normaliserer til 2-sifret", async () => {
  const { service } = makeServiceWithRow(DEFAULT_ROW);
  const updated = await service.update({
    updatedByUserId: "u1",
    openingTimeStart: "9:00",
    openingTimeEnd: "21:30",
  });
  assert.equal(updated.openingTimeStart, "09:00");
  assert.equal(updated.openingTimeEnd, "21:30");
});

test("update: avviser jackpot-tabell uten alle 6 keys", async () => {
  const { service } = makeServiceWithRow(DEFAULT_ROW);
  await expectDomainError(
    "update jackpotNumberTable manglende key",
    () =>
      service.update({
        updatedByUserId: "u1",
        jackpotNumberTable: {
          "9": { price: 5000, isCash: true },
          "10": { price: 2500, isCash: true },
          "11": { price: 1000, isCash: true },
          // mangler 12, 13, 1421
        } as never,
      }),
    "INVALID_INPUT",
  );
});

test("update: avviser jackpot-entry med isCash=false og price > 100", async () => {
  const { service } = makeServiceWithRow(DEFAULT_ROW);
  await expectDomainError(
    "update jackpot percentage > 100",
    () =>
      service.update({
        updatedByUserId: "u1",
        jackpotNumberTable: {
          "9":    { price: 5000, isCash: true },
          "10":   { price: 2500, isCash: true },
          "11":   { price: 1000, isCash: true },
          "12":   { price: 200,  isCash: false },  // ← 200% ugyldig
          "13":   { price: 75,   isCash: false },
          "1421": { price: 50,   isCash: false },
        },
      }),
    "INVALID_INPUT",
  );
});

test("update: avviser luckyNumberEnabled=true uten luckyNumberPrizeCents", async () => {
  const { service } = makeServiceWithRow(DEFAULT_ROW);
  await expectDomainError(
    "lucky enabled uten prize",
    () =>
      service.update({
        updatedByUserId: "u1",
        luckyNumberEnabled: true,
      }),
    "INVALID_CONFIG",
  );
});

test("update: aksepterer luckyNumberEnabled=true når prize_cents er satt", async () => {
  const { service } = makeServiceWithRow(DEFAULT_ROW);
  const updated = await service.update({
    updatedByUserId: "u1",
    luckyNumberEnabled: true,
    luckyNumberPrizeCents: 50000,
  });
  assert.equal(updated.luckyNumberEnabled, true);
  assert.equal(updated.luckyNumberPrizeCents, 50000);
});

test("update: avviser kun-en-side åpningstid (start uten end)", async () => {
  const { service } = makeServiceWithRow(DEFAULT_ROW);
  await expectDomainError(
    "kun start, ikke end",
    () =>
      service.update({
        updatedByUserId: "u1",
        openingTimeStart: "10:00",
      }),
    "INVALID_CONFIG",
  );
});

test("update: avviser openingTimeStart >= openingTimeEnd", async () => {
  const { service } = makeServiceWithRow(DEFAULT_ROW);
  await expectDomainError(
    "start etter end",
    () =>
      service.update({
        updatedByUserId: "u1",
        openingTimeStart: "22:00",
        openingTimeEnd: "10:00",
      }),
    "INVALID_CONFIG",
  );
});

test("update: tillater å clear-e åpningstider med null", async () => {
  const { service } = makeServiceWithRow(DEFAULT_ROW_WITH_HOURS);
  const updated = await service.update({
    updatedByUserId: "u1",
    openingTimeStart: null,
    openingTimeEnd: null,
  });
  assert.equal(updated.openingTimeStart, null);
  assert.equal(updated.openingTimeEnd, null);
});

test("update: oppdaterer kun minTicketsToStart uten å rote øvrige felter", async () => {
  const { service } = makeServiceWithRow(DEFAULT_ROW);
  const updated = await service.update({
    updatedByUserId: "admin-1",
    minTicketsToStart: 50,
  });
  assert.equal(updated.minTicketsToStart, 50);
  assert.equal(updated.ticketPriceCents, 1000);
  assert.equal(updated.luckyNumberEnabled, false);
});

test("update: oppdaterer ticket-price", async () => {
  const { service } = makeServiceWithRow(DEFAULT_ROW);
  const updated = await service.update({
    updatedByUserId: "admin-1",
    ticketPriceCents: 2500,  // 25 kr
  });
  assert.equal(updated.ticketPriceCents, 2500);
});

test("update: oppdaterer pace-fields", async () => {
  const { service } = makeServiceWithRow(DEFAULT_ROW);
  const updated = await service.update({
    updatedByUserId: "admin-1",
    roundPauseMs: 90000,
    ballIntervalMs: 5000,
  });
  assert.equal(updated.roundPauseMs, 90000);
  assert.equal(updated.ballIntervalMs, 5000);
});

test("update: oppdaterer hele jackpot-tabellen", async () => {
  const { service } = makeServiceWithRow(DEFAULT_ROW);
  const newTable: Spill2JackpotTable = {
    "9":    { price: 10000, isCash: true },
    "10":   { price: 5000,  isCash: true },
    "11":   { price: 2000,  isCash: true },
    "12":   { price: 100,   isCash: false },
    "13":   { price: 75,    isCash: false },
    "1421": { price: 50,    isCash: false },
  };
  const updated = await service.update({
    updatedByUserId: "admin-1",
    jackpotNumberTable: newTable,
  });
  assert.equal(updated.jackpotNumberTable["9"]?.price, 10000);
  assert.equal(updated.jackpotNumberTable["1421"]?.price, 50);
});

// ── assertConfigConsistency standalone ─────────────────────────────────────

test("assertConfigConsistency: kun start uten end kaster", () => {
  const config: Spill2Config = {
    id: "test",
    openingTimeStart: "10:00",
    openingTimeEnd: null,
    minTicketsToStart: 5,
    ticketPriceCents: 1000,
    roundPauseMs: 60000,
    ballIntervalMs: 4000,
    jackpotNumberTable: DEFAULT_JACKPOT_TABLE,
    luckyNumberEnabled: false,
    luckyNumberPrizeCents: null,
    active: true,
    createdAt: "",
    updatedAt: "",
    updatedByUserId: null,
  };
  assert.throws(() => assertConfigConsistency(config), DomainError);
});

test("assertConfigConsistency: start >= end kaster", () => {
  const config: Spill2Config = {
    id: "test",
    openingTimeStart: "22:00",
    openingTimeEnd: "10:00",
    minTicketsToStart: 5,
    ticketPriceCents: 1000,
    roundPauseMs: 60000,
    ballIntervalMs: 4000,
    jackpotNumberTable: DEFAULT_JACKPOT_TABLE,
    luckyNumberEnabled: false,
    luckyNumberPrizeCents: null,
    active: true,
    createdAt: "",
    updatedAt: "",
    updatedByUserId: null,
  };
  assert.throws(() => assertConfigConsistency(config), DomainError);
});

test("assertConfigConsistency: lucky enabled uten prize kaster", () => {
  const config: Spill2Config = {
    id: "test",
    openingTimeStart: null,
    openingTimeEnd: null,
    minTicketsToStart: 5,
    ticketPriceCents: 1000,
    roundPauseMs: 60000,
    ballIntervalMs: 4000,
    jackpotNumberTable: DEFAULT_JACKPOT_TABLE,
    luckyNumberEnabled: true,
    luckyNumberPrizeCents: null,
    active: true,
    createdAt: "",
    updatedAt: "",
    updatedByUserId: null,
  };
  assert.throws(() => assertConfigConsistency(config), DomainError);
});

test("assertConfigConsistency: gyldig config passerer", () => {
  const config: Spill2Config = {
    id: "test",
    openingTimeStart: "10:00",
    openingTimeEnd: "22:00",
    minTicketsToStart: 5,
    ticketPriceCents: 1000,
    roundPauseMs: 60000,
    ballIntervalMs: 4000,
    jackpotNumberTable: DEFAULT_JACKPOT_TABLE,
    luckyNumberEnabled: true,
    luckyNumberPrizeCents: 50000,
    active: true,
    createdAt: "",
    updatedAt: "",
    updatedByUserId: null,
  };
  assertConfigConsistency(config);
});

// ── assertOpeningTime standalone ───────────────────────────────────────────

test("assertOpeningTime: null returnerer null", () => {
  assert.equal(assertOpeningTime(null, "test"), null);
  assert.equal(assertOpeningTime(undefined, "test"), null);
});

test("assertOpeningTime: tom-streng returnerer null", () => {
  assert.equal(assertOpeningTime("", "test"), null);
  assert.equal(assertOpeningTime("  ", "test"), null);
});

test("assertOpeningTime: gyldig HH:MM returneres normalisert", () => {
  assert.equal(assertOpeningTime("10:00", "test"), "10:00");
  assert.equal(assertOpeningTime("9:30", "test"), "09:30");
  assert.equal(assertOpeningTime("23:59", "test"), "23:59");
  assert.equal(assertOpeningTime("00:00", "test"), "00:00");
});

test("assertOpeningTime: ugyldig format kaster", () => {
  assert.throws(() => assertOpeningTime("10am", "test"), DomainError);
  assert.throws(() => assertOpeningTime("10", "test"), DomainError);
  assert.throws(() => assertOpeningTime("10:0", "test"), DomainError);
});

test("assertOpeningTime: ut-av-bound time/min kaster", () => {
  assert.throws(() => assertOpeningTime("24:00", "test"), DomainError);
  assert.throws(() => assertOpeningTime("10:60", "test"), DomainError);
  assert.throws(() => assertOpeningTime("-1:00", "test"), DomainError);
});

// ── assertJackpotTable standalone ──────────────────────────────────────────

test("assertJackpotTable: gyldig tabell passerer", () => {
  const table = assertJackpotTable(DEFAULT_JACKPOT_TABLE);
  assert.equal(table["9"]?.price, 5000);
  assert.equal(table["1421"]?.isCash, false);
});

test("assertJackpotTable: ekstra-keys ignoreres (whitelist-bare)", () => {
  // Ekstra keys ut over de 6 whitelistede ignoreres.
  const withExtra = {
    ...DEFAULT_JACKPOT_TABLE,
    extraKey: { price: 99999, isCash: true },
  };
  const table = assertJackpotTable(withExtra);
  assert.equal(table["9"]?.price, 5000);
  assert.equal((table as Record<string, unknown>).extraKey, undefined);
});

test("assertJackpotTable: manglende key kaster", () => {
  const partial = { ...DEFAULT_JACKPOT_TABLE };
  delete (partial as Record<string, unknown>)["1421"];
  assert.throws(() => assertJackpotTable(partial), DomainError);
});

test("assertJackpotTable: feil shape kaster", () => {
  assert.throws(() => assertJackpotTable("not-an-object"), DomainError);
  assert.throws(() => assertJackpotTable([]), DomainError);
  assert.throws(() => assertJackpotTable(null), DomainError);
});

test("assertJackpotTable: entry uten isCash kaster", () => {
  const bad = {
    ...DEFAULT_JACKPOT_TABLE,
    "9": { price: 5000 },  // mangler isCash
  };
  assert.throws(() => assertJackpotTable(bad), DomainError);
});

test("assertJackpotTable: entry med negativ price kaster", () => {
  const bad = {
    ...DEFAULT_JACKPOT_TABLE,
    "9": { price: -100, isCash: true },
  };
  assert.throws(() => assertJackpotTable(bad), DomainError);
});

// ── isWithinOpeningHours ───────────────────────────────────────────────────

test("isWithinOpeningHours: null-vindu = alltid åpent", () => {
  const config: Spill2Config = {
    ...createConfig(),
    openingTimeStart: null,
    openingTimeEnd: null,
  };
  assert.equal(isWithinOpeningHours(config, new Date("2026-05-08T03:00:00+02:00")), true);
});

test("isWithinOpeningHours: midt i vindu = true", () => {
  const config: Spill2Config = {
    ...createConfig(),
    openingTimeStart: "10:00",
    openingTimeEnd: "22:00",
  };
  // 14:30 Oslo-tid er midt i 10:00-22:00.
  // Bygg eksplisitt UTC-tid som tilsvarer 14:30 Europe/Oslo (CEST = UTC+2).
  const oslo1430 = new Date("2026-05-08T12:30:00Z");
  assert.equal(isWithinOpeningHours(config, oslo1430), true);
});

test("isWithinOpeningHours: utenfor vindu = false (før)", () => {
  const config: Spill2Config = {
    ...createConfig(),
    openingTimeStart: "10:00",
    openingTimeEnd: "22:00",
  };
  // 08:00 Oslo-tid (CEST = UTC+2) → 06:00 UTC.
  const oslo0800 = new Date("2026-05-08T06:00:00Z");
  assert.equal(isWithinOpeningHours(config, oslo0800), false);
});

test("isWithinOpeningHours: utenfor vindu = false (etter)", () => {
  const config: Spill2Config = {
    ...createConfig(),
    openingTimeStart: "10:00",
    openingTimeEnd: "22:00",
  };
  // 23:00 Oslo-tid (CEST = UTC+2) → 21:00 UTC.
  const oslo2300 = new Date("2026-05-08T21:00:00Z");
  assert.equal(isWithinOpeningHours(config, oslo2300), false);
});

function createConfig(): Spill2Config {
  return {
    id: "test",
    openingTimeStart: null,
    openingTimeEnd: null,
    minTicketsToStart: 5,
    ticketPriceCents: 1000,
    roundPauseMs: 60000,
    ballIntervalMs: 4000,
    jackpotNumberTable: DEFAULT_JACKPOT_TABLE,
    luckyNumberEnabled: false,
    luckyNumberPrizeCents: null,
    active: true,
    createdAt: "",
    updatedAt: "",
    updatedByUserId: null,
  };
}

// ── audit-log integrasjon ──────────────────────────────────────────────────

test("update: skriver audit-log-event med før/etter-snapshot", async () => {
  const auditEvents: Array<{ action: string; details: unknown }> = [];
  const auditStub = {
    record: async (input: { action: string; details: unknown }) => {
      auditEvents.push({ action: input.action, details: input.details });
    },
  };
  const { service } = makeServiceWithRow(DEFAULT_ROW);
  service.setAuditLogService(auditStub as never);

  await service.update({
    updatedByUserId: "admin-1",
    minTicketsToStart: 10,
  });

  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0]!.action, "spill2.config.update");
  const details = auditEvents[0]!.details as {
    before: { minTicketsToStart: number };
    after: { minTicketsToStart: number };
    changedFields: string[];
  };
  assert.equal(details.before.minTicketsToStart, 5);
  assert.equal(details.after.minTicketsToStart, 10);
  assert.deepEqual(details.changedFields, ["minTicketsToStart"]);
});

test("update: audit-log-feil blokkerer ikke caller", async () => {
  const auditStub = {
    record: async () => {
      throw new Error("audit-log down");
    },
  };
  const { service } = makeServiceWithRow(DEFAULT_ROW);
  service.setAuditLogService(auditStub as never);

  // Skal IKKE kaste — audit-feil er best-effort.
  const updated = await service.update({
    updatedByUserId: "admin-1",
    minTicketsToStart: 7,
  });
  assert.equal(updated.minTicketsToStart, 7);
});

test("update: changedFields detekterer jackpot-tabell-endring", async () => {
  const auditEvents: Array<{ details: unknown }> = [];
  const auditStub = {
    record: async (input: { details: unknown }) => {
      auditEvents.push({ details: input.details });
    },
  };
  const { service } = makeServiceWithRow(DEFAULT_ROW);
  service.setAuditLogService(auditStub as never);

  const newTable: Spill2JackpotTable = {
    ...DEFAULT_JACKPOT_TABLE,
    "9": { price: 99999, isCash: true },
  };
  await service.update({
    updatedByUserId: "admin-1",
    jackpotNumberTable: newTable,
  });

  const details = auditEvents[0]!.details as { changedFields: string[] };
  assert.ok(details.changedFields.includes("jackpotNumberTable"));
});
