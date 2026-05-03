/**
 * Spill 2 Bong Mockup design ball — Pixi-replikering av glass-tubens
 * trukne baller fra `Bong Mockup.html` (.ball + .ball-inner + .ball::after).
 *
 * Design-spec (HTML, kort):
 *   - 60×60 ytre kule med radial-gradient (lys topp-venstre highlight,
 *     mørk bunn-høyre skygge, ball-color sentrum→mørk).
 *   - 38×38 indre cream-disk med tall (Inter 700 / 17px).
 *   - Liten white specular highlight i topp-venstre (.ball::after).
 *
 * Alle tegn-operasjoner går via `pixi.js` Graphics fordi designet er
 * proseduralt (ingen sprite for selve kulen — bare en farge-prop).
 *
 * 2026-05-03 (Agent E, branch feat/spill2-bong-mockup-design): introdusert
 * for å erstatte tidligere `NumberBall`-bruk i `DrawnBallsPanel`. NumberBall
 * beholdes for andre spill (game1/3) og for andre paneler i game2.
 */

import { Container, Graphics, Text } from "pixi.js";

/**
 * Standardstørrelser fra HTML-mockupen. Eksportert så `BallTube` kan
 * regne ut riktig spacing uten å duplisere konstanter.
 */
export const DESIGN_BALL_SIZE = 60;

/**
 * Mappingen i HTML-en (7→yellow, 24→purple, 38→green, 61→blue, 73→red)
 * dekker 1-75. Spill 2 trekker bare fra 1-21, så i praksis treffer vi
 * alltid yellow-grenen — men vi beholder full mapping for fremtidig
 * gjenbruk og for å rendre 21+ hvis backend en dag utvider rekkevidden.
 */
export function getDesignBallColor(n: number): number {
  if (n <= 21) return 0xf0b92e; // yellow (Spill 2 default)
  if (n <= 36) return 0xb8a4e8; // purple
  if (n <= 55) return 0x7dc97a; // green
  if (n <= 70) return 0x60a5fa; // blue
  return 0xf47b7b; // red
}

/**
 * Tegner én bingo-kule i mockup-stilen. Bruker Graphics for både den
 * ytre fargen og den indre cream-disken slik at vi unngår å laste
 * sprite-baller for hver mulig farge.
 *
 * Vi tegner fargen som flere konsentriske sirkler med synkende alpha
 * for å simulere `radial-gradient(circle at 50% 50%, --ball-color 0%,
 * darken(--ball-color) 100%)` fra HTML-en. Ekstra hvit/mørk overlays
 * matcher CSS-ens topp-venstre highlight og bunn-høyre skygge.
 */
export class DesignBall extends Container {
  readonly ballNumber: number;
  private readonly diameter: number;

  constructor(number: number, size = DESIGN_BALL_SIZE) {
    super();
    this.ballNumber = number;
    this.diameter = size;

    const baseColor = getDesignBallColor(number);
    const radius = size / 2;

    // 1) Outer ball — radial-gradient simulert med konsentriske fyll.
    const outer = new Graphics();
    // Grunnfarge (mørk kant fra `color-mix(... 70%, #000)`).
    const darkenedBase = darken(baseColor, 0.30);
    outer.circle(radius, radius, radius).fill(darkenedBase);
    // Sentrum-radius blandet inn for å gi en jevn overgang fra mørk til lys.
    outer.circle(radius, radius, radius * 0.78).fill({ color: baseColor, alpha: 0.95 });
    outer.circle(radius, radius, radius * 0.55).fill({ color: lighten(baseColor, 0.10), alpha: 0.55 });
    // Topp-venstre highlight (CSS: radial-gradient at 32% 30% white).
    outer
      .circle(radius * 0.64, radius * 0.60, radius * 0.40)
      .fill({ color: 0xffffff, alpha: 0.30 });
    // Bunn-høyre skygge (CSS: radial-gradient at 70% 75% black 0.30).
    outer
      .circle(radius * 1.40, radius * 1.50, radius * 0.95)
      .fill({ color: 0x000000, alpha: 0.18 });
    this.addChild(outer);

    // 2) Inner cream disk med tall.
    const innerSize = Math.round(size * 0.633); // 60 → ~38 (matcher HTML)
    const inner = new Graphics();
    const ix = (size - innerSize) / 2;
    inner.x = ix;
    inner.y = ix;
    const innerRadius = innerSize / 2;
    inner.circle(innerRadius, innerRadius, innerRadius).fill(0xf4ede0);
    // Lys topp-venstre på den indre disken — matcher `inset 0 1px 2px white 0.9`.
    inner
      .circle(innerRadius * 0.70, innerRadius * 0.65, innerRadius * 0.55)
      .fill({ color: 0xffffff, alpha: 0.55 });
    // Mørk bunn-skygge — matcher `inset 0 -2px 3px black 0.2`.
    inner
      .circle(innerRadius, innerRadius * 1.55, innerRadius * 0.95)
      .fill({ color: 0x000000, alpha: 0.10 });
    this.addChild(inner);

    // Number text — Inter 700 / 17px / black-brown 0x1a1208.
    const numberText = new Text({
      text: String(number),
      style: {
        fontFamily: "Inter, system-ui, Helvetica, sans-serif",
        fontSize: Math.max(13, Math.round(size * 0.30)),
        fontWeight: "700",
        fill: 0x1a1208,
        align: "center",
      },
    });
    numberText.anchor.set(0.5);
    numberText.x = size / 2;
    numberText.y = size / 2;
    this.addChild(numberText);

    // 3) Specular pinprick highlight (.ball::after) — liten elliptisk
    //    flekk øverst til venstre. Pixi har ikke skewed ellipse direkte;
    //    en liten lett alpha-sirkel gir samme visuelle effekt på 60px.
    const specular = new Graphics();
    specular
      .circle(size * 0.30, size * 0.20, size * 0.10)
      .fill({ color: 0xffffff, alpha: 0.55 });
    this.addChild(specular);
  }

  /** Diameter brukt av `BallTube` for å posisjonere kuler. */
  get size(): number {
    return this.diameter;
  }
}

// ── farge-helpers ──────────────────────────────────────────────────────────

function darken(hex: number, amount: number): number {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  const f = Math.max(0, 1 - amount);
  return ((Math.round(r * f) & 0xff) << 16) | ((Math.round(g * f) & 0xff) << 8) | (Math.round(b * f) & 0xff);
}

function lighten(hex: number, amount: number): number {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  const f = Math.min(1, amount);
  const nr = Math.round(r + (255 - r) * f);
  const ng = Math.round(g + (255 - g) * f);
  const nb = Math.round(b + (255 - b) * f);
  return ((nr & 0xff) << 16) | ((ng & 0xff) << 8) | (nb & 0xff);
}
