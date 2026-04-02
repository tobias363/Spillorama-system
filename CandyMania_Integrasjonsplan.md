# CandyMania Integrasjonsplan for Spillorama

**Dato:** 2. april 2026
**Status:** Kritisk — eksisterende bingospill laster ikke etter feilaktig Candy-integrasjon
**Mål:** Integrer CandyMania via iframe uten å bryte eksisterende spill

---

## Bakgrunn

CandyMania er et nytt minispill som skal integreres i Spillorama-lobbyen. Per integrasjonsspesifikasjonen (Candy_Integrasjon_Leverandor_v3.pdf) skal Candy leveres som en URL som legges i en iframe — samme mønster som andre spill. CandyMania har en egen backend (candy-backend) som kjører på Render, og et ferdigbygd React-frontend som allerede ligger i `/public/candy/`.

Noen la inn en hardkodet HTML-overlay (`#candy-tile`) oppå Unity-canvasen i lobbyen. Denne overlayen med z-index:1000 blokkerer klikk på Unity-canvasen og forhindrer at bingospillene laster. **Overlayen er nå fjernet**, men ytterligere arbeid trengs for å fullføre en korrekt integrasjon.

---

## Systemarkitektur (nåværende)

### Tjenester på Render

| Tjeneste | URL | Kilde |
|---|---|---|
| bingo-system | bingo-system-jsso.onrender.com | `bingo_in_20_3_26_latest/` |
| candy-backend | candy-backend-ldvg.onrender.com | `backend/` |

### Nøkkelfiler

| Fil | Funksjon |
|---|---|
| `public/web/index.html` | Unity WebGL lobby (Spillorama v8.1) |
| `public/view-game/index.html` | Bingo TV-skjerm / spillvisning (SpilloramaTv v7.1) |
| `public/candy/index.html` | CandyWeb React-app (Vite build) |
| `public/candy-game/index.html` | **NY** — iframe-wrapper for Candy (opprettet, må verifiseres) |
| `Boot/Server.js` linje 182 | `express.static('./public')` — serverer alt under `/public/` |
| `Game/Common/Sockets/common.js` | Socket.IO events for spilltyper |
| `Game/Common/Controllers/GameController.js` | `getGameTypeList()` — henter spilltyper fra MongoDB |
| `App/Models/gameType.js` | Mongoose-modell for spilltyper i databasen |

### Hvordan spill fungerer i dag

1. **Lobby laster:** Unity WebGL-appen laster i `/web/index.html`
2. **Spilltyper hentes:** Unity sender Socket.IO event `"GameTypeList"` → serveren henter fra `gameType`-collection i MongoDB → returnerer navn og bilde
3. **Spiller velger spill:** Unity viser spillfliser basert på data fra MongoDB
4. **Spill åpnes:** Unity kaller JavaScript-funksjonen `OpenUrlInSameTab(url)` som åpner spillet i en ny fane
5. **Spillvindu:** `view-game/index.html` laster bingo-Unity-bygget (SpilloramaTv) og validerer token via `/validateGameView`

```
[Unity Lobby /web/]
    → Socket.IO "GameTypeList"
    → MongoDB gameType collection
    → Unity viser fliser
    → Bruker klikker
    → OpenUrlInSameTab(url)
    → Ny fane åpnes med spillet
```

### OpenUrlInSameTab-funksjonen (web/index.html linje 206)

```javascript
let existingTab = null;
function OpenUrlInSameTab(url) {
  if (existingTab && !existingTab.closed) {
    existingTab.focus();
  } else {
    existingTab = window.open(url, 'myUniqueTab');
  }
}
```

Denne funksjonen kalles direkte fra Unity C#-koden via jslib-interop.

---

## Hva som er gjort

1. **candy-backend** er deployet på Render med PostgreSQL-database (candy-db)
2. **CandyWeb** React-appen er bygget og ligger i `/public/candy/` — peker mot `candy-backend-ldvg.onrender.com`
3. **Overlayen er fjernet** fra `web/index.html` (all `#candy-tile` CSS og HTML er slettet)
4. **`/public/candy-game/index.html`** er opprettet — en enkel side som laster `/candy/` i en fullskjerms iframe med en "Tilbake til lobby"-knapp

---

## Hva som gjenstår (utvikleroppgaver)

### Oppgave 1: Verifiser at bingospillene laster igjen

**Prioritet:** KRITISK
**Fil:** `public/web/index.html`

Etter at overlayen ble fjernet bør Unity-lobbyen laste normalt igjen. Verifiser dette:

1. Gå til `https://bingo-system-jsso.onrender.com/web/`
2. Logg inn og sjekk at lobby laster med alle spillfliser (bingo, etc.)
3. Klikk på et bingospill og verifiser at det åpnes i ny fane via `OpenUrlInSameTab`
4. Sjekk nettleserens console for JavaScript-feil

**Hvis det fortsatt ikke fungerer:** Sjekk om det er andre endringer i `web/index.html` som kan ha blitt introdusert. Sammenlign med siste fungerende versjon i git (`git diff` på filen).

### Oppgave 2: Legg til CandyMania som spilltype i MongoDB

**Prioritet:** Høy
**Kontekst:** Spilltyper defineres i `gameType`-collection i MongoDB

Unity henter spilltyper via Socket.IO-eventet `"GameTypeList"`. Controlleren `Game/Common/Controllers/GameController.js` (linje 266-293) henter fra databasen og returnerer `name` og `img`.

