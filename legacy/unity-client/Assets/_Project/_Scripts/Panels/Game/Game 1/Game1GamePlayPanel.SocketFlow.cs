using System;
using System.Collections;
using System.Collections.Generic;
using BestHTTP.SocketIO;
using I2.Loc;
using UnityEngine;

public partial class Game1GamePlayPanel
{
    public bool isTimerRecieved = false;
    public BingoNumberData bingoNumberData;
    private bool isWithdraw = false;

    private void EnableBroadcasts()
    {
        if (!Application.isPlaying)
            return;

        GameSocketManager.SocketGame1.On(Constants.BroadcastName.SubscribeRoom, OnSubscribeRoom);
        GameSocketManager.SocketGame1.On(Constants.BroadcastName.UpdatePlayerRegisteredCount, OnUpdatePlayerRegisteredCount);
        GameSocketManager.SocketGame1.On(Constants.BroadcastName.countDownToStartTheGame, OnCountDownToStartTheGame);
        GameSocketManager.SocketGame1.On(Constants.BroadcastName.GameStartWaiting, OnGameStartWaiting);
        GameSocketManager.SocketGame1.On(Constants.BroadcastName.GameStart, OnGameStart);
        GameSocketManager.SocketGame1.On(Constants.BroadcastName.WithdrawBingoBall, OnWithdrawBingoBall);
        GameSocketManager.SocketGame1.On(Constants.BroadcastName.PatternChange, OnPatternChange);
        GameSocketManager.SocketGame1.On(Constants.BroadcastName.PatternCompleted, OnPatternCompleted);
        GameSocketManager.SocketGame1.On(Constants.BroadcastName.GameFinish, OnGameFinish);
        GameSocketManager.SocketGame1.On(Constants.BroadcastName.GameTerminate, OnGameTerminate);
        GameSocketManager.SocketGame1.On(Constants.BroadcastName.ActivateMiniGame, OnActivateMiniGame);
        GameSocketManager.SocketGame1.On(Constants.BroadcastName.GameRefreshRoom, On_Game_1_Refresh_Room);
        GameSocketManager.SocketGame1.On(Constants.BroadcastName.toggleGameStatus, On_Game_1_toggleGameStatus);
        GameSocketManager.SocketGame1.On(Constants.BroadcastName.nextGameStartCountDownTime, OnnextGameStartCountDownTime);
        GameSocketManager.SocketGame1.On(Constants.BroadcastName.BingoAnnouncement, OnBingoAnnouncement);
    }

    private void DisableBroadcasts()
    {
        if (!Application.isPlaying)
            return;

        GameSocketManager.SocketGame1.Off(Constants.BroadcastName.SubscribeRoom);
        GameSocketManager.SocketGame1.Off(Constants.BroadcastName.UpdatePlayerRegisteredCount);
        GameSocketManager.SocketGame1.Off(Constants.BroadcastName.countDownToStartTheGame);
        GameSocketManager.SocketGame1.Off(Constants.BroadcastName.GameStartWaiting);
        GameSocketManager.SocketGame1.Off(Constants.BroadcastName.GameStart);
        GameSocketManager.SocketGame1.Off(Constants.BroadcastName.WithdrawBingoBall);
        GameSocketManager.SocketGame1.Off(Constants.BroadcastName.PatternChange);
        GameSocketManager.SocketGame1.Off(Constants.BroadcastName.PatternCompleted);
        GameSocketManager.SocketGame1.Off(Constants.BroadcastName.GameFinish);
        GameSocketManager.SocketGame1.Off(Constants.BroadcastName.GameTerminate);
        GameSocketManager.SocketGame1.Off(Constants.BroadcastName.ActivateMiniGame);
        GameSocketManager.SocketGame1.Off(Constants.BroadcastName.GameRefreshRoom);
        GameSocketManager.SocketGame1.Off(Constants.BroadcastName.SelectMysteryBall);
        GameSocketManager.SocketGame1.Off(Constants.BroadcastName.toggleGameStatus);
        GameSocketManager.SocketGame1.Off(Constants.BroadcastName.nextGameStartCountDownTime);
        GameSocketManager.SocketGame1.Off(Constants.BroadcastName.BingoAnnouncement);
    }

