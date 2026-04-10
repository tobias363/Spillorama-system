# Candy Separation and Future Operating Model

Dette dokumentet er den detaljerte redegjørelsen for oppryddingen som ble gjennomført 9. april 2026, og for hvordan Candy skal utvikles videre etter at grensene mellom systemene ble strammet opp.

Hvis dette dokumentet er i konflikt med eldre beskrivelser av `bingo_in_20_3_26_latest`, `backend/public/game`, `backend/src/integration`, Candy demo-login eller Candy wallet-bridge i `Spillorama-system`, er dette dokumentet styrende.

## 1. Målet med oppryddingen

Målet var å få en entydig arkitektur med tre separate kodebaser:

| System | Lokal mappe | GitHub-repo | Eieransvar |
|---|---|---|---|
| Live bingo | `/Users/tobiashaugen/Projects/Spillorama-system` | `tobias363/Spillorama-system` | live portal, live auth, live wallet, live compliance, live admin, live Unity-lobby, live Unity-spill |
| Candy | `/Users/tobiashaugen/Projects/Candy` | `tobias363/candy-web` | selve Candy-klienten, gameplay, UI, assets |
| demo-backend | `/Users/tobiashaugen/Projects/demo-backend` | `tobias363/demo-backend` | Candy backend, demo-login, demo-admin, demo-settings, demo-runtime |

Begrunnelsen for denne delingen er at Candy ikke skal være hardkoblet til ett bingo-system. Candy skal kunne integreres mot flere ulike bingo-leverandører. Derfor skal Candy sin backend og demo-drift ligge i en egen kodebase som eies sentralt av Candy-siden, ikke av den enkelte bingo-leverandøren.

## 2. Hva som ble fjernet fra `Spillorama-system`

Følgende Candy/demo-relaterte områder ble fjernet fra live bingo-repoet:

- `bingo_in_20_3_26_latest/`
- `backend/src/integration/`
- `backend/docs/integration/`
- `backend/public/game/`
- Candy-spesifikke admin-/frontend-referanser
- Candy-spesifikke release-scripts og QA-scripts
- Candy-spesifikke env-navn, metrics-navn og Redis-prefikser
- runtime-støtte for Candy-spesifikk external wallet-provider i live backend

I tillegg ble repoet selv og lokale navn ryddet opp:

- GitHub-repoet ble omdøpt fra `tobias363/bingosystem` til `tobias363/Spillorama-system`
- den lokale arbeidsmappen ble flyttet til `/Users/tobiashaugen/Projects/Spillorama-system`
- `render.yaml` bruker nå tjenestenavnet `spillorama-system`

## 3. Hva som er igjen i `Spillorama-system`

Dette repoet skal nå kun inneholde:

- `frontend/` for live portal og live admin
- `backend/` for live API, auth, wallet, compliance, admin og generisk spillkatalog
- `Spillorama/` for live Unity-lobby og live Unity-spill
- `backend/public/web/` for live Unity WebGL-host
- `backend/public/view-game/` for hall-display / TV-host
- dokumentasjon som forklarer grensen mot Candy og demo-backend

Det er med andre ord lov at Candy nevnes i `.md`-dokumenter når formålet er å forklare grensen mellom systemene. Det er ikke lov at Candy-demo eller Candy-backend kommer tilbake som kjørbar kode, config eller deploy-logikk i dette repoet.

## 4. Verifisering av at repoet er rent

Denne oppryddingen ble verifisert med følgende kontroller:

1. `git status --short`
   Repoet er rent på `main`.
2. `npm run check`
   Typecheck/lint-relatert verifisering passerte.
3. `npm run build`
   Bygget passerte etter oppryddingen.
4. Tekstsøk i ikke-markdown-filer:
   `rg -n --hidden --glob '!node_modules' --glob '!.git' --glob '!backend/dist/**' --glob '!*.md' 'Candy|candy|CANDY|demo-backend|Bingo-system|bingosystem' .`
   Denne ga null treff i kjørbar kode og config.

Konklusjon:

- det finnes ikke lenger Candy/demo-kode i `Spillorama-system`
- det finnes fortsatt bevisste `.md`-referanser som forklarer hva som ble gjort og hvordan grensene fungerer

## 5. Integrasjonsmodellen etter oppryddingen

Dette er flyten vi nå er enige om:

1. Spilleren logger inn i `Spillorama-system`.
2. `Spillorama-system` eier spilleridentitet, wallet og regulatoriske krav for spilleren i dette bingo-systemet.
3. Candy er et eksternt spillprodukt, ikke en del av live bingo-kodebasen.
4. Candy-backenden eies av `demo-backend`.
5. Candy-klienten eies av `Candy`.
6. Når en spiller skal bruke Candy via Spillorama, skjer dette gjennom en integrasjon der spillerens midler fortsatt tilhører leverandørens wallet, mens Candy-spillet og Candy-backenden håndterer sin egen produktlogikk.

Det viktige skillet er dette:

- `Spillorama-system` eier ikke Candy demo-login
- `Spillorama-system` eier ikke Candy demo-admin
- `Spillorama-system` eier ikke Candy demo-settings
- `Spillorama-system` eier ikke Candy runtime-parametre
- `Spillorama-system` eier ikke Candy gameplay-kode

`Spillorama-system` kan fortsatt eie en generisk launch-flyt eller katalogoppføring for et eksternt spill, men det skal ikke eie Candy-spesifikke backendbeslutninger.

