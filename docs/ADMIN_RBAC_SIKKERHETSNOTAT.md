# Sikkerhetsnotat: RBAC-matrise (admin)

Backend håndhever RBAC som kilde til sannhet. Frontend er kun et ekstra kontrollag for visning/låsing.

## RBAC-matrise (kort)

| Område | ADMIN | HALL_OPERATOR | SUPPORT |
|---|---|---|---|
| Admin panel tilgang | Ja | Ja | Ja |
| Spillkatalog lesing | Ja | Ja | Ja |
| Spillkatalog skriving | Ja | Nei | Nei |
| Hall/terminal operativ write | Ja | Ja (utvalgt) | Nei |
| Hall-spillregler write | Ja | Ja | Nei |
| Romkontroll read/write | Ja | Ja | Nei |
| Wallet compliance read/write | Ja | Nei | Ja |
| Extra draw denials read | Ja | Nei | Ja |
| Prize policy write / extra prize award | Ja | Nei | Nei |
| Settings endringslogg read | Ja | Ja | Ja |
| Brukerrolle-write | Ja | Nei | Nei |

## Trusselmodell (kort)
- UI-manipulasjon: håndteres av backend-permission-check på alle relevante admin-endepunkter.
- Token-gjenbruk med feil rolle: kall avvises med `FORBIDDEN`.
- Mid-round settings-endring: håndteres av runtime-lås + støtte for planlagt effekt (`effectiveFrom`).

## Audit/sporbarhet
- Alle settings-endringer logges med `gameSlug`, aktør, rolle, source, effektFra og payload-sammendrag.
- Endringslogg hentes via admin-endepunkt med filter på `gameSlug` og `limit`.
