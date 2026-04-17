using System;
using System.Collections;
using System.Collections.Generic;
using System.Threading.Tasks;
using Gpm.Common.ThirdParty.SharpCompress.Common;
using Gpm.WebView;
using JetBrains.Annotations;
using UnityEngine;
using Vuplex.WebView;
using System.Runtime.InteropServices;
using UnityEngine.UI;

public class webViewManager : MonoBehaviour
{
    #region Variables
    public static webViewManager Instance = null;

    public CanvasWebViewPrefab WebViewPrefab;
    public CanvasWebViewPrefab WebViewPrefabProfile;

    public Transform WebViewPrefabParent;
    public Transform WebViewPrefabParentStandalone;
    public Transform WebViewPrefabParentProfile;
    private string SessionIdRef;
    private bool ByLoadUrl = false;
    private string storeUrl;
    public string ua = "";
    public Button btnBack;
    public Button btnForward;

    private CanvasWebViewPrefab _cachedWebView;
    private CanvasWebViewPrefab _cachedWebViewProfile;
    private bool isMinimized = false;
    #endregion
#if UNITY_WEBGL && !UNITY_EDITOR
    [DllImport("__Internal")]
    private static extern string GetUserAgent();
#endif

    #region Unity Default Methods

    private void Awake()
    {
        if (Instance == null)
        {
            Instance = this;
        }
    }

    void Start()
    {
#if !UNITY_EDITOR && !UNITY_STANDALONE_LINUX
        Debug.Log("Start");
        GetUserAgentFromHiddenWebView(OnUserAgentReceived);
#endif
    }
    private void OnUserAgentReceived(string userAgent)
    {
        ua = userAgent;
        Debug.Log($"User Agent from hidden WebView: {ua}");
        UIManager.Instance.gameAssetData.userAgent = ua;
    }

#if UNITY_ANDROID || UNITY_IOS

    void OnApplicationFocus(bool hasFocus)
    {
        if (!hasFocus)
        {
            isMinimized = true;
            Debug.LogWarning("Application minimized");
        }
        else
        {
            Debug.LogWarning("Application maximized");
            if (isMinimized)
            {
#if UNITY_IOS
                if (GpmWebView.IsActive() == true)
                {
                    GpmWebView.Close();
                    StopAllCoroutines();
                    StartCoroutine(RefreshURLAfterDelay(0.1f));
                }
#endif
                // Android: Vuplex WebView maintains state across focus changes
            }
            isMinimized = false;
        }
    }
#endif

    private IEnumerator RefreshURLAfterDelay(float delay)
    {
        yield return new WaitForSeconds(delay);
        RefreshURL();
    }

    public void RefreshURL(string url = null)
    {
        Debug.LogWarning("WebPage Active & Refresh");
#if UNITY_ANDROID
        CloseWebs();
        SetdataOpenrlStandlone(url ?? storeUrl);
#elif UNITY_IOS
        ShowUrlPopupMargins(storeUrl);
#elif UNITY_WEBGL
        CloseWebs();
        SetdataOpenrlStandlone(url);
        SetdataOpenUrlStandlone(url);
#endif
    }

    #region Subscribed Methods    

    // Popup custom margins

    public void ShowUrlPopupMargins(string Url)
    {
        Debug.Log("ShowUrlPopupMargins: " + Url);
        storeUrl = Url;
        GpmWebView.ShowUrl(
            Url,
            new GpmWebViewRequest.Configuration()
            {
                style = GpmWebViewStyle.POPUP,
                orientation = GpmOrientation.UNSPECIFIED,
                isClearCookie = true,
                isClearCache = true,
                isNavigationBarVisible = true,
                navigationBarColor = "#812222",
                isCloseButtonVisible = true,
                margins = new GpmWebViewRequest.Margins
                {
                    hasValue = true,
                    left = 0,
                    top = 40,
                    right = 150,
                    bottom = 0
                },
                supportMultipleWindows = true,
#if UNITY_IOS
                contentMode = GpmWebViewContentMode.MOBILE,
                isMaskViewVisible = true,
#endif
            }, OnWebViewCallback, null); ;
    }

