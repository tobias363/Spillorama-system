// Unit tests for Spill1Config — validering + payload-bygging.

import { describe, it, expect } from "vitest";
import {
  emptySpill1Config,
  validateSpill1Config,
  buildSpill1Payload,
  patternsForSubVariant,
  SPILL1_TICKET_COLORS,
  SPILL1_PATTERNS,
  SPILL1_SUB_VARIANTS,
  SPILL1_MINI_GAME_TYPES,
  type Spill1MiniGameType,
} from "../../src/pages/games/gameManagement/Spill1Config.js";

function validConfig() {
  const c = emptySpill1Config();
  c.startTime = "18:00";
  c.endTime = "19:30";
  c.ticketColors = [
    {
      color: "small_yellow",
      priceNok: 20,
      prizePerPattern: {
        row_1: { mode: "percent", amount: 10 },
        row_2: { mode: "percent", amount: 20 },
        full_house: { mode: "percent", amount: 50 },
      },
    },
  ];
  c.jackpot = {
    prizeByColor: { small_white: 10000 },
    draw: 55,
  };
  return c;
}

describe("emptySpill1Config", () => {
  it("returns a fresh empty config with sensible defaults", () => {
    const c = emptySpill1Config();
    expect(c.ticketColors).toEqual([]);
    expect(c.timing.minseconds).toBe(3);
    expect(c.timing.maxseconds).toBe(6);
    expect(c.jackpot.draw).toBe(50);
  });
});

describe("SPILL1_TICKET_COLORS / SPILL1_PATTERNS", () => {
  it("includes all legacy ticket-color slugs", () => {
    expect(SPILL1_TICKET_COLORS).toContain("small_yellow");
    expect(SPILL1_TICKET_COLORS).toContain("large_white");
    expect(SPILL1_TICKET_COLORS).toContain("elvis5");
    expect(SPILL1_TICKET_COLORS).toContain("small_orange");
  });
  it("defines 5 patterns for Norwegian 5-fase", () => {
    expect(SPILL1_PATTERNS.length).toBe(5);
    expect(SPILL1_PATTERNS).toContain("full_house");
    expect(SPILL1_PATTERNS).toContain("row_4");
  });
});

