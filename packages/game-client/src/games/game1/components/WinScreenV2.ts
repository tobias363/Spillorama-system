/**
 * Fullskjerm "Bingo! Du vant"-scene for Fullt Hus — port av WinScreenV2.jsx.
 *
 * Sekvens:
 *   1. Partikkel-fontene (70 firkløver-logoer) skytes opp nedenfra og faller
 *      tilbake med tyngdekraft (FOSS_DURATION_MS = 3600ms). rAF-animert.
 *   2. Flash-radial-gradient overlay fades inn/ut samtidig (v2-flash).
 *   3. Etter fontene er ferdig: headline + stor gevinst-tekst + subline
 *      fades inn med translateY/scale. Gevinst teller opp over 2.2s med
 *      cubic-ease-out.
 *   4. "Tilbake"-knapp fades inn sist (regel-endring 2026-04-24 Tobias:
 *      erstattet "Spill av på nytt" + "Skru av").
 *
 * Vises for `isMe` vinn med claimType === "BINGO" (Fullt Hus). Mindre
 * premier (fase 1-4) bruker {@link WinPopup}.
 *
 * Shared-variant: Hvis flere spillere vant Fullt Hus samtidig, vises en
 * shared-info-linje under amount som forklarer at premien er delt.
 *
 * Timing-regel (2026-04-24 Tobias, rev 3): auto-close kjører 5s ETTER at
 * animasjonen (fountain + count-up) er ferdig — ikke 5s totalt. Mockup-
 * parity-animasjonslengder gjenopprettet (3.6s fountain, 2.2s count-up).
 * Totalt: 3.6 + 2.2 + 5.0 = 10.8s til auto-close. Tilbake-knappen overstyrer.
 */

const LUCKY_CLOVER_URL = "/web/games/assets/game1/design/lucky-clover.png";
const FOSS_DURATION_MS = 3600;
const LOGO_COUNT = 70;
const COUNT_UP_DURATION_MS = 2200;
/** Dvelings-tid etter animasjonen er ferdig før auto-close (rev 3 2026-04-24
 *  Tobias). Auto-close = FOSS_DURATION_MS + COUNT_UP_DURATION_MS + dette.
 *  Tilbake-knappen overstyrer. */
const POST_ANIMATION_DWELL_MS = 5000;
const AUTO_CLOSE_DELAY_MS = FOSS_DURATION_MS + COUNT_UP_DURATION_MS + POST_ANIMATION_DWELL_MS;

function ensureWinScreenStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("win-styles-v2")) return;
  const s = document.createElement("style");
  s.id = "win-styles-v2";
  s.textContent = `
@keyframes v2-sparkle { 0%,100% { opacity: 0.2; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1.2); } }
@keyframes v2-amount-glow {
  0%,100% { text-shadow: 0 0 30px rgba(245,184,65,0.3), 0 0 60px rgba(245,184,65,0.15); }
  50%     { text-shadow: 0 0 50px rgba(245,184,65,0.6), 0 0 100px rgba(245,184,65,0.35); }
}
@keyframes v2-text-in {
  from { opacity: 0; transform: translateY(24px) scale(0.92); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes v2-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes v2-flash {
  0%   { opacity: 0; }
  30%  { opacity: 0; }
  50%  { opacity: 0.35; }
  100% { opacity: 0; }
}
`;
  document.head.appendChild(s);
}

interface FountainParticle {
  delayMs: number;
  size: number;
  vx: number;
  vy: number;
  gravity: number;
  r0: number;
  rspin: number;
}

function generateFountainParticles(): FountainParticle[] {
  const particles: FountainParticle[] = [];
  const GRAVITY = 1600;
  for (let i = 0; i < LOGO_COUNT; i++) {
    const jitter = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
    const jitter2 = Math.abs(Math.sin(i * 78.233) * 43758.5453) % 1;
    const delayMs = (i / LOGO_COUNT) * 1800 + jitter * 60;
    const angleFromVertical = (jitter2 * 2 - 1) * 18;
    const angleRad = ((-90 + angleFromVertical) * Math.PI) / 180;
    const speed = 1350 + jitter * 550;
    particles.push({
      delayMs,
      size: 44 + ((i * 23) % 56),
      vx: Math.cos(angleRad) * speed,
      vy: Math.sin(angleRad) * speed,
      gravity: GRAVITY,
      r0: ((i * 47) % 60) - 30,
      rspin: (200 + ((i * 31) % 240)) * (i % 2 === 0 ? 1 : -1),
    });
  }
  return particles;
}

