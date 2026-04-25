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
 */
export class PauseOverlay {
  private backdrop: HTMLDivElement;
  private messageEl: HTMLDivElement;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
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
  }

  show(message?: string): void {
    this.messageEl.textContent = message || "Venter på at admin gjenopptar spillet...";
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    this.visible = true;
    this.backdrop.style.display = "flex";
    // Force layout flush so the opacity transition runs from 0 → 1
    // even if show() follows hide() in the same microtask.
    void this.backdrop.offsetHeight;
    this.backdrop.style.opacity = "1";
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.backdrop.style.opacity = "0";
    if (this.hideTimer !== null) clearTimeout(this.hideTimer);
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
    this.backdrop.remove();
  }
}
