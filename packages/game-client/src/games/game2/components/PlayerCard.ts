/**
 * Spill 2 — player-kolonne ytterst til venstre i `ComboPanel`.
 *
 * 2026-05-06 (Tobias-direktiv, PR 2 mockup-paritet — `Bong Mockup.html`):
 *   - `.player-col` er `justify-content: center` → innholdsblokken er
 *     vertikalt sentrert i kolonnen, ikke top-anchored.
 *   - `.player-stake` har 15px font-size, 500 weight, white-92% farge,
 *     `margin-top: 4px` (vi bruker ROW_GAP = 4 i Pixi).
 *   - Gevinst-raden er en Spillorama-utvidelse (Tobias 2026-05-04) som
 *     ikke er i mockupen, men beholdes i samme stil (15px, 600 weight).
 *
 * Layout (mockup `.player-col`):
 *   width: 110px
 *   padding: 10px 16px
 *   .player-card: gap 8px, icon 22×22, pc-num 22px font-weight 700
 *
 * Spillorama-paritet:
 *   - Innsats-rad (skjul når 0)
 *   - Gevinst-rad (skjul når 0)
 *
 * Vertikal sentrering: alt innhold er pakket i `contentBlock` som
 * reposisjoneres hver gang en rad vises/skjules slik at den synlige
 * blokken alltid er midt i kolonnen (mockup `justify-content: center`).
 */

import { Container, Graphics, Text } from "pixi.js";

/** Kolonne-bredde (mockup `.player-col { width: 110px }`). */
export const PLAYER_COL_WIDTH = 110;
/** Kolonne-padding X (mockup `.player-col { padding: 10px 16px }`). */
const COL_PAD_X = 16;
/** Ikon-størrelse (mockup 22×22). */
const ICON_SIZE = 22;
/** Mellomrom mellom ikon og tall (mockup gap: 8). */
const ICON_GAP = 8;
/** Vertikal gap mellom ikon-rad og innsats-rad (mockup `margin-top: 4`). */
const ROW_GAP = 4;
/** Linje-høyde for innsats/gevinst-tekst — fontSize 15 + ~3px breathing. */
const TEXT_LINE_HEIGHT = 18;
/** Liten ekstra gap mellom innsats- og gevinst-rad. */
const GEVINST_GAP = 2;

export class PlayerCard extends Container {
  private contentBlock: Container;
  private icon: Graphics;
  private numText: Text;
  private innsatsText: Text;
  private gevinstText: Text;
  private lastStake = -1;
  private lastWinnings = -1;
  private colHeight: number;

  constructor(colHeight: number) {
    super();
    this.colHeight = colHeight;
    // Ingen bakgrunn-kort — mockup har transparent player-card.

    // ── content-block: pakker icon+num+innsats+gevinst slik at vi kan
    //    flytte hele blokken i ett (vertikal sentrering). ─────────────────
    this.contentBlock = new Container();
    this.contentBlock.x = COL_PAD_X;
    this.addChild(this.contentBlock);

    // ── ikon (hode-skulder, 22×22) ───────────────────────────────────────
    this.icon = new Graphics();
    this.icon.x = 0;
    this.icon.y = 0;
    this.drawIcon();
    this.contentBlock.addChild(this.icon);

    // ── tall ("01") — 22px, font-weight 700, hvit ───────────────────────
    this.numText = new Text({
      text: "01",
      style: {
        fontFamily: "Inter, system-ui, Helvetica, sans-serif",
        fontSize: 22,
        fontWeight: "700",
        fill: 0xffffff,
        letterSpacing: 0.2,
      },
    });
    this.numText.x = ICON_SIZE + ICON_GAP;
    this.numText.y = 1; // baseline-justering mot icon-senter
    this.contentBlock.addChild(this.numText);

    // ── Innsats-rad (mockup `.player-stake`: 15px, 500 weight, white-92).
    this.innsatsText = new Text({
      text: "Innsats: 0 kr",
      style: {
        fontFamily: "Inter, system-ui, Helvetica, sans-serif",
        fontSize: 15,
        fontWeight: "500",
        fill: 0xeaeaea,
      },
    });
    this.innsatsText.x = 0;
    this.innsatsText.y = ICON_SIZE + ROW_GAP;
    this.innsatsText.visible = false;
    this.contentBlock.addChild(this.innsatsText);

    // ── Gevinst-rad (Spillorama-utvidelse — speiler innsats-styling, gull).
    this.gevinstText = new Text({
      text: "Gevinst: 0 kr",
      style: {
        fontFamily: "Inter, system-ui, Helvetica, sans-serif",
        fontSize: 15,
        fontWeight: "600",
        fill: 0xffe83d,
      },
    });
    this.gevinstText.x = 0;
    this.gevinstText.y = ICON_SIZE + ROW_GAP + TEXT_LINE_HEIGHT + GEVINST_GAP;
    this.gevinstText.visible = false;
    this.contentBlock.addChild(this.gevinstText);

    // Initial layout — kun icon-raden synlig.
    this.layoutContentBlock();
  }

