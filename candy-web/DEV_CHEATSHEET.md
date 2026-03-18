# Candy Web Dev Cheatsheet

Kortversjonen for daglig arbeid i `candy-web`.

## Prosjekt

Mappe:

- [/Users/tobiashaugen/Projects/Bingo/candy-web](/Users/tobiashaugen/Projects/Bingo/candy-web)

Full dokumentasjon:

- [README.md](/Users/tobiashaugen/Projects/Bingo/candy-web/README.md)
- [BRANCH_DEPLOY_WORKFLOW.md](/Users/tobiashaugen/Projects/Bingo/docs/BRANCH_DEPLOY_WORKFLOW.md)

## Start lokalt

Installer:

```bash
cd /Users/tobiashaugen/Projects/Bingo
npm --prefix candy-web install
npm --prefix backend install
```

Frontend:

```bash
cd /Users/tobiashaugen/Projects/Bingo
npm --prefix candy-web run dev
```

Backend:

```bash
cd /Users/tobiashaugen/Projects/Bingo
npm --prefix backend run dev
```

## Lokale URL-er

Frontend:

- [http://127.0.0.1:4174/](http://127.0.0.1:4174/)

Animasjonslab:

- [http://127.0.0.1:4174/animation-lab](http://127.0.0.1:4174/animation-lab)

Backend health:

- [http://localhost:4000/health](http://localhost:4000/health)

## Før du pusher

```bash
cd /Users/tobiashaugen/Projects/Bingo
npm --prefix candy-web run check
npm --prefix candy-web run test
npm --prefix candy-web run build
```

Ofte brukt for trekkmaskin:

```bash
cd /Users/tobiashaugen/Projects/Bingo
npm --prefix candy-web run test -- Theme1Playfield.test.ts theme1MachineAnimation.test.ts Theme1AnimationLab.test.ts
```

## Hvilken flate skal du teste i?

Bruk `animation-lab` når du jobber med:

- draw machine
- flying ball
- rail
- timing
- animasjoner

Bruk spillshell når du jobber med:

- launch-token
- room/connect/reconnect
- innsats
- claim/winnings
- markering på bonger

## Viktigste filer

### Scene og UI

- [Theme1Playfield.tsx](/Users/tobiashaugen/Projects/Bingo/candy-web/src/features/theme1/components/Theme1Playfield.tsx)
- [Theme1GameShell.tsx](/Users/tobiashaugen/Projects/Bingo/candy-web/src/features/theme1/components/Theme1GameShell.tsx)
- [global.css](/Users/tobiashaugen/Projects/Bingo/candy-web/src/styles/global.css)

### Trekkmaskin

- [Theme1DrawMachine.tsx](/Users/tobiashaugen/Projects/Bingo/candy-web/src/features/theme1/components/Theme1DrawMachine.tsx)
- [Theme1BallRail.tsx](/Users/tobiashaugen/Projects/Bingo/candy-web/src/features/theme1/components/Theme1BallRail.tsx)
- [Theme1AnimationLab.tsx](/Users/tobiashaugen/Projects/Bingo/candy-web/src/features/theme1-lab/components/Theme1AnimationLab.tsx)

### Live/state

- [useTheme1Store.ts](/Users/tobiashaugen/Projects/Bingo/candy-web/src/features/theme1/hooks/useTheme1Store.ts)
- [client.ts](/Users/tobiashaugen/Projects/Bingo/candy-web/src/domain/realtime/client.ts)
- [contracts.ts](/Users/tobiashaugen/Projects/Bingo/candy-web/src/domain/realtime/contracts.ts)

### Mapping til UI

- [mapRoomSnapshotToTheme1.ts](/Users/tobiashaugen/Projects/Bingo/candy-web/src/domain/theme1/mappers/mapRoomSnapshotToTheme1.ts)
- [renderModel.ts](/Users/tobiashaugen/Projects/Bingo/candy-web/src/domain/theme1/renderModel.ts)

### Mock/demo

- [theme1MockSnapshot.ts](/Users/tobiashaugen/Projects/Bingo/candy-web/src/features/theme1/data/theme1MockSnapshot.ts)

## Staging

Staging health:

- [https://bingosystem-staging.onrender.com/health](https://bingosystem-staging.onrender.com/health)

Candy på staging:

- [https://bingosystem-staging.onrender.com/candy/](https://bingosystem-staging.onrender.com/candy/)

Test live riktig:

1. deploy til `staging`
2. vent til `/health` er grønn
3. start Candy fra portalen
4. bruk den ferske `#lt=...`-lenken

## Deploy

Render deploy hook script:

- [/Users/tobiashaugen/Projects/Bingo/scripts/deploy-backend.sh](/Users/tobiashaugen/Projects/Bingo/scripts/deploy-backend.sh)

Env-fil som faktisk brukes:

- [/Users/tobiashaugen/Projects/Bingo/scripts/release.env](/Users/tobiashaugen/Projects/Bingo/scripts/release.env)

Trigger backend deploy:

```bash
cd /Users/tobiashaugen/Projects/Bingo
npm run deploy:backend
```

## Viktig å huske

- staging serverer ferdigbygd `candy-web` under `/candy/`
- backend-build bygger også `candy-web`
- `candy-web/release.env` er ikke deploy-filen scriptet bruker
- launch-token er engangsbruk
