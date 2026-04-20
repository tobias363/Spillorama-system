import { Container, Sprite, Assets } from "pixi.js";
import gsap from "gsap";
import type { GameState } from "../../../bridge/GameBridge.js";
import type { PatternWonPayload, ChatMessage } from "@spillorama/shared-types/socket-events";
import type { AudioManager } from "../../../audio/AudioManager.js";
import type { SpilloramaSocket } from "../../../net/SpilloramaSocket.js";
import { BallTube } from "../components/BallTube.js";
import { HeaderBar } from "../components/HeaderBar.js";
import { HtmlOverlayManager } from "../components/HtmlOverlayManager.js";
import { LeftInfoPanel } from "../components/LeftInfoPanel.js";
import { CenterTopPanel } from "../components/CenterTopPanel.js";
import { ChatPanelV2 } from "../components/ChatPanelV2.js";
import { TicketOverlay } from "../components/TicketOverlay.js";
import { CalledNumbersOverlay } from "../components/CalledNumbersOverlay.js";
import { Game1BuyPopup } from "../components/Game1BuyPopup.js";
import { UpcomingPurchase } from "../components/UpcomingPurchase.js";
import { TicketGridScroller } from "../components/TicketGridScroller.js";
import { TicketGroup, type TicketGroupVariant } from "../components/TicketGroup.js";
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
  /**
   * F3 (BIN-431): Jackpot header overlay — matches Unity PanelRowDetails
   * jackpot row. Animated -80px when chat opens (G17).
   */
  private headerBar: HeaderBar;
  /** G17: Active GSAP tween on the headerBar offset — cancelled on re-toggle. */
  private headerShiftTween: gsap.core.Tween | null = null;
  private audio: AudioManager;
  private onClaim: ((type: "LINE" | "BINGO") => void) | null = null;
  private onBuy: ((selections: Array<{ type: string; qty: number }>) => void) | null = null;
  private bgSprite: Sprite | null = null;
  private screenW: number;
  private screenH: number;

  // CenterBall (Unity-matching animated bingo ball in center area)
  private centerBall: CenterBall;

  // Buy popup (Unity-matching ticket purchase) — only shown for explicit
  // "Forhåndskjøp" / "Kjøp flere brett" button clicks (Q1 2026-04-18).
  private buyPopup: Game1BuyPopup | null = null;

  // BIN-410 (D3): Inline upcoming-purchase side panel. Takes over auto-display
  // in WAITING-state (replaces earlier auto-opened Game1BuyPopup).
  private upcomingPurchase: UpcomingPurchase | null = null;

  // Callbacks (set by controller)
  private onLuckyNumberTap: (() => void) | null = null;
  private onCancelTickets: (() => void) | null = null;
  /** BIN-692: per-ticket cancel (× on brett). Fires with the bundle's ticketId. */
  private onCancelTicket: ((ticketId: string) => void) | null = null;
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
  private pauseAwareBridge: { getState(): { isPaused: boolean } } | null = null;
  /**
   * BIN-619: cache for `renderPreRoundTickets` diff-check. `null` = invalid
   * (force rebuild next call). Set back to `null` from `buildTickets` and
   * `enterWaitingMode` since those replace scroller content.
   */
  private lastPreRoundCount: number | null = null;

  constructor(
    screenWidth: number,
    screenHeight: number,
    audio: AudioManager,
    socket: SpilloramaSocket,
    roomCode: string,
    container: HTMLElement,
    /**
     * BIN-420 G23: pause-aware bridge. Passed through to CenterBall and
     * LeftInfoPanel so their countdown setIntervals honour `state.isPaused`
     * (matches Unity `Game1GamePlayPanel.SocketFlow.cs:672-696`).
     * Optional to keep existing tests that construct PlayScreen without a
     * bridge compatible.
     */
    bridge?: { getState(): { isPaused: boolean } },
  ) {
    super();
    this.audio = audio;
    this.screenW = screenWidth;
    this.screenH = screenHeight;
    this.pauseAwareBridge = bridge ?? null;

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
    this.centerBall = new CenterBall(bridge);
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
    this.leftInfo = new LeftInfoPanel(this.overlayManager, this.pauseAwareBridge ?? undefined);

    // Called numbers overlay (fullscreen grid of drawn balls)
    this.calledNumbers = new CalledNumbersOverlay(this.overlayManager);

    // Game1 buy popup (HTML overlay — matches Unity's Game1TicketPurchasePanel)
    // BIN-410 (D3, Q1 2026-04-18): popup is now only shown on explicit
    // "Forhåndskjøp" / "Kjøp flere brett" button clicks. UpcomingPurchase-panelet
    // tar over auto-display mellom runder (matcher Unity).
    this.buyPopup = new Game1BuyPopup(this.overlayManager);
    // Delegate buy to controller — no direct socket call from view layer.
    this.buyPopup.setOnBuy((selections: Array<{ type: string; qty: number }>) => {
      this.onBuy?.(selections);
    });

    // BIN-410 (D3): Upcoming-purchase inline panel. Auto-vises av controlleren
    // ved WAITING-transition og skjules ved PLAYING/SPECTATING/RUNNING/D2-trigger.
    this.upcomingPurchase = new UpcomingPurchase({
      overlay: this.overlayManager,
      onArm: (selections) => {
        this.onBuy?.(selections);
      },
    });

    // Center top panel with action callbacks
    this.centerTop = new CenterTopPanel(this.overlayManager, {
      onShowCalledNumbers: () => {
        this.calledNumbers.toggle();
      },
      onPreBuy: () => {
        const fee = this.lastState?.entryFee || 10;
        const types = this.lastState?.ticketTypes ?? [];
        // Unity: Game1PurchaseTicket.cs:69 — fratrekk allerede-kjøpte brett
        // fra 30-grensen før plus-knappene evalueres.
        // BIN-619: Purchases always arm for the NEXT round (per owner
        // 2026-04-19: "bonger kjøpt under RUNNING blir aktive neste runde").
        // Hard-cap is per-round, so count against `preRoundTickets` — the
        // queue for the next round — not current-round `myTickets`.
        const alreadyPurchased = this.lastState?.preRoundTickets?.length ?? 0;
        this.buyPopup?.showWithTypes(fee, types, alreadyPurchased);
      },
      onSelectLuckyNumber: () => {
        this.onLuckyNumberTap?.();
      },
      onBuyMoreTickets: () => {
        const fee = this.lastState?.entryFee || 10;
        const types = this.lastState?.ticketTypes ?? [];
        // BIN-619: Same reasoning as onPreBuy — count against preRoundTickets.
        const alreadyPurchased = this.lastState?.preRoundTickets?.length ?? 0;
        this.buyPopup?.showWithTypes(fee, types, alreadyPurchased);
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

    // F3 (BIN-431): Jackpot header bar — placed last so it stacks on top.
    this.headerBar = new HeaderBar(this.overlayManager);

    // Resize ticket scroller when chat panel is toggled (Unity: slides in/out)
    // G17 (BIN-431): also shift the jackpot header -80px to match Unity
    // `Panel_Game_Header` slide (Game1GamePlayPanel.ChatLayout.cs:51-70, :112-125).
    // The ticket-area reflow is driven by the flex layout already — Unity's
    // 370px scroller-offset tween is the Unity anchor-point equivalent; in the
    // web port the ticket scroller is sized explicitly via setViewportSize, so
    // the 370px is expressed as `scrollerW -= (CHAT_WIDTH - 48)` which happens
    // naturally. No extra port needed (documented in PR-body).
    this.chatPanel.setOnToggle((collapsed) => {
      const chatW = collapsed ? 48 : CHAT_WIDTH;
      const scrollerW = screenWidth - TUBE_COLUMN_WIDTH - chatW - 20;
      const scrollerH = screenHeight - TICKET_TOP - 62;
      this.inlineScroller.setViewportSize(Math.max(200, scrollerW), Math.max(100, scrollerH));

      // G17: animate header -80px when chat opens (collapsed=false), restore
      // to 0 when chat collapses. Unity direction: open = left (-80); the web
      // chat is on the RIGHT so "open" corresponds to `collapsed=false`.
      const targetOffset = collapsed ? 0 : -80;
      this.headerShiftTween?.kill();
      const proxy = { x: this.headerBar.currentOffsetX };
      this.headerShiftTween = gsap.to(proxy, {
        x: targetOffset,
        duration: 0.25,
        ease: "none", // Unity LeanTween default = linear
        onUpdate: () => this.headerBar.setOffsetX(proxy.x),
      });
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

  /** BIN-692: per-ticket × handler. Fires with the bundle's ticketId; backend resolves the whole bundle. */
  setOnCancelTicket(callback: (ticketId: string) => void): void {
    this.onCancelTicket = callback;
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
    // BIN-619: Invalidate pre-round cache — `clearCards()` below empties the
    // scroller, so next `renderPreRoundTickets` must rebuild from scratch.
    this.lastPreRoundCount = null;

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

    // BIN-410 (D3, Q1 2026-04-18): Auto-åpning av buyPopup er FJERNET.
    // UpcomingPurchase-panelet tar over (matcher Unity — Unity viser aldri
    // modal popup automatisk ved WAITING, bare upcoming-games rad).
    // Popup vises kun ved eksplisitt "Forhåndskjøp"/"Kjøp flere"-klikk.
    // Controlleren kaller showUpcomingPurchase(state) ved WAITING-transition.

    // BIN-619: Render pre-round tickets if already armed (e.g. landing in
    // WAITING with purchases made before reload). Empty preRoundTickets is
    // a no-op after the cache check.
    this.renderPreRoundTickets(state);

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

      // BIN-410 (D3, Q1): Auto-visning av Game1BuyPopup er fjernet.
      // UpcomingPurchase-panelet oppdateres i stedet når ticket-types kommer
      // inn fra backend — refresh in-place bevarer eventuelle +/- valg.
      // BIN-619: `alreadyPurchased` i WAITING må leses fra `preRoundTickets`
      // — `myTickets` er tom mellom runder (blir fylt først ved PLAYING).
      const hadTypes = prevTypes && prevTypes.length > 0;
      const hasTypes = state.ticketTypes && state.ticketTypes.length > 0;
      const preRoundCount = state.preRoundTickets?.length ?? 0;
      if (hasTypes && this.upcomingPurchase?.isShowing()) {
        this.upcomingPurchase.update({
          entryFee: state.entryFee || 10,
          ticketTypes: state.ticketTypes,
          alreadyPurchased: preRoundCount,
        });
      } else if (!hadTypes && hasTypes) {
        // Types just arrived — show the panel.
        this.upcomingPurchase?.show({
          entryFee: state.entryFee || 10,
          ticketTypes: state.ticketTypes,
          alreadyPurchased: preRoundCount,
        });
      }

      // BIN-619: Re-render pre-round tickets when count changes (cache diff-
      // check inside ensures no work if count identical).
      this.renderPreRoundTickets(state);
    }

    this.updateInfo(state);
  }

  /** Hide buy popup (called after successful purchase). */
  hideBuyPopup(): void {
    this.buyPopup?.hide();
  }

  /**
   * BIN-410 (D3): Show the upcoming-purchase side panel for preRound arming.
   * Called by controller when transitioning to WAITING. Not shown during
   * PLAYING/SPECTATING/RUNNING (Q4 avgjørelse).
   */
  showUpcomingPurchase(state: GameState): void {
    if (!state.ticketTypes || state.ticketTypes.length === 0) return;
    // BIN-619: Called from WAITING-transition — between-rounds purchases
    // live in `preRoundTickets`, not `myTickets`.
    this.upcomingPurchase?.show({
      entryFee: state.entryFee || 10,
      ticketTypes: state.ticketTypes,
      alreadyPurchased: state.preRoundTickets?.length ?? 0,
      gameName: state.gameType,
    });
  }

  /**
   * BIN-410 (D3): Hide the upcoming-purchase panel. Called on PLAYING/SPECTATING
   * transitions, on D2-threshold disableBuyMore, and on game-finish reset.
   */
  hideUpcomingPurchase(): void {
    this.upcomingPurchase?.hide();
  }

  // ── Play mode ──

  /** Build ticket grids and initialize all panels from game state. */
  buildTickets(state: GameState): void {
    this.isWaitingMode = false;
    this.lastState = state;
    this.centerTop.setGameRunning(true);
    this.lineAlreadyWon = false;
    this.bingoAlreadyWon = false;
    // BIN-619: buildTickets replaces scroller content from `myTickets` — any
    // pre-round render cached earlier is now stale.
    this.lastPreRoundCount = null;

    // Stop countdown and hide buy popup when entering play mode
    this.leftInfo.stopCountdown();
    this.centerBall.stopCountdown();
    this.centerBall.setNumber(state.lastDrawnNumber);
    this.buyPopup?.hide();
    // BIN-410 (D3): Upcoming-panel skal aldri være synlig under PLAYING/SPECTATING.
    this.upcomingPurchase?.hide();

    for (const result of state.patternResults) {
      if (result.isWon && result.claimType === "LINE") this.lineAlreadyWon = true;
      if (result.isWon && result.claimType === "BINGO") this.bingoAlreadyWon = true;
    }

    this.inlineScroller.clearCards();
    this._renderTicketsIntoScroller(state.myTickets, state, { markActive: true });
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
   * BIN-619: Render pre-round tickets into the scroller.
   *
   * Called from WAITING (pre-round buy flow) and SPECTATING (mid-round buy
   * flow — tickets bought during an active draw arm for the NEXT round and
   * must not be marked by current draws). Unity reference:
   * `Game1GamePlayPanel.SocketFlow.cs` treats preRoundTickets as inactive
   * for current-round mark/claim.
   *
   * Caches count to avoid rebuilding on every stateChange (SPECTATING sees
   * one stateChange per drawn number). buildTickets/enterWaitingMode
   * invalidate the cache so the next call always rebuilds.
   */
  renderPreRoundTickets(state: GameState): void {
    this.lastState = state;
    const tickets = state.preRoundTickets ?? [];
    if (this.lastPreRoundCount === tickets.length) return;

    this.inlineScroller.clearCards();
    if (tickets.length > 0) {
      // BIN-692: pre-round brett are cancelable via × until the round
      // starts. PLAYING/SPECTATING never call this path (they use
      // buildTickets), so `cancelable: true` is scope-safe here.
      this._renderTicketsIntoScroller(tickets, state, {
        markActive: false,
        cancelable: true,
      });
      this.inlineScroller.sortBestFirst();
    }
    this.lastPreRoundCount = tickets.length;
  }

  /**
   * BIN-619: Shared ticket-card/group rendering loop — extracted from
   * `buildTickets` so `renderPreRoundTickets` can reuse it. Caller is
   * responsible for `clearCards()` and `sortBestFirst()` around this.
   *
   * `markActive` controls whether drawn numbers / saved myMarks are applied
   * to each ticket. Pre-round tickets pass `false` — they aren't active in
   * the current round (owner confirmation 2026-04-19).
   *
   * BIN-413/415: Variant-aware grouping —
   *   elvis       → 2 mini-tickets in a TicketGroup (horizontal)
   *   large       → 3 mini-tickets in a TicketGroup (vertical)
   *   traffic-*   → 3 mini-tickets in a TicketGroup (vertical, R/Y/G)
   *   everything else → one TicketCard (as before)
   *
   * Unity refs: Game1ViewPurchaseElvisTicket.cs:14-17 (2-stack, shared BG);
   * PrefabBingoGame1LargeTicket5x5.cs:8 (3-stack, shared imageBG).
   * Cell-size MUST stay at 44 for Large — Unity prefab
   * `Prefab - Bingo Game 1 Large Ticket 5x5.prefab:10354` keeps m_CellSize
   * {44,37} identical to small tickets; Large is a vertical composition,
   * not a scaled-up single ticket.
   */
  private _renderTicketsIntoScroller(
    tickets: GameState["myTickets"],
    state: GameState,
    opts: { markActive: boolean; cancelable?: boolean },
  ): void {
    // BIN-692: pre-round × callback. Built once per call so the closure
    // captures the current `this.onCancelTicket` handler. Solo tickets
    // and groups share the callback — backend resolves the bundle from
    // any ticketId in it.
    const cancelHandler = opts.cancelable
      ? (ticketId: string) => this.onCancelTicket?.(ticketId)
      : undefined;
    let i = 0;
    while (i < tickets.length) {
      const ticket = tickets[i];
      const ticketType = (ticket.type ?? "").toLowerCase();

      // Determine which grouping applies (if any).
      let groupVariant: TicketGroupVariant | null = null;
      let groupSize = 1;
      if (ticketType === "elvis") {
        groupVariant = "elvis";
        groupSize = 2;
      } else if (ticketType === "large") {
        groupVariant = "large";
        groupSize = 3;
      } else if (ticketType.startsWith("traffic-")) {
        groupVariant = "traffic";
        groupSize = 3;
      }

      // Confirm the slice actually has `groupSize` matching tickets in a row.
      // If backend produced a partial group (edge case), fall back to solo.
      if (groupVariant !== null) {
        const slice = tickets.slice(i, i + groupSize);
        const allMatch = slice.length === groupSize && slice.every((t) => {
          const tt = (t.type ?? "").toLowerCase();
          return groupVariant === "traffic"
            ? tt.startsWith("traffic-")
            : tt === ticketType;
        });
        if (!allMatch) groupVariant = null;
      }

      if (groupVariant !== null) {
        const slice = tickets.slice(i, i + groupSize);
        const miniThemes = slice.map((t, idx) =>
          getTicketThemeByName(t.color, i + idx),
        );
        const sharedTheme = miniThemes[0];

        // Grid size follows the first ticket (all tickets in a group share it).
        const first = slice[0];
        const rows = first.grid?.length ?? 3;
        const cols = first.grid?.[0]?.length ?? 5;
        const gridSize: "3x5" | "5x5" = rows === 5 && cols === 5 ? "5x5" : "3x5";

        // Group name: Unity uses ticket.color ("Elvis 1", "Large Red") as the
        // group header; for traffic-light the whole group is just "Trafikklys".
        const groupName =
          groupVariant === "traffic"
            ? "Trafikklys"
            : first.color ?? groupVariant;

        // Price: sum of each member's price (Unity shows one combined price).
        const groupPrice = slice.reduce((sum, t) => {
          const tt = state.ticketTypes?.find((x) => x.type === t.type);
          return sum + Math.round((state.entryFee || 10) * (tt?.priceMultiplier ?? 1));
        }, 0);

        const group = new TicketGroup({
          variant: groupVariant,
          tickets: slice,
          groupName,
          price: groupPrice,
          sharedTheme,
          miniThemes,
          cellSize: 44,
          gridSize,
          cancelable: opts.cancelable,
          onCancel: cancelHandler,
        });

        // Apply existing marks per mini-ticket, mirroring the solo-card flow.
        // BIN-619: Pre-round tickets are inactive in the current round —
        // skip mark application (`opts.markActive === false`).
        if (opts.markActive) {
          for (let k = 0; k < slice.length; k++) {
            const mini = group.miniTickets[k];
            if (state.myMarks[i + k]) {
              mini.markNumbers(state.myMarks[i + k]);
            } else {
              for (const n of state.drawnNumbers) mini.markNumber(n);
            }
          }
        }

        if (state.myLuckyNumber) group.highlightLuckyNumber(state.myLuckyNumber);
        this.inlineScroller.addCard(group);
        i += groupSize;
        continue;
      }

      // ── Solo ticket (small / default) ──
      const theme = getTicketThemeByName(ticket.color, i);
      const ticketRows = ticket.grid?.length ?? 3;
      const ticketCols = ticket.grid?.[0]?.length ?? 5;
      const gridSize = (ticketRows === 5 && ticketCols === 5) ? "5x5" : "3x5";

      const card = new TicketCard(i, {
        gridSize,
        cellSize: 44, // Unity 44×37 — identical for small and large mini-tickets.
        cardBg: theme.cardBg,
        headerBg: theme.headerBg,
        headerText: theme.headerText,
        toGoColor: theme.toGoColor,
        toGoCloseColor: theme.toGoCloseColor,
        cellColors: theme.cellColors,
        cancelable: opts.cancelable,
        onCancel: cancelHandler,
      });
      card.loadTicket(ticket);

      // Set ticket price (Unity: each ticket shows price on the card)
      const ticketType2 = state.ticketTypes?.find((t) => t.type === ticket.type);
      const ticketPrice = Math.round((state.entryFee || 10) * (ticketType2?.priceMultiplier ?? 1));
      card.setPrice(ticketPrice);

      card.setHeaderLabel(`${i + 1} — ${ticket.color ?? "standard"}`);

      // BIN-619: Pre-round tickets are inactive in the current round —
      // skip mark application (`opts.markActive === false`).
      if (opts.markActive) {
        if (state.myMarks[i]) {
          card.markNumbers(state.myMarks[i]);
        } else {
          for (const n of state.drawnNumbers) card.markNumber(n);
        }
      }

      if (state.myLuckyNumber) card.highlightLuckyNumber(state.myLuckyNumber);
      this.inlineScroller.addCard(card);
      i++;
    }
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

  /**
   * BIN-451/409 (D2): Persistently disable the "Kjøp flere brett" button
   * once the server-authoritative threshold (`disableBuyAfterBalls`) is reached.
   *
   * Unity: `buyMoreTicket.interactable = false` after N balls — see
   * `Game1GamePlayPanel.cs:170` (`BuyMoreDisableFlagVal`) and per-ball sjekk i
   * `Game1GamePlayPanel.SocketFlow.cs:109-113, :457-461, :485-489`.
   *
   * Også skjuler UpcomingPurchase-panelet (D3, Q3) — preRound-kjøp skal ikke
   * være åpent når kjøp er stengt for inneværende runde.
   */
  disableBuyMore(): void {
    this.centerTop.setBuyMoreDisabled(true, "Kjøp er stengt — trekning pågår");
    this.hideUpcomingPurchase();
  }

  /**
   * BIN-409 (D2): Re-enable the "Kjøp flere brett" button when a new round
   * begins (Unity: flag resettes ved OnGameStart i `Game1GamePlayPanel.SocketFlow.cs`).
   */
  enableBuyMore(): void {
    this.centerTop.setBuyMoreDisabled(false);
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
    // F3 (BIN-431): Push jackpot info to the header bar (hidden when absent).
    this.headerBar.update(state.jackpot);
  }

  /** Expose inline ticket cards (or multi-ticket groups) for external
   *  operations — e.g. lucky number highlighting. Both TicketCard and
   *  TicketGroup expose `highlightLuckyNumber(n)`. */
  getInlineCards(): import("../components/TicketGridScroller.js").TicketDisplayItem[] {
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
    this.upcomingPurchase?.destroy();
    this.calledNumbers.destroy();
    this.headerShiftTween?.kill();
    this.headerShiftTween = null;
    this.headerBar.destroy();
    this.overlayManager.destroy();
    super.destroy({ children: true });
  }

  /**
   * BIN-420 G26 (Gap #2): Revert a claim button from pending/submitted back to
   * a clickable "ready" state after a server NACK. Called from Game1Controller
   * when `submitClaim` returns `ok:false`. Also unsets the already-won flag so
   * auto-claim can retry on the next number draw.
   */
  resetClaimButton(type: "LINE" | "BINGO"): void {
    if (type === "LINE") {
      this.lineAlreadyWon = false;
      this.lineBtn.setState("ready");
    } else {
      this.bingoAlreadyWon = false;
      this.bingoBtn.setState("ready");
    }
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
