import { test, expect, gotoScenario, captureFrameSeries } from "./fixtures/harness";
import { PNG } from "pngjs";

/**
 * Flicker-guard: in a state that should be idle (no tweens active, no
 * countdown visible), five consecutive frames taken ~100ms apart should
 * be byte-identical or very nearly so.
 *
 * We use our own pixel-compare rather than toHaveScreenshot because we're
 * comparing frames to each OTHER, not to a baseline. Tiny sub-pixel drift
 * (e.g. Pixi's WebGL rasteriser producing deterministic but slightly
 * different antialiasing between contexts) is tolerated at 0.1%; anything
 * above that is a real visual change mid-capture.
 */

const MAX_ALLOWED_DIFF_RATIO = 0.001; // 0.1%

function comparePngs(a: Buffer, b: Buffer): { diffPixels: number; totalPixels: number } {
  const pngA = PNG.sync.read(a);
  const pngB = PNG.sync.read(b);
  if (pngA.width !== pngB.width || pngA.height !== pngB.height) {
    throw new Error(
      `Frame size mismatch: ${pngA.width}x${pngA.height} vs ${pngB.width}x${pngB.height}`,
    );
  }
  let diff = 0;
  const len = pngA.data.length;
  for (let i = 0; i < len; i += 4) {
    // Compare RGB only; ignore alpha (always 255 in screenshot PNGs).
    if (
      pngA.data[i] !== pngB.data[i] ||
      pngA.data[i + 1] !== pngB.data[i + 1] ||
      pngA.data[i + 2] !== pngB.data[i + 2]
    ) {
      diff += 1;
    }
  }
  return { diffPixels: diff, totalPixels: (len / 4) };
}

test.describe("spill1 — idle flicker guard", () => {
  test("5 frames taken 100ms apart are stable", async ({ page }) => {
    await gotoScenario(page, "idle");
    // One extra settle window after markReady; harness already waits 300ms.
    await page.waitForTimeout(400);

    const frames = await captureFrameSeries(page, 5, 100);
    const [first, ...rest] = frames;
    const worstDiff: { idx: number; ratio: number } = { idx: 0, ratio: 0 };
    rest.forEach((frame, i) => {
      const { diffPixels, totalPixels } = comparePngs(first, frame);
      const ratio = diffPixels / totalPixels;
      if (ratio > worstDiff.ratio) {
        worstDiff.idx = i + 1;
        worstDiff.ratio = ratio;
      }
    });
    expect(
      worstDiff.ratio,
      `Idle frames differ across capture window. Worst: frame ${worstDiff.idx} ` +
        `= ${(worstDiff.ratio * 100).toFixed(3)}% pixel drift. ` +
        `This is the signal a flicker regression is landing on the page.`,
    ).toBeLessThanOrEqual(MAX_ALLOWED_DIFF_RATIO);
  });
});
