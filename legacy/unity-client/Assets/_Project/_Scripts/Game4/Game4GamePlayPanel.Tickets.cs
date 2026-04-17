using System.Collections.Generic;
using System.Linq;
using UnityEngine;

public partial class Game4GamePlayPanel
{
    private void GeneratePatterns(List<Game4PatternData> list)
    {
        int patternNumber = 0;
        foreach (Game4PatternData patternData in list)
        {
            PrefabBingoGame4Pattern newPattern = Instantiate(prefabBingoGame4Pattern, transformPatternContainer);
            patternSpriteDataList[patternNumber].patternId = patternData.id;
            newPattern.name = "Pattern " + (++patternNumber);
            newPattern.SetData(patternData);
            patternList.Add(newPattern);
        }

        RefreshBetValue();
    }

    private void GenerateTickets(List<GameTicketData> list)
    {
        ResetTickets();

        foreach (GameTicketData ticket in list)
        {
            PrefabBingoGame4Ticket5x3 newTicket = Instantiate(prefabBingoGame4Ticket5X3, transformTicketContainer);
            newTicket.SetData(ticket, markerData);
            newTicket.TicketTheme(theme.ticketThemeData);
            ticketList.Add(newTicket);
            newTicket.InitializeTicketPurchasingOption();
        }

        TicketCount = ticketList.Count;
        RefreshBetValue();
    }

    private void ChangeTickets(List<GameTicketData> list)
    {

        foreach (PrefabBingoGame4Pattern patternData in patternList)
            patternData.HighlightPattern(false);

        for (int i = 0; i < ticketList.Count; i++)
        {
            ticketList[i].ResetTicket();
            ticketList[i].SetData(list[i], markerData);
        }
    }

    private void ChangeTicketIdArray(List<GameTicketData> newTicketList, bool isComeBack = false)
    {
        for (int i = 0; i < ticketList.Count; i++)
        {
            for (int j = 0; j < newTicketList.Count; j++)
            {
                if (ticketList[i].gameTicketData.ticketCellNumberList.SequenceEqual(newTicketList[j].ticketCellNumberList))
                    ticketList[i].TicketId = newTicketList[j].id;
            }
        }

        if (isComeBack)
            UpdateTicketIdArray(game4Data.parsedTicketList);
    }

    private void UpdateTicketIdArray(List<string> newTicketList)
    {
        for (int i = 0; i < ticketList.Count; i++)
        {
            if (!newTicketList.Contains(ticketList[i].TicketId))
            {
                ticketList[i].OnRemoveTicket();
                ticketList[i].nonPurchaseTicket();
            }
        }

        BetValue = game4Data.totalAmountOfTickets;
        UpdatedBetValue(game4Data.totalAmountOfTickets);
    }

    private void RefreshBetValue()
    {
        if (TicketCount == 1)
            betMultiplierValue = game4Data.betData.ticket1Multiplier[betMultiplierIndex];
        else if (TicketCount == 2)
            betMultiplierValue = game4Data.betData.ticket2Multiplier[betMultiplierIndex];
        else if (TicketCount == 3)
            betMultiplierValue = game4Data.betData.ticket3Multiplier[betMultiplierIndex];
        else
            betMultiplierValue = game4Data.betData.ticket4Multiplier[betMultiplierIndex];

        BetValue = TicketCount * ticketPrice * betMultiplierValue;
    }

    private void UpdatedBetValue(int value)
    {
        int indexvalue = value / (game4Data.ticketPrice * TicketCount);

        if (TicketCount == 1)
            betMultiplierIndex = game4Data.betData.ticket1Multiplier.IndexOf(indexvalue);
        else if (TicketCount == 2)
            betMultiplierIndex = game4Data.betData.ticket2Multiplier.IndexOf(indexvalue);
        else if (TicketCount == 3)
            betMultiplierIndex = game4Data.betData.ticket3Multiplier.IndexOf(indexvalue);
        else
            betMultiplierIndex = game4Data.betData.ticket4Multiplier.IndexOf(indexvalue);
    }

    public Game4PatternSpriteData GetPatternSpriteData(string patternId)
    {
        foreach (Game4PatternSpriteData data in patternSpriteDataList)
        {
            if (data.patternId == patternId)
                return data;
        }

        return null;
    }

    private void Reset()
    {
        foreach (Transform obj in transformPatternContainer)
            Destroy(obj.gameObject);

        ResetWithdrawnBallContainer();
        ResetTickets();
        MissingPatternsAndTicketsList();

        WonValue = 0;
        betMultiplierIndex = 0;
        patternList.Clear();
        _isPatternChangeAllowed = true;
        IsGamePlayInProcess = false;
        btnTryOtherGame.Close();
        toggleAutoPlay.isOn = false;
        imgSelectTicketHighlight.Close();
    }

    private void ResetHighlightCell()
    {
        foreach (var ticket in ticketList)
            ticket.ResetHighlightMissingIndices();
    }

    private void ResetHighlightMissingPattern()
    {
        foreach (var ticket in ticketList)
            ticket.StopHighlightMissingPattern();
    }

    private void ResetTicketHighlightData()
    {
        foreach (PrefabBingoGame4Pattern patternData in patternList)
            patternData.HighlightPattern(false);

        for (int i = 0; i < ticketList.Count; i++)
            ticketList[i].ResetTicket();
    }

    private void ResetWithdrawnBallContainer()
    {
        foreach (Transform obj in transformWithdrawnBallContainer)
            Destroy(obj.gameObject);
    }

    private void ResetTickets()
    {
        foreach (PrefabBingoGame4Ticket5x3 ticket in ticketList)
            Destroy(ticket.gameObject);

        ticketList.Clear();
    }

    private void MissingPatternsAndTicketsList()
    {
        foreach (PrefabBingoGame4Ticket5x3 ticket in ticketList)
            ticket.MissingPatterns.Clear();

        foreach (PrefabBingoGame4Ticket5x3 ticket in ticketList)
            ticket.ResetYourArray();
    }
}
