# Arkitekturgjennomgang: Frontend Portal (Historisk Consultant Report)

> Historisk rapport fra perioden før Candy/demo-backend ble skilt ut av `Spillorama-system`.
> Gjeldende repo-grense er dokumentert i [LIVE_BINGO_CANDY_BOUNDARY_2026-04-09.md](/Users/tobiashaugen/Projects/Spillorama-system/docs/LIVE_BINGO_CANDY_BOUNDARY_2026-04-09.md).
> Referanser her til `bingo_in_20_3_26_latest/`, `backend/public/game/index.html` eller Candy-spesifikk wallet-bridge skal leses som historisk analyse, ikke som dagens arkitektur.

Etter å ha byttet ut "Lobby-fikser-hatten" med "Konsulent-brillene", har jeg tatt et dypdykk i selve fundamentet (spesielt `index.html` og samspillet med innlogging). Selv om vi nå har skissert moduler og Alpine.js for å rydde opp i grensesnittet, finnes det **fire dypere tekniske gjeldsposter** som burde adresseres før systemet lanseres til hundretusenvis av betalende spillere.

Her er min vurdering av de mest kritiske områdene dere bør vurdere å utbedre:

## 1. Sikkerhetsrisiko: URL Token Injection (Kritisk)
I bunnen av `index.html` ligger et script som henter ut `?token=...` rett fra adresselinjen og lagrer det i nettleserens `localStorage`.
- **Problemet:** Dette er en klassisk sikkerhetsfelle. Enhver ondsinnet tredjepart som får tak i URL-en (som ofte printes fulltekst i server-logger og nettleserhistorikk) kan kapre sesjonen. Det åpner også for "Token Injection" hvor noen kan lure en spiller til å operere på andres bankkonto.
- **Måten å gjøre det på:** Bruk av HTTP-Only Secure Cookies. Autentisering bør settes fra backend slik at ingen JavaScript-kode engang kan lese tokenet (eliminerer 99% av alle XSS sårbarheter). Hvis URL-autorisering er absolutt nødvendig pga iframe-teknologi, bør det brukes One-Time-Tokens som *veksles inn* mot en cookie, ikke rå-tokens.

## 2. "Hackete" Polling for Auto-Launch (Brittle Logic)
For å autostarte spillet via embed-modus brukes `setInterval` (linje 361 i `index.html`). Koden prøver desperat å sjekke om play-knappen er "klar" 40 ganger før den gir opp.
- **Problemet:** Dette kalles "DOM Polling" og er en anti-pattern. På en rask maskin er alt vel, men på en treig mobil på 3G faller denne ofte fra hverandre fordi knappen ikke rekker å tegne seg før timeouten dreper funksjonen. Da fanger ikke systemet opp klikket, og spillet forblir svart.
- **Måten å gjøre det på:** Applikasjonen må sende ut et signal når den er ferdig initiert, for eksempel `document.dispatchEvent(new Event('bingo:ready'))`. Embed-scriptet lytter bare passivt etter dette ene unike vindkastet.

## 3. Risiko for "Global Scope Pollution"
Variabler blør ut. `window.__EMBED_MODE = true` er satt løst.
- **Problemet:** Dette spiser opp navnerommet i nettleseren. Når man hoster web-spill levert fra andre motorer (Unity/WebGL), kommer det ofte egne globale variabler flyvende. Kollisjoner oppstår ut av det blå.
- **Måten å gjøre det på:** Konfigurasjon bør ligge i DOM'en som standard: `<body data-embed-mode="true">`. Da unngår vi globale "løse kanoner" i scriptene våre. Variablene avleses robust med `document.body.dataset.embedMode`.

## 4. Zero E2E-Testing & Monolittisk CSS
Frontend-koden har pr. nå verken Playwright- eller Cypress-tester. `style.css` har passert 22 KB og begynner å miste all formidabel CSS-arkitektur.
- **Problemet:** Når du skal endre fargen på en knapp i Lobbyen, aner du ikke om det plutselig bryter designet inni Admin-visningen, fordi stilene er sauset sammen. Og uten automatiserte nettlesertester kan deploy-skriptet spinne opp endringer som rett og slett gir blank skjerm.
- **Måten å gjøre det på:** Del opp CSS i moduler (f.eks. `lobby.css`, `admin.css`) og integrer Playwright i CI/CD pipelinen deres som en portvakt. Den logger inn, laster lobbyen virtuelt, og verifiserer at alt vises *før* det shippes til produksjon.

---

## Addendum etter produksjonsfeil 9. april 2026

