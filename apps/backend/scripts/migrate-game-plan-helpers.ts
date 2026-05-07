/**
 * Fase 4 (2026-05-07): pure helpers for migrasjons-skriptet.
 *
 * Skilt ut fra migrate-game-plan-2026-05-07.ts så testene kan importere
 * funksjonene uten å trigge pg-oppkopling i toppnivå-koden.
 */

export const MIGRATION_PREFIX = "mig-fase4-";

export const DEFAULT_PRIZES_FALLBACK = {
  rad1: 10000, // 100 kr
  rad2: 20000, // 200 kr
  rad3: 20000,
  rad4: 20000,
  bingo: { gul: 100000, hvit: 100000 } as Record<string, number>, // 1000 kr
};

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function deterministicCatalogId(slug: string): string {
  return `${MIGRATION_PREFIX}cat-${slug}`;
}

export function deterministicPlanId(
  hallId: string,
  weekdayKey: string,
): string {
  return `${MIGRATION_PREFIX}plan-${hallId.slice(0, 12)}-${weekdayKey}`;
}

export function parsePrizeDescription(
  desc: string | null,
): {
  rad1?: number;
  rad2?: number;
  rad3?: number;
  rad4?: number;
  bingo?: number;
} | null {
  if (!desc) return null;
  const out: Record<string, number> = {};
  // Match "Rad N: NNNkr"
  const radRe = /(?:rad|row)\s*([1-4])\s*[:=]\s*(\d+)\s*(?:kr|nok)?/gi;
  let m: RegExpExecArray | null;
  while ((m = radRe.exec(desc)) !== null) {
    const n = parseInt(m[1]!, 10);
    const v = parseInt(m[2]!, 10);
    if (Number.isFinite(n) && Number.isFinite(v) && n >= 1 && n <= 4) {
      out[`rad${n}`] = v * 100; // kr → øre
    }
  }
  // Match "Bingo: NNNkr" / "Full(t)? Hus: NNNkr"
  const bingoRe = /(?:bingo|full\s*house|fullt?\s*hus)\s*[:=]\s*(\d+)\s*(?:kr|nok)?/gi;
  while ((m = bingoRe.exec(desc)) !== null) {
    const v = parseInt(m[1]!, 10);
    if (Number.isFinite(v)) {
      out.bingo = v * 100;
    }
  }
  if (Object.keys(out).length === 0) return null;
  return out;
}

/**
 * Map week_days bitmask (legacy daily_schedules) til ukedags-strenger.
 */
export function bitmaskToWeekdays(weekDays: number): string[] {
  const masks: [number, string][] = [
    [1, "mon"],
    [2, "tue"],
    [4, "wed"],
    [8, "thu"],
    [16, "fri"],
    [32, "sat"],
    [64, "sun"],
  ];
  const out: string[] = [];
  for (const [m, k] of masks) {
    if ((weekDays & m) !== 0) out.push(k);
  }
  return out;
}

/**
 * Map JS day-of-week (0=Sunday) til weekday-key.
 */
export function jsDayOfWeekToKey(dayOfWeek: number): string | null {
  const keys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return keys[dayOfWeek] ?? null;
}
