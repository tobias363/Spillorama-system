import { Container, Sprite, Text, Assets, Texture } from "pixi.js";
import gsap from "gsap";
import { getBallAssetPath, enableMipmaps } from "./BallTube.js";

const BALL_SIZE = 170; // mockup .game-number-ring

/** Bridge-state shape used for pause-awareness. */
interface PauseAwareBridge {
  getState(): { isPaused: boolean };
}

/**
 * Large animated bingo ball displayed between the ball-tube and the center
 * panel — mockup `.game-number-ring` (170×170). Swaps the PNG texture on
 * every new draw so the ring colour matches the Bingo75 column of the
 * drawn number.
 *
 * Animation (mockup-parity):
 *  - scale(0.6) + alpha(0) on number swap
 *  - fade/scale back to 1 with back-overshoot (cubic-bezier 0.34, 1.56, 0.64, 1)
 *  - etter scale-in: én kort "bob" (4px yoyo i 2.4s, repeat: 1) som
 *    gir "just-drew"-liv-signal. Tidligere kjørte dette uendelig i idle
 *    (`repeat: -1, yoyo: true`) og trigget per-frame Pixi-redraw på
 *    containeren selv når spillet ikke skjedde noe (round 4 blink-fiks
 *    2026-04-24). Idle = statisk nå; ingen bob ved setNumber/
 *    showWaiting/startCountdown/initial mount.
 *
 * Countdown mode + pause-awareness: unchanged from prior implementation
 * (Game1GamePlayPanel.SocketFlow.cs:672-696 mirrors the freeze).
 *
 * Idle-text-modus (2026-05-11, Tobias-direktiv):
 *  - Når runden ikke er aktiv (`lobbyOverallStatus !== "running"`) skjules
 *    selve ball-sprite + number-text, og to linjer tekst rendres i samme
 *    container:
 *      Linje 1: "Neste spill: {displayName}"
 *      Linje 2: "Kjøp bonger for å være med i trekningen"
 *  - Aktiveres via `setIdleText(displayName)` + `showIdleText()`.
 *  - Deaktiveres automatisk når showNumber/setNumber/startCountdown
 *    kalles (de mutere ut av idle-state).
 *  - Erstatter `WaitingForMasterOverlay` (slettet 2026-05-11). Tobias-
 *    direktivet er at vi IKKE skal ha en separat "venter på master"-
 *    melding — bare "Neste spill" + kjøp-oppfordring der ballen vanligvis
 *    ligger.
 */
export class CenterBall extends Container {
  private ballSprite: Sprite | null = null;
  private currentTextureUrl: string | null = null;
  private numberText: Text;
  private currentNumber: number | null = null;
  private idleTween: gsap.core.Tween | null = null;
  private countdownInterval: ReturnType<typeof setInterval> | null = null;
  private countdownDeadline = 0;
  private countdownRemainingMs = 0;
  private bridge: PauseAwareBridge | null = null;
  private isDestroyed = false;
  /**
   * Base Y position set by PlayScreen. The idle-float tween uses this as
   * the anchor (yoyo's between baseY and baseY-4), so re-triggering the
   * animation mid-yoyo doesn't drift the ball upward over time.
   */
  private baseY: number | null = null;

  /**
   * Idle-text-modus (2026-05-11, Tobias-direktiv). Når aktivt skjules
   * ball + number-text og to linjer rendres i samme posisjon:
   *   - "next-game"-mode (default — `overallStatus === "idle"`):
   *       Linje 1: "Neste spill: {displayName}"  (eks "Neste spill: Bingo")
   *       Linje 2: "Kjøp bonger for å være med i trekningen"
   *   - "closed"-mode (Tobias 2026-05-11, hall-isolation-fix):
   *       Linje 1: "Stengt"
   *       Linje 2: "Ingen aktiv plan i hallen akkurat nå"
   *     Aktiveres når lobby-state returnerer `overallStatus === "closed"`
   *     (hallen er ikke medlem av noen GoH med aktiv plan, eller utenfor
   *     plan-åpningstid). Default-hallen som ikke er del av pilot-GoH-en
   *     skal IKKE vise "Neste spill: Bingo (venter på master)" — den
   *     skal vise "Stengt".
   *
   * Display-name oppdateres via `setIdleText(name)`. Mode toggle styres
   * av `setIdleMode(mode)` + `showIdleText()` / `hideIdleText()`.
   * Mutating-handlinger (showNumber/setNumber/startCountdown) skjuler
   * idle-text automatisk.
   */
  private idleHeadline: Text;
  private idleBody: Text;
  private idleDisplayName = "Bingo";
  private idleVisible = false;
  private idleMode:
    | "next-game"
    | "closed"
    | "waiting-master"
    | "loading" = "next-game";

