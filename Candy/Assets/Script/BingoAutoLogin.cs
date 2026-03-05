using System.Collections;
using System.Text;
using TMPro;
using UnityEngine;
using UnityEngine.Networking;
using UnityEngine.UI;
using SimpleJSON;

public class BingoAutoLogin : MonoBehaviour
{
    [SerializeField] private APIManager apiManager;
    [SerializeField] private BingoRealtimeControls realtimeControls;

    [Header("Optional UI Inputs")]
    [SerializeField] private TMP_InputField emailInput;
    [SerializeField] private TMP_InputField passwordInput;
    [SerializeField] private TMP_InputField hallIdInput;
    [SerializeField] private TMP_InputField accessTokenInput;
    [SerializeField] private Button loginButton;
    [SerializeField] private TextMeshProUGUI statusText;

    [Header("Backend")]
    [SerializeField] private string backendBaseUrl = "https://bingosystem-3.onrender.com";

    [Header("Credential Fallback (used when inputs are empty)")]
    [SerializeField] private string email = "demo@bingo.local";
    [SerializeField] private string password = "Demo12345!";
    [SerializeField] private string displayName = "Demo Player";

    [Header("Dev Bootstrap")]
    [SerializeField] private bool autoRegisterIfMissing = true;
    [SerializeField] private bool autoKycVerify = true;
    [SerializeField] private string kycBirthDate = "1990-01-01";
    [SerializeField] private string kycNationalId = "";

    [Header("Behavior")]
    [SerializeField] private bool autoLoginOnStart = false;
    [SerializeField] private bool autoConnectAndJoin = true;
    [SerializeField] private bool preferExistingHallIdInput = true;

    private bool isBusy;

    private void OnEnable()
    {
        BindLoginButton();
    }

    private void OnDisable()
    {
        UnbindLoginButton();
    }

    private void Start()
    {
        ResolveReferences();
        ApplyDefaultInputValues();
        if (autoLoginOnStart)
        {
            StartAutoLogin();
        }
    }

    [ContextMenu("Start Auto Login")]
    public void StartAutoLogin()
    {
        if (isBusy)
        {
            return;
        }
        StartCoroutine(LoginAndApplyRoutine());
    }

    public void OnLoginButtonClicked()
    {
        StartAutoLogin();
    }

