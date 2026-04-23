import { Container, Sprite, Text, Assets, Texture } from "pixi.js";
import gsap from "gsap";

/**
 * Ball PNGs are ~512×512 source downscaled to 81px (tube) / 170px (ring).
 * Without mipmaps the downscale aliases heavily — users see pixellated
 * edges. Enable per-source autoGenerate and trilinear filtering so WebGL
 * picks the right mip level at each draw size.
 */
export function enableMipmaps(texture: Texture): void {
  const src = texture.source as unknown as {
    autoGenerateMipmaps?: boolean;
    scaleMode?: string;
    updateMipmaps?: () => void;
  };
  if (src && !src.autoGenerateMipmaps) {
    src.autoGenerateMipmaps = true;
    src.scaleMode = "linear";
    src.updateMipmaps?.();
  }
}

/**
 * Vertical stack of drawn bingo balls — new design (2026-04-23) uses PNG
 * sprites over transparent backdrop, with mockup-parity animations:
 *  - Exit: oldest ball sweeps LEFT with rotation + fade when a new draw arrives.
 *  - Insert: new ball spawns above the tube and eases down into the top slot.
 *  - Shift: existing balls glide down one slot via GSAP.
 *
 * Preserved contracts (do not change without PM sign-off):
 *  - `extends Container` — PlayScreen adds this as a Pixi child.
 *  - `getBallColor(n)` hex mapping — asserted by BallTube.test.ts (Bingo75
 *    column partition B/I/N/G/O). The hex values also feed CalledNumbersOverlay.
 *  - `getMoveAnimationTime(active, showcase)` — Unity-parity formula asserted
 *    by BallTube.test.ts; drives both the mockup insert-slide and shift ease.
 *  - `addBall(n)` / `loadBalls(ns)` / `clear()` / `getLatestNumber()` / `destroy()`.
 *
 * Visual sizing taken from spillorama-ui-mockup.html (.drawn-ball): 81px, 4px
 * vertical gap, with the top of the column faded by a gradient overlay.
 */

const TUBE_WIDTH = 108; // mockup .balls-tube width
const BALL_SIZE = 70;   // +2px så ballene ser større ut
const BALL_GAP = 0;     // tett pakket for å få plass til én ekstra ball
const BALL_DISTANCE = BALL_SIZE + BALL_GAP;
const PAD_TOP = 4;      // redusert fra 14 for å spare topp-plass
const HIGHLIGHT_SCALE = 1.0;
const NORMAL_SCALE = 1.0;
const MOVE_TIME = 0.5;
const EXIT_TIME = 0.9;

type Ball = Container & { ballNumber: number };

/**
 * BIN-619 Bug 6: Unity-parity movement time. Port of
 * `BingoBallPanelManager.cs:249 GetAnimationTime`.
 *
 * The move animation accelerates as the tube fills. `activeBefore` is the
 * count BEFORE the new ball was added.
 */
export function getMoveAnimationTime(activeBefore: number, showcaseCount: number): number {
  const limit = showcaseCount + 1;
  if (activeBefore === showcaseCount) {
    return ((limit - activeBefore + 1) * MOVE_TIME) / limit;
  }
  return ((limit - activeBefore) * MOVE_TIME) / limit;
}

/**
 * Maps bingo number to Bingo75 column color (B-I-N-G-O). Hex values are the
 * contract with BallTube.test.ts; do not change without updating the test.
 *   B (1-15)  = blue
 *   I (16-30) = red
 *   N (31-45) = purple
 *   G (46-60) = green
 *   O (61-75) = yellow
 */
export function getBallColor(n: number): { center: number; edge: number; glow: number } {
  if (n <= 15) return { center: 0x3a7adf, edge: 0x0d2f8a, glow: 0x2850dc }; // B blue
  if (n <= 30) return { center: 0xe84040, edge: 0x8b0000, glow: 0xdc2828 }; // I red
  if (n <= 45) return { center: 0xcc44cc, edge: 0x6a006a, glow: 0xb428b4 }; // N purple
  if (n <= 60) return { center: 0x6ecf3a, edge: 0x2a7a00, glow: 0x64dc28 }; // G green
  return { center: 0xf0c020, edge: 0x8a7000, glow: 0xc8a814 };              // O yellow
}

/**
 * Maps bingo number to PNG asset URL. Follows the same Bingo75 column
 * partition as getBallColor. orange.png is reserved for future variants
 * (e.g. bonus balls, jackpot highlight); currently unused in the tube.
 */
export function getBallAssetPath(n: number): string {
  if (n <= 15) return "/web/games/assets/game1/design/balls/blue.png";
  if (n <= 30) return "/web/games/assets/game1/design/balls/red.png";
  if (n <= 45) return "/web/games/assets/game1/design/balls/purple.png";
  if (n <= 60) return "/web/games/assets/game1/design/balls/green.png";
  return "/web/games/assets/game1/design/balls/yellow.png";
}

export class BallTube extends Container {
  private tubeHeight: number;
  private ballContainer: Container;

  private showcaseCount: number;
  /** Faktisk distanse mellom ball-sentre — stretched så nederste ball sitter
   *  på bunn av røret (jevn fordeling topp→bunn). */
  private effectiveDistance: number;
  /** Newest first: balls[0] is the just-drawn ball at the top of the stack. */
  private balls: Ball[] = [];

