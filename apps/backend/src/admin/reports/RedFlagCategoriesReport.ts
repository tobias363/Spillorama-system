/**
 * BIN-650: Red-flag categories report — pure aggregate builder.
 *
 * Legacy reference:
 *   legacy/unity-backend/App/Controllers/redFlagCategoryController.js
 *   (`redFlagCategory` + `getRedFlagCategory`) eksponerer 9 hardkodede
 *   kategorier (id 1-9) for UI-en `report/redFlagCategories.html`. Det
 *   nye backend-mønsteret bytter hardkodete numeriske id-er mot AML
 *   rule-slug-er fra `app_aml_rules` — slug-en er stabil og bevares i
 *   `app_aml_red_flags.rule_slug`, så historikk overlever regel-
 *   slettinger (soft-disable). Terskler bor fortsatt i rules-raden.
 *
 * Input model:
 *   - Én rad per `rule_slug` fra AmlService.aggregateCategoryCounts.
 *     Hver rad har count (alle statuser) + openCount (status='OPEN').
 *   - Rule-metadata (label/severity/description) kommer fra rules-
 *     katalogen. Flagg-rader som peker på slug som ikke lenger finnes
 *     i katalogen (f.eks. manuell flagging med slug="manual" eller
 *     soft-disabled rules) bruker slug-en direkte som label.
 *
 * This file is pure — no DB I/O. The route wires up the DB lookups and
 * feeds the result here. Same pattern as SubgameDrillDownReport.
 *
 * Regulatorisk: pengespillforskriften §11 forebyggende tiltak. Samme
 * AML-scope som PLAYER_AML_READ (ADMIN + SUPPORT).
 */
import type { AmlCategoryCountRow, AmlSeverity } from "../../compliance/AmlService.js";

// Wire-types — speiler `RedFlagCategoryRow` / `RedFlagCategoriesResponse` i
// packages/shared-types/src/reports.ts (samme mønster som
// `PhysicalTicketsAggregateRow` i ../PhysicalTicketsAggregate.ts: backend
// eier sin egen kopi; shared-types mirror-er for admin-web-konsumentene).
export interface RedFlagCategoryRow {
  category: string;
  label: string;
  description: string | null;
  severity: AmlSeverity;
  count: number;
  openCount: number;
}

export interface RedFlagCategoriesTotals {
  totalFlags: number;
  totalOpenFlags: number;
  categoryCount: number;
}

export interface RedFlagCategoriesResponse {
  from: string;
  to: string;
  generatedAt: string;
  categories: RedFlagCategoryRow[];
  totals: RedFlagCategoriesTotals;
}

export interface BuildRedFlagCategoriesInput {
  rows: AmlCategoryCountRow[];
  from: string;
  to: string;
  generatedAt?: string;
}

function assertIsoWindow(from: string, to: string): void {
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (!Number.isFinite(fromMs)) {
    throw new Error(`[BIN-650] Ugyldig 'from': ${from}`);
  }
  if (!Number.isFinite(toMs)) {
    throw new Error(`[BIN-650] Ugyldig 'to': ${to}`);
  }
  if (fromMs > toMs) {
    throw new Error(`[BIN-650] 'from' må være <= 'to' (${from} > ${to}).`);
  }
}

/**
 * Transform AML-service aggregat-rader til wire-shape. Rows er allerede
 * sortert ASC på slug fra servicen; vi beholder rekkefølgen slik at
 * output er deterministisk for CSV-eksport og tester.
 */
export function buildRedFlagCategories(
  input: BuildRedFlagCategoriesInput
): RedFlagCategoriesResponse {
  assertIsoWindow(input.from, input.to);
  const generatedAt = input.generatedAt ?? new Date().toISOString();

  const categories: RedFlagCategoryRow[] = input.rows.map((r) => ({
    category: r.slug,
    label: r.label,
    description: r.description,
    severity: r.severity,
    count: r.count,
    openCount: r.openCount,
  }));

  const totals: RedFlagCategoriesTotals = {
    totalFlags: categories.reduce((acc, c) => acc + c.count, 0),
    totalOpenFlags: categories.reduce((acc, c) => acc + c.openCount, 0),
    categoryCount: categories.length,
  };

  return {
    from: input.from,
    to: input.to,
    generatedAt,
    categories,
    totals,
  };
}
