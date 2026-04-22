// ── Zod runtime schemas — back-compat barrel ────────────────────────────────
// PR-R3 (2026-04-23): schemas.ts var tidligere en ~2000 LOC monolitt. Alt
// er nå splittet per domene under `./schemas/`. Denne filen beholdes som
// re-eksport slik at eksisterende importer (`from "./schemas.js"` eller
// `from ".../src/schemas.js"`) fortsetter å fungere uten endring.
//
// Nye kode-filer bør foretrekke direkte importer fra domene-subfilene
// (f.eks. `./schemas/game.js`, `./schemas/admin.js`).

export * from "./schemas/index.js";
