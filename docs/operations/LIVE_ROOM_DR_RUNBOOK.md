# Live-rom Disaster Recovery Runbook (R12 / BIN-816)

**Owner:** Technical lead (Tobias Haugen)
**On-call rotation:** TBD — fastsettes før pilot-start (se §10).
**Last updated:** 2026-05-08
**Pilot-gating:** Ja — denne runbooken må være øvd minst én gang per scenario før første hall går live.

> Denne runbooken er **rom-spesifikk** og dekker scenarier som påvirker
> en aktiv eller ventende **live-runde** (Spill 1, 2, 3) — der spillere
> har brett armed/kjøpt og kuler trekkes eller skal trekkes.
>
> For generell backend-DR (Postgres-restore, region-failover, Swedbank-
> reconcile) viser denne runbooken til den eksisterende
> [`DISASTER_RECOVERY_PLAN_2026-04-25.md`](./DISASTER_RECOVERY_PLAN_2026-04-25.md)
> i stedet for å duplisere prosedyrer. R12 fokuserer på den siste
> meteren mellom backend og spilleropplevelsen — selve rommet.

---

## 0. TL;DR for travle PM-er

Tre ting denne runbooken eksisterer for:

1. **Bevise at vi kan restore en runde.** Hvis backend faller midt i
   `draw 47 av Rad 3`, har vi en testet prosedyre som tar oss tilbake
   til `draw 47` uten at en ball forsvinner og uten dobbelt-payout.
2. **Beskytte compliance-loggen.** Pengespillforskriften krever at hver
   ball + hvert payout er auditerbart. En recovery som taper en
   `game.draw`-event eller dobler en `game.pattern.won`-event er en
   rapporterbar hendelse til Lotteritilsynet.
3. **Holde spillerne informert.** Når en runde fryser kan vi ikke skjule
   det. §10 "Communication-template" gir hall-eier eksakt tekst å sende
   til spillerne mens vi recover.

7 scenarier dekket:

| # | Scenario | Worst-case impact | Recovery RTO |
|---|---|---|---|
| S1 | Backend-instans dør midt i Spill 1-runde | Flere haller fryser samtidig | < 2 min reconnect |
| S2 | Redis dør (rom-state tapt) | Alle armed-states slettes | < 5 min restart |
| S3 | Postgres-primary failover | Mulig duplikat-draw etter failover | < 30 min verifisert |
| S4 | Render-region down (Frankfurt) | Hele plattformen nede | Manuell, timer |
| S5 | DDoS / rate-limit-flom | Live-rom kveler eller fryser | < 10 min mitig. |
| S6 | Manuell rolling restart | Risiko for tapt mid-runde-state | < 90 sek per node |
| S7 | Spill 2 perpetual-loop-leak (akut) | OOM, alle spill-typer påvirket | < 15 min |

Alt under er **prosedyre**, ikke implementasjon. Rekkefølgen i hver §
er den faktiske on-call-handlingen — ikke en akademisk klassifisering.

---

## 1. Scope

### 1.1 Inkludert

- **Spill 1 (`bingo`-familien)** — multi-hall master-styrt, 12 katalog-
  varianter inkl. Trafikklys og Oddsen.
- **Spill 2 (`rocket`)** — globalt rom, full plate, perpetual-loop.
- **Spill 3 (`monsterbingo`)** — globalt rom, 5×5 75-ball, perpetual-loop.
- Alle aktive scheduled games i `app_game1_scheduled_games` med status
  `ready_to_start`, `running` eller `paused`.
- Alle armed wallet-reservasjoner (`app_wallet_reservations.status='active'`).
- Alle Redis-state-keys under `bingo:room:*`-prefiks.
- Master-handshake (`transferHallAccess`) i flight.

### 1.2 Ekskludert (peker til andre runbooks)

| Tema | Runbook |
|---|---|
| Generell DB-backup-strategi, RPO, PITR-prosedyre | [`DISASTER_RECOVERY_PLAN_2026-04-25.md`](./DISASTER_RECOVERY_PLAN_2026-04-25.md) §4 |
| Hall-internett-kutt | [`DISASTER_RECOVERY_PLAN_2026-04-25.md`](./DISASTER_RECOVERY_PLAN_2026-04-25.md) §5 + [`HALL_PILOT_RUNBOOK.md`](./HALL_PILOT_RUNBOOK.md) |
| Enkelt-terminal-feil i hall | [`DISASTER_RECOVERY_PLAN_2026-04-25.md`](./DISASTER_RECOVERY_PLAN_2026-04-25.md) §6 |
| Swedbank reconcile | [`DISASTER_RECOVERY_PLAN_2026-04-25.md`](./DISASTER_RECOVERY_PLAN_2026-04-25.md) §8 |
| Rollback til Unity-klient per hall | [`ROLLBACK_RUNBOOK.md`](./ROLLBACK_RUNBOOK.md) |
| Migrate-feil under deploy | [`MIGRATION_DEPLOY_RUNBOOK.md`](./MIGRATION_DEPLOY_RUNBOOK.md) |
| Render env-vars + secrets | [`RENDER_ENV_VAR_RUNBOOK.md`](./RENDER_ENV_VAR_RUNBOOK.md) |
| Observability: alerts, dashboards, metrics | [`OBSERVABILITY_RUNBOOK.md`](./OBSERVABILITY_RUNBOOK.md) + [`LIVE_ROOM_OBSERVABILITY_2026-04-29.md`](./LIVE_ROOM_OBSERVABILITY_2026-04-29.md) |
| Redis-state surgical recovery | [`REDIS_KEY_SCHEMA.md`](./REDIS_KEY_SCHEMA.md) |

### 1.3 Compliance-felter som MÅ overleve enhver recovery

Per [`SPILL_REGLER_OG_PAYOUT.md`](../architecture/SPILL_REGLER_OG_PAYOUT.md)
§9.6 og pengespillforskriften §71 må følgende skrives til
`app_compliance_ledger` for hvert payout og overleve enhver disaster:

- `prizeAmountCents`, `ticketColor`, `ticketPriceCents`, `bongMultiplier`
- `potCentsForBongSize`, `winningTicketsInSameSize`, `winningPlayersInSameSize`
- `actor_hall_id` (hall som **solgte** bongen — ikke master-hallen)
- `gameVariant` (standard/trafikklys/oddsen) + spesial-felter
  (`rowColor` for Trafikklys, `targetDraw`+`outcomeBucket` for Oddsen)
- `idempotency_key` (UNIQUE-constraint stopper dobbelt-skriv)

Hver scenario nedenfor bekrefter eksplisitt om denne dataen er trygg
eller må verifiseres manuelt etter recovery.

---

## 2. Detection-overordnet (felles for alle scenarier)

