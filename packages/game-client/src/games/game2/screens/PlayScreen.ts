/**
 * Spill 2 (Tallspill) — main gameplay screen for the Bong Mockup design
 * (`Bong Mockup.html`).
 *
 * Layout (top → bottom):
 *   1. ComboPanel: Lykketall + Hovedspill 1 + Jackpots (3 columns)
 *   2. BallTube:   countdown + draw-counter + drawn balls
 *   3. Bong-grid:  2×2 of BongCard (scaled 0.7 to fit)
 *
 * Bakgrunn rendres som `bong-bg.png` Sprite via `Assets.load`.
 *
 * Funksjonelt uendret kontrakt mot `Game2Controller`:
 *   - `setOnClaim`, `buildTickets`, `updateInfo`, `onNumberDrawn`,
 *     `onPatternWon`, `updateJackpot` — alle samme signatur som tidligere.
 *   - Ny: `setOnLuckyNumber` + `setOnChooseTickets` — i tidligere design
 *     ble disse håndtert av LobbyScreen, men i det nye designet er
 *     Lykketall-grid + "Kjøp flere brett" alltid synlig under spill.
 *   - Ny: `setOnClaim` aksepterer fortsatt LINE/BINGO men knappene er
 *     visuelt mindre framtredende — auto-claim fortsatt drevet av
 *     backend ved Fullt Hus (PR #855).
 *
 * 2026-05-03 (Agent E, branch feat/spill2-bong-mockup-design): full
 * rewrite for Bong Mockup-design. Tidligere PlayScreen brukte
 * TicketScroller + JackpotBar; det er erstattet med ny BallTube,
 * ComboPanel og en 2×2 BongCard-grid.
 */

import { Container, Graphics, Sprite, Text, Assets, type Texture } from "pixi.js";
import type { GameState } from "../../../bridge/GameBridge.js";
import type { PatternWonPayload } from "@spillorama/shared-types/socket-events";
import type { AudioManager } from "../../../audio/AudioManager.js";
import type { SpilloramaSocket } from "../../../net/SpilloramaSocket.js";
import { BongCard } from "../components/BongCard.js";
import { BallTube } from "../components/BallTube.js";
import { ComboPanel } from "../components/ComboPanel.js";
import type { JackpotSlotData } from "../components/JackpotsRow.js";
import { ClaimButton } from "../components/ClaimButton.js";
import { BuyPopup } from "../components/BuyPopup.js";
import { ChatPanel } from "../../../components/ChatPanel.js";
import { checkClaims } from "../logic/ClaimDetector.js";

const BG_URL = "/web/games/assets/game2/design/bong-bg.png";
const STAGE_PADDING_X = 32;
const STAGE_PADDING_TOP = 14;
const STAGE_PADDING_BOTTOM = 18;
const ROW_GAP = 14;
const MAX_STAGE_WIDTH = 1100;
const CHAT_WIDTH = 280;
const CHAT_MARGIN = 12;
/** Bong-grid scale matching `.grid-wrap > * { transform: scale(0.70) }`. */
const BONG_SCALE = 0.70;
const BONG_GAP_X = 20;
const BONG_GAP_Y = 8;

