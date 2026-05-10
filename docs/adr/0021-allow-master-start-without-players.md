# ADR-0021 — Master kan starte spillet uten solgte bonger

**Status:** Accepted
**Dato:** 2026-05-10
**Deciders:** Tobias Haugen
**Konsulterer:** —

## Kontekst

I [LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md](../architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md)
og oppfølgings-direktivet 2026-05-08 ble det nedfelt at master-hallen kan ALDRI ekskluderes
fra et Spill 1-runde:

> "Master-hallen kan ALDRI ekskluderes — hvis master er rød er det feil-situasjon
> (master må fikse sitt eget salg før start)."

Dette ble implementert som en hard-feil i `Game1MasterControlService.startGame`:

```ts
// apps/backend/src/game/Game1MasterControlService.ts:506-511
if (redHallIds.includes(masterHallId)) {
  throw new DomainError(
    "MASTER_HALL_RED",
    "Master-hallen har ingen spillere. Fiks salg i master-hallen før du starter."
  );
}
```

Tester og audit-flyt forutsatte at dette throw-et alltid ville fyre når master har 0 spillere.

**Tobias-direktiv 2026-05-10** etter master-flow-test:

> "vi må gjøre sånn at det er mulig å starte spillet selv om det ikke er noen bonger som er solgt"

Bingoverten skal ha full kontroll over når et spill starter — på linje med ADR-0017
(daglig jackpot-akkumulering fjernet, master setter manuelt). Hvis bingoverten ønsker å
starte runden tom (f.eks. for å demonstrere flyten, kalibrere TV-skjerm, eller fordi alle
spillere kjøper i siste øyeblikk), skal systemet IKKE blokkere.

## Beslutning

**`MASTER_HALL_RED`-blokkeringen fjernes fra `startGame`.** Master kan starte uavhengig av
hvor mange spillere som er solgt, inkludert 0 spillere i master-hallen.

### Hva fjernes

1. **Hard-feil-throw** i `Game1MasterControlService.startGame` (linje 506-511 i pre-PR-state):
   `if (redHallIds.includes(masterHallId)) throw new DomainError("MASTER_HALL_RED", ...)`
2. **JSDoc-referanse** på linje 121 om "hvis master er rød kastes `MASTER_HALL_RED`"
3. **Tester** som verifiserer at `MASTER_HALL_RED` kastes (`startGuards.test.ts` rød-master-test +
   doc-blokk i `startGame.unreadyHalls.test.ts`)

### Hva beholdes

1. **`HALLS_NOT_READY`-throw når master ikke har huket "Klar"** (linje 481-497):
   master må fortsatt eksplisitt bekrefte at master-hallen er klar via Game1HallReadyService.
   Dette er en separat sjekk fra "0 spillere" — bingoverten kan være klar med 0 spillere.
2. **Auto-eksklusjons-loop for ANDRE røde haller** (linje 553-558): andre haller med 0 spillere
   ekskluderes fortsatt fra runden med `excluded_reason='auto_excluded_red_no_players'`. Master-
   hallen skipper denne loopen pga. `if (hallId === masterHallId) continue` — master deltar
   alltid, selv med 0 spillere.
3. **Audit-trail** (`start_game_with_unready_override`-event): hvis ANDRE haller auto-ekskluderes
   logges det fortsatt med samme metadata-shape. Master-hall-rød er ikke lenger en distinkt
   audit-kategori — det er rett og slett en helt-tom-runde.
4. **`HallsNotReady` for master-side ready-flag** beholdes fordi det dekker en annen
   tilstand (master har ikke trykket "Klar"-knappen), ikke kapasitet-tilstand.

### Master-flyt etter denne endringen

| Master-tilstand | Andre haller | Resultat |
|---|---|---|
| 🟢 Klar + spillere | Blandet | OK — andre auto-ekskluderes etter behov |
| 🟢 Klar + 0 spillere (rød) | Klar + spillere | **OK — runde starter med master-hall i tomt rom** |
| 🟢 Klar + 0 spillere (rød) | Også 0 spillere | **OK — helt tom runde, bingoverten har valgt det** |
| ❌ Ikke huket "Klar" | * | `HALLS_NOT_READY` (uendret) |