    public void CallSubscribeRoom()
    {
        if (!Application.isPlaying)
        {
            DisplayLoader(false);
            Debug.Log("[EditModeSmoke] Skipping Game1 SubscribeRoom.");
            return;
        }

        DisplayLoader(true);
        EventManager.Instance.SubscribeRoomGame1(
            UIManager.Instance.game1Panel.Game_1_Data.gameId,
            UIManager.Instance.gameAssetData.PreviousGameId,
            (socket, packet, args) =>
            {
                Debug.Log("SubscribeRoom Emit Response: " + packet.ToString());
                EventResponse response = JsonUtility.FromJson<EventResponse>(Utility.Instance.GetPacketString(packet));
                if (response.status == Constants.EventStatus.FAIL)
                {
                    DisplayLoader(false);
                    GetUtilityMessagePanel().DisplayMessagePopup(response.messageType);
                    UIManager.Instance.topBarPanel.OnGamesButtonTap();
                    return;
                }

                DisableBroadcasts();
                EnableBroadcasts();
            }
        );
    }

    private void OnBingoAnnouncement(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnBingoAnnouncement: " + packet.ToString());
        JsonUtility.FromJson<BingoAnnouncementResponse>(Utility.Instance.GetPacketString(packet));
        SoundManager.Instance.BingoSound(false);
    }

    private void OnnextGameStartCountDownTime(Socket socket, Packet packet, object[] args)
    {
        Debug.LogError("nextGameStartCountDownTime : " + packet.ToString());
        NextGameData data = JsonUtility.FromJson<NextGameData>(Utility.Instance.GetPacketString(packet));
        string utcDateTimeStr = data.countDownTime;
        Debug.LogError("Raw UTC DateTime String: " + utcDateTimeStr);
        if (!string.IsNullOrEmpty(utcDateTimeStr))
        {
            try
            {
                DateTimeOffset utcDateTime;
                if (DateTimeOffset.TryParse(utcDateTimeStr, null, System.Globalization.DateTimeStyles.RoundtripKind, out utcDateTime))
                {
                    Game_1_Timer.SetActive(true);
                    DateTime localDateTime = utcDateTime.LocalDateTime;
                    Debug.LogError("Local DateTime: " + localDateTime.ToString("yyyy-MM-dd HH:mm:ss"));
                    nextGameTimer = StartCoroutine(StartCountdown(localDateTime));
                }
                else
                {
                    Debug.LogError("Invalid date format: " + utcDateTimeStr);
                }
            }
            catch (Exception ex)
            {
                Debug.LogError("Error parsing date: " + ex.Message);
            }
        }
        else
        {
            Debug.LogError("Error: countDownDateTime is null or empty.");
        }
    }

    private IEnumerator StartCountdown(DateTime targetTime)
    {
        while (true)
        {
            DateTime currentLocalTime = DateTime.Now;
            TimeSpan timeRemaining = targetTime - currentLocalTime;
            if (timeRemaining.TotalSeconds <= 0)
            {
                Game_1_Timer.SetActive(false);
                Game_1_Timer_Txt.text = "00:00:00";
                yield break;
            }

            Game_1_Timer_Txt.text = $"{timeRemaining.Minutes:D2}:{timeRemaining.Seconds:D2}";
            yield return new WaitForSeconds(1f);
        }
    }

