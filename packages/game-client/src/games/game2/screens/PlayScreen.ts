/**
 * Spill 2 (Tallspill) — main gameplay screen for Bong Mockup v2-design.
 *
 * Layout (top → bottom) per `Bong Mockup.html` v2:
 *   1. BallTube:   countdown + draw-counter + drawn balls (12 visible)
 *   2. Bong-grid:  2×2 of BongCard (scaled 0.7 to fit)
 *   3. ComboPanel: PlayerCard + Hovedspill 1 + Lykketall + Jackpots
 *      — sticky-bottom (matcher CSS `.panel-row { margin-top: auto }`)
 *
 * STRICT element-cleanup per Tobias-direktiv 2026-05-03:
 *   "Det er da kun disse elementene samt popup av kjøp av biletter
 *    som skal være synlig"
 *
 * → FJERNET fra v1:
 *   - LINE/BINGO claim-knapper (ikke i mockup; auto-claim på Fullt Hus
 *     drives av backend per PR #855)
 *   - ChatPanel (ikke i mockup; chat var en lokal addition i v1)
 *
 * → BEHOLDT (eksplisitt fra Tobias):
 *   - BuyPopup (mellom-runde kjøp)
 *
 * Bakgrunn rendres som `bong-bg.png` Sprite via `Assets.load`.
 *
 * Funksjonelt uendret kontrakt mot `Game2Controller`:
 *   - `setOnClaim` BEVART (kalles fortsatt fra controller, men no-op
 *     siden knappene er fjernet — auto-claim håndterer alt)
 *   - `setOnLuckyNumber`, `setOnChooseTickets`, `setOnBuyForNextRound`
 *   - `buildTickets`, `updateInfo`, `onNumberDrawn`, `onPatternWon`,
 *     `updateJackpot`, `showBuyPopupForNextRound`, `hideBuyPopupForNextRound`,
 *     `isBuyPopupVisible`, `reset`
 *
 * 2026-05-03 (Agent S, branch feat/spill2-bong-mockup-v2): full layout-
 * rewrite for v2-design — tube først, bongs midt, combo-panel sticky-
 * bottom. STRICT cleanup av claim-knapper + chat-panel.
 */

import { Container, Graphics, Sprite, Assets, type Texture } from "pixi.js";
import type { GameState } from "../../../bridge/GameBridge.js";
import type { PatternWonPayload } from "@spillorama/shared-types/socket-events";
import type { AudioManager } from "../../../audio/AudioManager.js";
import type { SpilloramaSocket } from "../../../net/SpilloramaSocket.js";
import { BongCard } from "../components/BongCard.js";
import { BallTube } from "../components/BallTube.js";
import { ComboPanel } from "../components/ComboPanel.js";
import type { JackpotSlotData } from "../components/JackpotsRow.js";
import { BuyPopup } from "../components/BuyPopup.js";

const BG_URL = "/web/games/assets/game2/design/bong-bg.png";
const STAGE_PADDING_X = 32;
const STAGE_PADDING_TOP = 14;
const STAGE_PADDING_BOTTOM = 24;
const ROW_GAP = 14;
const MAX_STAGE_WIDTH = 1100;
/** Bong-grid scale matching `.grid-wrap > * { transform: scale(0.70) }`. */
const BONG_SCALE = 0.70;
const BONG_GAP_X = 20;
const BONG_GAP_Y = 8;
/** Tube-høyde må matche `BallTube` sin interne TUBE_HEIGHT for layout. */
const TUBE_HEIGHT = 85;

