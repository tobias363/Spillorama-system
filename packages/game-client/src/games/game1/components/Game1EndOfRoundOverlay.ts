/**
 * Spill 1 end-of-round overlay — combined Summary + Loading.
 *
 * Tobias UX-mandate 2026-04-29 (revised post-PR #734): drop COUNTDOWN-fasen
 * helt. Den spilte ned til en svart skjerm med teller — bruker så IKKE live-
 * elementer (pattern-animasjon, neste planlagt spill, gevinster) før de selv
 * måtte refreshe siden. Ny flyt:
 *
 *   1. SUMMARY (combined Summary + Loading):
 *      - Header varierer på endedReason (BINGO_CLAIMED / MAX_DRAWS / MANUAL).
 *      - Stort sentrert tall: "X kr" — animert count-up fra 0 til total.
 *      - Kompakt patterns-tabell (5 phases × vinner/payout).
 *      - Mini-game-resultat hvis vunnet.
 *      - Egen total ("Du vant" / "Du vant ikke") basert på akkumulerte vinninger.
 *      - Persistent spinner + soft tekst ("Forbereder rommet...") nederst i
 *        kortet — signaliserer at vi venter på live-state.
 *      - Forblir oppe inntil BÅDE (a) min-display-tid er passert, OG
 *        (b) controller har kalt `markRoomReady()`.
 *      - Når begge betingelser er møtt → fade ut og kall `onOverlayCompleted`.
 *
 * Hovedforskjell fra PR #734 (3-fase-overlay):
 *   - Ingen automatisk transition til LOADING/COUNTDOWN på timer.
 *   - Ingen countdown-skjerm; bruker går direkte fra summary til selve rommet.
 *   - Bruker ser live-state (pattern-animasjon, neste-spill-info, gevinster)
 *     umiddelbart ved ankomst — ingen refresh nødvendig.
 *   - Loading-spinner er INNE i summary-kortet, ikke separat fase.
 *   - Ingen buy-popup-trigger i overlay — rom-state åpner buy-popup nativt
 *     når WAITING-fasen aktiverer.
 *
 * "Tilbake til lobby"-knappen er PERMANENT tilgjengelig slik at spilleren kan
 * forlate når som helst uten å vente.
 *
 * HTML-basert (ikke Pixi) for samme grunn som WinScreenV2: full kontroll
 * over knapper + click-events uten Pixi event-batch-quirks.
 *
 * Disconnect-resilience: hvis bruker reconnecter midt i overlay, kalles
 * `show()` igjen og rebuilder overlay fra scratch. Min-display-tid + ready-
 * gating gjelder igjen (3s + neste room-update fra controller).
 */

import type {
  PatternResult,
  Ticket,
} from "@spillorama/shared-types/game";
import type { MiniGameResultPayload } from "@spillorama/shared-types/socket-events";

const SPILLORAMA_LOGO_URL =
  "/web/games/assets/game1/design/spillorama-logo.png";

/**
 * Minimum-display-tid for SUMMARY-fasen. Brukerne skal ha tid til å lese
 * vinnings-summary før overlay kan dismisses. 3s er standard for normal-
 * runde; spectator (0 tickets) reduseres til 1s siden det ikke er noen
 * egne winnings å feire.
 *
 * Denne tida er nedre grense — overlay forblir oppe lengre hvis controller
 * ikke har kalt `markRoomReady()` ennå.
 */
export const MIN_DISPLAY_MS = 3_000;
export const MIN_DISPLAY_MS_SPECTATOR = 1_000;

/**
 * @deprecated Erstattet av `MAX_PREPARING_ROOM_MS` per Tobias-mandate
 * 2026-05-14. Beholdes som eksport for backward-compat med eksterne
 * importøre — verdien er ikke lenger aktivt brukt i `show()`-schedulering.
 *
 * Historisk: Tobias prod-incident 2026-05-13 (root cause #3 fra engine-
 * bridge-diagnose-rapport): "Forbereder rommet..."-spinner henger evig
 * fordi backend ikke emitter ny `room:update` etter round-end før master
 * har klikket "Start neste spill". Det opprinnelige fix-et byttet bare
 * tekst til "Venter på master" etter 30s; Tobias 2026-05-14 supersedes
 * med auto-return etter 15s.
 */
export const WAITING_FOR_MASTER_TIMEOUT_MS = 30_000;

/**
 * Tobias UX-mandate 2026-05-14 (auto-return-til-lobby etter runde-end):
 *
 * > "Etter endt runde må man bli ført tilbake til lobbyen til spillet etter
 * > at runden er ferdig, må da bli ført tilbake når man er sikker på at
 * > rommet er klart igjen og live."
 *
 * Reproduserer Tobias-rapport 2026-05-14 09:54: etter runde 330597ef
 * vises WinScreen + "Forbereder rommet..."-spinner, men spinneren henger
 * evig fordi backend ikke nødvendigvis emit-er ny `room:update` umiddelbart
 * (master må starte neste runde, eller perpetual-loop må spawne ny
 * scheduled-game). Spilleren må klikke "Tilbake til lobby" manuelt.
 *
 * Fix: 15s max-timeout fra overlay-mount → auto-return uavhengig av om
 * `markRoomReady` er kalt. De siste 2 sekundene bytter loading-teksten til
 * "Returnerer til lobby..." for synlig overgang. Forced `tryDismiss` skiper
 * markRoomReady-gating fordi vi velger active redirect over evig venting.
 *
 * Idempotens:
 *   - Avbrytes hvis bruker klikker "Tilbake til lobby" manuelt (overlay
 *     allerede skjult)
 *   - Avbrytes hvis `markRoomReady` kalles (rommet er klart, normal dismiss)
 *   - Avbrytes hvis `tryDismiss` allerede har fyrt `onOverlayCompleted`
 */
export const MAX_PREPARING_ROOM_MS = 15_000;
export const RETURNING_TO_LOBBY_PREVIEW_MS = 2_000;

/**
 * @deprecated SUMMARY_PHASE_MS er erstattet av MIN_DISPLAY_MS. Beholdes for
 * kompatibilitet med eksisterende tester; vil fjernes neste oppdatering.
 */
export const SUMMARY_PHASE_MS = MIN_DISPLAY_MS;
export const SUMMARY_PHASE_SPECTATOR_MS = MIN_DISPLAY_MS_SPECTATOR;

/**
 * Tobias-direktiv 2026-05-15 — C-hybrid (post-round-overlay data-driven dismiss):
 *
 *   > "Vi har fortsatt ikke løst problemet med at man kun ser neste spill når
 *   > en runde er ferdig og popup kommer frem for kjøp av til da neste spill.
 *   > Nå viste man spillet som nettopp var spilt i ca 40 sekunder før det
 *   > endret til riktig spill."
 *   > — Tobias rapport 2026-05-15
 *
 *   > "Kjør C, tenker minimum 6 sek celebrasjon deretter vent"
 *   > — Tobias godkjennelse 2026-05-15
 *
 * Data-driven dismiss-modus erstatter timer-driven legacy-flyten når Game1-
 * Controller setter `summary.justPlayedSlug` (eller kaller `setJustPlayedSlug`).
 * Mens legacy-modus dismisser overlay etter `MIN_DISPLAY_MS` (3s) + første
 * `markRoomReady`, krever data-driven modus følgende:
 *
 *   1. Minimum `MIN_CELEBRATION_MS` (6s) celebrasjon for komfortabel feiring
 *      av runde-resultatet. Selv hvis ny slug ankommer på 50ms blir overlay
 *      stående i 6s.
 *   2. Etter 6s: vent på at lobby-state har en `nextScheduledGame.catalogSlug`
 *      som er FORSKJELLIG fra `justPlayedSlug`. Det betyr at backend har
 *      advancert plan-runtime og spilleren skal se det nye spillet.
 *   3. Safety-cap `MAX_WAIT_MS` (60s) — overlay dismisses uansett etter 60s
 *      for å unngå evig-overlay hvis backend henger. Forced dismiss
 *      logges som Sentry-breadcrumb.
 *
 * Hvorfor 6s og 60s:
 *   - 6s er bekvemt for spilleren å lese WinScreen-totalen, se patterns-
 *     tabellen og forberede seg mentalt på neste runde. Kortere ga "for
 *     rask"-feedback i pilot-testing. Lengre ble irriterende ved tap
 *     (ingen winnings å feire, bare summary).
 *   - 60s er max bevisst venting på server. Tobias 2026-05-15 rapporterte
 *     40s stale data — backend-advance kan ta opptil dette ved feilet
 *     plan-runtime-state, men 60s er hard grense fordi spilleren etter
 *     den tiden vil tro klienten henger.
 *
 * Backward-compat: Hvis overlay ikke kalles med `setJustPlayedSlug` (eller
 * `summary.justPlayedSlug`) — typisk fra eksisterende tester og legacy
 * call-sites — falles tilbake til timer-driven path (`markRoomReady` +
 * `MIN_DISPLAY_MS`). Dette holder eksisterende test-suite grønn under
 * migrering.
 *
 * Ny prod-flyt setter `justPlayedSlug`-feltet i Game1Controller.
 * `showEndOfRoundOverlayForState` slik at data-driven modus aktiveres for
 * alle ekte runder. Legacy markRoomReady-pathen i `onStateChanged` blir da
 * en no-op (slug-comparison overgår den), men beholdes for å støtte
 * partial-rollback hvis data-pathen viser seg å være feil.
 */
