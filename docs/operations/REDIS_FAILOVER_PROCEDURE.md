# Redis Failover Procedure (BIN-790 C4)

**Owner:** Technical lead (Tobias Haugen)
**Related Linear:** BIN-790 (M2 — Multi-hall-launch, Spor C — Operasjon & infrastruktur)
**Last updated:** 2026-05-08
**Audience:** L2 backend on-call, L3 incident commander.

> Denne runbooken beskriver hva vi gjør når Render Redis-instansen
> blir utilgjengelig eller mister state. For:
>
> - **Surgical recovery av enkelt-rom-state**: se [`REDIS_KEY_SCHEMA.md`](./REDIS_KEY_SCHEMA.md) §6.
> - **Backend-krasj som følge av Redis-utfall**: se [`LIVE_ROOM_DR_RUNBOOK.md`](./LIVE_ROOM_DR_RUNBOOK.md) §4.
> - **Multi-node skalering og fanout-bus**: se [`RENDER_GITHUB_SETUP.md`](./RENDER_GITHUB_SETUP.md) §"Multi-node skalering".

---

## 0. TL;DR

Redis i Spillorama-systemet brukes til:

| Bruksområde | Konsekvens ved utfall |
|---|---|
| **Room-state-store** (`bingo:room:*`) — armed-tickets, selections, reservations | Spillere som ikke har commitet `startGame` mister armed-state. Committede runder kjører videre fra Postgres. |
| **Distribuert scheduler-lock** (`bingo:lock:*`) | Engine kan ikke koordinere draws across nodes. På single-node: ingen impact. |
| **Socket.IO fanout-bus** (BIN-494) | Multi-node fanout dør. På single-node: ingen impact. |
| **Rate-limiting state** | Burst-protection feiler "open" — kan tillate spam. |
| **Sesjons-cache** | Cache-miss → DB-fallback. Ingen funksjonell impact, men ekstra DB-load. |

Postgres er source of truth for alt kritisk. **Redis-utfall mister
flyktig state, aldri committed data.**

---

## 1. Trigger

| Symptom | Sannsynlig kilde |
|---|---|
| Backend logger `Error: connect ECONNREFUSED <redis-host>` | Redis nede |
| Backend logger `Error: READONLY` ved skriv | Redis i replica-mode (failover pågår) |
| `bingo_draw_errors_total{category="LOCK_TIMEOUT"}` spiker | Scheduler-lock-tapt eller treig |
| `RedisRoomLifecycleStore.armPlayer` kaster | Room-state-write feiler |
| Nye klienter ser "Brett ikke armed lenger" | armed-state evicted eller tapt |
| `bingo_socket_connections` flat etter draw-event (single hall, multi-node) | Socket.IO Redis-adapter dødt |

### 1.1 Bekreft Redis er problemet

```bash
# 1. PING-test
redis-cli -u "$REDIS_URL" PING
# Forventet: PONG. Timeout/ECONNREFUSED → Redis nede.

# 2. Inspeker key-count
redis-cli -u "$REDIS_URL" --scan --pattern "bingo:room:*:armedTickets" | wc -l

# 3. Sjekk Render-dashboard
# → Redis-tjeneste → Status, Events
```

---

## 2. Detection

| Signal | Kilde | Når trigger |
|---|---|---|
| Render uptime probe på Redis | Render dashboard | Redis nede > 30 sek |
| Sentry `RedisRoomLifecycleStore` exceptions | Sentry | Backend kan ikke skrive room-state |
| `bingo_draw_errors_total{category="LOCK_TIMEOUT"}` | Grafana | > 5/min |
| Klient-rapporter "Brett mistet" | Hall-vakt | Bekrefter Redis-evict eller utfall |
| Backend boot failer hvis `ROOM_STATE_PROVIDER=redis` | Render-deploy-log | Eager-connect feiler ved boot |

---

## 3. Severity-vurdering