    private void OnSubscribeRoom(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnSubscribeRoom: " + packet.ToString());
        BingoGame1History bingoGame1HistoryResp = JsonUtility.FromJson<BingoGame1History>(Utility.Instance.GetPacketString(packet));
        BingoGame1HistoryData = bingoGame1HistoryResp;
        UIManager.Instance.BingoButtonColor(BingoGame1HistoryData.isGamePaused);

        if (BingoGame1HistoryData.gameId != gameData.gameId)
        {
            isTimerRecieved = false;
            SoundManager.Instance.ResetPlayedAnnouncements();
            return;
        }

        CallPlayerHallLimitEvent();
        UIManager.Instance.gameAssetData.PreviousGameId = gameData.gameId;
        Reset();
        EditLuckyNumberEnable = BingoGame1HistoryData.editLuckyNumber;
        LuckyNumber = BingoGame1HistoryData.luckyNumber;
        TotalRegisteredPlayerCount = BingoGame1HistoryData.activePlayers;
        TotalBetAmount = BingoGame1HistoryData.totalBetAmount;
        TotalProfitAmount = BingoGame1HistoryData.totalWon;
        MaxWithdrawCount = BingoGame1HistoryData.maxWithdrawCount;
        TotalWithdrawCount = BingoGame1HistoryData.totalWithdrawCount;
        Replace_Amount = BingoGame1HistoryData.replaceAmount;
        BuyMoreDisableFlagVal = BingoGame1HistoryData.disableBuyAfterBalls;
        isReplaceDisabled = BingoGame1HistoryData.isReplaceDisabled;

        PanelRowDetails.txtGameName.GetComponent<LocalizationParamsManager>().SetParameterValue("gameNumber", BingoGame1HistoryData.gameCount.ToString());
        PanelRowDetails.txtGameName.GetComponent<LocalizationParamsManager>().SetParameterValue("gameName", BingoGame1HistoryData.gameName.ToString());
        GenerateTicketList(BingoGame1HistoryData.ticketList);
        jackpotUpdateDataUpdate(BingoGame1HistoryData.jackPotData);
        RestoreCountdownFromHistory();

        for (int i = Patterns.Count - 1; i > -1; i--)
        {
            if (Patterns[i] != null)
                Destroy(Patterns[i].gameObject);
        }
        Patterns.Clear();

        GenerateRowDetails(BingoGame1HistoryData.patternList);
        GeneratePatternList(BingoGame1HistoryData.patternList);
        GenerateWithdrawNumberList(BingoGame1HistoryData.withdrawNumberList);
        selectLuckyNumberPanel.GenerateLuckyNumbers(BingoGame1HistoryData.luckyNumber);
        HighlightLuckyNumber();
        UIManager.Instance.withdrawNumberHistoryPanel.AddNumber(BingoGame1HistoryData.withdrawNumberList);
        chatPanel.InitiateChatFeatureSubGame(UIManager.Instance.game1Panel.Game_1_Data.gameId, "Game1");
        GameMarkerId = GameMarkerId;
        DisplayLoader(false);

        if (!Is_AnyGame_Running)
        {
            if (BingoGame1HistoryData.ticketList.Count == 0)
            {
                if (BingoGame1HistoryData.isTestGame)
                {
                    Upcoming_Game_Purchase_UI.SetActive(false);
                    buyMoreTicket.interactable = false;
                }
                else
                {
                    Upcoming_Game1_Ticket_Set_Up();
                }
            }
            else
            {
                buyMoreTicket.interactable = true;
                Upcoming_Game_Purchase_UI.SetActive(false);
            }
        }
        else
        {
            buyMoreTicket.interactable = false;
            Upcoming_Game_Purchase_UI.SetActive(false);
        }

        isTimerRecieved = BingoGame1HistoryData.gameStatus == "running";
        ReconnectMiniGameIfNeeded();
    }

    private void RestoreCountdownFromHistory()
    {
        string utcDateTimeStr = BingoGame1HistoryData.countDownDateTime;
        Debug.LogError("Raw UTC DateTime String: " + utcDateTimeStr);
        if (string.IsNullOrEmpty(utcDateTimeStr))
        {
            Debug.LogError("Error: countDownDateTime is null or empty.");
            return;
        }

        try
        {
            DateTimeOffset utcDateTime;
            if (DateTimeOffset.TryParse(utcDateTimeStr, null, System.Globalization.DateTimeStyles.RoundtripKind, out utcDateTime))
            {
                DateTime localDateTime = utcDateTime.LocalDateTime;
                Debug.LogError("Local DateTime: " + localDateTime.ToString("yyyy-MM-dd HH:mm:ss"));
                Game_1_Timer.SetActive(true);
                nextGameTimer = StartCoroutine(StartCountdown(localDateTime));
            }
            else
            {
                Debug.LogError("Invalid date format: " + utcDateTimeStr);
            }
        }
        catch (Exception ex)
        {
            Debug.LogError("Error parsing date: " + ex.Message);
        }
    }