export const MIN_CELEBRATION_MS = 6_000;
export const MAX_WAIT_MS = 60_000;
/** Periodic poll-interval for å re-evaluere data-readiness etter min-celebration. */
const DATA_READINESS_POLL_MS = 500;

/** CSS fade-transition (opacity) i ms — keep ≤ 300ms for snap-feel. */
const PHASE_FADE_MS = 300;

/**
 * Count-up animasjon for total beløp. Spans hele SUMMARY_PHASE_MS slik at
 * tallet vokser jevnt over fasen.
 */
const COUNT_UP_DURATION_MS = 1_400;
/** Frames per ms for count-up — bruker requestAnimationFrame så ingen JS-loop. */
const COUNT_UP_FRAME_HINT = 16;

function ensureEndOfRoundStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("end-of-round-styles")) return;
  const s = document.createElement("style");
  s.id = "end-of-round-styles";
  s.textContent = `
@keyframes eor-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes eor-slide-up {
  from { opacity: 0; transform: translateY(20px) scale(0.96); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes eor-spin { to { transform: rotate(360deg); } }
.eor-phase {
  transition: opacity ${PHASE_FADE_MS}ms ease, transform ${PHASE_FADE_MS}ms ease;
}
.eor-phase[data-state="entering"] {
  opacity: 0;
  transform: translateY(8px);
}
.eor-phase[data-state="active"] {
  opacity: 1;
  transform: translateY(0);
}
.eor-phase[data-state="leaving"] {
  opacity: 0;
  transform: translateY(-8px);
}
.eor-lobby-btn:hover {
  background: rgba(255,255,255,0.08) !important;
  border-color: rgba(255,255,255,0.18) !important;
}
.eor-progress-bar {
  /* GPU-akselerert via transform — ingen layout-thrash. */
  will-change: transform;
}
`;
  document.head.appendChild(s);
}

function formatKr(n: number): string {
  return n.toLocaleString("no-NO").replace(/,/g, " ");
}

/**
 * Header-kopi reagerer på endedReason og om spilleren vant noe.
 *
 * Tobias-mandate: BINGO_CLAIMED + ownTotal>0 → "Du vant".
 *
 * Tobias prod-incident 2026-04-29 (PR #733): subtitle MÅ skille mellom
 * faktisk grunn for slutt slik at MAX_DRAWS-runder ikke feilaktig viser
 * "Fullt Hus er vunnet". Bug-trigger: når Phase 5 (Fullt Hus) ikke
 * kunne auto-claimes (f.eks. test-hall der bypass kjører videre, eller
 * recovery-edge-case med pause-state), ble runden avsluttet på
 * MAX_DRAWS_REACHED — overlay må da være ærlig om at fullt hus ikke
 * ble offisielt levert. Hver `endedReason`-gren har derfor en distinkt
 * subtitle, og tilskuer-versjonen (`ownTotal === 0`) sier aldri at
 * Fullt Hus er vunnet med mindre `endedReason === BINGO_CLAIMED`.
 */
function formatHeader(
  endedReason: string | undefined,
  ownTotal: number,
): { title: string; subtitle: string } {
  const isWinner = ownTotal > 0;
  switch (endedReason) {
    case "BINGO_CLAIMED":
      return {
        title: isWinner ? "Du vant" : "Spillet er ferdig",
        subtitle: isWinner
          ? "Vinnerne er kåret"
          : "Fullt Hus er vunnet",
      };
    case "MAX_DRAWS_REACHED":
    case "DRAW_BAG_EMPTY":
      return {
        title: isWinner ? "Du vant" : "Alle baller trukket",
        subtitle: "Runden er slutt",
      };
    case "MANUAL_END":
      return {
        title: isWinner ? "Du vant" : "Runden ble avsluttet",
        subtitle: "Administrator avsluttet runden",
      };
    case "SYSTEM_ERROR":
      return {
        title: "Spillet ble avbrutt",
        subtitle: "Eventuelle gevinster utbetales automatisk",
      };
    default:
      return {
        title: isWinner ? "Du vant" : "Spillet er ferdig",
        subtitle: "Vinnerne er kåret",
      };
  }
}

function formatMiniGameLabel(result: MiniGameResultPayload | null): string {
  if (!result) return "";
  const amountKr = Math.round(result.payoutCents / 100);
  switch (result.miniGameType) {
    case "wheel":
      return `Lykkehjul: ${formatKr(amountKr)} kr`;
    case "chest":
      return `Skattekiste: ${formatKr(amountKr)} kr`;
    case "mystery":
      return `Mystery: ${formatKr(amountKr)} kr`;
    case "colordraft":
      return `Color Draft: ${formatKr(amountKr)} kr`;
    case "oddsen":
      return `Oddsen: ${formatKr(amountKr)} kr`;
    default:
      return `Mini-spill: ${formatKr(amountKr)} kr`;
  }
}

/**
 * Phase identifier. Etter Tobias-mandat 2026-04-29 er COUNTDOWN/LOADING
 * fjernet — overlay har bare SUMMARY-fase som forblir oppe inntil
 * controller signalerer ready via `markRoomReady()`. LOADING/COUNTDOWN
 * forblir i typen for backward-kompatibilitet med eksisterende tester,
 * men setter aldri av seg.
 */
export type EndOfRoundPhase = "SUMMARY" | "LOADING" | "COUNTDOWN";

/**
 * En enkelt vinst-rad for spilleren (en bestemt fase + bongfarge). Brukes av
 * Game1Controller for å samle alle pattern:won-events der spilleren var blant
 * vinnerne, slik at WinScreen kan vise eksakt hva som ble vunnet.
 *
 * Tobias-direktiv 2026-05-14 (WinScreen-bug): WinScreen skal vise KUN faser
 * spilleren har vunnet. Hvis spilleren vant Rad 2 i to ticket-colors (eks.
 * purple 300 kr + white 100 kr), skal begge vises som separate rader. Ingen
 * "Ikke vunnet"-default for faser uten vinst.
 */
export interface MyPhaseWinRecord {
  /** Fase-nummer 1-5 (1=Rad 1, 5=Fullt Hus). Brukes til sortering. */
  phase: number;
  /** Display-navn ("1 Rad", "Fullt Hus" etc.). Vises i tabellen. */
  patternName: string;
  /** Bongfarge for vinninga (eks. "yellow"/"white"/"purple"). Optional. */
  ticketColor?: string;
  /** Vinning i kroner (per-vinner-andel allerede beregnet av server). */
  payoutAmount: number;
  /** Trekningsnummer ved seier (audit-info). */
  wonAtDraw?: number;
  /** Antall medvinnere på fasen (1 = solo). Brukes for "Du delte med X"-tekst. */
  sharedCount?: number;
}

export interface Game1EndOfRoundSummary {
  /** From `currentGame.endedReason`. Drives header copy. */
  endedReason: string | undefined;
  /** Full results array — used to render the patterns table. */
  patternResults: ReadonlyArray<PatternResult>;
  /** Caller's own player-id, used to compute "din total" + own-winner mark. */
  myPlayerId: string | null;
  /** Player's tickets at end-of-round (for own-pattern winners detection). */
  myTickets?: ReadonlyArray<Ticket>;
  /** Mini-game-result if the player triggered/received one this round. */
  miniGameResult?: MiniGameResultPayload | null;
  /** Lucky number if drawn. */
  luckyNumber?: number | null;
  /**
   * Pre-summed own-round winnings (set by Game1Controller — speilbilde av
   * `roundAccumulatedWinnings`). Hvis omitted, beregnes fra patternResults.
   */
  ownRoundWinnings?: number;
  /**
   * Tobias-direktiv 2026-05-14 (WinScreen-bug):
   *
   * Per-vinst-rader for spilleren — KUN faser/bongfarger spilleren har vunnet.
   * Når denne er satt, vises listen i stedet for den tradisjonelle
   * patternResults-tabellen (som viste ALLE 5 faser med "Ikke vunnet"-default
   * for ikke-vunnede). Game1Controller akkumulerer denne ved hvert
   * `pattern:won`-event der spilleren er i `winnerIds`.
   *
   * Designvalg:
   *   - Tom liste (`[]`) → "Beklager, ingen gevinst" vises (ikke 5 "Ikke
   *     vunnet"-rader). Spectator-runder bruker fortsatt isSpectator-pathen.
   *   - Sorteres etter `phase` (1 → 5) før render.
   *   - Multi-vinst per fase (eks. yellow + purple på Rad 2) vises som
   *     separate rader — én rad per record.
   *   - Omitted (`undefined`) → fall tilbake til legacy patternResults-tabellen
   *     for backwards-compat med tester og andre call-sites.
   */
  myWinnings?: ReadonlyArray<MyPhaseWinRecord>;
  /**
   * @deprecated Ubrukt etter Tobias-mandat 2026-04-29 — overlay har ikke
   * lenger countdown. Beholdes i typen for backward-kompatibilitet.
   */
  millisUntilNextStart?: number | null;
  /**
   * Antall ms som allerede har passert siden runden endet. Brukes ved
   * reconnect for å regne min-display-tid riktig (hvis bruker har vært
   * synlig i overlay i 4s allerede, gjør vi ikke en ny 3s-pause).
   */
  elapsedSinceEndedMs?: number;
  /**
   * Tobias-direktiv 2026-05-15 (C-hybrid post-round-overlay data-driven dismiss):
   *
   * Catalog-slug-en for runden som NETTOPP ble spilt (eks. "bingo",
   * "trafikklys", "oddsen-55"). Når satt aktiveres data-driven dismiss-modus
   * (`MIN_CELEBRATION_MS` floor + wait-for-new-slug + `MAX_WAIT_MS` cap)
   * i stedet for legacy markRoomReady + `MIN_DISPLAY_MS`.
   *
   * Hvor kommer slug-en fra:
   *   - Game1Controller henter `lobbyStateBinding.getState()?.nextScheduledGame.catalogSlug`
   *     ved `onGameEnded`-tidspunktet. På det tidspunktet har serveren ennå
   *     ikke advancert plan-runtime, så `nextScheduledGame.catalogSlug` peker
   *     fortsatt på runden som er i ferd med å avsluttes — perfekt baseline
   *     for "what just played".
   *   - Når backend senere advancerer plan-runtime og lobby-state oppdateres
   *     med ny `catalogSlug`, sender Game1Controller den nye verdien til
   *     overlay via `updateLobbyState(newSlug)` → overlay sammenligner og
   *     dismisser når slug !== justPlayedSlug.
   *
   * NB: NULL → legacy dismiss-modus (backward-compat for eksisterende tester
   * og fremtidige call-sites uten lobby-state-tilgang).
   */
  justPlayedSlug?: string | null;
  /**
   * "Tilbake til lobby" → emit lobby-navigation. Tilgjengelig gjennom
   * hele overlay-tida.
   */
  onBackToLobby: () => void;
  /**
   * @deprecated Ubrukt — overlay åpner ikke lenger buy-popup direkte.
   * Buy-popup vises av selve rommet når WAITING-fasen aktiverer.
   * Beholdes i typen for backward-kompatibilitet med eksisterende callere.
   */
  onCountdownNearStart?: () => void;
  /**
   * Kalles når overlay er klar til å dismisses (min-display-tid passert
   * OG controller har signalert ready via `markRoomReady()`). Caller bruker
   * dette til å transitionere fra ENDED til neste fase i selve rommet.
   */
  onOverlayCompleted?: () => void;
}

