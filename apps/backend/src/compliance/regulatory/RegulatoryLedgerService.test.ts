/**
 * Unit-tests for RegulatoryLedgerService.mapEntry (G2 mapping logic).
 *
 * No DB. Pure-function tests of legacy → §71 entry mapping, sign convention,
 * and edge-cases (NULL ticket_ref, EXTRA_PRIZE collapse, ADJUSTMENT events).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import type { ComplianceLedgerEntry } from "../../game/ComplianceLedgerTypes.js";
import { RegulatoryLedgerStore } from "./RegulatoryLedgerStore.js";
import { RegulatoryLedgerService } from "./RegulatoryLedgerService.js";

// Stub Pool — we only call pure mapping methods, never .query().
const stubPool = {} as unknown as Pool;
const store = new RegulatoryLedgerStore({
  pool: stubPool,
  schema: "public",
});
const service = new RegulatoryLedgerService({ store });

function legacyEntry(overrides: Partial<ComplianceLedgerEntry> = {}): ComplianceLedgerEntry {
  return {
    id: "legacy-id-1",
    createdAt: "2026-05-09T10:30:00.000Z",
    createdAtMs: Date.UTC(2026, 4, 9, 10, 30, 0), // 2026-05-09 10:30 UTC = 12:30 Oslo (CEST)
    hallId: "hall-1",
    gameType: "MAIN_GAME",
    channel: "INTERNET",
    eventType: "STAKE",
    amount: 100,
    currency: "NOK",
    playerId: "player-1",
    gameId: "game-1",
    ...overrides,
  };
}

describe("RegulatoryLedgerService.mapEntry — STAKE → TICKET_SALE", () => {
  it("maps STAKE to TICKET_SALE with positive amount", () => {
    const mapped = service.mapEntry(legacyEntry({ eventType: "STAKE", amount: 100 }));
    assert.ok(mapped);
    assert.equal(mapped.transaction_type, "TICKET_SALE");
    assert.equal(mapped.amount_nok, 100);
  });

  it("preserves hall_id and channel", () => {
    const mapped = service.mapEntry(
      legacyEntry({ hallId: "hall-xyz", channel: "HALL" }),
    );
    assert.ok(mapped);
    assert.equal(mapped.hall_id, "hall-xyz");
    assert.equal(mapped.channel, "HALL");
  });

  it("uses Europe/Oslo business-date for event_date (CEST: 22:30 UTC = 00:30 next-day Oslo)", () => {
    // 22:30 UTC on 2026-05-09 = 00:30 Oslo on 2026-05-10 (CEST = UTC+2)
    const lateMs = Date.UTC(2026, 4, 9, 22, 30, 0);
    const mapped = service.mapEntry(legacyEntry({ createdAtMs: lateMs }));
    assert.ok(mapped);
    assert.equal(mapped.event_date, "2026-05-10");
  });

  it("plays well with daytime UTC → same Oslo date", () => {
    const dayMs = Date.UTC(2026, 4, 9, 10, 30, 0);
    const mapped = service.mapEntry(legacyEntry({ createdAtMs: dayMs }));
    assert.ok(mapped);
    assert.equal(mapped.event_date, "2026-05-09");
  });

  it("propagates user_id from playerId", () => {
    const mapped = service.mapEntry(legacyEntry({ playerId: "alice-123" }));
    assert.ok(mapped);
    assert.equal(mapped.user_id, "alice-123");
  });

  it("user_id is NULL when playerId not set", () => {
    const mapped = service.mapEntry(legacyEntry({ playerId: undefined }));
    assert.ok(mapped);
    assert.equal(mapped.user_id, null);
  });
});

describe("RegulatoryLedgerService.mapEntry — PRIZE → PRIZE_PAYOUT", () => {
  it("maps PRIZE with NEGATIVE amount (sign convention)", () => {
    const mapped = service.mapEntry(legacyEntry({ eventType: "PRIZE", amount: 250 }));
    assert.ok(mapped);
    assert.equal(mapped.transaction_type, "PRIZE_PAYOUT");
    assert.equal(mapped.amount_nok, -250);
  });

  it("EXTRA_PRIZE also maps to PRIZE_PAYOUT, with metadata.extraPrize=true", () => {
    const mapped = service.mapEntry(
      legacyEntry({ eventType: "EXTRA_PRIZE", amount: 50 }),
    );
    assert.ok(mapped);
    assert.equal(mapped.transaction_type, "PRIZE_PAYOUT");
    assert.equal(mapped.amount_nok, -50);
    assert.equal(mapped.metadata?.extraPrize, true);
  });

  it("rounds amount to 2 decimals", () => {
    const mapped = service.mapEntry(
      legacyEntry({ eventType: "PRIZE", amount: 100.456 }),
    );
    assert.ok(mapped);
    // -100.456 rounded to 2dp = -100.46
    assert.equal(mapped.amount_nok, -100.46);
  });
});

describe("RegulatoryLedgerService.mapEntry — ADJUSTMENT events", () => {
  it("maps ORG_DISTRIBUTION → ADJUSTMENT", () => {
    const mapped = service.mapEntry(
      legacyEntry({ eventType: "ORG_DISTRIBUTION", amount: 1500, batchId: "batch-1" }),
    );
    assert.ok(mapped);
    assert.equal(mapped.transaction_type, "ADJUSTMENT");
    assert.equal(mapped.metadata?.batchId, "batch-1");
  });

  it("maps HOUSE_RETAINED → ADJUSTMENT (sign positive)", () => {
    const mapped = service.mapEntry(
      legacyEntry({ eventType: "HOUSE_RETAINED", amount: 0.05 }),
    );
    assert.ok(mapped);
    assert.equal(mapped.transaction_type, "ADJUSTMENT");
    assert.equal(mapped.amount_nok, 0.05);
  });

  it("maps HOUSE_DEFICIT → ADJUSTMENT (audit-only event)", () => {
    const mapped = service.mapEntry(
      legacyEntry({ eventType: "HOUSE_DEFICIT", amount: 250 }),
    );
    assert.ok(mapped);
    assert.equal(mapped.transaction_type, "ADJUSTMENT");
  });
});

describe("RegulatoryLedgerService.mapEntry — ticket_ref resolution", () => {
  it("uses metadata.ticketRef when present", () => {
    const mapped = service.mapEntry(
      legacyEntry({
        metadata: { ticketRef: "TK-00042" },
        claimId: "claim-99",
      }),
    );
    assert.ok(mapped);
    assert.equal(mapped.ticket_ref, "TK-00042");
  });

  it("falls back to claimId when metadata.ticketRef missing", () => {
    const mapped = service.mapEntry(
      legacyEntry({ claimId: "claim-99" }),
    );
    assert.ok(mapped);
    assert.equal(mapped.ticket_ref, "claim-99");
  });

  it("ticket_ref = NULL when neither set", () => {
    const mapped = service.mapEntry(legacyEntry({ claimId: undefined }));
    assert.ok(mapped);
    assert.equal(mapped.ticket_ref, null);
  });

  it("trims whitespace on metadata.ticketRef", () => {
    const mapped = service.mapEntry(
      legacyEntry({ metadata: { ticketRef: "  TK-001  " } }),
    );
    assert.ok(mapped);
    assert.equal(mapped.ticket_ref, "TK-001");
  });

  it("empty-string metadata.ticketRef is treated as missing", () => {
    const mapped = service.mapEntry(
      legacyEntry({ metadata: { ticketRef: "" }, claimId: "claim-fallback" }),
    );
    assert.ok(mapped);
    assert.equal(mapped.ticket_ref, "claim-fallback");
  });
});

describe("RegulatoryLedgerService.mapEntry — metadata pass-through", () => {
  it("includes legacyEventType in metadata for traceability", () => {
    const mapped = service.mapEntry(legacyEntry({ eventType: "STAKE" }));
    assert.ok(mapped);
    assert.equal(mapped.metadata?.legacyEventType, "STAKE");
  });

  it("includes gameType in metadata", () => {
    const mapped = service.mapEntry(legacyEntry({ gameType: "DATABINGO" }));
    assert.ok(mapped);
    assert.equal(mapped.metadata?.gameType, "DATABINGO");
  });

  it("includes gameId, roomCode, batchId, policyVersion when present", () => {
    const mapped = service.mapEntry(
      legacyEntry({
        gameId: "g-1",
        roomCode: "room-A",
        batchId: "b-1",
        policyVersion: "v2",
      }),
    );
    assert.ok(mapped);
    assert.equal(mapped.metadata?.gameId, "g-1");
    assert.equal(mapped.metadata?.roomCode, "room-A");
    assert.equal(mapped.metadata?.batchId, "b-1");
    assert.equal(mapped.metadata?.policyVersion, "v2");
  });

  it("nests legacy metadata under `source` key", () => {
    const mapped = service.mapEntry(
      legacyEntry({ metadata: { foo: "bar", count: 3 } }),
    );
    assert.ok(mapped);
    const source = mapped.metadata?.source as { foo: string; count: number };
    assert.equal(source.foo, "bar");
    assert.equal(source.count, 3);
  });
});

describe("RegulatoryLedgerService.mapEntry — generates fresh UUID per call", () => {
  it("each call gets a unique id (separates from legacy id)", () => {
    const e = legacyEntry();
    const a = service.mapEntry(e);
    const b = service.mapEntry(e);
    assert.ok(a);
    assert.ok(b);
    assert.notEqual(a.id, b.id);
    // Critically, neither equals the legacy id — §71-ledger has its own id-space.
    assert.notEqual(a.id, e.id);
    assert.notEqual(b.id, e.id);
  });
});

describe("RegulatoryLedgerService.mapEntry — draw_session_id always NULL today", () => {
  // We do NOT join app_draw_sessions inside mapEntry — that's a future
  // enhancement (BIN-XXX). Test locks today's behavior.
  it("draw_session_id is NULL even when gameId is set", () => {
    const mapped = service.mapEntry(legacyEntry({ gameId: "scheduled-game-1" }));
    assert.ok(mapped);
    assert.equal(mapped.draw_session_id, null);
  });
});
