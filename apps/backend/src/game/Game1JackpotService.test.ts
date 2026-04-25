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

// ── 4c-services-coverage tillegg: config-defensivity + fallback-kombinasjoner ──

test("defensivity: jackpot.draw ugyldig (negativ, 0, undefined, NaN, Infinity) → aldri trigget", () => {
  // Regulatorisk fail-closed mot rusk fra ticket_config_json
  // (pengespillforskriften §11).
  //
  // - draw=undefined → `?? 0` gjør det til 0, `drawSeq > 0` fanger.
  // - draw=0 eller negativ → samme path.
  // - draw=NaN → `Math.floor(NaN)=NaN`, fanget av eksplisitt
  //   `!Number.isFinite(maxDraw)`-guard. Uten denne fanget `x > NaN` er
  //   false → jackpot ville feilaktig utløses.
  // - draw=Infinity → `Math.floor(Infinity)=Infinity`, fanget av samme
  //   isFinite-guard. Uten det ville ENHVER drawSeq tillate jackpot.
  const svc = new Game1JackpotService();
  const badDraws = [
    -1,
    0,
    undefined as unknown as number,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ];
  for (const draw of badDraws) {
    const r = svc.evaluate({
      phase: 5,
      drawSequenceAtWin: 10, // ville vært OK ved normal draw-verdi
      ticketColor: "small_yellow",
      jackpotConfig: { prizeByColor: { yellow: 10000 }, draw },
    });
    assert.equal(r.triggered, false, `draw=${draw}: skal ikke trigge`);
    assert.equal(r.amountCents, 0);
  }
});

test("defensivity: prizeByColor helt fraværende (undefined) → fail-closed non-triggered", () => {
  // Config-shape-variasjoner fra DB: {} eller {prizeByColor: undefined}.
  // Koden har `?? {}` — men sjekker eksakt og familie-fallback mot den.
  // Verifisér at begge paths gir `triggered: false, lookupMatch: 'none'`.
  const svc = new Game1JackpotService();

  const r1 = svc.evaluate({
    phase: 5, drawSequenceAtWin: 30, ticketColor: "small_yellow",
    // @ts-expect-error — tester kjøretids-defensivitet mot manglende felt
    jackpotConfig: { draw: 50 },
  });
  assert.equal(r1.triggered, false);
  assert.equal(r1.amountCents, 0);
  assert.equal(r1.lookupMatch, "none");

  const r2 = svc.evaluate({
    phase: 5, drawSequenceAtWin: 30, ticketColor: "small_yellow",
    jackpotConfig: { prizeByColor: {}, draw: 50 },
  });
  assert.equal(r2.triggered, false);
  assert.equal(r2.lookupMatch, "none");
});

test("fallback-subtilitet: exact=0 faller til familie>0 (fordi >0-check)", () => {
  // Koden: `if (typeof exact === "number" && Number.isFinite(exact) &&
  // exact > 0)`. Hvis exact er 0 eksplisitt konfigurert (admin "av'er"
  // én farge men beholder familie-fallback), skal family brukes.
  const svc = new Game1JackpotService();
  const r = svc.evaluate({
    phase: 5, drawSequenceAtWin: 30, ticketColor: "small_yellow",
    jackpotConfig: {
      prizeByColor: { small_yellow: 0, yellow: 5000 },
      draw: 50,
    },
  });
  // exact=0 avvises → faller til family 'yellow' = 5000.
  assert.equal(r.triggered, true);
  assert.equal(r.lookupMatch, "family");
  assert.equal(r.amountCents, 5000 * 100);
});

test("Math.floor på jackpot.draw: 50.9 → 50 (PÅ) / 50.1 → 50 (PÅ)", () => {
  // Låser tolkningen: Math.floor gjør at 50.x → 50 uansett x.
  // Draw-sekvens=50 er da PÅ grensen, skal trigge.
  const svc = new Game1JackpotService();
  for (const drawCfg of [50.9, 50.1, 50.0]) {
    const r = svc.evaluate({
      phase: 5, drawSequenceAtWin: 50, ticketColor: "small_yellow",
      jackpotConfig: { prizeByColor: { yellow: 10000 }, draw: drawCfg },
    });
    assert.equal(
      r.triggered, true,
      `draw=${drawCfg}: Math.floor→50, drawSeq=50 skal trigge`,
    );
  }
  // Drawseq=51 med draw=50.9 skal IKKE trigge (floor(50.9)=50 < 51).
  const r51 = svc.evaluate({
    phase: 5, drawSequenceAtWin: 51, ticketColor: "small_yellow",
    jackpotConfig: { prizeByColor: { yellow: 10000 }, draw: 50.9 },
  });
  assert.equal(r51.triggered, false, "drawSeq=51 > floor(50.9)=50 → ikke trigget");
});

