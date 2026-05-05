/**
 * @deprecated for Spill 2 (rocket) per PR #923 + #926.
 * BEHOLDES kun for Game5Controller (SpinnGo, post-pilot scope).
 * Slett i Bølge D når Game5 enten flyttes til games/game5/-mappe
 * eller fjernes fra registry.
 *
 * Se docs/architecture/CLEANUP_AUDIT_2026-05-05.md §3 (Kategori B)
 * og §6 (Kategori E.1) for full kontekst.
 */

import { Container, Graphics, Text } from "pixi.js";
import gsap from "gsap";

/**
 * Between-rounds ticket purchase popup.
 * Player adjusts ticket count and clicks buy → triggers bet:arm.
 *
 * 2026-05-04 (Tobias-direktiv): popup støtter to faser, speilet av Spill 1:
 *   - **LOBBY/WAITING/ENDED**: kjøp gjelder for kommende runde — tittel
 *     "Neste spill".
 *   - **RUNNING (mid-round)**: aktiv runde pågår; kjøp armer for **neste**
 *     runde (forhåndskjøp). Tittel "Forhåndskjøp – neste runde" gjør det
 *     eksplisitt for spilleren at de IKKE kan delta i den pågående
 *     trekningen.
 *
 * Caller (PlayScreen / LobbyScreen) sender `forNextRound`-flagget basert
 * på `state.gameStatus`. Flagget endrer KUN tittelen — hele kjøpsflyten
 * (BuyPopup → setOnBuy → bet:arm) er uendret. Backend håndterer fortsatt
 * forhåndskjøpet identisk; pre-round-armed-state carry-overes til neste
 * runde av PerpetualRoundService (PR #894).
 */
export class BuyPopup extends Container {
  private bg: Graphics;
  private titleText: Text;
  private countText: Text;
  private priceText: Text;
  private ticketCount = 1;
  private ticketPrice = 0;
  private maxTickets = 30;
  private onBuy: ((count: number) => void) | null = null;

  constructor(width = 320, height = 220) {
    super();

    // Background
    this.bg = new Graphics();
    this.bg.roundRect(0, 0, width, height, 12);
    this.bg.fill(0x2e0000); // Dark maroon
    this.bg.stroke({ color: 0x790001, width: 2 });
    this.addChild(this.bg);

    // Title — settes til "Neste spill" eller "Forhåndskjøp – neste runde"
    // i `show()` basert på fase-flagget.
    this.titleText = new Text({
      text: "Neste spill",
      style: { fontFamily: "Arial, Helvetica, sans-serif", fontSize: 22, fontWeight: "bold", fill: 0xffe83d },
    });
    this.titleText.x = width / 2;
    this.titleText.y = 20;
    this.titleText.anchor.set(0.5, 0);
    this.addChild(this.titleText);

    // Minus button
    const minusBtn = this.createButton("-", 40, 40, 0x790001);
    minusBtn.x = 40;
    minusBtn.y = 75;
    minusBtn.on("pointerdown", () => this.adjustCount(-1));
    this.addChild(minusBtn);

    // Count display
    this.countText = new Text({
      text: "1",
      style: { fontFamily: "Arial", fontSize: 36, fontWeight: "bold", fill: 0xffffff, align: "center" },
    });
    this.countText.anchor.set(0.5);
    this.countText.x = width / 2;
    this.countText.y = 95;
    this.addChild(this.countText);

    // Plus button
    const plusBtn = this.createButton("+", 40, 40, 0x790001);
    plusBtn.x = width - 80;
    plusBtn.y = 75;
    plusBtn.on("pointerdown", () => this.adjustCount(1));
    this.addChild(plusBtn);

    // Price
    this.priceText = new Text({
      text: "",
      style: { fontFamily: "Arial", fontSize: 16, fill: 0xcccccc, align: "center" },
    });
    this.priceText.anchor.set(0.5, 0);
    this.priceText.x = width / 2;
    this.priceText.y = 125;
    this.addChild(this.priceText);

    // Buy button
    const buyBtn = this.createButton("Kjøp", 200, 44, 0xa00020);
    buyBtn.x = (width - 200) / 2;
    buyBtn.y = 160;
    buyBtn.on("pointerdown", () => {
      if (this.onBuy) this.onBuy(this.ticketCount);
    });
    this.addChild(buyBtn);

    this.visible = false;
  }

  /**
   * Vis popup-en med pris-info.
   *
   * @param ticketPrice — pris per brett (kr) for total-beregning.
   * @param maxTickets — kapsel for +/- knapper. Default 30 (server-cap).
   * @param forNextRound — true når aktiv runde pågår og kjøp armer for
   *   NESTE runde. Endrer tittelen til "Forhåndskjøp – neste runde" så
   *   spilleren forstår at de IKKE kan delta i den pågående trekningen.
   *   Default false (LOBBY/WAITING — "Neste spill").
   */
  show(ticketPrice: number, maxTickets = 30, forNextRound = false): void {
    this.ticketPrice = ticketPrice;
    this.maxTickets = maxTickets;
    this.ticketCount = 1;
    this.titleText.text = forNextRound
      ? "Forhåndskjøp – neste runde"
      : "Neste spill";
    this.updateDisplay();
    this.visible = true;
    this.alpha = 0;
    gsap.to(this, { alpha: 1, duration: 0.2 });
  }

  hide(): void {
    gsap.to(this, { alpha: 0, duration: 0.15, onComplete: () => { this.visible = false; } });
  }

  setOnBuy(callback: (count: number) => void): void {
    this.onBuy = callback;
  }

  private adjustCount(delta: number): void {
    this.ticketCount = Math.max(1, Math.min(this.maxTickets, this.ticketCount + delta));
    this.updateDisplay();
  }

  private updateDisplay(): void {
    this.countText.text = String(this.ticketCount);
    const total = this.ticketCount * this.ticketPrice;
    this.priceText.text = `${this.ticketCount} × ${this.ticketPrice} kr = ${total} kr`;
  }

  private createButton(text: string, w: number, h: number, color: number): Container {
    const btn = new Container();
    const bg = new Graphics();
    bg.roundRect(0, 0, w, h, 8);
    bg.fill(color);
    btn.addChild(bg);
    const label = new Text({
      text,
      style: { fontFamily: "Arial", fontSize: 18, fontWeight: "bold", fill: 0xffffff, align: "center" },
    });
    label.anchor.set(0.5);
    label.x = w / 2;
    label.y = h / 2;
    btn.addChild(label);
    btn.eventMode = "static";
    btn.cursor = "pointer";
    return btn;
  }
}