  constructor(bridge?: PauseAwareBridge) {
    super();
    this.bridge = bridge ?? null;

    this.numberText = new Text({
      text: "",
      style: {
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        fontSize: 50,
        fill: 0x1a0a0a,
        fontWeight: "800",
        align: "center",
        letterSpacing: -0.5,
      },
    });
    this.numberText.anchor.set(0.5);
    this.numberText.x = BALL_SIZE / 2 - 4;
    this.numberText.y = BALL_SIZE / 2 - 1;
    this.addChild(this.numberText);

    // Idle-text linje 1 ("Neste spill: ...") + linje 2 ("Kjøp bonger ...").
    // Skjult som default — `showIdleText()` viser dem og skjuler ball-/
    // number-rendringen.
    this.idleHeadline = new Text({
      text: "",
      style: {
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        fontSize: 22,
        fill: 0xffffff,
        fontWeight: "800",
        align: "center",
        letterSpacing: -0.3,
        wordWrap: true,
        wordWrapWidth: BALL_SIZE + 80,
        dropShadow: { color: 0x000000, alpha: 0.9, blur: 6, distance: 2 },
      },
    });
    this.idleHeadline.anchor.set(0.5);
    this.idleHeadline.x = BALL_SIZE / 2;
    this.idleHeadline.y = BALL_SIZE / 2 - 18;
    this.idleHeadline.visible = false;
    this.addChild(this.idleHeadline);

    this.idleBody = new Text({
      text: "",
      style: {
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        fontSize: 14,
        fill: 0xffffff,
        fontWeight: "600",
        align: "center",
        letterSpacing: 0.1,
        wordWrap: true,
        wordWrapWidth: BALL_SIZE + 80,
        dropShadow: { color: 0x000000, alpha: 0.85, blur: 5, distance: 1 },
      },
    });
    this.idleBody.anchor.set(0.5);
    this.idleBody.x = BALL_SIZE / 2;
    this.idleBody.y = BALL_SIZE / 2 + 22;
    this.idleBody.visible = false;
    this.addChild(this.idleBody);

    // Default sprite — red (central colour for idle/countdown), swapped per
    // drawn number by showNumber/setNumber.
    void this.swapTexture("/web/games/assets/game1/design/balls/red.png");
  }

  private async swapTexture(url: string): Promise<void> {
    if (this.isDestroyed || url === this.currentTextureUrl) return;
    try {
      let tex = Assets.cache.get(url) as Texture | undefined;
      if (!tex) tex = (await Assets.load(url)) as Texture;
      if (this.isDestroyed) return;
      enableMipmaps(tex);
      this.currentTextureUrl = url;
      if (this.ballSprite) {
        this.ballSprite.texture = tex;
      } else {
        this.ballSprite = new Sprite(tex);
        this.ballSprite.width = BALL_SIZE;
        this.ballSprite.height = BALL_SIZE;
        // Hvis idle-text-modus er aktiv da sprite mounter (async race),
        // start sprite-en som skjult. hideIdleText() vil restore visible.
        if (this.idleVisible) this.ballSprite.visible = false;
        this.addChildAt(this.ballSprite, 0);
      }
    } catch {
      console.warn(`[CenterBall] Could not load ${url}`);
    }
  }

  /** Show a new drawn number with mockup-parity scale-in + overshoot. */
  showNumber(number: number): void {
    // Idle-text-mode er ikke kompatibel med live-trekk — skjul tekst og
    // restore ball/number-rendering før animasjonen kjører.
    this.hideIdleText();
    this.stopCountdown();
    this.currentNumber = number;
    this.numberText.text = String(number).padStart(2, "0");
    this.numberText.style.fontSize = 50;
    void this.swapTexture(getBallAssetPath(number));

    this.idleTween?.kill();

    // Mockup: scale 0.6 → 1 over 400ms with back overshoot, alpha 0 → 1.
    this.scale.set(0.6);
    this.alpha = 0;
    gsap.to(this, { alpha: 1, duration: 0.4, ease: "power2.out" });
    gsap.to(this.scale, {
      x: 1,
      y: 1,
      duration: 0.4,
      ease: "back.out(1.7)",
      onComplete: () => this.bobOnce(),
    });
  }

