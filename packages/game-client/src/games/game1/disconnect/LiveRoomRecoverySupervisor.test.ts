import { describe, expect, it, vi } from "vitest";
import {
  LiveRoomRecoverySupervisor,
  type LiveRoomRecoverySupervisorOptions,
  type RecoveryContext,
  type SocketConnectionState,
} from "./LiveRoomRecoverySupervisor.js";

/**
 * Regresjons-tester for P0-2 (ekstern-konsulent-plan 2026-05-17).
 *
 * Verifiserer tre eskalerings-tier (resume → rejoin → hard reload) og
 * conditions for at hver tier fyrer. Bruker kontrollert klokke
 * (`fakeNow`) og dummy-interval slik at vi kan teste deterministisk
 * uten å vente på faktiske timeouts.
 */

interface TestHarness {
  fakeNow: number;
  ctx: RecoveryContext;
  resumeFlow: ReturnType<typeof vi.fn>;
  rejoinFlow: ReturnType<typeof vi.fn>;
  hardReload: ReturnType<typeof vi.fn>;
  tierTriggered: ReturnType<typeof vi.fn>;
  recoverySucceeded: ReturnType<typeof vi.fn>;
  supervisor: LiveRoomRecoverySupervisor;
  /** Bump klokka fremover med N millisekunder. */
  advance: (ms: number) => void;
}

function buildHarness(
  override: Partial<LiveRoomRecoverySupervisorOptions> = {},
  ctxOverride: Partial<RecoveryContext> = {},
): TestHarness {
  let fakeNow = 1_000_000;
  const ctx: RecoveryContext = {
    socketState: "connected" as SocketConnectionState,
    scheduledGameId: "sg-test-1",
    roomCode: "BINGO_GH_TEST",
    isRoomActive: true,
    ...ctxOverride,
  };
  const resumeFlow = vi.fn(async () => true);
  const rejoinFlow = vi.fn(async () => true);
  const hardReload = vi.fn(() => undefined);
  const tierTriggered = vi.fn();
  const recoverySucceeded = vi.fn();

  // No-op interval — tester kaller `tick()` eksplisitt for kontroll.
  const noopSetInterval = (() => 1) as unknown as typeof setInterval;
  const noopClearInterval = (() => undefined) as unknown as typeof clearInterval;

  const supervisor = new LiveRoomRecoverySupervisor({
    getContext: () => ctx,
    tryResumeFlow: resumeFlow,
    tryRejoinFlow: rejoinFlow,
    triggerHardReload: hardReload,
    now: () => fakeNow,
    setIntervalFn: noopSetInterval,
    clearIntervalFn: noopClearInterval,
    onTierTriggered: tierTriggered,
    onRecoverySucceeded: recoverySucceeded,
    ...override,
  });

  return {
    get fakeNow() { return fakeNow; },
    ctx,
    resumeFlow,
    rejoinFlow,
    hardReload,
    tierTriggered,
    recoverySucceeded,
    supervisor,
    advance(ms: number) { fakeNow += ms; },
  };
}

