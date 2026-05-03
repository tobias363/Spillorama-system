import { Container, Graphics, Text } from "pixi.js";
import type { GameState } from "../../../bridge/GameBridge.js";
import { CountdownTimer } from "../components/CountdownTimer.js";
import { BuyPopup } from "../components/BuyPopup.js";
import { LuckyNumberPicker } from "../components/LuckyNumberPicker.js";
import { PlayerInfoBar } from "../components/PlayerInfoBar.js";

/**
 * Lobby/waiting screen — shown between games.
 * Player can buy tickets, select lucky number, and see countdown.
 */
export class LobbyScreen extends Container {
  private statusText: Text;
  private countdown: CountdownTimer;
  private buyPopup: BuyPopup;
  private luckyPicker: LuckyNumberPicker;
  private infoBar: PlayerInfoBar;
  private screenWidth: number;
  private screenHeight: number;
  private onBuy: ((count: number) => void) | null = null;
  private onLuckyNumber: ((number: number) => void) | null = null;
  private onChooseTickets: (() => void) | null = null;

  constructor(screenWidth: number, screenHeight: number) {
    super();
    this.screenWidth = screenWidth;
    this.screenHeight = screenHeight;

    // Info bar
    this.infoBar = new PlayerInfoBar();
    this.infoBar.x = 20;
    this.infoBar.y = 10;
    this.addChild(this.infoBar);

    // Status text
    this.statusText = new Text({
      text: "Venter på spill...",
      style: {
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 28,
        fontWeight: "bold",
        fill: 0xffe83d, // Yellow like Unity
        align: "center",
      },
    });
    this.statusText.anchor.set(0.5);
    this.statusText.x = screenWidth / 2;
    this.statusText.y = screenHeight / 2 - 80;
    this.addChild(this.statusText);

    // Countdown timer
    this.countdown = new CountdownTimer();
    this.countdown.x = screenWidth / 2;
    this.countdown.y = screenHeight / 2;
    this.addChild(this.countdown);

    // Lucky number button
    const luckyBtn = new Container();
    const luckyText = new Text({
      text: "Velg heldig tall",
      style: { fontFamily: "Arial", fontSize: 18, fill: 0xffe83d, align: "center" },
    });
    luckyText.anchor.set(0.5);
    luckyBtn.addChild(luckyText);
    luckyBtn.x = screenWidth / 2;
    luckyBtn.y = screenHeight / 2 + 80;
    luckyBtn.eventMode = "static";
    luckyBtn.cursor = "pointer";
    luckyBtn.on("pointerdown", () => this.luckyPicker.show());
    this.addChild(luckyBtn);

    // Buy popup (centered)
    this.buyPopup = new BuyPopup(320, 220);
    this.buyPopup.x = (screenWidth - 320) / 2;
    this.buyPopup.y = screenHeight / 2 + 120;
    this.buyPopup.setOnBuy((count) => this.onBuy?.(count));
    this.addChild(this.buyPopup);

    // Lucky number picker (modal overlay)
    this.luckyPicker = new LuckyNumberPicker(screenWidth, screenHeight);
    this.luckyPicker.setOnSelect((n) => this.onLuckyNumber?.(n));
    this.addChild(this.luckyPicker);

    // 2026-05-02 (Tobias UX, PDF 17 wireframe side 4): "Velg brett"-knapp som
    // åpner Choose Tickets-side.
    const chooseBtn = new Container();
    const chooseBg = new Graphics();
    chooseBg.roundRect(0, 0, 220, 50, 8).fill({ color: 0x1976d2 });
    chooseBtn.addChild(chooseBg);
    const chooseLabel = new Text({
      text: "Velg brett",
      style: {
        fontFamily: "Arial",
        fontSize: 18,
        fontWeight: "700",
        fill: 0xffffff,
        align: "center",
      },
    });
    chooseLabel.anchor.set(0.5);
    chooseLabel.x = 110;
    chooseLabel.y = 25;
    chooseBtn.addChild(chooseLabel);
    chooseBtn.x = (screenWidth - 220) / 2;
    chooseBtn.y = screenHeight / 2 + 160;
    chooseBtn.eventMode = "static";
    chooseBtn.cursor = "pointer";
    chooseBtn.on("pointerdown", () => this.onChooseTickets?.());
    this.addChild(chooseBtn);
  }

  setOnBuy(callback: (count: number) => void): void {
    this.onBuy = callback;
  }

  setOnLuckyNumber(callback: (number: number) => void): void {
    this.onLuckyNumber = callback;
  }

  setOnChooseTickets(callback: () => void): void {
    this.onChooseTickets = callback;
  }

  update(state: GameState): void {
    this.infoBar.update(state.playerCount, state.drawCount, state.totalDrawCapacity, state.prizePool);

    if (state.gameStatus === "RUNNING") {
      this.statusText.text = "Spill pågår — kjøp billetter til neste runde";
      this.countdown.stop();
    } else if (state.millisUntilNextStart !== null && state.millisUntilNextStart > 0) {
      this.statusText.text = "Neste spill starter snart!";
      this.countdown.startCountdown(state.millisUntilNextStart);
    } else {
      this.statusText.text = "Kjøp billetter for å delta";
    }
  }

  showBuyPopup(ticketPrice: number, maxTickets = 30): void {
    this.buyPopup.show(ticketPrice, maxTickets);
  }

  hideBuyPopup(): void {
    this.buyPopup.hide();
  }
}
