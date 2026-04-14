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
import { ChatPanel } from "../components/ChatPanel.js";
import { checkClaims } from "../../game2/logic/ClaimDetector.js";

const CHAT_WIDTH = 280;

/**
 * Game 1 (Classic Bingo) play screen — 5x5 grids + chat panel.
 */
export class PlayScreen extends Container {
  private scroller: TicketScroller;
  private drawnBalls: DrawnBallsPanel;
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

    const gameAreaWidth = screenWidth - CHAT_WIDTH - 30;

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
    this.luckyNumberText.x = gameAreaWidth - 130;
    this.luckyNumberText.y = 14;
    this.addChild(this.luckyNumberText);

    // Drawn balls panel
    this.drawnBalls = new DrawnBallsPanel();
    this.drawnBalls.x = 20;
    this.drawnBalls.y = 45;
    this.addChild(this.drawnBalls);

    // Ticket scroller (main area — narrower due to chat)
    const scrollerY = 100;
    const scrollerHeight = screenHeight - scrollerY - 80;
    this.scroller = new TicketScroller(gameAreaWidth - 20, scrollerHeight);
    this.scroller.x = 20;
    this.scroller.y = scrollerY;
    this.addChild(this.scroller);

    // Claim buttons (bottom)
    this.lineBtn = new ClaimButton("LINE", 140, 50);
    this.lineBtn.x = gameAreaWidth / 2 - 150;
    this.lineBtn.y = screenHeight - 65;
    this.lineBtn.setOnClaim((type) => this.onClaim?.(type));
    this.addChild(this.lineBtn);

    this.bingoBtn = new ClaimButton("BINGO", 140, 50);
    this.bingoBtn.x = gameAreaWidth / 2 + 10;
    this.bingoBtn.y = screenHeight - 65;
    this.bingoBtn.setOnClaim((type) => this.onClaim?.(type));
    this.addChild(this.bingoBtn);
  }

  setOnClaim(callback: (type: "LINE" | "BINGO") => void): void {
    this.onClaim = callback;
  }

  /** Subscribe chat panel to bridge chat events. */
  subscribeChatToBridge(onChat: (listener: (msg: import("@spillorama/shared-types/socket-events").ChatMessage) => void) => () => void): void {
    this.chatPanel.subscribeToBridge(onChat);
  }

  /** Build ticket grids from game state — 5x5 for Game 1. */
  buildTickets(state: GameState): void {
    this.scroller.clearCards();
    this.lineAlreadyWon = false;
    this.bingoAlreadyWon = false;

    for (const result of state.patternResults) {
      if (result.isWon && result.claimType === "LINE") this.lineAlreadyWon = true;
      if (result.isWon && result.claimType === "BINGO") this.bingoAlreadyWon = true;
    }

    for (let i = 0; i < state.myTickets.length; i++) {
      const card = new TicketCard(i, { gridSize: "5x5", cellSize: 38 });
      card.loadTicket(state.myTickets[i]);

      if (state.myMarks[i]) {
        card.markNumbers(state.myMarks[i]);
      } else {
        for (const n of state.drawnNumbers) card.markNumber(n);
      }

      if (state.myLuckyNumber) card.highlightLuckyNumber(state.myLuckyNumber);

      this.scroller.addCard(card);
    }

    this.scroller.sortBestFirst();
    this.updateClaimButtons(state);
  }

  onNumberDrawn(number: number, drawIndex: number, state: GameState): void {
    this.scroller.markNumberOnAll(number);
    this.drawnBalls.addBall(number);
    this.audio.playNumber(number);
    this.scroller.sortBestFirst();
    this.updateClaimButtons(state);
    this.updateInfo(state);
  }

  onPatternWon(payload: PatternWonPayload): void {
    if (payload.claimType === "LINE") { this.lineAlreadyWon = true; this.lineBtn.reset(); }
    if (payload.claimType === "BINGO") { this.bingoAlreadyWon = true; this.bingoBtn.reset(); }
  }

  updateInfo(state: GameState): void {
    this.infoBar.update(state.playerCount, state.drawCount, state.totalDrawCapacity, state.prizePool);
    this.luckyNumberText.text = state.myLuckyNumber ? `Heldig tall: ${state.myLuckyNumber}` : "";
  }

  reset(): void {
    this.scroller.clearCards();
    this.drawnBalls.clear();
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
