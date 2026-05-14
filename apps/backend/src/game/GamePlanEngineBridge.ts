/**
 * Fase 4 (2026-05-07): GamePlanEngineBridge — bro mellom katalog-modellen
 * (Fase 1) og legacy draw-engine (Game1MasterControlService.startGame).
 *
 * Pilot-fix (2026-05-08, Rad 1-4 + auto-mult): bridgen skriver nå en
 * kanonisk `spill1.ticketColors[]`-blokk i både `ticket_config_json` og
 * `game_config_json`. Dette er PÅKREVD for at engine sin payout-pipeline
 * (`Game1DrawEngineService.payoutPerColorGroups`) skal returnere riktig
 * Rad 1-4 + Fullt Hus-beløp. Før fix-en falt engine til flat-path
 * (`resolvePhaseConfig` som leser `prizePerPattern[row_X]` AS PERCENT) og
 * vinnerne fikk 0 kr på Rad 1-4. Auto-multiplikator (hvit 5kr×1, gul
 * 10kr×2, lilla 15kr×3) er bakt inn via `calculateActualPrize`, og
 * slug-form-keys (small_yellow / large_white / etc.) er PÅKREVD fordi
 * `spill1VariantMapper.ts:ticketTypeFromSlug` skipper familienavn alene
 * ("yellow"). Se
 * `apps/backend/src/game/__tests__/GamePlanEngineBridge.rowPayout.test.ts`
 * for full kontrakt-spesifikasjon.
 *
 * Bakgrunn (Fase 4-spec §1):
 * Game1MasterControlService.startGame leser en eksisterende rad i
 * `app_game1_scheduled_games` og kjører engine basert på:
 *   - participating_halls_json
 *   - master_hall_id, group_hall_id
 *   - sub_game_name, notification_start_seconds
 *   - ticket_config_json, jackpot_config_json, game_config_json
 *
 * For at engine skal kunne kjøre fra ny katalog-modell uten omfattende
 * refaktor, bruker bridgen en SHIM-tilnærming:
 *   1) `createScheduledGameForPlanRunPosition(runId, position)` opprettes
 *      en `app_game1_scheduled_games`-rad med:
 *      - catalog_entry_id   = catalog-rad fra plan-item
 *      - plan_run_id        = run.id
 *      - plan_position      = position
 *      - sub_game_name      = catalog.displayName
 *      - ticket_config_json = derivert fra catalog (farger, priser, premier)
 *      - jackpot_config_json = jackpot-override (hvis catalog krever setup)
 *      - master_hall_id     = run.hallId
 *      - group_hall_id      = hall-gruppe som master tilhører
 *      - participating_halls_json = ALLE aktive haller i gruppen
 *        (master først, deretter andre medlemmer i added_at-rekkefølge)
 *      - status             = 'ready_to_start'
 *   2) Returnerer scheduled_game.id som passes til
 *      `Game1MasterControlService.startGame({ gameId, actor })`.
 *   3) Engine kjører uendret — den vet ikke at raden er bridge-spawnet.
 *
 * Multi-hall via group-of-halls (2026-05-08):
 * Bridgen ekspanderer nå `participating_halls_json` til å inkludere alle
 * aktive medlemmer av masterhallens hall-gruppe — ikke bare masteren.
 * Dette er nødvendig for pilot-bruken (Teknobingo Årnes som master +
 * Bodø/Brumunddal/Fauske som deltagere). Engine + Game1HallReadyService
 * er allerede multi-hall-aware via `parseHallIdsArray`-helpere — de leser
 * `participating_halls_json` direkte.
 *
 * Out-of-scope:
 *   - Bonus-spill-integrasjon i engine (catalog.bonus_game_slug propageres
 *     til ticket_config_json så MiniGameRouter kan plukke det opp, men
 *     selve trigger-logikken er fortsatt i engine).
 *   - Mock-vennlig pool: vi tar pool i konstruktør slik at tester kan
 *     injisere en stub.
 *
 * Wire-protokoll:
 *   - Caller (agentGamePlan.ts /start) henter run + plan via plan-services
 *     og delegerer til bridgen for å produsere en gameId.
 *   - Bridgen er IDEMPOTENT på (plan_run_id, plan_position) — re-kall med
 *     samme nøkkel returnerer eksisterende rad. Dette beskytter mot dobbel-
 *     spawn ved network-retries.
 */

import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

import { DomainError } from "../errors/DomainError.js";
import { logger as rootLogger } from "../util/logger.js";
import { getCanonicalRoomCode } from "../util/canonicalRoomCode.js";
import { HallGroupMembershipQuery } from "../platform/HallGroupMembershipQuery.js";
import { calculateActualPrize } from "./GameCatalogService.js";
import type { GameCatalogService } from "./GameCatalogService.js";
import type { GamePlanService } from "./GamePlanService.js";
import type { GamePlanRunService } from "./GamePlanRunService.js";
import type {
  BonusGameSlug,
  GameCatalogEntry,
  TicketColor,
} from "./gameCatalog.types.js";
import type { JackpotOverride } from "./gamePlan.types.js";

const log = rootLogger.child({ module: "game-plan-engine-bridge" });

// Default notification-window i sekunder. Engine bruker dette for
// purchase_open → ready_to_start-transisjonen. Catalog-modellen har ikke
// et eksplisitt felt for dette ennå (rules-json kunne hatt det), så vi
// bruker 5 minutter som baseline (samme som legacy "5m" parser).
const DEFAULT_NOTIFICATION_SECONDS = 300;

// Lengde på purchase-vinduet. Vi sikter på 10 minutter for catalog-spill —
// noen rader trenger lengre (jackpot-spill kan ha 30 min) men det er ikke
// dokumentert i catalog-skjemaet ennå. Default er en kvalifisert gjetning.
const DEFAULT_PURCHASE_WINDOW_SECONDS = 600;

function assertSchemaName(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
  }
  return schema;
}

/**
 * Bygg ticket_config_json fra catalog-entry.
 *
 * C2-fix (2026-05-07, code-review): engine forventer en ARRAY-of-objects
 * under `ticketTypesData` (ikke et record under `ticketTypes`). Se
 * `Game1TicketPurchaseService.extractTicketCatalog`
 * (apps/backend/src/game/Game1TicketPurchaseService.ts:1191) som er
 * eneste konsumpsjons-kilde. Riktig shape:
 *   { ticketTypesData: [{ color, size, pricePerTicket }, ...] }
 *
 * Hver bongfarge får entries for både small og large — Spillorama selger
 * begge størrelser av hver farge, og engine validerer hver
 * (color, size)-kombinasjon separat. Konvensjon (legacy + tester):
 * large = 2x small når catalog kun har én pris per farge.
 *
 * Catalog bruker norsk farge-vokabular ("gul"/"hvit"/"lilla"); engine
 * forventer engelsk ("yellow"/"white"/"purple"). Bridgen oversetter
 * her, ikke i engine.
 *
 * Pilot-fix (2026-05-08, ticket Rad 1-4 + auto-mult): bridgen skriver i
 * tillegg en KANONISK `spill1.ticketColors[]`-blokk i samme JSON som
 * engine sin variant-mapper (`buildVariantConfigFromGameConfigJson` i
 * apps/backend/src/game/Game1DrawEngineHelpers.ts:205) konsumerer fra
 * `game_config_json`. Den blokken bruker SLUG-FORM-nøkler
 * (`small_yellow` / `large_yellow` / `small_white` / `large_white` /
 * `small_purple` / `large_purple`) fordi `spill1VariantMapper.ts`
 * (`COLOR_SLUG_TO_NAME`) kun aksepterer slug-input. Engine-payout-pathen
 * (`Game1DrawEngineService.payoutPerColorGroups`) plukker første-vinners
 * pattern via `resolvePatternsForColor` som mapper fra slug → engine-navn
 * ("Small Yellow"). Dette er nødvendig for at Rad 1-4 og Fullt Hus skal
 * bli faktisk utbetalt med riktige beløp i øre — uten denne blokken
 * faller engine til flat-path som leser `prizePerPattern[row_X]` som
 * PROSENT av pot, og catalog-base-beløp gir 0-payout for alle faser.
 */
const NORWEGIAN_TO_ENGLISH_COLOR: Record<TicketColor, string> = {
  gul: "yellow",
  hvit: "white",
  lilla: "purple",
};

/**
 * Slug-prefix for engine-konsumert `spill1.ticketColors[].color`. Map
 * fra (engelsk farge-familie, størrelse) → slug ("small_yellow",
 * "large_purple", ...). Må holdes i synk med `COLOR_SLUG_TO_NAME` i
 * `apps/backend/src/game/spill1VariantMapper.ts`.
 */
const SIZE_PREFIX: Readonly<Record<"small" | "large", string>> = {
  small: "small",
  large: "large",
};

function colorSlugFor(englishFamily: string, size: "small" | "large"): string {
  return `${SIZE_PREFIX[size]}_${englishFamily}`;
}

/**
 * Pot-per-bongstørrelse-fix (2026-05-08, §6 + §9 i SPILL_REGLER_OG_PAYOUT.md):
 *
 * Bygg `spill1.oddsen`-blokk når katalog-raden er en Oddsen-variant. Engine
 * leser denne blokken i `Game1DrawEngineService` for å overstyre Fullt Hus-
 * poten — HIGH/LOW-bucket bestemmes av `drawSequenceAtWin <= targetDraw`
 * (inklusiv → HIGH; ellers → LOW). Rad 1-4 følger standard auto-mult.
 *
 * Returnerer null hvis raden IKKE er Oddsen, eller hvis nødvendige felter
 * (`targetDraw`, `bingoBaseLow`, `bingoBaseHigh`) mangler/er ugyldige.
 * Engine vil da bruke standard `full_house`-pattern (auto-mult bingoBase)
 * som fallback.
 */
