import { Container, Sprite, Text, Assets } from "pixi.js";
import gsap from "gsap";
import type { GameState } from "../../../bridge/GameBridge.js";
import type { PatternWonPayload, ChatMessage } from "@spillorama/shared-types/socket-events";
import type { AudioManager } from "../../../audio/AudioManager.js";
import type { SpilloramaSocket } from "../../../net/SpilloramaSocket.js";
import { installBlinkDiagnostic, shouldInstallBlinkDiagnostic } from "../diagnostics/BlinkDiagnostic.js";
import { BallTube } from "../components/BallTube.js";
import { HeaderBar } from "../components/HeaderBar.js";
import { HtmlOverlayManager } from "../components/HtmlOverlayManager.js";
import { LeftInfoPanel } from "../components/LeftInfoPanel.js";
import { CenterTopPanel } from "../components/CenterTopPanel.js";
import { ChatPanelV2 } from "../components/ChatPanelV2.js";
import { CalledNumbersOverlay } from "../components/CalledNumbersOverlay.js";
import { Game1BuyPopup } from "../components/Game1BuyPopup.js";
import { CenterBall } from "../components/CenterBall.js";
import { ClaimButton } from "../../game2/components/ClaimButton.js";
import { checkClaims } from "../../game2/logic/ClaimDetector.js";
import { stakeFromState } from "../logic/StakeCalculator.js";
import { TicketGridHtml } from "../components/TicketGridHtml.js";

/**
 * Redesign 2026-04-23 — explicit column-based layout so each region has
 * its own flex child in overlayRoot with an independently tunable width:
 *   [tube spacer 140][ring spacer 200][leftInfo][centerTop][chatPanel →]
 * Pixi renders the tube and ring behind the respective spacers. chatPanel
 * uses margin-left:auto to pin itself to the right edge.
 *
 * Ball positioning mirrors mockup `.game-number-ring`: 170×170 with top
 * 30px below the game-container top. Exact match to spillorama-ui-mockup.
 */
/**
 * Layout 2026-04-23 — overlayRoot flex-row with explicit gap between
 * top-level containers (best-practice, no marginLeft hacks):
 *
 *   [tubeSpacer] gap [callGroup: ring + clover] gap [topGroupWrapper] ...chatPanel
 *
 * Each top-level child is a logical unit. Pixi ball-tube + ring render
 * behind their respective spacer children. `OVERLAY_ROW_GAP` is the
 * single source of truth for the spacing between containers.
 */
const TUBE_COLUMN_WIDTH = 155;
const RING_COLUMN_WIDTH = 200;  // 170 ring + 30 breathing room
const OVERLAY_ROW_GAP = 0;      // base flex gap between top-level containers (per-container spacing under)
/** Gap til høyre for den store ballen (ring) — mellom ringen og firkløveren. */
const GAP_RIGHT_OF_BALL = 68;
/** Gap til høyre for firkløver-kolonnen — mellom "Velg lykketall" og HOVEDSPILL-panelet. */
const GAP_RIGHT_OF_CLOVER = 91;
// Kept in sync with CHAT_OPEN_WIDTH_PX / CHAT_COLLAPSED_WIDTH_PX in ChatPanelV2.
const CHAT_WIDTH = 265;
const CHAT_COLLAPSED_WIDTH = 110;
const TICKET_TOP = 239;
/** Fast x-posisjon for ticket-grid + claim-buttons (frakoblet fra top-radens posisjon). */
const TICKET_LEFT = 155;
/** Y offset below the ticket grid for the LINE/BINGO claim buttons.
 *  0 = ticket-grid bruker full skjermhøyde; fade-masken i TicketGridHtml
 *  tonar bunnen ut slik at evt. claim-knapper (vanligvis skjult) fortsatt
 *  ser naturlige ut når de dukker opp. */
const CLAIM_AREA = 0;
const RING_SIZE = 170;
const RING_TOP_Y = 18;
/** Clover "Velg lykketall"-knapp right-of-ring inside callGroup. */
const CLOVER_SIZE = 72;
const DRAW_COUNT_Y_OFFSET = 16; // gap below the ring for the "X/Y" text

type Callbacks = {
  onClaim?: (type: "LINE" | "BINGO") => void;
  onBuy?: (selections: Array<{ type: string; qty: number; name?: string }>) => void;
  onLuckyNumberTap?: () => void;
  onCancelTickets?: () => void;
  /** BIN-692: single-ticket × cancel. Fires with the ticket id. */
  onCancelTicket?: (ticketId: string) => void;
  onOpenSettings?: () => void;
  onOpenMarkerBg?: () => void;
  /** A6: host/admin manual start. */
  onStartGame?: () => void;
};

