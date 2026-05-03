import { Container, Graphics, Text } from "pixi.js";
import type { GameState } from "../../../bridge/GameBridge.js";
import type { PatternWonPayload } from "@spillorama/shared-types/socket-events";
import type { AudioManager } from "../../../audio/AudioManager.js";
import type { SpilloramaSocket } from "../../../net/SpilloramaSocket.js";
import { TicketScroller } from "../components/TicketScroller.js";
import { TicketCard } from "../components/TicketCard.js";
import { DrawnBallsPanel } from "../components/DrawnBallsPanel.js";
import { ClaimButton } from "../components/ClaimButton.js";
import { PlayerInfoBar } from "../components/PlayerInfoBar.js";
import { JackpotBar, type JackpotSlotData } from "../components/JackpotBar.js";
import { ChatPanel } from "../../../components/ChatPanel.js";
import { getTicketThemeByName } from "../../game1/colors/TicketColorThemes.js";
import { checkClaims } from "../logic/ClaimDetector.js";

const CHAT_WIDTH = 280;
const CHAT_MARGIN = 12;

/**
 * Main gameplay screen — shown during PLAYING state.
 */
export class PlayScreen extends Container {
  private scroller: TicketScroller;
  private drawnBalls: DrawnBallsPanel;
  private jackpotBar: JackpotBar;
  private chatPanel: ChatPanel | null = null;
  private lineBtn: ClaimButton;
  private bingoBtn: ClaimButton;
  private infoBar: PlayerInfoBar;
  private luckyNumberText: Text;
  private pageIndicator: Text;
  private prevBtn: Container;
  private nextBtn: Container;
  private audio: AudioManager;
  private onClaim: ((type: "LINE" | "BINGO") => void) | null = null;
  private lineAlreadyWon = false;
  private bingoAlreadyWon = false;

  constructor(
    screenWidth: number,
    screenHeight: number,
    audio: AudioManager,
    socket?: SpilloramaSocket,
    roomCode?: string,
  ) {
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

    // Chat (right sidebar) — optional, enabled when socket + roomCode provided
    const chatEnabled = socket != null && roomCode != null;
    const chatRightEdge = screenWidth - CHAT_MARGIN;
    const chatLeftEdge = chatEnabled ? chatRightEdge - CHAT_WIDTH : screenWidth;

    // 2026-05-02 (Tobias UX): stabling-animasjon fjernet (PDF 17 wireframe).
    // I stedet rendres Jackpot-bar over ticket-grid med 6 slots
    // (9/10/11/12/13/14-21). Data via socket-event `g2:jackpot:list-update`.
    this.jackpotBar = new JackpotBar();
    this.jackpotBar.x = 20;
    this.jackpotBar.y = 85;
    this.addChild(this.jackpotBar);

    // Ticket scroller (main area) — leave room for chat (optional). Med
    // jackpot-bar over scrolleren skyves toppen ned til 165 (85 + 70 + 10 gap).
    const scrollerY = 165;
    const scrollerHeight = screenHeight - scrollerY - 80;
    const scrollerWidth = (chatEnabled ? chatLeftEdge - CHAT_MARGIN : chatRightEdge) - 20;
    this.scroller = new TicketScroller(scrollerWidth, scrollerHeight);
    this.scroller.x = 20;
    this.scroller.y = scrollerY;
    this.addChild(this.scroller);

    if (chatEnabled) {
      const chatTop = 45;
      const chatHeight = screenHeight - chatTop - 20;
      this.chatPanel = new ChatPanel(socket, roomCode, chatHeight);
      this.chatPanel.x = chatLeftEdge;
      this.chatPanel.y = chatTop;
      this.addChild(this.chatPanel);
    }

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

    // Ticket pager — prev/next buttons + page indicator below scroller
    const pagerY = scrollerY + scrollerHeight + 6;
    this.prevBtn = this.buildPagerButton("‹");
    this.prevBtn.x = 20;
    this.prevBtn.y = pagerY;
    this.prevBtn.on("pointerdown", () => {
      this.scroller.pagePrev();
      setTimeout(() => this.updatePageIndicator(), 270);
    });
    this.addChild(this.prevBtn);

    this.nextBtn = this.buildPagerButton("›");
    this.nextBtn.x = 20 + 36 + 8;
    this.nextBtn.y = pagerY;
    this.nextBtn.on("pointerdown", () => {
      this.scroller.pageNext();
      setTimeout(() => this.updatePageIndicator(), 270);
    });
    this.addChild(this.nextBtn);

    this.pageIndicator = new Text({
      text: "",
      style: { fontFamily: "Arial", fontSize: 13, fill: 0xaaaaaa },
    });
    this.pageIndicator.x = 20 + (36 + 8) * 2;
    this.pageIndicator.y = pagerY + 8;
    this.addChild(this.pageIndicator);
  }