    private IEnumerator LoginAndApplyRoutine()
    {
        isBusy = true;
        ResolveReferences();
        SetStatus("Logger inn...");

        string loginEmail = FirstNonEmpty(
            emailInput != null ? emailInput.text : string.Empty,
            email
        );
        string loginPassword = FirstNonEmpty(
            passwordInput != null ? passwordInput.text : string.Empty,
            password
        );

        if (string.IsNullOrWhiteSpace(loginEmail) || string.IsNullOrWhiteSpace(loginPassword))
        {
            SetStatus("Mangler e-post eller passord.");
            isBusy = false;
            yield break;
        }

        string normalizedBaseUrl = NormalizeBaseUrl(backendBaseUrl);
        string token = string.Empty;
        string loginErrorCode = string.Empty;
        string loginErrorMessage = string.Empty;
        yield return RequestAccessToken(normalizedBaseUrl, loginEmail, loginPassword, (success, message, fetchedToken, errorCode) =>
        {
            if (!success)
            {
                loginErrorMessage = message;
                loginErrorCode = errorCode;
                token = string.Empty;
                return;
            }

            token = fetchedToken;
        });

        if (string.IsNullOrWhiteSpace(token) && autoRegisterIfMissing)
        {
            SetStatus("Fant ikke bruker. Oppretter testbruker...");
            string registerErrorMessage = string.Empty;
            yield return RequestRegisterSession(
                normalizedBaseUrl,
                loginEmail,
                loginPassword,
                displayName,
                (success, message, fetchedToken, _errorCode) =>
                {
                    if (!success)
                    {
                        registerErrorMessage = message;
                        token = string.Empty;
                        return;
                    }

                    token = fetchedToken;
                }
            );

            if (string.IsNullOrWhiteSpace(token) && !string.IsNullOrWhiteSpace(registerErrorMessage))
            {
                SetStatus("Register feilet: " + registerErrorMessage);
                isBusy = false;
                yield break;
            }
        }

        if (string.IsNullOrWhiteSpace(token))
        {
            string reason = !string.IsNullOrWhiteSpace(loginErrorMessage) ? loginErrorMessage : "Ukjent login-feil.";
            SetStatus($"Login feilet ({loginErrorCode}): {reason}");
            isBusy = false;
            yield break;
        }

        if (accessTokenInput != null)
        {
            accessTokenInput.text = token;
        }

        if (apiManager != null)
        {
            apiManager.ConfigureAccessToken(token);
        }

        if (autoKycVerify)
        {
            yield return RequestKycVerify(
                normalizedBaseUrl,
                token,
                kycBirthDate,
                kycNationalId,
                (success, message) =>
                {
                    if (!success)
                    {
                        SetStatus("KYC-verifisering feilet: " + message);
                    }
                }
            );
        }

        string configuredHallId = string.Empty;
        if (preferExistingHallIdInput && hallIdInput != null)
        {
            configuredHallId = (hallIdInput.text ?? string.Empty).Trim();
        }

        if (string.IsNullOrWhiteSpace(configuredHallId))
        {
            yield return RequestHallId(normalizedBaseUrl, token, (success, message, fetchedHallId) =>
            {
                if (!success)
                {
                    SetStatus("Kunne ikke hente hall: " + message);
                    configuredHallId = string.Empty;
                    return;
                }

                configuredHallId = fetchedHallId;
            });
        }

        if (string.IsNullOrWhiteSpace(configuredHallId))
        {
            isBusy = false;
            yield break;
        }

        if (hallIdInput != null)
        {
            hallIdInput.text = configuredHallId;
        }

        if (apiManager != null)
        {
            apiManager.ConfigureHall(configuredHallId);
        }

        if (realtimeControls != null)
        {
            realtimeControls.ApplyInputs();
        }

        if (autoConnectAndJoin && apiManager != null)
        {
            apiManager.RequestRealtimeState();
        }

        SetStatus($"Innlogging OK. Hall: {configuredHallId}");
        isBusy = false;
    }

    private IEnumerator RequestAccessToken(
        string normalizedBaseUrl,
        string loginEmail,
        string loginPassword,
        System.Action<bool, string, string, string> onComplete)
    {
        JSONObject requestPayload = new();
        requestPayload["email"] = loginEmail.Trim();
        requestPayload["password"] = loginPassword;

        string endpoint = normalizedBaseUrl + "/api/auth/login";
        using UnityWebRequest request = new UnityWebRequest(endpoint, UnityWebRequest.kHttpVerbPOST);
        byte[] body = Encoding.UTF8.GetBytes(requestPayload.ToString());
        request.uploadHandler = new UploadHandlerRaw(body);
        request.downloadHandler = new DownloadHandlerBuffer();
        request.SetRequestHeader("Content-Type", "application/json");

        yield return request.SendWebRequest();

        if (request.result != UnityWebRequest.Result.Success)
        {
            onComplete?.Invoke(false, BuildTransportError(request), string.Empty, "NETWORK_ERROR");
            yield break;
        }

        JSONNode root = SafeParseJson(request.downloadHandler.text);
        if (root == null)
        {
            onComplete?.Invoke(false, "Ugyldig JSON fra /api/auth/login.", string.Empty, "INVALID_JSON");
            yield break;
        }

        bool ok = root["ok"] == null || root["ok"].AsBool;
        if (!ok)
        {
            string code = FirstNonEmpty(root["error"]?["code"], "LOGIN_FAILED");
            string message = FirstNonEmpty(root["error"]?["message"], code, "Ukjent login-feil.");
            onComplete?.Invoke(false, message, string.Empty, code);
            yield break;
        }

        string token = FirstNonEmpty(
            root["data"]?["accessToken"],
            root["accessToken"],
            root["data"]?["token"],
            root["token"]
        );

        if (string.IsNullOrWhiteSpace(token))
        {
            onComplete?.Invoke(false, "Fant ikke accessToken i login-responsen.", string.Empty, "TOKEN_MISSING");
            yield break;
        }

        onComplete?.Invoke(true, string.Empty, token, string.Empty);
    }