/**
 * Game 1 play screen — the slim rewrite.
 *
 * Prior iterations mixed four ticket-rendering paths (TicketCard, TicketGroup,
 * TicketGridScroller, TicketOverlay) and two buy popups (Game1BuyPopup +
 * UpcomingPurchase). That spaghetti was the source of the colour-propagation
 * bugs (BIN-688), the mid-row flip-bug (scroller mask), and the post-game
 * crash-loop (destroyed containers in the Pixi render tree).
 *
 * This version:
 *   - Uses {@link TicketGridHtml} — native-scroll HTML grid of
 *     {@link BingoTicketHtml}. CSS flip, CSS layout, no Pixi mask/hitArea.
 *   - Single `update(state)` entry point replaces the enterWaitingMode/
 *     buildTickets/updateInfo/updateWaitingState/renderPreRoundTickets/
 *     updateUpcomingPurchase set.
 *   - Popup lifecycle owned by Controller — PlayScreen just exposes
 *     `showBuyPopup` / `hideBuyPopup` / `showBuyPopupResult`.
 *   - Pixi stays where it earns its keep: ball tube, center ball, drawn
 *     balls. Everything UI-ish is HTML.
 */
export class PlayScreen extends Container {
  private readonly ballTube: BallTube;
  private readonly calledNumbers: CalledNumbersOverlay;
  private readonly overlayManager: HtmlOverlayManager;
  private readonly leftInfo: LeftInfoPanel;
  private readonly centerTop: CenterTopPanel;
  private readonly chatPanel: ChatPanelV2;
  private readonly headerBar: HeaderBar;
  private readonly centerBall: CenterBall;
  private readonly buyPopup: Game1BuyPopup;
  private readonly ticketGrid: TicketGridHtml;
  private readonly lineBtn: ClaimButton;
  private readonly bingoBtn: ClaimButton;
  private readonly audio: AudioManager;
  /** Standalone Pixi text for "X/Y" drawn-ball counter under the ring.
   * NOT a child of CenterBall so the idle-float tween doesn't move it. */
  private readonly drawCountText: Text;

  /** Chat-toggle tween on the jackpot header offset. See setupChatLayoutSync. */
  private headerShiftTween: gsap.core.Tween | null = null;

  private bgSprite: Sprite | null = null;
  private blinkDiagnosticDispose: (() => void) | null = null;
  private screenW: number;
  private screenH: number;

  private callbacks: Callbacks = {};
  private lastState: GameState | null = null;
  private lineAlreadyWon = false;
  private bingoAlreadyWon = false;
  /**
   * One-shot flag: auto-open the buy popup on the first `update()` where the
   * player lands on the screen without any armed brett and ticketTypes have
   * arrived. Subsequent state changes never re-auto-open — the player either
   * buys (popup auto-hides on success) or closes it manually and must use
   * the "Kjøp flere brett" button to re-open at qty=0. Product decision
   * 2026-04-20.
   */
  private autoShowBuyPopupDone = false;

