# Spill-detaljer per spill — komplett spec

**Status:** Autoritativ. Komplementerer [SPILL_REGLER_OG_PAYOUT.md](./SPILL_REGLER_OG_PAYOUT.md) (felles mekanikker) med per-spill-detaljer.
**Sist oppdatert:** 2026-05-08
**Lese-først-i-sesjon:** Ja — sammen med kanonisk regler-doc.

> **Hvordan dette dokumentet er bygget opp:**
> - For hvert spill: mekanikk + bongpriser + premier + spesial-regler + bonus-defaults
> - Premie-base-tall som **må verifiseres mot prod-katalog** er markert med ⚠️
> - Tall som er bekreftet av Tobias er markert med ✅
> - Mekanikk-beskrivelser er fra forrige PM-handoffs + kode + Tobias' bekreftelser

---

## 0. Oversikt

| Markedsnavn | Slug | Salg | Master | Globalt rom | Auto-progresjon | Regulatorisk | Engine |
|---|---|---|---|---|---|---|---|
| **Spill 1** (Hovedspill 1) | familie `bingo` (12 varianter) | **Fysisk + online** | ✅ Master per GoH | Per GoH | Master-styrt mellom rader | MAIN_GAME | BingoEngine + Game1DrawEngineService |
| **Spill 2** (Hovedspill 2) | `rocket` | Online only | ❌ Ingen master | ETT globalt | ✅ Fullt automatisk | MAIN_GAME | Game2Engine |
| **Spill 3** (Hovedspill 3) | `monsterbingo` | Online only | ❌ Ingen master | ETT globalt | ✅ Fullt automatisk | MAIN_GAME | Game3Engine (re-design pågår 2026-05-08) |
| **SpinnGo** (Spill 4) | `spillorama` | Online (player-startet) | — | — | Player-startet | DATABINGO | SpinnGo-engine |
| Candy (eksternt) | `candy` | — | — | — | — | N/A | Tredjepart-leverandør |

### 0.1 Beslutningstre — hvor hører min endring hjemme?

```
Trenger jeg å endre fysisk-bong-salg, master-handling, multi-hall-koordinering?
└── Spill 1 (familie `bingo`) — VELG ALDRI Spill 2/3 for dette

Trenger jeg å endre fullautomatisert online-runde, threshold-start, globalt rom?
└── Spill 2 (`rocket`) eller Spill 3 (`monsterbingo`) — Spill 1 har det IKKE

Trenger jeg å legge til/endre gevinstmønster for Spill 1?
└── ❌ FORBUDT — Spill 1 sine gevinstmønstre er definert: Rad 1, Rad 2, Rad 3, Rad 4, Fullt Hus.
   Nye gevinstmønster-varianter (eks. Bokstav, T/L/X-mønster) hører hjemme på Spill 3.

Trenger jeg å endre player-startet rulett-mekanikk?
└── SpinnGo (`spillorama`) — egen engine, databingo-kategori
```

### 0.2 Bokstav er IKKE et Spill 1-katalog-rad (avklart 2026-05-08)

Tobias presiserte 2026-05-08: Bokstav er en **gevinstmønster-variant for Spill 3** (når Spill 3-runtime er implementert, kommer Bokstav som en variant der). Bokstav skal **ikke** være en Spill 1-katalog-rad.

**Konsekvens:**
- Slug `bokstav` slettes/deaktiveres fra Spill 1-katalog (én rad mindre — 12 totalt, ikke 13)
- Bokstav-mønster-mekanikk bygges inn i Spill 3-runtime som valgbar variant (admin kan velge mønster per runde eller per spilleplan-item)
- Ny Spill 3-config-tabell må støtte mønster-variant-felter

---

## 1. Hovedspill 1 — slug-familie `bingo` (12 katalog-varianter)

### 1.0 Arkitektur-overordnet (KRITISK — definert + immutable)

> **STATUSAVKLARING 2026-05-08:** Spill 1's gevinstmønstre er DEFINERT som `Rad 1, Rad 2, Rad 3, Rad 4, Fullt Hus` og skal ALDRI endres. Nye gevinstmønster-varianter (eks. Bokstav, T/L/X-mønstre) hører hjemme på Spill 3, ikke Spill 1.

**Spill 1 sine kjennetegn:**

| Egenskap | Verdi |
|---|---|
| Salg av fysiske bonger | ✅ Ja (i hall, via agent) |
| Online-kjøp | ✅ Ja (parallelt med fysiske) |
| Master-handling | ✅ Master-hall styrer rundene (start/pause/start neste rad) |
| Multi-hall | ✅ Flere haller linket via group-of-halls (GoH) |
| Auto-progresjon mellom rader | ❌ Master-styrt (ikke automatisk) |
| Globalt rom | ❌ Per-GoH (én GoH = ett rom) |
| Bongstørrelser | Hvit 5 / Gul 10 / Lilla 15 kr |
| Faser (immutable) | Rad 1, Rad 2, Rad 3, Rad 4, Fullt Hus |

