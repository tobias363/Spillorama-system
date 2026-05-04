/**
 * Spill 2 — player-kort ytterst til venstre i `ComboPanel`. Inneholder:
 *   1. Hode-skulder-ikon + 2-siffer spillerantall ("01", "02", ...)
 *   2. "Innsats: X kr"-rad (skjult når 0)  — Tobias-direktiv 2026-05-04
 *   3. "Gevinst: Y kr"-rad (skjult når 0)
 *
 * Speiler Spill 1's `LeftInfoPanel` (apps/game1/components/LeftInfoPanel.ts)
 * sin Innsats/Gevinst-flyt: rader skjules når verdien er 0, vises ellers
 * for å unngå visuell støy.
 *
 * Pixi-implementasjon: Container med Graphics-bakgrunn + Graphics-tegnet
 * ikon + Text-elementer for tall, Innsats og Gevinst.
 */

import { Container, Graphics, Text } from "pixi.js";

/** Kolonne-bredde i ComboPanel (matcher CSS `.player-col` width: 130px). */
export const PLAYER_COL_WIDTH = 130;
/** Card-padding inne i kolonnen. */
const COL_PADDING = 10;
/** Card-bredde = kolonne-bredde - 2 * padding. */
const CARD_WIDTH = PLAYER_COL_WIDTH - COL_PADDING * 2;
/** Card-radius. */
const CARD_RADIUS = 12;
/** Indre padding i kortet. */
const CARD_PAD_X = 12;
const CARD_PAD_Y = 10;
/** Ikon-størrelse. */
const ICON_SIZE = 18;
/** Mellomrom mellom ikon og tall. */
const ICON_GAP = 8;
/** Vertikal gap mellom rad 1 (count) og rad 2 (Innsats). */
const ROW_GAP = 8;

export class PlayerCard extends Container {
  private bg: Graphics;
  private icon: Graphics;
  private numText: Text;
  /** Tobias 2026-05-04: Innsats-rad (skjult når 0). */
  private innsatsText: Text;
  /** Tobias 2026-05-04: Gevinst-rad (skjult når 0). */
  private gevinstText: Text;
  private cardHeight: number;
  private lastStake = -1;
  private lastWinnings = -1;

  constructor(colHeight: number) {
    super();
    this.cardHeight = colHeight - COL_PADDING * 2;

    // ── kort-bakgrunn ────────────────────────────────────────────────────
    this.bg = new Graphics();
    this.bg.x = COL_PADDING;
    this.bg.y = COL_PADDING;
    this.drawBg();
    this.addChild(this.bg);

    // ── ikon (hode-skulder) ──────────────────────────────────────────────
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
    this.numText.y = COL_PADDING + CARD_PAD_Y + 2;
    this.addChild(this.numText);

    // ── Innsats-rad (Tobias-direktiv 2026-05-04) ─────────────────────────
    // Skjult som default — vises i `setStake(n)` når n > 0.
    const row2Y = COL_PADDING + CARD_PAD_Y + ICON_SIZE + ROW_GAP;
    this.innsatsText = new Text({
      text: "Innsats: 0 kr",
      style: {
        fontFamily: "Inter, system-ui, Helvetica, sans-serif",
        fontSize: 12,
        fontWeight: "500",
        fill: 0xeae0d2,
      },
    });
    this.innsatsText.x = COL_PADDING + CARD_PAD_X;
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
        fill: 0xffe83d, // gull-aksent for Gevinst (matcher Spill 1)
      },
    });
    this.gevinstText.x = COL_PADDING + CARD_PAD_X;
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

  /**
   * Tobias-direktiv 2026-05-04: oppdater Innsats-raden. Skjules når n=0
   * (ingen aktiv stake), vises ellers. Speiler Spill 1's LeftInfoPanel-
   * flyt for konsistent UX.
   */
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

  /**
   * Tobias-direktiv 2026-05-04: oppdater Gevinst-raden. Skjules når n=0
   * (ingen vinning denne runden), vises ellers.
   */
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

  /** Returnerer kolonne-bredden — for layout-beregning i ComboPanel. */
  get colWidth(): number {
    return PLAYER_COL_WIDTH;
  }

  // ── interne tegne-rutiner ───────────────────────────────────────────────

  private drawBg(): void {
    this.bg.clear();
    this.bg
      .roundRect(0, 0, CARD_WIDTH, this.cardHeight, CARD_RADIUS)
      .fill({ color: 0x140508, alpha: 0.45 });
    this.bg
      .roundRect(2, 2, CARD_WIDTH - 4, 1, 1)
      .fill({ color: 0xffffff, alpha: 0.06 });
  }

  private drawIcon(): void {
    this.icon.clear();
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
