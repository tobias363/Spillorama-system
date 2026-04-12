using System;
using System.Collections;
using System.Collections.Generic;
using BestHTTP.SocketIO;
using TMPro;
using UnityEngine;

public class SplashScreenPanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    #endregion

    #region PRIVATE_VARIABLES
    [SerializeField] private TextMeshProUGUI txtVersion, txtVersion2;
    #endregion

    #region UNITY_CALLBACKS
    private void Awake()
    {
        if (txtVersion)
        {
            txtVersion.text = txtVersion2.text = Utility.Instance.GetApplicationVersionWithOS();
            txtVersion.transform.parent.transform.gameObject.SetActive(true);
        }
    }

    public void UpdateVersionText()
    {
        if (txtVersion)
        {
            txtVersion.text = txtVersion2.text = Utility.Instance.GetApplicationVersionWithOS();
            txtVersion.transform.parent.transform.gameObject.SetActive(true);
        }
    }

    private void Start()
    {
        StartCoroutine(WaitForSocketConnection());
    }

    private void OnEnable()
    {
        //GameSocketManager.OnSocketConnectionConnected += OpenLoginPanel;
    }
    private void OnDisable()
    {
        //GameSocketManager.OnSocketConnectionConnected -= OpenLoginPanel;
    }


    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    #endregion

    #region PRIVATE_METHODS
    IEnumerator WaitForSocketConnection()
    {
        float splashScreenViewTime = 3;
        float intervalTime = 0.1f;
        Debug.Log($"[Recovery] Splash wait started. isGameWebGL={UIManager.Instance.isGameWebGL}");

        // Phase 1: In host mode the shell handles auth via JWT (ReceiveShellToken).
        // The AIS socket is still used for game events but must not block Unity startup —
        // cap the wait so the shell can deliver its JWT even if AIS is slow.
        // Non-host mode keeps the original unlimited wait.
        float maxWaitSec = UIManager.Instance.isGameWebGL ? 10f : float.MaxValue;
        float waitedSec = 0f;

        while (!GameSocketManager.SocketConnected && waitedSec < maxWaitSec)
        {
            splashScreenViewTime -= intervalTime;
            waitedSec += intervalTime;
            yield return new WaitForSeconds(intervalTime);
        }

        if (!GameSocketManager.SocketConnected)
            Debug.Log("[HostMode] AIS socket not yet connected — proceeding with JWT auth path");

        Debug.Log($"[Recovery] Socket connected={GameSocketManager.SocketConnected}. Remaining splash delay={splashScreenViewTime:0.00}");

        if (splashScreenViewTime > 0)
            yield return new WaitForSeconds(splashScreenViewTime);

#if UNITY_WEBGL// || UNITY_EDITOR
        if (UIManager.Instance.isGameWebGL)
        {
            // ── Host-driven mode ──────────────────────────────────────────
            // Web shell handles all login UI. Unity never shows its own login panel.
            // Signal to JS that we're ready; JS sends JWT via ReceiveShellToken.
            Debug.Log("[HostMode] Splash -> requesting shell JWT");
            this.Close();
            UIManager.Instance.SignalHostReady();
            // Also ask JS directly (in case OnUnityReady already fired)
            Application.ExternalCall("ProvideShellCredentials");
        }
        else
        {
            Debug.Log("[Recovery] Splash -> BingoHallDisplayPanel.Open() for non-game WebGL scene");
            this.Close();
            UIManager.Instance.bingoHallDisplayPanel.Open();
        }
#else
        Debug.Log("[Recovery] Splash -> OpenLoginPanel() for non-WebGL");
        OpenLoginPanel();
#endif
    }

    public HallData data;

    private void OpenLoginPanel()
    {
        UIManager.Instance.gameAssetData.playerCredentials = Utility.Instance.LoadPlayerCredentials();
        Debug.Log($"[Recovery] OpenLoginPanel. remember={UIManager.Instance.gameAssetData.playerCredentials.isRemember}, user='{UIManager.Instance.gameAssetData.playerCredentials.emailUsername}', hallId='{UIManager.Instance.gameAssetData.playerCredentials.hallId}'");
        if (UIManager.Instance.gameAssetData.playerCredentials.isRemember)
        {
            Debug.Log("[Recovery] Auto-login from remembered credentials");
            EventManager.Instance.Login(true, UIManager.Instance.gameAssetData.playerCredentials.emailUsername, UIManager.Instance.gameAssetData.playerCredentials.password, LoginDataProcress);
        }
        else
        {
            Debug.Log("[Recovery] No remembered credentials. Opening login panel directly");
            this.Close();
            UIManager.Instance.loginPanel.Open();
        }

        //this.Close();
        //UIManager.Instance.loginPanel.Open();
    }

    private void LoginDataProcress(Socket socket, Packet packet, object[] args)
    {
        Debug.Log($"Login Response: {packet}");
        UIManager.Instance.DisplayLoader(false);
        EventResponse response = JsonUtility.FromJson<EventResponse>(Utility.Instance.GetPacketString(packet));
        //EventResponse<LoginRegisterResponse> response = JsonUtility.FromJson<EventResponse<LoginRegisterResponse>>(Utility.Instance.GetPacketString(packet));

        if (response.status == "success")
        {
            Debug.Log("[Recovery] Splash auto-login succeeded");
            UIManager.Instance.loginPanel.LoginTestProcress(socket, packet, args);
            //UIManager.Instance.loginPanel.LoginDataHandler(response);
        }
        else
        {
            Debug.Log($"[Recovery] Splash auto-login failed with status='{response.status}' message='{response.message}'. Opening login panel");
            UIManager.Instance.loginPanel.Open();
        }
        this.Close();
    }
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    #endregion
}
