using System;
using System.Collections.Generic;
using SimpleJSON;
using UnityEngine;

public partial class APIManager
{
    private static Dictionary<int, HashSet<int>> BuildWinningPatternsByCard(Theme1DisplayState renderState)
    {
        Dictionary<int, HashSet<int>> winningPatterns = new Dictionary<int, HashSet<int>>();
        if (renderState?.Cards == null)
        {
            return winningPatterns;
        }

        for (int cardIndex = 0; cardIndex < renderState.Cards.Length; cardIndex++)
        {
            Theme1CardRenderState card = renderState.Cards[cardIndex];
            HashSet<int> matched = new HashSet<int>();
            if (card?.MatchedPatternIndexes != null && card.MatchedPatternIndexes.Length > 0)
            {
                for (int i = 0; i < card.MatchedPatternIndexes.Length; i++)
                {
                    if (card.MatchedPatternIndexes[i] >= 0)
                    {
                        matched.Add(card.MatchedPatternIndexes[i]);
                    }
                }
            }
            else if (card?.PaylinesActive != null)
            {
                for (int paylineIndex = 0; paylineIndex < card.PaylinesActive.Length; paylineIndex++)
                {
                    if (card.PaylinesActive[paylineIndex])
                    {
                        matched.Add(paylineIndex);
                    }
                }
            }

            winningPatterns[cardIndex] = matched;
        }

        return winningPatterns;
    }

    private Dictionary<int, HashSet<int>> ResolveDedicatedWinningPatternsByCard(
        Theme1DisplayState renderState,
        JSONNode currentGame,
        RealtimeClaimInfo latestClaim,
        byte[][] patternMasks)
    {
        Dictionary<int, HashSet<int>> winningPatterns = BuildWinningPatternsByCard(renderState);
        if (renderState?.Cards == null || currentGame == null || currentGame.IsNull)
        {
            return winningPatterns;
        }

        HashSet<int> drawnNumbers = ExtractPositiveIntSet(currentGame["drawnNumbers"]);
        JSONNode visibleTicketNodes = ResolveCurrentPlayerVisibleTicketNodes(currentGame, renderState.Cards.Length);
        if (visibleTicketNodes == null || visibleTicketNodes.IsNull || !visibleTicketNodes.IsArray)
        {
            return winningPatterns;
        }

        HashSet<int> claimPatternIndexes = ExtractWinningPatternIndexes(
            latestClaim.ClaimNode,
            Math.Max(32, (patternMasks?.Length ?? 0) + 16));
        if (claimPatternIndexes.Count == 0)
        {
            return winningPatterns;
        }

        for (int cardIndex = 0; cardIndex < renderState.Cards.Length; cardIndex++)
        {
            JSONNode ticketNode = ResolveVisibleTicketNodeForCard(visibleTicketNodes, cardIndex, renderState.Cards.Length);
            if (ticketNode == null || ticketNode.IsNull)
            {
                continue;
            }

            Theme1CardRenderState cardState = renderState.Cards[cardIndex];
            if (cardState == null)
            {
                continue;
            }

            if (!winningPatterns.TryGetValue(cardIndex, out HashSet<int> matchedPatterns) || matchedPatterns == null)
            {
                matchedPatterns = new HashSet<int>();
                winningPatterns[cardIndex] = matchedPatterns;
            }

            foreach (int claimPatternIndex in claimPatternIndexes)
            {
                List<int> claimNumbers = ExtractBackendClaimPatternNumbers(ticketNode["grid"], claimPatternIndex);
                if (claimNumbers.Count == 0)
                {
                    continue;
                }

                int localPatternIndex = FindBestLocalPatternIndexForClaim(cardState, claimNumbers, patternMasks, drawnNumbers);
                if (localPatternIndex >= 0)
                {
                    matchedPatterns.Add(localPatternIndex);
                }
            }
        }

        return winningPatterns;
    }

    private JSONNode ResolveCurrentPlayerVisibleTicketNodes(JSONNode currentGame, int visibleCardCount)
    {
        if (currentGame == null || currentGame.IsNull || string.IsNullOrWhiteSpace(activePlayerId))
        {
            return null;
        }

        JSONNode playerTickets = currentGame["tickets"]?[activePlayerId];
        if (playerTickets == null || playerTickets.IsNull || !playerTickets.IsArray)
        {
            return null;
        }

        return playerTickets;
    }

