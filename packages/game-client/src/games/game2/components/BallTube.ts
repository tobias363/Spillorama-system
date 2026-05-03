/**
 * Spill 2 Bong Mockup design — horisontalt glass-rør med countdown +
 * draw-counter på venstre side og en rad trukne baller til høyre.
 *
 * Mockup (`Bong Mockup.html`):
 *   ┌──────────────┬─────────────────────────────────────────┐
 *   │ Neste:       │ ●●●●●●●●●                              │ ← drawn balls
 *   │ MM:SS (gold) │                                          │
 *   ├──────────────┤                                          │
 *   │ Trekk        │                                          │
 *   │ 04/21        │                                          │
 *   └──────────────┴─────────────────────────────────────────┘
 *
 * Pixi-implementasjon:
 *   - Ytre `Graphics` tegner glass-tuben (rounded-rect med flere
 *     overlay-fyll for å simulere CSS `linear-gradient` + `inset`
 *     skygger). `backdrop-filter: blur(2px)` finnes ikke i Pixi —
 *     vi kompenserer med høyere alpha på de mørke fyll-lagene så
 *     bakgrunnen ikke "lekker" gjennom.
 *   - Counter-seksjonen er en fast 230px Container med to rader
 *     ("Neste trekning" + countdown, "Trekk" + N/total).
 *   - Trukne baller rendres som en horisontal rad av `DesignBall`,
 *     nyeste til venstre (matcher HTML-en der `drawn[0]` står
 *     til venstre i `.tube-balls`).
 *
 * Kontrakt mot `PlayScreen`:
 *   - `setSize(width, height)` setter tube-størrelse (kalles i
 *     constructor + ved evt. resize).
 *   - `setDrawCount(current, total)` oppdaterer "Trekk"-raden.
 *   - `setCountdown(milliseconds)` oppdaterer countdown-raden.
 *     Verdi `null` viser "—:—" (ingen aktiv timer).
 *   - `addBall(number)` legger ny ball til venstre, evicter eldste
 *     hvis raden er full.
 *   - `loadBalls(numbers)` rendrer hele raden fra snapshot uten
 *     animasjon (newest=siste i array, plassert til venstre).
 *   - `clear()` tømmer ball-raden og countdown.
 *
 * 2026-05-03 (Agent E, branch feat/spill2-bong-mockup-design): ny
 * komponent for Bong Mockup-redesign. Erstatter ikke G1's `BallTube` —
 * dette er en game2-spesifikk re-render.
 */

import { Container, Graphics, Text } from "pixi.js";
import gsap from "gsap";
import { DesignBall, DESIGN_BALL_SIZE } from "./DesignBall.js";

const TUBE_HEIGHT = 85;
const TUBE_RADIUS = 42;
const COUNTER_WIDTH = 230;
const BALLS_GAP = 10;
const BALLS_PADDING_X = 24;
const MAX_VISIBLE_BALLS = 9;

export class BallTube extends Container {
  private bg: Graphics;
  private divider: Graphics;
  private counter: Container;
  private countdownValue: Text;
  private drawCountValue: Text;
  private ballsContainer: Container;
  private balls: DesignBall[] = [];
  private tubeWidth: number;

