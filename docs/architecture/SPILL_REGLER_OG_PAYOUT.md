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

## 9. Multi-vinner-regel — Pot per bongstørrelse

> **Status:** DEFINITIV. Bekreftet av Tobias 2026-05-08. Erstatter §3 i `docs/operations/SPILL1_VINNINGSREGLER.md` (som sa flat-deling 50/50 — feil).

### 9.1 Regelen

For hver fase (Rad 1, Rad 2, Rad 3, Rad 4, Fullt Hus) er det **separate potter per bongstørrelse**. Hver pot deles likt mellom bongene som vant innenfor samme bongstørrelse. En spiller får summen av sine bongers andeler.

**Det utbetales aldri mer enn én pot per bongstørrelse for samme fase.** Multi-bong-per-spiller gir ikke ekstra utbetalinger — spilleren får sin andel av poten, ikke per-bong-utbetaling.

### 9.2 Formel

```
pot[bongstørrelse] = base × bongMultiplier[bongstørrelse]
```

der `bongMultiplier` er:
- Hvit (5 kr): × 1
- Gul (10 kr): × 2
- Lilla (15 kr): × 3

```
hver vinnende bongs andel = pot[bongstørrelse] / antall_vinnende_bonger_i_samme_størrelse
spillerens utbetaling     = sum av alle hens vinnende bongers andel
```

Hvis en bongstørrelse ikke har noen vinnere, utbetales den potten ikke (poten "går ikke videre" til andre bongstørrelser).

### 9.3 Test-matrise (Rad 1 base = 100 kr)

| Scenario | Hvit-pot (100) | Gul-pot (200) | Lilla-pot (300) | Spiller-utbetaling |
|---|---|---|---|---|
| 1 hvit-spiller solo | 100 (1 bong) | — | — | hvit får **100** |
| 1 lilla-spiller solo | — | — | 300 (1 bong) | lilla får **300** |
| 1 hvit + 1 lilla (forskjellige spillere) | 100 (1) | — | 300 (1) | hvit **100**, lilla **300** |
| 2 hvit-spillere | 100 (2) | — | — | hver hvit får **50** |
| 2 gul-spillere | — | 200 (2) | — | hver gul får **100** ("50/50"-prinsippet) |
| 2 lilla-spillere | — | — | 300 (2) | hver lilla får **150** |
| 1 spiller med 3 lilla-bonger som alle vinner | — | — | 300 (3 bonger samme spiller) | spilleren får **300** (alle 3 andelene) |
| 3 forskjellige spillere med 1 lilla-bong hver | — | — | 300 (3 bonger forskjellige spillere) | hver spiller får **100** |
| 1 hvit + 1 gul + 1 lilla | 100 (1) | 200 (1) | 300 (1) | hvit 100, gul 200, lilla 300 (forhold 1:2:3) |

**Verifisering mot prinsippene Tobias har bekreftet:**
- ✅ "Innsats avgjør gevinst" — lilla-pot (300) > gul-pot (200) > hvit-pot (100)
- ✅ "Aldri flere gevinster per rad" — én pot per bongstørrelse, ikke per bong
- ✅ "Spilleren som satser mest vinner mest" — lilla-spillere vinner mer enn hvit-spillere
- ✅ "Begge satser 10 kr → 50/50" — gul-pot (200) deles likt på 2 gul-vinnere = 100 hver
- ✅ "Spilleren med 3 bonger får alt" — én pot, alle 3 andelene går til samme spiller = full pot
- ✅ "1/3 til 5 kr-bong, 2/3 til 10 kr-bong" — solo hvit (100) vs solo gul (200), forhold 1:2 av total payout 300

### 9.4 Trafikklys avviker

For Trafikklys (`prize_multiplier_mode = "explicit_per_color"`) er bongprisen flat 15 kr. Pot-størrelsen er definert av RAD-FARGEN (ikke bongfargen):

- Pot = `prizesPerRowColor[radFarge]` for radvinst, eller `bingoPerRowColor[radFarge]` for Fullt Hus
- Alle vinnere deler poten likt (ikke vektet — alle bonger har samme pris og dermed samme vekt)

Dette er en spesialregel som kun gjelder Trafikklys-katalog-rader.

### 9.5 Oddsen

Pot-per-bongstørrelse gjelder også Oddsen. Eneste forskjell på Fullt Hus:
- Pot-base bytter mellom `bingoBaseLow` og `bingoBaseHigh` avhengig av om Fullt Hus skjedde på trekk ≤ `targetDraw` (HIGH) eller etter (LOW)

Eksempel — Oddsen-55 med Fullt Hus på trekk 50 (HIGH-bucket):
- Lilla-pot = 1500 × 3 = 4500 kr
- 1 lilla-spiller solo → 4500 kr
- 2 lilla-spillere → hver får 2250 kr (lilla-pot delt likt mellom 2 lilla-bonger)

### 9.6 Compliance-ledger-felter

For full Lotteritilsynet-sporbarhet må følgende skrives per vinner:
- `prizeAmountCents` — vinnerens faktiske utbetaling
- `ticketColor` — vinnerens bongfarge
- `ticketPriceCents` — vinnerens innsats (5/10/15 kr)
- `bongMultiplier` — vekt brukt (1/2/3)
- `potCentsForBongSize` — størrelsen på poten for denne bongstørrelsen (base × multiplier)
- `winningTicketsInSameSize` — antall bonger som vant samme pot
- `winningPlayersInSameSize` — antall unike spillere innenfor samme bongstørrelse

