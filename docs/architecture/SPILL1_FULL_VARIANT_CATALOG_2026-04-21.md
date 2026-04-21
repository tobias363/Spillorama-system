# Spill 1 — Full variant-katalog (post-pilot)

**Dato:** 2026-04-21
**Forfatter:** PM (Claude Opus 4.7)
**Status:** Post-pilot-plan — IKKE startet
**Linear-prosjekt:** https://linear.app/bingosystem/project/spill-1-full-variant-katalog-post-pilot-0d5f70f1d886

---

## Bakgrunn

Teknobingo-papir-planen "VÅRE SPILL" (side 1 + 2) viser 13 spill-varianter som brukes i live halll-miljø. Etter at Spill 1 backend-paritet for basisspillet er levert gjennom PR #313-#329, mangler implementering av disse 13 variantene.

Denne dokumentasjonen arkiverer den komplette katalogen med scope-estimat, arkitektonisk tilnærming, og PR-sekvens for post-pilot-arbeidet.

---

## Status-oversikt (per 2026-04-21)

Ferdig i main:
- ✅ Spill 1 basisspill: 5-fase-bingo med faste premier 100/200/200/200/1000 kr
- ✅ Per-(farge,fase) premie-konfigurasjon (admin-UI + backend) — PR A + PR B + kanonisering
- ✅ Per-farge jackpot på Fullt Hus (white/yellow/purple/etc.) — PR #316 + PR B
- ✅ Trafikklys (farge-basert premie) — `DEFAULT_TRAFFIC_LIGHT_CONFIG` + PR B per-farge
- ✅ Auto-draw (fixed interval) — Game1AutoDrawTickService
- ✅ Split-rounding + loyalty — PR #312
- ✅ Crash-recovery — PR #312

Ikke i main (post-pilot-scope):
- Alt annet fra papir-planen (13 varianter under)

---

## Kategorisering: 4 arkitektoniske spor

Variantene grupperes i spor basert på hvilken del av systemet som må endres.

### Spor 1: Gevinst-regler (utvidelser av eksisterende 5-fase)

Ingen ny spill-type — samme bingo-flyt, men annen premie-beregning.

| # | Spill | Regel | Status |
|---|---|---|---|
| 1 | Spillernes spill | Rad N = Rad 1 × N (multiplikator-kjede), minst-grense per rad | ❌ Ikke støttet — nåværende PatternConfig støtter bare fixed/percent |
| 2 | Super-NILS | Full bong: B=500/I=700/N=1000/G=700/O=500 — kolonne som ga bingo avgjør | ❌ Ikke implementert |
| 3 | Ball x 10 | Full bong = 1250 + (bingo-tall × 10) | ❌ Ikke implementert |
| 4 | Trafikklys | Rød=500/Gul=1000/Grønn=1500 — farge på vinnerbongen | ✅ `DEFAULT_TRAFFIC_LIGHT_CONFIG` + Agent 7 PR B per-farge |
| 5 | Extra | Bilde=500, Ramme=1000, Full bong=3000 — 3 pattern-trinn | ❌ Ikke implementert som patterns |

### Spor 2: Spesial-bonger (ticket-variant med egen identitet)

| # | Spill | Regel | Status |
|---|---|---|---|
| 6 | Elvis 1-5 | Bildet på bongen avgjør premien (500-2500 kr) | ✅ Backend data-modell, ✅ admin-UI, ❌ klient-visual-rendering |
| 7 | Kvikkis | Førstemann med full bong vinner 1000 kr — hurtig-bingo | ❌ Ikke implementert (kun Fullt Hus-fase) |

### Spor 3: Minispill (trigges etter bingo, separat UI-interaksjon)

| # | Spill | Regel | Status |
|---|---|---|---|
| 8 | Lykkehjulet | 1 snurr → premie fra tabell (4000/3000/2000/1000/500 × forskjellige antall) | 🟡 `activateMiniGame`/`playMiniGame` finnes i BingoEngine |
| 9 | Skattekisten | Velg luke → vinn 400-4000 kr | 🟡 Samme mekanisme som Lykkehjulet |
| 10 | Fargekladden | 12 luker med farger, match-regler | ❌ Ikke implementert |
| 11 | Oddsen | Forrige vinner trekker et av tall 55/56/57 → betinget pot | ❌ Ikke implementert |

### Spor 4: Pot-mekanikker (akkumulering + draw-thresholds)

