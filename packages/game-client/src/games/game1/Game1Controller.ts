import { Container, Text } from "pixi.js";
import type { GameDeps, GameController } from "../registry.js";
import { registerGame } from "../registry.js";
import type { GameState } from "../../bridge/GameBridge.js";
import type {
  MiniGameTriggerPayload,
  PatternWonPayload,
} from "@spillorama/shared-types/socket-events";
import { telemetry } from "../../telemetry/Telemetry.js";
import { PlayScreen } from "./screens/PlayScreen.js";
import { EndScreen } from "../game2/screens/EndScreen.js";
import { LuckyNumberPicker } from "./components/LuckyNumberPicker.js";
import { LoadingOverlay } from "../../components/LoadingOverlay.js";
import { preloadGameAssets } from "../../core/preloadGameAssets.js";
import { ToastNotification } from "./components/ToastNotification.js";
import { PauseOverlay } from "./components/PauseOverlay.js";
import { WinPopup } from "./components/WinPopup.js";
import { WinScreenV2 } from "./components/WinScreenV2.js";
import { classifyPhaseFromPatternName, Spill1Phase } from "@spillorama/shared-types/spill1-patterns";

/** Map Spill1Phase-enum til rad-antall (1-4 for linje-vinn). */
const PHASE_TO_ROWS: Readonly<Record<Spill1Phase, number>> = {
  [Spill1Phase.Phase1]: 1,
  [Spill1Phase.Phase2]: 2,
  [Spill1Phase.Phase3]: 3,
  [Spill1Phase.Phase4]: 4,
  [Spill1Phase.FullHouse]: 5,
};
import { SettingsPanel, type Game1Settings } from "./components/SettingsPanel.js";
import { MarkerBackgroundPanel } from "./components/MarkerBackgroundPanel.js";
import { GamePlanPanel } from "./components/GamePlanPanel.js";
import { AudioManager } from "../../audio/AudioManager.js";
import { MiniGameRouter } from "./logic/MiniGameRouter.js";
import { Game1SocketActions } from "./logic/SocketActions.js";
import { Game1ReconnectFlow } from "./logic/ReconnectFlow.js";
import type { Phase } from "./logic/Phase.js";

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
  /** Fase 1-4 vinn-popup (Bong-design, port av WinPopup.jsx). */
  private winPopup: WinPopup | null = null;
  /** Fullt Hus fullskjerm-scene (Bong-design, port av WinScreenV2.jsx). */
  private winScreen: WinScreenV2 | null = null;
  private settingsPanel: SettingsPanel | null = null;
  private markerBgPanel: MarkerBackgroundPanel | null = null;
  private gamePlanPanel: GamePlanPanel | null = null;
  private miniGame: MiniGameRouter | null = null;
  private actions: Game1SocketActions | null = null;
  private reconnectFlow: Game1ReconnectFlow | null = null;

  /**
   * Mini-game-kø (Tobias 2026-04-26): backend triggerer mini-game POST-commit
   * umiddelbart etter Fullt Hus-payout. Hvis WinScreenV2 (Fullt Hus-fontene)
   * fortsatt vises, holder vi tilbake mini-game-overlayet og spiller det av
   * etter at vinner-scenen er dismissed (Tilbake-klikk eller auto-close).
   * Kun ett pending-trigger holdes; nyere trigger overskriver eldre (server-
   * autoritativ — siste trigger vinner).
   */
  private pendingMiniGameTrigger: MiniGameTriggerPayload | null = null;
  /** True mens WinScreenV2 er synlig — hindrer mini-game-overlay i å klippe oppå. */
  private isWinScreenActive = false;

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
    this.winPopup = new WinPopup(overlayContainer);
    this.winScreen = new WinScreenV2(overlayContainer);
    this.settingsPanel = new SettingsPanel(overlayContainer);
    // Wire settings panel to AudioManager
    this.syncSettingsToAudio(this.settingsPanel.getSettings());
    this.settingsPanel.setOnChange((settings) => this.syncSettingsToAudio(settings));
    this.markerBgPanel = new MarkerBackgroundPanel(overlayContainer);
    this.gamePlanPanel = new GamePlanPanel(overlayContainer);

    // Wire logic-moduler. Getters brukes der state kan endre seg (roomCode
    // settes etter room:create, playScreen skiftes ved screen-transition).
    // BIN-690 PR-M6: router subscribes to `miniGameTrigger` + `miniGameResult`
    // via bridge, and emits `mini_game:choice` via socket.sendMiniGameChoice.
    // No room-code needed — the wire contract is resultId-based.
    this.miniGame = new MiniGameRouter({
      root: this.root,
      app,
      socket,
      bridge,
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
      // BIN-690 PR-M6: new scheduled-games mini-game protocol.
      // Legacy `minigameActivated` is removed — router now wires to
      // `miniGameTrigger` + `miniGameResult`.
      bridge.on("miniGameTrigger", (data) => this.handleMiniGameTrigger(data)),
      bridge.on("miniGameResult", (data) => this.miniGame?.onResult(data)),
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
    this.winPopup?.destroy();
    this.winPopup = null;
    this.winScreen?.destroy();
    this.winScreen = null;
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

    // BIN-460: Show/hide pause overlay based on game state.
    // BLINK-FIX (round 3, bonus): Fjernet "Spillet er gjenopptatt"-toast.
    // Under auto-pause-flyt (phase-won → kort pause → resume) er den
    // overlappende toast-fade + pause-fade + ny ball-trekk en hovedmistenkt
    // for blink-effekten. Toasten gir ingen verdi når overlay uansett bare
    // var synlig i ~1s under en automatisk overgang.
    if (state.isPaused && !this.pauseOverlay?.isShowing()) {
      this.pauseOverlay?.show(state.pauseMessage ?? undefined);
    } else if (!state.isPaused && this.pauseOverlay?.isShowing()) {
      this.pauseOverlay?.hide();
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

    // Saldo-flash deep-dive (Tobias 2026-04-26): Game-end er en av få
    // hendelser hvor saldo GARANTERT har endret seg (payout/buy-in commit),
    // så vi vil ha en autoritativ refetch fra lobby, men IKKE pushe et
    // optimistisk balance-tall som kommer til å være enten gross eller
    // available avhengig av hvilken backend-path som sist berørte
    // `player.balance`. Sender refresh-request i stedet — lobby gjør
    // debounced GET /api/wallet/me og rendrer korrekt available.
    if (this.myPlayerId && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("spillorama:balanceRefreshRequested"));
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
      this.deps.audio.playBingoSound();

      // BIN-696 / Bong-design 2026-04-24:
      //   - Fullt Hus (BINGO)  → fullskjerm WinScreenV2 med fontene + count-up
      //   - Fase 1-4 (LINE)    → WinPopup med logo, gevinst, shared-info
      // Erstatter den tidligere toast-meldingen for isMe-scenariet. Toast
      // fortsetter som generell annonsering (`phaseMsg` over) for alle.
      const shared = winnerCount > 1;
      const payout = result.payoutAmount ?? 0;
      if (isFullHouse) {
        this.isWinScreenActive = true;
        this.winScreen?.show({
          amount: payout,
          shared,
          sharedCount: winnerCount,
          onDismiss: () => {
            // Tobias 2026-04-26: Fullt Hus → Mystery (eller annet konfigurert
            // mini-game) skal vises ETTER vinner-scenen lukkes (manuell
            // Tilbake-knapp eller 10.8s auto-close). Backend trigger
            // (Game1DrawEngineService.triggerMiniGamesForFullHouse) har allerede
            // fyrt og payload kan ligge i pendingMiniGameTrigger. Flush her.
            this.isWinScreenActive = false;
            this.flushPendingMiniGameTrigger();
            // EndScreen-transition er styrt av onGameEnded (uendret).
          },
        });
      } else {
        // `rows` = fase-nummer (1-4 for linje-vinn). classifyPhaseFromPatternName
        // mapper "Row 1" → Phase1, etc. PHASE_TO_ROWS mapper videre til tall.
        // Fallback til 1 for ukjent pattern-navn.
        const phase = classifyPhaseFromPatternName(result.patternName);
        const rows = phase ? PHASE_TO_ROWS[phase] : 1;
        this.winPopup?.show({
          rows: Math.min(4, rows),
          amount: payout,
          shared,
          sharedCount: winnerCount,
        });
      }
    }

    telemetry.trackEvent("pattern_won", {
      patternName: result.patternName,
      isMe,
      payoutAmount: result.payoutAmount,
      winnerCount,
    });
  }

  /**
   * Bridge-listener for `miniGameTrigger`. Hvis WinScreenV2 (Fullt Hus-scene)
   * er aktiv, holder vi tilbake triggeren slik at mini-game-overlay ikke
   * klipper over fontene-animasjonen. Frigjøres i WinScreenV2.onDismiss via
   * flushPendingMiniGameTrigger.
   */
  private handleMiniGameTrigger(payload: MiniGameTriggerPayload): void {
    if (this.isWinScreenActive) {
      // Server-autoritativ: hvis flere triggere i køen, siste vinner.
      this.pendingMiniGameTrigger = payload;
      return;
    }
    this.miniGame?.onTrigger(payload);
  }

  /** Spill av evt. pending trigger. Kalles fra WinScreenV2.onDismiss. */
  private flushPendingMiniGameTrigger(): void {
    const pending = this.pendingMiniGameTrigger;
    if (!pending) return;
    this.pendingMiniGameTrigger = null;
    this.miniGame?.onTrigger(pending);
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
