import { Container, Graphics, Text } from "pixi.js";
import gsap from "gsap";

/**
 * Vertical glass tube of drawn bingo balls — Unity-parity port of
 * `BingoBallPanelManager` (the 1, not the 2 — Game 1 uses the simpler
 * vertical layout, not Game 2/3's horizontal big-ball variant).
 *
 * Layout (Unity-faithful):
 *   - Newest ball at the TOP of the tube. Oldest at the BOTTOM.
 *   - Bottom of stack drops off-screen below when the tube is full.
 *   - The most recently drawn ball is rendered HIGHLIGHT_SCALE (1.15);
 *     the previous "highlighted" ball animates back to NORMAL_SCALE
 *     (0.85) over SCALE_TIME at the moment a new draw arrives.
 *
 * Animation timings come straight from
 * `Spillorama/Assets/_Project/_Scripts/Panels/BingoBallPanelManager.cs`:
 *   bingoBallSize = 90
 *   bingoBallDistance = 100
 *   bingoBallHighlightScale = 1.15
 *   bingoBallMovementAnimationTime = 0.5s
 *   bingoBallScaleAnimationTime = 0.25s
 */

const TUBE_WIDTH = 96;
const BALL_SIZE = 90;          // Unity bingoBallSize
const BALL_DISTANCE = 100;     // Unity bingoBallDistance (centre-to-centre)
const PAD_TOP = 8;
const HIGHLIGHT_SCALE = 1.15;  // Unity bingoBallHighlightScale
const NORMAL_SCALE = 0.85;     // Unity SetNormalSizeOfBingoBalls target
const MOVE_TIME = 0.5;         // Unity bingoBallMovementAnimationTime (seconds)
const SCALE_TIME = 0.25;       // Unity bingoBallScaleAnimationTime

type Ball = Container & { ballNumber: number };

/**
 * BIN-619 Bug 6: Unity-parity movement time. Port of
 * `BingoBallPanelManager.cs:249 GetAnimationTime`.
 *
 * The move animation accelerates as the tube fills — at an empty tube a
 * new ball slides in over 0.5s, but once the tube is full the shift is
 * only ~0.17s so rapid draws don't feel sluggish.
 *
 * Unity formula (verbatim):
 *   if (activeBingoBalls == bingoBallShowcaseCount)
 *       return ((bingoBallLimit - activeBingoBalls + 1) * 0.5) / bingoBallLimit;
 *   else
 *       return ((bingoBallLimit - activeBingoBalls) * 0.5) / bingoBallLimit;
 *
 * Where `bingoBallLimit = bingoBallShowcaseCount + 1` (one transit slot).
 *
 * `activeBefore` is the count BEFORE the new ball was added — matches
 * Unity's `activeBingoBalls` at the time `GetAnimationTime()` is called
 * (Unity increments the counter only after the move animation kicks off).
 *
 * Exported so it can be unit-tested without touching Pixi.
 */
export function getMoveAnimationTime(activeBefore: number, showcaseCount: number): number {
  const limit = showcaseCount + 1;
  if (activeBefore === showcaseCount) {
    // Overflow branch — oldest ball evicts off the bottom.
    return ((limit - activeBefore + 1) * MOVE_TIME) / limit;
  }
  return ((limit - activeBefore) * MOVE_TIME) / limit;
}

/**
 * Maps bingo number to Bingo75 column color (B-I-N-G-O):
 *   B (1-15)  = blue
 *   I (16-30) = red
 *   N (31-45) = purple
 *   G (46-60) = green
 *   O (61-75) = yellow/orange
 */
export function getBallColor(n: number): { center: number; edge: number; glow: number } {
  if (n <= 15) return { center: 0x3a7adf, edge: 0x0d2f8a, glow: 0x2850dc }; // B blue
  if (n <= 30) return { center: 0xe84040, edge: 0x8b0000, glow: 0xdc2828 }; // I red
  if (n <= 45) return { center: 0xcc44cc, edge: 0x6a006a, glow: 0xb428b4 }; // N purple
  if (n <= 60) return { center: 0x6ecf3a, edge: 0x2a7a00, glow: 0x64dc28 }; // G green
  return { center: 0xf0c020, edge: 0x8a7000, glow: 0xc8a814 };              // O yellow
}

