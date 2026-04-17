import { Container, Graphics, Text } from "pixi.js";
import gsap from "gsap";
import type { PatternDefinition, PatternResult } from "@spillorama/shared-types/game";

/**
 * G3 pattern-ping-pong banner — shows the current un-won pattern to help
 * players see which shape they're trying to complete. Port of Unity
 * PrefabBingoGame3Pattern.cs ping-pong scale animation (§11.1 BIN-530).
 */
export class PatternBanner extends Container {
  private bg: Graphics;
  private patternText: Text;
  private pulseTween: gsap.core.Tween | null = null;
  private currentPatternId: string | null = null;

  constructor(width: number) {
    super();

    this.bg = new Graphics();
    this.bg.roundRect(0, 0, width, 36, 8);
    this.bg.fill({ color: 0x1a0a1f, alpha: 0.85 });
    this.bg.stroke({ color: 0x9d4edd, width: 1, alpha: 0.8 });
    this.addChild(this.bg);

    this.patternText = new Text({
      text: "",
      style: {
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 15,
        fontWeight: "bold",
        fill: 0xffe83d,
      },
    });
    this.patternText.anchor.set(0.5);
    this.patternText.x = width / 2;
    this.patternText.y = 18;
    this.addChild(this.patternText);

    this.visible = false;
  }

  /** Select first un-won pattern (lowest `order`) and update label. */
  update(patterns: PatternDefinition[], results: PatternResult[]): void {
    const wonIds = new Set(results.filter((r) => r.isWon).map((r) => r.patternId));
    const next = [...patterns]
      .sort((a, b) => a.order - b.order)
      .find((p) => !wonIds.has(p.id));

    if (!next) {
      this.hide();
      return;
    }
    if (next.id === this.currentPatternId) return;
    this.currentPatternId = next.id;

    this.patternText.text = `Neste mønster: ${next.name}`;
    this.visible = true;
    this.startPulse();
  }

  hide(): void {
    this.visible = false;
    this.currentPatternId = null;
    this.stopPulse();
  }

  destroy(options?: Parameters<Container["destroy"]>[0]): void {
    this.stopPulse();
    super.destroy(options);
  }

  private startPulse(): void {
    this.stopPulse();
    this.patternText.scale.set(1);
    this.pulseTween = gsap.to(this.patternText.scale, {
      x: 1.08,
      y: 1.08,
      duration: 0.6,
      repeat: -1,
      yoyo: true,
      ease: "sine.inOut",
    });
  }

  private stopPulse(): void {
    this.pulseTween?.kill();
    this.pulseTween = null;
    this.patternText.scale.set(1);
  }
}
