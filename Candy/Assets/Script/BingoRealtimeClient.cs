using System;
using System.Collections.Generic;
using System.IO;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using SimpleJSON;
using UnityEngine;

public class SocketAck
{
    public bool ok;
    public JSONNode data;
    public string errorCode;
    public string errorMessage;
    public JSONNode raw;
}

public class BingoRealtimeClient : MonoBehaviour
{
    public static BingoRealtimeClient instance;
    private const string DefaultBackendBaseUrl = "https://bingosystem-staging.onrender.com";
    private const string ProductionBackendBaseUrl = "https://bingosystem-3.onrender.com";
    private const bool AllowDirectProductionBackend = false;

    [Header("Backend")]
    [SerializeField] private string backendBaseUrl = DefaultBackendBaseUrl;
    [SerializeField] private bool autoConnectOnStart = false;
    [SerializeField] private bool autoReconnect = true;
    [SerializeField] private float reconnectDelaySeconds = 2f;
    [SerializeField] private bool verboseLogging = true;
    [SerializeField] private string accessToken = string.Empty;

    public event Action<bool> OnConnectionChanged;
    public event Action<JSONNode> OnRoomUpdate;
    public event Action<int, string> OnDrawNew;
    public event Action<string, JSONNode> OnEventReceived;
    public event Action<string> OnError;

    public bool IsReady => _namespaceConnected && IsSocketOpen;
    public string BackendBaseUrl => backendBaseUrl;

    private ClientWebSocket _socket;
    private CancellationTokenSource _cts;
    private Task _receiveTask;
    private bool _namespaceConnected;
    private bool _isConnecting;
    private bool _isShuttingDown;
    private int _nextAckId = 1;

    private readonly object _ackLock = new();
    private readonly Dictionary<int, Action<SocketAck>> _pendingAcks = new();

    private readonly object _mainThreadLock = new();
    private readonly Queue<Action> _mainThreadQueue = new();

    private bool IsSocketOpen => _socket != null && _socket.State == WebSocketState.Open;

    private void Awake()
    {
        if (instance != null && instance != this)
        {
            Debug.LogWarning("Multiple BingoRealtimeClient instances detected. Destroying duplicate.");
            Destroy(gameObject);
            return;
        }

        instance = this;
        backendBaseUrl = NormalizeBackendBaseUrl(backendBaseUrl);
    }

    private void Start()
    {
        if (autoConnectOnStart)
        {
            Connect();
        }
    }

    private void Update()
    {
        FlushMainThreadQueue();
    }

    private void OnApplicationQuit()
    {
        _isShuttingDown = true;
        _ = DisconnectAsync();
    }

    private void OnDestroy()
    {
        _isShuttingDown = true;
        _ = DisconnectAsync();
    }

    public async void Connect()
    {
        await ConnectAsync();
    }

    public async void Disconnect()
    {
        await DisconnectAsync();
    }

    public async Task ConnectAsync()
    {
        if (_isConnecting || IsSocketOpen)
        {
            return;
        }

        _isShuttingDown = false;
        _isConnecting = true;
        CancelInvoke(nameof(Connect));

        try
        {
            await DisposeSocketAsync();

            _cts = new CancellationTokenSource();
            _socket = new ClientWebSocket();
            _socket.Options.KeepAliveInterval = TimeSpan.FromSeconds(20);

            backendBaseUrl = NormalizeBackendBaseUrl(backendBaseUrl);
            Uri socketUri = BuildSocketIoUri(backendBaseUrl);
            if (verboseLogging)
            {
                Debug.Log($"[BingoRealtime] Connecting to {socketUri}");
            }

            await _socket.ConnectAsync(socketUri, _cts.Token);
            _receiveTask = ReceiveLoopAsync(_cts.Token);
        }
        catch (Exception ex)
        {
            QueueError($"Connect failed: {ex.Message}");
            await DisposeSocketAsync();
            ScheduleReconnect();
        }
        finally
        {
            _isConnecting = false;
        }
    }

