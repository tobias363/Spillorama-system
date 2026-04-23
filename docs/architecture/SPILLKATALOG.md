# Spillorama spillkatalog — definitiv oversikt

**Status:** Spikret 2026-04-23 av Tobias (teknisk lead).
**Formål:** Eneste autoritative kilde for hvilke spill som finnes i Spillorama-systemet, hvordan de navngis, og hvilken regulatorisk kategori de tilhører.

Ved uenighet mellom dette dokumentet og andre dokumenter (README-er, wireframe-spec, audit-rapporter, canonical specs, kildekode-kommentarer): **dette dokumentet vinner**, og de andre må oppdateres.

---

## 1. Fire interne spill + Candy

Spillorama har **fire** egne spill (Spill 1–4) og **ett** eksternt spill integrert via iframe (Candy).

| Markedsføringsnavn | Regulatorisk kategori | Backend-slug | Legacy kodenavn | Grid | Ball-range | Spesielle mekanikker |
|---|---|---|---|---|---|---|
| **Spill 1** | Hovedspill | `bingo` | Game 1 / `game1` / `game_1` | 5×5 (fri sentercelle) | 1–75 | Mini-game-rotasjon: Wheel of Fortune, Treasure Chest, Mystery, ColorDraft |
| **Spill 2** | Hovedspill | `rocket` | Game 2 / `game2` | 3×5 | 1–60 | Rakettstabling, paginering, blind ticket purchase |
| **Spill 3** | Hovedspill | `monsterbingo` | Game 3 / `game3` | 5×5 (fri sentercelle) | 1–60 | Animert kulekø (FIFO maks 5), mønsteranimasjon, chat |
| **Spill 4** | Hovedspill | `spillorama` | Game 5 / `game5` / "SpinnGo" / "Spillorama Bingo" | 3×5 | 1–60 | Ruletthjul (rulett-fysikk), Free Spin Jackpot, SwapTicket |
| **Candy** | Ekstern (tredjeparts) | `candy` | — | — | — | Iframe-integrasjon; logikk ligger hos Candy-leverandør |

### Game 4 — finnes IKKE

**Viktig:** Det finnes **ingen Spill 4 som matcher gammel Game 4**. Game 4 het "Temabingo" i legacy og ble **permanent avviklet** per BIN-496 (2026-04-17). Ingen ny spill-kode er skrevet for Game 4.

**Derfor:**
- Spill 4 (markedsføringsnavn) → Game 5 (kodenavn) → slug `spillorama`
- Gammel Game 4 / `game4` / `themebingo` → **deprecated, ikke bruk**

Denne offset-en (markedsføring nummer 4, kode nummer 5) er historisk arv. Ny kode skal bruke slug-ene, ikke Game-nummer.

---

## 2. Regulatorisk kategori — alle interne spill er hovedspill

Pengespillforskriften definerer tre kategorier for bingo-lignende pengespill:

1. **Hovedspill** — maksimal enkeltpremie 2500 kr, direkte-spill i hall eller over internett
2. **Databingo** — elektronisk forhåndstrukket, lavere premier, egne utdelingsregler
3. **Internett-hovedspill** — online-variant av hovedspill (underkategori av hovedspill)

**Alle fire Spillorama-spill (Spill 1–4) er hovedspill.** Spillorama **driver ikke databingo**. "Databingo"-termen skal aldri brukes som navn på et Spillorama-spill eller som kategoribeskrivelse for Spillorama-arkitekturen.

### Unntak hvor "databingo" er riktig å nevne

- Regulatoriske referanser der vi beskriver hele lovkategori-strukturen (f.eks. "pengespillforskriften dekker hovedspill, databingo og internett-hovedspill")
- Sammenligninger der vi forklarer at Spillorama er hovedspill og **ikke** databingo
- Historiske kommentarer i legacy-kode som skal utfases

### Feilbruk som må rettes

Kjente dokumenter som fortsatt kaller Spillorama for "databingo":

