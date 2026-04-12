using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using BestHTTP.SocketIO;
using I2.Loc;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class LoginPanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    #endregion

    #region PRIVATE_VARIABLES
    [Header("Panels")]
    [SerializeField]
    GameObject loginOptionPanel;

    [SerializeField]
    LoginWithUniqueIdPanel hallIdLoginPanel;

    [SerializeField]
    GameObject normalLoginPanel;
    public GameObject hallSelectionPopup;
    public GameObject tvScreenAndBingoBtn;

    [Header("Input Fields")]
    [SerializeField]
    TMP_InputField inputEmailUsername;

    [SerializeField]
    TMP_InputField inputPassword;

    [SerializeField]
    TMP_InputField inputBankId;

    [SerializeField]
    TMP_InputField inputSelectHalls;

    [Header("Button")]
    [SerializeField]
    Button btnMoreLoginOption;

    [SerializeField]
    Button btnback;

    [Header("Toggle")]
    [SerializeField]
    Toggle toggleIsRemember;

    [Header("Text")]
    [SerializeField]
    TMP_Text txtVersion;

    [Header("DropDown")]
    [SerializeField]
    TMP_Dropdown selectHallDropDown;

    [Header("shortcust Buttton")]
    [SerializeField]
    Button thomasbtn;

    [SerializeField]
    Button chris3btn;

    [SerializeField]
    Button reybtn;

    [SerializeField]
    Button vinsonbtn;
    [SerializeField]
    Button furuset3btn;

    [Header("Transform")]
    [SerializeField]
    private Transform transformHallContainer;

    [Header("Toggle Group")]
    public ToggleGroup Hall_Container_TG;

    [Header("Prefab")]
    [SerializeField]
    private PrefabHallSelection prefabHallSelection;

    public GameObject ShortcutMenue;

    PlayerCredentials playerCreds = new PlayerCredentials("", "", false, "", "");
    public List<PrefabHallSelection> hallSelectionList = new List<PrefabHallSelection>();

    [SerializeField]
    private List<HallData> selectedHallDataList = new List<HallData>();
    public bool isPopupActive = false;
    #endregion

    #region CUSTOM_UNITY_EVENTS
    public CustomUnityEventHallList eventSelectedHallList;
    #endregion

    #region UNITY_CALLBACKS

    private void Awake()
    {
        playerCreds = new PlayerCredentials("", "", false, "", "");
    }

    private void Start()
    {
        Debug.Log("[Recovery] LoginPanel.Start");
        // btnMoreLoginOption.gameObject.SetActive(Utility.Instance.IsStandAloneVersion());
        //if (Utility.Instance.IsStandAloneVersion())
        //{
        //    OpenLoginOptionPanel();
        //    toggleIsRemember.Close();
        //    btnback.gameObject.SetActive(true);
        //}
        //else
        OpenNormalLoginPanel();

        // OpenLoginOptionPanel();
        toggleIsRemember.Close();
        // btnback.gameObject.SetActive(true);

#if UNITY_WEBGL && !UNITY_EDITOR
        toggleIsRemember.Close();
        toggleIsRemember.isOn = true;
#endif

        txtVersion.text = Utility.Instance.GetApplicationVersionWithOS();

        if (!Application.isEditor)
            ShortcutMenue.SetActive(false);

        thomasbtn.onClick.AddListener(() => OnButtonShortvutfillClick("thomas", "123456"));
        chris3btn.onClick.AddListener(() => OnButtonShortvutfillClick("chris3", "123456"));
        reybtn.onClick.AddListener(() => OnButtonShortvutfillClick("rey", "123456"));
        vinsonbtn.onClick.AddListener(() => OnButtonShortvutfillClick("vinson", "123456"));
        furuset3btn.onClick.AddListener(() => OnButtonShortvutfillClick("furuset3", "123456"));
    }

    public void UpdateVersionText()
    {
        //Debug.Log("Version Text Updated Successed");
        UIManager.Instance.splashScreenPanel.UpdateVersionText();
        txtVersion.text = Utility.Instance.GetApplicationVersionWithOS();
    }

    private void OnButtonShortvutfillClick(string predefinedEmail, string predefinedPassword)
    {
        // Fill the input fields with predefined text
        inputEmailUsername.text = predefinedEmail;
        inputPassword.text = predefinedPassword;
    }

    private void OnEnable()
    {
        Debug.Log("[Recovery] LoginPanel.OnEnable");
        // UIManager.Instance.DisplayFirebaseNotificationUpperTray("Hello");
        UIManager.Instance.BingoButtonColor(false);
        ResetInputFields();
        foreach (PrefabHallSelection hall in hallSelectionList)
            hall.IsSelected = false;
        // #if UNITY_IOS
        //         if (Utility.Instance.versions.ios_version.ToString() != Application.version)
        //         {
        //             selectHallDropDown.gameObject.SetActive(false);
        //         }
        //         else
        //         {
        //             selectHallDropDown.gameObject.SetActive(true);
        //         }
        // #endif
    }
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void OnBingoBtnTap()
    {
        EventManager.Instance.StopGameByPlayers(
            (socket, packet, args) =>
            {
                Debug.Log($"StopGameByPlayers Response: {packet}");
                EventResponse response = JsonUtility.FromJson<EventResponse>(
                    Utility.Instance.GetPacketString(packet)
                );
                if (response.status.Equals("success"))
                {
                    // SoundManager.Instance.BingoSound();
                    UIManager.Instance.messagePopup.DisplayMessagePopupAutoHide(
                        response.message,
                        true
                    );
                }
                else
                {
                    UIManager.Instance.messagePopup.DisplayMessagePopupAutoHide(
                        response.message,
                        true
                    );
                }
            }
        );
    }

    // private string lastOpenedURL = "";
    public void OnTvScreenBtnTap()
    {
        EventManager.Instance.TvscreenUrlForPlayers(
            (socket, packet, args) =>
            {
                Debug.Log($"TvscreenUrlForPlayers Response: {packet}");
                EventResponse response = JsonUtility.FromJson<EventResponse>(
                    Utility.Instance.GetPacketString(packet)
                );
                if (response.status.Equals("success"))
                {
#if UNITY_WEBGL && !UNITY_EDITOR
                    Application.ExternalCall("OpenUrlInSameTab", response.result);
#else
                    Application.OpenURL(response.result);
#endif
                }
                else
                {
                    UIManager.Instance.messagePopup.DisplayMessagePopupAutoHide(
                        response.message,
                        true
                    );
                }
            }
        );
    }

    public void OpenLoginOptionPanel()
    {
        Debug.Log("[Recovery] LoginPanel.OpenLoginOptionPanel");
        ResetPanels();
        ResetInputFields();
        loginOptionPanel.gameObject.SetActive(true);
        hallSelectionPopup.SetActive(false);
    }

    public void OpenHallIdLoginPanel()
    {
        Debug.Log("[Recovery] LoginPanel.OpenHallIdLoginPanel");
        ResetPanels();
        hallIdLoginPanel.gameObject.SetActive(true);
    }

    public void OpenNormalLoginPanel()
    {
        Debug.Log("[Recovery] LoginPanel.OpenNormalLoginPanel");
        ResetPanels();
        normalLoginPanel.SetActive(true);
    }

    public void OnSignupButtonTap()
    {
        this.Close();
        UIManager.Instance.signupPanel.Open();
    }

    public void OnForgotPasswordButtonTap()
    {
        this.Close();
        UIManager.Instance.forgotPasswordPanel.Open();
    }

    public void OnSelectHallTap()
    {
        isPopupActive = !isPopupActive;
        hallSelectionPopup.SetActive(isPopupActive);
    }

    public void SetAllHallData(List<HallData> hallDataList)
    {
        Reset();
        selectHallDropDown.ClearOptions();

        HallData currentHall = hallDataList.Find(hall => hall.isCurrentHall);
        UIManager.Instance.splashScreenPanel.data = currentHall;
        if (currentHall != null)
        {
            tvScreenAndBingoBtn.SetActive(true);
            UIManager.Instance.topBarPanel.btnBingo.gameObject.SetActive(true);
            // UIManager.Instance.topBarPanel.dropdownSwitchHall.gameObject.SetActive(false);
            List<string> singleOption = new List<string> { currentHall.name };
            selectHallDropDown.AddOptions(singleOption);
            selectHallDropDown.value = 0;
            selectHallDropDown.interactable = false;
            selectedHall = currentHall;
        }
        else
        {
            List<string> options = new List<string> { "Select Hall" };
            foreach (HallData hallData in hallDataList)
            {
                options.Add(hallData.name);
            }
            selectHallDropDown.AddOptions(options);
            selectHallDropDown.interactable = true;
            UIManager.Instance.topBarPanel.btnBingo.gameObject.SetActive(false);
            // UIManager.Instance.topBarPanel.dropdownSwitchHall.gameObject.SetActive(true);
#if UNITY_IOS
            if (Utility.Instance.versions.ios_version.ToString() != Application.version)
            {
                HallData hallData = UIManager.Instance.gameAssetData.hallDataList.Find(hall => hall.name == "Spillorama Notodden");
                List<string> singleOption = new List<string> { hallData.name };
                selectHallDropDown.AddOptions(singleOption);
                selectHallDropDown.value = 0;
                selectHallDropDown.interactable = false;
                selectedHall = hallData;
            }
            else
            {
                List<string> Iosoptions = new List<string> { "Select Hall" };
                foreach (HallData hallData in hallDataList)
                {
                    Iosoptions.Add(hallData.name);
                }
                selectHallDropDown.AddOptions(Iosoptions);
                selectHallDropDown.interactable = true;
            }
#endif
        }
    }

    public HallData selectedHall;

    public void OnDropdownValueChanged(int index)
    {
        Debug.Log("Check check positive");
        TMP_Text captionText = selectHallDropDown.captionText;
        Color textColor = captionText.color;

        if (index == 0)
        {
            textColor.a = 127f / 255f;
            captionText.color = textColor;
            return;
        }
        else
        {
            textColor.a = 1f;
        }

        captionText.color = textColor;

        int dataIndex = index - 1;

        if (dataIndex >= 0 && dataIndex < UIManager.Instance.gameAssetData.hallDataList.Count)
        {
            selectedHall = UIManager.Instance.gameAssetData.hallDataList[dataIndex];
            Debug.Log($"Selected Hall Name: {selectedHall.name}, Hall ID: {selectedHall._id}");
        }
        else
        {
            Debug.LogError("Invalid index selected.");
        }
    }

    public void HandleHallSelection(List<HallData> hallDataList)
    {
        this.selectedHallDataList = hallDataList;

        if (hallDataList.Count == 0)
        {
            inputSelectHalls.text = "";
            return;
        }
        else
        {
            string hallNames = "";
            for (int i = 0; i < hallDataList.Count; i++)
            {
                if (i == 0)
                    hallNames += hallDataList[i].name;
                else
                    hallNames += ", " + hallDataList[i].name;
            }
            inputSelectHalls.text = hallNames;
        }
    }

    public void OnLoginButtonTap(bool forceLogin = false)
    {
        print("Login");
        if (
            inputEmailUsername.text == "neil@aistechnolabs.org"
            && inputPassword.text == "Ais@technolabs"
        )
        {
            Utility.Instance.LogEnable = true;
            Utility.Instance.RefreshLogMode();
            UIManager.Instance.messagePopup.DisplayMessagePopup(
                "",
                Constants.LanguageKey.LogsActivatedMessage
            );
            return;
        }

        if (!Validate())
        {
            print("Validation Fail");
            return;
        }
        playerCreds = new PlayerCredentials(
            inputEmailUsername.text,
            inputPassword.text,
            toggleIsRemember.isOn,
            selectedHall.name,
            selectedHall._id
        );
        // UIManager.Instance.DisplayLoader(true);
        //EventManager.Instance.Login(forceLogin, playerCreds.emailUsername, playerCreds.password, LoginDataProcress);
        EventManager.Instance.LoginPlayer(
            forceLogin,
            playerCreds.emailUsername,
            playerCreds.password,
            LoginTestProcress
        );
    }

    public void OnLoginWithIdSubmit(bool forceLoin = false)
    {
        playerCreds = new PlayerCredentials("", "", false, "", "");
        // UIManager.Instance.DisplayLoader(true);
        EventManager.Instance.LoginWithUniqueId(
            forceLoin,
            hallIdLoginPanel.GetInputId(),
            LoginDataProcress
        );
    }

    public void DebugAutoLogin(string payload)
    {
        if (string.IsNullOrEmpty(payload))
        {
            Debug.LogWarning("[Recovery] DebugAutoLogin skipped: empty payload.");
            return;
        }

        string[] parts = payload.Split('|');
        if (parts.Length < 2)
        {
            Debug.LogWarning("[Recovery] DebugAutoLogin skipped: expected 'username|password'.");
            return;
        }

        if (selectedHall == null && UIManager.Instance != null && UIManager.Instance.gameAssetData != null)
        {
            if (UIManager.Instance.gameAssetData.hallDataList != null && UIManager.Instance.gameAssetData.hallDataList.Count > 0)
                selectedHall = UIManager.Instance.gameAssetData.hallDataList[0];
        }

        OpenNormalLoginPanel();
        toggleIsRemember.isOn = false;
        inputEmailUsername.text = parts[0];
        inputPassword.text = parts[1];
        Debug.Log($"[Recovery] DebugAutoLogin -> '{parts[0]}'");
        OnLoginButtonTap();
    }

    public void TMPLoginProcress(Socket socket, Packet packet, params object[] args)
    {
        Debug.Log($"TMP Login Response: {packet}");
        UIManager.Instance.DisplayLoader(false);

        EventResponse<LoginResponse> response = JsonUtility.FromJson<EventResponse<LoginResponse>>(
            Utility.Instance.GetPacketString(packet)
        );

        if (response.status == "success")
        {
            print($"response.result : {response.result == null}");
            UIManager.Instance.gameAssetData.PlayerId = response.result.playerId;
            UIManager.Instance.gameAssetData.Points = response.result.points.ToString(
                "###,###,##0.00"
            );
            UIManager.Instance.gameAssetData.RealMoney = response.result.realMoney;
            UIManager.Instance.Player_Hall_ID = response.result.hall;
            LoginSuccessAction();
        }
        else
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
        }
    }

    public void LoginTestProcress(Socket socket, Packet packet, params object[] args)
    {
#if UNITY_EDITOR
        Debug.Log($"Login Response: {packet}");
#endif
        UIManager.Instance.DisplayLoader(false);

        //EventResponse Newresponse = JsonUtility.FromJson<EventResponse>(Utility.Instance.GetPacketString(packet));
        EventResponse<AppUpdateData> response = JsonUtility.FromJson<EventResponse<AppUpdateData>>(
            Utility.Instance.GetPacketString(packet)
        );

        if (response.status == "success")
        {
            GameSocketManager.Instance.CloseConnection();
            GameSocketManager.SocketConnected = false;
            GameSocketManager.ConnectToSocket(response.result.authToken);
            UIManager.Instance.gameAssetData.PlayerId = response.result.playerId;

            UIManager.Instance.gameAssetData.IsUniqueIdPlayer = response.result.isUniqueIdPlayer;
            UIManager.Instance.Player_Hall_ID = response.result.hall;
            UIManager.Instance.Player_Hall_Name = response.result.hallName;
            UIManager.Instance.selectedLanguage = response.result.selectedLanguage;
            UIManager.Instance.gameAssetData.IsLoggedIn = true;
            Utility.Instance.SavePlayerCredentials(playerCreds);
            UIManager.Instance.gameAssetData.SetPlayerData(playerCreds);
            UIManager.Instance.topBarPanel.SetSwitchHallDropdown(response.result.approvedHalls);
            LoginSuccessAction();
            // UIManager.Instance.DisplayLoader(true);
            UIManager.Instance.gameAssetData.PlayerId = response.result.playerId;
            UIManager.Instance.gameAssetData.Points = response.result.points;
            UIManager.Instance.gameAssetData.RealMoney = response.result.realMoney;
            UIManager.Instance.gameAssetData.TodaysBalance = response.result.realMoney;
            UIManager.Instance.gameAssetData.playerGameData.refreshAuthToken = response.result.refreshAuthToken;
            UIManager.Instance.gameAssetData.playerGameData.authToken = response.result.authToken;
            UIManager.Instance.SyncPlayerTokenToWebHost(response.result.authToken);
            UIManager.Instance.gameAssetData.isSoundOn = response.result.isSoundOn;
            UIManager.Instance.gameAssetData.isVoiceOn = response.result.isVoiceOn;
            UIManager.Instance.gameAssetData.selectedVoiceLanguage = response.result.selectedVoiceLanguage;
            //SoundManager.Instance.SoundStatus = UIManager.Instance.gameAssetData.isSoundOn == 0 ? false : true;
            SoundManager.Instance.SetSoundStatus(UIManager.Instance.gameAssetData.isSoundOn == 1);
            if (!PlayerPrefs.HasKey("CurrentGameLanguage"))
            {
                PlayerPrefs.SetInt("CurrentGameLanguage", 0);
            }
            else
            {
                PlayerPrefs.SetInt("CurrentGameLanguage", response.result.selectedVoiceLanguage);
            }


            UIManager.Instance.settingPanel.SwitchLanguage();

            UIManager.Instance.gameAssetData.playerGameData.canPlayGames = response
                .result
                .canPlayGames;
            UIManager.Instance.gameAssetData.playerGameData.isVerifiedByBankID = response
                .result
                .isVerifiedByBankID;
            UIManager.Instance.gameAssetData.playerGameData.isVerifiedByHall = response
                .result
                .isVerifiedByHall;
            if (response != null && response.result != null)
            {
                // Hide tokens before logging
                response.result.authToken = "<hidden>";
                response.result.refreshAuthToken = "<hidden>";

                Debug.Log($"Login Response: {packet}");
            }
            UIManager.Instance.DisplayLoader(false);
            //EventManager.Instance.GetPlayerDetails(response.result.playerId, ProfileDataProcess);
            /*ScreenSaverManager.Instance.ScreenSaverToggle = response.result.screenSaver;
            if (response.result.screenSaver)
            {
                float totalSecond = int.Parse(response.result.screenSaverTime) * 60;
                ScreenSaverManager.Instance.InactivityDuration = totalSecond;
                ScreenSaverManager.Instance.SaveScreenSaverImagesAndDownload(response.result.imageTime);
                //ScreenSaverManager.Instance.imageTime = response.result.imageTime;
            }*/
            Debug.Log($"{playerCreds.hallName} {playerCreds.hallId}");
            string path;

#if UNITY_EDITOR || UNITY_STANDALONE_WIN
            // Windows/Editor path
            path = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "Spillorama",
                "player_id.txt"
            );
#elif UNITY_ANDROID || UNITY_IOS
            // Mobile path using Unity's persistent data path
            path = Path.Combine(Application.persistentDataPath, "player_id.txt");
#else
            // Fallback for other platforms
            path = Path.Combine(Application.persistentDataPath, "player_id.txt");
#endif


            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(path));
                File.WriteAllText(path, UIManager.Instance.gameAssetData.PlayerId);
                Debug.Log(
                    $"✅ Saved playerId to tray app: {UIManager.Instance.gameAssetData.PlayerId} - path: {path}"
                );
            }
            catch (Exception ex)
            {
                Debug.LogError("❌ Failed to save playerId for tray app: " + ex.Message);
            }

            this.Close();
        }
        else
        {
            if (response.message == "updateApp")
            {
                print("updateApp");

                if (response.result.storeUrl == null || response.result.storeUrl == "")
                {
                    UIManager.Instance.messagePopup.DisplayMessagePopup(
                        response.result.message,
                        Constants.LanguageKey.ExitGameMessage,
                        () =>
                        {
                            Debug.Log("Application Quit Call");
                            Application.Quit();
                        }
                    );
                }
                else
                {
                    UIManager.Instance.messagePopup.DisplayConfirmationPopup(
                        response.result.message,
                        Constants.LanguageKey.UpdateMessage,
                        Constants.LanguageKey.ExitGameMessage,
                        () =>
                        {
#if UNITY_STANDALONE_WIN
                            UIManager.Instance.UpdateManager.StartUpdate(response.result.storeUrl);
#elif UNITY_ANDROID
                            Application.OpenURL(response.result.storeUrl);
#elif UNITY_IOS
                            Application.OpenURL(response.result.storeUrl);
#elif UNITY_STANDALONE_LINUX
                            // Code for Linux platform
#elif UNITY_STANDALONE_OSX
                            // Code for macOS platform
#elif UNITY_WEBGL
                            // Code for WebGL platform
                            // You can add WebGL-specific functionality here if needed
#else
                            // Code for other platforms (not covered by the above conditions)
#endif

                            Debug.Log("Application OpenURL Call");
                        },
                        () =>
                        {
                            Debug.Log("Application Quit Call");
                            Application.Quit();
                        }
                    );
                }
            }
            else if (response.message == "alreadyLogin")
            {
                print("already login");
                UIManager.Instance.messagePopup.DisplayConfirmationPopup(
                    Constants.LanguageKey.SamePlayerLoginConfirmationMessage,
                    Constants.LanguageKey.LoginMessage,
                    Constants.LanguageKey.CancelMessage,
                    () =>
                    {
                        if (UIManager.Instance.loginPanel.hallIdLoginPanel.isActiveAndEnabled)
                            OnLoginWithIdSubmit(true);
                        else
                            OnLoginButtonTap(true);
                    }
                );
            }
            else
            {
                print($"LoginDataHandler Else : {response.message}");
                UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
            }
        }
    }

    internal void ProfileDataProcess(Socket socket, Packet packet, params object[] args)
    {
        //print($"Profile Data Response : {packet}");
        EventResponse<ProfileData> response = JsonUtility.FromJson<EventResponse<ProfileData>>(
            Utility.Instance.GetPacketString(packet)
        );
        UIManager.Instance.DisplayLoader(false);
        if (response.status == "success")
        {
            if (response.result != null)
            {
                UIManager.Instance.gameAssetData.PlayerId = response.result.playerId;
                UIManager.Instance.gameAssetData.Points = response.result.points.ToString(
                    "###,###,##0.00"
                );
                UIManager.Instance.gameAssetData.RealMoney = response.result.realMoney.ToString(
                    "###,###,##0.00"
                );
                UIManager.Instance.gameAssetData.TodaysBalance = response.result.realMoney.ToString(
                    "###,###,##0.00"
                );
                UIManager.Instance.Player_Hall_ID = response.result.hall;
                UIManager.Instance.Player_Hall_Name = response.result.hallName;
            }
            else
                UIManager.Instance.messagePopup.DisplayMessagePopup(
                    Constants.LanguageKey.CantFetchMessage,
                    Constants.LanguageKey.LogoutMessage,
                    UIManager.Instance.settingPanel.OnLogoutButtonTap
                );
        }
        else
            UIManager.Instance.messagePopup.DisplayMessagePopup(
                response.message,
                Constants.LanguageKey.LogoutMessage,
                UIManager.Instance.settingPanel.OnLogoutButtonTap
            );
    }

    public void LoginDataProcress(Socket socket, Packet packet, params object[] args)
    {
        Debug.Log($"Login Response: {packet}");
        UIManager.Instance.DisplayLoader(false);

        EventResponse<LoginRegisterResponse> response = JsonUtility.FromJson<
            EventResponse<LoginRegisterResponse>
        >(Utility.Instance.GetPacketString(packet));
        LoginDataHandler(response);
    }

    public void LoginDataHandler(EventResponse<LoginRegisterResponse> response)
    {
        print($"Login Data Handler called");
        if (response.status != EventResponse<LoginRegisterResponse>.STATUS_FAIL)
        {
            print($"LoginDataHandler If");
            this.Close();

            Utility.Instance.SavePlayerCredentials(playerCreds);
            UIManager.Instance.gameAssetData.SetPlayerData(playerCreds);
            UIManager.Instance.gameAssetData.IsUniqueIdPlayer = response.result.isUniqueIdPlayer;
            UIManager.Instance.gameAssetData.PlayerId = response.result.playerId;
            UIManager.Instance.gameAssetData.Points = response.result.points.ToString(
                "###,###,##0.00"
            );
            UIManager.Instance.gameAssetData.RealMoney = response.result.realMoney.ToString(
                "###,###,##0.00"
            );
            UIManager.Instance.gameAssetData.TodaysBalance = response.result.realMoney.ToString(
                "###,###,##0.00"
            );
            UIManager.Instance.gameAssetData.monthlyLimitData = response.result.monthlyLimitData;
            UIManager.Instance.gameAssetData.blockingOptionData = response.result.blockData;
            UIManager.Instance.gameAssetData.EnableNotification = response
                .result
                .enableNotification;
            UIManager.Instance.gameAssetData.HallList = response.result.hallList;
            UIManager.Instance.Player_Hall_ID = response.result.hallList[0];
            UIManager.Instance.gameAssetData.IsLoggedIn = true;
            LoginSuccessAction();
        }
        else
        {
            print($"Login response faild : {response.message}");
            //if (response.message == "updateApp")
            //{
            //    print("updateApp");
            //    UIManager.Instance.messagePopup.DisplayConfirmationPopup("Please update the game from app store", "Update", "Exit Game",
            //        () =>
            //        {
            //            Application.OpenURL(response.result.storeUrl);
            //        },
            //        () =>
            //        {
            //            Application.Quit();
            //        });
            //}
            //else if (response.message == "alreadyLogin")
            //{
            //    print("already login");
            //    UIManager.Instance.messagePopup.DisplayConfirmationPopup("Same player is already logged in from another device, are you sure you want to login?", "Login", "Cancel",
            //        () =>
            //        {
            //            if (UIManager.Instance.loginPanel.hallIdLoginPanel.isActiveAndEnabled)
            //                OnLoginWithIdSubmit(true);
            //            else
            //                OnLoginButtonTap(true);
            //        });
            //}
            //else
            //{
            //    print($"LoginDataHandler Else : {response.message}");
            //    UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
            //}

            if (response.message == "updateApp")
            {
                print("updateApp");

                if (response.result.storeUrl == null || response.result.storeUrl == "")
                {
                    UIManager.Instance.messagePopup.DisplayMessagePopup(
                        response.result.message,
                        Constants.LanguageKey.ExitGameMessage,
                        () =>
                        {
                            Debug.Log("Application Quit Call");
                            Application.Quit();
                        }
                    );
                }
                else
                {
                    UIManager.Instance.messagePopup.DisplayConfirmationPopup(
                        response.result.message,
                        Constants.LanguageKey.UpdateMessage,
                        Constants.LanguageKey.ExitGameMessage,
                        () =>
                        {
                            Debug.Log("Application OpenURL Call");
                            Application.OpenURL(response.result.storeUrl);
                        },
                        () =>
                        {
                            Debug.Log("Application Quit Call");
                            Application.Quit();
                        }
                    );
                }
            }
            else if (response.message == "alreadyLogin")
            {
                print("already login");
                UIManager.Instance.messagePopup.DisplayConfirmationPopup(
                    Constants.LanguageKey.SamePlayerLoginConfirmationMessage,
                    Constants.LanguageKey.LoginMessage,
                    Constants.LanguageKey.CancelMessage,
                    () =>
                    {
                        if (UIManager.Instance.loginPanel.hallIdLoginPanel.isActiveAndEnabled)
                            OnLoginWithIdSubmit(true);
                        else
                            OnLoginButtonTap(true);
                    }
                );
            }
            else
            {
                print($"LoginDataHandler Else : {response.message}");
                UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
            }
        }
    }

    public void LoginSuccessAction()
    {
        Debug.Log("[Recovery] LoginPanel.LoginSuccessAction -> lobby");
        print($"Login Successfully");

        // In WebGL host mode, check if the web shell queued a game before login completed
        if (UIManager.Instance.isGameWebGL && !string.IsNullOrEmpty(UIManager.Instance.pendingHostGameNumber))
        {
            Debug.Log("[Recovery] LoginSuccessAction: pending host game found, launching directly");
            UIManager.Instance.lobbyPanel.OpenHostShellLobbyState();
            UIManager.Instance.ProcessPendingHostGame();
            return;
        }

        UIManager.Instance.lobbyPanel.OpenGameSelectionPanel();

        // Signal to web shell that Unity is ready for game navigation
        if (UIManager.Instance.isGameWebGL)
        {
            UIManager.Instance.SignalHostReady();
        }
    }

    #endregion

    #region PRIVATE_METHODS
    private void ResetInputFields()
    {
        toggleIsRemember.isOn = false;
        inputEmailUsername.text = "";
        inputPassword.text = "";
        inputBankId.text = "";
        inputSelectHalls.text = "";
        Reset();
    }

    private void ResetPanels()
    {
        loginOptionPanel.SetActive(false);
        hallIdLoginPanel.gameObject.SetActive(false);
        normalLoginPanel.SetActive(false);
    }

    public void Reset()
    {
        // foreach (PrefabHallSelection hall in hallSelectionList)
        //     Destroy(hall.gameObject);

        // hallSelectionList.Clear();
        selectHallDropDown.value = 0;
        // selectHallDropDown.interactable = true;
        // selectHallDropDown.captionText.text = selectHallDropDown.options[0].text; // Display the placeholder
    }

    private bool Validate()
    {
        string emailUsername = inputEmailUsername.text;
        string password = inputPassword.text;
        string bankId = inputBankId.text;
        int selectedHallIndex = selectHallDropDown.value;
        string hallNames = selectHallDropDown.options[selectedHallIndex].text;

        if (emailUsername == "")
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(
                Constants.LanguageKey.PleaseEnterUsernamePhoneNumberMessage
            );
            return false;
        }
        else if (password == "")
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(
                Constants.LanguageKey.PleaseEnterPasswordMessage
            );
            return false;
        }
        else if (password.Length < Constants.InputData.minimumPasswordLength)
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(
                Constants.LanguageKey.MinimumPasswordLengthMessage
                    + " "
                    + Constants.InputData.minimumPasswordLength
            );
            return false;
        }
        else if (inputBankId.isActiveAndEnabled && bankId == "")
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(
                Constants.LanguageKey.BankIdInvalidMessage
            );
            return false;
        }
        // else if (selectedHallIndex == 0 && hallNames == "Select Hall")
        // {
        //     UIManager.Instance.messagePopup.DisplayMessagePopup(
        //         Constants.LanguageKey.PleaseSelectHall
        //     );
        //     return false;
        // }
        return true;
    }
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    #endregion
}
