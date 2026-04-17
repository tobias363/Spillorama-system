// Phase 2 del 2: Spillorama ↔ AIS game event bridge.
//
// Subscribes to SpilloramaSocketManager.OnRoomUpdate and OnDrawNew,
// parses the raw JSON, and re-publishes as strongly-typed C# events that
// game panels (Game1/2/3GamePlayPanel.SocketFlow) can subscribe to.
//
// Game panels check SpilloramaGameBridge.UseSpilloramaPath before
// deciding whether to subscribe to AIS or Spillorama events.
//
// Data-model translation:
//   Spillorama                AIS equivalent
//   ──────────────────────────────────────────────
//   draw:new  { number }   →  BingoNumberData.number
//   currentGame.status     →  gameStatus "running" / "Finished" / "Waiting"
//   players.Length         →  activePlayers
//   drawnNumbers[]         →  withdrawNumberList (BingoNumberData list)
//   currentGame.id         →  gameId
//
//   NOT in Spillorama (kept as defaults):
//   patternList, jackPotData, luckyNumber, minigameData, gameName (Elvis etc.)

using System;
using System.Collections.Generic;
using UnityEngine;

// ── Serialisable shapes for room:update JSON (subset) ───────────────────────

[Serializable]
public class SpilloramaPatternDefRaw
{
    public string id         = "";
    public string name       = "";
    public string claimType  = "";   // "LINE" | "BINGO"
    public float  prizePercent = 0f;
    public int    order      = 0;
    public int    design     = 0;    // 1=row, 2=full house, 0=custom
}

[Serializable]
public class SpilloramaPatternResultRaw
{
    public string patternId   = "";
    public string patternName = "";
    public string claimType   = "";
    public bool   isWon       = false;
    public string winnerId    = "";
    public int    wonAtDraw   = 0;
    public float  payoutAmount = 0f;
    public string claimId     = "";
}

[Serializable]
public class SpilloramaCurrentGameRaw
{
    public string id        = "";
    public string status    = "";   // "WAITING" | "RUNNING" | "ENDED"
    public float  entryFee  = 0f;
    public int[]  drawnNumbers;
    public int    remainingNumbers  = 75;
    public SpilloramaPatternDefRaw[]    patterns;
    public SpilloramaPatternResultRaw[] patternResults;
    public string startedAt = "";
    public string endedAt   = "";
}

[Serializable]
public class SpilloramaPlayerRaw
{
    public string id       = "";
    public string name     = "";
    public string walletId = "";
}

[Serializable]
public class SpilloramaSchedulerRaw
{
    public bool   enabled              = false;
    public int    intervalMs           = 0;
    public int    minPlayers           = 0;
    public int    playerCount          = 0;
    public int    drawCapacity         = 30;
    public int    currentDrawCount     = 0;
    public int    remainingDrawCapacity = 30;
    public string nextStartAt          = "";
    public float  millisUntilNextStart = -1f;
    public bool   canStartNow         = false;
    public string serverTime          = "";
}

[Serializable]
public class SpilloramaSnapshotRaw
{
    public string                     code      = "";
    public string                     hallId    = "";
    public SpilloramaCurrentGameRaw   currentGame;
    public SpilloramaPlayerRaw[]      players;
    public SpilloramaSchedulerRaw     scheduler;
    public long                       serverTimestamp;
}

[Serializable]
public class SpilloramaChatMessageRaw
{
    public string id         = "";
    public string playerId   = "";
    public string playerName = "";
    public string message    = "";
    public int    emojiId    = 0;
    public string createdAt  = "";
}

[Serializable]
public class SpilloramaPatternWonRaw
{
    public string patternId   = "";
    public string patternName = "";
    public string winnerId    = "";
    public int    wonAtDraw   = 0;
    public float  payoutAmount = 0f;
    public string claimType   = "";
    public string gameId      = "";
}

// ── Bridge ──────────────────────────────────────────────────────────────────

public class SpilloramaGameBridge : MonoBehaviour
{
    public static SpilloramaGameBridge Instance { get; private set; }

