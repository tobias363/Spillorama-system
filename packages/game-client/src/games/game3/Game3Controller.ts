import { Container, Text } from "pixi.js";
import type { GameDeps, GameController } from "../registry.js";
import { registerGame } from "../registry.js";
import type { GameState } from "../../bridge/GameBridge.js";
import type {
  PatternWonPayload,
  BetRejectedEvent,
  WalletLossStateEvent,
} from "@spillorama/shared-types/socket-events";
import { telemetry } from "../../telemetry/Telemetry.js";
import { PlayScreen } from "../game1/screens/PlayScreen.js";
import { LuckyNumberPicker } from "../game1/components/LuckyNumberPicker.js";
import { LoadingOverlay } from "../../components/LoadingOverlay.js";
import { preloadGameAssets } from "../../core/preloadGameAssets.js";
import { ToastNotification } from "../game1/components/ToastNotification.js";
import { PauseOverlay } from "../game1/components/PauseOverlay.js";
import { WinPopup } from "../game1/components/WinPopup.js";
import { WinScreenV2 } from "../game1/components/WinScreenV2.js";
import {
  Game1EndOfRoundOverlay,
  type Game1EndOfRoundSummary,
} from "../game1/components/Game1EndOfRoundOverlay.js";
import { classifyPhaseFromPatternName, Spill1Phase } from "@spillorama/shared-types/spill1-patterns";

/** Map Spill1Phase-enum til rad-antall (1-4 for linje-vinn). */
const PHASE_TO_ROWS: Readonly<Record<Spill1Phase, number>> = {
  [Spill1Phase.Phase1]: 1,
  [Spill1Phase.Phase2]: 2,
  [Spill1Phase.Phase3]: 3,
  [Spill1Phase.Phase4]: 4,
  [Spill1Phase.FullHouse]: 5,
};

import { SettingsPanel, type Game1Settings } from "../game1/components/SettingsPanel.js";
import { MarkerBackgroundPanel } from "../game1/components/MarkerBackgroundPanel.js";
import { GamePlanPanel } from "../game1/components/GamePlanPanel.js";
import { AudioManager } from "../../audio/AudioManager.js";
import { Game1SocketActions } from "../game1/logic/SocketActions.js";
import { Game1ReconnectFlow } from "../game1/logic/ReconnectFlow.js";
import type { Phase } from "../game1/logic/Phase.js";

/**
 * Spill 3 (Mønsterbingo / Monster Bingo) controller.
 *
 * Per Tobias-direktiv 2026-05-03:
 *   "75 baller og 5x5 bonger uten free i midten. Alt av design skal være likt
 *    [Spill 1] bare at her er det kun 1 type bonger og man spiller om mønstre.
 *    Logikken med å trekke baller og markere bonger er fortsatt helt lik."
 *
 * Hvorfor en duplikat-controller, ikke subclass:
 *   Game1Controller eksporterer ikke klassen og har private felt — subclassing
 *   ville krevd å gjøre felt protected, hvilket forurenser Spill 1's API.
 *   Duplikat-controller med imports fra `../game1/...` gir oss én sannhetskilde
 *   for komponenter (PlayScreen, BingoTicketHtml, ButPopup, WinScreenV2,
 *   EndOfRoundOverlay, …) — kun orchestration-laget er duplisert.
 *
 * Forskjeller fra Game1Controller:
 *   - `gameSlug: "monsterbingo"` ved `socket.createRoom`
 *   - INGEN `MiniGameRouter` / `LegacyMiniGameAdapter` — Spill 3 er ren
 *     mønsterbingo uten Wheel/Chest/Mystery/ColorDraft/Oddsen overlays
 *   - INGEN subscribe på `miniGameTrigger` / `miniGameResult` /
 *     `legacyMinigameActivated` — disse fyrer aldri for Spill 3-rom
 *     (DEFAULT_GAME3_CONFIG har ingen mini-games konfigurert)
 *   - `miniGameResult: null` sendes alltid til `Game1EndOfRoundOverlay`
 *
 * Backend deler patterns + patternResults via `room:update`-snapshot, så
 * `state.patternResults` driver UI-en akkurat som for Spill 1. Server-side
 * `g3:pattern:*`-events brukes ikke av denne klienten — visuell paritet med
 * Spill 1 er prioritert.
 *
 * Asset-paths: gjenbruker /web/games/assets/game1/* via Game1-komponentene.
 * Ingen egne `/games/assets/game3/...`-filer kreves for visuell paritet.
 */
