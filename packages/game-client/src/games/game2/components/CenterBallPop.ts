/**
 * Spill 2 (Tallspill) — animert "just-drew"-ball som popper opp på skjerm
 * når en ball trekkes. Speilet av Spill 1's `CenterBall.showNumber`-flyt,
 * men gjenbruker `DesignBall` (Spill 2's prosedurale tegning) i stedet
 * for PNG-baller.
 *
 * Tobias-direktiv 2026-05-04:
 *   "ingen animasjoner av baller som trekkes. dette må være likt som på
 *    spill 1"
 *
 * Designvalg:
 *   - Komponenten er en frittstående `Container` som mountes som child av
 *     `PlayScreen`. Den er usynlig (alpha=0) i idle.
 *   - Når `pop(number)` kalles:
 *       1. Bytt DesignBall til ny number (rebuild).
 *       2. scale 0.4 → 1.0 + alpha 0 → 1 (back.out 1.7) over 0.4s.
 *       3. Hold synlig i ~0.65s så spilleren rekker å lese tallet.
 *       4. Fade ut + skaler litt opp samtidig (mot tube-retning) over 0.35s.
 *       5. alpha tilbake til 0; ny ball er nå i tuben (BallTube.addBall
 *          kalles parallelt fra PlayScreen).
 *   - Ingen "fly til tube"-bevegelse i v1 — det krever koordinatsync mot
 *     BallTube's posisjon. Pop + fade gir samme "just-drew"-signal og er
 *     trygt å lande raskt.
 *
 * Animasjon-cleanup: `destroy` dreper alle GSAP-tweens på containeren og
 * scale-objektet. Idempotent `pop` — hvis en ball allerede vises og en ny
 * trekning kommer før forrige fade er ferdig, kanselleres forrige tween
 * og ny ball erstatter umiddelbart (som i live-rekonsiliering).
 */

import { Container, Graphics } from "pixi.js";
import gsap from "gsap";
import { DesignBall } from "./DesignBall.js";

/** Stor diameter — ~2.5x normal tube-ball så popp-effekten er tydelig. */
const POP_BALL_SIZE = 150;
/** Hvor lenge ballen vises på topp (etter scale-in, før fade-ut). */
const HOLD_MS = 650;

export class CenterBallPop extends Container {
  private currentBall: DesignBall | null = null;
  /** Soft halo bak ballen for å løfte den fra bakgrunnen. */
  private halo: Graphics;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super();
    this.alpha = 0;
    // Pivot i sentrum så scale skjer rundt midten.
    this.pivot.set(POP_BALL_SIZE / 2, POP_BALL_SIZE / 2);

    // Halo bak ballen — radial-fade fra hvit til transparent. Tegnet som
    // konsentriske sirkler med synkende alpha (Pixi har ikke radial-grad
    // direkte). Holdes liten + soft så den ikke skjuler bong-grid bak.
    this.halo = new Graphics();
    const haloR = POP_BALL_SIZE * 0.78;
    const cx = POP_BALL_SIZE / 2;
    const cy = POP_BALL_SIZE / 2;
    this.halo.circle(cx, cy, haloR).fill({ color: 0xffd97a, alpha: 0.10 });
    this.halo.circle(cx, cy, haloR * 0.78).fill({ color: 0xffe89a, alpha: 0.14 });
    this.halo.circle(cx, cy, haloR * 0.55).fill({ color: 0xfff1c0, alpha: 0.18 });
    this.addChild(this.halo);
  }

  /**
   * Vis ny ball med pop-in → hold → fade-out. Idempotent: hvis en ball
   * allerede vises, dreper vi pågående tweens og rebuilder.
   */
  pop(number: number): void {
    // Drep eventuell pågående animasjon + hold-timer.
    gsap.killTweensOf(this);
    gsap.killTweensOf(this.scale);
    if (this.holdTimer !== null) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }

    // Bytt ut ballen — vi destroyer den gamle og bygger ny så fargen er
    // korrekt for det nye tallet (DesignBall mapper number→farge i ctor).
    if (this.currentBall) {
      this.currentBall.destroy({ children: true });
      this.currentBall = null;
    }
    const ball = new DesignBall(number, POP_BALL_SIZE);
    this.currentBall = ball;
    this.addChild(ball);

    // Pop-in: scale 0.4 → 1.0 + alpha 0 → 1 (back overshoot).
    this.scale.set(0.4);
    this.alpha = 0;
    gsap.to(this, { alpha: 1, duration: 0.40, ease: "power2.out" });
    gsap.to(this.scale, {
      x: 1,
      y: 1,
      duration: 0.40,
      ease: "back.out(1.7)",
      onComplete: () => {
        // Hold synlig så spilleren rekker å lese tallet.
        this.holdTimer = setTimeout(() => {
          this.holdTimer = null;
          this.fadeOut();
        }, HOLD_MS);
      },
    });
  }

  /** Skjul umiddelbart (uten animasjon) — brukes ved screen-reset. */
  reset(): void {
    gsap.killTweensOf(this);
    gsap.killTweensOf(this.scale);
    if (this.holdTimer !== null) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
    this.alpha = 0;
    this.scale.set(1, 1);
    if (this.currentBall) {
      this.currentBall.destroy({ children: true });
      this.currentBall = null;
    }
  }

  /** Total bredde/høyde — for layout-beregning. */
  get popSize(): number {
    return POP_BALL_SIZE;
  }

  destroy(options?: Parameters<Container["destroy"]>[0]): void {
    if (this.holdTimer !== null) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
    gsap.killTweensOf(this);
    gsap.killTweensOf(this.scale);
    if (this.currentBall) {
      this.currentBall.destroy({ children: true });
      this.currentBall = null;
    }
    super.destroy(options);
  }

  // ── interne ─────────────────────────────────────────────────────────────

  private fadeOut(): void {
    // Liten skala-up samtidig med fade-out så det føles som ballen "går
    // mot tuben" (egentlig bare drift mot infinity, men den visuelle
    // assosiasjonen er nok).
    gsap.to(this.scale, { x: 1.15, y: 1.15, duration: 0.35, ease: "power1.in" });
    gsap.to(this, {
      alpha: 0,
      duration: 0.35,
      ease: "power1.in",
      onComplete: () => {
        // Reset scale så neste pop starter fra clean state.
        this.scale.set(1, 1);
        if (this.currentBall) {
          this.currentBall.destroy({ children: true });
          this.currentBall = null;
        }
      },
    });
  }
}

/** Eksportert for bruk i tester / layout-beregning. */
export const CENTER_BALL_POP_SIZE = 150;
