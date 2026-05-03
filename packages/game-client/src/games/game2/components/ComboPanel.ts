/**
 * Spill 2 Bong Mockup v2 — combo panel-rad med fire kolonner i rekkefølge:
 *
 *   1. PlayerCard      (130px) — ikon + 2-siffer spillerantall
 *   2. Hovedspill 1    (180px) — tittel + "Kjøp flere brett"-pill
 *   3. Velg lykketall  (160px) — kløver + 5×5-grid
 *   4. Jackpots        (flex)  — 6 jackpot-sirkler
 *
 * Kolonne-rekkefølgen er endret fra v1 (Lykketall→Hovedspill→Jackpots)
 * per chat2-feedback der brukeren først flyttet `player-col` til høyre,
 * så til venstre, og deretter "Swap Hovedspill and Velg lykketall
 * positions". Sluttilstanden er rekkefølgen over.
 *
 * CSS-mockup (`v2 Bong Mockup.html` `.combo-panel`):
 *   - Mørk-rød bakgrunn `rgba(20,5,8,0.55)`, 1.5px white-alpha border, 18px radius
 *   - `.combo-col` padding krympet 18→12 14, gap 14→10
 *   - Kolonne-divider 1.5px hvit @ alpha 0.18
 *   - PlayerCard har INGEN egen border (per chat2-feedback), bare
 *     en mørk-rød rounded-rect inni kolonnen.
 *
 * Pixi-implementasjon:
 *   - Container med rounded-rect bakgrunn + dividere som Graphics-rektangler.
 *   - Children (i x-rekkefølge): PlayerCard, HovedspillCol (intern),
 *     LykketallGrid, JackpotsRow.
 *   - Layout er fast-bredde for de tre første + flex-jackpots; vi tar
 *     imot total panel-bredde og fordeler proportionally.
 *
 * Kontrakt (BEVART for kompatibilitet med PlayScreen + Game2Controller):
 *   - `setOnLuckyNumber(cb)` — videresender klikk fra LykketallGrid.
 *   - `setOnBuyMore(cb)` — kalles ved klikk på "Kjøp flere brett".
 *   - `setLuckyNumber(n)` — markér valgt lucky-number.
 *   - `updateJackpots(list)` — videresender til JackpotsRow.
 *   - `setCurrentDrawCount(n)` — videresender til JackpotsRow.
 *
 * NY i v2:
 *   - `setPlayerCount(n)` — oppdaterer PlayerCard sitt 2-siffer tall.
 *
 * 2026-05-03 (Agent S, branch feat/spill2-bong-mockup-v2): omstrukturert
 * for v2-design — ny PlayerCard-kolonne, kolonne-rekkefølge endret,
 * paddings/gaps/sizes krympet per CSS-mockup. ComboPanel-bakgrunn er
 * uendret (samme rounded-rect i samme stil); det er kolonnenes innhold
 * som flyttes rundt.
 */

import { Container, Graphics, Text } from "pixi.js";
import { LykketallGrid } from "./LykketallGrid.js";
import { JackpotsRow, type JackpotSlotData } from "./JackpotsRow.js";
import { PlayerCard, PLAYER_COL_WIDTH } from "./PlayerCard.js";

// 2026-05-03 (Agent S, v2): paddings krympet per CSS `.combo-col {
// padding: 12px 14px; }` (var: 18px begge retninger).
const PANEL_PADDING_Y = 12;
const PANEL_PADDING_X = 14;
const COL_DIVIDER_W = 1.5;
const RADIUS = 18;

// v2 kolonne-bredder (eksklusiv kolonne-padding for hovedspill +
// inklusiv kolonne-padding for player; matcher hvordan CSS gjør det).
const HOVEDSPILL_INNER_W = 180; // CSS `.hovedspill-col { width: 180px; }`
const HOVEDSPILL_COL_W = HOVEDSPILL_INNER_W + PANEL_PADDING_X * 2;
const LYKKETALL_INNER_W = 160; // CSS `.lykketall-col { width: 160px; }`
const LYKKETALL_COL_W = LYKKETALL_INNER_W + PANEL_PADDING_X * 2;
// Pill-knapp dimensjoner — krympet per v2: 14px font→13, padding 12 18→9 14.
const PILL_W = 160;
const PILL_H = 36;

export class ComboPanel extends Container {
  private bg: Graphics;
  private dividers: Graphics;
  private playerCard: PlayerCard;
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

    // Panel-høyde dikteres av Lykketall (høyeste kolonne) + 2 * padding.
    this.panelH = this.lykketall.height + PANEL_PADDING_Y * 2;

    // ── bakgrunn ─────────────────────────────────────────────────────────
    this.bg = new Graphics();
    this.drawBg();
    this.addChild(this.bg);

