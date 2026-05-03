/**
 * Spill 2 (Tallspill) — LobbyScreen i Bong Mockup-stil.
 *
 * Vises mellom runder (gameStatus !== RUNNING) når spilleren er i `LOBBY`-
 * fase. Tidligere (PR #850/#852) brukte denne en enkel "Kjøp billetter for
 * å delta"-design med gult Arial-tekst. Etter PR #862 (Bong Mockup) bytter
 * vi til samme visuelle språk som PlayScreen:
 *
 *   - `bong-bg.png` Sprite + mørk-rød fallback (#2a0d0e)
 *   - ComboPanel øverst (Lykketall + Hovedspill 1 + Jackpots)
 *   - BallTube sentrert med "Neste trekning" countdown
 *   - Stor sentrert CTA "Velg brett for neste runde"
 *
 * Kontrakt mot `Game2Controller` er BEVART (samme metoder + samme
 * signaturer):
 *   - `setOnBuy(cb)` — fortsatt brukt av controller for `BuyPopup`-arm-bet.
 *   - `setOnLuckyNumber(cb)` — videresendt til ComboPanel.LykketallGrid.
 *   - `setOnChooseTickets(cb)` — kalles ved klikk på CTA-en eller "Kjøp
 *     flere brett"-pill i ComboPanel.
 *   - `update(state)` — oppdaterer countdown + status-tekst + jackpot-bar.
 *   - `showBuyPopup(price)` / `hideBuyPopup()` — fortsatt tilgjengelig
 *     (Game2Controller kaller `showBuyPopup` i transitionTo("LOBBY")).
 *
 * 2026-05-03 (Agent N, branch feat/spill2-lobbyscreen-redesign): redesign
 * for å matche PR #862 Bong Mockup. Gjenbruker eksisterende
 * `ComboPanel`/`BallTube`/`BuyPopup`/`LuckyNumberPicker` — ingen nye
 * komponenter skrives.
 */

import { Container, Graphics, Sprite, Text, Assets, type Texture } from "pixi.js";
import type { GameState } from "../../../bridge/GameBridge.js";
import { BuyPopup } from "../components/BuyPopup.js";
import { LuckyNumberPicker } from "../components/LuckyNumberPicker.js";
import { ComboPanel } from "../components/ComboPanel.js";
import { BallTube } from "../components/BallTube.js";
import type { JackpotSlotData } from "../components/JackpotsRow.js";

const BG_URL = "/web/games/assets/game2/design/bong-bg.png";
const STAGE_PADDING_X = 32;
const STAGE_PADDING_TOP = 14;
const ROW_GAP = 14;
const MAX_STAGE_WIDTH = 1100;

export class LobbyScreen extends Container {
  private bgSprite: Sprite | null = null;
  private bgFallback: Graphics;
  private comboPanel: ComboPanel;
  private ballTube: BallTube;
  private statusText: Text;
  private ctaButton: Container;
  private ctaButtonBg: Graphics;
  private buyPopup: BuyPopup;
  private luckyPicker: LuckyNumberPicker;
  private screenW: number;
  private screenH: number;
  private stageW: number;
  private stageX: number;
  private onBuy: ((count: number) => void) | null = null;
  private onLuckyNumber: ((number: number) => void) | null = null;
  private onChooseTickets: (() => void) | null = null;
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

    // ── stage-bredde ─────────────────────────────────────────────────────
    // Lobby har ikke chat-panel, så vi bruker hele bredden minus padding
    // (cap'et til MAX_STAGE_WIDTH). Matcher PlayScreen sin oppførsel når
    // chat er av.
    const availableW = screenWidth - STAGE_PADDING_X * 2;
    this.stageW = Math.min(MAX_STAGE_WIDTH, Math.max(640, availableW));
    this.stageX = STAGE_PADDING_X + Math.max(0, (availableW - this.stageW) / 2);