    private void ReconnectMiniGameIfNeeded()
    {
        if (BingoGame1HistoryData.gameStatus != "Finished")
            return;

        bool isPlayerTurn = BingoGame1HistoryData.minigameData.playerId == UIManager.Instance.gameAssetData.PlayerId;
        bool isMystery = BingoGame1HistoryData.gameName == "Mystery" || BingoGame1HistoryData.minigameData.gameName == "Mystery";
        bool isColorDraft = BingoGame1HistoryData.gameName == "Color Draft" || BingoGame1HistoryData.minigameData.gameName == "Color Draft";

        if (isMystery)
        {
            mysteryGamePanel.isForceReset = false;
            mysteryGamePanel.Can_Click_On_Box = isPlayerTurn;
            CallMysteryGameEvent();
            return;
        }

        if (isColorDraft)
        {
            colorDraftGamePanel.isForceReset = false;
            colorDraftGamePanel.Can_Click_On_Door = isPlayerTurn;
            CallColorDraftGameEvent();
            return;
        }

        if (!BingoGame1HistoryData.minigameData.isMinigameActivated)
            return;

        string gameName = BingoGame1HistoryData.minigameData.gameName;
        bool isMinigamePlayed = BingoGame1HistoryData.minigameData.isMinigamePlayed;
        bool isMinigameFinished = BingoGame1HistoryData.minigameData.isMinigameFinished;
        int turnTimer = (isMinigamePlayed && !isMinigameFinished) ? 0 : BingoGame1HistoryData.minigameData.turnTimer;

        switch (gameName)
        {
            case "Wheel of Fortune":
                newFortuneWheelManager.Can_Spin = isPlayerTurn;
                newFortuneWheelManager.ReconnectOpen(
                    GameSocketManager.SocketGame1,
                    BingoGame1HistoryData,
                    gameData.gameId,
                    BingoGame1HistoryData.minigameData.prizeList,
                    turnTimer,
                    BingoGame1HistoryData.minigameData.wonAmount,
                    BingoGame1HistoryData.isGamePaused,
                    BingoGame1HistoryData.pauseGameMessage,
                    UIManager.Instance.game1Panel.BackgroundSprite,
                    LocalizationManager.GetTranslation("Game 1"),
                    BingoGame1HistoryData.minigameData.isWofSpinStopped
                );
                break;
            case "Treasure Chest":
                treasureChestPanel.Can_Click_On_Box = isPlayerTurn;
                treasureChestPanel.ReconnectOpen(
                    GameSocketManager.SocketGame1,
                    gameData.gameId,
                    BingoGame1HistoryData.minigameData.prizeList,
                    turnTimer,
                    BingoGame1HistoryData.minigameData.wonAmount,
                    BingoGame1HistoryData.isGamePaused,
                    BingoGame1HistoryData.pauseGameMessage,
                    UIManager.Instance.game1Panel.BackgroundSprite,
                    LocalizationManager.GetTranslation("Game 1"),
                    BingoGame1HistoryData.minigameData.showAutoTurnCount,
                    BingoGame1HistoryData.minigameData.isMinigamePlayed
                );
                break;
            default:
                return;
        }
    }

    private void CallPlayerHallLimitEvent()
    {
        EventManager.Instance.PlayerHallLimit((socket, packet, args) =>
        {
            Debug.Log("PlayerHallLimit: " + packet.ToString());
            EventResponse<PlayerApprovedHallsResponse> response = JsonUtility.FromJson<EventResponse<PlayerApprovedHallsResponse>>(Utility.Instance.GetPacketString(packet));
            if (response.status == Constants.EventStatus.SUCCESS)
            {
                UIManager.Instance.topBarPanel.SetSwitchHallDropdown(response.result.approvedHalls);
            }
            else
            {
                Debug.Log("PlayerHallLimit: " + response.message);
                UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
            }
        });
    }

    private void OnUpdatePlayerRegisteredCount(Socket socket, Packet packet, object[] args)
    {
        Debug.Log($"UpdatePlayerRegisteredCount: {packet}");
        PlayerRegisteredCount data = JsonUtility.FromJson<PlayerRegisteredCount>(Utility.Instance.GetPacketString(packet));
        TotalRegisteredPlayerCount = data.playerRegisteredCount;
    }

    private void OnGameStartWaiting(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnGameStartWaiting: " + packet.ToString());
        SoundManager.Instance.ResetPlayedAnnouncements();
    }

