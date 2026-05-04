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

import { Container, Graphics, Rectangle, Sprite, Assets, type Texture } from "pixi.js";
import type { GameState } from "../../../bridge/GameBridge.js";
import type { PatternWonPayload } from "@spillorama/shared-types/socket-events";
import { calculateMyRoundWinnings } from "../../game1/logic/WinningsCalculator.js";
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
/** Tobias-direktiv 2026-05-04: 7×3 bong-grid (matcher screenshot-mockup).
 *  Skala krympet fra 0.70 → 0.55 for å få plass til 7 kolonner over stage-W. */
const BONG_SCALE = 0.55;
const BONG_GAP_X = 10;
const BONG_GAP_Y = 8;
const BONG_COLS = 7;
/** Tube-høyde må matche `BallTube` sin interne TUBE_HEIGHT for layout. */
const TUBE_HEIGHT = 85;

export class PlayScreen extends Container {
  private bgSprite: Sprite | null = null;
  private bgFallback: Graphics;
  private comboPanel: ComboPanel;
  private ballTube: BallTube;
  private bongs: BongCard[] = [];
  private bongGridContainer: Container;
  /** Scroll-viewport som maskerer bong-griden + tar imot wheel-events. */
  private bongScrollViewport: Container;
  /** Pixi-mask som klipper bonger som scroller utenfor viewport. */
  private bongScrollMask: Graphics;
  /** Total høyde av bong-grid (alle rader); brukes til scroll-clamp. */
  private bongGridContentHeight = 0;
  /** Maksimum scroll (positiv y-offset i bongGridContainer). */
  private bongScrollMaxY = 0;
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

    // ── bong-grid (7×3+ BongCard) — MIDTEN, MED SCROLL ──────────────────
    // Tobias-direktiv 2026-05-04 (Spill 1-paritet): 7-kolonne grid med
    // vertikal scroll når antall bonger overstiger 3 rader (21). Bruker
    // Pixi-mask for clip + wheel-handler for scroll.
    //
    // Layout-hierarki:
    //   bongScrollViewport (mask + wheel hit-area)
    //   └─ bongGridContainer (innehavende, mask'et)
    //      └─ BongCard children (lagt ut i 7-kol grid)
    this.bongScrollViewport = new Container();
    this.bongScrollViewport.x = this.stageX;
    this.bongScrollViewport.y = this.ballTube.y + TUBE_HEIGHT + ROW_GAP + 16;
    // Initial mask: dekker hele forventet bong-område. Refines via
    // `refreshScrollMask` etter at comboPanel er konstruert (vi vet da
    // viewport-bunn). Initial estimate: skjerm-høyde minus ~250 (tube +
    // panel-area) — godt nok så mask ikke clipper unødig før refine.
    this.bongScrollMask = new Graphics();
    this.bongScrollMask
      .rect(0, 0, this.stageW, Math.max(200, screenHeight - 250))
      .fill({ color: 0xffffff, alpha: 1 });
    this.bongScrollViewport.addChild(this.bongScrollMask);
    this.bongGridContainer = new Container();
    this.bongGridContainer.mask = this.bongScrollMask;
    this.bongScrollViewport.addChild(this.bongGridContainer);
    // Wheel-handler + hitArea så viewporten fanger wheel-events selv om
    // bong-griden er tom. Pixi 8 router wheel-events til target via
    // FederatedEvents når `eventMode = "static"` er satt.
    this.bongScrollViewport.eventMode = "static";
    this.bongScrollViewport.hitArea = new Rectangle(
      0,
      0,
      this.stageW,
      Math.max(200, screenHeight - 250),
    );
    this.bongScrollViewport.on("wheel", (event) => {
      const e = event as unknown as { deltaY?: number; preventDefault?: () => void };
      if (typeof e.deltaY !== "number") return;
      e.preventDefault?.();
      this.applyScroll(e.deltaY);
    });
    this.addChild(this.bongScrollViewport);

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

    // Tobias-direktiv 2026-05-04 (forhåndskjøp-paritet med Spill 1):
    // forhåndskjøpte bonger skal IKKE vises under aktiv RUNNING-runde,
    // KUN når runden er avsluttet og nedtelling til ny runde starter.
    //
    //   - RUNNING → vis kun `myTickets` (kjøpt for pågående runde).
    //              `preRoundTickets` (mid-round forhåndskjøp for NESTE
    //              runde) skjules helt — vises først når runden ender.
    //   - non-RUNNING (LOBBY/WAITING/ENDED/NONE) → vis preRoundTickets
    //              som er klare for neste runde.
    //
    // Match Spill 1's `running ? myTickets : preRoundTickets`-logikk
    // (packages/game-client/src/games/game1/screens/PlayScreen.ts:433-436).
    // Tidligere fallback `myTickets > 0 ? myTickets : preRoundTickets`
    // viste forhåndskjøp som "SPECTATING-preview" mid-RUNNING — fjernet
    // per Tobias-direktiv 2026-05-04.
    const running = state.gameStatus === "RUNNING";
    const activeTickets = running
      ? state.myTickets
      : (state.preRoundTickets ?? []);
    const isPreRoundPreview = !running && activeTickets.length > 0;

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
    // Tobias-direktiv 2026-05-04: skjul "Neste trekning" under RUNNING.
    this.ballTube.setRunning(state.gameStatus === "RUNNING");
    this.startCountdown(state.millisUntilNextStart);

