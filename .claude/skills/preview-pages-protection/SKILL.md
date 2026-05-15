---
name: preview-pages-protection
description: When the user/agent works with the design-preview source files under `packages/game-client/src/{bong-design,kjopsmodal-design,premie-design,dev-overview,preview}/` — eller skal sammenligne prod-komponent mot mockup. Also use when they mention bong-design.html, kjopsmodal-design.html, premie-design.html, dev-overview.html, preview.html, design-locked marker, "designet ble overskrevet", "trippel-bong-design ble byttet ut", "stale built artifact", `apps/backend/public/web/games/`, eller `npm run build:games`. Make sure to use this skill whenever someone touches en av de 5 preview-mappene — ALDRI overskriv preview-source med en mellomstilstand fra prod. Source er kanonisk; prod-komponenter må matche source. CI-gate `.github/workflows/preview-pages-immutable.yml` blokkerer PR uten `[design-locked: YYYY-MM-DD]`-marker.
metadata:
  version: 1.0.0
  project: spillorama
---

<!-- scope: packages/game-client/src/bong-design/, packages/game-client/src/kjopsmodal-design/, packages/game-client/src/premie-design/, packages/game-client/src/dev-overview/, packages/game-client/src/preview/, .github/workflows/preview-pages-immutable.yml -->

# Preview-pages-protection — IMMUTABLE design-source

Tobias-direktiv 2026-05-15 IMMUTABLE: Preview-design-sidene under
`packages/game-client/src/{bong-design,kjopsmodal-design,premie-design,dev-overview,preview}/`
er **kanonisk source** for design-mockups. Agenter som implementerer i prod-komponenter MÅ
lese FRA preview-sidene og kopiere designet 1:1 til prod, **ALDRI** motsatt vei.

> "Tidligere har vi opplevd at agenter har 'reddet' designet ved å overskrive
> preview-source med en mellomstilstand fra prod. Vi skal sette opp permanent
> beskyttelse."
> — Tobias 2026-05-15 (rapportert 2 ganger)

## De 5 preview-sidene

| Fil | Hva | Mockup-side |
|---|---|---|
| `packages/game-client/src/bong-design/bong-design.html` | Spill 1 bong-rendering (single + Trippel Gul) | `/web/bong-design/bong-design.html` |
| `packages/game-client/src/kjopsmodal-design/kjopsmodal-design.html` | BuyPopup Figma-export | `/web/kjopsmodal-design/kjopsmodal-design.html` |
| `packages/game-client/src/premie-design/premie-design.html` | Center-top premie-tabell | `/web/premie-design/premie-design.html` |
| `packages/game-client/src/dev-overview/dev-overview.html` | Utvikler-landingsside (samler alle preview + scenarier) | `/web/dev-overview/dev-overview.html` |
| `packages/game-client/src/preview/preview.html` | Bonus-spill preview | `/web/preview/preview.html` |

Source-filene er kanoniske. `packages/game-client/src/{bong-design,...}/*.ts` er entry-points
som bundles av Vite. `.html` er Tobias-godkjent mockup-spec.

## Build-artifacts (IKKE source)

Når du kjører `npm run build:games`, genererer Vite filer i:

```
apps/backend/public/web/games/{bong-design,kjopsmodal-design,premie-design,dev-overview,preview}/
```

**Disse er gitignored** (se `.gitignore`: `apps/backend/public/web/games/`). De er stale per
default på hver maskin og må rebuildes lokalt. Backend serverer dem via static-handler i
`apps/backend/src/index.ts`.

**Stale-artifact-tegn:** Hvis Tobias rapporterer "designet ser feil ut" og source ser riktig
ut, sjekk om artifact er stale. Kjør `npm run build:games` lokalt og refresh.

## Grunnregel (IKKE OVERSKRIV SOURCE)

> Du leser FRA source, ALDRI skriver til source uten Tobias-godkjenning.

Hvis du implementerer en prod-komponent (`Game1BuyPopup.ts`, `BingoTicketHtml.ts`,
`CenterTopPanel.ts`, etc.) og må sammenligne mot mockup:

✅ **GJØR DETTE:**
- Åpne mockup-HTML i `packages/game-client/src/{folder}/{folder}.html`
- Kopiér eksakte verdier (px, farger, font-weight) til prod-komponent
- Hvis design-spec-doc (`SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md` §5.9) sier annet enn
  mockup → eskaler til PM/Tobias; ikke gjett

❌ **GJØR ALDRI:**
- Endre `.html`/`.ts` i preview-mappene for å "matche prod"
- "Rette opp" en bug i mockup uten Tobias-godkjennelse
- Kopiere design FRA prod TIL mockup
- Tro at stale `apps/backend/public/web/games/*`-artifact er kanonisk

