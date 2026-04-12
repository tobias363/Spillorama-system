using System.Collections;
using System.Collections.Generic;
using System.Linq;
using BestHTTP.SocketIO;
using I2.Loc;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class MysteryGamePanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    public int middleNumber;
    public int resultNumber;
    #endregion

    #region PRIVATE_VARIABLES
    [Header("List")]
    [SerializeField] private List<long> prizeList;
    [SerializeField] private List<MysteryGameMiddleBall> middleBallList;
    [SerializeField] private List<MysteryGameSelectionBall> upBallList;
    [SerializeField] private List<MysteryGameSelectionBall> downBallList;
    [SerializeField] private List<GameObject> jokerList;

    [Header("Text")]
    [SerializeField] private TextMeshProUGUI[] textAmountList;
    [SerializeField] private TextMeshProUGUI[] textMagnifierAmountList;
    [SerializeField] private TextMeshProUGUI txtGameName;

    [Header("Images")]
    [SerializeField] private Image imgBackground;

    [Header("Transform")]
    [SerializeField] private Transform panelAmount;
    [SerializeField] private Transform panelMagnifierAmount;

    [Header("GameObject")]
    [SerializeField] private GameObject timerPanel;
    [SerializeField] private GameObject arrowClickGuide;
    public PanelMiniGameWinners PanelMiniGameWinners;

    [Header("Text")]
    [SerializeField] private TextMeshProUGUI txtTimer;

    [Header("Button")]
    [SerializeField] private Button btnBackToLobby;
    [SerializeField] private Button btnBack;
    private float panelAmountDefaultY;
    private float panelMgnifierAmountDefaultY;
    private int incrementalValueY = 80;
    private int incrementalMgnifierValueY = 100;

    private int priceListCurrentIndex = 0;
    private int ballCurrentIndex = 0;

    private float priceListAnimationTime = 0.5f;
    private float autoTurnWaitingTimeFirstMove = 20; // this time is arived from backend in Game 1
    private float autoTurnWaitingTimeOtherMove = 10; // this time is arived from backend in Game 1

    private int maxBallsLength = 5;

    private int resultIndex = 0;

    private Coroutine autoTurnCoroutine = null;

    public bool Can_Click_On_Box;
    public bool isForceReset = true;

    private Socket socket;
    private string gameId = "";
    private MysteryGameData mysteryGameData;
    private bool gameFinishEventCallPending = false;

    public bool Is_Game_4 = false;

    public bool isPaused = false;

    private int timerValue;

    [Header("BroadCast")]
    [SerializeField] private StartMiniGameBroadcast startMiniGameBroadcast;

    Coroutine autoBackToLobbyCoroutine;
    Coroutine nextTurnCoroutine;
    #endregion

    #region UNITY_CALLBACKS

    private void Awake()
    {
        panelAmountDefaultY = panelAmount.localPosition.y;
        panelMgnifierAmountDefaultY = panelMagnifierAmount.localPosition.y;
    }

    //private void OnEnable()
    //{               
    //    Reset();

    //    middleNumber = Random.Range(10000, 99999);
    //    resultNumber = Random.Range(10000, 99999);

    //    for (int i=0; i<6; i++)              
    //        textAmountList[i].text = textMagnifierAmountList[i].text = prizeList[i].ToString();

    //    RefreshMiddleBalls();

    //    Invoke("StartGame", 0.5f);
    //}

    private void OnEnable()
    {
        if (btnBackToLobby)
            btnBackToLobby.gameObject.SetActive(!Utility.Instance.IsSplitScreenSupported);

        GameSocketManager.OnSocketReconnected += Reconnect;
    }

    private void OnDisable()
    {
        GameSocketManager.OnSocketReconnected -= Reconnect;

        socket.Off(Constants.BroadcastName.SelectMysteryBall);
        socket.Off(Constants.BroadcastName.toggleGameStatus);
        socket.Off(Constants.BroadcastName.mysteryGameFinished);
        socket.Off(Constants.BroadcastName.mysteryGameFinishedAdmin);
    }

    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void Open(Socket socket, string gameId, MysteryGameData mysteryGameData, Sprite backgroundSprite = null, bool isPaused = false, string pauseGameMessage = "", string gameName = "", string gameNameForReference = null)
    {
        Is_Game_4 = gameNameForReference == "Game 4" ? true : false;

        if (backgroundSprite)
            imgBackground.sprite = backgroundSprite;


        socket.Off(Constants.BroadcastName.SelectMysteryBall);
        socket.Off(Constants.BroadcastName.mysteryGameFinished);
        socket.Off(Constants.BroadcastName.mysteryGameFinishedAdmin);
        socket.Off(Constants.BroadcastName.toggleGameStatus);

        this.Open();
        this.isPaused = isPaused;
        socket.On(Constants.BroadcastName.SelectMysteryBall, Select_Mystery_Ball);
        socket.On(Constants.BroadcastName.toggleGameStatus, On_Mystery_Game_toggleGameStatus);
        socket.On(Constants.BroadcastName.mysteryGameFinished, MysteryGameFinishedResponse);
        socket.On(Constants.BroadcastName.mysteryGameFinishedAdmin, MysteryGameFinishedAdminResponse);
        btnBack.gameObject.SetActive(false);
#if UNITY_WEBGL
        if (!UIManager.Instance.isGameWebGL)
        {
            btnBackToLobby.gameObject.SetActive(false);
        }
#endif
        txtGameName.gameObject.SetActive(Utility.Instance.IsSplitScreenSupported);
        txtGameName.text = gameName;

        this.socket = socket;
        this.gameId = gameId;
        this.mysteryGameData = mysteryGameData;

        Reset();

        middleNumber = mysteryGameData.middleNumber;
        resultNumber = mysteryGameData.resultNumber;

        //Set Ball Time Acoordingly Game 1 and Game 4 and also Reconnections
        if (Is_Game_4)
        {
            autoTurnWaitingTimeFirstMove = 20;
            autoTurnWaitingTimeOtherMove = 20;
        }
        else
        {
            autoTurnWaitingTimeFirstMove = mysteryGameData.autoTurnMoveTime;
            autoTurnWaitingTimeOtherMove = mysteryGameData.autoTurnReconnectMovesTime;
        }

        this.prizeList = mysteryGameData.prizeList;
        for (int i = 0; i < 6; i++)
            textAmountList[i].text = textMagnifierAmountList[i].text = prizeList[i].ToString() + " kr";

        RefreshMiddleBalls();

        //This is set Ball After Reconnections Just Game 1 Apply
        if (!Is_Game_4)
        {
            if (mysteryGameData.mysteryGameData.history.Count > 0)
            {
                CancelInvoke("StartGame");
                isForceReset = false;
                priceListCurrentIndex = 0;
                //Utility.Instance.MoveObjectReset();
                //priceListAnimationTime = 0f;
                //Debug.LogError("priceListAnimationTime  : " + priceListAnimationTime);
            }
            else
            {
                priceListAnimationTime = 0.5f;
            }

            if (mysteryGameData.mysteryGameData != null && mysteryGameData.mysteryGameData.history != null)
            {
                int i = 0;
                foreach (var historyEntry in mysteryGameData.mysteryGameData.history)
                {
                    if (historyEntry.isHigherNumber)
                    {
                        UpButtonTap(historyEntry.selectedNumber, i, false);
                    }
                    else
                    {
                        DownButtonTap(historyEntry.selectedNumber, i, false);
                    }
                    i++;
                }
                ballCurrentIndex = i;
            }
        }

        //Invoke(methodName: nameof(StartGame), 0.5f);
        if (mysteryGameData.autoTurnReconnectMovesTime > 0)
        {
            Debug.Log("[MysteryGame] Reconnect with remaining time - starting timer");
            // Use backend-provided remaining time
            // StartCoroutine(NextTurn(ballCurrentIndex, false, (int)mysteryGameData.autoTurnReconnectMovesTime));
            if (nextTurnCoroutine != null)
            {
                StopCoroutine(nextTurnCoroutine);
            }
            nextTurnCoroutine = StartCoroutine(NextTurn(ballCurrentIndex, true));
        }
        else
        {
            Debug.Log("[MysteryGame] Normal start - invoking StartGame");
            // Fallback: normal behavior
            Invoke(methodName: nameof(StartGame), 0.5f);
        }

        //We not used TimeScale here beacuse Mystery Contains Animations when selections so if pause processed then stuck animations // Other Minigames we used timeScale : 0 
        // if (isPaused)
        // {
        //     // SoundManager.Instance.BingoSound();
        //     // UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.GamePausedByAdminMessage);
        //     this.isPaused = true;
        //     timerValue = ballCurrentIndex == 0 ? (int)autoTurnWaitingTimeFirstMove : (int)autoTurnWaitingTimeOtherMove;
        //     txtTimer.text = "00:" + timerValue.ToString("00");
        //     Debug.Log("Paused State in ReconnectOpen : " + gameObject.name);
        // }
        // else
        // {
        //     this.isPaused = false;
        //     timerValue = ballCurrentIndex == 0 ? (int)autoTurnWaitingTimeFirstMove : (int)autoTurnWaitingTimeOtherMove;
        //     txtTimer.text = "00:" + timerValue.ToString("00");
        //     Debug.Log("Resume State in ReconnectOpen : " + gameObject.name);
        // }
        CloseTimer(mysteryGameData.showAutoTurnCount);
        Debug.Log("[MysteryGame] Open - Timer isPaused: " + this.isPaused);
    }

    public void CloseTimer(bool showAutoTurnCount)
    {
        if (showAutoTurnCount || Is_Game_4)
        {
            timerPanel.SetActive(true);
        }
        else
        {
            timerPanel.SetActive(false);
        }
    }

    private void Select_Mystery_Ball(Socket socket, Packet packet, object[] args)
    {
        selectMysteryBallResponse response = JsonUtility.FromJson<selectMysteryBallResponse>(Utility.Instance.GetPacketString(packet));
        if (response.isHigherNumber)
        {
            UpButtonTap(response.selectedNumber, (response.turnCount) - 1);
        }
        else
        {
            DownButtonTap(response.selectedNumber, (response.turnCount) - 1);
        }
    }

    public void OnBackButtonTap()
    {
        this.Close();

#if UNITY_WEBGL
        if (UIManager.Instance.isGameWebGL)
        {
            OnBackToLobbyButtonTap();
        }
        else
        {
            PanelMiniGameWinners.Close();
            UIManager.Instance.bingoHallDisplayPanel.gameObject.SetActive(false);
            UIManager.Instance.bingoHallDisplayPanel.gameObject.SetActive(true);
        }
#else
        OnBackToLobbyButtonTap();
#endif
    }

    public void OnBackToLobbyButtonTap()
    {
        //UIManager.Instance.topBarPanel.OnGamesButtonTap();

        Debug.Log("Is_Game_4 : " + Is_Game_4);

        if (Is_Game_4)
        {
            UIManager.Instance.lobbyPanel.lobbyGameSelection.OnGame4ButtonTap();
        }
        else
        {
            UIManager.Instance.topBarPanel.OnGamesButtonTap();
            // UIManager.Instance.lobbyPanel.lobbyGameSelection.OnGame1ButtonTap();
        }
    }

    public void OnSelectMysteryButton(MysteryGameSelectionBall MysteryGameSelectionBall)
    {
        Debug.LogError("OnSelectMysteryButton isPaused : " + isPaused);
        if (isPaused)
            return;

        if (Is_Game_4)
        {
            Debug.Log("OnSelectMysteryButton Tap Is_Game_4:" + MysteryGameSelectionBall.turnCount);
            if (MysteryGameSelectionBall.isHigherNumber)
            {
                UpButtonTap(resultNumber, MysteryGameSelectionBall.turnCount - 1);
            }
            else
            {
                DownButtonTap(resultNumber, MysteryGameSelectionBall.turnCount - 1);
            }
        }
        else
        {
            Debug.LogError("Can_Click_On_Box : " + Can_Click_On_Box);
            if (!Can_Click_On_Box)
                return;

#if UNITY_WEBGL
            string playerType = "Admin";
            if (UIManager.Instance.isGameWebGL)
            {
                playerType = "Real";
            }
            else
            {
                playerType = "Admin";
            }
#else
            string playerType = "Real";
#endif

            Debug.Log("OnSelectMysteryButton Tap Is_Game_1:" + MysteryGameSelectionBall.turnCount);
            EventManager.Instance.SelectMystery(socket, gameId, playerType, MysteryGameSelectionBall.turnCount, MysteryGameSelectionBall.isHigherNumber, (socket, packet, args) =>
            {
                Debug.Log("SelectMystery response: " + packet.ToString());
            });
        }
    }

    public void UpButtonTap(int resultNumber = 0, int turnCount = 0, bool timerReset = true)
    {
        bool isUp = false;
        bool isJoker = false;

        if (!Is_Game_4)
        {
            ballCurrentIndex = turnCount;

            if (GetSingleNumber(middleNumber) < resultNumber)
            {
                isUp = true;
                MoveIndex(++priceListCurrentIndex);
            }
            else if (GetSingleNumber(middleNumber) == resultNumber)
            {
                isUp = true;
                MoveIndex(priceListCurrentIndex = maxBallsLength);
                PlayJokerAnimation(ballCurrentIndex, upBallList[ballCurrentIndex]);
                isJoker = true;
            }
            else
            {
                MoveIndex(--priceListCurrentIndex);
            }

            upBallList[ballCurrentIndex].ValueValidation(resultNumber, isUp, isJoker);
            ballCurrentIndex++;

            if (ballCurrentIndex < maxBallsLength && !isJoker)
            {
                if (nextTurnCoroutine != null)
                {
                    StopCoroutine(nextTurnCoroutine);
                }
                nextTurnCoroutine = StartCoroutine(NextTurn(ballCurrentIndex, timerReset));
            }
            else
            {
                GameFinish();
            }
        }
        else
        {
            if (GetSingleNumber(middleNumber) < GetSingleNumber(resultNumber))
            {
                isUp = true;
                MoveIndex(++priceListCurrentIndex);
            }
            else if (GetSingleNumber(middleNumber) == GetSingleNumber(resultNumber))
            {
                isUp = true;
                MoveIndex(priceListCurrentIndex = maxBallsLength);
                PlayJokerAnimation(ballCurrentIndex, upBallList[ballCurrentIndex]);
                isJoker = true;
            }
            else
            {
                MoveIndex(--priceListCurrentIndex);
            }

            upBallList[ballCurrentIndex].ValueValidation(GetSingleNumber(resultNumber), isUp, isJoker);
            ballCurrentIndex++;

            if (ballCurrentIndex < maxBallsLength && !isJoker)
            {
                if (nextTurnCoroutine != null)
                {
                    StopCoroutine(nextTurnCoroutine);
                }
                nextTurnCoroutine = StartCoroutine(NextTurn(ballCurrentIndex, timerReset));
            }
            else
                GameFinish();
        }
    }

    public void DownButtonTap(int resultNumber = 0, int turnCount = 0, bool timerReset = true)
    {
        bool isDown = false;
        bool isJoker = false;

        if (!Is_Game_4)
        {
            ballCurrentIndex = turnCount;

            if (GetSingleNumber(middleNumber) > resultNumber)
            {
                isDown = true;
                MoveIndex(++priceListCurrentIndex);
            }
            else if (GetSingleNumber(middleNumber) == resultNumber)
            {
                isDown = true;
                MoveIndex(priceListCurrentIndex = maxBallsLength);
                PlayJokerAnimation(ballCurrentIndex, downBallList[ballCurrentIndex]);
                isJoker = true;
            }
            else
            {
                MoveIndex(--priceListCurrentIndex);
            }

            downBallList[ballCurrentIndex].ValueValidation(resultNumber, isDown, isJoker);
            ballCurrentIndex++;

            if (ballCurrentIndex < maxBallsLength && !isJoker)
            {
                if (nextTurnCoroutine != null)
                {
                    StopCoroutine(nextTurnCoroutine);
                }
                nextTurnCoroutine = StartCoroutine(NextTurn(ballCurrentIndex, timerReset));
            }
            else
                GameFinish();
        }
        else
        {
            if (GetSingleNumber(middleNumber) > GetSingleNumber(resultNumber))
            {
                isDown = true;
                MoveIndex(++priceListCurrentIndex);
            }
            else if (GetSingleNumber(middleNumber) == GetSingleNumber(resultNumber))
            {
                isDown = true;
                MoveIndex(priceListCurrentIndex = maxBallsLength);
                PlayJokerAnimation(ballCurrentIndex, downBallList[ballCurrentIndex]);
                isJoker = true;
            }
            else
            {
                MoveIndex(--priceListCurrentIndex);
            }

            downBallList[ballCurrentIndex].ValueValidation(GetSingleNumber(resultNumber), isDown, isJoker);
            ballCurrentIndex++;

            if (ballCurrentIndex < maxBallsLength && !isJoker)
            {
                if (nextTurnCoroutine != null)
                {
                    StopCoroutine(nextTurnCoroutine);
                }
                nextTurnCoroutine = StartCoroutine(NextTurn(ballCurrentIndex, timerReset));
            }
            else
                GameFinish();
        }
    }
    #endregion

    #region PRIVATE_METHODS
    private void StartGame()
    {
        Debug.Log("[MysteryGame] StartGame - Starting timer");
        if (Is_Game_4)
            ballCurrentIndex = 0;
        if (nextTurnCoroutine != null)
        {
            StopCoroutine(nextTurnCoroutine);
        }
        nextTurnCoroutine = StartCoroutine(NextTurn(ballCurrentIndex, true));
    }

    private void PlayArrowGuideAnimation(bool play)
    {
        if (play)
        {
            arrowClickGuide.Close();
            arrowClickGuide.transform.localPosition = middleBallList[ballCurrentIndex].transform.localPosition;
            arrowClickGuide.Open();
        }
        else
        {
            arrowClickGuide.Close();
        }
    }

    private void PlayJokerAnimation(int index, MysteryGameSelectionBall ball)
    {
        jokerList[index].transform.position = ball.transform.position;
        jokerList[index].Open();
    }

    private void GameFinish()
    {
        Debug.Log("GAME FINISH");
        if (autoTurnCoroutine != null)
        {
            StopCoroutine(autoTurnCoroutine);
        }

        TurnOffAllMiddleBallsHighlight();
        DisableUpDownButtons();

        CallMysteryGameFinishedEvent();
    }

    private void CallMysteryGameFinishedEvent()
    {
        txtTimer.text = "";
        gameFinishEventCallPending = true;

        if (Is_Game_4)
        {
            // UIManager.Instance.DisplayLoader(true);
            EventManager.Instance.MysteryGameFinished(socket, gameId, prizeList[resultIndex], MysteryGameFinishedResponse);
        }
    }

    IEnumerator Auto_Back_To_Lobby()
    {
        yield return new WaitForSeconds(4f);
        if (Is_Game_4)
        {
        }
        else
        {
#if UNITY_WEBGL
            if (!UIManager.Instance.isGameWebGL)
            {
                // PanelMiniGameWinners.OpenData(startMiniGameBroadcast.winningTicketNumbers);
                UIManager.Instance.bingoHallDisplayPanel.OpenResultPanel(startMiniGameBroadcast);
            }
#endif
        }

        float time = 12f;
        while (time > 0f)
        {
            time -= Time.deltaTime;
            yield return new WaitForEndOfFrame();
        }
        if (gameObject.activeSelf)
        {
            OnBackButtonTap();
        }
    }

    private void MysteryGameFinishedResponse(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("MysteryGameFinishedResponse: " + packet.ToString());

        gameFinishEventCallPending = false;
        UIManager.Instance.DisplayLoader(false);

        if (Is_Game_4)
        {
            EventResponse<MysteryGameFinishedResponse> response = JsonUtility.FromJson<EventResponse<MysteryGameFinishedResponse>>(Utility.Instance.GetPacketString(packet));

            if (response.status == Constants.EventStatus.SUCCESS)
            {
                gameFinishEventCallPending = false;
                UIManager.Instance.gameAssetData.Points = response.result.points.ToString("###,###,##0.00");
                UIManager.Instance.gameAssetData.RealMoney = response.result.realMoney.ToString("###,###,##0.00");
                UIManager.Instance.gameAssetData.TodaysBalance = response.result.realMoney.ToString("###,###,##0.00");

                if (response.result.isWinningInPoints)
                {
#if UNITY_WEBGL
                    if (UIManager.Instance.isGameWebGL)
                    {
                        UIManager.Instance.LaunchWinningAnimation(LocalizationManager.GetTranslation("Congratulations You have won x Kr").Replace("{0}", prizeList[resultIndex].ToString()), 5);
                    }
                    else
                    {
                        // UIManager.Instance.LaunchWinningAnimation($"Congratulations You have won {prizeList[resultIndex]} Kr", 5f);
                    }
#else
                    UIManager.Instance.LaunchWinningAnimation(LocalizationManager.GetTranslation("Congratulations You have won x Kr").Replace("{0}", prizeList[resultIndex].ToString()), 5);
#endif
                }
                else
                {
#if UNITY_WEBGL
                    if (UIManager.Instance.isGameWebGL)
                    {
                        UIManager.Instance.LaunchWinningAnimation(LocalizationManager.GetTranslation("Congratulations You have won x Kr").Replace("{0}", prizeList[resultIndex].ToString()), 5);
                    }
                    else
                    {
                        // UIManager.Instance.LaunchWinningAnimation($"Congratulations You have won {prizeList[resultIndex]} Kr", 5f);
                    }
#else
                    UIManager.Instance.LaunchWinningAnimation(LocalizationManager.GetTranslation("Congratulations You have won x Kr").Replace("{0}", prizeList[resultIndex].ToString()), 5);
#endif
                }
            }
            else
            {
                UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
            }
        }
        else
        {
            MysteryGameFinishedBroadcastResponse responsebroadcast = JsonUtility.FromJson<MysteryGameFinishedBroadcastResponse>(Utility.Instance.GetPacketString(packet));
#if UNITY_WEBGL
            if (UIManager.Instance.isGameWebGL)
            {
                UIManager.Instance.LaunchWinningAnimation(LocalizationManager.GetTranslation("Congratulations You have won x Kr").Replace("{0}", responsebroadcast.playerFinalWinningAmount.ToString()), 5);
            }
            else
            {
                // UIManager.Instance.LaunchWinningAnimation($"Congratulations You have won {prizeList[resultIndex]} Kr", 5f);
            }
#else
            // UIManager.Instance.LaunchWinningAnimation(LocalizationManager.GetTranslation("Congratulations You have won x Kr In Mystery Game.").Replace("{0}", response.playerFinalWinningAmount.ToString()), 5);
            UIManager.Instance.LaunchWinningAnimation(LocalizationManager.GetTranslation("Congratulations You have won x Kr").Replace("{0}", responsebroadcast.playerFinalWinningAmount.ToString()), 5);
#endif
        }
        if (autoBackToLobbyCoroutine != null)
        {
            StopCoroutine(autoBackToLobbyCoroutine);
        }
        autoBackToLobbyCoroutine = StartCoroutine(Auto_Back_To_Lobby());
    }

    private void MysteryGameFinishedAdminResponse(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("MysteryGameFinishedAdminResponse: " + packet.ToString());
        gameFinishEventCallPending = false;
        StartMiniGameBroadcast response = JsonUtility.FromJson<StartMiniGameBroadcast>(Utility.Instance.GetPacketString(packet));
        startMiniGameBroadcast = response;

        if (autoBackToLobbyCoroutine != null)
        {
            StopCoroutine(autoBackToLobbyCoroutine);
        }
        autoBackToLobbyCoroutine = StartCoroutine(Auto_Back_To_Lobby());
    }

    void On_Mystery_Game_toggleGameStatus(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("On_Mystery_Game_toggleGameStatus: " + packet.ToString());
        toggleGameStatus res = JsonUtility.FromJson<toggleGameStatus>(Utility.Instance.GetPacketString(packet));
        if (res.status.Equals("Pause"))
        {
            // SoundManager.Instance.BingoSound(true);
            // UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.GamePausedByAdminMessage);
            isPaused = true;
        }
        else if (res.status.Equals("Resume"))
        {
            // UIManager.Instance.messagePopup.DisplayMessagePopupAutoHide(Constants.LanguageKey.GameResumedByAdminMessage, true);
            isPaused = false;
        }
        else
        {
            // UIManager.Instance.messagePopup.DisplayMessagePopupAutoHide(Constants.LanguageKey.GameResumedByAdminMessage, true);
            isPaused = false;
        }
    }

    private void RefreshMiddleBalls()
    {
        // char[] middleNumberString = middleNumber.ToString().ToCharArray();
        // int revIndex = maxBallsLength - 1;
        // Pad the number with leading zeros to ensure it has exactly 5 digits
        string middleNumberString = middleNumber.ToString("D5");
        int revIndex = maxBallsLength - 1;

        for (int i = 0; i < maxBallsLength; i++)
        {
            middleBallList[i].Number = int.Parse(middleNumberString[revIndex--].ToString());
        }
    }

    private void MoveIndex(int index)
    {
        if (index < 0)
            index = priceListCurrentIndex = 0;
        else if (index > maxBallsLength)
            index = priceListCurrentIndex = maxBallsLength;

        float newYAxisAmount = panelAmountDefaultY - (incrementalValueY * index);
        float newYAxisMagnifierAmount = panelMgnifierAmountDefaultY - (incrementalMgnifierValueY * index);


        Vector3 vectorAmountPosition = new Vector3(0, newYAxisAmount, 0);
        Vector3 vectorMagnifierAmountPosition = new Vector3(0, newYAxisMagnifierAmount, 0);

        //Debug.LogError("vectorAmountPosition : " + vectorAmountPosition);
        //Debug.LogError("vectorMagnifierAmountPosition : " + vectorMagnifierAmountPosition);

        Utility.Instance.MoveObject(panelAmount, vectorAmountPosition, priceListAnimationTime);
        Utility.Instance.MoveObject(panelMagnifierAmount, vectorMagnifierAmountPosition, priceListAnimationTime);
        resultIndex = index;
    }

    private void TurnOffAllMiddleBallsHighlight()
    {
        foreach (MysteryGameMiddleBall data in middleBallList)
            data.Highlight = false;
    }

    private void DisableUpDownButtons()
    {
        foreach (MysteryGameSelectionBall data in upBallList)
            data.ButtonEnable = false;

        foreach (MysteryGameSelectionBall data in downBallList)
            data.ButtonEnable = false;
    }

    private void Reset()
    {
        txtTimer.text = "";
        gameFinishEventCallPending = false;
        priceListCurrentIndex = 0;
        panelAmount.localPosition = new Vector3(0, panelAmountDefaultY, 0);
        panelMagnifierAmount.localPosition = new Vector3(0, panelMgnifierAmountDefaultY, 0);

        foreach (MysteryGameSelectionBall data in upBallList)
            data.Reset();

        foreach (MysteryGameSelectionBall data in downBallList)
            data.Reset();

        foreach (GameObject data in jokerList)
            data.Close();
        DisableUpDownButtons();
        TurnOffAllMiddleBallsHighlight();

        PlayArrowGuideAnimation(false);
    }

    private int GetSingleNumber(int number)
    {
        // char[] middleNumberString = number.ToString().ToCharArray();
        // int revIndex = number.ToString().Length - 1 - ballCurrentIndex;
        // Pad the number with leading zeros to ensure it has exactly 5 digits
        string middleNumberString = number.ToString("D5");
        int revIndex = middleNumberString.Length - 1 - ballCurrentIndex;
        return int.Parse(middleNumberString[revIndex].ToString());
    }

    private void Reconnect()
    {
        if (gameFinishEventCallPending)
            CallMysteryGameFinishedEvent();
    }

    #endregion

    #region COROUTINES
    // private IEnumerator NextTurn(int turnIndex, bool timerReset, int overrideTime = -1)
    // {
    //     int timerValue;

    //     if (overrideTime > 0)
    //     {
    //         // use server-provided remaining time
    //         timerValue = overrideTime;
    //     }
    //     else if (timerReset)
    //     {
    //         // new turn
    //         timerValue = (turnIndex == 0)? (int)autoTurnWaitingTimeFirstMove: (int)autoTurnWaitingTimeOtherMove;
    //     }
    //     else
    //     {
    //         // continue existing
    //         timerValue = (int)autoTurnWaitingTimeOtherMove;
    //     }

    //     txtTimer.text = "00:" + timerValue.ToString("00");

    //     while (timerValue > 0)
    //     {
    //         yield return new WaitForSeconds(1f);
    //         timerValue--;
    //         txtTimer.text = "00:" + timerValue.ToString("00");
    //     }

    //     PlayArrowGuideAnimation(true);
    //     middleBallList[ballCurrentIndex].Highlight = true;
    //     upBallList[ballCurrentIndex].ButtonEnable = true;
    //     downBallList[ballCurrentIndex].ButtonEnable = true;
    //     AutoTurn(); // no args needed
    // }

    IEnumerator NextTurn(int ballCurrentIndex, bool timerReset = true)
    {
        Debug.Log("[MysteryGame] NextTurn - BallCurrentIndex: " + ballCurrentIndex + " TimerReset: " + timerReset);
        TurnOffAllMiddleBallsHighlight();
        DisableUpDownButtons();

        if (timerReset)
        {
            Debug.Log("[MysteryGame] NextTurn - Starting AutoTurn coroutine");
            if (autoTurnCoroutine != null)
            {
                StopCoroutine(autoTurnCoroutine);
            }
            autoTurnCoroutine = StartCoroutine(AutoTurn());
        }

        yield return new WaitForSeconds(2);

        PlayArrowGuideAnimation(true);
        middleBallList[ballCurrentIndex].Highlight = true;
        upBallList[ballCurrentIndex].ButtonEnable = true;
        downBallList[ballCurrentIndex].ButtonEnable = true;
    }

    IEnumerator AutoTurn()
    {
        if (Is_Game_4)
        {
            timerValue = 20;
        }
        else
        {
            timerValue = isForceReset ? (int)autoTurnWaitingTimeFirstMove : (int)autoTurnWaitingTimeOtherMove;
            if (!isForceReset)
                isForceReset = true;
        }

        Debug.Log($"[MysteryGame] AutoTurn - Starting timer with {timerValue} seconds");
        txtTimer.text = "";

        if (Is_Game_4)
            yield return new WaitForSeconds(2);
        else
            yield return new WaitForSeconds(0);

        for (int i = timerValue; i >= 0; i--)
        {
            txtTimer.text = "00:" + i.ToString("00");

            // Check if the game is paused and wait until it resumes
            while (isPaused)
            {
                Debug.Log("[MysteryGame] AutoTurn - Paused, waiting for resume" + isPaused);
                yield return null;
            }

            // Check the condition and pause if needed
            if (!Is_Game_4)
            {
                while (!GameSocketManager.SocketConnected)
                {
                    Debug.Log("[MysteryGame] AutoTurn - Socket not connected, waiting for connection" + GameSocketManager.SocketConnected);
                    yield return null; // Pause the coroutine
                }
            }

            yield return new WaitForSeconds(1);
        }

        Debug.Log("[MysteryGame] AutoTurn - Timer completed");

        // yield return new WaitForSeconds(ballCurrentIndex == 0 ? autoTurnWaitingTimeFirstMove : autoTurnWaitingTimeOtherMove);

        if (Is_Game_4)
        {
            int middle = GetSingleNumber(middleNumber);

            Debug.LogError("Middle number Selecting :" + middle);

            if (middle <= 4)
                UpButtonTap(resultNumber, ballCurrentIndex);
            else
                DownButtonTap(resultNumber, ballCurrentIndex);
        }
    }

    //IEnumerator AutoTurn()
    //{
    //    if (Is_Game_4)
    //    {
    //        timerValue = ballCurrentIndex == 0 ? (int)autoTurnWaitingTimeFirstMove : (int)autoTurnWaitingTimeOtherMove;
    //    }
    //    else
    //    {
    //        timerValue = isForceReset ? (int)autoTurnWaitingTimeFirstMove : (int)autoTurnWaitingTimeOtherMove;
    //        if (!isForceReset)
    //            isForceReset = true;
    //    }

    //    txtTimer.text = "";

    //    if (Is_Game_4)
    //        yield return new WaitForSeconds(2);
    //    else
    //        yield return new WaitForSeconds(0);

    //    for (int i = timerValue; i >= 0; i--)
    //    {
    //        txtTimer.text = "00:" + i.ToString("00");

    //        // Check if the game is paused and wait until it resumes
    //        while (isPaused)
    //        {
    //            yield return null;
    //        }

    //        // Check the condition and pause if needed
    //        if (!Is_Game_4)
    //        {
    //            while (!GameSocketManager.SocketConnected)
    //            {
    //                yield return null; // Pause the coroutine
    //            }
    //        }

    //        yield return new WaitForSeconds(1);
    //    }

    //    // yield return new WaitForSeconds(ballCurrentIndex == 0 ? autoTurnWaitingTimeFirstMove : autoTurnWaitingTimeOtherMove);

    //    if (Is_Game_4)
    //    {
    //        int middle = GetSingleNumber(middleNumber);

    //        Debug.LogError("Middle number Selecting :" + middle);

    //        if (middle <= 4)
    //            UpButtonTap(resultNumber, ballCurrentIndex);
    //        else
    //            DownButtonTap(resultNumber, ballCurrentIndex);
    //    }
    //}

    //IEnumerator AutoTurn()
    //{
    //    if (Is_Game_4)
    //    {
    //        timerValue = ballCurrentIndex == 0 ? (int)autoTurnWaitingTimeFirstMove : (int)autoTurnWaitingTimeOtherMove;
    //    }
    //    else
    //    {
    //        timerValue = isForceReset ? (int)autoTurnWaitingTimeFirstMove : (int)autoTurnWaitingTimeOtherMove;
    //        if (!isForceReset)
    //            isForceReset = true;
    //    }

    //    txtTimer.text = "";

    //    if (Is_Game_4)
    //        yield return new WaitForSeconds(2);
    //    else
    //        yield return new WaitForSeconds(0);


    //    for (int i = timerValue; i >= 0; i--)
    //    {
    //        txtTimer.text = "00:" + i.ToString("00");

    //        if (!Is_Game_4)
    //        {
    //            // Check the condition and pause if needed
    //            while (!GameSocketManager.SocketConnected)
    //            {
    //                yield return null; // Pause the coroutine
    //            }
    //        }

    //        yield return new WaitForSeconds(1);
    //    }

    //    //yield return new WaitForSeconds(ballCurrentIndex == 0 ? autoTurnWaitingTimeFirstMove : autoTurnWaitingTimeOtherMove);

    //    if (Is_Game_4)
    //    {
    //        int middle = GetSingleNumber(middleNumber);

    //        Debug.LogError("Middle number Selecting :" + middle);

    //        if (middle <= 4)
    //            UpButtonTap(resultNumber, ballCurrentIndex);
    //        else
    //            DownButtonTap(resultNumber, ballCurrentIndex);
    //    }
    //}
    #endregion

    #region GETTER_SETTER
    #endregion
}