### 2.1 Automatiske kanaler

| Signal | Kilde | Når trigger |
|---|---|---|
| `/health` 5xx eller timeout | Render uptime probe (30s) | Backend nede |
| `bingo_socket_connections` drop > 50% på 60s | Grafana `connection-health` | Massiv disconnect |
| `spillorama_reconnect_total` > 5%/min | Grafana + Slack | Klient-side reconnect-storm |
| `bingo_draw_errors_total{category="LOCK_TIMEOUT"}` spike | Grafana | Scheduler-lock-tapt eller Redis-treig |
| Sentry `spillorama-backend` exception-burst | Sentry | Engine kaster |
| `game.draw`-event-stream stoppet i Render-log | Manuell grep | Aktiv runde fryst |

### 2.2 Manuelle kanaler

- Hall-bingovert ringer L1-vakt (se [`HALL_PILOT_RUNBOOK.md`](./HALL_PILOT_RUNBOOK.md)
  §2 kontaktkjede).
- Spillere klager via support på "Bingo-skjermen henger".
- L2 backend on-call observerer i Render-log at `auto.round.tick` ikke
  produserer events.

### 2.3 Konfirmer at det faktisk er rom-relatert

Før du følger en av §3–§9, gjør 60-sekunders triage:

```bash
# 1. Backend lever?
curl -fsS https://api.spillorama.no/health | jq .
# Forventet: {"ok":true,"status":"healthy",...}

# 2. Hvor mange rom har armed players?
redis-cli -u "$REDIS_URL" --scan --pattern "bingo:room:*:armedTickets" | wc -l

# 3. Er scheduler-tick-en aktiv?
grep '"event":"auto.round.tick"' render.log | tail -5

# 4. Pågår det aktive runder i DB?
psql "$APP_PG_CONNECTION_STRING" -c "
  SELECT id, room_code, master_hall_id, status,
         scheduled_start_time, scheduled_end_time
    FROM app_game1_scheduled_games
   WHERE status IN ('ready_to_start','running','paused')
ORDER BY scheduled_start_time DESC LIMIT 20;
"
```

Hvis backend er sunn, Redis har armed-rom, og scheduler tikker —
sjansen er stor at problemet er hall-side, ikke rom-side. Gå tilbake
til [`HALL_PILOT_RUNBOOK.md`](./HALL_PILOT_RUNBOOK.md) §5.

---

## 3. S1 — Backend-instans dør midt i en Spill 1-runde

### 3.1 Trigger

- OOM på Render-noden (typisk når memory-leak treffer plan-ceiling).
- Deploy som uventet feilet og tok ned forrige image.
- Ukjent uncaught-exception i engine-tråd.
- Render-region-glitch (kort, < 60 sek).

### 3.2 Detection

- Render uptime probe failer innen 30 sek → automatisk restart trigges.
- `spillorama_reconnect_total` spiker når alle klienter mister
  socket samtidig.
- Sentry mottar exception før prosessen dør (graceful-shutdown
  Sentry flush).

### 3.3 Impact

- **Spillere ser:** "Mistet kontakt med spillet, prøver igjen…"
  Reconnect-spinner på terminaler i alle haller i alle aktive
  multi-hall-grupper.
- **Master-hall ser:** dashboard-en mister kontakt; "Start neste
  spill"-knappen blir grå.
- **TV-skjerm:** fryser på siste mottatte ball-state.
- **Compliance:** alle commits før crash er trygge (Postgres),
  men `bet:arm`-state i Redis kan tapes hvis Redis ikke er K4-Redis-
  backed (se §4).
- **Pengespillforskriften:** hvis runden ikke recovers innen forsvarlig
  tid (typisk 10 min) skal Lotteritilsynet varsles (se
  [`DISASTER_RECOVERY_PLAN_2026-04-25.md`](./DISASTER_RECOVERY_PLAN_2026-04-25.md)
  §8.5 SLA-tabell).

### 3.4 Mitigation — steg-for-steg

1. **Bekreft at Render auto-restarter noden.** Forventet downtime:
   30–90 sek. Hvis Render-dashboard viser "Deploy failed" → gå til
   [`MIGRATION_DEPLOY_RUNBOOK.md`](./MIGRATION_DEPLOY_RUNBOOK.md) §3
   først.
2. **Følg boot-sekvensen i Render-loggen** (`apps/backend/src/index.ts:4240–4360`):
   - `[BIN-K4] RoomLifecycleStore provider: redis` — Redis K4-store
     koblet til.
   - `[responsible-gaming] persisted state hydrated` — engine state
     hydrert fra Postgres.
   - `[BIN-170] Loaded N room(s) from Redis` — full game-snapshot
     restaurert.
   - `[BIN-245] Recovery complete: X game(s) restored, Y game(s) ended`
     — incomplete games re-attached eller force-ended.
   - `[HIGH-4] Recovery integrity: X/Y rom OK` — Redis ↔ PG-checkpoint-
     drift verifisert.
   - `[game1-recovery] Inspected N scheduled games — cancelled X overdue`
     — schedule-tabell ryddet.
3. **Verifiser at klientene reconnecter.** Grafana
   `spillorama-connection-health`:
   - `bingo_socket_connections` skal komme tilbake til pre-crash-nivå
     innen 2 min.
   - `spillorama_reconnect_total{reason="transport close"}` skal flate
     ut innen 3 min.
4. **Hvis runden var i `running`-status:** master-bingovert må klikke
   "Resume" for å starte draw-en igjen — engine BIN-695 setter
   `paused=true` på alle uavgjorte rader ved boot for å unngå at
   recovery-en "stjeler" en seier.
5. **Hvis runden var i `ready_to_start`-status:** master kan starte på
   nytt — ingen state mistet.
6. **Hvis runden var i `paused`-status (BIN-695-utløst eller manuelt):**
   `pause_at_phase`-feltet i `app_game1_scheduled_games` peker på
   siste payout-fase. Master ser samme pause-state som før crash.

### 3.5 Verifikasjon

| Sjekk | Kommando / kilde | Forventet |
|---|---|---|
| Engine-state restaurert per rom | `grep "BIN-170" render.log \| tail -5` | "Loaded N room(s)" hvor N matcher pre-crash |
| Ingen orphan-reservasjoner | `SELECT COUNT(*) FROM app_wallet_reservations WHERE status='active' AND expires_at < NOW();` | 0 (etter `WalletReservationExpiryService`-tick) |
| Klienter reconnected | Grafana `bingo_socket_connections` | Tilbake til pre-crash-nivå |
| Hver hall har sin master | `SELECT master_hall_id, COUNT(*) FROM app_game1_scheduled_games WHERE status='running' GROUP BY 1;` | Én rad per (hall, runde), ingen NULL |
| `actor_hall_id` korrekt på alle ledger-rader | Spotcheck: `SELECT actor_hall_id, hall_id FROM app_compliance_ledger WHERE created_at > NOW() - INTERVAL '5 minutes';` | `actor_hall_id` = hall som solgte bongen, ikke master-hall |