## 6. Hva som eies hvor fremover

### 6.1 Endringer som skal gjøres i `Spillorama-system`

Jobb her hvis endringen gjelder:

- live auth
- live wallet
- live compliance
- live portal
- live admin
- live `/web/`
- live `/view-game/`
- live Unity-lobby
- live Unity-spill
- generisk katalog eller generisk launch-flyt for eksterne spill

### 6.2 Endringer som skal gjøres i `Candy`

Jobb i `Candy` hvis endringen gjelder:

- Candy gameplay
- Candy UI
- Candy assets
- Candy animasjoner
- Candy spillregler på klient-siden
- Candy-brukeropplevelse i selve spillet

### 6.3 Endringer som skal gjøres i `demo-backend`

Jobb i `demo-backend` hvis endringen gjelder:

- `https://candy-backend-ldvg.onrender.com/`
- `https://candy-backend-ldvg.onrender.com/admin/`
- demo-login for Candy
- demo-admin for Candy
- Candy settings
- Candy launch-regler
- Candy runtime-konfig
- Candy backend-integrasjoner
- sentral driftslogikk for Candy på tvers av leverandører

## 7. Regler for fremtidig Candy-utvikling

Følgende regler skal gjelde fremover:

1. Candy demo-login bygges ikke i `Spillorama-system`.
2. Candy admin bygges ikke i `Spillorama-system`.
3. Candy settings bygges ikke i `Spillorama-system`.
4. Candy-backend-endringer bygges i `demo-backend`.
5. Candy gameplay-endringer bygges i `Candy`.
6. Hvis en endring bare trengs for at Candy skal fungere, skal den ikke legges i `Spillorama-system`.
7. Hvis en endring bare trengs for at live bingo skal fungere, skal den ikke legges i `Candy` eller `demo-backend`.
8. Delte kontrakter mellom systemene skal dokumenteres eksplisitt, ikke spres som skjult adferd i kode.

## 8. Hvordan ny Candy-funksjonalitet skal leveres

Når det kommer ny Candy-funksjonalitet, skal arbeid deles opp slik:

### Scenario A: Ny spillfunksjon i Candy

Eksempler:

- nytt level-design
- nye assets
- nytt UI i spillet
- nye animasjoner

Riktig sted:

- `Candy`

### Scenario B: Ny backend-regel for Candy

Eksempler:

- nye Candy-settings
- nye launch-parametre
- nytt demo-adminpanel
- ny demo-login-regel
- ny sentral backendlogikk for Candy

Riktig sted:

- `demo-backend`

### Scenario C: Ny integrasjon mellom Spillorama og Candy

Eksempler:

- hvordan en pålogget spiller åpner Candy fra live bingo
- hvordan delt wallet brukes i integrasjonen
- hvordan et generisk spill launch-es fra portal eller lobby

Riktig sted:

- kontraktsendringer dokumenteres først
- deretter implementeres leverandørsiden i `Spillorama-system`
- deretter implementeres Candy-siden i `Candy` og/eller `demo-backend`

Her er hovedregelen:

- leverandørspesifikk del i `Spillorama-system`
- Candy-produktspesifikk del i `Candy` eller `demo-backend`

## 9. Render-status etter oppryddingen

På kode- og repo-nivå er Render-navnet ryddet opp:

- `render.yaml` bruker `name: spillorama-system`
- repoet heter `Spillorama-system`
- lokal mappe heter `Spillorama-system`

Det som fortsatt er historisk er selve live Render-hostnavnet:

- `https://spillorama-system.onrender.com/`

Det hostnavnet styres ikke av repoet alene. Render sine Blueprint-filer styrer tjenestekonfigurasjon og navn, mens domener og subdomene-innstillinger håndteres i Render-plattformen. Se:

- [Blueprint YAML Reference](https://render.com/docs/blueprint-spec)
- [Custom Domains on Render](https://render.com/docs/custom-domains)

Det betyr at selve repoet nå følger planen, men at et eventuelt bytte av offentlig hostname fortsatt krever Render-dashboard eller Render-API med gyldig konto-tilgang.

## 10. Hva som er ferdig, og hva som er gjenstående manuell infrastruktur

Ferdig:

- live repo splittet ut fra Candy/demo
- Candy/demo-kode fjernet fra `Spillorama-system`
- repo og lokal mappe omdøpt til `Spillorama-system`
- `render.yaml` ryddet til `spillorama-system`
- grensen mellom de tre kodebasene dokumentert

Gjenstående manuell infra-handling hvis ønskelig:

- bytte offentlig Render-hostname til en ny canonical adresse eller custom domain
- eventuelt slå av gammel `onrender.com`-adresse etter custom domain-cutover

Dette er en plattformhandling, ikke en kodeendring i repoet.

## 11. Endelig konklusjon

Ja, selve kodebase-splittet følger nå planen:

- `Spillorama-system` inneholder ikke lenger Candy/demo-kode
- Candy-klienten lever i `Candy`
- Candy-backenden lever i `demo-backend`
- dokumentasjon om grensen er bevart i `.md`-filer

Den riktige arbeidsmodellen fremover er derfor:

- utvikle live bingo i `Spillorama-system`
- utvikle Candy-spillet i `Candy`
- utvikle Candy-backend og demo-drift i `demo-backend`

Hvis denne modellen brytes, vil kodebasene igjen begynne å lekke ansvar inn i hverandre. Det skal ikke skje igjen.
