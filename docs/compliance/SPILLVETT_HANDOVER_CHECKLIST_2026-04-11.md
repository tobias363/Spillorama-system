# Spillvett Handover og Sjekkliste

**Dato:** 11. april 2026  
**Prosjekt:** Spillorama-system  
**Område:** Spillvett, spillegrenser, spillregnskap og eksport i host-shellen rundt `/web/`

## Status

Denne leveransen er funksjonelt klar for gjennomgang i `Spillorama-system`.

Kundevendt flate for denne leveransen er `/web/`-hosten og shellen rundt Unity, ikke portal-UI-et i `frontend/` og ikke et eget Unity-panel for Spillvett.

Følgende er implementert:

- Spillvett synlig i host-shellen rundt Unity på `/web/`
- spillregnskap tilgjengelig fra Spillvett-panelet i web-shellen
- hallbasert visning av grenser og spillregnskap
- aktiv hall kan nå velges i web-shellen og styrer hva som vises i Spillvett
- Unitys kundevendte hallvelger er skjult i WebGL slik at hallkontekst eies av shellen
- host-shellens spillknapper åpner spill direkte uten å vise Unitys game-selection-panel som mellomsteg
- retur til lobby i WebGL går til shell-first tilstand i stedet for å åpne Unitys game-selection som standard
- når `LobbyPanel` åpnes i WebGL lukkes Unity-lobbybarn automatisk slik at shellen forblir primær kundeflate
- sporing av innsats, premier og netto per hall
- detaljvisning av spill, referanser og bokførte hendelser
- PDF-eksport av spillregnskap
- vedvarende lagring i Postgres for ansvarlighetsdata og spillregnskap
- data overlever backend-restart
- frivillig pause og selvutestenging er beholdt
- obligatorisk 5-minutters pause etter 1 times spill er aktiv igjen i kode og persisteres over restart
- spillegrenser på `900 kr/dag` og `4 400 kr/mnd` per hall er implementert med netto-beregning i spillmotoren
- grenseblokkering ved overskridelse er implementert i buy-in-/spillflyten, slik at spilleren ikke får levert ny innsats når tapsgrensen ville blitt overskredet

Følgende er delvis implementert eller må inn før produksjon:

- karenstid ved økning av grenser er implementert per hall: daglig økning blir ventende til neste lokale døgn, månedlig økning til neste lokale måned
- visuell fremdriftsbar og fargekoding for gjenstående grense er implementert i host-shellen
- kortversjon av grenser og spillregnskap vises nå direkte i web-shellen rundt Unity; eget separat dashbord utenfor lobbyen er ikke nødvendig for kundeflaten
- varsel/status for pålagt pause vises i Spillvett-statusen, inkludert siste pausehall og tapsoversikt

## Hva som er verifisert

Følgende er kjørt og verifisert:

- `npm --prefix backend run check`
- `npm --prefix backend test`
- manuell restart av backend
- reell innlogging i browser
- visuell kontroll av Spillvett-oppsummering i host-shellen
- visuell kontroll av fremdriftsbar/fargekoding i web-shellen
- hallbytte i header
- kontroll av spillregnskap i web-shellen per hall
- PDF-eksport etter restart

Manuell kontroll som ble gjennomført:

- `hall-default`: innsats `10 kr`, premier `4 kr`, netto `-6 kr`
- `hall-east`: innsats `7 kr`, premier `3 kr`, netto `-4 kr`

Tallene var identiske før og etter backend-restart.

## Gjenstående miljøkrav

Selve systemet er klart, men e-postsending av PDF krever SMTP-konfigurasjon.

Må settes i miljø:

- `REPORT_EXPORT_EMAIL_FROM`
- enten `REPORT_EXPORT_SMTP_URL`
- eller:
- `REPORT_EXPORT_SMTP_HOST`
- `REPORT_EXPORT_SMTP_PORT`
- `REPORT_EXPORT_SMTP_USER`
- `REPORT_EXPORT_SMTP_PASS`
- valgfritt `REPORT_EXPORT_SMTP_SECURE`
- valgfritt `REPORT_EXPORT_EMAIL_REPLY_TO`

Uten dette virker fortsatt nedlasting av PDF, men `Send PDF på e-post` vil returnere en tydelig konfigurasjonsfeil.

## Enkel smoke-test for prosjektleder

1. Logg inn som spiller.
2. Velg `Default hall` i hallvelgeren i web-shellen.
3. Bekreft at Spillvett-kortet er synlig i host-shellen rundt Unity.
4. Åpne spillregnskapet fra Spillvett-panelet og bekreft at innsats, premier, netto og detaljtabeller vises.
5. Bytt til en annen aktiv hall i web-shellen og bekreft at Unity følger etter.
6. Bekreft at tallene i spillregnskapet endrer seg per hall.
7. Trykk `Last ned PDF` og bekreft at PDF lastes ned.
8. Trykk `Send PDF på e-post` kun etter at SMTP er konfigurert.
9. Sjekk at grenseinformasjon vises i web-shellen for valgt hall.
10. Test endring av grense og bekreft at dagens løsning lagrer ny grense per hall.
11. Spill til grensen er nådd og bekreft at videre innsats blir stoppet i spillflyten.
12. Spill i 60+ minutter og bekreft at 5-minutters pause trigges og at spill blokkeres til pausen er utløpt.
13. Bytt hall i shellen og bekreft at både grenser, regnskap og aktiv hall i Unity oppdateres korrekt.

