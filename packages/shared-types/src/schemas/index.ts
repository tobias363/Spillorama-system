// ── Barrel export for Zod runtime schemas ──────────────────────────────────
// PR-R3: splittet fra monolittisk schemas.ts til domene-subfiler.
// Importer kan fortsette å bruke `./schemas.js` (via den ytre schemas.ts som
// re-eksporterer denne indexen) eller direkte peke på sub-domener.
//
// Rekkefølgen her speiler den opprinnelige schemas.ts-filen for å minimere
// diff-støy. Alle tidligere eksporterte skjemaer + type-alias er bevart
// byte-identisk; kun filplassering er endret.
//
export * from "./payments.js";
export * from "./game.js";
export * from "./admin.js";
export * from "./compliance.js";
export * from "./system.js";
export * from "./minigames.js";
export * from "./game1-scheduled.js";