interface ActiveSession {
  summary: Game1EndOfRoundSummary;
  startedAt: number;
  /** Phase-fields rebuilt per show() call so re-render is clean. */
  phaseHostEl: HTMLDivElement;
  /** Currently-mounted phase content (replaced on transition). */
  currentPhaseEl: HTMLDivElement | null;
  currentPhase: EndOfRoundPhase;
  /**
   * @deprecated Ubrukt etter rewrite — kompatibilitet for typer.
   */
  hasFiredBuyPopupTrigger: boolean;
  /** Has overlay-completed fired? (Idempotent.) */
  hasFiredCompleted: boolean;
  /**
   * Har controller kalt `markRoomReady()`? Overlay dismisses ikke før dette
   * er sant OG min-display-tid er passert.
   */
  isRoomReady: boolean;
  /**
   * Har min-display-timeren utløpt? Overlay dismisses ikke før dette er
   * sant OG controller har kalt markRoomReady.
   */
  minDisplayElapsed: boolean;
  /** DOM-handle for loading-tekst-elementet (oppdateres ved auto-return-preview). */
  loadingMsgEl: HTMLSpanElement | null;
  /** DOM-handle for spinner-elementet (kan dempes ved fremtidige fallback). */
  loadingSpinnerEl: HTMLDivElement | null;
  /** DOM-handle for lobby-knappen (brukes ved auto-return-styling). */
  lobbyBtnEl: HTMLButtonElement | null;
  /**
   * Tobias 2026-05-14 (auto-return-til-lobby): timer som fyrer etter
   * `MAX_PREPARING_ROOM_MS` og trigger forced auto-return uavhengig av
   * `markRoomReady`-gating. Cancelles av (a) `markRoomReady` (normal
   * dismiss-path), (b) manuell "Tilbake til lobby"-klikk, (c) `hide()`.
   */
  autoReturnTimer: ReturnType<typeof setTimeout> | null;
  /**
   * Sekundær timer som etter `MAX_PREPARING_ROOM_MS - RETURNING_TO_LOBBY_PREVIEW_MS`
   * (= 13s) bytter loading-teksten til "Returnerer til lobby..." slik at
   * brukeren ser at auto-return er imminent. Cancelles sammen med
   * `autoReturnTimer` ved alle dismiss-paths.
   */
  autoReturnPreviewTimer: ReturnType<typeof setTimeout> | null;
  /**
   * True etter at auto-return-pathen har trigget tryDismiss. Brukes for
   * å skille `onOverlayCompleted`-årsak i Sentry-breadcrumb + tester.
   * Idempotent — settes én gang per session.
   */
  hasFiredAutoReturn: boolean;
  /**
   * Tobias-direktiv 2026-05-15 (C-hybrid data-driven dismiss):
   *
   * Catalog-slug-en for runden som NETTOPP er ferdigspilt. Settes enten
   * via `summary.justPlayedSlug` ved `show()` eller eksplisitt via
   * `setJustPlayedSlug(slug)` etter mount (controller late-bind). NULL =
   * legacy markRoomReady-modus aktiv (backward-compat). Non-NULL =
   * data-driven modus aktiv (dismiss venter på `currentNextSlug !==
   * justPlayedSlug`).
   */
  justPlayedSlug: string | null;
  /**
   * Siste mottatte `nextScheduledGame.catalogSlug` fra lobby-state.
   * Oppdateres av `updateLobbyState(slug)` ved hver onChange-tick fra
   * `Game1LobbyStateBinding`. Settes initielt fra `summary.justPlayedSlug`
   * fordi ved mount-tid har serveren ennå ikke advancert plan-runtime,
   * så `currentNextSlug === justPlayedSlug` til den endrer seg.
   */
  currentNextSlug: string | null;
  /**
   * Tidspunkt (ms epoch) for når data-driven minimum-celebration-vinduet
   * utløper. Computes `startedAt + MIN_CELEBRATION_MS` ved session-start
   * når data-driven modus er aktivert. Dismiss kan IKKE skje før dette
   * tidspunktet selv om ny slug ankommer på 50ms.
   */
  minCelebrationDeadline: number;
  /**
   * Tidspunkt (ms epoch) for safety-cap. Computes `startedAt + MAX_WAIT_MS`.
   * Etter dette tidspunktet dismisses overlay-en uansett (skipper slug-
   * comparison). Forced dismiss logges som Sentry-breadcrumb.
   */
  safetyCapDeadline: number;
  /**
   * Periodisk timer som re-evaluerer `tryDismissIfReady()` etter minimum-
   * celebration-vinduet er passert. Pollr hvert `DATA_READINESS_POLL_MS` (500ms)
   * frem til (a) slug-comparison passerer, (b) safety-cap rammer, eller
   * (c) overlay dismisses via annen path. Nullstilles ved alle dismiss-
   * paths via `clearTimers()`.
   */
  dataReadinessPollTimer: ReturnType<typeof setTimeout> | null;
  /**
   * Safety-cap-timer. Fyrer ved `safetyCapDeadline` og trigger forced
   * dismiss (skipper slug-comparison). Logges som Sentry-breadcrumb fordi
   * cap-en betyr at backend ikke advancert plan-runtime innen 60s — det
   * er ikke normalt og må flagges for ops.
   */
  safetyCapTimer: ReturnType<typeof setTimeout> | null;
  /**
   * True etter at safety-cap-pathen har dismisset overlay-en. Brukes for
   * å skille årsaken i Sentry-breadcrumb og tester ("MAX_WAIT_MS-reached"
   * vs "next-slug-ready").
   */
  hasFiredSafetyCap: boolean;
}

export class Game1EndOfRoundOverlay {
  private root: HTMLDivElement | null = null;
  private parent: HTMLElement;
  private session: ActiveSession | null = null;
  /** Active timer-handle (for next-phase-transition or countdown-tick). */
  private phaseTimer: ReturnType<typeof setTimeout> | null = null;
  /** Active countdown rAF handle. */
  private countdownRaf: ReturnType<typeof requestAnimationFrame> | null = null;
  /** Active count-up rAF handle. */
  private countUpRaf: ReturnType<typeof requestAnimationFrame> | null = null;
  /** Public-readable visibility for tests + Game1Controller reconnect-handling. */
  private visible = false;

  constructor(parent: HTMLElement) {
    this.parent = parent;
    ensureEndOfRoundStyles();
  }

  isVisible(): boolean {
    return this.visible;
  }

  /**
   * Eksponert kun for tester og for controller-debugging. Returnerer null
   * hvis overlay ikke er aktiv.
   */
  getCurrentPhase(): EndOfRoundPhase | null {
    return this.session?.currentPhase ?? null;
  }

