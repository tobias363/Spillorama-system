# Spill 1 — Bong-sortering "closeness-to-complete" troubleshooting

**Sist oppdatert:** 2026-04-27
**Relatert PR:** [#539 — feat(spill1): sort tickets by closeness-to-complete](https://github.com/tobias363/Spillorama-system/pull/539)

## Hva sorteringen gjør

I Spill 1 sorterer klienten bongene visuelt slik at den som er nærmest å vinne nåværende fase vises først. Bakgrunns-rekkefølge fra serveren er uendret — dette er **ren UI-affordance**.

- Sortering skjer kun for **live-bonger** (de som faktisk er med i nåværende trekning).
- **Pre-round-bonger** (kjøpt for neste runde) beholder original-rekkefølge bak live-bongene.
- Sortering skjer kun når active-pattern kan klassifiseres som "1 Rad", "2 Rader", "3 Rader", "4 Rader" eller "Fullt Hus" (norsk eller engelsk navn). Custom-mønstre som "Stjerne" hopper sortering over.

## Når sortering "ikke virker" — typisk diagnose

### 1. Browser cache (mest vanlig)

Hvis koden var deployet i en tidligere versjon uten sort, men live-build ikke viser sortering — sjekk om brukeren har gammel JS-bundle cachet.

**Fix for sluttbruker:**
- **Mac:** `Cmd + Shift + R` (Chrome/Edge/Firefox) eller `Cmd + Option + E` for å tømme cache
- **Windows:** `Ctrl + Shift + R` eller `Ctrl + F5`
- **Mobil:** Lukk app/fane helt, åpne på nytt. På iOS Safari: Settings → Safari → Clear History and Website Data.

**Sjekk versjon:**
- Åpne devtools → Network → Reload → finn bundle-fil (`spillorama-*.js`) og sammenlign hash mot ny build.
- Eller kjør `git log --oneline packages/game-client/src/games/game1/components/TicketGridHtml.ts` og verifiser at PR #539 (`157be09a`) er merget før deploy-tidspunkt.

### 2. Sorteringen hopper over fordi mønsteret ikke gjenkjennes

Sorteringen bruker `classifyPhaseFromPatternName` som godtar:
- Norsk: `1 Rad`, `2 Rader`, `3 Rader`, `4 Rader`, `Fullt Hus`
- Engelsk: `Row 1`, `Row 2`, `Row 3`, `Row 4`, `Full House`, `Coverall`

Custom-navn (f.eks. `Stjerne`, jubilee-mønstre i Spill 3) returnerer `null` → sort skipped → server-rekkefølge brukes.

**Sjekk:** Hvilket pattern-navn pushet serveren? Se `state.patterns[i].name` i devtools (eller `console.log` på `activePatternFromState(state.patterns, state.patternResults)`).

### 3. "Sorteringen flytter ikke før mange marks" — by design

Alle 5×5 bonger i Spill 1 har fri sentercelle (bit 12). Det betyr at **kolonne 2 alltid har baseline = 4 to-go** for hvilken som helst bong, uten noen marks i det hele tatt. Med få trukne tall vil mange bonger derfor ha lik score, og sorteringen er stabil → original-rekkefølge bevares.

Sorteringen flytter bonger først når:
- En annen rad/kolonne har **færre enn 4 to-go** (dvs. minst 1 mark utenfor sentercellen) for fase 1.
- For fase 2-4 må flere rader være progresjonert.
- For Fullt Hus er det `25 - antall markerte celler`.

Dette er forventet oppførsel.

### 4. `liveTicketCount === 0` blokkerer sortering

`TicketGridHtml.applyProgressSort` har short-circuit:

```ts
if (liveCount <= 0 || tickets.length === 0) return tickets;
```

I `PlayScreen` blir `liveTicketCount` satt til `state.myTickets.length` kun når `gameStatus === "RUNNING"`. Mellom runder (WAITING / ENDED / NONE) settes liveCount til 0 og pre-round-bonger vises i original-rekkefølge.

**Dette er korrekt** — sortering skal ikke skje for bonger som ikke er i en aktiv runde.

### 5. Stale bundle på Render (deploy lag)

Render kan ha lag på opp til 1-2 minutter etter merge. Sjekk:
1. https://dashboard.render.com/ → spillorama-system → Deploys
2. Bekreft at siste deploy inneholder commit-SHA fra PR #539 eller nyere

## Verifisering (utvikler)

Kjør test-suiten lokalt:

```bash
cd packages/game-client
npx vitest run src/games/game1/components/TicketGridHtml.test.ts
npx vitest run src/games/game1/logic/TicketSortByProgress.test.ts
```

Begge skal være grønne (45 tests totalt). Test-cases dekker:
- Original-rekkefølge bevares når ingen er nærmere
- Bongen med flest marks i én rad/kol flyttes til front
- Pre-round-bonger sorteres ikke
- Re-sort ved nytt drawn number
- Ukjente pattern-navn → server-rekkefølge bevart
- Live-flyt med progressive nye drawn numbers

## Rotårsak hvis koden er feil

Hvis tester feiler men koden ser rett ut, sjekk:
1. `packages/shared-types/src/spill1-patterns.ts` — har `classifyPhaseFromPatternName` blitt endret?
2. `packages/game-client/src/games/game1/logic/TicketSortByProgress.ts` — har `closenessScore` eller `sortTicketsByProgress` regrediert?
3. `packages/game-client/src/games/game1/components/TicketGridHtml.ts:194-208` — `applyProgressSort`-flyt.
4. `packages/game-client/src/games/game1/screens/PlayScreen.ts:414-423` — `setTickets`-call-site og `liveTicketCount`-binding.

## Referanser

- PR #539: feat(spill1): sort tickets by closeness-to-complete (Tobias 2026-04-26)
- Files:
  - `packages/game-client/src/games/game1/logic/TicketSortByProgress.ts` — sort-algoritme
  - `packages/game-client/src/games/game1/components/TicketGridHtml.ts:159` — call-site
  - `packages/game-client/src/games/game1/screens/PlayScreen.ts:414` — eier av grid-instans
  - `packages/shared-types/src/spill1-patterns.ts` — fase-klassifisering + masker
