# Admin runbook: RBAC og drift (operatør)

## Hensikt
Denne runbooken beskriver hvordan admin-panelet styres med roller, hva feltene betyr i drift, hva som er låst under aktiv runde, og hvordan rollback gjøres trygt.

## Roller og tilgang
- `ADMIN`: full tilgang i admin.
- `HALL_OPERATOR`: operative funksjoner (romkontroll, terminaler, hall-spillregler, rapportkjøring).
- `SUPPORT`: compliance/support-funksjoner (wallet-compliance, denial/audit-lesing).

Backend er kilde til sannhet. UI kan skjule/låse handlinger, men backend avviser alltid ulovlige kall med `FORBIDDEN`.

## Feltforklaring (driftsrelevante)
- `autoRoundStartEnabled`: om auto-start av runder er aktiv.
- `autoRoundStartIntervalSeconds`: intervall mellom auto-start (sekunder).
- `autoRoundMinPlayers`: minimum spillere før auto-start.
- `autoRoundTicketsPerPlayer`: antall bong(er) per spiller i auto-start.
- `autoRoundEntryFee`: standard innsats per auto-runde.
- `payoutPercent`: mål for utbetaling (RTP).
- `autoDrawEnabled`: om auto-trekk i aktiv runde er på.
- `autoDrawIntervalSeconds`: intervall mellom trekk i aktiv runde.
- `effectiveFrom`: valgfri fremtidig aktiveringstid for planlagt endring.

## Låser under aktiv runde
Når en bingo-runde kjører (`runningRoundLockActive=true`):
- Direkte endring av bingo-settings avvises.
- Bruk planlagt endring med `effectiveFrom` i fremtid.
- Formål: unngå inkonsistent runtime-state midt i aktiv runde.

## Rollback-prosedyre
1. Åpne `Settings endringslogg` i admin.
2. Filtrer på `gameSlug` og sett passende `limit`.
3. Finn siste stabile endring (se `source`, `effektFra`, `payload`).
4. Re-appliser tidligere verdier via korrekt admin-endepunkt:
- For katalog/settings: `PUT /api/admin/games/:slug`
- For typed spillsettings: `PUT /api/admin/settings/games/:slug`
5. Ved aktiv runde: sett `effectiveFrom` frem i tid.
6. Verifiser etterpå:
- ny linje i endringslogg
- forventet runtime i bingo settings
- ingen `FORBIDDEN` eller valideringsfeil for riktig rolle

## Operativ feilhåndtering
- `FORBIDDEN`: rolle mangler permission. Ikke bypass UI; bruk korrekt rolle.
- `UNAUTHORIZED`: token utløpt/ugyldig, logg inn på nytt.
- `INVALID_INPUT`: korriger feltverdier/format.
- `GAME_SETTINGS_LOCKED_DURING_RUNNING_GAME`: bruk planlagt endring (`effectiveFrom`).
