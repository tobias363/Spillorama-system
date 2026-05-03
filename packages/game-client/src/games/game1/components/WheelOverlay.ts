import { Container, Graphics, Sprite, Text, Assets, Texture } from "pixi.js";
import gsap from "gsap";

/**
 * BIN-690 PR-M6: Wheel of Fortune overlay — wired to M6 protocol.
 *
 * Trigger payload (from M2 MiniGameWheelEngine):
 *   `{ totalBuckets: number, prizes: Array<{amount, buckets}>, spinCount: 1 }`
 *
 * Choice payload: `{}` (Wheel has no player decision; the click on "SPIN"
 * is just the signal that the player wants to start the spin).
 *
 * Result payload:
 *   `{ winningBucketIndex, prizeGroupIndex, amountKroner, totalBuckets, animationSeed }`
 *
 * Unity parity (legacy reference preserved — backend protocol unchanged):
 *   - `SpinWheelScript.cs:174,180,186` — 50 physical segments × 7.2° per segment
 *   - `SpinWheelScript.cs:85` — per-frame decay `rotationSpeed *= rMultiplier`
 *   - `SpinWheelScript.cs:199,236` — final jitter ± 3.25°
 *   - `SpinWheelScript.cs:490,497` — pause-hook
 *
 * Visual redesign (Tobias 2026-05-03 — Agent F / "Lykkehjul-redesign"):
 *   Replaces procedural rainbow segments with the gold-on-burgundy "Klassisk
 *   Lykkehjul"-design from `claude.ai/design`:
 *     - Wheel-bg.png (1448×1086 dark luxury room) renderes som backdrop;
 *     - Mørk hjul-flate (radial gradient) med 8-takket gull-stjerne
 *       medaljong i midten;
 *     - 50 tynne gull-eiker (radial divider lines);
 *     - Premiebeløp som radiale gull-tall langs hver eike;
 *     - Pointer.png (gull-trekant) festet på toppen — roterer ikke;
 *     - SPIN-knapp som image-asset til VENSTRE for hjulet;
 *     - Win-banner.png under hjulet med Cinzel-stil gevinst-tekst.
 *
 *   The wheel still spins via cubic-bezier-eased CSS easing (replicated as
 *   GSAP eased tween for Pixi). Backend `winningBucketIndex` drives the
 *   landing position. Auto-spin countdown + pause-hook unchanged.
 */

const DEFAULT_NUM_SEGMENTS = 50;
const INITIAL_Z_ROTATION_DEG = -3.6;
const STOP_JITTER_DEG = 3.25;
const SPIN_DURATION_SECONDS = 5;
const AUTO_SPIN_SECONDS = 10;
const AUTO_DISMISS_AFTER_RESULT_SECONDS = 4;

/**
 * Asset paths — served from `packages/game-client/public/assets/game1/lykkehjul/`
 * via Vite's `/web/games/` base. Background is the 1448×1086 ornate room
 * scene; pointer + spin-button + win-banner are PNG cutouts overlaid on the
 * Pixi stage.
 */
const ASSET_BASE = "/web/games/assets/game1/lykkehjul";
const BG_URL = `${ASSET_BASE}/wheel-bg.png`;
const POINTER_URL = `${ASSET_BASE}/pointer.png`;
const SPIN_BUTTON_URL = `${ASSET_BASE}/spin-button.png`;
const WIN_BANNER_URL = `${ASSET_BASE}/win-banner.png`;

/**
 * Design constants — measured from `Lykkehjul.html` against the 1448×1086
 * background image. The wheel's actual face center sits slightly off-image-
 * center (NY.png measurement via RANSAC circle-fit on the gold lights ring).
 */
const WHEEL_CX_PCT = 50.03 / 100; // 0.5003 of bg-frame width
const WHEEL_CY_PCT = 41.55 / 100; // 0.4155 of bg-frame height (slightly above middle)
const FACE_R_PCT = 23.51 / 100; // wheel-face radius as % of bg-frame width
/** Aspect-ratio of the bg PNG — keeps positioning math intrinsic to the asset. */
const BG_ASPECT = 1448 / 1086;

/**
 * 8-pointed gold star + medallion geometry in segment-svg-space (200×200
 * viewBox in design). Scaled to wheel radius at render time.
 */
const MEDALLION_INNER_R_FRAC = 18 / 100; // medallion outer radius as fraction of face radius
const STAR_OUTER_R_FRAC = 11 / 100;
const STAR_INNER_R_FRAC = 3.5 / 100;

