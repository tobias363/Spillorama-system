using System;
using System.Collections;
using System.Collections.Generic;
using BestHTTP.SocketIO;
using I2.Loc;
using TMPro;
using UnityEngine;
using UnityEngine.UI;
using System.Linq;

public class FortuneWheelManager : MonoBehaviour
{
    public static FortuneWheelManager Instance;
    [SerializeField]
    private List<long> prizeList;
    public bool _isStarted;
    private bool gameFinishEventCallPending = false;
    public List<float> _sectorsAngles;
    public List<long> currentData;
    private float _finalAngle;
    private float _startAngle = 0;
    public float _currentLerpRotationTime;
    private float _spinStartTime; // Absolute time when spin started
    private bool _wasSpinningBeforeDisable = false; // Track if wheel was spinning when panel was disabled
    public Button TurnButton;
    public bool Can_Spin;

    [SerializeField]
    private Button btnBackToLobby;

    [SerializeField]
    private TextMeshProUGUI txtGameName;
    public Button btnBack;
    public GameObject Circle; // Rotatable Object with rewards

    [SerializeField]
    private TextMeshProUGUI txtTimer;
    private long prize;
    public WheelCategories allData;
    public PanelMiniGameWinners PanelMiniGameWinners;

    [SerializeField]
    private StartMiniGameBroadcast startMiniGameBroadcast;

    [SerializeField]
    private Image imgBackground;

    int autoTurnTime = 10;
    private bool autoTurnTimeCompleted = false;

    private Socket socket;
    private string gameId = "";
    public bool isPaused = false;
    private bool gamePlayed = false;
    public bool Is_Game_4 = false;
    private bool isReconnectOpen = false;
    private WheelOfFortuneData wheelOfFortuneData;
    [SerializeField]
    private CircleCollider2D[] circleColliders;
    [SerializeField]
    private BoxCollider2D[] boxColliders;
    [SerializeField] private RectTransform arrowRect;
    [SerializeField] private GameObject arrow;
    [SerializeField] private Arrow Arrow;

    private bool isStartSpinBroadcastReceived = false;
    private bool isStopSpinBroadcastReceived = false;

    Coroutine autoTurnCoroutine;
    Coroutine autoBackToLobbyCoroutine;

    void Awake()
    {
        if (Instance == null)
        {
            Instance = this;
        }
    }

    void OnEnable()
    {
        TurnButton.Open();
        // StopAllCoroutines();
        if (autoTurnCoroutine != null)
        {
            StopCoroutine(autoTurnCoroutine);
        }
        GameSocketManager.OnSocketReconnected += Reconnect;
        gameFinishEventCallPending = false;

        // If wheel was spinning when we left, check if we need to resume or complete
        // if (_wasSpinningBeforeDisable && _spinStartTime > 0)
        // {
        //     float elapsedTime = Time.time - _spinStartTime;
        //     float maxTime = 12f; // Same as maxLerpRotationTime in Update

        //     Debug.Log($"[WheelOfFortune] OnEnable - Elapsed time: {elapsedTime}s, Max time: {maxTime}s");

        //     if (elapsedTime >= maxTime)
        //     {
        //         // Spin should be complete - set to final position
        //         Debug.Log($"[WheelOfFortune] OnEnable - Spin completed while away. Prize: {prize}, FinalAngle: {_finalAngle}");
        //         _currentLerpRotationTime = maxTime;
        //         _isStarted = false;
        //         _startAngle = _finalAngle % 360;
        //         Circle.transform.eulerAngles = new Vector3(0, 0, _finalAngle);
        //         _wasSpinningBeforeDisable = false;

        //         Debug.Log($"[WheelOfFortune] OnEnable - Wheel set to angle: {Circle.transform.eulerAngles.z}");

        //         // Trigger winning animation
        //         if (gameObject.activeInHierarchy)
        //         {
        //             WinningAnimation();
        //         }
        //     }
        //     else
        //     {
        //         // Spin still in progress - resume from current position
        //         Debug.Log("[WheelOfFortune] OnEnable - Resuming wheel spin in progress");
        //         _currentLerpRotationTime = elapsedTime;
        //         _isStarted = true;
        //         _wasSpinningBeforeDisable = false;

        //         // Calculate and set current wheel position based on elapsed time
        //         float t = _currentLerpRotationTime / maxTime;
        //         float speedPeakTime = 0.25f;
        //         float decelerationCurve = 5f;

        //         // Apply easing
        //         if (t <= speedPeakTime)
        //         {
        //             t = EaseIn(t / speedPeakTime) * speedPeakTime;
        //         }
        //         else
        //         {
        //             float decelT = (t - speedPeakTime) / (1 - speedPeakTime);
        //             t = speedPeakTime + EaseOut(decelT, decelerationCurve) * (1 - speedPeakTime);
        //         }

        //         float angle = Mathf.Lerp(_startAngle, _finalAngle, t);
        //         Circle.transform.eulerAngles = new Vector3(0, 0, angle);
        //     }
        // }
    }

