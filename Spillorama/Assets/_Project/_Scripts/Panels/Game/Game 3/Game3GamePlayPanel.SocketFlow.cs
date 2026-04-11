using System;
using System.Globalization;
using BestHTTP.SocketIO;
using I2.Loc;
using UnityEngine;

public partial class Game3GamePlayPanel
{
    public bool isTimerRecieved = false;

    private void EnableBroadcasts()
    {
        if (!Application.isPlaying)
            return;

        Debug.Log("Game 3 namespace: " + GameSocketManager.SocketGame3.Namespace);
        GameSocketManager.SocketGame3.On(Constants.BroadcastName.SubscribeRoom, OnSubscribeRoom);
        GameSocketManager.SocketGame3.On(Constants.BroadcastName.UpdatePlayerRegisteredCount, OnUpdatePlayerRegisteredCount);
        GameSocketManager.SocketGame3.On(Constants.BroadcastName.GameStartWaiting, OnGameStartWaiting);
        GameSocketManager.SocketGame3.On(Constants.BroadcastName.GameStart, OnGameStart);
        GameSocketManager.SocketGame3.On(Constants.BroadcastName.WithdrawBingoBall, OnWithdrawBingoBall);
        GameSocketManager.SocketGame3.On(Constants.BroadcastName.PatternChange, OnPatternChange);
        GameSocketManager.SocketGame3.On(Constants.BroadcastName.TicketCompleted, OnTicketCompleted);
        GameSocketManager.SocketGame3.On(Constants.BroadcastName.UpdateProfitAmount, OnUpdateProfitAmount);
        GameSocketManager.SocketGame3.On(Constants.BroadcastName.PatternWin, OnPatternWin);
        GameSocketManager.SocketGame3.On(Constants.BroadcastName.GameFinish, OnGameFinish);
        GameSocketManager.SocketGame3.On(Constants.BroadcastName.GameTerminate, OnGameTerminate);
        GameSocketManager.SocketGame3.On(Constants.BroadcastName.GameRefreshRoom, On_Game_3_Refresh_Room);
        GameSocketManager.SocketGame3.On(Constants.BroadcastName.GameStartTimer, On_Start_Timer_Broadcast);
        GameSocketManager.socketManager.Socket.On(Constants.BroadcastName.BreakTimeStart, OnBreak);
    }

    private void DisableBroadcasts()
    {
        if (!Application.isPlaying)
            return;

        GameSocketManager.SocketGame3.Off(Constants.BroadcastName.SubscribeRoom);
        GameSocketManager.SocketGame3.Off(Constants.BroadcastName.UpdatePlayerRegisteredCount);
        GameSocketManager.SocketGame3.Off(Constants.BroadcastName.GameStartWaiting);
        GameSocketManager.SocketGame3.Off(Constants.BroadcastName.GameStart);
        GameSocketManager.SocketGame3.Off(Constants.BroadcastName.WithdrawBingoBall);
        GameSocketManager.SocketGame3.Off(Constants.BroadcastName.PatternChange);
        GameSocketManager.SocketGame3.Off(Constants.BroadcastName.TicketCompleted);
        GameSocketManager.SocketGame3.Off(Constants.BroadcastName.UpdateProfitAmount);
        GameSocketManager.SocketGame3.Off(Constants.BroadcastName.PatternWin);
        GameSocketManager.SocketGame3.Off(Constants.BroadcastName.GameFinish);
        GameSocketManager.SocketGame3.Off(Constants.BroadcastName.GameTerminate);
        GameSocketManager.SocketGame3.Off(Constants.BroadcastName.GameRefreshRoom);
        GameSocketManager.SocketGame3.Off(Constants.BroadcastName.GameStartTimer);
        GameSocketManager.socketManager.Socket.Off(Constants.BroadcastName.BreakTimeStart);
    }

