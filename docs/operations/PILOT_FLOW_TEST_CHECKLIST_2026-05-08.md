# Pilot-flow manuell test-checklist — 2026-05-08

**Mål:** Verifiser at pilot-flyten fungerer end-to-end uten Playwright. Følg stegene
i rekkefølge — hvert steg har én tydelig "forventet" og et "feilet"-trinn.

**Scenario:**
1. Admin oppretter spilleplan med start kl 11:00 (norsk tid) for pilot-GoH (4 haller).
2. Hver av de 4 hallene markerer ready.
3. Master-hall starter neste spill.
4. En kunde logger inn, velger hall, kjøper bong og deltar i runden.
5. Runden fullføres; pot-deling per § 9 verifiseres i compliance-ledger.

**Tidsbruk:** ~30-45 min når alt klaffer.

---

## Pre-requisites

- [ ] Backend dev-server kjørende: `npm --prefix apps/backend run dev` (port 4000)
- [ ] Admin-web dev-server kjørende: `npm --prefix apps/admin-web run dev` (port 5174)
- [ ] DB seedet med 4 pilot-haller. Kjør én av:
  ```bash
  npm --prefix apps/backend run seed:demo-pilot-day
  # eller hvis allerede seedet:
  npm --prefix apps/backend run seed:demo-tv-and-bonus
  ```
- [ ] Tilgang til admin-bruker `tobias@nordicprofil.no` (passord delt på sikker kanal).
- [ ] Smoke-test-script kjørt OK (se §0 nedenfor) — bekrefter API-svar før manuell flyt.

**Demo-haller etter seed:**

| ID              | Navn                          | Hall-nr | TV-token                                |
|-----------------|-------------------------------|---------|-----------------------------------------|
| demo-hall-001   | Demo Bingohall 1 (Master)     | 1001    | `11111111-1111-4111-8111-111111111111`  |
| demo-hall-002   | Demo Bingohall 2              | 1002    | `22222222-2222-4222-8222-222222222222`  |
| demo-hall-003   | Demo Bingohall 3              | 1003    | `33333333-3333-4333-8333-333333333333`  |
| demo-hall-004   | Demo Bingohall 4              | 1004    | `44444444-4444-4444-8444-444444444444`  |

**Demo-spillere:** `demo-spiller-1@example.com` … `demo-spiller-12@example.com` (3 per hall).

---

## §0 Smoke-test API før vi starter

```bash
bash apps/backend/scripts/pilot-smoke-test.sh
```

- [ ] Health endpoint svarer 200
- [ ] Login som admin gir `accessToken`
- [ ] `/api/admin/game-catalog` returnerer minst 1 entry (bingo)
- [ ] `/api/admin/hall-groups` returnerer minst 1 GoH med 4 haller
- [ ] `/api/admin/halls` listet pilot-hallene over

Hvis script feiler — fix før du går videre.

---

## §1 Admin oppretter spilleplan kl 11:00

Bruk admin-web (`http://localhost:5174/admin/`) med admin-konto.

- [ ] Naviger til **Game-katalog → Spilleplaner** (`/admin/#/games/plans`)
- [ ] Trykk **"Ny spilleplan"**
- [ ] Fyll inn:
  - Navn: `Pilot 11:00 — 2026-05-08`
  - Tilordning: `Group of halls`
  - GoH: pilot-GoH (alle 4 haller)
  - Start-tid: `11:00`
  - Slutt-tid: `23:00`
- [ ] Trykk **"Lagre planinformasjon"**
- [ ] Forventet: plan-ID returnert, plan vises i lista. Kopier plan-ID for senere.
- [ ] Drag-and-drop **"Bingo"** (Spill 1) fra katalog → planens sekvens. Sett pris (eks 5 kr/bong).
- [ ] Trykk **"Lagre items"** (drag-and-drop save)
- [ ] Forventet: items lagret, response viser sequence med 1 entry.

**Verifiser i SQL:**
```sql
SELECT id, name, start_time, end_time, is_active, group_of_halls_id
FROM app_game_plans
WHERE name LIKE 'Pilot 11:00%' ORDER BY created_at DESC LIMIT 1;
```
- [ ] Forventet: 1 rad med `is_active=true`, `start_time=11:00`, GoH-id satt.

---

## §2 Hall-ready-flyt (4 haller markerer ready)

Hver hall må logge inn og markere ready. I dev kan du gjøre dette via API direkte
eller åpne 4 browser-vinduer (helst incognito for å skille sesjoner).

### Variant A: Browser (visuell test)

