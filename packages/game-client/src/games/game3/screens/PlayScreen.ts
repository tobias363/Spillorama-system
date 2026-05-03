import { Container, Text } from "pixi.js";
import type { GameState } from "../../../bridge/GameBridge.js";
import type { PatternWonPayload } from "@spillorama/shared-types/socket-events";
import type { AudioManager } from "../../../audio/AudioManager.js";
import type { SpilloramaSocket } from "../../../net/SpilloramaSocket.js";
import { TicketScroller } from "../../game2/components/TicketScroller.js";
import { TicketCard } from "../../game2/components/TicketCard.js";
import { DrawnBallsPanel } from "../../game2/components/DrawnBallsPanel.js";
import { ClaimButton } from "../../game2/components/ClaimButton.js";
import { PlayerInfoBar } from "../../game2/components/PlayerInfoBar.js";
import { ChatPanel } from "../../../components/ChatPanel.js";
import { AnimatedBallQueue } from "../components/AnimatedBallQueue.js";
import { PatternBanner } from "../components/PatternBanner.js";
import { checkClaims } from "../../game2/logic/ClaimDetector.js";

const CHAT_WIDTH = 280;
const BALL_QUEUE_WIDTH = 80;

/**
 * Game 3 (Monster Bingo / Spill 3) play screen.
 *
 * 2026-05-03 (Tobias-direktiv): hybrid av Spill 2's runtime og Spill 1's stil.
 * Bonger er nå **3×3** (1..21), ikke 5×5 — samme format som Spill 2. Visuelle
 * elementer (chat, ball queue, pattern banner) gjenbrukes fra Spill 1's
 * komponentbibliotek.
 *
 * Tidligere (BIN-615 / PR-C3b, 2026-04-23): 5×5 / 1..75 med Row 1-4 + Coverall.
 * Den varianten er erstattet — Spill 3 har nå KUN Coverall (full 3×3-bong).
 */
export class PlayScreen extends Container {
  private scroller: TicketScroller;
  private drawnBalls: DrawnBallsPanel;
  private ballQueue: AnimatedBallQueue;
  private patternBanner: PatternBanner;
  private lineBtn: ClaimButton;
  private bingoBtn: ClaimButton;
  private infoBar: PlayerInfoBar;
  private chatPanel: ChatPanel;
  private luckyNumberText: Text;
  private audio: AudioManager;
  private onClaim: ((type: "LINE" | "BINGO") => void) | null = null;
  private lineAlreadyWon = false;
  private bingoAlreadyWon = false;

  constructor(
    screenWidth: number,
    screenHeight: number,
    audio: AudioManager,
    socket: SpilloramaSocket,
    roomCode: string,
  ) {
    super();
    this.audio = audio;

    // Chat panel (right side)
    this.chatPanel = new ChatPanel(socket, roomCode, screenHeight - 20);
    this.chatPanel.x = screenWidth - CHAT_WIDTH - 10;
    this.chatPanel.y = 10;
    this.addChild(this.chatPanel);

    // Animated ball queue (left side — Game 3 signature)
    this.ballQueue = new AnimatedBallQueue();
    this.ballQueue.x = 10;
    this.ballQueue.y = 45;
    this.addChild(this.ballQueue);

    const gameAreaLeft = BALL_QUEUE_WIDTH + 10;
    const gameAreaWidth = screenWidth - CHAT_WIDTH - gameAreaLeft - 20;

    // Info bar (top)
    this.infoBar = new PlayerInfoBar();
    this.infoBar.x = gameAreaLeft;
    this.infoBar.y = 10;
    this.addChild(this.infoBar);

    // Lucky number display
    this.luckyNumberText = new Text({
      text: "",
      style: { fontFamily: "Arial", fontSize: 16, fill: 0xffe83d },
    });
    this.luckyNumberText.x = gameAreaLeft + gameAreaWidth - 130;
    this.luckyNumberText.y = 14;
    this.addChild(this.luckyNumberText);

    // Drawn balls panel (horizontal strip below info bar)
    this.drawnBalls = new DrawnBallsPanel();
    this.drawnBalls.x = gameAreaLeft;
    this.drawnBalls.y = 45;
    this.addChild(this.drawnBalls);
    this.patternBanner = new PatternBanner(gameAreaWidth);
    this.patternBanner.x = gameAreaLeft;
    this.patternBanner.y = 78;
    this.addChild(this.patternBanner);

    // Ticket scroller (main area) — pushed down to make room for banner
    const scrollerY = 124;
    const scrollerHeight = screenHeight - scrollerY - 80;
    this.scroller = new TicketScroller(gameAreaWidth, scrollerHeight);
    this.scroller.x = gameAreaLeft;
    this.scroller.y = scrollerY;
    this.addChild(this.scroller);

    // Claim buttons (bottom)
    const btnCenterX = gameAreaLeft + gameAreaWidth / 2;
    this.lineBtn = new ClaimButton("LINE", 140, 50);
    this.lineBtn.x = btnCenterX - 150;
    this.lineBtn.y = screenHeight - 65;
    this.lineBtn.setOnClaim((type) => this.onClaim?.(type));
    this.addChild(this.lineBtn);

    this.bingoBtn = new ClaimButton("BINGO", 140, 50);
    this.bingoBtn.x = btnCenterX + 10;
    this.bingoBtn.y = screenHeight - 65;
    this.bingoBtn.setOnClaim((type) => this.onClaim?.(type));
    this.addChild(this.bingoBtn);
  }

