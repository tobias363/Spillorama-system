/**
 * Spill 2 (Tallspill) — LobbyScreen i Bong Mockup v2-stil.
 *
 * Vises mellom runder (gameStatus !== RUNNING) når spilleren er i `LOBBY`-
 * fase. Bruker EKSAKT samme layout som `PlayScreen` (v2-design):
 *
 *   1. BallTube:   countdown + draw-counter + (tom) drawn-balls-rad
 *   2. Bong-grid:  (tom container; spilleren har ikke kjøpt brett ennå)
 *   3. ComboPanel: PlayerCard + Hovedspill + Lykketall + Jackpots
 *      (sticky-bottom)
 *
 * STRICT element-cleanup per Tobias-direktiv 2026-05-03:
 *   "Det er da kun disse elementene samt popup av kjøp av biletter
 *    som skal være synlig"
 *
 * → FJERNET fra v1-LobbyScreen:
 *   - `statusText` ("Venter på neste runde") — ikke i mockup
 *   - `ctaButton` ("Velg brett for neste runde") — ikke i mockup;
 *     "Kjøp flere brett"-pill i ComboPanel + BuyPopup overtar entry-
 *     punktet for ticket-kjøp
 *   - `luckyPicker` (modal LuckyNumberPicker) — ikke i mockup;
 *     LykketallGrid i ComboPanel håndterer alt lucky-number-valg
 *
 * → BEHOLDT (eksplisitt fra Tobias):
 *   - BuyPopup (kjøp av billetter)
 *
 * Kontrakt mot `Game2Controller` er BEVART (samme metoder + signaturer):
 *   - `setOnBuy(cb)` — fortsatt brukt av controller for `BuyPopup`-arm-bet.
 *   - `setOnLuckyNumber(cb)` — videresendt til ComboPanel.LykketallGrid.
 *   - `setOnChooseTickets(cb)` — kalles ved klikk på "Kjøp flere brett"-pill.
 *   - `update(state)` — oppdaterer countdown + jackpots + player-count.
 *   - `showBuyPopup(price)` / `hideBuyPopup()` — fortsatt tilgjengelig.
 *   - `updateJackpot(list)` — videresender til ComboPanel.
 *
 * 2026-05-03 (Agent S, branch feat/spill2-bong-mockup-v2): full
 * layout-rewrite for v2-design — speiler PlayScreen for konsistens.
 * STRICT cleanup av status-tekst + CTA-knapp + modal lucky-picker.
 */

import { Container, Graphics, Sprite, Assets, type Texture } from "pixi.js";
import type { GameState } from "../../../bridge/GameBridge.js";
import { BuyPopup } from "../components/BuyPopup.js";
import { ComboPanel } from "../components/ComboPanel.js";
import { BallTube } from "../components/BallTube.js";
import { LykketallPopup } from "../components/LykketallPopup.js";
import type { JackpotSlotData } from "../components/JackpotsRow.js";

const BG_URL = "/web/games/assets/game2/design/bong-bg.png";
const STAGE_PADDING_X = 32;
const STAGE_PADDING_TOP = 14;
const STAGE_PADDING_BOTTOM = 24;
const ROW_GAP = 14;
const MAX_STAGE_WIDTH = 1100;
const TUBE_HEIGHT = 85;

export class LobbyScreen extends Container {
  private bgSprite: Sprite | null = null;
  private bgFallback: Graphics;
  private comboPanel: ComboPanel;
  private ballTube: BallTube;
  private buyPopup: BuyPopup;
  // 2026-05-03 (Agent Y): popup som åpnes ved klikk på Lykketall-kolonnen
  // i ComboPanel. Erstatter inline LykketallGrid-flyt (samme som i
  // PlayScreen — speilet for konsistens mellom lobby og play-fase).
  private lykketallPopup: LykketallPopup;
  private currentLuckyNumber: number | null = null;
  private screenW: number;
  private screenH: number;
  private stageW: number;
  private stageX: number;
  private onBuy: ((count: number) => void) | null = null;
  private onLuckyNumber: ((number: number) => void) | null = null;
  /** Cached entryFee fra siste `update(state)` så `showBuyPopup` har korrekt
   *  pris uten å kreve state-arg fra controller-callbacken. */
  private lastEntryFee = 10;
  /**
   * Lokal countdown-driver — Speilingen i `BallTube` viser MM:SS, men vi
   * må selv tikke ned mellom snapshot-oppdateringer fra controller for å
   * unngå at displayet "fryser" på snapshot-verdien.
   */
  private countdownDeadline: number | null = null;
  private countdownInterval: ReturnType<typeof setInterval> | null = null;

