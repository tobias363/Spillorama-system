using System.Collections.Generic;
using SimpleJSON;
using UnityEngine;

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
        if (generator == null || generator.cardClasses == null)
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

    public static List<int> NormalizeTicketNumbers(List<int> source)
    {
        List<int> numbers = source == null ? new List<int>() : new List<int>(source);
        while (numbers.Count < 15)
        {
            int fallback = Random.Range(1, 76);
            if (!numbers.Contains(fallback))
            {
                numbers.Add(fallback);
            }
        }

        if (numbers.Count > 15)
        {
            numbers = numbers.GetRange(0, 15);
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
            for (int i = 0; i < myTicketsNode.Count; i++)
            {
                List<int> flat = FlattenTicketGrid(myTicketsNode[i]?["grid"]);
                if (flat.Count > 0)
                {
                    ticketSets.Add(flat);
                }
            }
            return ticketSets;
        }

        List<int> single = FlattenTicketGrid(myTicketsNode["grid"]);
        if (single.Count > 0)
        {
            ticketSets.Add(single);
        }
        return ticketSets;
    }
}
