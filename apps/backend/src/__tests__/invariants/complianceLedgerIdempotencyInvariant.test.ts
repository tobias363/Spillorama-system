/**
 * Unified pipeline refactor — Fase 0b (UNIFIED_PIPELINE_REFACTOR_DESIGN_2026-04-28.md §5.1).
 *
 * Invariant: recording av samme compliance-event 2+ ganger med samme
 * idempotency-key resulterer i 1 row.
 *
 * Hvorfor:
 *   - PILOT-STOP-SHIP 2026-04-28 (migrations/20260428080000_compliance_
 *     ledger_idempotency.sql): 12+ call-sites til
 *     `recordComplianceLedgerEvent` hadde alle samme
 *     "soft-fail-after-wallet-success → retry → dupliket"-bug.
 *   - UNIQUE-constraint på `app_rg_compliance_ledger.idempotency_key`
 *     håndhever idempotensen på DB-nivå. CompliancePort må respektere
 *     samme kontrakt — `InMemoryCompliancePort.recordEvent` bruker
 *     `Set<string>` for å speile UNIQUE-oppførselen.
 *
 * Property:
 *   - For en gitt key + n recordings → store.size er alltid 1.
 *   - For ulike keys → store.size øker.
 *
 * Status: PASS forventet.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { InMemoryCompliancePort } from "../../ports/inMemory/InMemoryCompliancePort.js";
import { DefaultIdempotencyKeyPort } from "../../ports/IdempotencyKeyPort.js";
import type { ComplianceEvent } from "../../ports/CompliancePort.js";

const sampleEvent: ComplianceEvent = {
  hallId: "hall-1",
  gameType: "MAIN_GAME",
  channel: "INTERNET",
  eventType: "PRIZE",
  amount: 100,
  gameId: "game-1",
  playerId: "player-1",
  walletId: "wallet-1",
};

test("invariant: recording samme event N ganger med samme key → 1 row", async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 1, max: 50 }), async (retryCount) => {
      const port = new InMemoryCompliancePort();
      for (let i = 0; i < retryCount; i++) {
        await port.recordEvent(sampleEvent, "key-fixed-1");
      }
      assert.equal(port.count(), 1, `${retryCount} retries skal gi 1 row`);
      assert.equal(port.keyCount(), 1);
    }),
    { numRuns: 30 },
  );
});

test("invariant: distinkte keys → distinkte rows", async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 1, max: 20 }), async (numKeys) => {
      const port = new InMemoryCompliancePort();
      for (let i = 0; i < numKeys; i++) {
        await port.recordEvent(sampleEvent, `key-${i}`);
      }
      assert.equal(port.count(), numKeys, `${numKeys} distinkte keys → ${numKeys} rows`);
    }),
    { numRuns: 30 },
  );
});

test("invariant: forCompliance-keyformat skiller events korrekt", () => {
  const keys = new DefaultIdempotencyKeyPort();

  // Sanity: ulike eventTypes på samme (game, claim) → ulike keys.
  const stake = keys.forCompliance("STAKE", "game-1", null, "player-1");
  const prize = keys.forCompliance("PRIZE", "game-1", null, "player-1");
  assert.notEqual(stake, prize);

  // Ulike claimIds → ulike keys.
  const claimA = keys.forCompliance("PRIZE", "game-1", "claim-A", null);
  const claimB = keys.forCompliance("PRIZE", "game-1", "claim-B", null);
  assert.notEqual(claimA, claimB);

  // claimId vs playerId fallback: claimId tar prioritet.
  const withClaim = keys.forCompliance("PRIZE", "game-1", "claim-X", "player-1");
  const onlyPlayer = keys.forCompliance("PRIZE", "game-1", null, "player-1");
  assert.notEqual(withClaim, onlyPlayer);

  // Ingen claimId, ingen playerId → "no-actor" fallback.
  const empty = keys.forCompliance("PRIZE", "game-1", null, null);
  assert.match(empty, /no-actor/);

  // Ingen gameId → "no-game" fallback.
  const noGame = keys.forCompliance("PRIZE", null, "claim-1", null);
  assert.match(noGame, /no-game/);
});

test("invariant: PRIZE-event idempotent across 'soft-fail'-retry-mønster", async () => {
  // Bug-rapport-mønster: wallet credit lykkes, deretter compliance-write
  // throws (DB-feil), retry forårsaker 2x compliance-rader. Med
  // idempotency-key skal den 2. innsettingen være no-op.
  const port = new InMemoryCompliancePort();
  const keys = new DefaultIdempotencyKeyPort();
  const key = keys.forCompliance("PRIZE", "game-99", "claim-99", "player-99");

  // Første attempt — go through.
  await port.recordEvent(sampleEvent, key);
  assert.equal(port.count(), 1);

  // Simuler retry (samme args).
  await port.recordEvent(sampleEvent, key);
  await port.recordEvent(sampleEvent, key);
  await port.recordEvent({ ...sampleEvent, amount: 999 /* differ — skal IKKE matter, key matcher */ }, key);
  assert.equal(port.count(), 1, "Retry uansett payload-endring skal ikke skape row 2");

  // Det første lagrede event er det vi har.
  const stored = port.getAllEvents()[0];
  assert.equal(stored.event.amount, 100, "Første event vinner — payload fra retry blir ignorert");
});
