using System;
using System.Collections;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using BestHTTP.SocketIO;
using I2.Loc;
using TMPro;
using UnityEngine;
using UnityEngine.UI;
using static Constants;

public class BingoHallDisplay : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    public bool isRefresh = false;
    #endregion

    #region PRIVATE_VARIABLES
    [SerializeField] private Sprite muteImg;
    [SerializeField] private Sprite unmuteImg;
    [SerializeField] private Button soundBtn;
    //[DllImport("__Internal")]
    //private static extern void RequestHallDisplayRoomId();
    [SerializeField]
    private Image bingoBtn;

    [SerializeField]
    private Sprite bingoBtnYellow;

    [SerializeField]
    private Sprite bingoBtnGrey;

    [Header("Game Object")]
    [SerializeField]
    private GameObject panelLiveRoomData;

    [SerializeField]
    private GameObject ExitBtn;

    [SerializeField]
    public GameObject panelResult;

    [SerializeField]
    private GameObject panelRowWinner;

    [Header("Text")]
    [SerializeField]
    private TextMeshProUGUI txtTotalNumbersWithdrawn;

    [SerializeField]
    private TextMeshProUGUI txtFullHouseWinners;

    [SerializeField]
    private TextMeshProUGUI txtPatternsWon;

    [SerializeField]
    private TextMeshProUGUI txtCurrentLanguage;

    [Header("Panel")]
    [SerializeField]
    private BingoBallPanelManager2 bingoBallPanelManager;
    [SerializeField]
    private ClaimWinnerPanel claimWinnerPanel;

    [Header("Prefab")]
    [SerializeField]
    private PrefabHallDispalyPatternDetails prefabWinnerDetails;

    [Header("Transform")]
    [SerializeField]
    private Transform transformContainer;

    [Header("Data")]
    [SerializeField]
    private string roomId = "";

    [SerializeField]
    private string gameId = "";

    [SerializeField]
    public string roomId_For_Editor = "";
    [SerializeField]
    public string hallId_For_Editor = "";

    [SerializeField]
    private string adminNameSpace = "";

    [SerializeField]
    private Socket adminSocket;

    [SerializeField]
    private GAME_STATUS gameStatus = GAME_STATUS.Waiting;
    public AdminHallDisplayGameHistory gameHistory = new AdminHallDisplayGameHistory();
    public JackPotData jackPotData = new JackPotData();
    public List<PrefabHallDispalyPatternDetails> prefabWinnerDetailsList =
        new List<PrefabHallDispalyPatternDetails>();
    public ticketWinner ticketWinnerDisplay;

    [Header("Timer")]
    public GameObject Timer_PopUP;
    public TMP_Text Counter_Txt;
    public TMP_Text NextGame_Counter_Txt;

    [Header("Winner")]
    public AdminTVScreenWinners Winner_Prefab;
    public List<AdminTVScreenWinners> Winners_List;
    public RectTransform Winners_Parent;

    [Header("Game")]
    public TMP_Text Game_Name_Txt;
    public TMP_Text Current_Game_Name_Txt;
    public TMP_Text Next_Game_Name_Txt;
    public TMP_Text Game_Count_Txt,
        Ball_Drawn_Count_Txt;
    public GameObject Ball_Drawn_Display;

    [Header("Mini Games")]
    public GameObject MiniGamesParent;
    public WheelOfFortunePanel wheelOfFortunePanel;
    public FortuneWheelManager fortuneWheelManager;
    public NewFortuneWheelManager newFortuneWheelManager;
    public TreasureChestPanel treasureChestPanel;
    public MysteryGamePanel mysteryGamePanel;
    public ColorDraftPanel colorDraftPanel;
    public PanelMiniGameWinners PanelMiniGameWinners;

    public Sprite BackgroundSprite;

    [Header("Game Finish")]
    public bool isFinishDataSet;

    private string deviceType;
    public bool isButtonTap = false;
    public bool isGameFinish;
    public bool isBingo = false;
    private string DeviceType;
    public string HallId;

    // Default language (English)
    public string currentLanguage = "Norwegian Male";
    private const string LanguagePrefKey = "CurrentLanguage";
    public soundlanguage CurrentSoundLanguage = soundlanguage.NorwegianMale;

    Coroutine refreshPanelAfterDelayCoroutine;
    Coroutine CallAdminLoginEventWithDelayCoroutine;
    #endregion

    #region UNITY_CALLBACKS
#if UNITY_EDITOR
    //Use this code for refresh scenario in webgl for editor
    void OnApplicationFocus(bool hasFocus)
    {
        if (hasFocus)
        {
            Debug.Log("Application gained focus.");
            Refresh();
        }
        else
        {
            Debug.Log("Application lost focus.");
            // Code to execute when the application loses focus.
        }
    }
