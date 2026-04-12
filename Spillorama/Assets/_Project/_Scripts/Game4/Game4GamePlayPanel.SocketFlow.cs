using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public partial class Game4GamePlayPanel
{
    public bool isRefreshed = false;

    private void ReGeneratePatternData()
    {
        foreach (Transform obj in transformPatternContainer)
            Destroy(obj.gameObject);
        patternList.Clear();
        GeneratePatterns(game4Data.patternList);
    }

    // TODO: Spillorama backend needs a Game 4 play endpoint.
    // Game 4 is single-player instant: client sends play request, server returns
    // all balls + winners in one response, client animates locally.
    private void CallGame4PlayEvent(string purchaseType = "", string voucherCode = "")
    {
        Debug.LogWarning("[Game4] CallGame4PlayEvent: Spillorama Game 4 play endpoint not yet implemented");
        DisplayLoader(false);
        btnPlay.interactable = true;
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

    void CallPlayerHallLimitEvent()
    {
        // TODO: Replace with Spillorama REST call when Game 4 backend is ready.
    }

    // TODO: Wire up mini-game buttons to Spillorama endpoints when available.
    public void OnWheelOfFortuneButtonTap()
    {
        Debug.LogWarning("[Game4] Wheel of Fortune: Spillorama endpoint not yet implemented");
    }

    public void OnTreasureChestButtonTap()
    {
        Debug.LogWarning("[Game4] Treasure Chest: Spillorama endpoint not yet implemented");
    }

    public void OnMysteryGameButtonTap()
    {
        Debug.LogWarning("[Game4] Mystery Game: Spillorama endpoint not yet implemented");
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
        WithdrawBingoBall(SampleWebViewInput, false);
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
        HighlightCell();
    }
}
