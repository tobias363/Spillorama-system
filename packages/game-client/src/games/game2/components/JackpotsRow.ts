/**
 * Spill 2 — 6 jackpot/gain-slots i en horisontal rad. Hver slot rendres
 * som en mørk-rød sirkel med tall sentrert + gull-border. Over står
 * "Jackpot"/"Gain" som label, under står beløpet.
 *
 * 2026-05-04 (Tobias-direktiv revert): tilbake til Graphics-sirkler med
 * gull-border. Tidligere var det PNG-blue-baller (PR #915), men Tobias
 * ville se det opprinnelige design med mørk-rød sirkel + gull/yellow
 * border som tydelig matcher "gevinst-mønster"-styling fra mockup.
 *
 * Kontrakt:
 *   - `update(list)` — full prize-liste fra `g2:jackpot:list-update`-event.
 *   - `setCurrentDrawCount(n)` — markerer aktiv slot (ekstra glow-ring).
 *   - `setBarWidth(w)` — distribuer slots over total bredde `w` (jevn).
 *   - `barWidth` — get returnerer current allotted bredde.
 *   - `barHeight` — get returnerer total høyde (label + sirkel + amount).
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
// Tobias-direktiv 2026-05-04 (modernisering): solid sirkel + mer luftig
// spacing. Fjernet skumorf-gradient + drop-shadow.
const CIRCLE_SIZE = 60;
const LABEL_GAP = 10;     // var 4 → label løftes opp
const AMOUNT_GAP = 10;    // var 4 → amount skyves ned
const LABEL_H = 12;
const AMOUNT_H = 13;
/** Minimum-gap mellom sirkler. Garanteres uavhengig av rowWidth — hvis
 *  satte rowWidth gir mindre stride, øker vi rowWidth lokalt. */
const MIN_INTER_CIRCLE_GAP = 28;

/**
 * Mockup-paritet (Bong Mockup.html `.jackpot-circle`):
 *   border: 1.5px solid rgba(255, 255, 255, 0.85)
 *   background: rgba(80, 18, 22, 0.55)
 *   box-shadow: inset 0 1px 0 rgba(255,255,255,0.25),
 *               inset 0 -2px 6px rgba(0,0,0,0.3),
 *               0 4px 10px rgba(0,0,0,0.35)
 *
 * Pixi simulerer inset shadows med ekstra fyll-sirkler over base.
 */
