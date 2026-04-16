import { Container, Sprite, Text, Assets } from "pixi.js";
import gsap from "gsap";

const BALL_SIZE = 120;

/**
 * Large animated bingo ball displayed in the center of the play area.
 *
 * Loads the `center-ball.png` sprite and overlays the most recently
 * drawn number. Animates on new draws with a scale-in + glow pulse.
 * Floats gently when idle.
 *
 * Also supports countdown mode: displays seconds remaining before
 * the next game starts, ticking down each second.
 */
export class CenterBall extends Container {
  private ballSprite: Sprite | null = null;
  private numberText: Text;
  private currentNumber: number | null = null;
  private idleTween: gsap.core.Tween | null = null;
  private countdownInterval: ReturnType<typeof setInterval> | null = null;
  private countdownDeadline = 0;

  constructor() {
    super();

    // Number text (created first, positioned after sprite loads)
    this.numberText = new Text({
      text: "",
      style: {
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 42,
        fill: 0xffffff,
        fontWeight: "700",
        align: "center",
        dropShadow: {
          color: 0x000000,
          alpha: 0.7,
          blur: 4,
          distance: 2,
        },
      },
    });
    this.numberText.anchor.set(0.5);
    this.numberText.x = BALL_SIZE / 2;
    this.numberText.y = BALL_SIZE / 2;
    this.addChild(this.numberText);

    this.loadSprite();
  }

  private isDestroyed = false;

  private async loadSprite(): Promise<void> {
    try {
      const texture = await Assets.load("/web/games/assets/game1/center-ball.png");
      if (this.isDestroyed) return;
      this.ballSprite = new Sprite(texture);
      this.ballSprite.width = BALL_SIZE;
      this.ballSprite.height = BALL_SIZE;
      this.addChildAt(this.ballSprite, 0);
      this.startIdleFloat();
    } catch {
      // Sprite not available — number text still works standalone
      console.warn("[CenterBall] Could not load center-ball.png");
    }
  }

  /** Show a new drawn number with animation. */
  showNumber(number: number): void {
    this.stopCountdown();
    this.currentNumber = number;
    this.numberText.text = String(number);
    this.numberText.style.fontSize = 42;

    // Kill idle animation during reveal
    this.idleTween?.kill();

    // Scale-in animation
    this.scale.set(0.3);
    this.alpha = 0;
    gsap.to(this, { alpha: 1, duration: 0.2 });
    gsap.to(this.scale, {
      x: 1,
      y: 1,
      duration: 0.5,
      ease: "back.out(1.7)",
      onComplete: () => this.startIdleFloat(),
    });
  }

  /** Set number without animation (e.g. state restore). */
  setNumber(number: number | null): void {
    this.stopCountdown();
    this.currentNumber = number;
    this.numberText.text = number !== null ? String(number) : "";
    this.numberText.style.fontSize = 42;
    if (!this.idleTween) this.startIdleFloat();
  }

  getNumber(): number | null {
    return this.currentNumber;
  }

  /**
   * Start countdown mode — show seconds remaining until game starts.
   * Ticks down each second. Shows "..." when millis is 0 or negative.
   */
  startCountdown(millisUntilStart: number): void {
    this.stopCountdown();
    this.currentNumber = null;
    this.numberText.style.fontSize = 38;

    if (millisUntilStart <= 0) {
      this.numberText.text = "...";
      this.startIdleFloat();
      return;
    }

    this.countdownDeadline = Date.now() + millisUntilStart;
    this.updateCountdownDisplay();

    this.countdownInterval = setInterval(() => {
      if (this.isDestroyed) {
        this.stopCountdown();
        return;
      }
      this.updateCountdownDisplay();
    }, 250);

    this.startIdleFloat();
  }

  /** Show waiting text with no countdown (e.g. "waiting for tickets"). */
  showWaiting(): void {
    this.stopCountdown();
    this.currentNumber = null;
    this.numberText.text = "...";
    this.numberText.style.fontSize = 38;
    this.startIdleFloat();
  }

  stopCountdown(): void {
    if (this.countdownInterval !== null) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
  }

  private updateCountdownDisplay(): void {
    const remaining = Math.ceil((this.countdownDeadline - Date.now()) / 1000);
    if (remaining <= 0) {
      this.numberText.text = "...";
      this.stopCountdown();
    } else {
      this.numberText.text = String(remaining);
    }
  }

  private startIdleFloat(): void {
    this.idleTween?.kill();
    this.idleTween = gsap.to(this, {
      y: this.y - 6,
      duration: 2,
      ease: "sine.inOut",
      yoyo: true,
      repeat: -1,
    });
  }

  destroy(options?: Parameters<Container["destroy"]>[0]): void {
    this.isDestroyed = true;
    this.stopCountdown();
    gsap.killTweensOf(this);
    gsap.killTweensOf(this.scale);
    this.idleTween = null;
    super.destroy(options);
  }
}