    public void ShowUrlPopupMarginsFULLSCREEN(string Url)
    {
        Debug.Log("ShowUrlPopupMarginsFULLSCREEN: " + Url);
        storeUrl = Url;
        GpmWebView.ShowUrl(Url, new GpmWebViewRequest.Configuration()
        {
            style = GpmWebViewStyle.FULLSCREEN,
            orientation = GpmOrientation.UNSPECIFIED,
            isClearCookie = true,
            isClearCache = true,
            isNavigationBarVisible = true,
            navigationBarColor = "#812222",
            isCloseButtonVisible = true,
            margins = new GpmWebViewRequest.Margins
            {
                hasValue = true,
                left = 0,
                top = 0,
                right = 0,
                bottom = 0
            },
            supportMultipleWindows = true,
#if UNITY_IOS
            contentMode = GpmWebViewContentMode.MOBILE,
            isMaskViewVisible = true,
#endif
        }, OnWebViewCallback, null);
    }

    private void OnWebViewCallback(GpmWebViewCallback.CallbackType callbackType, string data, GpmWebViewError error)
    {
        Debug.Log("OnWebViewCallback: " + callbackType);
        switch (callbackType)
        {
            case GpmWebViewCallback.CallbackType.Open:
                if (error != null)
                {
                    Debug.LogFormat("Fail to open WebView. Error:{0}", error);
                }
                break;
            case GpmWebViewCallback.CallbackType.Close:
                if (error != null)
                {
                    Debug.LogFormat("Fail to close WebView. Error:{0}", error);
                }
                break;
            case GpmWebViewCallback.CallbackType.PageStarted:
                if (string.IsNullOrEmpty(data) == false)
                {
                    Debug.LogFormat("PageStarted Url : {0}", data);
                    if (data.Contains("Privacy") || data.Contains("privacy"))
                    {
                        Application.OpenURL(data);
                    }
                }
                else
                {
                    if (data.Contains("Privacy") || data.Contains("privacy"))
                    {
                        Application.OpenURL(data);
                    }
                }
                break;
            case GpmWebViewCallback.CallbackType.PageLoad:
                if (string.IsNullOrEmpty(data) == false)
                {
                    Debug.LogFormat("Loaded Page:{0}", data);
                }
                break;
            case GpmWebViewCallback.CallbackType.MultiWindowOpen:
                Debug.Log("MultiWindowOpen");
                break;
            case GpmWebViewCallback.CallbackType.MultiWindowClose:
                Debug.Log("MultiWindowClose");
                break;
            case GpmWebViewCallback.CallbackType.Scheme:
                Debug.LogFormat("Scheme:{0}", data);
                break;
            case GpmWebViewCallback.CallbackType.GoBack:
                Debug.Log("GoBack");
                GpmWebView.GoBack();
                break;
            case GpmWebViewCallback.CallbackType.GoForward:
                Debug.Log("GoForward");
                GpmWebView.GoForward();
                break;
            case GpmWebViewCallback.CallbackType.ExecuteJavascript:
                Debug.LogFormat("ExecuteJavascript data : {0}, error : {1}", data, error);
                break;
#if UNITY_ANDROID
            case GpmWebViewCallback.CallbackType.BackButtonClose:
                Debug.Log("BackButtonClose");
                break;
#endif
        }
    }

    #endregion

    #endregion

    #region Ienumators
    #endregion

    #region Management Methods

    public void CloseWebs()
    {
        if (_cachedWebView != null)
        {
            _cachedWebView.gameObject.SetActive(false);
            // Optional: Clear the URL to free resources
            _cachedWebView.WebView.LoadHtml("");
        }
        if (_cachedWebViewProfile != null)
        {
            _cachedWebViewProfile.gameObject.SetActive(false);
            // Optional: Clear the URL to free resources
            _cachedWebViewProfile.WebView.LoadHtml("");
        }
        // foreach (Transform item in WebViewPrefabParent)
        // {
        //     Destroy(item.gameObject);
        // }
        // foreach (Transform item in WebViewPrefabParentProfile)
        // {
        //     Destroy(item.gameObject);
        // }
        GpmWebView.Close();

    }

