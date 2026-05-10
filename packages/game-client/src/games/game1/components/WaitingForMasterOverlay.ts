/**
 * Spillerklient-rebuild Fase 3 (2026-05-10) — "Venter på master"-overlay.
 *
 * Bakgrunn (Tobias-direktiv 2026-05-09, gjentatt i
 * PM_ONBOARDING_PLAYBOOK.md §2.3):
 *   "Når man kommer inn i spill 1 som kunde så skal man alltid da se neste
 *    spill som er planlagt. Dette spillet skal da starte når master har
 *    trykket på knappen. Det skal aldri være noen andre views i det live
 *    rommet en neste planlagte spill."
 *
 *   Tidligere oppførsel: klient leste `state.millisUntilNextStart` og
 *   startet en lokal countdown automatisk — UTEN at master hadde trigget
 *   runden. Det førte til at spilleren så et "..." eller en feil-aktig
 *   countdown selv om master ikke hadde startet noe.
 *
 *   Fase 3-fix: vis ALLTID "Bingo (venter på master)" når
 *   `lobby.overallStatus !== "running"`, uavhengig av om
 *   `state.gameStatus` er WAITING/ENDED/NONE og uavhengig av
 *   `state.millisUntilNextStart`. Master clicks Start →
 *   `overallStatus="running"` → overlayet dismisses → klient ser
 *   live-rundens countdown/draws (server-pushed via `room:update`).
 *
 * Bevisst design-valg:
 *   - **HTML-overlay, ikke Pixi-skjerm**: Vi vil at overlay skal kunne
 *     vises uten Pixi-stage-koordinasjon. Stilmessig matcher vi
 *     `Game1LobbyFallback`-overlay-en (mørk semi-transparent backdrop
 *     med stor headline + body) men er litt mindre intrusiv siden
 *     spilleren faktisk har joinet rommet — BuyPopup må kunne åpnes
 *     UNDER overlay-en, og overlay-en bruker `pointer-events: none`
 *     på selve backdrop-en for å la BuyPopup-trigger-knappen være
 *     klikkbar.
 *   - **Read-only på state**: Overlay-en mottar `WaitingForMasterDisplayState`
 *     via `update(state)`. Den eier ikke socket-listeners eller HTTP-fetch
 *     — `Game1Controller` driver lobby-state og kaller `update`/`show`/
 *     `hide`. Dette gjør overlay-en lett å unit-teste i happy-dom uten
 *     mocks av sockets.
 *   - **Idempotent show/hide**: Caller kan trygt kalle `show()` flere
 *     ganger — kun første mount-er DOM-noder. `hide()` er også
 *     idempotent.
 *   - **Persistent mellom runder**: Etter Fullt Hus dismisses overlay-en
 *     ikke automatisk — Game1Controller observerer `overallStatus` og
 *     viser overlay-en på nytt så snart serveren signaliserer at neste
 *     runde venter på master.
 *
 * Tester:
 *   - `WaitingForMasterOverlay.test.ts` dekker mount/unmount, idempotens,
 *     update av display-name + plan-position, og at backdrop ikke
 *     blokkerer klikk (pointer-events).
 *
 * Refs:
 *   - `Game1LobbyFallback` (apps/backend-failure pre-join overlay)
 *   - `LobbyStateBinding.getCatalogDisplayName()` for fallback-tekst
 *   - `Spill1LobbyState.overallStatus` (shared-types/api.ts)
 */

/**
 * Felter som overlay-en bruker for å rendre "venter på master"-meldingen.
 * Optional fields → fallback-tekst.
 */
export interface WaitingForMasterDisplayState {
  /**
   * Display-navn på neste planlagte spill (eks "Bingo", "Innsatsen",
   * "Oddsen 55"). Default "Bingo".
   */
  catalogDisplayName?: string | null;
  /** 1-basert posisjon i planen, eller null. */
  currentPosition?: number | null;
  /** Antall items i planen, eller null. */
  totalPositions?: number | null;
  /**
   * Plan-navn (eks "Pilot Demo — alle 13 spill"). Vises som dempet
   * sub-headline. Optional.
   */
  planName?: string | null;
}

export interface WaitingForMasterOverlayOptions {
  /** Container DOM-noden overlay-en mountes i. Default: `document.body`. */
  container?: HTMLElement;
}

/**
 * "Venter på master"-overlay som vises mellom runder eller før master
 * starter første runde. Caller (Game1Controller) eier lifecycle og
 * kaller `show(state)` / `update(state)` / `hide()` etter behov.
 *
 * Designet for å sitte over PlayScreen UTEN å blokkere BuyPopup eller
 * andre interaktive elementer. Sentrum-area (der CenterBall ligger)
 * dekkes av en dempet "venter på master"-meldingsboks.
 */
export class WaitingForMasterOverlay {
  private readonly container: HTMLElement;