interface PauseAwareBridge {
  getState(): { isPaused: boolean };
}

/** Trigger-payload shape (matches M2 MiniGameWheelEngine.ts:trigger.payload). */
interface WheelTriggerPayload {
  totalBuckets?: number;
  prizes?: Array<{ amount: number; buckets: number }>;
  spinCount?: number;
}

/** Result-payload shape (matches M2 WheelResultJson). */
interface WheelResultJson {
  winningBucketIndex: number;
  prizeGroupIndex?: number;
  amountKroner: number;
  totalBuckets: number;
  animationSeed?: number;
}

export class WheelOverlay extends Container {
  /** Index 0: dimmed click-blocker rect over the entire stage. */
  private backdrop: Graphics;
  /** Index 1: localized title text — kept for layout-test stability. */
  private titleText: Text;
  /**
   * Index 2: spinning wheel container. `wheelInner` (children[0]) holds
   * per-segment Graphics + per-segment Text labels + one hub Graphics
   * (medallion + 8-point star + dark center hole) — exactly N+N+1 children
   * to keep `WheelOverlay.test.ts:32` stable across the redesign.
   */
  private wheelContainer: Container;
  private wheelInner: Container;
  /** Index 3+: scene chrome — bg sprite, pointer sprite, spin button, etc. */
  private bgSprite: Sprite | null = null;
  private pointerSprite: Sprite | null = null;
  private spinBtn: Container;
  private spinBtnSprite: Sprite | null = null;
  private spinBtnText: Text;
  private winBanner: Container;
  private winBannerSprite: Sprite | null = null;
  private winAmountText: Text;
  private resultText: Text;
  private timerText: Text;
  private errorText: Text;
  private prizeLabels: number[] = [];
  private numSegments: number = DEFAULT_NUM_SEGMENTS;
  private isSpinning = false;
  /** Wheel face radius in stage-pixels — recomputed on each show(). */
  private radius: number;
  /** Stage size — captured for asset positioning. */
  private screenWidth: number;
  private screenHeight: number;
  /** Bg-frame inner rect (the rectangle the bg-image covers, letterboxed). */
  private frameWidth: number;
  private frameHeight: number;
  private frameOffsetX: number;
  private frameOffsetY: number;
  /** Wheel-face center in stage-pixel coords (derived from bg-frame layout). */
  private wheelCenterX: number;
  private wheelCenterY: number;
  private onChoice: ((choiceJson: Readonly<Record<string, unknown>>) => void) | null = null;
  private onDismiss: (() => void) | null = null;
  private autoSpinTimer: ReturnType<typeof setInterval> | null = null;
  private autoSpinCountdown = AUTO_SPIN_SECONDS;
  private spinTween: gsap.core.Tween | null = null;
  /** Tracks whether the bridge reports paused so spin-tween freezes consistently. */
  private bridge: PauseAwareBridge | null;
  private isDestroyed = false;