    /*public void DestoryWebs()
    {
        Debug.Log("DestoryWebs");
        //GpmWebView.Close();

        foreach (Transform item in WebViewPrefabParent)
        {
            Debug.Log("DestoryWebs: " + item.gameObject.name);
            Destroy(item.gameObject);
        }
        foreach (Transform item in WebViewPrefabParentProfile)
        {
            Debug.Log("DestoryWebs Profile: " + item.gameObject.name);
            Destroy(item.gameObject);
        }
    }*/

    // Code written by caddy
    public void DestoryWebs()
    {
        Debug.Log("DestoryWebs");

        if (GpmWebView.IsActive() == true)
        {
            GpmWebView.Close();
            StartCoroutine(DestroyAfterDelay());
        }
        else
        {
            DestroyPrefabs();
        }
    }

    private IEnumerator DestroyAfterDelay()
    {
        yield return new WaitForSeconds(0.5f); // Wait for WebView to fully close
        DestroyPrefabs();
    }

    private void DestroyPrefabs()
    {
        if (WebViewPrefabParent != null && WebViewPrefabParent.childCount > 0)
        {
            foreach (Transform item in WebViewPrefabParent)
            {
                Debug.Log("Destroying: " + item.gameObject.name);
                Destroy(item.gameObject);
            }
        }
        if (WebViewPrefabParentProfile != null && WebViewPrefabParentProfile.childCount > 0)
        {
            foreach (Transform item in WebViewPrefabParentProfile)
            {
                Debug.Log("Destroying Profile: " + item.gameObject.name);
                Destroy(item.gameObject);
            }
        }
        if (WebViewPrefabParentStandalone != null && WebViewPrefabParentStandalone.childCount > 0)
        {
            foreach (Transform item in WebViewPrefabParentStandalone)
            {
                Debug.Log("Destroying Standalone: " + item.gameObject.name);
                Destroy(item.gameObject);
            }
        }
    }

    private void HandleMessage(object sender, EventArgs<string> e)
    {
        try
        {
            var msg = JsonUtility.FromJson<MessageData>(e.Value);
            if (msg.type == "openExternal" && !string.IsNullOrEmpty(msg.url))
            {
                Debug.Log("Opening external URL: " + msg.url);
                Application.OpenURL(msg.url);
            }
        }
        catch (System.Exception ex)
        {
            Debug.LogError("Message parse error: " + ex.Message);
        }
    }

    async public void SetdataOpenrlStandlone(string URL)
    {
        Debug.Log("SetdataOpenrlStandlone: " + URL);
        storeUrl = URL;
        // // Get a reference to the CanvasWebViewPrefab.
        // // https://support.vuplex.com/articles/how-to-reference-a-webview

        // CanvasWebViewPrefab obj = Instantiate(WebViewPrefab);
        // obj.transform.SetParent(WebViewPrefabParent, false);
        // obj.InitialUrl = URL;

        // await obj.WaitUntilInitialized();
        // //yield return new WaitUntil(() => canvasWebViewPrefab.WaitUntilInitialized());

        // // After the prefab has initialized, you can use the IWebView APIs via its WebView property.
        // // https://developer.vuplex.com/webview/IWebView
        // obj.WebView.UrlChanged += (sender, eventArgs) =>
        // {
        //     Debug.Log("[CanvasWebViewDemo] URL changed: " + eventArgs.Url);
        // };

        // Initialize the WebView once and reuse it
        if (_cachedWebView == null)
        {
            _cachedWebView = Instantiate(WebViewPrefab);
            _cachedWebView.transform.SetParent(WebViewPrefabParent, false);
            await _cachedWebView.WaitUntilInitialized();

            // Subscribe to events only once
            _cachedWebView.WebView.UrlChanged += OnUrlChanged;
            _cachedWebView.WebView.MessageEmitted += HandleMessage;
        }
        _cachedWebView.transform.GetChild(2).GetComponent<Button>().onClick.AddListener(delegate { _cachedWebView.WebView.GoBack(); });
        _cachedWebView.transform.GetChild(3).GetComponent<Button>().onClick.AddListener(delegate { _cachedWebView.WebView.GoForward(); });
        // Load the URL without re-initializing the WebView
        _cachedWebView.WebView.LoadUrl(URL);
        _cachedWebView.gameObject.SetActive(true); // Ensure visibility

    }

