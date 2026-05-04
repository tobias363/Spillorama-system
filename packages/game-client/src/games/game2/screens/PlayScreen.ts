/**
 * Spill 2 (Tallspill) — main gameplay screen for Bong Mockup v2-design.
 *
 * Layout (top → bottom) per `Bong Mockup.html` v2:
 *   1. BallTube:   countdown + draw-counter + drawn balls (12 visible)
 *   2. Bong-grid:  2×2 of BongCard (scaled 0.7 to fit)
 *   3. ComboPanel: PlayerCard + Hovedspill 1 + Lykketall + Jackpots
 *      — sticky-bottom (matcher CSS `.panel-row { margin-top: auto }`)
 *
 * STRICT element-cleanup per Tobias-direktiv 2026-05-03:
 *   "Det er da kun disse elementene samt popup av kjøp av biletter
 *    som skal være synlig"
 *
 * → FJERNET fra v1:
 *   - LINE/BINGO claim-knapper (ikke i mockup; auto-claim på Fullt Hus
 *     drives av backend per PR #855)
 *   - ChatPanel (ikke i mockup; chat var en lokal addition i v1)
 *
 * → BEHOLDT (eksplisitt fra Tobias):
 *   - BuyPopup (mellom-runde kjøp)
 *
 * Bakgrunn rendres som `bong-bg.png` Sprite via `Assets.load`.
 *
 * Funksjonelt uendret kontrakt mot `Game2Controller`:
 *   - `setOnClaim` BEVART (kalles fortsatt fra controller, men no-op
 *     siden knappene er fjernet — auto-claim håndterer alt)
 *   - `setOnLuckyNumber`, `setOnChooseTickets`, `setOnBuyForNextRound`
 *   - `buildTickets`, `updateInfo`, `onNumberDrawn`, `onPatternWon`,
 *     `updateJackpot`, `showBuyPopupForNextRound`, `hideBuyPopupForNextRound`,
 *     `isBuyPopupVisible`, `reset`
 *
 * 2026-05-03 (Agent S, branch feat/spill2-bong-mockup-v2): full layout-
 * rewrite for v2-design — tube først, bongs midt, combo-panel sticky-
 * bottom. STRICT cleanup av claim-knapper + chat-panel.
 */

import { Container, Graphics, Sprite, Assets, type Texture } from "pixi.js";
import type { GameState } from "../../../bridge/GameBridge.js";
import type { PatternWonPayload } from "@spillorama/shared-types/socket-events";
import type { AudioManager } from "../../../audio/AudioManager.js";
import type { SpilloramaSocket } from "../../../net/SpilloramaSocket.js";
import { BongCard } from "../components/BongCard.js";
import { BallTube } from "../components/BallTube.js";
import { CenterBallPop } from "../components/CenterBallPop.js";
import { ComboPanel } from "../components/ComboPanel.js";
import type { JackpotSlotData } from "../components/JackpotsRow.js";
import { BuyPopup } from "../components/BuyPopup.js";
import { LykketallPopup } from "../components/LykketallPopup.js";

const BG_URL = "/web/games/assets/game2/design/bong-bg.png";
const STAGE_PADDING_X = 32;
const STAGE_PADDING_TOP = 14;
const STAGE_PADDING_BOTTOM = 24;
const ROW_GAP = 14;
const MAX_STAGE_WIDTH = 1100;
/** Bong-grid scale matching `.grid-wrap > * { transform: scale(0.70) }`. */
const BONG_SCALE = 0.70;
const BONG_GAP_X = 20;
const BONG_GAP_Y = 8;
/** Tube-høyde må matche `BallTube` sin interne TUBE_HEIGHT for layout. */
const TUBE_HEIGHT = 85;

