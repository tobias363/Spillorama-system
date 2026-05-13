### Smoke-test steps (master starter runde)

1. Åpne `http://localhost:5174/admin/agent/cash-in-out` som `demo-agent-1@spillorama.no` / `Spillorama123!`
2. Velg hall `demo-hall-001` (Teknobingo Årnes) hvis ikke allerede aktiv
3. Klikk **"Marker hall klar"** (eller bekreft at den allerede er klar)
4. Klikk **"Start runde"** på Bingo-spillet i NextGamePanel
5. **Expected:** Status i master-konsollet bytter fra `idle` → `running` innen 2 sek; `scheduledGameId` vises og er ikke-null

### Forventet feilbilde hvis PR er broken

- Master-handlingen returnerer `SCHEDULED_GAME_TERMINAL` eller `STATE_CONFLICT` (stuck plan-run state, se FRAGILITY F-02)
- Status forblir `idle` selv etter klikk — typisk symptom på lobby-aggregator-bug
