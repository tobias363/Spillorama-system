# Spill-regler og payout — kanonisk kilde

**Status:** Autoritativ. Alle andre dokumenter, kode-kommentarer og PM-handoff peker hit.
**Sist oppdatert:** 2026-05-08
**Eier:** Tobias Haugen (teknisk lead)
**Lese-først-i-sesjon:** Ja — enhver ny PM eller agent som rører payout-, katalog- eller spilleplan-kode SKAL lese dette dokumentet før de begynner.

---

## Hvorfor dette dokumentet eksisterer

Reglene under er bekreftet med Tobias gjennom flere PM-sesjoner. Forrige PM-handoffs har spredt deler av informasjonen, men ikke samlet den. Resultatet er at hver ny PM/agent har stilt de samme spørsmålene og fått samme svar. Dette dokumentet stopper det.

Hvis du leser dette og finner at noe ikke matcher koden, er **dokumentet sannheten** — koden må endres til å matche, ikke omvendt. Hvis du oppdager at en regel her er feil, oppdater dokumentet i samme PR som rettelsen og loggfør endringen i Endringslogg-seksjonen.

---

## 1. Spillkatalog

Spillorama driver fire interne spill og integrerer ett eksternt spill (Candy via iframe). Internt har vi 13 katalog-rader fordelt på følgende:

### 1.1 Hovedspill (Spill 1-3) — kategori `MAIN_GAME`

| Markedsnavn | Slug-familie | Beskrivelse |
|---|---|---|
| Spill 1 (Hovedspill 1) | `bingo` | 75-ball, 5×5-grid med fri sentercelle |
| Spill 2 (Hovedspill 2) | `rocket` | 21-ball, 3×3-grid (full plate). Ett globalt rom. |
| Spill 3 (Hovedspill 3) | `monsterbingo` | 75-ball, 5×5 uten fri sentercelle. Ett globalt rom. |

§11-distribusjon: minst **15%** til organisasjoner.

### 1.2 Databingo (SpinnGo / Spill 4) — kategori `DATABINGO`

| Markedsnavn | Slug | Beskrivelse |
|---|---|---|
| SpinnGo (Spill 4) | `spillorama` | 60-ball, 3×5-grid + ruletthjul. Player-startet, forhåndstrukket. |

§11-distribusjon: minst **30%** til organisasjoner.

### 1.3 Eksternt — Candy

| Markedsnavn | Slug | Beskrivelse |
|---|---|---|
| Candy | `candy` | Iframe-integrasjon med tredjepart. Felles lommebok via wallet-bridge. Ingen regulatorisk ansvar fra Spillorama for selve Candy-spillet. |

### 1.4 De 13 katalog-radene (hovedspill, slug = `bingo`)

Spilleplan-redesignen introduserer 13 katalog-rader, alle av familie `bingo` med forskjellige `rules.gameVariant` og premie-skala:

| Slug | Display-navn | Variant | Bingo-base (5 kr) | Jackpot-popup | `prizeMultiplierMode` |
|---|---|---|---|---|---|
| `bingo` | Bingo | standard | 1000 | — | auto |
| `1000-spill` | 1000-spill | standard | 1000 | — | auto |
| `5x500` | 5×500 | standard | 500 | — | auto |
| `ball-x-10` | Ball × 10 | standard | varierer | — | auto |
| `bokstav` | Bokstav | standard | varierer | — | auto |
| `innsatsen` | Innsatsen | standard | 500-2000 | — | auto |
| `jackpot` | Jackpot | standard | master setter via popup | ✅ ja | auto |
| `kvikkis` | Kvikkis | standard | 1000 | — | auto |
| `oddsen-55` | Oddsen 55 | **oddsen** | low 500 / high 1500 | — | auto + spesialregler |
| `oddsen-56` | Oddsen 56 | **oddsen** | low 500 / high 1500 | — | auto + spesialregler |
| `oddsen-57` | Oddsen 57 | **oddsen** | low 500 / high 1500 | — | auto + spesialregler |
| `trafikklys` | Trafikklys | **trafikklys** | per rad-farge | — | **explicit_per_color** |
| `tv-extra` | TV-Extra | standard | 3000 | — | auto |