Dette gjør at en revisor kan reprodusere utbetalingen fra ledger-data alene.

### 9.7 Engine-implementasjon

```
for each phase (Rad 1, ..., Fullt Hus):
  for each bongstørrelse (hvit, gul, lilla):
    winning_tickets = tickets som vant denne fasen med denne bongstørrelsen
    if len(winning_tickets) == 0:
      continue  // ingen pot utbetales for denne størrelsen
    pot_cents = base × bongMultiplier[bongstørrelse]
    share_per_ticket = floor(pot_cents / len(winning_tickets))
    rest = pot_cents - (share_per_ticket × len(winning_tickets))  // floor-rest til HOUSE_RETAINED
    for each ticket in winning_tickets:
      pay(ticket.player, share_per_ticket)
    if rest > 0:
      log_house_retained(rest)  // floor-rounding-rest, audit-event
```

**Floor-rounding:** Hvis `pot_cents % len(winning_tickets) != 0`, går resten til huset som `HOUSE_RETAINED`-ledger-event (samme floor-regel som eksisterende `SPILL1_VINNINGSREGLER.md` §3 — denne delen er uendret).

**Presisering — øre vs kr:** Engine opererer i øre (cents), ikke hele kroner. Eksempel-tabellen i §9.3 og test-eksempler i `SPILL1_VINNINGSREGLER.md` §3 bruker forenklet kr-notasjon for lesbarhet, men faktisk implementasjon er:

```
Eksempel: Lilla-pot 300 kr (30000 øre), 7 vinnende lilla-bonger
Engine-flow:
  pot_cents = 30000
  share_per_ticket = floor(30000 / 7) = 4285 øre = 42.85 kr
  total_distributed = 4285 × 7 = 29995 øre
  rest = 30000 - 29995 = 5 øre = 0.05 kr → HOUSE_RETAINED

NB: Hvis tabellen ovenfor sier "42 kr per bong, 6 kr til hus" er det kr-floor.
Engine er presist 42.85 kr per bong, 5 øre til hus. Mathematisk korrekt.
```

Ledger-skriving alltid i øre (`prizeAmountCents`) — kr-konvertering for visning skjer i frontend.

### 9.8 Status

Eksisterende engine-path `Game1DrawEngineService.payoutPerColorGroups` med "firstColor's pattern" implementerer **verken** denne regelen eller flat-deling-uten-vekting. PR #995 implementerte per-vinner-uavhengig (Tolkning A) — også feil. Begge må erstattes med ny path som matcher §9.7 over.

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
| 2026-05-08 | Multi-vinner-regel (§9) bekreftet av Tobias som "per-vinner per farge" (Tolkning A). Engine-pathen `payoutPerColorGroups` må endres for å matche regelen. | PM-AI (Claude Opus 4.7) |
| 2026-05-08 | §9 utvidet med presis formulering: bong-vektet pot-deling (matematisk ekvivalent med per-vinner auto-mult). Tobias bekreftet at det skal eksponeres som "deling av pot" der pot skalerer med vinnernes innsats. Eksempel-tabell + compliance-ledger-felter + Oddsen-utvidelse lagt til. | PM-AI (Claude Opus 4.7) |

---

## 16. Referanser

- [docs/architecture/SPILL_DETALJER_PER_SPILL.md](./SPILL_DETALJER_PER_SPILL.md) — komplett per-spill-spec for alle 13 katalog-varianter + Spill 2/3/4 + bonus-mini-spill
- [docs/architecture/SPILLKATALOG.md](./SPILLKATALOG.md) — markedsføringsnavn vs slug, regulatoriske kategorier
- [docs/operations/PM_HANDOFF_2026-05-07.md](../operations/PM_HANDOFF_2026-05-07.md) — opprinnelig kilde for spilleplan-redesign-detaljer
- [docs/architecture/GAME_PLAN_REDESIGN_DEPRECATION_PLAN_2026-05-07.md](./GAME_PLAN_REDESIGN_DEPRECATION_PLAN_2026-05-07.md) — utrullings-plan for ny modell
- [docs/architecture/ARKITEKTUR.md](./ARKITEKTUR.md) — system-overordnet
- [apps/backend/src/game/GamePlanEngineBridge.ts](../../apps/backend/src/game/GamePlanEngineBridge.ts) — bridge-implementasjon
- [apps/backend/src/game/GameCatalogService.ts](../../apps/backend/src/game/GameCatalogService.ts) — `calculateActualPrize`-helper
- [apps/backend/src/game/Game1DrawEngineHelpers.ts](../../apps/backend/src/game/Game1DrawEngineHelpers.ts) — `resolvePhaseConfig`
- [apps/backend/src/game/ledgerGameTypeForSlug.ts](../../apps/backend/src/game/ledgerGameTypeForSlug.ts) — slug → gameType-mapping
- [apps/backend/src/adapters/PrizePolicyPort.ts](../../apps/backend/src/adapters/PrizePolicyPort.ts) — single-prize-cap (databingo)