## Hvis du tror designet skal endres

1. **STOP.** Ikke endre noe i preview-mappene.
2. Eskaler til PM med konkret spørsmål: "Mockup viser X, prod viser Y, hvilken er riktig?"
3. PM kontakter Tobias og får muntlig godkjennelse
4. PM oppdaterer preview-source + legger til `[design-locked: YYYY-MM-DD]`-marker i PR-body
5. CI-gate validerer marker og lar PR-en gå gjennom

## CI-gate (permanent forsvar)

`.github/workflows/preview-pages-immutable.yml` håndhever regelen:

| Steg | Hva |
|---|---|
| Trigger | PR mot main som rører `packages/game-client/src/{bong-design,kjopsmodal-design,premie-design,dev-overview,preview}/**` |
| Sjekk | PR-body MÅ ha `[design-locked: YYYY-MM-DD]`-marker (regex: `/\[design-locked:\s*(\d{4}-\d{2}-\d{2})\s*\]/i`) |
| Validering | Marker-dato må være gyldig YYYY-MM-DD, ikke i framtiden, og ≤ 30 dager gammel |
| Resultat | ✅ Pass: PR kan merges normalt. ⛔ Fail: PR blokkeres + bot-kommentar forklarer hvordan løse |

Required check: må passere før merge til main.

## Hvis du ER PM og må endre design

1. Få Tobias' muntlige godkjennelse for design-endringen (vi har ingen formell godkjennings-
   prosess; muntlig OK er nok)
2. Lag branch + endre preview-source-filer
3. I PR-body: skriv `[design-locked: YYYY-MM-DD]` med dagens dato
4. Forklar i PR-body hva som endres + hvorfor (1-2 setninger holder)
5. Merge som normalt — CI-gate aksepterer marker

Eksempel-PR-body:

```markdown
## Summary
Oppdaterer triple-bong-design med ny header-padding per Tobias 2026-05-20.

[design-locked: 2026-05-20]

Endringer:
- `bong-design.html`: header-padding 12px → 14px
- `bong-design.ts`: triple-mode beholder uendret
```

## Anti-mønstre

| ❌ Aldri | ✅ Gjør i stedet |
|---|---|
| "Designet ble byttet ut — la meg fikse mockup" | Sjekk om artifact er stale først (`npm run build:games`). Hvis source er intakt, det er ikke mockup som er feil. |
| "Mockup matcher ikke prod — la meg oppdatere mockup" | Mockup ER kanonisk. Prod må matche mockup, ikke omvendt. |
| "Jeg endrer bare litt i preview-mappa, det går bra" | Nei. CI-gate blokkerer alle endringer uten marker. |
| "Tobias godkjente i går — marker er gyldig 30 dager" | Hvis godkjennelsen var i går: bruk gårsdagens dato i marker, ikke dagens. Eldre godkjennelser krever ny (etter 30 dager). |
| Slette en av de 5 preview-mappene | Ikke gjør det. CI-gate trigges også av delete. |

## Hvordan oppdage stale artifact (vanlig misforståelse)

Hvis Tobias rapporterer "designet er feil":

1. Sjekk source: åpne `packages/game-client/src/{folder}/{folder}.html` direkte
2. Kjør `npm run build:games` lokalt — sjekk om artifact regenereres
3. Refresh nettleser med `Cmd+Shift+R` (hard-refresh, ignorer cache)
4. Åpne dev-tools → Network → sjekk at HTML-en serveres med riktig hash
5. **Først hvis source faktisk er feil:** eskaler til PM (ikke fix i agent-prompten)

## Relaterte skills

- `bong-design` — `BingoTicketHtml.ts` (single + triple) — spec i §5.9
- `buy-popup-design` — `Game1BuyPopup.ts` ticket-purchase-modal
- `spill1-center-top-design` — `CenterTopPanel.ts` premie-tabell

## Relaterte ADR-er

Ingen ADR direkte på dette — CI-gate er en operativ disiplin-mekanisme på linje med
`knowledge-protocol-gate.yml`, ikke en arkitektur-beslutning. Hvis preview-konsept utvides
(eks. ny preview-side for et nytt design), oppdater listen i workflow-en + denne skill-en
samtidig.

## Når oppdatere denne skill

- Hvis ny preview-side legges til (oppdater workflow-en + tabellen ovenfor)
- Hvis Tobias endrer marker-policy (eks. forlenger 30-dagers-gyldighet)
- Hvis bypass-mekanisme blir nødvendig (eks. dependabot-PR som rører preview-deps)

## Endringslogg

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-15 | Initial — etablert etter Tobias-direktiv om permanent beskyttelse av preview-source. | Devops-agent |
