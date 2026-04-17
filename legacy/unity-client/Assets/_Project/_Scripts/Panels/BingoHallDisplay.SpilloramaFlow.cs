using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// Spillorama socket integration for the BingoHallDisplay (TV screen).
/// Receives draw:new, room:update, and pattern:won events from SpilloramaGameBridge
/// and drives the existing bingoBallPanelManager + UI elements — no admin socket needed.
/// </summary>
public partial class BingoHallDisplay
{
    // ── Subscribe / Unsubscribe ───────────────────────────────────────────────

    private void EnableSpilloramaBroadcasts()
    {
        if (!Application.isPlaying) return;

        SpilloramaGameBridge.OnBallDrawn        += OnBallDrawn_TV;
        SpilloramaGameBridge.OnRoomStateUpdated += OnRoomState_TV;
        SpilloramaGameBridge.OnGameStarted      += OnGameStarted_TV;
        SpilloramaGameBridge.OnGameFinished     += OnGameFinished_TV;
        SpilloramaGameBridge.OnPatternWon       += OnPatternWon_TV;
    }

    private void DisableSpilloramaBroadcasts()
    {
        if (!Application.isPlaying) return;

        SpilloramaGameBridge.OnBallDrawn        -= OnBallDrawn_TV;
        SpilloramaGameBridge.OnRoomStateUpdated -= OnRoomState_TV;
        SpilloramaGameBridge.OnGameStarted      -= OnGameStarted_TV;
        SpilloramaGameBridge.OnGameFinished     -= OnGameFinished_TV;
        SpilloramaGameBridge.OnPatternWon       -= OnPatternWon_TV;
    }

    // ── Handlers ──────────────────────────────────────────────────────────────

    /// draw:new — show new ball on TV screen
    private void OnBallDrawn_TV(BingoNumberData ball)
    {
        Debug.Log($"[TVDisplay] OnBallDrawn_TV: ball={ball.number} drawIndex={ball.totalWithdrawCount}");

        claimWinnerPanel.Close();
        Timer_PopUP.SetActive(false);
        NextGame_Counter_Txt.gameObject.SetActive(false);
        Ball_Drawn_Display.SetActive(true);
        Ball_Drawn_Count_Txt.text = ball.totalWithdrawCount.ToString();

        // Play sound (TV volume controlled by mute/unmute button)
        if (SoundManager.Instance.TvScreenSoundStatus)
        {
            switch (CurrentSoundLanguage)
            {
                case soundlanguage.NorwegianFemale:
                    SoundManager.Instance.PlayNorwegianFemaleNumberAnnouncement(ball.number, true);
                    break;
                default:
                    SoundManager.Instance.PlayNorwegianMaleNumberAnnouncement(ball.number, true);
                    break;
            }
        }

        // isForPlayerApp=true → animate the ball, no "next ball" preview on TV
        bingoBallPanelManager.NewWithdraw(ball, null, false, true, true);

        // Ensure live room panel is visible
        panelLiveRoomData.Open();
    }

    /// room:update — rebuild TV state from latest snapshot (room join / reconnect)
    private void OnRoomState_TV(SpilloramaSnapshotRaw snap)
    {
        if (snap == null) return;

        var game = snap.currentGame;
        bool isRunning = game != null &&
                         (game.status == "RUNNING" || game.status == "running");

        // Update game name
        if (Current_Game_Name_Txt != null)
        {
            var locMgr = Current_Game_Name_Txt.GetComponent<I2.Loc.LocalizationParamsManager>();
            if (locMgr != null)
                locMgr.SetParameterValue("value", "Bingo");
            else
                Current_Game_Name_Txt.text = "Bingo";
        }

        // Player count as game count equivalent
        int playerCount = snap.players?.Length ?? 0;
        if (Game_Count_Txt != null)
        {
            var locMgr = Game_Count_Txt.GetComponent<I2.Loc.LocalizationParamsManager>();
            if (locMgr != null)
                locMgr.SetParameterValue("value", playerCount.ToString());
            else
                Game_Count_Txt.text = playerCount.ToString();
        }

        if (!isRunning || game == null)
        {
            // Waiting / idle — show timer, hide live data
            panelLiveRoomData.Close();
            Ball_Drawn_Display.SetActive(false);

            if (snap.scheduler != null && snap.scheduler.millisUntilNextStart > 0)
            {
                Timer_PopUP.SetActive(true);
                Ball_Drawn_Display.SetActive(false);
            }
            return;
        }

        // Game is running — build drawn-numbers list and populate ball strip
        panelLiveRoomData.Open();
        panelResult.Close();
        Timer_PopUP.SetActive(false);
        Ball_Drawn_Display.SetActive(true);

        int[] drawn = game.drawnNumbers ?? new int[0];
        Ball_Drawn_Count_Txt.text = drawn.Length.ToString();

        // Convert int[] → List<BingoNumberData>
        var ballList = new List<BingoNumberData>();
        for (int i = 0; i < drawn.Length; i++)
        {
            int n = drawn[i];
            string col = n <= 15 ? "blue" : n <= 30 ? "red" : n <= 45 ? "purple" : n <= 60 ? "green" : "yellow";
            ballList.Add(new BingoNumberData
            {
                number             = n,
                totalWithdrawCount = i + 1,
                color              = col
            });
        }

        // Replay the full list into the ball strip (no sound, no animation)
        bingoBallPanelManager.Reset();
        bingoBallPanelManager.WithdrawList(ballList, null, false, "Running");
    }

    /// room:update STARTED transition
    private void OnGameStarted_TV()
    {
        Debug.Log("[TVDisplay] OnGameStarted_TV — resetting ball strip");
        bingoBallPanelManager.Reset();
        panelLiveRoomData.Open();
        panelResult.Close();
        Timer_PopUP.SetActive(false);
        Ball_Drawn_Display.SetActive(true);
        Ball_Drawn_Count_Txt.text = "0";
    }

    /// room:update ENDED transition
    private void OnGameFinished_TV(string gameId)
    {
        Debug.Log($"[TVDisplay] OnGameFinished_TV — gameId={gameId}");
        isGameFinish = true;
        bingoBallPanelManager.DisplayBigBallOnWin(true, false, true);
        SoundManager.Instance.BingoSound(false);
        panelResult.Open();
    }

    /// pattern:won — overlay winner info on TV
    private void OnPatternWon_TV(SpilloramaPatternWonRaw won)
    {
        Debug.Log($"[TVDisplay] OnPatternWon_TV — pattern={won.patternName} winner={won.winnerId} amount={won.payoutAmount}");

        bingoBallPanelManager.DisplayBigBallOnWin(true, false, false);
        SoundManager.Instance.BingoSound(false);

        // Build a minimal AdminDashboardWinningData so AddNewBingoWinningData can render the row
        var winningData = new AdminDashboardWinningData
        {
            id             = won.patternName,
            displayName    = won.patternName,
            winnerCount    = 1,
            prize          = won.payoutAmount,
            winningTickets = new System.Collections.Generic.List<WinningTicket>()
        };

        data = winningData;
        AddNewBingoWinningData(winningData);
    }
}