## Viktige avklaringer

- grenser og spillregnskap er per hall
- samme spiller kan være registrert i flere haller
- spilleren kan bruke aktiv hall i headeren for å se og bruke korrekt hallkontekst
- frivillig pause er tillatt
- obligatorisk pause er lovpålagt og er nå aktiv i kode med persistert play-state
- selvutestenging er fortsatt aktiv funksjonalitet
- korrekt pausekrav er **5 minutters pause etter 1 times spill**, ikke pause "etter 5 minutter"

## Compliance og Lotteritilsynet-krav – status

- registrert spill per hall: fullt støttet, inkludert flere aktive halltilknytninger for samme spiller
- tapsgrenser håndheves per hall-ID og spiller-ID i dagens bingo-/spillflyt
- spillregnskap viser nettoforbruk per hall og per valgt periode, med breakdown for innsats, premier og netto
- audit-spor finnes for spillkjøp, premier, ledger-hendelser og blokkering i spillmotoren
- PDF-rapport gir detaljert historikk for valgt periode og kan brukes som spiller-/tilsynsrapport
- grensesjekk er koblet til innsatsflyten i dagens motor
- frivillig pause og selvutestenging er aktiv funksjonalitet
- obligatorisk 5-minutters pause etter 1 times spill er aktivert i gjeldende kode og håndheves i spillmotoren
- karenstid ved økning av personlige grenser er aktivert i gjeldende kode og persisteres over restart
- visuell Spillvett-oppsummering i host-shellen er aktiv og følger aktiv hall i lobbyen

**Risiko:** SMTP-oppsett og eventuell ønsket forsidesurfacing av Spillvett ved innlogging er de viktigste gjenværende produksjonsgapene.

## Relevante filer

- `/Users/tobiashaugen/Projects/Spillorama-system/backend/src/index.ts`
- `/Users/tobiashaugen/Projects/Spillorama-system/backend/src/game/BingoEngine.ts`
- `/Users/tobiashaugen/Projects/Spillorama-system/backend/src/game/PostgresResponsibleGamingStore.ts`
- `/Users/tobiashaugen/Projects/Spillorama-system/backend/src/game/ResponsibleGamingPersistence.ts`
- `/Users/tobiashaugen/Projects/Spillorama-system/backend/src/spillevett/playerReport.ts`
- `/Users/tobiashaugen/Projects/Spillorama-system/backend/src/spillevett/reportExport.ts`
- `/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/TopBarPanel.cs`
- `/Users/tobiashaugen/Projects/Spillorama-system/backend/public/web/index.html`
- `/Users/tobiashaugen/Projects/Spillorama-system/backend/public/web/spillvett.css`
- `/Users/tobiashaugen/Projects/Spillorama-system/backend/public/web/spillvett.js`
- `/Users/tobiashaugen/Projects/Spillorama-system/docs/SPILLORAMA_SYSTEM_SCOPE_AND_SOURCE_OF_TRUTH_2026-04-12.md`
- `/Users/tobiashaugen/Projects/Spillorama-system/docs/SPILLORAMA_LOBBY_ARCHITECTURE_RECOMMENDATION_2026-04-12.md`

## Anbefalte neste steg før produksjon

- kjøre manuell regresjonstest av obligatorisk 5-minutters pause etter 1 times spill i browser
- kjøre manuell browser-test av karenstid ved økning av personlige grenser
- utvide host-shellen til å eie mer av lobbynavigasjonen
- redusere eller fjerne resterende kundevendte Unity-lobbyelementer som ikke lenger trengs i WebGL
- kjøre full regresjonstest av multi-hall og grenseblokkering
- gjennomføre uavhengig compliance-gjennomgang / mock-tilsyn
- dokumentere audit-log-strukturen for tilsyn og internkontroll
- sette opp SMTP i produksjon for e-post-PDF

**Samlet status:** Kjernefunksjonen er implementert. Det som gjenstår før full produksjonsklarhet er SMTP for e-post-PDF og eventuelt et eget Spillvett-dashbord på forsiden hvis dette ønskes i produksjon.

## Konklusjon

Leveransen er klar for funksjonell gjennomgang og har nå obligatorisk pause aktivert i kode.

Det viktigste som gjenstår er å fullføre SMTP-oppsett for e-postsending av PDF-eksport, og deretter fortsette utflyttingen av hallvalg og lobbynavigasjon fra Unity til host-shellen.