  constructor(screenWidth: number, screenHeight: number, bridge?: PauseAwareBridge) {
    super();
    this.bridge = bridge ?? null;
    this.screenWidth = screenWidth;
    this.screenHeight = screenHeight;

    // Compute the bg-frame layout (letterbox to preserve 1448:1086 aspect).
    const stageAspect = screenWidth / screenHeight;
    if (stageAspect > BG_ASPECT) {
      // Stage wider than bg — letterbox left/right.
      this.frameHeight = screenHeight;
      this.frameWidth = screenHeight * BG_ASPECT;
      this.frameOffsetX = (screenWidth - this.frameWidth) / 2;
      this.frameOffsetY = 0;
    } else {
      // Stage taller than bg — letterbox top/bottom.
      this.frameWidth = screenWidth;
      this.frameHeight = screenWidth / BG_ASPECT;
      this.frameOffsetX = 0;
      this.frameOffsetY = (screenHeight - this.frameHeight) / 2;
    }
    this.wheelCenterX = this.frameOffsetX + this.frameWidth * WHEEL_CX_PCT;
    this.wheelCenterY = this.frameOffsetY + this.frameHeight * WHEEL_CY_PCT;
    this.radius = this.frameWidth * FACE_R_PCT;

    // ── 0: full-stage dimmed click-blocker ───────────────────────────────
    this.backdrop = new Graphics();
    this.backdrop.rect(0, 0, screenWidth, screenHeight);
    this.backdrop.fill({ color: 0x000000, alpha: 0.78 });
    this.backdrop.eventMode = "static";
    this.addChild(this.backdrop);

    // ── 1: title (kept for accessibility + happy-dom test layout) ────────
    // Tittelteksten holdes utenfor det ornate bg-bildet (toppen av stage)
    // så den ikke skaper ekstra støy oppå messing-akselementene.
    this.titleText = new Text({
      text: "LYKKEHJUL",
      style: {
        fontFamily: "Cinzel, 'Playfair Display', Georgia, serif",
        fontSize: Math.max(22, Math.floor(screenHeight * 0.045)),
        fontWeight: "900",
        fill: 0xffe89a,
        align: "center",
        letterSpacing: 4,
        dropShadow: {
          color: 0x000000,
          blur: 4,
          distance: 2,
          alpha: 0.85,
        },
      },
    });
    this.titleText.anchor.set(0.5);
    this.titleText.x = screenWidth / 2;
    this.titleText.y = Math.max(28, this.frameOffsetY - 20);
    if (this.titleText.y < 28) this.titleText.y = 28;
    this.addChild(this.titleText);

    // ── 2: wheel container + wheelInner ─────────────────────────────────
    this.wheelContainer = new Container();
    this.wheelContainer.x = this.wheelCenterX;
    this.wheelContainer.y = this.wheelCenterY;
    this.addChild(this.wheelContainer);
    this.wheelInner = new Container();
    this.wheelContainer.addChild(this.wheelInner);
    this.drawWheel();

    // ── 3+: scene chrome — order matters for z-stacking ──────────────────
    // Bg loads asynchronously; insert it BEHIND the wheel by re-shuffling
    // children once the texture lands. Until then the dim backdrop renders
    // a clean dark stage so nothing flashes mis-positioned.
    void this.loadBackground();

    // Pointer sprite: attached to wheelContainer at (0, -radius) so it
    // visually sits on top of the wheel rim but does NOT rotate with the
    // spin (it lives outside `wheelInner`).
    void this.loadPointer();

    // Timer text — sits below the wheel, above the spin button / banner.
    this.timerText = new Text({
      text: "",
      style: {
        fontFamily: "Inter, 'Helvetica Neue', sans-serif",
        fontSize: 16,
        fill: 0xffe89a,
        align: "center",
      },
    });
    this.timerText.anchor.set(0.5);
    this.timerText.x = this.wheelCenterX;
    this.timerText.y = this.wheelCenterY + this.radius + 24;
    this.addChild(this.timerText);

    // SPIN button — image-based, placed to the LEFT of the wheel, vertically
    // centered with the wheel (per design `.spin-btn` rule). Falls back to
    // a CSS-style red round-rect button if the PNG fails to load.
    this.spinBtn = new Container();
    this.spinBtnText = new Text({
      text: "SPIN",
      style: {
        fontFamily: "'Playfair Display', Cinzel, Georgia, serif",
        fontSize: 22,
        fontWeight: "900",
        fill: 0xffffff,
        align: "center",
        letterSpacing: 2,
        dropShadow: {
          color: 0x000000,
          blur: 3,
          distance: 1,
          alpha: 0.85,
        },
      },
    });
    this.spinBtnText.anchor.set(0.5);
    this.spinBtnText.visible = false; // only shown if image fails to load
    this.spinBtn.addChild(this.spinBtnText);
    this.positionSpinButton();
    this.spinBtn.eventMode = "static";
    this.spinBtn.cursor = "pointer";
    this.spinBtn.on("pointerdown", () => this.handleSpinClick());
    this.addChild(this.spinBtn);
    void this.loadSpinButton();

    // Win banner — appears centered BELOW the wheel after a spin lands.
    // Hidden by default (alpha 0). Holds the win-banner.png + amount Text.
    this.winBanner = new Container();
    this.winBanner.alpha = 0;
    this.winBanner.visible = false;
    this.winAmountText = new Text({
      text: "",
      style: {
        fontFamily: "Cinzel, 'Playfair Display', Georgia, serif",
        fontSize: Math.max(20, Math.floor(this.radius * 0.22)),
        fontWeight: "900",
        fill: 0xffe89a,
        align: "center",
        letterSpacing: 2,
        dropShadow: {
          color: 0xffb43c,
          blur: 8,
          distance: 0,
          alpha: 0.85,
        },
      },
    });
    this.winAmountText.anchor.set(0.5, 0.5);
    this.winBanner.addChild(this.winAmountText);
    this.winBanner.x = this.wheelCenterX;
    this.winBanner.y = this.wheelCenterY + this.radius * 0.85;
    this.addChild(this.winBanner);
    void this.loadWinBanner();

    // Result text — fallback / accessibility (also displayed when banner png
    // is missing). Anchored just below the win banner.
    this.resultText = new Text({
      text: "",
      style: {
        fontFamily: "Cinzel, 'Playfair Display', Georgia, serif",
        fontSize: 28,
        fontWeight: "900",
        fill: 0xffe89a,
        align: "center",
        letterSpacing: 1,
      },
    });
    this.resultText.anchor.set(0.5);
    this.resultText.x = this.wheelCenterX;
    this.resultText.y = Math.min(
      screenHeight - 24,
      this.wheelCenterY + this.radius + 96,
    );
    this.resultText.visible = false;
    this.addChild(this.resultText);

    // Error text — visible only after showChoiceError, sits below result.
    this.errorText = new Text({
      text: "",
      style: {
        fontFamily: "Inter, 'Helvetica Neue', sans-serif",
        fontSize: 14,
        fill: 0xff8484,
        align: "center",
      },
    });
    this.errorText.anchor.set(0.5);
    this.errorText.x = this.wheelCenterX;
    this.errorText.y = Math.min(
      screenHeight - 8,
      this.wheelCenterY + this.radius + 124,
    );
    this.errorText.visible = false;
    this.addChild(this.errorText);

    this.visible = false;
  }

