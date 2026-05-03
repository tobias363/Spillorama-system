import { Container, Text } from "pixi.js";
import type { GameDeps, GameController } from "../registry.js";
import { registerGame } from "../registry.js";
import type { GameState } from "../../bridge/GameBridge.js";
import type {
  MiniGameActivatedPayload,
  MiniGameTriggerPayload,
  MiniGameResultPayload,
  PatternWonPayload,
  BetRejectedEvent,
  WalletLossStateEvent,
} from "@spillorama/shared-types/socket-events";
import { telemetry } from "../../telemetry/Telemetry.js";
import { PlayScreen } from "./screens/PlayScreen.js";
import { LuckyNumberPicker } from "./components/LuckyNumberPicker.js";
import { LoadingOverlay } from "../../components/LoadingOverlay.js";
import { preloadGameAssets } from "../../core/preloadGameAssets.js";
import { ToastNotification } from "./components/ToastNotification.js";
import { PauseOverlay } from "./components/PauseOverlay.js";
import { WinPopup } from "./components/WinPopup.js";
import { WinScreenV2 } from "./components/WinScreenV2.js";
import {
  Game1EndOfRoundOverlay,
  type Game1EndOfRoundSummary,
} from "./components/Game1EndOfRoundOverlay.js";
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
import { LegacyMiniGameAdapter } from "./logic/LegacyMiniGameAdapter.js";
import { Game1SocketActions } from "./logic/SocketActions.js";
import { Game1ReconnectFlow } from "./logic/ReconnectFlow.js";
import type { Phase } from "./logic/Phase.js";

/**
 * Legacy fallback timeout for stuck-ENDED-state recovery. Tobias UX-mandate
 * 2026-04-29: 3-fase fluid overlay (SUMMARY → LOADING → COUNTDOWN) auto-
 * dismisses i overlay self når ny runde starter eller countdown utløper —
 * controller har derfor ikke lenger en egen auto-dismiss-timer. Beholder
 * verdien som "panic timeout" for legacy-flyter (f.eks. hvis overlay ikke
 * blir mounted i det hele tatt og state henger i ENDED).
 */
