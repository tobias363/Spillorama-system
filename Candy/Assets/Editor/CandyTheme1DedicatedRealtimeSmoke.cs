using System;
using System.Collections.Generic;
using System.Globalization;
using System.Reflection;
using SimpleJSON;
using TMPro;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

public static class CandyTheme1DedicatedRealtimeSmoke
{
    private enum SmokeStage
    {
        WaitingForPlayMode,
        CompareNearWin,
        CompareMatched,
        Completed,
        Failed
    }

    private const string ScenePath = "Assets/Scenes/Theme1.unity";
    private const string PlayerId = "dedicated-smoke-player";
    private const double StageTimeoutSeconds = 6.0;

    private static readonly int[] NearWinDraws = { 1, 4, 7, 10 };
    private static readonly int[] MatchedDraws = { 1, 4, 7, 10, 13 };
    private static readonly List<int[]> TicketSets = new()
    {
        new[] { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15 },
        new[] { 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30 },
        new[] { 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45 },
        new[] { 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60 },
    };

    private static bool isRunning;
    private static bool shouldExitOnFinish;
    private static SmokeStage stage;
    private static double stageDeadlineAt;
    private static int exitCode = 1;
    private static string finishMessage = string.Empty;
    private static bool previousEnterPlayModeOptionsEnabled;
    private static EnterPlayModeOptions previousEnterPlayModeOptions;

    private static MethodInfo handleRealtimeRoomUpdateMethod;
    private static FieldInfo activePlayerIdField;
    private static FieldInfo processedDrawCountField;
    private static FieldInfo activeTicketSetsField;
    private static FieldInfo theme1RealtimeViewModeField;

    [MenuItem("Tools/Candy/Tests/Run Theme1 Dedicated Realtime Smoke")]
    public static void RunFromMenu()
    {
        Start(exitOnFinish: false);
    }

    public static void RunFromCommandLine()
    {
        Start(exitOnFinish: true);
    }

    private static void Start(bool exitOnFinish)
    {
        if (isRunning)
        {
            return;
        }

        CandyTheme1BindingTools.InstallOrRefreshTheme1BindingsCli();
        EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
        ConfigureSceneForSmoke();

        shouldExitOnFinish = exitOnFinish;
        isRunning = true;
        exitCode = 1;
        finishMessage = string.Empty;
        stage = SmokeStage.WaitingForPlayMode;
        stageDeadlineAt = EditorApplication.timeSinceStartup + StageTimeoutSeconds;

        previousEnterPlayModeOptionsEnabled = EditorSettings.enterPlayModeOptionsEnabled;
        previousEnterPlayModeOptions = EditorSettings.enterPlayModeOptions;
        EditorSettings.enterPlayModeOptionsEnabled = true;
        EditorSettings.enterPlayModeOptions = EnterPlayModeOptions.DisableDomainReload;

        Application.logMessageReceived += HandleLogMessage;
        EditorApplication.playModeStateChanged += HandlePlayModeStateChanged;
        EditorApplication.update += Tick;
        Debug.Log("[Theme1DedicatedSmoke] START");
        EditorApplication.isPlaying = true;
    }

    private static void ConfigureSceneForSmoke()
    {
        APIManager apiManager = UnityEngine.Object.FindFirstObjectByType<APIManager>(FindObjectsInactive.Include);
        if (apiManager != null)
        {
            SerializedObject so = new SerializedObject(apiManager);
            SetSerializedBool(so, "useRealtimeBackend", true);
            SetSerializedBool(so, "joinOrCreateOnStart", false);
            SetSerializedBool(so, "triggerAutoLoginWhenAuthMissing", false);
            so.ApplyModifiedPropertiesWithoutUndo();
        }
    }

    private static void Tick()
    {
        if (!isRunning || stage == SmokeStage.Completed || stage == SmokeStage.Failed || !EditorApplication.isPlaying)
        {
            return;
        }

        if (EditorApplication.timeSinceStartup > stageDeadlineAt)
        {
            Fail("stage timeout: " + stage);
            return;
        }

        switch (stage)
        {
            case SmokeStage.WaitingForPlayMode:
                if (!TryBindRuntimeMembers(out string bindError))
                {
                    Fail(bindError);
                    return;
                }

                stage = SmokeStage.CompareNearWin;
                stageDeadlineAt = EditorApplication.timeSinceStartup + StageTimeoutSeconds;
                break;

            case SmokeStage.CompareNearWin:
                if (!TryCompareSnapshot("GAME-NEAR", NearWinDraws, requireMatchedPayline: false, out string nearError))
                {
                    Fail(nearError);
                    return;
                }

                stage = SmokeStage.CompareMatched;
                stageDeadlineAt = EditorApplication.timeSinceStartup + StageTimeoutSeconds;
                break;

            case SmokeStage.CompareMatched:
                if (!TryCompareSnapshot("GAME-MATCHED", MatchedDraws, requireMatchedPayline: true, out string matchedError))
                {
                    Fail(matchedError);
                    return;
                }

                Complete("dedicated Theme1 realtime view verified against legacy output");
                break;
        }
    }

    private static bool TryBindRuntimeMembers(out string error)
    {
        error = string.Empty;
        if (!CandyBallVisualCatalog.TryValidateComplete(out string ballCatalogError))
        {
            error = "[Theme1DedicatedSmoke] " + ballCatalogError;
            return false;
        }

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
            error = "[Theme1DedicatedSmoke] Klarte ikke binde APIManager private runtime members.";
            return false;
        }

        APIManager apiManager = UnityEngine.Object.FindFirstObjectByType<APIManager>(FindObjectsInactive.Include);
        Theme1GameplayViewRoot viewRoot = UnityEngine.Object.FindFirstObjectByType<Theme1GameplayViewRoot>(FindObjectsInactive.Include);
        if (apiManager == null || viewRoot == null)
        {
            error = "[Theme1DedicatedSmoke] APIManager eller Theme1GameplayViewRoot mangler i scene.";
            return false;
        }

