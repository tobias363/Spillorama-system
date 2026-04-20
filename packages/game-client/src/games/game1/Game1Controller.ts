import { Container, Text } from "pixi.js";
import type { GameDeps, GameController } from "../registry.js";
import { registerGame } from "../registry.js";
import type { GameState } from "../../bridge/GameBridge.js";
import type { PatternWonPayload, MiniGameActivatedPayload } from "@spillorama/shared-types/socket-events";
import { telemetry } from "../../telemetry/Telemetry.js";
import { PlayScreen } from "./screens/PlayScreen.js";
import { EndScreen } from "../game2/screens/EndScreen.js";
import { WheelOverlay } from "./components/WheelOverlay.js";
import { TreasureChestOverlay } from "./components/TreasureChestOverlay.js";
import { MysteryGameOverlay } from "./components/MysteryGameOverlay.js";
import { ColorDraftOverlay } from "./components/ColorDraftOverlay.js";
import { LuckyNumberPicker } from "./components/LuckyNumberPicker.js";
import { LoadingOverlay } from "../../components/LoadingOverlay.js";
import { preloadGameAssets } from "../../core/preloadGameAssets.js";
import { ToastNotification } from "./components/ToastNotification.js";
import { PauseOverlay } from "./components/PauseOverlay.js";
import { SettingsPanel, type Game1Settings } from "./components/SettingsPanel.js";
import { MarkerBackgroundPanel } from "./components/MarkerBackgroundPanel.js";
import { GamePlanPanel } from "./components/GamePlanPanel.js";
import { AudioManager } from "../../audio/AudioManager.js";

/**
 * Phase-maskin for Game 1.
 *
 * - LOADING: før snapshot er applied + loader-sync (BIN-500)
 * - WAITING: ingen aktiv runde, countdown mot neste, buy-popup tilgjengelig
 * - PLAYING: aktiv runde, spilleren har billetter
 * - SPECTATING (BIN-507): aktiv runde, spilleren har 0 billetter — ser live
 *   trekning + kan kjøpe for neste runde. Overgang til PLAYING skjer ved
 *   onGameStarted hvis spilleren armet preRoundTickets. Overgang til WAITING
 *   skjer ved onGameEnded hvis ingen preRoundTickets.
 * - ENDED: runde avsluttet, resultater vises før auto-dismiss til WAITING.
 */
type Phase = "LOADING" | "WAITING" | "PLAYING" | "SPECTATING" | "ENDED";

/** Auto-dismiss delay for end screen before transitioning to waiting (ms). */
const END_SCREEN_AUTO_DISMISS_MS = 5000;

/**
 * Game 1 (Classic Bingo) controller.
 *
 * Unlike Game 2, Game 1 does NOT show a separate lobby screen.
 * The PlayScreen is shown immediately — in waiting mode it displays
 * a countdown in the center ball and a buy popup. This matches Unity.
 *
 * Game transition matches Unity's Game1GamePlayPanel.SocketFlow.cs:
 *   OnGameFinish → stop animations, clear balls, show timer
 *   OnScheduler → countdown seconds
 *   OnGameStart → rebuild tickets/patterns from fresh snapshot
 */
class Game1Controller implements GameController {
  private deps: GameDeps;
  private root: Container;
  private phase: Phase = "LOADING";
  private currentScreen: Container | null = null;
  private playScreen: PlayScreen | null = null;
  private endScreen: EndScreen | null = null;
  private miniGameOverlay: WheelOverlay | TreasureChestOverlay | MysteryGameOverlay | ColorDraftOverlay | null = null;
  private myPlayerId: string | null = null;
  private actualRoomCode: string = "";
  private unsubs: (() => void)[] = [];
  private lastMiniGamePrize = 0;
  private endScreenTimer: ReturnType<typeof setTimeout> | null = null;
  private gameRoundCount = 0;
  private luckyPicker: LuckyNumberPicker | null = null;
  private loader: LoadingOverlay | null = null;
  private toast: ToastNotification | null = null;
  private pauseOverlay: PauseOverlay | null = null;
  private settingsPanel: SettingsPanel | null = null;
  private markerBgPanel: MarkerBackgroundPanel | null = null;
  private gamePlanPanel: GamePlanPanel | null = null;

  constructor(deps: GameDeps) {
    this.deps = deps;
    this.root = new Container();
  }

