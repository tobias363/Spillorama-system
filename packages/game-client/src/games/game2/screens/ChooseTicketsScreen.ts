/**
 * 2026-05-02 (Tobias UX, PDF 17 wireframe side 5): Choose Tickets-side
 * for Spill 2.
 *
 * Layout (per wireframe):
 *  ┌─ ← Back ─────────────────────────────────────────────────┐
 *  │  [t1] [t2] [t3] [t4] [t5] [t6] [t7] [t8]                │
 *  │  [t9] [t10][t11][t12][t13][t14][t15][t16]               │
 *  │  [t17][t18][t19][t20][t21][t22][t23][t24]               │
 *  │  [t25][t26][t27][t28][t29][t30][t31][t32]               │
 *  │                                                          │
 *  │  ⓞ Pick      Cards    Amount   Points        [ Buy ]   │
 *  │     22        7        140      0                       │
 *  └──────────────────────────────────────────────────────────┘
 *
 * Hver brett-rute viser de 9 tallene (3×3 grid). Klikk-toggle for å velge
 * (blå border). Allerede-kjøpte brett er greyed-out + "Kjøpt"-overlay
 * og kan ikke velges igjen.
 *
 * Pick Any Number = Lucky Number (1-21). Brukes ved spill-start til å
 * automatisk markere første ball med matchende tall.
 *
 * Buy → POST /api/agent/game2/choose-tickets/:roomCode/buy → backend
 * markerer indekser som purchased + lagrer Lucky Number. Etter kjøp
 * naviger tilbake til Lobby.
 */

import { Container, Graphics, Text, TextStyle } from "pixi.js";
import type { Ticket } from "@spillorama/shared-types/game";
import type { Game2ChooseTicketsSnapshot } from "../../../net/SpilloramaApi.js";
import { SpilloramaApi } from "../../../net/SpilloramaApi.js";

const POOL_SIZE = 32;
const TICKET_COLS = 8;
const TICKET_ROWS = 4;

const TICKET_WIDTH = 95;
const TICKET_HEIGHT = 70;
const TICKET_GAP = 8;

const COLOR_BG = 0xffffff;
const COLOR_BORDER = 0xb0b0b0;
const COLOR_BORDER_SELECTED = 0x1976d2;
const COLOR_BG_PURCHASED = 0xeeeeee;
const COLOR_PURCHASED_LABEL = 0x999999;
const COLOR_TEXT = 0x222222;
const COLOR_BACK_BTN = 0x424242;
const COLOR_BUY_BTN = 0x2e7d32;
const COLOR_BUY_BTN_DISABLED = 0xb0b0b0;

const CELL_STYLE = new TextStyle({
  fontFamily: "Arial, sans-serif",
  fontSize: 12,
  fontWeight: "600",
  fill: COLOR_TEXT,
});

const PURCHASED_LABEL_STYLE = new TextStyle({
  fontFamily: "Arial, sans-serif",
  fontSize: 10,
  fontWeight: "700",
  fill: COLOR_PURCHASED_LABEL,
});

const TOTAL_LABEL_STYLE = new TextStyle({
  fontFamily: "Arial, sans-serif",
  fontSize: 12,
  fill: 0x666666,
});

const TOTAL_VALUE_STYLE = new TextStyle({
  fontFamily: "Arial, sans-serif",
  fontSize: 18,
  fontWeight: "700",
  fill: 0x222222,
});

const BTN_LABEL_STYLE = new TextStyle({
  fontFamily: "Arial, sans-serif",
  fontSize: 14,
  fontWeight: "700",
  fill: 0xffffff,
});

interface TicketSlotVisual {
  container: Container;
  bg: Graphics;
  cellTexts: Text[];
  purchasedLabel: Text;
}

export interface ChooseTicketsScreenDeps {
  api: SpilloramaApi;
  roomCode: string;
  ticketPriceKr: number;
  /** Kalles når Buy lykkes (player navigerer tilbake til Lobby). */
  onBuyComplete: () => void;
  /** Kalles når Back-pil trykkes. */
  onBack: () => void;
}