describe("validateSpill1Config", () => {
  it("accepts a fully-valid config", () => {
    const c = validConfig();
    const res = validateSpill1Config(c, "Mitt spill");
    expect(res.ok).toBe(true);
  });
  it("rejects missing name", () => {
    const res = validateSpill1Config(validConfig(), "");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.path === "name")).toBe(true);
    }
  });
  it("rejects missing startTime", () => {
    const c = validConfig();
    c.startTime = "";
    const res = validateSpill1Config(c, "x");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.path === "startTime")).toBe(true);
    }
  });
  it("rejects invalid startTime format", () => {
    const c = validConfig();
    c.startTime = "25:99";
    const res = validateSpill1Config(c, "x");
    expect(res.ok).toBe(false);
  });
  it("rejects endTime not greater than startTime", () => {
    const c = validConfig();
    c.startTime = "19:00";
    c.endTime = "18:00";
    const res = validateSpill1Config(c, "x");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(
        res.errors.some((e) => e.message === "end_time_must_be_greater_than_start_time")
      ).toBe(true);
    }
  });
  it("rejects minseconds < 3", () => {
    const c = validConfig();
    c.timing.minseconds = 2;
    const res = validateSpill1Config(c, "x");
    expect(res.ok).toBe(false);
  });
  it("rejects minseconds >= maxseconds", () => {
    const c = validConfig();
    c.timing.minseconds = 10;
    c.timing.maxseconds = 5;
    const res = validateSpill1Config(c, "x");
    expect(res.ok).toBe(false);
  });
  it("rejects zero ticket-colors", () => {
    const c = validConfig();
    c.ticketColors = [];
    const res = validateSpill1Config(c, "x");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.path === "ticketColors")).toBe(true);
    }
  });
  it("rejects ticket-color with zero price", () => {
    const c = validConfig();
    c.ticketColors[0]!.priceNok = 0;
    const res = validateSpill1Config(c, "x");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.path.includes("priceNok"))).toBe(true);
    }
  });
  it("rejects percent-mode prize-sum > 100%", () => {
    const c = validConfig();
    c.ticketColors[0]!.prizePerPattern = {
      row_1: { mode: "percent", amount: 50 },
      row_2: { mode: "percent", amount: 60 },
      full_house: { mode: "percent", amount: 10 },
    };
    const res = validateSpill1Config(c, "x");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.message.includes("less_or_equal_to_100"))).toBe(true);
    }
  });
  it("does NOT count fixed-mode entries toward the 100% cap", () => {
    // Fixed-beløp kan fritt overstige pot — kappes av RTP-guards backend.
    const c = validConfig();
    c.ticketColors[0]!.prizePerPattern = {
      row_1: { mode: "percent", amount: 90 },
      row_2: { mode: "fixed", amount: 9999 },
      full_house: { mode: "fixed", amount: 50000 },
    };
    const res = validateSpill1Config(c, "x");
    expect(res.ok).toBe(true);
  });
  it("allows mixed percent + fixed modes per color as long as percent sum ≤ 100", () => {
    const c = validConfig();
    c.ticketColors[0]!.prizePerPattern = {
      row_1: { mode: "percent", amount: 15 },
      row_2: { mode: "percent", amount: 15 },
      row_3: { mode: "fixed", amount: 200 },
      row_4: { mode: "fixed", amount: 200 },
      full_house: { mode: "fixed", amount: 1000 },
    };
    const res = validateSpill1Config(c, "x");
    expect(res.ok).toBe(true);
  });
  it("rejects non-finite prize amount", () => {
    const c = validConfig();
    c.ticketColors[0]!.prizePerPattern = {
      row_1: { mode: "percent", amount: Number.NaN },
    };
    const res = validateSpill1Config(c, "x");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(
        res.errors.some((e) => e.path.includes("prizePerPattern.row_1"))
      ).toBe(true);
    }
  });
  it("rejects negative prize amount", () => {
    const c = validConfig();
    c.ticketColors[0]!.prizePerPattern = {
      row_1: { mode: "fixed", amount: -50 },
    };
    const res = validateSpill1Config(c, "x");
    expect(res.ok).toBe(false);
  });
  it("rejects jackpot draw outside 50-59", () => {
    const c = validConfig();
    c.jackpot.draw = 60;
    const res = validateSpill1Config(c, "x");
    expect(res.ok).toBe(false);
  });
  it("rejects jackpot prize outside 5k-50k (when non-zero)", () => {
    const c = validConfig();
    c.jackpot.prizeByColor.small_white = 1000;
    const res = validateSpill1Config(c, "x");
    expect(res.ok).toBe(false);
  });
  it("accepts jackpot prize of exactly 0 (means no jackpot for that color)", () => {
    const c = validConfig();
    c.jackpot.prizeByColor = { small_white: 0, large_yellow: 0 };
    const res = validateSpill1Config(c, "x");
    expect(res.ok).toBe(true);
  });
  it("accepts jackpot prize set for any of the 14 ticket colors (not only white/yellow/purple)", () => {
    const c = validConfig();
    c.jackpot.prizeByColor = {
      small_red: 10000,
      small_green: 7500,
      small_orange: 5000,
      elvis1: 15000,
      elvis5: 50000,
      large_white: 25000,
    };
    const res = validateSpill1Config(c, "x");
    expect(res.ok).toBe(true);
  });
  it("rejects jackpot prize above 50000 for arbitrary color", () => {
    const c = validConfig();
    c.jackpot.prizeByColor = { small_red: 50001 };
    const res = validateSpill1Config(c, "x");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(
        res.errors.some(
          (e) =>
            e.path === "jackpot.prizeByColor.small_red" &&
            e.message === "jackpot_prize_must_between_5k_50k"
        )
      ).toBe(true);
    }
  });
  it("rejects non-finite jackpot prize value", () => {
    const c = validConfig();
    c.jackpot.prizeByColor = { small_white: Number.NaN };
    const res = validateSpill1Config(c, "x");
    expect(res.ok).toBe(false);
  });
  it("accepts empty prizeByColor map (jackpot fully disabled)", () => {
    const c = validConfig();
    c.jackpot.prizeByColor = {};
    const res = validateSpill1Config(c, "x");
    expect(res.ok).toBe(true);
  });
});