class Game3Controller implements GameController {
  private deps: GameDeps;
  private root: Container;
  private phase: Phase = "LOADING";
  private currentScreen: Container | null = null;
  private playScreen: PlayScreen | null = null;
  private myPlayerId: string | null = null;
  private actualRoomCode: string = "";
  private unsubs: (() => void)[] = [];
  private endScreenTimer: ReturnType<typeof setTimeout> | null = null;
  private buyMoreDisabled = false;
  private luckyPicker: LuckyNumberPicker | null = null;
  private loader: LoadingOverlay | null = null;
  private toast: ToastNotification | null = null;
  private pauseOverlay: PauseOverlay | null = null;
  /** Fase 1-4 vinn-popup (Bong-design). */
  private winPopup: WinPopup | null = null;
  /** Fullt Hus fullskjerm-scene. */
  private winScreen: WinScreenV2 | null = null;
  /**
   * End-of-round HTML overlay (samme som Spill 1). Vises etter Fullt Hus
   * eller MAX_DRAWS_REACHED med oppsummering + "Tilbake til lobby".
   */
  private endOfRoundOverlay: Game1EndOfRoundOverlay | null = null;
  /**
   * Disconnect-resilience timestamp for end-of-round-overlay.
   */
  private roundEndedAt: number | null = null;
  /**
   * Timestamp for at end-of-round-overlay ble vist; brukes til markRoomReady-
   * gating på neste state-update etter overlay-visning.
   */
  private endOfRoundOverlayShownAt: number | null = null;
  private settingsPanel: SettingsPanel | null = null;
  private markerBgPanel: MarkerBackgroundPanel | null = null;
  private gamePlanPanel: GamePlanPanel | null = null;
  private actions: Game1SocketActions | null = null;
  private reconnectFlow: Game1ReconnectFlow | null = null;

  /** True mens WinScreenV2 (Fullt Hus) er synlig. */
  private isWinScreenActive = false;
  /**
   * Akkumulert egen-vinning per runde. Reset ved gameStarted. Brukes til å
   * vise totalbeløp i WinScreenV2 (Fullt Hus): "1 Rad 100 + 2 Rader 200 +
   * 3 Rader 200 + 4 Rader 200 + Fullt Hus 1000 = 1700 kr".
   */
  private roundAccumulatedWinnings = 0;
  /**
   * Flagg som settes i onGameEnded når WinScreenV2 (Fullt Hus) er aktiv.
   * Når WinScreenV2 lukkes, viser vi end-of-round-overlay i stedet for
   * å klippe over Fullt Hus-animasjonen.
   */
  private shouldShowEndOfRoundOnWinScreenDismiss = false;

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
    this.loader.setState("CONNECTING");
    this.toast = new ToastNotification(overlayContainer);
    this.pauseOverlay = new PauseOverlay(overlayContainer);
    this.winPopup = new WinPopup(overlayContainer);
    this.winScreen = new WinScreenV2(overlayContainer);
    this.endOfRoundOverlay = new Game1EndOfRoundOverlay(overlayContainer);
    this.settingsPanel = new SettingsPanel(overlayContainer);
    this.syncSettingsToAudio(this.settingsPanel.getSettings());
    this.settingsPanel.setOnChange((settings) => this.syncSettingsToAudio(settings));
    this.markerBgPanel = new MarkerBackgroundPanel(overlayContainer);
    this.gamePlanPanel = new GamePlanPanel(overlayContainer);

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

