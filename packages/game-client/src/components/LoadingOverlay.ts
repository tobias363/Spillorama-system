/**
 * Loading overlay — matches Unity's UtilityLoaderPanel.
 * Shows a centered spinner with optional message text.
 * Used during: room connection, ticket purchase, data fetch.
 *
 * Unity reference:
 * - UtilityLoaderPanel.ShowLoader() / HideLoader()
 * - Game1GamePlayPanel.DisplayLoader(true/false)
 */
export class LoadingOverlay {
  private backdrop: HTMLDivElement;
  private messageEl: HTMLDivElement;

  constructor(container: HTMLElement) {
    this.backdrop = document.createElement("div");
    Object.assign(this.backdrop.style, {
      position: "absolute",
      inset: "0",
      background: "rgba(0,0,0,0.7)",
      display: "none",
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "column",
      gap: "16px",
      zIndex: "100",
      pointerEvents: "auto",
    });
    container.appendChild(this.backdrop);

    // Spinner
    const spinner = document.createElement("div");
    spinner.style.cssText = `
      width:48px;height:48px;
      border:4px solid rgba(255,255,255,0.2);
      border-top-color:#ffe83d;
      border-radius:50%;
      animation:loader-spin 0.8s linear infinite;
    `;
    this.backdrop.appendChild(spinner);

    // Message text
    this.messageEl = document.createElement("div");
    this.messageEl.style.cssText = "color:#ccc;font-size:16px;font-weight:500;";
    this.messageEl.textContent = "Laster...";
    this.backdrop.appendChild(this.messageEl);

    // Inject keyframe (once)
    if (!document.getElementById("loader-spin-style")) {
      const style = document.createElement("style");
      style.id = "loader-spin-style";
      style.textContent = `@keyframes loader-spin { to { transform: rotate(360deg); } }`;
      document.head.appendChild(style);
    }
  }

  show(message = "Laster..."): void {
    this.messageEl.textContent = message;
    this.backdrop.style.display = "flex";
  }

  hide(): void {
    this.backdrop.style.display = "none";
  }

  isShowing(): boolean {
    return this.backdrop.style.display !== "none";
  }

  destroy(): void {
    this.backdrop.remove();
  }
}
