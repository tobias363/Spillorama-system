/**
 * Win-popup for fase 1-4 vinn (1/2/3/4 rader) — port av WinPopup.jsx.
 *
 * Sentraloverlay med:
 *   - Logo-firkløver med drop-shadow
 *   - "Gratulerer!" heading + "Du har vunnet på N rader"
 *   - Stor gevinst-tekst med pulserende gold glow
 *   - Valgfri shared-info-boks når flere spillere vant samme fase samtidig
 *   - Flytende firkløver-partikler rundt popup
 *   - Shimmer-sweep over popup-kortet ved entry
 *   - "Lukk"-knapp i gyllen gradient
 *
 * Vises for `isMe` vinn med claimType === "LINE" (fase 1-4). Fullt Hus
 * (claimType === "BINGO") bruker {@link WinScreenV2} i stedet.
 */

/**
 * Hoved-logo i WinPopup (Tobias 2026-04-26): byttet fra lucky-clover.png til
 * Spillorama-logo for konsistens med center-cellen og brand-identitet.
 * Beholder navnet `LUCKY_CLOVER_URL` for å unngå brede import-endringer i
 * tester og kall-steder; semantikken er nå "popup-logo".
 */
const LUCKY_CLOVER_URL = "/web/games/assets/game1/design/spillorama-logo.png";
/** Auto-close delay for fase 1-4 WinPopup (regel-endring 2026-04-24 rev 3 Tobias: 3s→4s). */
const AUTO_CLOSE_DELAY_MS = 4000;

function ensureWinPopupStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("win-popup-styles")) return;
  const s = document.createElement("style");
  s.id = "win-popup-styles";
  s.textContent = `
@keyframes wp-amount-glow {
  0%,100% { text-shadow: 0 0 22px rgba(245,184,65,0.35), 0 0 44px rgba(245,184,65,0.15); }
  50%     { text-shadow: 0 0 34px rgba(245,184,65,0.6), 0 0 64px rgba(245,184,65,0.3); }
}
@keyframes wp-float {
  0%   { transform: translate(var(--sx, 0px), var(--sy, 0px)) rotate(var(--r0, 0deg)) scale(var(--s, 1)); opacity: 0; }
  10%  { opacity: var(--maxOp, 0.55); }
  50%  { transform: translate(calc(var(--sx, 0px) + var(--dx, 20px)), calc(var(--sy, 0px) - 30px)) rotate(calc(var(--r0, 0deg) + 20deg)) scale(var(--s, 1)); }
  90%  { opacity: var(--maxOp, 0.55); }
  100% { transform: translate(calc(var(--sx, 0px) + var(--dx2, 40px)), var(--sy, 0px)) rotate(calc(var(--r0, 0deg) + 40deg)) scale(var(--s, 1)); opacity: 0; }
}
@keyframes wp-shimmer {
  0%   { transform: translateX(-120%) skewX(-20deg); }
  100% { transform: translateX(220%) skewX(-20deg); }
}
.wp-btn-primary:hover {
  background: linear-gradient(180deg, #f5c35a 0%, #d89532 100%) !important;
  transform: translateY(-1px);
  box-shadow: 0 10px 28px rgba(245,184,65,0.4) !important;
}
.wp-btn-primary:active { transform: translateY(0); }
`;
  document.head.appendChild(s);
}

export interface WinPopupOptions {
  rows: number;
  amount: number;
  shared?: boolean;
  sharedCount?: number;
  logoSrc?: string;
  onClose?: () => void;
}

export class WinPopup {
  private backdrop: HTMLDivElement | null = null;
  private parent: HTMLElement;
  private autoCloseTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(parent: HTMLElement) {
    this.parent = parent;
    ensureWinPopupStyles();
  }