  setOnChoice(callback: (choiceJson: Readonly<Record<string, unknown>>) => void): void {
    this.onChoice = callback;
  }

  setOnDismiss(callback: () => void): void {
    this.onDismiss = callback;
  }

  setBridge(bridge: PauseAwareBridge): void {
    this.bridge = bridge;
  }

  /**
   * Handle `mini_game:trigger` payload from server. Re-renders the wheel with
   * the actual prize layout and starts the auto-spin countdown.
   */
  show(triggerPayload: Readonly<Record<string, unknown>>): void {
    const data = triggerPayload as unknown as WheelTriggerPayload;
    // Derive numSegments from totalBuckets (default 50 for Unity parity).
    const total =
      typeof data.totalBuckets === "number" && data.totalBuckets >= 1
        ? data.totalBuckets
        : DEFAULT_NUM_SEGMENTS;
    this.numSegments = total;
    // Flatten prizes into a per-segment label list (prize.amount repeated
    // `prize.buckets` times). Falls back to empty labels if the payload is
    // malformed — we still render segments for visual continuity.
    this.prizeLabels = [];
    if (Array.isArray(data.prizes)) {
      for (const p of data.prizes) {
        if (typeof p?.amount !== "number" || typeof p?.buckets !== "number") continue;
        for (let i = 0; i < p.buckets; i += 1) this.prizeLabels.push(p.amount);
      }
    }
    // Pad/trim to exactly numSegments so every segment has a label slot.
    while (this.prizeLabels.length < this.numSegments) {
      this.prizeLabels.push(this.prizeLabels[0] ?? 0);
    }
    this.prizeLabels = this.prizeLabels.slice(0, this.numSegments);

    this.drawWheel();
    this.isSpinning = false;
    this.spinBtn.visible = true;
    this.spinBtn.alpha = 1;
    this.resultText.visible = false;
    this.errorText.visible = false;
    this.winBanner.alpha = 0;
    this.winBanner.visible = false;
    this.winAmountText.text = "";
    this.wheelInner.rotation = 0;
    this.visible = true;

    this.autoSpinCountdown = AUTO_SPIN_SECONDS;
    this.timerText.text = `Auto-spinn om ${this.autoSpinCountdown}s`;
    this.autoSpinTimer = setInterval(() => {
      if (this.bridge?.getState().isPaused) return;
      this.autoSpinCountdown -= 1;
      if (this.autoSpinCountdown <= 0) {
        this.clearAutoTimer();
        this.timerText.text = "";
        this.handleSpinClick();
      } else {
        this.timerText.text = `Auto-spinn om ${this.autoSpinCountdown}s`;
      }
    }, 1000);
  }