    // Pre-warm assets — preloadGameAssets er en no-op for ukjente slugs så
    // det er trygt å sende "monsterbingo". Game1-komponentene laster sine
    // egne assets lazily ved første bruk hvis preload er tom, men vi bruker
    // "bingo" her så vi får samme pre-warm som Spill 1 (ballkasse, ringbg,
    // ball-PNG-er) siden vi gjenbruker Spill 1's PlayScreen + assets.
    this.loader.setState("LOADING_ASSETS");
    await preloadGameAssets("bingo");

    // Join or create room. Slug "monsterbingo" → backend instansierer
    // Game3Engine + DEFAULT_GAME3_CONFIG (5×5 / 1..75 / Row 1-4 + Full House).
    this.loader.setState("JOINING_ROOM");
    const joinResult = await socket.createRoom({
      hallId: this.deps.hallId,
      gameSlug: "monsterbingo",
    });

    if (!joinResult.ok || !joinResult.data) {
      this.loader.hide();
      console.error("[Game3] Room join failed:", joinResult.error);
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
      // INGEN mini-game-subscriptions — Spill 3 har ingen mini-games
      // konfigurert i DEFAULT_GAME3_CONFIG, så `miniGameTrigger`,
      // `miniGameResult` og `legacyMinigameActivated` fyrer aldri for
      // Spill 3-rom. Vi sparer overlay-konstruksjon + listener-overhead.
      bridge.on("betRejected", (event) => this.onBetRejected(event)),
      bridge.on("walletLossStateChanged", (event) => this.onWalletLossStateChanged(event)),
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

    // Loader-barriere (samme som Spill 1).
    await this.reconnectFlow.waitForSyncReady();

    this.loader.setState("READY");

    // Transition based on state
    const state = bridge.getState();

    if (state.gameStatus === "RUNNING") {
      if (state.myTickets.length > 0) {
        this.transitionTo("PLAYING", state);
      } else {
        this.transitionTo("SPECTATING", state);
      }
    } else if (state.gameStatus === "ENDED") {
      this.transitionTo("ENDED", state);
      this.showEndOfRoundOverlayForState(state);
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
    this.endOfRoundOverlay?.destroy();
    this.endOfRoundOverlay = null;
    this.settingsPanel?.destroy();
    this.settingsPanel = null;
    this.markerBgPanel?.destroy();
    this.markerBgPanel = null;
    this.gamePlanPanel?.destroy();
    this.gamePlanPanel = null;
    for (const unsub of this.unsubs) unsub();
    this.unsubs = [];
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
        this.playScreen = this.buildPlayScreen(w, h);
        this.playScreen.update(state);
        this.playScreen.enableBuyMore();
        this.setScreen(this.playScreen);
        break;
      }

      case "ENDED":
        // Same as Spill 1: ENDED-fasen viser HTML-overlay, ikke Pixi-skjerm.
        // clearScreen() har allerede ryddet PlayScreen-instansen.
        break;
    }
  }

  // ── Bridge event handlers ─────────────────────────────────────────────

  private onStateChanged(state: GameState): void {
    // Defensive recovery: hvis gameStarted-event ble droppet (race), hopp
    // direkte fra ENDED til PLAYING/SPECTATING når state viser RUNNING.
    if (this.phase === "ENDED" && state.gameStatus === "RUNNING") {
      if (this.endScreenTimer) {
        clearTimeout(this.endScreenTimer);
        this.endScreenTimer = null;
      }
      this.endOfRoundOverlay?.hide();
      if (state.myTickets.length > 0) {
        this.transitionTo("PLAYING", state);
      } else {
        this.transitionTo("SPECTATING", state);
      }
      return;
    }

    // Disconnect-resilience: re-vis end-of-round-overlay etter reconnect-
    // applySnapshot hvis den ikke er oppe enda.
    if (
      this.phase === "ENDED" &&
      state.gameStatus === "ENDED" &&
      this.endOfRoundOverlay &&
      !this.endOfRoundOverlay.isVisible() &&
      !this.isWinScreenActive
    ) {
      this.showEndOfRoundOverlayForState(state);
    }

    // Mark room ready på neste state-update etter overlay-visning (50ms grace).
    if (
      this.endOfRoundOverlay?.isVisible() &&
      this.endOfRoundOverlayShownAt !== null &&
      Date.now() > this.endOfRoundOverlayShownAt + 50
    ) {
      this.endOfRoundOverlay.markRoomReady();
    }

    if (this.playScreen && (this.phase === "WAITING" || this.phase === "PLAYING" || this.phase === "SPECTATING")) {
      this.playScreen.update(state);
    }

    // Pause overlay
    if (state.isPaused && !this.pauseOverlay?.isShowing()) {
      this.pauseOverlay?.show({
        message: state.pauseMessage ?? undefined,
        pauseUntil: state.pauseUntil,
        pauseReason: state.pauseReason,
      });
    } else if (state.isPaused && this.pauseOverlay?.isShowing()) {
      this.pauseOverlay.updateContent({
        message: state.pauseMessage ?? undefined,
        pauseUntil: state.pauseUntil,
        pauseReason: state.pauseReason,
      });
    } else if (!state.isPaused && this.pauseOverlay?.isShowing()) {
      this.pauseOverlay?.hide();
    }
  }

  private onGameStarted(state: GameState): void {
    if (this.endScreenTimer) {
      clearTimeout(this.endScreenTimer);
      this.endScreenTimer = null;
    }

    this.endOfRoundOverlay?.hide();
    this.shouldShowEndOfRoundOnWinScreenDismiss = false;
    this.roundEndedAt = null;
    this.endOfRoundOverlayShownAt = null;

    this.roundAccumulatedWinnings = 0;

    this.buyMoreDisabled = false;
    this.playScreen?.enableBuyMore();
    this.playScreen?.hideBuyPopup();

    this.deps.audio.resetAnnouncedNumbers();

    this.luckyPicker?.hide();

    if (state.myTickets.length > 0) {
      this.transitionTo("PLAYING", state);
    } else {
      this.transitionTo("SPECTATING", state);
    }
  }

  private onGameEnded(state: GameState): void {
    this.deps.audio.resetAnnouncedNumbers();
    this.deps.audio.stopAll();

    if (this.myPlayerId && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("spillorama:balanceRefreshRequested"));
    }

    if (this.phase === "PLAYING") {
      this.transitionTo("ENDED", state);
      this.roundEndedAt = Date.now();
      // Hvis WinScreenV2 (Fullt Hus-fontene) er aktiv, holder vi tilbake
      // end-of-round-overlay til den lukkes — slik at animasjonen får
      // ferdig-spille uten å bli klippet av summary-vinduet.
      if (this.isWinScreenActive) {
        this.shouldShowEndOfRoundOnWinScreenDismiss = true;
      } else {
        this.showEndOfRoundOverlayForState(state);
      }
    } else {
      this.transitionTo("WAITING", state);
    }
  }

  /**
   * Vis end-of-round-overlay (samme HTML-overlay som Spill 1).
   *
   * Spill 3-spesifikt: `miniGameResult: null` siden Spill 3 ikke har
   * mini-games. Overlay rendrer da bare patterns-tabell + total + spinner.
   */
  private showEndOfRoundOverlayForState(state: GameState): void {
    const overlay = this.endOfRoundOverlay;
    if (!overlay) return;

    const now = Date.now();
    const elapsedSinceEndedMs =
      this.roundEndedAt !== null ? Math.max(0, now - this.roundEndedAt) : 0;

    const summary: Game1EndOfRoundSummary = {
      endedReason:
        state.gameStatus === "ENDED"
          ? this.endedReasonFromState(state)
          : "MANUAL_END",
      patternResults: state.patternResults,
      myPlayerId: this.myPlayerId,
      myTickets: state.myTickets,
      // Spill 3 har ingen mini-games — overlay rendrer ingen mini-game-rad
      // når miniGameResult er null/undefined.
      miniGameResult: null,
      luckyNumber: state.myLuckyNumber,
      ownRoundWinnings: this.roundAccumulatedWinnings,
      millisUntilNextStart: state.millisUntilNextStart ?? null,
      elapsedSinceEndedMs,
      onBackToLobby: () => {
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("spillorama:returnToLobby"));
        }
        this.dismissEndOfRoundAndReturnToWaiting();
      },
      onCountdownNearStart: undefined,
      onOverlayCompleted: () => {
        this.dismissEndOfRoundAndReturnToWaiting();
      },
    };
    overlay.show(summary);
    this.endOfRoundOverlayShownAt = Date.now();
    telemetry.trackEvent("end_of_round_overlay_shown", {
      game: "game3",
      endedReason: summary.endedReason ?? "UNKNOWN",
      ownTotal: this.roundAccumulatedWinnings,
      elapsedSinceEndedMs,
    });
  }

  private dismissEndOfRoundAndReturnToWaiting(): void {
    if (this.endScreenTimer) {
      clearTimeout(this.endScreenTimer);
      this.endScreenTimer = null;
    }
    const freshState = this.deps.bridge.getState();
    if (freshState.gameStatus === "RUNNING") {
      if (freshState.myTickets.length > 0) {
        this.transitionTo("PLAYING", freshState);
      } else {
        this.transitionTo("SPECTATING", freshState);
      }
    } else {
      this.transitionTo("WAITING", freshState);
    }
  }

  /**
   * Best-effort utledning av ended-reason fra state. Game3-spesifikt:
   * Game3Engine setter `endedReason: "G3_FULL_HOUSE"` ved Coverall, men
   * GameState eksponerer ikke feltet direkte — vi heuristisk tolker
   * BINGO_CLAIMED hvis Full House-pattern er vunnet.
   */
  private endedReasonFromState(state: GameState): string {
    const bingoPattern = state.patternResults.find(
      (r) => r.claimType === "BINGO" && r.isWon,
    );
    if (bingoPattern) return "BINGO_CLAIMED";
    if (
      state.drawnNumbers.length > 0 &&
      state.totalDrawCapacity > 0 &&
      state.drawnNumbers.length >= state.totalDrawCapacity
    ) {
      return "MAX_DRAWS_REACHED";
    }
    return "MANUAL_END";
  }

  private onNumberDrawn(number: number, drawIndex: number, state: GameState): void {
    if (this.phase === "PLAYING" && this.playScreen) {
      this.playScreen.onNumberDrawn(number, drawIndex, state);

      if (!this.buyMoreDisabled && state.disableBuyAfterBalls > 0 && state.drawCount >= state.disableBuyAfterBalls) {
        this.buyMoreDisabled = true;
        this.playScreen.disableBuyMore();
      }
    } else if ((this.phase === "WAITING" || this.phase === "SPECTATING") && this.playScreen) {
      this.playScreen.onSpectatorNumberDrawn(number, state);
    }
  }

  private onPatternWon(result: PatternWonPayload, _state: GameState): void {
    if (this.phase === "PLAYING" && this.playScreen) this.playScreen.onPatternWon(result);

    // Vis annonsering til alle spillere om at fasen er vunnet. Spill 3 bruker
    // engelske pattern-navn ("Row 1", "Full House") fra DEFAULT_GAME3_CONFIG —
    // PatternWon-toast leverer disse direkte. CenterTopPanel/PatternMiniGrid
    // mapper "Row N" → "Rad N" for visning, men toast'en bruker pattern-navnet
    // som det er for å unngå et separat oversettelseskart her.
    const isFullHouse = result.claimType === "BINGO";
    const phaseMsg = isFullHouse
      ? "Fullt Hus er vunnet. Spillet er over."
      : `${result.patternName} er vunnet!`;
    this.toast?.info(phaseMsg, 3000);

    const winnerIds = result.winnerIds ?? (result.winnerId ? [result.winnerId] : []);
    const isMe = this.myPlayerId !== null && winnerIds.includes(this.myPlayerId);
    const winnerCount = result.winnerCount ?? winnerIds.length;

    if (isMe) {
      this.deps.audio.playBingoSound();

      const shared = winnerCount > 1;
      const payout = result.payoutAmount ?? 0;
      this.roundAccumulatedWinnings += payout;
      if (isFullHouse) {
        this.isWinScreenActive = true;
        this.winScreen?.show({
          amount: this.roundAccumulatedWinnings,
          shared,
          sharedCount: winnerCount,
          onDismiss: () => {
            this.isWinScreenActive = false;
            // Spill 3 har ingen mini-games — vis end-of-round-overlay direkte
            // hvis runden er ENDED og overlay var holdt tilbake.
            if (this.shouldShowEndOfRoundOnWinScreenDismiss) {
              this.shouldShowEndOfRoundOnWinScreenDismiss = false;
              const freshState = this.deps.bridge.getState();
              if (this.phase === "ENDED" || freshState.gameStatus === "ENDED") {
                this.showEndOfRoundOverlayForState(freshState);
              } else {
                // Race: ny runde startet mens WinScreenV2 var oppe.
                this.dismissEndOfRoundAndReturnToWaiting();
              }
            }
          },
        });
      } else {
        // Fase 1-4 popup. classifyPhaseFromPatternName godtar både norske
        // ("1 Rad") og engelske ("Row 1") legacy-navn — vi bruker det
        // direkte siden Spill 3-patterns er navngitt på engelsk.
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
      game: "game3",
      patternName: result.patternName,
      isMe,
      payoutAmount: result.payoutAmount,
      winnerCount,
    });
  }

  private onBetRejected(event: BetRejectedEvent): void {
    if (this.myPlayerId !== null && event.playerId !== this.myPlayerId) {
      return;
    }
    const norsk =
      event.message ||
      Game3Controller.BET_REJECTED_FALLBACK_MESSAGES[event.reason] ||
      "Forhåndskjøp ble avvist.";
    this.toast?.error(norsk, 6000);
    this.playScreen?.hideBuyPopup();
  }

  private onWalletLossStateChanged(event: WalletLossStateEvent): void {
    this.playScreen?.updateBuyPopupLossState({
      dailyUsed: event.state.dailyUsed,
      dailyLimit: event.state.dailyLimit,
      monthlyUsed: event.state.monthlyUsed,
      monthlyLimit: event.state.monthlyLimit,
      walletBalance: event.state.walletBalance,
    });
  }

  private static readonly BET_REJECTED_FALLBACK_MESSAGES: Record<string, string> = {
    DAILY_LOSS_LIMIT_REACHED:
      "Du nådde dagens tapsgrense. Forhåndskjøpet ble derfor avvist.",
    MONTHLY_LOSS_LIMIT_REACHED:
      "Du nådde månedens tapsgrense. Forhåndskjøpet ble derfor avvist.",
    INSUFFICIENT_FUNDS:
      "Du har ikke nok saldo for å delta i denne runden. Forhåndskjøpet ble avvist.",
    PLAYER_TIMED_PAUSE: "Du er på frivillig pause. Forhåndskjøpet ble avvist.",
    PLAYER_REQUIRED_PAUSE:
      "Du har obligatorisk pause (60 min spilt). Forhåndskjøpet ble avvist.",
    PLAYER_SELF_EXCLUDED: "Du er selvutestengt. Forhåndskjøpet ble avvist.",
  };

  // ── Helpers ───────────────────────────────────────────────────────────

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
  }

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
registerGame("monsterbingo", (deps) => new Game3Controller(deps));
registerGame("game_3", (deps) => new Game3Controller(deps));
