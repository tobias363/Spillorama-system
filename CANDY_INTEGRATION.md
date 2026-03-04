# Integrasjon: Candy -> Multiplayer-skjelett

## Kort status etter gjennomgang

`Candy`-prosjektet er i praksis et lokalt/singleplayer-oppsett med disse kjennetegnene:

- `APIManager.cs` henter tallmønster fra ekstern `slot`-API (`/api/v1/slot?bet=...`).
- `NumberGenerator.cs` genererer kort/tall lokalt og styrer hele runden i klienten.
- `EventManager.cs` er en lokal event-buss uten nettverk/realtime-rom.

Skjelettet i `backend/` er motsatt:

- server-autoritativt rom/spill
- websocket (`Socket.IO`) for state (`room:update`) og trekk (`draw:new`)
- serveren bestemmer billett, trekk, markering og claim-validering

Konklusjon: For ekte multiplayer må spill-logikken flyttes fra `Candy`-klienten til backend (eller beholdes i backend som source of truth), og Unity brukes som presentasjonslag.

## Anbefalt integrasjonsløp

1. Erstatt `APIManager.cs` med `BingoRealtimeClient` (ny Unity-komponent).
2. Koble Unity mot disse socket-eventene:
   - ut: `room:create`, `room:join`, `ticket:mark`, `claim:submit`
   - inn: `room:update`, `draw:new`
3. Bruk `room:update.currentGame.tickets[myPlayerId]` som kortdata i UI (ikke lokal tilfeldig generering).
4. Bruk `room:update.currentGame.drawnNumbers` som fasit for markeringer.
5. Ved klikk på tall i kort: send `ticket:mark` til backend i stedet for lokal markering.
6. Ved gevinstknapp: send `claim:submit` (`LINE`/`BINGO`) og vis resultat fra oppdatert snapshot.

## Hva som bør fjernes/isoleres i Candy

- Lokal startlogikk i `NumberGenerator.StartGame()` som henter slot-data.
- Lokal trekk-generator (`Numbgen`, randomisering av vinnermønster som game-truth).
- Direkte avhengighet til tredjeparts `slot`-API i `APIManager.cs`.

Behold:

- `BallManager` animasjoner
- visuell topper/payline/bonus-presentasjon
- lyd/UI-komponenter

## Backend-støtte lagt til nå

Backend er oppdatert med automatisk rundestart per rom:

- default: ny runde starter automatisk hvert 30. sekund når rommet har minst 2 spillere
- backend håndhever minimum 30 sekunder mellom spillsekvenser
- backend blokkerer samme wallet i flere samtidige aktive spill
- backend støtter opptil 5 bonger per spiller (standard i scheduler: 4)
- backend håndhever tapsgrenser (default 900/dag, 4400/måned) før buy-in
- backend håndhever 5 minutters pause etter 1 time akkumulert spilltid
- konfigureres via env:
  - `BINGO_MIN_ROUND_INTERVAL_MS`
  - `BINGO_DAILY_LOSS_LIMIT`
  - `BINGO_MONTHLY_LOSS_LIMIT`
  - `BINGO_PLAY_SESSION_LIMIT_MS`
  - `BINGO_PAUSE_DURATION_MS`
  - `AUTO_ROUND_START_ENABLED`
  - `AUTO_ROUND_START_INTERVAL_MS`
  - `AUTO_ROUND_MIN_PLAYERS`
  - `AUTO_ROUND_TICKETS_PER_PLAYER`
  - `AUTO_ROUND_ENTRY_FEE`

Compliance-note:

- hvis dere går for norsk databingo i produksjon, sett intervall etter gjeldende krav (ofte minst 30 sek) og avklar med Lotteritilsynet.

Valgfritt:

- `AUTO_DRAW_ENABLED=true` for automatisk talltrekk uten host-klikk
- `AUTO_DRAW_INTERVAL_MS` for trekk-frekvens

## Minimal migrering (lav risiko)

1. La `Candy` fortsatt tegne kort/balls visuelt.
2. Bytt kun datakilde til backend-snapshot.
3. Slå av lokal win-validering og bruk kun `claim:submit`.
4. Flytt bonus/ekstraball til egen server-regel senere (fase 2).

Da får dere multiplayer nå, uten full omskriving av Unity-UI.

## Ny klient lagt inn

Første versjon av realtime-klient er lagt inn i:

- `Candy/Assets/Script/BingoRealtimeClient.cs`

Den støtter:

- Socket.IO-forbindelse mot backend (`/socket.io`)
- reconnect
- ack-baserte kall for `room:create`, `room:join`, `room:state`, `game:start`, `draw:next`, `ticket:mark`, `claim:submit`
- `game:start` støtter `ticketsPerPlayer` (1-5)
- reconnect-støtte via `room:resume` (gjenbruk av samme `playerId` ved ny socket)
- inbound events `room:update` og `draw:new`
- backend-håndtering av ack-respons og reconnect

I tillegg er disse lagt inn:

- `Candy/Assets/Script/BingoRealtimeControls.cs` (valgfri UI-binder for room/player/claim-knapper)
- `Candy/Assets/Script/BingoAutoLogin.cs` (valgfri auto-login mot `/api/auth/login` + automatisk hall-oppslag via `/api/halls`)
- `APIManager.cs` oppdatert til å bruke realtime som default datakilde mot skjelett-backend
- `APIManager.cs` støtter paging av bonger (for eksempel 5 bonger på 4 kortplasser i scenen)
- `UIManager.cs` oppdatert slik at Play-knapp i realtime-modus synker state i stedet for legacy autospin

Kort bruk:

1. Legg `BingoRealtimeClient` på et GameObject i scenen.
2. Sett `Backend Base Url` til backend-serveren deres.
3. Legg `APIManager` i realtime-modus (default), og sett `playerName`, `walletId`, `roomCode` (valgfri).
4. Legg `BingoRealtimeControls` i scenen om dere vil knytte TMP inputfelt + knapper uten ekstra kode.
5. (Valgfritt) Legg `BingoAutoLogin` i scenen og sett e-post/passord for backend-login; den fyller `accessToken`/`hallId` automatisk.
6. Kall `ConnectAndJoin` fra en knapp, eller la `joinOrCreateOnStart` være aktiv for auto-join/create.
