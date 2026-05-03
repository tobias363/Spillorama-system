/**
 * Spill 2 Bong Mockup design — combo panel-rad med tre kolonner:
 *   1. Lykketall (180px) — kløver-ikon + "VELG LYKKETALL" + 5×5-grid
 *   2. Hovedspill 1 (220px) — tittel + "Kjøp flere brett"-pill
 *   3. Jackpots (flex) — 6 jackpot-sirkler
 *
 * CSS-mockup (`.combo-panel`):
 *   - Mørk-rød bakgrunn `rgba(20,5,8,0.55)`
 *   - 1.5px white-alpha border, 18px corner-radius
 *   - Indre kolonne-divider — 1.5px white-alpha vertikal strek
 *
 * Pixi-implementasjon:
 *   - Container med rounded-rect bakgrunn + dividere som Graphics-rektangler.
 *   - Children: `LykketallGrid`, `HovedspillCol` (intern), `JackpotsRow`.
 *   - Layout er fast-bredde + flex-jackpots; vi tar imot total panel-bredde
 *     i constructor og fordeler proportionally.
 *
 * Kontrakt:
 *   - `setOnLuckyNumber(cb)` — videresender klikk fra LykketallGrid.
 *   - `setOnBuyMore(cb)` — kalles ved klikk på "Kjøp flere brett".
 *   - `setLuckyNumber(n)` — markér valgt lucky-number (etter server-bekreftelse).
 *   - `updateJackpots(list)` — videresender til JackpotsRow.
 *   - `setCurrentDrawCount(n)` — videresender til JackpotsRow.
 *
 * 2026-05-03 (Agent E, branch feat/spill2-bong-mockup-design): ny komponent.
 */

import { Container, Graphics, Text } from "pixi.js";
import { LykketallGrid } from "./LykketallGrid.js";
import { JackpotsRow, type JackpotSlotData } from "./JackpotsRow.js";

const PANEL_PADDING_Y = 18;
const PANEL_PADDING_X = 18;
const COL_DIVIDER_W = 1.5;
const RADIUS = 18;

const LYKKETALL_COL_W = 180 + PANEL_PADDING_X * 2;
const HOVEDSPILL_COL_W = 220 + PANEL_PADDING_X * 2;

export class ComboPanel extends Container {
  private bg: Graphics;
  private dividers: Graphics;
  private lykketall: LykketallGrid;
  private jackpots: JackpotsRow;
  private hovedspillTitle: Text;
  private buyButton: Container;
  private buyButtonBg: Graphics;
  private panelW: number;
  private panelH: number;
  private onBuyMore: (() => void) | null = null;

  constructor(panelWidth: number) {
    super();
    this.panelW = panelWidth;

    // ── instans-children først (vi trenger dimensjonene til layout) ──────
    this.lykketall = new LykketallGrid();
    this.jackpots = new JackpotsRow();

    // Panel-høyde dikteres av Lykketall (høyeste kolonne).
    this.panelH =
      this.lykketall.height + PANEL_PADDING_Y * 2;

    // ── bakgrunn ─────────────────────────────────────────────────────────
    this.bg = new Graphics();
    this.drawBg();
    this.addChild(this.bg);

    // ── kolonne 1: Lykketall ─────────────────────────────────────────────
    this.lykketall.x = PANEL_PADDING_X;
    this.lykketall.y = (this.panelH - this.lykketall.height) / 2;
    this.addChild(this.lykketall);

    // ── kolonne 2: Hovedspill 1 ──────────────────────────────────────────
    const hovedspillX = LYKKETALL_COL_W + COL_DIVIDER_W;
    const hovedspillContent = new Container();
    hovedspillContent.x = hovedspillX + PANEL_PADDING_X;
    hovedspillContent.y = 0;
    this.addChild(hovedspillContent);

    this.hovedspillTitle = new Text({
      text: "HOVEDSPILL 1",
      style: {
        fontFamily: "Inter, system-ui, Helvetica, sans-serif",
        fontSize: 13,
        fontWeight: "700",
        fill: 0xeae0d2,
        letterSpacing: 1.6,
        align: "center",
      },
    });
    this.hovedspillTitle.anchor.set(0.5, 0);
    this.hovedspillTitle.x = 220 / 2;
    this.hovedspillTitle.y = (this.panelH - 80) / 2;
    hovedspillContent.addChild(this.hovedspillTitle);

    // Pill-knapp "Kjøp flere brett".
    this.buyButton = new Container();
    this.buyButton.x = (220 - 200) / 2;
    this.buyButton.y = this.hovedspillTitle.y + 26;
    this.buyButton.eventMode = "static";
    this.buyButton.cursor = "pointer";
    this.buyButtonBg = new Graphics();
    this.drawBuyButton(false);
    this.buyButton.addChild(this.buyButtonBg);

    const buyText = new Text({
      text: "Kjøp flere brett",
      style: {
        fontFamily: "Inter, system-ui, Helvetica, sans-serif",
        fontSize: 14,
        fontWeight: "600",
        fill: 0xffffff,
        align: "center",
      },
    });
    buyText.anchor.set(0.5);
    buyText.x = 100;
    buyText.y = 22;
    this.buyButton.addChild(buyText);

    this.buyButton.on("pointerover", () => this.drawBuyButton(true));
    this.buyButton.on("pointerout", () => this.drawBuyButton(false));
    this.buyButton.on("pointerdown", () => this.onBuyMore?.());
    hovedspillContent.addChild(this.buyButton);

    // ── kolonne 3: Jackpots ──────────────────────────────────────────────
    const jackpotsX = LYKKETALL_COL_W + COL_DIVIDER_W + HOVEDSPILL_COL_W + COL_DIVIDER_W + PANEL_PADDING_X;
    this.jackpots.x = jackpotsX;
    this.jackpots.y = (this.panelH - this.jackpots.barHeight) / 2;
    this.addChild(this.jackpots);

    // ── kolonne-dividere ─────────────────────────────────────────────────
    this.dividers = new Graphics();
    this.drawDividers();
    this.addChild(this.dividers);
  }

