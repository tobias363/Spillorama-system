# Staging smoke-checkliste: Admin RBAC

## Før start
- Bekreft at staging kjører siste build av backend og admin-frontend.
- Ha testbrukere med rollene `ADMIN`, `HALL_OPERATOR`, `SUPPORT`.

## 1. Login
- `ADMIN` kan logge inn på `/api/admin/auth/login`.
- `HALL_OPERATOR` kan logge inn på `/api/admin/auth/login`.
- `SUPPORT` kan logge inn på `/api/admin/auth/login`.
- Ugyldig/utenfor policy rolle avvises.

## 2. Meny og policy-visning
- Meny viser kun seksjoner rollen har tilgang til.
- Låste handlinger er deaktivert med forklaring i UI.
- Policy-panel viser rolle, tilgjengelige permissions og låste seksjoner.

## 3. Rolleatferd
- `ADMIN`: kan utføre admin-only writes (f.eks. spillkatalog write).
- `HALL_OPERATOR`: kan bruke operative writes, men får `FORBIDDEN` på admin-only writes.
- `SUPPORT`: kan bruke compliance writes, men får `FORBIDDEN` på admin-only writes.

## 4. Settings endringslogg
- Kall `GET /api/admin/game-settings/change-log` fungerer for roller med lesetilgang.
- Filter `gameSlug` fungerer.
- `limit` fungerer.
- Rad viser: aktør, rolle, tidspunkt, source, effektFra, payload-sammendrag.

## 5. Candy lock-atferd
- Ved aktiv runde avvises direkte settings-endring.
- Planlagt endring med `effectiveFrom` godtas.

## 6. Regression-sjekk
- Eksisterende admin-ruter svarer fortsatt med samme kontrakt for gyldige kall.
- Ingen uventede 5xx i backend-logg.
