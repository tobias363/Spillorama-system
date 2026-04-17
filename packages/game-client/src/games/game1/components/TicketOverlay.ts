import { Container, Graphics, Text } from "pixi.js";
import { TicketScroller } from "../../game2/components/TicketScroller.js";
import { TicketCard } from "../../game2/components/TicketCard.js";
import { ClaimButton } from "../../game2/components/ClaimButton.js";
import { checkClaims } from "../../game2/logic/ClaimDetector.js";
import { getTicketThemeByName } from "../colors/TicketColorThemes.js";
import type { GameState } from "../../../bridge/GameBridge.js";
import gsap from "gsap";

/**
 * Toggleable fullscreen overlay showing all bingo tickets.
 *
 * Opened via "Kjop flere brett" button or auto-shown when claim is ready.
 * Contains a TicketScroller, LINE and BINGO claim buttons, and a close button.
 */
export class TicketOverlay extends Container {
  private bg: Graphics;
  private scroller: TicketScroller;
  private lineBtn: ClaimButton;
  private bingoBtn: ClaimButton;
  private closeBtn: Container;
  private onClaim: ((type: "LINE" | "BINGO") => void) | null = null;
  private lineAlreadyWon = false;
  private bingoAlreadyWon = false;
  private screenW: number;
  private screenH: number;

  constructor(screenWidth: number, screenHeight: number) {
    super();
    this.screenW = screenWidth;
    this.screenH = screenHeight;
    this.visible = false;

    // Semi-transparent background
    this.bg = new Graphics();
    this.bg.rect(0, 0, screenWidth, screenHeight);
    this.bg.fill({ color: 0x000000, alpha: 0.85 });
    this.bg.eventMode = "static";
    this.bg.cursor = "default";
    this.addChild(this.bg);

    // Title
    const title = new Text({
      text: "Mine brett",
      style: {
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 24,
        fontWeight: "bold",
        fill: 0xffe83d,
      },
    });
    title.anchor.set(0.5, 0);
    title.x = screenWidth / 2;
    title.y = 20;
    this.addChild(title);

    // Close button (top-right)
    this.closeBtn = new Container();
    this.closeBtn.eventMode = "static";
    this.closeBtn.cursor = "pointer";
    const closeBg = new Graphics();
    closeBg.circle(0, 0, 18);
    closeBg.fill({ color: 0xffffff, alpha: 0.15 });
    closeBg.stroke({ color: 0xffffff, width: 1.5, alpha: 0.5 });
    this.closeBtn.addChild(closeBg);
    const closeX = new Text({
      text: "\u2715",
      style: { fontFamily: "Arial", fontSize: 18, fill: 0xffffff },
    });
    closeX.anchor.set(0.5);
    this.closeBtn.addChild(closeX);
    this.closeBtn.x = screenWidth - 40;
    this.closeBtn.y = 30;
    this.closeBtn.on("pointerdown", () => this.hide());
    this.addChild(this.closeBtn);

    // Ticket scroller (centered)
    const scrollerW = Math.min(screenWidth - 60, 900);
    const scrollerH = screenHeight - 160;
    this.scroller = new TicketScroller(scrollerW, scrollerH);
    this.scroller.x = (screenWidth - scrollerW) / 2;
    this.scroller.y = 60;
    this.addChild(this.scroller);

    // Claim buttons (bottom center)
    this.lineBtn = new ClaimButton("LINE", 140, 50);
    this.lineBtn.x = screenWidth / 2 - 150;
    this.lineBtn.y = screenHeight - 70;
    this.lineBtn.setOnClaim((type) => this.onClaim?.(type));
    this.addChild(this.lineBtn);

    this.bingoBtn = new ClaimButton("BINGO", 140, 50);
    this.bingoBtn.x = screenWidth / 2 + 10;
    this.bingoBtn.y = screenHeight - 70;
    this.bingoBtn.setOnClaim((type) => this.onClaim?.(type));
    this.addChild(this.bingoBtn);
  }

  setOnClaim(callback: (type: "LINE" | "BINGO") => void): void {
    this.onClaim = callback;
  }

  /** Build ticket cards from game state. */
  buildTickets(state: GameState): void {
    this.scroller.clearCards();
    this.lineAlreadyWon = false;
    this.bingoAlreadyWon = false;

    for (const result of state.patternResults) {
      if (result.isWon && result.claimType === "LINE") this.lineAlreadyWon = true;
      if (result.isWon && result.claimType === "BINGO") this.bingoAlreadyWon = true;
    }

    for (let i = 0; i < state.myTickets.length; i++) {
      const ticket = state.myTickets[i];
      const ticketRows = ticket.grid?.length ?? 3;
      const ticketCols = ticket.grid?.[0]?.length ?? 5;
      const gridSize = (ticketRows === 5 && ticketCols === 5) ? "5x5" : "3x5";
      const theme = getTicketThemeByName(ticket.color, i);
      const card = new TicketCard(i, {
        gridSize,
        cardBg: theme.cardBg,
        headerBg: theme.headerBg,
        headerText: theme.headerText,
        toGoColor: theme.toGoColor,
        toGoCloseColor: theme.toGoCloseColor,
        cellColors: theme.cellColors,
      });
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

  /** Mark a new number on all tickets. */
  onNumberDrawn(number: number, state: GameState): void {
    this.scroller.markNumberOnAll(number);
    this.scroller.sortBestFirst();
    this.updateClaimButtons(state);
  }

  onPatternWon(claimType: "LINE" | "BINGO"): void {
    if (claimType === "LINE") { this.lineAlreadyWon = true; this.lineBtn.reset(); }
    if (claimType === "BINGO") { this.bingoAlreadyWon = true; this.bingoBtn.reset(); }
  }

  show(): void {
    this.visible = true;
    this.alpha = 0;
    gsap.to(this, { alpha: 1, duration: 0.25 });
  }

  hide(): void {
    gsap.to(this, {
      alpha: 0,
      duration: 0.2,
      onComplete: () => { this.visible = false; },
    });
  }

  isShowing(): boolean {
    return this.visible;
  }

  private updateClaimButtons(state: GameState): void {
    const { canClaimLine, canClaimBingo } = checkClaims(state.myTickets, state.myMarks, state.drawnNumbers);
    if (canClaimLine && !this.lineAlreadyWon) this.lineBtn.setState("ready");
    if (canClaimBingo && !this.bingoAlreadyWon) this.bingoBtn.setState("ready");
  }
}
