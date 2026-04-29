/**
 * Spill 1 end-of-round fluid 3-phase overlay.
 *
 * Tobias UX-mandate 2026-04-29 17:50 (option C): erstatt PR #729's summary-
 * overlay-med-CTA-knapper med ÉN flytende full-screen overlay som transitions
 * naturlig gjennom 3 faser uten popup-stacking eller flicker:
 *
 *   1. SUMMARY (3 sek for normal-runde, 1 sek hvis spilleren var spectator):
 *      - Header varierer på endedReason (BINGO_CLAIMED / MAX_DRAWS / MANUAL).
 *      - Stort sentrert tall: "X kr" — animert count-up fra 0 til total.
 *      - Kompakt patterns-tabell (5 phases × vinner/payout).
 *      - Mini-game-resultat hvis vunnet.
 *      - Egen total ("Du vant" / "Du vant ikke") basert på akkumulerte vinninger.
 *      - Auto-fade-transition til fase 2.
 *
 *   2. LOADING (1 sek):
 *      - "Forbereder neste runde..." soft tekst + subtil spinner.
 *      - Føles som naturlig transition, ikke en venting.
 *      - Auto-fade-transition til fase 3.
 *
 *   3. COUNTDOWN:
 *      - Stor sentral display: "Neste runde om X sekunder".
 *      - Telles ned basert på `millisUntilNextStart - elapsed_since_round_end`.
 *      - Progress bar i bunn som visualiserer gjenstående tid.
 *      - "Tilbake til lobby"-knapp er fortsatt tilgjengelig (sekundær,
 *        low-contrast).
 *      - Når countdown når 5 sek igjen → buy-popup åpner SMIDIG ON TOP av
 *        countdown (eksisterende buy-popup med loss-state-header fra PR #725).
 *      - Når ny runde starter (room:update status=WAITING → RUNNING) →
 *        overlay dismisses helt.
 *
 * Distinct fra `LoadingOverlay` (RECONNECTING/RESYNCING) — radial-rød
 * bakgrunn signaliserer "round done — vinner-scene" og er visuelt
 * forskjellig fra reconnect-spinner-bakgrunnen (semi-transparent svart).
 *
 * "Tilbake til lobby"-knappen er PERMANENT tilgjengelig gjennom alle 3 faser
 * (sekundær low-contrast i hjørnet) slik at spilleren kan forlate når som
 * helst uten å vente på phase-transitions.
 *
 * HTML-basert (ikke Pixi) for samme grunn som WinScreenV2: full kontroll
 * over knapper + click-events uten Pixi event-batch-quirks.
 *
 * Disconnect-resilience: hvis bruker reconnecter midt i overlay, kalles
 * `show()` igjen med `joinedAt`-flag som hopper rett til riktig fase
 * basert på elapsed time fra round-end (caller forsyner `roundEndedAt`
 * timestamp). Bruker som joinet midt i countdown ser IKKE phase 1 igjen.
 */

import type {
  PatternResult,
  Ticket,
} from "@spillorama/shared-types/game";
import type { MiniGameResultPayload } from "@spillorama/shared-types/socket-events";

const SPILLORAMA_LOGO_URL =
  "/web/games/assets/game1/design/spillorama-logo.png";

/**
 * Phase 1 (SUMMARY) duration. Normal-runde har 3s leselid for vinnerne.
 * Spectator-runde (0 tickets armed) reduseres til 1s siden det ikke er
 * noen egne winnings å feire.
 */
export const SUMMARY_PHASE_MS = 3_000;
export const SUMMARY_PHASE_SPECTATOR_MS = 1_000;

/**
 * Phase 2 (LOADING) duration. 1s er lange nok til at brukeren registrerer
 * "noe skjer" men kort nok til å føles som en naturlig transition og ikke
 * et venting-vindu.
 */
export const LOADING_PHASE_MS = 1_000;

/**
 * Phase 3 (COUNTDOWN) trigger-threshold for buy-popup. Når gjenstående
 * countdown er ≤ 5 sek, åpner buy-popup smidig ON TOP av countdown slik
 * at brukeren har tid til å velge bonger før neste runde starter.
 */
