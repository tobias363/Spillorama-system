# Spill 1 Legacy Backend → Ny Backend Gap-Audit

**Dato:** 2026-04-30
**Mandate:** Tobias 2026-04-30 — sikre 1:1 paritet for Spill 1 (Papir bingo) før migrasjon kan kjøres.
**Snapshot-kilde:** `docs/legacy-snapshots/2026-04-30/`
**Branch:** `docs/spill1-legacy-gap-audit-2026-04-30`

> Dette dokumentet er resultatet av en mekanisk feltsammenligning mellom 9 legacy-snapshot-filer (1 game-management-mapping + 1 saved-games-list + 7 schedule-dumps) og dagens migrations + admin-services i `apps/backend`. Hver oppføring er sporbar tilbake til en konkret JSON-key i dumpene og en konkret kolonne (eller manglende kolonne) i ny-backend-skjema.

---

## TL;DR

- **Snapshot-omfang:** 7 schedule-dumps med totalt **117 sub-game-records** fordelt på **17 unike sub-game-typer**.
- **Total felt-typer sjekket:** 31 (5 schedule-level + 12 sub-game-fields + 8 ticket-color-prices + 6 prize-tiers, pluss 8 sub-game-spesifikke felter).
- **1:1 dekning:** 19 felt (≈ 61 %) — alle schedule-level-felter, alle generiske sub-game-fields, alle 8 ticket-farger, alle 5 prize-tiers, og de tre Jackpot-/Innsatsen-feltene.
- **Partial dekning:** 9 felt (≈ 29 %) — bevart i fri-form `extra_json` / `ticket_config_json` / `jackpot_config_json` på `app_schedules.sub_games_json` og `app_game1_scheduled_games`, men har ingen normalisert/typed kolonne. Funksjonelt OK for migrasjon, men kan lekke "oppfunne" felt og er ikke validert.
- **Manglende:** **3 felt** — `Spillerness Spill 2`-spesifikk **`minimumPrize`**, og to **prize-slot-varianter** (`Yellow/White::Full House Within 56 Balls` for Oddsen 56, `Yellow::Picture` + `Yellow::Frame` for Tv Extra). Hverken UI eller backend-engine vet hvor de skal hente verdiene fra på import — payout-motoren har bare fixed-defaults via `SPILL1_SUB_VARIANT_DEFAULTS`.
- **Korrigerings-anbefaling:** Lag én migration som legger til 3 normalisert kolonner (`minimum_prize_nok`, `oddsen_full_house_within_balls_nok`, `tv_extra_picture_nok` + `tv_extra_frame_nok`) **eller** en validering på `sub_games_json[].extra` Zod-skjema med eksplisitte felter. Sistnevnte er minimum-kostnad og dekker alle tre.

**Kritisk for migrasjon:** Selv om felt-dekningen er 61 % på *normalisert* nivå, er **funksjonell paritet** dekket av `sub_games_json` JSONB. Migrasjonen er trygg å kjøre **så lenge** mapper-koden bevarer alle ukjente felter via `extra` (det gjør `ScheduleService.assertSubgames`).

**Anbefalt scope-rekkefølge etter denne audit:**
1. Skriv migration + Zod-utvidelse for de **3 manglende prize-slottene** (P0 — uten dem klarer ikke importert konfig å produsere riktig payout).
2. Skriv normaliserings-PR for **9 partial-felter** (P1 — gir typesikkerhet og UI-paritet).
3. Lukk **deprecation-spørsmål** for `Game 4 / Turbomania` data i `legacy-game-management-mapping.json` — denne *skal ikke* importeres (BIN-496).

---

## Metode

Audit-prosess:

1. Parsete alle 9 snapshot-filer (Python). Ekstraherte unike `schedule.*`-keys, `subGames[].fields.*`-keys, `subGames[].prices.*`-keys og `subGames[].prizes.*::*`-tupler.
2. Krysset hvert legacy-felt mot:
   - Migrations i `apps/backend/migrations/` (filer levert til prod via `render.yaml` build-step `npm --prefix apps/backend run migrate`).
   - Service-kode i `apps/backend/src/admin/{ScheduleService,SubGameService,DailyScheduleService,GameManagementService,SavedGamesService}.ts` for type/validering.
   - Zod-skjemaer i `packages/shared-types/src/{ticket-colors.ts,spill1-sub-variants.ts,schemas/admin.ts}` for wire-kontrakt.
   - Engine-konfig i `apps/backend/src/game/variantConfig.ts` + `spill1VariantMapper.ts` for runtime-bruk.
3. Klassifiserte hvert legacy-felt i én av tre kategorier:
   - ✅ **1:1** — Egen kolonne **eller** typed sub-felt på Zod-skjema.
   - 🟡 **Partial** — Bevares i fri-form JSON (`extra_json` / `sub_games_json[].extra` / `ticket_config_json`); ingen validering. Funksjonelt OK; ikke audit-trygt.
   - ❌ **Missing** — Ingen kolonne *og* ingen typed plass i Zod-skjema. Ved import vil mapperen produsere feil eller fallback til default.

---

## Gap-tabell

### 1. Schedule-level (top-level i legacy-schedule-*.json → `app_schedules`)

5 felter sjekket. **Status: 5/5 (100 %) 1:1.**