export class PlayScreen extends Container {
  private bgSprite: Sprite | null = null;
  private bgFallback: Graphics;
  private comboPanel: ComboPanel;
  private ballTube: BallTube;
  private bongs: BongCard[] = [];
  private bongGridContainer: Container;
  private chatPanel: ChatPanel | null = null;
  private lineBtn: ClaimButton;
  private bingoBtn: ClaimButton;
  private buyPopup: BuyPopup;
  private audio: AudioManager;
  private screenW: number;
  private screenH: number;
  private stageW: number;
  private stageX: number;
  private onClaim: ((type: "LINE" | "BINGO") => void) | null = null;
  private onLuckyNumber: ((n: number) => void) | null = null;
  private onChooseTickets: (() => void) | null = null;
  private onBuyForNextRound: ((count: number) => void) | null = null;
  private lineAlreadyWon = false;
  private bingoAlreadyWon = false;
  /** Nedtellings-driver — vi oppdaterer hvert sekund fra
   *  `state.millisUntilNextStart` og decreases lokalt mellom snapshots. */
  private countdownDeadline: number | null = null;
  private countdownInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    screenWidth: number,
    screenHeight: number,
    audio: AudioManager,
    socket?: SpilloramaSocket,
    roomCode?: string,
  ) {
    super();
    this.audio = audio;
    this.screenW = screenWidth;
    this.screenH = screenHeight;

    // ── stage-bredde + bakgrunn ──────────────────────────────────────────
    const chatEnabled = socket != null && roomCode != null;
    const chatRightEdge = screenWidth - CHAT_MARGIN;
    const chatLeftEdge = chatEnabled ? chatRightEdge - CHAT_WIDTH : screenWidth;
    const availableW = (chatEnabled ? chatLeftEdge - CHAT_MARGIN : screenWidth) - STAGE_PADDING_X * 2;
    this.stageW = Math.min(MAX_STAGE_WIDTH, Math.max(640, availableW));
    this.stageX = STAGE_PADDING_X + Math.max(0, (availableW - this.stageW) / 2);

    // Fallback-bakgrunn (mørk-rød) frem til PNG laster.
    this.bgFallback = new Graphics();
    this.bgFallback.rect(0, 0, screenWidth, screenHeight).fill({ color: 0x2a0d0e });
    this.addChild(this.bgFallback);
    void this.loadBackground();

    // ── combo-panel ──────────────────────────────────────────────────────
    this.comboPanel = new ComboPanel(this.stageW);
    this.comboPanel.x = this.stageX;
    this.comboPanel.y = STAGE_PADDING_TOP;
    this.comboPanel.setOnLuckyNumber((n) => this.onLuckyNumber?.(n));
    this.comboPanel.setOnBuyMore(() => this.onChooseTickets?.());
    this.addChild(this.comboPanel);

    // ── glass-tube (drawn balls + counter) ───────────────────────────────
    this.ballTube = new BallTube(this.stageW);
    this.ballTube.x = this.stageX;
    this.ballTube.y = this.comboPanel.y + this.comboPanel.height + ROW_GAP;
    this.addChild(this.ballTube);

    // ── bong-grid (2×2 BongCard) ─────────────────────────────────────────
    this.bongGridContainer = new Container();
    this.bongGridContainer.x = this.stageX;
    this.bongGridContainer.y = this.ballTube.y + 85 + ROW_GAP + 24;
    this.addChild(this.bongGridContainer);

    // ── chat-panel (valgfritt, hvis socket+roomCode er gitt) ─────────────
    if (chatEnabled) {
      const chatTop = STAGE_PADDING_TOP;
      const chatHeight = screenHeight - chatTop - STAGE_PADDING_BOTTOM;
      this.chatPanel = new ChatPanel(socket, roomCode, chatHeight);
      this.chatPanel.x = chatLeftEdge;
      this.chatPanel.y = chatTop;
      this.addChild(this.chatPanel);
    }

    // ── claim-knapper (LINE/BINGO) ──────────────────────────────────────
    // Beholdt for back-compat. Mindre framtredende enn før — sitter
    // nederst i midten, scoper kun klikk-input. Auto-claim på Fullt
    // Hus drives av backend (PR #855).
    this.lineBtn = new ClaimButton("LINE", 120, 42);
    this.lineBtn.x = screenWidth / 2 - 130;
    this.lineBtn.y = screenHeight - 56;
    this.lineBtn.setOnClaim((type) => this.onClaim?.(type));
    this.addChild(this.lineBtn);

    this.bingoBtn = new ClaimButton("BINGO", 120, 42);
    this.bingoBtn.x = screenWidth / 2 + 10;
    this.bingoBtn.y = screenHeight - 56;
    this.bingoBtn.setOnClaim((type) => this.onClaim?.(type));
    this.addChild(this.bingoBtn);

    // 2026-05-03 (Agent L): Mellom-runde buy-popup. Vises auto når
    // `state.millisUntilNextStart` <= 30 s mens forrige runde fortsatt
    // pågår (PLAYING/SPECTATING). Speiler Spill 1-flow der popup-en
    // åpner seg over selve play-screen rett før neste runde starter.
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

  /** Returner true hvis popup er synlig. Brukes av controller for trigger-gating. */
  isBuyPopupVisible(): boolean {
    return this.buyPopup.visible;
  }

  /** Bygg bong-kort fra game state. Erstatter forrige sett. */
  buildTickets(state: GameState): void {
    this.clearBongs();
    this.lineAlreadyWon = false;
    this.bingoAlreadyWon = false;
    this.comboPanel.setCurrentDrawCount(state.drawnNumbers.length);

    // Restore won-flags fra snapshot (late-joiner support).
    for (const result of state.patternResults) {
      if (result.isWon && result.claimType === "LINE") this.lineAlreadyWon = true;
      if (result.isWon && result.claimType === "BINGO") this.bingoAlreadyWon = true;
    }

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
    this.updateClaimButtons(state);
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
    this.updateClaimButtons(state);
  }

  /** Oppdater jackpot-prizer fra socket-event. */
  updateJackpot(list: JackpotSlotData[]): void {
    this.comboPanel.updateJackpots(list);
  }

  /** Pattern won broadcast — kalles fra controller. */
  onPatternWon(payload: PatternWonPayload): void {
    if (payload.claimType === "LINE") {
      this.lineAlreadyWon = true;
      this.lineBtn.reset();
    }
    if (payload.claimType === "BINGO") {
      this.bingoAlreadyWon = true;
      this.bingoBtn.reset();
    }
  }

  /** State-oppdatering (player count, prize pool osv.). */
  updateInfo(state: GameState): void {
    // Combo-panel viser ikke spillere/pot direkte — de kan vises i
    // jackpot-rad eller header senere. Her oppdaterer vi countdown +
    // lucky-number for å speile state-endringer fra serveren.
    if (state.myLuckyNumber != null) {
      this.comboPanel.setLuckyNumber(state.myLuckyNumber);
    }
    this.ballTube.setDrawCount(state.drawnNumbers.length, state.totalDrawCapacity);
    this.startCountdown(state.millisUntilNextStart);
  }

  /** Reset for next game. */
  reset(): void {
    this.clearBongs();
    this.ballTube.clear();
    this.lineBtn.reset();
    this.bingoBtn.reset();
    this.lineAlreadyWon = false;
    this.bingoAlreadyWon = false;
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

  private updateClaimButtons(state: GameState): void {
    const { canClaimLine, canClaimBingo } = checkClaims(
      state.myTickets,
      state.myMarks,
      state.drawnNumbers,
    );
    if (canClaimLine && !this.lineAlreadyWon) {
      this.lineBtn.setState("ready");
    }
    if (canClaimBingo && !this.bingoAlreadyWon) {
      this.bingoBtn.setState("ready");
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
      // Når PNG'en er på plass kan vi tillate fallback-rektangelet å
      // forbli som "letter-box"-fyll bak — la den stå.
    } catch {
      // Asset mangler — vi beholder fallback-fargen.
    }
  }
}
