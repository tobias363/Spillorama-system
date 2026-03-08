using System;
using System.Collections.Generic;
using UnityEngine;

public sealed class Theme1StateBuilder
{
    private readonly struct NearWinCandidate
    {
        public NearWinCandidate(int rawPatternIndex, int slotIndex, int cardIndex, int cellIndex, int payoutAmount)
        {
            RawPatternIndex = rawPatternIndex;
            SlotIndex = slotIndex;
            CardIndex = cardIndex;
            CellIndex = cellIndex;
            PayoutAmount = payoutAmount;
        }

        public int RawPatternIndex { get; }
        public int SlotIndex { get; }
        public int CardIndex { get; }
        public int CellIndex { get; }
        public int PayoutAmount { get; }
    }

    public Theme1RoundRenderState Build(Theme1StateBuildInput input)
    {
        int cardCount = Mathf.Max(0, input?.CardSlotCount ?? 0);
        int topperCount = Mathf.Max(0, input?.TopperPrizeLabels?.Length ?? 0);
        Theme1RoundRenderState state = Theme1RoundRenderState.CreateEmpty(
            cardCount,
            Mathf.Max(0, input?.BallSlotCount ?? 0),
            topperCount);
        if (input == null)
        {
            return state;
        }

        state.GameId = input.GameId ?? string.Empty;
        int[] validDrawnNumbers = ExtractValidDrawnNumbers(input.DrawnNumbers);
        HashSet<int> drawnNumbers = BuildDrawnNumberSet(validDrawnNumbers);
        int[][] visibleTickets = ResolveVisibleTickets(input);

        HashSet<int>[] matchedPatternsByCard = BuildMatchedPatternsByCard(
            visibleTickets,
            drawnNumbers,
            input.ActivePatternIndexes,
            input.PatternMasks);

        Dictionary<(int cardIndex, int cellIndex), NearWinCandidate> nearWinsByCardCell =
            BuildNearWinsByCardCell(
                visibleTickets,
                drawnNumbers,
                input.ActivePatternIndexes,
                input.PatternMasks,
                input.TopperPayoutAmounts,
                topperCount);

        Dictionary<int, NearWinCandidate> nearWinsByTopperSlot =
            BuildNearWinsByTopperSlot(
                visibleTickets,
                drawnNumbers,
                input.ActivePatternIndexes,
                input.PatternMasks,
                input.TopperPayoutAmounts,
                topperCount);

        for (int cardIndex = 0; cardIndex < state.Cards.Length; cardIndex++)
        {
            Theme1CardRenderState cardState = Theme1CardRenderState.CreateEmpty();
            cardState.PaylinesActive = new bool[input.PatternMasks != null ? input.PatternMasks.Length : 0];

            int[] ticket = cardIndex < visibleTickets.Length ? visibleTickets[cardIndex] : null;
            HashSet<int> matchedPatterns = cardIndex < matchedPatternsByCard.Length
                ? matchedPatternsByCard[cardIndex]
                : null;
            int cardWinAmount = ResolveCardWinAmount(matchedPatterns, input.TopperPayoutAmounts);
            cardState.HeaderLabel = GetNonEmptyString(
                input.CardHeaderLabels,
                cardIndex,
                GameManager.FormatTheme1CardHeaderLabel(cardIndex));
            cardState.BetLabel = GetNonEmptyString(
                input.CardBetLabels,
                cardIndex,
                GameManager.FormatTheme1CardStakeLabel(0));
            cardState.WinLabel = cardWinAmount > 0
                ? FormatCardWinLabel(cardWinAmount)
                : GetNonEmptyString(input.CardWinLabels, cardIndex, string.Empty);
            cardState.ShowWinLabel = cardWinAmount > 0;

            for (int cellIndex = 0; cellIndex < cardState.Cells.Length; cellIndex++)
            {
                int number = ticket != null && cellIndex < ticket.Length
                    ? NormalizeTheme1Number(ticket[cellIndex])
                    : 0;
                bool isSelected = number > 0 && drawnNumbers.Contains(number);
                bool isMatched = IsCellMatched(cellIndex, matchedPatterns, input.PatternMasks);
                bool isMissing = nearWinsByCardCell.TryGetValue((cardIndex, cellIndex), out NearWinCandidate nearWinCandidate);
                cardState.Cells[cellIndex] = new Theme1CardCellRenderState(
                    number > 0 ? number.ToString() : "-",
                    isSelected,
                    isMissing,
                    isMatched,
                    isMissing ? nearWinCandidate.RawPatternIndex : -1,
                    isMissing ? number : 0);
            }

            for (int patternListIndex = 0; patternListIndex < cardState.PaylinesActive.Length; patternListIndex++)
            {
                int rawPatternIndex = patternListIndex;
                cardState.PaylinesActive[patternListIndex] = matchedPatterns != null && matchedPatterns.Contains(rawPatternIndex);
            }

            if (matchedPatterns != null && matchedPatterns.Count > 0)
            {
                cardState.MatchedPatternIndexes = new int[matchedPatterns.Count];
                matchedPatterns.CopyTo(cardState.MatchedPatternIndexes);
                Array.Sort(cardState.MatchedPatternIndexes);
            }
            else
            {
                cardState.MatchedPatternIndexes = Array.Empty<int>();
            }

            state.Cards[cardIndex] = cardState;
        }

        PopulateBallRack(state.BallRack, validDrawnNumbers, input.BallSlotCount);
        PopulateHud(state.Hud, input);
        PopulateTopper(state.Topper, input, matchedPatternsByCard, nearWinsByTopperSlot);
        return state;
    }