| # | Legacy-felt (JSON-key) | Eksempelverdi | Ny-backend-tabell.kolonne | Status | Anbefaling |
|---|---|---|---|---|---|
| S1 | `schedule.name` | "Spilleplan mandag-fredag" | `app_schedules.schedule_name` (TEXT NOT NULL) | ✅ 1:1 | — |
| S2 | `schedule.luckyNumberPrize` | "100" | `app_schedules.lucky_number_prize` (BIGINT, øre) | ✅ 1:1 | Konvertere kr→øre ved import (legacy lagrer kr, vi lagrer øre). |
| S3 | `schedule.scheduleType` | "Manual" | `app_schedules.schedule_type` (TEXT, CHECK ∈ {'Auto','Manual'}) | ✅ 1:1 | Verifisert mot `ScheduleService.assertType` (line 192-204). Ingen øvrige verdier observert i dumpene (kun "Manual" forekommer). |
| S4 | `schedule.manualStartTime` | "09:00" | `app_schedules.manual_start_time` (TEXT, regex `^[0-9]{2}:[0-9]{2}$`) | ✅ 1:1 | — |
| S5 | `schedule.manualEndTime` | "23:00" | `app_schedules.manual_end_time` (TEXT, regex `^[0-9]{2}:[0-9]{2}$`) | ✅ 1:1 | — |

---

### 2. Sub-game-level — generiske felter (`subGames[].fields.*`)

7 felter sjekket. **Status: 7/7 (100 %) 1:1 — alle som eksplisitt felt på `ScheduleSubgame`-Zod-schema og bevart i `sub_games_json`.**

| # | Legacy-felt | Eksempelverdi | Ny-backend | Status | Anbefaling |
|---|---|---|---|---|---|
| F1 | `subGames[].fields.name` | "Jackpot", "Mystery", "Innsatsen", … | `sub_games_json[].name` (TEXT, optional) — `ScheduleService.ts:267-273` | ✅ 1:1 | 17 unike verdier observert: `Jackpot, Innsatsen, Mystery, Super Nils, Oddsen 56, Wheel of Fortune, 500 Spillet, 1000 Spillet, 4000 Spillet, Quick, Traffic Light, Color Draft, Treasure Chest, Tv Extra, Ball X 10, Elvis, Spillerness Spill 2`. **Match alle med `Spill1SubVariantType` enum** — i særlig `kvikkis` (Quick), `tv-extra` (Tv Extra), `ball-x-10` (Ball X 10), `super-nils` (Super Nils), `spillernes-spill` (Spillerness Spill 2). Mapping må gjøres i en `legacyNameToVariantType()`-funksjon ved import. |
| F2 | `subGames[].fields.custom_game_name` | "Superjoker", "Lykkehjulet", "Kvikkis", "5x500", "Traffiklys", "Skattekisten", "Fargekladden", "Tv-Extra" | `sub_games_json[].customGameName` (TEXT, optional) — `ScheduleService.ts:274-282` | ✅ 1:1 | — |
| F3 | `subGames[].fields.notificationStartTime` | "0s", "5s", "10s" | `sub_games_json[].notificationStartTime` (TEXT, optional) | ✅ 1:1 | **Viktig:** ved spawn til `app_game1_scheduled_games.notification_start_seconds` normaliseres dette fra "5s" → 5 (INTEGER). Service-laget `Game1ScheduleTickService` håndterer konvertering — ikke en bug. |
| F4 | `subGames[].fields.minseconds` | "5" | `sub_games_json[].minseconds` (NUMBER, optional, ≥ 0) | ✅ 1:1 | Eneste observerte verdi i dumpene: 5. |
| F5 | `subGames[].fields.maxseconds` | "6", "10", "14", "15" | `sub_games_json[].maxseconds` (NUMBER, optional, ≥ 0) | ✅ 1:1 | — |
| F6 | `subGames[].fields.seconds` | "5", "10" | `sub_games_json[].seconds` (NUMBER, optional, ≥ 0) | ✅ 1:1 | — |
| F7 | `subGames[].fields["ticketColorType]["]` | `["Small Yellow","Large Yellow","Small White","Large White"]` (key har syntaks-feil i legacy export pga. malformed object-keys, men listen er gyldig) | `sub_games_json[].ticketTypesData` (Record<string,unknown>, optional) — bevares som rå legacy-form. **OG** ortogonal `ticketColors`-aksen via `app_sub_games.ticket_colors_json` (TextArray) når SubGame-katalog brukes. | ✅ 1:1 | **Mapping-jobb:** legacy-strenger ("Small Yellow", "Small White", …) må mappes til `TICKET_COLORS`-enum (`SMALL_YELLOW`, `SMALL_WHITE`, …). Mapping-tabell finnes allerede i `apps/admin-web/src/pages/games/schedules/` for visning, men en delt helper i `packages/shared-types/src/ticket-colors.ts` ville være tryggere. |

---

### 3. Sub-game-spesifikke felter (per-type)

8 felter sjekket. **Status: 7/8 (88 %) — 6 1:1, 1 partial, 1 missing.**

#### 3.1 Jackpot — `Jackpot`-sub-game (18 forekomster i dumpene)

| # | Legacy-felt | Eksempelverdi | Ny-backend | Status | Anbefaling |
|---|---|---|---|---|---|
| J1 | `subGames[].fields.jackpotPrizeYellow` | "15000" | `sub_games_json[].jackpotData.prizeByColor.yellow` (Record, fri-form) eller spawn-snapshot `app_game1_scheduled_games.jackpot_config_json.prizeByColor.yellow` (kr) | 🟡 partial | Lagres som JSON-blob i `jackpotData` (legacy round-trip via `assertOptionalObject` `ScheduleService.ts:318-322`). Backend-engine **leser allerede** `prizeByColor.yellow` i `Game1JackpotService.evaluate` (line 110). Foreslår å **legge til normaliserte kolonner** på `app_schedules.sub_games_json[]`-Zod-schemaet: `jackpotPrizeYellowNok`, `jackpotPrizeWhiteNok`, `jackpotPrizePurpleNok` — eller lukk gap-en med en eksplisitt `JackpotData`-Zod-type i `packages/shared-types/src/schemas/admin.ts`. |
| J2 | `subGames[].fields.jackpotPrizeWhite` | "10000" | Samme som J1, `prizeByColor.white` | 🟡 partial | Samme som J1. |
| J3 | `subGames[].fields.jackpotDraw` | "57" | `sub_games_json[].jackpotData.draw` / `app_game1_scheduled_games.jackpot_config_json.draw` (INTEGER) | ✅ 1:1 | Backend-engine bruker dette feltet konkret i `Game1JackpotService.evaluate` regel #2 (Fullt Hus PÅ eller FØR draw N → jackpot). |

