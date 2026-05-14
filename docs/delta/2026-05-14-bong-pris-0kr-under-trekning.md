# Delta-rapport — Bong-pris=0 kr under aktiv trekning (BUG fix)

**Branch:** `fix/bong-pris-0kr-under-trekning-2026-05-14`
**Dato:** 2026-05-14
**Type:** P0 bug-fix (pilot-UX, ikke regulatorisk)
**Reporter:** Tobias 2026-05-14 12:55

## Hva ble endret

### Backend (2 filer)
1. `apps/backend/src/game/Game1ScheduledRoomSnapshot.ts`
   - `entryFeeFromTicketConfig`: utvidet til å lese alle 4 historiske felt-navn (`priceCents`, `priceCentsEach`, `pricePerTicket`, `price`) istedenfor kun `priceCentsEach`
   - **Root cause:** `GamePlanEngineBridge.buildTicketConfigFromCatalog` skriver `pricePerTicket`, men reader så bare etter `priceCentsEach` → returnerte 0 → currentGame.entryFee=0 → klient ticket-priser ble 0
2. `apps/backend/src/util/roomHelpers.ts`
   - `currentEntryFee` (linje 420): bytte `??` → `> 0`-sjekk for å matche linje 386-388 (`variantEntryFee`)
   - **Defense-in-depth:** selv om backend `entryFeeFromTicketConfig` returnerer 0, faller nå `enrichTicketList` til `getRoomConfiguredEntryFee` istedenfor å sette alle ticket.price=0

### Klient (4 filer)
3. `packages/game-client/src/bridge/GameBridge.ts`
   - `applyGameSnapshot` (linje 854): overskriv `state.entryFee` KUN hvis `game.entryFee > 0` — beholder ellers eksisterende verdi fra `gameVariant.entryFee` (lest av applySnapshot/handleRoomUpdate)
4. `packages/game-client/src/games/game1/screens/PlayScreen.ts`
   - `gridEntryFee` (linje 619-624): bruk `validStateEntryFee = entryFee > 0 ? entryFee : null` så `??`-fallback fungerer riktig
5. `packages/game-client/src/games/game1/components/TicketGridHtml.ts`
   - `computePrice` (linje 402-407): bytte `typeof ticket.price === "number"` → `ticket.price > 0` — 0 er et tall, må ignoreres
6. `packages/game-client/src/games/game1/components/BingoTicketHtml.ts`
   - `priceEl.textContent` (linje 751): skjul price hvis `opts.price === 0` — aldri vis "0 kr"
   - `populateBack` (linje 591): samme defensive sjekk for back-face

### Tester (2 nye)
7. `apps/backend/src/game/Game1ScheduledRoomSnapshot.test.ts` (3 nye tester)
   - Prod-format `pricePerTicket=500` → entryFee=5 ✅
   - Legacy `priceCentsEach=500` → entryFee=5 ✅
   - Empty (ingen pris-felt) → entryFee=0 (defensive) ✅
8. `packages/game-client/src/games/game1/components/TicketGridHtml.priceZeroBug.test.ts` (6 nye tester)
   - Pre-trekning WAITING: priser korrekt fra lobby-types ✅
   - RUNNING med state.entryFee=0 + lobby-config: fallback OK ✅
   - RUNNING med ticket.price=0 fra server: ignoreres, bruker computed ✅
   - RUNNING med korrekt server-pris: autoritativ ✅
   - RUNNING med tom state.ticketTypes: faller til entryFee uten multiplier ✅
   - RUNNING med lobby ticketTypes: prioriteres over state ✅

### Dokumentasjon (3 filer)
9. `docs/engineering/PITFALLS_LOG.md` — ny §7.21 "Bong-pris går til 0 kr ved game-start (BUG)"
10. `docs/engineering/AGENT_EXECUTION_LOG.md` — ny entry 2026-05-14 for PR
11. `.claude/skills/spill1-master-flow/SKILL.md` — ny seksjon "Bong-pris bevares gjennom game-state-transisjoner (PR #<TBD>, 2026-05-14)"

