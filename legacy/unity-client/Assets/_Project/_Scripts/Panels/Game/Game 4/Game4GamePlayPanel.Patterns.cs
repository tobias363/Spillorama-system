using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

public partial class Game4GamePlayPanel
{
    private readonly List<List<int>> oneLPatterns = new()
    {
        new List<int> {1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0},
        new List<int> {0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0},
        new List<int> {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1}
    };

    private readonly List<List<int>> twoLPatterns = new()
    {
        new List<int> {1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0},
        new List<int> {1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1},
        new List<int> {0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1}
    };

    private void HeighlightCell()
    {
        ResetHeighlightCell();

        foreach (var ticket in ticketList)
            ticket.HighlightMissingIndices(theme.ticketThemeData.ticketHighlighCellColor);
    }

    private void CheckMissIndies()
    {
        foreach (PrefabBingoGame4Ticket5x3 ticket in ticketList)
        {
            if (!ticket._isTicketPurchased)
                continue;

            ticket.MissingPatterns.Clear();
            List<PrefabBingoGame4Pattern> matchingPatterns = MatchPatternList(ticket.yourArray);
            if (matchingPatterns.Count == 0)
                continue;

            ticket.MissingPatterns.AddRange(matchingPatterns);
            foreach (PrefabBingoGame4Pattern pattern in matchingPatterns)
            {
                if (!pattern.MissingTickets.Contains(ticket))
                    pattern.MissingTickets.Add(ticket);
            }
        }
    }

    private List<PrefabBingoGame4Pattern> MatchPatternList(int[] yourArray)
    {
        List<PrefabBingoGame4Pattern> missingPatterns = new();
        int patternCount = patternList.Count - 1;

        for (int i = 0; i < patternCount; i++)
            TryCollectMissingPattern(patternList[i], patternList[i].patternData.patternDataList, yourArray, missingPatterns);

        for (int i = 0; i < oneLPatterns.Count; i++)
            TryCollectMissingPattern(patternList[14], oneLPatterns[i], yourArray, missingPatterns);

        for (int i = 0; i < twoLPatterns.Count; i++)
            TryCollectMissingPattern(patternList[6], twoLPatterns[i], yourArray, missingPatterns);

        return missingPatterns;
    }

    private void TryCollectMissingPattern(
        PrefabBingoGame4Pattern pattern,
        List<int> patternData,
        int[] yourArray,
        List<PrefabBingoGame4Pattern> missingPatterns)
    {
        if (!MissingPattern(patternData, yourArray, out List<int> missingIndices))
            return;

        if (missingIndices.Count > 0)
        {
            pattern.missingIndices ??= new List<int>();
            foreach (int index in missingIndices)
            {
                if (!pattern.missingIndices.Contains(index))
                    pattern.missingIndices.Add(index);
            }
        }

        missingPatterns.Add(pattern);
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

    private void MarkTicketNumber(int number)
    {
        if (ticketList[0].IsTicketPurchased)
            ticketList[0].MarkNewWithdrawNumber(number, false, false, true);
        if (ticketList[1].IsTicketPurchased)
            ticketList[1].MarkNewWithdrawNumber(number, false, false, true);
        if (ticketList[2].IsTicketPurchased)
            ticketList[2].MarkNewWithdrawNumber(number, false, false, true);
        if (ticketList[3].IsTicketPurchased)
            ticketList[3].MarkNewWithdrawNumber(number, false, false, true);
    }

    private void HighlightWinningPattern(Game4PlayResponse game4PlayData)
    {
        foreach (Game4WinningTicketData winningTicketData in game4PlayData.winningTicketList)
        {
            PrefabBingoGame4Ticket5x3 ticketObject = GetTicketObjectById(winningTicketData.ticketId);
            if (ticketObject == null)
                continue;

            foreach (string patternId in winningTicketData.winningPatternIdList)
            {
                PrefabBingoGame4Pattern patternObject = GetPatternObjectById(patternId);
                if (patternObject == null)
                    continue;

                patternObject.HighlightPattern(true);
                ticketObject.HighlightTicket(
                    patternObject.PatternDataList,
                    winningTicketData.row1L_2L_winningPattern,
                    patternObject.patternData.extra,
                    theme.ticketThemeData.ticketHighlighCellColor,
                    GetPatternSpriteData(patternObject.PatternId));
            }
        }

        foreach (Game4WinningTicketData winningTicketData in game4PlayData.winningTicketList)
        {
            PrefabBingoGame4Ticket5x3 wonTicket = GetTicketObjectById(winningTicketData.ticketId);
            if (wonTicket == null)
                continue;

            wonTicket.WonAmount = winningTicketData.winningAmount.ToString();
            wonTicket.TicketCompleted = true;
        }

        WonValue = game4PlayData.winningPrize;
        btnTryOtherGame.gameObject.SetActive(game4PlayData.extraGamePlay);
    }

    private IEnumerator HighlightTicketWait(Game4PlayResponse game4PlayData)
    {
        foreach (Game4WinningTicketData winningTicketData in game4PlayData.winningTicketList)
        {
            PrefabBingoGame4Ticket5x3 ticketObject = GetTicketObjectById(winningTicketData.ticketId);
            if (ticketObject == null)
                continue;

            foreach (string patternId in winningTicketData.winningPatternIdList)
            {
                yield return new WaitForSeconds(.5f);
                PrefabBingoGame4Pattern patternObject = GetPatternObjectById(patternId);
                if (patternObject == null)
                    continue;

                if (patternObject.patternData.extra == "1L" || patternObject.patternData.extra == "2L")
                    patternObject.patternData.patternDataList = winningTicketData.row1L_2L_winningPattern;

                ticketObject.HighlightTicket(
                    patternObject.PatternDataList,
                    winningTicketData.row1L_2L_winningPattern,
                    patternObject.patternData.extra,
                    theme.ticketThemeData.ticketHighlighCellColor,
                    GetPatternSpriteData(patternObject.PatternId));
            }
        }
    }

    private PrefabBingoGame4Pattern GetPatternObjectById(string id)
    {
        foreach (PrefabBingoGame4Pattern patternData in patternList)
        {
            if (patternData.PatternId == id)
                return patternData;
        }

        return null;
    }

    private PrefabBingoGame4Ticket5x3 GetTicketObjectById(string id)
    {
        foreach (PrefabBingoGame4Ticket5x3 ticket in ticketList)
        {
            if (ticket.TicketId == id)
                return ticket;
        }

        return null;
    }
}