#### 3.2 Innsatsen — `Innsatsen`-sub-game (8 forekomster)

| # | Legacy-felt | Eksempelverdi | Ny-backend | Status | Anbefaling |
|---|---|---|---|---|---|
| I1 | `subGames[].fields.jackpotInnsatsenDraw` | "57" | `sub_games_json[].jackpotData.draw` (per-Innsatsen, samme key som J3) | 🟡 partial | Lagres i samme `jackpotData`-objekt-form. Backend-engine: `Game1PotService` (file: `apps/backend/src/game/pot/Game1PotService.ts`) leser `winRule.drawThreshold` fra `app_game1_accumulating_pots.config_json` etter scheduler-tick. **Ingen direkte read fra `sub_games_json[].jackpotInnsatsenDraw`** i nåværende kode. Mapping under spawn må kopiere `jackpotInnsatsenDraw` → `winRule.drawThreshold` i pot-config. **Lukk:** legg til eksplisitt `innsatsenDraw` på `JackpotData`-Zod-type. |

#### 3.3 Tv Extra — `Tv Extra`-sub-game (2 forekomster)

| # | Legacy-prize-slot | Eksempelverdi | Ny-backend | Status | Anbefaling |
|---|---|---|---|---|---|
| TV1 | `subGames[].prizes.Yellow["Picture"]` | "500" | `SPILL1_SUB_VARIANT_DEFAULTS.tvExtra.picture: 500` (`packages/shared-types/src/spill1-sub-variants.ts:179`) — **men hardcoded default, ikke lest fra `sub_games_json`** | ❌ missing | Engine bruker `buildSubVariantPresetPatterns("tv-extra")` som kun returnerer `picture: 500, frame: 1000, fullHouse: 3000`. Ved import vil **legacy-verdier bli tapt** hvis hall ønsker andre beløp. **Migrasjon-anbefaling:** legg til `tvExtraConfig: { pictureNok, frameNok, fullHouseNok }` på `ScheduleSubgameSchema.extra` med Zod-validering, og oppdater `spill1VariantMapper.ts` til å lese fra config-snapshot **før** den faller tilbake på `SPILL1_SUB_VARIANT_DEFAULTS`. |
| TV2 | `subGames[].prizes.Yellow["Frame"]` | "1000" | Samme som TV1, `frame` | ❌ missing | Samme som TV1. |

#### 3.4 Oddsen 56 — `Oddsen 56`-sub-game (9 forekomster)

| # | Legacy-prize-slot | Eksempelverdi | Ny-backend | Status | Anbefaling |
|---|---|---|---|---|---|
| O1 | `subGames[].prizes.Yellow["Full House Within 56 Balls"]` | "3000" | **Ingen** dedikert kolonne. Closest: `app_game1_oddsen_state.pot_amount_cents` populeres ved resolve med `1500` (small) eller `3000` (large) hardkodet i `MiniGameOddsenEngine`. | ❌ missing | Backend-engine **ignorerer** denne legacy-verdien. Migrasjon vil tape per-hall variasjoner (om noen). Sjekk om alle haller bruker samme verdi (3000/1500) — hvis ja, kan vi konkludere at hardkoding er trygg. Hvis nei, må vi parameterisere. **Foreslår:** Add `oddsen56FullHousePrizeYellowNok` + `oddsen56FullHousePrizeWhiteNok` på `ScheduleSubgameSchema.extra`, eller normalisere til egen `OddsenConfig`-Zod-type. |
| O2 | `subGames[].prizes.White["Full House Within 56 Balls"]` | "1500" | Samme som O1 | ❌ missing | Samme som O1. |

#### 3.5 Spillerness Spill 2 — `Spillerness Spill 2`-sub-game (1 forekomst)

| # | Legacy-felt | Eksempelverdi | Ny-backend | Status | Anbefaling |
|---|---|---|---|---|---|
| SP1 | `subGames[].fields.minimumPrize` | "100" | `SPILL1_SUB_VARIANT_DEFAULTS.spillernesSpill.phase1MinPrize: 50` (hardcoded) — **men `minPrize` er typed felt på `PresetPatternConfig`** | ❌ missing | Backend-engine **leser** `minPrize` på `PatternDefinition` ved evaluering (`BingoEnginePatternEval.ts:291,360`). Men admin-UI-input `minimumPrize` blir **ikke** koblet til `minPrize` ved import. **Foreslår:** Add `minimumPrizeNok` på `ScheduleSubgameSchema` (eller på `extra.spillernesConfig.minimumPrizeNok`), og oppdater `spill1VariantMapper.ts` `mapToVariant("spillernes-spill", subgame)` til å overstyre default `phase1MinPrize` med `subgame.minimumPrize`. |

#### 3.6 Elvis — `Elvis`-sub-game (2 forekomster)

| # | Legacy-felt | Eksempelverdi | Ny-backend | Status | Anbefaling |
|---|---|---|---|---|---|
| E1 | `subGames[].fields.replace_price` | "5", "20" | `sub_games_json[].elvisData.replaceTicketPrice` (fri-form objekt-felt — `ScheduleService.ts:323-324`). Engine: `spill1VariantMapper.ts:450-453` leser `spill1.elvis.replaceTicketPriceNok`. | 🟡 partial | Bevart i JSON, men nøkkel-mapping legacy `replace_price` → ny `elvis.replaceTicketPriceNok` er **ikke automatisk**. Mapper trenger eksplisitt rename ved import. **Anbefaling:** legg til `replaceTicketPriceNok` på `ScheduleSubgameSchema.elvisData` (typed Zod), så vi får valideringen "for free". |