| Symptom | Severity |
|---|---|
| Redis utilgjengelig > 2 min midt i åpningstid | P1 |
| Redis utilgjengelig kortvarig (< 30 sek) | P2 |
| Redis-evict pga full memory uten utfall | P2 |
| Bare scheduler-lock-treghet, ingen room-state-tap | P3 |

### 3.1 Hva er IKKE tapt ved Redis-utfall

- **Postgres-data** (compliance-ledger, wallets, scheduled games, KYC, payments) — fullstendig safe.
- **Wallet-reservasjoner** med `status='active'` — finnes i Postgres, ryddes av `WalletReservationExpiryService` etter 30 min TTL.
- **Committed runder** — engine kan hydrere fra checkpoint (BIN-245).

### 3.2 Hva er tapt

- **Armed-state** for spillere som ikke har commitet `startGame`. Spilleren ser "Brett ikke armed lenger" og må re-arme.
- **Selections** og **arm-cycle-keys** for ikke-committede økter.
- **Mid-flight scheduler-locks** (engine får retry).

---

## 4. Mitigation

### 4.1 Kortvarig Redis-glitch (< 30 sek)

Backend retry-er via pg-pool-style reconnect i `RedisRoomLifecycleStore`. Vanligvis selvrecovery.

1. **Bekreft via Render-dashboard** at det var en glitch (Events-fanen).
2. **Verifiser per §6**.
3. **Logg som P3 incident** hvis ingen langvarig konsekvens.

### 4.2 Lengre Redis-utfall (1–10 min)

1. **Bekreft Redis-status:**
   ```bash
   redis-cli -u "$REDIS_URL" PING
   ```

2. **Sjekk Render Redis-tjeneste:**
   - Dashboard → Redis → Status
   - Events-fanen — har det vært en restart eller failover?

3. **Hvis Render-tjenesten er nede:**
   - Klikk **Manual Restart** på Redis-tjenesten.
   - Forventet downtime: 30–60 sek.

4. **Vent på Redis tilbake:**
   ```bash
   # Polling
   while ! redis-cli -u "$REDIS_URL" PING > /dev/null 2>&1; do
     echo "Waiting for Redis..."
     sleep 5
   done
   echo "Redis is back."
   ```

5. **Restart backend** for å rydde stale connection-pool og hydre full state:
   - Render-dashboard → `spillorama-system` → Manual Deploy → Restart (uten ny build)
   - Forventet downtime: 30–90 sek

6. **Verifiser boot-recovery** i Render-loggen:
   ```
   [BIN-K4] RoomLifecycleStore provider: redis
   [responsible-gaming] persisted state hydrated
   [BIN-170] Loaded N room(s) from Redis
   [BIN-245] Recovery complete: X game(s) restored, Y game(s) ended
   ```

### 4.3 Memory-OOM eller eviction (Redis nede pga full)

1. **Sjekk minne-bruk:**
   ```bash
   redis-cli -u "$REDIS_URL" INFO memory
   # Se used_memory_human, maxmemory_human, mem_fragmentation_ratio
   ```

2. **Hvis memory ≥ 80% av plan-grense:**
   - Identifiser hvilke keys som tar plass:
     ```bash
     redis-cli -u "$REDIS_URL" --bigkeys
     ```
   - Hvis `bingo:room:*:armedTickets` har > 1000 keys, skann etter abandoned rooms (TTL > 0 men aldri brukt):
     ```bash
     redis-cli -u "$REDIS_URL" --scan --pattern "bingo:room:*:armedTickets" | head -20
     ```
   - Slett orphan rooms (eks. fra test-runs eller crashed sessions):
     ```bash
     redis-cli -u "$REDIS_URL" DEL \
       "bingo:room:<orphan-code>:armedTickets" \
       "bingo:room:<orphan-code>:selections" \
       "bingo:room:<orphan-code>:reservations" \
       "bingo:room:<orphan-code>:armCycle" \
       "bingo:room:<orphan-code>:lock"
     ```

3. **Oppgrader Redis-plan** hvis dette gjentar seg:
   - Render-dashboard → Redis → Plan → Upgrade
   - Vanligvis fra `Starter` (256 MB) til `Standard` (1 GB).
   - Oppgradering krever restart (~30 sek).

