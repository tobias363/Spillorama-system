using System;
using System.Collections.Generic;
using UnityEngine;

public sealed class Theme1StateBuilder
{
    private readonly Theme1PatternEngine patternEngine = new Theme1PatternEngine();

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
        int[][] visibleTickets = ResolveVisibleTickets(input);
        Theme1PatternEngine.Evaluation patternEvaluation = patternEngine.Evaluate(
            visibleTickets,
            validDrawnNumbers,
            input.ActivePatternIndexes,
            input.PatternMasks,
            input.TopperPayoutAmounts,
            topperCount);

        for (int cardIndex = 0; cardIndex < state.Cards.Length; cardIndex++)
        {
            Theme1CardRenderState cardState = Theme1CardRenderState.CreateEmpty();
            cardState.PaylinesActive = new bool[input.PatternMasks != null ? input.PatternMasks.Length : 0];

            int[] ticket = cardIndex < visibleTickets.Length ? visibleTickets[cardIndex] : null;
            Theme1PatternEngine.CardResult patternState = patternEvaluation.Cards != null && cardIndex < patternEvaluation.Cards.Length
                ? patternEvaluation.Cards[cardIndex]
                : null;
            HashSet<int> matchedPatterns = patternState?.MatchedPatternIndexes;
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
                bool isSelected = number > 0 && Array.IndexOf(validDrawnNumbers, number) >= 0;
                bool isMatched = IsCellMatched(cellIndex, matchedPatterns, input.PatternMasks);
                bool isMissing = TryGetCellNearWins(patternState, cellIndex, out List<Theme1PatternEngine.NearWinResult> nearWins);
                int[] nearWinPatternIndexes = ExtractNearWinPatternIndexes(nearWins);
                int missingNumber = ResolveMissingNumber(number, nearWins);

                cardState.Cells[cellIndex] = new Theme1CardCellRenderState(
                    number > 0 ? number.ToString() : "-",
                    isSelected,
                    isMissing,
                    isMatched,
                    nearWinPatternIndexes.Length > 0 ? nearWinPatternIndexes[0] : -1,
                    missingNumber,
                    nearWinPatternIndexes);
            }

            for (int patternListIndex = 0; patternListIndex < cardState.PaylinesActive.Length; patternListIndex++)
            {
                cardState.PaylinesActive[patternListIndex] =
                    matchedPatterns != null && matchedPatterns.Contains(patternListIndex);
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
        PopulateTopper(state.Topper, input, patternEvaluation);
        return state;
    }

    private static bool TryGetCellNearWins(
        Theme1PatternEngine.CardResult patternState,
        int cellIndex,
        out List<Theme1PatternEngine.NearWinResult> nearWins)
    {
        nearWins = null;
        return patternState != null &&
               patternState.NearWinsByCell != null &&
               patternState.NearWinsByCell.TryGetValue(cellIndex, out nearWins) &&
               nearWins != null &&
               nearWins.Count > 0;
    }

    private static int[] ExtractNearWinPatternIndexes(List<Theme1PatternEngine.NearWinResult> nearWins)
    {
        if (nearWins == null || nearWins.Count == 0)
        {
            return Array.Empty<int>();
        }

        HashSet<int> unique = new HashSet<int>();
        for (int i = 0; i < nearWins.Count; i++)
        {
            unique.Add(nearWins[i].RawPatternIndex);
        }

        int[] values = new int[unique.Count];
        unique.CopyTo(values);
        Array.Sort(values);
        return values;
    }

