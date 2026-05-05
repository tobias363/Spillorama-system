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
import type { GameState } from "../../../bridge/GameBridge.js";

/**
 * Results overlay shown after game ends.
 * Displays winners, payouts, and auto-transitions back to lobby.
 */
export class EndScreen extends Container {
  private onDismiss: (() => void) | null = null;
  private screenWidth: number;
  private screenHeight: number;
  /** Active fade-in tween; killed in destroy() so it can't tween a destroyed
   *  Container (Pixi v8 set-y on null _position → render-loop crash). */
  private fadeTween: gsap.core.Tween | null = null;
  /** Active 8s auto-dismiss timer; killed in destroy() to avoid calling
   *  onDismiss after the screen has been replaced. */
  private autoDismissTimer: gsap.core.Tween | null = null;
  private dismissed = false;

  constructor(screenWidth: number, screenHeight: number) {
    super();
    this.screenWidth = screenWidth;
    this.screenHeight = screenHeight;

    // Semi-transparent overlay
    const overlay = new Graphics();
    overlay.rect(0, 0, screenWidth, screenHeight);
    overlay.fill({ color: 0x000000, alpha: 0.7 });
    this.addChild(overlay);
  }

  show(state: GameState): void {
    const w = 400;
    const h = 280;
    // Use the dims passed to the constructor instead of `this.parent?.width`
    // — parent.width walks the entire parent-container bounds, and when any
    // sibling was destroyed mid-transition it has a null transform whose
    // `.y` getter throws. That crash repeats on every Pixi render tick, so
    // the console floods with thousands of "Cannot read properties of null
    // (reading 'y')" errors (seen 2026-04-20 after switching to ENDED).
    const cx = this.screenWidth / 2;
    const cy = this.screenHeight / 2;

    // Results panel
    const panel = new Container();
    panel.x = cx - w / 2;
    panel.y = cy - h / 2;

    const bg = new Graphics();
    bg.roundRect(0, 0, w, h, 16);
    bg.fill(0x2e0000);
    bg.stroke({ color: 0x790001, width: 2 });
    panel.addChild(bg);

    const title = new Text({
      text: "Spill avsluttet!",
      style: { fontFamily: "Arial, Helvetica, sans-serif", fontSize: 28, fontWeight: "bold", fill: 0xffe83d },
    });
    title.anchor.set(0.5, 0);
    title.x = w / 2;
    title.y = 20;
    panel.addChild(title);

    // Pattern results
    let y = 70;
    for (const result of state.patternResults) {
      const text = new Text({
        text: result.isWon
          ? `${result.patternName}: ${result.payoutAmount ?? 0} kr`
          : `${result.patternName}: Ikke vunnet`,
        style: {
          fontFamily: "Arial",
          fontSize: 18,
          fill: result.isWon ? 0xffe83d : 0x666666,
        },
      });
      text.x = 30;
      text.y = y;
      panel.addChild(text);
      y += 30;
    }

    if (state.patternResults.length === 0) {
      const noResults = new Text({
        text: "Ingen vinnere denne runden",
        style: { fontFamily: "Arial", fontSize: 18, fill: 0x888888 },
      });
      noResults.x = 30;
      noResults.y = y;
      panel.addChild(noResults);
    }

    // "Next game" button
    const nextBtn = new Container();
    const nextBg = new Graphics();
    nextBg.roundRect(0, 0, 200, 44, 8);
    nextBg.fill(0xa00020);
    nextBtn.addChild(nextBg);
    const nextText = new Text({
      text: "Neste spill",
      style: { fontFamily: "Arial", fontSize: 18, fontWeight: "bold", fill: 0xffffff },
    });
    nextText.anchor.set(0.5);
    nextText.x = 100;
    nextText.y = 22;
    nextBtn.addChild(nextText);
    nextBtn.x = (w - 200) / 2;
    nextBtn.y = h - 64;
    nextBtn.eventMode = "static";
    nextBtn.cursor = "pointer";
    nextBtn.on("pointerdown", () => this.dismiss());
    panel.addChild(nextBtn);

    this.addChild(panel);

    // Fade in — stored so destroy() can kill it. Without the kill, GSAP keeps
    // writing `this.alpha = x` for 300ms AFTER the container is destroyed,
    // which Pixi v8 turns into a "Cannot set properties of null" crash loop
    // (every animation frame) because `_position` and `_scale` are nulled at
    // destroy.
    this.alpha = 0;
    this.fadeTween = gsap.to(this, { alpha: 1, duration: 0.3 });

    // Auto-dismiss after 8 seconds — same lifecycle concern.
    this.autoDismissTimer = gsap.delayedCall(8, () => this.dismiss());
  }

  setOnDismiss(callback: () => void): void {
    this.onDismiss = callback;
  }

  private dismiss(): void {
    if (this.dismissed) return;
    this.dismissed = true;
    if (this.onDismiss) this.onDismiss();
  }

  override destroy(options?: Parameters<Container["destroy"]>[0]): void {
    // Kill any pending tween / timer before tearing down the Pixi container.
    // Otherwise GSAP's next tick tries to write to `this.alpha` (or callback
    // fires on `this.dismiss`) on an already-destroyed container, which
    // surfaces as a repeating "Cannot set properties of null" in Pixi's
    // render loop (seen 2026-04-21).
    this.fadeTween?.kill();
    this.fadeTween = null;
    this.autoDismissTimer?.kill();
    this.autoDismissTimer = null;
    this.dismissed = true;
    super.destroy(options);
  }
}