| Fil | Problem | Handling |
|---|---|---|
| `docs/compliance/KRITISK1_RNG_ALGORITMEBESKRIVELSE.md` | "System: Spillorama Databingo (60-ball variant)" | Korriger til "Spillorama hovedspill". Krever regulatorisk avklaring med Lotteritilsynet hvis dokumentet alt er innsendt — se §5. |
| `docs/compliance/KRITISK1_RNG_SERTIFISERINGSPLAN.md` | "databingo i Norge" som systembeskrivelse | Korriger. Samme merknad om evt. innsendt versjon. |
| `docs/compliance/RNG_OG_BALLTREKNING_GJENNOMGANG_2026-04-09.md` | "Norsk regulering for databingo krever at spillsystemet er godkjent" | Korriger til "hovedspill". |
| `docs/engineering/TECHNICAL_BACKLOG.md` BG-011, BG-012, BG-013 | "Enforce min 30s between databingo sequences", "max 5 databingo tickets", "one active databingo per player" | Revurdér: hvis reglene stammer fra databingo-kategori-spec, gjelder de ikke oss. Sjekk opprinnelig kilde — hvis regel gjelder hovedspill, omdøp. Hvis ikke, fjern. |
| `apps/backend/src/spillevett/reportExport.ts:24` | Returnerer "Databingo" som label | Skal aldri skje i praksis siden alle våre spill er `MAIN_GAME`. Behold koden som safety-fallback, men `MAIN_GAME` → "Hovedspill" er den riktige grenen. |

---

## 3. Candy — ekstern iframe-integrasjon

Candy er et tredjeparts-spill vi **ikke** har kildekoden til.

### Hva Spillorama leverer

1. **Launch-endpoint** `POST /api/games/:slug/launch` — autentiserer Spillorama-spiller, genererer session-token, returnerer URL spilleren kan åpne Candy på. Implementert i `apps/backend/src/routes/game.ts:94`.
2. **Wallet-bridge** — `/api/ext-wallet/balance`, `/api/ext-wallet/debit`, `/api/ext-wallet/credit`. Candy-backend kaller disse med API-key for å sjekke saldo og belaste/kreditere Spillorama-lommeboken.
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

## 4. Navnkonvensjoner i koden

### Brukervendt tekst (UI, markedsføring, admin-paneler)

Bruk **Spill 1 / Spill 2 / Spill 3 / Spill 4 / Candy**.

### Backend-koden (slugs i DB, URL-paths, event-navn)

Bruk **slugs**: `bingo`, `rocket`, `monsterbingo`, `spillorama`, `candy`.

Slug-er er stabile og skal ikke endres — det ville kreve DB-migrasjon av eksisterende data. "Spillorama" som slug er en historisk arv; vi beholder den selv om markedsføringsnavnet er "Spill 4".

### Kodekommentarer og dokumentasjon

Bruk den mest spesifikke termen for konteksten:
- Snakker du om runtime-koden? → slug (`spillorama`)
- Snakker du om brukeropplevelsen? → markedsføringsnavn (`Spill 4`)
- Historisk referanse til legacy? → legacy-kodenavn (`Game 5`)

Unngå tvetydige termer som "bingo-spillet" eller "hovedspillet" uten å presisere hvilket.

### Mapping-tabell for rask slå-opp

```
Spill 1  = game1  = bingo         = Hovedspill, 75-ball 5×5
Spill 2  = game2  = rocket        = Hovedspill, 60-ball 3×5
Spill 3  = game3  = monsterbingo  = Hovedspill, 60-ball 5×5
Spill 4  = game5  = spillorama    = Hovedspill, 60-ball 3×5 + rulett (kan også kalles "SpinnGo")
Candy    = —      = candy         = Ekstern iframe (tredjeparts)
(Game 4 = game4  = themebingo    = DEPRECATED BIN-496, ikke bruk)
```

---

## 5. Åpne regulatoriske avklaringer

Følgende punkter er ikke lukket av dette dokumentet og krever Tobias eller ekstern avklaring:

