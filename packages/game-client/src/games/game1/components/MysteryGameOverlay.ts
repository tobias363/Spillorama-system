/**
 * BIN-MYSTERY M6: Mystery Joker overlay — moderne redesign (Tobias 2026-04-26).
 *
 * Tidligere Pixi-only port-1:1 av Unity MysteryGamePanel.cs erstattet med
 * DOM-basert "modern" design (smal, mørk gradient + gull-accent, intro-overlay,
 * ModernLadder + arena med chevron-arrows). Pixi-Container-superklassen
 * beholdes for å oppfylle MiniGameRouter-kontrakten — selve kontent renderes
 * som HTML/CSS over canvas-parent (samme mønster som WinPopup).
 *
 * Trigger payload (fra MiniGameMysteryEngine — uendret):
 *   `{ middleNumber, resultNumber, prizeListNok: number[6], maxRounds: 5,
 *      autoTurnFirstMoveSec, autoTurnOtherMoveSec }`
 *
 * Choice payload (uendret): `{ directions: ("up"|"down")[] }` — 1..5 elementer.
 *
 * Result payload (uendret):
 *   `{ middleNumber, resultNumber, rounds: MysteryRoundResult[],
 *      finalPriceIndex, prizeAmountKroner, jokerTriggered }`
 *
 * UX-flyt (server-autoritativ):
 *   - 2 sek intro-overlay viser "MYSTERY JOKER" + joker-emblem.
 *   - Modal med 5 mystery-baller i arena, premie-stige til venstre.
 *   - Aktiv runde: pulserende gul aura + OPP/NED-chevron over/under ballen.
 *   - Klikk fyrer optimistisk reveal (server validerer); priceIndex-arrow
 *     tweener til ny posisjon.
 *   - Joker (equal digits) avslutter spillet umiddelbart.
 *   - Etter alle runder/joker: server-result driver final-state +
 *     "Spill igjen"-knapp (auto-dismiss etter ~6 sek).
 *
 * Performance:
 *   - Composite-friendly: kun transform/opacity-animasjoner. Ingen
 *     backdrop-filter (PR #468-mønster). Ingen will-change.
 *   - GSAP brukes ikke i DOM-laget — alt er CSS keyframes / transitions.
 *
 * Test-kompatibilitet:
 *   - Beholder `__Mystery_getDigitAt` + `__Mystery_AUTO_DISMISS_AFTER_RESULT_SECONDS__`
 *     for eksisterende tester.
 *   - Private felter `middleBalls`, `prizeLadderSteps`, `collectedDirections`,
 *     `resultText`, `errorText`, `maxRounds`, `prizeListNok` matcher tidligere
 *     tester (selv om implementasjonen er DOM-basert nå).
 */

import { Container } from "pixi.js";

const JOKER_IMG_URL = "/web/games/assets/game1/design/lucky-clover.png";
/**
 * Joker-crown bilde brukt i intro-animasjon og som logo-emblem ved
 * jackpot-result. Plassert til høyre for "MYSTERY JOKER"-tekst (Tobias
 * 2026-04-26). Source: `Nye bilder subgames spill 1/jokernord.png` →
 * `packages/game-client/public/assets/game1/design/joker-crown.png`.
 */
const JOKER_CROWN_IMG_URL = "/web/games/assets/game1/design/joker-crown.png";
/**
 * Mystery-baller bruker samme PNG-baller som hoved-spillet (BallTube).
 * JSX-spec viser `variant="red"` overalt, så vi bruker red.png som
 * default for pending-state. Outcome-state (correct/wrong/joker) mapper
 * til color-coded baller (green/red/yellow). Tekst-digit rendres som
 * overlay over PNG-en.
 */
const MYSTERY_BALL_DEFAULT_URL = "/web/games/assets/game1/design/balls/red.png";
const MYSTERY_BALL_CORRECT_URL = "/web/games/assets/game1/design/balls/green.png";
const MYSTERY_BALL_WRONG_URL = "/web/games/assets/game1/design/balls/red.png";
const MYSTERY_BALL_JOKER_URL = "/web/games/assets/game1/design/balls/yellow.png";
const AUTO_DISMISS_AFTER_RESULT_SECONDS = 6;
const INTRO_DURATION_MS = 2000;
const REVEAL_DELAY_MS = 600;
const FINAL_DELAY_MS = 800;

interface MysteryTriggerPayload {
  middleNumber?: number;
  resultNumber?: number;
  prizeListNok?: number[];
  maxRounds?: number;
  autoTurnFirstMoveSec?: number;
  autoTurnOtherMoveSec?: number;
}

interface MysteryRoundResult {
  direction?: "up" | "down";
  middleDigit?: number;
  resultDigit?: number;
  outcome?: "correct" | "wrong" | "joker";
  priceIndexAfter?: number;
}

interface MysteryResultJson {
  middleNumber?: number;
  resultNumber?: number;
  rounds?: MysteryRoundResult[];
  finalPriceIndex?: number;
  prizeAmountKroner?: number;
  jokerTriggered?: boolean;
}

interface BallInfo {
  digit: number;
  resultDigit: number;
  outcome: "pending" | "correct" | "wrong" | "joker";
  shownDigit: number;
  reveal: { direction: "up" | "down"; value: number } | null;
}

/**
 * Hent siffer N fra et 5-sifret tall, talt fra HØYRE (N=0 er ones-sifferet).
 * Matcher backend `getDigitAt` i MiniGameMysteryEngine.ts.
 */
function getDigitAt(n: number, index: number): number {
  const padded = Math.max(0, n).toString().padStart(5, "0");
  const ch = padded[padded.length - 1 - index];
  if (ch === undefined) return 0;
  return Number.parseInt(ch, 10);
}