    private IEnumerator RequestRegisterSession(
        string normalizedBaseUrl,
        string registerEmail,
        string registerPassword,
        string registerDisplayName,
        System.Action<bool, string, string, string> onComplete)
    {
        JSONObject requestPayload = new();
        requestPayload["email"] = registerEmail.Trim();
        requestPayload["password"] = registerPassword;
        requestPayload["displayName"] = FirstNonEmpty(registerDisplayName, "Demo Player");

        string endpoint = normalizedBaseUrl + "/api/auth/register";
        using UnityWebRequest request = new UnityWebRequest(endpoint, UnityWebRequest.kHttpVerbPOST);
        byte[] body = Encoding.UTF8.GetBytes(requestPayload.ToString());
        request.uploadHandler = new UploadHandlerRaw(body);
        request.downloadHandler = new DownloadHandlerBuffer();
        request.SetRequestHeader("Content-Type", "application/json");

        yield return request.SendWebRequest();

        if (request.result != UnityWebRequest.Result.Success)
        {
            onComplete?.Invoke(false, BuildTransportError(request), string.Empty, "NETWORK_ERROR");
            yield break;
        }

        JSONNode root = SafeParseJson(request.downloadHandler.text);
        if (root == null)
        {
            onComplete?.Invoke(false, "Ugyldig JSON fra /api/auth/register.", string.Empty, "INVALID_JSON");
            yield break;
        }

        bool ok = root["ok"] == null || root["ok"].AsBool;
        if (!ok)
        {
            string code = FirstNonEmpty(root["error"]?["code"], "REGISTER_FAILED");
            string message = FirstNonEmpty(root["error"]?["message"], code, "Ukjent register-feil.");
            onComplete?.Invoke(false, message, string.Empty, code);
            yield break;
        }

        string token = FirstNonEmpty(
            root["data"]?["accessToken"],
            root["accessToken"],
            root["data"]?["token"],
            root["token"]
        );

        if (string.IsNullOrWhiteSpace(token))
        {
            onComplete?.Invoke(false, "Fant ikke accessToken i register-responsen.", string.Empty, "TOKEN_MISSING");
            yield break;
        }

        onComplete?.Invoke(true, string.Empty, token, string.Empty);
    }

    private IEnumerator RequestKycVerify(
        string normalizedBaseUrl,
        string token,
        string birthDate,
        string nationalId,
        System.Action<bool, string> onComplete)
    {
        if (string.IsNullOrWhiteSpace(birthDate))
        {
            onComplete?.Invoke(false, "birthDate mangler.");
            yield break;
        }

        JSONObject requestPayload = new();
        requestPayload["birthDate"] = birthDate.Trim();
        if (!string.IsNullOrWhiteSpace(nationalId))
        {
            requestPayload["nationalId"] = nationalId.Trim();
        }

        string endpoint = normalizedBaseUrl + "/api/kyc/verify";
        using UnityWebRequest request = new UnityWebRequest(endpoint, UnityWebRequest.kHttpVerbPOST);
        byte[] body = Encoding.UTF8.GetBytes(requestPayload.ToString());
        request.uploadHandler = new UploadHandlerRaw(body);
        request.downloadHandler = new DownloadHandlerBuffer();
        request.SetRequestHeader("Content-Type", "application/json");
        request.SetRequestHeader("Authorization", "Bearer " + token);

        yield return request.SendWebRequest();

        if (request.result != UnityWebRequest.Result.Success)
        {
            onComplete?.Invoke(false, BuildTransportError(request));
            yield break;
        }

        JSONNode root = SafeParseJson(request.downloadHandler.text);
        if (root == null)
        {
            onComplete?.Invoke(false, "Ugyldig JSON fra /api/kyc/verify.");
            yield break;
        }

        bool ok = root["ok"] == null || root["ok"].AsBool;
        if (!ok)
        {
            string message = FirstNonEmpty(root["error"]?["message"], root["error"]?["code"], "Ukjent KYC-feil.");
            onComplete?.Invoke(false, message);
            yield break;
        }

        onComplete?.Invoke(true, string.Empty);
    }