  /** Sett antall spillere — vises 2-sifret med leading zero. */
  setCount(count: number): void {
    const clamped = Math.max(0, Math.min(99, Math.floor(count)));
    const formatted = String(clamped).padStart(2, "0");
    if (this.numText.text !== formatted) {
      this.numText.text = formatted;
    }
  }

  setStake(stake: number): void {
    if (stake === this.lastStake) return;
    this.lastStake = stake;
    if (stake > 0) {
      this.innsatsText.text = `Innsats: ${stake} kr`;
      this.innsatsText.visible = true;
    } else {
      this.innsatsText.visible = false;
    }
    this.layoutContentBlock();
  }

  setWinnings(winnings: number): void {
    if (winnings === this.lastWinnings) return;
    this.lastWinnings = winnings;
    if (winnings > 0) {
      this.gevinstText.text = `Gevinst: ${winnings} kr`;
      this.gevinstText.visible = true;
    } else {
      this.gevinstText.visible = false;
    }
    this.layoutContentBlock();
  }

  get colWidth(): number {
    return PLAYER_COL_WIDTH;
  }

  /**
   * Vertikalt sentrert layout (mockup `.player-col { justify-content: center }`).
   * Computes total height of currently-visible rows and centers the block.
   * Innsats- og gevinst-rad er valgfrie — y-posisjonene reberegnes for
   * å lukke gap-en når en rad er skjult.
   */
  private layoutContentBlock(): void {
    // Beregn nåværende innholds-høyde basert på synlige rader.
    let height = ICON_SIZE;
    if (this.innsatsText.visible) {
      height += ROW_GAP + TEXT_LINE_HEIGHT;
    }
    if (this.gevinstText.visible) {
      // Gevinst-raden henger under enten icon (om innsats er skjult) eller
      // innsats. Vi gir samme gap fra forrige rad i begge tilfeller.
      height += this.innsatsText.visible
        ? GEVINST_GAP + TEXT_LINE_HEIGHT
        : ROW_GAP + TEXT_LINE_HEIGHT;
    }

    // Re-posisjoner gevinst-raden hvis innsats er skjult.
    if (this.gevinstText.visible) {
      this.gevinstText.y = this.innsatsText.visible
        ? ICON_SIZE + ROW_GAP + TEXT_LINE_HEIGHT + GEVINST_GAP
        : ICON_SIZE + ROW_GAP;
    }

    // Sentrere blokken vertikalt.
    this.contentBlock.y = Math.max(0, (this.colHeight - height) / 2);
  }

  // ── interne tegne-rutiner ───────────────────────────────────────────────

  private drawIcon(): void {
    this.icon.clear();
    // 22×22 hode-skulder-svg. Skalert opp fra mockup (22 fra 24-viewBox).
    const cx = ICON_SIZE / 2;
    const headY = (8 / 24) * ICON_SIZE;
    const headR = (4 / 24) * ICON_SIZE;
    this.icon.circle(cx, headY, headR).fill({ color: 0xffffff });
    const torsoTopY = (13 / 24) * ICON_SIZE;
    const torsoBottomY = (21 / 24) * ICON_SIZE;
    const torsoLeft = (4 / 24) * ICON_SIZE;
    const torsoRight = (20 / 24) * ICON_SIZE;
    this.icon
      .moveTo(torsoLeft, torsoBottomY)
      .quadraticCurveTo(cx, torsoTopY, torsoRight, torsoBottomY)
      .lineTo(torsoRight, torsoBottomY + 0.5)
      .quadraticCurveTo(cx, torsoTopY + 0.5, torsoLeft, torsoBottomY + 0.5)
      .closePath()
      .fill({ color: 0xffffff });
  }
}
