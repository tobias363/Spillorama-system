// Phase 2: Spillorama Socket.IO client.
//
// Connects to the Spillorama backend (same origin in WebGL) with JWT auth.
// Each emitted event includes { accessToken } in the payload.
// Listens to `room:update` and `draw:new` broadcasts and re-publishes them
// as C# static events so game panels can subscribe without depending on AIS.
//
// This manager runs in PARALLEL with GameSocketManager during the Phase 2
// migration period. When all AIS game event dependencies are removed from the
// Unity panels, GameSocketManager can be disabled.
//
// Auth flow:
//   UIManager.ReceiveShellToken(jwt) → _shellJwt set
//   SpilloramaSocketManager.Connect() called by UIManager after JWT received
//   Each socket event payload: { accessToken = jwt, ... }

using System;
using System.Collections;
using BestHTTP.SocketIO;
using PlatformSupport.Collections.ObjectModel;
using UnityEngine;

// ── Spillorama socket payload shapes ────────────────────────────────────────

[Serializable]
public class SpilloramaRoomUpdatePayload
{
    public string code;
    public string hallId;
    public string hostPlayerId;
    public string createdAt;
    // currentGame is intentionally omitted — panels use the serialized JSON
    // string directly to avoid deep nullable nesting in Unity's JsonUtility
    public long serverTimestamp;
}

[Serializable]
public class SpilloramaDrawNewPayload
{
    public int number;
    public string source;    // "auto" | "admin"
    public int drawIndex;
    public string gameId;
}

[Serializable]
internal class SpilloramaRoomActionPayload
{
    public string accessToken;
    public string roomCode;
}

[Serializable]
internal class SpilloramaJoinRoomPayload
{
    public string accessToken;
    public string roomCode;
    public string hallId;
}

[Serializable]
internal class SpilloramaTicketMarkPayload
{
    public string accessToken;
    public string roomCode;
    public string ticketId;
    public int number;
}

[Serializable]
internal class SpilloramaClaimPayload
{
    public string accessToken;
    public string roomCode;
    public string ticketId;
    public string claimType;   // "LINE" | "BINGO"
}

[Serializable]
internal class SpilloramaChatSendPayload
{
    public string accessToken;
    public string roomCode;
    public string message;
    public int emojiId;
}

[Serializable]
internal class SpilloramaLuckyNumberPayload
{
    public string accessToken;
    public string roomCode;
    public int luckyNumber;
}

[Serializable]
internal class SpilloramaLeaderboardPayload
{
    public string accessToken;
    public string roomCode;
}

[Serializable]
internal class SpilloramaAckResponse
{
    public bool ok;
    public string errorCode;
    public string errorMessage;
}

// ── Manager ──────────────────────────────────────────────────────────────────

public class SpilloramaSocketManager : MonoBehaviour
{
    public static SpilloramaSocketManager Instance
    {
        get
        {
            if (_instance == null)
            {
                _instance = FindFirstObjectByType<SpilloramaSocketManager>();
                if (_instance == null)
                {
                    var go = GameObject.Find("SpilloramaApiClient")
                          ?? new GameObject("SpilloramaRuntime");
                    _instance = go.AddComponent<SpilloramaSocketManager>();
                    DontDestroyOnLoad(go);
                }
            }
            return _instance;
        }
        private set => _instance = value;
    }
    private static SpilloramaSocketManager _instance;

    // ── Public events (mirrors AIS BroadcastName pattern) ────────────────────
    // Handlers receive the raw JSON string so panels can parse as needed.
    public static event Action<string> OnRoomUpdate;     // room:update → full snapshot JSON
    public static event Action<string> OnDrawNew;        // draw:new → { number, source, drawIndex, gameId }
    public static event Action<string> OnPatternWon;     // pattern:won → pattern result JSON
    public static event Action<string> OnChatMessage;    // chat:message → chat message JSON
    public static event Action          OnRoomJoined;    // successful room:join/create ack
    public static event Action<string>  OnSocketError;   // connection/auth errors

    // ── Current room state ────────────────────────────────────────────────────
    public static string ActiveRoomCode { get; private set; } = "";
    public static bool   IsConnected    { get; private set; } = false;