  constructor(
    screenWidth: number,
    screenHeight: number,
    audio: AudioManager,
    socket: SpilloramaSocket,
    roomCode: string,
    container: HTMLElement,
    pauseAwareBridge?: { getState(): { isPaused: boolean } },
  ) {
    super();
    this.audio = audio;
    this.screenW = screenWidth;
    this.screenH = screenHeight;

    this.loadBackground(screenWidth, screenHeight);

    // ── Pixi components (ball animation + center ball) ────────────────────
    // Ball tube sits inside the 140px tube-spacer column, centred (108px wide).
    this.ballTube = new BallTube(screenHeight - 22);
    this.ballTube.x = (TUBE_COLUMN_WIDTH - 108) / 2;
    this.ballTube.y = 21;
    this.addChild(this.ballTube);

    // Ring sits inside the ringSpacer (first child of callGroup). Absolute
    // x in viewport = tubeSpacer width + overlay gap + padding inside
    // ringSpacer to centre the 170px ring in its 200px column.
    this.centerBall = new CenterBall(pauseAwareBridge);
    this.centerBall.x = this.ringCenterColumnLeft() + (RING_COLUMN_WIDTH - RING_SIZE) / 2;
    this.centerBall.y = RING_TOP_Y;
    this.centerBall.setBaseY(RING_TOP_Y);
    this.addChild(this.centerBall);
    this.centerBall.showWaiting();

    // ── HTML overlay layer ────────────────────────────────────────────────
    this.overlayManager = new HtmlOverlayManager(container);
    const overlayRoot = this.overlayManager.getRoot();
    overlayRoot.style.display = "flex";
    overlayRoot.style.flexDirection = "row";
    overlayRoot.style.alignItems = "flex-start";
    // Single gap source — spacing between top-level containers
    // (tubeSpacer, callGroup, topGroupWrapper, chatPanel).
    overlayRoot.style.gap = `${OVERLAY_ROW_GAP}px`;

    // Tube spacer — occupies the visual column where the Pixi ball-tube
    // renders. Not a "container" in the PM sense, but the ball-tube
    // needs dedicated layout space.
    const tubeSpacer = document.createElement("div");
    tubeSpacer.style.cssText = `width:${TUBE_COLUMN_WIDTH}px;flex-shrink:0;pointer-events:none;`;
    overlayRoot.appendChild(tubeSpacer);

    // Glass-tube-overlay — dekorasjon som legger seg over Pixi-ballkolonnen
    // (rundet topp, rett bunn, mørk tinted fyll, høylys-striper, bunnskygge).
    // Portert 1:1 fra GlassTube.jsx (PM 2026-04-23). Pixi-ballene rendres
    // bak HTML-laget og vises gjennom den semi-transparente glass-effekten.
    this.buildGlassTubeOverlay(overlayRoot, screenHeight);

    // ── Container 1: big ring + "Velg lykketall" firkløver-knapp ──────────
    // One logical unit (PM 2026-04-23: "ene containeren styrer stor ball
    // og lykketall"). Pixi ring renders behind ringSpacer, the clover is
    // an HTML button inside the same flex row so they move together.
    const callGroup = document.createElement("div");
    callGroup.id = "call-group-wrapper";
    callGroup.style.cssText = [
      "display:flex",
      "flex-direction:row",
      "align-items:flex-start",
      `gap:${GAP_RIGHT_OF_BALL}px`,
      "flex-shrink:0",
      "pointer-events:none",
    ].join(";");

    const ringSpacer = document.createElement("div");
    ringSpacer.style.cssText = `width:${RING_COLUMN_WIDTH}px;flex-shrink:0;`;
    callGroup.appendChild(ringSpacer);

    const cloverColumn = document.createElement("div");
    cloverColumn.style.cssText = "display:flex;flex-direction:column;align-items:center;padding-top:51px;gap:6px;flex-shrink:0;pointer-events:auto;";

    const cloverBtn = document.createElement("button");
    cloverBtn.type = "button";
    cloverBtn.title = "Velg lykketall";
    cloverBtn.setAttribute("aria-label", "Velg lykketall");
    cloverBtn.style.cssText = [
      `width:${CLOVER_SIZE}px`,
      `height:${CLOVER_SIZE}px`,
      "background:url(/web/games/assets/game1/design/lucky-clover.png) center/contain no-repeat",
      "background-color:transparent",
      "border:none",
      "padding:0",
      "cursor:pointer",
      "filter:drop-shadow(0 3px 6px rgba(0,0,0,0.5))",
      "transition:transform 0.15s ease-out",
    ].join(";");
    cloverBtn.addEventListener("mouseenter", () => { cloverBtn.style.transform = "scale(1.08)"; });
    cloverBtn.addEventListener("mouseleave", () => { cloverBtn.style.transform = ""; });
    cloverBtn.addEventListener("click", () => this.callbacks.onLuckyNumberTap?.());
    cloverColumn.appendChild(cloverBtn);

    const cloverLabel = document.createElement("div");
    cloverLabel.style.cssText = [
      "text-align:center",
      "color:#fff",
      "font-size:13px",
      "font-weight:700",
      "line-height:1.15",
      "letter-spacing:0.2px",
      "text-shadow:0 2px 4px rgba(0,0,0,0.6)",
      "pointer-events:none",
      "user-select:none",
    ].join(";");
    const line1 = document.createElement("div");
    line1.textContent = "Velg";
    const line2 = document.createElement("div");
    line2.textContent = "lykketall";
    cloverLabel.appendChild(line1);
    cloverLabel.appendChild(line2);
    cloverColumn.appendChild(cloverLabel);

    callGroup.appendChild(cloverColumn);
    overlayRoot.appendChild(callGroup);

    this.leftInfo = new LeftInfoPanel(this.overlayManager, pauseAwareBridge ?? undefined);
    this.calledNumbers = new CalledNumbersOverlay(this.overlayManager);

    // Buy popup — a single entry point. Controller owns show/hide.
    this.buyPopup = new Game1BuyPopup(this.overlayManager);
    this.buyPopup.setOnBuy((selections) => this.callbacks.onBuy?.(selections));

    // HTML ticket grid — replaces TicketGridScroller + TicketGroup + TicketCard.
    this.ticketGrid = new TicketGridHtml({
      onCancelTicket: (id) => this.callbacks.onCancelTicket?.(id),
    });
    this.ticketGrid.mount(overlayRoot);

    this.centerTop = new CenterTopPanel(this.overlayManager, {
      onShowCalledNumbers: () => this.calledNumbers.toggle(),
      onPreBuy: () => this.openBuyPopup(),
      onBuyMoreTickets: () => this.openBuyPopup(),
      onSelectLuckyNumber: () => this.callbacks.onLuckyNumberTap?.(),
      onCancelTickets: () => this.callbacks.onCancelTickets?.(),
      onOpenSettings: () => this.callbacks.onOpenSettings?.(),
      onOpenMarkerBg: () => this.callbacks.onOpenMarkerBg?.(),
      onStartGame: () => this.callbacks.onStartGame?.(),
    });

    // ── Container 2: player-info + combo-panel + action-buttons ──────────
    // PM 2026-04-23: "den andre yster da resten". Bordered box with the
    // shared gradient/shadow that visually unifies the three info
    // sections. Horizontal spacing to callGroup is handled by the
    // overlayRoot flex gap, not a marginLeft hack.
    const topGroupWrapper = document.createElement("div");
    topGroupWrapper.id = "top-group-wrapper";
    topGroupWrapper.style.cssText = [
      "display:flex",
      "flex-direction:row",
      "align-items:stretch",
      "align-self:flex-start",
      "flex-shrink:0",
      "margin-top:18px",
      `margin-left:${GAP_RIGHT_OF_CLOVER}px`,
      "background:radial-gradient(ellipse at top left, rgba(50, 15, 15, 0.45), rgba(15, 0, 0, 0.45))",
      "border:1px solid rgba(255, 120, 50, 0.35)",
      "border-radius:14px",
      "box-shadow:0 10px 34px rgba(0, 0, 0, 0.5), inset 0 1px 2px rgba(255,255,255,0.1)",
      "overflow:hidden",
      "pointer-events:auto",
    ].join(";");
    // Re-parent the two roots (createElement appended them to overlayRoot).
    topGroupWrapper.appendChild(this.leftInfo.rootEl);
    topGroupWrapper.appendChild(this.centerTop.rootEl);
    overlayRoot.appendChild(topGroupWrapper);

    // Chat on the RIGHT edge (flex-row last child), default collapsed so
    // players land in the game without the chat panel expanded.
    this.chatPanel = new ChatPanelV2(this.overlayManager, socket, roomCode, {
      initialCollapsed: true,
    });
    this.headerBar = new HeaderBar(this.overlayManager);

    this.drawCountText = new Text({
      text: "",
      style: {
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        fontSize: 15,
        fill: 0xffffff,
        fontWeight: "700",
        align: "center",
        letterSpacing: 0.5,
        dropShadow: { color: 0x000000, alpha: 0.8, blur: 4, distance: 1 },
      },
    });
    this.drawCountText.anchor.set(0.5);
    this.drawCountText.x = this.centerBall.x + RING_SIZE / 2;
    this.drawCountText.y = this.centerBall.y + RING_SIZE + DRAW_COUNT_Y_OFFSET;
    this.addChild(this.drawCountText);

    // ── Claim buttons (Pixi — small, self-contained, not worth HTML) ──────
    this.lineBtn = new ClaimButton("LINE", 130, 44);
    this.lineBtn.setOnClaim((type) => this.callbacks.onClaim?.(type));
    this.addChild(this.lineBtn);

    this.bingoBtn = new ClaimButton("BINGO", 130, 44);
    this.bingoBtn.setOnClaim((type) => this.callbacks.onClaim?.(type));
    this.addChild(this.bingoBtn);

    this.positionClaimButtons();
    this.positionTicketGrid();

    this.setupChatLayoutSync();
    this.registerTopNavActions();

    // Opt-in blink-diagnostic (kun aktivert med ?diag=blink i URL-en).
    if (shouldInstallBlinkDiagnostic()) {
      this.blinkDiagnosticDispose = installBlinkDiagnostic(overlayRoot);
    }
  }