  /** Set number without animation (state restore). */
  setNumber(number: number | null): void {
    this.hideIdleText();
    this.stopCountdown();
    this.currentNumber = number;
    this.numberText.text = number !== null ? String(number).padStart(2, "0") : "";
    this.numberText.style.fontSize = 50;
    if (number !== null) void this.swapTexture(getBallAssetPath(number));
    // Ingen bob — state-restore skal ikke gi "just-drew"-liv-signal.
  }

  getNumber(): number | null {
    return this.currentNumber;
  }

  startCountdown(millisUntilStart: number): void {
    // Countdown betyr at master har trygget runden — idle-text må vekk.
    this.hideIdleText();
    this.stopCountdown();
    this.currentNumber = null;
    this.numberText.style.fontSize = 44;

    if (millisUntilStart <= 0) {
      this.numberText.text = "...";
      return;
    }

    this.countdownDeadline = Date.now() + millisUntilStart;
    this.countdownRemainingMs = millisUntilStart;
    this.updateCountdownDisplay();

    this.countdownInterval = setInterval(() => {
      if (this.isDestroyed) {
        this.stopCountdown();
        return;
      }
      if (this.bridge?.getState().isPaused) {
        this.countdownDeadline += 250;
        return;
      }
      this.updateCountdownDisplay();
    }, 250);
  }

  setBridge(bridge: PauseAwareBridge): void {
    this.bridge = bridge;
  }

  showWaiting(): void {
    this.stopCountdown();
    this.currentNumber = null;
    // I idle-text-modus skal vi IKKE re-rendre "..." over teksten —
    // numberText er allerede skjult og idleHeadline/idleBody eier
    // visningen. Behold tekst-state slik at idle-text er stabil.
    if (this.idleVisible) return;
    this.numberText.text = "...";
    this.numberText.style.fontSize = 44;
  }

  /**
   * Idle-text-modus (2026-05-11, Tobias-direktiv) — sett display-navn for
   * neste planlagte spill. Kan kalles før eller etter `showIdleText()`.
   * Hvis idle-text allerede er synlig oppdateres teksten live.
   *
   * `displayName` er katalog-display-navnet fra plan-runtime aggregator
   * (`Spill1LobbyState.nextScheduledGame.catalogDisplayName`). Tom/null
   * gir fallback "Bingo".
   */
  setIdleText(displayName: string | null | undefined): void {
    const next = (displayName ?? "").trim() || "Bingo";
    if (next === this.idleDisplayName) {
      // Re-render for å sikre tekst alltid er synkron med visible-state.
      if (this.idleVisible) this.renderIdleText();
      return;
    }
    this.idleDisplayName = next;
    if (this.idleVisible) this.renderIdleText();
  }

  /**
   * Aktiver idle-text-modus. Skjuler ball-sprite + number-text og rendrer
   * 2-linjers melding i samme posisjon. Idempotent — gjentatte kall mens
   * idle er synlig er no-op (men oppdaterer tekst hvis `setIdleText` har
   * blitt kalt mellomtiden).
   *
   * Forutsetning: `setIdleText` har blitt kalt med catalog-navnet. Hvis
   * ikke, brukes "Bingo" som fallback.
   */
  showIdleText(): void {
    if (this.idleVisible) {
      this.renderIdleText();
      return;
    }
    this.idleVisible = true;
    if (this.ballSprite) this.ballSprite.visible = false;
    this.numberText.visible = false;
    this.idleHeadline.visible = true;
    this.idleBody.visible = true;
    this.renderIdleText();
  }

  /**
   * Deaktiver idle-text-modus. Restore ball-sprite + number-text. Idempotent
   * — no-op hvis allerede skjult. Kalles automatisk fra showNumber/
   * setNumber/startCountdown så caller ikke trenger å huske å rydde.
   */
  hideIdleText(): void {
    if (!this.idleVisible) return;
    this.idleVisible = false;
    this.idleHeadline.visible = false;
    this.idleBody.visible = false;
    this.numberText.visible = true;
    if (this.ballSprite) this.ballSprite.visible = true;
  }

  /** Test-hook: er idle-text-modus aktiv? */
  isIdleTextVisible(): boolean {
    return this.idleVisible;
  }

  /** Test-hook: hvilken idle-mode er aktiv? */
  getIdleMode(): "next-game" | "closed" | "waiting-master" | "loading" {
    return this.idleMode;
  }

