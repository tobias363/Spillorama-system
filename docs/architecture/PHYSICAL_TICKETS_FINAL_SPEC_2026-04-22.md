# Fysiske Bonger — Endelig Spec (låst)

**Dato:** 2026-04-22
**Status:** LÅST — klar for implementering i Bølge 2
**Referanse:** Erstatter tidligere `PHYSICAL_TICKETS_PILOT_DESIGN_2026-04-22.md`-innhold etter Tobias-bekreftelse i chat-tråd

---

## Modell: Range-basert batch-salg (legacy-port)

Port av legacy-modellen med moderne forbedringer:
- Slavisk sekvensielt salg (ingen skip-rekka)
- Scan-funksjon for å unngå tastefeil
- Automatisk hall-validering via serial-lookup
- Handover inkluderer både usolgte og solgte (uutbetalte) bonger

---

## Full flyt

### Fase 1: Import (engangs, per hall, av admin)

Bonger produseres hos trykkeri med hall-tilknytning fysisk printet. Leverandør leverer CSV per hall-bestilling:

```csv
hall_name,ticket_id,ticket_color,num1,num2,...,num25
Teknobingo Harstad,10002590405,small_yellow,3,18,32,47,62,...
Teknobingo Harstad,10002590406,small_yellow,7,22,38,51,68,...
Notodden,01-1001,small_yellow,...
```

Admin-flow:
1. Admin åpner `Fysiske bonger → Importer`
2. Velger hall + laster opp CSV
3. Systemet validerer:
   - Tall 1-75, 25 per rad
   - Ingen duplicate `ticket_id` innen hall
   - Farger matcher konfigurerte varianter
4. Batch-insert i `app_static_tickets`:
   ```
   hall_id, ticket_id (barcode), ticket_color, card_matrix,
   is_purchased = false, imported_at = now()
   ```
5. Suksess-melding: "N bonger importert til [hall]"

**Atomisk:** Feil i én rad → hele importen rulles tilbake (all-or-nothing).

### Fase 2: Vakt-start + range-registrering

Bingovert logger inn, rolle `HALL_OPERATOR` i spesifikk hall.

1. Åpner "Ny range"
2. Velger farge (f.eks. Small Yellow)
3. Scanner første bong i stabelen (Bluetooth HID)
4. System:
   - Slår opp `app_static_tickets` for bongen
   - Validerer `hall_id = bingoverts hall` (hvis ikke → ❌ "Bong tilhører feil hall")
   - Validerer farge matcher valg
5. Bingovert spesifiserer antall (f.eks. 100 bonger)
6. System oppretter `app_agent_ticket_ranges`-rad:
   ```
   agent_id, hall_id, ticket_color,
   initial_top_serial (scannet bong — f.eks. 100-1001),
   current_top_serial = initial_top_serial,
   final_serial (initial_top - antall + 1 = 01-1001),
   registered_at = now(), closed_at = null
   ```
7. Bongene i rangen markeres som `reserved_by_range_id` i `app_static_tickets`

### Fase 3: Salg i hallen

- Bingovert går fritt, selger bonger i sekvens fra toppen
- **Ingen system-interaksjon** per salg
- Kontant samles inn

### Fase 4: Batch-oppdatering (returnering til stativ)

Bingovert kommer tilbake etter å ha solgt N bonger:

1. Åpner "Registrer salg"
2. System viser: "Forrige top: 100-1001. Scan nåværende øverste bong:"
3. Scanner øverste usolgte bong → f.eks. 95-1001
4. System beregner:
   ```
   previousTop = 100-1001 (current_top_serial)
   newTop = 95-1001 (scannet)
   soldCount = previousTop - newTop = 5
   soldSerials = [96, 97, 98, 99, 100] (alle i -1001-batch)
   ```
5. Batch-oppdatering i DB:
   ```sql
   UPDATE app_static_tickets
   SET is_purchased = true,
       sold_to_scheduled_game_id = <neste planlagte spill for hallen>,
       sold_by_user_id = <bingovert>,
       sold_from_range_id = <range-id>,
       responsible_user_id = <bingovert>,
       sold_at = now()
   WHERE hall_id = <hall> AND ticket_id IN (serials 96-100)
     AND reserved_by_range_id = <range-id>
   ```
6. Range oppdateres: `current_top_serial = 95-1001`
7. Audit-log: `physical_ticket.batch_sold { count: 5, from: 100, to: 96 }`
8. Bingovert får bekreftelse: "5 bonger registrert som solgt til [neste spill]"

