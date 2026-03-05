using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Networking;
using SimpleJSON;

public partial class APIManager : MonoBehaviour
{
    public static APIManager instance;

    private const string BASE_URL = "https://bingoapi.codehabbit.com/";

    [Header("Realtime Multiplayer (Skeleton backend)")]
    [SerializeField] private bool useRealtimeBackend = true;
    [SerializeField] private BingoRealtimeClient realtimeClient;
    [SerializeField] private BingoAutoLogin autoLogin;
    [SerializeField] private bool joinOrCreateOnStart = true;
    [SerializeField] private bool autoCreateRoomWhenRoomCodeIsEmpty = true;
    [SerializeField] private bool autoMarkDrawnNumbers = true;
    [SerializeField] private bool duplicateTicketAcrossAllCards = true;
    [SerializeField] private bool enableTicketPaging = true;
    [SerializeField] private bool triggerAutoLoginWhenAuthMissing = true;
    [SerializeField] private bool logBootstrapEvents = false;
    [SerializeField] private bool playButtonStartsAndDrawsRealtime = true;
    [SerializeField] private bool realtimeScheduledRounds = true;
    [SerializeField] private bool drawImmediatelyAfterManualStart = true;
    [SerializeField] private bool scheduledModeManualStartFallback = true;
    [SerializeField] private bool syncRealtimeEntryFeeWithBetSelector = true;
    [SerializeField] private bool centerRealtimeCountdownUnderBalls = true;
    [SerializeField] private Vector2 realtimeCountdownOffset = new Vector2(0f, -155f);
    [SerializeField] [Range(1f, 2f)] private float realtimeCountdownWidthMultiplier = 1.3f;
    [SerializeField] [Range(0.15f, 0.6f)] private float realtimeCountdownMinParentWidthRatio = 0.3f;
    [SerializeField] [Min(120f)] private float realtimeCountdownMinWidth = 240f;
    [SerializeField] [Min(0f)] private float realtimeCountdownEdgePadding = 32f;
    [SerializeField] [Range(1, 5)] private int realtimeTicketsPerPlayer = 4;
    [SerializeField] private int realtimeEntryFee = 0;
    [SerializeField] private BallManager ballManager;
    [SerializeField] private string roomCode = "";
    [SerializeField] private string hallId = "";
    [SerializeField] private string playerName = "Player";
    [SerializeField] private string walletId = "";
    [SerializeField] private string accessToken = "";

    [Header("Legacy Slot API (Fallback)")]
    [SerializeField] private bool legacyStartCallEnabled = true;

    private string initialApiUrl;
    private string remainingApiUrl;

    public int bonusAMT;

    private readonly List<SlotData> slotDataList = new();
    private bool isSlotDataFetched = false;

    private string activeRoomCode = "";
    private string activePlayerId = "";
    private string activeHostPlayerId = "";
    private string activeGameId = "";
    private int processedDrawCount = 0;
    private int currentTicketPage = 0;
    private List<List<int>> activeTicketSets = new();
    private bool isJoinOrCreatePending = false;
    private float joinOrCreateIssuedAtRealtime = -1f;
    private float nextCountdownRefreshAt = -1f;
    private float nextScheduledRoomStateRefreshAt = -1f;
    private float nextScheduledManualStartAttemptAt = -1f;
    private readonly RealtimeSchedulerState realtimeScheduler = new();
    private readonly RealtimeCountdownPresenter realtimeCountdownPresenter = new();
    private readonly RealtimeRoomConfigurator realtimeRoomConfigurator = new();

    public bool UseRealtimeBackend => useRealtimeBackend;
    public string ActiveRoomCode => activeRoomCode;
    public string ActivePlayerId => activePlayerId;
    public string ActiveHallId => hallId;
    public int CurrentTicketPage => currentTicketPage;

    public int TicketPageCount
    {
        get
        {
            int cardSlots = Mathf.Max(1, GetCardSlotsCount());
            int totalTickets = Mathf.Max(1, activeTicketSets != null ? activeTicketSets.Count : 0);
            return Mathf.Max(1, Mathf.CeilToInt((float)totalTickets / cardSlots));
        }
    }