Alle 13 er regulatorisk **hovedspill** uavhengig av variant.

---

## 2. Bongpriser

**Bongprisene er ALLTID like for alle hovedspill** (untatt Trafikklys):

| Bongfarge | Pris |
|---|---|
| Hvit | 5 kr |
| Gul | 10 kr |
| Lilla | 15 kr |

Trafikklys avviker: alle bonger 15 kr (flat).

I koden representeres prisen i øre (`pricePerTicket = 500`, `1000`, `1500`).

---

## 3. Premie-mekanikk: auto-multiplikator

### 3.1 Standardregelen for alle hovedspill med `prize_multiplier_mode = "auto"`

Premiene defineres som **base for billigste bong (5 kr)**. Backend skalerer for dyrere bonger:

| Bong | Multiplikator |
|---|---|
| Hvit (5 kr) | × 1 |
| Gul (10 kr) | × 2 |
| Lilla (15 kr) | × 3 |

Formel: `actualPrize = base × (ticketPriceCents / 500)`

### 3.2 Dette gjelder ALLE hovedpremier i hovedspill

- **Rad 1**: rad1_base × bong-multiplikator
- **Rad 2**: rad2_base × bong-multiplikator
- **Rad 3**: rad3_base × bong-multiplikator
- **Rad 4**: rad4_base × bong-multiplikator
- **Fullt Hus (bingo)**: bingoBase × bong-multiplikator

### 3.3 Eksempler

**Eksempel A — Innsatsen med rad1=100, bingoBase=1000:**

| Bong | Rad 1 | Fullt Hus |
|---|---|---|
| Hvit | 100 kr | 1000 kr |
| Gul | 200 kr | 2000 kr |
| Lilla | 300 kr | 3000 kr |

**Eksempel B — Bingo (standard) med bingoBase=1000:**

| Bong | Fullt Hus |
|---|---|
| Hvit | 1000 kr |
| Gul | 2000 kr |
| Lilla | 3000 kr |

### 3.4 INGEN single-prize cap på hovedspill

Hovedspill har **ingen 2500 kr-cap**. Lilla-bong får 3000 kr på Innsatsen Fullt Hus, 4500 kr på Oddsen-HIGH, osv. Det er forventet og regulatorisk OK.

> **Felle for nye PM/agenter:** I koden finnes `PrizePolicyPort.applySinglePrizeCap` som capper på 2500 kr. Den koden er for **databingo**, ikke hovedspill. Hvis du finner cap-kode aktiv på en hovedspill-path, er det en bug eller feil-applisert sikkerhets-mekanikk. Reglen er: cap **kun** for `gameType = DATABINGO` (slug `spillorama`).

### 3.5 Spesialspill avviker

Trafikklys og Oddsen følger ikke standard auto-multiplikator. Se seksjon 5 og 6.

---

## 4. Single-prize cap — kun databingo

Pengespillforskriften krever at databingo (SpinnGo) har **maks 2500 kr per single-prize**. Dette håndheves i koden via `PrizePolicyPort.applySinglePrizeCap`.

**Regel:**
- `gameType = MAIN_GAME` (Spill 1-3 inkl. alle 13 katalog-varianter): **ingen cap**
- `gameType = DATABINGO` (SpinnGo): **2500 kr cap per single-prize**

Mapping fra slug til gameType ligger i `apps/backend/src/game/ledgerGameTypeForSlug.ts`:
- `bingo`, `rocket`, `monsterbingo` → `MAIN_GAME`
- `spillorama` → `DATABINGO`

---

## 5. Spesialspill: Trafikklys

### 5.1 Mekanikk

