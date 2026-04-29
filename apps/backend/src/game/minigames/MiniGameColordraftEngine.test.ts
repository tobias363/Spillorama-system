/**
 * BIN-690 Spor 3 M4: unit-tester for MiniGameColordraftEngine.
 *
 * Dekning:
 *   - parseColordraftConfig: tom config → default, malformed → throw, gyldig
 *     passes through (med default + overridden farger + prize-amounts).
 *   - sampleColordraftState: uniform fra palette, target alltid i slots
 *     (garanti), deterministisk med injected RNG.
 *   - trigger: returnerer korrekt payload-shape, bruker configSnapshot,
 *     eksponerer ALLE nødvendige felter (targetColor + slotColors) slik at
 *     klient kan rendre luke-UI.
 *   - handleChoice: server-autoritativ state-rekonstruksjon via seed,
 *     match → winPrize, mismatch → consolationPrize, INVALID_CHOICE ved
 *     ugyldig index.
 *   - Determinisme: trigger og handleChoice gir samme state for samme
 *     resultId (seeded RNG-mønster).
 *   - Klient kan ikke lede — chosenIndex-payload får ingen innflytelse
 *     over targetColor eller slotColors.
 *   - Edge-cases: consolation=0, palette med 1 farge, mange luker, osv.
 *   - type === "colordraft"-konstant.
 *
 * Integrasjonstester ligger i `MiniGameColordraftEngine.integration.test.ts`.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_COLORDRAFT_CONFIG,
  MiniGameColordraftEngine,
  parseColordraftConfig,
  sampleColordraftState,
  type ColordraftConfig,
  type ColordraftResultJson,
  type ColordraftRng,
} from "./MiniGameColordraftEngine.js";
import type { MiniGameTriggerContext } from "./types.js";
import { DomainError } from "../../errors/DomainError.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeContext(
  configSnapshot: Readonly<Record<string, unknown>> = {},
  overrideResultId?: string,
): MiniGameTriggerContext {
  return {
    resultId: overrideResultId ?? "mgr-colordraft-test-1",
    scheduledGameId: "sg-colordraft-1",
    winnerUserId: "u-1",
    winnerWalletId: "w-1",
    hallId: "h-1",
    drawSequenceAtWin: 45,
    configSnapshot,
  };
}

/** Deterministisk RNG for tester. Returnerer sekvens av forhåndsbestemte verdier. */
function makeSequencedRng(values: number[]): ColordraftRng {
  let i = 0;
  return {
    nextInt: (max: number) => {
      if (i >= values.length) {
        throw new Error(
          `SequencedRng tømt etter ${values.length} kall (max=${max})`,
        );
      }
      const v = values[i]!;
      i += 1;
      if (v < 0 || v >= max) {
        throw new Error(
          `SequencedRng: value ${v} out-of-range for max ${max}`,
        );
      }
      return v;
    },
  };
}

// ── parseColordraftConfig ────────────────────────────────────────────────────

test("BIN-690 M4: parseColordraftConfig — tom configSnapshot returnerer default", () => {
  assert.deepEqual(parseColordraftConfig({}), DEFAULT_COLORDRAFT_CONFIG);
});

test("BIN-690 M4: parseColordraftConfig — default har 12 luker, 4 farger, 1000 winPrize, 0 consolation", () => {
  assert.equal(DEFAULT_COLORDRAFT_CONFIG.numberOfSlots, 12);
  assert.equal(DEFAULT_COLORDRAFT_CONFIG.colorPalette.length, 4);
  assert.deepEqual(
    [...DEFAULT_COLORDRAFT_CONFIG.colorPalette],
    ["yellow", "blue", "red", "green"],
  );
  assert.equal(DEFAULT_COLORDRAFT_CONFIG.winPrizeNok, 1000);
  assert.equal(DEFAULT_COLORDRAFT_CONFIG.consolationPrizeNok, 0);
});

