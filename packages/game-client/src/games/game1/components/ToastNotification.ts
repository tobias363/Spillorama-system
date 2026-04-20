/**
 * Toast notification system — matches Unity's UtilityMessagePanel / NotificationBroadcast.
 *
 * Shows temporary messages at the top of the screen for:
 * - Win announcements ("Du vant 100 kr!")
 * - Pattern won by others ("Rad 1 vunnet!")
 * - Error messages
 * - System messages
 *
 * Auto-dismisses after a configurable duration.
 */

export type ToastType = "win" | "info" | "error";

const TOAST_COLORS: Record<ToastType, { bg: string; border: string; text: string }> = {
  win: { bg: "rgba(46,125,50,0.95)", border: "#66bb6a", text: "#fff" },
  info: { bg: "rgba(30,30,30,0.95)", border: "rgba(255,232,61,0.5)", text: "#ffe83d" },
  error: { bg: "rgba(183,28,28,0.95)", border: "#ef5350", text: "#fff" },
};

const DEFAULT_DURATION_MS = 4000;

export class ToastNotification {
  private container: HTMLDivElement;
  private queue: { el: HTMLDivElement; timer: ReturnType<typeof setTimeout> }[] = [];

  constructor(parent: HTMLElement) {
    this.container = document.createElement("div");
    Object.assign(this.container.style, {
      position: "absolute",
      top: "10px",
      left: "50%",
      transform: "translateX(-50%)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: "8px",
      zIndex: "80",
      pointerEvents: "none",
      maxWidth: "90%",
    });
    parent.appendChild(this.container);
  }

  show(message: string, type: ToastType = "info", durationMs = DEFAULT_DURATION_MS): void {
    const colors = TOAST_COLORS[type];
    const el = document.createElement("div");
    Object.assign(el.style, {
      background: colors.bg,
      border: `1.5px solid ${colors.border}`,
      borderRadius: "10px",
      padding: "10px 24px",
      color: colors.text,
      fontSize: "15px",
      fontWeight: "600",
      fontFamily: "inherit",
      textAlign: "center",
      backdropFilter: "blur(4px)",
      boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
      opacity: "0",
      transform: "translateY(-10px)",
      transition: "opacity 0.3s, transform 0.3s",
      pointerEvents: "auto",
      // BIN-696: `pre-line` bevarer `\n` i meldinger som linjeskift
      // (f.eks. "Du vant 1 Rad!\nGevinst: 15 kr"), mens normal
      // whitespace-collapse fortsatt virker for vanlige enkel-linje-
      // toasts. `nowrap` er flyttet bort — tekst wraps naturlig på
      // narrow skjerm nå, noe som også er et UX-plus for lange navn.
      whiteSpace: "pre-line",
    });
    el.textContent = message;
    this.container.appendChild(el);

    // Animate in
    requestAnimationFrame(() => {
      el.style.opacity = "1";
      el.style.transform = "translateY(0)";
    });

    // Auto-dismiss
    const timer = setTimeout(() => this.dismiss(el), durationMs);
    this.queue.push({ el, timer });

    // Limit visible toasts to 3
    while (this.queue.length > 3) {
      const oldest = this.queue.shift();
      if (oldest) {
        clearTimeout(oldest.timer);
        this.removeEl(oldest.el);
      }
    }
  }

  /** Convenience methods */
  win(message: string, durationMs = 5000): void {
    this.show(message, "win", durationMs);
  }

  error(message: string, durationMs = 5000): void {
    this.show(message, "error", durationMs);
  }

  info(message: string, durationMs = DEFAULT_DURATION_MS): void {
    this.show(message, "info", durationMs);
  }

  private dismiss(el: HTMLDivElement): void {
    el.style.opacity = "0";
    el.style.transform = "translateY(-10px)";
    setTimeout(() => this.removeEl(el), 300);
  }

  private removeEl(el: HTMLDivElement): void {
    el.remove();
    this.queue = this.queue.filter((q) => q.el !== el);
  }

  destroy(): void {
    for (const q of this.queue) clearTimeout(q.timer);
    this.queue = [];
    this.container.remove();
  }
}