- **Bongpris:** flat 15 kr (alle bonger)
- **Premier styres av RAD-FARGE** (rød/grønn/gul) — IKKE bongfarge
- Master eller systemet trekker rad-farge ved spill-start
- Auto-multiplikator gjelder IKKE — bruk `prize_multiplier_mode = "explicit_per_color"`

### 5.2 Premie-tabell

Premier per rad-farge:

| Rad-farge | Rad-premie | Fullt Hus |
|---|---|---|
| Rød | 50 kr | 500 kr |
| Grønn | 100 kr | 1000 kr |
| Gul | 150 kr | 1500 kr |

### 5.3 Datamodell — `rules`-JSON

```json
{
  "gameVariant": "trafikklys",
  "ticketPriceCents": 1500,
  "rowColors": ["grønn", "gul", "rød"],
  "prizesPerRowColor": {
    "grønn": 10000,
    "gul": 15000,
    "rød": 5000
  },
  "bingoPerRowColor": {
    "grønn": 100000,
    "gul": 150000,
    "rød": 50000
  }
}
```

### 5.4 Engine-krav

- Engine må trekke/sette rad-farge ved spill-start og persistere på scheduled_game-rad
- Engine må eksponere rad-farge til klient (TV-skjerm-banner: "Denne runden er RØD")
- Ved Rad-vinst eller Fullt Hus: bruk `prizesPerRowColor[<radFarge>]` eller `bingoPerRowColor[<radFarge>]` — uavhengig av bongfarge

---

## 6. Spesialspill: Oddsen

### 6.1 Mekanikk

- **Bongpriser:** standard 5/10/15 kr (auto-multiplikator gjelder)
- **3 varianter** med ulik `targetDraw`: 55, 56, 57
- **HIGH bingo-premie** hvis Fullt Hus oppnås på trekk ≤ `targetDraw`
- **LOW bingo-premie** hvis Fullt Hus oppnås på trekk > `targetDraw`
- Rad 1-4 følger normal auto-multiplikator (ingen spesial-mekanikk)

### 6.2 Premie-tabell (Oddsen-55)

| Bong | Rad 1-4 | Fullt Hus HIGH (≤55) | Fullt Hus LOW (>55) |
|---|---|---|---|
| Hvit | normal | 1500 kr | 500 kr |
| Gul | normal | 3000 kr | 1000 kr |
| Lilla | normal | 4500 kr | 1500 kr |

(Auto-multiplikator: 5 kr × 1, 10 kr × 2, 15 kr × 3)

### 6.3 Datamodell — `rules`-JSON

```json
{
  "gameVariant": "oddsen",
  "targetDraw": 55,
  "bingoBaseLow": 50000,
  "bingoBaseHigh": 150000
}
```

### 6.4 Engine-krav

- Ved Fullt Hus: sjekk `drawSequenceAtWin <= targetDraw` (inklusiv)
  - True → HIGH bucket → `bingoBaseHigh × bongstørrelse-multiplikator`
  - False → LOW bucket → `bingoBaseLow × bongstørrelse-multiplikator`
- Rad 1-4 følger standard auto-multiplikator-path

---

## 7. Bonus-spill (per-item override)

### 7.1 Hva er bonus-spill

4 mini-spill som kan trigges ved Fullt Hus i et hovedspill. Bonus-spill er **ikke** spill i katalogen — de aktiveres som tillegg per spilleplan-posisjon.

### 7.2 De fire bonus-spillene

| Slug | Display-navn |
|---|---|
| `wheel_of_fortune` | Lykkehjul |
| `color_draft` | Fargekladd |
| `treasure_chest` | Skattekiste |
| `mystery` | Mystery Joker |

### 7.3 Konfigurering

1. Per katalog-rad: `bonus_game_slug` = default, `bonus_game_enabled` = on/off-switch
2. Per spilleplan-item: `bonus_game_override` = overstyrer katalog-default
3. Forrang: `plan_item.bonus_game_override` > `catalog.bonus_game_slug` > ingen
4. `catalog.bonus_game_enabled = false` → ingen bonus uansett (master-switch)

### 7.4 Trigger

