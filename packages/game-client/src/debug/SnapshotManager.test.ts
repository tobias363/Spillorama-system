import { describe, it, expect } from "vitest";
import { SnapshotManager, decorateSnapshotForExport } from "./SnapshotManager.js";
import { EventBuffer } from "./EventBuffer.js";

describe("SnapshotManager", () => {
  it("captures buffer + state + env in a snapshot", async () => {
    const buf = new EventBuffer(10);
    buf.record({
      seq: 1,
      timestamp: Date.now(),
      performanceTime: 1,
      source: "engine",
      type: "test",
      traceId: "T-1",
    });
    const mgr = new SnapshotManager(buf);
    mgr.setStateGetter(() => ({ counter: 5 }));
    await mgr.init();
    const snap = await mgr.takeSnapshot("manual-test");
    expect(snap.id).toMatch(/^snap-\d{4}$/);
    expect(snap.reason).toBe("manual-test");
    expect(snap.events).toHaveLength(1);
    expect((snap.state as { counter: number }).counter).toBe(5);
    expect(snap.env.userAgent.length).toBeLessThanOrEqual(256);
  });

  it("list() returns all snapshots in insertion order", async () => {
    const mgr = new SnapshotManager(new EventBuffer(5));
    await mgr.init();
    await mgr.takeSnapshot("a");
    await mgr.takeSnapshot("b");
    const list = mgr.list();
    expect(list.map((s) => s.reason)).toEqual(["a", "b"]);
  });

  it("get() resolves by id; returns null for unknown", async () => {
    const mgr = new SnapshotManager(new EventBuffer(5));
    await mgr.init();
    const snap = await mgr.takeSnapshot("x");
    expect(mgr.get(snap.id)?.reason).toBe("x");
    expect(mgr.get("snap-9999")).toBeNull();
  });

  it("decorateSnapshotForExport returns JSON-stringifiable export", async () => {
    const mgr = new SnapshotManager(new EventBuffer(5));
    await mgr.init();
    const snap = await mgr.takeSnapshot("export-me");
    const decorated = decorateSnapshotForExport(snap);
    expect(typeof decorated.export()).toBe("string");
    const parsed = JSON.parse(decorated.export());
    expect(parsed.reason).toBe("export-me");
  });

  it("auto-capture is rate-limited to once per second", async () => {
    const mgr = new SnapshotManager(new EventBuffer(5));
    await mgr.init();
    const a = await mgr.maybeAutoCapture("a");
    const b = await mgr.maybeAutoCapture("b");
    expect(a).not.toBeNull();
    expect(b).toBeNull();
  });

  it("clips events with payloads larger than 4KB", async () => {
    const buf = new EventBuffer(5);
    const big = "x".repeat(8000);
    buf.record({
      seq: 1,
      timestamp: Date.now(),
      performanceTime: 1,
      source: "engine",
      type: "big",
      traceId: "B-1",
      payload: big,
    });
    const mgr = new SnapshotManager(buf);
    await mgr.init();
    const snap = await mgr.takeSnapshot("clip");
    expect(typeof snap.events[0].payload).toBe("string");
    expect(snap.events[0].payload).toMatch(/^\[clipped \d+ bytes\]$/);
  });
});
