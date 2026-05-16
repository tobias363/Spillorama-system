# Delta-rapport — purchase-flow quick-wins / claude/purchase-flow-quick-wins

**Agent:** Claude Opus 4.7 (under PM Tobias-koordinering)
**Branch:** `claude/purchase-flow-quick-wins`
**PR:** #1553
**Scope:** Fase 4-prep quick-wins fra konsulent-review 2026-05-16 — 3 docs/JSDoc-fixes som lukker latente bugs uten å endre kode-atferd.

## Hva ble endret

- `apps/backend/src/game/Game1DrawEngineHelpers.ts:635-668` — docstring på `bongMultiplierForColorSlug` utvidet med "STALE DOCSTRING — VERIFISERES I FASE 4 AUDIT" warning. Eksplisitt forklaring av at returnverdiene reflekterer GAMLE prising-regimet (`LARGE_TICKET_PRICE_MULTIPLIER = 2`, nå 3). **Return-verdiene er IKKE endret.** Caller-sites (4 stk i `Game1DrawEngineService.ts`) er listet i docstring for fremtidig audit.
- `docs/architecture/SPILL_DETALJER_PER_SPILL.md:157` — "Large = 2× Small per default" var direkte feil etter commit `c3f086745` (2026-05-13). Endret til konkret formel: "Large bong = 3 brett til 3× pris" med kilde-referanse + per-brett-pris-invariant.
- `packages/shared-types/src/schemas/game.ts:215-242` — JSDoc-blokk på `TicketTypeInfoSchema.priceMultiplier` som dokumenterer at "multiplier" har vært brukt med 3 forskjellige semantikker historisk (color-tier / size / combined). Peker til `PURCHASE_FLOW_ARCHITECTURE_AUDIT` (Fase 4) for kanonisk definisjon.

## Hva andre steder kunne ha blitt brutt

- Ingen kode-atferd endret — kun docstring + JSDoc + 1 docs-fil
- `bongMultiplierForColorSlug` returnerer SAMME verdier som før (1, 2, 4 for small_white/yellow/large_white og 3, 6 for small_purple/large_purple). Endring her er kommentar-only.
- `priceMultiplier`-feltet i wire-format er ikke type-endret — kun JSDoc-tilskudd
- TypeScript strict-check passerer fortsatt (JSDoc-kommentar, ingen signatur-endring)
- Eksisterende tester (`SpillVerification.13Catalog.test.ts`) bruker `bongMultiplierForColorSlug` med samme forventede returnverdier — ingen test-endring trengs

## Nye fragilities oppdaget

**F-NEW (informativ, ikke registrert i FRAGILITY_LOG):**

`bongMultiplierForColorSlug`-returnverdiene står i kontrast til `LARGE_TICKET_PRICE_MULTIPLIER = 3` i `GamePlanEngineBridge.ts:304` (endret 2026-05-13 via commit `c3f086745`). Hvis funksjonens semantikk er "ticket-price / 5", er returnverdiene for `large_*` nå feil. Hvis semantikken er noe annet, må det dokumenteres. **Fase 4 audit skal avklare**.

Inntil audit lander: IKKE endre returnverdiene på egen hånd. Konsulter Tobias hvis du finner avvik i live payout-data.

## Brief for neste agent

Hvis du jobber med purchase-flow / multiplier / ticket-pris:

1. Les `docs/engineering/PITFALLS_LOG.md` §1.7, §1.9, §3.11, §7.18, §7.21 — alle dekker purchase-flow-recurring-bugs
2. Les `TicketTypeInfoSchema.priceMultiplier`-JSDoc (nylig oppdatert) for å forstå 3-vei-conflation
3. Vent på `PURCHASE_FLOW_ARCHITECTURE_AUDIT` (Fase 4) for kanonisk SSoT-retning før refactor
4. Ikke endre `bongMultiplierForColorSlug`-returnverdier uten verifisering av alle 4 call-sites i `Game1DrawEngineService.ts` (~linjer 2873, 2918, 3350, 3381)

## Tester

- Lokal lint-staged: ✅ (TS strict på backend, markdown-links, no-backdrop-js, no-unsafe-html)
- Manuell verifisering: ingen kode-atferd endret, derfor ingen test-kjøring nødvendig
- Unit-tests: N/A (kun docstring + JSDoc + docs-fil)
- E2E: N/A
- CI Pilot-flow: ikke trigget av docs-only

**Hvorfor ingen runtime-test:** PR rører kun kommentar-blokker og 1 docs-fil. Eksisterende tester (`SpillVerification.13Catalog.test.ts`) dekker `bongMultiplierForColorSlug`-returnverdiene som ikke er endret.
