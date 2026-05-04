/**
 * Spill 2 — player-kolonne ytterst til venstre i `ComboPanel`.
 *
 * 2026-05-04 (Tobias-direktiv revidert): mockup-paritet med Bong Mockup.
 * `.player-card { background: transparent; border: none; box-shadow: none; }`
 * — ingen kort-bakgrunn, bare icon + tall inline. Innsats/Gevinst-rader
 * behouldes på linje 2-3 (Tobias-direktiv: "innsats når man har plassert
 * innsats. under der må gevinst komme når man vinner noe").
 *
 * Layout (mockup `.player-col`):
 *   width: 110px
 *   padding: 16px 18px
 *   .player-card: gap 8px, icon 22×22, pc-num 22px font-weight 700
 *
 * Tobias-paritet:
 *   - Innsats-rad (skjul når 0)
 *   - Gevinst-rad (skjul når 0)
 */

import { Container, Graphics, Text } from "pixi.js";

/** Kolonne-bredde (mockup `.player-col { width: 110px }`). */
export const PLAYER_COL_WIDTH = 110;
/** Kolonne-padding (mockup `.player-col { padding: 16px 18px }`). */
const COL_PAD_X = 18;
const COL_PAD_Y = 16;
/** Ikon-størrelse (mockup 22×22). */
const ICON_SIZE = 22;
/** Mellomrom mellom ikon og tall (mockup gap: 8). */
const ICON_GAP = 8;
/** Vertikal gap mellom rad 1 (count) og rad 2 (Innsats). */
const ROW_GAP = 10;

export class PlayerCard extends Container {
  private icon: Graphics;
  private numText: Text;
  private innsatsText: Text;
  private gevinstText: Text;
  private lastStake = -1;
  private lastWinnings = -1;

  constructor(_colHeight: number) {
    super();
    // Ingen bakgrunn-kort — mockup har transparent player-card.

    // ── ikon (hode-skulder, 22×22) ───────────────────────────────────────
    this.icon = new Graphics();
    this.icon.x = COL_PAD_X;
    this.icon.y = COL_PAD_Y;
    this.drawIcon();
    this.addChild(this.icon);

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
    this.numText.x = COL_PAD_X + ICON_SIZE + ICON_GAP;
    // Justere y så tall-baseline matcher icon-senter (icon top-aligned).
    this.numText.y = COL_PAD_Y + 1;
    this.addChild(this.numText);

    // ── Innsats-rad (Tobias-direktiv 2026-05-04) ─────────────────────────
    const row2Y = COL_PAD_Y + ICON_SIZE + ROW_GAP;
    this.innsatsText = new Text({
      text: "Innsats: 0 kr",
      style: {
        fontFamily: "Inter, system-ui, Helvetica, sans-serif",
        fontSize: 12,
        fontWeight: "500",
        fill: 0xeae0d2,
      },
    });
    this.innsatsText.x = COL_PAD_X;
    this.innsatsText.y = row2Y;
    this.innsatsText.visible = false;
    this.addChild(this.innsatsText);

    // ── Gevinst-rad ──────────────────────────────────────────────────────
    this.gevinstText = new Text({
      text: "Gevinst: 0 kr",
      style: {
        fontFamily: "Inter, system-ui, Helvetica, sans-serif",
        fontSize: 12,
        fontWeight: "600",
        fill: 0xffe83d,
      },
    });
    this.gevinstText.x = COL_PAD_X;
    this.gevinstText.y = row2Y + 16;
    this.gevinstText.visible = false;
    this.addChild(this.gevinstText);
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
  }

  get colWidth(): number {
    return PLAYER_COL_WIDTH;
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
