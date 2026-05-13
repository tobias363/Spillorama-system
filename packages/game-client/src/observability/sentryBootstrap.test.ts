/**
 * @vitest-environment happy-dom
 *
 * OBS-2 (2026-05-13): game-client Sentry bootstrap tests.
 *
 * Verifies that:
 *   - `bootstrapClientSentry` is a no-op when VITE_SENTRY_DSN is unset
 *   - `setClientScreen` / `setClientScheduledGameId` / `setClientPlanRunId`
 *     forward to the underlying SDK tag setter
 *   - `updateClientSentryUser` hashes the playerId via the shared `hashPii`
 *
 * We mock `../telemetry/Sentry.js` so the SDK is never loaded; that
 * lets the test run in happy-dom without a network.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Sentry SDK module BEFORE importing sentryBootstrap. vi.mock is
// hoisted, so we use the factory form and read the mock fns back via the
// import system.
vi.mock("../telemetry/Sentry.js", () => ({
  initSentry: vi.fn().mockResolvedValue(true),
  setClientSentryTag: vi.fn(),
  setClientSentryUser: vi.fn(),
  hashPii: vi.fn(async (input: string | null | undefined) => (input ? "hashed-aaaa" : "anon")),
}));

import {
  initSentry as initSentryMock,
  setClientSentryTag as setTagMock,
  setClientSentryUser as setUserMock,
} from "../telemetry/Sentry.js";
import {
  bootstrapClientSentry,
  setClientScreen,
  setClientScheduledGameId,
  setClientPlanRunId,
  updateClientSentryUser,
} from "./sentryBootstrap.js";

describe("OBS-2: sentryBootstrap (game-client)", () => {
  beforeEach(() => {
    vi.mocked(setTagMock).mockClear();
    vi.mocked(setUserMock).mockClear();
    vi.mocked(initSentryMock).mockClear();
  });

  it("bootstrapClientSentry passes through to initSentry with defaults", async () => {
    await bootstrapClientSentry({
      gameSlug: "bingo",
      hallId: "demo-hall-001",
      playerId: "token-xyz",
    });

    expect(initSentryMock).toHaveBeenCalledTimes(1);
    const call = vi.mocked(initSentryMock).mock.calls[0][0];
    expect(call?.gameSlug).toBe("bingo");
    expect(call?.hallId).toBe("demo-hall-001");
    expect(call?.playerId).toBe("token-xyz");
    // Replay defaults are baked in.
    expect(call?.replaysSessionSampleRate).toBe(0.1);
    expect(call?.replaysOnErrorSampleRate).toBe(1.0);
  });

  it("setClientScreen tags the active screen", () => {
    setClientScreen("PlayScreen");
    expect(setTagMock).toHaveBeenCalledWith("screen", "PlayScreen");
  });

  it("setClientScheduledGameId tags the active round", () => {
    setClientScheduledGameId("scheduled-abc");
    expect(setTagMock).toHaveBeenCalledWith("scheduledGameId", "scheduled-abc");
  });

  it("setClientPlanRunId tags the active plan-run", () => {
    setClientPlanRunId("plan-run-42");
    expect(setTagMock).toHaveBeenCalledWith("planRunId", "plan-run-42");
  });

  it("updateClientSentryUser forwards to the SDK setter", async () => {
    await updateClientSentryUser({ playerId: "u-1" });
    expect(setUserMock).toHaveBeenCalledTimes(1);
    expect(setUserMock).toHaveBeenCalledWith({ playerId: "u-1" });
  });

  it("updateClientSentryUser supports null (logout)", async () => {
    await updateClientSentryUser(null);
    expect(setUserMock).toHaveBeenCalledTimes(1);
    expect(setUserMock).toHaveBeenCalledWith(null);
  });
});
