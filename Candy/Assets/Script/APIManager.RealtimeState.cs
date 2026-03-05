using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using SimpleJSON;
using TMPro;
using UnityEngine;

public partial class APIManager
{
    private struct RealtimeClaimInfo
    {
        public string ClaimId;
        public string ClaimType;
        public JSONNode ClaimNode;
    }

    private void HandleRealtimeRoomUpdate(JSONNode snapshot)
    {
        if (snapshot == null || snapshot.IsNull)
        {
            return;
        }

        string snapshotRoomCode = snapshot["code"];
        if (!string.IsNullOrWhiteSpace(snapshotRoomCode))
        {
            activeRoomCode = snapshotRoomCode.Trim().ToUpperInvariant();
            roomCode = activeRoomCode;
        }

        string snapshotHallId = snapshot["hallId"];
        if (!string.IsNullOrWhiteSpace(snapshotHallId))
        {
            hallId = snapshotHallId.Trim();
        }

        string snapshotHostPlayerId = snapshot["hostPlayerId"];
        if (!string.IsNullOrWhiteSpace(snapshotHostPlayerId))
        {
            activeHostPlayerId = snapshotHostPlayerId.Trim();
        }

        ApplySchedulerMetadata(snapshot);

        JSONNode currentGame = snapshot["currentGame"];
        if (currentGame == null || currentGame.IsNull)
        {
            realtimeScheduler.SetCurrentGameStatus("NONE");
            if (!string.IsNullOrWhiteSpace(activeGameId))
            {
                ResetRealtimeRoundVisuals();
            }

            NumberGenerator endedRoundGenerator = GameManager.instance?.numberGenerator;
            if (endedRoundGenerator != null)
            {
                endedRoundGenerator.ClearPaylineVisuals();
            }

            StopRealtimeNearWinBlinking();
            ResetRealtimeBonusState(closeBonusPanel: true);

            activeGameId = string.Empty;
            processedDrawCount = 0;
            currentTicketPage = 0;
            activeTicketSets.Clear();
            RefreshRealtimeCountdownLabel(forceRefresh: true);
            return;
        }

        realtimeScheduler.SetCurrentGameStatus(currentGame["status"]);

        string gameId = currentGame["id"];
        if (string.IsNullOrWhiteSpace(gameId))
        {
            RefreshRealtimeCountdownLabel(forceRefresh: true);
            return;
        }

        if (!string.Equals(activeGameId, gameId, StringComparison.Ordinal))
        {
            string previousGameId = activeGameId;
            activeGameId = gameId;
            processedDrawCount = 0;
            currentTicketPage = 0;
            activeTicketSets.Clear();
            ResetRealtimeRoundVisuals();
            NumberGenerator nextRoundGenerator = GameManager.instance?.numberGenerator;
            if (nextRoundGenerator != null)
            {
                nextRoundGenerator.ClearPaylineVisuals();
            }

            StopRealtimeNearWinBlinking();
            ResetRealtimeBonusState(closeBonusPanel: true, previousGameId: previousGameId);
        }

        ApplyMyTicketToCards(currentGame);
        ApplyDrawnNumbers(currentGame);
        RefreshRealtimeWinningPatternVisuals(currentGame);
        RefreshRealtimeCountdownLabel(forceRefresh: true);
    }

    private void ApplyMyTicketToCards(JSONNode currentGame)
    {
        if (string.IsNullOrWhiteSpace(activePlayerId))
        {
            return;
        }

        JSONNode tickets = currentGame["tickets"];
        if (tickets == null || tickets.IsNull)
        {
            return;
        }

        JSONNode myTicketsNode = tickets[activePlayerId];
        if (myTicketsNode == null || myTicketsNode.IsNull)
        {
            return;
        }

        List<List<int>> ticketSets = RealtimeTicketSetUtils.ExtractTicketSets(myTicketsNode);
        if (ticketSets.Count == 0)
        {
            return;
        }

        if (RealtimeTicketSetUtils.AreTicketSetsEqual(activeTicketSets, ticketSets))
        {
            return;
        }

        activeTicketSets = RealtimeTicketSetUtils.CloneTicketSets(ticketSets);
        ApplyTicketSetsToCards(activeTicketSets);
    }