Aktiveres ved Fullt Hus i hovedspillet. Selve mini-game-mekanikken er separat fra hovedspillets payout-path (se seksjon 8).

---

## 8. Egne payout-paths utenfor Rad 1-4 + Fullt Hus

Følgende mekanikker er **separate paths** og IKKE en del av Rad 1-4 + Fullt Hus-utbetaling. De legges på toppen som ekstra premier:

| Path | Beskrivelse |
|---|---|
| **Innsatsen-pot** | Egen pot som akkumuleres over runder. Utbetales ved Fullt Hus innen terskel. |
| **Lucky Number Bonus** | Ekstra-premie hvis Fullt Hus oppnås på "lucky-ball". |
| **Jackpott daglig akkumulering** | +4000/dag, max 30 000. Egen utbetaling. |
| **Mini-games (bonus-spill)** | Lykkehjul/Fargekladd/Skattekiste/Mystery — egne premier separate fra hovedspillet. |

**Ikke bland disse med Rad 1-4 / Fullt Hus.** Når du fikser bugs i hovedpremie-pathen, ikke endre disse separate paths.

---

## 9. Multi-vinner-scenarier — ÅPENT SPØRSMÅL

> **Status:** Avventer bekreftelse fra Tobias.

### 9.1 Bakgrunn

Når flere vinnere får samme phase (Rad 1, Rad 2, ..., Fullt Hus) i samme trekk, oppstår spørsmålet: får hver vinner sin farges multiplikatert prize, eller deles en pot mellom dem?

### 9.2 Engine-implementasjon i dag

`Game1DrawEngineService.payoutPerColorGroups` bruker tilsynelatende "firstColor's pattern" — alle vinnere deler likt uavhengig av bongfarge. Det betyr en lilla-vinner ved siden av en hvit-vinner får ikke 3x det den hvite får.

### 9.3 Mulige tolkninger