  // ── Callback setters (called once by Controller, not per-transition) ────

  setOnClaim(callback: (type: "LINE" | "BINGO") => void): void { this.callbacks.onClaim = callback; }
  setOnBuy(callback: (selections: Array<{ type: string; qty: number; name?: string }>) => void): void { this.callbacks.onBuy = callback; }
  setOnLuckyNumberTap(callback: () => void): void { this.callbacks.onLuckyNumberTap = callback; }
  setOnCancelTickets(callback: () => void): void { this.callbacks.onCancelTickets = callback; }
  setOnCancelTicket(callback: (ticketId: string) => void): void { this.callbacks.onCancelTicket = callback; }
  setOnOpenSettings(callback: () => void): void { this.callbacks.onOpenSettings = callback; }
  setOnOpenMarkerBg(callback: () => void): void { this.callbacks.onOpenMarkerBg = callback; }
  setOnStartGame(callback: () => void): void { this.callbacks.onStartGame = callback; }

  subscribeChatToBridge(onChat: (listener: (msg: ChatMessage) => void) => () => void): void {
    this.chatPanel.subscribeToBridge(onChat);
  }

  // ── Single state-sync entry point ──────────────────────────────────────

  /**
   * Idempotent render — called once per `stateChanged`. Picks what to show
   * based on `state.gameStatus` + ticket arrays. Safe to call many times per
   * second; `TicketGridHtml` diff-renders internally.
   */
  update(state: GameState): void {
    this.lastState = state;

    // Countdown / center-ball:
    //   - RUNNING → show the last drawn ball, stop countdown
    //   - Else with millisUntilNextStart > 0 → run countdown
    //   - Else → idle "waiting" view
    if (state.gameStatus === "RUNNING") {
      this.leftInfo.stopCountdown();
      this.centerBall.stopCountdown();
      if (state.lastDrawnNumber !== null) this.centerBall.setNumber(state.lastDrawnNumber);
    } else if (state.millisUntilNextStart !== null && state.millisUntilNextStart > 0) {
      this.leftInfo.startCountdown(state.millisUntilNextStart);
      this.centerBall.startCountdown(state.millisUntilNextStart);
    } else {
      this.leftInfo.stopCountdown();
      this.centerBall.showWaiting();
    }

    // Tickets displayed depend on game phase:
    //   - RUNNING                    → KUN myTickets (markable, ikke cancelable)
    //   - WAITING / ENDED / NONE     → preRoundTickets (pre-round queue, cancelable)
    //
    // Round-state-isolation (Tobias 2026-04-25): pre-round-bonger for
    // NESTE runde må aldri blandes inn i den aktive rundens grid. Forrige
    // versjon kombinerte `myTickets + preRoundTickets` under RUNNING for
    // å vise mid-round additive arm — det forvirret bruker som så bonger
    // for fremtidig runde mellom de aktive. PreRoundTickets vises nå kun
    // når ingen runde er aktiv; under RUNNING kommuniseres pending arm
    // via "Forhåndskjøp"-indikatoren (myPendingStake > 0).
    const running = state.gameStatus === "RUNNING";
    const tickets = running
      ? state.myTickets
      : (state.preRoundTickets ?? []);

    this.ticketGrid.setTickets(tickets, {
      // Live brett (RUNNING) skal aldri ha × — de er allerede betalt.
      // Pre-round-brett (mellom runder) er kjøpt men ikke startet, så ×
      // gir refund via ticket:cancel. cancelable=running=false for
      // live-grid; cancelable=true for pre-round.
      cancelable: !running,
      entryFee: state.entryFee || 10,
      state,
      liveTicketCount: running ? state.myTickets.length : 0,
    });

    // Ball tube + called-numbers overlay reflect drawn history. We always sync
    // from state to survive reconnects + late-joiner snapshots.
    this.syncBallHistory(state.drawnNumbers);

    // Reset claim-won flags + button states when a new round starts or when
    // we land in a non-RUNNING state.
    if (!running) {
      this.lineAlreadyWon = false;
      this.bingoAlreadyWon = false;
      this.lineBtn.reset();
      this.bingoBtn.reset();
    } else {
      for (const result of state.patternResults) {
        if (result.isWon && result.claimType === "LINE") this.lineAlreadyWon = true;
        if (result.isWon && result.claimType === "BINGO") this.bingoAlreadyWon = true;
      }
      this.updateClaimButtons(state);
    }

    // Side panels.
    const totalStake = stakeFromState(state);
    // "Gevinst" in LeftInfoPanel = THIS player's accumulated winnings so far
    // this round, not the total prize pool. Sum payoutAmount from every
    // patternResult this player has won. Matches the toast copy in
    // Game1Controller.onPatternWon and avoids shadowing Innsats when this
    // player is the sole buyer (2026-04-21 Tobias-report).
    const myWinnings = state.myPlayerId
      ? state.patternResults.reduce(
          (sum, r) => sum + (r.isWon && r.winnerId === state.myPlayerId ? (r.payoutAmount ?? 0) : 0),
          0,
        )
      : 0;
    this.leftInfo.update(
      state.playerCount,
      totalStake,
      myWinnings,
      state.lastDrawnNumber,
      state.drawCount,
      state.totalDrawCapacity,
      state.players,
      // Round-state-isolation: pass next-round commitment so LeftInfoPanel
      // kan vise "Forhåndskjøp"-rad når > 0. 0 → raden skjules.
      state.myPendingStake,
    );
    // "X/Y" counter under the ring — rendered as standalone Pixi Text so the
    // CenterBall idle-float doesn't drag it around.
    this.drawCountText.text = state.totalDrawCapacity > 0
      ? `${state.drawCount}/${state.totalDrawCapacity}`
      : "";
    this.chatPanel.updatePlayerCount(state.playerCount);
    this.centerTop.setGameRunning(running);
    this.centerTop.updatePatterns(state.patterns, state.patternResults, state.prizePool);
    this.centerTop.setCanStartNow(state.canStartNow, running);
    this.centerTop.updateJackpot(state.jackpot);
    this.headerBar.update(state.jackpot); // kept for API parity (no-op render)

    // Auto-open the buy popup on entry so the player doesn't have to hunt for
    // the "Forhåndskjøp" button. One-shot per screen-session (see
    // autoShowBuyPopupDone doc) — applies to WAITING and SPECTATING mid-round
    // joiners. Skipped for active players (har live brett) og hvis ticketTypes
    // ikke har kommet enda (første snapshot før gameVariant populeres).
    const hasLive = running && state.myTickets.length > 0;
    if (
      !this.autoShowBuyPopupDone
      && !hasLive
      && state.ticketTypes.length > 0
      && (state.preRoundTickets?.length ?? 0) === 0
    ) {
      this.autoShowBuyPopupDone = true;
      this.showBuyPopup(state);
    }
  }