| # | Spill | Regel | Status |
|---|---|---|---|
| 12 | Jackpott | Starter 2000 kr, +4000/dag, max 30.000. Draw-thresholds: 50→55→56→57 | 🟡 `Game1JackpotService` dekker fixed-amount-per-farge, men daglig-akkumulering mangler |
| 13 | Innsatsen | 20% av salg → pot. Pot øker til 2000 innen 56 trekk, så til 58 | ❌ Ikke implementert |

---

## PR-sekvens (15 PR-er, ~34 dagers arbeid)

Totalscope-estimat basert på ~1-dags-enheter. Parallellisert 3-4 kalenderuker.

### Fase 1: Elvis-komplettering (rask gevinst)

**PR-P1** — Game-client Elvis-bilde-rendering (~1-2 dager)

Leveranse:
- 5 Elvis-bilder i `packages/game-client/src/assets/elvis/`
- `BingoTicketHtml.ts` rendrer bilde når `ticket.color.startsWith("elvis")`
- Verifiser admin-UI viser 5 separate Elvis-konfigurasjoner
- Vitest-snapshot per variant

### Fase 2: Gevinst-regel-utvidelser (Spor 1)

**PR-P2** — Multiplikator-kjede (Spillernes spill, ~3 dager)
- Utvid `PatternConfig` med `multiplierOfPreviousPhase?: number` + `minPrizeCents?: number`
- `BingoEngine.evaluateActivePhase` beregner cascade

**PR-P3** — Kolonne-spesifikk full bong (Super-NILS, ~2 dager)
- Nytt felt `columnPrizes: Record<"B"|"I"|"N"|"G"|"O", cents>` på `PatternConfig`
- Engine identifiserer hvilken kolonne som fullførte Fullt Hus, bruker riktig premie

**PR-P4** — Ball-verdi-multiplikator (Ball x 10, ~2 dager)
- Felt `ballValueMultiplier?: number` + `baseFullHousePrize?: cents`
- Engine ser på siste kule før vinn, multipliserer med felt

**PR-P5** — Ekstra pattern-trinn (Extra/Bilde/Ramme/Full bong, ~3 dager)
- Utvid pattern-array-semantikken til å støtte flere concurrent pattern-typer
- Admin-UI definerer egne bitmask-patterns

### Fase 3: Minispill-framework (Spor 3)

**PR-M1** — Minispill-grunn-arkitektur (~4 dager)
- `MiniGame`-interface, trigger-kontrakt, UI-handshake protokoll
- Persistens i DB (`app_game1_mini_game_results`)
- Socket-events: `mini_game:trigger`, `mini_game:choice`, `mini_game:result`
- Admin-UI: konfig hvilke minispill aktiv per GameManagement

**PR-M2** — Lykkehjulet (~2 dager)
- Wheel-type med konfigurerte prize-buckets (4000×2stk, 3000×4stk, 2000×8stk, 1000×32stk, 500×4stk)
- 1 snurr per tilstand, server-autoritativ trekking

**PR-M3** — Skattekisten (~2 dager)
- Chest-type: spiller velger 1 av N luker
- Luker har tilfeldige verdier (400-4000 kr)

**PR-M4** — Fargekladden (~3 dager)
- 12 luker med forskjellige farger
- Regler: match 2 → beløp i 1. luka; alle ulik → vinn alle 3; ellers → sum av 2 første
- Mer kompleks UX enn wheel/chest

**PR-M5** — Oddsen (~3 dager)
- Forrige spills Fullt Hus-vinner trekker et av tallene 55, 56 eller 57
- Pot 1500 kr for bong=10, pot 3000 kr for bong=20
- Cross-round state — må persisteres mellom bingo-runder

### Fase 4: Pot-mekanikker (Spor 4)

**PR-T1** — Pot-service-framework (~3 dager)
- `Game1PotService` (ny, separat fra Game1JackpotService)
- Akkumulering over tid (daglig eller per-spill basert på config)
- Persistens i ny tabell `app_game1_accumulating_pots`
- Draw-threshold-regler
- Admin-UI-konfig per GameManagement

**PR-T2** — Jackpott-integrasjon (~2 dager)
- Starter 2000 kr, +4000/dag, max 30.000
- Trekk-thresholds: 50→55→56→57 (står til vunnet)

**PR-T3** — Innsatsen-integrasjon (~2 dager)
- 20% av salg → pot, base 500
- Trekk-thresholds: 2000 innen 56, øker til 58