  constructor(screenWidth: number, screenHeight: number) {
    super();
    this.screenW = screenWidth;
    this.screenH = screenHeight;

    // ── stage-bredde (full bredde — ingen chat) ──────────────────────────
    const availableW = screenWidth - STAGE_PADDING_X * 2;
    this.stageW = Math.min(MAX_STAGE_WIDTH, Math.max(640, availableW));
    this.stageX = STAGE_PADDING_X + Math.max(0, (availableW - this.stageW) / 2);

    // ── bakgrunn (samme pattern som PlayScreen) ──────────────────────────
    this.bgFallback = new Graphics();
    this.bgFallback.rect(0, 0, screenWidth, screenHeight).fill({ color: 0x2a0d0e });
    this.addChild(this.bgFallback);
    void this.loadBackground();

    // ── glass-tube (countdown + tom drawn-balls-rad) — ØVERST ────────────
    this.ballTube = new BallTube(this.stageW);
    this.ballTube.x = this.stageX;
    this.ballTube.y = STAGE_PADDING_TOP;
    this.addChild(this.ballTube);

    // ── (Bong-grid plass-holder — vi rendrer ingen bonger i lobby) ──────
    // Plassen mellom tube og combo-panel etterlates synlig bakgrunn.
    // Når spilleren kjøper brett og spillet starter overtas denne av
    // PlayScreen sin layout.

    // ── combo-panel — STICKY BOTTOM ──────────────────────────────────────
    this.comboPanel = new ComboPanel(this.stageW);
    this.comboPanel.x = this.stageX;
    this.comboPanel.y = screenHeight - STAGE_PADDING_BOTTOM - this.comboPanel.height;
    // setOnLuckyNumber er beholdt no-op for backward-compat; popup-flyt
    // tar over (klikk på Lykketall-kolonnen → popup → onLuckyNumber).
    this.comboPanel.setOnLuckyClick(() => this.lykketallPopup.show(this.currentLuckyNumber));
    // Tobias-direktiv 2026-05-04: "Kjøp flere brett"-pill åpner BuyPopup
    // direkte (samme flyt som PlayScreen). ChooseTicketsScreen-flyten er
    // fjernet — kun én popup-flyt for ticket-kjøp på tvers av faser.
    this.comboPanel.setOnBuyMore(() => this.showBuyPopup(this.lastEntryFee));
    this.addChild(this.comboPanel);

    // ── BuyPopup (eksplisitt beholdt per Tobias-direktiv) ────────────────
    // Plassert sentrert. Controller har kontroll over når den vises:
    // den åpnes via `showBuyPopup()` av Game2Controller når spilleren
    // entrer LOBBY uten armed bet.
    const popupW = 320;
    const popupH = 220;
    this.buyPopup = new BuyPopup(popupW, popupH);
    this.buyPopup.x = (screenWidth - popupW) / 2;
    this.buyPopup.y = (screenHeight - popupH) / 2;
    this.buyPopup.setOnBuy((count) => this.onBuy?.(count));
    this.addChild(this.buyPopup);

    // 2026-05-03 (Agent Y): lykketall-popup. Speiler PlayScreen — klikk
    // på Lykketall-kolonnen åpner popup-en, valg fyrer onLuckyNumber.
    this.lykketallPopup = new LykketallPopup(screenWidth, screenHeight);
    this.lykketallPopup.setOnPick((n) => {
      this.currentLuckyNumber = n;
      this.comboPanel.setLuckyNumber(n);
      this.onLuckyNumber?.(n);
    });
    this.addChild(this.lykketallPopup);

    // Start lokal countdown-tikker (1Hz). Stoppes i `destroy`.
    this.countdownInterval = setInterval(() => this.tickCountdown(), 1000);
  }

