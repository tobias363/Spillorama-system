# Trafikklys runtime gap — 2026-05-08

**Status:** **PILOT-BLOKKER hvis Trafikklys er på spilleplan i pilot-haller.**
Ikke pilot-blokker hvis Trafikklys utelates fra pilot-spilleplan.

**Forfatter:** Test-agent 2026-05-08, etter request fra Tobias om end-to-end-
verifisering av Trafikklys-runtime.

**Bakgrunn:** `docs/operations/SPILL_VERIFICATION_REPORT_2026-05-08.md` §5.4
flagget at Trafikklys' bridge-output er verifisert, men selve runtime-pathen
i engine (rad-farge-overstyring av pot-tabellen) ikke er verifisert. Denne
agent-runden bekrefter at runtime-pathen **ikke eksisterer i koden** — det
er ikke et test-gap, det er et implementasjons-gap.

---

## 1. Hva mangler

Engine sin payout-pipeline (`Game1DrawEngineService.payoutPerColorGroups`)
har ingen kode-path som overstyrer pot-tabellen basert på trukket rad-farge.

Konkret:

1. **Ingen rad-farge-trekking ved spill-start.** Engine sin `startGame` setter
   ikke en `trafikklys_row_color` på `app_game1_scheduled_games` eller
   tilsvarende.
2. **Ingen kolonne for rad-farge.** `app_game1_scheduled_games` har ingen
   `trafikklys_row_color`-kolonne (verifisert i alle migrations under
   `apps/backend/migrations/*.sql`).
3. **Ingen overstyring av Rad-pot.** `payoutPerColorGroups` velger pot via
   `patternsByColor[<bongfarge>][<phase>]`. Den slår aldri opp i
   `rules.prizesPerRowColor`.
4. **Ingen overstyring av Fullt Hus-pot.** Fullt Hus-pathen sjekker kun
   `resolveOddsenVariantConfig` (Oddsen-spesifikk). Det finnes ingen
   `resolveTrafikklysVariantConfig`.
5. **Ingen rad-farge i room-snapshot.** TV-skjerm og spiller-klient kan
   ikke lese hvilken rad-farge som er trukket.
6. **Ingen `trafikklysRowColor` i compliance-ledger.**
   `Game1PhasePotMetadata.trafikklysRowColor` er **definert som type-felt**
   (`Game1PayoutService.ts:110`) og **persisteres hvis satt**
   (`Game1PayoutService.ts:490`), men **ingenting setter den** —
   `Game1DrawEngineService.payoutPerColorGroups` hardkoder `gameVariant:
   "standard" | "oddsen"` (`Game1DrawEngineService.ts:2697`) og inkluderer
   ikke `trafikklysRowColor` i potMetadata.

## 2. Hva finnes (allerede implementert)

Komponentene under er korrekte og må IKKE endres ved Trafikklys-runtime-fix:

1. **Katalog-shape:** `app_game_catalog` har `prize_multiplier_mode =
   'explicit_per_color'` og `rules_json.{gameVariant, prizesPerRowColor,
   bingoPerRowColor, rowColors}` for Trafikklys. Verifisert i migration
   `20261210010300_app_game_catalog_prize_multiplier_mode.sql`.

2. **Bridge-output:** `GamePlanEngineBridge.buildTicketConfigFromCatalog`
   skriver konsistent `spill1.ticketColors[]` (alle bongfarger får samme
   pot fordi flat 15 kr-bong) og bevarer `rules`-objektet i config-output.
   Verifisert i `SpillVerification.13Catalog.test.ts` (linje 721-799).

3. **Admin-UI:** Spesial-editor for Trafikklys finnes i admin-web med
   per-rad-farge-felter (rød/grønn/gul × Rad/Fullt Hus).

4. **Compliance-ledger-felter:** `Game1PhasePotMetadata.trafikklysRowColor`
   er allerede typed og persisteres via Game1PayoutService når satt.
   `gameVariant: "trafikklys"` aksepteres som verdi i type-unionen
   (`Game1PayoutService.ts:104`).