export const BUY_POPUP_TRIGGER_REMAINING_MS = 5_000;

/**
 * Default countdown total hvis caller ikke har `millisUntilNextStart`.
 * Brukes f.eks. når server ikke kjører auto-round (manuell modus); da
 * faller bruker tilbake til "Tilbake til lobby"-knapp etter timeout.
 */
export const DEFAULT_COUNTDOWN_MS = 30_000;

/** CSS phase-transition (opacity fade) i ms — keep ≤ 300ms for snap-feel. */
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
 * Phase identifier — eksponert for testing og for at controller kan
 * skille mellom fasene ved reconnect-handling.
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
   * Server-flag fra `currentGame.scheduler.millisUntilNextStart`. Hvis
   * gitt og > 0 driver phase 3 countdown; ellers fall tilbake til
   * DEFAULT_COUNTDOWN_MS. Den effektive countdown er hvor mye tid som
   * gjenstår NÅ — overlay starter med å trekke fra summary+loading-fasene
   * automatisk hvis caller ikke har gjort det.
   */
  millisUntilNextStart?: number | null;
  /**
   * Antall ms som allerede har passert siden runden endet. Brukes ved
   * reconnect — caller passer `Date.now() - roundEndedAt` slik at
   * overlay starter i riktig fase.
   */
  elapsedSinceEndedMs?: number;
  /**
   * "Tilbake til lobby" → emit lobby-navigation. Tilgjengelig gjennom
   * alle 3 faser.
   */
  onBackToLobby: () => void;
  /**
   * Kalles når countdown når BUY_POPUP_TRIGGER_REMAINING_MS gjenstående.
   * Caller åpner buy-popup ON TOP av countdown. Kalles én gang per
   * `show()`; idempotent guard er på controller-siden.
   */
  onCountdownNearStart?: () => void;
  /**
   * Kalles når overlay skulle dismisses (countdown ferdig eller
   * round transition). Caller kan bruke dette til å rydde opp
   * (f.eks. transition fra ENDED til WAITING).
   */
  onOverlayCompleted?: () => void;
}

interface ActiveSession {
  summary: Game1EndOfRoundSummary;
  startedAt: number;
  /** Total countdown duration computed from millisUntilNextStart. */
  countdownTotalMs: number;
  /** Phase-fields rebuilt per show() call so re-render is clean. */
  phaseHostEl: HTMLDivElement;
  /** Currently-mounted phase content (replaced on transition). */
  currentPhaseEl: HTMLDivElement | null;
  currentPhase: EndOfRoundPhase;
  /** Has buy-popup-trigger fired? (Idempotent.) */
  hasFiredBuyPopupTrigger: boolean;
  /** Has overlay-completed fired? (Idempotent.) */
  hasFiredCompleted: boolean;
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

    // ── Compute initial phase from elapsed time ───────────────────────
    const isSpectator =
      (summary.myTickets?.length ?? 0) === 0
        && this.computeOwnTotal(summary) === 0;
    const summaryPhaseMs = isSpectator
      ? SUMMARY_PHASE_SPECTATOR_MS
      : SUMMARY_PHASE_MS;
    const elapsed = Math.max(0, summary.elapsedSinceEndedMs ?? 0);

    // Compute countdown total: prefer server's `millisUntilNextStart`
    // (already represents NOW → next-start), else default. Subtract the
    // elapsed time that's already passed since round-ended in case caller
    // did NOT subtract it themselves.
    const rawCountdownMs =
      typeof summary.millisUntilNextStart === "number"
        && summary.millisUntilNextStart > 0
        ? summary.millisUntilNextStart
        : DEFAULT_COUNTDOWN_MS;
    // Total countdown = raw - (time already elapsed beyond summary+loading).
    // If caller passed elapsed=0 (fresh end), it's just the raw value.
    const countdownTotalMs = Math.max(
      BUY_POPUP_TRIGGER_REMAINING_MS,
      rawCountdownMs,
    );

