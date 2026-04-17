import { Container, Text } from "pixi.js";
import type { GameDeps, GameController } from "../registry.js";
import { registerGame } from "../registry.js";
import type { GameState } from "../../bridge/GameBridge.js";
import type { PatternWonPayload } from "@spillorama/shared-types/socket-events";
import { telemetry } from "../../telemetry/Telemetry.js";
import { LoadingOverlay } from "../../components/LoadingOverlay.js";
import { LobbyScreen } from "../game2/screens/LobbyScreen.js";
import { PlayScreen } from "./screens/PlayScreen.js";
import { EndScreen } from "../game2/screens/EndScreen.js";

/** BIN-507 port: SPECTATING lagt til for late-joiner midt i runde. */
type Phase = "LOADING" | "LOBBY" | "PLAYING" | "SPECTATING" | "ENDED";

/**
 * Game 3 (Monster Bingo / Mønsterbingo) controller.
 * Uses 5x5 grids like Game 1. Unique ball animation deferred to visual polish phase.
 * Reuses Game 1 PlayScreen (5x5 + chat) and Game 2 LobbyScreen/EndScreen.
 */
class Game3Controller implements GameController {
  private deps: GameDeps;
  private root: Container;
  private phase: Phase = "LOADING";
  private currentScreen: Container | null = null;
  private lobbyScreen: LobbyScreen | null = null;
  private playScreen: PlayScreen | null = null;
  private endScreen: EndScreen | null = null;
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

    // BIN-500 port
    const overlayContainer = app.app.canvas.parentElement ?? document.body;
    this.loader = new LoadingOverlay(overlayContainer);
    this.loader.show("Kobler til...");

    console.log("[Game3] Connecting socket...");
    socket.connect();

    const connected = await new Promise<boolean>((resolve) => {
      if (socket.isConnected()) { resolve(true); return; }
      const timeout = setTimeout(() => { resolve(false); }, 10000);
      const unsub = socket.on("connectionStateChanged", (state) => {
        if (state === "connected") { unsub(); clearTimeout(timeout); resolve(true); }
      });
    });

    if (!connected) { this.loader?.hide(); this.showError("Kunne ikke koble til server"); return; }
    console.log("[Game3] Socket connected");
    this.loader?.show("Joiner rom...");

    this.unsubs.push(
      socket.on("connectionStateChanged", (state) => {
        if (state === "reconnecting") telemetry.trackReconnect();
        if (state === "disconnected") telemetry.trackDisconnect("socket");
      }),
    );

    console.log("[Game3] Joining room, hallId:", this.deps.hallId);
    const joinResult = await socket.createRoom({
      hallId: this.deps.hallId,
      gameSlug: "monsterbingo",
    });

    if (!joinResult.ok || !joinResult.data) {
      console.error("[Game3] Room join failed:", joinResult.error);
      this.loader?.hide();
      this.showError(joinResult.error?.message || "Kunne ikke joine rom");
      return;
    }

    this.myPlayerId = joinResult.data.playerId;
    this.actualRoomCode = joinResult.data.roomCode;
    console.log("[Game3] Joined room:", this.actualRoomCode);

    bridge.start(this.myPlayerId);
    bridge.applySnapshot(joinResult.data.snapshot);

    this.unsubs.push(
      bridge.on("stateChanged", (s) => this.onStateChanged(s)),
      bridge.on("gameStarted", (s) => this.onGameStarted(s)),
      bridge.on("gameEnded", (s) => this.onGameEnded(s)),
      bridge.on("numberDrawn", (n, i, s) => this.onNumberDrawn(n, i, s)),
      bridge.on("patternWon", (r, s) => this.onPatternWon(r, s)),
    );

    this.root.eventMode = "static";
    this.root.on("pointerdown", () => this.deps.audio.unlock(), { once: true });

    // BIN-530 port: ingen auto-arm. Eksplisitt kjøp via BuyPopup.
    // BIN-500 port: loader-barriere før transition
    await this.waitForSyncReady();
    this.loader?.hide();