    private void ApplyTicketSetsToCards(List<List<int>> ticketSets)
    {
        if (ticketSets == null || ticketSets.Count == 0)
        {
            return;
        }

        NumberGenerator generator = GameManager.instance?.numberGenerator;
        if (generator == null || generator.cardClasses == null)
        {
            return;
        }

        StopRealtimeNearWinBlinking();

        int cardSlots = Mathf.Max(1, generator.cardClasses.Length);
        int pageCount = Mathf.Max(1, Mathf.CeilToInt((float)ticketSets.Count / cardSlots));
        if (!enableTicketPaging)
        {
            currentTicketPage = 0;
        }

        if (currentTicketPage >= pageCount)
        {
            currentTicketPage = 0;
        }

        int pageStartIndex = currentTicketPage * cardSlots;
        TMP_FontAsset numberFallbackFont = RealtimeTextStyleUtils.ResolveFallbackFont();

        for (int cardIndex = 0; cardIndex < generator.cardClasses.Length; cardIndex++)
        {
            CardClass card = generator.cardClasses[cardIndex];
            if (card == null)
            {
                continue;
            }

            card.numb.Clear();
            card.selectedPayLineCanBe.Clear();
            card.paylineindex.Clear();

            for (int i = 0; i < card.payLinePattern.Count; i++)
            {
                card.payLinePattern[i] = 0;
            }

            for (int i = 0; i < card.selectionImg.Count; i++)
            {
                SetActiveIfChanged(card.selectionImg[i], false);
            }

            for (int i = 0; i < card.missingPatternImg.Count; i++)
            {
                SetActiveIfChanged(card.missingPatternImg[i], false);
            }

            for (int i = 0; i < card.matchPatternImg.Count; i++)
            {
                SetActiveIfChanged(card.matchPatternImg[i], false);
            }

            int paylineCount = card.paylineObj != null ? card.paylineObj.Count : 0;
            for (int i = 0; i < paylineCount; i++)
            {
                SetActiveIfChanged(card.paylineObj[i], false);
            }

            List<int> sourceTicket = null;
            int ticketIndex = pageStartIndex + cardIndex;
            if (ticketIndex < ticketSets.Count)
            {
                sourceTicket = RealtimeTicketSetUtils.NormalizeTicketNumbers(ticketSets[ticketIndex]);
            }
            else if (duplicateTicketAcrossAllCards && ticketSets.Count == 1)
            {
                sourceTicket = RealtimeTicketSetUtils.NormalizeTicketNumbers(ticketSets[0]);
            }

            bool shouldPopulate = sourceTicket != null;
            for (int cellIndex = 0; cellIndex < 15; cellIndex++)
            {
                int value = shouldPopulate ? sourceTicket[cellIndex] : 0;
                card.numb.Add(value);

                if (cellIndex < card.num_text.Count)
                {
                    RealtimeTextStyleUtils.ApplyCardNumber(
                        card.num_text[cellIndex],
                        value > 0 ? value.ToString() : "-",
                        numberFallbackFont);
                }
            }
        }

        if (logBootstrapEvents)
        {
            Debug.Log($"[APIManager] Applied ticket page {currentTicketPage + 1}/{pageCount} ({ticketSets.Count} total ticket(s)) for player {activePlayerId}. Room {activeRoomCode}, game {activeGameId}");
        }
    }

    private void ApplyDrawnNumbers(JSONNode currentGame)
    {
        JSONNode drawnNumbers = currentGame["drawnNumbers"];
        if (drawnNumbers == null || drawnNumbers.IsNull || !drawnNumbers.IsArray)
        {
            return;
        }

        NumberGenerator generator = GameManager.instance?.numberGenerator;
        if (generator == null || generator.cardClasses == null)
        {
            return;
        }

        int previousProcessedDrawCount = Mathf.Max(0, processedDrawCount);
        for (int drawIndex = 0; drawIndex < drawnNumbers.Count; drawIndex++)
        {
            int drawnNumber = drawnNumbers[drawIndex].AsInt;
            RealtimeTicketSetUtils.MarkDrawnNumberOnCards(generator, drawnNumber);

            if (drawIndex < previousProcessedDrawCount)
            {
                continue;
            }

            ShowRealtimeDrawBall(drawIndex, drawnNumber);

            if (autoMarkDrawnNumbers &&
                RealtimeTicketSetUtils.TicketContainsInAnyTicketSet(activeTicketSets, drawnNumber) &&
                !string.IsNullOrWhiteSpace(activeRoomCode) &&
                !string.IsNullOrWhiteSpace(activePlayerId) &&
                realtimeClient != null &&
                realtimeClient.IsReady)
            {
                realtimeClient.MarkNumber(activeRoomCode, activePlayerId, drawnNumber, null);
            }
        }

        processedDrawCount = drawnNumbers.Count;
    }

    private void RefreshRealtimeWinningPatternVisuals(JSONNode currentGame)
    {
        NumberGenerator generator = GameManager.instance?.numberGenerator;
        if (generator == null || generator.cardClasses == null || generator.patternList == null)
        {
            StopRealtimeNearWinBlinking();
            return;
        }

        List<int> activePatternIndexes = GetActivePatternIndexes(generator);
        if (activePatternIndexes.Count == 0)
        {
            generator.ClearPaylineVisuals();
            StopRealtimeNearWinBlinking();
            NumberGenerator.isPrizeMissedByOneCard = false;
            RefreshRealtimeBonusFlow(currentGame, default, null);
            return;
        }

        RealtimeClaimInfo latestClaim = GetLatestValidClaimForCurrentPlayer(currentGame);
        Dictionary<int, int> winningPatternsByCard = ResolveWinningPatternsByCard(generator, activePatternIndexes, latestClaim);

        bool hasAnyWonPattern = false;
        foreach (KeyValuePair<int, int> cardWin in winningPatternsByCard)
        {
            if (cardWin.Value >= 0)
            {
                hasAnyWonPattern = true;
                break;
            }
        }

        HideAllMissingPatternVisuals(generator.cardClasses);

        HashSet<int> activeNearWinKeys = new();
        for (int cardNo = 0; cardNo < generator.cardClasses.Length; cardNo++)
        {
            CardClass card = generator.cardClasses[cardNo];
            if (card == null)
            {
                continue;
            }

            int wonPatternIndex = winningPatternsByCard.TryGetValue(cardNo, out int resolvedWonPatternIndex)
                ? resolvedWonPatternIndex
                : -1;

            ApplyTicketStateVisualsForCard(
                generator,
                cardNo,
                activePatternIndexes,
                wonPatternIndex,
                allowNearWin: !hasAnyWonPattern,
                activeNearWinKeys);
        }

        SyncRealtimeNearWinBlinking(activeNearWinKeys, generator.cardClasses);
        NumberGenerator.isPrizeMissedByOneCard = activeNearWinKeys.Count > 0;
        RefreshRealtimeBonusFlow(currentGame, latestClaim, winningPatternsByCard);
    }

