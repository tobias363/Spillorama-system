# Disaster Recovery Plan — Spillorama Pilot

**Owner:** Technical lead (Tobias Haugen)
**On-call rotation:** TBD — fastsettes før pilot-start (uke 0)
**Last updated:** 2026-04-25
**Pilot-start:** ~6 uker fra dato. Scope: 23 haller, 690 Windows-terminaler.

> Dette er et arkitekturdokument, ikke en implementasjon. Det beskriver
> hvilke ting som **kan** gå galt under pilot-driften, hvor sannsynlige
> de er, hvordan vi oppdager dem, og hvilke konkrete steg som tas for å
> recover. Det suppleres av:
>
> - [`PILOT_CUTOVER_RUNBOOK.md`](./PILOT_CUTOVER_RUNBOOK.md) — hvordan vi
>   ruller en hall over, hva som er pre-flight-krav.
> - [`ROLLBACK_RUNBOOK.md`](./ROLLBACK_RUNBOOK.md) — hvordan rull en
>   hall (eller alle) tilbake til Unity hvis web-klienten regredierer.
> - [`OBSERVABILITY_RUNBOOK.md`](./OBSERVABILITY_RUNBOOK.md) — hvilke
>   signaler vi ser på, hvilke alerts som pager hvem.
> - [`HALL_PILOT_RUNBOOK.md`](./HALL_PILOT_RUNBOOK.md) — generell
>   pilot-vakt, severity-definisjoner.

DR-planen står på skuldrene av disse — den dupliserer ikke
cutover-prosedyren eller rollback-kommandoene som allerede er beskrevet.

---

## 0. TL;DR for travle PM-er

Tre tall å huske:

| Mål | Verdi | Begrunnelse |
| --- | --- | --- |
| **RPO** (max datatap) | ≤ 5 min | Postgres WAL-arkivering kontinuerlig + nattlig base-backup. |
| **RTO backend** (return-to-service) | ≤ 30 min | Render redeploy ~5 min + DNS/cache-propagering + smoke. |
| **RTO database** (full restore) | ≤ 2 timer | Render-managed Postgres point-in-time-restore + DNS-flip. |

Tre topp-risikoer som krever **konkret beslutning fra Tobias** før pilot
(se §10):

1. **Single-region-deploy** — Render Frankfurt er én geografisk
   feilkilde. Akseptert risiko, eller skal vi ha cold-standby i en
   andre region?
2. **Backup-test-prosedyre** — vi har aldri test-restoret
   prod-Postgres til en kjent timestamp. Må kjøres minst én gang før
   pilot-start.
3. **Hall-internett-redundans** — 23 haller, hvilke har 4G-fallback?
   Ingen kode kan kompensere for en hall som er offline 6 timer.

Anbefaling-status (se §11): 8 tiltak må gjøres FØR pilot, 5 kan vente
til etter første pilot-uke, 4 er nice-to-have.

---

## 1. Hva vi har i dag (system-kart)

### 1.1 Produksjonsstack

| Lag | Tjeneste | Lokasjon | Redundans i dag |
| --- | --- | --- | --- |
| Backend (Node.js) | Render web service `spillorama-system` | Frankfurt | 1 instans, `plan: starter` (`render.yaml:6`) |
| Postgres | Render-managed eller ekstern (TBD per Tobias) | Frankfurt | Render-managed har auto-backup |
| Redis | Render Redis (`REDIS_*` env i `render.yaml:21-25`) | Frankfurt | 1 instans, BIN-494 fanout-bus |
| Candy backend | Eget service `candy-backend-ldvg.onrender.com` | Frankfurt | 1 instans (eksternspill, integreres iframe) |
| MSSQL (Spingo legacy) | `MSSQL_*` env (`render.yaml:28-32`) | Ekstern | Eier-administrert |
| Filesystem assets | Cloudinary (`CLOUDINARY_*`) | CDN | Cloudinary-managed |
| TV/admin/spiller-frontend | Statiske assets servert av backend | Render | Samme single-point-of-failure som backend |

### 1.2 Hva backend gjør i drift

- **Game-engine** (`apps/backend/src/game/`) — eier draw-state per
  rom, broadcaster `draw:new` / `pattern:won` / `room:update` via
  Socket.IO (Redis-fanout-bus).
- **Wallet-adapter** (`apps/backend/src/wallet/`,
  `apps/backend/src/adapters/`) — Postgres-backed; reservasjon →
  commit-mønster (BIN-693, migrasjon
  `20260724100000_wallet_reservations.sql`).
- **Compliance-ledger** + audit — alle pengetransaksjoner skrives med
  idempotency-key. Skrives ved `startGame`, ikke ved `bet:arm`.