For at CandyMania skal dukke opp som en flis i lobbyen, må du:

1. Legg til et nytt dokument i `gameType`-collectionen via admin-panelet eller direkte i MongoDB:

```javascript
{
  name: "CandyMania",
  type: "candy",           // unik slug
  photo: "candy-thumb.png", // bilde for flisen (last opp via admin)
  pattern: false,
  row: "0",
  columns: "0",
  totalNoTickets: "0",
  userMaxTickets: "0"
}
```

2. Dersom admin-panelet har en "Game Types"-seksjon (sjekk under `/admin/`), bruk den til å legge til CandyMania med et passende bilde.

### Oppgave 3: Koble CandyMania-flisen til riktig URL i Unity

**Prioritet:** Høy
**Kontekst:** Unity-koden bestemmer hvilken URL som åpnes for hver spilltype

Når en bruker klikker på CandyMania-flisen i Unity, må Unity kalle:

```csharp
// I Unity C# (via jslib)
OpenUrlInSameTab("/candy-game/");
```

Dette krever en endring i **Unity-prosjektet** (C#-koden). Finn hvor spilltype-klikk håndteres og legg til en betingelse:

```
Hvis gameType.type == "candy" → OpenUrlInSameTab("/candy-game/")
Ellers → eksisterende logikk (åpne bingospill via token-basert URL)
```

**Alternativ uten Unity-endring:** Hvis det er mulig å definere URL per spilltype i databasen (sjekk om `gameType`-modellen kan utvides med et `url`-felt), kan Unity lese URL-en fra dataene og bruke den direkte. Da slipper man å oppdatere Unity-bygget.

For å utvide modellen, legg til i `App/Models/gameType.js`:

```javascript
externalUrl: {
    type: 'string',
    default: ''
}
```

Og oppdater `getGameTypeList()` i `Game/Common/Controllers/GameController.js` (linje 269-271) til å inkludere `externalUrl`:

```javascript
const gameTypes = await Sys.Game.Common.Services.GameServices.getListData(
    {},
    { name: 1, photo: 1, externalUrl: 1, _id: 0 }
);

const gameList = gameTypes.map(({ name, photo, externalUrl }) => ({
    name,
    img: resolveImageUrl(photo),
    externalUrl: externalUrl || ''
}));
```

Da kan Unity sjekke om `externalUrl` finnes og åpne den direkte med `OpenUrlInSameTab`.

### Oppgave 4: Verifiser candy-game iframe-wrapper

**Prioritet:** Middels
**Fil:** `public/candy-game/index.html`

Filen er allerede opprettet og laster `/candy/` i en iframe. Test den:

1. Gå til `https://bingo-system-jsso.onrender.com/candy-game/`
2. Verifiser at CandyWeb-appen laster inne i iframen
3. Verifiser at "Tilbake til lobby"-knappen fungerer
4. Test på mobil — iframen skal fylle hele skjermen

Hvis `/candy/`-appen har problemer med å kjøre i en iframe (f.eks. X-Frame-Options), sjekk at candy-backend ikke setter restriktive headers.

### Oppgave 5: Koble Wallet API mellom bingo-system og candy-backend

**Prioritet:** Middels (kan gjøres etter at integrasjonen fungerer visuelt)
**Kontekst:** Candy_Integrasjon_Leverandor_v3.pdf

For at CandyMania skal kunne trekke/legge til penger på spillerens konto, trenger candy-backend tilgang til Spilloramas wallet:

1. **Saldo-endepunkt (GET):** candy-backend kaller Spilloramas API for å hente saldo
2. **Debit-endepunkt (POST):** candy-backend kaller for å trekke penger (innsats)
3. **Credit-endepunkt (POST):** candy-backend kaller for å kreditere gevinst

Disse endepunktene må opprettes i bingo-system (`App/Routes/`) og konfigureres i candy-backends miljøvariabler (`WALLET_PROVIDER`, `WALLET_API_URL`, etc.).

Krav fra spesifikasjonen: idempotent-nøkkel på debit/credit, synkron respons, feilkode ved lav saldo.

### Oppgave 6: Deploy og test end-to-end

**Prioritet:** Høy

1. Commit endringene og push til riktig branch
2. Verifiser at Render bygger og deployer bingo-system uten feil
3. Test hele flyten:
   - Logg inn i lobbyen
   - Verifiser at alle bingospill fungerer som før
   - Verifiser at CandyMania-flisen vises (etter Oppgave 2+3)
   - Klikk på CandyMania → verifiser at iframe-siden åpnes
   - Gå tilbake til lobbyen → verifiser at lobbyen laster

---

## Oppsummering av prioritert rekkefølge

1. **Verifiser at bingospill fungerer igjen** (blokkerer alt annet)
2. **Legg til CandyMania i databasen** + **Koble til Unity** (krever enten Unity-endring eller database-utvidelse)
3. **Test iframe-wrapper** og fiks eventuelle problemer
4. **Wallet API-integrasjon** (kan gjøres parallelt)
5. **End-to-end test og deploy**

---

## Teknisk kontekstinformasjon

- **Node.js server:** Express med Nunjucks templates, Socket.IO
- **Database:** MongoDB (spilldata, brukere, spilltyper) + PostgreSQL (candy-backend)
- **Unity:** WebGL build v8.1, kommuniserer via Socket.IO og JavaScript-bridge
- **Deploy:** Render.com, konfigurasjon i `render.yaml`
- **Branches:** bingo-system bruker `deploy/render-setup`, candy-backend bruker `staging`
