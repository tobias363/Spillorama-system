# Spill 1 — vinningsregler (definitiv referanse)

**Dato:** 2026-04-27  
**Status:** Definitiv kilde for testing og produksjons-validering. Erstatter alle tidligere uformelle beskrivelser.

Dette dokumentet beskriver eksakt hvordan vinninger detekteres og fordeles i Spill 1 (Norsk Bingo, 75-ball, 5-fase). Brukes som test-spec og review-grunnlag.

---

## 1. Faser og premier

Spill 1 har **5 faser** som spilles sekvensielt i samme runde. Hver fase er en LINE-claim eller en BINGO-claim:

| Fase | Navn | Claim-type | Default fast premie | Påkrevd mønster |
|------|------|------------|---------------------|------------------|
| 1 | 1 Rad | LINE | 100 kr | Én komplett rad eller kolonne |
| 2 | 2 Rader | LINE | 200 kr | To komplette rader |
| 3 | 3 Rader | LINE | 200 kr | Tre komplette rader |
| 4 | 4 Rader | LINE | 200 kr | Fire komplette rader |
| 5 | Fullt Hus | BINGO | 1000 kr | Hele 5×5-brettet (sentercelle er fri) |

**Total mulig solo-gevinst per runde:** 100 + 200 + 200 + 200 + 1000 = **1700 kr**

> **Note:** Premiene kan være konfigurert per variant (Kvikkis, TV Extra, Ball×10, Super-NILS, Spillernes spill osv.). Tabellen over gjelder default Norsk Bingo. Variant-spesifikke beløp og mønstre er definert i `DEFAULT_NORSK_BINGO_CONFIG`, `DEFAULT_QUICKBINGO_CONFIG` osv. i `apps/backend/src/game/variantConfig.ts`.

---

## 2. First-past-the-post-prinsipp

**Hovedregel:** Den eller de bongene som FØRST treffer mønsteret på en gitt fase, vinner premien for den fasen. Dette gjelder ALLE 5 faser likt — også Fullt Hus.

### Hvordan deteksjon fungerer

Etter HVER trekning evaluerer engine den aktive fasen (første ikke-vunnede fase i rekkefølge):

1. Engine beregner drawnSet = settet av alle tall trukket så langt
2. For hver bong: sjekkes om mønsteret er oppfylt med drawnSet
3. Hvis ja → bong er vinner for denne fasen
4. Etter første ball som fullfører ≥1 bong → fase markeres som vunnet og premie utbetales
5. Engine går videre til neste fase på neste ball

### Eksempel

- Ball 1-15: ingen treffer 1 Rad
- Ball 16: spiller A's bong får komplett 1. rad → A vinner 1 Rad-fasen (100 kr)
- Ball 17-30: ingen treffer 2 Rader
- Ball 31: spiller B's bong får komplette 2 rader → B vinner 2 Rader-fasen (200 kr)
- ...
- Ball 70: én av spiller A's bonger blir komplett (Fullt Hus) → A vinner Fullt Hus (1000 kr)
- Runden avsluttes ved Fullt Hus-vinn (eller ved ball 75 hvis ingen)

---

## 3. Multi-winner split (delt premie)

### Når split skjer

Hvis **flere bonger treffer samme mønster på samme trekning**, deles premien likt mellom alle vinnere — gjelder alle 5 faser.

Konkret: hvis ball 17 fullfører 1. rad på spiller A's bong OG spiller B's bong samtidig:

- Total premie for 1 Rad: 100 kr
- Antall vinnere: 2
- Per-vinner: floor(100 / 2) = **50 kr** til hver
- Rest-øre: 0 (jevnt delelig)

### Floor-rounding og hus-rest

Premier deles med floor-division. Eventuell rest-øre (matematisk umulig å dele jevnt) tilfaller huset.

Eksempel: 3 vinnere på Fullt Hus 1000 kr:
- Per-vinner: floor(1000 / 3) = 333 kr × 3 = 999 kr
- Hus-rest: 1 kr (loggføres som `HOUSE_RETAINED` i compliance-ledger per §71)

### Multi-bong per spiller

En enkelt spiller kan ha flere bonger som ALLE treffer mønsteret på samme ball. Spilleren teller likevel som **én** vinner — gevinsten splittes per UNIK spiller, ikke per bong.

Eksempel: spiller A har 3 bonger der alle 3 treffer 1 Rad på ball 16. Spiller B har ingen.
- Total premie: 100 kr
- Antall unike vinnere: 1 (kun A)
- A får hele 100 kr

