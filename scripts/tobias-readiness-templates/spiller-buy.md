### Smoke-test steps (spiller kjøper bonger)

1. Forutsetning: master har startet en runde (se egen test hvis denne PR-en endrer master-flyt)
2. Åpne `http://localhost:4000/web/?debug=1` som spiller (auto-login via cookie eller direkte token)
3. Klikk **Bingo-tile** i lobby
4. **Expected:** Buy-popup åpner innen 5 sek med 6 bongfarger og priser **5 / 10 / 15 / 15 / 30 / 45 kr**
5. Klikk **+** én gang på hver av de 6 radene (12 brett totalt = 120 kr)
6. Klikk **Kjøp** — popup lukkes, success-toast vises
7. **Expected:** Ticket-grid viser 12 brett med korrekte per-brett-priser (`data-test-ticket-price`-attributt)

### Forventet feilbilde hvis PR er broken

- Popup vises ikke (sjekk `/tmp/pilot-monitor.log` for `popup.autoShowGate { willOpen: false, ... }`)
- Alle brett viser samme pris (5 kr) — typisk symptom på ticket-grid price-mapping-bug
- Kjøp-knapp forblir disabled etter +-klikk — sjekk `lobbyTicketConfig.entryFee` (FRAGILITY F-01)