  private buildPagerButton(glyph: string): Container {
    const btn = new Container();
    const bg = new Graphics();
    bg.roundRect(0, 0, 36, 28, 6);
    bg.fill(0x2e0000);
    bg.stroke({ color: 0x790001, width: 1 });
    btn.addChild(bg);
    const label = new Text({
      text: glyph,
      style: { fontFamily: "Arial", fontSize: 20, fontWeight: "bold", fill: 0xffe83d },
    });
    label.anchor.set(0.5);
    label.x = 18;
    label.y = 14;
    btn.addChild(label);
    btn.eventMode = "static";
    btn.cursor = "pointer";
    return btn;
  }

  private updatePageIndicator(): void {
    const { current, total } = this.scroller.getPageInfo();
    this.pageIndicator.text = total > 1 ? `Kort ${current} / ${total}` : "";
    const show = total > 1;
    this.prevBtn.visible = show;
    this.nextBtn.visible = show;
  }

  setOnClaim(callback: (type: "LINE" | "BINGO") => void): void {
    this.onClaim = callback;
  }

  /** Build ticket grids from game state. */
  buildTickets(state: GameState): void {
    this.scroller.clearCards();
    this.jackpotBar.setCurrentDrawCount(state.drawnNumbers.length);
    this.lineAlreadyWon = false;
    this.bingoAlreadyWon = false;

    // Check if patterns already won
    for (const result of state.patternResults) {
      if (result.isWon && result.claimType === "LINE") this.lineAlreadyWon = true;
      if (result.isWon && result.claimType === "BINGO") this.bingoAlreadyWon = true;
    }

    for (let i = 0; i < state.myTickets.length; i++) {
      const ticket = state.myTickets[i];
      const theme = getTicketThemeByName(ticket.color, i);
      const card = new TicketCard(i, {
        cardBg: theme.cardBg,
        headerBg: theme.headerBg,
        headerText: theme.headerText,
        toGoColor: theme.toGoColor,
        toGoCloseColor: theme.toGoCloseColor,
        cellColors: theme.cellColors,
      });
      card.loadTicket(ticket);

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
    this.updatePageIndicator();
    this.updateClaimButtons(state);
  }

  /** Handle a newly drawn number. */
  onNumberDrawn(number: number, drawIndex: number, state: GameState): void {
    this.scroller.markNumberOnAll(number);
    this.drawnBalls.addBall(number);
    // Jackpot-bar highlightes på matching slot (9-13 eller 14-21).
    this.jackpotBar.setCurrentDrawCount(state.drawnNumbers.length);
    this.audio.playNumber(number);
    this.scroller.sortBestFirst();
    this.updateClaimButtons(state);
    this.updateInfo(state);
  }

  /**
   * 2026-05-02: oppdater jackpot-bar med ny prize-liste fra backend.
   * Kalles fra Game2Controller på `g2:jackpot:list-update`-event.
   */
  updateJackpot(list: JackpotSlotData[]): void {
    this.jackpotBar.update(list);
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
    this.jackpotBar.setCurrentDrawCount(0);
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