/**
 * Sentralt CSS-styles for Mystery Joker. Idempotent — appendes kun én gang.
 * Følger Spillorama-konvensjon (jf. WinPopup.ts `ensureWinPopupStyles`).
 *
 * KRITISK (PR #468-mønster):
 *   - Ingen backdrop-filter (Pixi-canvas under → composite-recompute per frame).
 *   - Kun transform/opacity i animasjoner (composite-friendly).
 *   - Ingen `will-change` (Chrome auto-promoterer; will-change presser GPU-mem).
 */
function ensureMysteryStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("mystery-joker-styles")) return;
  const s = document.createElement("style");
  s.id = "mystery-joker-styles";
  s.textContent = `
@keyframes mj-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes mj-content-fade {
  from { opacity: 0; transform: translate(-50%, -50%) scale(0.96); }
  to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
}
@keyframes mj-intro-text {
  0%   { opacity: 0; transform: translateY(-20px) scale(0.92); }
  20%  { opacity: 1; transform: translateY(0) scale(1); }
  80%  { opacity: 1; transform: translateY(0) scale(1); }
  100% { opacity: 0; transform: translateY(0) scale(1.04); }
}
@keyframes mj-intro-joker {
  0%   { opacity: 0; transform: scale(0.4) rotate(-30deg); }
  30%  { opacity: 1; transform: scale(1.1) rotate(8deg); }
  60%  { opacity: 1; transform: scale(1) rotate(0deg); }
  100% { opacity: 0; transform: scale(1.05) rotate(-4deg); }
}
@keyframes mj-reveal-drop {
  from { opacity: 0; transform: translateY(-12px) scale(0.85); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes mj-active-pulse {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(1.06); }
}
@keyframes mj-active-aura {
  0%, 100% { opacity: 0.55; }
  50%      { opacity: 0.95; }
}
@keyframes mj-confetti {
  0%   { transform: translate(0, 0) rotate(0deg); opacity: 1; }
  100% { transform: translate(var(--mj-cx, 0px), var(--mj-cy, 220px)) rotate(var(--mj-cr, 540deg)); opacity: 0; }
}
@keyframes mj-amount-glow {
  0%, 100% { text-shadow: 0 0 14px rgba(255,232,61,0.4); }
  50%      { text-shadow: 0 0 24px rgba(255,232,61,0.7); }
}
.mj-arrow-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 14px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,232,61,0.32);
  border-radius: 8px;
  color: rgba(255,232,61,0.85);
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 1.5px;
  cursor: pointer;
  transition: transform 140ms ease, background 140ms ease, border-color 140ms ease, color 140ms ease;
}
.mj-arrow-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  background: rgba(255,232,61,0.10);
  border-color: rgba(255,232,61,0.6);
  color: #ffe83d;
}
.mj-arrow-btn:active:not(:disabled) {
  transform: translateY(0);
}
.mj-arrow-btn:disabled {
  cursor: default;
  opacity: 0.35;
}
.mj-cta {
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.6px;
  padding: 10px 20px;
  border-radius: 8px;
  background: linear-gradient(180deg, #ffe83d 0%, #d4a52a 100%);
  color: #1a0808;
  border: none;
  cursor: pointer;
  box-shadow: 0 6px 16px rgba(255,232,61,0.25);
  transition: transform 140ms ease, box-shadow 140ms ease;
}
.mj-cta:hover { transform: translateY(-1px); box-shadow: 0 10px 24px rgba(255,232,61,0.35); }
.mj-cta:active { transform: translateY(0); }
.mj-prize-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 6px;
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 13px;
  font-weight: 600;
  color: rgba(255,255,255,0.55);
  font-variant-numeric: tabular-nums;
  transition: background 200ms ease, color 200ms ease;
}
.mj-prize-row .mj-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(255,255,255,0.15);
  flex-shrink: 0;
  transition: background 200ms ease, box-shadow 200ms ease;
}
.mj-prize-row[data-active="true"] {
  background: rgba(255,232,61,0.10);
  color: #ffe83d;
}
.mj-prize-row[data-active="true"] .mj-dot {
  background: #ffe83d;
  box-shadow: 0 0 10px rgba(255,232,61,0.6);
}
.mj-prize-row[data-max="true"][data-active="true"] {
  background: linear-gradient(90deg, rgba(255,122,26,0.18), rgba(255,232,61,0.18));
}
.mj-ball {
  position: relative;
  width: 68px;
  height: 68px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 28px;
  font-weight: 800;
  color: #1a0a0a;
  filter: drop-shadow(0 4px 10px rgba(0,0,0,0.4));
  transition: transform 200ms ease;
}
.mj-ball-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
  user-select: none;
  -webkit-user-drag: none;
}
.mj-ball-digit {
  position: relative;
  z-index: 1;
  text-shadow: 0 1px 0 rgba(255,255,255,0.4), 0 2px 4px rgba(0,0,0,0.25);
  letter-spacing: -0.5px;
  /* Optisk justering for å sentrere innenfor PNG-ringen (matcher
     BallTube text.x = BALL_SIZE/2 - 2). */
  transform: translateX(-2px);
}
.mj-ball-joker .mj-ball-digit {
  color: #1a0808;
  text-shadow: 0 1px 0 rgba(255,255,255,0.3);
}
.mj-aura {
  position: absolute;
  inset: -6px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255,232,61,0.35), transparent 70%);
  pointer-events: none;
  animation: mj-active-aura 1.6s ease-in-out infinite;
}
.mj-confetti-piece {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 8px;
  height: 14px;
  border-radius: 2px;
  pointer-events: none;
  animation: mj-confetti 1400ms ease-out forwards;
}
`;
  document.head.appendChild(s);
}

