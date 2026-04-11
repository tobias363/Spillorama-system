using System;
using System.Collections;
using System.Collections.Generic;
using BestHTTP.SocketIO;
using I2.Loc;
using TMPro;
using UnityEngine;
using UnityEngine.UI;
using System.Linq;
using DG.Tweening;

public class NewFortuneWheelManager : MonoBehaviour
{
    public static NewFortuneWheelManager Instance;

    [Header("Data / UI")]
    [SerializeField] private List<long> prizeList;
    public List<long> currentData = new List<long>();
    public List<float> _sectorsAngles = new List<float>(); // expected one per segment (0..360)
    public GameObject Circle; // Rotatable object (wheel root)
    [SerializeField] private TextMeshProUGUI txtTimer;
    [SerializeField] private Button TurnButton; // spin button
    [SerializeField] private Button btnBackToLobby;
    [SerializeField] private TextMeshProUGUI txtGameName;
    [SerializeField] private Button btnBack;
    public WheelCategories allData;
    public PanelMiniGameWinners PanelMiniGameWinners;
    [SerializeField] private Image imgBackground;

    [Header("Spin Settings")]
    public float MaxSpinDuration = 8f;   // total spin duration (when fresh)
    public int FullRotationsMin = 6;
    public int FullRotationsMax = 9;
    public Ease spinEase = Ease.OutQuart;
    public float finalBounceDuration = 0.18f;
    public float finalBounceAmount = 0f; // slight bounce degrees

    [Header("Auto / Game")]
    public int autoTurnTime = 10;
    public bool Can_Spin;
    public string gameId = "";
    private Socket socket;
    private WheelOfFortuneData wheelOfFortuneData;
    private BingoGame1History BingoGame1History;
    private StartMiniGameBroadcast startMiniGameBroadcast;

    // runtime state
    public bool _isStarted = false;
    private bool gameFinishEventCallPending = false;
    private float _finalAngle;          // absolute final target (can be large negative)
    private float _startAngle = 0f;     // angle when spin started
    public float _currentLerpRotationTime;
    private float _spinStartTime;       // absolute time when spin started (Time.time)
    private long prize = 0;
    private bool autoTurnTimeCompleted = false;
    private bool gamePlayed = false;
    private bool Is_Game_4 = false;
    private bool isReconnectOpen = false;
    private bool isStartSpinBroadcastReceived = false;
    private bool isStopSpinBroadcastReceived = false;

    Coroutine autoTurnCoroutine;
    Coroutine autoBackToLobbyCoroutine;
    private Tween activeSpinTween;
    public bool isPaused;
    private bool hasCalledWinningAnimation = false; // Prevent multiple winning animation calls
    private bool isWinningFlowComplete = false; // Track if winning animation and server response are complete

    // PlayerPrefs keys
    const string KEY_IS_SPINNING = "WHEEL_IsSpinning";
    const string KEY_START_ANGLE = "WHEEL_StartAngle";
    const string KEY_FINAL_ANGLE = "WHEEL_FinalAngle";
    const string KEY_START_TIME = "WHEEL_StartTime";
    const string KEY_PRIZE = "WHEEL_Prize";
    const string KEY_CURRENT_ANGLE = "WHEEL_CurrentAngle";
    string gameName = "";
    bool isOpen = false;

    void Awake()
    {
        if (Instance == null) Instance = this;
    }

    void OnEnable()
    {
        // register socket listeners if socket already set
        RegisterSocketListeners();

        GameSocketManager.OnSocketReconnected += Reconnect;
        // TurnButton.Open();

        if (isOpen)
        {
            hasCalledWinningAnimation = false; // Reset for new game
            isWinningFlowComplete = false; // Reset for new game
            isStopSpinBroadcastReceived = false; // Reset for new game
            isStartSpinBroadcastReceived = false; // Reset for new game
            _chosenPrizeSectorIndex = -1; // Reset sector cache for new game

            // Only start timer if panel was previously opened (not first time)
            StartAutoTurn();
        }

        // resume saved spin if present
        //RestoreWheelState();

        // If winning flow is complete but panel is still open, restart Auto_Back_To_Lobby timer
        // This handles the case where user went to lobby and returned after winning animation started
        if (!_isStarted && isWinningFlowComplete && autoBackToLobbyCoroutine == null && !isOpen)
        {
            Debug.Log("[FortuneWheel] OnEnable: Winning flow already complete, restarting Auto_Back_To_Lobby timer");
            autoBackToLobbyCoroutine = StartCoroutine(Auto_Back_To_Lobby());
        }
        Debug.Log("[FortuneWheel] OnEnable: isPaused: " + isPaused);
        gameFinishEventCallPending = false;
    }

