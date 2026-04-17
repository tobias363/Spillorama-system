import { Container, Text } from "pixi.js";
import type { GameState } from "../../../bridge/GameBridge.js";
import type { PatternWonPayload } from "@spillorama/shared-types/socket-events";
import type { AudioManager } from "../../../audio/AudioManager.js";
import { TicketScroller } from "../components/TicketScroller.js";
import { TicketCard } from "../components/TicketCard.js";
import { DrawnBallsPanel } from "../components/DrawnBallsPanel.js";
import { ClaimButton } from "../components/ClaimButton.js";
import { PlayerInfoBar } from "../components/PlayerInfoBar.js";
import { RocketStack } from "../components/RocketStack.js";
import { checkClaims } from "../logic/ClaimDetector.js";

/**
 * Main gameplay screen — shown during PLAYING state.
 */
export class PlayScreen extends Container {
  private scroller: TicketScroller;
  private drawnBalls: DrawnBallsPanel;
  private rocketStack: RocketStack;
  private lineBtn: ClaimButton;
  private bingoBtn: ClaimButton;
  private infoBar: PlayerInfoBar;
  private luckyNumberText: Text;
  private audio: AudioManager;
  private onClaim: ((type: "LINE" | "BINGO") => void) | null = null;
  private lineAlreadyWon = false;
  private bingoAlreadyWon = false;

  constructor(screenWidth: number, screenHeight: number, audio: AudioManager) {
    super();
    this.audio = audio;

    // Info bar (top)
    this.infoBar = new PlayerInfoBar();
    this.infoBar.x = 20;
    this.infoBar.y = 10;
    this.addChild(this.infoBar);

    // Lucky number display
    this.luckyNumberText = new Text({
      text: "",
      style: { fontFamily: "Arial", fontSize: 16, fill: 0xffe83d },
    });
    this.luckyNumberText.x = screenWidth - 150;
    this.luckyNumberText.y = 14;
    this.addChild(this.luckyNumberText);

    // Drawn balls panel
    this.drawnBalls = new DrawnBallsPanel();
    this.drawnBalls.x = 20;
    this.drawnBalls.y = 45;
    this.addChild(this.drawnBalls);

    // Rocket-stabling — G2 signature. 60-ball range matches BingoEngine capacity.
    const rocketWidth = 42;
    const rocketMargin = 12;
    const rocketTop = 110;
    const rocketHeight = screenHeight - rocketTop - 80;
    this.rocketStack = new RocketStack(rocketWidth, rocketHeight, 60);
    this.rocketStack.x = screenWidth - rocketWidth - rocketMargin;
    this.rocketStack.y = rocketTop;
    this.addChild(this.rocketStack);

    // Ticket scroller (main area) — leave room for rocket on right.
    const scrollerY = 100;
    const scrollerHeight = screenHeight - scrollerY - 80;
    const scrollerWidth = screenWidth - 40 - rocketWidth - rocketMargin;
    this.scroller = new TicketScroller(scrollerWidth, scrollerHeight);
    this.scroller.x = 20;
    this.scroller.y = scrollerY;
    this.addChild(this.scroller);

    // Claim buttons (bottom)
    this.lineBtn = new ClaimButton("LINE", 140, 50);
    this.lineBtn.x = screenWidth / 2 - 150;
    this.lineBtn.y = screenHeight - 65;
    this.lineBtn.setOnClaim((type) => this.onClaim?.(type));
    this.addChild(this.lineBtn);

    this.bingoBtn = new ClaimButton("BINGO", 140, 50);
    this.bingoBtn.x = screenWidth / 2 + 10;
    this.bingoBtn.y = screenHeight - 65;
    this.bingoBtn.setOnClaim((type) => this.onClaim?.(type));
    this.addChild(this.bingoBtn);
  }

  setOnClaim(callback: (type: "LINE" | "BINGO") => void): void {
    this.onClaim = callback;
  }

  /** Build ticket grids from game state. */
  buildTickets(state: GameState): void {
    this.scroller.clearCards();
    this.rocketStack.syncTo(state.drawnNumbers.length);
    this.lineAlreadyWon = false;
    this.bingoAlreadyWon = false;

    // Check if patterns already won
    for (const result of state.patternResults) {
      if (result.isWon && result.claimType === "LINE") this.lineAlreadyWon = true;
      if (result.isWon && result.claimType === "BINGO") this.bingoAlreadyWon = true;
    }

    for (let i = 0; i < state.myTickets.length; i++) {
      const card = new TicketCard(i);
      card.loadTicket(state.myTickets[i]);

      // Mark already drawn numbers
      if (state.myMarks[i]) {
        card.markNumbers(state.myMarks[i]);
      } else {
        // Fallback: mark from drawn numbers
        for (const n of state.drawnNumbers) {
          card.markNumber(n);
        }
      }

      // Highlight lucky number
      if (state.myLuckyNumber) {
        card.highlightLuckyNumber(state.myLuckyNumber);
      }

      this.scroller.addCard(card);
    }

    this.scroller.sortBestFirst();
    this.updateClaimButtons(state);
  }

  /** Handle a newly drawn number. */
  onNumberDrawn(number: number, drawIndex: number, state: GameState): void {
    this.scroller.markNumberOnAll(number);
    this.drawnBalls.addBall(number);
    this.rocketStack.addSegment();
    this.audio.playNumber(number);
    this.scroller.sortBestFirst();
    this.updateClaimButtons(state);
    this.updateInfo(state);
  }

  /** Handle pattern won broadcast. */
  onPatternWon(payload: PatternWonPayload): void {
    if (payload.claimType === "LINE") {
      this.lineAlreadyWon = true;
      this.lineBtn.reset();
    }
    if (payload.claimType === "BINGO") {
      this.bingoAlreadyWon = true;
      this.bingoBtn.reset();
    }
  }

  /** Update display from game state. */
  updateInfo(state: GameState): void {
    this.infoBar.update(
      state.playerCount,
      state.drawCount,
      state.totalDrawCapacity,
      state.prizePool,
    );
    this.luckyNumberText.text = state.myLuckyNumber
      ? `Heldig tall: ${state.myLuckyNumber}`
      : "";
  }

  /** Reset for next game. */
  reset(): void {
    this.scroller.clearCards();
    this.drawnBalls.clear();
    this.rocketStack.reset();
    this.lineBtn.reset();
    this.bingoBtn.reset();
    this.lineAlreadyWon = false;
    this.bingoAlreadyWon = false;
  }

  private updateClaimButtons(state: GameState): void {
    const { canClaimLine, canClaimBingo } = checkClaims(
      state.myTickets,
      state.myMarks,
      state.drawnNumbers,
    );

    if (canClaimLine && !this.lineAlreadyWon) {
      this.lineBtn.setState("ready");
    }
    if (canClaimBingo && !this.bingoAlreadyWon) {
      this.bingoBtn.setState("ready");
    }
  }
}
