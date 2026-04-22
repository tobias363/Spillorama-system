# Pilot QA-guide — 4 haller i én link (2026-04-22)

Manuell test-prosedyre for live pilot av **Spill 1** med 4 haller i hall-gruppen
**"Pilot-Link (Telemark)"**. Bruk denne etter at `scripts/seed-pilot-halls.mts`
og `scripts/seed-pilot-game-plan.mts` er kjørt.

Pass/fail-kriterier er per steg. Hvis et steg feiler, notér:
- stegnummer
- forventet vs observert atferd
- server-log (grep på `[game1]`, `pilot-`, hall-slug)
- skjermdump om relevant

Rapportér feil til PM-kanalen, ikke til hall-operatøren direkte.

---

## 0. Forutsetninger

### 0.1 Kodebase og DB

- [ ] `main` er up-to-date og inkluderer PR 4d + 4e (pilot-rigging-scripts).
- [ ] `npm install` kjørt i repo-rot.
- [ ] `npm run build:types` kjørt (kreves for tsx å løse shared-types).
- [ ] Postgres kjører lokalt eller tilgjengelig via `APP_PG_CONNECTION_STRING`.
- [ ] `npm --prefix apps/backend run migrate` kjørt.
- [ ] **Workaround** (inntil HallGroupService-fix er merget):
  `ALTER TABLE app_halls ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';`
  Se `scripts/PILOT_SETUP_README.md` seksjon "Kjent blocker".
- [ ] `scripts/seed-pilot-halls.mts` kjørt uten feil.
- [ ] `scripts/seed-pilot-game-plan.mts` kjørt uten feil.

### 0.2 Prosesser

- [ ] Backend oppe (`npm run dev`) — health-check `GET /health` returnerer 200.
- [ ] Admin-web oppe (`npm run dev:admin`) — tilgjengelig på `http://localhost:5173`.
- [ ] Game-client oppe (`npm run dev:games`) — tilgjengelig på hallenes spiller-URLer.

### 0.3 Test-brukere

- [ ] En admin-bruker finnes med rolle `ADMIN`. Hvis ikke:
  `npm --prefix apps/backend run seed:test-users` etter at hallene er seedet,
  så tilordne ønsket bruker `role=ADMIN` via DB-konsoll.
- [ ] 4 test-spillere finnes — én per hall, med `hall_id` satt til riktig pilot-hall.
  Kan lages via admin-UI (Brukere → Ny) eller registrering-flyten.

**Pass-kriterium:** alle bokser over er haket.

---

## 1. Admin-steg

### 1.1 Verifiser hall-gruppen

1. Logg inn på admin-web som `ADMIN`.
2. Gå til **Hall-grupper** (venstremeny).

**Forventet:**
- [ ] Gruppen **"Pilot-Link (Telemark)"** vises med status `active`.
- [ ] Gruppen har 4 medlemmer: Notodden Pilot, Skien Pilot, Porsgrunn Pilot, Kragerø Pilot.

**Fail-indikator:** gruppen mangler, har færre medlemmer, eller status=inactive.

### 1.2 Verifiser GameManagement-radene

1. Gå til **Spill-forvaltning** (Game Management).
2. Filtrer på `gameTypeId=game_1`.

**Forventet:**
- [ ] 3 rader vises: Pilot Morgen-bingo (09:00), Pilot Lunsj-bingo (12:00), Pilot Kveld-bingo (18:00).
- [ ] Alle har status=`active`.
- [ ] ticketPrice hhv. 10 / 15 / 20 kr.

### 1.3 Start morgen-bingo via master-konsoll

1. Gå til **Master-konsoll** / **Live operations**.
2. Velg hall-gruppen "Pilot-Link (Telemark)".
3. Velg GameManagement-rad "Pilot Morgen-bingo".
4. Trykk **Start spill**.

**Forventet:**
- [ ] Master-konsoll viser spillet som `running`.
- [ ] Alle 4 haller får en socket-event `game:roundStarted` (sjekk server-log: `grep roundStarted`).
- [ ] Tilkoblete spiller-klienter i hver hall får popup / lobby-oppdatering.

**Fail-indikator:** kun én hall mottar event, eller socket-timeout i logg.

### 1.4 Auto-draw-trekk kommer

