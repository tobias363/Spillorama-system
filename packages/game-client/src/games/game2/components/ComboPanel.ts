/**
 * Spill 2 Bong Mockup v2 — combo panel-rad med fire kolonner i rekkefølge:
 *
 *   1. PlayerCard      (130px) — ikon + 2-siffer spillerantall
 *   2. Hovedspill 1    (180px) — tittel + "Kjøp flere brett"-pill
 *   3. Velg lykketall  (160px) — STOR kløver-ikon + "VELG LYKKETALL"-tekst
 *      (klikkbar — åpner LykketallPopup; valgt nummer vises som tekst)
 *   4. Jackpots        (flex)  — 6 jackpot-sirkler
 *
 * Kolonne-rekkefølgen er endret fra v1 (Lykketall→Hovedspill→Jackpots)
 * per chat2-feedback der brukeren først flyttet `player-col` til høyre,
 * så til venstre, og deretter "Swap Hovedspill and Velg lykketall
 * positions". Sluttilstanden er rekkefølgen over.
 *
 * 2026-05-03 (Agent Y, branch feat/spill2-lykketall-popup): tidligere
 * inline 5×5 lucky-number-grid ERSTATTET med stor kløver + tekst-kolonne.
 * Klikk åpner LykketallPopup (modal). Per Tobias-direktiv:
 *
 *   "designet skal være som dette … velg lykketall skal være en popup
 *    med da alle tallene som man kan velge mellom"
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
 *     LykketallCol (kløver+tekst), JackpotsRow.
 *   - Layout er fast-bredde for de tre første + flex-jackpots; vi tar
 *     imot total panel-bredde og fordeler proportionally.
 *
 * Kontrakt (BEVART for kompatibilitet med PlayScreen + LobbyScreen):
 *   - `setOnLuckyClick(cb)` — NY: klikk på Lykketall-kolonnen åpner popup.
 *   - `setOnLuckyNumber(cb)` — BEVART for backward-compat, men IKKE lenger
 *     fyrt fra ComboPanel. PlayScreen/LobbyScreen håndterer popup-callback
 *     direkte.
 *   - `setOnBuyMore(cb)` — kalles ved klikk på "Kjøp flere brett".
 *   - `setLuckyNumber(n)` — oppdaterer tekst-displayet i Lykketall-kolonnen.
 *   - `updateJackpots(list)` — videresender til JackpotsRow.
 *   - `setCurrentDrawCount(n)` — videresender til JackpotsRow.
 *   - `setPlayerCount(n)` — oppdaterer PlayerCard sitt 2-siffer tall.
 */

import { Container, Graphics, Sprite, Text, Assets, type Texture } from "pixi.js";
import { JackpotsRow, type JackpotSlotData } from "./JackpotsRow.js";
import { PlayerCard, PLAYER_COL_WIDTH } from "./PlayerCard.js";
import type { HtmlOverlayManager } from "../../game1/components/HtmlOverlayManager.js";

// Mockup-paritet (Bong Mockup.html 2026-05-04): combo-col padding
// 16px 18px, dividers 1px solid #c98a3a, panel border 1px solid #c98a3a,
// border-radius 16px.
const PANEL_PADDING_Y = 16;
const PANEL_PADDING_X = 18;
const COL_DIVIDER_W = 1;
const RADIUS = 16;
/** Kobber-gull farge fra mockup `border: 1px solid #c98a3a`. */
const BORDER_COPPER = 0xc98a3a;