**Master-handling:** Master-hall (definert per GoH via `master_hall_id`) styrer:
- Når runden starter (`Game1MasterControlService.startGame`)
- Pause/resume
- Start neste rad etter pause-perioden
- Bekreftelse av røde haller (TASK HS — `Game1MasterControlService.ts:121`)

**Multi-hall-koordinering:** `GamePlanEngineBridge.resolveParticipatingHallIds` (PR #998) henter alle aktive medlemmer av master-hallens GoH og inkluderer i `participating_halls_json`. Master kan ekskludere haller midlertidig (men ikke seg selv).

### 1.1 Felles mekanikk for ALLE Spill 1-varianter

**Spill-engine:** BingoEngine + Game1DrawEngineService (`apps/backend/src/game/`)

**Spillebrett:**
- 75 baller (1-75)
- 5×5 grid med fri sentercelle (untatt Spill 3 monsterbingo som er separat slug)

**Faser (alle hovedpremier):**
1. Rad 1 (første horisontale rad fylt)
2. Rad 2
3. Rad 3
4. Rad 4
5. Fullt Hus (alle 25 ruter)

**Bongpriser (gjelder ALLE varianter untatt Trafikklys):**

| Bongfarge | Pris | Multiplikator |
|---|---|---|
| Hvit | 5 kr | × 1 |
| Gul | 10 kr | × 2 |
| Lilla | 15 kr | × 3 |

**Bongstørrelse-konvensjon:** Hver farge har Small og Large variant. Engine bruker slug-form `small_yellow`, `large_yellow`, etc. Large = 2× Small per default.

**Premie-mekanikk:** Auto-multiplikator (untatt Trafikklys). Premier oppgis som base for 5 kr-bong; backend skalerer til 10 kr × 2 og 15 kr × 3.

**Multi-vinner:** Per-vinner per farge (Tolkning A — bekreftet 2026-05-08). Ingen pot-deling.

**Cap:** Ingen single-prize cap på hovedspill.

**§11-distribusjon:** Minst 15% til organisasjoner.

---

### 1.2 Bingo (slug `bingo`)

**Mekanikk:** Standard 75-ball Spill 1.

**Variant:** `standard` — auto-multiplikator
**Bongpriser:** ✅ Hvit 5 / Gul 10 / Lilla 15

**Premier (5 kr-base):**

| Fase | Base | Hvit | Gul | Lilla |
|---|---|---|---|---|
| Rad 1 | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| Rad 2 | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| Rad 3 | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| Rad 4 | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| Fullt Hus | ✅ 1000 | 1000 | 2000 | 3000 |

⚠️ Rad 1-4 base-verdier må hentes fra prod-katalog. Tobias kan eksportere via `GET /api/admin/game-catalog/<id>`.

**Bonus-spill:** ⚠️ Verifiser default fra prod-katalog
**Spesial-trekninger:** Ingen
**Jackpot-popup:** Nei

---

### 1.3 1000-spill (slug `1000-spill`)

**Mekanikk:** Standard 75-ball Spill 1. Distinkt fra "Bingo" som egen katalog-rad — premie-skalering kan avvike.

**Variant:** `standard` — auto-multiplikator
**Bongpriser:** ✅ Hvit 5 / Gul 10 / Lilla 15

**Premier (5 kr-base):**

| Fase | Base | Hvit | Gul | Lilla |
|---|---|---|---|---|
| Rad 1-4 | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| Fullt Hus | ✅ 1000 | 1000 | 2000 | 3000 |

**Bonus-spill:** ⚠️
**Spesial-trekninger:** Ingen
**Jackpot-popup:** Nei

---

### 1.4 5×500 (slug `5x500`)

**Mekanikk:** Standard 75-ball Spill 1 med lavere bingo-premie.

**Variant:** `standard` — auto-multiplikator
**Bongpriser:** ✅ Hvit 5 / Gul 10 / Lilla 15

**Premier (5 kr-base):**

| Fase | Base | Hvit | Gul | Lilla |
|---|---|---|---|---|
| Rad 1-4 | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| Fullt Hus | ✅ 500 | 500 | 1000 | 1500 |

**Bonus-spill:** ⚠️
**Spesial-trekninger:** Ingen
**Jackpot-popup:** Nei

> **Navnefortolkning:** Tobias bør bekrefte om "5×500" indikerer 5 separate runder med 500 kr-pott, eller bare en 500 kr Fullt Hus-base.

---

### 1.5 Ball × 10 (slug `ball-x-10`)

**Mekanikk (verifisert 2026-05-08):** Standard 75-ball Spill 1 med ball-value-multiplier på Fullt Hus.

**Variant:** `standard` — auto-multiplikator + ball-value-multiplier på Fullt Hus
**Bongpriser:** ✅ Hvit 5 / Gul 10 / Lilla 15
**`winningType`:** `ball-value-multiplier` (preset-låst)

**Premier (5 kr-base):**

| Fase | Beregning | Eksempel (Hvit, siste ball = 50) |
|---|---|---|
| Rad 1 | ✅ 100 kr (fixed) | 100 kr |
| Rad 2 | ✅ 200 kr (fixed) | 200 kr |
| Rad 3 | ✅ 200 kr (fixed) | 200 kr |
| Rad 4 | ✅ 200 kr (fixed) | 200 kr |
| Fullt Hus | ✅ `base 1250 + (siste ball × 10)` | 1250 + 500 = 1750 kr |

**Auto-multiplikator anvendes på Fullt Hus:**
- Hvit 5 kr: 1750 kr (× 1)
- Gul 10 kr: 3500 kr (× 2)
- Lilla 15 kr: 5250 kr (× 3)

**Implementasjon:**
- Engine: `BingoEngine.ballValue.test.ts` (full enhetstest-suite)
- Pattern-eval: `BingoEnginePatternEval.ts:394-420`
- Preset: `packages/shared-types/src/spill1-sub-variants.ts:408-453`

**Bonus-spill:** Etter standard per-item override-regler (§7.3)
**Spesial-trekninger:** Ingen (75-ball)
**Jackpot-popup:** Nei

✅ **PILOT-KLAR** — verifisert mekanikk, preset-låst, enhetstestet.

---

### 1.6 ~~Bokstav~~ (FJERNET 2026-05-08)

> **AVKLART 2026-05-08:** Bokstav er IKKE et Spill 1-katalog-rad. Tobias presiserte at Bokstav er en **gevinstmønster-variant for Spill 3** når Spill 3-runtime er implementert.
>
> **Konsekvens:**
> - Slug `bokstav` skal slettes/deaktiveres fra Spill 1-katalog (12 katalog-rader, ikke 13)
> - Bokstav-mønster bygges inn i Spill 3-runtime som valgbar mønster-variant
> - Se §3 (Spill 3) for Bokstav-mønster-spec
>
> **Spill 1 har permanent definerte faser:** Rad 1, Rad 2, Rad 3, Rad 4, Fullt Hus. INGEN nye gevinstmønstre kommer til Spill 1.

---

### 1.7 Innsatsen (slug `innsatsen`)

**Mekanikk:** Standard 75-ball Spill 1 med **Innsatsen-pot** som ekstra premie.

**Variant:** `standard` — auto-multiplikator
**Bongpriser:** ✅ Hvit 5 / Gul 10 / Lilla 15

**Premier (5 kr-base):**

| Fase | Base | Hvit | Gul | Lilla |
|---|---|---|---|---|
| Rad 1-4 | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| Fullt Hus | ✅ 500-2000 | 500-2000 | 1000-4000 | 1500-6000 |

**Spesial-mekanikk: Innsatsen-pot**

- Egen pot som akkumuleres over runder
- Pot utbetales hvis Fullt Hus oppnås innen en terskel
- Implementert som **separat path** fra Rad 1-4 + Fullt Hus
- Service: `apps/backend/src/game/pot/PotEvaluator.ts`
- Akkumuleringsregler: ⚠️ verifiseres
- Utbetalings-terskel: ⚠️ verifiseres

> **Viktig:** Innsatsen-pot er IKKE del av rad-payout-mekanikken. Det er en uavhengig premie som legges på toppen.

**Bonus-spill:** ⚠️
**Jackpot-popup:** Nei

---

### 1.8 Jackpot (slug `jackpot`)

**Mekanikk:** Standard 75-ball Spill 1 med **master-konfigurert jackpot per runde**.

**Variant:** `standard` — auto-multiplikator (men jackpot overstyrer Fullt Hus-utbetaling)
**Bongpriser:** ✅ Hvit 5 / Gul 10 / Lilla 15

**Spesial-mekanikk: Jackpot-popup**

- `requires_jackpot_setup = true` på katalog-raden
- Når master prøver å starte spillet: backend returnerer `JACKPOT_SETUP_REQUIRED`
- Frontend viser popup med 4 inputs:
  1. **"Hvilket trekk?"** (draw-nummer 1-90, typisk 1-75)
  2. Premie hvit (kr)
  3. Premie gul (kr)
  4. Premie lilla (kr)
- Master submitter → lagres i `app_game_plan_run.jackpot_overrides_json[<position>]`
- Engine bruker overrides ved Fullt Hus-utbetaling

**Premier (Rad 1-4):**

| Fase | Base | Hvit | Gul | Lilla |
|---|---|---|---|---|
| Rad 1-4 | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| Fullt Hus | **Master setter via popup** | per popup | per popup | per popup |

> **Daglig akkumulering:** Spillorama har en separat "Jackpott daglig akkumulering" (+4000 kr/dag, max 30 000) — er denne knyttet til `jackpot`-katalog-raden eller en helt egen mekanikk? ⚠️ verifiseres.

**Bonus-spill:** ⚠️

---

### 1.9 Kvikkis (slug `kvikkis`)

**Mekanikk:** Standard 75-ball Spill 1, raskere tempo.

**Variant:** `standard` — auto-multiplikator
**Bongpriser:** ✅ Hvit 5 / Gul 10 / Lilla 15

**Premier (5 kr-base):**

| Fase | Base | Hvit | Gul | Lilla |
|---|---|---|---|---|
| Rad 1-4 | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| Fullt Hus | ✅ 1000 | 1000 | 2000 | 3000 |

**Spesial-mekanikk:** ⚠️ Trolig kortere intervall mellom trekk.

> **Åpent spørsmål til Tobias:** Hva skiller Kvikkis fra "Bingo" (1000-base) bortsett fra tempo?

**Bonus-spill:** ⚠️
**Jackpot-popup:** Nei

---

### 1.10 Oddsen 55 (slug `oddsen-55`)

**Mekanikk:** Spesialspill — Spill 1 med target-draw-mekanikk på Fullt Hus.

**Variant:** ✅ `oddsen` — auto-multiplikator + target-draw-bucket
**Bongpriser:** ✅ Hvit 5 / Gul 10 / Lilla 15
**`prize_multiplier_mode`:** `auto`

**`rules`-JSON:**
```json
{
  "gameVariant": "oddsen",
  "targetDraw": 55,
  "bingoBaseLow": 50000,
  "bingoBaseHigh": 150000
}
```

**Premier:**

| Fase | Hvit | Gul | Lilla |
|---|---|---|---|
| Rad 1-4 | ⚠️ standard auto-mult | ⚠️ | ⚠️ |
| **Fullt Hus HIGH** (≤ trekk 55) | ✅ 1500 | 3000 | 4500 |
| **Fullt Hus LOW** (> trekk 55) | ✅ 500 | 1000 | 1500 |

**Spesial-mekanikk: Target-draw bucket**

- Engine sjekker `drawSequenceAtWin` mot `targetDraw = 55`
- `drawSequenceAtWin <= 55` (inklusiv) → HIGH bucket
- `drawSequenceAtWin > 55` → LOW bucket
- Auto-multiplikator gjelder per bongfarge på begge buckets

**Bonus-spill:** ⚠️
**Jackpot-popup:** Nei

> **Audit-felter** som SKAL skrives til compliance-ledger ved Oddsen-payout:
> - `gameVariant: "oddsen"`
> - `targetDraw: 55`
> - `outcomeBucket: "high" | "low"`

---

### 1.11 Oddsen 56 (slug `oddsen-56`)

Identisk med Oddsen 55, men `targetDraw = 56`.

**`rules`-JSON:**
```json
{
  "gameVariant": "oddsen",
  "targetDraw": 56,
  "bingoBaseLow": 50000,
  "bingoBaseHigh": 150000
}
```

Premie-tabell og mekanikk: se §1.10. Eneste forskjell er hvilken trekk-grense som utløser HIGH.

---

### 1.12 Oddsen 57 (slug `oddsen-57`)

Identisk med Oddsen 55, men `targetDraw = 57`.

**`rules`-JSON:**
```json
{
  "gameVariant": "oddsen",
  "targetDraw": 57,
  "bingoBaseLow": 50000,
  "bingoBaseHigh": 150000
}
```

---

### 1.13 Trafikklys (slug `trafikklys`)

**Mekanikk:** Spesialspill — Spill 1 med rad-farge-baserte premier.

**Variant:** ✅ `trafikklys` — `prize_multiplier_mode = "explicit_per_color"`
**Bongpriser:** ✅ Flat 15 kr alle bonger

**`rules`-JSON:**
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

**Premier per rad-farge:** ✅ Bekreftet av Tobias

| Rad-farge | Rad-premie | Fullt Hus |
|---|---|---|
| Rød | 50 kr | 500 kr |
| Grønn | 100 kr | 1000 kr |
| Gul | 150 kr | 1500 kr |

**Spesial-mekanikk:**

1. Master/system trekker rad-farge ved spill-start (én av tre: rød/grønn/gul)
2. Rad-farge persisteres på scheduled_game-rad
3. Klient/TV viser banner: "Denne runden er **<rad-farge>**"
4. Alle vinnere på samme rad får samme prize, uavhengig av bongfarge (fordi alle bonger er 15 kr)
5. Engine bruker `prizesPerRowColor[<radFarge>]` for Rad-payouts og `bingoPerRowColor[<radFarge>]` for Fullt Hus

**Multi-vinner-regel:** Trafikklys avviker fra hovedregelen — alle vinnere får SAMME prize uavhengig av bongfarge (fordi bongfargene har samme pris).

**Bonus-spill:** ⚠️
**Jackpot-popup:** Nei

> **Audit-felt** som SKAL skrives ved Trafikklys-payout:
> - `gameVariant: "trafikklys"`
> - `rowColor: "rød" | "grønn" | "gul"`

---

### 1.14 TV-Extra (slug `tv-extra`)

**Mekanikk:** Standard 75-ball Spill 1 med høyere bingo-premie. Ofte spilt i TV-sendt format.

**Variant:** `standard` — auto-multiplikator
**Bongpriser:** ✅ Hvit 5 / Gul 10 / Lilla 15

**Premier (5 kr-base):**

| Fase | Base | Hvit | Gul | Lilla |
|---|---|---|---|---|
| Rad 1-4 | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| Fullt Hus | ✅ 3000 | 3000 | 6000 | 9000 |

**Bonus-spill:** ⚠️
**Spesial-trekninger:** ⚠️ Mulig TV-spesifikk visning (f.eks. langsommere tempo for TV-sending)
**Jackpot-popup:** Nei

> **Åpent spørsmål til Tobias:** Er TV-Extra knyttet til en spesifikk TV-sending med ekstra-trekk eller egne pattern?

---

## 2. Hovedspill 2 — Rocket (slug `rocket`)

**Engine:** Game2Engine (`apps/backend/src/game/Game2Engine.ts`)

**Spillebrett:**
- 21 baller (1-21)
- 3×3 grid (full plate — 9 ruter, alle markeres for Fullt Hus)

**Antall rom:** ✅ ETT globalt rom (alle haller spiller samtidig)

**Bongpriser:** ✅ Standard hvit/gul/lilla (5/10/15)

**Premier:**

| Fase | Notat |
|---|---|
| Rad 1-3 (eller bare Fullt Hus?) | ⚠️ verifiseres — 3×3-grid har bare 3 rader |
| Fullt Hus | ⚠️ jackpot-skala konfigurerbar |

**Spesial-mekanikk:**

- Choose Tickets-side med **32 brett** for spilleren (per legacy-wireframe)
- Speed Dial: 5/10/15/20/25/30 boards
- Lucky Number-mekanikk
- Paginering på ticket-utvalg
- Jackpot-bar (admin-konfigurerbar via PR #972)
- Min-tickets-gate (admin-konfigurerbar via PR #972)
- Per-bonge auto-multiplikator gjelder ✅ (samme regel som Spill 1)

**Status pilot:** Spill 2 er pilot-klar i pilot-rolloutet, men admin-konfigurasjon for jackpot-skala og min-tickets-gate er nylig landet (PR #972, #973).

**Bonus-spill:** ⚠️ ikke spesifikt knyttet — Spill 2 har egne mekanikker (Lucky Number, Jackpot-bar)
**§11-distribusjon:** Minst 15%

> **Åpent spørsmål til Tobias:** Hvor mange faser har Spill 2 (Rad 1, Rad 2, Rad 3, Fullt Hus = 4? Eller bare Fullt Hus?), og er det auto-multiplikator-regelen som gjelder, eller en annen?

---

## 3. Hovedspill 3 — Monsterbingo (slug `monsterbingo`) — RE-DESIGN PÅGÅR 2026-05-08

> **STATUSAVKLARING 2026-05-08:** Tobias har bestemt at Spill 3 skal re-designes til å ha samme premie-mekanikk som Spill 1 (Rad 1-4 + Fullt Hus), men med **fullautomatisert online-only-runde-drift**. Tidligere "Row 1-4 + Coverall mønsterbingo per PR #860" er erstattet.

**Engine:** Game3Engine (re-implementeres) — fundament merget #1006, engine-utvidelse pågår

### 3.1 Arkitektur-overordnet (KRITISK — bekreftet av Tobias 2026-05-08)

| Egenskap | Verdi |
|---|---|
| Salg av fysiske bonger | ❌ Ingen — online-only |
| Master-handling | ❌ Ingen — fullt automatisk |
| Globalt rom | ✅ ETT live rom alltid aktivt — alle haller deltar |
| Auto-progresjon mellom rader | ✅ 3 sekunders pause, så start neste rad |
| Auto-start | ✅ Når threshold nås — admin-konfigurerbar globalt |
| Spillebrett | 75 baller, 5×5 grid med fri sentercelle (samme som Spill 1) |
| Faser | Rad 1, Rad 2, Rad 3, Rad 4, Fullt Hus |

### 3.2 Bonger

- **Kun 1 type bong** — ingen multi-farge
- **Pris: 5 kr** (flat)
- **Salg: kun før runden starter** — aldri midt i runde

### 3.3 Auto-start på threshold

- Admin-konfig: `minTicketsToStart` i backend-settings (admin-UI: `/admin/#/games/spill3-config`)
- Endres løpende av admin uten kode-deploy
- **Globalt for alle haller** (IKKE per GoH — alle haller deltar i samme rom)
- Hvis threshold ikke nås → spillet starter aldri
- Eksempel: i dag setter admin 50 bonger må selges; i morgen 20 bonger

### 3.4 Slutt på runde

Runde slutter når én av disse skjer:
- **Første Fullt Hus-vinner** identifisert
- **75 baller trukket** (selv uten Fullt Hus)

Etter slutt: rommet venter på neste threshold-trigger.

### 3.5 Premier

To admin-konfig-modus:

**Modus 1 — Fast (`prize_mode: "fixed"`):**
- Admin setter Rad 1 = X kr, Rad 2 = Y kr, etc., Fullt Hus = Z kr
- Premiene er konstante uansett antall solgte bonger

**Modus 2 — Prosent (`prize_mode: "percentage"`):**
- Admin setter Rad 1 = 5%, Rad 2 = 8%, etc., Fullt Hus = 30%
- Premie = `(prosent / 100) × total_bong_salg_for_runden`
- Eksempel: 200 bonger × 5 kr = 1000 kr omsetning. Rad 1 = 5% × 1000 = 50 kr
- Sum av prosenter må være ≤ 100% (validering)

**Default seed (migration 20261211000000 — fra #1006):**

| Fase | Pct |
|---|---|
| Rad 1 | 5% |
| Rad 2 | 8% |
| Rad 3 | 12% |
| Rad 4 | 15% |
| Fullt Hus | 30% |
| **Sum** | **70%** (resten 30% til hus/§11) |

### 3.6 Multi-vinner pot-deling

Samme regel som Spill 1 §9 — Rad 1 deles bare ut én gang totalt:
- 1 vinner Rad 1 → får hele Rad 1-poten
- 2 vinnere Rad 1 → hver får halvparten
- N vinnere Rad 1 → hver får `floor(pot / N)`, rest til HOUSE_RETAINED

Siden det kun er én bong-type (5 kr flat), blir det **flat pot-deling** (ingen bong-vekting).

### 3.7 Gevinstmønster-varianter (kommer)

> **Bokstav-mønster** (T/L/X/Plus/Pyramide etc.) er en valgbar gevinstmønster-variant for Spill 3 som implementeres **etter** Spill 3-redesign er live.

Når Bokstav-variant aktiveres:
- Admin velger hvilke bokstav-mønstre som er aktive (per katalog-rad eller per spilleplan-item)
- Engine kjører bokstav-mønster i stedet for / i tillegg til Rad 1-4 (TBD per agent-design)
- Premie-mekanikken forblir den samme (fixed eller percentage)

**Spec for Bokstav-variant er IKKE definert ennå** — kommer som egen oppfølger-spec etter Spill 3-redesign er live.

### 3.8 §11-distribusjon

Minst 15% til organisasjoner (`gameType = MAIN_GAME`).

### 3.9 Implementasjons-status

**✅ Levert (PR #1006 — fundament):**
- Database-skjema: migration `20261211000000` med `app_spill3_config` (singleton, partial unique index på `active=TRUE`)
- Service-lag:
  - `apps/backend/src/game/Spill3ConfigService.ts` — CRUD + cache + audit
  - `apps/backend/src/game/Spill3GlobalRoomService.ts` — bridge til `GameVariantConfig`
- Admin-API:
  - `GET /api/admin/spill3/config` — hent aktiv config
  - `PUT /api/admin/spill3/config` — oppdater (partial patch, ADMIN-only)
- `roomState.bindVariantConfigForRoom`-hook (mapper config til `GameVariantConfig.patterns`)
- Default seed med 5/8/12/15/30%-fordeling
- Fail-soft fallback til legacy `DEFAULT_GAME3_CONFIG` hvis service ikke svarer

**🚨 Gjenstår (engine-utvidelse, ny PR pågår):**

Spec'en krever "Rad 1 → 3s pause → Rad 2 → 3s pause → ...". Dagens `Game3Engine` evaluerer alle aktive patterns konkurrent. For å støtte sekvensiell rad-evaluering med pause må PatternCycler utvides med en `phaseDelayMs`-mekanikk:

```typescript
// I Game3Engine.onDrawCompleted:
// 1. Evaluer kun den AKTIVE fasen (currentPhaseIndex)
// 2. Når fasen er vunnet → schedule advance til neste fase via setTimeout(phaseDelayMs)
// 3. I mellomtiden: ingen nye trekk evalueres, ingen pattern-matching skjer
// 4. Etter delay: bumpe currentPhaseIndex og fortsette
```

Krever:
- Ny `Game3PhaseState` med `currentPhaseIndex: 0|1|2|3|4` og `pausedUntilMs?: number`
- DrawScheduler må vente på `pausedUntilMs` før nye trekk
- Mocking-egnet `phaseDelayMs`-injection for tester

Forventet effort: 3-5 dev-dager.

**🚨 Gjenstår (admin-UI form, ny PR pågår):**

`apps/admin-web/src/pages/games/spill3Config/Spill3ConfigPage.ts`:
- Form med radio for prize-mode (fixed/percentage)
- Conditional input-fields per mode (cents vs pct)
- Live-preview av "ved X solgte bonger blir Rad 1 = Y kr" via `calculatePhasePrizeCents`
- PUT mot `/api/admin/spill3/config`
- Sidebar-link under "Spilladministrasjon"

Forventet effort: 1-2 dev-dager.

**Pilot-relevans:** Foundation er pilot-trygg (legacy fallback bevart). Komplett Spill 3-spec krever engine-utvidelse + admin-UI før pilot kan kjøre Spill 3-runder med ny mekanikk.

---

## 4. SpinnGo / Spill 4 — Databingo (slug `spillorama`)

**Engine:** SpinnGo-engine (placeholder — kode ligger i `packages/game-client/src/games/game5/`)

**Spillebrett:**
- 60 baller (1-60)
- 3×5 grid
- Ruletthjul

**Trekkemodus:** ✅ Player-startet — forhåndstrukket per sekvens
**Antall rom:** Ikke applicabel (single-player databingo)

**Bongpriser:** ⚠️ Konfigurerbart per databingo-spill (ikke nødvendigvis 5/10/15)

**Spesial-mekanikk:**

- **Ruletthjul** — multipliserer premier per sekvens
- **Free Spin Jackpot** — bonus-mekanikk
- **SwapTicket** — bytte ut bonger underveis
- **Sekvens-mellomrom:** Min 30 sekunder mellom databingo-runder per spiller
- **Maks tickets:** 5 aktive tickets per spiller (TECHNICAL_BACKLOG §BG-012)
- **Single-prize cap:** ✅ 2500 kr per single-prize (regulatorisk databingo-cap)

**Status pilot:** Spill 4 (SpinnGo) er ikke nødvendigvis pilot-første-bølge. Pilot fokuserer på Spill 1-3.

**§11-distribusjon:** Minst 30% (databingo-regelen)

> **Åpent spørsmål til Tobias:** Hva er forventet pilot-status for SpinnGo? Er den med fra dag 1 eller utsettes?

---

## 5. Bonus-mini-spill

**Trigger:** Aktiveres ved Fullt Hus i hovedspillet (ikke standalone).

**Konfigurering:**
- Per katalog-rad: `bonus_game_slug` = default for spillet
- Per spilleplan-item: `bonus_game_override` = overstyrer default
- `catalog.bonus_game_enabled = false` → ingen bonus uansett (master-switch)
- Forrang: `plan_item.bonus_game_override` > `catalog.bonus_game_slug` > ingen

**4 mini-spill:**

### 5.1 Lykkehjulet (slug `wheel_of_fortune`)

**Mekanikk:** Spinning wheel med 10 segmenter (per legacy-wireframe). Hver segment = en multiplier (typisk 1×-5×).

**Trigger:** Fullt Hus-vinner får én spinn.

**Premie:** Multiplier × hovedspillets bingo-premie (eller fast bonus-pott — ⚠️ verifiseres).

⚠️ Konkret konfigurasjon (segmenter, multipliers, sannsynligheter) må verifiseres i `apps/backend/src/game/minigames/`.

---

### 5.2 Fargekladden (slug `color_draft`)

**Mekanikk:** ⚠️ Nøyaktig mekanikk verifiseres. Trolig farge-basert mini-game der spilleren velger farge for ekstra premie.

**Trigger:** Fullt Hus-vinner.

⚠️ Konkret mekanikk verifiseres mot kode + Tobias.

---

### 5.3 Skattekisten (slug `treasure_chest`)

**Mekanikk:** Treasure-Chest-stil mini-game der vinneren åpner én av flere kister med skjulte premier.

**Trigger:** Fullt Hus-vinner.

⚠️ Konkret konfigurasjon (antall kister, premie-distribusjon) verifiseres.

---

### 5.4 Mystery Joker (slug `mystery`)

**Mekanikk:** 10-bucket spin wheel med 10s timer (per legacy-wireframe). Auto-play hvis ingen input. Color-multiplier (yellow 2× white).

**Implementasjon:** PR #430 + frontend-overlay verifisert i preview.

**Trigger:** Fullt Hus-vinner. Også klient-kø-trigger etter Fullt Hus-dismiss (PR #552).

**Premie:** ⚠️ Verifiseres.

---

## 6. Egne payout-paths utenfor hovedspillets fase-payout

Disse er IKKE en del av Rad 1-4 + Fullt Hus-payout. De legges på toppen som ekstra premier:

### 6.1 Innsatsen-pot

- Akkumuleres over runder
- Utbetales ved Fullt Hus innen terskel
- Tilknyttet `innsatsen`-spillet (men kan teoretisk wired til andre spill)
- Service: `apps/backend/src/game/pot/PotEvaluator.ts`

### 6.2 Lucky Number Bonus

- Ekstra-premie hvis Fullt Hus oppnås på "lucky-ball"
- Implementert som separat path (PR #2 i pilot K1-bølge)
- Tilknyttet Spill 1-spill med Lucky-Number-feature aktivert

### 6.3 Jackpott daglig akkumulering

- +4000 kr/dag, max 30 000
- Tilknyttet `jackpot`-katalog-raden? eller egen mekanikk? ⚠️ verifiseres
- Service: `apps/backend/src/game/Game1JackpotStateService.ts`

### 6.4 Mini-games-payouts

- Mystery Joker, Lykkehjul, Fargekladd, Skattekiste — egne premier separate fra hovedspillet
- Trigger: Fullt Hus i hovedspillet
- Service: `apps/backend/src/game/minigames/`

---

## 7. Eksterne spill

### 7.1 Candy (slug `candy`)

**Mekanikk:** Tredjepart spill (slot/casino-stil). Spillorama eier IKKE spilllogikken.

**Integrasjon:**
- Iframe-embedding i Spillorama-shell
- Felles lommebok via `/api/ext-wallet/*`-endepunkter
- Launch via `POST /api/games/candy/launch`
- Returnerer URL Candy-iframe lastes fra
- Wallet-bridge: Candy-backend kaller balance/debit/credit med API-key

**Regulatorisk ansvar:**
- Spillorama: lommebok, autentisering, responsible gaming, Spillvett
- Candy-leverandør: spillet, RNG, gevinst-sannsynligheter, RTP

**Premier:** Ikke applicabel — Candy bestemmer payout selv via tredjepart-engine.

**Konfigurering:**
- `CANDY_BACKEND_URL` (env)
- `CANDY_INTEGRATION_API_KEY` (env)

---

## 8. Sammendrag — beslutningstre for nye agenter

```
Trenger jeg å håndtere payout for Spill 1?
├── Standard auto-multiplikator-spill?
│   └── Bruk per-bongfarge ×1/×2/×3 fra base. Ingen cap.
├── Oddsen?
│   └── Sjekk drawSequenceAtWin mot targetDraw. HIGH/LOW × bongstørrelse.
├── Trafikklys?
│   └── Bruk rad-farge (ikke bongfarge). Alle bonger 15 kr flat.
├── Jackpot?
│   └── Master setter via popup. Override lagres i jackpot_overrides_json.
└── Innsatsen-pot?
    └── Egen path — IKKE bland med fase-payout.

Spill 2 (rocket)?
└── Egen engine (Game2Engine). 21-ball, 3×3, ETT globalt rom.

Spill 3 (monsterbingo)?
└── Egen engine (Game3Engine). 75-ball, 5×5 uten free, mønsterbingo.

SpinnGo (spillorama)?
└── Databingo. Player-startet. Single-prize cap 2500 kr.
└── §11 = 30% til org (ikke 15%).

Candy?
└── Eksternt. Wallet-bridge only. Ikke vårt regulatoriske ansvar.
```

---

## 9. Hva som trenger verifisering fra prod-katalog

**Tobias har bekreftet at de 13 katalog-radene er live i prod-DB.** Følgende konkrete verdier må enten hentes via `GET /api/admin/game-catalog` eller eksporteres av Tobias:

- Rad 1-4 base-verdier for ALLE spill (ikke dokumentert i denne fila)
- Bonus-spill default per spill (verdi i `bonus_game_slug`-kolonnen)
- `bonus_game_enabled`-flagg per spill
- "varierer"-spill: konkrete tall for Ball × 10, Bokstav, Innsatsen-skala (500-2000)
- Spill 2 og Spill 3 premie-skala
- Mini-game-konfigurasjoner (segmenter, multipliers, sannsynligheter)

**Foreslått tilnærming:** Tobias eksporterer alle 13 katalog-rader som JSON, og en agent oppdaterer dette dokumentet med eksakte tall.

---

## 10. Endringslogg

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-08 | Initial versjon. Komplett mekanikk-spec for alle 13 katalog-spill + Spill 2/3/4 + bonus-mini-spill + eksterne. Konkrete premie-tall markert ⚠️ for verifisering mot prod-katalog. | PM-AI (Claude Opus 4.7) |

---

## 11. Referanser

- [docs/architecture/SPILL_REGLER_OG_PAYOUT.md](./SPILL_REGLER_OG_PAYOUT.md) — kanonisk regler-doc (felles for alle spill)
- [docs/architecture/SPILLKATALOG.md](./SPILLKATALOG.md) — slug ↔ navn-mapping
- [docs/operations/PM_HANDOFF_2026-05-07.md](../operations/PM_HANDOFF_2026-05-07.md) — sesjon der spilleplan-redesignen ble landet
- [docs/architecture/LEGACY_1_TO_1_MAPPING_2026-04-23.md](./LEGACY_1_TO_1_MAPPING_2026-04-23.md) — legacy-spec mapping
- [docs/architecture/WIREFRAME_CATALOG.md](./WIREFRAME_CATALOG.md) — UI-spec
- [apps/backend/src/game/](../../apps/backend/src/game/) — engine-implementasjon
- [apps/admin-web/src/pages/games/catalog/](../../apps/admin-web/src/pages/games/catalog/) — admin-UI for katalog-redigering