    void OnDisable()
    {
        Circle.transform.eulerAngles = Vector3.zero;
        // if (!_isStarted)
        // {
        //     Circle.transform.eulerAngles = Vector3.zero;
        // }
        // else
        // {
        //     Debug.Log("[WheelOfFortune] OnDisable - Preserving wheel rotation for resume");
        // }
        GameSocketManager.OnSocketReconnected -= Reconnect;
        if (autoTurnCoroutine != null)
        {
            StopCoroutine(autoTurnCoroutine);
        }
        if (autoBackToLobbyCoroutine != null)
        {
            StopCoroutine(autoBackToLobbyCoroutine);
        }
    }

    private void Reconnect()
    {
        Debug.LogError("Reconnect");

        if (_isStarted)
            OnSpinButtonTap();
        else if (autoTurnTimeCompleted)
            OnSpinButtonTap();
        else if (gameFinishEventCallPending)
            WinningAnimation();
    }

    public void Open(Socket socket, string gameId, WheelOfFortuneData wheelOfFortuneData, int turnTimer = 10, Sprite backgroundSprite = null, string gameName = "")
    {
        this.socket = socket;
        this.gameId = gameId;
        this.wheelOfFortuneData = wheelOfFortuneData;

        if (backgroundSprite)
            imgBackground.sprite = backgroundSprite;

        this.Open();

        socket.On(Constants.BroadcastName.StartSpinWheel, Start_Spin_Wheel);
        socket.On(Constants.BroadcastName.toggleGameStatus, On_WOF_Game_toggleGameStatus);

        if (gameName == LocalizationManager.GetTranslation("Game 1"))
        {
            socket.On(Constants.BroadcastName.StopSpinWheel, Stop_Spin_Wheel);
        }
        UIManager.Instance.messagePopup.Close();

        // TurnButton.interactable = Can_Spin;
        TurnButton.gameObject.SetActive(Can_Spin);
        txtGameName.gameObject.SetActive(Utility.Instance.IsSplitScreenSupported);
        txtGameName.text = gameName;

        for (int i = 0; i < wheelOfFortuneData.prizeList.Count; i++)
        {
            currentData.Add(wheelOfFortuneData.prizeList[i]);
            allData.categoryPies[i].GetComponent<CategoryPie>().winPoint.text = wheelOfFortuneData
                .prizeList[i]
                .ToString();
            _sectorsAngles.Add(allData.categoryPies[i].transform.eulerAngles.z);
        }

        _isStarted = false;
        autoTurnTimeCompleted = false;
        txtTimer.text = "";
        gamePlayed = false;

        Is_Game_4 = btnBack.interactable = btnBackToLobby.interactable = false;
#if UNITY_WEBGL
        if (!UIManager.Instance.isGameWebGL)
        {
            TurnButton.Close();
            btnBack.gameObject.SetActive(false);
            btnBackToLobby.gameObject.SetActive(false);
        }
#endif
        autoTurnTime = turnTimer;
        StartAutoTurn();
    }