  setOnBuy(callback: (count: number) => void): void {
    this.onBuy = callback;
  }

  setOnLuckyNumber(callback: (number: number) => void): void {
    this.onLuckyNumber = callback;
  }

  /**
   * Hovedoppdatering fra controller. Speiler `state`-felter inn i
   * Combo-panel + BallTube.
   */
  update(state: GameState): void {
    // Cache entryFee så `showBuyPopup` har korrekt pris.
    if (state.entryFee != null && state.entryFee > 0) {
      this.lastEntryFee = state.entryFee;
    }
    // Lucky number — speilet til Combo-panel + lokal cache for popup-display.
    this.currentLuckyNumber = state.myLuckyNumber ?? null;
    this.comboPanel.setLuckyNumber(this.currentLuckyNumber);
    this.comboPanel.setCurrentDrawCount(state.drawnNumbers.length);
    this.comboPanel.setPlayerCount(state.playerCount ?? 0);

    // BallTube viser draw-counter selv om vi er i lobby — bruker
    // forrige rundes verdier hvis tilgjengelig.
    this.ballTube.setDrawCount(state.drawnNumbers.length, state.totalDrawCapacity);

    // Countdown — vises hvis vi har en `millisUntilNextStart`.
    if (state.millisUntilNextStart !== null && state.millisUntilNextStart > 0) {
      this.startCountdown(state.millisUntilNextStart);
    } else {
      this.startCountdown(null);
    }
  }

  /**
   * Oppdater jackpot-prizer fra `g2:jackpot:list-update`. Eksponert i
   * tilfelle controller velger å pushe også i lobby-fase (samme
   * signatur som `PlayScreen.updateJackpot`).
   */
  updateJackpot(list: JackpotSlotData[]): void {
    this.comboPanel.updateJackpots(list);
  }

  showBuyPopup(ticketPrice: number, maxTickets = 30): void {
    // LobbyScreen er by-definition mellom-runde (ikke RUNNING) — BuyPopup-
    // tittel skal være "Neste spill" (default). Eksplisitt `false` for
    // klarhet; speiler Spill 1's separasjon mellom WAITING-fase og
    // mid-RUNNING-forhåndskjøp.
    this.buyPopup.show(ticketPrice, maxTickets, false);
  }

  hideBuyPopup(): void {
    this.buyPopup.hide();
  }

  destroy(options?: Parameters<Container["destroy"]>[0]): void {
    if (this.countdownInterval !== null) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
    super.destroy(options);
  }

  // ── interne ─────────────────────────────────────────────────────────────

  private startCountdown(milliseconds: number | null): void {
    if (milliseconds == null || milliseconds <= 0) {
      this.countdownDeadline = null;
      this.ballTube.setCountdown(null);
      return;
    }
    this.countdownDeadline = Date.now() + milliseconds;
    this.ballTube.setCountdown(milliseconds);
  }

  private tickCountdown(): void {
    if (this.countdownDeadline == null) return;
    const remaining = this.countdownDeadline - Date.now();
    if (remaining <= 0) {
      this.countdownDeadline = null;
      this.ballTube.setCountdown(null);
      return;
    }
    this.ballTube.setCountdown(remaining);
  }

  private async loadBackground(): Promise<void> {
    try {
      const tex = (await Assets.load(BG_URL)) as Texture;
      if (this.destroyed) return;
      const sprite = new Sprite(tex);
      sprite.width = this.screenW;
      sprite.height = this.screenH;
      this.bgSprite = sprite;
      this.addChildAt(sprite, 1); // over fallback, under panels
    } catch {
      // Asset mangler — vi beholder fallback-fargen.
    }
  }
}