    private JSONNode ResolveVisibleTicketNodeForCard(JSONNode playerTicketsNode, int cardIndex, int cardSlots)
    {
        if (playerTicketsNode == null || playerTicketsNode.IsNull || !playerTicketsNode.IsArray || cardIndex < 0)
        {
            return null;
        }

        int resolvedCardSlots = Mathf.Max(1, cardSlots);
        int pageStartIndex = Mathf.Max(0, currentTicketPage) * resolvedCardSlots;
        int ticketIndex = pageStartIndex + cardIndex;
        if (ticketIndex < playerTicketsNode.Count)
        {
            return playerTicketsNode[ticketIndex];
        }

        if (duplicateTicketAcrossAllCards && playerTicketsNode.Count == 1)
        {
            return playerTicketsNode[0];
        }

        return null;
    }

    private static int FindBestLocalPatternIndexForClaim(
        Theme1CardRenderState cardState,
        IReadOnlyList<int> claimNumbers,
        IReadOnlyList<byte[]> patternMasks,
        HashSet<int> drawnNumbers)
    {
        if (cardState?.Cells == null || claimNumbers == null || claimNumbers.Count == 0 || patternMasks == null)
        {
            return -1;
        }

        int[] cardNumbers = ExtractPositiveCardNumbers(cardState);
        HashSet<int> claimNumberSet = new HashSet<int>(claimNumbers);
        int bestPatternIndex = -1;
        int bestScore = int.MinValue;

        for (int patternIndex = 0; patternIndex < patternMasks.Count; patternIndex++)
        {
            List<int> localPatternNumbers = ExtractPatternNumbers(cardNumbers, patternMasks[patternIndex]);
            if (localPatternNumbers.Count == 0)
            {
                continue;
            }

            int overlap = 0;
            bool allDrawn = true;
            HashSet<int> localPatternSet = new HashSet<int>();
            for (int i = 0; i < localPatternNumbers.Count; i++)
            {
                int number = localPatternNumbers[i];
                localPatternSet.Add(number);
                if (claimNumberSet.Contains(number))
                {
                    overlap += 1;
                }

                if (number <= 0 || drawnNumbers == null || !drawnNumbers.Contains(number))
                {
                    allDrawn = false;
                }
            }

            if (overlap <= 0)
            {
                continue;
            }

            bool exact = localPatternSet.SetEquals(claimNumberSet);
            int sizeDelta = Math.Abs(localPatternSet.Count - claimNumberSet.Count);
            int score = 0;
            if (exact)
            {
                score += 10000;
            }

            if (allDrawn)
            {
                score += 1000;
            }

            score += overlap * 100;
            score -= sizeDelta * 10;
            score -= patternIndex;

            if (score > bestScore)
            {
                bestScore = score;
                bestPatternIndex = patternIndex;
            }
        }

        return bestPatternIndex;
    }

    private static int[] ExtractPositiveCardNumbers(Theme1CardRenderState cardState)
    {
        int[] values = new int[cardState?.Cells != null ? cardState.Cells.Length : 0];
        if (cardState?.Cells == null)
        {
            return values;
        }

        for (int cellIndex = 0; cellIndex < cardState.Cells.Length; cellIndex++)
        {
            values[cellIndex] = TryParsePositiveInt(cardState.Cells[cellIndex].NumberLabel);
        }

        return values;
    }

    private static List<int> ExtractPatternNumbers(int[] cardNumbers, byte[] mask)
    {
        List<int> numbers = new List<int>();
        if (cardNumbers == null || mask == null)
        {
            return numbers;
        }

        int cellCount = Mathf.Min(cardNumbers.Length, mask.Length);
        for (int cellIndex = 0; cellIndex < cellCount; cellIndex++)
        {
            if (mask[cellIndex] != 1)
            {
                continue;
            }

            int number = cardNumbers[cellIndex];
            if (number > 0)
            {
                numbers.Add(number);
            }
        }

        return numbers;
    }