    public void ReconnectOpen(
        Socket socket,
        BingoGame1History game1History,
        string gameId,
        List<long> prizeList,
        int turnTimer,
        float amount,
        bool isPaused = false,
        string pauseGameMessage = "",
        Sprite backgroundSprite = null,
        string gameName = "",
        bool isWofSpinStopped = false
    )
    {
        Debug.Log("Start ReconnectOpen");

        this.socket = socket;
        this.gameId = gameId;
        isReconnectOpen = true;
        // this.wheelOfFortuneData = wheelOfFortuneData;

        if (backgroundSprite)
            imgBackground.sprite = backgroundSprite;

        this.Open();
        Debug.LogError(11);
        for (int i = 0; i < prizeList.Count; i++)
        {
            currentData.Add(prizeList[i]);
            allData.categoryPies[i].GetComponent<CategoryPie>().winPoint.text = prizeList[i].ToString();
            _sectorsAngles.Add(allData.categoryPies[i].transform.eulerAngles.z);
        }

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
            _isStarted = false;
            gamePlayed = true;
            StopTimer();
            TurnButton.Close();
            prize = (long)amount;
            if (isWofSpinStopped)
            {
                UIManager.Instance.lobbyPanel.gamePlanPanel.OnGame1ButtonTap();
            }
            else if (
                !game1History.minigameData.isMinigameFinished
                && game1History.minigameData.isWofSpinStopped
            )
            {
                // Calculate the exact rotation for the desired prize
                float desiredRotationZ = GetDesiredRotationZ(prize);

                Debug.Log($"Setting wheel directly to desired prize. Rotation: {desiredRotationZ}");

                // Directly set the wheel's rotation
                Circle.transform.eulerAngles = new Vector3(0, 0, desiredRotationZ);

                // Reset rotationSpeed and related flags
                _isStarted = false;
                WinningAnimation();
            }
            else if (!game1History.minigameData.isMinigameFinished && !game1History.minigameData.isWofSpinStopped && game1History.minigameData.isMinigamePlayed)
            {
                Circle.transform.eulerAngles = Vector3.zero;
                gamePlayed = true;
                StopTimer();
                TurnButton.Close();
                prize = game1History.minigameData.wonAmount;
                TurnWheel();
                //  if (_isStarted && _spinStartTime > 0)
                // {
                //     Debug.Log("[WheelOfFortune] ReconnectOpen - Wheel already spinning, preserving state");
                //     // Don't reset - wheel is already spinning and will continue
                //     // Update prize if it changed (but keep same final angle since wheel is mid-spin)
                //     prize = game1History.minigameData.wonAmount;
                //     gamePlayed = true;
                //     TurnButton.Close();
                // }
                // else if (_wasSpinningBeforeDisable && _spinStartTime > 0)
                // {
                //     Debug.Log("[WheelOfFortune] ReconnectOpen - Wheel was spinning, will be restored in OnEnable");
                //     // The wheel was spinning before and OnEnable will restore it
                //     // Just set the prize value
                //     prize = game1History.minigameData.wonAmount;
                //     gamePlayed = true;
                //     TurnButton.Close();
                // }
                // else
                // {
                //     Debug.Log("[WheelOfFortune] ReconnectOpen - Starting fresh wheel spin");
                //     Circle.transform.eulerAngles = Vector3.zero;
                //     gamePlayed = true;
                //     StopTimer();
                //     TurnButton.Close();
                //     prize = game1History.minigameData.wonAmount;
                //     TurnWheel();
                // }
            }
        }

        UIManager.Instance.messagePopup.Close();
        // TurnButton.interactable = Can_Spin;
        // TurnButton.gameObject.SetActive(Can_Spin);
        txtGameName.gameObject.SetActive(Utility.Instance.IsSplitScreenSupported);
        txtGameName.text = gameName;

        // _isStarted = false;
        autoTurnTimeCompleted = false;
        txtTimer.text = "";
        // gamePlayed = false;
        Is_Game_4 = btnBack.interactable = btnBackToLobby.interactable = false;

#if UNITY_WEBGL
        if (!UIManager.Instance.isGameWebGL)
        {
            btnBack.gameObject.SetActive(false);
            btnBackToLobby.gameObject.SetActive(false);
        }
#endif
        // if (isPaused)
        // {
        //     // SoundManager.Instance.BingoSound();
        //     // UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.GamePausedByAdminMessage);
        //     this.isPaused = true;
        //     txtTimer.text = "00:" + autoTurnTime.ToString("00");
        //     Debug.Log("Paused State in ReconnectOpen: " + gameObject.name);
        // }
        // else
        // {
        //     this.isPaused = false;
        //     txtTimer.text = "00:" + autoTurnTime.ToString("00");
        //     Debug.Log("Resume State in ReconnectOpen : " + gameObject.name);
        // }