    void Awake()
    {
        instance = this;
    }

    void OnEnable()
    {
        if (useRealtimeBackend)
        {
            BindRealtimeClient();
        }
    }

    void OnDisable()
    {
        if (realtimeClient != null)
        {
            realtimeClient.OnConnectionChanged -= HandleRealtimeConnectionChanged;
            realtimeClient.OnRoomUpdate -= HandleRealtimeRoomUpdate;
            realtimeClient.OnError -= HandleRealtimeError;
        }
    }

    void Start()
    {
        if (useRealtimeBackend)
        {
            BindRealtimeClient();
            if (joinOrCreateOnStart)
            {
                if (NeedsAuthBootstrap())
                {
                    TryStartAutoLogin("Oppstart uten accessToken/hallId.");
                }
                else
                {
                    JoinOrCreateRoom();
                }
            }
            return;
        }

        if (legacyStartCallEnabled)
        {
            CallApisForFetchData();
        }
    }

    void Update()
    {
        if (!useRealtimeBackend || !realtimeScheduledRounds)
        {
            return;
        }

        RefreshRealtimeCountdownLabel();
        TickScheduledRoundStateRefresh();
        TryStartRealtimeRoundFromSchedulerFallback(
            allowManualWhenSchedulerDisabled: false,
            source: "scheduled-update-loop");
    }

    private void BindRealtimeClient()
    {
        if (realtimeClient == null)
        {
            realtimeClient = BingoRealtimeClient.instance;
        }

        if (realtimeClient == null)
        {
            realtimeClient = FindObjectOfType<BingoRealtimeClient>();
        }

        if (realtimeClient == null)
        {
            GameObject clientObject = new("BingoRealtimeClient_Auto");
            realtimeClient = clientObject.AddComponent<BingoRealtimeClient>();
            LogBootstrap("BingoRealtimeClient manglet i scenen. Opprettet automatisk runtime-klient.");
        }

        realtimeClient.OnConnectionChanged -= HandleRealtimeConnectionChanged;
        realtimeClient.OnRoomUpdate -= HandleRealtimeRoomUpdate;
        realtimeClient.OnError -= HandleRealtimeError;

        realtimeClient.OnConnectionChanged += HandleRealtimeConnectionChanged;
        realtimeClient.OnRoomUpdate += HandleRealtimeRoomUpdate;
        realtimeClient.OnError += HandleRealtimeError;
        realtimeClient.SetAccessToken(accessToken);
    }

    private BallManager ResolveBallManager()
    {
        if (ballManager != null)
        {
            return ballManager;
        }

        ballManager = FindObjectOfType<BallManager>();
        return ballManager;
    }

    private void ResetRealtimeRoundVisuals()
    {
        BallManager resolved = ResolveBallManager();
        if (resolved == null)
        {
            return;
        }

        resolved.ResetBalls();
    }

    private void ShowRealtimeDrawBall(int drawIndex, int drawnNumber)
    {
        BallManager resolved = ResolveBallManager();
        if (resolved == null)
        {
            return;
        }

        resolved.ShowRealtimeDrawBall(drawIndex, drawnNumber);
    }

    private BingoAutoLogin ResolveAutoLogin()
    {
        if (autoLogin != null)
        {
            return autoLogin;
        }

        autoLogin = FindObjectOfType<BingoAutoLogin>();
        if (autoLogin != null)
        {
            return autoLogin;
        }

        GameObject autoLoginObject = new("BingoAutoLogin_Auto");
        autoLogin = autoLoginObject.AddComponent<BingoAutoLogin>();
        LogBootstrap("BingoAutoLogin manglet i scenen. Opprettet runtime auto-login med default credentials.");
        return autoLogin;
    }

    private bool TryStartAutoLogin(string reason)
    {
        if (!useRealtimeBackend || !triggerAutoLoginWhenAuthMissing)
        {
            return false;
        }

        BingoAutoLogin loginBootstrap = ResolveAutoLogin();
        if (loginBootstrap == null)
        {
            return false;
        }

        if (!string.IsNullOrWhiteSpace(reason))
        {
            LogBootstrap($"{reason} Starter auto-login.");
        }
        loginBootstrap.StartAutoLogin();
        return true;
    }

