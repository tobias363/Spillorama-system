### Smoke-test steps (spiller markerer tall)

1. Forutsetning: master har startet runde + spiller har kjøpt bonger (eller bruk eksisterende pågående runde)
2. Åpne `http://localhost:4000/web/?debug=1` som spiller
3. Vent til første ball trekkes (synlig i CenterTopPanel)
4. **Expected:** Tallet auto-marker på alle brett som har det (grønn highlight på celle innen 1 sek)
5. Klikk manuelt på en umerket celle som matcher trukket tall
6. **Expected:** Highlight aktiveres umiddelbart, server-sync skjer (sjekk Network-tab for `ticket:mark`-event)

### Forventet feilbilde hvis PR er broken

- Auto-marker virker ikke — celle forblir umerket selv etter trekning
- Manuell mark gir 0.5-2 sek delay før visuell feedback (idempotency-feil)
- Mark fungerer på lokal klient men forsvinner ved reconnect (FRAGILITY socket-side)