### 3.6 Post-mortem-krav

- **Sentry breadcrumb-trail** for crash → eksporter til incident-log.
- **Eventuelle tapte `game.draw`-events** identifiseres ved å sammenligne
  `drawnNumbers.length` i checkpoint vs Render-log-grep
  `'"event":"game.draw"' AND '"gameId":"<id>"'`.
- **Hvis ledger-mismatch (en payout uten matchende `idempotency_key`):**
  SEV-1, Lotteritilsynet-varsel innen 24t.
- Skriv kort hendelses-rapport i `docs/operations/incident-log/`
  med tidspunkt + crash-årsak + recovery-tid.

---

## 4. S2 — Redis-instans dør (rom-state tapt)

### 4.1 Trigger

- Render Redis-instans får OOM eller restartes.
- Nettverks-glitch mellom backend og Redis.
- Redis-konfig endret feil (eks. `maxmemory-policy=allkeys-lru` med
  for liten cap → keys evictes uten varsel).

### 4.2 Detection

- Backend logger `Error: connect ECONNREFUSED` eller `READONLY` ved
  Redis-skriv.
- `bingo_draw_errors_total{category="LOCK_TIMEOUT"}` spiker — engine
  kan ikke hente scheduler-lock.
- Sentry exception-burst: `RedisRoomLifecycleStore.armPlayer` /
  `evictPlayer` failer.
- Hvis backend ikke kan koble til Redis ved boot (`ROOM_STATE_PROVIDER=redis`):
  prosessen exiter med kode 1 (eager-connect i `RoomLifecycleStore`).

### 4.3 Impact

- **Spillere som ikke har commitet `startGame`:** alle armed-states i
  Redis (`bingo:room:*:armedTickets`, `:reservations`) er TAPT.
  Spilleren ser "Brett ikke armed lenger" — må re-arme manuelt.
- **Spillere som har commitet `startGame`:** runden kjører videre
  fra Postgres-checkpoint. Wallet-debit er allerede skrevet → ingen
  pengetap.
- **Wallet-reservasjoner (Postgres):** rader med `status='active'` er
  fortsatt i DB. `WalletReservationExpiryService` rydder etter 30 min
  TTL.
- **Compliance:** ingen ledger-rader tapt. Reservasjoner som aldri ble
  committed gir ingen ledger-skriv (by design — ledger-skriv skjer ved
  `startGame`, ikke `bet:arm`).
- **Socket.IO Redis-adapter (BIN-494):** cross-instance-fanout dør.
  Hvis backend er multi-instance (Render `pro`-plan med 2+ noder),
  vil hver node kun broadcaste til egne klienter — manifesterer som
  "noen klienter ser nye draws, andre ikke". I `starter`-plan med
  1 node er dette ikke et problem.

### 4.4 Mitigation — steg-for-steg

1. **Bekreft at Redis er nede:**
   ```bash
   redis-cli -u "$REDIS_URL" PING
   # Forventet: PONG. Får du timeout/ECONNREFUSED → Redis er nede.
   ```
2. **Hvis Render Redis-instans:** Render-dashboard → Redis-tjeneste →
   Restart. Forventet downtime: 30–60 sek.
3. **Hvis nettverksbruck:** sjekk Render-status-siden + region-helse.
   Vent 1–2 min for selvrecovery.
4. **Restart backend** etter at Redis er tilbake. Backend boot-er
   eager-connect mot Redis; vellykket boot = full restored state.
   ```bash
   # Render-dashboard → Manual Deploy → Restart (uten ny build)
   ```
5. **Surgical recovery av enkelt-rom som henger** (etter Redis er
   tilbake men en bestemt room-state er korrupt) — se
   [`REDIS_KEY_SCHEMA.md`](./REDIS_KEY_SCHEMA.md) §6:
   ```bash
   redis-cli -u "$REDIS_URL" DEL \
     "bingo:room:B-0001:armedTickets" \
     "bingo:room:B-0001:selections" \
     "bingo:room:B-0001:reservations" \
     "bingo:room:B-0001:armCycle" \
     "bingo:room:B-0001:lock"
   ```
6. **Spillerne som mistet armed-state må re-armes.** Bingovert
   annonserer i hallen: "Spillorama-systemet ble nullstilt. Vennligst
   trykk på brettene dine på nytt." Push-notifikasjon til online-
   spillere via FCM.
7. **Hvis perpetual-rom (Spill 2/3)** er stuck etter Redis-restart:
   verifiser at `PerpetualRoundService` plukker opp neste runde via
   `auto.round.tick`-event innen 30 sek (default
   `PERPETUAL_LOOP_DELAY_MS`). Hvis ikke, restart backend en ekstra
   gang.

### 4.5 Verifikasjon

| Sjekk | Kommando | Forventet |
|---|---|---|
| Redis lever | `redis-cli -u "$REDIS_URL" PING` | `PONG` |
| Backend koblet til | `grep "redis-adapter ENABLED" render.log \| tail -1` | Loggrad finnes |
| Ingen ledger-tap | `SELECT COUNT(*) FROM app_compliance_ledger WHERE created_at > <crash-time>;` | Matcher pre-crash count + nye runder |
| Stale wallet-reservasjoner ryddet | `SELECT COUNT(*) FROM app_wallet_reservations WHERE status='active' AND expires_at < NOW();` | 0 etter `WalletReservationExpiryService`-tick (~5 min) |
| Aktive runder fortsetter | Master ser "Resume"-knapp etter Redis-restart | Manuell sjekk i hall |

### 4.6 Post-mortem-krav

- **Hvor mange spillere mistet armed-state?** Tell unike `walletId` i
  `bet:arm`-events siste 30 min før crash.
- **Eventuelle commitede runder med korrupt Redis-checkpoint** flagges
  via `[HIGH-4] Recovery integrity` i boot-loggen — verifiser at
  drift-count = 0 etter recovery.
- **Hvis dette er andre Redis-utfall denne uken:** opp i severity og
  vurder å oppgradere Redis-plan.

---

## 5. S3 — Postgres-primary failover

### 5.1 Trigger

- Render-managed Postgres failover (planlagt eller automatisk).
- Disk-full på primary → backend ser writes feile.
- Replica-lag overskrider terskel og Render flipper primary.

### 5.2 Detection

- Sentry exception-burst: `Error: terminating connection due to
  administrator command` eller `the database system is shutting down`.
