using System;
using System.Collections;
using System.Text;
using SimpleJSON;
using UnityEngine;
using UnityEngine.Networking;

[DefaultExecutionOrder(-10000)]
public sealed class CandyLaunchBootstrap : MonoBehaviour
{
    private const string DefaultBackendBaseUrl = "https://bingosystem-3.onrender.com";
    private const string LaunchResolvePath = "/api/games/candy/launch-resolve";

    private static CandyLaunchBootstrap instance;

    public static bool HasLaunchContextInUrl { get; private set; }
    public static bool IsResolvingLaunchContext { get; private set; }
    public static bool IsLaunchContextResolved { get; private set; }
    public static bool HasLaunchResolveError { get; private set; }
    public static string LastLaunchErrorCode { get; private set; } = string.Empty;
    public static string LastLaunchErrorMessage { get; private set; } = string.Empty;
    public static string LaunchToken { get; private set; } = string.Empty;

    [Header("Launch Resolve")]
    [SerializeField] private string backendBaseUrl = DefaultBackendBaseUrl;
    [SerializeField] [Min(5f)] private float requestTimeoutSeconds = 15f;
    [SerializeField] private bool verboseLogging = true;

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
    private static void EnsureBootstrapObject()
    {
        if (instance != null)
        {
            return;
        }

        GameObject bootstrapObject = new("CandyLaunchBootstrap");
        DontDestroyOnLoad(bootstrapObject);
        instance = bootstrapObject.AddComponent<CandyLaunchBootstrap>();
    }

    private void Awake()
    {
        if (instance != null && instance != this)
        {
            Destroy(gameObject);
            return;
        }

        instance = this;
        DontDestroyOnLoad(gameObject);
        InitializeFromUrl();
    }

    private void Start()
    {
        if (!HasLaunchContextInUrl || !IsResolvingLaunchContext)
        {
            return;
        }

        StartCoroutine(ResolveLaunchContextRoutine());
    }

    private void InitializeFromUrl()
    {
        string absoluteUrl = Application.absoluteURL ?? string.Empty;
        LaunchToken = ExtractLaunchTokenFromAbsoluteUrl(absoluteUrl);

        HasLaunchContextInUrl = !string.IsNullOrWhiteSpace(LaunchToken);
        IsResolvingLaunchContext = HasLaunchContextInUrl;
        IsLaunchContextResolved = false;
        HasLaunchResolveError = false;
        LastLaunchErrorCode = string.Empty;
        LastLaunchErrorMessage = string.Empty;

        if (verboseLogging)
        {
            Debug.Log("[CandyLaunchBootstrap] " +
                      (HasLaunchContextInUrl
                          ? "Launch token funnet i URL-fragment."
                          : "Ingen launch token i URL-fragment."));
        }
    }

    private IEnumerator ResolveLaunchContextRoutine()
    {
        if (string.IsNullOrWhiteSpace(LaunchToken))
        {
            SetLaunchResolveError("LAUNCH_TOKEN_MISSING", "Launch-token mangler i URL fragment (#lt=...).");
            yield break;
        }

        string resolvedBackendBaseUrl = NormalizeBackendBaseUrl(backendBaseUrl);
        string endpoint = resolvedBackendBaseUrl + LaunchResolvePath;

        JSONObject payload = new();
        payload["launchToken"] = LaunchToken;

        using UnityWebRequest request = new UnityWebRequest(endpoint, UnityWebRequest.kHttpVerbPOST);
        request.timeout = Mathf.Max(5, Mathf.CeilToInt(requestTimeoutSeconds));
        request.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(payload.ToString()));
        request.downloadHandler = new DownloadHandlerBuffer();
        request.SetRequestHeader("Content-Type", "application/json");

        if (verboseLogging)
        {
            Debug.Log($"[CandyLaunchBootstrap] Resolving launch token mot {endpoint}");
        }

        yield return request.SendWebRequest();

        JSONNode root = SafeParseJson(request.downloadHandler != null ? request.downloadHandler.text : string.Empty);
        if (request.result != UnityWebRequest.Result.Success)
        {
            string code = FirstNonEmpty(root?["error"]?["code"], root?["code"], "LAUNCH_RESOLVE_NETWORK_ERROR");
            string message = BuildLaunchErrorMessage(code, FirstNonEmpty(root?["error"]?["message"], root?["message"]), request.responseCode);
            SetLaunchResolveError(code, message);
            yield break;
        }

        if (root == null)
        {
            SetLaunchResolveError("LAUNCH_RESOLVE_INVALID_JSON", "Launch-resolve returnerte ugyldig JSON.");
            yield break;
        }

        bool ok = root["ok"] == null || root["ok"].AsBool;
        if (!ok)
        {
            string code = FirstNonEmpty(root["error"]?["code"], root["code"], "LAUNCH_RESOLVE_FAILED");
            string message = BuildLaunchErrorMessage(code, FirstNonEmpty(root["error"]?["message"], root["message"]), request.responseCode);
            SetLaunchResolveError(code, message);
            yield break;
        }

