/**
 * DebugEventLogPanel — utvidet debug-HUD med real-time event-log + dump
 * (Tobias-direktiv 2026-05-12).
 *
 * Mounter et fast-position-panel under det eksisterende debug-HUD-et
 * (top-right, så de ikke kolliderer). Panel-en inneholder:
 *   - Scrollable event-log (siste 50 events, auto-scroll til bunn)
 *   - Filter-toggle: alle / user.* / api.* / socket.* / state.*
 *   - "Dump diagnose"-knapp — eksporterer JSON-fil til Tobias
 *   - "Clear log"-knapp — tøm bufferen
 *   - Skjul/vis-toggle via Ctrl+Alt+D
 *
 * Aktiveres KUN når `?debug=full` i URL (Tobias-direktiv 2026-05-15).
 * Tidligere `?debug=1`/`?debug=true` og localStorage `DEBUG_SPILL1_DRAWS` er
 * fjernet som triggers fordi de lekte til prod-brukere og brøt full
 * spillopplevelse. Mountes via `mountDebugHud()` i Game1Controller — har
 * samme gate. Default OFF for full spillopplevelse.
 */

import {
  getEventTracker,
  type EventTracker,
  type TrackedEvent,
} from "./EventTracker.js";

type FilterMode = "all" | "user" | "api" | "socket" | "state";

const MAX_VISIBLE_EVENTS = 50;

/** Hjelp PM-agent å skille rapport-status-meldinger i UI fra log-status. */
export interface BugReportSubmitOpts {
  /** Token til /api/_dev/debug/bug-report (samme som streamer-token). */
  token?: string;
  /** Override fetch for tester. */
  fetchImpl?: typeof fetch;
  /** Brukerens egen melding (notes-felt). Hvis ikke gitt — prompt() i UI. */
  notes?: string;
  /** Tittel — hvis ikke gitt brukes en auto-generert basert på screen. */
  title?: string;
  /** Hent klient-state for rapport. Hvis udefinert sendes null. */
  collectClientState?: () => unknown;
  /** Hent currentScreen. */
  collectCurrentScreen?: () => string | null;
  /** Hent siste user-action. */
  collectLastUserAction?: () => string | null;
}

export class DebugEventLogPanel {
  private rootEl: HTMLDivElement | null = null;
  private logEl: HTMLDivElement | null = null;
  private statusEl: HTMLDivElement | null = null;
  private bugReportStatusEl: HTMLDivElement | null = null;
  private tracker: EventTracker;
  private unsubscribe: (() => void) | null = null;
  private filter: FilterMode = "all";
  private hidden = false;
  private keyboardHandler: ((e: KeyboardEvent) => void) | null = null;
  private bugReportOpts: BugReportSubmitOpts = {};

  constructor(tracker: EventTracker = getEventTracker()) {
    this.tracker = tracker;
  }

  /**
   * Konfigurer bug-report-knappen. Kalles av Game1Controller med token
   * + collectors for klient-state / current-screen / last-action.
   */
  setBugReportOptions(opts: BugReportSubmitOpts): void {
    this.bugReportOpts = { ...this.bugReportOpts, ...opts };
  }