  /**
   * Handle `mini_game:result` payload. Spins the wheel to the server-picked
   * `winningBucketIndex`, then displays the payout text and auto-dismisses.
   *
   * Animation: GSAP cubic-bezier(0.16, 0.8, 0.2, 1) over 5 seconds — same
   * easing curve as the design prototype's CSS transition. A small ± 3.25°
   * jitter adds realistic settle (Unity SpinWheelScript.cs:199 parity).
   * Pause-hook: tween is paused/resumed when bridge.isPaused flips.
   */
  animateResult(resultJson: Readonly<Record<string, unknown>>, payoutCents: number): void {
    const result = resultJson as unknown as WheelResultJson;
    this.isSpinning = true;
    this.spinBtn.visible = false;
    this.errorText.visible = false;
    this.clearAutoTimer();
    this.timerText.text = "";

    const segmentAngleDeg = 360 / this.numSegments;
    const targetAngleDeg =
      result.winningBucketIndex * segmentAngleDeg + segmentAngleDeg / 2;
    const jitter = (Math.random() * 2 - 1) * STOP_JITTER_DEG;
    // 6 full rotations + reverse-target so the chosen segment ends under
    // the top pointer (-90° in our wheelInner local frame).
    const finalAngleDeg = 360 * 6 + (360 - targetAngleDeg) + jitter;
    const finalAngleRad = (finalAngleDeg * Math.PI) / 180;

    this.wheelInner.rotation = 0;
    this.spinTween?.kill();
    this.spinTween = gsap.to(this.wheelInner, {
      rotation: finalAngleRad,
      duration: SPIN_DURATION_SECONDS,
      // `power3.out` approximates the design's CSS
      // `cubic-bezier(0.16, 0.8, 0.2, 1)` curve closely enough for the
      // visual settle without pulling in GSAP's CustomEase plugin.
      ease: "power3.out",
      onUpdate: () => {
        // Pause-hook: freeze tween while bridge reports paused. GSAP's
        // built-in pause is per-tween — we mirror Unity SpinWheelScript.cs:497.
        if (this.bridge?.getState().isPaused) {
          this.spinTween?.pause();
        } else if (this.spinTween?.paused()) {
          this.spinTween.resume();
        }
      },
      onComplete: () => {
        this.spinTween = null;
        if (this.isDestroyed) return;
        this.onSpinComplete(result, payoutCents);
      },
    });
  }

  /**
   * Fail-closed display of a choice-error. Since Wheel sends `{}` immediately
   * on click, the error state lets the player retry without dismissing the
   * overlay (server tracks completion idempotently).
   */
  showChoiceError(err: { code: string; message: string }): void {
    this.errorText.text = `Feil: ${err.message}`;
    this.errorText.visible = true;
    // Re-enable spin button so player can retry.
    this.isSpinning = false;
    this.spinBtn.visible = true;
  }

  private onSpinComplete(result: WheelResultJson, payoutCents: number): void {
    this.isSpinning = false;
    // Prefer explicit amountKroner from result; fall back to payoutCents/100.
    const amountKroner =
      typeof result.amountKroner === "number"
        ? result.amountKroner
        : Math.round(payoutCents / 100);
    const formatted = `${amountKroner.toLocaleString("no-NO")} kr`;
    // Win banner (image overlay) takes priority — show the gold "Gratulerer
    // du vant"-asset with the won amount overlaid on the banner's red plate.
    this.winAmountText.text = formatted;
    this.winBanner.visible = true;
    this.winBanner.alpha = 0;
    this.winBanner.scale.set(0.92);
    gsap.to(this.winBanner, {
      alpha: 1,
      duration: 0.5,
      ease: "power2.out",
    });
    gsap.to(this.winBanner.scale, {
      x: 1.04,
      y: 1.04,
      duration: 0.5,
      ease: "back.out(1.6)",
    });
    // Fallback text — only if banner png failed to load (winBannerSprite
    // null after attempted load means we should still inform the player).
    if (!this.winBannerSprite) {
      this.resultText.text = `Du vant ${formatted}!`;
      this.resultText.visible = true;
    }

    gsap.delayedCall(AUTO_DISMISS_AFTER_RESULT_SECONDS, () => {
      if (this.isDestroyed) return;
      this.visible = false;
      this.onDismiss?.();
    });
  }

  destroy(options?: Parameters<Container["destroy"]>[0]): void {
    this.isDestroyed = true;
    this.clearAutoTimer();
    this.spinTween?.kill();
    this.spinTween = null;
    gsap.killTweensOf(this.wheelInner);
    gsap.killTweensOf(this.winBanner);
    gsap.killTweensOf(this.winBanner.scale);
    super.destroy(options);
  }