    // ── Public events (game panels subscribe to these) ───────────────────────
    /// Fires when draw:new is received. Payload is a ready-to-use BingoNumberData.
    public static event Action<BingoNumberData> OnBallDrawn;
    /// Fires when room:update shows currentGame.status transition → RUNNING.
    public static event Action OnGameStarted;
    /// Fires when room:update shows currentGame.status transition → ENDED.
    public static event Action<string> OnGameFinished;   // gameId
    /// Fires on every room:update (including initial join broadcast).
    public static event Action<SpilloramaSnapshotRaw> OnRoomStateUpdated;
    /// Fires when a pattern is won (pattern:won broadcast).
    public static event Action<SpilloramaPatternWonRaw> OnPatternWon;
    /// Fires on every room:update with translated PatternData list.
    public static event Action<List<PatternData>> OnPatternListUpdated;
    /// Fires when a chat message is received.
    public static event Action<SpilloramaChatMessageRaw> OnChatReceived;
    /// Fires when scheduler/timer state changes (from room:update).
    public static event Action<SpilloramaSchedulerRaw> OnSchedulerUpdated;

    // ── Latest snapshot accessible to panels for CallSubscribeRoom_Spillorama ─
    public static SpilloramaSnapshotRaw LatestSnapshot { get; private set; }

    /// True when the Spillorama socket is connected and panels should use
    /// the Spillorama event path instead of AIS socket events.
    public static bool UseSpilloramaPath => SpilloramaSocketManager.IsConnected;

    // ── Internal state ────────────────────────────────────────────────────────
    private string _lastGameStatus = "";
    private string _lastGameId     = "";
    private int    _lastDrawIndex  = -1;  // deduplicate draw:new

    // ── Unity ─────────────────────────────────────────────────────────────────

    private void Awake()
    {
        if (Instance == null) Instance = this;
        else { Destroy(gameObject); return; }
    }

    private void OnEnable()
    {
        SpilloramaSocketManager.OnRoomUpdate  += HandleRoomUpdate;
        SpilloramaSocketManager.OnDrawNew     += HandleDrawNew;
        SpilloramaSocketManager.OnPatternWon  += HandlePatternWon;
        SpilloramaSocketManager.OnChatMessage += HandleChatMessage;
    }

    private void OnDisable()
    {
        SpilloramaSocketManager.OnRoomUpdate  -= HandleRoomUpdate;
        SpilloramaSocketManager.OnDrawNew     -= HandleDrawNew;
        SpilloramaSocketManager.OnPatternWon  -= HandlePatternWon;
        SpilloramaSocketManager.OnChatMessage -= HandleChatMessage;
    }

    // ── Incoming event handlers ───────────────────────────────────────────────

    private void HandleRoomUpdate(string rawJson)
    {
        SpilloramaSnapshotRaw snap;
        try
        {
            snap = JsonUtility.FromJson<SpilloramaSnapshotRaw>(rawJson);
        }
        catch (Exception ex)
        {
            Debug.LogWarning("[SpilloramaBridge] room:update parse error: " + ex.Message);
            return;
        }

        if (snap == null) return;
        LatestSnapshot = snap;
        OnRoomStateUpdated?.Invoke(snap);

        // Detect game status transitions
        string newStatus = snap.currentGame?.status ?? "";
        string newGameId = snap.currentGame?.id ?? "";

        bool isNewGame = !string.IsNullOrEmpty(newGameId) && newGameId != _lastGameId;

        if (isNewGame || newStatus != _lastGameStatus)
        {
            if (newStatus == "RUNNING" && _lastGameStatus != "RUNNING")
            {
                Debug.Log($"[SpilloramaBridge] Game started: {newGameId}");
                OnGameStarted?.Invoke();
            }
            else if ((newStatus == "ENDED" || newStatus == "NONE" || string.IsNullOrEmpty(newStatus))
                      && _lastGameStatus == "RUNNING")
            {
                Debug.Log($"[SpilloramaBridge] Game finished: {_lastGameId}");
                OnGameFinished?.Invoke(_lastGameId);
            }
        }

        _lastGameStatus = newStatus;
        if (!string.IsNullOrEmpty(newGameId)) _lastGameId = newGameId;

        // Translate pattern data for game panels
        if (snap.currentGame?.patterns != null)
        {
            var patternList = BuildPatternDataList(snap.currentGame);
            OnPatternListUpdated?.Invoke(patternList);
        }

        // Publish scheduler/timer state
        if (snap.scheduler != null)
        {
            OnSchedulerUpdated?.Invoke(snap.scheduler);
        }
    }

