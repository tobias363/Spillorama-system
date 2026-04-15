import { Container, Sprite, Assets } from "pixi.js";
import type { GameState } from "../../../bridge/GameBridge.js";
import type { PatternWonPayload, ChatMessage } from "@spillorama/shared-types/socket-events";
import type { AudioManager } from "../../../audio/AudioManager.js";
import type { SpilloramaSocket } from "../../../net/SpilloramaSocket.js";
import { BallTube } from "../components/BallTube.js";
import { HtmlOverlayManager } from "../components/HtmlOverlayManager.js";
import { LeftInfoPanel } from "../components/LeftInfoPanel.js";
import { CenterTopPanel } from "../components/CenterTopPanel.js";
import { ChatPanelV2 } from "../components/ChatPanelV2.js";
import { TicketOverlay } from "../components/TicketOverlay.js";
import { CalledNumbersOverlay } from "../components/CalledNumbersOverlay.js";
import { Game1BuyPopup } from "../components/Game1BuyPopup.js";
import { TicketScroller } from "../../game2/components/TicketScroller.js";
import { TicketCard } from "../../game2/components/TicketCard.js";
import { ClaimButton } from "../../game2/components/ClaimButton.js";
import { checkClaims } from "../../game2/logic/ClaimDetector.js";
import { getTicketThemeByName } from "../colors/TicketColorThemes.js";

const TUBE_COLUMN_WIDTH = 130;
const CHAT_WIDTH = 265;
/** Y position where the inline ticket scroller starts — just below the top HTML info panel. */
const TICKET_TOP = 170;

/**
 * Game 1 (Classic Bingo) play screen — Unity-matching layout.
 *
 * Handles both the waiting/lobby phase (countdown in number ring + buy popup)
 * and the active gameplay phase. This matches Unity's behaviour where
 * the gameplay panel is shown immediately — no separate lobby screen.
 *
 * Layout:
 * - BallTube (PixiJS, 130px left, full height) — vertical glass tube with drawn balls
 * - LeftInfoPanel (HTML) — player count, entry fee, prize pool, number ring
 * - CenterTopPanel (HTML) — game badge, prize rows, action buttons
 * - ChatPanelV2 (HTML, 265px right) — right sidebar chat
 * - Inline tickets (PixiJS, bottom half) — scrollable ticket cards
 * - CalledNumbersOverlay (HTML) — toggleable drawn numbers grid
 * - TicketOverlay (PixiJS) — toggleable fullscreen ticket view
 * - Game1BuyPopup (HTML) — Unity-matching ticket purchase popup
 */
export class PlayScreen extends Container {
  private ballTube: BallTube;
  private ticketOverlay: TicketOverlay;
  private calledNumbers: CalledNumbersOverlay;
  private overlayManager: HtmlOverlayManager;
  private leftInfo: LeftInfoPanel;
  private centerTop: CenterTopPanel;
  private chatPanel: ChatPanelV2;
  private audio: AudioManager;
  private onClaim: ((type: "LINE" | "BINGO") => void) | null = null;
  private onBuy: ((count: number) => void) | null = null;
  private bgSprite: Sprite | null = null;
  private screenW: number;
  private screenH: number;

  // Buy popup (Unity-matching ticket purchase)
  private buyPopup: Game1BuyPopup | null = null;

  // Callbacks (set by controller)
  private onLuckyNumberTap: (() => void) | null = null;
  private onCancelTickets: (() => void) | null = null;

  // Inline ticket display
  private inlineScroller: TicketScroller;
  private lineBtn: ClaimButton;
  private bingoBtn: ClaimButton;
  private lineAlreadyWon = false;
  private bingoAlreadyWon = false;
  private lastState: GameState | null = null;
  private isWaitingMode = false;

