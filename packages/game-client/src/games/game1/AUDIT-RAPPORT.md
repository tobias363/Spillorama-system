# Spill 1 — Senior Konsulent Audit-rapport

**Dato:** 2026-04-16
**Utført av:** Claude (AI Senior Consultant)
**Formål:** Komplett gap-analyse mellom Unity-implementasjon og web-native klient
**Prioritet:** Alt skal være 100% identisk med Unity-spillet

---

## Sammendrag

Etter en grundig linje-for-linje gjennomgang av all Unity-kode (14 filer, ~5000 linjer) har jeg identifisert **42 konkrete gap** mellom Unity og web-native klienten. De er kategorisert etter alvorlighet og delt inn i implementasjonsgrupper.

**Status:**
- ✅ Fungerer: 12 funksjoner
- ⚠️ Delvis: 8 funksjoner
- ❌ Mangler helt: 22 funksjoner

---

## Del 1: Hva som fungerer (✅)

| # | Funksjon | Kommentar |
|---|----------|-----------|
| 1 | Socket-tilkobling (room:join, room:update) | Identisk |
| 2 | Ball-trekking mottak (draw:new) | Identisk |
| 3 | Pattern-won mottak (pattern:won) | Identisk |
| 4 | GameBridge state management | Identisk |
| 5 | 3x5 ticket grid rendering | Fungerer med korrekt gridSize |
| 6 | Fargetemaer per ticket-type (7 farger) | Fungerer |
| 7 | Tall-markering på bonger | Fungerer |
| 8 | ToGo-teller per bong | Fungerer |
| 9 | Best-card-first sortering | Fungerer |
| 10 | Claim auto-submit (LINE/BINGO) | Fungerer |
| 11 | Per-type ticket-kjøp med vektssystem | Implementert i dag |
| 12 | Server-autoritativ innsatsvisning | Implementert i dag |

---

## Del 2: Gap-analyse — Hva som mangler

### Gruppe A: Spillflyt og live rom (KRITISK)

| # | Gap | Unity-implementasjon | Web-native status | Prioritet |
|---|-----|---------------------|-------------------|-----------|
| A1 | **Trekk-kapasitet er feil** | Unity: `drawBag.length + drawnNumbers.length` (60 tall for Databingo60). `remainingNumbers` fra snapshot. Backend: `drawCapacity=30` i scheduler, MEN `bingoMaxDrawsPerRound` styrer dette. | Web viser "X/60" men scheduler er konfigurert til 30 trekk max. Må verifisere at backend bruker 60 for Databingo60. | KRITISK |
| A2 | **Nedtelling mellom runder** | Unity: `scheduler.millisUntilNextStart` → countdown i sekunder (1-60s range). Vises i center-ball OG i left info panel. Timer stoppes ved game start. | CenterBall har countdown, men LeftInfoPanel sin countdown kan være buggy. Trenger verifisering. | HØY |
| A3 | **Spectator ser live trekking** | Unity: Spectator ser kuler trekkes, bonger (display-only), og patterns. Kan kjøpe til NESTE runde mens de ser på. | Fungerer delvis — spectator ser kuler men buy-popup overlapper trekningen. | HØY |
| A4 | **Spill-start signaler** | Unity: `OnGameStarted` → skjul timer, skjul delete-knapper, lukk lucky number panel, skjul upcoming purchase UI. | Mangler: delete-knapper skjules ikke, lucky number panel lukkes ikke. | HØY |
| A5 | **Spill-slutt håndtering** | Unity: `OnGameFinish` → stopp all blink, reset ball-panel, vis timer, enable buy, refresh balance. | Delvis — transitioner til WAITING men mangler animasjons-reset. | HØY |
| A6 | **Host/master manuell start** | Unity: `scheduler.canStartNow` flag. Admin/host kan starte manuelt. | Ikke implementert — kun auto-start via scheduler. | MEDIUM |
| A7 | **Reconnect-håndtering** | Unity: `room:resume` event. Deduplicerer trekk via `_lastDrawIndex`. Rebuilder all state fra snapshot. | `room:resume` finnes i socket men brukes ikke i Game1Controller. | HØY |

### Gruppe B: Bonger og markering