  private overlay: HTMLDivElement | null = null;
  private headlineEl: HTMLDivElement | null = null;
  private subheadlineEl: HTMLDivElement | null = null;
  private planInfoEl: HTMLDivElement | null = null;

  private currentState: WaitingForMasterDisplayState = {};
  private destroyed = false;

  constructor(opts: WaitingForMasterOverlayOptions = {}) {
    this.container = opts.container ?? document.body;
  }

  /** True hvis overlay-en er mounted (DOM-noder eksisterer). */
  isVisible(): boolean {
    return this.overlay !== null;
  }

  /**
   * Mount overlay og render `state`. Idempotent — gjentatte kall med
   * samme state er no-op (DOM-noden gjenbrukes; tekst-update via
   * `update`).
   */
  show(state: WaitingForMasterDisplayState = {}): void {
    if (this.destroyed) return;
    if (!this.overlay) {
      this.mount();
    }
    this.update(state);
  }

  /**
   * Oppdater display-state uten å re-mount-e DOM. No-op hvis
   * overlay-en ikke er mounted.
   */
  update(state: WaitingForMasterDisplayState): void {
    if (this.destroyed) return;
    this.currentState = { ...this.currentState, ...state };
    if (!this.overlay) return;
    this.renderText();
  }

  /** Skjul overlay og fjern DOM-noder. Idempotent. */
  hide(): void {
    if (this.destroyed) return;
    if (!this.overlay) return;
    if (this.overlay.parentElement) {
      this.overlay.parentElement.removeChild(this.overlay);
    }
    this.overlay = null;
    this.headlineEl = null;
    this.subheadlineEl = null;
    this.planInfoEl = null;
  }

  /** Permanent cleanup — caller skal ikke bruke instansen etterpå. */
  destroy(): void {
    this.hide();
    this.destroyed = true;
  }

  // ── interne hjelpere ───────────────────────────────────────────────────

  private mount(): void {
    if (this.overlay) return;

    const overlay = document.createElement("div");
    overlay.setAttribute("data-spill1-waiting-for-master", "true");
    // Backdrop er pointer-events: none så BuyPopup og andre interaktive
    // elementer under overlay-en kan klikkes. Selve meldingsboksen er
    // pointer-events: auto for å la fokus-styling fungere uten å trigge
    // klikk (overlay-en har ingen knapper).
    overlay.style.cssText = [
      "position: fixed",
      "inset: 0",
      "display: flex",
      "align-items: center",
      "justify-content: center",
      "pointer-events: none",
      "z-index: 1500",
      "padding: 24px",
      "text-align: center",
    ].join(";");

    const card = document.createElement("div");
    card.style.cssText = [
      "background: rgba(8, 16, 32, 0.78)",
      "color: #fff",
      "padding: 32px 48px",
      "border-radius: 16px",
      "max-width: 480px",
      "pointer-events: auto",
      "box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4)",
      "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    ].join(";");

    const headline = document.createElement("div");
    headline.setAttribute("data-role", "headline");
    headline.style.cssText = [
      "font-size: 32px",
      "font-weight: 700",
      "margin-bottom: 8px",
      "letter-spacing: -0.5px",
    ].join(";");

    const subheadline = document.createElement("div");
    subheadline.setAttribute("data-role", "subheadline");
    subheadline.style.cssText = [
      "font-size: 18px",
      "font-weight: 500",
      "opacity: 0.85",
      "margin-bottom: 12px",
    ].join(";");

    const planInfo = document.createElement("div");
    planInfo.setAttribute("data-role", "plan-info");
    planInfo.style.cssText = [
      "font-size: 14px",
      "opacity: 0.6",
      "line-height: 1.4",
    ].join(";");

    card.appendChild(headline);
    card.appendChild(subheadline);
    card.appendChild(planInfo);
    overlay.appendChild(card);
    this.container.appendChild(overlay);

    this.overlay = overlay;
    this.headlineEl = headline;
    this.subheadlineEl = subheadline;
    this.planInfoEl = planInfo;

    this.renderText();
  }

  private renderText(): void {
    if (!this.headlineEl || !this.subheadlineEl || !this.planInfoEl) return;

    const name = (this.currentState.catalogDisplayName ?? "").trim() || "Bingo";
    this.headlineEl.textContent = name;
    this.subheadlineEl.textContent = "Venter på master";

    // Plan info — only render if we have something meaningful.
    const parts: string[] = [];
    if (
      typeof this.currentState.currentPosition === "number" &&
      typeof this.currentState.totalPositions === "number" &&
      this.currentState.totalPositions > 0
    ) {
      parts.push(
        `Spill ${this.currentState.currentPosition} av ${this.currentState.totalPositions}`,
      );
    }
    if (this.currentState.planName) {
      parts.push(this.currentState.planName);
    }
    this.planInfoEl.textContent = parts.join(" — ");
  }
}
