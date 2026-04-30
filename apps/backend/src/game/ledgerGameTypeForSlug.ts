/**
 * K2-A regulatorisk fix (CRIT-1): per-spill `LedgerGameType`-resolver.
 *
 * Erstatter hardkodede `gameType: "DATABINGO"`-call-sites for Spill 1/2/3.
 * Returnerer `MAIN_GAME` for Spill 1-3 (hovedspill), `DATABINGO` for SpinnGo
 * (slug `spillorama`).
 *
 * Regulatorisk kontekst (docs/architecture/SPILLKATALOG.md, PM-låst 2026-04-25):
 *   - Spill 1 (`bingo` / `game_1`)              → hovedspill (15% til organisasjoner)
 *   - Spill 2 (`rocket` / `game_2` / `tallspill`) → hovedspill (15% til organisasjoner)
 *   - Spill 3 (`monsterbingo` / `mønsterbingo`
 *              / `game_3`)                     → hovedspill (15% til organisasjoner)
 *   - SpinnGo (`spillorama` / `game_5`)        → databingo  (30% til organisasjoner)
 *
 * Scope:
 *   2026-04-30 utvidet til også å dekke Spill 2 og Spill 3 (audit
 *   `WIREFRAME_PARITY_AUDIT_2026-04-30.md`). Tidligere returnerte
 *   resolveren DATABINGO for `rocket`/`monsterbingo` slik at oppførsel
 *   skulle bevares inntil Spill 2/3-fixen var avklart. Nå klassifiseres
 *   Spill 2/3-call-sites korrekt som hovedspill, og §11-distribusjon
 *   blir 15% (hovedspill) i stedet for feilaktige 30% (databingo).
 *
 * Usage:
 *   import { ledgerGameTypeForSlug } from "./ledgerGameTypeForSlug.js";
 *
 *   await ledger.recordComplianceLedgerEvent({
 *     gameType: ledgerGameTypeForSlug(room.gameSlug),  // MAIN_GAME for bingo/rocket/monsterbingo
 *     ...
 *   });
 *
 * Compliance-konsekvens:
 *   ComplianceLedgerOverskudd.ts:75 bruker `row.gameType === "DATABINGO" ? 0.3 : 0.15`
 *   for §11-distribusjon. Med korrekt gameType blir Spill 1-3 nå 15% (hovedspill)
 *   istedenfor 30% (databingo). Dette er obligatorisk per pengespillforskriften —
 *   tidligere oppførsel var en regulatorisk feil flagget i CRIT-1.
 *
 * Wallet-account-IDs:
 *   `makeHouseAccountId(hallId, gameType, channel)` lekker gameType inn i
 *   konto-ID-en (`house-{hallId}-{gameType.toLowerCase()}-{channel}`). For
 *   nye runder vil derfor wallet-creditering gå til
 *   `house-{hallId}-main_game-{channel}` for Spill 1-3, mens eksisterende
 *   prod-balanser fortsatt står på `house-{hallId}-databingo-{channel}`.
 *   Hall-balance-readout i `adminHallEvents.ts` summerer allerede begge
 *   gameType-buckets (DATABINGO + MAIN_GAME × HALL/INTERNET) per K2-A-PR
 *   #443, så hall-saldo er fortsatt korrekt total. En valgfri konsoliderings-
 *   migration er flagget som follow-up — beslutning er å akseptere split for
 *   denne PR-en.
 */

import type { LedgerGameType } from "./ComplianceLedgerTypes.js";

/**
 * Spill 1 — hovedspill 1, 75-ball 5×5. Slug i app_games og room.gameSlug.
 * `game_1` er en legacy-alias som enkelte numeriske kallere bruker.
 */
const SPILL1_SLUGS = new Set(["bingo", "game_1"]);

/**
 * Spill 2 — hovedspill 2, 3×3 / 1..21 (Rocket/Tallspill). Tre slug-aliaser
 * mirror `GAME2_SLUGS` i `ticket.ts` slik at klassifiseringen ikke drifter.
 */
const SPILL2_SLUGS = new Set(["rocket", "game_2", "tallspill"]);

/**
 * Spill 3 — hovedspill 3, 5×5 / 1..75 uten fri midt-celle (Mønsterbingo).
 * `mønsterbingo` (med ø) godtas som alias for admin-UI-skrivemåten;
 * `game_3` er legacy-formen.
 */
const SPILL3_SLUGS = new Set(["monsterbingo", "mønsterbingo", "game_3"]);

/**
 * Resolve `LedgerGameType` fra en game-slug.
 *
 * @param gameSlug - room.gameSlug eller scheduled-game's slug. Tolerant mot
 *                   undefined/null/whitespace — returnerer `DATABINGO` (legacy
 *                   default) for å bevare eksisterende oppførsel for ukjente
 *                   eller manglende slugs.
 * @returns "MAIN_GAME" for Spill 1-3 (bingo / rocket / monsterbingo + aliaser),
 *          "DATABINGO" for alle andre (inkl. SpinnGo / spillorama og ukjente).
 */
export function ledgerGameTypeForSlug(
  gameSlug: string | null | undefined,
): LedgerGameType {
  const trimmed = gameSlug?.trim().toLowerCase() ?? "";
  if (
    SPILL1_SLUGS.has(trimmed)
    || SPILL2_SLUGS.has(trimmed)
    || SPILL3_SLUGS.has(trimmed)
  ) {
    return "MAIN_GAME";
  }
  // Default: DATABINGO. SpinnGo (`spillorama` / `game_5`) er fortsatt
  // DATABINGO per pengespillforskriften §11 (player-startet, forhåndstrukket
  // databingo). Ukjente/manglende slugs faller også til DATABINGO for å
  // bevare bakoverkompatibilitet — endring av default-oppførsel for ukjente
  // slugs er ute av scope for denne fixen.
  return "DATABINGO";
}
