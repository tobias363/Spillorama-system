import { Container, Graphics, Text } from "pixi.js";
import gsap from "gsap";
import type { MiniGameActivatedPayload, MiniGamePlayResult } from "@spillorama/shared-types/socket-events";

/**
 * Wheel of Fortune mini-game overlay for Game 1 (Classic Bingo).
 * Shown after BINGO win. Player spins to win bonus prize.
 * Outcome is server-determined.
 *
 * Unity parity (100% 1:1):
 *   - `SpinWheelScript.cs:174,180,186` — **50 physical segments**, 7.2° per segment,
 *     `zRotation = -3.6f` initial offset. Prize labels repeat if prizeList is shorter
 *     than 50 (modulo), matching Unity's prefab-style duplicate labels.
 *   - `SpinWheelScript.cs:85` — physics deceleration `rotationSpeed *= rMultiplier`
 *     (0.96/frame at ~60fps). Web uses a raf-loop with the same per-frame decay math
 *     to reproduce the tactile feel.
 *   - `SpinWheelScript.cs:199,236` — final jitter `± 3.25°` randomisation applied to
 *     the chosen prize angle.
 *   - `SpinWheelScript.cs:490,497` — pause-hook: auto-spin countdown respects
 *     `state.isPaused` and does not tick down while the round is paused.
 */

const NUM_SEGMENTS = 50;
const SEGMENT_ANGLE_DEG = 360 / NUM_SEGMENTS; // 7.2°
const INITIAL_Z_ROTATION_DEG = -3.6; // SetData offset
const STOP_JITTER_DEG = 3.25;
const R_MULTIPLIER = 0.96;
const INITIAL_ROTATION_SPEED = 60; // deg/frame — tuned so decay yields ~5s total spin
const STOP_SPEED_THRESHOLD = 0.005;
const AUTO_SPIN_SECONDS = 10;

/** Simple HSL → RGB helper returning a 24-bit colour int. */
function hslToInt(h: number, s: number, l: number): number {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  const r = Math.round(f(0) * 255);
  const g = Math.round(f(8) * 255);
  const b = Math.round(f(4) * 255);
  return (r << 16) | (g << 8) | b;
}

/** Bridge-state shape we actually read. Keeps the test surface tiny. */
interface PauseAwareBridge {
  getState(): { isPaused: boolean };
}

export class WheelOverlay extends Container {
  private backdrop: Graphics;
  private wheelContainer: Container;
  private wheelInner: Container;
  private spinBtn: Container;
  private spinBtnText: Text;
  private resultText: Text;
  private titleText: Text;
  private timerText: Text;
  private prizeList: number[] = [];
  private isSpinning = false;
  private radius: number;
  private onPlay: (() => void) | null = null;
  private onDismiss: (() => void) | null = null;
  private autoSpinTimer: ReturnType<typeof setInterval> | null = null;
  private autoSpinCountdown = AUTO_SPIN_SECONDS;
  private rafId: number | null = null;
  private rotationSpeed = 0;
  private bridge: PauseAwareBridge | null = null;