export class ChooseTicketsScreen extends Container {
  private deps: ChooseTicketsScreenDeps;
  private slots: TicketSlotVisual[] = [];
  private selectedIndices: Set<number> = new Set();
  private purchasedIndices: Set<number> = new Set();
  private pickAnyNumber: number | null = null;
  private cardsCountText!: Text;
  private amountText!: Text;
  private pickAnyText!: Text;
  private buyBtnBg!: Graphics;
  private buyBtnLabel!: Text;
  private busy = false;

  constructor(screenWidth: number, screenHeight: number, deps: ChooseTicketsScreenDeps) {
    super();
    this.deps = deps;
    this.buildLayout(screenWidth, screenHeight);
    void this.refresh();
  }

  private buildLayout(screenWidth: number, _screenHeight: number): void {
    // Back-knapp øverst venstre
    const backBtn = this.buildBackButton();
    backBtn.x = 20;
    backBtn.y = 16;
    this.addChild(backBtn);

    // Tittel
    const title = new Text({
      text: "Velg dine brett",
      style: new TextStyle({
        fontFamily: "Arial, sans-serif",
        fontSize: 18,
        fontWeight: "700",
        fill: 0x222222,
      }),
    });
    title.x = 70;
    title.y = 18;
    this.addChild(title);

    // Brett-grid (4×8 = 32)
    const gridStartX = (screenWidth - (TICKET_COLS * (TICKET_WIDTH + TICKET_GAP) - TICKET_GAP)) / 2;
    const gridStartY = 56;
    for (let i = 0; i < POOL_SIZE; i++) {
      const col = i % TICKET_COLS;
      const row = Math.floor(i / TICKET_COLS);
      const slot = this.buildTicketSlot(i);
      slot.container.x = gridStartX + col * (TICKET_WIDTH + TICKET_GAP);
      slot.container.y = gridStartY + row * (TICKET_HEIGHT + TICKET_GAP);
      this.addChild(slot.container);
      this.slots.push(slot);
    }

    // Bunn-rad: Pick Any Number sirkel + totals + Buy
    const bottomY = gridStartY + TICKET_ROWS * (TICKET_HEIGHT + TICKET_GAP) + 16;

    // Pick Any Number sirkel (klikk → enkel prompt for nå)
    const pickCircle = new Container();
    const pickBg = new Graphics();
    pickBg.circle(30, 30, 28).fill({ color: 0xffffff }).stroke({ color: 0x1976d2, width: 2 });
    pickCircle.addChild(pickBg);
    const pickLabel = new Text({
      text: "Pick\nNumber",
      style: new TextStyle({
        fontFamily: "Arial, sans-serif",
        fontSize: 10,
        fill: 0x666666,
        align: "center",
      }),
    });
    pickLabel.anchor.set(0.5, 0.5);
    pickLabel.x = 30;
    pickLabel.y = -8;
    pickCircle.addChild(pickLabel);
    this.pickAnyText = new Text({
      text: "—",
      style: new TextStyle({
        fontFamily: "Arial, sans-serif",
        fontSize: 18,
        fontWeight: "700",
        fill: 0x222222,
      }),
    });
    this.pickAnyText.anchor.set(0.5, 0.5);
    this.pickAnyText.x = 30;
    this.pickAnyText.y = 36;
    pickCircle.addChild(this.pickAnyText);
    pickCircle.eventMode = "static";
    pickCircle.cursor = "pointer";
    pickCircle.on("pointerdown", () => this.promptPickAnyNumber());
    pickCircle.x = gridStartX;
    pickCircle.y = bottomY;
    this.addChild(pickCircle);

    // Cards / Amount totals
    const totalsX = gridStartX + 100;
    const cardsLabel = new Text({ text: "Brett", style: TOTAL_LABEL_STYLE });
    cardsLabel.x = totalsX;
    cardsLabel.y = bottomY;
    this.addChild(cardsLabel);
    this.cardsCountText = new Text({ text: "0", style: TOTAL_VALUE_STYLE });
    this.cardsCountText.x = totalsX;
    this.cardsCountText.y = bottomY + 18;
    this.addChild(this.cardsCountText);

    const amountLabel = new Text({ text: "Beløp", style: TOTAL_LABEL_STYLE });
    amountLabel.x = totalsX + 90;
    amountLabel.y = bottomY;
    this.addChild(amountLabel);
    this.amountText = new Text({ text: "0 kr", style: TOTAL_VALUE_STYLE });
    this.amountText.x = totalsX + 90;
    this.amountText.y = bottomY + 18;
    this.addChild(this.amountText);

    // Buy-knapp høyre
    const buyBtn = new Container();
    this.buyBtnBg = new Graphics();
    this.buyBtnBg.roundRect(0, 0, 130, 50, 8).fill({ color: COLOR_BUY_BTN_DISABLED });
    buyBtn.addChild(this.buyBtnBg);
    this.buyBtnLabel = new Text({ text: "Kjøp", style: BTN_LABEL_STYLE });
    this.buyBtnLabel.anchor.set(0.5, 0.5);
    this.buyBtnLabel.x = 65;
    this.buyBtnLabel.y = 25;
    buyBtn.addChild(this.buyBtnLabel);
    buyBtn.eventMode = "static";
    buyBtn.cursor = "pointer";
    buyBtn.on("pointerdown", () => void this.onBuyClick());
    buyBtn.x = gridStartX + (TICKET_COLS * (TICKET_WIDTH + TICKET_GAP) - TICKET_GAP) - 130;
    buyBtn.y = bottomY;
    this.addChild(buyBtn);
  }