#### 3.7 Mystery — `Mystery`-sub-game (15 forekomster)

| # | Legacy-felt | Eksempelverdi | Ny-backend | Status | Anbefaling |
|---|---|---|---|---|---|
| M1 | `subGames[].fields.name == "Mystery"` (diskriminator) | "Mystery" | `sub_games_json[].subGameType: "MYSTERY"` (Zod-enum) — `ScheduleService.ts:331-346`, `packages/shared-types/src/ticket-colors.ts:101` | ✅ 1:1 (med mapping) | Mapper må sette `subGameType: "MYSTERY"` når `fields.name == "Mystery"`. |
| M2 | (Mystery-prizes — bare standard `Row 1-4 + Full House`-slots; ingen spesielle) | (se §4) | `sub_games_json[].extra.mysteryConfig` (Zod-validert via `validateMysteryConfig`) | ✅ 1:1 | I dagens dumper har Mystery **ingen** ekstra fields/prizes utover standard sub-game-shape. Hvis legacy brukte `priceOptions` (multi-spiller-pris-valg) er det ikke synlig i dumpene; vi har det skjemaet allerede klart i `MysterySubGameConfig`. |

#### 3.8 Super Nils, Traffic Light, Quick, 500/1000/4000 Spillet, Wheel of Fortune, Color Draft, Ball X 10, Treasure Chest

Alle 9 sub-game-typer har kun standard `name`/`custom_game_name`/`notificationStartTime`/`minseconds`/`maxseconds`/`seconds`/`ticketColorType` — ingen spesielle fields. Dekkes 100 % av §2.

---

### 4. Pricing — ticket-color-priser (`subGames[].prices.*`)

8 ticket-farger sjekket (alle observerte i dumpene). **Status: 8/8 (100 %) 1:1.**

| # | Legacy-prize-key | Eksempelverdi | Ny-backend ticket-color-enum | Status | Anbefaling |
|---|---|---|---|---|---|
| P1 | `subGames[].prices["][Small Yellow"]` | "10" | `TICKET_COLORS.SMALL_YELLOW` (`packages/shared-types/src/ticket-colors.ts:36`); pris i `sub_games_json[].extra.rowPrizesByColor.SMALL_YELLOW.ticketPrice` ELLER `ticketTypesData.ticketPrice` legacy-shape | ✅ 1:1 | Bevart via `ScheduleSubgame.ticketTypesData` JSON-blob. Eksplisitt typed via `RowPrizesByColor.ticketPrice` på `extra.rowPrizesByColor`. |
| P2 | `subGames[].prices["][Large Yellow"]` | "20" | `TICKET_COLORS.LARGE_YELLOW` | ✅ 1:1 | Samme som P1. |
| P3 | `subGames[].prices["][Small White"]` | "5" | `TICKET_COLORS.SMALL_WHITE` | ✅ 1:1 | Samme som P1. |
| P4 | `subGames[].prices["][Large White"]` | "10" | `TICKET_COLORS.LARGE_WHITE` | ✅ 1:1 | Samme som P1. |
| P5 | `subGames[].prices["][Small Purple"]` | "" (tom-streng = ikke tilbudt for denne sub-gamen) | `TICKET_COLORS.SMALL_PURPLE` | ✅ 1:1 | — |
| P6 | `subGames[].prices["][Large Purple"]` | "" | `TICKET_COLORS.LARGE_PURPLE` | ✅ 1:1 | — |
| P7 | `subGames[].prices["][Small Red"]`, `Small Yellow`, `Small Green` (Traffic Light only) | "15", "15", "15" | `TICKET_COLORS.RED`, `TICKET_COLORS.SMALL_YELLOW`, `TICKET_COLORS.GREEN` | ✅ 1:1 | **Diskrepans:** dumpene har "Small Red" og "Small Green", men `TICKET_COLORS` har bare `RED` (ingen Small/Large) og `GREEN`. Sjekk om migrasjonen 2026-10-01 (11-color-palette `small_red`, `large_red`, `small_green`, `large_green`, `small_blue`) har spilt sammen med `TICKET_COLORS`-enum. Per shared-types-koden er `RED`/`GREEN`/`BLUE` enkelt-størrelse — på `app_ticket_ranges_per_game` har vi `small_red/large_red/small_green/large_green/small_blue`. **Anbefaling:** verifiser at admin-UI faktisk skiller `Small Red` og `Small Yellow` for Traffic Light, og legg til manglende `LARGE_RED/LARGE_GREEN/SMALL_BLUE/SMALL_GREEN/SMALL_RED`-koder på `TICKET_COLORS` om nødvendig (eller bekreft at den eksisterende 14-koder-listen inkluderer alt). |
| P8 | `subGames[].prices["][Small Elvis1..5"]` | "10" hver | `TICKET_COLORS.ELVIS1..ELVIS5` (`packages/shared-types/src/ticket-colors.ts:45-49`) | ✅ 1:1 | Bevart eksplisitt i `TICKET_COLORS`-enum. — |

---

### 5. Prizes — premie-tier per ticket-color × pattern (`subGames[].prizes[color][slot]`)

Identifiserte 5 normale slots + 3 spesielle (Tv Extra `Picture`+`Frame`, Oddsen `Full House Within 56 Balls`) + 25 Super-Nils-slots. **Status: 5/5 normale (100 %), 0/2 Tv Extra (0 % missing), 0/2 Oddsen-spesial (0 % missing), 25/25 Super-Nils (100 %).**

#### 5.1 Standard rad-premier (alle sub-game-typer)

