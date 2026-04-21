import { Container, Text } from "pixi.js";
import type { GameDeps, GameController } from "../registry.js";
import { registerGame } from "../registry.js";
import type { GameState } from "../../bridge/GameBridge.js";
import type { PatternWonPayload } from "@spillorama/shared-types/socket-events";
import { telemetry } from "../../telemetry/Telemetry.js";
import { PlayScreen } from "./screens/PlayScreen.js";
import { EndScreen } from "../game2/screens/EndScreen.js";
import { LuckyNumberPicker } from "./components/LuckyNumberPicker.js";
import { LoadingOverlay } from "../../components/LoadingOverlay.js";
import { preloadGameAssets } from "../../core/preloadGameAssets.js";
import { ToastNotification } from "./components/ToastNotification.js";
import { PauseOverlay } from "./components/PauseOverlay.js";
import { SettingsPanel, type Game1Settings } from "./components/SettingsPanel.js";
import { MarkerBackgroundPanel } from "./components/MarkerBackgroundPanel.js";
import { GamePlanPanel } from "./components/GamePlanPanel.js";
import { AudioManager } from "../../audio/AudioManager.js";
import { MiniGameRouter } from "./logic/MiniGameRouter.js";
import { Game1SocketActions } from "./logic/SocketActions.js";
import { Game1ReconnectFlow } from "./logic/ReconnectFlow.js";

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
 * Game 1 (Classic Bingo) controller — orchestration only.
 *
 * Ansvar delegert til logic/-moduler:
 *   - `logic/SocketActions.ts` — alle spiller→server-kall (kjøp, claim, cancel…)
 *   - `logic/MiniGameRouter.ts` — wheel / chest / mystery / color-draft overlays
 *   - `logic/ReconnectFlow.ts` — sync-ready barrier + reconnect-state-rebuild
 *
 * Det som står igjen her: start/destroy lifecycle, Phase-maskin, bridge-event-
 * routing, og noen UI-helpers (toast, settings-panel). Unike-for-Game-1 ting
 * som ikke har en naturlig shared-modul.
 */
class Game1Controller implements GameController {
  private deps: GameDeps;
  private root: Container;
  private phase: Phase = "LOADING";
  private currentScreen: Container | null = null;
  private playScreen: PlayScreen | null = null;
  private endScreen: EndScreen | null = null;
  private myPlayerId: string | null = null;
  private actualRoomCode: string = "";
  private unsubs: (() => void)[] = [];
  private endScreenTimer: ReturnType<typeof setTimeout> | null = null;
  private buyMoreDisabled = false;
  private luckyPicker: LuckyNumberPicker | null = null;
  private loader: LoadingOverlay | null = null;
  private toast: ToastNotification | null = null;
  private pauseOverlay: PauseOverlay | null = null;
  private settingsPanel: SettingsPanel | null = null;
  private markerBgPanel: MarkerBackgroundPanel | null = null;
  private gamePlanPanel: GamePlanPanel | null = null;
  private miniGame: MiniGameRouter | null = null;
  private actions: Game1SocketActions | null = null;
  private reconnectFlow: Game1ReconnectFlow | null = null;

  constructor(deps: GameDeps) {
    this.deps = deps;
    this.root = new Container();
  }

  async start(): Promise<void> {
    const { app, socket, bridge } = this.deps;
    app.stage.addChild(this.root);

    // UI overlays
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

    // Wire logic-moduler. Getters brukes der state kan endre seg (roomCode
    // settes etter room:create, playScreen skiftes ved screen-transition).
    this.miniGame = new MiniGameRouter({
      root: this.root,
      app,
      socket,
      bridge,
      getRoomCode: () => this.actualRoomCode,
    });
    this.actions = new Game1SocketActions({
      socket,
      bridge,
      getRoomCode: () => this.actualRoomCode,
      getPhase: () => this.phase,
      getPlayScreen: () => this.playScreen,
      toast: this.toast,
      onError: (msg) => this.showError(msg),
    });
    this.reconnectFlow = new Game1ReconnectFlow({ socket, bridge, loader: this.loader });

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
          void this.reconnectFlow?.handleReconnect(this.actualRoomCode, (phase, s) =>
            this.transitionTo(phase, s),
          );
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
      bridge.on("minigameActivated", (data) => this.miniGame?.onActivated(data)),
    );

    // Lucky number picker (persists across screen transitions)
    const pickerContainer = this.deps.app.app.canvas.parentElement ?? document.body;
    this.luckyPicker = new LuckyNumberPicker(pickerContainer);
    this.luckyPicker.setOnSelect((n) => {
      void this.actions?.setLuckyNumber(n);
    });