    public async Task DisconnectAsync()
    {
        CancelInvoke(nameof(Connect));
        await DisposeSocketAsync();
        SetNamespaceConnected(false);
        FailAllPendingAcks("DISCONNECTED", "Socket disconnected.");
    }

    public void SetAccessToken(string token)
    {
        accessToken = (token ?? string.Empty).Trim();
    }

    public void ConfigureBackendBaseUrl(string baseUrl)
    {
        string normalized = NormalizeBackendBaseUrl(baseUrl);
        if (string.IsNullOrWhiteSpace(normalized))
        {
            return;
        }

        bool changed = !string.Equals(backendBaseUrl, normalized, StringComparison.OrdinalIgnoreCase);
        backendBaseUrl = normalized;

        if (changed && verboseLogging)
        {
            Debug.Log($"[BingoRealtime] Backend base URL satt til {backendBaseUrl}");
        }
    }

    public void SetBackendBaseUrl(string baseUrl)
    {
        backendBaseUrl = NormalizeBackendBaseUrl(baseUrl);
    }

    public void CreateRoom(string hallId, string playerName, string walletId, Action<SocketAck> onAck = null)
    {
        JSONObject payload = new();
        payload["hallId"] = (hallId ?? string.Empty).Trim();
        payload["playerName"] = playerName ?? string.Empty;
        if (!string.IsNullOrWhiteSpace(walletId))
        {
            payload["walletId"] = walletId.Trim();
        }
        AppendAccessToken(payload);

        EmitWithAck("room:create", payload, onAck);
    }

    public void JoinRoom(string roomCode, string hallId, string playerName, string walletId, Action<SocketAck> onAck = null)
    {
        JSONObject payload = new();
        payload["roomCode"] = (roomCode ?? string.Empty).Trim().ToUpperInvariant();
        payload["hallId"] = (hallId ?? string.Empty).Trim();
        payload["playerName"] = playerName ?? string.Empty;
        if (!string.IsNullOrWhiteSpace(walletId))
        {
            payload["walletId"] = walletId.Trim();
        }
        AppendAccessToken(payload);

        EmitWithAck("room:join", payload, onAck);
    }

    public void RequestRoomState(string roomCode, Action<SocketAck> onAck = null)
    {
        JSONObject payload = new();
        payload["roomCode"] = (roomCode ?? string.Empty).Trim().ToUpperInvariant();
        AppendAccessToken(payload);
        EmitWithAck("room:state", payload, onAck);
    }

    public void ResumeRoom(string roomCode, string playerId, Action<SocketAck> onAck = null)
    {
        JSONObject payload = new();
        payload["roomCode"] = (roomCode ?? string.Empty).Trim().ToUpperInvariant();
        payload["playerId"] = playerId ?? string.Empty;
        AppendAccessToken(payload);
        EmitWithAck("room:resume", payload, onAck);
    }

    public void StartGame(
        string roomCode,
        string playerId,
        int entryFee = 0,
        int? ticketsPerPlayer = null,
        Action<SocketAck> onAck = null)
    {
        JSONObject payload = new();
        payload["roomCode"] = (roomCode ?? string.Empty).Trim().ToUpperInvariant();
        payload["playerId"] = playerId ?? string.Empty;
        payload["entryFee"] = entryFee;
        if (ticketsPerPlayer.HasValue)
        {
            payload["ticketsPerPlayer"] = ticketsPerPlayer.Value;
        }
        AppendAccessToken(payload);
        EmitWithAck("game:start", payload, onAck);
    }

    public void ArmBet(string roomCode, string playerId, bool armed = true, Action<SocketAck> onAck = null)
    {
        JSONObject payload = new();
        payload["roomCode"] = (roomCode ?? string.Empty).Trim().ToUpperInvariant();
        payload["playerId"] = playerId ?? string.Empty;
        payload["armed"] = armed;
        AppendAccessToken(payload);
        EmitWithAck("bet:arm", payload, onAck);
    }

