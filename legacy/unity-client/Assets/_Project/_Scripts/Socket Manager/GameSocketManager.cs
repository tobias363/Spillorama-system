using System;
using System.Collections;
using System.Globalization;
using BestHTTP.SocketIO;
using PlatformSupport.Collections.ObjectModel;
using UnityEngine;

public class GameSocketManager : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    public Constants.SERVER server;

    public static GameSocketManager Instance = null;
    public static SocketManager socketManager = null;

    public static EmptyDelegateEvent OnSocketReconnected;
    public static EmptyDelegateEvent SocketConnectionInitialization;
    #endregion

    #region PRIVATE_VARIABLES
    private static Socket _socketGame1;
    private static Socket _socketGame2;
    private static Socket _socketGame3;
    private static Socket _socketGame4;
    private static Socket _socketGame5;

    private static string SOCKET_EVENT_CONNECT = "connect";
    private static string SOCKET_EVENT_RECONNECT = "reconnect";
    private static string SOCKET_EVENT_RECONNECTING = "reconnecting";
    private static string SOCKET_EVENT_RECONNECT_ATTEMPT = "reconnect_attempt";
    private static string SOCKET_EVENT_RECONNECT_FAILED = "reconnect_failed";
    private static string SOCKET_EVENT_DISCONNECT = "disconnect";
    private static string SOCKET_EVENT_AUTH_ERROR = "authError";

    private static bool _socketConnected = false;
    private static int _reconnectAttemptCount = 0;

    [Header("Server URL's")]
    public string NGRockUrl = "https://unuseable-branden-disgustedly.ngrok-free.dev";

    public string Token = "";
    private static bool isRefreshAuthToken = false;
    #endregion

    #region UNITY_CALLBACKS

    private void Awake()
    {
        Constants.ServerDetails.NGRockUrl = NGRockUrl;

        if (Instance == null)
        {
            Instance = this;
        }
        else if (Instance != null)
        {
            Destroy(gameObject);
            return;
        }

        if (server == Constants.SERVER.DynamicWebgl)
            Application.ExternalCall("requestDomainData");
        else
        {
            Debug.Log("ConnectToSocket");
            ConnectToSocket();
        }
    }

    private void OnDisable()
    {
        socketManager.CloseSafely();
    }

    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS

    public void DomainDataCall(string socketServerUrl)
    {
        PlayerPrefs.SetString("DYNAMIC_WEBGL_URL", socketServerUrl);
        ConnectToSocket();
    }

    public static void ConnectToSocket(string token = "")
    {
        Debug.Log("ConnectToSocket : " + token);
        Debug.Log("ConnectToSocket URL : " + Constants.ServerDetails.BaseUrl);

        SocketOptions options = new SocketOptions();
        options.ReconnectionAttempts = 600;
        options.ReconnectionDelayMax = TimeSpan.FromSeconds(1);
        options.AutoConnect = true;
        //options.ReconnectionDelay = TimeSpan.FromSeconds(60);
        options.ReconnectionDelay = TimeSpan.FromMilliseconds(100);
        options.Timeout = TimeSpan.FromSeconds(10);
        options.Reconnection = true;
        options.ConnectWith = BestHTTP.SocketIO.Transports.TransportTypes.WebSocket;

        ///Debug.Log("Base URL: " + Constants.ServerDetails.BaseUrl);
#if UNITY_EDITOR
        //Debug.Log("Token: " + token);
#endif
        Instance.Token = token;
        ObservableDictionary<string, string> param = new ObservableDictionary<string, string>();
        param.Add("authToken", token);
        options.AdditionalQueryParams = param;

        BestHTTP.HTTPManager.Setup();
        socketManager = new SocketManager(new Uri(Constants.ServerDetails.BaseUrl + "/socket.io/"), options);
        BestHTTP.HTTPManager.Setup();

        socketManager.Socket.On(SOCKET_EVENT_CONNECT, OnConnect);
        socketManager.Socket.On(SOCKET_EVENT_RECONNECT, OnReConnect);
        socketManager.Socket.On(SOCKET_EVENT_RECONNECTING, OnReConnecting);
        socketManager.Socket.On(SOCKET_EVENT_RECONNECT_ATTEMPT, OnReConnectAttempt);
        socketManager.Socket.On(SOCKET_EVENT_RECONNECT_FAILED, OnReConnectFailed);
        socketManager.Socket.On(SOCKET_EVENT_DISCONNECT, OnDisconnect);
        socketManager.Socket.On(SOCKET_EVENT_AUTH_ERROR, OnAuthError);

        // if (token != "")
        // {
        //     if (UIManager.Instance.gameAssetData.IsLoggedIn)
        //         EventManager.Instance.ReconnectPlayer(ReconnectPlayerResponse);
        // }
    }

    public void CloseConnection()
    {
        CleanUpSocket();
        if (socketManager != null && socketManager.Socket != null)
        {
            socketManager.Close();
            socketManager = null;
        }
        //Invoke(nameof(SocketManager), 1f);
    }

    private void CleanUpSocket()
    {
        if (socketManager != null && socketManager.Socket != null)
        {
            socketManager.Socket.Off(SOCKET_EVENT_CONNECT, OnConnect);
            socketManager.Socket.Off(SOCKET_EVENT_RECONNECT, OnReConnect);
            socketManager.Socket.Off(SOCKET_EVENT_RECONNECTING, OnReConnecting);
            socketManager.Socket.Off(SOCKET_EVENT_RECONNECT_ATTEMPT, OnReConnectAttempt);
            socketManager.Socket.Off(SOCKET_EVENT_RECONNECT_FAILED, OnReConnectFailed);
            socketManager.Socket.Off(SOCKET_EVENT_DISCONNECT, OnDisconnect);
            socketManager.Socket.Off(SOCKET_EVENT_AUTH_ERROR, OnAuthError);
        }
    }
    #endregion

    #region PRIVATE_METHODS
    private static void OnAuthError(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnAuthError" + packet.ToString());
        EventManager.Instance.RefreshAuthToken(UIManager.Instance.gameAssetData.playerGameData.refreshAuthToken, RefreshAuthTokenResponse);
    }

    private static void RefreshAuthTokenResponse(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("RefreshAccessToken Response : " + packet.ToString());
        //#if UNITY_EDITOR
        //#endif
        EventResponse<RefreshAuthTokenResponse> response = JsonUtility.FromJson<EventResponse<RefreshAuthTokenResponse>>(Utility.Instance.GetPacketString(packet));
        if (response.status == Constants.EventStatus.SUCCESS)
        {
            isRefreshAuthToken = true;
            UIManager.Instance.gameAssetData.playerGameData.authToken = response.result.authToken;
            UIManager.Instance.gameAssetData.playerGameData.refreshAuthToken = response.result.refreshAuthToken;
            UIManager.Instance.SyncPlayerTokenToWebHost(response.result.authToken);
            Instance.CloseConnection();
            ConnectToSocket(response.result.authToken);
        }
        else
        {
            UIManager.Instance.settingPanel.OnLogoutButtonTap();
        }
    }

    private static void OnDisconnect(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnDisconnect");

        SocketConnected = false;

        socketManager.Socket.Off(Constants.BroadcastName.updateScreenSaver);
    }

    private static void OnReConnectFailed(Socket socket, Packet packet, object[] args)
    {
        SocketConnected = false;
        Debug.Log("OnReConnectFailed");
        ConnectToSocket();
    }

    private static void OnReConnectAttempt(Socket socket, Packet packet, object[] args)
    {
        SocketConnected = false;
        ReconnectAttemptCount++;
        Debug.Log("OnReConnectAttempt");
    }

    private static void OnReConnecting(Socket socket, Packet packet, object[] args)
    {
        SocketConnected = false;
        Debug.Log("OnReConnecting");
    }

    private static void OnReConnect(Socket socket, Packet packet, object[] args)
    {
        SocketConnected = true;
        ReconnectAttemptCount = 0;
        Debug.Log("OnReConnect");

        if (UIManager.Instance.gameAssetData.IsLoggedIn)
            EventManager.Instance.ReconnectPlayer(ReconnectPlayerResponse);

#if UNITY_WEBGL || UNITY_EDITOR
        if (!UIManager.Instance.isGameWebGL)
        {
            OnSocketReconnected?.Invoke();
        }

#endif
    }

    private static void OnConnect(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnConnect : " + packet.ToString());
        // Set the culture to South Africa
        CultureInfo culture = new CultureInfo("en-US");
        // Set the current culture
        System.Threading.Thread.CurrentThread.CurrentCulture = culture;
        System.Threading.Thread.CurrentThread.CurrentUICulture = culture;
        //Debug.Log("CultureInfo Updated");
        SocketConnected = true;
        ReconnectAttemptCount = 0;
        SocketConnectionInitialization?.Invoke();
        //Debug.Log("OnConnect");
        //Debug.Log("Socket ID: " + socket.Id);
        //Debug.Log("Socket URL: " + socket.Manager.Uri);
        //Debug.Log("socket url: " + socketManager.Uri);

        SetSocketGame1Namespace = "Game1";
        SetSocketGame2Namespace = "Game2";
        SetSocketGame3Namespace = "Game3";
        SetSocketGame4Namespace = "Game4";
        SetSocketGame5Namespace = "Game5";

        //#if !UNITY_WEBGL
        //        if (BackgroundManager.Instance)
        //            BackgroundManager.Instance.GetAllHallList();
        //#endif
        // UIManager.Instance.DisplayLoader(true);
        if (BackgroundManager.Instance)
            BackgroundManager.Instance.GetAllHallList();

        if (ScreenSaverManager.Instance)
            ScreenSaverManager.Instance.GetScreenSaverDetails();

        //if (UIManager.Instance != null)
        //    UIManager.Instance.gameLoginSplashScreenPanel.Login();
        BackgroundManager.Instance.DisableBroadcast();
        BackgroundManager.Instance.EnableBroadcast();
        if (LandingScreenController.Instance)
            LandingScreenController.Instance.DisableBroadcasts();
        if (LandingScreenController.Instance)
            LandingScreenController.Instance.EnableBroadcasts();
        if (isRefreshAuthToken)
        {
            if (UIManager.Instance.gameAssetData.IsLoggedIn)
            {
                EventManager.Instance.ReconnectPlayer(ReconnectPlayerResponse);
            }
            isRefreshAuthToken = false;
        }
        else if (Instance.Token != "")
        {
            if (UIManager.Instance.gameAssetData.IsLoggedIn)
                EventManager.Instance.ReconnectPlayer(ReconnectPlayerResponse);
        }
    }

    private static void ReconnectPlayerResponse(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("ReconnectPlayerResponse:" + packet.ToString());

        EventResponse response = JsonUtility.FromJson<EventResponse>(Utility.Instance.GetPacketString(packet));

        if (response.status == Constants.EventStatus.FAIL)
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(response.message, ForceLogoutHandler);
        }
        else if (response.status == Constants.EventStatus.LOGOUT)
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(response.message, ForceLogoutHandler);
        }
        else
        {
#if UNITY_WEBGL || UNITY_EDITOR
            FCMManager.Instance.UpdateFirebaseToken(UIManager.Instance.gameAssetData.playerGameData.firebaseToken);
#endif
            // UIManager.Instance.DisplayLoader(true);
            EventManager.Instance.GetPlayerDetails(UIManager.Instance.gameAssetData.PlayerId, UIManager.Instance.loginPanel.ProfileDataProcess);
        }

        OnSocketReconnected?.Invoke();
    }

    private static void ForceLogoutHandler()
    {
        UIManager.Instance.ClearPlayerTokenFromWebHost();
        UIManager.Instance.topBarPanel.Close();
        UIManager.Instance.CloseAllPanels();
        UIManager.Instance.loginPanel.Open();
        Utility.Instance.ClearPlayerCredentials();
        UIManager.Instance.gameAssetData.IsLoggedIn = false;
        UIManager.Instance.messagePopup.Close();
    }
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    public static string SetSocketGame1Namespace
    {
        set
        {
            _socketGame1 = socketManager.GetSocket("/" + value);
            //Debug.Log("SetSocketGame1Namespace: " + SocketGame1.Namespace);
        }
    }

    public static string SetSocketGame2Namespace
    {
        set
        {
            _socketGame2 = socketManager.GetSocket("/" + value);
            //Debug.Log("SetSocketGame2Namespace: " + SocketGame2.Namespace);
        }
    }

    public static string SetSocketGame3Namespace
    {
        set
        {
            _socketGame3 = socketManager.GetSocket("/" + value);
            //Debug.Log("SetSocketGame3Namespace: " + SocketGame3.Namespace);
        }
    }

    public static string SetSocketGame4Namespace
    {
        set
        {
            _socketGame4 = socketManager.GetSocket("/" + value);
            //Debug.Log("SetSocketGame4Namespace: " + SocketGame4.Namespace);
        }
    }

    public static string SetSocketGame5Namespace
    {
        set
        {
            _socketGame5 = socketManager.GetSocket("/" + value);
            //Debug.Log("SetSocketGame5Namespace: " + SocketGame5.Namespace);
        }
    }

    public static Socket SocketGame1
    {

        get
        {
            return _socketGame1;
        }
    }

    public static Socket SocketGame2
    {
        get
        {
            return _socketGame2;
        }
    }

    public static Socket SocketGame3
    {
        get
        {
            return _socketGame3;
        }
    }

    public static Socket SocketGame4
    {
        get
        {
            return _socketGame4;
        }
    }

    public static Socket SocketGame5
    {
        get
        {
            return _socketGame5;
        }
    }

    public static bool SocketConnected
    {
        set
        {
            _socketConnected = value;
        }
        get
        {
            return _socketConnected;
        }
    }

    public static int ReconnectAttemptCount
    {
        set
        {
            _reconnectAttemptCount = value;

            if (_reconnectAttemptCount == 0)
                UIManager.Instance.DisplayLoader(false);
            else if (_reconnectAttemptCount >= 4 || (_reconnectAttemptCount > 0 && UIManager.Instance.loaderPanel.isActiveAndEnabled))
                UIManager.Instance.loaderPanel.ShowLoader(Constants.LanguageKey.InternetIssueMessage + "\n" + Constants.LanguageKey.ReconnectWithServerMessage);
        }
        get
        {
            return _reconnectAttemptCount;
        }
    }
    #endregion
}

public delegate void AISDelegateEvent(bool soundEnable);
