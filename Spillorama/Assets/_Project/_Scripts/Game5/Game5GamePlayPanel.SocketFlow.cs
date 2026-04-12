using System.Collections.Generic;
using UnityEngine;

public partial class Game5GamePlayPanel
{
    public void Reconnect()
    {
        Debug.Log("On Reconnected Game 5");
        CallSubscribeRoom();
    }

    public void CallSubscribeRoom()
    {
        if (!Application.isPlaying)
        {
            DisplayLoader(false);
            Debug.Log("[EditModeSmoke] Skipping Game5 SubscribeRoom.");
            return;
        }

        DisplayLoader(true);

        Debug.Log($"[Game5] CallSubscribeRoom: Spillorama path (snapshot={(SpilloramaGameBridge.LatestSnapshot != null ? "yes" : "no")})");
        DisableBroadcasts();
        EnableBroadcasts();
        var data = SpilloramaGameBridge.BuildGame5Data(SpilloramaGameBridge.LatestSnapshot);
        OnSubscribeRoom_Spillorama(data);
    }

    void CallPlayerHallLimitEvent()
    {
        if (!Application.isPlaying)
            return;

        // TODO: Replace with Spillorama REST endpoint for player hall limit
        Debug.LogWarning("[Game5] CallPlayerHallLimitEvent: Spillorama endpoint not yet implemented");
    }

    private void EnableBroadcasts()
    {
        if (!Application.isPlaying)
            return;

        Debug.Log("EnableBroadcasts Game 5 Play Panel");
        SoundManager.Instance.ResetPlayedAnnouncements();
    }

    private void DisableBroadcasts()
    {
        if (!Application.isPlaying)
            return;

        Debug.Log("DisableBroadcasts Game 5 Play Panel");
    }

    private PrefabBingoGame5Ticket3x3 GetTicketById(string ticketId)
    {
        foreach (PrefabBingoGame5Ticket3x3 ticket in ticketList)
        {
            if (ticket.TicketId == ticketId)
                return ticket;
        }

        return null;
    }

    private void CallGame5PlayEvent(string purchaseType = "", string voucherCode = "")
    {
        // TODO: Replace with Spillorama REST endpoint for Game5 play
        Debug.LogWarning("[Game5] CallGame5PlayEvent: Spillorama endpoint not yet implemented");
        DisplayLoader(false);
    }

    private void OnGameStart()
    {
        IsGamePlayInProcess = true;
        foreach (PrefabBingoGame5Ticket3x3 ticket in ticketList)
        {
            ticket.blockTicketActions();
        }
    }

    private List<(string id, int price)> GetActiveTicketInfoList()
    {
        List<(string id, int price)> ticketInfoList = new List<(string id, int price)>();

        foreach (PrefabBingoGame5Ticket3x3 ticket in ticketList)
        {
            ticketInfoList.Add((ticket.ticketList.id, ticket.ticketList.price));
        }

        return ticketInfoList;
    }

    // ── Spillorama path ──────────────────────────────────────────────────

    private void OnSubscribeRoom_Spillorama(Game5Data data)
    {
        Debug.Log($"[Game5][Spillorama] OnSubscribeRoom_Spillorama gameId={data.gameId}");
        game5Data = data;
        DisplayLoader(false);

        rouletteSpinnerElements.SetActive(true);
        IsGamePlayInProcess = false;
        SetData(data);
    }

}