  constructor(width: number) {
    super();
    this.tubeWidth = width;

    // 1) Outer tube background (glass effect) — flere lag for å
    //    matche `linear-gradient` + `inset` highlights fra HTML.
    this.bg = new Graphics();
    this.addChild(this.bg);
    this.drawBg();

    // 2) Counter section (left, fixed 230px wide).
    this.counter = new Container();
    this.counter.x = 0;
    this.counter.y = 0;
    this.addChild(this.counter);

    // Countdown row — Neste trekning + MM:SS (gold-glow).
    const counterRowH = TUBE_HEIGHT / 2;
    const countdownLabel = new Text({
      text: "Neste trekning:",
      style: {
        fontFamily: "Inter, system-ui, Helvetica, sans-serif",
        fontSize: 14,
        fontWeight: "500",
        fill: 0xeae0d2,
      },
    });
    countdownLabel.anchor.set(0.5, 0.5);
    countdownLabel.x = COUNTER_WIDTH * 0.40;
    countdownLabel.y = counterRowH / 2;
    this.counter.addChild(countdownLabel);

    this.countdownValue = new Text({
      text: "—:—",
      style: {
        fontFamily: "Inter, system-ui, Helvetica, sans-serif",
        fontSize: 17,
        fontWeight: "600",
        fill: 0xffd97a,
        // Pixi støtter ikke text-shadow direkte; gull-fargen + tabular-nums
        // er nok for å lese countdown'en mot mørk bakgrunn.
        letterSpacing: 1.2,
      },
    });
    this.countdownValue.anchor.set(0.5, 0.5);
    this.countdownValue.x = COUNTER_WIDTH * 0.78;
    this.countdownValue.y = counterRowH / 2;
    this.counter.addChild(this.countdownValue);

    // Draw count row — "Trekk N/M".
    const drawLabel = new Text({
      text: "Trekk",
      style: {
        fontFamily: "Inter, system-ui, Helvetica, sans-serif",
        fontSize: 14,
        fontWeight: "500",
        fill: 0xeae0d2,
      },
    });
    drawLabel.anchor.set(0.5, 0.5);
    drawLabel.x = COUNTER_WIDTH * 0.40;
    drawLabel.y = counterRowH * 1.5;
    this.counter.addChild(drawLabel);

    this.drawCountValue = new Text({
      text: "0/0",
      style: {
        fontFamily: "Inter, system-ui, Helvetica, sans-serif",
        fontSize: 17,
        fontWeight: "600",
        fill: 0xffffff,
        letterSpacing: 1.2,
      },
    });
    this.drawCountValue.anchor.set(0.5, 0.5);
    this.drawCountValue.x = COUNTER_WIDTH * 0.78;
    this.drawCountValue.y = counterRowH * 1.5;
    this.counter.addChild(this.drawCountValue);

    // Divider mellom counter og balls (matcher CSS border-right + border-top).
    this.divider = new Graphics();
    this.addChild(this.divider);
    this.drawDividers();

    // 3) Drawn-balls row.
    this.ballsContainer = new Container();
    this.ballsContainer.x = COUNTER_WIDTH + BALLS_PADDING_X;
    this.ballsContainer.y = (TUBE_HEIGHT - DESIGN_BALL_SIZE) / 2;
    this.addChild(this.ballsContainer);
  }

  /** Endre tube-bredden. Counter-bredden holdes fast på 230px. */
  setSize(width: number): void {
    if (width === this.tubeWidth) return;
    this.tubeWidth = width;
    this.drawBg();
    this.drawDividers();
    this.layoutBalls(false);
  }

  /** Sett "Trekk N/M" — kalles fra `PlayScreen` ved hver `numberDrawn`. */
  setDrawCount(current: number, total: number): void {
    const totStr = total > 0 ? `${pad2(current)}/${pad2(total)}` : `${current}`;
    this.drawCountValue.text = totStr;
  }

  /**
   * Sett countdown til neste trekning (i millisekunder). `null`/0
   * viser "—:—". Verdier > 99:59 vises som "99:59" (cap'et).
   */
  setCountdown(milliseconds: number | null): void {
    if (milliseconds == null || milliseconds <= 0) {
      this.countdownValue.text = "—:—";
      return;
    }
    const totalSec = Math.floor(milliseconds / 1000);
    const m = Math.min(99, Math.floor(totalSec / 60));
    const s = totalSec % 60;
    this.countdownValue.text = `${pad2(m)}:${pad2(s)}`;
  }

  /**
   * Legg til ny ball til venstre i raden. Hvis raden er full
   * (>= MAX_VISIBLE_BALLS), evicter vi den eldste (helt til høyre)
   * med en kort fade-ut.
   */
  addBall(number: number): void {
    const ball = new DesignBall(number, DESIGN_BALL_SIZE);
    ball.alpha = 0;
    ball.scale.set(0.6);
    this.ballsContainer.addChild(ball);
    this.balls.unshift(ball);

    while (this.balls.length > MAX_VISIBLE_BALLS) {
      const evicted = this.balls.pop();
      if (evicted) {
        gsap.to(evicted, {
          alpha: 0,
          duration: 0.25,
          ease: "power1.in",
          onComplete: () => {
            if (!evicted.destroyed) evicted.destroy({ children: true });
          },
        });
      }
    }

    this.layoutBalls(true);
    gsap.to(ball, { alpha: 1, duration: 0.20, ease: "power1.out" });
    gsap.to(ball.scale, {
      x: 1,
      y: 1,
      duration: 0.30,
      ease: "back.out(1.6)",
    });
  }

