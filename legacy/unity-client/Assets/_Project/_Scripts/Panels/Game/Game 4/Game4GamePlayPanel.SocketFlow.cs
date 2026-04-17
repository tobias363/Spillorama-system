using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using BestHTTP.SocketIO;
using I2.Loc;
using UnityEngine;

public partial class Game4GamePlayPanel
{
    public bool isRefreshed = false;

    private void PatternChange(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("PatternChange: " + packet.ToString());
        Game4Data game4DataResponse = JsonUtility.FromJson<Game4Data>(Utility.Instance.GetPacketString(packet));
        game4Data.betData = game4DataResponse.betData;
        game4Data.isSoundPlay = game4DataResponse.isSoundPlay;
        game4Data.first18BallTime = game4DataResponse.first18BallTime;
        game4Data.last15BallTime = game4DataResponse.last15BallTime;
        game4Data.patternList = game4DataResponse.patternList;

        if (_isBetUpdateAllowed)
            RefreshBetValue();

        if (!_isPatternChangeAllowed)
            return;

        foreach (Transform obj in transformPatternContainer)
            Destroy(obj.gameObject);
        patternList.Clear();
        GeneratePatterns(game4DataResponse.patternList);
    }

    private void ReGeneratePatternData()
    {
        foreach (Transform obj in transformPatternContainer)
            Destroy(obj.gameObject);
        patternList.Clear();
        GeneratePatterns(game4Data.patternList);
    }

    private void OnBreak(Socket socket, Packet packet, object[] args)
    {
        BreakTime breakTime = JsonUtility.FromJson<BreakTime>(Utility.Instance.GetPacketString(packet));
        if (breakTime.startBreakTime == null || breakTime.endBreakTime == null)
            return;

        UIManager.Instance.startBreakTime = DateTimeOffset.Parse(
            breakTime.startBreakTime,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal
        );
        UIManager.Instance.endBreakTime = DateTimeOffset.Parse(
            breakTime.endBreakTime,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal
        );
        UIManager.Instance.isBreak = breakTime.isBreak;
        UIManager.Instance.breakTimePopup.OpenPanel(breakTime.gameType);

        if (!gameObject.activeSelf)
            return;

        if (BackgroundManager.Instance.checkBreakTime != null)
            StopCoroutine(BackgroundManager.Instance.checkBreakTime);
    }

    public void OnWheelOfFortuneButtonTap()
    {
        DisplayLoader(true);
        EventManager.Instance.WheelOfFortuneData(
            GameSocketManager.SocketGame4,
            game4Data.gameId,
            WheelOfFortuneDataResponse
        );
    }

    public void OnTreasureChestButtonTap()
    {
        DisplayLoader(true);
        EventManager.Instance.TreasureChestData(
            GameSocketManager.SocketGame4,
            game4Data.gameId,
            TreasureChestDataResponse
        );
    }

    public void OnMysteryGameButtonTap()
    {
        DisplayLoader(true);
        EventManager.Instance.MysteryGameData(
            GameSocketManager.SocketGame4,
            game4Data.gameId,
            MysteryGameDataResponse
        );
    }

    public IEnumerator RunningGameSetData(Game4PlayResponse resp)
    {
        game4PlayResponseActual = new Game4PlayResponse();
        game4PlayResponseActual = resp;
        TicketCount = game4Data.parsedTicketList.Count;
        ResetTicketHighlightData();
        MissingPatternsAndTicketsList();

        CallPlayerHallLimitEvent();
        ReGeneratePatternData();
        ChangeTicketIdArray(game4Data.ticketList, true);
        yield return new WaitForSeconds(0.5f);

        miniGameId = resp.miniGameId;
        UIManager.Instance.selectPurchaseTypePanel.Close();

        btnTryOtherGame.Close();
        IsGamePlayInProcess = true;
        _isBetUpdateAllowed = false;
        _isPatternChangeAllowed = false;
        isRefreshed = false;
        WonValue = 0;
        game4Data.gameId = resp.miniGameId;
        game4Data.isSoundPlay = resp.isSoundPlay;
        UIManager.Instance.gameAssetData.Points = game4PlayResponseActual.points.ToString("###,###,##0.00");
        UIManager.Instance.gameAssetData.RealMoney = game4PlayResponseActual.realMoney.ToString("###,###,##0.00");
        UIManager.Instance.gameAssetData.TodaysBalance = game4PlayResponseActual.todaysBalance.ToString("###,###,##0.00");

        drewBallList.Clear();
        isDrewBallSetProgress = false;
        ResetWithdrawnBallContainer();

        if (GameTimer != null)
        {
            StopCoroutine(GameTimer);
            GameTimer = null;
        }

        GameTimer = StartCoroutine(WithdrawBingoBallAction(resp));
    }