    private static SocketManager _socketManager;
    private static Socket        _socket;

    private const string EVT_CONNECT      = "connect";
    private const string EVT_DISCONNECT   = "disconnect";
    private const string EVT_ROOM_UPDATE  = "room:update";
    private const string EVT_DRAW_NEW     = "draw:new";
    private const string EVT_PATTERN_WON  = "pattern:won";
    private const string EVT_CHAT_MESSAGE = "chat:message";

    // ── Unity ─────────────────────────────────────────────────────────────────

    private void Awake()
    {
        if (_instance == null) { _instance = this; }
        else if (_instance != this) { Destroy(gameObject); return; }
    }

    private void OnDestroy()
    {
        Disconnect();
    }

    // ── Connection ────────────────────────────────────────────────────────────

    /// <summary>
    /// Opens a Socket.IO connection to the Spillorama backend.
    /// Should be called after UIManager.ReceiveShellToken has set ShellJwt.
    /// Safe to call multiple times — no-ops if already connected with same JWT.
    /// </summary>
    public void Connect()
    {
        if (string.IsNullOrEmpty(UIManager.Instance?.ShellJwt))
        {
            Debug.LogWarning("[SpilloramaSocket] Connect() called but ShellJwt is empty — skipping");
            return;
        }

        if (_socket != null && IsConnected)
        {
            Debug.Log("[SpilloramaSocket] Already connected, skipping reconnect");
            return;
        }

        string baseUrl = UIManager.Instance.GetSpilloramaBaseUrlPublic();
        Debug.Log($"[SpilloramaSocket] Connecting to {baseUrl}");

        var options = new SocketOptions
        {
            ReconnectionAttempts   = 300,
            ReconnectionDelayMax   = TimeSpan.FromSeconds(5),
            ReconnectionDelay      = TimeSpan.FromMilliseconds(500),
            Timeout                = TimeSpan.FromSeconds(10),
            Reconnection           = true,
            AutoConnect            = true,
            ConnectWith            = BestHTTP.SocketIO.Transports.TransportTypes.WebSocket,
        };

        // JWT is NOT passed as a query param here — it goes in each event payload
        // (getAuthenticatedSocketUser reads payload.accessToken, not handshake).
        // We still pass it in AdditionalQueryParams as a convenience for logging
        // — the backend ignores unknown query params.
        var qp = new ObservableDictionary<string, string>();
        qp["clientType"] = "unity";
        options.AdditionalQueryParams = qp;

        BestHTTP.HTTPManager.Setup();
        _socketManager = new SocketManager(new Uri(baseUrl + "/socket.io/"), options);

        _socket = _socketManager.Socket;
        _socket.On(EVT_CONNECT,      OnConnect);
        _socket.On(EVT_DISCONNECT,   OnDisconnect);
        _socket.On(EVT_ROOM_UPDATE,  OnRoomUpdateReceived);
        _socket.On(EVT_DRAW_NEW,     OnDrawNewReceived);
        _socket.On(EVT_PATTERN_WON,  OnPatternWonReceived);
        _socket.On(EVT_CHAT_MESSAGE, OnChatMessageReceived);
    }

    public void Disconnect()
    {
        if (_socket != null)
        {
            _socket.Off(EVT_CONNECT,      OnConnect);
            _socket.Off(EVT_DISCONNECT,   OnDisconnect);
            _socket.Off(EVT_ROOM_UPDATE,  OnRoomUpdateReceived);
            _socket.Off(EVT_DRAW_NEW,     OnDrawNewReceived);
            _socket.Off(EVT_PATTERN_WON,  OnPatternWonReceived);
            _socket.Off(EVT_CHAT_MESSAGE, OnChatMessageReceived);
            _socket = null;
        }
        _socketManager?.Close();
        _socketManager = null;
        IsConnected = false;
        ActiveRoomCode = "";
    }

    // ── Incoming event handlers ───────────────────────────────────────────────

    private static void OnConnect(Socket socket, Packet packet, object[] args)
    {
        IsConnected = true;
        Debug.Log("[SpilloramaSocket] Connected");

        // If we had an active room, rejoin after reconnect
        if (!string.IsNullOrEmpty(ActiveRoomCode))
        {
            Debug.Log($"[SpilloramaSocket] Rejoining room {ActiveRoomCode} after reconnect");
            Instance?.StartCoroutine(Instance.EmitRoomResume(ActiveRoomCode));
        }
    }