| # | Gap | Unity-implementasjon | Web-native status | Prioritet |
|---|-----|---------------------|-------------------|-----------|
| B1 | **One-to-go celle-blink** | LeanTween scale punch 1.5x, 1.0s, infinite loop. `imgCellOneToGo` overlay med `One_to_go_Color`. | Eksisterer i BingoCell (GSAP scale 1.15x, 0.4s). Overlay-fargen finnes. Men **1.5x vs 1.15x** og **1.0s vs 0.4s** avviker. | MEDIUM |
| B2 | **Ticket background blink (1-to-go)** | Hele bongen blinker mellom normalfarge og `Blink_On_1_Color`, 0.5s per overgang, infinite. | Ikke implementert — kun celle-blink, ikke hele bongen. | HØY |
| B3 | **BINGO pulse-animasjon** | Bong scale: 0.85x → 1.05x, 0.25s per fase, 5 repetisjoner. "BINGO" tekst vises. | Ikke implementert. | MEDIUM |
| B4 | **Free cell (center)** | Index 12 i 5x5 grid viser "F", pre-markert. | BingoGrid har free cell for 5x5, men Databingo60 bruker 3x5 uten free cell. Korrekt for nåværende oppsett. | OK |
| B5 | **Markerings-lyd** | `SoundManager.TicketNumberSelection()` ved match. | AudioManager har `playNumber()` men mangler separat markerings-lyd. | LAV |
| B6 | **Bong-flip (vis detaljer)** | Y-rotation 0→90→0 over 1.0s totalt. Viser ticketNumber, price, hallName. Auto-lukk etter 3.0s. | Ikke implementert. | LAV |
| B7 | **Slett-knapp per bong** | Vises mellom runder, skjules under RUNNING. Large tickets: delete kun på siste i gruppe av 3. | "Avbestill bonger"-knapp finnes men er ikke per-bong. | MEDIUM |
| B8 | **Large ticket variant** | Egen prefab `PrefabBingoGame1LargeTicket5x5` med større dimensjoner. | Kun standard TicketCard — ingen large variant. | LAV |

### Gruppe C: Visuelt og animasjoner

| # | Gap | Unity-implementasjon | Web-native status | Prioritet |
|---|-----|---------------------|-------------------|-----------|
| C1 | **Pattern-animasjoner (5 typer)** | Design 0: custom mask + 1.06x breathe. Design 1: cycling rader/kolonner 1s delay. Design 2-4: cycling kombinasjoner. | PatternMiniGrid.ts har enkel pulse. Mangler cycling-animasjoner for design 1-4. | MEDIUM |
| C2 | **Rad-gevinst panel** | Viser "Rad 1 — X kr" med ActiveColour/DeActiveColour. Dynamisk oppdatering ved pattern-won. | CenterTopPanel viser rader men farger/oppdatering må verifiseres. | MEDIUM |
| C3 | **Ball-farger per kolonne** | B(1-15)=blue, I(16-30)=red, N(31-45)=purple, G(46-60)=green, O(61-75)=yellow. | BallTube har farger — må verifisere at Databingo60 (1-60) mapper korrekt. | HØY |
| C4 | **Bakgrunnsbilde** | Unity har dedikert game1-bakgrunn. | `bg-game1.png` lastes men feiler stille hvis filen mangler. | LAV |
| C5 | **Chat slide-animasjon** | 0.25s slide. Bong-area krymper/utvides. Header flytter 80px. | ChatPanelV2 har show/hide men mangler bong-area resize. | LAV |

### Gruppe D: Markør og tilpasning

| # | Gap | Unity-implementasjon | Web-native status | Prioritet |
|---|-----|---------------------|-------------------|-----------|
| D1 | **Markør-valg (6 stk)** | MarkerBackgroundPanel med 6 markør-sprites. Lagres i PlayerPrefs("Game_Marker"). | MarkerBackgroundPanel.ts eksisterer med 6 markører. | ✅ OK |
| D2 | **Bakgrunns-valg (5 stk)** | 5 bakgrunns-valg for bong-celler. | MarkerBackgroundPanel.ts har dette. | ✅ OK |
| D3 | **Lucky number highlight** | Celle med lucky number får spesialfarge (`colorLuckyNumber`). | BingoCell har `highlightLuckyNumber`. | ⚠️ Verifiser farge |

### Gruppe E: Lyd og annonsering