export class BallTube extends Container {
  private tubeHeight: number;
  private ballContainer: Container;
  private tubeMask: Graphics;

  /** Number of slots that fit fully inside the tube (showcase). */
  private showcaseCount: number;
  /** Newest first: balls[0] is the just-drawn ball at the top of the stack. */
  private balls: Ball[] = [];

  constructor(tubeHeight: number) {
    super();
    this.tubeHeight = tubeHeight;
    // Mirror Unity: showcase = floor(rect.height / distance). The tube can
    // host one extra ball during the transition before the oldest scrolls
    // off the bottom (Unity's bingoBallLimit = showcaseCount + 1).
    this.showcaseCount = Math.max(1, Math.floor((tubeHeight - PAD_TOP) / BALL_DISTANCE));

    // ── Tube background — glass effect ──────────────────────────────────────
    const tubeBg = new Graphics();
    tubeBg.roundRect(0, 0, TUBE_WIDTH, tubeHeight, TUBE_WIDTH / 2);
    tubeBg.fill({ color: 0x000000, alpha: 0.35 });
    tubeBg.rect(0, 0, 3, tubeHeight);
    tubeBg.fill({ color: 0xffffff, alpha: 0.12 });
    tubeBg.rect(TUBE_WIDTH - 3, 0, 3, tubeHeight);
    tubeBg.fill({ color: 0x000000, alpha: 0.3 });
    this.addChild(tubeBg);

    // Ball container is masked so off-tube balls disappear.
    this.ballContainer = new Container();
    this.addChild(this.ballContainer);

    this.tubeMask = new Graphics();
    this.tubeMask.roundRect(0, 0, TUBE_WIDTH, tubeHeight, TUBE_WIDTH / 2);
    this.tubeMask.fill(0xffffff);
    this.addChild(this.tubeMask);
    this.ballContainer.mask = this.tubeMask;

    // Decorative top/bottom highlights (non-functional).
    const topCap = new Graphics();
    topCap.roundRect(0, 0, TUBE_WIDTH, 36, TUBE_WIDTH / 2);
    topCap.fill({ color: 0xffffff, alpha: 0.08 });
    this.addChild(topCap);

    const bottomFade = new Graphics();
    bottomFade.roundRect(0, tubeHeight - 50, TUBE_WIDTH, 50, TUBE_WIDTH / 2);
    bottomFade.fill({ color: 0x000000, alpha: 0.5 });
    this.addChild(bottomFade);
  }

  /**
   * Add a single new ball with the Unity-parity animation:
   *   1. Previous highlighted ball (if any) shrinks 1.15→0.85 over SCALE_TIME
   *   2. New ball spawns above the tube at HIGHLIGHT_SCALE
   *   3. New ball slides down to the top slot over moveTime (linear lerp)
   *   4. Older balls shift down one slot over moveTime
   *   5. If the tube was full, the oldest ball animates off the bottom
   *
   * BIN-619 Bug 6: `moveTime` is now DYNAMIC (was fixed 0.5s) — matches
   * Unity `GetAnimationTime`: accelerates from 0.5s (empty tube) down to
   * ~0.17s (full tube) so rapid draws don't feel sluggish.
   */
  addBall(number: number): void {
    // 1. Existing highlight ball goes back to normal size.
    if (this.balls.length > 0) {
      const prevHighlight = this.balls[0];
      gsap.killTweensOf(prevHighlight.scale);
      gsap.to(prevHighlight.scale, {
        x: NORMAL_SCALE,
        y: NORMAL_SCALE,
        duration: SCALE_TIME,
        ease: "none",
      });
    }

    // 2. Build new ball at highlight scale, above the tube (off-screen).
    const ball = this.createBall(number);
    ball.scale.set(HIGHLIGHT_SCALE);
    ball.x = this.centerX();
    ball.y = -BALL_SIZE; // spawn above tube — slides down into top slot
    this.ballContainer.addChild(ball);

    // BIN-619 Bug 6: compute move-time BEFORE unshift — Unity calls
    // GetAnimationTime while activeBingoBalls is still the pre-add count.
    const moveTime = getMoveAnimationTime(this.balls.length, this.showcaseCount);

    // Insert at front (newest first).
    this.balls.unshift(ball);

    // 3 + 4 + 5. Animate everyone to their new slot. Linear move to mimic
    // Unity's Vector3.Lerp-based MoveObject. The oldest ball animates one
    // slot below the visible region — the mask clips it, then we drop it.
    const overflow = this.balls.length > this.showcaseCount;
    for (let i = 0; i < this.balls.length; i++) {
      const target = this.balls[i];
      target.x = this.centerX();
      const targetY = this.slotY(i);
      gsap.killTweensOf(target);
      gsap.to(target, { y: targetY, duration: moveTime, ease: "none" });
    }

    // Drop the oldest ball after the slide finishes — it has been pushed
    // below the tube and is no longer visible. Delay matches the dynamic
    // move-time so cleanup happens right after the tween resolves.
    if (overflow) {
      const evicted = this.balls.pop()!;
      gsap.delayedCall(moveTime, () => {
        if (evicted.destroyed) return;
        gsap.killTweensOf(evicted);
        gsap.killTweensOf(evicted.scale);
        evicted.destroy({ children: true });
      });
    }
  }

