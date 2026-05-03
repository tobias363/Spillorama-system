# Spillorama spillkatalog — definitiv oversikt

**Status:** Korrigert 2026-04-25 av Tobias (teknisk lead) etter PM-handoff. Erstatter feil klassifisering fra 2026-04-23-spikringen som hevdet alle interne spill var hovedspill.

**Formål:** Eneste autoritative kilde for hvilke spill som finnes i Spillorama-systemet, hvordan de navngis, og hvilken regulatorisk kategori de tilhører.

Ved uenighet mellom dette dokumentet og andre dokumenter (README-er, wireframe-spec, audit-rapporter, canonical specs, kildekode-kommentarer): **dette dokumentet vinner**, og de andre må oppdateres.

---

## 1. Tre hovedspill + ett databingo + Candy

Spillorama driver **fire interne spill** og integrerer **ett eksternt** spill via iframe.

| Markedsføringsnavn | Regulatorisk kategori | Trekningsmodus | Backend-slug | Legacy kodenavn | Grid | Ball-range | Spesielle mekanikker |
|---|---|---|---|---|---|---|---|
| **Spill 1** (Hovedspill 1) | Hovedspill | Live (hall + internett) | `bingo` | Game 1 / `game1` | 5×5 (fri sentercelle) | 1–75 | Mini-game-rotasjon: Wheel of Fortune, Treasure Chest, Mystery, ColorDraft |
| **Spill 2** (Hovedspill 2) | Hovedspill | Live (hall + internett) | `rocket` | Game 2 / `game2` | 3×3 | 1–21 | Tallspill, Choose Tickets-side (32 brett), Jackpot-bar, Lucky Number, paginering |
| **Spill 3** (Hovedspill 3) | Hovedspill | Live (internett, ETT globalt rom) | `monsterbingo` | Game 3 / `game3` | 3×3 | 1–21 | Hybrid: Spill 2-runtime (3×3 full-bong, perpetual loop) + Spill 1-stil (kulekø, chat, banner). Kun Coverall — ingen mini-games. Endret 2026-05-03 (Tobias-direktiv). |
| **SpinnGo** (Spill 4) | **Databingo** | Player-startet (forhåndstrukket) | `spillorama` | Game 5 / `game5` / "Spillorama Bingo" | 3×5 | 1–60 | Ruletthjul, Free Spin Jackpot, SwapTicket — spiller starter selv, sekvenser med 30s minimums-mellomrom |
| **Candy** | Ekstern (tredjeparts) | Tredjeparts | `candy` | — | — | — | Iframe-integrasjon med delt lommebok; logikk ligger hos Candy-leverandør |

### Game 4 — finnes IKKE

**Viktig:** Det finnes **ingen Spill 4 som matcher gammel Game 4**. Game 4 het "Temabingo" i legacy og ble **permanent avviklet** per BIN-496 (2026-04-17). Ingen ny spill-kode er skrevet for Game 4.

**Derfor:**
- "Spill 4" (markedsføringsnavn) → SpinnGo → Game 5 (kodenavn) → slug `spillorama`
- Gammel Game 4 / `game4` / `themebingo` → **deprecated, ikke bruk**

Denne offset-en (markedsføring nummer 4, kode nummer 5) er historisk arv. Ny kode skal bruke slug-ene, ikke Game-nummer.

---

## 2. Regulatorisk kategori — hovedspill + databingo

Pengespillforskriften definerer tre relevante kategorier:

1. **Hovedspill** — maksimal enkeltpremie 2500 kr, direkte-spill i hall eller over internett, **min 15% til organisasjoner**
2. **Databingo** — elektronisk forhåndstrukket, lavere premier, egne utdelingsregler, **min 30% til organisasjoner**
3. **Internett-hovedspill** — online-variant av hovedspill (underkategori av hovedspill)

### Spillorama-klassifisering

| Spill | Regulatorisk kategori | Min organisasjon-prosent | Trekkingsmodus |
|---|---|---|---|
| Spill 1, 2, 3 | Hovedspill | 15% | Live, server-trukket |
| SpinnGo (Spill 4) | **Databingo** | **30%** | Player-startet, forhåndstrukket per sekvens |
| Candy | Ekstern | N/A (Candy-leverandørs ansvar) | Tredjeparts |

**Spillorama driver både hovedspill OG databingo.** Den 2026-04-23-spikringen som hevdet "Spillorama driver ikke databingo" var feil og er nå korrigert.

---

## 3. Tre ledger-dimensjoner

ComplianceLedger må skille mellom tre regulatoriske dimensjoner (per pengespillforskriften §11):

1. **Hall main game** — Spill 1, 2, 3 spilt fysisk i hall (kontant + agent-cashout)
2. **Internet main game** — Spill 1, 2, 3 spilt over internett (digital wallet)
3. **Databingo** — SpinnGo, player-startet via internett

Distribuksjons-prosent per dimensjon:

| Dimensjon | Min organisasjon | Maksimal enkeltpremie |
|---|---|---|
| Hall main game | 15% | 2 500 kr |
| Internet main game | 15% | 2 500 kr |
| Databingo | 30% | 2 500 kr (samme cap) |

Backend-implementasjon: `app_rg_compliance_ledger.game_type` skal ha verdier:
- `MAIN_GAME` for Spill 1, 2, 3 (kanal skiller hall/internett)
- `DATABINGO` for SpinnGo

---

## 4. Candy — ekstern iframe-integrasjon

Candy er et tredjeparts-spill vi **ikke** har kildekoden til.

### Hva Spillorama leverer

1. **Launch-endpoint** `POST /api/games/:slug/launch` — autentiserer Spillorama-spiller, genererer session-token, returnerer URL spilleren kan åpne Candy på. Implementert i `apps/backend/src/routes/game.ts:94`.
2. **Wallet-bridge** — `/api/ext-wallet/balance`, `/api/ext-wallet/debit`, `/api/ext-wallet/credit`. Candy-backend kaller disse med API-key for å sjekke saldo og belaste/kreditere Spillorama-lommeboken (delt lommebok).
3. **Iframe-embed** — Candy-UI lastes i iframe inne i Spillorama-web-shell. Post-message-protokoll validerer origin.

### Hva Spillorama IKKE gjør

- Vi porterer **ikke** Candy-spillogikken
- Vi re-implementerer **ikke** Candy-UI
- Vi lagrer **ikke** Candy-spillhistorikk (annet enn wallet-transaksjoner)
- Vi tar **ikke** regulatorisk ansvar for Candy-spillets RNG eller gevinst-sannsynligheter — det er Candy-leverandørens ansvar

### Wire-kontrakt

Spillorama → Candy:
- `launchUrl` (med session-token) returneres fra `POST /api/games/candy/launch`
- Spillere når Candy kun via iframe åpnet fra Spillorama-shell

Candy → Spillorama:
- `GET /api/ext-wallet/balance?playerId=X&currency=NOK` — sjekk saldo
- `POST /api/ext-wallet/debit` — trekke fra saldo (spillinnsats)
- `POST /api/ext-wallet/credit` — legge til saldo (gevinst)
- Alle kall autentiseres med `CANDY_INTEGRATION_API_KEY` (env)

Environment-variabler:
- `CANDY_BACKEND_URL` — Candy-leverandørens base-URL
- `CANDY_INTEGRATION_API_KEY` — delt hemmelighet for wallet-bridge

---

## 5. Navnkonvensjoner i koden

### Brukervendt tekst (UI, markedsføring, admin-paneler)

Bruk **Spill 1 / Spill 2 / Spill 3 / SpinnGo / Candy**.

(Spill 4 brukes som synonym for SpinnGo i kontrakter og papir-planer; SpinnGo er det egentlige produktnavnet.)

### Backend-koden (slugs i DB, URL-paths, event-navn)

Bruk **slugs**: `bingo`, `rocket`, `monsterbingo`, `spillorama`, `candy`.

Slug-er er stabile og skal ikke endres — det ville kreve DB-migrasjon av eksisterende data. "Spillorama" som slug for SpinnGo er en historisk arv; vi beholder den selv om markedsføringsnavnet er "SpinnGo".

### Mapping-tabell for rask slå-opp

```
Spill 1   = game1  = bingo         = Hovedspill, 75-ball 5×5
Spill 2   = game2  = rocket        = Hovedspill, 21-ball 3×3
Spill 3   = game3  = monsterbingo  = Hovedspill, 21-ball 3×3 (hybrid: G2-runtime + G1-stil, Tobias 2026-05-03)
SpinnGo   = game5  = spillorama    = Databingo, 60-ball 3×5 + rulett (player-startet)
Candy     = —      = candy         = Ekstern iframe (tredjeparts)
(Game 4   = game4  = themebingo    = DEPRECATED BIN-496, ikke bruk)
```

---

## 6. Åpne regulatoriske avklaringer

Følgende punkter er ikke lukket av dette dokumentet og krever Tobias eller ekstern avklaring:

1. **§11-prosent-implementering**: Dagens kode (`apps/backend/src/game/ComplianceLedgerOverskudd.ts:75`) bruker `gameType === "DATABINGO" ? 0.3 : 0.15`. Det er strukturelt korrekt, men koden hardkoder `gameType: "DATABINGO"` for ALLE Spill 1-3-call-sites (12+ steder). Dette må fikses så Spill 1-3 skriver `MAIN_GAME` mens SpinnGo fortsatt skriver `DATABINGO`. Se [SPILL1_GAMETYPE_INVESTIGATION_2026-04-25](../compliance/SPILL1_GAMETYPE_INVESTIGATION_2026-04-25.md) for fix-strategi.