    const state = bridge.getState();
    if (state.gameStatus === "RUNNING") {
      // BIN-507 port: late-joiner uten tickets → SPECTATING
      if (state.myTickets.length > 0) {
        this.transitionTo("PLAYING", state);
      } else {
        this.transitionTo("SPECTATING", state);
      }
    } else {
      this.transitionTo("LOBBY", state);
    }
  }

  /** BIN-500 port: samme som G1/G2. */
  private async waitForSyncReady(): Promise<void> {
    const { bridge } = this.deps;
    const syncStartedAt = Date.now();
    const SYNC_TIMEOUT_MS = 5000;
    const state = bridge.getState();
    const isRunningAtEntry = state.gameStatus === "RUNNING";

    if (!isRunningAtEntry) {
      telemetry.trackEvent("late_join_sync", {
        game: "game3", syncGapMs: Date.now() - syncStartedAt, gotLiveEvent: false, skipped: "not-running",
      });
      return;
    }

    this.loader?.show("Syncer...");
    const gotLiveEvent = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), SYNC_TIMEOUT_MS);
      const unsubDraw = bridge.on("numberDrawn", () => { clearTimeout(timer); unsubDraw(); unsubState(); resolve(true); });
      const unsubState = bridge.on("stateChanged", (s) => {
        if (s.drawnNumbers.length > state.drawnNumbers.length) {
          clearTimeout(timer); unsubDraw(); unsubState(); resolve(true);
        }
      });
    });

    const syncGap = Date.now() - syncStartedAt;
    telemetry.trackEvent("late_join_sync", { game: "game3", syncGapMs: syncGap, gotLiveEvent });
    if (!gotLiveEvent) console.warn(`[Game3] sync-timeout etter ${syncGap}ms`);
  }

  destroy(): void {
    for (const unsub of this.unsubs) unsub();
    this.unsubs = [];
    this.loader?.destroy();
    this.loader = null;
    this.clearScreen();
    this.root.destroy({ children: true });
  }

  private transitionTo(phase: Phase, state: GameState): void {
    console.log("[Game3] Transition:", this.phase, "→", phase);
    this.phase = phase;
    this.clearScreen();
    const w = this.deps.app.app.screen.width;
    const h = this.deps.app.app.screen.height;

    switch (phase) {
      case "LOBBY":
        this.lobbyScreen = new LobbyScreen(w, h);
        this.lobbyScreen.setOnBuy(() => this.handleBuy());
        this.lobbyScreen.setOnLuckyNumber((n) => this.handleLuckyNumber(n));
        this.lobbyScreen.update(state);
        this.lobbyScreen.showBuyPopup(state.entryFee || 10);
        this.setScreen(this.lobbyScreen);
        break;
      case "PLAYING":
        this.playScreen = new PlayScreen(w, h, this.deps.audio, this.deps.socket, this.actualRoomCode);
        this.playScreen.setOnClaim((type) => this.handleClaim(type));
        this.playScreen.subscribeChatToBridge((listener) => this.deps.bridge.on("chatMessage", listener));
        this.playScreen.buildTickets(state);
        this.playScreen.updateInfo(state);
        this.setScreen(this.playScreen);
        break;
      case "SPECTATING":
        // BIN-507 port: samme render som PLAYING men uten tickets.
        // Server-guards blokkerer mark/claim fra spectators.
        this.playScreen = new PlayScreen(w, h, this.deps.audio, this.deps.socket, this.actualRoomCode);
        this.playScreen.setOnClaim((type) => this.handleClaim(type));
        this.playScreen.subscribeChatToBridge((listener) => this.deps.bridge.on("chatMessage", listener));
        this.playScreen.buildTickets(state);
        this.playScreen.updateInfo(state);
        this.setScreen(this.playScreen);
        break;
      case "ENDED":
        this.endScreen = new EndScreen(w, h);
        this.endScreen.setOnDismiss(() => this.transitionTo("LOBBY", this.deps.bridge.getState()));
        this.endScreen.show(state);
        this.setScreen(this.endScreen);
        break;
    }
  }

  private onStateChanged(state: GameState): void {
    if (this.phase === "LOBBY" && this.lobbyScreen) this.lobbyScreen.update(state);
    if ((this.phase === "PLAYING" || this.phase === "SPECTATING") && this.playScreen) this.playScreen.updateInfo(state);
  }

  private onGameStarted(state: GameState): void {
    if (state.myTickets.length > 0) {
      this.transitionTo("PLAYING", state);
    } else {
      // BIN-507 port: runde starter uten billetter → SPECTATING
      this.transitionTo("SPECTATING", state);
    }
  }

  private onGameEnded(state: GameState): void {
    if (this.phase === "PLAYING") this.transitionTo("ENDED", state);
    else this.transitionTo("LOBBY", state);
    // BIN-530 port: ingen auto-re-arm. Spilleren velger i BuyPopup.
  }

  private onNumberDrawn(number: number, drawIndex: number, state: GameState): void {
    if ((this.phase === "PLAYING" || this.phase === "SPECTATING") && this.playScreen) {
      this.playScreen.onNumberDrawn(number, drawIndex, state);
    }
  }

  private onPatternWon(result: PatternWonPayload, state: GameState): void {
    if (this.phase === "PLAYING" && this.playScreen) {
      this.playScreen.onPatternWon(result);
      this.playScreen.refreshPatternBanner(state);
    }
    telemetry.trackEvent("pattern_won", { patternName: result.patternName, isMe: result.winnerId === this.myPlayerId });
  }

  private async handleBuy(): Promise<void> {
    const result = await this.deps.socket.armBet({ roomCode: this.actualRoomCode, armed: true });
    if (result.ok) this.lobbyScreen?.hideBuyPopup();
    else this.showError(result.error?.message || "Feil ved billettkjøp");
  }

  private async handleLuckyNumber(n: number): Promise<void> {
    await this.deps.socket.setLuckyNumber({ roomCode: this.actualRoomCode, luckyNumber: n });
  }

  private async handleClaim(type: "LINE" | "BINGO"): Promise<void> {
    await this.deps.socket.submitClaim({ roomCode: this.actualRoomCode, type });
  }

  private setScreen(screen: Container): void { this.currentScreen = screen; this.root.addChild(screen); }

  private clearScreen(): void {
    if (this.currentScreen) { this.currentScreen.destroy({ children: true }); this.currentScreen = null; }
    this.lobbyScreen = null; this.playScreen = null; this.endScreen = null;
  }

  private showError(message: string): void {
    const t = new Text({ text: message, style: { fontFamily: "Arial", fontSize: 24, fill: 0xff4444 } });
    t.anchor.set(0.5); t.x = this.deps.app.app.screen.width / 2; t.y = this.deps.app.app.screen.height / 2;
    this.root.addChild(t);
  }
}

registerGame("monsterbingo", (deps) => new Game3Controller(deps));
registerGame("game_3", (deps) => new Game3Controller(deps));