  /**
   * Mount overlay. Idempotent — kall med ny summary lukker forrige instans
   * først (re-render på reconnect dekkes av samme path).
   *
   * Rekvisitt: `elapsedSinceEndedMs` (caller-supplied) lar overlay starte
   * i riktig fase ved reconnect:
   *   - elapsed < SUMMARY_PHASE_MS → start på SUMMARY (resterende tid)
   *   - elapsed < SUMMARY+LOADING → start på LOADING
   *   - else → start på COUNTDOWN med korrigert tid
   */
  show(summary: Game1EndOfRoundSummary): void {
    this.hide();
    this.visible = true;

    // Observability fix-PR 2026-05-13: track end-of-round-overlay-show
    // som screen.mount så monitor / dump-rapport ser når runden gikk over
    // til ENDED-fase fra klient-perspektiv. Fail-soft.
    try {
      void import("../debug/EventTracker.js")
        .then((mod) => {
          try {
            mod.getEventTracker().track("screen.mount", {
              screen: "Game1EndOfRoundOverlay",
              endedReason: summary.endedReason ?? null,
              patternResultCount: summary.patternResults.length,
              ownRoundWinnings: summary.ownRoundWinnings ?? null,
            });
          } catch {
            /* best-effort */
          }
        })
        .catch(() => {
          /* best-effort */
        });
    } catch {
      /* best-effort */
    }

    const root = document.createElement("div");
    Object.assign(root.style, {
      position: "fixed",
      inset: "0",
      zIndex: "1000",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background:
        "radial-gradient(ellipse at center, #2a1014 0%, #160808 60%, #0a0405 100%)",
      fontFamily: "'Poppins', system-ui, sans-serif",
      color: "#f4e8d0",
      padding: "32px 16px",
      animation: "eor-fade-in 0.32s ease-out both",
    });
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-labelledby", "eor-title");
    root.setAttribute("data-testid", "game1-end-of-round-overlay");

    // ── Card ──────────────────────────────────────────────────────────
    // Card container holds phase content + persistent "Tilbake til lobby"
    // button. Phase content sits inside `phaseHost` so we can swap it
    // without rebuilding the whole card.
    const card = document.createElement("div");
    Object.assign(card.style, {
      position: "relative",
      width: "100%",
      maxWidth: "520px",
      maxHeight: "calc(100vh - 64px)",
      overflow: "hidden",
      background: "linear-gradient(180deg, #2a1010 0%, #1d0a0a 100%)",
      borderRadius: "20px",
      padding: "32px 28px 24px",
      border: "1px solid rgba(245,184,65,0.18)",
      boxShadow:
        "0 30px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04) inset, 0 0 60px rgba(245,184,65,0.08)",
      textAlign: "center",
      animation: "eor-slide-up 0.42s cubic-bezier(0.34, 1.56, 0.64, 1) both",
    });

    // Logo
    const logoWrap = document.createElement("div");
    Object.assign(logoWrap.style, {
      width: "56px",
      height: "56px",
      margin: "0 auto 14px",
      filter: "drop-shadow(0 8px 18px rgba(245,184,65,0.4))",
    });
    const logoImg = document.createElement("img");
    logoImg.src = SPILLORAMA_LOGO_URL;
    logoImg.alt = "";
    logoImg.draggable = false;
    Object.assign(logoImg.style, {
      width: "100%",
      height: "100%",
      objectFit: "contain",
    });
    logoWrap.appendChild(logoImg);
    card.appendChild(logoWrap);

    // Phase host — phase content lives here. Reserve a min-height so
    // transitions don't visually shrink/expand the card around the swap.
    const phaseHost = document.createElement("div");
    phaseHost.setAttribute("data-testid", "eor-phase-host");
    Object.assign(phaseHost.style, {
      position: "relative",
      minHeight: "360px",
      display: "flex",
      flexDirection: "column",
      justifyContent: "flex-start",
    });
    card.appendChild(phaseHost);

    // Persistent "Tilbake til lobby"-knapp — alltid synlig, sekundær
    // low-contrast, separat fra phase content slik at den ikke transitions.
    const lobbyBtn = document.createElement("button");
    lobbyBtn.type = "button";
    lobbyBtn.className = "eor-lobby-btn";
    lobbyBtn.setAttribute("data-testid", "eor-lobby-btn");
    lobbyBtn.textContent = "Tilbake til lobby";
    Object.assign(lobbyBtn.style, {
      width: "100%",
      marginTop: "20px",
      padding: "12px 20px",
      fontSize: "13px",
      fontWeight: "600",
      fontFamily: "inherit",
      color: "rgba(244,232,208,0.7)",
      background: "rgba(255,255,255,0.03)",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: "12px",
      cursor: "pointer",
      transition: "all 180ms ease",
    });
    lobbyBtn.addEventListener("click", () => {
      const cb = this.session?.summary.onBackToLobby;
      this.hide();
      cb?.();
    });
    card.appendChild(lobbyBtn);

    root.appendChild(card);
    this.parent.appendChild(root);
    this.root = root;

    // ── Compute min-display-tid og setup session ──────────────────────
    const isSpectator =
      (summary.myTickets?.length ?? 0) === 0
        && this.computeOwnTotal(summary) === 0;
    const minDisplayMs = isSpectator
      ? MIN_DISPLAY_MS_SPECTATOR
      : MIN_DISPLAY_MS;
    const elapsed = Math.max(0, summary.elapsedSinceEndedMs ?? 0);
    // Disconnect-resilience: hvis bruker reconnecter med elapsed > min-
    // display-tid har den allerede sett summary-en lenge nok. Vi setter
    // `minDisplayElapsed=true` med en gang, slik at neste `markRoomReady`
    // umiddelbart kan dismisse.
    const minDisplayAlreadyElapsed = elapsed >= minDisplayMs;

    const now = Date.now();
    // Tobias-direktiv 2026-05-15 (data-driven dismiss): initial slug fra
    // summary.justPlayedSlug. Hvis bruker reconnecter med
    // `elapsedSinceEndedMs`, regn celebrations-deadline relativt til når
    // runden faktisk endte (now - elapsedSinceEndedMs).
    const initialSlug = summary.justPlayedSlug ?? null;
    const baseTimestamp = now - elapsed;

    this.session = {
      summary,
      startedAt: now,
      phaseHostEl: phaseHost,
      currentPhaseEl: null,
      currentPhase: "SUMMARY",
      hasFiredBuyPopupTrigger: false,
      hasFiredCompleted: false,
      isRoomReady: false,
      minDisplayElapsed: minDisplayAlreadyElapsed,
      loadingMsgEl: null,
      loadingSpinnerEl: null,
      lobbyBtnEl: lobbyBtn,
      autoReturnTimer: null,
      autoReturnPreviewTimer: null,
      hasFiredAutoReturn: false,
      justPlayedSlug: initialSlug,
      // currentNextSlug initialiseres = justPlayedSlug fordi server ennå
      // ikke har advancert plan-runtime ved overlay-mount-tid. Endring til
      // ny verdi via `updateLobbyState(newSlug)` er signalet for at
      // backend har advancert.
      currentNextSlug: initialSlug,
      minCelebrationDeadline: baseTimestamp + MIN_CELEBRATION_MS,
      safetyCapDeadline: baseTimestamp + MAX_WAIT_MS,
      dataReadinessPollTimer: null,
      safetyCapTimer: null,
      hasFiredSafetyCap: false,
    };

    // Alltid SUMMARY — COUNTDOWN/LOADING-fasene er fjernet (Tobias-mandat
    // 2026-04-29). Min-display-tid håndteres via `phaseTimer` under.
    this.enterSummary(minDisplayMs, isSpectator);

    if (!minDisplayAlreadyElapsed) {
      const remaining = Math.max(0, minDisplayMs - elapsed);
      this.phaseTimer = setTimeout(() => {
        const session = this.session;
        if (!session) return;
        session.minDisplayElapsed = true;
        this.tryDismiss();
      }, remaining);
    } else {
      // Reconnect-bruker har allerede sett overlay i ≥ min-display-tid.
      // Hvis controller umiddelbart kaller markRoomReady, dismiss med en
      // gang.
      // (Ingen timer trengs.)
    }

    // Tobias-direktiv 2026-05-15 (C-hybrid data-driven dismiss):
    // Hvis `summary.justPlayedSlug` er satt aktiveres data-driven modus
    // — schedule readiness-poll + safety-cap-timer. Hvis ikke (legacy
    // call-sites uten lobby-state-tilgang), forblir legacy markRoomReady-
    // pathen aktiv.
    if (this.isDataDrivenMode()) {
      this.scheduleDataDrivenTimers();
    }

    // Tobias UX-mandate 2026-05-14 (auto-return-til-lobby) — supersedes
    // WAITING_FOR_MASTER_TIMEOUT_MS-pathen (30s text-swap til "Venter på
    // master"). Den nye pathen forhindrer evig "Forbereder rommet..."-state:
    //   - Etter `MAX_PREPARING_ROOM_MS - RETURNING_TO_LOBBY_PREVIEW_MS` (13s):
    //     bytt tekst til "Returnerer til lobby..."
    //   - Etter `MAX_PREPARING_ROOM_MS` (15s): forced auto-return til lobby
    //     via onBackToLobby (samme path som manuell knapp-klikk).
    //
    // Cancelles ved markRoomReady (normal dismiss-path), manuell lobby-klikk
    // (hide-fra-onBackToLobby) eller hide() (controller dismiss).
    //
    // Reconnect-resilience: regn med elapsedSinceEndedMs. Hvis bruker
    // reconnecter med elapsed > MAX_PREPARING_ROOM_MS, trigger auto-return
    // umiddelbart (med preview-tekst).
    const elapsedSinceEnded = Math.max(0, summary.elapsedSinceEndedMs ?? 0);
    const remainingForAutoReturn = Math.max(
      0,
      MAX_PREPARING_ROOM_MS - elapsedSinceEnded,
    );
    if (remainingForAutoReturn === 0) {
      // Reconnect efter lang fravær uten ny runde — auto-return umiddelbart.
      this.scheduleAutoReturnPreview(0);
    } else if (remainingForAutoReturn <= RETURNING_TO_LOBBY_PREVIEW_MS) {
      // Mindre enn 2s igjen — start preview-fasen umiddelbart, deretter
      // auto-return etter resterende tid.
      this.scheduleAutoReturnPreview(0);
    } else {
      // Normal flyt: preview-tekst starter ved 13s, auto-return ved 15s.
      this.session.autoReturnPreviewTimer = setTimeout(() => {
        this.scheduleAutoReturnPreview(RETURNING_TO_LOBBY_PREVIEW_MS);
      }, remainingForAutoReturn - RETURNING_TO_LOBBY_PREVIEW_MS);
    }
  }