  async start(): Promise<void> {
    const { app, socket, bridge } = this.deps;
    app.stage.addChild(this.root);

    // UI overlays (Unity: DisplayLoader, UtilityMessagePanel)
    const overlayContainer = app.app.canvas.parentElement ?? document.body;
    this.loader = new LoadingOverlay(overlayContainer);
    // BIN-673: typed state-machine drives all loader messages. 5-sec stuck
    // threshold triggers the "Last siden på nytt" reload button.
    this.loader.setState("CONNECTING");
    this.toast = new ToastNotification(overlayContainer);
    this.pauseOverlay = new PauseOverlay(overlayContainer);
    this.settingsPanel = new SettingsPanel(overlayContainer);
    // Wire settings panel to AudioManager
    this.syncSettingsToAudio(this.settingsPanel.getSettings());
    this.settingsPanel.setOnChange((settings) => this.syncSettingsToAudio(settings));
    this.markerBgPanel = new MarkerBackgroundPanel(overlayContainer);
    this.gamePlanPanel = new GamePlanPanel(overlayContainer);

    // Connect socket
    socket.connect();

    const connected = await new Promise<boolean>((resolve) => {
      if (socket.isConnected()) { resolve(true); return; }
      const timeout = setTimeout(() => { resolve(false); }, 10000);
      const unsub = socket.on("connectionStateChanged", (state) => {
        if (state === "connected") { unsub(); clearTimeout(timeout); resolve(true); }
      });
    });

    if (!connected) {
      this.loader.hide();
      this.showError("Kunne ikke koble til server");
      return;
    }

    this.unsubs.push(
      socket.on("connectionStateChanged", (state) => {
        if (state === "reconnecting") {
          telemetry.trackReconnect();
          this.loader?.setState("RECONNECTING");
        }
        if (state === "connected" && this.loader?.isShowing()) {
          // Reconnected — resume room to rebuild state from server snapshot
          this.handleReconnect();
        }
        if (state === "disconnected") {
          telemetry.trackDisconnect("socket");
          this.loader?.setState("DISCONNECTED");
        }
      }),
    );

    // BIN-673: Pre-warm Pixi asset cache before joining the room. On slow
    // networks users get explicit "Laster spill..." feedback; on fast
    // networks this resolves near-instantly because assets are small.
    this.loader.setState("LOADING_ASSETS");
    await preloadGameAssets("bingo");

    // Join or create room
    this.loader.setState("JOINING_ROOM");
    const joinResult = await socket.createRoom({
      hallId: this.deps.hallId,
      gameSlug: "bingo",
    });

    if (!joinResult.ok || !joinResult.data) {
      this.loader.hide();
      console.error("[Game1] Room join failed:", joinResult.error);
      this.showError(joinResult.error?.message || "Kunne ikke joine rom");
      return;
    }

    this.myPlayerId = joinResult.data.playerId;
    this.actualRoomCode = joinResult.data.roomCode;

    // Start bridge
    bridge.start(this.myPlayerId);
    bridge.applySnapshot(joinResult.data.snapshot);

    this.unsubs.push(
      bridge.on("stateChanged", (state) => this.onStateChanged(state)),
      bridge.on("gameStarted", (state) => this.onGameStarted(state)),
      bridge.on("gameEnded", (state) => this.onGameEnded(state)),
      bridge.on("numberDrawn", (num, idx, state) => this.onNumberDrawn(num, idx, state)),
      bridge.on("patternWon", (result, state) => this.onPatternWon(result, state)),
      bridge.on("minigameActivated", (data) => this.onMiniGameActivated(data)),
    );

    // Lucky number picker (persists across screen transitions)
    const pickerContainer = this.deps.app.app.canvas.parentElement ?? document.body;
    this.luckyPicker = new LuckyNumberPicker(pickerContainer);
    this.luckyPicker.setOnSelect((n) => this.handleLuckyNumber(n));

    // Unlock audio
    this.root.eventMode = "static";
    this.root.on("pointerdown", () => this.deps.audio.unlock(), { once: true });

    // No auto-arm — player must explicitly buy tickets via the popup.
    // (Unity also requires explicit purchase via Game1TicketPurchasePanel.)

    // BIN-500: Loader-barriere.
    // En late-joiner kan komme inn mens en runde kjører. Før loader fjernes må
    // vi være sikre på at klienten rendrer samme tilstand som andre spillere:
    //   (a) socket connected  — allerede verifisert over
    //   (b) snapshot applied  — gjort via bridge.applySnapshot() like over
    //   (c) audio/SFX lastet  — preload ferdig (AudioManager.preloadSfx ble kalt i init)
    //   (d) hvis RUNNING: minst én live room:update ELLER numberDrawn mottatt
    //       (beviser at socket faktisk leverer — ikke bare er connected)
    await this.waitForSyncReady();

    // Hide loader — game is ready (Unity: DisplayLoader(false))
    this.loader.setState("READY");

    // Transition based on state
    const state = bridge.getState();

    if (state.gameStatus === "RUNNING") {
      // BIN-507: late-joiner med billetter → PLAYING, uten → SPECTATING
      if (state.myTickets.length > 0) {
        this.transitionTo("PLAYING", state);
      } else {
        this.transitionTo("SPECTATING", state);
      }
    } else {
      this.transitionTo("WAITING", state);
    }
  }

