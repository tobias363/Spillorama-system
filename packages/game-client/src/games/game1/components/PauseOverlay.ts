/**
 * Game pause overlay — shown when admin pauses the game.
 *
 * Blocks interaction and shows a centered message.
 * Auto-hides when game is resumed (isPaused becomes false in next room:update).
 *
 * BLINK-FIX (round 3, hazard 1): Auto-pause-flyt etter hver phase-won (Rad 1,
 * Rad 2, Rad 3, Fullt Hus) trigger samtidig pauseOverlay.hide() + ny ball-trekk.
 * En INSTANT removal av en 100%-canvas-overdekkende rgba(0,0,0,0.85)-div mens
 * Pixi-canvas re-rendrer = synlig blink. Vi fader nå opacity 0.4s i stedet for
 * å pop-fjerne display, og holder display:flex til transition er ferdig.
 *
 * MED-11 (Casino Review): Manuell master-pause kan vare 30s-flere minutter,
 * og spillere fikk ingen kontekst — bare "Spillet er pauset". Standard
 * casino-UX viser enten countdown ("Spillet starter om 0:45") eller en
 * konkret status ("Venter på hall-operatør"). Når backend sender
 * `pauseUntil` (ISO-timestamp) viser vi countdown; ellers viser vi en
 * fallback-tekst basert på `pauseReason`.
 */

export interface PauseOverlayShowOptions {
  /** Full free-text message (legacy `pauseMessage` fra GameSnapshot). */
  message?: string;
  /** ISO 8601 timestamp som angir når master forventer å gjenoppta. */
  pauseUntil?: string | null;
  /** Maskinlesbar grunn — brukes til å velge norsk fallback-tekst. */
  pauseReason?: string | null;
}

/** MED-11: Norsk fallback-tekst per `pauseReason`. */
function reasonToNorwegianText(reason: string | null | undefined): string {
  switch ((reason ?? "").toUpperCase()) {
    case "AWAITING_OPERATOR":
      return "Venter på hall-operatør";
    case "AUTO_PAUSE_PHASE_WON":
      return "Kort pause før neste runde";
    case "MANUAL_PAUSE":
    case "MANUAL_PAUSE_5MIN":
    case "MANUAL_PAUSE_2MIN":
    case "MANUAL_PAUSE_1MIN":
    default:
      return "Venter på hall-operatør";
  }
}