    private bool NeedsAuthBootstrap()
    {
        if (!triggerAutoLoginWhenAuthMissing)
        {
            return false;
        }

        return string.IsNullOrWhiteSpace((accessToken ?? string.Empty).Trim()) ||
               string.IsNullOrWhiteSpace((hallId ?? string.Empty).Trim());
    }

    private void LogBootstrap(string message)
    {
        if (!logBootstrapEvents)
        {
            return;
        }

        Debug.Log("[APIManager] " + message);
    }

    private void HandleRealtimeConnectionChanged(bool connected)
    {
        if (!connected)
        {
            return;
        }

        if (isJoinOrCreatePending)
        {
            if (IsJoinOrCreateTimedOut())
            {
                ClearJoinOrCreatePending();
            }
            else
            {
                return;
            }
        }

        if (!string.IsNullOrWhiteSpace(activeRoomCode) && !string.IsNullOrWhiteSpace(activePlayerId))
        {
            realtimeClient.ResumeRoom(activeRoomCode, activePlayerId, HandleResumeAck);
            return;
        }

        if (joinOrCreateOnStart && string.IsNullOrWhiteSpace(activePlayerId))
        {
            JoinOrCreateRoom();
        }
    }

    private void HandleRealtimeError(string message)
    {
        if (!string.IsNullOrWhiteSpace(message) &&
            message.IndexOf("closed the WebSocket connection without completing the close handshake", StringComparison.OrdinalIgnoreCase) >= 0)
        {
            Debug.LogWarning("[APIManager] Realtime reconnect: " + message);
            return;
        }

        Debug.LogError("[APIManager] Realtime error: " + message);
    }

    public void ConfigurePlayer(string newPlayerName, string newWalletId)
    {
        playerName = string.IsNullOrWhiteSpace(newPlayerName) ? "Player" : newPlayerName.Trim();
        walletId = (newWalletId ?? string.Empty).Trim();
    }

    public void ConfigureHall(string newHallId)
    {
        hallId = (newHallId ?? string.Empty).Trim();
    }

    public void ConfigureAccessToken(string token)
    {
        accessToken = (token ?? string.Empty).Trim();
        if (realtimeClient != null)
        {
            realtimeClient.SetAccessToken(accessToken);
        }
    }

    public void SetRoomCode(string newRoomCode)
    {
        roomCode = (newRoomCode ?? string.Empty).Trim().ToUpperInvariant();
    }

    public void SetRealtimeEntryFeeFromGameUI(int entryFee)
    {
        realtimeEntryFee = Mathf.Max(0, entryFee);

        if (!useRealtimeBackend || !realtimeScheduledRounds)
        {
            return;
        }

        PushRealtimeRoomConfiguration();
        RefreshRealtimeCountdownLabel(forceRefresh: true);
    }

    private void SyncRealtimeEntryFeeWithCurrentBet()
    {
        if (!syncRealtimeEntryFeeWithBetSelector)
        {
            return;
        }

        if (GameManager.instance == null)
        {
            return;
        }

        realtimeEntryFee = Mathf.Max(0, GameManager.instance.currentBet);
    }

    private void PushRealtimeRoomConfiguration()
    {
        realtimeRoomConfigurator.PushRoomConfiguration(
            useRealtimeBackend,
            realtimeScheduledRounds,
            realtimeClient,
            activeRoomCode,
            activePlayerId,
            realtimeEntryFee,
            HandleRealtimeRoomUpdate);
    }

    private void ApplySchedulerMetadata(JSONNode snapshot)
    {
        realtimeScheduler.ApplySchedulerSnapshot(snapshot);
    }

    private void PositionRealtimeCountdownBelowBalls()
    {
        if (!centerRealtimeCountdownUnderBalls)
        {
            return;
        }

        realtimeCountdownPresenter.PositionUnderBalls(
            GameManager.instance?.numberGenerator,
            ResolveBallManager(),
            realtimeCountdownOffset,
            realtimeCountdownWidthMultiplier,
            realtimeCountdownMinParentWidthRatio,
            realtimeCountdownMinWidth,
            realtimeCountdownEdgePadding);
    }

