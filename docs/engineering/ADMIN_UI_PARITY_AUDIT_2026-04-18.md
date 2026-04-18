# Admin-UI Visuell Paritets-Audit

**Generert:** 2026-04-18
**Legacy referanse:** commit `982f5d6b^` = `5fab79b9` (2026-04-07, fix(BIN-134), siste commit FØR Candy ble fjernet)
**Nåværende:** `apps/admin-web/index.html` + `apps/admin-web/app.js` (worktree slot-1)
**Metode:** `diff -u` på `index.html` (389 diff-linjer) og `app.js` (1652 diff-linjer) + seksjonsinventar via grep.

---

## 1. Fil-inventar

### Legacy `frontend/admin/` (@ 982f5d6b^)
Kun TO filer i hele mappen:
| Fil | Linjer | Kommentar |
|---|---|---|
| `frontend/admin/index.html` | 839 | All CSS inline i `<style>` (linjer 7–305) |
| `frontend/admin/app.js` | 3980 | All JS |

**Ingen** separat `app.css`, `styles.css`, logo-bilde, eller andre assets. Admin er fullstendig self-contained i to filer.

### Nåværende `apps/admin-web/` (@ HEAD)
| Fil | Linjer | Kommentar |
|---|---|---|
| `apps/admin-web/index.html` | 907 | CSS inline (samme `<style>`-block) |
| `apps/admin-web/app.js` | 3883 | All JS |

Samme struktur. Ingen tapte eller ekstra filer.

### Diff-oversikt
- `index.html`: +204 linjer, −136 linjer (netto +68 — nye seksjoner minus Candy)
- `app.js`: kompleks refaktorering — trygt å anta at logikk for nye seksjoner er lagt til og Candy-logikk er fjernet. Detaljert JS-logikk-diff er ikke del av visuell audit.

---

## 2. HTML-struktur — seksjoner

### Seksjoner i LEGACY (9 totalt, inkl. Candy)
Rekkefølge i sidebar:
1. Spillinnstillinger (`#section-game-settings`)
2. **Candy (spill + drift)** (`#section-candy-mania`) — SKAL BORT
3. Spillkatalog (andre spill) (`#section-games`)
4. Haller (`#section-halls`)
5. Terminaler (`#section-terminals`)
6. Hall-spillregler (`#section-hall-rules`)
7. Wallet Compliance (`#section-wallet-compliance`)
8. Prize Policy & Extra Prize (`#section-prize-policy`)
9. Romkontroll (`#section-room-control`)

### Seksjoner i NY (10 totalt)
1. **Dashboard** (`#section-dashboard`) — NYE (BIN-517)
2. Spillinnstillinger
3. Spillkatalog (andre spill)
4. Haller
5. **TV-display-tokens** (`#section-hall-display`) — NYE
6. Terminaler
7. Hall-spillregler
8. Wallet Compliance
9. Prize Policy & Extra Prize
10. Romkontroll (Backend) + **Live hall-kontroll (BIN-515)** inline

### Manglende i apps/admin-web (fra legacy, ikke-Candy)
**INGEN.** Alle 8 ikke-Candy-seksjoner fra legacy er bevart med identisk `id` og `<h2>`-tekst.

### Nye i apps/admin-web (skal bevares per oppdrag)
- `#section-dashboard` — live-rom per hall, finansiell rapport, per-spill statistikk (BIN-517)
- `#section-hall-display` — TV-display-tokens med QR-kode
- Inline BIN-515 i `#section-room-control`: "Live hall-kontroll" — ready-countdown, pause/resume, force-end

### Korrekt fjernet (Candy)
- `#section-candy-mania` seksjon fjernet
- Nav-lenke "Candy (spill + drift)" fjernet
- Muted-tekst i `#section-games` endret fra "Candy styres i egen seksjon: ..." til "Styr spillkatalogen som eksponeres i live bingo-systemet."

---

## 3. CSS-forskjeller

### Lokasjon
- **Legacy:** CSS er 100 % inline i `<style>`-blokk inne i `index.html` (linjer 7–305). Ingen eget `app.css`, ingen `styles.css`, ingen `<link rel=stylesheet>`.
- **Ny:** CSS er 100 % inline i `<style>`-blokk inne i `index.html` (linjer 7–305). Identisk lokasjon-strategi.

### Innhold
Linje-for-linje identisk fra linje 1 til linje 333 (`diff` starter først på linje 334, som er nav-lenker i `<body>`).

