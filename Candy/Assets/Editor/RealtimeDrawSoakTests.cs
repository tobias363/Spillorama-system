using System;
using System.Collections.Generic;
using System.Globalization;
using System.Reflection;
using System.Text.RegularExpressions;
using TMPro;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

public static class RealtimeDrawSoakTests
{
    private const string DefaultScenePath = "Assets/Scenes/Theme1.unity";
    private const string DefaultApiBaseUrl = "https://bingosystem-staging.onrender.com";
    private const string DefaultEmail = "demo@bingo.local";
    private const string DefaultPassword = "Demo12345!";
    private const int DefaultTargetDraws = 500;
    private const int DefaultTimeoutSeconds = 1800;
    private const double DefaultPlayPressIntervalSeconds = 0.9;

    private static readonly Regex DrawKeyRegex = new(@"game=([^\s]+)\s+idx=(\d+)", RegexOptions.Compiled);
    private static readonly HashSet<string> DrawRenderedKeys = new();
    private static readonly HashSet<string> DrawFallbackKeys = new();
    private static readonly HashSet<string> DrawSkippedKeys = new();
    private static readonly HashSet<string> DrawEnqueuedKeys = new();

    private static string scenePath = DefaultScenePath;
    private static string apiBaseUrl = DefaultApiBaseUrl;
    private static string loginEmail = DefaultEmail;
    private static string loginPassword = DefaultPassword;
    private static int targetDraws = DefaultTargetDraws;
    private static int timeoutSeconds = DefaultTimeoutSeconds;
    private static double playPressIntervalSeconds = DefaultPlayPressIntervalSeconds;

    private static bool isRunning;
    private static bool isFinishing;
    private static int exitCode;
    private static string finishReason = string.Empty;
    private static double deadlineAt;
    private static double nextPlayPressAt;
    private static double nextProgressLogAt;
    private static int playPressCount;
    private static int renderedRawCount;
    private static int fallbackRawCount;
    private static int skippedRawCount;
    private static int nearWinVisibleSamples;
    private static int matchedVisibleSamples;
    private static int nearWinBlinkTransitions;
    private static int nearWinBlinkVisibleSamples;
    private static bool? previousMissingBlinkVisible;
    private static int maxActiveNearWinCount;
    private static int maxActiveMatchedPatternCount;
    private static int maxHeaderNearWinCells;
    private static int maxCardNearWinCells;
    private static int maxActivePaylines;
    private static int maxActiveMatchedHeaders;
    private static int theme1ContractValidationSamples;

    private static readonly Dictionary<Type, Dictionary<string, FieldInfo>> FieldCache = new();

    private static bool previousEnterPlayModeOptionsEnabled;
    private static EnterPlayModeOptions previousEnterPlayModeOptions;

    [MenuItem("Tools/Candy/Tests/Run Realtime Draw Soak")]
    public static void RunDrawSoakFromMenu()
    {
        StartRun(
            DefaultScenePath,
            DefaultApiBaseUrl,
            DefaultEmail,
            DefaultPassword,
            DefaultTargetDraws,
            DefaultTimeoutSeconds,
            DefaultPlayPressIntervalSeconds);
    }

    public static void RunDrawSoakFromCommandLine()
    {
        StartRun(
            GetCommandLineArgValue("-soakScene", DefaultScenePath),
            GetCommandLineArgValue("-soakApiBaseUrl", DefaultApiBaseUrl),
            GetCommandLineArgValue("-soakEmail", DefaultEmail),
            GetCommandLineArgValue("-soakPassword", DefaultPassword),
            GetCommandLineIntValue("-soakTargetDraws", DefaultTargetDraws, 1),
            GetCommandLineIntValue("-soakTimeoutSeconds", DefaultTimeoutSeconds, 60),
            GetCommandLineDoubleValue("-soakPlayPressIntervalSeconds", DefaultPlayPressIntervalSeconds, 0.2));
    }

    private static void StartRun(
        string requestedScenePath,
        string requestedApiBaseUrl,
        string requestedEmail,
        string requestedPassword,
        int requestedTargetDraws,
        int requestedTimeoutSeconds,
        double requestedPlayPressIntervalSeconds)
    {
        if (isRunning)
        {
            return;
        }

        isRunning = true;
        isFinishing = false;
        exitCode = 1;
        finishReason = string.Empty;
        scenePath = string.IsNullOrWhiteSpace(requestedScenePath) ? DefaultScenePath : requestedScenePath.Trim();
        apiBaseUrl = string.IsNullOrWhiteSpace(requestedApiBaseUrl) ? DefaultApiBaseUrl : requestedApiBaseUrl.Trim();
        loginEmail = string.IsNullOrWhiteSpace(requestedEmail) ? DefaultEmail : requestedEmail.Trim();
        loginPassword = string.IsNullOrWhiteSpace(requestedPassword) ? DefaultPassword : requestedPassword;
        if (string.Equals(loginEmail, DefaultEmail, StringComparison.OrdinalIgnoreCase))
        {
            loginEmail = BuildEphemeralEmail(DefaultEmail);
        }
        targetDraws = Mathf.Max(1, requestedTargetDraws);
        timeoutSeconds = Mathf.Max(60, requestedTimeoutSeconds);
        playPressIntervalSeconds = Math.Max(0.2, requestedPlayPressIntervalSeconds);

        ResetCounters();

        SceneAsset sceneAsset = AssetDatabase.LoadAssetAtPath<SceneAsset>(scenePath);
        if (sceneAsset == null)
        {
            Debug.LogError($"[DrawSoak] Scene not found: {scenePath}");
            CleanupAndExit(1);
            return;
        }

        EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Single);
        ConfigureScene();