    private static void ApplyWinningPatternsToDedicatedState(
        Theme1DisplayState renderState,
        Dictionary<int, HashSet<int>> winningPatternsByCard,
        IReadOnlyList<byte[]> patternMasks)
    {
        if (renderState?.Cards == null || winningPatternsByCard == null)
        {
            return;
        }

        for (int cardIndex = 0; cardIndex < renderState.Cards.Length; cardIndex++)
        {
            Theme1CardRenderState cardState = renderState.Cards[cardIndex];
            if (cardState == null ||
                !winningPatternsByCard.TryGetValue(cardIndex, out HashSet<int> matchedPatterns) ||
                matchedPatterns == null ||
                matchedPatterns.Count == 0)
            {
                continue;
            }

            int paylineCount = Mathf.Max(cardState.PaylinesActive != null ? cardState.PaylinesActive.Length : 0, patternMasks != null ? patternMasks.Count : 0);
            bool[] paylines = new bool[paylineCount];
            if (cardState.PaylinesActive != null && cardState.PaylinesActive.Length > 0)
            {
                Array.Copy(cardState.PaylinesActive, paylines, Mathf.Min(cardState.PaylinesActive.Length, paylines.Length));
            }

            foreach (int patternIndex in matchedPatterns)
            {
                if (patternIndex >= 0 && patternIndex < paylines.Length)
                {
                    paylines[patternIndex] = true;
                }
            }

            cardState.PaylinesActive = paylines;
            cardState.MatchedPatternIndexes = new int[matchedPatterns.Count];
            matchedPatterns.CopyTo(cardState.MatchedPatternIndexes);
            Array.Sort(cardState.MatchedPatternIndexes);
            cardState.CompletedPatterns = BuildDedicatedCompletedPatterns(cardState, matchedPatterns, patternMasks, renderState.Topper);
            int cardWinAmount = ResolveCardCompletedPatternWinnings(cardState.CompletedPatterns);
            cardState.WinLabel = Theme1CardLabelPolicy.ResolveWinLabel(
                gameManager: null,
                cardWinAmount,
                string.Empty,
                out bool showWinLabel);
            cardState.ShowWinLabel = showWinLabel;
            if (cardState.ActiveNearPattern != null && matchedPatterns.Contains(cardState.ActiveNearPattern.RawPatternIndex))
            {
                cardState.ActiveNearPattern = null;
            }

            if (cardState.Cells == null)
            {
                continue;
            }

            for (int cellIndex = 0; cellIndex < cardState.Cells.Length; cellIndex++)
            {
                Theme1CardCellRenderState cell = cardState.Cells[cellIndex];
                bool isMatched = IsCellMatchedByPatternMasks(cellIndex, matchedPatterns, patternMasks);
                bool isNearTargetCell = cardState.ActiveNearPattern != null && cardState.ActiveNearPattern.TargetCellIndex == cellIndex;
                bool isMatchedByActiveNearPattern = cardState.ActiveNearPattern != null && ContainsCell(cardState.ActiveNearPattern.MatchedCellIndices, cellIndex);
                Theme1CellPrizeLabelRenderState[] prizeLabels = BuildCellPrizeLabels(
                    cardState.CompletedPatterns,
                    cardState.ActiveNearPattern,
                    cellIndex);
                bool isPrizeCell = HasCompletedPrizeLabel(cardState.CompletedPatterns, cellIndex);
                int[] completedPatternIndexes = ExtractCompletedPatternIndexes(cardState.CompletedPatterns, cellIndex);
                int[] nearWinPatternIndexes = isNearTargetCell && cardState.ActiveNearPattern != null
                    ? new[] { cardState.ActiveNearPattern.RawPatternIndex }
                    : cell.NearWinPatternIndexes;

                Theme1CardCellVisualState visualState = ResolveDedicatedCellVisualState(
                    isPrizeCell,
                    isNearTargetCell,
                    isMatched,
                    isMatchedByActiveNearPattern);

                cardState.Cells[cellIndex] = new Theme1CardCellRenderState(
                    cell.NumberLabel,
                    cell.IsSelected,
                    isNearTargetCell,
                    isMatched,
                    nearWinPatternIndexes != null && nearWinPatternIndexes.Length > 0 ? nearWinPatternIndexes[0] : -1,
                    isNearTargetCell && cardState.ActiveNearPattern != null ? cardState.ActiveNearPattern.TargetNumber : cell.MissingNumber,
                    nearWinPatternIndexes,
                    visualState,
                    isPrizeCell,
                    isNearTargetCell,
                    prizeLabels.Length > 0 ? prizeLabels[0].Text : string.Empty,
                    prizeLabels.Length > 0 ? prizeLabels[0].Anchor : Theme1WinLabelAnchor.BottomCenter,
                    completedPatternIndexes,
                    prizeLabels);
            }
        }

        if (renderState.Topper?.Slots == null)
        {
            return;
        }

        for (int slotIndex = 0; slotIndex < renderState.Topper.Slots.Length; slotIndex++)
        {
            Theme1TopperSlotRenderState slotState = renderState.Topper.Slots[slotIndex];
            if (slotState == null)
            {
                continue;
            }

            bool isMatched = false;
            foreach (KeyValuePair<int, HashSet<int>> entry in winningPatternsByCard)
            {
                if (entry.Value == null)
                {
                    continue;
                }

                foreach (int patternIndex in entry.Value)
                {
                    if (GameManager.ResolvePayoutSlotIndex(patternIndex, renderState.Topper.Slots.Length) == slotIndex)
                    {
                        isMatched = true;
                        break;
                    }
                }

                if (isMatched)
                {
                    break;
                }
            }

            if (!isMatched)
            {
                continue;
            }

            slotState.ShowMatchedPattern = true;
            slotState.ShowPattern = true;
            slotState.MissingCellsVisible = Array.Empty<bool>();
            slotState.PrizeVisualState = Theme1PrizeVisualState.Matched;
            if (winningPatternsByCard != null)
            {
                HashSet<int> activeCardIndexes = new HashSet<int>();
                HashSet<int> activePatternIndexes = new HashSet<int>();
                foreach (KeyValuePair<int, HashSet<int>> entry in winningPatternsByCard)
                {
                    if (entry.Value == null)
                    {
                        continue;
                    }

                    foreach (int patternIndex in entry.Value)
                    {
                        if (GameManager.ResolvePayoutSlotIndex(patternIndex, renderState.Topper.Slots.Length) == slotIndex)
                        {
                            activeCardIndexes.Add(entry.Key);
                            activePatternIndexes.Add(patternIndex);
                        }
                    }
                }

                slotState.ActiveCardIndexes = ToSortedArray(activeCardIndexes);
                slotState.ActivePatternIndexes = ToSortedArray(activePatternIndexes);
            }
        }
    }