// Kolonne-bredder.
//   Tobias-direktiv 2026-05-04: hovedspill-col utvidet 200 → 230 for å
//   gi plass til "Forhåndskjøp neste runde"-label inni pill-knappen
//   (gikk tidligere ut på begge sider).
//   .lykketall-col { width: 160px }
//   .player-col { width: 110px }
// Tobias-direktiv 2026-05-06 (iter 5): bredde redusert fra 230 → 180 for
// å gi mer plass til JackpotsRow (bredere bar = bedre spacing mellom balls
// + plass for "14-21"-ballen til høyre).
const HOVEDSPILL_INNER_W = 180;
const HOVEDSPILL_COL_W = HOVEDSPILL_INNER_W + PANEL_PADDING_X * 2;
// Tobias-direktiv 2026-05-06 (iter 5): redusert 160 → 120 for ekstra
// plass til JackpotsRow.
const LYKKETALL_INNER_W = 120;
const LYKKETALL_COL_W = LYKKETALL_INNER_W + PANEL_PADDING_X * 2;
// Pill-knapp: padding 8px 16px, border-radius 6px. Bredden økt 160 → 210
// så "Forhåndskjøp neste runde"-tekst (23 chars × 13px Inter) får plass.
const PILL_W = 210;
const PILL_H = 32;
const PILL_RADIUS = 6;
// Lykketall-kolonne: clover 44px + label sentrert. Tobias-direktiv 2026-05-06
// (5. iterasjon): bytt fra 170 → 200 — gir mer vertikal breathing-room
// så labels ikke ligger ved panel-toppen, og jackpot-blokk er sentrert
// med komfortabel margin top/bottom.
const LYKKETALL_COL_HEIGHT = 200;
const CLOVER_SIZE = 44;
const CLOVER_URL = "/web/games/assets/game2/design/lucky-clover.png";

export class ComboPanel extends Container {
  private bg: Graphics;
  private dividers: Graphics;
  private playerCard: PlayerCard;
  private jackpots: JackpotsRow;
  private hovedspillTitle: Text;
  private buyButton: Container;
  private buyButtonBg: Graphics;
  /**
   * Tekst på "Kjøp flere brett"-pillen. Holdt som field så
   * `setBuyMoreLabel` kan oppdatere den dynamisk basert på gameStatus
   * (LOBBY/WAITING → "Kjøp flere brett", RUNNING → "Forhåndskjøp neste
   * runde"). Speiler BuyPopup sin phase-aware tittel-logikk (PR #903).
   */
  private buyButtonText: Text;
  // Lykketall-kolonne (klikkbar, åpner popup).
  private lykketallCol: Container;
  private lykketallLabel: Text;
  private lykketallClover: Sprite | Graphics | null = null;
  private panelW: number;
  private panelH: number;
  private currentLuckyNumber: number | null = null;
  private onBuyMore: (() => void) | null = null;
  private onLuckyClick: (() => void) | null = null;

