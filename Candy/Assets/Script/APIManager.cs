using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Networking;
using UnityEngine.UI;
using SimpleJSON;
using TMPro;

public partial class APIManager : MonoBehaviour
{
    private enum Theme1RealtimeViewMode
    {
        LegacyOnly = 0,
        DualRunCompare = 1,
        DedicatedOnly = 2
    }

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
    private const string DEFAULT_REALTIME_BACKEND_BASE_URL = "https://bingosystem-staging.onrender.com";
    private const string PRODUCTION_REALTIME_BACKEND_BASE_URL = "https://bingosystem-3.onrender.com";
    private const bool ALLOW_DIRECT_PRODUCTION_BACKEND = false;

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
    [SerializeField] [Min(0.25f)] private float betArmAckTimeoutSeconds = 1.5f;
    [SerializeField] private bool enableHttpBetArmFallback = true;
    [SerializeField] [Min(0.25f)] private float betArmHttpFallbackCooldownSeconds = 1.25f;
    [SerializeField] private bool allowEditorLocalFallbackWhenRealtimeUnavailable = false;
    [SerializeField] private bool allowEditorRuntimeAutoCreateRealtimeClient = true;
    [SerializeField] private bool allowEditorRuntimeAutoCreateAutoLogin = true;
    [SerializeField] private bool enableEditorLocalRoundFallback = false;
    [SerializeField] private bool strictRuntimeDependencyValidation = true;
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
    [SerializeField] private bool logRealtimeDrawTrace = true;
    [SerializeField] [Min(1)] private int realtimeBonusPatternPositionFromRight = 2;
    [SerializeField] private Theme1RealtimeViewMode theme1RealtimeViewMode = Theme1RealtimeViewMode.DualRunCompare;
    [SerializeField] private Theme1GameplayViewRoot theme1GameplayViewRoot;
    [SerializeField] private NumberGenerator theme1NumberGenerator;
    [SerializeField] private GameManager theme1GameManager;
    [SerializeField] private TopperManager theme1TopperManager;
    [SerializeField] private string launchResolveBaseUrl = DEFAULT_REALTIME_BACKEND_BASE_URL;
    [SerializeField] private BallManager ballManager;
    [Header("Runtime diagnostics")]
    [SerializeField] private bool logRuntimeDiagnostics = true;
    [SerializeField] [Min(2f)] private float runtimeDiagnosticsLogIntervalSeconds = 8f;
    [SerializeField] private bool showRealtimeDebugOverlayInEditor = true;
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
    private readonly HashSet<long> realtimeMatchedPatternIndexes = new();
    private readonly Dictionary<int, Coroutine> realtimeNearWinBlinkCoroutines = new();
    private readonly Dictionary<int, RealtimeNearWinMeta> realtimeNearWinMetaByKey = new();
    private readonly Dictionary<int, RealtimeNearWinState> realtimeNearWinStates = new();
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
    private bool desiredRealtimeBetArmedForNextRound = false;
    private bool realtimePlayerParticipatingInCurrentRound = false;
    private bool pendingRealtimeBetArmRequest = false;
    private bool treatBetArmAsUnsupported = false;
    private bool realtimeBetArmAwaitingAck = false;
    private float realtimeBetArmRequestedAt = -1f;
    private bool realtimeBetArmHttpFallbackInFlight = false;
    private float nextRealtimeBetArmHttpFallbackAt = -1f;
    private int realtimeBetArmMutationVersion = 0;
    private bool realtimeRerollRequestPending = false;
    private readonly HashSet<string> realtimeClaimAttemptKeys = new();
    private bool hasTriggeredEditorLocalFallback = false;
    private bool hasLoggedMissingRealtimeNumberGenerator = false;
    private float nextMissingRealtimeTicketsResyncAt = -1f;
    private float nextRuntimeDiagnosticsLogAt = 0f;
    private string lastRuntimeDiagnosticsSnapshot = string.Empty;
    private string lastPatternConfigurationIssue = string.Empty;
    private int lastObservedTicketSetCount = 0;
    private int lastRenderedCardCellCount = 0;
    private string lastRenderedCardTargetName = string.Empty;
    private string lastRenderedCardValue = string.Empty;
    private string lastRenderedCardHealth = string.Empty;
    private int lastObservedDrawCount = 0;
    private int lastObservedDrawNumber = 0;
    private int lastRenderedDrawNumber = 0;
    private int lastRenderedBallSlotIndex = -1;
    private string lastRenderedBallTargetName = string.Empty;
    private string lastRenderedBigBallTargetName = string.Empty;
    private string lastRenderedBallHealth = string.Empty;
    private string lastRenderedBigBallHealth = string.Empty;
    private string lastRenderedCountdownValue = string.Empty;
    private string lastRenderedPlayerCountValue = string.Empty;
    private string lastRenderedCountdownHealth = string.Empty;
    private string lastRenderedPlayerCountHealth = string.Empty;
    private string lastRealtimeRenderMismatch = string.Empty;
    private readonly Theme1RealtimeStateAdapter theme1RealtimeStateAdapter = new();
    private readonly Theme1LocalStateAdapter theme1LocalStateAdapter = new();
    private readonly Theme1DisplayPresenter theme1DisplayPresenter = new();
    private Theme1DisplayState preservedTheme1RoundDisplayState;
    private bool hasLoggedFirstRealtimeCardRender = false;
    private bool hasLoggedFirstRealtimeBallRender = false;
    private bool hasRenderedTheme1IdleState;
    private Action pendingRealtimePreRoundEditContinuation;
    private TextMeshProUGUI realtimeDebugOverlayText;
    private Image realtimeDebugOverlayBackground;