export class PlayScreen extends Container {
  private bgSprite: Sprite | null = null;
  private bgFallback: Graphics;
  private comboPanel: ComboPanel;
  private ballTube: BallTube;
  private bongs: BongCard[] = [];
  private bongGridContainer: Container;
  private buyPopup: BuyPopup;
  private audio: AudioManager;
  private screenW: number;
  private screenH: number;
  private stageW: number;
  private stageX: number;
  // Claim-callback bevart for kontrakt med Game2Controller, men knappene
  // er fjernet i v2. Auto-claim på Fullt Hus drives av backend (PR #855).
  private onClaim: ((type: "LINE" | "BINGO") => void) | null = null;
  private onLuckyNumber: ((n: number) => void) | null = null;
  private onChooseTickets: (() => void) | null = null;
  private onBuyForNextRound: ((count: number) => void) | null = null;
  /** Siste kjente entryFee fra state — brukes av `openBuyPopupModal` så
   *  popup viser korrekt billettpris uavhengig av når brukeren klikker. */
  private currentEntryFee = 20;
  /** Nedtellings-driver — vi oppdaterer hvert sekund fra
   *  `state.millisUntilNextStart` og decreases lokalt mellom snapshots. */
  private countdownDeadline: number | null = null;
  private countdownInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    screenWidth: number,
    screenHeight: number,
    audio: AudioManager,
    _socket?: SpilloramaSocket,
    _roomCode?: string,
  ) {
    super();
    this.audio = audio;
    this.screenW = screenWidth;
    this.screenH = screenHeight;

    // ── stage-bredde (uten chat, full bredde) ────────────────────────────
    // STRICT-cleanup per Tobias 2026-05-03: chat er fjernet fra v2-design.
    // socket/roomCode-args er bevart for kontrakt-kompatibilitet med
    // Game2Controller, men de brukes ikke lenger til å mounte ChatPanel.
    const availableW = screenWidth - STAGE_PADDING_X * 2;
    this.stageW = Math.min(MAX_STAGE_WIDTH, Math.max(640, availableW));
    this.stageX = STAGE_PADDING_X + Math.max(0, (availableW - this.stageW) / 2);

    // Fallback-bakgrunn (mørk-rød) frem til PNG laster.
    this.bgFallback = new Graphics();
    this.bgFallback.rect(0, 0, screenWidth, screenHeight).fill({ color: 0x2a0d0e });
    this.addChild(this.bgFallback);
    void this.loadBackground();

    // ── glass-tube (drawn balls + counter) — ØVERST i v2 ────────────────
    this.ballTube = new BallTube(this.stageW);
    this.ballTube.x = this.stageX;
    this.ballTube.y = STAGE_PADDING_TOP;
    this.addChild(this.ballTube);

    // ── bong-grid (2×2 BongCard) — MIDTEN ────────────────────────────────
    this.bongGridContainer = new Container();
    this.bongGridContainer.x = this.stageX;
    this.bongGridContainer.y = this.ballTube.y + TUBE_HEIGHT + ROW_GAP + 24;
    this.addChild(this.bongGridContainer);

    // ── combo-panel — STICKY BOTTOM (matcher CSS margin-top: auto) ──────
    this.comboPanel = new ComboPanel(this.stageW);
    this.comboPanel.x = this.stageX;
    // Foreløpig posisjon — settes endelig i `positionComboPanelBottom`
    // etter at vi vet panel-høyden.
    this.comboPanel.y = screenHeight - STAGE_PADDING_BOTTOM - this.comboPanel.height;
    this.comboPanel.setOnLuckyNumber((n) => this.onLuckyNumber?.(n));
    // 2026-05-03 (Agent T, fix/spill2-pixel-match-design-v2): "Kjøp flere
    // brett"-pill i Hovedspill-kolonnen åpner nå BuyPopup som modal
    // overlay i stedet for å navigere til ChooseTicketsScreen. Per
    // Tobias-direktiv: BuyPopup skal kun vises ved eksplisitt klikk.
    this.comboPanel.setOnBuyMore(() => this.openBuyPopupModal());
    this.addChild(this.comboPanel);

    // 2026-05-03 (Agent S, v2): mellom-runde buy-popup. Vises auto når
    // `state.millisUntilNextStart` <= 30 s mens forrige runde fortsatt
    // pågår (PLAYING/SPECTATING). Eksplisitt beholdt per Tobias-direktiv:
    // "kun disse elementene samt popup av kjøp av biletter".
    const popupW = 320;
    const popupH = 220;
    this.buyPopup = new BuyPopup(popupW, popupH);
    this.buyPopup.x = (screenWidth - popupW) / 2;
    this.buyPopup.y = (screenHeight - popupH) / 2;
    this.buyPopup.setOnBuy((count) => this.onBuyForNextRound?.(count));
    this.addChild(this.buyPopup);

    // Start lokal countdown-tikker (1Hz). Stoppes i `destroy`.
    this.countdownInterval = setInterval(() => this.tickCountdown(), 1000);
  }

  /**
   * Bevart for kontrakt-kompatibilitet med `Game2Controller`. Ingen UI-
   * elementer er knyttet til claim i v2 — auto-claim på Fullt Hus
   * håndteres av backend (PR #855).
   */
  setOnClaim(cb: (type: "LINE" | "BINGO") => void): void {
    this.onClaim = cb;
  }

  /** Sett callback for klikk i Lykketall-grid. */
  setOnLuckyNumber(cb: (n: number) => void): void {
    this.onLuckyNumber = cb;
  }

  /** Sett callback for "Kjøp flere brett"-pill. */
  setOnChooseTickets(cb: () => void): void {
    this.onChooseTickets = cb;
  }

  /**
   * Sett callback for mellom-runde buy-popup-kjøp. Kalles når spilleren
   * trykker "Kjøp" i popup-en — controller skal armBet for neste runde.
   */
  setOnBuyForNextRound(cb: (count: number) => void): void {
    this.onBuyForNextRound = cb;
  }

  /**
   * Vis mellom-runde buy-popup. Idempotent — gjør ingenting hvis allerede
   * synlig. Brukes av Game2Controller når countdown < 30 s og spilleren
   * ikke allerede har armed for neste runde.
   */
  showBuyPopupForNextRound(ticketPrice: number, maxTickets = 30): void {
    if (this.buyPopup.visible) return;
    this.buyPopup.show(ticketPrice, maxTickets);
  }

  /** Skjul mellom-runde buy-popup. Idempotent. */
  hideBuyPopupForNextRound(): void {
    if (!this.buyPopup.visible) return;
    this.buyPopup.hide();
  }

  /**
   * 2026-05-03 (Agent T, fix/spill2-pixel-match-design-v2): åpne
   * BuyPopup som modal overlay når brukeren klikker "Kjøp flere brett"
   * i Hovedspill-kolonnen i ComboPanel. Bruker siste kjente entryFee
   * fra `currentEntryFee` så popup viser korrekt billettpris.
   */
  private openBuyPopupModal(): void {
    this.showBuyPopupForNextRound(this.currentEntryFee);
  }

  /** Returner true hvis popup er synlig. Brukes av controller for trigger-gating. */
  isBuyPopupVisible(): boolean {
    return this.buyPopup.visible;
  }

  /** Bygg bong-kort fra game state. Erstatter forrige sett. */
  buildTickets(state: GameState): void {
    this.clearBongs();
    if (state.entryFee != null && state.entryFee > 0) {
      this.currentEntryFee = state.entryFee;
    }
    this.comboPanel.setCurrentDrawCount(state.drawnNumbers.length);
    this.comboPanel.setPlayerCount(state.playerCount ?? 0);

    for (let i = 0; i < state.myTickets.length; i++) {
      const ticket = state.myTickets[i];
      const card = new BongCard({
        colorKey: "yellow", // Spill 2 har kun én ticket-type per PR #856.
        label: ticket.color ?? `Brett ${i + 1}`,
        price: ticket.price ?? state.entryFee ?? 20,
      });
      const initialMarks = state.myMarks[i] ?? state.drawnNumbers;
      card.loadTicket(ticket, initialMarks);
      this.bongs.push(card);
      this.bongGridContainer.addChild(card);
    }

    // Last lucky-number til Lykketall-grid (for late-joiner).
    if (state.myLuckyNumber != null) {
      this.comboPanel.setLuckyNumber(state.myLuckyNumber);
    } else {
      this.comboPanel.setLuckyNumber(null);
    }

    // Last alle drawn-balls inn i tuben (snapshot-restore).
    this.ballTube.loadBalls(state.drawnNumbers);
    this.ballTube.setDrawCount(state.drawnNumbers.length, state.totalDrawCapacity);
    this.startCountdown(state.millisUntilNextStart);

    this.layoutBongGrid();
  }

  /** Håndter ny trukket ball (fra `numberDrawn`-event). */
  onNumberDrawn(number: number, _drawIndex: number, state: GameState): void {
    for (const card of this.bongs) {
      card.markNumber(number);
    }
    this.ballTube.addBall(number);
    this.ballTube.setDrawCount(state.drawnNumbers.length, state.totalDrawCapacity);
    this.comboPanel.setCurrentDrawCount(state.drawnNumbers.length);
    this.audio.playNumber(number);
    this.startCountdown(state.millisUntilNextStart);
  }

  /** Oppdater jackpot-prizer fra socket-event. */
  updateJackpot(list: JackpotSlotData[]): void {
    this.comboPanel.updateJackpots(list);
  }

  /**
   * Pattern won broadcast — kalles fra controller. v2 har ingen
   * claim-knapper å resette; metoden beholdes som no-op for
   * kontrakt-kompatibilitet og logging-formål.
   */
  onPatternWon(_payload: PatternWonPayload): void {
    // No-op i v2 — auto-claim på Fullt Hus håndteres av backend.
  }

  /** State-oppdatering (player count, prize pool osv.). */
  updateInfo(state: GameState): void {
    if (state.myLuckyNumber != null) {
      this.comboPanel.setLuckyNumber(state.myLuckyNumber);
    }
    if (state.entryFee != null && state.entryFee > 0) {
      this.currentEntryFee = state.entryFee;
    }
    this.comboPanel.setPlayerCount(state.playerCount ?? 0);
    this.ballTube.setDrawCount(state.drawnNumbers.length, state.totalDrawCapacity);
    this.startCountdown(state.millisUntilNextStart);
  }

  /** Reset for next game. */
  reset(): void {
    this.clearBongs();
    this.ballTube.clear();
    this.countdownDeadline = null;
    this.ballTube.setCountdown(null);
  }

  destroy(options?: Parameters<Container["destroy"]>[0]): void {
    if (this.countdownInterval !== null) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
    this.clearBongs();
    super.destroy(options);
  }

  // ── interne ─────────────────────────────────────────────────────────────

  private clearBongs(): void {
    for (const card of this.bongs) {
      card.stopAllAnimations();
      card.destroy();
    }
    this.bongs = [];
    this.bongGridContainer.removeChildren();
  }

  /**
   * Layout 4 (eller flere) BongCards i et 2-kolonne-grid med scale 0.70,
   * matching `.grid-wrap` fra HTML-mockupen. Kortene rendres i naturlig
   * størrelse og bruker `scale.set(0.70)` så posisjoneringen blir
   * forutsigbar.
   */
  private layoutBongGrid(): void {
    if (this.bongs.length === 0) return;
    // Kort-bredde og høyde i naturlig størrelse (vi spør første kort).
    const naturalW = this.bongs[0].cardWidth;
    const naturalH = this.bongs[0].cardHeight;
    const scaledW = naturalW * BONG_SCALE;
    const scaledH = naturalH * BONG_SCALE;
    const cols = 2;
    const rowW = cols * scaledW + (cols - 1) * BONG_GAP_X;
    const startX = Math.max(0, (this.stageW - rowW) / 2);

    for (let i = 0; i < this.bongs.length; i++) {
      const card = this.bongs[i];
      card.scale.set(BONG_SCALE);
      const col = i % cols;
      const row = Math.floor(i / cols);
      card.x = startX + col * (scaledW + BONG_GAP_X);
      card.y = row * (scaledH + BONG_GAP_Y);
    }
  }

  /**
   * Sett ny countdown-deadline. Tikker ned hvert sekund via `tickCountdown`.
   * `null`/0 viser "—:—".
   */
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