/**
 * Finn DOM-parent for overlayet. Foretrekker canvas-parent (samme oppførsel
 * som andre game-overlays); fallback til `document.body` for tester +
 * tilfeller hvor canvas ikke finnes.
 */
function findOverlayParent(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const canvas = document.querySelector("canvas");
  return canvas?.parentElement ?? document.body;
}

// ── Overlay ──────────────────────────────────────────────────────────────────

export class MysteryGameOverlay extends Container {
  // ── Pixi-stub-felter (eksisterer for tester / interface-compat) ───────────
  /** Pixi-Containere som tester refererer; tomme stubs i DOM-design. */
  middleBalls: Container[] = [];
  prizeLadderSteps: Container[] = [];

  /** Test-eksponert tekst-stub (matcher gammel tester). */
  resultText: { text: string; visible: boolean } = { text: "", visible: false };
  errorText: { text: string; visible: boolean } = { text: "", visible: false };

  // ── Game state ────────────────────────────────────────────────────────────
  private middleNumber = 0;
  private resultNumber = 0;
  prizeListNok: number[] = [50, 100, 200, 400, 800, 1500];
  maxRounds = 5;
  private autoTurnFirstMoveSec = 20;
  private autoTurnOtherMoveSec = 10;

  private currentRound = 0;
  private priceIndex = 0;
  collectedDirections: Array<"up" | "down"> = [];
  private finished = false;
  private choiceSent = false;
  private balls: BallInfo[] = [];
  private finalPrize: { amount: number; joker: boolean } | null = null;

  private onChoice:
    | ((choiceJson: Readonly<Record<string, unknown>>) => void)
    | null = null;
  private onDismiss: (() => void) | null = null;
  private autoTimer: ReturnType<typeof setInterval> | null = null;
  private dismissTimer: ReturnType<typeof setTimeout> | null = null;
  private revealTimers: Array<ReturnType<typeof setTimeout>> = [];
  private autoCountdown = 0;

  // ── DOM ───────────────────────────────────────────────────────────────────
  private root: HTMLDivElement | null = null;
  private modalEl: HTMLDivElement | null = null;
  private introEl: HTMLDivElement | null = null;
  private timerEl: HTMLDivElement | null = null;
  private prizeDisplayEl: HTMLDivElement | null = null;
  private ladderRowEls: HTMLDivElement[] = [];
  private ballRowEls: Array<{
    container: HTMLDivElement;
    topSlot: HTMLDivElement;
    middle: HTMLDivElement;
    middleImg: HTMLImageElement;
    middleDigit: HTMLSpanElement;
    bottomSlot: HTMLDivElement;
    aura: HTMLDivElement | null;
  }> = [];
  private footerEl: HTMLDivElement | null = null;
  private errorEl: HTMLDivElement | null = null;
  private parentEl: HTMLElement | null = null;

  constructor(_w: number, _h: number) {
    super();
    void _w;
    void _h;
    ensureMysteryStyles();
    // Pixi-Container er usynlig — DOM-laget er "the overlay".
    this.visible = false;
  }

  setOnChoice(
    callback: (choiceJson: Readonly<Record<string, unknown>>) => void,
  ): void {
    this.onChoice = callback;
  }

  setOnDismiss(callback: () => void): void {
    this.onDismiss = callback;
  }

  show(triggerPayload: Readonly<Record<string, unknown>>): void {
    const data = triggerPayload as unknown as MysteryTriggerPayload;
    this.middleNumber =
      typeof data.middleNumber === "number" ? data.middleNumber : 0;
    this.resultNumber =
      typeof data.resultNumber === "number" ? data.resultNumber : 0;
    this.prizeListNok =
      Array.isArray(data.prizeListNok) && data.prizeListNok.length === 6
        ? data.prizeListNok.slice()
        : [50, 100, 200, 400, 800, 1500];
    this.maxRounds =
      typeof data.maxRounds === "number" && data.maxRounds > 0
        ? data.maxRounds
        : 5;
    this.autoTurnFirstMoveSec =
      typeof data.autoTurnFirstMoveSec === "number"
        ? data.autoTurnFirstMoveSec
        : 20;
    this.autoTurnOtherMoveSec =
      typeof data.autoTurnOtherMoveSec === "number"
        ? data.autoTurnOtherMoveSec
        : 10;

    // State reset.
    this.currentRound = 0;
    this.priceIndex = 0;
    this.collectedDirections = [];
    this.finished = false;
    this.choiceSent = false;
    this.finalPrize = null;
    this.resultText.visible = false;
    this.resultText.text = "";
    this.errorText.visible = false;
    this.errorText.text = "";

    // Bygg ball-state. Logisk index 0 = rightmost = ones-siffer (legacy).
    this.balls = [];
    for (let i = 0; i < this.maxRounds; i += 1) {
      const digit = getDigitAt(this.middleNumber, i);
      const resultDigit = getDigitAt(this.resultNumber, i);
      this.balls.push({
        digit,
        resultDigit,
        outcome: "pending",
        shownDigit: digit,
        reveal: null,
      });
    }

    // Pixi-stubber (tomme containere — eksisterer for backward-compat-tester).
    this.middleBalls = this.balls.map(() => new Container());
    this.prizeLadderSteps = this.prizeListNok.map(() => new Container());

    this.visible = true;
    this.mountDom();
    this.renderIntroOverlay();

    // Start round-timer umiddelbart slik at auto-valg fungerer selv om
    // brukeren venter ut intro-animasjonen. Modal-DOM er ikke synlig under
    // de første 2 sek (intro ligger over), men game-state-maskinen kjører.
    this.startRoundTimer();
  }