  constructor(screenWidth: number, screenHeight: number, bridge?: PauseAwareBridge) {
    super();
    this.bridge = bridge ?? null;
    this.radius = Math.min(140, Math.floor(screenHeight * 0.25));

    // Semi-transparent backdrop
    this.backdrop = new Graphics();
    this.backdrop.rect(0, 0, screenWidth, screenHeight);
    this.backdrop.fill({ color: 0x000000, alpha: 0.75 });
    this.backdrop.eventMode = "static";
    this.addChild(this.backdrop);

    // Title
    this.titleText = new Text({
      text: "LYKKEHJUL!",
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
    this.wheelInner = new Container();
    this.wheelContainer.addChild(this.wheelInner);
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

    // Result text
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

  setOnPlay(callback: () => void): void {
    this.onPlay = callback;
  }

  setOnDismiss(callback: () => void): void {
    this.onDismiss = callback;
  }

  /** Allow late-wiring of the pause-aware bridge (Game1Controller passes it in). */
  setBridge(bridge: PauseAwareBridge): void {
    this.bridge = bridge;
  }

  show(data: MiniGameActivatedPayload): void {
    this.prizeList = data.prizeList;
    // Redraw with the actual prize list (colors + labels per 50 segments)
    this.drawWheel();
    this.isSpinning = false;
    this.spinBtn.visible = true;
    this.spinBtnText.text = "SPINN";
    this.resultText.visible = false;
    this.visible = true;

    // Auto-spin countdown (10 seconds). Respects server-authoritative pause —
    // while paused, the timer does not decrement (Unity parity:
    // Game1GamePlayPanel.SocketFlow.cs:672-696 freezes the scheduler on pause).
    this.autoSpinCountdown = AUTO_SPIN_SECONDS;
    this.timerText.text = `Auto-spinn om ${this.autoSpinCountdown}s`;
    this.autoSpinTimer = setInterval(() => {
      if (this.bridge?.getState().isPaused) return; // Pause-hook
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

  animateResult(result: MiniGamePlayResult): void {
    this.isSpinning = true;
    this.spinBtn.visible = false;
    this.clearAutoTimer();
    this.timerText.text = "";

    // Unity: SpinWheelScript.SpinTheWheel sets the pointer at the target-prize
    // angle with ± 3.25° jitter, then Update() spins with decay until it
    // reaches target. We replicate by placing the wheel at a starting rotation
    // then stepping via raf with rotationSpeed *= R_MULTIPLIER.
    const targetAngleDeg = result.segmentIndex * SEGMENT_ANGLE_DEG + SEGMENT_ANGLE_DEG / 2;
    const jitter = (Math.random() * 2 - 1) * STOP_JITTER_DEG;
    const finalAngleDeg = 360 * 6 + (360 - targetAngleDeg) + jitter;

    this.wheelInner.rotation = 0;

    // Drive rotation with Unity-style per-frame decay so the feel matches.
    // Adjust INITIAL_ROTATION_SPEED so the geometric series
    //   Σ v0 * R_MULTIPLIER^k  ≈ finalAngleDeg  ⇒  v0 ≈ finalAngleDeg * (1 - R_MULTIPLIER)
    this.rotationSpeed = finalAngleDeg * (1 - R_MULTIPLIER);
    let accumulatedDeg = 0;

    const tick = (): void => {
      // Pause-hook: freeze rotation while round is paused.
      if (this.bridge?.getState().isPaused) {
        this.rafId = requestAnimationFrame(tick);
        return;
      }

      accumulatedDeg += this.rotationSpeed;
      this.wheelInner.rotation = (accumulatedDeg * Math.PI) / 180;
      this.rotationSpeed *= R_MULTIPLIER;

      if (this.rotationSpeed <= STOP_SPEED_THRESHOLD) {
        // Snap to exact final angle (minor drift correction)
        this.wheelInner.rotation = (finalAngleDeg * Math.PI) / 180;
        this.rafId = null;
        this.onSpinComplete(result);
        return;
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private onSpinComplete(result: MiniGamePlayResult): void {
    this.isSpinning = false;
    this.resultText.text = `Du vant ${result.prizeAmount} kr!`;
    this.resultText.visible = true;

    gsap.delayedCall(4, () => {
      this.visible = false;
      this.onDismiss?.();
    });
  }

  destroy(options?: Parameters<Container["destroy"]>[0]): void {
    this.clearAutoTimer();
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    gsap.killTweensOf(this.wheelInner);
    super.destroy(options);
  }

  private handleSpinClick(): void {
    if (this.isSpinning) return;
    this.clearAutoTimer();
    this.timerText.text = "";
    this.onPlay?.();
  }

  private clearAutoTimer(): void {
    if (this.autoSpinTimer) {
      clearInterval(this.autoSpinTimer);
      this.autoSpinTimer = null;
    }
  }

  /**
   * Draw the 50-segment wheel (Unity SpinWheelScript.cs:180 loops i=0..50).
   * When prizeList < 50 we cycle through it modulo, matching Unity's behaviour
   * of duplicate prize tiers across the physical wheel.
   */
  private drawWheel(): void {
    this.wheelInner.removeChildren();
    const segmentAngleRad = (2 * Math.PI) / NUM_SEGMENTS;
    const initialOffsetRad = (INITIAL_Z_ROTATION_DEG * Math.PI) / 180;

    for (let i = 0; i < NUM_SEGMENTS; i++) {
      const startAngle = i * segmentAngleRad - Math.PI / 2 + initialOffsetRad;
      const endAngle = startAngle + segmentAngleRad;

      // Dynamic palette: HSL rotation around the colour wheel so neighbouring
      // segments contrast and the full wheel reads as a rainbow (Unity reads
      // colour from a prefab; we generate procedurally). Alternating slight
      // lightness/saturation gives a segmented look without requiring a 50-
      // colour hand-tuned palette.
      const hue = (i * 360) / NUM_SEGMENTS;
      const lightness = i % 2 === 0 ? 0.45 : 0.55;
      const color = hslToInt(hue, 0.7, lightness);

      const seg = new Graphics();
      seg.moveTo(0, 0);
      seg.arc(0, 0, this.radius, startAngle, endAngle);
      seg.closePath();
      seg.fill(color);
      seg.stroke({ color: 0x1a0a0a, width: 0.5 });
      this.wheelInner.addChild(seg);

      // Prize label (modulo prizeList — matches Unity prefab-duplicate pattern)
      const prize =
        this.prizeList.length > 0 ? this.prizeList[i % this.prizeList.length] : 0;
      const midAngle = startAngle + segmentAngleRad / 2;
      const labelR = this.radius * 0.72;
      // Smaller font: 50 segments are narrow. "X kr" on a 7.2° wedge.
      const label = new Text({
        text: `${prize}`,
        style: {
          fontFamily: "Arial",
          fontSize: Math.max(8, Math.floor(this.radius * 0.07)),
          fill: 0xffffff,
          fontWeight: "bold",
        },
      });
      label.anchor.set(0.5);
      label.x = Math.cos(midAngle) * labelR;
      label.y = Math.sin(midAngle) * labelR;
      label.rotation = midAngle + Math.PI / 2;
      this.wheelInner.addChild(label);
    }

    // Outer ring + hub
    const ring = new Graphics();
    ring.circle(0, 0, this.radius);
    ring.stroke({ color: 0x790001, width: 3 });
    ring.circle(0, 0, this.radius * 0.12);
    ring.fill(0x2e0000);
    ring.stroke({ color: 0x790001, width: 2 });
    this.wheelInner.addChild(ring);
  }
}

/** Test-only accessor for NUM_SEGMENTS — avoids exporting the constant publicly. */
export const __WheelOverlay_NUM_SEGMENTS__ = NUM_SEGMENTS;
