# Anbefalt lobby-arkitektur for Spillorama

Dato: 12. april 2026
Repo: `/Users/tobiashaugen/Projects/Spillorama-system`
Produksjonsflate: [https://spillorama-system.onrender.com/web/](https://spillorama-system.onrender.com/web/)

## Beslutning

Spillorama bør bruke en delt arkitektur der:

- web-shellen rundt `/web/` er kundens primære lobbyflate
- Unity brukes som spillflate og spillmotor
- ansvarlig spill, konto og historikk ikke eies av Unity-scenen

## Hva som skal ligge i web-shellen

Følgende funksjoner skal eies av host-/shell-laget rundt Unity:

- hallkontekst og aktiv hall-visning
- Spillvett
- spillegrenser per hall
- spillregnskap per hall
- profilnære funksjoner
- eksport og e-postflyt for rapporter
- fremtidig lobby-navigasjon mellom spill
- kundevendt status for pause, selvutestenging og grenseendringer

## Hva som skal ligge i Unity

Følgende skal fortsatt ligge i Unity:

- selve spillene
- sanntidsvisning og interaksjon i spill
- game-flow, animasjoner og spillnær UI
- hendelser som krever tett kobling til spillmotoren

## Begrunnelse

Denne delingen er anbefalt fordi den gir:

- enklere endringer i compliance- og konto-UI uten ny Unity-build
- bedre tilgjengelighet og responsivitet for kundevendt informasjon
- tydeligere skille mellom lobby og spill
- mindre teknisk kobling mellom ansvarlig spill og spillskjermen
- enklere drift, testing og revisjon

## Nåværende status

Per nå er det implementert en host-basert Spillvett-shell på `/web/` som bruker backend-API-ene direkte og synkroniseres fra Unity via JS-broen.

Dagens mellomsteg er:

- hallvalg finnes i host-shellen, og Unity-topbarens kundevendte hallvelger er skjult i WebGL-builden
- aktiv hall, spiller-token og liste over godkjente haller sendes videre til hosten
- Spillvett og spillregnskap vises i web-shellen, ikke i Unity-panelet
- enkel spillnavigasjon kan trigges fra host-shellen tilbake inn i Unity
- host-shellens spillknapper åpner nå spill direkte uten å aktivere Unitys synlige game-selection-panel som mellomsteg
- retur til lobby i WebGL går nå til shell-first tilstand i stedet for å åpne Unitys game-selection som standard

Dette er riktig retning, men ikke sluttpunktet.

## Neste anbefalte steg

1. Utvid host-shellen til å eie all lobby-navigasjon til spill.
2. La Unity kun motta valgt kontekst og åpne riktig spill.
3. Reduser eller fjern resterende kundevendte lobbyelementer i Unity som ikke lenger trengs på WebGL.
4. Behold backend som source of truth for grenser, spillregnskap og blokkeringer.

## Arkitekturregel videre

Hvis sluttbrukeren skal se funksjonen som del av lobby, konto eller ansvarlig spill, skal den bygges i host-/shell-laget rundt `/web/`, ikke inne i Unity-scenen.

Hvis funksjonen er del av selve spillopplevelsen, kan den ligge i Unity.
