using System;
using System.Globalization;
using BestHTTP.SocketIO;
using UnityEngine;

public partial class Game2GamePlayPanel
{
    public bool isTimerRecieved = false;

    private void EnableBroadcasts()
    {
        if (!Application.isPlaying)
            return;

        Debug.Log("Game 2 broadcast on");
        GameSocketManager.SocketGame2.On(Constants.BroadcastName.SubscribeRoom, OnSubscribeRoom);
        GameSocketManager.SocketGame2.On(Constants.BroadcastName.UpdatePlayerRegisteredCount, OnUpdatePlayerRegisteredCount);
        GameSocketManager.SocketGame2.On(Constants.BroadcastName.GameStartWaiting, OnGameStartWaiting);
        GameSocketManager.SocketGame2.On(Constants.BroadcastName.GameStart, OnGameStart);
        GameSocketManager.SocketGame2.On(Constants.BroadcastName.WithdrawBingoBall, OnWithdrawBingoBall);
        GameSocketManager.SocketGame2.On(Constants.BroadcastName.TicketCompleted, OnTicketCompleted);
        GameSocketManager.SocketGame2.On(Constants.BroadcastName.GameFinish, OnGameFinish);
        GameSocketManager.SocketGame2.On(Constants.BroadcastName.GameTerminate, OnGameTerminate);
        GameSocketManager.SocketGame2.On(Constants.BroadcastName.GameStartTimer, On_Start_Timer_Broadcast);
        GameSocketManager.SocketGame2.On(Constants.BroadcastName.GameRefreshRoom, On_Game_2_Refresh_Room);
        GameSocketManager.SocketGame2.On(Constants.BroadcastName.JackpotListUpdate, On_Jackpot_List_Update);
        GameSocketManager.socketManager.Socket.On(Constants.BroadcastName.BreakTimeStart, OnBreak);
    }

    private void DisableBroadcasts()
    {
        if (!Application.isPlaying)
            return;

        Debug.Log("Game 2 broadcast off");
        GameSocketManager.SocketGame2.Off(Constants.BroadcastName.SubscribeRoom);
        GameSocketManager.SocketGame2.Off(Constants.BroadcastName.UpdatePlayerRegisteredCount);
        GameSocketManager.SocketGame2.Off(Constants.BroadcastName.GameStartWaiting);
        GameSocketManager.SocketGame2.Off(Constants.BroadcastName.GameStart);
        GameSocketManager.SocketGame2.Off(Constants.BroadcastName.WithdrawBingoBall);
        GameSocketManager.SocketGame2.Off(Constants.BroadcastName.TicketCompleted);
        GameSocketManager.SocketGame2.Off(Constants.BroadcastName.GameFinish);
        GameSocketManager.SocketGame2.Off(Constants.BroadcastName.GameTerminate);
        GameSocketManager.SocketGame2.Off(Constants.BroadcastName.GameStartTimer);
        GameSocketManager.SocketGame2.Off(Constants.BroadcastName.GameRefreshRoom);
        GameSocketManager.SocketGame2.Off(Constants.BroadcastName.JackpotListUpdate);
        GameSocketManager.socketManager.Socket.Off(Constants.BroadcastName.BreakTimeStart);
    }

    public void CallSubscribeRoom()
    {
        if (!Application.isPlaying)
        {
            DisplayLoader(false);
            Debug.Log("[EditModeSmoke] Skipping Game2 SubscribeRoom.");
            return;
        }

        DisplayLoader(true);
        Upcoming_Game_UI.SetActive(false);
        Waiting_For_Next_Game.SetActive(false);

        DisableBroadcasts();
        EnableBroadcasts();

        EventManager.Instance.SubscribeRoomGame2(UIManager.Instance.game2Panel.Game_2_Data.gameId, UIManager.Instance.gameAssetData.PreviousGameId, (socket, packet, args) =>
        {
            Debug.Log("SubscribeRoom Emit Response: " + packet.ToString());
            BackgroundManager.Instance.PlayerUpdateIntervalCall();
            EventResponse response = JsonUtility.FromJson<EventResponse>(Utility.Instance.GetPacketString(packet));
            if (response.status == Constants.EventStatus.FAIL || response.messageType == Constants.MessageType.SomethingWentWrong)
            {
                DisplayLoader(false);
                if (response.messageType != "")
                    GetUtilityMessagePanel().DisplayMessagePopup(response.messageType);
                else
                    GetUtilityMessagePanel().DisplayMessagePopup(response.message);
                UIManager.Instance.topBarPanel.OnGamesButtonTap();
            }
        });
    }