    private void HandleDrawNew(string rawJson)
    {
        SpilloramaDrawNewPayload draw;
        try { draw = JsonUtility.FromJson<SpilloramaDrawNewPayload>(rawJson); }
        catch { return; }

        if (draw == null) return;

        // Deduplicate: same drawIndex from reconnect broadcasts
        if (draw.drawIndex == _lastDrawIndex) return;
        _lastDrawIndex = draw.drawIndex;

        var bingoData = new BingoNumberData
        {
            number            = draw.number,
            totalWithdrawCount = draw.drawIndex,
            isForPlayerApp    = true,
            color             = "",
            nextColor         = ""
        };

        Debug.Log($"[SpilloramaBridge] draw:new ball={draw.number} drawIndex={draw.drawIndex}");
        OnBallDrawn?.Invoke(bingoData);
    }

    private void HandlePatternWon(string rawJson)
    {
        SpilloramaPatternWonRaw won;
        try { won = JsonUtility.FromJson<SpilloramaPatternWonRaw>(rawJson); }
        catch { return; }
        if (won == null) return;
        Debug.Log($"[SpilloramaBridge] pattern:won {won.patternName} by {won.winnerId}");
        OnPatternWon?.Invoke(won);
    }

    private void HandleChatMessage(string rawJson)
    {
        SpilloramaChatMessageRaw msg;
        try { msg = JsonUtility.FromJson<SpilloramaChatMessageRaw>(rawJson); }
        catch { return; }
        if (msg == null) return;
        OnChatReceived?.Invoke(msg);
    }

    // ── Translation helpers ───────────────────────────────────────────────────

    /// Builds a PatternData list from Spillorama game patterns, compatible
    /// with the AIS PatternData format used by Game 1/3 panels.
    public static List<PatternData> BuildPatternDataList(SpilloramaCurrentGameRaw game)
    {
        var list = new List<PatternData>();
        if (game?.patterns == null) return list;

        int lastBall = (game.drawnNumbers != null && game.drawnNumbers.Length > 0)
            ? game.drawnNumbers[game.drawnNumbers.Length - 1]
            : 0;

        for (int i = 0; i < game.patterns.Length; i++)
        {
            var def = game.patterns[i];
            var result = (game.patternResults != null && i < game.patternResults.Length)
                ? game.patternResults[i]
                : null;

            float prizeAmount = game.entryFee * def.prizePercent; // approximate display amount

            list.Add(new PatternData
            {
                _id              = def.id,
                name             = def.name,
                amount           = prizeAmount,
                patternDataList  = new List<int>(),  // no fixed cell mask for built-in patterns
                patternDesign    = def.design,
                ballNumber       = lastBall,
                isWon            = result?.isWon ?? false
            });
        }

        return list;
    }

    /// Builds a partial BingoGame1History from a Spillorama snapshot.
    /// Pattern data is now populated from the snapshot when available.
    /// set to safe defaults — they don't exist in the Spillorama game engine.
    public static BingoGame1History BuildGame1History(SpilloramaSnapshotRaw snap, string myPlayerId)
    {
        var history = new BingoGame1History();
        if (snap == null) return history;

        history.activePlayers = snap.players?.Length ?? 0;

        var game = snap.currentGame;
        if (game != null)
        {
            history.gameId            = game.id;
            history.gameStatus        = MapGameStatus1(game.status);
            history.totalWithdrawCount = game.drawnNumbers?.Length ?? 0;
            history.maxWithdrawCount   = (game.drawnNumbers?.Length ?? 0) + game.remainingNumbers;
            history.withdrawNumberList = BuildWithdrawList(game.drawnNumbers);
            history.patternList        = BuildPatternDataList(game);
            history.jackPotData        = new JackPotData { isDisplay = false };
            history.minigameData       = new MinigameData();
        }

        return history;
    }