  constructor(
    screenWidth: number,
    screenHeight: number,
    audio: AudioManager,
    socket: SpilloramaSocket,
    roomCode: string,
    container: HTMLElement,
  ) {
    super();
    this.audio = audio;
    this.screenW = screenWidth;
    this.screenH = screenHeight;

    // Background image
    this.loadBackground(screenWidth, screenHeight);

    // ── PixiJS components ──

    // Ball tube (far left, full height from top to bottom)
    const tubeHeight = screenHeight - 16;
    this.ballTube = new BallTube(tubeHeight);
    this.ballTube.x = (TUBE_COLUMN_WIDTH - 96) / 2 + 10;
    this.ballTube.y = 8;
    this.addChild(this.ballTube);

    // Buy popup is created later as an HTML overlay (see below)

    // Inline ticket scroller — anchored from TICKET_TOP, fills to near the bottom
    const scrollerLeft = TUBE_COLUMN_WIDTH;
    const scrollerW = screenWidth - TUBE_COLUMN_WIDTH - CHAT_WIDTH - 20;
    const scrollerH = screenHeight - TICKET_TOP - 62; // Leave 62px for claim buttons
    this.inlineScroller = new TicketScroller(scrollerW, scrollerH);
    this.inlineScroller.x = scrollerLeft;
    this.inlineScroller.y = TICKET_TOP;
    this.addChild(this.inlineScroller);

    // Claim buttons (below tickets, pinned to bottom)
    const btnY = screenHeight - 55;
    const btnCenterX = scrollerLeft + scrollerW / 2;

    this.lineBtn = new ClaimButton("LINE", 130, 44);
    this.lineBtn.x = btnCenterX - 140;
    this.lineBtn.y = btnY;
    this.lineBtn.setOnClaim((type) => this.onClaim?.(type));
    this.addChild(this.lineBtn);

    this.bingoBtn = new ClaimButton("BINGO", 130, 44);
    this.bingoBtn.x = btnCenterX + 10;
    this.bingoBtn.y = btnY;
    this.bingoBtn.setOnClaim((type) => this.onClaim?.(type));
    this.addChild(this.bingoBtn);

    // Ticket overlay (initially hidden, on top of everything)
    this.ticketOverlay = new TicketOverlay(screenWidth, screenHeight);
    this.ticketOverlay.setOnClaim((type) => this.onClaim?.(type));
    this.addChild(this.ticketOverlay);

    // ── HTML overlay components ──
    this.overlayManager = new HtmlOverlayManager(container);

    // Make the overlay root a flex row to match mockup layout
    const root = this.overlayManager.getRoot();
    root.style.display = "flex";
    root.style.flexDirection = "row";

    // Spacer for ball tube column (PixiJS handles rendering)
    const tubeSpacer = document.createElement("div");
    tubeSpacer.style.cssText = `width:${TUBE_COLUMN_WIDTH}px;flex-shrink:0;pointer-events:none;`;
    root.appendChild(tubeSpacer);

    // Left info panel
    this.leftInfo = new LeftInfoPanel(this.overlayManager);

    // Called numbers overlay (fullscreen grid of drawn balls)
    this.calledNumbers = new CalledNumbersOverlay(this.overlayManager);

    // Game1 buy popup (HTML overlay — matches Unity's Game1TicketPurchasePanel)
    this.buyPopup = new Game1BuyPopup(this.overlayManager);
    this.buyPopup.setOnBuy(async () => {
      const result = await socket.armBet({ roomCode, armed: true });
      this.buyPopup?.showResult(result.ok, result.error?.message);
      if (result.ok) this.onBuy?.(1);
    });

    // Center top panel with action callbacks
    this.centerTop = new CenterTopPanel(this.overlayManager, {
      onShowCalledNumbers: () => {
        this.calledNumbers.toggle();
      },
      onPreBuy: () => {
        // Forhåndskjøp — open buy popup (same as Unity)
        const fee = this.lastState?.entryFee || 10;
        this.buyPopup?.show(fee);
      },
      onSelectLuckyNumber: () => {
        this.onLuckyNumberTap?.();
      },
      onBuyMoreTickets: () => {
        // Kjøp flere brett — open buy popup (same as Unity)
        const fee = this.lastState?.entryFee || 10;
        this.buyPopup?.show(fee);
      },
      onCancelTickets: () => {
        this.onCancelTickets?.();
      },
    });

    // Chat panel (right sidebar)
    this.chatPanel = new ChatPanelV2(this.overlayManager, socket, roomCode);
  }

  setOnClaim(callback: (type: "LINE" | "BINGO") => void): void {
    this.onClaim = callback;
  }

  setOnBuy(callback: (count: number) => void): void {
    this.onBuy = callback;
  }

  setOnLuckyNumberTap(callback: () => void): void {
    this.onLuckyNumberTap = callback;
  }

