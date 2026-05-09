/**
 * Tester for `buildBuyPopupTicketConfigFromLobby` (Spillerklient-rebuild
 * Fase 2, BIN/SPILL1, 2026-05-10).
 *
 * Sikrer at:
 *   1) Standard Bingo (3 farger) gir 3 rader med [1×, 2×, 3×]-multipliers
 *   2) Trafikklys (1 farge flat 15 kr) gir 1 rad med 1×
 *   3) Tom `ticketColors` → null (caller faller tilbake)
 *   4) Manglende pris-entry → den fargen ekskluderes
 *   5) `name`-feltet matcher backend-canonical fra
 *      `spill1VariantMapper.COLOR_SLUG_TO_NAME` ("Small White" osv.) —
 *      kritisk for `bet:arm`-resolution via
 *      `expandSelectionsToTicketColors`
 *   6) `type`-feltet er "small" (matcher `ticketTypeFromSlug` — server
 *      faller tilbake til type-match hvis name-match feiler)
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
  it("Standard Bingo (3 farger): entryFee=5 og multipliers [1, 2, 3]", () => {
    const result = buildBuyPopupTicketConfigFromLobby(makeNextGame());
    expect(result).not.toBeNull();
    expect(result!.entryFee).toBe(5);
    expect(result!.ticketTypes).toHaveLength(3);
    // Backend-canonical names ("Small White" osv.) — matches
    // `spill1VariantMapper.COLOR_SLUG_TO_NAME` så `bet:arm`-resolution
    // virker via `expandSelectionsToTicketColors`.
    expect(result!.ticketTypes[0]).toEqual({
      name: "Small White",
      type: "small",
      priceMultiplier: 1,
      ticketCount: 1,
    });
    expect(result!.ticketTypes[1]).toEqual({
      name: "Small Yellow",
      type: "small",
      priceMultiplier: 2,
      ticketCount: 1,
    });
    expect(result!.ticketTypes[2]).toEqual({
      name: "Small Purple",
      type: "small",
      priceMultiplier: 3,
      ticketCount: 1,
    });
  });

  it("Trafikklys (1 farge flat 15 kr): entryFee=15 og 1 rad med 1×", () => {
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
    expect(result!.ticketTypes).toHaveLength(1);
    expect(result!.ticketTypes[0]).toEqual({
      name: "Small Purple",
      type: "small",
      priceMultiplier: 1,
      ticketCount: 1,
    });
  });

  it("Bare hvit (1 farge 5 kr): entryFee=5 og 1 rad med 1×", () => {
    const result = buildBuyPopupTicketConfigFromLobby(
      makeNextGame({
        ticketColors: ["hvit"],
        ticketPricesCents: { hvit: 500 },
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.entryFee).toBe(5);
    expect(result!.ticketTypes).toHaveLength(1);
    expect(result!.ticketTypes[0].name).toBe("Small White");
    expect(result!.ticketTypes[0].priceMultiplier).toBe(1);
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

  it("ekskluderer farge uten matching pris-entry", () => {
    // `gul` har ikke pris — skal droppes fra resultatet
    const result = buildBuyPopupTicketConfigFromLobby(
      makeNextGame({
        ticketColors: ["hvit", "gul", "lilla"],
        ticketPricesCents: { hvit: 500, lilla: 1500 } as never,
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.ticketTypes).toHaveLength(2);
    expect(result!.ticketTypes[0].name).toBe("Small White");
    expect(result!.ticketTypes[1].name).toBe("Small Purple");
    expect(result!.ticketTypes[1].priceMultiplier).toBe(3); // 1500/500
  });

  it("ekskluderer farge med pris=0 eller pris=null", () => {
    const result = buildBuyPopupTicketConfigFromLobby(
      makeNextGame({
        ticketColors: ["hvit", "gul", "lilla"],
        ticketPricesCents: { hvit: 500, gul: 0, lilla: 1500 } as never,
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.ticketTypes).toHaveLength(2);
    expect(result!.ticketTypes.map((t) => t.name)).toEqual([
      "Small White",
      "Small Purple",
    ]);
  });

  it("backend-canonical names matcher COLOR_SLUG_TO_NAME-tabellen", () => {
    // Verdier her MÅ matche `apps/backend/src/game/spill1VariantMapper.ts`
    // sin `COLOR_SLUG_TO_NAME`-tabell. Hvis backend en dag endrer disse,
    // må klient-helperen oppdateres samtidig — ellers feiler `bet:arm`-
    // resolution stille i `expandSelectionsToTicketColors`.
    const result = buildBuyPopupTicketConfigFromLobby(makeNextGame());
    expect(result).not.toBeNull();
    expect(result!.ticketTypes.map((t) => t.name)).toEqual([
      "Small White",
      "Small Yellow",
      "Small Purple",
    ]);
  });

  it("type-feltet er 'small' for ALLE small-bonger (matches variant-mapper)", () => {
    // `spill1VariantMapper.ticketTypeFromSlug` setter `type: "small"`
    // for ALLE small-farger. `expandSelectionsToTicketColors` faller
    // tilbake på `type`-match hvis `name`-match feiler.
    const result = buildBuyPopupTicketConfigFromLobby(makeNextGame());
    expect(result).not.toBeNull();
    for (const tt of result!.ticketTypes) {
      expect(tt.type).toBe("small");
    }
  });

  it("ikke-standard prising — beregner riktig multiplier", () => {
    // Ikke-standard scenario hvor backend en dag setter priser utenfor
    // 5/10/15-mønsteret. Vi sjekker at matematikken er presis.
    const result = buildBuyPopupTicketConfigFromLobby(
      makeNextGame({
        ticketColors: ["hvit", "gul"],
        ticketPricesCents: { hvit: 250, gul: 1000 }, // 2.5 kr og 10 kr
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.entryFee).toBe(2.5);
    expect(result!.ticketTypes[0].priceMultiplier).toBe(1); // 250/250
    expect(result!.ticketTypes[1].priceMultiplier).toBe(4); // 1000/250
  });

  it("rekkefølge i `ticketColors` bevares i output", () => {
    const result = buildBuyPopupTicketConfigFromLobby(
      makeNextGame({
        ticketColors: ["lilla", "hvit", "gul"],
        ticketPricesCents: { lilla: 1500, hvit: 500, gul: 1000 },
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.ticketTypes.map((t) => t.name)).toEqual([
      "Small Purple",
      "Small White",
      "Small Yellow",
    ]);
  });
});