const BORDER_DEFAULT_COLOR = 0xffffff;
const BORDER_DEFAULT_ALPHA = 0.85;
const BORDER_ACTIVE_COLOR = 0xffd97a; // aktiv slot beholder gull-aksent
const BORDER_ACTIVE_ALPHA = 1.0;
const FILL_DEFAULT_COLOR = 0x501216;
const FILL_DEFAULT_ALPHA = 0.55;
const FILL_ACTIVE_COLOR = 0xa02830;
const FILL_ACTIVE_ALPHA = 0.85;

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
    // Default: minimum bredde basert på fixed gap. ComboPanel kaller
    // `setBarWidth` like etter konstruksjon så slots distribueres jevnt.
    this.rowWidth = SLOT_KEYS.length * CIRCLE_SIZE + (SLOT_KEYS.length - 1) * 14;
    this.rowHeight = LABEL_H + LABEL_GAP + CIRCLE_SIZE + AMOUNT_GAP + AMOUNT_H;
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

  /**
   * Tobias-direktiv 2026-05-04: distribuer slots JEVENT over tilgjengelig
   * bredde. Med 6 slots og kjent total-bredde plasserer vi første slot
   * på x=0 og siste på x=(width - CIRCLE_SIZE).
   *
   * Idempotent — gjør ingenting hvis bredden ikke endret.
   */
  setBarWidth(width: number): void {
    if (width === this.rowWidth) return;
    this.rowWidth = Math.max(SLOT_KEYS.length * CIRCLE_SIZE, width);
    this.layoutSlots();
  }

  /**
   * Backend-driver: oppdater prize-listen.
   *
   * Tobias-direktiv 2026-05-04: under nedtelling til ny runde sender
   * server prize=0 for alle slots fordi forrige rundes prizePool er
   * resetet og ny runde ikke har armed-spillere ennå. Skjul disse
   * "alle-null"-oppdateringene så premiene fra forrige runde fortsatt
   * vises gjennom countdown-fasen — gir bedre UX.
   *
   * Hvis vi ALDRI har hatt non-zero verdier (helt nytt rom), tillater
   * vi 0-update så slots viser "0" som default.
   */
  update(list: JackpotSlotData[]): void {
    const allZero = list.every((entry) => !entry.prize || entry.prize <= 0);
    const haveExistingValues = Array.from(this.latestData.values()).some(
      (e) => e.prize > 0,
    );
    if (allZero && haveExistingValues) {
      // Behold forrige rundes priser under countdown.
      return;
    }
    for (const entry of list) {
      this.latestData.set(entry.number, entry);
    }
    this.renderValues();
  }

  /**
   * Markér slot som matcher current draw count som aktiv.
   *   draws 1-8  → ingen aktiv slot
   *   draws 9-13 → slot "9".."13" aktiv
   *   draws 14-21 → slot "14-21" aktiv
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
    SLOT_KEYS.forEach((key) => {
      const slotContainer = new Container();
      this.addChild(slotContainer);

      const isRange = key === "14-21";

      // Label over sirkelen. Mockup-paritet: lowercase "gain" for slot
      // 13 og 14-21, "Jackpot" (uppercase J) for 9-12.
      const labelText = key === "13" || isRange ? "gain" : "Jackpot";
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
      const circleY = LABEL_H + LABEL_GAP;
      const circle = new Graphics();
      circle.x = 0;
      circle.y = circleY;
      slotContainer.addChild(circle);

      // Tallet midt i sirkelen.
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

      // Beløpet under sirkelen.
      const amountText = new Text({
        text: "0",
        style: {
          fontFamily: "Inter, system-ui, Helvetica, sans-serif",
          fontSize: AMOUNT_H,
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
    this.layoutSlots();
    this.renderActiveHighlight();
    this.renderValues();
  }

  /**
   * Layout: distribuer 6 slots over `rowWidth` med minimum-gap-garanti.
   * Hvis tilgjengelig stride er mindre enn `CIRCLE_SIZE + MIN_INTER_CIRCLE_GAP`,
   * brukes minimum stride i stedet (slot 6 kan da overskride rowWidth — det
   * er ComboPanel's ansvar å allokere nok bredde).
   */
  private layoutSlots(): void {
    const n = SLOT_KEYS.length;
    const evenStride = (this.rowWidth - CIRCLE_SIZE) / (n - 1);
    const minStride = CIRCLE_SIZE + MIN_INTER_CIRCLE_GAP;
    const stride = Math.max(evenStride, minStride);
    SLOT_KEYS.forEach((key, idx) => {
      const slot = this.slots.get(key);
      if (slot) slot.container.x = idx * stride;
    });
  }

  private renderActiveHighlight(): void {
    for (const key of SLOT_KEYS) {
      const slot = this.slots.get(key);
      if (!slot) continue;
      const isActive = this.activeSlotKey === key;
      slot.circle.clear();
      // Tobias-direktiv 2026-05-04 (modernisering): SOLID FYLL uten
      // gradient/inset-shadows/drop-shadow. Bare flat mørk-rød + tynn
      // hvit border. Aktiv slot får gull-aksent på border.
      slot.circle
        .circle(CIRCLE_SIZE / 2, CIRCLE_SIZE / 2, CIRCLE_SIZE / 2)
        .fill({
          color: isActive ? FILL_ACTIVE_COLOR : FILL_DEFAULT_COLOR,
          alpha: 1.0,
        });
      slot.circle
        .circle(CIRCLE_SIZE / 2, CIRCLE_SIZE / 2, CIRCLE_SIZE / 2)
        .stroke({
          color: isActive ? BORDER_ACTIVE_COLOR : BORDER_DEFAULT_COLOR,
          alpha: isActive ? BORDER_ACTIVE_ALPHA : BORDER_DEFAULT_ALPHA,
          width: isActive ? 2.0 : 1.5,
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