  /** Unity: delete button cancels tickets (disarms player). */
  setOnCancelTickets(callback: () => void): void {
    this.onCancelTickets = callback;
  }

  subscribeChatToBridge(
    onChat: (listener: (msg: ChatMessage) => void) => () => void,
  ): void {
    this.chatPanel.subscribeToBridge(onChat);
  }

  // ── Waiting/Lobby mode ──

  /**
   * Enter waiting mode — show countdown in number ring + buy popup.
   * This replaces the old separate LobbyScreen.
   *
   * Matches Unity's OnGameFinish_Spillorama() reset sequence:
   *   1. Stop all blink animations
   *   2. Reset ball panel
   *   3. Show countdown timer
   *   4. Enable buy button
   */
  enterWaitingMode(state: GameState): void {
    this.isWaitingMode = true;
    this.lastState = state;
    this.centerTop.setGameRunning(false);

    // Reset from previous game — clear ball tube and called numbers
    // (Unity: bingoBallPanelManager.Reset() + withdrawNumberHistoryPanel.Close())
    this.ballTube.clear();
    this.calledNumbers.clearNumbers();
    this.inlineScroller.clearCards();
    this.lineBtn.reset();
    this.bingoBtn.reset();
    this.lineAlreadyWon = false;
    this.bingoAlreadyWon = false;

    // Load existing drawn balls only when joining a game already in progress (spectator mode).
    if (state.gameStatus === "RUNNING" && state.drawnNumbers.length > 0) {
      this.ballTube.loadBalls(state.drawnNumbers);
      this.calledNumbers.setNumbers(state.drawnNumbers);
    }

    // Show countdown in number ring
    // (Unity: CountdownTimer_Spillorama() with scheduler.millisUntilNextStart)
    if (state.millisUntilNextStart !== null && state.millisUntilNextStart > 0) {
      this.leftInfo.startCountdown(state.millisUntilNextStart);
    } else {
      // Show "..." while waiting for scheduler data (Unity: Game_1_Timer_Txt.text = "...")
      this.leftInfo.stopCountdown();
    }

    // Show buy popup (Unity auto-opens purchase panel in lobby)
    this.buyPopup?.show(state.entryFee || 10);

    // Update info panels
    this.updateInfo(state);
  }

  /** Show ball in tube + audio during waiting/spectator mode (no tickets). */
  onSpectatorNumberDrawn(number: number, state: GameState): void {
    this.lastState = state;
    this.ballTube.addBall(number);
    this.calledNumbers.addNumber(number);
    this.audio.playNumber(number);
    this.updateInfo(state);
  }

  /** Update waiting mode state (e.g. new countdown, player count changes). */
  updateWaitingState(state: GameState): void {
    this.lastState = state;

    if (this.isWaitingMode) {
      if (state.millisUntilNextStart !== null && state.millisUntilNextStart > 0) {
        this.leftInfo.startCountdown(state.millisUntilNextStart);
      }
    }

    this.updateInfo(state);
  }

  /** Hide buy popup (called after successful purchase). */
  hideBuyPopup(): void {
    this.buyPopup?.hide();
  }

  // ── Play mode ──

  /** Build ticket grids and initialize all panels from game state. */
  buildTickets(state: GameState): void {
    this.isWaitingMode = false;
    this.lastState = state;
    this.centerTop.setGameRunning(true);
    this.lineAlreadyWon = false;
    this.bingoAlreadyWon = false;

    // Stop countdown and hide buy popup when entering play mode
    this.leftInfo.stopCountdown();
    this.buyPopup?.hide();

    for (const result of state.patternResults) {
      if (result.isWon && result.claimType === "LINE") this.lineAlreadyWon = true;
      if (result.isWon && result.claimType === "BINGO") this.bingoAlreadyWon = true;
    }

    // Build inline tickets with color from backend (falls back to cycling)
    this.inlineScroller.clearCards();
    for (let i = 0; i < state.myTickets.length; i++) {
      const theme = getTicketThemeByName(state.myTickets[i].color, i);
      const card = new TicketCard(i, {
        gridSize: "5x5",
        cardBg: theme.cardBg,
        headerBg: theme.headerBg,
        headerText: theme.headerText,
        toGoColor: theme.toGoColor,
        toGoCloseColor: theme.toGoCloseColor,
        cellColors: theme.cellColors,
      });
      card.loadTicket(state.myTickets[i]);

      if (state.myMarks[i]) {
        card.markNumbers(state.myMarks[i]);
      } else {
        for (const n of state.drawnNumbers) card.markNumber(n);
      }

      if (state.myLuckyNumber) card.highlightLuckyNumber(state.myLuckyNumber);
      this.inlineScroller.addCard(card);
    }
    this.inlineScroller.sortBestFirst();
    this.updateClaimButtons(state);

    // Also build tickets in the overlay (for zoomed view)
    this.ticketOverlay.buildTickets(state);

    // Load existing drawn balls
    if (state.drawnNumbers.length > 0) {
      this.ballTube.loadBalls(state.drawnNumbers);
      this.calledNumbers.setNumbers(state.drawnNumbers);
    }

    // Update patterns in center panel
    this.centerTop.updatePatterns(state.patterns, state.patternResults, state.prizePool);
  }

