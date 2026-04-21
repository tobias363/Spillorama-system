/**
 * GAME1_SCHEDULE PR 4c Bolk 3: Tester for Game1JackpotService.
 *
 * Dekker alle 5 reglene:
 *   1) Kun fase 5 (Fullt Hus).
 *   2) drawSequenceAtWin <= jackpot.draw.
 *   3) Farge-basert prizeByColor (yellow/white/purple).
 *   4) Kroner → øre konvertering.
 *   5) 0-prize = ingen jackpot.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  Game1JackpotService,
  resolveColorFamily,
  type Game1JackpotConfig,
} from "./Game1JackpotService.js";

function defaultConfig(): Game1JackpotConfig {
  return {
    prizeByColor: { yellow: 10000, white: 5000, purple: 20000 },
    draw: 50,
  };
}

// ── Regel 1: kun fase 5 ────────────────────────────────────────────────────

test("evaluate: fase 1 → ikke trigget selv om alle andre vilkår OK", () => {
  const svc = new Game1JackpotService();
  const r = svc.evaluate({
    phase: 1,
    drawSequenceAtWin: 40,
    ticketColor: "small_yellow",
    jackpotConfig: defaultConfig(),
  });
  assert.equal(r.triggered, false);
  assert.equal(r.amountCents, 0);
});

test("evaluate: fase 2..4 → ikke trigget", () => {
  const svc = new Game1JackpotService();
  for (const phase of [2, 3, 4]) {
    const r = svc.evaluate({
      phase,
      drawSequenceAtWin: 40,
      ticketColor: "small_yellow",
      jackpotConfig: defaultConfig(),
    });
    assert.equal(r.triggered, false, `fase ${phase} skal ikke trigge`);
  }
});

// ── Regel 2: drawSequenceAtWin <= jackpot.draw ─────────────────────────────

test("evaluate: Fullt Hus vunnet PÅ jackpot.draw (=50) → trigget", () => {
  const svc = new Game1JackpotService();
  const r = svc.evaluate({
    phase: 5,
    drawSequenceAtWin: 50,
    ticketColor: "small_yellow",
    jackpotConfig: defaultConfig(),
  });
  assert.equal(r.triggered, true);
  assert.equal(r.amountCents, 10000 * 100);
});

test("evaluate: Fullt Hus vunnet FØR jackpot.draw → trigget", () => {
  const svc = new Game1JackpotService();
  const r = svc.evaluate({
    phase: 5,
    drawSequenceAtWin: 45,
    ticketColor: "large_yellow",
    jackpotConfig: defaultConfig(),
  });
  assert.equal(r.triggered, true);
});

test("evaluate: Fullt Hus vunnet ETTER jackpot.draw → ikke trigget", () => {
  const svc = new Game1JackpotService();
  const r = svc.evaluate({
    phase: 5,
    drawSequenceAtWin: 51,
    ticketColor: "small_yellow",
    jackpotConfig: defaultConfig(),
  });
  assert.equal(r.triggered, false);
  assert.equal(r.amountCents, 0);
});

test("evaluate: drawSequence 0 eller negativ → ikke trigget", () => {
  const svc = new Game1JackpotService();
  for (const seq of [0, -1]) {
    const r = svc.evaluate({
      phase: 5,
      drawSequenceAtWin: seq,
      ticketColor: "small_yellow",
      jackpotConfig: defaultConfig(),
    });
    assert.equal(r.triggered, false);
  }
});

// ── Regel 3: farge-basert ──────────────────────────────────────────────────

test("evaluate: farge-familier → riktig prize", () => {
  const svc = new Game1JackpotService();
  const cfg = defaultConfig();

  const yellow = svc.evaluate({
    phase: 5,
    drawSequenceAtWin: 30,
    ticketColor: "small_yellow",
    jackpotConfig: cfg,
  });
  assert.equal(yellow.colorFamily, "yellow");
  assert.equal(yellow.amountCents, 10000 * 100);

  const white = svc.evaluate({
    phase: 5,
    drawSequenceAtWin: 30,
    ticketColor: "large_white",
    jackpotConfig: cfg,
  });
  assert.equal(white.colorFamily, "white");
  assert.equal(white.amountCents, 5000 * 100);

  const purple = svc.evaluate({
    phase: 5,
    drawSequenceAtWin: 30,
    ticketColor: "small_purple",
    jackpotConfig: cfg,
  });
  assert.equal(purple.colorFamily, "purple");
  assert.equal(purple.amountCents, 20000 * 100);
});

test("evaluate: elvis/red/green/orange → ikke trigget hvis ikke i config (#316)", () => {
  // cfg har bare yellow/white/purple. elvis/red/green/orange → triggered=false.
  const svc = new Game1JackpotService();
  const cfg = defaultConfig();
  const colorFamilyByColor: Record<string, string> = {
    elvis1: "elvis",
    elvis5: "elvis",
    small_red: "red",
    small_green: "green",
    small_orange: "orange",
  };
  for (const color of Object.keys(colorFamilyByColor)) {
    const r = svc.evaluate({
      phase: 5,
      drawSequenceAtWin: 30,
      ticketColor: color,
      jackpotConfig: cfg,
    });
    assert.equal(r.triggered, false, `farge ${color} skal ikke trigge jackpot`);
    assert.equal(r.colorFamily, colorFamilyByColor[color]);
  }
});

test("evaluate (#316): exact ticket-color match vinner over familie-fallback", () => {
  const svc = new Game1JackpotService();
  // Config har BÅDE eksakt 'small_yellow' OG farge-familie 'yellow'.
  // Exact match skal vinne.
  const r = svc.evaluate({
    phase: 5,
    drawSequenceAtWin: 30,
    ticketColor: "small_yellow",
    jackpotConfig: {
      prizeByColor: { small_yellow: 30000, yellow: 10000 },
      draw: 50,
    },
  });
  assert.equal(r.triggered, true);
  assert.equal(r.lookupMatch, "exact");
  assert.equal(r.amountCents, 30000 * 100);
});

test("evaluate (#316): fallback til farge-familie hvis ingen exact match", () => {
  const svc = new Game1JackpotService();
  const r = svc.evaluate({
    phase: 5,
    drawSequenceAtWin: 30,
    ticketColor: "small_yellow",
    jackpotConfig: {
      prizeByColor: { yellow: 10000 }, // ingen small_yellow
      draw: 50,
    },
  });
  assert.equal(r.triggered, true);
  assert.equal(r.lookupMatch, "family");
  assert.equal(r.amountCents, 10000 * 100);
});

test("evaluate (#316): elvis-farge får jackpot hvis konfigurert", () => {
  const svc = new Game1JackpotService();
  // #316 utvider til 14 farger. Elvis3 med eksakt konfig skal trigge.
  const r = svc.evaluate({
    phase: 5,
    drawSequenceAtWin: 30,
    ticketColor: "elvis3",
    jackpotConfig: {
      prizeByColor: { elvis3: 25000 },
      draw: 50,
    },
  });
  assert.equal(r.triggered, true);
  assert.equal(r.lookupMatch, "exact");
  assert.equal(r.amountCents, 25000 * 100);
});

test("evaluate (#316): elvis-familie-fallback for alle elvis-tickets", () => {
  const svc = new Game1JackpotService();
  // Konfig har bare 'elvis' som familie-nøkkel, ikke elvis1/2/3/4/5 individuelt.
  for (const color of ["elvis1", "elvis2", "elvis3", "elvis4", "elvis5"]) {
    const r = svc.evaluate({
      phase: 5,
      drawSequenceAtWin: 30,
      ticketColor: color,
      jackpotConfig: {
        prizeByColor: { elvis: 15000 },
        draw: 50,
      },
    });
    assert.equal(r.triggered, true, `farge ${color} skal trigge via elvis-familie`);
    assert.equal(r.lookupMatch, "family");
    assert.equal(r.amountCents, 15000 * 100);
  }
});

// ── Regel 5: 0-prize = av ──────────────────────────────────────────────────

test("evaluate: 0-prize for yellow → ikke trigget selv om Fullt Hus PÅ draw", () => {
  const svc = new Game1JackpotService();
  const r = svc.evaluate({
    phase: 5,
    drawSequenceAtWin: 45,
    ticketColor: "small_yellow",
    jackpotConfig: {
      prizeByColor: { yellow: 0, white: 5000, purple: 20000 },
      draw: 50,
    },
  });
  assert.equal(r.triggered, false);
  assert.equal(r.amountCents, 0);
});

// ── resolveColorFamily unit-tester ─────────────────────────────────────────

test("resolveColorFamily: suffiks-match", () => {
  assert.equal(resolveColorFamily("small_yellow"), "yellow");
  assert.equal(resolveColorFamily("large_yellow"), "yellow");
  assert.equal(resolveColorFamily("SMALL_WHITE"), "white");
  assert.equal(resolveColorFamily("large_purple"), "purple");
});

test("resolveColorFamily: bare farge-navn (legacy)", () => {
  assert.equal(resolveColorFamily("yellow"), "yellow");
  assert.equal(resolveColorFamily("WHITE"), "white");
  assert.equal(resolveColorFamily("purple"), "purple");
});

test("resolveColorFamily: whitespace tolerant", () => {
  assert.equal(resolveColorFamily("  yellow  "), "yellow");
});

test("resolveColorFamily: ukjente farger og tom → 'other'", () => {
  for (const color of ["rainbow", "", "unknown", "foo_bar"]) {
    assert.equal(resolveColorFamily(color), "other");
  }
});

test("resolveColorFamily (#316): elvis1..5 → 'elvis' familien", () => {
  for (const color of ["elvis1", "elvis2", "elvis3", "elvis4", "elvis5", "ELVIS1"]) {
    assert.equal(resolveColorFamily(color), "elvis");
  }
});

test("resolveColorFamily (#316): red/green/orange utvidet til egne familier", () => {
  assert.equal(resolveColorFamily("small_red"), "red");
  assert.equal(resolveColorFamily("large_red"), "red");
  assert.equal(resolveColorFamily("red"), "red");
  assert.equal(resolveColorFamily("small_green"), "green");
  assert.equal(resolveColorFamily("green"), "green");
  assert.equal(resolveColorFamily("small_orange"), "orange");
  assert.equal(resolveColorFamily("orange"), "orange");
});
