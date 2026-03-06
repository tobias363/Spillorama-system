using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Networking;
using SimpleJSON;
using TMPro;

public partial class APIManager : MonoBehaviour
{
    private enum TicketUiState
    {
        normal = 0,
        nearWin = 1,
        won = 2
    }

    private struct RealtimeDrawRenderItem
    {
        public string GameId;
        public int DrawIndex;
        public int DrawnNumber;
    }

    private struct RealtimeNearWinMeta
    {
        public int PatternIndex;
        public int CellIndex;
        public int CardNo;
        public int MissingNumber;
    }

    public static APIManager instance;

    private const string BASE_URL = "https://bingoapi.codehabbit.com/";
    private const string DEFAULT_REALTIME_BACKEND_BASE_URL = "https://bingosystem-3.onrender.com";

    [Header("Realtime Multiplayer (Skeleton backend)")]
    [SerializeField] private bool useRealtimeBackend = true;
    [SerializeField] private BingoRealtimeClient realtimeClient;
    [SerializeField] private BingoAutoLogin autoLogin;
    [SerializeField] private bool joinOrCreateOnStart = true;
    [SerializeField] private bool autoCreateRoomWhenRoomCodeIsEmpty = true;
    [SerializeField] private bool autoMarkDrawnNumbers = true;
    [SerializeField] private bool duplicateTicketAcrossAllCards = true;
    [SerializeField] private bool enableTicketPaging = true;
    [SerializeField] private bool preserveTicketNumbersOnTransientSnapshotGaps = true;
    [SerializeField] private bool triggerAutoLoginWhenAuthMissing = true;
    [SerializeField] private bool logBootstrapEvents = false;
    [SerializeField] private bool logRealtimeLifecycleEvents = true;
    [SerializeField] private bool playButtonStartsAndDrawsRealtime = true;
    [SerializeField] private bool realtimeScheduledRounds = true;
    [SerializeField] private bool drawImmediatelyAfterManualStart = true;
    [SerializeField] private bool allowEditorLocalFallbackWhenRealtimeUnavailable = true;
    [SerializeField] private bool scheduledModeManualStartFallback = false;
    [SerializeField] [Min(0.5f)] private float scheduledRoomStateHeartbeatSeconds = 2f;
    [SerializeField] private bool syncRealtimeEntryFeeWithBetSelector = true;
    [SerializeField] private bool fallbackToZeroEntryFeeOnInsufficientFunds = false;
    [SerializeField] private bool disableEntryFeeSyncAfterInsufficientFundsFallback = false;
    [SerializeField] [Min(1f)] private float insufficientFundsRetryDelaySeconds = 6f;
    [SerializeField] private bool centerRealtimeCountdownUnderBalls = true;
    [SerializeField] private Vector2 realtimeCountdownOffset = new Vector2(0f, -155f);
    [SerializeField] [Range(1f, 2f)] private float realtimeCountdownWidthMultiplier = 1.3f;
    [SerializeField] [Range(0.15f, 0.6f)] private float realtimeCountdownMinParentWidthRatio = 0.3f;
    [SerializeField] [Min(120f)] private float realtimeCountdownMinWidth = 240f;
    [SerializeField] [Min(0f)] private float realtimeCountdownEdgePadding = 32f;
    [SerializeField] [Range(0.1f, 0.6f)] private float realtimeNearWinBlinkInterval = 0.25f;
    [SerializeField] [Min(0)] private int realtimeBonusPatternIndex = 1;
    [SerializeField] [Range(1, 5)] private int realtimeTicketsPerPlayer = 4;
    [SerializeField] private int realtimeEntryFee = 0;
    [SerializeField] [Min(1)] private int realtimeClientMaxDrawsPerRound = 30;
    [SerializeField] [Min(1)] private int realtimeDefaultBonusAmount = 150;
    [SerializeField] [Min(0f)] private float realtimeRoundOverlayResetDelaySeconds = 10f;
    [SerializeField] [Min(0.1f)] private float realtimeDrawResyncIntervalSeconds = 0.75f;
    [SerializeField] [Min(0.02f)] private float realtimeDrawReplayMinIntervalSeconds = 0.06f;
    [SerializeField] [Min(0.05f)] private float realtimeDrawReplayNormalIntervalSeconds = 0.28f;
    [SerializeField] [Min(1)] private int realtimeDrawBacklogCatchupThreshold = 4;
    [SerializeField] private bool logRealtimeDrawMetrics = true;
    [SerializeField] [Min(1)] private int realtimeBonusPatternPositionFromRight = 2;
    [SerializeField] private bool enableLaunchTokenBootstrap = true;
    [SerializeField] private string launchResolveBaseUrl = "https://bingosystem-3.onrender.com";
    [SerializeField] private BallManager ballManager;
    [Header("Realtime UI")]
    [SerializeField] private TextMeshProUGUI realtimeRoomPlayerCountText;
    [SerializeField] private string realtimeRoomPlayerCountPrefix = "Spillere i rommet:";
    [SerializeField] private Vector2 realtimeRoomPlayerCountOffset = new Vector2(0f, -208f);
    [SerializeField] [Min(140f)] private float realtimeRoomPlayerCountMinWidth = 220f;
    [SerializeField] private string roomCode = "";
    [SerializeField] private string hallId = "";
    [SerializeField] private string playerName = "Player";
    [SerializeField] private string walletId = "";
    [SerializeField] private string accessToken = "";
    [SerializeField] private string realtimeBackendBaseUrl = DEFAULT_REALTIME_BACKEND_BASE_URL;

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
    private int renderedDrawCount = 0;
    private int currentTicketPage = 0;
    private List<List<int>> activeTicketSets = new();
    private List<List<int>> cachedStableTicketSets = new();
    private bool realtimeBonusTriggeredForActiveGame = false;
    private bool isJoinOrCreatePending = false;
    private bool pendingJoinOrCreateAfterLaunchResolve = false;
    private float joinOrCreateIssuedAtRealtime = -1f;
    private float nextCountdownRefreshAt = -1f;
    private float nextScheduledRoomStateRefreshAt = -1f;
    private float nextScheduledManualStartAttemptAt = -1f;
    private float nextScheduledHeartbeatAt = -1f;
    private float nextInsufficientFundsWarningAt = -1f;
    private float nextDrawResyncAt = -1f;
    private string lastSchedulerObservationKey = string.Empty;
    private Coroutine delayedOverlayResetCoroutine;
    private string delayedOverlayResetGameId = string.Empty;
    private string overlaysClearedForEndedGameId = string.Empty;
    private readonly RealtimeSchedulerState realtimeScheduler = new();
    private readonly RealtimeCountdownPresenter realtimeCountdownPresenter = new();
    private readonly RealtimeRoomConfigurator realtimeRoomConfigurator = new();
    private readonly Dictionary<int, Coroutine> realtimeNearWinBlinkCoroutines = new();
    private readonly Dictionary<int, RealtimeNearWinMeta> realtimeNearWinMetaByKey = new();
    private string realtimeBonusTriggeredGameId = string.Empty;
    private string realtimeBonusTriggeredClaimId = string.Empty;
    private string realtimeBonusMissingDataLogKey = string.Empty;
    private bool hasAppliedZeroEntryFeeFallbackForRoom = false;
    private readonly Queue<RealtimeDrawRenderItem> pendingRealtimeDrawQueue = new();
    private readonly HashSet<string> pendingRealtimeDrawKeys = new();
    private Coroutine realtimeDrawReplayCoroutine;
    private float lastRealtimeDrawRenderAt = -1f;
    private int drawMetricEnqueued = 0;
    private int drawMetricRendered = 0;
    private int drawMetricFallbackRendered = 0;
    private int drawMetricSkipped = 0;
    private string drawMetricsGameId = string.Empty;
    private bool realtimeBetArmedForNextRound = false;
    private bool pendingRealtimeBetArmRequest = false;
    private bool realtimeRerollRequestPending = false;
    private readonly HashSet<string> realtimeClaimAttemptKeys = new();
    private bool hasTriggeredEditorLocalFallback = false;

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
        // V4 policy: aldri fall tilbake til gratis buy-in ved INSUFFICIENT_FUNDS.
        fallbackToZeroEntryFeeOnInsufficientFunds = false;
        disableEntryFeeSyncAfterInsufficientFundsFallback = false;
        // V4 policy: server-scheduler er autoritativ for rundestart i realtime.
        scheduledModeManualStartFallback = false;
        realtimeBackendBaseUrl = NormalizeRealtimeBackendBaseUrl(realtimeBackendBaseUrl);
    }

    void OnEnable()
    {
        hasTriggeredEditorLocalFallback = false;
        if (useRealtimeBackend)
        {
            BindRealtimeClient();
        }
    }

    void OnDisable()
    {
        StopRealtimeNearWinBlinking();
        ResetRealtimeBonusState(closeBonusPanel: true);
        ResetRealtimeDrawReplayState(clearMetrics: true);

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
            StartCoroutine(BootstrapRealtimeStartupRoutine());
            return;
        }

        if (legacyStartCallEnabled)
        {
            CallApisForFetchData();
        }
    }

    private IEnumerator BootstrapRealtimeStartupRoutine()
    {
        yield return ResolveLaunchContextFromUrlIfPresent();

        if (!joinOrCreateOnStart)
        {
            yield break;
        }

        if (NeedsAuthBootstrap())
        {
            TryStartAutoLogin("Oppstart uten accessToken/hallId.");
            yield break;
        }

        JoinOrCreateRoom();
    }

    void Update()
    {
        if (!useRealtimeBackend)
        {
            return;
        }

        TickDrawRenderResync();
        TryRunDeferredJoinOrCreateAfterLaunchResolve();

        if (!realtimeScheduledRounds)
        {
            return;
        }

        RefreshRealtimeCountdownLabel();
        TickScheduledRoundStateRefresh();
        TickScheduledRoomStateHeartbeat();
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
        realtimeClient.SetBackendBaseUrl(realtimeBackendBaseUrl);
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

    private bool ShowRealtimeDrawBall(int drawIndex, int drawnNumber)
    {
        BallManager resolved = ResolveBallManager();
        if (resolved == null)
        {
            return false;
        }

        return resolved.ShowRealtimeDrawBall(drawIndex, drawnNumber);
    }

    private int ResolveRealtimeDrawCountCap()
    {
        int schedulerCap = realtimeScheduler.DrawCapacity > 0
            ? realtimeScheduler.DrawCapacity
            : realtimeClientMaxDrawsPerRound;

        return Mathf.Max(1, Mathf.Min(realtimeClientMaxDrawsPerRound, schedulerCap));
    }

    private BingoAutoLogin ResolveAutoLogin()
    {
        if (autoLogin != null)
        {
            autoLogin.SetBackendBaseUrl(realtimeBackendBaseUrl);
            return autoLogin;
        }

        autoLogin = FindObjectOfType<BingoAutoLogin>();
        if (autoLogin != null)
        {
            autoLogin.SetBackendBaseUrl(realtimeBackendBaseUrl);
            return autoLogin;
        }

        GameObject autoLoginObject = new("BingoAutoLogin_Auto");
        autoLogin = autoLoginObject.AddComponent<BingoAutoLogin>();
        autoLogin.SetBackendBaseUrl(realtimeBackendBaseUrl);
        LogBootstrap("BingoAutoLogin manglet i scenen. Opprettet runtime auto-login med default credentials.");
        return autoLogin;
    }

    private bool TryStartAutoLogin(string reason)
    {
        if (!useRealtimeBackend || !triggerAutoLoginWhenAuthMissing)
        {
            return false;
        }

        if (CandyLaunchBootstrap.HasLaunchContextInUrl)
        {
            if (CandyLaunchBootstrap.IsResolvingLaunchContext)
            {
                LogBootstrap("Launch-resolve pågår. Hopper over auto-login fallback.");
            }
            else if (CandyLaunchBootstrap.HasLaunchResolveError)
            {
                Debug.LogError("[APIManager] Auto-login fallback blokkert fordi launch-resolve feilet: " + BuildLaunchResolveErrorSummary());
            }
            else
            {
                LogBootstrap("Launch-context aktiv. Auto-login fallback er deaktivert.");
            }
            return false;
        }

        BingoAutoLogin loginBootstrap = ResolveAutoLogin();
        if (loginBootstrap == null)
        {
            return false;
        }

        loginBootstrap.SetBackendBaseUrl(realtimeBackendBaseUrl);
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

        if (CandyLaunchBootstrap.HasLaunchContextInUrl)
        {
            return false;
        }

        return string.IsNullOrWhiteSpace((accessToken ?? string.Empty).Trim()) ||
               string.IsNullOrWhiteSpace((hallId ?? string.Empty).Trim());
    }

    private bool ShouldDeferRealtimeBootstrapForLaunchContext(string operation, bool markPendingForLater = false)
    {
        if (!CandyLaunchBootstrap.HasLaunchContextInUrl)
        {
            return false;
        }

        if (CandyLaunchBootstrap.IsResolvingLaunchContext)
        {
            if (markPendingForLater)
            {
                pendingJoinOrCreateAfterLaunchResolve = true;
            }

            if (!string.IsNullOrWhiteSpace(operation))
            {
                LogBootstrap($"Venter på launch-resolve før {operation}.");
            }
            return true;
        }

        if (CandyLaunchBootstrap.HasLaunchResolveError)
        {
            pendingJoinOrCreateAfterLaunchResolve = false;
            Debug.LogError("[APIManager] Launch-resolve feilet. " + BuildLaunchResolveErrorSummary());
            return true;
        }

        return false;
    }

    private void TryRunDeferredJoinOrCreateAfterLaunchResolve()
    {
        if (!pendingJoinOrCreateAfterLaunchResolve || !joinOrCreateOnStart)
        {
            return;
        }

        if (ShouldDeferRealtimeBootstrapForLaunchContext("utsatt oppstart"))
        {
            return;
        }

        pendingJoinOrCreateAfterLaunchResolve = false;
        if (NeedsAuthBootstrap())
        {
            if (!TryStartAutoLogin("Oppstart etter launch-resolve mangler accessToken/hallId."))
            {
                Debug.LogError("[APIManager] accessToken/hallId mangler etter launch-resolve.");
            }
            return;
        }

        JoinOrCreateRoom();
    }

    private static string BuildLaunchResolveErrorSummary()
    {
        string code = (CandyLaunchBootstrap.LastLaunchErrorCode ?? string.Empty).Trim();
        string message = (CandyLaunchBootstrap.LastLaunchErrorMessage ?? string.Empty).Trim();

        if (!string.IsNullOrWhiteSpace(code) && !string.IsNullOrWhiteSpace(message))
        {
            return $"{code}: {message}";
        }

        if (!string.IsNullOrWhiteSpace(message))
        {
            return message;
        }

        if (!string.IsNullOrWhiteSpace(code))
        {
            return code;
        }

        return "Ukjent launch-feil.";
    }

    private void LogBootstrap(string message)
    {
        if (!logBootstrapEvents)
        {
            return;
        }

        Debug.Log("[APIManager] " + message);
    }

    private void LogRealtimeLifecycleEvent(string eventName, string details)
    {
        if (!logRealtimeLifecycleEvents)
        {
            return;
        }

        string resolvedDetails = string.IsNullOrWhiteSpace(details) ? string.Empty : " " + details.Trim();
        Debug.Log($"[candy-observe] {eventName}{resolvedDetails}");
    }

    private void LogSchedulerSnapshotIfChanged(string source)
    {
        if (!logRealtimeLifecycleEvents)
        {
            return;
        }

        string nextStartAt =
            realtimeScheduler.NextScheduledRoundStartAtMs > 0
                ? DateTimeOffset.FromUnixTimeMilliseconds(realtimeScheduler.NextScheduledRoundStartAtMs).ToString("o")
                : "none";
        string key =
            $"{realtimeScheduler.SchedulerEnabled}|{realtimeScheduler.MinPlayers}|{realtimeScheduler.ArmedPlayerCount}|" +
            $"{realtimeScheduler.PlayerCount}|{realtimeScheduler.CanStartNow}|{nextStartAt}|{realtimeScheduler.LatestGameStatus}";
        if (string.Equals(lastSchedulerObservationKey, key, StringComparison.Ordinal))
        {
            return;
        }

        lastSchedulerObservationKey = key;
        LogRealtimeLifecycleEvent(
            "scheduler_snapshot",
            $"source={source} enabled={realtimeScheduler.SchedulerEnabled} nextStartAt={nextStartAt} " +
            $"armed={realtimeScheduler.ArmedPlayerCount} minPlayers={realtimeScheduler.MinPlayers} " +
            $"playerCount={realtimeScheduler.PlayerCount} canStartNow={realtimeScheduler.CanStartNow} " +
            $"status={realtimeScheduler.LatestGameStatus}");
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

    public void ConfigureBackendBaseUrl(string newBackendBaseUrl)
    {
        string normalized = NormalizeAbsoluteHttpUrlForRuntime(newBackendBaseUrl, launchResolveBaseUrl);
        if (string.IsNullOrWhiteSpace(normalized))
        {
            normalized = NormalizeRealtimeBackendBaseUrl(newBackendBaseUrl);
        }
        if (string.IsNullOrWhiteSpace(normalized))
        {
            return;
        }

        realtimeBackendBaseUrl = normalized;
        launchResolveBaseUrl = normalized;

        if (realtimeClient != null)
        {
            realtimeClient.SetBackendBaseUrl(realtimeBackendBaseUrl);
        }

        BingoAutoLogin login = autoLogin != null ? autoLogin : ResolveAutoLogin();
        if (login != null)
        {
            login.SetBackendBaseUrl(realtimeBackendBaseUrl);
        }
    }

    public void ApplyLaunchRuntimeContext(
        string newBackendBaseUrl,
        string token,
        string newHallId,
        string newPlayerName,
        string newWalletId)
    {
        ConfigureBackendBaseUrl(newBackendBaseUrl);
        ConfigureAccessToken(token);
        ConfigureHall(newHallId);
        ConfigurePlayer(newPlayerName, newWalletId);
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

    private IEnumerator ResolveLaunchContextFromUrlIfPresent()
    {
        if (!enableLaunchTokenBootstrap)
        {
            yield break;
        }

        string absoluteUrl = Application.absoluteURL;
        if (!TryExtractLaunchTokenFromAbsoluteUrl(absoluteUrl, out string launchToken))
        {
            yield break;
        }

        string launchUrlForLog = absoluteUrl;
        if (Uri.TryCreate(absoluteUrl, UriKind.Absolute, out Uri launchUriForLog))
        {
            launchUrlForLog = launchUriForLog.GetLeftPart(UriPartial.Path);
        }
        LogRealtimeLifecycleEvent("launch_token_detected", $"sourceUrl={launchUrlForLog}");

        string resolveBaseUrl = ResolveLaunchApiBaseUrlFromAbsoluteUrl(absoluteUrl);
        if (string.IsNullOrWhiteSpace(resolveBaseUrl))
        {
            Debug.LogError("[APIManager] Fant ikke gyldig base URL for launch-resolve.");
            LogRealtimeLifecycleEvent("launch_resolve_failed", "reason=invalid_base_url");
            yield break;
        }

        string endpoint = resolveBaseUrl + "/api/games/candy/launch-resolve";
        LogRealtimeLifecycleEvent("launch_resolve_request", $"endpoint={endpoint}");
        JSONObject payload = new();
        payload["launchToken"] = launchToken;

        using UnityWebRequest request = new UnityWebRequest(endpoint, UnityWebRequest.kHttpVerbPOST);
        byte[] body = System.Text.Encoding.UTF8.GetBytes(payload.ToString());
        request.uploadHandler = new UploadHandlerRaw(body);
        request.downloadHandler = new DownloadHandlerBuffer();
        request.SetRequestHeader("Content-Type", "application/json");

        yield return request.SendWebRequest();

        if (request.result != UnityWebRequest.Result.Success)
        {
            Debug.LogError("[APIManager] launch-resolve feilet: " + BuildTransportError(request));
            LogRealtimeLifecycleEvent("launch_resolve_failed", $"reason=transport status={request.responseCode}");
            yield break;
        }

        JSONNode root = SafeParseJsonNode(request.downloadHandler.text);
        if (root == null)
        {
            Debug.LogError("[APIManager] launch-resolve returnerte ugyldig JSON.");
            LogRealtimeLifecycleEvent("launch_resolve_failed", "reason=invalid_json");
            yield break;
        }

        bool ok = root["ok"] == null || root["ok"].AsBool;
        if (!ok)
        {
            string code = FirstNonEmptyValue(root["error"]?["code"], "INVALID_LAUNCH_TOKEN");
            string message = FirstNonEmptyValue(root["error"]?["message"], "Ukjent launch-resolve-feil.");
            Debug.LogError($"[APIManager] launch-resolve avvist ({code}): {message}");
            LogRealtimeLifecycleEvent("launch_resolve_failed", $"reason=api_error code={code}");
            yield break;
        }

        JSONNode data = root["data"];
        if (data == null || data.IsNull)
        {
            Debug.LogError("[APIManager] launch-resolve mangler data.");
            LogRealtimeLifecycleEvent("launch_resolve_failed", "reason=missing_data");
            yield break;
        }

        string resolvedApiBaseUrl = NormalizeAbsoluteHttpUrlForRuntime(
            FirstNonEmptyValue(data["apiBaseUrl"], resolveBaseUrl),
            resolveBaseUrl);
        ConfigureBackendBaseUrl(resolvedApiBaseUrl);

        string resolvedAccessToken = FirstNonEmptyValue(data["accessToken"], accessToken);
        string resolvedHallId = FirstNonEmptyValue(data["hallId"], hallId);
        string resolvedPlayerName = FirstNonEmptyValue(data["playerName"], playerName);
        string resolvedWalletId = FirstNonEmptyValue(data["walletId"], walletId);

        ConfigureAccessToken(resolvedAccessToken);
        ConfigureHall(resolvedHallId);
        ConfigurePlayer(resolvedPlayerName, resolvedWalletId);
        LogRealtimeLifecycleEvent(
            "launch_resolve_ok",
            $"hallId={resolvedHallId} walletId={resolvedWalletId} apiBaseUrl={resolvedApiBaseUrl}");

        if (logBootstrapEvents)
        {
            Debug.Log($"[APIManager] Launch bootstrap OK. hall={resolvedHallId}, player={resolvedPlayerName}, wallet={resolvedWalletId}");
        }
    }

    private string ResolveLaunchApiBaseUrlFromAbsoluteUrl(string absoluteUrl)
    {
        if (TryExtractUrlParamFromAbsoluteUrl(absoluteUrl, "apiBaseUrl", out string apiBaseFromUrl) ||
            TryExtractUrlParamFromAbsoluteUrl(absoluteUrl, "apiBase", out apiBaseFromUrl))
        {
            return NormalizeAbsoluteHttpUrlForRuntime(apiBaseFromUrl, launchResolveBaseUrl);
        }

        if (realtimeClient != null && !string.IsNullOrWhiteSpace(realtimeClient.BackendBaseUrl))
        {
            return NormalizeAbsoluteHttpUrlForRuntime(realtimeClient.BackendBaseUrl, launchResolveBaseUrl);
        }

        BingoAutoLogin login = autoLogin != null ? autoLogin : FindObjectOfType<BingoAutoLogin>();
        if (login != null && !string.IsNullOrWhiteSpace(login.BackendBaseUrl))
        {
            return NormalizeAbsoluteHttpUrlForRuntime(login.BackendBaseUrl, launchResolveBaseUrl);
        }

        return NormalizeAbsoluteHttpUrlForRuntime(launchResolveBaseUrl, "https://bingosystem-3.onrender.com");
    }

    private static bool TryExtractLaunchTokenFromAbsoluteUrl(string absoluteUrl, out string launchToken)
    {
        if (TryExtractUrlParamFromAbsoluteUrl(absoluteUrl, "lt", out launchToken))
        {
            return !string.IsNullOrWhiteSpace(launchToken);
        }

        launchToken = string.Empty;
        return false;
    }

    private static bool TryExtractUrlParamFromAbsoluteUrl(string absoluteUrl, string key, out string value)
    {
        value = string.Empty;
        if (string.IsNullOrWhiteSpace(absoluteUrl) || string.IsNullOrWhiteSpace(key))
        {
            return false;
        }

        string trimmedKey = key.Trim();
        if (Uri.TryCreate(absoluteUrl, UriKind.Absolute, out Uri uri))
        {
            string queryValue = ParseFormEncodedKey(uri.Query, trimmedKey);
            if (!string.IsNullOrWhiteSpace(queryValue))
            {
                value = queryValue;
                return true;
            }
        }

        int hashIndex = absoluteUrl.IndexOf('#');
        if (hashIndex >= 0 && hashIndex + 1 < absoluteUrl.Length)
        {
            string fragmentValue = ParseFormEncodedKey(absoluteUrl.Substring(hashIndex + 1), trimmedKey);
            if (!string.IsNullOrWhiteSpace(fragmentValue))
            {
                value = fragmentValue;
                return true;
            }
        }

        return false;
    }

    private static string ParseFormEncodedKey(string rawSection, string key)
    {
        if (string.IsNullOrWhiteSpace(rawSection) || string.IsNullOrWhiteSpace(key))
        {
            return string.Empty;
        }

        string section = rawSection.Trim();
        if (section.StartsWith("?") || section.StartsWith("#"))
        {
            section = section.Substring(1);
        }

        if (section.Length == 0)
        {
            return string.Empty;
        }

        string[] pairs = section.Split('&');
        for (int i = 0; i < pairs.Length; i++)
        {
            string pair = pairs[i];
            if (string.IsNullOrWhiteSpace(pair))
            {
                continue;
            }

            int separatorIndex = pair.IndexOf('=');
            string rawKey = separatorIndex >= 0 ? pair.Substring(0, separatorIndex) : pair;
            if (!string.Equals(Uri.UnescapeDataString(rawKey), key, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            string rawValue = separatorIndex >= 0 && separatorIndex + 1 < pair.Length
                ? pair.Substring(separatorIndex + 1)
                : string.Empty;
            string decoded = Uri.UnescapeDataString(rawValue.Replace('+', ' ')).Trim();
            return decoded;
        }

        return string.Empty;
    }

    private static string NormalizeAbsoluteHttpUrlForRuntime(string value, string fallback)
    {
        string candidate = FirstNonEmptyValue(value, fallback);
        if (string.IsNullOrWhiteSpace(candidate))
        {
            return string.Empty;
        }

        if (!candidate.StartsWith("http://", StringComparison.OrdinalIgnoreCase) &&
            !candidate.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
        {
            candidate = "https://" + candidate;
        }

        if (!Uri.TryCreate(candidate, UriKind.Absolute, out Uri uri))
        {
            return string.Empty;
        }

        string scheme = uri.Scheme.ToLowerInvariant();
        if (scheme != "http" && scheme != "https")
        {
            return string.Empty;
        }

        return candidate.TrimEnd('/');
    }

    private static string FirstNonEmptyValue(params string[] values)
    {
        if (values == null)
        {
            return string.Empty;
        }

        for (int i = 0; i < values.Length; i++)
        {
            string candidate = values[i];
            if (!string.IsNullOrWhiteSpace(candidate))
            {
                return candidate.Trim();
            }
        }

        return string.Empty;
    }

    private static JSONNode SafeParseJsonNode(string jsonText)
    {
        if (string.IsNullOrWhiteSpace(jsonText))
        {
            return null;
        }

        try
        {
            return JSON.Parse(jsonText);
        }
        catch
        {
            return null;
        }
    }

    private static string BuildTransportError(UnityWebRequest request)
    {
        string status = request.responseCode > 0 ? $"HTTP {request.responseCode}" : "No HTTP status";
        string body = request.downloadHandler != null ? request.downloadHandler.text : string.Empty;
        string error = string.IsNullOrWhiteSpace(request.error) ? "Ukjent transportfeil." : request.error;
        if (!string.IsNullOrWhiteSpace(body))
        {
            return $"{status}: {error}. Body: {body}";
        }

        return $"{status}: {error}";
    }

    public void SetRoomCode(string newRoomCode)
    {
        roomCode = (newRoomCode ?? string.Empty).Trim().ToUpperInvariant();
    }

    public void SetRealtimeEntryFeeFromGameUI(int entryFee)
    {
        realtimeEntryFee = Mathf.Max(0, entryFee);
        if (realtimeEntryFee > 0)
        {
            hasAppliedZeroEntryFeeFallbackForRoom = false;
        }

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
        if (realtimeEntryFee > 0)
        {
            hasAppliedZeroEntryFeeFallbackForRoom = false;
        }
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
        LogSchedulerSnapshotIfChanged("room-update");
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
        RefreshRealtimeRoomPlayerCountLabel();
    }

    private void EnsureRealtimeRoomPlayerCountLabel()
    {
        if (!useRealtimeBackend || realtimeRoomPlayerCountText != null)
        {
            return;
        }

        NumberGenerator generator = GameManager.instance?.numberGenerator;
        if (generator == null || generator.autoSpinRemainingPlayText == null)
        {
            return;
        }

        RectTransform countdownRect = generator.autoSpinRemainingPlayText.rectTransform;
        RectTransform parentRect = countdownRect != null ? countdownRect.parent as RectTransform : null;
        if (parentRect == null)
        {
            return;
        }

        GameObject labelObject = new("RealtimeRoomPlayerCountText");
        labelObject.transform.SetParent(parentRect, false);
        RectTransform rect = labelObject.AddComponent<RectTransform>();
        rect.anchorMin = countdownRect.anchorMin;
        rect.anchorMax = countdownRect.anchorMax;
        rect.pivot = countdownRect.pivot;
        rect.anchoredPosition = countdownRect.anchoredPosition + realtimeRoomPlayerCountOffset;
        rect.sizeDelta = new Vector2(
            Mathf.Max(realtimeRoomPlayerCountMinWidth, countdownRect.rect.width),
            Mathf.Max(30f, countdownRect.rect.height * 0.52f));

        TextMeshProUGUI label = labelObject.AddComponent<TextMeshProUGUI>();
        label.alignment = TextAlignmentOptions.Center;
        label.enableAutoSizing = true;
        label.fontSizeMin = 16f;
        label.fontSizeMax = 30f;
        label.fontSize = Mathf.Max(18f, generator.autoSpinRemainingPlayText.fontSize * 0.42f);
        label.color = generator.autoSpinRemainingPlayText.color;
        if (generator.autoSpinRemainingPlayText.font != null)
        {
            label.font = generator.autoSpinRemainingPlayText.font;
        }

        realtimeRoomPlayerCountText = label;
    }

    private void RefreshRealtimeRoomPlayerCountLabel()
    {
        EnsureRealtimeRoomPlayerCountLabel();
        if (realtimeRoomPlayerCountText == null)
        {
            return;
        }

        int playerCount = Mathf.Max(0, realtimeScheduler.PlayerCount);
        realtimeRoomPlayerCountText.text = $"{realtimeRoomPlayerCountPrefix} {playerCount}";
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

    private void TickScheduledRoomStateHeartbeat()
    {
        if (Time.unscaledTime < nextScheduledHeartbeatAt)
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

        float waitingInterval = Mathf.Max(0.5f, scheduledRoomStateHeartbeatSeconds);
        float runningInterval = Mathf.Max(waitingInterval, waitingInterval * 2f);
        nextScheduledHeartbeatAt = Time.unscaledTime + (realtimeScheduler.IsGameRunning ? runningInterval : waitingInterval);

        realtimeClient.RequestRoomState(activeRoomCode, HandleScheduledPlayRoomStateAck);
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

        if (ShouldDeferRealtimeBootstrapForLaunchContext("join/create"))
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
            if (CandyLaunchBootstrap.HasLaunchContextInUrl)
            {
                Debug.LogError("[APIManager] Launch-resolve returnerte ikke accessToken. Avbryter realtime oppstart.");
                return;
            }

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
            if (CandyLaunchBootstrap.HasLaunchContextInUrl)
            {
                Debug.LogError("[APIManager] Launch-resolve returnerte ikke hallId. Avbryter realtime oppstart.");
                return;
            }

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
            LogRealtimeLifecycleEvent("room_join_or_create_failed", "reason=ack_null");
            return;
        }

        if (!ack.ok)
        {
            LogRealtimeLifecycleEvent(
                "room_join_or_create_failed",
                $"code={ack.errorCode} message={ack.errorMessage}");
            if (string.Equals(ack.errorCode, "HALL_NOT_FOUND", StringComparison.OrdinalIgnoreCase))
            {
                Debug.LogWarning("[APIManager] hallId er ugyldig i backend. Nullstiller hallId og forsoker auto-login for oppfriskning.");
                ConfigureHall(string.Empty);
                TryStartAutoLogin("Ugyldig hallId ved room:create/join.");
                return;
            }

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
            LogRealtimeLifecycleEvent("room_join_or_create_failed", "reason=missing_data");
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

        LogRealtimeLifecycleEvent(
            "room_join_or_create_ack",
            $"roomCode={activeRoomCode} playerId={activePlayerId}");
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

        if (ShouldDeferRealtimeBootstrapForLaunchContext("room:state"))
        {
            return;
        }

        BindRealtimeClient();
        if (realtimeClient == null)
        {
            TryRunEditorLocalRoundFallback("realtimeClient mangler");
            return;
        }

        string desiredAccessToken = (accessToken ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(desiredAccessToken))
        {
            if (CandyLaunchBootstrap.HasLaunchContextInUrl)
            {
                Debug.LogError("[APIManager] Launch-resolve returnerte ikke accessToken. Kan ikke hente room:state.");
                TryRunEditorLocalRoundFallback("launch-resolve mangler accessToken");
                return;
            }

            if (!TryStartAutoLogin("accessToken mangler. Login kreves for realtime gameplay."))
            {
                Debug.LogError("[APIManager] accessToken mangler. Login kreves for realtime gameplay.");
                TryRunEditorLocalRoundFallback("accessToken mangler og auto-login utilgjengelig");
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
                TryRunEditorLocalRoundFallback($"room:state feilet ({ack?.errorCode})");
                return;
            }

            JSONNode snapshot = ack.data?["snapshot"];
            if (snapshot != null && !snapshot.IsNull)
            {
                HandleRealtimeRoomUpdate(snapshot);
            }
        });
    }

    private bool TryRunEditorLocalRoundFallback(string reason)
    {
#if UNITY_EDITOR
        if (!allowEditorLocalFallbackWhenRealtimeUnavailable || hasTriggeredEditorLocalFallback)
        {
            return false;
        }

        if (!Application.isPlaying)
        {
            return false;
        }

        NumberGenerator generator = GameManager.instance != null ? GameManager.instance.numberGenerator : null;
        if (generator == null)
        {
            return false;
        }

        if (generator.generatedNO != null && generator.generatedNO.Count > 0)
        {
            return false;
        }

        hasTriggeredEditorLocalFallback = true;
        Debug.LogWarning(
            $"[APIManager] Realtime utilgjengelig i editor ({reason}). " +
            "Starter lokal fallback-runde via NumberGenerator.PlaceBallAsPerFetch().");
        generator.PlaceBallAsPerFetch();
        return true;
#else
        return false;
#endif
    }

    private static string NormalizeRealtimeBackendBaseUrl(string rawBaseUrl)
    {
        string normalized = (rawBaseUrl ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(normalized))
        {
            normalized = DEFAULT_REALTIME_BACKEND_BASE_URL;
        }

        if (!normalized.StartsWith("http://", StringComparison.OrdinalIgnoreCase) &&
            !normalized.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
        {
            normalized = "https://" + normalized;
        }

        return normalized.TrimEnd('/');
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
                NumberManager numberManager = NumberManager.instance;
                NumberGenerator numberGenerator = GameManager.instance.numberGenerator;

                foreach (SlotData slotData in slotDataList)
                {
                    if (slotData.bet == currentBet)
                    {
                        int fetchNo = GameManager.instance.betlevel + 1;
                        int resolvedPatternNumber = slotData.number;

                        if (fetchNo != 0)
                        {
                            fetchNo = slotData.number / fetchNo;
                            Debug.Log("Original Fetched number: " + slotData.number);
                            resolvedPatternNumber = fetchNo;
                        }
                        else
                        {
                            Debug.Log("Fetched number: " + slotData.number);
                            Debug.Log("GameManager.instance.betlevel is zero. Division by zero is not allowed.");
                        }

                        if (fetchNo > 150)
                        {
                            Debug.Log("Bonus Is Present :::");
                            resolvedPatternNumber = 150;

                            int bonus = fetchNo - 150;
                            bonusAMT = bonus;
                            Debug.Log("Bonus Is Present ::: " + bonus);
                        }

                        if (numberManager != null)
                        {
                            numberManager.num = resolvedPatternNumber;
                            numberManager.DoAvailablePattern();
                        }
                        else if (numberGenerator != null)
                        {
                            Debug.LogWarning("[APIManager] NumberManager mangler i scenen. Starter runde med NumberGenerator fallback.");
                            numberGenerator.PlaceBallAsPerFetch();
                        }
                        else
                        {
                            Debug.LogError("[APIManager] Mangler både NumberManager og NumberGenerator. Kan ikke starte runde.");
                        }

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