  setOnClaim(callback: (type: "LINE" | "BINGO") => void): void {
    this.onClaim = callback;
  }

  subscribeChatToBridge(onChat: (listener: (msg: import("@spillorama/shared-types/socket-events").ChatMessage) => void) => () => void): void {
    this.chatPanel.subscribeToBridge(onChat);
  }

  buildTickets(state: GameState): void {
    this.scroller.clearCards();
    this.ballQueue.clear();
    this.lineAlreadyWon = false;
    this.bingoAlreadyWon = false;

    for (const result of state.patternResults) {
      if (result.isWon && result.claimType === "LINE") this.lineAlreadyWon = true;
      if (result.isWon && result.claimType === "BINGO") this.bingoAlreadyWon = true;
    }

    for (let i = 0; i < state.myTickets.length; i++) {
      // 2026-05-03 (Tobias-direktiv): Spill 3 bruker 3×3-bonger. Større
      // cellSize (52 vs. 38) fordi 9 celler trenger mer plass per celle for
      // å beholde lesbarhet på samme scroller-bredde.
      const card = new TicketCard(i, { gridSize: "3x3", cellSize: 52 });
      card.loadTicket(state.myTickets[i]);

      if (state.myMarks[i]) {
        card.markNumbers(state.myMarks[i]);
      } else {
        for (const n of state.drawnNumbers) card.markNumber(n);
      }

      if (state.myLuckyNumber) card.highlightLuckyNumber(state.myLuckyNumber);

      this.scroller.addCard(card);
    }

    // Populate ball queue with last 5 drawn numbers
    const lastFive = state.drawnNumbers.slice(-5);
    for (const n of lastFive) {
      this.ballQueue.addBall(n);
    }

    this.scroller.sortBestFirst();
    this.patternBanner.update(state.patterns, state.patternResults);
    this.updateClaimButtons(state);
  }

  onNumberDrawn(number: number, drawIndex: number, state: GameState): void {
    this.scroller.markNumberOnAll(number);
    this.drawnBalls.addBall(number);
    this.ballQueue.addBall(number); // Animated ball queue entry
    this.audio.playNumber(number);
    this.scroller.sortBestFirst();
    this.updateClaimButtons(state);
    this.updateInfo(state);
  }

  onPatternWon(payload: PatternWonPayload): void {
    if (payload.claimType === "LINE") { this.lineAlreadyWon = true; this.lineBtn.reset(); }
    if (payload.claimType === "BINGO") { this.bingoAlreadyWon = true; this.bingoBtn.reset(); }
  }

  /** Refresh banner after patternWon/state changes from controller. */
  refreshPatternBanner(state: GameState): void {
    this.patternBanner.update(state.patterns, state.patternResults);
  }

  updateInfo(state: GameState): void {
    this.infoBar.update(state.playerCount, state.drawCount, state.totalDrawCapacity, state.prizePool);
    this.luckyNumberText.text = state.myLuckyNumber ? `Heldig tall: ${state.myLuckyNumber}` : "";
  }

  reset(): void {
    this.scroller.clearCards();
    this.drawnBalls.clear();
    this.ballQueue.clear();
    this.lineBtn.reset();
    this.bingoBtn.reset();
    this.lineAlreadyWon = false;
    this.bingoAlreadyWon = false;
  }

  private updateClaimButtons(state: GameState): void {
    const { canClaimLine, canClaimBingo } = checkClaims(state.myTickets, state.myMarks, state.drawnNumbers);
    if (canClaimLine && !this.lineAlreadyWon) this.lineBtn.setState("ready");
    if (canClaimBingo && !this.bingoAlreadyWon) this.bingoBtn.setState("ready");
  }
}