    private void OnSubscribeRoom(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnSubscribeRoom Broadcast Response : " + packet.ToString());

        BingoGame2History gameHistory = JsonUtility.FromJson<BingoGame2History>(Utility.Instance.GetPacketString(packet));
        if (gameHistory.gameId != gameData.gameId)
        {
            SoundManager.Instance.ResetPlayedAnnouncements();
            return;
        }

        bingoGame2History = gameHistory;
        SoundManager.Instance.ResetPlayedAnnouncements();
        CallPlayerHallLimitEvent();
        UIManager.Instance.gameAssetData.PreviousGameId = gameData.gameId;
        Reset();

        IsGameRunning = gameHistory.gameStarted;
        isTimerRecieved = gameHistory.gameStarted;
        TotalBetAmount = gameHistory.totalBetAmount;
        btnBuyMore.interactable = !gameHistory.gameStarted;

        LuckyNumber = gameHistory.luckyNumber;
        New_Lucky_Number = LuckyNumber;
        toggleAutoPlay.isOn = gameHistory.autoPlay;
        TotalRegisteredPlayerCount = gameHistory.activePlayers;
        maxWithdrawCount = gameHistory.maxWithdrawCount;
        TotalWithdrawCount = gameHistory.totalWithdrawCount;
        Current_Sub_Game_ID = gameHistory.subGameId;

        GenerateTicketList(gameHistory.ticketList);
        GenerateJackpotList(gameHistory.jackpotList);
        GenerateWithdrawNumberList(gameHistory.withdrawNumberList);

        Waiting_For_Next_Game.SetActive(gameHistory.withdrawNumberList.Count == 0);
        foreach (var btn in ticketList)
        {
            btn.deleteBtn.gameObject.SetActive(!gameHistory.disableCancelButton);
        }

        HighlightLuckyNumber();
        RunBestCardFirstAction();
        UIManager.Instance.withdrawNumberHistoryPanel.AddNumber(gameHistory.withdrawNumberList);
        chatPanel.InitiateChatFeatureSubGame(UIManager.Instance.game2Panel.Game_2_Data.gameId, "Game2");
        if (Lucky_Number_Btn != null)
            Lucky_Number_Btn.targetGraphic.raycastTarget = gameHistory.ticketList.Count > 0 && gameHistory.withdrawNumberList.Count == 0;
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
        SoundManager.Instance.ResetPlayedAnnouncements();
    }

    private void OnGameStart(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnGameStart: " + packet.ToString());
        SoundManager.Instance.ResetPlayedAnnouncements();
        btnBuyMore.interactable = false;

        if (prefabGame2UpcomingGames.isActiveAndEnabled)
            prefabGame2UpcomingGames.Close();
        isTimerRecieved = true;
        Waiting_For_Next_Game.SetActive(false);
        Lucky_Number_Panel.gameObject.SetActive(false);
        Lucky_Number_Btn.targetGraphic.raycastTarget = false;

        foreach (var btn in ticketList)
        {
            btn.deleteBtn.gameObject.SetActive(false);
        }
    }

    private void OnWithdrawBingoBall(Socket socket, Packet packet, object[] args)
    {
        BingoNumberData bingoNumberData = JsonUtility.FromJson<BingoNumberData>(Utility.Instance.GetPacketString(packet));
        TotalWithdrawCount = bingoNumberData.totalWithdrawCount;
        WithdrawBingoBallAction(bingoNumberData);
        UIManager.Instance.withdrawNumberHistoryPanel.AddNumber(bingoNumberData);
        if (UIManager.Instance.gameAssetData.isVoiceOn == 1 && bingoGame2History.isSoundPlay)
        {
            SoundManager.Instance.PlayNorwegianMaleNumberAnnouncement(bingoNumberData.number, false);
        }

        PlayJackpotNumberWithdrawAnimation(bingoNumberData.totalWithdrawCount);
        Waiting_For_Next_Game.SetActive(false);
        Lucky_Number_Btn.targetGraphic.raycastTarget = false;
    }

    private void PlayJackpotNumberWithdrawAnimation(int withdrawCount)
    {
        foreach (PrefabJackpotPanel jackpotPanel in jackpotPanelList)
        {
            if (jackpotPanel == null)
                continue;

            if (jackpotPanel.Number < withdrawCount && jackpotPanel.Number != 0)
            {
                if (jackpotPanel.Jackpot_CG != null)
                    jackpotPanel.Jackpot_CG.alpha = 0.5f;

                if (jackpotPanel.Number_Container != null)
                    LeanTween.scale(jackpotPanel.Number_Container, Vector3.one, 0.5f);
            }

            if (jackpotPanel.Number == withdrawCount || (jackpotPanel.data != null && int.Parse(jackpotPanel.data.number.Split('-')[0]) == withdrawCount))
            {
                jackpotPanel.PlayJackpotAnimation();
                break;
            }
        }
    }