    // Unlock audio
    this.root.eventMode = "static";
    this.root.on("pointerdown", () => this.deps.audio.unlock(), { once: true });

    // BIN-500: Loader-barriere.
    // En late-joiner kan komme inn mens en runde kjører. Før loader fjernes må
    // vi være sikre på at klienten rendrer samme tilstand som andre spillere:
    //   (a) socket connected  — allerede verifisert over
    //   (b) snapshot applied  — gjort via bridge.applySnapshot() like over
    //   (c) audio/SFX lastet  — preload ferdig (AudioManager.preloadSfx ble kalt i init)
    //   (d) hvis RUNNING: minst én live room:update ELLER numberDrawn mottatt
    //       (beviser at socket faktisk leverer — ikke bare er connected)
    await this.reconnectFlow.waitForSyncReady();

    // Hide loader — game is ready
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
    this.miniGame?.destroy();
    this.miniGame = null;
    this.actions = null;
    this.reconnectFlow = null;
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
      case "WAITING":
      case "PLAYING":
      case "SPECTATING": {
        // All three "game-visible" phases share one PlayScreen setup. The new
        // `update(state)` method picks what to show based on gameStatus /
        // ticket arrays — no per-phase build/render juggling. Callbacks are
        // wired once at construction (they used to be re-wired in every
        // transition, three copies of the exact same 8-line block).
        this.miniGame?.resetLastPrize();
        this.playScreen = this.buildPlayScreen(w, h);
        this.playScreen.update(state);
        this.playScreen.enableBuyMore();

        // BIN-419 Elvis replace — only shown in WAITING with existing tickets.
        if (
          phase === "WAITING"
          && state.gameType === "elvis"
          && state.myTickets.length > 0
          && state.replaceAmount > 0
        ) {
          this.playScreen.showElvisReplace(state.replaceAmount, () => {
            void this.actions?.elvisReplace();
          });
        }

        this.setScreen(this.playScreen);
        break;
      }