### Fase 5: Kvikkis (Spor 2 forts.)

**PR-K1** — Kvikkis som `gameType: "quickbingo"` med kun Fullt Hus-fase (~1 dag)

---

## Admin-UI-utvidelser per GameManagement-rad

Nye konfig-seksjoner som må legges til `Spill1Config.ts` + form:

**PrizeRules:**
- Velg multiplikator-kjede / kolonne-premier / ball-multiplikator / extra-patterns (avkryssingsbokser + verdi-felt per valgt)

**MiniGames:**
- Velg hvilke minispill trigges (Lykkehjulet/Skattekisten/Fargekladden/Oddsen) + regel-konfig per valgt

**PotConfig:**
- Jackpott-aktivert? Startbeløp, daglig øking, max, draw-thresholds
- Innsatsen-aktivert? Salg-prosent, base, thresholds

**GameType:**
- Velg "norsk-bingo" (standard 5-fase) vs "kvikkis" (kun Fullt Hus)

---

## Avhengigheter og rekkefølge

### Kritiske avhengigheter

1. **Pilot må være i drift** før oppstart — stabiliteten av basisspillet er forutsetning
2. **Scheduler-fiks** (utsatt fra Agent 7's PR B) må lande før Spor 4 kan konsumere pot-config fra admin-UI
3. **Agent 5's BingoEngine-dekomposisjon** (PAUSED PR-2/3/4) bør vurderes i sammenheng — hvis den startes først, vil Spor 1-PR-er måtte rebase mot den nye strukturen
4. **Agent 3's Game1-tjeneste-konsolidering** (PAUSED) — kan kjøre parallelt men krever koordinering med minispill-framework (Spor 3 rører samme tjenester)

### Anbefalt rekkefølge

```
Uke 1 (post-pilot-lansering):
  - PR-P1 Elvis-rendering (quick win, parallelt med annet)
  - Start Spor 1 (PR-P2 multiplikator-kjede)

Uke 2:
  - Fullfør Spor 1 (PR-P3, P4, P5)
  - Start Spor 4 forskning (scheduler-fiks + PR-T1 pot-framework)

Uke 3:
  - PR-T2, T3 pot-integrasjon
  - Start Spor 3 (PR-M1 framework)

Uke 4:
  - Fullfør Spor 3 (PR-M2, M3, M4, M5)
  - PR-K1 Kvikkis
```

Parallellisering gir 3-4 kalenderuker. Seriell: 5-7 uker.

---

## Referanse til papir-plan

Papir-plan fra hall-miljø ("VÅRE SPILL", Teknobingo) — to sider:

Side 1:
- Jackpott (Spor 4 PR-T2)
- Fargekladden (Spor 3 PR-M4)
- Lykkehjulet (Spor 3 PR-M2)
- Oddsen (Spor 3 PR-M5)
- Kvikkis (Spor 2 PR-K1)
- Extra (Spor 1 PR-P5)

Side 2:
- Elvis 1-5 (Spor 2 PR-P1 klient-rendering — backend ferdig)
- Spillernes spill (Spor 1 PR-P2)
- Trafikklys (allerede i main)
- Skattekisten (Spor 3 PR-M3)
- Innsatsen (Spor 4 PR-T3)
- Ball x 10 (Spor 1 PR-P4)
- Super-NILS (Spor 1 PR-P3)

---

## Generelle regler (fra papir-plan side 2)

Dokumenteres som krav for alle varianter:

- Alle tall må markeres med X, O eller markørtrykk — ikke prikker eller skrå-streker
- Man kan kun vinne den gevinst det spilles om
- Siste oppleste tall må være med for godkjent bingo
- Brukte bonger skal kastes etter hvert spill

Disse er delvis implementert i eksisterende markings-kontrakt (Game1DrawEngineService). Post-pilot-arbeidet respekterer disse uten eksplisitt ny kode.

---

## Oppfølgings-issues i Linear

Prosjekt: `Spill 1 — Full variant-katalog (post-pilot)`
ID: `429bbc0d-dabc-433d-b941-744b19220e2b`

Sub-issues kommer post-pilot når arbeidet starter (Linear-gratisverktøy begrenser antall issues — oppgraderes før oppstart).

---

## Endringshistorikk

- 2026-04-21: Første versjon (PM, Claude Opus 4.7)
