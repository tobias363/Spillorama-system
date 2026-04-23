import { Container, Sprite, Text, Assets, Texture } from "pixi.js";
import gsap from "gsap";
import { getBallAssetPath, enableMipmaps } from "./BallTube.js";

const BALL_SIZE = 170; // mockup .game-number-ring

/** Bridge-state shape used for pause-awareness. */
interface PauseAwareBridge {
  getState(): { isPaused: boolean };
}

/**
 * Large animated bingo ball displayed between the ball-tube and the center
 * panel — mockup `.game-number-ring` (170×170). Swaps the PNG texture on
 * every new draw so the ring colour matches the Bingo75 column of the
 * drawn number.
 *
 * Animation (mockup-parity):
 *  - scale(0.6) + alpha(0) on number swap
 *  - fade/scale back to 1 with back-overshoot (cubic-bezier 0.34, 1.56, 0.64, 1)
 *
 * Countdown mode + pause-awareness: unchanged from prior implementation
 * (Game1GamePlayPanel.SocketFlow.cs:672-696 mirrors the freeze).
 */
export class CenterBall extends Container {
  private ballSprite: Sprite | null = null;
  private currentTextureUrl: string | null = null;
  private numberText: Text;
  private currentNumber: number | null = null;
  private idleTween: gsap.core.Tween | null = null;
  private countdownInterval: ReturnType<typeof setInterval> | null = null;
  private countdownDeadline = 0;
  private countdownRemainingMs = 0;
  private bridge: PauseAwareBridge | null = null;
  private isDestroyed = false;
  /**
   * Base Y position set by PlayScreen. The idle-float tween uses this as
   * the anchor (yoyo's between baseY and baseY-4), so re-triggering the
   * animation mid-yoyo doesn't drift the ball upward over time.
   */
  private baseY: number | null = null;

  constructor(bridge?: PauseAwareBridge) {
    super();
    this.bridge = bridge ?? null;

    this.numberText = new Text({
      text: "",
      style: {
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        fontSize: 50,
        fill: 0x1a0a0a,
        fontWeight: "800",
        align: "center",
        letterSpacing: -0.5,
      },
    });
    this.numberText.anchor.set(0.5);
    this.numberText.x = BALL_SIZE / 2 - 4;
    this.numberText.y = BALL_SIZE / 2 - 1;
    this.addChild(this.numberText);

    // Default sprite — red (central colour for idle/countdown), swapped per
    // drawn number by showNumber/setNumber.
    void this.swapTexture("/web/games/assets/game1/design/balls/red.png");
  }

  private async swapTexture(url: string): Promise<void> {
    if (this.isDestroyed || url === this.currentTextureUrl) return;
    try {
      let tex = Assets.cache.get(url) as Texture | undefined;
      if (!tex) tex = (await Assets.load(url)) as Texture;
      if (this.isDestroyed) return;
      enableMipmaps(tex);
      this.currentTextureUrl = url;
      if (this.ballSprite) {
        this.ballSprite.texture = tex;
      } else {
        this.ballSprite = new Sprite(tex);
        this.ballSprite.width = BALL_SIZE;
        this.ballSprite.height = BALL_SIZE;
        this.addChildAt(this.ballSprite, 0);
        this.startIdleFloat();
      }
    } catch {
      console.warn(`[CenterBall] Could not load ${url}`);
    }
  }

  /** Show a new drawn number with mockup-parity scale-in + overshoot. */
  showNumber(number: number): void {
    this.stopCountdown();
    this.currentNumber = number;
    this.numberText.text = String(number).padStart(2, "0");
    this.numberText.style.fontSize = 50;
    void this.swapTexture(getBallAssetPath(number));

    this.idleTween?.kill();

    // Mockup: scale 0.6 → 1 over 400ms with back overshoot, alpha 0 → 1.
    this.scale.set(0.6);
    this.alpha = 0;
    gsap.to(this, { alpha: 1, duration: 0.4, ease: "power2.out" });
    gsap.to(this.scale, {
      x: 1,
      y: 1,
      duration: 0.4,
      ease: "back.out(1.7)",
      onComplete: () => this.startIdleFloat(),
    });
  }

  /** Set number without animation (state restore). */
  setNumber(number: number | null): void {
    this.stopCountdown();
    this.currentNumber = number;
    this.numberText.text = number !== null ? String(number).padStart(2, "0") : "";
    this.numberText.style.fontSize = 50;
    if (number !== null) void this.swapTexture(getBallAssetPath(number));
    if (!this.idleTween) this.startIdleFloat();
  }

  getNumber(): number | null {
    return this.currentNumber;
  }

  startCountdown(millisUntilStart: number): void {
    this.stopCountdown();
    this.currentNumber = null;
    this.numberText.style.fontSize = 44;

    if (millisUntilStart <= 0) {
      this.numberText.text = "...";
      this.startIdleFloat();
      return;
    }

    this.countdownDeadline = Date.now() + millisUntilStart;
    this.countdownRemainingMs = millisUntilStart;
    this.updateCountdownDisplay();

    this.countdownInterval = setInterval(() => {
      if (this.isDestroyed) {
        this.stopCountdown();
        return;
      }
      if (this.bridge?.getState().isPaused) {
        this.countdownDeadline += 250;
        return;
      }
      this.updateCountdownDisplay();
    }, 250);

    this.startIdleFloat();
  }

  setBridge(bridge: PauseAwareBridge): void {
    this.bridge = bridge;
  }

  showWaiting(): void {
    this.stopCountdown();
    this.currentNumber = null;
    this.numberText.text = "...";
    this.numberText.style.fontSize = 44;
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

  /**
   * Anchor the idle-float animation to an explicit base Y. Prevents the
   * yoyo tween from "drifting" upward when re-triggered mid-animation
   * (every showNumber / showWaiting / startCountdown restart).
   */
  setBaseY(y: number): void {
    this.baseY = y;
    this.y = y;
    if (this.idleTween) {
      this.idleTween.kill();
      this.idleTween = null;
      this.startIdleFloat();
    }
  }

  private startIdleFloat(): void {
    this.idleTween?.kill();
    // Cache baseY on first run if PlayScreen hasn't called setBaseY yet.
    if (this.baseY === null) this.baseY = this.y;
    this.y = this.baseY;
    this.idleTween = gsap.fromTo(
      this,
      { y: this.baseY },
      {
        y: this.baseY - 4,
        duration: 2.4,
        ease: "sine.inOut",
        yoyo: true,
        repeat: -1,
      },
    );
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