For hver av de 4 hallene:
1. Åpne incognito-vindu (fjerne forrige sesjon)
2. Logg inn på `/admin/` som hall-operator for hallen
3. Naviger til **Spill 1 — Master** (`/admin/#/game1/master`)
4. Bekreft at gjeldende plan vises (Pilot 11:00)
5. Trykk **"Marker hall klar"**

- [ ] Hall 1 (Master) markert ready
- [ ] Hall 2 markert ready
- [ ] Hall 3 markert ready
- [ ] Hall 4 markert ready

### Variant B: API direkte (raskere)

```bash
# Erstatt $TOKEN med admin-token, $GAME_ID med scheduled-game-id fra steg §1
for HALL in demo-hall-001 demo-hall-002 demo-hall-003 demo-hall-004; do
  curl -sf -X POST "http://localhost:4000/api/admin/game1/halls/$HALL/ready" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"gameId\":\"$GAME_ID\"}" | jq '.data.status'
done
```

- [ ] Alle 4 returnerer `"ready"`-status

**Verifiser:**
- [ ] `GET /api/admin/game1/games/$GAME_ID/ready-status` viser alle 4 haller med `state=ready`
- [ ] Master-hall ser alle 4 i grønt (visuell test) eller via API

---

## §3 Master starter neste spill

I master-hallens browser:

- [ ] Naviger til **Spill 1 — Master**
- [ ] Verifiser: alle 4 haller listet som klare
- [ ] Trykk **"Start neste spill"**
- [ ] Hvis confirm-popup: bekreft

Eller via API:
```bash
curl -sf -X POST "http://localhost:4000/api/agent/game1/start" \
  -H "Authorization: Bearer $MASTER_TOKEN" \
  -H "Content-Type: application/json" | jq
```

- [ ] Forventet response: `ok=true`, scheduled_game.status = `running`
- [ ] Engine startet, første ball trekkes innen 5-10 sekunder

**Verifiser i SQL:**
```sql
SELECT id, status, started_at, master_hall_id, participating_halls_json
FROM app_game1_scheduled_games
WHERE status='running' ORDER BY started_at DESC LIMIT 1;
```
- [ ] `status='running'`
- [ ] `participating_halls_json` inneholder alle 4 hall-IDer
- [ ] `master_hall_id='demo-hall-001'`

---

## §4 Kunde-deltagelse (bong-kjøp og spill)

Web-shell: `http://localhost:4000/web/?dev-user=demo-spiller-4` (spiller på hall 2).

Eller logg inn manuelt på `/web/` med `demo-spiller-4@example.com`.

- [ ] Web-shell laster, lobby vises
- [ ] Velg hall: **Demo Bingohall 2** (eller la default-hallen være satt)
- [ ] Verifiser saldo i header (skal være > 0 fra seed)
- [ ] Naviger til **Spill 1** (Bingo) — pågående runde
- [ ] Forventet: kjøps-UI åpner med tilgjengelige bong-farger og priser
- [ ] Velg én bong-farge (eks **hvit**, 5 kr)
- [ ] Trykk **"Kjøp"**
- [ ] Forventet: wallet-saldo reduseres med 5 kr, bong vises i runde-vinduet
- [ ] Verifiser at trukne baller markeres på bongen i sanntid

**Verifiser i SQL:**
```sql
-- Wallet-debit:
SELECT type, amount, reason, created_at
FROM app_wallet_transactions
WHERE wallet_id IN (SELECT wallet_id FROM app_users WHERE email='demo-spiller-4@example.com')
ORDER BY created_at DESC LIMIT 5;
-- Forventet: STAKE-rad på 5 kr (eller -500 cents).

-- Bong-rad:
SELECT id, hall_id, ticket_color, price_cents
FROM app_game1_tickets
WHERE user_id IN (SELECT id FROM app_users WHERE email='demo-spiller-4@example.com')
ORDER BY created_at DESC LIMIT 5;
-- Forventet: 1 rad med hall_id=demo-hall-002 (kjøpe-hall, ikke master).
```

- [ ] STAKE-rad finnes
- [ ] Bong-rad finnes med korrekt `hall_id` (kjøpe-hall, ikke master)

---

## §5 Runde-fullføring og pot-deling per § 9

La engine kjøre til Fullt Hus eller 75 baller trekkes.

- [ ] Hvis demo-spilleren vinner Rad 1/2/3/4/Fullt Hus:
  - [ ] Win-popup vises i klient
  - [ ] Wallet kreditert med PRIZE-amount
- [ ] Når Fullt Hus oppnås (eller 75 baller utløp):
  - [ ] `scheduled_game.status='completed'` i DB
  - [ ] `completed_at`-timestamp satt

**Verifiser pot-deling i compliance-ledger:**
```sql
SELECT
  event_type,
  amount_minor,
  game_variant,
  pot_cents_for_bong_size,
  actor_hall_id,
  created_at
FROM app_rg_compliance_ledger
WHERE game_session_id = '<GAME_ID fra §3>'
ORDER BY created_at;
```