  onNumberDrawn(number: number, _drawIndex: number, state: GameState): void {
    this.lastState = state;

    // Ball tube — add animated ball
    this.ballTube.addBall(number);

    // Inline tickets — mark number on all cards
    this.inlineScroller.markNumberOnAll(number);
    this.inlineScroller.sortBestFirst();
    this.updateClaimButtons(state);

    // Ticket overlay — mark on cards
    this.ticketOverlay.onNumberDrawn(number, state);

    // Called numbers — add to grid
    this.calledNumbers.addNumber(number);

    // Audio
    this.audio.playNumber(number);

    // Update info panels
    this.updateInfo(state);
  }

  onPatternWon(payload: PatternWonPayload): void {
    const claimType = payload.claimType as "LINE" | "BINGO";
    if (claimType === "LINE") { this.lineAlreadyWon = true; this.lineBtn.reset(); }
    if (claimType === "BINGO") { this.bingoAlreadyWon = true; this.bingoBtn.reset(); }
    this.ticketOverlay.onPatternWon(claimType);
  }

  updateInfo(state: GameState): void {
    this.lastState = state;
    this.leftInfo.update(
      state.playerCount,
      state.entryFee,
      state.prizePool,
      state.lastDrawnNumber,
      state.drawCount,
      state.totalDrawCapacity,
    );
    this.chatPanel.updatePlayerCount(state.playerCount);
    this.centerTop.updatePatterns(state.patterns, state.patternResults, state.prizePool);
  }

  /** Expose inline ticket cards for external operations (e.g. lucky number highlighting). */
  getInlineCards(): import("../../game2/components/TicketCard.js").TicketCard[] {
    return this.inlineScroller.getCards();
  }

  reset(): void {
    this.ballTube.clear();
    this.inlineScroller.clearCards();
    this.lineBtn.reset();
    this.bingoBtn.reset();
    this.lineAlreadyWon = false;
    this.bingoAlreadyWon = false;
    this.ticketOverlay.hide();
    this.calledNumbers.hide();
  }

  resize(width: number, height: number): void {
    this.screenW = width;
    this.screenH = height;

    // Resize background
    if (this.bgSprite) {
      this.bgSprite.width = width;
      this.bgSprite.height = height;
    }
  }

  destroy(): void {
    this.leftInfo.stopCountdown();
    this.buyPopup?.destroy();
    this.calledNumbers.destroy();
    this.overlayManager.destroy();
    super.destroy({ children: true });
  }

  private updateClaimButtons(state: GameState): void {
    const { canClaimLine, canClaimBingo } = checkClaims(state.myTickets, state.myMarks, state.drawnNumbers);
    if (canClaimLine && !this.lineAlreadyWon) this.lineBtn.setState("ready");
    if (canClaimBingo && !this.bingoAlreadyWon) this.bingoBtn.setState("ready");
  }

  private async loadBackground(w: number, h: number): Promise<void> {
    try {
      const texture = await Assets.load("/web/games/assets/game1/bg-game1.png");
      this.bgSprite = new Sprite(texture);
      this.bgSprite.width = w;
      this.bgSprite.height = h;
      this.addChildAt(this.bgSprite, 0);
    } catch {
      // No background image — dark canvas fallback
    }
  }
}