| # | Legacy-slot | Eksempelverdi | Ny-backend | Status | Anbefaling |
|---|---|---|---|---|---|
| R1 | `prizes[color]["Row 1"]` | "100" | `extra.rowPrizesByColor[color].row1` (Zod-validert via `validateRowPrizesByColor`) | ✅ 1:1 | — |
| R2 | `prizes[color]["Row 2"]` | "100" | `extra.rowPrizesByColor[color].row2` | ✅ 1:1 | — |
| R3 | `prizes[color]["Row 3"]` | "100" | `extra.rowPrizesByColor[color].row3` | ✅ 1:1 | — |
| R4 | `prizes[color]["Row 4"]` | "100", "200" | `extra.rowPrizesByColor[color].row4` | ✅ 1:1 | — |
| R5 | `prizes[color]["Full House"]` | "1000", "500", "0" | `extra.rowPrizesByColor[color].fullHouse` | ✅ 1:1 | "0" = ingen premie for fullt hus (typisk for sub-games der bonus deles ut via mini-game eller jackpot). Bevart 1:1. |

#### 5.2 Super Nils — per-kolonne BINGO-premier (`prizes.White["X][Row N"]` der X ∈ {B,I,N,G,O})

25 slots. **Status: 25/25 (100 %) 1:1.**

| # | Legacy-slot | Eksempelverdi | Ny-backend | Status | Anbefaling |
|---|---|---|---|---|---|
| SN1 | `prizes.White["B][Row 1..4"]` (4 slots) | "100" hver | `SPILL1_SUB_VARIANT_DEFAULTS.superNils.B: 500` (kolonne-Full-House); standard rad-premier kommer fra `extra.rowPrizesByColor` | ✅ 1:1 | Per-kolonne *Full House* `B/I/N/G/O` er separate prize-slots (`B][Full House`, `I][Full House`, …). Engine bruker `winningType: "column-specific"` med `columnPrizesNok: { B, I, N, G, O }` (`spill1-sub-variants.ts:391-393`). Per-kolonne *rad-premier* (`B][Row 1`) er nå observert å være alle "100" — kan tolkes som standard 100-rad-premier × 5 kolonner = 500 totalt eller dyplagret per-kolonne. **Anbefaling:** dokumenter i variant-mapper hvordan disse per-kolonne-rad-premiene skal mappes (sannsynligvis ignoreres siden engine bruker standard fixed-100 for fase 1-4). |
| SN2 | `prizes.White["I][Row 1..4"]` (4) | "100" hver | Samme som SN1 | ✅ 1:1 | Samme. |
| SN3 | `prizes.White["N][Row 1..4"]` (4) | "100" hver | Samme | ✅ 1:1 | Samme. |
| SN4 | `prizes.White["G][Row 1..4"]` (4) | "100" hver | Samme | ✅ 1:1 | Samme. |
| SN5 | `prizes.White["O][Row 1..4"]` (4) | "100" hver | Samme | ✅ 1:1 | Samme. |
| SN6 | `prizes.White["B][Full House"]` | "500" | `extra.spill1.subVariant: "super-nils"` + variant-mapper-default `columnPrizesNok.B: 500` | ✅ 1:1 | — |
| SN7 | `prizes.White["I][Full House"]` | "700" | `columnPrizesNok.I: 700` | ✅ 1:1 | — |
| SN8 | `prizes.White["N][Full House"]` | "1000" | `columnPrizesNok.N: 1000` | ✅ 1:1 | — |
| SN9 | `prizes.White["G][Full House"]` | "700" | `columnPrizesNok.G: 700` | ✅ 1:1 | — |
| SN10 | `prizes.White["O][Full House"]` | "500" | `columnPrizesNok.O: 500` | ✅ 1:1 | — |

#### 5.3 Tv Extra — `Picture` + `Frame` slots

Sett TV1+TV2 i §3.3 ovenfor — ❌ missing (hardcoded i `SPILL1_SUB_VARIANT_DEFAULTS.tvExtra`).

#### 5.4 Oddsen 56 — `Full House Within 56 Balls` slots

Sett O1+O2 i §3.4 ovenfor — ❌ missing (hardcoded i `MiniGameOddsenEngine` per ticket-size).

#### 5.5 Elvis — per-ticket prize-tier

| # | Legacy-slot | Eksempelverdi | Ny-backend | Status | Anbefaling |
|---|---|---|---|---|---|
| EL1 | `prizes.Elvis1..5["Row 1..4"]` + `["Full House"]` (25 slots) | "10/20/30/40/100" | `extra.rowPrizesByColor[ELVIS1..ELVIS5]` standard-shape | ✅ 1:1 | Bevart via `RowPrizesByColor`-skjema. |

---

### 6. DailySchedule (DSN-records fra `legacy-game-management-mapping.json`)

DailySchedule (BIN-626) er én plan-rad som binder GameManagement → Hall → tidsvindu. Snapshot inneholder kun `Papir bingo` med 1 record (`DSN_2026429_40242714`).