describe("buildSpill1Payload", () => {
  it("converts NOK to øre for ticketPrice and constructs proper ISO startDate", () => {
    const c = validConfig();
    const p = buildSpill1Payload({
      gameTypeId: "bingo",
      name: "Test",
      isoDate: "2026-05-15",
      spill1: c,
    });
    expect(p.gameTypeId).toBe("bingo");
    expect(p.name).toBe("Test");
    expect(p.ticketType).toBe("Small");
    expect(p.ticketPrice).toBe(2000); // 20 NOK × 100
    expect(p.startDate).toBe("2026-05-15T18:00:00.000Z");
    expect(p.endDate).toBe("2026-05-15T19:30:00.000Z");
    expect(p.config.spill1.ticketColors.length).toBe(1);
  });
  it("picks 'Large' when at least one large_ color is chosen", () => {
    const c = validConfig();
    c.ticketColors.push({
      color: "large_white",
      priceNok: 50,
      prizePerPattern: {},
    });
    const p = buildSpill1Payload({
      gameTypeId: "bingo",
      name: "Test",
      isoDate: "2026-05-15",
      spill1: c,
    });
    expect(p.ticketType).toBe("Large");
    // Primary ticketPrice should be the lowest (20 NOK × 100 = 2000 øre).
    expect(p.ticketPrice).toBe(2000);
  });
  it("handles empty endTime as null", () => {
    const c = validConfig();
    c.endTime = "";
    const p = buildSpill1Payload({
      gameTypeId: "bingo",
      name: "Test",
      isoDate: "2026-05-15",
      spill1: c,
    });
    expect(p.endDate).toBeNull();
  });

  it("filters out zero-prize and non-finite jackpot entries in payload", () => {
    const c = validConfig();
    c.jackpot.prizeByColor = {
      small_white: 10000,
      small_yellow: 0, // skal filtreres bort
      small_red: 7500,
      elvis1: Number.NaN, // skal filtreres bort
    };
    const p = buildSpill1Payload({
      gameTypeId: "bingo",
      name: "Test",
      isoDate: "2026-05-15",
      spill1: c,
    });
    expect(p.config.spill1.jackpot.prizeByColor).toEqual({
      small_white: 10000,
      small_red: 7500,
    });
    // Original draw + andre jackpot-felter bevares.
    expect(p.config.spill1.jackpot.draw).toBe(55);
  });

  it("sends empty prizeByColor map when no color has non-zero jackpot", () => {
    const c = validConfig();
    c.jackpot.prizeByColor = { small_white: 0, large_yellow: 0 };
    const p = buildSpill1Payload({
      gameTypeId: "bingo",
      name: "Test",
      isoDate: "2026-05-15",
      spill1: c,
    });
    expect(p.config.spill1.jackpot.prizeByColor).toEqual({});
  });

  it("supports arbitrary ticket colors in payload (not only white/yellow/purple)", () => {
    const c = validConfig();
    c.jackpot.prizeByColor = {
      small_orange: 8000,
      elvis3: 20000,
      large_purple: 30000,
    };
    const p = buildSpill1Payload({
      gameTypeId: "bingo",
      name: "Test",
      isoDate: "2026-05-15",
      spill1: c,
    });
    expect(p.config.spill1.jackpot.prizeByColor).toEqual({
      small_orange: 8000,
      elvis3: 20000,
      large_purple: 30000,
    });
  });
});

// ── BIN-689: Kvikkis sub-variant ────────────────────────────────────────────

describe("SPILL1_SUB_VARIANTS / patternsForSubVariant", () => {
  it("eksponerer både norsk-bingo og kvikkis", () => {
    expect(SPILL1_SUB_VARIANTS).toContain("norsk-bingo");
    expect(SPILL1_SUB_VARIANTS).toContain("kvikkis");
  });

  it("norsk-bingo gir alle 5 patterns", () => {
    expect(patternsForSubVariant("norsk-bingo")).toEqual(SPILL1_PATTERNS);
  });

  it("kvikkis gir kun full_house", () => {
    expect(patternsForSubVariant("kvikkis")).toEqual(["full_house"]);
  });
});

describe("emptySpill1Config subVariant", () => {
  it("default-config har subVariant='norsk-bingo'", () => {
    const c = emptySpill1Config();
    expect(c.subVariant).toBe("norsk-bingo");
  });
});