    private void OnCountDownToStartTheGame(Socket socket, Packet packet, object[] args)
    {
        if (nextGameTimer != null)
            StopCoroutine(nextGameTimer);
        Debug.Log("OncountDownToStartTheGame: " + packet.ToString());

        Game1_Timer data = JsonUtility.FromJson<Game1_Timer>(Utility.Instance.GetPacketString(packet));
        if (data.gameId != UIManager.Instance.game1Panel.Game_1_Data.gameId)
            return;

        SoundManager.Instance.ResetPlayedAnnouncements();
        isTimerRecieved = true;
        Game_1_Timer_Txt.text = data.count.ToTime();
        Game_1_Timer.SetActive(true);
        Game_1_Timer_LBL.SetActive(true);
        if (data.count == 0)
        {
            LastWithdrawNumber = 0;
            Game_1_Timer.SetActive(false);
            Game_1_Timer_LBL.SetActive(false);
            isWithdraw = false;
        }

        if (UIManager.Instance.game1Panel.Game_1_Data.gameName == "Elvis")
        {
            Tickets_Panel.SetActive(true);
            Elvis_Replace_Tickets_Panel.SetActive(false);
        }

        foreach (var btn in ticketList)
        {
            btn.deleteBtn.gameObject.SetActive(false);
        }
        foreach (var cs in Elvis_Tickets)
        {
            Game1ViewPurchaseElvisTicket ticket = cs.GetComponent<Game1ViewPurchaseElvisTicket>();
            ticket.deleteBtn.gameObject.SetActive(false);
        }
    }

    private void OnGameStart(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnGameStart: " + packet.ToString());
        SoundManager.Instance.ResetPlayedAnnouncements();
        onGameStart = true;
        selectLuckyNumberPanel.ClosePanel();
        EditLuckyNumberEnable = false;
        Upcoming_Game_Purchase_UI.SetActive(false);
        isTimerRecieved = true;
        LastWithdrawNumber = 0;
        Game_1_Timer.SetActive(false);
        Game_1_Timer_LBL.SetActive(false);
        foreach (var btn in ticketList)
        {
            btn.deleteBtn.gameObject.SetActive(false);
        }

        if (UIManager.Instance.game1Panel.Game_1_Data.gameName == "Elvis")
        {
            Tickets_Panel.SetActive(true);
            Elvis_Replace_Tickets_Panel.SetActive(false);
        }
        foreach (var cs in Elvis_Tickets)
        {
            Game1ViewPurchaseElvisTicket ticket = cs.GetComponent<Game1ViewPurchaseElvisTicket>();
            ticket.deleteBtn.gameObject.SetActive(false);
        }
    }

    private void OnWithdrawBingoBall(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnWithdrawBingoBall: " + packet.ToString());
        BingoNumberData withdrawData = JsonUtility.FromJson<BingoNumberData>(Utility.Instance.GetPacketString(packet));
        bingoNumberData = withdrawData;
        isWithdraw = true;
        TotalWithdrawCount = withdrawData.totalWithdrawCount;

        if (withdrawData.isForPlayerApp)
        {
            WithdrawBingoBallAction(withdrawData);
            UIManager.Instance.withdrawNumberHistoryPanel.AddNumber(withdrawData);
            if (UIManager.Instance.gameAssetData.isVoiceOn == 1)
            {
                if (UIManager.Instance.gameAssetData.selectedVoiceLanguage == 0)
                    SoundManager.Instance.Game1PlayNorwegianMaleNumberAnnouncement(withdrawData.number, false);
                else if (UIManager.Instance.gameAssetData.selectedVoiceLanguage == 1)
                    SoundManager.Instance.PlayNorwegianFemaleNumberAnnouncement(withdrawData.number, false);
                else
                    SoundManager.Instance.PlayNumberAnnouncement(withdrawData.number, true);
            }
        }

        BingoGame1HistoryData.withdrawNumberList.Add(withdrawData);
        if (withdrawData.totalWithdrawCount == BuyMoreDisableFlagVal)
        {
            buyMoreTicket.interactable = false;
            Upcoming_Game1_Ticket_Set_Up_Close();
        }

        isTimerRecieved = true;
        foreach (var btn in ticketList)
        {
            btn.deleteBtn.gameObject.SetActive(false);
        }
        isWithdraw = false;
    }