/** Format millis-igjen som "M:SS" (eller "0:00" hvis i fortid). */
function formatCountdown(msRemaining: number): string {
  const safe = Math.max(0, Math.floor(msRemaining / 1000));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export class PauseOverlay {
  private backdrop: HTMLDivElement;
  private messageEl: HTMLDivElement;
  /** MED-11: separat element for live countdown (ticker hvert 1s). */
  private countdownEl: HTMLDivElement;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  /** MED-11: setInterval-handle for å tikke countdown ned. */
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private pauseUntilMs: number | null = null;
  private visible = false;

  constructor(container: HTMLElement) {
    this.backdrop = document.createElement("div");
    Object.assign(this.backdrop.style, {
      position: "absolute",
      inset: "0",
      background: "rgba(0,0,0,0.85)",
      display: "none",
      opacity: "0",
      transition: "opacity 0.4s ease",
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "column",
      gap: "16px",
      zIndex: "90",
      pointerEvents: "auto",
    });
    container.appendChild(this.backdrop);

    // Pause icon
    const icon = document.createElement("div");
    icon.innerHTML = `<svg width="48" height="48" viewBox="0 0 24 24" fill="#ffe83d"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>`;
    this.backdrop.appendChild(icon);

    // Title
    const title = document.createElement("div");
    title.textContent = "Spillet er pauset";
    title.style.cssText = "color:#ffe83d;font-size:24px;font-weight:700;";
    this.backdrop.appendChild(title);

    // Message
    this.messageEl = document.createElement("div");
    this.messageEl.style.cssText = "color:#ccc;font-size:16px;text-align:center;max-width:400px;line-height:1.5;";
    this.backdrop.appendChild(this.messageEl);

    // MED-11: countdown — usynlig per default, vises kun når pauseUntil settes
    this.countdownEl = document.createElement("div");
    this.countdownEl.dataset.testid = "pause-countdown";
    this.countdownEl.style.cssText =
      "color:#ffe83d;font-size:32px;font-weight:700;letter-spacing:2px;display:none;";
    this.backdrop.appendChild(this.countdownEl);
  }

  /**
   * MED-11: utvidet signatur. Gammel `show(message?)`-form støttes fortsatt
   * via union — calling code som bare gir en streng oppfører seg som før.
   */
  show(messageOrOptions?: string | PauseOverlayShowOptions): void {
    const opts: PauseOverlayShowOptions =
      typeof messageOrOptions === "string"
        ? { message: messageOrOptions }
        : (messageOrOptions ?? {});

    // Cancel any pending hide-fade
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }

    this.applyContent(opts);

    this.visible = true;
    this.backdrop.style.display = "flex";
    // Force layout flush so the opacity transition runs from 0 → 1
    // even if show() follows hide() in the same microtask.
    void this.backdrop.offsetHeight;
    this.backdrop.style.opacity = "1";
  }

  /**
   * MED-11: oppdater pause-kontekst på et allerede synlig overlay.
   * Brukes når `room:update` kommer inn med nye verdier (f.eks. master har
   * forlenget pausen) — vi vil ikke fade ut + inn igjen.
   */
  updateContent(opts: PauseOverlayShowOptions): void {
    this.applyContent(opts);
  }

  private applyContent(opts: PauseOverlayShowOptions): void {
    // Decide what to render based on what backend sent.
    const fallback = reasonToNorwegianText(opts.pauseReason ?? null);
    const baseMessage = opts.message?.trim() || fallback;
    this.messageEl.textContent = baseMessage;

    // Stop any old countdown ticker
    this.stopCountdownTicker();

    if (opts.pauseUntil) {
      const ts = Date.parse(opts.pauseUntil);
      if (Number.isFinite(ts)) {
        this.pauseUntilMs = ts;
        this.renderCountdown();
        // Tikk hvert 1s — billig nok, og gir en jevn nedtelling
        this.countdownTimer = setInterval(() => this.renderCountdown(), 1000);
        return;
      }
    }

    // Ingen gyldig pauseUntil → skjul countdown-elementet
    this.pauseUntilMs = null;
    this.countdownEl.style.display = "none";
    this.countdownEl.textContent = "";
  }

  private renderCountdown(): void {
    if (this.pauseUntilMs === null) return;
    const remaining = this.pauseUntilMs - Date.now();
    if (remaining <= 0) {
      // Estimat utløpt: ikke skjul overlay (det gjør hide() når server sier
      // isPaused=false), men bytt til fallback-tekst slik at spilleren ser
      // at det er gått over forventet pause-tid.
      this.countdownEl.textContent = "0:00";
      this.countdownEl.style.display = "block";
      // Stop ticker — vi skal ikke fortsette å regne ned i negativt.
      this.stopCountdownTicker();
      // Bytt hovedtekst til fallback for å gi spilleren riktig kontekst.
      this.messageEl.textContent = "Venter på hall-operatør";
      return;
    }
    this.countdownEl.textContent = formatCountdown(remaining);
    this.countdownEl.style.display = "block";
  }

  private stopCountdownTicker(): void {
    if (this.countdownTimer !== null) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.backdrop.style.opacity = "0";
    if (this.hideTimer !== null) clearTimeout(this.hideTimer);
    this.stopCountdownTicker();
    this.pauseUntilMs = null;
    // Match the 0.4s transition; only flip display:none after fade completes
    // so Pixi-canvas isn't unmasked by an instant pop.
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      if (!this.visible) this.backdrop.style.display = "none";
    }, 420);
  }

  isShowing(): boolean {
    return this.visible;
  }

  destroy(): void {
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    this.stopCountdownTicker();
    this.backdrop.remove();
  }
}