function buildOddsenBlock(
  catalog: GameCatalogEntry,
): { targetDraw: number; bingoBaseLow: number; bingoBaseHigh: number } | null {
  const rules = catalog.rules as Record<string, unknown> | null | undefined;
  if (!rules || typeof rules !== "object") return null;
  if (rules.gameVariant !== "oddsen") return null;

  const targetDraw = numberFromRules(rules.targetDraw);
  const bingoBaseLow = numberFromRules(rules.bingoBaseLow);
  const bingoBaseHigh = numberFromRules(rules.bingoBaseHigh);

  if (targetDraw === null || targetDraw <= 0) return null;
  if (bingoBaseLow === null || bingoBaseLow < 0) return null;
  if (bingoBaseHigh === null || bingoBaseHigh < 0) return null;

  return { targetDraw, bingoBaseLow, bingoBaseHigh };
}

const TRAFIKKLYS_VALID_ROW_COLORS: ReadonlySet<string> = new Set([
  "rød",
  "grønn",
  "gul",
]);

/**
 * Trafikklys runtime (2026-05-08, §5 i SPILL_REGLER_OG_PAYOUT.md):
 *
 * Bygg `spill1.trafikklys`-blokk når katalog-raden er en Trafikklys-variant.
 * Engine leser denne blokken i `Game1DrawEngineService` for å trekke rad-
 * farge ved spill-start og overstyre BÅDE Rad 1-4 OG Fullt Hus-poten basert
 * på trukket rad-farge.
 *
 * Blokken er en transparent kopi av `rules.{rowColors, prizesPerRowColor,
 * bingoPerRowColor}` — engine kan også lese feltene fra top-level `rules`
 * (bridgen videreformidler `catalog.rules` uendret), men en kanonisk
 * `spill1.trafikklys`-blokk gjør parsing-pathen identisk med Oddsen-pathen
 * og forenkler tester.
 *
 * Returnerer null hvis raden IKKE er Trafikklys, eller hvis nødvendige
 * felter (rowColors, prizesPerRowColor, bingoPerRowColor) mangler/er
 * ugyldige. Engine vil da bruke standard auto-mult-pathen som fallback.
 */
function buildTrafikklysBlock(
  catalog: GameCatalogEntry,
): {
  rowColors: string[];
  prizesPerRowColor: Record<string, number>;
  bingoPerRowColor: Record<string, number>;
} | null {
  const rules = catalog.rules as Record<string, unknown> | null | undefined;
  if (!rules || typeof rules !== "object") return null;
  if (rules.gameVariant !== "trafikklys") return null;

  const rawRowColors = rules.rowColors;
  if (!Array.isArray(rawRowColors) || rawRowColors.length === 0) return null;
  const rowColors: string[] = [];
  for (const c of rawRowColors) {
    if (typeof c === "string" && TRAFIKKLYS_VALID_ROW_COLORS.has(c)) {
      if (!rowColors.includes(c)) rowColors.push(c);
    }
  }
  if (rowColors.length === 0) return null;

  const rawPrizes = rules.prizesPerRowColor as
    | Record<string, unknown>
    | null
    | undefined;
  const rawBingo = rules.bingoPerRowColor as
    | Record<string, unknown>
    | null
    | undefined;
  if (!rawPrizes || typeof rawPrizes !== "object") return null;
  if (!rawBingo || typeof rawBingo !== "object") return null;

  const prizesPerRowColor: Record<string, number> = {};
  const bingoPerRowColor: Record<string, number> = {};

  for (const color of rowColors) {
    const prize = numberFromRules(rawPrizes[color]);
    const bingo = numberFromRules(rawBingo[color]);
    if (prize === null || prize <= 0) return null;
    if (bingo === null || bingo <= 0) return null;
    prizesPerRowColor[color] = prize;
    bingoPerRowColor[color] = bingo;
  }

  return { rowColors, prizesPerRowColor, bingoPerRowColor };
}