4. **Verifiser at `maxmemory-policy` er riktig:**
   - Default i Render: `noeviction` (forkastes ikke; nye writes feiler når full). Dette er trygt for compliance.
   - **ALDRI sett `allkeys-lru`** i prod — det vil evict-e armed-state midt i runde.

### 4.4 Surgical recovery av enkelt-rom

Hvis ett spesifikt rom er stuck etter Redis er tilbake (orphan reservasjon), nuke lifecycle-state:

```bash
ROOM_CODE="B-0001"
redis-cli -u "$REDIS_URL" DEL \
  "bingo:room:$ROOM_CODE:armedTickets" \
  "bingo:room:$ROOM_CODE:selections" \
  "bingo:room:$ROOM_CODE:reservations" \
  "bingo:room:$ROOM_CODE:armCycle" \
  "bingo:room:$ROOM_CODE:lock"
```

Dette tilsvarer `disarmAllPlayers`. Wallet-reservasjoner i Postgres
ryddes av `WalletReservationExpiryService` innen 5 min, eller manuelt:

```sql
UPDATE app_wallet_reservations
   SET status = 'expired'
 WHERE status = 'active'
   AND room_code = '<room-code>';
```

### 4.5 Multi-node fanout-bus tap (Socket.IO Redis-adapter)

På Render `pro`-plan med 2+ noder bruker vi `@socket.io/redis-adapter`
for cross-node fanout. Hvis Redis dør:

- **Single-node deploy:** ingen impact.
- **Multi-node:** klienter på node A ser ikke draws fra node B før Redis er tilbake.

**Mitigation:**

1. Verifiser deploy-modus:
   ```bash
   # Sjekk antall noder
   curl -fsS https://api.spillorama.no/health | jq .checks.workers
   ```

2. Hvis multi-node: sett midlertidig 1-node-mode under utfall:
   - Render-dashboard → service → Plan → Scale to 1
   - Eller akseptere midlertidig fanout-svikt og varsle hall-eierne.

3. Etter Redis tilbake: skaler tilbake til ønsket antall noder.

---

## 5. Stop the bleeding — om utfall vedvarer > 5 min

Hvis Redis ikke kommer tilbake innen 5 min:

1. **Sett alle haller i maintenance:**
   ```sql
   UPDATE app_halls SET is_active = false;
   ```

2. **Status-side:** publiser `major` incident:
   ```sql
   INSERT INTO app_status_incidents (
     title, description, status, impact, affected_components, created_by_user_id
   ) VALUES (
     'Midlertidig redusert kapasitet',
     'Vi opplever forsinkelser i en av våre tjenester. Pågående brett er trygge — vi er tilbake snart.',
     'investigating',
     'major',
     '["bingo","rocket","monsterbingo"]'::jsonb,
     'admin-user-id-her'
   );
   ```

3. **Hall-eier-melding** med template fra
   [`INCIDENT_RESPONSE_PLAN.md`](./INCIDENT_RESPONSE_PLAN.md) §6.1.

4. **Eskalér til Render-support** hvis tjenesten ikke kommer tilbake.

---

## 6. Verifisering

| Sjekk | Kommando | Forventet |
|---|---|---|
| Redis lever | `redis-cli -u "$REDIS_URL" PING` | `PONG` |
| Backend tilkoblet | `grep "RoomLifecycleStore provider: redis" render.log` | Loggrad finnes |
| Multi-node fanout aktiv | `grep "redis-adapter ENABLED" render.log` | Loggrad finnes (kun multi-node) |
| Aktive runder fortsetter | Hall-vakt manuelt | OK |
| Stale wallet-reservasjoner ryddet | `SELECT COUNT(*) FROM app_wallet_reservations WHERE status='active' AND expires_at < NOW();` | 0 etter 5 min |
| Memory-bruk under terskel | `redis-cli INFO memory \| grep used_memory_human` | < 70% av plan-grense |
| Ingen ledger-tap | Compliance-cron grønn neste døgn | OK |