  // ── Buy popup (explicit lifecycle, owned by Controller) ────────────────

  /** Open the buy popup at qty=0 on every call. Controller hides it on
   *  successful arm — re-open starts fresh (matches product spec 2026-04-20). */
  showBuyPopup(state?: GameState): void {
    const ref = state ?? this.lastState;
    if (!ref) return;
    const fee = ref.entryFee || 10;
    const types = ref.ticketTypes ?? [];
    const alreadyPurchased = ref.preRoundTickets?.length ?? 0;
    this.buyPopup.showWithTypes(fee, types, alreadyPurchased);
  }

  hideBuyPopup(): void {
    this.buyPopup.hide();
  }

  /** Show success / error status inside the popup. On `ok`, popup auto-hides. */
  showBuyPopupResult(ok: boolean, errorMessage?: string): void {
    this.buyPopup.showResult(ok, errorMessage);
    if (ok) this.buyPopup.hide();
  }

  // ── Live-game events ────────────────────────────────────────────────────

  onNumberDrawn(number: number, _drawIndex: number, state: GameState): void {
    this.lastState = state;
    this.ballTube.addBall(number);
    this.centerBall.showNumber(number);
    this.calledNumbers.addNumber(number);
    this.audio.playNumber(number);

    // Mark on all live tickets; returns true if any ticket actually matched.
    // (HTML grid handles this per-child — no Pixi hit-test fights.)
    const anyMatched = this.ticketGrid.markNumberOnAll(number);
    if (anyMatched) this.audio.playSfx("mark");

    // Re-evaluate claim buttons after the new mark.
    this.updateClaimButtons(state);
  }

