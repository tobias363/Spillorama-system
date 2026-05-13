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
 * Tobias prod-incident 2026-05-13 (root cause #3 fra engine-bridge-
 * diagnose-rapport): "Forbereder rommet..."-spinner henger evig fordi
 * backend ikke emitter ny `room:update` etter round-end før master har
 * klikket "Start neste spill". Klient venter på `markRoomReady()` som
 * trigges av første state-update etter overlay vises — uten ny event
 * trigges aldri.
 *
 * Fix: etter 30s uten markRoomReady, bytt loading-tekst fra "Forbereder
 * rommet..." til "Venter på master — runden er slutt" og høyne synlighet
 * av "Tilbake til lobby"-knappen. Overlay forblir oppe (bruker kan vente
 * eller forlate manuelt) — vi triggerer IKKE auto-dismiss fordi state ikke
 * er klar i rommet.
 */
export const WAITING_FOR_MASTER_TIMEOUT_MS = 30_000;

/**
 * @deprecated SUMMARY_PHASE_MS er erstattet av MIN_DISPLAY_MS. Beholdes for
 * kompatibilitet med eksisterende tester; vil fjernes neste oppdatering.
 */
export const SUMMARY_PHASE_MS = MIN_DISPLAY_MS;
export const SUMMARY_PHASE_SPECTATOR_MS = MIN_DISPLAY_MS_SPECTATOR;

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
  /** DOM-handle for loading-tekst-elementet (oppdateres ved waiting-fallback). */
  loadingMsgEl: HTMLSpanElement | null;
  /** DOM-handle for spinner-elementet (skjules ved waiting-fallback). */
  loadingSpinnerEl: HTMLDivElement | null;
  /** DOM-handle for lobby-knappen (styles oppjusteres ved waiting-fallback). */
  lobbyBtnEl: HTMLButtonElement | null;
  /** True etter at waiting-for-master-fallback har slått inn. Idempotent. */
  hasFiredWaitingFallback: boolean;
  /** Pending timer-handle for waiting-fallback (30s default). */
  waitingFallbackTimer: ReturnType<typeof setTimeout> | null;
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

    this.session = {
      summary,
      startedAt: Date.now(),
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
      hasFiredWaitingFallback: false,
      waitingFallbackTimer: null,
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

    // Tobias prod-incident 2026-05-13 (root cause #3): start 30s timeout
    // som bytter loading-tekst til "Venter på master — runden er slutt"
    // hvis controller IKKE har kalt markRoomReady innen den tid. Dette
    // forhindrer at spilleren ser "Forbereder rommet..."-spinner evig når
    // master ikke har startet neste runde.
    //
    // Reconnect-resilience: hvis `elapsedSinceEndedMs` allerede er over
    // timeout, slå fallback inn umiddelbart — bruker har trolig forlatt
    // siden og kommet tilbake mens master fortsatt ikke har startet
    // neste runde.
    const elapsedSinceEnded = Math.max(0, summary.elapsedSinceEndedMs ?? 0);
    const remainingForFallback = Math.max(
      0,
      WAITING_FOR_MASTER_TIMEOUT_MS - elapsedSinceEnded,
    );
    if (remainingForFallback === 0) {
      // Allerede over timeout (reconnect efter lang fravær).
      this.applyWaitingForMasterFallback();
    } else {
      this.session.waitingFallbackTimer = setTimeout(() => {
        this.applyWaitingForMasterFallback();
      }, remainingForFallback);
    }
  }

  /**
   * Signal fra controller om at rommets live-state er ferdig lastet og
   * brukeren kan returneres til rommet. Idempotent — kall flere ganger
   * uten effekt etter første call.
   *
   * Overlay dismisses ikke før BÅDE markRoomReady er kalt OG min-display-
   * tid er passert. Dette sikrer at brukeren ser vinnings-summary minst
   * 3s før de føres tilbake (1s for spectator).
   */
  markRoomReady(): void {
    const session = this.session;
    if (!session) return;
    if (session.isRoomReady) return;
    session.isRoomReady = true;
    // Cancel waiting-fallback-timer — vi har mottatt fersk room-state.
    if (session.waitingFallbackTimer !== null) {
      clearTimeout(session.waitingFallbackTimer);
      session.waitingFallbackTimer = null;
    }
    this.tryDismiss();
  }

  /**
   * Sjekker om overlay kan dismisses og fader ut hvis ja. Kalles fra
   * (a) markRoomReady-call og (b) min-display-timer-utløp. Idempotent
   * via hasFiredCompleted-flagget.
   */
  private tryDismiss(): void {
    const session = this.session;
    if (!session) return;
    if (session.hasFiredCompleted) return;
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
    if (this.session?.waitingFallbackTimer != null) {
      clearTimeout(this.session.waitingFallbackTimer);
      this.session.waitingFallbackTimer = null;
    }
  }

  /**
   * Bytter loading-tekst fra "Forbereder rommet..." til "Venter på master
   * — runden er slutt" og dempes spinneren. Lobby-knappens utseende
   * høynes (mer kontrast) slik at brukeren tydelig ser at den er
   * primær-action i ventetid-fallback.
   *
   * Idempotent — kall flere ganger uten effekt etter første call. Brukes
   * av:
   *   - 30s waiting-fallback-timer
   *   - reconnect-pathen hvis elapsedSinceEndedMs allerede er ≥ timeout
   */
  private applyWaitingForMasterFallback(): void {
    const session = this.session;
    if (!session) return;
    if (session.hasFiredWaitingFallback) return;
    session.hasFiredWaitingFallback = true;
    if (session.waitingFallbackTimer !== null) {
      clearTimeout(session.waitingFallbackTimer);
      session.waitingFallbackTimer = null;
    }
    // Bytt loading-tekst — tydeliggjør at vi venter på MASTER, ikke på
    // rommet selv (rommet er klart, men master har ikke startet neste
    // runde). Markér DOM-element med data-state for tester.
    const loadingMsg = session.loadingMsgEl;
    if (loadingMsg) {
      loadingMsg.textContent = "Venter på master — runden er slutt";
      const parent = loadingMsg.parentElement;
      if (parent) {
        parent.setAttribute("data-state", "waiting-for-master");
        // Dempe rad-styling — vi venter på menneske, ikke laster system.
        parent.style.color = "rgba(244,232,208,0.7)";
      }
    }
    // Skjul spinner (det er ikke laste-tilstand lenger — det er vente-på-master).
    const spinner = session.loadingSpinnerEl;
    if (spinner) {
      spinner.style.display = "none";
    }
    // Høyne lobby-knappens visuelle kontrast så bruker tydelig ser at det
    // er primary action i fallback-tilstand.
    const lobbyBtn = session.lobbyBtnEl;
    if (lobbyBtn) {
      lobbyBtn.setAttribute("data-state", "waiting-for-master");
      Object.assign(lobbyBtn.style, {
        color: "#f4e8d0",
        background: "rgba(245,184,65,0.12)",
        borderColor: "rgba(245,184,65,0.42)",
      });
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

  private buildPatternsTable(
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