1. Etter at spillet er startet, vent 30 sek (default auto-draw-intervall).
2. Observer master-konsoll og spiller-klienter.

**Forventet:**
- [ ] Master-konsoll viser numrene som trekkes.
- [ ] Alle 4 haller ser samme trekkerekkefølge (bekrefter cross-hall-synk).
- [ ] Server-log viser `[game1] auto-draw tick ...` jevnlig.

### 1.5 Stopp spill

1. Trykk **Stopp spill** i master-konsoll.

**Forventet:**
- [ ] Spillet går til status=`closed` (eller `finish` i DailySchedule-kontekst).
- [ ] Spillere får `game:roundEnded`-event og returneres til lobby.
- [ ] GameManagement-raden kan startes på nytt (idempotency).

---

## 2. Spiller-steg

Gjenta stegene 2.1–2.5 for hver av de 4 pilot-hallene (Notodden, Skien, Porsgrunn, Kragerø).
I praksis: åpne 4 inkognito-faner samtidig, én per hall.

### 2.1 Logg inn

1. Åpne spiller-URL for hallen (f.eks. `http://localhost:5174/?hall=pilot-notodden`).
2. Logg inn med test-spilleren tilordnet den hallen.

**Forventet:**
- [ ] Lobby viser hall-navn + saldo.
- [ ] Ingen "HALL_MISMATCH" eller "ROOM_NOT_FOUND"-feil i konsoll.

### 2.2 Se fremtidige spill i popup

1. I lobby, se etter "Neste spill"-popup eller lobby-kort.

**Forventet:**
- [ ] De 3 pilot-spillene vises med tidspunkt (09:00, 12:00, 18:00).
- [ ] Navn, pris og antall faser matcher det som er seedet.

**Fail-indikator:** tom lobby, feil priser, manglende fase-info.

### 2.3 Kjøp bonger (digital wallet)

1. Velg aktivt spill ("Pilot Morgen-bingo" hvis startet).
2. Kjøp 2–3 bonger.

**Forventet:**
- [ ] Wallet-saldo trekkes korrekt (10 kr × antall bonger).
- [ ] Bongene vises i "Mine bonger".
- [ ] Server-log: `[game1] ticket.purchase` med riktig userId + roundId.

**Fail-indikator:** dobbelttrekk på wallet, manglende bong, eller `TICKET_LIMIT_REACHED`
før forventet grense.

### 2.4 Se live-bong under spill

1. Etter at admin starter spillet (steg 1.3), observer bongene.

**Forventet:**
- [ ] Trekte tall markeres automatisk på bongene.
- [ ] Fase-indikator oppdateres når bong oppfyller fase-krav (1 rad, 2 kolonner, osv.).
- [ ] Ingen blink-diagnostikk i konsoll hvis spillet oppfører seg normalt.

### 2.5 Verifiser premie etter vinn

1. La spillet gå til en av test-bongene vinner (manual claim eller auto-claim).

**Forventet:**
- [ ] Vinner-popup vises.
- [ ] Wallet krediteres med premien (100 kr for fase 1, 1000 kr for Fullt Hus).
- [ ] Server-log: `[game1] game.win` med riktig phase + prize-beløp.
- [ ] Loyalty-hook fyrer (se `LoyaltyPointsHookAdapter`-log hvis aktivert).

**Fail-indikator:** premien kommer ikke, eller feil beløp vs config.

---

## 3. Cross-hall-spesifikke tester

Disse tester at alle 4 haller faktisk deltar i **samme draw-sekvens** (ikke isolert).

### 3.1 Synkronisert trekk

1. Åpne 4 spiller-faner (én per hall), alle i samme pågående spill.
2. Observer trekkrekkefølgen på hver.

**Forventet:**
- [ ] Identisk tall-sekvens på alle 4 haller.
- [ ] Tidsavviket mellom trekk-vis-på-klient er < 1 sek mellom haller.

### 3.2 Vinnere varsles cross-hall

1. La en bong i Notodden Pilot vinne fase 1.
2. Observer spiller-klient i Skien Pilot.

**Forventet:**
- [ ] Skien-klienten får et varsel eller lobby-oppdatering om vinner (hvis implementert).
- [ ] Spillet fortsetter til fase 2 på alle 4 haller samtidig.