Hvis spiller A og B begge har bonger som treffer på ball 16:
- 2 unike vinnere → 50 kr hver, uavhengig av hvor mange bonger hver har

> **Viktig per-farge-regel:** I varianter med `patternsByColor` (per-farge premie-matrise) kan en spiller vinne i flere farge-grupper hvis de har bonger i flere farger. Hver farge har egen split innen seg. Detaljer i [`docs/architecture/spill1-variantconfig-admin-coupling.md`](../architecture/spill1-variantconfig-admin-coupling.md).

---

## 4. Faste premier vs prosent-baserte (winningType)

Hver fase i variant-config har et `winningType`-felt:

### `winningType: "fixed"` (Norsk Bingo default)

- Premien er ALLTID `prize1` kr (f.eks. 100 / 200 / 1000)
- **Hus-garantert** — utbetales selv om buy-in-pool er mindre enn premien
- Hus-konto kan gå negativt (system-konto med `is_system=true` i wallet)
- Audit-event `HOUSE_DEFICIT` skrives når payout > pool

### `winningType: "percent"` (legacy / variabel)

- Premien er `prize_pool × prizePercent / 100`
- Pool-cappet — premien kan reduseres hvis pool er liten
- Ingen hus-deficit; hus deler ikke ut mer enn pool kan dekke

### Single-prize-cap (regulatorisk)

Uansett `winningType` kan ENKELT-premie ALDRI overstige **2500 kr** (pengespillforskriften §11). Hvis konfigurert prize > 2500, kappes til 2500 og diff loggføres som `HOUSE_RETAINED` med audit-tag.

---

## 5. Slutt-betingelser for runden

En runde i Spill 1 avsluttes når **én** av disse skjer:

| Trigger | endedReason | Konsekvens |
|---------|-------------|------------|
| Fullt Hus vinnes | `BINGO_CLAIMED` | Phase 5 vinneres premie utbetales, runde avsluttes |
| Alle 75 baller trukket uten Fullt Hus | `MAX_DRAWS_REACHED` | Runde avsluttes, ingen Fullt Hus-credit |
| Manuell avbrytelse (admin) | `ADMIN_END` | Runde avsluttes uansett state |
| Spillerstemt stopp (Spillvett) | `PLAYER_STOP_VOTE` | Runde avsluttes (regulatorisk krav §38) |

### Edge case: ball 75 = siste ball