test("BIN-690 M4: parseColordraftConfig — kun 'active' i config faller tilbake til default", () => {
  assert.deepEqual(
    parseColordraftConfig({ active: true }),
    DEFAULT_COLORDRAFT_CONFIG,
  );
});

test("BIN-690 M4: parseColordraftConfig — aksepterer gyldig full config", () => {
  const cfg = parseColordraftConfig({
    numberOfSlots: 6,
    colorPalette: ["red", "blue"],
    winPrizeNok: 500,
    consolationPrizeNok: 50,
  });
  assert.equal(cfg.numberOfSlots, 6);
  assert.deepEqual([...cfg.colorPalette], ["red", "blue"]);
  assert.equal(cfg.winPrizeNok, 500);
  assert.equal(cfg.consolationPrizeNok, 50);
});

test("BIN-690 M4: parseColordraftConfig — partial config merges med default", () => {
  // Kun numberOfSlots override → behold default-palette og -prizes.
  const cfg = parseColordraftConfig({ numberOfSlots: 20 });
  assert.equal(cfg.numberOfSlots, 20);
  assert.deepEqual(
    [...cfg.colorPalette],
    [...DEFAULT_COLORDRAFT_CONFIG.colorPalette],
  );
  assert.equal(cfg.winPrizeNok, DEFAULT_COLORDRAFT_CONFIG.winPrizeNok);
});