        previousEnterPlayModeOptionsEnabled = EditorSettings.enterPlayModeOptionsEnabled;
        previousEnterPlayModeOptions = EditorSettings.enterPlayModeOptions;
        EditorSettings.enterPlayModeOptionsEnabled = true;
        EditorSettings.enterPlayModeOptions = EnterPlayModeOptions.DisableDomainReload;

        Application.logMessageReceived += HandleLogMessage;
        EditorApplication.playModeStateChanged += HandlePlayModeStateChanged;
        EditorApplication.update += Tick;

        double now = EditorApplication.timeSinceStartup;
        deadlineAt = now + timeoutSeconds;
        nextPlayPressAt = now + 1.0;
        nextProgressLogAt = now + 10.0;

        Debug.Log(
            $"[DrawSoak] START targetDraws={targetDraws} timeoutSeconds={timeoutSeconds} " +
            $"scene={scenePath} apiBaseUrl={apiBaseUrl} email={loginEmail}");

        EditorApplication.isPlaying = true;
    }

    private static void ConfigureScene()
    {
        string displayName = BuildUniqueDisplayName(loginEmail);

        APIManager apiManager = UnityEngine.Object.FindObjectOfType<APIManager>(true);
        if (apiManager != null)
        {
            SerializedObject so = new(apiManager);
            SetSerializedBool(so, "useRealtimeBackend", true);
            SetSerializedString(so, "launchResolveBaseUrl", apiBaseUrl);
            SetSerializedString(so, "realtimeBackendBaseUrl", apiBaseUrl);
            SetSerializedString(so, "accessToken", string.Empty);
            SetSerializedString(so, "roomCode", string.Empty);
            SetSerializedString(so, "hallId", string.Empty);
            SetSerializedString(so, "walletId", string.Empty);
            SetSerializedString(so, "playerName", displayName);
            SetSerializedBool(so, "joinOrCreateOnStart", true);
            SetSerializedBool(so, "triggerAutoLoginWhenAuthMissing", true);
            SetSerializedBool(so, "logRealtimeDrawMetrics", true);
            so.ApplyModifiedPropertiesWithoutUndo();

            InvokePrivateMethod(apiManager, "ResetActiveRoomState", true);
        }

        BingoAutoLogin autoLogin = UnityEngine.Object.FindObjectOfType<BingoAutoLogin>(true);
        if (autoLogin != null)
        {
            SerializedObject so = new(autoLogin);
            SetSerializedString(so, "backendBaseUrl", apiBaseUrl);
            SetSerializedString(so, "email", loginEmail);
            SetSerializedString(so, "password", loginPassword);
            SetSerializedString(so, "displayName", displayName);
            SetSerializedBool(so, "useEphemeralFallbackEmailByDefault", false);
            SetSerializedBool(so, "autoLoginOnStart", true);
            SetSerializedBool(so, "autoConnectAndJoin", true);
            so.ApplyModifiedPropertiesWithoutUndo();
        }

        BingoRealtimeClient realtimeClient = UnityEngine.Object.FindObjectOfType<BingoRealtimeClient>(true);
        if (realtimeClient != null)
        {
            SerializedObject so = new(realtimeClient);
            SetSerializedString(so, "backendBaseUrl", apiBaseUrl);
            SetSerializedString(so, "accessToken", string.Empty);
            so.ApplyModifiedPropertiesWithoutUndo();
        }
    }

    private static void Tick()
    {
        if (!isRunning)
        {
            return;
        }

        double now = EditorApplication.timeSinceStartup;

        if (isFinishing)
        {
            if (!EditorApplication.isPlaying)
            {
                EmitResultAndExit();
            }
            return;
        }

        int visibleDrawCount = GetVisibleDrawCount();
        int skippedDrawCount = GetSkippedDrawCount();
        if (visibleDrawCount >= targetDraws)
        {
            exitCode = skippedDrawCount == 0 ? 0 : 1;
            finishReason = skippedDrawCount == 0
                ? $"target reached: visible={visibleDrawCount}, skipped=0"
                : $"target reached but skipped={skippedDrawCount}";
            RequestFinish();
            return;
        }

        if (now >= deadlineAt)
        {
            exitCode = 1;
            finishReason = $"timeout: visible={visibleDrawCount}, skipped={skippedDrawCount}, target={targetDraws}";
            RequestFinish();
            return;
        }

        if (EditorApplication.isPlaying && now >= nextPlayPressAt)
        {
            TryPressPlayButton();
            nextPlayPressAt = now + playPressIntervalSeconds;
        }

        if (EditorApplication.isPlaying)
        {
            PollPatternVisualState();
            if (!PollTheme1ContractState(out string contractError))
            {
                exitCode = 1;
                finishReason = contractError;
                RequestFinish();
                return;
            }
        }

        if (now >= nextProgressLogAt)
        {
            Debug.Log(
                $"[DrawSoak] PROGRESS visible={visibleDrawCount}/{targetDraws} " +
                $"rendered={GetRenderedDrawCount()} fallback={GetFallbackDrawCount()} " +
                $"enqueued={GetEnqueuedDrawCount()} skipped={skippedDrawCount} playPresses={playPressCount} " +
                $"nearWinVisible={nearWinVisibleSamples} matchedVisible={matchedVisibleSamples} " +
                $"blinkTransitions={nearWinBlinkTransitions} maxNearWins={maxActiveNearWinCount} " +
                $"maxMatched={maxActiveMatchedPatternCount} maxHeaderCells={maxHeaderNearWinCells} " +
                $"maxCardCells={maxCardNearWinCells} maxMatchedHeaders={maxActiveMatchedHeaders} " +
                $"contractSamples={theme1ContractValidationSamples} " +
                $"maxPaylines={maxActivePaylines}");
            nextProgressLogAt = now + 15.0;
        }
    }

    private static void PollPatternVisualState()
    {
        TopperManager topperManager = UnityEngine.Object.FindObjectOfType<TopperManager>(true);
        NumberGenerator numberGenerator = UnityEngine.Object.FindObjectOfType<NumberGenerator>(true);
        Theme1GameplayViewRoot viewRoot = UnityEngine.Object.FindObjectOfType<Theme1GameplayViewRoot>(true);
        Theme1RoundRenderState renderedState = viewRoot != null ? viewRoot.CaptureRenderedState() : null;

        int legacyNearWinCount = GetPrivateCollectionCount(topperManager, "activeNearWins");
        int legacyMatchedPatternCount = GetPrivateCollectionCount(topperManager, "activeMatchedPatternIndexes");
        bool missingBlinkVisible = legacyNearWinCount > 0 && GetPrivateBoolField(topperManager, "missingBlinkVisible");

        if (legacyNearWinCount > 0)
        {
            if (previousMissingBlinkVisible.HasValue && previousMissingBlinkVisible.Value != missingBlinkVisible)
            {
                nearWinBlinkTransitions += 1;
            }

            if (missingBlinkVisible)
            {
                nearWinBlinkVisibleSamples += 1;
            }
        }

        previousMissingBlinkVisible = legacyNearWinCount > 0 ? missingBlinkVisible : null;

        int activeNearWinCount = Math.Max(legacyNearWinCount, CountRenderedNearWinPatterns(renderedState));
        int activeMatchedPatternCount = Math.Max(legacyMatchedPatternCount, CountRenderedMatchedPatterns(renderedState));
        int activeHeaderNearWinCells = Math.Max(CountActiveHeaderNearWinCells(topperManager), CountRenderedHeaderNearWinCells(renderedState));
        int activeCardNearWinCells = Math.Max(CountActiveCardNearWinCells(numberGenerator), CountRenderedCardNearWinCells(renderedState));
        int activeMatchedHeaderPatterns = Math.Max(CountActiveObjects(topperManager != null ? topperManager.matchedPatterns : null), CountRenderedMatchedHeaderPatterns(renderedState));
        int activePaylines = Math.Max(CountActivePaylines(numberGenerator), CountRenderedPaylines(renderedState));

        maxActiveNearWinCount = Math.Max(maxActiveNearWinCount, activeNearWinCount);
        maxActiveMatchedPatternCount = Math.Max(maxActiveMatchedPatternCount, activeMatchedPatternCount);
        maxHeaderNearWinCells = Math.Max(maxHeaderNearWinCells, activeHeaderNearWinCells);
        maxCardNearWinCells = Math.Max(maxCardNearWinCells, activeCardNearWinCells);
        maxActivePaylines = Math.Max(maxActivePaylines, activePaylines);
        maxActiveMatchedHeaders = Math.Max(maxActiveMatchedHeaders, activeMatchedHeaderPatterns);

        bool hasSynchronizedNearWinVisuals =
            (legacyNearWinCount > 0 && missingBlinkVisible && activeHeaderNearWinCells > 0 && activeCardNearWinCells > 0) ||
            (CountRenderedNearWinPatterns(renderedState) > 0 &&
             CountRenderedHeaderNearWinCells(renderedState) > 0 &&
             CountRenderedCardNearWinCells(renderedState) > 0);
        if (hasSynchronizedNearWinVisuals)
        {
            nearWinVisibleSamples += 1;
        }

        bool hasSynchronizedMatchedVisuals =
            (legacyMatchedPatternCount > 0 && activeMatchedHeaderPatterns > 0 && activePaylines > 0) ||
            (CountRenderedMatchedPatterns(renderedState) > 0 &&
             CountRenderedMatchedHeaderPatterns(renderedState) > 0 &&
             CountRenderedPaylines(renderedState) > 0);
        if (hasSynchronizedMatchedVisuals)
        {
            matchedVisibleSamples += 1;
        }
    }

    private static void TryPressPlayButton()
    {
        try
        {
            UIManager uiManager = UnityEngine.Object.FindObjectOfType<UIManager>(true);
            GameManager gameManager = GameManager.instance;
            if (uiManager == null || uiManager.playBtn == null || gameManager == null)
            {
                return;
            }

            if (!gameManager.CanPlayCurrentBet())
            {
                TryIncreaseBetToPlayable(uiManager, gameManager);
                return;
            }

            if (!uiManager.playBtn.interactable)
            {
                return;
            }

            uiManager.Play();
            playPressCount += 1;
        }
        catch (Exception error)
        {
            Debug.LogWarning("[DrawSoak] Play button press failed: " + error.Message);
        }
    }

    private static void TryIncreaseBetToPlayable(UIManager uiManager, GameManager gameManager)
    {
        if (gameManager == null || gameManager.CanPlayCurrentBet())
        {
            return;
        }

        if (uiManager != null && uiManager.betUp != null && uiManager.betUp.interactable)
        {
            uiManager.betUp.onClick.Invoke();
        }
        else
        {
            gameManager.BetUp();
        }

        Debug.Log($"[DrawSoak] Increased bet to {gameManager.currentBet} before attempting play.");
    }

    private static void HandleLogMessage(string condition, string stacktrace, LogType type)
    {
        if (string.IsNullOrWhiteSpace(condition))
        {
            return;
        }

        if (condition.Contains("[draw] draw_enqueued", StringComparison.Ordinal))
        {
            RegisterKey(condition, DrawEnqueuedKeys);
            return;
        }

        if (condition.Contains("[draw] draw_rendered", StringComparison.Ordinal))
        {
            if (!RegisterKey(condition, DrawRenderedKeys))
            {
                renderedRawCount += 1;
            }
            return;
        }

        if (condition.Contains("[draw] draw_fallback_rendered", StringComparison.Ordinal))
        {
            if (!RegisterKey(condition, DrawFallbackKeys))
            {
                fallbackRawCount += 1;
            }
            return;
        }

        if (condition.Contains("[draw] draw_skipped", StringComparison.Ordinal))
        {
            if (!RegisterKey(condition, DrawSkippedKeys))
            {
                skippedRawCount += 1;
            }
        }
    }

    private static bool RegisterKey(string line, HashSet<string> target)
    {
        Match match = DrawKeyRegex.Match(line);
        if (!match.Success)
        {
            return false;
        }

        string gameId = match.Groups[1].Value.Trim();
        string drawIdx = match.Groups[2].Value.Trim();
        if (string.IsNullOrWhiteSpace(gameId) || string.IsNullOrWhiteSpace(drawIdx))
        {
            return false;
        }

        target.Add(gameId + ":" + drawIdx);
        return true;
    }

    private static void HandlePlayModeStateChanged(PlayModeStateChange state)
    {
        if (!isFinishing)
        {
            return;
        }

        if (state == PlayModeStateChange.EnteredEditMode)
        {
            EmitResultAndExit();
        }
    }

    private static void RequestFinish()
    {
        if (isFinishing)
        {
            return;
        }

        isFinishing = true;
        if (EditorApplication.isPlaying)
        {
            EditorApplication.isPlaying = false;
        }
    }

    private static void EmitResultAndExit()
    {
        if (!isRunning)
        {
            return;
        }

        string status = exitCode == 0 ? "PASS" : "FAIL";
        if (exitCode == 0)
        {
            if (nearWinVisibleSamples == 0)
            {
                exitCode = 1;
                status = "FAIL";
                finishReason = "no synchronized near-win visuals observed";
            }
            else if (matchedVisibleSamples == 0)
            {
                exitCode = 1;
                status = "FAIL";
                finishReason = "no matched payline visuals observed";
            }
            else if (nearWinBlinkTransitions == 0 || nearWinBlinkVisibleSamples == 0)
            {
                exitCode = 1;
                status = "FAIL";
                finishReason = "no near-win blink transitions observed";
            }
        }

        Debug.Log(
            $"[DrawSoak] RESULT status={status} reason=\"{finishReason}\" " +
            $"visible={GetVisibleDrawCount()} target={targetDraws} " +
            $"rendered={GetRenderedDrawCount()} fallback={GetFallbackDrawCount()} " +
            $"enqueued={GetEnqueuedDrawCount()} skipped={GetSkippedDrawCount()} playPresses={playPressCount} " +
            $"nearWinVisible={nearWinVisibleSamples} matchedVisible={matchedVisibleSamples} " +
            $"blinkTransitions={nearWinBlinkTransitions} blinkVisibleSamples={nearWinBlinkVisibleSamples} " +
            $"maxNearWins={maxActiveNearWinCount} maxMatched={maxActiveMatchedPatternCount} " +
            $"maxHeaderCells={maxHeaderNearWinCells} maxCardCells={maxCardNearWinCells} " +
            $"maxMatchedHeaders={maxActiveMatchedHeaders} contractSamples={theme1ContractValidationSamples} " +
            $"maxPaylines={maxActivePaylines}");

        CleanupAndExit(exitCode);
    }

    private static void CleanupAndExit(int code)
    {
        Application.logMessageReceived -= HandleLogMessage;
        EditorApplication.playModeStateChanged -= HandlePlayModeStateChanged;
        EditorApplication.update -= Tick;

        EditorSettings.enterPlayModeOptionsEnabled = previousEnterPlayModeOptionsEnabled;
        EditorSettings.enterPlayModeOptions = previousEnterPlayModeOptions;

        isRunning = false;
        isFinishing = false;
        EditorApplication.Exit(code);
    }

    private static int GetVisibleDrawCount()
    {
        HashSet<string> visible = new(DrawRenderedKeys);
        visible.UnionWith(DrawFallbackKeys);
        return visible.Count + renderedRawCount + fallbackRawCount;
    }

    private static int GetRenderedDrawCount()
    {
        return DrawRenderedKeys.Count + renderedRawCount;
    }

    private static int GetFallbackDrawCount()
    {
        return DrawFallbackKeys.Count + fallbackRawCount;
    }

    private static int GetEnqueuedDrawCount()
    {
        return DrawEnqueuedKeys.Count;
    }

    private static int GetSkippedDrawCount()
    {
        return DrawSkippedKeys.Count + skippedRawCount;
    }

    private static void ResetCounters()
    {
        DrawRenderedKeys.Clear();
        DrawFallbackKeys.Clear();
        DrawSkippedKeys.Clear();
        DrawEnqueuedKeys.Clear();
        renderedRawCount = 0;
        fallbackRawCount = 0;
        skippedRawCount = 0;
        playPressCount = 0;
        nearWinVisibleSamples = 0;
        matchedVisibleSamples = 0;
        nearWinBlinkTransitions = 0;
        nearWinBlinkVisibleSamples = 0;
        previousMissingBlinkVisible = null;
        maxActiveNearWinCount = 0;
        maxActiveMatchedPatternCount = 0;
        maxHeaderNearWinCells = 0;
        maxCardNearWinCells = 0;
        maxActivePaylines = 0;
        maxActiveMatchedHeaders = 0;
        theme1ContractValidationSamples = 0;
    }

    private static bool PollTheme1ContractState(out string error)
    {
        error = string.Empty;

        Theme1GameplayViewRoot viewRoot = UnityEngine.Object.FindObjectOfType<Theme1GameplayViewRoot>(true);
        GameManager gameManager = GameManager.instance;
        if (viewRoot == null || gameManager == null)
        {
            return true;
        }

        if (gameManager.currentBet <= 0 && GetVisibleDrawCount() == 0)
        {
            return true;
        }

        Theme1RoundRenderState state = viewRoot.CaptureRenderedState();
        if (!ValidateHudContract(state, viewRoot, gameManager, out error) ||
            !ValidateCardContract(state, gameManager, out error) ||
            !ValidateTheme1NumberBounds(state, out error))
        {
            return false;
        }

        theme1ContractValidationSamples += 1;
        return true;
    }

    private static bool ValidateHudContract(Theme1RoundRenderState state, Theme1GameplayViewRoot viewRoot, GameManager gameManager, out string error)
    {
        error = string.Empty;
        if (state?.Hud == null || gameManager == null)
        {
            return true;
        }

        string expectedCredit = gameManager.CreditBalance.ToString(CultureInfo.InvariantCulture);
        string expectedWinnings = gameManager.RoundWinnings.ToString(CultureInfo.InvariantCulture);
        string expectedBet = gameManager.currentBet.ToString(CultureInfo.InvariantCulture);

        if (!string.Equals(state.Hud.CreditLabel, expectedCredit, StringComparison.Ordinal) ||
            !string.Equals(state.Hud.WinningsLabel, expectedWinnings, StringComparison.Ordinal) ||
            !string.Equals(state.Hud.BetLabel, expectedBet, StringComparison.Ordinal))
        {
            error =
                $"Theme1 HUD contract mismatch: credit='{state.Hud.CreditLabel}' winnings='{state.Hud.WinningsLabel}' bet='{state.Hud.BetLabel}' " +
                $"expected credit='{expectedCredit}' winnings='{expectedWinnings}' bet='{expectedBet}'.";
            return false;
        }

        if (!ValidateHudLabelVisibility(viewRoot?.HudBar?.CreditText, expectedCredit, "credit", out error) ||
            !ValidateHudLabelVisibility(viewRoot?.HudBar?.WinningsText, expectedWinnings, "winnings", out error) ||
            !ValidateHudLabelVisibility(viewRoot?.HudBar?.BetText, expectedBet, "bet", out error))
        {
            return false;
        }

        return true;
    }

    private static bool ValidateHudLabelVisibility(TMP_Text label, string expectedValue, string labelName, out string error)
    {
        error = string.Empty;
        if (label == null)
        {
            return true;
        }

        label.ForceMeshUpdate(ignoreActiveState: true, forceTextReparsing: false);
        int characterCount = label.textInfo != null ? label.textInfo.characterCount : 0;
        bool isVisible =
            label.gameObject.activeInHierarchy &&
            label.enabled &&
            label.alpha > 0f &&
            label.color.a > 0f &&
            !string.IsNullOrWhiteSpace(label.text) &&
            characterCount > 0;

        if (!string.Equals(label.text, expectedValue, StringComparison.Ordinal) || !isVisible)
        {
            error =
                $"Theme1 HUD {labelName} is not visibly rendered. expected='{expectedValue}' actual='{label.text}'. " +
                RealtimeTextStyleUtils.BuildHealthSummary(label as TextMeshProUGUI);
            return false;
        }

        return true;
    }

    private static bool ValidateCardContract(Theme1RoundRenderState state, GameManager gameManager, out string error)
    {
        error = string.Empty;
        if (state?.Cards == null)
        {
            return true;
        }

        string expectedBetLabel = gameManager != null
            ? gameManager.GetCardStakeLabel()
            : GameManager.FormatTheme1CardStakeLabel(0);
        for (int cardIndex = 0; cardIndex < state.Cards.Length; cardIndex++)
        {
            Theme1CardRenderState card = state.Cards[cardIndex];
            if (card == null)
            {
                continue;
            }

            string expectedHeader = GameManager.FormatTheme1CardHeaderLabel(cardIndex);
            if (!string.Equals(card.HeaderLabel, expectedHeader, StringComparison.Ordinal))
            {
                error = $"Theme1 card header mismatch on card {cardIndex + 1}: '{card.HeaderLabel}' expected '{expectedHeader}'.";
                return false;
            }

            if (!string.Equals(card.BetLabel, expectedBetLabel, StringComparison.Ordinal))
            {
                error = $"Theme1 card bet mismatch on card {cardIndex + 1}: '{card.BetLabel}' expected '{expectedBetLabel}'.";
                return false;
            }

            if (card.ShowWinLabel)
            {
                if (!TryParseWinLabel(card.WinLabel, out int amount) ||
                    amount <= 0 ||
                    !string.Equals(card.WinLabel, GameManager.FormatTheme1CardWinLabel(amount), StringComparison.Ordinal))
                {
                    error = $"Theme1 card win mismatch on card {cardIndex + 1}: '{card.WinLabel}'.";
                    return false;
                }
            }
            else if (!string.IsNullOrWhiteSpace(card.WinLabel))
            {
                error = $"Theme1 zero-win label should be hidden/blank on card {cardIndex + 1}, got '{card.WinLabel}'.";
                return false;
            }
        }

        return true;
    }

    private static bool ValidateTheme1NumberBounds(Theme1RoundRenderState state, out string error)
    {
        error = string.Empty;
        if (state == null)
        {
            return true;
        }

        for (int cardIndex = 0; state.Cards != null && cardIndex < state.Cards.Length; cardIndex++)
        {
            Theme1CardCellRenderState[] cells = state.Cards[cardIndex]?.Cells;
            if (cells == null)
            {
                continue;
            }

            for (int cellIndex = 0; cellIndex < cells.Length; cellIndex++)
            {
                string label = cells[cellIndex].NumberLabel;
                if (label == "-" || string.IsNullOrWhiteSpace(label))
                {
                    continue;
                }

                if (!int.TryParse(label, NumberStyles.Integer, CultureInfo.InvariantCulture, out int parsed) ||
                    !GameManager.IsValidTheme1BallNumber(parsed))
                {
                    error = $"Theme1 card number out of bounds at card {cardIndex + 1}, cell {cellIndex + 1}: '{label}'.";
                    return false;
                }
            }
        }

        for (int slotIndex = 0; state.BallRack?.Slots != null && slotIndex < state.BallRack.Slots.Length; slotIndex++)
        {
            Theme1BallSlotRenderState slot = state.BallRack.Slots[slotIndex];
            if (!slot.IsVisible)
            {
                continue;
            }

            if (!int.TryParse(slot.NumberLabel, NumberStyles.Integer, CultureInfo.InvariantCulture, out int parsed) ||
                !GameManager.IsValidTheme1BallNumber(parsed))
            {
                error = $"Theme1 ball number out of bounds in slot {slotIndex + 1}: '{slot.NumberLabel}'.";
                return false;
            }
        }

        if (!string.IsNullOrWhiteSpace(state.BallRack?.BigBallNumber) &&
            (!int.TryParse(state.BallRack.BigBallNumber, NumberStyles.Integer, CultureInfo.InvariantCulture, out int bigBallNumber) ||
             !GameManager.IsValidTheme1BallNumber(bigBallNumber)))
        {
            error = $"Theme1 big-ball number out of bounds: '{state.BallRack.BigBallNumber}'.";
            return false;
        }

        return true;
    }

    private static bool TryParseWinLabel(string label, out int amount)
    {
        amount = 0;
        if (string.IsNullOrWhiteSpace(label) ||
            !label.StartsWith("Gevinst - ", StringComparison.Ordinal) ||
            !label.EndsWith(" kr", StringComparison.Ordinal))
        {
            return false;
        }

        string numericPart = label.Substring("Gevinst - ".Length, label.Length - "Gevinst - ".Length - " kr".Length);
        return int.TryParse(numericPart, NumberStyles.Integer, CultureInfo.InvariantCulture, out amount);
    }

    private static int CountRenderedNearWinPatterns(Theme1RoundRenderState state)
    {
        if (state?.Topper?.Slots == null)
        {
            return 0;
        }

        int total = 0;
        for (int slotIndex = 0; slotIndex < state.Topper.Slots.Length; slotIndex++)
        {
            Theme1TopperSlotRenderState slot = state.Topper.Slots[slotIndex];
            if (slot == null || slot.ShowMatchedPattern || slot.MissingCellsVisible == null)
            {
                continue;
            }

            for (int cellIndex = 0; cellIndex < slot.MissingCellsVisible.Length; cellIndex++)
            {
                if (slot.MissingCellsVisible[cellIndex])
                {
                    total += 1;
                    break;
                }
            }
        }

        return total;
    }

    private static int CountRenderedHeaderNearWinCells(Theme1RoundRenderState state)
    {
        if (state?.Topper?.Slots == null)
        {
            return 0;
        }

        int total = 0;
        for (int slotIndex = 0; slotIndex < state.Topper.Slots.Length; slotIndex++)
        {
            Theme1TopperSlotRenderState slot = state.Topper.Slots[slotIndex];
            if (slot?.MissingCellsVisible == null || slot.ShowMatchedPattern)
            {
                continue;
            }

            for (int cellIndex = 0; cellIndex < slot.MissingCellsVisible.Length; cellIndex++)
            {
                if (slot.MissingCellsVisible[cellIndex])
                {
                    total += 1;
                }
            }
        }

        return total;
    }

    private static int CountRenderedCardNearWinCells(Theme1RoundRenderState state)
    {
        if (state?.Cards == null)
        {
            return 0;
        }

        int total = 0;
        for (int cardIndex = 0; cardIndex < state.Cards.Length; cardIndex++)
        {
            Theme1CardCellRenderState[] cells = state.Cards[cardIndex]?.Cells;
            if (cells == null)
            {
                continue;
            }

            for (int cellIndex = 0; cellIndex < cells.Length; cellIndex++)
            {
                if (cells[cellIndex].IsMissing)
                {
                    total += 1;
                }
            }
        }

        return total;
    }

    private static int CountRenderedMatchedPatterns(Theme1RoundRenderState state)
    {
        if (state?.Topper?.Slots == null)
        {
            return 0;
        }

        int total = 0;
        for (int slotIndex = 0; slotIndex < state.Topper.Slots.Length; slotIndex++)
        {
            if (state.Topper.Slots[slotIndex] != null && state.Topper.Slots[slotIndex].ShowMatchedPattern)
            {
                total += 1;
            }
        }

        return total;
    }

    private static int CountRenderedMatchedHeaderPatterns(Theme1RoundRenderState state)
    {
        return CountRenderedMatchedPatterns(state);
    }

    private static int CountRenderedPaylines(Theme1RoundRenderState state)
    {
        if (state?.Cards == null)
        {
            return 0;
        }

        int total = 0;
        for (int cardIndex = 0; cardIndex < state.Cards.Length; cardIndex++)
        {
            bool[] paylines = state.Cards[cardIndex]?.PaylinesActive;
            if (paylines == null)
            {
                continue;
            }

            for (int paylineIndex = 0; paylineIndex < paylines.Length; paylineIndex++)
            {
                if (paylines[paylineIndex])
                {
                    total += 1;
                }
            }
        }

        return total;
    }

    private static int CountActiveHeaderNearWinCells(TopperManager topperManager)
    {
        if (topperManager == null || topperManager.missedPattern == null)
        {
            return 0;
        }

        int total = 0;
        for (int patternIndex = 0; patternIndex < topperManager.missedPattern.Count; patternIndex++)
        {
            GameObject patternObject = topperManager.missedPattern[patternIndex];
            if (patternObject == null)
            {
                continue;
            }

            foreach (Transform child in patternObject.transform)
            {
                if (child != null && child.gameObject.activeInHierarchy)
                {
                    total += 1;
                }
            }
        }

        return total;
    }

    private static int CountActiveCardNearWinCells(NumberGenerator numberGenerator)
    {
        if (numberGenerator == null || numberGenerator.cardClasses == null)
        {
            return 0;
        }

        int total = 0;
        for (int cardIndex = 0; cardIndex < numberGenerator.cardClasses.Length; cardIndex++)
        {
            CardClass card = numberGenerator.cardClasses[cardIndex];
            if (card == null || card.missingPatternImg == null)
            {
                continue;
            }

            for (int cellIndex = 0; cellIndex < card.missingPatternImg.Count; cellIndex++)
            {
                GameObject missingCell = card.missingPatternImg[cellIndex];
                if (missingCell != null && missingCell.activeInHierarchy)
                {
                    total += 1;
                }
            }
        }

        return total;
    }

    private static int CountActivePaylines(NumberGenerator numberGenerator)
    {
        if (numberGenerator == null || numberGenerator.cardClasses == null)
        {
            return 0;
        }

        int total = 0;
        for (int cardIndex = 0; cardIndex < numberGenerator.cardClasses.Length; cardIndex++)
        {
            CardClass card = numberGenerator.cardClasses[cardIndex];
            if (card == null || card.paylineObj == null)
            {
                continue;
            }

            for (int patternIndex = 0; patternIndex < card.paylineObj.Count; patternIndex++)
            {
                GameObject paylineObject = card.paylineObj[patternIndex];
                if (paylineObject != null && paylineObject.activeInHierarchy)
                {
                    total += 1;
                }
            }
        }

        return total;
    }

    private static int CountActiveObjects(IReadOnlyList<GameObject> objects)
    {
        if (objects == null)
        {
            return 0;
        }

        int total = 0;
        for (int i = 0; i < objects.Count; i++)
        {
            if (objects[i] != null && objects[i].activeInHierarchy)
            {
                total += 1;
            }
        }

        return total;
    }

    private static int GetPrivateCollectionCount(object target, string fieldName)
    {
        object fieldValue = GetPrivateFieldValue(target, fieldName);
        if (fieldValue == null)
        {
            return 0;
        }

        PropertyInfo countProperty = fieldValue.GetType().GetProperty("Count", BindingFlags.Public | BindingFlags.Instance);
        if (countProperty == null || countProperty.PropertyType != typeof(int))
        {
            return 0;
        }

        return (int)countProperty.GetValue(fieldValue);
    }

    private static bool GetPrivateBoolField(object target, string fieldName)
    {
        object fieldValue = GetPrivateFieldValue(target, fieldName);
        return fieldValue is bool boolValue && boolValue;
    }

    private static object GetPrivateFieldValue(object target, string fieldName)
    {
        if (target == null || string.IsNullOrWhiteSpace(fieldName))
        {
            return null;
        }

        Type type = target.GetType();
        if (!FieldCache.TryGetValue(type, out Dictionary<string, FieldInfo> fieldMap))
        {
            fieldMap = new Dictionary<string, FieldInfo>(StringComparer.Ordinal);
            FieldCache[type] = fieldMap;
        }

        if (!fieldMap.TryGetValue(fieldName, out FieldInfo fieldInfo))
        {
            fieldInfo = type.GetField(fieldName, BindingFlags.Instance | BindingFlags.NonPublic);
            fieldMap[fieldName] = fieldInfo;
        }

        return fieldInfo?.GetValue(target);
    }

    private static void InvokePrivateMethod(object target, string methodName, params object[] args)
    {
        if (target == null || string.IsNullOrWhiteSpace(methodName))
        {
            return;
        }

        MethodInfo method = target.GetType().GetMethod(methodName, BindingFlags.Instance | BindingFlags.NonPublic);
        method?.Invoke(target, args);
    }

    private static void SetSerializedString(SerializedObject so, string propertyName, string value)
    {
        SerializedProperty property = so.FindProperty(propertyName);
        if (property != null)
        {
            property.stringValue = value;
        }
    }

    private static void SetSerializedBool(SerializedObject so, string propertyName, bool value)
    {
        SerializedProperty property = so.FindProperty(propertyName);
        if (property != null)
        {
            property.boolValue = value;
        }
    }

    private static string BuildEphemeralEmail(string originalEmail)
    {
        string normalized = (originalEmail ?? string.Empty).Trim().ToLowerInvariant();
        int atIndex = normalized.IndexOf('@');
        string localPart = atIndex > 0 ? normalized.Substring(0, atIndex) : "demo";
        string domain = atIndex > 0 && atIndex + 1 < normalized.Length
            ? normalized.Substring(atIndex + 1)
            : "bingo.local";

        string safeLocal = localPart.Replace("+", "-").Replace(" ", "-");
        string suffix = DateTime.UtcNow.ToString("yyyyMMddHHmmss", CultureInfo.InvariantCulture);
        return $"{safeLocal}-soak-{suffix}@{domain}";
    }

    private static string BuildUniqueDisplayName(string email)
    {
        string normalized = (email ?? string.Empty).Trim();
        int atIndex = normalized.IndexOf('@');
        string localPart = atIndex > 0 ? normalized.Substring(0, atIndex) : "Demo";
        string compactLocal = localPart.Replace(".", string.Empty)
                                       .Replace("_", string.Empty)
                                       .Replace("-", string.Empty);
        if (compactLocal.Length > 12)
        {
            compactLocal = compactLocal.Substring(compactLocal.Length - 12, 12);
        }

        string suffix = DateTime.UtcNow.ToString("HHmmss", CultureInfo.InvariantCulture);
        return $"Soak{compactLocal}{suffix}";
    }

    private static string GetCommandLineArgValue(string name, string fallback)
    {
        string[] args = Environment.GetCommandLineArgs();
        for (int i = 0; i < args.Length - 1; i++)
        {
            if (!string.Equals(args[i], name, StringComparison.Ordinal))
            {
                continue;
            }

            string value = args[i + 1];
            if (!string.IsNullOrWhiteSpace(value))
            {
                return value.Trim();
            }
        }

        return fallback;
    }

    private static int GetCommandLineIntValue(string name, int fallback, int minValue)
    {
        string raw = GetCommandLineArgValue(name, fallback.ToString(CultureInfo.InvariantCulture));
        if (!int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out int parsed))
        {
            return fallback;
        }
        return Mathf.Max(minValue, parsed);
    }

    private static double GetCommandLineDoubleValue(string name, double fallback, double minValue)
    {
        string raw = GetCommandLineArgValue(name, fallback.ToString(CultureInfo.InvariantCulture));
        if (!double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out double parsed))
        {
            return fallback;
        }
        return Math.Max(minValue, parsed);
    }
}