describe("validateSpill1Config with Kvikkis", () => {
  function validKvikkisConfig() {
    const c = emptySpill1Config();
    c.subVariant = "kvikkis";
    c.startTime = "18:00";
    c.ticketColors = [
      {
        color: "small_yellow",
        priceNok: 20,
        prizePerPattern: {
          full_house: { mode: "fixed", amount: 1000 },
        },
      },
    ];
    return c;
  }

  it("aksepterer fullstendig Kvikkis-config", () => {
    const res = validateSpill1Config(validKvikkisConfig(), "Kvikkis-test");
    expect(res.ok).toBe(true);
  });

  it("Kvikkis: rad 1-4-entries ignoreres i validering (selv ved ugyldige verdier)", () => {
    const c = validKvikkisConfig();
    // Legg inn rad 1-entry med ulovlig negativ verdi — må ikke trigge feil
    // siden den IKKE er aktiv for Kvikkis.
    c.ticketColors[0]!.prizePerPattern.row_1 = { mode: "percent", amount: -999 };
    const res = validateSpill1Config(c, "x");
    expect(res.ok).toBe(true);
  });

  it("Kvikkis: Fullt Hus-entry valideres (negativ beløp avvises)", () => {
    const c = validKvikkisConfig();
    c.ticketColors[0]!.prizePerPattern.full_house = { mode: "fixed", amount: -10 };
    const res = validateSpill1Config(c, "x");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.path.includes("full_house"))).toBe(true);
    }
  });

  it("norsk-bingo: rad 1-entry valideres som før (negativ beløp avvises)", () => {
    const c = validKvikkisConfig();
    c.subVariant = "norsk-bingo";
    c.ticketColors[0]!.prizePerPattern.row_1 = { mode: "percent", amount: -5 };
    const res = validateSpill1Config(c, "x");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.path.includes("row_1"))).toBe(true);
    }
  });
});

describe("buildSpill1Payload with Kvikkis", () => {
  it("propagerer subVariant='kvikkis' i payload.config.spill1", () => {
    const c = emptySpill1Config();
    c.subVariant = "kvikkis";
    c.startTime = "18:00";
    c.ticketColors = [
      { color: "small_yellow", priceNok: 20, prizePerPattern: {} },
    ];
    const p = buildSpill1Payload({
      gameTypeId: "gt-1",
      name: "Kvikkis",
      isoDate: "2026-05-15",
      spill1: c,
    });
    expect(p.config.spill1.subVariant).toBe("kvikkis");
  });
});

// ── BIN-690 M1: mini-games config ───────────────────────────────────────────

describe("SPILL1_MINI_GAME_TYPES", () => {
  it("inkluderer alle 4 mini-game-typer for M1 framework", () => {
    expect(SPILL1_MINI_GAME_TYPES).toEqual([
      "wheel",
      "chest",
      "colordraft",
      "oddsen",
    ]);
  });
});

describe("validateSpill1Config: miniGames", () => {
  it("accepterer tom miniGames-array", () => {
    const c = validConfig();
    c.miniGames = [];
    const res = validateSpill1Config(c, "Test");
    expect(res.ok).toBe(true);
  });

  it("accepterer alle kjente mini-game-typer", () => {
    const c = validConfig();
    c.miniGames = ["wheel", "chest", "colordraft", "oddsen"];
    const res = validateSpill1Config(c, "Test");
    expect(res.ok).toBe(true);
  });

  it("avviser ukjent mini-game-type", () => {
    const c = validConfig();
    c.miniGames = ["wheel", "bogus" as Spill1MiniGameType];
    const res = validateSpill1Config(c, "Test");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.path === "miniGames[1]")).toBe(true);
    }
  });

  it("avviser miniGames som ikke er array", () => {
    const c = validConfig();
    // Bypass type for å simulere korrupt config fra API.
    (c as unknown as { miniGames: unknown }).miniGames = "wheel";
    const res = validateSpill1Config(c, "Test");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.path === "miniGames")).toBe(true);
    }
  });
});

describe("emptySpill1Config: miniGames default", () => {
  it("starter med tom miniGames-array", () => {
    const c = emptySpill1Config();
    expect(c.miniGames).toEqual([]);
  });
});

describe("buildSpill1Payload: miniGames passerer gjennom", () => {
  it("bevarer valgte mini-games i config.spill1.miniGames", () => {
    const c = validConfig();
    c.miniGames = ["wheel", "colordraft"];
    const p = buildSpill1Payload({
      gameTypeId: "bingo",
      name: "Test",
      isoDate: "2026-05-15",
      spill1: c,
    });
    expect(p.config.spill1.miniGames).toEqual(["wheel", "colordraft"]);
  });

  it("bevarer tom miniGames-array", () => {
    const c = validConfig();
    c.miniGames = [];
    const p = buildSpill1Payload({
      gameTypeId: "bingo",
      name: "Test",
      isoDate: "2026-05-15",
      spill1: c,
    });
    expect(p.config.spill1.miniGames).toEqual([]);
  });
});