function formatKr(n: number): string {
  return n.toLocaleString("no-NO").replace(/\s/g, " ").replace(/,/g, " ");
}

export interface WinScreenV2Options {
  amount: number;
  shared?: boolean;
  sharedCount?: number;
  logoSrc?: string;
  headline?: string;
  subline?: string;
  /** Trigget av Tilbake-knappen ELLER auto-close 5s etter at animasjonen er ferdig. */
  onDismiss?: () => void;
}

export class WinScreenV2 {
  private root: HTMLDivElement | null = null;
  private parent: HTMLElement;
  private rafId: number | null = null;
  private countUpRaf: number | null = null;
  private textActiveTimer: ReturnType<typeof setTimeout> | null = null;
  private autoCloseTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(parent: HTMLElement) {
    this.parent = parent;
    ensureWinScreenStyles();
  }

  show(opts: WinScreenV2Options): void {
    this.hide();
    const logoSrc = opts.logoSrc ?? LUCKY_CLOVER_URL;
    const headline = opts.headline ?? "BINGO! DU VANT";
    const subline = opts.subline ?? "GRATULERER MED GEVINSTEN";
    const shared = opts.shared ?? false;
    const sharedCount = opts.sharedCount ?? 2;

    const root = document.createElement("div");
    Object.assign(root.style, {
      position: "fixed",
      inset: "0",
      zIndex: "1000",
      background: "radial-gradient(ellipse at center, #3a1418 0%, #1a0809 60%, #0a0405 100%)",
      overflow: "hidden",
      fontFamily: "'Inter', system-ui, sans-serif",
      color: "#f5e8d8",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "40px",
    });

    // Sparkles (50 små prikker som blinker sporadisk).
    root.appendChild(this.buildSparkles());

    // Fountain rAF-beholder.
    const { fountainEl, particleNodes } = this.buildFountainScaffold(logoSrc);
    root.appendChild(fountainEl);

    // Flash-radial-gradient overlay.
    const flash = document.createElement("div");
    Object.assign(flash.style, {
      position: "absolute",
      inset: "0",
      background: "radial-gradient(ellipse 70% 60% at center 70%, rgba(245,184,65,0.2) 0%, transparent 60%)",
      pointerEvents: "none",
      zIndex: "2",
      animation: `v2-flash ${FOSS_DURATION_MS}ms ease-out both`,
    });
    root.appendChild(flash);

    // Vignett.
    const vignette = document.createElement("div");
    Object.assign(vignette.style, {
      position: "absolute",
      inset: "0",
      background: "radial-gradient(ellipse at center, transparent 30%, rgba(10,4,5,0.6) 100%)",
      pointerEvents: "none",
      zIndex: "1",
    });
    root.appendChild(vignette);

    // Tekst-container (skjult inntil fontene er ferdig).
    const textCol = document.createElement("div");
    Object.assign(textCol.style, {
      position: "relative",
      zIndex: "3",
      textAlign: "center",
      opacity: "0",
      pointerEvents: "none",
    });

    const headlineEl = document.createElement("div");
    headlineEl.textContent = headline;
    Object.assign(headlineEl.style, {
      fontFamily: "'Poppins', sans-serif",
      fontSize: "14px",
      fontWeight: "800",
      letterSpacing: "0.38em",
      color: "#f5c842",
      marginBottom: "20px",
      textShadow: "0 0 20px rgba(245,184,65,0.5)",
    });
    textCol.appendChild(headlineEl);

    const amountEl = document.createElement("div");
    Object.assign(amountEl.style, {
      fontFamily: "'Poppins', sans-serif",
      fontSize: "clamp(72px, 14vw, 200px)",
      fontWeight: "900",
      lineHeight: "0.95",
      letterSpacing: "-0.01em",
      background: "linear-gradient(180deg, #fff8d8 0%, #f5c842 40%, #d89818 75%, #8a5810 100%)",
      webkitBackgroundClip: "text",
      backgroundClip: "text",
      color: "transparent",
      fontVariantNumeric: "tabular-nums",
      whiteSpace: "nowrap",
    });
    // WebKit-spesifikk transparent fill.
    amountEl.style.setProperty("-webkit-background-clip", "text");
    amountEl.style.setProperty("-webkit-text-fill-color", "transparent");
    amountEl.textContent = "0 kr";
    textCol.appendChild(amountEl);

    const sublineEl = document.createElement("div");
    sublineEl.textContent = subline;
    Object.assign(sublineEl.style, {
      fontFamily: "'Poppins', sans-serif",
      fontSize: "12px",
      fontWeight: "700",
      letterSpacing: "0.34em",
      color: "rgba(245,232,216,0.75)",
      marginTop: "20px",
    });
    textCol.appendChild(sublineEl);

    // Shared-info (kun hvis flere vinnere).
    if (shared) {
      const sharedBox = document.createElement("div");
      const personText = sharedCount === 1 ? "person" : "personer";
      sharedBox.textContent = `Gevinsten deles på ${sharedCount} ${personText} som vant Fullt Hus samtidig.`;
      Object.assign(sharedBox.style, {
        fontFamily: "'Poppins', sans-serif",
        fontSize: "13px",
        fontWeight: "500",
        color: "rgba(245,232,216,0.7)",
        marginTop: "16px",
        padding: "10px 18px",
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "10px",
        display: "inline-block",
      });
      textCol.appendChild(sharedBox);
    }

    // Knapper.
    const btnRow = document.createElement("div");
    Object.assign(btnRow.style, {
      display: "flex",
      gap: "12px",
      justifyContent: "center",
      marginTop: "60px",
    });

    // Tilbake-knapp (erstatter "Spill av på nytt" + "Skru av" 2026-04-24).
    // Samme handler som auto-close: hide() + onDismiss(). Spiller kan trykke
    // for å hoppe over ventingen (auto-close fyrer 5s etter animasjonen).
    const backBtn = document.createElement("button");
    backBtn.textContent = "Tilbake";
    Object.assign(backBtn.style, {
      border: "none",
      borderRadius: "999px",
      padding: "14px 36px",
      background: "linear-gradient(180deg, #f5c842 0%, #d89818 100%)",
      color: "#2a1400",
      fontSize: "12px",
      fontWeight: "700",
      letterSpacing: "0.14em",
      fontFamily: "'Poppins', sans-serif",
      cursor: "pointer",
      boxShadow: "0 6px 24px rgba(245,184,65,0.4), inset 0 1px 0 rgba(255,255,255,0.4)",
      textTransform: "uppercase",
    });
    backBtn.addEventListener("click", () => {
      this.hide();
      opts.onDismiss?.();
    });
    btnRow.appendChild(backBtn);
    textCol.appendChild(btnRow);

    root.appendChild(textCol);
    this.parent.appendChild(root);
    this.root = root;

    // Start fontene-rAF.
    this.startFountain(particleNodes);

    // Etter FOSS_DURATION_MS: fade inn tekst + count-up.
    this.textActiveTimer = setTimeout(() => {
      textCol.style.opacity = "1";
      textCol.style.pointerEvents = "auto";
      headlineEl.style.animation = "v2-text-in 0.6s cubic-bezier(.2,.9,.3,1) 0s both";
      amountEl.style.animation = "v2-text-in 0.7s cubic-bezier(.2,.9,.3,1) 0.15s both, v2-amount-glow 2.2s ease-in-out 0.9s infinite";
      sublineEl.style.animation = "v2-text-in 0.6s cubic-bezier(.2,.9,.3,1) 0.35s both";
      btnRow.style.animation = "v2-fade-in 0.8s ease-out 0.8s both";
      this.startCountUp(opts.amount, amountEl);
    }, FOSS_DURATION_MS);

    // Auto-close 5s ETTER animasjonen er ferdig (regel-endring 2026-04-24
    // rev 3 Tobias). Delay = FOSS_DURATION_MS + COUNT_UP_DURATION_MS + 5s.
    // Totalt ~10.8s. Tilbake-knappen overstyrer.
    this.autoCloseTimer = setTimeout(() => {
      this.hide();
      opts.onDismiss?.();
    }, AUTO_CLOSE_DELAY_MS);
  }

