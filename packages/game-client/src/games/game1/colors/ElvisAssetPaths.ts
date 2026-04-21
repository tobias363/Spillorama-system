/**
 * Elvis-bilde-resolvere for Spill 1.
 *
 * Backend kan sende ticket.color i flere former — "elvis1", "Elvis1", "Elvis 1",
 * "ELVIS1", "Small Elvis 1" — fordi samme fargekontrakt deles med admin-UI
 * (lowercase `elvis1`) og Unity-migrering ("Elvis 1" med space). Denne modulen
 * sentraliserer normalisering + mapping til bildeassets, slik at:
 *
 *   1. {@link BingoTicketHtml} slipper å kjenne til asset-detaljer
 *   2. Placeholder-bilder kan byttes til offisielle bilder uten kode-endring
 *      (bare overskriv filene i `src/assets/elvis/`)
 *   3. Hvis Tobias leverer PNG i stedet for SVG er det ett sted å endre.
 *
 * Se `src/assets/elvis/README.md` for full bytte-prosedyre.
 */
import elvis1Url from "../../../assets/elvis/elvis1.svg";
import elvis2Url from "../../../assets/elvis/elvis2.svg";
import elvis3Url from "../../../assets/elvis/elvis3.svg";
import elvis4Url from "../../../assets/elvis/elvis4.svg";
import elvis5Url from "../../../assets/elvis/elvis5.svg";

/** Alle støttede Elvis-varianter (BIN-688). */
export const ELVIS_VARIANTS = [1, 2, 3, 4, 5] as const;
export type ElvisVariant = (typeof ELVIS_VARIANTS)[number];

const ELVIS_URL_BY_VARIANT: Record<ElvisVariant, string> = {
  1: elvis1Url,
  2: elvis2Url,
  3: elvis3Url,
  4: elvis4Url,
  5: elvis5Url,
};

/**
 * Trekk Elvis-variant-nummer (1-5) ut av en ticket.color-streng.
 *
 * Matcher alle disse variantene (som alle kan stamme fra backend):
 *   "elvis1", "Elvis1", "Elvis 1", "ELVIS 1",
 *   "Small Elvis1", "Small Elvis 1", "small_elvis1"
 *
 * Returnerer `null` for ikke-Elvis eller variant utenfor 1-5.
 */
export function parseElvisVariant(color: string | undefined | null): ElvisVariant | null {
  if (!color) return null;
  // Strip underscore/mellomrom og senk case så vi bare står igjen med alfanum.
  const compact = color.toLowerCase().replace(/[\s_]+/g, "");
  const match = compact.match(/elvis(\d+)/);
  if (!match) return null;
  const n = Number(match[1]);
  if (n >= 1 && n <= 5) return n as ElvisVariant;
  return null;
}

/**
 * Hent bilde-URL for en Elvis-variant. Returnerer `null` hvis fargen ikke er
 * en kjent Elvis-variant.
 */
export function getElvisImageUrl(color: string | undefined | null): string | null {
  const variant = parseElvisVariant(color);
  if (variant === null) return null;
  return ELVIS_URL_BY_VARIANT[variant];
}

/**
 * True hvis `color` er en Elvis-farge (inkludert ukjent-nummer som f.eks.
 * "elvis9"). Brukes av BingoTicketHtml for å oppdage om Elvis-header skal
 * bygges. For ukjent Elvis-variant rendres header UTEN bilde (fallback).
 */
export function isElvisColor(color: string | undefined | null): boolean {
  if (!color) return false;
  const compact = color.toLowerCase().replace(/[\s_]+/g, "");
  return /elvis\d+/.test(compact);
}

/**
 * Hent brukervennlig header-label for en Elvis-variant ("ELVIS 1" …"ELVIS 5").
 * For ukjent-nummer Elvis (f.eks. "elvis9") returneres "ELVIS" uten nummer.
 */
export function getElvisLabel(color: string | undefined | null): string {
  const variant = parseElvisVariant(color);
  if (variant !== null) return `ELVIS ${variant}`;
  return "ELVIS";
}