    void OnDisable()
    {
        UnregisterSocketListeners();
        GameSocketManager.OnSocketReconnected -= Reconnect;

        StopTimer();

        // We intentionally do NOT kill activeSpinTween here. If the object gets disabled during spin,
        // DOTween will keep running unless you explicitly kill. But to be safe, kill active tween so no stray rotation runs while UI not visible.
        //if (activeSpinTween != null && activeSpinTween.IsActive()) activeSpinTween.Kill();
        //activeSpinTween = null;

        if (autoBackToLobbyCoroutine != null)
        {
            StopCoroutine(autoBackToLobbyCoroutine);
            autoBackToLobbyCoroutine = null;
        }

        // Clear wheel state if spin has finished to prevent re-triggering winning animation on return
        if (!_isStarted && PlayerPrefs.GetInt(KEY_IS_SPINNING, 0) == 0)
        {
            ClearWheelState();
        }
        Circle.transform.localEulerAngles = Vector3.zero; // start from 0
    }

    // -------------------------
    // Setup / Open / Reconnect
    // -------------------------
    public void Open(Socket socketParam, string gameIdParam, WheelOfFortuneData wheelData, int turnTimer = 10, Sprite backgroundSprite = null, string gameName = "")
    {
        this.socket = socketParam;
        this.gameId = gameIdParam;
        this.wheelOfFortuneData = wheelData;
        this.gameName = gameName;
        if (backgroundSprite != null && imgBackground != null) imgBackground.sprite = backgroundSprite;
        // if (txtGameName != null) txtGameName.text = gameName;
        this.Open();
        Debug.Log("[FortuneWheel] Open - Open isPaused: " + isPaused);
        isOpen = true;
        MaxSpinDuration = 8;
        // TurnButton.interactable = Can_Spin;
        TurnButton.gameObject.SetActive(Can_Spin);
        txtGameName.gameObject.SetActive(Utility.Instance.IsSplitScreenSupported);
        txtGameName.text = gameName;

        // populate currentData and sector angles (safe fallback to evenly spaced)
        currentData.Clear();
        _sectorsAngles.Clear();
        for (int i = 0; i < wheelOfFortuneData.prizeList.Count; i++)
        {
            currentData.Add(wheelOfFortuneData.prizeList[i]);
            allData.categoryPies[i].GetComponent<CategoryPie>().winPoint.text = wheelOfFortuneData
                .prizeList[i]
                .ToString();
            _sectorsAngles.Add(allData.categoryPies[i].transform.eulerAngles.z);
        }
        // Is_Game_4 = btnBack.interactable = btnBackToLobby.interactable = false;
        btnBack.gameObject.SetActive(false);
#if UNITY_WEBGL
        if (!UIManager.Instance.isGameWebGL)
        {
            TurnButton.Close();
            btnBackToLobby.gameObject.SetActive(false);
        }
#endif
        _isStarted = false;
        autoTurnTimeCompleted = false;
        gamePlayed = false;
        hasCalledWinningAnimation = false; // Reset for new game
        isWinningFlowComplete = false; // Reset for new game
        isStopSpinBroadcastReceived = false; // Reset for new game
        isStartSpinBroadcastReceived = false; // Reset for new game
        _chosenPrizeSectorIndex = -1; // Reset sector cache for new game
        autoTurnTime = turnTimer;
        StartAutoTurn();
    }