Etter denne rapporten ble det avdekket en konkret produksjonsfeil i selve Unity-hostingen på den daværende prod-adressen `/web/`. Den feilen lå **ikke** i portalens embed-autostart alene, men i kontrakten mellom host-siden og Unity WebGL-builden. Rapporten bør derfor utvides med følgende punkter:

## 5. Scope må skilles tydeligere: Portal vs Unity Host Page
Denne rapporten beskriver i hovedsak frontend-portalen og embed-flyten i `frontend/index.html`.
- **Problemet:** Det er lett å lese rapporten som om alle funn gjelder lobbyen i produksjon, men lobbyen består i praksis av minst to forskjellige host-miljøer med ulik risikoprofil:
  - `frontend/index.html` for portal/embed-logikk
  - `bingo_in_20_3_26_latest/public/web/index.html` for Unity WebGL-hosting
- **Konsekvens:** Når disse blandes, kan man bruke tid på å rydde embed-polling og globals i portalen, mens den faktiske produksjonsstopperen ligger i Unity-host-siden.
- **Måten å gjøre det på:** Legg inn en egen seksjon tidlig i dokumentet kalt **Scope / Affected Files** som eksplisitt sier hvilke filer og runtime-miljøer hvert funn gjelder.

## 6. Kritisk kontraktsrisiko: Host Page <-> Unity JavaScript Bridge
Unity WebGL-builden forventer at host-siden eksponerer bestemte JavaScript-funksjoner.
- **Problemet:** 9. april 2026 manglet `requestDomainData()` i `/web/index.html`, mens Unity-builden kalte denne funksjonen i startup. Resultatet var en `ReferenceError`, manglende `DomainDataCall(...)` tilbake til GameObject `"Socket And Event Manager"`, og appen ble stående på splash-screen i stedet for å gå til login.
- **Konsekvens:** Selv en korrekt Unity-build kan være ubrukelig i produksjon dersom host-siden ikke matcher forventet JS-bro.
- **Måten å gjøre det på:** Dokumenter alle host-funksjoner Unity forventer som en eksplisitt kontrakt. Minimum:
  - hvilke globale funksjoner Unity kaller
  - hvilke `SendMessage(...)`-mål som må finnes
  - hvilke argumenter som forventes
  - hva som er blokkende hvis host-siden avviker

## 7. Observability mangler i nettleseren
Rapporten peker riktig på manglende E2E-tester, men ikke på manglende runtime-observability i selve host-siden.
- **Problemet:** Når WebGL starter, skjer feilene i skjæringspunktet mellom HTML, loader-script, `SendMessage`, sockets og auth. Uten synlig runtime-logging ender teamet opp med å gjette.
- **Måten å gjøre det på:** Ha en eksplisitt debug-modus i host-siden, for eksempel `?debug=1`, som viser:
  - om Unity loader-scriptet ble lastet
  - om `requestDomainData()` ble kalt
  - om `SendMessage(...)` lyktes
  - om socket-tilkobling faktisk ble opprettet
  - om auth-token ble satt
- **Hvorfor dette er viktig:** Dette gjør at man kan feilsøke i produksjon uten å være avhengig av åpne DevTools eller manuell reproduksjon på én bestemt maskin.

## 8. Release Gate må teste `/web/`, ikke bare generisk frontend
Generiske Playwright-tester er bra, men for denne løsningen er de ikke tilstrekkelige alene.
- **Problemet:** En deploy kan være "grønn" samtidig som `/web/` fortsatt står fast på splash-screen fordi host-siden og Unity-builden ikke matcher.
- **Måten å gjøre det på:** Legg inn en egen release gate for WebGL-lobbyen med minimum disse sjekkene:
  - åpne `/web/`
  - vent på at login-feltene faktisk vises
  - fail testen hvis det oppstår `ReferenceError` eller `unhandledrejection`
  - verifiser at socket-oppstart faktisk skjer
  - verifiser at lobbyen ikke blir stående permanent på splash/loading state

## 9. Unity Build og Host HTML må behandles som ett deploybart sett
I praksis er ikke Unity-builden alene deploybar.
- **Problemet:** `Build/*.unityweb` og host-filen `public/web/index.html` er tett koblet. Endres bare den ene siden, kan produksjon bryte selv om begge delene isolert sett ser riktige ut.
- **Måten å gjøre det på:** Dokumenter og håndhev at disse deployes som ett samlet artifact:
  - Unity WebGL build
  - host `index.html`
  - tilhørende `external-games.js` / auth-bridge / wallet-bridge
  - verifikasjon mot faktisk Render-URL etter deploy

