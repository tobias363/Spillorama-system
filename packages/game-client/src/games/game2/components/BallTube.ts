/**
 * Spill 2 Bong Mockup design — horisontalt glass-rør med countdown +
 * draw-counter på venstre side og en rad trukne baller til høyre.
 *
 * 2026-05-04 (Tobias-direktiv): SPILL 1-PARITET PÅ DESIGN OG ANIMASJON.
 *   - Bruker samme ball-PNG-er som Spill 1 (`/web/games/assets/game1/
 *     design/balls/{color}.png`) i stedet for `DesignBall`-Graphics.
 *   - "Neste trekning"-raden SKJULES under aktiv runde (RUNNING) — vises
 *     KUN mellom runder så countdown forteller når neste trekning starter.
 *   - MAX_VISIBLE_BALLS økt fra 9 → 12 for å fylle tuben bedre.
 *   - Ball-pop sentrert er FJERNET i PlayScreen — ny ball plasseres
 *     direkte i venstre slot, andre skifter høyre, eldste evicter til
 *     høyre. Animasjon her speiler Spill 1's `addBall`-flyt.
 *
 * Pixi-implementasjon:
 *   - Ytre `Graphics` tegner glass-tuben (rounded-rect med flere
 *     overlay-fyll for å simulere CSS `linear-gradient` + `inset`).
 *   - Counter-seksjonen er en fast 230px Container med to rader:
 *     "Neste trekning" + countdown (SKJULES under RUNNING),
 *     "Trekk N/M" (alltid synlig).
 *   - Trukne baller rendres som PNG-Sprites med Text-overlay (samme
 *     mønster som Spill 1's `BallTube.createBall`).
 *
 * Kontrakt mot `PlayScreen`:
 *   - `setSize(width)` setter tube-størrelse.
 *   - `setDrawCount(current, total)` oppdaterer "Trekk"-raden.
 *   - `setCountdown(milliseconds)` oppdaterer countdown.
 *   - `setRunning(running)` viser/skjuler "Neste trekning"-raden.
 *   - `addBall(number)` legger ny ball til venstre, evicter eldste til høyre.
 *   - `loadBalls(numbers)` rendrer hele raden fra snapshot uten animasjon.
 *   - `clear()` tømmer ball-raden.
 */

import { Container, Graphics, Text, Sprite, Assets, type Texture } from "pixi.js";
import gsap from "gsap";

const TUBE_HEIGHT = 85;
const TUBE_RADIUS = 42;
const COUNTER_WIDTH = 230;
const BALLS_GAP = 6;
const BALLS_PADDING_X = 18;
/** Tobias-direktiv 2026-05-04: 9 → 12 baller (tre flere) for å fylle tuben. */
const MAX_VISIBLE_BALLS = 12;
/** Ball-størrelse i tuben — matcher Spill 1's BallTube `BALL_SIZE` (70px)
 *  skalert ned til tube-høyde. Tuben er 85px så vi setter 64 for litt
 *  padding rundt og dermed plass til 12 baller jevnt fordelt. */
const BALL_SIZE = 64;

/**
 * PNG-ball-mapping (port av Spill 1's `getBallAssetPath`). Spill 2 har
 * range 1-21 så praktisk dekker vi 1-15=blue og 16-21=red. Inkludert
 * fullt 75-mapping for kompatibilitet med eventuell senere bruk i
 * Spill 3 (`monsterbingo`) som extender Game2Engine.
 */
function getBallAssetPath(n: number): string {
  if (n <= 15) return "/web/games/assets/game1/design/balls/blue.png";
  if (n <= 30) return "/web/games/assets/game1/design/balls/red.png";
  if (n <= 45) return "/web/games/assets/game1/design/balls/purple.png";
  if (n <= 60) return "/web/games/assets/game1/design/balls/green.png";
  return "/web/games/assets/game1/design/balls/yellow.png";
}

/**
 * Speilet av Spill 1's `enableMipmaps`. Uten mipmaps får skalert PNG-
 * tekstur stygg aliasing. Pixi støtter ikke mipmaps før vi eksplisitt
 * slår det på per-source.
 */
