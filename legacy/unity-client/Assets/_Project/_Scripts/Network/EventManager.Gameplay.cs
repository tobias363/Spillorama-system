using System.Collections.Generic;
using BestHTTP.JSON;
using BestHTTP.SocketIO;
using BestHTTP.SocketIO.Events;
using UnityEngine;

public partial class EventManager
{
    public void GamePlanList(int game, string hall, SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("game", game);
        json.put("hall", hall);
        Debug.Log($"GamePlanList: {json.toString()}");
        AisSocket?.Emit("GamePlanList", action, Json.Decode(json.toString()));
    }

    public void Game2PlanList(int game, string hall, SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("game", game);
        json.put("hall", hall);
        Debug.Log($"Game2PlanList: {json.toString()}");
        GameSocketManager.SocketGame2.Emit("Game2PlanList", action, Json.Decode(json.toString()));
    }

    public void Game3PlanList(int game, string hall, SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("game", game);
        json.put("hall", hall);
        Debug.Log($"Game3PlanList: {json.toString()}");
        GameSocketManager.SocketGame3.Emit("Game3PlanList", action, Json.Decode(json.toString()));
    }

    internal void Game1Room(int gameType, string hall, SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("game", gameType);
        json.put("hall", hall);
        json.put("language", Utility.Instance.CurrentLanguage);
        Debug.Log($"Game1Room: {json.toString()}");
        GameSocketManager.SocketGame1.Emit("Game1Room", action, Json.Decode(json.toString()));
    }

    internal void Game2Room(int gameType, string hall, SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("game", gameType);
        json.put("hall", hall);
        json.put("language", Utility.Instance.CurrentLanguage);
        Debug.Log($"Game2Room: {json.toString()}");
        GameSocketManager.SocketGame2.Emit("Game2Room", action, Json.Decode(json.toString()));
    }

    internal void Game3Room(int gameType, string hall, SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("game", gameType);
        json.put("hall", hall);
        json.put("language", Utility.Instance.CurrentLanguage);
        Debug.Log($"Game3Room: {json.toString()}");
        GameSocketManager.SocketGame3.Emit("Game3Room", action, Json.Decode(json.toString()));
    }

    internal void IsGame5AvailbaleForVerifiedPlayer(SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("language", Utility.Instance.CurrentLanguage);
        Debug.Log($"isGameAvailbaleForVerifiedPlayer: {json.toString()}");
        GameSocketManager.SocketGame5.Emit("isGameAvailbaleForVerifiedPlayer", action, Json.Decode(json.toString()));
    }

    internal void IsGame4AvailbaleForVerifiedPlayer(SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("language", Utility.Instance.CurrentLanguage);
        Debug.Log($"isGameAvailbaleForVerifiedPlayer: {json.toString()}");
        GameSocketManager.SocketGame4.Emit("isGameAvailbaleForVerifiedPlayer", action, Json.Decode(json.toString()));
    }

    public void HallGameList(string gameId, SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("gameId", gameId);
        Debug.Log($"HallGameList: {json.toString()}");
        GameSocketManager.SocketGame1.Emit("HallGameList", action, Json.Decode(json.toString()));
    }

    public void GetGame3PurchaseData(string gameId, SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("gameId", gameId);
        json.put("language", Utility.Instance.CurrentLanguage);
        Debug.Log($"GetGame3PurchaseData: {json.toString()}");
        GameSocketManager.SocketGame3.Emit("GetGame3PurchaseData", action, Json.Decode(json.toString()));
    }

    public void PurchaseGame3Tickets(string gameId, int ticketQty, string purchaseType, string voucherCode, SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("gameId", gameId);
        json.put("ticketQty", ticketQty);
        json.put("purchaseType", purchaseType);
        json.put("voucherCode", voucherCode);
        Debug.Log($"PurchaseGame3Tickets: {json.toString()}");
        GameSocketManager.SocketGame3.Emit("PurchaseGame3Tickets", action, Json.Decode(json.toString()));
    }

    public void GetGame1PurchaseData(string gameId, SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("gameId", gameId);
        Debug.Log($"GetGame1PurchaseData: {json.toString()}");
        GameSocketManager.SocketGame1.Emit("GetGame1PurchaseData", action, Json.Decode(json.toString()));
    }

    public void PurchaseGame1Tickets(string gameId, List<Game1TicketType> ticketList, string purchaseType, string voucherCode, SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("gameId", gameId);
        json.put("purchaseType", purchaseType);
        json.put("voucherCode", voucherCode);
        json.put("language", Utility.Instance.CurrentLanguage);

        Game1PurchasedTicketsList game1purchasedTicketList = new Game1PurchasedTicketsList();
        foreach (Game1TicketType ticketData in ticketList)
        {
            Game1TicketSubTypeBuyData newTicketData = new Game1TicketSubTypeBuyData();
            newTicketData.ticketType = ticketData.ticketType;
            newTicketData.ticketQty = ticketData.currentQty;
            game1purchasedTicketList.list.Add(newTicketData);
        }
        json.put("purchasedTickets", JsonUtility.ToJson(game1purchasedTicketList));

        Debug.Log($"PurchaseGame1Tickets: {json.toString()}");
        GameSocketManager.SocketGame1.Emit("PurchaseGame1Tickets", action, Json.Decode(json.toString()));
    }