    private void OnWithdrawBingoBallReset()
    {
        Debug.LogError("OnWithdrawBingoBallReset");
    }

    private void OnSampleWithdrawBingoBall(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnWithdrawBingoBall: " + packet.ToString());
        BingoNumberData withdrawData = JsonUtility.FromJson<BingoNumberData>(Utility.Instance.GetPacketString(packet));
        TotalWithdrawCount = withdrawData.totalWithdrawCount;
        WithdrawBingoBallAction(withdrawData);
        UIManager.Instance.withdrawNumberHistoryPanel.AddNumber(withdrawData);
        SoundManager.Instance.PlayNumberAnnouncement(withdrawData.number, true);
        BingoGame1HistoryData.withdrawNumberList.Add(withdrawData);
        if (withdrawData.totalWithdrawCount == BuyMoreDisableFlagVal)
        {
            buyMoreTicket.interactable = false;
            Upcoming_Game1_Ticket_Set_Up_Close();
        }
    }

    internal void Change_Profile_Pic(string playerID)
    {
        chatPanel.UpdatePlayerProfile(playerID);
    }

    private void OnPatternChange(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnPatternChange: " + packet.ToString());
        PatternChangeResponse patternList = JsonUtility.FromJson<PatternChangeResponse>(Utility.Instance.GetPacketString(packet));
        BingoGame1HistoryData.patternList = patternList.patternList;
        GenerateRowDetails(patternList.patternList);
        GeneratePatternList(patternList.patternList);
        jackpotUpdateDataUpdate(patternList.jackPotData);

        foreach (PrefabBingoGame1Ticket5x5 ticket in ticketList)
        {
            ticket.Stop_Blink();
            foreach (BingoTicketSingleCellData item in ticket.ticketCellList)
            {
                item.Stop_NumberBlink();
            }
        }
    }

    private void jackpotUpdateDataUpdate(JackPotData jackPotData)
    {
        PanelRowDetails.JackpotObject.SetActive(jackPotData.isDisplay);
        PanelRowDetails.txtJackpotDetails.text = jackPotData.isDisplay
            ? $"{jackPotData.draw} Jackpot : {jackPotData.winningAmount} kr"
            : "No Jackpot Data";
    }

    private void OnPatternCompleted(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnPatternCompleted: " + packet.ToString());
        PatternCompletedResponse ticketData = JsonUtility.FromJson<PatternCompletedResponse>(Utility.Instance.GetPacketString(packet));
        TotalProfitAmount = ticketData.totalWon;
        if (ticketData.gameId != gameData.gameId || ticketData.ticketList.Count == 0)
            return;

        foreach (PrefabBingoGame1Ticket5x5 ticket in ticketList)
        {
            ticket.Stop_Blink();
            foreach (BingoTicketSingleCellData item in ticket.ticketCellList)
            {
                item.Stop_NumberBlink();
            }
        }

        List<PatternCompletedData> fullHouseWonList = new List<PatternCompletedData>();
        PrefabBingoGame1Ticket5x5 wonTicket;
        foreach (PatternCompletedData ticketWonData in ticketData.ticketList)
        {
            wonTicket = GetTicketById(ticketWonData.ticketId);
            if (wonTicket == null)
                continue;

            if (ticketWonData.fullHouse)
            {
                fullHouseWonList.Add(ticketWonData);
                wonTicket.TicketCompleted = true;
            }
            else
            {
                wonTicket.PatternWonResult = ticketWonData.patternName;
            }
            wonTicket.Togo_Txt.text = ticketWonData.patternName;
        }

        if (fullHouseWonList.Count > 0)
        {
            string message = "";
            int index = 0;
            int lastIndex = fullHouseWonList.Count - 1;
            foreach (PatternCompletedData ticketFullHouseWonData in fullHouseWonList)
            {
                if (index == 0)
                {
                    message = Constants.LanguageKey.CongratulationsMessage + " " + ticketFullHouseWonData.patternName + " " + Constants.LanguageKey.TicketNumberMessage;
                }
                else if (index < lastIndex)
                {
                    message += ", ";
                }
                else if (index == lastIndex)
                {
                    message += " & ";
                }

                message += ticketFullHouseWonData.ticketNumber;
                if (index == lastIndex)
                    message += ".";

                index++;
            }
            UIManager.Instance.LaunchWinningAnimation();
        }
        else
        {
            UIManager.Instance.LaunchWinningAnimation();
        }
    }