    public void CallSubscribeRoom()
    {
        if (!Application.isPlaying)
        {
            DisplayLoader(false);
            Debug.Log("[EditModeSmoke] Skipping Game3 SubscribeRoom.");
            return;
        }

        DisableBroadcasts();
        EnableBroadcasts();
        DisplayLoader(true);
        Upcoming_Game_UI.SetActive(false);
        Waiting_For_Next_Game.SetActive(false);
        EventManager.Instance.SubscribeRoom("Game3", gameData.gameId, UIManager.Instance.gameAssetData.PreviousGameId, (socket, packet, args) =>
        {
            Debug.Log("SubscribeRoom Emit Response: " + packet.ToString());
            BackgroundManager.Instance.PlayerUpdateIntervalCall();
            UIManager.Instance.selectPurchaseTypePanel.Close();
            EventResponse<BingoGame3History> response = JsonUtility.FromJson<EventResponse<BingoGame3History>>(Utility.Instance.GetPacketString(packet));
            Current_Sub_Game_ID = response.result.subGameId;
            UIManager.Instance.gameAssetData.PreviousGameId = Current_Sub_Game_ID;

            DisplayLoader(false);
            if (response.status == Constants.EventStatus.FAIL && response.messageType == Constants.MessageType.SomethingWentWrong)
            {
                GetUtilityMessagePanel().DisplayMessagePopup(response.messageType);
                UIManager.Instance.topBarPanel.OnGamesButtonTap();
                return;
            }

            Reset();
            EditLuckyNumberEnable = response.result.editLuckyNumber;
            LuckyNumber = response.result.luckyNumber;
            TotalRegisteredPlayerCount = response.result.activePlayers;
            MaxWithdrawCount = response.result.maxWithdrawCount;
            TotalWithdrawCount = response.result.totalWithdrawCount;

            GenerateTicketList(response.result.ticketList);
            GenerateRowDetails(response.result.patternList);
            GeneratePatternList(response.result.patternList);
            GenerateWithdrawNumberList(response.result.withdrawNumberList);
            foreach (var btn in ticketList)
            {
                btn.deleteBtn.gameObject.SetActive(!response.result.disableCancelButton);
            }

            btnBuyMore.interactable = !response.result.disableCancelButton;
            Waiting_For_Next_Game.SetActive(response.result.withdrawNumberList.Count == 0);
            selectLuckyNumberPanel.GenerateLuckyNumbers(response.result.luckyNumber);
            HighlightLuckyNumber();
            UIManager.Instance.withdrawNumberHistoryPanel.AddNumber(response.result.withdrawNumberList);
            chatPanel.InitiateChatFeatureSubGame(UIManager.Instance.game3Panel.Game_3_Data.gameId, "Game3");
        });
    }