    async public void SetdataOpenUrlStandlone(string URL)
    {
        Debug.Log("SetdataOpenUrlStandlone: " + URL);
        storeUrl = URL;
        // // Get a reference to the CanvasWebViewPrefab.
        // // https://support.vuplex.com/articles/how-to-reference-a-webview

        // CanvasWebViewPrefab obj = Instantiate(WebViewPrefab);
        // obj.transform.SetParent(WebViewPrefabParentProfile, false);
        // obj.InitialUrl = URL;

        // await obj.WaitUntilInitialized();
        // //yield return new WaitUntil(() => canvasWebViewPrefab.WaitUntilInitialized());

        // // After the prefab has initialized, you can use the IWebView APIs via its WebView property.
        // // https://developer.vuplex.com/webview/IWebView
        // obj.WebView.UrlChanged += (sender, eventArgs) =>
        // {
        //     Debug.Log("[CanvasWebViewDemo] URL changed: " + eventArgs.Url);
        // };

        // Initialize the WebView once and reuse it
        if (_cachedWebViewProfile == null)
        {
            _cachedWebViewProfile = Instantiate(WebViewPrefabProfile);
            _cachedWebViewProfile.transform.SetParent(WebViewPrefabParentProfile, false);
            await _cachedWebViewProfile.WaitUntilInitialized();

            // Subscribe to events only once
            _cachedWebViewProfile.WebView.UrlChanged += OnUrlChanged;
        }

        // Load the URL without re-initializing the WebView
        _cachedWebViewProfile.WebView.LoadUrl(URL);
        _cachedWebViewProfile.gameObject.SetActive(true); // Ensure visibility
    }

    private void OnUrlChanged(object sender, EventArgs e)
    {
        Debug.Log($"[WebView] URL changed: {((UrlChangedEventArgs)e).Url}");
    }
    #endregion