**Tolkning A — Per-vinner per farge (Tobias' uttalte hovedregel):**
- Hvit-vinner får 100 kr (rad1_base × 1)
- Lilla-vinner får 300 kr (rad1_base × 3)
- Hver vinner uavhengig av andre

**Tolkning B — Pot-deling per farge:**
- Pot per fargegruppe deles likt blant vinnerne i gruppen
- Lilla-pot på 300 kr for én vinner; 150 kr/vinner ved to lilla-vinnere; osv.

**Tolkning C — Pot-deling samlet:**
- En total pot for phase deles likt mellom ALLE vinnere uavhengig av farge

### 9.4 Konsekvens for koden

- Hvis Tolkning A er korrekt: engine `payoutPerColorGroups` har bug og må endres
- Hvis Tolkning B: engine kan være korrekt avhengig av implementasjon
- Hvis Tolkning C: engine kan være korrekt, men auto-multiplikator gir lite mening for multi-vinner

**Tobias må bekrefte hvilken som gjelder for pilot.** Når svar foreligger, oppdater denne seksjonen og fjern "ÅPENT SPØRSMÅL"-stempelet.

---

## 10. Engine-bridge ticket-config-shape

### 10.1 Shape engine forventer

Engine (`Game1DrawEngineHelpers.resolvePhaseConfig`) leser premie-config fra `ticket_config_json`. Forventet shape:

```json
{
  "spill1": {
    "ticketColors": [
      {
        "color": "small_yellow",  // slug-form, ikke familienavn
        "pricePerTicket": 500,
        "prizePerPattern": {
          "row_1": 10000,
          "row_2": 10000,
          "row_3": 10000,
          "row_4": 10000,
          "full_house": 100000
        }
      },
      // ... én entry per (color, size)-kombinasjon
    ]
  }
}
```

### 10.2 Slug-form vs familie-form

Engine bruker **slug-form** (`small_yellow`, `large_yellow`, `small_white`, ...) for ticketColors-keys, IKKE familie-form (`yellow`, `white`, `purple`).

For backward-compat har vi også `ticketTypesData` på toppnivå med familie-form som brukes av `Game1TicketPurchaseService`.

### 10.3 Bridge skriver auto-multiplikatert

Bridge (`buildTicketConfigFromCatalog`) må bygge `prizePerPattern` med **auto-multiplikator anvendt per bongfarge**:

```typescript
// Pseudo-code
for (color of ticketColors) {
  ticketPrice = ticketPricesCents[color];
  multiplier = ticketPrice / 500;
  prizePerPattern = {
    row_1: rad1_base * multiplier,
    row_2: rad2_base * multiplier,
    row_3: rad3_base * multiplier,
    row_4: rad4_base * multiplier,
    full_house: bingoBase * multiplier,
  };
}
```

For `prize_multiplier_mode = "explicit_per_color"` (Trafikklys): bruk `prizesCents`-verdiene direkte uten skalering.

For `gameVariant = "oddsen"`: skriv egen `spill1.oddsen`-section med `targetDraw`, `bingoLowPrizes`, `bingoHighPrizes` per farge. Engine sjekker først for oddsen-section og bruker den hvis tilstede.

### 10.4 Behold for audit/debug

Bridge skriver også på toppnivå:
- `rowPrizes: { row1, row2, row3, row4 }` — basisverdier (ikke skalert)
- `bingoBase` — basisverdi
- `bingoPrizes: { yellow, white, purple }` — familie-form for backward-compat

Disse er IKKE primær-kilde for engine — de er audit-felter.

---

## 11. Compliance-ledger

Alle utbetalinger skrives til `app_rg_compliance_ledger` (eller tilsvarende) med korrekt `gameType`:

- `gameType = MAIN_GAME` for Spill 1-3 og alle 13 katalog-varianter (inkl. Oddsen og Trafikklys)
- `gameType = DATABINGO` for SpinnGo

§11-distribusjons-prosent leses fra gameType:
- `MAIN_GAME` → 15%
- `DATABINGO` → 30%

Audit-felter som SKAL skrives ved spesial-payouts:
- `gameVariant` — "standard" / "trafikklys" / "oddsen"
- For Trafikklys: `rowColor` — hvilken rad-farge ble trukket
- For Oddsen: `targetDraw` + `outcomeBucket` ("low" / "high")

---

## 12. Pilot-skopp (status 2026-05-08)

### 12.1 Pilot-haller (4 stk i én Group of Halls)

| Hall | Rolle | Hall-ID |
|---|---|---|
| Teknobingo Årnes | Master | `b18b7928-3469-4b71-a34d-3f81a1b09a88` |
| Bodø | Deltaker | `afebd2a2-52d7-4340-b5db-64453894cd8e` |
| Brumunddal | Deltaker | `46dbd01a-4033-4d87-86ca-bf148d0359c1` |
| Fauske | Deltaker | `ff631941-f807-4c39-8e41-83ca0b50d879` |

### 12.2 Skala

- Pilot kjører 4 haller første runde
- Når stabil → utvides med flere haller og spillere
- Ingen tidsplan presser — kvalitet over hastighet

### 12.3 Pilot-spill

- Hovedspill 1 (alle 13 katalog-varianter inkl. Oddsen og Trafikklys)
- Hovedspill 2 og 3 skal også være pilot-klare
- Bonus-spill aktivert per spilleplan-item

---

## 13. Vanlige misforståelser

### 13.1 "2500 kr cap gjelder all bingo"

**Feil.** Cap gjelder kun databingo. Hovedspill har ingen single-prize cap.

### 13.2 "Premie er flat per pattern"

**Feil.** Auto-multiplikator gjelder per bongfarge for alle Rad 1-4 + Fullt Hus.

### 13.3 "Rad 1-4 og Fullt Hus skal ha forskjellig multiplikator-regel"

**Feil.** Samme regel — base × (ticketPrice / 500).

### 13.4 "Trafikklys er en variant av auto-mult"

**Feil.** Trafikklys er `explicit_per_color` — ingen auto-skalering. Premier defineres direkte per rad-farge.

### 13.5 "Oddsen overrider auto-multiplikator helt"

**Halvt riktig.** Oddsen overrider KUN Fullt Hus-payout (low/high split). Rad 1-4 i Oddsen-spill følger standard auto-multiplikator.

### 13.6 "Innsatsen, Lucky Bonus og Mini-games er del av Rad 1-4-payout"

**Feil.** De er separate paths som legges på toppen av hovedpremiene.

### 13.7 "Spill 4 er hovedspill"

**Feil.** "Spill 4" markedsføringsnavn = SpinnGo = `spillorama` slug = **databingo**, IKKE hovedspill.

### 13.8 "Game 4 er noe spesifikt"

**Feil.** Game 4 / `themebingo` er deprecated (BIN-496, 2026-04-17). Ikke bruk. SpinnGo er Spill 4 i markedsføring men `game5` i kode-historikk.

---

## 14. Sjekkliste for nye agenter som rører payout-kode

Før du skriver eller endrer kode i payout-pathen, gå gjennom denne sjekklisten:

- [ ] Har jeg lest dette dokumentet i sin helhet?
- [ ] Forstår jeg forskjellen mellom `MAIN_GAME` og `DATABINGO` for cap-håndhevelse?
- [ ] Har jeg verifisert at endringen min ikke feilaktig capper hovedspill?
- [ ] Har jeg sjekket at auto-multiplikator gjelder per bongfarge for Rad 1-4 OG Fullt Hus?
- [ ] Har jeg unngått å rote sammen Rad 1-4-payout med Innsatsen-pot / Lucky Bonus / Mini-games?
- [ ] Har jeg testet både SOLO-vinner og MULTI-vinner-scenarier?
- [ ] Skriver jeg `gameVariant` + `rowColor` (Trafikklys) eller `targetDraw` + bucket (Oddsen) til compliance-ledger?
- [ ] Har jeg verifisert at engine leser shape jeg skriver (slug-form i `spill1.ticketColors[]`, ikke familienavn-form)?

---

## 15. Endringslogg

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-08 | Initial versjon. Konsolidert fra PM_HANDOFF_2026-05-07.md, SPILLKATALOG.md, og direkte bekreftelser fra Tobias gjennom flere PM-sesjoner. Multi-vinner-regel markert som åpent spørsmål. | PM-AI (Claude Opus 4.7) |

---

## 16. Referanser

- [docs/architecture/SPILLKATALOG.md](./SPILLKATALOG.md) — markedsføringsnavn vs slug, regulatoriske kategorier
- [docs/operations/PM_HANDOFF_2026-05-07.md](../operations/PM_HANDOFF_2026-05-07.md) — opprinnelig kilde for spilleplan-redesign-detaljer
- [docs/architecture/GAME_PLAN_REDESIGN_DEPRECATION_PLAN_2026-05-07.md](./GAME_PLAN_REDESIGN_DEPRECATION_PLAN_2026-05-07.md) — utrullings-plan for ny modell
- [docs/architecture/ARKITEKTUR.md](./ARKITEKTUR.md) — system-overordnet
- [apps/backend/src/game/GamePlanEngineBridge.ts](../../apps/backend/src/game/GamePlanEngineBridge.ts) — bridge-implementasjon
- [apps/backend/src/game/GameCatalogService.ts](../../apps/backend/src/game/GameCatalogService.ts) — `calculateActualPrize`-helper
- [apps/backend/src/game/Game1DrawEngineHelpers.ts](../../apps/backend/src/game/Game1DrawEngineHelpers.ts) — `resolvePhaseConfig`
- [apps/backend/src/game/ledgerGameTypeForSlug.ts](../../apps/backend/src/game/ledgerGameTypeForSlug.ts) — slug → gameType-mapping
- [apps/backend/src/adapters/PrizePolicyPort.ts](../../apps/backend/src/adapters/PrizePolicyPort.ts) — single-prize-cap (databingo)