    this.session = {
      summary,
      startedAt: Date.now(),
      countdownTotalMs,
      phaseHostEl: phaseHost,
      currentPhaseEl: null,
      currentPhase: "SUMMARY",
      hasFiredBuyPopupTrigger: false,
      hasFiredCompleted: false,
    };

    // Decide initial phase based on elapsed time. The thresholds ensure
    // disconnect-resilience: a player joining mid-countdown skips ahead
    // to phase 3 (sees countdown), NOT phase 1 again.
    if (elapsed < summaryPhaseMs) {
      const remaining = summaryPhaseMs - elapsed;
      this.enterSummary(remaining, isSpectator);
    } else if (elapsed < summaryPhaseMs + LOADING_PHASE_MS) {
      const remaining = summaryPhaseMs + LOADING_PHASE_MS - elapsed;
      this.enterLoading(remaining);
    } else {
      const countdownElapsed = elapsed - summaryPhaseMs - LOADING_PHASE_MS;
      const remainingCountdown = Math.max(
        0,
        countdownTotalMs - countdownElapsed,
      );
      this.enterCountdown(remainingCountdown);
    }
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

    this.swapPhase(phaseEl);

    // Schedule transition to LOADING.
    this.phaseTimer = setTimeout(() => {
      this.enterLoading(LOADING_PHASE_MS);
    }, Math.max(0, remainingMs));
  }

  // ── Phase 2: LOADING ──────────────────────────────────────────────
  private enterLoading(remainingMs: number): void {
    if (!this.session) return;
    this.session.currentPhase = "LOADING";

    const phaseEl = document.createElement("div");
    phaseEl.className = "eor-phase";
    phaseEl.setAttribute("data-testid", "eor-phase-loading");
    phaseEl.setAttribute("data-state", "entering");
    Object.assign(phaseEl.style, {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: "16px",
      padding: "60px 0",
    });

    // Subtle spinner
    const spinner = document.createElement("div");
    spinner.setAttribute("aria-hidden", "true");
    Object.assign(spinner.style, {
      width: "32px",
      height: "32px",
      border: "3px solid rgba(245,184,65,0.18)",
      borderTopColor: "#f5b841",
      borderRadius: "50%",
      animation: "eor-spin 0.9s linear infinite",
    });
    phaseEl.appendChild(spinner);

    // "Forbereder neste runde..."
    const msg = document.createElement("div");
    msg.id = "eor-title";
    msg.textContent = "Forbereder neste runde...";
    Object.assign(msg.style, {
      fontSize: "15px",
      fontWeight: "600",
      color: "rgba(244,232,208,0.78)",
      letterSpacing: "0.02em",
    });
    phaseEl.appendChild(msg);

    this.swapPhase(phaseEl);

    this.phaseTimer = setTimeout(() => {
      const session = this.session;
      if (!session) return;
      this.enterCountdown(session.countdownTotalMs);
    }, Math.max(0, remainingMs));
  }

  // ── Phase 3: COUNTDOWN ────────────────────────────────────────────
  private enterCountdown(remainingMs: number): void {
    if (!this.session) return;
    this.session.currentPhase = "COUNTDOWN";

    const phaseEl = document.createElement("div");
    phaseEl.className = "eor-phase";
    phaseEl.setAttribute("data-testid", "eor-phase-countdown");
    phaseEl.setAttribute("data-state", "entering");
    Object.assign(phaseEl.style, {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: "12px",
      paddingTop: "40px",
    });

    const titleEl = document.createElement("h2");
    titleEl.id = "eor-title";
    Object.assign(titleEl.style, {
      margin: "0",
      fontSize: "16px",
      fontWeight: "600",
      color: "rgba(244,232,208,0.7)",
      letterSpacing: "0.04em",
      textTransform: "uppercase",
    });
    titleEl.textContent = "Neste runde om";
    phaseEl.appendChild(titleEl);

    const secondsEl = document.createElement("div");
    secondsEl.setAttribute("data-testid", "eor-countdown-seconds");
    Object.assign(secondsEl.style, {
      fontSize: "72px",
      fontWeight: "900",
      color: "#f5c842",
      lineHeight: "1",
      letterSpacing: "-0.04em",
      textShadow: "0 4px 28px rgba(245,184,65,0.35)",
    });
    const initialSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
    secondsEl.textContent = `${initialSeconds}`;
    phaseEl.appendChild(secondsEl);

    const unitEl = document.createElement("div");
    Object.assign(unitEl.style, {
      fontSize: "13px",
      fontWeight: "600",
      color: "rgba(244,232,208,0.55)",
      letterSpacing: "0.04em",
      textTransform: "uppercase",
      marginTop: "-4px",
    });
    unitEl.textContent = initialSeconds === 1 ? "sekund" : "sekunder";
    phaseEl.appendChild(unitEl);

    // Progress bar in bottom — visualizes time-remaining as a shrinking bar.
    // Use scaleX transform (GPU-accelerated, no layout thrash) instead of
    // width animation. Ratio = remaining / total.
    const progressTrack = document.createElement("div");
    progressTrack.setAttribute("data-testid", "eor-progress-track");
    Object.assign(progressTrack.style, {
      width: "100%",
      maxWidth: "320px",
      height: "4px",
      marginTop: "24px",
      background: "rgba(255,255,255,0.06)",
      borderRadius: "999px",
      overflow: "hidden",
    });
    const progressBar = document.createElement("div");
    progressBar.className = "eor-progress-bar";
    progressBar.setAttribute("data-testid", "eor-progress-bar");
    const session = this.session;
    const initialRatio =
      session.countdownTotalMs > 0
        ? Math.max(0, Math.min(1, remainingMs / session.countdownTotalMs))
        : 0;
    Object.assign(progressBar.style, {
      width: "100%",
      height: "100%",
      background: "linear-gradient(90deg, #f5b841, #c88922)",
      transformOrigin: "left center",
      transform: `scaleX(${initialRatio})`,
    });
    progressTrack.appendChild(progressBar);
    phaseEl.appendChild(progressTrack);

    this.swapPhase(phaseEl);

    // Drive countdown via rAF so we update once per frame and never lag
    // behind reality. setTimeout for second-tick would risk under-counting
    // when the tab throttles.
    const countdownStart = Date.now();
    const countdownEndAt = countdownStart + remainingMs;

    const tick = (): void => {
      if (!this.session) return;
      const now = Date.now();
      const ms = Math.max(0, countdownEndAt - now);
      const seconds = Math.ceil(ms / 1000);
      const ratio =
        session.countdownTotalMs > 0
          ? Math.max(0, Math.min(1, ms / session.countdownTotalMs))
          : 0;

      // Update DOM only when seconds visually change (avoid rAF text-thrash).
      if (secondsEl.textContent !== `${seconds}`) {
        secondsEl.textContent = `${seconds}`;
        unitEl.textContent = seconds === 1 ? "sekund" : "sekunder";
      }
      progressBar.style.transform = `scaleX(${ratio})`;

      // Trigger buy-popup at threshold (idempotent).
      if (
        !session.hasFiredBuyPopupTrigger
        && ms <= BUY_POPUP_TRIGGER_REMAINING_MS
        && ms > 0
      ) {
        session.hasFiredBuyPopupTrigger = true;
        try {
          session.summary.onCountdownNearStart?.();
        } catch (err) {
          // Swallow — overlay must remain visible even if caller throws.
          console.warn(
            "[Game1EndOfRoundOverlay] onCountdownNearStart threw:",
            err,
          );
        }
      }

      if (ms <= 0) {
        // Countdown fully done — overlay yields. The new round-start event
        // will dismiss us via Game1Controller, but if it doesn't arrive
        // (e.g. manual mode), fire onOverlayCompleted as fallback.
        if (!session.hasFiredCompleted) {
          session.hasFiredCompleted = true;
          try {
            session.summary.onOverlayCompleted?.();
          } catch (err) {
            console.warn(
              "[Game1EndOfRoundOverlay] onOverlayCompleted threw:",
              err,
            );
          }
        }
        return;
      }

      this.countdownRaf = requestAnimationFrame(tick);
    };

    this.countdownRaf = requestAnimationFrame(tick);
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