    private static int ResolveCardCompletedPatternWinnings(IReadOnlyList<Theme1CompletedPatternRenderState> completedPatterns)
    {
        if (completedPatterns == null || completedPatterns.Count == 0)
        {
            return 0;
        }

        int total = 0;
        for (int i = 0; i < completedPatterns.Count; i++)
        {
            Theme1CompletedPatternRenderState pattern = completedPatterns[i];
            if (pattern == null)
            {
                continue;
            }

            total += Mathf.Max(0, pattern.PrizeAmountKr);
        }

        return total;
    }

    private static int ResolveRenderStateCompletedPatternWinnings(Theme1DisplayState renderState)
    {
        if (renderState?.Cards == null)
        {
            return 0;
        }

        int total = 0;
        for (int cardIndex = 0; cardIndex < renderState.Cards.Length; cardIndex++)
        {
            total += ResolveCardCompletedPatternWinnings(renderState.Cards[cardIndex]?.CompletedPatterns);
        }

        return total;
    }

    private static Dictionary<int, HashSet<int>> MergeWinningPatternsByCard(
        Dictionary<int, HashSet<int>> primary,
        Dictionary<int, HashSet<int>> secondary)
    {
        if (primary == null || primary.Count == 0)
        {
            return secondary ?? new Dictionary<int, HashSet<int>>();
        }

        if (secondary == null || secondary.Count == 0)
        {
            return primary;
        }

        foreach (KeyValuePair<int, HashSet<int>> entry in secondary)
        {
            if (!primary.TryGetValue(entry.Key, out HashSet<int> mergedPatterns) || mergedPatterns == null)
            {
                primary[entry.Key] = entry.Value != null ? new HashSet<int>(entry.Value) : new HashSet<int>();
                continue;
            }

            if (entry.Value == null)
            {
                continue;
            }

            foreach (int patternIndex in entry.Value)
            {
                mergedPatterns.Add(patternIndex);
            }
        }

        return primary;
    }