    private void RefreshRealtimeCountdownLabel(bool forceRefresh = false)
    {
        NumberGenerator generator = GameManager.instance?.numberGenerator;
        if (generator == null || generator.autoSpinRemainingPlayText == null)
        {
            return;
        }

        if (!forceRefresh && Time.unscaledTime < nextCountdownRefreshAt)
        {
            return;
        }
        nextCountdownRefreshAt = Time.unscaledTime + 0.2f;

        PositionRealtimeCountdownBelowBalls();
        long nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        generator.autoSpinRemainingPlayText.text = realtimeScheduler.BuildCountdownLabel(nowMs);
    }

    private void TickScheduledRoundStateRefresh()
    {
        if (!scheduledModeManualStartFallback)
        {
            return;
        }

        if (Time.unscaledTime < nextScheduledRoomStateRefreshAt)
        {
            return;
        }

        if (string.IsNullOrWhiteSpace(activeRoomCode) || string.IsNullOrWhiteSpace(activePlayerId))
        {
            return;
        }

        BindRealtimeClient();
        if (realtimeClient == null || !realtimeClient.IsReady)
        {
            return;
        }

        long nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        if (!realtimeScheduler.ShouldSyncAroundBoundary(nowMs))
        {
            return;
        }

        nextScheduledRoomStateRefreshAt = Time.unscaledTime + 0.75f;
        RequestRealtimeStateForScheduledPlay();
    }

    private bool TryStartRealtimeRoundFromSchedulerFallback(bool allowManualWhenSchedulerDisabled, string source)
    {
        if (!scheduledModeManualStartFallback)
        {
            return false;
        }

        if (Time.unscaledTime < nextScheduledManualStartAttemptAt)
        {
            return false;
        }

        if (realtimeClient == null || !realtimeClient.IsReady)
        {
            return false;
        }

        if (string.IsNullOrWhiteSpace(activeRoomCode) || string.IsNullOrWhiteSpace(activePlayerId))
        {
            return false;
        }

        if (!IsActivePlayerHost())
        {
            return false;
        }

        long nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        bool shouldStart = realtimeScheduler.ShouldAttemptClientStart(nowMs);
        if (!shouldStart && allowManualWhenSchedulerDisabled && realtimeScheduler.ShouldFallbackToManualStart())
        {
            shouldStart = true;
        }

        if (!shouldStart)
        {
            return false;
        }

        nextScheduledManualStartAttemptAt = Time.unscaledTime + 1.5f;
        Debug.Log($"[APIManager] Scheduler fallback start ({source}).");
        StartRealtimeGameFromPlayButton();
        return true;
    }

    private bool IsActivePlayerHost()
    {
        if (string.IsNullOrWhiteSpace(activePlayerId))
        {
            return false;
        }

        if (string.IsNullOrWhiteSpace(activeHostPlayerId))
        {
            return true;
        }

        return string.Equals(activePlayerId, activeHostPlayerId, StringComparison.Ordinal);
    }

    public void NextTicketPage()
    {
        if (!enableTicketPaging)
        {
            return;
        }

        if (activeTicketSets == null || activeTicketSets.Count == 0)
        {
            return;
        }
        int pageCount = TicketPageCount;
        if (pageCount <= 1)
        {
            return;
        }

        currentTicketPage = (currentTicketPage + 1) % pageCount;
        ApplyTicketSetsToCards(activeTicketSets);
    }

    public void PreviousTicketPage()
    {
        if (!enableTicketPaging)
        {
            return;
        }

        if (activeTicketSets == null || activeTicketSets.Count == 0)
        {
            return;
        }
        int pageCount = TicketPageCount;
        if (pageCount <= 1)
        {
            return;
        }

        currentTicketPage = (currentTicketPage - 1 + pageCount) % pageCount;
        ApplyTicketSetsToCards(activeTicketSets);
    }