    private static void OnDisconnect(Socket socket, Packet packet, object[] args)
    {
        IsConnected = false;
        Debug.Log("[SpilloramaSocket] Disconnected");
    }

    private static void OnRoomUpdateReceived(Socket socket, Packet packet, object[] args)
    {
        // Use Utility.GetPacketString — same extraction the AIS panels use
        string raw = Utility.Instance.GetPacketString(packet);
        Debug.Log($"[SpilloramaSocket] room:update received (roomCode={ActiveRoomCode})");
        OnRoomUpdate?.Invoke(raw);
    }

    private static void OnDrawNewReceived(Socket socket, Packet packet, object[] args)
    {
        string raw = Utility.Instance.GetPacketString(packet);
        Debug.Log($"[SpilloramaSocket] draw:new received");
        OnDrawNew?.Invoke(raw);
    }

    private static void OnPatternWonReceived(Socket socket, Packet packet, object[] args)
    {
        string raw = Utility.Instance.GetPacketString(packet);
        Debug.Log($"[SpilloramaSocket] pattern:won received");
        OnPatternWon?.Invoke(raw);
    }

    private static void OnChatMessageReceived(Socket socket, Packet packet, object[] args)
    {
        string raw = Utility.Instance.GetPacketString(packet);
        OnChatMessage?.Invoke(raw);
    }

    // ── Emit helpers ──────────────────────────────────────────────────────────

    private string Jwt => UIManager.Instance?.ShellJwt ?? "";

    private bool EnsureConnected(string caller)
    {
        if (_socket == null || !IsConnected)
        {
            Debug.LogWarning($"[SpilloramaSocket] {caller}: not connected — call Connect() first");
            return false;
        }
        return true;
    }

    // ── Public emit API ───────────────────────────────────────────────────────

    /// <summary>
    /// Join or create the canonical room for a hall.
    /// On success: ActiveRoomCode is set and OnRoomJoined fires.
    /// </summary>
    public void JoinRoom(string hallId, Action<string> onError = null)
    {
        if (!EnsureConnected(nameof(JoinRoom))) return;
        StartCoroutine(EmitJoinRoom(hallId, onError));
    }

    private IEnumerator EmitJoinRoom(string hallId, Action<string> onError)
    {
        // Use room:create with enforceSingleRoomPerHall — backend resolves the
        // canonical room or creates one if none exists for this hall.
        bool done = false;
        string errorMsg = null;

        var payload = new SpilloramaJoinRoomPayload
        {
            accessToken = Jwt,
            roomCode    = "BINGO1",
            hallId      = hallId
        };

        _socket.Emit("room:join", (Socket s, Packet p, object[] a) =>
        {
            string raw = Utility.Instance.GetPacketString(p);
            SpilloramaAckResponse ack;
            try { ack = JsonUtility.FromJson<SpilloramaAckResponse>(raw); }
            catch { ack = null; }

            if (ack == null || !ack.ok)
            {
                errorMsg = ack?.errorMessage ?? "room:join feilet";
                Debug.LogWarning($"[SpilloramaSocket] room:join failed: {errorMsg}");
            }
            else
            {
                // roomCode is in ack data — re-parse for it
                // The ack payload shape: { ok, data: { roomCode, playerId, snapshot } }
                // JsonUtility can't easily parse nested generics, so extract roomCode manually
                int start  = raw.IndexOf("\"roomCode\":\"", StringComparison.Ordinal);
                if (start >= 0)
                {
                    start += 12;
                    int end = raw.IndexOf('"', start);
                    if (end > start)
                        ActiveRoomCode = raw.Substring(start, end - start);
                }
                Debug.Log($"[SpilloramaSocket] Joined room {ActiveRoomCode}");
                OnRoomJoined?.Invoke();
            }
            done = true;
        }, JsonUtility.ToJson(payload));

        float waited = 0f;
        while (!done && waited < 10f) { waited += Time.deltaTime; yield return null; }
        if (!done) { onError?.Invoke("Timeout waiting for room:join ack"); yield break; }
        if (errorMsg != null) { onError?.Invoke(errorMsg); }
    }