5. **Oddsen-presedens:** Oddsen-runtime (`spill1.oddsen`-blokk +
   `resolveOddsenVariantConfig`) viser kanonisk shape for runtime-overstyring
   av pot-tabell. Trafikklys må følge samme mønster.

## 3. Forventet engine-flow (kontrakt — IKKE implementert)

### 3.1 Startup

`Game1DrawEngineService.startGame(scheduledGameId, actorUserId)` må:

1. Lese `rules.gameVariant` fra `game_config_json` eller `ticket_config_json`.
2. Hvis `gameVariant === "trafikklys"`:
   - Lese `rules.rowColors` (whitelist: `["grønn", "gul", "rød"]`).
   - Trekke ÉN rad-farge tilfeldig (RNG, samme seed-mekanikk som ball-trekking).
   - Persistere på scheduled-game-rad i ny kolonne
     `trafikklys_row_color TEXT NULL` (eller annen lagrings-form, f.eks. inn
     i `game_config_json.spill1.trafikklys.rowColor`).
3. Inkludere `rowColor` i room-snapshot som broadcastes til klient/TV-skjerm.

### 3.2 Payout (Rad 1-4)

`payoutPerColorGroups` (eller en parallell `payoutTrafikklys`-path) må:

1. Sjekke om `gameConfigJson.spill1.trafikklys` er satt (parallell til
   `resolveOddsenVariantConfig`).
2. Hvis satt:
   - Lese `rowColor` fra scheduled-game-rad.
   - Lese `prizesPerRowColor[rowColor]` fra `rules`.
   - Sette `potForBongSizeCents = prizesPerRowColor[rowColor]` for ALLE
     bongfarger (ingen vekting fordi flat 15 kr-bong, per §9.4).
   - Inkludere `gameVariant: "trafikklys"` og `trafikklysRowColor: rowColor`
     i `potMetadata` for compliance-audit.

### 3.3 Payout (Fullt Hus)

Tilsvarende:

1. Hvis `currentPhase === TOTAL_PHASES` OG Trafikklys-config er aktiv:
   - `potForBongSizeCents = bingoPerRowColor[rowColor]`
   - Resten samme som §3.2.
2. Trafikklys + Oddsen er gjensidig ekskluderende — hvis begge er satt
   skal det kaste (eller Trafikklys vinner; må avgjøres av Tobias).

### 3.4 Multi-vinner-regel (§9.4)

Per dokumentasjonen §9.4 i `SPILL_REGLER_OG_PAYOUT.md`:

> For Trafikklys er bongprisen flat 15 kr. Pot-størrelsen er definert av
> RAD-FARGEN (ikke bongfargen). Alle vinnere deler poten LIKT (ikke
> vektet — alle bonger har samme pris og dermed samme vekt).

Implementasjon: floor-split som standard pipeline, men **uten**
`bongMultiplier`-vekting per størrelse. Multi-bong-per-spiller =
spilleren får én pot-andel × antall vinner-bonger.

## 4. Hvorfor er det pilot-relevant

Trafikklys er **én av 13 hovedspill-katalog-rader** og er allerede
publisert i prod-katalogen. Hvis admin legger Trafikklys i et hall sin
spilleplan og runden kjøres, vil engine fortsatt utbetale per
**bongfargen** (placeholder fra `prizesCents.bingo` — i test-fixturen
1000 kr for Fullt Hus, 100 kr for Rad).

Konsekvenser:

- **Regulatorisk:** Spillerne vil få en annen premie enn det Trafikklys-
  reglene tilsier. Lotteritilsynet kan reagere på avvik fra publiserte
  regler.
- **Audit:** `compliance-ledger` får ikke `gameVariant: "trafikklys"` eller
  `trafikklysRowColor` — auditor kan ikke skille Trafikklys-utbetalinger
  fra standard hovedspill-utbetalinger.
- **Spilleropplevelse:** TV-skjerm og klient kan ikke vise hvilken rad-farge
  som ble trukket, så hele Trafikklys-mekanikken blir usynlig for spilleren.