    public void Blind_PurchaseGame1Tickets(string gameId, int luckyNumber, List<Game1TicketPurchase> ticketList, string purchaseType, string voucherCode)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("gameId", gameId);
        json.put("luckyNumber", luckyNumber);
        json.put("purchaseType", purchaseType);
        json.put("voucherCode", voucherCode);
        json.put("playerTicketType", "Online");

        Game1PurchasedTicketsList game1purchasedTicketList = new Game1PurchasedTicketsList();
        int length = ticketList.Count;
        for (int i = 0; i < length; i++)
            game1purchasedTicketList.list.Add(new Game1TicketSubTypeBuyData(ticketList[i].ticketName, ticketList[i].ticketQty));

        json.put("purchasedTickets", JsonUtility.ToJson(game1purchasedTicketList));
        Debug.Log($"PurchaseGame1Tickets: {json.toString()}");
        GameSocketManager.SocketGame1.Emit("PurchaseGame1Tickets",
            (socket, packet, args) =>
            {
                print($"Purchase Game 1 Tickets : {packet}");
                EventResponse res = JsonUtility.FromJson<EventResponse>(Utility.Instance.GetPacketString(packet));
                if (res.status.ToLower().Equals("success"))
                {
                    if (UIManager.Instance.game1Panel.Game_1_Data.gameId == gameId)
                        UIManager.Instance.lobbyPanel.gamePlanPanel.OnGame1ButtonTap();
                    else
                        UIManager.Instance.topBarPanel.hallGameListPanel.game1PurchaseTicket.Back_Btn();
                }
                else
                {
                    UIManager.Instance.topBarPanel.miniGamePlanPanel.ClosePanel();
                    UIManager.Instance.messagePopup.DisplayMessagePopup(res.message);
                }

                UIManager.Instance.selectPurchaseTypePanel.Close();
                UIManager.Instance.DisplayLoader(false);
            }, Json.Decode(json.toString()));
    }

    public void SwapTicket_Game_5(string ticketId, SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("gameId", UIManager.Instance.game5Panel.game5GamePlayPanel.game5Data.gameId);
        json.put("ticketId", ticketId);
        json.put("language", Utility.Instance.CurrentLanguage);
        Debug.Log($"SwapTicket: {json.toString()}");
        GameSocketManager.SocketGame5.Emit("SwapTicket", action, Json.Decode(json.toString()));
    }

    public void Replace_Elvis_Tickets(string gameId, string id1, string id2, int amount, string purchaseType, string voucherCode)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("gameId", gameId);
        json.put("ticketId1", id1);
        json.put("ticketId2", id2);
        json.put("replaceAmount", amount);
        json.put("purchaseType", purchaseType);
        json.put("voucherCode", voucherCode);
        json.put("playerTicketType", "Online");

        Debug.Log($"ReplaceElvisTickets: {json.toString()}");
        GameSocketManager.SocketGame1.Emit("ReplaceElvisTickets",
            (socket, packet, args) =>
            {
                EventResponse res = JsonUtility.FromJson<EventResponse>(Utility.Instance.GetPacketString(packet));
                if (res.status.ToLower().Equals("success"))
                {
                    UIManager.Instance.lobbyPanel.gamePlanPanel.OnGame1ButtonTap();
                    UIManager.Instance.topBarPanel.hallGameListPanel.game1ViewPurchaseTicket.gameObject.SetActive(false);
                    UIManager.Instance.messagePopup.DisplayMessagePopupAutoHide(res.message, true);
                }
                else
                {
                    UIManager.Instance.topBarPanel.miniGamePlanPanel.ClosePanel();
                    UIManager.Instance.messagePopup.DisplayMessagePopup(res.message);
                }

                UIManager.Instance.selectPurchaseTypePanel.Close();
                UIManager.Instance.DisplayLoader(false);
            }, Json.Decode(json.toString()));
    }

    public void CancelGameTickets(string namespaceString, string gameId, SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("gameId", gameId);
        json.put("language", Utility.Instance.CurrentLanguage);
        Debug.Log($"CancelGameTickets: {json.toString()}");
        GameSocketManager.socketManager?.GetSocket("/" + namespaceString).Emit("CancelGameTickets", action, Json.Decode(json.toString()));
    }

    public void View_Game_1_Purchased_Tickets(string gameId, SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("gameId", gameId);
        json.put("language", Utility.Instance.CurrentLanguage);
        Debug.Log($"ViewPurchasedTickets: {json.toString()}");
        GameSocketManager.SocketGame1.Emit("ViewPurchasedTickets", action, Json.Decode(json.toString()));
    }

    public void Set_Auto_Lucky_Number_For_Game_1(int lucky_Number, SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("luckyNumber", lucky_Number);
        json.put("isLuckyNumberEnabled", UIManager.Instance.settingPanel.Game_1_Lucky_Number_TG.isOn);
        Debug.Log($"SetLuckyNumber: {json.toString()}");
        AisSocket?.Emit("SetLuckyNumber", action, Json.Decode(json.toString()));
    }

    public void Get_Auto_Lucky_Number_For_Game_1(SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        Debug.Log($"GetLuckyNumber: {json.toString()}");
        AisSocket?.Emit("GetLuckyNumber", action, Json.Decode(json.toString()));
    }

    public void Game_1_Replace_Elvis_Ticket(string gameId, string ticketId1, string ticketId2, string purchaseType, int replaceAmount, SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("gameId", gameId);
        json.put("ticketId1", ticketId1);
        json.put("ticketId2", ticketId2);
        json.put("purchaseType", purchaseType);
        json.put("replaceAmount", replaceAmount);
        json.put("language", Utility.Instance.CurrentLanguage);
        Debug.Log($"Game_1_Replace_Elvis_Ticket: {json.toString()}");
        GameSocketManager.SocketGame1.Emit("ReplaceElvisTickets", action, Json.Decode(json.toString()));
    }

    public void SubscribeRoom(string namespaceString, string gameId, string previousGameId, SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("gameId", gameId);
        json.put("previousGameId", previousGameId);
        json.put("language", Utility.Instance.CurrentLanguage);
        Debug.Log("Subscribe: " + json.toString());
        GameSocketManager.socketManager?.GetSocket("/" + namespaceString).Emit("SubscribeRoom", action, Json.Decode(json.toString()));
    }

    public void SubscribeRoomGame1(string gameId, string previousGameId, SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("gameId", gameId);
        json.put("previousGameId", previousGameId);
        json.put("language", Utility.Instance.CurrentLanguage);
        Debug.Log("Subscribe Game 1: " + json.toString());
        GameSocketManager.SocketGame1.Emit("SubscribeRoom", action, Json.Decode(json.toString()));
    }

    public void SubscribeRoomGame2(string gameId, string previousGameId, SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("gameId", gameId);
        json.put("previousGameId", previousGameId);
        json.put("language", Utility.Instance.CurrentLanguage);
        Debug.Log("Subscribe Game 2: " + json.toString());
        GameSocketManager.SocketGame2.Emit("SubscribeRoom", action, Json.Decode(json.toString()));
    }

    public void UnSubscribeRoom(string namespaceString, string gameId, SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("gameId", gameId);
        json.put("language", Utility.Instance.CurrentLanguage);
        Debug.Log("LeftRoom: " + json.toString());
        GameSocketManager.SocketGame1.Emit("LeftRoom", action, Json.Decode(json.toString()));
    }

    public void UnSubscribeGame2Room(string gameId, SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("gameId", gameId);
        json.put("language", Utility.Instance.CurrentLanguage);
        Debug.Log("LeftRoom: " + json.toString());
        GameSocketManager.SocketGame2.Emit("LeftRoom", action, Json.Decode(json.toString()));
    }

    public void UnSubscribeGame3Room(string gameId, SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("gameId", gameId);
        json.put("language", Utility.Instance.CurrentLanguage);
        Debug.Log("Game 3 LeftRoom: " + json.toString());
        GameSocketManager.SocketGame3.Emit("LeftRoom", action, Json.Decode(json.toString()));
    }

    public void UnSubscribeGame5Room(string gameId, SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("gameId", gameId);
        json.put("language", Utility.Instance.CurrentLanguage);
        Debug.Log("Game 5 LeftRoom: " + json.toString());
        GameSocketManager.SocketGame5.Emit("LeftRoom", action, Json.Decode(json.toString()));
    }

    public void ApplyVoucherCode(Socket socket, string gameId, int ticketQty, string voucherCode, SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("gameId", gameId);
        json.put("ticketQty", ticketQty);
        json.put("voucherCode", voucherCode);
        json.put("language", Utility.Instance.CurrentLanguage);
        Debug.Log($"ApplyVoucherCode: {json.toString()}");
        socket.Emit("ApplyVoucherCode", action, Json.Decode(json.toString()));
    }

    public void Game4ThemesData(SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("appVersion", Utility.Instance.AppVersion);
        json.put("os", Utility.Instance.OSname);
        json.put("language", Utility.Instance.CurrentLanguage);
        Debug.Log("Game4ThemesData: " + json.toString());
        GameSocketManager.SocketGame4.Emit("Game4ThemesData", action, Json.Decode(json.toString()));
    }

    public void Game4Data(SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("language", Utility.Instance.CurrentLanguage);
        Debug.Log("Game4Data: " + json.toString());
        GameSocketManager.SocketGame4.Emit("Game4Data", action, Json.Decode(json.toString()));
    }

    public void Game5Data(SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("language", Utility.Instance.CurrentLanguage);
        Debug.Log("Game5Data: " + json.toString());
        GameSocketManager.SocketGame5.Emit("Game5Data", action, Json.Decode(json.toString()));
    }

    public void Game4ChangeTickets(string gameId, SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("gameId", gameId);
        json.put("language", Utility.Instance.CurrentLanguage);
        Debug.Log("Game4ChangeTickets: " + json.toString());
        GameSocketManager.SocketGame4.Emit("Game4ChangeTickets", action, Json.Decode(json.toString()));
    }

    public void Game4Play(string gameId, List<string> ticketList, int multiplierValue, int multiplierIndex, string purchaseType, string voucherCode, SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("gameId", gameId);
        json.put("ticketList", Utility.Instance.StringListToJsonString(ticketList));
        json.put("multiplierValue", multiplierValue);
        json.put("multiplierIndex", multiplierIndex);
        json.put("purchaseType", purchaseType);
        json.put("voucherCode", voucherCode);
        json.put("language", Utility.Instance.CurrentLanguage);
        Debug.Log("Game4Play: " + json.toString());
        GameSocketManager.SocketGame4.Emit("Game4Play", action, Json.Decode(json.toString()));
    }

    public void Game5Play(string gameId, List<(string id, int price)> ticketList, SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("gameId", gameId);
        json.put("purchasedTickets", Utility.Instance.StringListToJsonStringGame5(ticketList));
        json.put("language", Utility.Instance.CurrentLanguage);
        Debug.Log("Game5Play: " + json.toString());
        GameSocketManager.SocketGame5.Emit("Game5Play", action, Json.Decode(json.toString()));
    }

    public void WheelOfFortuneData(Socket socket, string gameId, SocketIOAckCallback action, string playerType = "Real")
    {
        JSON_Object json = new JSON_Object();
        json.put("playerType", playerType);
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("gameId", gameId);
        json.put("language", Utility.Instance.CurrentLanguage);
        Debug.Log("WheelOfFortuneData: " + json.toString());
        socket.Emit("WheelOfFortuneData", action, Json.Decode(json.toString()));
    }

    public void Game5WheelOfFortuneData(Socket socket, string gameId, string ticketId, SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("ticketId", ticketId);
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("gameId", gameId);
        json.put("language", Utility.Instance.CurrentLanguage);
        Debug.Log("WheelOfFortuneData: " + json.toString());
        socket.Emit("WheelOfFortuneData", action, Json.Decode(json.toString()));
    }

    public void Game5RouletteWheelData(Socket socket, string gameId, string ticketId, SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("ticketId", ticketId);
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("gameId", gameId);
        json.put("language", Utility.Instance.CurrentLanguage);
        Debug.Log("WheelOfFortuneData: " + json.toString());
        socket.Emit("WheelOfFortuneData", action, Json.Decode(json.toString()));
    }

    public void PlayWheelOfFortune(Socket socket, string gameId, SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("gameId", gameId);
        json.put("language", Utility.Instance.CurrentLanguage);
        Debug.Log("PlayWheelOfFortune: " + json.toString());
        socket.Emit("PlayWheelOfFortune", action, Json.Decode(json.toString()));
    }

    public void WheelOfFortuneFinished(Socket socket, string gameId, long winningPrize, SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("gameId", gameId);
        json.put("winningPrize", winningPrize);
        json.put("language", Utility.Instance.CurrentLanguage);
        Debug.Log("WheelOfFortuneFinished: " + json.toString());
        socket.Emit("WheelOfFortuneFinished", action, Json.Decode(json.toString()));
    }

    public void TreasureChestData(Socket socket, string gameId, SocketIOAckCallback action, string playerType = "Real")
    {
        JSON_Object json = new JSON_Object();
        json.put("playerType", playerType);
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("gameId", gameId);
        json.put("language", Utility.Instance.CurrentLanguage);
        Debug.Log("TreasureChestData: " + json.toString());
        socket.Emit("TreasureChestData", action, Json.Decode(json.toString()));
    }

    public void SelectTreasureChest(Socket socket, string gameId, SocketIOAckCallback action, string playerType = "Real")
    {
        if (!HasInternetConnection)
            return;

        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("gameId", gameId);
        json.put("playerType", playerType);
        json.put("language", Utility.Instance.CurrentLanguage);
        Debug.Log("SelectTreasureChest: " + json.toString());
        socket.Emit("SelectTreasureChest", action, Json.Decode(json.toString()));
    }

    public void SelectColorDraft(Socket socket, string gameId, string playerType, int turnCount, int selectedIndex, SocketIOAckCallback action)
    {
        if (!HasInternetConnection)
            return;

        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("gameId", gameId);
        json.put("playerType", playerType);
        json.put("turnCount", turnCount);
        json.put("selectedIndex", selectedIndex);
        json.put("language", Utility.Instance.CurrentLanguage);
        Debug.Log("SelectColorDraft : " + json.toString());
        socket.Emit("SelectColorDraft", action, Json.Decode(json.toString()));
    }

    public void SelectMystery(Socket socket, string gameId, string playerType, int turnCount, bool isHigherNumber, SocketIOAckCallback action)
    {
        if (!HasInternetConnection)
            return;

        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("gameId", gameId);
        json.put("playerType", playerType);
        json.put("turnCount", turnCount);
        json.put("isHigherNumber", isHigherNumber);
        json.put("language", Utility.Instance.CurrentLanguage);
        Debug.Log("SelectMystery : " + json.toString());
        socket.Emit("SelectMystery", action, Json.Decode(json.toString()));
    }

    public void SelectWofAuto(Socket socket, string gameId, string ticketId, SocketIOAckCallback action)
    {
        if (!HasInternetConnection)
            return;

        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("gameId", gameId);
        json.put("ticketId", ticketId);
        json.put("language", Utility.Instance.CurrentLanguage);
        Debug.Log("SelectWofAuto: " + json.toString());
        socket.Emit("SelectWofAuto", action, Json.Decode(json.toString()));
    }

    public void SelectRouletteAuto(Socket socket, string gameId, string ticketId, string playerType, int spinCount, SocketIOAckCallback action)
    {
        if (!HasInternetConnection)
            return;

        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("gameId", gameId);
        json.put("ticketId", ticketId);
        json.put("playerType", playerType);
        json.put("spinCount", spinCount);
        json.put("language", Utility.Instance.CurrentLanguage);
        Debug.Log("SelectRouletteAuto: " + json.toString());
        socket.Emit("SelectRouletteAuto", action, Json.Decode(json.toString()));
    }

    public void MysteryGameData(Socket socket, string gameId, SocketIOAckCallback action, string playerType = "Real")
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("gameId", gameId);
        json.put("playerType", playerType);
        json.put("language", Utility.Instance.CurrentLanguage);
        Debug.Log("MysteryGameData: " + json.toString());
        socket.Emit("MysteryGameData", action, Json.Decode(json.toString()));
    }

    public void MysteryGameFinished(Socket socket, string gameId, long winningPrize, SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("gameId", gameId);
        json.put("winningPrize", winningPrize);
        json.put("language", Utility.Instance.CurrentLanguage);
        Debug.Log("MysteryGameFinished: " + json.toString());
        socket.Emit("MysteryGameFinished", action, Json.Decode(json.toString()));
    }

    public void ColorDraftGameData(Socket socket, string gameId, SocketIOAckCallback action, string playerType = "Real")
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("gameId", gameId);
        json.put("playerType", playerType);
        json.put("language", Utility.Instance.CurrentLanguage);
        Debug.Log("ColorDraftGameData: " + json.toString());
        socket.Emit("ColorDraftGameData", action, Json.Decode(json.toString()));
    }

    public void SelectLuckyNumberGame1(string namespaceString, string gameId, int luckyNumber, SocketIOAckCallback action)
    {
        JSON_Object jsonObj = new JSON_Object();
        jsonObj.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        jsonObj.put("gameId", gameId);
        jsonObj.put("luckyNumber", luckyNumber);
        jsonObj.put("language", Utility.Instance.CurrentLanguage);
        Debug.Log("SelectLuckyNumber Event: " + jsonObj.toString());
        GameSocketManager.SocketGame1.Emit("SelectLuckyNumber", action, Json.Decode(jsonObj.toString()));
    }

    public void SelectLuckyNumberGame2(string namespaceString, string gameId, int luckyNumber, SocketIOAckCallback action)
    {
        JSON_Object jsonObj = new JSON_Object();
        jsonObj.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        jsonObj.put("gameId", gameId);
        jsonObj.put("luckyNumber", luckyNumber);
        jsonObj.put("language", Utility.Instance.CurrentLanguage);
        Debug.Log("SelectLuckyNumber Event: " + jsonObj.toString());
        GameSocketManager.SocketGame2.Emit("SelectLuckyNumber", action, Json.Decode(jsonObj.toString()));
    }

    public void SelectLuckyNumberGame3(string namespaceString, string gameId, int luckyNumber, SocketIOAckCallback action)
    {
        JSON_Object jsonObj = new JSON_Object();
        jsonObj.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        jsonObj.put("gameId", gameId);
        jsonObj.put("luckyNumber", luckyNumber);
        jsonObj.put("language", Utility.Instance.CurrentLanguage);
        Debug.Log("SelectLuckyNumber Event: " + jsonObj.toString());
        GameSocketManager.SocketGame3.Emit("SelectLuckyNumber", action, Json.Decode(jsonObj.toString()));
    }

    public void GameChatHistory(string namespaceString, string gameId, SocketIOAckCallback action)
    {
        JSON_Object jsonObj = new JSON_Object();
        jsonObj.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        jsonObj.put("gameId", gameId);
        jsonObj.put("language", Utility.Instance.CurrentLanguage);
        Debug.Log("GameChatHistory Event: " + jsonObj.toString());
        GameSocketManager.socketManager?.GetSocket("/" + namespaceString).Emit("GameChatHistory", action, Json.Decode(jsonObj.toString()));
    }

    public void SendGameChat(string namespaceString, string gameId, string message, int emojiId, SocketIOAckCallback action)
    {
        if (!HasInternetConnection)
            return;

        JSON_Object jsonObj = new JSON_Object();
        jsonObj.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        jsonObj.put("gameId", gameId);
        jsonObj.put("message", message);
        jsonObj.put("emojiId", emojiId);
        jsonObj.put("language", Utility.Instance.CurrentLanguage);
        Debug.Log("SendGameChat Event: " + jsonObj.toString());
        GameSocketManager.socketManager?.GetSocket("/" + namespaceString).Emit("SendGameChat", action, Json.Decode(jsonObj.toString()));
    }

    public void Game2TicketPurchaseData(string gameId, SocketIOAckCallback action)
    {
        JSON_Object jsonObject = new JSON_Object();
        jsonObject.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        jsonObject.put("gameId", gameId);
        jsonObject.put("language", Utility.Instance.CurrentLanguage);
        Debug.Log("Namespace: " + GameSocketManager.SocketGame2.Namespace);
        Debug.Log("Game2TicketPurchaseData: " + jsonObject.toString());
        GameSocketManager.SocketGame2.Emit("Game2TicketPurchaseData", action, Json.Decode(jsonObject.toString()));
    }

    public void Game2TicketPurchaseData(string parentGameId, string subGameId, SocketIOAckCallback action)
    {
        JSON_Object jsonObject = new JSON_Object();
        jsonObject.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        jsonObject.put("parentGameId", parentGameId);
        jsonObject.put("subGameId", subGameId);
        Debug.Log("Namespace: " + GameSocketManager.SocketGame2.Namespace);
        Debug.Log("Game2TicketPurchaseData: " + jsonObject.toString());
        GameSocketManager.SocketGame2.Emit("Game2TicketPurchaseData", action, Json.Decode(jsonObject.toString()));
    }

    public void Game2BuyTickets(string gameId, string sub_Game_ID, int luckyNumber, List<string> ticketNumberList, bool autoPlay, string purchaseType, string voucherCode, SocketIOAckCallback action)
    {
        JSON_Object jsonObject = new JSON_Object();
        jsonObject.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        jsonObject.put("parentGameId", gameId);
        jsonObject.put("subGameId", sub_Game_ID);
        jsonObject.put("luckyNumber", luckyNumber);
        jsonObject.put("ticketNumberList", Utility.Instance.StringListToJsonString(ticketNumberList));
        jsonObject.put("autoPlay", autoPlay);
        jsonObject.put("purchaseType", purchaseType);
        jsonObject.put("voucherCode", voucherCode);
        jsonObject.put("language", Utility.Instance.CurrentLanguage);
        Debug.Log("Game2BuyTickets: " + jsonObject.toString());
        GameSocketManager.SocketGame2.Emit("Game2BuyTickets", action, Json.Decode(jsonObject.toString()));
    }

    public void CancelTicketGame1(string gameId, string ticketId1, string ticketId2, string ticketId3, SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("gameId", gameId);
        json.put("ticketId1", ticketId1);
        json.put("ticketId2", ticketId2);
        json.put("ticketId3", ticketId3);
        json.put("language", Utility.Instance.CurrentLanguage);
        Debug.Log($"CancelTicketGame1: {json.toString()}");
        GameSocketManager.SocketGame1.Emit("CancelTicket", action, Json.Decode(json.toString()));
    }

    public void CancelTicketGame3(string sub_Game_ID, string ticketId, SocketIOAckCallback action)
    {
        JSON_Object jsonObject = new JSON_Object();
        jsonObject.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        jsonObject.put("gameId", sub_Game_ID);
        jsonObject.put("ticketId", ticketId);
        jsonObject.put("language", Utility.Instance.CurrentLanguage);
        Debug.Log($"CancelTicket : {jsonObject.toString()}");
        GameSocketManager.SocketGame3.Emit("CancelTicket", action, Json.Decode(jsonObject.toString()));
    }

    public void CancelTicketGame2(string sub_Game_ID, string ticketId, SocketIOAckCallback action)
    {
        JSON_Object jsonObject = new JSON_Object();
        jsonObject.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        jsonObject.put("gameId", sub_Game_ID);
        jsonObject.put("ticketId", ticketId);
        jsonObject.put("language", Utility.Instance.CurrentLanguage);
        Debug.Log($"CancelTicket : {jsonObject.toString()}");
        GameSocketManager.SocketGame2.Emit("CancelTicket", action, Json.Decode(jsonObject.toString()));
    }

    public void Game1CancelTickets(string game_ID)
    {
        JSON_Object jsonObject = new JSON_Object();
        jsonObject.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        jsonObject.put("gameId", game_ID);
        jsonObject.put("language", Utility.Instance.CurrentLanguage);

        GameSocketManager.SocketGame1.Emit("CancelGame1Tickets", (socket, packet, args) =>
        {
            print($"CANCEL : {packet}");
            EventResponse res = JsonUtility.FromJson<EventResponse>(Utility.Instance.GetPacketString(packet));
            if (res.status.ToLower().Equals("success"))
            {
                UIManager.Instance.topBarPanel.OnMiniGamePlanPanelButtonTap();
                if (UIManager.Instance.game1Panel.Game_1_Data.gameId == game_ID)
                    UIManager.Instance.lobbyPanel.gamePlanPanel.OnGame1ButtonTap();
                else
                    UIManager.Instance.topBarPanel.hallGameListPanel.Open();
            }

            PlayerHallLimit((socket, packet, args) =>
            {
                Debug.Log("PlayerHallLimit: " + packet.ToString());
                EventResponse<PlayerApprovedHallsResponse> response = JsonUtility.FromJson<EventResponse<PlayerApprovedHallsResponse>>(Utility.Instance.GetPacketString(packet));
                if (response.status == Constants.EventStatus.SUCCESS)
                    UIManager.Instance.topBarPanel.SetSwitchHallDropdown(response.result.approvedHalls);
                else
                    UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
            });
        }, Json.Decode(jsonObject.toString()));
    }

    public void Game2CancelTickets(string sub_Game_ID)
    {
        JSON_Object jsonObject = new JSON_Object();
        jsonObject.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        jsonObject.put("parentGameId", UIManager.Instance.game2Panel.Game_2_Data.gameId);
        jsonObject.put("subGameId", sub_Game_ID);
        jsonObject.put("language", Utility.Instance.CurrentLanguage);

        GameSocketManager.SocketGame2.Emit("CancelGameTickets", (socket, packet, args) =>
        {
            print($"CANCEL : {packet}");
            EventResponse res = JsonUtility.FromJson<EventResponse>(Utility.Instance.GetPacketString(packet));
            if (res.status.ToLower().Equals("success"))
            {
                UIManager.Instance.game2Panel.game2PlayPanel.Clear_Tickets(sub_Game_ID);
                UIManager.Instance.game2Panel.game2PlayPanel.Clear_Luck_Number(sub_Game_ID);
                PlayerHallLimit((socket, packet, args) =>
                {
                    Debug.Log("PlayerHallLimit: " + packet.ToString());
                    EventResponse<PlayerApprovedHallsResponse> response = JsonUtility.FromJson<EventResponse<PlayerApprovedHallsResponse>>(Utility.Instance.GetPacketString(packet));
                    if (response.status == Constants.EventStatus.SUCCESS)
                        UIManager.Instance.topBarPanel.SetSwitchHallDropdown(response.result.approvedHalls);
                    else
                        UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
                });
            }
            else
            {
                UIManager.Instance.messagePopup.DisplayMessagePopup(res.message);
            }
        }, Json.Decode(jsonObject.toString()));
    }

    public void Game3CancelTickets(string sub_Game_ID)
    {
        JSON_Object jsonObject = new JSON_Object();
        jsonObject.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        jsonObject.put("parentGameId", UIManager.Instance.game2Panel.Game_2_Data.gameId);
        jsonObject.put("subGameId", sub_Game_ID);

        GameSocketManager.SocketGame3.Emit("CancelGameTickets", (socket, packet, args) =>
        {
            print($"CANCEL : {packet}");
            EventResponse res = JsonUtility.FromJson<EventResponse>(Utility.Instance.GetPacketString(packet));
            if (res.status.ToLower().Equals("success"))
            {
                UIManager.Instance.game3Panel.game3GamePlayPanel.Clear_Tickets(sub_Game_ID);
                UIManager.Instance.game3Panel.game3GamePlayPanel.Clear_Luck_Number(sub_Game_ID);
                UIManager.Instance.game3Panel.game3GamePlayPanel.Clear_total_Bet_Amount(sub_Game_ID);
                UIManager.Instance.topBarPanel.miniGamePlanPanel.Close();
            }

            PlayerHallLimit((socket, packet, args) =>
            {
                Debug.Log("PlayerHallLimit: " + packet.ToString());
                EventResponse<PlayerApprovedHallsResponse> response = JsonUtility.FromJson<EventResponse<PlayerApprovedHallsResponse>>(Utility.Instance.GetPacketString(packet));
                if (response.status == Constants.EventStatus.SUCCESS)
                    UIManager.Instance.topBarPanel.SetSwitchHallDropdown(response.result.approvedHalls);
                else
                    UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
            });
        }, Json.Decode(jsonObject.toString()));
    }

    public void Game2BlindPurchase(string purchaseType, string voucherCode)
    {
        JSON_Object jsonObject = new JSON_Object();
        jsonObject.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        jsonObject.put("parentGameId", UIManager.Instance.game2Panel.Game_2_Data.gameId);
        jsonObject.put("subGameId", UIManager.Instance.game2Panel.Sub_Game_ID_For_Blind_Purchase);
        jsonObject.put("luckyNumber", UIManager.Instance.game2Panel.Sub_Game_Lucky_Number_For_Blind_Purchase);
        jsonObject.put("ticketCount", UIManager.Instance.game2Panel.Blind_Ticket_Count);
        jsonObject.put("purchaseType", purchaseType);
        jsonObject.put("voucherCode", voucherCode);
        jsonObject.put("language", Utility.Instance.CurrentLanguage);

        GameSocketManager.SocketGame2.Emit("Game2BuyBlindTickets", (socket, packet, args) =>
        {
            Debug.Log("Game2BuyBlindTickets Responce : " + packet.ToString());
            EventResponse res = JsonUtility.FromJson<EventResponse>(Utility.Instance.GetPacketString(packet));
            if (res.status.ToLower().Equals("success"))
            {
                UIManager.Instance.lobbyPanel.gamePlanPanel.OnGame2ButtonTap();
            }
            else
            {
                UIManager.Instance.topBarPanel.miniGamePlanPanel.ClosePanel();
                UIManager.Instance.messagePopup.DisplayMessagePopup(res.message);
            }

            UIManager.Instance.selectPurchaseTypePanel.Close();
            UIManager.Instance.DisplayLoader(false);
        }, Json.Decode(jsonObject.toString()));
    }

    public void Game3Purchase(string purchaseType, string voucherCode)
    {
        JSON_Object jsonObject = new JSON_Object();
        jsonObject.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        jsonObject.put("parentGameId", UIManager.Instance.game3Panel.Game_3_Data.gameId);
        jsonObject.put("subGameId", UIManager.Instance.game3Panel.Sub_Game_ID_For_Purchase);
        jsonObject.put("ticketQty", UIManager.Instance.game3Panel.Puchase_Ticket_Count);
        jsonObject.put("purchaseType", purchaseType);
        jsonObject.put("voucherCode", voucherCode);
        jsonObject.put("language", Utility.Instance.CurrentLanguage);

        GameSocketManager.SocketGame3.Emit("PurchaseGame3Tickets", (socket, packet, args) =>
        {
            print($"PurchaseGame3Tickets Response : {packet.ToString()}");
            EventResponse res = JsonUtility.FromJson<EventResponse>(Utility.Instance.GetPacketString(packet));
            if (res.status.ToLower().Equals("success"))
            {
                UIManager.Instance.lobbyPanel.gamePlanPanel.OnGame3ButtonTap();
            }
            else
            {
                UIManager.Instance.topBarPanel.miniGamePlanPanel.ClosePanel();
                UIManager.Instance.messagePopup.DisplayMessagePopup(res.message);
            }

            UIManager.Instance.selectPurchaseTypePanel.Close();
            UIManager.Instance.DisplayLoader(false);
        }, Json.Decode(jsonObject.toString()));
    }

    internal void GameTypeList(SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        AisSocket?.Emit("GameTypeList", action, Json.Decode(json.toString()));
    }

    internal void Game1List(SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("gameId", UIManager.Instance.game1Panel.Game_1_Data.gameId);
        json.put("language", Utility.Instance.CurrentLanguage);
        print($"Game 1 List : {json.toString()}");
        GameSocketManager.socketManager?.GetSocket("/Game1").Emit("UpcomingGames", action, Json.Decode(json.toString()));
    }

    internal void Game2List(SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("language", Utility.Instance.CurrentLanguage);
        if (Utility.Instance.IsSplitScreenSupported)
            json.put("gameId", UIManager.Instance.splitScreenGameManager.game2Panel.GameId);
        else
            json.put("gameId", UIManager.Instance.game2Panel.GameId);
        json.put("hallId", UIManager.Instance.Player_Hall_ID);
        print($"Game 2 List : {json.toString()}");
        GameSocketManager.socketManager?.GetSocket("/Game2").Emit("Game2PlanList", action, Json.Decode(json.toString()));
    }

    internal void Game3List(SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("language", Utility.Instance.CurrentLanguage);
        if (Utility.Instance.IsSplitScreenSupported)
            json.put("gameId", UIManager.Instance.splitScreenGameManager.game3Panel.GameId);
        else
            json.put("gameId", UIManager.Instance.game3Panel.GameId);
        json.put("hallId", UIManager.Instance.Player_Hall_ID);
        print($"Game 3 List : {json.toString()}");
        GameSocketManager.SocketGame3.Emit("Game3PlanList", action, Json.Decode(json.toString()));
    }
}
