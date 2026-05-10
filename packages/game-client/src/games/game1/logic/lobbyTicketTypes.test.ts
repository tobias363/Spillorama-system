/**
 * Tester for `buildBuyPopupTicketConfigFromLobby` (Spillerklient-rebuild
 * Fase 2, BIN/SPILL1, 2026-05-10). "Stor"-varianter lagt til 2026-05-11
 * (Tobias-direktiv).
 *
 * Sikrer at:
 *   1) Standard Bingo (3 farger) gir 6 rader (small+large per farge) med
 *      multipliers [1,3, 2,6, 3,9] og ticketCount [1,3, 1,3, 1,3]
 *   2) Trafikklys (1 farge flat 15 kr) gir 2 rader: small 1× + large 3×
 *   3) Tom `ticketColors` → null (caller faller tilbake)
 *   4) Manglende pris-entry → den fargen ekskluderes (begge varianter)
 *   5) `name`-feltet matcher backend-canonical fra
 *      `spill1VariantMapper.COLOR_SLUG_TO_NAME` ("Small White" /
 *      "Large White" osv.) — kritisk for `bet:arm`-resolution via
 *      `expandSelectionsToTicketColors`
 *   6) `type`-feltet er "small" for small-bonger og "large" for large-
 *      bonger (matcher `ticketTypeFromSlug` — server faller tilbake til
 *      type-match hvis name-match feiler)
 *   7) Rekkefølgen er `[small_c1, large_c1, small_c2, large_c2, ...]` slik
 *      at 2-column-grid-en i BuyPopup plasserer small+large av samme
 *      farge på SAMME RAD
 */

import { describe, it, expect } from "vitest";
import { buildBuyPopupTicketConfigFromLobby } from "./lobbyTicketTypes.js";
import type { Spill1LobbyNextGame } from "@spillorama/shared-types/api";

function makeNextGame(
  overrides: Partial<Spill1LobbyNextGame> = {},
): Spill1LobbyNextGame {
  return {
    itemId: "item-1",
    position: 1,
    catalogSlug: "bingo",
    catalogDisplayName: "Bingo",
    status: "purchase_open",
    scheduledGameId: null,
    scheduledStartTime: null,
    scheduledEndTime: null,
    actualStartTime: null,
    ticketColors: ["hvit", "gul", "lilla"],
    ticketPricesCents: { hvit: 500, gul: 1000, lilla: 1500 },
    prizeMultiplierMode: "auto",
    bonusGameSlug: null,
    ...overrides,
  };
}