    public void EndGame(string roomCode, string playerId, string reason = "Manual end", Action<SocketAck> onAck = null)
    {
        JSONObject payload = new();
        payload["roomCode"] = (roomCode ?? string.Empty).Trim().ToUpperInvariant();
        payload["playerId"] = playerId ?? string.Empty;
        payload["reason"] = reason ?? string.Empty;
        AppendAccessToken(payload);
        EmitWithAck("game:end", payload, onAck);
    }

    public void DrawNext(string roomCode, string playerId, Action<SocketAck> onAck = null)
    {
        JSONObject payload = new();
        payload["roomCode"] = (roomCode ?? string.Empty).Trim().ToUpperInvariant();
        payload["playerId"] = playerId ?? string.Empty;
        AppendAccessToken(payload);
        EmitWithAck("draw:next", payload, onAck);
    }

    public void MarkNumber(string roomCode, string playerId, int number, Action<SocketAck> onAck = null)
    {
        JSONObject payload = new();
        payload["roomCode"] = (roomCode ?? string.Empty).Trim().ToUpperInvariant();
        payload["playerId"] = playerId ?? string.Empty;
        payload["number"] = number;
        AppendAccessToken(payload);
        EmitWithAck("ticket:mark", payload, onAck);
    }

    public void RerollTickets(string roomCode, string playerId, int ticketsPerPlayer, Action<SocketAck> onAck = null)
    {
        JSONObject payload = new();
        payload["roomCode"] = (roomCode ?? string.Empty).Trim().ToUpperInvariant();
        payload["playerId"] = playerId ?? string.Empty;
        payload["ticketsPerPlayer"] = ticketsPerPlayer;
        AppendAccessToken(payload);
        EmitWithAck("ticket:reroll", payload, onAck);
    }

    public void SubmitClaim(string roomCode, string playerId, string type, Action<SocketAck> onAck = null)
    {
        JSONObject payload = new();
        payload["roomCode"] = (roomCode ?? string.Empty).Trim().ToUpperInvariant();
        payload["playerId"] = playerId ?? string.Empty;
        payload["type"] = (type ?? string.Empty).Trim().ToUpperInvariant();
        AppendAccessToken(payload);
        EmitWithAck("claim:submit", payload, onAck);
    }

    public void Emit(string eventName, JSONNode payload)
    {
        if (!IsReady)
        {
            QueueError($"Cannot emit '{eventName}', socket is not ready.");
            return;
        }

        JSONNode payloadWithToken = payload;
        if (payloadWithToken == null || payloadWithToken.IsNull || !(payloadWithToken is JSONObject))
        {
            payloadWithToken = new JSONObject();
        }
        AppendAccessToken((JSONObject)payloadWithToken);

        JSONArray packet = new();
        packet.Add(eventName);
        packet.Add(payloadWithToken);
        _ = SendRawAsync($"42{packet}");
    }

    public void EmitWithAck(string eventName, JSONNode payload, Action<SocketAck> onAck)
    {
        if (!IsReady)
        {
            onAck?.Invoke(new SocketAck
            {
                ok = false,
                errorCode = "NOT_CONNECTED",
                errorMessage = "Socket is not connected."
            });
            return;
        }

        int ackId = NextAckId();
        if (onAck != null)
        {
            lock (_ackLock)
            {
                _pendingAcks[ackId] = onAck;
            }
        }

        JSONNode payloadWithToken = payload;
        if (payloadWithToken == null || payloadWithToken.IsNull || !(payloadWithToken is JSONObject))
        {
            payloadWithToken = new JSONObject();
        }
        AppendAccessToken((JSONObject)payloadWithToken);

        JSONArray packet = new();
        packet.Add(eventName);
        packet.Add(payloadWithToken);

        if (verboseLogging)
        {
            Debug.Log($"[BingoRealtime] emit ack event={eventName} ackId={ackId}");
        }
        _ = SendRawAsync($"42{ackId}{packet}");
    }

    private void AppendAccessToken(JSONObject payload)
    {
        if (payload == null)
        {
            return;
        }
        if (!string.IsNullOrWhiteSpace(accessToken))
        {
            payload["accessToken"] = accessToken;
        }
    }

