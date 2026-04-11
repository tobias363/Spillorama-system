using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using BestHTTP.SocketIO;
using I2.Loc;
using UnityEngine;

public partial class Game5GamePlayPanel
{
    public void Reconnect()
    {
        Debug.Log("On Reconnected Game 5");
        CallSubscribeRoom();
    }

    public void CallSubscribeRoom()
    {
        if (!Application.isPlaying)
        {
            DisplayLoader(false);
            Debug.Log("[EditModeSmoke] Skipping Game5 SubscribeRoom.");
            return;
        }

        DisplayLoader(true);

        DisableBroadcasts();
        EnableBroadcasts();

        EventManager.Instance.Game5Data((socket, packet, args) =>
        {
            Debug.Log("Game5DataResponse: " + packet.ToString());
            UIManager.Instance.DisplayLoader(false);

            try
            {
                EventResponse<Game5Data> game5DataResponse = JsonUtility.FromJson<EventResponse<Game5Data>>(
                    Utility.Instance.GetPacketString(packet)
                );
                game5Data = game5DataResponse.result;
                if (game5DataResponse.status == Constants.EventStatus.SUCCESS)
                {
                    if (game5DataResponse.result.status == Constants.GAME_STATUS.Running.ToString())
                    {
                        IsGamePlayInProcess = true;
                        foreach (PrefabBingoGame5Ticket3x3 ticket in ticketList)
                        {
                            ticket.blockTicketActions();
                        }

                        if (game5DataResponse.result.miniGameData.isMiniGameActivated)
                        {
                            roulateSpinnerElements.SetActive(false);
                            CloseMiniGames();
                            switch (game5DataResponse.result.miniGameData.gameType)
                            {
                                case "wheelOfFortune":
                                    game5FreeSpinJackpot.ReconnectOpen(
                                        GameSocketManager.SocketGame5,
                                        game5DataResponse.result.gameId,
                                        game5DataResponse.result.miniGameData.ticketId,
                                        game5DataResponse.result.miniGameData
                                    );
                                    break;
                                case "roulette":
                                    game5JackpotRouletteWheel.ReconnectOpen(
                                        GameSocketManager.SocketGame5,
                                        game5DataResponse.result.gameId,
                                        game5DataResponse.result.miniGameData.ticketId,
                                        game5DataResponse.result.miniGameData
                                    );
                                    break;
                            }
                        }
                        else
                        {
                            Reset();
                            GenerateRoulateBallData();
                            GeneratePatterns(game5Data.patternList);
                            GenerateTickets(game5Data);
                            RefreshwithdrawBalls();
                        }
                    }
                    else if (
                        game5DataResponse.result.status == Constants.GAME_STATUS.Waiting.ToString()
                        || game5DataResponse.result.status == Constants.GAME_STATUS.Finished.ToString()
                    )
                    {
                        roulateSpinnerElements.SetActive(true);
                        IsGamePlayInProcess = false;
                        SetData(game5DataResponse.result);
                    }
                }
                else
                {
                    UIManager.Instance.messagePopup.DisplayMessagePopup(game5DataResponse.message);
                }
            }
            catch (Exception e)
            {
                Debug.Log($"try catch : {e.Message} \n {e.StackTrace}");
                UIManager.Instance.messagePopup.DisplayMessagePopup(e.Message + "\n" + e.StackTrace);
            }
        });
    }

