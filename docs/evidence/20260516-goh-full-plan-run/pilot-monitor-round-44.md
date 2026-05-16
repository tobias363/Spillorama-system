# Round-End Rapport #44

**Generated:** 2026-05-16T15:56:25Z
**Scheduled Game ID:** `b75a78a0-73ac-417d-a45e-88e1a6bd44b0`
**Master Hall:** demo-hall-001
**Started:** 2026-05-16 15:55:13.806737+00
**Ended:** 2026-05-16 15:56:25.167878+00

**Varighet:** 72 sekunder

## DB-snapshot for denne runden

### Bonge-kjøp
```
ERROR:  relation "app_game1_tickets" does not exist
LINE 5:          FROM app_game1_tickets
                      ^
```

### Trekninger
```
ERROR:  column "drawn_numbers" does not exist
LINE 2:            drawn_numbers,
                   ^
```

### Compliance-ledger STAKE-entries
```
 event_type |    hall_id    | game_type | channel  | count |  total  
------------+---------------+-----------+----------+-------+---------
 PRIZE      | demo-hall-001 | MAIN_GAME | INTERNET |     1 |  900.00
 PRIZE      | demo-hall-002 | MAIN_GAME | INTERNET |     2 | 9600.00
 PRIZE      | demo-hall-003 | MAIN_GAME | INTERNET |     1 |  600.00
 PRIZE      | demo-hall-004 | MAIN_GAME | INTERNET |     1 |  600.00
 STAKE      | demo-hall-001 | MAIN_GAME | INTERNET |    20 |  500.00
 STAKE      | demo-hall-002 | MAIN_GAME | INTERNET |    20 |  500.00
 STAKE      | demo-hall-003 | MAIN_GAME | INTERNET |    20 |  500.00
 STAKE      | demo-hall-004 | MAIN_GAME | INTERNET |    20 |  500.00
```

## Klient-side events (siste 30 fra ConsoleBridge)
```
[2026-05-15T13:51:30.360Z] console.debug: [blink] TicketGrid.rebuild
[2026-05-15T13:51:58.494Z] console.debug: [blink] TicketGrid.rebuild
```

