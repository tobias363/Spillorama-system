# Candy Web Rebuild Brief

Dette dokumentet er startpunktet for ny Theme1/Candy-klient i web-stack.

## Mal

- ny app: `candy-web/`
- stack akkurat na: `React + TypeScript + Vite + Zustand`
- renderstrategi: HUD og tekst i DOM/CSS, senere dedikert canvas/WebGL-lag for bonger og ballmaskin
- backend beholdes som eksisterende `Socket.IO`-kontrakt

## Maal

Bygge en ny Candy-klient som:

- er rask a iterere pa
- har tydelig separasjon mellom transport, domain-state og rendering
- gjor det enkelt a endre Theme1 UI uten Unity-scene-koblinger
- kan brukes som web-first klient og senere pakkes i app-wrapper

## Hva som er opprettet

- app-skjelett i `candy-web/`
- første Theme1-shell med ekte kontroll-assets
- enkel lokal mock-state i `candy-web/src/features/theme1/data/theme1MockSnapshot.ts`

## Kilder som skal brukes videre

### Backend / transport

- `backend/src/index.ts`
  Socket-events som ma kartlegges:
  - `room:create`
  - `room:join`
  - `room:resume`
  - `game:start`
  - `draw:next`
  - `draw:new`
  - `ticket:mark`
  - `claim:submit`
  - `room:state`
  - `room:update`

### Theme1 domain / renderlogikk

- `Candy/Assets/Script/Theme1RoundRenderState.cs`
- `Candy/Assets/Script/Theme1DisplayState.cs`
- `Candy/Assets/Script/Theme1StateBuilder.cs`
- `Candy/Assets/Script/Theme1BongRenderUtils.cs`
- `Candy/Assets/Script/APIManager.Theme1RealtimeDedicatedPatterns.cs`
- `Candy/Assets/Script/APIManager.Theme1RealtimeBuildInput.cs`
- `Candy/Assets/Script/NumberGenerator.cs`
- `Candy/Assets/Script/PaylineManager.cs`

### Assets

- `Candy/Assets/Resources/Theme1/Controls/`
- `Candy/Assets/UI/UI_Theme1/`
- `Candy/bilder/baller/`
- `candybakgrunn.png`

## Foerste parallelle arbeidsdeling

### Chat 1

- eier `candy-web/` app-shell
- bygger HUD, layout, board-komponenter og visuell struktur
- setter opp ny render-model og view-state

### Chat 2

- eier kontraktsuttrekk og state-mapping
- lager TypeScript-typer for realtime snapshot/eventer basert pa backend og dagens Unity-klient
- speiler Theme1 render-state i rene TS-interfaces
- bygger adapter: backend snapshot -> web render-model

## Regler for chat 2

- jobb kun i `candy-web/` og `docs/`
- ikke rydd eller refaktor Unity-filer na
- ikke endre backend-wire-format uten eksplisitt behov
- behold navn som er lette a mappe mot dagens Theme1-state

## Konkret oppgave til chat 2

1. Lag `candy-web/src/domain/realtime/contracts.ts`
2. Lag `candy-web/src/domain/theme1/renderModel.ts`
3. Lag `candy-web/src/domain/theme1/mappers/mapRoomSnapshotToTheme1.ts`
4. Dokumenter event-navn og payload-antakelser i `docs/CANDY_WEB_SOCKET_CONTRACT_NOTES.md`

## Definisjon av ferdig for neste steg

- web-appen kan starte lokalt
- mock-state er byttbar med ekte adapter
- Theme1 HUD, topper-strip og board-grid leser bare fra ren TS-state
- chat 2 har produsert event- og snapshot-typer som chat 1 kan koble rett inn
