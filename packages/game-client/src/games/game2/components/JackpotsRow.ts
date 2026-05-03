/**
 * Spill 2 Bong Mockup design — 6 jackpot-sirkler i en horisontal rad
 * (slot 9, 10, 11, 12, 13, 14-21).
 *
 * Mockup (`Bong Mockup.html` `.jackpots-col`):
 *
 *   Jackpot Jackpot Jackpot Jackpot  Gain    Gain
 *    ⬤      ⬤      ⬤      ⬤       ⬤      ⬤
 *    9      10     11     12       13    14-21
 *  5000    2500   1000    0        0       0
 *
 * Hver "sirkel" er en mørk-rød kule med tall sentrert; over står
 * "Jackpot"/"Gain" som label, under står beløpet.
 *
 * Bytter ut den tidligere `JackpotBar`-stilen (hvit rektangler i en
 * horisontal bar over ticket-grid). Den var korrekt funksjonelt men
 * matchet ikke det nye Bong Mockup-designet.
 *
 * Kontrakt:
 *   - `update(list)` — full prize-liste fra `g2:jackpot:list-update`-
 *     event. Liste-formatet er identisk med `JackpotSlotData` så vi
 *     re-eksporterer typen for bakoverkompatibilitet med caller.
 *   - `setCurrentDrawCount(n)` — markerer aktiv slot (9..13 eller 14-21).
 *
 * 2026-05-03 (Agent E, branch feat/spill2-bong-mockup-design): omformet
 * jackpot-vy fra hvit-bar (PR #850) til design-spec (mørk-rød cirkler).
 * Behold typesignaturen `JackpotSlotData` for at PlayScreen-callere
 * skal slippe endring.
 */

import { Container, Graphics, Text } from "pixi.js";

export interface JackpotSlotData {
  /** Slot-nøkkel: "9" | "10" | "11" | "12" | "13" | "14-21". */
  number: string;
  /** Premie i kroner (kommer ferdig-beregnet fra backend). */
  prize: number;
  /** Visuell label: "Jackpot" eller "Gain". */
  type: "gain" | "jackpot";
}

const SLOT_KEYS = ["9", "10", "11", "12", "13", "14-21"] as const;
// 2026-05-03 (Agent S, v2): jackpot-sirkler krympet fra 64→50 og
// label/amount-størrelser justert ned for å matche v2-mockup
// (`Bong Mockup.html` `.jackpot-circle { width: 50px; height: 50px; }`).
const CIRCLE_SIZE = 50;
const SLOT_GAP = 14;
const LABEL_GAP = 4; // mellom label og sirkel
const AMOUNT_GAP = 4; // mellom sirkel og beløp (v2: redusert fra 6 → 4)

interface SlotVisual {
  container: Container;
  circle: Graphics;
  label: Text;
  numberText: Text;
  amountText: Text;
  isRange: boolean;
}

export class JackpotsRow extends Container {
  private slots: Map<string, SlotVisual> = new Map();
  private latestData: Map<string, JackpotSlotData> = new Map();
  private activeSlotKey: string | null = null;
  private rowWidth: number;
  private rowHeight: number;

  constructor() {
    super();
    this.rowWidth = SLOT_KEYS.length * CIRCLE_SIZE + (SLOT_KEYS.length - 1) * SLOT_GAP;
    // Høyde: label (12) + gap + sirkel + gap + amount (13). v2: krympet
    // fra 14/16-fonts til 12/13 per CSS `.jackpot-label/.jackpot-amount`.
    this.rowHeight = 12 + LABEL_GAP + CIRCLE_SIZE + AMOUNT_GAP + 13;
    this.buildSlots();
  }

  /** Bredde av hele raden (brukt av `ComboPanel` for layout). */
  get barWidth(): number {
    return this.rowWidth;
  }

  /** Høyde av hele raden. */
  get barHeight(): number {
    return this.rowHeight;
  }

  /** Backend-driver: oppdater prize-listen. */
  update(list: JackpotSlotData[]): void {
    for (const entry of list) {
      this.latestData.set(entry.number, entry);
    }
    this.renderValues();
  }