function enableMipmaps(texture: Texture): void {
  const src = texture.source as unknown as {
    autoGenerateMipmaps?: boolean;
    scaleMode?: string;
    updateMipmaps?: () => void;
  };
  if (src && !src.autoGenerateMipmaps) {
    src.autoGenerateMipmaps = true;
    src.scaleMode = "linear";
    src.updateMipmaps?.();
  }
}

type Ball = Container & { ballNumber: number };

function createBall(number: number, size: number): Ball {
  const ball = new Container() as Ball;
  ball.ballNumber = number;

  const url = getBallAssetPath(number);
  const cached = Assets.cache.get(url) as Texture | undefined;
  if (cached) {
    enableMipmaps(cached);
    const sprite = new Sprite(cached);
    sprite.width = size;
    sprite.height = size;
    ball.addChild(sprite);
  } else {
    void Assets.load(url)
      .then((tex: Texture) => {
        if (ball.destroyed) return;
        enableMipmaps(tex);
        const sprite = new Sprite(tex);
        sprite.width = size;
        sprite.height = size;
        ball.addChildAt(sprite, 0);
      })
      .catch(() => {});
  }

  const text = new Text({
    text: String(number),
    style: {
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      fontSize: Math.round(size * 0.34),
      fill: 0x1a0a0a,
      fontWeight: "800",
      align: "center",
      letterSpacing: -0.5,
    },
  });
  text.anchor.set(0.5);
  // Spill 1 bruker -2px optisk forskyvning av tallet inni ring-grafikken.
  text.x = size / 2 - 2;
  text.y = size / 2;
  ball.addChild(text);

  return ball;
}

export class BallTube extends Container {
  private bg: Graphics;
  private divider: Graphics;
  private counter: Container;
  /** Container som holder "Neste trekning"-raden (label+verdi) — toggles
   *  visible i `setRunning(running)` så den skjules under aktiv runde. */
  private countdownRow: Container;
  private countdownValue: Text;
  private drawCountValue: Text;
  /** Container som holder "Trekk N/M"-raden — sentreres når countdown-
   *  raden er skjult, ellers står den i nedre halvdel som før. */
  private drawCountRow: Container;
  private ballsContainer: Container;
  private balls: Ball[] = [];
  private tubeWidth: number;
  /** Tobias-direktiv 2026-05-04: skjul "Neste trekning" under aktiv runde. */
  private isRunning: boolean = false;

