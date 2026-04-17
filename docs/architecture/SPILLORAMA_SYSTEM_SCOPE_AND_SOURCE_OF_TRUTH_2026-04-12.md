# Spillorama-system: Korrekt System og Source of Truth

Dato: 12. april 2026

## Formål

Dette dokumentet låser hvilken kodebase og hvilken klientflate som er den operative Spillorama-løsningen for kunder.

## Korrekt system

Det operative kundesystemet er:

- repo: `/Users/tobiashaugen/Projects/Spillorama-system`
- produksjon: [https://spillorama-system.onrender.com/](https://spillorama-system.onrender.com/)
- Unity-lobby / WebGL-host: [https://spillorama-system.onrender.com/web/](https://spillorama-system.onrender.com/web/)

Det er denne Unity-lobbyen kundene faktisk bruker når de:

- logger inn
- velger hall
- spiller hovedspill og databingo
- ser saldo, hallvalg og kundevendt spillinformasjon

## Viktig avgrensning

Når en funksjon skal være synlig for kunde i selve Spillorama-opplevelsen, skal den bygges i `Spillorama-system` sin `/web/`-host og web-shell rundt Unity først. Unity-klienten skal brukes for spillflaten, ikke som primær lobby for konto og compliance.

Det betyr konkret:

- kundevendt `Spillvett`
- spillegrenser per hall
- spillregnskap per hall
- hallbytte som styrer hvilke grenser/regnskap som vises

skal vurderes som en del av host-/shell-laget rundt Unity først.

## Hva som ikke er nok

Det er ikke tilstrekkelig å implementere slike funksjoner bare i:

- portal-UI i `frontend/`
- admin-flater
- separate hjelpevisninger som ikke er en del av Unity-opplevelsen kundene faktisk bruker

Hvis funksjonen er ment for sluttbruker i Spillorama, må den være tilgjengelig i den operative lobbyen på `/web/`, fortrinnsvis i host-shellen utenfor Unity-canvaset.

## Praktisk utviklingsregel

Bruk denne enkle regelen videre:

1. Hvis sluttbruker skal se funksjonen som del av lobby, konto eller Spillvett, bygg den i `/web/`-hosten og knytt den til backend-API-ene.
2. Hvis funksjonen er administrativ eller backoffice, bygg den i `apps/admin-web/` eller backend-admin.
3. Hvis funksjonen er del av selve spillopplevelsen, kan den bygges i `packages/game-client/` (web-native) eller `legacy/unity-client/` for gamle Unity-spill.

## Source of truth for denne leveransen

For spillegrenser og spillregnskap er source of truth nå:

- backend-data og regler i `backend/`
- kundevendt visning i `/web/`-hosten og shellen rundt Unity
- Unity brukes som spillflate, ikke som primær plassering for konto og compliance
- i WebGL-builden skal kundevendt hallvalg, spillvalg og lobbyretur gå via host-shellen først, ikke via Unity-lobbyen
- når `LobbyPanel` åpnes i WebGL settes den nå i shell-first tilstand med lukkede Unity-lobbybarn

## Konklusjon

Når vi sier "Spillorama-systemet" i denne leveransen, mener vi den faktiske kundeløsningen på `https://spillorama-system.onrender.com/web/`, drevet av `Spillorama-system`-repoet.

Det er denne flaten som skal regnes som primær for kundevendt Spillvett, spillegrenser og spillregnskap, med web-shellen som førstevalg og Unity som spillflate.