    this.layoutBongGrid();
  }

  /** Håndter ny trukket ball (fra `numberDrawn`-event). */
  onNumberDrawn(number: number, _drawIndex: number, state: GameState): void {
    // Tobias-direktiv 2026-05-04: FJERNET CenterBallPop-trigger. Ny ball
    // skal IKKE vises stor i midten — den plasseres direkte i venstre
    // slot i glass-tuben, andre baller skifter høyre, eldste evicter
    // til høyre. Speilet av Spill 1 sin BallTube.addBall-flyt.
    for (const card of this.bongs) {
      card.markNumber(number);
    }
    this.ballTube.addBall(number);
    this.ballTube.setDrawCount(state.drawnNumbers.length, state.totalDrawCapacity);
    this.ballTube.setRunning(state.gameStatus === "RUNNING");
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
    // Tobias-direktiv 2026-05-04 (PlayerCard Innsats/Gevinst-paritet med
    // Spill 1): vis aktiv stake + akkumulert vinning på PlayerCard.
    // Begge skjules når verdien er 0 (samme regler som LeftInfoPanel).
    const myWinnings = calculateMyRoundWinnings(state.patternResults, state.myPlayerId);
    this.comboPanel.setPlayerStake(state.myStake ?? 0);
    this.comboPanel.setPlayerWinnings(myWinnings);
    this.ballTube.setDrawCount(state.drawnNumbers.length, state.totalDrawCapacity);
    // Tobias-direktiv 2026-05-04: hold BallTube-state synkronisert mellom
    // tikker så countdown-raden vises/skjules riktig på hver state-update.
    this.ballTube.setRunning(state.gameStatus === "RUNNING");
    this.startCountdown(state.millisUntilNextStart);

    // Late-joiner / mid-round arm: bygg på nytt hvis antall bonger som
    // SKAL vises har endret seg siden forrige render. Logikken matcher
    // buildTickets sin RUNNING-aware valg-strategi (Tobias-direktiv
    // 2026-05-04, forhåndskjøp-paritet med Spill 1): under RUNNING viser
    // vi KUN myTickets; utenfor RUNNING viser vi preRoundTickets.
    const running = state.gameStatus === "RUNNING";
    const expectedTickets = running
      ? state.myTickets.length
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
    // Pre-round-preview-rendering (non-RUNNING med preRoundTickets) skal
    // IKKE re-merkes — disse bongene tilhører neste runde og forrige
    // rundes drawnNumbers gjelder ikke for dem. Match buildTickets sin
    // `isPreRoundPreview`-beregning for konsistens.
    const isPreRoundPreview = !running;
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
   * Tobias-direktiv 2026-05-04: 7-kolonne grid med vertikal scroll når
   * antall bonger > 21. Speilet av Spill 1's TicketGridHtml-layout.
   * Beregner viewport-høyde basert på combo-panel-Y så scrollingen
   * stopper ved combo-panelet.
   */
  private layoutBongGrid(): void {
    if (this.bongs.length === 0) {
      this.bongGridContentHeight = 0;
      this.bongScrollMaxY = 0;
      this.bongGridContainer.y = 0;
      this.refreshScrollMask();
      return;
    }
    const naturalW = this.bongs[0].cardWidth;
    const naturalH = this.bongs[0].cardHeight;
    const scaledW = naturalW * BONG_SCALE;
    const scaledH = naturalH * BONG_SCALE;
    const cols = BONG_COLS;
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

    // Beregn total content-høyde + scroll-max.
    const rows = Math.ceil(this.bongs.length / cols);
    this.bongGridContentHeight = rows * scaledH + (rows - 1) * BONG_GAP_Y;
    const viewportH = this.computeBongViewportHeight();
    this.bongScrollMaxY = Math.max(0, this.bongGridContentHeight - viewportH);
    // Reset scroll til topp når nytt bong-sett bygges.
    this.bongGridContainer.y = 0;
    this.refreshScrollMask();
  }

  /**
   * Tilgjengelig høyde for bong-griden = mellomrom mellom tube-bunn og
   * combo-panel-topp. Brukt til scroll-clamp.
   */
  private computeBongViewportHeight(): number {
    const tubeBottom = this.ballTube.y + TUBE_HEIGHT;
    const comboTop = this.comboPanel.y;
    return Math.max(0, comboTop - this.bongScrollViewport.y - ROW_GAP);
  }

  /** Re-tegn mask-rektangelet + oppdater hitArea til viewport-dimensjoner. */
  private refreshScrollMask(): void {
    const w = this.stageW;
    const h = this.computeBongViewportHeight();
    this.bongScrollMask.clear();
    this.bongScrollMask.rect(0, 0, w, h).fill({ color: 0xffffff, alpha: 1 });
    // hitArea må matche mask-rektangelet så wheel-events ikke fanges
    // utenfor synlig viewport (f.eks. der combo-panelet er).
    this.bongScrollViewport.hitArea = new Rectangle(0, 0, w, h);
  }

  /** Scroll bong-grid med deltaY (px). Clampes mellom 0 og bongScrollMaxY. */
  private applyScroll(deltaY: number): void {
    if (this.bongScrollMaxY <= 0) return;
    const next = -this.bongGridContainer.y + deltaY;
    const clamped = Math.max(0, Math.min(this.bongScrollMaxY, next));
    this.bongGridContainer.y = -clamped;
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
