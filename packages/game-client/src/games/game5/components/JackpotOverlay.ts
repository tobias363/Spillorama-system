import { Container, Graphics, Text, Sprite, Assets, Texture } from "pixi.js";
import gsap from "gsap";
import type { JackpotActivatedPayload, JackpotSpinResult } from "@spillorama/shared-types/socket-events";

const NUM_SEGMENTS = 8;
const SEGMENT_COLORS = [
  0xe63946, 0xf77f00, 0xffba00, 0x2a9d8f,
  0x457b9d, 0x9b59b6, 0xe63946, 0x2a9d8f,
];
const ASSET_BASE = import.meta.env.BASE_URL + "assets/game5/";

/**
 * Jackpot mini-game overlay for Game 5 (Spillorama Bingo).
 * Shows a Wheel of Fortune after BINGO win.
 * Player spins to win bonus prize — outcome is server-determined.
 */
export class JackpotOverlay extends Container {
  private backdrop: Graphics;
  private wheelContainer: Container;
  private spinBtn: Container;
  private spinBtnText: Text;
  private resultText: Text;
  private titleText: Text;
  private timerText: Text;
  private prizeList: number[] = [];
  private isSpinning = false;
  private radius: number;
  private onSpin: (() => void) | null = null;
  private onDismiss: (() => void) | null = null;
  private autoSpinTimer: ReturnType<typeof setInterval> | null = null;
  private autoSpinCountdown = 10;
  private idleTween: gsap.core.Tween | null = null;

  constructor(screenWidth: number, screenHeight: number) {
    super();
    this.radius = Math.min(140, Math.floor(screenHeight * 0.25));

    // Semi-transparent backdrop
    this.backdrop = new Graphics();
    this.backdrop.rect(0, 0, screenWidth, screenHeight);
    this.backdrop.fill({ color: 0x000000, alpha: 0.75 });
    this.backdrop.eventMode = "static"; // Block clicks through
    this.addChild(this.backdrop);

    // Title
    this.titleText = new Text({
      text: "JACKPOT!",
      style: {
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 36,
        fontWeight: "bold",
        fill: 0xffe83d,
        align: "center",
      },
    });
    this.titleText.anchor.set(0.5);
    this.titleText.x = screenWidth / 2;
    this.titleText.y = 50;
    this.addChild(this.titleText);

    // Wheel
    this.wheelContainer = new Container();
    this.wheelContainer.x = screenWidth / 2;
    this.wheelContainer.y = screenHeight / 2 - 20;
    this.addChild(this.wheelContainer);
    this.drawWheel();

    // Arrow pointer
    const arrow = new Graphics();
    arrow.moveTo(0, -this.radius - 14);
    arrow.lineTo(-10, -this.radius - 28);
    arrow.lineTo(10, -this.radius - 28);
    arrow.closePath();
    arrow.fill(0xffe83d);
    arrow.stroke({ color: 0x790001, width: 1.5 });
    arrow.x = screenWidth / 2;
    arrow.y = screenHeight / 2 - 20;
    this.addChild(arrow);

    // Try loading arrow sprite
    this.loadArrowSprite(arrow, screenWidth, screenHeight);

    // Timer text
    this.timerText = new Text({
      text: "",
      style: { fontFamily: "Arial", fontSize: 18, fill: 0xffffff, align: "center" },
    });
    this.timerText.anchor.set(0.5);
    this.timerText.x = screenWidth / 2;
    this.timerText.y = screenHeight / 2 + this.radius + 50;
    this.addChild(this.timerText);

    // Spin button
    this.spinBtn = new Container();
    const btnBg = new Graphics();
    btnBg.roundRect(0, 0, 180, 50, 12);
    btnBg.fill(0x790001);
    btnBg.stroke({ color: 0xffe83d, width: 2 });
    this.spinBtn.addChild(btnBg);
    this.spinBtnText = new Text({
      text: "SPINN",
      style: { fontFamily: "Arial", fontSize: 22, fontWeight: "bold", fill: 0xffe83d, align: "center" },
    });
    this.spinBtnText.anchor.set(0.5);
    this.spinBtnText.x = 90;
    this.spinBtnText.y = 25;
    this.spinBtn.addChild(this.spinBtnText);
    this.spinBtn.x = screenWidth / 2 - 90;
    this.spinBtn.y = screenHeight / 2 + this.radius + 80;
    this.spinBtn.eventMode = "static";
    this.spinBtn.cursor = "pointer";
    this.spinBtn.on("pointerdown", () => this.handleSpinClick());
    this.addChild(this.spinBtn);

    // Result text (shown after spin)
    this.resultText = new Text({
      text: "",
      style: {
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 28,
        fontWeight: "bold",
        fill: 0xffe83d,
        align: "center",
      },
    });
    this.resultText.anchor.set(0.5);
    this.resultText.x = screenWidth / 2;
    this.resultText.y = screenHeight / 2 + this.radius + 150;
    this.resultText.visible = false;
    this.addChild(this.resultText);

    this.visible = false;
  }

  setOnSpin(callback: () => void): void {
    this.onSpin = callback;
  }

  setOnDismiss(callback: () => void): void {
    this.onDismiss = callback;
  }