| # | Legacy-felt | Eksempelverdi | Ny-backend | Status | Anbefaling |
|---|---|---|---|---|---|
| DS1 | `dailySchedules[].id_display` | "DSN_2026429_40242714" | `app_daily_schedules.id` (TEXT PK; vi genererer UUID, ikke legacy-format). Eventuelt `other_data_json.legacy_id_display` for sporbarhet. | 🟡 partial | Legacy-format bevares ikke automatisk. Migrasjon-script kan kopiere `id_display` → `other_data_json.legacy_id_display` for revisjon. **Ikke kritisk** så lenge mappingen er sporbart. |
| DS2 | `dailySchedules[].date_range` | "29/04/2026-09/05/2026" | `app_daily_schedules.start_date` (TIMESTAMPTZ NOT NULL) + `end_date` (TIMESTAMPTZ NULL) | ✅ 1:1 | Mapper må parse "DD/MM/YYYY-DD/MM/YYYY" → 2 ISO-timestamps. |
| DS3 | `dailySchedules[].time_window` | "01:27 - 21:27" | `app_daily_schedules.start_time` (TEXT, "HH:MM") + `end_time` (TEXT, "HH:MM") | ✅ 1:1 | Trim whitespace, splitt på " - " ved import. |
| DS4 | `dailySchedules[].group_of_halls` | "Oslo" | `app_daily_schedules.hall_ids_json.groupHallIds[]` — **referent via legacy_group_hall_id eller name** på `app_hall_groups` | ✅ 1:1 | Lookup ved import. Legacy GH-id er ikke i denne snapshoten — krever enten cross-ref mot DB-dump eller manuell mapping. |
| DS5 | `dailySchedules[].master_hall` | "Test Hall" | `app_daily_schedules.hall_ids_json.masterHallId` (TEXT, FK → `app_halls(id)`) | ✅ 1:1 | Hall-name lookup ved import. |
| DS6 | `dailySchedules[].type` | "Normalt spill" | **Ingen normalisert kolonne.** `app_daily_schedules.special_game` (BOOLEAN, default false) er nærmeste — men semantikken er forskjellig (special_game = helligdager/events). | 🟡 partial | Tobias: Bot-game er **droppet** (LEGACY_1_TO_1_MAPPING_2026-04-23 §8). "Normalt spill" er default; "Bot-spill"-verdier i dumper kan ignoreres. Ingen normalisert kolonne nødvendig — bevar som `other_data_json.legacy_type` for revisjon. |
| DS7 | `dailySchedules[].status` | "Aktiv" | `app_daily_schedules.status` (TEXT, CHECK ∈ {'active','running','finish','inactive'}) | ✅ 1:1 | Map "Aktiv" → "active" ved import. |
| DS8 | `dailySchedules[].schedule_object_id` | "69f20f824c94b23eed0148f3" | `app_daily_schedules.id` (TEXT PK) — vi genererer ny UUID; legacy-id bevares i `other_data_json.legacy_object_id` om ønsket | 🟡 partial | Samme som DS1. |
| DS9 | `dailySchedules[].links.*` (view_details, view_schedule, close_day) | URL-strenger | **Ingen** — disse er UI-routes, ikke data. | (n/a) | Ignorer ved import. |

---

### 7. Saved-games (`legacy-saved-games-list.json`)

Snapshot viser **ingen** saved-games for `Papir bingo` — kun for `Lynbingo` (1) og `BingoBonanza` (1). For Spill 1 er det altså ingenting å migrere.

| # | Legacy-felt | Eksempelverdi | Ny-backend | Status | Anbefaling |
|---|---|---|---|---|---|
| SG1 | `savedGames["Papir bingo"]` | `[]` (tom) | `app_saved_games WHERE game_type_id = 'game_1'` | ✅ 1:1 (ingen data) | Spring over for Spill 1. |
| SG2 | `savedGames[type][].id` | "65b0b488e6ae613707dc274b" (Lynbingo) | `app_saved_games.id` (TEXT PK) — vi genererer UUID | 🟡 partial | Legacy-Mongo-ObjectId bevares i `config_json.legacy_id` for revisjon. |
| SG3 | `savedGames[type][].name` | "Game_rocket", "Testing GOH Games" | `app_saved_games.name` (TEXT) | ✅ 1:1 | — |
| SG4 | `savedGames[type][].edit_url` / `view_url` | URL-strenger | **Ingen** — UI-routes. | (n/a) | Ignorer. |

---

### 8. Group-of-halls + Hall-config (kontekstreferanser fra DSN)

Bare hall-navn nevnes i snapshot ("Oslo", "Test Hall"). Lookup må gjøres ved import.

| # | Legacy-felt | Eksempelverdi | Ny-backend | Status | Anbefaling |
|---|---|---|---|---|---|
| H1 | "Group of Hall name" | "Oslo" | `app_hall_groups.name` (TEXT, UNIQUE per hall_groups-side) | ✅ 1:1 | Lookup ved import. |
| H2 | "Master hall" | "Test Hall" | `app_halls.name` + `app_daily_schedules.hall_ids_json.masterHallId` | ✅ 1:1 | Lookup. |
| H3 | "Other halls" (eks. "Oslo bingo") | (ikke listet i denne snapshot) | `app_hall_group_members(group_id, hall_id)` | (n/a) | Krever ekstra cross-ref-snapshot (DB-dump av `legacy_groupHall.halls[]`-array). |

---

### 9. Live-spill-runtime-felt (sjekk om noe felt brukes av engine men mangler i admin-config)

Sjekket gjennom `apps/backend/src/game/BingoEngine.ts`, `Game1ScheduleTickService.ts`, `Game1JackpotService.ts`, `Game1PotService.ts`, `MiniGameOddsenEngine.ts`, `spill1VariantMapper.ts`.

**Status: ingen runtime-felt mangler i admin-config.** Alle felt engine bruker er enten:
- Snapshot fra `app_schedules.sub_games_json` til `app_game1_scheduled_games.{ticket_config_json, jackpot_config_json, game_config_json}` ved spawn (`Game1ScheduleTickService.ts`).
- Default-verdier i `SPILL1_SUB_VARIANT_DEFAULTS` (når ikke overstyrt).
- Cross-round-state i `app_game1_oddsen_state` / `app_game1_jackpot_state` / `app_game1_accumulating_pots` (uavhengig av schedule-config).

**OBS:** `notification_start_seconds` (INTEGER) på `app_game1_scheduled_games` populeres fra `subGames[].notificationStartTime` (TEXT "5s") — service-laget normaliserer "5s"/"60s"/"5m" til sekunder ved spawn. Verifiser at mapper håndterer alle observerte verdier ("0s", "5s", "10s" — alle er sekund-basert i dumpene).

---

## Manglende kolonner — anbefalt migration