Det betyr:
- **Farger:** identiske (alle hex-verdier samme: `#f5f7fb` body-bg, `#111827` tekst, `#cbd5e1` input-border, `#dc2626` error-border, osv.)
- **Font-family:** identisk (`"Segoe UI", Tahoma, Geneva, Verdana, sans-serif`)
- **Layout-grid:** identisk (`.admin-shell` 250px sidebar + 1fr innhold, `.grid` 2-col, `.grid-3` 3-col)
- **Spacing:** identisk (16px card-padding, 10-12px gaps, 24px main-padding)
- **Border-radius:** identisk (8–10px på cards/buttons/inputs)
- **Responsive breakpoint:** identisk (`@media (max-width: 980px)` kollapser alle grids til 1 kolonne og gjør sidebar flat)

### Ny CSS lagt til (dashboard-spesifikk)
Inline `<style>` INNE i dashboard-article (linjer 108–145 av diff):
- `.dashboard-tile` — grå tiles med tall
- `.dashboard-hall-card` — hall-kort
- `.dashboard-room-status.RUNNING/WAITING/ENDED/NONE` — status-badges (grønn/blå/grå)
- `.dashboard-bar-chart` + `.dashboard-bar` — stolpediagram for finansiell rapport

Dette er sjuornet inne i dashboard-seksjonen. Går ikke i konflikt med legacy-CSS.

### Logo/branding
- Legacy har **ingen logo** eller brand-image. Kun tekst-overskrift `<h1>Bingo Admin</h1>`.
- Ny har ingen logo heller. **Identisk.**

---

## 4. Navigasjons-rekkefølge

### Legacy (9 menypunkter)
```
Spillinnstillinger
Candy (spill + drift)          <- FJERNET
Spillkatalog (andre spill)
Haller
Terminaler
Hall-spillregler
Wallet Compliance
Prize Policy & Extra Prize
Romkontroll
```

### Ny (10 menypunkter)
```
Dashboard                       <- NY, øverst
Spillinnstillinger
Spillkatalog (andre spill)
Haller
TV-display-tokens               <- NY, innsatt mellom Haller og Terminaler
Terminaler
Hall-spillregler
Wallet Compliance
Prize Policy & Extra Prize
Romkontroll
```

### Avvik
- **Candy fjernet** (ønsket, ikke-avvik)
- **Dashboard lagt til øverst** — *endrer rekkefølge*. Ansatte trent på gammelt design vil åpne siden og se "Dashboard" som første valg i stedet for "Spillinnstillinger".
- **TV-display-tokens satt inn** mellom Haller og Terminaler — logisk plassering (hall-tilknyttet), men endrer tidligere rekkefølge.
- Alle andre labels (`Spillinnstillinger`, `Haller`, `Terminaler`, osv.) er **bokstavtro identiske**.

---

## 5. Komponenter med synlige forskjeller

### Login-skjerm
**100 % identisk.** Linjer 307–330 byte-for-byte like:
- H1 "Bingo Admin"
- Muted-tekst (identisk) "Egen admin-login for full drift..."
- Card med H2 "Admin Login"
- `<input>` felter `email` (placeholder "admin@firma.no") og `password` (placeholder "Passord")
- Button "Logg inn"
- `loginStatus` pre-element med "Ikke logget inn."

**En ansatt som logger inn vil ikke se noen forskjell før sidebar rendres.**

### Sidebar (`.admin-sidebar`)
Identisk styling (sticky top:16px, 250px bredde, grå bakgrunn). Kun innholdet (menypunktene) endret — se seksjon 4.

### Romkontroll (`#section-room-control`)
Identisk oppe-til-midt. **Ny inline-boks lagt til** før `roomStatus`-pre: "Live hall-kontroll (BIN-515)" med grå bakgrunn og 4 input-felter (countdown, melding, pause-melding, force-end-grunn) og 4 knapper. Ansatte trent på gammelt design vil se et nytt felt, men eksisterende knapper (`startRoomBtn`, `drawNextBtn`, `endRoomBtn`) er uendret.

### Spillkatalog (`#section-games`)
Muted-tekst endret fra:
- Legacy: `Candy styres i egen seksjon: <strong>Candy (spill + drift)</strong>.`
- Ny: `Styr spillkatalogen som eksponeres i live bingo-systemet.`

