// Unit tests for Spill1Config — validering + payload-bygging.

import { describe, it, expect } from "vitest";
import {
  emptySpill1Config,
  validateSpill1Config,
  buildSpill1Payload,
  SPILL1_TICKET_COLORS,
  SPILL1_PATTERNS,
} from "../../src/pages/games/gameManagement/Spill1Config.js";

function validConfig() {
  const c = emptySpill1Config();
  c.startTime = "18:00";
  c.endTime = "19:30";
  c.ticketColors = [
    {
      color: "small_yellow",
      priceNok: 20,
      prizePerPattern: { row_1: 10, row_2: 20, full_house: 50 },
    },
  ];
  c.jackpot = {
    prizeByColor: { white: 10000, yellow: 0, purple: 0 },
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
  it("rejects prize-sum > 100%", () => {
    const c = validConfig();
    c.ticketColors[0]!.prizePerPattern = { row_1: 50, row_2: 60, full_house: 10 };
    const res = validateSpill1Config(c, "x");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.message.includes("less_or_equal_to_100"))).toBe(true);
    }
  });
  it("rejects jackpot draw outside 50-59", () => {
    const c = validConfig();
    c.jackpot.draw = 60;
    const res = validateSpill1Config(c, "x");
    expect(res.ok).toBe(false);
  });
  it("rejects jackpot prize outside 5k-50k (when non-zero)", () => {
    const c = validConfig();
    c.jackpot.prizeByColor.white = 1000;
    const res = validateSpill1Config(c, "x");
    expect(res.ok).toBe(false);
  });
  it("accepts jackpot prize of exactly 0 (means no jackpot for that color)", () => {
    const c = validConfig();
    c.jackpot.prizeByColor = { white: 0, yellow: 0, purple: 0 };
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
});
