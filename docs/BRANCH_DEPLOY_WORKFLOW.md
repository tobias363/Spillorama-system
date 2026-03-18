# Branch And Deploy Workflow

Denne filen beskriver hvilken branch som faktisk deployer til staging og production, og hvordan Git skal brukes som source of truth.

## Kortversjon

- jobb alltid på en arbeidsbranch, vanligvis `codex/...`
- push til `staging` hvis endringene skal inn på:
  - [https://bingosystem-staging.onrender.com](https://bingosystem-staging.onrender.com)
- push til `main` hvis endringene skal inn i production
- `codex/*` deployer ikke direkte

## Hvilken branch går hvor?

Basert på faktisk repo-oppsett:

- staging deploy:
  - [deploy-staging.yml](/Users/tobiashaugen/Projects/Bingo/.github/workflows/deploy-staging.yml)
  - trigger på `push` til `staging`
- production deploy:
  - [deploy-production.yml](/Users/tobiashaugen/Projects/Bingo/.github/workflows/deploy-production.yml)
  - trigger på `push` til `main`
- Render staging service:
  - [render.yaml](/Users/tobiashaugen/Projects/Bingo/render.yaml)
  - branch: `staging`

Så i praksis:

- `staging` = branchen som må oppdateres for at endringer skal komme på staging
- `main` = branchen som må oppdateres for at endringer skal komme i production
- `codex/source-of-truth` eller andre `codex/*` = arbeidsbrancher

## Source Of Truth

Git skal være source of truth. Det betyr:

- endringer skal leve i commit-historikken
- staging skal få kode via `git push origin staging`
- production skal få kode via `git push origin main`
- ikke gjør “lokale staging-only” endringer som ikke finnes i Git
- ikke bruk bare manuelle Render deploy hooks uten at riktig commit allerede ligger på riktig branch

Riktig tankegang:

1. lag endringen på arbeidsbranch
2. commit
3. push arbeidsbranch
4. merge til `staging` når du vil oppdatere staging
5. merge til `main` når du vil oppdatere production

## Anbefalt arbeidsflyt

### 1. Lag en arbeidsbranch

Eksempel:

```bash
cd /Users/tobiashaugen/Projects/Bingo
git checkout -b codex/min-endring
```

### 2. Jobb lokalt og test

Frontend:

```bash
cd /Users/tobiashaugen/Projects/Bingo
npm --prefix candy-web run dev
```

Animasjonslab:

- [http://127.0.0.1:4174/animation-lab](http://127.0.0.1:4174/animation-lab)

Kjør minimum:

```bash
cd /Users/tobiashaugen/Projects/Bingo
npm --prefix candy-web run check
npm --prefix candy-web run test
npm --prefix candy-web run build
```

Hvis backend er påvirket:

```bash
cd /Users/tobiashaugen/Projects/Bingo
npm --prefix backend run check
npm --prefix backend run test
npm --prefix backend run build
```

### 3. Commit på arbeidsbranch

```bash
cd /Users/tobiashaugen/Projects/Bingo
git add <filer>
git commit -m "Beskriv endringen"
git push -u origin codex/min-endring
```

### 4. Få endringen til staging

Dette er det viktige punktet:

```bash
cd /Users/tobiashaugen/Projects/Bingo
git checkout staging
git pull origin staging
git merge --no-ff codex/min-endring
git push origin staging
```

Når dette er pushet:

- GitHub Actions workflow `Deploy Staging` trigges
- Render staging deployer ny kode
- staging oppdateres på:
  - [https://bingosystem-staging.onrender.com](https://bingosystem-staging.onrender.com)

### 5. Test staging live

Bekreft først health:

- [https://bingosystem-staging.onrender.com/health](https://bingosystem-staging.onrender.com/health)

Test deretter Candy live fra portalen. Den riktige live-URL-en er under `/candy/` og bruker en fersk launch-token:

- `https://bingosystem-staging.onrender.com/candy/#lt=...`

Eksempelformat:

- [https://bingosystem-staging.onrender.com/candy/#lt=_bTmJtTqJnabxGRocDPHYsvmJnPXJlh3](https://bingosystem-staging.onrender.com/candy/#lt=_bTmJtTqJnabxGRocDPHYsvmJnPXJlh3)

Merk:

- tokenet må være ferskt
- det kommer vanligvis fra portalen
- du bør ikke gjenbruke gammel `#lt=...`

### 6. Få endringen til production

Når staging er godkjent:

```bash
cd /Users/tobiashaugen/Projects/Bingo
git checkout main
git pull origin main
git merge --no-ff staging
git push origin main
```

Da trigges production workflowen.

## Hvorfor `git push` til riktig branch er viktig

Render deploy hook alene er ikke nok.

Deploy hook:

- trigger en deploy av den branchen tjenesten følger
- den sender ikke lokale filer direkte til Render

Så hvis du trigger deploy hook uten å ha pushet committen til riktig branch:

- staging får gammel kode
- Git og live-miljø driver fra hverandre

Det er akkurat dette vi vil unngå.

## Hva du ikke skal gjøre

Ikke:

- jobbe på `codex/*` og tro at staging oppdateres automatisk
- trigge Render deploy hook før koden ligger på `staging`
- redigere staging manuelt uten commit
- la `main` og `staging` drive langt fra hverandre uten plan

## Hvis du vil deploye staging manuelt

Manuell deploy hook finnes, men skal brukes etter at riktig commit allerede er på `staging`.

Script:

- [deploy-backend.sh](/Users/tobiashaugen/Projects/Bingo/scripts/deploy-backend.sh)

Env:

- [release.env](/Users/tobiashaugen/Projects/Bingo/scripts/release.env)

Kjør:

```bash
cd /Users/tobiashaugen/Projects/Bingo
npm run deploy:backend
```

Men husk:

- dette er bare en deploy-trigger
- Git branch er fortsatt source of truth

## Praktisk regel

Hvis spørsmålet er:

- “Hvordan får jeg endringen til staging?”

Svaret er:

- få committen inn på `staging`

Hvis spørsmålet er:

- “Hvordan får jeg endringen til production?”

Svaret er:

- få committen inn på `main`

## Relevante filer

- Render service config:
  - [render.yaml](/Users/tobiashaugen/Projects/Bingo/render.yaml)
- staging deploy workflow:
  - [deploy-staging.yml](/Users/tobiashaugen/Projects/Bingo/.github/workflows/deploy-staging.yml)
- production deploy workflow:
  - [deploy-production.yml](/Users/tobiashaugen/Projects/Bingo/.github/workflows/deploy-production.yml)
- Render/GitHub setup:
  - [RENDER_GITHUB_SETUP.md](/Users/tobiashaugen/Projects/Bingo/docs/RENDER_GITHUB_SETUP.md)
- candy-web docs:
  - [README.md](/Users/tobiashaugen/Projects/Bingo/candy-web/README.md)
  - [DEV_CHEATSHEET.md](/Users/tobiashaugen/Projects/Bingo/candy-web/DEV_CHEATSHEET.md)
