/**
 * Spillerklient-rebuild Fase 2 (BIN/SPILL1, 2026-05-10) — bongfarger fra
 * plan-runtime catalog.
 *
 * Bakgrunn (handoff `SPILLERKLIENT_REBUILD_HANDOFF_2026-05-10.md` §3 fase 2):
 *   Game1BuyPopup viste hardkodet 3-farge-tickets (eller 8-farge-tickets fra
 *   `room:update.gameVariant.ticketTypes`). Når spilleren er i lobby/pre-
 *   game-state finnes det IKKE en `room:update` ennå, så popup-en hadde
 *   ingen ticket-data og kunne kun falle tilbake på defaults.
 *
 *   Fase 2-backend eksponerer nå `Spill1LobbyNextGame.ticketColors` +
 *   `ticketPricesCents` direkte i `Spill1LobbyState` slik at klient kan
 *   rendere riktige bong-knapper FØR runden starter.
 *
 * Bevisst designvalg:
 *   - **Pure converter**: ingen DOM-touch eller side-effects. Kun ren
 *     transformasjon fra lobby-shape → BuyPopup-shape.
 *   - **Auto-multiplier-baseline**: laveste pris i `ticketPricesCents`
 *     blir `entryFee` (1×). Dyrere bonger får `priceMultiplier =
 *     priceCents / minPriceCents`. Per `SPILL_REGLER_OG_PAYOUT.md` §3
 *     er auto-multiplikator ALLEREDE anvendt i prisene serveren sender.
 *   - **Bakover-kompat**: tom array eller manglende `ticketColors` →
 *     null. Caller faller da tilbake på `state.ticketTypes` (fra
 *     `room:update.gameVariant.ticketTypes`) eller hardkodet default.
 *
 * Wire-kontrakt mot backend (KRITISK):
 *   `bet:arm`-payload sender `{type, name, qty}` per selection. Server's
 *   `expandSelectionsToTicketColors` matcher først på `name`, faller
 *   tilbake på `type`. Backend-canonical `name` kommer fra
 *   `spill1VariantMapper.ts:COLOR_SLUG_TO_NAME` ("Small White", "Small
 *   Yellow", "Small Purple"). MISMATCH = selection blir droppet stille.
 *
 *   Vi mapper Norwegian-slug ("hvit"/"gul"/"lilla") → backend-name
 *   ("Small White" osv.) i `COLOR_TO_BACKEND_NAME` under. Live game
 *   viser samme `name` allerede, så lobby-state og live-game er
 *   konsistente. Display-tekst-oversettelse til Norwegian ("Hvit"/
 *   "Gul"/"Lilla") for player-UI er en fremtidig polish — ut-av-scope
 *   for Fase 2 hvor det viktige er at bongene faktisk fungerer.
 */

import type {
  Spill1LobbyNextGame,
  Spill1LobbyTicketColor,
} from "@spillorama/shared-types/api";

/**
 * Backend-canonical `TicketTypeConfig.name` per Norwegian color-slug.
 *
 * Verdiene MÅ matche `apps/backend/src/game/spill1VariantMapper.ts`
 * `COLOR_SLUG_TO_NAME`-tabellen — det er den autoritative kilden for
 * `ticketTypes[i].name` som backend genererer i `gameVariant.ticketTypes`
 * for live game. Når spilleren klikker på en bong-knapp i BuyPopup,
 * `bet:arm`-payload sender denne `name` til server. Server's
 * `expandSelectionsToTicketColors` (variantConfig.ts) bruker
 * `ticketTypes.find(t => t.name === sel.name)` for å resolve selection,
 * så MISMATCH her = "Unknown type — skipped" (selection går tapt).
 *
 * Vi velger small-prefiks fordi Fase 2 lobby-data eksponerer kun 3
 * grunnfarger. Large-bonger eksponeres KUN via room:update.gameVariant
 * .ticketTypes etter at runden er aktiv (live-game-pathen).
 *
 * Tobias-direktiv 2026-05-09: Spesifikasjonen sier "Hvit / Gul / Lilla"
 * for spillerens UI. Backend canonical er imidlertid "Small White / Small
 * Yellow / Small Purple". Diskrepansen håndteres av en fremtidig display-
 * name-mapping i Game1BuyPopup (out-of-scope for Fase 2 — bongene fungerer
 * nå med riktig pris og bet:arm-flow). Live game viser allerede "Small
 * White" osv., så lobby-state følger samme konvensjon for konsistens.
 */
