import { Container, Graphics, Text } from "pixi.js";
import gsap from "gsap";

const COLS = 7;
const BALL_SIZE = 38;
const GAP = 6;
const MAX_NUMBER = 21;

/**
 * Modal picker for lucky number selection (1-21).
 * Grid of numbered balls. On tap, calls callback and closes.
 */
export class LuckyNumberPicker extends Container {
  private onSelect: ((number: number) => void) | null = null;
  private selectedNumber = 0;
  private overlay: Graphics;
  private panel: Container;

  constructor(screenWidth: number, screenHeight: number) {
    super();

    // Semi-transparent overlay
    this.overlay = new Graphics();
    this.overlay.rect(0, 0, screenWidth, screenHeight);
    this.overlay.fill({ color: 0x000000, alpha: 0.5 });
    this.overlay.eventMode = "static";
    this.overlay.on("pointerdown", () => this.hide());
    this.addChild(this.overlay);

    // Panel
    const rows = Math.ceil(MAX_NUMBER / COLS);
    const panelW = COLS * (BALL_SIZE + GAP) - GAP + 40;
    const panelH = rows * (BALL_SIZE + GAP) - GAP + 80;

    this.panel = new Container();
    this.panel.x = (screenWidth - panelW) / 2;
    this.panel.y = (screenHeight - panelH) / 2;

    const panelBg = new Graphics();
    panelBg.roundRect(0, 0, panelW, panelH, 12);
    panelBg.fill(0x2e0000);
    panelBg.stroke({ color: 0x790001, width: 2 });
    this.panel.addChild(panelBg);

    const title = new Text({
      text: "Velg heldig tall",
      style: { fontFamily: "Arial", fontSize: 20, fontWeight: "bold", fill: 0xffe83d },
    });
    title.anchor.set(0.5, 0);
    title.x = panelW / 2;
    title.y = 16;
    this.panel.addChild(title);

    // Number balls
    for (let i = 1; i <= MAX_NUMBER; i++) {
      const col = (i - 1) % COLS;
      const row = Math.floor((i - 1) / COLS);

      const ball = new Container();
      ball.x = 20 + col * (BALL_SIZE + GAP);
      ball.y = 50 + row * (BALL_SIZE + GAP);

      const circle = new Graphics();
      circle.circle(BALL_SIZE / 2, BALL_SIZE / 2, BALL_SIZE / 2 - 1);
      circle.fill(0x790001);
      ball.addChild(circle);

      const num = new Text({
        text: String(i),
        style: { fontFamily: "Arial", fontSize: 16, fontWeight: "bold", fill: 0xffffff },
      });
      num.anchor.set(0.5);
      num.x = BALL_SIZE / 2;
      num.y = BALL_SIZE / 2;
      ball.addChild(num);

      ball.eventMode = "static";
      ball.cursor = "pointer";
      ball.on("pointerdown", () => {
        this.selectedNumber = i;
        if (this.onSelect) this.onSelect(i);
        this.hide();
      });

      this.panel.addChild(ball);
    }

    this.addChild(this.panel);
    this.visible = false;
  }

  show(): void {
    this.visible = true;
    this.panel.alpha = 0;
    this.panel.scale.set(0.9);
    gsap.to(this.panel, { alpha: 1, duration: 0.2 });
    gsap.to(this.panel.scale, { x: 1, y: 1, duration: 0.2, ease: "back.out(1.5)" });
  }

  hide(): void {
    gsap.to(this.panel, {
      alpha: 0,
      duration: 0.15,
      onComplete: () => { this.visible = false; },
    });
  }

  setOnSelect(callback: (number: number) => void): void {
    this.onSelect = callback;
  }

  getSelected(): number {
    return this.selectedNumber;
  }
}