- **Crash-recovery-services** — to nivåer:
  - **BIN-245**: Engine-state hydrering fra checkpoint-snapshot ved boot
    (`engine.hydratePersistentState()`,
    `apps/backend/src/index.ts:2292`). Restorer ball-state, marks,
    winners. Ref `BingoEngineRecovery.ts`.
  - **GAME1\_SCHEDULE PR 5**: Schedule-level recovery
    (`Game1RecoveryService.ts`). Cancel-er overdue scheduled games
    (>2t over `scheduled_end_time`) ved boot. Ref `index.ts:2269`.
  - **`WalletReservationExpiryService`**
    (`apps/backend/src/wallet/WalletReservationExpiryService.ts`) —
    bakgrunns-tick som markerer stale wallet-reservasjoner som expired
    (default 30 min TTL). Crash-recovery for spiller-saldo som ellers
    ville stått låst etter `bet:arm` uten påfølgende `startGame`.

### 1.3 Per-hall-arkitektur

- **Master-hall** per `daily_schedule`: én hall i en gruppe orkestrerer
  spill-runden, andre haller "joiner" som follower.
- **`transferHallAccess` (master-overføring) er IKKE implementert**
  i ny stack. Legacy hadde en 60s handshake for å overføre master-rolle
  ved bingovert-bytte. Se [§5 risiko-scenario](#5-stormaster-hall-master-feiler).
  Dokumentert i
  [`docs/architecture/MASTER_HALL_DASHBOARD_GAP_2026-04-24.md`](../architecture/MASTER_HALL_DASHBOARD_GAP_2026-04-24.md)
  punkt #6.
- **Auto-pause på phase-won** (BIN-695, migrasjon
  `20260726000000_game1_auto_pause_on_phase.sql`): når en fase vinnes,
  setter engine seg i `paused=true` til master trykker Resume. Reduserer
  risiko for at krasj midt-runde "stjeler" en seier — engine venter
  uansett til master gir grønt lys.

---

## 2. Risikomatrise (oversikt)

| Scenario | Sannsynlighet | Impact | Detection-tid | RTO (return-to-service) |
| --- | --- | --- | --- | --- |
| §3 Backend faller midt-runde | Medium | Medium-Høy | < 1 min (Render uptime probe) | < 30 min |
| §4 Database-korrupsjon eller -tap | Lav | Kritisk | 1-15 min (avh. type) | < 2 timer |
| §5 Hall mister internett | Medium | Medium (én hall) | < 30 sek (klient ser disconnect) | Avhenger av ISP |
| §6 Enkelt-terminal feiler | Høy | Lav (1 spiller) | Umiddelbart | 5-10 min |
| §7 Master-hall feiler | Medium | Medium (1 hall-gruppe) | < 1 min | 10-30 min (workaround) |
| §8 Pengespill-server-tap (Swedbank) | Lav | Høy (regnskap) | Timer (reconcile-job) | < 24 timer |

Definisjoner:

- **Sannsynlighet** — over et 90-dagers pilot-vindu.
  - Lav: < 5%
  - Medium: 5–25%
  - Høy: > 25%
- **Impact** — på spilleropplevelse + pengeflyt + regulatorisk eksponering.
- **Detection-tid** — første alarm fra første symptom.
- **RTO** — service tilbake i drift, ikke nødvendigvis full data-paritet.

---

## 3. Backend faller midt-runde

### Sannsynlighet: Medium

Render `starter`-plan har dokumentert spinning-down på inaktivitet —
ikke aktuelt under pilot (24/7 trafikk), men deploys, OOM, og
adapter-timeouts kan ta noden ned 1–5 ganger per måned.

### Impact: Medium-Høy

- Spillere midt-runde mister socket-tilkobling.
- Hvis krasjen er **før `startGame`-commit** men etter `bet:arm`:
  reservasjoner ligger i DB men er ikke committed. Spiller-saldo viser
  redusert beløp.
- Hvis krasjen er **etter `startGame`-commit** men før spill-slutt:
  compliance-ledger har allerede registrert kjøpet. Engine må hydrere
  fra checkpoint og fortsette, eller force-end-cancel.

### Prevention

- **Single-instance unngåelse** — Render `starter` er én node. Ved
  pilot-start anbefales oppgradering til `standard` eller
  `pro`-plan med minst 2 instanser bak load-balancer.
  Krever Redis-fanout (allerede konfigurert via BIN-494).
- **Memory-overvåking** — Render-dashboard + Prometheus
  `process_resident_memory_bytes`. OOM-trigger ved 90% av plan-grense.
- **Deploy-vinduer** — aldri deploy under aktive spill-økter.
  Implementeres i §11 anbefaling 4 (deploy-blackout-vinduer).

### Detection

- Render uptime probe (`GET /health`, `apps/backend/src/index.ts:2028`)
  fanger død node innen 30 sek.
- Sentry `spillorama-backend` mottar exception før prosessen dør (Sentry
  flush kjører i graceful-shutdown-handler).
- Spiller-klient detekterer disconnect via Socket.IO og viser
  reconnect-spinner. `spillorama_reconnect_total`-metrik spiker.

### Response — runbook

1. **Render-side trigger:** Render auto-restarter krasjet node.
   Forventet downtime: 30–90 sek.
2. **Under reboot:** klienter spinner reconnect. Per BIN-502 holder
   web-klient draw-state lokalt i 30 sek og kobler tilbake automatisk.
3. **Boot-sekvens** (`index.ts:2290-2302`):
   - `engine.hydratePersistentState()` — Postgres + Redis-state
   - `engine.recoverFromCheckpoints()` (BIN-245) — engine-state
   - `game1RecoveryService.runRecoveryPass()` (PR 5) — schedule-state
   - `walletReservationExpiryService.start()` — frigjør stale
     reservasjoner over 30 min gamle.
4. **Etter reboot:** on-call sjekker:
   - Grafana `spillorama-connection-health`: reconnect-rate normaliseres
     innen 2 min.
   - Grafana `spillorama-finance-gates`: stuck-rooms = 0,
     wallet-op-latens normal.
   - Sentry: ingen nye exceptions etter reboot.
5. **Kommuniser:** post i `#ops-cutover`:
   `Backend reboot at <ISO>. Cause: <one-liner>. Players reconnected within <X>s.`

### Recovery — hva skjer med uavgjort runde?

| Krasj-tidspunkt | Wallet-state | Engine-state | Recovery |
| --- | --- | --- | --- |
| Før `bet:arm` | Ingen reservasjon | Ingen game-session | Ingen handling. Spiller starter på nytt. |
| Etter `bet:arm`, før `startGame` | `app_wallet_reservations.status='active'`, expires_at = +30 min | Ingen game-session | `WalletReservationExpiryService` markerer expired etter TTL. Spiller kan armer på nytt. |
| Etter `startGame`, før `pattern:won` | `committed`, ledger-skrevet | Engine-checkpoint på siste draw | BIN-245 hydrerer engine. Master må manuelt resume eller force-end. |
| Etter `pattern:won`, før payout-commit | `committed` | Pending payout | BIN-245 + `BingoEngine.crashRecoveryPartialPayout`-test dekker dette. Payout idempotent via key. |
| Etter alle commits | Stable | Stable | Ingen action. |

**Master-master-haller (Task 1.4 + 1.6):** Kun én hall er "master" per
runde (lagret i `app_game1_scheduled_games.master_hall_id`). Ved boot
fortsetter den hallen som master — det er ingen valgprosess. Hvis
master-hall-en _selv_ er nede mens backend boot-er,
`Game1RecoveryService` cancel-er rad-en og Lotteritilsynet-audit
skrives. Se §7 for full master-fail-håndtering.

### Testing

- **Månedlig krasj-drill (§9.1):** kill -9 backend mens 5 testbrukere
  er midt i en runde i staging. Mål reconnect + recovery innen 2 min.
- **Eksisterende test:** `BingoEngine.crashRecoveryPartialPayout.test.ts`
  + `Game1RecoveryService.test.ts` dekker enhetsnivå.

---

## 4. Database-korrupsjon eller -tap

### Sannsynlighet: Lav

Render-managed Postgres har ZFS-snapshots og kontinuerlig WAL-arkiv.
Korrupsjon i selve dataene er sjelden; mer sannsynlige scenarier:

- **Operatør-feil:** `DELETE` uten `WHERE` (uøvet hånd), feil migrasjon.
- **Lagringsbruk-eksplosjon:** disk-full → write-failures → korrupt
  WAL.
- **Schema-konflikt etter deploy:** migrasjons-script feiler midt-veis
  → tabeller i inkonsistent tilstand.

### Impact: Kritisk

Pengespill-data — vinnerregister, transaksjoner, KYC. Uten Postgres
kan vi ikke akseptere spill (fail-closed Spillvett-invariant treffer).
Compliance-ledger må gjenopprettes eksakt for Lotteritilsynet-rapport.

### Prevention

- **Auto-backup** (Render-managed): nattlig snapshot, retention 7 dager
  på `starter`, **30 dager på `pro`** — krever `pro`-oppgradering før
  pilot-start.
- **Point-in-time-recovery (PITR):** Render `pro`-plan inkluderer
  WAL-arkivering, restore til vilkårlig timestamp innen retention-vindu.
  RPO ≤ 5 min når aktivert.
- **Migrasjons-policy** — alle migrasjoner kjøres som forward-only per
  `BIN-661`. Aldri `DROP TABLE` uten 30-dagers grace-periode + arkiv-
  tabell. Se `apps/backend/migrations/README.md`.
- **DB-tilgang lockdown:** prod-DB-creds finnes kun i Render env, ikke
  i `.env.local`. SQL-konsoll-tilgang kun for Tobias (én person) under
  pilot. Audit-trail på alle queries.

### Detection

- **Schema-feil etter deploy:** `npm run migrate` failer ved deploy →
  Render-deploy ruller tilbake, varsel i Slack.
- **Manglende rader / inkonsistens:** compliance-ledger har
  `idempotency_key` UNIQUE-constraint — duplikat-skriv feiler tydelig.
- **Disk-full:** Render-alarm når >85% disk. Pre-emptive vacuum +
  oppgradering.
- **Korruption-deteksjon:** Postgres `pg_amcheck` kjøres ukentlig som
  cron-job (TBD — anbefaling §11.7).

### Response — runbook

#### 4.1 Schema-feil under deploy (vanligst)

1. Render-deploy markerer `migrate`-step som failed → automatisk
   rollback til forrige image.
2. On-call sjekker Render-deploy-log for nøyaktig SQL-feil.
3. Fiks migrasjons-fil, ny PR, ny deploy.
4. **Forutsetter:** migrasjoner er idempotente (`CREATE TABLE IF NOT
   EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`). Verifiseres
   i CI-step (eksisterer i dag).

#### 4.2 Operatør-feil (`DELETE` uten `WHERE` o.l.)

1. **Stop the bleeding** umiddelbart: `UPDATE app_halls SET is_active =
   false;` — alle haller går i vedlikeholdsmodus. Ingen nye
   transaksjoner blir skrevet.
2. **Estimer skaden:** kjør `SELECT COUNT(*) FROM <table>` mot kjente
   nøkkeltabeller (`app_users`, `app_wallets`, `compliance_ledger`).
   Sammenlikn mot Grafana-baseline.
3. **Beslutning** (Tobias + compliance, < 15 min):
   - Hvis kun én tabell og <100 rader påvirket: vurder manuelt
     rebuild fra audit-log + ledger.
   - Hvis bredere skade eller usikker: gå til 4.3 PITR-restore.
4. **Compliance-eier varsles** uavhengig av valg — datatap >5 min er
   meldepliktig til Lotteritilsynet (se §8.5 Lotteritilsynet-SLA).

#### 4.3 Full PITR-restore

1. **Annonser blackout:**
   `UPDATE app_halls SET is_active = false; -- alle haller`. Player-
   facing message: "Vedlikehold pågår, prøv igjen om 1-2 timer."
2. **I Render dashboard:** Postgres → Backups → Point-in-Time-Restore
   → velg timestamp 5 min før hendelsen. Render lager en NY DB-instans
   (typisk navn `<original>-restored-<timestamp>`).
3. **Verifiser restoren** mot `<original>-restored`-instansen via en
   read-only sjekk:
   - `SELECT COUNT(*), MAX(created_at) FROM compliance_ledger;`
   - Sammenlikn med kjent siste-known-good-timestamp.
4. **Cut over:** oppdater `APP_PG_CONNECTION_STRING` env-var i Render
   til ny instans. Restart backend. Forventet downtime: 30–60 sek.
5. **Post-restore:** sjekk fra-tidspunkt til ny-timestamp — alle
   transaksjoner i det vinduet er tapt og må flagges manuelt.
   Compliance-eier skriver Lotteritilsynet-rapport.
6. **Beholdn den restorede instansen** i 30 dager før den slettes —
   for evt. forensikk.

### Recovery-tid

- **Schema-feil under deploy:** 5–15 min (rollback automatisk).
- **Operatør-feil med liten radius:** 30–60 min (manuell rebuild).
- **Full PITR-restore:** 60–120 min (Render-instans-spawn dominerer).

### Testing

- **Månedlig backup-drill (§9.2):** restore Render-snapshot til
  staging, verifiser at backend booter mot ny instans, kjør smoke-suite.
  **Må gjøres minst én gang før pilot.**
- **Migrasjons-CI:** alle nye migrasjoner kjøres i CI mot kopi av
  prod-schema.

---

## 5. Hele hallen mister internett-tilkobling

### Sannsynlighet: Medium

ISP-utfall, bredbåndskutt, switch-død. Ikke uvanlig 1-3 ganger per
hall per år, varighet 30 min – 6 timer.

### Impact: Medium (én hall isolert)

Alle terminaler i hallen kan ikke nå backend. Ingen nye spill kan
starte. Pågående runder fryser → klient viser reconnect-spinner.

### Prevention

- **4G/5G-fallback per hall** — ruter med dual-WAN. Krever
  hall-investering (~5000 NOK + abonnement). Ikke alle 23 haller har
  dette per dato.
  - Beslutning: hvilke haller får 4G-fallback FØR pilot? Se §10
    åpen risiko #3.
- **Lokal cache for terminaler** — IKKE planlagt i nåværende stack.
  Web-klienten er online-only (ingen service-worker, ingen IndexedDB-
  state-mirror). Rasjonell: pengespill kan ikke kjøre offline (krever
  realtime-godkjenning fra backend per spill-trekning, fail-closed
  Spillvett-invariant).
- **Hall-admin SOP:** ved internett-kutt — logg av alle terminaler,
  vent til tilkobling kommer tilbake, gi spillerne refund manuelt fra
  cash-register.

### Detection

- Backend ser sockets fra hallen forsvinne samtidig. Per BIN-539:
  `bingo_socket_connections`-gauge har "active sockets per hall"
  (via `$hall`-template). Drop > 80% innen 30 sek = hall offline.
- Hall-admin har telefon — ringer backup-nummer (se
  `HALL_PILOT_RUNBOOK.md` §2 kontakt-kjede).
- Spiller-klient viser "Mistet kontakt med spillet, prøver igjen..."

### Response — runbook

1. **L1 hall-operatør:** identifisér problem.
   - Wifi/kabel? Restart switch.
   - ISP-utfall? Sjekk modem-LED. Ring ISP-support.
   - Hvis 4G-fallback finnes: aktiver. Klienter kobler til via 4G.
2. **L2 backend on-call:** ingen action på backend-side. Hallen kan
   ikke nås. Sjekk at andre haller er upåvirket via Grafana.
3. **Refund-policy** når tilkobling kommer tilbake:
   - **Pre-`startGame`-reservasjoner:** ekspirerer automatisk via
     `WalletReservationExpiryService` etter 30 min. Spiller-saldo
     normaliseres uten manuell handling.
   - **Post-`startGame`-runder:** hvis runden ikke kunne fullføres
     (master kunne ikke trekke flere baller), force-end via
     `admin:force-end` i admin-konsoll når tilkobling er tilbake.
     `BingoEngine.crashRecoveryPartialPayout` håndterer prorata-refund.
     Audit-log skrives med `reason: "hall-internet-outage"`.
4. **Kommunikasjon til hall-admin:** mal i Slack
   `#ops-cutover`:
   `Hall <slug> internett-kutt fra <ISO> til <ISO>. <N> aktive runder
   force-ended. Refund automatic via reservation-expiry / manual via
   force-end. Hall klar for ny drift.`
5. **Compliance-log:** alle force-end ved internett-kutt logges som
   `SEV-3` i incident-log (`docs/operations/incident-log/`).

### Recovery-tid

- **Hall-tilkobling restoret:** avhenger av ISP. Typisk 30 min – 6 t.
- **Refund-prosessering** når tilbake: < 5 min (automatic for
  reservations, < 10 min for force-end runder).
- **Spillere på plass i hallen:** kan kompenseres manuelt fra
  cash-register per hall-admin-skjønn (out-of-scope for backend).

### Testing

- **Manuell drill (§9.3):** simuler internett-kutt på staging-hall
  ved å block-e backend-IP fra hall-test-VPN. Verifiser at refund-flow
  triggrer og at andre haller er upåvirket.

---

## 6. Enkelt-terminal feiler under spill

### Sannsynlighet: Høy

690 Windows-terminaler i 23 haller. Forventet baseline: 1–3 terminal-
feil per uke (HW, OS-update, brukerklikk feil).

### Impact: Lav

Kun den ene spilleren rammes. Andre spillere fortsetter uavbrutt.

### Prevention

- **Hardware-spec lockdown:** alle terminaler har samme HW-profil
  (per `feat/pilot-hardware-test-profile`-branch). Reduserer driver-
  varians.
- **Terminal-image med auto-update:** Windows-image distribueres
  sentralt. OS-patch-windows utenfor spille-tider.
- **Spiller-state er server-side** — billetter, vinst-status, marks
  ligger i Postgres + Redis. Terminal er en "tynn klient" — kan byttes
  uten datatap.
- **Auth via session-token:** hver terminal har en `display-token`
  generert per hall, ikke per fysisk maskin (se BIN-503,
  `HALL_DISPLAY_TOKEN_<SLUG>` env eller DB-backed token).

### Detection

- Terminal-skjerm svart/frys → hall-admin observerer.
- Backend ser socket-disconnect fra én terminal-IP.

### Response — runbook

1. **Hall-admin:** slå av defekt terminal. Ta replacement fra reserve-
   pool (anbefalt: 2 reserver per hall, totalt ~50 reserver for 690
   terminaler).
2. **Logg inn på replacement:** spiller logger inn med eget mobilnummer
   + KYC-sjekket konto. Backend gjenkjenner spilleren via session-token.
3. **State-recovery:**
   - Pågående runde: backend har ticket + marks i Postgres. Replacement-
     terminal mottar full state via `room:join`-event innen 2 sek.
   - Pågående mini-game: TBD — mini-games (Mystery Game, etc.) holder
     state per session-id. Reconnect via mobil-app eller kontakt
     hall-admin for refund.
4. **Refund hvis terminal-bytte er for tregt:**
   - Hall-admin kan trigge `admin:force-end` for spilleren via
     agent-portal. `BingoEngine.crashRecoveryPartialPayout` håndterer
     prorata-refund.
   - Eller: manuell payout fra cash-register, audit i agent-shift-log.
5. **Defekt terminal:** loggføres i hall-incident-log. HW-team henter
   ved neste pilot-besøk.

### Recovery-tid

- **Terminal-bytte:** 5–10 min (spiller fysisk flytting + ny innlogging).
- **State-recovery for spiller:** < 5 sek (når innlogget).
- **Refund hvis terminal ikke kan byttes:** < 5 min via force-end.

### Testing

- **Terminal-bytte-drill (§9.4):** under en pilot-sesjon, bytt en
  test-terminal mens spiller er aktiv. Mål tid til state-recovery.

---

## 7. Stormaster-hall (master) feiler

### Sannsynlighet: Medium

Master-hall er én utvalgt hall per `daily_schedule`. Hvis den hallen
mister internett (§5), bingovert blir syk, eller terminalen som er
master-konsoll dør (§6) — hele hall-gruppen kan ikke fortsette.

### Impact: Medium (1 hall-gruppe rammes — typisk 4-5 haller)

Alle pågående multi-hall-runder i gruppen fryser. Andre hall-grupper
upåvirket.

### Prevention

- **`transferHallAccess`-funksjonalitet ER IKKE IMPLEMENTERT** i ny
  stack. Dokumentert i
  [`MASTER_HALL_DASHBOARD_GAP_2026-04-24.md`](../architecture/MASTER_HALL_DASHBOARD_GAP_2026-04-24.md)
  punkt #6.
- **Beslutning** før pilot: skal vi implementere transfer i ny stack
  (~3-5 dager dev-tid), eller bruke manuell DB-edit som fallback?
  Se §10 åpen risiko #4.
- **Auto-pause på phase-won** (BIN-695) reduserer impact: når master
  feiler mellom faser (typisk pause-vindu), trenger vi ikke recover
  ball-state — bare skifte master.

### Detection

- Master-hall-socket disconnecter fra `/admin-game1`-namespace.
- Andre haller i gruppen får ikke `game1:master-action`-broadcasts.
- Bingoverter i de andre hallene ringer hall-admin for master-hallen.
  Eskalering til L2 backend on-call innen 5 min.

### Response — runbook

#### 7.1 Quick fallback (uten transferHallAccess-implementasjon)

1. **Stopp alle runder** i hall-gruppen via admin-konsoll
   `admin:force-end` for hver pågående runde, `reason:
   "master-hall-failure"`. `BingoEngine.crashRecoveryPartialPayout`
   håndterer prorata-refund for alle deltakere.
2. **Manuell DB-edit** (kun Tobias):
   ```sql
   -- Pek master-rolle til ny hall i gruppen, gjelder fra neste
   -- daily_schedule-spawn (om ~15 min via game1-schedule-tick).
   UPDATE app_daily_schedules
      SET other_data = jsonb_set(
        other_data,
        '{masterHallId}',
        '"<new-master-hall-id>"'
      )
    WHERE id = '<schedule-id>';
   ```
3. **Verifiser:** neste tick av `Game1ScheduleTickService` (15 sek)
   spawner nye scheduled games med ny master-hall.
4. **Kommuniser** til alle hall-admins i gruppen: "Master byttet til
   <hall>, neste runde starter ~15 min."

#### 7.2 Hvis ingen replacement-master kvalifiserer

Force-shutdown hele hall-gruppen for resten av økten:
```sql
UPDATE app_halls SET is_active = false WHERE group_hall_id = '<group>';
```
Refund alle pågående billetter manuelt via agent-shift-log.

### Recovery-tid

- **Med manuell SQL-fallback:** 10–30 min (avhenger av Tobias
  responstid).
- **Med implementert `transferHallAccess`:** < 60 sek (TTL-handshake +
  broadcast). Ikke tilgjengelig i dag.

### Testing

- **Drill (§9.5):** kill master-hall-terminal i staging mens en runde
  er aktiv. Mål tid til alle haller i gruppen er recovered (refund +
  klar for neste runde).

---

## 8. Pengespill-server-tap (Swedbank Pay)

### Sannsynlighet: Lav

Swedbank Pay har 99.95% SLA. Datatap fra vår side er sjelden, men
**reconciliation-feil** mellom vår compliance-ledger og Swedbank-
intent-status er en mer realistisk risiko.

### Impact: Høy (regnskaps-inkonsistens, regulatorisk eksponering)

Mismatch mellom hva spilleren har betalt (Swedbank-side) og hva vi
har registrert som innskudd (vår DB) → potensielt tap eller dobbelt-
kreditering.

### Prevention

- **Idempotency-keys på alle Swedbank-intents:** payment_intent_id er
  UNIQUE i `app_swedbank_payment_intents`. Duplikat-callbacks fra
  Swedbank ignoreres trygt.
- **Reconcile-job:** `swedbank-payment-sync`
  (`apps/backend/src/jobs/swedbankPaymentSync.ts`) kjører hver 60 min
  og henter status for alle intents siste 24t som ikke er i terminal-
  state. Plukker opp glemte callbacks.
- **Audit-log per state-transition:** alle endringer
  (`PENDING → PAID → CREDITED`) logges med Swedbank `reference_id`.

### Detection

- **Reconcile-job error rate** i Sentry. Spike → manuelt sjekk-arbeid.
- **Manuell daglig-rapport-avvik:** compliance-eier kjører
  `/api/admin/reports/daily?date=...` og sammenlikner mot Swedbank
  Merchant Portal manuelt. Avvik > 100 NOK/dag flaggges.
- **Sluttbruker-klage:** spiller har innbetalt men ser ikke saldo.
  L1 → L2 → L2-payment escalation per `HALL_PILOT_RUNBOOK.md` §2.

### Response — runbook

#### 8.1 Manglende callback fra Swedbank

1. Kjør `swedbankPaymentSync.ts` manuelt mot intent-id-en:
   ```bash
   curl -X POST https://<backend>/api/admin/payments/sync \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -d '{"paymentIntentId":"<id>"}'
   ```
2. Hvis Swedbank rapporterer `PAID` men vår DB sier `PENDING`: jobben
   credit-er saldoen automatisk.
3. Verifiser: spiller får push (BIN-FCM) og saldo-banner.

#### 8.2 Dobbelt-kreditering (svært sjelden, men kritisk)

1. **Stop the bleeding:** sett spillerens `kyc_status='SUSPENDED'`
   midlertidig så ingen nye spill startes med korrupt saldo.
2. **Diagnose:** `SELECT * FROM app_compliance_ledger WHERE
   user_id='<id>' AND created_at > '<window>'` — finn de duplikate
   ledger-radene.
3. **Korrigering:** skriv en `correction`-ledger-rad med negativt
   beløp. ALDRI slett ledger-rader. Compliance-eier signerer
   korrigeringen i audit-log.
4. **Eskalering:** SEV-1 hvis > 1000 NOK avvik. Lotteritilsynet-
   melding innen 24 timer.

#### 8.3 Swedbank Pay nede

Spillere kan ikke gjøre innskudd. Eksisterende saldo er upåvirket —
spill kan fortsette på bestående midler. Banner i klient: "Innskudd
midlertidig utilgjengelig, prøv igjen om noen minutter." Reconcile-
job plukker opp eventuelle henging-intents når Swedbank kommer tilbake.

### Recovery-tid

- **Manglende callback:** < 5 min via manuell sync.
- **Dobbelt-kreditering:** 1–4 timer (diagnose + korrigering +
  compliance-godkjenning).
- **Swedbank-utfall:** avhenger av Swedbank, typisk < 1 time.

### Testing

- **Reconcile-test (§9.6):** simuler manglende callback ved å mocke
  Swedbank-respons til 500 i staging. Verifiser at job-en plukker det
  opp ved neste tick.

### Lotteritilsynet-SLA

Per `pengespillforskriften` §11 + Spillorama-konsesjon:

- **Datatap som påvirker spiller-utbetalinger:** meldepliktig innen
  **24 timer** (skriftlig).
- **Sikkerhetshendelser med personopplysninger:** meldepliktig til
  Datatilsynet innen **72 timer** (GDPR Art. 33).
- **Større utfall (>1 time, >50% av haller):** muntlig varsel
  umiddelbart, skriftlig oppfølger innen 24 timer.

Compliance-eier eier alle disse SLA-ene. Backend-team leverer
data-eksport på forespørsel innen 1 time.

---

## 9. Test-program — DR-drills

For å verifisere at planen faktisk fungerer kjører vi månedlige
drills i staging. Hver drill har en eier, mål, og pass/fail-kriterium.

| # | Drill | Frekvens | Eier | Pass-kriterium |
| --- | --- | --- | --- | --- |
| 9.1 | Backend-krasj-recovery | Månedlig (etter PR-er som rører recovery) | Backend on-call | < 2 min reconnect, 0 datatap |
| 9.2 | DB PITR-restore | Månedlig | Backend on-call + Tobias | Restore til timestamp lykkes; data konsistent |
| 9.3 | Hall-internett-kutt | Kvartalsvis | L1 + L2 | Refund-flow trigger automatisk |
| 9.4 | Terminal-bytte | Månedlig | L1 hall-admin | < 10 min state-recovery |
| 9.5 | Master-hall-failover | Månedlig | L2 backend on-call + Tobias | < 30 min recovery, alle haller refunded |
| 9.6 | Swedbank reconcile | Månedlig | Compliance + L2-payment | Job plukker opp manglende callback |

**Drill-log:** alle drills loggføres i
`docs/operations/dr-drill-log/<yyyy-mm>-<drill-id>.md` med:
- Dato + miljø
- Eier + deltakere
- Trinn-for-trinn observasjon
- Pass/fail
- Eventuelle gaps som krever doc-update

**Pre-pilot-krav:** drill 9.1, 9.2 og 9.5 må være utført minst én gang
med pass før første hall flippes.

---

## 10. Topp-3 åpne risikoer som krever beslutning fra Tobias

### Risiko 1: Single-region-deploy (Render Frankfurt)

Hele stacken kjører i én Render-region. Region-utfall (sjelden, men
hendt — Frankfurt har hatt 2t-utfall ~1 gang per 2 år) tar hele
pilot-en ned.

**Beslutningsbehov:**
- (a) Akseptert risiko, ingen handling. Render rapporterer 99.9% SLA.
- (b) Cold-standby i en andre region (Oslo eller US-East), månedlig
  failover-test. Kostet ekstra ~2000 NOK/mnd. Estimert dev-tid: 2
  dager.
- (c) Active-passive med Postgres replication. Kostet ekstra ~5000
  NOK/mnd. Dev-tid: 5 dager.

**Anbefaling:** (a) for pilot (90 dager). Re-evaluer for full rollout.

### Risiko 2: Backup-restore-prosedyre er aldri testet

Vi har Render auto-backup, men ingen i teamet har faktisk gjort en
PITR-restore mot prod-snapshot. Risiko: backup er korrupt, og vi
oppdager det først når vi trenger det.

**Beslutningsbehov:**
- Når kjører vi første full restore-drill (9.2)?
- Hvilken staging-instans tester vi mot?
- Hvem signerer at restoren er valid (sjekker compliance-ledger
  konsistens)?

**Anbefaling:** drill innen uke 2 av pre-pilot, eier Tobias +
backend on-call. Pass-kriterium: full DB-restore til staging,
backend booter, smoke-suite passerer.

### Risiko 3: Hall-internett-redundans

23 haller, ingen sentral oversikt over hvilke har 4G-fallback eller
ikke. Hall som ofte mister internett vil ramme spilleropplevelsen
hardt under pilot.

**Beslutningsbehov:**
- Skal vi kreve 4G-fallback per hall før pilot, eller akseptere at
  noen haller har lavere oppetid?
- Kostnad ~5000 NOK + abonnement per hall. 23 haller = ~115k NOK
  engangs + abonnement.
- Alternativ: pilot-hall-utvalget begrenses til de 5-10 hallene som
  allerede har redundans.

**Anbefaling:** krev 4G-fallback for alle pilot-haller. Hvis budsjett
ikke tillater, begrens pilot-scope til haller med eksisterende
redundans for de første 4 ukene.

### (Bonus) Risiko 4: `transferHallAccess` ikke implementert

Strengt tatt ikke topp-3, men kritisk for multi-hall-grupper. Se §7.

**Beslutningsbehov:**
- Skal vi implementere `transferHallAccess` (60s TTL handshake) før
  pilot, eller bruke manuell SQL-fallback?
- Dev-tid: 3-5 dager. Eier: en backend-agent.

**Anbefaling:** SQL-fallback for første pilot-uke; implementer
transferHallAccess i uke 2-3 hvis pilot går over til full-rollout.

---

## 11. Anbefaling: hva må gjøres før pilot, hva kan vente

### Uke 0–2 (FØR pilot-start) — må-ha

| # | Tiltak | Eier | Effort |
| --- | --- | --- | --- |
| 1 | Oppgrader Render-plan til `pro` (dual-instans + 30d backup-retention + PITR) | Tobias | 1 t |
| 2 | Kjør drill 9.2 (full PITR-restore mot staging) | Backend on-call | 1 dag |
| 3 | Kjør drill 9.1 (backend-krasj-recovery) | Backend on-call | 0.5 dag |
| 4 | Sett opp deploy-blackout-vinduer (ikke deploy under spilltider) | Ops + PM | 0.5 dag |
| 5 | Bekreft 4G-fallback-status per pilot-hall | Tobias + hall-admins | 1 uke |
| 6 | Distribuer kontaktkjede (HALL\_PILOT\_RUNBOOK §2) til alle hall-admins | PM | 1 dag |
| 7 | Sett opp PagerDuty/Slack-integrasjon for SEV-1-alerts | Ops | 1 dag |
| 8 | Kjør drill 9.5 (master-hall-failover) | Backend on-call + Tobias | 0.5 dag |

### Uke 3–4 (etter første pilot-uke) — bør-ha

| # | Tiltak | Eier | Effort |
| --- | --- | --- | --- |
| 9 | Implementer `transferHallAccess` 60s handshake | Backend-agent | 3–5 dager |
| 10 | Sett opp ukentlig `pg_amcheck`-cron | Backend | 0.5 dag |
| 11 | Per-hall socket-counter-metrik for tidlig hall-offline-deteksjon | Backend | 0.5 dag |
| 12 | Skriv ferdig SOPs for hall-admin (refund-flow ved internett-kutt) | PM + L1 | 1 dag |
| 13 | Etabler dr-drill-log mappe + første loggrad | Backend on-call | 0.5 dag |

### Etter første pilot-måned — kan-vente

| # | Tiltak | Eier | Effort |
| --- | --- | --- | --- |
| 14 | Vurder cold-standby i andre Render-region | Tobias | 2 dager (hvis ja) |
| 15 | Lokal cache i web-klient for tilkoblings-glitch (subsekund-disconnects) | Frontend | 3 dager |
| 16 | Automatisk synthetic-monitor mot `/health` fra ekstern lokasjon | Ops | 1 dag |
| 17 | Lotteritilsynet-rapport-template for SEV-1-incidents | Compliance | 1 dag |

---

## 12. Plan-eierskap og approval

| Rolle | Ansvar | Sign-off |
| --- | --- | --- |
| Technical lead (Tobias) | Endelig beslutning på §10 åpne risikoer; signerer §11 anbefalingsliste | _pending_ |
| Backend on-call | Eier drill 9.1, 9.2, 9.5; oppdaterer planen etter hver drill | _pending_ |
| Compliance-eier | Eier Lotteritilsynet-rapport-flow (§8.5); signerer DR-test-evidens | _pending_ |
| L1 Hall-operatør | Eier drill 9.3, 9.4 i sin hall | _pending_ |
| Ops | Eier alert-routing, deploy-blackout, PagerDuty-konfig | _pending_ |

Planen er i kraft når **alle fem signaturer** er registrert (med dato +
Linear-kommentar-link). Drift kan IKKE starte uten sign-off.

Ved oppdatering av planen — bump "Last updated" øverst, post
endring i `#ops-cutover`, oppdatér Linear-tickets som referer denne
filen.
