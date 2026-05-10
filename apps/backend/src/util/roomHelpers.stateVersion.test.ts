/**
 * ADR-0019 / P0-1 (2026-05-10): integration-tester for stateVersion på
 * `buildRoomUpdatePayload` og kontrakten mot wire-schema.
 *
 * Dekker:
 *   1. `buildRoomUpdatePayload` populerer `stateVersion` når caller sender det
 *   2. Når caller IKKE sender det, utelates feltet på wire-en (backwards-compat)
 *   3. `stripPerpetualPayloadForRecipient` propagerer stateVersion uendret
 *   4. Wire-schema (Zod) aksepterer både med og uten stateVersion
 *   5. Wire-schema avviser negative tall (defense-in-depth)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildRoomUpdatePayload, stripPerpetualPayloadForRecipient } from "./roomHelpers.js";
import { RoomUpdatePayloadSchema } from "@spillorama/shared-types/socket-events";
import type { RoomSnapshot } from "../game/types.js";
import type { BingoSchedulerSettings } from "../sockets/gameEvents/deps.js";
import type { DrawScheduler } from "../draw-engine/DrawScheduler.js";

// Minimal fixture — vi tester kun stateVersion-feltet, andre felter er
// dekket av eksisterende roomHelpers.*-tester.
function makeSnapshot(): RoomSnapshot {
  return {
    code: "ROOM-A",
    hallId: "hall-1",
    hostPlayerId: "player-1",
    gameSlug: "bingo",
    players: [
      { id: "player-1", name: "Test", walletId: "w1", balance: 100, socketId: "s1" },
    ],
    gameHistory: [],
    createdAt: "2026-05-10T08:00:00Z",
  };
}

function makeOptsBase(stateVersion?: number) {
  const runtimeBingoSettings: BingoSchedulerSettings = {
    autoRoundStartEnabled: false,
    autoRoundStartIntervalMs: 5_000,
    autoRoundMinPlayers: 1,
    autoRoundTicketsPerPlayer: 1,
    autoRoundEntryFee: 10,
    payoutPercent: 80,
    autoDrawEnabled: false,
    autoDrawIntervalMs: 3_000,
  };
  const stubScheduler: DrawScheduler = {
    nextStartAtMs: () => null,
  } as unknown as DrawScheduler;
  return {
    runtimeBingoSettings,
    drawScheduler: stubScheduler,
    bingoMaxDrawsPerRound: 75,
    schedulerTickMs: 1_000,
    stateVersion,
    getArmedPlayerIds: () => [],
    getArmedPlayerTicketCounts: () => ({}),
    getArmedPlayerSelections: () => ({}),
    getRoomConfiguredEntryFee: () => 10,
    getOrCreateDisplayTickets: () => [],
    getLuckyNumbers: () => ({}),
    getVariantConfig: () => null,
    getHallName: () => "Test Hall",
    supplierName: "Spillorama",
  };
}

test("buildRoomUpdatePayload — populerer stateVersion når caller sender det", () => {
  const snap = makeSnapshot();
  const payload = buildRoomUpdatePayload(snap, Date.now(), makeOptsBase(42));
  assert.equal(payload.stateVersion, 42, "stateVersion må være 42");
});

test("buildRoomUpdatePayload — utelater stateVersion på wire når caller ikke sender det (backwards-compat)", () => {
  const snap = makeSnapshot();
  const payload = buildRoomUpdatePayload(snap, Date.now(), makeOptsBase(undefined));
  assert.equal(
    "stateVersion" in payload,
    false,
    "feltet skal ikke eksistere på payloaden når caller ikke har satt det — klient skipper dedup",
  );
});

test("buildRoomUpdatePayload — stateVersion=0 (eksplisitt) sendes på wire", () => {
  // 0 er en gyldig stateVersion (defense — kontrakten sier 0 = cold-start
  // før første emit, normalt sendes 1+ men 0 må aksepteres).
  const snap = makeSnapshot();
  const payload = buildRoomUpdatePayload(snap, Date.now(), makeOptsBase(0));
  assert.equal(payload.stateVersion, 0);
});

test("buildRoomUpdatePayload — stateVersion på 1_000_000 (high values) aksepteres", () => {
  // Etter 30+ dager perpetual-loop ROCKET-rom kan stateVersion bli stort.
  // Verifiserer at vi ikke har integer-cap-issue.
  const snap = makeSnapshot();
  const payload = buildRoomUpdatePayload(snap, Date.now(), makeOptsBase(1_000_000));
  assert.equal(payload.stateVersion, 1_000_000);
});

test("stripPerpetualPayloadForRecipient — bevarer stateVersion uendret", () => {
  const snap = makeSnapshot();
  const fullPayload = buildRoomUpdatePayload(snap, Date.now(), makeOptsBase(42));
  const stripped = stripPerpetualPayloadForRecipient(fullPayload, "player-1");
  assert.equal(stripped.stateVersion, 42, "stripping må ikke endre stateVersion");
});

test("stripPerpetualPayloadForRecipient — bevarer stateVersion også for observer (null recipient)", () => {
  const snap = makeSnapshot();
  const fullPayload = buildRoomUpdatePayload(snap, Date.now(), makeOptsBase(42));
  const stripped = stripPerpetualPayloadForRecipient(fullPayload, null);
  assert.equal(stripped.stateVersion, 42);
});

test("RoomUpdatePayloadSchema — aksepterer payload med stateVersion", () => {
  const snap = makeSnapshot();
  const payload = buildRoomUpdatePayload(snap, Date.now(), makeOptsBase(42));
  const result = RoomUpdatePayloadSchema.safeParse(payload);
  assert.equal(result.success, true, "schema skal akseptere payload med stateVersion");
});

test("RoomUpdatePayloadSchema — aksepterer payload UTEN stateVersion (legacy)", () => {
  const snap = makeSnapshot();
  const payload = buildRoomUpdatePayload(snap, Date.now(), makeOptsBase(undefined));
  const result = RoomUpdatePayloadSchema.safeParse(payload);
  assert.equal(result.success, true, "schema skal akseptere payload uten stateVersion");
});

test("RoomUpdatePayloadSchema — avviser negativ stateVersion (defense-in-depth)", () => {
  const snap = makeSnapshot();
  const payload = buildRoomUpdatePayload(snap, Date.now(), makeOptsBase(42));
  // Force-set en ugyldig verdi for å validere schemaen
  (payload as { stateVersion: number }).stateVersion = -1;
  const result = RoomUpdatePayloadSchema.safeParse(payload);
  assert.equal(result.success, false, "schema skal avvise negative stateVersion");
});

test("RoomUpdatePayloadSchema — avviser desimal stateVersion (defense-in-depth)", () => {
  const snap = makeSnapshot();
  const payload = buildRoomUpdatePayload(snap, Date.now(), makeOptsBase(42));
  (payload as { stateVersion: number }).stateVersion = 1.5;
  const result = RoomUpdatePayloadSchema.safeParse(payload);
  assert.equal(result.success, false, "schema skal avvise desimal stateVersion (int only)");
});