    private async Task ReceiveLoopAsync(CancellationToken token)
    {
        try
        {
            while (!token.IsCancellationRequested && _socket != null && _socket.State == WebSocketState.Open)
            {
                string message = await ReceiveMessageAsync(_socket, token);
                if (message == null)
                {
                    break;
                }

                await ProcessIncomingAsync(message, token);
            }
        }
        catch (OperationCanceledException)
        {
            // Expected on disconnect.
        }
        catch (Exception ex)
        {
            QueueError($"Receive loop failed: {ex.Message}");
        }
        finally
        {
            SetNamespaceConnected(false);
            FailAllPendingAcks("DISCONNECTED", "Socket disconnected.");
            await DisposeSocketAsync();
            ScheduleReconnect();
        }
    }

    private async Task ProcessIncomingAsync(string message, CancellationToken token)
    {
        if (string.IsNullOrEmpty(message))
        {
            return;
        }

        string[] packets = message.Split('\u001e');
        foreach (string packet in packets)
        {
            if (string.IsNullOrWhiteSpace(packet))
            {
                continue;
            }

            await ProcessSinglePacketAsync(packet, token);
        }
    }

    private async Task ProcessSinglePacketAsync(string packet, CancellationToken token)
    {
        if (packet.StartsWith("2", StringComparison.Ordinal))
        {
            string pingPayload = packet.Length > 1 ? packet.Substring(1) : string.Empty;
            await SendRawAsync("3" + pingPayload, token);
            return;
        }

        if (packet.StartsWith("3", StringComparison.Ordinal))
        {
            // Pong/heartbeat confirmation.
            return;
        }

        if (packet.StartsWith("0", StringComparison.Ordinal))
        {
            await SendRawAsync("40", token);
            return;
        }

        if (packet.StartsWith("40", StringComparison.Ordinal))
        {
            SetNamespaceConnected(true);
            return;
        }

        if (packet.StartsWith("41", StringComparison.Ordinal))
        {
            SetNamespaceConnected(false);
            return;
        }

        if (packet.StartsWith("42", StringComparison.Ordinal))
        {
            HandleEventPacket(packet);
            return;
        }

        if (packet.StartsWith("43", StringComparison.Ordinal))
        {
            HandleAckPacket(packet);
            return;
        }

        if (packet.StartsWith("44", StringComparison.Ordinal))
        {
            QueueError($"Socket.IO error packet: {packet}");
        }
    }

    private void HandleEventPacket(string packet)
    {
        int index = 2;
        _ = ReadOptionalInteger(packet, ref index); // Optional ack id from server.

        if (index >= packet.Length)
        {
            return;
        }

        string jsonPayload = packet.Substring(index);
        JSONNode parsed = JSON.Parse(jsonPayload);
        if (parsed == null || !parsed.IsArray || parsed.Count == 0)
        {
            return;
        }

        string eventName = parsed[0];
        JSONNode eventData = parsed.Count > 1 ? parsed[1] : null;

        QueueOnMainThread(() =>
        {
            OnEventReceived?.Invoke(eventName, eventData);

            if (eventName == "room:update")
            {
                OnRoomUpdate?.Invoke(eventData);
            }
            else if (eventName == "draw:new")
            {
                int number = eventData?["number"] != null ? eventData["number"].AsInt : -1;
                string source = eventData?["source"];
                OnDrawNew?.Invoke(number, source ?? string.Empty);
            }
        });
    }