describe("LiveRoomRecoverySupervisor", () => {
  describe("threshold-validering", () => {
    it("aksepterer default-thresholds (10s / 30s / 60s)", () => {
      expect(() => buildHarness()).not.toThrow();
    });

    it("kaster hvis tier1 >= tier2", () => {
      expect(() =>
        buildHarness({ tier1ThresholdMs: 30_000, tier2ThresholdMs: 30_000 }),
      ).toThrow(/tier1 < tier2/);
    });

    it("kaster hvis tier2 >= tier3", () => {
      expect(() =>
        buildHarness({ tier2ThresholdMs: 60_000, tier3ThresholdMs: 60_000 }),
      ).toThrow(/tier1 < tier2/);
    });
  });

  describe("fresh state — ingen eskalering", () => {
    it("fyrer ingen tier når fresh update kom for < 10s siden", async () => {
      const h = buildHarness();
      h.supervisor.markUpdateReceived();
      h.advance(5_000); // 5s — under tier1-threshold
      await h.supervisor.tick();

      expect(h.resumeFlow).not.toHaveBeenCalled();
      expect(h.rejoinFlow).not.toHaveBeenCalled();
      expect(h.hardReload).not.toHaveBeenCalled();
      expect(h.tierTriggered).not.toHaveBeenCalled();
      expect(h.supervisor.getCurrentFiredTier()).toBe(0);
    });

    it("eskalering resettes når markUpdateReceived() kalles", async () => {
      const h = buildHarness();
      h.supervisor.markUpdateReceived();
      h.advance(15_000); // 15s — over tier1
      await h.supervisor.tick();
      expect(h.supervisor.getCurrentFiredTier()).toBe(1);

      h.supervisor.markUpdateReceived();
      expect(h.supervisor.getCurrentFiredTier()).toBe(0);
    });
  });

  describe("Tier 1 — resumeRoom etter 10s", () => {
    it("kaller tryResumeFlow når stale > 10s, < 30s", async () => {
      const h = buildHarness();
      h.supervisor.markUpdateReceived();
      h.advance(11_000); // 11s
      await h.supervisor.tick();

      expect(h.resumeFlow).toHaveBeenCalledTimes(1);
      expect(h.rejoinFlow).not.toHaveBeenCalled();
      expect(h.hardReload).not.toHaveBeenCalled();
      expect(h.tierTriggered).toHaveBeenCalledWith(1, expect.stringContaining("tier1"), 11_000);
      expect(h.supervisor.getCurrentFiredTier()).toBe(1);
    });

    it("kaller onRecoverySucceeded når tryResumeFlow returnerer true", async () => {
      const h = buildHarness();
      h.supervisor.markUpdateReceived();
      h.advance(11_000);
      await h.supervisor.tick();

      expect(h.recoverySucceeded).toHaveBeenCalledWith(1, expect.any(Number));
    });

    it("kaller IKKE onRecoverySucceeded når tryResumeFlow returnerer false", async () => {
      const h = buildHarness({ tryResumeFlow: async () => false });
      h.supervisor.markUpdateReceived();
      h.advance(11_000);
      await h.supervisor.tick();

      expect(h.recoverySucceeded).not.toHaveBeenCalled();
      expect(h.supervisor.getCurrentFiredTier()).toBe(1);
    });

    it("fyrer ikke samme tier to ganger på rad uten ny stale-overgang", async () => {
      const h = buildHarness();
      h.supervisor.markUpdateReceived();
      h.advance(11_000);
      await h.supervisor.tick();
      h.advance(5_000); // total 16s — fortsatt i tier1-range
      await h.supervisor.tick();

      expect(h.resumeFlow).toHaveBeenCalledTimes(1); // ikke fyrt på nytt
    });
  });

  describe("Tier 2 — rejoin etter 30s", () => {
    it("kaller tryRejoinFlow når stale > 30s, < 60s (etter tier1 har fyrt)", async () => {
      const h = buildHarness();
      h.supervisor.markUpdateReceived();
      h.advance(11_000);
      await h.supervisor.tick(); // tier 1 fyrer
      h.advance(20_000); // total 31s
      await h.supervisor.tick();

      expect(h.resumeFlow).toHaveBeenCalledTimes(1);
      expect(h.rejoinFlow).toHaveBeenCalledTimes(1);
      expect(h.hardReload).not.toHaveBeenCalled();
      expect(h.supervisor.getCurrentFiredTier()).toBe(2);
    });

    it("hopper rett til tier 2 hvis stale går direkte over 30s uten å treffe tier 1", async () => {
      const h = buildHarness();
      h.supervisor.markUpdateReceived();
      h.advance(35_000);
      await h.supervisor.tick();

      // Tier 2 trigget — tier 1 ble hoppet over fordi firedTier var 0.
      // Algoritmen sjekker tier 3 først, så tier 2, så tier 1 — første
      // match vinner. Her er stalenessMs = 35s ⇒ tier 2 (mellom 30 og 60).
      expect(h.rejoinFlow).toHaveBeenCalledTimes(1);
      expect(h.resumeFlow).not.toHaveBeenCalled();
      expect(h.supervisor.getCurrentFiredTier()).toBe(2);
    });
  });

  describe("Tier 3 — hard reload etter 60s", () => {
    it("kaller triggerHardReload når stale > 60s", async () => {
      const h = buildHarness();
      h.supervisor.markUpdateReceived();
      h.advance(65_000);
      await h.supervisor.tick();

      expect(h.hardReload).toHaveBeenCalledTimes(1);
      expect(h.tierTriggered).toHaveBeenCalledWith(3, expect.any(String), 65_000);
      expect(h.supervisor.getCurrentFiredTier()).toBe(3);
    });

    it("venter IKKE på recovery-callback for tier 3 (page er borte etter reload)", async () => {
      const h = buildHarness();
      h.supervisor.markUpdateReceived();
      h.advance(65_000);
      await h.supervisor.tick();

      // recoverySucceeded SKAL IKKE fyres for tier 3
      expect(h.recoverySucceeded).not.toHaveBeenCalled();
    });
  });

  describe("eskalerings-conditions (gate-paths)", () => {
    it("eskalerer IKKE når socket er reconnecting", async () => {
      const h = buildHarness({}, { socketState: "reconnecting" });
      h.supervisor.markUpdateReceived();
      h.advance(20_000);
      await h.supervisor.tick();

      expect(h.resumeFlow).not.toHaveBeenCalled();
      expect(h.tierTriggered).not.toHaveBeenCalled();
    });

    it("eskalerer IKKE når socket er disconnected (AutoReloadOnDisconnect-territorium)", async () => {
      const h = buildHarness({}, { socketState: "disconnected" });
      h.supervisor.markUpdateReceived();
      h.advance(20_000);
      await h.supervisor.tick();

      expect(h.resumeFlow).not.toHaveBeenCalled();
    });

    it("eskalerer IKKE når isRoomActive=false (LOADING / ENDED / pre-join)", async () => {
      const h = buildHarness({}, { isRoomActive: false });
      h.supervisor.markUpdateReceived();
      h.advance(20_000);
      await h.supervisor.tick();

      expect(h.resumeFlow).not.toHaveBeenCalled();
    });

    it("fortsetter eskalering når isRoomActive blir true igjen", async () => {
      const h = buildHarness({}, { isRoomActive: false });
      h.supervisor.markUpdateReceived();
      h.advance(20_000);
      await h.supervisor.tick(); // no-op

      // Flip til aktiv — fresh data har likevel ikke kommet.
      h.ctx.isRoomActive = true;
      await h.supervisor.tick();

      // 20 s siden siste update + isRoomActive=true ⇒ tier 1.
      expect(h.resumeFlow).toHaveBeenCalledTimes(1);
    });
  });

  describe("in-flight isolation", () => {
    it("skip-er nye ticks mens en tier-handling pågår", async () => {
      let resolveResume!: (ok: boolean) => void;
      const slowResume = vi.fn(
        () => new Promise<boolean>((resolve) => { resolveResume = resolve; }),
      );
      const h = buildHarness({ tryResumeFlow: slowResume });
      h.supervisor.markUpdateReceived();
      h.advance(11_000);

      // Start tick — resumeFlow er ikke resolved enda.
      const tick1 = h.supervisor.tick();
      h.advance(1_000);
      await h.supervisor.tick(); // skal være no-op
      h.advance(1_000);
      await h.supervisor.tick(); // skal være no-op

      expect(slowResume).toHaveBeenCalledTimes(1); // ikke kallet flere ganger

      // Resolve første call.
      resolveResume(true);
      await tick1;
    });

    it("kan eskalere til neste tier etter at in-flight resolver", async () => {
      const h = buildHarness();
      h.supervisor.markUpdateReceived();
      h.advance(11_000);
      await h.supervisor.tick(); // tier 1 ferdig
      // markUpdateReceived er IKKE kalt — staleness består.
      h.advance(20_000); // total 31s ⇒ tier 2
      await h.supervisor.tick();

      expect(h.rejoinFlow).toHaveBeenCalledTimes(1);
    });
  });

  describe("error-håndtering", () => {
    it("fail-soft når tryResumeFlow kaster — firedTier beholdes", async () => {
      const h = buildHarness({
        tryResumeFlow: async () => { throw new Error("network down"); },
      });
      h.supervisor.markUpdateReceived();
      h.advance(11_000);
      await h.supervisor.tick();

      // Skal IKKE krasje
      expect(h.supervisor.getCurrentFiredTier()).toBe(1);
      expect(h.recoverySucceeded).not.toHaveBeenCalled();
    });

    it("fail-soft når tryRejoinFlow kaster", async () => {
      const h = buildHarness({
        tryRejoinFlow: async () => { throw new Error("rejoin failed"); },
      });
      h.supervisor.markUpdateReceived();
      h.advance(35_000);
      await h.supervisor.tick();

      expect(h.supervisor.getCurrentFiredTier()).toBe(2);
      expect(h.recoverySucceeded).not.toHaveBeenCalled();
    });
  });

  describe("lifecycle", () => {
    it("start() er idempotent", () => {
      const h = buildHarness();
      h.supervisor.start();
      h.supervisor.start(); // no-op
      h.supervisor.stop();
    });

    it("stop() før start() er trygg no-op", () => {
      const h = buildHarness();
      expect(() => h.supervisor.stop()).not.toThrow();
    });

    it("setInterval kalles én gang ved start", () => {
      const setIntervalSpy = vi.fn(() => 42);
      const clearIntervalSpy = vi.fn();
      const h = buildHarness({
        setIntervalFn: setIntervalSpy as unknown as typeof setInterval,
        clearIntervalFn: clearIntervalSpy as unknown as typeof clearInterval,
      });
      h.supervisor.start();
      expect(setIntervalSpy).toHaveBeenCalledTimes(1);
      h.supervisor.stop();
      expect(clearIntervalSpy).toHaveBeenCalled();
    });
  });

  describe("integrasjon — full lifecycle scenario", () => {
    it("scenario: fresh → stale → tier 1 → success → fresh igjen", async () => {
      const h = buildHarness();
      h.supervisor.markUpdateReceived();

      // 5s: fresh, ingen eskalering
      h.advance(5_000);
      await h.supervisor.tick();
      expect(h.supervisor.getCurrentFiredTier()).toBe(0);

      // 12s siden: tier 1 fyrer
      h.advance(7_000);
      await h.supervisor.tick();
      expect(h.supervisor.getCurrentFiredTier()).toBe(1);
      expect(h.resumeFlow).toHaveBeenCalledTimes(1);
      expect(h.recoverySucceeded).toHaveBeenCalledWith(1, expect.any(Number));

      // Backend sender room:update etter recovery
      h.supervisor.markUpdateReceived();
      expect(h.supervisor.getCurrentFiredTier()).toBe(0);

      // Ny stale-overgang etter mer tid
      h.advance(35_000);
      await h.supervisor.tick();
      // Stale 35s siden ny markUpdateReceived ⇒ tier 2
      expect(h.rejoinFlow).toHaveBeenCalledTimes(1);
    });

    it("scenario: tier 1 → tier 2 → tier 3 monoton eskalering", async () => {
      const h = buildHarness({
        tryResumeFlow: async () => false,
        tryRejoinFlow: async () => false,
      });
      h.supervisor.markUpdateReceived();

      h.advance(11_000);
      await h.supervisor.tick();
      expect(h.supervisor.getCurrentFiredTier()).toBe(1);

      h.advance(20_000); // total 31s
      await h.supervisor.tick();
      expect(h.supervisor.getCurrentFiredTier()).toBe(2);

      h.advance(30_000); // total 61s
      await h.supervisor.tick();
      expect(h.supervisor.getCurrentFiredTier()).toBe(3);
      expect(h.hardReload).toHaveBeenCalledTimes(1);
    });
  });
});
