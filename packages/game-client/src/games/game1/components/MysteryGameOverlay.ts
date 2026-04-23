/**
 * BIN-MYSTERY M6: Mystery Game overlay — portet 1:1 fra legacy Unity
 * MysteryGamePanel.cs (commit 5fda0f78).
 *
 * Trigger payload (fra MiniGameMysteryEngine):
 *   `{ middleNumber, resultNumber, prizeListNok: number[6], maxRounds: 5,
 *      autoTurnFirstMoveSec, autoTurnOtherMoveSec }`
 *
 * Choice payload: `{ directions: ("up"|"down")[] }` — 1..5 elementer.
 *   Sendes samlet etter alle runder (eller når joker terminerer).
 *
 * Result payload:
 *   `{ middleNumber, resultNumber, rounds: MysteryRoundResult[],
 *      finalPriceIndex, prizeAmountKroner, jokerTriggered }`
 *
 * UX (1:1 legacy):
 *   - Spiller ser 5 middle-balls (siffer for siffer, høyre → venstre).
 *   - Aktiv runde har høy-lyst middle-ball og OPP/NED-knapper som kan klikkes.
 *   - Premie-stige i sidebar: pilen beveger seg opp/ned pr runde.
 *   - Første valg: 20s timer. Påfølgende: 10s.
 *   - Ved timeout: default = "down" (arbitrarily picked — legacy auto-turn
 *     gjorde ikke noe spesielt i Game 1-modus, bare `Is_Game_4` auto-velger).
 *   - Ved correct: +1 priceIndex, next round
 *   - Ved wrong: -1 priceIndex, next round
 *   - Ved joker (equal digits): max premie, spillet ender umiddelbart med
 *     stjerne/sparkle-animasjon på JOKER-ballen.
 *   - Etter 5 runder eller joker: viser prize-amount og auto-dismiss.
 *
 * Server-state-visibility: `resultNumber` er med i trigger-payload (legacy
 * gjør det samme). Dette kan ikke forfalskes av klient fordi serveren alltid
 * rekonstruerer state deterministisk i handleChoice. UI kan velge å skjule
 * resultNumber fra brukeren, men vi implementerer "reveal digit for digit"
 * ved klikk — den mest autentiske spilleopplevelsen.
 */

import { Container, Graphics, Text } from "pixi.js";
import gsap from "gsap";

// ── Constants (design tokens matching other overlays) ────────────────────────

const MIDDLE_BALL_SIZE = 60;
const MIDDLE_BALL_GAP = 12;
const BUTTON_SIZE = 56;
const BUTTON_GAP = 20;
const PRIZE_STEP_HEIGHT = 34;
const PRIZE_STEP_WIDTH = 120;
const AUTO_DISMISS_AFTER_RESULT_SECONDS = 6;

const COLOR_DEFAULT_BALL = 0x2a1d3a;
const COLOR_ACTIVE_BALL = 0xffe83d;
const COLOR_JOKER_BALL = 0xff6b35;
const COLOR_CORRECT = 0x22c55e;
const COLOR_WRONG = 0xef4444;
const COLOR_BUTTON_BG = 0x790001;
const COLOR_BUTTON_BORDER = 0xffe83d;
const COLOR_PRIZE_INACTIVE = 0x444458;
const COLOR_PRIZE_ACTIVE = 0xffe83d;

// ── Types ────────────────────────────────────────────────────────────────────

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

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Hent siffer N fra et 5-sifret tall, talt fra HØYRE (N=0 er ones-sifferet).
 * Matcher backend `getDigitAt` i MiniGameMysteryEngine.ts.
 */
function getDigitAt(n: number, index: number): number {
  const padded = n.toString().padStart(5, "0");
  return Number.parseInt(padded[padded.length - 1 - index]!, 10);
}

// ── Overlay ──────────────────────────────────────────────────────────────────

export class MysteryGameOverlay extends Container {
  private bg: Graphics;
  private title: Text;
  private subtitle: Text;
  private middleBalls: Container[] = [];
  private upButton: Container | null = null;
  private downButton: Container | null = null;
  private prizeLadderSteps: Container[] = [];
  private prizeArrow: Graphics;
  private resultText: Text;
  private errorText: Text;
  private timerText: Text;