describe("buildBuyPopupTicketConfigFromLobby", () => {
  it("Standard Bingo (3 farger): entryFee=5 og 6 rader (small+large per farge)", () => {
    const result = buildBuyPopupTicketConfigFromLobby(makeNextGame());
    expect(result).not.toBeNull();
    expect(result!.entryFee).toBe(5);
    expect(result!.ticketTypes).toHaveLength(6);
    // Backend-canonical names ("Small White" / "Large White" osv.) — matcher
    // `spill1VariantMapper.COLOR_SLUG_TO_NAME` så `bet:arm`-resolution
    // virker via `expandSelectionsToTicketColors`.
    // Rekkefølge: per farge → [small, large] (small+large side-ved-side i
    // 2-column-grid).
    expect(result!.ticketTypes[0]).toEqual({
      name: "Small White",
      type: "small",
      priceMultiplier: 1,
      ticketCount: 1,
    });
    expect(result!.ticketTypes[1]).toEqual({
      name: "Large White",
      type: "large",
      priceMultiplier: 3,
      ticketCount: 3,
    });
    expect(result!.ticketTypes[2]).toEqual({
      name: "Small Yellow",
      type: "small",
      priceMultiplier: 2,
      ticketCount: 1,
    });
    expect(result!.ticketTypes[3]).toEqual({
      name: "Large Yellow",
      type: "large",
      priceMultiplier: 6,
      ticketCount: 3,
    });
    expect(result!.ticketTypes[4]).toEqual({
      name: "Small Purple",
      type: "small",
      priceMultiplier: 3,
      ticketCount: 1,
    });
    expect(result!.ticketTypes[5]).toEqual({
      name: "Large Purple",
      type: "large",
      priceMultiplier: 9,
      ticketCount: 3,
    });
  });

  it("Trafikklys (1 farge flat 15 kr): entryFee=15 og 2 rader (small + stor lilla)", () => {
    const result = buildBuyPopupTicketConfigFromLobby(
      makeNextGame({
        catalogSlug: "trafikklys",
        catalogDisplayName: "Trafikklys",
        ticketColors: ["lilla"],
        ticketPricesCents: { lilla: 1500 },
        prizeMultiplierMode: "explicit_per_color",
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.entryFee).toBe(15);
    expect(result!.ticketTypes).toHaveLength(2);
    expect(result!.ticketTypes[0]).toEqual({
      name: "Small Purple",
      type: "small",
      priceMultiplier: 1,
      ticketCount: 1,
    });
    expect(result!.ticketTypes[1]).toEqual({
      name: "Large Purple",
      type: "large",
      priceMultiplier: 3,
      ticketCount: 3,
    });
  });

  it("Bare hvit (1 farge 5 kr): entryFee=5 og 2 rader (small + stor hvit)", () => {
    const result = buildBuyPopupTicketConfigFromLobby(
      makeNextGame({
        ticketColors: ["hvit"],
        ticketPricesCents: { hvit: 500 },
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.entryFee).toBe(5);
    expect(result!.ticketTypes).toHaveLength(2);
    expect(result!.ticketTypes[0].name).toBe("Small White");
    expect(result!.ticketTypes[0].priceMultiplier).toBe(1);
    expect(result!.ticketTypes[0].ticketCount).toBe(1);
    expect(result!.ticketTypes[1].name).toBe("Large White");
    expect(result!.ticketTypes[1].priceMultiplier).toBe(3);
    expect(result!.ticketTypes[1].ticketCount).toBe(3);
  });

  it("returnerer null når nextGame er null", () => {
    expect(buildBuyPopupTicketConfigFromLobby(null)).toBeNull();
  });

  it("returnerer null når nextGame er undefined", () => {
    expect(buildBuyPopupTicketConfigFromLobby(undefined)).toBeNull();
  });

  it("returnerer null når ticketColors er tom array", () => {
    const result = buildBuyPopupTicketConfigFromLobby(
      makeNextGame({
        ticketColors: [],
        ticketPricesCents: {},
      }),
    );
    expect(result).toBeNull();
  });

  it("returnerer null når alle priser er 0 eller mangler", () => {
    const result = buildBuyPopupTicketConfigFromLobby(
      makeNextGame({
        ticketColors: ["hvit", "gul"],
        ticketPricesCents: { hvit: 0 } as never, // type-bypass for negative-test
      }),
    );
    expect(result).toBeNull();
  });

  it("ekskluderer farge uten matching pris-entry (begge varianter)", () => {
    // `gul` har ikke pris — small Yellow + Large Yellow skal droppes
    const result = buildBuyPopupTicketConfigFromLobby(
      makeNextGame({
        ticketColors: ["hvit", "gul", "lilla"],
        ticketPricesCents: { hvit: 500, lilla: 1500 } as never,
      }),
    );
    expect(result).not.toBeNull();
    // 2 gyldige farger × 2 varianter = 4 rader
    expect(result!.ticketTypes).toHaveLength(4);
    expect(result!.ticketTypes.map((t) => t.name)).toEqual([
      "Small White",
      "Large White",
      "Small Purple",
      "Large Purple",
    ]);
    // priceMultiplier for Large Purple = 1500/500 × 3 = 9
    expect(result!.ticketTypes[3].priceMultiplier).toBe(9);
  });

  it("ekskluderer farge med pris=0 eller pris=null (begge varianter)", () => {
    const result = buildBuyPopupTicketConfigFromLobby(
      makeNextGame({
        ticketColors: ["hvit", "gul", "lilla"],
        ticketPricesCents: { hvit: 500, gul: 0, lilla: 1500 } as never,
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.ticketTypes).toHaveLength(4);
    expect(result!.ticketTypes.map((t) => t.name)).toEqual([
      "Small White",
      "Large White",
      "Small Purple",
      "Large Purple",
    ]);
  });

  it("backend-canonical names matcher COLOR_SLUG_TO_NAME-tabellen (small+large)", () => {
    // Verdier her MÅ matche `apps/backend/src/game/spill1VariantMapper.ts`
    // sin `COLOR_SLUG_TO_NAME`-tabell. Hvis backend en dag endrer disse,
    // må klient-helperen oppdateres samtidig — ellers feiler `bet:arm`-
    // resolution stille i `expandSelectionsToTicketColors`.
    const result = buildBuyPopupTicketConfigFromLobby(makeNextGame());
    expect(result).not.toBeNull();
    expect(result!.ticketTypes.map((t) => t.name)).toEqual([
      "Small White",
      "Large White",
      "Small Yellow",
      "Large Yellow",
      "Small Purple",
      "Large Purple",
    ]);
  });

  it("type-feltet er 'small' for small-bonger og 'large' for large-bonger", () => {
    // `spill1VariantMapper.ticketTypeFromSlug` setter `type: "small"` for
    // ALLE small-farger og `type: "large"` for ALLE large-farger.
    // `expandSelectionsToTicketColors` faller tilbake på `type`-match hvis
    // `name`-match feiler.
    const result = buildBuyPopupTicketConfigFromLobby(makeNextGame());
    expect(result).not.toBeNull();
    for (let i = 0; i < result!.ticketTypes.length; i++) {
      const expected = i % 2 === 0 ? "small" : "large";
      expect(result!.ticketTypes[i].type).toBe(expected);
    }
  });

  it("Stor-bong har alltid ticketCount=3 og priceMultiplier=3×small (Tobias 2026-05-11)", () => {
    const result = buildBuyPopupTicketConfigFromLobby(makeNextGame());
    expect(result).not.toBeNull();
    // ticketTypes[0]=Small White (1×, 1 brett), [1]=Large White (3×, 3 brett)
    // ticketTypes[2]=Small Yellow (2×, 1 brett), [3]=Large Yellow (6×, 3 brett)
    // ticketTypes[4]=Small Purple (3×, 1 brett), [5]=Large Purple (9×, 3 brett)
    for (let i = 0; i < result!.ticketTypes.length; i += 2) {
      const small = result!.ticketTypes[i];
      const large = result!.ticketTypes[i + 1];
      expect(small.ticketCount).toBe(1);
      expect(large.ticketCount).toBe(3);
      expect(large.priceMultiplier).toBe(small.priceMultiplier * 3);
    }
  });

  it("ikke-standard prising — beregner riktig multiplier (small+large)", () => {
    // Ikke-standard scenario hvor backend en dag setter priser utenfor
    // 5/10/15-mønsteret. Vi sjekker at matematikken er presis for både
    // small og large-varianter.
    const result = buildBuyPopupTicketConfigFromLobby(
      makeNextGame({
        ticketColors: ["hvit", "gul"],
        ticketPricesCents: { hvit: 250, gul: 1000 }, // 2.5 kr og 10 kr
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.entryFee).toBe(2.5);
    expect(result!.ticketTypes[0].priceMultiplier).toBe(1); // Small White: 250/250
    expect(result!.ticketTypes[1].priceMultiplier).toBe(3); // Large White: 250/250 × 3
    expect(result!.ticketTypes[2].priceMultiplier).toBe(4); // Small Yellow: 1000/250
    expect(result!.ticketTypes[3].priceMultiplier).toBe(12); // Large Yellow: 1000/250 × 3
  });

  it("rekkefølge i `ticketColors` bevares i output, små+stor parvis", () => {
    const result = buildBuyPopupTicketConfigFromLobby(
      makeNextGame({
        ticketColors: ["lilla", "hvit", "gul"],
        ticketPricesCents: { lilla: 1500, hvit: 500, gul: 1000 },
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.ticketTypes.map((t) => t.name)).toEqual([
      "Small Purple",
      "Large Purple",
      "Small White",
      "Large White",
      "Small Yellow",
      "Large Yellow",
    ]);
  });
});