    private static int ResolveCardWinAmount(IReadOnlyCollection<int> matchedPatterns, IReadOnlyList<int> payoutAmounts)
    {
        if (matchedPatterns == null || matchedPatterns.Count == 0 || payoutAmounts == null || payoutAmounts.Count == 0)
        {
            return 0;
        }

        int total = 0;
        foreach (int rawPatternIndex in matchedPatterns)
        {
            int slotIndex = GameManager.ResolvePayoutSlotIndex(rawPatternIndex, payoutAmounts.Count);
            if (slotIndex >= 0 && slotIndex < payoutAmounts.Count)
            {
                total += Mathf.Max(0, payoutAmounts[slotIndex]);
            }
        }

        return total;
    }

    private static string FormatCardWinLabel(int amount)
    {
        return GameManager.FormatTheme1CardWinLabel(amount);
    }

    private static int[] ExtractValidDrawnNumbers(IReadOnlyList<int> drawnNumbers)
    {
        if (drawnNumbers == null || drawnNumbers.Count == 0)
        {
            return Array.Empty<int>();
        }

        List<int> validValues = new List<int>(drawnNumbers.Count);
        for (int i = 0; i < drawnNumbers.Count; i++)
        {
            int normalized = NormalizeTheme1Number(drawnNumbers[i]);
            if (normalized > 0)
            {
                validValues.Add(normalized);
            }
        }

        return validValues.ToArray();
    }

    private static HashSet<int> BuildDrawnNumberSet(IReadOnlyList<int> drawnNumbers)
    {
        HashSet<int> values = new HashSet<int>();
        if (drawnNumbers == null)
        {
            return values;
        }

        for (int i = 0; i < drawnNumbers.Count; i++)
        {
            int value = NormalizeTheme1Number(drawnNumbers[i]);
            if (value > 0)
            {
                values.Add(value);
            }
        }

        return values;
    }

    private static int[][] ResolveVisibleTickets(Theme1StateBuildInput input)
    {
        int cardCount = Mathf.Max(0, input.CardSlotCount);
        int[][] visibleTickets = new int[cardCount][];
        int ticketCount = input.TicketSets != null ? input.TicketSets.Length : 0;
        int pageStartIndex = Mathf.Max(0, input.CurrentTicketPage) * Mathf.Max(1, cardCount);

        for (int cardIndex = 0; cardIndex < cardCount; cardIndex++)
        {
            int ticketIndex = pageStartIndex + cardIndex;
            int[] source = null;
            if (ticketIndex < ticketCount)
            {
                source = input.TicketSets[ticketIndex];
            }
            else if (ticketCount == 1 && input.DuplicateSingleTicketAcrossCards)
            {
                source = input.TicketSets[0];
            }

            visibleTickets[cardIndex] = NormalizeTicket(source);
        }

        return visibleTickets;
    }

    private static int[] NormalizeTicket(int[] source)
    {
        int[] normalized = new int[15];
        if (source == null)
        {
            return normalized;
        }

        int limit = Mathf.Min(15, source.Length);
        for (int i = 0; i < limit; i++)
        {
            normalized[i] = NormalizeTheme1Number(source[i]);
        }

        return normalized;
    }

