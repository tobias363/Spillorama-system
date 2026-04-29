/**
 * Spill 1 end-of-round summary overlay.
 *
 * Tobias prod-incident 2026-04-29 ~15:00: når Fullt Hus var levert, server
 * ferdig-ENDED runden korrekt (status=ENDED, alle premier utbetalt), men
 * klienten endte enten i auto-cycle (auto-round) eller hang i
 * "Oppdaterer spillet..." → "Kobler igjen"-spinner. Ingen av disse er retail
 * bingo-UX. Tobias' eksplisitte krav:
 *
 *   "Når fullt hus er levert ut er spillet ferdig og man må bli ført til
 *    siden der man kan kjøpe bonger."
 *
 * Denne overlayet erstatter den gamle Game 2-style EndScreen for Spill 1.
 * Sekvens etter Fullt Hus-claim eller MAX_DRAWS:
 *
 *   1. Server marker game ENDED og emitter `room:update` med
 *      `currentGame.status === "ENDED"` + `endedReason` + komplette
 *      `patternResults`. Mini-game-result kommer som separat
 *      `miniGameResult`-event (kun mottatt-før-ended).
 *   2. Game1Controller kaller `show(opts)` med oppsummering.
 *   3. Overlay viser:
 *        - Header "Spillet er ferdig" eller "Vinnerne er kåret"
 *        - Patterns-tabell (5 faser × vinner-IDer × premie)
 *        - Lykketall-utbetaling hvis aktuelt
 *        - Mini-game-resultat hvis aktuelt (Tobias-vinneren kan også
 *          ha hatt mini-game etter Fullt Hus)
 *        - Spillerens egen totale gevinst denne runden
 *        - To CTA-knapper: "Klar for neste runde" / "Tilbake til lobby"
 *   4. Auto-dismiss etter `autoDismissMs` ms (default 10s) → `onAutoDismiss`.
 *      Tilsvarer "5s ETTER WinScreenV2 har ferdig-animert"-mønsteret men
 *      her er det selve summary-vinduet som har egen timer.
 *   5. Klikk på "Klar for neste runde" → `onReadyForNextRound` (lukker
 *      overlay, transitions til WAITING uten å auto-arme bonger).
 *   6. Klikk på "Tilbake til lobby" → `onBackToLobby`.
 *
 * Distinct fra `LoadingOverlay` (RECONNECTING/RESYNCING) — ulik bakgrunn
 * (mørk-rød radial vs. semi-transparent svart) og posisjon (full-skjerm
 * fixed vs. relative inset-spinner). Slik vet bruker hva som faktisk skjer.
 *
 * HTML-basert (ikke Pixi) for samme grunn som WinScreenV2: full kontroll
 * over knapper + click-events uten Pixi event-batch-quirks.
 */

import type {
  PatternResult,
  Ticket,
} from "@spillorama/shared-types/game";
import type { MiniGameResultPayload } from "@spillorama/shared-types/socket-events";

const SPILLORAMA_LOGO_URL =
  "/web/games/assets/game1/design/spillorama-logo.png";

/**
 * Default auto-dismiss vindu (ms). 10s gir spilleren tid til å lese
 * oppsummeringen før vi enten auto-cycler (hvis auto-round-flag på) eller
 * faller tilbake til pre-round-buy-state.
 */