**Kjent begrensning:** cross-hall-vinner-varsler kan være minimal i nåværende
klient (kun master-konsoll får full liste). Forventet før Spill 2/3.

---

## 4. Pass/fail-sammendrag

**Pass-kriterier for pilot-ok-beslutning:**

- [ ] Alle admin-steg (1.1–1.5) passerer.
- [ ] Minst 2 av 4 haller gjennomfører alle spiller-steg (2.1–2.5).
- [ ] Cross-hall-synk (3.1) er grønn.

**Fail-kriterier som krever stopp:**

- Dobbelttrekk på wallet (regulatorisk blocker).
- Trekkrekkefølge avviker mellom haller (engine-integritet).
- KYC-grense / Spillvett-grense overstyres (compliance-blocker).

---

## 5. Kjente begrensninger

### 5.1 Minispill
- Minispill (hjul, kiste, mystery, colordraft) er konfigurert som admin-tabell
  i DB men er **ikke wired inn i runtime** ennå. Spillere vil ikke se minispill
  under pilot — dette er forventet, ikke en blocker.

### 5.2 Jackpot
- Kveld-bingo har per-farge-jackpot definert i `config_json`, men
  **akkumulering over dager er ikke implementert**. Hvert spill starter med
  det definerte beløpet. Ikke en blocker for pilot.

### 5.3 Spill 2 / Spill 3 / Kvikkis
- Scope for pilot er **kun Spill 1**. Spill 2 og 3 finnes i admin-UI men
  runtime er ikke produksjonsklart. Ikke test disse under pilot.

### 5.4 Legacy shell
- Pilot-klienten kjører den nye web-shellen. Candy iframe-embed er **ikke del
  av pilot**. Dette er dokumentert som kjent arkitektur-gap.

### 5.5 Loyalty-poeng
- LoyaltyService fyrer hook ved purchase + win, men **poeng-visning i klient**
  er kun delvis wired. Server-log viser korrekt akkumulering.

---

## 6. Rollback-prosedyrer

### 6.1 Stoppe et løpende spill

**I admin-UI:**
1. Master-konsoll → velg spillet → **Stopp spill**.

**Via DB (nødlås):**
```sql
UPDATE app_game_management
SET status = 'closed', updated_at = now()
WHERE id = '<game-management-id>';
```

Deretter må backend restartes for at runtime-engine skal slippe runden.

### 6.2 Refund-prosedyre (manuell)

Hvis bonger må refunderes pga. teknisk feil:

1. Finn alle ticket-purchases for spillet i `app_ticket_purchases` (eller
   tilsvarende tabell — se `apps/backend/src/game/Game1TicketPurchaseService.ts`).
2. Bruk `WalletAdapter`-refund-API via admin-rute
   (`POST /api/admin/wallet/refund`) med userId + beløp.
3. Logg refund i compliance-log (auto via `AuditLogService`).

Manuell refund via SQL er **ikke anbefalt** — går utenom audit-log.

### 6.3 Tear-down komplett pilot-data

```bash
APP_PG_CONNECTION_STRING="postgres://..." \
  npx tsx scripts/pilot-teardown.mts
```

Soft-sletter alle pilot-haller + gruppen + GameManagement-rader. Idempotent.
Se `scripts/PILOT_SETUP_README.md` for detaljer.

### 6.4 Rollback backend til forrige versjon

Se `docs/operations/ROLLBACK_RUNBOOK.md` for full prosedyre. Kort:
1. `git revert <pilot-merge-commit>` → ny commit.
2. Deploy revert-commit via vanlig CI/CD.
3. Restart backend og admin-web.
4. Bekreft health-check grønn.

---

## 7. Kontakt og eskalering

| Hva                    | Hvem                     |
| ---------------------- | ------------------------ |
| Teknisk backend-feil   | PM (Claude) via Linear   |
| Spill-klient-feil      | PM → frontend-agent      |
| Compliance-bekymring   | Tobias direkte           |
| DB i ulage             | Kjør `pilot-teardown.mts` + reseed |
| Uklart hva som feiler  | Legg skjermdump + log i PM-kanal |

**Ikke** eskalér direkte til hall-operatør før PM har bekreftet at det er
en reell blocker.