    private void SyncLegacyTheme1MatchedPaylines(Dictionary<int, HashSet<int>> winningPatternsByCard)
    {
        NumberGenerator generator = ResolveNumberGenerator();
        if (generator?.cardClasses == null)
        {
            return;
        }

        bool shouldDriveContractPaylines = theme1RealtimeViewMode == Theme1RealtimeViewMode.DedicatedOnly;
        Theme1GameplayViewRoot viewRoot = null;
        GameObject[][] contractPaylineObjectsByCard = null;
        if (shouldDriveContractPaylines &&
            TryResolveTheme1GameplayViewContract(out viewRoot) &&
            viewRoot?.Cards != null &&
            viewRoot.Cards.Length > 0)
        {
            contractPaylineObjectsByCard = new GameObject[viewRoot.Cards.Length][];
            for (int cardIndex = 0; cardIndex < viewRoot.Cards.Length; cardIndex++)
            {
                contractPaylineObjectsByCard[cardIndex] = viewRoot.Cards[cardIndex]?.PaylineObjects;
            }
        }

        for (int cardIndex = 0; cardIndex < generator.cardClasses.Length; cardIndex++)
        {
            CardClass card = generator.cardClasses[cardIndex];
            if (card == null || card.paylineObj == null)
            {
                continue;
            }

            RealtimePaylineUtils.EnsurePaylineIndexCapacity(card, card.paylineObj.Count);
            bool[] matchedFlags = new bool[card.paylineObj.Count];
            if (winningPatternsByCard != null && winningPatternsByCard.TryGetValue(cardIndex, out HashSet<int> matchedPatterns) && matchedPatterns != null)
            {
                foreach (int patternIndex in matchedPatterns)
                {
                    if (patternIndex >= 0 && patternIndex < matchedFlags.Length)
                    {
                        matchedFlags[patternIndex] = true;
                    }
                }
            }

            for (int patternIndex = 0; patternIndex < card.paylineObj.Count; patternIndex++)
            {
                bool matched = matchedFlags[patternIndex];
                card.paylineindex[patternIndex] = matched;

                GameObject paylineObject = card.paylineObj[patternIndex];
                if (shouldDriveContractPaylines &&
                    IsAuthoritativeDedicatedPayline(contractPaylineObjectsByCard, cardIndex, paylineObject))
                {
                    // The Theme1 production contract is authoritative for which payline objects belong
                    // to the dedicated view, regardless of legacy scene naming.
                    SetActiveIfChanged(paylineObject, matched);
                    continue;
                }

                // Non-dedicated legacy lines should never become visible in the dedicated view.
                SetActiveIfChanged(paylineObject, false);
            }
        }
    }

    private static bool IsAuthoritativeDedicatedPayline(
        IReadOnlyList<GameObject[]> contractPaylineObjectsByCard,
        int cardIndex,
        GameObject paylineObject)
    {
        if (paylineObject == null ||
            contractPaylineObjectsByCard == null ||
            cardIndex < 0 ||
            cardIndex >= contractPaylineObjectsByCard.Count)
        {
            return false;
        }

        GameObject[] contractPaylines = contractPaylineObjectsByCard[cardIndex];
        if (contractPaylines == null)
        {
            return false;
        }

        for (int i = 0; i < contractPaylines.Length; i++)
        {
            if (contractPaylines[i] == paylineObject)
            {
                return true;
            }
        }

        return false;
    }

    private static bool IsCellMatchedByPatternMasks(
        int cellIndex,
        HashSet<int> matchedPatterns,
        IReadOnlyList<byte[]> patternMasks)
    {
        if (cellIndex < 0 || matchedPatterns == null || matchedPatterns.Count == 0 || patternMasks == null)
        {
            return false;
        }

        foreach (int patternIndex in matchedPatterns)
        {
            if (patternIndex < 0 || patternIndex >= patternMasks.Count)
            {
                continue;
            }

            byte[] mask = patternMasks[patternIndex];
            if (mask != null && cellIndex < mask.Length && mask[cellIndex] == 1)
            {
                return true;
            }
        }

        return false;
    }