    public void ReconnectOpen(Socket socketParam, BingoGame1History game1History, string gameIdParam, List<long> prizeListParam, int turnTimer, float amount, bool isPaused = false, string pauseGameMessage = "", Sprite backgroundSprite = null, string gameName = "", bool isWofSpinStopped = false)
    {
        // populate using reconnect payload (keeps parity with original behavior)
        this.socket = socketParam;
        this.gameId = gameIdParam;
        if (backgroundSprite != null && imgBackground != null) imgBackground.sprite = backgroundSprite;
        this.BingoGame1History = game1History;
        this.Open();
        TurnButton.gameObject.SetActive(Can_Spin);
        Debug.Log("[FortuneWheel] ReconnectOpen - Open isPaused: " + isPaused);
        this.isPaused = isPaused;
        isOpen = false;
        txtGameName.gameObject.SetActive(Utility.Instance.IsSplitScreenSupported);
        txtGameName.text = gameName;
        currentData.Clear();
        _sectorsAngles.Clear();
        for (int i = 0; i < prizeListParam.Count; i++)
        {
            currentData.Add(prizeListParam[i]);
            allData.categoryPies[i].GetComponent<CategoryPie>().winPoint.text = prizeListParam[i].ToString();
            _sectorsAngles.Add(allData.categoryPies[i].transform.eulerAngles.z);
        }

        if (turnTimer > 0)
        {
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


            if (game1History.minigameData.isMinigamePlayed)
            {
                if (game1History.minigameData.isMinigameFinished)
                {
                    float desiredRotationZ = GetDesiredRotationZFinish(prize);
                    if (Circle != null) Circle.transform.localEulerAngles = new Vector3(0, 0, desiredRotationZ);
                }
                else
                {
                    if (game1History.minigameData.isWofSpinStopped)
                    {
                        float desiredRotationZ = GetDesiredRotationZFinish(prize);
                        if (Circle != null) Circle.transform.localEulerAngles = new Vector3(0, 0, desiredRotationZ);
                    }
                    else
                    {
                        if (Circle != null) Circle.transform.localEulerAngles = Vector3.zero;
                        gamePlayed = true;
                        StopTimer();
                        prize = game1History.minigameData.wonAmount;
                        MaxSpinDuration = game1History.minigameData.remainingStopTimer;
                        //if (MaxSpinDuration <= 2)
                        //{
                        //    float targetAngle = GetDesiredRotationZFinish(prize);
                        //    Circle.transform.eulerAngles = new Vector3(0, 0, targetAngle);

                        //    Debug.Log("Circle angles => " + Circle.transform.eulerAngles);
                        //}
                        //else
                        TurnWheel(); // will start local spin
                    }
                }

            }


            //if (isWofSpinStopped && game1History.minigameData.isMinigameFinished)
            //{
            //    Debug.LogError("ReconnectOpen - Wheel stopped, will be restored in OnEnable");
            //    //UIManager.Instance.lobbyPanel.gamePlanPanel.OnGame1ButtonTap();
            //    float desiredRotationZ = GetDesiredRotationZ(prize);
            //    if (Circle != null) Circle.transform.eulerAngles = new Vector3(0, 0, desiredRotationZ);

            //    Debug.Log("Circle angles => " + Circle.transform.eulerAngles);
            //}
            //else if (!game1History.minigameData.isMinigameFinished && game1History.minigameData.isWofSpinStopped)
            //{
            //    Debug.LogError("ReconnectOpen - Wheel already spinning, preserving state");
            //    float desiredRotationZ = GetDesiredRotationZ(prize);
            //    if (Circle != null) Circle.transform.eulerAngles = new Vector3(0, 0, desiredRotationZ);

            //    WinningAnimation();
            //    Debug.Log("Circle angles => " + Circle.transform.eulerAngles);
            //}
            ////else if (game1History.minigameData.isMinigameActivated && game1History.minigameData.isMinigamePlayed && !game1History.minigameData.isWofSpinStopped)
            ////{

            ////}
            //else if (!game1History.minigameData.isMinigameFinished && !game1History.minigameData.isWofSpinStopped && game1History.minigameData.isMinigamePlayed)
            //{
            //    Debug.LogError("ReconnectOpen - Wheel was spinning, will be restored in OnEnable");
            //    if (Circle != null) Circle.transform.eulerAngles = Vector3.zero;
            //    gamePlayed = true;
            //    StopTimer();
            //    prize = game1History.minigameData.wonAmount;
            //    MaxSpinDuration = game1History.minigameData.remainingStopTimer;
            //    if (MaxSpinDuration <= 2)
            //    {
            //        float targetAngle = GetDesiredRotationZ(prize);
            //        Circle.transform.eulerAngles = new Vector3(0, 0, targetAngle);

            //        Debug.Log("Circle angles => " + Circle.transform.eulerAngles);
            //    }
            //    else
            //    {
            //        TurnWheel(); // will start local spin
            //    }
            //}
        }
        // Is_Game_4 = btnBack.interactable = btnBackToLobby.interactable = false;

        btnBack.gameObject.SetActive(false);
#if UNITY_WEBGL
        if (!UIManager.Instance.isGameWebGL)
        {
            btnBackToLobby.gameObject.SetActive(false);
        }
#endif
        UIManager.Instance.messagePopup.Close();
        autoTurnTimeCompleted = false;
        // txtTimer.text = "";
    }