**Farge-validering:** Gjøres ved scan av første bong i rangen (fase 2). Alle påfølgende bonger i rangen antas samme farge (verifisert i DB).

### Fase 5: Spill kjøres

Master starter spillet. Auto-draw-tick (fra PR 4c) trekker kuler hver N sekunder.

Ved hver draw kjører `Game1DrawEngineService.evaluateAndPayoutPhase()`, som nå også inkluderer fysiske bonger:

```sql
-- Hent digitale assignments (eksisterende)
SELECT ... FROM app_game1_ticket_assignments WHERE scheduled_game_id = <spill>

-- Hent fysiske bonger (nytt)
SELECT ticket_id, card_matrix, responsible_user_id
FROM app_static_tickets
WHERE sold_to_scheduled_game_id = <spill>
  AND is_purchased = true
```

Pattern-check kjøres på begge typer.

### Fase 6: Vinn-varsel + verifisering + utbetaling

Når fysisk bong treffer pattern for aktiv fase:

1. Backend broadcaster til `/admin-game1` socket:
   ```json
   {
     "event": "physical_ticket_won",
     "gameId": "...",
     "phase": 1,
     "ticketId": "97-1001",
     "hall": "Notodden",
     "responsibleUserId": "<Per>",
     "expectedPayout": 100,
     "color": "small_yellow"
   }
   ```
2. Bingovert-skjerm viser: **"⚠️ Fysisk bong 97-1001 vant 1 Rad — 100 kr. Gå og kontrollér."**
3. Spilleren roper "bingo!" — bingovert går til spilleren
4. Bingovert trykker "Verifiser vinn", scanner bongen
5. System verifiserer:
   - Bongen tilhører `sold_to_scheduled_game_id = aktivt spill` ✓
   - Pattern matcher faktisk trukne kuler ✓
   - `paid_out_at IS NULL` (ikke allerede utbetalt) ✓
6. Viser: "✓ BONG 97-1001 VANT 1 RAD — UTBETAL 100 kr [BEKREFT]"
7. Hvis premie ≥ 5000 kr: krever admin-godkjenning (fire-øyne)
8. Ved bekreftelse:
   - `paid_out_at = now()`, `paid_out_amount_cents`, `paid_out_by_user_id`
   - Audit-log: `physical_ticket.payout`

### Fase 7: Handover (vakt-skift)

Kari går, Per tar over:

1. Kari: "Overfør vakt til Per"
2. Siste batch-oppdatering (scanner current top)
3. System henter alle bonger tilknyttet Karis range:
   - **Usolgte:** `reserved_by_range_id = Karis range, is_purchased = false`
   - **Solgte + ikke utbetalt:** `sold_from_range_id = Karis range, is_purchased = true, paid_out_at IS NULL`
   - **Uutbetalte vinn fra tidligere spill:** samme som over
4. System oppretter Pers nye range:
   ```
   agent_id = Per,
   handover_from_range_id = Karis range,
   initial_top_serial = Karis current_top_serial,
   final_serial = Karis final_serial,
   current_top_serial = initial_top_serial
   ```
5. Oppdaterer eierskap:
   ```sql
   -- Usolgte: ny reservation
   UPDATE app_static_tickets SET reserved_by_range_id = Per's range
     WHERE reserved_by_range_id = Karis range AND is_purchased = false;

   -- Solgte: ny ansvarlig
   UPDATE app_static_tickets SET responsible_user_id = Per
     WHERE sold_from_range_id = Karis range 
       AND is_purchased = true 
       AND paid_out_at IS NULL;
   ```
6. Karis range: `closed_at = now()`, `handed_off_to_range_id = Pers range`
7. Audit-log: `physical_ticket.range_handover { from_user: Kari, to_user: Per, unsold: N, sold_pending: M }`
8. **Ingen varsling** til Kari etter logout (per Tobias-beslutning)

**Fremtidige vinn-varsler:** Går til `responsible_user_id = Per`, ikke Kari.

### Fase 8: Range-påfylling

Scenario: Per har 14 bonger igjen i aktiv range, vil ta 50 flere.