    private static Theme1CompletedPatternRenderState[] BuildDedicatedCompletedPatterns(
        Theme1CardRenderState cardState,
        HashSet<int> matchedPatterns,
        IReadOnlyList<byte[]> patternMasks,
        Theme1TopperRenderState topperState)
    {
        if (matchedPatterns == null || matchedPatterns.Count == 0)
        {
            return Array.Empty<Theme1CompletedPatternRenderState>();
        }

        List<Theme1CompletedPatternRenderState> completed = new List<Theme1CompletedPatternRenderState>(matchedPatterns.Count);
        foreach (int rawPatternIndex in matchedPatterns)
        {
            Theme1CompletedPatternRenderState existing = FindCompletedPattern(cardState?.CompletedPatterns, rawPatternIndex);
            if (existing != null)
            {
                completed.Add(existing);
                continue;
            }

            int[] cellIndices = ExtractPatternCells(patternMasks, rawPatternIndex);
            if (cellIndices.Length == 0)
            {
                continue;
            }

            int slotIndex = ResolvePatternSlotIndex(rawPatternIndex, topperState?.Slots?.Length ?? 0);
            string prizeLabel = ResolveDedicatedPrizeLabel(cardState, topperState, rawPatternIndex, slotIndex);
            int prizeAmount = TryParsePrizeAmount(prizeLabel);
            int triggerCellIndex = ResolveDedicatedTriggerCellIndex(cardState, rawPatternIndex, cellIndices);
            completed.Add(new Theme1CompletedPatternRenderState
            {
                RawPatternIndex = rawPatternIndex,
                SlotIndex = slotIndex,
                CellIndices = cellIndices,
                TriggerCellIndex = triggerCellIndex,
                TriggerNumber = ResolveCellNumber(cardState, triggerCellIndex),
                PrizeAmountKr = prizeAmount,
                PrizeLabel = prizeLabel,
                PrizeAnchor = ResolvePrizeAnchor(triggerCellIndex),
                OverlayKind = ResolveOverlayKind(rawPatternIndex, cellIndices)
            });
        }

        completed.Sort((left, right) =>
        {
            int leftSlot = left != null ? left.SlotIndex : int.MaxValue;
            int rightSlot = right != null ? right.SlotIndex : int.MaxValue;
            int slotCompare = leftSlot.CompareTo(rightSlot);
            if (slotCompare != 0)
            {
                return slotCompare;
            }

            int leftPattern = left != null ? left.RawPatternIndex : int.MaxValue;
            int rightPattern = right != null ? right.RawPatternIndex : int.MaxValue;
            return leftPattern.CompareTo(rightPattern);
        });
        return completed.ToArray();
    }

    private static Theme1CompletedPatternRenderState FindCompletedPattern(
        IReadOnlyList<Theme1CompletedPatternRenderState> completedPatterns,
        int rawPatternIndex)
    {
        if (completedPatterns == null)
        {
            return null;
        }

        for (int i = 0; i < completedPatterns.Count; i++)
        {
            Theme1CompletedPatternRenderState pattern = completedPatterns[i];
            if (pattern != null && pattern.RawPatternIndex == rawPatternIndex)
            {
                return pattern;
            }
        }

        return null;
    }

    private static string ResolveDedicatedPrizeLabel(
        Theme1CardRenderState cardState,
        Theme1TopperRenderState topperState,
        int rawPatternIndex,
        int slotIndex)
    {
        if (cardState?.ActiveNearPattern != null && cardState.ActiveNearPattern.RawPatternIndex == rawPatternIndex)
        {
            return cardState.ActiveNearPattern.PrizeLabel ?? string.Empty;
        }

        if (topperState?.Slots != null && slotIndex >= 0 && slotIndex < topperState.Slots.Length)
        {
            return topperState.Slots[slotIndex]?.PrizeLabel ?? string.Empty;
        }

        return string.Empty;
    }

    private static int ResolveDedicatedTriggerCellIndex(
        Theme1CardRenderState cardState,
        int rawPatternIndex,
        IReadOnlyList<int> cellIndices)
    {
        if (cardState?.ActiveNearPattern != null &&
            cardState.ActiveNearPattern.RawPatternIndex == rawPatternIndex &&
            ContainsCell(cellIndices, cardState.ActiveNearPattern.TargetCellIndex))
        {
            return cardState.ActiveNearPattern.TargetCellIndex;
        }

        if (cardState?.Cells != null)
        {
            for (int i = 0; i < cardState.Cells.Length; i++)
            {
                Theme1CardCellRenderState cell = cardState.Cells[i];
                if ((cell.PrizeLabels != null && cell.PrizeLabels.Length > 0 || !string.IsNullOrWhiteSpace(cell.PrizeLabel)) &&
                    ContainsCell(cellIndices, i))
                {
                    return i;
                }
            }
        }

        return cellIndices != null && cellIndices.Count > 0 ? cellIndices[cellIndices.Count - 1] : -1;
    }

