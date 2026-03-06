using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Reflection;
using SimpleJSON;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

public static class CandyRealtimeDrawLoopBenchmark
{
    private static readonly string[] CandidateScenePaths =
    {
        "Assets/Scenes/Theme1.unity",
        "Assets/Scenes/Theme2.unity"
    };
    private const int Iterations = 80;
    private const int WarmupIterations = 5;
    private const string BenchmarkPlayerId = "benchmark-player";
    private const string BenchmarkRoomCode = "BENCH";
    private const string BenchmarkHallId = "HALL-BENCH";
    private const string BenchmarkGameId = "GAME-BENCH";

    [MenuItem("Tools/Candy/Tests/Run Realtime Draw Loop Benchmark")]
    public static void RunRealtimeDrawLoopBenchmark()
    {
        APIManager apiManager = null;
        GameManager gameManager = null;
        NumberGenerator generator = null;
        string resolvedScenePath = string.Empty;

        for (int i = 0; i < CandidateScenePaths.Length; i++)
        {
            string candidateScenePath = CandidateScenePaths[i];
            SceneAsset sceneAsset = AssetDatabase.LoadAssetAtPath<SceneAsset>(candidateScenePath);
            if (sceneAsset == null)
            {
                continue;
            }

            EditorSceneManager.OpenScene(candidateScenePath, OpenSceneMode.Single);

            apiManager = UnityEngine.Object.FindFirstObjectByType<APIManager>(FindObjectsInactive.Include);
            gameManager = GameManager.instance ?? UnityEngine.Object.FindFirstObjectByType<GameManager>(FindObjectsInactive.Include);
            generator = gameManager != null ? gameManager.numberGenerator : null;
            if (apiManager != null && generator != null && generator.cardClasses != null)
            {
                resolvedScenePath = candidateScenePath;
                break;
            }
        }

        if (apiManager == null || generator == null || generator.cardClasses == null)
        {
            throw new Exception("[DrawLoopBenchmark] Mangler APIManager/GameManager/NumberGenerator i scene.");
        }

        MethodInfo handleRealtimeRoomUpdateMethod = typeof(APIManager).GetMethod(
            "HandleRealtimeRoomUpdate",
            BindingFlags.Instance | BindingFlags.NonPublic);
        if (handleRealtimeRoomUpdateMethod == null)
        {
            throw new Exception("[DrawLoopBenchmark] Fant ikke APIManager.HandleRealtimeRoomUpdate via reflection.");
        }

        FieldInfo processedDrawCountField = typeof(APIManager).GetField(
            "processedDrawCount",
            BindingFlags.Instance | BindingFlags.NonPublic);
        if (processedDrawCountField == null)
        {
            throw new Exception("[DrawLoopBenchmark] Fant ikke APIManager.processedDrawCount via reflection.");
        }

        FieldInfo activePlayerIdField = typeof(APIManager).GetField(
            "activePlayerId",
            BindingFlags.Instance | BindingFlags.NonPublic);
        if (activePlayerIdField == null)
        {
            throw new Exception("[DrawLoopBenchmark] Fant ikke APIManager.activePlayerId via reflection.");
        }

        FieldInfo activeGameIdField = typeof(APIManager).GetField(
            "activeGameId",
            BindingFlags.Instance | BindingFlags.NonPublic);
        if (activeGameIdField == null)
        {
            throw new Exception("[DrawLoopBenchmark] Fant ikke APIManager.activeGameId via reflection.");
        }

        FieldInfo activeTicketSetsField = typeof(APIManager).GetField(
            "activeTicketSets",
            BindingFlags.Instance | BindingFlags.NonPublic);
        if (activeTicketSetsField == null)
        {
            throw new Exception("[DrawLoopBenchmark] Fant ikke APIManager.activeTicketSets via reflection.");
        }

        activePlayerIdField.SetValue(apiManager, BenchmarkPlayerId);
        activeGameIdField.SetValue(apiManager, BenchmarkGameId);

        JSONNode snapshotNode = BuildBenchmarkSnapshotNode();
        ResetCardStates(generator);
        processedDrawCountField.SetValue(apiManager, 0);
        activeTicketSetsField.SetValue(apiManager, new List<List<int>>());
        handleRealtimeRoomUpdateMethod.Invoke(apiManager, new object[] { snapshotNode });

        List<double> samplesMs = new List<double>(Iterations);
        Stopwatch stopwatch = new Stopwatch();

        for (int i = 0; i < WarmupIterations; i++)
        {
            ResetCardStates(generator);
            processedDrawCountField.SetValue(apiManager, 0);
            activeTicketSetsField.SetValue(apiManager, new List<List<int>>());
            handleRealtimeRoomUpdateMethod.Invoke(apiManager, new object[] { snapshotNode });
        }

        for (int i = 0; i < Iterations; i++)
        {
            ResetCardStates(generator);
            processedDrawCountField.SetValue(apiManager, 0);
            activeTicketSetsField.SetValue(apiManager, new List<List<int>>());

            stopwatch.Restart();
            handleRealtimeRoomUpdateMethod.Invoke(apiManager, new object[] { snapshotNode });
            stopwatch.Stop();

            samplesMs.Add(stopwatch.Elapsed.TotalMilliseconds);
        }

        samplesMs.Sort();
        double p50 = Percentile(samplesMs, 50);
        double p95 = Percentile(samplesMs, 95);
        double avg = samplesMs.Average();
        double min = samplesMs.FirstOrDefault();
        double max = samplesMs.LastOrDefault();

        UnityEngine.Debug.Log(
            $"[DrawLoopBenchmark] scene={resolvedScenePath} iterations={Iterations} drawCount=30 " +
            $"avgMs={avg:F3} p50Ms={p50:F3} p95Ms={p95:F3} minMs={min:F3} maxMs={max:F3}");
    }