  /**
   * Aktiver auto-return-preview-fasen. Bytter loading-tekst til "Returnerer
   * til lobby..." og scheduler tryDismissForceAutoReturn etter `delayMs`.
   *
   * `delayMs === 0` betyr at preview-tekst settes umiddelbart OG auto-return
   * trigges på neste tick (reconnect-edge-case der bruker har vært borte
   * lenger enn MAX_PREPARING_ROOM_MS).
   */
  private scheduleAutoReturnPreview(delayMs: number): void {
    const session = this.session;
    if (!session) return;
    if (session.hasFiredAutoReturn) return;
    if (session.hasFiredCompleted) return;

    // Bytt loading-tekst og dempe spinner — synlig "noe skjer".
    const loadingMsg = session.loadingMsgEl;
    if (loadingMsg) {
      loadingMsg.textContent = "Returnerer til lobby...";
      const parent = loadingMsg.parentElement;
      if (parent) {
        parent.setAttribute("data-state", "returning-to-lobby");
      }
    }
    // Schedule den faktiske force-dismiss-en.
    session.autoReturnTimer = setTimeout(() => {
      this.fireAutoReturn();
    }, delayMs);
  }

  /**
   * Forced auto-return-handler. Skipper markRoomReady-gating fordi vi har
   * besluttet at 15s er max-vente-tid (Tobias-direktiv 2026-05-14).
   *
   * Triggrer SAMME path som manuell "Tilbake til lobby"-klikk: kaller
   * `summary.onBackToLobby` slik at lobby-shell dispatches `returnToLobby`-
   * event og PlayScreen rydder opp via `dismissEndOfRoundAndReturnToWaiting`.
   * Vi velger lobby-path over in-room-WAITING fordi:
   *   1. Brukerens manuelle fallback har samme path — auto-return = "gjør
   *      det brukeren ville gjort uansett etter venting"
   *   2. Hvis backend henger 15s+, er det ikke trygt å anta at neste runde
   *      kommer umiddelbart i samme rom. Lobby viser fersk state.
   *   3. Lobby kan re-route bruker tilbake til samme rom hvis runde
   *      spawnes — ingen tap.
   *
   * Sentry-breadcrumb skrives så ops kan se hvor ofte fallback fyrer.
   * Idempotent (hasFiredAutoReturn-flagg).
   */
  private fireAutoReturn(): void {
    const session = this.session;
    if (!session) return;
    if (session.hasFiredAutoReturn) return;
    if (session.hasFiredCompleted) return;
    session.hasFiredAutoReturn = true;

    // Sentry breadcrumb — observability fordi fallback betyr at backend
    // ikke emit-et room:update innen 15s. Best-effort fail-soft (Sentry
    // off i dev).
    try {
      void import("../../../telemetry/Sentry.js")
        .then((mod) => {
          try {
            mod.addClientBreadcrumb(
              "endOfRoundOverlay.autoReturnFallback",
              {
                reason: "MAX_PREPARING_ROOM_MS_ELAPSED",
                maxPreparingRoomMs: MAX_PREPARING_ROOM_MS,
                isRoomReady: session.isRoomReady,
                minDisplayElapsed: session.minDisplayElapsed,
              },
            );
          } catch {
            /* best-effort */
          }
        })
        .catch(() => {
          /* best-effort */
        });
    } catch {
      /* best-effort */
    }

    // Sammenfaller med manuell "Tilbake til lobby"-klikk-flyt: lukk overlay
    // FØRST (idempotent fade ut), så kall onBackToLobby som er ansvarlig for
    // event-dispatch + dismissEndOfRoundAndReturnToWaiting. Markér completed
    // for å hindre at samtidige markRoomReady-call kjører tryDismiss på nytt.
    session.hasFiredCompleted = true;
    const onBackToLobby = session.summary.onBackToLobby;
    // Fade ut root, deretter kall onBackToLobby etter fade-tid.
    if (this.root) {
      this.root.style.transition = `opacity ${PHASE_FADE_MS}ms ease`;
      this.root.style.opacity = "0";
    }
    setTimeout(() => {
      try {
        onBackToLobby();
      } catch (err) {
        console.warn(
          "[Game1EndOfRoundOverlay] onBackToLobby threw (auto-return):",
          err,
        );
      }
      this.hide();
    }, PHASE_FADE_MS);
  }

  /**
   * Signal fra controller om at rommets live-state er ferdig lastet og
   * brukeren kan returneres til rommet. Idempotent — kall flere ganger
   * uten effekt etter første call.
   *
   * Legacy modus (justPlayedSlug ikke satt): overlay dismisses ikke før
   * BÅDE markRoomReady er kalt OG min-display-tid er passert. Dette
   * sikrer at brukeren ser vinnings-summary minst 3s før de føres tilbake
   * (1s for spectator).
   *
   * Data-driven modus (justPlayedSlug satt — Tobias-direktiv 2026-05-15):
   * markRoomReady-pathen er no-op. Dismiss krever i stedet at lobby-state
   * har advancert til ny slug. Se `setJustPlayedSlug` + `updateLobbyState`.
   */
  markRoomReady(): void {
    const session = this.session;
    if (!session) return;
    if (session.isRoomReady) return;
    session.isRoomReady = true;
    // Tobias 2026-05-14 (auto-return-til-lobby): cancel auto-return-
    // timers fordi rommet er klart for neste runde — normal dismiss-path
    // tar over. Hvis preview-fasen allerede startet (sjelden race ved
    // grensen 13-15s), beholdes "Returnerer til lobby..."-tekst inntil
    // tryDismiss fyrer fade-ut.
    if (session.autoReturnTimer !== null) {
      clearTimeout(session.autoReturnTimer);
      session.autoReturnTimer = null;
    }
    if (session.autoReturnPreviewTimer !== null) {
      clearTimeout(session.autoReturnPreviewTimer);
      session.autoReturnPreviewTimer = null;
    }
    this.tryDismiss();
  }

  /**
   * Tobias-direktiv 2026-05-15 (C-hybrid data-driven dismiss):
   *
   * Late-bind `justPlayedSlug` etter overlay er mountet. Brukes hvis
   * Game1Controller ikke kjente slug-en ved show()-tid (eks. lobby-state-
   * binding ennå ikke leverte første snapshot). Idempotent — same-verdi-
   * call er no-op. Overgang fra null → non-null aktiverer data-driven
   * modus (schedule poll + safety-cap timers + cancel legacy
   * autoReturnTimer).
   *
   * NB: setter back til null deaktiverer IKKE data-driven modus — det er
   * en envei-aktivering for å holde flow-en forutsigbar. Hvis round-
   * restart skjer (nytt overlay.show()), starter sessionen fra scratch.
   */
  setJustPlayedSlug(slug: string | null): void {
    const session = this.session;
    if (!session) return;
    const next = (slug ?? "").trim() || null;
    if (next === session.justPlayedSlug) return;
    const wasDataDriven = this.isDataDrivenMode();
    session.justPlayedSlug = next;
    // Aktiver data-driven-modus ved overgang fra null → non-null.
    if (!wasDataDriven && next !== null) {
      // currentNextSlug initialiseres til samme verdi siden vi antar
      // serveren ennå ikke har advancert plan-runtime (mount-tidspunkt).
      // Hvis updateLobbyState allerede har levert en non-null verdi
      // (sjelden race), respekterer vi den i stedet.
      if (session.currentNextSlug === null) {
        session.currentNextSlug = next;
      }
      // Hvis legacy auto-return-timer kjører fra show(), cancel den —
      // data-driven modus tar over med lengre safety-cap (MAX_WAIT_MS).
      if (session.autoReturnTimer !== null) {
        clearTimeout(session.autoReturnTimer);
        session.autoReturnTimer = null;
      }
      if (session.autoReturnPreviewTimer !== null) {
        clearTimeout(session.autoReturnPreviewTimer);
        session.autoReturnPreviewTimer = null;
      }
      this.scheduleDataDrivenTimers();
    }
    // Hvis ny slug er allerede forskjellig fra currentNextSlug (sjelden
    // race der lobby-state oppdaterte før setJustPlayedSlug ble kalt),
    // re-evaluer dismiss-conditionen.
    if (
      next !== null
      && session.currentNextSlug !== null
      && next !== session.currentNextSlug
    ) {
      this.tryDismissIfReady();
    }
  }

  /**
   * Tobias-direktiv 2026-05-15 (C-hybrid data-driven dismiss):
   *
   * Game1Controller pusher ny `nextScheduledGame.catalogSlug` ved hver
   * lobby-state-onChange-tick. Når slug-en endrer seg fra `justPlayedSlug`
   * vet vi at backend har advancert plan-runtime — dismiss kan trigge så
   * snart minimum-celebration-vinduet er passert.
   *
   * Idempotent — samme verdi to ganger = no-op. Tom-streng eller null
   * behandles som "ingen kjent slug" og deaktiverer ikke modus (vi venter
   * fortsatt på neste non-null verdi).
   */
  updateLobbyState(nextScheduledGameSlug: string | null): void {
    const session = this.session;
    if (!session) return;
    const next = (nextScheduledGameSlug ?? "").trim() || null;
    if (next === session.currentNextSlug) return;
    session.currentNextSlug = next;
    // Re-evaluer dismiss-condition ved hver state-change.
    this.tryDismissIfReady();
  }

