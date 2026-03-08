using System.Collections.Generic;
using SimpleJSON;

public static class RealtimeTicketSetUtils
{
    public static bool TicketContainsInAnyTicketSet(List<List<int>> ticketSets, int number)
    {
        if (ticketSets == null || ticketSets.Count == 0)
        {
            return false;
        }

        foreach (List<int> ticket in ticketSets)
        {
            if (ticket != null && ticket.Contains(number))
            {
                return true;
            }
        }
        return false;
    }

    public static void MarkDrawnNumberOnCards(NumberGenerator generator, int drawnNumber)
    {
        if (generator == null || generator.cardClasses == null || !GameManager.IsValidTheme1BallNumber(drawnNumber))
        {
            return;
        }

        foreach (CardClass card in generator.cardClasses)
        {
            if (card == null)
            {
                continue;
            }

            for (int cellIndex = 0; cellIndex < card.numb.Count && cellIndex < card.selectionImg.Count; cellIndex++)
            {
                if (card.numb[cellIndex] == drawnNumber)
                {
                    card.selectionImg[cellIndex].SetActive(true);
                    if (cellIndex < card.payLinePattern.Count)
                    {
                        card.payLinePattern[cellIndex] = 1;
                    }
                }
            }
        }
    }

    public static List<int> FlattenTicketGrid(JSONNode gridNode)
    {
        List<int> values = new();
        if (gridNode == null || gridNode.IsNull || !gridNode.IsArray)
        {
            return values;
        }

        for (int row = 0; row < gridNode.Count; row++)
        {
            JSONNode rowNode = gridNode[row];
            if (rowNode == null || rowNode.IsNull || !rowNode.IsArray)
            {
                continue;
            }

            for (int col = 0; col < rowNode.Count; col++)
            {
                int number = rowNode[col].AsInt;
                if (number > 0 && !values.Contains(number))
                {
                    values.Add(number);
                }
            }
        }

        return values;
    }

    public static List<int> ExtractCandyTicketNumbersFromGrid(JSONNode gridNode)
    {
        List<int> flattened = FlattenTicketGrid(gridNode);
        if (flattened.Count == 15)
        {
            return flattened;
        }

        return flattened;
    }

    public static List<int> NormalizeTicketNumbers(List<int> source)
    {
        List<int> numbers = new List<int>();
        if (source != null)
        {
            int limit = source.Count > 15 ? 15 : source.Count;
            for (int i = 0; i < limit; i++)
            {
                numbers.Add(GameManager.NormalizeTheme1BallNumber(source[i]));
            }
        }

        while (numbers.Count < 15)
        {
            numbers.Add(0);
        }

        return numbers;
    }

    public static List<List<int>> CloneTicketSets(List<List<int>> source)
    {
        List<List<int>> clone = new();
        if (source == null)
        {
            return clone;
        }

        foreach (List<int> ticket in source)
        {
            clone.Add(ticket == null ? new List<int>() : new List<int>(ticket));
        }

        return clone;
    }

    public static bool AreTicketSetsEqual(List<List<int>> left, List<List<int>> right)
    {
        if (ReferenceEquals(left, right))
        {
            return true;
        }

        if (left == null || right == null || left.Count != right.Count)
        {
            return false;
        }

        for (int i = 0; i < left.Count; i++)
        {
            List<int> leftTicket = left[i];
            List<int> rightTicket = right[i];

            if (ReferenceEquals(leftTicket, rightTicket))
            {
                continue;
            }

            if (leftTicket == null || rightTicket == null || leftTicket.Count != rightTicket.Count)
            {
                return false;
            }

            for (int j = 0; j < leftTicket.Count; j++)
            {
                if (leftTicket[j] != rightTicket[j])
                {
                    return false;
                }
            }
        }

        return true;
    }

    public static List<List<int>> ExtractTicketSets(JSONNode myTicketsNode)
    {
        List<List<int>> ticketSets = new();
        if (myTicketsNode == null || myTicketsNode.IsNull)
        {
            return ticketSets;
        }

        if (myTicketsNode.IsArray)
        {
            // Backward-compatible support:
            // 1) flat [n1,n2,...]
            // 2) grid [[...],[...],...]
            // 3) list of ticket objects [{grid:[...]}...]
            if (LooksLikeFlatNumberArray(myTicketsNode))
            {
                List<int> directFlat = NormalizeTicketNumbers(ExtractFlatNumbers(myTicketsNode));
                if (directFlat.Count > 0)
                {
                    ticketSets.Add(directFlat);
                }
                return ticketSets;
            }

            if (LooksLikeGridArray(myTicketsNode))
            {
                List<int> flatGrid = NormalizeTicketNumbers(ExtractCandyTicketNumbersFromGrid(myTicketsNode));
                if (flatGrid.Count > 0)
                {
                    ticketSets.Add(flatGrid);
                }
                return ticketSets;
            }

            for (int i = 0; i < myTicketsNode.Count; i++)
            {
                List<int> flat = ExtractSingleTicketNumbers(myTicketsNode[i]);
                if (flat.Count > 0)
                {
                    ticketSets.Add(NormalizeTicketNumbers(flat));
                }
            }
            return ticketSets;
        }

        List<int> single = NormalizeTicketNumbers(ExtractSingleTicketNumbers(myTicketsNode));
        if (single.Count > 0)
        {
            ticketSets.Add(single);
        }
        return ticketSets;
    }