    private static JSONNode BuildBenchmarkSnapshotNode()
    {
        JSONObject snapshot = new JSONObject();
        snapshot["code"] = BenchmarkRoomCode;
        snapshot["hallId"] = BenchmarkHallId;

        JSONObject currentGame = new JSONObject();
        JSONArray drawnNumbers = new JSONArray();
        for (int i = 1; i <= 30; i++)
        {
            drawnNumbers.Add(i);
        }

        currentGame["id"] = BenchmarkGameId;
        currentGame["status"] = "RUNNING";
        currentGame["drawnNumbers"] = drawnNumbers;
        currentGame["claims"] = new JSONArray();
        currentGame["tickets"] = BuildBenchmarkTicketsNode();
        snapshot["currentGame"] = currentGame;
        return snapshot;
    }

    private static JSONNode BuildBenchmarkTicketsNode()
    {
        JSONObject ticketsByPlayer = new JSONObject();
        JSONArray ticketSets = new JSONArray();
        for (int cardNo = 0; cardNo < 4; cardNo++)
        {
            JSONArray cardNumbers = new JSONArray();
            int start = (cardNo * 15) + 1;
            for (int cell = 0; cell < 15; cell++)
            {
                cardNumbers.Add(start + cell);
            }

            ticketSets.Add(cardNumbers);
        }

        ticketsByPlayer[BenchmarkPlayerId] = ticketSets;
        return ticketsByPlayer;
    }

    private static void ResetCardStates(NumberGenerator generator)
    {
        if (generator == null || generator.cardClasses == null)
        {
            return;
        }

        for (int cardNo = 0; cardNo < generator.cardClasses.Length; cardNo++)
        {
            CardClass card = generator.cardClasses[cardNo];
            if (card == null)
            {
                continue;
            }

            int paylineCount = card.payLinePattern != null ? card.payLinePattern.Count : 0;
            for (int i = 0; i < paylineCount; i++)
            {
                card.payLinePattern[i] = 0;
            }

            if (card.selectionImg != null)
            {
                for (int i = 0; i < card.selectionImg.Count; i++)
                {
                    if (card.selectionImg[i] != null && card.selectionImg[i].activeSelf)
                    {
                        card.selectionImg[i].SetActive(false);
                    }
                }
            }
        }
    }

    private static double Percentile(List<double> sortedSamples, double percentile)
    {
        if (sortedSamples == null || sortedSamples.Count == 0)
        {
            return 0d;
        }

        double clampedPercentile = Mathf.Clamp01((float)(percentile / 100d));
        double rawIndex = clampedPercentile * (sortedSamples.Count - 1);
        int lowerIndex = Mathf.FloorToInt((float)rawIndex);
        int upperIndex = Mathf.CeilToInt((float)rawIndex);
        if (lowerIndex == upperIndex)
        {
            return sortedSamples[lowerIndex];
        }

        double t = rawIndex - lowerIndex;
        return sortedSamples[lowerIndex] + ((sortedSamples[upperIndex] - sortedSamples[lowerIndex]) * t);
    }
}