    private IEnumerator RequestHallId(
        string normalizedBaseUrl,
        string token,
        System.Action<bool, string, string> onComplete)
    {
        string endpoint = normalizedBaseUrl + "/api/halls";
        using UnityWebRequest request = UnityWebRequest.Get(endpoint);
        request.SetRequestHeader("Authorization", "Bearer " + token);

        yield return request.SendWebRequest();

        if (request.result != UnityWebRequest.Result.Success)
        {
            onComplete?.Invoke(false, BuildTransportError(request), string.Empty);
            yield break;
        }

        JSONNode root = SafeParseJson(request.downloadHandler.text);
        if (root == null)
        {
            onComplete?.Invoke(false, "Ugyldig JSON fra /api/halls.", string.Empty);
            yield break;
        }

        bool ok = root["ok"] == null || root["ok"].AsBool;
        if (!ok)
        {
            string message = FirstNonEmpty(root["error"]?["message"], root["error"]?["code"], "Ukjent hall-feil.");
            onComplete?.Invoke(false, message, string.Empty);
            yield break;
        }

        JSONNode halls = root["data"];
        if (halls == null || halls.IsNull)
        {
            onComplete?.Invoke(false, "Mangler hall-data i respons.", string.Empty);
            yield break;
        }

        string hallId = string.Empty;
        if (halls.IsArray && halls.Count > 0)
        {
            hallId = FirstNonEmpty(halls[0]?["id"], halls[0]?["hallId"]);
        }
        else
        {
            hallId = FirstNonEmpty(halls["id"], halls["hallId"]);
        }

        if (string.IsNullOrWhiteSpace(hallId))
        {
            onComplete?.Invoke(false, "Fant ingen hallId i /api/halls-respons.", string.Empty);
            yield break;
        }

        onComplete?.Invoke(true, string.Empty, hallId);
    }

    private void ResolveReferences()
    {
        if (apiManager == null)
        {
            apiManager = APIManager.instance;
        }

        if (realtimeControls == null)
        {
            realtimeControls = FindObjectOfType<BingoRealtimeControls>();
        }
    }

    private void ApplyDefaultInputValues()
    {
        if (emailInput != null && string.IsNullOrWhiteSpace(emailInput.text))
        {
            emailInput.text = email;
        }

        if (passwordInput != null && string.IsNullOrWhiteSpace(passwordInput.text))
        {
            passwordInput.text = password;
        }
    }

    private void BindLoginButton()
    {
        if (loginButton == null)
        {
            return;
        }

        loginButton.onClick.RemoveListener(OnLoginButtonClicked);
        loginButton.onClick.AddListener(OnLoginButtonClicked);
    }

    private void UnbindLoginButton()
    {
        if (loginButton == null)
        {
            return;
        }

        loginButton.onClick.RemoveListener(OnLoginButtonClicked);
    }

    private void SetStatus(string message)
    {
        if (statusText != null)
        {
            statusText.text = message;
        }
        else
        {
            Debug.Log("[BingoAutoLogin] " + message);
        }
    }

    private static string NormalizeBaseUrl(string baseUrl)
    {
        string normalized = (baseUrl ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(normalized))
        {
            normalized = "http://localhost:4000";
        }
        if (!normalized.StartsWith("http://", System.StringComparison.OrdinalIgnoreCase) &&
            !normalized.StartsWith("https://", System.StringComparison.OrdinalIgnoreCase))
        {
            normalized = "http://" + normalized;
        }
        return normalized.TrimEnd('/');
    }

    private static string FirstNonEmpty(params string[] values)
    {
        if (values == null)
        {
            return string.Empty;
        }

        for (int i = 0; i < values.Length; i++)
        {
            string value = values[i];
            if (!string.IsNullOrWhiteSpace(value))
            {
                return value.Trim();
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

    private static string BuildTransportError(UnityWebRequest request)
    {
        string status = request.responseCode > 0 ? $"HTTP {request.responseCode}" : "No HTTP status";
        string body = request.downloadHandler != null ? request.downloadHandler.text : string.Empty;
        string message = string.IsNullOrWhiteSpace(request.error) ? "Ukjent nettverksfeil." : request.error;
        if (!string.IsNullOrWhiteSpace(body))
        {
            return $"{status}: {message}. Body: {body}";
        }
        return $"{status}: {message}";
    }
}