    // ---------------------------
    // Auto timer
    // ---------------------------
    private void StartAutoTurn()
    {
        if (autoTurnCoroutine != null) StopCoroutine(autoTurnCoroutine);
        Debug.Log($"[FortuneWheel] StartAutoTurn - Starting timer with {autoTurnTime} seconds");
        autoTurnCoroutine = StartCoroutine(AutoTurn());
    }

    IEnumerator AutoTurn()
    {
        Debug.Log($"[FortuneWheel] AutoTurn coroutine started with {autoTurnTime} seconds");

        for (int i = autoTurnTime; i >= 0; i--)
        {
            if (txtTimer != null) txtTimer.text = "00:" + i.ToString("00");
            // Debug.Log("[FortuneWheel] AutoTurn - Waiting for 1 second :" + isPaused);

            while (isPaused)
            {
                // Debug.Log("[FortuneWheel] AutoTurn - Paused, waiting for resume :" + isPaused);
                yield return null;
            }
            // Debug.Log("[FortuneWheel] AutoTurn - Waiting for 1 second :" + isPaused);
            yield return new WaitForSeconds(1);
        }

        // Debug.Log("[FortuneWheel] AutoTurn - Timer completed");
        autoTurnTimeCompleted = true;
        if (txtTimer != null) txtTimer.text = "";

        if (Can_Spin)
        {
            TurnButton.Close();

            if (EventManager.Instance.HasInternetConnection && Is_Game_4)
            {
                // Debug.Log("[FortuneWheel] AutoTurn - Auto-spinning wheel");
                OnSpinButtonTap();
            }
        }

        yield return new WaitForSeconds(2);

        if (!isStopSpinBroadcastReceived || !isStartSpinBroadcastReceived)
        {
            Debug.Log("[FortuneWheel] AutoTurn - Refreshing display (no broadcasts received)");
            UIManager.Instance.bingoHallDisplayPanel.Refresh();
        }
    }

    private void StopTimer()
    {
        if (autoTurnCoroutine != null)
        {
            StopCoroutine(autoTurnCoroutine);
            autoTurnCoroutine = null;
        }
        txtTimer.text = "";
    }

    // ---------------------------
    // Socket registration
    // ---------------------------
    private void RegisterSocketListeners()
    {
        if (socket == null) return;
        socket.On(Constants.BroadcastName.StartSpinWheel, Start_Spin_Wheel);
        socket.On(Constants.BroadcastName.toggleGameStatus, On_WOF_Game_toggleGameStatus);
        if (gameName == LocalizationManager.GetTranslation("Game 1"))
        {
            socket.On(Constants.BroadcastName.StopSpinWheel, Stop_Spin_Wheel);
        }
    }

    private void UnregisterSocketListeners()
    {
        if (socket == null) return;
        socket.Off(Constants.BroadcastName.StartSpinWheel);
        socket.Off(Constants.BroadcastName.toggleGameStatus);
        if (gameName == LocalizationManager.GetTranslation("Game 1"))
        {
            socket.Off(Constants.BroadcastName.StopSpinWheel);
        }
    }

    // ---------------------------
    // Socket handlers (Start / Stop broadcasts)
    // ---------------------------
    private void Start_Spin_Wheel(Socket s, Packet p, object[] args)
    {
        Debug.Log("Start_Spin_Wheel: " + p.ToString());
        UIManager.Instance.DisplayLoader(false);
        isStartSpinBroadcastReceived = true;

        StartMiniGameBroadcast response = JsonUtility.FromJson<StartMiniGameBroadcast>(Utility.Instance.GetPacketString(p));
        startMiniGameBroadcast = response;
        if (response.miniGameType != "wheelOfFortune") return;

        // server indicates spin started; server also sends amount in some flows
        gamePlayed = true;
        StopTimer();
        TurnButton.Close();

        prize = response.amount; // server-provided prize
        // Start local spin to show outcome
        TurnWheel();
    }

