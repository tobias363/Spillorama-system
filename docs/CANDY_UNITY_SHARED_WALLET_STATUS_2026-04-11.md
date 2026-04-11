# Candy + Unity + Shared Wallet Status

**Dato:** 11. april 2026  
**Status:** Gjeldende driftsmodell

Dette dokumentet beskriver hvordan `Spillorama-system`, Unity-lobbyen, de fem opprinnelige Unity-spillene og Candy nå henger sammen.

Dokumentet er skrevet for å fjerne tvil om:

- hva som er native Spillorama/Unity-funksjonalitet
- hva som er Candy som eksternt spillprodukt
- hvordan delt lommebok fungerer
- hva som ligger i `Spillorama-system`
- hva som ligger i `Candy`
- hva som ligger i `demo-backend`

Se også:

- [/Users/tobiashaugen/Projects/Spillorama-system/docs/LIVE_BINGO_CANDY_BOUNDARY_2026-04-09.md](/Users/tobiashaugen/Projects/Spillorama-system/docs/LIVE_BINGO_CANDY_BOUNDARY_2026-04-09.md)
- [/Users/tobiashaugen/Projects/Spillorama-system/docs/CANDY_SPILLORAMA_API_CONTRACT.md](/Users/tobiashaugen/Projects/Spillorama-system/docs/CANDY_SPILLORAMA_API_CONTRACT.md)
- [/Users/tobiashaugen/Projects/Spillorama-system/docs/UNITY_JS_BRIDGE_CONTRACT.md](/Users/tobiashaugen/Projects/Spillorama-system/docs/UNITY_JS_BRIDGE_CONTRACT.md)

## 1. Systemene som finnes

Det finnes tre separate kodebaser:

| System | Lokal mappe | Repo | Ansvar |
|---|---|---|---|
| Spillorama-system | `/Users/tobiashaugen/Projects/Spillorama-system` | `tobias363/Spillorama-system` | live bingo-plattform, auth, wallet, admin, Unity-host og Unity-lobby |
| Candy | `/Users/tobiashaugen/Projects/Candy` | `tobias363/candy-web` | selve Candy-spillet, UI, gameplay og assets |
| demo-backend | `/Users/tobiashaugen/Projects/demo-backend` | `tobias363/demo-backend` | Candy backend, launch-validering, room-engine, scheduler, demo/admin |

Kort sagt:

- `Spillorama-system` eier spilleren
- `Spillorama-system` eier lommeboken
- `Candy` eier selve spillet
- `demo-backend` eier Candy sin backend og drift

## 2. Domener og hva de betyr

| Domene | Path | Eier | Betydning |
|---|---|---|---|
| `https://spillorama-system.onrender.com/` | `/` | `Spillorama-system` | live inngang / portal |
| `https://spillorama-system.onrender.com/admin/` | `/admin/` | `Spillorama-system` | live admin |
| `https://spillorama-system.onrender.com/web/` | `/web/` | `Spillorama-system` | Unity WebGL-host og lobby |
| `https://candy-backend-ldvg.onrender.com/` | `/` | `demo-backend` | Candy backend inngang / demoflate |
| `https://candy-backend-ldvg.onrender.com/admin/` | `/admin/` | `demo-backend` | Candy admin |

## 3. Hvordan Unity og de fem opprinnelige spillene er satt opp

De fem opprinnelige Spillorama-spillene er interne Unity-spill i `Spillorama-system`.

Det betyr:

- de rendres som del av Unity/WebGL-klienten
- de bruker samme autentisering som resten av bingo-systemet
- de bruker samme wallet som resten av bingo-systemet
- de er ikke egne eksterne iframes
- de er ikke egne eksterne backend-produkter

Arkitektur for de fem opprinnelige spillene:

1. Spilleren åpner `/web/`
2. Unity WebGL-host lastes
3. Unity kobler seg til Spillorama sin bingo-runtime
4. Spilleren logger inn i Unity-lobbyen
5. Unity-lobbyen viser de opprinnelige Spillorama-spillene
6. Når spilleren åpner et av disse, skjer det innenfor samme Spillorama/Unity-økosystem

Praktisk er disse spillene "native Spillorama-spill".

## 4. Hvordan Candy er satt opp

Candy er ikke et native Unity-spill i `Spillorama-system`.

Candy er satt opp som:

- et separat spillprodukt
- med egen klient i `Candy`
- med egen backend/runtime i `demo-backend`
- integrert inn i Spillorama-lobbyen som eksternt spill

Candy skal kunne brukes mot flere bingo-leverandører. Derfor ligger Candy-backenden utenfor `Spillorama-system`.

## 5. Hvordan Candy vises i Unity-lobbyen

Candy vises som en egen tile i samme grid som de andre spillene i Unity-lobbyen.

Det betyr at spilleren opplever Candy som del av Spillorama-lobbyen, men teknisk er Candy fortsatt et eksternt produkt.

Flyten er:

1. Spilleren logger inn i Unity-lobbyen på `/web/`
2. Candy vises som en egen tile i samme spillgrid
3. Når spilleren åpner Candy, trigges en launch-flyt via `Spillorama-system`
4. Spillorama utsteder launch mot Candy-backenden
5. Candy lastes i iframe fra `demo-backend`
6. Spilleren spiller Candy i overlay/iframe, ikke som native Unity-scene