    private static int ResolveCellNumber(Theme1CardRenderState cardState, int cellIndex)
    {
        if (cardState?.Cells == null || cellIndex < 0 || cellIndex >= cardState.Cells.Length)
        {
            return 0;
        }

        return TryParsePositiveInt(cardState.Cells[cellIndex].NumberLabel);
    }

    private static int[] ExtractPatternCells(IReadOnlyList<byte[]> patternMasks, int rawPatternIndex)
    {
        if (patternMasks == null || rawPatternIndex < 0 || rawPatternIndex >= patternMasks.Count)
        {
            return Array.Empty<int>();
        }

        byte[] mask = patternMasks[rawPatternIndex];
        if (mask == null || mask.Length == 0)
        {
            return Array.Empty<int>();
        }

        List<int> values = new List<int>(mask.Length);
        for (int cellIndex = 0; cellIndex < mask.Length; cellIndex++)
        {
            if (mask[cellIndex] == 1)
            {
                values.Add(cellIndex);
            }
        }

        return values.Count > 0 ? values.ToArray() : Array.Empty<int>();
    }

    private static int ResolvePatternSlotIndex(int rawPatternIndex, int topperCount)
    {
        return GameManager.ResolvePayoutSlotIndex(rawPatternIndex, topperCount);
    }

    private static Theme1WinLabelAnchor ResolvePrizeAnchor(int cellIndex)
    {
        if (cellIndex < 0)
        {
            return Theme1WinLabelAnchor.BottomCenter;
        }

        int column = cellIndex / 3;
        return column switch
        {
            0 => Theme1WinLabelAnchor.BottomLeft,
            4 => Theme1WinLabelAnchor.BottomRight,
            _ => Theme1WinLabelAnchor.BottomCenter
        };
    }

    private static Theme1PatternOverlayKind ResolveOverlayKind(int rawPatternIndex, IReadOnlyList<int> cellIndices)
    {
        if (cellIndices == null || cellIndices.Count == 0)
        {
            return Theme1PatternOverlayKind.None;
        }

        if (IsSingleRowPattern(cellIndices))
        {
            return Theme1PatternOverlayKind.HorizontalLine;
        }

        if (rawPatternIndex >= 0 && rawPatternIndex < 16 && cellIndices.Count <= 6)
        {
            return Theme1PatternOverlayKind.SvgStroke;
        }

        return Theme1PatternOverlayKind.SvgMask;
    }

    private static bool IsSingleRowPattern(IReadOnlyList<int> cellIndices)
    {
        if (cellIndices == null || cellIndices.Count == 0)
        {
            return false;
        }

        int row = cellIndices[0] % 3;
        for (int i = 1; i < cellIndices.Count; i++)
        {
            if (cellIndices[i] % 3 != row)
            {
                return false;
            }
        }

        return cellIndices.Count >= 5;
    }

    private static bool HasCompletedPrizeLabel(
        IReadOnlyList<Theme1CompletedPatternRenderState> completedPatterns,
        int cellIndex)
    {
        if (completedPatterns == null || completedPatterns.Count == 0)
        {
            return false;
        }

        for (int i = 0; i < completedPatterns.Count; i++)
        {
            Theme1CompletedPatternRenderState pattern = completedPatterns[i];
            if (pattern != null && pattern.TriggerCellIndex == cellIndex)
            {
                return true;
            }
        }

        return false;
    }