        Debug.Log("End OF ReconnectOpen");
    }

    private void StartAutoTurn()
    {
        // StopAllCoroutines();
        if (autoTurnCoroutine != null)
        {
            StopCoroutine(autoTurnCoroutine);
        }
        autoTurnCoroutine = StartCoroutine(AutoTurn());
    }

    private void Start_Spin_Wheel(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("Start_Spin_Wheel: " + packet.ToString());
        UIManager.Instance.DisplayLoader(false);
        isStartSpinBroadcastReceived = true;
        StartMiniGameBroadcast response = JsonUtility.FromJson<StartMiniGameBroadcast>(Utility.Instance.GetPacketString(packet));
        startMiniGameBroadcast = response;
        if (response.miniGameType != "wheelOfFortune")
            return;

        _isStarted = true;
        gamePlayed = true;
        StopTimer();
        TurnButton.Close();
        prize = response.amount;
        TurnWheel();
    }

    void On_WOF_Game_toggleGameStatus(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("On_WOF_Game_toggleGameStatus: " + packet.ToString());
        toggleGameStatus res = JsonUtility.FromJson<toggleGameStatus>(
            Utility.Instance.GetPacketString(packet)
        );
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

    private void Stop_Spin_Wheel(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("Stop_Spin_Wheel: " + packet.ToString());
        UIManager.Instance.DisplayLoader(false);
        isStopSpinBroadcastReceived = true;
        StartMiniGameBroadcast response = JsonUtility.FromJson<StartMiniGameBroadcast>(
            Utility.Instance.GetPacketString(packet)
        );
        startMiniGameBroadcast = response;
        if (response.miniGameType != "wheelOfFortune")
            return;

        // float desiredRotationZ = GetDesiredRotationZ(response.amount);

        // Debug.Log($"Setting wheel directly to desired prize. Rotation: {desiredRotationZ}");

        // // Directly set the wheel's rotation
        // Circle.transform.eulerAngles = new Vector3(0, 0, desiredRotationZ);
        _isStarted = false;
        gamePlayed = false;
        StopTimer();
        TurnButton.Close();
        prize = response.amount;
        WinningAnimation();
    }

    private void StopTimer()
    {
        // StopAllCoroutines();
        if (autoTurnCoroutine != null)
        {
            StopCoroutine(autoTurnCoroutine);
        }
        txtTimer.text = "";
    }

    public void WinningAnimation()
    {
        if (!Can_Spin)
        {
            if (autoBackToLobbyCoroutine != null)
            {
                StopCoroutine(autoBackToLobbyCoroutine);
            }
            autoBackToLobbyCoroutine = StartCoroutine(Auto_Back_To_Lobby());
            return;
        }
        Debug.LogError("--------------");
        gameFinishEventCallPending = true;
        // UIManager.Instance.DisplayLoader(true);
        EventManager.Instance.WheelOfFortuneFinished(
            socket,
            gameId,
            prize,
            WheelOfFortuneFinishedHanlding
        );
    }

    private void WheelOfFortuneFinishedHanlding(Socket socket, Packet packet, object[] args)
    {
        UIManager.Instance.DisplayLoader(false);
        Debug.Log("WheelOfFortuneFinishedHanlding: " + packet.ToString());
        btnBack.interactable = btnBackToLobby.interactable = true;
        EventResponse<WheelOfFortuneFinishedResponse> response = JsonUtility.FromJson<
            EventResponse<WheelOfFortuneFinishedResponse>
        >(Utility.Instance.GetPacketString(packet));

        if (response.status == Constants.EventStatus.SUCCESS)
        {
            gameFinishEventCallPending = false;
            if (response.result.isWinningInPoints)
            {
#if UNITY_WEBGL
                if (UIManager.Instance.isGameWebGL)
                {
                    UIManager.Instance.LaunchWinningAnimation(
                        LocalizationManager
                            .GetTranslation("Congratulations You have won x Kr")
                            .Replace("{0}", prize.ToString()),
                        5
                    );
                    UIManager.Instance.LaunchWinningAnimation(response.message, 5);
                }
                else
                {
                    // UIManager.Instance.LaunchWinningAnimation($"Congratulations You have won {prize} Kr", 5);
                }
#else
                UIManager.Instance.LaunchWinningAnimation(
                    LocalizationManager
                        .GetTranslation("Congratulations You have won x Kr")
                        .Replace("{0}", prize.ToString()),
                    5
                );
                UIManager.Instance.LaunchWinningAnimation(response.message, 5);
#endif
            }
            else
            {
#if UNITY_WEBGL
                if (UIManager.Instance.isGameWebGL)
                {
                    UIManager.Instance.LaunchWinningAnimation(
                        LocalizationManager
                            .GetTranslation("Congratulations You have won x Kr")
                            .Replace("{0}", prize.ToString()),
                        5
                    );
                    UIManager.Instance.LaunchWinningAnimation(response.message, 5);
                }
                else
                {
                    // UIManager.Instance.LaunchWinningAnimation($"Congratulations You have won {prize} Kr", 5);
                }
#else
                UIManager.Instance.LaunchWinningAnimation(
                    LocalizationManager
                        .GetTranslation("Congratulations You have won x Kr")
                        .Replace("{0}", prize.ToString()),
                    5
                );
                UIManager.Instance.LaunchWinningAnimation(response.message, 5);
#endif
            }
            UIManager.Instance.gameAssetData.Points = response.result.points.ToString(
                "###,###,##0.00"
            );
            UIManager.Instance.gameAssetData.RealMoney = response.result.realMoney.ToString(
                "###,###,##0.00"
            );
            UIManager.Instance.gameAssetData.TodaysBalance = response.result.realMoney.ToString(
                "###,###,##0.00"
            );
            if (autoBackToLobbyCoroutine != null)
            {
                StopCoroutine(autoBackToLobbyCoroutine);
            }
            autoBackToLobbyCoroutine = StartCoroutine(Auto_Back_To_Lobby());
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

    public void OnSpinButtonTap()
    {
        if (isPaused)
            return;

        // _isStarted = true;

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
                Debug.LogError("PlayWheelOfFortuneResponse : Success Game 4");
                _isStarted = false;
                gamePlayed = true;
                StopTimer();
                TurnButton.Close();
                prize = response.result;
                TurnWheel();
            }
        }
        else
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
        }
    }

    public void TurnWheel()
    {
        Debug.LogError("TurnWheel");
        UIManager.Instance.DisplayLoader(false);
        _currentLerpRotationTime = 0f;
        _spinStartTime = Time.time; // Record absolute start time

        int fullCircles = UnityEngine.Random.Range(6, 9);
        int dda = GetDesiredRotationZ(prize);
        Debug.LogError($"Prize: {prize}, Prize Index: {dda}");
        float randomFinalAngle = _sectorsAngles[dda];
        Debug.LogError("randomFinalAngle - " + randomFinalAngle);

        // Here we set up how many circles our wheel should rotate before stop
        _finalAngle = -(fullCircles * 360 + randomFinalAngle);
        Debug.Log($"[WheelOfFortune] TurnWheel - StartTime: {_spinStartTime}, FinalAngle: {_finalAngle}");
        _isStarted = true;
    }

    public float maxLerpRotationTime = 4f;
    float previousAngle = 0f;
    float speedPeakTime = 0.25f; // When maximum speed occurs (0-1)
    float decelerationCurve = 5f; // How abrupt the slowdown is (higher = longer slowdown)

    void Update()
    {
        // if (Input.GetKeyDown(KeyCode.B))
        // {
        //     _currentLerpRotationTime = 0f;

        //     int fullCircles = UnityEngine.Random.Range(6, 9);
        //     int dda = GetDesiredRotationZ(1000);
        //     Debug.LogError(dda);
        //     float randomFinalAngle = _sectorsAngles[dda];
        //     Debug.LogError("randomFinalAngle - " + randomFinalAngle);

        //     // Here we set up how many circles our wheel should rotate before stop
        //     _finalAngle = -(fullCircles * 360 + randomFinalAngle);
        //     _isStarted = true;
        // }
        // if (Input.GetKeyDown(KeyCode.V))
        // {
        //     for (int i = 0; i < prizeList.Count; i++)
        //     {
        //         currentData.Add(prizeList[i]);
        //         allData.categoryPies[i].GetComponent<CategoryPie>().winPoint.text = prizeList[i]
        //             .ToString();
        //         _sectorsAngles.Add(allData.categoryPies[i].transform.eulerAngles.z);
        //     }
        // }

        // circleColliders.ToList().ForEach(c => c.enabled = false);
        // boxColliders.ToList().ForEach(c => c.enabled = false);
        // if (isReconnectOpen && !gamePlayed)
        // {
        //     // Calculate the exact rotation for the desired prize
        //     float desiredRotationZ = GetDesiredRotationZ(prize);

        //     Debug.Log($"Setting wheel directly to desired prize. Rotation: {desiredRotationZ}");

        //     // Directly set the wheel's rotation
        //     Circle.transform.eulerAngles = new Vector3(0, 0, desiredRotationZ);
        //     isReconnectOpen = false;
        // }

        if (!_isStarted)
            return;

        // circleColliders.ToList().ForEach(c => c.enabled = true);
        // boxColliders.ToList().ForEach(c => c.enabled = true);

        maxLerpRotationTime = 12f;

        // Calculate elapsed time from absolute start time (works across panel switches)
        _currentLerpRotationTime = Time.time - _spinStartTime;

        if (
            _currentLerpRotationTime > maxLerpRotationTime
            || Circle.transform.eulerAngles.z == _finalAngle
        )
        {
            Debug.Log($"[WheelOfFortune] Update - Spin complete. Prize: {prize}, FinalAngle: {_finalAngle}, CurrentAngle: {Circle.transform.eulerAngles.z}");
            _currentLerpRotationTime = maxLerpRotationTime;
            _isStarted = false;
            _startAngle = _finalAngle % 360;
            WinningAnimation();
        }

        // Calculate current position using linear interpolation
        float t = _currentLerpRotationTime / maxLerpRotationTime;

        // Custom easing curve calculation
        if (t <= speedPeakTime)
        {
            // Acceleration phase
            t = EaseIn(t / speedPeakTime) * speedPeakTime;
        }
        else
        {
            // Deceleration phase
            float decelT = (t - speedPeakTime) / (1 - speedPeakTime);
            t = speedPeakTime + EaseOut(decelT, decelerationCurve) * (1 - speedPeakTime);
        }

        //OLD CODE
        // This formulae allows to speed up at start and speed down at the end of rotation.
        // Try to change this values to customize the speed
        // t = t * t * t * (t * (6f * t - 15f) + 10f);

        float angle = Mathf.Lerp(_startAngle, _finalAngle, t);
        Circle.transform.eulerAngles = new Vector3(0, 0, angle);
        // Arrow.UpdateWheelVelocity(_currentLerpRotationTime / maxLerpRotationTime);
    }

    float EaseIn(float t)
    {
        // Quadratic ease-in
        return t * t;
    }

    float EaseOut(float t, float power)
    {
        // Customizable ease-out with power curve
        return 1 - Mathf.Pow(1 - t, power);
    }

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
            TurnButton.Close();

            if (EventManager.Instance.HasInternetConnection && Is_Game_4)
            {
                OnSpinButtonTap();
            }
        }

        yield return new WaitForSeconds(2);

        if (!isStopSpinBroadcastReceived || !isStartSpinBroadcastReceived)
        {
            UIManager.Instance.bingoHallDisplayPanel.Refresh();
        }
    }

    IEnumerator Auto_Back_To_Lobby()
    {
#if UNITY_WEBGL
        if (!UIManager.Instance.isGameWebGL)
        {
            // PanelMiniGameWinners.OpenData(startMiniGameBroadcast.winningTicketNumbers);
            UIManager.Instance.bingoHallDisplayPanel.OpenResultPanel(startMiniGameBroadcast);
            isStopSpinBroadcastReceived = false;
            isStartSpinBroadcastReceived = false;
        }
#endif
        float time = 12f;

        while (time > 0f)
        {
            time -= Time.deltaTime;
            yield return new WaitForEndOfFrame();
        }
        if (gameObject.activeSelf)
            OnBackButtonTap();
    }

    private int GetDesiredRotationZ(long prize)
    {
        List<int> indexPrizeList = new List<int>();

        for (int i = 0; i < currentData.Count; i++)
        {
            if (currentData[i] == prize)
                indexPrizeList.Add(i);
        }

        int randomIndex = UnityEngine.Random.Range(0, indexPrizeList.Count);
        int prizeIndex = indexPrizeList[randomIndex];

        return prizeIndex;
    }
}

/*
    private void GiveAwardByAngle ()
    {
        // Here you can set up rewards for every sector of wheel

        switch ((int)_startAngle) {
    
    
        case 324:
            RewardCoins (currentData[9]);
            break;
        case 288:
            RewardCoins (currentData[8]);
            break;
        case 252:
            RewardCoins (currentData[7]);
            break;
        case 216:
            RewardCoins (currentData[6]);
            break;
        case 180:
            RewardCoins (currentData[5]);
            break;
        case 144:
            RewardCoins (currentData[4]);
            break;
        case 108:
            RewardCoins (currentData[3]);
            break;
        case 72:
            RewardCoins (currentData[2]);
            break;
        case 36:
            RewardCoins (currentData[1]);
            break;
        default:
          //  RewardCoins (0);
            RewardCoins (currentData[0]);
            break;
        }
    }
*/
