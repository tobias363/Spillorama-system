import { describe, expect, it } from "vitest";
import {
  clampStakeAmount,
  isLocalTheme1RuntimeHost,
  resolveAdjustedStakeAmount,
  resolveStakeAmountBeforeArming,
  resolveTheme1InitialSessionSeed,
  shouldRedirectTheme1ToPortalOnLiveHost,
  shouldAutoBootstrapDefaultLiveSession,
  shouldAttemptLiveRoomRecoveryFromSyncFailure,
  canonicalizeTheme1LiveSession,
} from "@/features/theme1/hooks/useTheme1Store";

describe("theme1 stake controls", () => {
  it("uses 4 kr steps up to 20 kr", () => {
    expect(resolveAdjustedStakeAmount(0, 4)).toBe(4);
    expect(resolveAdjustedStakeAmount(4, 4)).toBe(8);
    expect(resolveAdjustedStakeAmount(8, 4)).toBe(12);
    expect(resolveAdjustedStakeAmount(12, 4)).toBe(16);
    expect(resolveAdjustedStakeAmount(16, 4)).toBe(20);
    expect(resolveAdjustedStakeAmount(20, 4)).toBe(20);
  });

  it("steps back down to 0 kr", () => {
    expect(resolveAdjustedStakeAmount(20, -4)).toBe(16);
    expect(resolveAdjustedStakeAmount(8, -4)).toBe(4);
    expect(resolveAdjustedStakeAmount(4, -4)).toBe(0);
    expect(resolveAdjustedStakeAmount(0, -4)).toBe(0);
  });

  it("clamps arbitrary stake values to valid total stake steps", () => {
    expect(clampStakeAmount(2)).toBe(0);
    expect(clampStakeAmount(6)).toBe(4);
    expect(clampStakeAmount(21)).toBe(20);
    expect(clampStakeAmount(99)).toBe(20);
  });

  it("auto-arms to 4 kr when the current stake is 0 kr", () => {
    expect(resolveStakeAmountBeforeArming(0)).toBe(4);
    expect(resolveStakeAmountBeforeArming(4)).toBe(4);
    expect(resolveStakeAmountBeforeArming(12)).toBe(12);
  });

  it("treats localhost hosts as local runtime hosts", () => {
    expect(isLocalTheme1RuntimeHost("127.0.0.1")).toBe(true);
    expect(isLocalTheme1RuntimeHost("localhost")).toBe(true);
    expect(isLocalTheme1RuntimeHost("bingosystem-staging.onrender.com")).toBe(false);
  });

  it("redirects non-local candy hosts back to the portal when portal auth is missing", () => {
    expect(
      shouldRedirectTheme1ToPortalOnLiveHost({
        hostname: "bingosystem-staging.onrender.com",
        accessToken: "",
      }),
    ).toBe(true);

    expect(
      shouldRedirectTheme1ToPortalOnLiveHost({
        hostname: "bingosystem-staging.onrender.com",
        accessToken: "portal-token",
      }),
    ).toBe(false);

    expect(
      shouldRedirectTheme1ToPortalOnLiveHost({
        hostname: "127.0.0.1",
        accessToken: "",
      }),
    ).toBe(false);
  });

  it("does not auto-bootstrap a synthetic live session on staging", () => {
    expect(
      shouldAutoBootstrapDefaultLiveSession(
        {
          baseUrl: "https://bingosystem-staging.onrender.com",
          roomCode: "",
          playerId: "",
          accessToken: "",
          hallId: "",
        },
        {
          hostname: "bingosystem-staging.onrender.com",
          hasLaunchToken: false,
        },
      ),
    ).toBe(false);
  });

  it("does not auto-bootstrap when there is an explicit launch token or existing session", () => {
    expect(
      shouldAutoBootstrapDefaultLiveSession(
        {
          baseUrl: "https://bingosystem-staging.onrender.com",
          roomCode: "",
          playerId: "",
          accessToken: "",
          hallId: "",
        },
        {
          hostname: "bingosystem-staging.onrender.com",
          hasLaunchToken: true,
        },
      ),
    ).toBe(false);

    expect(
      shouldAutoBootstrapDefaultLiveSession(
        {
          baseUrl: "https://bingosystem-staging.onrender.com",
          roomCode: "ABC123",
          playerId: "",
          accessToken: "",
          hallId: "",
        },
        {
          hostname: "bingosystem-staging.onrender.com",
        },
      ),
    ).toBe(false);
  });

  it("does not auto-bootstrap synthetic live sessions on non-local hosts", () => {
    expect(
      shouldAutoBootstrapDefaultLiveSession(
        {
          baseUrl: "https://bingosystem-staging.onrender.com",
          roomCode: "",
          playerId: "",
          accessToken: "stale-token",
          hallId: "",
        },
        {
          hostname: "bingosystem-staging.onrender.com",
        },
      ),
    ).toBe(false);
  });

  it("does not auto-bootstrap on localhost either", () => {
    expect(
      shouldAutoBootstrapDefaultLiveSession(
        {
          baseUrl: "http://127.0.0.1:4000",
          roomCode: "",
          playerId: "",
          accessToken: "",
          hallId: "",
        },
        {
          hostname: "127.0.0.1",
          hasLaunchToken: false,
        },
      ),
    ).toBe(false);
  });

  it("recovers stale room sessions by falling back to canonical room create", () => {
    expect(
      shouldAttemptLiveRoomRecoveryFromSyncFailure(
        {
          baseUrl: "https://bingosystem-staging.onrender.com",
          roomCode: "OLD123",
          playerId: "player-1",
          accessToken: "valid-token",
          hallId: "hall-default",
        },
        "FORBIDDEN",
      ),
    ).toBe(true);
  });

  it("does not attempt recovery without enough session data or for non-recoverable errors", () => {
    expect(
      shouldAttemptLiveRoomRecoveryFromSyncFailure(
        {
          baseUrl: "https://bingosystem-staging.onrender.com",
          roomCode: "OLD123",
          playerId: "player-1",
          accessToken: "",
          hallId: "hall-default",
        },
        "FORBIDDEN",
      ),
    ).toBe(false);

    expect(
      shouldAttemptLiveRoomRecoveryFromSyncFailure(
        {
          baseUrl: "https://bingosystem-staging.onrender.com",
          roomCode: "OLD123",
          playerId: "player-1",
          accessToken: "valid-token",
          hallId: "hall-default",
        },
        "UNAUTHORIZED",
      ),
    ).toBe(false);
  });

  it("prefers portal auth on non-local hosts and clears all stale room bindings", () => {
    const seed = resolveTheme1InitialSessionSeed({
      storedSession: {
        baseUrl: "https://bingosystem-staging.onrender.com",
        roomCode: "OLD123",
        playerId: "player-1",
        accessToken: "stale-candy-token",
        hallId: "",
      },
      search: "",
      hostname: "bingosystem-staging.onrender.com",
      portalAuthAccessToken: "fresh-portal-token",
    });

    expect(seed.accessTokenSource).toBe("portal-storage");
    expect(seed.session.accessToken).toBe("fresh-portal-token");
    expect(seed.session.roomCode).toBe("CANDY1");
    expect(seed.session.playerId).toBe("");
    expect(seed.session.hallId).toBe("default-hall");
  });

  it("forces a fresh canonical room join on non-local hosts even when portal auth matches", () => {
    const seed = resolveTheme1InitialSessionSeed({
      storedSession: {
        baseUrl: "https://bingosystem-staging.onrender.com",
        roomCode: "ROOM42",
        playerId: "player-42",
        accessToken: "shared-token",
        hallId: "default-hall",
      },
      search: "",
      hostname: "bingosystem-staging.onrender.com",
      portalAuthAccessToken: "shared-token",
    });

    expect(seed.accessTokenSource).toBe("portal-storage");
    expect(seed.session.roomCode).toBe("CANDY1");
    expect(seed.session.playerId).toBe("");
    expect(seed.session.hallId).toBe("default-hall");
  });

  it("does not reuse stored candy room bindings on non-local hosts", () => {
    const seed = resolveTheme1InitialSessionSeed({
      storedSession: {
        baseUrl: "https://bingosystem-staging.onrender.com",
        roomCode: "CANDY1",
        playerId: "player-42",
        accessToken: "shared-token",
        hallId: "default-hall",
      },
      search: "",
      hostname: "bingosystem-staging.onrender.com",
      portalAuthAccessToken: "shared-token",
    });

    expect(seed.session.roomCode).toBe("CANDY1");
    expect(seed.session.playerId).toBe("");
  });

  it("canonicalizes live-host sessions to fixed Candy room and clears player binding", () => {
    expect(
      canonicalizeTheme1LiveSession(
        {
          baseUrl: "https://bingosystem-staging.onrender.com",
          roomCode: "",
          playerId: "stale-player",
          accessToken: "portal-token",
          hallId: "",
        },
        "bingosystem-staging.onrender.com",
      ),
    ).toEqual({
      baseUrl: "https://bingosystem-staging.onrender.com",
      roomCode: "CANDY1",
      playerId: "",
      accessToken: "portal-token",
      hallId: "default-hall",
    });
  });

  it("ignores a stale stored candy token on non-local hosts when portal auth is missing", () => {
    const seed = resolveTheme1InitialSessionSeed({
      storedSession: {
        baseUrl: "https://bingosystem-staging.onrender.com",
        roomCode: "CANDY1",
        playerId: "player-42",
        accessToken: "stale-candy-token",
        hallId: "default-hall",
      },
      search: "",
      hostname: "bingosystem-staging.onrender.com",
      portalAuthAccessToken: "",
    });

    expect(seed.accessTokenSource).toBe("none");
    expect(seed.session.accessToken).toBe("");
    expect(seed.session.roomCode).toBe("CANDY1");
    expect(seed.session.playerId).toBe("");
  });
});