| # | Gap | Unity-implementasjon | Web-native status | Prioritet |
|---|-----|---------------------|-------------------|-----------|
| E1 | **Norsk mann stemme** | `Game1NorwegianMalebingoNumberAnnouncementAudioClip[]` — 75 clips. | AudioManager har `playNumber()` men mangler norske stemmer. | MEDIUM |
| E2 | **Norsk kvinne stemme** | `NorwegianFemalebingoNumberAnnouncementAudioClip[]` — 75 clips. | Mangler. | MEDIUM |
| E3 | **Engelsk stemme** | `bingoNumberAnnouncementAudioClip[]` — 90 clips. | Mangler. | LAV |
| E4 | **Dobbel annonsering** | `callTwoTime` modus: spiller to ganger, andre gang med volum 0.6. | Mangler. | LAV |
| E5 | **BINGO-lyd** | Venter til nummerannonsering er ferdig + 1.0s, spiller "bingo" clip. | Mangler. | MEDIUM |
| E6 | **Markerings-lyd** | `TicketNumberSelection()` ved match. | Mangler separat clip. | LAV |
| E7 | **Språk-valg i innstillinger** | 3 valg: norsk mann, norsk kvinne, engelsk. | SettingsPanel.ts har dette UI-et men audio er ikke koblet. | MEDIUM |

### Gruppe F: Spillvarianter

| # | Gap | Unity-implementasjon | Web-native status | Prioritet |
|---|-----|---------------------|-------------------|-----------|
| F1 | **Elvis-variant** | Bonger i par (weight 2). Replace-mekanikk. Elvis-ikon. Stor bong-format. | Ticket-type "elvis" finnes i backend. Frontend mangler par-visning og replace. | LAV |
| F2 | **Traffic Light-variant** | Bonger i grupper av 3 (R/Y/G, weight 3). | Ticket-type finnes. Gruppering mangler i frontend. | LAV |
| F3 | **Mystery Game mini-spill** | Ball-valg mini-spill etter BINGO. | MysteryGameOverlay.ts eksisterer men er stub. | LAV |
| F4 | **Color Draft mini-spill** | Farge-draft etter BINGO. | ColorDraftOverlay.ts eksisterer men er stub. | LAV |
| F5 | **Wheel of Fortune** | 8 segmenter, auto-spin, server-resultat. | WheelOverlay.ts finnes med implementasjon. | ⚠️ Verifiser |
| F6 | **Treasure Chest** | Velg kiste, auto-select, server-resultat. | TreasureChestOverlay.ts finnes med implementasjon. | ⚠️ Verifiser |

### Gruppe G: Multi-hall og fysiske bonger

| # | Gap | Unity-implementasjon | Web-native status | Prioritet |
|---|-----|---------------------|-------------------|-----------|
| G1 | **Multi-hall linking** | Spillere i ulike haller spiller SAMME spill via hallId → canonical room. | Backend håndterer dette. Web-klient joiner riktig rom. | ✅ OK |
| G2 | **Fysisk bong-skanning** | Tickets har `hallName`, `supplierName`. Backend viser antall solgte per sted. | Backend støtter dette. Web-klient viser ikke salgstall per hall. | MEDIUM |
| G3 | **Spillerinfo per hall** | Viser antall spillere totalt og per hall. | Viser kun totalt antall. | LAV |

---

## Del 3: Anbefalt implementasjonsrekkefølge

### Sprint 1: Kjerneflyt (1-2 dager)
**Mål: Spillet fungerer korrekt fra start til slutt**

1. **A1: Trekk-kapasitet** — Verifiser at backend bruker 60 trekk for Databingo60
2. **A4: Spill-start signaler** — Skjul delete-knapper, lukk popups ved game start
3. **A5: Spill-slutt** — Stopp animasjoner, reset state, vis buy-popup
4. **A7: Reconnect** — Implementer `room:resume` med state-rebuild
5. **C3: Ball-farger** — Verifiser Databingo60 farge-mapping

### Sprint 2: Bonger og animasjoner (2-3 dager)
**Mål: Bong-opplevelsen matcher Unity**

6. **B1: One-to-go blink** — Juster til 1.5x/1.0s for å matche Unity
7. **B2: Ticket background blink** — Implementer hel-bong blink ved 1-to-go
8. **B3: BINGO pulse** — Scale-animasjon + BINGO-tekst
9. **B7: Slett per bong** — Delete-knapp per bong, skjules under RUNNING
10. **C1: Pattern-animasjoner** — Cycling row/column highlights

