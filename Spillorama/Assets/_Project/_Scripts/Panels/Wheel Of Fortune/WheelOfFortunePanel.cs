using System;
using System.Collections;
using System.Collections.Generic;
using BestHTTP.SocketIO;
using I2.Loc;
using TMPro;
#if !UNITY_WEBGL
using I2.Loc;
#endif
using UnityEngine;
using UnityEngine.UI;

public class WheelOfFortunePanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    #endregion

    #region PRIVATE_VARIABLES

    [Header("Panels")]
    [SerializeField] private SpinWheelScript spinWheelScript;

    [Header("Button")]
    [SerializeField] private Button btnSpin;
    [SerializeField] private Button btnBackToLobby;
    public Button btnBack;

    [Header("Images")]
    [SerializeField] private Image imgWheelArrow;
    [SerializeField] private Image imgWheelBorder;
    [SerializeField] private Image imgWheelBody;
    [SerializeField] private Image imgBackground;

    [Header("Sprites")]
    [SerializeField] private Sprite spriteWheelArrow;
    [SerializeField] private Sprite spriteWheelBorder;
    [SerializeField] private Sprite spriteWheelBody;
    [SerializeField] private Sprite spriteBackground;

    [Header("Colors")]
    [SerializeField] private Color32 colorWheelPricesText;

    [Header("Text")]
    [SerializeField] private TextMeshProUGUI txtTimer;
    [SerializeField] private TextMeshProUGUI txtGameName;

    [Header("Game Objects")]
    public PanelMiniGameWinners PanelMiniGameWinners;

    private Socket socket;
    private WheelOfFortuneData wheelOfFortuneData;
    [SerializeField] private StartMiniGameBroadcast startMiniGameBroadcast;
    private string gameId = "";
    private long prize;
    private bool gameFinishEventCallPending = false;

    private bool gamePlayed = false;
    int autoTurnTime = 10;
    private bool autoTurnTimeCompleted = false;
    private bool spinActionInProcess = false;

    public bool Can_Spin;
    public bool Is_Game_4 = false;
    public bool isPaused = false;

    #endregion

    #region UNITY_CALLBACKS
    private void OnEnable()
    {
        btnSpin.Open();
        StopAllCoroutines();
        gameFinishEventCallPending = false;

#if !UNITY_WEBGL
        if (btnBackToLobby)
            btnBackToLobby.gameObject.SetActive(!Utility.Instance.IsSplitScreenSupported);
#endif
        GameSocketManager.OnSocketReconnected += Reconnect;
    }

    private void OnDisable()
    {
        GameSocketManager.OnSocketReconnected -= Reconnect;
        socket.Off(Constants.BroadcastName.StartSpinWheel);
        socket.Off(Constants.BroadcastName.toggleGameStatus);
        socket.Off(Constants.BroadcastName.StopSpinWheel);
    }

    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void Open(Socket socket, string gameId, WheelOfFortuneData wheelOfFortuneData, int turnTimer = 10, Sprite backgroundSprite = null, string gameName = "")
    {
        this.socket = socket;
        this.gameId = gameId;
        this.wheelOfFortuneData = wheelOfFortuneData;

        if (backgroundSprite)
            imgBackground.sprite = backgroundSprite;

        this.Open();

        // Register the event listeners
        socket.On(Constants.BroadcastName.StartSpinWheel, Start_Spin_Wheel);
        socket.On(Constants.BroadcastName.toggleGameStatus, On_WOF_Game_toggleGameStatus);

        // Register the event listener for the stop spin wheel broadcast
        if (gameName == LocalizationManager.GetTranslation("Game 1"))
        {
            socket.On(Constants.BroadcastName.StopSpinWheel, Stop_Spin_Wheel);
        }

        UIManager.Instance.messagePopup.Close();
        //btnSpin.gameObject.SetActive(Can_Spin);
        btnSpin.interactable = Can_Spin;
        txtGameName.gameObject.SetActive(Utility.Instance.IsSplitScreenSupported);
        txtGameName.text = gameName;

        spinWheelScript.SetData(wheelOfFortuneData.prizeList);

        spinActionInProcess = false;
        autoTurnTimeCompleted = false;

        // Reset the timer text
        txtTimer.text = "";
        gamePlayed = false;
        Is_Game_4 = btnBack.interactable = btnBackToLobby.interactable = false;
#if UNITY_WEBGL
        if (!UIManager.Instance.isGameWebGL)
        {
            btnSpin.Close();
            btnBack.gameObject.SetActive(false);
            btnBackToLobby.gameObject.SetActive(false);
        }
#endif
        autoTurnTime = turnTimer;
        StartAutoTurn();
    }

    public void ReconnectOpen(Socket socket, string gameId, List<long> prizeList, int turnTimer, float amount, bool isPaused = false, string pauseGameMessage = "", Sprite backgroundSprite = null, string gameName = "", bool isWofSpinStopped = false)
    {
        Debug.Log("Start ReconnectOpen");

        this.socket = socket;
        this.gameId = gameId;
        //this.wheelOfFortuneData = wheelOfFortuneData;

        if (backgroundSprite)
            imgBackground.sprite = backgroundSprite;

        this.Open();
        spinWheelScript.SetData(prizeList);

        if (turnTimer > 0)
        {
            socket.On(Constants.BroadcastName.StartSpinWheel, Start_Spin_Wheel);
            socket.On(Constants.BroadcastName.toggleGameStatus, On_WOF_Game_toggleGameStatus);
            if (gameName == LocalizationManager.GetTranslation("Game 1"))
            {
                socket.On(Constants.BroadcastName.StopSpinWheel, Stop_Spin_Wheel);
            }
            autoTurnTime = turnTimer;
            StartAutoTurn();
        }
        else
        {
            spinActionInProcess = false;
            gamePlayed = true;
            StopTimer();
            btnSpin.Close();
            prize = (long)amount;
            if (isWofSpinStopped)
            {
                spinWheelScript.SetWheelToPrize(prize);
            }
            else
            {
                spinWheelScript.ForceSpinTheWheel((long)amount);
            }
            // spinWheelScript.SpinTheWheel((long)amount);
        }


        UIManager.Instance.messagePopup.Close();
        btnSpin.interactable = Can_Spin;
        txtGameName.gameObject.SetActive(Utility.Instance.IsSplitScreenSupported);
        txtGameName.text = gameName;

        spinActionInProcess = false;
        autoTurnTimeCompleted = false;
        txtTimer.text = "";
        gamePlayed = false;
        Is_Game_4 = btnBack.interactable = btnBackToLobby.interactable = false;

#if UNITY_WEBGL
        if (!UIManager.Instance.isGameWebGL)
        {
            btnBack.gameObject.SetActive(false);
            btnBackToLobby.gameObject.SetActive(false);
        }
#endif

        if (isPaused)
        {
            // UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.GamePausedByAdminMessage);
            this.isPaused = true;
            txtTimer.text = "00:" + autoTurnTime.ToString("00");
            Debug.Log("Paused State in ReconnectOpen: " + gameObject.name);
        }
        else
        {
            this.isPaused = false;
            txtTimer.text = "00:" + autoTurnTime.ToString("00");
            Debug.Log("Resume State in ReconnectOpen : " + gameObject.name);
        }

        Debug.Log("End OF ReconnectOpen");
    }

    public void OnSpinButtonTap()
    {
        if (isPaused)
            return;

        spinActionInProcess = true;

        if (gamePlayed)
            return;

        //StopTimer();
        //btnSpin.Close();

        // UIManager.Instance.DisplayLoader(true);
        EventManager.Instance.PlayWheelOfFortune(socket, gameId, PlayWheelOfFortuneResponse);
    }

    private void PlayWheelOfFortuneResponse(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("PlayWheelOfFortuneResponse: " + packet.ToString());
        UIManager.Instance.DisplayLoader(false);

        EventResponseLong response = JsonUtility.FromJson<EventResponseLong>(Utility.Instance.GetPacketString(packet));
        if (response.status == Constants.EventStatus.SUCCESS)
        {
            print("PlayWheelOfFortuneResponse : Success");
            if (Is_Game_4)
            {
                spinActionInProcess = false;
                gamePlayed = true;
                StopTimer();
                btnSpin.Close();
                prize = response.result;
                spinWheelScript.SpinTheWheel(response.result);
            }
        }
        else
            UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
    }

    public void WinningAnimation()
    {
        if (!Can_Spin)
        {
            StartCoroutine(Auto_Back_To_Lobby());
            return;
        }
        Debug.LogError("--------------");
        gameFinishEventCallPending = true;
        // UIManager.Instance.DisplayLoader(true);
        EventManager.Instance.WheelOfFortuneFinished(socket, gameId, prize, WheelOfFortuneFinishedHanlding);
    }

    private void WheelOfFortuneFinishedHanlding(Socket socket, Packet packet, object[] args)
    {
        UIManager.Instance.DisplayLoader(false);
        Debug.Log("WheelOfFortuneFinishedHanlding: " + packet.ToString());
        btnBack.interactable = btnBackToLobby.interactable = true;
        EventResponse<WheelOfFortuneFinishedResponse> response = JsonUtility.FromJson<EventResponse<WheelOfFortuneFinishedResponse>>(Utility.Instance.GetPacketString(packet));

        if (response.status == Constants.EventStatus.SUCCESS)
        {
            gameFinishEventCallPending = false;
            if (response.result.isWinningInPoints)
            {
#if UNITY_WEBGL
                if (UIManager.Instance.isGameWebGL)
                {
                    //UIManager.Instance.LaunchWinningAnimation(LocalizationManager.GetTranslation("Congratulations You have won x points").Replace("{0}", prize.ToString()), 5);
                    ////UIManager.Instance.LaunchWinningAnimation(response.message, 5);
                }
                else
                {
                    UIManager.Instance.LaunchWinningAnimation($"Congratulations You have won {prize} points", 5);
                }
#else
                //UIManager.Instance.LaunchWinningAnimation(LocalizationManager.GetTranslation("Congratulations You have won x points").Replace("{0}", prize.ToString()), 5);
                ////UIManager.Instance.LaunchWinningAnimation(response.message, 5);
#endif
            }
            else
            {
#if UNITY_WEBGL
                if (UIManager.Instance.isGameWebGL)
                {
                    //UIManager.Instance.LaunchWinningAnimation(LocalizationManager.GetTranslation("Congratulations You have won x Kr").Replace("{0}", prize.ToString()), 5);
                    ////UIManager.Instance.LaunchWinningAnimation(response.message, 5);
                }
                else
                {
                    UIManager.Instance.LaunchWinningAnimation($"Congratulations You have won {prize} Kr", 5);
                }
#else
                //UIManager.Instance.LaunchWinningAnimation(LocalizationManager.GetTranslation("Congratulations You have won x Kr").Replace("{0}", prize.ToString()), 5);
                ////UIManager.Instance.LaunchWinningAnimation(response.message, 5);
#endif
            }
            UIManager.Instance.gameAssetData.Points = response.result.points.ToString("###,###,##0.00");
            UIManager.Instance.gameAssetData.RealMoney = response.result.realMoney.ToString("###,###,##0.00");
            UIManager.Instance.gameAssetData.TodaysBalance = response.result.realMoney.ToString("###,###,##0.00");

            StartCoroutine(Auto_Back_To_Lobby());
        }
        else
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
        }
    }

    public void OnBackButtonTap()
    {
        this.Close();
#if UNITY_WEBGL
        if (UIManager.Instance.isGameWebGL)
        {
            if (Is_Game_4)
                UIManager.Instance.lobbyPanel.lobbyGameSelection.OnGame4ButtonTap();
            else
                UIManager.Instance.lobbyPanel.lobbyGameSelection.OnGame1ButtonTap();
        }
        else
        {
            PanelMiniGameWinners.Close();
            UIManager.Instance.bingoHallDisplayPanel.gameObject.SetActive(false);
            UIManager.Instance.bingoHallDisplayPanel.gameObject.SetActive(true);
        }
#else
        if (Is_Game_4)
            UIManager.Instance.lobbyPanel.lobbyGameSelection.OnGame4ButtonTap();
        else
            UIManager.Instance.lobbyPanel.lobbyGameSelection.OnGame1ButtonTap();
#endif
    }

    public void OnBackToLobbyButtonTap()
    {
#if UNITY_WEBGL
        if (UIManager.Instance.isGameWebGL)
        {
            UIManager.Instance.topBarPanel.OnGamesButtonTap();
        }
        else
        {
            this.Close();
            UIManager.Instance.bingoHallDisplayPanel.gameObject.SetActive(false);
            UIManager.Instance.bingoHallDisplayPanel.gameObject.SetActive(true);
        }
#else
            UIManager.Instance.topBarPanel.OnGamesButtonTap();
#endif
    }
    #endregion

    #region PRIVATE_METHODS
    private void StartAutoTurn()
    {
        StopAllCoroutines();
        StartCoroutine(AutoTurn());
    }

    private void StopTimer()
    {
        StopAllCoroutines();
        txtTimer.text = "";
    }

    private void Reconnect()
    {
        Debug.LogError("Reconnect");

        if (spinActionInProcess)
            OnSpinButtonTap();
        else if (autoTurnTimeCompleted)
            OnSpinButtonTap();
        else if (gameFinishEventCallPending)
            WinningAnimation();
    }

    private void Start_Spin_Wheel(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("Start_Spin_Wheel: " + packet.ToString());
        UIManager.Instance.DisplayLoader(false);

        StartMiniGameBroadcast response = JsonUtility.FromJson<StartMiniGameBroadcast>(Utility.Instance.GetPacketString(packet));
        startMiniGameBroadcast = response;
        if (response.miniGameType != "wheelOfFortune")
            return;

        spinActionInProcess = false;
        gamePlayed = true;
        StopTimer();
        btnSpin.Close();
        prize = response.amount;
        spinWheelScript.SpinTheWheel(response.amount);
    }

    private void Stop_Spin_Wheel(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("Stop_Spin_Wheel: " + packet.ToString());
        UIManager.Instance.DisplayLoader(false);

        StartMiniGameBroadcast response = JsonUtility.FromJson<StartMiniGameBroadcast>(Utility.Instance.GetPacketString(packet));
        startMiniGameBroadcast = response;
        if (response.miniGameType != "wheelOfFortune")
            return;

        spinActionInProcess = false;
        gamePlayed = false;
        StopTimer();
        btnSpin.Close();
        prize = response.amount;
        spinWheelScript.StopSpinWheelBroadcast(response.amount);
        // if (!spinWheelScript.wheelStopped)
        // {
        WinningAnimation();
        // }
    }

    void On_WOF_Game_toggleGameStatus(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("On_WOF_Game_toggleGameStatus: " + packet.ToString());
        toggleGameStatus res = JsonUtility.FromJson<toggleGameStatus>(Utility.Instance.GetPacketString(packet));
        if (res.status.Equals("Pause"))
        {
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


    IEnumerator Auto_Back_To_Lobby()
    {

#if UNITY_WEBGL
        if (!UIManager.Instance.isGameWebGL)
        {
            PanelMiniGameWinners.OpenData(startMiniGameBroadcast.winningTicketNumbers);
        }
#endif

        float time = 7f;

        while (time > 0f)
        {
            time -= Time.deltaTime;
            yield return new WaitForEndOfFrame();
        }
        if (gameObject.activeSelf)
            OnBackButtonTap();
    }


    #endregion

    #region COROUTINES

    IEnumerator AutoTurn()
    {
        for (int i = autoTurnTime; i >= 0; i--)
        {
            txtTimer.text = "00:" + i.ToString("00");

            // Check if the game is paused and wait until it resumes
            while (isPaused)
            {
                yield return null; // Pause the coroutine
            }

            yield return new WaitForSeconds(1);
        }

        autoTurnTimeCompleted = true;
        txtTimer.text = "";

        if (Can_Spin)
        {
            btnSpin.Close();

            if (EventManager.Instance.HasInternetConnection && Is_Game_4)
            {
                OnSpinButtonTap();
            }
        }
    }

    //IEnumerator AutoTurn()
    //{
    //    for (int i = autoTurnTime; i >= 0; i--)
    //    {
    //        txtTimer.text = "00:" + i.ToString("00");
    //        yield return new WaitForSeconds(1);
    //    }

    //    autoTurnTimeCompleted = true;
    //    txtTimer.text = "";
    //    if (Can_Spin)
    //    {
    //        btnSpin.Close();

    //        if (EventManager.Instance.HasInternetConnection && Is_Game_4)
    //            OnSpinButtonTap();
    //    }
    //}
    #endregion

    #region GETTER_SETTER
    #endregion
}