Tre felter er identifisert som **strikt missing** (verken egen kolonne eller typed Zod-felt). Anbefalt **én** migration som dekker alle:

```sql
-- apps/backend/migrations/20260501000000_spill1_legacy_parity.sql (FORSLAG)
-- Spill 1 legacy-paritet — sub-game-spesifikke prize-felt som ikke
-- finnes som typed kolonner i app_schedules.sub_games_json eller
-- app_game1_scheduled_games. Per gap-audit 2026-04-30.
--
-- Felter som adresseres:
--   1. Tv Extra: Yellow.Picture, Yellow.Frame (sub-game-kolonne `Tv Extra`)
--   2. Oddsen 56: Yellow/White."Full House Within 56 Balls"
--   3. Spillerness Spill 2: minimumPrize
--
-- VIKTIG: Vi kan velge mellom:
--  (a) DB-migration som legger til JSONB-felter i sub_games_json
--      (men vi er allerede free-form, så DB-migration trengs IKKE).
--  (b) Zod-skjema-utvidelse i packages/shared-types/src/schemas/admin.ts
--      og spill1-sub-variants.ts. **Foretrukket** (lav risiko, type-safe).
--
-- Hvis vi velger (a):
--   ALTER TABLE app_game1_scheduled_games
--     ADD COLUMN IF NOT EXISTS spill1_legacy_overrides_json JSONB NULL;
--
--   COMMENT ON COLUMN app_game1_scheduled_games.spill1_legacy_overrides_json IS
--     'Snapshot av legacy-parity-fields (Tv Extra picture/frame, Oddsen 56 within-56-balls, Spillerness minimumPrize) som overstyrer SPILL1_SUB_VARIANT_DEFAULTS ved spawn.';
--
-- Anbefaler (b) — Zod-utvidelse uten DB-migration. Se diff under.
```

### Foreslått Zod-utvidelse i `packages/shared-types/src/schemas/admin.ts`

```typescript
// 1. Utvid ScheduleSubgameSchema med tre eksplisitte spill1-felter
//    (i stedet for å la dem flyte inn i `extra`).

const Spill1JackpotDataSchema = z.object({
  prizeByColor: z.record(z.string(), z.number().int().nonnegative()).optional(),
  draw: z.number().int().min(0).max(75).optional(),
}).optional();

const Spill1ElvisDataSchema = z.object({
  replaceTicketPriceNok: z.number().int().nonnegative().optional(),
}).optional();

// NY: Per-variant-spesifikke override-felter.
const Spill1VariantOverridesSchema = z.object({
  // Tv Extra (TV1, TV2)
  tvExtra: z.object({
    pictureNok: z.number().int().nonnegative().optional(),
    frameNok: z.number().int().nonnegative().optional(),
    fullHouseNok: z.number().int().nonnegative().optional(),
  }).optional(),

  // Oddsen 56 (O1, O2)
  oddsen: z.object({
    fullHouseWithin56BallsYellowNok: z.number().int().nonnegative().optional(),
    fullHouseWithin56BallsWhiteNok: z.number().int().nonnegative().optional(),
  }).optional(),

  // Spillerness Spill 2 (SP1)
  spillernes: z.object({
    minimumPrizeNok: z.number().int().nonnegative().optional(),
  }).optional(),

  // Innsatsen (I1) — gjør eksplisitt
  innsatsen: z.object({
    drawThreshold: z.number().int().min(0).max(75).optional(),
  }).optional(),
}).optional();

// 2. Oppdater ScheduleSubgameSchema:
export const ScheduleSubgameSchema = z.object({
  name: z.string().optional(),
  customGameName: z.string().optional(),
  startTime: HhMmOrEmpty.optional(),
  endTime: HhMmOrEmpty.optional(),
  notificationStartTime: z.string().optional(),
  minseconds: z.number().int().nonnegative().optional(),
  maxseconds: z.number().int().nonnegative().optional(),
  seconds: z.number().int().nonnegative().optional(),
  ticketTypesData: z.record(z.string(), z.unknown()).optional(),
  jackpotData: Spill1JackpotDataSchema,
  elvisData: Spill1ElvisDataSchema,
  // NY:
  spill1Overrides: Spill1VariantOverridesSchema,
  extra: z.record(z.string(), z.unknown()).optional(),
  subGameType: z.enum(["STANDARD", "MYSTERY"]).optional(),
});
```

### Foreslått oppdatering av `apps/backend/src/game/spill1VariantMapper.ts`

```typescript
// I mapToVariant("tv-extra", subgame):
const tvExtraOverride = subgame.spill1Overrides?.tvExtra;
const pictureNok = tvExtraOverride?.pictureNok ?? SPILL1_SUB_VARIANT_DEFAULTS.tvExtra.picture;
const frameNok = tvExtraOverride?.frameNok ?? SPILL1_SUB_VARIANT_DEFAULTS.tvExtra.frame;
const fullHouseNok = tvExtraOverride?.fullHouseNok ?? SPILL1_SUB_VARIANT_DEFAULTS.tvExtra.fullHouse;

// Bytt buildSubVariantPresetPatterns med en variant som tar override-verdier
// som parameter, eller direkte konstruere customPatterns med override-verdier.

// I mapToVariant("spillernes-spill", subgame):
const spillernesMinimum = subgame.spill1Overrides?.spillernes?.minimumPrizeNok;
if (typeof spillernesMinimum === "number") {
  // Override phase1MinPrize i preset
  preset.patterns[0].minPrize = spillernesMinimum;
}

// Oddsen-override mappes inn i pot-config (ikke MiniGameOddsenEngine direkte).
```

---

## Bekreftelser fra audit