  show(opts: WinPopupOptions): void {
    this.hide();
    const logoSrc = opts.logoSrc ?? LUCKY_CLOVER_URL;
    const shared = opts.shared ?? false;
    const sharedCount = opts.sharedCount ?? 2;
    const radText = opts.rows === 1 ? "rad" : "rader";
    const personText = sharedCount === 1 ? "person" : "personer";
    const amountFormatted = opts.amount.toLocaleString("no-NO").replace(/,/g, " ");

    const backdrop = document.createElement("div");
    Object.assign(backdrop.style, {
      position: "fixed",
      inset: "0",
      zIndex: "1000",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(10, 4, 4, 0.72)",
      backdropFilter: "blur(4px)",
      opacity: "0",
      transition: "opacity 220ms ease-out",
    });

    const wrap = document.createElement("div");
    Object.assign(wrap.style, {
      position: "absolute",
      top: "50%",
      left: "50%",
      width: "440px",
      opacity: "0",
      transform: "translate(-50%, -50%) scale(0.82)",
      transition: "opacity 360ms ease-out, transform 480ms cubic-bezier(0.34, 1.56, 0.64, 1)",
      transformOrigin: "center",
    });
    backdrop.appendChild(wrap);

    // Floating clovers bak kortet.
    wrap.appendChild(this.buildFloatingClovers(logoSrc));

    // Popup-kort.
    const card = document.createElement("div");
    Object.assign(card.style, {
      position: "relative",
      zIndex: "1",
      background: "linear-gradient(180deg, #2a1010 0%, #1d0a0a 100%)",
      borderRadius: "20px",
      padding: "40px 32px 28px",
      border: "1px solid rgba(245,184,65,0.18)",
      boxShadow: "0 30px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04) inset, 0 0 60px rgba(245,184,65,0.08)",
      overflow: "hidden",
      fontFamily: "'Poppins', system-ui, sans-serif",
      textAlign: "center",
      color: "#f4e8d0",
    });
    wrap.appendChild(card);

    // Shimmer-sweep.
    const shimmer = document.createElement("div");
    Object.assign(shimmer.style, {
      position: "absolute",
      top: "0",
      left: "0",
      width: "50%",
      height: "100%",
      background: "linear-gradient(90deg, transparent, rgba(245,184,65,0.12), transparent)",
      animation: "wp-shimmer 1400ms ease-out 300ms 1 both",
      pointerEvents: "none",
    });
    card.appendChild(shimmer);

    // Logo.
    const logoWrap = document.createElement("div");
    Object.assign(logoWrap.style, {
      width: "88px",
      height: "88px",
      margin: "0 auto 22px",
      filter: "drop-shadow(0 10px 24px rgba(245,184,65,0.45))",
    });
    const logoImg = document.createElement("img");
    logoImg.src = logoSrc;
    logoImg.alt = "";
    logoImg.draggable = false;
    Object.assign(logoImg.style, {
      width: "100%",
      height: "100%",
      objectFit: "contain",
    });
    logoWrap.appendChild(logoImg);
    card.appendChild(logoWrap);

    // Heading.
    const heading = document.createElement("div");
    heading.textContent = "Gratulerer!";
    Object.assign(heading.style, {
      fontSize: "20px",
      fontWeight: "700",
      color: "#f4e8d0",
      lineHeight: "1.35",
      marginBottom: "6px",
    });
    card.appendChild(heading);

    // Subline "Du har vunnet på N rader".
    const subline = document.createElement("div");
    subline.innerHTML = `Du har vunnet på <strong style="color:#f5c842;font-weight:700;">${opts.rows} ${radText}</strong>`;
    Object.assign(subline.style, {
      fontSize: "15px",
      fontWeight: "500",
      color: "rgba(244,232,208,0.75)",
      marginBottom: "24px",
      lineHeight: "1.45",
    });
    card.appendChild(subline);

    // Amount.
    const amountEl = document.createElement("div");
    amountEl.textContent = `${amountFormatted} kr`;
    Object.assign(amountEl.style, {
      fontSize: "56px",
      fontWeight: "900",
      color: "#f5c842",
      lineHeight: "1",
      letterSpacing: "-0.02em",
      marginBottom: shared ? "16px" : "32px",
      animation: "wp-amount-glow 2.4s ease-in-out infinite",
    });
    card.appendChild(amountEl);

    // Shared-info (kun hvis flere vinnere).
    if (shared) {
      const sharedBox = document.createElement("div");
      sharedBox.innerHTML = `Gevinsten deles fordi <strong style="color:rgba(244,232,208,0.9);font-weight:700;">${sharedCount} ${personText}</strong> fikk <strong style="color:rgba(244,232,208,0.9);font-weight:700;">${opts.rows} ${radText}</strong> samtidig.`;
      Object.assign(sharedBox.style, {
        fontSize: "13px",
        fontWeight: "500",
        color: "rgba(244,232,208,0.65)",
        lineHeight: "1.5",
        marginBottom: "28px",
        padding: "12px 14px",
        background: "rgba(255,255,255,0.035)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "10px",
      });
      card.appendChild(sharedBox);
    }

    // Lukk-knapp.
    const btnRow = document.createElement("div");
    btnRow.style.display = "flex";
    const closeBtn = document.createElement("button");
    closeBtn.className = "wp-btn-primary";
    closeBtn.textContent = "Lukk";
    Object.assign(closeBtn.style, {
      width: "100%",
      padding: "14px 20px",
      fontSize: "15px",
      fontWeight: "700",
      fontFamily: "inherit",
      color: "#1a0808",
      background: "linear-gradient(180deg, #f5b841 0%, #c88922 100%)",
      border: "none",
      borderRadius: "12px",
      cursor: "pointer",
      letterSpacing: "0.02em",
      boxShadow: "0 6px 20px rgba(245,184,65,0.25)",
      transition: "all 180ms ease",
    });
    closeBtn.addEventListener("click", () => {
      this.hide();
      opts.onClose?.();
    });
    btnRow.appendChild(closeBtn);
    card.appendChild(btnRow);

    // Mount + mount-animasjon (opacity + scale-in).
    this.parent.appendChild(backdrop);
    this.backdrop = backdrop;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        backdrop.style.opacity = "1";
        wrap.style.opacity = "1";
        wrap.style.transform = "translate(-50%, -50%) scale(1)";
      });
    });

    // Auto-close etter 4s (regel-endring 2026-04-24 rev 3 Tobias). Lukk-
    // knappen overstyrer ved manuelt klikk.
    this.autoCloseTimer = setTimeout(() => {
      this.hide();
      opts.onClose?.();
    }, AUTO_CLOSE_DELAY_MS);
  }

  hide(): void {
    if (this.autoCloseTimer !== null) {
      clearTimeout(this.autoCloseTimer);
      this.autoCloseTimer = null;
    }
    if (!this.backdrop) return;
    this.backdrop.remove();
    this.backdrop = null;
  }

  destroy(): void {
    this.hide();
  }

  private buildFloatingClovers(logoSrc: string): HTMLDivElement {
    const container = document.createElement("div");
    Object.assign(container.style, {
      position: "absolute",
      inset: "0",
      pointerEvents: "none",
      overflow: "visible",
      zIndex: "0",
    });
    const COUNT = 14;
    for (let i = 0; i < COUNT; i++) {
      const j = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
      const j2 = Math.abs(Math.sin(i * 78.233) * 43758.5453) % 1;
      const angle = (i / COUNT) * Math.PI * 2;
      const radius = 180 + j * 70;
      const sx = Math.cos(angle) * radius;
      const sy = Math.sin(angle) * radius * 0.75;
      const dx = j2 * 40 - 20;
      const dx2 = j2 * 80 - 40;
      const size = 22 + ((i * 7) % 20);
      const r0 = ((i * 47) % 60) - 30;
      const sScale = 0.7 + j * 0.5;
      const maxOp = 0.35 + j2 * 0.35;
      const delay = (i * 0.28) % 3.2;
      const dur = 5 + j * 3;

      const item = document.createElement("div");
      // BLINK-FIX (round 3, hazard 4): Fjernet `will-change:transform, opacity`.
      // Chrome auto-promoterer animerte elementer; `will-change` brukte
      // unødvendig GPU-minne og bidro til layer-eviction-pressure.
      item.style.cssText = [
        "position:absolute",
        "top:50%",
        "left:50%",
        `width:${size}px`,
        `height:${size}px`,
        `margin-left:${-size / 2}px`,
        `margin-top:${-size / 2}px`,
        `animation:wp-float ${dur}s ease-in-out ${delay}s infinite`,
        "filter:drop-shadow(0 4px 10px rgba(0,0,0,0.35))",
      ].join(";");
      item.style.setProperty("--sx", `${sx}px`);
      item.style.setProperty("--sy", `${sy}px`);
      item.style.setProperty("--dx", `${dx}px`);
      item.style.setProperty("--dx2", `${dx2}px`);
      item.style.setProperty("--r0", `${r0}deg`);
      item.style.setProperty("--s", String(sScale));
      item.style.setProperty("--maxOp", String(maxOp));

      const img = document.createElement("img");
      img.src = logoSrc;
      img.alt = "";
      img.draggable = false;
      img.style.cssText = "width:100%;height:100%;object-fit:contain;";
      item.appendChild(img);
      container.appendChild(item);
    }
    return container;
  }
}
