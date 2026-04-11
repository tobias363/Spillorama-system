using I2.Loc;
using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.Events;
using UnityEngine.UI;

public class TopBarPanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    public bool isButtonTap = false;
    [Header("Panel")]
    [SerializeField] public MiniGamePlanPanel miniGamePlanPanel;
    [SerializeField] public HallGameListPanel hallGameListPanel;
    #endregion

    #region PRIVATE_VARIABLES
    [Header("Text")]
    [SerializeField] private TextMeshProUGUI txtGameType;
    [SerializeField] private TextMeshProUGUI txtChips;
    [SerializeField] private TextMeshProUGUI txtCurrency;
    [SerializeField] private TextMeshProUGUI txtTodaysBalance;
    public TextMeshProUGUI txtcurrentHallName;

    [Header("Button")]
    [SerializeField] private Button btnVoucher;
    [SerializeField] private Button btnRunningGame;
    [SerializeField] internal Button btnMiniGamePlan;
    [SerializeField] private Button btnGameListOfHall;
    [SerializeField] private Button btnProfile;
    [SerializeField] private Button btnDeposit;
    public Button btnBingo;
    public Button btnSwitchHall;
    public TMP_Dropdown dropdownSwitchHall;
    public List<ApprovedHalls> ApprovedHalls = new List<ApprovedHalls>();
    // HallData currentHall;
    public ApprovedHalls currentHall;
    #endregion

    #region UNITY_CALLBACKS
    private void Awake()
    {
        GameType = "";
        MiniGamePlanButtonEnable = false;
        btnRunningGame.Close();
        //if (Screen.safeArea.x > 0f)
        //    StartCoroutine(Set_Borders());
    }

    private void OnEnable()
    {
        if (Utility.Instance.IsStandAloneVersion())
            StandaloneBuildValidation();
        RefreshUniqueIdComponents();
    }

    private void OnDisable()
    {
        UIManager.Instance.CloseAllPanels();
        miniGamePlanPanel.Close();
    }
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void SetSwitchHallDropdown(List<ApprovedHalls> approvedHalls)
    {
        ApprovedHalls.Clear();
        ApprovedHalls = approvedHalls;
        dropdownSwitchHall.ClearOptions();
        List<string> options = new List<string>();
        foreach (ApprovedHalls hall in ApprovedHalls)
        {
            options.Add($"{hall.hallName} ({hall.totalLimitAvailable} kr)");
        }
        dropdownSwitchHall.AddOptions(options);
        currentHall = ApprovedHalls.Find(hall => hall.hallId == UIManager.Instance.Player_Hall_ID);
        for (int i = 0; i < ApprovedHalls.Count; i++)
        {
            if (ApprovedHalls[i].isSelected)
            {
                dropdownSwitchHall.value = i;
                currentHall = ApprovedHalls[i];
                //Debug.Log("check check " + currentHall.hallName + " \n " + currentHall.totalLimitAvailable + "kr");
                dropdownSwitchHall.captionText.text = currentHall.hallName + " \n " + currentHall.totalLimitAvailable + "kr";
                txtcurrentHallName.text = currentHall.hallName + " \n (" + currentHall.totalLimitAvailable + "kr)";
                break;
            }
        }
        if (currentHall == null)
        {
            currentHall = ApprovedHalls[0];
            dropdownSwitchHall.value = 0;
        }
    }

    public void OnSwitchHallDropdownValueChanged(int index)
    {
        Debug.Log($"OnSwitchHallDropdownValueChanged: {index}");
        currentHall = ApprovedHalls[index];
        if (currentHall.isSelected)
        {

            dropdownSwitchHall.captionText.text = currentHall.hallName + " \n " + currentHall.totalLimitAvailable + "kr";
            txtcurrentHallName.text = currentHall.hallName + " \n (" + currentHall.totalLimitAvailable + "kr)";
            return;
        }
        if (currentHall != null)
        {
            Debug.Log($"Selected Hall: {currentHall.hallName}");
            dropdownSwitchHall.captionText.text = $"{currentHall.hallName} \n ({currentHall.totalLimitAvailable} kr)";
            txtcurrentHallName.text = currentHall.hallName + " \n (" + currentHall.totalLimitAvailable + "kr)";
            EventManager.Instance.SwitchHall(currentHall.hallId, (socket, packet, args) =>
            {
                Debug.Log($"SwitchHall Response: {packet}");
                EventResponse<SwitchHallResponse> response = JsonUtility.FromJson<EventResponse<SwitchHallResponse>>(Utility.Instance.GetPacketString(packet));
                if (response.status == Constants.EventStatus.SUCCESS)
                {
                    CallPlayerHallLimitEvent();
                    UIManager.Instance.gameAssetData.PlayerId = response.result.playerId;
                    UIManager.Instance.Player_Hall_ID = response.result.hall;
                    UIManager.Instance.Player_Hall_Name = response.result.hallName;
                    UIManager.Instance.gameAssetData.RealMoney = response.result.realMoney.ToString();
                    // UIManager.Instance.loginPanel.selectedHall = hallData;
                    OnGamesButtonTap();
                }
                else
                {
                    UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
                }
            });
        }
        else
        {
            Debug.LogError("Selected Hall not found");
        }
    }

    void CallPlayerHallLimitEvent()
    {
        EventManager.Instance.PlayerHallLimit((socket, packet, args) =>
        {
            Debug.Log("PlayerHallLimit: " + packet.ToString());
            EventResponse<PlayerApprovedHallsResponse> response = JsonUtility.FromJson<EventResponse<PlayerApprovedHallsResponse>>(Utility.Instance.GetPacketString(packet));
            if (response.status == Constants.EventStatus.SUCCESS)
            {
                UIManager.Instance.topBarPanel.SetSwitchHallDropdown(response.result.approvedHalls);
            }
            else
            {
                Debug.Log("PlayerHallLimit: " + response.message);
                UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
            }
        });
    }

    public void OnBingoBtnTap()
    {
        isButtonTap = true;
        EventManager.Instance.StopGameByPlayers((socket, packet, args) =>
        {
            Debug.Log($"StopGameByPlayers Response: {packet}");
            EventResponse response = JsonUtility.FromJson<EventResponse>(Utility.Instance.GetPacketString(packet));
            if (response.status.Equals("success"))
            {
                isButtonTap = false;
                // SoundManager.Instance.BingoSound();
                UIManager.Instance.messagePopup.DisplayMessagePopupAutoHide(response.message, true);
            }
            else
            {
                UIManager.Instance.messagePopup.DisplayMessagePopupAutoHide(response.message, true);
            }
        });
    }
    public void OnWalletButtonTap()
    {
        //if (AskUserToRunGameInBackgroundNotificationValidation())
        //{
        //    AskForBackgroundGameMode((boolAction) =>
        //    {
        //        UIManager.Instance.lobbyPanel.OpenWalletPanel();
        //    });
        //}
        if (UIManager.Instance.splitScreenGameManager.SplitScreenRunningGameCount() > 0)
        {
            RunningGamesButtonEnable = true;
            UIManager.Instance.lobbyPanel.OpenWalletPanel();
            UIManager.Instance.game4Panel.Close();
            UIManager.Instance.game5Panel.Close();
        }
        else
        {
            OnWebpagClose();
            UIManager.Instance.CloseAllPanels();
            UIManager.Instance.lobbyPanel.OpenWalletPanel();
        }


    }

    public void OnAddMoneyButtonTap()
    {
        OnWalletButtonTap();
        UIManager.Instance.lobbyPanel.walletPanel.depositMoney.Open();
    }

    public void OnVoucherButtonTap()
    {
        //if (AskUserToRunGameInBackgroundNotificationValidation())
        //{
        //    AskForBackgroundGameMode((boolAction) =>
        //    {
        //        UIManager.Instance.lobbyPanel.OpenVoucherPanel();
        //    });
        //}
        if (UIManager.Instance.splitScreenGameManager.SplitScreenRunningGameCount() > 0)
        {
            RunningGamesButtonEnable = true;
            UIManager.Instance.lobbyPanel.OpenVoucherPanel();
            UIManager.Instance.game4Panel.Close();
            UIManager.Instance.game5Panel.Close();
        }
        else
        {
            UIManager.Instance.CloseAllPanels();
            UIManager.Instance.lobbyPanel.OpenVoucherPanel();
        }
    }

    public void OnLeaderBoardButtonTap()
    {
        //if (AskUserToRunGameInBackgroundNotificationValidation())
        //{
        //    AskForBackgroundGameMode((boolAction) =>
        //    {
        //        UIManager.Instance.lobbyPanel.OpenLeaderboardPanel();
        //    });
        //}
        if (UIManager.Instance.splitScreenGameManager.SplitScreenRunningGameCount() > 0)
        {
            RunningGamesButtonEnable = true;
            UIManager.Instance.lobbyPanel.OpenLeaderboardPanel();
            UIManager.Instance.game4Panel.Close();
            UIManager.Instance.game5Panel.Close();
        }
        else
        {
            UIManager.Instance.CloseAllPanels();
            UIManager.Instance.lobbyPanel.OpenLeaderboardPanel();
        }
    }

    public void OnWebpagClose()
    {
        UIManager.Instance.webViewManager.DestoryWebs();
        OnGamesButtonTap();
    }
    public void OnGamesButtonTap()
    {
        Debug.Log("OnGamesButtonTap");
        //if (AskUserToRunGameInBackgroundNotificationValidation())
        //{
        //    AskForBackgroundGameMode((boolAction)=> {
        //        UIManager.Instance.lobbyPanel.OpenGameSelectionPanel();
        //    });
        //}


        // if (Time.timeScale == 0)
        // {
        //     Time.timeScale = 1;
        // }

        btnMiniGamePlan.gameObject.SetActive(false);
        if (UIManager.Instance.splitScreenGameManager.SplitScreenRunningGameCount() > 0)
        {
            Debug.Log("IF");
            RunningGamesButtonEnable = true;
            UIManager.Instance.lobbyPanel.OpenGameSelectionPanel();
            UIManager.Instance.game4Panel.Close();
            UIManager.Instance.game5Panel.Close();
            //Debug.Log("1");
        }
        else
        {
            Debug.Log("ELSE");
            UIManager.Instance.CloseAllPanels();
            UIManager.Instance.lobbyPanel.OpenGameSelectionPanel();
        }
    }

    public void OpenGameSelectionPanel()
    {
        UIManager.Instance.CloseAllPanels();
        UIManager.Instance.lobbyPanel.OpenGameSelectionPanel();
    }

    public void OnRunningGamesButtonTap()
    {
        UIManager.Instance.CloseAllPanels();
        RunningGamesButtonEnable = false;
    }

    public void OnPurchaseTicketGame1ButtonTap()
    {

    }

    public void OnNotificationButtonTap()
    {
        UIManager.Instance.CloseAllSubPanels();
        UIManager.Instance.CloseAllGameElements();

        // Store and close active game panel
        StoreAndCloseActiveGamePanel();

        if (!UIManager.Instance.notificationPanel.isActiveAndEnabled)
        {
            UIManager.Instance.notificationPanel.Open();
        }
    }

    public void OnProfileButtonTap()
    {
        UIManager.Instance.CloseAllSubPanels();
        UIManager.Instance.CloseAllGameElements();

        // Store and close active game panel
        StoreAndCloseActiveGamePanel();

        if (!UIManager.Instance.profilePanel.isActiveAndEnabled)
        {
            UIManager.Instance.profilePanel.Open();
        }
    }

    public void OnSettingButtonTap()
    {
        UIManager.Instance.CloseAllSubPanels();
        UIManager.Instance.CloseAllGameElements();

        // Store and close active game panel
        StoreAndCloseActiveGamePanel();

        if (!UIManager.Instance.settingPanel.isActiveAndEnabled)
        {
            UIManager.Instance.settingPanel.setDataOpen();
            UIManager.Instance.settingPanel.RefreshScrollView();
        }
    }

    public void OnMiniGamePlanPanelButtonTap()
    {
        if (UIManager.Instance.game1Panel.isActiveAndEnabled)
            hallGameListPanel.OpenHallGameList();
        else
            miniGamePlanPanel.OpenPanel();
    }

    public void OnHallGameListPanelButtonTap()
    {
        hallGameListPanel.OpenHallGameList();
    }
    #endregion

    #region PRIVATE_METHODS

    private void StoreAndCloseActiveGamePanel()
    {
        // Check which game panel is active and store it
        if (UIManager.Instance.game1Panel.isActiveAndEnabled)
        {
            UIManager.Instance.previouslyActiveGamePanel = UIManager.Instance.game1Panel;
            UIManager.Instance.game1Panel.Close();
        }
        else if (UIManager.Instance.game2Panel.isActiveAndEnabled)
        {
            UIManager.Instance.previouslyActiveGamePanel = UIManager.Instance.game2Panel;
            UIManager.Instance.game2Panel.Close();
        }
        else if (UIManager.Instance.game3Panel.isActiveAndEnabled)
        {
            UIManager.Instance.previouslyActiveGamePanel = UIManager.Instance.game3Panel;
            UIManager.Instance.game3Panel.Close();
        }
        else if (UIManager.Instance.game4Panel.isActiveAndEnabled)
        {
            UIManager.Instance.previouslyActiveGamePanel = UIManager.Instance.game4Panel;
            UIManager.Instance.previouslyActiveGame4Theme1 = UIManager.Instance.isGame4Theme1;
            UIManager.Instance.previouslyActiveGame4Theme2 = UIManager.Instance.isGame4Theme2;
            UIManager.Instance.previouslyActiveGame4Theme3 = UIManager.Instance.isGame4Theme3;
            UIManager.Instance.previouslyActiveGame4Theme4 = UIManager.Instance.isGame4Theme4;
            UIManager.Instance.previouslyActiveGame4Theme5 = UIManager.Instance.isGame4Theme5;
            UIManager.Instance.game4Panel.Close();
        }
        else if (UIManager.Instance.game5Panel.isActiveAndEnabled)
        {
            UIManager.Instance.previouslyActiveGamePanel = UIManager.Instance.game5Panel;
            UIManager.Instance.game5Panel.Close();
        }
        else
        {
            // No game panel was active
            UIManager.Instance.previouslyActiveGamePanel = null;
        }
    }

    private void AskForBackgroundGameMode(UnityAction<bool> action)
    {
        if (UIManager.Instance.multipleGameScreenManager.AllowGamesRunInBackground)
        {
            UIManager.Instance.CloseAllPanels();
            RunningGamesButtonEnable = true;
            action.Invoke(true);
            return;
        }
#if UNITY_WEBGL
        if (UIManager.Instance.isGameWebGL)
        {
            UIManager.Instance.messagePopup.DisplayConfirmationPopup(LocalizationManager.GetTermTranslation("Would you like to run games in background?"),
            LocalizationManager.GetTermTranslation("Yes"),
            LocalizationManager.GetTermTranslation("No"), () =>
            {
                UIManager.Instance.CloseAllPanels();
                RunningGamesButtonEnable = true;
                UIManager.Instance.multipleGameScreenManager.AllowGamesRunInBackground = true;
                action.Invoke(true);
            }, () =>
            {
                RunningGamesButtonEnable = false;
                UIManager.Instance.CloseAllPanels();
                UIManager.Instance.multipleGameScreenManager.ClosePanel();
                action.Invoke(false);
            });
        }
        else
        {
            UIManager.Instance.messagePopup.DisplayConfirmationPopup("Would you like to run games in background?",
            "Yes",
            "No", () =>
            {
                UIManager.Instance.CloseAllPanels();
                RunningGamesButtonEnable = true;
                UIManager.Instance.multipleGameScreenManager.AllowGamesRunInBackground = true;
                action.Invoke(true);
            }, () =>
            {
                RunningGamesButtonEnable = false;
                UIManager.Instance.CloseAllPanels();
                UIManager.Instance.multipleGameScreenManager.ClosePanel();
                action.Invoke(false);
            });
        }

#else
        UIManager.Instance.messagePopup.DisplayConfirmationPopup(LocalizationManager.GetTermTranslation("Would you like to run games in background?"),
            LocalizationManager.GetTermTranslation("Yes"),
            LocalizationManager.GetTermTranslation("No"), () =>
            {
                UIManager.Instance.CloseAllPanels();
                RunningGamesButtonEnable = true;
                UIManager.Instance.multipleGameScreenManager.AllowGamesRunInBackground = true;
                action.Invoke(true);
            }, () =>
            {
                RunningGamesButtonEnable = false;
                UIManager.Instance.CloseAllPanels();
                UIManager.Instance.multipleGameScreenManager.ClosePanel();
                action.Invoke(false);
            });
#endif
    }

    private void StandaloneBuildValidation()
    {
        bool isUniqueIdPlayer = UIManager.Instance.gameAssetData.IsUniqueIdPlayer;
        //btnVoucher.gameObject.SetActive(!isUniqueIdPlayer);
        txtTodaysBalance.transform.parent.gameObject.SetActive(isUniqueIdPlayer);
        txtCurrency.transform.parent.gameObject.SetActive(!isUniqueIdPlayer);
        RunningGamesButtonEnable = false;
    }

    private bool AskUserToRunGameInBackgroundNotificationValidation()
    {
        if (UIManager.Instance.multipleGameScreenManager.AllowGamesRunInBackground)
            return true;
        else if (Utility.Instance.IsStandAloneVersion() && UIManager.Instance.multipleGameScreenManager.AnyGameActive() && !UIManager.Instance.lobbyPanel.isActiveAndEnabled &&
            !UIManager.Instance.multipleGameScreenManager.IsBuyOrSelectGamePanelActive() && Utility.Instance.IsMultipleScreenSupported)
            return true;
        else
            return false;
    }

    private void RefreshUniqueIdComponents()
    {
        btnProfile.gameObject.SetActive(!UIManager.Instance.gameAssetData.IsUniqueIdPlayer);
        btnDeposit.gameObject.SetActive(!UIManager.Instance.gameAssetData.IsUniqueIdPlayer);
    }
    #endregion

    #region COROUTINES

    IEnumerator Set_Borders()
    {
        Transform parent = UIManager.Instance.Left_Safe_Area_Border.parent;
        UIManager.Instance.Left_Safe_Area_Border.transform.SetParent(transform.GetChild(0));
        UIManager.Instance.Right_Safe_Area_Border.transform.SetParent(transform.GetChild(0));
        UIManager.Instance.Left_Safe_Area_Border.anchoredPosition = new Vector2(0f, UIManager.Instance.Left_Safe_Area_Border.anchoredPosition.y);
        UIManager.Instance.Right_Safe_Area_Border.anchoredPosition = new Vector2(0f, UIManager.Instance.Right_Safe_Area_Border.anchoredPosition.y);
        yield return new WaitForEndOfFrame();
        UIManager.Instance.Left_Safe_Area_Border.transform.SetParent(parent);
        UIManager.Instance.Right_Safe_Area_Border.transform.SetParent(parent);
    }

    #endregion

    #region GETTER_SETTER
    public string GameType
    {
        set
        {
            if (txtGameType == null || txtGameType.transform == null || txtGameType.transform.parent == null || txtGameType.transform.parent.parent == null)
            {
                Debug.LogWarning("TopBarPanel.GameType skipped because txtGameType hierarchy is not assigned.");
                return;
            }

            if (value == "")
            {
                txtGameType.transform.parent.parent.gameObject.SetActive(false);
                return;
            }

            if (Utility.Instance.IsStandAloneVersion())
                return;

            txtGameType.transform.parent.parent.gameObject.SetActive(true);
            txtGameType.text = value.ToUpper();
        }
    }

    public string Points
    {
        set
        {
            txtChips.text = value.ToString();
        }
    }

    public string RealMoney
    {
        set
        {
            txtCurrency.text = value.ToString() + " kr";
        }
    }

    public string TodaysBalance
    {
        set
        {
            txtTodaysBalance.text = value.ToString() + " kr";
        }
    }

    public bool RunningGamesButtonEnable
    {
        set
        {
            //if(Utility.Instance.IsStandAloneVersion() && UIManager.Instance.multipleGameScreenManager.isActiveAndEnabled)
            if (Utility.Instance.IsStandAloneVersion() && UIManager.Instance.splitScreenGameManager.isActiveAndEnabled)
            {
                Debug.Log("RunningGamesButtonEnable: " + value);
                btnRunningGame.gameObject.SetActive(value);
            }
            else
            {
                btnRunningGame.Close();
            }
        }
        get
        {
            return btnRunningGame.isActiveAndEnabled;
        }
    }

    public bool MiniGamePlanButtonEnable
    {
        set
        {
            if (Utility.Instance.IsStandAloneVersion())
                return;

            btnMiniGamePlan.gameObject.SetActive(value);

            if (value == false)
                miniGamePlanPanel.Close();
        }
    }

    public bool HallGameListButton
    {
        set
        {
            //if (Utility.Instance.IsStandAloneVersion())
            //    return;

            btnGameListOfHall.gameObject.SetActive(value);

            if (value == false)
                hallGameListPanel.Close();
        }
    }
    #endregion
}
