using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Reflection;
using SimpleJSON;
using TMPro;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

public static class Theme1VisualRenderCapture
{
    private const string ScenePath = "Assets/Scenes/Theme1.unity";
    private const string PlayerId = "theme1-visual-capture";
    private const double TimeoutSeconds = 10.0;
    private const int CaptureWidth = 2048;
    private const int CaptureHeight = 1152;
    private const string DefaultOutputPath = "/tmp/theme1_visual_capture.png";

    private static readonly List<int[]> TicketSets = new()
    {
        new[] { 1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34, 37, 40, 43 },
        new[] { 2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35, 38, 41, 44 },
        new[] { 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 45 },
        new[] { 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60 },
    };

    private static readonly int[] Draws = { 1, 4, 7, 10, 13, 25, 31, 44, 59 };

    private static bool isRunning;
    private static bool shouldExitOnFinish;
    private static double deadlineAt;
    private static string outputPath = DefaultOutputPath;
    private static bool previousEnterPlayModeOptionsEnabled;
    private static EnterPlayModeOptions previousEnterPlayModeOptions;
    private static MethodInfo handleRealtimeRoomUpdateMethod;
    private static FieldInfo activePlayerIdField;
    private static FieldInfo processedDrawCountField;
    private static FieldInfo activeTicketSetsField;
    private static FieldInfo theme1RealtimeViewModeField;
    private static int screenshotPollCount;

    [MenuItem("Tools/Candy/Debug/Capture Theme1 Visual Render")]
    public static void RunFromMenu()
    {
        Start(DefaultOutputPath, exitOnFinish: false);
    }

    public static void RunFromCommandLine()
    {
        string requestedOutput = GetCommandLineArgValue("-theme1CapturePath", DefaultOutputPath);
        Start(requestedOutput, exitOnFinish: true);
    }

    private static void Start(string requestedOutputPath, bool exitOnFinish)
    {
        if (isRunning)
        {
            return;
        }

        CandyTheme1BindingTools.InstallOrRefreshTheme1BindingsCli();
        EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
        outputPath = string.IsNullOrWhiteSpace(requestedOutputPath) ? DefaultOutputPath : requestedOutputPath.Trim();
        shouldExitOnFinish = exitOnFinish;
        isRunning = true;
        deadlineAt = EditorApplication.timeSinceStartup + TimeoutSeconds;
        screenshotPollCount = 0;

        previousEnterPlayModeOptionsEnabled = EditorSettings.enterPlayModeOptionsEnabled;
        previousEnterPlayModeOptions = EditorSettings.enterPlayModeOptions;
        EditorSettings.enterPlayModeOptionsEnabled = true;
        EditorSettings.enterPlayModeOptions = EnterPlayModeOptions.DisableDomainReload;

        Application.logMessageReceived += HandleLogMessage;
        EditorApplication.playModeStateChanged += HandlePlayModeStateChanged;
        EditorApplication.update += Tick;
        Debug.Log("[Theme1VisualCapture] START");
        EditorApplication.isPlaying = true;
    }

    private static void Tick()
    {
        if (!isRunning || !EditorApplication.isPlaying)
        {
            return;
        }

        if (EditorApplication.timeSinceStartup > deadlineAt)
        {
            Fail("timeout");
            return;
        }

        if (handleRealtimeRoomUpdateMethod == null)
        {
            if (!TryBindRuntime(out string bindError))
            {
                Fail(bindError);
                return;
            }
        }

        EditorApplication.update -= Tick;
        EditorApplication.delayCall += CaptureOnceReady;
    }

    private static void CaptureOnceReady()
    {
        if (!isRunning || !EditorApplication.isPlaying)
        {
            return;
        }

        APIManager apiManager = UnityEngine.Object.FindFirstObjectByType<APIManager>(FindObjectsInactive.Include);
        Theme1GameplayViewRoot viewRoot = UnityEngine.Object.FindFirstObjectByType<Theme1GameplayViewRoot>(FindObjectsInactive.Include);
        Camera camera = UnityEngine.Object.FindFirstObjectByType<Camera>(FindObjectsInactive.Include);
        if (apiManager == null || viewRoot == null || camera == null)
        {
            Fail("APIManager, Theme1GameplayViewRoot eller Camera mangler.");
            return;
        }

        activePlayerIdField.SetValue(apiManager, PlayerId);
        processedDrawCountField.SetValue(apiManager, 0);
        activeTicketSetsField.SetValue(apiManager, new List<List<int>>());
        theme1RealtimeViewModeField.SetValue(apiManager, Enum.ToObject(theme1RealtimeViewModeField.FieldType, 2));
        handleRealtimeRoomUpdateMethod.Invoke(apiManager, new object[] { BuildSnapshot("GAME-VISUAL", Draws) });

        viewRoot.EnsurePresentationInitialized();

        EditorApplication.delayCall += () => CaptureGameView(camera, viewRoot);
    }