  // State
  private middleNumber = 0;
  private resultNumber = 0;
  private prizeListNok: number[] = [0, 0, 0, 0, 0, 0];
  private maxRounds = 5;
  private autoTurnFirstMoveSec = 20;
  private autoTurnOtherMoveSec = 10;

  private currentRound = 0;
  private priceIndex = 0;
  private collectedDirections: Array<"up" | "down"> = [];
  private finished = false;
  private choiceSent = false;

  private onChoice:
    | ((choiceJson: Readonly<Record<string, unknown>>) => void)
    | null = null;
  private onDismiss: (() => void) | null = null;
  private autoTimer: ReturnType<typeof setInterval> | null = null;
  private autoCountdown = 0;

  private screenW: number;
  private screenH: number;

  constructor(w: number, h: number) {
    super();
    this.screenW = w;
    this.screenH = h;

    // Dim background.
    this.bg = new Graphics();
    this.bg.rect(0, 0, w, h);
    this.bg.fill({ color: 0x000000, alpha: 0.85 });
    this.bg.eventMode = "static";
    this.addChild(this.bg);

    this.title = new Text({
      text: "MYSTERY GAME",
      style: {
        fontFamily: "Arial",
        fontSize: 28,
        fontWeight: "bold",
        fill: 0xffe83d,
      },
    });
    this.title.anchor.set(0.5);
    this.title.x = w / 2;
    this.title.y = h * 0.1;
    this.addChild(this.title);

    this.subtitle = new Text({
      text: "Høyere eller lavere? Match tallet for bonus!",
      style: { fontFamily: "Arial", fontSize: 14, fill: 0xcccccc },
    });
    this.subtitle.anchor.set(0.5);
    this.subtitle.x = w / 2;
    this.subtitle.y = h * 0.16;
    this.addChild(this.subtitle);

    // Prize arrow (placeholder — drawn in renderPrizeLadder).
    this.prizeArrow = new Graphics();
    this.addChild(this.prizeArrow);

    this.resultText = new Text({
      text: "",
      style: {
        fontFamily: "Arial",
        fontSize: 22,
        fontWeight: "bold",
        fill: 0xffe83d,
        align: "center",
        wordWrap: true,
        wordWrapWidth: w * 0.7,
      },
    });
    this.resultText.anchor.set(0.5);
    this.resultText.x = w / 2;
    this.resultText.y = h * 0.86;
    this.resultText.visible = false;
    this.addChild(this.resultText);

    this.errorText = new Text({
      text: "",
      style: { fontFamily: "Arial", fontSize: 14, fill: 0xff6464 },
    });
    this.errorText.anchor.set(0.5);
    this.errorText.x = w / 2;
    this.errorText.y = h * 0.92;
    this.errorText.visible = false;
    this.addChild(this.errorText);

    this.timerText = new Text({
      text: "",
      style: { fontFamily: "Arial", fontSize: 16, fill: 0xffffff },
    });
    this.timerText.anchor.set(0.5);
    this.timerText.x = w / 2;
    this.timerText.y = h * 0.96;
    this.addChild(this.timerText);

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
      typeof data.maxRounds === "number" ? data.maxRounds : 5;
    this.autoTurnFirstMoveSec =
      typeof data.autoTurnFirstMoveSec === "number"
        ? data.autoTurnFirstMoveSec
        : 20;
    this.autoTurnOtherMoveSec =
      typeof data.autoTurnOtherMoveSec === "number"
        ? data.autoTurnOtherMoveSec
        : 10;

    // Reset state.
    this.currentRound = 0;
    this.priceIndex = 0;
    this.collectedDirections = [];
    this.finished = false;
    this.choiceSent = false;
    this.resultText.visible = false;
    this.errorText.visible = false;

    // Clear old children.
    for (const b of this.middleBalls) b.destroy({ children: true });
    this.middleBalls = [];
    for (const s of this.prizeLadderSteps) s.destroy({ children: true });
    this.prizeLadderSteps = [];
    if (this.upButton) this.upButton.destroy({ children: true });
    if (this.downButton) this.downButton.destroy({ children: true });
    this.upButton = null;
    this.downButton = null;

    // Render middle-balls (5 digits of middleNumber, rendered left-to-right
    // with index 0 = rightmost = ones-siffer).
    this.renderMiddleBalls();

    // Render up/down buttons for round 0.
    this.renderUpDownButtons();

    // Render prize ladder on the right.
    this.renderPrizeLadder();

    this.visible = true;

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
    this.timerText.text = "";
    this.errorText.visible = false;

    // Disable up/down.
    this.disableUpDownButtons();

    const finalIndex =
      typeof result.finalPriceIndex === "number" ? result.finalPriceIndex : 0;
    const prize =
      typeof result.prizeAmountKroner === "number"
        ? result.prizeAmountKroner
        : this.prizeListNok[finalIndex] ?? 0;
    const joker = result.jokerTriggered === true;

    this.moveArrowToPrizeIndex(finalIndex, 0.5);

    if (joker) {
      this.resultText.text = `JOKER! Du vant ${prize} kr!`;
      this.resultText.style.fill = 0xff6b35;
    } else if (prize > 0) {
      this.resultText.text = `Du vant ${prize} kr!`;
      this.resultText.style.fill = COLOR_ACTIVE_BALL;
    } else {
      this.resultText.text = "Ingen premie denne gang.";
      this.resultText.style.fill = 0xcccccc;
    }
    this.resultText.visible = true;

    setTimeout(
      () => this.onDismiss?.(),
      AUTO_DISMISS_AFTER_RESULT_SECONDS * 1000,
    );
  }