- [ ] PRIZE-entries finnes for hver vinner
- [ ] `game_variant` er satt (eks `BINGO_75`)
- [ ] `pot_cents_for_bong_size` er satt (per bong-farge)
- [ ] `actor_hall_id` matcher kjøpe-hallen for hver enkelt PRIZE (ikke master) — dette er § 71-multi-hall-fix
- [ ] HOUSE_RETAINED-entry finnes hvis pot-floor ikke ble fylt
- [ ] Sum av PRIZE + HOUSE_RETAINED = total pot for runden

**Verifiser § 11-distribusjon (15% til organisasjoner for hovedspill):**
```sql
SELECT game_type, SUM(amount_minor) AS total_minor
FROM app_rg_compliance_ledger
WHERE game_session_id = '<GAME_ID>'
GROUP BY game_type;
```
- [ ] `game_type='MAIN_GAME'` (hovedspill, ikke DATABINGO) — verifiserer SPILLKATALOG-fix
- [ ] Total stake-sum stemmer med antall solgte bonger × pris

---

## §6 Multi-hall-binding (§ 71)

Ekstra kritisk sjekk: kjøp fra to forskjellige haller skal binde til riktig hall i compliance-ledger.

```sql
-- Sammenligne stake-bindinger:
SELECT actor_hall_id, COUNT(*) AS stake_count
FROM app_rg_compliance_ledger
WHERE game_session_id = '<GAME_ID>' AND event_type='STAKE'
GROUP BY actor_hall_id;
```

- [ ] Hvert `actor_hall_id` matcher faktisk kjøpe-hall
- [ ] Ingen entries har `actor_hall_id=demo-hall-001` (master) når kjøpet var i en annen hall

---

## Pass / Fail

| Steg | Resultat |
|---|---|
| §0 Smoke-test API | ☐ Pass / ☐ Fail |
| §1 Spilleplan opprettet | ☐ Pass / ☐ Fail |
| §2 Alle 4 haller ready | ☐ Pass / ☐ Fail |
| §3 Master startet | ☐ Pass / ☐ Fail |
| §4 Kunde-bong-kjøp | ☐ Pass / ☐ Fail |
| §5 Pot-deling i ledger | ☐ Pass / ☐ Fail |
| §6 Multi-hall actor-binding | ☐ Pass / ☐ Fail |

**Hvis alle pass:** pilot-flyten er funksjonelt verifisert.

**Hvis noen feil:** flagg konkret hvilket steg + hva som skjedde + screenshot/SQL-output.
Lag en bug-rapport med:
- Steg-nummer (eks "§4 — kunde-deltagelse")
- Forventet adferd
- Faktisk adferd
- Screenshot eller log-utdrag
- DB-state (relevante SELECT-resultater)

---

## Vedlegg: vanlige fallgruver

| Symptom | Sannsynlig årsak | Fix |
|---|---|---|
| Ready-knapp grayed out | Plan ikke aktiv eller feil tid | Sjekk `start_time` i `app_game_plans`, må være ≤ now |
| Master kan ikke starte | < 4 haller ready | Fullfør alle 4 haller i §2 |
| Bong-kjøp returnerer 403 | Compliance-block (§ 66 pause / § 23) | Sjekk `app_rg_player_state` for spilleren |
| Ingen PRIZE-rad i ledger | Engine-bug eller payout-cap | Sjekk Render-logger for "payout_cap_exceeded" |
| `actor_hall_id` = master på alle | PR #443 (compliance-fix) ikke deployed | Verifiser `Game1TicketPurchaseService.ts:606` |
| Web-shell laster ikke saldo | Auth-token utløpt | Re-login eller sjekk `/api/auth/me` |

---

## Referanser

- Master-plan: [`MASTER_PLAN_SPILL1_PILOT_2026-04-24.md`](../architecture/MASTER_PLAN_SPILL1_PILOT_2026-04-24.md)
- Eksisterende smoke-test: [`PILOT_SMOKE_TEST_CHECKLIST_2026-04-28.md`](./PILOT_SMOKE_TEST_CHECKLIST_2026-04-28.md) (lengre, full pilot-dag)
- 4-hall demo runbook: [`PILOT_4HALL_DEMO_RUNBOOK.md`](./PILOT_4HALL_DEMO_RUNBOOK.md)
- Lokal dev URLer: [`LOCAL_DEV_QUICKSTART.md`](./LOCAL_DEV_QUICKSTART.md)
- Spillkatalog (regulatorisk): [`SPILLKATALOG.md`](../architecture/SPILLKATALOG.md)