    private void OnTicketCompleted(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnTicketCompleted: " + packet.ToString());
        TicketCompletedResponse ticketData = JsonUtility.FromJson<TicketCompletedResponse>(Utility.Instance.GetPacketString(packet));
        if (ticketData.gameId != Current_Sub_Game_ID)
            return;

        PrefabBingoGame2Ticket3x3 ticket = GetTicketById(ticketData.ticketId);
        if (ticket != null)
        {
            ticket.TicketCompleted = true;
            UIManager.Instance.LaunchWinningAnimation();
        }
    }

    private void OnGameFinish(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnGameFinish: " + packet.ToString());
        BingoGameFinishResponse bingoGameFinishResponse = JsonUtility.FromJson<BingoGameFinishResponse>(Utility.Instance.GetPacketString(packet));
        if (bingoGameFinishResponse.gameId != Current_Sub_Game_ID)
            return;

        CallPlayerHallLimitEvent();
        for (int i = 0; i < ticketList.Count; i++)
        {
            if (ticketList[i].Blink_Tween != null)
                ticketList[i].Stop_Blink();
        }

        foreach (PrefabBingoGame2Ticket3x3 ticket in ticketList)
        {
            ticket.WonAmount = bingoGameFinishResponse.winningAmount;
        }

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

    private void On_Start_Timer_Broadcast(Socket socket, Packet packet, object[] args)
    {
        GameTimer timer = JsonUtility.FromJson<GameTimer>(Utility.Instance.GetPacketString(packet));
        isTimerRecieved = true;
        Game2Timer_UI.SetActive(timer.remainingTime > 0);
        Game2_Player_Details.SetActive(timer.remainingTime == 0);
        Game2_Timer_Txt.text = timer.remainingTime.ToTime();
        Game2_Timer_Txt.color = Timer_Normal_Color;
        if (timer.remainingTime < 6)
        {
            TimerTxtAnim();
            Lucky_Number_Btn.targetGraphic.raycastTarget = false;
            btnBuyMore.interactable = false;
            prefabGame2UpcomingGames.Close();
        }
    }

    private void On_Game_2_Refresh_Room(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("On_Game_2_Refresh_Room Broadcast Response : " + packet.ToString());
        RefreshRoom res = JsonUtility.FromJson<RefreshRoom>(Utility.Instance.GetPacketString(packet));
        if (res.gameId != UIManager.Instance.game2Panel.Game_2_Data.gameId)
            return;

        isTimerRecieved = false;
        UIManager.Instance.messagePopup.OnCloseButtonTap();
        UIManager.Instance.lobbyPanel.gamePlanPanel.Game2(false);
    }

    private void On_Jackpot_List_Update(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("JackpotListUpdate: Broadcast" + packet.ToString());
        JackpotBroadcast gameHistory = JsonUtility.FromJson<JackpotBroadcast>(Utility.Instance.GetPacketString(packet));
        GenerateJackpotList(gameHistory.jackpotList);
    }

    private void OnBreak(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnBreak Broadcast: " + packet.ToString());
        BreakTime breakTime = JsonUtility.FromJson<BreakTime>(Utility.Instance.GetPacketString(packet));
        if (breakTime.startBreakTime != null && breakTime.endBreakTime != null)
        {
            Debug.Log("enter..break time");
            UIManager.Instance.startBreakTime = DateTimeOffset.Parse(breakTime.startBreakTime, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal);
            UIManager.Instance.endBreakTime = DateTimeOffset.Parse(breakTime.endBreakTime, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal);
            UIManager.Instance.isBreak = breakTime.isBreak;
            UIManager.Instance.breakTimePopup.OpenPanel(breakTime.gameType);
            if (BackgroundManager.Instance.checkBreakTime != null)
                StopCoroutine(BackgroundManager.Instance.checkBreakTime);
        }
    }

    private void TimerTxtAnim()
    {
        LeanTween.scale(Game2Timer_UI, Vector3.one * 0.85f, 0.25f)
            .setOnComplete(() =>
            {
                LeanTween.scale(Game2Timer_UI, Vector3.one * 1.15f, 0.5f)
                    .setOnComplete(() =>
                    {
                        LeanTween.scale(Game2Timer_UI, Vector3.one, 0.25f);
                    });
            });
        LeanTween.value(Game2_Timer_Txt.gameObject, Set_Color_Callback, Timer_Normal_Color, Timer_Blink_Color, 0.5f)
            .setOnComplete(() =>
            {
                LeanTween.value(Game2_Timer_Txt.gameObject, Set_Color_Callback, Timer_Blink_Color, Timer_Normal_Color, 0.5f);
            });
    }

    private void Set_Color_Callback(Color c)
    {
        c.a = 1f;
        Game2_Timer_Txt.color = c;
    }
}