  private buildBackButton(): Container {
    const btn = new Container();
    const bg = new Graphics();
    bg.roundRect(0, 0, 40, 32, 6).fill({ color: COLOR_BACK_BTN });
    btn.addChild(bg);
    const arrow = new Text({
      text: "←",
      style: new TextStyle({ fontSize: 18, fontWeight: "700", fill: 0xffffff }),
    });
    arrow.anchor.set(0.5);
    arrow.x = 20;
    arrow.y = 16;
    btn.addChild(arrow);
    btn.eventMode = "static";
    btn.cursor = "pointer";
    btn.on("pointerdown", () => this.deps.onBack());
    return btn;
  }

  private buildTicketSlot(index: number): TicketSlotVisual {
    const container = new Container();
    const bg = new Graphics();
    container.addChild(bg);

    // 3×3 cells (placeholder — fylles ved refresh)
    const cellTexts: Text[] = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const cell = new Text({ text: "", style: CELL_STYLE });
        cell.anchor.set(0.5, 0.5);
        cell.x = 12 + c * 26;
        cell.y = 14 + r * 18;
        container.addChild(cell);
        cellTexts.push(cell);
      }
    }

    const purchasedLabel = new Text({
      text: "KJØPT",
      style: PURCHASED_LABEL_STYLE,
    });
    purchasedLabel.anchor.set(0.5, 0.5);
    purchasedLabel.x = TICKET_WIDTH / 2;
    purchasedLabel.y = TICKET_HEIGHT - 10;
    purchasedLabel.visible = false;
    container.addChild(purchasedLabel);

    container.eventMode = "static";
    container.cursor = "pointer";
    container.on("pointerdown", () => this.toggleSelect(index));

    return { container, bg, cellTexts, purchasedLabel };
  }

  private async refresh(): Promise<void> {
    try {
      const result = await this.deps.api.getGame2ChooseTickets(this.deps.roomCode);
      if (!result.ok) {
        console.error("[ChooseTickets] fetch failed:", result.error);
        return;
      }
      this.applySnapshot(result.data);
    } catch (err) {
      console.error("[ChooseTickets] fetch error:", err);
    }
  }

  private applySnapshot(snapshot: Game2ChooseTicketsSnapshot): void {
    this.purchasedIndices = new Set(snapshot.purchasedIndices);
    this.pickAnyNumber = snapshot.pickAnyNumber;
    this.pickAnyText.text = this.pickAnyNumber != null ? String(this.pickAnyNumber) : "—";

    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i]!;
      const ticket = snapshot.tickets[i];
      if (ticket) this.renderTicket(slot, ticket);
    }
    this.renderSelectionState();
  }

  private renderTicket(slot: TicketSlotVisual, ticket: Ticket): void {
    let cellIdx = 0;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const value = ticket.grid?.[r]?.[c] ?? 0;
        slot.cellTexts[cellIdx]!.text = value > 0 ? String(value) : "";
        cellIdx++;
      }
    }
  }

  private toggleSelect(index: number): void {
    if (this.purchasedIndices.has(index)) return;
    if (this.selectedIndices.has(index)) {
      this.selectedIndices.delete(index);
    } else {
      // 30-brett-max — speiler bet:arm-grensen.
      if (this.selectedIndices.size >= 30) {
        console.warn("[ChooseTickets] max 30 brett reached");
        return;
      }
      this.selectedIndices.add(index);
    }
    this.renderSelectionState();
  }

  private renderSelectionState(): void {
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i]!;
      const isPurchased = this.purchasedIndices.has(i);
      const isSelected = this.selectedIndices.has(i);
      slot.bg.clear();
      const bgColor = isPurchased ? COLOR_BG_PURCHASED : COLOR_BG;
      const borderColor = isSelected
        ? COLOR_BORDER_SELECTED
        : COLOR_BORDER;
      const borderWidth = isSelected ? 3 : 1;
      slot.bg
        .roundRect(0, 0, TICKET_WIDTH, TICKET_HEIGHT, 6)
        .fill({ color: bgColor })
        .stroke({ color: borderColor, width: borderWidth });
      slot.purchasedLabel.visible = isPurchased;
      // 2026-05-02 (Tobias UX, PDF 17 wireframe note): "Tickets bought by
      // the player will not viewed to the user until the game starts."
      // Skjul ticket-tallene på kjøpte brett — bare "KJØPT"-overlay vises.
      for (const cell of slot.cellTexts) {
        cell.visible = !isPurchased;
      }
      slot.container.alpha = isPurchased ? 0.7 : 1.0;
      slot.container.cursor = isPurchased ? "default" : "pointer";
    }

    const selectedCount = this.selectedIndices.size;
    this.cardsCountText.text = String(selectedCount);
    this.amountText.text = `${selectedCount * this.deps.ticketPriceKr} kr`;

    // Buy-knapp enabled-state
    const canBuy = selectedCount > 0 && !this.busy;
    this.buyBtnBg.clear();
    this.buyBtnBg
      .roundRect(0, 0, 130, 50, 8)
      .fill({ color: canBuy ? COLOR_BUY_BTN : COLOR_BUY_BTN_DISABLED });
    this.buyBtnLabel.text = this.busy ? "Kjøper..." : "Kjøp";
  }

  private promptPickAnyNumber(): void {
    const raw = window.prompt("Velg ditt heldige tall (1-21):", this.pickAnyNumber ? String(this.pickAnyNumber) : "");
    if (raw === null) return;
    const n = parseInt(raw.trim(), 10);
    if (!Number.isFinite(n) || n < 1 || n > 21) {
      window.alert("Tallet må være mellom 1 og 21.");
      return;
    }
    this.pickAnyNumber = n;
    this.pickAnyText.text = String(n);
  }

  private async onBuyClick(): Promise<void> {
    if (this.busy) return;
    if (this.selectedIndices.size === 0) return;
    this.busy = true;
    this.renderSelectionState();
    try {
      const indices = [...this.selectedIndices].sort((a, b) => a - b);
      const result = await this.deps.api.buyGame2ChooseTickets(
        this.deps.roomCode,
        indices,
        this.pickAnyNumber,
      );
      if (!result.ok) {
        window.alert(`Kjøp feilet: ${result.error?.message ?? "Ukjent feil"}`);
        return;
      }
      this.applySnapshot(result.data);
      this.selectedIndices.clear();
      this.deps.onBuyComplete();
    } catch (err) {
      console.error("[ChooseTickets] buy error:", err);
      window.alert("Kjøp feilet. Sjekk nettverket og prøv igjen.");
    } finally {
      this.busy = false;
      this.renderSelectionState();
    }
  }
}
