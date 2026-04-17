using System.Collections.Generic;
using System.Linq;
using UnityEngine;

public partial class Game5GamePlayPanel
{
    private void MarkWithdrawNumbers(BingoNumberData data, bool playSound = false)
    {
        ResetMissingPatternData();
        ResetMissingTicketsData();
        ClearMssingList();
        CheckMissIndies(data, playSound);
        WinPatternBlinking();
    }

    private void WithdrawBingoBallAction(BingoNumberData newBingoNumberData)
    {
        MarkWithdrawNumbers(newBingoNumberData, true);
        LastWithdrawNumber = newBingoNumberData.number;
        TotalWithdrawCount = newBingoNumberData.totalWithdrawCount;
    }

    private void CheckMissIndies(BingoNumberData data, bool playSound = false)
    {
        foreach (PrefabBingoGame5Ticket3x3 ticket in ticketList)
        {
            ticket.MarkNewWithdrawNumber(data.number, true, false, playSound);
            if (!ticket._isTicketPurchased)
                continue;

            ticket.MissingPatterns.Clear();
            List<PrefabBingoGame5Pattern> matchingPatterns = MatchPatternList(ticket.yourArray);
            if (matchingPatterns.Count == 0)
                continue;

            foreach (PrefabBingoGame5Pattern pattern in matchingPatterns)
            {
                if (!pattern.MissingTickets.Contains(ticket))
                    pattern.MissingTickets.Add(ticket);
            }
        }
    }

    public void WinPatternBlinking()
    {
        foreach (var pattern in patternList)
            pattern.stopAnimateTicketActionCall();

        foreach (var pattern in patternList)
            pattern.AnimateTicketActionCall();
    }

    private List<PrefabBingoGame5Pattern> MatchPatternList(int[] yourArray)
    {
        List<PrefabBingoGame5Pattern> missingPatterns = new();
        int patternCount = patternList.Count - 1;

        for (int i = 0; i < patternCount; i++)
        {
            PrefabBingoGame5Pattern patternListEntry = patternList[i];
            if (!MissingPattern(patternListEntry.patternData.pattern, yourArray, out List<int> missingIndices))
                continue;

            if (missingIndices.Count > 0)
                patternListEntry.missingIndicesList.Add(missingIndices);

            missingPatterns.Add(patternListEntry);
        }

        return missingPatterns;
    }

    private bool MissingPattern(List<int> pattern, int[] yourArray, out List<int> missingIndices)
    {
        missingIndices = new List<int>();

        if (pattern.Count != yourArray.Length)
            return false;

        List<int> occurrence = pattern
            .Select((value, index) => new { value, index })
            .Where(item => item.value == 1)
            .Select(item => item.index)
            .ToList();

        return Missing1toGoPattern(yourArray, occurrence, out missingIndices);
    }

    private bool Missing1toGoPattern(int[] yourArray, List<int> indexArr, out List<int> missingIndices)
    {
        missingIndices = new List<int>();
        int count = 0;

        for (int i = 0; i < yourArray.Length; i++)
        {
            if (!indexArr.Contains(i))
                continue;

            if (yourArray[i] == 1)
                count++;
            else
                missingIndices.Add(i);
        }

        return count == indexArr.Count - 1;
    }

    private void HighLightWinningPattern()
    {
        foreach (var pattern in patternList)
            pattern.stopAnimateTicketActionCall();

        foreach (PrefabBingoGame5Pattern pattern in patternList)
            pattern.SetWinning(bingoGame5FinishResponse.winningPatterns);
    }

    private void ResetMissingTicketsData()
    {
        foreach (PrefabBingoGame5Ticket3x3 ticket in ticketList)
            ticket.MissingPatterns.Clear();
    }

    private void ClearMssingList()
    {
        foreach (PrefabBingoGame5Pattern pattern in patternList)
            pattern.missingIndicesList.Clear();
    }

    private void ResetMissingPatternData()
    {
        foreach (PrefabBingoGame5Pattern pattern in patternList)
            pattern.MissingTickets.Clear();
    }
}