1. Per: "Utvid range"
2. System: "Hvor mange flere bonger?" → Per: 50
3. System identifiserer tilgjengelige serials i samme hall + farge:
   ```
   SELECT ticket_id FROM app_static_tickets
   WHERE hall_id = Pers hall 
     AND ticket_color = rangens farge 
     AND is_purchased = false 
     AND reserved_by_range_id IS NULL
   ORDER BY serial_num DESC LIMIT 50
   ```
4. Utvider range:
   ```
   UPDATE app_agent_ticket_ranges
   SET serials = serials || new_serials,  -- utvid JSONB-array
       final_serial = lavest nye serial
   ```
5. Marker nye bonger som `reserved_by_range_id`

**Enklere alternativ:** Lag NY range ved siden av eksisterende. Men Tobias har bekreftet "utvid eksisterende".

### Fase 9: Vakt-slutt + kasse-avstemming

Per: "Avslutt vakt"

1. Siste batch-oppdatering (scanner current top)
2. System beregner:
   ```
   Totalt solgt denne vakten: N bonger
   × pris_per_bong = X kr
   Utbetalinger: Y kr
   Forventet kontant i kasse: X - Y kr
   ```
3. "Tast inn faktisk kontant i kasse:" → Per teller
4. System beregner differanse:
   - `= 0`: ✓ Balansert
   - `> 0`: Overskudd (spiller avstå vekslepenger?)
   - `< 0`: Underskudd (fire-øyne-sjekk kreves)
5. Hvis differanse > threshold (konfigurerbar, f.eks. 50 kr): kommentar påkrevd + admin-varsel
6. `closed_at = now()` på rangen
7. Audit-log: `physical_ticket.shift_end { ..., balance_diff }`
8. Avstemmings-rapport genereres

---

## Datamodell

### Endring av eksisterende tabell

```sql
-- app_static_tickets (eksisterer i migrasjon 20260417000002)
ALTER TABLE app_static_tickets
  -- Bekreft hall_id er NOT NULL (er det allerede)
  -- Ingen endring der

  -- Nye kolonner:
  ADD COLUMN sold_by_user_id TEXT REFERENCES app_users(id),
  ADD COLUMN sold_from_range_id TEXT REFERENCES app_agent_ticket_ranges(id),
  ADD COLUMN responsible_user_id TEXT REFERENCES app_users(id),
  ADD COLUMN sold_to_scheduled_game_id TEXT REFERENCES app_game1_scheduled_games(id),
  ADD COLUMN reserved_by_range_id TEXT REFERENCES app_agent_ticket_ranges(id),
  ADD COLUMN paid_out_at TIMESTAMPTZ,
  ADD COLUMN paid_out_amount_cents INTEGER,
  ADD COLUMN paid_out_by_user_id TEXT REFERENCES app_users(id);

-- Index for hot queries
CREATE INDEX idx_static_tickets_scheduled_game_purchased 
  ON app_static_tickets (sold_to_scheduled_game_id) 
  WHERE is_purchased = true AND paid_out_at IS NULL;

CREATE INDEX idx_static_tickets_responsible 
  ON app_static_tickets (responsible_user_id) 
  WHERE paid_out_at IS NULL;
```

### Endring i agent_ticket_ranges

```sql
ALTER TABLE app_agent_ticket_ranges
  ADD COLUMN current_top_serial TEXT NOT NULL,  -- dekrementerer ved batch
  ADD COLUMN handover_from_range_id TEXT REFERENCES app_agent_ticket_ranges(id);
```

---

## Sub-PR-struktur

| PR | Scope | Dager |
|---|---|---|
| PT1 | CSV-import per hall + schema-endringer | 2 |
| PT2 | Range-registrering + scan-for-initial-top + hall-validering | 2 |
| PT3 | Batch-salg (2-scan: previous/current top) + sold_count-beregning | 1.5 |
| PT4 | Auto-varsel via /admin-game1 socket + scan-verifisering + utbetaling-flyt (incl. responsible_user_id) | 2 |
| PT5 | Handover (usolgte + solgte + uutbetalte) + range-påfylling | 2 |
| PT6 | Admin-dashboard + kasse-avstemming + audit-rapport | 1.5 |

**Total: 11 dager** i Bølge 2, parallelt med Spor 1/3.

---

## Kritiske sikringer (alle inkludert i PT-scope)