  /** Total panel-høyde — for layout-beregning i `PlayScreen`. */
  get height(): number {
    return this.panelH;
  }

  /** Sett bredden (f.eks. ved screen-resize). Re-tegner bakgrunn + dividere. */
  setWidth(w: number): void {
    if (w === this.panelW) return;
    this.panelW = w;
    this.drawBg();
    this.drawDividers();
  }

  setOnLuckyNumber(cb: (n: number) => void): void {
    this.lykketall.setOnSelect(cb);
  }

  setOnBuyMore(cb: () => void): void {
    this.onBuyMore = cb;
  }

  /** Markér valgt lucky-number — speilet til LykketallGrid. */
  setLuckyNumber(n: number | null): void {
    this.lykketall.setLuckyNumber(n);
  }

  /** Backend-driver for jackpot-prize-listen. */
  updateJackpots(list: JackpotSlotData[]): void {
    this.jackpots.update(list);
  }

  /** Markér aktiv jackpot-slot. */
  setCurrentDrawCount(n: number): void {
    this.jackpots.setCurrentDrawCount(n);
  }

  // ── interne tegne-rutiner ───────────────────────────────────────────────

  private drawBg(): void {
    this.bg.clear();
    this.bg
      .roundRect(0, 0, this.panelW, this.panelH, RADIUS)
      .fill({ color: 0x140508, alpha: 0.55 });
    this.bg
      .roundRect(0, 0, this.panelW, this.panelH, RADIUS)
      .stroke({ color: 0xffffff, alpha: 0.18, width: 1.5 });
    // Topp-highlight (matcher `inset 0 1px 0 rgba(255,255,255,.08)`).
    this.bg
      .roundRect(2, 2, this.panelW - 4, 2, 1)
      .fill({ color: 0xffffff, alpha: 0.08 });
  }

  private drawDividers(): void {
    this.dividers.clear();
    const dividerY1 = PANEL_PADDING_Y * 0.4;
    const dividerY2 = this.panelH - PANEL_PADDING_Y * 0.4;
    const x1 = LYKKETALL_COL_W;
    const x2 = LYKKETALL_COL_W + HOVEDSPILL_COL_W + COL_DIVIDER_W;
    this.dividers
      .rect(x1, dividerY1, COL_DIVIDER_W, dividerY2 - dividerY1)
      .fill({ color: 0xffffff, alpha: 0.18 });
    this.dividers
      .rect(x2, dividerY1, COL_DIVIDER_W, dividerY2 - dividerY1)
      .fill({ color: 0xffffff, alpha: 0.18 });
  }

  private drawBuyButton(hover: boolean): void {
    this.buyButtonBg.clear();
    this.buyButtonBg
      .roundRect(0, 0, 200, 44, 22)
      .fill({ color: hover ? 0x781e24 : 0x501216, alpha: hover ? 0.85 : 0.55 });
    this.buyButtonBg
      .roundRect(0, 0, 200, 44, 22)
      .stroke({ color: 0xffffff, alpha: 0.5, width: 1.5 });
    // Indre highlight (matcher `inset 0 1px 0 white 0.18`).
    this.buyButtonBg
      .roundRect(2, 2, 196, 2, 1)
      .fill({ color: 0xffffff, alpha: 0.18 });
  }
}
