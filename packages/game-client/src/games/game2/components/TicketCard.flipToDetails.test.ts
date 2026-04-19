/**
 * TicketCard.flipToDetails tests — G15 (BIN-431) 5-row detail layout.
 *
 * Unity parity: BingoTicket.cs:374-399 (SetData) renders on tap/flip:
 *   - txtTicketNumber → `Bong #{ticketNumber}`
 *   - txtHallName
 *   - txtSupplierName
 *   - txtTicketPrice
 * Plus a web-only boughtAt timestamp (HH:mm) on the 5th row.
 *
 * Coverage:
 *   1. When ticket carries all optional fields, each row renders verbatim.
 *   2. When ticket is missing fields, rows fall back to placeholders (empty
 *      string for hall/supplier/boughtAt; index-based number).
 *   3. Row texts are updated on re-flip (tickets can change between rounds).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Text } from "pixi.js";
import { TicketCard } from "./TicketCard.js";
import type { Ticket } from "@spillorama/shared-types/game";

function getDetailTexts(card: TicketCard): string[] {
  // detailsOverlay is private; probe via the rendered container children.
  const overlayField = (card as unknown as { detailsOverlay: { children: unknown[] } | null })
    .detailsOverlay;
  if (!overlayField) return [];
  const out: string[] = [];
  for (const c of overlayField.children) {
    if (c instanceof Text) out.push(c.text);
  }
  return out;
}

function gridTicket(): Ticket {
  // 5x5 grid with free center — matches generateBingo75Ticket output shape.
  return {
    grid: [
      [1, 16, 31, 46, 61],
      [2, 17, 32, 47, 62],
      [3, 18, 0, 48, 63],
      [4, 19, 33, 49, 64],
      [5, 20, 34, 50, 65],
    ],
  };
}

describe("TicketCard.flipToDetails — G15 5-row layout", () => {
  let card: TicketCard;

  beforeEach(() => {
    card = new TicketCard(2, { gridSize: "5x5", cellSize: 36 });
  });

  afterEach(() => {
    card.destroy({ children: true });
  });

  it("renders Bong #, hall, supplier, price, and boughtAt from ticket fields", () => {
    const ticket: Ticket = {
      ...gridTicket(),
      ticketNumber: "123",
      hallName: "Oslo Sentrum",
      supplierName: "Spillorama",
      price: 30,
      // 2026-04-18T14:32:00Z — local time rendering depends on TZ, so we only
      // check for the HH:mm shape of the last row.
      boughtAt: new Date("2026-04-18T14:32:00Z").toISOString(),
    };
    card.loadTicket(ticket);
    card.flipToDetails();

    const rows = getDetailTexts(card);
    expect(rows.length).toBe(5);
    expect(rows[0]).toBe("Bong #123");
    expect(rows[1]).toBe("Oslo Sentrum");
    expect(rows[2]).toBe("Spillorama");
    expect(rows[3]).toBe("30 kr");
    // Row 5 is local-TZ formatted HH:mm — just assert shape.
    expect(rows[4]).toMatch(/^\d{2}:\d{2}$/);
  });

  it("falls back to placeholders when optional ticket fields are absent", () => {
    // ticketIndex=2 → number row defaults to "Bong #3" (index + 1).
    card.loadTicket(gridTicket());
    card.flipToDetails();

    const rows = getDetailTexts(card);
    expect(rows.length).toBe(5);
    expect(rows[0]).toBe("Bong #3");
    // hallName, supplierName, boughtAt all absent → empty strings.
    expect(rows[1]).toBe("");
    expect(rows[2]).toBe("");
    // price falls back to whatever priceText shows (default "20kr").
    expect(rows[3]).toMatch(/kr$/);
    expect(rows[4]).toBe("");
  });

  it("refreshes rows on a second flip when ticket data changes", () => {
    card.loadTicket({
      ...gridTicket(),
      ticketNumber: "1",
      hallName: "Hall A",
      supplierName: "Spillorama",
      price: 10,
      boughtAt: "2026-04-18T10:00:00Z",
    });
    card.flipToDetails();
    // Snap back without waiting for the 3s auto-timer.
    card.stopAllAnimations();

    // Update the underlying ticket to a fresh round's data.
    card.loadTicket({
      ...gridTicket(),
      ticketNumber: "2",
      hallName: "Hall B",
      supplierName: "Spillorama",
      price: 20,
      boughtAt: "2026-04-18T11:00:00Z",
    });
    card.flipToDetails();

    const rows = getDetailTexts(card);
    expect(rows[0]).toBe("Bong #2");
    expect(rows[1]).toBe("Hall B");
    expect(rows[3]).toBe("20 kr");
  });
});
