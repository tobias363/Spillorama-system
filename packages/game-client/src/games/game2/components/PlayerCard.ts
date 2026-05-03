/**
 * Spill 2 Bong Mockup v2 — player-kort som vises ytterst til venstre i
 * `ComboPanel`. Inneholder en enkel hode-skulder-ikon + et 2-siffer
 * spillerantall ("01", "02", ...).
 *
 * Mockup (`Bong Mockup.html` `.player-col` + `.player-card`):
 *
 *   ┌──────────────┐
 *   │ ◉            │   ← hode-ikon (top-left)
 *   │   01         │   ← antall spillere
 *   │              │
 *   └──────────────┘
 *
 * CSS:
 *   - `.player-col` width: 130px (hele kolonne-bredde inkl. padding 10).
 *   - `.player-card` rounded-rect 12px med mørk-rød fyll, ingen border
 *     (per chat-feedback "Remove the white border around the player card").
 *   - Ikon: 18px, top-aligned, hvit fyll.
 *   - Tall: 18px, font-weight 800, hvit, top-aligned med `marginTop: 2px`.
 *
 * Pixi-implementasjon:
 *   - `Container` med Graphics-bakgrunn + Graphics-tegnet ikon + `Text` for tall.
 *   - Eksternt-styrt antall via `setCount(n)` — vises 2-sifret med
 *     `padStart`, kan vise opptil 99.
 *
 * 2026-05-03 (Agent S, branch feat/spill2-bong-mockup-v2): ny komponent
 * for v2-redesignet. Erstatter ingen eksisterende komponent — er en
 * fjerde kolonne i ComboPanel.
 */

import { Container, Graphics, Text } from "pixi.js";

/** Kolonne-bredde i ComboPanel (matcher CSS `.player-col` width: 130px). */
export const PLAYER_COL_WIDTH = 130;
/** Card-padding inne i kolonnen (matcher CSS `.player-col` padding: 10px). */
const COL_PADDING = 10;
/** Card-bredde = kolonne-bredde - 2 * padding. */
const CARD_WIDTH = PLAYER_COL_WIDTH - COL_PADDING * 2;
/** Card-radius (matcher CSS `border-radius: 12px`). */
const CARD_RADIUS = 12;
/** Indre padding i kortet (matcher CSS `.player-card` padding: 10 12). */
const CARD_PAD_X = 12;
const CARD_PAD_Y = 10;
/** Ikon-størrelse (matcher CSS `.pc-icon` 18px). */
const ICON_SIZE = 18;
/** Mellomrom mellom ikon og tall (matcher CSS `.player-card` gap: 8). */
const ICON_GAP = 8;

export class PlayerCard extends Container {
  private bg: Graphics;
  private icon: Graphics;
  private numText: Text;
  private cardHeight: number;

  /**
   * @param colHeight  Total høyde for kolonnen (samme som panel-høyde).
   *                   Bakgrunns-kortet fyller `colHeight - 2 * COL_PADDING`.
   */
  constructor(colHeight: number) {
    super();
    this.cardHeight = colHeight - COL_PADDING * 2;

    // ── kort-bakgrunn ────────────────────────────────────────────────────
    // Mørk-rød rounded-rect, ingen border (per v2-feedback).
    this.bg = new Graphics();
    this.bg.x = COL_PADDING;
    this.bg.y = COL_PADDING;
    this.drawBg();
    this.addChild(this.bg);

    // ── ikon (hode-skulder) ──────────────────────────────────────────────
    // Tegnes som Graphics — sirkel for hode + kurve for skulder.
    this.icon = new Graphics();
    this.icon.x = COL_PADDING + CARD_PAD_X;
    this.icon.y = COL_PADDING + CARD_PAD_Y;
    this.drawIcon();
    this.addChild(this.icon);

    // ── tall ("01") ──────────────────────────────────────────────────────
    this.numText = new Text({
      text: "01",
      style: {
        fontFamily: "Inter, system-ui, Helvetica, sans-serif",
        fontSize: 18,
        fontWeight: "800",
        fill: 0xffffff,
        letterSpacing: 0.4,
      },
    });
    this.numText.x = COL_PADDING + CARD_PAD_X + ICON_SIZE + ICON_GAP;
    // CSS bruker `align-items: flex-start` + `marginTop: 2` — vi tilsvarer
    // ved å plassere tallet med top-baseline lik ikon-toppen + 2px.
    this.numText.y = COL_PADDING + CARD_PAD_Y + 2;
    this.addChild(this.numText);
  }

  /** Sett antall spillere — vises 2-sifret med leading zero. */
  setCount(count: number): void {
    const clamped = Math.max(0, Math.min(99, Math.floor(count)));
    const formatted = String(clamped).padStart(2, "0");
    if (this.numText.text !== formatted) {
      this.numText.text = formatted;
    }
  }

  /** Returnerer kolonne-bredden — for layout-beregning i ComboPanel. */
  get colWidth(): number {
    return PLAYER_COL_WIDTH;
  }

  // ── interne tegne-rutiner ───────────────────────────────────────────────

  private drawBg(): void {
    this.bg.clear();
    // Mørk-rød fyll (matcher CSS `rgba(20, 5, 8, 0.45)`).
    this.bg
      .roundRect(0, 0, CARD_WIDTH, this.cardHeight, CARD_RADIUS)
      .fill({ color: 0x140508, alpha: 0.45 });
    // Topp-highlight 1px (matcher `inset 0 1px 0 rgba(255,255,255,0.06)`).
    this.bg
      .roundRect(2, 2, CARD_WIDTH - 4, 1, 1)
      .fill({ color: 0xffffff, alpha: 0.06 });
  }

  private drawIcon(): void {
    this.icon.clear();
    // Hode (sirkel — `cx=12 cy=8 r=4` i 24×24 viewBox, skalert til 18×18).
    const cx = ICON_SIZE / 2; // 9
    const headY = (8 / 24) * ICON_SIZE; // 6
    const headR = (4 / 24) * ICON_SIZE; // 3
    this.icon.circle(cx, headY, headR).fill({ color: 0xffffff });
    // Skulder-kurve (`M 4 21 c 0 -4.4 3.6 -8 8 -8 s 8 3.6 8 8`).
    // Vi tegner et halvtall for skulder/torso ved hjelp av en bezier.
    const torsoTopY = (13 / 24) * ICON_SIZE; // ~9.75
    const torsoBottomY = (21 / 24) * ICON_SIZE; // ~15.75
    const torsoLeft = (4 / 24) * ICON_SIZE; // 3
    const torsoRight = (20 / 24) * ICON_SIZE; // 15
    this.icon
      .moveTo(torsoLeft, torsoBottomY)
      .quadraticCurveTo(cx, torsoTopY, torsoRight, torsoBottomY)
      .lineTo(torsoRight, torsoBottomY + 0.5)
      .quadraticCurveTo(cx, torsoTopY + 0.5, torsoLeft, torsoBottomY + 0.5)
      .closePath()
      .fill({ color: 0xffffff });
  }
}
