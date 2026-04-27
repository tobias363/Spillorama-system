/**
 * SG-G3 (2026-04-27): tester for konsolidert TICKET_COLORS-katalog +
 * Mystery-game validators. Dekker:
 *   - 11 canonical legacy farger finnes og er distinkte
 *   - 17 ALL_TICKET_COLOR_SLUGS (11 legacy + 6 extension) er distinkte
 *   - 14 SPILL1_TICKET_COLOR_SLUGS (subset for Spill 1) er distinkte
 *   - Display-name mapping er komplett (slug ↔ navn)
 *   - colorDisplayName-helper håndterer både slug-form og UPPERCASE
 *   - isTicketColor() avviser legacy / ukjente strenger
 *   - validateRowPrizesByColor avviser negative og ikke-numeriske verdier
 *   - validateMysteryConfig avviser ugyldig priceOptions (tom / > 10 / ikke-int)
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  TICKET_COLORS,
  LEGACY_TICKET_COLOR_SLUGS,
  LEGACY_COLOR_DISPLAY_NAMES,
  SPILL1_EXTENSION_COLOR_SLUGS,
  SPILL1_EXTENSION_COLOR_DISPLAY_NAMES,
  ALL_TICKET_COLOR_SLUGS,
  ALL_COLOR_DISPLAY_NAMES,
  SPILL1_TICKET_COLOR_SLUGS,
  isTicketColor,
  colorSlugToUppercase,
  colorUppercaseToSlug,
  colorDisplayName,
  SUB_GAME_TYPES,
  validateMysteryConfig,
  validateRowPrizesByColor,
} from "../src/ticket-colors.js";

test("TICKET_COLORS: 11 unike UPPERCASE-koder i dokumentert rekkefølge", () => {
  assert.equal(TICKET_COLORS.length, 11);
  assert.deepEqual([...TICKET_COLORS], [
    "SMALL_YELLOW",
    "SMALL_WHITE",
    "SMALL_PURPLE",
    "SMALL_GREEN",
    "SMALL_RED",
    "LARGE_YELLOW",
    "LARGE_WHITE",
    "LARGE_PURPLE",
    "RED",
    "GREEN",
    "BLUE",
  ]);
  const set = new Set(TICKET_COLORS);
  assert.equal(set.size, 11);
});

test("LEGACY_TICKET_COLOR_SLUGS: 11 unike slug-koder", () => {
  assert.equal(LEGACY_TICKET_COLOR_SLUGS.length, 11);
  assert.equal(new Set(LEGACY_TICKET_COLOR_SLUGS).size, 11);
  // Validér at slugs er konsistent med UPPERCASE-form (1:1 mapping ved
  // toLowerCase / toUpperCase)
  for (const slug of LEGACY_TICKET_COLOR_SLUGS) {
    assert.ok(
      (TICKET_COLORS as readonly string[]).includes(slug.toUpperCase()),
      `slug ${slug} har ingen UPPERCASE-motstykke i TICKET_COLORS`
    );
  }
});

test("LEGACY_COLOR_DISPLAY_NAMES: alle 11 slugs har display-navn", () => {
  for (const slug of LEGACY_TICKET_COLOR_SLUGS) {
    assert.ok(
      typeof LEGACY_COLOR_DISPLAY_NAMES[slug] === "string" &&
        LEGACY_COLOR_DISPLAY_NAMES[slug].length > 0,
      `slug ${slug} mangler display-navn`
    );
  }
  // Spot-check
  assert.equal(LEGACY_COLOR_DISPLAY_NAMES.small_yellow, "Small Yellow");
  assert.equal(LEGACY_COLOR_DISPLAY_NAMES.small_red, "Small Red");
  assert.equal(LEGACY_COLOR_DISPLAY_NAMES.small_green, "Small Green");
  assert.equal(LEGACY_COLOR_DISPLAY_NAMES.blue, "Blue");
});

test("SPILL1_EXTENSION_COLOR_SLUGS: 6 extension-farger (small_orange + 5 elvis)", () => {
  assert.equal(SPILL1_EXTENSION_COLOR_SLUGS.length, 6);
  assert.deepEqual([...SPILL1_EXTENSION_COLOR_SLUGS], [
    "small_orange",
    "elvis1",
    "elvis2",
    "elvis3",
    "elvis4",
    "elvis5",
  ]);
});

test("SPILL1_EXTENSION_COLOR_DISPLAY_NAMES: alle 6 har display-navn", () => {
  for (const slug of SPILL1_EXTENSION_COLOR_SLUGS) {
    assert.ok(
      typeof SPILL1_EXTENSION_COLOR_DISPLAY_NAMES[slug] === "string" &&
        SPILL1_EXTENSION_COLOR_DISPLAY_NAMES[slug].length > 0,
      `extension-slug ${slug} mangler display-navn`
    );
  }
  assert.equal(SPILL1_EXTENSION_COLOR_DISPLAY_NAMES.elvis1, "Elvis 1");
  assert.equal(SPILL1_EXTENSION_COLOR_DISPLAY_NAMES.small_orange, "Small Orange");
});

test("ALL_TICKET_COLOR_SLUGS: 17 unike (11 legacy + 6 extension)", () => {
  assert.equal(ALL_TICKET_COLOR_SLUGS.length, 17);
  assert.equal(new Set(ALL_TICKET_COLOR_SLUGS).size, 17);
});

test("ALL_COLOR_DISPLAY_NAMES: dekker alle 17 slugs uten kollisjon", () => {
  for (const slug of ALL_TICKET_COLOR_SLUGS) {
    assert.ok(
      typeof ALL_COLOR_DISPLAY_NAMES[slug] === "string",
      `slug ${slug} mangler i ALL_COLOR_DISPLAY_NAMES`
    );
  }
  // Display-navn skal være unike (ingen to slugs deler navn)
  const names = Object.values(ALL_COLOR_DISPLAY_NAMES);
  assert.equal(new Set(names).size, names.length);
});

test("SPILL1_TICKET_COLOR_SLUGS: 14 farger, alle finnes i ALL_TICKET_COLOR_SLUGS", () => {
  assert.equal(SPILL1_TICKET_COLOR_SLUGS.length, 14);
  for (const slug of SPILL1_TICKET_COLOR_SLUGS) {
    assert.ok(
      (ALL_TICKET_COLOR_SLUGS as readonly string[]).includes(slug),
      `Spill 1-slug ${slug} mangler i ALL_TICKET_COLOR_SLUGS`
    );
  }
  // Spill 1 utelater de tre standalone-fargene (red/green/blue)
  assert.ok(!(SPILL1_TICKET_COLOR_SLUGS as readonly string[]).includes("red"));
  assert.ok(!(SPILL1_TICKET_COLOR_SLUGS as readonly string[]).includes("green"));
  assert.ok(!(SPILL1_TICKET_COLOR_SLUGS as readonly string[]).includes("blue"));
  // Men inkluderer alle small-farger og elvis
  assert.ok((SPILL1_TICKET_COLOR_SLUGS as readonly string[]).includes("small_red"));
  assert.ok((SPILL1_TICKET_COLOR_SLUGS as readonly string[]).includes("elvis5"));
});

test("colorSlugToUppercase / colorUppercaseToSlug: round-trip", () => {
  for (const slug of LEGACY_TICKET_COLOR_SLUGS) {
    const upper = colorSlugToUppercase(slug);
    assert.equal(colorUppercaseToSlug(upper), slug);
  }
});

test("colorDisplayName: håndterer slug + UPPERCASE + ukjent", () => {
  assert.equal(colorDisplayName("small_yellow"), "Small Yellow");
  assert.equal(colorDisplayName("SMALL_YELLOW"), "Small Yellow");
  assert.equal(colorDisplayName("elvis3"), "Elvis 3");
  assert.equal(colorDisplayName("ELVIS3"), "Elvis 3");
  assert.equal(colorDisplayName("unknown_color"), null);
  assert.equal(colorDisplayName(""), null);
});

test("SUB_GAME_TYPES: STANDARD + MYSTERY", () => {
  assert.deepEqual([...SUB_GAME_TYPES], ["STANDARD", "MYSTERY"]);
});

test("isTicketColor: aksepterer canonical UPPERCASE, avviser legacy fri-form", () => {
  assert.equal(isTicketColor("SMALL_YELLOW"), true);
  assert.equal(isTicketColor("BLUE"), true);
  // SG-G3: nye 11-farge-koder
  assert.equal(isTicketColor("SMALL_RED"), true);
  assert.equal(isTicketColor("SMALL_GREEN"), true);
  // Legacy fri-form og slug-form skal IKKE matche UPPERCASE-guarden
  assert.equal(isTicketColor("Yellow"), false);
  assert.equal(isTicketColor("small_yellow"), false);
  assert.equal(isTicketColor(""), false);
  assert.equal(isTicketColor(undefined), false);
  assert.equal(isTicketColor(42), false);
});

test("validateRowPrizesByColor: godkjenner tomt og partial", () => {
  assert.equal(validateRowPrizesByColor(undefined), null);
  assert.equal(validateRowPrizesByColor({}), null);
  assert.equal(
    validateRowPrizesByColor({
      SMALL_YELLOW: { ticketPrice: 30, fullHouse: 200 },
    }),
    null
  );
});

test("validateRowPrizesByColor: avviser negative og ikke-numeriske", () => {
  assert.match(
    validateRowPrizesByColor({ SMALL_YELLOW: { ticketPrice: -5 } }) ?? "",
    /ticketPrice/
  );
  assert.match(
    validateRowPrizesByColor({ RED: { row1: "abc" as unknown as number } }) ?? "",
    /row1/
  );
  assert.match(
    validateRowPrizesByColor("not-obj" as unknown as object) ?? "",
    /må være et objekt/
  );
});

test("validateMysteryConfig: godkjenner 1-10 ikke-neg heltall", () => {
  assert.equal(validateMysteryConfig({ priceOptions: [1000] }), null);
  assert.equal(
    validateMysteryConfig({
      priceOptions: [1000, 1500, 2000, 2500, 3000, 4000],
      yellowDoubles: true,
    }),
    null
  );
});

test("validateMysteryConfig: avviser tom / for mange / ikke-heltall", () => {
  assert.match(validateMysteryConfig({ priceOptions: [] }) ?? "", /1–10/);
  assert.match(
    validateMysteryConfig({
      priceOptions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    }) ?? "",
    /1–10/
  );
  assert.match(
    validateMysteryConfig({ priceOptions: [100.5] }) ?? "",
    /heltall/
  );
  assert.match(
    validateMysteryConfig({ priceOptions: [-50] }) ?? "",
    /heltall/
  );
});

test("validateMysteryConfig: avviser ugyldig struktur", () => {
  assert.match(
    validateMysteryConfig(null) ?? "",
    /må være et objekt/
  );
  assert.match(
    validateMysteryConfig({}) ?? "",
    /priceOptions må være en liste/
  );
  assert.match(
    validateMysteryConfig({
      priceOptions: [100],
      yellowDoubles: "yes" as unknown as boolean,
    }) ?? "",
    /yellowDoubles/
  );
});