// ── Audit-funn 2026-04-25: case-sensitivity + edge cases ───────────────────

test("case-insensitive: ticketColor 'SMALL_YELLOW' (uppercase) finner 'small_yellow' i config", () => {
  // Service lowercaser ticketColor før oppslag (Game1JackpotService.ts:111).
  // Locker kontrakten: admin kan lagre 'small_yellow' i config og spilleren
  // kan komme inn med 'SMALL_YELLOW' eller 'Small_Yellow' uten å miste jackpot.
  const svc = new Game1JackpotService();
  for (const variant of ["SMALL_YELLOW", "Small_Yellow", "small_YELLOW"]) {
    const r = svc.evaluate({
      phase: 5,
      drawSequenceAtWin: 30,
      ticketColor: variant,
      jackpotConfig: { prizeByColor: { small_yellow: 25000 }, draw: 50 },
    });
    assert.equal(r.triggered, true, `farge=${variant}: case-insensitive lookup`);
    assert.equal(r.lookupMatch, "exact");
    assert.equal(r.amountCents, 25000 * 100);
  }
});

test("case-insensitive: ticketColor whitespace-padded matcher exact lookup", () => {
  // ticketColor.trim() før oppslag — admin kan ikke se whitespace, men
  // database-input kan ha det fra import-skript. Ikke brytende hvis vi
  // er tolerant.
  const svc = new Game1JackpotService();
  const r = svc.evaluate({
    phase: 5,
    drawSequenceAtWin: 30,
    ticketColor: "  small_yellow  ",
    jackpotConfig: { prizeByColor: { small_yellow: 5000 }, draw: 50 },
  });
  assert.equal(r.triggered, true, "trimmed ticketColor finner exact-match");
  assert.equal(r.amountCents, 5000 * 100);
});

test("edge-case: tom ticketColor → ingen exact-lookup, faller til familie 'other' → ikke trigget", () => {
  // Tom string er truthy etter trim() returnerer "", som er falsy. Service
  // skipper exact-lookup når ticketLc er tom og faller til
  // resolveColorFamily("") = "other" → returneres som ikke-trigget.
  const svc = new Game1JackpotService();
  const r = svc.evaluate({
    phase: 5,
    drawSequenceAtWin: 30,
    ticketColor: "",
    jackpotConfig: { prizeByColor: { yellow: 10000 }, draw: 50 },
  });
  assert.equal(r.triggered, false);
  assert.equal(r.colorFamily, "other");
  assert.equal(r.lookupMatch, "none");
});

test("edge-case: ticketColor null/undefined → behandlet som tom, fail-closed", () => {
  // Service har `(input.ticketColor ?? "").toLowerCase().trim()` —
  // null/undefined koerses til tom string.
  const svc = new Game1JackpotService();
  for (const bad of [null, undefined]) {
    const r = svc.evaluate({
      phase: 5,
      drawSequenceAtWin: 30,
      ticketColor: bad as unknown as string,
      jackpotConfig: { prizeByColor: { yellow: 10000 }, draw: 50 },
    });
    assert.equal(r.triggered, false, `ticketColor=${bad} → ikke trigget`);
  }
});

test("edge-case: prizeByColor med negativ verdi → ikke trigget (>0-guard)", () => {
  // Negative beløp i config — admin-feil eller datamigrering. Service har
  // eksplisitt `>0`-guard så dette aldri kan utbetale negativt jackpot.
  const svc = new Game1JackpotService();
  const r = svc.evaluate({
    phase: 5,
    drawSequenceAtWin: 30,
    ticketColor: "small_yellow",
    jackpotConfig: { prizeByColor: { small_yellow: -100, yellow: -50 }, draw: 50 },
  });
  assert.equal(r.triggered, false, "negativ prize avvises av >0-guard");
  assert.equal(r.amountCents, 0);
});

test("edge-case: prizeByColor med string-verdi → ikke trigget (typeof-guard)", () => {
  // ticket_config_json kan inneholde rusk-typer. Service sjekker
  // `typeof === 'number'` så string-tall hopper til familie-fallback.
  const svc = new Game1JackpotService();
  const r = svc.evaluate({
    phase: 5,
    drawSequenceAtWin: 30,
    ticketColor: "small_yellow",
    jackpotConfig: {
      prizeByColor: { small_yellow: "10000" as unknown as number },
      draw: 50,
    },
  });
  // exact-lookup avvist, faller til 'yellow' familie som ikke finnes.
  assert.equal(r.triggered, false);
  assert.equal(r.lookupMatch, "none");
});

