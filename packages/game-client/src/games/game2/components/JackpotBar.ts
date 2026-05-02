/**
 * 2026-05-02 (Tobias UX): Jackpot-bar for Spill 2 (Rocket).
 *
 * Wireframe `WF_F_Game 2 & 3_V1.0.pdf` side 4: horisontal bar med 6 slots
 * over ticket-grid:
 *   ┌───────┬───────┬───────┬───────┬───────┬───────┐
 *   │   9   │  10   │  11   │  12   │  13   │ 14-21 │
 *   │Jackpot│Jackpot│Jackpot│Jackpot│ Gain  │ Gain  │
 *   │ 5000  │ 3000  │ 2000  │ 1000  │  500  │  100  │
 *   └───────┴───────┴───────┴───────┴───────┴───────┘
 *
 * Aktiv slot (matcher current draw count) highlightes med gul-bakgrunn.
 * Drawn-count > 21 → ingen slot aktiv (jackpot-vinduet er forbi).
 *
 * Data leveres via socket-event `g2:jackpot:list-update` på hver draw —
 * caller (Game2Controller) abonnerer og kaller `update()` med ny liste.
 */

import { Container, Graphics, Text, TextStyle } from "pixi.js";

export interface JackpotSlotData {
  /** Slot-nøkkel: "9" | "10" | "11" | "12" | "13" | "14-21" */
  number: string;
  /** Premie i kroner (kommer ferdig-beregnet fra backend). */
  prize: number;
  /** Visuell label: "Jackpot" eller "Gain". */
  type: "gain" | "jackpot";
}

const SLOT_WIDTH = 80;
const SLOT_HEIGHT = 70;
const SLOT_GAP = 4;

const COLOR_BG = 0xffffff;
const COLOR_BORDER = 0xb0b0b0;
const COLOR_BG_ACTIVE = 0xfff3a3;
const COLOR_BORDER_ACTIVE = 0xf0c200;
const COLOR_TEXT = 0x222222;
const COLOR_TEXT_LABEL = 0x666666;

const NUMBER_STYLE = new TextStyle({
  fontFamily: "Arial, sans-serif",
  fontSize: 16,
  fontWeight: "700",
  fill: COLOR_TEXT,
});

const LABEL_STYLE = new TextStyle({
  fontFamily: "Arial, sans-serif",
  fontSize: 11,
  fill: COLOR_TEXT_LABEL,
});

const PRIZE_STYLE = new TextStyle({
  fontFamily: "Arial, sans-serif",
  fontSize: 14,
  fontWeight: "600",
  fill: COLOR_TEXT,
});

interface SlotVisual {
  bg: Graphics;
  numberText: Text;
  labelText: Text;
  prizeText: Text;
}

/**
 * Slot-nøkler i fast rekkefølge per wireframe (side 4). Backend kan
 * sende færre slots (f.eks. hvis admin har konfigurert 0-prize på
 * draw 13) — vi rendrer alltid alle 6 slots med 0 som placeholder.
 */
const SLOT_KEYS = ["9", "10", "11", "12", "13", "14-21"] as const;

export class JackpotBar extends Container {
  private slots: Map<string, SlotVisual> = new Map();
  private latestData: Map<string, JackpotSlotData> = new Map();
  private activeSlotKey: string | null = null;

  constructor() {
    super();
    this.buildSlots();
  }

  /**
   * Oppdater slot-data fra backend (`g2:jackpot:list-update`-event).
   * Listen filtreres til kjente slot-nøkler; ukjente nøkler ignoreres.
   * Slots uten data fra backend beholder forrige verdi (eller "0" ved
   * første render).
   */
  update(list: JackpotSlotData[]): void {
    for (const entry of list) {
      this.latestData.set(entry.number, entry);
    }
    this.renderValues();
  }

  /**
   * Markér slot som matcher current draw count som aktiv. Kalles ved
   * hver `numberDrawn`-event fra Game2Controller.
   *   draws 1-8  → ingen aktiv slot (før jackpot-vinduet)
   *   draws 9-13 → slot "9".."13" aktiv
   *   draws 14-21 → slot "14-21" aktiv
   *   draws > 21 → ingen aktiv slot (etter jackpot-vinduet)
   */
  setCurrentDrawCount(drawCount: number): void {
    let key: string | null = null;
    if (drawCount >= 9 && drawCount <= 13) {
      key = String(drawCount);
    } else if (drawCount >= 14 && drawCount <= 21) {
      key = "14-21";
    }
    if (key === this.activeSlotKey) return;
    this.activeSlotKey = key;
    this.renderActiveHighlight();
  }

  private buildSlots(): void {
    SLOT_KEYS.forEach((key, idx) => {
      const x = idx * (SLOT_WIDTH + SLOT_GAP);
      const bg = new Graphics();
      bg.x = x;
      bg.y = 0;
      this.addChild(bg);

      // 13 og 14-21 er "Gain"-slots per backend-spec; resten "Jackpot".
      const labelText = key === "13" || key === "14-21" ? "Gain" : "Jackpot";

      const numberText = new Text({ text: key, style: NUMBER_STYLE });
      numberText.x = x + SLOT_WIDTH / 2;
      numberText.y = 8;
      numberText.anchor.set(0.5, 0);
      this.addChild(numberText);

      const labelTextNode = new Text({ text: labelText, style: LABEL_STYLE });
      labelTextNode.x = x + SLOT_WIDTH / 2;
      labelTextNode.y = 30;
      labelTextNode.anchor.set(0.5, 0);
      this.addChild(labelTextNode);

      const prizeText = new Text({ text: "—", style: PRIZE_STYLE });
      prizeText.x = x + SLOT_WIDTH / 2;
      prizeText.y = 48;
      prizeText.anchor.set(0.5, 0);
      this.addChild(prizeText);

      this.slots.set(key, {
        bg,
        numberText,
        labelText: labelTextNode,
        prizeText,
      });
    });
    this.renderActiveHighlight();
    this.renderValues();
  }

  private renderValues(): void {
    for (const key of SLOT_KEYS) {
      const slot = this.slots.get(key);
      if (!slot) continue;
      const data = this.latestData.get(key);
      slot.prizeText.text = data ? formatPrize(data.prize) : "—";
    }
  }

  private renderActiveHighlight(): void {
    for (const key of SLOT_KEYS) {
      const slot = this.slots.get(key);
      if (!slot) continue;
      const isActive = this.activeSlotKey === key;
      slot.bg.clear();
      slot.bg
        .roundRect(0, 0, SLOT_WIDTH, SLOT_HEIGHT, 6)
        .fill({ color: isActive ? COLOR_BG_ACTIVE : COLOR_BG })
        .stroke({ color: isActive ? COLOR_BORDER_ACTIVE : COLOR_BORDER, width: isActive ? 2 : 1 });
    }
  }

  /** Bredde av hele baren (brukt av PlayScreen for layout-beregning). */
  get barWidth(): number {
    return SLOT_KEYS.length * (SLOT_WIDTH + SLOT_GAP) - SLOT_GAP;
  }

  /** Høyde av hele baren. */
  get barHeight(): number {
    return SLOT_HEIGHT;
  }
}

function formatPrize(prize: number): string {
  if (!Number.isFinite(prize) || prize <= 0) return "—";
  // Heltall vises uten desimaler, ellers 2 desimaler.
  if (Number.isInteger(prize)) return String(prize);
  return prize.toFixed(2);
}