  /**
   * Last alle baller fra snapshot — uten animasjon. `numbers` er i
   * trekkrekkefølge (eldste først, nyeste sist) — vi reverserer for
   * å plassere nyeste til venstre slik HTML-en gjør.
   */
  loadBalls(numbers: number[]): void {
    this.clear();
    if (numbers.length === 0) return;
    const tail = numbers.slice(-MAX_VISIBLE_BALLS);
    const reversed = [...tail].reverse();
    for (const n of reversed) {
      const ball = new DesignBall(n, DESIGN_BALL_SIZE);
      this.ballsContainer.addChild(ball);
      this.balls.push(ball);
    }
    this.layoutBalls(false);
  }

  clear(): void {
    for (const b of this.balls) {
      gsap.killTweensOf(b);
      if (!b.destroyed) b.destroy({ children: true });
    }
    this.balls = [];
    this.ballsContainer.removeChildren();
  }

  destroy(options?: Parameters<Container["destroy"]>[0]): void {
    this.clear();
    super.destroy(options);
  }

  // ── interne tegne-rutiner ───────────────────────────────────────────────

  private drawBg(): void {
    this.bg.clear();
    // Mørk base — matcher CSS `rgba(20,5,8,0.45)` med litt høyere alpha
    // for å unngå at bakgrunns-bilde "lekker" gjennom uten blur.
    this.bg.roundRect(0, 0, this.tubeWidth, TUBE_HEIGHT, TUBE_RADIUS).fill({
      color: 0x140508,
      alpha: 0.55,
    });
    // Topp-highlight (matcher `linear-gradient` 0%→18% rgba(255,255,255,.10)).
    this.bg
      .roundRect(0, 0, this.tubeWidth, TUBE_HEIGHT * 0.40, TUBE_RADIUS)
      .fill({ color: 0xffffff, alpha: 0.06 });
    // Liten kantskygge nederst (matcher `inset 0 -2px 6px rgba(0,0,0,.45)`).
    this.bg
      .roundRect(2, TUBE_HEIGHT - 4, this.tubeWidth - 4, 4, 4)
      .fill({ color: 0x000000, alpha: 0.30 });
    // Border (`1.5px solid rgba(255,255,255,.55)`).
    this.bg
      .roundRect(0, 0, this.tubeWidth, TUBE_HEIGHT, TUBE_RADIUS)
      .stroke({ color: 0xffffff, alpha: 0.55, width: 1.5 });
    // Topp-sheen-stripe (matcher `.tube::before` — small white stripe).
    this.bg
      .roundRect(24, 6, this.tubeWidth - 48, 14, 10)
      .fill({ color: 0xffffff, alpha: 0.18 });
  }

  private drawDividers(): void {
    this.divider.clear();
    // Vertikal divider (mellom counter og baller).
    this.divider
      .rect(COUNTER_WIDTH, 6, 1.5, TUBE_HEIGHT - 12)
      .fill({ color: 0xffffff, alpha: 0.55 });
    // Horisontal divider (mellom counter-rad 1 og rad 2).
    this.divider
      .rect(8, TUBE_HEIGHT / 2, COUNTER_WIDTH - 16, 1.5)
      .fill({ color: 0xffffff, alpha: 0.55 });
  }

  private layoutBalls(animate: boolean): void {
    for (let i = 0; i < this.balls.length; i++) {
      const target = this.balls[i];
      const xTarget = i * (DESIGN_BALL_SIZE + BALLS_GAP);
      if (animate) {
        gsap.to(target, { x: xTarget, duration: 0.30, ease: "power2.out" });
      } else {
        target.x = xTarget;
      }
    }
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