  animateResult(
    resultJson: Readonly<Record<string, unknown>>,
    payoutCents: number,
  ): void {
    void payoutCents;
    const result = resultJson as unknown as MysteryResultJson;
    this.finished = true;
    this.clearAutoTimer();

    const finalIndex =
      typeof result.finalPriceIndex === "number" ? result.finalPriceIndex : 0;
    const prize =
      typeof result.prizeAmountKroner === "number"
        ? result.prizeAmountKroner
        : this.prizeListNok[finalIndex] ?? 0;
    const joker = result.jokerTriggered === true;

    this.priceIndex = Math.max(
      0,
      Math.min(finalIndex, this.prizeListNok.length - 1),
    );
    this.finalPrize = { amount: prize, joker };

    if (joker) {
      this.resultText.text = `JOKER! Du vant ${prize} kr!`;
    } else if (prize > 0) {
      this.resultText.text = `Du vant ${prize} kr!`;
    } else {
      this.resultText.text = "Ingen premie denne gang.";
    }
    this.resultText.visible = true;

    this.renderHeader();
    this.renderLadder();
    this.renderFooter();

    if (joker) this.spawnConfetti();

    this.dismissTimer = setTimeout(
      () => this.onDismiss?.(),
      AUTO_DISMISS_AFTER_RESULT_SECONDS * 1000,
    );
  }

  showChoiceError(err: { code: string; message: string }): void {
    this.errorText.text = `Feil: ${err.message}`;
    this.errorText.visible = true;
    this.choiceSent = false;
    if (this.errorEl) {
      this.errorEl.textContent = this.errorText.text;
      this.errorEl.style.display = "block";
    }
  }

  destroy(options?: Parameters<Container["destroy"]>[0]): void {
    this.clearAutoTimer();
    if (this.dismissTimer) {
      clearTimeout(this.dismissTimer);
      this.dismissTimer = null;
    }
    for (const t of this.revealTimers) clearTimeout(t);
    this.revealTimers = [];
    this.unmountDom();
    super.destroy(options);
  }

  // ── DOM mount / unmount ────────────────────────────────────────────────────

  private mountDom(): void {
    this.unmountDom();
    const parent = findOverlayParent();
    if (!parent) return;
    this.parentEl = parent;

    const root = document.createElement("div");
    root.className = "mj-root";
    Object.assign(root.style, {
      position: "absolute",
      inset: "0",
      zIndex: "60",
      pointerEvents: "auto",
      // KRITISK: ingen backdrop-filter — Pixi-canvas under (PR #468).
      background: "rgba(8, 4, 6, 0.78)",
      animation: "mj-fade-in 220ms ease-out both",
      fontFamily: "'Inter', system-ui, sans-serif",
      color: "#f4e8d0",
      // Ensure root is positioned correctly relative to parent (canvas wrapper
      // is typically `position: relative`; for body-fallback we use fixed).
      ...(parent === document.body
        ? { position: "fixed" as const }
        : {}),
    });
    parent.appendChild(root);
    this.root = root;
  }

  private unmountDom(): void {
    if (this.root) {
      this.root.remove();
      this.root = null;
    }
    this.modalEl = null;
    this.introEl = null;
    this.timerEl = null;
    this.prizeDisplayEl = null;
    this.ladderRowEls = [];
    this.ballRowEls = [];
    this.footerEl = null;
    this.errorEl = null;
  }

  private renderIntroOverlay(): void {
    if (!this.root) return;
    const intro = document.createElement("div");
    Object.assign(intro.style, {
      position: "absolute",
      inset: "0",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    });
    // Tobias 2026-04-26: tekst + crown-PNG side-by-side på samme linje.
    // Tidligere stack hadde bilde over tekst; nå er bildet til HØYRE.
    const stack = document.createElement("div");
    Object.assign(stack.style, {
      display: "flex",
      flexDirection: "row",
      alignItems: "center",
      gap: "18px",
    });

    const text = document.createElement("div");
    text.textContent = "MYSTERY JOKER";
    Object.assign(text.style, {
      fontFamily: "'Inter', system-ui, sans-serif",
      fontSize: "44px",
      fontWeight: "900",
      letterSpacing: "2px",
      color: "#ffe83d",
      textShadow: "0 0 30px rgba(255,232,61,0.5)",
      animation: "mj-intro-text 2000ms ease-in-out forwards",
      lineHeight: "1",
    });

    const img = document.createElement("img");
    // Joker-crown (rød/grønne tunger + gull-stjerner). Ca. 1.3× tekstens
    // x-høyde for å matche optisk vekt uten å dominere typografien.
    img.src = JOKER_CROWN_IMG_URL;
    img.alt = "";
    img.draggable = false;
    Object.assign(img.style, {
      // ~50px høyt = matcher tekst-x-høyde + litt (44px font * 1.1 ≈ 48-50px)
      height: "50px",
      width: "auto",
      maxWidth: "70px",
      objectFit: "contain",
      filter: "drop-shadow(0 0 18px rgba(255,122,26,0.55))",
      animation: "mj-intro-joker 2000ms ease-in-out forwards",
      // Anchor for transform-basert animasjon (rotate+scale) skal være
      // sentrert i bildet; default er fine men eksplisitt for klarhet.
      transformOrigin: "center center",
    });

    stack.appendChild(text);
    stack.appendChild(img);
    intro.appendChild(stack);
    this.root.appendChild(intro);
    this.introEl = intro;

    // Etter 2 sek: fjern intro + render modal. Round-timer er allerede
    // startet i show() — vi bare avslører modalen her.
    const t = setTimeout(() => {
      if (this.introEl) {
        this.introEl.remove();
        this.introEl = null;
      }
      this.renderModal();
    }, INTRO_DURATION_MS);
    this.revealTimers.push(t);
  }