- `bingo_draw_errors_total{category="DB_ERROR"}` spiker.
- Render-dashboard viser "Postgres restarted" event.
- Wallet-debit kan failer → spillere ser "Kjøp feilet, prøv igjen"
  midt i `bet:arm`-flyt.

### 5.3 Impact

- **Aktive runder:** kan oppleve 30–120 sek med write-failures.
  `Game1DrawEngineService` har retry-logic via Postgres-pool, men hvis
  failover varer > 60 sek vil enkelte writes failer hardt.
- **Compliance-ledger-risiko:** den klassiske failover-risikoen er
  **dobbelt-write etter failover** — hvis app skrev en ledger-rad
  via async-replication og primary feiler før sync, ny primary mangler
  raden men app tror den er skrevet. Idempotency-keyen skal stoppe
  dobbelt-skriv ved retry, men enhver duplikat-feil må logges.
- **Pengespillforskriften:** datatap > RPO (5 min) er meldepliktig
  innen 24 t (se
  [`DISASTER_RECOVERY_PLAN_2026-04-25.md`](./DISASTER_RECOVERY_PLAN_2026-04-25.md)
  §4 + §8.5 SLA).

### 5.4 Mitigation — steg-for-steg

1. **Bekreft failover-status** i Render-dashboard → Postgres-tjeneste
   → Events. Note tidspunkt for failover-start.
2. **Sjekk write-helse:**
   ```bash
   psql "$APP_PG_CONNECTION_STRING" -c "SELECT pg_is_in_recovery();"
   # Forventet: false (vi snakker til primary, ikke replica).
   ```
3. **Backend skal selv-recovery via pg-pool reconnect.** Hvis ikke
   (sticky sessions, gammel pool-instance), restart backend manuelt.
4. **Verifiser at ingen draw er duplikert** etter failover — den
   farligste failover-feilen:
   ```sql
   -- Finn duplikate draws per (gameId, drawIndex)
   SELECT game_id, draw_index, COUNT(*) AS cnt
     FROM app_game_draws
    WHERE created_at > NOW() - INTERVAL '15 minutes'
    GROUP BY 1, 2
   HAVING COUNT(*) > 1;
   ```
   Forventet: 0 rader. Hvis duplikater finnes → SEV-1, Lotteritilsynet-
   varsel.
5. **Verifiser at ingen ledger-rad er duplikert:**
   ```sql
   SELECT idempotency_key, COUNT(*) AS cnt
     FROM app_compliance_ledger
    WHERE created_at > NOW() - INTERVAL '15 minutes'
    GROUP BY 1
   HAVING COUNT(*) > 1;
   ```
   `idempotency_key` har UNIQUE-constraint, så dette skal være 0
   rader uansett. Hvis det IKKE er 0 → constraint er kompromittert,
   SEV-1, stopp all spill-aktivitet.
6. **Hvis duplikater bekreftes:**
   - Sett `app_halls.is_active=false` for alle berørte haller.
   - Skriv `correction`-ledger-rader (negativt beløp) for hver duplikat
     — ALDRI delete originaler.
   - Compliance-eier signerer korrigeringer.
7. **Resume drift** når DB-helse er bekreftet (replica-lag < 5 sek,
   ingen write-failures i 5 min).

### 5.5 Verifikasjon

| Sjekk | Kommando | Forventet |
|---|---|---|
| Backend tilkoblet | `curl -s /health \| jq .checks.database` | `"operational"` |
| Ingen duplikate draws | SELECT-en i §5.4 steg 4 | 0 rader |
| Ingen duplikate ledger-rader | SELECT-en i §5.4 steg 5 | 0 rader |
| Replica-lag tilbake | Render Postgres dashboard | `< 5 sek` |
| Wallet-balanse konsistent | `SELECT COUNT(*) FROM app_wallets WHERE balance < 0;` | 0 (negativ saldo umulig per casino-grade-wallet) |

### 5.6 Post-mortem-krav

- Failover-årsak (planlagt vs trigget av disk/replica-lag).
- Antall write-failures observert i windowet.
- Eventuelle duplikate draws/ledger — eskalering til Lotteritilsynet.
- Vurder oppgradering til synkron-replikering hvis dette gjentar seg.

---

## 6. S4 — Full Render-region down (Frankfurt)

### 6.1 Trigger

Hele Render Frankfurt-regionen utilgjengelig pga
infrastruktur-hendelse (sjelden — Render har historikk på 1–2 incidents
per år, typisk varighet 30 min – 2 timer).

### 6.2 Detection

- `/health` timeout fra alle eksterne synthetic-monitors.
- Render-status-siden viser "Frankfurt — investigating".
- Hall-bingoverter ringer alle samtidig.

### 6.3 Impact

- **HELE Spillorama-plattformen er nede.** Ingen spill, ingen
  innskudd, ingen admin-tilgang.
- **Pågående runder:** kuttes uventet. Spillere som var midt i en runde
  ser "Mistet kontakt" og kan ikke reconnecte før regionen er tilbake.
- **Compliance:** ingen pengetransaksjoner kan committes. Audit-trail
  er trygg (alt som er commitet før utfallet er i Postgres-snapshots).

### 6.4 Mitigation — det vi GJØR i dag

> **Status 2026-05-08:** Vi har **ingen multi-region failover-plan** i
> dag. Render Frankfurt er single-point-of-failure. Dette er en kjent
> akseptert risiko per
> [`DISASTER_RECOVERY_PLAN_2026-04-25.md`](./DISASTER_RECOVERY_PLAN_2026-04-25.md)
> §10 risiko #1.

Mens vi venter på regionen kommer tilbake:

1. **Bekreft at det er regionsutfall**, ikke vår applikasjon.
   - Render status: https://status.render.com/
   - Annen Render-tjeneste vi har: `candy-backend-ldvg.onrender.com`
     (Candy-iframe). Hvis den også er nede → Render-region.
   - Hvis det ER vår app: gå til S1 i stedet.
2. **Annonser status** til alle hall-eiere via communication-template
   (se §10.1). Bruk SMS — Slack/email kan også være nede hvis de
   er i samme region.
3. **Sett opp midlertidig status-side** hvis ikke `/api/status` er
   tilgjengelig:
   - Bruk Render-uavhengig statisk site (Cloudflare Pages, GitHub
     Pages) eller manuell SMS-broadcast.
4. **Når regionen er tilbake:** følg S1 §3.4 boot-recovery-prosedyren.
   Engine + scheduler kommer opp og recover incomplete games.
5. **Compliance-rapport:** alle utfall > 1 time + 50% av haller utløser
   Lotteritilsynet-varsel innen 24t (se
   [`DISASTER_RECOVERY_PLAN_2026-04-25.md`](./DISASTER_RECOVERY_PLAN_2026-04-25.md)
   §8.5).

