using System;
using System.Collections;
using BestHTTP.SocketIO;
using UnityEngine;
using TMPro;

public class LobbyPanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES    
    public LobbyGameSelection lobbyGameSelection;
    public GamePlanPanel gamePlanPanel;
    public WalletPanel walletPanel;
    public VoucherPanel voucherPanel;
    public LeaderboardPanel leaderboardPanel;
    #endregion

    #region PRIVATE_VARIABLES
    #endregion

    #region UNITY_CALLBACKS
    private void OnEnable()
    {
        // In WebGL host mode with a pending game, don't show the top bar —
        // the web shell handles all chrome, Unity only renders the game.
        if (UIManager.Instance.isGameWebGL && !string.IsNullOrEmpty(UIManager.Instance.pendingHostGameNumber))
        {
            Debug.Log("[HostMode] LobbyPanel.OnEnable: pending game exists, skipping top bar");
        }
        else
        {
            UIManager.Instance.topBarPanel.Open();
        }

        Get_Game_1_Lucky_Number();

        if (UIManager.Instance.isGameWebGL)
        {
            OpenHostShellLobbyState();

            // Phase 2: join the Spillorama room for this hall once the socket is up
            JoinSpilloramaRoom();
        }
    }

    void Start()
    {
        GameSocketManager.SetSocketGame1Namespace = "Game1";
        GameSocketManager.SetSocketGame2Namespace = "Game2";
        GameSocketManager.SetSocketGame3Namespace = "Game3";
    }

    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS    

    public void OpenHostShellLobbyState()
    {
        if (!this.isActiveAndEnabled)
            this.Open();

        CloseAllPanels();
    }

    void Get_Game_1_Lucky_Number()
    {
        EventManager.Instance.Get_Auto_Lucky_Number_For_Game_1((Socket socket, Packet packet, object[] args) =>
        {
            print($"GetLuckyNumber response : {packet.ToString()}");

            EventResponse<GetLuckyNumber> response = JsonUtility.FromJson<EventResponse<GetLuckyNumber>>(Utility.Instance.GetPacketString(packet));

            if (response.status.ToLower() == "success")
            {
                UIManager.Instance.settingPanel.Set_Game_1_Lucky_Number_Selection_UI(response.result.luckyNumber, response.result.isLuckyNumberEnabled);
            }
            else
            {
                print($"GetLuckyNumber message : {response.message}");
            }

        });
    }

    public void OpenGameSelectionPanel()
    {
        if (UIManager.Instance.isGameWebGL)
        {
            OpenHostShellLobbyState();
            return;
        }

        print($"Open Game Selection UI");
        if (!this.isActiveAndEnabled)
            this.Open();

        CloseAllPanels();
        print($"Is Game Selection Lobby set : {lobbyGameSelection != null}");

        lobbyGameSelection.Open();
    }

    public void OpenGamePlanPanel()
    {
        if (!this.isActiveAndEnabled)
            this.Open();

        CloseAllPanels();
        gamePlanPanel.Open();
        gamePlanPanel.RefreshGamePlanList();
    }

    public void OpenWalletPanel()
    {
        if (!this.isActiveAndEnabled)
            this.Open();

        CloseAllPanels();
        walletPanel.Open();
    }

    public void OpenVoucherPanel()
    {
        if (!this.isActiveAndEnabled)
            this.Open();

        // UIManager.Instance.DisplayLoader(true);
        EventManager.Instance.VoucherList(VoucherListHandling);
    }

    public void OpenLeaderboardPanel()
    {
        if (!this.isActiveAndEnabled)
            this.Open();

        CloseAllPanels();
        leaderboardPanel.Open();
    }
    #endregion

    #region PRIVATE_METHODS

    // Phase 2: join Spillorama room for the current hall.
    // Waits for SpilloramaSocketManager to be connected before emitting.
    private void JoinSpilloramaRoom()
    {
        if (SpilloramaSocketManager.Instance == null) return;
        StartCoroutine(WaitAndJoinRoom());
    }

    private IEnumerator WaitAndJoinRoom()
    {
        float waited = 0f;
        while (!SpilloramaSocketManager.IsConnected && waited < 15f)
        {
            waited += 0.2f;
            yield return new WaitForSeconds(0.2f);
        }

        if (!SpilloramaSocketManager.IsConnected)
        {
            Debug.LogWarning("[LobbyPanel] SpilloramaSocket not connected after 15s — skipping JoinRoom");
            yield break;
        }

        string hallId = UIManager.Instance.Player_Hall_ID ?? "";
        SpilloramaSocketManager.Instance.JoinRoom(hallId, err =>
        {
            Debug.LogWarning($"[LobbyPanel] JoinRoom failed: {err}");
        });
    }

    private void VoucherListHandling(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("VoucherList response: " + packet.ToString());
        UIManager.Instance.DisplayLoader(false);
        EventResponseList<VoucherData> voucherData = JsonUtility.FromJson<EventResponseList<VoucherData>>(Utility.Instance.GetPacketString(packet));

        if (voucherData.status == Constants.EventStatus.SUCCESS)
        {
            CloseAllPanels();
            voucherPanel.Open(voucherData.result);
        }
        else
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(voucherData.message);
        }
    }

    private void CloseAllPanels()
    {
        lobbyGameSelection.Close();
        gamePlanPanel.Close();
        walletPanel.Close();
        voucherPanel.Close();
        leaderboardPanel.Close();
    }
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    #endregion
}