test("BIN-690 M4: parseColordraftConfig — numberOfSlots < 2 → INVALID_COLORDRAFT_CONFIG", () => {
  assert.throws(
    () => parseColordraftConfig({ numberOfSlots: 1 }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_COLORDRAFT_CONFIG",
  );
});

test("BIN-690 M4: parseColordraftConfig — non-integer numberOfSlots → INVALID_COLORDRAFT_CONFIG", () => {
  assert.throws(
    () => parseColordraftConfig({ numberOfSlots: 12.5 }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_COLORDRAFT_CONFIG",
  );
});

test("BIN-690 M4: parseColordraftConfig — colorPalette er ikke-array → INVALID_COLORDRAFT_CONFIG", () => {
  assert.throws(
    () =>
      parseColordraftConfig({
        numberOfSlots: 12,
        colorPalette: "red" as unknown as string[],
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_COLORDRAFT_CONFIG",
  );
});

test("BIN-690 M4: parseColordraftConfig — tom colorPalette → INVALID_COLORDRAFT_CONFIG", () => {
  assert.throws(
    () =>
      parseColordraftConfig({
        numberOfSlots: 12,
        colorPalette: [],
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_COLORDRAFT_CONFIG",
  );
});

test("BIN-690 M4: parseColordraftConfig — colorPalette entry ikke-streng → INVALID_COLORDRAFT_CONFIG", () => {
  assert.throws(
    () =>
      parseColordraftConfig({
        numberOfSlots: 12,
        colorPalette: ["red", 42 as unknown as string],
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_COLORDRAFT_CONFIG",
  );
});

test("BIN-690 M4: parseColordraftConfig — tom streng i palette → INVALID_COLORDRAFT_CONFIG", () => {
  assert.throws(
    () =>
      parseColordraftConfig({
        numberOfSlots: 12,
        colorPalette: ["red", ""],
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_COLORDRAFT_CONFIG",
  );
});

test("BIN-690 M4: parseColordraftConfig — negativ winPrizeNok → INVALID_COLORDRAFT_CONFIG", () => {
  assert.throws(
    () =>
      parseColordraftConfig({
        numberOfSlots: 12,
        winPrizeNok: -100,
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_COLORDRAFT_CONFIG",
  );
});

test("BIN-690 M4: parseColordraftConfig — non-integer winPrizeNok → INVALID_COLORDRAFT_CONFIG", () => {
  assert.throws(
    () =>
      parseColordraftConfig({
        numberOfSlots: 12,
        winPrizeNok: 1000.5,
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_COLORDRAFT_CONFIG",
  );
});

test("BIN-690 M4: parseColordraftConfig — negativ consolationPrizeNok → INVALID_COLORDRAFT_CONFIG", () => {
  assert.throws(
    () =>
      parseColordraftConfig({
        numberOfSlots: 12,
        consolationPrizeNok: -50,
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_COLORDRAFT_CONFIG",
  );
});

test("BIN-690 M4: parseColordraftConfig — winPrize=0 er gyldig (ingen premie)", () => {
  const cfg = parseColordraftConfig({
    numberOfSlots: 12,
    winPrizeNok: 0,
    consolationPrizeNok: 0,
  });
  assert.equal(cfg.winPrizeNok, 0);
  assert.equal(cfg.consolationPrizeNok, 0);
});

test("BIN-690 M4: parseColordraftConfig — palette med 1 farge er gyldig (alltid match)", () => {
  const cfg = parseColordraftConfig({
    numberOfSlots: 12,
    colorPalette: ["red"],
  });
  assert.equal(cfg.colorPalette.length, 1);
});

// ── sampleColordraftState ────────────────────────────────────────────────────

test("BIN-690 M4: sampleColordraftState — target alltid i slotColors (garanti)", () => {
  // Lag RNG-sekvens som IKKE treffer target etter target-trekning.
  // Target-index = 0 (palette[0] = "red"). Alle 12 slot-trekninger → 1 ("blue").
  // Siden target ikke naturlig havner, bruker vi fail-safe-overwrite-branchen.
  // Overwrite-kall: nextInt(12) = f.eks. 5 → slotColors[5] = "red".
  const cfg: ColordraftConfig = {
    numberOfSlots: 12,
    colorPalette: ["red", "blue"],
    winPrizeNok: 1000,
    consolationPrizeNok: 0,
  };
  // target-pick + 12 slot-picks + 1 overwrite-pick = 14 kall.
  const rng = makeSequencedRng([0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 5]);
  const { targetColor, slotColors } = sampleColordraftState(cfg, rng);
  assert.equal(targetColor, "red");
  assert.equal(slotColors.length, 12);
  // Slot 5 skal være overskrevet til "red".
  assert.equal(slotColors[5], "red");
  // Alle andre skal være "blue".
  for (let i = 0; i < 12; i += 1) {
    if (i !== 5) assert.equal(slotColors[i], "blue");
  }
});

test("BIN-690 M4: sampleColordraftState — ingen overwrite hvis target naturlig i slots", () => {
  const cfg: ColordraftConfig = {
    numberOfSlots: 5,
    colorPalette: ["red", "blue"],
    winPrizeNok: 1000,
    consolationPrizeNok: 0,
  };
  // target=0 (red). slot-trekninger: 0, 1, 1, 1, 1 → red kommer i slot 0.
  // Ingen overwrite trengs. 1 + 5 = 6 kall.
  const rng = makeSequencedRng([0, 0, 1, 1, 1, 1]);
  const { targetColor, slotColors } = sampleColordraftState(cfg, rng);
  assert.equal(targetColor, "red");
  assert.deepEqual(slotColors, ["red", "blue", "blue", "blue", "blue"]);
});

test("BIN-690 M4: sampleColordraftState — palette med 1 farge → alle slots = target", () => {
  const cfg: ColordraftConfig = {
    numberOfSlots: 3,
    colorPalette: ["red"],
    winPrizeNok: 1000,
    consolationPrizeNok: 0,
  };
  // 1 + 3 = 4 kall (alle 0 siden palette-lengde er 1).
  const rng = makeSequencedRng([0, 0, 0, 0]);
  const { targetColor, slotColors } = sampleColordraftState(cfg, rng);
  assert.equal(targetColor, "red");
  assert.deepEqual(slotColors, ["red", "red", "red"]);
});

test("BIN-690 M4: sampleColordraftState — alle slot-verdier er fra paletten", () => {
  const cfg = DEFAULT_COLORDRAFT_CONFIG;
  const rng: ColordraftRng = {
    nextInt: (max: number) => Math.floor(Math.random() * max),
  };
  const { targetColor, slotColors } = sampleColordraftState(cfg, rng);
  assert.ok(cfg.colorPalette.includes(targetColor));
  for (const c of slotColors) {
    assert.ok(
      cfg.colorPalette.includes(c),
      `slot-farge ${c} er ikke i palette ${cfg.colorPalette.join(",")}`,
    );
  }
});

// ── trigger ──────────────────────────────────────────────────────────────────

test("BIN-690 M4: trigger — returnerer korrekt payload-struktur for default-config", () => {
  const engine = new MiniGameColordraftEngine();
  const payload = engine.trigger(makeContext());
  assert.equal(payload.type, "colordraft");
  assert.equal(payload.resultId, "mgr-colordraft-test-1");
  assert.equal(payload.timeoutSeconds, 60);
  const inner = payload.payload as Record<string, unknown>;
  assert.equal(inner.numberOfSlots, 12);
  assert.ok(typeof inner.targetColor === "string");
  assert.ok(Array.isArray(inner.slotColors));
  assert.equal((inner.slotColors as string[]).length, 12);
  assert.equal(inner.winPrizeNok, 1000);
  assert.equal(inner.consolationPrizeNok, 0);
});

test("BIN-690 M4: trigger — deterministisk basert på resultId (samme resultId → samme state)", () => {
  const engine = new MiniGameColordraftEngine();
  const p1 = engine.trigger(makeContext({}, "mgr-deterministic-test"));
  const p2 = engine.trigger(makeContext({}, "mgr-deterministic-test"));
  const i1 = p1.payload as Record<string, unknown>;
  const i2 = p2.payload as Record<string, unknown>;
  assert.equal(i1.targetColor, i2.targetColor);
  assert.deepEqual(i1.slotColors, i2.slotColors);
});

test("BIN-690 M4: trigger — forskjellig resultId → typisk forskjellig state", () => {
  // Teknisk KAN to UUID-er gi samme state ved hell, men sjansen er
  // astronomisk liten. Vi sjekker bare at vi ikke alltid får samme state.
  const engine = new MiniGameColordraftEngine();
  const results = new Set<string>();
  for (let i = 0; i < 10; i += 1) {
    const p = engine.trigger(makeContext({}, `mgr-uniq-${i}`));
    const inner = p.payload as Record<string, unknown>;
    results.add(
      `${inner.targetColor}|${(inner.slotColors as string[]).join(",")}`,
    );
  }
  assert.ok(results.size > 1, "Minst 2 forskjellige states forventet");
});

test("BIN-690 M4: trigger — target-farge alltid finnes i slotColors", () => {
  const engine = new MiniGameColordraftEngine();
  // Sjekk over mange resultIds at target alltid har minst én matching slot.
  for (let i = 0; i < 50; i += 1) {
    const payload = engine.trigger(makeContext({}, `mgr-target-check-${i}`));
    const inner = payload.payload as Record<string, unknown>;
    const target = inner.targetColor as string;
    const slots = inner.slotColors as string[];
    assert.ok(
      slots.includes(target),
      `resultId ${i}: target ${target} mangler i slots [${slots.join(",")}]`,
    );
  }
});

test("BIN-690 M4: trigger — bruker admin-configSnapshot (override default)", () => {
  const engine = new MiniGameColordraftEngine();
  const payload = engine.trigger(
    makeContext({
      numberOfSlots: 6,
      colorPalette: ["orange", "purple"],
      winPrizeNok: 2500,
      consolationPrizeNok: 100,
    }),
  );
  const inner = payload.payload as Record<string, unknown>;
  assert.equal(inner.numberOfSlots, 6);
  assert.equal(inner.winPrizeNok, 2500);
  assert.equal(inner.consolationPrizeNok, 100);
  const slots = inner.slotColors as string[];
  assert.equal(slots.length, 6);
  for (const c of slots) {
    assert.ok(["orange", "purple"].includes(c));
  }
  assert.ok(["orange", "purple"].includes(inner.targetColor as string));
});

test("BIN-690 M4: trigger — malformed config kaster INVALID_COLORDRAFT_CONFIG", () => {
  const engine = new MiniGameColordraftEngine();
  assert.throws(
    () =>
      engine.trigger(
        makeContext({
          numberOfSlots: "not-a-number" as unknown as number,
        }),
      ),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_COLORDRAFT_CONFIG",
  );
});

// ── handleChoice ─────────────────────────────────────────────────────────────

test("BIN-690 M4: handleChoice — match riktig farge → full winPrize payout", async () => {
  const engine = new MiniGameColordraftEngine();
  const ctx = makeContext();
  // Først trigger for å få state vi kan bruke.
  const payload = engine.trigger(ctx);
  const inner = payload.payload as Record<string, unknown>;
  const target = inner.targetColor as string;
  const slots = inner.slotColors as string[];
  // Finn en matching-luke.
  const matchIndex = slots.indexOf(target);
  assert.ok(matchIndex >= 0, "Target-farge bør finnes i minst én slot");

  const result = await engine.handleChoice({
    resultId: ctx.resultId,
    context: ctx,
    choiceJson: { chosenIndex: matchIndex },
  });
  const json = result.resultJson as ColordraftResultJson;
  assert.equal(json.matched, true);
  assert.equal(json.targetColor, target);
  assert.equal(json.chosenColor, target);
  assert.equal(json.chosenIndex, matchIndex);
  assert.equal(json.prizeAmountKroner, 1000);
  assert.equal(result.payoutCents, 100_000);
});

test("BIN-690 M4: handleChoice — mismatch farge → consolation payout (0 default)", async () => {
  const engine = new MiniGameColordraftEngine();
  const ctx = makeContext();
  const payload = engine.trigger(ctx);
  const inner = payload.payload as Record<string, unknown>;
  const target = inner.targetColor as string;
  const slots = inner.slotColors as string[];
  // Finn en IKKE-matching-luke.
  const mismatchIndex = slots.findIndex((c) => c !== target);
  if (mismatchIndex < 0) {
    // Skip denne testen hvis alle slots er target (palette med 1 farge).
    return;
  }

  const result = await engine.handleChoice({
    resultId: ctx.resultId,
    context: ctx,
    choiceJson: { chosenIndex: mismatchIndex },
  });
  const json = result.resultJson as ColordraftResultJson;
  assert.equal(json.matched, false);
  assert.notEqual(json.chosenColor, target);
  assert.equal(json.prizeAmountKroner, 0);
  assert.equal(result.payoutCents, 0);
});

test("BIN-690 M4: handleChoice — mismatch med consolation > 0 → consolation payout", async () => {
  const engine = new MiniGameColordraftEngine();
  const configSnapshot = {
    numberOfSlots: 6,
    colorPalette: ["red", "blue"],
    winPrizeNok: 1000,
    consolationPrizeNok: 200,
  };
  const ctx = makeContext(configSnapshot);
  const payload = engine.trigger(ctx);
  const inner = payload.payload as Record<string, unknown>;
  const target = inner.targetColor as string;
  const slots = inner.slotColors as string[];
  const mismatchIndex = slots.findIndex((c) => c !== target);
  if (mismatchIndex < 0) return; // Skip hvis alle match.

  const result = await engine.handleChoice({
    resultId: ctx.resultId,
    context: ctx,
    choiceJson: { chosenIndex: mismatchIndex },
  });
  const json = result.resultJson as ColordraftResultJson;
  assert.equal(json.matched, false);
  assert.equal(json.prizeAmountKroner, 200);
  assert.equal(result.payoutCents, 20_000);
});

test("BIN-690 M4: handleChoice — resultJson inneholder komplett state (allSlotColors, numberOfSlots)", async () => {
  const engine = new MiniGameColordraftEngine();
  const ctx = makeContext({
    numberOfSlots: 8,
    colorPalette: ["a", "b", "c"],
    winPrizeNok: 500,
    consolationPrizeNok: 10,
  });
  const result = await engine.handleChoice({
    resultId: ctx.resultId,
    context: ctx,
    choiceJson: { chosenIndex: 0 },
  });
  const json = result.resultJson as ColordraftResultJson;
  assert.equal(json.numberOfSlots, 8);
  assert.equal(json.allSlotColors.length, 8);
  assert.ok(typeof json.targetColor === "string");
  assert.ok(typeof json.chosenColor === "string");
});

test("BIN-690 M4: handleChoice — manglende chosenIndex → INVALID_CHOICE", async () => {
  const engine = new MiniGameColordraftEngine();
  await assert.rejects(
    () =>
      engine.handleChoice({
        resultId: "mgr-test-1",
        context: makeContext(),
        choiceJson: {},
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_CHOICE",
  );
});

test("BIN-690 M4: handleChoice — negativ chosenIndex → INVALID_CHOICE", async () => {
  const engine = new MiniGameColordraftEngine();
  await assert.rejects(
    () =>
      engine.handleChoice({
        resultId: "mgr-test-1",
        context: makeContext(),
        choiceJson: { chosenIndex: -1 },
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_CHOICE",
  );
});

test("BIN-690 M4: handleChoice — chosenIndex >= numberOfSlots → INVALID_CHOICE", async () => {
  const engine = new MiniGameColordraftEngine();
  await assert.rejects(
    () =>
      engine.handleChoice({
        resultId: "mgr-test-1",
        context: makeContext(), // default = 12 luker, gyldig er 0-11.
        choiceJson: { chosenIndex: 12 },
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_CHOICE",
  );
});

test("BIN-690 M4: handleChoice — chosenIndex ikke-heltall (float) → INVALID_CHOICE", async () => {
  const engine = new MiniGameColordraftEngine();
  await assert.rejects(
    () =>
      engine.handleChoice({
        resultId: "mgr-test-1",
        context: makeContext(),
        choiceJson: { chosenIndex: 2.5 },
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_CHOICE",
  );
});

test("BIN-690 M4: handleChoice — chosenIndex string → INVALID_CHOICE", async () => {
  const engine = new MiniGameColordraftEngine();
  await assert.rejects(
    () =>
      engine.handleChoice({
        resultId: "mgr-test-1",
        context: makeContext(),
        choiceJson: { chosenIndex: "0" as unknown as number },
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_CHOICE",
  );
});

test("BIN-690 M4: handleChoice — klient kan IKKE lede verdien (anti-juks)", async () => {
  // Klient sender junk-felter, men state er 100% bestemt av resultId +
  // configSnapshot. Vi verifiserer at state er reproducerbar trass junk.
  const engine = new MiniGameColordraftEngine();
  const ctx = makeContext({}, "mgr-anti-cheat-1");
  const payload = engine.trigger(ctx);
  const inner = payload.payload as Record<string, unknown>;
  const target = inner.targetColor as string;
  const slots = inner.slotColors as string[];

  const result = await engine.handleChoice({
    resultId: ctx.resultId,
    context: ctx,
    choiceJson: {
      chosenIndex: 0,
      targetColor: "HACKED",
      slotColors: ["HACKED", "HACKED"],
      prizeAmountKroner: 999999,
      cheat: true,
      matched: true,
    },
  });
  const json = result.resultJson as ColordraftResultJson;
  // Server har ignorert klient-injected state og brukt egen state.
  assert.equal(json.targetColor, target);
  assert.deepEqual([...json.allSlotColors], slots);
  assert.equal(json.chosenColor, slots[0]);
  assert.ok(json.prizeAmountKroner <= 1000); // Max er winPrize.
});

test("BIN-690 M4: handleChoice — idempotency: dobbel kall med samme input returnerer samme verdier", async () => {
  // Siden MiniGameColordraftEngine er stateless og seeded-RNG er bundet til
  // resultId, skal to kall med samme resultId gi identisk state.
  const engine = new MiniGameColordraftEngine();
  const ctx = makeContext({}, "mgr-idem-test-1");
  const r1 = await engine.handleChoice({
    resultId: ctx.resultId,
    context: ctx,
    choiceJson: { chosenIndex: 0 },
  });
  const r2 = await engine.handleChoice({
    resultId: ctx.resultId,
    context: ctx,
    choiceJson: { chosenIndex: 0 },
  });
  assert.deepEqual(r1.resultJson, r2.resultJson);
  assert.equal(r1.payoutCents, r2.payoutCents);
});

test("BIN-690 M4: handleChoice — state matcher trigger-state (samme target/slots)", async () => {
  // Kritisk paritet: det klienten ser i trigger må være EXACT samme som
  // handleChoice bruker for match-avgjørelse. Ellers kunne klienten se
  // "red" i slot 0 men serveren tror "blue" → UX-mareritt.
  const engine = new MiniGameColordraftEngine();
  const ctx = makeContext();
  const payload = engine.trigger(ctx);
  const inner = payload.payload as Record<string, unknown>;
  const triggerTarget = inner.targetColor as string;
  const triggerSlots = inner.slotColors as string[];

  const result = await engine.handleChoice({
    resultId: ctx.resultId,
    context: ctx,
    choiceJson: { chosenIndex: 3 },
  });
  const json = result.resultJson as ColordraftResultJson;
  assert.equal(json.targetColor, triggerTarget);
  assert.deepEqual([...json.allSlotColors], triggerSlots);
});

test("BIN-690 M4: handleChoice — 0-winPrize config → ingen payout selv ved match", async () => {
  const engine = new MiniGameColordraftEngine();
  const ctx = makeContext({
    numberOfSlots: 6,
    colorPalette: ["red"],
    winPrizeNok: 0,
    consolationPrizeNok: 0,
  });
  // Palette med 1 farge → alle matcher.
  const result = await engine.handleChoice({
    resultId: ctx.resultId,
    context: ctx,
    choiceJson: { chosenIndex: 0 },
  });
  const json = result.resultJson as ColordraftResultJson;
  assert.equal(json.matched, true);
  assert.equal(result.payoutCents, 0);
});

test("BIN-690 M4: handleChoice — RNG-fordeling: target alltid i slots (1k runs, default-config)", async () => {
  // Regulatorisk: server-garanti at target-fargen er vinnbar i hver runde.
  const engine = new MiniGameColordraftEngine();
  const N = 1000;
  for (let i = 0; i < N; i += 1) {
    const ctx = makeContext({}, `mgr-dist-${i}`);
    const result = await engine.handleChoice({
      resultId: ctx.resultId,
      context: ctx,
      choiceJson: { chosenIndex: 0 },
    });
    const json = result.resultJson as ColordraftResultJson;
    assert.ok(
      json.allSlotColors.includes(json.targetColor),
      `run ${i}: target ${json.targetColor} mangler i slots`,
    );
    // Alle farger skal være fra default-paletten.
    const validColors = DEFAULT_COLORDRAFT_CONFIG.colorPalette;
    assert.ok(validColors.includes(json.targetColor as typeof validColors[number]));
    for (const c of json.allSlotColors) {
      assert.ok(validColors.includes(c as typeof validColors[number]));
    }
  }
});

test("BIN-690 M4: handleChoice — fordeling over target-farger er tilnærmet uniform (1k runs)", async () => {
  // Sjekk at target-farger fordeles tilnærmet uniformt over paletten.
  const engine = new MiniGameColordraftEngine();
  const N = 1000;
  const counts = new Map<string, number>();
  for (let i = 0; i < N; i += 1) {
    const ctx = makeContext({}, `mgr-uniform-${i}`);
    const payload = engine.trigger(ctx);
    const inner = payload.payload as Record<string, unknown>;
    const target = inner.targetColor as string;
    counts.set(target, (counts.get(target) ?? 0) + 1);
  }
  // Default palette har 4 farger → forventet ≈ 250 per farge, toleranse ±50%.
  const expected = N / DEFAULT_COLORDRAFT_CONFIG.colorPalette.length;
  const minAcceptable = expected * 0.5;
  const maxAcceptable = expected * 1.5;
  for (const color of DEFAULT_COLORDRAFT_CONFIG.colorPalette) {
    const c = counts.get(color) ?? 0;
    assert.ok(
      c >= minAcceptable && c <= maxAcceptable,
      `Farge ${color} fikk ${c} targets, forventet [${minAcceptable}, ${maxAcceptable}]`,
    );
  }
});

test("BIN-690 M4: handleChoice — match-rate korrelerer med slot-count/palette-size (statistisk sanity)", async () => {
  // For default-config (12 slots, 4 farger), match-rate ved random klient-
  // valg skal være omtrent 1/4 ≈ 25% (per-slot sannsynlighet er 1/4 for at
  // slot-farge = target). Plus garantien at target er i slots, som litt
  // boost'er match-rate.
  const engine = new MiniGameColordraftEngine();
  const N = 2000;
  let matches = 0;
  for (let i = 0; i < N; i += 1) {
    const ctx = makeContext({}, `mgr-match-rate-${i}`);
    // Simuler random klient-valg.
    const chosen = Math.floor(Math.random() * 12);
    const result = await engine.handleChoice({
      resultId: ctx.resultId,
      context: ctx,
      choiceJson: { chosenIndex: chosen },
    });
    if ((result.resultJson as ColordraftResultJson).matched) matches += 1;
  }
  const matchRate = matches / N;
  // Forventet omtrent 0.25–0.33; aksepter [0.15, 0.45] som wide sanity-range.
  assert.ok(
    matchRate >= 0.15 && matchRate <= 0.45,
    `match-rate ${matchRate.toFixed(3)} utenfor [0.15, 0.45]`,
  );
});

test("BIN-690 M4: handleChoice — numberOfSlots=20 gir 20 slot-farger", async () => {
  const engine = new MiniGameColordraftEngine();
  const ctx = makeContext({
    numberOfSlots: 20,
    colorPalette: ["a", "b", "c", "d"],
    winPrizeNok: 1000,
    consolationPrizeNok: 0,
  });
  const result = await engine.handleChoice({
    resultId: ctx.resultId,
    context: ctx,
    choiceJson: { chosenIndex: 19 },
  });
  const json = result.resultJson as ColordraftResultJson;
  assert.equal(json.numberOfSlots, 20);
  assert.equal(json.allSlotColors.length, 20);
});

test("BIN-690 M4: type === 'colordraft' konstant", () => {
  const engine = new MiniGameColordraftEngine();
  assert.equal(engine.type, "colordraft");
});

test("BIN-690 M4: handleChoice — forskjellig resultId → forskjellig state (typisk)", async () => {
  const engine = new MiniGameColordraftEngine();
  const r1 = await engine.handleChoice({
    resultId: "mgr-diff-1",
    context: makeContext({}, "mgr-diff-1"),
    choiceJson: { chosenIndex: 0 },
  });
  const r2 = await engine.handleChoice({
    resultId: "mgr-diff-2",
    context: makeContext({}, "mgr-diff-2"),
    choiceJson: { chosenIndex: 0 },
  });
  const j1 = r1.resultJson as ColordraftResultJson;
  const j2 = r2.resultJson as ColordraftResultJson;
  // Teknisk KAN de tilfeldigvis matche (lav sannsynlighet), men i praksis
  // vil vi se forskjellig slot-arrangement. Vi sjekker ved å sammenligne
  // JSON-serialisert state.
  const state1 = `${j1.targetColor}|${j1.allSlotColors.join(",")}`;
  const state2 = `${j2.targetColor}|${j2.allSlotColors.join(",")}`;
  // Astronomisk lav sannsynlighet for kollisjon, men vi tester ikke dette
  // hardt — bare at vi iallfall får to forskjellige resultater noen ganger.
  if (state1 !== state2) {
    assert.ok(true);
  } else {
    // Extremely unlikely; konvertér til soft-fail med info.
    assert.ok(
      false,
      "Uventet: to forskjellige resultIds ga identisk state",
    );
  }
});