---

## Addendum 2: Kodegjennomgang av frontend-applikasjonen

Etter dypere gjennomgang av `frontend/app.js`, `frontend/index.html` og `backend/public/game/index.html` er følgende nye funn avdekket. Disse utfyller punkt 1–9 og dekker områder som XSS-flate, iframe-sikkerhet, minnehåndtering og nettverkskommunikasjon.

## 10. XSS via innerHTML uten sanitering (Kritisk)
Hele frontend-applikasjonen bruker `innerHTML` med template literals for å bygge UI.
- **Berørte filer:** `frontend/app.js` (linje 1118–1193, 1590–1605, 1650–1693)
- **Problemet:** Brukerdata fra API-responser (spilltitler, spillernavn, wallet-ID-er) settes rett inn i DOM via `innerHTML` uten escaping eller sanitering. Eksempel:
  ```javascript
  `<h3 class="game-showcase-title">${game.title || game.slug}</h3>`
  `<td>${player.name}${host}${me}</td>`
  ```
  En angriper som kompromitterer API-responsen (MITM, kompromittert backend) kan injisere vilkårlig JavaScript.
- **Konsekvens:** Sesjonskapring, tyveri av wallet-tokens, og vilkårlig kodeeksekvering i spillerens nettleser.
- **Måten å gjøre det på:** Bruk `textContent` for ren tekst, eller innfør et saniteringsbibliotek som DOMPurify. Aldri sett ufiltrert brukerdata i `innerHTML`.

## 11. Ubegrenset postMessage til iframes (Kritisk)
Wallet-bridge-kommunikasjonen mellom lobby og spill-iframe bruker wildcard-origin.
- **Berørt fil:** `backend/public/game/index.html` (linje 311)
- **Problemet:** Meldinger sendes med `postMessage({...}, '*')` i stedet for å spesifisere forventet origin. Auth-tokens og wallet-operasjoner (saldo, debit, kredit) sendes i klartekst via denne kanalen.
- **Konsekvens:** Enhver iframe eller vindu som kjører i samme kontekst kan lytte på og fange opp sensitive wallet-transaksjoner og autentiseringstokens.
- **Måten å gjøre det på:** Erstatt `'*'` med den eksplisitte originen til spill-iframen. Valider `event.origin` strengt på mottakersiden. Bruk en nonce eller signatur for å verifisere meldingsintegritet.

## 12. Manglende iframe-sandboxing på betalingsflyt (Høy)
Swedbank checkout-iframen har ingen sikkerhetsbegrensninger.
- **Berørt fil:** `frontend/index.html` (linje 334)
- **Problemet:** Iframen er definert som:
  ```html
  <iframe id="swedbankCheckoutFrame" class="checkout-frame" title="Swedbank checkout"></iframe>
  ```
  Uten `sandbox`-attributt kan innholdet i iframen fritt lese `localStorage` (som inneholder auth-tokens under `bingo.portal.auth`), navigere parent-vinduet, og kjøre vilkårlig JavaScript i lobby-konteksten.
- **Måten å gjøre det på:** Legg til `sandbox="allow-same-origin allow-scripts allow-forms allow-popups"` som minimum. Vurder å isolere betalingsflyten i en egen side/pop-up som ikke deler `localStorage` med lobbyen.

## 13. Svak Content Security Policy (Høy)
CSP-headeren beskytter kun mot framing, ikke mot script-injeksjon.
- **Problemet:** Backend setter kun `frame-ancestors 'self' [allowedOrigins]`. Det finnes ingen `script-src`, `style-src`, `default-src` eller `connect-src` direktiver.
- **Konsekvens:** Selv om framing er begrenset, er det ingenting som hindrer injiserte `<script>`-tagger fra å kjøre vilkårlig kode. Inline scripts i HTML (linje 338–375 i index.html) og eksternt lastet `socket.io.js` er ikke begrenset av noen CSP.
- **Måten å gjøre det på:** Implementer en fullstendig CSP med minimum `default-src 'self'`, `script-src` med nonce-basert allowlisting, og `connect-src` begrenset til kjente API/socket-endepunkter.

