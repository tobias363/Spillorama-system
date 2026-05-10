# R4 Load Test — 1000 simultane klienter per Spill 1-rom

**Linear:** https://linear.app/bingosystem/issue/BIN-817
**Mandat-ref:** [`docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md`](../../docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md) §3.5 R4
**Runbook:** [`docs/operations/R4_LOAD_TEST_RUNBOOK.md`](../../docs/operations/R4_LOAD_TEST_RUNBOOK.md)

---

## Hvorfor Node.js, ikke k6?

R4-mandatet ber om "1000 samtidige klienter per rom" hvor hver klient
skal kunne:

1. WebSocket-koble seg til via socket.io
2. Gjøre `room:join` med ack
3. Lytte på `draw:new`-events
4. Sende `ticket:mark` med UUID + ack
5. Lytte på `room:update` og synkronisere state

**k6 har ingen native socket.io-støtte.** Plain WebSocket fungerer i k6,
men socket.io legger på et eget protokoll-lag (engine.io v4 framing,
ack-callbacks via numerisk msg-id, multiplexed namespaces) som k6
ikke parser ut av boksen. Egen k6-extension (`xk6-socketio`) eksisterer,
men krever custom k6-build og er ikke standard pilot-tooling.

Vi bruker derfor **Node.js + `socket.io-client`** som load-runner. Det
er identisk med eksisterende chaos-tests (`infra/chaos-tests/r3-mock-client.mjs`),
og 1000 samtidige socket.io-klienter på én Node-prosess er trivielt så
lenge `--max-old-space-size` er satt høyt nok (vi bruker 4 GB).

For HTTP-only load testing (eks. lobby-endpoints), kan k6 brukes som
supplement — det er ikke nødvendig for R4-scope.

---

## Filer

| Fil | Hva |
|---|---|
| [`spill1-1000-clients.mjs`](./spill1-1000-clients.mjs) | Node.js load-runner. Spawner N VUs som hver kjører en realistisk Spill 1-runde. |
| [`metrics-collector.mjs`](./metrics-collector.mjs) | Aggregerer percentile-statistikk + skriver JSON-rapport. |
| [`seed-load-test-players.ts`](./seed-load-test-players.ts) | Seeder N test-spillere idempotent for load-test (default 1000). |
| [`spill1-load-config.json`](./spill1-load-config.json) | Konfig: VU-count, ramp-tid, hold-tid, target-hall, scenarier. |

## Quickstart (smoke-test, lokal)

Forutsetning: backend kjører på `http://localhost:4000`, demo-spillere er seedet
(`npm run seed:demo-pilot-day`).

```bash
# 50-VU smoke (rask sanity-sjekk, ~5 min)
bash scripts/load-test-runner.sh smoke

# Full 1000-VU run (60+ min, krever staging eller dedikert lokal-stack)
bash scripts/load-test-runner.sh full
```

Resultater skrives til `/tmp/r4-load-test-results/`.

## Full runbook

Se [`docs/operations/R4_LOAD_TEST_RUNBOOK.md`](../../docs/operations/R4_LOAD_TEST_RUNBOOK.md)
for staging-kjøring, tolkning av resultater, baseline-tall, eskalering.