    private void OnSubscribeRoom(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnSubscribeRoom: " + packet.ToString());
        BingoGame3History resp = JsonUtility.FromJson<BingoGame3History>(Utility.Instance.GetPacketString(packet));
        CallPlayerHallLimitEvent();
        BingoGame3History = resp;
        SoundManager.Instance.ResetPlayedAnnouncements();
        PanelRowDetails.txtGameName.GetComponent<LocalizationParamsManager>().SetParameterValue("gameNumber", BingoGame3History.gameCount.ToString());
        PanelRowDetails.txtGameName.GetComponent<LocalizationParamsManager>().SetParameterValue("gameName", BingoGame3History.gameName.ToString());
        GenerateRowDetails(BingoGame3History.patternList);
        GeneratePatternList(BingoGame3History.patternList);
        jackpotUpdateDataUpdate(BingoGame3History.jackPotData);
        totalBetAmount = BingoGame3History.totalBetAmount;
        TotalProfitAmount = BingoGame3History.totalWon;
        if (BingoGame3History.subGameId != Current_Sub_Game_ID)
            return;

        Reset();
        isTimerRecieved = resp.disableCancelButton;
        GenerateRowDetails(BingoGame3History.patternList);
        GeneratePatternList(BingoGame3History.patternList);
        EditLuckyNumberEnable = BingoGame3History.editLuckyNumber;
        LuckyNumber = BingoGame3History.luckyNumber;
        TotalRegisteredPlayerCount = BingoGame3History.activePlayers;
        MaxWithdrawCount = BingoGame3History.maxWithdrawCount;
        TotalWithdrawCount = BingoGame3History.totalWithdrawCount;
        GenerateTicketList(resp.ticketList);
        foreach (var btn in ticketList)
        {
            btn.deleteBtn.gameObject.SetActive(!resp.disableCancelButton);
        }

        btnBuyMore.interactable = !resp.disableCancelButton;
        GenerateWithdrawNumberList(BingoGame3History.withdrawNumberList);
        selectLuckyNumberPanel.GenerateLuckyNumbers(BingoGame3History.luckyNumber);
        HighlightLuckyNumber();
        UIManager.Instance.withdrawNumberHistoryPanel.AddNumber(BingoGame3History.withdrawNumberList);
        DisplayLoader(false);
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

    private void OnBreak(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnBreak Broadcast: " + packet.ToString());
        BreakTime breakTime = JsonUtility.FromJson<BreakTime>(Utility.Instance.GetPacketString(packet));
        if (breakTime.startBreakTime != null && breakTime.endBreakTime != null)
        {
            UIManager.Instance.startBreakTime = DateTimeOffset.Parse(breakTime.startBreakTime, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal);
            UIManager.Instance.endBreakTime = DateTimeOffset.Parse(breakTime.endBreakTime, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal);
            UIManager.Instance.isBreak = breakTime.isBreak;
            UIManager.Instance.breakTimePopup.OpenPanel(breakTime.gameType);
            if (BackgroundManager.Instance.checkBreakTime != null)
                StopCoroutine(BackgroundManager.Instance.checkBreakTime);
        }
    }

    public void TicketDeleteBtnClose()
    {
        foreach (var btn in ticketList)
        {
            btn.deleteBtn.gameObject.SetActive(false);
        }
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
    }

    private void OnGameStart(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnGameStart: " + packet.ToString());
        Game3Timer_UI.SetActive(false);
        Waiting_For_Next_Game.SetActive(false);
        selectLuckyNumberPanel.ClosePanel();
        BuyMoreBoardsclose();
        UIManager.Instance.topBarPanel.miniGamePlanPanel.Close();
        EditLuckyNumberEnable = false;
        foreach (var btn in ticketList)
        {
            btn.deleteBtn.gameObject.SetActive(false);
        }
    }

    private void OnWithdrawBingoBall(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnWithdrawBingoBall: " + packet.ToString());
        BingoNumberData bingoNumberData = JsonUtility.FromJson<BingoNumberData>(Utility.Instance.GetPacketString(packet));
        TotalWithdrawCount = bingoNumberData.totalWithdrawCount;
        WithdrawBingoBallAction(bingoNumberData);
        BingoGame3History.withdrawNumberList.Add(bingoNumberData);
        if (UIManager.Instance.gameAssetData.isVoiceOn == 1 && BingoGame3History.isSoundPlay)
        {
            SoundManager.Instance.PlayNorwegianMaleNumberAnnouncement(bingoNumberData.number, false);
        }

        UIManager.Instance.withdrawNumberHistoryPanel.AddNumber(bingoNumberData);
        Waiting_For_Next_Game.SetActive(false);
        foreach (var btn in ticketList)
        {
            btn.deleteBtn.gameObject.SetActive(false);
        }
    }

    private void OnPatternChange(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnPatternChange: " + packet.ToString());
        PatternChangeResponse patternList = JsonUtility.FromJson<PatternChangeResponse>(Utility.Instance.GetPacketString(packet));
        BingoGame3History.patternList = patternList.patternList;
        GenerateRowDetails(patternList.patternList);
        GeneratePatternList(patternList.patternList);
        jackpotUpdateDataUpdate(patternList.jackPotData);

        foreach (PrefabBingoGame3Ticket5x5 ticket in ticketList)
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

    private void OnTicketCompleted(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnTicketCompleted: " + packet.ToString());
        TicketCompletedResponse ticketData = JsonUtility.FromJson<TicketCompletedResponse>(Utility.Instance.GetPacketString(packet));
        if (ticketData.gameId != Current_Sub_Game_ID)
            return;

        foreach (PrefabBingoGame3Ticket5x5 tickets in ticketList)
        {
            tickets.Stop_Blink();
            foreach (BingoTicketSingleCellData item in tickets.ticketCellList)
            {
                item.Stop_NumberBlink();
            }
        }

        PrefabBingoGame3Ticket5x5 ticket = GetTicketById(ticketData.ticketId);
        ticket.Togo_Txt.text = Constants.LanguageKey.PatternCompletedMessage;
        if (ticket != null)
        {
            ticket.WonAmount = ticketData.winningAmount;
            ticket.TicketCompleted = true;
            UIManager.Instance.LaunchWinningAnimation();
        }
    }

    private void OnUpdateProfitAmount(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("UpdateProfitAmount: Response" + packet.ToString());
        UpdateWonAmountResponse responseData = JsonUtility.FromJson<UpdateWonAmountResponse>(Utility.Instance.GetPacketString(packet));
        TotalProfitAmount = responseData.totalWon;
    }

    private void OnPatternWin(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnPatternWin: " + packet.ToString());
        TicketCompletedResponse ticketData = JsonUtility.FromJson<TicketCompletedResponse>(Utility.Instance.GetPacketString(packet));
        if (ticketData.gameId != Current_Sub_Game_ID)
            return;

        PrefabBingoGame3Ticket5x5 ticket = GetTicketById(ticketData.ticketId);
        if (ticket != null)
        {
            ticket.Togo_Txt.text = Constants.LanguageKey.PatternCompletedMessage;
            ticket.WonAmount = ticketData.winningAmount;
            ticket.PatternWonResult = "";
        }
    }

    private void OnGameFinish(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnGameFinish: " + packet.ToString());
        BingoGameFinishResponse bingoGameFinishResponse = JsonUtility.FromJson<BingoGameFinishResponse>(Utility.Instance.GetPacketString(packet));
        if (bingoGameFinishResponse.gameId != Current_Sub_Game_ID)
            return;

        btnBuyMore.interactable = true;
        for (int i = 0; i < ticketList.Count; i++)
        {
            if (ticketList[i].Blink_Tween != null)
                ticketList[i].Stop_Blink();

            foreach (BingoTicketSingleCellData item in ticketList[i].ticketCellList)
            {
                item.Stop_NumberBlink();
            }
        }

        if (bingoGameFinishResponse.message != "")
            BackgroundManager.Instance.PlayerUpdateIntervalCall();
    }

    private void OnGameTerminate(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnGameTerminate: " + packet.ToString());
        GameTerminateResponse gameTerminateResponse = JsonUtility.FromJson<GameTerminateResponse>(Utility.Instance.GetPacketString(packet));
        if (gameTerminateResponse.gameId != gameData.gameId)
            return;

        if (Utility.Instance.IsStandAloneVersion())
            ClosePanel();
        else
            UIManager.Instance.topBarPanel.OnGamesButtonTap();

        if (gameTerminateResponse.message.Length > 0)
            GetUtilityMessagePanel().DisplayMessagePopup(gameTerminateResponse.message);
    }

    internal void Change_Profile_Pic(string playerID)
    {
        chatPanel.UpdatePlayerProfile(playerID);
    }

    private void On_Game_3_Refresh_Room(Socket socket, Packet packet, object[] args)
    {
        print($"RefreshRoom : {packet}");
        RefreshRoom res = JsonUtility.FromJson<RefreshRoom>(Utility.Instance.GetPacketString(packet));
        print($"{res.gameId} != {UIManager.Instance.game3Panel.Game_3_Data.gameId} : {res.gameId != UIManager.Instance.game3Panel.Game_3_Data.gameId}");
        if (res.gameId != UIManager.Instance.game3Panel.Game_3_Data.gameId)
            return;

        isTimerRecieved = false;
        UIManager.Instance.messagePopup.OnCloseButtonTap();
        UIManager.Instance.lobbyPanel.gamePlanPanel.Game3();
    }

    private void On_Start_Timer_Broadcast(Socket socket, Packet packet, object[] args)
    {
        Debug.Log($"On_Start_Timer_Broadcast Response : {packet.ToString()}");
        GameTimer timer = JsonUtility.FromJson<GameTimer>(Utility.Instance.GetPacketString(packet));
        Game3Timer_UI.SetActive(timer.remainingTime > 0);
        isTimerRecieved = true;
        Game3_Timer_Txt.text = timer.remainingTime.ToTime();
        Game3_Timer_Txt.color = Timer_Normal_Color;
        if (timer.remainingTime < 6)
        {
            btnBuyMore.interactable = false;
        }

        foreach (var btn in ticketList)
        {
            btn.deleteBtn.gameObject.SetActive(false);
        }
    }

    private void TimerTxtAnim()
    {
        LeanTween.scale(Game3Timer_UI, Vector3.one, 0.25f)
            .setOnComplete(() =>
            {
                LeanTween.scale(Game3Timer_UI, Vector3.one * 1.15f, 0.5f)
                    .setOnComplete(() =>
                    {
                        LeanTween.scale(Game3Timer_UI, Vector3.one, 0.25f);
                    });
            });
        LeanTween.value(Game3_Timer_Txt.gameObject, Set_Color_Callback, Timer_Normal_Color, Timer_Blink_Color, 0.5f)
            .setOnComplete(() =>
            {
                LeanTween.value(Game3_Timer_Txt.gameObject, Set_Color_Callback, Timer_Blink_Color, Timer_Normal_Color, 0.5f);
            });
    }

    private void Set_Color_Callback(Color c)
    {
        c.a = 1f;
        Game3_Timer_Txt.color = c;
    }
}
