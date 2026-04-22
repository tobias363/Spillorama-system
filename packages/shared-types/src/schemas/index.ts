// ── Barrel export for Zod runtime schemas ──────────────────────────────────
// PR-R3: splittet fra monolittisk schemas.ts til domene-subfiler.
// Importer kan fortsette å bruke `./schemas.js` (via den ytre schemas.ts som
// re-eksporterer denne indexen) eller direkte peke på sub-domener.
//
// Rekkefølgen her speiler den opprinnelige schemas.ts-filen for å minimere
// diff-støy. Alle tidligere eksporterte skjemaer + type-alias er bevart
// byte-identisk; kun filplassering er endret.
//
// Subfiler legges til i etterfølgende commits (PR-R3 step 2..N).

export * from "./payments.js";
