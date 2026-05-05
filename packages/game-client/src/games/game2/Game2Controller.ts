import { Container, Text } from "pixi.js";
import type { GameDeps, GameController } from "../registry.js";
import { registerGame } from "../registry.js";
import type { GameState } from "../../bridge/GameBridge.js";
import type { PatternWonPayload } from "@spillorama/shared-types/socket-events";
import { telemetry } from "../../telemetry/Telemetry.js";
import { LoadingOverlay } from "../../components/LoadingOverlay.js";
import { PlayScreen } from "./screens/PlayScreen.js";

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
  private playScreen: PlayScreen | null = null;
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
    // Tobias-direktiv 2026-05-03: ny Spillorama-branded Loading-overlay.
    const overlayContainer = app.app.canvas.parentElement ?? document.body;
    this.loader = new LoadingOverlay(overlayContainer);
    this.loader.setState("CONNECTING");

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
      // Tobias-direktiv 2026-05-03: connection-error fallback (klikk = reload).
      this.loader?.setError();
      this.showError("Kunne ikke koble til server");
      return;
    }
    console.log("[Game2] Socket connected");
    this.loader?.setState("JOINING_ROOM");

    // Track socket stability + Tobias-direktiv 2026-05-03: vis Loading-overlay
    // ved reconnect/disconnect så kunden aldri ser en frosset eller tom skjerm.
    //
    // Bug-fix 2026-05-04 (Bug B — reconnect-loop): "connected"-grenen er
    // kritisk. Server-side `detachSocket` setter kun `player.socketId =
    // undefined` ved disconnect; ny socket må eksplisitt re-attaches via
    // `room:resume` ellers kan server ikke route `io.to(roomCode).emit(...)`
    // til den nye socketen. Refresh fungerte tidligere fordi det utløser
    // `room:create`/`room:join` på nytt med ny socket.id. Nå håndteres det
    // automatisk uten refresh.
    //
    // Speiler `Game1ReconnectFlow.handleReconnect` (apps/game1/logic/
    // ReconnectFlow.ts:89) men inline her for å unngå cross-game-import
    // (Spill 2 har egen waitForSyncReady i denne klassen).
    this.unsubs.push(
      socket.on("connectionStateChanged", (state) => {
        if (state === "reconnecting") {
          telemetry.trackReconnect();
          this.loader?.setState("RECONNECTING");
        }
        if (state === "disconnected") {
          telemetry.trackDisconnect("socket");
          this.loader?.setState("DISCONNECTED");
        }
        if (state === "connected" && this.actualRoomCode) {
          // Re-attach + re-sync. Guarden mot tom `actualRoomCode` sikrer
          // at FØRSTE connect (før initial join har fullført) ikke trigger
          // resume — initial join-flyten håndterer state via createRoom-ack.
          void socket
            .resumeRoom({ roomCode: this.actualRoomCode })
            .then((res) => {
              if (res.ok && res.data?.snapshot) {
                bridge.applySnapshot(res.data.snapshot);
                this.loader?.hide();
              } else {
                console.warn(
                  "[Game2] resumeRoom failed after reconnect:",
                  res.error?.message ?? "no snapshot returned",
                );
              }
            })
            .catch((err) => {
              console.error("[Game2] resumeRoom threw after reconnect:", err);
            });
        }
      }),
    );

    // Join or create room
    console.log("[Game2] Joining room, hallId:", this.deps.hallId);
    const joinResult = await socket.createRoom({
      hallId: this.deps.hallId,
      gameSlug: "rocket",
    });

    if (!joinResult.ok || !joinResult.data) {
      console.error("[Game2] Room join failed — code:", joinResult.error?.code, "message:", joinResult.error?.message, "raw:", joinResult.error);
      // Tobias-direktiv 2026-05-03: room-join failure → connection-error fallback.
      this.loader?.setError();
      this.showError(joinResult.error?.message || "Kunne ikke joine rom");
      return;
    }

    this.myPlayerId = joinResult.data.playerId;
    this.actualRoomCode = joinResult.data.roomCode;
    console.log("[Game2] Joined room:", this.actualRoomCode, "playerId:", this.myPlayerId);

    // Bug-fix 2026-05-04 (drawNew gap-loop): applySnapshot MÅ kjøre FØR
    // bridge.start(). SpilloramaSocket bufferer broadcast-events (BIN-501)
    // mens kanalen har 0 lyttere; første on()-kall drainer bufferen synkront.
    // Hvis start() kjøres først drainer den buffered drawNew-events og
    // setter lastAppliedDrawIndex til siste buffered drawIndex. Deretter
    // overskriver applySnapshot bookkeeping bakover med snapshot.length-1
    // (som er ELDRE enn buffered events). Resultat: hver påfølgende
    // live drawNew detekteres som gap → infinite resync-loop.
    // Snu rekkefølgen: snapshot setter baseline FØRST, så start() drainer
    // og buffered events kastes som duplikater (drawIndex < expected) —
    // som er korrekt fordi snapshot allerede inneholder dem.
    bridge.applySnapshot(joinResult.data.snapshot);
    bridge.start(this.myPlayerId);

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

    // Tobias-direktiv 2026-05-04 (Spill 1-paritet): ALLE faser bruker
    // PlayScreen. PlayScreen sin interne `running ? myTickets :
    // preRoundTickets`-logikk håndterer korrekt visning per state:
    //   - LOBBY (mellom runder, !RUNNING): preRoundTickets vises (kjøpte
    //     bonger som venter på neste runde)
    //   - PLAYING/SPECTATING (RUNNING): myTickets vises (active markable)
    //   - ENDED (countdown til neste runde): preRoundTickets vises
    //
    // Tidligere brukte LOBBY en egen LobbyScreen (uten bong-grid) og
    // ENDED en egen EndScreen — det skjulte forhåndskjøpte bonger og
    // brøt Innsats/Gevinst-oppdatering. Nå er PlayScreen den eneste
    // skjermen for alle aktive game-faser, identisk med Spill 1.
    switch (phase) {
      case "LOBBY":
      case "PLAYING":
      case "SPECTATING":
      case "ENDED":
        this.playScreen = new PlayScreen(w, h, this.deps.audio, this.deps.socket, this.actualRoomCode);
        this.playScreen.setOnClaim((type) => this.handleClaim(type));
        this.playScreen.setOnLuckyNumber((n) => this.handleLuckyNumber(n));
        this.playScreen.setOnBuyForNextRound((count) => this.handleBuyForNextRound(count));
        this.playScreen.buildTickets(state);
        this.playScreen.updateInfo(state);
        this.setScreen(this.playScreen);
        // Tobias-direktiv 2026-05-05: mount HTML "Jackpot"/"Gain"-labels
        // over jackpot-ballene ETTER `setScreen` så `getGlobalPosition`
        // returnerer korrekte stage-koordinater. JackpotsRow-children er
        // i panel-layout men trenger global-pos for DOM-koord-beregning.
        this.playScreen.attachJackpotLabels(this.deps.app.app.canvas);
        break;
    }
  }

  // ── Bridge event handlers ─────────────────────────────────────────────

  private onStateChanged(state: GameState): void {
    // Tobias-direktiv 2026-05-04: alle faser bruker PlayScreen så bong-
    // grid + Innsats/Gevinst oppdateres uavhengig av om vi er i LOBBY,
    // PLAYING, SPECTATING eller ENDED. Spill 1-paritet.
    if (this.playScreen) {
      this.playScreen.updateInfo(state);
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
    // 2026-05-04 (Tobias-direktiv): rydd bong-display + animasjoner FØR
    // transition slik at gamle bonger fra forrige runde aldri henger igjen
    // mellom runder. transitionTo destroyer playScreen uansett, men
    // eksplisitt `reset()` her sikrer at GSAP-tweens (CenterBallPop, BongCard
    // mark-flip) stoppes umiddelbart i samme tick som game-end-eventet
    // ankommer — uten dette kunne en pågående mark-animasjon fortsette på
    // en stale BongCard mens EndScreen tonet inn.
    this.playScreen?.reset();

    if (this.phase === "PLAYING") {
      this.transitionTo("ENDED", state);
    } else {
      // SPECTATING eller LOBBY → LOBBY (ny runde kan kjøpes til)
      this.transitionTo("LOBBY", state);
    }

    // BIN-530/531 port: ingen auto-re-arm. Spilleren velger i BuyPopup.
  }

  private onNumberDrawn(number: number, drawIndex: number, state: GameState): void {
    if (this.playScreen) {
      this.playScreen.onNumberDrawn(number, drawIndex, state);
    }
  }

  private onPatternWon(result: PatternWonPayload, _state: GameState): void {
    if (this.playScreen) {
      this.playScreen.onPatternWon(result);
    }
    telemetry.trackEvent("pattern_won", {
      patternName: result.patternName,
      isMe: result.winnerId === this.myPlayerId,
      payoutAmount: result.payoutAmount,
    });
  }

  // ── User actions ──────────────────────────────────────────────────────

  /**
   * 2026-05-04 (Tobias-direktiv): bygg synthetic ticketSelections for Spill 2
   * så backend ikke clamper count ned til `ticketsPerPlayer`-default (4).
   *
   * Bakgrunn: BingoEngine.startGame har to paths:
   *   - Med selections → bruker count direkte (`hasSelections=true`)
   *   - Uten selections → `Math.min(count, ticketsPerPlayer)` clamp
   *
   * Spill 2 har én ticket-type ("Standard" / `game2-3x3`) per
   * `DEFAULT_GAME2_CONFIG`. Vi speiler PR #899's
   * `armRocketPlayerFromPool`-pattern her i frontend så count overlever
   * round-tripen til engine. Cap til 30 (samme som BuyPopup og backend
   * `bet:arm`-handler).
   */
  private buildSpill2Selections(count: number): Array<{ type: string; qty: number; name: string }> {
    const safeCount = Math.max(1, Math.min(30, Math.round(count)));
    return [{ type: "game2-3x3", qty: safeCount, name: "Standard" }];
  }

  private async handleBuy(count: number): Promise<void> {
    const selections = this.buildSpill2Selections(count);
    console.log("[Game2] Arming bet, roomCode:", this.actualRoomCode, "count:", selections[0].qty);
    const result = await this.deps.socket.armBet({
      roomCode: this.actualRoomCode,
      armed: true,
      ticketSelections: selections,
    });

    if (result.ok) {
      console.log("[Game2] Armed successfully");
      this.playScreen?.hideBuyPopupForNextRound();
    } else {
      console.error("[Game2] Arm failed:", result.error);
      this.showError(result.error?.message || "Kunne ikke kjøpe billetter");
    }
  }

  /**
   * Tobias-direktiv 2026-05-04: BuyPopup nå Game1BuyPopup (HTML-overlay)
   * som matcher Spill 3. Callback gir selections direkte i riktig shape
   * for `bet:arm` — ingen `buildSpill2Selections`-konvertering nødvendig.
   */
  private async handleBuyForNextRound(
    selections: Array<{ type: string; qty: number; name?: string }>,
  ): Promise<void> {
    if (selections.length === 0) return;
    console.log("[Game2] Arming bet for next round, selections:", selections);
    const result = await this.deps.socket.armBet({
      roomCode: this.actualRoomCode,
      armed: true,
      ticketSelections: selections,
    });

    if (result.ok) {
      console.log("[Game2] Armed successfully");
      this.playScreen?.hideBuyPopupForNextRound();
    } else {
      console.error("[Game2] Arm failed:", result.error);
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
    this.playScreen = null;
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