**Mitigering for pilot:** Hvis Trafikklys IKKE er på pilot-spilleplanen, er
gap-en ikke pilot-blokker. PR #999 sin bridge-verifikasjon dekker bridge-
output-shape; runtime-gap er en separat post-pilot-leveranse.

## 5. Estimert implementasjons-arbeid

Mellomstort. Basert på Oddsen-presedens (samme forventede mønster):

| Komponent | Anslag |
|---|---|
| Migration: `trafikklys_row_color` kolonne på `app_game1_scheduled_games` | 0.5 dag |
| Engine: `startGame` rad-farge-trekking + persist | 0.5 dag |
| Engine: `resolveTrafikklysVariantConfig` (parallel til Oddsen) | 0.5 dag |
| Engine: `payoutPerColorGroups` Trafikklys-overstyring (Rad + Fullt Hus) | 1 dag |
| Engine: `gameVariant: "trafikklys"` + `trafikklysRowColor` i potMetadata | 0.5 dag |
| Bridge: `spill1.trafikklys`-blokk i `buildTicketConfigFromCatalog` | 0.5 dag |
| Room-snapshot/TV-broadcast: rad-farge i game-state | 1 dag |
| Tests: end-to-end stub-pool-test (denne agent-runden er kontrakts-mal) | 1 dag |
| Klient: rendering av rad-farge-banner | 0.5 dag |

**Sum: ~6 dev-dager** for én utvikler. Kan parallelliseres hvis backend +
frontend deles.

## 6. Test-suite (kontrakt-tester)

`apps/backend/src/game/__tests__/Game1DrawEngineService.trafikklys.test.ts`
inneholder 13 tester som dokumenterer den forventede oppførselen. Alle
tester er per nå strukturert slik at:

- **Kategori A** (PASS): Tester som verifiserer eksisterende katalog-
  struktur og bridge-output. Disse passer i dag.
- **Kategori B** (FAIL/SKIP med dokumentert årsak): Tester som verifiserer
  selve runtime-pathen. Disse er markert med `test.todo` eller bruker
  `assert.ok(false, "TODO: kontrakt — implement when runtime exists")`-
  pattern slik at de blir synlige i CI uten å blokkere annen utvikling.

Når runtime implementeres: fjern `todo`-markeringen og tester skal passe
uten å endre asserts.

## 7. Anbefalinger

1. **Avgjør pilot-scope:** Tobias bekrefter om Trafikklys er på pilot-
   spilleplanen.
   - **Ja:** Implementer runtime før pilot-start. Bruk denne dokumenten +
     test-suiten som spesifikasjon.
   - **Nei:** Marker Trafikklys-katalog-raden som `is_active = false` i
     prod inntil runtime er klar. Test-suiten beholdes som kontrakts-
     fasit for når runtime implementeres.
2. **Linear-issue:** Opprett en BIN-issue med tittel "Trafikklys runtime —
   rad-farge-trekking og pot-overstyring" og link denne dokumenten + test-
   filen.
3. **Code-review fokus:** Når runtime-PR landes må reviewer verifisere
   at både Rad 1-4 OG Fullt Hus får row-color-pot (ikke bare en av dem),
   og at compliance-ledger får `trafikklysRowColor` i potMetadata.

## 8. Referanser

- Kanonisk regelsett: `docs/architecture/SPILL_REGLER_OG_PAYOUT.md` §5 + §9.4
- Per-spill-detalj: `docs/architecture/SPILL_DETALJER_PER_SPILL.md` §1.13
- Verifikasjons-rapport: `docs/operations/SPILL_VERIFICATION_REPORT_2026-05-08.md` §5.4
- Bridge-tester (passerer): `apps/backend/src/game/__tests__/SpillVerification.13Catalog.test.ts` (linje 721-799)
- Engine pot-pipeline: `apps/backend/src/game/Game1DrawEngineService.ts:2580-2722`
  (`payoutPerColorGroups`)
- Oddsen-presedens: `apps/backend/src/game/Game1DrawEngineHelpers.ts:362`
  (`resolveOddsenVariantConfig`)
- Pot-metadata-typer: `apps/backend/src/game/Game1PayoutService.ts:94-111`