    private void HandleAckPacket(string packet)
    {
        if (verboseLogging)
        {
            Debug.Log($"[BingoRealtime] raw ack packet: {packet}");
        }

        int index = 2;
        int ackId = ReadOptionalInteger(packet, ref index);
        if (ackId < 0)
        {
            if (verboseLogging)
            {
                Debug.LogWarning($"[BingoRealtime] klarte ikke lese ackId fra packet: {packet}");
            }
            return;
        }

        JSONNode responseNode = null;
        if (index < packet.Length)
        {
            JSONNode parsed = JSON.Parse(packet.Substring(index));
            if (parsed != null && parsed.IsArray && parsed.Count > 0)
            {
                responseNode = parsed[0];
            }
            else
            {
                responseNode = parsed;
            }
        }

        Action<SocketAck> ackHandler = null;
        lock (_ackLock)
        {
            if (_pendingAcks.TryGetValue(ackId, out ackHandler))
            {
                _pendingAcks.Remove(ackId);
            }
        }

        if (ackHandler == null)
        {
            if (verboseLogging)
            {
                Debug.LogWarning($"[BingoRealtime] ack without handler. ackId={ackId}");
            }
            return;
        }

        SocketAck ack = ParseAck(responseNode);
        if (verboseLogging)
        {
            Debug.Log($"[BingoRealtime] ack received ackId={ackId} ok={ack.ok} code={ack.errorCode}");
        }
        QueueOnMainThread(() => ackHandler.Invoke(ack));
    }

    private SocketAck ParseAck(JSONNode node)
    {
        if (node == null)
        {
            return new SocketAck
            {
                ok = false,
                errorCode = "EMPTY_ACK",
                errorMessage = "Ack payload is empty.",
                raw = null
            };
        }

        JSONNode errorNode = node["error"];
        return new SocketAck
        {
            ok = node["ok"] != null && node["ok"].AsBool,
            data = node["data"],
            errorCode = errorNode?["code"],
            errorMessage = errorNode?["message"],
            raw = node
        };
    }

    private async Task SendRawAsync(string payload)
    {
        await SendRawAsync(payload, _cts != null ? _cts.Token : CancellationToken.None);
    }

