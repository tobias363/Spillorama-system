/**
 * Spillerklient-rebuild Fase 2 (BIN/SPILL1, 2026-05-10) — bongfarger fra
 * plan-runtime catalog. "Stor"-bongvarianter lagt til 2026-05-11
 * (Tobias-direktiv: 3× brett per stor bong, side-ved-side med small).
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
 * "Stor"-varianter (Tobias-direktiv 2026-05-11):
 *   For HVER `validColor` autogenererer vi to rader: én small (`ticketCount=1`,
 *   pris = priceCents) og én large (`ticketCount=3`, pris = priceCents × 3).
 *   Backend's `spill1VariantMapper.ticketTypeFromSlug("large_*")` returnerer
 *   `{type: "large", priceMultiplier: 3, ticketCount: 3}` for samme grunnfarge
 *   som vi sender ("Large White" matcher `COLOR_SLUG_TO_NAME.large_white`).
 *   Server's `expandSelectionsToTicketColors` resolverer på `name` først,
 *   så "Large White" route-er korrekt til 3-brett-varianten.
 *
 *   Output-rekkefølge er `[small_c1, large_c1, small_c2, large_c2, ...]` slik
 *   at 2-column-grid-en i `Game1BuyPopup.typesContainer` plasserer small+large
 *   av samme farge på SAMME RAD (Tobias: "ved siden av hverandre").
 *
 * Bevisst designvalg:
 *   - **Pure converter**: ingen DOM-touch eller side-effects. Kun ren
 *     transformasjon fra lobby-shape → BuyPopup-shape.
 *   - **Auto-multiplier-baseline**: laveste pris i `ticketPricesCents`
 *     blir `entryFee` (1×). Dyrere bonger får `priceMultiplier =
 *     priceCents / minPriceCents`. Per `SPILL_REGLER_OG_PAYOUT.md` §3
 *     er auto-multiplikator ALLEREDE anvendt i prisene serveren sender.
 *     For "Stor"-varianter multipliseres priceMultiplier med 3 (3× brett =
 *     3× pris av samme farge).
 *   - **Bakover-kompat**: tom array eller manglende `ticketColors` →
 *     null. Caller faller da tilbake på `state.ticketTypes` (fra
 *     `room:update.gameVariant.ticketTypes`) eller hardkodet default.
 *
 * Wire-kontrakt mot backend (KRITISK):
 *   `bet:arm`-payload sender `{type, name, qty}` per selection. Server's
 *   `expandSelectionsToTicketColors` matcher først på `name`, faller
 *   tilbake på `type`. Backend-canonical `name` kommer fra
 *   `spill1VariantMapper.ts:COLOR_SLUG_TO_NAME` ("Small White" / "Large
 *   White" / "Small Yellow" / "Large Yellow" / ...). MISMATCH = selection
 *   blir droppet stille.
 *
 *   Vi mapper Norwegian-slug ("hvit"/"gul"/"lilla") → backend-name både for
 *   small og large i `COLOR_TO_BACKEND_NAMES` under. Live game viser samme
 *   `name` allerede, så lobby-state og live-game er konsistente. Display-
 *   tekst-oversettelse til Norwegian ("Hvit"/"Gul"/"Lilla") for player-UI
 *   er en fremtidig polish — ut-av-scope for Fase 2 hvor det viktige er
 *   at bongene faktisk fungerer.
 */

import type {
  Spill1LobbyNextGame,
  Spill1LobbyTicketColor,
} from "@spillorama/shared-types/api";

/**
 * Backend-canonical `TicketTypeConfig.name`-par per Norwegian color-slug.
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
 * Tobias-direktiv 2026-05-11: spesifikasjonen sier "Hvit / Gul / Lilla"
 * og "Stor Hvit / Stor Gul / Stor Lilla" for spillerens UI. Backend
 * canonical er imidlertid "Small White / Large White / ..." osv. Diskrepansen
 * håndteres av en fremtidig display-name-mapping i Game1BuyPopup (out-of-
 * scope — bongene fungerer nå med riktig pris og bet:arm-flow). Live game
 * viser allerede "Small White"/"Large White", så lobby-state følger samme
 * konvensjon for konsistens.
 */
