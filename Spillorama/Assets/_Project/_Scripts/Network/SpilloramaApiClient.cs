// Phase 2: Spillorama REST client — replaces Category A AIS socket events.
// All public methods take an optional callback matching the existing AIS delegate
// signatures so call-sites only need to swap EventManager.Instance.X for
// SpilloramaApiClient.Instance.X with minimal surrounding change.
using System;
using System.Collections;
using System.Text;
using UnityEngine;
using UnityEngine.Networking;

// ── REST response shapes ────────────────────────────────────────────────────

[Serializable]
public class SpilloramaApiWrapper<T>
{
    public bool ok;
    public T data;
    public SpilloramaApiError error;
}

[Serializable]
public class SpilloramaApiError
{
    public string code;
    public string message;
}

[Serializable]
public class SpilloramaHall
{
    public string id;
    public string name;
    public string country;
    public bool isActive;
}

[Serializable]
public class SpilloramaTransactionItem
{
    public string id;
    public string type;        // "debit" | "credit"
    public float amount;
    public float balanceAfter;
    public string description;
    public string createdAt;
}

[Serializable]
public class SpilloramaTransactionListData
{
    public SpilloramaTransactionItem[] transactions;
    public int total;
    public int page;
    public int pageSize;
}

[Serializable]
public class SpilloramaComplianceRestrictions
{
    public bool isBlocked;
    public string blockedReason;   // "mandatory_pause" | "voluntary_pause" | "self_exclusion" | ""
    public string blockedUntil;    // ISO8601 or ""
}

[Serializable]
public class SpilloramaComplianceLimits
{
    public float dailyLossLimit;
    public float monthlyLossLimit;
    public float dailyLossRemaining;
    public float monthlyLossRemaining;
    public float sessionPlayedMs;
    public float sessionLimitMs;
    public float pauseDurationMs;
}

[Serializable]
public class SpilloramaComplianceData
{
    public SpilloramaComplianceLimits limits;
    public SpilloramaComplianceRestrictions restrictions;
}

[Serializable]
public class SpilloramaReportSummary
{
    public float stakeTotal;
    public float prizeTotal;
    public float netResult;
    public int totalEvents;
    public int totalPlays;
}

[Serializable]
public class SpilloramaReportData
{
    public string generatedAt;
    public SpilloramaReportSummary summary;
}

[Serializable]
public class SpilloramaBankIdInitResponse
{
    public string sessionId;
    public string authUrl;
    public string status;   // "PENDING" | "NOT_CONFIGURED"
    public string message;
}

[Serializable]
public class SpilloramaBankIdStatusResponse
{
    public string sessionId;
    public string status;    // "COMPLETE" | "PENDING" | "NOT_CONFIGURED"
    public bool verified;
}

[Serializable]
public class SpilloramaChangePasswordRequest
{
    public string currentPassword;
    public string newPassword;
}

[Serializable]
public class SpilloramaUpdateProfileRequest
{
    public string displayName;
    public string email;
    public string phone;
}

[Serializable]
public class SpilloramaDeletedPayload
{
    public bool deleted;
}

[Serializable]
public class SpilloramaLossLimitRequest
{
    public string hallId;
    public float dailyLossLimit;
    public float monthlyLossLimit;
}

[Serializable]
public class SpilloramaTimedPauseRequest
{
    public int durationMinutes;
}

[Serializable]
public class SpilloramaNotificationItem
{
    public string notificationType;
    public string message;
    public string notificationDateAndTime;
    public string ticketMessage;
    public string price;
    public string date;
}

[Serializable]
public class SpilloramaRoomSummary
{
    public string code;
    public string hallId;
    public string hostPlayerId;
    public int playerCount;
    public string createdAt;
    public string gameStatus;   // "NONE" | "WAITING" | "IN_PROGRESS" | "FINISHED"
}

[Serializable]
public class SpilloramaRoomListData
{
    public SpilloramaRoomSummary[] rooms;
}

// ── Delegate types ──────────────────────────────────────────────────────────

public delegate void SpilloramaApiSuccess<T>(T data);
public delegate void SpilloramaApiError2(string errorCode, string message);

// ── Client ──────────────────────────────────────────────────────────────────

