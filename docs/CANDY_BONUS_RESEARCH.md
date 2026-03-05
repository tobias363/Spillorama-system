# Candy Bonus Research (Legacy vs Realtime)

## Problem
Bonusfeltet/mønsteret (lilla, nr 2 fra venstre med "150") forsvinner eller trigger ikke korrekt i dagens realtime-flyt.

## Kort konklusjon
Bonuslogikk finnes i legacy-løpet, men er ikke koblet ferdig i realtime-løpet. Resultat: bonusmønster vises/oppfører seg inkonsistent.

## Dagens bonusflyt (legacy)
1. `APIManager.StartGameWithBet()` henter `slotData.number`.
2. `fetchNo > 150` tolkes som bonus:
   - `NumberManager.instance.num = 150`
   - `APIManager.bonusAMT = fetchNo - 150`
3. `NumberManager.DoAvailablePattern()` bygger `currentPatternIndex` fra `num`.
4. `NumberGenerator` bruker disse mønstrene og lokal trekklogikk.
5. Ved `PrizeWin(..., patternIndex == 1)` settes `isBonusSelected = true`.
6. Ved rundeslutt kalles `StartBonus()` -> `bonusMainObj.SetActive(true)`.
7. `BonusControl.SetRewards()` bruker `APIManager.bonusAMT` for bonusutfall.

## Dagens realtime-flyt
1. Realtime henter room/game state fra backend (`APIManager.RealtimeState`).
2. Kort/tall markeres via `RealtimeTicketSetUtils.MarkDrawnNumberOnCards(...)`.
3. Gevinstvisualisering er claims-basert (`RefreshRealtimeWinningPatternVisuals`).
4. Legacy bonusfelt (`bonusAMT`, `num=150`, `isBonusSelected`, `StartBonus`) settes ikke deterministisk her.

## Funksjonelle hull
1. Bonus-aktivering er avhengig av legacy-variabler (`num=150`, `bonusAMT`) som ikke har sikker kilde i realtime.
2. Realtime claims er primært `LINE`/`BINGO`; bonus-pattern metadata er ikke tydelig kontraktfestet.
3. `NumberGenerator.totalSelectedPatterns` hentes fra `NumberManager.currentPatternIndex` (legacy-opphav), og refreshes ikke robust for realtime-runder.
4. Bonus-UI og bonus-payout er ikke koblet til backend-authoritative event/claim.

## Sannsynlig årsak til "bonusfelt blir borte"
- Bonusmønsteret er ikke en eksplisitt del av realtime-kontrakten per runde.
- UI forventer legacy-initiering av bonusdata, men får realtime state uten bonus-spesifikk mapping.

## Anbefalt implementeringsretning
1. Gjør bonus backend-authoritative i realtime:
   - backend returnerer eksplisitt bonusindikator (f.eks. `winningPatternIndex`/`bonusTriggered`/`bonusAmount`).
2. Unity realtime bruker kun backend-data til:
   - vise bonusmønster
   - trigge bonuspanel
   - sette bonusbeløp
3. Fjern skjult avhengighet til `fetchNo > 150` i realtime.

## Akseptansekriterier
1. Bonusmønster (lilla nr 2) forsvinner aldri i aktiv runde med gyldig bonusoppsett.
2. Bonus trigger kun når backend sier bonusmønster er truffet.
3. Bonusbeløp i UI kommer fra realtime claim/payload.
4. Ingen divergens mellom klient og backend om bonusutfall.

## Filer som er sentrale
- `Candy/Assets/Script/APIManager.cs`
- `Candy/Assets/Script/APIManager.RealtimeState.cs`
- `Candy/Assets/Script/NumberGenerator.cs`
- `Candy/Assets/Script/NumberManager.cs`
- `Candy/Assets/Script/BonusControl.cs`
- `backend/src/game/BingoEngine.ts`