    private void CallGame4PlayEvent(string purchaseType = "", string voucherCode = "")
    {
        Debug.Log("CallGame4PlayEvent");
        ResetTicketHighlightData();
        MissingPatternsAndTicketsList();
        DisplayLoader(true);

        EventManager.Instance.Game4Play(
            game4Data.gameId,
            GetActiveTicketIdList(),
            betMultiplierValue,
            betMultiplierIndex,
            purchaseType,
            voucherCode,
            Game4PlayResponse
        );

        lastPurchaseType = purchaseType;
        lastVoucherCode = voucherCode;
    }

    private void SaveGameDataResponse(Game4Data game4data)
    {
        game4Data = game4data;
        ticketPrice = game4data.ticketPrice;

        if (patternList.Count > 0)
        {
            foreach (Transform obj in transformPatternContainer)
                Destroy(obj.gameObject);
            patternList.Clear();
        }

        GeneratePatterns(game4data.patternList);

        if (IsGamePlayInProcess)
            return;

        GenerateTickets(game4data.ticketList);
        IsTicketOptionEnable = false;
    }

    private void WheelOfFortuneDataResponse(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("WheelOfFortuneDataResponse :" + packet.ToString());
        DisplayLoader(false);

        EventResponse<WheelOfFortuneData> response = JsonUtility.FromJson<EventResponse<WheelOfFortuneData>>(
            Utility.Instance.GetPacketString(packet)
        );
        if (response.status != Constants.EventStatus.SUCCESS)
        {
            GetUtilityMessagePanel().DisplayMessagePopup(response.message);
            return;
        }

        fortuneWheelManager.Can_Spin = true;
#if UNITY_WEBGL
        if (UIManager.Instance.isGameWebGL)
        {
            fortuneWheelManager.Open(
                GameSocketManager.SocketGame4,
                miniGameId,
                response.result,
                10,
                theme.spriteBackground,
                LocalizationManager.GetTranslation("Game 4")
            );
        }
        else
        {
            fortuneWheelManager.Open(
                GameSocketManager.SocketGame4,
                miniGameId,
                response.result,
                10,
                theme.spriteBackground,
                "Game 4"
            );
        }
#else
        fortuneWheelManager.Open(
            GameSocketManager.SocketGame4,
            miniGameId,
            response.result,
            10,
            theme.spriteBackground,
            LocalizationManager.GetTranslation("Game 4")
        );
#endif
        fortuneWheelManager.Is_Game_4 = true;
        btnTryOtherGame.Close();
        imgTryOtherGamesPanel.Close();
    }

    private void TreasureChestDataResponse(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("TreasureChestDataResponse :" + packet.ToString());
        DisplayLoader(false);

        EventResponse<TreasureChestData> response = JsonUtility.FromJson<EventResponse<TreasureChestData>>(
            Utility.Instance.GetPacketString(packet)
        );
        if (response.status != Constants.EventStatus.SUCCESS)
        {
            GetUtilityMessagePanel().DisplayMessagePopup(response.message);
            return;
        }

        treasureChestPanel.Can_Click_On_Box = true;
#if UNITY_WEBGL
        if (UIManager.Instance.isGameWebGL)
        {
            treasureChestPanel.Open(
                GameSocketManager.SocketGame4,
                miniGameId,
                response.result,
                10,
                theme.spriteBackground,
                LocalizationManager.GetTranslation("Game 4")
            );
        }
        else
        {
            treasureChestPanel.Open(
                GameSocketManager.SocketGame4,
                miniGameId,
                response.result,
                10,
                theme.spriteBackground,
                "Game 4"
            );
        }
#else
        treasureChestPanel.Open(
            GameSocketManager.SocketGame4,
            miniGameId,
            response.result,
            10,
            theme.spriteBackground,
            LocalizationManager.GetTranslation("Game 4")
        );
#endif
        treasureChestPanel.Is_Game_4 = true;
        btnTryOtherGame.Close();
        imgTryOtherGamesPanel.Close();
    }

