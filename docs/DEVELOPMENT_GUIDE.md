# CandyMania — Utviklerguide

## Arkitektur

```
candy-web/src/
  domain/theme1/                    ← Ren logikk (ingen React)
    applyTheme1DrawPresentation.ts  ← Ball → board marking
    mappers/
      mapRoomSnapshotToTheme1.ts    ← Server snapshot → render model
      theme1TicketResolution.ts     ← Ticket source (currentGame/preRound/empty)
    renderModel.ts                  ← TypeScript types for render state
    theme1MachineAnimation.ts       ← Maskin-timing konstanter

  features/theme1/
    hooks/
      useTheme1Store.ts             ← Zustand state (hovedfil)
      theme1LiveSync.ts             ← Sync helpers + types
    components/
      Theme1GameShell.tsx           ← Hovedcontainer, countdown, board clearing
      Theme1Playfield.tsx           ← Ball flight animation (RAF)
      Theme1DrawMachine.tsx         ← Globe + maskinanimasjon
      Theme1BoardGrid.tsx           ← Bong-rendering

backend/src/
  game/
    BingoEngine.ts                  ← Spillmotor, rom, trekk, gevinst
    ticket.ts                       ← 3x5 ticket-generering
  index.ts                          ← Express server, Socket.IO, API
  platform/PlatformService.ts       ← DB, auth, game catalog
```

## Lokal utvikling

### Start
```bash
./scripts/dev.sh
```
Backend: http://localhost:4000 | Frontend: http://localhost:4174

### Manuell start
```bash
# Terminal 1
cd backend && ADMIN_BOOTSTRAP_SECRET=dev npm run dev

# Terminal 2
cd candy-web && VITE_CANDY_API_BASE_URL=http://127.0.0.1:4000 npm run dev
```

### Admin-panel
http://localhost:4000/admin/ — `test@test.no` / `test1234`

### Første gang
```bash
# Opprett bruker + promoter til admin
curl -s http://127.0.0.1:4000/api/auth/register -X POST \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.no","password":"test1234","displayName":"Test"}'

curl -s http://127.0.0.1:4000/api/admin/bootstrap -X POST \
  -H "Content-Type: application/json" \
  -d '{"secret":"dev","email":"test@test.no","password":"test1234"}'
```

### Wallet
`.env` har `WALLET_PROVIDER=postgres`. House wallet må finnes:
```sql
INSERT INTO wallet_accounts (id, balance)
VALUES ('house-hall-default-databingo-internet', 100000)
ON CONFLICT (id) DO NOTHING;
```

## Tester

```bash
# candy-web (alle tester)
cd candy-web && npx vitest run

# Backend
cd backend && npm test

# Ball animation soak test
npm run test:ball-animation -- --draws=100
```

## Viktige regler

### 1. Ball-beskyttelse: kun ÉN mekanisme
`drawPresentationActiveUntilMs` i runtime-state er den eneste timeren som styrer om `room:update` kan overskrive visuell ball-state. Ikke legg til nye guards — endre denne.

### 2. Ingen debug-logging i commits
Bruk DevTools for debugging. `console.log("[BIN-134]...")` linjer skal aldri committes. Produksjonskode har kun `console.error` for runtime-feil.

### 3. Kjør tester før commit
```bash
cd candy-web && npx vitest run
cd backend && npm test
```

### 4. Ball-animasjon i integrated-live
Floating-ball og output-ball er gated bort i `integrated-live` modus (Theme1DrawMachine.tsx). Kulene vises kun i ball rail via Theme1Playfield flight-animasjon. Ikke re-introduser maskinball-lag i live — det forårsaker doble baller.

### 5. Board marks
- `applyPendingDrawPresentation` (draw:new): sjekker `isCurrentPlayerArmed` — marks kun med aktiv innsats
- `applyLiveSnapshot` (room:update): bruker `ticketSource === "currentGame"` — IKKE armed-sjekk (server har allerede korrekte marks)

### 6. Tickets mellom runder
`resolvePlayerContext` i `theme1TicketResolution.ts` bruker `currentGame.tickets` også når status er FINISHED/ENDED (så lenge `preRoundTickets` ikke finnes). Bonger tømmes ikke mellom runder.

## Endringsprosess

| Hva du vil endre | Fil(er) |
|-----------------|---------|
| Bong-tall/layout | `backend/src/game/ticket.ts` |
| Board-markeringer | `applyTheme1DrawPresentation.ts` + `useTheme1Store.ts` |
| Ball-animasjon | `Theme1Playfield.tsx` (flight) + `Theme1DrawMachine.tsx` (maskin) |
| Innsats/betting | `useTheme1Store.ts` (toggleBetArm, changeStake) |
| Gevinst-regler | `BingoEngine.ts` (claim, payout) |
| Countdown/timer | `Theme1GameShell.tsx` (scheduler countdown) |
| Lobby-tile | `bingo_in_20_3_26_latest/public/web/external-games.js` |
| Admin-innstillinger | `backend/src/index.ts` (candy-mania settings endpoints) |

## Deploy
```bash
./scripts/deploy.sh
```
Bygger, tester, viser git-kommandoer. Render deployer automatisk etter push til main.