        if (!viewRoot.ValidateContract(out string viewReport))
        {
            error = "[Theme1DedicatedSmoke] Ugyldig Theme1GameplayViewRoot:\n" + viewReport;
            return false;
        }

        if (!ValidateDedicatedVisibleContract(viewRoot, out string contractError))
        {
            error = contractError;
            return false;
        }

        if (!ValidateTheme1BuilderRejectsNumbersAbove60(out string builderError))
        {
            error = builderError;
            return false;
        }

        if (!ValidateTheme1BuilderKeepsPatternsPerCard(out string perCardPatternError))
        {
            error = perCardPatternError;
            return false;
        }

        if (!ValidateDedicatedPreservesCompletedRound(viewRoot, out string preservedRoundError))
        {
            error = preservedRoundError;
            return false;
        }

        if (!ValidateDedicatedShowsDrawBallsWithoutParticipation(out string spectatorError))
        {
            error = spectatorError;
            return false;
        }

        return true;
    }

    private static bool TryCompareSnapshot(string gameId, IReadOnlyList<int> draws, bool requireMatchedPayline, out string error)
    {
        error = string.Empty;
        if (!TryCaptureModeState(0, gameId, draws, out Theme1RoundRenderState legacyState, out string legacyError))
        {
            error = legacyError;
            return false;
        }

        if (!TryCaptureModeState(2, gameId, draws, out Theme1RoundRenderState dedicatedState, out string dedicatedError))
        {
            error = dedicatedError;
            return false;
        }

        Theme1GameplayViewRoot viewRoot = UnityEngine.Object.FindFirstObjectByType<Theme1GameplayViewRoot>(FindObjectsInactive.Include);
        if (!Theme1RoundRenderStateComparer.TryCompare(legacyState, dedicatedState, out string mismatch))
        {
            string actionableMismatch = FilterIgnorableLegacyMismatch(mismatch);
            if (!string.IsNullOrWhiteSpace(actionableMismatch))
            {
                error = "[Theme1DedicatedSmoke] Legacy/dedicated mismatch:\n" + actionableMismatch;
                return false;
            }

            Debug.LogWarning("[Theme1DedicatedSmoke] Ignorerer forventet legacy/dedicated ball-text mismatch:\n" + mismatch);
        }

        if (!HasVisibleTicketNumbers(dedicatedState))
        {
            error = "[Theme1DedicatedSmoke] Dedicated view rendret ikke synlige tall på bongene.";
            return false;
        }

        if (!HasVisibleBallNumbers(dedicatedState))
        {
            error = "[Theme1DedicatedSmoke] Dedicated view rendret ikke synlige balltall.";
            return false;
        }

        if (!UsesCatalogBallSprites(dedicatedState, out string spriteError))
        {
            error = spriteError;
            return false;
        }

        if (!HasReadableFirstCardLabelColor())
        {
            error = "[Theme1DedicatedSmoke] Første bongtall er fortsatt for lyst og vil se blankt ut i kortet.";
            return false;
        }

        Theme1GameplayViewRoot currentViewRoot = UnityEngine.Object.FindFirstObjectByType<Theme1GameplayViewRoot>(FindObjectsInactive.Include);
        if (!HasExpectedHudValues(dedicatedState, currentViewRoot, out string hudError))
        {
            error = hudError;
            return false;
        }

        if (!HasExpectedTopperPrizeLabels(dedicatedState, out string topperError))
        {
            error = topperError;
            return false;
        }

        if (!HasExpectedCardLabels(dedicatedState, out string labelError))
        {
            error = labelError;
            return false;
        }

        if (!HasOnlyValidTheme1Numbers(dedicatedState, out string invalidNumberError))
        {
            error = invalidNumberError;
            return false;
        }

        if (requireMatchedPayline && !HasMatchedPayline(dedicatedState))
        {
            error =
                "[Theme1DedicatedSmoke] Dedicated view viste ikke matched payline på vinnsnapshot. " +
                BuildPaylineDebugSummary(dedicatedState);
            return false;
        }

        if (!requireMatchedPayline && !HasNearWinCell(dedicatedState))
        {
            error = "[Theme1DedicatedSmoke] Dedicated view viste ikke near-win-cell på near-win-snapshot.";
            return false;
        }

        return true;
    }

    private static string FilterIgnorableLegacyMismatch(string mismatch)
    {
        if (string.IsNullOrWhiteSpace(mismatch))
        {
            return string.Empty;
        }

        string[] lines = mismatch.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
        List<string> actionable = new List<string>();
        for (int i = 0; i < lines.Length; i++)
        {
            string line = lines[i].Trim();
            if (IsIgnorableLegacyBallTextMismatch(line))
            {
                continue;
            }

            actionable.Add(line);
        }

        return string.Join("\n", actionable);
    }

    private static bool IsIgnorableLegacyBallTextMismatch(string line)
    {
        if (string.IsNullOrWhiteSpace(line))
        {
            return true;
        }

        bool isBallRackLine =
            line.StartsWith("ballRack.bigBallNumber:", StringComparison.Ordinal) ||
            line.StartsWith("ballRack.slots[", StringComparison.Ordinal);
        if (!isBallRackLine)
        {
            return false;
        }

        return line.Contains("expected=''") && line.Contains("actual='");
    }

    private static bool TryCaptureModeState(int renderModeValue, string gameId, IReadOnlyList<int> draws, out Theme1RoundRenderState state, out string error)
    {
        state = null;
        error = string.Empty;

        APIManager apiManager = UnityEngine.Object.FindFirstObjectByType<APIManager>(FindObjectsInactive.Include);
        Theme1GameplayViewRoot viewRoot = UnityEngine.Object.FindFirstObjectByType<Theme1GameplayViewRoot>(FindObjectsInactive.Include);
        if (apiManager == null || viewRoot == null)
        {
            error = "[Theme1DedicatedSmoke] APIManager eller Theme1GameplayViewRoot mangler i play mode.";
            return false;
        }

        ResetVisualState();
        theme1RealtimeViewModeField.SetValue(apiManager, Enum.ToObject(theme1RealtimeViewModeField.FieldType, renderModeValue));
        activePlayerIdField.SetValue(apiManager, PlayerId);
        processedDrawCountField.SetValue(apiManager, 0);
        activeTicketSetsField.SetValue(apiManager, new List<List<int>>());
        handleRealtimeRoomUpdateMethod.Invoke(apiManager, new object[] { BuildSnapshot(gameId, draws) });
        state = viewRoot.CaptureRenderedState();
        return true;
    }

    private static void ResetVisualState()
    {
        NumberGenerator generator = UnityEngine.Object.FindFirstObjectByType<NumberGenerator>(FindObjectsInactive.Include);
        BallManager ballManager = UnityEngine.Object.FindFirstObjectByType<BallManager>(FindObjectsInactive.Include);
        TopperManager topperManager = UnityEngine.Object.FindFirstObjectByType<TopperManager>(FindObjectsInactive.Include);

        if (generator != null)
        {
            MethodInfo resetNumbMethod = typeof(NumberGenerator).GetMethod(
                "ResetNumb",
                BindingFlags.Instance | BindingFlags.NonPublic);
            resetNumbMethod?.Invoke(generator, null);
            generator.ClearPaylineVisuals();
        }

        if (ballManager != null)
        {
            ballManager.ResetBalls();
        }

        if (topperManager != null)
        {
            MethodInfo resetMethod = typeof(TopperManager).GetMethod(
                "Reset",
                BindingFlags.Instance | BindingFlags.NonPublic);
            resetMethod?.Invoke(topperManager, null);
        }
    }

    private static JSONNode BuildSnapshot(string gameId, IReadOnlyList<int> draws)
    {
        JSONObject root = new JSONObject();
        root["code"] = "SMOKE";
        root["hallId"] = "hall-smoke";
        root["hostPlayerId"] = PlayerId;
        root["players"] = BuildPlayersNode();
        root["preRoundTickets"] = BuildTicketsNode();
        root["currentGame"] = BuildCurrentGameNode(gameId, draws);
        return root;
    }

    private static JSONNode BuildEndedSnapshot()
    {
        JSONObject root = new JSONObject();
        root["code"] = "SMOKE";
        root["hallId"] = "hall-smoke";
        root["hostPlayerId"] = PlayerId;
        root["players"] = BuildPlayersNode();
        root["preRoundTickets"] = BuildTicketsNode();
        root["currentGame"] = JSONNull.CreateOrGet();
        return root;
    }

    private static JSONNode BuildSpectatorSnapshot(string gameId, IReadOnlyList<int> draws)
    {
        JSONObject root = new JSONObject();
        root["code"] = "SMOKE";
        root["hallId"] = "hall-smoke";
        root["hostPlayerId"] = PlayerId;
        root["players"] = BuildPlayersNode(includeOtherPlayer: true);
        root["preRoundTickets"] = BuildTicketsNode();
        root["currentGame"] = BuildCurrentGameNode(gameId, draws, BuildTicketsNodeForPlayer("other-player"));
        return root;
    }

    private static JSONArray BuildPlayersNode(bool includeOtherPlayer = false)
    {
        JSONArray players = new JSONArray();
        JSONObject player = new JSONObject();
        player["id"] = PlayerId;
        player["walletId"] = "wallet-smoke";
        player["displayName"] = "Smoke";
        players.Add(player);

        if (includeOtherPlayer)
        {
            JSONObject otherPlayer = new JSONObject();
            otherPlayer["id"] = "other-player";
            otherPlayer["walletId"] = "wallet-other";
            otherPlayer["displayName"] = "Other";
            players.Add(otherPlayer);
        }

        return players;
    }

    private static JSONObject BuildCurrentGameNode(string gameId, IReadOnlyList<int> draws, JSONNode ticketsOverride = null)
    {
        JSONObject currentGame = new JSONObject();
        currentGame["id"] = gameId;
        currentGame["status"] = "RUNNING";
        currentGame["tickets"] = ticketsOverride ?? BuildTicketsNode();

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
        return BuildTicketsNodeForPlayer(PlayerId);
    }

    private static JSONObject BuildTicketsNodeForPlayer(string playerId)
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
        byPlayer[playerId] = tickets;
        return byPlayer;
    }

    private static bool ValidateDedicatedPreservesCompletedRound(Theme1GameplayViewRoot viewRoot, out string error)
    {
        error = string.Empty;
        if (!TryCaptureDedicatedStateFromSnapshot("GAME-PRESERVE", MatchedDraws, BuildSnapshot("GAME-PRESERVE", MatchedDraws), out Theme1RoundRenderState liveState, out error))
        {
            return false;
        }

        if (!TryCaptureDedicatedStateFromSnapshot("GAME-PRESERVE", MatchedDraws, BuildEndedSnapshot(), out Theme1RoundRenderState endedState, out error))
        {
            return false;
        }

        if (!HasVisibleTicketNumbers(endedState))
        {
            error = "[Theme1DedicatedSmoke] Theme1 nullstilte bongene med en gang runden var ferdig i stedet for å bevare siste state.";
            return false;
        }

        if (!string.Equals(endedState?.BallRack?.BigBallNumber, liveState?.BallRack?.BigBallNumber, StringComparison.Ordinal))
        {
            error =
                "[Theme1DedicatedSmoke] Theme1 bevarte ikke siste synlige trekk etter rundeslutt. " +
                $"running='{liveState?.BallRack?.BigBallNumber}' ended='{endedState?.BallRack?.BigBallNumber}'.";
            return false;
        }

        if (CountSelectedCells(endedState) < CountSelectedCells(liveState))
        {
            error =
                "[Theme1DedicatedSmoke] Theme1 mistet markerte celler etter rundeslutt før ny runde eller nytt bet. " +
                $"running={CountSelectedCells(liveState)} ended={CountSelectedCells(endedState)}.";
            return false;
        }

        if (!HasExpectedHudValues(endedState, viewRoot, out error))
        {
            error = "[Theme1DedicatedSmoke] Theme1 HUD ble ikke bevart etter rundeslutt.\n" + error;
            return false;
        }

        return true;
    }

    private static bool ValidateDedicatedShowsDrawBallsWithoutParticipation(out string error)
    {
        error = string.Empty;
        if (!TryCaptureDedicatedStateFromSnapshot(
                "GAME-SPECTATOR",
                NearWinDraws,
                BuildSpectatorSnapshot("GAME-SPECTATOR", NearWinDraws),
                out Theme1RoundRenderState spectatorState,
                out error))
        {
            return false;
        }

        if (!HasVisibleBallNumbers(spectatorState))
        {
            error = "[Theme1DedicatedSmoke] Theme1 skjulte trekkballene for spiller uten aktiv innsats.";
            return false;
        }

        string expectedBigBall = NearWinDraws[NearWinDraws.Length - 1].ToString(CultureInfo.InvariantCulture);
        if (!string.Equals(spectatorState.BallRack?.BigBallNumber, expectedBigBall, StringComparison.Ordinal))
        {
            error =
                "[Theme1DedicatedSmoke] Theme1 viste ikke siste trekk for tilskuer uten innsats. " +
                $"expected='{expectedBigBall}' actual='{spectatorState.BallRack?.BigBallNumber}'.";
            return false;
        }

        return true;
    }

    private static bool TryCaptureDedicatedStateFromSnapshot(
        string gameId,
        IReadOnlyList<int> draws,
        JSONNode snapshot,
        out Theme1RoundRenderState state,
        out string error)
    {
        state = null;
        error = string.Empty;

        APIManager apiManager = UnityEngine.Object.FindFirstObjectByType<APIManager>(FindObjectsInactive.Include);
        Theme1GameplayViewRoot viewRoot = UnityEngine.Object.FindFirstObjectByType<Theme1GameplayViewRoot>(FindObjectsInactive.Include);
        if (apiManager == null || viewRoot == null)
        {
            error = "[Theme1DedicatedSmoke] APIManager eller Theme1GameplayViewRoot mangler i play mode.";
            return false;
        }

        ResetVisualState();
        theme1RealtimeViewModeField.SetValue(apiManager, Enum.ToObject(theme1RealtimeViewModeField.FieldType, 2));
        activePlayerIdField.SetValue(apiManager, PlayerId);
        processedDrawCountField.SetValue(apiManager, 0);
        activeTicketSetsField.SetValue(apiManager, new List<List<int>>());
        handleRealtimeRoomUpdateMethod.Invoke(apiManager, new object[] { snapshot });
        state = viewRoot.CaptureRenderedState();
        return state != null;
    }

    private static int CountSelectedCells(Theme1RoundRenderState state)
    {
        int count = 0;
        if (state?.Cards == null)
        {
            return 0;
        }

        for (int cardIndex = 0; cardIndex < state.Cards.Length; cardIndex++)
        {
            Theme1CardCellRenderState[] cells = state.Cards[cardIndex]?.Cells;
            if (cells == null)
            {
                continue;
            }

            for (int cellIndex = 0; cellIndex < cells.Length; cellIndex++)
            {
                if (cells[cellIndex].IsSelected)
                {
                    count += 1;
                }
            }
        }

        return count;
    }

    private static bool HasVisibleTicketNumbers(Theme1RoundRenderState state)
    {
        return state?.Cards != null &&
               state.Cards.Length > 0 &&
               state.Cards[0] != null &&
               state.Cards[0].Cells != null &&
               state.Cards[0].Cells.Length > 0 &&
               state.Cards[0].Cells[0].NumberLabel == "1";
    }

    private static bool HasVisibleBallNumbers(Theme1RoundRenderState state)
    {
        return state?.BallRack != null &&
               state.BallRack.ShowBigBall &&
               !string.IsNullOrWhiteSpace(state.BallRack.BigBallNumber) &&
               state.BallRack.Slots != null &&
               state.BallRack.Slots.Length > 0 &&
               state.BallRack.Slots[0].IsVisible &&
               state.BallRack.Slots[0].NumberLabel == "1";
    }

    private static bool UsesCatalogBallSprites(Theme1RoundRenderState state, out string error)
    {
        error = string.Empty;
        if (!CandyBallVisualCatalog.TryValidateComplete(out string ballCatalogError))
        {
            error = "[Theme1DedicatedSmoke] " + ballCatalogError;
            return false;
        }

        Theme1GameplayViewRoot viewRoot = UnityEngine.Object.FindFirstObjectByType<Theme1GameplayViewRoot>(FindObjectsInactive.Include);
        if (viewRoot?.BallRack?.Slots == null || viewRoot.BallRack.Slots.Length == 0)
        {
            error = "[Theme1DedicatedSmoke] Theme1GameplayViewRoot mangler ballslotter for sprite-validering.";
            return false;
        }

        if (!CandyBallVisualCatalog.TryGetSmallSprite(1, out Sprite expectedSmall) || expectedSmall == null)
        {
            error = "[Theme1DedicatedSmoke] CandyBallVisualCatalog mangler small sprite for ball 1.";
            return false;
        }

        int bigBallNumber = state?.BallRack != null && int.TryParse(state.BallRack.BigBallNumber, out int parsedBigBallNumber)
            ? parsedBigBallNumber
            : 0;
        if (!CandyBallVisualCatalog.TryGetBigSprite(bigBallNumber, out Sprite expectedBig) || expectedBig == null)
        {
            error = "[Theme1DedicatedSmoke] CandyBallVisualCatalog mangler big sprite for siste synlige trekk.";
            return false;
        }

        Sprite actualSmall = viewRoot.BallRack.Slots[0]?.SpriteTarget != null
            ? viewRoot.BallRack.Slots[0].SpriteTarget.sprite
            : null;
        Sprite actualBig = viewRoot.BallRack.BigBallImage != null
            ? viewRoot.BallRack.BigBallImage.sprite
            : null;
        if (actualSmall == null || actualSmall.name != expectedSmall.name)
        {
            error = "[Theme1DedicatedSmoke] Første synlige ballslot bruker ikke katalog-sprite.";
            return false;
        }

        if (actualBig == null || actualBig.name != expectedBig.name)
        {
            error = "[Theme1DedicatedSmoke] Big ball bruker ikke katalog-sprite.";
            return false;
        }

        return true;
    }

    private static bool HasReadableFirstCardLabelColor()
    {
        Theme1GameplayViewRoot viewRoot = UnityEngine.Object.FindFirstObjectByType<Theme1GameplayViewRoot>(FindObjectsInactive.Include);
        TMP_Text label = viewRoot?.Cards != null &&
                         viewRoot.Cards.Length > 0 &&
                         viewRoot.Cards[0]?.Cells != null &&
                         viewRoot.Cards[0].Cells.Length > 0
            ? viewRoot.Cards[0].Cells[0]?.NumberLabel
            : null;
        if (label == null)
        {
            return false;
        }

        Color color = label.color;
        return color.r < 0.95f || color.g < 0.95f || color.b < 0.95f;
    }

    private static bool HasExpectedHudValues(Theme1RoundRenderState state, Theme1GameplayViewRoot viewRoot, out string error)
    {
        error = string.Empty;
        GameManager gameManager = GameManager.instance;
        string expectedCredit = gameManager != null ? GameManager.FormatWholeNumber(gameManager.CreditBalance) : "0";
        string expectedWinnings = gameManager != null ? GameManager.FormatWholeNumber(gameManager.RoundWinnings) : "0";
        string expectedBet = gameManager != null ? GameManager.FormatWholeNumber(gameManager.currentBet) : "0";

        if (state?.Hud == null)
        {
            error = "[Theme1DedicatedSmoke] Dedicated view mangler HUD-state.";
            return false;
        }

        if (!string.Equals(state.Hud.CreditLabel, expectedCredit, StringComparison.Ordinal) ||
            !string.Equals(state.Hud.WinningsLabel, expectedWinnings, StringComparison.Ordinal) ||
            !string.Equals(state.Hud.BetLabel, expectedBet, StringComparison.Ordinal))
        {
            error =
                "[Theme1DedicatedSmoke] Dedicated view rendret feil HUD-verdier. " +
                $"credit='{state.Hud.CreditLabel}' winnings='{state.Hud.WinningsLabel}' bet='{state.Hud.BetLabel}' " +
                $"expected credit='{expectedCredit}' winnings='{expectedWinnings}' bet='{expectedBet}'.";
            return false;
        }

        if (!HasVisibleHudLabel(viewRoot?.HudBar?.CreditText, expectedCredit, "credit", out error) ||
            !HasVisibleHudLabel(viewRoot?.HudBar?.WinningsText, expectedWinnings, "winnings", out error) ||
            !HasVisibleHudLabel(viewRoot?.HudBar?.BetText, expectedBet, "bet", out error))
        {
            return false;
        }

        return true;
    }

    private static bool HasVisibleHudLabel(TMP_Text label, string expectedValue, string labelName, out string error)
    {
        error = string.Empty;
        if (label == null)
        {
            error = $"[Theme1DedicatedSmoke] Theme1 HUD mangler TMP for {labelName}.";
            return false;
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
                $"[Theme1DedicatedSmoke] Theme1 HUD {labelName} er ikke synlig/riktig rendret. " +
                $"expected='{expectedValue}' actual='{label.text}'. " +
                RealtimeTextStyleUtils.BuildHealthSummary(label as TextMeshProUGUI);
            return false;
        }

        return true;
    }

    private static bool HasExpectedCardLabels(Theme1RoundRenderState state, out string error)
    {
        error = string.Empty;
        if (state?.Cards == null || state.Cards.Length != 4)
        {
            error = "[Theme1DedicatedSmoke] Dedicated view rendret ikke 4 kort.";
            return false;
        }

        GameManager gameManager = GameManager.instance;
        string expectedBetLabel = gameManager != null
            ? gameManager.GetCardStakeLabel()
            : GameManager.FormatTheme1CardStakeLabel(0);

        for (int cardIndex = 0; cardIndex < state.Cards.Length; cardIndex++)
        {
            Theme1CardRenderState card = state.Cards[cardIndex];
            if (card == null)
            {
                error = $"[Theme1DedicatedSmoke] Dedicated view mangler card-state {cardIndex + 1}.";
                return false;
            }

            string expectedHeader = GameManager.FormatTheme1CardHeaderLabel(cardIndex);
            if (!string.Equals(card.HeaderLabel, expectedHeader, StringComparison.Ordinal))
            {
                error = $"[Theme1DedicatedSmoke] Card {cardIndex + 1} header='{card.HeaderLabel}' expected='{expectedHeader}'.";
                return false;
            }

            if (!string.Equals(card.BetLabel, expectedBetLabel, StringComparison.Ordinal))
            {
                error = $"[Theme1DedicatedSmoke] Card {cardIndex + 1} bet='{card.BetLabel}' expected='{expectedBetLabel}'.";
                return false;
            }

            if (card.ShowWinLabel)
            {
                error = $"[Theme1DedicatedSmoke] Card {cardIndex + 1} viste Gevinst-label selv om smoke-snapshotet skal ha zero-win.";
                return false;
            }

            if (!string.IsNullOrWhiteSpace(card.WinLabel))
            {
                error = $"[Theme1DedicatedSmoke] Card {cardIndex + 1} skjuler ikke zero-win label. Fikk '{card.WinLabel}'.";
                return false;
            }
        }

        return true;
    }

    private static bool HasOnlyValidTheme1Numbers(Theme1RoundRenderState state, out string error)
    {
        error = string.Empty;
        if (state == null)
        {
            error = "[Theme1DedicatedSmoke] Dedicated state mangler.";
            return false;
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
                string numberLabel = cells[cellIndex].NumberLabel;
                if (numberLabel == "-" || string.IsNullOrWhiteSpace(numberLabel))
                {
                    continue;
                }

                if (!int.TryParse(numberLabel, NumberStyles.Integer, CultureInfo.InvariantCulture, out int parsed) ||
                    !GameManager.IsValidTheme1BallNumber(parsed))
                {
                    error = $"[Theme1DedicatedSmoke] Card {cardIndex + 1} cell {cellIndex + 1} viser ugyldig Theme1-tall '{numberLabel}'.";
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
                error = $"[Theme1DedicatedSmoke] Ballslot {slotIndex + 1} viser ugyldig Theme1-tall '{slot.NumberLabel}'.";
                return false;
            }
        }

        if (!string.IsNullOrWhiteSpace(state.BallRack?.BigBallNumber) &&
            (!int.TryParse(state.BallRack.BigBallNumber, NumberStyles.Integer, CultureInfo.InvariantCulture, out int bigBallNumber) ||
             !GameManager.IsValidTheme1BallNumber(bigBallNumber)))
        {
            error = $"[Theme1DedicatedSmoke] Big ball viser ugyldig Theme1-tall '{state.BallRack.BigBallNumber}'.";
            return false;
        }

        return true;
    }

    private static bool HasExpectedTopperPrizeLabels(Theme1RoundRenderState state, out string error)
    {
        error = string.Empty;
        if (state?.Topper?.Slots == null || state.Topper.Slots.Length == 0)
        {
            error = "[Theme1DedicatedSmoke] Dedicated view mangler topper prize-state.";
            return false;
        }

        GameManager gameManager = GameManager.instance;
        for (int slotIndex = 0; slotIndex < state.Topper.Slots.Length; slotIndex++)
        {
            Theme1TopperSlotRenderState slot = state.Topper.Slots[slotIndex];
            string expected = gameManager != null && gameManager.TryGetFormattedPayoutLabel(slotIndex, out string runtimeLabel)
                ? runtimeLabel
                : string.Empty;
            string actual = slot != null ? slot.PrizeLabel : string.Empty;
            if (string.IsNullOrWhiteSpace(expected))
            {
                continue;
            }

            if (!string.Equals(actual, expected, StringComparison.Ordinal))
            {
                error =
                    $"[Theme1DedicatedSmoke] Topper slot {slotIndex + 1} prize='{actual}' expected='{expected}'.";
                return false;
            }
        }

        return true;
    }

    private static bool ValidateTheme1BuilderRejectsNumbersAbove60(out string error)
    {
        error = string.Empty;
        Theme1StateBuildInput input = new Theme1StateBuildInput
        {
            GameId = "GAME-INVALID",
            CardSlotCount = 1,
            BallSlotCount = 4,
            TicketSets = new[]
            {
                new[] { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 61 }
            },
            DrawnNumbers = new[] { 1, 61, 4, 75 },
            CardHeaderLabels = new[] { GameManager.FormatTheme1CardHeaderLabel(0) },
            CardBetLabels = new[] { GameManager.FormatTheme1CardStakeLabel(4) },
            CardWinLabels = new[] { string.Empty },
            TopperPrizeLabels = Array.Empty<string>(),
            TopperPayoutAmounts = Array.Empty<int>(),
            CreditLabel = "1 000",
            WinningsLabel = "0",
            BetLabel = "4"
        };

        Theme1RoundRenderState state = new Theme1StateBuilder().Build(input);
        if (!HasOnlyValidTheme1Numbers(state, out error))
        {
            error = "[Theme1DedicatedSmoke] Theme1StateBuilder tillot tall over 60.\n" + error;
            return false;
        }

        if (state.Cards == null ||
            state.Cards.Length == 0 ||
            !string.Equals(state.Cards[0].BetLabel, "Innsats - 1 kr", StringComparison.Ordinal))
        {
            error =
                "[Theme1DedicatedSmoke] Theme1StateBuilder viser ikke innsats per bong. " +
                $"expected='Innsats - 1 kr' actual='{state?.Cards?[0]?.BetLabel}'.";
            return false;
        }

        if (state.Cards == null ||
            state.Cards.Length == 0 ||
            state.Cards[0] == null ||
            state.Cards[0].Cells == null ||
            state.Cards[0].Cells.Length < 15 ||
            !string.Equals(state.Cards[0].Cells[14].NumberLabel, "-", StringComparison.Ordinal))
        {
            error = "[Theme1DedicatedSmoke] Theme1StateBuilder filtrerte ikke ut ugyldig ticket-tall > 60.";
            return false;
        }

        if (state.BallRack == null ||
            state.BallRack.Slots == null ||
            state.BallRack.Slots.Length < 2 ||
            !state.BallRack.Slots[0].IsVisible ||
            !string.Equals(state.BallRack.Slots[0].NumberLabel, "1", StringComparison.Ordinal) ||
            !state.BallRack.Slots[1].IsVisible ||
            !string.Equals(state.BallRack.Slots[1].NumberLabel, "4", StringComparison.Ordinal) ||
            !string.Equals(state.BallRack.BigBallNumber, "4", StringComparison.Ordinal))
        {
            error = "[Theme1DedicatedSmoke] Theme1StateBuilder beholdt ugyldige draw-nummer over 60 i ballrack.";
            return false;
        }

        Theme1StateBuildInput winInput = new Theme1StateBuildInput
        {
            GameId = "GAME-WIN-FORMAT",
            CardSlotCount = 1,
            BallSlotCount = 5,
            TicketSets = new[]
            {
                new[] { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15 }
            },
            DrawnNumbers = new[] { 1, 4, 7, 10, 13 },
            ActivePatternIndexes = new[] { 0 },
            PatternMasks = new[]
            {
                new byte[] { 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0 }
            },
            CardHeaderLabels = new[] { GameManager.FormatTheme1CardHeaderLabel(0) },
            CardBetLabels = new[] { GameManager.FormatTheme1CardStakeLabel(4) },
            CardWinLabels = new[] { string.Empty },
            TopperPrizeLabels = new[] { "200 kr" },
            TopperPayoutAmounts = new[] { 200 },
            CreditLabel = "1 000",
            WinningsLabel = "0",
            BetLabel = "4"
        };

        Theme1RoundRenderState winState = new Theme1StateBuilder().Build(winInput);
        if (winState.Cards == null ||
            winState.Cards.Length == 0 ||
            !winState.Cards[0].ShowWinLabel ||
            !string.Equals(winState.Cards[0].WinLabel, GameManager.FormatTheme1CardWinLabel(200), StringComparison.Ordinal))
        {
            error = "[Theme1DedicatedSmoke] Theme1StateBuilder bruker ikke 'Gevinst - {win} kr' ved positiv gevinst.";
            return false;
        }

        return true;
    }

    private static bool ValidateTheme1BuilderKeepsPatternsPerCard(out string error)
    {
        error = string.Empty;
        Theme1StateBuildInput input = new Theme1StateBuildInput
        {
            GameId = "GAME-PER-CARD",
            CardSlotCount = 4,
            BallSlotCount = 8,
            TicketSets = new[]
            {
                new[] { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15 },
                new[] { 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30 },
                new[] { 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45 },
                new[] { 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60 }
            },
            DrawnNumbers = new[] { 1, 4, 7, 10, 13, 16, 19, 22, 25 },
            ActivePatternIndexes = new[] { 0 },
            PatternMasks = new[]
            {
                new byte[] { 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0 }
            },
            CardHeaderLabels = new[]
            {
                GameManager.FormatTheme1CardHeaderLabel(0),
                GameManager.FormatTheme1CardHeaderLabel(1),
                GameManager.FormatTheme1CardHeaderLabel(2),
                GameManager.FormatTheme1CardHeaderLabel(3)
            },
            CardBetLabels = new[]
            {
                GameManager.FormatTheme1CardStakeLabel(4),
                GameManager.FormatTheme1CardStakeLabel(4),
                GameManager.FormatTheme1CardStakeLabel(4),
                GameManager.FormatTheme1CardStakeLabel(4)
            },
            CardWinLabels = new[] { string.Empty, string.Empty, string.Empty, string.Empty },
            TopperPrizeLabels = new[] { "200 kr" },
            TopperPayoutAmounts = new[] { 200 },
            CreditLabel = "1 000",
            WinningsLabel = "0",
            BetLabel = "4"
        };

        Theme1RoundRenderState state = new Theme1StateBuilder().Build(input);
        if (state.Cards == null || state.Cards.Length < 4)
        {
            error = "[Theme1DedicatedSmoke] Theme1StateBuilder returnerte ikke 4 kort i per-bong-test.";
            return false;
        }

        if (!state.Cards[0].PaylinesActive[0] ||
            state.Cards[1].PaylinesActive[0] ||
            state.Cards[2].PaylinesActive[0] ||
            state.Cards[3].PaylinesActive[0])
        {
            error = "[Theme1DedicatedSmoke] Theme1StateBuilder lekker matched pattern mellom bonger.";
            return false;
        }

        if (!state.Cards[1].Cells[12].IsMissing ||
            state.Cards[0].Cells[12].IsMissing ||
            state.Cards[2].Cells[12].IsMissing ||
            state.Cards[3].Cells[12].IsMissing)
        {
            error = "[Theme1DedicatedSmoke] Theme1StateBuilder lekker near-win mellom bonger.";
            return false;
        }

        return true;
    }

    private static bool ValidateDedicatedVisibleContract(Theme1GameplayViewRoot viewRoot, out string error)
    {
        error = string.Empty;
        if (viewRoot == null)
        {
            error = "[Theme1DedicatedSmoke] Theme1GameplayViewRoot mangler.";
            return false;
        }

        int cardLabelCount = 0;
        for (int cardIndex = 0; cardIndex < viewRoot.Cards.Length; cardIndex++)
        {
            Theme1CardGridView card = viewRoot.Cards[cardIndex];
            if (card == null)
            {
                error = $"[Theme1DedicatedSmoke] Card view {cardIndex} mangler.";
                return false;
            }

            if (!HasDedicatedLabelName(card.HeaderLabel, $"RealtimeCardHeaderLabel_{cardIndex + 1}") ||
                !HasDedicatedLabelName(card.BetLabel, $"RealtimeCardBetLabel_{cardIndex + 1}") ||
                !HasDedicatedLabelName(card.WinLabel, $"RealtimeCardWinLabel_{cardIndex + 1}"))
            {
                error = $"[Theme1DedicatedSmoke] Card {cardIndex + 1} bruker ikke dedikerte header/bet/win-labels.";
                return false;
            }

            for (int cellIndex = 0; cellIndex < card.Cells.Length; cellIndex++)
            {
                TextMeshProUGUI label = card.Cells[cellIndex]?.NumberLabel;
                if (label == null ||
                    (!string.Equals(label.gameObject.name, "RealtimeCardNumberLabel", StringComparison.Ordinal) &&
                     !string.Equals(label.gameObject.name, "RealtimeCardNumberVisibleLabel", StringComparison.Ordinal)) ||
                    label.transform.parent == null ||
                    !label.transform.parent.name.StartsWith("RealtimeCardCell_", StringComparison.Ordinal) ||
                    label.transform.parent.parent == null ||
                    !string.Equals(label.transform.parent.parent.name, "RealtimeCardNumbers", StringComparison.Ordinal))
                {
                    error = $"[Theme1DedicatedSmoke] Card {cardIndex + 1} cell {cellIndex + 1} peker ikke til dedikert RealtimeCardNumbers-lag.";
                    return false;
                }

                if (card.Cells[cellIndex]?.SelectionOverlay == null ||
                    card.Cells[cellIndex].SelectionOverlay.transform.parent != label.transform.parent ||
                    card.Cells[cellIndex]?.MissingOverlay == null ||
                    card.Cells[cellIndex].MissingOverlay.transform.parent != label.transform.parent ||
                    card.Cells[cellIndex]?.MatchedOverlay == null ||
                    card.Cells[cellIndex].MatchedOverlay.transform.parent != label.transform.parent)
                {
                    error = $"[Theme1DedicatedSmoke] Card {cardIndex + 1} cell {cellIndex + 1} har ikke alle overlays bundet til samme celle-root.";
                    return false;
                }

                cardLabelCount += 1;
            }
        }

        if (cardLabelCount != 60)
        {
            error = $"[Theme1DedicatedSmoke] Forventet 60 dedikerte kortlabels. Fikk {cardLabelCount}.";
            return false;
        }

        Theme1HudBarView hud = viewRoot.HudBar;
        if (!HasDedicatedLabelName(hud?.CreditText, "RealtimeCreditValueLabel") ||
            !HasDedicatedLabelName(hud?.WinningsText, "RealtimeWinningsValueLabel") ||
            !HasDedicatedLabelName(hud?.BetText, "RealtimeBetValueLabel"))
        {
            error = "[Theme1DedicatedSmoke] HUD peker ikke til dedikerte verdi-labels.";
            return false;
        }

        Theme1TopperStripView topper = viewRoot.TopperStrip;
        for (int slotIndex = 0; topper?.Slots != null && slotIndex < topper.Slots.Length; slotIndex++)
        {
            if (!HasDedicatedLabelName(topper.Slots[slotIndex]?.PrizeLabel, $"RealtimeTopperPrizeLabel_{slotIndex + 1}"))
            {
                error = $"[Theme1DedicatedSmoke] Topper slot {slotIndex + 1} peker ikke til dedikert prize-label.";
                return false;
            }
        }

        if (CandyBallVisualCatalog.ExpectedBallCount != 60)
        {
            error = $"[Theme1DedicatedSmoke] Ballkatalogen forventer ikke 60 baller. Fikk {CandyBallVisualCatalog.ExpectedBallCount}.";
            return false;
        }

        return true;
    }

    private static bool HasDedicatedLabelName(TMP_Text label, string expectedName)
    {
        return label != null &&
               label.gameObject != null &&
               string.Equals(label.gameObject.name, expectedName, StringComparison.Ordinal);
    }

    private static bool HasMatchedPayline(Theme1RoundRenderState state)
    {
        if (state?.Cards == null)
        {
            return false;
        }

        for (int cardIndex = 0; cardIndex < state.Cards.Length; cardIndex++)
        {
            bool[] paylineStates = state.Cards[cardIndex]?.PaylinesActive;
            if (paylineStates == null)
            {
                continue;
            }

            for (int i = 0; i < paylineStates.Length; i++)
            {
                if (paylineStates[i])
                {
                    return true;
                }
            }
        }

        return false;
    }

    private static bool HasNearWinCell(Theme1RoundRenderState state)
    {
        if (state?.Cards == null)
        {
            return false;
        }

        for (int cardIndex = 0; cardIndex < state.Cards.Length; cardIndex++)
        {
            Theme1CardCellRenderState[] cells = state.Cards[cardIndex]?.Cells;
            if (cells == null)
            {
                continue;
            }

            for (int i = 0; i < cells.Length; i++)
            {
                if (cells[i].IsMissing)
                {
                    return true;
                }
            }
        }

        return false;
    }

    private static string BuildPaylineDebugSummary(Theme1RoundRenderState state)
    {
        if (state?.Cards == null)
        {
            return "paylines=<missing-state>";
        }

        List<string> cards = new List<string>();
        for (int cardIndex = 0; cardIndex < state.Cards.Length; cardIndex++)
        {
            bool[] paylineStates = state.Cards[cardIndex]?.PaylinesActive;
            if (paylineStates == null)
            {
                cards.Add($"card{cardIndex}=<null>");
                continue;
            }

            List<int> active = new List<int>();
            for (int i = 0; i < paylineStates.Length; i++)
            {
                if (paylineStates[i])
                {
                    active.Add(i);
                }
            }

            cards.Add($"card{cardIndex}=[{string.Join(",", active)}]/len={paylineStates.Length}");
        }

        return "paylines=" + string.Join(";", cards);
    }

    private static void SetSerializedBool(SerializedObject serializedObject, string propertyName, bool value)
    {
        SerializedProperty property = serializedObject.FindProperty(propertyName);
        if (property != null)
        {
            property.boolValue = value;
        }
    }

    private static void HandleLogMessage(string condition, string stackTrace, LogType type)
    {
        if (!isRunning || type != LogType.Exception)
        {
            return;
        }

        Fail("[Theme1DedicatedSmoke] Exception logged: " + condition);
    }

    private static void HandlePlayModeStateChanged(PlayModeStateChange stateChange)
    {
        if (!isRunning)
        {
            return;
        }

        if (stateChange == PlayModeStateChange.EnteredEditMode &&
            (stage == SmokeStage.Completed || stage == SmokeStage.Failed))
        {
            Finish();
        }
    }

    private static void Complete(string message)
    {
        finishMessage = "[Theme1DedicatedSmoke] RESULT status=PASS message=\"" + message + "\"";
        exitCode = 0;
        stage = SmokeStage.Completed;
        Debug.Log(finishMessage);
        EditorApplication.isPlaying = false;
    }

    private static void Fail(string reason)
    {
        finishMessage = "[Theme1DedicatedSmoke] RESULT status=FAIL reason=\"" + reason + "\"";
        exitCode = 1;
        stage = SmokeStage.Failed;
        Debug.LogError(finishMessage);
        EditorApplication.isPlaying = false;
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
            EditorApplication.Exit(exitCode);
        }
    }
}
