/**
 * @deprecated for Spill 2 (rocket) per PR #923 + #926.
 * BEHOLDES kun for Game5Controller (SpinnGo, post-pilot scope).
 * Slett i Bølge D når Game5 enten flyttes til games/game5/-mappe
 * eller fjernes fra registry.
 *
 * Se docs/architecture/CLEANUP_AUDIT_2026-05-05.md §3 (Kategori B)
 * og §6 (Kategori E.1) for full kontekst.
 */

import { Container, Graphics, Text } from "pixi.js";
import gsap from "gsap";

/**
 * Drawn bingo ball with Unity-matching colors.
 * Orange/gold background with black text — matches Spillorama design.
 */
export class NumberBall extends Container {
  readonly ballNumber: number;

  constructor(number: number, size = 44) {
    super();
    this.ballNumber = number;
    const radius = size / 2;

    // Ball circle — gold/orange like Unity
    const bg = new Graphics();
    bg.circle(radius, radius, radius - 1);
    bg.fill(this.getColorForNumber(number));
    // Subtle inner highlight
    bg.circle(radius - 2, radius - 3, radius * 0.6);
    bg.fill({ color: 0xffffff, alpha: 0.15 });
    this.addChild(bg);

    // Number text — black on gold
    const numberText = new Text({
      text: String(number),
      style: {
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: Math.floor(size * 0.42),
        fill: 0x000000,
        fontWeight: "bold",
        align: "center",
      },
    });
    numberText.anchor.set(0.5);
    numberText.x = radius;
    numberText.y = radius;
    this.addChild(numberText);

    // Entry animation
    this.scale.set(0);
    gsap.to(this.scale, {
      x: 1,
      y: 1,
      duration: 0.3,
      ease: "back.out(1.7)",
    });
  }

  /** Ball colors matching Unity Spillorama design. */
  private getColorForNumber(n: number): number {
    if (n <= 12) return 0xe63946;  // Red
    if (n <= 24) return 0xf77f00;  // Orange
    if (n <= 36) return 0xffba00;  // Gold/yellow
    if (n <= 48) return 0x2a9d8f;  // Teal/green
    return 0x457b9d;               // Blue
  }
}
