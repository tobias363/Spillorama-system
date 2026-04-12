using System.Linq;
using BestHTTP.SocketIO;
using I2.Loc;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class SettingPanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    public string currentVoiceLanguage = "Norwegian Male";
    private const string LanguagePrefKey = "CurrentGameLanguage";
    public soundlanguage CurrentSoundLanguage = soundlanguage.NorwegianMale;
    public int Game_1_Lucky_Number;
    public Toggle Game_1_Lucky_Number_TG;
    public TMP_Text Game_1_Lucky_Number_Txt;

    public Game1LuckyNumberAutoSelectionUI game1LuckyNumberAutoSelectionUI;
    public AvailableBlockPanel AvailableblockGamePopup;
    public ExistingBlockPanel ExistblockGamePopup;

    [Header("TMP_InputField")]
    public TMP_InputField setMonthlyGameLimitInputField;

    #endregion

    #region PRIVATE_VARIABLES

    [Header("Text")]
    [SerializeField] private TextMeshProUGUI txtCurrentLanguage;
    [SerializeField] private TextMeshProUGUI txtCurrentVoiceLanguage;
    [SerializeField] private TextMeshProUGUI txtMonthlyUsageLimit;

    [Header("Toggle")]
    [SerializeField] private Toggle toggleMultipleScreenSupport;
    [SerializeField] private Toggle toggleSoundStatus;
    [SerializeField] private Toggle toggleNotificationStatus;
    [SerializeField] private Toggle toggleVoiceStatus;

    [Header("GameObject")]
    [SerializeField] private GameObject gameObjectBlockMySelf;

    [Header("Localization Params Manager")]
    [SerializeField] private LocalizationParamsManager localizationParamsManagerBlockMySelfDays;

    [Header("ScrollRect")]
    [SerializeField] private ScrollRect scrollRect;
    public SettingResult SettingData;
    private long monthlyUsageLimitValue = 0;

    #endregion

    #region UNITY_CALLBACKS

    private void Awake()
    {


        if (Utility.Instance.IsStandAloneVersion())
        {
            toggleMultipleScreenSupport.transform.parent.gameObject.SetActive(true);
            //toggleMultipleScreenSupport.isOn = Utility.Instance.IsMultipleScreenSupported;
            //toggleMultipleScreenSupport.onValueChanged.AddListener(OnToggleMultipleScreenSupportTap);

            toggleMultipleScreenSupport.isOn = Utility.Instance.IsSplitScreenSupported;
            toggleMultipleScreenSupport.onValueChanged.AddListener(OnToggleSplitScreenSupportTap);
        }
        else
            toggleMultipleScreenSupport.transform.parent.gameObject.SetActive(false);
    }

    private void OnEnable()
    {
        toggleNotificationStatus.isOn = UIManager.Instance.gameAssetData.EnableNotification;
        toggleVoiceStatus.onValueChanged.RemoveAllListeners();
        toggleSoundStatus.onValueChanged.RemoveAllListeners();
        toggleVoiceStatus.isOn = UIManager.Instance.gameAssetData.isVoiceOn == 1;
        toggleSoundStatus.isOn = UIManager.Instance.gameAssetData.isSoundOn == 1;
        toggleVoiceStatus.onValueChanged.AddListener(OnToggleVoiceStatusTap);
        toggleSoundStatus.onValueChanged.AddListener(OnToggleSoundStatusTap);
        BlockingDays = UIManager.Instance.gameAssetData.blockingOptionData.list[UIManager.Instance.gameAssetData.blockingOptionData.index];
        monthlyUsageLimitValue = UIManager.Instance.gameAssetData.monthlyLimitData.monthlyUsageLimit;
        //txtMonthlyUsageLimit.text = monthlyUsageLimitValue.ToString() + " " + Constants.StringClass.currencySymbol;
        setMonthlyGameLimitInputField.text = monthlyUsageLimitValue.ToString() + " " + Constants.StringClass.currencySymbol;
        if (UIManager.Instance.breakTimePopup.isActiveAndEnabled)
        {
            UIManager.Instance.breakTimePopup.Close();
        }
        RefreshCurrentLanguageText();
        RefreshUniqueIdComponents();
    }
    private void OnDisable()
    {
        ResetToTop();
    }

    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void ResetToTop()
    {
        if (scrollRect != null)
        {
            scrollRect.verticalNormalizedPosition = 1f;
        }
    }
    public void setDataOpen()
    {
        ExistblockGamePopup.closeButtonTap();
        setDataOpen_Spillorama();
    }

    private void setDataOpen_Spillorama()
    {
        if (SpilloramaApiClient.Instance == null) return;

        string hallId = UIManager.Instance.Player_Hall_ID ?? "";
        SpilloramaApiClient.Instance.GetCompliance(hallId,
            (SpilloramaComplianceData compliance) =>
            {
                // Map compliance data to monthly limit display
                monthlyUsageLimitValue = (long)compliance.limits.monthlyLossLimit;
                setMonthlyGameLimitInputField.text = monthlyUsageLimitValue.ToString() + " " + Constants.StringClass.currencySymbol;

                this.Open();
            },
            (string code, string message) =>
            {
                Debug.LogWarning($"[SettingPanel] GetCompliance failed: {code} — {message}");
                // Open panel anyway with defaults
                this.Open();
            }
        );
    }
    public void availBlockGames()
    {
        // Spillorama handles blocking via compliance API (voluntary pause / self-exclusion).
        // AIS block-rule UI is no longer used.
        Debug.Log("[SettingPanel] availBlockGames: blocking is handled via Spillorama compliance API");
    }
    public void existBlockGames()
    {
        // Spillorama handles blocking via compliance API (voluntary pause / self-exclusion).
        // AIS ExistingBlockRule UI is no longer used.
        Debug.Log("[SettingPanel] existBlockGames: blocking is handled via Spillorama compliance API");
    }
    public void RefreshScrollView()
    {
        scrollRect.ScrollToTop();
    }

    public void OnToggleMultipleScreenSupportTap(bool isOn)
    {
        bool previousResult = Utility.Instance.IsMultipleScreenSupported;
        Utility.Instance.IsMultipleScreenSupported = isOn;

        if (isOn == false)
        {
            UIManager.Instance.multipleGameScreenManager.AllowGamesRunInBackground = false;
            if (UIManager.Instance.multipleGameScreenManager.AnyGameActive())
                UIManager.Instance.multipleGameScreenManager.ClosePanel();
        }

        if (Utility.Instance.IsMultipleScreenSupported == true && previousResult == false)
            UIManager.Instance.multipleGameScreenManager.ActiveMultipleScreenOption();
    }

    public void OnToggleSplitScreenSupportTap(bool isOn)
    {
        bool previousResult = Utility.Instance.IsSplitScreenSupported;
        Utility.Instance.IsSplitScreenSupported = isOn;

        //if (isOn == false)
        //{
        //    UIManager.Instance.multipleGameScreenManager.AllowGamesRunInBackground = false;
        //    if (UIManager.Instance.multipleGameScreenManager.AnyGameActive())
        //        UIManager.Instance.multipleGameScreenManager.ClosePanel();
        //}

        //if (Utility.Instance.IsMultipleScreenSupported == true && previousResult == false)
        //    UIManager.Instance.multipleGameScreenManager.ActiveMultipleScreenOption();

        UIManager.Instance.splitScreenGameManager.ClosePanel();
        UIManager.Instance.topBarPanel.OpenGameSelectionPanel();
    }

    public void OnToggleSoundStatusTap(bool isOn)
    {
        int Rand = toggleSoundStatus.isOn ? 1 : 0;
        UIManager.Instance.gameAssetData.isSoundOn = Rand;
        SoundManager.Instance.SetSoundStatus(toggleSoundStatus.isOn);
        PlayerPrefs.SetInt("SoundStatus", Rand);
    }

    public void OnToggleVoiceStatusTap(bool isOn)
    {
        int Rand = toggleVoiceStatus.isOn ? 1 : 0;
        UIManager.Instance.gameAssetData.isVoiceOn = Rand;
        PlayerPrefs.SetInt("VoiceStatus", Rand);
    }
    public void nextButtonTap(bool isNextTap)
    {
        int CurrentID = PlayerPrefs.GetInt(LanguagePrefKey);
        Debug.Log("isNextTap => " + isNextTap);
        if (isNextTap)
        {
            if (CurrentID.Equals(0))
                PlayerPrefs.SetInt(LanguagePrefKey, 1);
            else if (CurrentID.Equals(1))
                PlayerPrefs.SetInt(LanguagePrefKey, 2);
            else if (CurrentID.Equals(2))
                PlayerPrefs.SetInt(LanguagePrefKey, 0);
        }
        else
        {
            if (CurrentID.Equals(0))
                PlayerPrefs.SetInt(LanguagePrefKey, 2);
            else if (CurrentID.Equals(1))
                PlayerPrefs.SetInt(LanguagePrefKey, 0);
            else if (CurrentID.Equals(2))
                PlayerPrefs.SetInt(LanguagePrefKey, 1);
        }

        SwitchLanguage();
        Debug.Log("CurrentID => " + PlayerPrefs.GetInt(LanguagePrefKey));
    }
    public void SwitchLanguage()
    {
        Debug.Log("SwitchLanguage => " + PlayerPrefs.GetInt(LanguagePrefKey));

        if (PlayerPrefs.GetInt(LanguagePrefKey).Equals(0))
        {
            PlayNorwegianMaleAudio();
        }
        else if (PlayerPrefs.GetInt(LanguagePrefKey).Equals(1))
        {
            PlayNorwegianFemaleAudio();
        }
        else
        {
            PlayEnglishAudio();
        }
    }

    public void PlayEnglishAudio()
    {
        currentVoiceLanguage = "English";
        UIManager.Instance.gameAssetData.selectedVoiceLanguage = 2;
        // txtCurrentLanguage.text = currentLanguage;
        txtCurrentVoiceLanguage.text = LocalizationManager.GetTranslation(currentVoiceLanguage);
    }

    public void PlayNorwegianFemaleAudio()
    {
        currentVoiceLanguage = "Norwegian Female";
        UIManager.Instance.gameAssetData.selectedVoiceLanguage = 1;
        // txtCurrentLanguage.text = currentLanguage;
        txtCurrentVoiceLanguage.text = LocalizationManager.GetTranslation(currentVoiceLanguage);
    }

    public void PlayNorwegianMaleAudio()
    {
        currentVoiceLanguage = "Norwegian Male";
        UIManager.Instance.gameAssetData.selectedVoiceLanguage = 0;
        // txtCurrentLanguage.text = currentLanguage;
        txtCurrentVoiceLanguage.text = LocalizationManager.GetTranslation(currentVoiceLanguage);
    }
    public void OnToggleNotificationTap()
    {
        // Notification preference saved locally — no server roundtrip needed
        bool enabled = !toggleNotificationStatus.isOn;
        PlayerPrefs.SetInt("NotificationsEnabled", enabled ? 1 : 0);
    }

    public void Open_Game_1_Lucky_Number_Selection_UI()
    {
        game1LuckyNumberAutoSelectionUI.Open_Game_1_Lucky_Number_Selection_UI();
    }

    internal void Set_Game_1_Lucky_Number_Selection_UI(int lucky_Number, bool lucky_Number_State = false)
    {
        Game_1_Lucky_Number = lucky_Number;
        Game_1_Lucky_Number_Txt.text = $"{lucky_Number}";
        Game_1_Lucky_Number_TG.isOn = lucky_Number_State;
    }

    public void OnLuckyNumberTG()
    {
        game1LuckyNumberAutoSelectionUI.Set_Lucky_Number(Game_1_Lucky_Number);
    }

    public void ChangeLanguage()
    {
        if (LocalizationManager.CurrentLanguage.Contains("English"))
        {
            UIManager.Instance.selectedLanguage = "nor";
            SetLanguage("Norwegian");
        }
        else
        {
            UIManager.Instance.selectedLanguage = "en";
            SetLanguage("English (United States)");
        }
    }

    public void InitLanguage(string Language)
    {
        if (Language == "en")
        {
            SetLanguage("English (United States)");
        }
        else
        {
            SetLanguage("Norwegian");
        }
    }


    public void OnBackToLobbyButtonTap()
    {
        this.Close();

        // Reopen previously active game panel if it exists
        if (UIManager.Instance.previouslyActiveGamePanel != null)
        {
            if (UIManager.Instance.previouslyActiveGamePanel.Equals(UIManager.Instance.game1Panel))
            {
                UIManager.Instance.lobbyPanel.gamePlanPanel.OnGame1ButtonTap();
                // UIManager.Instance.game1Panel.Open();
                // UIManager.Instance.game1Panel.game1GamePlayPanel.CallSubscribeRoom();
            }
            else if (UIManager.Instance.previouslyActiveGamePanel.Equals(UIManager.Instance.game2Panel))
            {
                UIManager.Instance.lobbyPanel.gamePlanPanel.OnGame2ButtonTap();
                // UIManager.Instance.game2Panel.Open();
                // UIManager.Instance.game2Panel.game2PlayPanel.CallSubscribeRoom();
            }
            else if (UIManager.Instance.previouslyActiveGamePanel.Equals(UIManager.Instance.game3Panel))
            {
                UIManager.Instance.lobbyPanel.gamePlanPanel.OnGame3ButtonTap();
                // UIManager.Instance.game3Panel.Open();
                // UIManager.Instance.game3Panel.game3GamePlayPanel.CallSubscribeRoom();
            }
            else if (UIManager.Instance.previouslyActiveGamePanel.Equals(UIManager.Instance.game4Panel))
            {
                UIManager.Instance.game4Panel.OpenPanel();
                switch (true)
                {
                    case true when UIManager.Instance.previouslyActiveGame4Theme1:
                        UIManager.Instance.game4Panel.game4GamePlayPanel.themeBtn1.OnButtonTap();
                        break;
                    case true when UIManager.Instance.previouslyActiveGame4Theme2:
                        UIManager.Instance.game4Panel.game4GamePlayPanel.themeBtn2.OnButtonTap();
                        break;
                    case true when UIManager.Instance.previouslyActiveGame4Theme3:
                        UIManager.Instance.game4Panel.game4GamePlayPanel.themeBtn3.OnButtonTap();
                        break;
                    case true when UIManager.Instance.previouslyActiveGame4Theme4:
                        UIManager.Instance.game4Panel.game4GamePlayPanel.themeBtn4.OnButtonTap();
                        break;
                    case true when UIManager.Instance.previouslyActiveGame4Theme5:
                        UIManager.Instance.game4Panel.game4GamePlayPanel.themeBtn5.OnButtonTap();
                        break;
                }
            }
            else if (UIManager.Instance.previouslyActiveGamePanel.Equals(UIManager.Instance.game5Panel))
            {
                UIManager.Instance.game5Panel.OpenPanel();
                // UIManager.Instance.game5Panel.game5GamePlayPanel.CallSubscribeRoom();
            }
            else
            {
                UIManager.Instance.lobbyPanel.OpenGameSelectionPanel();
            }
            if (UIManager.Instance.isBreak)
            {
                UIManager.Instance.breakTimePopup.Open();
            }
            UIManager.Instance.ActiveAllGameElements();
            UIManager.Instance.previouslyActiveGamePanel = null;
        }
        else
        {
            UIManager.Instance.lobbyPanel.OpenGameSelectionPanel();
        }
        // if (!UIManager.Instance.topBarPanel.RunningGamesButtonEnable && (UIManager.Instance.game1Panel.isActiveAndEnabled || UIManager.Instance.game2Panel.isActiveAndEnabled ||
        //     UIManager.Instance.game3Panel.isActiveAndEnabled ||
        //     UIManager.Instance.game4Panel.isActiveAndEnabled || UIManager.Instance.game5Panel.isActiveAndEnabled))
        // {
        //     this.Close();
        //     if (UIManager.Instance.isBreak)
        //     {
        //         UIManager.Instance.breakTimePopup.Open();
        //         UIManager.Instance.ActiveAllGameElements();
        //     }
        //     else
        //     {
        //         UIManager.Instance.ActiveAllGameElements();
        //     }
        // }
        // else
        // {
        //     this.Close();
        //     UIManager.Instance.lobbyPanel.OpenGameSelectionPanel();
        // }
    }

    public void OnAboutUsButtonTap()
    {
        this.Close();
        UIManager.Instance.subSettingPanel.OpenAboutUsPanel();
    }

    public void OnFAQButtonTap()
    {
        this.Close();
        UIManager.Instance.subSettingPanel.OpenFAQPanel();
    }

    public void OnTermsAndConditionButtonTap()
    {
        this.Close();
        UIManager.Instance.subSettingPanel.OpenTermsAndConditionPanel();
    }

    public void OnSupportButtonTap()
    {
        this.Close();
        UIManager.Instance.subSettingPanel.OpenSupportPanel();
    }

    public void OnResponsibleGamingButtonTap()
    {
        this.Close();
        UIManager.Instance.subSettingPanel.OpenResponsibleGamingPanel();
    }

    public void OnLinksOfOtherAgenciesButtonTap()
    {
        this.Close();
        UIManager.Instance.subSettingPanel.OpenLinksOfOtherAgenciesPanel();
    }

    public void OnLogoutButtonTap()
    {
        SpilloramaApiClient.Instance.Logout(
            (object _) =>
            {
                Debug.Log("[SettingPanel] Logout success");
                this.Close();
                UIManager.Instance.ClearPlayerTokenFromWebHost();
                UIManager.Instance.multipleGameScreenManager.ClosePanel();
                UIManager.Instance.topBarPanel.Close();

                Utility.Instance.ClearPlayerCredentials();
                UIManager.Instance.gameAssetData.IsLoggedIn = false;
                UIManager.Instance.CloseAllPanels();
                UIManager.Instance.loginPanel.Open();
            },
            (string code, string message) =>
            {
                Debug.LogWarning($"[SettingPanel] Logout failed: {code} — {message}");
                UIManager.Instance.messagePopup.DisplayMessagePopup(message);
            }
        );
    }

    public void ModifyBlockMySelfDays(bool incrementAction)
    {
        BlockingOptionData blockingOptionData = UIManager.Instance.gameAssetData.blockingOptionData;

        if (incrementAction)
            UIManager.Instance.gameAssetData.blockingOptionData.index++;
        else
            UIManager.Instance.gameAssetData.blockingOptionData.index--;

        if (UIManager.Instance.gameAssetData.blockingOptionData.index < 0)
        {
            UIManager.Instance.gameAssetData.blockingOptionData.index = (UIManager.Instance.gameAssetData.blockingOptionData.list.Count - 1);
        }
        else if (UIManager.Instance.gameAssetData.blockingOptionData.index > (UIManager.Instance.gameAssetData.blockingOptionData.list.Count - 1))
        {
            UIManager.Instance.gameAssetData.blockingOptionData.index = 0;
        }

        BlockingDays = UIManager.Instance.gameAssetData.blockingOptionData.list[UIManager.Instance.gameAssetData.blockingOptionData.index];

        ModifyBlockMySelfDays_Spillorama(BlockingDays);
    }

    private void ModifyBlockMySelfDays_Spillorama(int days)
    {
        if (SpilloramaApiClient.Instance == null) return;

        int durationMinutes = days * 24 * 60;
        SpilloramaApiClient.Instance.SetTimedPause(durationMinutes,
            (SpilloramaComplianceData compliance) =>
            {
                Debug.Log($"[SettingPanel] SetTimedPause success: blocked until {compliance.restrictions.blockedUntil}");
                string msg = $"Spillpause aktivert i {days} dager";
                UIManager.Instance.messagePopup.DisplayMessagePopup(msg);
            },
            (string code, string message) =>
            {
                Debug.LogWarning($"[SettingPanel] SetTimedPause failed: {code} — {message}");
                UIManager.Instance.messagePopup.DisplayMessagePopup(message);
            }
        );
    }

    public void ModifyMonthlyUsageLimit()
    {
        string numericValue = new string(setMonthlyGameLimitInputField.text.Where(char.IsDigit).ToArray());
        monthlyUsageLimitValue = long.Parse(numericValue);

        ModifyMonthlyUsageLimit_Spillorama();
    }

    private void ModifyMonthlyUsageLimit_Spillorama()
    {
        if (SpilloramaApiClient.Instance == null) return;

        string hallId = UIManager.Instance.Player_Hall_ID ?? "";
        SpilloramaApiClient.Instance.SetLossLimits(hallId, 0, monthlyUsageLimitValue,
            (SpilloramaComplianceData compliance) =>
            {
                Debug.Log("[SettingPanel] SetLossLimits success");
                setMonthlyGameLimitInputField.text = monthlyUsageLimitValue.ToString() + " " + Constants.StringClass.currencySymbol;
                UIManager.Instance.messagePopup.DisplayMessagePopup("Tapsgrense oppdatert");
            },
            (string code, string message) =>
            {
                Debug.LogWarning($"[SettingPanel] SetLossLimits failed: {code} — {message}");
                UIManager.Instance.messagePopup.DisplayMessagePopup(message);
            }
        );
    }

    #endregion

    #region PRIVATE_METHODS    

    private void SetLanguage(string LangName)
    {
        if (LocalizationManager.HasLanguage(LangName))
        {
            LocalizationManager.CurrentLanguage = LangName;
        }
        RefreshCurrentLanguageText();
    }

    private void RefreshCurrentLanguageText()
    {
        if (LocalizationManager.CurrentLanguage.Contains("English"))
            txtCurrentLanguage.text = LocalizationManager.GetTranslation("English");
        if (LocalizationManager.CurrentLanguage.Contains("Norwegian"))
            txtCurrentLanguage.text = LocalizationManager.GetTranslation("Norwegian");
    }

    private void EnableNotificationHandler(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("EnableNotification response: " + packet.ToString());
        UIManager.Instance.DisplayLoader(false);

        EventResponse response = JsonUtility.FromJson<EventResponse>(Utility.Instance.GetPacketString(packet));

        if (response.status == Constants.EventStatus.SUCCESS)
        {
            toggleNotificationStatus.isOn = !toggleNotificationStatus.isOn;
            UIManager.Instance.gameAssetData.EnableNotification = toggleNotificationStatus.isOn;
        }
    }

    private void SetLimitDataProcress(Socket socket, Packet packet, params object[] args)
    {
        Debug.Log($"SetLimit Response: {packet}");
        UIManager.Instance.DisplayLoader(false);

        EventResponse response = JsonUtility.FromJson<EventResponse>(Utility.Instance.GetPacketString(packet));

        if (response.status == Constants.EventStatus.SUCCESS)
        {
            //txtMonthlyUsageLimit.text = monthlyUsageLimitValue.ToString() + " " + Constants.StringClass.currencySymbol;
            setMonthlyGameLimitInputField.text = monthlyUsageLimitValue.ToString() + " " + Constants.StringClass.currencySymbol;
            UIManager.Instance.gameAssetData.monthlyLimitData.monthlyUsageLimit = monthlyUsageLimitValue;
        }
        else
        {
            monthlyUsageLimitValue = UIManager.Instance.gameAssetData.monthlyLimitData.monthlyUsageLimit;
            //txtMonthlyUsageLimit.text = monthlyUsageLimitValue.ToString() + " " + Constants.StringClass.currencySymbol;
            setMonthlyGameLimitInputField.text = monthlyUsageLimitValue.ToString() + " " + Constants.StringClass.currencySymbol;
            UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
        }
    }

    private void BlockMySelfProcess(Socket socket, Packet packet, params object[] args)
    {
        Debug.Log($"SetLimit Response: {packet}");
        UIManager.Instance.DisplayLoader(false);

        EventResponse response = JsonUtility.FromJson<EventResponse>(Utility.Instance.GetPacketString(packet));

        //if (response.status == Constants.EventStatus.SUCCESS)
        //{
        //    txtMonthlyUsageLimit.text = monthlyUsageLimitValue.ToString() + " " + Constants.StringClass.currencySymbol;
        //    UIManager.Instance.gameAssetData.monthlyLimitData.monthlyUsageLimit = monthlyUsageLimitValue;
        //}
        //else
        //{
        //    monthlyUsageLimitValue = UIManager.Instance.gameAssetData.monthlyLimitData.monthlyUsageLimit;
        //    txtMonthlyUsageLimit.text = monthlyUsageLimitValue.ToString() + " " + Constants.StringClass.currencySymbol;
        //    UIManager.Instance.messagePopup.DisplayMessagePopup("", response.message);
        //}
        UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
    }

    private void RefreshUniqueIdComponents()
    {
        gameObjectBlockMySelf.SetActive(!UIManager.Instance.gameAssetData.IsUniqueIdPlayer);
    }

    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER

    public int BlockingDays
    {
        set
        {
            //#if !UNITY_WEBGL
            localizationParamsManagerBlockMySelfDays.SetParameterValue("VALUE", value.ToString());
            //#endif
        }
        get
        {
            return UIManager.Instance.gameAssetData.blockingOptionData.list[UIManager.Instance.gameAssetData.blockingOptionData.index];
        }
    }

    #endregion
}