    public bool UseRealtimeBackend => useRealtimeBackend;
    public string ActiveRoomCode => activeRoomCode;
    public string ActivePlayerId => activePlayerId;
    public string ActiveHallId => hallId;
    public int CurrentTicketPage => currentTicketPage;
    public bool IsRealtimeRoundRunning => IsRealtimeDrawRunning;
    public bool IsRealtimeDrawRunning => useRealtimeBackend && realtimeScheduler.IsGameRunning;
    public bool IsActivePlayerParticipatingInRealtimeRound => useRealtimeBackend && realtimePlayerParticipatingInCurrentRound;
    public bool IsRealtimePlayerArmedForNextRound => useRealtimeBackend && realtimeBetArmedForNextRound;
    public bool UseDedicatedTheme1RealtimeView => useRealtimeBackend && theme1RealtimeViewMode != Theme1RealtimeViewMode.LegacyOnly;
    public bool HasRealtimeVisibleTickets =>
        useRealtimeBackend &&
        ((activeTicketSets != null && activeTicketSets.Count > 0) ||
         (cachedStableTicketSets != null && cachedStableTicketSets.Count > 0));
    public bool CanEditRealtimePreRoundSelection => useRealtimeBackend && !IsRealtimeDrawRunning;
    public bool CanParticipateInNextRealtimeRound =>
        useRealtimeBackend &&
        !IsRealtimeDrawRunning &&
        realtimeEntryFee > 0;
    public bool IsRealtimeBetLocked => IsRealtimeDrawRunning;
    public bool IsRealtimeRerollWindowOpen =>
        HasRealtimeVisibleTickets &&
        CanEditRealtimePreRoundSelection;

    public int TicketPageCount
    {
        get
        {
            int cardSlots = Mathf.Max(1, GetCardSlotsCount());
            int totalTickets = Mathf.Max(1, activeTicketSets != null ? activeTicketSets.Count : 0);
            return Mathf.Max(1, Mathf.CeilToInt((float)totalTickets / cardSlots));
        }
    }

    public int GetRealtimeVisibleCardCount()
    {
        if (!useRealtimeBackend)
        {
            return 0;
        }

        return Mathf.Clamp(Mathf.Max(1, realtimeTicketsPerPlayer), 1, Mathf.Max(1, GetCardSlotsCount()));
    }

    public int GetRealtimeTicketIndexForVisibleCard(int visibleCardIndex)
    {
        if (visibleCardIndex < 0)
        {
            return -1;
        }

        int visibleCardCount = GetRealtimeVisibleCardCount();
        if (visibleCardIndex >= visibleCardCount)
        {
            return -1;
        }

        return currentTicketPage * Mathf.Max(1, GetCardSlotsCount()) + visibleCardIndex;
    }