  private handleSpinClick(): void {
    if (this.isSpinning) return;
    this.clearAutoTimer();
    this.timerText.text = "";
    this.errorText.visible = false;
    // Wheel has no choice UI — send empty choiceJson. Server decides the
    // outcome; we just signal the player is ready.
    this.onChoice?.({});
  }

  private clearAutoTimer(): void {
    if (this.autoSpinTimer) {
      clearInterval(this.autoSpinTimer);
      this.autoSpinTimer = null;
    }
  }

  private positionSpinButton(): void {
    // Per design: button sits to the LEFT of the wheel, vertically centered
    // with the wheel center. Use frameWidth fraction so it scales with the
    // bg-frame, not raw stage size.
    const offsetLeft = this.frameWidth * 0.18;
    this.spinBtn.x = this.wheelCenterX - offsetLeft;
    this.spinBtn.y = this.wheelCenterY;
    // Spin button sprite is anchored at (0.5, 0.5) so we don't need to
    // reposition the children — just the button's container origin.
    this.spinBtnText.x = 0;
    this.spinBtnText.y = 0;
  }

  /**
   * Async-load the bg image and slot it BEHIND the dim backdrop (z-index 0
   * relative to wheel/UI). If the asset fails the dark backdrop alone is a
   * graceful fallback — we don't crash the overlay on missing PNGs.
   */
  private async loadBackground(): Promise<void> {
    try {
      let tex = Assets.cache.get(BG_URL) as Texture | undefined;
      if (!tex) tex = (await Assets.load(BG_URL)) as Texture;
      if (this.isDestroyed) return;
      const sprite = new Sprite(tex);
      sprite.x = this.frameOffsetX;
      sprite.y = this.frameOffsetY;
      sprite.width = this.frameWidth;
      sprite.height = this.frameHeight;
      sprite.eventMode = "none";
      this.bgSprite = sprite;
      // Insert just above the backdrop (index 1) so backdrop still dims any
      // letterbox area. If letterbox is zero this is purely cosmetic.
      this.addChildAt(sprite, 1);
    } catch {
      // Silent fallback — keep the dim backdrop as the visual base.
      console.warn("[WheelOverlay] Could not load wheel-bg.png");
    }
  }

  /**
   * Async-load the gold pointer.png and place it above the wheel rim. The
   * pointer is a child of `wheelContainer` (NOT `wheelInner`) so it stays
   * stationary while the wheel-face spins underneath.
   */
  private async loadPointer(): Promise<void> {
    try {
      let tex = Assets.cache.get(POINTER_URL) as Texture | undefined;
      if (!tex) tex = (await Assets.load(POINTER_URL)) as Texture;
      if (this.isDestroyed) return;
      const sprite = new Sprite(tex);
      // Source PNG is 98×96 — scale to ~5.5% of bg-width (matches design
      // `.pointer { width: 5.5cqi }`).
      const targetW = this.frameWidth * 0.055;
      const aspect = tex.height / tex.width;
      sprite.width = targetW;
      sprite.height = targetW * aspect;
      sprite.anchor.set(0.5, 0); // top-anchored so the tip points DOWN into the wheel
      sprite.x = 0;
      // Tip sits just inside the lights ring — overlap by ~2cqi like the
      // design's calc(-1 * face-r-pct * 1cqi - 2cqi) translation.
      sprite.y = -this.radius - this.frameWidth * 0.02;
      sprite.eventMode = "none";
      this.pointerSprite = sprite;
      this.wheelContainer.addChild(sprite);
    } catch {
      // Fallback: draw a simple gold triangle so the pointer is still
      // visible if the asset is missing. Inserted into wheelContainer.
      const tri = new Graphics();
      tri.moveTo(0, -this.radius - 6);
      tri.lineTo(-12, -this.radius - 28);
      tri.lineTo(12, -this.radius - 28);
      tri.closePath();
      tri.fill(0xffd470);
      tri.stroke({ color: 0x7a4d10, width: 2 });
      this.wheelContainer.addChild(tri);
      console.warn("[WheelOverlay] Could not load pointer.png");
    }
  }