    private IEnumerator EmitRoomResume(string roomCode)
    {
        if (!EnsureConnected(nameof(EmitRoomResume))) yield break;

        bool done = false;
        var payload = new SpilloramaRoomActionPayload { accessToken = Jwt, roomCode = roomCode };

        _socket.Emit("room:resume", (Socket s, Packet p, object[] a) =>
        {
            SpilloramaAckResponse ack;
            try { ack = JsonUtility.FromJson<SpilloramaAckResponse>(Utility.Instance.GetPacketString(p)); }
            catch { ack = null; }

            if (ack == null || !ack.ok)
                Debug.LogWarning($"[SpilloramaSocket] room:resume failed: {ack?.errorMessage}");
            else
                Debug.Log($"[SpilloramaSocket] room:resume OK for {roomCode}");
            done = true;
        }, JsonUtility.ToJson(payload));

        float waited = 0f;
        while (!done && waited < 10f) { waited += Time.deltaTime; yield return null; }
    }

    /// <summary>
    /// Mark a number on a ticket. Panel calls this when the player dabs a number.
    /// </summary>
    public void MarkTicket(string ticketId, int number, Action<string> onError = null)
    {
        if (!EnsureConnected(nameof(MarkTicket))) return;
        if (string.IsNullOrEmpty(ActiveRoomCode)) { onError?.Invoke("Ingen aktiv rom"); return; }

        var payload = new SpilloramaTicketMarkPayload
        {
            accessToken = Jwt,
            roomCode    = ActiveRoomCode,
            ticketId    = ticketId,
            number      = number
        };
        StartCoroutine(EmitWithAck("ticket:mark", JsonUtility.ToJson(payload), onError));
    }

    /// <summary>
    /// Submit a Line or Bingo claim.
    /// </summary>
    public void SubmitClaim(string ticketId, string claimType, Action<string> onError = null)
    {
        if (!EnsureConnected(nameof(SubmitClaim))) return;
        if (string.IsNullOrEmpty(ActiveRoomCode)) { onError?.Invoke("Ingen aktiv rom"); return; }

        var payload = new SpilloramaClaimPayload
        {
            accessToken = Jwt,
            roomCode    = ActiveRoomCode,
            ticketId    = ticketId,
            claimType   = claimType
        };
        StartCoroutine(EmitWithAck("claim:submit", JsonUtility.ToJson(payload), onError));
    }

    /// <summary>
    /// Request the next draw (host/admin use). In auto-draw mode the scheduler
    /// handles this; call it for manual draw scenarios.
    /// </summary>
    public void DrawNext(Action<int> onNumber = null, Action<string> onError = null)
    {
        if (!EnsureConnected(nameof(DrawNext))) return;
        if (string.IsNullOrEmpty(ActiveRoomCode)) { onError?.Invoke("Ingen aktiv rom"); return; }

        bool done = false;
        var payload = new SpilloramaRoomActionPayload { accessToken = Jwt, roomCode = ActiveRoomCode };

        _socket.Emit("draw:next", (Socket s, Packet p, object[] a) =>
        {
            SpilloramaAckResponse ack;
            try { ack = JsonUtility.FromJson<SpilloramaAckResponse>(Utility.Instance.GetPacketString(p)); }
            catch { ack = null; }

            if (ack == null || !ack.ok)
                onError?.Invoke(ack?.errorMessage ?? "draw:next feilet");
            // The draw:new broadcast will fire separately with the ball number
            done = true;
        }, JsonUtility.ToJson(payload));

        StartCoroutine(WaitForAck(() => done, "draw:next", onError));
    }

    /// <summary>Send a chat message to the room.</summary>
    public void SendChat(string message, int emojiId = 0, Action<string> onError = null)
    {
        if (!EnsureConnected(nameof(SendChat))) return;
        if (string.IsNullOrEmpty(ActiveRoomCode)) { onError?.Invoke("Ingen aktiv rom"); return; }

        var payload = new SpilloramaChatSendPayload
        {
            accessToken = Jwt,
            roomCode    = ActiveRoomCode,
            message     = message,
            emojiId     = emojiId
        };
        StartCoroutine(EmitWithAck("chat:send", JsonUtility.ToJson(payload), onError));
    }

