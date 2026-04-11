using System;
using System.Collections.Generic;
using JetBrains.Annotations;
using UnityEngine;

[Serializable]
public class GameTicketData
{
    public string id = "";
    public string ticketNumber = "";
    public string ticketPrice = "0";

    public string hallName = "";
    public string supplierName = "";
    public string developerName = "";

    public bool ticketCompleted = false;
    public string ticketColor = "";
    public string ticketName = "";
    public int winningAmount;

    public List<int> ticketCellNumberList = new List<int>();

    // method to determine if the ticket is large or small
    public bool IsLargeTicket()
    {
        return ticketColor.Contains("Large");
    }

    public bool IsSmallTicket()
    {
        // A traffic light ticket can also be a small ticket, so this should include those cases
        if (ticketColor.Contains("Small Yellow") || ticketColor.Contains("Small White") || ticketColor.Contains("Small Purple") || ticketColor.Contains("Orange"))
        {
            return true; // All "small" tickets, including traffic lights
        }
        return false;
    }

    public bool IsTraficLight()
    {
        // Only consider as traffic light if it’s not a small ticket
        return ticketColor.Contains("Small Yellow") || ticketColor.Contains("Small Green") || ticketColor.Contains("Small Red");
    }
}

[Serializable]
public class Game2TicketData : GameTicketData
{
    public bool isPurchased = false;
    public string playerIdOfPurchaser = "";
}

[Serializable]
public class TicketMarkerCellData
{
    public Sprite spriteTicketMarker;
    public Color32 colorMarker;
    public Color32 colorMarkerText;
}

[Serializable]
public class PatternData
{
    public string _id = "", name = "";
    public double amount = 0;
    public List<int> patternDataList = new List<int>();
    public int patternDesign = 0;
    public int ballNumber = 0;
    public bool isWon;
}

[Serializable]
public class PatternChangeResponse
{
    public List<PatternData> patternList = new List<PatternData>();
    public JackPotData jackPotData;
}

[Serializable]
public class TicketCompletedResponse
{
    public string gameId = "";
    public string ticketId = "";
    public string winningAmount = "";
}

[Serializable]
public class UpdateWonAmountResponse
{
    public int totalWon = 0;
}

[Serializable]
public class PatternCompletedData
{
    public string ticketId = "";
    public bool fullHouse = false;
    public string patternName = "";
    public string ticketNumber = "";
}

[Serializable]
public class PatternCompletedResponse : PatternCompletedData
{
    public string gameId = "";
    public int totalWon = 0;
    //public string ticketId = "";
    //public bool fullHouse = false;
    //public string patternName = "";
    public List<PatternCompletedData> ticketList = new List<PatternCompletedData>();
}

[Serializable]
public class OnProfitUpdateResponse
{
    public int totalProfit = 0;
}

[Serializable]
public class Game4PatternData : PatternData
{
    public string id = "";
    public string patternName = "";
    public int qty = 0;
    public int prize = 0;
    public string extra = "";
}