  /** Restore the tube from the server snapshot — no animation. */
  loadBalls(numbers: number[]): void {
    this.clear();
    if (numbers.length === 0) return;

    // Show only the most recent `showcaseCount` balls (Unity does the same
    // in WithdrawList — older balls are silently dropped on snapshot load).
    const visible = numbers.slice(-this.showcaseCount);
    // Newest first: reverse so the last drawn number ends up at index 0.
    const reversed = [...visible].reverse();

    for (let i = 0; i < reversed.length; i++) {
      const n = reversed[i];
      const ball = this.createBall(n);
      ball.x = this.centerX();
      ball.y = this.slotY(i);
      // Newest = highlight, the rest sit at normal scale.
      ball.scale.set(i === 0 ? HIGHLIGHT_SCALE : NORMAL_SCALE);
      this.ballContainer.addChild(ball);
      this.balls.push(ball);
    }
  }

  clear(): void {
    for (const b of this.balls) {
      gsap.killTweensOf(b);
      gsap.killTweensOf(b.scale);
      b.destroy({ children: true });
    }
    this.balls = [];
  }

  /** Returns the most recently added ball's number, or null if empty. */
  getLatestNumber(): number | null {
    return this.balls.length === 0 ? null : this.balls[0].ballNumber;
  }

  destroy(options?: Parameters<Container["destroy"]>[0]): void {
    this.clear();
    super.destroy(options);
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  /** X for ball CENTRE (we use centred pivot, see createBall). */
  private centerX(): number {
    return TUBE_WIDTH / 2;
  }

  /** Y for ball CENTRE in slot `idx` (0 = newest, at top). */
  private slotY(idx: number): number {
    return PAD_TOP + BALL_SIZE / 2 + idx * BALL_DISTANCE;
  }

  private createBall(number: number): Ball {
    const { center, edge, glow } = getBallColor(number);
    const r = BALL_SIZE / 2;
    const ball = new Container() as Ball;
    ball.ballNumber = number;
    // Pivot at centre so scale animates around the ball's middle, not its
    // top-left corner — needed for the 1.15 ↔ 0.85 transition to read as a
    // breathing punch in place rather than a slide.
    ball.pivot.set(r, r);

    const shadow = new Graphics();
    shadow.circle(r, r, r + 2);
    shadow.fill({ color: glow, alpha: 0.35 });
    ball.addChild(shadow);

    const bg = new Graphics();
    bg.circle(r, r, r);
    bg.fill(edge);
    bg.circle(r - 4, r - 6, r * 0.7);
    bg.fill({ color: center, alpha: 0.9 });
    ball.addChild(bg);

    const shine = new Graphics();
    shine.ellipse(r - 4, r - 10, r * 0.35, r * 0.22);
    shine.fill({ color: 0xffffff, alpha: 0.4 });
    ball.addChild(shine);

    const text = new Text({
      text: String(number),
      style: {
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 28,
        fill: 0xffffff,
        fontWeight: "700",
        align: "center",
        dropShadow: { color: 0x000000, alpha: 0.6, blur: 2, distance: 1 },
      },
    });
    text.anchor.set(0.5);
    text.x = r;
    text.y = r;
    ball.addChild(text);

    return ball;
  }
}