export class PlayScreen extends Container {
  private bgSprite: Sprite | null = null;
  private bgFallback: Graphics;
  private comboPanel: ComboPanel;
  private ballTube: BallTube;
  private bongs: BongCard[] = [];
  private bongGridContainer: Container;
  /**
   * 2026-05-04 (Agent LL, fix/spill2-ticket-render-and-ball-anim):
   * "just-drew"-pop-ball mid-screen. Speilet av Spill 1's CenterBall.
   * Triggres i `onNumberDrawn`; ligger over bong-grid med høy z-order
   * så den dekker bong-tallene mens den vises.
   */
  private centerBallPop: CenterBallPop;
  private buyPopup: BuyPopup;
  // 2026-05-03 (Agent Y): popup som åpnes ved klikk på Lykketall-kolonnen
  // i ComboPanel. Erstatter inline LykketallGrid i ComboPanel per
  // Tobias-direktiv ("velg lykketall skal være en popup").
  private lykketallPopup: LykketallPopup;
  /**
   * Sist kjent valgt lucky-number — speilet av `state.myLuckyNumber` slik at
   * popup-en kan vise "current selection" når den åpnes uten å re-loade
   * fra controller.
   */
  private currentLuckyNumber: number | null = null;
  private audio: AudioManager;
  private screenW: number;
  private screenH: number;
  private stageW: number;
  private stageX: number;
  // Claim-callback bevart for kontrakt med Game2Controller, men knappene
  // er fjernet i v2. Auto-claim på Fullt Hus drives av backend (PR #855).
  private onClaim: ((type: "LINE" | "BINGO") => void) | null = null;
  private onLuckyNumber: ((n: number) => void) | null = null;
  private onChooseTickets: (() => void) | null = null;
  private onBuyForNextRound: ((count: number) => void) | null = null;
  /** Siste kjente entryFee fra state — brukes av `openBuyPopupModal` så
   *  popup viser korrekt billettpris uavhengig av når brukeren klikker. */
  private currentEntryFee = 20;
  /**
   * Sist kjente gameStatus — brukes av `openBuyPopupModal` for å sette
   * riktig BuyPopup-tittel ("Forhåndskjøp – neste runde" mid-RUNNING vs.
   * "Neste spill" i LOBBY/WAITING). Speiler Spill 1's pattern hvor
   * pre-round-kjøp er eksplisitt merket som forhåndskjøp under aktiv
   * trekning så spilleren forstår at de IKKE deltar i pågående runde.
   * Default "NONE" — første state-update fra controller setter den
   * korrekt før noen popup-trigger.
   */
  private currentGameStatus: GameState["gameStatus"] = "NONE";
  /** Nedtellings-driver — vi oppdaterer hvert sekund fra
   *  `state.millisUntilNextStart` og decreases lokalt mellom snapshots. */
  private countdownDeadline: number | null = null;
  private countdownInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    screenWidth: number,
    screenHeight: number,
    audio: AudioManager,
    _socket?: SpilloramaSocket,
    _roomCode?: string,
  ) {
    super();
    this.audio = audio;
    this.screenW = screenWidth;
    this.screenH = screenHeight;

    // ── stage-bredde (uten chat, full bredde) ────────────────────────────
    // STRICT-cleanup per Tobias 2026-05-03: chat er fjernet fra v2-design.
    // socket/roomCode-args er bevart for kontrakt-kompatibilitet med
    // Game2Controller, men de brukes ikke lenger til å mounte ChatPanel.
    const availableW = screenWidth - STAGE_PADDING_X * 2;
    this.stageW = Math.min(MAX_STAGE_WIDTH, Math.max(640, availableW));
    this.stageX = STAGE_PADDING_X + Math.max(0, (availableW - this.stageW) / 2);

    // Fallback-bakgrunn (mørk-rød) frem til PNG laster.
    this.bgFallback = new Graphics();
    this.bgFallback.rect(0, 0, screenWidth, screenHeight).fill({ color: 0x2a0d0e });
    this.addChild(this.bgFallback);
    void this.loadBackground();

    // ── glass-tube (drawn balls + counter) — ØVERST i v2 ────────────────
    this.ballTube = new BallTube(this.stageW);
    this.ballTube.x = this.stageX;
    this.ballTube.y = STAGE_PADDING_TOP;
    this.addChild(this.ballTube);

    // ── bong-grid (2×2 BongCard) — MIDTEN ────────────────────────────────
    this.bongGridContainer = new Container();
    this.bongGridContainer.x = this.stageX;
    this.bongGridContainer.y = this.ballTube.y + TUBE_HEIGHT + ROW_GAP + 24;
    this.addChild(this.bongGridContainer);

    // ── center-ball-pop ("just-drew" overlay) ────────────────────────────
    // 2026-05-04 (Agent LL): mountes ETTER bongGridContainer så z-order
    // legger den OVER bong-grid (Pixi rendrer i child-array-rekkefølge).
    // Posisjonen settes til midten av bong-grid-området; pivot er på
    // ballens senter (satt i konstruktør) så ankret holder på re-pop.
    this.centerBallPop = new CenterBallPop();
    const popX = this.stageX + this.stageW / 2;
    // Plasser ~60px under tube så pop-ballen havner i en visuell "hot zone"
    // mellom tube og bong-grid (men over bongs).
    const popY = this.ballTube.y + TUBE_HEIGHT + 60;
    this.centerBallPop.x = popX;
    this.centerBallPop.y = popY;
    this.addChild(this.centerBallPop);

    // ── combo-panel — STICKY BOTTOM (matcher CSS margin-top: auto) ──────
    this.comboPanel = new ComboPanel(this.stageW);
    this.comboPanel.x = this.stageX;
    // Foreløpig posisjon — settes endelig i `positionComboPanelBottom`
    // etter at vi vet panel-høyden.
    this.comboPanel.y = screenHeight - STAGE_PADDING_BOTTOM - this.comboPanel.height;
    // setOnLuckyNumber er beholdt no-op for backward-compat; popup-flyt
    // tar over (klikk på Lykketall-kolonnen → popup → onLuckyNumber).
    this.comboPanel.setOnLuckyClick(() => this.lykketallPopup.show(this.currentLuckyNumber));
    // 2026-05-03 (Agent T, PR #873): "Kjøp flere brett"-pill åpner BuyPopup
    // som modal i stedet for å navigere til ChooseTicketsScreen.
    this.comboPanel.setOnBuyMore(() => this.openBuyPopupModal());
    this.addChild(this.comboPanel);

    // 2026-05-03 (Agent S, v2): mellom-runde buy-popup. Vises auto når
    // `state.millisUntilNextStart` <= 30 s mens forrige runde fortsatt
    // pågår (PLAYING/SPECTATING). Eksplisitt beholdt per Tobias-direktiv:
    // "kun disse elementene samt popup av kjøp av biletter".
    const popupW = 320;
    const popupH = 220;
    this.buyPopup = new BuyPopup(popupW, popupH);
    this.buyPopup.x = (screenWidth - popupW) / 2;
    this.buyPopup.y = (screenHeight - popupH) / 2;
    this.buyPopup.setOnBuy((count) => this.onBuyForNextRound?.(count));
    this.addChild(this.buyPopup);

    // 2026-05-03 (Agent Y): lykketall-popup. Klikk på Lykketall-kolonnen i
    // ComboPanel åpner denne; valg av nummer fyrer onLuckyNumber-callback
    // og auto-lukker popup-en. Mountes ETTER buyPopup så den havner over
    // i z-order ved samtidig synlighet (sjelden, men kan skje hvis bruker
    // klikker rett mens buyPopup fader inn).
    this.lykketallPopup = new LykketallPopup(screenWidth, screenHeight);
    this.lykketallPopup.setOnPick((n) => {
      this.currentLuckyNumber = n;
      this.comboPanel.setLuckyNumber(n);
      this.onLuckyNumber?.(n);
    });
    this.addChild(this.lykketallPopup);

    // Start lokal countdown-tikker (1Hz). Stoppes i `destroy`.
    this.countdownInterval = setInterval(() => this.tickCountdown(), 1000);
  }

  /**
   * Bevart for kontrakt-kompatibilitet med `Game2Controller`. Ingen UI-
   * elementer er knyttet til claim i v2 — auto-claim på Fullt Hus
   * håndteres av backend (PR #855).
   */
  setOnClaim(cb: (type: "LINE" | "BINGO") => void): void {
    this.onClaim = cb;
  }

  /** Sett callback for klikk i Lykketall-grid. */
  setOnLuckyNumber(cb: (n: number) => void): void {
    this.onLuckyNumber = cb;
  }

  /** Sett callback for "Kjøp flere brett"-pill. */
  setOnChooseTickets(cb: () => void): void {
    this.onChooseTickets = cb;
  }

  /**
   * Sett callback for mellom-runde buy-popup-kjøp. Kalles når spilleren
   * trykker "Kjøp" i popup-en — controller skal armBet for neste runde.
   */
  setOnBuyForNextRound(cb: (count: number) => void): void {
    this.onBuyForNextRound = cb;
  }

  /**
   * Vis mellom-runde buy-popup. Idempotent — gjør ingenting hvis allerede
   * synlig. Brukes av Game2Controller når countdown < 30 s og spilleren
   * ikke allerede har armed for neste runde.
   *
   * 2026-05-04 (Tobias-direktiv): bruker `currentGameStatus` til å sette
   * `forNextRound`-flagget på BuyPopup. Når gameStatus === "RUNNING" er
   * popup-tittelen "Forhåndskjøp – neste runde" så spilleren forstår at
   * trekningen IKKE er en del av kjøpet (mirror Spill 1).
   */
  showBuyPopupForNextRound(ticketPrice: number, maxTickets = 30): void {
    if (this.buyPopup.visible) return;
    const forNextRound = this.currentGameStatus === "RUNNING";
    this.buyPopup.show(ticketPrice, maxTickets, forNextRound);
  }

  /** Skjul mellom-runde buy-popup. Idempotent. */
  hideBuyPopupForNextRound(): void {
    if (!this.buyPopup.visible) return;
    this.buyPopup.hide();
  }

  /**
   * 2026-05-03 (Agent T, fix/spill2-pixel-match-design-v2): åpne
   * BuyPopup som modal overlay når brukeren klikker "Kjøp flere brett"
   * i Hovedspill-kolonnen i ComboPanel. Bruker siste kjente entryFee
   * fra `currentEntryFee` så popup viser korrekt billettpris.
   */
  private openBuyPopupModal(): void {
    this.showBuyPopupForNextRound(this.currentEntryFee);
  }

  /** Returner true hvis popup er synlig. Brukes av controller for trigger-gating. */
  isBuyPopupVisible(): boolean {
    return this.buyPopup.visible;
  }

  /** Bygg bong-kort fra game state. Erstatter forrige sett. */
  buildTickets(state: GameState): void {
    this.clearBongs();
    if (state.entryFee != null && state.entryFee > 0) {
      this.currentEntryFee = state.entryFee;
    }
    // 2026-05-04 (Tobias-direktiv): cache gameStatus for BuyPopup-tittel-
    // valg + RUNNING-aware ticket-display. Speiler Spill 1's pattern.
    this.currentGameStatus = state.gameStatus;
    this.comboPanel.setCurrentDrawCount(state.drawnNumbers.length);
    this.comboPanel.setPlayerCount(state.playerCount ?? 0);

    // 2026-05-04 (Tobias-direktiv: speiler Spill 1's runde-syklus): velg
    // ticket-sett basert på gameStatus så bongs ALDRI henger fra forrige
    // runde mellom rounds.
    //
    //   - RUNNING + myTickets > 0   → vis myTickets (aktive, markable)
    //   - RUNNING + ingen myTickets → vis preRoundTickets (SPECTATING-
    //     preview for sen-joiner som har armed for neste runde)
    //   - non-RUNNING (LOBBY/WAITING/ENDED/NONE) → vis preRoundTickets
    //     KUN (forrige rundes myTickets er stale og må ikke rendres)
    //
    // Speiler Spill 1's `running ? myTickets : preRoundTickets`-logikk
    // (packages/game-client/src/games/game1/screens/PlayScreen.ts:433-436).
    // Tidligere fallback `myTickets > 0 ? myTickets : preRoundTickets` lot
    // myTickets vises også etter at runden var ENDED → bonger hang igjen
    // mellom runder fordi `game.tickets[playerId]` ikke clearer på
    // ENDED-snapshot (kun ved gameStarted med ny gameId).
    const running = state.gameStatus === "RUNNING";
    const activeTickets = running
      ? (state.myTickets.length > 0 ? state.myTickets : (state.preRoundTickets ?? []))
      : (state.preRoundTickets ?? []);
    const isPreRoundPreview =
      !running || (running && state.myTickets.length === 0 && activeTickets.length > 0);

    for (let i = 0; i < activeTickets.length; i++) {
      const ticket = activeTickets[i];
      const card = new BongCard({
        colorKey: "yellow", // Spill 2 har kun én ticket-type per PR #856.
        label: ticket.color ?? `Brett ${i + 1}`,
        price: ticket.price ?? state.entryFee ?? 20,
      });
      // Hvis det er pre-round preview, send tom marks-array. Aktive tickets
      // restorer marks fra snapshot eller bruker `state.drawnNumbers` som
      // late-joiner-fallback (gammel oppførsel bevart).
      const initialMarks = isPreRoundPreview
        ? []
        : (state.myMarks[i] ?? state.drawnNumbers);
      card.loadTicket(ticket, initialMarks);
      // Tobias-direktiv 2026-05-04 (Bug 2 — fix/spill2-bug2-bug3): merk
      // pre-round-bongen visuelt så den ikke forveksles med aktive bonger
      // i pågående runde. `isPreRoundPreview` er true når vi viser
      // preRoundTickets i stedet for live myTickets.
      if (isPreRoundPreview) {
        card.setPreRound(true);
      }
      this.bongs.push(card);
      this.bongGridContainer.addChild(card);
    }

    // Last lucky-number til Lykketall-grid (for late-joiner).
    this.currentLuckyNumber = state.myLuckyNumber ?? null;
    this.comboPanel.setLuckyNumber(this.currentLuckyNumber);

    // Last alle drawn-balls inn i tuben (snapshot-restore).
    this.ballTube.loadBalls(state.drawnNumbers);
    this.ballTube.setDrawCount(state.drawnNumbers.length, state.totalDrawCapacity);
    this.startCountdown(state.millisUntilNextStart);

    this.layoutBongGrid();
  }

  /** Håndter ny trukket ball (fra `numberDrawn`-event). */
  onNumberDrawn(number: number, _drawIndex: number, state: GameState): void {
    // 2026-05-04 (Agent LL): "just-drew"-pop FØRST så animasjonen
    // starter samtidig med tube-insert. Speilet av Spill 1's
    // PlayScreen.onNumberDrawn (centerBall.showNumber + ballTube.addBall
    // i samme tick).
    this.centerBallPop.pop(number);
    for (const card of this.bongs) {
      card.markNumber(number);
    }
    this.ballTube.addBall(number);
    this.ballTube.setDrawCount(state.drawnNumbers.length, state.totalDrawCapacity);
    this.comboPanel.setCurrentDrawCount(state.drawnNumbers.length);
    this.audio.playNumber(number);
    this.startCountdown(state.millisUntilNextStart);
  }

  /** Oppdater jackpot-prizer fra socket-event. */
  updateJackpot(list: JackpotSlotData[]): void {
    this.comboPanel.updateJackpots(list);
  }

  /**
   * Pattern won broadcast — kalles fra controller. v2 har ingen
   * claim-knapper å resette; metoden beholdes som no-op for
   * kontrakt-kompatibilitet og logging-formål.
   */
  onPatternWon(_payload: PatternWonPayload): void {
    // No-op i v2 — auto-claim på Fullt Hus håndteres av backend.
  }

  /** State-oppdatering (player count, prize pool osv.). */
  updateInfo(state: GameState): void {
    if (state.myLuckyNumber != null) {
      this.currentLuckyNumber = state.myLuckyNumber;
      this.comboPanel.setLuckyNumber(state.myLuckyNumber);
    }
    if (state.entryFee != null && state.entryFee > 0) {
      this.currentEntryFee = state.entryFee;
    }
    // 2026-05-04 (Tobias-direktiv): hold `currentGameStatus` synkronisert
    // mellom snapshot-tikker. Brukes av `openBuyPopupModal` for å sette
    // riktig BuyPopup-tittel.
    this.currentGameStatus = state.gameStatus;
    // 2026-05-04 (Bug 2): "Kjøp flere brett"-pill skal vise
    // "Forhåndskjøp neste runde" mid-RUNNING så spilleren forstår at
    // pågående trekning IKKE er en del av kjøpet. Speiler BuyPopup
    // sin phase-aware tittel-logikk (PR #903).
    this.comboPanel.setBuyMoreLabel(
      state.gameStatus === "RUNNING" ? "Forhåndskjøp neste runde" : "Kjøp flere brett",
    );
    this.comboPanel.setPlayerCount(state.playerCount ?? 0);
    this.ballTube.setDrawCount(state.drawnNumbers.length, state.totalDrawCapacity);
    this.startCountdown(state.millisUntilNextStart);

    // Late-joiner / mid-round arm: bygg på nytt hvis antall bonger som
    // SKAL vises har endret seg siden forrige render. Logikken matcher
    // buildTickets sin RUNNING-aware valg-strategi (Tobias-direktiv
    // 2026-05-04): under RUNNING bruker vi myTickets med fallback til
    // preRoundTickets; utenfor RUNNING bruker vi KUN preRoundTickets så
    // forrige rundes myTickets ikke henger igjen mellom runder.
    const running = state.gameStatus === "RUNNING";
    const expectedTickets = running
      ? (state.myTickets.length > 0 ? state.myTickets.length : (state.preRoundTickets?.length ?? 0))
      : (state.preRoundTickets?.length ?? 0);
    if (expectedTickets !== this.bongs.length) {
      this.buildTickets(state);
      return;
    }

    // 2026-05-04 (Bug 3 — fix/spill2-bug2-bug3): re-sync marks fra
    // server-authoritative `state.myMarks` til eksisterende bonger.
    // Tidligere oppdaterte vi marks KUN inkrementelt via
    // `onNumberDrawn(number)` per ball-trekning, men hvis et `draw:new`-
    // event ble misset (gap → resync → applySnapshot), oppdaterte
    // bridge `state.myMarks` ferskt mens bongene fortsatte med stale
    // mark-state. Resultat: enkelte celler som matchet trukne baller
    // fikk ALDRI markert fordi `markNumber(n)` aldri ble kjørt for dem.
    //
    // Server-side er Game2Engine.onDrawCompleted nå kalt korrekt etter
    // PR #906 og `autoMarkPlayerCells` populerer `game.marks` autoritativt.
    // Vi gjør state-en til sannhetskilden i hver `updateInfo`-tikk —
    // BongCard.markNumbers er idempotent (Set-add), så dobbeltmarkering
    // er trygt og koster bare en re-tegne-pass uten visuell forskjell
    // for celler som allerede er markert.
    //
    // Pre-round-preview-rendering (SPECTATING / non-RUNNING med kun
    // preRoundTickets) skal IKKE re-merkes — disse bongene tilhører neste
    // runde og forrige rundes drawnNumbers gjelder ikke for dem. Match
    // buildTickets sin `isPreRoundPreview`-beregning for konsistens.
    const isPreRoundPreview =
      !running || (running && state.myTickets.length === 0);
    if (!isPreRoundPreview) {
      for (let i = 0; i < this.bongs.length; i++) {
        const ticketMarks = state.myMarks[i];
        if (ticketMarks && ticketMarks.length > 0) {
          this.bongs[i].markNumbers(ticketMarks);
        }
      }
    }
  }

  /** Reset for next game. */
  reset(): void {
    this.clearBongs();
    this.ballTube.clear();
    // 2026-05-04 (Agent LL): drop pågående pop-animasjon — ny runde
    // skal ikke vise siste trekning fra forrige.
    this.centerBallPop.reset();
    this.countdownDeadline = null;
    this.ballTube.setCountdown(null);
  }

  destroy(options?: Parameters<Container["destroy"]>[0]): void {
    if (this.countdownInterval !== null) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
    this.clearBongs();
    super.destroy(options);
  }

  // ── interne ─────────────────────────────────────────────────────────────

  private clearBongs(): void {
    for (const card of this.bongs) {
      card.stopAllAnimations();
      card.destroy();
    }
    this.bongs = [];
    this.bongGridContainer.removeChildren();
  }

  /**
   * Layout 4 (eller flere) BongCards i et 2-kolonne-grid med scale 0.70,
   * matching `.grid-wrap` fra HTML-mockupen. Kortene rendres i naturlig
   * størrelse og bruker `scale.set(0.70)` så posisjoneringen blir
   * forutsigbar.
   */
  private layoutBongGrid(): void {
    if (this.bongs.length === 0) return;
    // Kort-bredde og høyde i naturlig størrelse (vi spør første kort).
    const naturalW = this.bongs[0].cardWidth;
    const naturalH = this.bongs[0].cardHeight;
    const scaledW = naturalW * BONG_SCALE;
    const scaledH = naturalH * BONG_SCALE;
    const cols = 2;
    const rowW = cols * scaledW + (cols - 1) * BONG_GAP_X;
    const startX = Math.max(0, (this.stageW - rowW) / 2);

    for (let i = 0; i < this.bongs.length; i++) {
      const card = this.bongs[i];
      card.scale.set(BONG_SCALE);
      const col = i % cols;
      const row = Math.floor(i / cols);
      card.x = startX + col * (scaledW + BONG_GAP_X);
      card.y = row * (scaledH + BONG_GAP_Y);
    }
  }

  /**
   * Sett ny countdown-deadline. Tikker ned hvert sekund via `tickCountdown`.
   * `null`/0 viser "—:—".
   */
  private startCountdown(milliseconds: number | null): void {
    if (milliseconds == null || milliseconds <= 0) {
      this.countdownDeadline = null;
      this.ballTube.setCountdown(null);
      return;
    }
    this.countdownDeadline = Date.now() + milliseconds;
    this.ballTube.setCountdown(milliseconds);
  }

  private tickCountdown(): void {
    if (this.countdownDeadline == null) return;
    const remaining = this.countdownDeadline - Date.now();
    if (remaining <= 0) {
      this.countdownDeadline = null;
      this.ballTube.setCountdown(null);
      return;
    }
    this.ballTube.setCountdown(remaining);
  }

  private async loadBackground(): Promise<void> {
    try {
      const tex = (await Assets.load(BG_URL)) as Texture;
      if (this.destroyed) return;
      const sprite = new Sprite(tex);
      sprite.width = this.screenW;
      sprite.height = this.screenH;
      this.bgSprite = sprite;
      this.addChildAt(sprite, 1); // over fallback, under panels
    } catch {
      // Asset mangler — vi beholder fallback-fargen.
    }
  }
}