    /// <summary>
    /// Opens a hidden WebView, grabs navigator.userAgent, then closes it
    /// </summary>
    /// <param name="callback">Callback function to receive the user agent string</param>
    public void GetUserAgentFromHiddenWebView(System.Action<string> callback)
    {
        Debug.Log("GetUserAgentFromHiddenWebView: " + UIManager.Instance.gameAssetData.userAgent);
        if (!string.IsNullOrEmpty(UIManager.Instance.gameAssetData.userAgent)) return;
        Debug.Log("GetUserAgentFromHiddenWebView: Empty");
#if UNITY_ANDROID || UNITY_IOS
        Debug.Log("GetUserAgentFromHiddenWebView: Mobile");
        // For mobile platforms, use GPM WebView
        StartCoroutine(GetUserAgentMobile(callback));
#elif UNITY_WEBGL && !UNITY_EDITOR
        Debug.Log("GetUserAgentFromHiddenWebView: WebGL");
        ua = GetUserAgent();
        Debug.Log($"User Agent from hidden WebView: {ua}");
        UIManager.Instance.gameAssetData.userAgent = ua;
#else
        // For other platforms, use Vuplex WebView
        Debug.Log("GetUserAgentFromHiddenWebView: Other");
        StartCoroutine(GetUserAgentForStandalone(callback));
#endif
    }

#if UNITY_ANDROID || UNITY_IOS
    private IEnumerator GetUserAgentMobile(System.Action<string> callback)
    {
        yield return new WaitForSeconds(0.01f);
        Debug.Log("GetUserAgentMobile");
        // For mobile platforms, we'll use a custom HTML page that reports the user agent
        string htmlContent = @"
        <!DOCTYPE html>
        <html>
        <head>
            <title>User Agent Detection</title>
        </head>
        <body>
            <script>
                // Report user agent to Unity
                window.location.href = 'unity://useragent?ua=' + encodeURIComponent(navigator.userAgent);
            </script>
        </body>
        </html>";

        // Create a hidden WebView configuration
        GpmWebView.ShowHtmlString(
            htmlContent,
            new GpmWebViewRequest.Configuration()
            {
                style = GpmWebViewStyle.POPUP,
                orientation = GpmOrientation.UNSPECIFIED,
                isClearCookie = true,
                isClearCache = true,
                isNavigationBarVisible = false,
                isCloseButtonVisible = false,
                margins = new GpmWebViewRequest.Margins
                {
                    hasValue = true,
                    left = -1000, // Hide off-screen
                    top = -1000,
                    right = -1000,
                    bottom = -1000
                },
                supportMultipleWindows = true,
#if UNITY_IOS
                contentMode = GpmWebViewContentMode.MOBILE,
                isMaskViewVisible = false,
#endif
            },
            (callbackType, data, error) =>
            {
                if (callbackType == GpmWebViewCallback.CallbackType.Scheme)
                {
                    // Parse the user agent from the scheme
                    if (data != null && data.StartsWith("unity://useragent?ua="))
                    {
                        string userAgent = System.Uri.UnescapeDataString(data.Substring("unity://useragent?ua=".Length));
                        Debug.Log($"User Agent from hidden WebView: {userAgent}");
                        callback?.Invoke(userAgent);
                        ua = userAgent;
                        UIManager.Instance.gameAssetData.userAgent = ua;
                    }
                    else
                    {
                        Debug.LogError("Failed to parse user agent from scheme");
                        callback?.Invoke("");
                    }
                    // Close the WebView
                    GpmWebView.Close();
                }
            },
            new List<string> { "unity" } // Register the unity scheme
        );

        yield return null;
    }
#endif

    IEnumerator GetUserAgentForStandalone(System.Action<string> callback)
    {
        Debug.Log("GetUserAgentForStandalone");
        yield return new WaitForSeconds(0.01f);
        GetUserAgentStandalone("https://example.com/", callback);
        //GetUserAgentStandalone("https://example.com/", callback);
        // callback?.Invoke("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
    }

    async public void GetUserAgentStandalone(string URL, Action<string> onUserAgentReady)
    {
        Debug.Log("GetUserAgentStandalone: " + URL);
        storeUrl = URL;

        // Initialize the WebView once and reuse it
        if (_cachedWebView == null)
        {
            _cachedWebView = Instantiate(WebViewPrefab);
            _cachedWebView.transform.SetParent(WebViewPrefabParentStandalone, false);
            await _cachedWebView.WaitUntilInitialized();

            // Subscribe to events only once
            _cachedWebView.WebView.UrlChanged += OnUrlChanged;
        }

        // Load the URL without re-initializing the WebView
        _cachedWebView.WebView.LoadUrl(URL);
        _cachedWebView.gameObject.SetActive(true); // Ensure visibility
        await _cachedWebView.WebView.WaitForNextPageLoadToFinish();
        _cachedWebView.gameObject.SetActive(false);
        _cachedWebView.transform.parent.gameObject.SetActive(false);
        try
        {
            // 🚀 Ask the webview for its UA
            string ua = await _cachedWebView.WebView.ExecuteJavaScript("navigator.userAgent");
            Debug.Log("Standalone UserAgent: " + ua);
            UIManager.Instance.gameAssetData.userAgent = ua;

            // Return it to the caller
            onUserAgentReady?.Invoke(ua);
        }
        catch (Exception ex)
        {
            Debug.LogError("Failed to get UserAgent: " + ex);
            onUserAgentReady?.Invoke(null);
        }
    }
}


[System.Serializable]
public class MessageData
{
    public string type;
    public string url;
}