function numberFromRules(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number.parseFloat(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Multiplikator for "large"-bong-pris over "small".
 *
 * Pilot-fix 2026-05-13 (Tobias-direktiv): tidligere `2`, men "stor"-bong
 * inneholder 3 brett — bundle-pris skal være `smallPrice × 3`. Eksempel
 * med lilla bong:
 *   - Liten lilla: 1 brett à 15 kr  → smallPrice = 1500 øre
 *   - Stor lilla:  3 brett à 15 kr → smallPrice × 3 = 4500 øre (45 kr)
 *
 * Matcher `spill1VariantMapper.ts:ticketTypeFromSlug` der large-types
 * har `priceMultiplier: 3, ticketCount: 3` og `app_game1_ticket_assignments`
 * der vi genererer 3 brett per Large-kjøp.
 *
 * Tobias' total-validering 2026-05-13 (6 brett, 1 av hver type):
 *   5 + 15 + 10 + 30 + 15 + 45 = 120 kr
 *   (Small white 5 + Large white 15 + Small yellow 10 + Large yellow 30
 *    + Small purple 15 + Large purple 45)
 *
 * Med LARGE × 2 (gammel verdi) ville total være 90 kr — feil.
 *
 * `bongMultiplierForColorSlug` (Game1DrawEngineHelpers.ts) er konsistent
 * med Large × 3: small=1, large=2 for hvit, small=2/large=4 for gul,
 * small=3/large=6 for lilla → matcher per-bong-pris/500-base.
 */
const LARGE_TICKET_PRICE_MULTIPLIER = 3;

/**
 * Tolkning A (2026-05-07): per-item bonus-override.
 *
 * `bonusGameOverride` overstyrer `catalog.bonusGameSlug` per plan-item
 * når den er satt. Forrang-regelen er:
 *
 *   override (ikke null/undefined) > catalog.bonusGameSlug > ingen bonus
 *
 * `catalog.bonusGameEnabled` brukes fortsatt som on/off-switch — hvis
 * bonus er disabled på catalog-nivå, slipper vi bonus selv om override
 * er satt.
 */
export function buildTicketConfigFromCatalog(
  catalog: GameCatalogEntry,
  bonusGameOverride: BonusGameSlug | null = null,
): Record<string, unknown> {
  const ticketTypesData: Array<{
    color: string;
    size: "small" | "large";
    pricePerTicket: number;
  }> = [];
  for (const color of catalog.ticketColors) {
    const englishKey = NORWEGIAN_TO_ENGLISH_COLOR[color] ?? color;
    const smallPrice = catalog.ticketPricesCents[color] ?? 0;
    if (smallPrice <= 0) continue;
    ticketTypesData.push({
      color: englishKey,
      size: "small",
      pricePerTicket: smallPrice,
    });
    ticketTypesData.push({
      color: englishKey,
      size: "large",
      pricePerTicket: smallPrice * LARGE_TICKET_PRICE_MULTIPLIER,
    });
  }

  // Bingo-premier per bongfarge for engine.
  // Auto-multiplikator (Tobias 2026-05-07): når
  // `catalog.prizeMultiplierMode = "auto"`, regnes per-farge bingo ut fra
  // `bingoBase × (ticketPrice / 500)` via `calculateActualPrize`. Hvit
  // 5 kr → base × 1, gul 10 kr → base × 2, lilla 15 kr → base × 3 osv.
  // Når mode = "explicit_per_color" leses `prizesCents.bingo[color]`
  // uendret (Trafikklys-stil).
  const bingoPrizes: Record<string, number> = {};
  if (catalog.prizeMultiplierMode === "auto") {
    const bingoBase = catalog.prizesCents.bingoBase ?? 0;
    if (bingoBase > 0) {
      for (const color of catalog.ticketColors) {
        const englishKey = NORWEGIAN_TO_ENGLISH_COLOR[color] ?? color;
        const ticketPrice = catalog.ticketPricesCents[color] ?? 0;
        if (ticketPrice <= 0) continue;
        const actual = calculateActualPrize(catalog, bingoBase, ticketPrice);
        if (actual > 0) bingoPrizes[englishKey] = actual;
      }
    }
  } else {
    for (const color of catalog.ticketColors) {
      const englishKey = NORWEGIAN_TO_ENGLISH_COLOR[color] ?? color;
      const prize = catalog.prizesCents.bingo[color] ?? 0;
      if (prize > 0) bingoPrizes[englishKey] = prize;
    }
  }

  // Pilot-fix (2026-05-08): kanonisk `spill1.ticketColors[]`-blokk slik
  // at `Game1DrawEngineHelpers.buildVariantConfigFromGameConfigJson` kan
  // bygge en GameVariantConfig med `patternsByColor[]`. Engine-payout-
  // pathen (`Game1DrawEngineService.payoutPerColorGroups`) bruker første
  // vinners farge-pattern som global-pot-prize per Q3=X-regulatorisk
  // valg (alle vinnere deler likt uansett farge).
  //
  // Hver entry har:
  //   - color: slug-form (`small_yellow`/`large_white`/etc.) — slug-form
  //     er påkrevd fordi `spill1VariantMapper.ts:ticketTypeFromSlug`
  //     skipper ukjente slugs (familienavn som "yellow" alene godtas
  //     ikke). Color matcher dermed `app_game1_ticket_assignments
  //     .ticket_color` etter at purchase-flow stores slug-form.
  //   - priceNok: pris i hele kroner (kr, ikke øre).
  //   - prizePerPattern: per-fase, per (color, size) auto-multiplisert
  //     beløp i `{ mode: "fixed", amount: <kr> }`-form. Mode "fixed"
  //     mapper i `spill1VariantMapper.ts:patternConfigForPhase` til
  //     `winningType: "fixed"` + `prize1: <kr>` som engine konverterer
  //     til øre via `patternPrizeToCents` (kr × 100).
  //
  // For "auto"-modus skaleres alle 5 faser (Rad 1-4 + Fullt Hus) med
  // `calculateActualPrize(catalog, base, ticketPriceCents)`. For
  // "explicit_per_color" (Trafikklys) leses Rad 1-4 fra
  // `catalog.prizesCents.radN` direkte (ingen skalering — flat 15 kr-bong)
  // og Fullt Hus fra `catalog.prizesCents.bingo[color]`. Trafikklys'
  // rad-farge-spesifikke beløp (rød/grønn/gul) håndteres i en separat
  // path i engine via `rules.prizesPerRowColor` og er IKKE bridge-bridgens
  // ansvar her.
  const spill1TicketColors: Array<{
    color: string;
    priceNok: number;
    prizePerPattern: Record<string, { mode: "fixed"; amount: number }>;
  }> = [];

  for (const color of catalog.ticketColors) {
    const englishFamily = NORWEGIAN_TO_ENGLISH_COLOR[color] ?? color;
    const smallPriceCents = catalog.ticketPricesCents[color] ?? 0;
    if (smallPriceCents <= 0) continue;
    const sizes: Array<{ size: "small" | "large"; priceCents: number }> = [
      { size: "small", priceCents: smallPriceCents },
      {
        size: "large",
        priceCents: smallPriceCents * LARGE_TICKET_PRICE_MULTIPLIER,
      },
    ];
    for (const { size, priceCents } of sizes) {
      // Auto-multipliser per-fase Rad-base (catalog.prizesCents.radN).
      // I "explicit_per_color" returnerer `calculateActualPrize` base-
      // beløpet uendret — perfekt for Trafikklys flat-15-kr-bong-modus.
      const rad1Cents = calculateActualPrize(
        catalog,
        catalog.prizesCents.rad1,
        priceCents,
      );
      const rad2Cents = calculateActualPrize(
        catalog,
        catalog.prizesCents.rad2,
        priceCents,
      );
      const rad3Cents = calculateActualPrize(
        catalog,
        catalog.prizesCents.rad3,
        priceCents,
      );
      const rad4Cents = calculateActualPrize(
        catalog,
        catalog.prizesCents.rad4,
        priceCents,
      );

      // Fullt hus: i "auto" → bingoBase auto-skaleres. I
      // "explicit_per_color" → catalog.prizesCents.bingo[color] per
      // (norsk) farge — IKKE skalert (flat-bong-modus).
      let fullHouseCents = 0;
      if (catalog.prizeMultiplierMode === "auto") {
        const bingoBase = catalog.prizesCents.bingoBase ?? 0;
        if (bingoBase > 0) {
          fullHouseCents = calculateActualPrize(catalog, bingoBase, priceCents);
        }
      } else {
        fullHouseCents = catalog.prizesCents.bingo[color] ?? 0;
      }

      // Bygg prizePerPattern. Hopper over faser med 0-base så
      // `spill1VariantMapper.patternConfigForPhase` faller til fallback-
      // pattern (DEFAULT_NORSK_BINGO_CONFIG-default 100/200/200/200/1000).
      // Det er TRYGGERE enn å skrive amount=0 i fixed-mode — admin kan
      // eksplisitt sette 0 hvis de virkelig ønsker det.
      const prizePerPattern: Record<
        string,
        { mode: "fixed"; amount: number }
      > = {};
      // Konverter øre → kr (catalog stores i øre, mapper forventer kr).
      if (rad1Cents > 0)
        prizePerPattern.row_1 = { mode: "fixed", amount: rad1Cents / 100 };
      if (rad2Cents > 0)
        prizePerPattern.row_2 = { mode: "fixed", amount: rad2Cents / 100 };
      if (rad3Cents > 0)
        prizePerPattern.row_3 = { mode: "fixed", amount: rad3Cents / 100 };
      if (rad4Cents > 0)
        prizePerPattern.row_4 = { mode: "fixed", amount: rad4Cents / 100 };
      if (fullHouseCents > 0)
        prizePerPattern.full_house = {
          mode: "fixed",
          amount: fullHouseCents / 100,
        };

      spill1TicketColors.push({
        color: colorSlugFor(englishFamily, size),
        priceNok: priceCents / 100,
        prizePerPattern,
      });
    }
  }

  // Pot-per-bongstørrelse-fix (2026-05-08, §9 i SPILL_REGLER_OG_PAYOUT.md):
  // For Oddsen-katalog-rader (`rules.gameVariant === "oddsen"`) skriver vi
  // en separat `spill1.oddsen`-blokk som engine bruker til å overstyre
  // Fullt-Hus-poten. HIGH/LOW-bucket bestemmes av `drawSequenceAtWin <=
  // targetDraw` (HIGH) eller > (LOW). Rad 1-4 følger fortsatt standard
  // auto-multiplikator-pathen (Rad 1-4 har ingen Oddsen-spesial-mekanikk).
  //
  // Felter forventet i `catalog.rules`:
  //   - gameVariant: "oddsen"
  //   - targetDraw: number (eks. 55, 56, 57)
  //   - bingoBaseLow: øre (eks. 50000 = 500 kr per hvit-bong)
  //   - bingoBaseHigh: øre (eks. 150000 = 1500 kr per hvit-bong)
  //
  // Hvis felter mangler eller er ugyldige → ingen oddsen-blokk skrives og
  // engine faller tilbake til standard auto-mult Fullt Hus pathen
  // (`prizePerPattern.full_house`). Det er en sikker fallback fordi
  // `buildTicketConfigFromCatalog` allerede skriver `full_house` per farge
  // via `bingoBase × multiplier`.
  const oddsenBlock = buildOddsenBlock(catalog);

  // Trafikklys runtime (2026-05-08, §5 i SPILL_REGLER_OG_PAYOUT.md): bygg
  // `spill1.trafikklys`-blokk parallelt med oddsen. Engine bruker den til å
  // overstyre BÅDE Rad 1-4 og Fullt Hus-poten basert på trukket rad-farge.
  // Mutually exclusive med oddsen — bridge avviser kombinasjonen ved å sette
  // KUN trafikklys-blokken (oddsen-blokken vil uansett bli null fordi
  // gameVariant !== "oddsen" når Trafikklys er aktiv).
  const trafikklysBlock = buildTrafikklysBlock(catalog);

  const spill1Block: Record<string, unknown> = {
    // Pilot-fix (2026-05-08): kanonisk per-farge-pattern-blokk for
    // engine sin variant-mapper. Slug-form keys (small_yellow/large_yellow/
    // etc.) er PÅKREVD — `COLOR_SLUG_TO_NAME` skipper familienavn alene.
    ticketColors: spill1TicketColors,
  };
  if (oddsenBlock) {
    spill1Block.oddsen = oddsenBlock;
  }
  if (trafikklysBlock) {
    spill1Block.trafikklys = trafikklysBlock;
  }

  // Tobias-direktiv 2026-05-11: ball-trekk-intervall (sekunder mellom hver
  // kule) propageres fra `catalog.rules.timing.seconds` til
  // `spill1.timing.seconds` slik at `Game1AutoDrawTickService.resolveSeconds`
  // bruker katalog-eksplisitt verdi i stedet for default-fallback (5 sek).
  // Hvis katalog ikke har timing, faller engine på `defaultSeconds = 5`.
  const catalogTiming = (catalog.rules as Record<string, unknown>)?.timing;
  if (
    catalogTiming &&
    typeof catalogTiming === "object" &&
    "seconds" in catalogTiming &&
    typeof (catalogTiming as { seconds: unknown }).seconds === "number"
  ) {
    spill1Block.timing = {
      seconds: (catalogTiming as { seconds: number }).seconds,
    };
  }

  const config: Record<string, unknown> = {
    catalogId: catalog.id,
    catalogSlug: catalog.slug,
    prizeMultiplierMode: catalog.prizeMultiplierMode,
    // Engine-leselig nøkkel — array-of-objects med {color, size, pricePerTicket}.
    // Brukt av `Game1TicketPurchaseService.extractTicketCatalog` for
    // pris-validering. Family-form colors (yellow/white/purple) bevares
    // for backward-compat med eksisterende C2-kontrakt.
    ticketTypesData,
    rowPrizes: {
      // Audit/debug: base-verdier (i øre, ikke skalert per farge). Rad 1-4
      // sin auto-skalerte premie ligger i spill1.ticketColors[].prizePerPattern.
      row1: catalog.prizesCents.rad1,
      row2: catalog.prizesCents.rad2,
      row3: catalog.prizesCents.rad3,
      row4: catalog.prizesCents.rad4,
    },
    // Bingo-premie per (engelsk family-name) farge — beholdes for tester
    // og legacy-tooling som leser top-level `bingoPrizes`. Engine bruker
    // `spill1.ticketColors[].prizePerPattern.full_house` (slug-keyed).
    bingoPrizes,
    // Tobias 2026-05-07: rules-objektet beholdes som "extra" så engine kan
    // lese spill-spesifikk config (mini-game-rotation, lucky number osv.)
    // hvis admin har lagt til detaljer.
    rules: catalog.rules,
    spill1: spill1Block,
  };

  // bingoBase eksponeres separat så engine/audit-tooling kan se base-
  // verdien for "auto"-modus uten å re-derive fra prizesCents-rådata.
  if (
    catalog.prizeMultiplierMode === "auto" &&
    typeof catalog.prizesCents.bingoBase === "number"
  ) {
    config.bingoBase = catalog.prizesCents.bingoBase;
  }

  // Tolkning A (2026-05-07): override > catalog. catalog.bonusGameEnabled
  // er fortsatt master-switch — hvis bonus er disabled på catalog-nivå,
  // slipper vi bonus uavhengig av override.
  if (catalog.bonusGameEnabled) {
    const effectiveSlug = bonusGameOverride ?? catalog.bonusGameSlug;
    if (effectiveSlug) {
      config.bonusGame = {
        slug: effectiveSlug,
        enabled: true,
        // Diagnostikk: lagre om override ble brukt — admin/audit-tooling
        // kan se hvilken kilde som vant ved feilsøking.
        overrideApplied: bonusGameOverride !== null,
      };
    }
  }

  return config;
}

/**
 * Bygg jackpot-konfig fra override.
 *
 * H1-fix (2026-05-07, code-review): engine leser jackpot fra
 * `ticket_config_json.spill1.jackpot.prizeByColor` + `.draw` — IKKE fra
 * en separat `jackpot_config_json`-kolonne. Se
 * `Game1DrawEngineHelpers.resolveJackpotConfig`
 * (apps/backend/src/game/Game1DrawEngineHelpers.ts:154).
 *
 * Returnerer både engine-leselig keys (`prizeByColor`/`draw`) og
 * backward-compat-aliaser (`jackpotPrize`/`jackpotDraw`) i samme objekt.
 * Caller `buildEngineTicketConfig` plukker ut riktig sub-set når den
 * embedder under `spill1.jackpot`-pathen i ticket-config.
 *
 * Returnerer tom objekt hvis override mangler.
 */
export function buildJackpotConfigFromOverride(
  override: JackpotOverride | null,
): Record<string, unknown> {
  if (!override) return {};
  const prizeByColor: Record<string, number> = {};
  for (const [color, amount] of Object.entries(override.prizesCents)) {
    if (typeof amount !== "number") continue;
    const englishKey =
      NORWEGIAN_TO_ENGLISH_COLOR[color as TicketColor] ?? color;
    prizeByColor[englishKey] = amount;
  }
  return {
    // Engine-leselig keys (primær).
    prizeByColor,
    draw: override.draw,
    // Backward-compat alias-keys (admin-tooling, tester).
    jackpotPrize: { ...prizeByColor },
    jackpotDraw: override.draw,
  };
}

/**
 * H1-fix: kombiner ticket-config og jackpot-override i én payload som
 * engine kan parse direkte. Plasserer jackpot under `spill1.jackpot`-
 * pathen så `Game1DrawEngineHelpers.resolveJackpotConfig` finner den
 * (den leter både på `obj.spill1.jackpot` og fallback `obj.jackpot`).
 *
 * Tolkning A (2026-05-07): per-item bonus-override videreformidles til
 * `buildTicketConfigFromCatalog`. Når override er null faller vi tilbake
 * til catalog-default uendret.
 *
 * Pilot-fix (2026-05-08): `buildTicketConfigFromCatalog` skriver nå en
 * `spill1.ticketColors[]`-blokk for engine sin per-farge-pattern-mapper.
 * Vi merger jackpot inn i samme `spill1`-objekt i stedet for å overskrive
 * det — ellers ville Rad 1-4-pattern-fixet gå tapt for jackpot-spill.
 */
export function buildEngineTicketConfig(
  catalog: GameCatalogEntry,
  jackpotOverride: JackpotOverride | null,
  bonusGameOverride: BonusGameSlug | null = null,
): Record<string, unknown> {
  const base = buildTicketConfigFromCatalog(catalog, bonusGameOverride);
  const jackpot = buildJackpotConfigFromOverride(jackpotOverride);
  if (Object.keys(jackpot).length === 0) return base;
  // Merge jackpot inn i eksisterende spill1-objekt (som inneholder
  // ticketColors[] fra buildTicketConfigFromCatalog). Spread-semantikk
  // bevarer ticketColors-arrayet uendret.
  const existingSpill1 =
    (base.spill1 as Record<string, unknown> | undefined) ?? {};
  return {
    ...base,
    spill1: {
      ...existingSpill1,
      jackpot: {
        prizeByColor: jackpot.prizeByColor,
        draw: jackpot.draw,
      },
    },
  };
}

export interface GamePlanEngineBridgeOptions {
  pool: Pool;
  schema?: string;
  catalogService: GameCatalogService;
  planService: GamePlanService;
  planRunService: GamePlanRunService;
  /**
   * F2 (BUG-F2, Tobias-rapport 2026-05-14): pre-engine ticket-config-
   * binding-hook. Kalles POST-INSERT av en frisk scheduled-game-rad i
   * `createScheduledGameForPlanRunPosition`, FØR engine.startGame
   * trigges av master.
   *
   * Hvorfor pre-engine OG post-engine:
   *   - PR #1375 (`Game1MasterControlService.onEngineStarted`) løste
   *     post-engine-start-pathen: når master kaller startGame, binder
   *     hooken `roomState.roomConfiguredEntryFeeByRoom` + `variantByRoom`
   *     fra `ticket_config_json`. Det fungerer for runder som master
   *     starter umiddelbart.
   *   - Pre-game-vinduet — fra scheduled-game opprettes (status =
   *     'ready_to_start') TIL master trykker "Start" — er ikke dekket
   *     av onEngineStarted-hooken. I dette vinduet kan spillere allerede
   *     joine rommet og se buy-popup, men room-snapshot returnerer
   *     `gameVariant.ticketTypes` med flat `priceMultiplier: 1` for ALLE
   *     farger fordi `variantByRoom` ikke er rebound fra
   *     `ticket_config_json`. Klient (`PlayScreen.ts:606`) faller til
   *     `state.entryFee ?? 10` × `priceMultiplier`, og Yellow vises som
   *     `10 × 2 = 20 kr` istedenfor riktige 10 kr.
   *
   * Hva hooken må gjøre (samme tre steg som onEngineStarted):
   *   1. Sette `roomState.roomConfiguredEntryFeeByRoom` til billigste
   *      bongpris (typisk 500 øre = 5 kr) så room-snapshot returnerer
   *      riktig `gameVariant.entryFee`.
   *   2. Re-binde `variantByRoom` med
   *      `buildVariantConfigFromGameConfigJson` fra
   *      `ticket_config_json.spill1.ticketColors[]` så pre-game patterns
   *      + per-farge multipliers vises korrekt.
   *   3. Trigge `emitRoomUpdate(roomCode)` så klienter får nye verdier
   *      umiddelbart (ikke ved første draw-tick).
   *
   * Soft-fail: feil her påvirker IKKE caller-resultat eller
   * scheduled-game-INSERT. Klient kan vise default-priser inntil
   * `onEngineStarted` re-binder (post-engine).
   *
   * Idempotens: hook kan kalles flere ganger for samme roomCode
   * (idempotent retry, bridge spawn-er ny rad ved samme run+position).
   * Implementasjon i index.ts logger WARN ved re-binding for samme
   * room+scheduledGameId, men setter samme verdi (no-op fra klient-
   * perspektiv).
   *
   * Wire-protokoll: implementasjonen ligger i index.ts (DI-wiring) —
   * hook abstrakt her for å holde service-en fri for roomState/
   * emitRoomUpdate-avhengigheter. Mirrer
   * `Game1MasterControlService.onEngineStarted`-mønsteret eksakt.
   */
  onScheduledGameCreated?: (input: {
    scheduledGameId: string;
    roomCode: string;
    ticketConfigJson: unknown;
  }) => Promise<void> | void;
}

export interface CreateScheduledGameResult {
  scheduledGameId: string;
  catalogEntry: GameCatalogEntry;
  /**
   * True hvis vi gjenbrukte en eksisterende rad (idempotent retry).
   * False hvis vi nettopp opprettet raden.
   */
  reused: boolean;
}

export class GamePlanEngineBridge {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly catalogService: GameCatalogService;
  private readonly planService: GamePlanService;
  private readonly planRunService: GamePlanRunService;
  /**
   * Bølge 5 (2026-05-08): konsolidert GoH-membership-query. Brukes av
   * `resolveParticipatingHallIds` + `resolveGroupHallId` istedenfor inline
   * SQL — én autoritativ implementasjon på tvers av engine-bridge,
   * agent-konsoll og hall-ready-service.
   */
  private readonly membershipQuery: HallGroupMembershipQuery;
  /**
   * F2 (BUG-F2 2026-05-14): pre-engine ticket-config-binding-hook.
   * Se `GamePlanEngineBridgeOptions.onScheduledGameCreated`.
   */
  private onScheduledGameCreated:
    | GamePlanEngineBridgeOptions["onScheduledGameCreated"]
    | null;

  constructor(options: GamePlanEngineBridgeOptions) {
    this.pool = options.pool;
    this.schema = assertSchemaName(options.schema ?? "public");
    this.catalogService = options.catalogService;
    this.planService = options.planService;
    this.planRunService = options.planRunService;
    this.onScheduledGameCreated = options.onScheduledGameCreated ?? null;
    this.membershipQuery = new HallGroupMembershipQuery({
      pool: this.pool,
      schema: this.schema,
    });
  }

  /** @internal — test-hook. */
  static forTesting(
    opts: GamePlanEngineBridgeOptions,
  ): GamePlanEngineBridge {
    const svc = Object.create(
      GamePlanEngineBridge.prototype,
    ) as GamePlanEngineBridge;
    (svc as unknown as { pool: Pool }).pool = opts.pool;
    (svc as unknown as { schema: string }).schema = assertSchemaName(
      opts.schema ?? "public",
    );
    (svc as unknown as {
      catalogService: GameCatalogService;
    }).catalogService = opts.catalogService;
    (svc as unknown as {
      planService: GamePlanService;
    }).planService = opts.planService;
    (svc as unknown as {
      planRunService: GamePlanRunService;
    }).planRunService = opts.planRunService;
    (svc as unknown as {
      onScheduledGameCreated:
        | GamePlanEngineBridgeOptions["onScheduledGameCreated"]
        | null;
    }).onScheduledGameCreated = opts.onScheduledGameCreated ?? null;
    (svc as unknown as {
      membershipQuery: HallGroupMembershipQuery;
    }).membershipQuery = new HallGroupMembershipQuery({
      pool: opts.pool,
      schema: assertSchemaName(opts.schema ?? "public"),
    });
    return svc;
  }

  /**
   * F2 (BUG-F2 2026-05-14): test-/DI-hook for å sette
   * `onScheduledGameCreated`-callback POST-konstruktor. Brukes av
   * `index.ts` fordi roomState + emitRoomUpdate ikke er tilgjengelige
   * ved bridge-konstruksjon (samme mønster som
   * `Game1MasterControlService.setOnEngineStarted`).
   */
  setOnScheduledGameCreated(
    callback: GamePlanEngineBridgeOptions["onScheduledGameCreated"],
  ): void {
    this.onScheduledGameCreated = callback ?? null;
  }

  private scheduledGamesTable(): string {
    return `"${this.schema}"."app_game1_scheduled_games"`;
  }

  /**
   * Slå opp jackpot-override for en gitt posisjon i en aktiv plan-run.
   * Returnerer null hvis catalog-spillet ikke krever override eller hvis
   * override ikke er satt ennå.
   */
  async getJackpotConfigForPosition(
    runId: string,
    position: number,
  ): Promise<JackpotOverride | null> {
    if (!runId.trim()) {
      throw new DomainError("INVALID_INPUT", "runId er påkrevd.");
    }
    if (
      !Number.isFinite(position) ||
      !Number.isInteger(position) ||
      position < 1
    ) {
      throw new DomainError(
        "INVALID_INPUT",
        "position må være positivt heltall.",
      );
    }
    // Hent run direkte. Vi går rundt run-service her fordi vi trenger raw
    // jackpotOverrides per position-key (ikke wire-format).
    const { rows } = await this.pool.query<{
      jackpot_overrides_json: unknown;
    }>(
      `SELECT jackpot_overrides_json
       FROM "${this.schema}"."app_game_plan_run"
       WHERE id = $1`,
      [runId.trim()],
    );
    if (!rows[0]) {
      throw new DomainError(
        "GAME_PLAN_RUN_NOT_FOUND",
        `Run ${runId} finnes ikke.`,
      );
    }
    const overrides = rows[0].jackpot_overrides_json;
    if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
      return null;
    }
    const key = String(position);
    const raw = (overrides as Record<string, unknown>)[key];
    if (!raw || typeof raw !== "object") return null;
    const obj = raw as Record<string, unknown>;
    const drawN = Number(obj.draw);
    if (!Number.isFinite(drawN)) return null;
    let prizesRaw: unknown = obj.prizesCents;
    if (prizesRaw === undefined) prizesRaw = obj.prizes_cents;
    if (!prizesRaw || typeof prizesRaw !== "object") return null;
    const prizes: Partial<Record<TicketColor, number>> = {};
    for (const [k, v] of Object.entries(prizesRaw as Record<string, unknown>)) {
      const n = Number(v);
      if (Number.isFinite(n) && Number.isInteger(n) && n >= 0) {
        prizes[k as TicketColor] = n;
      }
    }
    return { draw: drawN, prizesCents: prizes };
  }

  /**
   * Opprett en `app_game1_scheduled_games`-rad fra en plan-run-posisjon.
   * Idempotent på (plan_run_id, plan_position).
   *
   * Returnerer scheduledGameId som kan sendes til
   * `Game1MasterControlService.startGame({ gameId })`.
   *
   * Pre-conditions:
   *   - Run må finnes for runId.
   *   - Plan må ha et item på position.
   *   - Hvis catalog-spillet krever jackpot-setup, må override være satt
   *     i run.jackpot_overrides_json[String(position)] — ellers kastes
   *     `JACKPOT_SETUP_REQUIRED`.
   */
  async createScheduledGameForPlanRunPosition(
    runId: string,
    position: number,
  ): Promise<CreateScheduledGameResult> {
    if (!runId.trim()) {
      throw new DomainError("INVALID_INPUT", "runId er påkrevd.");
    }
    if (
      !Number.isFinite(position) ||
      !Number.isInteger(position) ||
      position < 1
    ) {
      throw new DomainError(
        "INVALID_INPUT",
        "position må være positivt heltall.",
      );
    }

    // Hent run-rad direkte (uten å bruke run-service-mapping) for å få
    // alle relevante felter på én gang.
    const { rows: runRows } = await this.pool.query<{
      id: string;
      plan_id: string;
      hall_id: string;
      business_date: unknown;
      jackpot_overrides_json: unknown;
    }>(
      `SELECT id, plan_id, hall_id, business_date, jackpot_overrides_json
       FROM "${this.schema}"."app_game_plan_run"
       WHERE id = $1`,
      [runId.trim()],
    );
    const run = runRows[0];
    if (!run) {
      throw new DomainError(
        "GAME_PLAN_RUN_NOT_FOUND",
        `Run ${runId} finnes ikke.`,
      );
    }

    // Idempotens-sjekk: finnes en AKTIV rad for (run, position)?
    //
    // PITFALLS §4.4-fix (2026-05-12): vi MÅ filtrere bort `cancelled` og
    // `completed` rader. Pre-fix-bug var:
    //   - master stopGame → status='cancelled', actual_end_time satt
    //   - master advance/start på samme posisjon (samme runde-loop, eller
    //     etter crash-recovery) → idempotens-SELECT plukket opp den
    //     cancelled raden → returnerte `reused: true` → klient prøvde å
    //     markere ready på cancelled rad → `GAME_NOT_READY_ELIGIBLE`
    // Samme problem oppstår med `completed` rader: en posisjon som har
    // kjørt ferdig naturlig kan ikke gjenbrukes som idempotency-hit.
    //
    // Aktive statuser hvor idempotency-reuse er korrekt:
    //   'scheduled' | 'purchase_open' | 'ready_to_start' | 'running' | 'paused'
    //
    // Status-listen speiler partial-unique-indeksen
    // `idx_app_game1_scheduled_games_room_code` (migration
    // 20261221000000_app_game1_scheduled_games_room_code_active_only)
    // som bruker SAMME `status NOT IN ('completed','cancelled')`
    // filter — vi er konsistent med DB-invarianten.
    const { rows: existing } = await this.pool.query<{
      id: string;
      catalog_entry_id: string | null;
    }>(
      `SELECT id, catalog_entry_id
       FROM ${this.scheduledGamesTable()}
       WHERE plan_run_id = $1
         AND plan_position = $2
         AND status NOT IN ('cancelled', 'completed')
       LIMIT 1`,
      [run.id, position],
    );
    if (existing[0]) {
      // Re-fetch catalog så vi kan returnere full entry. Det kan ha endret
      // seg siden raden ble opprettet (admin har redigert), men vi binder
      // engine til den ORIGINALE catalog_entry_id for sporbarhet.
      const catalogId = existing[0].catalog_entry_id;
      if (!catalogId) {
        throw new DomainError(
          "GAME_PLAN_RUN_CORRUPT",
          `Eksisterende scheduled-game ${existing[0].id} mangler catalog_entry_id.`,
        );
      }
      const catalog = await this.catalogService.getById(catalogId);
      if (!catalog) {
        throw new DomainError(
          "GAME_CATALOG_NOT_FOUND",
          `Catalog-entry ${catalogId} finnes ikke (slettet?).`,
        );
      }
      log.info(
        { runId: run.id, position, scheduledGameId: existing[0].id },
        "[fase-4] gjenbruker eksisterende scheduled-game-rad (idempotent retry)",
      );
      return {
        scheduledGameId: existing[0].id,
        catalogEntry: catalog,
        reused: true,
      };
    }

    // Hent plan + items
    const plan = await this.planService.getById(run.plan_id);
    if (!plan) {
      throw new DomainError(
        "GAME_PLAN_NOT_FOUND",
        `Plan ${run.plan_id} finnes ikke (slettet etter run-create).`,
      );
    }
    const item = plan.items.find((i) => i.position === position);
    if (!item) {
      throw new DomainError(
        "INVALID_INPUT",
        `Plan ${plan.id} har ingen item på posisjon ${position}.`,
      );
    }
    const catalog = item.catalogEntry;

    // Sjekk jackpot-setup
    let jackpotOverride: JackpotOverride | null = null;
    if (catalog.requiresJackpotSetup) {
      const overridesRaw = run.jackpot_overrides_json;
      if (
        overridesRaw &&
        typeof overridesRaw === "object" &&
        !Array.isArray(overridesRaw)
      ) {
        const key = String(position);
        const raw = (overridesRaw as Record<string, unknown>)[key];
        if (raw && typeof raw === "object") {
          const obj = raw as Record<string, unknown>;
          const drawN = Number(obj.draw);
          let prizesRaw: unknown = obj.prizesCents;
          if (prizesRaw === undefined) prizesRaw = obj.prizes_cents;
          if (
            Number.isFinite(drawN) &&
            prizesRaw &&
            typeof prizesRaw === "object" &&
            !Array.isArray(prizesRaw)
          ) {
            const prizes: Partial<Record<TicketColor, number>> = {};
            for (const [k, v] of Object.entries(
              prizesRaw as Record<string, unknown>,
            )) {
              const n = Number(v);
              if (Number.isFinite(n) && Number.isInteger(n) && n >= 0) {
                prizes[k as TicketColor] = n;
              }
            }
            jackpotOverride = { draw: drawN, prizesCents: prizes };
          }
        }
      }
      if (!jackpotOverride) {
        throw new DomainError(
          "JACKPOT_SETUP_REQUIRED",
          `Catalog ${catalog.slug} krever jackpot-setup, men override mangler for posisjon ${position}.`,
          { position, catalogId: catalog.id, catalogSlug: catalog.slug },
        );
      }
    }

    // Bygg konfig-objekter. H1-fix (2026-05-07): jackpot embedded-es i
    // ticket_config_json under `spill1.jackpot`-pathen så
    // `resolveJackpotConfig` finner det. Jackpot-config-kolonnen får
    // fortsatt en kopi for backward-compat med admin-tooling, men engine
    // konsumerer den ikke.
    //
    // Tolkning A (2026-05-07): per-item bonus-override fra plan-item
    // overstyrer catalog.bonusGameSlug. NULL → fallback til catalog.
    const bonusOverride = item.bonusGameOverride;
    const ticketConfig = buildEngineTicketConfig(
      catalog,
      jackpotOverride,
      bonusOverride,
    );
    const jackpotConfig = buildJackpotConfigFromOverride(jackpotOverride);

    // Pilot-fix (2026-05-08): `game_config_json` må bære
    // `spill1.ticketColors[]`-blokken slik at engine sin variant-mapper
    // (`buildVariantConfigFromGameConfigJson`) bygger en `patternsByColor[]`
    // og payout-pathen returnerer faktisk øre-beløp via Q3=X-pot per
    // første-vinners-farge. NULL/missing → engine faller til flat-path
    // (`resolvePhaseConfig`-percent), som gir 0-payout for catalog-spill.
    //
    // Vi bruker ticketConfig direkte: den inneholder allerede
    // `spill1.ticketColors[]` og `spill1.jackpot` (om relevant).
    // game_config_json er tradisjonelt en KOPI av
    // GameManagement.config_json — for catalog-spill er bridgen den
    // autoritative kilden, så vi peker game_config_json til samme
    // struktur. Engine vil hente jackpot fra ticket_config_json eller
    // game_config_json, så de er funksjonelt ekvivalente per fil.
    const gameConfigJson = JSON.stringify(ticketConfig);

    // Hent hall-group som hallen tilhører (engine forventer group_hall_id).
    // Kaster HALL_NOT_IN_GROUP hvis hallen ikke er medlem av aktiv gruppe.
    const groupHallId = await this.resolveGroupHallId(run.hall_id);

    // 2026-05-08 (Tobias-feedback): hvis GoH har et pinned master-hall,
    // bruk det som master uavhengig av hvilken hall sin agent som starter
    // plan-run-en. Service-laget håndhever at master er medlem av gruppen,
    // men vi double-checker mot resolveParticipatingHallIds som filtrer
    // inaktive haller — hvis GoH-master er deaktivert, faller vi tilbake
    // til run.hall_id (defensiv fallback). Hvis ingen pin er satt
    // (NULL/undefined), bevarer vi legacy-atferd hvor agentens hall blir
    // master.
    const goHMasterPin = await this.resolveGoHMasterHallId(groupHallId);
    let effectiveMasterHallId = run.hall_id;
    if (goHMasterPin !== null) {
      effectiveMasterHallId = goHMasterPin;
      log.info(
        {
          runId: run.id,
          position,
          runHallId: run.hall_id,
          pinnedMaster: goHMasterPin,
          groupHallId,
        },
        "[GoH-master-pin] bruker GoH master_hall_id istedenfor run.hall_id",
      );
    }

    // Multi-hall (2026-05-08): ekspandér participating_halls til ALLE
    // aktive haller i gruppen, med masteren først. Tidligere var dette
    // hardkodet til [run.hall_id] (single-hall) — det brøt cross-hall-
    // spill der Bodø/Brumunddal/Fauske skulle delta sammen med Årnes-
    // master. Solo-grupper (1 medlem) returnerer fortsatt [hallId] og
    // oppfører seg som single-hall.
    const participatingHalls = await this.resolveParticipatingHallIds(
      effectiveMasterHallId,
      groupHallId,
    );

    // scheduled_start_time = NOW (engine starter umiddelbart). End_time =
    // now + DEFAULT_PURCHASE_WINDOW_SECONDS. Disse styrer ikke draw-rytmen,
    // bare scheduler-tick-vinduer.
    const now = new Date();
    const startTs = now.toISOString();
    const endTs = new Date(
      now.getTime() + DEFAULT_PURCHASE_WINDOW_SECONDS * 1000,
    ).toISOString();
    const businessDateKey = this.dateRowToKey(run.business_date);

    // F-NEW-2 (E2E pilot-blokker, 2026-05-09): generer room_code OPP-FRONT så
    // master.start binder scheduled-game til en forutsigbar BingoEngine-rom-
    // kode med en gang. Tidligere ble room_code satt lazy av
    // `joinScheduledGame`-socket-handler ved første spiller-join (PR 4d.1
    // designvalg) — det betød at dersom master startet engine FØR noen
    // joinet, hadde scheduled-game status='running' men room_code=NULL.
    // Konsekvens: klienter kunne ikke joine fordi ingen kode fantes å slå
    // opp på, og auto-draw-tick trakk baller for boot-recovery-rom som
    // ikke matchet vår master-startede runde.
    //
    // Vi bruker `getCanonicalRoomCode("bingo", masterHallId, groupHallId)`
    // som returnerer `BINGO_<groupId>` for hall-grupper og `BINGO_<hallId>`
    // for solo-haller — samme deterministiske mapping som
    // `joinScheduledGame` bruker for å sikre at lazy-join-pathen og
    // bridge-spawn-pathen havner på SAMME rom-kode.
    //
    // Race-håndtering: `idx_app_game1_scheduled_games_room_code`-unique
    // index hindrer at to scheduled-games kan ha samme room_code samtidig.
    // For BINGO_<groupId>-koder (per-link, shared mellom haller i samme
    // gruppe) kan flere scheduled-games eksistere over tid (én pr posisjon
    // i plan-runtime, sekvensielt), men kun ÉN i taget kan ha aktiv
    // room_code.
    //
    // Index-scope (2026-05-11 fix — migration 20261221000000): unique-
    // index gjelder KUN aktive rader (status NOT IN ('completed',
    // 'cancelled')). Det betyr at gjenbruk av samme room_code er trygt
    // når forrige runde er ferdig — typisk auto-master-loop og pilot
    // advance() etter completed runde. Tidligere blokkerte index-en
    // alle historiske rader, som tvang oss til lazy-binding-fallback
    // (room_code=NULL) ved gjenbruk.
    //
    // Hvis to bridge-spawns racer på SAMME canonical room_code mens
    // BEGGE er aktive (svært usannsynlig — hver plan-position drives
    // sekvensielt av master, men kunne skje ved overlappende plan-runs
    // for samme hall + GoH), faller den andre til catch-blokken under
    // (unique-violation 23505) og vi degraderer til lazy-binding for å
    // beholde robusthet. Dette er nå en ekte race, ikke en gjenbruks-
    // konflikt.
    const canonical = getCanonicalRoomCode(
      "bingo",
      effectiveMasterHallId,
      groupHallId,
    );
    const roomCode = canonical.roomCode;

    // F-NEW-3 (Tobias-direktiv 2026-05-12, pilot-blokker): "ta over"
    // hall-default-rommet. Før INSERT — release alle stale aktive
    // scheduled-game-rader som holder samme kanoniske `room_code` men
    // peker på en ANNEN (plan_run_id, plan_position). Disse er typisk
    // orphaner fra:
    //   - Tidligere test-sesjoner hvor engine krasjet uten å markere
    //     `completed/cancelled`
    //   - DemoAutoMasterTickService som loopet runder raskt og lot rader
    //     henge i `running`/`ready_to_start`
    //   - PR #1116-retry-paths som spawnet rad men feilet på engine-start
    //
    // Idempotency-sjekk over (linje ~844) håndterer SAMME (run_id, position)
    // separat — den runner og vi har allerede returnert hvis det finnes.
    // Her tar vi over `room_code` fra ANDRE rader som ikke matcher oss.
    //
    // Audit-spor: hver auto-cancellert rad får `stop_reason =
    // 'auto_cancelled_by_bridge_takeover'` + en `app_game1_master_audit`-
    // entry med action='stop' og metadata pekende på den nye scheduled-
    // game-en som tar over. Lotteritilsynet kan rekonstruere kjeden:
    // gammel rad → release → ny rad → spill.
    //
    // Etter release-pass har unique-indeksen `idx_app_game1_scheduled_
    // games_room_code` (partial: WHERE status NOT IN
    // ('completed','cancelled')) ingen conflict, og INSERT med
    // `room_code = canonical.roomCode` lykkes.
    const releasedStaleIds = await this.releaseStaleRoomCodeBindings(
      roomCode,
      run.id,
      position,
      effectiveMasterHallId,
      groupHallId,
    );

    const newId = randomUUID();
    let assignedRoomCode: string | null = roomCode;
    try {
      await this.pool.query(
        `INSERT INTO ${this.scheduledGamesTable()}
           (id,
            sub_game_index,
            sub_game_name,
            custom_game_name,
            scheduled_day,
            scheduled_start_time,
            scheduled_end_time,
            notification_start_seconds,
            ticket_config_json,
            jackpot_config_json,
            game_mode,
            master_hall_id,
            group_hall_id,
            participating_halls_json,
            status,
            game_config_json,
            catalog_entry_id,
            plan_run_id,
            plan_position,
            room_code)
         VALUES ($1, $2, $3, $4, $5::date, $6::timestamptz, $7::timestamptz,
                 $8, $9::jsonb, $10::jsonb, $11, $12, $13, $14::jsonb,
                 'ready_to_start', $15::jsonb, $16, $17, $18, $19)`,
        [
          newId,
          // sub_game_index — vi bruker plan_position-1 (0-basert)
          position - 1,
          // sub_game_name
          catalog.displayName,
          // custom_game_name
          null,
          businessDateKey,
          startTs,
          endTs,
          DEFAULT_NOTIFICATION_SECONDS,
          JSON.stringify(ticketConfig),
          JSON.stringify(jackpotConfig),
          // game_mode — Manual fordi master driver framgang i katalog-modellen
          "Manual",
          effectiveMasterHallId,
          groupHallId,
          JSON.stringify(participatingHalls),
          // Pilot-fix (2026-05-08): game_config_json bærer
          // spill1.ticketColors[]-blokken så engine bygger patternsByColor.
          gameConfigJson,
          catalog.id,
          run.id,
          position,
          // F-NEW-2 (2026-05-09) / F-NEW-3 (2026-05-12): room_code satt
          // opp-front. F-NEW-3 release-pass over har auto-cancellert
          // konflikt-rader så denne INSERT lykkes uten 23505-fallback.
          roomCode,
        ],
      );
    } catch (err) {
      const code = (err as { code?: string } | null)?.code ?? "";
      if (code === "23503") {
        // FK-violation — sannsynligvis hall eller hall-group mangler
        throw new DomainError(
          "GAME_PLAN_RUN_CORRUPT",
          `Kan ikke spawne scheduled-game: hall (${effectiveMasterHallId}) eller hall-group (${groupHallId}) ikke funnet.`,
        );
      }
      if (code === "23505") {
        // F-NEW-3 race-håndtering (2026-05-12): unique-violation tross
        // release-pass over. Mulige rot-årsaker:
        //   - Parallell bridge-spawn racet vår release-pass (en annen agent/
        //     prosess tok room_code etter SELECT, før INSERT)
        //   - Race-vinneren binder room_code til ANNEN (run, position)
        //
        // Vi retry-er release-pass ÉN gang for å fange evt. nye stale
        // rader, deretter retry-er INSERT. Hvis det fortsatt feiler,
        // kaster vi `ROOM_CODE_CONFLICT` med actionable metadata —
        // dette er en ekte race vi ikke skal degradere stille til
        // `room_code=null` (som brøt pilot-flyten pre-F-NEW-3).
        log.warn(
          {
            runId: run.id,
            position,
            attemptedRoomCode: roomCode,
            releasedStaleIds,
            err: err instanceof Error ? err.message : String(err),
          },
          "[F-NEW-3] room_code 23505 etter release-pass — retrying release+INSERT en gang",
        );
        const retryReleased = await this.releaseStaleRoomCodeBindings(
          roomCode,
          run.id,
          position,
          effectiveMasterHallId,
          groupHallId,
        );
        try {
          await this.pool.query(
            `INSERT INTO ${this.scheduledGamesTable()}
               (id,
                sub_game_index,
                sub_game_name,
                custom_game_name,
                scheduled_day,
                scheduled_start_time,
                scheduled_end_time,
                notification_start_seconds,
                ticket_config_json,
                jackpot_config_json,
                game_mode,
                master_hall_id,
                group_hall_id,
                participating_halls_json,
                status,
                game_config_json,
                catalog_entry_id,
                plan_run_id,
                plan_position,
                room_code)
             VALUES ($1, $2, $3, $4, $5::date, $6::timestamptz, $7::timestamptz,
                     $8, $9::jsonb, $10::jsonb, $11, $12, $13, $14::jsonb,
                     'ready_to_start', $15::jsonb, $16, $17, $18, $19)`,
            [
              newId,
              position - 1,
              catalog.displayName,
              null,
              businessDateKey,
              startTs,
              endTs,
              DEFAULT_NOTIFICATION_SECONDS,
              JSON.stringify(ticketConfig),
              JSON.stringify(jackpotConfig),
              "Manual",
              effectiveMasterHallId,
              groupHallId,
              JSON.stringify(participatingHalls),
              gameConfigJson,
              catalog.id,
              run.id,
              position,
              roomCode,
            ],
          );
          log.info(
            {
              runId: run.id,
              position,
              roomCode,
              firstReleasedStaleIds: releasedStaleIds,
              retryReleasedStaleIds: retryReleased,
            },
            "[F-NEW-3] retry-INSERT lyktes etter andre release-pass",
          );
        } catch (retryErr) {
          const retryCode = (retryErr as { code?: string } | null)?.code ?? "";
          if (retryCode === "23505") {
            // Ekte race vi ikke kan løse uten å klusse med en aktiv
            // konkurrerende run. Kast tydelig feil så master kan re-prøve
            // (MasterActionService har retry-with-rollback for transient
            // DB-feil).
            throw new DomainError(
              "ROOM_CODE_CONFLICT",
              `Kan ikke binde scheduled-game til kanonisk room_code "${roomCode}" — ` +
                `en annen aktiv scheduled-game holder samme kode tross release-pass. ` +
                `Master må re-prøve eller admin må manuelt cancele konflikt-raden.`,
              {
                runId: run.id,
                position,
                attemptedRoomCode: roomCode,
                firstReleasedStaleIds: releasedStaleIds,
                retryReleasedStaleIds: retryReleased,
              },
            );
          }
          throw retryErr;
        }
      } else {
        throw err;
      }
    }

    log.info(
      {
        runId: run.id,
        position,
        scheduledGameId: newId,
        catalogId: catalog.id,
        catalogSlug: catalog.slug,
        hallId: run.hall_id,
        masterHallId: effectiveMasterHallId,
        masterHallPinned: goHMasterPin !== null,
        roomCode: assignedRoomCode,
      },
      "[fase-4] opprettet scheduled-game-rad fra plan-run + catalog",
    );

    // F2 (BUG-F2 2026-05-14): pre-engine ticket-config-binding-hook.
    // Mirrer `Game1MasterControlService.onEngineStarted` (PR #1375) men
    // kjører POST-INSERT, FØR engine.startGame trigges av master. Dekker
    // pre-game-vinduet hvor spillere kan kjøpe bonger via buy-popup —
    // uten denne hooken faller `gameVariant.ticketTypes` til flat
    // `priceMultiplier: 1` for alle farger, og klient viser 20 kr for
    // Yellow (10 × yellow-multiplier(2) = 20) istedenfor riktige 10 kr.
    //
    // Soft-fail: hook-feil må IKKE bli til bridge-feil. Master har
    // fortsatt en gyldig scheduled-game-id, og post-engine-hooken (#1375)
    // vil re-binde verdiene når master starter. Worst case: klient
    // viser default-priser i pre-game-vinduet.
    //
    // Idempotens: For ny scheduled-game-rad er roomCode garantert ikke-
    // null (vi har nettopp INSERT-et med kanonisk room_code), så hooken
    // kan binde umiddelbart. Re-binding for samme roomCode er en no-op
    // fra klient-perspektiv (samme verdi → samme room-snapshot).
    if (this.onScheduledGameCreated && assignedRoomCode) {
      try {
        const ticketConfigForHook = ticketConfig;
        await Promise.resolve(
          this.onScheduledGameCreated({
            scheduledGameId: newId,
            roomCode: assignedRoomCode,
            ticketConfigJson: ticketConfigForHook,
          }),
        );
      } catch (hookErr) {
        log.warn(
          {
            err: hookErr,
            runId: run.id,
            position,
            scheduledGameId: newId,
            roomCode: assignedRoomCode,
          },
          "[F2 onScheduledGameCreated] hook kastet — ignorert (entry-fee/variant-config ikke bundet pre-engine, klient kan vise default-priser inntil onEngineStarted re-binder)",
        );
      }
    }

    return {
      scheduledGameId: newId,
      catalogEntry: catalog,
      reused: false,
    };
  }

  /**
   * Hent alle aktive haller i en gruppe, med masteren først.
   *
   * Bruker INNER JOIN mot `app_halls` for å filtrere bort:
   *   - Soft-delete: `app_halls` har ingen `deleted_at`-kolonne, men
   *     `is_active=false` betyr at hallen er deaktivert (legacy + ny
   *     soft-delete-konvensjon brukes om hverandre, så vi sjekker begge
   *     hvis en `deleted_at`-kolonne legges til senere).
   *   - Hall-rader som har blitt slettet (FK ON DELETE CASCADE rydder
   *     opp medlemskap automatisk, så dette er en defensiv sjekk).
   *
   * Sortering: master først (definert via CASE WHEN), deretter
   * `m.added_at ASC`. `DISTINCT` sikrer dedup ved utilsiktede dobbel-
   * medlemskap (skal ikke skje pga. PRIMARY KEY (group_id, hall_id),
   * men robusthet er gratis her).
   *
   * Edge-cases:
   *   - Solo-gruppe (kun masteren): returnerer [masterHallId].
   *   - Master ikke i gruppen: kaster MASTER_NOT_IN_GROUP. Skal aldri
   *     skje fordi groupHallId er resolvet via masterens medlemskap,
   *     men vi er defensive.
   *   - Alle medlemmer inaktive: kaster NO_ACTIVE_HALLS_IN_GROUP.
   */
  private async resolveParticipatingHallIds(
    masterHallId: string,
    groupHallId: string,
  ): Promise<string[]> {
    // Bølge 5 (2026-05-08): bruker konsolidert HallGroupMembershipQuery
    // istedenfor inline SQL. Helper-en filtrerer allerede inaktive haller
    // (`h.is_active = true` i JOIN) og sorterer pinned master først.
    //
    // Bridge-spesifikk logikk som beholdes her:
    //   - `masterHallId` kan være `run.hall_id` (legacy-fallback) ELLER
    //     pinned `goh.master_hall_id` — vi sorterer ALLTID den effektive
    //     masteren først, ikke nødvendigvis GoH-pinnen.
    //   - Tom liste → NO_ACTIVE_HALLS_IN_GROUP (bridge-spesifikk feil).
    //   - Master ikke i listen → MASTER_NOT_IN_GROUP (defensiv sjekk).
    //
    // Soft-fail: helper-en kaster DomainError("DB_ERROR") ved DB-feil;
    // bridgen lar feilen propagere til BRIDGE_FAILED-pathen i caller.
    const members = await this.membershipQuery.getActiveMembers(groupHallId);

    if (members === null || members.length === 0) {
      throw new DomainError(
        "NO_ACTIVE_HALLS_IN_GROUP",
        `Hall-gruppe ${groupHallId} har ingen aktive haller. Bridge kan ikke spawne spill uten minst én aktiv hall.`,
      );
    }

    // Re-sortér: effektiv master (kan avvike fra pinned master) først,
    // resten i den rekkefølgen helper-en allerede ga (alfabetisk på
    // hall-navn → deterministisk).
    const ids: string[] = [];
    const seen = new Set<string>();
    let masterFound = false;
    for (const m of members) {
      if (m.hallId === masterHallId) masterFound = true;
    }
    if (masterFound) {
      ids.push(masterHallId);
      seen.add(masterHallId);
    }
    for (const m of members) {
      if (!seen.has(m.hallId)) {
        ids.push(m.hallId);
        seen.add(m.hallId);
      }
    }

    if (!masterFound) {
      throw new DomainError(
        "MASTER_NOT_IN_GROUP",
        `Master-hallen ${masterHallId} er ikke aktivt medlem av gruppe ${groupHallId}.`,
      );
    }

    return ids;
  }

  /**
   * Plukk en hall-gruppe for hallen. Engine krever group_hall_id, men
   * single-hall katalog-runs har ikke en eksplisitt gruppe. Vi velger
   * første aktive medlemskap, eller fallback til en eksisterende gruppe
   * som inneholder hallen.
   */
  private async resolveGroupHallId(hallId: string): Promise<string> {
    // Bølge 5 (2026-05-08): bruker konsolidert HallGroupMembershipQuery
    // istedenfor inline SQL. Helper-en gjør samme query (oldest aktive
    // medlemskap) og returnerer null hvis ingen finnes — bridgen
    // konverterer til HALL_NOT_IN_GROUP-DomainError for klart UX-budskap.
    const groupId = await this.membershipQuery.findGroupForHall(hallId);
    if (groupId !== null) return groupId;
    throw new DomainError(
      "HALL_NOT_IN_GROUP",
      `Hallen ${hallId} er ikke medlem av en aktiv hall-gruppe. Catalog-modellen krever at hallen tilhører minst én gruppe for å starte spill.`,
    );
  }

  /**
   * 2026-05-08 (Tobias-feedback): Hent pinned master_hall_id for en GoH.
   * Returnerer NULL hvis kolonnen er NULL eller hallen er deaktivert
   * (`is_active = false`). Defensive fallback — hvis admin har pekt master
   * mot en hall som senere ble deaktivert, må bridgen falle tilbake til
   * run.hall_id istedenfor å feile spawn-en.
   */
  private async resolveGoHMasterHallId(
    groupHallId: string,
  ): Promise<string | null> {
    const { rows } = await this.pool.query<{ master_hall_id: string | null }>(
      `SELECT g.master_hall_id
       FROM "${this.schema}"."app_hall_groups" g
       LEFT JOIN "${this.schema}"."app_halls" h ON h.id = g.master_hall_id
       WHERE g.id = $1
         AND g.deleted_at IS NULL
         AND g.status = 'active'
         AND (g.master_hall_id IS NULL OR h.is_active = true)`,
      [groupHallId],
    );
    if (rows.length === 0) return null;
    return rows[0]!.master_hall_id;
  }

  private dateRowToKey(value: unknown): string {
    if (typeof value === "string") {
      return value.length >= 10 ? value.slice(0, 10) : value;
    }
    if (value instanceof Date) {
      const yyyy = value.getUTCFullYear();
      const mm = String(value.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(value.getUTCDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    }
    return "0000-00-00";
  }

  /**
   * F-NEW-3 (Tobias-direktiv 2026-05-12): "ta over" hall-default-rommet.
   *
   * Finn og auto-cancel ALLE stale aktive scheduled-game-rader som holder
   * den kanoniske `roomCode`, slik at INSERT med room_code lykkes.
   *
   * Sammenhengen:
   *   - Unique-indeksen `idx_app_game1_scheduled_games_room_code` (migration
   *     20261221000000) er partial: `WHERE room_code IS NOT NULL AND status
   *     NOT IN ('completed','cancelled')`. Den hindrer at to AKTIVE rader
   *     deler samme room_code.
   *   - Når en tidligere runde krasjet eller `MasterActionService` re-spawnet
   *     uten å advance-e planen, kan en gammel rad henge i `running`/
   *     `purchase_open`/`ready_to_start`/`paused`/`scheduled` med
   *     den kanoniske koden. Det blokkerer ny INSERT.
   *   - Vi cancel-er disse rader (status → 'cancelled') og skriver audit-
   *     entry så Lotteritilsynet kan rekonstruere kjeden.
   *
   * Idempotent: hvis rad ALLEREDE er cancelled/completed, ekskluderes den
   * av WHERE-klausulen. Hvis vi kjører to ganger parallelt, racer den ene
   * SELECT-en, men UPDATE-WHERE-status-filteret håndhever at vi ikke
   * dobbel-canceller.
   *
   * SQL-NULL-fix (2026-05-12 hotfix): Vi DROPPER tidligere
   * `NOT (plan_run_id = $2 AND plan_position = $3)`-klausul. Den filtrerte
   * IKKE bort vår egen (run, pos) NÅR plan_run_id IS NULL — fordi
   * `NULL = 'xyz'` evaluerer til NULL i SQL, `NOT NULL` evaluerer til
   * NULL, og rader med NULL-resultat ekskluderes fra WHERE som om de
   * var FALSE. Stale rader med `plan_run_id IS NULL` (eks. legacy-rader
   * spawnet via fail-fast-pathen før plan-binding) ble dermed AKSEPTERT
   * av WHERE som "matcher current (run, pos)" og UTELATT fra release-
   * passet. Resultat: tom `releasedStaleIds`-array → INSERT feiler med
   * 23505 fordi den blokkerende raden ikke ble cancellet.
   *
   * Riktig modell: idempotency-sjekken FØR denne metoden (linje ~863)
   * filtrerer for `plan_run_id = $1 AND plan_position = $2 AND status
   * NOT IN ('cancelled','completed')`. Hvis den fant en match, har vi
   * allerede returnert `reused: true` og caller når ALDRI release-pass.
   * Når vi når release-pass, er det garantert at det IKKE finnes aktiv
   * rad for vår egen (run, pos) — dermed er ALLE aktive rader med samme
   * room_code per definisjon stale og skal cancelleres.
   *
   * Audit: hver cancellet rad får en `app_game1_master_audit`-entry med
   * action='stop', actor='SYSTEM', og metadata pekende på årsaken +
   * den nye scheduled-game-en som tar over.
   *
   * Returnerer arrayen av cancelled scheduled-game-IDer (kan være tom).
   * Soft-fail: hvis audit-skriving feiler, logges det men UPDATE rulles
   * IKKE tilbake — å beholde room_code-conflict-en er verre enn et
   * audit-hull (som ledger fortsatt fanger via wallet-events).
   */
  private async releaseStaleRoomCodeBindings(
    roomCode: string,
    currentRunId: string,
    currentPosition: number,
    newMasterHallId: string,
    newGroupHallId: string,
  ): Promise<string[]> {
    // 1. Finn ALLE stale aktive rader med samme room_code.
    //    Filter på samme status-set som unique-indeksen ekskluderer
    //    'completed','cancelled' fra (slik at vi kun targeterer rader som
    //    faktisk blokkerer INSERT).
    //
    //    Vi filtrerer IKKE bort vår egen (run, pos) i SQL — idempotency-
    //    sjekken har allerede ekskludert den. Se JSDoc over for forklaring
    //    av SQL-NULL-bugen som motiverte denne forenklingen.
    const { rows: staleRows } = await this.pool.query<{
      id: string;
      status: string;
      plan_run_id: string | null;
      plan_position: number | null;
      master_hall_id: string;
      group_hall_id: string;
    }>(
      `SELECT id, status, plan_run_id, plan_position,
              master_hall_id, group_hall_id
         FROM ${this.scheduledGamesTable()}
        WHERE room_code = $1
          AND status NOT IN ('completed', 'cancelled')`,
      [roomCode],
    );

    if (staleRows.length === 0) return [];

    const cancelledIds: string[] = [];
    for (const stale of staleRows) {
      // 2. UPDATE → cancelled. Filter på status-set igjen for race-safety
      //    (mellom SELECT og UPDATE kan en annen prosess ha cancellet den).
      const { rows: updated } = await this.pool.query<{ id: string }>(
        `UPDATE ${this.scheduledGamesTable()}
            SET status              = 'cancelled',
                stopped_by_user_id  = 'SYSTEM',
                stop_reason         = 'auto_cancelled_by_bridge_takeover',
                actual_end_time     = COALESCE(actual_end_time, now()),
                updated_at          = now()
          WHERE id = $1
            AND status NOT IN ('completed', 'cancelled')
          RETURNING id`,
        [stale.id],
      );
      if (updated.length === 0) {
        // Race-vinner cancellet den allerede — det er OK.
        log.info(
          { staleGameId: stale.id, roomCode },
          "[F-NEW-3] stale row already cancelled by concurrent process — skip",
        );
        continue;
      }
      cancelledIds.push(stale.id);

      // 3. Skriv audit-entry. Bruker `app_game1_master_audit`-tabellen
      //    samme som `Game1RecoveryService.cancelOverdueGame` for konsis
      //    audit-pattern. Soft-fail: feil i audit-INSERT skal IKKE rulle
      //    tilbake UPDATE-en — wallet/compliance-laget skriver egne
      //    ledger-entries uavhengig av denne audit-en.
      try {
        await this.pool.query(
          `INSERT INTO "${this.schema}"."app_game1_master_audit"
             (id, game_id, action, actor_user_id, actor_hall_id,
              group_hall_id, halls_ready_snapshot, metadata_json)
           VALUES ($1, $2, 'stop', 'SYSTEM', $3, $4,
                   '{}'::jsonb, $5::jsonb)`,
          [
            randomUUID(),
            stale.id,
            stale.master_hall_id,
            stale.group_hall_id,
            JSON.stringify({
              reason: "auto_cancelled_by_bridge_takeover",
              priorStatus: stale.status,
              cancelledByRunId: currentRunId,
              cancelledByPosition: currentPosition,
              newMasterHallId,
              newGroupHallId,
              roomCode,
              autoCancelledAt: new Date().toISOString(),
            }),
          ],
        );
      } catch (auditErr) {
        log.warn(
          {
            err: auditErr,
            staleGameId: stale.id,
            roomCode,
          },
          "[F-NEW-3] audit-INSERT feilet etter cancel — UPDATE er committed, fortsetter",
        );
      }

      log.warn(
        {
          staleGameId: stale.id,
          stalePriorStatus: stale.status,
          stalePlanRunId: stale.plan_run_id,
          stalePlanPosition: stale.plan_position,
          roomCode,
          newRunId: currentRunId,
          newPosition: currentPosition,
        },
        "[F-NEW-3] auto-cancelled stale scheduled-game som blokkerte room_code",
      );
    }

    return cancelledIds;
  }
}