### 6.1 Etter utfall — fjern manuell maintenance

```sql
-- Når Redis er stabil og verifisering grønn:
UPDATE app_halls SET is_active = true WHERE id IN (...);

-- Status-side:
UPDATE app_status_incidents
SET status = 'resolved', resolved_at = now()
WHERE id = '<incident-id>';
```

---

## 7. Communication

### 7.1 Slack — under utfall

```
:rotating_light: P1/P2 | Redis-utfall | [hh:mm]

Symptom: [eks. "Klienter ser 'Brett mistet' i alle haller"]
Berørt: Live-rom (Spill 1/2/3) + nye sessions
Status: investigating
Eier: @[L2-vakt]
Forventet løsning: [eks. "5–10 min etter restart"]

Live-tråd: :thread:
```

### 7.2 Hall-eier-template

```
Tittel: Spillorama: Midlertidig kapasitets-forsinkelse

Hei [hall-eier-navn],

Vi opplever en midlertidig forsinkelse på vår infrastruktur som påvirker
nye spillebrett.

Hva er påvirket:
- Spillere som er midt i en runde fortsetter normalt — pengene er trygge.
- Nye brett-kjøp kan svare tregt eller feile midlertidig.

Hva vi gjør:
- Vi har identifisert problemet og restarter komponenten nå.
- Forventet løsning: [eks. "innen 5 min"]

Vi sender oppdatering når problemet er løst.

Kontakt:
- Akut: [L1-on-call-telefon]

Hilsen,
Spillorama Operations
```

### 7.3 Spiller-melding (i klient via status-side)

Status-incident med `impact='major'` gir gult banner. Tekst:

> "Midlertidig forsinkelse — vi er tilbake snart. Pågående brett er trygge."

---

## 8. Post-mortem

Alle Redis-utfall > 2 min krever post-mortem per
[`INCIDENT_RESPONSE_PLAN.md`](./INCIDENT_RESPONSE_PLAN.md) §7.

Spesifikke spørsmål:

1. **Var det Render-side, kode-side, eller config-side?**
2. **Hvor mange spillere mistet armed-state?** Tell unike `walletId` i
   `bet:arm`-events siste 30 min før utfall.
3. **Eventuelle commitede runder med korrupt Redis-checkpoint?** Sjekk
   `[HIGH-4] Recovery integrity` i boot-loggen.
4. **Ledger-konsistens?** Sammenlign `compliance_ledger.created_at` med
   utfalls-vinduet.
5. **Memory-trend?** Hvis OOM: hva forårsaket veksten?

Action items kan inkludere:

- Oppgradere Redis-plan
- Legge til alert på `used_memory_human > 70%`
- Sjekke om `maxmemory-policy` er konfigurert riktig
- Skript for å rydde orphan rooms

---

## 9. Drill-anbefaling

### 9.1 Pre-pilot — obligatorisk

- D-REDIS-1 (matcher D2 i [`LIVE_ROOM_DR_RUNBOOK.md`](./LIVE_ROOM_DR_RUNBOOK.md) §12): Redis-utfall i staging mens 5 testbrukere er midt i en runde. Mål reconnect + recovery innen 5 min.

### 9.2 Kvartalsvis

- D-REDIS-2: Memory-pressure-drill. Fyll Redis nær plan-grense, observer at writes feiler tydelig, restart, verifiser recovery.

### 9.3 Halvårlig

- D-REDIS-3: Multi-node fanout-test. Drep Redis i multi-node staging, verifiser at fanout brytes, men single-node-fallback fungerer.

### 9.4 Standard drill-prosedyre (D-REDIS-1, ~1 time)

**Pre-state:**
- Staging-instans med 4 haller demo-seed
- 5 testbrukere armed i forskjellige rom
- Aktive scheduled games i `running`-status

**Steg:**

1. **Note pre-state:**
   ```bash
   redis-cli -u "$STAGING_REDIS_URL" --scan --pattern "bingo:room:*:armedTickets" | wc -l
   psql "$STAGING_PG" -c "SELECT COUNT(*) FROM app_wallet_reservations WHERE status='active';"
   ```