    public void JoinOrCreateRoom()
    {
        if (!useRealtimeBackend)
        {
            Debug.LogWarning("[APIManager] Realtime backend is disabled.");
            return;
        }

        BindRealtimeClient();
        if (realtimeClient == null)
        {
            return;
        }

        string desiredAccessToken = (accessToken ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(desiredAccessToken))
        {
            if (!TryStartAutoLogin("accessToken mangler. Login kreves for realtime gameplay."))
            {
                Debug.LogError("[APIManager] accessToken mangler. Login kreves for realtime gameplay.");
            }
            return;
        }
        realtimeClient.SetAccessToken(desiredAccessToken);

        string desiredHallId = (hallId ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(desiredHallId))
        {
            if (!TryStartAutoLogin("hallId mangler. Forsoker a hente hall via auto-login."))
            {
                Debug.LogError("[APIManager] hallId mangler. Sett hallId før realtime gameplay.");
            }
            return;
        }

        if (!realtimeClient.IsReady)
        {
            realtimeClient.Connect();
            return;
        }

        if (isJoinOrCreatePending)
        {
            if (IsJoinOrCreateTimedOut())
            {
                ClearJoinOrCreatePending();
            }
            else
            {
                return;
            }
        }

        if (!string.IsNullOrWhiteSpace(activeRoomCode) && !string.IsNullOrWhiteSpace(activePlayerId))
        {
            RequestRealtimeState();
            return;
        }

        string desiredRoomCode = (roomCode ?? string.Empty).Trim().ToUpperInvariant();
        string desiredPlayerName = string.IsNullOrWhiteSpace(playerName) ? "Player" : playerName.Trim();
        string desiredWalletId = (walletId ?? string.Empty).Trim();

        if (!string.IsNullOrWhiteSpace(desiredRoomCode))
        {
            MarkJoinOrCreatePending();
            realtimeClient.JoinRoom(desiredRoomCode, desiredHallId, desiredPlayerName, desiredWalletId, HandleJoinOrCreateAck);
            return;
        }

        if (autoCreateRoomWhenRoomCodeIsEmpty)
        {
            MarkJoinOrCreatePending();
            realtimeClient.CreateRoom(desiredHallId, desiredPlayerName, desiredWalletId, HandleJoinOrCreateAck);
        }
    }

    private void HandleJoinOrCreateAck(SocketAck ack)
    {
        ClearJoinOrCreatePending();

        if (ack == null)
        {
            Debug.LogError("[APIManager] room ack is null.");
            return;
        }

        if (!ack.ok)
        {
            if (RealtimeRoomStateUtils.IsPlayerAlreadyInRunningGame(ack))
            {
                string existingRoomCode = RealtimeRoomStateUtils.ExtractRoomCodeFromAlreadyRunningMessage(ack.errorMessage);
                if (!string.IsNullOrWhiteSpace(existingRoomCode))
                {
                    Debug.LogWarning($"[APIManager] Spiller er allerede i aktivt spill. Forsoker reconnect til rom {existingRoomCode}.");
                    activeRoomCode = existingRoomCode;
                    roomCode = existingRoomCode;
                    realtimeClient.RequestRoomState(existingRoomCode, HandleRecoverExistingRoomStateAck);
                    return;
                }
            }

            if (RealtimeRoomStateUtils.IsRoomNotFound(ack))
            {
                Debug.LogWarning("[APIManager] room ack feilet med ROOM_NOT_FOUND. Rommet kan vaere foreldet etter reconnect.");
            }
            Debug.LogError($"[APIManager] room ack failed: {ack.errorCode} {ack.errorMessage}");
            return;
        }

        JSONNode data = ack.data;
        if (data == null)
        {
            Debug.LogError("[APIManager] room ack missing data.");
            return;
        }

        string ackRoomCode = data["roomCode"];
        string ackPlayerId = data["playerId"];

        if (!string.IsNullOrWhiteSpace(ackRoomCode))
        {
            activeRoomCode = ackRoomCode.Trim().ToUpperInvariant();
            roomCode = activeRoomCode;
        }

        if (!string.IsNullOrWhiteSpace(ackPlayerId))
        {
            activePlayerId = ackPlayerId.Trim();
        }

        Debug.Log($"[APIManager] Connected to room {activeRoomCode} as player {activePlayerId}");

        if (realtimeScheduledRounds)
        {
            SyncRealtimeEntryFeeWithCurrentBet();
            PushRealtimeRoomConfiguration();
        }

        JSONNode snapshot = data["snapshot"];
        if (snapshot != null && !snapshot.IsNull)
        {
            HandleRealtimeRoomUpdate(snapshot);
        }
        else
        {
            RequestRealtimeState();
        }
    }