    // ── bakgrunn ─────────────────────────────────────────────────────────
    // Fallback-bakgrunn (mørk-rød) frem til PNG laster — identisk pattern
    // som PlayScreen.
    this.bgFallback = new Graphics();
    this.bgFallback.rect(0, 0, screenWidth, screenHeight).fill({ color: 0x2a0d0e });
    this.addChild(this.bgFallback);
    void this.loadBackground();

    // ── combo-panel (Lykketall + Hovedspill + Jackpots) ─────────────────
    this.comboPanel = new ComboPanel(this.stageW);
    this.comboPanel.x = this.stageX;
    this.comboPanel.y = STAGE_PADDING_TOP;
    this.comboPanel.setOnLuckyNumber((n) => this.onLuckyNumber?.(n));
    // "Kjøp flere brett"-pill i ComboPanel går rett til Choose Tickets-
    // skjermen — samme oppførsel som i PlayScreen.
    this.comboPanel.setOnBuyMore(() => this.onChooseTickets?.());
    this.addChild(this.comboPanel);

    // ── glass-tube med countdown ────────────────────────────────────────
    this.ballTube = new BallTube(this.stageW);
    this.ballTube.x = this.stageX;
    this.ballTube.y = this.comboPanel.y + this.comboPanel.height + ROW_GAP;
    this.addChild(this.ballTube);

    // ── status-tekst ("Venter på neste runde") ───────────────────────────
    // Plasseres rett under ball-tuben. Cinzel-fonten matcher hovedstilen
    // i Bong Mockup; faller tilbake til serif hvis Cinzel ikke er lastet.
    this.statusText = new Text({
      text: "Venter på neste runde",
      style: {
        fontFamily: "Cinzel, Georgia, serif",
        fontSize: 28,
        fontWeight: "600",
        fill: 0xffd97a,
        align: "center",
        letterSpacing: 1.2,
      },
    });
    this.statusText.anchor.set(0.5, 0);
    this.statusText.x = screenWidth / 2;
    this.statusText.y = this.ballTube.y + 85 + 24;
    this.addChild(this.statusText);

    // ── stor sentrert CTA-knapp ──────────────────────────────────────────
    // Pill-stil identisk med ComboPanel sin "Kjøp flere brett" — bare
    // større og prominent for hovedhandlingen i lobby-skjermen.
    const CTA_W = 320;
    const CTA_H = 64;
    this.ctaButton = new Container();
    this.ctaButton.x = (screenWidth - CTA_W) / 2;
    this.ctaButton.y = this.statusText.y + 60;
    this.ctaButton.eventMode = "static";
    this.ctaButton.cursor = "pointer";

    this.ctaButtonBg = new Graphics();
    this.drawCtaButton(false);
    this.ctaButton.addChild(this.ctaButtonBg);

    const ctaLabel = new Text({
      text: "Velg brett for neste runde",
      style: {
        fontFamily: "Inter, system-ui, Helvetica, sans-serif",
        fontSize: 18,
        fontWeight: "700",
        fill: 0xffffff,
        align: "center",
      },
    });
    ctaLabel.anchor.set(0.5);
    ctaLabel.x = CTA_W / 2;
    ctaLabel.y = CTA_H / 2;
    this.ctaButton.addChild(ctaLabel);

    this.ctaButton.on("pointerover", () => this.drawCtaButton(true));
    this.ctaButton.on("pointerout", () => this.drawCtaButton(false));
    this.ctaButton.on("pointerdown", () => this.onChooseTickets?.());
    this.addChild(this.ctaButton);

    // ── BuyPopup (modal overlay) ─────────────────────────────────────────
    // Beholdt for at controller-API skal være uendret. Vises av
    // `Game2Controller.transitionTo("LOBBY")` via `showBuyPopup()`.
    // Plasseres sentrert nederst.
    this.buyPopup = new BuyPopup(320, 220);
    this.buyPopup.x = (screenWidth - 320) / 2;
    this.buyPopup.y = screenHeight - 260;
    this.buyPopup.setOnBuy((count) => this.onBuy?.(count));
    this.addChild(this.buyPopup);