  /**
   * Returnerer true hvis data-driven dismiss-modus er aktiv. Modus aktiveres
   * når `summary.justPlayedSlug` (eller `setJustPlayedSlug`) er satt med
   * non-null verdi. Legacy markRoomReady-modus er aktiv ellers.
   */
  private isDataDrivenMode(): boolean {
    const session = this.session;
    if (!session) return false;
    return session.justPlayedSlug !== null;
  }

  /**
   * Schedulerer (a) safety-cap-timer (MAX_WAIT_MS = 60s fra round-end) og
   * (b) periodisk readiness-poll som re-evaluerer slug-comparison hvert
   * DATA_READINESS_POLL_MS (500ms) etter minimum-celebration-vinduet er
   * passert. Idempotent — multiple calls cleaner forrige timer-set først.
   */
  private scheduleDataDrivenTimers(): void {
    const session = this.session;
    if (!session) return;
    if (session.hasFiredCompleted) return;
    if (session.hasFiredSafetyCap) return;

    // Cancel evt. tidligere timers (idempotency ved re-aktivering).
    if (session.dataReadinessPollTimer !== null) {
      clearTimeout(session.dataReadinessPollTimer);
      session.dataReadinessPollTimer = null;
    }
    if (session.safetyCapTimer !== null) {
      clearTimeout(session.safetyCapTimer);
      session.safetyCapTimer = null;
    }

    const now = Date.now();
    const safetyRemaining = Math.max(0, session.safetyCapDeadline - now);
    session.safetyCapTimer = setTimeout(() => {
      this.fireSafetyCapDismiss();
    }, safetyRemaining);

    // Periodic poll: re-evaluer hvert 500ms. Stopp når dismiss skjer
    // (hide() / clearTimers nullstiller).
    const pollTick = (): void => {
      if (!this.session) return;
      if (this.session.hasFiredCompleted) return;
      if (this.session.hasFiredSafetyCap) return;
      if (this.tryDismissIfReady()) return; // dismiss trigget, ingen reschedule
      this.session.dataReadinessPollTimer = setTimeout(
        pollTick,
        DATA_READINESS_POLL_MS,
      );
    };
    session.dataReadinessPollTimer = setTimeout(
      pollTick,
      DATA_READINESS_POLL_MS,
    );
  }

  /**
   * Forced safety-cap-dismiss (MAX_WAIT_MS = 60s nådd). Skipper slug-
   * comparison fordi backend ikke har advancert plan-runtime innen
   * grensen. Bruker samme fade-ut + onOverlayCompleted-path som normal
   * dismiss (caller transition-er til WAITING / lobby med stale slug —
   * spilleren vil i hvert fall ikke se evig "Forbereder rommet..."-state).
   *
   * Sentry-breadcrumb skrives fordi cap-en er en anomali — backend bør
   * ALDRI bruke > 60s på å advancere plan etter round-end. Repeterte cap-
   * fires er signal til ops om å undersøke plan-runtime-state.
   * Idempotent via hasFiredSafetyCap-flagg.
   */
  private fireSafetyCapDismiss(): void {
    const session = this.session;
    if (!session) return;
    if (session.hasFiredSafetyCap) return;
    if (session.hasFiredCompleted) return;
    session.hasFiredSafetyCap = true;

    // Observability — Sentry breadcrumb for ops-monitoring. Best-effort.
    try {
      void import("../../../telemetry/Sentry.js")
        .then((mod) => {
          try {
            mod.addClientBreadcrumb(
              "endOfRoundOverlay.safetyCapDismiss",
              {
                reason: "MAX_WAIT_MS_REACHED",
                maxWaitMs: MAX_WAIT_MS,
                justPlayedSlug: session.justPlayedSlug,
                currentNextSlug: session.currentNextSlug,
                slugStillStale:
                  session.currentNextSlug === session.justPlayedSlug,
              },
            );
          } catch {
            /* best-effort */
          }
        })
        .catch(() => {
          /* best-effort */
        });
    } catch {
      /* best-effort */
    }

    session.hasFiredCompleted = true;
    if (this.root) {
      this.root.style.transition = `opacity ${PHASE_FADE_MS}ms ease`;
      this.root.style.opacity = "0";
    }
    setTimeout(() => {
      try {
        session.summary.onOverlayCompleted?.();
      } catch (err) {
        console.warn(
          "[Game1EndOfRoundOverlay] onOverlayCompleted threw (safety-cap):",
          err,
        );
      }
      this.hide();
    }, PHASE_FADE_MS);
  }

  /**
   * Tobias-direktiv 2026-05-15 (C-hybrid): data-driven dismiss-check.
   * Returnerer true hvis overlay ble dismisset, false ellers.
   *
   * Krav for dismiss (data-driven modus):
   *   (a) Minimum-celebration-vindu (MIN_CELEBRATION_MS = 6s) er passert.
   *   (b) `currentNextSlug !== null && currentNextSlug !== justPlayedSlug`
   *       (serveren har advancert plan-runtime).
   *
   * Hvis (a) ikke møtt: ingen handling (poll-timer reschedules etter
   *   500ms).
   * Hvis (a) møtt men (b) ikke: ingen handling (poll-timer reschedules
   *   fram til safety-cap rammer ved 60s).
   * Hvis begge møtt: dismiss via samme fade-out-path som tryDismiss.
   */
  private tryDismissIfReady(): boolean {
    const session = this.session;
    if (!session) return false;
    if (session.hasFiredCompleted) return false;
    if (!this.isDataDrivenMode()) return false; // legacy-modus bruker tryDismiss
    const now = Date.now();
    if (now < session.minCelebrationDeadline) return false;
    // Slug-comparison: må ha kjent currentNextSlug OG den må være
    // forskjellig fra justPlayedSlug.
    if (session.currentNextSlug === null) return false;
    if (session.currentNextSlug === session.justPlayedSlug) return false;
    // Begge betingelser møtt — dismiss.
    session.hasFiredCompleted = true;
    if (this.root) {
      this.root.style.transition = `opacity ${PHASE_FADE_MS}ms ease`;
      this.root.style.opacity = "0";
    }
    setTimeout(() => {
      try {
        session.summary.onOverlayCompleted?.();
      } catch (err) {
        console.warn(
          "[Game1EndOfRoundOverlay] onOverlayCompleted threw (data-driven):",
          err,
        );
      }
      this.hide();
    }, PHASE_FADE_MS);
    return true;
  }

  /**
   * Sjekker om overlay kan dismisses og fader ut hvis ja. Kalles fra
   * (a) markRoomReady-call og (b) min-display-timer-utløp. Idempotent
   * via hasFiredCompleted-flagget.
   *
   * NB: Når data-driven modus er aktiv (isDataDrivenMode returnerer
   * true), bypasser tryDismiss til `tryDismissIfReady()`. Legacy
   * markRoomReady-pathen blir da no-op for nye prod-runs, men beholdes
   * for backwards-compat med eksisterende tester og partial-rollback.
   */
  private tryDismiss(): void {
    const session = this.session;
    if (!session) return;
    if (session.hasFiredCompleted) return;
    // Data-driven modus tar over hvis aktiv — legacy markRoomReady-pathen
    // er da no-op. Re-evaluer via tryDismissIfReady for konsistens.
    if (this.isDataDrivenMode()) {
      this.tryDismissIfReady();
      return;
    }
    if (!session.isRoomReady || !session.minDisplayElapsed) return;
    session.hasFiredCompleted = true;
    // Fade ut root, kall completion etter fade-tid.
    if (this.root) {
      this.root.style.transition = `opacity ${PHASE_FADE_MS}ms ease`;
      this.root.style.opacity = "0";
    }
    setTimeout(() => {
      try {
        session.summary.onOverlayCompleted?.();
      } catch (err) {
        console.warn(
          "[Game1EndOfRoundOverlay] onOverlayCompleted threw:",
          err,
        );
      }
      this.hide();
    }, PHASE_FADE_MS);
  }

  hide(): void {
    this.clearTimers();
    if (this.root) {
      this.root.remove();
      this.root = null;
    }
    this.session = null;
    this.visible = false;
  }

  destroy(): void {
    this.hide();
  }