    private static List<int> ExtractSingleTicketNumbers(JSONNode ticketNode)
    {
        if (ticketNode == null || ticketNode.IsNull)
        {
            return new List<int>();
        }

        if (ticketNode.IsArray)
        {
            if (LooksLikeFlatNumberArray(ticketNode))
            {
                return ExtractFlatNumbers(ticketNode);
            }

            if (LooksLikeGridArray(ticketNode))
            {
                return ExtractCandyTicketNumbersFromGrid(ticketNode);
            }

            for (int i = 0; i < ticketNode.Count; i++)
            {
                List<int> nested = ExtractSingleTicketNumbers(ticketNode[i]);
                if (nested.Count > 0)
                {
                    return nested;
                }
            }

            return new List<int>();
        }

        JSONNode numbersNode = ticketNode["numbers"];
        if (numbersNode != null && !numbersNode.IsNull && numbersNode.IsArray)
        {
            List<int> byNumbers = ExtractFlatNumbers(numbersNode);
            if (byNumbers.Count > 0)
            {
                return byNumbers;
            }
        }

        JSONNode valuesNode = ticketNode["values"];
        if (valuesNode != null && !valuesNode.IsNull && valuesNode.IsArray)
        {
            List<int> byValues = ExtractFlatNumbers(valuesNode);
            if (byValues.Count > 0)
            {
                return byValues;
            }
        }

        List<int> byGrid = ExtractCandyTicketNumbersFromGrid(ticketNode["grid"]);
        if (byGrid.Count > 0)
        {
            return byGrid;
        }

        JSONNode nestedTicketNode = ticketNode["ticket"];
        if (nestedTicketNode != null && !nestedTicketNode.IsNull)
        {
            List<int> nestedTicket = ExtractSingleTicketNumbers(nestedTicketNode);
            if (nestedTicket.Count > 0)
            {
                return nestedTicket;
            }
        }

        return new List<int>();
    }

    private static List<int> ExtractFlatNumbers(JSONNode node)
    {
        List<int> values = new();
        if (node == null || node.IsNull || !node.IsArray)
        {
            return values;
        }

        for (int i = 0; i < node.Count; i++)
        {
            if (TryParsePositiveInt(node[i], out int parsed) && !values.Contains(parsed))
            {
                values.Add(parsed);
            }
        }

        return values;
    }

    private static bool LooksLikeFlatNumberArray(JSONNode node)
    {
        if (node == null || node.IsNull || !node.IsArray || node.Count == 0)
        {
            return false;
        }

        for (int i = 0; i < node.Count; i++)
        {
            JSONNode entry = node[i];
            if (entry == null || entry.IsNull || entry.IsArray || entry.IsObject)
            {
                return false;
            }

            if (!TryParsePositiveInt(entry, out _))
            {
                return false;
            }
        }

        return true;
    }

    private static bool LooksLikeGridArray(JSONNode node)
    {
        if (node == null || node.IsNull || !node.IsArray || node.Count == 0)
        {
            return false;
        }

        bool hasAtLeastOneRow = false;
        for (int row = 0; row < node.Count; row++)
        {
            JSONNode rowNode = node[row];
            if (rowNode == null || rowNode.IsNull || !rowNode.IsArray)
            {
                return false;
            }

            hasAtLeastOneRow = true;
            for (int col = 0; col < rowNode.Count; col++)
            {
                JSONNode cellNode = rowNode[col];
                if (cellNode == null || cellNode.IsNull || cellNode.IsArray || cellNode.IsObject)
                {
                    return false;
                }

                string raw = cellNode.Value;
                if (!string.IsNullOrWhiteSpace(raw) && !int.TryParse(raw, out _))
                {
                    return false;
                }
            }
        }

        return hasAtLeastOneRow;
    }

    private static bool TryParsePositiveInt(JSONNode node, out int value)
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

        if (!int.TryParse(raw, out int parsed))
        {
            return false;
        }

        if (parsed <= 0)
        {
            return false;
        }

        value = parsed;
        return true;
    }
}
