/**
 * Color Draft mini-game overlay — color selection mini-game.
 * Port from Unity ColorDraftPanel.cs.
 *
 * Player selects a color to reveal a prize. Server is authoritative.
 * Similar pattern to TreasureChest and MysteryGame.
 *
 * Socket: minigame:activated {type: "colorDraft", prizeList} → minigame:play
 */

import { Container, Graphics, Text } from "pixi.js";
import gsap from "gsap";

const COLORS = [
  { fill: 0xd20000, label: "Rød" },
  { fill: 0xf5c103, label: "Gul" },
  { fill: 0x199600, label: "Grønn" },
  { fill: 0x3a7adf, label: "Blå" },
  { fill: 0xaf91ff, label: "Lilla" },
  { fill: 0xff6400, label: "Oransje" },
];

const CARD_SIZE = 80;
const CARD_GAP = 16;

export class ColorDraftOverlay extends Container {
  private bg: Graphics;
  private cards: Container[] = [];
  private onPlay: ((selectedIndex: number) => void) | null = null;
  private onDismiss: (() => void) | null = null;
  private autoTimer: ReturnType<typeof setTimeout> | null = null;
  private revealed = false;

  constructor(w: number, h: number) {
    super();

    this.bg = new Graphics();
    this.bg.rect(0, 0, w, h);
    this.bg.fill({ color: 0x000000, alpha: 0.85 });
    this.addChild(this.bg);

    const title = new Text({
      text: "Color Draft",
      style: { fontFamily: "Arial", fontSize: 28, fontWeight: "bold", fill: 0xffe83d },
    });
    title.anchor.set(0.5);
    title.x = w / 2;
    title.y = h * 0.25;
    this.addChild(title);

    const subtitle = new Text({
      text: "Velg en farge for å avdekke premien!",
      style: { fontFamily: "Arial", fontSize: 16, fill: 0xcccccc },
    });
    subtitle.anchor.set(0.5);
    subtitle.x = w / 2;
    subtitle.y = h * 0.32;
    this.addChild(subtitle);

    // Color cards (3x2)
    const gridW = 3 * CARD_SIZE + 2 * CARD_GAP;
    const startX = (w - gridW) / 2;
    const startY = h * 0.40;

    for (let i = 0; i < COLORS.length; i++) {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const card = this.createCard(i, COLORS[i]);
      card.x = startX + col * (CARD_SIZE + CARD_GAP) + CARD_SIZE / 2;
      card.y = startY + row * (CARD_SIZE + CARD_GAP) + CARD_SIZE / 2;
      this.addChild(card);
      this.cards.push(card);
    }
  }

  setOnPlay(callback: (selectedIndex: number) => void): void {
    this.onPlay = callback;
  }

  setOnDismiss(callback: () => void): void {
    this.onDismiss = callback;
  }

  show(_data: { prizeList: number[] }): void {
    this.revealed = false;
    this.autoTimer = setTimeout(() => {
      if (!this.revealed) {
        this.selectCard(Math.floor(Math.random() * COLORS.length));
      }
    }, 10000);
  }

  animateResult(result: { segmentIndex: number; prizeAmount: number }): void {
    this.revealed = true;
    if (this.autoTimer) { clearTimeout(this.autoTimer); this.autoTimer = null; }

    const card = this.cards[result.segmentIndex];
    if (card) {
      gsap.to(card.scale, { x: 1.2, y: 1.2, duration: 0.3 });
      const prizeText = card.children.find((c) => c instanceof Text && c.text === "?") as Text | undefined;
      if (prizeText) prizeText.text = `${result.prizeAmount} kr`;
    }

    setTimeout(() => this.onDismiss?.(), 3000);
  }

  private selectCard(index: number): void {
    if (this.revealed) return;
    this.revealed = true;
    if (this.autoTimer) { clearTimeout(this.autoTimer); this.autoTimer = null; }
    this.onPlay?.(index);
  }

  private createCard(index: number, colorDef: { fill: number; label: string }): Container {
    const card = new Container();
    card.eventMode = "static";
    card.cursor = "pointer";

    const rect = new Graphics();
    rect.roundRect(-CARD_SIZE / 2, -CARD_SIZE / 2, CARD_SIZE, CARD_SIZE, 12);
    rect.fill(colorDef.fill);
    rect.stroke({ width: 2, color: 0xffffff, alpha: 0.3 });
    card.addChild(rect);

    const text = new Text({
      text: "?",
      style: { fontFamily: "Arial", fontSize: 28, fontWeight: "bold", fill: 0xffffff },
    });
    text.anchor.set(0.5);
    card.addChild(text);

    const label = new Text({
      text: colorDef.label,
      style: { fontFamily: "Arial", fontSize: 11, fill: 0xffffff },
    });
    label.alpha = 0.8;
    label.anchor.set(0.5);
    label.y = CARD_SIZE / 2 - 14;
    card.addChild(label);

    card.on("pointerdown", () => this.selectCard(index));
    card.on("pointerover", () => { if (!this.revealed) gsap.to(card.scale, { x: 1.08, y: 1.08, duration: 0.15 }); });
    card.on("pointerout", () => { if (!this.revealed) gsap.to(card.scale, { x: 1, y: 1, duration: 0.15 }); });

    return card;
  }
}
