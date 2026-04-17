using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public partial class Game1GamePlayPanel
{
    public bool isTimerReceived = false;
    public BingoNumberData bingoNumberData;
    private bool isWithdraw = false;

    private void EnableBroadcasts()
    {
        if (!Application.isPlaying)
            return;

        SpilloramaGameBridge.OnBallDrawn           += OnBallDrawn_Spillorama;
        SpilloramaGameBridge.OnGameStarted         += OnGameStart_Spillorama;
        SpilloramaGameBridge.OnGameFinished        += OnGameFinish_Spillorama;
        SpilloramaGameBridge.OnRoomStateUpdated    += OnRoomState_Spillorama;
        SpilloramaGameBridge.OnPatternListUpdated  += OnPatternChange_Spillorama;
        SpilloramaGameBridge.OnPatternWon          += OnPatternWon_Spillorama;
        SpilloramaGameBridge.OnSchedulerUpdated    += OnScheduler_Spillorama;
    }

    private void DisableBroadcasts()
    {
        if (!Application.isPlaying)
            return;

        SpilloramaGameBridge.OnBallDrawn           -= OnBallDrawn_Spillorama;
        SpilloramaGameBridge.OnGameStarted         -= OnGameStart_Spillorama;
        SpilloramaGameBridge.OnGameFinished        -= OnGameFinish_Spillorama;
        SpilloramaGameBridge.OnRoomStateUpdated    -= OnRoomState_Spillorama;
        SpilloramaGameBridge.OnPatternListUpdated  -= OnPatternChange_Spillorama;
        SpilloramaGameBridge.OnPatternWon          -= OnPatternWon_Spillorama;
        SpilloramaGameBridge.OnSchedulerUpdated    -= OnScheduler_Spillorama;
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

        if (SpilloramaGameBridge.LatestSnapshot != null)
        {
            Debug.Log("[Game1] CallSubscribeRoom: using Spillorama path");
            DisableBroadcasts();
            EnableBroadcasts();
            BingoGame1History history = SpilloramaGameBridge.BuildGame1History(
                SpilloramaGameBridge.LatestSnapshot,
                UIManager.Instance.gameAssetData.PlayerId ?? "");
            OnSubscribeRoom_Spillorama(history);
        }
        else
        {
            Debug.Log("[Game1] CallSubscribeRoom: Spillorama connected but no snapshot yet — waiting for room:update");
            StartCoroutine(WaitForSnapshotThenSubscribe());
        }
    }

    private void CallPlayerHallLimitEvent()
    {
        // Spillorama backend handles hall limits via REST — AIS socket call removed.
        Debug.Log("[Game1] CallPlayerHallLimitEvent: skipped (Spillorama backend handles hall limits via REST)");
    }

    internal void Change_Profile_Pic(string playerID)
    {
        chatPanel.UpdatePlayerProfile(playerID);
    }

    private void jackpotUpdateDataUpdate(JackPotData jackPotData)
    {
        PanelRowDetails.JackpotObject.SetActive(jackPotData.isDisplay);
        PanelRowDetails.txtJackpotDetails.text = jackPotData.isDisplay
            ? $"{jackPotData.draw} Jackpot : {jackPotData.winningAmount} kr"
            : "No Jackpot Data";
    }

    private void OnBallDrawn_Spillorama(BingoNumberData ball)
    {
        Debug.Log($"[Game1][Spillorama] OnBallDrawn_Spillorama: ball={ball.number}");
        bingoNumberData = ball;
        isWithdraw = true;
        TotalWithdrawCount = ball.totalWithdrawCount;

        WithdrawBingoBallAction(ball);
        UIManager.Instance.withdrawNumberHistoryPanel.AddNumber(ball);

        if (UIManager.Instance.gameAssetData.isVoiceOn == 1)
        {
            if (UIManager.Instance.gameAssetData.selectedVoiceLanguage == 0)
                SoundManager.Instance.Game1PlayNorwegianMaleNumberAnnouncement(ball.number, false);
            else if (UIManager.Instance.gameAssetData.selectedVoiceLanguage == 1)
                SoundManager.Instance.PlayNorwegianFemaleNumberAnnouncement(ball.number, false);
            else
                SoundManager.Instance.PlayNumberAnnouncement(ball.number, true);
        }

        if (BingoGame1HistoryData != null)
            BingoGame1HistoryData.withdrawNumberList.Add(ball);

        if (ball.totalWithdrawCount == BuyMoreDisableFlagVal)
        {
            buyMoreTicket.interactable = false;
            Upcoming_Game1_Ticket_Set_Up_Close();
        }

        isTimerReceived = true;
        foreach (var btn in ticketList) btn.deleteBtn.gameObject.SetActive(false);
        isWithdraw = false;
    }

    private void OnGameStart_Spillorama()
    {
        Debug.Log("[Game1][Spillorama] OnGameStart_Spillorama");
        SoundManager.Instance.ResetPlayedAnnouncements();
        onGameStart = true;
        selectLuckyNumberPanel.ClosePanel();
        EditLuckyNumberEnable = false;
        Upcoming_Game_Purchase_UI.SetActive(false);
        isTimerReceived = true;
        LastWithdrawNumber = 0;
        Game_1_Timer.SetActive(false);
        Game_1_Timer_LBL.SetActive(false);
        foreach (var btn in ticketList) btn.deleteBtn.gameObject.SetActive(false);
        if (UIManager.Instance.game1Panel.Game_1_Data.gameName == "Elvis")
        {
            Tickets_Panel.SetActive(true);
            Elvis_Replace_Tickets_Panel.SetActive(false);
        }
        foreach (var cs in Elvis_Tickets)
        {
            cs.GetComponent<Game1ViewPurchaseElvisTicket>()?.deleteBtn.gameObject.SetActive(false);
        }
    }

    private void OnGameFinish_Spillorama(string gameId)
    {
        Debug.Log($"[Game1][Spillorama] OnGameFinish_Spillorama gameId={gameId}");
        onGameStart = false;
        foreach (var t in ticketList)
        {
            if (t.Blink_Tween != null) t.Stop_Blink();
            foreach (var cell in t.ticketCellList) cell.Stop_NumberBlink();
        }
        SoundManager.Instance.ResetPlayedAnnouncements();
        isTimerReceived = false;
        BackgroundManager.Instance.PlayerUpdateIntervalCall();
    }

    private void OnRoomState_Spillorama(SpilloramaSnapshotRaw snap)
    {
        if (snap == null) return;
        TotalRegisteredPlayerCount = snap.players?.Length ?? TotalRegisteredPlayerCount;
    }

    private void OnSubscribeRoom_Spillorama(BingoGame1History history)
    {
        Debug.Log($"[Game1][Spillorama] OnSubscribeRoom_Spillorama gameId={history.gameId}");
        BingoGame1HistoryData = history;
        UIManager.Instance.BingoButtonColor(history.isGamePaused);

        CallPlayerHallLimitEvent();
        UIManager.Instance.gameAssetData.PreviousGameId = history.gameId;
        Reset();

        TotalRegisteredPlayerCount = history.activePlayers;
        TotalBetAmount             = history.totalBetAmount;
        TotalProfitAmount          = history.totalWon;
        MaxWithdrawCount           = history.maxWithdrawCount;
        TotalWithdrawCount         = history.totalWithdrawCount;

        GenerateRowDetails(history.patternList);
        GeneratePatternList(history.patternList);
        jackpotUpdateDataUpdate(history.jackPotData ?? new JackPotData());

        GenerateWithdrawNumberList(history.withdrawNumberList);
        UIManager.Instance.withdrawNumberHistoryPanel.AddNumber(history.withdrawNumberList);

        isTimerReceived = history.gameStatus == "running";

        if (!Is_AnyGame_Running && history.ticketList.Count == 0)
            Upcoming_Game1_Ticket_Set_Up();
        else
            Upcoming_Game_Purchase_UI.SetActive(false);

        DisplayLoader(false);
    }

    private void OnPatternChange_Spillorama(List<PatternData> patternList)
    {
        if (patternList == null) return;
        GenerateRowDetails(patternList);
        GeneratePatternList(patternList);
    }

    private void OnPatternWon_Spillorama(SpilloramaPatternWonRaw won)
    {
        if (won == null) return;
        Debug.Log($"[Game1][Spillorama] Pattern won: {won.patternName} by {won.winnerId}");
    }

    private void OnScheduler_Spillorama(SpilloramaSchedulerRaw scheduler)
    {
        if (scheduler == null) return;
        if (scheduler.millisUntilNextStart > 0 && !isTimerReceived)
        {
            int remainingSeconds = Mathf.CeilToInt((float)scheduler.millisUntilNextStart / 1000f);
            if (remainingSeconds > 0 && remainingSeconds <= 60)
            {
                isTimerReceived = true;
            }
        }
    }

    private IEnumerator WaitForSnapshotThenSubscribe()
    {
        float waited = 0f;
        if (SpilloramaSocketManager.Instance != null &&
            string.IsNullOrEmpty(SpilloramaSocketManager.ActiveRoomCode))
        {
            string hallId = UIManager.Instance.Player_Hall_ID ?? "";
            SpilloramaSocketManager.Instance.JoinRoom(hallId);
        }

        while (SpilloramaGameBridge.LatestSnapshot == null && waited < 10f)
        {
            waited += 0.3f;
            yield return new WaitForSeconds(0.3f);
        }

        if (SpilloramaGameBridge.LatestSnapshot != null)
        {
            Debug.Log("[Game1] Snapshot received after wait — subscribing");
            DisableBroadcasts();
            EnableBroadcasts();
            BingoGame1History history = SpilloramaGameBridge.BuildGame1History(
                SpilloramaGameBridge.LatestSnapshot,
                UIManager.Instance.gameAssetData.PlayerId ?? "");
            OnSubscribeRoom_Spillorama(history);
        }
        else
        {
            Debug.LogWarning("[Game1] No snapshot after 10s — game data unavailable");
            DisplayLoader(false);
        }
    }
}