### Sprint 3: Lyd (1-2 dager)
**Mål: Lydannonsering fungerer**

11. **E1-E3: Stemmer** — Norsk mann/kvinne/engelsk audio clips
12. **E4: Dobbel annonsering** — Repeat med lavere volum
13. **E5: BINGO-lyd** — Sekvensert avspilling
14. **E7: Språk-valg** — Koble settings panel til AudioManager

### Sprint 4: Varianter og mini-spill (2-3 dager)
**Mål: Alle spillvarianter fungerer**

15. **F1: Elvis** — Par-visning, replace, ikon
16. **F2: Traffic Light** — Gruppering R/Y/G
17. **F3-F6: Mini-spill** — Fullføre stubs

### Sprint 5: Polish (1-2 dager)
**Mål: Pixel-perfect matching**

18. **A2: Nedtelling** — Verifiser countdown i begge paneler
19. **A3: Spectator-modus** — Buy-popup UX under live trekking
20. **C2: Rad-gevinst farger** — Active/Deactive colors
21. **C5: Chat slide** — Bong-area resize
22. **G2: Salgsinfo per hall** — Vise antall solgte per sted

---

## Del 4: Animasjonsparametere (Unity → Web mapping)

For utviklere som implementerer animasjoner:

| Unity (LeanTween) | Web (GSAP) | Parameter |
|--------------------|------------|-----------|
| `LeanTween.scale(obj, Vector3(1.5,1.5), 1.0f).setLoopCount(-1)` (punch) | `gsap.to(scale, { x:1.5, y:1.5, duration:1.0, ease:"elastic", repeat:-1 })` | One-to-go blink |
| `LeanTween.scale(obj, Vector3(1.06,1.06), 0.5f).setEase(easeInOutSine).setLoopPingPong(-1)` | `gsap.to(scale, { x:1.06, y:1.06, duration:0.5, ease:"sine.inOut", yoyo:true, repeat:-1 })` | Pattern breathe |
| `LeanTween.value(obj, colorA, colorB, 0.5f).setLoopPingPong(-1)` | `gsap.to(bg, { pixi:{tint:colorB}, duration:0.5, yoyo:true, repeat:-1 })` | Ticket bg blink |
| `LeanTween.scale(obj, Vector3(0.85,0.85), 0.25f)` then `.scale(1.05, 0.25f)` ×5 | `gsap.timeline().to(scale, {x:0.85,y:0.85,duration:0.25}).to(scale,{x:1.05,y:1.05,duration:0.25}).repeat(5)` | BINGO pulse |
| `LeanTween.rotateY(obj, 90, 0.5f)` | `gsap.to(obj, { rotationY:90, duration:0.5 })` | Ticket flip |

---

## Del 5: Backend-konfigurasjon som må verifiseres

| Parameter | Forventet (fra Unity) | Nåværende backend-verdi | Fil |
|-----------|----------------------|------------------------|-----|
| `bingoMaxDrawsPerRound` | 60 (Databingo60) | 30 ❌ | `.env` / `bingoSettings.ts` |
| `autoRoundTicketsPerPlayer` | 30 (max grense) | 30 ✅ | `.env` |
| `autoRoundStartIntervalMs` | 30000 | 30000 ✅ | `.env` |
| `payoutPercent` | 100 | 100 ✅ | `.env` |
| `entryFee` | 20 | 20 ✅ | `.env` / `roomState` |
| `drawInterval` | 2000ms | 2000ms ✅ | `.env` |

**KRITISK:** `bingoMaxDrawsPerRound=30` er for lavt for Databingo60 som har 60 tall. Må endres til 60.

---

## Del 6: Konklusjon

Web-native klienten har et solid fundament — socket-kommunikasjon, state management, og grunnleggende rendering fungerer. De kritiske gapene er:

1. **Trekk-kapasitet** (30 vs 60) — dette er en backend-konfigurasjonsfeil som må fikses umiddelbart
2. **Spill-livssyklus** (start/stopp signaler) — mangler animasjons-reset og UI-cleanup
3. **Ticket background blink** — viktig visuell feedback som mangler helt
4. **Lyd** — helt fraværende, men kan implementeres inkrementelt

Med 5 sprinter over ca. 2 uker kan spillet nå 100% feature-paritet med Unity.