const COLOR_TO_BACKEND_NAME: Readonly<Record<Spill1LobbyTicketColor, string>> = {
  hvit: "Small White",
  gul: "Small Yellow",
  lilla: "Small Purple",
};

/**
 * `TicketTypeConfig.type` for small-bonger. Speiler
 * `spill1VariantMapper.ticketTypeFromSlug("small_*")` som returnerer
 * `type: "small"` for ALLE small-farge-slugs. Backend-side `bet:arm`-
 * resolver matcher først på `name` (presis), faller tilbake på `type`
 * (ambiguøs for multi-farge-typer). Vi bruker `name`-match som primær
 * via `COLOR_TO_BACKEND_NAME` over.
 */
const SMALL_TICKET_TYPE = "small";

/**
 * Shape som matcher `Game1BuyPopup.showWithTypes()`-arg2 og
 * `GameState.ticketTypes`. Eksportert slik at både PlayScreen og
 * Game1Controller kan bruke samme type-signatur.
 */
export interface BuyPopupTicketType {
  /** BIN-688: canonical name som blir sendt til server i `bet:arm`. */
  name: string;
  /** Backend-side type-slug ("small_yellow", "small_white", "small_purple"). */
  type: string;
  /** Multiplikator relativt til `entryFee` (laveste bong). */
  priceMultiplier: number;
  /** Antall brett ett kjøp gir (alltid 1 for fase-2-3-farge-modellen). */
  ticketCount: number;
}

export interface BuyPopupTicketConfig {
  /** Pris (kr) for billigste bong — base for `priceMultiplier`. */
  entryFee: number;
  /** Liste med ticket-rows til BuyPopup. Aldri tom hvis funksjonen returnerer ikke-null. */
  ticketTypes: BuyPopupTicketType[];
}

/**
 * Konverter `Spill1LobbyNextGame` → `Game1BuyPopup`-konsumert shape.
 *
 * Returnerer `null` hvis input mangler eller er inkonsistent (tom
 * `ticketColors`, alle priser null/0). Caller skal da falle tilbake på
 * `state.ticketTypes` (fra `room:update.gameVariant.ticketTypes`) eller
 * hardkodet default.
 *
 * Eksempler:
 *   - Standard Bingo: `["hvit","gul","lilla"]` + `{hvit:500, gul:1000,
 *     lilla:1500}` → entryFee=5, multipliers=[1,2,3]
 *   - Trafikklys: `["lilla"]` + `{lilla:1500}` → entryFee=15,
 *     multipliers=[1] (én knapp)
 *   - Bare hvit: `["hvit"]` + `{hvit:500}` → entryFee=5, multipliers=[1]
 */
export function buildBuyPopupTicketConfigFromLobby(
  nextGame: Spill1LobbyNextGame | null | undefined,
): BuyPopupTicketConfig | null {
  if (!nextGame) return null;
  const colors = nextGame.ticketColors;
  const prices = nextGame.ticketPricesCents;
  if (!Array.isArray(colors) || colors.length === 0) return null;

  // Filter til kun farger med gyldig pris i `ticketPricesCents`. Beskytter
  // mot inkonsistent seed der `ticketColors` har en farge uten matching
  // pris-entry — vi viser da heller ingen ticket-knapp enn en "0 kr"-knapp
  // som ville bryte UI-en.
  const validColors: Spill1LobbyTicketColor[] = [];
  const validPrices: number[] = [];
  for (const color of colors) {
    const priceCents = prices?.[color];
    if (typeof priceCents === "number" && Number.isFinite(priceCents) && priceCents > 0) {
      validColors.push(color);
      validPrices.push(priceCents);
    }
  }
  if (validColors.length === 0) return null;

  // Auto-multiplier baseline: laveste pris = 1×. Dette mapper standard
  // hovedspill (5/10/15 kr) til [1,2,3] og Trafikklys (15 kr flat) til
  // [1]. Hvis backend en dag eksponerer non-standard prising er
  // `priceMultiplier` fortsatt presist matematisk konsistent.
  const minPriceCents = Math.min(...validPrices);
  const entryFee = minPriceCents / 100;

  const ticketTypes: BuyPopupTicketType[] = validColors.map((color, idx) => {
    const priceCents = validPrices[idx];
    return {
      name: COLOR_TO_BACKEND_NAME[color],
      type: SMALL_TICKET_TYPE,
      priceMultiplier: priceCents / minPriceCents,
      ticketCount: 1,
    };
  });

  return { entryFee, ticketTypes };
}
