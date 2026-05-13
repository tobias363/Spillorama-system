---
name: spinngo-databingo
description: When the user/agent works with SpinnGo (Spill 4 / game5 / spillorama-slug), databingo classification, the 30%-til-organisasjoner-regel, the 2500 kr single-prize-cap, or 60-ball 3×5-grid + ruletthjul. Also use when they mention game5, spillorama-slug, SpinnGo, Spill 4, databingo, databingo system, ruletthjul, single-prize-cap, 60-ball, 3x5-grid, ledgerGameTypeForSlug, makeHouseAccountId, themebingo deprecated, BIN-496, ComplianceLedgerOverskudd, §11 distribusjon, forhåndstrukket, player-startet. Make sure to use this skill whenever someone touches SpinnGo, databingo-paths, eller forveksler regulatorisk klassifisering mellom hovedspill og databingo — even if they don't explicitly ask for it.
metadata:
  version: 1.0.0
  project: spillorama
---

<!-- scope: apps/backend/src/game/ledgerGameTypeForSlug.ts, apps/backend/src/game/ledgerGameTypeForSlug.test.ts, apps/backend/src/game/ledgerGameTypeForSlug.distribution.test.ts, apps/backend/src/game/ComplianceLedgerOverskudd.ts, packages/game-client/src/games/game5/** -->

# SpinnGo / Spill 4 / game5 — Databingo

SpinnGo (markedsført som "Spill 4", kode-navn `game5`, slug `spillorama`) er **det eneste databingo-spillet** i Spillorama-systemet. Alle andre interne spill (Spill 1, 2, 3) er hovedspill (`MAIN_GAME`). Denne distinksjonen er regulatorisk kritisk — `MAIN_GAME` har 15% min til organisasjoner og ingen single-prize-cap; `DATABINGO` har 30% min til organisasjoner og 2500 kr cap per single-prize.

## Kontekst — hvorfor er dette kritisk?

**Lese-først-doc:**
- `docs/architecture/SPILLKATALOG.md` — kanonisk klassifisering. Korrigert 2026-04-25 av Tobias.
- `docs/architecture/SPILL_REGLER_OG_PAYOUT.md` §4 — single-prize-cap håndhevelse
- `apps/backend/src/game/ledgerGameTypeForSlug.ts` — slug→gameType mapping

**Direktiv (Tobias 2026-04-25):**
> Spill 1-3 = live hovedspill (15%), SpinnGo (Spill 4/game5) = databingo (30%), Candy = ekstern iframe. Korrigerer feil 2026-04-23-spikring.

Den 2026-04-23-spikringen som hevdet "alle interne spill var hovedspill" var feil og er korrigert.

## Mapping-tabell — markedsføring vs kodenavn vs slug

```
Spill 1   = game1  = bingo         = Hovedspill (MAIN_GAME), 75-ball 5×5
Spill 2   = game2  = rocket        = Hovedspill (MAIN_GAME), 21-ball 3×3
Spill 3   = game3  = monsterbingo  = Hovedspill (MAIN_GAME), 75-ball 5×5 uten free
SpinnGo   = game5  = spillorama    = Databingo (DATABINGO), 60-ball 3×5 + rulett (player-startet)
Candy     = —      = candy         = Ekstern iframe (tredjeparts) — Spillorama eier kun launch + wallet-bridge
(Game 4   = game4  = themebingo    = DEPRECATED BIN-496, IKKE BRUK)
```

**Spill 4 ≠ Game 4.** Det er en historisk arv:
- Markedsføringsnavn: "Spill 4"
- Kodenavn: `game5`
- Slug: `spillorama` (historisk arv — forvirrer fordi det er navnet på systemet også)

Game 4 / `game4` / `themebingo` ble permanent avviklet per BIN-496 (2026-04-17). Nye PR-er skal IKKE referere `game4` eller `themebingo`.

## Forhåndstrukket player-startet (forskjell fra Spill 1-3)

Spill 1-3 er **live** hovedspill — server trekker baller i sanntid mens spillere ser på. Master eller perpetual-loop styrer trekninger.

**SpinnGo er forhåndstrukket og player-startet:**
- Spilleren klikker "Start spill" når de er klare
- Server genererer hele draw-sekvensen før visning (forhåndstrukket)
- Klient animerer trekninger lokalt med ruletthjul-effekt
- Sekvenser med 30s minimums-mellomrom (per pengespillforskriften databingo-regler)

Dette er fundamentalt forskjellig fra live bingo og krever andre regulatoriske kontroller.

## Spill-mekanikk

| Aspekt | SpinnGo |
|---|---|
| Slug | `spillorama` (historisk arv) |
| Kodenavn | `game5` |
| Grid | 3×5 (15 ruter) |
| Ball-range | 1-60 |
| Maks ball-trekk | 60 |
| Spille-modell | Player-startet, forhåndstrukket |
| Spesiell mekanikk | Ruletthjul, Free Spin Jackpot, SwapTicket |
| Min mellomrom | 30s mellom sekvenser (databingo-regel) |
| Maks tickets | 5 aktive databingo-tickets per spiller |
| Salgskanaler | Kun online (ikke fysiske bonger) |
| Vinning | Per pattern-design (varierer per katalog-variant) |

## Regulatorisk klassifisering — KRITISK

### MAIN_GAME vs DATABINGO

Pengespillforskriften definerer to relevante kategorier for Spillorama:

| Kategori | Min organisasjon | Maks enkeltpremie | Trekkingsmodus |
|---|---|---|---|
| **Hovedspill (MAIN_GAME)** | 15% | INGEN cap | Live, server-trukket |
| **Databingo (DATABINGO)** | 30% | 2 500 kr | Player-startet, forhåndstrukket |

### Slug → gameType mapping

`apps/backend/src/game/ledgerGameTypeForSlug.ts`:
```typescript
// MAIN_GAME for Spill 1-3 (hovedspill, 15%)
"bingo"         → MAIN_GAME
"rocket"        → MAIN_GAME
"monsterbingo"  → MAIN_GAME

// DATABINGO for SpinnGo (30%, 2500 kr cap)
"spillorama"    → DATABINGO  (default fallback også)
"game_5"        → DATABINGO
```

### §11-distribusjon (kode)

`apps/backend/src/game/ComplianceLedgerOverskudd.ts:75`:
```typescript
const orgPercent = row.gameType === "DATABINGO" ? 0.3 : 0.15;
```

**Strukturelt korrekt mapping**, men hardkoding i call-sites er en pågående bug — pre-fix returnerte `DATABINGO` for ALLE call-sites (Spill 1-3 inkludert), som er regulatorisk feil. Fixed via Wave 2 PR-er for Spill 1-3.

### Single-prize-cap (kun databingo)

`apps/backend/src/adapters/PrizePolicyPort.ts.applySinglePrizeCap`:
- `gameType === "DATABINGO"` → cap 2500 kr per single-prize
- `gameType === "MAIN_GAME"` → ingen cap

**Eksempel:** Lilla-bong får 3000 kr på Innsatsen Fullt Hus, 4500 kr på Oddsen-HIGH. Det er forventet og regulatorisk OK fordi Spill 1 er MAIN_GAME. SpinnGo har derimot 2500 kr-cap på alle premier.

## Wallet-konto-ID-format

`makeHouseAccountId` genererer house-account-id basert på (hallId, gameType, channel):
- Spill 1-3 hovedspill: `house-{hallId}-main_game-INTERNET` eller `house-{hallId}-main_game-HALL`
- SpinnGo databingo: `house-{hallId}-databingo-{channel}`

NB: GameType lekker inn i konto-IDer. Kjent gap, dokumentert i SPILLKATALOG.md §6.

## Tre regulatoriske ledger-dimensjoner

ComplianceLedger må skille mellom tre dimensjoner per pengespillforskriften §11:

1. **Hall main game** — Spill 1, 2, 3 spilt fysisk i hall (kontant + agent-cashout)
2. **Internet main game** — Spill 1, 2, 3 spilt over internett (digital wallet)
3. **Databingo** — SpinnGo (kun internett, player-startet)

Backend-implementasjon:
- `app_rg_compliance_ledger.game_type` ∈ {`MAIN_GAME`, `DATABINGO`}
- `channel` ∈ {`HALL`, `INTERNET`} (kun MAIN_GAME bruker HALL)
- §11-prosent leses fra `gameType` ved overskudd-fordeling

## TECHNICAL_BACKLOG-regler som gjelder KUN SpinnGo

| Regel | Gjelder for |
|---|---|
| BG-011: Min 30s mellom databingo-sekvenser | KUN SpinnGo (ikke Spill 1-3) |
| BG-012: Maks 5 databingo-tickets per spiller | KUN SpinnGo |
| BG-013: Én aktiv databingo-runde per spiller | KUN SpinnGo |

Backlog dokumenterer reglene som "databingo-regler" — verifiser at de håndheves KUN i SpinnGo-paths.

## Game 4 / themebingo deprecated (BIN-496)

**Game 4** (kodenavn `game4`, slug `themebingo`) ble permanent avviklet 2026-04-17 per BIN-496:
- Slug `game4`/`themebingo` skal ikke brukes
- Kode-stier som referer dem er legacy — verifiser om de kan slettes
- Ny kode skal IKKE introdusere referanser til Game 4

**Kommentar fra historisk forvirring:**
- Markedsføring nummer 4 (Spill 4) ≠ Game 4 / game4 / themebingo
- "Spill 4" markedsføring = SpinnGo = game5 = databingo
- Game 4 finnes ikke som aktivt spill

## Vanlige feil og hvordan unngå dem

### 1. Antar at SpinnGo er hovedspill
Symptom: Single-prize-cap (2500 kr) ikke håndhevet, eller §11-prosent settes til 15%.
**Fix:** Verifiser via `ledgerGameTypeForSlug("spillorama")` returnerer `DATABINGO`.

### 2. Antar at Spill 1-3 er databingo
Symptom: Hardkodet `gameType: "DATABINGO"` i Spill 1-3-call-sites (BIN-769 / Wave 2 fix).
**Fix:** Bruk alltid `ledgerGameTypeForSlug(room.gameSlug)` — aldri hardkodet streng.

### 3. Refererer Game 4 / themebingo
Symptom: Ny kode importerer `themebingo`-konstanter eller `game4`-paths.
**Fix:** Game 4 er deprecated (BIN-496). Slug `themebingo` skal ikke brukes.

### 4. Forvirrer Spill 4 og Game 4
Symptom: Antar at "Spill 4" markedsføring betyr `game4`-kodebasis.
**Fix:** "Spill 4" markedsføring = SpinnGo = `game5` = `spillorama`-slug. Game 4 er en deprecated annet spill.

### 5. Bryter forhåndstrukket-regelen
Symptom: SpinnGo trekker live i sanntid (kopiert fra Spill 1-3-flyt).
**Fix:** SpinnGo MÅ være forhåndstrukket. Server genererer hele draw-sekvensen før visning.

### 6. Skipper 30s minimums-mellomrom
Symptom: Spiller kan starte ny SpinnGo-runde umiddelbart etter forrige.
**Fix:** Håndhev 30s mellom sekvenser (BG-011).

### 7. Glemmer 5-tickets-grense
Symptom: Spiller kan ha mer enn 5 aktive databingo-tickets samtidig.
**Fix:** BG-012 — maks 5 aktive tickets per spiller.

### 8. Bytter `spillorama`-slug til `spinngo`
Symptom: Tror at slug skal følge markedsføringsnavn.
**Fix:** Slug er stabil (historisk arv). Ikke endre — det krever DB-migrasjon av alle eksisterende rader.

### 9. Glemmer 2500 kr-cap håndhevelse
Symptom: SpinnGo-vinner får > 2500 kr per single-prize.
**Fix:** `applySinglePrizeCap` MÅ kjøres for `DATABINGO`-paths. Verifiser i tester.

## Når denne skill-en er aktiv

**Gjør:**
- Les `SPILLKATALOG.md` FØRST for klassifisering
- Verifiser slug→gameType-mapping via `ledgerGameTypeForSlug`
- Bruk markedsføring-navn ("SpinnGo") i UI, slug ("spillorama") i kode
- Håndhev 2500 kr-cap KUN for `DATABINGO`-paths
- Sjekk §11-prosent (30% for databingo) ved overskudd-fordeling
- Verifiser at endringer på SpinnGo IKKE påvirker Spill 1-3 (forskjellige services)

**Ikke gjør:**
- IKKE introduser hardkodet `gameType: "DATABINGO"` i Spill 1-3-paths
- IKKE bruk `themebingo`/`game4`-slug (deprecated BIN-496)
- IKKE forveksle Spill 4 (SpinnGo) med Game 4 (deprecated)
- IKKE endre `spillorama`-slug — det er stabil DB-koding
- IKKE introduser live-trekkning for SpinnGo (det er forhåndstrukket)
- IKKE skip 30s mellomrom-regel eller 5-tickets-grense for SpinnGo
- IKKE fjern 2500 kr-cap for SpinnGo
- IKKE legg til 2500 kr-cap for Spill 1-3 (de er hovedspill — ingen cap)

## Kanonisk referanse

`docs/architecture/SPILLKATALOG.md` er autoritativ. Hvis kode motsier doc-en, fix koden. Dokumentet er korrigert 2026-04-25 etter at 2026-04-23-spikringen feilaktig hevdet alle interne spill var hovedspill.

Hvis du finner andre dokumenter (SPILL1_GAMETYPE_INVESTIGATION, KRITISK1_RNG_*) som motsier dette: oppdater dem til ny klassifisering.
