/**
 * K2-A regulatorisk fix (CRIT-1): per-spill `LedgerGameType`-resolver.
 *
 * Erstatter hardkodede `gameType: "DATABINGO"`-call-sites for Spill 1.
 * Returnerer `MAIN_GAME` for Spill 1 (slug `bingo`), `DATABINGO` for SpinnGo
 * (slug `spillorama`). Ingen andre spill skal endre eksisterende oppførsel
 * uten eksplisitt PM-vedtak.
 *
 * Regulatorisk kontekst (docs/architecture/SPILLKATALOG.md, PM-låst 2026-04-25):
 *   - Spill 1 (`bingo`)        → hovedspill (15% til organisasjoner)
 *   - Spill 2 (`rocket`)       → hovedspill (15% til organisasjoner)
 *   - Spill 3 (`monsterbingo`) → hovedspill (15% til organisasjoner)
 *   - SpinnGo (`spillorama`)   → databingo  (30% til organisasjoner)
 *
 * Scope:
 *   K2-A endrer KUN Spill 1 (slug `bingo`). Spill 2/3 behandles i egne
 *   filer (Game2Engine.ts) og er IKKE en del av denne resolveren ennå —
 *   feilen finnes der, men løses i en egen task. Resolveren returnerer
 *   derfor `DATABINGO` (eksisterende oppførsel) for ukjente slugs slik at
 *   call-sites som ikke vet om Spill 1-fikset oppfører seg som før.
 *
 * Usage:
 *   import { ledgerGameTypeForSlug } from "./ledgerGameTypeForSlug.js";
 *
 *   await ledger.recordComplianceLedgerEvent({
 *     gameType: ledgerGameTypeForSlug(room.gameSlug),  // MAIN_GAME for bingo
 *     ...
 *   });
 *
 * Compliance-konsekvens:
 *   ComplianceLedgerOverskudd.ts:75 bruker `row.gameType === "DATABINGO" ? 0.3 : 0.15`
 *   for §11-distribusjon. Med korrekt gameType blir Spill 1 nå 15% (hovedspill)
 *   istedenfor 30% (databingo). Dette er obligatorisk per pengespillforskriften —
 *   tidligere oppførsel var en regulatorisk feil flagget i CRIT-1.
 */

import type { LedgerGameType } from "./ComplianceLedgerTypes.js";

/**
 * Spill 1 — hovedspill 1, 75-ball 5×5. Slug i app_games og room.gameSlug.
 */
const SPILL1_SLUG = "bingo";

/**
 * Resolve `LedgerGameType` fra en game-slug.
 *
 * @param gameSlug - room.gameSlug eller scheduled-game's slug. Tolerant mot
 *                   undefined/null/whitespace — returnerer `DATABINGO` (legacy
 *                   default) for å bevare eksisterende oppførsel for ukjente
 *                   eller manglende slugs.
 * @returns "MAIN_GAME" for Spill 1 (bingo), "DATABINGO" for alle andre.
 */
export function ledgerGameTypeForSlug(
  gameSlug: string | null | undefined,
): LedgerGameType {
  const trimmed = gameSlug?.trim().toLowerCase() ?? "";
  if (trimmed === SPILL1_SLUG) {
    return "MAIN_GAME";
  }
  // Default: DATABINGO. SpinnGo (`spillorama`) er allerede DATABINGO.
  // Spill 2/3 (`rocket`/`monsterbingo`) er feil-flagget i CRIT-1 men løses
  // i en egen task — denne resolveren bevarer eksisterende oppførsel for
  // alle ikke-Spill-1-slugs.
  return "DATABINGO";
}