test("edge-case: prizeByColor med NaN → ikke trigget", () => {
  // Number.isFinite-guard avviser NaN.
  const svc = new Game1JackpotService();
  const r = svc.evaluate({
    phase: 5,
    drawSequenceAtWin: 30,
    ticketColor: "small_yellow",
    jackpotConfig: { prizeByColor: { small_yellow: NaN, yellow: NaN }, draw: 50 },
  });
  assert.equal(r.triggered, false);
});

test("regulatorisk: drawSequenceAtWin === maxDraw (boundary) trigger jackpot — pengespillforskriften §11", () => {
  // Eksakt grense skal være INKLUSIV (drawSequenceAtWin <= maxDraw).
  // Locker kontrakten mot off-by-one-feil. Pengespillforskriften §11:
  // jackpot-utbetaling må være forutsigbar.
  const svc = new Game1JackpotService();
  for (const draw of [50, 55, 59]) {
    const r = svc.evaluate({
      phase: 5,
      drawSequenceAtWin: draw,
      ticketColor: "small_yellow",
      jackpotConfig: { prizeByColor: { yellow: 10000 }, draw },
    });
    assert.equal(r.triggered, true, `drawSeq=${draw}=maxDraw skal trigge (inklusiv grense)`);
  }
});

test("regulatorisk: drawSequenceAtWin === maxDraw + 1 (just-over) ikke trigget", () => {
  // Off-by-one regression-guard — pengespillforskriften §11.
  const svc = new Game1JackpotService();
  for (const draw of [50, 55, 59]) {
    const r = svc.evaluate({
      phase: 5,
      drawSequenceAtWin: draw + 1,
      ticketColor: "small_yellow",
      jackpotConfig: { prizeByColor: { yellow: 10000 }, draw },
    });
    assert.equal(r.triggered, false, `drawSeq=${draw + 1} > maxDraw=${draw} skal IKKE trigge`);
  }
});

test("idempotency: same input gir alltid samme output (pure-service-kontrakt)", () => {
  // Service skal være helt deterministisk uten side-effekter. Locker
  // dette så ingen senere kan introdusere caching, side-effekter, eller
  // implicit Math.random.
  const svc = new Game1JackpotService();
  const cfg = { prizeByColor: { yellow: 10000 }, draw: 50 };
  const r1 = svc.evaluate({ phase: 5, drawSequenceAtWin: 45, ticketColor: "small_yellow", jackpotConfig: cfg });
  const r2 = svc.evaluate({ phase: 5, drawSequenceAtWin: 45, ticketColor: "small_yellow", jackpotConfig: cfg });
  const r3 = svc.evaluate({ phase: 5, drawSequenceAtWin: 45, ticketColor: "small_yellow", jackpotConfig: cfg });
  assert.deepEqual(r1, r2);
  assert.deepEqual(r2, r3);
});

test("kr-til-øre konvertering: 99.99 kroner → 9999 øre (Math.round-kontrakt)", () => {
  // Finansielle tall lagres som heltall-øre. JavaScript-floats kan tape
  // presisjon: 99.99 * 100 = 9998.999... — Math.round redder oss.
  // Locker kontrakten mot at noen senere bytter til Math.floor.
  const svc = new Game1JackpotService();
  const r = svc.evaluate({
    phase: 5,
    drawSequenceAtWin: 30,
    ticketColor: "small_yellow",
    jackpotConfig: { prizeByColor: { yellow: 99.99 }, draw: 50 },
  });
  assert.equal(r.triggered, true);
  assert.equal(r.amountCents, 9999, "99.99 kr → 9999 øre via Math.round");
});

test("colorFamily bevart i resultat selv ved ikke-trigget", () => {
  // Klient/audit kan se colorFamily i resultatet for diagnostikk når
  // jackpot ikke utløses (admin debugging, "hvorfor fikk denne ikke jackpot?").
  const svc = new Game1JackpotService();
  // Fase 1 (ikke 5) → ikke trigget, men colorFamily skal fortsatt være "yellow".
  const r = svc.evaluate({
    phase: 1,
    drawSequenceAtWin: 30,
    ticketColor: "large_yellow",
    jackpotConfig: { prizeByColor: { yellow: 10000 }, draw: 50 },
  });
  assert.equal(r.triggered, false);
  assert.equal(r.colorFamily, "yellow", "colorFamily bevart for diagnostikk");
});