  constructor(panelWidth: number) {
    super();
    this.panelW = panelWidth;

    // ── instans-children først (vi trenger dimensjonene til layout) ──────
    this.jackpots = new JackpotsRow();

    // Panel-høyde dikteres av Lykketall-kolonnen (samme som før dikterte
    // gridet) + 2 * padding. Holder samme overall panel-høyde som v1.
    this.panelH = LYKKETALL_COL_HEIGHT + PANEL_PADDING_Y * 2;

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
        // Mockup `.hovedspill-col .panel-title { color: #fff }` — pure white,
        // ikke cream-tone. Tobias 2026-05-06 PR 2 mockup-paritet.
        fill: 0xffffff,
        letterSpacing: 1.82, // 0.14em av 13px
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

    this.buyButtonText = new Text({
      text: "Kjøp flere brett",
      style: {
        fontFamily: "Inter, system-ui, Helvetica, sans-serif",
        fontSize: 13,
        fontWeight: "600",
        fill: 0xffffff,
        align: "center",
      },
    });
    this.buyButtonText.anchor.set(0.5);
    this.buyButtonText.x = PILL_W / 2;
    this.buyButtonText.y = PILL_H / 2;
    this.buyButton.addChild(this.buyButtonText);

    this.buyButton.on("pointerover", () => this.drawBuyButton(true));
    this.buyButton.on("pointerout", () => this.drawBuyButton(false));
    this.buyButton.on("pointerdown", () => this.onBuyMore?.());
    hovedspillContent.addChild(this.buyButton);

    // ── kolonne 3: Velg lykketall (kløver + tekst, KLIKKBAR) ─────────────
    // Hele kolonnen er en Container med pointer-events; klikk åpner popup.
    // Vi gir den en transparent hit-area som dekker hele kolonne-rektangelet
    // så clicks også registreres mellom kløver og tekst.
    const lykketallX = PLAYER_COL_WIDTH + COL_DIVIDER_W + HOVEDSPILL_COL_W + COL_DIVIDER_W;
    this.lykketallCol = new Container();
    this.lykketallCol.x = lykketallX;
    this.lykketallCol.y = 0;
    this.lykketallCol.eventMode = "static";
    this.lykketallCol.cursor = "pointer";

    // Hit-area + hover-bakgrunn. Vi tegner en rounded-rect som dekker hele
    // kolonnen, alpha 0 default, 0.08 på hover for visuell feedback.
    const lykketallHit = new Graphics();
    this.lykketallCol.addChild(lykketallHit);
    const drawLykketallHit = (hover: boolean): void => {
      lykketallHit.clear();
      lykketallHit
        .roundRect(4, 4, LYKKETALL_COL_W - 8, this.panelH - 8, 10)
        .fill({ color: 0xffffff, alpha: hover ? 0.08 : 0.0001 });
    };
    drawLykketallHit(false);
    this.lykketallCol.on("pointerover", () => drawLykketallHit(true));
    this.lykketallCol.on("pointerout", () => drawLykketallHit(false));
    this.lykketallCol.on("pointerdown", () => this.onLuckyClick?.());

    // Kløver-ikon (lazy-loaded, fallback til Graphics).
    void this.loadClover();

    // Label under kløver — mockup `.panel-title` med multi-line "Velg<br/>Lykketall".
    // Tobias 2026-05-06 PR 2: bryt teksten over to linjer for å matche mockup,
    // og match `panel-title`-styling (13px, 0.12em letter-spacing, white-92).
    // Når en lykketall er valgt, viser vi "LYKKETALL: NN" på én linje (se
    // `setLuckyNumber`).
    this.lykketallLabel = new Text({
      text: "VELG\nLYKKETALL",
      style: {
        fontFamily: "Inter, system-ui, Helvetica, sans-serif",
        fontSize: 13,
        fontWeight: "700",
        fill: 0xffffff,
        letterSpacing: 1.56, // 0.12em av 13px
        align: "center",
        lineHeight: 16,
      },
    });
    this.lykketallLabel.anchor.set(0.5, 0);
    this.lykketallLabel.x = LYKKETALL_COL_W / 2;
    // Posisjon settes i `loadClover` etter at kløveren er lastet.
    // Foreløpig posisjon: under forventet kløver-plass.
    this.lykketallLabel.y = (this.panelH - CLOVER_SIZE) / 2 + CLOVER_SIZE + 6;
    this.lykketallCol.addChild(this.lykketallLabel);

    this.addChild(this.lykketallCol);

    // ── kolonne 4: Jackpots (flex til høyre) ─────────────────────────────
    // Tobias-direktiv 2026-05-04: distribuer 6 slots jevnt over hele
    // tilgjengelig bredde fra slutten av Lykketall-kolonnen til høyre
    // panel-kant. Eliminerer tom plass til høyre for "14-21"-ballen.
    const jackpotsX = lykketallX + LYKKETALL_COL_W + COL_DIVIDER_W + PANEL_PADDING_X;
    const jackpotsAvailW = Math.max(0, this.panelW - jackpotsX - PANEL_PADDING_X);
    this.jackpots.setBarWidth(jackpotsAvailW);
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

  /** Sett bredden (f.eks. ved screen-resize). Re-tegner bakgrunn + dividere
   *  + re-distribuer jackpot-slots over ny tilgjengelig bredde. */
  setWidth(w: number): void {
    if (w === this.panelW) return;
    this.panelW = w;
    this.drawBg();
    this.drawDividers();
    // Re-distribuer jackpot-slots så de fyller den nye tilgjengelige plassen.
    const jackpotsX = PLAYER_COL_WIDTH + COL_DIVIDER_W + HOVEDSPILL_COL_W + COL_DIVIDER_W + LYKKETALL_COL_W + COL_DIVIDER_W + PANEL_PADDING_X;
    const jackpotsAvailW = Math.max(0, this.panelW - jackpotsX - PANEL_PADDING_X);
    this.jackpots.setBarWidth(jackpotsAvailW);
  }

  /**
   * BEVART for backward-compat (LobbyScreen + PlayScreen kaller den).
   * Inline-griddet er fjernet, så denne callback fyres ALDRI fra ComboPanel
   * lenger. PlayScreen/LobbyScreen ringer onLuckyNumber direkte fra
   * popup-callback. Ikke fjern signaturen — andre code paths bruker den.
   */
  setOnLuckyNumber(_cb: (n: number) => void): void {
    // No-op i ny design — popup-flyt eier callback-en.
  }

  /** NY: klikk på Lykketall-kolonnen åpner popup (eier av popup er parent screen). */
  setOnLuckyClick(cb: () => void): void {
    this.onLuckyClick = cb;
  }

  setOnBuyMore(cb: () => void): void {
    this.onBuyMore = cb;
  }

  /**
   * Tobias-direktiv 2026-05-04 (Bug 2 — fix/spill2-bug2-bug3): oppdater
   * pill-tekst basert på gameStatus.
   *   - LOBBY/WAITING/ENDED → "Kjøp flere brett" (default)
   *   - RUNNING (mid-round) → "Forhåndskjøp neste runde"
   *
   * Speiler BuyPopup.show(forNextRound)-flagget (PR #903) slik at både
   * trigger-pillen i ComboPanel OG popup-tittelen kommuniserer at
   * kjøpet armer for NESTE runde, ikke pågående trekning.
   *
   * Idempotent: gjør ingenting om teksten allerede er korrekt.
   */
  setBuyMoreLabel(label: string): void {
    if (this.buyButtonText.text === label) return;
    this.buyButtonText.text = label;
  }

  /** Markér valgt lucky-number — oppdaterer tekst-display i Lykketall-kolonnen.
   *  Default-state er multi-line "VELG\nLYKKETALL" (mockup-paritet).
   *  Når en lykketall er valgt skifter vi til single-line "LYKKETALL: NN" i gull. */
  setLuckyNumber(n: number | null): void {
    if (this.currentLuckyNumber === n) return;
    this.currentLuckyNumber = n;
    if (n != null) {
      this.lykketallLabel.text = `LYKKETALL: ${n}`;
      this.lykketallLabel.style.fill = 0xffe83d;
    } else {
      this.lykketallLabel.text = "VELG\nLYKKETALL";
      this.lykketallLabel.style.fill = 0xffffff;
    }
  }

  /** Backend-driver for jackpot-prize-listen. */
  updateJackpots(list: JackpotSlotData[]): void {
    this.jackpots.update(list);
  }

  /** Markér aktiv jackpot-slot. */
  setCurrentDrawCount(n: number): void {
    this.jackpots.setCurrentDrawCount(n);
  }

  /**
   * Tobias-direktiv 2026-05-05: mount HTML "Jackpot"/"Gain"-labels over
   * jackpot-ballene. Pass-through til JackpotsRow. Kalles av PlayScreen/
   * LobbyScreen etter at panel er lagt til Pixi-stage.
   */
  attachJackpotLabels(canvas: HTMLCanvasElement, overlayManager: HtmlOverlayManager): void {
    this.jackpots.attachLabels(canvas, overlayManager);
  }

  /** Pass-through detach (typisk kalt automatisk via destroy-cascade,
   *  men eksponert for ekspl. unmount-flyt). */
  detachJackpotLabels(): void {
    this.jackpots.detachLabels();
  }

  /** v2-only: sett antall spillere på PlayerCard (vises 2-sifret). */
  setPlayerCount(n: number): void {
    this.playerCard.setCount(n);
  }

  /** Tobias-direktiv 2026-05-04: vis "Innsats: X kr" på PlayerCard.
   *  Skjules når 0. Speiler Spill 1's LeftInfoPanel-mønster. */
  setPlayerStake(stake: number): void {
    this.playerCard.setStake(stake);
  }

  /** Tobias-direktiv 2026-05-04: vis "Gevinst: Y kr" på PlayerCard.
   *  Skjules når 0. */
  setPlayerWinnings(winnings: number): void {
    this.playerCard.setWinnings(winnings);
  }

  // ── interne tegne-rutiner ───────────────────────────────────────────────

  private drawBg(): void {
    this.bg.clear();
    // Mockup-paritet: rgba(20, 5, 8, 0.55) base + 1px solid #c98a3a border.
    this.bg
      .roundRect(0, 0, this.panelW, this.panelH, RADIUS)
      .fill({ color: 0x140508, alpha: 0.55 });
    this.bg
      .roundRect(0, 0, this.panelW, this.panelH, RADIUS)
      .stroke({ color: BORDER_COPPER, alpha: 1.0, width: 1 });
  }

  private drawDividers(): void {
    this.dividers.clear();
    // Mockup-paritet: `combo-col + combo-col { border-left: 1px solid #c98a3a }`.
    // Strekker dividerne fra topp til bunn (panel-høyden) for å matche
    // CSS sin border-left-strategi (full-høyde stroke).
    const x1 = PLAYER_COL_WIDTH;
    const x2 = PLAYER_COL_WIDTH + COL_DIVIDER_W + HOVEDSPILL_COL_W;
    const x3 = PLAYER_COL_WIDTH + COL_DIVIDER_W + HOVEDSPILL_COL_W + COL_DIVIDER_W + LYKKETALL_COL_W;
    for (const x of [x1, x2, x3]) {
      this.dividers
        .rect(x, 0, COL_DIVIDER_W, this.panelH)
        .fill({ color: BORDER_COPPER, alpha: 1.0 });
    }
  }

  private drawBuyButton(hover: boolean): void {
    // Mockup `.pill-btn`: transparent bg, 1px #c98a3a border, 6px radius,
    // hover = subtle copper-tinted bg `rgba(201,138,58,0.15)`.
    this.buyButtonBg.clear();
    this.buyButtonBg
      .roundRect(0, 0, PILL_W, PILL_H, PILL_RADIUS)
      .fill({ color: BORDER_COPPER, alpha: hover ? 0.15 : 0.0001 });
    this.buyButtonBg
      .roundRect(0, 0, PILL_W, PILL_H, PILL_RADIUS)
      .stroke({ color: BORDER_COPPER, alpha: 1.0, width: 1 });
  }

  /**
   * Last kløver-asset asynkront og plasser i Lykketall-kolonnen. Sentrert
   * horisontalt; vertikalt over labelen så hele blokken (kløver + label)
   * er midt-stilt i kolonnen.
   *
   * Tobias 2026-05-06 PR 2: label er nå multi-line "VELG\nLYKKETALL" med
   * 13px / lineHeight 16 → ~32px label-høyde. Block-høyde oppdatert
   * tilsvarende så blokken (kløver + label) er ekte vertikalt sentrert.
   */
  private async loadClover(): Promise<void> {
    // 13px font, lineHeight 16, 2 linjer ≈ 32px. Pluss 6px gap til kløver.
    const labelH = 32;
    const blockH = CLOVER_SIZE + 6 + labelH; // kløver + gap + label-h
    const blockTop = (this.panelH - blockH) / 2;
    try {
      const tex = (await Assets.load(CLOVER_URL)) as Texture;
      if (this.destroyed) return;
      const sprite = new Sprite(tex);
      sprite.width = CLOVER_SIZE;
      sprite.height = CLOVER_SIZE;
      sprite.anchor.set(0.5, 0);
      sprite.x = LYKKETALL_COL_W / 2;
      sprite.y = blockTop;
      this.lykketallCol.addChild(sprite);
      this.lykketallClover = sprite;
      // Re-posisjoner label i forhold til faktisk kløver-bunn.
      this.lykketallLabel.y = blockTop + CLOVER_SIZE + 6;
    } catch {
      if (this.destroyed) return;
      const fallback = new Graphics();
      fallback.x = LYKKETALL_COL_W / 2;
      fallback.y = blockTop + CLOVER_SIZE / 2;
      const r = CLOVER_SIZE * 0.27;
      fallback.circle(0, -r, r).fill({ color: 0x2f7a32 });
      fallback.circle(r, 0, r).fill({ color: 0x2f7a32 });
      fallback.circle(0, r, r).fill({ color: 0x2f7a32 });
      fallback.circle(-r, 0, r).fill({ color: 0x2f7a32 });
      fallback.circle(0, 0, r * 0.8).fill({ color: 0x4a9a4a });
      this.lykketallCol.addChild(fallback);
      this.lykketallClover = fallback;
      this.lykketallLabel.y = blockTop + CLOVER_SIZE + 6;
    }
  }
}
