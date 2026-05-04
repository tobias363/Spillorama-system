/**
 * Spill 2 — 6 jackpot/gain-slots i en horisontal rad. Hver slot rendres
 * som en Spill 1-stil ball-PNG med tall sentrert. Over står "Jackpot"/
 * "Gain" som label, under står beløpet.
 *
 * 2026-05-04 (Tobias-direktiv): SPILL 1-PARITET PÅ DESIGN.
 *   - Erstatter `Graphics.circle().fill()`-stilen med samme PNG-ball-asset
 *     som drawn-balls i `BallTube`. Visuell unitet med trukne baller.
 *   - Slots fordeles JEVENT over tilgjengelig bredde (`setBarWidth`) så
 *     det ikke er stor tom plass til høyre for "14-21"-ballen.
 *
 * Kontrakt:
 *   - `update(list)` — full prize-liste fra `g2:jackpot:list-update`-event.
 *   - `setCurrentDrawCount(n)` — markerer aktiv slot.
 *   - `setBarWidth(w)` — NY: distribuer slots over total bredde `w`.
 *   - `barWidth` — get returnerer current allotted bredde.
 *   - `barHeight` — get returnerer total høyde (label + ball + amount).
 */

import { Container, Graphics, Sprite, Text, Assets, type Texture } from "pixi.js";

export interface JackpotSlotData {
  /** Slot-nøkkel: "9" | "10" | "11" | "12" | "13" | "14-21". */
  number: string;
  /** Premie i kroner (kommer ferdig-beregnet fra backend). */
  prize: number;
  /** Visuell label: "Jackpot" eller "Gain". */
  type: "gain" | "jackpot";
}

const SLOT_KEYS = ["9", "10", "11", "12", "13", "14-21"] as const;
const CIRCLE_SIZE = 50;
const LABEL_GAP = 4;
const AMOUNT_GAP = 4;
const LABEL_H = 12;
const AMOUNT_H = 13;

/**
 * PNG-mapping speilet av Spill 1's `getBallAssetPath`. Slot-key parses
 * til lavest tall (range "14-21" → 14) for color-lookup. Alle slot 9-13
 * og 14 ≤ 15 mapper til blue.png — visuell unitet.
 */
function getBallAssetPath(n: number): string {
  if (n <= 15) return "/web/games/assets/game1/design/balls/blue.png";
  if (n <= 30) return "/web/games/assets/game1/design/balls/red.png";
  if (n <= 45) return "/web/games/assets/game1/design/balls/purple.png";
  if (n <= 60) return "/web/games/assets/game1/design/balls/green.png";
  return "/web/games/assets/game1/design/balls/yellow.png";
}

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

interface SlotVisual {
  container: Container;
  ballSprite: Sprite | null;
  highlight: Graphics;
  label: Text;
  numberText: Text;
  amountText: Text;
  isRange: boolean;
  numericKey: number;
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
   * på x=0 og siste på x=(width - CIRCLE_SIZE) — like avstand mellom
   * sentre. Eliminerer tom plass til høyre for "14-21"-ballen.
   *
   * Idempotent — gjør ingenting hvis bredden ikke endret.
   */
  setBarWidth(width: number): void {
    if (width === this.rowWidth) return;
    this.rowWidth = Math.max(SLOT_KEYS.length * CIRCLE_SIZE, width);
    this.layoutSlots();
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
      const numericKey = isRange ? 14 : parseInt(key, 10);

      // Label over ballen.
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

      // Ball-PNG-bakgrunn (lazy-loaded).
      const ballY = LABEL_H + LABEL_GAP;
      let ballSprite: Sprite | null = null;
      const url = getBallAssetPath(numericKey);
      const cached = Assets.cache.get(url) as Texture | undefined;
      if (cached) {
        enableMipmaps(cached);
        ballSprite = new Sprite(cached);
        ballSprite.width = CIRCLE_SIZE;
        ballSprite.height = CIRCLE_SIZE;
        ballSprite.x = 0;
        ballSprite.y = ballY;
        slotContainer.addChild(ballSprite);
      } else {
        void Assets.load(url)
          .then((tex: Texture) => {
            if (slotContainer.destroyed) return;
            enableMipmaps(tex);
            const sprite = new Sprite(tex);
            sprite.width = CIRCLE_SIZE;
            sprite.height = CIRCLE_SIZE;
            sprite.x = 0;
            sprite.y = ballY;
            slotContainer.addChildAt(sprite, 1); // over label, under text
            const slot = this.slots.get(key);
            if (slot) slot.ballSprite = sprite;
          })
          .catch(() => {});
      }

      // Highlight-ring som tegnes OVER ballen når slot er aktiv. Tegnes
      // som tom Graphics nå; renderActiveHighlight fyller den.
      const highlight = new Graphics();
      highlight.x = 0;
      highlight.y = ballY;
      slotContainer.addChild(highlight);

      // Tallet (eller range "14-21") sentrert på ballen.
      const numberText = new Text({
        text: key,
        style: {
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          fontSize: isRange ? 13 : 19,
          fontWeight: "800",
          fill: 0x1a0a0a,
          align: "center",
          letterSpacing: -0.5,
        },
      });
      numberText.anchor.set(0.5);
      // -1px optisk forskyvning matcher Spill 1's ball-text-offset.
      numberText.x = CIRCLE_SIZE / 2 - 1;
      numberText.y = ballY + CIRCLE_SIZE / 2;
      slotContainer.addChild(numberText);

      // Beløpet under ballen.
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
      amountText.y = ballY + CIRCLE_SIZE + AMOUNT_GAP;
      slotContainer.addChild(amountText);

      this.slots.set(key, {
        container: slotContainer,
        ballSprite,
        highlight,
        label,
        numberText,
        amountText,
        isRange,
        numericKey,
      });
    });
    this.layoutSlots();
    this.renderActiveHighlight();
    this.renderValues();
  }

  /**
   * Layout: distribuer 6 slots jevnt over `rowWidth`. Første slot ved x=0,
   * siste slot ved x=(rowWidth - CIRCLE_SIZE), midlere slots interpolert.
   */
  private layoutSlots(): void {
    // SLOT_KEYS er alltid 6 elementer; stride er trygt å beregne uten
    // single-slot-spesialtilfelle. Stride = avstand mellom slot-sentre.
    const n = SLOT_KEYS.length;
    const stride = (this.rowWidth - CIRCLE_SIZE) / (n - 1);
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
      slot.highlight.clear();
      if (isActive) {
        // Glødende ring rundt aktiv ball — gull-aksent (matcher Spill 1's
        // active-ball-highlight). Tegnes som ekstra ring rundt PNG-ballen.
        slot.highlight
          .circle(CIRCLE_SIZE / 2, CIRCLE_SIZE / 2, CIRCLE_SIZE / 2 + 3)
          .stroke({ color: 0xffd97a, alpha: 0.9, width: 2.5 });
        slot.highlight
          .circle(CIRCLE_SIZE / 2, CIRCLE_SIZE / 2, CIRCLE_SIZE / 2 + 1)
          .fill({ color: 0xffd97a, alpha: 0.10 });
      }
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
