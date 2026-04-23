// BIN-BOT-01: vitest for "Report Management Game 1"-siden.
//
// Dekker:
//   - CSV-builder: headers + data-rader + TOTALS-rad, tallformat (2 desimaler),
//     korrekt escaping av kommaer/quotes/nye linjer, og \r\n-linjedelere.
//   - TSV-builder (Excel-variant): samme shape, tab-separator.
//   - Formatterere: formatCurrency, formatPercent, formatDateTime.
//   - defaultFilters: riktig 7d vindu.

import { describe, it, expect } from "vitest";
import { __testOnly } from "../src/pages/reports/game1/Game1ManagementReportPage.js";
import type { Game1ManagementReportResponse } from "../src/api/admin-reports.js";

const { buildCsv, buildTsv, formatCurrency, formatPercent, formatDateTime, defaultFilters } =
  __testOnly;

function mkResponse(
  overrides: Partial<Game1ManagementReportResponse> = {},
): Game1ManagementReportResponse {
  return {
    from: "2026-04-18T00:00:00.000Z",
    to: "2026-04-19T00:00:00.000Z",
    generatedAt: "2026-04-19T10:00:00.000Z",
    type: "player",
    rows: [],
    totals: { oms: 0, utd: 0, payoutPct: 0, res: 0 },
    ...overrides,
  };
}

describe("BIN-BOT-01 Game1 Management Report — formatters", () => {
  it("formatCurrency: to desimaler + norsk gruppering", () => {
    // Intl.NumberFormat("no-NO") bruker narrow-no-break-space (U+202F) som
    // gruppe-separator; godta hvilken som helst whitespace mellom sifrene.
    expect(formatCurrency(1234.5)).toMatch(/^1\s234,50$/);
    expect(formatCurrency(0)).toBe("0,00");
    expect(formatCurrency(1_000_000)).toMatch(/^1\s000\s000,00$/);
  });

  it("formatPercent: to desimaler + %-suffix", () => {
    expect(formatPercent(42.857)).toMatch(/42,86\s*%/);
    expect(formatPercent(0)).toMatch(/0,00\s*%/);
  });

  it("formatDateTime: null → em-dash", () => {
    expect(formatDateTime(null)).toBe("—");
  });

  it("formatDateTime: gyldig ISO → lokalisert streng", () => {
    const out = formatDateTime("2026-04-18T18:00:00.000Z");
    // Different environments render differently; just verify it's non-empty
    // and not the raw ISO-string (year should be included).
    expect(out).toMatch(/2026/);
  });

  it("defaultFilters: siste 7 dager, type=player, ingen filtre", () => {
    const f = defaultFilters();
    expect(f.type).toBe("player");
    expect(f.hallId).toBe("");
    expect(f.groupOfHallId).toBe("");
    expect(f.q).toBe("");
    // 6 days back
    const fromMs = Date.parse(`${f.from}T00:00:00Z`);
    const toMs = Date.parse(`${f.to}T00:00:00Z`);
    expect(toMs - fromMs).toBe(6 * 24 * 60 * 60 * 1000);
  });
});

describe("BIN-BOT-01 Game1 Management Report — CSV export", () => {
  it("header-rad + totals på tom dataset", () => {
    const res = mkResponse();
    const csv = buildCsv(res);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe(
      "subGameId,childGameId,groupOfHallName,hallName,startedAt,OMS,UTD,PayoutPercent,RES",
    );
    // TOTALS line with zeros
    expect(lines[lines.length - 1]).toBe("TOTALS,,,,,0.00,0.00,0.00,0.00");
  });

  it("én rad + totals", () => {
    const res = mkResponse({
      rows: [
        {
          subGameId: "sg-1",
          subGameNumber: "NORTH_01",
          childGameId: "NORTH_01",
          parentScheduleId: "parent-1",
          hallId: "hall-a",
          hallName: "Alpha",
          groupOfHallId: "grp-1",
          groupOfHallName: "Group North",
          startedAt: "2026-04-18T18:00:00.000Z",
          oms: 150,
          utd: 90,
          payoutPct: 60,
          res: 60,
        },
      ],
      totals: { oms: 150, utd: 90, payoutPct: 60, res: 60 },
    });
    const csv = buildCsv(res);
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(3); // header + row + totals
    expect(lines[1]).toBe(
      "NORTH_01,NORTH_01,Group North,Alpha,2026-04-18T18:00:00.000Z,150.00,90.00,60.00,60.00",
    );
    expect(lines[2]).toBe("TOTALS,,,,,150.00,90.00,60.00,60.00");
  });

  it("escaper kommaer og quotes i hall-navn", () => {
    const res = mkResponse({
      rows: [
        {
          subGameId: "sg-1",
          subGameNumber: null,
          childGameId: "sg-1",
          parentScheduleId: "parent-1",
          hallId: "hall-a",
          hallName: 'Alpha, "Main" Hall',
          groupOfHallId: null,
          groupOfHallName: null,
          startedAt: null,
          oms: 0,
          utd: 0,
          payoutPct: 0,
          res: 0,
        },
      ],
    });
    const csv = buildCsv(res);
    // Hall name with comma+quote should be wrapped and quotes doubled.
    expect(csv).toContain('"Alpha, ""Main"" Hall"');
  });

  it("subGameNumber null faller tilbake til subGameId", () => {
    const res = mkResponse({
      rows: [
        {
          subGameId: "sg-raw-1",
          subGameNumber: null,
          childGameId: "sg-raw-1",
          parentScheduleId: "parent-1",
          hallId: "hall-a",
          hallName: "Alpha",
          groupOfHallId: null,
          groupOfHallName: null,
          startedAt: null,
          oms: 100,
          utd: 0,
          payoutPct: 0,
          res: 100,
        },
      ],
    });
    const csv = buildCsv(res);
    const lines = csv.split("\r\n");
    expect(lines[1]?.startsWith("sg-raw-1,sg-raw-1,")).toBe(true);
  });
});

describe("BIN-BOT-01 Game1 Management Report — TSV (Excel)", () => {
  it("tab-separert med samme header som CSV", () => {
    const res = mkResponse();
    const tsv = buildTsv(res);
    const headerLine = tsv.split("\r\n")[0]!;
    expect(headerLine.split("\t")).toEqual([
      "subGameId",
      "childGameId",
      "groupOfHallName",
      "hallName",
      "startedAt",
      "OMS",
      "UTD",
      "PayoutPercent",
      "RES",
    ]);
  });

  it("tabs i hall-navn blir erstattet med space", () => {
    const res = mkResponse({
      rows: [
        {
          subGameId: "sg-1",
          subGameNumber: "X",
          childGameId: "X",
          parentScheduleId: "parent-1",
          hallId: "hall-a",
          hallName: "Alpha\tHall",
          groupOfHallId: null,
          groupOfHallName: null,
          startedAt: null,
          oms: 0,
          utd: 0,
          payoutPct: 0,
          res: 0,
        },
      ],
    });
    const tsv = buildTsv(res);
    // Hall cell should contain "Alpha Hall" (space), not "Alpha\tHall".
    const dataLine = tsv.split("\r\n")[1]!;
    expect(dataLine).toContain("Alpha Hall");
    // And only 9 tab-separated columns total.
    expect(dataLine.split("\t")).toHaveLength(9);
  });
});