#endif
    #endregion

    #region DELEGATE_CALLBACKS

    private void Awake()
    {
        HardReset();
        Reset();
    }

    private void Update()
    {
#if UNITY_EDITOR
        if (Input.GetKeyDown(KeyCode.Space))
        {
            AdminDashboardWinningData winningData1 =
                JsonUtility.FromJson<AdminDashboardWinningData>(sss);
            data = winningData1;
        }
#endif
    }

    private void OnEnable()
    {
        //by default sound is muted
        SoundManager.Instance.TvScreenSoundStatus = false;
        soundBtn.image.sprite = muteImg;
        bingoBtn.sprite = bingoBtnYellow;
        if (!PlayerPrefs.HasKey(LanguagePrefKey))
        {
            PlayerPrefs.SetInt(LanguagePrefKey, 0);
        }

        SwitchLanguage();

#if UNITY_EDITOR
        this.adminSocket = GameSocketManager.socketManager?.GetSocket("/" + adminNameSpace);
#endif
        GameSocketManager.OnSocketReconnected += Reconnect;
        // UIManager.Instance.DisplayLoader(true);

        panelLiveRoomData.Close();
        panelResult.Close();
        claimWinnerPanel.Close();
        Application.ExternalCall("requestGameData");
        Application.ExternalCall("sendDeviceTypeToUnity");
        //RequestHallDisplayRoomId();
#if UNITY_EDITOR
        EnableBroadcasts();
        roomId = roomId_For_Editor;
        HallId = hallId_For_Editor;
        AdminLoginEventCall();
#endif
    }

    private void OnDisable()
    {
        GameSocketManager.OnSocketReconnected -= Reconnect;
        DisableBroadcasts();
    }
    #endregion

    #region PUBLIC_METHODS
    public void MuteUnmuteBtnTap()
    {
        if (SoundManager.Instance.TvScreenSoundStatus)
        {
            SoundManager.Instance.TvScreenSoundStatus = false;
            soundBtn.image.sprite = muteImg;
        }
        else
        {
            SoundManager.Instance.TvScreenSoundStatus = true;
            soundBtn.image.sprite = unmuteImg;
        }
    }
    #endregion

    #region BROADCAST_HANDLING
    private void EnableBroadcasts()
    {
        Debug.Log("EnableBroadcasts");
        Debug.Log("this.adminSocket :" + this.adminSocket);

        if (this.adminSocket == null)
        {
            Debug.Log("Failed to retrieve socket — skipping broadcasts.");
            return;
        }

        adminSocket.Off(Constants.BroadcastName.SubscribeRoomAdmin);
        adminSocket.Off(Constants.BroadcastName.WithdrawBingoBall, OnWithdrawBingoBall);
        adminSocket.Off(Constants.BroadcastName.BingoWinningAdmin, OnBingoWinning);
        adminSocket.Off(Constants.BroadcastName.GameFinishAdmin, OnGameFinish);
        adminSocket.Off(Constants.BroadcastName.TVScreenGameRefreshRoom, Refresh_Room);
        adminSocket.Off(Constants.BroadcastName.countDownToStartTheGame, OnCountDownToStartTheGame);
        adminSocket.Off(Constants.BroadcastName.ActivateMiniGame, OnActivateMiniGame);
        adminSocket.Off(Constants.BroadcastName.adminExtraGameNoti, adminExtraGameNoti);
        adminSocket.Off(Constants.BroadcastName.toggleGameStatus, On_Admin_toggleGameStatus);
        adminSocket.Off(Constants.BroadcastName.BingoAnnouncement, OnBingoAnnouncement);
        adminSocket.Off(Constants.BroadcastName.nextGameStartCountDownTime, OnnextGameStartCountDownTime);
        adminSocket.Off(Constants.BroadcastName.playerClaimWinner, OnplayerClaimWinner);

        adminSocket.On(Constants.BroadcastName.PatternChange, OnPatternChange);
        adminSocket.On(Constants.BroadcastName.SubscribeRoomAdmin, OnSubscribeRoom);
        adminSocket.On(Constants.BroadcastName.WithdrawBingoBall, OnWithdrawBingoBall);
        adminSocket.On(Constants.BroadcastName.BingoWinningAdmin, OnBingoWinning);
        adminSocket.On(Constants.BroadcastName.GameFinishAdmin, OnGameFinish);
        adminSocket.On(Constants.BroadcastName.TVScreenGameRefreshRoom, Refresh_Room);
        adminSocket.On(Constants.BroadcastName.countDownToStartTheGame, OnCountDownToStartTheGame);
        adminSocket.On(Constants.BroadcastName.ActivateMiniGame, OnActivateMiniGame);
        adminSocket.On(Constants.BroadcastName.adminExtraGameNoti, adminExtraGameNoti);
        adminSocket.On(Constants.BroadcastName.toggleGameStatus, On_Admin_toggleGameStatus);
        adminSocket.On(Constants.BroadcastName.BingoAnnouncement, OnBingoAnnouncement);
        adminSocket.On(Constants.BroadcastName.nextGameStartCountDownTime, OnnextGameStartCountDownTime);
        adminSocket.On(Constants.BroadcastName.playerClaimWinner, OnplayerClaimWinner);
    }

    private void DisableBroadcasts()
    {
        Debug.Log("DisableBroadcasts");
        if (adminSocket == null) return;

        adminSocket.Off(Constants.BroadcastName.SubscribeRoomAdmin);
        adminSocket.Off(Constants.BroadcastName.WithdrawBingoBall, OnWithdrawBingoBall);
        adminSocket.Off(Constants.BroadcastName.BingoWinningAdmin, OnBingoWinning);
        adminSocket.Off(Constants.BroadcastName.GameFinishAdmin, OnGameFinish);
        adminSocket.Off(Constants.BroadcastName.TVScreenGameRefreshRoom, Refresh_Room);
        adminSocket.Off(Constants.BroadcastName.countDownToStartTheGame, OnCountDownToStartTheGame);
        adminSocket.Off(Constants.BroadcastName.ActivateMiniGame, OnActivateMiniGame);
        adminSocket.Off(Constants.BroadcastName.adminExtraGameNoti, adminExtraGameNoti);
        adminSocket.Off(Constants.BroadcastName.toggleGameStatus, On_Admin_toggleGameStatus);
        adminSocket.Off(
            Constants.BroadcastName.nextGameStartCountDownTime,
            OnnextGameStartCountDownTime
        );
        adminSocket.Off(Constants.BroadcastName.playerClaimWinner, OnplayerClaimWinner);
    }

    private void OnplayerClaimWinner(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnplayerClaimWinner: " + packet.ToString());
        ClaimWinningResponse claimWinningResponse = JsonUtility.FromJson<ClaimWinningResponse>(Utility.Instance.GetPacketString(packet));

        claimWinnerPanel.SetData(claimWinningResponse);
    }

    public void OnBingoBtnTap()
    {
        isButtonTap = true;
        EventManager.Instance.StopGameByPlayers(
            (socket, packet, args) =>
            {
                Debug.Log($"StopGameByPlayers Response: {packet}");
                EventResponse response = JsonUtility.FromJson<EventResponse>(
                    Utility.Instance.GetPacketString(packet)
                );
                if (response.status.Equals("success"))
                {
                    // bingoBallPanelManager.DisplayBigBallOnWin(true, false);
                    // SoundManager.Instance.BingoSound(true);
                    UIManager.Instance.messagePopup.DisplayMessagePopupAutoHide(
                        response.message,
                        true
                    );
                    isButtonTap = false;
                }
                else
                {
                    UIManager.Instance.messagePopup.DisplayMessagePopupAutoHide(
                        response.message,
                        true
                    );
                    isButtonTap = false;
                }
            }
        );
    }

    public void OnExitButtonTap()
    {
        switch (DeviceType)
        {
            case "android":
                Application.OpenURL("spillorama://open");
                break;
            case "iOS":
                Application.OpenURL("spillorama://open");
                break;
            case "other":
                Application.OpenURL("spillorama://open");
                break;
            case "web":
                Application.ExternalCall("openSpilloramaTab");
                break;
            default:
                // Application.Quit();
                Debug.Log("no device found");
                Application.ExternalCall("CloseSpilloramaTvScreenTab");
                break;
        }
    }

    private void OnPatternChange(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnPatternChange: " + packet.ToString());
        PatternChangeResponse patternList = JsonUtility.FromJson<PatternChangeResponse>(
            Utility.Instance.GetPacketString(packet)
        );
        jackPotData = patternList.jackPotData;
        for (int i = 0; i < prefabWinnerDetailsList.Count; i++)
        {
            prefabWinnerDetailsList[i].SetJackPotData(patternList.jackPotData);
        }
    }

    private void OnnextGameStartCountDownTime(Socket socket, Packet packet, object[] args)
    {
        Debug.LogError("nextGameStartCountDownTime : " + packet.ToString());

        NextGameData data = JsonUtility.FromJson<NextGameData>(
            Utility.Instance.GetPacketString(packet)
        );

        string utcDateTimeStr = data.countDownTime;
        Debug.LogError("Raw UTC DateTime String: " + utcDateTimeStr);
        // Check if the string is null or empty
        if (!string.IsNullOrEmpty(utcDateTimeStr))
        {
            try
            {
                DateTimeOffset utcDateTime;
                if (
                    DateTimeOffset.TryParse(
                        utcDateTimeStr,
                        null,
                        System.Globalization.DateTimeStyles.RoundtripKind,
                        out utcDateTime
                    )
                )
                {
                    NextGame_Counter_Txt.gameObject.SetActive(true);
                    DateTime localDateTime = utcDateTime.LocalDateTime;
                    Debug.LogError(
                        "Local DateTime: " + localDateTime.ToString("yyyy-MM-dd HH:mm:ss")
                    );
                    StartCoroutine(StartCountdown(localDateTime));
                }
                else
                {
                    Debug.LogError("Invalid date format: " + utcDateTimeStr);
                }
            }
            catch (Exception ex)
            {
                Debug.LogError("Error parsing date: " + ex.Message);
            }
        }
        else
        {
            Debug.LogError("Error: countDownDateTime is null or empty.");
        }
    }

    IEnumerator StartCountdown(DateTime targetTime)
    {
        while (true)
        {
            DateTime currentLocalTime = DateTime.Now;
            TimeSpan timeRemaining = targetTime - currentLocalTime;

            if (timeRemaining.TotalSeconds <= 0)
            {
                NextGame_Counter_Txt.gameObject.SetActive(false);
                Counter_Txt.gameObject.SetActive(true);
                Debug.Log("Countdown finished!");
                NextGame_Counter_Txt.text = "00:00:00";
                yield break;
            }
            NextGame_Counter_Txt.gameObject.SetActive(true);
            Counter_Txt.gameObject.SetActive(false);
            // Debug.Log($"Time remaining: {timeRemaining.Hours:D2}:{timeRemaining.Minutes:D2}:{timeRemaining.Seconds:D2}");
            // NextGame_Counter_Txt.text = $"Wait for next game to start {timeRemaining.Minutes:D2}:{timeRemaining.Seconds:D2}";
            NextGame_Counter_Txt
                .GetComponent<LocalizationParamsManager>()
                .SetParameterValue("value1", timeRemaining.Minutes.ToString("D2"));
            NextGame_Counter_Txt
                .GetComponent<LocalizationParamsManager>()
                .SetParameterValue("value2", timeRemaining.Seconds.ToString("D2"));
            yield return new WaitForSeconds(1f);
        }
    }

    // private void BingoButtonColor(bool isPaused)
    // {
    //     bingoBtn.sprite = /*isPaused ? bingoBtnGrey :*/
    //     bingoBtnYellow;
    // }

    private void OnSubscribeRoom(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnSubscribeRoom: " + packet.ToString());
        AdminHallDisplayGameHistory gameHistory = JsonUtility.FromJson<AdminHallDisplayGameHistory>(
            Utility.Instance.GetPacketString(packet)
        );

        if (refreshPanelAfterDelayCoroutine != null)
        {
            StopCoroutine(refreshPanelAfterDelayCoroutine);
        }
        if (CallAdminLoginEventWithDelayCoroutine != null)
        {
            StopCoroutine(CallAdminLoginEventWithDelayCoroutine);
        }

        Debug.Log("gameHistory isGamePaused : " + gameHistory.isGamePaused);
        this.gameHistory = gameHistory;
        this.jackPotData = gameHistory.jackPotData;
        if (string.IsNullOrEmpty(DeviceType))
        {
            ExitBtn.SetActive(false);
        }
        else
        {
            ExitBtn.SetActive(true);
        }

        Debug.Log($"this.gameId != gameHistory.gameId : {this.gameId != gameHistory.gameId}");

        if (this.gameId != gameHistory.gameId)
        {
            Debug.Log($"reset sound and other");
            SoundManager.Instance.ResetPlayedAnnouncements();
            isGameFinish = false;
            withdraw = false;
        }
        Reset();
        // BingoButtonColor(gameHistory.isGamePaused);
        if (gameHistory.isGamePaused)
        {
            if (gameHistory.pauseGameStats.isPausedBySystem)
            {
                if (gameHistory.pauseGameStats.isBingoAnnounced && !SoundManager.Instance.HasBingoBeenPlayed())
                {
                    SoundManager.Instance.BingoSound(false);
                }
            }
            else
            {
                if (!SoundManager.Instance.HasBingoBeenPlayed() && !gameHistory.pauseGameStats.isWithoutAnnouncement)
                {
                    SoundManager.Instance.BingoSound(false);
                }
            }
            //UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.GamePausedByAdminMessage);
            // UIManager.Instance.messagePopup.DisplayMessagePopupAutoHide(Constants.LanguageKey.GamePausedByAdminMessage, true, 5f);
        }
        else
        {
            SoundManager.Instance.playedSoundTracker.Clear();
        }

        // Game_Name_Txt.text = gameHistory.gameName;
        Current_Game_Name_Txt.GetComponent<LocalizationParamsManager>().SetParameterValue("value", gameHistory.gameName);
        // Game_Count_Txt.text = $"Game {gameHistory.gameCount}";
        if (!string.IsNullOrEmpty(gameHistory.nextGame.gameName))
        {
            Next_Game_Name_Txt.gameObject.SetActive(true);
            Next_Game_Name_Txt.GetComponent<LocalizationParamsManager>().SetParameterValue("value", gameHistory.nextGame.gameName);
        }
        else
        {
            Next_Game_Name_Txt.gameObject.SetActive(false);
        }
        Game_Count_Txt
            .GetComponent<LocalizationParamsManager>()
            .SetParameterValue("value", gameHistory.gameCount.ToString());
        Ball_Drawn_Count_Txt.text = gameHistory.totalBallsDrawn.ToString();
        gameId = gameHistory.gameId;
        gameStatus = (GAME_STATUS)Enum.Parse(typeof(GAME_STATUS), gameHistory.gameStatus);

        if (gameStatus == GAME_STATUS.Finished)
        {
            if (gameHistory.minigameData == null || JsonUtility.ToJson(gameHistory.minigameData) == "{}" || !gameHistory.isMinigameData)
            // if (gameHistory.minigameData == null)
            {
                Refresh();
                return;
            }
            else
            {
                // if (!isFinishDataSet)
                // {
                //     OnGameFinishSetAfterReconnect(gameHistory.gameFinishAdminData);
                // }

                if (
                    gameHistory.minigameData.isMinigameActivated
                    && gameHistory.minigameData.isMinigamePlayed
                    && gameHistory.minigameData.isMinigameFinished
                )
                {
                    OnGameFinishSetAfterReconnect(gameHistory.gameFinishAdminData);
                    // Refresh();
                    // return;
                }
                else if (
                    gameHistory.minigameData.isMinigameActivated
                    && !gameHistory.minigameData.isMinigamePlayed
                )
                {
                    Debug.LogError("1");
                    MiniGamesParent.SetActive(true);
                    switch (gameHistory.minigameData.gameName)
                    {
                        case "Wheel of Fortune":
                            // wheelOfFortunePanel.Can_Spin = false;
                            newFortuneWheelManager.Can_Spin = false;
                            // fortuneWheelManager.Can_Spin = false;
                            CallWheelOfFortuneEvent(gameHistory, true);
                            break;

                        case "Treasure Chest":
                            if (gameHistory.minigameData.isForAdmin)
                                treasureChestPanel.Can_Click_On_Box = true;
                            else
                                treasureChestPanel.Can_Click_On_Box = false;
                            CallTreasureChestEvent();

                            break;
                        case "Mystery":
                            mysteryGamePanel.isForceReset = false;
                            if (gameHistory.minigameData.isForAdmin)
                                mysteryGamePanel.Can_Click_On_Box = true;
                            else
                                mysteryGamePanel.Can_Click_On_Box = false;
                            CallMysteryGameEvent();
                            break;

                        case "Color Draft":
                            colorDraftPanel.isForceReset = false;
                            if (gameHistory.minigameData.isForAdmin)
                                colorDraftPanel.Can_Click_On_Door = true;
                            else
                                colorDraftPanel.Can_Click_On_Door = false;
                            CallColorDraftGameEvent();
                            break;

                        default:
                            Refresh();
                            return;
                    }
                }
                else if (
                    gameHistory.minigameData.isMinigameActivated
                    && gameHistory.minigameData.isMinigamePlayed
                    && !gameHistory.minigameData.isMinigameFinished
                )
                {
                    Debug.LogError("2");
                    switch (gameHistory.minigameData.gameName)
                    {
                        case "Wheel of Fortune":
                            MiniGamesParent.SetActive(true);
                            // wheelOfFortunePanel.Close();
                            // fortuneWheelManager.Close();
                            newFortuneWheelManager.Close();
                            // PanelMiniGameWinners.OpenData(
                            //     gameHistory.minigameData.winningTicketNumbers,
                            //     true
                            // );
                            OnGameFinishSetAfterReconnect(gameHistory.gameFinishAdminData);
                            break;

                        case "Treasure Chest":
                            if (gameHistory.minigameData.isForAdmin)
                                treasureChestPanel.Can_Click_On_Box = true;
                            else
                                treasureChestPanel.Can_Click_On_Box = false;
                            CallTreasureChestEvent();
                            break;

                        case "Mystery":
                            if (gameHistory.minigameData.isForAdmin)
                                mysteryGamePanel.Can_Click_On_Box = true;
                            else
                                mysteryGamePanel.Can_Click_On_Box = false;
                            CallMysteryGameEvent();
                            break;

                        case "Color Draft":
                            colorDraftPanel.Close();
                            if (gameHistory.minigameData.isForAdmin)
                                colorDraftPanel.Can_Click_On_Door = true;
                            else
                                colorDraftPanel.Can_Click_On_Door = false;
                            CallColorDraftGameEvent();
                            break;

                        default:
                            Refresh();
                            return;
                    }
                }
                else
                {
                    Debug.LogError("3");
                    if (
                        !gameHistory.minigameData.isMinigameActivated
                        && !gameHistory.minigameData.isMinigamePlayed
                        && !gameHistory.minigameData.isMinigameFinished
                    )
                    {
                        Debug.Log("Wait For Refresh :  -- if ");
                    }
                    else
                    {
                        Debug.Log("Refresh Game : Else -- if ");
                        Refresh();
                    }
                }
            }
        }

        txtTotalNumbersWithdrawn.text = gameHistory.totalWithdrawCount.ToString();
        txtFullHouseWinners.text = gameHistory.fullHouseWinners.ToString();
        txtPatternsWon.text = gameHistory.patternsWon.ToString();

        panelLiveRoomData.SetActive(gameStatus != GAME_STATUS.Finished);
        // panelResult.SetActive(gameStatus == GAME_STATUS.Finished);

        GenerateBingoWinningList(gameHistory.winningList);

        // Assign winningTickets from gameHistory to the public data field
        if (this.data == null)
        {
            this.data = new AdminDashboardWinningData();
        }
        this.data.winningTickets = gameHistory.winningTickets;

        if (gameHistory.winningTickets != null && gameHistory.winningTickets.Count > 0)
        {
            panelRowWinner.Open();
            List<List<string>> winningTickets = new List<List<string>>();
            for (int i = 0; i < gameHistory.winningTickets.Count; i++)
            {
                if (gameHistory.winningTickets[i] != null)
                {
                    // Check if numbers is null before accessing it
                    if (gameHistory.winningTickets[i].numbers != null)
                    {
                        winningTickets.Add(gameHistory.winningTickets[i].numbers);
                        ticketWinnerDisplay.SetWinningTickets(
                            winningTickets,
                            gameHistory.winningTickets[i].patternName, gameHistory.winningTickets
                        );
                    }
                    else
                    {
                        Debug.LogError($"gameHistory.winningTickets[{i}].numbers is null, skipping...");
                    }
                }
                else
                {
                    Debug.LogError($"gameHistory.winningTickets[{i}] is null, skipping...");
                }
            }
        }
        else
        {
            Debug.LogWarning("gameHistory.winningTickets is null or empty, skipping ticket processing");
        }

        bingoBallPanelManager.WithdrawList(gameHistory.withdrawNumberList, gameHistory.nextNumber, gameHistory.isGamePaused, gameHistory.gameStatus);
        // bingoBallPanelManager.WithdrawList(gameHistory.withdrawNumberList);

        UIManager.Instance.DisplayLoader(false);
        if (gameHistory.totalWithdrawCount <= 0)
        {
            Debug.LogError("gameHistory.totalWithdrawCount <= 0");
            if (withdraw)
            {
                Debug.LogError("withdraw");
                Timer_PopUP.SetActive(false);
                NextGame_Counter_Txt.gameObject.SetActive(false);
                Ball_Drawn_Display.SetActive(true);
            }
            else if (gameHistory.withdrawNumberList.Count > 0)
            {
                Debug.LogError("gameHistory.withdrawNumberList.Count > 0");
                Timer_PopUP.SetActive(false);
                NextGame_Counter_Txt.gameObject.SetActive(false);
                Ball_Drawn_Display.SetActive(true);
            }
            else
            {
                Debug.LogError("else");
                Timer_PopUP.SetActive(true);
                // Counter_Txt.text = $"Wait for {gameHistory.gameName} game to start";
                Counter_Txt.gameObject.SetActive(true);
                Counter_Txt.GetComponent<I2.Loc.Localize>().SetTerm("Game Start");
                Counter_Txt
                    .GetComponent<LocalizationParamsManager>()
                    .SetParameterValue("GameName", gameHistory.gameName);
                Ball_Drawn_Display.SetActive(false);
            }
        }
        else if (gameHistory.withdrawNumberList.Count > 0)
        {
            Debug.LogError("gameHistory.withdrawNumberList.Count > 0");
            Timer_PopUP.SetActive(false);
            NextGame_Counter_Txt.gameObject.SetActive(false);
            Ball_Drawn_Display.SetActive(true);
        }
        else
        {
            Debug.LogError("else 2");
            Timer_PopUP.SetActive(false);
            NextGame_Counter_Txt.gameObject.SetActive(false);
            Ball_Drawn_Display.SetActive(true);
        }

        string utcDateTimeStr = gameHistory.countDownDateTime;
        Debug.LogError("Raw UTC DateTime String: " + utcDateTimeStr);
        // Check if the string is null or empty
        if (!string.IsNullOrEmpty(utcDateTimeStr))
        {
            try
            {
                DateTimeOffset utcDateTime;
                if (
                    DateTimeOffset.TryParse(
                        utcDateTimeStr,
                        null,
                        System.Globalization.DateTimeStyles.RoundtripKind,
                        out utcDateTime
                    )
                )
                {
                    NextGame_Counter_Txt.gameObject.SetActive(true);
                    Counter_Txt.gameObject.SetActive(false);
                    DateTime localDateTime = utcDateTime.LocalDateTime;
                    Debug.LogError(
                        "Local DateTime: " + localDateTime.ToString("yyyy-MM-dd HH:mm:ss")
                    );
                    StartCoroutine(StartCountdown(localDateTime));
                }
                else
                {
                    Debug.LogError("Invalid date format: " + utcDateTimeStr);
                }
            }
            catch (Exception ex)
            {
                Debug.LogError("Error parsing date: " + ex.Message);
            }
        }
        else
        {
            Debug.LogError("Error: countDownDateTime is null or empty.");
        }

        for (int i = 0; i < prefabWinnerDetailsList.Count; i++)
        {
            prefabWinnerDetailsList[i].SetJackPotData(gameHistory.jackPotData);
        }
    }

    bool withdraw = false;
    bool isFirstBall = false;

    private void OnWithdrawBingoBall(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnWithdrawBingoBall: " + packet.ToString());
        BingoNumberData ballData = JsonUtility.FromJson<BingoNumberData>(
            Utility.Instance.GetPacketString(packet)
        );
        withdraw = true;
        claimWinnerPanel.Close();
        //OLD CODE
        // bingoBallPanelManager.NewWithdraw(ballData);
        // if (currentLanguage == "Norwegian Female")
        // {
        //     SoundManager.Instance.PlayNorwegianFemaleNumberAnnouncement(ballData.number, true);
        // }
        // else if (currentLanguage == "Norwegian Male")
        // {
        //     SoundManager.Instance.PlayNorwegianMaleNumberAnnouncement(ballData.number, true);
        // }
        // else
        // {
        //     SoundManager.Instance.PlayNumberAnnouncement(ballData.number, true);
        // }


        Timer_PopUP.SetActive(false);
        NextGame_Counter_Txt.gameObject.SetActive(false);
        Ball_Drawn_Display.SetActive(true);
        Ball_Drawn_Count_Txt.text = ballData.totalWithdrawCount.ToString();

        if (ballData.isForPlayerApp)
        {
            isFirstBall = false;
            bingoBallPanelManager.NewWithdraw(ballData, null, false, true, true);
        }
        else
        {
            if (ballData.number == 0)
            {
                isFirstBall = true;
                bingoBallPanelManager.SetWithdrawBall(ballData, true);
            }
            else if (ballData.nextNumber == 0)
            {
                isFirstBall = false;
                bingoBallPanelManager.SetCurrenBigBall(ballData);
            }
            else
            {
                isFirstBall = false;
                bingoBallPanelManager.SetWithdrawBall(ballData, false);
            }
        }
    }

    public AdminDashboardWinningData data;
    public string sss = "";

    private void OnBingoWinning(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnBingoWinning: " + packet.ToString());
        AdminDashboardWinningData winningData = JsonUtility.FromJson<AdminDashboardWinningData>(
            Utility.Instance.GetPacketString(packet)
        );
        data = winningData;
        AddNewBingoWinningData(winningData);
        // bingoBallPanelManager.DisplayBigBallOnWin(true, true, false);
    }

    private void OnGameFinish(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnGameFinish: " + packet.ToString());
        AdminHallDisplayResult adminHallDisplayResult =
            JsonUtility.FromJson<AdminHallDisplayResult>(Utility.Instance.GetPacketString(packet));
        isGameFinish = true;
        withdraw = false;
        bingoBallPanelManager.DisplayBigBallOnWin(true, false, true);

        txtTotalNumbersWithdrawn.text = adminHallDisplayResult.totalWithdrawCount.ToString();
        txtFullHouseWinners.text = adminHallDisplayResult.fullHouseWinners.ToString();
        txtPatternsWon.text = adminHallDisplayResult.patternsWon.ToString();

        int length = Winners_List.Count;
        for (int i = 0; i < length; i++)
            Destroy(Winners_List[i].gameObject);
        Winners_List.Clear();

        length = adminHallDisplayResult.winners.Count;
        AdminTVScreenWinners winner;
        string specific;
        int count;
        for (int i = 0; i < length; i++)
        {
            winner = Instantiate(Winner_Prefab, Winners_Parent);

            //specific = "";
            //count = adminHallDisplayResult.winners[i].playerTypeSpecificWinners.Count;
            //for (int j = 0; j < count; j++)
            //    specific += $"{adminHallDisplayResult.winners[i].playerTypeSpecificWinners[j].userType}({adminHallDisplayResult.winners[i].playerTypeSpecificWinners[j].count})" + ((j + 1) < count ? " | " : "");
            //if (specific != "" && adminHallDisplayResult.winners[i].hallSpecificWinners.Count > 0)
            //    specific += " | ";
            //count = adminHallDisplayResult.winners[i].hallSpecificWinners.Count;
            //for (int j = 0; j < count; j++)
            //    specific += $"{adminHallDisplayResult.winners[i].hallSpecificWinners[j].hallName}({adminHallDisplayResult.winners[i].hallSpecificWinners[j].count})" + ((j + 1) < count ? " | " : "");

            winner.Set_Admin_TV_Screen_Winner(
                adminHallDisplayResult.winners[i].lineType,
                $"{adminHallDisplayResult.winners[i].count}",
                $"{adminHallDisplayResult.winners[i].finalWonAmount}",
                adminHallDisplayResult.winners[i].halls,
                adminHallDisplayResult.winners[i].playerIdArray
            );
            winner.RT.anchoredPosition = new Vector2(
                0f,
                -(10 + (i * winner.RT.rect.height) + (i * 10))
            );
            Winners_List.Add(winner);
        }

        Winners_Parent.sizeDelta = new Vector2(
            Winners_Parent.sizeDelta.x,
            (Winners_List.Count * Winner_Prefab.RT.rect.height) + (Winners_List.Count * 10) + 20
        );
        isFinishDataSet = true;
        gameStatus = GAME_STATUS.Finished;
        panelLiveRoomData.Close();
        panelResult.Open();
    }

    public void OpenResultPanel(StartMiniGameBroadcast startMiniGameBroadcast)
    {
        treasureChestPanel.Close();
        // wheelOfFortunePanel.Close();
        // fortuneWheelManager.Close();
        newFortuneWheelManager.Close();
        mysteryGamePanel.Close();
        colorDraftPanel.Close();
        PanelMiniGameWinners.Close();
        txtTotalNumbersWithdrawn.text = startMiniGameBroadcast.winningScreen.totalWithdrawCount.ToString();
        txtFullHouseWinners.text = startMiniGameBroadcast.winningScreen.fullHouseWinners.ToString();
        txtPatternsWon.text = startMiniGameBroadcast.winningScreen.patternsWon.ToString();

        int length = Winners_List.Count;
        for (int i = 0; i < length; i++)
            Destroy(Winners_List[i].gameObject);
        Winners_List.Clear();

        length = startMiniGameBroadcast.winningScreen.winners.Count;
        AdminTVScreenWinners winner;
        string specific;
        int count;
        for (int i = 0; i < length; i++)
        {
            winner = Instantiate(Winner_Prefab, Winners_Parent);
            winner.Set_Admin_TV_Screen_Winner(
                startMiniGameBroadcast.winningScreen.winners[i].lineType,
                $"{startMiniGameBroadcast.winningScreen.winners[i].count}",
                $"{startMiniGameBroadcast.winningScreen.winners[i].finalWonAmount}",
                startMiniGameBroadcast.winningScreen.winners[i].halls,
                startMiniGameBroadcast.winningScreen.winners[i].playerIdArray
            );
            winner.RT.anchoredPosition = new Vector2(
                0f,
                -(10 + (i * winner.RT.rect.height) + (i * 10))
            );
            Winners_List.Add(winner);
        }

        Winners_Parent.sizeDelta = new Vector2(
            Winners_Parent.sizeDelta.x,
            (Winners_List.Count * Winner_Prefab.RT.rect.height) + (Winners_List.Count * 10) + 20
        );

        gameStatus = GAME_STATUS.Finished;
        panelLiveRoomData.Close();
        panelResult.Open();

        // Wait 7 seconds then refresh the panel
        if (refreshPanelAfterDelayCoroutine != null)
        {
            StopCoroutine(refreshPanelAfterDelayCoroutine);
        }
        refreshPanelAfterDelayCoroutine = StartCoroutine(RefreshPanelAfterDelay());
    }

    private IEnumerator RefreshPanelAfterDelay()
    {
        yield return new WaitForSeconds(7f);
        gameObject.SetActive(false);
        gameObject.SetActive(true);
        yield return new WaitForSeconds(2f);
        StopCoroutine(refreshPanelAfterDelayCoroutine);
    }

    private void OnGameFinishSetAfterReconnect(AdminHallDisplayResult adminHallDisplayResult)
    {
        Debug.Log("OnGameFinishSetAfterReconnect: " + adminHallDisplayResult.ToString());
        txtTotalNumbersWithdrawn.text = adminHallDisplayResult.totalWithdrawCount.ToString();
        txtFullHouseWinners.text = adminHallDisplayResult.fullHouseWinners.ToString();
        txtPatternsWon.text = adminHallDisplayResult.patternsWon.ToString();

        int length = Winners_List.Count;
        for (int i = 0; i < length; i++)
            Destroy(Winners_List[i].gameObject);
        Winners_List.Clear();

        length = adminHallDisplayResult.winners.Count;
        AdminTVScreenWinners winner;
        string specific;
        int count;
        for (int i = 0; i < length; i++)
        {
            winner = Instantiate(Winner_Prefab, Winners_Parent);

            //specific = "";
            //count = adminHallDisplayResult.winners[i].playerTypeSpecificWinners.Count;
            //for (int j = 0; j < count; j++)
            //    specific += $"{adminHallDisplayResult.winners[i].playerTypeSpecificWinners[j].userType}({adminHallDisplayResult.winners[i].playerTypeSpecificWinners[j].count})" + ((j + 1) < count ? " | " : "");
            //if (specific != "" && adminHallDisplayResult.winners[i].hallSpecificWinners.Count > 0)
            //    specific += " | ";
            //count = adminHallDisplayResult.winners[i].hallSpecificWinners.Count;
            //for (int j = 0; j < count; j++)
            //    specific += $"{adminHallDisplayResult.winners[i].hallSpecificWinners[j].hallName}({adminHallDisplayResult.winners[i].hallSpecificWinners[j].count})" + ((j + 1) < count ? " | " : "");

            //winner.Set_Admin_TV_Screen_Winner(adminHallDisplayResult.winners[i].lineType, $"{adminHallDisplayResult.winners[i].count}", specific);

            winner.Set_Admin_TV_Screen_Winner(
                adminHallDisplayResult.winners[i].lineType,
                $"{adminHallDisplayResult.winners[i].count}",
                $"{adminHallDisplayResult.winners[i].finalWonAmount}",
                adminHallDisplayResult.winners[i].halls,
                adminHallDisplayResult.winners[i].playerIdArray
            );
            winner.RT.anchoredPosition = new Vector2(
                0f,
                -(10 + (i * winner.RT.rect.height) + (i * 10))
            );
            Winners_List.Add(winner);
        }

        Winners_Parent.sizeDelta = new Vector2(
            Winners_Parent.sizeDelta.x,
            (Winners_List.Count * Winner_Prefab.RT.rect.height) + (Winners_List.Count * 10) + 20
        );

        gameStatus = GAME_STATUS.Finished;
        panelLiveRoomData.Close();
        panelResult.Open();
        // Wait 7 seconds then refresh the panel
        if (refreshPanelAfterDelayCoroutine != null)
        {
            StopCoroutine(refreshPanelAfterDelayCoroutine);
        }
        refreshPanelAfterDelayCoroutine = StartCoroutine(RefreshPanelAfterDelay());
    }

    void Refresh_Room(Socket socket, Packet packet, params object[] args)
    {
        print($"Refresh room : {packet}");
        Refresh();
    }

    void OnCountDownToStartTheGame(Socket socket, Packet packet, params object[] args)
    {
        if (withdraw)
            return;
        print($"counter : {packet}");
        Game1_Timer data = JsonUtility.FromJson<Game1_Timer>(
            Utility.Instance.GetPacketString(packet)
        );
        // Counter_Txt.text = $"{Game_Name_Txt.text} game starts in\n{data.count.ToTime()}";
        Counter_Txt.GetComponent<I2.Loc.Localize>().SetTerm("Game Start In");
        Counter_Txt
            .GetComponent<LocalizationParamsManager>()
            .SetParameterValue("GameName", gameHistory.gameName);
        Counter_Txt
            .GetComponent<LocalizationParamsManager>()
            .SetParameterValue("Count", data.count.ToTime());
        Counter_Txt.GetComponent<I2.Loc.Localize>().AlwaysForceLocalize = true;
        Timer_PopUP.SetActive(data.count != 0);
        Ball_Drawn_Display.SetActive(data.count == 0);
        NextGame_Counter_Txt.gameObject.SetActive(false);
        isGameFinish = false;
        SoundManager.Instance.ResetPlayedAnnouncements();
    }

    private void OnActivateMiniGame(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnActivateMiniGame: " + packet.ToString());

        ActivateMiniGameResponse miniGameData = JsonUtility.FromJson<ActivateMiniGameResponse>(
            Utility.Instance.GetPacketString(packet)
        );
        MiniGamesParent.SetActive(true);
        this.gameId = miniGameData.gameId;
        switch (miniGameData.miniGameType)
        {
            case "wheelOfFortune":
                // wheelOfFortunePanel.Can_Spin = false;
                // fortuneWheelManager.Can_Spin = false;
                newFortuneWheelManager.Can_Spin = false;
                CallWheelOfFortuneEvent();
                break;
            case "treasureChest":

                if (miniGameData.isForAdmin)
                    treasureChestPanel.Can_Click_On_Box = true;
                else
                    treasureChestPanel.Can_Click_On_Box = false;
                CallTreasureChestEvent();

                break;
            case "Mystery":
                mysteryGamePanel.isForceReset = false;
                if (miniGameData.isForAdmin)
                    mysteryGamePanel.Can_Click_On_Box = true;
                else
                    mysteryGamePanel.Can_Click_On_Box = false;
                CallMysteryGameEvent();
                break;
            case "Color Draft":
                colorDraftPanel.isForceReset = false;
                if (miniGameData.isForAdmin)
                    colorDraftPanel.Can_Click_On_Door = true;
                else
                    colorDraftPanel.Can_Click_On_Door = false;
                CallColorDraftGameEvent();
                break;
        }
    }

    private void CallMysteryGameEvent()
    {
        // UIManager.Instance.DisplayLoader(true);
        EventManager.Instance.MysteryGameData(
            GameSocketManager.SocketGame1,
            gameId,
            MysteryGameDataResponse,
            "Admin"
        );
    }

    private void MysteryGameDataResponse(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("MysteryGameDataResponse :" + packet.ToString());
        UIManager.Instance.DisplayLoader(false);

        EventResponse<MysteryGameData> response = JsonUtility.FromJson<
            EventResponse<MysteryGameData>
        >(Utility.Instance.GetPacketString(packet));
        if (response.status == Constants.EventStatus.SUCCESS)
        {
#if UNITY_WEBGL
            mysteryGamePanel.isForceReset = false;
            mysteryGamePanel.Open(
                GameSocketManager.SocketGame1,
                gameId,
                response.result,
                null,
                response.result.isGamePaused,
                this.gameHistory.pauseGameMessage,
                "Game 1",
                "Game 1"
            );
#else
            mysteryGamePanel.isForceReset = false;
            mysteryGamePanel.Open(
                GameSocketManager.SocketGame1,
                gameId,
                response.result,
                UIManager.Instance.game1Panel.BackgroundSprite,
                response.result.isGamePaused,
                this.gameHistory.pauseGameMessage,
                LocalizationManager.GetTranslation("Game 1"),
                "Game 1"
            );
#endif
        }
    }

    private void CallColorDraftGameEvent()
    {
        // UIManager.Instance.DisplayLoader(true);
        EventManager.Instance.ColorDraftGameData(
            GameSocketManager.SocketGame1,
            gameId,
            ColorDraftGameDataResponse,
            "Admin"
        );
    }

    private void ColorDraftGameDataResponse(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("ColorDraftGameData Response :" + packet.ToString());
        UIManager.Instance.DisplayLoader(false);

        EventResponse<ColorDraftGameData> response = JsonUtility.FromJson<
            EventResponse<ColorDraftGameData>
        >(Utility.Instance.GetPacketString(packet));
        if (response.status == Constants.EventStatus.SUCCESS)
        {
#if UNITY_WEBGL
            colorDraftPanel.isForceReset = false;
            colorDraftPanel.Open(
                GameSocketManager.SocketGame1,
                gameId,
                response.result,
                null,
                response.result.isGamePaused,
                this.gameHistory.pauseGameMessage,
                "Game 1"
            );
#else
            colorDraftPanel.isForceReset = false;
            colorDraftPanel.Open(
                GameSocketManager.SocketGame1,
                gameId,
                response.result,
                UIManager.Instance.game1Panel.BackgroundSprite,
                response.result.isGamePaused,
                this.gameHistory.pauseGameMessage,
                LocalizationManager.GetTranslation("Game 1")
            );
#endif
        }
    }

    void OnBingoAnnouncement(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnBingoAnnouncement: " + packet.ToString());
        BingoAnnouncementResponse bingoAnnouncementResponse = JsonUtility.FromJson<BingoAnnouncementResponse>(Utility.Instance.GetPacketString(packet));
        // if (bingoAnnouncementResponse != null)
        // {
        SoundManager.Instance.BingoSound(false);
        AddNewBingoWinningData(data);
        bingoBallPanelManager.DisplayBigBallOnWin(true, false, false);
        // }
    }

    void On_Admin_toggleGameStatus(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("On_Admin_toggleGameStatus: " + packet.ToString());
        toggleGameStatus res = JsonUtility.FromJson<toggleGameStatus>(Utility.Instance.GetPacketString(packet));

        if (res.status.Equals("Pause"))
        {
            colorDraftPanel.isPaused = true;
            // fortuneWheelManager.isPaused = true;
            newFortuneWheelManager.isPaused = true;
            treasureChestPanel.isPaused = true;
            mysteryGamePanel.isPaused = true;
            isBingo = true;
            // BingoButtonColor(true);
            Debug.Log($"isButtonTap - {isButtonTap}");
            Debug.Log($"bySystem - {res.bySystem}");
            Debug.Log($"isPauseWithoutAnnouncement - {res.isPauseWithoutAnnouncement}");
            if (!res.bySystem && !res.isPauseWithoutAnnouncement)
            {
                SoundManager.Instance.BingoSound(true);
            }
            AddNewBingoWinningData(data);
            bingoBallPanelManager.DisplayBigBallOnWin(true, false, false);
            // if (!isButtonTap && !isFirstBall)
            // {
            //     SoundManager.Instance.BingoSound(true);
            // }
            //UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.GamePausedByAdminMessage);
            // UIManager.Instance.messagePopup.DisplayMessagePopupAutoHide(Constants.LanguageKey.GamePausedByAdminMessage, true, 5f);
        }
        else if (res.status.Equals("Resume"))
        {
            colorDraftPanel.isPaused = false;
            // fortuneWheelManager.isPaused = false;
            newFortuneWheelManager.isPaused = false;
            treasureChestPanel.isPaused = false;
            mysteryGamePanel.isPaused = false;
            isBingo = false;
            SoundManager.Instance.playedSoundTracker.Clear();
            claimWinnerPanel.Close();
            // BingoButtonColor(false);
            // UIManager.Instance.messagePopup.DisplayMessagePopupAutoHide(Constants.LanguageKey.GameResumedByAdminMessage, true, 5f);
        }
        else
        {
            colorDraftPanel.isPaused = false;
            // fortuneWheelManager.isPaused = false;
            newFortuneWheelManager.isPaused = false;
            treasureChestPanel.isPaused = false;
            mysteryGamePanel.isPaused = false;
            // UIManager.Instance.messagePopup.DisplayMessagePopupAutoHide(Constants.LanguageKey.GameResumedByAdminMessage, true, 5f);
        }
    }

    private void adminExtraGameNoti(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("adminExtraGameNoti: " + packet.ToString());
        adminExtraGameNotiResponce adminExtraGameNotiData =
            JsonUtility.FromJson<adminExtraGameNotiResponce>(
                Utility.Instance.GetPacketString(packet)
            );
        adminExtraWinner winner = adminExtraGameNotiData.winner;

        string ticketNumbersConcatenated = "";

        if (winner != null)
        {
            foreach (string ticketNumber in winner.ticketNumbers)
            {
                Debug.Log("Ticket Number: " + ticketNumber);
                ticketNumbersConcatenated += ticketNumber + ",";
            }

            if (!string.IsNullOrEmpty(ticketNumbersConcatenated))
            {
                ticketNumbersConcatenated = ticketNumbersConcatenated.TrimEnd(',');
            }

            Debug.Log("Final Ticket Numbers: " + ticketNumbersConcatenated);
        }
        else
        {
            ticketNumbersConcatenated = "Winner not found";
        }

        // UIManager.Instance.adminExtraGameNotifications.DisplayPopup(adminExtraGameNotiData.gameType, adminExtraGameNotiData.message, ticketNumbersConcatenated, true);
    }
    #endregion

    #region PRIVATE_METHODS
    public void nextButtonTap(bool isNextTap)
    {
        int CurrentID = PlayerPrefs.GetInt(LanguagePrefKey);
        Debug.Log("isNextTap => " + isNextTap);
        if (isNextTap)
        {
            if (CurrentID.Equals(0))
            {
                PlayerPrefs.SetInt(LanguagePrefKey, 1);
                SwitchLanguage();
            }
            else if (CurrentID.Equals(1))
            {
                PlayerPrefs.SetInt(LanguagePrefKey, 2);
                SwitchLanguage();
            }
            else if (CurrentID.Equals(2))
            {
                PlayerPrefs.SetInt(LanguagePrefKey, 0);
                SwitchLanguage();
            }
        }
        else
        {
            if (CurrentID.Equals(0))
            {
                PlayerPrefs.SetInt(LanguagePrefKey, 2);
                SwitchLanguage();
            }
            else if (CurrentID.Equals(1))
            {
                PlayerPrefs.SetInt(LanguagePrefKey, 0);
                SwitchLanguage();
            }
            else if (CurrentID.Equals(2))
            {
                PlayerPrefs.SetInt(LanguagePrefKey, 1);
                SwitchLanguage();
            }
        }
        Debug.Log("CurrentID => " + PlayerPrefs.GetInt(LanguagePrefKey));
    }

    public void SwitchLanguage()
    {
        Debug.Log("SwitchLanguage => " + PlayerPrefs.GetInt(LanguagePrefKey));
        if (PlayerPrefs.GetInt(LanguagePrefKey).Equals(0))
        {
            PlayNorwegianMaleAudio();
        }
        else if (PlayerPrefs.GetInt(LanguagePrefKey).Equals(1))
        {
            PlayNorwegianFemaleAudio();
        }
        else
        {
            PlayEnglishAudio();
        }
    }

    public void PlayEnglishAudio()
    {
        currentLanguage = "English";
        // txtCurrentLanguage.text = currentLanguage;
        txtCurrentLanguage.text = LocalizationManager.GetTranslation(currentLanguage);
    }

    public void PlayNorwegianFemaleAudio()
    {
        currentLanguage = "Norwegian Female";
        // txtCurrentLanguage.text = currentLanguage;
        txtCurrentLanguage.text = LocalizationManager.GetTranslation(currentLanguage);
    }

    public void PlayNorwegianMaleAudio()
    {
        currentLanguage = "Norwegian Male";
        // txtCurrentLanguage.text = currentLanguage;
        txtCurrentLanguage.text = LocalizationManager.GetTranslation(currentLanguage);
    }

    public void Reconnect()
    {
        AdminLoginEventCall();
        Refresh();
    }

    public void AdminHallDisplayRoomIdCall(string jsonData)
    {
        AdminHallExternalCallData adminData = JsonUtility.FromJson<AdminHallExternalCallData>(
            jsonData
        );

        print(
            $"Token : {adminData.token} | namespace : {adminData.identifier}   | isDisplay : {adminData.isDisplay}   | displayMessage : {adminData.displayMessage} | Hall Id : {adminData.hallId}"
        );
        print($"jsonData : {jsonData}");
        print($"jsonData 1 : {jsonData.ToString()}");
        print($"deviceType : {adminData.deviceType}");
        print($"Language : {adminData.language}");
        print($"Hall Id : {adminData.hallId}");
        DeviceType = adminData.deviceType;
        HallId = adminData.hallId;

        if (adminData.token == "" || adminData.identifier == "")
        {
            print($"isDisplay : {adminData.isDisplay}");

            if (!adminData.isDisplay)
                return;

            if (!PanelMiniGameWinners.isActiveAndEnabled)
            {
                if (string.IsNullOrEmpty(adminData.displayMessage))
                {
                    Debug.Log($"in if -- {string.IsNullOrEmpty(adminData.displayMessage)}");
                    if (string.IsNullOrEmpty(adminData.deviceType))
                    {
                        ExitBtn.SetActive(false);
                        UIManager.Instance.messagePopup.DisplayMessagePopupWithoutOkButton(
                            Constants.LanguageKey.NoOngoingGameMessage
                        );
                    }
                    else
                    {
                        ExitBtn.SetActive(true);
                        UIManager.Instance.messagePopup.DisplayMessagePopupWithExitButton(
                            Constants.LanguageKey.NoOngoingGameMessage,
                            (b) =>
                            {
                                if (b)
                                {
                                    switch (DeviceType)
                                    {
                                        case "android":
                                            Application.OpenURL("spillorama://open");
                                            break;
                                        case "iOS":
                                            Application.OpenURL("spillorama://open");
                                            break;
                                        case "other":
                                            Application.OpenURL("spillorama://open");
                                            break;
                                        case "web":
                                            Application.ExternalCall("openSpilloramaTab");
                                            break;
                                        default:
                                            Debug.Log("no device found");
                                            break;
                                    }
                                }
                            }
                        );
                    }
                }
                else
                {
                    Debug.Log($"in else -- {string.IsNullOrEmpty(adminData.displayMessage)}");
                    if (string.IsNullOrEmpty(adminData.deviceType))
                    {
                        ExitBtn.SetActive(false);
                        UIManager.Instance.messagePopup.DisplayMessagePopupWithoutOkButton(
                            adminData.displayMessage
                        );
                    }
                    else
                    {
                        ExitBtn.SetActive(true);
                        UIManager.Instance.messagePopup.DisplayMessagePopupWithExitButton(
                            Constants.LanguageKey.NoOngoingGameMessage,
                            (b) =>
                            {
                                if (b)
                                {
                                    switch (DeviceType)
                                    {
                                        case "android":
                                            Application.OpenURL("spillorama://open");
                                            break;
                                        case "iOS":
                                            Application.OpenURL("spillorama://open");
                                            break;
                                        case "other":
                                            Application.OpenURL("spillorama://open");
                                            break;
                                        case "web":
                                            Application.ExternalCall("openSpilloramaTab");
                                            break;
                                        default:
                                            Debug.Log("no device found");
                                            break;
                                    }
                                }
                            }
                        );
                    }
                }
            }
            return;
        }
        this.adminSocket = GameSocketManager.socketManager?.GetSocket("/" + adminData.identifier);
        this.roomId = adminData.token;
        EnableBroadcasts();
        AdminLoginEventCall();
        SetGameLanguage(adminData.language);
    }

    private void SetGameLanguage(string language)
    {
        LocalizationManager.CurrentLanguageCode = language switch
        {
            "en" => "en-US",
            "nor" => "nb",
            _ => "nb",
        };
        txtCurrentLanguage.text = LocalizationManager.GetTranslation(currentLanguage);
    }

    public void ReceiveDeviceType(string deviceType)
    {
        this.deviceType = deviceType;
        Debug.Log("Received Device Type: " + deviceType);
    }

    private void AdminLoginEventCall()
    {
        // UIManager.Instance.DisplayLoader(true);
        if (CallAdminLoginEventWithDelayCoroutine != null)
        {
            StopCoroutine(CallAdminLoginEventWithDelayCoroutine);
        }
        CallAdminLoginEventWithDelayCoroutine = StartCoroutine(CallAdminLoginEventWithDelay());
    }

    // Coroutine to handle the delay
    private IEnumerator CallAdminLoginEventWithDelay()
    {
        yield return new WaitForSeconds(1);
        EventManager.Instance.AdminHallDisplayLogin(adminSocket, roomId, HallId, AdminLoginResponse);
    }

    private void AdminLoginResponse(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("AdminLoginResponse : " + packet.ToString());
        if (CallAdminLoginEventWithDelayCoroutine != null)
        {
            StopCoroutine(CallAdminLoginEventWithDelayCoroutine);
        }
        // SetGameLanguage("en");
    }

    private void GenerateBingoWinningList(List<AdminDashboardWinningData> winningList)
    {
        foreach (AdminDashboardWinningData data in winningList)
        {
            AddNewBingoWinningData(data);
        }

        int patternsWon = this.gameHistory.patternsWon;
        int prefabCount = prefabWinnerDetailsList.Count;

        for (int i = 0; i < prefabCount; i++)
        {
            prefabWinnerDetailsList[i].btn.interactable = (i >= patternsWon);
        }

        for (int i = 0; i < winningList.Count; i++)
        {
            var data = winningList[i];

            if (i < prefabCount && data.winnerCount > 0)
            {
                prefabWinnerDetailsList[i].HighLight.Close();
                prefabWinnerDetailsList[i].btn.interactable = false;

                if (i + 1 < prefabCount)
                {
                    prefabWinnerDetailsList[i + 1].HighLight.Open();
                    prefabWinnerDetailsList[i + 1].btn.interactable = true;
                }
            }
        }

        if (patternsWon == 0 && prefabCount > 0)
        {
            prefabWinnerDetailsList[patternsWon].HighLight.Open();
            prefabWinnerDetailsList[patternsWon].btn.interactable = true;
        }
    }

    private void AddNewBingoWinningData(AdminDashboardWinningData winningData)
    {
        PrefabHallDispalyPatternDetails winningObject = null;

        List<List<string>> winningTickets = new List<List<string>>();
        if (winningData.winningTickets.Count > 0)
        {
            panelRowWinner.Open();
        }
        for (int i = 0; i < winningData.winningTickets.Count; i++)
        {
            winningTickets.Add(winningData.winningTickets[i].numbers);
            ticketWinnerDisplay.SetWinningTickets(
                winningTickets,
                winningData.winningTickets[i].patternName, winningData.winningTickets
            );
        }

        foreach (PrefabHallDispalyPatternDetails obj in prefabWinnerDetailsList)
        {
            if (obj.Id == winningData.id)
            {
                winningObject = obj;
                winningObject.HighLight.Close();
                winningObject.btn.interactable = false;
                int objIndex = prefabWinnerDetailsList.IndexOf(obj);

                if (objIndex >= prefabWinnerDetailsList.Count - 1)
                {
                    winningObject.SetData(winningData);
                    return;
                }
                prefabWinnerDetailsList[objIndex + 1].HighLight.Open();
                prefabWinnerDetailsList[objIndex + 1].btn.interactable = true;
                break;
            }
        }

        if (winningObject == null)
        {
            // Check if ID is null or empty
            if (string.IsNullOrEmpty(winningData.id))
            {
                Debug.LogWarning($"Winning data ID is null or empty, skipping instantiation");
                return;
            }
            // Check if the ID already exists in the list
            bool idExists = false;
            foreach (PrefabHallDispalyPatternDetails obj in prefabWinnerDetailsList)
            {
                if (obj.Id == winningData.id)
                {
                    Debug.Log($"ID {winningData.id} already exists in prefabWinnerDetailsList, skipping instantiation");
                    winningObject = obj;
                    idExists = true;
                    break;
                }
            }
            // Only instantiate if the ID doesn't exist
            if (!idExists)
            {
                Debug.Log($"New ID {winningData.id} found, creating new prefab");
                winningObject = Instantiate(prefabWinnerDetails, transformContainer);
                prefabWinnerDetailsList.Add(winningObject);
                winningObject.btn.interactable = true;
                winningObject.HighLight.Close();
            }
        }

        winningObject.SetData(winningData);
    }

    private void HardReset()
    {
        foreach (Transform transformObj in transformContainer)
            Destroy(transformObj.gameObject);
    }

    private void Reset()
    {
        foreach (PrefabHallDispalyPatternDetails detailObj in prefabWinnerDetailsList)
            Destroy(detailObj.gameObject);
        claimWinnerPanel.Close();
        panelResult.Close();
        PanelMiniGameWinners.Close();
        panelRowWinner.Close();
        // wheelOfFortunePanel.Close();
        // fortuneWheelManager.Close();
        newFortuneWheelManager.Close();
        treasureChestPanel.Close();
        mysteryGamePanel.Close();
        colorDraftPanel.Close();

        prefabWinnerDetailsList.Clear();
        gameStatus = GAME_STATUS.Waiting;
        bingoBallPanelManager.Reset();
        UIManager.Instance.messagePopup.OnCloseButtonTap();
        ticketWinnerDisplay.ResetAllRows();
        data = null;
    }

    public void Refresh()
    {
        isRefresh = true;
        PanelMiniGameWinners.Close();
        SoundManager.Instance.StopNumberAnnouncement();
        gameObject.SetActive(false);
        gameObject.SetActive(true);
    }
    #endregion

    #region Mini Games
    #region Fortune Wheel
    private void CallWheelOfFortuneEvent(AdminHallDisplayGameHistory gameHistory = null, bool isForceShow = false)
    {
#if UNITY_WEBGL

        //force is used when OnSubscribe data fetching else use in MiniGameActive
        if (isForceShow)
        {
            if (gameHistory.minigameData.isDisplayWheel)
            {
                // UIManager.Instance.DisplayLoader(true);
                EventManager.Instance.WheelOfFortuneData(
                    adminSocket,
                    roomId,
                    WheelOfFortuneDataResponse,
                    "Admin"
                );
            }
            else
            {
                //false: physical player won->show only winning popup
            }
        }
        else
        {
            // UIManager.Instance.DisplayLoader(true);
            EventManager.Instance.WheelOfFortuneData(
                adminSocket,
                roomId,
                WheelOfFortuneDataResponse,
                "Admin"
            );
        }
#else
        // UIManager.Instance.DisplayLoader(true);
        EventManager.Instance.WheelOfFortuneData(adminSocket, roomId, WheelOfFortuneDataResponse);
#endif
    }

    private void WheelOfFortuneDataResponse(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("WheelOfFortuneDataResponse :" + packet.ToString());
        UIManager.Instance.DisplayLoader(false);
        EventResponse<WheelOfFortuneData> response = JsonUtility.FromJson<
            EventResponse<WheelOfFortuneData>
        >(Utility.Instance.GetPacketString(packet));
        if (response.status == Constants.EventStatus.SUCCESS)
        {
            // wheelOfFortunePanel.isPaused = this.gameHistory.isGamePaused;
            // wheelOfFortunePanel.Open(adminSocket, roomId, response.result, gameHistory.minigameData.turnTimer, BackgroundSprite, "Game 1");
            // fortuneWheelManager.isPaused = this.gameHistory.isGamePaused;
            newFortuneWheelManager.isPaused = response.result.isGamePaused;
            // fortuneWheelManager.Open(
            //     adminSocket,
            //     roomId,
            //     response.result,
            //     gameHistory.minigameData.turnTimer,
            //     BackgroundSprite,
            //     "Game 1"
            // );
            newFortuneWheelManager.Open(
                adminSocket,
                roomId,
                response.result,
                gameHistory.minigameData.turnTimer,
                BackgroundSprite,
                "Game 1"
            );
        }
    }

    #endregion

    #region Tresure Chest
    private void CallTreasureChestEvent()
    {
        // UIManager.Instance.DisplayLoader(true);
        EventManager.Instance.TreasureChestData(
            adminSocket,
            roomId,
            TreasureChestDataResponse,
            "Admin"
        );
    }

    private void TreasureChestDataResponse(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("TreasureChestDataResponse :" + packet.ToString());
        UIManager.Instance.DisplayLoader(false);

        EventResponse<TreasureChestData> response = JsonUtility.FromJson<
            EventResponse<TreasureChestData>
        >(Utility.Instance.GetPacketString(packet));
        if (response.status == Constants.EventStatus.SUCCESS)
        {
            treasureChestPanel.isPaused = response.result.isGamePaused;
            treasureChestPanel.Open(
                adminSocket,
                roomId,
                response.result,
                this.gameHistory.minigameData.turnTimer,
                BackgroundSprite,
                "Game 1"
            );
        }
    }
    #endregion
    #endregion
}

public enum soundlanguage
{
    English,
    NorwegianFemale,
    NorwegianMale,
}