  private renderModal(): void {
    if (!this.root) return;

    const modal = document.createElement("div");
    Object.assign(modal.style, {
      position: "absolute",
      left: "50%",
      top: "50%",
      transform: "translate(-50%, -50%)",
      width: "860px",
      maxWidth: "calc(100% - 40px)",
      borderRadius: "16px",
      padding: "24px 32px 22px",
      background:
        "radial-gradient(ellipse at top, #3d1620 0%, #1f0a10 55%, #120508 100%)",
      border: "1px solid rgba(255, 232, 61, 0.25)",
      boxShadow:
        "0 30px 80px rgba(0,0,0,0.85), 0 0 0 1px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255, 232, 61, 0.08)",
      animation: "mj-content-fade 320ms ease-out both",
    });

    // Header
    const header = document.createElement("div");
    Object.assign(header.style, {
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: "16px",
    });

    const headerLeft = document.createElement("div");
    headerLeft.style.flex = "1";
    const h1 = document.createElement("h1");
    h1.textContent = "MYSTERY JOKER";
    Object.assign(h1.style, {
      fontFamily: "'Inter', system-ui, sans-serif",
      fontSize: "32px",
      fontWeight: "800",
      letterSpacing: "-0.5px",
      color: "#ffe83d",
      margin: "0",
      lineHeight: "1.05",
    });
    const sub = document.createElement("p");
    sub.textContent =
      "Velg om du skal gå opp eller ned. Treffer du joker vinner du jackpott.";
    Object.assign(sub.style, {
      color: "rgba(255,255,255,0.55)",
      fontSize: "13px",
      marginTop: "6px",
      marginBottom: "0",
      letterSpacing: "0.2px",
    });
    headerLeft.appendChild(h1);
    headerLeft.appendChild(sub);
    header.appendChild(headerLeft);

    const headerRight = document.createElement("div");
    Object.assign(headerRight.style, {
      display: "flex",
      flexDirection: "column",
      alignItems: "flex-end",
      justifyContent: "center",
      gap: "10px",
      minHeight: "80px",
    });
    const timerPill = document.createElement("div");
    Object.assign(timerPill.style, {
      padding: "4px 12px",
      borderRadius: "999px",
      fontSize: "12px",
      fontWeight: "700",
      letterSpacing: "0.5px",
      color: "rgba(255,232,61,0.85)",
      background: "rgba(255,232,61,0.10)",
      border: "1px solid rgba(255,232,61,0.25)",
      fontVariantNumeric: "tabular-nums",
      minWidth: "44px",
      textAlign: "center" as const,
    });
    headerRight.appendChild(timerPill);
    this.timerEl = timerPill;

    const prizeDisplay = document.createElement("div");
    Object.assign(prizeDisplay.style, {
      fontSize: "13px",
      color: "rgba(255,255,255,0.55)",
      whiteSpace: "nowrap",
      display: "flex",
      alignItems: "center",
      gap: "8px",
    });
    headerRight.appendChild(prizeDisplay);
    this.prizeDisplayEl = prizeDisplay;

    header.appendChild(headerRight);
    modal.appendChild(header);

    // Divider
    const divTop = document.createElement("div");
    Object.assign(divTop.style, {
      height: "1px",
      marginTop: "14px",
      marginBottom: "16px",
      background:
        "linear-gradient(90deg, transparent, rgba(255,232,61,0.22), transparent)",
    });
    modal.appendChild(divTop);

    // Body: ladder + arena
    const body = document.createElement("div");
    Object.assign(body.style, {
      display: "flex",
      gap: "24px",
      alignItems: "stretch",
    });

    const ladder = this.buildLadder();
    body.appendChild(ladder);

    const arena = this.buildArena();
    body.appendChild(arena);

    modal.appendChild(body);

    // Divider
    const divBottom = document.createElement("div");
    Object.assign(divBottom.style, {
      height: "1px",
      marginTop: "16px",
      marginBottom: "12px",
      background:
        "linear-gradient(90deg, transparent, rgba(255,232,61,0.22), transparent)",
    });
    modal.appendChild(divBottom);

    // Footer (CTA dukker opp ved finished)
    const footer = document.createElement("div");
    Object.assign(footer.style, {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      minHeight: "40px",
    });
    const errorEl = document.createElement("div");
    Object.assign(errorEl.style, {
      fontSize: "12px",
      color: "#ff6b6b",
      display: "none",
    });
    footer.appendChild(errorEl);
    this.errorEl = errorEl;

    modal.appendChild(footer);
    this.footerEl = footer;

    this.root.appendChild(modal);
    this.modalEl = modal;

    // Initial header + ladder content.
    this.renderHeader();
    this.renderLadder();
    this.renderFooter();
    this.refreshActiveAura();
  }