  /** Spectator / WAITING ball-draw — animate ball tube but don't mark tickets. */
  onSpectatorNumberDrawn(number: number, state: GameState): void {
    this.lastState = state;
    this.ballTube.addBall(number);
    this.centerBall.showNumber(number);
    this.calledNumbers.addNumber(number);
    this.audio.playNumber(number);
  }

  onPatternWon(payload: PatternWonPayload): void {
    const claimType = payload.claimType as "LINE" | "BINGO";
    if (claimType === "LINE") { this.lineAlreadyWon = true; this.lineBtn.reset(); }
    if (claimType === "BINGO") { this.bingoAlreadyWon = true; this.bingoBtn.reset(); }
  }

  // ── Lifecycle + misc ────────────────────────────────────────────────────

  /** BIN-451/409 (D2): buy-more disabled after server threshold. */
  disableBuyMore(): void {
    this.centerTop.setBuyMoreDisabled(true, "Kjøp er stengt — trekning pågår");
  }

  enableBuyMore(): void {
    this.centerTop.setBuyMoreDisabled(false);
  }

  /** BIN-420 G26: revert a claim button after server NACK. */
  resetClaimButton(type: "LINE" | "BINGO"): void {
    if (type === "LINE") {
      this.lineAlreadyWon = false;
      this.lineBtn.setState("ready");
    } else {
      this.bingoAlreadyWon = false;
      this.bingoBtn.setState("ready");
    }
  }