    private static int ResolveMissingNumber(int fallbackNumber, List<Theme1PatternEngine.NearWinResult> nearWins)
    {
        if (nearWins == null || nearWins.Count == 0)
        {
            return fallbackNumber;
        }

        for (int i = 0; i < nearWins.Count; i++)
        {
            if (nearWins[i].MissingNumber > 0)
            {
                return nearWins[i].MissingNumber;
            }
        }

        return fallbackNumber;
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

    private static bool IsCellMatched(int cellIndex, IReadOnlyCollection<int> matchedPatterns, IReadOnlyList<byte[]> patternMasks)
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
        Theme1PatternEngine.Evaluation patternEvaluation)
    {
        if (topper == null || input == null)
        {
            return;
        }

        int slotCount = input.TopperPrizeLabels != null ? input.TopperPrizeLabels.Length : 0;
        topper.Slots = new Theme1TopperSlotRenderState[slotCount];

        Dictionary<int, HashSet<int>> matchedCardsBySlot = new Dictionary<int, HashSet<int>>();
        Dictionary<int, HashSet<int>> matchedPatternsBySlot = new Dictionary<int, HashSet<int>>();
        if (patternEvaluation?.Cards != null)
        {
            for (int cardIndex = 0; cardIndex < patternEvaluation.Cards.Length; cardIndex++)
            {
                Theme1PatternEngine.CardResult card = patternEvaluation.Cards[cardIndex];
                if (card?.MatchedPatternIndexes == null)
                {
                    continue;
                }

                foreach (int rawPatternIndex in card.MatchedPatternIndexes)
                {
                    int slotIndex = GameManager.ResolvePayoutSlotIndex(rawPatternIndex, slotCount);
                    if (slotIndex < 0)
                    {
                        continue;
                    }

                    if (!matchedCardsBySlot.TryGetValue(slotIndex, out HashSet<int> matchedCards))
                    {
                        matchedCards = new HashSet<int>();
                        matchedCardsBySlot[slotIndex] = matchedCards;
                    }

                    if (!matchedPatternsBySlot.TryGetValue(slotIndex, out HashSet<int> matchedPatterns))
                    {
                        matchedPatterns = new HashSet<int>();
                        matchedPatternsBySlot[slotIndex] = matchedPatterns;
                    }

                    matchedCards.Add(cardIndex);
                    matchedPatterns.Add(rawPatternIndex);
                }
            }
        }

        for (int slotIndex = 0; slotIndex < slotCount; slotIndex++)
        {
            Theme1TopperSlotRenderState slotState = new Theme1TopperSlotRenderState
            {
                PrizeLabel = GetValue(input.TopperPrizeLabels, slotIndex, string.Empty),
                ShowPattern = true,
                ShowMatchedPattern = matchedCardsBySlot.ContainsKey(slotIndex),
                PrizeVisualState = Theme1PrizeVisualState.Normal
            };

            if (matchedCardsBySlot.TryGetValue(slotIndex, out HashSet<int> matchedCards))
            {
                slotState.ActiveCardIndexes = ToSortedArray(matchedCards);
            }

            if (matchedPatternsBySlot.TryGetValue(slotIndex, out HashSet<int> matchedPatterns))
            {
                slotState.ActivePatternIndexes = ToSortedArray(matchedPatterns);
            }

            if (slotState.ShowMatchedPattern)
            {
                slotState.PrizeVisualState = Theme1PrizeVisualState.Matched;
                slotState.MissingCellsVisible = Array.Empty<bool>();
            }
            else if (patternEvaluation != null &&
                     patternEvaluation.NearWinsByTopperSlot.TryGetValue(slotIndex, out List<Theme1PatternEngine.NearWinResult> nearWins) &&
                     nearWins != null &&
                     nearWins.Count > 0)
            {
                slotState.MissingCellsVisible = BuildTopperMissingCells(nearWins);
                slotState.PrizeVisualState = Theme1PrizeVisualState.NearWin;
                slotState.ActivePatternIndexes = ExtractActivePatternIndexes(nearWins);
                slotState.ActiveCardIndexes = ExtractActiveCardIndexes(nearWins);
            }
            else
            {
                slotState.MissingCellsVisible = Array.Empty<bool>();
                slotState.ActivePatternIndexes = Array.Empty<int>();
                slotState.ActiveCardIndexes = Array.Empty<int>();
            }

            topper.Slots[slotIndex] = slotState;
        }
    }

    private static bool[] BuildTopperMissingCells(IReadOnlyList<Theme1PatternEngine.NearWinResult> nearWins)
    {
        bool[] visible = new bool[15];
        if (nearWins == null)
        {
            return visible;
        }

        for (int i = 0; i < nearWins.Count; i++)
        {
            int cellIndex = nearWins[i].CellIndex;
            if (cellIndex >= 0 && cellIndex < visible.Length)
            {
                visible[cellIndex] = true;
            }
        }

        return visible;
    }

    private static int[] ExtractActivePatternIndexes(IReadOnlyList<Theme1PatternEngine.NearWinResult> nearWins)
    {
        if (nearWins == null || nearWins.Count == 0)
        {
            return Array.Empty<int>();
        }

        HashSet<int> values = new HashSet<int>();
        for (int i = 0; i < nearWins.Count; i++)
        {
            values.Add(nearWins[i].RawPatternIndex);
        }

        return ToSortedArray(values);
    }

    private static int[] ExtractActiveCardIndexes(IReadOnlyList<Theme1PatternEngine.NearWinResult> nearWins)
    {
        if (nearWins == null || nearWins.Count == 0)
        {
            return Array.Empty<int>();
        }

        HashSet<int> values = new HashSet<int>();
        for (int i = 0; i < nearWins.Count; i++)
        {
            values.Add(nearWins[i].CardIndex);
        }

        return ToSortedArray(values);
    }

    private static int[] ToSortedArray(HashSet<int> values)
    {
        if (values == null || values.Count == 0)
        {
            return Array.Empty<int>();
        }

        int[] array = new int[values.Count];
        values.CopyTo(array);
        Array.Sort(array);
        return array;
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
