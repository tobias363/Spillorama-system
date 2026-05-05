import { describe, it, expect } from "vitest";
import { NetworkTap } from "./NetworkTap.js";

describe("NetworkTap", () => {
  it("records sent and received frames with size", () => {
    const tap = new NetworkTap(10);
    tap.record("sent", "draw:new", { number: 7 });
    tap.record("received", "draw:new", { number: 7, drawIndex: 1 });
    const frames = tap.frames();
    expect(frames).toHaveLength(2);
    expect(frames[0].direction).toBe("sent");
    expect(frames[0].size).toBeGreaterThan(0);
    expect(frames[1].direction).toBe("received");
  });

  it("respects the FIFO cap", () => {
    const tap = new NetworkTap(3);
    for (let i = 0; i < 5; i++) {
      tap.record("sent", `e${i}`, { i });
    }
    expect(tap.frames()).toHaveLength(3);
    expect(tap.frames()[0].eventType).toBe("e2");
  });

  it("size: -1 when payload is non-serialisable", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    const tap = new NetworkTap(5);
    const frame = tap.record("sent", "cyclic", cyclic);
    expect(frame.size).toBe(-1);
  });

  it("throughput excludes dropped frames and frames without size", () => {
    const tap = new NetworkTap(10);
    tap.record("sent", "a", { x: 1 });
    tap.record("sent", "b", { y: 2 }, { dropped: true });
    const tp = tap.throughput(10000);
    expect(tp.sent).toBeGreaterThan(0);
    expect(tp.received).toBe(0);
  });

  it("clear() empties everything", () => {
    const tap = new NetworkTap(5);
    tap.record("sent", "a", {});
    tap.clear();
    expect(tap.frames()).toEqual([]);
  });
});
