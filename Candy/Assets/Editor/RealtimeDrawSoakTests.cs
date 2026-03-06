using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.RegularExpressions;
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
        APIManager apiManager = UnityEngine.Object.FindObjectOfType<APIManager>(true);
        if (apiManager != null)
        {
            SerializedObject so = new(apiManager);
            SetSerializedString(so, "launchResolveBaseUrl", apiBaseUrl);
            SetSerializedBool(so, "joinOrCreateOnStart", true);
            SetSerializedBool(so, "logRealtimeDrawMetrics", true);
            so.ApplyModifiedPropertiesWithoutUndo();
        }

        BingoAutoLogin autoLogin = UnityEngine.Object.FindObjectOfType<BingoAutoLogin>(true);
        if (autoLogin != null)
        {
            SerializedObject so = new(autoLogin);
            SetSerializedString(so, "backendBaseUrl", apiBaseUrl);
            SetSerializedString(so, "email", loginEmail);
            SetSerializedString(so, "password", loginPassword);
            SetSerializedBool(so, "autoLoginOnStart", true);
            SetSerializedBool(so, "autoConnectAndJoin", true);
            so.ApplyModifiedPropertiesWithoutUndo();
        }

        BingoRealtimeClient realtimeClient = UnityEngine.Object.FindObjectOfType<BingoRealtimeClient>(true);
        if (realtimeClient != null)
        {
            SerializedObject so = new(realtimeClient);
            SetSerializedString(so, "backendBaseUrl", apiBaseUrl);
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

        if (now >= nextProgressLogAt)
        {
            Debug.Log(
                $"[DrawSoak] PROGRESS visible={visibleDrawCount}/{targetDraws} " +
                $"rendered={GetRenderedDrawCount()} fallback={GetFallbackDrawCount()} " +
                $"enqueued={GetEnqueuedDrawCount()} skipped={skippedDrawCount} playPresses={playPressCount}");
            nextProgressLogAt = now + 15.0;
        }
    }

    private static void TryPressPlayButton()
    {
        try
        {
            UIManager uiManager = UnityEngine.Object.FindObjectOfType<UIManager>(true);
            if (uiManager == null || uiManager.playBtn == null)
            {
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
        Debug.Log(
            $"[DrawSoak] RESULT status={status} reason=\"{finishReason}\" " +
            $"visible={GetVisibleDrawCount()} target={targetDraws} " +
            $"rendered={GetRenderedDrawCount()} fallback={GetFallbackDrawCount()} " +
            $"enqueued={GetEnqueuedDrawCount()} skipped={GetSkippedDrawCount()} playPresses={playPressCount}");

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
