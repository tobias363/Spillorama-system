using System;
using System.Collections.Generic;
using UnityEngine;

public sealed class Theme1PatternEngine
{
    public readonly struct NearWinResult
    {
        public NearWinResult(
            int rawPatternIndex,
            int slotIndex,
            int cardIndex,
            int cellIndex,
            int missingNumber,
            int payoutAmount)
        {
            RawPatternIndex = rawPatternIndex;
            SlotIndex = slotIndex;
            CardIndex = cardIndex;
            CellIndex = cellIndex;
            MissingNumber = missingNumber;
            PayoutAmount = payoutAmount;
        }

        public int RawPatternIndex { get; }
        public int SlotIndex { get; }
        public int CardIndex { get; }
        public int CellIndex { get; }
        public int MissingNumber { get; }
        public int PayoutAmount { get; }
    }

    public sealed class CardResult
    {
        public readonly HashSet<int> MatchedPatternIndexes = new HashSet<int>();
        public readonly Dictionary<int, List<NearWinResult>> NearWinsByCell = new Dictionary<int, List<NearWinResult>>();
        public readonly List<NearWinResult> NearWins = new List<NearWinResult>();
    }

    public sealed class Evaluation
    {
        public CardResult[] Cards = Array.Empty<CardResult>();
        public readonly Dictionary<int, List<NearWinResult>> NearWinsByTopperSlot = new Dictionary<int, List<NearWinResult>>();
    }

    private readonly struct PatternDefinition
    {
        public PatternDefinition(int rawPatternIndex, int slotIndex, int[] cells, int payoutAmount)
        {
            RawPatternIndex = rawPatternIndex;
            SlotIndex = slotIndex;
            Cells = cells ?? Array.Empty<int>();
            PayoutAmount = payoutAmount;
        }

        public int RawPatternIndex { get; }
        public int SlotIndex { get; }
        public int[] Cells { get; }
        public int PayoutAmount { get; }
        public int RequiredCount => Cells != null ? Cells.Length : 0;
    }

    public Evaluation Evaluate(
        int[][] visibleTickets,
        IReadOnlyList<int> drawnNumbers,
        IReadOnlyList<int> activePatternIndexes,
        IReadOnlyList<byte[]> patternMasks,
        IReadOnlyList<int> payoutAmounts,
        int topperCount)
    {
        int cardCount = visibleTickets != null ? visibleTickets.Length : 0;
        Evaluation evaluation = new Evaluation
        {
            Cards = new CardResult[cardCount]
        };

        for (int i = 0; i < cardCount; i++)
        {
            evaluation.Cards[i] = new CardResult();
        }

        List<PatternDefinition> definitions = BuildDefinitions(activePatternIndexes, patternMasks, payoutAmounts, topperCount);
        if (definitions.Count == 0 || cardCount == 0)
        {
            return evaluation;
        }

        Dictionary<int, List<int>> cellToPatternIndexes = BuildCellPatternLookup(definitions);
        int[] normalizedDraws = NormalizeDraws(drawnNumbers);

        for (int cardIndex = 0; cardIndex < cardCount; cardIndex++)
        {
            int[] ticket = NormalizeTicket(visibleTickets[cardIndex]);
            CardResult cardResult = evaluation.Cards[cardIndex];
            if (ticket.Length == 0)
            {
                continue;
            }

            Dictionary<int, int> numberToCell = BuildNumberToCellLookup(ticket);
            bool[] markedCells = new bool[ticket.Length];
            int[] matchedCounts = new int[definitions.Count];

            for (int drawIndex = 0; drawIndex < normalizedDraws.Length; drawIndex++)
            {
                int drawnNumber = normalizedDraws[drawIndex];
                if (drawnNumber <= 0 || !numberToCell.TryGetValue(drawnNumber, out int cellIndex))
                {
                    continue;
                }

                if (cellIndex < 0 || cellIndex >= markedCells.Length || markedCells[cellIndex])
                {
                    continue;
                }

                markedCells[cellIndex] = true;
                if (!cellToPatternIndexes.TryGetValue(cellIndex, out List<int> impactedPatterns))
                {
                    continue;
                }

                for (int i = 0; i < impactedPatterns.Count; i++)
                {
                    int patternLookupIndex = impactedPatterns[i];
                    if (patternLookupIndex >= 0 && patternLookupIndex < matchedCounts.Length)
                    {
                        matchedCounts[patternLookupIndex] += 1;
                    }
                }
            }

            for (int definitionIndex = 0; definitionIndex < definitions.Count; definitionIndex++)
            {
                PatternDefinition definition = definitions[definitionIndex];
                if (definition.RequiredCount <= 0)
                {
                    continue;
                }

                int matchedCount = matchedCounts[definitionIndex];
                if (matchedCount >= definition.RequiredCount)
                {
                    cardResult.MatchedPatternIndexes.Add(definition.RawPatternIndex);
                    continue;
                }

                if (matchedCount != definition.RequiredCount - 1)
                {
                    continue;
                }

                int missingCellIndex = ResolveMissingCell(definition, markedCells);
                if (missingCellIndex < 0 || missingCellIndex >= ticket.Length)
                {
                    continue;
                }

                int missingNumber = GameManager.NormalizeTheme1BallNumber(ticket[missingCellIndex]);
                NearWinResult nearWin = new NearWinResult(
                    definition.RawPatternIndex,
                    definition.SlotIndex,
                    cardIndex,
                    missingCellIndex,
                    missingNumber,
                    definition.PayoutAmount);
                cardResult.NearWins.Add(nearWin);

                if (!cardResult.NearWinsByCell.TryGetValue(missingCellIndex, out List<NearWinResult> cellNearWins))
                {
                    cellNearWins = new List<NearWinResult>();
                    cardResult.NearWinsByCell[missingCellIndex] = cellNearWins;
                }

                cellNearWins.Add(nearWin);

                if (!evaluation.NearWinsByTopperSlot.TryGetValue(definition.SlotIndex, out List<NearWinResult> slotNearWins))
                {
                    slotNearWins = new List<NearWinResult>();
                    evaluation.NearWinsByTopperSlot[definition.SlotIndex] = slotNearWins;
                }

                slotNearWins.Add(nearWin);
            }
        }

        return evaluation;
    }

