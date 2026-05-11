import assert from "node:assert/strict";
import test from "node:test";

import { DomainError } from "../errors/DomainError.js";
import { createSchedulerCallbacks } from "./schedulerSetup.js";

test("onRoomExhausted catches async endGame rejection", async () => {
  const originalConsoleError = console.error;
  const errors: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };

  let unhandled: unknown = null;
  const onUnhandled = (reason: unknown) => {
    unhandled = reason;
  };
  process.once("unhandledRejection", onUnhandled);

  try {
    const callbacks = createSchedulerCallbacks({
      engine: {
        getRoomSnapshot: () => ({
          currentGame: { status: "RUNNING" },
          hostPlayerId: "__system_actor__",
        }),
        endGame: async () => {
          throw new DomainError("PLAYER_NOT_FOUND", "Spiller finnes ikke i rommet.");
        },
      },
      emitRoomUpdate: async () => ({}),
    } as unknown as Parameters<typeof createSchedulerCallbacks>[0]);

    callbacks.onRoomExhausted("ROCKET", 3);
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(unhandled, null);
    assert.ok(
      errors.some((args) => String(args[0]).includes("Failed to end exhausted room ROCKET")),
      "expected failed-end log",
    );
  } finally {
    process.removeListener("unhandledRejection", onUnhandled);
    console.error = originalConsoleError;
  }
});