    private static HashSet<int>[] BuildMatchedPatternsByCard(
        int[][] visibleTickets,
        HashSet<int> drawnNumbers,
        IReadOnlyList<int> activePatternIndexes,
        IReadOnlyList<byte[]> patternMasks)
    {
        HashSet<int>[] results = new HashSet<int>[visibleTickets.Length];
        for (int cardIndex = 0; cardIndex < results.Length; cardIndex++)
        {
            results[cardIndex] = new HashSet<int>();
        }

        if (activePatternIndexes == null || patternMasks == null)
        {
            return results;
        }

        for (int i = 0; i < activePatternIndexes.Count; i++)
        {
            int rawPatternIndex = activePatternIndexes[i];
            if (rawPatternIndex < 0 || rawPatternIndex >= patternMasks.Count)
            {
                continue;
            }

            byte[] mask = patternMasks[rawPatternIndex];
            if (mask == null || mask.Length == 0)
            {
                continue;
            }

            for (int cardIndex = 0; cardIndex < visibleTickets.Length; cardIndex++)
            {
                int[] ticket = visibleTickets[cardIndex];
                if (ticket == null)
                {
                    continue;
                }

                if (IsPatternMatched(ticket, drawnNumbers, mask))
                {
                    results[cardIndex].Add(rawPatternIndex);
                }
            }
        }

        return results;
    }

    private static Dictionary<(int cardIndex, int cellIndex), NearWinCandidate> BuildNearWinsByCardCell(
        int[][] visibleTickets,
        HashSet<int> drawnNumbers,
        IReadOnlyList<int> activePatternIndexes,
        IReadOnlyList<byte[]> patternMasks,
        IReadOnlyList<int> payoutAmounts,
        int topperCount)
    {
        Dictionary<(int cardIndex, int cellIndex), NearWinCandidate> results = new Dictionary<(int cardIndex, int cellIndex), NearWinCandidate>();
        if (activePatternIndexes == null || patternMasks == null)
        {
            return results;
        }

        for (int i = 0; i < activePatternIndexes.Count; i++)
        {
            int rawPatternIndex = activePatternIndexes[i];
            if (rawPatternIndex < 0 || rawPatternIndex >= patternMasks.Count)
            {
                continue;
            }

            byte[] mask = patternMasks[rawPatternIndex];
            if (!TryResolveNearWinCell(mask, visibleTickets, drawnNumbers, rawPatternIndex, payoutAmounts, topperCount, out NearWinCandidate[] candidates))
            {
                continue;
            }

            for (int candidateIndex = 0; candidateIndex < candidates.Length; candidateIndex++)
            {
                NearWinCandidate candidate = candidates[candidateIndex];
                var key = (candidate.CardIndex, candidate.CellIndex);
                if (!results.TryGetValue(key, out NearWinCandidate existing) ||
                    IsBetterNearWinCandidate(candidate, existing))
                {
                    results[key] = candidate;
                }
            }
        }

        return results;
    }

    private static Dictionary<int, NearWinCandidate> BuildNearWinsByTopperSlot(
        int[][] visibleTickets,
        HashSet<int> drawnNumbers,
        IReadOnlyList<int> activePatternIndexes,
        IReadOnlyList<byte[]> patternMasks,
        IReadOnlyList<int> payoutAmounts,
        int topperCount)
    {
        Dictionary<int, NearWinCandidate> results = new Dictionary<int, NearWinCandidate>();
        if (activePatternIndexes == null || patternMasks == null)
        {
            return results;
        }

        for (int i = 0; i < activePatternIndexes.Count; i++)
        {
            int rawPatternIndex = activePatternIndexes[i];
            if (rawPatternIndex < 0 || rawPatternIndex >= patternMasks.Count)
            {
                continue;
            }

            byte[] mask = patternMasks[rawPatternIndex];
            if (!TryResolveNearWinCell(mask, visibleTickets, drawnNumbers, rawPatternIndex, payoutAmounts, topperCount, out NearWinCandidate[] candidates))
            {
                continue;
            }

            for (int candidateIndex = 0; candidateIndex < candidates.Length; candidateIndex++)
            {
                NearWinCandidate candidate = candidates[candidateIndex];
                if (!results.TryGetValue(candidate.SlotIndex, out NearWinCandidate existing) ||
                    IsBetterNearWinCandidate(candidate, existing))
                {
                    results[candidate.SlotIndex] = candidate;
                }
            }
        }

        return results;
    }

