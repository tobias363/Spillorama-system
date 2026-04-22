// ── Shared primitive Zod schemas (internal) ────────────────────────────────
// PR-R3: ekstrahert fra schemas.ts så hver domene-subfil kan importere de
// samme primitivene uten å redeklarere dem.
//
// Merk: disse brukes både av subfiler under ./schemas/ og av den ytre
// ../schemas.ts (under overgangen) — så de bor eksplisitt i en egen
// fil som begge lag kan hente fra.

import { z } from "zod";

export const IsoDateString = z.string().min(1);
export const ClaimType = z.enum(["LINE", "BINGO"]);
export const GameStatus = z.enum(["WAITING", "RUNNING", "ENDED"]);

/** "HH:MM" eller tom streng. Brukes av DailySchedule + Schedule. */
export const HhMmOrEmpty = z.string().regex(/^$|^[0-9]{2}:[0-9]{2}$/, {
  message: "time må være 'HH:MM' eller tom.",
});