  showChoiceError(err: { code: string; message: string }): void {
    this.errorText.text = `Feil: ${err.message}`;
    this.errorText.visible = true;
    this.choiceSent = false;
  }

  destroy(options?: Parameters<Container["destroy"]>[0]): void {
    this.clearAutoTimer();
    gsap.killTweensOf(this);
    super.destroy(options);
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private renderMiddleBalls(): void {
    const totalW =
      this.maxRounds * MIDDLE_BALL_SIZE + (this.maxRounds - 1) * MIDDLE_BALL_GAP;
    const startX = (this.screenW - totalW) / 2;
    const y = this.screenH * 0.32;

    // Legacy renderer med index 0 = rightmost = ones. I UI viser vi fra venstre
    // mot høyre som "ten-thousands → ones" (som et vanlig tall). Round 0 er
    // RIGHTMOST ball (= ones-digit). Men dette gir en forvirrende visuell:
    // vi spiller fra venstre til høyre i vår UI. Vi følger legacy her — runde
    // 0 tilsvarer rightmost ball, som i legacy (reversert iterasjon).
    for (let i = 0; i < this.maxRounds; i += 1) {
      const digit = getDigitAt(this.middleNumber, i);
      const ball = this.createMiddleBall(digit);
      // i=0 er rightmost → plasseres lengst til høyre.
      const visualIndex = this.maxRounds - 1 - i;
      ball.x = startX + visualIndex * (MIDDLE_BALL_SIZE + MIDDLE_BALL_GAP) +
        MIDDLE_BALL_SIZE / 2;
      ball.y = y + MIDDLE_BALL_SIZE / 2;
      this.addChild(ball);
      this.middleBalls.push(ball);
    }
    // Highlight current (round 0 = rightmost ball).
    this.highlightActiveBall();
  }

  private createMiddleBall(digit: number): Container {
    const c = new Container();
    const bg = new Graphics();
    bg.circle(0, 0, MIDDLE_BALL_SIZE / 2);
    bg.fill(COLOR_DEFAULT_BALL);
    bg.stroke({ width: 2, color: 0xffffff, alpha: 0.3 });
    c.addChild(bg);
    const label = new Text({
      text: digit.toString(),
      style: {
        fontFamily: "Arial",
        fontSize: 28,
        fontWeight: "bold",
        fill: 0xffffff,
      },
    });
    label.anchor.set(0.5);
    c.addChild(label);
    return c;
  }

  private highlightActiveBall(): void {
    for (let i = 0; i < this.middleBalls.length; i += 1) {
      const ball = this.middleBalls[i]!;
      // Active ball = currentRound (logical index). Reset all, then highlight.
      const bg = ball.children[0] as Graphics;
      bg.clear();
      bg.circle(0, 0, MIDDLE_BALL_SIZE / 2);
      const isActive = i === this.currentRound;
      bg.fill(isActive ? COLOR_ACTIVE_BALL : COLOR_DEFAULT_BALL);
      bg.stroke({ width: 2, color: 0xffffff, alpha: 0.3 });
      // Text color: active = black on yellow, else white.
      const label = ball.children[1] as Text;
      label.style.fill = isActive ? 0x1a1a2e : 0xffffff;
      // Scale pulse on active.
      if (isActive) {
        gsap.to(ball.scale, { x: 1.15, y: 1.15, duration: 0.3 });
      } else {
        gsap.to(ball.scale, { x: 1, y: 1, duration: 0.2 });
      }
    }
  }

  private renderUpDownButtons(): void {
    const activeVisualX = this.activeBallVisualX();
    const activeBallY = this.screenH * 0.32 + MIDDLE_BALL_SIZE / 2;

    // UP button above active ball.
    this.upButton = this.createArrowButton("up");
    this.upButton.x = activeVisualX;
    this.upButton.y = activeBallY - MIDDLE_BALL_SIZE / 2 - BUTTON_GAP - BUTTON_SIZE / 2;
    this.addChild(this.upButton);

    // DOWN button below active ball.
    this.downButton = this.createArrowButton("down");
    this.downButton.x = activeVisualX;
    this.downButton.y = activeBallY + MIDDLE_BALL_SIZE / 2 + BUTTON_GAP + BUTTON_SIZE / 2;
    this.addChild(this.downButton);
  }

  private activeBallVisualX(): number {
    const totalW =
      this.maxRounds * MIDDLE_BALL_SIZE + (this.maxRounds - 1) * MIDDLE_BALL_GAP;
    const startX = (this.screenW - totalW) / 2;
    const visualIndex = this.maxRounds - 1 - this.currentRound;
    return (
      startX + visualIndex * (MIDDLE_BALL_SIZE + MIDDLE_BALL_GAP) +
      MIDDLE_BALL_SIZE / 2
    );
  }

  private createArrowButton(direction: "up" | "down"): Container {
    const c = new Container();
    c.eventMode = "static";
    c.cursor = "pointer";
    const bg = new Graphics();
    bg.roundRect(-BUTTON_SIZE / 2, -BUTTON_SIZE / 2, BUTTON_SIZE, BUTTON_SIZE, 10);
    bg.fill(COLOR_BUTTON_BG);
    bg.stroke({ color: COLOR_BUTTON_BORDER, width: 2 });
    c.addChild(bg);
    // Arrow glyph — simple triangle.
    const arrow = new Graphics();
    const size = BUTTON_SIZE * 0.35;
    if (direction === "up") {
      arrow.moveTo(0, -size / 2);
      arrow.lineTo(size / 2, size / 2);
      arrow.lineTo(-size / 2, size / 2);
    } else {
      arrow.moveTo(0, size / 2);
      arrow.lineTo(size / 2, -size / 2);
      arrow.lineTo(-size / 2, -size / 2);
    }
    arrow.closePath();
    arrow.fill(COLOR_BUTTON_BORDER);
    c.addChild(arrow);

    c.on("pointerdown", () => this.selectDirection(direction));
    c.on("pointerover", () => {
      if (!this.finished && !this.choiceSent)
        gsap.to(c.scale, { x: 1.1, y: 1.1, duration: 0.15 });
    });
    c.on("pointerout", () => {
      if (!this.finished && !this.choiceSent)
        gsap.to(c.scale, { x: 1, y: 1, duration: 0.15 });
    });
    return c;
  }

  private disableUpDownButtons(): void {
    for (const b of [this.upButton, this.downButton]) {
      if (!b) continue;
      b.eventMode = "none";
      b.cursor = "default";
      b.alpha = 0.4;
    }
  }

  private enableUpDownButtons(): void {
    for (const b of [this.upButton, this.downButton]) {
      if (!b) continue;
      b.eventMode = "static";
      b.cursor = "pointer";
      b.alpha = 1;
    }
  }

  private moveUpDownButtons(): void {
    if (!this.upButton || !this.downButton) return;
    const targetX = this.activeBallVisualX();
    gsap.to(this.upButton, { x: targetX, duration: 0.3, ease: "power2.out" });
    gsap.to(this.downButton, { x: targetX, duration: 0.3, ease: "power2.out" });
  }

  private renderPrizeLadder(): void {
    // Ladder on the right: 6 steps stacked bottom-up.
    const ladderX = this.screenW - PRIZE_STEP_WIDTH / 2 - 30;
    const ladderBottom = this.screenH * 0.75;
    for (let i = 0; i < this.prizeListNok.length; i += 1) {
      const step = new Container();
      const bg = new Graphics();
      bg.roundRect(
        -PRIZE_STEP_WIDTH / 2,
        -PRIZE_STEP_HEIGHT / 2,
        PRIZE_STEP_WIDTH,
        PRIZE_STEP_HEIGHT,
        6,
      );
      bg.fill(COLOR_PRIZE_INACTIVE);
      bg.stroke({ width: 1, color: 0xffffff, alpha: 0.2 });
      step.addChild(bg);
      const label = new Text({
        text: `${this.prizeListNok[i]} kr`,
        style: {
          fontFamily: "Arial",
          fontSize: 13,
          fontWeight: "bold",
          fill: 0xffffff,
        },
      });
      label.anchor.set(0.5);
      step.addChild(label);

      step.x = ladderX;
      step.y = ladderBottom - i * PRIZE_STEP_HEIGHT;
      this.addChild(step);
      this.prizeLadderSteps.push(step);
    }
    // Initial arrow position at index 0.
    this.redrawArrowAtIndex(0);
  }

  private moveArrowToPrizeIndex(index: number, duration: number): void {
    const ladderBottom = this.screenH * 0.75;
    const target = ladderBottom - index * PRIZE_STEP_HEIGHT;
    // Highlight target step.
    for (let i = 0; i < this.prizeLadderSteps.length; i += 1) {
      const step = this.prizeLadderSteps[i]!;
      const bg = step.children[0] as Graphics;
      bg.clear();
      bg.roundRect(
        -PRIZE_STEP_WIDTH / 2,
        -PRIZE_STEP_HEIGHT / 2,
        PRIZE_STEP_WIDTH,
        PRIZE_STEP_HEIGHT,
        6,
      );
      bg.fill(i === index ? COLOR_PRIZE_ACTIVE : COLOR_PRIZE_INACTIVE);
      bg.stroke({ width: 1, color: 0xffffff, alpha: 0.2 });
      const label = step.children[1] as Text;
      label.style.fill = i === index ? 0x1a1a2e : 0xffffff;
    }
    // Arrow tween.
    gsap.to(this.prizeArrow, { y: target, duration, ease: "power2.out" });
  }

  private redrawArrowAtIndex(index: number): void {
    const ladderX = this.screenW - PRIZE_STEP_WIDTH - 40;
    const ladderBottom = this.screenH * 0.75;
    this.prizeArrow.clear();
    // Arrow points RIGHT (→) toward the active step.
    const ax = ladderX - 12;
    const aSize = 8;
    this.prizeArrow.moveTo(ax, -aSize);
    this.prizeArrow.lineTo(ax + aSize * 1.5, 0);
    this.prizeArrow.lineTo(ax, aSize);
    this.prizeArrow.closePath();
    this.prizeArrow.fill(COLOR_ACTIVE_BALL);
    this.prizeArrow.x = 0;
    this.prizeArrow.y = ladderBottom - index * PRIZE_STEP_HEIGHT;
    // Highlight target step.
    for (let i = 0; i < this.prizeLadderSteps.length; i += 1) {
      const step = this.prizeLadderSteps[i]!;
      const bg = step.children[0] as Graphics;
      bg.clear();
      bg.roundRect(
        -PRIZE_STEP_WIDTH / 2,
        -PRIZE_STEP_HEIGHT / 2,
        PRIZE_STEP_WIDTH,
        PRIZE_STEP_HEIGHT,
        6,
      );
      bg.fill(i === index ? COLOR_PRIZE_ACTIVE : COLOR_PRIZE_INACTIVE);
      bg.stroke({ width: 1, color: 0xffffff, alpha: 0.2 });
      const label = step.children[1] as Text;
      label.style.fill = i === index ? 0x1a1a2e : 0xffffff;
    }
  }

  private selectDirection(direction: "up" | "down"): void {
    if (this.finished || this.choiceSent) return;
    if (this.currentRound >= this.maxRounds) return;

    // Collect and reveal the round locally (optimistic).
    this.collectedDirections.push(direction);
    this.clearAutoTimer();
    this.timerText.text = "";

    // Reveal this round's resultDigit on the active ball (client-side
    // preview — server will re-validate, but middleNumber/resultNumber
    // came from trigger so the reveal is consistent).
    const middleDigit = getDigitAt(this.middleNumber, this.currentRound);
    const resultDigit = getDigitAt(this.resultNumber, this.currentRound);
    const isJoker = middleDigit === resultDigit;
    const isCorrect = isJoker
      ? false
      : (direction === "up" && resultDigit > middleDigit) ||
        (direction === "down" && resultDigit < middleDigit);

    // Update priceIndex locally for UI feedback.
    if (isJoker) {
      this.priceIndex = this.prizeListNok.length - 1;
    } else if (isCorrect) {
      this.priceIndex = Math.min(
        this.priceIndex + 1,
        this.prizeListNok.length - 1,
      );
    } else {
      this.priceIndex = Math.max(this.priceIndex - 1, 0);
    }
    this.moveArrowToPrizeIndex(this.priceIndex, 0.35);

    // Reveal the resultDigit on the active ball with color feedback.
    this.revealActiveBallResult(resultDigit, isJoker, isCorrect);

    if (isJoker || this.currentRound === this.maxRounds - 1) {
      // End of game — send all directions to server.
      this.disableUpDownButtons();
      this.choiceSent = true;
      setTimeout(() => {
        this.onChoice?.({ directions: this.collectedDirections });
      }, 800);
      return;
    }

    // Move to next round.
    this.currentRound += 1;
    setTimeout(() => {
      this.advanceToNextRound();
    }, 600);
  }

  private revealActiveBallResult(
    resultDigit: number,
    isJoker: boolean,
    isCorrect: boolean,
  ): void {
    const ball = this.middleBalls[this.currentRound];
    if (!ball) return;
    const bg = ball.children[0] as Graphics;
    bg.clear();
    bg.circle(0, 0, MIDDLE_BALL_SIZE / 2);
    if (isJoker) {
      bg.fill(COLOR_JOKER_BALL);
    } else if (isCorrect) {
      bg.fill(COLOR_CORRECT);
    } else {
      bg.fill(COLOR_WRONG);
    }
    bg.stroke({ width: 2, color: 0xffffff, alpha: 0.5 });
    const label = ball.children[1] as Text;
    // Show resultDigit replacing middleDigit with a scale animation.
    label.text = isJoker ? "?" : resultDigit.toString();
    label.style.fill = 0xffffff;
    gsap.fromTo(
      ball.scale,
      { x: 1.15, y: 1.15 },
      { x: 1.3, y: 1.3, duration: 0.15, yoyo: true, repeat: 1 },
    );
  }

  private advanceToNextRound(): void {
    this.highlightActiveBall();
    this.moveUpDownButtons();
    this.enableUpDownButtons();
    this.startRoundTimer();
  }

  private startRoundTimer(): void {
    const sec =
      this.currentRound === 0
        ? this.autoTurnFirstMoveSec
        : this.autoTurnOtherMoveSec;
    this.autoCountdown = sec;
    this.timerText.text = `Auto-valg om ${sec}s`;
    this.autoTimer = setInterval(() => {
      this.autoCountdown -= 1;
      if (this.autoCountdown <= 0) {
        this.clearAutoTimer();
        this.timerText.text = "";
        // Default auto-turn: "down" (arbitrary — legacy didn't specify for Game 1).
        this.selectDirection("down");
      } else {
        this.timerText.text = `Auto-valg om ${this.autoCountdown}s`;
      }
    }, 1000);
  }

  private clearAutoTimer(): void {
    if (this.autoTimer) {
      clearInterval(this.autoTimer);
      this.autoTimer = null;
    }
  }
}

/** Exposed for tests. */
export const __Mystery_AUTO_DISMISS_AFTER_RESULT_SECONDS__ =
  AUTO_DISMISS_AFTER_RESULT_SECONDS;
export const __Mystery_getDigitAt = getDigitAt;
