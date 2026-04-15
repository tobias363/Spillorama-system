import { Container, Graphics, Text } from "pixi.js";
import gsap from "gsap";

const TUBE_WIDTH = 96;
const BALL_SIZE = 72;
const BALL_GAP = 10;
const BALL_PADDING = 12;

/**
 * Maps bingo number to BINGO column color.
 * Matches Unity SpilloramaGameBridge.GetBallColorFromNumber():
 *   B(1-15)=blue, I(16-30)=red, N(31-45)=purple, G(46-60)=green, O(61-75)=yellow
 */
function getBallColor(n: number): { center: number; edge: number; glow: number } {
  if (n <= 15) return { center: 0x3a7adf, edge: 0x0d2f8a, glow: 0x2850dc };   // Blue (B)
  if (n <= 30) return { center: 0xe84040, edge: 0x8b0000, glow: 0xdc2828 };   // Red (I)
  if (n <= 45) return { center: 0xcc44cc, edge: 0x6a006a, glow: 0xb428b4 };   // Purple (N)
  if (n <= 60) return { center: 0x6ecf3a, edge: 0x2a7a00, glow: 0x64dc28 };   // Green (G)
  return { center: 0xf0c020, edge: 0x8a7000, glow: 0xc8a814 };               // Yellow (O)
}

/**
 * Vertical glass tube showing drawn bingo balls.
 *
 * Balls stack from bottom to top. When the tube fills beyond
 * its height, older balls scroll up and are clipped by a mask.
 * New balls animate in with a bounce effect.
 */
export class BallTube extends Container {
  private tubeHeight: number;
  private ballContainer: Container;
  private balls: Container[] = [];
  private tubeMask: Graphics;

  constructor(tubeHeight: number) {
    super();
    this.tubeHeight = tubeHeight;

    // Tube background — glass effect matching mockup CSS
    const tubeBg = new Graphics();
    // Dark translucent fill
    tubeBg.roundRect(0, 0, TUBE_WIDTH, tubeHeight, TUBE_WIDTH / 2);
    tubeBg.fill({ color: 0x000000, alpha: 0.35 });
    // Left edge highlight
    tubeBg.rect(0, 0, 3, tubeHeight);
    tubeBg.fill({ color: 0xffffff, alpha: 0.12 });
    // Right edge shadow
    tubeBg.rect(TUBE_WIDTH - 3, 0, 3, tubeHeight);
    tubeBg.fill({ color: 0x000000, alpha: 0.3 });
    this.addChild(tubeBg);

    // Ball container (masked)
    this.ballContainer = new Container();
    this.addChild(this.ballContainer);

    // Mask to clip balls within tube
    this.tubeMask = new Graphics();
    this.tubeMask.roundRect(0, 0, TUBE_WIDTH, tubeHeight, TUBE_WIDTH / 2);
    this.tubeMask.fill(0xffffff);
    this.addChild(this.tubeMask);
    this.ballContainer.mask = this.tubeMask;

    // Top cap overlay — white gradient fade
    const topCap = new Graphics();
    topCap.roundRect(0, 0, TUBE_WIDTH, 36, TUBE_WIDTH / 2);
    topCap.fill({ color: 0xffffff, alpha: 0.08 });
    this.addChild(topCap);

    // Bottom fade overlay
    const bottomFade = new Graphics();
    bottomFade.roundRect(0, tubeHeight - 50, TUBE_WIDTH, 50, TUBE_WIDTH / 2);
    bottomFade.fill({ color: 0x000000, alpha: 0.5 });
    this.addChild(bottomFade);
  }

  /** Add a single new ball with animation. */
  addBall(number: number, animate = true): void {
    const ball = this.createBall(number);
    this.balls.push(ball);
    this.ballContainer.addChild(ball);
    this.layoutBalls(animate ? ball : null);
  }

  /** Load all balls from state (no animation). */
  loadBalls(numbers: number[]): void {
    this.clear();
    for (const n of numbers) {
      const ball = this.createBall(n);
      this.balls.push(ball);
      this.ballContainer.addChild(ball);
    }
    this.layoutBalls(null);
  }

  clear(): void {
    for (const b of this.balls) {
      gsap.killTweensOf(b);
      gsap.killTweensOf(b.scale);
      b.destroy({ children: true });
    }
    this.balls = [];
  }

  getLatestNumber(): number | null {
    if (this.balls.length === 0) return null;
    return (this.balls[this.balls.length - 1] as Container & { ballNumber: number }).ballNumber;
  }

  destroy(options?: Parameters<Container["destroy"]>[0]): void {
    this.clear();
    super.destroy(options);
  }

  private createBall(number: number): Container & { ballNumber: number } {
    const { center, edge, glow } = getBallColor(number);
    const r = BALL_SIZE / 2;
    const ball = new Container() as Container & { ballNumber: number };
    ball.ballNumber = number;

    // Glow shadow
    const shadow = new Graphics();
    shadow.circle(r, r, r + 2);
    shadow.fill({ color: glow, alpha: 0.35 });
    ball.addChild(shadow);

    // Main ball with radial-like gradient (approximate with concentric circles)
    const bg = new Graphics();
    bg.circle(r, r, r);
    bg.fill(edge);
    // Lighter center
    bg.circle(r - 4, r - 6, r * 0.7);
    bg.fill({ color: center, alpha: 0.9 });
    ball.addChild(bg);

    // Shine highlight
    const shine = new Graphics();
    shine.ellipse(r - 4, r - 10, r * 0.35, r * 0.22);
    shine.fill({ color: 0xffffff, alpha: 0.4 });
    ball.addChild(shine);

    // Number text
    const text = new Text({
      text: String(number),
      style: {
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 24,
        fill: 0xffffff,
        fontWeight: "700",
        align: "center",
        dropShadow: {
          color: 0x000000,
          alpha: 0.6,
          blur: 2,
          distance: 1,
        },
      },
    });
    text.anchor.set(0.5);
    text.x = r;
    text.y = r;
    ball.addChild(text);

    return ball;
  }

  /**
   * Position all balls bottom-to-top inside the tube.
   * If newBall is specified, animate it dropping in.
   */
  private layoutBalls(newBall: Container | null): void {
    const centerX = TUBE_WIDTH / 2 - BALL_SIZE / 2;
    const totalBallHeight = this.balls.length * (BALL_SIZE + BALL_GAP) - BALL_GAP + BALL_PADDING * 2;

    // If content exceeds tube, scroll so newest (last) ball is visible at bottom
    const scrollOffset = Math.max(0, totalBallHeight - this.tubeHeight);

    for (let i = 0; i < this.balls.length; i++) {
      const ball = this.balls[i];
      const targetX = centerX;
      // Newest ball at bottom, oldest at top
      const idx = this.balls.length - 1 - i;
      const targetY = this.tubeHeight - BALL_PADDING - (idx + 1) * (BALL_SIZE + BALL_GAP) + BALL_GAP + scrollOffset;

      ball.x = targetX;

      if (ball === newBall) {
        // Animate new ball: start above tube, drop in with bounce
        ball.y = -BALL_SIZE;
        ball.scale.set(0.5);
        gsap.to(ball, { y: targetY, duration: 0.4, ease: "bounce.out" });
        gsap.to(ball.scale, { x: 1, y: 1, duration: 0.3, ease: "back.out(1.5)" });
      } else {
        // Slide existing balls to their new position
        gsap.to(ball, { y: targetY, duration: 0.3, ease: "power2.out" });
      }
    }
  }
}