### 6.5 Mitigation — det vi BURDE GJØRE (fremtid)

Følgende er ikke implementert i dag og ville krevd dev-tid + budsjett:

1. **Cold-standby i andre Render-region** (Oregon, Singapore) — månedlig
   failover-test. Estimert dev-tid 2–5 dager + ekstra ~2000 NOK/mnd.
2. **Active-passive med Postgres async-replication** — estimert dev-tid
   5+ dager + ~5000 NOK/mnd.
3. **Out-of-band notification-kanal** — Twilio SMS-fallback, ikke i
   Render. Krever ny tjeneste + integration.

Disse er flagget som follow-up i §11. Ikke fix i denne runbooken.

### 6.6 Verifikasjon (etter regionen er tilbake)

Følg S1 §3.5 verifikasjon + ekstra:

| Sjekk | Forventet |
|---|---|
| Antall scheduled games i `running`-status | 0 (skal alle være cancelled av `Game1RecoveryService`) |
| Antall scheduled games i `paused`-status | Kan være > 0 om recovery-pass enda ikke kjørt |
| Wallet-reservasjoner med `expires_at < NOW()` | Ryddes av expiry-tick innen 5 min |

### 6.7 Post-mortem-krav

- **Total nedetid** i timer + minutter.
- **Antall haller berørt** (alle 23 hvis full region).
- **Antall ledger-rader skrevet før utfall** — sammenlikn snapshot.
- **Lotteritilsynet-rapport** innen 24t (compliance-eier).
- **Ny vurdering av multi-region**: skal vi investere?

---

## 7. S5 — DDoS / rate-limit-traffik

### 7.1 Trigger

- Botnet-angrep mot `/api/auth/login` eller `/api/wallet/me/topup`.
- Aggressive web-scraping av `/api/games`-endpoints.
- Utilsiktet — én buggy klient i en hall som spammer
  `room:join`-events.

### 7.2 Detection

- `bingo_socket_connections` spiker uventet (< 60 sek).
- Render-CPU/memory-graf piker.
- HTTP rate-limit-rejections logges (`HttpRateLimit` middleware).
- Sentry: `RateLimitExceededError` events.
- Legitimate spillere klager: "Kommer ikke gjennom innloggingen".

### 7.3 Impact

- **Live-rom kan kveles** hvis backend-tråden er opptatt med å
  håndtere falsk traffik. Draw-tick latens går opp.
- **Legitime spillere ser** "Innlogging feilet, prøv igjen".
- **Pågående runder:** holder seg, men kan oppleve 5–10 sek lag
  mellom draws hvis backend er overbelastet.

### 7.4 Mitigation — steg-for-steg

1. **Identifiser kilden:**
   ```bash
   # I Render-loggen: top 10 IP-adresser siste 5 min
   grep '"event":"http.request"' render.log | jq -r '.ip' | sort | uniq -c | sort -rn | head -10
   ```
2. **Hvis DDoS:**
   - Aktiver Cloudflare DDoS-mode hvis tilgjengelig.
   - Block kjente bad IPs på Render-edge (om mulig — Render har
     begrenset support, vurder Cloudflare foran).
   - Skaler backend midlertidig opp (Render-dashboard → tjeneste →
     plan → upgrade). Forventet kostnad: time-basert.
3. **Hvis buggy klient i hall:**
   - Identifiser hall via `socket.connected`-event-IP.
   - Ring hall-vert, be dem stoppe terminalen.
   - Block IP midlertidig på `bingo_socket_connections`-nivå hvis
     mulig.
4. **Beskytt live-rom:** vurder å aktivere
   `MAINTENANCE_MODE_HALLS_ONLY=true` (planlagt env-flag, ikke
   implementert per 2026-05-08) for å la kun haller logge inn,
   ikke nye anonyme connections.
5. **Annonser til spillerne:** "Vi opplever uvanlig belastning, alle
   spill fortsetter normalt. Innlogging kan ta opptil 30 sek." (Bruk
   communication-template §10.2.)

### 7.5 Verifikasjon

| Sjekk | Forventet |
|---|---|
| Backend-CPU < 80% | Grafana CPU-graf |
| Reconnect-rate normalisert | `< 5%/min` |
| `auto.round.tick` produserer events normalt | `grep "auto.round.tick" render.log \| wc -l` (per minutt) |
| Aktive runder fortsetter uten forsinkelse | Manuell sjekk i hall — draw-til-klient-latens < 1 sek |

### 7.6 Post-mortem-krav

- Angrepsvolum (req/sek topp).
- Hvor mye av traffik var legitim vs ondsinnet.
- Eventuelle spillere som ble lockoutet.
- Følg-opp: vurder Cloudflare-foran-Render-arkitektur permanent.

---

## 8. S6 — Manuell rolling restart (rolling deploy)

### 8.1 Trigger

- Planlagt deploy med nye features.
- Hot-fix som krever restart.
- Memory-leak observert, restart for å frigjøre.

### 8.2 Detection

Dette er en aktiv handling, ikke en passiv hendelse. Trigget av:

- PM/tech lead manuelt.
- CI/CD pipeline auto-deploy fra `main`-merge.

### 8.3 Impact

- **Hvis enkelt-instance** (Render `starter`): backend nede 30–90 sek.
  Spillere ser reconnect-spinner.
- **Hvis multi-instance** (Render `pro`): rolling restart, ingen
  brukervisible nedetid hvis Socket.IO Redis-adapter (BIN-494) er
  aktiv. Ellers: noen klienter får tilkoblings-glitch.
- **Mid-runde-state:** hvis aktiv runde kjører, BIN-695 auto-pause-on-
  phase setter runden i `paused`-status ved boot. Master må klikke
  Resume manuelt etter restart.

### 8.4 Når er det TRYGT å restarte

| Situasjon | Trygt? | Hvorfor |
|---|---|---|
| Ingen aktive scheduled games i `running`-status | ✅ Ja | Ingenting å miste |
| Aktive runder, alle i `paused`-status (BIN-695) | ✅ Ja | Master må uansett resume |
| Aktive runder i `running` med `< 10` armed players | ⚠️ Forsiktig | Spillere må reconnecte; vurder å vente |
| Aktive runder i `running` med `≥ 10` armed players | ❌ Nei | Vent til naturlig pause-vindu |
| Spill 2/3 perpetual-loop midt i draw | ⚠️ Forsiktig | Loop spawner ny runde innen 30 sek etter restart |
| Master-handshake (`transferHallAccess`) i flight (60s) | ❌ Nei | Vent 60 sek til handshake er ferdig eller cancelled |