1. **RNG-sertifiseringsdokumenter:** `KRITISK1_RNG_ALGORITMEBESKRIVELSE.md` og `KRITISK1_RNG_SERTIFISERINGSPLAN.md` beskriver Spillorama som "databingo system". Hvis disse er **innsendt til et akkreditert testlab** eller **Lotteritilsynet** i feil-versjon, må korreksjon koordineres med mottaker. Hvis de kun er interne utkast, kan de bare redigeres.
2. **TECHNICAL_BACKLOG §BG-011/012/013** — reglene "min 30s mellom databingo", "maks 5 databingo-tickets", "én aktiv databingo per spiller" ble skrevet som databingo-restriksjoner. Hvis de egentlig er hovedspill-regler, må de omdøpes og beholdes. Hvis de er databingo-spesifikke, er de irrelevante for Spillorama og skal fjernes.
3. **Overskudd-prosent:** TECHNICAL_BACKLOG sier "Main game min 15% to organizations" og "Databingo min 30% to organizations". Siden vi kun driver hovedspill, er 15%-regelen relevant og 30%-regelen skal fjernes.

Disse tre punktene skal løses i en separat PR som følger opp dette dokumentet.

---

## 6. Dokumenter som må oppdateres for å reflektere denne arkitekturen

Sist-validert 2026-04-23. Denne listen skal brukes som sjekkliste i oppfølgings-PR.

| Dokument | Hva som må rettes |
|---|---|
| `docs/engineering/PARITY_MATRIX.md` | "Game 5 — Spillorama Bingo" bør klargjøres som "Spill 4 (Game 5 / slug spillorama)" i tittel. |
| `docs/engineering/game5-canonical-spec.md` | Legg til front-matter `marketName: "Spill 4"` og ref til dette dokumentet. |
| `docs/engineering/BACKEND_PARITY_AUDIT_2026-04-23.md` | "Games ported: Game1–5" → "Spill 1–4 (kode: game1, game2, game3, game5)". Fjern eventuelle databingo-referanser. |
| `docs/architecture/WIREFRAME_CATALOG.md` | "PDF 6: Game 5 Admin (SpinnGo)" skal avklares: dette er Spill 4. |
| `docs/architecture/LEGACY_1_TO_1_MAPPING_2026-04-23.md` | Oppdater med denne navnkonvensjonen. |
| `docs/compliance/KRITISK1_RNG_*.md` | Se §5 over — regulatorisk avklaring nødvendig. |
| `docs/compliance/RNG_OG_BALLTREKNING_GJENNOMGANG_2026-04-09.md` | "databingo" → "hovedspill" i systembeskrivelser. |
| `docs/engineering/TECHNICAL_BACKLOG.md` | Se §5 over — BG-011/012/013 og overskudd-regler. |
| `docs/operations/PM_HANDOFF_2026-04-23.md` | Legg til referanse til dette dokumentet som master-sannhet for spillkatalog. |
| `apps/backend/src/spillevett/reportExport.ts:24` | Kommentar over `MAIN_GAME`-gren: "Alle Spillorama-spill er hovedspill; databingo-grenen er dead code men beholdt som safety-fallback." |

Oppdateringer skal ikke gjøres i én mega-PR. Lag én PR per tematisk gruppe (docs, compliance, code-kommentarer).

---

## 7. For nestemann som ser dette dokumentet

Hvis du har tvil om et spill eller navn, bruk denne sjekklisten:

1. **Hvilket spill?** → Se tabellen i §1. Bruk alltid slug i kode, markedsføringsnavn i UI.
2. **Er dette hovedspill eller databingo?** → Det er alltid hovedspill for Spillorama-spill. Databingo er en annen lovkategori vi ikke driver.
3. **Skal vi implementere Candy-funksjon X?** → Nei. Candy eier sin egen backend. Vi eier kun launch + wallet + iframe.
4. **Er Game 4 et aktivt spill?** → Nei. Deprecated BIN-496. Slug `game4` / `themebingo` skal ikke brukes.
5. **Er Spill 4 og Game 5 samme spill?** → Ja. Markedsføringsnavn er "Spill 4", kodenavn er `spillorama` (historisk `game5`).

Hvis du fortsatt er i tvil: spør Tobias **før** du endrer arkitektur eller terminologi i noe annet dokument.
