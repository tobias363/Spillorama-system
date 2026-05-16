# Round-End Rapport #56

**Generated:** 2026-05-16T16:13:33Z
**Scheduled Game ID:** `911646e4-f3f3-4a33-bd1a-3b5297b99e08`
**Master Hall:** demo-hall-001
**Started:** 2026-05-16 16:12:19.226184+00
**Ended:** 2026-05-16 16:13:30.674005+00

**Varighet:** 71 sekunder

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
------------+---------------+-----------+----------+-------+----------
 PRIZE      | demo-hall-001 | MAIN_GAME | INTERNET |     1 |   200.00
 PRIZE      | demo-hall-002 | MAIN_GAME | INTERNET |     1 | 18000.00
 PRIZE      | demo-hall-003 | MAIN_GAME | INTERNET |     3 |  1200.00
 STAKE      | demo-hall-001 | MAIN_GAME | INTERNET |    20 |   500.00
 STAKE      | demo-hall-002 | MAIN_GAME | INTERNET |    20 |   500.00
 STAKE      | demo-hall-003 | MAIN_GAME | INTERNET |    21 |   510.00
 STAKE      | demo-hall-004 | MAIN_GAME | INTERNET |    20 |   500.00
(7 rows)
```

## Klient-side events (siste 30 fra ConsoleBridge)
```
[2026-05-15T13:51:30.360Z] console.debug: [blink] TicketGrid.rebuild
[2026-05-15T13:51:58.494Z] console.debug: [blink] TicketGrid.rebuild
```

## Anomalier under runden (fra /tmp/pilot-monitor.log)
```
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
[2026-05-16T15:56:25Z] [P3] round.ended: Runde 44 ferdig (b75a78a0-73ac-417d-a45e-88e1a6bd44b0, 72s). Rapport: /tmp/pilot-monitor-round-44.md
[2026-05-16T15:57:52Z] [P3] round.ended: Runde 45 ferdig (4aa4e5a9-6f7b-477c-959b-e1e91943d46b, 72s). Rapport: /tmp/pilot-monitor-round-45.md
[2026-05-16T15:59:13Z] [P3] round.ended: Runde 46 ferdig (f09fca2e-45d2-41c7-b718-46da842d74f5, 74s). Rapport: /tmp/pilot-monitor-round-46.md
[2026-05-16T16:00:40Z] [P3] round.ended: Runde 47 ferdig (f3b4974b-5b80-442e-8bf4-1dc8cf7087a0, 73s). Rapport: /tmp/pilot-monitor-round-47.md
[2026-05-16T16:02:12Z] [P3] round.ended: Runde 48 ferdig (ee21f0e7-bfbe-431f-a965-a0eec68f6a1d, 77s). Rapport: /tmp/pilot-monitor-round-48.md
[2026-05-16T16:03:30Z] [P3] round.ended: Runde 49 ferdig (956d7964-3625-4423-be83-71fa967f02b5, 68s). Rapport: /tmp/pilot-monitor-round-49.md
[2026-05-16T16:04:47Z] [P3] round.ended: Runde 50 ferdig (a894783c-ef1e-4bfc-b48c-0d2cf60ed678, 68s). Rapport: /tmp/pilot-monitor-round-50.md
[2026-05-16T16:06:22Z] [P3] round.ended: Runde 51 ferdig (dbbca79f-e762-4190-9e9b-3a80aeabbec6, 80s). Rapport: /tmp/pilot-monitor-round-51.md
[2026-05-16T16:07:45Z] [P3] round.ended: Runde 52 ferdig (05d5195e-3357-44a5-bd33-cedef24116df, 74s). Rapport: /tmp/pilot-monitor-round-52.md
[2026-05-16T16:09:11Z] [P3] round.ended: Runde 53 ferdig (9b2b9a66-7725-4562-8e1c-e5bee3527c80, 72s). Rapport: /tmp/pilot-monitor-round-53.md
[2026-05-16T16:10:33Z] [P3] round.ended: Runde 54 ferdig (536ee52d-7057-45c8-b7be-9460f39ce45e, 69s). Rapport: /tmp/pilot-monitor-round-54.md
[2026-05-16T16:12:10Z] [P3] round.ended: Runde 55 ferdig (42e740c6-c88d-4bea-9551-7014ab624c71, 80s). Rapport: /tmp/pilot-monitor-round-55.md
```

## Status
✅ Runden fullført normalt