  constructor(width: number) {
    super();
    this.tubeWidth = width;

    // 1) Glass-tube bakgrunn.
    this.bg = new Graphics();
    this.addChild(this.bg);
    this.drawBg();

    // 2) Counter-seksjon (venstre, fast 230px).
    this.counter = new Container();
    this.counter.x = 0;
    this.counter.y = 0;
    this.addChild(this.counter);

    const counterRowH = TUBE_HEIGHT / 2;

    // ── "Neste trekning"-raden (kan skjules) ────────────────────────────
    this.countdownRow = new Container();
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
    this.countdownRow.addChild(countdownLabel);

    this.countdownValue = new Text({
      text: "—:—",
      style: {
        fontFamily: "Inter, system-ui, Helvetica, sans-serif",
        fontSize: 17,
        fontWeight: "600",
        fill: 0xffd97a,
        letterSpacing: 1.2,
      },
    });
    this.countdownValue.anchor.set(0.5, 0.5);
    this.countdownValue.x = COUNTER_WIDTH * 0.78;
    this.countdownValue.y = counterRowH / 2;
    this.countdownRow.addChild(this.countdownValue);
    this.counter.addChild(this.countdownRow);

    // ── "Trekk N/M"-raden ────────────────────────────────────────────────
    this.drawCountRow = new Container();
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
    this.drawCountRow.addChild(drawLabel);

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
    this.drawCountRow.addChild(this.drawCountValue);
    this.counter.addChild(this.drawCountRow);

    // Divider mellom counter og baller (vertikal) + mellom rad-1 og rad-2
    // (horisontal). Den horisontale skjules sammen med countdown-raden.
    this.divider = new Graphics();
    this.addChild(this.divider);
    this.drawDividers();

    // 3) Ball-container.
    this.ballsContainer = new Container();
    this.ballsContainer.x = COUNTER_WIDTH + BALLS_PADDING_X;
    this.ballsContainer.y = (TUBE_HEIGHT - BALL_SIZE) / 2;
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

  /** Sett "Trekk N/M". */
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
   * Tobias-direktiv 2026-05-04: skjul "Neste trekning"-raden under aktiv
   * trekning. "Trekk N/M" sentreres vertikalt i counter-seksjonen når
   * countdown er skjult, ellers står den i nedre halvdel.
   *
   * Idempotent — gjør ingenting hvis allerede i ønsket state.
   */
  setRunning(running: boolean): void {
    if (running === this.isRunning) return;
    this.isRunning = running;
    this.countdownRow.visible = !running;
    // Sentrer "Trekk"-raden når countdown er skjult.
    const counterRowH = TUBE_HEIGHT / 2;
    this.drawCountRow.y = running ? -counterRowH * 0.5 : 0;
    // Re-tegn dividers så horisontal-divideren matcher.
    this.drawDividers();
  }

  /**
   * Legg til ny ball til venstre i raden. Hvis raden er full
   * (>= MAX_VISIBLE_BALLS), evicter vi den eldste (helt til høyre)
   * med en kort fade-ut til høyre. Andre baller skifter ETT slot
   * til høyre.
   */
  addBall(number: number): void {
    const ball = createBall(number, BALL_SIZE);
    ball.alpha = 0;
    ball.x = -BALL_SIZE; // start utenfor venstre kant
    this.ballsContainer.addChild(ball);
    this.balls.unshift(ball);

    while (this.balls.length > MAX_VISIBLE_BALLS) {
      const evicted = this.balls.pop();
      if (evicted) {
        gsap.to(evicted, {
          alpha: 0,
          x: evicted.x + BALL_SIZE * 0.6,
          duration: 0.30,
          ease: "power1.in",
          onComplete: () => {
            if (!evicted.destroyed) evicted.destroy({ children: true });
          },
        });
      }
    }

    this.layoutBalls(true);
    gsap.to(ball, { alpha: 1, duration: 0.20, ease: "power1.out" });
  }

  /**
   * Last alle baller fra snapshot — uten animasjon. `numbers` er i
   * trekkrekkefølge (eldste først, nyeste sist). Vi reverserer for
   * å plassere nyeste til venstre.
   */
  loadBalls(numbers: number[]): void {
    this.clear();
    if (numbers.length === 0) return;
    const tail = numbers.slice(-MAX_VISIBLE_BALLS);
    const reversed = [...tail].reverse();
    for (const n of reversed) {
      const ball = createBall(n, BALL_SIZE);
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
    this.bg.roundRect(0, 0, this.tubeWidth, TUBE_HEIGHT, TUBE_RADIUS).fill({
      color: 0x140508,
      alpha: 0.55,
    });
    this.bg
      .roundRect(0, 0, this.tubeWidth, TUBE_HEIGHT * 0.40, TUBE_RADIUS)
      .fill({ color: 0xffffff, alpha: 0.06 });
    this.bg
      .roundRect(2, TUBE_HEIGHT - 4, this.tubeWidth - 4, 4, 4)
      .fill({ color: 0x000000, alpha: 0.30 });
    this.bg
      .roundRect(0, 0, this.tubeWidth, TUBE_HEIGHT, TUBE_RADIUS)
      .stroke({ color: 0xffffff, alpha: 0.55, width: 1.5 });
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
    // Horisontal divider (kun synlig når countdown-raden vises).
    if (!this.isRunning) {
      this.divider
        .rect(8, TUBE_HEIGHT / 2, COUNTER_WIDTH - 16, 1.5)
        .fill({ color: 0xffffff, alpha: 0.55 });
    }
  }

  private layoutBalls(animate: boolean): void {
    for (let i = 0; i < this.balls.length; i++) {
      const target = this.balls[i];
      const xTarget = i * (BALL_SIZE + BALLS_GAP);
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
