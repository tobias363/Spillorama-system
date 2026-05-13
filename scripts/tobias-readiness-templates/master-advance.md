### Smoke-test steps (master advancer til neste fase)

1. Forutsetning: pågående runde med en vunnet Rad-fase (Rad 1 eller senere)
2. Åpne `http://localhost:5174/admin/agent/cash-in-out` som `demo-agent-1@spillorama.no`
3. Klikk **"Fortsett til neste"** etter vinner-popup på master-konsoll
4. **Expected:** Status oppdaterer seg innen 2 sek; ny fase markert som aktiv; ball-trekning fortsetter etter eventuell pause

### Forventet feilbilde hvis PR er broken

- Knappen forblir disabled etter Rad-vinst
- Advance gir `JACKPOT_SETUP_REQUIRED`-error uten at popup vises (manglende JackpotConfirmModal)
- Run-status hopper direkte til `finished` istedenfor neste fase