public class SpilloramaApiClient : MonoBehaviour
{
    public static SpilloramaApiClient Instance
    {
        get
        {
            if (_instance == null)
            {
                _instance = FindFirstObjectByType<SpilloramaApiClient>();
                if (_instance == null)
                {
                    var go = new GameObject("SpilloramaApiClient");
                    _instance = go.AddComponent<SpilloramaApiClient>();
                    DontDestroyOnLoad(go);
                }
            }
            return _instance;
        }
        private set => _instance = value;
    }
    private static SpilloramaApiClient _instance;

    private void Awake()
    {
        if (_instance == null) { _instance = this; }
        else if (_instance != this) { Destroy(gameObject); return; }
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private string BaseUrl => UIManager.Instance.GetSpilloramaBaseUrlPublic();
    private string Jwt => UIManager.Instance.ShellJwt;

    private IEnumerator Get<TData>(
        string path,
        SpilloramaApiSuccess<TData> onSuccess,
        SpilloramaApiError2 onError = null)
    {
        string url = BaseUrl + path;
        using var req = UnityWebRequest.Get(url);
        req.SetRequestHeader("Authorization", "Bearer " + Jwt);
        req.timeout = 15;
        yield return req.SendWebRequest();

        if (!HandleNetworkError(req, onError)) yield break;

        SpilloramaApiWrapper<TData> wrapper;
        try { wrapper = JsonUtility.FromJson<SpilloramaApiWrapper<TData>>(req.downloadHandler.text); }
        catch (Exception ex) { onError?.Invoke("PARSE_ERROR", ex.Message); yield break; }

        if (!wrapper.ok) { onError?.Invoke(wrapper.error?.code ?? "UNKNOWN", wrapper.error?.message ?? "Ukjent feil"); yield break; }
        onSuccess?.Invoke(wrapper.data);
    }

    private IEnumerator Post<TBody, TData>(
        string path,
        TBody body,
        SpilloramaApiSuccess<TData> onSuccess,
        SpilloramaApiError2 onError = null)
    {
        string url = BaseUrl + path;
        string json = JsonUtility.ToJson(body);
        using var req = new UnityWebRequest(url, "POST");
        req.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(json));
        req.downloadHandler = new DownloadHandlerBuffer();
        req.SetRequestHeader("Content-Type", "application/json");
        req.SetRequestHeader("Authorization", "Bearer " + Jwt);
        req.timeout = 15;
        yield return req.SendWebRequest();

        if (!HandleNetworkError(req, onError)) yield break;

        SpilloramaApiWrapper<TData> wrapper;
        try { wrapper = JsonUtility.FromJson<SpilloramaApiWrapper<TData>>(req.downloadHandler.text); }
        catch (Exception ex) { onError?.Invoke("PARSE_ERROR", ex.Message); yield break; }

        if (!wrapper.ok) { onError?.Invoke(wrapper.error?.code ?? "UNKNOWN", wrapper.error?.message ?? "Ukjent feil"); yield break; }
        onSuccess?.Invoke(wrapper.data);
    }

    private IEnumerator Put<TBody, TData>(
        string path,
        TBody body,
        SpilloramaApiSuccess<TData> onSuccess,
        SpilloramaApiError2 onError = null)
    {
        string url = BaseUrl + path;
        string json = JsonUtility.ToJson(body);
        using var req = new UnityWebRequest(url, "PUT");
        req.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(json));
        req.downloadHandler = new DownloadHandlerBuffer();
        req.SetRequestHeader("Content-Type", "application/json");
        req.SetRequestHeader("Authorization", "Bearer " + Jwt);
        req.timeout = 15;
        yield return req.SendWebRequest();

        if (!HandleNetworkError(req, onError)) yield break;

        SpilloramaApiWrapper<TData> wrapper;
        try { wrapper = JsonUtility.FromJson<SpilloramaApiWrapper<TData>>(req.downloadHandler.text); }
        catch (Exception ex) { onError?.Invoke("PARSE_ERROR", ex.Message); yield break; }