  private buildLadder(): HTMLDivElement {
    const ladder = document.createElement("div");
    Object.assign(ladder.style, {
      width: "196px",
      borderRadius: "12px",
      padding: "14px 12px",
      background:
        "linear-gradient(180deg, rgba(255,255,255,0.02), rgba(0,0,0,0.25))",
      border: "1px solid rgba(255, 232, 61, 0.14)",
      display: "flex",
      flexDirection: "column",
      gap: "4px",
      alignSelf: "flex-start",
      flexShrink: "0",
    });
    const hdr = document.createElement("div");
    hdr.textContent = "PREMIE";
    Object.assign(hdr.style, {
      fontSize: "10px",
      letterSpacing: "3px",
      color: "#ffe83d",
      fontWeight: "700",
      textAlign: "center" as const,
      marginBottom: "6px",
      opacity: "0.85",
    });
    ladder.appendChild(hdr);

    this.ladderRowEls = [];
    // Render top→bottom = max→min (samme som JSX: prizes.length-1-i)
    for (let i = 0; i < this.prizeListNok.length; i += 1) {
      const idxFromTop = this.prizeListNok.length - 1 - i;
      const row = document.createElement("div");
      row.className = "mj-prize-row";
      const dot = document.createElement("span");
      dot.className = "mj-dot";
      const amt = document.createElement("span");
      amt.style.flex = "1";
      amt.style.textAlign = "right";
      const value = this.prizeListNok[idxFromTop] ?? 0;
      amt.textContent = `${value.toLocaleString("no-NO")} kr`;
      row.appendChild(dot);
      row.appendChild(amt);
      // Lagre rad i visuell rekkefølge (top→bottom). Mapping
      // til logisk priceIndex: ladderRowEls[i] svarer til
      // priceIndex = prizeListNok.length - 1 - i.
      this.ladderRowEls.push(row);
      ladder.appendChild(row);
    }

    return ladder;
  }

  /**
   * Velg ball-PNG basert på outcome-state. Default ("pending") = red
   * (matcher tidligere `mj-ball`-gradient og JSX `variant="red"`).
   * Tobias 2026-04-26: bruker samme PNG-baller som hoved-spillet
   * (BallTube) for visuell konsistens.
   */
  private static ballAssetUrlForOutcome(
    outcome: "pending" | "correct" | "wrong" | "joker",
  ): string {
    switch (outcome) {
      case "correct":
        return MYSTERY_BALL_CORRECT_URL;
      case "wrong":
        return MYSTERY_BALL_WRONG_URL;
      case "joker":
        return MYSTERY_BALL_JOKER_URL;
      case "pending":
      default:
        return MYSTERY_BALL_DEFAULT_URL;
    }
  }

  /**
   * Bygg en Mystery-ball: <div class="mj-ball"> med <img> (PNG) +
   * <span class="mj-ball-digit"> (digit-tall). Returnerer både wrap-en
   * og inner-elementene slik at outcome-oppdatering kan bytte img-src
   * uten å re-bygge DOM-en.
   */
  private buildMysteryBall(
    digit: string,
    outcome: "pending" | "correct" | "wrong" | "joker",
    opts?: { size?: number; fontSize?: number },
  ): {
    wrap: HTMLDivElement;
    img: HTMLImageElement;
    digitEl: HTMLSpanElement;
  } {
    const size = opts?.size ?? 68;
    const fontSize = opts?.fontSize ?? 28;
    const wrap = document.createElement("div");
    wrap.className = "mj-ball";
    if (size !== 68) {
      wrap.style.width = `${size}px`;
      wrap.style.height = `${size}px`;
    }
    if (fontSize !== 28) {
      wrap.style.fontSize = `${fontSize}px`;
    }
    if (outcome === "correct") wrap.classList.add("mj-ball-correct");
    else if (outcome === "wrong") wrap.classList.add("mj-ball-wrong");
    else if (outcome === "joker") wrap.classList.add("mj-ball-joker");

    const img = document.createElement("img");
    img.className = "mj-ball-img";
    img.src = MysteryGameOverlay.ballAssetUrlForOutcome(outcome);
    img.alt = "";
    img.draggable = false;
    wrap.appendChild(img);

    const digitEl = document.createElement("span");
    digitEl.className = "mj-ball-digit";
    digitEl.textContent = digit;
    wrap.appendChild(digitEl);

    return { wrap, img, digitEl };
  }