    private void MysteryGameDataResponse(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("MysteryGameDataResponse :" + packet.ToString());
        DisplayLoader(false);

        EventResponse<MysteryGameData> response = JsonUtility.FromJson<EventResponse<MysteryGameData>>(
            Utility.Instance.GetPacketString(packet)
        );
        if (response.status != Constants.EventStatus.SUCCESS)
        {
            GetUtilityMessagePanel().DisplayMessagePopup(response.message);
            return;
        }

#if UNITY_WEBGL
        if (UIManager.Instance.isGameWebGL)
        {
            mysteryGamePanel.Open(
                GameSocketManager.SocketGame4,
                miniGameId,
                response.result,
                theme.spriteBackground,
                false,
                "Message",
                LocalizationManager.GetTranslation("Game 4"),
                "Game 4"
            );
        }
        else
        {
            mysteryGamePanel.Open(
                GameSocketManager.SocketGame4,
                miniGameId,
                response.result,
                theme.spriteBackground,
                false,
                "Message",
                "Game 4",
                "Game 4"
            );
        }
#else
        mysteryGamePanel.Open(
            GameSocketManager.SocketGame4,
            miniGameId,
            response.result,
            theme.spriteBackground,
            false,
            "Message",
            LocalizationManager.GetTranslation("Game 4"),
            "Game 4"
        );
#endif
        btnTryOtherGame.Close();
        imgTryOtherGamesPanel.Close();
    }

    private void Game4ChangeTicketsResponse(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("Game4ChangeTicketsResponse: " + packet.ToString());
        DisplayLoader(false);

        EventResponse<List<GameTicketData>> game4DataResponse = JsonUtility.FromJson<
            EventResponse<List<GameTicketData>>
        >(Utility.Instance.GetPacketString(packet));

        if (game4DataResponse.status == Constants.EventStatus.SUCCESS)
        {
            ChangeTickets(game4DataResponse.result);
        }
        else
        {
            GetUtilityMessagePanel().DisplayMessagePopup(game4DataResponse.message);
        }
    }

    private void Game4PlayResponse(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("Game4Play Response : " + packet.ToString());
        DisplayLoader(false);

        EventResponse<Game4PlayResponse> resp = JsonUtility.FromJson<EventResponse<Game4PlayResponse>>(
            Utility.Instance.GetPacketString(packet)
        );
        game4PlayResponseActual = resp.result;

        if (resp.status != Constants.EventStatus.SUCCESS)
        {
            UIManager.Instance.selectPurchaseTypePanel.Reset();
            GetUtilityMessagePanel().DisplayMessagePopup(resp.message);
            btnPlay.interactable = true;
            return;
        }

        CallPlayerHallLimitEvent();
        ReGeneratePatternData();
        ChangeTicketIdArray(resp.result.ticketList);
        miniGameId = resp.result.miniGameId;
        UIManager.Instance.selectPurchaseTypePanel.Close();

        btnTryOtherGame.Close();
        IsGamePlayInProcess = true;
        _isBetUpdateAllowed = false;
        _isPatternChangeAllowed = false;
        isRefreshed = false;
        WonValue = 0;

        game4Data.gameId = resp.result.miniGameId;
        game4Data.isSoundPlay = resp.result.isSoundPlay;
        UIManager.Instance.gameAssetData.Points = game4PlayResponseActual.points.ToString("###,###,##0.00");
        UIManager.Instance.gameAssetData.RealMoney = game4PlayResponseActual.realMoney.ToString("###,###,##0.00");
        UIManager.Instance.gameAssetData.TodaysBalance = game4PlayResponseActual.todaysBalance.ToString("###,###,##0.00");

        drewBallList.Clear();
        isDrewBallSetProgress = false;
        ResetWithdrawnBallContainer();

        if (GameTimer != null)
        {
            StopCoroutine(GameTimer);
            GameTimer = null;
        }

        GameTimer = StartCoroutine(WithdrawBingoBallAction(resp.result));
    }