    private void Stop_Spin_Wheel(Socket s, Packet p, object[] args)
    {
        Debug.Log("Stop_Spin_Wheel: " + p.ToString());
        UIManager.Instance.DisplayLoader(false);
        isStopSpinBroadcastReceived = true;

        StartMiniGameBroadcast response = JsonUtility.FromJson<StartMiniGameBroadcast>(Utility.Instance.GetPacketString(p));
        startMiniGameBroadcast = response;
        if (response.miniGameType != "wheelOfFortune") return;

        // Stop any active wheel animation
        if (activeSpinTween != null && activeSpinTween.IsActive())
        {
            activeSpinTween.Kill();
            activeSpinTween = null;
        }
        if (MaxSpinDuration <= 2)
        {
            float targetAngle = GetDesiredRotationZFinish(prize);
            Circle.transform.localEulerAngles = new Vector3(0, 0, targetAngle);

            Debug.Log("Circle angles => " + Circle.transform.localEulerAngles);
        }

        _isStarted = false;
        gamePlayed = false;
        StopTimer();
        TurnButton.Close();

        // Immediately show winning flow (server stopped spin)
        WinningAnimation();
    }

    private void On_WOF_Game_toggleGameStatus(Socket s, Packet p, object[] args)
    {
        Debug.Log("On_WOF_Game_toggleGameStatus: " + p.ToString());
        toggleGameStatus res = JsonUtility.FromJson<toggleGameStatus>(Utility.Instance.GetPacketString(p));
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

    // ---------------------------
    // Play wheel request -> server response mapping
    // ---------------------------
    public void OnSpinButtonTap()
    {
        if (isPaused) return;
        if (gamePlayed) return;

        // UIManager.Instance.DisplayLoader(true);
        EventManager.Instance.PlayWheelOfFortune(socket, gameId, PlayWheelOfFortuneResponse);
    }

    // EventManager callback signature
    private void PlayWheelOfFortuneResponse(Socket s, Packet p, object[] args)
    {
        Debug.Log("PlayWheelOfFortuneResponse: " + p.ToString());
        UIManager.Instance.DisplayLoader(false);

        EventResponseLong response = JsonUtility.FromJson<EventResponseLong>(Utility.Instance.GetPacketString(p));
        if (response.status == Constants.EventStatus.SUCCESS)
        {
            Debug.Log("PlayWheelOfFortuneResponse : Success");
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

    // ---------------------------
    // Spin implementation using DOTween (resumable)
    // ---------------------------
    public void TurnWheel()
    {
        Debug.LogError("TurnWheel");
        UIManager.Instance.DisplayLoader(false);
        TurnButton.Close();
        // Reset winning animation flags for new spin
        hasCalledWinningAnimation = false;
        isWinningFlowComplete = false;

        // Stop the auto-turn timer when wheel starts spinning
        StopTimer();

        // kill any running tween
        //if (activeSpinTween != null && activeSpinTween.IsActive()) activeSpinTween.Kill();

        float targetAngle = GetDesiredRotationZ(prize);    // e.g. -313.2°
        int minrange, maxrange;
        int maxspin = (int)MaxSpinDuration;
        if (isOpen)
        {
            minrange = 6;
            maxrange = 8;
        }
        else
        {
            minrange = (maxspin * 6) / 8;
            maxrange = (maxspin * 8) / 8;
        }

        int fullRotations = UnityEngine.Random.Range(minrange, maxrange);

        // Calculate the final continuous angle (full rotations + target sector)
        // This prevents snapping by making one smooth animation to the final position
        float finalContinuousAngle = -((fullRotations * 360f) + targetAngle);

        _spinStartTime = Time.time;
        _isStarted = true;
        _finalAngle = finalContinuousAngle; // Store for restoration

        Debug.Log($"[Wheel] fullRotations={fullRotations}, targetSectorAngle={targetAngle}, finalContinuousAngle={finalContinuousAngle}, MaxSpinDuration ={MaxSpinDuration}");

        //SaveWheelState();

        // Single smooth animation to the final position with deceleration
        activeSpinTween = Circle.transform
            .DORotate(
                new Vector3(0, 0, finalContinuousAngle),
                MaxSpinDuration,
                RotateMode.FastBeyond360
            )
            .SetEase(spinEase)
            .SetUpdate(true)
            .OnComplete(() =>
            {
                _isStarted = false;
                ClearWheelState();

                // Normalize the final angle for display (keeps it readable but wheel is at correct position)
                float normalizedAngle = Mathf.Repeat(finalContinuousAngle, 360f);
                if (normalizedAngle > 180f)
                    normalizedAngle -= 360f;


                Circle.transform.localEulerAngles = new Vector3(0, 0, normalizedAngle);

                Debug.Log($"Wheel stopped at prize {prize} angle {normalizedAngle} (from continuous angle {finalContinuousAngle})");
                Debug.Log("Circle angles => " + Circle.transform.localEulerAngles);
                //WinningAnimation();
            });
    }

    void Update()
    {
#if UNITY_EDITOR
        if (Input.GetKeyDown(KeyCode.B))
        {
            currentData.Clear();
            _sectorsAngles.Clear();
            for (int i = 0; i < prizeList.Count; i++)
            {
                currentData.Add(prizeList[i]);
                if (allData != null && allData.categoryPies != null && i < allData.categoryPies.Length && allData.categoryPies[i] != null)
                {
                    var cp = allData.categoryPies[i].GetComponent<CategoryPie>();
                    if (cp != null) cp.winPoint.text = prizeList[i].ToString();
                    _sectorsAngles.Add(allData.categoryPies[i].transform.eulerAngles.z);
                }
                else
                {
                    float seg = 360f / Mathf.Max(1, prizeList.Count);
                    _sectorsAngles.Add(i * seg);
                }
            }
            Circle.transform.eulerAngles = new Vector3(0f, 0f, 0f);
            prize = 100;
        }
        if (Input.GetKeyDown(KeyCode.Space))
        {
            TurnWheel();
        }
#endif
    }

    private static float NormalizeAngle(float angle)
    {
        angle %= 360f;
        if (angle < 0f) angle += 360f;
        return angle;
    }

    // ---------------------------
    // Helpers
    // ---------------------------
    // Track the chosen sector index for the current prize to ensure consistency
    private int _chosenPrizeSectorIndex = -1;

    private int GetDesiredRotationIndex(long prizeValue, bool forceRecalculate = false)
    {
        // If we already chose a sector for this prize and not forcing recalculation, return it
        if (!forceRecalculate && _chosenPrizeSectorIndex >= 0 && _chosenPrizeSectorIndex < currentData.Count)
        {
            if (currentData[_chosenPrizeSectorIndex] == prizeValue)
            {
                Debug.Log($"[FortuneWheel] Using cached sector index: {_chosenPrizeSectorIndex} for prize: {prizeValue}");
                return _chosenPrizeSectorIndex;
            }
        }

        List<int> indexPrizeList = new List<int>();
        for (int i = 0; i < currentData.Count; i++)
        {
            if (currentData[i] == prizeValue) indexPrizeList.Add(i);
        }

        if (indexPrizeList.Count == 0)
        {
            Debug.LogWarning($"[FortuneWheel] Prize value {prizeValue} not found in current data!");
            return -1;
        }

        int randomIndex = UnityEngine.Random.Range(0, indexPrizeList.Count);
        _chosenPrizeSectorIndex = indexPrizeList[randomIndex];
        Debug.Log($"[FortuneWheel] Calculated new sector index: {_chosenPrizeSectorIndex} for prize: {prizeValue} (found {indexPrizeList.Count} matching sectors)");
        return _chosenPrizeSectorIndex;
    }

    private float GetDesiredRotationZ(long prizeValue)
    {
        int sectorIndex = GetDesiredRotationIndex(prizeValue);
        Debug.Log("GetDesiredRotationZ: " + sectorIndex + " prizeValue: " + prizeValue);
        if (sectorIndex < 0) return 0f;

        int totalSectors = currentData.Count;
        Debug.Log("totalSectors: " + totalSectors);
        float sectorAngle = 360f / totalSectors;
        Debug.Log("sectorAngle: " + sectorAngle);
        float centerAngle = (sectorIndex * sectorAngle) + (sectorAngle / 2f);
        Debug.Log("centerAngle: " + centerAngle);
        return -centerAngle;
    }


    private float GetDesiredRotationZFinish(long prizeValue)
    {
        int sectorIndex = GetDesiredRotationIndex(prizeValue);
        Debug.Log("GetDesiredRotationZFinish: " + sectorIndex + " prizeValue: " + prizeValue);
        if (sectorIndex < 0) return 0f;

        int totalSectors = currentData.Count;
        Debug.Log("totalSectors: " + totalSectors);
        float sectorAngle = 360f / totalSectors;
        Debug.Log("sectorAngle: " + sectorAngle);
        float centerAngle = (sectorIndex * sectorAngle) + (sectorAngle / 2f);
        Debug.Log("centerAngle: " + centerAngle);
        return centerAngle;
    }

    // ---------------------------
    // Winning / Finish handling
    // ---------------------------
    public void WinningAnimation()
    {
        // Prevent multiple winning animation calls for the same win
        if (hasCalledWinningAnimation)
        {
            Debug.Log("[FortuneWheel] WinningAnimation already called, skipping to prevent blinking.");
            return;
        }

        hasCalledWinningAnimation = true;

        if (!Can_Spin)
        {
            // Not player's turn - mark winning flow as complete immediately
            isWinningFlowComplete = true;
            if (autoBackToLobbyCoroutine != null) StopCoroutine(autoBackToLobbyCoroutine);
            autoBackToLobbyCoroutine = StartCoroutine(Auto_Back_To_Lobby());
            return;
        }

        Debug.LogError("Wheel -> Sending WheelOfFortuneFinished");
        gameFinishEventCallPending = true;
        EventManager.Instance.WheelOfFortuneFinished(socket, gameId, prize, WheelOfFortuneFinishedHanlding);
    }

    private void WheelOfFortuneFinishedHanlding(Socket s, Packet p, object[] args)
    {
        UIManager.Instance.DisplayLoader(false);
        Debug.Log("WheelOfFortuneFinishedHanlding: " + p.ToString());
        btnBack.interactable = btnBackToLobby.interactable = true;

        EventResponse<WheelOfFortuneFinishedResponse> response = JsonUtility.FromJson<EventResponse<WheelOfFortuneFinishedResponse>>(Utility.Instance.GetPacketString(p));
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

    IEnumerator Auto_Back_To_Lobby()
    {
        // Wait until wheel has completely stopped and winning flow is complete
        // while (_isStarted || !isWinningFlowComplete)
        // {
        //     Debug.Log($"[FortuneWheel] Waiting for wheel to complete. IsStarted: {_isStarted}, WinningFlowComplete: {isWinningFlowComplete}");
        //     yield return null; //new WaitForSeconds(0.5f);
        // }

        // Debug.Log("[FortuneWheel] Wheel stopped and winning flow complete. Waiting for animations and popups to finish...");

#if UNITY_WEBGL
        if (!UIManager.Instance.isGameWebGL)
        {
            UIManager.Instance.bingoHallDisplayPanel.OpenResultPanel(startMiniGameBroadcast);
            isStopSpinBroadcastReceived = false;
            isStartSpinBroadcastReceived = false;
        }
#endif

        // Extended wait time to ensure all winning animations and message popups have fully displayed and disappeared
        // This gives enough time for:
        // - Winning animation to play (typically 5 seconds)
        // - Message popups to display and auto-dismiss
        // - User to read the winning messages
        float time = 12f;
        while (time > 0f)
        {
            time -= Time.unscaledDeltaTime;
            yield return new WaitForEndOfFrame();
        }

        Debug.Log("[FortuneWheel] Auto-closing panel after animations complete.");
        if (gameObject.activeSelf && BackgroundManager.Instance.isNotificationRecieved) OnBackButtonTap();
        ClearWheelState();
    }

    // ---------------------------
    // Save / Restore (persistence)
    // ---------------------------
    private void SaveWheelState()
    {
        if (Circle != null)
            PlayerPrefs.SetFloat(KEY_CURRENT_ANGLE, Circle.transform.localEulerAngles.z);

        PlayerPrefs.SetFloat(KEY_START_ANGLE, _startAngle);
        PlayerPrefs.SetFloat(KEY_FINAL_ANGLE, _finalAngle);
        PlayerPrefs.SetFloat(KEY_START_TIME, _spinStartTime);
        PlayerPrefs.SetInt(KEY_IS_SPINNING, _isStarted ? 1 : 0);
        PlayerPrefs.SetString(KEY_PRIZE, prize.ToString());
        PlayerPrefs.Save();
    }

    private void RestoreWheelState()
    {
        // Don't restore state if Stop_Spin_Wheel broadcast was already received
        // This prevents overriding the server-set wheel position
        if (isStopSpinBroadcastReceived)
        {
            Debug.Log("[FortuneWheel] RestoreWheelState - Stop spin broadcast already received, skipping restore");
            return;
        }

        // 🧩 Check if a spin was active before disable
        if (PlayerPrefs.GetInt(KEY_IS_SPINNING, 0) != 1)
            return;

        // Load stored values
        _startAngle = PlayerPrefs.GetFloat(KEY_START_ANGLE, 0f);
        _finalAngle = PlayerPrefs.GetFloat(KEY_FINAL_ANGLE, 0f);
        _spinStartTime = PlayerPrefs.GetFloat(KEY_START_TIME, 0f);
        prize = long.Parse(PlayerPrefs.GetString(KEY_PRIZE, "0"));
        float savedCurrentAngle = PlayerPrefs.GetFloat(KEY_CURRENT_ANGLE, 0f);

        float elapsed = Time.time - _spinStartTime;
        float remaining = MaxSpinDuration - elapsed;

        Debug.Log($"[FortuneWheel] RestoreWheelState - elapsed={elapsed:F2}s, remaining={remaining:F2}s, finalAngle={_finalAngle}");

        if (BingoGame1History.minigameData.isMinigamePlayed && BingoGame1History.minigameData.isWofSpinStopped && !BingoGame1History.minigameData.isMinigameFinished)
        {
            Debug.LogError("RestoreWheelState - BingoGame1History.minigameData.isMinigamePlayed && BingoGame1History.minigameData.isWofSpinStopped && !BingoGame1History.minigameData.isMinigameFinished");
            _isStarted = false;
            if (activeSpinTween != null && activeSpinTween.IsActive()) activeSpinTween.Kill();
            float prizeAngle = GetDesiredRotationZ(BingoGame1History.minigameData.wonAmount);

            if (Circle != null) Circle.transform.eulerAngles = new Vector3(0f, 0f, prizeAngle);

            Debug.Log("Circle angles => " + Circle.transform.eulerAngles);
            ClearWheelState();
            WinningAnimation();
            return;
        }

        // 🧩 Otherwise, resume the spin from saved angle
        if (Circle != null)
        {
            Circle.transform.localEulerAngles = new Vector3(0f, 0f, savedCurrentAngle);
        }

        // Stop auto timer since wheel is spinning
        StopTimer();

        // 🧩 Resume tween for remaining duration
        if (activeSpinTween != null && activeSpinTween.IsActive()) activeSpinTween.Kill();
        _isStarted = true;

        Debug.Log($"[FortuneWheel] Resuming spin from {savedCurrentAngle}° to {_finalAngle}° over {remaining:F2}s");

        Debug.Log($"[RESTORE] Resuming from {savedCurrentAngle} → {_finalAngle} over {remaining:F2}s");

        // Resume DOTween spin (same as TurnWheel but with remaining time)
        activeSpinTween = Circle.transform
            .DOLocalRotate(
                new Vector3(0, 0, _finalAngle),
                remaining,
                RotateMode.FastBeyond360
            )
            .SetEase(spinEase)
            .SetUpdate(true)
            .OnUpdate(SaveWheelState)
            .OnComplete(() =>
            {
                _isStarted = false;
                ClearWheelState();

                // Normalize final angle just like Turn the Wheel
                float normalized = Mathf.Repeat(_finalAngle, 360f);
                if (normalized > 180f)
                    normalized -= 360f;

                Circle.transform.localEulerAngles = new Vector3(0, 0, normalized);

                Debug.Log($"[RESTORE] Completed. Final normalized angle: {normalized}");
                WinningAnimation();
            });
    }

    private void ClearWheelState()
    {
        PlayerPrefs.DeleteKey(KEY_CURRENT_ANGLE);
        PlayerPrefs.DeleteKey(KEY_FINAL_ANGLE);
        PlayerPrefs.DeleteKey(KEY_START_ANGLE);
        PlayerPrefs.DeleteKey(KEY_START_TIME);
        PlayerPrefs.DeleteKey(KEY_IS_SPINNING);
        PlayerPrefs.DeleteKey(KEY_PRIZE);
    }

    // ---------------------------
    // Navigation / Back
    // ---------------------------
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

    // ---------------------------
    // Reconnect helper
    // ---------------------------
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
}
