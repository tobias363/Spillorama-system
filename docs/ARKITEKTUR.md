# Spillorama-system: Arkitektur

**Dato:** 12. april 2026 (oppdatert)
**Status:** Shell-first lobby — Unity kun for gameplay

Dette dokumentet beskriver systemet slik det faktisk er bygget. Det er ment å leses av nye utviklere, konsulenter og revisorer som trenger et startpunkt. Detaljerte kontrakter og implementasjonsguider finnes i egne filer referert til under.

---

## 1. Systemkart

```
Kunde (nettleser)
  |
  +-- HTTPS --> /web/
  |               |
  |               +-- Login/Registrering (auth.js)
  |               +-- Lobby med spillfliser (lobby.js)
  |               +-- Spillvett/profil (spillvett.js)
  |               |
  |               +-- [Ved spillstart] --> Unity WebGL (kun spillmotor)
  |               |
  |               +-- HTTPS --> backend/src/index.ts
  |                               |
  |                               +-- PostgreSQL (brukere, wallet, limits, ledger)
  |                               +-- POST /api/games/candy/launch
  |                                       |
  |                                       +--> Candy-backend (server-til-server)
  |
Candy-backend
  +-- /api/ext-wallet/* --> backend (server-til-server, wallet-bro)
```

Web-shellen eier **hele kundeopplevelsen**: login, registrering, lobby, hallvalg, saldo, Spillvett og profil. Unity lastes **kun når spilleren klikker et spill** — tilsvarende modellen norsk-tipping.no og andre store spillselskaper bruker. AIS legacy-backend fases ut til fordel for Spillorama-backend som eneste backend.

---

## 2. Tre lag

### 2.1 Backend (`backend/src/`)

Source of truth for alle pengebevegelser, regler og spillerkontekst.

| Ansvar | Fil / endepunkt |
|--------|----------------|
| Autentisering | Firebase-basert, `backend/src/index.ts` |
| Wallet (saldo, debit, credit) | `backend/src/index.ts`, `externalGameWallet.ts` |
| Spillegrenser (tapsgrense per hall) | `backend/src/spillevett/` |
| Spillregnskap | `GET /api/spillevett/report` |
| Eksport av spillregnskap | `POST /api/spillevett/report/export` |
| Compliance-data | `GET /api/wallet/me/compliance?hallId=...` |
| Ekstern spilllansering | `POST /api/games/:slug/launch` |
| Wallet-bro for eksterne spill | `GET/POST /api/ext-wallet/*` |

Systemet er **fail-closed**: hvis compliance-tjenesten er utilgjengelig, blokkeres spill.

### 2.2 Web-shell (`backend/public/web/`)

Eier hele kundeopplevelsen. Unity lastes **ikke** ved sideinnlasting — kun når spilleren velger et spill.

| Ansvar | Fil |
|--------|-----|
| Login og registrering | `auth.js` |
| Lobby med spillfliser, hallvalg, saldo | `lobby.js` |
| Profilpanel med Spillvett, hallvelger, spillregnskap | `spillvett.js` |
| Compliance-sjekk (fail-closed) | `spillvett.js` → `complianceAllowsPlay()` + `lobby.js` → `canPlay()` |
| Candy iframe-overlay | `spillvett.js` → `launchCandyOverlay()` |
| On-demand Unity-lasting | `index.html` → `_initUnity()` |

**Flyten:**
1. Bruker åpner `/web/` → ser login/registrering
2. Etter innlogging → lobbyen vises med spillfliser, saldo, hallvalg
3. Bruker klikker et spill → Unity lastes on-demand, spillet startes
4. "Tilbake til lobby"-knapp → Unity skjules, lobbyen vises igjen

### 2.3 Unity WebGL (`Spillorama/`)

**Ren spillmotor.** Lastes kun ved spillstart. Eier ikke login, lobby, konto eller Spillvett.

| Ansvar | Fil |
|--------|-----|
| JS-bro mot host | `UIManager.WebHostBridge.cs` |
| Direkte spilllansering fra host | `LobbyGameSelection.cs` |

**Hva hosten sender til Unity ved spillstart:**
- Auth-token (via `SetShellToken` / sessionStorage)
- Aktiv hall (via `SetActiveHall`)
- Spillnavigasjon (`NavigateSpilloramaGame(gameNumber)`)

**Hva Unity sender tilbake til hosten:**
- Hallbekreftelse (`SetActiveHall`)
- Returnér til lobby (`returnToShellLobby`)

---

## 3. Hallkontekst-flyt

```
1. Spiller logger inn via web shell (auth.js → POST /api/auth/login)
2. Shell → backend: GET /api/halls (henter tilgjengelige haller)
3. Shell → backend: GET /api/wallet/me (henter saldo)
4. Spiller velger hall i shell-lobbyen
5. Shell → backend: GET /api/wallet/me/compliance?hallId=...
6. Shell viser Spillvett og spillregnskap for aktiv hall
7. Spiller klikker spill → Unity lastes on-demand
8. Shell → Unity: SetActiveHall(hallId, hallName) + auth-token via sessionStorage
9. Unity kobler til spillserver med riktig hall og token

Hallbytte (i lobby):
10. Spiller velger ny hall i shell-nedtrekk
11. Shell henter compliance + regnskap for ny hall
12. Hvis Unity kjører: Shell → Unity: SwitchActiveHallFromHost(nyHallId)
```