  /**
   * Markér slot som matcher current draw count som aktiv.
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
      const x = idx * (CIRCLE_SIZE + SLOT_GAP);
      const slotContainer = new Container();
      slotContainer.x = x;
      slotContainer.y = 0;
      this.addChild(slotContainer);

      const isRange = key === "14-21";

      // Label over sirkelen. v2: 12px (uendret).
      const labelText = key === "13" || isRange ? "Gain" : "Jackpot";
      const label = new Text({
        text: labelText,
        style: {
          fontFamily: "Inter, system-ui, Helvetica, sans-serif",
          fontSize: 12,
          fontWeight: "400",
          fill: 0xeae0d2,
          align: "center",
        },
      });
      label.anchor.set(0.5, 0);
      label.x = CIRCLE_SIZE / 2;
      label.y = 0;
      slotContainer.addChild(label);

      // Sirkel.
      const circleY = 12 + LABEL_GAP;
      const circle = new Graphics();
      circle.x = 0;
      circle.y = circleY;
      slotContainer.addChild(circle);

      // Tallet midt i sirkelen. v2: 19px (range 13px) — ned fra 22/14.
      const numberText = new Text({
        text: key,
        style: {
          fontFamily: "Inter, system-ui, Helvetica, sans-serif",
          fontSize: isRange ? 13 : 19,
          fontWeight: "600",
          fill: 0xffffff,
          align: "center",
        },
      });
      numberText.anchor.set(0.5);
      numberText.x = CIRCLE_SIZE / 2;
      numberText.y = circleY + CIRCLE_SIZE / 2;
      slotContainer.addChild(numberText);

      // Beløpet under sirkelen. v2: 13px (ned fra 14).
      const amountText = new Text({
        text: "0",
        style: {
          fontFamily: "Inter, system-ui, Helvetica, sans-serif",
          fontSize: 13,
          fontWeight: "500",
          fill: 0xffffff,
          align: "center",
        },
      });
      amountText.anchor.set(0.5, 0);
      amountText.x = CIRCLE_SIZE / 2;
      amountText.y = circleY + CIRCLE_SIZE + AMOUNT_GAP;
      slotContainer.addChild(amountText);

      this.slots.set(key, {
        container: slotContainer,
        circle,
        label,
        numberText,
        amountText,
        isRange,
      });
    });
    this.renderActiveHighlight();
    this.renderValues();
  }

  private renderActiveHighlight(): void {
    for (const key of SLOT_KEYS) {
      const slot = this.slots.get(key);
      if (!slot) continue;
      const isActive = this.activeSlotKey === key;
      slot.circle.clear();
      // Mørk-rød base — `rgba(80, 18, 22, 0.55)`.
      slot.circle
        .circle(CIRCLE_SIZE / 2, CIRCLE_SIZE / 2, CIRCLE_SIZE / 2)
        .fill({ color: isActive ? 0xa02830 : 0x501216, alpha: isActive ? 0.85 : 0.55 });
      // Indre highlight-disk.
      slot.circle
        .circle(CIRCLE_SIZE * 0.5, CIRCLE_SIZE * 0.45, CIRCLE_SIZE * 0.42)
        .fill({ color: 0xffffff, alpha: 0.10 });
      // Border.
      slot.circle
        .circle(CIRCLE_SIZE / 2, CIRCLE_SIZE / 2, CIRCLE_SIZE / 2)
        .stroke({
          color: isActive ? 0xffd97a : 0xffffff,
          alpha: isActive ? 0.95 : 0.85,
          width: isActive ? 2 : 1.5,
        });
    }
  }

  private renderValues(): void {
    for (const key of SLOT_KEYS) {
      const slot = this.slots.get(key);
      if (!slot) continue;
      const data = this.latestData.get(key);
      slot.amountText.text = data ? formatPrize(data.prize) : "0";
    }
  }
}

function formatPrize(prize: number): string {
  if (!Number.isFinite(prize) || prize <= 0) return "0";
  if (Number.isInteger(prize)) return String(prize);
  return prize.toFixed(0);
}