Alt annet i seksjonen er identisk.

### Modaler, toast, confirm-dialog
- Legacy har **ingen** modaler/toasts — kun `.status` pre-elementer med inline-farging (`.status.error`, `.status.success`). Samme tilnærming i ny.
- Ingen nye modaler er introdusert. **Identisk UX-mønster.**

### Tabeller
- Legacy brukte **ingen** HTML-tabeller i admin-UI — alle lister er rendret via JS i `<pre>`- eller `<div>`-containere.
- Ny introduserer tabeller i Dashboard (finansiell rapport, per-spill-statistikk) og TV-display-tokens (token-liste). Alle tabeller bruker inline-styling (`border-collapse: collapse`, `padding: 6px`, `border-bottom: 1px solid #d1d5db`) — konsistent med legacy-farger men ny komponent-type.

### Skjemaer (input-stiler)
**100 % identisk.** Samme `.field`, `.grid`, `.toolbar`-klasser, samme input-border (`#cbd5e1`), samme button-farger, samme error-klasser (`.input-error`, `.field-error`).

---

## Anbefalte fix-er (prioritert)

### P0 (umiddelbart synlig for ansatte ved login)
- **Ingen P0-avvik.** Login-skjermen er pixel-perfekt identisk. Ansatte vil ikke merke endring før de logger inn og ser sidebar.

### P1 (synlig etter login, kan forvirre trent personell)
1. **Nav-rekkefølge endret:** Dashboard er lagt til øverst. Hvis brukeren er trent på å klikke "første menypunkt = Spillinnstillinger", vil nå det åpne Dashboard.
   - **Alternativ A (bevar trening):** flytt Dashboard til *bunnen* av menyen, eller rett under Romkontroll. Da er "Spillinnstillinger" fortsatt øverst.
   - **Alternativ B (aksepter endring):** behold som nå, men dokumenter endringen i internt skriv + intern e-post til ansatte. 15 min trening.
   - **Estimat:** 5 min flytting + 15 min intern melding = 20 min.

2. **TV-display-tokens innsatt mellom Haller og Terminaler:** Forstyrrer muskel-minne for brukere som pleier å klikke "Terminaler" som femte menypunkt.
   - **Fix:** Flytt "TV-display-tokens" til bunnen (etter "Romkontroll") eller rett under "Haller" som understrek.
   - **Estimat:** 5 min.

### P2 (kosmetisk / ikke-blokkerende)
3. **BIN-515 Live hall-kontroll inline i Romkontroll:** Ny boks med 4 nye felter og 4 nye knapper i eksisterende seksjon. Ansatte vil se mer innhold enn før, men ingen eksisterende kontroll er flyttet eller fjernet.
   - **Fix:** Ingen — dette er ny funksjonalitet som må eksponeres et sted. Layout-valg (inline i Romkontroll med grå bakgrunn) er visuelt rimelig.
   - **Estimat:** 0 — la stå.

4. **Muted-tekst i `#section-games` endret:** Fra "Candy styres..." til "Styr spillkatalogen...". Liten tekst-endring, ikke visuell struktur.
   - **Fix:** Ingen — nødvendig endring siden Candy er borte.
   - **Estimat:** 0.

### Totalestimat for P1-fix (minimale flyttinger for å bevare muskel-minne)
**25–30 min**, inkludert:
- Flytt `Dashboard` nav-lenke til bunn
- Flytt `TV-display-tokens` nav-lenke til bunn (eller rett under `Haller` hvis hall-gruppering ønskes)
- Verifiser med screenshot-sammenligning (bruk chrome-devtools-mcp)
- Ingen CSS-endringer, ingen tekst-endringer på eksisterende elementer

---

## Oppsummering

- **CSS: 100 % identisk.** All styling er inline i samme `<style>`-blokk. Farger, font, spacing, grid, breakpoint — alt matcher.
- **Login: 100 % identisk.** Byte-for-byte.
- **Strukturelle forskjeller:** kun 2 nye sidebar-menypunkter (Dashboard, TV-display-tokens) og 1 inline-boks (BIN-515 i Romkontroll). Alle andre 8 seksjoner er identiske med samme `id` og `<h2>`.
- **Candy korrekt fjernet** i henhold til oppdrag.
- **Ingen P0-avvik.** 2 stk P1-avvik handler kun om nav-rekkefølge, løses med 25–30 min arbeid.