## 14. Minnelekkasjer fra event listeners (Høy)
Frontend-applikasjonen legger til event listeners gjentatte ganger uten opprydding.
- **Berørt fil:** `frontend/app.js` (100+ `addEventListener`-kall)
- **Problemet:** Ved hver re-rendering av spillkort, bingo-tickets og modal-elementer legges nye event listeners oppå de gamle. Det finnes ingen `removeEventListener`-kall, ingen `AbortController`-mønster, og ingen ryddehåndtering ved socket-frakobling eller modal-lukking.
- **Konsekvens:** Minnebruken eskalerer over tid. I en lang spilløkt (vanlig for bingo-spillere) kan dette føre til merkbar treghet og til slutt at nettleserfanen krasjer.
- **Måten å gjøre det på:** Bruk `AbortController` med `{ signal }` på event listeners, eller rydd opp eksplisitt med `removeEventListener` før re-rendering. Alternativt: bruk event delegation på stabile parent-elementer.

## 15. Uvaliderte game-launch-URLer (Høy)
Når en spiller starter et eksternt spill, brukes URL-en fra admin-konfigurasjonen direkte.
- **Berørt fil:** `frontend/app.js` (linje 1251–1279)
- **Problemet:** `window.location.assign(targetUrl)` kalles uten noen validering av protokoll eller domene. En ondsinnet admin-bruker kan sette launch-URL til `javascript:...` eller en phishing-side. Auth-tokens legges til i URL-fragmentet og sendes dermed til det vilkårlige domenet.
- **Måten å gjøre det på:** Valider at URL-en bruker `https:`-protokollen. Oppretthold en allowlist over gyldige spill-domener. Aldri send tokens til ukjente domener.

## 16. Uthrottlet DOM-oppdatering på socket-meldinger (Medium)
Sanntidsoppdateringer fra socket-serveren trigger full re-rendering.
- **Berørt fil:** `frontend/app.js`
- **Problemet:** Hver `room:update`-melding fra socket-serveren kaller `renderBingoState()`, som bygger hele bingo-UI-en på nytt via `innerHTML`. Under aktive trekninger kan dette bety 30+ fulle DOM-rewrites per sekund.
- **Konsekvens:** Hakking, høyt CPU-bruk, og dårlig opplevelse spesielt på mobil.
- **Måten å gjøre det på:** Debounce oppdateringer (maks 2–3 per sekund for visuell oppdatering), eller bruk inkrementell DOM-oppdatering som kun endrer det som faktisk har forandret seg.

## 17. Mangelfull reconnect-håndtering (Medium)
Ved socket-frakobling ryddes ikke gammel tilstand.
- **Berørt fil:** `frontend/app.js` (linje 2461–2481)
- **Problemet:** Disconnect-handleren oppdaterer kun UI-tekst til "Frakoblet server". Den rydder ikke gammel spilltilstand, verifiserer ikke om tokenet fortsatt er gyldig, og håndterer ikke race conditions ved reconnect.
- **Konsekvens:** Etter reconnect kan spilleren sitte med utgått token som gir uventede feil midt i spillet.
- **Måten å gjøre det på:** Ved reconnect: valider token, re-hent spilltilstand, og rydd eventuelle stale listeners/timers.

## 18. Token lagret i localStorage uten utløpshåndtering (Medium)
Auth-tokenet lagres permanent i `localStorage` og overlever lukking av nettleserfanen.
- **Berørte filer:** `frontend/index.html` (linje 346), `frontend/app.js` (linje 541–566)
- **Problemet:** `localStorage` er tilgjengelig for all JavaScript på samme origin — inkludert injisert kode via XSS (punkt 10). Tokenet har ingen klientside-sjekk på utløpstid, og brukeren får ingen advarsel før det utløper.
- **Konsekvens:** Kombinert med XSS-sårbarheten gir dette angripere langvarig tilgang. Brukeren kan også starte et spill, for så å oppleve uventet feil midt i runden når tokenet utløper.
- **Måten å gjøre det på:** Bruk `sessionStorage` (ryddes ved tab-lukking) eller kun in-memory. Vis advarsel 5 minutter før utløp. Implementer automatisk re-autentisering eller utlogging.

---

## Anbefalt tillegg i rapporten
For å gjøre dokumentet mer presist bør rapporten få en kort sluttseksjon med tre tydelige operasjonelle lærdommer:
- **Skill mellom portal og Unity-hosting.** De er to forskjellige systemer med ulike failure modes.
- **Test den faktiske produksjonsruten `/web/`.** Ikke stol på at "frontend bygget" betyr at lobbyen virker.
- **Bygg debug inn i host-siden.** Når WebGL, HTML og auth møtes, er synlig runtime-logging en nødvendighet, ikke en luksus.

---