  /**
   * BIN-500: Hold loader til klient er synkronisert med resten av rommet.
   *
   * Checkpoint (d) gjelder bare hvis runde allerede er RUNNING ved inngang.
   * For WAITING eller ENDED er det ingen live event å vente på — snapshot
   * er autoritativ og vi kan slippe loader.
   *
   * Timeout: maks 5 sek. Hvis backend er tregt, hellere vis tom state enn
   * evig loader — bruker ser da live events komme inn fortløpende.
   */
  private async waitForSyncReady(): Promise<void> {
    const { bridge } = this.deps;
    const syncStartedAt = Date.now();
    const SYNC_TIMEOUT_MS = 5000;

    const state = bridge.getState();
    const isRunningAtEntry = state.gameStatus === "RUNNING";

    if (isRunningAtEntry) {
      this.loader?.setState("SYNCING");
    }

    // Audio-assets: AudioManager.preloadSfx() returnerer void men bruker Howler's
    // own preload. Vi venter ikke på en eksplisitt promise her — Howler spiller
    // med silent-fallback hvis en SFX enda ikke er dekodet. Men nummerannouncement-
    // clips er lazy, så det er OK at de ikke er lastet ved sync-tid.

    // Vent på første live event hvis RUNNING
    if (isRunningAtEntry) {
      const gotLiveEvent = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), SYNC_TIMEOUT_MS);
        const unsubDraw = bridge.on("numberDrawn", () => {
          clearTimeout(timer);
          unsubDraw();
          unsubState();
          resolve(true);
        });
        const unsubState = bridge.on("stateChanged", (s) => {
          // room:update → stateChanged. Hvis vi får oppdatert drawnNumbers-lengde
          // eller en phase-transition, regnes det som "live".
          if (s.drawnNumbers.length > state.drawnNumbers.length) {
            clearTimeout(timer);
            unsubDraw();
            unsubState();
            resolve(true);
          }
        });
      });

      const syncGap = Date.now() - syncStartedAt;
      telemetry.trackEvent("late_join_sync", { syncGapMs: syncGap, gotLiveEvent });
      if (!gotLiveEvent) {
        console.warn(
          `[Game1] sync-timeout etter ${syncGap}ms — slipper loader med snapshot-state`,
        );
      } else {
        console.debug(`[Game1] late-join sync OK etter ${syncGap}ms`);
      }
    } else {
      // Ikke RUNNING — snapshot er tilstrekkelig baseline.
      telemetry.trackEvent("late_join_sync", {
        syncGapMs: Date.now() - syncStartedAt,
        gotLiveEvent: false,
        skipped: "not-running",
      });
    }
  }

  resize(width: number, height: number): void {
    if (this.playScreen) {
      this.playScreen.resize(width, height);
    }
  }

  destroy(): void {
    if (this.endScreenTimer) { clearTimeout(this.endScreenTimer); this.endScreenTimer = null; }
    this.luckyPicker?.destroy();
    this.luckyPicker = null;
    this.loader?.destroy();
    this.loader = null;
    this.toast?.destroy();
    this.toast = null;
    this.pauseOverlay?.destroy();
    this.pauseOverlay = null;
    this.settingsPanel?.destroy();
    this.settingsPanel = null;
    this.markerBgPanel?.destroy();
    this.markerBgPanel = null;
    this.gamePlanPanel?.destroy();
    this.gamePlanPanel = null;
    for (const unsub of this.unsubs) unsub();
    this.unsubs = [];
    this.miniGameOverlay?.destroy({ children: true });
    this.miniGameOverlay = null;
    this.clearScreen();
    this.root.destroy({ children: true });
  }

  // ── State transitions ─────────────────────────────────────────────────

  private transitionTo(phase: Phase, state: GameState): void {
    this.phase = phase;
    this.clearScreen();

    const w = this.deps.app.app.screen.width;
    const h = this.deps.app.app.screen.height;

    switch (phase) {
      case "WAITING": {
        // Show PlayScreen in waiting mode — countdown + buy popup, no separate lobby
        this.lastMiniGamePrize = 0;
        const container = this.deps.app.app.canvas.parentElement ?? document.body;
        this.playScreen = new PlayScreen(w, h, this.deps.audio, this.deps.socket, this.actualRoomCode, container, this.deps.bridge);
        this.playScreen.setOnClaim((type) => this.handleClaim(type));
        this.playScreen.setOnBuy((selections) => this.handleBuy(selections));
        this.playScreen.setOnLuckyNumberTap(() => this.openLuckyPicker());
        this.playScreen.setOnCancelTickets(() => this.handleCancelTickets());
        this.playScreen.setOnOpenSettings(() => this.settingsPanel?.show());
        this.playScreen.setOnOpenMarkerBg(() => this.markerBgPanel?.show());
        this.playScreen.setOnStartGame(() => this.handleStartGame());
        this.playScreen.subscribeChatToBridge((listener) =>
          this.deps.bridge.on("chatMessage", listener),
        );
        this.playScreen.enterWaitingMode(state);
        // BIN-410 (D3): Show upcoming-purchase side panel for preRound arming.
        // Only in WAITING — SPECTATING/PLAYING hide it (Q4 2026-04-18).
        this.playScreen.showUpcomingPurchase(state);
        // BIN-409 (D2): Re-enable Kjøp-flere when entering a new WAITING cycle.
        this.playScreen.enableBuyMore();
        // BIN-419: Show Elvis replace option in waiting mode
        if (state.gameType === "elvis" && state.myTickets.length > 0 && state.replaceAmount > 0) {
          this.playScreen.showElvisReplace(state.replaceAmount, () => this.handleElvisReplace());
        }
        this.setScreen(this.playScreen);
        break;
      }

      case "PLAYING": {
        this.lastMiniGamePrize = 0;
        const container = this.deps.app.app.canvas.parentElement ?? document.body;
        this.playScreen = new PlayScreen(w, h, this.deps.audio, this.deps.socket, this.actualRoomCode, container, this.deps.bridge);
        this.playScreen.setOnClaim((type) => this.handleClaim(type));
        this.playScreen.setOnBuy((selections) => this.handleBuy(selections));
        this.playScreen.setOnLuckyNumberTap(() => this.openLuckyPicker());
        this.playScreen.setOnCancelTickets(() => this.handleCancelTickets());
        this.playScreen.setOnOpenSettings(() => this.settingsPanel?.show());
        this.playScreen.setOnOpenMarkerBg(() => this.markerBgPanel?.show());
        this.playScreen.setOnStartGame(() => this.handleStartGame());
        this.playScreen.subscribeChatToBridge((listener) =>
          this.deps.bridge.on("chatMessage", listener),
        );
        this.playScreen.buildTickets(state);
        this.playScreen.updateInfo(state);
        // BIN-410 (D3): Upcoming-panel skjules under PLAYING (buildTickets
        // kaller allerede hide, men eksplisitt her for tydelig phase-rensk).
        this.playScreen.hideUpcomingPurchase();
        // BIN-409 (D2): Fresh PLAYING-transition — reset buy-more til enabled.
        // Per-ball sjekk i onNumberDrawn setter den til disabled igjen når
        // drawCount krysser threshold.
        this.playScreen.enableBuyMore();
        this.setScreen(this.playScreen);
        break;
      }

      case "SPECTATING": {
        // BIN-507: Late-joiner / ubemannet runde. Spilleren har 0 billetter
        // men skal se live trekning, chat, patterns og jackpot. Buy-popup
        // er tilgjengelig for å arme for NESTE runde (preRoundTickets).
        // Mark/claim er server-guardet mot spillere uten billetter.
        this.lastMiniGamePrize = 0;
        const container = this.deps.app.app.canvas.parentElement ?? document.body;
        this.playScreen = new PlayScreen(w, h, this.deps.audio, this.deps.socket, this.actualRoomCode, container, this.deps.bridge);
        // Mark/claim-handlers beholdes for konsistens — server returnerer feil
        // hvis spectator prøver. Klient-UI viser ikke mark-knapper når
        // myTickets er tom (PlayScreen renderer tom ticket-list).
        this.playScreen.setOnClaim((type) => this.handleClaim(type));
        this.playScreen.setOnBuy((selections) => this.handleBuy(selections));
        this.playScreen.setOnLuckyNumberTap(() => this.openLuckyPicker());
        this.playScreen.setOnCancelTickets(() => this.handleCancelTickets());
        this.playScreen.setOnOpenSettings(() => this.settingsPanel?.show());
        this.playScreen.setOnOpenMarkerBg(() => this.markerBgPanel?.show());
        this.playScreen.setOnStartGame(() => this.handleStartGame());
        this.playScreen.subscribeChatToBridge((listener) =>
          this.deps.bridge.on("chatMessage", listener),
        );
        // Samme render som PLAYING: live draws via CenterBall, chat, patterns.
        // buildTickets(state) med myTickets=[] gir tom ticket-seksjon men
        // CenterBall + DrawnBalls + PatternMiniGrid kjører som vanlig.
        this.playScreen.buildTickets(state);
        this.playScreen.updateInfo(state);
        // BIN-410 (D3, Q4 2026-04-18): Upcoming-panel skal IKKE vises under
        // SPECTATING — Unity viser det kun mellom runder.
        this.playScreen.hideUpcomingPurchase();
        // BIN-619 (2026-04-19): Spectator mid-round buy — tickets armed for
        // NEXT round render immediately in the scroller, but without marks
        // (owner: "selvfølgelig ikke disse bongene aktive i den trekningen").
        this.playScreen.renderPreRoundTickets(state);
        this.setScreen(this.playScreen);
        break;
      }

      case "ENDED":
        this.endScreen = new EndScreen(w, h);
        this.endScreen.setOnDismiss(() => {
          this.transitionTo("WAITING", this.deps.bridge.getState());
        });
        this.endScreen.show(state);
        if (this.lastMiniGamePrize > 0 && typeof (this.endScreen as any).showMiniGameBonus === "function") {
          (this.endScreen as any).showMiniGameBonus(this.lastMiniGamePrize);
        }
        this.setScreen(this.endScreen);
        break;
    }
  }

  // ── Bridge event handlers ─────────────────────────────────────────────

  private onStateChanged(state: GameState): void {
    console.log("[Game1] stateChanged — phase:", this.phase, "gameStatus:", state.gameStatus, "myTickets:", state.myTickets.length, "myStake:", state.myStake, "isArmed:", state.isArmed);
    if (this.phase === "WAITING" && this.playScreen) {
      this.playScreen.updateWaitingState(state);
    }
    if (this.phase === "PLAYING" && this.playScreen) {
      this.playScreen.updateInfo(state);
    }
    // BIN-507: SPECTATING får samme live-oppdateringer som PLAYING (draws,
    // patterns, playerStakes). Hvis spilleren armer preRoundTickets mens de
    // er SPECTATING, forblir fasen — overgang til PLAYING skjer først ved
    // onGameStarted for neste runde.
    // BIN-619: Spectator-mid-round buy → re-render pre-round tickets when
    // count changes. PlayScreen caches the count so unchanged states are
    // a no-op (SPECTATING sees one stateChanged per drawn number).
    if (this.phase === "SPECTATING" && this.playScreen) {
      this.playScreen.updateInfo(state);
      this.playScreen.renderPreRoundTickets(state);
    }

    // BIN-460: Show/hide pause overlay based on game state
    if (state.isPaused && !this.pauseOverlay?.isShowing()) {
      this.pauseOverlay?.show(state.pauseMessage ?? undefined);
    } else if (!state.isPaused && this.pauseOverlay?.isShowing()) {
      this.pauseOverlay?.hide();
      this.toast?.info("Spillet er gjenopptatt");
    }
  }

  private onGameStarted(state: GameState): void {
    // Clear any pending end screen auto-dismiss
    if (this.endScreenTimer) { clearTimeout(this.endScreenTimer); this.endScreenTimer = null; }

    this.gameRoundCount++;
    this.buyMoreDisabled = false;
    // BIN-409 (D2): Ny runde — reset buy-more button til enabled state.
    // Unity parity: `Game1GamePlayPanel.SocketFlow.cs` setter `BuyMoreDisableFlagVal`
    // false ved OnGameStart. Upcoming-panel skjules også (runde pågår).
    this.playScreen?.enableBuyMore();
    this.playScreen?.hideUpcomingPurchase();

    // Reset announced numbers for the new round
    this.deps.audio.resetAnnouncedNumbers();

    // Unity OnGameStart: close lucky number panel, hide delete buttons
    this.luckyPicker?.hide();

    console.log("[Game1] onGameStarted — myTickets:", state.myTickets.length, "gameStatus:", state.gameStatus, "isArmed:", state.isArmed, "myPlayerId:", state.myPlayerId, "preRoundTickets:", state.preRoundTickets.length);

    if (state.myTickets.length > 0) {
      console.log("[Game1] → PLAYING (has tickets)");
      this.transitionTo("PLAYING", state);
    } else {
      // BIN-507: runde starter uten at spilleren armet billetter → SPECTATING.
      // Tidligere falt de til WAITING som viste countdown mot neste runde —
      // forvirrende fordi trekning allerede er i gang.
      console.log("[Game1] → SPECTATING (no tickets, round is running)");
      this.transitionTo("SPECTATING", state);
    }
  }

  private onGameEnded(state: GameState): void {
    // Dismiss any active mini-game overlay so it doesn't block the EndScreen
    this.dismissMiniGame();

    // Unity OnGameFinish: stop blink animations, reset sounds
    // (Game1GamePlayPanel.SocketFlow.cs:595-616 iterates Active_BingoTickets
    //  and calls Stop_Blink on each ticket.)
    this.deps.audio.resetAnnouncedNumbers();
    this.deps.audio.stopAll();

    // Hard-reset every inline ticket's animations (cell blinks, mark bounces,
    // card BINGO pulse, bg blink, in-flight flip) so nothing keeps animating
    // after we transition to EndScreen/WAITING. Without this, a 1-to-go cell
    // that was mid-blink or a card mid-BINGO-pulse at game-end would continue
    // animating on the EndScreen background.
    //
    // Unity refs:
    //   - Stop_Blink on ticket:  BingoTicket.cs:1011-1016
    //   - Stop_NumberBlink cell: BingoTicketSingleCellData.cs:195-205
    if (this.playScreen) {
      for (const card of this.playScreen.getInlineCards()) {
        card.stopAllAnimations();
      }
    }

    // Refresh player balance (Unity: dispatch balance event for game-bar sync)
    if (this.myPlayerId) {
      const me = state.players.find((p) => p.id === this.myPlayerId);
      if (me && typeof me.balance === "number" && typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("spillorama:balanceChanged", { detail: { balance: me.balance } }));
      }
    }

    if (this.phase === "PLAYING") {
      this.transitionTo("ENDED", state);

      // Auto-dismiss EndScreen after a delay — matches Unity's immediate
      // transition to waiting mode with countdown timer.
      this.endScreenTimer = setTimeout(() => {
        this.endScreenTimer = null;
        if (this.phase === "ENDED") {
          this.transitionTo("WAITING", this.deps.bridge.getState());
        }
      }, END_SCREEN_AUTO_DISMISS_MS);
    } else {
      this.transitionTo("WAITING", state);
    }
    // No auto-arm after game end — player chooses in the buy popup.
  }

  private buyMoreDisabled = false;

  private onNumberDrawn(number: number, drawIndex: number, state: GameState): void {
    if (this.phase === "PLAYING" && this.playScreen) {
      this.playScreen.onNumberDrawn(number, drawIndex, state);

      // BIN-451: Disable buy-more using server-authoritative threshold (Unity: BuyMoreDisableFlagVal)
      if (!this.buyMoreDisabled && state.disableBuyAfterBalls > 0 && state.drawCount >= state.disableBuyAfterBalls) {
        this.buyMoreDisabled = true;
        this.playScreen.disableBuyMore();
      }
    } else if ((this.phase === "WAITING" || this.phase === "SPECTATING") && this.playScreen) {
      // BIN-507: Both WAITING (legacy sparse spectator path) and SPECTATING
      // (late-joiner midt i runde) viser live ball-animasjon uten ticket-marking.
      this.playScreen.onSpectatorNumberDrawn(number, state);
    }
  }

  private onPatternWon(result: PatternWonPayload, _state: GameState): void {
    if (this.phase === "PLAYING" && this.playScreen) this.playScreen.onPatternWon(result);

    // Toast notification (Unity: OnPatternWon_Spillorama shows winner info)
    const isMe = result.winnerId === this.myPlayerId;
    if (isMe) {
      this.toast?.win(`Du vant ${result.patternName}! ${result.payoutAmount} kr`);
      this.deps.audio.playBingoSound();
    } else {
      this.toast?.info(`${result.patternName} vunnet av en annen spiller`);
    }

    telemetry.trackEvent("pattern_won", {
      patternName: result.patternName,
      isMe,
      payoutAmount: result.payoutAmount,
    });
  }

  // ── User actions ──────────────────────────────────────────────────────

  private async handleBuy(selections: Array<{ type: string; qty: number; name?: string }> = []): Promise<void> {
    // If selections are provided (new per-type path), send ticketSelections.
    // BIN-688: `name` is forwarded so the backend can colour pre-round
    // tickets per the player's specific colour pick (Small Yellow vs
    // Small Purple both share type="small").
    // Otherwise fall back to flat ticketCount for backward compat.
    const payload: { roomCode: string; armed: true; ticketCount?: number; ticketSelections?: Array<{ type: string; qty: number; name?: string }> } = {
      roomCode: this.actualRoomCode,
      armed: true,
    };
    if (selections.length > 0) {
      payload.ticketSelections = selections;
    } else {
      payload.ticketCount = 1;
    }
    const result = await this.deps.socket.armBet(payload);
    this.playScreen?.showBuyPopupResult(result.ok, result.error?.message);
    if (!result.ok) {
      this.showError(result.error?.message || "Kunne ikke kjøpe billetter");
    }
  }

  /** A6: Host/admin manual game start — calls game:start on the socket. */
  private async handleStartGame(): Promise<void> {
    const result = await this.deps.socket.startGame({ roomCode: this.actualRoomCode });
    if (!result.ok) {
      this.toast?.error(result.error?.message || "Kunne ikke starte spillet");
    }
  }

  private async handleClaim(type: "LINE" | "BINGO"): Promise<void> {
    // BIN-420 G26 Gap #3: Spectators have no tickets — submitting a claim is
    // a no-op server-side, but we surface a user-visible message instead of a
    // silent return so behaviour matches Unity's claim-denied feedback.
    if (this.phase === "SPECTATING") {
      this.toast?.info("Tilskuere kan ikke gjøre claims");
      return;
    }

    const result = await this.deps.socket.submitClaim({ roomCode: this.actualRoomCode, type });
    if (!result.ok) {
      // Gap #1: promote server error to a visible toast instead of silent console log.
      // Gap #2: revert the claim button from "Sendt..." back to "ready" so the
      //         user can retry (Unity: claim-denied → button re-enabled).
      this.toast?.error(result.error?.message ?? `Ugyldig ${type === "LINE" ? "rekke" : "bingo"}-claim`);
      this.playScreen?.resetClaimButton(type);
      console.error("[Game1] Claim failed:", result.error);
    }
  }

  /** Unity: Cancel/delete tickets = disarm player (bet:arm false). */
  private async handleCancelTickets(): Promise<void> {
    const result = await this.deps.socket.armBet({ roomCode: this.actualRoomCode, armed: false });
    if (result.ok) {
      this.toast?.info("Bonger avbestilt");
      // Clear tickets from display and show buy popup
      if (this.playScreen) {
        this.playScreen.reset();
        const state = this.deps.bridge.getState();
        this.playScreen.enterWaitingMode(state);
      }
    } else {
      this.toast?.error(result.error?.message || "Kunne ikke avbestille");
    }
  }

  private async handleLuckyNumber(n: number): Promise<void> {
    const result = await this.deps.socket.setLuckyNumber({
      roomCode: this.actualRoomCode,
      luckyNumber: n,
    });
    if (result.ok) {
      // Highlight on all tickets in current PlayScreen
      if (this.playScreen && n > 0) {
        for (const card of this.playScreen.getInlineCards()) {
          card.highlightLuckyNumber(n);
        }
      }
    } else {
      console.error("[Game1] setLuckyNumber failed:", result.error);
    }
  }

  /** BIN-419: Elvis replace — re-arm with new tickets for a fee. */
  private async handleElvisReplace(): Promise<void> {
    // Disarm (cancel old tickets) then re-arm (get new ones)
    await this.deps.socket.armBet({ roomCode: this.actualRoomCode, armed: false });
    const result = await this.deps.socket.armBet({ roomCode: this.actualRoomCode, armed: true });
    if (result.ok) {
      this.toast?.info("Bonger byttet!");
      // Rebuild from fresh snapshot
      const state = this.deps.bridge.getState();
      if (this.playScreen) {
        this.playScreen.reset();
        this.playScreen.enterWaitingMode(state);
      }
    } else {
      this.toast?.error("Kunne ikke bytte bonger");
    }
  }

  private openLuckyPicker(): void {
    const state = this.deps.bridge.getState();
    this.luckyPicker?.show(state.myLuckyNumber);
  }

  // ── Mini-game handlers ────────────────────────────────────────────────

  private onMiniGameActivated(data: MiniGameActivatedPayload): void {
    const w = this.deps.app.app.screen.width;
    const h = this.deps.app.app.screen.height;

    if (data.type === "wheelOfFortune") {
      // BIN-420 G21: pass bridge so auto-spin and rotation freeze on pause.
      const overlay = new WheelOverlay(w, h, this.deps.bridge);
      overlay.setOnPlay(() => this.handleMiniGamePlay());
      overlay.setOnDismiss(() => this.dismissMiniGame());
      this.miniGameOverlay = overlay;
      this.root.addChild(overlay);
      overlay.show(data);
    } else if (data.type === "mysteryGame") {
      const overlay = new MysteryGameOverlay(w, h);
      overlay.setOnPlay((idx) => this.handleMiniGamePlay(idx));
      overlay.setOnDismiss(() => this.dismissMiniGame());
      this.miniGameOverlay = overlay;
      this.root.addChild(overlay);
      overlay.show(data);
    } else if (data.type === "colorDraft") {
      const overlay = new ColorDraftOverlay(w, h);
      overlay.setOnPlay((idx) => this.handleMiniGamePlay(idx));
      overlay.setOnDismiss(() => this.dismissMiniGame());
      this.miniGameOverlay = overlay;
      this.root.addChild(overlay);
      overlay.show(data);
    } else {
      // Default: TreasureChest — bridge for pause-aware auto-select timer.
      const overlay = new TreasureChestOverlay(w, h, this.deps.bridge);
      overlay.setOnPlay((idx) => this.handleMiniGamePlay(idx));
      overlay.setOnDismiss(() => this.dismissMiniGame());
      this.miniGameOverlay = overlay;
      this.root.addChild(overlay);
      overlay.show(data);
    }

    telemetry.trackEvent("minigame_activated", { type: data.type });
  }

  private async handleMiniGamePlay(selectedIndex?: number): Promise<void> {
    const result = await this.deps.socket.playMiniGame({
      roomCode: this.actualRoomCode,
      selectedIndex,
    });
    if (result.ok && result.data) {
      this.lastMiniGamePrize = result.data.prizeAmount;
      this.miniGameOverlay?.animateResult(result.data);
      telemetry.trackEvent("minigame_played", {
        type: result.data.type,
        prizeAmount: result.data.prizeAmount,
      });
    } else {
      console.error("[Game1] Mini-game play failed:", result.error);
    }
  }

  private dismissMiniGame(): void {
    this.miniGameOverlay?.destroy({ children: true });
    this.miniGameOverlay = null;
  }

  // ── Reconnect handling ────────────────────────────────────────────────

  /**
   * Resume room after socket reconnect — rebuild state from server snapshot.
   * Matches Unity's reconnect flow: call room:resume, apply snapshot,
   * deduplicate draws, and transition to the correct phase.
   */
  private async handleReconnect(): Promise<void> {
    if (!this.actualRoomCode) {
      this.loader?.setState("READY");
      return;
    }

    // BIN-673 + BIN-682: show RESYNCING while we fetch + apply a fresh
    // snapshot from the server. Without this, the loader stayed on
    // "Kobler til igjen..." until the socket reconnected, then dismissed
    // immediately — but `applySnapshot` runs AFTER dismiss, so the UI
    // briefly showed stale state. With RESYNCING we keep the overlay up
    // through the full fetch → apply → re-render cycle.
    this.loader?.setState("RESYNCING");

    try {
      const result = await this.deps.socket.resumeRoom({ roomCode: this.actualRoomCode });
      let snapshot = result.ok ? result.data?.snapshot : null;

      // Fallback: if resumeRoom didn't return a snapshot, try getRoomState.
      // This covers the case where the room was recovered from checkpoint
      // but the user's session state is out of sync.
      if (!snapshot) {
        if (!result.ok) {
          console.warn("[Game1] Room resume failed, trying getRoomState:", result.error?.message);
        }
        const fallback = await this.deps.socket.getRoomState({ roomCode: this.actualRoomCode });
        snapshot = fallback.ok ? fallback.data?.snapshot ?? null : null;
      }

      if (snapshot) {
        this.deps.bridge.applySnapshot(snapshot);
        const state = this.deps.bridge.getState();

        // Transition based on current game status (BIN-507: RUNNING + 0
        // tickets → SPECTATING). transitionTo rebuilds PlayScreen which
        // reads the freshly-applied snapshot — ensures ball-count, tickets,
        // and draws match server state post-reconnect.
        if (state.gameStatus === "RUNNING") {
          if (state.myTickets.length > 0) {
            this.transitionTo("PLAYING", state);
          } else {
            this.transitionTo("SPECTATING", state);
          }
        } else {
          this.transitionTo("WAITING", state);
        }

        // State fully rebuilt — dismiss overlay.
        this.loader?.setState("READY");
        console.log("[Game1] Reconnected — state restored, phase:", this.phase);
      } else {
        // Both paths failed — leave overlay in RESYNCING state. The
        // stuck-timer (5s) will surface the "Last siden på nytt" button
        // so the user isn't trapped.
        console.error("[Game1] Both resumeRoom and getRoomState failed — user must reload");
      }
    } catch (err) {
      console.error("[Game1] Reconnect error:", err);
      // Overlay stays in RESYNCING — stuck-timer shows reload button.
    }

    // BIN-673: Do NOT unconditionally hide the loader here. The success
    // path already called setState("READY"); the failure paths deliberately
    // leave the overlay up so the stuck-timer can show "Last siden på nytt".
    // Dismissing here would strand the user with stale UI + no signal.
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  private setScreen(screen: Container): void {
    this.currentScreen = screen;
    this.root.addChild(screen);
  }

  private clearScreen(): void {
    if (this.currentScreen) {
      this.currentScreen.destroy({ children: true });
      this.currentScreen = null;
    }
    this.playScreen = null;
    this.endScreen = null;
  }

  /**
   * Sync SettingsPanel settings to AudioManager.
   * Called on init and whenever settings change.
   */
  private syncSettingsToAudio(settings: Game1Settings): void {
    const audio = this.deps.audio;
    audio.setSoundEnabled(settings.soundEnabled);
    audio.setVoiceEnabled(settings.voiceEnabled);
    audio.setVoiceLanguage(AudioManager.settingsToVoice(settings.voiceLanguage));
    audio.setDoubleAnnounce(settings.doubleAnnounce);
  }

  private showError(message: string): void {
    // Use toast if available, fallback to centered text
    if (this.toast) {
      this.toast.error(message, 8000);
    } else {
      const errorText = new Text({
        text: message,
        style: { fontFamily: "Arial", fontSize: 24, fill: 0xff4444, align: "center" },
      });
      errorText.anchor.set(0.5);
      errorText.x = this.deps.app.app.screen.width / 2;
      errorText.y = this.deps.app.app.screen.height / 2;
      this.root.addChild(errorText);
    }
  }
}

// Register in the game registry
registerGame("bingo", (deps) => new Game1Controller(deps));
registerGame("game_1", (deps) => new Game1Controller(deps));