  private clearTimers(): void {
    if (this.phaseTimer !== null) {
      clearTimeout(this.phaseTimer);
      this.phaseTimer = null;
    }
    if (this.countdownRaf !== null) {
      cancelAnimationFrame(this.countdownRaf);
      this.countdownRaf = null;
    }
    if (this.countUpRaf !== null) {
      cancelAnimationFrame(this.countUpRaf);
      this.countUpRaf = null;
    }
    // Tobias 2026-05-14 (auto-return-til-lobby): cancel auto-return-
    // timers ved hide()/destroy() slik at de ikke fyrer etter at overlay
    // er borte (manuell lobby-klikk, controller dismiss, reconnect-rebuild).
    if (this.session?.autoReturnTimer != null) {
      clearTimeout(this.session.autoReturnTimer);
      this.session.autoReturnTimer = null;
    }
    if (this.session?.autoReturnPreviewTimer != null) {
      clearTimeout(this.session.autoReturnPreviewTimer);
      this.session.autoReturnPreviewTimer = null;
    }
    // Tobias 2026-05-15 (C-hybrid data-driven dismiss): cancel data-driven
    // timers (poll + safety-cap) ved hide()/destroy() — match samme livssyklus
    // som auto-return-timers. Hvis disse ikke ryddes vil de fyre etter at
    // overlay er borte (sessions er null'et), og setTimeout-callbackene må
    // selv null-sjekke `this.session` defensivt.
    if (this.session?.dataReadinessPollTimer != null) {
      clearTimeout(this.session.dataReadinessPollTimer);
      this.session.dataReadinessPollTimer = null;
    }
    if (this.session?.safetyCapTimer != null) {
      clearTimeout(this.session.safetyCapTimer);
      this.session.safetyCapTimer = null;
    }
  }

  // ── Phase 1: SUMMARY ──────────────────────────────────────────────
  private enterSummary(remainingMs: number, isSpectator: boolean): void {
    if (!this.session) return;
    this.session.currentPhase = "SUMMARY";
    const summary = this.session.summary;
    const ownTotal = this.computeOwnTotal(summary);
    const header = formatHeader(summary.endedReason, ownTotal);

    const phaseEl = document.createElement("div");
    phaseEl.className = "eor-phase";
    phaseEl.setAttribute("data-testid", "eor-phase-summary");
    phaseEl.setAttribute("data-state", "entering");

    if (isSpectator) {
      // Reduced summary for spectator (0 tickets armed).
      const titleEl = document.createElement("h2");
      titleEl.id = "eor-title";
      titleEl.textContent = "Spillet er ferdig";
      Object.assign(titleEl.style, {
        margin: "0 0 12px",
        fontSize: "24px",
        fontWeight: "800",
        color: "#f5c842",
        letterSpacing: "0.01em",
      });
      phaseEl.appendChild(titleEl);

      const subtitle = document.createElement("div");
      subtitle.textContent = header.subtitle;
      Object.assign(subtitle.style, {
        fontSize: "14px",
        fontWeight: "500",
        color: "rgba(244,232,208,0.72)",
      });
      phaseEl.appendChild(subtitle);
    } else {
      // Title
      const titleEl = document.createElement("h2");
      titleEl.id = "eor-title";
      titleEl.textContent = header.title;
      Object.assign(titleEl.style, {
        margin: "0 0 6px",
        fontSize: "24px",
        fontWeight: "800",
        color: "#f5c842",
        letterSpacing: "0.01em",
      });
      phaseEl.appendChild(titleEl);

      const subtitleEl = document.createElement("div");
      subtitleEl.textContent = header.subtitle;
      Object.assign(subtitleEl.style, {
        fontSize: "13px",
        fontWeight: "500",
        color: "rgba(244,232,208,0.7)",
        marginBottom: "20px",
      });
      phaseEl.appendChild(subtitleEl);

      // Animated count-up to ownTotal
      const ownAmountEl = document.createElement("div");
      ownAmountEl.setAttribute("data-testid", "eor-own-total");
      Object.assign(ownAmountEl.style, {
        fontSize: "44px",
        fontWeight: "900",
        color: ownTotal > 0 ? "#f5c842" : "rgba(244,232,208,0.55)",
        lineHeight: "1",
        marginBottom: "22px",
        letterSpacing: "-0.02em",
      });
      ownAmountEl.textContent = `${formatKr(0)} kr`;
      phaseEl.appendChild(ownAmountEl);
      this.startCountUp(ownAmountEl, ownTotal);

      // Patterns table (compact, mobile-friendly)
      phaseEl.appendChild(this.buildPatternsTable(summary));

      // Lucky number
      if (typeof summary.luckyNumber === "number") {
        const luckyEl = document.createElement("div");
        luckyEl.setAttribute("data-testid", "eor-lucky-number");
        Object.assign(luckyEl.style, {
          marginTop: "10px",
          fontSize: "12px",
          fontWeight: "600",
          color: "rgba(244,232,208,0.72)",
        });
        luckyEl.textContent = `Lykketall: ${summary.luckyNumber}`;
        phaseEl.appendChild(luckyEl);
      }

      // Mini-game-result
      const miniGameLabel = formatMiniGameLabel(summary.miniGameResult ?? null);
      if (miniGameLabel) {
        const miniGameEl = document.createElement("div");
        miniGameEl.setAttribute("data-testid", "eor-mini-game");
        Object.assign(miniGameEl.style, {
          marginTop: "8px",
          fontSize: "12px",
          fontWeight: "600",
          color: "rgba(244,232,208,0.72)",
        });
        miniGameEl.textContent = miniGameLabel;
        phaseEl.appendChild(miniGameEl);
      }
    }

    // Persistent loading-indikator — signaliserer at vi venter på live-
    // state fra rommet. Plassert nederst i kortet slik at den ikke
    // forstyrrer summary-lesing.
    const loadingWrap = document.createElement("div");
    loadingWrap.setAttribute("data-testid", "eor-loading-indicator");
    loadingWrap.setAttribute("data-state", "preparing");
    Object.assign(loadingWrap.style, {
      display: "flex",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: "10px",
      marginTop: "20px",
      color: "rgba(244,232,208,0.55)",
      fontSize: "12px",
      fontWeight: "500",
    });
    const spinner = document.createElement("div");
    spinner.setAttribute("aria-hidden", "true");
    Object.assign(spinner.style, {
      width: "14px",
      height: "14px",
      border: "2px solid rgba(245,184,65,0.18)",
      borderTopColor: "#f5b841",
      borderRadius: "50%",
      animation: "eor-spin 0.9s linear infinite",
    });
    loadingWrap.appendChild(spinner);
    const loadingMsg = document.createElement("span");
    loadingMsg.textContent = "Forbereder rommet...";
    loadingWrap.appendChild(loadingMsg);
    phaseEl.appendChild(loadingWrap);

    // Eksponer refs på session slik at waiting-fallback kan oppdatere
    // tekst + skjule spinner uten å rebuild hele overlay.
    if (this.session) {
      this.session.loadingMsgEl = loadingMsg;
      this.session.loadingSpinnerEl = spinner;
    }

    this.swapPhase(phaseEl);

    // Min-display-timer settes i show() — ingen transition til LOADING/
    // COUNTDOWN her. Overlay dismisses kun via tryDismiss() når
    // markRoomReady + minDisplayElapsed er satt.
    void remainingMs;
  }


  // ── Phase utilities ───────────────────────────────────────────────
  /**
   * Swap phase content with a smooth opacity-fade transition. The previous
   * phase fades out, then the new one fades in. Single overlay — no
   * popup-stacking, no flicker.
   */
  private swapPhase(newPhaseEl: HTMLDivElement): void {
    const session = this.session;
    if (!session) return;
    const phaseHost = session.phaseHostEl;
    const prevPhaseEl = session.currentPhaseEl;

    // Mount new phase (already in entering-state via [data-state]).
    phaseHost.appendChild(newPhaseEl);
    session.currentPhaseEl = newPhaseEl;

    // Force layout flush so transition kicks in. requestAnimationFrame
    // yields to the browser so CSS computes initial state before we
    // change [data-state="active"].
    requestAnimationFrame(() => {
      newPhaseEl.setAttribute("data-state", "active");
    });

    if (prevPhaseEl) {
      prevPhaseEl.setAttribute("data-state", "leaving");
      // Position previous phase absolutely so the new one can overlap
      // during the fade — same DOM-position, two opacity-states.
      Object.assign(prevPhaseEl.style, {
        position: "absolute",
        inset: "0",
        pointerEvents: "none",
      });
      // Remove previous phase after fade completes.
      setTimeout(() => {
        if (prevPhaseEl.parentElement === phaseHost) {
          prevPhaseEl.remove();
        }
      }, PHASE_FADE_MS + 50);
    }
  }

  /**
   * Animated count-up from 0 to target. Uses requestAnimationFrame for
   * 60fps smoothness — no setInterval (would risk frame-drops on slow
   * devices). Easing is ease-out-cubic so the number grows fast then
   * settles onto the target.
   */
  private startCountUp(el: HTMLDivElement, target: number): void {
    if (target <= 0) {
      el.textContent = `${formatKr(0)} kr`;
      return;
    }
    const startTs = performance.now();
    const tick = (now: number): void => {
      const t = Math.min(1, (now - startTs) / COUNT_UP_DURATION_MS);
      // ease-out-cubic
      const eased = 1 - Math.pow(1 - t, 3);
      const val = Math.round(target * eased);
      el.textContent = `${formatKr(val)} kr`;
      if (t < 1) {
        this.countUpRaf = requestAnimationFrame(tick);
      } else {
        el.textContent = `${formatKr(target)} kr`;
        this.countUpRaf = null;
      }
    };
    this.countUpRaf = requestAnimationFrame(tick);
    // Hint to lint that COUNT_UP_FRAME_HINT is intentionally referenced.
    void COUNT_UP_FRAME_HINT;
  }