## Konsekvenser

### Positive
- **Bingovert har full kontroll:** ingen "skjult" sikkerhets-blokk hindrer master fra å gjøre
  det den vil — på linje med ADR-0017-prinsippet
- **Demo og kalibrering blir mulig:** TV-skjerm-test, runtime-debugging, og pilot-flow-walkthroughs
  kan kjøre med 0 spillere
- **Kant-tilfeller forsvinner:** "alle spillere kjøper i siste øyeblikk men master har trykket
  Start" gir ikke lenger en error som krever DB-edit
- **Kode-forenkling:** én throw-blokk + 3 tester + 1 doc-blokk fjernet
- **Audit-flyt forenkles:** ingen distinkt `MASTER_HALL_RED`-error-kategori — bare normal start

### Negative
- **Mulig brukerfeil:** master kan starte tomt rom ved uhell (men det er bingovertens ansvar
  per bevisst design — samme prinsipp som "kan ikke hoppe over neste spill" osv.)
- **Pre-flight-check må flyttes til UI** hvis ønskelig: knappen "Start" bør disables eller
  vise advarsel hvis master har 0 spillere (advisory, ikke blokkerende). Out-of-scope for denne PR.

### Nøytrale
- Eksisterende `MASTER_HALL_RED`-error-kode er kun thrown fra én call-site; ingen frontend-handler.
  Kode-fjerning er trygg uten frontend-koordinering.
- Audit-events for andre haller (ikke-master) er uendret — auto-eksklusjon for røde ikke-master-
  haller fortsetter å logges som `auto_excluded_red_no_players`.

## Alternativer vurdert

### Alternativ A: Behold blokkeringen men gjør den til soft-warning
Avvist: Tobias-direktiv eksplisitt sa "vi må gjøre sånn at det er mulig å starte spillet selv
om det ikke er noen bonger som er solgt". Soft-warning ville fortsatt krevd UI-bekreftelse,
ikke matchet direktivet.

### Alternativ B: Behold blokkeringen, men la master eksplisitt confirme via `forceStart=true`
Avvist: legger på unødvendig API-parameter for et hypotetisk sikkerhetsnett. Master har
allerede full kontroll — `forceStart` ville bare skapt forvirring "skal jeg sette den eller ikke".
Stemmer med direktivet om kvalitet > antall flagg.

### Alternativ C: Auto-ekskluder master-hallen hvis rød (samme som andre haller)
Avvist: master MÅ alltid være deltaker fordi den eier draws + master-actions. Å ekskludere master
ville bryte arkitekturen i `Game1MasterControlService` + `Game1DrawEngineService`. Master deltar
alltid, men kan ha 0 spillere — runden kjører bare uten lokale tickets å markere.

## Implementasjon

### Backend (denne PR)
- **`Game1MasterControlService.ts:506-511`** — slett if-throw-blokken for `MASTER_HALL_RED`
- **`Game1MasterControlService.ts:121`** — oppdater JSDoc på `confirmExcludeRedHalls` til å
  reflektere ny atferd
- **`Game1MasterControlService.startGuards.test.ts:351-393`** — slett "master-hall rød →
  MASTER_HALL_RED"-testen, erstatt med ny test som verifiserer at master kan starte med
  0 spillere
- **`Game1MasterControlService.startGame.unreadyHalls.test.ts:14`** — fjern doc-punkt 4
  ("KASTER fortsatt `MASTER_HALL_RED`...")

### Frontend (out-of-scope, post-PR)
- Advisory UI hvis master har 0 spillere ved klikk på "Start" — ikke blokkerende. Kan leveres i
  oppfølgings-PR hvis Tobias ønsker det.

## Referanser

- Tobias-direktiv 2026-05-10 (master-flow-test sesjon)
- [LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md](../architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md) — overstyres delvis av denne ADR-en
- [ADR-0017](./0017-remove-daily-jackpot-accumulation.md) — samme prinsipp: bingovert har full kontroll
- [SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md](../architecture/SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md) §5.2 — master-handlinger
- `apps/backend/src/game/Game1MasterControlService.ts` — implementasjon
