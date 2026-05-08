# ADR-0008 — Spillkatalog-paritet (Spill 1-3 = MAIN_GAME, SpinnGo = DATABINGO)

**Status:** Accepted
**Dato:** 2026-04-25
**Deciders:** Tobias Haugen
**Konsulterer:** Pengespillforskriften §11

> **Migrering 2026-05-08:** Migrert fra `docs/decisions/ADR-007-spillkatalog-classification.md` til ny struktur. Innhold uendret.

## Kontekst

Pengespillforskriften skiller mellom:
- **Hovedspill** — live, hall eller internett, max 2500 kr enkelt-premie, **min 15 % til organisasjoner**
- **Databingo** — elektronisk forhåndstrukket, **min 30 % til organisasjoner**
- **Internett-hovedspill** — online-variant av hovedspill (underkategori av hovedspill)

I 2026-04-23 ble alle fire interne spill (Spill 1-4) feilaktig klassifisert som hovedspill i en
spec-spikring. Dette ville bety:

- §11-distribusjon: 15 % til organisasjoner for alle
- ComplianceLedger ville hardkode `gameType: "DATABINGO"` for ALLE call-sites (også Spill 1-3)

Tobias-korrigering 2026-04-25: SpinnGo (Spill 4 / `game5` / slug `spillorama`) er **databingo**, ikke
hovedspill. Spill 1-3 forblir hovedspill.

## Beslutning

Autoritativ klassifisering (se [`docs/architecture/SPILLKATALOG.md`](../architecture/SPILLKATALOG.md)):

| Marketing | Slug | Kategori | §11 % |
|---|---|---|---|
| Spill 1 | `bingo` | Hovedspill (MAIN_GAME) | 15 % |
| Spill 2 | `rocket` | Hovedspill (MAIN_GAME) | 15 % |
| Spill 3 | `monsterbingo` | Hovedspill (MAIN_GAME) | 15 % |
| SpinnGo (Spill 4) | `spillorama` | **Databingo (DATABINGO)** | **30 %** |
| Candy | `candy` | Tredjeparts iframe | (Candy-leverandørs ansvar) |

ComplianceLedger må skille tre regulatoriske dimensjoner:
- Hall main game (Spill 1-3 spilt fysisk i hall)
- Internet main game (Spill 1-3 spilt over internett)
- Databingo (SpinnGo player-startet)

`app_rg_compliance_ledger.game_type` skal ha:
- `MAIN_GAME` for Spill 1-3 (kanal-felt skiller hall/internett)
- `DATABINGO` for SpinnGo

**Game 4 / `themebingo` er deprecated (BIN-496). Ikke bruk.**

## Konsekvenser

### Positive
- **Regulatorisk korrekt:** §11-distribusjon stemmer med pengespillforskriften
- **Lotteritilsynet-kommunikasjon:** vi kan svare entydig på "hvilken kategori?" per spill
- **Implementasjon-clarity:** kode-call-sites passer nå korrekt gameType-parameter

### Negative
- **Korreksjon-arbeid kreves:** 12+ call-sites i ComplianceLedgerOverskudd.ts og BingoEngine hardkodet
  `DATABINGO` for Spill 1-3 — må endres til `MAIN_GAME`. Status: in progress (BIN-XXX).
- **Wallet-konto-ID-format må vurderes:** `makeHouseAccountId()` produserte
  `house-{hallId}-databingo-{channel}` — gir dårlig konto-ID-shape for Spill 1-3 hovedspill.
- **Audit-historikk:** eksisterende rader med feil gameType beholdes (forklaring: "feil-klassifisering
  korrigert 2026-04-25, se ADR-0008"). Nye rader skrives med korrekt klassifisering.

### Nøytrale
- **SpinnGo-implementasjon:** SpinnGo som databingo har egne regler — min 30 sek mellom spill, max 5
  tickets per session, én aktiv databingo per spiller. Disse reglene gjelder KUN SpinnGo, ikke Spill 1-3.

## Alternativer vurdert

### Alternativ A: Behold "alt er hovedspill"-klassifiseringen
Avvist:
- Bryter pengespillforskriften
- Lotteritilsynet kunne nekte konsesjon

### Alternativ B: Klassifiser ALT som databingo
Avvist:
- Spill 1-3 spilles live i hall — ikke forhåndstrukket
- Bryter regulatorisk modell

### Alternativ C: Bygg et generisk gameType-attribute som kunne overstyres per spill-konfigurasjon
Avvist:
- Premature abstraction (vi har 4 spill, ikke 40)
- Eksplisitt klassifisering er klarere for revisor

## Implementasjon

- ✅ `docs/architecture/SPILLKATALOG.md` er autoritativ kilde
- ✅ CLAUDE.md oppdatert med korrekt klassifisering
- ⚠️ ComplianceLedger-call-sites under migrering (12+ steder)
- ⚠️ Wallet-konto-ID format-vurdering pågår

Skills som bør oppdateres: `pengespillforskriften-compliance`, `spinngo-databingo`, `spill1-master-flow`,
`spill2-perpetual-loop`, `spill3-phase-state-machine`.

## Referanser

- `docs/architecture/SPILLKATALOG.md` (autoritativ)
- `docs/compliance/SPILL1_GAMETYPE_INVESTIGATION_2026-04-25.md`
- BIN-496 — Game 4 / themebingo deprecation
- Pengespillforskriften §11 (organisasjons-distribusjon)