2. **Force-restart Redis:**
   - Render-dashboard → Staging Redis → Manual Restart

3. **Mål:**
   - Tid fra restart til Redis PING returnerer PONG
   - Tid fra Redis tilbake til backend re-koblet (Sentry-events stoppes)
   - Tid fra recovery til alle armed-states tilbake (eller refundert)

4. **Verifiser:**
   - Boot-logg viser korrekt boot-sekvens
   - Aktive runder fortsetter
   - Wallet-reservasjoner ryddes
   - Compliance-ledger ingen tap

5. **Logg drill** i `docs/operations/dr-drill-log/<yyyy-mm>-REDIS-N.md`.

**Suksesskriterier:**
- ✅ Recovery-tid < 5 min
- ✅ 0 datatap i compliance-ledger
- ✅ Spillerne kan re-arme innen 30 min (via TTL-expiry)
- ✅ Ingen `[HIGH-4] Recovery integrity drift > 0`

---

## 10. Konfigurasjon — checks før pilot

- [ ] `REDIS_URL` satt i prod-env (Render env-vars)
- [ ] `ROOM_STATE_PROVIDER=redis` konfigurert
- [ ] `SCHEDULER_LOCK_PROVIDER=redis` konfigurert
- [ ] Redis `maxmemory-policy=noeviction` (ikke `allkeys-lru`)
- [ ] Redis-plan-grense ≥ 1 GB (anbefalt før pilot)
- [ ] Render-uptime-probe på Redis aktivert
- [ ] Alert på `used_memory_human > 70%` konfigurert
- [ ] D-REDIS-1 utført med pass-status
- [ ] Multi-node fanout (BIN-494) testet (om relevant)

---

## 11. Anti-mønstre — ikke gjør

### 11.1 Ikke kjøre `FLUSHALL` uten å forstå konsekvensene

`FLUSHALL` sletter ALL Redis-state, inkludert armed-tickets, selections,
locks, og fanout-channels. Det vil ta ned alle aktive sessions samtidig.
Bruk surgical DEL i stedet.

### 11.2 Ikke endre `maxmemory-policy` mid-shift

Bytte fra `noeviction` til `allkeys-lru` er ikke en fix — det er en
NY bug. Spillere mister armed-state mens de spiller.

### 11.3 Ikke restart backend mens Redis er nede

Backend boot er eager-connect mot Redis. Hvis Redis er nede, backend
exiter med kode 1 og Render auto-restarter i loop. Vent til Redis er
tilbake først.

### 11.4 Ikke deploy under Redis-utfall

Render-deploy bygger ny image og restarter. Hvis Redis ikke er klar,
boot feiler.

---

## 12. Eierskap

| Rolle | Ansvar |
|---|---|
| L2 backend on-call | Eier Redis-utfall-detection og restart-prosedyre |
| L3 incident commander | Bestemmer maintenance-mode og status-incident |
| Tobias | Endelig myndighet på Redis-plan-oppgradering |
| DevOps | Sikrer Redis-config og alerts |

---

## 13. Referanser

- [`INCIDENT_RESPONSE_PLAN.md`](./INCIDENT_RESPONSE_PLAN.md) — overordnet incident-flow
- [`LIVE_ROOM_DR_RUNBOOK.md`](./LIVE_ROOM_DR_RUNBOOK.md) §4 — Redis i kontekst av rom-recovery
- [`REDIS_KEY_SCHEMA.md`](./REDIS_KEY_SCHEMA.md) — Redis-key-skjema og surgical recovery
- [`RENDER_GITHUB_SETUP.md`](./RENDER_GITHUB_SETUP.md) — multi-node fanout-config
- [`DISASTER_RECOVERY_PLAN_2026-04-25.md`](./DISASTER_RECOVERY_PLAN_2026-04-25.md) — overordnet DR
- `apps/backend/src/util/RedisRoomLifecycleStore.ts` — implementation
- `apps/backend/src/util/RoomLifecycleStore.ts` — interface
