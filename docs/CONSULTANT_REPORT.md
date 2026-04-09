# Arkitekturgjennomgang: Frontend Portal (Senior Consultant Report)

Etter å ha byttet ut "Lobby-fikser-hatten" med "Konsulent-brillene", har jeg tatt et dypdykk i selve fundamentet (spesielt `index.html` og samspillet med innlogging). Selv om vi nå har skissert moduler og Alpine.js for å rydde opp i grensesnittet, finnes det **fire dypere tekniske gjeldsposter** som burde adresseres før systemet lanseres til hundretusenvis av betalende spillere.

Her er min vurdering av de mest kritiske områdene dere bør vurdere å utbedre:

## 1. Sikkerhetsrisiko: URL Token Injection (Kritisk)
I bunnen av `index.html` ligger et script som henter ut `?token=...` rett fra adresselinjen og lagrer det i nettleserens `localStorage`.
- **Problemet:** Dette er en klassisk sikkerhetsfelle. Enhver ondsinnet tredjepart som får tak i URL-en (som ofte printes fulltekst i server-logger og nettleserhistorikk) kan kapre sesjonen. Det åpner også for "Token Injection" hvor noen kan lure en spiller til å operere på andres bankkonto.
- **Måten å gjøre det på:** Bruk av HTTP-Only Secure Cookies. Autentisering bør settes fra backend slik at ingen JavaScript-kode engang kan lese tokenet (eliminerer 99% av alle XSS sårbarheter). Hvis URL-autorisering er absolutt nødvendig pga iframe-teknologi, bør det brukes One-Time-Tokens som *veksles inn* mot en cookie, ikke rå-tokens.

## 2. "Hackete" Polling for Auto-Launch (Brittle Logic)
For å autostarte Candy-spillet via embed-modus brukes `setInterval` (linje 361 i `index.html`). Koden prøver desperat å sjekke om knappen `#candyPlayBtn` er "klar" 40 ganger før den gir opp.
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