  hide(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.countUpRaf !== null) {
      cancelAnimationFrame(this.countUpRaf);
      this.countUpRaf = null;
    }
    if (this.textActiveTimer !== null) {
      clearTimeout(this.textActiveTimer);
      this.textActiveTimer = null;
    }
    if (this.autoCloseTimer !== null) {
      clearTimeout(this.autoCloseTimer);
      this.autoCloseTimer = null;
    }
    if (this.root) {
      this.root.remove();
      this.root = null;
    }
  }

  destroy(): void {
    this.hide();
  }

  private buildSparkles(): HTMLDivElement {
    const container = document.createElement("div");
    Object.assign(container.style, {
      position: "absolute",
      inset: "0",
      pointerEvents: "none",
      zIndex: "1",
    });
    for (let i = 0; i < 50; i++) {
      const size = 1 + (i % 3);
      const delay = (i * 0.17) % 3;
      const dot = document.createElement("div");
      Object.assign(dot.style, {
        position: "absolute",
        top: `${(i * 37) % 100}%`,
        left: `${(i * 53 + 11) % 100}%`,
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: "999px",
        background: "#f5c842",
        animation: `v2-sparkle 2.5s ease-in-out ${delay}s infinite`,
        boxShadow: "0 0 6px #f5c842",
      });
      container.appendChild(dot);
    }
    return container;
  }

  private buildFountainScaffold(logoSrc: string): {
    fountainEl: HTMLDivElement;
    particleNodes: Array<{ node: HTMLDivElement; particle: FountainParticle }>;
  } {
    const outer = document.createElement("div");
    Object.assign(outer.style, {
      position: "absolute",
      inset: "0",
      pointerEvents: "none",
      overflow: "hidden",
      zIndex: "2",
    });
    const emitter = document.createElement("div");
    Object.assign(emitter.style, {
      position: "absolute",
      bottom: "0",
      left: "50%",
      width: "0",
      height: "0",
    });
    outer.appendChild(emitter);

    const particles = generateFountainParticles();
    const particleNodes: Array<{ node: HTMLDivElement; particle: FountainParticle }> = [];
    for (const p of particles) {
      const node = document.createElement("div");
      Object.assign(node.style, {
        position: "absolute",
        top: "0",
        left: "0",
        width: `${p.size}px`,
        height: `${p.size}px`,
        marginLeft: `${-p.size / 2}px`,
        marginTop: `${-p.size / 2}px`,
        opacity: "0",
        // BLINK-FIX (round 3, hazard 4): Fjernet `willChange: "transform, opacity"`.
        // Chrome auto-promoterer transform-animerte elementer til composite-layer
        // — `will-change` er over-aggressivt og holder GPU-minne reservert
        // selv når elementet ikke animerer.
        transform: "translate3d(0, 0, 0)",
        filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.4))",
      });
      const img = document.createElement("img");
      img.src = logoSrc;
      img.alt = "";
      img.draggable = false;
      img.style.cssText = "width:100%;height:100%;object-fit:contain;";
      node.appendChild(img);
      emitter.appendChild(node);
      particleNodes.push({ node, particle: p });
    }

    return { fountainEl: outer, particleNodes };
  }

  private startFountain(
    particleNodes: Array<{ node: HTMLDivElement; particle: FountainParticle }>,
  ): void {
    const startTs = performance.now();
    const tick = (now: number): void => {
      const elapsed = now - startTs;
      for (const { node, particle: p } of particleNodes) {
        const tSec = (elapsed - p.delayMs) / 1000;
        if (tSec < 0) {
          node.style.opacity = "0";
          continue;
        }
        const x = p.vx * tSec;
        const y = p.vy * tSec + 0.5 * p.gravity * tSec * tSec;
        const rot = p.r0 + p.rspin * tSec * 0.4;
        let opacity = 1;
        if (tSec < 0.12) opacity = tSec / 0.12;
        if (y > 300) opacity *= Math.max(0, 1 - (y - 300) / 400);
        node.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${rot}deg)`;
        node.style.opacity = String(opacity);
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private startCountUp(target: number, el: HTMLElement): void {
    const startTs = performance.now();
    const step = (now: number): void => {
      const t = Math.min((now - startTs) / COUNT_UP_DURATION_MS, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const value = Math.round(target * eased);
      el.textContent = `${formatKr(value)} kr`;
      if (t < 1) {
        this.countUpRaf = requestAnimationFrame(step);
      }
    };
    this.countUpRaf = requestAnimationFrame(step);
  }

}