    private static Theme1CellPrizeLabelRenderState[] BuildCellPrizeLabels(
        IReadOnlyList<Theme1CompletedPatternRenderState> completedPatterns,
        Theme1NearPatternRenderState activeNearPattern,
        int cellIndex)
    {
        List<Theme1CellPrizeLabelRenderState> labels = new List<Theme1CellPrizeLabelRenderState>();
        if (completedPatterns != null)
        {
            List<Theme1CompletedPatternRenderState> triggerPatterns = new List<Theme1CompletedPatternRenderState>();
            for (int i = 0; i < completedPatterns.Count; i++)
            {
                Theme1CompletedPatternRenderState pattern = completedPatterns[i];
                if (pattern != null && pattern.TriggerCellIndex == cellIndex)
                {
                    triggerPatterns.Add(pattern);
                }
            }

            triggerPatterns.Sort(CompareCompletedPatternPrizePriority);
            for (int i = 0; i < triggerPatterns.Count; i++)
            {
                Theme1CompletedPatternRenderState pattern = triggerPatterns[i];
                labels.Add(new Theme1CellPrizeLabelRenderState(
                    pattern.PrizeLabel,
                    pattern.PrizeAnchor,
                    pattern.PrizeAmountKr,
                    pattern.RawPatternIndex));
            }
        }

        if (labels.Count == 0 &&
            activeNearPattern != null &&
            activeNearPattern.TargetCellIndex == cellIndex &&
            !string.IsNullOrWhiteSpace(activeNearPattern.PrizeLabel))
        {
            labels.Add(new Theme1CellPrizeLabelRenderState(
                activeNearPattern.PrizeLabel,
                activeNearPattern.PrizeAnchor,
                activeNearPattern.PrizeAmountKr,
                activeNearPattern.RawPatternIndex));
        }

        return labels.Count > 0 ? labels.ToArray() : Array.Empty<Theme1CellPrizeLabelRenderState>();
    }

    private static int CompareCompletedPatternPrizePriority(
        Theme1CompletedPatternRenderState left,
        Theme1CompletedPatternRenderState right)
    {
        int leftPrize = left != null ? left.PrizeAmountKr : int.MinValue;
        int rightPrize = right != null ? right.PrizeAmountKr : int.MinValue;
        int prizeCompare = rightPrize.CompareTo(leftPrize);
        if (prizeCompare != 0)
        {
            return prizeCompare;
        }

        int leftPattern = left != null ? left.RawPatternIndex : int.MaxValue;
        int rightPattern = right != null ? right.RawPatternIndex : int.MaxValue;
        return leftPattern.CompareTo(rightPattern);
    }

    private static int[] ExtractCompletedPatternIndexes(
        IReadOnlyList<Theme1CompletedPatternRenderState> completedPatterns,
        int cellIndex)
    {
        if (completedPatterns == null || completedPatterns.Count == 0)
        {
            return Array.Empty<int>();
        }

        List<int> values = new List<int>();
        for (int i = 0; i < completedPatterns.Count; i++)
        {
            Theme1CompletedPatternRenderState pattern = completedPatterns[i];
            if (pattern != null && ContainsCell(pattern.CellIndices, cellIndex))
            {
                values.Add(pattern.RawPatternIndex);
            }
        }

        return values.Count > 0 ? values.ToArray() : Array.Empty<int>();
    }

    private static bool ContainsCell(IReadOnlyList<int> cellIndices, int cellIndex)
    {
        if (cellIndices == null)
        {
            return false;
        }

        for (int i = 0; i < cellIndices.Count; i++)
        {
            if (cellIndices[i] == cellIndex)
            {
                return true;
            }
        }

        return false;
    }

    private static Theme1CardCellVisualState ResolveDedicatedCellVisualState(
        bool isPrizeCell,
        bool isNearTargetCell,
        bool isMatchedByCompletedPattern,
        bool isMatchedByActiveNearPattern)
    {
        if (isPrizeCell)
        {
            return Theme1CardCellVisualState.WonPrize;
        }

        if (isNearTargetCell)
        {
            return Theme1CardCellVisualState.NearTarget;
        }

        if (isMatchedByCompletedPattern)
        {
            return Theme1CardCellVisualState.WonHit;
        }

        if (isMatchedByActiveNearPattern)
        {
            return Theme1CardCellVisualState.NearHit;
        }

        return Theme1CardCellVisualState.Normal;
    }

    private static int TryParsePrizeAmount(string prizeLabel)
    {
        if (string.IsNullOrWhiteSpace(prizeLabel))
        {
            return 0;
        }

        string digits = string.Empty;
        for (int i = 0; i < prizeLabel.Length; i++)
        {
            char current = prizeLabel[i];
            if (char.IsDigit(current))
            {
                digits += current;
            }
        }

        return int.TryParse(digits, out int parsed) ? parsed : 0;
    }
}