    void CallPlayerHallLimitEvent()
    {
        if (!Application.isPlaying)
            return;

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

    private void EnableBroadcasts()
    {
        if (!Application.isPlaying)
            return;

        Debug.Log("EnableBroadcasts Game 5 Play Panel");
        GameSocketManager.SocketGame5.On(Constants.BroadcastName.WithdrawBingoBall, OnWithdrawBingoBall);
        GameSocketManager.SocketGame5.On(Constants.BroadcastName.GameFinish, OnGameFinish);
        GameSocketManager.SocketGame5.On(Constants.BroadcastName.ActivateMiniGame, OnActivateMiniGame);
        GameSocketManager.SocketGame5.On(Constants.BroadcastName.jackpotsWinnigs, jackpotsWinnigs);
        GameSocketManager.SocketGame5.On(Constants.BroadcastName.totalGameWinnings, totalGameWinnings);
        GameSocketManager.SocketGame5.On(Constants.BroadcastName.PatternChange, patternChange);
        GameSocketManager.socketManager.Socket.On(Constants.BroadcastName.BreakTimeStart, OnBreak);
        SoundManager.Instance.ResetPlayedAnnouncements();
    }

    private void DisableBroadcasts()
    {
        if (!Application.isPlaying)
            return;

        Debug.Log("DisableBroadcasts Game 5 Play Panel");
        GameSocketManager.SocketGame5.Off(Constants.BroadcastName.WithdrawBingoBall);
        GameSocketManager.SocketGame5.Off(Constants.BroadcastName.GameFinish);
        GameSocketManager.SocketGame5.Off(Constants.BroadcastName.ActivateMiniGame);
        GameSocketManager.SocketGame5.Off(Constants.BroadcastName.jackpotsWinnigs);
        GameSocketManager.SocketGame5.Off(Constants.BroadcastName.totalGameWinnings);
        GameSocketManager.SocketGame5.Off(Constants.BroadcastName.PatternChange);
        GameSocketManager.socketManager.Socket.Off(Constants.BroadcastName.BreakTimeStart);
    }

    void OnBreak(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnBreak Broadcast: " + packet.ToString());
        BreakTime breakTime = JsonUtility.FromJson<BreakTime>(Utility.Instance.GetPacketString(packet));
        if (breakTime.startBreakTime != null && breakTime.endBreakTime != null)
        {
            Debug.Log("enter..break time");
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
            if (BackgroundManager.Instance.checkBreakTime != null)
            {
                StopCoroutine(BackgroundManager.Instance.checkBreakTime);
            }
        }
    }

    private void OnWithdrawBingoBall(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnWithdrawBingoBall: " + packet.ToString());
        BingoNumberData bingoNumberData = JsonUtility.FromJson<BingoNumberData>(
            Utility.Instance.GetPacketString(packet)
        );
        TotalWithdrawCount = bingoNumberData.totalWithdrawCount;
        LastWithdrawNumber = bingoNumberData.number;
        WithdrawBingoBallAction(bingoNumberData);
        if (UIManager.Instance.gameAssetData.isVoiceOn == 1 && game5Data.isSoundPlay)
        {
            SoundManager.Instance.PlayNorwegianMaleNumberAnnouncement(
                bingoNumberData.number,
                false
            );
        }
        HighlightBall(GetTargetPlateIndex(bingoNumberData.number));
    }

    private void OnGameFinish(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnGameFinish: " + packet.ToString());
        bingoGame5FinishResponse = JsonUtility.FromJson<BingoGame5FinishResponse>(
            Utility.Instance.GetPacketString(packet)
        );
        HighLightWinningPattern();
        roulateSpinner.IsRotating = false;
        ResetRoulettePlats();
        if (bingoGame5FinishResponse.isWon)
        {
            string notificationMessage =
                Constants.LanguageKey.CongratulationsMessage
                + " "
                + bingoGame5FinishResponse.totalWonAmount
                + " Kr";
        }
        else
        {
            Co_Routines_OnGameFinished = StartCoroutine(OnGameFinished(0f));
        }

        PrefabBingoGame5Ticket3x3 wonTicket;
        foreach (WinningPattern ticketWonData in bingoGame5FinishResponse.winningPatterns)
        {
            wonTicket = GetTicketById(ticketWonData.ticketId);

            if (wonTicket != null)
            {
                wonTicket.TicketCompleted = true;
                wonTicket.WonAmount = ticketWonData.wonAmount.ToString();
            }
        }
    }

    private PrefabBingoGame5Ticket3x3 GetTicketById(string ticketId)
    {
        foreach (PrefabBingoGame5Ticket3x3 ticket in ticketList)
        {
            if (ticket.TicketId == ticketId)
                return ticket;
        }

        return null;
    }

    private void jackpotsWinnigs(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("jackpotsWinnigs Broadcast: " + packet.ToString());
        bingoGame5FinishResponse = JsonUtility.FromJson<BingoGame5FinishResponse>(
            Utility.Instance.GetPacketString(packet)
        );
        HighLightWinningPattern();
        string notificationMessage =
            Constants.LanguageKey.CongratulationsMessage
            + " "
            + bingoGame5FinishResponse.totalWonAmount
            + " Kr "
            + Constants.LanguageKey.JackpotMessage;
        UIManager.Instance.DisplayNotificationUpperTray(notificationMessage);
    }

    private void totalGameWinnings(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("totalGameWinnings Broadcast Response : " + packet.ToString());
        Game5MiniGameWinData game5MiniGameWinData = JsonUtility.FromJson<Game5MiniGameWinData>(
            Utility.Instance.GetPacketString(packet)
        );
        isMiniGameActivated = false;
        string notificationMessage =
            Constants.LanguageKey.CongratulationsMessage
            + " "
            + game5MiniGameWinData.totalWonAmount
            + " Kr "
            + Constants.LanguageKey.TotalGameWinningMessage;
        UIManager.Instance.LaunchWinningAnimation(notificationMessage);

        Co_Routines_OnGameFinished = StartCoroutine(OnGameFinished(2.5f));
    }

    private void patternChange(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("patternChange Broadcast Response : " + packet.ToString());
        Game5Data game5DataResponse = JsonUtility.FromJson<Game5Data>(
            Utility.Instance.GetPacketString(packet)
        );
        game5Data.isSoundPlay = game5DataResponse.isSoundPlay;
        game5Data.patternList = game5DataResponse.patternList;
        game5Data.BallDrawTime = game5DataResponse.BallDrawTime;
        var locParamsManager = txtWithdrawNumberStats.GetComponent<LocalizationParamsManager>();
        locParamsManager.SetParameterValue(
            "total",
            game5DataResponse.totalWithdrawableBalls.ToString()
        );
        game5Data.totalWithdrawableBalls = game5DataResponse.totalWithdrawableBalls;

        ResetPattern();
        GeneratePatterns(game5Data.patternList);
    }

    private void CallGame5PlayEvent(string purchaseType = "", string voucherCode = "")
    {
        DisplayLoader(true);
        EventManager.Instance.Game5Play(
            game5Data.gameId,
            GetActiveTicketInfoList(),
            Game5PlayResponse
        );
    }

    private void Game5PlayResponse(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("Game5PlayResponse: " + packet.ToString());
        DisplayLoader(false);

        EventResponse eventResponse = JsonUtility.FromJson<EventResponse>(
            Utility.Instance.GetPacketString(packet)
        );

        if (eventResponse.status == Constants.EventStatus.SUCCESS)
        {
            roulateSpinner.EnableDisableColliders(true);
            CallPlayerHallLimitEvent();
            OnGameStart();
        }
        else
        {
            btnPlay.interactable = true;
            UIManager.Instance.messagePopup.DisplayMessagePopup(eventResponse.message);
        }
    }

    private void OnGameStart()
    {
        IsGamePlayInProcess = true;
        foreach (PrefabBingoGame5Ticket3x3 ticket in ticketList)
        {
            ticket.blockTicketActions();
        }
    }

    private void OnActivateMiniGame(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnActivateMiniGame: " + packet.ToString());
        miniGameData = JsonUtility.FromJson<ActivateGame5JackpotMiniGameResponse>(
            Utility.Instance.GetPacketString(packet)
        );
        CloseMiniGames();
        isMiniGameActivated = true;

        switch (miniGameData.miniGameType)
        {
            case "wheelOfFortune":
                CallWheelOfFortuneEvent();
                break;
            case "roulette":
                CallRouletteWheel();
                break;
        }
    }

    private void CallWheelOfFortuneEvent()
    {
        DisplayLoader(true);
        EventManager.Instance.Game5WheelOfFortuneData(
            GameSocketManager.SocketGame5,
            miniGameData.gameId,
            miniGameData.ticketId,
            WheelOfFortuneDataResponse
        );
    }

    private void CallRouletteWheel()
    {
        UIManager.Instance.CloseAllGameElements();
        game5JackpotRouletteWheel.Open(
            GameSocketManager.SocketGame5,
            miniGameData.gameId,
            miniGameData.ticketId,
            miniGameData.spinDetails,
            miniGameData.rouletteData
        );
    }

    private void WheelOfFortuneDataResponse(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("WheelOfFortuneDataResponse :" + packet.ToString());
        DisplayLoader(false);

        EventResponse<WheelOfFortuneData> response = JsonUtility.FromJson<EventResponse<WheelOfFortuneData>>(
            Utility.Instance.GetPacketString(packet)
        );
        if (response.status == Constants.EventStatus.SUCCESS)
        {
            game5JackpotRouletteWheel.SetWinningMultiplier(
                response.result.redMultiplierValue,
                response.result.blackMultiplierValue,
                response.result.greenMultiplierValue
            );
#if UNITY_WEBGL
            if (UIManager.Instance.isGameWebGL)
            {
                UIManager.Instance.CloseAllGameElements();
                game5FreeSpinJackpot.Open(
                    GameSocketManager.SocketGame5,
                    miniGameData.gameId,
                    miniGameData.ticketId,
                    response.result
                );
            }
#else
            UIManager.Instance.CloseAllGameElements();
            game5FreeSpinJackpot.Open(
                GameSocketManager.SocketGame5,
                miniGameData.gameId,
                miniGameData.ticketId,
                response.result
            );
#endif
        }
        else
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
        }
    }

    private IEnumerator OnGameFinished(float maxWaitTime)
    {
        float timer = 0f;
        while (isMiniGameActivated || timer < maxWaitTime)
        {
            yield return null;
            timer += Time.deltaTime;
        }

        yield return new WaitForSeconds(1.5f);

        EventManager.Instance.UnSubscribeGame5Room(
            UIManager.Instance.game5Panel.game5GamePlayPanel.game5Data.gameId,
            (socket, packet, args) =>
            {
                Debug.Log("UnSubscribeGame5Room Response: " + packet.ToString());
            }
        );
        ResetRoulettePlats();
        CallSubscribeRoom();
        StopCoroutine(Co_Routines_OnGameFinished);
    }

    private List<(string id, int price)> GetActiveTicketInfoList()
    {
        List<(string id, int price)> ticketInfoList = new List<(string id, int price)>();

        foreach (PrefabBingoGame5Ticket3x3 ticket in ticketList)
        {
            ticketInfoList.Add((ticket.ticketList.id, ticket.ticketList.price));
        }

        return ticketInfoList;
    }
}