        if (!wrapper.ok) { onError?.Invoke(wrapper.error?.code ?? "UNKNOWN", wrapper.error?.message ?? "Ukjent feil"); yield break; }
        onSuccess?.Invoke(wrapper.data);
    }

    private IEnumerator Delete<TData>(
        string path,
        SpilloramaApiSuccess<TData> onSuccess,
        SpilloramaApiError2 onError = null)
    {
        string url = BaseUrl + path;
        using var req = UnityWebRequest.Delete(url);
        req.downloadHandler = new DownloadHandlerBuffer();
        req.SetRequestHeader("Authorization", "Bearer " + Jwt);
        req.timeout = 15;
        yield return req.SendWebRequest();

        if (!HandleNetworkError(req, onError)) yield break;

        SpilloramaApiWrapper<TData> wrapper;
        try { wrapper = JsonUtility.FromJson<SpilloramaApiWrapper<TData>>(req.downloadHandler.text); }
        catch (Exception ex) { onError?.Invoke("PARSE_ERROR", ex.Message); yield break; }

        if (!wrapper.ok) { onError?.Invoke(wrapper.error?.code ?? "UNKNOWN", wrapper.error?.message ?? "Ukjent feil"); yield break; }
        onSuccess?.Invoke(wrapper.data);
    }

    private static bool HandleNetworkError(UnityWebRequest req, SpilloramaApiError2 onError)
    {
        if (req.result == UnityWebRequest.Result.Success) return true;
        string msg = req.downloadHandler?.text ?? req.error;
        Debug.LogWarning($"[SpilloramaApi] {req.method} {req.url} failed: {msg}");
        onError?.Invoke("NETWORK_ERROR", msg);
        return false;
    }

    // ── Category A: Auth / Profile ───────────────────────────────────────────

    /// GET /api/auth/me  — replaces AIS PlayerDetails socket event
    public void GetProfile(
        SpilloramaApiSuccess<SpilloramaUserPayload> onSuccess,
        SpilloramaApiError2 onError = null)
    {
        StartCoroutine(Get("/api/auth/me", onSuccess, onError));
    }

    /// POST /api/auth/logout  — replaces AIS Logout socket event
    public void Logout(SpilloramaApiSuccess<object> onSuccess = null, SpilloramaApiError2 onError = null)
    {
        StartCoroutine(Post<object, object>("/api/auth/logout", new object(), onSuccess, onError));
    }

    /// POST /api/auth/change-password  — replaces AIS PlayerChangePassword socket event
    public void ChangePassword(
        string currentPassword,
        string newPassword,
        SpilloramaApiSuccess<object> onSuccess,
        SpilloramaApiError2 onError = null)
    {
        var body = new SpilloramaChangePasswordRequest { currentPassword = currentPassword, newPassword = newPassword };
        StartCoroutine(Post<SpilloramaChangePasswordRequest, object>("/api/auth/change-password", body, onSuccess, onError));
    }

    /// PUT /api/auth/me  — replaces AIS UpdateProfile socket event
    public void UpdateProfile(
        string displayName,
        string email,
        string phone,
        SpilloramaApiSuccess<SpilloramaUserPayload> onSuccess,
        SpilloramaApiError2 onError = null)
    {
        var body = new SpilloramaUpdateProfileRequest { displayName = displayName, email = email, phone = phone };
        StartCoroutine(Put("/api/auth/me", body, onSuccess, onError));
    }

    /// DELETE /api/auth/me  — replaces AIS DeletePlayerAccount socket event
    public void DeleteAccount(
        SpilloramaApiSuccess<SpilloramaDeletedPayload> onSuccess,
        SpilloramaApiError2 onError = null)
    {
        StartCoroutine(Delete("/api/auth/me", onSuccess, onError));
    }

    // ── Category A: BankID / KYC ──────────────────────────────────────────────

    /// POST /api/auth/bankid/init  — replaces AIS VerifyByBankId socket event
    public void InitBankId(
        SpilloramaApiSuccess<SpilloramaBankIdInitResponse> onSuccess,
        SpilloramaApiError2 onError = null)
    {
        StartCoroutine(Post<object, SpilloramaBankIdInitResponse>("/api/auth/bankid/init", new object(), onSuccess, onError));
    }

    /// GET /api/auth/bankid/status/:sessionId  — poll BankID verification result
    public void GetBankIdStatus(
        string sessionId,
        SpilloramaApiSuccess<SpilloramaBankIdStatusResponse> onSuccess,
        SpilloramaApiError2 onError = null)
    {
        StartCoroutine(Get($"/api/auth/bankid/status/{Uri.EscapeDataString(sessionId)}", onSuccess, onError));
    }

    // ── Category A: Halls ────────────────────────────────────────────────────

    /// GET /api/halls  — replaces AIS HallList socket event
    public void GetHalls(
        SpilloramaApiSuccess<SpilloramaHall[]> onSuccess,
        SpilloramaApiError2 onError = null)
    {
        // /api/halls returns the array directly as data
        StartCoroutine(GetHallsInternal(onSuccess, onError));
    }

    private IEnumerator GetHallsInternal(
        SpilloramaApiSuccess<SpilloramaHall[]> onSuccess,
        SpilloramaApiError2 onError)
    {
        string url = BaseUrl + "/api/halls";
        using var req = UnityWebRequest.Get(url);
        req.SetRequestHeader("Authorization", "Bearer " + Jwt);
        req.timeout = 15;
        yield return req.SendWebRequest();

        if (!HandleNetworkError(req, onError)) yield break;

        // Backend returns { ok: true, data: [...] }
        SpilloramaApiWrapper<SpilloramaHall[]> wrapper;
        try { wrapper = JsonUtility.FromJson<SpilloramaApiWrapper<SpilloramaHall[]>>(req.downloadHandler.text); }
        catch (Exception ex) { onError?.Invoke("PARSE_ERROR", ex.Message); yield break; }

        if (!wrapper.ok) { onError?.Invoke(wrapper.error?.code ?? "UNKNOWN", wrapper.error?.message ?? "Ukjent feil"); yield break; }
        onSuccess?.Invoke(wrapper.data);
    }

    // ── Category A: Wallet ───────────────────────────────────────────────────

    /// GET /api/wallet/me  — replaces AIS PlayerDetails balance fields
    public void GetWallet(
        SpilloramaApiSuccess<SpilloramaWalletPayload> onSuccess,
        SpilloramaApiError2 onError = null)
    {
        StartCoroutine(Get("/api/wallet/me", onSuccess, onError));
    }

    /// GET /api/wallet/me/transactions  — replaces AIS TransactionHistory socket event
    public void GetTransactions(
        int page = 1,
        int pageSize = 20,
        SpilloramaApiSuccess<SpilloramaTransactionListData> onSuccess = null,
        SpilloramaApiError2 onError = null)
    {
        StartCoroutine(Get($"/api/wallet/me/transactions?page={page}&pageSize={pageSize}", onSuccess, onError));
    }

    // ── Category A: Compliance / Spillvett ───────────────────────────────────

    /// GET /api/wallet/me/compliance  — replaces AIS PlayerHallLimit and CheckPlayerBreakTime
    public void GetCompliance(
        string hallId,
        SpilloramaApiSuccess<SpilloramaComplianceData> onSuccess,
        SpilloramaApiError2 onError = null)
    {
        string path = string.IsNullOrEmpty(hallId)
            ? "/api/wallet/me/compliance"
            : $"/api/wallet/me/compliance?hallId={Uri.EscapeDataString(hallId)}";
        StartCoroutine(Get(path, onSuccess, onError));
    }

    /// PUT /api/wallet/me/loss-limits  — replaces AIS SetLimit socket event
    public void SetLossLimits(
        string hallId,
        float dailyLimit,
        float monthlyLimit,
        SpilloramaApiSuccess<SpilloramaComplianceData> onSuccess,
        SpilloramaApiError2 onError = null)
    {
        var body = new SpilloramaLossLimitRequest
        {
            hallId = hallId,
            dailyLossLimit = dailyLimit,
            monthlyLossLimit = monthlyLimit
        };
        StartCoroutine(Put("/api/wallet/me/loss-limits", body, onSuccess, onError));
    }

    /// POST /api/wallet/me/timed-pause  — replaces AIS BlockMySelf socket event
    public void SetTimedPause(
        int durationMinutes,
        SpilloramaApiSuccess<SpilloramaComplianceData> onSuccess,
        SpilloramaApiError2 onError = null)
    {
        var body = new SpilloramaTimedPauseRequest { durationMinutes = durationMinutes };
        StartCoroutine(Post<SpilloramaTimedPauseRequest, SpilloramaComplianceData>("/api/wallet/me/timed-pause", body, onSuccess, onError));
    }

    /// POST /api/wallet/me/self-exclusion  — 1-year self-exclusion
    public void SetSelfExclusion(
        SpilloramaApiSuccess<SpilloramaComplianceData> onSuccess,
        SpilloramaApiError2 onError = null)
    {
        StartCoroutine(Post<object, SpilloramaComplianceData>("/api/wallet/me/self-exclusion", new object(), onSuccess, onError));
    }

    // ── Category A: Spillevett Report (MyWinnings) ────────────────────────

    /// GET /api/spillevett/report?period=today  — replaces AIS MyWinnings socket event
    public void GetWinningsReport(
        string period,
        SpilloramaApiSuccess<SpilloramaReportData> onSuccess,
        SpilloramaApiError2 onError = null)
    {
        string path = $"/api/spillevett/report?period={Uri.EscapeDataString(period)}";
        StartCoroutine(Get(path, onSuccess, onError));
    }

    // ── Category A: Notifications ──────────────────────────────────────────

    /// GET /api/notifications  — replaces AIS PlayerNotifications socket event
    public void GetNotifications(
        SpilloramaApiSuccess<SpilloramaNotificationItem[]> onSuccess,
        SpilloramaApiError2 onError = null)
    {
        StartCoroutine(GetNotificationsInternal(onSuccess, onError));
    }

    private IEnumerator GetNotificationsInternal(
        SpilloramaApiSuccess<SpilloramaNotificationItem[]> onSuccess,
        SpilloramaApiError2 onError)
    {
        string url = BaseUrl + "/api/notifications";
        using var req = UnityWebRequest.Get(url);
        req.SetRequestHeader("Authorization", "Bearer " + Jwt);
        req.timeout = 15;
        yield return req.SendWebRequest();

        if (!HandleNetworkError(req, onError)) yield break;

        // Backend returns { ok: true, data: [...] }
        SpilloramaApiWrapper<SpilloramaNotificationItem[]> wrapper;
        try { wrapper = JsonUtility.FromJson<SpilloramaApiWrapper<SpilloramaNotificationItem[]>>(req.downloadHandler.text); }
        catch (Exception ex) { onError?.Invoke("PARSE_ERROR", ex.Message); yield break; }

        if (!wrapper.ok) { onError?.Invoke(wrapper.error?.code ?? "UNKNOWN", wrapper.error?.message ?? "Ukjent feil"); yield break; }
        onSuccess?.Invoke(wrapper.data ?? new SpilloramaNotificationItem[0]);
    }

    // ── Category B: Rooms ────────────────────────────────────────────────────

    /// GET /api/rooms  — list active rooms (used for lobby display)
    public void GetRooms(
        SpilloramaApiSuccess<SpilloramaRoomSummary[]> onSuccess,
        SpilloramaApiError2 onError = null)
    {
        StartCoroutine(GetRoomsInternal(onSuccess, onError));
    }

    private IEnumerator GetRoomsInternal(
        SpilloramaApiSuccess<SpilloramaRoomSummary[]> onSuccess,
        SpilloramaApiError2 onError)
    {
        string url = BaseUrl + "/api/rooms";
        using var req = UnityWebRequest.Get(url);
        req.SetRequestHeader("Authorization", "Bearer " + Jwt);
        req.timeout = 15;
        yield return req.SendWebRequest();

        if (!HandleNetworkError(req, onError)) yield break;

        SpilloramaApiWrapper<SpilloramaRoomSummary[]> wrapper;
        try { wrapper = JsonUtility.FromJson<SpilloramaApiWrapper<SpilloramaRoomSummary[]>>(req.downloadHandler.text); }
        catch (Exception ex) { onError?.Invoke("PARSE_ERROR", ex.Message); yield break; }

        if (!wrapper.ok) { onError?.Invoke(wrapper.error?.code ?? "UNKNOWN", wrapper.error?.message ?? "Ukjent feil"); yield break; }
        onSuccess?.Invoke(wrapper.data);
    }
}