  /** Show the jackpot overlay with prize data from server. */
  show(data: JackpotActivatedPayload): void {
    this.prizeList = data.prizeList;
    this.updateWheelLabels();
    this.isSpinning = false;
    this.spinBtn.visible = true;
    this.spinBtnText.text = "SPINN";
    this.resultText.visible = false;
    this.visible = true;

    // Idle DrumRotation — port of Unity DrumRotation.cs: wheel slowly rotates
    // while waiting for player input, so it feels alive rather than static.
    this.startIdleRotation();

    // Start auto-spin countdown (10 seconds)
    this.autoSpinCountdown = 10;
    this.timerText.text = `Auto-spinn om ${this.autoSpinCountdown}s`;
    this.autoSpinTimer = setInterval(() => {
      this.autoSpinCountdown -= 1;
      if (this.autoSpinCountdown <= 0) {
        this.clearAutoTimer();
        this.timerText.text = "";
        this.handleSpinClick();
      } else {
        this.timerText.text = `Auto-spinn om ${this.autoSpinCountdown}s`;
      }
    }, 1000);
  }

  /** Animate the wheel landing on the server-determined result. */
  animateResult(result: JackpotSpinResult): void {
    this.isSpinning = true;
    this.spinBtn.visible = false;
    this.clearAutoTimer();
    this.timerText.text = "";
    this.stopIdleRotation();

    const segmentAngle = 360 / NUM_SEGMENTS;
    const targetAngle = result.segmentIndex * segmentAngle + segmentAngle / 2;
    const totalRotation = 360 * 5 + (360 - targetAngle);

    const wheelInner = this.wheelContainer.children[0] as Container;
    const startRotation = wheelInner.rotation; // Preserve idle-rotation offset
    const targetRotationRad = startRotation + (totalRotation * Math.PI) / 180;

    gsap.to(wheelInner, {
      rotation: targetRotationRad,
      duration: 5,
      ease: "power3.out",
      onComplete: () => {
        this.isSpinning = false;
        this.resultText.text = `Du vant ${result.prizeAmount} kr!`;
        this.resultText.visible = true;

        // Auto-dismiss after 4 seconds
        gsap.delayedCall(4, () => {
          this.visible = false;
          this.onDismiss?.();
        });
      },
    });
  }

  destroy(options?: Parameters<Container["destroy"]>[0]): void {
    this.clearAutoTimer();
    this.stopIdleRotation();
    gsap.killTweensOf(this.wheelContainer.children[0]);
    super.destroy(options);
  }

  /** Unity DrumRotation port — slow continuous idle spin while waiting. */
  private startIdleRotation(): void {
    this.stopIdleRotation();
    const wheelInner = this.wheelContainer.children[0] as Container;
    this.idleTween = gsap.to(wheelInner, {
      rotation: `+=${Math.PI * 2}`,
      duration: 12,
      repeat: -1,
      ease: "none",
    });
  }

  private stopIdleRotation(): void {
    this.idleTween?.kill();
    this.idleTween = null;
  }

  // ── Private ───────────────────────────────────────────────────────────

  private handleSpinClick(): void {
    if (this.isSpinning) return;
    this.clearAutoTimer();
    this.timerText.text = "";
    this.onSpin?.();
  }

  private clearAutoTimer(): void {
    if (this.autoSpinTimer) {
      clearInterval(this.autoSpinTimer);
      this.autoSpinTimer = null;
    }
  }

  private drawWheel(): void {
    const inner = new Container();
    const segmentAngle = (2 * Math.PI) / NUM_SEGMENTS;

    for (let i = 0; i < NUM_SEGMENTS; i++) {
      const startAngle = i * segmentAngle - Math.PI / 2;
      const endAngle = startAngle + segmentAngle;

      const seg = new Graphics();
      seg.moveTo(0, 0);
      seg.arc(0, 0, this.radius, startAngle, endAngle);
      seg.closePath();
      seg.fill(SEGMENT_COLORS[i % SEGMENT_COLORS.length]);
      seg.stroke({ color: 0x1a0a0a, width: 1.5 });
      inner.addChild(seg);

      // Prize label
      const midAngle = startAngle + segmentAngle / 2;
      const labelR = this.radius * 0.65;
      const label = new Text({
        text: "?",
        style: { fontFamily: "Arial", fontSize: Math.floor(this.radius * 0.15), fill: 0xffffff, fontWeight: "bold" },
      });
      label.anchor.set(0.5);
      label.x = Math.cos(midAngle) * labelR;
      label.y = Math.sin(midAngle) * labelR;
      label.rotation = midAngle + Math.PI / 2;
      label.name = `jp-label-${i}`;
      inner.addChild(label);
    }

    // Outer ring + hub
    const ring = new Graphics();
    ring.circle(0, 0, this.radius);
    ring.stroke({ color: 0x790001, width: 3 });
    ring.circle(0, 0, this.radius * 0.12);
    ring.fill(0x2e0000);
    ring.stroke({ color: 0x790001, width: 2 });
    inner.addChild(ring);

    this.wheelContainer.addChild(inner);
  }

  private updateWheelLabels(): void {
    const inner = this.wheelContainer.children[0] as Container;
    for (let i = 0; i < NUM_SEGMENTS; i++) {
      const label = inner.getChildByName(`jp-label-${i}`) as Text | null;
      if (label && this.prizeList[i] !== undefined) {
        label.text = `${this.prizeList[i]} kr`;
      }
    }
  }

  private async loadArrowSprite(fallback: Graphics, screenWidth: number, screenHeight: number): Promise<void> {
    try {
      const tex = await Assets.load<Texture>(ASSET_BASE + "roulette-arrow.png");
      const sprite = new Sprite(tex);
      sprite.anchor.set(0.5, 1);
      const scale = (this.radius * 0.3) / tex.width;
      sprite.scale.set(scale);
      sprite.x = screenWidth / 2;
      sprite.y = screenHeight / 2 - 20 - this.radius - 2;
      const idx = this.getChildIndex(fallback);
      this.addChildAt(sprite, idx);
      fallback.destroy();
    } catch {
      // Keep fallback
    }
  }
}