1. ✅ Farge-validering ved range-reg (scan av første bong)
2. ✅ Hall-validering ved scan (hall_id matcher bingoverts hall)
3. ✅ Dobbelsalg-beskyttelse (UNIQUE constraint)
4. ✅ Slavisk sekvens (ingen skip-rekka)
5. ✅ Audit-log per operasjon (scan, batch, handover, payout, shift-end)
6. ✅ Dobbel-bekreftelse for premier ≥ 5000 kr
7. ✅ Obligatorisk kasse-avstemming ved vakt-slutt
8. ✅ Offline-queue for nettverks-fail
9. ✅ Rate-limiting på scan (max 1/sek per bingovert)

---

## Flyt-diagram (ASCII)

```
┌──────────────────────────────────────────────────────────────────┐
│ LEVERANDØR                                                        │
│  Printer bonger med serial + 25 tall + hall-navn                 │
│  Gir CSV per hall                                                 │
└─────┬────────────────────────────────────────────────────────────┘
      │
      ▼
┌──────────────────────────────────────────────────────────────────┐
│ ADMIN (én gang per import)                                        │
│  Laster opp CSV → app_static_tickets (hall_id satt)              │
└─────┬────────────────────────────────────────────────────────────┘
      │
      ▼
┌──────────────────────────────────────────────────────────────────┐
│ BINGOVERT (vakt-start)                                            │
│  Logger inn → velger farge → scanner første bong                 │
│  System validerer hall + farge → oppretter range                 │
│  (Bonger reservert men ikke solgt)                               │
└─────┬────────────────────────────────────────────────────────────┘
      │
      ▼
┌──────────────────────────────────────────────────────────────────┐
│ BINGOVERT (salg i hallen)                                         │
│  Går rundt, selger bonger nedover i sekvens                      │
│  Ingen system-interaksjon — fritt salg                           │
└─────┬────────────────────────────────────────────────────────────┘
      │
      ▼
┌──────────────────────────────────────────────────────────────────┐
│ BINGOVERT (retur — batch-oppdatering)                             │
│  Scanner øverste usolgte bong                                    │
│  System: sold_count = previous_top - current_top                 │
│  UPDATE is_purchased=true for serial-intervall                   │
│  Solgte bonger → aktivt spill                                    │
└─────┬────────────────────────────────────────────────────────────┘
      │
      ▼
┌──────────────────────────────────────────────────────────────────┐
│ SPILLET KJØRES                                                    │
│  Auto-draw trekker kuler                                         │
│  Pattern-check inkluderer solgte fysiske bonger                  │
└─────┬────────────────────────────────────────────────────────────┘
      │
      ▼
┌──────────────────────────────────────────────────────────────────┐
│ AUTO-VARSEL VED VINN                                              │
│  Broadcast til /admin-game1 socket                               │
│  Skjerm: "Fysisk bong [serial] vant [fase] — kr X"              │
│  Mottaker: responsible_user_id (Per ved handover, Kari ellers)  │
└─────┬────────────────────────────────────────────────────────────┘
      │
      ▼
┌──────────────────────────────────────────────────────────────────┐
│ SPILLER ROPER "BINGO!" → BINGOVERT SCANNER + UTBETALER           │
│  Scan: verifiser ticket_id + pattern-match                       │
│  Hvis OK: bekreft utbetaling kontant                             │
│  paid_out_at + audit-log                                         │
└─────┬────────────────────────────────────────────────────────────┘
      │
      ▼
┌──────────────────────────────────────────────────────────────────┐
│ VAKT-SKIFT (ved behov)                                            │
│  Kari "Overfør til Per"                                          │
│  Usolgte bonger → Pers nye range                                │
│  Solgte + uutbetalt → responsible_user_id = Per                 │
└─────┬────────────────────────────────────────────────────────────┘
      │
      ▼
┌──────────────────────────────────────────────────────────────────┐
│ VAKT-SLUTT + AVSTEMMING                                           │
│  Siste batch → kasse-rapport → audit                             │
└──────────────────────────────────────────────────────────────────┘
```

---

## Referanser

- Legacy-port: `legacy/unity-backend/App/Controllers/physicalTicketsController.js` (via git show 9c0f3b33^)
- Schema-migrasjoner: `apps/backend/migrations/20260417000002_static_tickets.sql` + `20260417000003_agent_ticket_ranges.sql`
- Admin-UI-placeholder: `apps/admin-web/src/pages/physical-tickets/` (må utvides i PT-serien)

## Endringshistorikk

- 2026-04-22: Endelig spec låst etter chat-avklaring med Tobias (PM, Claude Opus 4.7)
