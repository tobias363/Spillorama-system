import { describe, expect, it } from "vitest";
import { resolveAppView } from "@/app/App";
import {
  resolveBonusTestMode,
  shouldDeferTheme1LiveChrome,
  shouldHoldTheme1LiveChromeDuringSettle,
} from "@/features/theme1/components/Theme1GameShell";

describe("resolveAppView", () => {
  it("returns the game shell for the root path", () => {
    expect(resolveAppView("/")).toBe("game");
  });

  it("returns the animation lab for supported lab paths", () => {
    expect(resolveAppView("/animation-lab")).toBe("animation-lab");
    expect(resolveAppView("/animation-lab/")).toBe("animation-lab");
    expect(resolveAppView("/animasjon-lab")).toBe("animation-lab");
  });

  it("falls back to the game shell for unknown paths", () => {
    expect(resolveAppView("/ukjent-side")).toBe("game");
  });
});

describe("resolveBonusTestMode", () => {
  it("returns the requested bonus test mode from the query string", () => {
    expect(resolveBonusTestMode("?bonusTest=random")).toBe("random");
    expect(resolveBonusTestMode("?bonusTest=win")).toBe("win");
    expect(resolveBonusTestMode("?foo=bar&bonusTest=WIN")).toBe("win");
  });

  it("returns null for unsupported or missing bonus test values", () => {
    expect(resolveBonusTestMode("")).toBeNull();
    expect(resolveBonusTestMode("?bonusTest=unknown")).toBeNull();
  });
});

describe("shouldDeferTheme1LiveChrome", () => {
  it("blocks the live chrome on non-local hosts while the room is still loading", () => {
    expect(
      shouldDeferTheme1LiveChrome({
        hostname: "bingosystem-staging.onrender.com",
        mode: "mock",
        connectionPhase: "connecting",
        hasRoomSnapshot: false,
      }),
    ).toBe(true);
  });

  it("releases the live chrome when a connected live room snapshot exists", () => {
    expect(
      shouldDeferTheme1LiveChrome({
        hostname: "bingosystem-staging.onrender.com",
        mode: "live",
        connectionPhase: "connected",
        hasRoomSnapshot: true,
      }),
    ).toBe(false);
  });

  it("does not block on localhost", () => {
    expect(
      shouldDeferTheme1LiveChrome({
        hostname: "127.0.0.1",
        mode: "mock",
        connectionPhase: "connecting",
        hasRoomSnapshot: false,
      }),
    ).toBe(false);
  });

  it("does not trap the user behind a loader on live bootstrap errors", () => {
    expect(
      shouldDeferTheme1LiveChrome({
        hostname: "bingosystem-staging.onrender.com",
        mode: "mock",
        connectionPhase: "error",
        hasRoomSnapshot: false,
      }),
    ).toBe(false);
  });
});

describe("shouldHoldTheme1LiveChromeDuringSettle", () => {
  it("keeps the loader up briefly after the live room is connected on non-local hosts", () => {
    expect(
      shouldHoldTheme1LiveChromeDuringSettle({
        hostname: "bingosystem-staging.onrender.com",
        mode: "live",
        connectionPhase: "connected",
        hasRoomSnapshot: true,
        settleDelayComplete: false,
      }),
    ).toBe(true);
  });

  it("releases the loader after the settle delay has completed", () => {
    expect(
      shouldHoldTheme1LiveChromeDuringSettle({
        hostname: "bingosystem-staging.onrender.com",
        mode: "live",
        connectionPhase: "connected",
        hasRoomSnapshot: true,
        settleDelayComplete: true,
      }),
    ).toBe(false);
  });

  it("never adds the extra settle delay on localhost", () => {
    expect(
      shouldHoldTheme1LiveChromeDuringSettle({
        hostname: "127.0.0.1",
        mode: "live",
        connectionPhase: "connected",
        hasRoomSnapshot: true,
        settleDelayComplete: false,
      }),
    ).toBe(false);
  });
});
