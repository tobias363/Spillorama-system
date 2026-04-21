import { Container, Graphics, Text } from "pixi.js";
import gsap from "gsap";

const MAX_BALLS = 5;
const BALL_SIZE = 52;
const GAP = 8;

/**
 * Animated vertical ball queue for Game 3 (Monster Bingo).
 *
 * - FIFO queue with max 5 visible balls
 * - New balls drop in from above with acceleration (velocity + acc)
 * - When full, oldest ball fades out, all shift down, new one enters
 * - Entry scale: 1.2x → 1.0x (matching Unity's highlightScale)
 */
export class AnimatedBallQueue extends Container {
  private balls: BallEntry[] = [];
  private queueContainer: Container;
  private tubeBg: Graphics;
  private tubeWidth: number;
  private tubeHeight: number;

  constructor() {
    super();
    this.tubeWidth = BALL_SIZE + 16;
    this.tubeHeight = MAX_BALLS * (BALL_SIZE + GAP) + 16;

    // Tube background
    this.tubeBg = new Graphics();
    this.tubeBg.roundRect(0, 0, this.tubeWidth, this.tubeHeight, 10);
    this.tubeBg.fill({ color: 0x1a0000, alpha: 0.6 });
    this.tubeBg.stroke({ color: 0x790001, width: 1.5 });
    this.addChild(this.tubeBg);

    this.queueContainer = new Container();
    this.queueContainer.x = this.tubeWidth / 2;
    this.queueContainer.y = 8;
    this.addChild(this.queueContainer);
  }

  /** Add a drawn number to the queue with drop animation. */
  addBall(number: number): void {
    // If queue is full, remove oldest
    if (this.balls.length >= MAX_BALLS) {
      this.removeOldest();
    }

    // Create ball visual
    const entry = this.createBall(number);
    this.balls.push(entry);
    this.queueContainer.addChild(entry.container);

    // Animate entry: drop from above with acceleration
    const targetY = (this.balls.length - 1) * (BALL_SIZE + GAP);
    entry.container.x = 0;
    entry.container.y = -BALL_SIZE - 20; // Start above tube
    entry.container.scale.set(1.2);

    gsap.to(entry.container, {
      y: targetY,
      duration: 0.45,
      ease: "power2.in", // Accelerates — matches Unity velocity+acc
    });
    gsap.to(entry.container.scale, {
      x: 1,
      y: 1,
      duration: 0.35,
      delay: 0.15,
      ease: "power2.out",
    });
  }

  /** Clear all balls. */
  clear(): void {
    for (const entry of this.balls) {
      entry.container.destroy({ children: true });
    }
    this.queueContainer.removeChildren();
    this.balls = [];
  }

  get queueWidth(): number {
    return this.tubeWidth;
  }

  // ── Private ───────────────────────────────────────────────────────────

  private removeOldest(): void {
    const oldest = this.balls.shift();
    if (!oldest) return;

    // Animate oldest out (fade + slide down)
    gsap.to(oldest.container, {
      alpha: 0,
      y: oldest.container.y + BALL_SIZE / 2,
      duration: 0.25,
      ease: "power2.in",
      onComplete: () => {
        oldest.container.destroy({ children: true });
      },
    });

    // Shift remaining balls down
    for (let i = 0; i < this.balls.length; i++) {
      gsap.to(this.balls[i].container, {
        y: i * (BALL_SIZE + GAP),
        duration: 0.3,
        ease: "power2.out",
      });
    }
  }

  private createBall(number: number): BallEntry {
    const container = new Container();
    const radius = BALL_SIZE / 2;

    // Ball circle
    const bg = new Graphics();
    bg.circle(0, radius, radius - 1);
    bg.fill(getColorForNumber(number));
    // Inner highlight
    bg.circle(-2, radius - 3, radius * 0.6);
    bg.fill({ color: 0xffffff, alpha: 0.15 });
    container.addChild(bg);

    // Number text
    const text = new Text({
      text: String(number),
      style: {
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: Math.floor(BALL_SIZE * 0.42),
        fill: 0x000000,
        fontWeight: "bold",
        align: "center",
      },
    });
    text.anchor.set(0.5);
    text.x = 0;
    text.y = radius;
    container.addChild(text);

    return { container, number };
  }
}

interface BallEntry {
  container: Container;
  number: number;
}

function getColorForNumber(n: number): number {
  if (n <= 12) return 0xe63946;  // Red
  if (n <= 24) return 0xf77f00;  // Orange
  if (n <= 36) return 0xffba00;  // Gold/yellow
  if (n <= 48) return 0x2a9d8f;  // Teal/green
  return 0x457b9d;               // Blue
}