## Anomalier under runden (fra /tmp/pilot-monitor.log)
```
[2026-05-16T14:25:18Z] [P1] db.stuck-state: Plan-run RUNNING men scheduled-game COMPLETED/NULL: 6bd67e6b-f0ba-46b7-94bf-b4e8af6fa500|running|c2f2bd18-96ab-4c6b-83d9-e6fd3c39c19a|completed — kjør cleanup-curl
[2026-05-16T14:25:51Z] [P3] round.ended: Runde 27 ferdig (dea47b06-f2d3-40e4-be2f-12dea1ddfcfd, 73s). Rapport: /tmp/pilot-monitor-round-27.md
[2026-05-16T14:25:51Z] [P1] db.stuck-state: Plan-run RUNNING men scheduled-game COMPLETED/NULL: 6bd67e6b-f0ba-46b7-94bf-b4e8af6fa500|running|dea47b06-f2d3-40e4-be2f-12dea1ddfcfd|completed
[2026-05-16T14:26:23Z] [P1] db.stuck-state: Plan-run RUNNING men scheduled-game COMPLETED/NULL: 6bd67e6b-f0ba-46b7-94bf-b4e8af6fa500|running|dea47b06-f2d3-40e4-be2f-12dea1ddfcfd|completed
[2026-05-16T14:31:13Z] [P1] db.stuck-state: Plan-run RUNNING men scheduled-game COMPLETED/NULL: 6bd67e6b-f0ba-46b7-94bf-b4e8af6fa500|running|dea47b06-f2d3-40e4-be2f-12dea1ddfcfd|completed
[2026-05-16T14:31:46Z] [P1] db.stuck-state: Plan-run RUNNING men scheduled-game COMPLETED/NULL: 6bd67e6b-f0ba-46b7-94bf-b4e8af6fa500|running|dea47b06-f2d3-40e4-be2f-12dea1ddfcfd|completed
[2026-05-16T14:32:19Z] [P3] round.ended: Runde 28 ferdig (82387d7d-de94-43af-9b2d-cbe3a1067d3e, 69s). Rapport: /tmp/pilot-monitor-round-28.md
[2026-05-16T14:37:02Z] [P2] monitor.backend-unreachable: Backend on :4000 not responding (every 60s)
[2026-05-16T14:37:03Z] [P2] backend.warn: (node:44975) DeprecationWarning: Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0. Use async/await or an external async flow control mech
[2026-05-16T14:37:43Z] [P2] backend.warn: (node:46042) DeprecationWarning: Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0. Use async/await or an external async flow control mech
[2026-05-16T14:37:52Z] [P2] backend.warn: (node:46533) DeprecationWarning: Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0. Use async/await or an external async flow control mech
[2026-05-16T14:38:01Z] [P2] backend.warn: (node:46986) DeprecationWarning: Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0. Use async/await or an external async flow control mech
[2026-05-16T14:40:01Z] [P3] monitor.start: pilot-monitor-enhanced started (PID 49710)
[2026-05-16T14:56:54Z] [P3] monitor.start: pilot-monitor-enhanced started (PID 63010)
[2026-05-16T14:56:54Z] [P3] round.ended: Runde 29 ferdig (ce3f20b8-6781-43d5-badd-e69838f5b6eb, 74s). Rapport: /tmp/pilot-monitor-round-29.md
[2026-05-16T15:26:46Z] [P3] monitor.start: pilot-monitor-enhanced started (PID 77529)
[2026-05-16T15:26:46Z] [P3] round.ended: Runde 30 ferdig (81493438-2025-40b1-b346-23ef66917fad, 65s). Rapport: /tmp/pilot-monitor-round-30.md
[2026-05-16T15:31:37Z] [P3] round.ended: Runde 31 ferdig (bdc47989-c02a-4c7e-a529-bc0972ccadb3, 72s). Rapport: /tmp/pilot-monitor-round-31.md
[2026-05-16T15:33:03Z] [P3] round.ended: Runde 32 ferdig (f5029eb4-8a9b-4b19-88b0-15907fb3471c, 77s). Rapport: /tmp/pilot-monitor-round-32.md
[2026-05-16T15:34:29Z] [P3] round.ended: Runde 33 ferdig (c3563519-9bd6-487b-99cd-1492abf62216, 77s). Rapport: /tmp/pilot-monitor-round-33.md
[2026-05-16T15:35:55Z] [P3] round.ended: Runde 34 ferdig (ff224071-9362-40e1-b942-0d0e97cedf9f, 75s). Rapport: /tmp/pilot-monitor-round-34.md
[2026-05-16T15:37:22Z] [P3] round.ended: Runde 35 ferdig (9fd8b013-3ee1-4ea8-ac1b-e751216319e2, 79s). Rapport: /tmp/pilot-monitor-round-35.md
[2026-05-16T15:38:43Z] [P3] round.ended: Runde 36 ferdig (244fd568-dea1-4037-8a30-b06e5d1e9efb, 69s). Rapport: /tmp/pilot-monitor-round-36.md
[2026-05-16T15:40:03Z] [P3] round.ended: Runde 37 ferdig (041cbd1a-9bbb-42bd-8cb5-e0abb93f1bdf, 73s). Rapport: /tmp/pilot-monitor-round-37.md
[2026-05-16T15:41:35Z] [P3] round.ended: Runde 38 ferdig (5631eb5b-370d-4dca-bdd5-be85af5bd62b, 79s). Rapport: /tmp/pilot-monitor-round-38.md
[2026-05-16T15:43:02Z] [P3] round.ended: Runde 39 ferdig (1d401c8d-3e2a-471a-9cb4-79bd99d6ee19, 72s). Rapport: /tmp/pilot-monitor-round-39.md
[2026-05-16T15:44:22Z] [P3] round.ended: Runde 40 ferdig (23b64814-40c0-44f5-98b5-2eb01e2bcd75, 73s). Rapport: /tmp/pilot-monitor-round-40.md
[2026-05-16T15:45:43Z] [P3] round.ended: Runde 41 ferdig (bafcff66-e222-4f2e-ab4e-508b396fbfed, 70s). Rapport: /tmp/pilot-monitor-round-41.md
[2026-05-16T15:47:15Z] [P3] round.ended: Runde 42 ferdig (d939fdb8-7369-4bf4-8cf4-9eace9774da5, 79s). Rapport: /tmp/pilot-monitor-round-42.md
[2026-05-16T15:48:42Z] [P3] round.ended: Runde 43 ferdig (1666b737-af70-41ea-b758-be420376c3c5, 75s). Rapport: /tmp/pilot-monitor-round-43.md
```

## Status
✅ Runden fullført normalt
