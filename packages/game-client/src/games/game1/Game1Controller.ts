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
import { LoadingOverlay } from "./components/LoadingOverlay.js";
import { ToastNotification } from "./components/ToastNotification.js";
import { PauseOverlay } from "./components/PauseOverlay.js";
import { SettingsPanel } from "./components/SettingsPanel.js";
import { MarkerBackgroundPanel } from "./components/MarkerBackgroundPanel.js";
import { GamePlanPanel } from "./components/GamePlanPanel.js";

type Phase = "LOADING" | "WAITING" | "PLAYING" | "ENDED";

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
    this.loader.show("Kobler til...");
    this.toast = new ToastNotification(overlayContainer);
    this.pauseOverlay = new PauseOverlay(overlayContainer);
    this.settingsPanel = new SettingsPanel(overlayContainer);
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
          this.loader?.show("Kobler til igjen...");
        }
        if (state === "connected" && this.loader?.isShowing()) {
          this.loader.hide();
        }
        if (state === "disconnected") {
          telemetry.trackDisconnect("socket");
          this.loader?.show("Frakoblet — prøver igjen...");
        }
      }),
    );

    // Join or create room
    this.loader.show("Joiner rom...");
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

    // Auto-arm
    await socket.armBet({ roomCode: this.actualRoomCode, armed: true });

    // Hide loader — game is ready (Unity: DisplayLoader(false))
    this.loader.hide();

    // Transition based on state
    const state = bridge.getState();

    if (state.gameStatus === "RUNNING" && state.myTickets.length > 0) {
      this.transitionTo("PLAYING", state);
    } else {
      this.transitionTo("WAITING", state);
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
        this.playScreen = new PlayScreen(w, h, this.deps.audio, this.deps.socket, this.actualRoomCode, container);
        this.playScreen.setOnClaim((type) => this.handleClaim(type));
        this.playScreen.setOnBuy(() => this.handleBuy());
        this.playScreen.setOnLuckyNumberTap(() => this.openLuckyPicker());
        this.playScreen.setOnCancelTickets(() => this.handleCancelTickets());
        this.playScreen.setOnOpenSettings(() => this.settingsPanel?.show());
        this.playScreen.setOnOpenMarkerBg(() => this.markerBgPanel?.show());
        this.playScreen.subscribeChatToBridge((listener) =>
          this.deps.bridge.on("chatMessage", listener),
        );
        this.playScreen.enterWaitingMode(state);
        // BIN-419: Show Elvis replace option in waiting mode
        if (state.gameType === "elvis" && state.myTickets.length > 0) {
          this.playScreen.showElvisReplace(0, () => this.handleElvisReplace());
        }
        this.setScreen(this.playScreen);
        break;
      }

      case "PLAYING": {
        this.lastMiniGamePrize = 0;
        const container = this.deps.app.app.canvas.parentElement ?? document.body;
        this.playScreen = new PlayScreen(w, h, this.deps.audio, this.deps.socket, this.actualRoomCode, container);
        this.playScreen.setOnClaim((type) => this.handleClaim(type));
        this.playScreen.setOnBuy(() => this.handleBuy());
        this.playScreen.setOnLuckyNumberTap(() => this.openLuckyPicker());
        this.playScreen.setOnCancelTickets(() => this.handleCancelTickets());
        this.playScreen.setOnOpenSettings(() => this.settingsPanel?.show());
        this.playScreen.setOnOpenMarkerBg(() => this.markerBgPanel?.show());
        this.playScreen.subscribeChatToBridge((listener) =>
          this.deps.bridge.on("chatMessage", listener),
        );
        this.playScreen.buildTickets(state);
        this.playScreen.updateInfo(state);
        this.setScreen(this.playScreen);
        break;
      }

      case "ENDED":
        this.endScreen = new EndScreen(w, h);
        this.endScreen.setOnDismiss(() => {
          this.transitionTo("WAITING", this.deps.bridge.getState());
        });
        this.endScreen.show(state);
        if (this.lastMiniGamePrize > 0) {
          this.endScreen.showMiniGameBonus(this.lastMiniGamePrize);
        }
        this.setScreen(this.endScreen);
        break;
    }
  }

  // ── Bridge event handlers ─────────────────────────────────────────────

  private onStateChanged(state: GameState): void {
    if (this.phase === "WAITING" && this.playScreen) {
      this.playScreen.updateWaitingState(state);
    }
    if (this.phase === "PLAYING" && this.playScreen) {
      this.playScreen.updateInfo(state);
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

    if (state.myTickets.length > 0) {
      this.transitionTo("PLAYING", state);
    } else {
      // Spectator: go to waiting mode so they can see the game in progress
      // (Unity stays on the same panel and just hides the buy UI)
      this.transitionTo("WAITING", state);
    }
  }

  private onGameEnded(state: GameState): void {
    // Dismiss any active mini-game overlay so it doesn't block the EndScreen
    this.dismissMiniGame();

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
    this.deps.socket.armBet({ roomCode: this.actualRoomCode, armed: true });
  }

  private buyMoreDisabled = false;

  private onNumberDrawn(number: number, drawIndex: number, state: GameState): void {
    if (this.phase === "PLAYING" && this.playScreen) {
      this.playScreen.onNumberDrawn(number, drawIndex, state);

      // BIN-451: Disable buy-more after ~80% of draws (Unity: BuyMoreDisableFlagVal)
      if (!this.buyMoreDisabled && state.drawCount >= Math.floor(state.totalDrawCapacity * 0.8)) {
        this.buyMoreDisabled = true;
        this.playScreen.disableBuyMore();
      }
    } else if (this.phase === "WAITING" && this.playScreen) {
      // Spectator mode — animate ball in tube but no ticket marking
      this.playScreen.onSpectatorNumberDrawn(number, state);
    }
  }

  private onPatternWon(result: PatternWonPayload, _state: GameState): void {
    if (this.phase === "PLAYING" && this.playScreen) this.playScreen.onPatternWon(result);

    // Toast notification (Unity: OnPatternWon_Spillorama shows winner info)
    const isMe = result.winnerId === this.myPlayerId;
    if (isMe) {
      this.toast?.win(`Du vant ${result.patternName}! ${result.payoutAmount} kr`);
      this.deps.audio.playSfx("win");
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

  private async handleBuy(): Promise<void> {
    const result = await this.deps.socket.armBet({ roomCode: this.actualRoomCode, armed: true });
    if (result.ok) {
      this.playScreen?.hideBuyPopup();
    } else {
      this.showError(result.error?.message || "Kunne ikke kjøpe billetter");
    }
  }

  private async handleClaim(type: "LINE" | "BINGO"): Promise<void> {
    const result = await this.deps.socket.submitClaim({ roomCode: this.actualRoomCode, type });
    if (!result.ok) console.error("[Game1] Claim failed:", result.error);
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
      const overlay = new WheelOverlay(w, h);
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
      // Default: TreasureChest
      const overlay = new TreasureChestOverlay(w, h);
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