  /**
   * Idle-text-modus (2026-05-11, hall-isolation-fix; 2026-05-12 utvidet
   * med `waiting-master` per Tobias-direktiv Alternativ B):
   *
   *   - `"next-game"` — standard, vises når plan finnes OG scheduled-game
   *     er spawnet OG status er joinable. Headline = "Neste spill:
   *     {displayName}", body = "Kjøp bonger for å være med i trekningen".
   *   - `"waiting-master"` — vises når plan finnes men scheduled-game
   *     ennå ikke er spawnet av bridge (eller status er idle/finished).
   *     Headline = "Neste spill: {displayName}", body = "Venter på at
   *     master starter neste runde". Pre-fix vist "Kjøp bonger..." selv
   *     når kjøp-knappene var disabled → forvirrende UX. Wait-on-master-
   *     fix (Agent B, 2026-05-12).
   *   - `"closed"` — vises når lobby returnerer `overallStatus === "closed"`
   *     (ingen plan for hallen, eller utenfor åpningstid). Headline =
   *     "Stengt", body = "Ingen aktiv plan i hallen akkurat nå".
   *
   * Idempotent — gjentatte kall med samme mode er no-op. Hvis idle-text
   * er synlig re-rendres tekst umiddelbart.
   */
  setIdleMode(
    mode: "next-game" | "closed" | "waiting-master" | "loading",
  ): void {
    if (this.idleMode === mode) {
      if (this.idleVisible) this.renderIdleText();
      return;
    }
    this.idleMode = mode;
    if (this.idleVisible) this.renderIdleText();
  }

  private renderIdleText(): void {
    if (this.idleMode === "closed") {
      this.idleHeadline.text = "Stengt";
      this.idleBody.text = "Ingen aktiv plan i hallen akkurat nå";
      return;
    }
    if (this.idleMode === "waiting-master") {
      this.idleHeadline.text = `Neste spill: ${this.idleDisplayName}`;
      this.idleBody.text = "Venter på at master starter neste runde";
      return;
    }
    if (this.idleMode === "loading") {
      // Pilot Q3 2026 (2026-05-15): "Forbereder neste spill"-loader vises
      // i transition-vinduet mellom natural round-end og server-spawn av
      // neste plan-item. Tobias-direktiv 2026-05-15: "Hvis vi ikke kan
      // få det raskt — vi må ha loader." Vises maks ~10s før vi faller
      // tilbake til siste kjente "Neste spill"-tekst (PlayScreen-state-
      // machinen håndterer fallback-timer).
      this.idleHeadline.text = "Forbereder neste spill…";
      this.idleBody.text = "Et øyeblikk, vi henter neste spill fra serveren.";
      return;
    }
    this.idleHeadline.text = `Neste spill: ${this.idleDisplayName}`;
    this.idleBody.text = "Kjøp bonger for å være med i trekningen";
  }

  stopCountdown(): void {
    if (this.countdownInterval !== null) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
  }

  private updateCountdownDisplay(): void {
    const remaining = Math.ceil((this.countdownDeadline - Date.now()) / 1000);
    if (remaining <= 0) {
      this.numberText.text = "...";
      this.stopCountdown();
    } else {
      this.numberText.text = String(remaining);
    }
  }

  /**
   * Anker bob-animasjonen til eksplisitt base Y. Hvis en pågående bob
   * kjører, drepes den så neste showNumber starter fra ny base.
   */
  setBaseY(y: number): void {
    this.baseY = y;
    this.y = y;
    if (this.idleTween) {
      this.idleTween.kill();
      this.idleTween = null;
    }
  }

  /** Kort "just-drew"-bob: 4px opp → ned, single-shot (ca 2.4s totalt).
   *  Kjøres kun fra showNumber.onComplete. Ingen repeat: -1 — idle er
   *  statisk slik at Pixi ikke re-rendrer containeren per-frame uten grunn. */
  private bobOnce(): void {
    this.idleTween?.kill();
    if (this.baseY === null) this.baseY = this.y;
    this.y = this.baseY;
    this.idleTween = gsap.fromTo(
      this,
      { y: this.baseY },
      {
        y: this.baseY - 4,
        duration: 1.2,
        ease: "sine.inOut",
        yoyo: true,
        repeat: 1,
        onComplete: () => {
          this.idleTween = null;
        },
      },
    );
  }

  destroy(options?: Parameters<Container["destroy"]>[0]): void {
    this.isDestroyed = true;
    this.stopCountdown();
    gsap.killTweensOf(this);
    gsap.killTweensOf(this.scale);
    this.idleTween = null;
    super.destroy(options);
  }
}
