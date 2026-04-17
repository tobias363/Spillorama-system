import { Container, Graphics } from "pixi.js";
import gsap from "gsap";

/**
 * G2 signature: vertical rocket that builds up one segment per draw.
 * Port of legacy Unity LeanTween rocket-stabling — see game2-canonical-spec.md §8.
 */
export class RocketStack extends Container {
  private readonly width_: number;
  private readonly height_: number;
  private readonly totalSegments: number;
  private readonly segmentHeight: number;
  private readonly segments: Graphics[] = [];
  private readonly column: Container;

  constructor(width: number, height: number, totalSegments: number) {
    super();
    this.width_ = width;
    this.height_ = height;
    this.totalSegments = Math.max(1, totalSegments);
    this.segmentHeight = height / this.totalSegments;

    const frame = new Graphics();
    frame.roundRect(0, 0, width, height, 6);
    frame.stroke({ color: 0x790001, width: 1, alpha: 0.6 });
    frame.fill({ color: 0x1a0000, alpha: 0.4 });
    this.addChild(frame);

    this.column = new Container();
    this.addChild(this.column);

    const nose = new Graphics();
    nose.moveTo(width / 2, -12);
    nose.lineTo(width - 2, 2);
    nose.lineTo(2, 2);
    nose.closePath();
    nose.fill(0xffe83d);
    this.addChild(nose);
  }

  /** Sync stack to a specific draw count (used on state restore / late-join). */
  syncTo(drawCount: number): void {
    const target = Math.min(drawCount, this.totalSegments);
    while (this.segments.length > target) {
      const seg = this.segments.pop();
      if (seg) this.column.removeChild(seg);
    }
    while (this.segments.length < target) {
      this.addSegmentImmediate();
    }
  }

  /** Animate one new segment stacking on top — called on each draw. */
  addSegment(): void {
    if (this.segments.length >= this.totalSegments) return;
    const seg = this.buildSegment(this.segments.length);
    seg.alpha = 0;
    seg.scale.y = 0.2;
    this.column.addChild(seg);
    this.segments.push(seg);
    gsap.to(seg, { alpha: 1, duration: 0.25, ease: "power1.out" });
    gsap.to(seg.scale, { y: 1, duration: 0.35, ease: "back.out(2)" });
  }

  reset(): void {
    for (const seg of this.segments) this.column.removeChild(seg);
    this.segments.length = 0;
  }

  destroy(options?: Parameters<Container["destroy"]>[0]): void {
    for (const seg of this.segments) gsap.killTweensOf(seg);
    super.destroy(options);
  }

  private addSegmentImmediate(): void {
    const seg = this.buildSegment(this.segments.length);
    this.column.addChild(seg);
    this.segments.push(seg);
  }

  private buildSegment(index: number): Graphics {
    const padding = 3;
    const segW = this.width_ - padding * 2;
    const segH = this.segmentHeight - 2;
    const yFromBottom = this.height_ - (index + 1) * this.segmentHeight + 1;
    const t = index / Math.max(1, this.totalSegments - 1);
    const color = this.gradientColor(t);
    const g = new Graphics();
    g.roundRect(padding, yFromBottom, segW, segH, 2);
    g.fill(color);
    return g;
  }

  private gradientColor(t: number): number {
    const r1 = 0xa0, g1 = 0x00, b1 = 0x20;
    const r2 = 0xff, g2 = 0xe8, b2 = 0x3d;
    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);
    return (r << 16) | (g << 8) | b;
  }
}