  /** BIN-419: Elvis replace — lets the player swap pre-round tickets for a fee. */
  showElvisReplace(replaceAmount: number, onReplace: () => void): void {
    if (replaceAmount <= 0) return;
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

  /** Called after game-end reset from Controller. */
  reset(): void {
    this.ballTube.clear();
    this.calledNumbers.clearNumbers();
    this.ticketGrid.clear();
    this.lineBtn.reset();
    this.bingoBtn.reset();
    this.lineAlreadyWon = false;
    this.bingoAlreadyWon = false;
    this.calledNumbers.hide();
  }

  resize(width: number, height: number): void {
    this.screenW = width;
    this.screenH = height;
    if (this.bgSprite) {
      this.bgSprite.width = width;
      this.bgSprite.height = height;
    }
    this.positionClaimButtons();
    this.positionTicketGrid();
  }

  /** Current chat column width (collapsed vs expanded). */
  private chatWidth(): number {
    return this.chatPanel?.isCollapsed() ? CHAT_COLLAPSED_WIDTH : CHAT_WIDTH;
  }

  /** Build the glass-tube HTML overlay that sits over the Pixi ball-column.
   *  Pure decoration — pointer-events:none, no balls inside (Pixi owns those).
   *  Styles portert 1:1 fra GlassTube.jsx. */
  private buildGlassTubeOverlay(overlayRoot: HTMLElement, screenHeight: number): void {
    // Pixi ball tube: 108px wide at x=(TUBE_COLUMN_WIDTH-108)/2, y=21.
    // Glass wraps den med 6px buffer på hver side.
    const ballTubeX = (TUBE_COLUMN_WIDTH - 108) / 2;
    const glassW = 96;  // 20% smalere enn tidligere (120)
    const glassX = ballTubeX - (glassW - 108) / 2;
    const glassTop = 13;
    const glassH = screenHeight - glassTop; // helt ned til bunn
    const radius = glassW / 2;

    const glass = document.createElement("div");
    Object.assign(glass.style, {
      position: "absolute",
      left: `${glassX}px`,
      top: `${glassTop}px`,
      width: `${glassW}px`,
      height: `${glassH}px`,
      borderRadius: `${radius}px ${radius}px 0 0`,
      background: [
        "linear-gradient(180deg, rgba(0,0,0,0.22) 0%, rgba(0,0,0,0.12) 50%, rgba(0,0,0,0.28) 100%)",
        "linear-gradient(90deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.04) 18%, rgba(255,255,255,0) 42%, rgba(255,255,255,0) 58%, rgba(255,255,255,0.08) 80%, rgba(255,255,255,0.18) 100%)",
      ].join(","),
      borderTop: "1px solid rgba(255,255,255,0.18)",
      borderLeft: "1px solid rgba(255,255,255,0.18)",
      borderRight: "1px solid rgba(255,255,255,0.18)",
      borderBottom: "none",
      boxShadow: [
        "inset 0 2px 6px rgba(0,0,0,0.6)",
        "inset 3px 0 6px rgba(0,0,0,0.35)",
        "inset -3px 0 6px rgba(0,0,0,0.35)",
        "0 -8px 24px rgba(0,0,0,0.45)",
      ].join(","),
      overflow: "hidden",
      pointerEvents: "none",
      zIndex: "2",
    });

    // Venstre høylys-stripe
    // BLINK-FIX (round 3, hazard 2): Fjernet filter:blur(0.5px) — samme
    // composite-hazard som backdrop-filter: Chrome må re-kompositere
    // blur-pixels hver Pixi-frame. Erstattet med en feathered horisontal
    // gradient (4px bred, falmer ut på sidene) som gir samme myke kant uten
    // GPU-blur. Visuelt nesten identisk; ingen layout-endring.
    const leftHi = document.createElement("div");
    Object.assign(leftHi.style, {
      position: "absolute",
      left: "3px",
      top: "8px",
      bottom: "4px",
      width: "5px",
      borderRadius: "3px",
      background: [
        "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,1) 50%, rgba(255,255,255,0) 100%)",
        "linear-gradient(180deg, rgba(255,255,255,0.55), rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.35))",
      ].join(","),
      backgroundBlendMode: "multiply",
    });
    glass.appendChild(leftHi);

    // Høyre høylys-stripe (tynnere)
    const rightHi = document.createElement("div");
    Object.assign(rightHi.style, {
      position: "absolute",
      right: "2px",
      top: "12px",
      bottom: "4px",
      width: "4px",
      borderRadius: "2px",
      background: [
        "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,1) 50%, rgba(255,255,255,0) 100%)",
        "linear-gradient(180deg, rgba(255,255,255,0.25), rgba(255,255,255,0.05) 50%, rgba(255,255,255,0.18))",
      ].join(","),
      backgroundBlendMode: "multiply",
    });
    glass.appendChild(rightHi);

    // Topp-glans
    const topGloss = document.createElement("div");
    Object.assign(topGloss.style, {
      position: "absolute",
      top: "3px",
      left: "18%",
      right: "18%",
      height: "4px",
      borderRadius: "4px",
      background: "radial-gradient(ellipse, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0) 70%)",
    });
    glass.appendChild(topGloss);

    // Bunn-åpning — mask fade ut tint + høylys-striper de siste 28px så
    // glasset ser åpent ut. Ballene (Pixi) er bak laget og forblir synlige
    // helt ned — virker som om de faller ut av røret.
    glass.style.maskImage = "linear-gradient(to bottom, #000 0, #000 calc(100% - 28px), transparent 100%)";
    glass.style.webkitMaskImage = "linear-gradient(to bottom, #000 0, #000 calc(100% - 28px), transparent 100%)";

    overlayRoot.appendChild(glass);
  }

  /** x-coord where the ring's flex column starts (inside callGroup). */
  private ringCenterColumnLeft(): number {
    return TUBE_COLUMN_WIDTH + OVERLAY_ROW_GAP;
  }

  /** x-coord of the ring's left edge — the anchor ticket + claim
   *  buttons align to so "bongene kommer på linje med det store tallet". */
  private ringLeftEdge(): number {
    return this.ringCenterColumnLeft() + (RING_COLUMN_WIDTH - RING_SIZE) / 2;
  }

  /** Re-pin the LINE/BINGO claim buttons over the current ticket area. */
  private positionClaimButtons(): void {
    const ticketAreaLeft = TICKET_LEFT;
    const ticketAreaWidth = this.screenW - ticketAreaLeft - this.chatWidth() - 20;
    const btnY = this.screenH - 55;
    const btnCentreX = ticketAreaLeft + ticketAreaWidth / 2;
    this.lineBtn.x = btnCentreX - 140;
    this.lineBtn.y = btnY;
    this.bingoBtn.x = btnCentreX + 10;
    this.bingoBtn.y = btnY;
  }

  destroy(): void {
    this.blinkDiagnosticDispose?.();
    this.blinkDiagnosticDispose = null;
    this.leftInfo.stopCountdown();
    this.buyPopup.destroy();
    this.ticketGrid.destroy();
    this.calledNumbers.destroy();
    this.headerShiftTween?.kill();
    this.headerShiftTween = null;
    this.headerBar.destroy();
    this.overlayManager.destroy();
    this.unregisterTopNavActions();
    super.destroy({ children: true });
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private openBuyPopup(): void {
    if (!this.lastState) return;
    this.showBuyPopup(this.lastState);
  }

  private positionTicketGrid(): void {
    // Frakoblet fra ring-posisjon (TUBE_COLUMN_WIDTH) — tickets beholder
    // opprinnelig plassering selv om top-raden flyttes.
    const left = TICKET_LEFT;
    const top = TICKET_TOP;
    const width = this.screenW - left - this.chatWidth() - 20;
    const height = this.screenH - TICKET_TOP - CLAIM_AREA;
    this.ticketGrid.setBounds(left, top, Math.max(200, width), Math.max(100, height));
  }

  /**
   * Register "Se oppleste tall" + "Bytt bakgrunn og markør" handlers on
   * `window.__gameActions` so the web-shell topnav buttons can invoke them.
   * The shell toggles `body.has-game-actions` to show the buttons only
   * while a game that owns these actions is mounted. Cleared in destroy().
   */
  private registerTopNavActions(): void {
    const w = window as unknown as { __gameActions?: Record<string, () => void> };
    w.__gameActions = {
      showCalledNumbers: () => this.calledNumbers.toggle(),
      openMarkerBg: () => this.callbacks.onOpenMarkerBg?.(),
    };
    document.body.classList.add("has-game-actions");
  }

  private unregisterTopNavActions(): void {
    const w = window as unknown as { __gameActions?: unknown };
    delete w.__gameActions;
    document.body.classList.remove("has-game-actions");
  }

  /** Resize ticket grid + re-pin claim buttons when the chat panel
   *  collapses / expands. */
  private setupChatLayoutSync(): void {
    this.chatPanel.setOnToggle((collapsed) => {
      this.positionTicketGrid();
      this.positionClaimButtons();
      const targetOffset = collapsed ? 0 : -80;
      this.headerShiftTween?.kill();
      const proxy = { x: this.headerBar.currentOffsetX };
      this.headerShiftTween = gsap.to(proxy, {
        x: targetOffset,
        duration: 0.25,
        ease: "none",
        onUpdate: () => this.headerBar.setOffsetX(proxy.x),
      });
    });
  }

  private updateClaimButtons(state: GameState): void {
    const { canClaimLine, canClaimBingo } = checkClaims(state.myTickets, state.myMarks, state.drawnNumbers);
    // Auto-claim mirrors Unity: as soon as a pattern is complete we send the
    // claim. Guarded by the already-won flags so we never double-submit.
    if (canClaimLine && !this.lineAlreadyWon) {
      this.lineBtn.setState("ready");
      this.lineAlreadyWon = true;
      this.callbacks.onClaim?.("LINE");
    }
    if (canClaimBingo && !this.bingoAlreadyWon) {
      this.bingoBtn.setState("ready");
      this.bingoAlreadyWon = true;
      this.callbacks.onClaim?.("BINGO");
    }
  }

  private syncedHistoryKey = "";

  private syncBallHistory(drawnNumbers: number[]): void {
    // Only bulk-load the ball tube when history changes shape (new game, or
    // spectator mid-round join / reconnect). Live draws go through
    // onNumberDrawn → addBall. Without this guard every room:update would
    // wipe + re-populate the tube and cancel running animations.
    const key = drawnNumbers.length === 0 ? "empty" : `len=${drawnNumbers.length}:first=${drawnNumbers[0]}`;
    if (key === this.syncedHistoryKey) return;
    this.syncedHistoryKey = key;

    if (drawnNumbers.length === 0) {
      this.ballTube.clear();
      this.calledNumbers.clearNumbers();
    } else {
      this.ballTube.loadBalls(drawnNumbers);
      this.calledNumbers.setNumbers(drawnNumbers);
    }
  }

  private loadBackground(width: number, height: number): void {
    // Nytt design (2026-04-23): mørk-rød bakgrunn fra spillorama-ui-mockup.
    Assets.load("/web/games/assets/game1/design/background.png")
      .then((texture) => {
        if (!texture) return;
        this.bgSprite = new Sprite(texture);
        this.bgSprite.width = width;
        this.bgSprite.height = height;
        this.addChildAt(this.bgSprite, 0);
      })
      .catch(() => {
        // Missing asset is non-fatal — game still plays on the default bg.
      });
  }
}