    private void OnGameFinish(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnGameFinish: " + packet.ToString());
        BingoGameFinishResponse bingoGameFinishResponse = JsonUtility.FromJson<BingoGameFinishResponse>(Utility.Instance.GetPacketString(packet));
        if (bingoGameFinishResponse.gameId != gameData.gameId)
            return;

        onGameStart = false;
        for (int i = 0; i < ticketList.Count; i++)
        {
            if (ticketList[i].Blink_Tween != null)
                ticketList[i].Stop_Blink();
            foreach (BingoTicketSingleCellData item in ticketList[i].ticketCellList)
            {
                item.Stop_NumberBlink();
            }
        }

        SoundManager.Instance.ResetPlayedAnnouncements();
        isTimerRecieved = false;
        BackgroundManager.Instance.PlayerUpdateIntervalCall();
    }

    private void OnGameTerminate(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnGameTerminate: " + packet.ToString());
        GameTerminateResponse gameTerminateResponse = JsonUtility.FromJson<GameTerminateResponse>(Utility.Instance.GetPacketString(packet));
        if (gameTerminateResponse.gameId != gameData.gameId)
            return;

        onGameStart = false;
        if (Utility.Instance.IsStandAloneVersion())
            ClosePanel();
        else
            UIManager.Instance.topBarPanel.OnGamesButtonTap();
    }

    private void OnActivateMiniGame(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnActivateMiniGame: " + packet.ToString());
        ActivateMiniGameResponse miniGameData = JsonUtility.FromJson<ActivateMiniGameResponse>(Utility.Instance.GetPacketString(packet));
        if (miniGameData.gameId != gameData.gameId)
            return;

        switch (miniGameData.miniGameType)
        {
            case "wheelOfFortune":
                newFortuneWheelManager.isPaused = false;
                newFortuneWheelManager.Can_Spin = miniGameData.playerId == UIManager.Instance.gameAssetData.PlayerId;
                CallWheelOfFortuneEvent();
                break;
            case "treasureChest":
                treasureChestPanel.isPaused = false;
                treasureChestPanel.Can_Click_On_Box = miniGameData.playerId == UIManager.Instance.gameAssetData.PlayerId;
                CallTreasureChestEvent();
                break;
            case "Mystery":
                mysteryGamePanel.isPaused = false;
                mysteryGamePanel.Can_Click_On_Box = miniGameData.playerId == UIManager.Instance.gameAssetData.PlayerId;
                CallMysteryGameEvent();
                break;
            case "Color Draft":
                colorDraftGamePanel.isPaused = false;
                colorDraftGamePanel.Can_Click_On_Door = miniGameData.playerId == UIManager.Instance.gameAssetData.PlayerId;
                CallColorDraftGameEvent();
                break;
        }
    }

    private void On_Game_1_Refresh_Room(Socket socket, Packet packet, object[] args)
    {
        Debug.LogError(" On_Game_1_Refresh_Room: " + packet.ToString());
        isGameRefreshed = true;
        UIManager.Instance.messagePopup.OnCloseButtonTap();
        UIManager.Instance.lobbyPanel.gamePlanPanel.Game1(false);
    }

    private void On_Game_1_toggleGameStatus(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("On_Game_1_toggleGameStatus: " + packet.ToString());
        toggleGameStatus res = JsonUtility.FromJson<toggleGameStatus>(Utility.Instance.GetPacketString(packet));

        if (res.status.Equals("Pause"))
        {
            if (!res.bySystem && !res.isPauseWithoutAnnouncement)
            {
                UIManager.Instance.BingoButtonColor(true);
                SoundManager.Instance.BingoSound(true);
            }
            newFortuneWheelManager.isPaused = true;
            treasureChestPanel.isPaused = true;
            mysteryGamePanel.isPaused = true;
            colorDraftGamePanel.isPaused = true;
        }
        else
        {
            UIManager.Instance.BingoButtonColor(false);
            newFortuneWheelManager.isPaused = false;
            treasureChestPanel.isPaused = false;
            mysteryGamePanel.isPaused = false;
            colorDraftGamePanel.isPaused = false;
        }
    }
}
