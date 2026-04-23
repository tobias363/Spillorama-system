/**
 * feat/schedule-8-colors-mystery (2026-04-23): tester for TICKET_COLORS-
 * katalog + Mystery-game validators. Dekker:
 *   - 9 canonical farger finnes og er distinkte
 *   - isTicketColor() avviser legacy / ukjente strenger
 *   - validateRowPrizesByColor avviser negative og ikke-numeriske verdier
 *   - validateMysteryConfig avviser ugyldig priceOptions (tom / > 10 / ikke-int)
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  TICKET_COLORS,
  isTicketColor,
  SUB_GAME_TYPES,
  validateMysteryConfig,
  validateRowPrizesByColor,
} from "../src/ticket-colors.js";

test("TICKET_COLORS: 9 unike koder i dokumentert rekkefølge", () => {
  assert.equal(TICKET_COLORS.length, 9);
  assert.deepEqual([...TICKET_COLORS], [
    "SMALL_YELLOW",
    "LARGE_YELLOW",
    "SMALL_WHITE",
    "LARGE_WHITE",
    "SMALL_PURPLE",
    "LARGE_PURPLE",
    "RED",
    "GREEN",
    "BLUE",
  ]);
  const set = new Set(TICKET_COLORS);
  assert.equal(set.size, 9);
});

test("SUB_GAME_TYPES: STANDARD + MYSTERY", () => {
  assert.deepEqual([...SUB_GAME_TYPES], ["STANDARD", "MYSTERY"]);
});

test("isTicketColor: aksepterer canonical, avviser legacy fri-form", () => {
  assert.equal(isTicketColor("SMALL_YELLOW"), true);
  assert.equal(isTicketColor("BLUE"), true);
  assert.equal(isTicketColor("Yellow"), false);
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