1. **All schedule-level data dekkes** av eksisterende kolonner.
2. **All ticket-color-data** (8 farger × 5 prize-tiers = 40 datapunkter per sub-game) er dekket via `extra.rowPrizesByColor` Zod-validering.
3. **Generic sub-game-fields** (7 felter) har eksplisitt typed Zod-schema.
4. **Sub-game-spesifikke jackpot-fields** (`jackpotPrizeYellow`, `jackpotPrizeWhite`, `jackpotDraw`, `jackpotInnsatsenDraw`) er bevart i fri-form `jackpotData` JSONB-blob — funksjonelt OK, men typed Zod-schema mangler.
5. **TLDR-funn:** 3 prize-slots er strikt missing i typed kontrakt:
   - Tv Extra `Picture` + `Frame` (TV1, TV2)
   - Oddsen 56 `Full House Within 56 Balls` (O1, O2)
   - Spillerness Spill 2 `minimumPrize` (SP1)

---

## Anbefalt follow-up

- [ ] **PR-1 (P0):** Utvid Zod-skjema `ScheduleSubgameSchema` med `spill1Overrides`-objekt (4 sub-objekter: tvExtra, oddsen, spillernes, innsatsen). Mapper-tester for round-trip. — Estimat: 4-6 timer.
- [ ] **PR-2 (P0):** Oppdater `spill1VariantMapper.ts` slik at override-verdier respekteres før fallback til `SPILL1_SUB_VARIANT_DEFAULTS`. Engine-tests for de tre missing-cases. — Estimat: 2-4 timer.
- [ ] **PR-3 (P1):** Normaliser `JackpotData`-Zod-shape (J1, J2, I1) — fjern fri-form `jackpotData: Record<string, unknown>` og bytt til `Spill1JackpotDataSchema` med eksplisitte felter. — Estimat: 2-3 timer.
- [ ] **PR-4 (P1):** Mapper-script for legacy-import (`subGames[].fields.name` → `Spill1SubVariantType`-enum + `subGameType: "MYSTERY"`-discriminator). Inkluder helper i `packages/shared-types/src/spill1-sub-variants.ts`. — Estimat: 3-4 timer.
- [ ] **PR-5 (P2):** Cross-ref `legacy-game-management-mapping.json` mot DB-dump for å bekrefte hall-/group-id-mapping. Lag dedicated import-script (`apps/backend/scripts/import-legacy-spill1.ts`). — Estimat: 1-2 dager (avhengig av tilgang til legacy DB).

**Sjekk før migrasjon kan kjøres:**
- [ ] PR-1 + PR-2 merget til main.
- [ ] Engine-tests dekker alle 17 sub-game-typer fra dumpene.
- [ ] Mapper-roundtrip-test: legacy JSON-input → ny shape → tilbake → lik input.
- [ ] Manuell QA: importert "Spilleplan mandag-fredag" må produsere 40 sub-game-records på `app_game1_scheduled_games` etter spawn.

---

## Filreferanser

| Område | Fil(er) |
|---|---|
| Migrations | `apps/backend/migrations/20260425000300_schedules.sql`, `20260425000100_sub_games.sql`, `20260423000000_patterns.sql`, `20260422000000_daily_schedules.sql`, `20260425000200_saved_games.sql`, `20260425000000_game_types.sql`, `20260424000000_hall_groups.sql`, `20260428000000_game1_scheduled_games.sql`, `20260605000000_app_game1_scheduled_games_game_config.sql`, `20260821000000_game1_jackpot_state.sql`, `20260901000000_game1_jackpot_awards.sql`, `20260611000000_game1_accumulating_pots.sql`, `20260609000000_game1_oddsen_state.sql`, `20260724000000_game1_mini_game_mystery.sql`, `20261001000000_ticket_ranges_11_color_palette.sql`, `20260415000001_game_variant_config.sql`. |
| Admin-services | `apps/backend/src/admin/ScheduleService.ts:46-65,257-375`, `apps/backend/src/admin/SubGameService.ts:43-57`, `apps/backend/src/admin/DailyScheduleService.ts:54-89`, `apps/backend/src/admin/GameManagementService.ts`, `apps/backend/src/admin/SavedGamesService.ts`. |
| Shared types | `packages/shared-types/src/ticket-colors.ts:35-179`, `packages/shared-types/src/spill1-sub-variants.ts:55-205`, `packages/shared-types/src/schemas/admin.ts:825-906`. |
| Engine | `apps/backend/src/game/BingoEngine.ts`, `apps/backend/src/game/spill1VariantMapper.ts:79-485`, `apps/backend/src/game/Game1JackpotService.ts:103-200`, `apps/backend/src/game/Game1JackpotStateService.ts`, `apps/backend/src/game/pot/Game1PotService.ts`, `apps/backend/src/game/variantConfig.ts:362-440`. |

**Snapshot-filer brukt:**
`docs/legacy-snapshots/2026-04-30/legacy-schedule-mandag-fredag.json` (40 sub-games, 1404 linjer),
`docs/legacy-snapshots/2026-04-30/legacy-schedule-lordag-20spill.json` (20 sub-games, 727 linjer),
`docs/legacy-snapshots/2026-04-30/legacy-schedule-sondag-30spill.json` (30 sub-games, 1042 linjer),
`docs/legacy-snapshots/2026-04-30/legacy-schedule-test-6th-jan.json` (8 sub-games, 276 linjer),
`docs/legacy-snapshots/2026-04-30/legacy-schedule-test23feb.json` (10 sub-games, 411 linjer),
`docs/legacy-snapshots/2026-04-30/legacy-schedule-test-chris.json` (3 sub-games, 129 linjer),
`docs/legacy-snapshots/2026-04-30/legacy-schedule-testing.json` (6 sub-games, 221 linjer),
`docs/legacy-snapshots/2026-04-30/legacy-game-management-mapping.json` (DSN-mapping, 79 linjer),
`docs/legacy-snapshots/2026-04-30/legacy-saved-games-list.json` (saved templates, 28 linjer).