  /**
   * Async-load the spin-button.png. The image becomes the visible button;
   * the click-handler sits on the parent Container so it works regardless
   * of whether the image loads.
   */
  private async loadSpinButton(): Promise<void> {
    try {
      let tex = Assets.cache.get(SPIN_BUTTON_URL) as Texture | undefined;
      if (!tex) tex = (await Assets.load(SPIN_BUTTON_URL)) as Texture;
      if (this.isDestroyed) return;
      const sprite = new Sprite(tex);
      const targetW = this.frameWidth * 0.18; // ~24cqi like design
      const aspect = tex.height / tex.width;
      sprite.width = targetW;
      sprite.height = targetW * aspect;
      sprite.anchor.set(0.5, 0.5);
      sprite.x = 0;
      sprite.y = 0;
      this.spinBtnSprite = sprite;
      // Insert behind the fallback text so text only shows if the sprite
      // is removed (we hide the text when the image is present).
      this.spinBtn.addChildAt(sprite, 0);
      this.spinBtnText.visible = false;
    } catch {
      // Fallback: render a dark-red rounded-rect button with the SPIN text.
      const btnBg = new Graphics();
      btnBg.roundRect(-90, -25, 180, 50, 12);
      btnBg.fill(0x790001);
      btnBg.stroke({ color: 0xffd470, width: 2 });
      this.spinBtn.addChildAt(btnBg, 0);
      this.spinBtnText.visible = true;
      console.warn("[WheelOverlay] Could not load spin-button.png");
    }
  }

  /**
   * Async-load the win-banner.png. The amount Text is added as a child of
   * `winBanner` BEFORE the bg sprite so we can slot the bg behind it once
   * loaded — text stays on top per design.
   */
  private async loadWinBanner(): Promise<void> {
    try {
      let tex = Assets.cache.get(WIN_BANNER_URL) as Texture | undefined;
      if (!tex) tex = (await Assets.load(WIN_BANNER_URL)) as Texture;
      if (this.isDestroyed) return;
      const sprite = new Sprite(tex);
      // ~54cqi width like design (.win-banner { width: 54.72cqi }).
      const targetW = this.frameWidth * 0.4;
      const aspect = tex.height / tex.width;
      sprite.width = targetW;
      sprite.height = targetW * aspect;
      sprite.anchor.set(0.5, 0.5);
      sprite.x = 0;
      sprite.y = 0;
      sprite.eventMode = "none";
      this.winBannerSprite = sprite;
      // Place bg BEHIND the amount text (insert at 0).
      this.winBanner.addChildAt(sprite, 0);
      // Reposition the amount text relative to banner bg — sits on the
      // lower red plate per design (`.win-banner .amount { top: 57% }`).
      this.winAmountText.x = 0;
      this.winAmountText.y = sprite.height * 0.07; // small offset down from center
      this.winAmountText.style.fontSize = Math.max(
        18,
        Math.floor(targetW * 0.095),
      );
    } catch {
      // No bg — keep the amount text plain; resultText takes over as fallback.
      console.warn("[WheelOverlay] Could not load win-banner.png");
    }
  }