2. **Wallet-konto-ID-format**: `makeHouseAccountId()` lekker gameType inn i konto-IDer (`house-{hallId}-databingo-{channel}`). Når koden korrigeres må wallet-migrasjon konsolidere hall-balanser per dimensjon (eller velge å beholde split).

3. **RNG-sertifiseringsdokumenter**: `KRITISK1_RNG_*.md` beskriver Spillorama som "databingo system". Spillorama har faktisk EN databingo (SpinnGo), så dokumentene er ikke fundamentalt feil, men de må presisere at Spill 1-3 er hovedspill og kun SpinnGo er databingo. Status per RNG-dokumenter: "LUKKET — ekstern sertifisering ikke regulatorisk påkrevd". Kan internredigeres uten ekstern koordinering.

4. **TECHNICAL_BACKLOG §BG-011/012/013**: Reglene "min 30s mellom databingo", "maks 5 databingo-tickets", "én aktiv databingo per spiller" gjelder **kun SpinnGo**, ikke Spill 1-3. Backlog må presisere dette eller flagge reglene som SpinnGo-spesifikke.

---

## 7. Dokumenter som må oppdateres for å reflektere denne korrigerte arkitekturen

Sist-validert 2026-04-25. Denne listen skal brukes som sjekkliste i oppfølgings-PR.

| Dokument | Hva som må rettes |
|---|---|
| `CLAUDE.md` (repo-root) | "Project-specific Conventions" §Game catalog tabellen — Spill 4 (game5/spillorama) er Databingo, ikke Hovedspill |
| `docs/engineering/PARITY_MATRIX.md` | "Game 5 — Spillorama Bingo" bør klargjøres som "SpinnGo (Spill 4 / game5) — databingo" |
| `docs/engineering/game5-canonical-spec.md` | Legg til front-matter `marketName: "SpinnGo"` og `regulatoryCategory: "Databingo"` + ref til dette dokumentet |
| `docs/engineering/BACKEND_PARITY_AUDIT_2026-04-23.md` | Klargjør at Spill 1-3 er hovedspill og SpinnGo (game5) er databingo |
| `docs/architecture/WIREFRAME_CATALOG.md` | "PDF 6: Game 5 Admin (SpinnGo)" presiser at dette er databingo |
| `docs/architecture/LEGACY_1_TO_1_MAPPING_2026-04-23.md` | Oppdater med korrekt klassifisering — særlig wallet-account-IDer og §11-prosent-tabeller |
| `docs/compliance/KRITISK1_RNG_*.md` | Presiser at Spill 1-3 er hovedspill og kun SpinnGo er databingo |
| `docs/compliance/RNG_OG_BALLTREKNING_GJENNOMGANG_2026-04-09.md` | Samme presisering |
| `docs/compliance/SPILL1_GAMETYPE_INVESTIGATION_2026-04-25.md` | Anbefaling endres: bytt kun Spill 1-3 (BingoEngine + Game1*) til MAIN_GAME, behold SpinnGo som DATABINGO |
| `docs/engineering/TECHNICAL_BACKLOG.md` | BG-011/012/013 og overskudd-prosent — presiser SpinnGo-scope, ikke alle interne spill |
| `docs/operations/PM_HANDOFF_2026-04-23.md` | Legg til peker til denne korrigerte versjonen |
| `apps/backend/src/spillevett/reportExport.ts:24` | Kommentar over `MAIN_GAME`-gren: "Spill 1-3 er hovedspill; SpinnGo har egen DATABINGO-gren." |

Oppdateringer skal ikke gjøres i én mega-PR. Lag én PR per tematisk gruppe (docs, compliance, code-kommentarer).

---

## 8. For nestemann som ser dette dokumentet

Hvis du har tvil om et spill eller navn, bruk denne sjekklisten:

1. **Hvilket spill?** → Se tabellen i §1. Bruk alltid slug i kode, markedsføringsnavn i UI.
2. **Er dette hovedspill eller databingo?** → Spill 1-3 er hovedspill. SpinnGo (Spill 4 / game5) er databingo. Candy er eksternt.
3. **Skal vi implementere Candy-funksjon X?** → Nei. Candy eier sin egen backend. Vi eier kun launch + wallet + iframe.
4. **Er Game 4 et aktivt spill?** → Nei. Deprecated BIN-496. Slug `game4` / `themebingo` skal ikke brukes.
5. **Er Spill 4 og Game 5 samme spill?** → Ja. Markedsføringsnavn er "SpinnGo" eller "Spill 4", kodenavn er `spillorama` (historisk `game5`).
6. **Hvilken §11-prosent gjelder?** → Spill 1-3: 15% til organisasjoner. SpinnGo: 30% til organisasjoner.
7. **Hvilken kanal er det?** → Spill 1-3 har to kanaler: hall (kontant) og internet (wallet). SpinnGo har kun internett (player-startet).

Hvis du fortsatt er i tvil: spør Tobias **før** du endrer arkitektur eller terminologi i noe annet dokument.
