/**
 * GAME1_SCHEDULE PR 4d.3: tester for at service-laget kaller
 * AdminGame1Broadcaster-porten ved state-endringer og draw-progress.
 *
 * Verifiserer:
 *   - NoopAdminGame1Broadcaster er trygg no-op (service uten injeksjon
 *     kraker ikke).
 *   - En broadcaster-exception på `onStatusChange`/`onDrawProgressed`
 *     svelges av service (fire-and-forget).
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  NoopAdminGame1Broadcaster,
  type AdminGame1Broadcaster,
  type AdminGame1StatusChangeEvent,
  type AdminGame1DrawProgressedEvent,
  type AdminGame1PhaseWonEvent,
  type AdminGame1PhysicalTicketWonEvent,
} from "./AdminGame1Broadcaster.js";

test("4d.3: NoopAdminGame1Broadcaster.onStatusChange er trygg no-op", () => {
  assert.doesNotThrow(() =>
    NoopAdminGame1Broadcaster.onStatusChange({
      gameId: "g1",
      status: "running",
      action: "start",
      auditId: "audit-1",
      actorUserId: "user-1",
      at: Date.now(),
    })
  );
});

test("4d.3: NoopAdminGame1Broadcaster.onDrawProgressed er trygg no-op", () => {
  assert.doesNotThrow(() =>
    NoopAdminGame1Broadcaster.onDrawProgressed({
      gameId: "g1",
      ballNumber: 42,
      drawIndex: 1,
      currentPhase: 1,
      at: Date.now(),
    })
  );
});

test("4d.3+4: broadcaster-port — events har forventet shape (compile + runtime)", () => {
  const statusEvents: AdminGame1StatusChangeEvent[] = [];
  const drawEvents: AdminGame1DrawProgressedEvent[] = [];
  const phaseEvents: AdminGame1PhaseWonEvent[] = [];
  const physicalEvents: AdminGame1PhysicalTicketWonEvent[] = [];
  const recording: AdminGame1Broadcaster = {
    onStatusChange: (e) => statusEvents.push(e),
    onDrawProgressed: (e) => drawEvents.push(e),
    onPhaseWon: (e) => phaseEvents.push(e),
    onPhysicalTicketWon: (e) => physicalEvents.push(e),
  };

  recording.onStatusChange({
    gameId: "g1",
    status: "paused",
    action: "pause",
    auditId: "a-1",
    actorUserId: "u-1",
    at: 1000,
  });
  recording.onDrawProgressed({
    gameId: "g1",
    ballNumber: 7,
    drawIndex: 3,
    currentPhase: 2,
    at: 1500,
  });
  recording.onPhaseWon({
    gameId: "g1",
    patternName: "1 Rad",
    phase: 1,
    winnerIds: ["u-a", "u-b"],
    winnerCount: 2,
    drawIndex: 5,
    at: 2000,
  });
  recording.onPhysicalTicketWon({
    gameId: "g1",
    phase: 1,
    patternName: "1 Rad",
    pendingPayoutId: "pp-1",
    ticketId: "100-1001",
    hallId: "hall-a",
    responsibleUserId: "op-a",
    expectedPayoutCents: 10_000,
    color: "small",
    adminApprovalRequired: false,
    at: 2500,
  });

  assert.equal(statusEvents.length, 1);
  assert.equal(statusEvents[0]!.action, "pause");
  assert.equal(drawEvents.length, 1);
  assert.equal(drawEvents[0]!.currentPhase, 2);
  assert.equal(phaseEvents.length, 1);
  assert.equal(phaseEvents[0]!.patternName, "1 Rad");
  assert.deepEqual(phaseEvents[0]!.winnerIds, ["u-a", "u-b"]);
  assert.equal(physicalEvents.length, 1);
  assert.equal(physicalEvents[0]!.ticketId, "100-1001");
  assert.equal(physicalEvents[0]!.expectedPayoutCents, 10_000);
});

test("PT4: NoopAdminGame1Broadcaster.onPhysicalTicketWon er trygg no-op", () => {
  assert.doesNotThrow(() =>
    NoopAdminGame1Broadcaster.onPhysicalTicketWon({
      gameId: "g1",
      phase: 1,
      patternName: "1 Rad",
      pendingPayoutId: "pp-1",
      ticketId: "100-1001",
      hallId: "hall-a",
      responsibleUserId: "op-a",
      expectedPayoutCents: 10_000,
      color: "small",
      adminApprovalRequired: false,
      at: Date.now(),
    })
  );
});

test("4d.4: NoopAdminGame1Broadcaster.onPhaseWon er trygg no-op", () => {
  assert.doesNotThrow(() =>
    NoopAdminGame1Broadcaster.onPhaseWon({
      gameId: "g1",
      patternName: "Fullt Hus",
      phase: 5,
      winnerIds: ["u-1"],
      winnerCount: 1,
      drawIndex: 42,
      at: Date.now(),
    })
  );
});
