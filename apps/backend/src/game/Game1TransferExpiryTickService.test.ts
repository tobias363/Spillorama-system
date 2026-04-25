/**
 * Task 1.6: unit-tester for Game1TransferExpiryTickService.
 *
 * Verifiserer at tick() kaller service.expireStaleTasks() og at broadcast-hook
 * kalles for hver utløpte request.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { Game1TransferExpiryTickService } from "./Game1TransferExpiryTickService.js";
import type {
  Game1TransferHallService,
  TransferRequest,
} from "./Game1TransferHallService.js";

function sampleRequest(id: string): TransferRequest {
  const past = Date.now() - 60_000;
  return {
    id,
    gameId: "g1",
    fromHallId: "hall-a",
    toHallId: "hall-b",
    initiatedByUserId: "u",
    initiatedAt: new Date(past - 60_000).toISOString(),
    validTill: new Date(past).toISOString(),
    status: "expired",
    respondedByUserId: null,
    respondedAt: new Date().toISOString(),
    rejectReason: null,
  };
}

test("tick kaller service.expireStaleTasks() én gang og broadcaster for hver expired request", async () => {
  const broadcasts: TransferRequest[] = [];
  let expireCalls = 0;
  const service = {
    async expireStaleTasks() {
      expireCalls++;
      return [sampleRequest("exp-1"), sampleRequest("exp-2")];
    },
  } as unknown as Game1TransferHallService;

  const tick = new Game1TransferExpiryTickService({
    service,
    onExpiredBroadcast: (req) => broadcasts.push(req),
  });
  const result = await tick.tick();
  assert.equal(result.expiredCount, 2);
  assert.equal(expireCalls, 1);
  assert.equal(broadcasts.length, 2);
  assert.equal(broadcasts[0]!.id, "exp-1");
});

test("tick håndterer tom resultat-liste uten feil", async () => {
  const service = {
    async expireStaleTasks() {
      return [];
    },
  } as unknown as Game1TransferHallService;
  const tick = new Game1TransferExpiryTickService({ service });
  const result = await tick.tick();
  assert.equal(result.expiredCount, 0);
  assert.equal(result.errors, 0);
});

test("tick isolerer broadcast-feil (én feil blokkerer ikke resten)", async () => {
  const broadcasts: string[] = [];
  const service = {
    async expireStaleTasks() {
      return [
        sampleRequest("ok-1"),
        sampleRequest("fail"),
        sampleRequest("ok-2"),
      ];
    },
  } as unknown as Game1TransferHallService;
  const tick = new Game1TransferExpiryTickService({
    service,
    onExpiredBroadcast: (req) => {
      if (req.id === "fail") throw new Error("hook kastet");
      broadcasts.push(req.id);
    },
  });
  const result = await tick.tick();
  assert.equal(result.expiredCount, 3);
  assert.equal(result.errors, 1);
  assert.deepEqual(broadcasts, ["ok-1", "ok-2"]);
});

test("setBroadcastHook late-binder hook etter construction", async () => {
  const broadcasts: string[] = [];
  const service = {
    async expireStaleTasks() {
      return [sampleRequest("exp-late")];
    },
  } as unknown as Game1TransferHallService;
  const tick = new Game1TransferExpiryTickService({ service });
  tick.setBroadcastHook((req) => broadcasts.push(req.id));
  await tick.tick();
  assert.deepEqual(broadcasts, ["exp-late"]);
});
