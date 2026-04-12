using System.Collections;
using UnityEngine;

public partial class Game2GamePlayPanel
{
    public bool isTimerReceived = false;

    private void EnableBroadcasts()
    {
        if (!Application.isPlaying)
            return;

        Debug.Log("Game 2 broadcast on (Spillorama path)");
        SpilloramaGameBridge.OnBallDrawn           += OnBallDrawn_Spillorama;
        SpilloramaGameBridge.OnGameStarted         += OnGameStart_Spillorama;
        SpilloramaGameBridge.OnGameFinished        += OnGameFinish_Spillorama;
        SpilloramaGameBridge.OnRoomStateUpdated    += OnRoomState_Spillorama;
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
        SpilloramaGameBridge.OnSchedulerUpdated    -= OnScheduler_Spillorama;
    }

    public void CallSubscribeRoom()
    {
        if (!Application.isPlaying)
        {
            DisplayLoader(false);
            return;
        }

        DisplayLoader(true);
        Upcoming_Game_UI.SetActive(false);
        Waiting_For_Next_Game.SetActive(false);

        if (SpilloramaGameBridge.LatestSnapshot != null)
        {
            Debug.Log("[Game2] CallSubscribeRoom: using Spillorama path");
            DisableBroadcasts();
            EnableBroadcasts();
            BingoGame2History history = SpilloramaGameBridge.BuildGame2History(SpilloramaGameBridge.LatestSnapshot);
            OnSubscribeRoom_Spillorama(history);
        }
        else
        {
            Debug.Log("[Game2] CallSubscribeRoom: Spillorama connected but no snapshot yet — waiting");
            StartCoroutine(WaitForSnapshotThenSubscribe_Game2());
        }
    }

    private void CallPlayerHallLimitEvent()
    {
        // Spillorama backend handles hall limits via REST — AIS socket call removed.
    }

    public void TicketDeleteBtnClose()
    {
        foreach (var btn in ticketList)
        {
            btn.deleteBtn.gameObject.SetActive(false);
        }
    }

    private void OnBallDrawn_Spillorama(BingoNumberData ball)
    {
        Debug.Log($"[Game2][Spillorama] OnBallDrawn_Spillorama: ball={ball.number}");
        TotalWithdrawCount = ball.totalWithdrawCount;
        WithdrawBingoBallAction(ball);
        UIManager.Instance.withdrawNumberHistoryPanel.AddNumber(ball);
        if (UIManager.Instance.gameAssetData.isVoiceOn == 1 && bingoGame2History.isSoundPlay)
            SoundManager.Instance.PlayNorwegianMaleNumberAnnouncement(ball.number, false);
        PlayJackpotNumberWithdrawAnimation(ball.totalWithdrawCount);
        Waiting_For_Next_Game.SetActive(false);
        Lucky_Number_Btn.targetGraphic.raycastTarget = false;
    }

    private void OnGameStart_Spillorama()
    {
        Debug.Log("[Game2][Spillorama] OnGameStart_Spillorama");
        SoundManager.Instance.ResetPlayedAnnouncements();
        btnBuyMore.interactable = false;
        if (prefabGame2UpcomingGames.isActiveAndEnabled) prefabGame2UpcomingGames.Close();
        isTimerReceived = true;
        Waiting_For_Next_Game.SetActive(false);
        Lucky_Number_Panel.gameObject.SetActive(false);
        Lucky_Number_Btn.targetGraphic.raycastTarget = false;
        foreach (var btn in ticketList) btn.deleteBtn.gameObject.SetActive(false);
    }

    private void OnGameFinish_Spillorama(string gameId)
    {
        Debug.Log($"[Game2][Spillorama] OnGameFinish_Spillorama gameId={gameId}");
        CallPlayerHallLimitEvent();
        foreach (var t in ticketList) { if (t.Blink_Tween != null) t.Stop_Blink(); }
        BackgroundManager.Instance.PlayerUpdateIntervalCall();
    }

    private void OnRoomState_Spillorama(SpilloramaSnapshotRaw snap)
    {
        if (snap == null) return;
        TotalRegisteredPlayerCount = snap.players?.Length ?? TotalRegisteredPlayerCount;
    }

    private void OnSubscribeRoom_Spillorama(BingoGame2History history)
    {
        Debug.Log($"[Game2][Spillorama] OnSubscribeRoom_Spillorama gameId={history.gameId}");
        bingoGame2History = history;
        SoundManager.Instance.ResetPlayedAnnouncements();
        CallPlayerHallLimitEvent();
        UIManager.Instance.gameAssetData.PreviousGameId = history.gameId;
        Reset();

        IsGameRunning       = history.gameStarted;
        isTimerReceived     = history.gameStarted;
        TotalBetAmount      = history.totalBetAmount;
        btnBuyMore.interactable = !history.gameStarted;
        TotalRegisteredPlayerCount = history.activePlayers;
        TotalWithdrawCount  = history.totalWithdrawCount;

        GenerateWithdrawNumberList(history.withdrawNumberList);
        Waiting_For_Next_Game.SetActive(history.withdrawNumberList.Count == 0);
        UIManager.Instance.withdrawNumberHistoryPanel.AddNumber(history.withdrawNumberList);
        RunBestCardFirstAction();
        DisplayLoader(false);
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

    internal void Change_Profile_Pic(string playerID)
    {
        chatPanel.UpdatePlayerProfile(playerID);
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

    private IEnumerator WaitForSnapshotThenSubscribe_Game2()
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
            Debug.Log("[Game2] Snapshot received after wait — subscribing");
            DisableBroadcasts();
            EnableBroadcasts();
            BingoGame2History history = SpilloramaGameBridge.BuildGame2History(SpilloramaGameBridge.LatestSnapshot);
            OnSubscribeRoom_Spillorama(history);
        }
        else
        {
            Debug.LogWarning("[Game2] No snapshot after 10s — game data unavailable");
            DisplayLoader(false);
        }
    }
}