## 19. Mangelfull Token Expiry Håndtering (API-lag) (Høy)
Selve nettverkslaget `api()` i app.js mangler interceptors.
- **Berørt fil:** `frontend/app.js` (funksjonen `api()`)
- **Problemet:** Koden sender `Bearer token`, men sjekker aldri om serveren svarer med `HTTP 401 Unauthorized`. Hvis backend-sesjonen er utløpt, krasjer applikasjonen med uforståelige JSON-parse feil i stedet for å logge ut brukeren på en pen måte.
- **Måten å gjøre det på:** Bygg inn en sjekk `if (response.status === 401)` i `api()` som tømmer `localStorage`, sletter `state.user` og omdirigerer spilleren direkte tilbake til innloggingsbildet.

## 20. Ubeskyttet WebSocket-initialisering (Medium)
Socket.io-forbindelsen opprettes blindt på rot-nivået i applikasjonen.
- **Berørt fil:** `frontend/app.js` (Linje 3: `const socket = io();`)
- **Problemet:** Socket-forbindelsen opprettes straks HTMLen er lastet, helt uten noe `auth`-payload. Backend reagerer uansett. Siden det ikke finnes et auth-handshake, er socket-serveren sårbar for Connection Exhaustion (tusenvis av fiendtlige, tomme klienter som holder web-sockets åpne og tømmer RAM).
- **Måten å gjøre det på:** Vent med å ringe `io()` (eller oppdater `.auth` property) til *etter* brukeren har en gyldig innlogging, slik at serveren kun godtar åpne websockets for faktiske spillere.

## 21. Hardkodet Lokaliseringsfelle (i18n) (Lav/Skaleringsrisiko)
Bingo-portalen er språklig sementert i filene.
- **Berørte filer:** Alle UI-rendere i `app.js` og `index.html`
- **Problemet:** Ord som "Trukne tall", "Overfør penger" og feilmeldinger er hardkodet hundrevis av steder. Den dagen `Nordic-profil` eller bingoen skal lanseres i Sverige eller i Europa, skaper dette et massivt re-write prosjekt.
- **Måten å gjøre det på:** Begynn å overføre tekst-strenger inn i en `translations.json` (eller i et eget i18n-objekt med Alpine) slik at grensesnittet bruker variabler `text('lobby.drawn_numbers')` fremfor hardkodet norsk.

---

## Prioritert handlingsplan

| Prioritet | Punkt | Tiltak | Estimert innsats |
|-----------|-------|--------|-----------------|
| P0 — Blokkerende | 10. innerHTML XSS | Innfør DOMPurify eller bruk textContent | 1–2 dager |
| P0 — Blokkerende | 11. postMessage wildcard | Sett eksplisitt origin, valider avsender | 0.5 dag |
| P0 — Blokkerende | 1. URL Token Injection | Migrer til HTTP-Only cookies eller OTT | 2–3 dager |
| P1 — Kritisk | 12. iframe sandbox | Legg til sandbox-attributt på Swedbank-iframe | 1 time |
| P1 — Kritisk | 13. CSP | Implementer fullstendig CSP med nonce | 1–2 dager |
| P1 — Kritisk | 15. Uvaliderte launch-URLer | Protokoll- og domene-validering | 0.5 dag |
| P1 — Kritisk | 6. JS Bridge-kontrakt | Dokumenter og verifiser Unity host-funksjoner | 1 dag |
| P2 — Høy | 19. Token Expiry (401) | La `api()` håndtere HTTP 401 ved å tvinge logout | 0.5 dag |
| P2 — Høy | 14. Minnelekkasjer | AbortController / event delegation | 2–3 dager |
| P2 — Høy | 18. Token-lagring | Migrer til sessionStorage + utløpsvarsel | 1 dag |
| P2 — Høy | 8. Release gate for /web/ | Playwright-sjekk mot WebGL-lobby | 1–2 dager |
| P3 — Medium | 20. Ubeskyttet WebSocket | Legg ved token i `io({ auth: ... })` | 0.5 dag |
| P3 — Medium | 16. DOM throttling | Debounce room:update til maks 3/s | 0.5 dag |
| P3 — Medium | 17. Reconnect-håndtering | Token-validering og state-reset ved reconnect | 1 dag |
| P3 — Medium | 2. DOM Polling | Erstatt setInterval med event-basert signalering | 0.5 dag |
| P3 — Medium | 3. Global scope | Flytt til data-attributter | 0.5 dag |
| P3 — Medium | 4. CSS & E2E | Split CSS + Playwright i CI/CD | 3–5 dager |
| P4 — Skalering | 21. Hardkodet Norsk | Innfør oversettelsesmekanisme (i18n) | Pågående |