    private static List<PatternDefinition> BuildDefinitions(
        IReadOnlyList<int> activePatternIndexes,
        IReadOnlyList<byte[]> patternMasks,
        IReadOnlyList<int> payoutAmounts,
        int topperCount)
    {
        List<PatternDefinition> definitions = new List<PatternDefinition>();
        if (activePatternIndexes == null || patternMasks == null)
        {
            return definitions;
        }

        for (int i = 0; i < activePatternIndexes.Count; i++)
        {
            int rawPatternIndex = activePatternIndexes[i];
            if (rawPatternIndex < 0 || rawPatternIndex >= patternMasks.Count)
            {
                continue;
            }

            byte[] mask = patternMasks[rawPatternIndex];
            int[] cells = ExtractPatternCells(mask);
            if (cells.Length == 0)
            {
                continue;
            }

            int slotIndex = GameManager.ResolvePayoutSlotIndex(rawPatternIndex, topperCount);
            int payoutAmount = payoutAmounts != null && slotIndex >= 0 && slotIndex < payoutAmounts.Count
                ? Mathf.Max(0, payoutAmounts[slotIndex])
                : 0;
            definitions.Add(new PatternDefinition(rawPatternIndex, slotIndex, cells, payoutAmount));
        }

        return definitions;
    }

    private static int[] ExtractPatternCells(byte[] mask)
    {
        if (mask == null || mask.Length == 0)
        {
            return Array.Empty<int>();
        }

        List<int> cells = new List<int>(mask.Length);
        for (int cellIndex = 0; cellIndex < mask.Length; cellIndex++)
        {
            if (mask[cellIndex] == 1)
            {
                cells.Add(cellIndex);
            }
        }

        return cells.ToArray();
    }

    private static Dictionary<int, List<int>> BuildCellPatternLookup(IReadOnlyList<PatternDefinition> definitions)
    {
        Dictionary<int, List<int>> lookup = new Dictionary<int, List<int>>();
        if (definitions == null)
        {
            return lookup;
        }

        for (int definitionIndex = 0; definitionIndex < definitions.Count; definitionIndex++)
        {
            PatternDefinition definition = definitions[definitionIndex];
            for (int i = 0; i < definition.Cells.Length; i++)
            {
                int cellIndex = definition.Cells[i];
                if (!lookup.TryGetValue(cellIndex, out List<int> patternIndexes))
                {
                    patternIndexes = new List<int>();
                    lookup[cellIndex] = patternIndexes;
                }

                patternIndexes.Add(definitionIndex);
            }
        }

        return lookup;
    }

    private static int[] NormalizeDraws(IReadOnlyList<int> drawnNumbers)
    {
        if (drawnNumbers == null || drawnNumbers.Count == 0)
        {
            return Array.Empty<int>();
        }

        List<int> values = new List<int>(drawnNumbers.Count);
        for (int i = 0; i < drawnNumbers.Count; i++)
        {
            int normalized = GameManager.NormalizeTheme1BallNumber(drawnNumbers[i]);
            if (normalized > 0)
            {
                values.Add(normalized);
            }
        }

        return values.ToArray();
    }

    private static int[] NormalizeTicket(int[] source)
    {
        if (source == null || source.Length == 0)
        {
            return Array.Empty<int>();
        }

        int[] values = new int[source.Length];
        for (int i = 0; i < source.Length; i++)
        {
            values[i] = GameManager.NormalizeTheme1BallNumber(source[i]);
        }

        return values;
    }

    private static Dictionary<int, int> BuildNumberToCellLookup(IReadOnlyList<int> ticket)
    {
        Dictionary<int, int> lookup = new Dictionary<int, int>();
        if (ticket == null)
        {
            return lookup;
        }

        for (int cellIndex = 0; cellIndex < ticket.Count; cellIndex++)
        {
            int number = GameManager.NormalizeTheme1BallNumber(ticket[cellIndex]);
            if (number > 0 && !lookup.ContainsKey(number))
            {
                lookup.Add(number, cellIndex);
            }
        }

        return lookup;
    }

    private static int ResolveMissingCell(PatternDefinition definition, IReadOnlyList<bool> markedCells)
    {
        if (definition.Cells == null || markedCells == null)
        {
            return -1;
        }

        for (int i = 0; i < definition.Cells.Length; i++)
        {
            int cellIndex = definition.Cells[i];
            if (cellIndex >= 0 && cellIndex < markedCells.Count && !markedCells[cellIndex])
            {
                return cellIndex;
            }
        }

        return -1;
    }
}
