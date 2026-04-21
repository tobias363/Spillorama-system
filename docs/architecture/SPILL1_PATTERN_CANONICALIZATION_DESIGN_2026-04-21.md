# Spill 1 — Pattern-regel-kanonisering

**Agent:** Agent 6
**Status:** Design — ingen kode før PM-GO
**Branch:** `claude/unruffled-cerf-e9d2b5`
**Dato:** 2026-04-21
**Scope:** Spill 1-only (YAGNI — ingen generisk abstraksjon mot Spill 2/3)

---

## 1. Nåværende tilstand

Pattern-reglene for Spill 1 (Norsk 75-ball, 5×5) finnes i **to kilder** med
separat regex-logikk:

### 1a. Backend — `apps/backend/src/game/BingoEngine.ts:1153-1173`

`meetsPhaseRequirement(pattern, ticket, drawnSet)` bruker count-helpers +
regex på norsk pattern-navn:

```ts
if (/^\s*1\s*rad\b/.test(nameLc)) return rowCount >= 1 || colCount >= 1;
if (/^\s*2\s*rad/.test(nameLc))   return colCount >= 2;
if (/^\s*3\s*rad/.test(nameLc))   return colCount >= 3;
if (/^\s*4\s*rad/.test(nameLc))   return colCount >= 4;
// fallback: ≥1 linje
```

Støtte-funksjoner i `apps/backend/src/game/ticket.ts:352-389`:
`countCompleteRows`, `countCompleteColumns`, `hasFullBingo`.

### 1b. Klient — `packages/game-client/src/games/game1/logic/PatternMasks.ts`

Post-PR #315: mask-basert med `COLUMN_MASKS` + `columnCombinations(k)`
→ `PHASE_1_MASKS` … `PHASE_4_MASKS`. Egen regex i
`getBuiltInPatternMasks(name)` som matcher både norske ("2 Rader") og
engelske ("Row 2") navn.

Bruk: `remainingForPattern` → "X igjen"-teller i bong-footeren.
Backend er autoritativ for payout — klient-maskene vurderer ikke vinnere.

### 1c. Duplikasjon-punkter

| Sannhet | Backend | Klient |
|---|---|---|
| Hvilket pattern-navn → hvilken fase | regex (norsk) | regex (norsk + engelsk) |
| Hvordan fase 2-4 valideres | `colCount >= N` | `popcount(mask & ~ticket)` |
| Hvor masker finnes | ingensteds — re-derivert via count | `columnCombinations(k)` |
| Full-house-sjekk | `hasFullBingo` | `FULL_HOUSE_MASK` |

To uavhengige regex-er er bug-magnet (PR #315 fikset symptom, ikke rot —
neste rename eller nytt pattern-navn kan drive dem fra hverandre igjen).

---

## 2. Foreslått shared-types interface

Ny fil `packages/shared-types/src/spill1-patterns.ts`:

```ts
/** 5-faser norsk 75-ball. Autoritativ klassifisering. */
export enum Spill1Phase {
  Phase1 = "phase1",          // 1 rad ELLER 1 kolonne
  Phase2 = "phase2",          // 2 vertikale kolonner
  Phase3 = "phase3",          // 3 vertikale kolonner
  Phase4 = "phase4",          // 4 vertikale kolonner
  FullHouse = "fullHouse",    // alle 25 celler
}

export const FULL_HOUSE_MASK = 0x1ffffff;
export const FREE_CENTER_BIT = 12;
export const ROW_MASKS: readonly number[];       // 5 horisontale
export const COLUMN_MASKS: readonly number[];    // 5 vertikale

export const PHASE_MASKS: Readonly<Record<Spill1Phase, readonly number[]>>;

/**
 * Norsk display-navn → Spill1Phase. Engelske legacy-navn ("Row 2", "Full
 * House", "Coverall") godtas. Returnerer null for ukjente navn (f.eks.
 * jubilee-"Stjerne") — kaller faller tilbake til claimType-sjekk.
 */
export function classifyPhaseFromPatternName(name: string): Spill1Phase | null;

/** Popcount for 25-bit maske. */
export function popCount25(v: number): number;

/** Hvor mange bits mangler for å oppnå ANY av kandidat-maskene. */
export function remainingBitsForPhase(
  phase: Spill1Phase,
  ticketMask: number,
): number;
```

Design-valg:
- **Norske navn som display-sannhet** — Spill1Phase-enum er
  klassifisering, ikke rendering. `DEFAULT_NORSK_BINGO_CONFIG` beholder
  "1 Rad" / "Fullt Hus" urørt.
- **Null-fallback** — custom pattern-navn (jubilee "Stjerne", Spill 3
  "Bilde" / "Ramme") returnerer null → ingen falsk klassifisering.
- **Enum-basert, ikke string** — type-safety ved pattern-matching i
  både backend og klient.

---

## 3. Migrasjonstrinn

**Trinn A** — `shared-types` definisjon (ingen eksisterende endring)
- Ny fil `packages/shared-types/src/spill1-patterns.ts`
- Re-eksport fra `packages/shared-types/src/index.ts`
- Vitest for `classifyPhaseFromPatternName` (alle navn + edge-cases)
- Vitest for `PHASE_MASKS` (lengde + popcount per maske)
- ~150 LOC, ingen breaking changes. Én commit.