export const DEFAULT_AUTO_DISMISS_MS = 10_000;

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
@keyframes eor-countdown {
  from { width: 100%; }
  to   { width: 0%; }
}
.eor-btn-primary:hover {
  background: linear-gradient(180deg, #f5c35a 0%, #d89532 100%) !important;
  transform: translateY(-1px);
  box-shadow: 0 10px 28px rgba(245,184,65,0.4) !important;
}
.eor-btn-primary:active { transform: translateY(0); }
.eor-btn-secondary:hover {
  background: rgba(255,255,255,0.08) !important;
  border-color: rgba(255,255,255,0.18) !important;
}
`;
  document.head.appendChild(s);
}

function formatKr(n: number): string {
  return n.toLocaleString("no-NO").replace(/,/g, " ");
}

/**
 * Year of the round-end. The reason matters for retail bingo UX:
 *   - BINGO_CLAIMED: "Fullt Hus er vunnet — spillet er ferdig"
 *   - MAX_DRAWS_REACHED / DRAW_BAG_EMPTY: "Alle baller trukket — spillet er ferdig"
 *   - MANUAL_END: "Spillet ble avsluttet av admin"
 *   - SYSTEM_ERROR: "Spillet ble avbrutt"
 */
function formatHeader(endedReason: string | undefined): {
  title: string;
  subtitle: string;
} {
  // Tobias prod-incident 2026-04-29: subtitle MÅ skille mellom faktisk
  // grunn for slutt slik at MAX_DRAWS-runder ikke feilaktig viser
  // "Fullt Hus er vunnet". Bug-trigger: når Phase 5 (Fullt Hus) ikke
  // kunne auto-claimes (f.eks. test-hall der bypass kjører videre, eller
  // recovery-edge-case med pause-state), ble runden avsluttet på
  // MAX_DRAWS_REACHED — overlay må da være ærlig om at fullt hus ikke
  // ble offisielt levert.
  switch (endedReason) {
    case "BINGO_CLAIMED":
      return {
        title: "Spillet er ferdig",
        subtitle: "Fullt Hus er vunnet — vinnerne er kåret",
      };
    case "MAX_DRAWS_REACHED":
    case "DRAW_BAG_EMPTY":
      return {
        title: "Spillet er ferdig",
        subtitle: "Alle baller trukket — runden er slutt",
      };
    case "MANUAL_END":
      return {
        title: "Spillet er avsluttet",
        subtitle: "Runden ble avsluttet",
      };
    case "SYSTEM_ERROR":
      return {
        title: "Spillet ble avbrutt",
        subtitle: "Eventuelle gevinster utbetales automatisk",
      };
    default:
      return {
        title: "Spillet er ferdig",
        subtitle: "Vinnerne er kåret",
      };
  }
}

/** Mini-game-resultat-summary klar for visning. Engine sender beløp i øre. */
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
  /** Auto-dismiss vindu i ms. Default DEFAULT_AUTO_DISMISS_MS. */
  autoDismissMs?: number;
  /**
   * Når true: vis "Neste runde starter om N sekunder"-tekst og samme tidspunkt
   * som auto-dismiss. False (default): vis "Klar for neste runde"-knapp uten
   * countdown — bruker må klikke for å gå videre.
   */
  showAutoRoundCountdown?: boolean;
  /** "Klar for neste runde" → return to pre-round-buy state (uten å auto-arme). */
  onReadyForNextRound: () => void;
  /** "Tilbake til lobby" → emit lobby-navigation. */
  onBackToLobby: () => void;
  /**
   * Auto-dismiss callback. Default: samme som onReadyForNextRound, men
   * kallere kan overstyre (f.eks. når auto-round flag styrer transition).
   */
  onAutoDismiss?: () => void;
}

export class Game1EndOfRoundOverlay {
  private root: HTMLDivElement | null = null;
  private parent: HTMLElement;
  private autoDismissTimer: ReturnType<typeof setTimeout> | null = null;
  /** Public for tests. */
  private currentSummary: Game1EndOfRoundSummary | null = null;
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
   * Mount overlay og start auto-dismiss timer. Idempotent — kall med ny
   * summary lukker forrige instans først (re-render på reconnect dekkes
   * av samme path).
   */
  show(summary: Game1EndOfRoundSummary): void {
    this.hide();
    this.currentSummary = summary;
    this.visible = true;

    const autoDismissMs = summary.autoDismissMs ?? DEFAULT_AUTO_DISMISS_MS;
    const showCountdown = summary.showAutoRoundCountdown ?? false;
    const ownTotal = this.computeOwnTotal(summary);
    const header = formatHeader(summary.endedReason);

    const root = document.createElement("div");
    Object.assign(root.style, {
      position: "fixed",
      inset: "0",
      zIndex: "1000",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      // Distinct background-tint vs LoadingOverlay (rgba(0,0,0,0.7)).
      // Mørk-rød radial signaliserer "round done — vinner-scene" og er
      // visuelt forskjellig fra reconnect-spinner-bakgrunnen.
      background:
        "radial-gradient(ellipse at center, #2a1014 0%, #160808 60%, #0a0405 100%)",
      fontFamily: "'Poppins', system-ui, sans-serif",
      color: "#f4e8d0",
      padding: "32px 16px",
      animation: "eor-fade-in 0.32s ease-out both",
    });
    // ARIA — annonser oppsummering til skjermlesere.
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-labelledby", "eor-title");
    root.setAttribute("data-testid", "game1-end-of-round-overlay");

    // ── Card ──────────────────────────────────────────────────────────
    const card = document.createElement("div");
    Object.assign(card.style, {
      position: "relative",
      width: "100%",
      maxWidth: "520px",
      maxHeight: "calc(100vh - 64px)",
      overflow: "auto",
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
      width: "64px",
      height: "64px",
      margin: "0 auto 18px",
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

    // Title + subtitle
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
    card.appendChild(titleEl);

    const subtitleEl = document.createElement("div");
    subtitleEl.textContent = header.subtitle;
    Object.assign(subtitleEl.style, {
      fontSize: "14px",
      fontWeight: "500",
      color: "rgba(244,232,208,0.72)",
      marginBottom: "22px",
    });
    card.appendChild(subtitleEl);

    // Own total (din total denne runden)
    const ownTotalEl = document.createElement("div");
    Object.assign(ownTotalEl.style, {
      fontSize: "13px",
      fontWeight: "600",
      color: "rgba(244,232,208,0.65)",
      letterSpacing: "0.04em",
      textTransform: "uppercase",
      marginBottom: "4px",
    });
    ownTotalEl.textContent = "Din gevinst denne runden";
    card.appendChild(ownTotalEl);

    const ownAmountEl = document.createElement("div");
    ownAmountEl.setAttribute("data-testid", "eor-own-total");
    Object.assign(ownAmountEl.style, {
      fontSize: "44px",
      fontWeight: "900",
      color: ownTotal > 0 ? "#f5c842" : "rgba(244,232,208,0.55)",
      lineHeight: "1",
      marginBottom: "26px",
      letterSpacing: "-0.02em",
    });
    ownAmountEl.textContent = `${formatKr(ownTotal)} kr`;
    card.appendChild(ownAmountEl);

    // ── Patterns table ────────────────────────────────────────────────
    const patternsBox = this.buildPatternsTable(summary);
    card.appendChild(patternsBox);

    // Lucky number
    if (typeof summary.luckyNumber === "number") {
      const luckyEl = document.createElement("div");
      luckyEl.setAttribute("data-testid", "eor-lucky-number");
      Object.assign(luckyEl.style, {
        marginTop: "12px",
        fontSize: "13px",
        fontWeight: "600",
        color: "rgba(244,232,208,0.78)",
      });
      luckyEl.textContent = `Lykketall: ${summary.luckyNumber}`;
      card.appendChild(luckyEl);
    }

    // Mini-game-result
    const miniGameLabel = formatMiniGameLabel(summary.miniGameResult ?? null);
    if (miniGameLabel) {
      const miniGameEl = document.createElement("div");
      miniGameEl.setAttribute("data-testid", "eor-mini-game");
      Object.assign(miniGameEl.style, {
        marginTop: "8px",
        fontSize: "13px",
        fontWeight: "600",
        color: "rgba(244,232,208,0.78)",
      });
      miniGameEl.textContent = miniGameLabel;
      card.appendChild(miniGameEl);
    }

    // ── Buttons ───────────────────────────────────────────────────────
    const btnRow = document.createElement("div");
    Object.assign(btnRow.style, {
      display: "flex",
      gap: "12px",
      justifyContent: "center",
      flexWrap: "wrap",
      marginTop: "26px",
    });

    const readyBtn = document.createElement("button");
    readyBtn.type = "button";
    readyBtn.className = "eor-btn-primary";
    readyBtn.setAttribute("data-testid", "eor-ready-btn");
    readyBtn.textContent = showCountdown
      ? this.computeCountdownLabel(autoDismissMs)
      : "Klar for neste runde";
    Object.assign(readyBtn.style, {
      flex: "1 1 200px",
      maxWidth: "260px",
      padding: "14px 24px",
      fontSize: "15px",
      fontWeight: "700",
      fontFamily: "inherit",
      color: "#1a0808",
      background: "linear-gradient(180deg, #f5b841 0%, #c88922 100%)",
      border: "none",
      borderRadius: "12px",
      cursor: "pointer",
      letterSpacing: "0.02em",
      boxShadow: "0 6px 20px rgba(245,184,65,0.25)",
      transition: "all 180ms ease",
    });
    readyBtn.addEventListener("click", () => {
      this.hide();
      summary.onReadyForNextRound();
    });
    btnRow.appendChild(readyBtn);

    const lobbyBtn = document.createElement("button");
    lobbyBtn.type = "button";
    lobbyBtn.className = "eor-btn-secondary";
    lobbyBtn.setAttribute("data-testid", "eor-lobby-btn");
    lobbyBtn.textContent = "Tilbake til lobby";
    Object.assign(lobbyBtn.style, {
      flex: "1 1 180px",
      maxWidth: "200px",
      padding: "14px 20px",
      fontSize: "14px",
      fontWeight: "600",
      fontFamily: "inherit",
      color: "rgba(244,232,208,0.85)",
      background: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(255,255,255,0.1)",
      borderRadius: "12px",
      cursor: "pointer",
      transition: "all 180ms ease",
    });
    lobbyBtn.addEventListener("click", () => {
      this.hide();
      summary.onBackToLobby();
    });
    btnRow.appendChild(lobbyBtn);

    card.appendChild(btnRow);

    // ── Auto-dismiss progress bar (visuell countdown) ─────────────────
    if (showCountdown) {
      const progressTrack = document.createElement("div");
      Object.assign(progressTrack.style, {
        position: "relative",
        height: "3px",
        marginTop: "18px",
        background: "rgba(255,255,255,0.06)",
        borderRadius: "999px",
        overflow: "hidden",
      });
      const progressBar = document.createElement("div");
      Object.assign(progressBar.style, {
        position: "absolute",
        inset: "0 auto 0 0",
        background: "linear-gradient(90deg, #f5b841, #c88922)",
        animation: `eor-countdown ${autoDismissMs}ms linear forwards`,
      });
      progressTrack.appendChild(progressBar);
      card.appendChild(progressTrack);
    }

    root.appendChild(card);
    this.parent.appendChild(root);
    this.root = root;

    // Auto-dismiss
    this.autoDismissTimer = setTimeout(() => {
      this.hide();
      const cb = summary.onAutoDismiss ?? summary.onReadyForNextRound;
      cb();
    }, autoDismissMs);
  }

  hide(): void {
    if (this.autoDismissTimer !== null) {
      clearTimeout(this.autoDismissTimer);
      this.autoDismissTimer = null;
    }
    if (this.root) {
      this.root.remove();
      this.root = null;
    }
    this.currentSummary = null;
    this.visible = false;
  }

  destroy(): void {
    this.hide();
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
      gap: "8px",
      textAlign: "left",
    });

    if (summary.patternResults.length === 0) {
      const empty = document.createElement("div");
      Object.assign(empty.style, {
        padding: "12px",
        fontSize: "13px",
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
        summary.myPlayerId !== null &&
        winnerIds.includes(summary.myPlayerId);
      const winnerCount = r.winnerCount ?? winnerIds.length;
      Object.assign(row.style, {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "10px 14px",
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
        borderRadius: "10px",
      });

      const left = document.createElement("div");
      Object.assign(left.style, {
        display: "flex",
        flexDirection: "column",
        gap: "2px",
      });

      const nameEl = document.createElement("div");
      Object.assign(nameEl.style, {
        fontSize: "14px",
        fontWeight: "700",
        color: r.isWon ? "#f4e8d0" : "rgba(244,232,208,0.55)",
      });
      nameEl.textContent = r.patternName;
      left.appendChild(nameEl);

      const winnerLabelEl = document.createElement("div");
      Object.assign(winnerLabelEl.style, {
        fontSize: "12px",
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
        fontSize: "16px",
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

  private computeCountdownLabel(autoDismissMs: number): string {
    const seconds = Math.max(1, Math.round(autoDismissMs / 1000));
    return `Neste runde om ${seconds} s`;
  }
}