    // ── kolonne 1: PlayerCard (ytterste venstre) ─────────────────────────
    // 130px bred. Kortet inni har egen padding = 10px (intern i komponenten).
    this.playerCard = new PlayerCard(this.panelH);
    this.playerCard.x = 0;
    this.playerCard.y = 0;
    this.addChild(this.playerCard);

    // ── kolonne 2: Hovedspill 1 ──────────────────────────────────────────
    const hovedspillX = PLAYER_COL_WIDTH + COL_DIVIDER_W;
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
    this.hovedspillTitle.x = HOVEDSPILL_INNER_W / 2;
    // Sentrer tittel + pill-knapp vertikalt i kolonnen.
    const blockH = 18 + 10 + PILL_H; // tittel-h + gap + pill-h
    const blockTop = (this.panelH - blockH) / 2;
    this.hovedspillTitle.y = blockTop;
    hovedspillContent.addChild(this.hovedspillTitle);

    // Pill-knapp "Kjøp flere brett". v2: 13px font, 9 14 padding → smaller pill.
    this.buyButton = new Container();
    this.buyButton.x = (HOVEDSPILL_INNER_W - PILL_W) / 2;
    this.buyButton.y = blockTop + 18 + 10;
    this.buyButton.eventMode = "static";
    this.buyButton.cursor = "pointer";
    this.buyButtonBg = new Graphics();
    this.drawBuyButton(false);
    this.buyButton.addChild(this.buyButtonBg);

    const buyText = new Text({
      text: "Kjøp flere brett",
      style: {
        fontFamily: "Inter, system-ui, Helvetica, sans-serif",
        fontSize: 13,
        fontWeight: "600",
        fill: 0xffffff,
        align: "center",
      },
    });
    buyText.anchor.set(0.5);
    buyText.x = PILL_W / 2;
    buyText.y = PILL_H / 2;
    this.buyButton.addChild(buyText);

    this.buyButton.on("pointerover", () => this.drawBuyButton(true));
    this.buyButton.on("pointerout", () => this.drawBuyButton(false));
    this.buyButton.on("pointerdown", () => this.onBuyMore?.());
    hovedspillContent.addChild(this.buyButton);

    // ── kolonne 3: Velg lykketall (5×5 grid) ─────────────────────────────
    const lykketallX = PLAYER_COL_WIDTH + COL_DIVIDER_W + HOVEDSPILL_COL_W + COL_DIVIDER_W;
    this.lykketall.x = lykketallX + PANEL_PADDING_X;
    this.lykketall.y = (this.panelH - this.lykketall.height) / 2;
    this.addChild(this.lykketall);

    // ── kolonne 4: Jackpots (flex til høyre) ─────────────────────────────
    const jackpotsX = lykketallX + LYKKETALL_COL_W + COL_DIVIDER_W + PANEL_PADDING_X;
    this.jackpots.x = jackpotsX;
    this.jackpots.y = (this.panelH - this.jackpots.barHeight) / 2;
    this.addChild(this.jackpots);

    // ── kolonne-dividere (3 stk: etter player, hovedspill, lykketall) ───
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

  /** v2-only: sett antall spillere på PlayerCard (vises 2-sifret). */
  setPlayerCount(n: number): void {
    this.playerCard.setCount(n);
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
    // 3 vertikale dividere mellom de 4 kolonnene.
    const dividerY1 = PANEL_PADDING_Y * 0.4;
    const dividerY2 = this.panelH - PANEL_PADDING_Y * 0.4;
    const x1 = PLAYER_COL_WIDTH;
    const x2 = PLAYER_COL_WIDTH + COL_DIVIDER_W + HOVEDSPILL_COL_W;
    const x3 = PLAYER_COL_WIDTH + COL_DIVIDER_W + HOVEDSPILL_COL_W + COL_DIVIDER_W + LYKKETALL_COL_W;
    for (const x of [x1, x2, x3]) {
      this.dividers
        .rect(x, dividerY1, COL_DIVIDER_W, dividerY2 - dividerY1)
        .fill({ color: 0xffffff, alpha: 0.18 });
    }
  }

  private drawBuyButton(hover: boolean): void {
    this.buyButtonBg.clear();
    this.buyButtonBg
      .roundRect(0, 0, PILL_W, PILL_H, PILL_H / 2)
      .fill({ color: hover ? 0x781e24 : 0x501216, alpha: hover ? 0.85 : 0.55 });
    this.buyButtonBg
      .roundRect(0, 0, PILL_W, PILL_H, PILL_H / 2)
      .stroke({ color: 0xffffff, alpha: 0.5, width: 1.5 });
    // Indre highlight (matcher `inset 0 1px 0 white 0.18`).
    this.buyButtonBg
      .roundRect(2, 2, PILL_W - 4, 2, 1)
      .fill({ color: 0xffffff, alpha: 0.18 });
  }
}