        LaunchRuntimeContext context = ParseLaunchContext(root, resolvedBackendBaseUrl);
        if (!context.IsValid(out string validationMessage))
        {
            SetLaunchResolveError("LAUNCH_CONTEXT_INVALID", validationMessage);
            yield break;
        }

        ApplyResolvedContext(context);
    }

    private void ApplyResolvedContext(LaunchRuntimeContext context)
    {
        IsResolvingLaunchContext = false;
        IsLaunchContextResolved = true;
        HasLaunchResolveError = false;
        LastLaunchErrorCode = string.Empty;
        LastLaunchErrorMessage = string.Empty;

        if (verboseLogging)
        {
            Debug.Log($"[CandyLaunchBootstrap] Launch resolved. hallId={context.HallId}, walletId={context.WalletId}, backend={context.BackendBaseUrl}");
        }

        APIManager manager = APIManager.instance != null ? APIManager.instance : FindObjectOfType<APIManager>();
        if (manager != null)
        {
            manager.ApplyLaunchRuntimeContext(
                context.BackendBaseUrl,
                context.AccessToken,
                context.HallId,
                context.PlayerName,
                context.WalletId);
        }

        BingoRealtimeClient realtimeClient = BingoRealtimeClient.instance != null
            ? BingoRealtimeClient.instance
            : FindObjectOfType<BingoRealtimeClient>();
        if (realtimeClient != null)
        {
            realtimeClient.SetBackendBaseUrl(context.BackendBaseUrl);
            realtimeClient.SetAccessToken(context.AccessToken);
        }

        BingoAutoLogin autoLogin = FindObjectOfType<BingoAutoLogin>();
        if (autoLogin != null)
        {
            autoLogin.SetBackendBaseUrl(context.BackendBaseUrl);
            autoLogin.SetDisplayName(context.DisplayName);
            autoLogin.SetExternalStatus($"Launch OK. Hall: {context.HallId}");
        }
    }

    private void SetLaunchResolveError(string code, string message)
    {
        IsResolvingLaunchContext = false;
        IsLaunchContextResolved = false;
        HasLaunchResolveError = true;
        LastLaunchErrorCode = FirstNonEmpty(code, "LAUNCH_RESOLVE_FAILED");
        LastLaunchErrorMessage = FirstNonEmpty(
            message,
            "Launch-token er ugyldig eller utløpt. Start Candy på nytt fra portalen.");

        string combined = $"Launch feilet ({LastLaunchErrorCode}): {LastLaunchErrorMessage}";
        Debug.LogError("[CandyLaunchBootstrap] " + combined);

        BingoAutoLogin autoLogin = FindObjectOfType<BingoAutoLogin>();
        if (autoLogin != null)
        {
            autoLogin.SetExternalStatus(combined);
        }
    }

    private static LaunchRuntimeContext ParseLaunchContext(JSONNode root, string fallbackBackendBaseUrl)
    {
        JSONNode data = root["data"] != null && !root["data"].IsNull ? root["data"] : root;
        JSONNode player = data["player"];
        JSONNode user = data["user"];
        JSONNode wallet = data["wallet"];
        JSONNode hall = data["hall"];

        string displayName = FirstNonEmpty(
            data["displayName"],
            data["playerName"],
            player?["displayName"],
            player?["name"],
            user?["displayName"],
            user?["name"],
            root["displayName"],
            root["playerName"]);

        string backendOverride = FirstNonEmpty(
            data["backendBaseUrl"],
            data["apiBaseUrl"],
            data["baseUrl"],
            root["backendBaseUrl"],
            root["apiBaseUrl"]);

        return new LaunchRuntimeContext
        {
            AccessToken = FirstNonEmpty(
                data["accessToken"],
                data["token"],
                root["accessToken"],
                root["token"]),
            HallId = FirstNonEmpty(
                data["hallId"],
                hall?["id"],
                hall?["hallId"],
                root["hallId"]),
            PlayerName = FirstNonEmpty(displayName, "Player"),
            DisplayName = FirstNonEmpty(displayName, "Player"),
            WalletId = FirstNonEmpty(
                data["walletId"],
                player?["walletId"],
                user?["walletId"],
                wallet?["id"],
                root["walletId"]),
            BackendBaseUrl = NormalizeBackendBaseUrl(FirstNonEmpty(backendOverride, fallbackBackendBaseUrl))
        };
    }

    private static string BuildLaunchErrorMessage(string code, string message, long statusCode)
    {
        string normalizedCode = (code ?? string.Empty).Trim().ToUpperInvariant();

        if (normalizedCode.Contains("EXPIRED") || normalizedCode.Contains("TIMEOUT"))
        {
            return "Launch-token er utløpt. Start Candy på nytt fra portalen.";
        }

        if (normalizedCode.Contains("INVALID") ||
            normalizedCode.Contains("MISSING") ||
            normalizedCode.Contains("NOT_FOUND") ||
            statusCode == 400 ||
            statusCode == 401 ||
            statusCode == 403)
        {
            return "Launch-token er ugyldig. Start Candy på nytt fra portalen.";
        }

        if (!string.IsNullOrWhiteSpace(message))
        {
            return message.Trim();
        }

        if (statusCode >= 500)
        {
            return "Backend-feil under launch-resolve. Prøv igjen om litt.";
        }

        return "Kunne ikke validere launch-token. Start Candy på nytt fra portalen.";
    }

    private static string ExtractLaunchTokenFromAbsoluteUrl(string absoluteUrl)
    {
        if (string.IsNullOrWhiteSpace(absoluteUrl))
        {
            return string.Empty;
        }

        int hashIndex = absoluteUrl.IndexOf('#');
        if (hashIndex < 0 || hashIndex >= absoluteUrl.Length - 1)
        {
            return string.Empty;
        }

        string fragment = absoluteUrl.Substring(hashIndex + 1);
        return ExtractLaunchTokenFromFragment(fragment);
    }

    private static string ExtractLaunchTokenFromFragment(string fragment)
    {
        if (string.IsNullOrWhiteSpace(fragment))
        {
            return string.Empty;
        }

        string trimmed = fragment.Trim();
        if (trimmed.StartsWith("?"))
        {
            trimmed = trimmed.Substring(1);
        }

        int queryIndex = trimmed.IndexOf('?');
        if (queryIndex >= 0 && queryIndex < trimmed.Length - 1)
        {
            trimmed = trimmed.Substring(queryIndex + 1);
        }

        string[] pairs = trimmed.Split('&');
        for (int i = 0; i < pairs.Length; i++)
        {
            string pair = pairs[i];
            if (string.IsNullOrWhiteSpace(pair))
            {
                continue;
            }

            int equalsIndex = pair.IndexOf('=');
            string rawKey = equalsIndex >= 0 ? pair.Substring(0, equalsIndex) : pair;
            string rawValue = equalsIndex >= 0 && equalsIndex < pair.Length - 1
                ? pair.Substring(equalsIndex + 1)
                : string.Empty;

            string key = SafeUrlDecode(rawKey);
            if (!key.Equals("lt", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            return SafeUrlDecode(rawValue).Trim();
        }

        return string.Empty;
    }

    private static string NormalizeBackendBaseUrl(string rawBaseUrl)
    {
        string normalized = (rawBaseUrl ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(normalized))
        {
            normalized = DefaultBackendBaseUrl;
        }

        if (!normalized.StartsWith("http://", StringComparison.OrdinalIgnoreCase) &&
            !normalized.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
        {
            normalized = "https://" + normalized;
        }

        return normalized.TrimEnd('/');
    }

    private static string SafeUrlDecode(string value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return string.Empty;
        }

        try
        {
            return Uri.UnescapeDataString(value.Replace("+", "%20"));
        }
        catch
        {
            return value;
        }
    }

    private static string FirstNonEmpty(params string[] values)
    {
        if (values == null)
        {
            return string.Empty;
        }

        for (int i = 0; i < values.Length; i++)
        {
            if (!string.IsNullOrWhiteSpace(values[i]))
            {
                return values[i].Trim();
            }
        }

        return string.Empty;
    }

    private static JSONNode SafeParseJson(string text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return null;
        }

        try
        {
            return JSON.Parse(text);
        }
        catch
        {
            return null;
        }
    }

    private sealed class LaunchRuntimeContext
    {
        public string AccessToken = string.Empty;
        public string HallId = string.Empty;
        public string PlayerName = "Player";
        public string DisplayName = "Player";
        public string WalletId = string.Empty;
        public string BackendBaseUrl = DefaultBackendBaseUrl;

        public bool IsValid(out string errorMessage)
        {
            if (string.IsNullOrWhiteSpace(AccessToken))
            {
                errorMessage = "Launch-resolve mangler accessToken i responsen.";
                return false;
            }

            if (string.IsNullOrWhiteSpace(HallId))
            {
                errorMessage = "Launch-resolve mangler hallId i responsen.";
                return false;
            }

            if (string.IsNullOrWhiteSpace(PlayerName))
            {
                errorMessage = "Launch-resolve mangler playerName/displayName i responsen.";
                return false;
            }

            if (string.IsNullOrWhiteSpace(WalletId))
            {
                errorMessage = "Launch-resolve mangler walletId i responsen.";
                return false;
            }

            if (string.IsNullOrWhiteSpace(BackendBaseUrl))
            {
                errorMessage = "Launch-resolve mangler backendBaseUrl i responsen.";
                return false;
            }

            errorMessage = string.Empty;
            return true;
        }
    }
}