## 6. Hvordan Candy launch fungerer

Leverandørsiden for Candy launch ligger i `Spillorama-system`.

Det viktigste endepunktet er:

- [/Users/tobiashaugen/Projects/Spillorama-system/backend/src/index.ts#L1646](/Users/tobiashaugen/Projects/Spillorama-system/backend/src/index.ts#L1646)

Der skjer dette:

1. Spillorama leser autentisert spiller
2. Spillorama henter spillerens `walletId`
3. Spillorama kaller `demo-backend` sin launch-API
4. `demo-backend` returnerer `embedUrl`
5. `/web/`-hosten åpner Candy i iframe

Dette er integrasjonskode, ikke Candy gameplay-kode.

## 7. Hvordan delt lommebok fungerer

Dette er den kritiske delen av integrasjonen.

Candy har ikke egen sannhetskilde for penger i denne modellen. Den bruker Spillorama sin wallet.

Det betyr:

- saldo i Unity-lobby = saldo i Candy
- bruker spilleren penger i Candy, oppdateres samme wallet
- går spilleren tilbake til lobbyen, er samme oppdaterte saldo fortsatt der
- åpner spilleren Candy igjen, får spilleren samme oppdaterte saldo

Leverandørsiden for dette ligger i `Spillorama-system` her:

- [/Users/tobiashaugen/Projects/Spillorama-system/backend/src/index.ts#L169](/Users/tobiashaugen/Projects/Spillorama-system/backend/src/index.ts#L169)

Der eksponeres:

- `GET /api/ext-wallet/balance`
- `POST /api/ext-wallet/debit`
- `POST /api/ext-wallet/credit`

`demo-backend` bruker disse server-til-server.

## 8. Live-verifisering som ble gjort

Følgende ble verifisert i live drift:

- Unity-login på `/web/` fungerer
- Candy kan åpnes fra Unity-lobbyen
- Candy bruker 30 sekunders intervall mellom trekninger
- direkte anonym åpning av Candy er blokkert
- delt lommebok fungerer

Shared wallet ble verifisert slik:

1. spilleren logget inn i Spillorama
2. Candy ble åpnet fra Spillorama
3. saldo inne i Candy matchet saldo i Spillorama
4. spilleren brukte penger i Candy
5. saldo oppdaterte seg
6. samme oppdaterte saldo var der videre når spilleren gikk tilbake til Spillorama

## 9. Hva som faktisk ligger i Spillorama-system

Dette ligger i `Spillorama-system`:

- live auth
- live wallet
- live admin
- live portal
- Unity WebGL-host
- Unity-lobby
- de fem opprinnelige Unity-spillene
- Candy tile i lobbyen
- Candy launch-endepunkt
- leverandørside shared wallet API
- iframe/overlay-launch for Candy fra `/web/`

Dette ligger ikke i `Spillorama-system`:

- Candy gameplay-kode
- Candy UI/assets
- Candy room-engine
- Candy scheduler-logikk
- Candy backend som produkt
- Candy demo-login
- Candy demo-admin
- Candy demo-settings

## 10. Presist svar på spørsmålet om Candy-kode

Spørsmål:

> Er vi fortsatt der hvor Candy ikke har noe kode i `Spillorama-system`? Kun integrasjon med iframe og funksjonaliteten med delt lommebok?

Presist svar:

- `Spillorama-system` har ikke Candy-spillkode
- `Spillorama-system` har ikke Candy-backend
- `Spillorama-system` har ikke Candy demo-login/admin/settings
- `Spillorama-system` har Candy-integrasjonskode

Det betyr at `Spillorama-system` med vilje inneholder:

- launch-integrasjon
- shared wallet bridge
- Unity-lobby-entry for Candy
- iframe/overlay-hosting fra `/web/`

Dette er riktig og ønsket.

Det som fortsatt er strengt separert er:

- Candy gameplay
- Candy klient
- Candy assets
- Candy backend/runtime

## 11. Regler fremover

Bruk disse reglene videre:

- Endring i Unity-lobby, auth, wallet, launch eller `/web/`: `Spillorama-system`
- Endring i Candy gameplay, UI eller assets: `Candy`
- Endring i Candy backend, room-engine, scheduler, demo/admin/settings: `demo-backend`

Kort regel:

- hvis endringen trengs for at Spillorama skal starte og ramme inn Candy riktig, kan den høre hjemme i `Spillorama-system`
- hvis endringen trengs for at Candy som produkt skal fungere, skal den ikke inn i `Spillorama-system`

## 12. Konklusjon

Arkitekturen er nå:

- de fem opprinnelige Spillorama-spillene er native Unity-spill i samme system
- Candy er et separat produkt
- Candy åpnes fra Unity-lobbyen som ekstern iframe-basert integrasjon
- Candy bruker delt wallet fra Spillorama
- Candy har ikke egen KYC i denne modellen
- Candy skal ikke være direkte tilgjengelig for anonyme spillere i integrert drift

Dette er riktig modell hvis Candy skal kunne brukes mot flere forskjellige bingo-leverandører uten å flytte produktlogikken inn i hvert enkelt bingo-system.