  /** Idempotent — kan kalles flere ganger uten skade. */
  mount(): void {
    if (typeof document === "undefined") return;
    if (this.rootEl) return;

    const root = document.createElement("div");
    root.id = "spill1-debug-event-log-panel";
    root.style.cssText = [
      "position: fixed",
      "top: 8px",
      "left: 8px",
      "z-index: 999998",
      "background: rgba(0, 0, 0, 0.92)",
      "color: #0f0",
      "font-family: ui-monospace, SFMono-Regular, Menlo, monospace",
      "font-size: 11px",
      "line-height: 1.35",
      "padding: 8px",
      "border-radius: 6px",
      "border: 1px solid #0f0",
      "width: 480px",
      "max-width: 50vw",
      "max-height: 60vh",
      "display: flex",
      "flex-direction: column",
      "gap: 6px",
      "box-shadow: 0 4px 16px rgba(0,0,0,0.6)",
    ].join(";");

    // Header med filter + dump-knapper.
    const header = document.createElement("div");
    header.style.cssText = [
      "display: flex",
      "align-items: center",
      "gap: 6px",
      "flex-wrap: wrap",
      "border-bottom: 1px solid #0a0",
      "padding-bottom: 4px",
    ].join(";");

    const title = document.createElement("strong");
    title.textContent = "📋 EVENT-LOG";
    title.style.cssText = "color: #0f0; font-weight: 700; flex: 0 0 auto;";
    header.appendChild(title);

    // Filter-pills.
    const filterContainer = document.createElement("div");
    filterContainer.style.cssText = "display: flex; gap: 3px; flex: 1 1 auto;";
    const filters: FilterMode[] = ["all", "user", "api", "socket", "state"];
    const pillButtons = new Map<FilterMode, HTMLButtonElement>();
    for (const mode of filters) {
      const btn = this.makePill(mode);
      btn.addEventListener("click", () => {
        this.filter = mode;
        for (const [m, b] of pillButtons) {
          this.applyPillStyle(b, m === mode);
        }
        this.render();
      });
      pillButtons.set(mode, btn);
      filterContainer.appendChild(btn);
    }
    header.appendChild(filterContainer);

    // 🔴 Rapporter bug nå — prominent rød knapp som bundler alt til PM.
    const reportBugBtn = this.makeReportBugButton();
    reportBugBtn.addEventListener("click", () => this.handleReportBug());
    header.appendChild(reportBugBtn);

    // Dump + Clear knapper.
    const dumpBtn = this.makeActionButton("⬇ Dump", "Last ned JSON-rapport");
    dumpBtn.addEventListener("click", () => this.handleDump());
    header.appendChild(dumpBtn);

    const clearBtn = this.makeActionButton("✕ Clear", "Tøm event-log");
    clearBtn.addEventListener("click", () => this.handleClear());
    header.appendChild(clearBtn);

    root.appendChild(header);

    // Bug-report-status-row (kortvarig melding etter "Rapporter bug"-klikk).
    const bugStatus = document.createElement("div");
    bugStatus.style.cssText =
      "color: #f88; font-size: 10px; flex: 0 0 auto; min-height: 12px;";
    root.appendChild(bugStatus);
    this.bugReportStatusEl = bugStatus;

    // Status-row (events-count + droppedCount).
    const status = document.createElement("div");
    status.style.cssText = "color: #8f8; font-size: 10px; flex: 0 0 auto;";
    root.appendChild(status);
    this.statusEl = status;

    // Scrollable log-viewport.
    const log = document.createElement("div");
    log.style.cssText = [
      "flex: 1 1 auto",
      "overflow-y: auto",
      "overflow-x: hidden",
      "background: rgba(0, 50, 0, 0.15)",
      "padding: 4px",
      "border-radius: 4px",
      "font-size: 10px",
      "white-space: pre-wrap",
      "word-break: break-word",
    ].join(";");
    root.appendChild(log);
    this.logEl = log;

    document.body.appendChild(root);
    this.rootEl = root;

    // Subscribe på nye events.
    this.unsubscribe = this.tracker.subscribe(() => this.render());

    // Keyboard-toggle: Ctrl+Alt+D.
    this.keyboardHandler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        this.toggleVisibility();
      }
    };
    window.addEventListener("keydown", this.keyboardHandler);

    this.render();
  }

  /** Idempotent. */
  unmount(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    if (this.keyboardHandler && typeof window !== "undefined") {
      window.removeEventListener("keydown", this.keyboardHandler);
      this.keyboardHandler = null;
    }
    if (this.rootEl) {
      this.rootEl.remove();
      this.rootEl = null;
      this.logEl = null;
      this.statusEl = null;
    }
  }

  /** Synlig/skjult-toggle. Brukes av Ctrl+Alt+D-handler. */
  private toggleVisibility(): void {
    if (!this.rootEl) return;
    this.hidden = !this.hidden;
    this.rootEl.style.display = this.hidden ? "none" : "flex";
  }

  private render(): void {
    if (!this.logEl || !this.statusEl) return;

    const events = this.tracker.getEvents();
    const filtered = this.applyFilter(events);
    const slice = filtered.slice(-MAX_VISIBLE_EVENTS);

    this.statusEl.textContent =
      `${events.length} events i buffer (viser ${slice.length} etter filter "${this.filter}").` +
      ` Trykk Ctrl+Alt+D for å skjule.`;

    this.logEl.innerHTML = slice.map((ev) => this.formatEvent(ev)).join("\n");
    // Auto-scroll til bunn.
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  private applyFilter(events: TrackedEvent[]): TrackedEvent[] {
    if (this.filter === "all") return events;
    const prefix = `${this.filter}.`;
    return events.filter((e) => e.type.startsWith(prefix));
  }

  private formatEvent(ev: TrackedEvent): string {
    const time = ev.iso.slice(11, 23); // HH:MM:SS.sss
    const color = this.colorForType(ev.type);
    const payloadStr = formatPayload(ev.payload);
    const trace = ev.traceId ? ` traceId=${ev.traceId.slice(0, 8)}…` : "";
    return (
      `<span style="color:#888">${escapeHtml(time)}</span> ` +
      `<span style="color:${color};font-weight:600">${escapeHtml(ev.type)}</span> ` +
      `<span style="color:#aaa">${escapeHtml(trace)}</span>\n` +
      `  <span style="color:#cfc">${escapeHtml(payloadStr)}</span>`
    );
  }

  private colorForType(type: string): string {
    if (type.startsWith("user.")) return "#fc6";
    if (type.startsWith("api.")) return "#6cf";
    if (type.startsWith("socket.")) return "#c6f";
    if (type.startsWith("state.") || type.startsWith("lobby.")) return "#cfc";
    if (type.startsWith("error.")) return "#f66";
    return "#0f0";
  }

  private handleDump(): void {
    try {
      const report = this.tracker.export();
      const json = JSON.stringify(report, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const ts = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .slice(0, 19);
      const filename = `spillorama-debug-${ts}.json`;
      triggerDownload(blob, filename);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[DebugEventLogPanel] Dump feilet:", err);
      // Fallback: skriv til console hvis fil-download feiler.
      // eslint-disable-next-line no-console
      console.log("[DEBUG-EXPORT]", this.tracker.export());
    }
  }

  private handleClear(): void {
    this.tracker.clear();
    this.render();
  }

  /**
   * "Rapporter bug nå" — sender klient-state + siste events + session-context
   * til backend som genererer en samlet markdown-rapport på disk.
   *
   * Strategi:
   *   1. Spør brukeren om notater (kort prompt).
   *   2. Track event `bug.report.triggered` lokalt (havner i samme rapport).
   *   3. Bundle klient-state + lastEvents + session-context.
   *   4. POST til /api/_dev/debug/bug-report?token=<TOKEN>.
   *   5. Vis bekreftelse + reportPath i UI.
   */
  private async handleReportBug(): Promise<void> {
    const opts = this.bugReportOpts;
    const token = opts.token?.trim();

    if (!token) {
      this.showBugReportStatus(
        "⚠️ Bug-rapport-token mangler. Server-rapport sendt ikke. (Se klient-konsoll for fallback-JSON.)",
        "warn",
      );
      // Fallback: dump JSON lokalt
      this.handleDump();
      return;
    }

    // Prompt for notes (kort, ikke-blokkerende erstattbar i framtid)
    let notes = opts.notes;
    if (typeof notes !== "string" && typeof window !== "undefined") {
      const prompted = window.prompt(
        "Beskriv buggen kort (1-2 setninger). Trykk Avbryt for å droppe.",
        "",
      );
      if (prompted === null) {
        // Brukeren avbrøt
        this.showBugReportStatus("Avbrutt.", "info");
        return;
      }
      notes = prompted;
    }

    // Sleng track før vi sender — slik at notes er med i events også
    const triggeredAt = Date.now();
    try {
      this.tracker.track("error.client", {
        kind: "bug.report.triggered",
        notes,
        triggeredAt,
      });
    } catch {
      /* fail-soft */
    }

    // Bygg klient-state + screen-info
    const clientState =
      typeof opts.collectClientState === "function"
        ? safeCall(opts.collectClientState)
        : null;
    const currentScreen =
      typeof opts.collectCurrentScreen === "function"
        ? safeCallString(opts.collectCurrentScreen)
        : null;
    const lastUserAction =
      typeof opts.collectLastUserAction === "function"
        ? safeCallString(opts.collectLastUserAction)
        : null;

    const title =
      opts.title?.trim() ||
      `Bug-rapport ${currentScreen ?? "(screen-ukjent)"} — ${new Date(triggeredAt).toISOString().slice(11, 19)}`;

    const sessionContext = this.tracker.getSessionContext();
    const lastEvents = this.tracker.getEvents().slice(-200);

    const body = {
      title,
      notes,
      sessionContext,
      clientState,
      currentScreen,
      lastUserAction,
      lastEvents,
      url:
        typeof window !== "undefined" && window.location
          ? window.location.href
          : "(unknown)",
      userAgent:
        typeof navigator !== "undefined" ? navigator.userAgent : "(unknown)",
    };

    this.showBugReportStatus("⏳ Sender rapport…", "info");

    const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    try {
      const url = `/api/_dev/debug/bug-report?token=${encodeURIComponent(token)}`;
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        this.showBugReportStatus(
          `❌ Server avslo (HTTP ${response.status}): ${text.slice(0, 120)}`,
          "warn",
        );
        return;
      }
      const json = (await response.json()) as {
        ok: boolean;
        data?: { reportPath?: string; sizeBytes?: number };
      };
      if (json.ok && json.data?.reportPath) {
        this.showBugReportStatus(
          `✅ Rapport sendt — PM-agenten har fått data. (${json.data.reportPath}, ${json.data.sizeBytes ?? "?"} bytes)`,
          "ok",
        );
      } else {
        this.showBugReportStatus("✅ Rapport sendt.", "ok");
      }
    } catch (err) {
      this.showBugReportStatus(
        `❌ Network-feil: ${err instanceof Error ? err.message : String(err)}`,
        "warn",
      );
    }
  }

  private showBugReportStatus(
    text: string,
    level: "ok" | "warn" | "info",
  ): void {
    if (!this.bugReportStatusEl) return;
    const colorMap = { ok: "#0f0", warn: "#f88", info: "#fc6" };
    this.bugReportStatusEl.style.color = colorMap[level];
    this.bugReportStatusEl.textContent = text;
    // Auto-clear etter 12 sek for ok-meldinger
    if (level === "ok") {
      const el = this.bugReportStatusEl;
      setTimeout(() => {
        if (el && el.textContent === text) {
          el.textContent = "";
        }
      }, 12000);
    }
  }

  private makeReportBugButton(): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.textContent = "📸 Rapporter bug";
    btn.title =
      "Send komplett bug-rapport til PM-agenten (klient-state + events + DB + logs)";
    btn.setAttribute("data-testid", "report-bug-now");
    btn.style.cssText = [
      "background: #b8281f",
      "color: #fff",
      "font-weight: 700",
      "border: 1px solid #ff5c5c",
      "border-radius: 4px",
      "padding: 4px 10px",
      "font-size: 11px",
      "font-family: inherit",
      "cursor: pointer",
      "flex: 0 0 auto",
      "box-shadow: 0 2px 4px rgba(255,92,92,0.4)",
    ].join(";");
    return btn;
  }

  private makePill(mode: FilterMode): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.textContent = mode;
    this.applyPillStyle(btn, mode === this.filter);
    return btn;
  }

  private applyPillStyle(btn: HTMLButtonElement, active: boolean): void {
    btn.style.cssText = [
      "background: " + (active ? "#0f0" : "transparent"),
      "color: " + (active ? "#000" : "#0f0"),
      "border: 1px solid #0f0",
      "border-radius: 3px",
      "padding: 2px 6px",
      "font-size: 10px",
      "font-family: inherit",
      "cursor: pointer",
      "flex: 0 0 auto",
    ].join(";");
  }

  private makeActionButton(text: string, title: string): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.textContent = text;
    btn.title = title;
    btn.style.cssText = [
      "background: rgba(0, 200, 0, 0.2)",
      "color: #fff",
      "border: 1px solid #0f0",
      "border-radius: 3px",
      "padding: 2px 8px",
      "font-size: 10px",
      "font-family: inherit",
      "cursor: pointer",
      "flex: 0 0 auto",
    ].join(";");
    return btn;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function formatPayload(payload: Record<string, unknown>): string {
  try {
    const json = JSON.stringify(payload);
    if (json.length <= 240) return json;
    return json.slice(0, 240) + "…";
  } catch {
    return "(unserializable)";
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeCall(fn: () => unknown): unknown {
  try {
    return fn();
  } catch {
    return null;
  }
}

function safeCallString(fn: () => unknown): string | null {
  try {
    const v = fn();
    return typeof v === "string" ? v : v === null || v === undefined ? null : String(v);
  } catch {
    return null;
  }
}

function triggerDownload(blob: Blob, filename: string): void {
  if (typeof document === "undefined" || typeof URL === "undefined") return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  // Skjul fra DOM, kun for trigger.
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Cleanup URL etter neste tick — gir browseren tid til å starte download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
