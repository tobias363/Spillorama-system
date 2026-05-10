import { Container, Sprite, Text, Assets } from "pixi.js";
import gsap from "gsap";
import type { GameState } from "../../../bridge/GameBridge.js";
import type { Spill1LobbyOverallStatus } from "@spillorama/shared-types/api";
import type { PatternWonPayload, ChatMessage } from "@spillorama/shared-types/socket-events";
import type { AudioManager } from "../../../audio/AudioManager.js";
import type { SpilloramaSocket } from "../../../net/SpilloramaSocket.js";
import { installBlinkDiagnostic, shouldInstallBlinkDiagnostic } from "../diagnostics/BlinkDiagnostic.js";
import { BallTube } from "../components/BallTube.js";
import { HeaderBar } from "../components/HeaderBar.js";
import { HtmlOverlayManager } from "../components/HtmlOverlayManager.js";
import { LeftInfoPanel } from "../components/LeftInfoPanel.js";
import { CenterTopPanel, type CenterTopOptions } from "../components/CenterTopPanel.js";
import { ChatPanelV2 } from "../components/ChatPanelV2.js";
import { CalledNumbersOverlay } from "../components/CalledNumbersOverlay.js";
import { Game1BuyPopup } from "../components/Game1BuyPopup.js";
import { CenterBall } from "../components/CenterBall.js";
import { stakeFromState } from "../logic/StakeCalculator.js";
import { calculateMyRoundWinnings } from "../logic/WinningsCalculator.js";
import { TicketGridHtml } from "../components/TicketGridHtml.js";
import type { BuyPopupTicketConfig } from "../logic/lobbyTicketTypes.js";

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
/** Fast x-posisjon for ticket-grid (frakoblet fra top-radens posisjon). */
const TICKET_LEFT = 155;
/** Y-offset reservert under ticket-grid. Bølge G (2026-05-05) — manuell
 *  claim-knapp er fjernet (server auto-claimer på trekning, BIN-689), så
 *  konstanten er 0. Beholdt som no-op-buffer for evt. fremtidige overlay-
 *  elementer i bunnen av grid-området. */
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

  /**
   * PIXI-P0-003 (Bølge 2A, 2026-04-28): live Elvis-replace bar + an
   * AbortController whose signal owns the bar's `click` listeners. Used by
   * `showElvisReplace` to (a) dedupe — calling twice removes the old bar
   * before adding the new one — and (b) teardown — `destroy()` aborts all
   * listeners and detaches the DOM node so they don't leak across rounds.
   *
   * Audit reference: `docs/audit/GAME_CLIENT_PIXI_AUDIT_2026-04-28.md`
   * §"Memory Management" hole #1 + §"Findings" P0-003.
   */
  private elvisBar: HTMLElement | null = null;
  private elvisAbort: AbortController | null = null;

  private callbacks: Callbacks = {};
  private lastState: GameState | null = null;
  /**
   * One-shot flag: auto-open the buy popup on the first `update()` where the
   * player lands on the screen without any armed brett and ticketTypes have
   * arrived. Subsequent state changes never re-auto-open — the player either
   * buys (popup auto-hides on success) or closes it manually and must use
   * the "Kjøp flere brett" button to re-open at qty=0. Product decision
   * 2026-04-20.
   */
  private autoShowBuyPopupDone = false;

  /**
   * Spillerklient-rebuild Fase 2 (2026-05-10): cached BuyPopup-konsumert
   * ticket-config bygget fra plan-runtime aggregator. Settes av
   * `setBuyPopupTicketConfig(...)` (kalles av Game1Controller når lobby-
   * state oppdateres). Brukes som fallback i `showBuyPopup()` når
   * `state.ticketTypes` er tomt (pre-game / før første room:update).
   *
   * Tobias-direktiv 2026-05-09: serveren er Source-of-Truth for ticket-
   * types. Når room:update.gameVariant.ticketTypes er tilgjengelig
   * brukes den (live-game). Mellom runder eller før første start brukes
   * lobby-data så spilleren ser riktige bongfarger.
   */
  private lobbyTicketConfig: BuyPopupTicketConfig | null = null;

  /**
   * Spillerklient-rebuild Fase 3 (2026-05-10): siste kjente
   * `Spill1LobbyState.overallStatus` fra plan-runtime aggregatoren.
   * Brukes til å gating-e CenterBall-countdown i `update()` slik at
   * vi ALDRI starter en lokal countdown før master har trykket Start.
   *
   * Tobias-direktiv 2026-05-09 (PM_ONBOARDING_PLAYBOOK §2.3):
   *   "Det skal aldri være noen andre views i det live rommet en neste
   *    planlagte spill."
   *
   * Mapping i `update()`:
   *   - `running`         → countdown-/live-ball-display kan kjøre normalt
   *   - alt annet (idle, purchase_open, ready_to_start, paused,
   *     closed, finished) → CenterBall holdes i waiting-state, ingen
   *     setInterval-countdown. Game1Controller eier "venter på master"-
   *     overlay-en separat.
   *   - `null` (lobby-state ikke ankommet enda) → fail-safe: behandle
   *     som ikke-running, dvs. ingen countdown. Vi heller bias mot å
   *     vise "venter på master" enn å vise feil-aktig countdown.
   */
  private lobbyOverallStatus: Spill1LobbyOverallStatus | null = null;

  constructor(
    screenWidth: number,
    screenHeight: number,
    audio: AudioManager,
    socket: SpilloramaSocket,
    roomCode: string,
    container: HTMLElement,
    pauseAwareBridge?: { getState(): { isPaused: boolean } },
    /**
     * Optional CenterTopPanel-options. Spill 3-controlleren bruker dette
     * til å injisere en egen `patternListViewFactory` (4 visuelle mini-grids
     * i stedet for default tekst-pills). Spill 1 sender ikke argumentet og
     * får default-oppførsel.
     */
    centerTopOptions: CenterTopOptions = {},
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

    this.centerTop = new CenterTopPanel(
      this.overlayManager,
      {
        onShowCalledNumbers: () => this.calledNumbers.toggle(),
        onPreBuy: () => this.openBuyPopup(),
        onBuyMoreTickets: () => this.openBuyPopup(),
        onSelectLuckyNumber: () => this.callbacks.onLuckyNumberTap?.(),
        onCancelTickets: () => this.callbacks.onCancelTickets?.(),
        onOpenSettings: () => this.callbacks.onOpenSettings?.(),
        onOpenMarkerBg: () => this.callbacks.onOpenMarkerBg?.(),
        onStartGame: () => this.callbacks.onStartGame?.(),
      },
      centerTopOptions,
    );

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

    // ── Claim-flyt (Bølge G, 2026-05-05) ─────────────────────────────────
    // Manuell LINE/BINGO-claim-knapp er fjernet. Server-side auto-claim-on-
    // draw (BIN-689 / `patternEvalMode: "auto-claim-on-draw"`) evaluerer
    // mønstre etter hver trekning og pusher `pattern:won` til klient når
    // vinneren er kåret. Tobias-direktiv 2026-05-05: "auto-claim er endelig
    // design B — det er ingen papirbonger i dette spillet og claim går
    // automatisk til vinneren". Cleanup-audit §C.3 lukkes.

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
    //   - Else with millisUntilNextStart > 0 AND lobby.overallStatus === "running"
    //     → run countdown (server har bekreftet at master har trygget runden)
    //   - Else → idle "waiting" view (Game1Controller mounter "venter på
    //     master"-overlay over toppen separat)
    //
    // Spillerklient-rebuild Fase 3 (2026-05-10) — Tobias-direktiv 2026-05-09:
    // klient skal ALDRI starte en lokal countdown før master har trykket
    // Start. Det betyr at vi gater countdown-init på
    // `lobbyOverallStatus === "running"`. Pre-fix kjørte countdown så
    // snart `state.millisUntilNextStart > 0` — det førte til at klient
    // viste timer som ikke matchet server-tilstand når master ennå ikke
    // hadde trigget. Nå venter vi på server-pushed overgang
    // `overallStatus: purchase_open → running` før countdown starter.
    const lobbyRunning = this.lobbyOverallStatus === "running";
    if (state.gameStatus === "RUNNING") {
      this.leftInfo.stopCountdown();
      this.centerBall.stopCountdown();
      if (state.lastDrawnNumber !== null) this.centerBall.setNumber(state.lastDrawnNumber);
    } else if (
      lobbyRunning &&
      state.millisUntilNextStart !== null &&
      state.millisUntilNextStart > 0
    ) {
      this.leftInfo.startCountdown(state.millisUntilNextStart);
      this.centerBall.startCountdown(state.millisUntilNextStart);
    } else {
      this.leftInfo.stopCountdown();
      this.centerBall.stopCountdown();
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

    // Bølge G (2026-05-05): claim-knapp-state-håndtering fjernet. Server
    // auto-claimer på trekning (BIN-689) — klient mottar `pattern:won` via
    // GameBridge/socket-events og animerer vinner-overlay direkte.

    // Side panels.
    const totalStake = stakeFromState(state);
    // "Gevinst" in LeftInfoPanel = THIS player's accumulated winnings so far
    // this round, not the total prize pool. Sum `payoutAmount` (per-winner
    // split) from every patternResult this player has won. Matches the
    // toast copy in Game1Controller.onPatternWon and avoids shadowing
    // Innsats when this player is the sole buyer (2026-04-21 Tobias-report).
    //
    // BIN-696 / Tobias 2026-04-26 — UI-Gevinst-faktisk-bug: tidligere
    // sjekket vi `winnerId === myPlayerId` som kun matchet FØRSTE vinner
    // ved multi-winner-split. Helper-funksjonen `calculateMyRoundWinnings`
    // bruker `winnerIds[]` med fallback til `[winnerId]` for legacy-events.
    // Test-coverage: `WinningsCalculator.test.ts`.
    const myWinnings = calculateMyRoundWinnings(state.patternResults, state.myPlayerId);
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
    // Pass `running` til updatePatterns slik at premie-pills ikke vises
    // overstrøket (.completed) utenfor aktiv trekning. Bug-fix 2026-04-26.
    this.centerTop.updatePatterns(state.patterns, state.patternResults, state.prizePool, running);
    this.centerTop.setCanStartNow(state.canStartNow, running);
    this.centerTop.updateJackpot(state.jackpot);
    this.headerBar.update(state.jackpot); // kept for API parity (no-op render)

    // Auto-open the buy popup on entry so the player doesn't have to hunt for
    // the "Forhåndskjøp" button. One-shot per screen-session (see
    // autoShowBuyPopupDone doc) — applies to WAITING and SPECTATING mid-round
    // joiners. Skipped for active players (har live brett).
    //
    // Spillerklient-rebuild Fase 2 (2026-05-10): vi åpner også hvis
    // `lobbyTicketConfig` er tilgjengelig — det betyr plan-runtime
    // aggregator har levert ticket-data selv om `room:update` ikke har
    // kommet enda (typisk pre-game / før master starter runden).
    const hasLive = running && state.myTickets.length > 0;
    const hasTicketTypes =
      state.ticketTypes.length > 0
      || (this.lobbyTicketConfig?.ticketTypes.length ?? 0) > 0;
    if (
      !this.autoShowBuyPopupDone
      && !hasLive
      && hasTicketTypes
      && (state.preRoundTickets?.length ?? 0) === 0
    ) {
      this.autoShowBuyPopupDone = true;
      this.showBuyPopup(state);
    }
  }

  // ── Buy popup (explicit lifecycle, owned by Controller) ────────────────

  /** Open the buy popup at qty=0 on every call. Controller hides it on
   *  successful arm — re-open starts fresh (matches product spec 2026-04-20).
   *
   *  Spillerklient-rebuild Fase 1 (2026-05-10): valgfri `displayName`
   *  forwarded til popup-subtitle. Hvis ikke satt beholder popup-en sist
   *  kjente verdi (default "Bingo"). Game1Controller kaller
   *  `setBuyPopupDisplayName` separat ved socket-broadcast så det ikke er
   *  strengt nødvendig å sende displayName her — men det reduserer race-
   *  vinduet mellom popup-åpning og første lobby-state-emit.
   *
   *  Spillerklient-rebuild Fase 2 (2026-05-10): hvis `state.ticketTypes`
   *  er tomt (pre-game / før første room:update) faller vi tilbake på
   *  `lobbyTicketConfig` satt via `setBuyPopupTicketConfig(...)`. Dette
   *  sikrer at spilleren ser riktige bongfarger fra plan-runtime catalog
   *  før master har startet runden — Tobias-direktiv 2026-05-09:
   *  "spilleren skal alltid se neste planlagte spill".
   */
  showBuyPopup(state?: GameState, displayName?: string): void {
    const ref = state ?? this.lastState;
    if (!ref) return;
    let fee = ref.entryFee || 10;
    let types = ref.ticketTypes ?? [];
    // Fase 2 fallback: når room:update ikke har levert ticketTypes ennå,
    // bruker vi plan-runtime catalog-data fra lobby-aggregatoren. Live
    // game (state.ticketTypes ikke-tom) prioriteres alltid — den har
    // small + large-bonger fra `gameVariant.ticketTypes` mens lobby-
    // dataen er small-only (3-farge-modellen).
    if (types.length === 0 && this.lobbyTicketConfig) {
      types = this.lobbyTicketConfig.ticketTypes;
      fee = this.lobbyTicketConfig.entryFee;
    }
    const alreadyPurchased = ref.preRoundTickets?.length ?? 0;
    this.buyPopup.showWithTypes(
      fee,
      types,
      alreadyPurchased,
      undefined,
      displayName,
    );
  }

  /**
   * Spillerklient-rebuild Fase 1 (2026-05-10): proxy for plan-runtime
   * aggregator-update. Game1Controller abonnerer på lobby-state og kaller
   * denne ved hver oppdatering. Trygt å kalle både når popup er åpen
   * (live-DOM-oppdatering) og lukket (lagres til neste showBuyPopup).
   */
  setBuyPopupDisplayName(displayName: string | null | undefined): void {
    this.buyPopup.setDisplayName(displayName);
  }

  /**
   * Spillerklient-rebuild Fase 2 (2026-05-10): cache ticket-config fra
   * plan-runtime aggregator slik at `showBuyPopup()` kan bruke det som
   * fallback når `state.ticketTypes` er tomt (pre-game). Idempotent —
   * kall flere ganger ved hver lobby-state-update.
   *
   * Tobias-direktiv 2026-05-09: spilleren skal aldri se hardkodete
   * bongfarger. Når master bytter plan-item (eks. fra Bingo til Trafikklys)
   * pusher Game1Controller den nye config-en hit slik at popup-en oppdateres.
   *
   * Null = lobby-binding har ingen state ennå (eller plan dekker ikke
   * dagen) — popup faller tilbake på `state.ticketTypes` (kan være tom).
   */
  setBuyPopupTicketConfig(config: BuyPopupTicketConfig | null): void {
    this.lobbyTicketConfig = config;
  }

  /**
   * Spillerklient-rebuild Fase 3 (2026-05-10): server-driven
   * `overallStatus` fra plan-runtime aggregator. Game1Controller kaller
   * dette ved hver `Spill1LobbyState`-oppdatering.
   *
   * Når status endres skal `update(state)` re-evaluere countdown-state
   * — vi kaller `update()` synkronisert med siste cached state slik at
   * CenterBall reflekterer ny gating umiddelbart (uten å vente på neste
   * `room:update`).
   *
   * Tobias-direktiv 2026-05-09: server er Source-of-Truth for runde-
   * lifecycle. Klient må ikke ha en lokal hypotese om når countdown
   * begynner — den skal speile `overallStatus === "running"`.
   */
  setLobbyOverallStatus(status: Spill1LobbyOverallStatus | null): void {
    if (this.lobbyOverallStatus === status) return;
    this.lobbyOverallStatus = status;
    if (this.lastState) {
      this.update(this.lastState);
    }
  }

  /** Test-hook: hent siste kjente `lobbyOverallStatus`. */
  getLobbyOverallStatus(): Spill1LobbyOverallStatus | null {
    return this.lobbyOverallStatus;
  }

  hideBuyPopup(): void {
    this.buyPopup.hide();
  }

  /** Show success / error status inside the popup. On `ok`, popup auto-hides
   *  via Game1BuyPopup's setTimeout; we no longer call `.hide()` here so
   *  brukeren faktisk får sett success-meldingen før popup-en lukkes. */
  showBuyPopupResult(ok: boolean, errorMessage?: string): void {
    this.buyPopup.showResult(ok, errorMessage);
  }

  /**
   * Tobias 2026-04-29 (post-orphan-fix UX): vis partial-buy-melding når
   * server aksepterte færre brett enn forespurt. Brukes ved loss-limit-
   * traff midt i bestillingen.
   */
  showBuyPopupPartialResult(input: {
    accepted: number;
    rejected: number;
    rejectionReason: "DAILY_LIMIT" | "MONTHLY_LIMIT" | null;
    lossState?: {
      dailyUsed: number;
      dailyLimit: number;
      monthlyUsed: number;
      monthlyLimit: number;
      walletBalance: number | null;
    };
  }): void {
    this.buyPopup.showPartialBuyResult(input);
  }

  /**
   * Tobias 2026-04-29 (post-orphan-fix UX): proxy for wallet:loss-state-push.
   * Lar Game1Controller oppdatere tap-headeren i Kjøp Bonger-popup-en
   * uten å re-bygge popup-en.
   */
  updateBuyPopupLossState(lossState: {
    dailyUsed: number;
    dailyLimit: number;
    monthlyUsed: number;
    monthlyLimit: number;
    walletBalance: number | null;
  } | null): void {
    this.buyPopup.updateLossState(lossState);
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

    // Bølge G (2026-05-05): client-side claim-evaluering fjernet. Server
    // pusher `pattern:won` direkte når mønster fullføres (BIN-689 /
    // `patternEvalMode: "auto-claim-on-draw"`).
  }

  /** Spectator / WAITING ball-draw — animate ball tube but don't mark tickets. */
  onSpectatorNumberDrawn(number: number, state: GameState): void {
    this.lastState = state;
    this.ballTube.addBall(number);
    this.centerBall.showNumber(number);
    this.calledNumbers.addNumber(number);
    this.audio.playNumber(number);
  }

  /**
   * Pattern-won broadcast — kalles fra Game1Controller / Game3Controller når
   * server pusher `pattern:won`. Bølge G (2026-05-05): claim-knapp-reset
   * fjernet siden auto-claim-on-draw (BIN-689) gjør manuell claim overflødig.
   * Metoden beholdes som no-op for kontrakt-kompatibilitet med kontrollerne.
   */
  onPatternWon(_payload: PatternWonPayload): void {
    // No-op — server eier claim-flyten via auto-claim-on-draw.
  }

  // ── Lifecycle + misc ────────────────────────────────────────────────────

  /** BIN-451/409 (D2): buy-more disabled after server threshold. */
  disableBuyMore(): void {
    this.centerTop.setBuyMoreDisabled(true, "Kjøp er stengt — trekning pågår");
  }

  enableBuyMore(): void {
    this.centerTop.setBuyMoreDisabled(false);
  }

  /** BIN-419: Elvis replace — lets the player swap pre-round tickets for a fee.
   *
   *  PIXI-P0-003 (Bølge 2A, 2026-04-28): the previous implementation
   *  appended a fresh `<div>` with two `addEventListener` calls every time
   *  `Game1Controller.transitionTo("WAITING", …)` ran, with no dedupe and
   *  no teardown ownership beyond `bar.remove()` (which leaves the bar
   *  reachable from the listener closures until GC). Over an 8h shift —
   *  many WAITING ↔ PLAYING transitions — this leaked N listeners + N DOM
   *  nodes per round.
   *
   *  Fix: track the bar in `this.elvisBar` and own its listeners via an
   *  `AbortController`. Calling `showElvisReplace` twice removes the
   *  previous bar before mounting the new one. `destroy()` aborts the
   *  controller so any remaining listeners go away with the bar. */
  showElvisReplace(replaceAmount: number, onReplace: () => void): void {
    if (replaceAmount <= 0) return;

    // Dedupe: a fresh call replaces the previous bar entirely. Without this,
    // every WAITING-transition with elvis stacked another bar at the same
    // bottom:10px coordinate.
    this.removeElvisBar();

    const abort = new AbortController();
    const { signal } = abort;

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
    btn.addEventListener(
      "click",
      () => {
        onReplace();
        this.removeElvisBar();
      },
      { signal },
    );
    bar.appendChild(btn);
    const dismissBtn = document.createElement("button");
    dismissBtn.textContent = "\u2715";
    dismissBtn.style.cssText = "background:none;border:none;color:#999;font-size:16px;cursor:pointer;";
    dismissBtn.addEventListener("click", () => this.removeElvisBar(), { signal });
    bar.appendChild(dismissBtn);
    this.overlayManager.getRoot().appendChild(bar);

    this.elvisBar = bar;
    this.elvisAbort = abort;
  }

  /**
   * PIXI-P0-003: dispose of the live Elvis bar. Aborts the listener
   * controller (revokes both click handlers) and detaches the DOM node so
   * the closure is unreachable + GC-eligible. Idempotent — safe to call
   * with no bar mounted.
   */
  private removeElvisBar(): void {
    if (this.elvisAbort) {
      this.elvisAbort.abort();
      this.elvisAbort = null;
    }
    if (this.elvisBar) {
      this.elvisBar.remove();
      this.elvisBar = null;
    }
  }

  /** Called after game-end reset from Controller. */
  reset(): void {
    this.ballTube.clear();
    this.calledNumbers.clearNumbers();
    this.ticketGrid.clear();
    this.calledNumbers.hide();
  }

  resize(width: number, height: number): void {
    this.screenW = width;
    this.screenH = height;
    if (this.bgSprite) {
      this.bgSprite.width = width;
      this.bgSprite.height = height;
    }
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

  destroy(): void {
    this.blinkDiagnosticDispose?.();
    this.blinkDiagnosticDispose = null;
    this.leftInfo.stopCountdown();
    // PIXI-P0-003: revoke any live Elvis-bar click listeners + detach the
    // DOM node before overlayManager.destroy() rips out its parent. Order
    // matters: aborting AFTER the parent is gone still works (nodes are
    // already detached) but the explicit teardown keeps the contract
    // self-evident — listeners are owned by PlayScreen, not by the
    // overlay-manager's broad sweep.
    this.removeElvisBar();
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

  /** Resize ticket grid when the chat panel collapses / expands. */
  private setupChatLayoutSync(): void {
    this.chatPanel.setOnToggle((collapsed) => {
      this.positionTicketGrid();
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