    public void RequestRealtimeState()
    {
        if (!useRealtimeBackend)
        {
            return;
        }

        BindRealtimeClient();
        if (realtimeClient == null)
        {
            return;
        }

        string desiredAccessToken = (accessToken ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(desiredAccessToken))
        {
            if (!TryStartAutoLogin("accessToken mangler. Login kreves for realtime gameplay."))
            {
                Debug.LogError("[APIManager] accessToken mangler. Login kreves for realtime gameplay.");
            }
            return;
        }
        realtimeClient.SetAccessToken(desiredAccessToken);

        if (!realtimeClient.IsReady)
        {
            realtimeClient.Connect();
            return;
        }

        if (string.IsNullOrWhiteSpace(activeRoomCode))
        {
            JoinOrCreateRoom();
            return;
        }

        if (!string.IsNullOrWhiteSpace(activePlayerId))
        {
            realtimeClient.ResumeRoom(activeRoomCode, activePlayerId, HandleResumeAck);
            return;
        }

        realtimeClient.RequestRoomState(activeRoomCode, (ack) =>
        {
            if (ack == null || !ack.ok)
            {
                if (RealtimeRoomStateUtils.IsRoomNotFound(ack))
                {
                    Debug.LogWarning("[APIManager] room:state feilet med ROOM_NOT_FOUND. Nullstiller stale room-state.");
                    ResetActiveRoomState(clearDesiredRoomCode: true);
                    if (joinOrCreateOnStart)
                    {
                        JoinOrCreateRoom();
                    }
                    return;
                }
                Debug.LogError($"[APIManager] room:state failed: {ack?.errorCode} {ack?.errorMessage}");
                return;
            }

            JSONNode snapshot = ack.data?["snapshot"];
            if (snapshot != null && !snapshot.IsNull)
            {
                HandleRealtimeRoomUpdate(snapshot);
            }
        });
    }

    private void HandleRecoverExistingRoomStateAck(SocketAck ack)
    {
        if (ack == null || !ack.ok)
        {
            Debug.LogError($"[APIManager] recover room:state failed: {ack?.errorCode} {ack?.errorMessage}");
            return;
        }

        JSONNode snapshot = ack.data?["snapshot"];
        if (snapshot == null || snapshot.IsNull)
        {
            Debug.LogError("[APIManager] recover room:state mangler snapshot.");
            return;
        }

        string snapshotRoomCode = snapshot["code"];
        if (!string.IsNullOrWhiteSpace(snapshotRoomCode))
        {
            activeRoomCode = snapshotRoomCode.Trim().ToUpperInvariant();
            roomCode = activeRoomCode;
        }

        string resolvedPlayerId = RealtimeRoomStateUtils.ResolvePlayerIdFromSnapshot(snapshot, walletId, playerName);
        if (string.IsNullOrWhiteSpace(resolvedPlayerId))
        {
            Debug.LogWarning("[APIManager] Klarte ikke finne playerId i eksisterende rom-snapshot.");
            HandleRealtimeRoomUpdate(snapshot);
            return;
        }

        activePlayerId = resolvedPlayerId;
        Debug.Log($"[APIManager] Reconnect: fant existing room {activeRoomCode} med player {activePlayerId}.");

        if (realtimeClient != null && realtimeClient.IsReady)
        {
            realtimeClient.ResumeRoom(activeRoomCode, activePlayerId, HandleResumeAck);
            return;
        }

        HandleRealtimeRoomUpdate(snapshot);
    }

    public void CallApisForFetchData()
    {
        if (useRealtimeBackend)
        {
            RequestRealtimeState();
            return;
        }

        CallRemainingApi();
    }

