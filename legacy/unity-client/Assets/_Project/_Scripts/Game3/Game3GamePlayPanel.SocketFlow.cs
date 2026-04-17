using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public partial class Game3GamePlayPanel
{
    public bool isTimerReceived = false;

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
            return;
        }

        DisableBroadcasts();
        EnableBroadcasts();
        DisplayLoader(true);
        Upcoming_Game_UI.SetActive(false);
        Waiting_For_Next_Game.SetActive(false);

        if (SpilloramaGameBridge.LatestSnapshot != null)
        {
            Debug.Log("[Game3] CallSubscribeRoom: using Spillorama path");
            BingoGame3History history = SpilloramaGameBridge.BuildGame3History(SpilloramaGameBridge.LatestSnapshot);
            OnSubscribeRoom_Spillorama(history);
        }
        else
        {
            Debug.Log("[Game3] CallSubscribeRoom: Spillorama connected but no snapshot yet — waiting");
            StartCoroutine(WaitForSnapshotThenSubscribe_Game3());
        }
    }

    private void OnBallDrawn_Spillorama(BingoNumberData ball)
    {
        Debug.Log($"[Game3][Spillorama] OnBallDrawn_Spillorama: ball={ball.number}");
        TotalWithdrawCount = ball.totalWithdrawCount;
        WithdrawBingoBallAction(ball);
        UIManager.Instance.withdrawNumberHistoryPanel.AddNumber(ball);
        if (UIManager.Instance.gameAssetData.isVoiceOn == 1)
            SoundManager.Instance.PlayNorwegianMaleNumberAnnouncement(ball.number, false);
        Waiting_For_Next_Game.SetActive(false);
    }

    private void OnGameStart_Spillorama()
    {
        Debug.Log("[Game3][Spillorama] OnGameStart_Spillorama");
        SoundManager.Instance.ResetPlayedAnnouncements();
        isTimerReceived = true;
        Waiting_For_Next_Game.SetActive(false);
        btnBuyMore.interactable = false;
        foreach (var btn in ticketList) btn.deleteBtn.gameObject.SetActive(false);
    }

    private void OnGameFinish_Spillorama(string gameId)
    {
        Debug.Log($"[Game3][Spillorama] OnGameFinish_Spillorama gameId={gameId}");
        CallPlayerHallLimitEvent();
        foreach (var t in ticketList) { if (t.Blink_Tween != null) t.Stop_Blink(); }
        BackgroundManager.Instance.PlayerUpdateIntervalCall();
    }

    private void OnRoomState_Spillorama(SpilloramaSnapshotRaw snap)
    {
        if (snap == null) return;
        TotalRegisteredPlayerCount = snap.players?.Length ?? TotalRegisteredPlayerCount;
    }

    private void OnSubscribeRoom_Spillorama(BingoGame3History history)
    {
        Debug.Log($"[Game3][Spillorama] OnSubscribeRoom_Spillorama gameId={history.gameId}");
        BingoGame3History = history;
        CallPlayerHallLimitEvent();
        UIManager.Instance.gameAssetData.PreviousGameId = history.gameId;
        SoundManager.Instance.ResetPlayedAnnouncements();
        Reset();

        TotalRegisteredPlayerCount = history.activePlayers;
        TotalWithdrawCount         = history.totalWithdrawCount;
        MaxWithdrawCount           = history.maxWithdrawCount;
        isTimerReceived            = history.disableCancelButton;

        GenerateRowDetails(history.patternList);
        GeneratePatternList(history.patternList);
        jackpotUpdateDataUpdate(history.jackPotData ?? new JackPotData());
        GenerateWithdrawNumberList(history.withdrawNumberList);
        UIManager.Instance.withdrawNumberHistoryPanel.AddNumber(history.withdrawNumberList);
        Waiting_For_Next_Game.SetActive(history.withdrawNumberList.Count == 0);
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
        Debug.Log($"[Game3][Spillorama] Pattern won: {won.patternName} by {won.winnerId}");
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

    private void CallPlayerHallLimitEvent()
    {
        // Spillorama backend handles hall limits via REST — AIS socket call removed.
    }

    private void jackpotUpdateDataUpdate(JackPotData jackPotData)
    {
        PanelRowDetails.JackpotObject.SetActive(jackPotData.isDisplay);
        PanelRowDetails.txtJackpotDetails.text = jackPotData.isDisplay
            ? $"{jackPotData.draw} Jackpot : {jackPotData.winningAmount} kr"
            : "No Jackpot Data";
    }

    public void TicketDeleteBtnClose()
    {
        foreach (var btn in ticketList)
        {
            btn.deleteBtn.gameObject.SetActive(false);
        }
    }

    internal void Change_Profile_Pic(string playerID)
    {
        chatPanel.UpdatePlayerProfile(playerID);
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

    private IEnumerator WaitForSnapshotThenSubscribe_Game3()
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
            Debug.Log("[Game3] Snapshot received after wait — subscribing");
            BingoGame3History history = SpilloramaGameBridge.BuildGame3History(SpilloramaGameBridge.LatestSnapshot);
            OnSubscribeRoom_Spillorama(history);
        }
        else
        {
            Debug.LogWarning("[Game3] No snapshot after 10s — game data unavailable");
            DisplayLoader(false);
        }
    }
}