    void Awake()
    {
        instance = this;
        // V4 policy: aldri fall tilbake til gratis buy-in ved INSUFFICIENT_FUNDS.
        fallbackToZeroEntryFeeOnInsufficientFunds = false;
        disableEntryFeeSyncAfterInsufficientFundsFallback = false;
        realtimeBackendBaseUrl = NormalizeRealtimeBackendBaseUrl(realtimeBackendBaseUrl);
        launchResolveBaseUrl = NormalizeRealtimeBackendBaseUrl(launchResolveBaseUrl);
        if (theme1GameplayViewRoot == null)
        {
            theme1GameplayViewRoot = GetComponent<Theme1GameplayViewRoot>();
        }
#if UNITY_EDITOR
        if (!enableEditorLocalRoundFallback)
        {
            allowEditorLocalFallbackWhenRealtimeUnavailable = false;
        }
#else
        allowEditorLocalFallbackWhenRealtimeUnavailable = false;
#endif
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
        TryRenderTheme1IdleDisplayState();
        if (useRealtimeBackend)
        {
            ApplyExplicitRealtimeHudBindingsFromComponent();
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
        if (ShouldDeferRealtimeBootstrapForLaunchContext("oppstart", markPendingForLater: true))
        {
            yield break;
        }

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
            TryRenderTheme1LocalDisplayState();
            return;
        }

        if (!hasRenderedTheme1IdleState)
        {
            TryRenderTheme1IdleDisplayState();
        }

        TickDrawRenderResync();
        TryRunDeferredJoinOrCreateAfterLaunchResolve();
        TrySendPendingRealtimeBetArm();
        TickRealtimeBetArmTimeout();
        TickRuntimeDiagnostics();
        RefreshRealtimeDebugOverlay();

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
        ApplyExplicitRealtimeHudBindingsFromComponent();
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
            if (CanAutoCreateRealtimeClientInEditor())
            {
                GameObject clientObject = new("BingoRealtimeClient_Auto");
                realtimeClient = clientObject.AddComponent<BingoRealtimeClient>();
                LogBootstrap("BingoRealtimeClient manglet i scenen. Opprettet runtime-klient i editor-dev mode.");
            }
            else
            {
                ReportMissingRuntimeDependency(
                    "BingoRealtimeClient",
                    "Legg komponenten i Theme1 og bind den i APIManager før du tester realtime.");
                return;
            }
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

    public void ApplyExplicitRealtimeHudBindings(TextMeshProUGUI countdownText, TextMeshProUGUI roomPlayerCountLabel)
    {
        NumberGenerator generator = ResolveNumberGenerator();
        if (generator != null && countdownText != null)
        {
            generator.autoSpinRemainingPlayText = countdownText;
        }

        realtimeRoomPlayerCountText = roomPlayerCountLabel;
    }

    private void ApplyExplicitRealtimeHudBindingsFromComponent()
    {
        CandyTheme1HudBindingSet hudBindings = GetComponent<CandyTheme1HudBindingSet>();
        if (hudBindings == null)
        {
            return;
        }

        if (!hudBindings.TryApplyTo(
                ResolveNumberGenerator(),
                this,
                ResolveGameManager(),
                out string error))
        {
            PublishRuntimeStatus("HUD bindings er ugyldige i Theme1. " + error, asError: true);
            return;
        }

        ResolveGameManager()?.ReapplyTheme1HudState();
    }

    private bool CanAutoCreateRealtimeClientInEditor()
    {
#if UNITY_EDITOR
        return allowEditorRuntimeAutoCreateRealtimeClient;
#else
        return false;
#endif
    }

    private bool CanAutoCreateAutoLoginInEditor()
    {
#if UNITY_EDITOR
        return allowEditorRuntimeAutoCreateAutoLogin;
#else
        return false;
#endif
    }

    private void ReportMissingRuntimeDependency(string dependencyName, string remediation)
    {
        if (!strictRuntimeDependencyValidation)
        {
            return;
        }

        string message =
            $"[APIManager] Mangler runtime-avhengighet: {dependencyName}. {remediation}";
        Debug.LogError(message);
        BingoAutoLogin login = autoLogin != null ? autoLogin : FindObjectOfType<BingoAutoLogin>();
        if (login != null)
        {
            login.SetExternalStatus(message);
        }
    }

    private void PublishRuntimeStatus(string message, bool asError = false)
    {
        if (string.IsNullOrWhiteSpace(message))
        {
            return;
        }

        if (asError)
        {
            Debug.LogError("[APIManager] " + message);
        }
        else
        {
            Debug.LogWarning("[APIManager] " + message);
        }

        BingoAutoLogin login = autoLogin != null ? autoLogin : FindObjectOfType<BingoAutoLogin>();
        if (login != null)
        {
            login.SetExternalStatus(message);
        }
    }

    public void ReportLegacyVisualWriteAttempt(string source)
    {
        if (!useRealtimeBackend || string.IsNullOrWhiteSpace(source))
        {
            return;
        }

        ReportRealtimeRenderMismatch($"legacy writer attempted in realtime mode: {source}", asError: false);
    }

    public void ReportRealtimeRenderMismatch(string message, bool asError)
    {
        if (string.IsNullOrWhiteSpace(message))
        {
            return;
        }

        if (string.Equals(lastRealtimeRenderMismatch, message, StringComparison.Ordinal))
        {
            return;
        }

        lastRealtimeRenderMismatch = message;
        PublishRuntimeStatus(message, asError);
    }

    public void RegisterRealtimeTicketRender(int ticketSetCount, int renderedCardCellCount)
    {
        lastObservedTicketSetCount = Mathf.Max(0, ticketSetCount);
        lastRenderedCardCellCount = Mathf.Max(0, renderedCardCellCount);
        if (lastObservedTicketSetCount > 0 && lastRenderedCardCellCount <= 0)
        {
            ReportRealtimeRenderMismatch("tickets received but 0 rendered card labels", asError: true);
        }
    }

    public void RegisterRealtimeCardTarget(TextMeshProUGUI target)
    {
        lastRenderedCardTargetName = target != null && target.gameObject != null && !string.IsNullOrWhiteSpace(target.gameObject.name)
            ? target.gameObject.name.Trim()
            : "unknown-card-target";
        lastRenderedCardValue = target != null ? (target.text ?? string.Empty) : string.Empty;
        lastRenderedCardHealth = RealtimeTextStyleUtils.BuildHealthSummary(target);
        if (!hasLoggedFirstRealtimeCardRender && target != null && !string.IsNullOrWhiteSpace(lastRenderedCardValue))
        {
            hasLoggedFirstRealtimeCardRender = true;
            Debug.Log($"[candy-render] first-card target={lastRenderedCardTargetName} health={lastRenderedCardHealth}");
        }
    }

    public void RegisterRealtimeDrawObserved(int drawCount, int drawnNumber)
    {
        lastObservedDrawCount = Mathf.Max(0, drawCount);
        lastObservedDrawNumber = drawnNumber;
    }

    public void RegisterRealtimeBallRendered(
        int drawnNumber,
        int slotIndex,
        int renderedTextTargetCount,
        TextMeshProUGUI slotTarget,
        TextMeshProUGUI bigBallTarget)
    {
        lastRenderedDrawNumber = drawnNumber;
        lastRenderedBallSlotIndex = slotIndex;
        lastRenderedBallTargetName = slotTarget != null && slotTarget.gameObject != null && !string.IsNullOrWhiteSpace(slotTarget.gameObject.name)
            ? slotTarget.gameObject.name.Trim()
            : "unknown-ball-target";
        lastRenderedBigBallTargetName = bigBallTarget != null && bigBallTarget.gameObject != null && !string.IsNullOrWhiteSpace(bigBallTarget.gameObject.name)
            ? bigBallTarget.gameObject.name.Trim()
            : "unknown-big-ball-target";
        lastRenderedBallHealth = RealtimeTextStyleUtils.BuildHealthSummary(slotTarget);
        lastRenderedBigBallHealth = RealtimeTextStyleUtils.BuildHealthSummary(bigBallTarget);
        if (!hasLoggedFirstRealtimeBallRender && (slotTarget != null || bigBallTarget != null))
        {
            hasLoggedFirstRealtimeBallRender = true;
            Debug.Log(
                $"[candy-render] first-ball slot={lastRenderedBallSlotIndex} target={lastRenderedBallTargetName} " +
                $"ballHealth={lastRenderedBallHealth} bigBallHealth={lastRenderedBigBallHealth}");
        }
        if (renderedTextTargetCount <= 0)
        {
            ReportRealtimeRenderMismatch("draw received but no ball text target", asError: true);
        }
    }

    public void RegisterRealtimeCountdownRendered(TextMeshProUGUI target)
    {
        lastRenderedCountdownValue = target != null ? (target.text ?? string.Empty) : string.Empty;
        lastRenderedCountdownHealth = RealtimeTextStyleUtils.BuildHealthSummary(target);
    }

    public void RegisterRealtimePlayerCountRendered(TextMeshProUGUI target)
    {
        lastRenderedPlayerCountValue = target != null ? (target.text ?? string.Empty) : string.Empty;
        lastRenderedPlayerCountHealth = RealtimeTextStyleUtils.BuildHealthSummary(target);
    }

    private bool ValidatePatternConfigurationForRealtime()
    {
        NumberGenerator generator = ResolveNumberGenerator();
        if (generator == null)
        {
            return true;
        }

        if (generator.ValidateRealtimePatternConfiguration(out string errorMessage))
        {
            lastPatternConfigurationIssue = string.Empty;
            return true;
        }

        if (!string.Equals(lastPatternConfigurationIssue, errorMessage, StringComparison.Ordinal))
        {
            lastPatternConfigurationIssue = errorMessage;
            PublishRuntimeStatus(errorMessage, asError: true);
        }

        return false;
    }

    public bool ShouldLogRealtimeDrawTrace()
    {
        return logRealtimeDrawTrace;
    }

    private BallManager ResolveBallManager()
    {
        if (ballManager != null)
        {
            return ballManager;
        }

        ballManager = FindSceneObject<BallManager>();
        return ballManager;
    }

    private NumberGenerator ResolveNumberGenerator()
    {
        if (theme1NumberGenerator != null)
        {
            GameManager resolvedManager = ResolveGameManager();
            if (resolvedManager != null && resolvedManager.numberGenerator == null)
            {
                resolvedManager.numberGenerator = theme1NumberGenerator;
            }

            hasLoggedMissingRealtimeNumberGenerator = false;
            return theme1NumberGenerator;
        }

        GameManager resolvedGameManager = ResolveGameManager();
        NumberGenerator generatorFromManager = resolvedGameManager != null ? resolvedGameManager.numberGenerator : null;
        if (generatorFromManager != null)
        {
            theme1NumberGenerator = generatorFromManager;
            hasLoggedMissingRealtimeNumberGenerator = false;
            return generatorFromManager;
        }

        NumberGenerator fallbackGenerator = FindSceneObject<NumberGenerator>();
        if (fallbackGenerator != null)
        {
            theme1NumberGenerator = fallbackGenerator;
            if (resolvedGameManager != null && resolvedGameManager.numberGenerator == null)
            {
                resolvedGameManager.numberGenerator = fallbackGenerator;
            }

            hasLoggedMissingRealtimeNumberGenerator = false;
            return fallbackGenerator;
        }

        if (Application.isPlaying &&
            ShouldUseDedicatedTheme1RealtimeView() &&
            theme1GameplayViewRoot != null)
        {
            return null;
        }

        if (!hasLoggedMissingRealtimeNumberGenerator)
        {
            Debug.LogWarning("[APIManager] Fant ikke NumberGenerator i Theme1. Tegner baller videre, men hopper over kort-markering til referansen er tilgjengelig.");
            hasLoggedMissingRealtimeNumberGenerator = true;
        }

        return null;
    }

    private GameManager ResolveGameManager()
    {
        if (theme1GameManager != null)
        {
            return theme1GameManager;
        }

        if (GameManager.instance != null)
        {
            theme1GameManager = GameManager.instance;
            return theme1GameManager;
        }

        theme1GameManager = FindSceneObject<GameManager>();
        return theme1GameManager;
    }

    private TopperManager ResolveTopperManager()
    {
        if (theme1TopperManager != null)
        {
            return theme1TopperManager;
        }

        theme1TopperManager = FindSceneObject<TopperManager>();
        return theme1TopperManager;
    }

    private static T FindSceneObject<T>() where T : UnityEngine.Object
    {
        return UnityEngine.Object.FindFirstObjectByType<T>(FindObjectsInactive.Include);
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

        resolved.ShowRealtimeDrawBall(drawIndex, drawnNumber);
        return true;
    }

    // Compatibility shim for branches that do not use draw replay queues.
    private void TickDrawRenderResync()
    {
    }

    // Compatibility shim for branches that render draws directly in room updates.
    private void ResetRealtimeDrawReplayState(bool clearMetrics)
    {
        if (realtimeDrawReplayCoroutine != null)
        {
            StopCoroutine(realtimeDrawReplayCoroutine);
            realtimeDrawReplayCoroutine = null;
        }

        pendingRealtimeDrawQueue.Clear();
        pendingRealtimeDrawKeys.Clear();

        if (!clearMetrics)
        {
            return;
        }

        hasLoggedFirstRealtimeCardRender = false;
        hasLoggedFirstRealtimeBallRender = false;
        drawMetricEnqueued = 0;
        drawMetricRendered = 0;
        drawMetricFallbackRendered = 0;
        drawMetricSkipped = 0;
        drawMetricsGameId = string.Empty;
        lastRealtimeDrawRenderAt = -1f;
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

        if (CanAutoCreateAutoLoginInEditor())
        {
            GameObject autoLoginObject = new("BingoAutoLogin_Auto");
            autoLogin = autoLoginObject.AddComponent<BingoAutoLogin>();
            autoLogin.SetBackendBaseUrl(realtimeBackendBaseUrl);
            LogBootstrap("BingoAutoLogin manglet i scenen. Opprettet runtime auto-login i editor-dev mode.");
            return autoLogin;
        }

        ReportMissingRuntimeDependency(
            "BingoAutoLogin",
            "Legg komponenten i Theme1 og bind den i APIManager hvis auto-login skal brukes.");
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

    private void TickRuntimeDiagnostics()
    {
        if (!logRuntimeDiagnostics)
        {
            return;
        }

        if (Time.unscaledTime < nextRuntimeDiagnosticsLogAt)
        {
            return;
        }

        nextRuntimeDiagnosticsLogAt = Time.unscaledTime + Mathf.Max(2f, runtimeDiagnosticsLogIntervalSeconds);
        string snapshot = BuildRuntimeDiagnosticsSnapshot();
        if (string.Equals(lastRuntimeDiagnosticsSnapshot, snapshot, StringComparison.Ordinal))
        {
            return;
        }

        lastRuntimeDiagnosticsSnapshot = snapshot;
        Debug.Log("[candy-runtime] " + snapshot);
    }

    private void RefreshRealtimeDebugOverlay()
    {
        if (!ShouldShowRealtimeDebugOverlay())
        {
            if (realtimeDebugOverlayBackground != null)
            {
                realtimeDebugOverlayBackground.enabled = false;
            }

            if (realtimeDebugOverlayText != null)
            {
                realtimeDebugOverlayText.enabled = false;
            }
            return;
        }

        EnsureRealtimeDebugOverlay();
        if (realtimeDebugOverlayText == null)
        {
            return;
        }

        realtimeDebugOverlayText.enabled = true;
        if (realtimeDebugOverlayBackground != null)
        {
            realtimeDebugOverlayBackground.enabled = true;
        }

        realtimeDebugOverlayText.text = BuildRealtimeDebugOverlayText();
    }

    private bool ShouldShowRealtimeDebugOverlay()
    {
        if (!useRealtimeBackend || !showRealtimeDebugOverlayInEditor)
        {
            return false;
        }

#if UNITY_EDITOR
        return true;
#else
        return Debug.isDebugBuild;
#endif
    }

    private void EnsureRealtimeDebugOverlay()
    {
        if (realtimeDebugOverlayText != null)
        {
            return;
        }

        Canvas[] canvases = FindObjectsOfType<Canvas>(true);
        Canvas rootCanvas = null;
        for (int i = 0; i < canvases.Length; i++)
        {
            Canvas candidate = canvases[i];
            if (candidate == null || !candidate.isRootCanvas)
            {
                continue;
            }

            if (candidate.renderMode == RenderMode.WorldSpace)
            {
                continue;
            }

            rootCanvas = candidate;
            break;
        }

        if (rootCanvas == null)
        {
            return;
        }

        Transform existing = rootCanvas.transform.Find("CandyRealtimeDebugOverlay");
        GameObject overlayObject = existing != null ? existing.gameObject : new GameObject("CandyRealtimeDebugOverlay");
        if (overlayObject.transform.parent != rootCanvas.transform)
        {
            overlayObject.transform.SetParent(rootCanvas.transform, false);
        }

        RectTransform rect = overlayObject.GetComponent<RectTransform>();
        if (rect == null)
        {
            rect = overlayObject.AddComponent<RectTransform>();
        }

        rect.anchorMin = new Vector2(0f, 1f);
        rect.anchorMax = new Vector2(0f, 1f);
        rect.pivot = new Vector2(0f, 1f);
        rect.anchoredPosition = new Vector2(20f, -20f);
        rect.sizeDelta = new Vector2(520f, 240f);

        realtimeDebugOverlayBackground = overlayObject.GetComponent<Image>();
        if (realtimeDebugOverlayBackground == null)
        {
            realtimeDebugOverlayBackground = overlayObject.AddComponent<Image>();
        }
        realtimeDebugOverlayBackground.color = new Color(0.05f, 0.08f, 0.16f, 0.86f);
        realtimeDebugOverlayBackground.raycastTarget = false;

        Transform labelTransform = overlayObject.transform.Find("Label");
        GameObject labelObject = labelTransform != null ? labelTransform.gameObject : new GameObject("Label");
        if (labelObject.transform.parent != overlayObject.transform)
        {
            labelObject.transform.SetParent(overlayObject.transform, false);
        }

        RectTransform labelRect = labelObject.GetComponent<RectTransform>();
        if (labelRect == null)
        {
            labelRect = labelObject.AddComponent<RectTransform>();
        }
        labelRect.anchorMin = Vector2.zero;
        labelRect.anchorMax = Vector2.one;
        labelRect.offsetMin = new Vector2(14f, 14f);
        labelRect.offsetMax = new Vector2(-14f, -14f);

        realtimeDebugOverlayText = labelObject.GetComponent<TextMeshProUGUI>();
        if (realtimeDebugOverlayText == null)
        {
            realtimeDebugOverlayText = labelObject.AddComponent<TextMeshProUGUI>();
        }

        RealtimeTextStyleUtils.ApplyReadableTypography(realtimeDebugOverlayText, minFontSize: 14f, maxFontSize: 22f);
        realtimeDebugOverlayText.color = Color.white;
        realtimeDebugOverlayText.alignment = TextAlignmentOptions.TopLeft;
        realtimeDebugOverlayText.enableWordWrapping = true;
        realtimeDebugOverlayText.overflowMode = TextOverflowModes.Overflow;
        realtimeDebugOverlayText.raycastTarget = false;
    }

    private string BuildRealtimeDebugOverlayText()
    {
        return
            $"Mode: {(useRealtimeBackend ? "realtime" : "legacy")}\n" +
            $"Room: {(string.IsNullOrWhiteSpace(activeRoomCode) ? "none" : activeRoomCode)} Player: {(string.IsNullOrWhiteSpace(activePlayerId) ? "none" : activePlayerId)}\n" +
            $"Tickets: {lastObservedTicketSetCount} RenderedCells: {lastRenderedCardCellCount} CardTarget: {lastRenderedCardTargetName} Value: {lastRenderedCardValue}\n" +
            $"CardHealth: {lastRenderedCardHealth}\n" +
            $"DrawObserved: {lastObservedDrawNumber}/{lastObservedDrawCount} BallTarget: {lastRenderedBallTargetName} BigBall: {lastRenderedBigBallTargetName} Rendered: {lastRenderedDrawNumber}\n" +
            $"BallHealth: {lastRenderedBallHealth}\n" +
            $"BigBallHealth: {lastRenderedBigBallHealth}\n" +
            $"Countdown: {lastRenderedCountdownValue}\n" +
            $"CountdownHealth: {lastRenderedCountdownHealth}\n" +
            $"PlayersLabel: {lastRenderedPlayerCountValue}\n" +
            $"PlayersHealth: {lastRenderedPlayerCountHealth}\n" +
            $"Mismatch: {(string.IsNullOrWhiteSpace(lastRealtimeRenderMismatch) ? "none" : lastRealtimeRenderMismatch)}";
    }

    private string BuildRuntimeDiagnosticsSnapshot()
    {
        string activeScene = UnityEngine.SceneManagement.SceneManager.GetActiveScene().name;
        string url = Application.absoluteURL ?? string.Empty;
        string releaseHint = ResolveUrlParameter(url, "v");
        if (string.IsNullOrWhiteSpace(releaseHint))
        {
            releaseHint = ResolveUrlParameter(url, "release");
        }

        string launchState = CandyLaunchBootstrap.IsLaunchContextResolved
            ? "resolved"
            : CandyLaunchBootstrap.IsResolvingLaunchContext
                ? "resolving"
                : CandyLaunchBootstrap.HasLaunchResolveError
                    ? "error"
                    : CandyLaunchBootstrap.HasLaunchContextInUrl
                        ? "pending"
                        : "none";

        string tokenState = string.IsNullOrWhiteSpace((accessToken ?? string.Empty).Trim())
            ? "missing"
            : "present";

        string roomState = string.IsNullOrWhiteSpace(activeRoomCode)
            ? "none"
            : activeRoomCode;
        string playerState = string.IsNullOrWhiteSpace(activePlayerId)
            ? "none"
            : activePlayerId;
        string mode = useRealtimeBackend ? "realtime" : "legacy";

        bool realtimeReady = realtimeClient != null && realtimeClient.IsReady;
        string backend = string.IsNullOrWhiteSpace(realtimeBackendBaseUrl)
            ? "unset"
            : realtimeBackendBaseUrl;
        string releaseTag = string.IsNullOrWhiteSpace(releaseHint) ? "none" : releaseHint;
        string mismatch = string.IsNullOrWhiteSpace(lastRealtimeRenderMismatch)
            ? "none"
            : lastRealtimeRenderMismatch;

        return
            $"scene={activeScene} mode={mode} backend={backend} launch={launchState} token={tokenState} " +
            $"room={roomState} player={playerState} realtimeReady={realtimeReady} " +
            $"tickets={lastObservedTicketSetCount} renderedCardCells={lastRenderedCardCellCount} " +
            $"cardTarget={lastRenderedCardTargetName}:{lastRenderedCardValue} " +
            $"drawCount={lastObservedDrawCount} drawObserved={lastObservedDrawNumber} drawRendered={lastRenderedDrawNumber} " +
            $"ballSlot={lastRenderedBallSlotIndex} ballTarget={lastRenderedBallTargetName} bigBallTarget={lastRenderedBigBallTargetName} " +
            $"countdown={lastRenderedCountdownValue} playerCountLabel={lastRenderedPlayerCountValue} " +
            $"cardHealth={lastRenderedCardHealth} ballHealth={lastRenderedBallHealth} bigBallHealth={lastRenderedBigBallHealth} " +
            $"countdownHealth={lastRenderedCountdownHealth} playerCountHealth={lastRenderedPlayerCountHealth} " +
            $"mismatch={mismatch} releaseHint={releaseTag}";
    }

    private static string ResolveUrlParameter(string absoluteUrl, string key)
    {
        if (string.IsNullOrWhiteSpace(absoluteUrl) || string.IsNullOrWhiteSpace(key))
        {
            return string.Empty;
        }

        if (!Uri.TryCreate(absoluteUrl, UriKind.Absolute, out Uri uri))
        {
            return string.Empty;
        }

        string query = uri.Query;
        if (!string.IsNullOrWhiteSpace(query))
        {
            string queryValue = ResolveFormEncodedValue(query, key);
            if (!string.IsNullOrWhiteSpace(queryValue))
            {
                return queryValue;
            }
        }

        if (string.IsNullOrWhiteSpace(uri.Fragment))
        {
            return string.Empty;
        }

        return ResolveFormEncodedValue(uri.Fragment, key);
    }

    private static string ResolveFormEncodedValue(string rawSection, string key)
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
            return Uri.UnescapeDataString(rawValue.Replace('+', ' ')).Trim();
        }

        return string.Empty;
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

        return ApplyBackendRoutingPolicy(candidate.TrimEnd('/'));
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

    public void SetRoomCode(string newRoomCode)
    {
        roomCode = (newRoomCode ?? string.Empty).Trim().ToUpperInvariant();
    }

    public void SetRealtimeEntryFeeFromGameUI(int entryFee)
    {
        int previousEntryFee = realtimeEntryFee;
        realtimeEntryFee = Mathf.Max(0, entryFee);
        if (realtimeEntryFee > 0)
        {
            hasAppliedZeroEntryFeeFallbackForRoom = false;
        }

        if (useRealtimeBackend && previousEntryFee != realtimeEntryFee)
        {
            ClearPreservedTheme1RoundDisplayState();
            InvalidateRealtimeBetCommitForPreRoundEdit(
                "entry_fee_changed",
                "Tall eller innsats ble endret. Trykk Plasser innsats på nytt for å bli med i neste runde.");
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
            HandleRealtimeRoomUpdate,
            RequestRealtimeState);
    }

    private void ApplySchedulerMetadata(JSONNode snapshot)
    {
        realtimeScheduler.ApplySchedulerSnapshot(snapshot);
        bool armedForNextRound =
            !string.IsNullOrWhiteSpace(activePlayerId) &&
            realtimeScheduler.ArmedPlayerIds.Contains(activePlayerId);
        realtimeBetArmedForNextRound = armedForNextRound;
        if (!realtimeBetArmAwaitingAck && !pendingRealtimeBetArmRequest)
        {
            desiredRealtimeBetArmedForNextRound = armedForNextRound;
        }
        LogSchedulerSnapshotIfChanged("room-update");
    }

    private void PositionRealtimeCountdownBelowBalls()
    {
        if (!centerRealtimeCountdownUnderBalls)
        {
            return;
        }

        // Theme1 bruker eksplisitte HUD-targets. Behold scene-layouten stabil når bindingen finnes,
        // ellers blir countdown/player-count flyttet rundt av runtime-kode.
        if (GetComponent<CandyTheme1HudBindingSet>() != null)
        {
            return;
        }

        realtimeCountdownPresenter.PositionUnderBalls(
            ResolveNumberGenerator(),
            ResolveBallManager(),
            realtimeCountdownOffset,
            realtimeCountdownWidthMultiplier,
            realtimeCountdownMinParentWidthRatio,
            realtimeCountdownMinWidth,
            realtimeCountdownEdgePadding);
    }

    private void RefreshRealtimeCountdownLabel(bool forceRefresh = false)
    {
        ApplyExplicitRealtimeHudBindingsFromComponent();
        NumberGenerator generator = ResolveNumberGenerator();
        if (generator == null || generator.autoSpinRemainingPlayText == null)
        {
            ReportRealtimeRenderMismatch("HUD countdownText mangler i Theme1.", asError: true);
            return;
        }

        if (!forceRefresh && Time.unscaledTime < nextCountdownRefreshAt)
        {
            return;
        }
        nextCountdownRefreshAt = Time.unscaledTime + 0.2f;

        PositionRealtimeCountdownBelowBalls();
        long nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        string countdownLabel = realtimeScheduler.BuildCountdownLabel(nowMs);
        RealtimeTextStyleUtils.ApplyHudText(generator.autoSpinRemainingPlayText, countdownLabel);
        RegisterRealtimeCountdownRendered(generator.autoSpinRemainingPlayText);
        RefreshRealtimeRoomPlayerCountLabel();
    }

    private void EnsureRealtimeRoomPlayerCountLabel()
    {
        if (!useRealtimeBackend)
        {
            return;
        }

        ApplyExplicitRealtimeHudBindingsFromComponent();
        if (realtimeRoomPlayerCountText == null)
        {
            NumberGenerator generator = ResolveNumberGenerator();
            if (generator != null && generator.autoSpinRemainingPlayText != null)
            {
                realtimeRoomPlayerCountText = CandyTheme1HudBindingSet.FindExistingPlayerCountText(generator.autoSpinRemainingPlayText);
                if (realtimeRoomPlayerCountText == null)
                {
                    realtimeRoomPlayerCountText = CreateRuntimeRealtimeRoomPlayerCountText(generator.autoSpinRemainingPlayText);
                }
            }
        }

        if (realtimeRoomPlayerCountText != null)
        {
            return;
        }

        ReportRealtimeRenderMismatch("HUD roomPlayerCountText mangler i Theme1.", asError: true);
    }

    private void RefreshRealtimeRoomPlayerCountLabel()
    {
        EnsureRealtimeRoomPlayerCountLabel();
        if (realtimeRoomPlayerCountText == null)
        {
            return;
        }

        int playerCount = Mathf.Max(0, realtimeScheduler.PlayerCount);
        string labelValue = $"{realtimeRoomPlayerCountPrefix} {playerCount}";
        RealtimeTextStyleUtils.ApplyHudText(realtimeRoomPlayerCountText, labelValue);
        RegisterRealtimePlayerCountRendered(realtimeRoomPlayerCountText);
    }

    private TextMeshProUGUI CreateRuntimeRealtimeRoomPlayerCountText(TextMeshProUGUI countdownText)
    {
        if (countdownText == null || countdownText.transform.parent == null)
        {
            return null;
        }

        Transform parent = countdownText.transform.parent;
        GameObject labelObject = new GameObject("RealtimeRoomPlayerCountText");
        labelObject.transform.SetParent(parent, false);

        RectTransform rect = labelObject.AddComponent<RectTransform>();
        rect.anchorMin = countdownText.rectTransform.anchorMin;
        rect.anchorMax = countdownText.rectTransform.anchorMax;
        rect.pivot = countdownText.rectTransform.pivot;
        rect.anchoredPosition = countdownText.rectTransform.anchoredPosition + realtimeRoomPlayerCountOffset;
        rect.sizeDelta = new Vector2(
            Mathf.Max(realtimeRoomPlayerCountMinWidth, countdownText.rectTransform.rect.width),
            Mathf.Max(24f, countdownText.rectTransform.rect.height * 0.5f));

        TextMeshProUGUI label = labelObject.AddComponent<TextMeshProUGUI>();
        label.alignment = TextAlignmentOptions.Center;
        label.raycastTarget = false;
        label.fontSize = Mathf.Max(18f, countdownText.fontSize * 0.42f);
        label.color = countdownText.color;
        label.enableWordWrapping = false;
        label.text = $"{realtimeRoomPlayerCountPrefix} 0";
        RealtimeTextStyleUtils.ApplyHudText(
            label,
            $"{realtimeRoomPlayerCountPrefix} 0",
            preferredColor: countdownText.color);

        ReportRealtimeRenderMismatch("HUD roomPlayerCountText manglet i Theme1. Opprettet midlertidig runtime-label.", asError: false);
        return label;
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

        if (ShouldDeferRealtimeBootstrapForLaunchContext("join/create", markPendingForLater: true))
        {
            return;
        }

        BindRealtimeClient();
        if (realtimeClient == null)
        {
            ReportMissingRuntimeDependency(
                "BingoRealtimeClient",
                "Kan ikke bli med i rom uten realtime-klient.");
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

        if (ShouldDeferRealtimeBootstrapForLaunchContext("room:state", markPendingForLater: true))
        {
            return;
        }

        BindRealtimeClient();
        if (realtimeClient == null)
        {
            ReportMissingRuntimeDependency(
                "BingoRealtimeClient",
                "Kan ikke hente room:state uten realtime-klient.");
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
        if (!enableEditorLocalRoundFallback)
        {
            return false;
        }

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

        return ApplyBackendRoutingPolicy(normalized.TrimEnd('/'));
    }

    private static string ApplyBackendRoutingPolicy(string normalizedUrl)
    {
        if (string.IsNullOrWhiteSpace(normalizedUrl))
        {
            return DEFAULT_REALTIME_BACKEND_BASE_URL;
        }

        if (ALLOW_DIRECT_PRODUCTION_BACKEND)
        {
            return normalizedUrl;
        }

        if (!Uri.TryCreate(normalizedUrl, UriKind.Absolute, out Uri parsed))
        {
            return DEFAULT_REALTIME_BACKEND_BASE_URL;
        }

        if (!Uri.TryCreate(PRODUCTION_REALTIME_BACKEND_BASE_URL, UriKind.Absolute, out Uri productionParsed))
        {
            return normalizedUrl;
        }

        if (string.Equals(parsed.Host, productionParsed.Host, StringComparison.OrdinalIgnoreCase))
        {
            Debug.LogWarning(
                $"[APIManager] Blokkerer direkte backend mot prod ({productionParsed.Host}). Bruker staging i stedet.");
            return DEFAULT_REALTIME_BACKEND_BASE_URL;
        }

        return normalizedUrl;
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
        if (useRealtimeBackend)
        {
            ReportLegacyVisualWriteAttempt("APIManager.StartGameWithBet");
            return;
        }

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