    private static bool TryResolveNearWinCell(
        byte[] mask,
        int[][] visibleTickets,
        HashSet<int> drawnNumbers,
        int rawPatternIndex,
        IReadOnlyList<int> payoutAmounts,
        int topperCount,
        out NearWinCandidate[] candidates)
    {
        List<NearWinCandidate> resolved = new List<NearWinCandidate>();
        for (int cardIndex = 0; cardIndex < visibleTickets.Length; cardIndex++)
        {
            int[] ticket = visibleTickets[cardIndex];
            if (ticket == null || !TryResolveNearWinCell(ticket, drawnNumbers, mask, out int missingCellIndex))
            {
                continue;
            }

            int slotIndex = GameManager.ResolvePayoutSlotIndex(rawPatternIndex, topperCount);
            int payoutAmount = GetValue(payoutAmounts, slotIndex, 0);
            resolved.Add(new NearWinCandidate(rawPatternIndex, slotIndex, cardIndex, missingCellIndex, payoutAmount));
        }

        candidates = resolved.ToArray();
        return candidates.Length > 0;
    }

    private static bool TryResolveNearWinCell(int[] ticket, HashSet<int> drawnNumbers, byte[] mask, out int missingCellIndex)
    {
        missingCellIndex = -1;
        if (ticket == null || mask == null)
        {
            return false;
        }

        int requiredCount = 0;
        int matchedCount = 0;
        int cellCount = Mathf.Min(ticket.Length, mask.Length);
        for (int cellIndex = 0; cellIndex < cellCount; cellIndex++)
        {
            if (mask[cellIndex] != 1)
            {
                continue;
            }

            requiredCount++;
            int number = ticket[cellIndex];
            if (number > 0 && drawnNumbers.Contains(number))
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

    private static bool IsPatternMatched(int[] ticket, HashSet<int> drawnNumbers, byte[] mask)
    {
        int cellCount = Mathf.Min(ticket.Length, mask.Length);
        for (int cellIndex = 0; cellIndex < cellCount; cellIndex++)
        {
            if (mask[cellIndex] != 1)
            {
                continue;
            }

            int number = ticket[cellIndex];
            if (number <= 0 || !drawnNumbers.Contains(number))
            {
                return false;
            }
        }

        return true;
    }

    private static bool IsCellMatched(int cellIndex, HashSet<int> matchedPatterns, IReadOnlyList<byte[]> patternMasks)
    {
        if (matchedPatterns == null || matchedPatterns.Count == 0 || patternMasks == null)
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
            if (mask != null && cellIndex >= 0 && cellIndex < mask.Length && mask[cellIndex] == 1)
            {
                return true;
            }
        }

        return false;
    }

    private static void PopulateBallRack(Theme1BallRackRenderState ballRack, IReadOnlyList<int> drawnNumbers, int ballSlotCount)
    {
        if (ballRack == null)
        {
            return;
        }

        int count = Mathf.Max(0, drawnNumbers != null ? drawnNumbers.Count : 0);
        ballRack.ShowBallMachine = count > 0;
        ballRack.ShowExtraBallMachine = false;
        ballRack.ShowBallOutMachine = true;
        ballRack.ShowBigBall = count > 0;
        ballRack.BigBallNumber = count > 0 ? drawnNumbers[count - 1].ToString() : string.Empty;
        ballRack.Slots = new Theme1BallSlotRenderState[Mathf.Max(0, ballSlotCount)];

        for (int slotIndex = 0; slotIndex < ballRack.Slots.Length; slotIndex++)
        {
            if (drawnNumbers != null && slotIndex < drawnNumbers.Count)
            {
                int value = drawnNumbers[slotIndex];
                ballRack.Slots[slotIndex] = new Theme1BallSlotRenderState(value > 0, value > 0 ? value.ToString() : string.Empty);
            }
            else
            {
                ballRack.Slots[slotIndex] = Theme1BallSlotRenderState.Empty;
            }
        }
    }

    private static void PopulateHud(Theme1HudRenderState hud, Theme1StateBuildInput input)
    {
        if (hud == null || input == null)
        {
            return;
        }

        hud.CountdownLabel = input.CountdownLabel ?? string.Empty;
        hud.PlayerCountLabel = input.PlayerCountLabel ?? string.Empty;
        hud.CreditLabel = string.IsNullOrWhiteSpace(input.CreditLabel) ? "0" : input.CreditLabel;
        hud.WinningsLabel = string.IsNullOrWhiteSpace(input.WinningsLabel) ? "0" : input.WinningsLabel;
        hud.BetLabel = string.IsNullOrWhiteSpace(input.BetLabel) ? "0" : input.BetLabel;
    }

    private static void PopulateTopper(
        Theme1TopperRenderState topper,
        Theme1StateBuildInput input,
        IReadOnlyList<HashSet<int>> matchedPatternsByCard,
        IReadOnlyDictionary<int, NearWinCandidate> nearWinsByTopperSlot)
    {
        if (topper == null || input == null)
        {
            return;
        }

        int slotCount = input.TopperPrizeLabels != null ? input.TopperPrizeLabels.Length : 0;
        topper.Slots = new Theme1TopperSlotRenderState[slotCount];
        HashSet<int> matchedSlotIndexes = new HashSet<int>();
        if (matchedPatternsByCard != null)
        {
            for (int cardIndex = 0; cardIndex < matchedPatternsByCard.Count; cardIndex++)
            {
                HashSet<int> matchedPatterns = matchedPatternsByCard[cardIndex];
                if (matchedPatterns == null)
                {
                    continue;
                }

                foreach (int rawPatternIndex in matchedPatterns)
                {
                    int slotIndex = GameManager.ResolvePayoutSlotIndex(rawPatternIndex, slotCount);
                    if (slotIndex >= 0)
                    {
                        matchedSlotIndexes.Add(slotIndex);
                    }
                }
            }
        }

        for (int slotIndex = 0; slotIndex < slotCount; slotIndex++)
        {
            Theme1TopperSlotRenderState slotState = new Theme1TopperSlotRenderState
            {
                PrizeLabel = GetValue(input.TopperPrizeLabels, slotIndex, string.Empty),
                ShowPattern = true,
                ShowMatchedPattern = matchedSlotIndexes.Contains(slotIndex),
                PrizeVisualState = Theme1PrizeVisualState.Normal
            };

            if (slotState.ShowMatchedPattern)
            {
                slotState.PrizeVisualState = Theme1PrizeVisualState.Matched;
            }
            else if (nearWinsByTopperSlot != null && nearWinsByTopperSlot.TryGetValue(slotIndex, out NearWinCandidate nearWin))
            {
                int cellCount = 15;
                slotState.MissingCellsVisible = new bool[cellCount];
                if (nearWin.CellIndex >= 0 && nearWin.CellIndex < cellCount)
                {
                    slotState.MissingCellsVisible[nearWin.CellIndex] = true;
                }
                slotState.PrizeVisualState = Theme1PrizeVisualState.NearWin;
            }
            else
            {
                slotState.MissingCellsVisible = Array.Empty<bool>();
            }

            topper.Slots[slotIndex] = slotState;
        }
    }

    private static bool IsBetterNearWinCandidate(NearWinCandidate candidate, NearWinCandidate current)
    {
        if (candidate.PayoutAmount != current.PayoutAmount)
        {
            return candidate.PayoutAmount > current.PayoutAmount;
        }

        if (candidate.RawPatternIndex != current.RawPatternIndex)
        {
            return candidate.RawPatternIndex < current.RawPatternIndex;
        }

        if (candidate.CardIndex != current.CardIndex)
        {
            return candidate.CardIndex < current.CardIndex;
        }

        return candidate.CellIndex < current.CellIndex;
    }

    private static T GetValue<T>(IReadOnlyList<T> values, int index, T fallback)
    {
        if (values == null || index < 0 || index >= values.Count)
        {
            return fallback;
        }

        return values[index];
    }

    private static string GetNonEmptyString(IReadOnlyList<string> values, int index, string fallback)
    {
        string value = GetValue(values, index, string.Empty);
        return string.IsNullOrWhiteSpace(value) ? fallback : value;
    }

    private static int NormalizeTheme1Number(int value)
    {
        return GameManager.NormalizeTheme1BallNumber(value);
    }
}
