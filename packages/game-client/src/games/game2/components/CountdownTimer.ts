import { Container, Text } from "pixi.js";
import gsap from "gsap";

/**
 * Countdown timer with scale/color pulse animation.
 * Matches Unity TimerTxtAnim pattern from Game2GamePlayPanel.SocketFlow.cs.
 */
export class CountdownTimer extends Container {
  private timerText: Text;
  private deadline = 0;
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private pulseTween: gsap.core.Timeline | null = null;

  constructor() {
    super();

    this.timerText = new Text({
      text: "",
      style: {
        fontFamily: "Arial",
        fontSize: 48,
        fontWeight: "bold",
        fill: 0xffe83d,
        align: "center",
      },
    });
    this.timerText.anchor.set(0.5);
    this.addChild(this.timerText);
    this.visible = false;
  }

  /** Start countdown from milliseconds until start. */
  startCountdown(millisUntilStart: number): void {
    this.stop();
    this.deadline = Date.now() + millisUntilStart;
    this.visible = true;
    this.update();

    this.tickInterval = setInterval(() => this.update(), 250);
    this.startPulse();
  }

  stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    if (this.pulseTween) {
      this.pulseTween.kill();
      this.pulseTween = null;
    }
    this.visible = false;
    this.scale.set(1);
  }

  private update(): void {
    const remaining = Math.max(0, Math.ceil((this.deadline - Date.now()) / 1000));
    this.timerText.text = String(remaining);

    if (remaining <= 0) {
      this.stop();
    }
  }

  private startPulse(): void {
    this.pulseTween = gsap.timeline({ repeat: -1 });
    this.pulseTween
      .to(this.scale, { x: 0.85, y: 0.85, duration: 0.25, ease: "power2.in" })
      .to(this.scale, { x: 1.15, y: 1.15, duration: 0.5, ease: "power2.out" })
      .to(this.scale, { x: 1, y: 1, duration: 0.25, ease: "power2.inOut" });
  }
}