    // ── LuckyNumberPicker (modal overlay) ────────────────────────────────
    // Bevart selv om ComboPanel sin LykketallGrid normalt brukes — gir
    // controller en fallback-flyt + støtter eksisterende kall til
    // `setOnLuckyNumber`.
    this.luckyPicker = new LuckyNumberPicker(screenWidth, screenHeight);
    this.luckyPicker.setOnSelect((n) => this.onLuckyNumber?.(n));
    this.addChild(this.luckyPicker);

    // Start lokal countdown-tikker (1Hz). Stoppes i `destroy`.
    this.countdownInterval = setInterval(() => this.tickCountdown(), 1000);
  }

  setOnBuy(callback: (count: number) => void): void {
    this.onBuy = callback;
  }

  setOnLuckyNumber(callback: (number: number) => void): void {
    this.onLuckyNumber = callback;
  }

  setOnChooseTickets(callback: () => void): void {
    this.onChooseTickets = callback;
  }

  /**
   * Hovedoppdatering fra controller. Speiler `state`-felter inn i
   * Combo-panel + BallTube + status-tekst.
   */
  update(state: GameState): void {
    // Lucky number — speilet til Combo-panel.
    if (state.myLuckyNumber != null) {
      this.comboPanel.setLuckyNumber(state.myLuckyNumber);
    } else {
      this.comboPanel.setLuckyNumber(null);
    }
    this.comboPanel.setCurrentDrawCount(state.drawnNumbers.length);

    // BallTube viser draw-counter selv om vi er i lobby — bruker
    // forrige rundes verdier hvis tilgjengelig.
    this.ballTube.setDrawCount(state.drawnNumbers.length, state.totalDrawCapacity);

    // Status-tekst + countdown.
    if (state.gameStatus === "RUNNING") {
      this.statusText.text = "Spill pågår — kjøp brett til neste runde";
      this.startCountdown(null);
    } else if (state.millisUntilNextStart !== null && state.millisUntilNextStart > 0) {
      this.statusText.text = "Venter på neste runde";
      this.startCountdown(state.millisUntilNextStart);
    } else {
      this.statusText.text = "Venter på neste runde";
      this.startCountdown(null);
    }
  }

  /**
   * Oppdater jackpot-prizer fra `g2:jackpot:list-update`. Eksponert i tilfelle
   * controller velger å pushe også i lobby-fase (samme signatur som
   * `PlayScreen.updateJackpot`).
   */
  updateJackpot(list: JackpotSlotData[]): void {
    this.comboPanel.updateJackpots(list);
  }

  showBuyPopup(ticketPrice: number, maxTickets = 30): void {
    this.buyPopup.show(ticketPrice, maxTickets);
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

  private drawCtaButton(hover: boolean): void {
    const W = 320;
    const H = 64;
    const RADIUS = 32;
    this.ctaButtonBg.clear();
    // Pill-stil matchende ComboPanel sin "Kjøp flere brett"-pill, men
    // høyere alpha/intensitet for å løfte den fram som hoved-CTA.
    this.ctaButtonBg
      .roundRect(0, 0, W, H, RADIUS)
      .fill({ color: hover ? 0x9a2228 : 0x781e24, alpha: hover ? 0.95 : 0.85 });
    this.ctaButtonBg
      .roundRect(0, 0, W, H, RADIUS)
      .stroke({ color: 0xffffff, alpha: 0.55, width: 1.5 });
    // Indre highlight (matcher CSS `inset 0 1px 0 rgba(255,255,255,.18)`).
    this.ctaButtonBg
      .roundRect(2, 2, W - 4, 2, 1)
      .fill({ color: 0xffffff, alpha: 0.18 });
  }

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
