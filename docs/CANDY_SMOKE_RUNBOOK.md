# Candy Smoke Test Runbook (Chat 1)

## Scope
Dette runbooket verifiserer Candy MVP-flyt etter deploy:
1. Portal launch fungerer.
2. Spiller kobles til aktivt rom.
3. Runde kjører og stopper etter 30 trekk.
4. Near-win visualer fungerer.
5. Bonus/winning oppdatering fungerer.

## Preconditions
1. Backend deploy er grønn på Render.
2. Candy WebGL URL i admin peker til gyldig build.
3. Testbruker finnes i auth-systemet.
4. Candy game settings har gyldig JSON.

## Quick Health Checks
1. Backend health:
```bash
curl -sS https://bingosystem-3.onrender.com/health
```
Forventet: `"ok": true`.

2. Realtime room list (innlogget i admin):
- Åpne admin candy-panel.
- Bekreft at hall/room kan lastes uten feil.

## End-to-End Smoke
1. Logg inn i portal med testbruker.
2. Klikk `Spill nå` på Candy.
3. Verifiser:
- Spill åpnes (ingen blank side/404).
- Ingen kontinuerlig feilmelding i UI.
- Tall/bonger vises.

4. Start runde (host/admin-flow).
5. Verifiser draw-flyt:
- Trekk starter.
- Tallet markeres på bong.
- Near-win blink vises når ett tall mangler i mønster.

6. Verifiser round cap:
- Etter maks 30 trekk avsluttes runden.
- Ny timer/ventestatus starter for neste runde.

7. Verifiser bonus/winning:
- Bonus trigges kun én gang per runde ved gyldig trigger.
- Bonuspanel åpnes når trigger inntreffer.
- `WINNING` viser sum for aktiv runde (inkl. bonus hvis utbetalt).

## API/State Validation (Optional)
Bruk browser network eller backend logs:
1. `room:state` snapshot skal vise `currentGame.drawnNumbers` med maks 30.
2. Avsluttet runde skal ha `endedReason = MAX_DRAWS_REACHED` (ved cap-avslutning).
3. Claims for spilleren skal ha `valid=true` ved gyldige gevinster.

## Failure Triage
1. `Spill nå` gjør ingenting:
- Sjekk `launchUrl` i admin settings.
- Sjekk at launch-token/resolve endpoints svarer 200.

2. Bonus trigges ikke:
- Sjekk at bonusmønster er aktivt i runden.
- Sjekk claim/snapshot metadata for bonusbeløp/pattern.

3. Lagg i animasjon:
- Sjekk antall aktive coroutines.
- Sjekk gjentatte SetActive/DOTween-kall i draw-loop.

## Sign-off Checklist
- [ ] Portal launch OK
- [ ] Join room OK
- [ ] Draw-loop OK
- [ ] 30-draw cap OK
- [ ] Near-win visual OK
- [ ] Bonus panel/bonus amount OK
- [ ] Winning-sum OK
- [ ] Ingen blokkende feil i logs