const COLOR_TO_BACKEND_NAMES: Readonly<
  Record<Spill1LobbyTicketColor, { small: string; large: string }>
> = {
  hvit: { small: "Small White", large: "Large White" },
  gul: { small: "Small Yellow", large: "Large Yellow" },
  lilla: { small: "Small Purple", large: "Large Purple" },
};

/**
 * `TicketTypeConfig.type` for small-bonger. Speiler
 * `spill1VariantMapper.ticketTypeFromSlug("small_*")` som returnerer
 * `type: "small"` for ALLE small-farge-slugs. Backend-side `bet:arm`-
 * resolver matcher først på `name` (presis), faller tilbake på `type`
 * (ambiguøs for multi-farge-typer). Vi bruker `name`-match som primær
 * via `COLOR_TO_BACKEND_NAMES` over.
 */
const SMALL_TICKET_TYPE = "small";

/**
 * `TicketTypeConfig.type` for large-bonger. Speiler
 * `spill1VariantMapper.ticketTypeFromSlug("large_*")` (returnerer
 * `type: "large"` for ALLE large-farge-slugs). Backend's `bet:arm`-resolver
 * faller tilbake på `type`-match hvis `name`-match feiler — kritisk når
 * server-side variant-config har ekspandert ticketTypes med både small og
 * large av samme farge.
 */
const LARGE_TICKET_TYPE = "large";

/**
 * Stor-bong = 3 brett. Tobias-direktiv 2026-05-11: "stor hvit = 3 av samme
 * bong" — identisk med hvit-bonger bare at man får 3 av dem. Multiplisere
 * pris og brett-count med samme faktor.
 */
const LARGE_TICKET_MULTIPLIER = 3;

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
  /** Antall brett ett kjøp gir (1 for small, 3 for large). */
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
 * For HVER gyldige farge legges to rader til output: small (1×, 1 brett)
 * og large (3×, 3 brett). Rekkefølgen er `[small_c1, large_c1, small_c2,
 * large_c2, ...]` så 2-column-grid-en i BuyPopup plasserer small+large av
 * samme farge på SAMME RAD (Tobias-direktiv 2026-05-11).
 *
 * Eksempler:
 *   - Standard Bingo: `["hvit","gul","lilla"]` + `{hvit:500, gul:1000,
 *     lilla:1500}` → entryFee=5, 6 rader med multipliers
 *     [1,3, 2,6, 3,9] og ticketCount [1,3,1,3,1,3]
 *   - Trafikklys: `["lilla"]` + `{lilla:1500}` → entryFee=15, 2 rader
 *     med [1,3] og [1,3]
 *   - Bare hvit: `["hvit"]` + `{hvit:500}` → entryFee=5, 2 rader (small
 *     hvit 1× + stor hvit 3×)
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
  // hovedspill (5/10/15 kr) til [1,2,3] for small-bonger og [3,6,9] for
  // large-bonger. Trafikklys (15 kr flat) til [1] small + [3] large.
  // Hvis backend en dag eksponerer non-standard prising er
  // `priceMultiplier` fortsatt presist matematisk konsistent.
  const minPriceCents = Math.min(...validPrices);
  const entryFee = minPriceCents / 100;

  // Output-rekkefølge: per farge → [small, large]. Med 2-column-grid-en i
  // BuyPopup ender small+large av samme farge på SAMME RAD.
  const ticketTypes: BuyPopupTicketType[] = [];
  for (let i = 0; i < validColors.length; i++) {
    const color = validColors[i];
    const priceCents = validPrices[i];
    const names = COLOR_TO_BACKEND_NAMES[color];
    const smallMultiplier = priceCents / minPriceCents;
    ticketTypes.push({
      name: names.small,
      type: SMALL_TICKET_TYPE,
      priceMultiplier: smallMultiplier,
      ticketCount: 1,
    });
    ticketTypes.push({
      name: names.large,
      type: LARGE_TICKET_TYPE,
      priceMultiplier: smallMultiplier * LARGE_TICKET_MULTIPLIER,
      ticketCount: LARGE_TICKET_MULTIPLIER,
    });
  }

  return { entryFee, ticketTypes };
}