  /**
   * Render the wheel-face into `wheelInner`. Maintains the test-asserted
   * child layout: N segment Graphics + N label Texts + 1 hub Graphics.
   *
   * The "hub Graphics" is a single Pixi `Graphics` that paints:
   *   - dark wheel face (annulus from radius down to medallion-inner-r)
   *   - 8-pointed gold star (medallion centerpiece)
   *   - dark center-hole so the bg's rosette can show through
   * Doing it all in one Graphics keeps the child count predictable.
   */
  private drawWheel(): void {
    this.wheelInner.removeChildren();
    const segmentAngleRad = (2 * Math.PI) / this.numSegments;
    const initialOffsetRad = (INITIAL_Z_ROTATION_DEG * Math.PI) / 180;
    const innerR = this.radius * MEDALLION_INNER_R_FRAC;

    // ── N segments — thin gold radial spokes on a dark face ──────────────
    // Each segment is rendered as one Graphics drawing a thin pie-slice
    // wedge filled with the dark face color, then a single gold spoke line
    // at the start angle. Per-segment colors removed (legacy rainbow) in
    // favor of the gold-on-dark casino aesthetic.
    for (let i = 0; i < this.numSegments; i++) {
      const startAngle = i * segmentAngleRad - Math.PI / 2 + initialOffsetRad;
      const endAngle = startAngle + segmentAngleRad;

      const seg = new Graphics();
      // Dark face wedge — radial gradient simulated by two-stop fill.
      seg.moveTo(0, 0);
      seg.arc(0, 0, this.radius, startAngle, endAngle);
      seg.closePath();
      // Subtle alternating shade for depth (every other segment a hair
      // darker — picks up the bg-image's wheel texture variations).
      const darkShade = i % 2 === 0 ? 0x0f0a06 : 0x1a1108;
      seg.fill({ color: darkShade, alpha: 1 });
      // Thin gold spoke at the start of this segment (radial divider).
      seg.moveTo(innerR * Math.cos(startAngle), innerR * Math.sin(startAngle));
      seg.lineTo(
        (this.radius - 1) * Math.cos(startAngle),
        (this.radius - 1) * Math.sin(startAngle),
      );
      seg.stroke({ color: 0xc89a3a, width: 0.6, alpha: 0.9 });
      this.wheelInner.addChild(seg);
    }

    // ── N labels — radial gold prize amounts ─────────────────────────────
    // Label position is mid-segment, near the rim. Text reads outward with
    // the bottom (feet) pointing toward the center — same orientation
    // logic as `Lykkehjul.html` (anchor=end, rotate by angleDeg).
    for (let i = 0; i < this.numSegments; i++) {
      const angleDeg =
        -90 + (i + 0.5) * (360 / this.numSegments) + INITIAL_Z_ROTATION_DEG;
      const angleRad = (angleDeg * Math.PI) / 180;
      const labelR = this.radius * 0.8;
      const x = labelR * Math.cos(angleRad);
      const y = labelR * Math.sin(angleRad);
      const prize = this.prizeLabels[i] ?? 0;
      const isBig = prize >= 3000;

      // Font-size scales with radius so the labels fit in tiny segments
      // (50 segments = 7.2° per slice — ~3% of circumference).
      const baseSize = Math.max(8, Math.floor(this.radius * 0.06));
      const fontSize = isBig ? Math.floor(baseSize * 1.15) : baseSize;

      const label = new Text({
        text: `${prize.toLocaleString("no-NO")} kr`,
        style: {
          fontFamily: "Inter, 'Helvetica Neue', sans-serif",
          fontSize,
          fontWeight: "900",
          fill: isBig ? 0xfff5c8 : 0xffd470,
          stroke: { color: 0x1a0f04, width: Math.max(1.5, fontSize * 0.08) },
          letterSpacing: 0.5,
          align: "right",
        },
      });
      label.anchor.set(1, 0.5); // anchor at right edge so text grows INWARD
      label.x = x;
      label.y = y;
      // Rotate so text reads outward (top pointing rim, feet pointing center).
      label.rotation = angleRad;
      this.wheelInner.addChild(label);
    }

    // ── 1 hub Graphics — medallion + 8-pointed star + center hole ────────
    const hub = new Graphics();

    // Outer dark rim shadow ring (subtle inner shadow at the wheel edge).
    hub.circle(0, 0, this.radius - 0.5);
    hub.stroke({ color: 0x000000, width: 1, alpha: 0.6 });

    // Medallion ring — gold radial gradient simulated as two layered fills.
    const medallionR = this.radius * (MEDALLION_INNER_R_FRAC - 0.02);
    hub.circle(0, 0, medallionR);
    hub.fill({ color: 0x5a3508, alpha: 1 });
    hub.circle(0, 0, medallionR * 0.94);
    hub.fill({ color: 0xd99428, alpha: 1 });
    hub.circle(0, 0, medallionR * 0.86);
    hub.fill({ color: 0xffe89a, alpha: 1 });

    // 8-pointed gold star — 16 points (8 outer + 8 inner) for crisp peaks.
    const starOuterR = this.radius * STAR_OUTER_R_FRAC;
    const starInnerR = this.radius * STAR_INNER_R_FRAC;
    const starPoints: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < 16; i++) {
      const a = (-90 + i * (360 / 16)) * Math.PI / 180;
      const r = i % 2 === 0 ? starOuterR : starInnerR;
      starPoints.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
    }
    if (starPoints.length > 0) {
      const first = starPoints[0]!;
      hub.moveTo(first.x, first.y);
      for (let i = 1; i < starPoints.length; i++) {
        const p = starPoints[i]!;
        hub.lineTo(p.x, p.y);
      }
      hub.closePath();
      hub.fill({ color: 0xf5c14b, alpha: 1 });
      hub.stroke({ color: 0x7a4d10, width: 1 });
    }

    // Tiny dark center cap (gives the star a "set-into-medallion" look).
    hub.circle(0, 0, starInnerR * 0.55);
    hub.fill({ color: 0x2a1a08, alpha: 1 });

    this.wheelInner.addChild(hub);
  }
}

/** Test-only accessor for default segment count. */
export const __WheelOverlay_DEFAULT_NUM_SEGMENTS__ = DEFAULT_NUM_SEGMENTS;