    public void CallRemainingApi()
    {
        Debug.Log("Remaining API call started.");
        if (GameManager.instance != null)
        {
            int currentBet = GameManager.instance.currentBet;
            remainingApiUrl = $"{BASE_URL}api/v1/slot?bet={currentBet}";
            StartCoroutine(FetchSlotDataFromAPI(remainingApiUrl, false));
        }
        else
        {
            Debug.LogError("GameManager instance is not available.");
        }
    }

    private IEnumerator FetchSlotDataFromAPI(string url, bool isInitialCall)
    {
        using (UnityWebRequest request = UnityWebRequest.Get(url))
        {
            yield return request.SendWebRequest();

            if (request.result == UnityWebRequest.Result.ConnectionError || request.result == UnityWebRequest.Result.ProtocolError)
            {
                Debug.LogError("Error: " + request.error);
            }
            else
            {
                string responseText = request.downloadHandler.text;

                if (isInitialCall)
                {
                    RootObject rootObject = JsonUtility.FromJson<RootObject>(responseText);

                    if (rootObject != null && rootObject.data != null)
                    {
                        slotDataList.Clear();
                        slotDataList.AddRange(rootObject.data);
                        isSlotDataFetched = true;
                    }
                    else
                    {
                        Debug.LogError("Failed to parse JSON from URL " + url + ". Please check the JSON format and ensure it matches the class structure.");
                    }
                }
                else
                {
                    RemainingApiResponse remainingApiResponse = JsonUtility.FromJson<RemainingApiResponse>(responseText);

                    if (remainingApiResponse != null && remainingApiResponse.data != null)
                    {
                        SlotData slotData = remainingApiResponse.data;
                        slotDataList.Clear();
                        slotDataList.Add(slotData);
                        isSlotDataFetched = true;
                        StartGameWithBet();
                    }
                    else
                    {
                        Debug.LogError("Failed to parse JSON from URL " + url + ". Please check the JSON format and ensure it matches the class structure.");
                    }
                }
            }
        }
    }

    public void StartGameWithBet()
    {
        if (GameManager.instance != null)
        {
            if (isSlotDataFetched)
            {
                int currentBet = GameManager.instance.currentBet;

                foreach (SlotData slotData in slotDataList)
                {
                    if (slotData.bet == currentBet)
                    {
                        int fetchNo = GameManager.instance.betlevel + 1;

                        if (fetchNo != 0)
                        {
                            fetchNo = slotData.number / fetchNo;
                            Debug.Log("Original Fetched number: " + slotData.number);
                            NumberManager.instance.num = fetchNo;
                        }
                        else
                        {
                            NumberManager.instance.num = slotData.number;
                            Debug.Log("Fetched number: " + slotData.number);
                            Debug.Log("GameManager.instance.betlevel is zero. Division by zero is not allowed.");
                        }

                        if (fetchNo > 150)
                        {
                            Debug.Log("Bonus Is Present :::");
                            NumberManager.instance.num = 150;

                            int bonus = fetchNo - 150;
                            bonusAMT = bonus;
                            Debug.Log("Bonus Is Present ::: " + bonus);
                        }

                        NumberManager.instance.DoAvailablePattern();
                        slotData.selected = true;
                    }
                    else
                    {
                        slotData.selected = false;
                    }
                }
            }
            else
            {
                Debug.LogError("Slot data has not been fetched yet.");
            }
        }
        else
        {
            Debug.LogError("GameManager instance is not available.");
        }
    }

    [System.Serializable]
    private class SlotWrapper
    {
        public List<SlotData> slots;

        public SlotWrapper(List<SlotData> slotDataList)
        {
            this.slots = slotDataList;
        }
    }

    [System.Serializable]
    private class RootObject
    {
        public List<SlotData> data;
        public bool error;
        public string message;
        public int code;
    }

    [System.Serializable]
    private class RemainingApiResponse
    {
        public SlotData data;
        public bool error;
        public string message;
        public int code;
    }

    [System.Serializable]
    private class SlotData
    {
        public string slotId;
        public string numberId;
        public int number;
        public int bet;
        public bool selected;
    }
}