### 8.5 Når er det IKKE trygt

- Under den siste 30 sekundene før et planlagt spill-start (master har
  trykket "Start neste spill").
- Mens en compliance-rapport-eksport kjører (`POST
  /api/admin/reports/daily/run`).
- Mens en wallet-reconciliation-job kjører (nightly,
  hh:mm-spesifikk).

### 8.6 Mitigation — pre-restart-sjekk

```bash
# 1. Aktive runder?
psql "$APP_PG_CONNECTION_STRING" -c "
  SELECT id, master_hall_id, status,
         EXTRACT(EPOCH FROM (NOW() - scheduled_start_time))::int AS elapsed_sec
    FROM app_game1_scheduled_games
   WHERE status IN ('ready_to_start','running','paused')
ORDER BY scheduled_start_time DESC LIMIT 10;
"

# 2. Aktive armed-players?
redis-cli -u "$REDIS_URL" --scan --pattern "bingo:room:*:armedTickets" | wc -l

# 3. Master-handshake i flight?
psql "$APP_PG_CONNECTION_STRING" -c "
  SELECT * FROM app_game1_master_transfers
   WHERE status = 'PENDING' AND expires_at > NOW();
"

# 4. Pågående jobs?
psql "$APP_PG_CONNECTION_STRING" -c "
  SELECT * FROM app_jobs WHERE status = 'RUNNING';
"
```

Hvis alle 4 er trygge → fortsett til restart. Ellers vent eller
koordiner med PM.

### 8.7 Mitigation — post-restart

Følg S1 §3.4 boot-recovery-checklist. Forskjellen fra S1 er at vi
forventer rene logs (ingen exception-burst) og at recovery-tallene er
0/0 (ingen incomplete games å restore).

### 8.8 Verifikasjon

| Sjekk | Forventet |
|---|---|
| `/health` returnerer 200 | Innen 30 sek etter restart |
| Klienter reconnected | `bingo_socket_connections` tilbake til pre-restart-nivå innen 2 min |
| Aktive runder i `paused`-status | Master ser Resume-knapp |
| `[BIN-245] Recovery complete: 0 game(s) restored, 0 game(s) ended` | Logg-grep |

### 8.9 Post-mortem-krav

Kun for restart som tok > 5 min eller som mistet runder:
- Hva tok lang tid? (Build, migrate, hydrate?)
- Var det armed-players som mistet state?

---

## 9. S7 — Spill 2 perpetual-loop-leak (akut)

### 9.1 Trigger

- Memory-leak i `PerpetualRoundService` — typisk pga at
  `setTimeout`-handles akkumuleres uten cleanup.
- `engine.startGame` kastes inni perpetual-loopen og stopper neste
  spawn → hele Spill 2/3 fryser, men prosessen lever.
- Idempotens-bug: samme `gameId` trigger to spawn-trigger →
  dobbel-runde.

### 9.2 Detection

- Memory-bruk klatrer monotonisk → Render-alarm ved 90% plan-grense.
- `auto.round.tick`-events for Spill 2/3 stopper i Render-loggen.
- Spillere klager: "Spill 2 startet ikke ny runde etter forrige
  vinner".
- Sentry exception fra `PerpetualRoundService.scheduleRestart`.

### 9.3 Impact

- **Spill 2 + Spill 3 fryser globalt** (de har KUN ett rom hver per
  Tobias-direktiv 2026-05-03).
- **Spill 1 ikke direkte påvirket**, men hvis OOM treffer går hele
  prosessen ned (trigger S1).
- **Spillere mister ikke penger** — committed runder er ferdige,
  pengene er allerede utbetalt.

### 9.4 Mitigation — siste-utvei: restart prosess uten å miste perpetual-state

> Per Tobias-direktiv 2026-05-03 har Spill 2/3 INGEN persistent
> perpetual-state — hver runde er selvstendig. Det betyr at
> `restart prosess uten å miste perpetual-state` faktisk er trivielt:
> ingenting persisterer, neste boot starter ren loop.

1. **Bekreft at Spill 2/3-loop er stuck:**
   ```bash
   grep '"module":"perpetual-round"' render.log | tail -10
   # Forventet: hyppige spawn-events. Ingen events siste 5 min → stuck.
   ```
2. **Sjekk om Spill 1 også er påvirket** (memory-pressure kan presse
   hele prosessen):
   ```bash
   grep '"event":"auto.round.tick"' render.log | tail -5
   ```
3. **Hvis kun Spill 2/3 er stuck, prosessen ellers sunn:**
   - Force-end aktive perpetual-runder via admin-konsoll:
     ```sql
     UPDATE app_game_sessions
        SET status = 'ENDED', ended_reason = 'PERPETUAL_LOOP_RESET'
      WHERE game_slug IN ('rocket','monsterbingo')
        AND status = 'RUNNING';
     ```
   - Restart backend (forventet downtime: 30–90 sek).
   - Etter boot: `PerpetualRoundService` plukker opp ingen pågående
     runder, og spawner ny runde når første spiller arming i Spill 2/3.
4. **Hvis hele prosessen er på vei mot OOM (>85% memory):**
   - Restart backend umiddelbart — vent ikke til OOM-killer (tap av
     state).
5. **Verifiser at perpetual-loopen kjører igjen:**
   ```bash
   grep '"module":"perpetual-round"' render.log | grep "scheduleRestart" | tail -3
   ```

### 9.5 Verifikasjon

| Sjekk | Kommando | Forventet |
|---|---|---|
| Memory tilbake til baseline | Render dashboard | < 50% av plan-grense |
| Perpetual-loop produserer events | Logg-grep `"module":"perpetual-round"` | Hyppige spawn-events |
| Spillerne kan arme Spill 2/3 | Manuell sjekk på terminal | Brett kan kjøpes |
| Ingen orphan perpetual-runder | `SELECT COUNT(*) FROM app_game_sessions WHERE game_slug IN ('rocket','monsterbingo') AND status='RUNNING' AND created_at < NOW() - INTERVAL '1 hour';` | 0 |

### 9.6 Post-mortem-krav

- **Hvor lang tid mellom siste vellykket spawn og deteksjon?**
- **Hvor mange spillere ble berørt?**
- **Memory-graf** før og etter restart.
- **Hvis dette er andre gang denne uken:** flagg som SEV-2 og spawn
  follow-up-task for å fikse rot-årsaken (memory-leak).

---

## 10. Communication-template

### 10.1 Hall-eier-varsling ved hendelse

**SMS / e-post:**

