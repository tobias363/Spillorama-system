using System;
using System.Collections.Generic;
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

    private static bool isRunning;
    private static bool finishing;
    private static bool shouldPass;
    private static int exitCode;
    private static string finishReason = string.Empty;

    private static string scenePath = DefaultScenePath;
    private static string apiBaseUrl = DefaultApiBaseUrl;
    private static string loginEmail = DefaultEmail;
    private static string loginPassword = DefaultPassword;
    private static int targetDraws = DefaultTargetDraws;
    private static int timeoutSeconds = DefaultTimeoutSeconds;
    private static double playPressIntervalSeconds = DefaultPlayPressIntervalSeconds;

    private static double startTime;
    private static double deadlineTime;
    private static double nextPlayPressAt;
    private static double nextProgressLogAt;
    private static int playPressCount;

    private static readonly HashSet<string> drawEnqueuedKeys = new();
    private static readonly HashSet<string> drawRenderedKeys = new();
    private static readonly HashSet<string> drawFallbackKeys = new();
    private static readonly HashSet<string> drawSkippedKeys = new();
    private static int drawRenderedRawCount;
    private static int drawFallbackRawCount;
    private static int drawSkippedRawCount;

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
            GetCommandLineDoubleValue("-soakPlayPressIntervalSeconds", DefaultPlayPressIntervalSeconds, 0.15));
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
        finishing = false;
        shouldPass = false;
        exitCode = 1;
        finishReason = string.Empty;

        scenePath = string.IsNullOrWhiteSpace(requestedScenePath) ? DefaultScenePath : requestedScenePath.Trim();
        apiBaseUrl = string.IsNullOrWhiteSpace(requestedApiBaseUrl) ? DefaultApiBaseUrl : requestedApiBaseUrl.Trim();
        loginEmail = string.IsNullOrWhiteSpace(requestedEmail) ? DefaultEmail : requestedEmail.Trim();
        loginPassword = string.IsNullOrWhiteSpace(requestedPassword) ? DefaultPassword : requestedPassword;
        targetDraws = Mathf.Max(1, requestedTargetDraws);
        timeoutSeconds = Mathf.Max(60, requestedTimeoutSeconds);
        playPressIntervalSeconds = Math.Max(0.15, requestedPlayPressIntervalSeconds);

        ResetCounters();

        if (AssetDatabase.LoadAssetAtPath<SceneAsset>(scenePath) == null)
        {
            Debug.LogError($"[DrawSoak] Scene not found: {scenePath}");
            CleanupAndExit(1);
            return;
        }

        EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Single);
        ConfigureSceneForSoak();

        Application.logMessageReceived += HandleUnityLog;
        EditorApplication.playModeStateChanged += HandlePlayModeStateChanged;
        EditorApplication.update += Tick;

        startTime = EditorApplication.timeSinceStartup;
        deadlineTime = startTime + timeoutSeconds;
        nextPlayPressAt = startTime + 1.5;
        nextProgressLogAt = startTime + 5.0;

        Debug.Log(
            $"[DrawSoak] START targetDraws={targetDraws} timeoutSeconds={timeoutSeconds} " +
            $"scene={scenePath} apiBaseUrl={apiBaseUrl}");

        EditorApplication.isPlaying = true;
    }

    private static void ConfigureSceneForSoak()
    {
        APIManager apiManager = UnityEngine.Object.FindObjectOfType<APIManager>(true);
        if (apiManager != null)
        {
            SerializedObject serializedApiManager = new(apiManager);
            SetSerializedString(serializedApiManager, "launchResolveBaseUrl", apiBaseUrl);
            SetSerializedBool(serializedApiManager, "joinOrCreateOnStart", true);
            SetSerializedBool(serializedApiManager, "logRealtimeDrawMetrics", true);
            serializedApiManager.ApplyModifiedPropertiesWithoutUndo();
        }

        BingoAutoLogin autoLogin = UnityEngine.Object.FindObjectOfType<BingoAutoLogin>(true);
        if (autoLogin != null)
        {
            SerializedObject serializedAutoLogin = new(autoLogin);
            SetSerializedString(serializedAutoLogin, "backendBaseUrl", apiBaseUrl);
            SetSerializedString(serializedAutoLogin, "email", loginEmail);
            SetSerializedString(serializedAutoLogin, "password", loginPassword);
            SetSerializedBool(serializedAutoLogin, "autoLoginOnStart", true);
            SetSerializedBool(serializedAutoLogin, "autoConnectAndJoin", true);
            serializedAutoLogin.ApplyModifiedPropertiesWithoutUndo();
        }

        BingoRealtimeClient realtimeClient = UnityEngine.Object.FindObjectOfType<BingoRealtimeClient>(true);
        if (realtimeClient != null)
        {
            SerializedObject serializedRealtimeClient = new(realtimeClient);
            SetSerializedString(serializedRealtimeClient, "backendBaseUrl", apiBaseUrl);
            serializedRealtimeClient.ApplyModifiedPropertiesWithoutUndo();
        }
    }

    private static void SetSerializedString(SerializedObject serializedObject, string propertyName, string value)
    {
        SerializedProperty property = serializedObject.FindProperty(propertyName);
        if (property != null)
        {
            property.stringValue = value;
        }
    }

    private static void SetSerializedBool(SerializedObject serializedObject, string propertyName, bool value)
    {
        SerializedProperty property = serializedObject.FindProperty(propertyName);
        if (property != null)
        {
            property.boolValue = value;
        }
    }

    private static void Tick()
    {
        if (!isRunning)
        {
            return;
        }

        double now = EditorApplication.timeSinceStartup;

        if (finishing)
        {
            if (!EditorApplication.isPlaying)
            {
                EmitResultAndExit();
            }
            return;
        }

        int visibleDrawCount = GetVisibleDrawCount();
        if (visibleDrawCount >= targetDraws)
        {
            shouldPass = GetSkippedDrawCount() == 0;
            exitCode = shouldPass ? 0 : 1;
            finishReason = shouldPass
                ? $"target reached: visible={visibleDrawCount}, skipped=0"
                : $"target reached but skipped > 0 ({GetSkippedDrawCount()})";
            RequestFinish();
            return;
        }

        if (now >= deadlineTime)
        {
            shouldPass = false;
            exitCode = 1;
            finishReason = $"timeout: visible={visibleDrawCount}, skipped={GetSkippedDrawCount()}, target={targetDraws}";
            RequestFinish();
            return;
        }

        if (EditorApplication.isPlaying && now >= nextPlayPressAt)
        {
            TryPressPlay();
            nextPlayPressAt = now + playPressIntervalSeconds;
        }

        if (now >= nextProgressLogAt)
        {
            Debug.Log(
                $"[DrawSoak] PROGRESS visible={visibleDrawCount}/{targetDraws} " +
                $"rendered={GetRenderedDrawCount()} fallback={GetFallbackDrawCount()} " +
                $"enqueued={GetEnqueuedDrawCount()} skipped={GetSkippedDrawCount()} playPresses={playPressCount}");
            nextProgressLogAt = now + 15.0;
        }
    }

    private static void TryPressPlay()
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
            Debug.LogWarning($"[DrawSoak] Play press failed: {error.Message}");
        }
    }

    private static void HandleUnityLog(string condition, string stacktrace, LogType type)
    {
        if (string.IsNullOrWhiteSpace(condition))
        {
            return;
        }

        if (condition.Contains("[draw] draw_enqueued", StringComparison.Ordinal))
        {
            RegisterDrawKey(condition, drawEnqueuedKeys);
            return;
        }

        if (condition.Contains("[draw] draw_rendered", StringComparison.Ordinal))
        {
            if (!RegisterDrawKey(condition, drawRenderedKeys))
            {
                drawRenderedRawCount += 1;
            }
            return;
        }

        if (condition.Contains("[draw] draw_fallback_rendered", StringComparison.Ordinal))
        {
            if (!RegisterDrawKey(condition, drawFallbackKeys))
            {
                drawFallbackRawCount += 1;
            }
            return;
        }

        if (condition.Contains("[draw] draw_skipped", StringComparison.Ordinal))
        {
            if (!RegisterDrawKey(condition, drawSkippedKeys))
            {
                drawSkippedRawCount += 1;
            }
        }
    }

    private static bool RegisterDrawKey(string logLine, HashSet<string> targetSet)
    {
        Match match = DrawKeyRegex.Match(logLine);
        if (!match.Success)
        {
            return false;
        }

        string gameId = match.Groups[1].Value.Trim();
        string drawIndex = match.Groups[2].Value.Trim();
        if (string.IsNullOrWhiteSpace(gameId) || string.IsNullOrWhiteSpace(drawIndex))
        {
            return false;
        }

        targetSet.Add($"{gameId}:{drawIndex}");
        return true;
    }

    private static int GetVisibleDrawCount()
    {
        HashSet<string> visibleKeys = new(drawRenderedKeys);
        visibleKeys.UnionWith(drawFallbackKeys);
        return visibleKeys.Count + drawRenderedRawCount + drawFallbackRawCount;
    }

    private static int GetRenderedDrawCount()
    {
        return drawRenderedKeys.Count + drawRenderedRawCount;
    }

    private static int GetFallbackDrawCount()
    {
        return drawFallbackKeys.Count + drawFallbackRawCount;
    }

    private static int GetSkippedDrawCount()
    {
        return drawSkippedKeys.Count + drawSkippedRawCount;
    }

    private static int GetEnqueuedDrawCount()
    {
        return drawEnqueuedKeys.Count;
    }

    private static void RequestFinish()
    {
        if (finishing)
        {
            return;
        }

        finishing = true;
        if (EditorApplication.isPlaying)
        {
            EditorApplication.isPlaying = false;
        }
    }

    private static void HandlePlayModeStateChanged(PlayModeStateChange state)
    {
        if (!finishing)
        {
            return;
        }

        if (state == PlayModeStateChange.EnteredEditMode)
        {
            EmitResultAndExit();
        }
    }

    private static void EmitResultAndExit()
    {
        if (!isRunning)
        {
            return;
        }

        Debug.Log(
            $"[DrawSoak] RESULT status={(shouldPass ? "PASS" : "FAIL")} reason=\"{finishReason}\" " +
            $"visible={GetVisibleDrawCount()} target={targetDraws} rendered={GetRenderedDrawCount()} " +
            $"fallback={GetFallbackDrawCount()} enqueued={GetEnqueuedDrawCount()} " +
            $"skipped={GetSkippedDrawCount()} playPresses={playPressCount}");

        CleanupAndExit(exitCode);
    }

    private static void CleanupAndExit(int code)
    {
        Application.logMessageReceived -= HandleUnityLog;
        EditorApplication.playModeStateChanged -= HandlePlayModeStateChanged;
        EditorApplication.update -= Tick;
        isRunning = false;
        finishing = false;
        EditorApplication.Exit(code);
    }

    private static void ResetCounters()
    {
        drawEnqueuedKeys.Clear();
        drawRenderedKeys.Clear();
        drawFallbackKeys.Clear();
        drawSkippedKeys.Clear();
        drawRenderedRawCount = 0;
        drawFallbackRawCount = 0;
        drawSkippedRawCount = 0;
        playPressCount = 0;
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
        string raw = GetCommandLineArgValue(name, fallback.ToString());
        if (!int.TryParse(raw, out int parsed))
        {
            return fallback;
        }

        return Mathf.Max(minValue, parsed);
    }

    private static double GetCommandLineDoubleValue(string name, double fallback, double minValue)
    {
        string raw = GetCommandLineArgValue(name, fallback.ToString(System.Globalization.CultureInfo.InvariantCulture));
        if (!double.TryParse(raw, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out double parsed))
        {
            return fallback;
        }

        return Math.Max(minValue, parsed);
    }
}