  /**
   * Beregn spillerens egen total. Hvis caller ga oss `ownRoundWinnings`, bruk
   * den (Game1Controller's løpende `roundAccumulatedWinnings` er presis).
   * Ellers: summer fra patternResults — kun patterns hvor egen player-id
   * er listet som vinner.
   */
  private computeOwnTotal(summary: Game1EndOfRoundSummary): number {
    if (typeof summary.ownRoundWinnings === "number") {
      return Math.max(0, Math.round(summary.ownRoundWinnings));
    }
    if (!summary.myPlayerId) return 0;
    let total = 0;
    for (const r of summary.patternResults) {
      const winnerIds = r.winnerIds ?? (r.winnerId ? [r.winnerId] : []);
      if (!winnerIds.includes(summary.myPlayerId)) continue;
      const payout = r.payoutAmount ?? 0;
      total += payout;
    }
    return Math.round(total);
  }

  /**
   * Bygg vinnings-tabellen som vises i SUMMARY-fasen.
   *
   * Tobias-direktiv 2026-05-14 (WinScreen-bug):
   *   - Hvis `summary.myWinnings` er satt (Game1Controller-pathen): vis KUN
   *     rader spilleren har vunnet. Tom liste → "Beklager, ingen gevinst".
   *   - Hvis ikke (legacy/test-path): bruk eksisterende patternResults-tabell
   *     som viser alle 5 faser med vinner-info.
   *
   * `myWinnings`-pathen er den nye sannheten — patternResults-pathen er
   * backwards-compat for eksisterende tester og andre call-sites som ikke
   * vet om myWinnings ennå.
   */
  private buildPatternsTable(
    summary: Game1EndOfRoundSummary,
  ): HTMLDivElement {
    // Ny path: bruk myWinnings hvis Game1Controller har sendt listen
    // (eksplisitt-satt — undefined = legacy-path).
    if (summary.myWinnings !== undefined) {
      return this.buildMyWinningsTable(summary.myWinnings);
    }
    // Legacy-path: behold eksisterende patternResults-tabell for
    // backwards-compat. Brukes av eldre tester og evt. fremtidige
    // call-sites som ikke har myWinnings-data.
    return this.buildLegacyPatternsTable(summary);
  }

  /**
   * Bygg ny "kun-vinninger"-tabell.
   *
   * Tomt array (`[]`) → "Beklager, ingen gevinst" + ingen rad-liste.
   * Sortert etter `phase` (1 → 5). Hver record blir én rad — multi-vinst per
   * fase (eks. yellow + purple på Rad 2) vises som to separate rader.
   */
  private buildMyWinningsTable(
    winnings: ReadonlyArray<MyPhaseWinRecord>,
  ): HTMLDivElement {
    const wrap = document.createElement("div");
    wrap.setAttribute("data-testid", "eor-my-winnings-table");
    Object.assign(wrap.style, {
      display: "flex",
      flexDirection: "column",
      gap: "6px",
      textAlign: "left",
    });

    if (winnings.length === 0) {
      const empty = document.createElement("div");
      empty.setAttribute("data-testid", "eor-no-winnings");
      Object.assign(empty.style, {
        padding: "16px 12px",
        fontSize: "14px",
        fontWeight: "600",
        color: "rgba(244,232,208,0.72)",
        textAlign: "center",
        background: "rgba(255,255,255,0.03)",
        border: "1px dashed rgba(255,255,255,0.08)",
        borderRadius: "10px",
      });
      empty.textContent = "Beklager, ingen gevinst";
      wrap.appendChild(empty);
      return wrap;
    }

    // Sorter stabilt etter phase (1 → 5). Records med samme phase beholder
    // sin opprinnelige rekkefølge (Array.prototype.sort er stable i ES2019+).
    const sorted = [...winnings].sort((a, b) => a.phase - b.phase);

    for (const record of sorted) {
      wrap.appendChild(this.buildMyWinningsRow(record));
    }

    return wrap;
  }

  private buildMyWinningsRow(record: MyPhaseWinRecord): HTMLDivElement {
    const row = document.createElement("div");
    row.setAttribute("data-testid", "eor-my-winnings-row");
    row.setAttribute("data-phase", String(record.phase));
    if (record.ticketColor) {
      row.setAttribute("data-ticket-color", record.ticketColor);
    }
    Object.assign(row.style, {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "8px 12px",
      background: "rgba(245,184,65,0.1)",
      border: "1px solid rgba(245,184,65,0.32)",
      borderRadius: "8px",
    });

    const left = document.createElement("div");
    Object.assign(left.style, {
      display: "flex",
      flexDirection: "column",
      gap: "1px",
    });

    const nameEl = document.createElement("div");
    Object.assign(nameEl.style, {
      fontSize: "13px",
      fontWeight: "700",
      color: "#f4e8d0",
    });
    // Inkluder bongfarge inline hvis tilgjengelig (eks. "Rad 2 — yellow")
    // slik at spilleren ser at de vant samme fase i to farger.
    nameEl.textContent = record.ticketColor
      ? `${record.patternName} — ${record.ticketColor}`
      : record.patternName;
    left.appendChild(nameEl);

    const labelEl = document.createElement("div");
    Object.assign(labelEl.style, {
      fontSize: "11px",
      fontWeight: "500",
      color: "rgba(244,232,208,0.7)",
    });
    const shared = (record.sharedCount ?? 1) > 1;
    if (shared) {
      const others = (record.sharedCount ?? 1) - 1;
      labelEl.textContent = `Du delte med ${others} ${others === 1 ? "annen" : "andre"}`;
    } else {
      labelEl.textContent = "Du vant";
    }
    left.appendChild(labelEl);

    row.appendChild(left);

    const right = document.createElement("div");
    Object.assign(right.style, {
      fontSize: "14px",
      fontWeight: "800",
      color: "#f5c842",
    });
    right.textContent = `${formatKr(record.payoutAmount)} kr`;
    row.appendChild(right);

    return row;
  }

  /**
   * Legacy patternResults-tabell — beholdes for backwards-compat med tester
   * som ikke sender `myWinnings`. Viser alle 5 faser med "Ikke vunnet"-tekst
   * for ikke-vunnede.
   *
   * Tobias-direktiv 2026-05-14: nye call-sites SKAL sende `myWinnings` slik
   * at "Ikke vunnet"-default ikke vises til spillere. Denne pathen er kun
   * for backwards-compat.
   */
  private buildLegacyPatternsTable(
    summary: Game1EndOfRoundSummary,
  ): HTMLDivElement {
    const wrap = document.createElement("div");
    wrap.setAttribute("data-testid", "eor-patterns-table");
    Object.assign(wrap.style, {
      display: "flex",
      flexDirection: "column",
      gap: "6px",
      textAlign: "left",
    });

    if (summary.patternResults.length === 0) {
      const empty = document.createElement("div");
      Object.assign(empty.style, {
        padding: "10px",
        fontSize: "12px",
        color: "rgba(244,232,208,0.55)",
        textAlign: "center",
        background: "rgba(255,255,255,0.03)",
        border: "1px dashed rgba(255,255,255,0.08)",
        borderRadius: "10px",
      });
      empty.textContent = "Ingen vinnere denne runden";
      wrap.appendChild(empty);
      return wrap;
    }

    for (const r of summary.patternResults) {
      const row = document.createElement("div");
      const winnerIds = r.winnerIds ?? (r.winnerId ? [r.winnerId] : []);
      const isOwnWin =
        summary.myPlayerId !== null
        && winnerIds.includes(summary.myPlayerId);
      const winnerCount = r.winnerCount ?? winnerIds.length;
      Object.assign(row.style, {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "8px 12px",
        background: isOwnWin
          ? "rgba(245,184,65,0.1)"
          : r.isWon
            ? "rgba(255,255,255,0.04)"
            : "rgba(255,255,255,0.02)",
        border: isOwnWin
          ? "1px solid rgba(245,184,65,0.32)"
          : r.isWon
            ? "1px solid rgba(255,255,255,0.08)"
            : "1px dashed rgba(255,255,255,0.06)",
        borderRadius: "8px",
      });

      const left = document.createElement("div");
      Object.assign(left.style, {
        display: "flex",
        flexDirection: "column",
        gap: "1px",
      });

      const nameEl = document.createElement("div");
      Object.assign(nameEl.style, {
        fontSize: "13px",
        fontWeight: "700",
        color: r.isWon ? "#f4e8d0" : "rgba(244,232,208,0.55)",
      });
      nameEl.textContent = r.patternName;
      left.appendChild(nameEl);

      const winnerLabelEl = document.createElement("div");
      Object.assign(winnerLabelEl.style, {
        fontSize: "11px",
        fontWeight: "500",
        color: r.isWon
          ? "rgba(244,232,208,0.6)"
          : "rgba(244,232,208,0.4)",
      });
      if (r.isWon) {
        if (winnerCount > 1) {
          winnerLabelEl.textContent = isOwnWin
            ? `Du delte med ${winnerCount - 1} ${winnerCount - 1 === 1 ? "annen" : "andre"}`
            : `${winnerCount} vinnere`;
        } else {
          winnerLabelEl.textContent = isOwnWin ? "Du vant" : "1 vinner";
        }
      } else {
        winnerLabelEl.textContent = "Ikke vunnet";
      }
      left.appendChild(winnerLabelEl);

      row.appendChild(left);

      const right = document.createElement("div");
      Object.assign(right.style, {
        fontSize: "14px",
        fontWeight: "800",
        color: r.isWon ? "#f5c842" : "rgba(244,232,208,0.4)",
      });
      const payout = r.payoutAmount ?? 0;
      right.textContent = r.isWon ? `${formatKr(payout)} kr` : "—";
      row.appendChild(right);

      wrap.appendChild(row);
    }

    return wrap;
  }
}