```
Tittel: Spillorama: [hendelses-type] påvirker [hall(er)]

Hei [hall-eier-navn],

Vi opplever for tiden [kort beskrivelse, 1 setning].

Hva er påvirket:
- [Konkret liste — eks. "Spill 1 startet ikke kl. 10:00 i hallen din"]
- [Eks. "Spillerne ser 'Mistet kontakt' på terminalene"]

Hva vi gjør:
- [Eks. "Backend restartes nå, forventet løsning innen 5 min"]
- [Eks. "Vi recover pågående runder fra siste sikkerhetspunkt"]

Hva du som hall-eier bør gjøre i mellomtiden:
- Ingenting — vi håndterer alt fra serversiden.
- Spillerne kan vente; pengene deres er trygge.
- Hvis spillere spør: si "Vi har et midlertidig teknisk problem,
  Spillorama er på saken og forventer at det er løst innen [tid]."

Vi sender ny oppdatering om [tid] eller når problemet er løst.

Kontakt:
- Akut: [L1-on-call-telefon]
- Generell: support@spillorama.no

Hilsen,
Spillorama Operations
```

### 10.2 Spiller-varsling (i klient eller via push)

For mindre kritiske hendelser:

```
Tittel: Midlertidig teknisk forsinkelse

Vi opplever for tiden noe forsinkelse i [Spill 1 / hele plattformen].
Pengene dine er trygge, og pågående brett vil bli telt med når vi er
tilbake.

Forventet løsning: innen [X] minutter.

Du trenger ikke gjøre noe — siden vil oppdatere seg automatisk.
```

### 10.3 Lotteritilsynet-varsling (compliance-eier)

For SEV-1 / regulatorisk meldepliktig:

```
Til: Lotteritilsynet, [tilhørende sakshandler]
Fra: Spillorama Compliance, Tobias Haugen

Hendelsesrapport — pengespillforskriften §[relevant §]

Tidspunkt: [ISO-8601 UTC start] – [ISO-8601 UTC slutt]
Varighet: [X timer Y minutter]
Antall haller berørt: [X av 23]

Hendelse:
[Kort, faktabasert beskrivelse — hva skjedde, hva ble berørt]

Datatap:
[Beskriv eventuelt datatap. Hvis ingen: "Ingen datatap; alle
transaksjoner er bekreftet konsistent etter recovery."]

Spiller-impact:
[Antall spillere berørt, eventuelle utbetalinger som ble forsinket
eller måtte korrigeres]

Tiltak iverksatt:
1. [Steg 1]
2. [Steg 2]
3. [Steg 3]

Forebyggende tiltak:
[Hva vi gjør for å unngå gjentakelse — link til Linear-issue]

Vedlegg:
- Render-loggutdrag for hendelses-vinduet
- Compliance-ledger-utdrag før og etter
- Sentry incident-id

Med vennlig hilsen,
Tobias Haugen
Technical lead, Spillorama
```

---

## 11. On-call-rotasjon

> **Status 2026-05-08:** Ikke ennå formalisert. Tobias fyller inn navn
> + kontakt-info før pilot-start. Strukturen nedenfor er klar.

### 11.1 Roller

| Nivå | Rolle | Ansvar | Responstid (SEV-1) |
|---|---|---|---|
| L1 | Hall-operatør | Lokal observasjon, terminal-hjelp, eskalering | 0–5 min |
| L2 | Backend on-call | Sentry/Render/Postgres-triage, runbook-execution | 5–10 min |
| L2-payment | Wallet/Swedbank on-call | Wallet-reconcile, betalings-mismatch | 5–10 min |
| L3 | Incident commander | Beslutning om rollback/SEV-eskalering | 0–5 min |
| L4 | Tobias (technical lead) | Endelig myndighet, Lotteritilsynet-kontakt | Etter behov |

### 11.2 Bemanning

| Vakt | Primær | Sekundær | Vakt-vindu |
|---|---|---|---|
| L1 hverdag dag (10–16) | TBD | TBD | TBD |
| L1 hverdag kveld (16–22) | TBD | TBD | TBD |
| L1 helg | TBD | TBD | TBD |
| L2 backend | TBD | TBD | 24/7 |
| L2 payment | TBD | TBD | 24/7 (best-effort utenfor 09–17) |
| L3 incident commander | TBD | TBD | 24/7 (best-effort) |

### 11.3 Eskalering

```
Hall-vert ringer L1 (5 min)
   ↓
L1 eskalerer til riktig L2 (5 min)
   ↓
L2 prøver runbook-prosedyre (15 min)
   ↓
Hvis ikke løst: L2 eskalerer til L3 incident commander
   ↓
L3 vurderer rollback eller SEV-1-deklarering
   ↓
Hvis SEV-1: L4 (Tobias) varsles + Lotteritilsynet
```

### 11.4 Kommunikasjon

| Kanal | Bruk |
|---|---|
| `#bingo-pilot-war-room` Slack | Live-koordinasjon under hendelse |
| `#ops-cutover` Slack | Status-oppdateringer post-hendelse |
| SMS-broadcast til hall-eiere | Når Slack/email kan være nede |
| `incident-log/<yyyy-mm-dd>-<id>.md` | Permanent rapport |

---

## 12. Drill-prosedyre

For å verifisere at runbooken faktisk fungerer kjører vi månedlige
drills i staging. Hver drill er en kontrollert simulering, ikke en
prod-handling.

### 12.1 Drill-katalog

| # | Scenario | Frekvens | Eier | Pre-pilot-krav |
|---|---|---|---|---|
| D1 | S1 — backend-krasj | Månedlig | L2 backend | ✅ Må kjøre én gang |
| D2 | S2 — Redis-utfall | Månedlig | L2 backend | ✅ Må kjøre én gang |
| D3 | S3 — Postgres failover | Kvartalsvis | L2 backend + Tobias | ✅ Må kjøre én gang |
| D4 | S4 — Region-down | Manuell, kun annonsert | Tobias | ⚠️ Vurder, ikke obligatorisk |
| D5 | S5 — DDoS-simulering | Kvartalsvis | L2 backend | Optional |
| D6 | S6 — Rolling restart | Per deploy | L2 backend | Pågående praksis |
| D7 | S7 — Perpetual-loop-leak | Kvartalsvis | L2 backend | Optional |

### 12.2 Generell drill-mal

**Pre-requisites:**
- Staging-miljø speilet på prod-skjemaet (samme migrations applied).
- 5+ testspillere armed i hver av Spill 1, 2, 3.
- Aktiv runde i hver av Spill 1, 2, 3 (master har startet i Spill 1,
  perpetual-loop kjører i Spill 2/3).
- Render-staging-instans selvstendig (ikke koblet til prod-DB).
- Drill-eier varsler `#ops-cutover` 30 min før: "Drill D[N] starter i
  staging kl. [HH:MM]. [Engineer-navn] eier."