    void CallPlayerHallLimitEvent()
    {
        EventManager.Instance.PlayerHallLimit((socket, packet, args) =>
        {
            Debug.Log("PlayerHallLimit: " + packet.ToString());
            EventResponse<PlayerApprovedHallsResponse> response = JsonUtility.FromJson<
                EventResponse<PlayerApprovedHallsResponse>
            >(Utility.Instance.GetPacketString(packet));
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

    private List<string> GetActiveTicketIdList()
    {
        List<string> ticketIdList = new List<string>();

        foreach (PrefabBingoGame4Ticket5x3 ticket in ticketList)
        {
            if (ticket.IsTicketPurchased)
                ticketIdList.Add(ticket.TicketId);
        }

        return ticketIdList;
    }

    private IEnumerator WithdrawBingoBallAction(Game4PlayResponse gamePlay)
    {
        float first18BallTime = 2;
        float last15BallTime = 2;

        float.TryParse(game4Data.first18BallTime, out first18BallTime);
        float.TryParse(game4Data.last15BallTime, out last15BallTime);
        for (int i = 0; i < gamePlay.ballsShouldBeWithdrawn; i++)
        {
            WithdrawBingoBall(gamePlay.withdrawNumberList[i], game4Data.isSoundPlay);
        }

        if (!(gamePlay.ballsShouldBeWithdrawn > 18))
        {
            for (int i = gamePlay.ballsShouldBeWithdrawn; i < 18; i++)
            {
                gamePlay.ballsShouldBeWithdrawn = i + 1;
                yield return new WaitForSeconds(first18BallTime);
                WithdrawBingoBall(gamePlay.withdrawNumberList[i], game4Data.isSoundPlay);
            }
        }

        for (int i = gamePlay.ballsShouldBeWithdrawn; i < gamePlay.withdrawNumberList.Count; i++)
        {
            gamePlay.ballsShouldBeWithdrawn = i + 1;
            yield return new WaitForSeconds(last15BallTime);
            WithdrawBingoBall(gamePlay.withdrawNumberList[i], game4Data.isSoundPlay);
        }

        MissingPatternsAndTicketsList();
        ReGeneratePatternData();
        isRefreshed = true;

        yield return new WaitForSeconds(0.5f);

        HighlightWinningPattern(gamePlay);
        _isBetUpdateAllowed = true;

        if (gamePlay.winningPrize > 0)
        {
            UIManager.Instance.gameAssetData.Points =
                game4PlayResponseActual.pointsAfterWinning.ToString("###,###,##0.00");
            UIManager.Instance.gameAssetData.RealMoney =
                game4PlayResponseActual.realMoneyAfterWinning.ToString("###,###,##0.00");
            UIManager.Instance.gameAssetData.TodaysBalance =
                game4PlayResponseActual.todaysBalance.ToString("###,###,##0.00");
            BackgroundManager.Instance.PlayerUpdateIntervalCall();
        }

        isGameRunningStatus = false;
        if (toggleAutoPlay.isOn)
        {
            yield return new WaitForSeconds(3);
        }
        else
        {
            IsGamePlayInProcess = false;
        }
    }

    public void SampleWithdrawBingoBall()
    {
        PrefabBingoBallPanel bingoBall = Instantiate(
            prefabBingoBall,
            transformWithdrawnBallContainer
        );
        bingoBall.SetData(
            SampleWebViewInput,
            theme.withdrawBallContainerThemeData.ballColor,
            theme.withdrawBallContainerThemeData.ballNumberColor
        );
        MarkTicketNumber(SampleWebViewInput);

        foreach (var pattern in patternList)
        {
            pattern.missingIndices.Clear();
        }

        CheckMissIndies();
        HeighlightCell();
    }

    private void WithdrawBingoBall(int number, bool isSoundPlay)
    {
        drewBallList.Add(number);
        if (UIManager.Instance.gameAssetData.isVoiceOn == 1 && isSoundPlay)
        {
            SoundManager.Instance.PlayNorwegianMaleNumberAnnouncement(number, false);
        }

        PrefabBingoBallPanel bingoBall = Instantiate(
            prefabBingoBall,
            transformWithdrawnBallContainer
        );
        bingoBall.SetData(
            number,
            theme.withdrawBallContainerThemeData.ballColor,
            theme.withdrawBallContainerThemeData.ballNumberColor
        );
        MarkTicketNumber(number);

        foreach (var pattern in patternList)
        {
            pattern.missingIndices.Clear();
        }

        CheckMissIndies();
        HeighlightCell();
    }
}