    private static void CaptureGameView(Camera camera, Theme1GameplayViewRoot viewRoot)
    {
        try
        {
            if (camera == null || viewRoot == null)
            {
                Fail("Camera eller Theme1GameplayViewRoot forsvant før capture.");
                return;
            }

            Directory.CreateDirectory(Path.GetDirectoryName(outputPath) ?? "/tmp");
            TMPLog(viewRoot);
            if (File.Exists(outputPath))
            {
                File.Delete(outputPath);
            }

            ScreenCapture.CaptureScreenshot(outputPath, 1);
            EditorApplication.delayCall += PollForScreenshot;
        }
        catch (Exception ex)
        {
            Fail(ex.ToString());
        }
    }

    private static void PollForScreenshot()
    {
        if (!isRunning)
        {
            return;
        }

        screenshotPollCount++;
        if (File.Exists(outputPath))
        {
            FileInfo info = new FileInfo(outputPath);
            if (info.Exists && info.Length > 0)
            {
                Debug.Log("[Theme1VisualCapture] WROTE " + outputPath);
                Complete();
                return;
            }
        }

        if (screenshotPollCount > 5)
        {
            Fail("Game view screenshot ble ikke skrevet til disk.");
            return;
        }

        EditorApplication.delayCall += PollForScreenshot;
    }

    private static void TMPLog(Theme1GameplayViewRoot viewRoot)
    {
        Theme1CardCellView cell = viewRoot.Cards != null &&
                                  viewRoot.Cards.Length > 0 &&
                                  viewRoot.Cards[0] != null &&
                                  viewRoot.Cards[0].Cells != null &&
                                  viewRoot.Cards[0].Cells.Length > 0
            ? viewRoot.Cards[0].Cells[0]
            : null;
        TMP_Text label = cell?.NumberLabel;
        if (label == null)
        {
            Debug.LogWarning("[Theme1VisualCapture] First card label missing.");
            return;
        }

        RectTransform rect = label.rectTransform;
        Debug.Log(
            "[Theme1VisualCapture] first-card " +
            $"text='{label.text}' active={label.gameObject.activeInHierarchy} enabled={label.enabled} " +
            $"alpha={label.alpha.ToString(CultureInfo.InvariantCulture)} color={label.color} " +
            $"rect={rect.rect.width.ToString("0.##", CultureInfo.InvariantCulture)}x{rect.rect.height.ToString("0.##", CultureInfo.InvariantCulture)} " +
            $"path={BuildPath(label.transform)}");
    }

    private static bool TryBindRuntime(out string error)
    {
        error = string.Empty;
        handleRealtimeRoomUpdateMethod = typeof(APIManager).GetMethod(
            "HandleRealtimeRoomUpdate",
            BindingFlags.Instance | BindingFlags.NonPublic);
        activePlayerIdField = typeof(APIManager).GetField(
            "activePlayerId",
            BindingFlags.Instance | BindingFlags.NonPublic);
        processedDrawCountField = typeof(APIManager).GetField(
            "processedDrawCount",
            BindingFlags.Instance | BindingFlags.NonPublic);
        activeTicketSetsField = typeof(APIManager).GetField(
            "activeTicketSets",
            BindingFlags.Instance | BindingFlags.NonPublic);
        theme1RealtimeViewModeField = typeof(APIManager).GetField(
            "theme1RealtimeViewMode",
            BindingFlags.Instance | BindingFlags.NonPublic);

        if (handleRealtimeRoomUpdateMethod == null ||
            activePlayerIdField == null ||
            processedDrawCountField == null ||
            activeTicketSetsField == null ||
            theme1RealtimeViewModeField == null)
        {
            error = "Klarte ikke binde APIManager runtime members.";
            return false;
        }

        Theme1GameplayViewRoot viewRoot = UnityEngine.Object.FindFirstObjectByType<Theme1GameplayViewRoot>(FindObjectsInactive.Include);
        if (viewRoot == null)
        {
            error = "Theme1GameplayViewRoot mangler.";
            return false;
        }

        if (!viewRoot.ValidateContract(out string report))
        {
            error = "Ugyldig Theme1GameplayViewRoot:\n" + report;
            return false;
        }

        return true;
    }