**Steg-for-steg (eksempel D1: backend-krasj):**
1. Note tidspunkt + state pre-drill:
   - Hvor mange aktive scheduled games?
   - Hvor mange armed players (`bingo:room:*:armedTickets` count)?
   - Last commit-SHA av compliance-ledger.
2. Force-kill backend:
   ```bash
   # Render-dashboard → Manual restart (uten ny build)
   # Eller: SSH (om aktivert) og kill -9 av node-prosess
   ```
3. Start stoppeklokke. Mål:
   - Tid til `/health` returnerer 200 igjen.
   - Tid til alle klienter er reconnected (Grafana-graf).
   - Tid til alle aktive runder er recovered.
4. Verifisere via §3.5-tabellen.
5. Stopp stoppeklokke. Note total recovery-tid.

**Suksesskriterier (D1):**
- ✅ Recovery-tid < 2 min (mål) / < 5 min (akseptabelt).
- ✅ 0 datatap i compliance-ledger (count + last-id pre/post-drill).
- ✅ Alle armed players blir gjenkoblet eller får refundert reservasjon
  innen 30 min via `WalletReservationExpiryService`.
- ✅ Ingen `[HIGH-4] Recovery integrity drift > 0` i loggen.

**Hva som loggføres etter drill:**

```markdown
# Drill D[N] — [scenario] — [yyyy-mm-dd]

**Eier:** [navn]
**Deltakere:** [navn 1], [navn 2]
**Miljø:** staging
**Pre-state:**
- Aktive games: [N]
- Armed players: [M]
- Last ledger-id: [uuid]

**Tidslinje:**
- HH:MM:SS — Drill startet ([handling])
- HH:MM:SS — `/health` 200 OK
- HH:MM:SS — Klienter reconnected (Grafana)
- HH:MM:SS — Alle runder recovered

**Total recovery-tid:** X min Y sek

**Resultater:**
- Datatap: [Ja/Nei + detaljer]
- Compliance-ledger: [pre/post-count, mismatch?]
- Sentry-events: [count]
- Player-impact: [observert]

**Suksess?** ✅ / ⚠️ / ❌

**Findings / gaps:**
- [Eventuelle ting som ikke fungerte som beskrevet]

**Action items:**
- [ ] Oppdater runbook §[X.Y]
- [ ] Linear-issue [BIN-XXX] for fix
```

Dette skrives i `docs/operations/dr-drill-log/<yyyy-mm>-D[N].md` (samme
mappe som beskrevet i [`DISASTER_RECOVERY_PLAN_2026-04-25.md`](./DISASTER_RECOVERY_PLAN_2026-04-25.md)
§9).

### 12.3 Pre-pilot-krav

Før første hall flippes til prod-pilot må følgende drills ha pass-status:

- ✅ D1 (backend-krasj)
- ✅ D2 (Redis-utfall)
- ✅ D3 (Postgres failover)

D4–D7 er anbefalt men ikke obligatorisk.

### 12.4 Drill-data-cleanup

Etter hver drill:
- Force-end alle staging-runder.
- Refund alle test-spillere.
- Verifiser at ingen drill-rader har lekket inn i prod (ulike DB,
  separate connection-strings).

---

## 13. Eier + sign-off

| Rolle | Ansvar | Sign-off |
|---|---|---|
| Technical lead (Tobias) | Endelig myndighet på prosedyren; signerer drill-resultater | _pending_ |
| Backend on-call | Eier D1, D2, D3, D6, D7 i staging | _pending_ |
| Compliance-eier | Eier Lotteritilsynet-rapport-flyt (§10.3) | _pending_ |
| L1 hall-operatør | Drill-deltaker for kommunikasjon-template (§10.1) | _pending_ |

Runbooken er i kraft når **alle fire signaturer** er registrert (med
dato + Linear-kommentar-link). Pilot-cutover kan IKKE skje uten
sign-off.

Ved oppdatering av runbooken — bump "Last updated" øverst, post
endring i `#ops-cutover`, oppdater Linear BIN-816.

---

## 14. Referanser

- [`docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md`](../architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md)
  — autoritativ mandat for Bølge 1 av live-rom-robusthet (R12 = BIN-816).
- [`docs/architecture/SPILL_REGLER_OG_PAYOUT.md`](../architecture/SPILL_REGLER_OG_PAYOUT.md)
  — kanonisk spec for compliance-felter som må overleve recovery (§9.6).
- [`docs/architecture/SPILL_DETALJER_PER_SPILL.md`](../architecture/SPILL_DETALJER_PER_SPILL.md)
  — Spill 1/2/3-spesifikke state-overganger.
- [`docs/operations/DISASTER_RECOVERY_PLAN_2026-04-25.md`](./DISASTER_RECOVERY_PLAN_2026-04-25.md)
  — generell DR-plan (Postgres, region, hall-internett, Swedbank).
- [`docs/operations/REDIS_KEY_SCHEMA.md`](./REDIS_KEY_SCHEMA.md) — Redis-
  state-keys for surgical recovery.
- [`docs/operations/LIVE_ROOM_OBSERVABILITY_2026-04-29.md`](./LIVE_ROOM_OBSERVABILITY_2026-04-29.md)
  — structured-events og grep-eksempler.
- [`docs/operations/OBSERVABILITY_RUNBOOK.md`](./OBSERVABILITY_RUNBOOK.md)
  — alerts og dashboards.
- [`docs/operations/MIGRATION_DEPLOY_RUNBOOK.md`](./MIGRATION_DEPLOY_RUNBOOK.md)
  — migrate-feilhåndtering.
- [`docs/operations/ROLLBACK_RUNBOOK.md`](./ROLLBACK_RUNBOOK.md) — hall-
  rollback til Unity-klient.
- [`docs/operations/HALL_PILOT_RUNBOOK.md`](./HALL_PILOT_RUNBOOK.md) —
  pilot-vakt + severity.
- [`docs/operations/PILOT_CUTOVER_RUNBOOK.md`](./PILOT_CUTOVER_RUNBOOK.md)
  — hall-flip-prosedyre.
- `apps/backend/src/util/roomState.ts` — `RoomLifecycleStore`-interface.
- `apps/backend/src/util/RedisRoomLifecycleStore.ts` — K4 atomic state-
  owner.
- `apps/backend/src/game/Game1ScheduleTickService.ts` — scheduler-tick-
  arkitektur.
- `apps/backend/src/game/Game1RecoveryService.ts` — schedule-level
  recovery-pass ved boot.
- `apps/backend/src/game/PerpetualRoundService.ts` — Spill 2/3
  perpetual-loop.
- `apps/backend/src/index.ts:4240–4360` — boot-sequence (hydrate +
  recovery + integrity-check).