    private async Task SendRawAsync(string payload, CancellationToken token)
    {
        if (_socket == null || _socket.State != WebSocketState.Open)
        {
            return;
        }

        byte[] bytes = Encoding.UTF8.GetBytes(payload);
        await _socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, token);
    }

    private static async Task<string> ReceiveMessageAsync(ClientWebSocket socket, CancellationToken token)
    {
        ArraySegment<byte> buffer = new(new byte[4096]);
        using MemoryStream stream = new();

        while (true)
        {
            WebSocketReceiveResult result = await socket.ReceiveAsync(buffer, token);
            if (result.MessageType == WebSocketMessageType.Close)
            {
                return null;
            }

            if (result.Count > 0)
            {
                stream.Write(buffer.Array, buffer.Offset, result.Count);
            }

            if (result.EndOfMessage)
            {
                break;
            }
        }

        return Encoding.UTF8.GetString(stream.ToArray());
    }

    private async Task DisposeSocketAsync()
    {
        ClientWebSocket socket = _socket;
        _socket = null;

        CancellationTokenSource cts = _cts;
        _cts = null;

        if (cts != null)
        {
            try
            {
                cts.Cancel();
            }
            catch
            {
                // Ignore cancellation errors.
            }
        }

        if (socket != null)
        {
            try
            {
                if (socket.State == WebSocketState.Open || socket.State == WebSocketState.CloseReceived)
                {
                    await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Closing", CancellationToken.None);
                }
            }
            catch
            {
                // Ignore close errors.
            }
            finally
            {
                socket.Dispose();
            }
        }

        if (cts != null)
        {
            cts.Dispose();
        }
    }

    private void ScheduleReconnect()
    {
        if (!autoReconnect || _isShuttingDown)
        {
            return;
        }

        QueueOnMainThread(() =>
        {
            if (!IsReady && !_isConnecting)
            {
                CancelInvoke(nameof(Connect));
                Invoke(nameof(Connect), Mathf.Max(0.5f, reconnectDelaySeconds));
            }
        });
    }

    private void SetNamespaceConnected(bool connected)
    {
        if (_namespaceConnected == connected)
        {
            return;
        }

        _namespaceConnected = connected;
        QueueOnMainThread(() =>
        {
            if (verboseLogging)
            {
                Debug.Log($"[BingoRealtime] Connected={connected}");
            }

            OnConnectionChanged?.Invoke(connected);
        });
    }

    private void FailAllPendingAcks(string code, string message)
    {
        List<Action<SocketAck>> callbacks = new();
        lock (_ackLock)
        {
            foreach (Action<SocketAck> callback in _pendingAcks.Values)
            {
                callbacks.Add(callback);
            }
            _pendingAcks.Clear();
        }

        if (callbacks.Count == 0)
        {
            return;
        }

        QueueOnMainThread(() =>
        {
            foreach (Action<SocketAck> callback in callbacks)
            {
                callback?.Invoke(new SocketAck
                {
                    ok = false,
                    errorCode = code,
                    errorMessage = message
                });
            }
        });
    }

    private int NextAckId()
    {
        int id = _nextAckId;
        _nextAckId += 1;
        if (_nextAckId < 0)
        {
            _nextAckId = 1;
        }
        return id;
    }

    private static int ReadOptionalInteger(string text, ref int index)
    {
        int start = index;
        int value = 0;

        while (index < text.Length && char.IsDigit(text[index]))
        {
            value = (value * 10) + (text[index] - '0');
            index++;
        }

        return index > start ? value : -1;
    }

    private static Uri BuildSocketIoUri(string baseUrl)
    {
        string normalized = NormalizeBackendBaseUrl(baseUrl);

        Uri baseUri = new(normalized);
        string scheme = baseUri.Scheme.Equals("https", StringComparison.OrdinalIgnoreCase) ||
                        baseUri.Scheme.Equals("wss", StringComparison.OrdinalIgnoreCase)
            ? "wss"
            : "ws";

        string authority = baseUri.IsDefaultPort ? baseUri.Host : $"{baseUri.Host}:{baseUri.Port}";
        string socketPath = "/socket.io/?EIO=4&transport=websocket";

        return new Uri($"{scheme}://{authority}{socketPath}");
    }

    private static string NormalizeBackendBaseUrl(string baseUrl)
    {
        string normalized = (baseUrl ?? string.Empty).Trim();

        if (normalized.Length == 0)
        {
            normalized = DefaultBackendBaseUrl;
        }

        if (!normalized.StartsWith("http://", StringComparison.OrdinalIgnoreCase) &&
            !normalized.StartsWith("https://", StringComparison.OrdinalIgnoreCase) &&
            !normalized.StartsWith("ws://", StringComparison.OrdinalIgnoreCase) &&
            !normalized.StartsWith("wss://", StringComparison.OrdinalIgnoreCase))
        {
            normalized = "https://" + normalized;
        }

        normalized = normalized.TrimEnd('/');

        if (!AllowDirectProductionBackend &&
            Uri.TryCreate(normalized, UriKind.Absolute, out Uri parsed) &&
            Uri.TryCreate(ProductionBackendBaseUrl, UriKind.Absolute, out Uri prodParsed) &&
            string.Equals(parsed.Host, prodParsed.Host, StringComparison.OrdinalIgnoreCase))
        {
            Debug.LogWarning(
                $"[BingoRealtime] Blokkerer direkte backend mot prod ({prodParsed.Host}). Bruker staging i stedet.");
            return DefaultBackendBaseUrl;
        }

        return normalized;
    }

    private void QueueError(string message)
    {
        QueueOnMainThread(() =>
        {
            if (verboseLogging)
            {
                Debug.LogError($"[BingoRealtime] {message}");
            }
            OnError?.Invoke(message);
        });
    }

    private void QueueOnMainThread(Action action)
    {
        if (action == null)
        {
            return;
        }

        lock (_mainThreadLock)
        {
            _mainThreadQueue.Enqueue(action);
        }
    }

    private void FlushMainThreadQueue()
    {
        while (true)
        {
            Action action = null;
            lock (_mainThreadLock)
            {
                if (_mainThreadQueue.Count > 0)
                {
                    action = _mainThreadQueue.Dequeue();
                }
            }

            if (action == null)
            {
                break;
            }

            action.Invoke();
        }
    }
}