Tidligere bug (fikset i PR #604): På ball 75 kunne `MAX_DRAWS_REACHED`-blokken overskrive `BINGO_CLAIMED` selv om Fullt Hus ble korrekt vunnet på samme ball. Fikset med status-guard + last-chance-evaluation. **Detalj i `BingoEngine.ts:1785+` med kommentar.**

---

## 6. Test-scenarier

Bruk disse scenarioene for å validere fremtidige endringer:

### Scenario A: Solo-spiller, all 5 faser treffes før ball 75
- 1 spiller, 4-18 bonger (Norsk Bingo default)
- Spillet skal kjøre til Fullt Hus treffer (typisk ball 50-70 med 4 bonger)
- Forventet wallet-credit: 100 + 200 + 200 + 200 + 1000 = **1700 kr** til winnings
- Forventet ledger-events: 5 × `PRIZE` (Norsk Bingo)
- Forventet `endedReason`: `BINGO_CLAIMED`

### Scenario B: Solo-spiller, ingen Fullt Hus før ball 75
- 1 spiller, 1 bong
- Trekk alle 75 baller
- Hvis bongens 24 numre alle blir trukket innen ball 75: Fullt Hus skal treffes på den ballen
- Forventet wallet-credit: full 1700 kr
- Forventet `endedReason`: `BINGO_CLAIMED` (ikke `MAX_DRAWS_REACHED`)

### Scenario C: Multi-winner split
- 2 spillere, 1 bong hver
- Hvis BEGGE bongers 1. rad fullføres på samme ball X
- Total premie 100 kr → 50 kr til hver spiller
- Forventet ledger-events: 2 × `PRIZE` à 50 kr (én per vinner)

### Scenario D: Floor-rounding hus-rest
- 3 spillere, 1 bong hver, alle treffer Fullt Hus på samme ball
- Total premie 1000 kr → floor(1000/3) = 333 kr per vinner
- Total utbetalt til spillere: 999 kr
- Forventet `HOUSE_RETAINED`-ledger: 1 kr

### Scenario E: Solo-spiller, fixed prize > pool
- 1 spiller, kjøper bong for 80 kr (pool = 80)
- Spiller vinner Fullt Hus på fast premie 1000 kr
- Forventet wallet-credit: 1000 kr (full premie, hus-garantert)
- Forventet hus-saldo-endring: -1000 kr (system-konto kan gå negativt)
- Forventet ledger: `PRIZE` 1000 kr + `HOUSE_DEFICIT` 920 kr

---

## 7. Vanlige misforståelser

| Misforståelse | Korreksjon |
|---------------|------------|
| "Fullt Hus utbetales på ball 75" | Nei — Fullt Hus utbetales på den ballen som FØRST fullfører noens bong, akkurat som radene |
| "Hvis flere har Fullt Hus deler de bare hvis de hadde det fra forrige ball" | Nei — split skjer kun for samtidig fullføring på SAMME ball. Tidligere ufullført bong som fullføres på neste ball deltar ikke i split |
| "Pool må dekke premien" | Nei for fixed-prize (`winningType: "fixed"`) — hus dekker. Ja for percent-based |
| "Animasjonen viser bare Fullt Hus-prisen" | WinScreenV2 viser `roundAccumulatedWinnings` = sum av alle 5 phaser spilleren har vunnet i denne runden (klient akkumulerer på `pattern:won`-events for `isMe`) |
| "Multi-bong per spiller får dobbel premie" | Nei — split per UNIK spiller, ikke per bong |

---

## 8. Implementasjon — referanse-filer

For utviklere som skal endre logikken:

| Komponent | Fil |
|-----------|-----|
| Variant-config (faste premier, mønstre) | `apps/backend/src/game/variantConfig.ts` |
| Mapper admin-config → engine | `apps/backend/src/game/spill1VariantMapper.ts` |
| Auto-claim på trekning | `apps/backend/src/game/BingoEnginePatternEval.ts` (`evaluateActivePhase`) |
| Vinner-deteksjon | `BingoEnginePatternEval.detectPhaseWinners` |
| Per-bong mønster-sjekk | `apps/backend/src/game/ticket.ts` (`hasFullBingo`, `meetsPhaseRequirement`) |
| Payout (ad-hoc-rom) | `apps/backend/src/game/BingoEngine.ts` (`payoutPhaseWinner`) |
| Payout (scheduled) | `apps/backend/src/game/Game1PayoutService.ts` (`payoutPhase`) |
| Klient-popup (LINE) | `packages/game-client/src/games/game1/components/WinPopup.ts` |
| Klient-fullskjerm (BINGO) | `packages/game-client/src/games/game1/components/WinScreenV2.ts` |
| Round-akkumulator | `packages/game-client/src/games/game1/Game1Controller.ts` (`roundAccumulatedWinnings`) |

### Tester for regresjon-prevention

| Test-fil | Dekker |
|----------|--------|
| `BingoEngine.fullThusAfterAllBalls.test.ts` | Scenario B (ball 75 + last-chance) |
| `BingoEngine.fivePhase.test.ts` | Scenario A (5-fase progresjon) |
| `BingoEngine.splitRoundingLoyalty.test.ts` | Scenario D (split-rounding hus-rest) |
| `Game1PayoutService.norskBingo1700.test.ts` | Scheduled-stack 1700 kr utbetaling |
| `BingoEnginePatternEval.test.ts` | First-past-the-post deteksjon |

---

## 9. Compliance — pengespillforskriften

Hver utbetaling skriver til compliance-ledger med disse event-typene:

- `STAKE` — buy-in (deposit-trekk når spiller kjøper bong)
- `PRIZE` — vanlig premie (radene + Fullt Hus i Norsk Bingo)
- `EXTRA_PRIZE` — Lucky Number Bonus, Innsatsen-pot, mini-game-payout
- `HOUSE_RETAINED` — split-rounding rest-øre + 2500-kr-cap-overskytende
- `HOUSE_DEFICIT` — fixed-prize-overlapp (hus dekker > pool)
- `ORG_DISTRIBUTION` — overskuddsfordeling til organisasjoner (§11, 15% main game / 30% databingo)

§71-rapporter aggregerer per `actor_hall_id` (kjøpe-hallen, ikke master-hallen) etter PR #443.

---

**Spørsmål?** Spør PM før du endrer logikken. Tester må kjøre grønne før merge.
