/**
 * Mystery Game mini-game overlay — ball selection mini-game.
 * Port from Unity MysteryGamePanel.cs.
 *
 * The mystery game presents N hidden balls. Player selects one to reveal
 * a prize. Server is authoritative on the actual prize (selectedIndex
 * is cosmetic, similar to TreasureChest).
 *
 * Socket: minigame:activated {type: "mysteryGame", prizeList} → minigame:play
 */

import { Container, Graphics, Text } from "pixi.js";
import gsap from "gsap";

const BALL_COUNT = 8;
const BALL_SIZE = 56;
const BALL_GAP = 12;

export class MysteryGameOverlay extends Container {
  private bg: Graphics;
  private balls: Container[] = [];
  private onPlay: ((selectedIndex: number) => void) | null = null;
  private onDismiss: (() => void) | null = null;
  private autoTimer: ReturnType<typeof setTimeout> | null = null;
  private prizeList: number[] = [];
  private revealed = false;

  constructor(w: number, h: number) {
    super();

    // Semi-transparent backdrop
    this.bg = new Graphics();
    this.bg.rect(0, 0, w, h);
    this.bg.fill({ color: 0x000000, alpha: 0.85 });
    this.addChild(this.bg);

    // Title
    const title = new Text({
      text: "Mystery Game",
      style: { fontFamily: "Arial", fontSize: 28, fontWeight: "bold", fill: 0xffe83d },
    });
    title.anchor.set(0.5);
    title.x = w / 2;
    title.y = h * 0.25;
    this.addChild(title);

    const subtitle = new Text({
      text: "Velg en kule for å avdekke premien!",
      style: { fontFamily: "Arial", fontSize: 16, fill: 0xcccccc },
    });
    subtitle.anchor.set(0.5);
    subtitle.x = w / 2;
    subtitle.y = h * 0.32;
    this.addChild(subtitle);

    // Balls grid (2 rows of 4)
    const gridW = 4 * BALL_SIZE + 3 * BALL_GAP;
    const startX = (w - gridW) / 2;
    const startY = h * 0.42;

    for (let i = 0; i < BALL_COUNT; i++) {
      const col = i % 4;
      const row = Math.floor(i / 4);
      const ball = this.createBall(i);
      ball.x = startX + col * (BALL_SIZE + BALL_GAP) + BALL_SIZE / 2;
      ball.y = startY + row * (BALL_SIZE + BALL_GAP) + BALL_SIZE / 2;
      this.addChild(ball);
      this.balls.push(ball);
    }
  }

  setOnPlay(callback: (selectedIndex: number) => void): void {
    this.onPlay = callback;
  }

  setOnDismiss(callback: () => void): void {
    this.onDismiss = callback;
  }

  show(data: { prizeList: number[] }): void {
    this.prizeList = data.prizeList;
    this.revealed = false;

    // Auto-select after 10 seconds (Unity: autoTurnMoveTime)
    this.autoTimer = setTimeout(() => {
      if (!this.revealed) {
        const randomIdx = Math.floor(Math.random() * BALL_COUNT);
        this.selectBall(randomIdx);
      }
    }, 10000);
  }

  animateResult(result: { segmentIndex: number; prizeAmount: number }): void {
    this.revealed = true;
    if (this.autoTimer) { clearTimeout(this.autoTimer); this.autoTimer = null; }

    // Reveal the winning ball
    const ball = this.balls[result.segmentIndex];
    if (ball) {
      gsap.to(ball.scale, { x: 1.3, y: 1.3, duration: 0.3 });
      const prizeText = ball.children.find((c) => c instanceof Text) as Text | undefined;
      if (prizeText) prizeText.text = `${result.prizeAmount} kr`;
    }

    // Auto-dismiss after 3 seconds
    setTimeout(() => this.onDismiss?.(), 3000);
  }

  private selectBall(index: number): void {
    if (this.revealed) return;
    this.revealed = true;
    if (this.autoTimer) { clearTimeout(this.autoTimer); this.autoTimer = null; }
    this.onPlay?.(index);
  }

  private createBall(index: number): Container {
    const ball = new Container();
    ball.eventMode = "static";
    ball.cursor = "pointer";

    const circle = new Graphics();
    circle.circle(0, 0, BALL_SIZE / 2);
    circle.fill(0x4a2080);
    circle.stroke({ width: 2, color: 0x8844cc });
    ball.addChild(circle);

    const text = new Text({
      text: "?",
      style: { fontFamily: "Arial", fontSize: 22, fontWeight: "bold", fill: 0xffffff },
    });
    text.anchor.set(0.5);
    ball.addChild(text);

    ball.on("pointerdown", () => this.selectBall(index));
    ball.on("pointerover", () => { if (!this.revealed) gsap.to(ball.scale, { x: 1.12, y: 1.12, duration: 0.15 }); });
    ball.on("pointerout", () => { if (!this.revealed) gsap.to(ball.scale, { x: 1, y: 1, duration: 0.15 }); });

    return ball;
  }
}
