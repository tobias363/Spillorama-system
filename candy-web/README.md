# Candy Web

`candy-web` er den nye React/Vite-klienten for Candy-spillet i dette repoet.

For kortversjonen med bare kommandoer, URL-er og viktigste filer, se:

- [DEV_CHEATSHEET.md](/Users/tobiashaugen/Projects/Bingo/candy-web/DEV_CHEATSHEET.md)

For branch/deploy-reglene som faktisk styrer staging og production, se:

- [BRANCH_DEPLOY_WORKFLOW.md](/Users/tobiashaugen/Projects/Bingo/docs/BRANCH_DEPLOY_WORKFLOW.md)

Den brukes på to måter:

- lokalt som egen frontend for utvikling og animasjonstesting
- live via backend, som serverer den ferdigbygde frontend-en under `/candy/`

I staging er det derfor ikke `candy-web` som deployes som egen Render-service. Backend bygger `candy-web`, legger resultatet i `candy-web/dist`, og serverer den på:

- [https://bingosystem-staging.onrender.com/candy/](https://bingosystem-staging.onrender.com/candy/)

## Kom i gang på 5 minutter

Hvis du er ny i prosjektet, gjør dette:

```bash
cd /Users/tobiashaugen/Projects/Bingo
npm --prefix candy-web install
npm --prefix backend install
npm --prefix backend run dev
```

I en ny terminal:

```bash
cd /Users/tobiashaugen/Projects/Bingo
npm --prefix candy-web run dev
```

Åpne deretter:

- spillshell: [http://127.0.0.1:4174/](http://127.0.0.1:4174/)
- animasjonslab: [http://127.0.0.1:4174/animation-lab](http://127.0.0.1:4174/animation-lab)

Kjør kvalitetssjekker før du pusher:

```bash
cd /Users/tobiashaugen/Projects/Bingo
npm --prefix candy-web run check
npm --prefix candy-web run test
npm --prefix candy-web run build
```

Hvis du skal teste live på staging etter deploy:

1. få endringene inn på `staging`
2. vent til [https://bingosystem-staging.onrender.com/health](https://bingosystem-staging.onrender.com/health) er grønn
3. start Candy fra portalen
4. test den ferske staging-lenken under `/candy/#lt=...`

## Hva prosjektet består av

`candy-web` har i praksis fire lag:

1. transport/realtime
   - socket/io + backend-kontrakter
2. domene/render-model
   - snapshot inn, Theme1 render-state ut
3. React-komponenter
   - spillscene, bonger, topprad, maskin, HUD
4. styling/assets
   - CSS, sprites, bakgrunner, shell-elementer

Hvis du tenker i denne rekkefølgen er det lettere å gjøre endringer uten å skape sideeffekter.

## Struktur

Viktigste filer:

- app entry: [/Users/tobiashaugen/Projects/Bingo/candy-web/src/app/App.tsx](/Users/tobiashaugen/Projects/Bingo/candy-web/src/app/App.tsx)
- live spillshell: [/Users/tobiashaugen/Projects/Bingo/candy-web/src/features/theme1/components/Theme1GameShell.tsx](/Users/tobiashaugen/Projects/Bingo/candy-web/src/features/theme1/components/Theme1GameShell.tsx)
- realtime/store: [/Users/tobiashaugen/Projects/Bingo/candy-web/src/features/theme1/hooks/useTheme1Store.ts](/Users/tobiashaugen/Projects/Bingo/candy-web/src/features/theme1/hooks/useTheme1Store.ts)
- realtime-klient: [/Users/tobiashaugen/Projects/Bingo/candy-web/src/domain/realtime/client.ts](/Users/tobiashaugen/Projects/Bingo/candy-web/src/domain/realtime/client.ts)
- snapshot -> render-model: [/Users/tobiashaugen/Projects/Bingo/candy-web/src/domain/theme1/mappers/mapRoomSnapshotToTheme1.ts](/Users/tobiashaugen/Projects/Bingo/candy-web/src/domain/theme1/mappers/mapRoomSnapshotToTheme1.ts)
- render-modeltyper: [/Users/tobiashaugen/Projects/Bingo/candy-web/src/domain/theme1/renderModel.ts](/Users/tobiashaugen/Projects/Bingo/candy-web/src/domain/theme1/renderModel.ts)
- spillscene/playfield: [/Users/tobiashaugen/Projects/Bingo/candy-web/src/features/theme1/components/Theme1Playfield.tsx](/Users/tobiashaugen/Projects/Bingo/candy-web/src/features/theme1/components/Theme1Playfield.tsx)
- trekkmaskin: [/Users/tobiashaugen/Projects/Bingo/candy-web/src/features/theme1/components/Theme1DrawMachine.tsx](/Users/tobiashaugen/Projects/Bingo/candy-web/src/features/theme1/components/Theme1DrawMachine.tsx)
- ball-rail: [/Users/tobiashaugen/Projects/Bingo/candy-web/src/features/theme1/components/Theme1BallRail.tsx](/Users/tobiashaugen/Projects/Bingo/candy-web/src/features/theme1/components/Theme1BallRail.tsx)
- connection-panel: [/Users/tobiashaugen/Projects/Bingo/candy-web/src/features/theme1/components/Theme1ConnectionPanel.tsx](/Users/tobiashaugen/Projects/Bingo/candy-web/src/features/theme1/components/Theme1ConnectionPanel.tsx)
- lokal animasjonslab: [/Users/tobiashaugen/Projects/Bingo/candy-web/src/features/theme1-lab/components/Theme1AnimationLab.tsx](/Users/tobiashaugen/Projects/Bingo/candy-web/src/features/theme1-lab/components/Theme1AnimationLab.tsx)
- globale stiler: [/Users/tobiashaugen/Projects/Bingo/candy-web/src/styles/global.css](/Users/tobiashaugen/Projects/Bingo/candy-web/src/styles/global.css)
- Vite-konfig: [/Users/tobiashaugen/Projects/Bingo/candy-web/vite.config.ts](/Users/tobiashaugen/Projects/Bingo/candy-web/vite.config.ts)

## Hvor du endrer hva

Dette er den delen nye utviklere vanligvis trenger.

### 1. Hvis du vil endre visuell layout

Start her:

- [/Users/tobiashaugen/Projects/Bingo/candy-web/src/styles/global.css](/Users/tobiashaugen/Projects/Bingo/candy-web/src/styles/global.css)

Typiske ting:

- bonger
- topp-strip
- HUD
- spacing
- fontstørrelser
- candy-shells og gradients

### 2. Hvis du vil endre selve spillscenen

Start her:

- [/Users/tobiashaugen/Projects/Bingo/candy-web/src/features/theme1/components/Theme1Playfield.tsx](/Users/tobiashaugen/Projects/Bingo/candy-web/src/features/theme1/components/Theme1Playfield.tsx)

Typiske ting:

- plassering av bonger
- countdown-panel
- ball-rail
- flying ball / draw-flow
- celebration-lag

### 3. Hvis du vil endre trekkmaskin-animasjonen

Start her:

- [/Users/tobiashaugen/Projects/Bingo/candy-web/src/features/theme1/components/Theme1Playfield.tsx](/Users/tobiashaugen/Projects/Bingo/candy-web/src/features/theme1/components/Theme1Playfield.tsx)
- [/Users/tobiashaugen/Projects/Bingo/candy-web/src/features/theme1/components/Theme1DrawMachine.tsx](/Users/tobiashaugen/Projects/Bingo/candy-web/src/features/theme1/components/Theme1DrawMachine.tsx)
- [/Users/tobiashaugen/Projects/Bingo/candy-web/src/features/theme1/components/Theme1BallRail.tsx](/Users/tobiashaugen/Projects/Bingo/candy-web/src/features/theme1/components/Theme1BallRail.tsx)

Test alltid dette i:

- [http://127.0.0.1:4174/animation-lab](http://127.0.0.1:4174/animation-lab)

Ikke test nye animasjonstweaks direkte i staging først.

### 4. Hvis du vil endre live gameplay / socketflyt

Start her:

- [/Users/tobiashaugen/Projects/Bingo/candy-web/src/features/theme1/hooks/useTheme1Store.ts](/Users/tobiashaugen/Projects/Bingo/candy-web/src/features/theme1/hooks/useTheme1Store.ts)
- [/Users/tobiashaugen/Projects/Bingo/candy-web/src/domain/realtime/client.ts](/Users/tobiashaugen/Projects/Bingo/candy-web/src/domain/realtime/client.ts)
- [/Users/tobiashaugen/Projects/Bingo/candy-web/src/domain/realtime/contracts.ts](/Users/tobiashaugen/Projects/Bingo/candy-web/src/domain/realtime/contracts.ts)

Typiske ting:

- launch-token resolve
- room:create / room:resume / room:update
- reconnect
- innsats / reroll / arm

### 5. Hvis du vil endre hvordan backend-snapshot blir vist i UI

Start her:

- [/Users/tobiashaugen/Projects/Bingo/candy-web/src/domain/theme1/mappers/mapRoomSnapshotToTheme1.ts](/Users/tobiashaugen/Projects/Bingo/candy-web/src/domain/theme1/mappers/mapRoomSnapshotToTheme1.ts)
- [/Users/tobiashaugen/Projects/Bingo/candy-web/src/domain/theme1/renderModel.ts](/Users/tobiashaugen/Projects/Bingo/candy-web/src/domain/theme1/renderModel.ts)

Typiske ting:

- completed patterns
- one to go
- winnings
- saldo / gevinst / innsats
- hvordan en bong skal se ut i ulike tilstander

### 6. Hvis du vil endre lokale demo-/mockdata

Start her:

- [/Users/tobiashaugen/Projects/Bingo/candy-web/src/features/theme1/data/theme1MockSnapshot.ts](/Users/tobiashaugen/Projects/Bingo/candy-web/src/features/theme1/data/theme1MockSnapshot.ts)

Bra for:

- layouttesting
- bongdata
- toppers
- lokale scenarier uten backend

## Krav

- Node.js
- npm

Repoet bruker npm-lockfiler, så bruk `npm`, ikke `pnpm` eller `yarn`.

## Installer

Fra repo-roten:

```bash
cd /Users/tobiashaugen/Projects/Bingo
npm --prefix candy-web install
```

Hvis du også skal kjøre backend lokalt:

```bash
npm --prefix backend install
```

## Lokal utvikling

### Kun frontend

Start Vite:

```bash
cd /Users/tobiashaugen/Projects/Bingo
npm --prefix candy-web run dev
```

Standardport i konfig er:

- [http://127.0.0.1:4174](http://127.0.0.1:4174)

Hvis porten er opptatt, kan Vite velge en annen ledig port. Se terminalutskriften.

### Viktige lokale views

- spillshell: [http://127.0.0.1:4174/](http://127.0.0.1:4174/)
- animasjonslab: [http://127.0.0.1:4174/animation-lab](http://127.0.0.1:4174/animation-lab)

Animasjonslaben er tryggest når du skal jobbe med:

- trekkmaskin
- rail/baller
- timing
- visuelle animasjoner

Den bruker dagens sceneoppsett, men uten live gameplay som kan forstyrre testingen.

### Frontend + backend lokalt

Start backend:

```bash
cd /Users/tobiashaugen/Projects/Bingo
npm --prefix backend run dev
```

Backend kjører da normalt på:

- [http://localhost:4000](http://localhost:4000)

Health:

- [http://localhost:4000/health](http://localhost:4000/health)

Kjør så frontend i egen terminal:

```bash
cd /Users/tobiashaugen/Projects/Bingo
npm --prefix candy-web run dev
```

### Når du bør bruke hva

Bruk `animation-lab` når du jobber med:

- draw machine
- baller og rail
- timing
- visuelle effekter

Bruk spillshellet når du jobber med:

- connection state
- launch-token
- live room
- innsats og reroll
- markering, gevinster og claims

## Kvalitetssjekker

### Typecheck

```bash
cd /Users/tobiashaugen/Projects/Bingo
npm --prefix candy-web run check
```

### Tester

Alle tester:

```bash
cd /Users/tobiashaugen/Projects/Bingo
npm --prefix candy-web run test
```

Ofte brukt under arbeid på trekkmaskin:

```bash
cd /Users/tobiashaugen/Projects/Bingo
npm --prefix candy-web run test -- Theme1Playfield.test.ts theme1MachineAnimation.test.ts Theme1AnimationLab.test.ts
```

Ofte brukt under arbeid på live/state:

```bash
cd /Users/tobiashaugen/Projects/Bingo
npm --prefix candy-web run test -- Theme1GameShell.test.ts theme1LiveSync.test.ts
```

### Produksjonsbuild

```bash
cd /Users/tobiashaugen/Projects/Bingo
npm --prefix candy-web run build
```

Merk:

- Vite bygger med `base: "/candy/"` i produksjon
- det er riktig fordi backend serverer frontend-en under `/candy/`

## Hvordan staging faktisk serverer candy-web

Backend bygger `candy-web` som del av backend-builden:

- [/Users/tobiashaugen/Projects/Bingo/backend/package.json](/Users/tobiashaugen/Projects/Bingo/backend/package.json)

`backend`-buildscriptet kjører:

```bash
npm --prefix ../candy-web run build
```

Deretter serveres frontend-en fra:

- `candy-web/dist`

Dette kobles i backend her:

- [/Users/tobiashaugen/Projects/Bingo/backend/src/index.ts](/Users/tobiashaugen/Projects/Bingo/backend/src/index.ts)

Relevant:

- `candyWebFrontendDir = path.resolve(projectDir, "candy-web/dist")`
- statisk serving under `/candy`
- HTML fallback for `/candy`, `/candy/` og `/candy/*`

## Render deploy

### Hvordan staging deployer

Render-konfigen ligger i:

- [/Users/tobiashaugen/Projects/Bingo/render.yaml](/Users/tobiashaugen/Projects/Bingo/render.yaml)

Staging-service:

- navn: `bingosystem-staging`
- branch: `staging`
- build command: `npm --prefix backend run build`
- start command: `npm --prefix backend run start`
- health path: `/health`

Det betyr:

- når `staging` deployes, bygges backend
- backend-builden bygger også `candy-web`
- staging serverer deretter ny `candy-web` på `/candy/`

### Vanlig deploymåte

Den enkleste måten er:

1. commit endringer
2. push til `staging`
3. la Render auto-deploye
4. vent til health er grønn

Eksempel:

```bash
cd /Users/tobiashaugen/Projects/Bingo
git checkout staging
git pull
git merge <din-branch>
git push origin staging
```

Etter push:

1. se at Render starter deploy
2. vent til [https://bingosystem-staging.onrender.com/health](https://bingosystem-staging.onrender.com/health) svarer grønt
3. test deretter live Candy fra portalen

### Deploy hook

Repoet har også et manuelt backend deploy-script:

- [/Users/tobiashaugen/Projects/Bingo/scripts/deploy-backend.sh](/Users/tobiashaugen/Projects/Bingo/scripts/deploy-backend.sh)

Det leser:

- [/Users/tobiashaugen/Projects/Bingo/scripts/release.env](/Users/tobiashaugen/Projects/Bingo/scripts/release.env)

Ikke:

- `candy-web/release.env`

Hvis du vil bruke deploy-hook lokalt, opprett:

```bash
cp /Users/tobiashaugen/Projects/Bingo/scripts/release.env.example /Users/tobiashaugen/Projects/Bingo/scripts/release.env
```

Minimalt innhold:

```env
RENDER_DEPLOY_HOOK_URL=https://api.render.com/deploy/...
RENDER_HEALTHCHECK_URL=https://bingosystem-staging.onrender.com/health
RENDER_DEPLOY_WAIT_FOR_HEALTH=true
RENDER_DEPLOY_REQUIRE_HOOK=true
```

Trigger deretter deploy:

```bash
cd /Users/tobiashaugen/Projects/Bingo
npm run deploy:backend
```

Dette:

- trigger Render deploy hook
- venter på grønn `/health` hvis aktivert

## Hvordan teste live på staging

### Viktig

Candy-staging testes ikke ved å åpne `/candy/` direkte alene hvis du vil ha live spillerkontekst. Normal flyt er:

1. portalen ber backend om launch-token
2. backend lager en engangslenke
3. klienten åpnes med `#lt=...`
4. `candy-web` kaller `/api/games/candy/launch-resolve`

Launch-token er engangsbasert og kan utløpe.

### Riktig live testflyt

1. Deploy ny kode til staging.
2. Bekreft health:
   - [https://bingosystem-staging.onrender.com/health](https://bingosystem-staging.onrender.com/health)
3. Start Candy fra portalen.
4. Portalen åpner en staging-lenke som ligner:
   - `https://bingosystem-staging.onrender.com/candy/#lt=...`
5. Test derfra som vanlig bruker.

Det er denne flyten som gir deg:

- riktig spillerkontekst
- riktig hall
- riktig wallet
- riktig realtime-room
- ekte launch-token

Eksempel på staging-URL-format:

- [https://bingosystem-staging.onrender.com/candy/#lt=_bTmJtTqJnabxGRocDPHYsvmJnPXJlh3](https://bingosystem-staging.onrender.com/candy/#lt=_bTmJtTqJnabxGRocDPHYsvmJnPXJlh3)

Merk:

- token i eksempelet kan være brukt eller utløpt
- for ekte test må du vanligvis starte en ny Candy-økt fra portalen og bruke den ferske linken

## Lokal testing med portal-launch-link

Hvis du vil teste lokalt med samme engangs-token-format som staging:

1. start Candy fra portalen
2. kopier hele staging-lenken med `#lt=...`
3. bytt bare hosten til lokal Vite-server

Eksempel:

```text
https://bingosystem-staging.onrender.com/candy/#lt=ABC123
```

blir:

```text
http://127.0.0.1:4174/#lt=ABC123
```

Dette virker bare hvis tokenet ikke allerede er brukt opp på staging først.

## Praktisk arbeidsflyt for endringer

En trygg standardflyt er:

1. Gjør endringen i `candy-web`
2. Test i riktig flate:
   - animasjon: `/animation-lab`
   - live/logikk: spillshell
3. Kjør:
   - `check`
   - relevante tester
   - `build`
4. Hvis endringen påvirker staging:
   - få den inn på `staging`
   - vent på grønn `/health`
   - test med fersk portal-lenke

Et godt minimum før push er:

```bash
cd /Users/tobiashaugen/Projects/Bingo
npm --prefix candy-web run check
npm --prefix candy-web run test
npm --prefix candy-web run build
```

## Feilsøking

### Lokal frontend starter ikke

Sjekk:

- at `npm --prefix candy-web install` er kjørt
- at port `4174` ikke er blokkert
- at du faktisk åpner den porten Vite skriver i terminalen

### Staging viser gammel frontend

Sjekk:

- at endringen faktisk kom til `staging`
- at Render deployet ferdig
- at `/health` er grønn
- hard refresh i nettleseren

### Live test åpner, men kommer ikke inn i spill

Sjekk:

- at lenken har fersk `#lt=...`
- at token ikke allerede ble brukt opp
- at du startet fra portalen og ikke bare åpnet gammel URL på nytt

### Lokal test med staging-token feiler

Sjekk:

- at du ikke åpnet staging-lenken først
- at du byttet host til lokal Vite før første åpning

## Anbefalt arbeidsflyt

### UI/animasjon

Bruk:

- [http://127.0.0.1:4174/animation-lab](http://127.0.0.1:4174/animation-lab)

Dette er riktig sted for:

- maskin-animasjon
- rail-plassering
- timing
- visuelle effekter

### Live gameplay/logikk

Bruk:

- lokal backend + lokal frontend
- eller staging etter deploy

Dette er riktig sted for:

- launch-token
- romtilkobling
- innsats
- winnings/claims
- reconnect

## Vanlige feil

### 1. Staging viser ikke ny frontend

Sjekk:

- at du faktisk deployet `staging`
- at Render health er grønn
- at backend-build faktisk kjørte
- hard refresh i nettleser

### 2. Launch-token virker ikke

Vanlige årsaker:

- tokenet er brukt opp
- tokenet er utløpt
- du åpnet staging-lenken først og prøvde deretter lokal lenke med samme token

Løsning:

- start spillet på nytt fra portalen og bruk fersk lenke

### 3. `candy-web/release.env` brukes ikke

Deploy-scriptet leser:

- [/Users/tobiashaugen/Projects/Bingo/scripts/release.env](/Users/tobiashaugen/Projects/Bingo/scripts/release.env)

Ikke:

- [/Users/tobiashaugen/Projects/Bingo/candy-web/release.env](/Users/tobiashaugen/Projects/Bingo/candy-web/release.env)

## Nyttige kommandoer

Fra repo-roten:

```bash
# frontend dev
npm --prefix candy-web run dev

# frontend typecheck
npm --prefix candy-web run check

# frontend test
npm --prefix candy-web run test

# frontend build
npm --prefix candy-web run build

# backend dev
npm --prefix backend run dev

# backend build (bygger også candy-web først)
npm --prefix backend run build

# trigger backend deploy hook
npm run deploy:backend
```

## Kort oppsummering

- utvikle visuelt i `candy-web`
- test animasjoner i `/animation-lab`
- test ekte liveflyt via backend og launch-token
- deploy staging ved å få ny kode til `staging`
- staging serverer ferdig `candy-web` på `/candy/`
- test live med en fersk portal-lenke med `#lt=...`
- bruk `Theme1Playfield.tsx`, `Theme1DrawMachine.tsx`, `Theme1BallRail.tsx` for trekkmaskin og animasjon
- bruk `useTheme1Store.ts` og `mapRoomSnapshotToTheme1.ts` for liveflyt og spillstate