  private buildArena(): HTMLDivElement {
    const arena = document.createElement("div");
    Object.assign(arena.style, {
      flex: "1",
      borderRadius: "12px",
      padding: "22px 22px 20px",
      background:
        "linear-gradient(180deg, rgba(255,255,255,0.02), rgba(0,0,0,0.25))",
      border: "1px solid rgba(255, 232, 61, 0.14)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    });

    const row = document.createElement("div");
    Object.assign(row.style, {
      display: "flex",
      gap: "16px",
      justifyContent: "center",
    });

    this.ballRowEls = [];
    // visualIndex 0 = leftmost; logicalIdx = maxRounds-1-vi (rightmost is index 0)
    for (let vi = 0; vi < this.maxRounds; vi += 1) {
      const logicalIdx = this.maxRounds - 1 - vi;
      const col = document.createElement("div");
      Object.assign(col.style, {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      });

      // Top slot (height 68 = ball size for alignment)
      const topSlot = document.createElement("div");
      Object.assign(topSlot.style, {
        height: "68px",
        width: "96px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      });

      // Middle: ball (PNG + digit-overlay)
      const middleWrap = document.createElement("div");
      Object.assign(middleWrap.style, {
        position: "relative",
        margin: "10px 0",
      });

      const ballState = this.balls[logicalIdx];
      const built = this.buildMysteryBall(
        String(ballState?.digit ?? ""),
        "pending",
      );
      middleWrap.appendChild(built.wrap);

      // Bottom slot
      const bottomSlot = document.createElement("div");
      Object.assign(bottomSlot.style, {
        height: "68px",
        width: "96px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      });

      col.appendChild(topSlot);
      col.appendChild(middleWrap);
      col.appendChild(bottomSlot);
      row.appendChild(col);

      this.ballRowEls.push({
        container: col,
        topSlot,
        middle: built.wrap,
        middleImg: built.img,
        middleDigit: built.digitEl,
        bottomSlot,
        aura: null,
      });
    }

    arena.appendChild(row);
    return arena;
  }

  // ── Render-helpers (driven by state) ──────────────────────────────────────

  private renderHeader(): void {
    if (!this.prizeDisplayEl) return;
    this.prizeDisplayEl.replaceChildren();

    if (this.finished && this.finalPrize) {
      if (this.finalPrize.joker) {
        const img = document.createElement("img");
        img.src = JOKER_IMG_URL;
        img.alt = "";
        img.draggable = false;
        Object.assign(img.style, {
          width: "28px",
          height: "28px",
          filter: "drop-shadow(0 0 10px rgba(255,122,26,0.6))",
        });
        const txt = document.createElement("b");
        txt.textContent = `JOKER! JACKPOT ${this.finalPrize.amount.toLocaleString(
          "no-NO",
        )} kr`;
        Object.assign(txt.style, {
          color: "#ff7a1a",
          fontSize: "17px",
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-0.2px",
          lineHeight: "1",
          animation: "mj-amount-glow 1.6s ease-in-out infinite",
        });
        this.prizeDisplayEl.appendChild(img);
        this.prizeDisplayEl.appendChild(txt);
      } else {
        const lbl = document.createTextNode("Du vant ");
        const v = document.createElement("b");
        v.textContent = `${this.finalPrize.amount.toLocaleString("no-NO")} kr`;
        Object.assign(v.style, {
          color: "#ffe83d",
          fontSize: "17px",
          marginLeft: "4px",
          fontVariantNumeric: "tabular-nums",
          textShadow: "0 0 12px rgba(255,232,61,0.35)",
        });
        this.prizeDisplayEl.appendChild(lbl);
        this.prizeDisplayEl.appendChild(v);
      }
    } else {
      const lbl = document.createTextNode("Nåværende gevinst ");
      const v = document.createElement("b");
      const cur = this.prizeListNok[this.priceIndex] ?? 0;
      v.textContent = `${cur.toLocaleString("no-NO")} kr`;
      Object.assign(v.style, {
        color: "#ffe83d",
        fontSize: "17px",
        marginLeft: "4px",
        fontVariantNumeric: "tabular-nums",
        textShadow: "0 0 12px rgba(255,232,61,0.35)",
      });
      this.prizeDisplayEl.appendChild(lbl);
      this.prizeDisplayEl.appendChild(v);
    }
  }

  private renderLadder(): void {
    for (let i = 0; i < this.ladderRowEls.length; i += 1) {
      const row = this.ladderRowEls[i]!;
      // Visuell rekkefølge top→bottom = max→min, så priceIndex-mapping er
      // length - 1 - i.
      const priceIdx = this.prizeListNok.length - 1 - i;
      const isActive = priceIdx === this.priceIndex;
      const isMax = priceIdx === this.prizeListNok.length - 1;
      row.dataset["active"] = isActive ? "true" : "false";
      row.dataset["max"] = isMax ? "true" : "false";
    }
  }

  private renderFooter(): void {
    if (!this.footerEl) return;
    // Fjern eventuell tidligere CTA.
    const oldBtn = this.footerEl.querySelector(".mj-cta");
    if (oldBtn) oldBtn.remove();

    if (this.finished) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mj-cta";
      btn.textContent = "Spill igjen";
      btn.addEventListener("click", () => {
        this.onDismiss?.();
      });
      this.footerEl.appendChild(btn);
    }
  }

  private refreshActiveAura(): void {
    // Aktivt-state: pulserende aura rundt aktiv ball + chevron-knapper.
    for (let logicalIdx = 0; logicalIdx < this.ballRowEls.length; logicalIdx += 1) {
      const visualIdx = this.maxRounds - 1 - logicalIdx;
      const cell = this.ballRowEls[visualIdx];
      if (!cell) continue;
      const isActive =
        logicalIdx === this.currentRound && !this.finished && !this.choiceSent;
      // Aura
      if (cell.aura) {
        cell.aura.remove();
        cell.aura = null;
      }
      if (isActive) {
        const aura = document.createElement("div");
        aura.className = "mj-aura";
        cell.middle.parentElement?.insertBefore(aura, cell.middle);
        cell.aura = aura;
        cell.middle.style.animation = "mj-active-pulse 1.6s ease-in-out infinite";
      } else {
        cell.middle.style.animation = "";
      }

      // Top-slot: arrow OPP eller reveal-ball.
      cell.topSlot.replaceChildren();
      cell.bottomSlot.replaceChildren();
      const ballState = this.balls[logicalIdx];
      if (ballState?.reveal && ballState.reveal.direction === "up") {
        cell.topSlot.appendChild(this.buildRevealBall(ballState));
      } else if (isActive) {
        cell.topSlot.appendChild(this.buildArrowBtn("up", logicalIdx));
      }
      if (ballState?.reveal && ballState.reveal.direction === "down") {
        cell.bottomSlot.appendChild(this.buildRevealBall(ballState));
      } else if (isActive) {
        cell.bottomSlot.appendChild(this.buildArrowBtn("down", logicalIdx));
      }

      // Middle ball-state — bytt PNG-asset + outcome-class. Digit-tekst
      // settes på .mj-ball-digit (ikke wrap), slik at <img> ikke ovrshrives.
      cell.middle.classList.remove("mj-ball-correct", "mj-ball-wrong", "mj-ball-joker");
      const outcome: "pending" | "correct" | "wrong" | "joker" =
        ballState?.outcome ?? "pending";
      if (outcome === "correct") cell.middle.classList.add("mj-ball-correct");
      else if (outcome === "wrong") cell.middle.classList.add("mj-ball-wrong");
      else if (outcome === "joker") cell.middle.classList.add("mj-ball-joker");
      cell.middleImg.src = MysteryGameOverlay.ballAssetUrlForOutcome(outcome);
      cell.middleDigit.textContent = String(ballState?.shownDigit ?? "");
    }
  }

  private buildArrowBtn(
    direction: "up" | "down",
    logicalIdx: number,
  ): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mj-arrow-btn";
    btn.setAttribute("aria-label", direction === "up" ? "Opp" : "Ned");
    Object.assign(btn.style, {
      width: "96px",
      height: "44px",
    });
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "20");
    svg.setAttribute("height", "20");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute(
      "d",
      direction === "up" ? "M6 15 L12 9 L18 15" : "M6 9 L12 15 L18 9",
    );
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "2.4");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);
    const label = document.createElement("span");
    label.textContent = direction === "up" ? "OPP" : "NED";
    btn.appendChild(svg);
    btn.appendChild(label);
    btn.disabled = this.finished || this.choiceSent || logicalIdx !== this.currentRound;
    btn.addEventListener("click", () => {
      this.selectDirection(direction);
    });
    return btn;
  }

  private buildRevealBall(ballState: BallInfo): HTMLDivElement {
    const outcome =
      ballState.outcome === "pending" ? "pending" : ballState.outcome;
    const built = this.buildMysteryBall(
      String(ballState.reveal?.value ?? ""),
      outcome,
      { size: 64, fontSize: 26 },
    );
    built.wrap.style.animation = "mj-reveal-drop 350ms ease-out both";
    return built.wrap;
  }

  // ── Game logic (uendret state-flyt) ───────────────────────────────────────

  private selectDirection(direction: "up" | "down"): void {
    if (this.finished || this.choiceSent) return;
    if (this.currentRound >= this.maxRounds) return;

    this.collectedDirections.push(direction);
    this.clearAutoTimer();
    if (this.timerEl) this.timerEl.textContent = "";

    const ball = this.balls[this.currentRound];
    if (!ball) return;
    const middleDigit = ball.digit;
    const resultDigit = ball.resultDigit;
    const isJoker = middleDigit === resultDigit;
    const isCorrect = isJoker
      ? false
      : (direction === "up" && resultDigit > middleDigit) ||
        (direction === "down" && resultDigit < middleDigit);

    if (isJoker) {
      ball.outcome = "joker";
      this.priceIndex = this.prizeListNok.length - 1;
    } else if (isCorrect) {
      ball.outcome = "correct";
      this.priceIndex = Math.min(
        this.priceIndex + 1,
        this.prizeListNok.length - 1,
      );
    } else {
      ball.outcome = "wrong";
      this.priceIndex = Math.max(this.priceIndex - 1, 0);
    }
    ball.reveal = { direction, value: resultDigit };

    this.renderHeader();
    this.renderLadder();
    this.refreshActiveAura();

    if (isJoker || this.currentRound === this.maxRounds - 1) {
      // Avslutt — send alle directions til server.
      this.choiceSent = true;
      const t = setTimeout(() => {
        this.onChoice?.({ directions: this.collectedDirections });
      }, FINAL_DELAY_MS);
      this.revealTimers.push(t);
      this.refreshActiveAura();
      return;
    }

    // Neste runde.
    this.currentRound += 1;
    const t = setTimeout(() => {
      this.refreshActiveAura();
      this.startRoundTimer();
    }, REVEAL_DELAY_MS);
    this.revealTimers.push(t);
  }

  private startRoundTimer(): void {
    if (this.finished || this.choiceSent) return;
    const sec =
      this.currentRound === 0
        ? this.autoTurnFirstMoveSec
        : this.autoTurnOtherMoveSec;
    this.autoCountdown = sec;
    if (this.timerEl) this.timerEl.textContent = `${sec}s`;
    this.autoTimer = setInterval(() => {
      this.autoCountdown -= 1;
      if (this.autoCountdown <= 0) {
        this.clearAutoTimer();
        if (this.timerEl) this.timerEl.textContent = "";
        // Default ved timeout = "down" (matcher tidligere implementasjon).
        this.selectDirection("down");
      } else if (this.timerEl) {
        this.timerEl.textContent = `${this.autoCountdown}s`;
      }
    }, 1000);
  }

  private clearAutoTimer(): void {
    if (this.autoTimer) {
      clearInterval(this.autoTimer);
      this.autoTimer = null;
    }
  }

  private spawnConfetti(): void {
    if (!this.modalEl) return;
    const burst = document.createElement("div");
    Object.assign(burst.style, {
      position: "absolute",
      top: "0",
      left: "0",
      right: "0",
      bottom: "0",
      pointerEvents: "none",
      overflow: "hidden",
      borderRadius: "16px",
    });
    const colors = ["#ffe83d", "#ff7a1a", "#ffffff", "#f5b841", "#22c55e"];
    const pieces = 32;
    for (let i = 0; i < pieces; i += 1) {
      const piece = document.createElement("div");
      piece.className = "mj-confetti-piece";
      const angle = (i / pieces) * Math.PI * 2;
      const dist = 180 + (i % 5) * 30;
      const cx = Math.cos(angle) * dist;
      const cy = Math.sin(angle) * dist + 60;
      const cr = 360 + ((i * 47) % 360);
      const color = colors[i % colors.length] ?? "#ffe83d";
      piece.style.background = color;
      piece.style.setProperty("--mj-cx", `${cx}px`);
      piece.style.setProperty("--mj-cy", `${cy}px`);
      piece.style.setProperty("--mj-cr", `${cr}deg`);
      piece.style.animationDelay = `${(i % 8) * 30}ms`;
      burst.appendChild(piece);
    }
    this.modalEl.appendChild(burst);
    const t = setTimeout(() => burst.remove(), 1800);
    this.revealTimers.push(t);
  }
}

/** Exposed for tests. */
export const __Mystery_AUTO_DISMISS_AFTER_RESULT_SECONDS__ =
  AUTO_DISMISS_AFTER_RESULT_SECONDS;
export const __Mystery_getDigitAt = getDigitAt;
