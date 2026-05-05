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

/**
 * Info bar matching Unity Spillorama header: player count, draw count, prize pool.
 */
export class PlayerInfoBar extends Container {
  private bg: Graphics;
  private playersText: Text;
  private drawText: Text;
  private prizeText: Text;
  private barWidth: number;

  constructor(width = 600) {
    super();
    this.barWidth = width;

    // Dark background bar
    this.bg = new Graphics();
    this.bg.roundRect(0, 0, width, 40, 8);
    this.bg.fill(0x2e0000);
    this.addChild(this.bg);

    // Player icon + count
    this.playersText = new Text({
      text: "0 spillere",
      style: { fontFamily: "Arial", fontSize: 14, fontWeight: "bold", fill: 0xffe83d },
    });
    this.playersText.x = 16;
    this.playersText.y = 10;
    this.addChild(this.playersText);

    // Draw count (center)
    this.drawText = new Text({
      text: "Antall trekk",
      style: { fontFamily: "Arial", fontSize: 14, fontWeight: "bold", fill: 0xffffff },
    });
    this.drawText.anchor.set(0.5, 0);
    this.drawText.x = width / 2;
    this.drawText.y = 10;
    this.addChild(this.drawText);

    // Prize pool (right)
    this.prizeText = new Text({
      text: "",
      style: { fontFamily: "Arial", fontSize: 14, fontWeight: "bold", fill: 0xffe83d },
    });
    this.prizeText.anchor.set(1, 0);
    this.prizeText.x = width - 16;
    this.prizeText.y = 10;
    this.addChild(this.prizeText);
  }

  update(playerCount: number, drawCount: number, totalDraws: number, prizePool: number): void {
    this.playersText.text = `👤 ${playerCount} spillere`;
    this.drawText.text = drawCount > 0 ? `Antall trekk ${drawCount}/${totalDraws}` : "Venter på spill";
    this.prizeText.text = prizePool > 0 ? `Innsats: ${prizePool} kr` : "";
  }
}