    private RealtimeClaimInfo GetLatestValidClaimForCurrentPlayer(JSONNode currentGame)
    {
        if (currentGame == null || currentGame.IsNull || string.IsNullOrWhiteSpace(activePlayerId))
        {
            return default;
        }

        JSONNode claims = currentGame["claims"];
        if (claims == null || claims.IsNull || !claims.IsArray)
        {
            return default;
        }

        for (int i = claims.Count - 1; i >= 0; i--)
        {
            JSONNode claim = claims[i];
            if (claim == null || claim.IsNull || !claim["valid"].AsBool)
            {
                continue;
            }

            string claimPlayerId = claim["playerId"];
            if (!string.Equals(claimPlayerId?.Trim(), activePlayerId, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            string claimType = claim["type"];
            if (string.Equals(claimType, "LINE", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(claimType, "BINGO", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(claimType, "BONUS", StringComparison.OrdinalIgnoreCase))
            {
                return new RealtimeClaimInfo
                {
                    ClaimId = claim["id"],
                    ClaimType = claimType.Trim().ToUpperInvariant(),
                    ClaimNode = claim
                };
            }
        }

        return default;
    }

    private List<int> GetActivePatternIndexes(NumberGenerator generator)
    {
        List<int> activePatternIndexes = new();
        if (generator == null || generator.patternList == null || generator.patternList.Count == 0)
        {
            return activePatternIndexes;
        }

        HashSet<int> uniquePatternIndexes = new();
        List<int> selectedPatterns = generator.totalSelectedPatterns;
        if (selectedPatterns != null)
        {
            for (int i = 0; i < selectedPatterns.Count; i++)
            {
                int patternIndex = selectedPatterns[i];
                if (patternIndex < 0 || patternIndex >= generator.patternList.Count)
                {
                    continue;
                }

                if (uniquePatternIndexes.Add(patternIndex))
                {
                    activePatternIndexes.Add(patternIndex);
                }
            }
        }

        if (activePatternIndexes.Count == 0)
        {
            for (int patternIndex = 0; patternIndex < generator.patternList.Count; patternIndex++)
            {
                activePatternIndexes.Add(patternIndex);
            }
        }

        return activePatternIndexes;
    }

    private Dictionary<int, int> ResolveWinningPatternsByCard(
        NumberGenerator generator,
        List<int> activePatternIndexes,
        RealtimeClaimInfo latestClaim)
    {
        Dictionary<int, int> winningPatternsByCard = new();
        if (generator == null || generator.cardClasses == null || generator.patternList == null)
        {
            return winningPatternsByCard;
        }

        for (int cardNo = 0; cardNo < generator.cardClasses.Length; cardNo++)
        {
            winningPatternsByCard[cardNo] = -1;
        }

        HashSet<int> explicitWinningPatternIndexes = ExtractWinningPatternIndexes(
            latestClaim.ClaimNode,
            generator.patternList.Count);

        if (explicitWinningPatternIndexes.Count > 0)
        {
            List<int> orderedClaimPatternIndexes = BuildOrderedPatternPriority(
                activePatternIndexes,
                explicitWinningPatternIndexes);

            for (int cardNo = 0; cardNo < generator.cardClasses.Length; cardNo++)
            {
                CardClass card = generator.cardClasses[cardNo];
                if (card == null)
                {
                    continue;
                }

                winningPatternsByCard[cardNo] = FindFirstMatchedPatternIndex(
                    card,
                    generator.patternList,
                    orderedClaimPatternIndexes);
            }

            return winningPatternsByCard;
        }

        bool lineClaim = string.Equals(latestClaim.ClaimType, "LINE", StringComparison.OrdinalIgnoreCase);
        if (lineClaim)
        {
            for (int cardNo = 0; cardNo < generator.cardClasses.Length; cardNo++)
            {
                CardClass card = generator.cardClasses[cardNo];
                if (card == null)
                {
                    continue;
                }

                int firstMatch = FindFirstMatchedPatternIndex(card, generator.patternList, activePatternIndexes);
                if (firstMatch >= 0)
                {
                    winningPatternsByCard[cardNo] = firstMatch;
                    break;
                }
            }

            return winningPatternsByCard;
        }

        for (int cardNo = 0; cardNo < generator.cardClasses.Length; cardNo++)
        {
            CardClass card = generator.cardClasses[cardNo];
            if (card == null)
            {
                continue;
            }

            winningPatternsByCard[cardNo] = FindFirstMatchedPatternIndex(card, generator.patternList, activePatternIndexes);
        }

        return winningPatternsByCard;
    }

    private HashSet<int> ExtractWinningPatternIndexes(JSONNode claimNode, int patternCount)
    {
        HashSet<int> winningIndexes = new();
        if (claimNode == null || claimNode.IsNull || patternCount <= 0)
        {
            return winningIndexes;
        }

        AddWinningPatternIndex(claimNode["patternIndex"], patternCount, winningIndexes);
        AddWinningPatternIndex(claimNode["winningPatternIndex"], patternCount, winningIndexes);
        AddWinningPatternIndex(claimNode["lineIndex"], patternCount, winningIndexes);
        AddWinningPatternIndexesFromArray(claimNode["patternIndexes"], patternCount, winningIndexes);
        AddWinningPatternIndexesFromArray(claimNode["winningPatternIndexes"], patternCount, winningIndexes);

        JSONNode payloadNode = claimNode["payload"];
        if (payloadNode != null && !payloadNode.IsNull)
        {
            AddWinningPatternIndex(payloadNode["patternIndex"], patternCount, winningIndexes);
            AddWinningPatternIndex(payloadNode["winningPatternIndex"], patternCount, winningIndexes);
            AddWinningPatternIndex(payloadNode["lineIndex"], patternCount, winningIndexes);
            AddWinningPatternIndexesFromArray(payloadNode["patternIndexes"], patternCount, winningIndexes);
            AddWinningPatternIndexesFromArray(payloadNode["winningPatternIndexes"], patternCount, winningIndexes);
        }

        return winningIndexes;
    }

    private void AddWinningPatternIndexesFromArray(JSONNode node, int patternCount, HashSet<int> target)
    {
        if (node == null || node.IsNull || !node.IsArray)
        {
            return;
        }

        for (int i = 0; i < node.Count; i++)
        {
            AddWinningPatternIndex(node[i], patternCount, target);
        }
    }

    private void AddWinningPatternIndex(JSONNode node, int patternCount, HashSet<int> target)
    {
        if (!TryParsePatternIndex(node, patternCount, out int patternIndex))
        {
            return;
        }

        target.Add(patternIndex);
    }

    private bool TryParsePatternIndex(JSONNode node, int patternCount, out int patternIndex)
    {
        patternIndex = -1;
        if (node == null || node.IsNull || patternCount <= 0)
        {
            return false;
        }

        string rawValue = node.Value;
        if (!int.TryParse(rawValue, out int parsed))
        {
            return false;
        }

        if (parsed >= 0 && parsed < patternCount)
        {
            patternIndex = parsed;
            return true;
        }

        if (parsed > 0 && parsed <= patternCount)
        {
            patternIndex = parsed - 1;
            return true;
        }

        return false;
    }

    private List<int> BuildOrderedPatternPriority(List<int> activePatternIndexes, HashSet<int> explicitPatternIndexes)
    {
        List<int> orderedPatterns = new();
        HashSet<int> seen = new();

        if (activePatternIndexes != null)
        {
            for (int i = 0; i < activePatternIndexes.Count; i++)
            {
                int patternIndex = activePatternIndexes[i];
                if (!explicitPatternIndexes.Contains(patternIndex))
                {
                    continue;
                }

                if (seen.Add(patternIndex))
                {
                    orderedPatterns.Add(patternIndex);
                }
            }
        }

        foreach (int patternIndex in explicitPatternIndexes)
        {
            if (seen.Add(patternIndex))
            {
                orderedPatterns.Add(patternIndex);
            }
        }

        return orderedPatterns;
    }

    private int FindFirstMatchedPatternIndex(CardClass card, List<Patterns> patternList, List<int> candidatePatternIndexes)
    {
        if (card == null || patternList == null || candidatePatternIndexes == null)
        {
            return -1;
        }

        for (int i = 0; i < candidatePatternIndexes.Count; i++)
        {
            int patternIndex = candidatePatternIndexes[i];
            if (patternIndex < 0 || patternIndex >= patternList.Count)
            {
                continue;
            }

            if (RealtimePaylineUtils.IsPatternMatchedOnCard(card, patternList, patternIndex))
            {
                return patternIndex;
            }
        }

        return -1;
    }

    private void ApplyTicketStateVisualsForCard(
        NumberGenerator generator,
        int cardNo,
        List<int> activePatternIndexes,
        int wonPatternIndex,
        bool allowNearWin,
        HashSet<int> activeNearWinKeys)
    {
        if (generator == null || generator.cardClasses == null || cardNo < 0 || cardNo >= generator.cardClasses.Length)
        {
            return;
        }

        CardClass card = generator.cardClasses[cardNo];
        if (card == null)
        {
            return;
        }

        for (int i = 0; i < card.matchPatternImg.Count; i++)
        {
            if (card.matchPatternImg[i] != null)
            {
                SetActiveIfChanged(card.matchPatternImg[i], false);
            }
        }

        int paylineCount = card.paylineObj != null ? card.paylineObj.Count : 0;
        int visualPatternCount = Mathf.Min(generator.patternList.Count, paylineCount);
        RealtimePaylineUtils.EnsurePaylineIndexCapacity(card, visualPatternCount);

        for (int patternIndex = 0; patternIndex < visualPatternCount; patternIndex++)
        {
            bool isWinner = patternIndex == wonPatternIndex;
            if (patternIndex < card.paylineindex.Count)
            {
                card.paylineindex[patternIndex] = isWinner;
            }

            RealtimePaylineUtils.SetPaylineVisual(
                generator.cardClasses,
                cardNo,
                patternIndex,
                isWinner,
                isWinner,
                generator.matchedMat,
                generator.unMatchedMat);
        }

        for (int i = 0; i < activePatternIndexes.Count; i++)
        {
            int patternIndex = activePatternIndexes[i];
            if (patternIndex < 0 || patternIndex >= generator.patternList.Count)
            {
                continue;
            }

            TicketUiState state = TicketUiState.normal;
            int missingCellIndex = -1;

            if (patternIndex == wonPatternIndex)
            {
                state = TicketUiState.won;
            }
            else if (allowNearWin && TryGetNearWinCellIndex(card, generator.patternList[patternIndex].pattern, out missingCellIndex))
            {
                state = TicketUiState.nearWin;
            }

            ApplyTicketPatternState(
                card,
                cardNo,
                generator.patternList[patternIndex].pattern,
                state,
                missingCellIndex,
                activeNearWinKeys);
        }
    }

    private void ApplyTicketPatternState(
        CardClass card,
        int cardNo,
        List<byte> mask,
        TicketUiState state,
        int missingCellIndex,
        HashSet<int> activeNearWinKeys)
    {
        if (card == null || mask == null)
        {
            return;
        }

        if (state == TicketUiState.won)
        {
            return;
        }

        if (state != TicketUiState.nearWin ||
            missingCellIndex < 0 ||
            missingCellIndex >= card.missingPatternImg.Count ||
            card.missingPatternImg[missingCellIndex] == null)
        {
            return;
        }

        int blinkKey = BuildNearWinBlinkKey(cardNo, missingCellIndex);
        activeNearWinKeys.Add(blinkKey);
        if (!realtimeNearWinBlinkCoroutines.ContainsKey(blinkKey))
        {
            Coroutine blinkRoutine = StartCoroutine(BlinkRealtimeNearWinCell(blinkKey, card.missingPatternImg[missingCellIndex]));
            realtimeNearWinBlinkCoroutines[blinkKey] = blinkRoutine;
        }
    }

    private bool TryGetNearWinCellIndex(CardClass card, List<byte> mask, out int missingCellIndex)
    {
        missingCellIndex = -1;
        if (card == null || mask == null || card.payLinePattern == null)
        {
            return false;
        }

        int requiredCount = 0;
        int matchedCount = 0;
        int cellCount = Mathf.Min(mask.Count, card.payLinePattern.Count);
        for (int cellIndex = 0; cellIndex < cellCount; cellIndex++)
        {
            if (mask[cellIndex] != 1)
            {
                continue;
            }

            requiredCount++;
            if (card.payLinePattern[cellIndex] == 1)
            {
                matchedCount++;
            }
            else if (missingCellIndex < 0)
            {
                missingCellIndex = cellIndex;
            }
        }

        return requiredCount > 0 && matchedCount == requiredCount - 1 && missingCellIndex >= 0;
    }

    private IEnumerator BlinkRealtimeNearWinCell(int blinkKey, GameObject nearWinCell)
    {
        bool visible = false;
        WaitForSeconds wait = new WaitForSeconds(realtimeNearWinBlinkInterval);
        while (realtimeNearWinBlinkCoroutines.ContainsKey(blinkKey))
        {
            visible = !visible;
            if (nearWinCell != null)
            {
                SetActiveIfChanged(nearWinCell, visible);
            }

            yield return wait;
        }

        if (nearWinCell != null)
        {
            SetActiveIfChanged(nearWinCell, false);
        }
    }

    private void SyncRealtimeNearWinBlinking(HashSet<int> activeNearWinKeys, CardClass[] cards)
    {
        List<int> keysToStop = new();
        foreach (int key in realtimeNearWinBlinkCoroutines.Keys)
        {
            if (!activeNearWinKeys.Contains(key))
            {
                keysToStop.Add(key);
            }
        }

        for (int i = 0; i < keysToStop.Count; i++)
        {
            int key = keysToStop[i];
            if (realtimeNearWinBlinkCoroutines.TryGetValue(key, out Coroutine routine) && routine != null)
            {
                StopCoroutine(routine);
            }

            realtimeNearWinBlinkCoroutines.Remove(key);
            SetNearWinCellActive(cards, key, false);
        }
    }

    private void HideAllMissingPatternVisuals(CardClass[] cards)
    {
        if (cards == null)
        {
            return;
        }

        for (int cardNo = 0; cardNo < cards.Length; cardNo++)
        {
            CardClass card = cards[cardNo];
            if (card == null || card.missingPatternImg == null)
            {
                continue;
            }

            for (int cellIndex = 0; cellIndex < card.missingPatternImg.Count; cellIndex++)
            {
                GameObject missingCell = card.missingPatternImg[cellIndex];
                if (missingCell != null)
                {
                    SetActiveIfChanged(missingCell, false);
                }
            }
        }
    }

    private int BuildNearWinBlinkKey(int cardNo, int cellIndex)
    {
        return (cardNo * 100) + cellIndex;
    }

    private void DecodeNearWinBlinkKey(int key, out int cardNo, out int cellIndex)
    {
        cardNo = key / 100;
        cellIndex = key % 100;
    }

    private void SetNearWinCellActive(CardClass[] cards, int blinkKey, bool active)
    {
        DecodeNearWinBlinkKey(blinkKey, out int cardNo, out int cellIndex);
        if (cards == null || cardNo < 0 || cardNo >= cards.Length)
        {
            return;
        }

        CardClass card = cards[cardNo];
        if (card == null || card.missingPatternImg == null || cellIndex < 0 || cellIndex >= card.missingPatternImg.Count)
        {
            return;
        }

        GameObject missingCell = card.missingPatternImg[cellIndex];
        if (missingCell != null)
        {
            SetActiveIfChanged(missingCell, active);
        }
    }

    private static void SetActiveIfChanged(GameObject target, bool active)
    {
        if (target != null && target.activeSelf != active)
        {
            target.SetActive(active);
        }
    }

    private void StopRealtimeNearWinBlinking()
    {
        CardClass[] cards = GameManager.instance?.numberGenerator?.cardClasses;

        foreach (KeyValuePair<int, Coroutine> entry in realtimeNearWinBlinkCoroutines)
        {
            if (entry.Value != null)
            {
                StopCoroutine(entry.Value);
            }

            SetNearWinCellActive(cards, entry.Key, false);
        }

        realtimeNearWinBlinkCoroutines.Clear();
        HideAllMissingPatternVisuals(cards);
    }

    private void RefreshRealtimeBonusFlow(
        JSONNode currentGame,
        RealtimeClaimInfo latestClaim,
        Dictionary<int, int> winningPatternsByCard)
    {
        if (string.IsNullOrWhiteSpace(activeGameId))
        {
            return;
        }

        if (string.Equals(realtimeBonusTriggeredGameId, activeGameId, StringComparison.Ordinal))
        {
            return;
        }

        if (!TryResolveRealtimeBonusTrigger(latestClaim, winningPatternsByCard, out string triggerSource))
        {
            return;
        }

        if (!TryResolveRealtimeBonusAmount(currentGame, latestClaim, out int bonusAmount, out string amountSource))
        {
            string missingKey = $"{activeGameId}:{latestClaim.ClaimId}";
            if (!string.Equals(realtimeBonusMissingDataLogKey, missingKey, StringComparison.Ordinal))
            {
                realtimeBonusMissingDataLogKey = missingKey;
                Debug.LogWarning(
                    $"[APIManager] Realtime bonus-trigger ({triggerSource}) ble funnet i game {activeGameId}, " +
                    $"men bonusbelop mangler i snapshot/claim. Forventet: claim.bonusAmount / claim.payload.bonusAmount / " +
                    $"currentGame.bonusByPlayer[playerId] / currentGame.bonusAmount.");
            }
            return;
        }

        NumberGenerator generator = GameManager.instance?.numberGenerator;
        if (generator == null)
        {
            Debug.LogError($"[APIManager] Realtime bonus-trigger ({triggerSource}) funnet, men NumberGenerator mangler.");
            return;
        }

        bonusAMT = bonusAmount;
        if (!generator.TryOpenRealtimeBonusPanel(bonusAmount, activeGameId, latestClaim.ClaimId))
        {
            return;
        }

        realtimeBonusTriggeredGameId = activeGameId;
        realtimeBonusTriggeredClaimId = latestClaim.ClaimId ?? string.Empty;
        realtimeBonusMissingDataLogKey = string.Empty;
        Debug.Log($"[APIManager] Realtime bonus-trigger aktivert ({triggerSource}). bonusAMT={bonusAmount} ({amountSource}) game={activeGameId} claim={realtimeBonusTriggeredClaimId}");
    }

    private bool TryResolveRealtimeBonusTrigger(
        RealtimeClaimInfo latestClaim,
        Dictionary<int, int> winningPatternsByCard,
        out string triggerSource)
    {
        triggerSource = string.Empty;
        if (latestClaim.ClaimNode == null || latestClaim.ClaimNode.IsNull)
        {
            return false;
        }

        if (TryResolveBackendBonusTrigger(latestClaim.ClaimNode, out bool backendTriggered, out string backendSource))
        {
            triggerSource = backendSource;
            return backendTriggered;
        }

        if (string.Equals(latestClaim.ClaimType, "BONUS", StringComparison.OrdinalIgnoreCase))
        {
            triggerSource = "claim.type=BONUS";
            LogBonusFallbackUsed("trigger", triggerSource, latestClaim.ClaimId);
            return true;
        }

        if (HasTruthyBonusFlag(latestClaim.ClaimNode))
        {
            triggerSource = "claim.bonusFlag";
            LogBonusFallbackUsed("trigger", triggerSource, latestClaim.ClaimId);
            return true;
        }

        if (!string.Equals(latestClaim.ClaimType, "LINE", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        if (winningPatternsByCard == null)
        {
            return false;
        }

        foreach (KeyValuePair<int, int> cardWin in winningPatternsByCard)
        {
            if (cardWin.Value == realtimeBonusPatternIndex)
            {
                triggerSource = $"winningPatternIndex={realtimeBonusPatternIndex}";
                LogBonusFallbackUsed("trigger", triggerSource, latestClaim.ClaimId);
                return true;
            }
        }

        return false;
    }

    private bool TryResolveBackendBonusTrigger(JSONNode claimNode, out bool bonusTriggered, out string source)
    {
        bonusTriggered = false;
        source = string.Empty;
        if (claimNode == null || claimNode.IsNull)
        {
            return false;
        }

        if (TryParseOptionalBool(claimNode["bonusTriggered"], out bool claimFlag))
        {
            bonusTriggered = claimFlag;
            source = "claim.bonusTriggered";
            return true;
        }

        JSONNode payload = claimNode["payload"];
        if (TryParseOptionalBool(payload?["bonusTriggered"], out bool payloadFlag))
        {
            bonusTriggered = payloadFlag;
            source = "claim.payload.bonusTriggered";
            return true;
        }

        return false;
    }

    private bool HasTruthyBonusFlag(JSONNode claimNode)
    {
        if (claimNode == null || claimNode.IsNull)
        {
            return false;
        }

        if (IsTruthyNode(claimNode["hasBonus"]) ||
            IsTruthyNode(claimNode["isBonus"]))
        {
            return true;
        }

        JSONNode payload = claimNode["payload"];
        return IsTruthyNode(payload?["hasBonus"]) ||
               IsTruthyNode(payload?["isBonus"]);
    }

    private bool IsTruthyNode(JSONNode node)
    {
        if (node == null || node.IsNull)
        {
            return false;
        }

        if (bool.TryParse(node.Value, out bool boolValue))
        {
            return boolValue;
        }

        if (int.TryParse(node.Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out int intValue))
        {
            return intValue != 0;
        }

        return node.AsBool;
    }

    private bool TryResolveRealtimeBonusAmount(
        JSONNode currentGame,
        RealtimeClaimInfo latestClaim,
        out int bonusAmount,
        out string source)
    {
        bonusAmount = 0;
        source = string.Empty;

        if (TryResolveBackendBonusAmount(latestClaim.ClaimNode, out bonusAmount, out source))
        {
            source = $"claim.{source}";
            return true;
        }

        JSONNode claimPayload = latestClaim.ClaimNode?["payload"];
        if (TryResolveBackendBonusAmount(claimPayload, out bonusAmount, out source))
        {
            source = $"claim.payload.{source}";
            return true;
        }

        if (TryResolveBonusAmountFromNode(latestClaim.ClaimNode, out bonusAmount, out source))
        {
            source = $"claim.{source}";
            LogBonusFallbackUsed("amount", source, latestClaim.ClaimId);
            return true;
        }

        if (TryResolveBonusAmountFromNode(claimPayload, out bonusAmount, out source))
        {
            source = $"claim.payload.{source}";
            LogBonusFallbackUsed("amount", source, latestClaim.ClaimId);
            return true;
        }

        if (TryResolveBonusAmountFromNode(currentGame, out bonusAmount, out source))
        {
            source = $"currentGame.{source}";
            LogBonusFallbackUsed("amount", source, latestClaim.ClaimId);
            return true;
        }

        if (TryResolveBonusAmountFromPlayerMap(currentGame?["bonusByPlayer"], out bonusAmount))
        {
            source = $"currentGame.bonusByPlayer[{activePlayerId}]";
            LogBonusFallbackUsed("amount", source, latestClaim.ClaimId);
            return true;
        }

        if (TryResolveBonusAmountFromPlayerMap(currentGame?["bonusAmounts"], out bonusAmount))
        {
            source = $"currentGame.bonusAmounts[{activePlayerId}]";
            LogBonusFallbackUsed("amount", source, latestClaim.ClaimId);
            return true;
        }

        if (TryResolveBonusAmountFromPlayerMap(currentGame?["bonusAwards"], out bonusAmount))
        {
            source = $"currentGame.bonusAwards[{activePlayerId}]";
            LogBonusFallbackUsed("amount", source, latestClaim.ClaimId);
            return true;
        }

        return false;
    }

    private bool TryResolveBackendBonusAmount(JSONNode node, out int bonusAmount, out string source)
    {
        bonusAmount = 0;
        source = string.Empty;
        if (node == null || node.IsNull)
        {
            return false;
        }

        if (TryParsePositiveAmount(node["bonusAmount"], out bonusAmount))
        {
            source = "bonusAmount";
            return true;
        }

        return false;
    }

    private bool TryResolveBonusAmountFromNode(JSONNode node, out int bonusAmount, out string source)
    {
        bonusAmount = 0;
        source = string.Empty;
        if (node == null || node.IsNull)
        {
            return false;
        }

        if (TryParsePositiveAmount(node["bonusAmount"], out bonusAmount))
        {
            source = "bonusAmount";
            return true;
        }

        if (TryParsePositiveAmount(node["bonusAmt"], out bonusAmount))
        {
            source = "bonusAmt";
            return true;
        }

        if (TryParsePositiveAmount(node["bonusPayout"], out bonusAmount))
        {
            source = "bonusPayout";
            return true;
        }

        if (TryParsePositiveAmount(node["bonusValue"], out bonusAmount))
        {
            source = "bonusValue";
            return true;
        }

        JSONNode bonusNode = node["bonus"];
        if (TryParseBonusAmountFromGenericNode(bonusNode, out bonusAmount))
        {
            source = "bonus";
            return true;
        }

        return false;
    }

    private bool TryResolveBonusAmountFromPlayerMap(JSONNode mapNode, out int bonusAmount)
    {
        bonusAmount = 0;
        if (mapNode == null || mapNode.IsNull || string.IsNullOrWhiteSpace(activePlayerId))
        {
            return false;
        }

        JSONNode playerNode = mapNode[activePlayerId];
        return TryParseBonusAmountFromGenericNode(playerNode, out bonusAmount);
    }

    private bool TryParseBonusAmountFromGenericNode(JSONNode node, out int bonusAmount)
    {
        bonusAmount = 0;
        if (node == null || node.IsNull)
        {
            return false;
        }

        if (TryParsePositiveAmount(node, out bonusAmount))
        {
            return true;
        }

        if (TryParsePositiveAmount(node["amount"], out bonusAmount))
        {
            return true;
        }

        if (TryParsePositiveAmount(node["bonusAmount"], out bonusAmount))
        {
            return true;
        }

        if (TryParsePositiveAmount(node["value"], out bonusAmount))
        {
            return true;
        }

        if (TryParsePositiveAmount(node["payout"], out bonusAmount))
        {
            return true;
        }

        if (TryParsePositiveAmount(node["bonusPayout"], out bonusAmount))
        {
            return true;
        }

        return false;
    }

    private bool TryParsePositiveAmount(JSONNode node, out int value)
    {
        value = 0;
        if (node == null || node.IsNull)
        {
            return false;
        }

        string raw = node.Value;
        if (string.IsNullOrWhiteSpace(raw))
        {
            return false;
        }

        if (int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out int intValue))
        {
            if (intValue > 0)
            {
                value = intValue;
                return true;
            }

            return false;
        }

        if (double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out double doubleValue) && doubleValue > 0d)
        {
            value = Mathf.RoundToInt((float)doubleValue);
            return value > 0;
        }

        return false;
    }

    private bool TryParseOptionalBool(JSONNode node, out bool value)
    {
        value = false;
        if (node == null || node.IsNull)
        {
            return false;
        }

        string raw = node.Value;
        if (string.IsNullOrWhiteSpace(raw))
        {
            return false;
        }

        if (bool.TryParse(raw, out bool boolValue))
        {
            value = boolValue;
            return true;
        }

        if (int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out int intValue))
        {
            value = intValue != 0;
            return true;
        }

        return false;
    }

    private void LogBonusFallbackUsed(string scope, string source, string claimId)
    {
        string normalizedClaimId = string.IsNullOrWhiteSpace(claimId) ? "<unknown-claim>" : claimId;
        Debug.LogWarning(
            $"[APIManager] Realtime bonus-{scope} bruker fallback ({source}) i game {activeGameId}, claim {normalizedClaimId}. " +
            "Backend-feltene claim.bonusTriggered/claim.bonusAmount mangler.");
    }

    private void ResetRealtimeBonusState(bool closeBonusPanel, string previousGameId = null)
    {
        bonusAMT = 0;
        realtimeBonusTriggeredGameId = string.Empty;
        realtimeBonusTriggeredClaimId = string.Empty;
        realtimeBonusMissingDataLogKey = string.Empty;

        NumberGenerator generator = GameManager.instance?.numberGenerator;
        if (generator == null)
        {
            return;
        }

        generator.ResetRealtimeBonusFlow(closeBonusPanel, previousGameId);
    }

    private int GetCardSlotsCount()
    {
        NumberGenerator generator = GameManager.instance?.numberGenerator;
        if (generator != null && generator.cardClasses != null && generator.cardClasses.Length > 0)
        {
            return generator.cardClasses.Length;
        }

        return 1;
    }

    private void ResetActiveRoomState(bool clearDesiredRoomCode)
    {
        ClearJoinOrCreatePending();
        activeRoomCode = string.Empty;
        activePlayerId = string.Empty;
        activeHostPlayerId = string.Empty;
        activeGameId = string.Empty;
        realtimeScheduler.Reset();
        realtimeRoomConfigurator.ResetWarningState();
        realtimeCountdownPresenter.ResetLayoutCache();
        processedDrawCount = 0;
        currentTicketPage = 0;
        activeTicketSets.Clear();
        StopRealtimeNearWinBlinking();
        ResetRealtimeBonusState(closeBonusPanel: true);
        nextScheduledRoomStateRefreshAt = -1f;
        nextScheduledManualStartAttemptAt = -1f;

        if (clearDesiredRoomCode)
        {
            roomCode = string.Empty;
        }
    }

    private void MarkJoinOrCreatePending()
    {
        isJoinOrCreatePending = true;
        joinOrCreateIssuedAtRealtime = Time.realtimeSinceStartup;
    }

    private void ClearJoinOrCreatePending()
    {
        isJoinOrCreatePending = false;
        joinOrCreateIssuedAtRealtime = -1f;
    }

    private bool IsJoinOrCreateTimedOut()
    {
        if (!isJoinOrCreatePending)
        {
            return false;
        }

        if (joinOrCreateIssuedAtRealtime < 0f)
        {
            return true;
        }

        return (Time.realtimeSinceStartup - joinOrCreateIssuedAtRealtime) > 8f;
    }
}