    private static JSONNode BuildSnapshot(string gameId, IReadOnlyList<int> draws)
    {
        JSONObject root = new JSONObject();
        root["code"] = "VISUAL";
        root["hallId"] = "hall-visual";
        root["hostPlayerId"] = PlayerId;
        root["players"] = BuildPlayersNode();
        root["preRoundTickets"] = BuildTicketsNode();
        root["currentGame"] = BuildCurrentGameNode(gameId, draws);
        return root;
    }

    private static JSONArray BuildPlayersNode()
    {
        JSONArray players = new JSONArray();
        JSONObject player = new JSONObject();
        player["id"] = PlayerId;
        player["walletId"] = "wallet-visual";
        player["displayName"] = "Visual";
        players.Add(player);
        return players;
    }

    private static JSONObject BuildCurrentGameNode(string gameId, IReadOnlyList<int> draws)
    {
        JSONObject currentGame = new JSONObject();
        currentGame["id"] = gameId;
        currentGame["status"] = "RUNNING";
        currentGame["tickets"] = BuildTicketsNode();
        JSONArray drawnNumbers = new JSONArray();
        for (int i = 0; draws != null && i < draws.Count; i++)
        {
            drawnNumbers.Add(draws[i]);
        }

        currentGame["drawnNumbers"] = drawnNumbers;
        currentGame["claims"] = new JSONArray();
        return currentGame;
    }

    private static JSONObject BuildTicketsNode()
    {
        JSONArray tickets = new JSONArray();
        for (int i = 0; i < TicketSets.Count; i++)
        {
            JSONObject ticket = new JSONObject();
            JSONArray numbers = new JSONArray();
            for (int numberIndex = 0; numberIndex < TicketSets[i].Length; numberIndex++)
            {
                numbers.Add(TicketSets[i][numberIndex]);
            }

            ticket["numbers"] = numbers;
            tickets.Add(ticket);
        }

        JSONObject byPlayer = new JSONObject();
        byPlayer[PlayerId] = tickets;
        return byPlayer;
    }

    private static string GetCommandLineArgValue(string argumentName, string fallback)
    {
        string[] args = Environment.GetCommandLineArgs();
        for (int i = 0; i < args.Length - 1; i++)
        {
            if (string.Equals(args[i], argumentName, StringComparison.Ordinal))
            {
                return args[i + 1];
            }
        }

        return fallback;
    }

    private static string BuildPath(Transform target)
    {
        if (target == null)
        {
            return string.Empty;
        }

        Stack<string> parts = new Stack<string>();
        Transform current = target;
        while (current != null)
        {
            parts.Push(current.name);
            current = current.parent;
        }

        return string.Join("/", parts);
    }

    private static void HandleLogMessage(string condition, string stackTrace, LogType type)
    {
        if (!isRunning || type != LogType.Exception)
        {
            return;
        }

        Fail("Exception logged: " + condition);
    }

    private static void HandlePlayModeStateChanged(PlayModeStateChange state)
    {
        if (!isRunning)
        {
            return;
        }

        if (state == PlayModeStateChange.EnteredEditMode)
        {
            Finish();
        }
    }

    private static void Complete()
    {
        if (!EditorApplication.isPlaying)
        {
            Finish();
            return;
        }

        EditorApplication.isPlaying = false;
    }

    private static void Fail(string reason)
    {
        Debug.LogError("[Theme1VisualCapture] FAIL: " + reason);
        if (EditorApplication.isPlaying)
        {
            EditorApplication.isPlaying = false;
            return;
        }

        Finish();
    }

    private static void Finish()
    {
        if (!isRunning)
        {
            return;
        }

        isRunning = false;
        Application.logMessageReceived -= HandleLogMessage;
        EditorApplication.playModeStateChanged -= HandlePlayModeStateChanged;
        EditorApplication.update -= Tick;
        EditorSettings.enterPlayModeOptionsEnabled = previousEnterPlayModeOptionsEnabled;
        EditorSettings.enterPlayModeOptions = previousEnterPlayModeOptions;

        if (shouldExitOnFinish)
        {
            EditorApplication.Exit(0);
        }
    }
}