    /// <summary>Set lucky number for current player before game starts.</summary>
    public void SetLuckyNumber(int number, Action<string> onError = null)
    {
        if (!EnsureConnected(nameof(SetLuckyNumber))) return;
        if (string.IsNullOrEmpty(ActiveRoomCode)) { onError?.Invoke("Ingen aktiv rom"); return; }

        var payload = new SpilloramaLuckyNumberPayload
        {
            accessToken = Jwt,
            roomCode    = ActiveRoomCode,
            luckyNumber = number
        };
        StartCoroutine(EmitWithAck("lucky:set", JsonUtility.ToJson(payload), onError));
    }

    /// <summary>Fetch chat history for the current room.</summary>
    public void FetchChatHistory(Action<string> onSuccess, Action<string> onError = null)
    {
        if (!EnsureConnected(nameof(FetchChatHistory))) return;
        if (string.IsNullOrEmpty(ActiveRoomCode)) { onError?.Invoke("Ingen aktiv rom"); return; }

        var payload = new SpilloramaRoomActionPayload { accessToken = Jwt, roomCode = ActiveRoomCode };
        StartCoroutine(EmitChatHistory(payload, onSuccess, onError));
    }

    private IEnumerator EmitChatHistory(SpilloramaRoomActionPayload payload, Action<string> onSuccess, Action<string> onError)
    {
        bool done = false;
        _socket.Emit("chat:history", (Socket s, Packet p, object[] a) =>
        {
            string raw = Utility.Instance.GetPacketString(p);
            onSuccess?.Invoke(raw);
            done = true;
        }, JsonUtility.ToJson(payload));

        float waited = 0f;
        while (!done && waited < 10f) { waited += Time.deltaTime; yield return null; }
        if (!done) onError?.Invoke("Timeout: chat:history");
    }

    /// <summary>Fetch leaderboard for the current room (or all rooms if roomCode empty).</summary>
    public void FetchLeaderboard(Action<string> onSuccess, Action<string> onError = null)
    {
        if (!EnsureConnected(nameof(FetchLeaderboard))) return;

        var payload = new SpilloramaLeaderboardPayload
        {
            accessToken = Jwt,
            roomCode    = ActiveRoomCode ?? ""
        };
        StartCoroutine(EmitLeaderboard(payload, onSuccess, onError));
    }

    private IEnumerator EmitLeaderboard(SpilloramaLeaderboardPayload payload, Action<string> onSuccess, Action<string> onError)
    {
        bool done = false;
        _socket.Emit("leaderboard:get", (Socket s, Packet p, object[] a) =>
        {
            string raw = Utility.Instance.GetPacketString(p);
            onSuccess?.Invoke(raw);
            done = true;
        }, JsonUtility.ToJson(payload));

        float waited = 0f;
        while (!done && waited < 10f) { waited += Time.deltaTime; yield return null; }
        if (!done) onError?.Invoke("Timeout: leaderboard:get");
    }

    private IEnumerator EmitWithAck(string eventName, string json, Action<string> onError)
    {
        bool done = false;
        string errorMsg = null;

        _socket.Emit(eventName, (Socket s, Packet p, object[] a) =>
        {
            SpilloramaAckResponse ack;
            try { ack = JsonUtility.FromJson<SpilloramaAckResponse>(Utility.Instance.GetPacketString(p)); }
            catch { ack = null; }

            if (ack == null || !ack.ok)
                errorMsg = ack?.errorMessage ?? $"{eventName} feilet";
            done = true;
        }, json);

        float waited = 0f;
        while (!done && waited < 10f) { waited += Time.deltaTime; yield return null; }
        if (!done) { onError?.Invoke($"Timeout: {eventName}"); yield break; }
        if (errorMsg != null) { onError?.Invoke(errorMsg); }
    }

    private IEnumerator WaitForAck(Func<bool> isDone, string name, Action<string> onError)
    {
        float waited = 0f;
        while (!isDone() && waited < 10f) { waited += Time.deltaTime; yield return null; }
        if (!isDone()) onError?.Invoke($"Timeout: {name}");
    }
}