**Trinn B** — backend refaktor
- `BingoEngine.meetsPhaseRequirement` bruker `classifyPhaseFromPatternName`
  + `PHASE_MASKS[phase]` + mask-popcount
- Bygg ticket-mask via delt `buildTicketMaskFromGrid` (eller liknende
  backend-helper hvis shared er awkward for backend sin `Ticket`-type)
- `countCompleteRows`/`countCompleteColumns` forblir for eksisterende
  kallere i `ticket.ts` (fase 1 "rad ELLER kolonne" blir nå én mask-union)
- Eksisterende tester skal forbli grønne:
  `BingoEngine.fivePhase.test.ts`, `BingoEngine.splitRoundingLoyalty.test.ts`,
  `ticket.countCompleteLines.test.ts`
- ~50 LOC edit. Én commit.

**Trinn C** — klient re-eksport
- `PatternMasks.ts` re-eksporterer `PHASE_MASKS`, `COLUMN_MASKS`,
  `ROW_MASKS`, `classifyPhaseFromPatternName`, `popCount25` fra
  shared-types
- Beholder `buildTicketMaskFromGrid` + `remainingForPattern` +
  `activePatternFromState` som klient-wrapper
- `getBuiltInPatternMasks` rutes gjennom `classifyPhaseFromPatternName`
- `PatternMasks.test.ts` forblir grønn (22 tester)
- `BingoTicketHtml.test.ts` forblir grønn (16 tester)
- ~80 LOC simplifisering. Én commit.

**Trinn D** — wire-kompatibilitet-test
- Ny delt test-fil eller test-case: gitt samme ticket + marks, produserer
  backend `meetsPhaseRequirement` og klient `remainingForPattern === 0`
  samme svar for alle 5 faser
- Hindrer fremtidig drift mellom kilder som kunne dekket regex-endring
- ~40 LOC. Én commit.

---

## 4. Risiko per trinn

| Trinn | Risiko | Mitigering |
|---|---|---|
| A | Shared-types rebuild; alle forbrukere må re-kompilere | Isolert ny fil, ingen endring av eksisterende eksport. Typecheck hele monorepo i CI. |
| B | Edge-case-drift i fase 1: backend `rowCount>=1 \|\| colCount>=1` vs. mask-union må gi identisk boolean for alle ticket/mark-kombinasjoner | Parametrisert test: 5 rader × 5 kolonner × marked/ikke-marked kombo. BIN-694 split-rounding-test er nær regresjon-suite. |
| B | Performance: mask-popcount vs. count-helpers for hver claim. Claims er lav-frekvente (typisk <1/sekund per rom) → neglisjerbart. | Ingen. |
| C | Klient regex-match endrer seg subtilt når vi flytter `getBuiltInPatternMasks` til shared (engelsk fallback "Row 2"). | Beholde engelsk fallback i shared `classifyPhaseFromPatternName` for å preservere dagens oppførsel. |
| C | Klient `PatternMasks.test.ts` tester mask-lengder + `remainingForPattern`-semantikk — må forbli grønn etter re-eksport. | Kjør test lokalt før commit. |
| D | Test-dobbelt (backend + klient gjør samme thing via delt lib) kan skape vedlikeholdsbyrde | Aksepter trade-off: wire-kompat-test kjører på hver PR, fanger opp drift før den når prod. |

**Tverr-agent koordinering:** Agent 5 sin BingoEngine-dekomposisjon kan
kollidere i trinn B. PM-beslutning: hvem går først? Forslag — Agent 6
går først (mindre endring, isolerer `meetsPhaseRequirement` til et
mask-kall før Agent 5 flytter BingoEngine-deler).

---

## 5. Estimat

| Trinn | LOC (netto) | Tid |
|---|---|---|
| A — shared-types | +150 | 0.5 dag |
| B — backend refaktor | ~-30 / +50 | 0.5 dag |
| C — klient re-eksport | -80 / +20 | 0.25 dag |
| D — wire-kompat-test | +40 | 0.25 dag |
| **Totalt** | **~+150 netto** | **1.5 dager** |

Konservativt 2 dager med PR-review-rundtrips og tverr-agent-koordinering.

---

## 6. Åpne spørsmål til PM

1. **Rekkefølge vs. Agent 5**: går jeg først med B, eller venter jeg til
   Agent 5 sin BingoEngine-dekomposisjon er merget?
2. **Trinn D (wire-kompat-test)**: nice-to-have eller must-have? Legger
   til ~0.25 dag, men er eneste aktive forsvar mot fremtidig regex/navn-
   drift.
3. **Custom pattern-navn**: skal jubilee-spill ("Stjerne") og Spill 3
   ("Bilde" / "Ramme") forbli i `claimType`-fallback-sporet, eller
   designes en generell "custom mask"-utvidelse nå?
   (Anbefaling: hold dem i fallback-sporet — YAGNI, de har andre kilder
   av sannhet i pattern-config.)
4. **4 PR-er vs. 1 bundlet PR**: PM-preferanse?
5. **Navngiving**: `Spill1Phase` (norsk scope-prefix) vs. `BingoPhase`
   (generisk)? Første signalerer YAGNI tydeligere; andre er vanskeligere
   å gjenbruke feil.