Hallvalg eies av shellen — Unity mottar hallkontekst fra shellen, ikke omvendt.

---

## 4. Candy-integrasjon

### 4.1 Hva som er på plass

| Del | Status |
|-----|--------|
| Launch-endepunkt `POST /api/games/candy/launch` | Implementert |
| Server-til-server kall til Candy-backend | Implementert |
| Wallet-bro (`/api/ext-wallet/*`) | Implementert |
| Candy-tile i Unity-lobbyen | Implementert |
| Unity kaller `OpenUrlInSameTab("/candy/")` | Implementert |

### 4.2 Kjent gap — iframe-embedding

`CANDY_SPILLORAMA_API_CONTRACT.md` og `UNITY_JS_BRIDGE_CONTRACT.md` beskriver Candy som et iframe-overlay i web-shellen.

**Faktisk nåværende implementasjon i `backend/public/web/index.html`:**
```javascript
function OpenUrlInSameTab(url) {
  existingTab = window.open(url, 'myUniqueTab');  // ← åpner ny fane, ikke iframe
}
```

Candy åpnes fortsatt i egen fane/vindu. iframe-integrasjonen er ikke ferdigstilt.

**Hva som gjenstår:**
- Bytte `OpenUrlInSameTab("/candy/")` til å vise et iframe-overlay i shellen
- Håndtere `postMessage`-protokollen mellom Candy og host (se `CANDY_SPILLORAMA_API_CONTRACT.md` §5)
- Lukke iframe og returnere til lobby etter at Candy avsluttes

### 4.5 Spillvett og compliance i web-shellen

Web-shellen er **eier av all kundevendt ansvarlig-spill-logikk**. Dette er et bevisst designvalg:

- Spillegrenser (netto tapsgrense per hall, dag og måned) håndheves sentralt i backend og vises proaktivt i shellen.
- Spillregnskap hentes via `GET /api/spillevett/report` og vises som kortversjon i sidefeltet og full rapport i skuff.
- Compliance-data (`GET /api/wallet/me/compliance`) inkluderer:
  - Gjenstående tapsgrense (dag/mnd) for aktiv hall — default 900 kr/dag og 4 400 kr/mnd (konfigurerbart via `BINGO_DAILY_LOSS_LIMIT` / `BINGO_MONTHLY_LOSS_LIMIT`)
  - Obligatorisk 5-minutters pause etter 60 min sammenhengende spilling (§ 66) — konfigurert via `BINGO_PLAY_SESSION_LIMIT_MS` og `BINGO_PAUSE_DURATION_MS`
  - Karenstid ved grenseøkning
  - Blokkeringsstatus (`restrictions.isBlocked`, dekker obligatorisk pause, frivillig pause og selvutestengelse)

**Dataflyt ved hallbytte:**
1. Bruker velger ny hall i shellens nedtrekksmeny.
2. `spillvett.js` sender `SwitchActiveHallFromHost(hallId)` til Unity via JS-broen.
3. Unity bekrefter ny aktiv hall med `SetActiveHall(hallId, hallName)`.
4. Shellen gjør ny compliance-fetch med den nye `hallId`.
5. Spillregnskap og grenser oppdateres umiddelbart i UI-et.

Dette sikrer at **hallkontekst og Spillvett alltid er synkronisert** — noe som var umulig da Unity eide hele lobbyen.

---

## 5. Feilhåndtering

Systemet er designet som **fail-closed** på alle compliance-relaterte punkter:

| Scenario | Nåværende oppførsel |
|----------|---------------------|
| Compliance-tjeneste utilgjengelig | Fail-closed: `complianceAllowsPlay()` blokkerer alle spillknapper i shellen |
| Token ikke sendt fra Unity ennå | Shell har ikke hallkontekst — spillknapper er deaktivert |
| Shell-init feiler (nettverksfeil mot backend) | `state.error` settes → spillknapper forblir deaktivert; brukeren ser feilmelding og må refreshe |
| Obligatorisk pause aktiv (60 min spilt) | `restrictions.isBlocked` er `true` → `complianceAllowsPlay()` returnerer `false` → spillknapper deaktivert; shell viser "Obligatorisk pause til HH:MM (§ 66)" |
| Selvutestengelse eller frivillig pause aktiv | `complianceAllowsPlay()` returnerer `false` → spillknapper deaktivert i shellen (backend blokkerer også) |
| Nærmer seg 60 min (>80% av grensen) | Shell viser proaktiv advarsel: "X min igjen til obligatorisk pause (§ 66)" |

Fail-closed gjelder nå både backend-siden og shell-siden. `complianceAllowsPlay()` i `spillvett.js` krever at compliance er hentet og feilfri før spillnavigasjon er mulig.

---

## 6. Gjenstående gap (prioritert)