const END_SCREEN_AUTO_DISMISS_MS = 10_000;

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
  /**
   * Tobias 2026-04-29 prod-incident-fix: end-of-round retail-overlay som
   * erstatter den tidligere Game 2-style {@link EndScreen}-Pixi-skjermen
   * for Spill 1. Vises etter Fullt Hus-claim eller MAX_DRAWS_REACHED med
   * komplett oppsummering + to CTA-knapper. HTML-basert (i likhet med
   * WinScreenV2/WinPopup) for full kontroll over knapper + click-events.
   */
  private endOfRoundOverlay: Game1EndOfRoundOverlay | null = null;
  /**
   * Tobias 2026-04-29: Siste mottatte mini-game-resultat. Lagres her slik at
   * end-of-round-overlay kan vise mini-game-utfallet sammen med
   * pattern-summary (mini-game-result kommer som separat socket-event,
   * ofte før eller samtidig som ENDED-state).
   */
  private lastMiniGameResult: MiniGameResultPayload | null = null;
  /**
   * Tobias UX-mandate 2026-04-29 (option C, fluid 3-phase overlay):
   * timestamp (ms epoch) for når runden endte. Overlay bruker dette for
   * disconnect-resilience: ved reconnect midt i overlay regner overlay
   * ut hvilken fase brukeren skal lande i basert på elapsed time.
   * Reset i onGameStarted (ny runde).
   */
  private roundEndedAt: number | null = null;
  /**
   * @deprecated Etter Tobias UX-mandat 2026-04-29 (revised) — overlay har
   * ikke lenger COUNTDOWN-fase, så buy-popup åpnes ikke lenger fra
   * overlay. Buy-popup vises av rom-state nativt når WAITING aktiverer.
   * Beholdes som no-op for bakoverkompatibilitet.
   */
  private buyPopupOpenedFromOverlay = false;
  /**
   * Tobias UX-mandate 2026-04-29 (revised): timestamp for når
   * end-of-round-overlay ble vist. Brukes for å detektere første
   * subsequent state-update som signaliserer at rommet har fersk
   * live-state — på det tidspunktet kalles `overlay.markRoomReady()`
   * slik at overlay kan dismisse seg.
   */
  private endOfRoundOverlayShownAt: number | null = null;
  private settingsPanel: SettingsPanel | null = null;
  private markerBgPanel: MarkerBackgroundPanel | null = null;
  private gamePlanPanel: GamePlanPanel | null = null;
  private miniGame: MiniGameRouter | null = null;
  /**
   * Tobias prod-incident 2026-04-29: legacy `minigame:activated` adapter for
   * Spill 1's auto-claim path. Coexists with `miniGame` (M6 router); only
   * one of them holds an active overlay at a time because both feed into
   * the same `root` Container and both check `isWinScreenActive` via the
   * controller's pendingMiniGameTrigger queue.
   */
  private legacyMiniGame: LegacyMiniGameAdapter | null = null;
  /**
   * Tobias prod-incident 2026-04-29: pending legacy trigger held while
   * WinScreenV2 is active (mirror of `pendingMiniGameTrigger`). Released
   * via `flushPendingMiniGameTrigger` on win-screen dismiss.
   */
  private pendingLegacyMiniGame: MiniGameActivatedPayload | null = null;
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
  /**
   * FIXED-PRIZE-FIX (Tobias 2026-04-26): akkumulert egen-vinning per
   * runde. Reset ved gameStarted. Brukes til å vise totalbeløp i
   * WinScreenV2 (Fullt Hus) i stedet for kun Fullt Hus-prizen.
   * Eksempel: 1 Rad 100 + 2 Rader 200 + 3 Rader 200 + 4 Rader 200 +
   * Fullt Hus 1000 = 1700 kr totalt vist i animasjonen.
   */
  private roundAccumulatedWinnings = 0;

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
    this.endOfRoundOverlay = new Game1EndOfRoundOverlay(overlayContainer);
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
    //
    // PIXI-P0-002 (Bølge 2A, 2026-04-28): wire `onChoiceLost` so a forced
    // dismiss on game-end (in-flight choice didn't ack in time) shows the
    // user a toast instead of failing silently.
    this.miniGame = new MiniGameRouter({
      root: this.root,
      app,
      socket,
      bridge,
      onChoiceLost: ({ resultId }) => {
        this.toast?.error(
          "Valget ble ikke registrert i tide. Eventuell gevinst krediteres automatisk.",
          6000,
        );
        console.warn("[Game1Controller] mini-game choice lost", { resultId });
      },
    });
    // Demo-blocker-fix 2026-04-29: når mini-game-overlay dismisses (etter
    // brukerens valg + animasjon), vis end-of-round-overlay hvis runden
    // er ENDED. Dette løser at vinneren tidligere mistet mini-game-popup
    // mens MAX_DRAWS-trekningen kjørte i bakgrunnen.
    this.miniGame.setOnAfterDismiss(() => this.onMiniGameDismissed());
    // Tobias prod-incident 2026-04-29: legacy `minigame:activated` adapter
    // for the auto-claim path (PR #727 emit chain). Server still emits
    // legacy events for Spill 1 auto-rounds; this adapter wraps them onto
    // the existing M6 overlays without changing the auto-claim protocol.
    this.legacyMiniGame = new LegacyMiniGameAdapter({
      root: this.root,
      app,
      socket,
      bridge,
    });
    this.legacyMiniGame.setOnAfterDismiss(() => this.onMiniGameDismissed());
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
      // Tobias-direktiv 2026-05-03: connection-error fallback — vis Loading-
      // overlayet med "Får ikke koblet til rom. Trykk her" (klikk = reload).
      this.loader.setError();
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
      // Tobias-direktiv 2026-05-03: room-join failure → samme connection-error
      // fallback. Hele overlayet er klikkbart → reload.
      this.loader.setError();
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
      // BIN-690 PR-M6: scheduled-games mini-game protocol.
      bridge.on("miniGameTrigger", (data) => this.handleMiniGameTrigger(data)),
      bridge.on("miniGameResult", (data) => {
        // Tobias 2026-04-29: lagre mini-game-resultat for visning i
        // end-of-round-overlay. Reset i onGameStarted (ny runde).
        this.lastMiniGameResult = data;
        this.miniGame?.onResult(data);
      }),
      // Tobias prod-incident 2026-04-29: legacy `minigame:activated` for
      // auto-claim Spill 1 mini-games. Routes through LegacyMiniGameAdapter
      // which renders the existing overlays with synthesized M6 trigger
      // payloads, then routes the choice via legacy `minigame:play`.
      bridge.on("legacyMinigameActivated", (data) => this.handleLegacyMiniGameActivated(data)),
      // Tobias 2026-04-29 (post-orphan-fix UX): bet:rejected — server
      // varsler at forhåndskjøp ble avvist på game-start. Vis klar
      // feilmelding via toast og fjern pre-round-bonger via room:update
      // (server frigir reservasjonen så bonger forsvinner ved neste push).
      bridge.on("betRejected", (event) => this.onBetRejected(event)),
      // Tobias 2026-04-29 (post-orphan-fix UX): wallet:loss-state push.
      // Oppdater Kjøp Bonger-popup-headeren hvis åpen.
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
    } else if (state.gameStatus === "ENDED") {
      // Tobias 2026-04-29 disconnect-resilience: bruker har koblet til
      // (eller re-koblet) i en ENDED-tilstand. Vis end-of-round-overlay
      // så de ser oppsummeringen i stedet for tom WAITING-skjerm uten
      // kontekst. Dette dekker også reload-mid-overlay-scenariet.
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
    this.lastMiniGameResult = null;
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
    this.legacyMiniGame?.destroy();
    this.legacyMiniGame = null;
    this.pendingLegacyMiniGame = null;
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
        // Tobias 2026-04-29 prod-incident-fix: ENDED-fasen viser ikke lenger
        // en Pixi-skjerm — i stedet bruker vi `Game1EndOfRoundOverlay` (HTML)
        // som monteres i onGameEnded(). Vi clearScreen()-er bare slik at
        // PlayScreen-instansen ikke ligger igjen og lekker mens overlay vises.
        // No-op her er bevisst.
        break;
    }
  }

  // ── Bridge event handlers ─────────────────────────────────────────────

  private onStateChanged(state: GameState): void {
    // ROUND-TRANSITION-FIX (Tobias 2026-04-27): defensiv recovery hvis
    // gameStarted-event ble droppet (race med endScreenTimer eller socket-
    // reorder): hvis state viser RUNNING men vi sitter fast i ENDED, hopp
    // direkte til PLAYING (har tickets) eller SPECTATING (ingen tickets).
    // Uten denne sjekken må bruker refreshe nettleseren mellom runder.
    if (this.phase === "ENDED" && state.gameStatus === "RUNNING") {
      if (this.endScreenTimer) {
        clearTimeout(this.endScreenTimer);
        this.endScreenTimer = null;
      }
      // Tobias 2026-04-29: lukk end-of-round-overlay før transition.
      this.endOfRoundOverlay?.hide();
      if (state.myTickets.length > 0) {
        this.transitionTo("PLAYING", state);
      } else {
        this.transitionTo("SPECTATING", state);
      }
      return;
    }

    // Tobias 2026-04-29 disconnect-resilience: hvis vi er i ENDED-fase
    // (overlay var oppe) og bare nettopp re-syncede etter reconnect,
    // sørg for at overlay fortsatt vises. Game1ReconnectFlow kan ha
    // forsynt en applySnapshot som triggrer denne stateChanged uten
    // at gameEnded-eventen fyrer på nytt.
    //
    // Demo-blocker-fix 2026-04-29: hold tilbake overlay hvis mini-game
    // er aktiv eller står i kø — vinneren MÅ få spille mini-game ferdig
    // før vi viser end-of-round-summary.
    const miniGameActive =
      this.miniGame?.isActive() === true ||
      this.legacyMiniGame?.isActive() === true ||
      this.pendingMiniGameTrigger !== null ||
      this.pendingLegacyMiniGame !== null;

    if (
      this.phase === "ENDED" &&
      state.gameStatus === "ENDED" &&
      this.endOfRoundOverlay &&
      !this.endOfRoundOverlay.isVisible() &&
      !this.isWinScreenActive &&
      !miniGameActive
    ) {
      this.showEndOfRoundOverlayForState(state);
    }

    // Tobias UX-mandate 2026-04-29 (revised): overlay forblir oppe inntil
    // controller signalerer "rommet har live-state klar". Vi tolker
    // FØRSTE state-update etter at overlay ble vist som signal om at
    // server har sendt fersk room-snapshot. 50ms-grace beskytter mot at
    // den same-tick state-changen som triggret show()-kallet kvalifiserer
    // som ready-signal — det skal være _neste_ state-update.
    if (
      this.endOfRoundOverlay?.isVisible() &&
      this.endOfRoundOverlayShownAt !== null &&
      Date.now() > this.endOfRoundOverlayShownAt + 50
    ) {
      this.endOfRoundOverlay.markRoomReady();
    }

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
      // MED-11: passere pauseUntil/pauseReason så overlay kan vise countdown
      // eller en konkret norsk fallback-tekst i stedet for "Spillet er pauset".
      this.pauseOverlay?.show({
        message: state.pauseMessage ?? undefined,
        pauseUntil: state.pauseUntil,
        pauseReason: state.pauseReason,
      });
    } else if (state.isPaused && this.pauseOverlay?.isShowing()) {
      // Allerede synlig — oppdater innholdet hvis backend har sendt nye
      // verdier (f.eks. master forlenget pausen).
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
    // ROUND-TRANSITION-FIX (Tobias 2026-04-27): hvis EndScreen-timer fortsatt
    // løper fra forrige runde, cancel den og hopp DIREKTE til ny runde —
    // ellers henger klient i ENDED til timeren firer (5s vindu) og glipper
    // start-events for neste runde, slik at bruker må refreshe nettleseren.
    if (this.endScreenTimer) {
      clearTimeout(this.endScreenTimer);
      this.endScreenTimer = null;
    }

    // Tobias 2026-04-29 prod-incident-fix: lukk end-of-round-overlay hvis
    // ny runde starter mens den fortsatt er åpen (rask auto-round).
    // Spilleren vil ellers se overlay-en oppå ny runde-state.
    this.endOfRoundOverlay?.hide();
    this.shouldShowEndOfRoundOnWinScreenDismiss = false;
    // Tobias UX-mandate 2026-04-29 (fluid 3-phase): reset timestamp og
    // buy-popup-trigger-guard for ny runde.
    this.roundEndedAt = null;
    this.buyPopupOpenedFromOverlay = false;
    // Tobias UX-mandate 2026-04-29 (revised): reset overlay-shown-timestamp
    // så neste runde-end starter med ren markRoomReady-gating.
    this.endOfRoundOverlayShownAt = null;

    // FIXED-PRIZE-FIX: reset round-accumulated winnings ved ny runde.
    this.roundAccumulatedWinnings = 0;
    // Tobias 2026-04-29: reset mini-game-result for ny runde.
    this.lastMiniGameResult = null;

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
    // Demo-blocker-fix 2026-04-29: mini-game-overlay må PERSIST etter
    // game-end ved Fullt Hus. Tidligere ble overlay revet ned umiddelbart
    // i `onGameEnded` slik at vinneren ikke fikk se Mystery / Wheel /
    // Chest / ColorDraft (server hadde aktivert mini-game POST-Fullt-Hus
    // men runden var allerede ENDED når klient mottok pattern:won).
    //
    // Sjekk om en mini-game er aktiv eller står i kø — hvis så, hopp
    // over dismiss-en. Mini-game-overlay tar ansvar for sin egen lifecycle:
    //   - Wheel/Chest/ColorDraft/Mystery: overlay-en kaller `dismiss`
    //     etter resultat-animasjon er ferdig.
    //   - End-of-round-overlay holdes tilbake (via mini-game-router /
    //     legacy-adapter sin onDismiss-callback) til mini-game er ferdig.
    //
    // Hvis ingen mini-game er aktiv (typisk MAX_DRAWS_REACHED uten Fullt
    // Hus, eller cancellation-path), dismiss som før.
    const miniGameActive =
      this.miniGame?.isActive() === true ||
      this.legacyMiniGame?.isActive() === true ||
      this.pendingMiniGameTrigger !== null ||
      this.pendingLegacyMiniGame !== null;

    if (!miniGameActive) {
      // Ingen mini-game i bildet — trygt å dismisse evt. zombie-overlay.
      // PIXI-P0-002 (Bølge 2A, 2026-04-28): use the graceful dismiss so we
      // briefly wait for any in-flight `mini_game:choice` ack before tearing
      // the overlay down. Without this, a player who clicked just before the
      // game ended would lose their choice silently. Backend remains
      // idempotent on choice (orchestrator `completed_at` lock) so a late
      // ack after the wait doesn't double-pay; the wait just shrinks the
      // user-visible loss window. Fire-and-forget — overlay-show below
      // doesn't depend on the mini-game overlay being gone yet.
      void this.miniGame?.dismissAfterPendingChoices();
      // Tobias prod-incident 2026-04-29: legacy adapter doesn't have a
      // pending-choice drain (legacy `minigame:play` is fire-and-ack with no
      // intermediate state), so a synchronous dismiss is correct. The
      // overlay is destroyed if active.
      this.legacyMiniGame?.dismiss();
      this.pendingLegacyMiniGame = null;
    }

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
      // Tobias UX-mandate 2026-04-29 (fluid 3-phase overlay): timestamp
      // round-end så overlay ved reconnect kan beregne hvilken fase
      // (SUMMARY/LOADING/COUNTDOWN) brukeren skal lande i.
      this.roundEndedAt = Date.now();
      this.buyPopupOpenedFromOverlay = false;
      // Tobias 2026-04-29 prod-incident-fix: vis end-of-round-overlay
      // i stedet for Pixi-EndScreen. Hvis WinScreenV2 (Fullt Hus-fontene)
      // er aktiv, holder vi tilbake overlay til den lukkes — slik at
      // animasjonen får ferdig-spille uten å bli klippet av summary-
      // vinduet.
      //
      // Demo-blocker-fix 2026-04-29: hvis mini-game er aktiv (eller
      // pending), holdes end-of-round tilbake også. Mini-game-overlay
      // kaller vår onResult/onDismiss-hook når den er ferdig, og da
      // viser end-of-round-overlay seg via onStateChanged-recovery-pathen.
      if (this.isWinScreenActive) {
        // WinScreenV2.onDismiss kaller flushPendingMiniGameTrigger som
        // vi her utvider til også å vise end-of-round-overlay. Vi
        // bruker en flag siden vi ikke vil endre WinScreenV2-API-en.
        this.shouldShowEndOfRoundOnWinScreenDismiss = true;
      } else if (
        this.miniGame?.isActive() === true ||
        this.legacyMiniGame?.isActive() === true ||
        this.pendingMiniGameTrigger !== null ||
        this.pendingLegacyMiniGame !== null
      ) {
        // Mini-game vises eller står i kø — utsett end-of-round-overlay
        // til mini-game-routeren/legacy-adapteren melder fra at brukeren
        // er ferdig (overlay.onDismiss → onStateChanged-recovery).
        this.shouldShowEndOfRoundOnWinScreenDismiss = true;
      } else {
        this.showEndOfRoundOverlayForState(state);
      }
    } else {
      this.transitionTo("WAITING", state);
    }
  }

  /**
   * Tobias UX-mandate 2026-04-29 (fluid 3-phase overlay): åpne end-of-
   * round-overlay som transitions naturlig gjennom SUMMARY → LOADING →
   * COUNTDOWN. Kalt fra `onGameEnded` (PLAYING-fase) eller fra
   * `flushPendingMiniGameTrigger` etter at WinScreenV2 er lukket.
   *
   * Phase 3 (COUNTDOWN) trigger:
   *   - `onCountdownNearStart` fyrer ved ≤5 sek igjen → vi åpner buy-popup
   *     ON TOP av countdown. Loss-state-header fra PR #725 forblir intakt
   *     siden vi ikke endrer Game1BuyPopup.
   *   - `onOverlayCompleted` fyrer hvis countdown utløper uten at ny
   *     runde starter (manuell modus / scheduler-glipp). Brukes som
   *     fallback for å transition til WAITING.
   *
   * Disconnect-resilience: `elapsedSinceEndedMs` lar overlay starte i
   * riktig fase. En spiller som reconnecter midt i countdown ser IKKE
   * SUMMARY igjen.
   */
  private showEndOfRoundOverlayForState(state: GameState): void {
    const overlay = this.endOfRoundOverlay;
    if (!overlay) return;

    // Compute elapsed time since round ended for disconnect-resilience.
    // If roundEndedAt is null (e.g. late-join via reconnect), fall back
    // to 0 so overlay starts at SUMMARY phase 1.
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
      miniGameResult: this.lastMiniGameResult,
      luckyNumber: state.myLuckyNumber,
      ownRoundWinnings: this.roundAccumulatedWinnings,
      millisUntilNextStart: state.millisUntilNextStart ?? null,
      elapsedSinceEndedMs,
      onBackToLobby: () => {
        // Lukk overlay + emit window-event som lobby/router kan lytte til.
        // Eksisterende lobby-shell håndterer `spillorama:returnToLobby`
        // som standard-navigasjon (samme channel som returnToShellLobby
        // i Unity-host).
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("spillorama:returnToLobby"));
        }
        this.dismissEndOfRoundAndReturnToWaiting();
      },
      // onCountdownNearStart fjernet 2026-04-29 (revised UX-mandat):
      // overlay har ikke lenger COUNTDOWN-fase. Buy-popup vises av selve
      // PlayScreen når room-state transitionerer til WAITING — ikke fra
      // overlay. Dette sikrer at brukeren faktisk ser live room-elementer
      // (pattern-animasjon, neste-spill-info) når overlay dismisses.
      onCountdownNearStart: undefined,
      onOverlayCompleted: () => {
        // Countdown utløp uten at ny runde startet (manuell-modus eller
        // scheduler-glipp). Transition fallback til WAITING.
        this.dismissEndOfRoundAndReturnToWaiting();
      },
    };
    overlay.show(summary);
    // Tobias UX-mandate 2026-04-29 (revised): tag tidspunktet for at
    // onStateChanged kan bruke det som "barriere" — neste state-update
    // (etter 50ms grace) kvalifiserer som room-ready-signal og kaller
    // overlay.markRoomReady().
    this.endOfRoundOverlayShownAt = Date.now();
    telemetry.trackEvent("end_of_round_overlay_shown", {
      endedReason: summary.endedReason ?? "UNKNOWN",
      ownTotal: this.roundAccumulatedWinnings,
      millisUntilNextStart: summary.millisUntilNextStart ?? 0,
      elapsedSinceEndedMs,
    });
  }

  /**
   * Tobias 2026-04-29: cleanup-path når overlay lukkes (klikk eller auto-
   * dismiss). Transitionerer til WAITING med fersk state, og hvis state
   * allerede har gått over til RUNNING (auto-round race) plukker
   * onStateChanged opp recovery-pathen.
   */
  private dismissEndOfRoundAndReturnToWaiting(): void {
    if (this.endScreenTimer) {
      clearTimeout(this.endScreenTimer);
      this.endScreenTimer = null;
    }
    const freshState = this.deps.bridge.getState();
    // Hvis ny runde allerede er i gang (rask auto-round), hopp direkte
    // til PLAYING/SPECTATING. Ellers: WAITING viser pre-round-buy-popup
    // som vanlig.
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
   * Tobias 2026-04-29: Hent endedReason fra current GameSnapshot. Bridge
   * eksponerer ikke endedReason direkte i sin GameState, men reason kommer
   * via roomSnapshot's currentGame. Vi bruker bridge.getState() og leter
   * etter et heuristikk: "BINGO_CLAIMED" hvis Fullt Hus er vunnet (den
   * eneste pattern med claimType=BINGO som typisk finnes i Spill 1), ellers
   * "MAX_DRAWS_REACHED" som fallback.
   *
   * NB: dette er en best-effort tolkning siden GameState ikke har
   * `endedReason`-feltet. For mer presist svar kan backend pushe det i
   * en framtidig wire-utvidelse, men for retail-UX-tekst er dette
   * tilstrekkelig.
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

  /**
   * Tobias 2026-04-29: flagg som settes i onGameEnded når WinScreenV2
   * (Fullt Hus) er aktiv. Når WinScreenV2 lukkes (Tilbake-klikk eller
   * 10.8s auto-close), kaller vi `flushPendingMiniGameTrigger()` som har
   * blitt utvidet til også å vise end-of-round-overlay.
   */
  private shouldShowEndOfRoundOnWinScreenDismiss = false;

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
      // FIXED-PRIZE-FIX: akkumuler vinningen før vi viser overlay.
      // For Fullt Hus viser WinScreenV2 hele round-totalen — annonsert
      // til spilleren som "1 Rad 100 + 2 Rader 200 + ... + Fullt Hus 1000
      // = 1700 kr". Fase 1-4-popup viser fortsatt kun fase-prisen.
      this.roundAccumulatedWinnings += payout;
      if (isFullHouse) {
        this.isWinScreenActive = true;
        this.winScreen?.show({
          amount: this.roundAccumulatedWinnings,
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
   * Tobias 2026-04-29 (post-orphan-fix UX): server pusher `bet:rejected` når
   * forhåndskjøp avvises på game-start (loss-limit eller insufficient
   * funds). Vi viser en klar Norsk feilmelding via toast.
   *
   * Pre-round-bongene blir automatisk fjernet via det neste `room:update`
   * (server frigjør reservasjonen og fjerner display-cachen) — vi trenger
   * ikke gjøre noe ekstra med tickets på klienten utover å vise meldingen.
   */
  private onBetRejected(event: BetRejectedEvent): void {
    // Filtrer mot myPlayerId så vi ikke viser feilmeldinger for andre
    // spillere i samme rom (forsvarlig defense — server emitter til
    // wallet:<walletId>-rommet, men paranoid-sjekk koster lite).
    if (this.myPlayerId !== null && event.playerId !== this.myPlayerId) {
      return;
    }
    const norsk =
      event.message ||
      Game1Controller.BET_REJECTED_FALLBACK_MESSAGES[event.reason] ||
      "Forhåndskjøp ble avvist.";
    // Bruk error-toast (rød) for tydelig regulatorisk-varsel.
    this.toast?.error(norsk, 6000);
    // Hvis Kjøp Bonger-popup-en er åpen, lukk den så bruker ser
    // toast-en og kan ta inn beskjeden uten å klikke seg ut først.
    this.playScreen?.hideBuyPopup();
  }

  /**
   * Tobias 2026-04-29 (post-orphan-fix UX): wallet:loss-state-push fra
   * server etter committed buy-in. Hvis Kjøp Bonger-popup-en er åpen,
   * oppdater "Brukt i dag: X / Y kr"-headeren live.
   */
  private onWalletLossStateChanged(event: WalletLossStateEvent): void {
    // Game1BuyPopup updater seg selv via PlayScreen-helper.
    this.playScreen?.updateBuyPopupLossState({
      dailyUsed: event.state.dailyUsed,
      dailyLimit: event.state.dailyLimit,
      monthlyUsed: event.state.monthlyUsed,
      monthlyLimit: event.state.monthlyLimit,
      walletBalance: event.state.walletBalance,
    });
  }

  /**
   * Tobias 2026-04-29: Norsk-fallback for bet:rejected reason-koder.
   * Server pleier å sende ferdig-formaterte meldinger via `event.message`,
   * men hvis serveren mangler kontekst (eldre prod-deploy), bruker vi
   * disse som fallback.
   */
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

  /**
   * Tobias prod-incident 2026-04-29: bridge-listener for legacy
   * `minigame:activated` (Spill 1 auto-claim path, PR #727 emit chain).
   * Same WinScreenV2-queueing logic as `handleMiniGameTrigger` so the
   * popup doesn't clip over the Fullt Hus fontene-animasjon. Server-
   * autoritativ: if multiple triggers arrive while WinScreenV2 is up,
   * the last one wins.
   */
  private handleLegacyMiniGameActivated(payload: MiniGameActivatedPayload): void {
    if (this.isWinScreenActive) {
      this.pendingLegacyMiniGame = payload;
      return;
    }
    this.legacyMiniGame?.onActivated(payload);
  }

  /**
   * Demo-blocker-fix 2026-04-29: callback fra MiniGameRouter /
   * LegacyMiniGameAdapter når mini-game-overlay er dismissed (etter
   * brukervalg + animasjon). Hvis runden er ENDED og end-of-round-
   * overlay var holdt tilbake (`shouldShowEndOfRoundOnWinScreenDismiss`),
   * vis det nå.
   *
   * Hvorfor denne pathen er nødvendig: MAX_DRAWS-fixen i server hindrer
   * trekninger etter Fullt Hus, men klient-side blir mini-game-overlay
   * fortsatt revet ned hvis vi blindt dismisser i `onGameEnded`. Vi
   * holder mini-game oppe inntil overlay selv signaliserer at den er
   * ferdig, og DA viser vi end-of-round-overlay som rapporten brukeren
   * skal se.
   */
  private onMiniGameDismissed(): void {
    // Bare relevant hvis vi faktisk satt flagget (Fullt Hus + game ENDED-
    // path). Ellers: ingen end-of-round å vise — dismiss var bare en
    // normal cleanup mid-round.
    if (!this.shouldShowEndOfRoundOnWinScreenDismiss) return;
    if (this.isWinScreenActive) return; // WinScreenV2 vil flushe selv

    this.shouldShowEndOfRoundOnWinScreenDismiss = false;
    const freshState = this.deps.bridge.getState();
    if (this.phase === "ENDED" || freshState.gameStatus === "ENDED") {
      this.showEndOfRoundOverlayForState(freshState);
    } else {
      // Race: ny runde startet mens mini-game var oppe — gå direkte til
      // WAITING/PLAYING (samme recovery-pathing som overlay's onClickKlar).
      this.dismissEndOfRoundAndReturnToWaiting();
    }
  }

  /**
   * Spill av evt. pending mini-game-trigger + åpne end-of-round-overlay
   * dersom det ble holdt tilbake av WinScreenV2.
   *
   * Tobias 2026-04-29 prod-incident-fix: WinScreenV2 (Fullt Hus-fontene)
   * er en stor scene som kjører ~10.8s. Hvis end-of-round-overlay viser
   * seg samtidig blir WinScreenV2 klippet av (ulik z-index, samme
   * overlay-container). Vi venter til WinScreenV2 er lukket FØR vi
   * monterer end-of-round-overlay. Det samme prinsippet gjelder for
   * pending mini-game-trigger som backend fyrer POST-Fullt Hus.
   *
   * Rekkefølge:
   *   1. WinScreenV2 lukket (klikk eller 10.8s auto-close)
   *   2. Mini-game-overlay vises hvis pending (M6 + legacy)
   *   3. Mini-game-resultat fyrer (lagres i lastMiniGameResult)
   *   4. Mini-game-overlay lukkes — eller hvis ingen mini-game var pending,
   *      kjør direkte til steg 5
   *   5. End-of-round-overlay vises (fra denne flushen, eller fra
   *      mini-game-overlay-onDismiss-pathen)
   */
  private flushPendingMiniGameTrigger(): void {
    let hasPending = false;
    const pending = this.pendingMiniGameTrigger;
    if (pending) {
      this.pendingMiniGameTrigger = null;
      this.miniGame?.onTrigger(pending);
      hasPending = true;
    }
    // Tobias prod-incident 2026-04-29: også flush pending legacy trigger.
    // Begge protokoller deler WinScreen-køen men ruter til hver sin overlay-
    // manager.
    const pendingLegacy = this.pendingLegacyMiniGame;
    if (pendingLegacy) {
      this.pendingLegacyMiniGame = null;
      this.legacyMiniGame?.onActivated(pendingLegacy);
      hasPending = true;
    }
    if (hasPending) {
      // Mini-game tar over scenen — vi viser end-of-round-overlay etter
      // at brukeren har gjort sitt valg (mini-game-router/legacy-adapter
      // emitter result-event som vi capturer i lastMiniGameResult). Show-
      // call gjøres når mini-game-overlay lukkes (eller når brukeren
      // returnerer til ENDED-state uten aktivt mini-game via
      // onStateChanged-pathen).
      return;
    }
    // Ingen pending mini-game — vis end-of-round-overlay nå hvis runden
    // faktisk er ENDED (kan ha endret seg mens vi ventet).
    if (this.shouldShowEndOfRoundOnWinScreenDismiss) {
      this.shouldShowEndOfRoundOnWinScreenDismiss = false;
      const freshState = this.deps.bridge.getState();
      if (this.phase === "ENDED" || freshState.gameStatus === "ENDED") {
        this.showEndOfRoundOverlayForState(freshState);
      } else {
        // Race: en ny runde startet mens WinScreenV2 var oppe — gå direkte.
        this.dismissEndOfRoundAndReturnToWaiting();
      }
    }
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
    // endScreen-feltet ble fjernet i Tobias 2026-04-29 prod-incident-fix —
    // ENDED-fasen bruker nå Game1EndOfRoundOverlay (HTML) i stedet for en
    // Pixi-basert EndScreen.
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