  constructor(tubeHeight: number) {
    super();
    this.tubeHeight = tubeHeight;
    this.showcaseCount = Math.max(1, Math.floor((tubeHeight - PAD_TOP) / BALL_DISTANCE));

    // Fordel ballene jevnt fra topp til bunn: første ball ved PAD_TOP,
    // siste ball's senter ved tubeHeight - BALL_SIZE/2 - PAD_BOTTOM.
    const PAD_BOTTOM = 4;
    if (this.showcaseCount > 1) {
      this.effectiveDistance =
        (tubeHeight - PAD_TOP - PAD_BOTTOM - BALL_SIZE) / (this.showcaseCount - 1);
    } else {
      this.effectiveDistance = BALL_DISTANCE;
    }

    // Transparent backdrop — new design (2026-04-23) removes the glass tube
    // and relies purely on the stack of PNG balls over the dark-red bg.
    this.ballContainer = new Container();
    this.addChild(this.ballContainer);
  }

  /**
   * Add a single new ball with mockup-parity animation:
   *  1. Oldest ball (if tube full) sweeps left + rotates + fades out.
   *  2. New ball spawns above tube-top and eases into slot[0].
   *  3. Existing balls shift down one slot.
   *
   * `moveTime` accelerates as the tube fills (Unity-parity formula).
   */
  addBall(number: number): void {
    const ball = this.createBall(number);
    ball.scale.set(HIGHLIGHT_SCALE);
    ball.x = this.centerX();
    ball.y = -BALL_SIZE;
    this.ballContainer.addChild(ball);

    const moveTime = getMoveAnimationTime(this.balls.length, this.showcaseCount);
    this.balls.unshift(ball);

    const overflow = this.balls.length > this.showcaseCount;

    for (let i = 0; i < this.balls.length; i++) {
      const target = this.balls[i];
      target.x = this.centerX();
      const targetY = this.slotY(i);
      gsap.killTweensOf(target);
      gsap.to(target, { y: targetY, duration: moveTime, ease: "power2.out" });
    }

    if (overflow) {
      const evicted = this.balls.pop()!;
      // Sweep LEFT with rotation + fade (mockup .drawn-ball.exiting keyframe).
      // 0% → translateX(0) rotate(-22)
      // 60% → translateX(-70) translateY(18) rotate(-60)
      // 100% → translateX(-200) translateY(40) rotate(-110) opacity(0)
      gsap.killTweensOf(evicted);
      gsap.to(evicted, {
        x: this.centerX() - 200,
        y: evicted.y + 40,
        rotation: -110 * (Math.PI / 180),
        alpha: 0,
        duration: EXIT_TIME,
        ease: "power1.in",
        onComplete: () => {
          if (evicted.destroyed) return;
          gsap.killTweensOf(evicted);
          gsap.killTweensOf(evicted.scale);
          evicted.destroy({ children: true });
        },
      });
    }
  }

  /** Restore the tube from the server snapshot — no animation. */
  loadBalls(numbers: number[]): void {
    this.clear();
    if (numbers.length === 0) return;

    const visible = numbers.slice(-this.showcaseCount);
    const reversed = [...visible].reverse();

    for (let i = 0; i < reversed.length; i++) {
      const n = reversed[i];
      const ball = this.createBall(n);
      ball.x = this.centerX();
      ball.y = this.slotY(i);
      ball.scale.set(i === 0 ? HIGHLIGHT_SCALE : NORMAL_SCALE);
      this.ballContainer.addChild(ball);
      this.balls.push(ball);
    }
  }

  clear(): void {
    // Regression (2026-04-21): kill tweens on EVERY ballContainer child, not
    // just the ones still in this.balls — the eviction path removes balls
    // from the tracked array while their exit-tween is still running.
    for (const child of this.ballContainer.children as Ball[]) {
      gsap.killTweensOf(child);
      if (child.scale) gsap.killTweensOf(child.scale);
    }
    for (const b of this.balls) {
      b.destroy({ children: true });
    }
    this.balls = [];
  }

  getLatestNumber(): number | null {
    return this.balls.length === 0 ? null : this.balls[0].ballNumber;
  }

  destroy(options?: Parameters<Container["destroy"]>[0]): void {
    this.clear();
    super.destroy(options);
  }

  private centerX(): number {
    return TUBE_WIDTH / 2;
  }

  private slotY(idx: number): number {
    return PAD_TOP + BALL_SIZE / 2 + idx * this.effectiveDistance;
  }

  private createBall(number: number): Ball {
    const ball = new Container() as Ball;
    ball.ballNumber = number;
    ball.pivot.set(BALL_SIZE / 2, BALL_SIZE / 2);

    // PNG sprite — Assets cache is pre-warmed by preloadGameAssets so this
    // is synchronous in the common case. Fall back to procedural if the
    // texture isn't ready yet (e.g. initial frame before preload settles).
    const url = getBallAssetPath(number);
    const cachedTexture = Assets.cache.get(url) as Texture | undefined;
    if (cachedTexture) {
      enableMipmaps(cachedTexture);
      const sprite = new Sprite(cachedTexture);
      sprite.width = BALL_SIZE;
      sprite.height = BALL_SIZE;
      ball.addChild(sprite);
    } else {
      // Lazy load path — kicks off the fetch, swaps sprite in when ready.
      void Assets.load(url).then((tex: Texture) => {
        if (ball.destroyed) return;
        enableMipmaps(tex);
        const sprite = new Sprite(tex);
        sprite.width = BALL_SIZE;
        sprite.height = BALL_SIZE;
        ball.addChildAt(sprite, 0);
      }).catch(() => {});
    }

    const text = new Text({
      text: String(number),
      style: {
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        fontSize: 22,
        fill: 0x1a0a0a,
        fontWeight: "800",
        align: "center",
        letterSpacing: -0.5,
      },
    });
    text.anchor.set(0.5);
    // Mockup offsets label -2px left to optically centre inside the ring graphic.
    text.x = BALL_SIZE / 2 - 2;
    text.y = BALL_SIZE / 2;
    ball.addChild(text);

    return ball;
  }
}