| Gap | Status | Konsekvens |
|-----|--------|-----------|
| AIS game panel-kobling (Phase 2 del 2) | In progress | Game1Panel/Game2Panel/Game3Panel lytter fortsatt på AIS broadcasts. Må kobles til `SpilloramaSocketManager.OnRoomUpdate` / `OnDrawNew`. |
| AIS socket-credentials transitional | Transitional | `socketUser`/`socketPass` i sessionStorage fjernes når alle game panels er koblet til Spillorama socket |
| Brukermigrasjon AIS → Spillorama | Planlagt | AIS-brukere må importeres til Spillorama PostgreSQL |
| BankID-integrasjon (Phase 3) | Planlagt | Kun basic KYC finnes — full BankID-verifisering mangler |

Lukkede gap:

| Gap | Lukket |
|-----|--------|
| Web shell login/registrering | `auth.js` med login + registrering mot Spillorama backend |
| Shell-first lobby | `lobby.js` med spillfliser, hallvalg, saldo — Unity lastes on-demand |
| Candy iframe-embedding | `launchCandyOverlay()` i `spillvett.js` |
| Shell-init fail-closed | `complianceAllowsPlay()` blokkerer spillknapper |
| **Phase 1: JWT auth-frakobling** | `ReceiveShellToken` i Unity — brukerdata fra Spillorama REST, ikke AIS. `RefreshPlayerWalletFromHost` bruker `GET /api/wallet/me`. `SplashScreenPanel` blokkerer ikke på AIS socket i host-modus. |
| **Phase 2 del 1: Spillorama socket + REST-klient** | `SpilloramaSocketManager.cs` — ny Socket.IO-klient mot Spillorama (JWT i payload, `room:join`/`ticket:mark`/`claim:submit`/`draw:next`). `SpilloramaApiClient.cs` — REST-klient for auth, halls, wallet, compliance, transaksjoner, grenser. Socket kobles automatisk etter `ReceiveShellToken`. `LobbyPanel` joiner rom ved `OnEnable` i host-modus. |

### Phase 2 del 1: nye filer

| Fil | Ansvar |
|-----|--------|
| `Spillorama/Assets/_Project/_Scripts/Manager/SpilloramaApiClient.cs` | REST-klient — erstatter Category A AIS socket-events |
| `Spillorama/Assets/_Project/_Scripts/Socket Manager/SpilloramaSocketManager.cs` | Socket.IO-klient — `room:update`, `draw:new`, emit-API |

### Phase 2 del 2: gjenstående kobling

Disse AIS-broadcastene må erstattes med `SpilloramaSocketManager`-events i game panels:

| AIS BroadcastName | Spillorama-event | Mottaker |
|-------------------|-----------------|----------|
| `WithdrawBingoBall` | `OnDrawNew` | Game1Panel, Game2Panel, Game3Panel |
| `GameStart`, `GameStartWaiting`, `countDownToStartTheGame` | `OnRoomUpdate` (status=IN_PROGRESS) | Alle game panels |
| `GameFinish` | `OnRoomUpdate` (status=FINISHED) | Alle game panels |
| `PatternWin`, `BingoWinning` | `OnRoomUpdate` (claims[]) | Alle game panels |
| `TicketCompleted` | `OnRoomUpdate` (marks[]) | Ticket views |
| `SubscribeRoom` | `room:join` ack + `OnRoomUpdate` | LobbyPanel, game panels |

---

## 7. Utviklingsregler

1. Hvis sluttbrukeren skal se funksjonen som del av lobby, konto, profil eller Spillvett → bygg den i `/web/`-shellen (HTML/JS), **aldri** i Unity.
2. Hvis funksjonen er administrativ → bygg den i `frontend/admin/` eller backend-admin.
3. Hvis funksjonen er del av selve spillopplevelsen (bingo-brett, trekk, chat i spill) → bygges i `Spillorama/` (Unity).
4. Spillorama-backend (`backend/src/`) er **eneste backend** og source of truth for brukere, saldo, grenser og blokkeringer. AIS-backend fases ut.
5. Unity skal **aldri** laste seg selv ved sideinnlasting — kun ved spillstart fra lobbyen.

---

## 8. Relaterte dokumenter

| Dokument | Innhold |
|----------|---------|
| `UNITY_JS_BRIDGE_CONTRACT.md` | Komplett JS-bro-kontrakt mellom Unity og host |
| `CANDY_SPILLORAMA_API_CONTRACT.md` | Launch, wallet-bro, iframe-embedding og postMessage for Candy |
| `SPILLORAMA_LOBBY_ARCHITECTURE_RECOMMENDATION_2026-04-12.md` | Begrunnelse for shell-first-valget |
| `SPILLORAMA_SYSTEM_SCOPE_AND_SOURCE_OF_TRUTH_2026-04-12.md` | Avgrensning av operativt system |
| `UNITY_GAME_ARCHITECTURE_AND_CHANGE_GUIDE_2026-04-11.md` | Endringsguide for Unity-prosjektet |
| `SPILLVETT_HANDOVER_CHECKLIST_2026-04-11.md` | Sjekkliste for Spillvett-levering |
