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
import { TicketGridScroller } from "../components/TicketGridScroller.js";
import { CenterBall } from "../components/CenterBall.js";
import { TicketCard } from "../../game2/components/TicketCard.js";
import { ClaimButton } from "../../game2/components/ClaimButton.js";
import { checkClaims } from "../../game2/logic/ClaimDetector.js";
import { getTicketThemeByName } from "../colors/TicketColorThemes.js";
import { stakeFromState } from "../logic/StakeCalculator.js";

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
  private onBuy: ((selections: Array<{ type: string; qty: number }>) => void) | null = null;
  private bgSprite: Sprite | null = null;
  private screenW: number;
  private screenH: number;

  // CenterBall (Unity-matching animated bingo ball in center area)
  private centerBall: CenterBall;

  // Buy popup (Unity-matching ticket purchase)
  private buyPopup: Game1BuyPopup | null = null;

  // Callbacks (set by controller)
  private onLuckyNumberTap: (() => void) | null = null;
  private onCancelTickets: (() => void) | null = null;
  private onOpenSettings: (() => void) | null = null;
  private onOpenMarkerBg: (() => void) | null = null;
  /** A6: Host manual start callback. */
  private onStartGame: (() => void) | null = null;

  // Inline ticket display (vertical multi-column grid, matching Unity GridLayoutGroup)
  private inlineScroller: TicketGridScroller;
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

    // Center ball (Unity: large animated ball showing last drawn number / countdown)
    this.centerBall = new CenterBall();
    this.centerBall.x = TUBE_COLUMN_WIDTH + (screenWidth - TUBE_COLUMN_WIDTH - CHAT_WIDTH) / 2 - 60;
    this.centerBall.y = 20;
    this.addChild(this.centerBall);
    this.centerBall.showWaiting();

    // Inline ticket scroller — vertical multi-column grid (Unity GridLayoutGroup)
    const scrollerLeft = TUBE_COLUMN_WIDTH;
    const scrollerW = screenWidth - TUBE_COLUMN_WIDTH - CHAT_WIDTH - 20;
    const scrollerH = screenHeight - TICKET_TOP - 62; // Leave 62px for claim buttons
    this.inlineScroller = new TicketGridScroller(scrollerW, scrollerH);
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
    // Delegate buy to controller — no direct socket call from view layer.
    this.buyPopup.setOnBuy((selections: Array<{ type: string; qty: number }>) => {
      this.onBuy?.(selections);
    });

    // Center top panel with action callbacks
    this.centerTop = new CenterTopPanel(this.overlayManager, {
      onShowCalledNumbers: () => {
        this.calledNumbers.toggle();
      },
      onPreBuy: () => {
        const fee = this.lastState?.entryFee || 10;
        const types = this.lastState?.ticketTypes ?? [];
        this.buyPopup?.showWithTypes(fee, types);
      },
      onSelectLuckyNumber: () => {
        this.onLuckyNumberTap?.();
      },
      onBuyMoreTickets: () => {
        const fee = this.lastState?.entryFee || 10;
        const types = this.lastState?.ticketTypes ?? [];
        this.buyPopup?.showWithTypes(fee, types);
      },
      onCancelTickets: () => {
        this.onCancelTickets?.();
      },
      onOpenSettings: () => {
        this.onOpenSettings?.();
      },
      onOpenMarkerBg: () => {
        this.onOpenMarkerBg?.();
      },
      onStartGame: () => {
        this.onStartGame?.();
      },
    });

    // Chat panel (right sidebar)
    this.chatPanel = new ChatPanelV2(this.overlayManager, socket, roomCode);

    // Resize ticket scroller when chat panel is toggled (Unity: slides in/out)
    this.chatPanel.setOnToggle((collapsed) => {
      const chatW = collapsed ? 48 : CHAT_WIDTH;
      const scrollerW = screenWidth - TUBE_COLUMN_WIDTH - chatW - 20;
      const scrollerH = screenHeight - TICKET_TOP - 62;
      this.inlineScroller.setViewportSize(Math.max(200, scrollerW), Math.max(100, scrollerH));
    });
  }

  setOnClaim(callback: (type: "LINE" | "BINGO") => void): void {
    this.onClaim = callback;
  }

  setOnBuy(callback: (selections: Array<{ type: string; qty: number }>) => void): void {
    this.onBuy = callback;
  }

  /** Called by the controller after armBet completes to show result in the popup. */
  showBuyPopupResult(ok: boolean, errorMessage?: string): void {
    this.buyPopup?.showResult(ok, errorMessage);
    if (ok) this.buyPopup?.hide();
  }

  setOnLuckyNumberTap(callback: () => void): void {
    this.onLuckyNumberTap = callback;
  }

  /** Unity: delete button cancels tickets (disarms player). */
  setOnCancelTickets(callback: () => void): void {
    this.onCancelTickets = callback;
  }

  setOnOpenSettings(callback: () => void): void {
    this.onOpenSettings = callback;
  }

  setOnOpenMarkerBg(callback: () => void): void {
    this.onOpenMarkerBg = callback;
  }

  /** A6: Set the host manual start callback. */
  setOnStartGame(callback: () => void): void {
    this.onStartGame = callback;
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

    // Show countdown ONLY when no game is actively running.
    // When RUNNING (spectator mode), show the drawn ball — not a countdown.
    if (state.gameStatus !== "RUNNING" && state.millisUntilNextStart !== null && state.millisUntilNextStart > 0) {
      this.leftInfo.startCountdown(state.millisUntilNextStart);
      this.centerBall.startCountdown(state.millisUntilNextStart);
    } else if (state.gameStatus === "RUNNING") {
      // Spectator: stop any countdown, show last drawn number
      this.leftInfo.stopCountdown();
      this.centerBall.stopCountdown();
      if (state.lastDrawnNumber) {
        this.centerBall.showNumber(state.lastDrawnNumber);
      }
    } else {
      this.leftInfo.stopCountdown();
      this.centerBall.showWaiting();
    }

    // Show buy popup — only with backend ticket types (no client fallback)
    this.buyPopup?.showWithTypes(state.entryFee || 10, state.ticketTypes ?? []);

    // Update info panels
    this.updateInfo(state);
  }

  /** Show ball in tube + audio during waiting/spectator mode (no tickets). */
  onSpectatorNumberDrawn(number: number, state: GameState): void {
    this.lastState = state;
    this.ballTube.addBall(number);
    this.centerBall.showNumber(number);
    this.calledNumbers.addNumber(number);
    this.audio.playNumber(number);
    this.updateInfo(state);
  }

  /** Update waiting mode state (e.g. new countdown, player count changes). */
  updateWaitingState(state: GameState): void {
    const prevTypes = this.lastState?.ticketTypes;
    this.lastState = state;

    if (this.isWaitingMode) {
      // Only show countdown when no game is actively running
      if (state.gameStatus !== "RUNNING" && state.millisUntilNextStart !== null && state.millisUntilNextStart > 0) {
        this.leftInfo.startCountdown(state.millisUntilNextStart);
        this.centerBall.startCountdown(state.millisUntilNextStart);
      } else if (state.gameStatus === "RUNNING") {
        this.leftInfo.stopCountdown();
        this.centerBall.stopCountdown();
      }

      // Show buy popup when ticket types first arrive from backend
      const hadTypes = prevTypes && prevTypes.length > 0;
      const hasTypes = state.ticketTypes && state.ticketTypes.length > 0;
      if (!hadTypes && hasTypes) {
        this.buyPopup?.showWithTypes(state.entryFee || 10, state.ticketTypes);
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
    this.centerBall.stopCountdown();
    this.centerBall.setNumber(state.lastDrawnNumber);
    this.buyPopup?.hide();

    for (const result of state.patternResults) {
      if (result.isWon && result.claimType === "LINE") this.lineAlreadyWon = true;
      if (result.isWon && result.claimType === "BINGO") this.bingoAlreadyWon = true;
    }

    // Build inline tickets with color from backend (falls back to cycling)
    // BIN-413/415: Variant-aware grouping — Elvis shows color name, Traffic Light shows R/Y/G
    this.inlineScroller.clearCards();
    for (let i = 0; i < state.myTickets.length; i++) {
      const ticket = state.myTickets[i];
      const theme = getTicketThemeByName(ticket.color, i);
      // Determine grid size from actual ticket data (Databingo60 = 3×5, Bingo75 = 5×5)
      const ticketRows = ticket.grid?.length ?? 3;
      const ticketCols = ticket.grid?.[0]?.length ?? 5;
      const gridSize = (ticketRows === 5 && ticketCols === 5) ? "5x5" : "3x5";
      // Unity: PrefabBingoGame1LargeTicket5x5 uses larger cell sizes for "large" ticket types
      const isLargeType = ticket.type?.toLowerCase().includes("large") ?? false;
      const cellSize = isLargeType ? 52 : 44;

      const card = new TicketCard(i, {
        gridSize,
        cellSize,
        cardBg: theme.cardBg,
        headerBg: theme.headerBg,
        headerText: theme.headerText,
        toGoColor: theme.toGoColor,
        toGoCloseColor: theme.toGoCloseColor,
        cellColors: theme.cellColors,
      });
      card.loadTicket(ticket);

      // Set ticket price (Unity: each ticket shows price on the card)
      const ticketType = state.ticketTypes?.find((t) => t.type === ticket.type);
      const ticketPrice = Math.round((state.entryFee || 10) * (ticketType?.priceMultiplier ?? 1));
      card.setPrice(ticketPrice);

      // Set variant-specific header label (Unity: ticketColor as name for Elvis)
      if (ticket.type === "elvis" && ticket.color) {
        card.setHeaderLabel(ticket.color);
      } else if (ticket.type?.startsWith("traffic-") && ticket.color) {
        card.setHeaderLabel(ticket.color);
      } else {
        card.setHeaderLabel(`${i + 1} — ${ticket.color ?? "standard"}`);
      }

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

  /**
   * BIN-419: Show Elvis replace option — swap tickets for a fee between rounds.
   * Only shown for Elvis variant in waiting mode when player has tickets.
   */
  showElvisReplace(replaceAmount: number, onReplace: () => void): void {
    if (replaceAmount <= 0) return;
    // Show a toast-like bar at the bottom with replace option
    const bar = document.createElement("div");
    Object.assign(bar.style, {
      position: "absolute",
      bottom: "10px",
      left: "50%",
      transform: "translateX(-50%)",
      background: "rgba(75,0,0,0.95)",
      border: "1.5px solid rgba(255,165,95,0.5)",
      borderRadius: "10px",
      padding: "10px 20px",
      display: "flex",
      alignItems: "center",
      gap: "12px",
      zIndex: "55",
      pointerEvents: "auto",
    });
    const text = document.createElement("span");
    text.textContent = `Bytt bonger (${replaceAmount} kr)`;
    text.style.cssText = "color:#ffa55f;font-size:14px;font-weight:600;";
    bar.appendChild(text);
    const btn = document.createElement("button");
    btn.textContent = "Bytt";
    btn.style.cssText = "background:linear-gradient(180deg,#c41030,#8a0020);border:none;border-radius:6px;padding:6px 16px;color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;";
    btn.addEventListener("click", () => {
      onReplace();
      bar.remove();
    });
    bar.appendChild(btn);
    const dismissBtn = document.createElement("button");
    dismissBtn.textContent = "\u2715";
    dismissBtn.style.cssText = "background:none;border:none;color:#999;font-size:16px;cursor:pointer;";
    dismissBtn.addEventListener("click", () => bar.remove());
    bar.appendChild(dismissBtn);
    this.overlayManager.getRoot().appendChild(bar);
  }

  /** BIN-451: Disable buy-more button (Unity: buyMoreTicket.interactable = false after N balls). */
  disableBuyMore(): void {
    this.centerTop.showButtonFeedback("buyMore", false);
  }

  onNumberDrawn(number: number, _drawIndex: number, state: GameState): void {
    this.lastState = state;

    // Ball tube — add animated ball
    this.ballTube.addBall(number);

    // Center ball — show new number with animation
    this.centerBall.showNumber(number);

    // Inline tickets — mark number on all cards
    // Returns true if any ticket had that number (for mark SFX)
    const anyMatched = this.inlineScroller.markNumberOnAll(number);
    this.inlineScroller.sortBestFirst();
    this.updateClaimButtons(state);

    // Ticket overlay — mark on cards
    this.ticketOverlay.onNumberDrawn(number, state);

    // Called numbers — add to grid
    this.calledNumbers.addNumber(number);

    // Audio: play number announcement
    this.audio.playNumber(number);

    // Audio: play mark SFX once per draw if any ticket matched
    if (anyMatched) {
      this.audio.playSfx("mark");
    }

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
    const totalStake = stakeFromState(state);
    this.leftInfo.update(
      state.playerCount,
      totalStake,
      state.prizePool,
      state.lastDrawnNumber,
      state.drawCount,
      state.totalDrawCapacity,
      state.players,
    );
    this.chatPanel.updatePlayerCount(state.playerCount);
    this.centerTop.updatePatterns(state.patterns, state.patternResults, state.prizePool);
    // A6: Show/hide host manual start button
    this.centerTop.setCanStartNow(state.canStartNow, state.gameStatus === "RUNNING");
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

    // Reposition center ball
    this.centerBall.x = TUBE_COLUMN_WIDTH + (width - TUBE_COLUMN_WIDTH - CHAT_WIDTH) / 2 - 60;

    // BIN-401: Resize ticket scroller to fit new dimensions
    const chatW = this.chatPanel?.isCollapsed() ? 48 : CHAT_WIDTH;
    const scrollerW = width - TUBE_COLUMN_WIDTH - chatW - 20;
    const scrollerH = height - TICKET_TOP - 60;
    this.inlineScroller.setViewportSize(Math.max(200, scrollerW), Math.max(100, scrollerH));
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

    // Auto-claim: Unity automatically sends claim when pattern is complete
    // (Game1GamePlayPanel.MarkWithdrawNumbers → Pattern_Remaining_Cell_Count == 0)
    if (canClaimLine && !this.lineAlreadyWon) {
      this.lineBtn.setState("ready");
      this.lineAlreadyWon = true; // prevent duplicate auto-claims
      this.onClaim?.("LINE");
    }
    if (canClaimBingo && !this.bingoAlreadyWon) {
      this.bingoBtn.setState("ready");
      this.bingoAlreadyWon = true;
      this.onClaim?.("BINGO");
    }
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