    /// Builds a partial BingoGame2History from a Spillorama snapshot.
    public static BingoGame2History BuildGame2History(SpilloramaSnapshotRaw snap)
    {
        var history = new BingoGame2History();
        if (snap == null) return history;

        history.activePlayers = snap.players?.Length ?? 0;

        var game = snap.currentGame;
        if (game != null)
        {
            history.gameId            = game.id;
            history.gameStarted       = game.status == "RUNNING";
            history.totalWithdrawCount = game.drawnNumbers?.Length ?? 0;
            history.maxWithdrawCount   = (game.drawnNumbers?.Length ?? 0) + game.remainingNumbers;
            history.withdrawNumberList = BuildWithdrawList(game.drawnNumbers);
        }

        return history;
    }

    /// Builds a partial BingoGame3History from a Spillorama snapshot.
    public static BingoGame3History BuildGame3History(SpilloramaSnapshotRaw snap)
    {
        var history = new BingoGame3History();
        if (snap == null) return history;

        history.activePlayers = snap.players?.Length ?? 0;

        var game = snap.currentGame;
        if (game != null)
        {
            history.gameId            = game.id;
            history.totalWithdrawCount = game.drawnNumbers?.Length ?? 0;
            history.maxWithdrawCount   = (game.drawnNumbers?.Length ?? 0) + game.remainingNumbers;
            history.withdrawNumberList = BuildWithdrawList(game.drawnNumbers);
            history.patternList        = BuildPatternDataList(game);
            history.jackPotData        = new JackPotData { isDisplay = false };
        }

        return history;
    }

    /// Builds a partial Game5Data from a Spillorama snapshot.
    public static Game5Data BuildGame5Data(SpilloramaSnapshotRaw snap)
    {
        var data = new Game5Data();
        data.ticketList = new List<TicketList>();
        data.withdrawBalls = new List<BingoNumberData>();
        data.coins = new List<int>();
        data.rouletteData = new List<int>();
        data.miniGameData = new MiniGameData();

        if (snap == null) return data;

        var game = snap.currentGame;
        if (game != null)
        {
            data.gameId = game.id;
            data.status = game.status == "RUNNING" ? "Running" : "Waiting";
            data.totalWithdrawableBalls = (game.drawnNumbers?.Length ?? 0) + game.remainingNumbers;
            if (game.drawnNumbers != null)
            {
                for (int i = 0; i < game.drawnNumbers.Length; i++)
                {
                    data.withdrawBalls.Add(new BingoNumberData
                    {
                        number = game.drawnNumbers[i],
                        totalWithdrawCount = i + 1,
                        isForPlayerApp = true
                    });
                }
            }
            data.patternList = BuildGame5PatternList(game);
        }
        else
        {
            data.status = "Waiting";
        }

        return data;
    }

    private static List<PatternList> BuildGame5PatternList(SpilloramaCurrentGameRaw game)
    {
        var list = new List<PatternList>();
        if (game?.patterns == null) return list;

        for (int i = 0; i < game.patterns.Length; i++)
        {
            var def = game.patterns[i];
            list.Add(new PatternList
            {
                multiplier = def.prizePercent.ToString(),
                pattern = new List<int>(),
                extraWinningsType = ""
            });
        }

        return list;
    }

    /// Builds a partial Game4Data from a Spillorama snapshot.
    public static Game4Data BuildGame4Data(SpilloramaSnapshotRaw snap)
    {
        var data = new Game4Data();
        if (snap == null) return data;

        var game = snap.currentGame;
        if (game != null)
        {
            data.gameId = game.id;
            data.status = game.status == "RUNNING" ? "Running" : "Waiting";
        }
        else
        {
            data.status = "Waiting";
        }

        return data;
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private static List<BingoNumberData> BuildWithdrawList(int[] drawnNumbers)
    {
        var list = new List<BingoNumberData>();
        if (drawnNumbers == null) return list;
        for (int i = 0; i < drawnNumbers.Length; i++)
        {
            list.Add(new BingoNumberData
            {
                number            = drawnNumbers[i],
                totalWithdrawCount = i + 1,
                isForPlayerApp    = true
            });
        }
        return list;
    }

    private static string MapGameStatus1(string spilloramaStatus) => spilloramaStatus switch
    {
        "RUNNING" => "running",
        "ENDED"   => "Finished",
        _         => "Waiting"
    };
}