      case "ENDED":
        this.endScreen = new EndScreen(w, h);
        this.endScreen.setOnDismiss(() => {
          this.transitionTo("WAITING", this.deps.bridge.getState());
        });
        this.endScreen.show(state);
        const prize = this.miniGame?.getLastPrize() ?? 0;
        if (prize > 0 && typeof (this.endScreen as unknown as { showMiniGameBonus?: (n: number) => void }).showMiniGameBonus === "function") {
          (this.endScreen as unknown as { showMiniGameBonus: (n: number) => void }).showMiniGameBonus(prize);
        }
        this.setScreen(this.endScreen);
        break;
    }
  }

  // ── Bridge event handlers ─────────────────────────────────────────────

  private onStateChanged(state: GameState): void {
    // Single update() entry point. Replaces the old three-way split
    // (updateWaitingState / updateInfo / renderPreRoundTickets + UpcomingPurchase).
    // PlayScreen picks what to show from state.gameStatus + ticket arrays.
    if (this.playScreen && (this.phase === "WAITING" || this.phase === "PLAYING" || this.phase === "SPECTATING")) {
      this.playScreen.update(state);
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

    this.buyMoreDisabled = false;
    // BIN-409 (D2): Ny runde — reset buy-more button til enabled state.
    // Buy popup (Game1BuyPopup) closes itself at the PLAYING transition via
    // PlayScreen.update() → gameStatus === RUNNING.
    this.playScreen?.enableBuyMore();
    this.playScreen?.hideBuyPopup();

    // Reset announced numbers for the new round
    this.deps.audio.resetAnnouncedNumbers();

    this.luckyPicker?.hide();

    if (state.myTickets.length > 0) {
      this.transitionTo("PLAYING", state);
    } else {
      // BIN-507: runde starter uten at spilleren armet billetter → SPECTATING.
      this.transitionTo("SPECTATING", state);
    }
  }

  private onGameEnded(state: GameState): void {
    // Dismiss any active mini-game overlay so it doesn't block the EndScreen
    this.miniGame?.dismiss();

    this.deps.audio.resetAnnouncedNumbers();
    this.deps.audio.stopAll();

    // Refresh player balance
    if (this.myPlayerId) {
      const me = state.players.find((p) => p.id === this.myPlayerId);
      if (me && typeof me.balance === "number" && typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("spillorama:balanceChanged", { detail: { balance: me.balance } }));
      }
    }

    if (this.phase === "PLAYING") {
      this.transitionTo("ENDED", state);
      this.endScreenTimer = setTimeout(() => {
        this.endScreenTimer = null;
        if (this.phase === "ENDED") {
          this.transitionTo("WAITING", this.deps.bridge.getState());
        }
      }, END_SCREEN_AUTO_DISMISS_MS);
    } else {
      this.transitionTo("WAITING", state);
    }
  }

  private onNumberDrawn(number: number, drawIndex: number, state: GameState): void {
    if (this.phase === "PLAYING" && this.playScreen) {
      this.playScreen.onNumberDrawn(number, drawIndex, state);

      // BIN-451: Disable buy-more using server-authoritative threshold
      if (!this.buyMoreDisabled && state.disableBuyAfterBalls > 0 && state.drawCount >= state.disableBuyAfterBalls) {
        this.buyMoreDisabled = true;
        this.playScreen.disableBuyMore();
      }
    } else if ((this.phase === "WAITING" || this.phase === "SPECTATING") && this.playScreen) {
      // BIN-507: Both WAITING and SPECTATING viser live ball-animasjon uten ticket-marking.
      this.playScreen.onSpectatorNumberDrawn(number, state);
    }
  }

  private onPatternWon(result: PatternWonPayload, _state: GameState): void {
    if (this.phase === "PLAYING" && this.playScreen) this.playScreen.onPatternWon(result);

    // BIN-696: Vis annonsering til alle spillere om at fasen er vunnet.
    // Fullt Hus har spesiell tekst ("Spillet er over") — alle andre faser
    // bruker pattern-navnet direkte ("Rad 1 er vunnet", osv.).
    const isFullHouse = result.claimType === "BINGO";
    const phaseMsg = isFullHouse
      ? "Fullt Hus er vunnet. Spillet er over."
      : `${result.patternName} er vunnet!`;
    this.toast?.info(phaseMsg, 3000);

    // BIN-696: Vinner-spesifikk annonsering med split-forklaring.
    const winnerIds = result.winnerIds ?? (result.winnerId ? [result.winnerId] : []);
    const isMe = this.myPlayerId !== null && winnerIds.includes(this.myPlayerId);
    const winnerCount = result.winnerCount ?? winnerIds.length;

    if (isMe) {
      const firstLine = isFullHouse
        ? "Du vant Fullt Hus!"
        : `Du vant ${result.patternName}!`;
      const secondLine = winnerCount > 1
        ? `Din gevinst: ${result.payoutAmount} kr (premien delt på ${winnerCount} spillere som vant samtidig)`
        : `Gevinst: ${result.payoutAmount} kr`;

      this.toast?.win(`${firstLine}\n${secondLine}`, 5000);
      this.deps.audio.playBingoSound();
    }

    telemetry.trackEvent("pattern_won", {
      patternName: result.patternName,
      isMe,
      payoutAmount: result.payoutAmount,
      winnerCount,
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  /**
   * Build a fresh PlayScreen og wire all callbacks. Sentralisert fordi de tre
   * game-visible phases (WAITING / PLAYING / SPECTATING) tidligere copy-
   * pasted denne blokken tre ganger, og callback-endringer falt jevnlig ut
   * av sync.
   */
  private buildPlayScreen(w: number, h: number): PlayScreen {
    const container = this.deps.app.app.canvas.parentElement ?? document.body;
    const screen = new PlayScreen(w, h, this.deps.audio, this.deps.socket, this.actualRoomCode, container, this.deps.bridge);
    screen.setOnClaim((type) => {
      void this.actions?.claim(type);
    });
    screen.setOnBuy((selections) => {
      void this.actions?.buy(selections);
    });
    screen.setOnLuckyNumberTap(() => this.openLuckyPicker());
    screen.setOnCancelTickets(() => {
      void this.actions?.cancelAll();
    });
    screen.setOnCancelTicket((id) => {
      void this.actions?.cancelTicket(id);
    });
    screen.setOnOpenSettings(() => this.settingsPanel?.show());
    screen.setOnOpenMarkerBg(() => this.markerBgPanel?.show());
    screen.setOnStartGame(() => {
      void this.actions?.startGame();
    });
    screen.subscribeChatToBridge((listener) => this.deps.bridge.on("chatMessage", listener));
    return screen;
  }

  private openLuckyPicker(): void {
    const state = this.deps.bridge.getState();
    this.luckyPicker?.show(state.myLuckyNumber);
  }

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