## Hva andre steder kunne ha blitt brutt

### Sjekket (ingen regresjon)
- ✅ Alle 73 eksisterende tester i `TicketGridHtml*.test.ts` + `BingoTicketHtml*.test.ts` PASS
- ✅ Alle 59 tester i `GameBridge.test.ts` PASS
- ✅ Alle 50 tester i `PlayScreen.*.test.ts` PASS
- ✅ Alle 23 tester i `roomHelpers.*.test.ts` PASS
- ✅ Alle 6 tester i `Game1ScheduledRoomSnapshot.test.ts` PASS (3 originale + 3 nye)
- ✅ Backend `tsc --noEmit` clean
- ✅ Game-client `tsc --noEmit` clean
- ✅ Comprehensive run: 493/493 vitest tester PASS i game1/components, bridge, screens

### Potensielle followup (ikke blokker for denne PR)
- Bridge skriver `pricePerTicket` mens en del kode forventer `priceCentsEach` — fragmentert wire-kontrakt. Kunne unifiseres senere ved å standardisere på ett feltnavn (kvalitet-improvement, ikke pilot-blokker).
- `Game1TicketPurchaseService.extractTicketCatalog` brukte allerede 4-felt-readeren — dette burde være shared helper. Refactor til delt funksjon kan vurderes senere.

## Nye fragilities

Ingen nye fragilities introdusert. Dette er en defensiv fix som REDUSERER fragilities:
- `??`-pattern på numeric fields er nå dokumentert som fallgruve i PITFALLS_LOG §7.21
- 6-lag defense-in-depth garanterer at hvis EN lag har 0-mismatch, fanger neste lag det
- Tester med prod-shape evidens (DB-data) som regressions-guard

## Brief for neste agent

**Hvis du jobber med ticket-pris-pipeline (Spill 1):**

1. Les §7.21 i PITFALLS_LOG FØR du rør noe
2. Les ny seksjon "Bong-pris bevares gjennom game-state-transisjoner" i `.claude/skills/spill1-master-flow/SKILL.md`
3. Husk: 6-lag defense-in-depth — du MÅ beholde alle 6 sjekkene
4. ALDRI tillat priceEl å vise "0 kr" på en kjøpt bonge
5. Bruk `> 0`-sjekk istedenfor `??` på numeric pris-felt

**Hvis du modifiserer ticket_config_json-format i bridge:**

1. Oppdater BÅDE `entryFeeFromTicketConfig` OG `extractTicketCatalog` samtidig
2. Skriv test med prod-shape evidens (DB-data) for å fange regression
3. Verifiser alle 4 felt-navn fortsatt støttes for backward-compat

**Hvis du jobber på Spill 2/3 (rocket/monsterbingo):**

- Disse spillene har egen pris-pipeline. Bug-en var spesifikk for Spill 1's `Game1ScheduledRoomSnapshot`-synthetic-snapshot-path.
- IKKE anta at Spill 2/3 har samme problem uten å verifisere.

## DB-evidens (Tobias-rapport 2026-05-14)

```sql
SELECT ticket_color, ticket_size, buyer_user_id, COUNT(*)
FROM app_game1_ticket_assignments WHERE scheduled_game_id LIKE '1edd90a1%' GROUP BY 1,2,3;
-- purple small demo-user-admin 1
-- white small demo-user-admin 1
-- yellow small demo-user-admin 1

SELECT total_amount_cents/100 FROM app_game1_ticket_purchases WHERE scheduled_game_id LIKE '1edd90a1%';
-- 30 (korrekt total = 5+10+15)

SELECT ticket_config_json->'ticketTypesData' FROM app_game1_scheduled_games WHERE id LIKE '1edd90a1%';
-- [{"size": "small", "color": "white", "pricePerTicket": 500}, ...]
--                                       ^^^^^^^^^^^^^^^^^^^^^^^
--                                       Bridge skriver pricePerTicket
```

Reader (pre-fix) så etter `priceCentsEach` → INGEN match → returnerte 0.
