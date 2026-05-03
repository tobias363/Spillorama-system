import { Container, Text } from "pixi.js";
import type { GameDeps, GameController } from "../registry.js";
import { registerGame } from "../registry.js";
import type { GameState } from "../../bridge/GameBridge.js";
import type { PatternWonPayload } from "@spillorama/shared-types/socket-events";
import { telemetry } from "../../telemetry/Telemetry.js";
import { LoadingOverlay } from "../../components/LoadingOverlay.js";
import { LobbyScreen } from "./screens/LobbyScreen.js";
import { PlayScreen } from "./screens/PlayScreen.js";
import { EndScreen } from "./screens/EndScreen.js";
import { ChooseTicketsScreen } from "./screens/ChooseTicketsScreen.js";
import { SpilloramaApi } from "../../net/SpilloramaApi.js";

/**
 * Phase-maskin for Game 2 (Spill 2 / Tallspill).
 * BIN-507 port: SPECTATING lagt til for late-joiner midt i runde.
 */
type Phase = "LOADING" | "LOBBY" | "PLAYING" | "SPECTATING" | "ENDED";

/**
 * Game 2 (Spill 2 / Tallspill) controller.
 * Manages the full lifecycle: join room → lobby → gameplay → end → loop.
 */
class Game2Controller implements GameController {
  private deps: GameDeps;
  private root: Container;
  private phase: Phase = "LOADING";
  private currentScreen: Container | null = null;
  private lobbyScreen: LobbyScreen | null = null;
  private playScreen: PlayScreen | null = null;
  private endScreen: EndScreen | null = null;
  private chooseTicketsScreen: ChooseTicketsScreen | null = null;
  private api: SpilloramaApi = new SpilloramaApi("");
  private myPlayerId: string | null = null;
  private actualRoomCode: string = "";
  private unsubs: (() => void)[] = [];
  private loader: LoadingOverlay | null = null;

  constructor(deps: GameDeps) {
    this.deps = deps;
    this.root = new Container();
  }

  async start(): Promise<void> {
    const { app, socket, bridge } = this.deps;
    app.stage.addChild(this.root);

    // BIN-500 port: loader holdes til syncReady (se waitForSyncReady).
    const overlayContainer = app.app.canvas.parentElement ?? document.body;
    this.loader = new LoadingOverlay(overlayContainer);
    this.loader.show("Kobler til...");

    // Connect socket
    console.log("[Game2] Connecting socket...");
    socket.connect();

    // Wait for connection with timeout
    const connected = await new Promise<boolean>((resolve) => {
      if (socket.isConnected()) { resolve(true); return; }
      const timeout = setTimeout(() => { resolve(false); }, 10000);
      const unsub = socket.on("connectionStateChanged", (state) => {
        console.log("[Game2] Socket state:", state);
        if (state === "connected") { unsub(); clearTimeout(timeout); resolve(true); }
      });
    });

    if (!connected) {
      this.loader?.hide();
      this.showError("Kunne ikke koble til server");
      return;
    }
    console.log("[Game2] Socket connected");
    this.loader?.show("Joiner rom...");

    // Track socket stability
    this.unsubs.push(
      socket.on("connectionStateChanged", (state) => {
        if (state === "reconnecting") telemetry.trackReconnect();
        if (state === "disconnected") telemetry.trackDisconnect("socket");
      }),
    );

    // Join or create room
    console.log("[Game2] Joining room, hallId:", this.deps.hallId);
    const joinResult = await socket.createRoom({
      hallId: this.deps.hallId,
      gameSlug: "rocket",
    });

    if (!joinResult.ok || !joinResult.data) {
      console.error("[Game2] Room join failed:", joinResult.error);
      this.loader?.hide();
      this.showError(joinResult.error?.message || "Kunne ikke joine rom");
      return;
    }

    this.myPlayerId = joinResult.data.playerId;
    this.actualRoomCode = joinResult.data.roomCode;
    console.log("[Game2] Joined room:", this.actualRoomCode, "playerId:", this.myPlayerId);

    // Start bridge
    bridge.start(this.myPlayerId);
    bridge.applySnapshot(joinResult.data.snapshot);

    // Subscribe to bridge events
    this.unsubs.push(
      bridge.on("stateChanged", (state) => this.onStateChanged(state)),
      bridge.on("gameStarted", (state) => this.onGameStarted(state)),
      bridge.on("gameEnded", (state) => this.onGameEnded(state)),
      bridge.on("numberDrawn", (num, idx, state) => this.onNumberDrawn(num, idx, state)),
      bridge.on("patternWon", (result, state) => this.onPatternWon(result, state)),
    );

    // 2026-05-02 (Tobias UX): Spill 2 jackpot-bar oppdaterer ved hver
    // G2-trekning. Backend sender komplett 6-slot-prize-listen
    // (9/10/11/12/13/14-21) på `g2:jackpot:list-update`-event.
    this.unsubs.push(
      socket.on("g2JackpotListUpdate", (payload) => {
        this.playScreen?.updateJackpot(payload.jackpotList);
      }),
    );

    // Unlock audio on first interaction
    this.root.eventMode = "static";
    this.root.on("pointerdown", () => this.deps.audio.unlock(), { once: true });

    // BIN-530/531 port: ingen auto-arm. Spilleren må eksplisitt kjøpe via
    // BuyPopup i LOBBY-fasen. G1 fjernet auto-arm 2026-04-16 (commit dc03e24e);
    // G2 følger nå samme mønster.

    // BIN-500 port: loader-barriere før transition — sikrer at late-joiner
    // ser live trekning i stedet for visual pop-in.
    await this.waitForSyncReady();
    this.loader?.hide();

    // Transition based on initial game state
    const state = bridge.getState();
    console.log("[Game2] Initial state:", state.gameStatus, "tickets:", state.myTickets.length, "players:", state.playerCount);

    if (state.gameStatus === "RUNNING") {
      // BIN-507 port: late-joiner midt i runde uten tickets → SPECTATING
      if (state.myTickets.length > 0) {
        this.transitionTo("PLAYING", state);
      } else {
        this.transitionTo("SPECTATING", state);
      }
    } else {
      this.transitionTo("LOBBY", state);
    }
  }

