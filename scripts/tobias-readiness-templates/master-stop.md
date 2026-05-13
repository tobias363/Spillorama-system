### Smoke-test steps (master stopper runde)

1. Forutsetning: pågående runde i `running`-state
2. Åpne `http://localhost:5174/admin/agent/cash-in-out` som `demo-agent-1@spillorama.no`
3. Klikk **"Stopp runde"** på NextGamePanel
4. Bekreft i confirm-dialog
5. **Expected:** Status bytter til `idle` innen 2 sek; ingen scheduled-game-id i lobby-poll-respons; plan-run-state ryddet samtidig (ikke stuck — se FRAGILITY F-02)

### Forventet feilbilde hvis PR er broken

- Knappen henger på "Stopper..." > 5 sek
- Status bytter til `idle` men `scheduledGameMeta` returnerer fortsatt `status: "running"` (stuck-state)
- Plan-run forblir `running` etter at scheduled-game er `completed` — typisk FRAGILITY F-02-symptom