  /**
   * BIN-500 port: loader-barriere for late-join. For RUNNING ved inngang:
   * vent på første live drawNew eller stateChanged (maks 5 sek) før loader
   * fjernes — sikrer at klient rendrer samme tilstand som resten av rommet.
   */
  private async waitForSyncReady(): Promise<void> {
    const { bridge } = this.deps;
    const syncStartedAt = Date.now();
    const SYNC_TIMEOUT_MS = 5000;

    const state = bridge.getState();
    const isRunningAtEntry = state.gameStatus === "RUNNING";

    if (!isRunningAtEntry) {
      telemetry.trackEvent("late_join_sync", {
        game: "game2",
        syncGapMs: Date.now() - syncStartedAt,
        gotLiveEvent: false,
        skipped: "not-running",
      });
      return;
    }

    this.loader?.show("Syncer...");
    const gotLiveEvent = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), SYNC_TIMEOUT_MS);
      const unsubDraw = bridge.on("numberDrawn", () => {
        clearTimeout(timer);
        unsubDraw();
        unsubState();
        resolve(true);
      });
      const unsubState = bridge.on("stateChanged", (s) => {
        if (s.drawnNumbers.length > state.drawnNumbers.length) {
          clearTimeout(timer);
          unsubDraw();
          unsubState();
          resolve(true);
        }
      });
    });

    const syncGap = Date.now() - syncStartedAt;
    telemetry.trackEvent("late_join_sync", { game: "game2", syncGapMs: syncGap, gotLiveEvent });
    if (!gotLiveEvent) {
      console.warn(`[Game2] sync-timeout etter ${syncGap}ms — slipper loader med snapshot-state`);
    }
  }

  destroy(): void {
    for (const unsub of this.unsubs) unsub();
    this.unsubs = [];
    this.loader?.destroy();
    this.loader = null;
    this.clearScreen();
    this.root.destroy({ children: true });
  }

  // ── State transitions ─────────────────────────────────────────────────

  private transitionTo(phase: Phase, state: GameState): void {
    console.log("[Game2] Transition:", this.phase, "→", phase);
    this.phase = phase;
    this.clearScreen();

    const w = this.deps.app.app.screen.width;
    const h = this.deps.app.app.screen.height;

    switch (phase) {
      case "LOBBY":
        this.lobbyScreen = new LobbyScreen(w, h);
        this.lobbyScreen.setOnBuy((count) => this.handleBuy(count));
        this.lobbyScreen.setOnLuckyNumber((n) => this.handleLuckyNumber(n));
        // 2026-05-02 (Tobias UX, PDF 17 wireframe): "Kjøp flere brett"-pill
        // i ComboPanel åpner Choose Tickets-side. Spiller kan velge
        // spesifikke brett fra 32-pool i stedet for å la systemet
        // random-allotte.
        this.lobbyScreen.setOnChooseTickets(() => this.openChooseTicketsScreen());
        this.lobbyScreen.update(state);
        // 2026-05-03 (Agent T, fix/spill2-pixel-match-design-v2): auto-show
        // av BuyPopup i LOBBY fjernet per Tobias-direktiv. Designet
        // (Bong Mockup v2) viser BallTube + bong-grid + ComboPanel uten
        // overlay i midten. BuyPopup styres nå kun av eksplisitt klikk
        // på "Kjøp flere brett"-pill i ComboPanel.
        this.setScreen(this.lobbyScreen);
        break;

      case "PLAYING":
        this.playScreen = new PlayScreen(w, h, this.deps.audio, this.deps.socket, this.actualRoomCode);
        this.playScreen.setOnClaim((type) => this.handleClaim(type));
        // 2026-05-03 (Agent E, Bong Mockup-design): Lykketall + "Kjøp flere
        // brett" lever nå inne i PlayScreen.ComboPanel (var i LobbyScreen).
        this.playScreen.setOnLuckyNumber((n) => this.handleLuckyNumber(n));
        this.playScreen.setOnChooseTickets(() => this.openChooseTicketsScreen());
        // 2026-05-03 (Agent L): mellom-runde buy-popup wire-up.
        this.playScreen.setOnBuyForNextRound((count) => this.handleBuyForNextRound(count));
        this.playScreen.buildTickets(state);
        this.playScreen.updateInfo(state);
        this.setScreen(this.playScreen);
        break;

      case "SPECTATING":
        // BIN-507 port: samme render som PLAYING men uten tickets å markere.
        // Server-guards (MARKS_NOT_FOUND, PLAYER_NOT_PARTICIPATING) blokkerer
        // mark/claim fra spectators uansett.
        this.playScreen = new PlayScreen(w, h, this.deps.audio, this.deps.socket, this.actualRoomCode);
        this.playScreen.setOnClaim((type) => this.handleClaim(type));
        this.playScreen.setOnLuckyNumber((n) => this.handleLuckyNumber(n));
        this.playScreen.setOnChooseTickets(() => this.openChooseTicketsScreen());
        // 2026-05-03 (Agent L): mellom-runde buy-popup wire-up — også for
        // spectators. De får mulighet til å hoppe inn i neste runde.
        this.playScreen.setOnBuyForNextRound((count) => this.handleBuyForNextRound(count));
        this.playScreen.buildTickets(state); // tom ticket-seksjon for spectator
        this.playScreen.updateInfo(state);
        this.setScreen(this.playScreen);
        break;

      case "ENDED":
        this.endScreen = new EndScreen(w, h);
        this.endScreen.setOnDismiss(() => {
          this.transitionTo("LOBBY", this.deps.bridge.getState());
        });
        this.endScreen.show(state);
        this.setScreen(this.endScreen);
        break;
    }
  }

  // ── Bridge event handlers ─────────────────────────────────────────────

  private onStateChanged(state: GameState): void {
    if (this.phase === "LOBBY" && this.lobbyScreen) {
      this.lobbyScreen.update(state);
    }
    if ((this.phase === "PLAYING" || this.phase === "SPECTATING") && this.playScreen) {
      this.playScreen.updateInfo(state);
      // 2026-05-03 (Agent T, fix/spill2-pixel-match-design-v2): auto-vis
      // av BuyPopup mid-runde fjernet. Per Tobias-direktiv: BuyPopup skal
      // KUN vises når spilleren ELSPLISITT klikker "Kjøp flere brett" i
      // ComboPanel — ingen overlay i midten av PlayScreen som dekker
      // bong-grid og BallTube.
    }
  }

  private onGameStarted(state: GameState): void {
    console.log("[Game2] Game started, tickets:", state.myTickets.length);
    // 2026-05-03 (Agent T): popup styres nå kun av eksplisitt klikk; vi
    // skjuler likevel ved ny runde-start i tilfelle den var åpen.
    this.playScreen?.hideBuyPopupForNextRound();

    if (state.myTickets.length > 0) {
      this.transitionTo("PLAYING", state);
    } else {
      // BIN-507 port: runde starter uten billetter → SPECTATING (ikke LOBBY).
      // Spilleren ser live trekninger midt i runde i stedet for lobby-
      // countdown mot neste runde.
      console.log("[Game2] → SPECTATING (no tickets, round is running)");
      this.transitionTo("SPECTATING", state);
    }
  }

  private onGameEnded(state: GameState): void {
    console.log("[Game2] Game ended");
    if (this.phase === "PLAYING") {
      this.transitionTo("ENDED", state);
    } else {
      // SPECTATING eller LOBBY → LOBBY (ny runde kan kjøpes til)
      this.transitionTo("LOBBY", state);
    }

    // BIN-530/531 port: ingen auto-re-arm. Spilleren velger i BuyPopup.
  }

  private onNumberDrawn(number: number, drawIndex: number, state: GameState): void {
    if ((this.phase === "PLAYING" || this.phase === "SPECTATING") && this.playScreen) {
      this.playScreen.onNumberDrawn(number, drawIndex, state);
      // 2026-05-03 (Agent T): ingen auto-popup-trigger her — BuyPopup
      // styres kun av eksplisitt klikk på "Kjøp flere brett".
    }
  }

  private onPatternWon(result: PatternWonPayload, _state: GameState): void {
    if (this.phase === "PLAYING" && this.playScreen) {
      this.playScreen.onPatternWon(result);
    }
    telemetry.trackEvent("pattern_won", {
      patternName: result.patternName,
      isMe: result.winnerId === this.myPlayerId,
      payoutAmount: result.payoutAmount,
    });
  }

  // ── User actions ──────────────────────────────────────────────────────

  private async handleBuy(_count: number): Promise<void> {
    console.log("[Game2] Arming bet, roomCode:", this.actualRoomCode);
    const result = await this.deps.socket.armBet({
      roomCode: this.actualRoomCode,
      armed: true,
    });

    if (result.ok) {
      console.log("[Game2] Armed successfully");
      this.lobbyScreen?.hideBuyPopup();
    } else {
      console.error("[Game2] Arm failed:", result.error);
      this.showError(result.error?.message || "Kunne ikke kjøpe billetter");
    }
  }

  /**
   * 2026-05-03 (Agent L → Agent T): kjøp utløst fra BuyPopup som åpnes
   * eksplisitt via "Kjøp flere brett"-pill i ComboPanel. Auto-trigger er
   * fjernet — popup er nå en ren modal som spilleren selv åpner. Samme
   * bet:arm-flyt som lobby-kjøp.
   */
  private async handleBuyForNextRound(_count: number): Promise<void> {
    console.log("[Game2] Arming bet for next round (modal popup), roomCode:", this.actualRoomCode);
    const result = await this.deps.socket.armBet({
      roomCode: this.actualRoomCode,
      armed: true,
    });

    if (result.ok) {
      console.log("[Game2] Armed successfully (modal popup)");
      this.playScreen?.hideBuyPopupForNextRound();
    } else {
      console.error("[Game2] Arm failed (modal popup):", result.error);
      this.showError(result.error?.message || "Kunne ikke kjøpe billetter");
    }
  }

  private async handleLuckyNumber(number: number): Promise<void> {
    console.log("[Game2] Setting lucky number:", number);
    await this.deps.socket.setLuckyNumber({
      roomCode: this.actualRoomCode,
      luckyNumber: number,
    });
  }

  /**
   * 2026-05-02 (Tobias UX, PDF 17 wireframe side 5): åpne Choose Tickets-
   * skjerm med 32 forhåndsgenererte brett. Spiller velger ønskede + Pick
   * Any Number, Buy → tilbake til Lobby.
   */
  private openChooseTicketsScreen(): void {
    const w = this.deps.app.app.screen.width;
    const h = this.deps.app.app.screen.height;
    const state = this.deps.bridge.getState();
    this.chooseTicketsScreen = new ChooseTicketsScreen(w, h, {
      api: this.api,
      roomCode: this.actualRoomCode,
      ticketPriceKr: state.entryFee || 10,
      onBack: () => {
        // Tilbake til Lobby uten kjøp.
        this.transitionTo("LOBBY", this.deps.bridge.getState());
      },
      onBuyComplete: () => {
        // Etter vellykket kjøp — naviger tilbake til Lobby. v2 vil koble
        // dette til faktisk bet:arm i BingoEngine.
        this.transitionTo("LOBBY", this.deps.bridge.getState());
      },
    });
    this.setScreen(this.chooseTicketsScreen);
  }

  private async handleClaim(type: "LINE" | "BINGO"): Promise<void> {
    console.log("[Game2] Submitting claim:", type);
    const result = await this.deps.socket.submitClaim({
      roomCode: this.actualRoomCode,
      type,
    });

    if (!result.ok) {
      console.error("[Game2] Claim failed:", result.error);
    }
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
    this.lobbyScreen = null;
    this.playScreen = null;
    this.endScreen = null;
  }

  private showError(message: string): void {
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

// Register in the game registry
registerGame("rocket", (deps) => new Game2Controller(deps));
registerGame("game_2", (deps) => new Game2Controller(deps));
