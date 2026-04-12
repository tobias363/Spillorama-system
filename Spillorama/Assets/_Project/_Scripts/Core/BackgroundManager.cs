using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using BestHTTP.SocketIO;
using I2.Loc;
using TMPro;
using UnityEngine;
using UnityEngine.SceneManagement;
using static Constants;

public class BackgroundManager : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    public static BackgroundManager Instance = null;

    public Coroutine checkBreakTime;
    #endregion

    #region PRIVATE_VARIABLES
    [SerializeField] private string _gameType;
    #endregion



    #region UNITY_CALLBACKS
    private void Awake()
    {
        if (Instance == null)
        {
            Instance = this;
        }
        else if (Instance != null)
        {
            Destroy(gameObject);
            return;
        }

        GameSocketManager.SocketConnectionInitialization += EnableBroadcast;
    }

    private void Start()
    {
        StartCoroutine(CallProfileEvent());
    }
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void EnableBroadcast()
    {
        GameSocketManager.SocketConnectionInitialization -= EnableBroadcast;
        if (GameSocketManager.socketManager?.Socket == null) return;

        if (SceneManager.GetActiveScene().name == "Game")
        {
            GameSocketManager.socketManager.Socket.On(Constants.BroadcastName.ForceLogout, ForceLogoutReceived);
            GameSocketManager.socketManager.Socket.On(Constants.BroadcastName.NotificationBroadcast, OnNotificationBroadcast);
            GameSocketManager.socketManager.Socket.On(Constants.BroadcastName.closePaymentPage, OnclosePaymentPage);
            GameSocketManager.socketManager.Socket.On(Constants.BroadcastName.refreshPaymentPage, OnrefreshPaymentPage);
            GameSocketManager.socketManager.Socket.On(Constants.BroadcastName.playerVerificationStatus, OnPlayerVerification);
            GameSocketManager.socketManager.Socket.On(Constants.BroadcastName.playerApprovedHalls, OnPlayerApprovedHalls);
            GameSocketManager.socketManager.Socket.On(Constants.BroadcastName.PlayerHallLimit, OnPlayerHallLimit);
        }
        else
        {
            GameSocketManager.socketManager.Socket.On(Constants.BroadcastName.newDailyScheduleCreated, OnNewDailyScheduleCreated);
        }
    }

    public void DisableBroadcast()
    {
        if (GameSocketManager.socketManager?.Socket == null) return;

        GameSocketManager.socketManager.Socket.Off(Constants.BroadcastName.ForceLogout, ForceLogoutReceived);
        GameSocketManager.socketManager.Socket.Off(Constants.BroadcastName.NotificationBroadcast, OnNotificationBroadcast);
        GameSocketManager.socketManager.Socket.Off(Constants.BroadcastName.closePaymentPage, OnclosePaymentPage);
        GameSocketManager.socketManager.Socket.Off(Constants.BroadcastName.refreshPaymentPage, OnrefreshPaymentPage);
        GameSocketManager.socketManager.Socket.Off(Constants.BroadcastName.playerVerificationStatus, OnPlayerVerification);
        GameSocketManager.socketManager.Socket.Off(Constants.BroadcastName.playerApprovedHalls, OnPlayerApprovedHalls);
        GameSocketManager.socketManager.Socket.Off(Constants.BroadcastName.PlayerHallLimit, OnPlayerHallLimit);
        GameSocketManager.socketManager.Socket.Off(Constants.BroadcastName.newDailyScheduleCreated, OnNewDailyScheduleCreated);
    }

    private void OnNewDailyScheduleCreated(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnNewDailyScheduleCreated: " + packet.ToString());
        NewDailyScheduleCreated resp = JsonUtility.FromJson<NewDailyScheduleCreated>(Utility.Instance.GetPacketString(packet));
        resp.halls.ForEach(hall =>
        {
            Debug.Log("hall: " + hall);
            Debug.Log("UIManager.Instance.bingoHallDisplayPanel.HallId: " + UIManager.Instance.bingoHallDisplayPanel.HallId);
            if (UIManager.Instance.bingoHallDisplayPanel.HallId == hall)
            {
                Debug.Log("in if");
                Application.ExternalCall("requestGameData");
                Debug.Log("requestGameData");
            }
        });
    }

    public void GetAllHallList()
    {
        if (SceneManager.GetActiveScene().name == "Game")
        {
            EventManager.Instance.HallList((socket, packet, arga) =>
            {
                Debug.Log($"HallList response: {packet}");
                UIManager.Instance.DisplayLoader(false);

                EventResponse<HallListData> resonse = JsonUtility.FromJson<EventResponse<HallListData>>(Utility.Instance.GetPacketString(packet));
                if (resonse.status == Constants.EventStatus.SUCCESS)
                {
                    UIManager.Instance.gameAssetData.hallDataList = resonse.result.hallList;
                    UIManager.Instance.gameAssetData.countryList = resonse.result.countryList;
                    Utility.Instance.versions = resonse.result.versions;
                    UIManager.Instance.gameAssetData.registerInfoText = resonse.result.registerInfoText;
                    UIManager.Instance.signupPanel.hallSelectionPanel.SetAllHallData(UIManager.Instance.gameAssetData.hallDataList);
                    UIManager.Instance.loginPanel.SetAllHallData(UIManager.Instance.gameAssetData.hallDataList);
                    UIManager.Instance.signupPanel.countrySelectionPanel.SetAllCountryData(UIManager.Instance.gameAssetData.countryList);
                    UIManager.Instance.loginPanel.UpdateVersionText();
                }
            });
        }
    }


    public void PlayerUpdateIntervalCall()
    {
        //EventManager.Instance.PlayerUpdateInterval((socket, packet, args) => {
        //    EventResponse<PlayerDataResponse> resp = JsonUtility.FromJson<EventResponse<PlayerDataResponse>>(Utility.Instance.GetPacketString(packet));            
        //    if (resp.status.Equals(Constants.EventStatus.SUCCESS))
        //    {
        //        //print($"PlayerUpdateIntervalCall Success : {packet}");
        //        UIManager.Instance.gameAssetData.Points = resp.result.points;
        //        UIManager.Instance.gameAssetData.RealMoney = resp.result.realMoney;
        //        UIManager.Instance.gameAssetData.TodaysBalance = resp.result.realMoney;
        //    }
        //    else
        //    {
        //        print("PlayerUpdateIntervalCall fail");
        //    }
        //});

        EventManager.Instance.PlayerUpdateInterval((socket, packet, args) =>
        {
            try
            {
                EventResponse<PlayerDataResponse> resp = JsonUtility.FromJson<EventResponse<PlayerDataResponse>>(Utility.Instance.GetPacketString(packet));
                if (resp.status.Equals(Constants.EventStatus.SUCCESS))
                {
                    //print($"PlayerUpdateIntervalCall Success : {packet}");
                    UIManager.Instance.gameAssetData.Points = double.Parse(resp.result.points).ToString("###,###,##0.00");
                    UIManager.Instance.gameAssetData.RealMoney = double.Parse(resp.result.realMoney).ToString("###,###,##0.00");
                    UIManager.Instance.gameAssetData.TodaysBalance = double.Parse(resp.result.realMoney).ToString("###,###,##0.00");
                }
                else
                {
                    print("PlayerUpdateIntervalCall fail");
                }
            }
            catch (Exception e)
            {
                // Handle the exception, you can log it or take appropriate action.
                print($"An exception occurred: {e.Message}");
            }
        });
    }
    #endregion

    #region PRIVATE_METHODS
    /// <summary>
    /// 
    /// </summary>
    /// <param name="socket"></param>
    /// <param name="packet"></param>
    /// <param name="args"></param>
    private void ForceLogoutReceived(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("ForceLogoutReceived: " + packet.ToString());
        JSON_Object jsonObj = new JSON_Object(Utility.Instance.GetPacketString(packet));
        ForceLogoutBroadcast forceLogoutData = JsonUtility.FromJson<ForceLogoutBroadcast>(Utility.Instance.GetPacketString(packet));

        if (jsonObj.has("message"))
        {
            UIManager.Instance.multipleGameScreenManager.ClosePanel();
            UIManager.Instance.topBarPanel.Close();
            UIManager.Instance.CloseAllPanels();
            UIManager.Instance.loginPanel.Open();

            Utility.Instance.ClearPlayerCredentials();
            UIManager.Instance.gameAssetData.IsLoggedIn = false;
            UIManager.Instance.splitScreenGameManager.CloseResetPanel();
            UIManager.Instance.messagePopup.DisplayMessagePopup(jsonObj.getString("message"));
        }

        if (!string.IsNullOrEmpty(forceLogoutData.message))
        {
            UIManager.Instance.multipleGameScreenManager.ClosePanel();
            UIManager.Instance.topBarPanel.Close();
            UIManager.Instance.CloseAllPanels();
            UIManager.Instance.loginPanel.Open();

            Utility.Instance.ClearPlayerCredentials();
            UIManager.Instance.gameAssetData.IsLoggedIn = false;
            UIManager.Instance.splitScreenGameManager.CloseResetPanel();
            UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.ForceLogoutMessage);
        }
    }

    public bool isNotificationRecieved = false;
    private void OnNotificationBroadcast(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnNotificationBroadcast: " + packet.ToString());

        NotificationBroadcast notificationData = JsonUtility.FromJson<NotificationBroadcast>(Utility.Instance.GetPacketString(packet));

        if (notificationData.notificationType.Equals("Game Start Reminder"))
        {
            isNotificationRecieved = true;
            UIManager.Instance.lobbyPanel.gamePlanPanel.RefreshList();
            UIManager.Instance.game3Panel.game3GamePlayPanel.TicketDeleteBtnClose();
            UIManager.Instance.game2Panel.game2PlayPanel.TicketDeleteBtnClose();
        }
        else
        {
            isNotificationRecieved = false;
        }
        // UIManager.Instance.DisplayNotificationUpperTray(notificationData.message);
    }

    private void OnclosePaymentPage(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnclosePaymentPage: " + packet.ToString());
        UIManager.Instance.DisplayLoader(false);
        UIManager.Instance.topBarPanel.OnWebpagClose();
    }

    private void OnrefreshPaymentPage(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnrefreshPaymentPage: " + packet.ToString());
        refreshPaymentPage refreshPaymentPage = JsonUtility.FromJson<refreshPaymentPage>(Utility.Instance.GetPacketString(packet));
        UIManager.Instance.webViewManager.RefreshURL(refreshPaymentPage.url);
    }

    private void OnPlayerApprovedHalls(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnPlayerApprovedHalls: " + packet.ToString());
        PlayerApprovedHallsResponse resp = JsonUtility.FromJson<PlayerApprovedHallsResponse>(Utility.Instance.GetPacketString(packet));
        UIManager.Instance.topBarPanel.SetSwitchHallDropdown(resp.approvedHalls);
    }

    private void OnPlayerHallLimit(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnPlayerHallLimit Broadcast: " + packet.ToString());
        EventManager.Instance.PlayerHallLimit((socket, packet, args) =>
        {
            Debug.Log("PlayerHallLimit Event: " + packet.ToString());
            EventResponse<PlayerApprovedHallsResponse> response = JsonUtility.FromJson<EventResponse<PlayerApprovedHallsResponse>>(Utility.Instance.GetPacketString(packet));
            if (response.status == Constants.EventStatus.SUCCESS)
            {
                UIManager.Instance.topBarPanel.SetSwitchHallDropdown(response.result.approvedHalls);
            }
            else
            {
                UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
            }
        });
    }

    private void OnPlayerVerification(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnPlayerVerification: " + packet.ToString());
        PlayerVerification resp = JsonUtility.FromJson<PlayerVerification>(Utility.Instance.GetPacketString(packet));
        UIManager.Instance.gameAssetData.playerGameData.canPlayGames = resp.canPlayGames;
        // UIManager.Instance.gameAssetData.playerGameData.isVerifiedByBankID = resp.isVerifiedByBankID;
        // UIManager.Instance.profilePanel.BankId_Btn.gameObject.SetActive(!resp.isVerifiedByBankID);
        // UIManager.Instance.profilePanel.Verify_User.SetActive(!resp.isVerifiedByBankID && !resp.isVerifiedByHall);
        UIManager.Instance.gameAssetData.playerGameData.isVerifiedByBankID = resp.isVerifiedByBankID;
        UIManager.Instance.gameAssetData.playerGameData.isVerifiedByHall = resp.isVerifiedByHall;
        if (!string.IsNullOrEmpty(resp.idExpiryDate))
        {
            // UIManager.Instance.profilePanel.idExpiryDateTxt.text = $"ID Expiry Date: {DateTime.Parse(resp.idExpiryDate).ToLocalTime().ToString("dd/MM/yyyy hh:mm tt")}";
            UIManager.Instance.profilePanel.idExpiryDateTxt.GetComponent<LocalizationParamsManager>().SetParameterValue("value", DateTime.Parse(resp.idExpiryDate).ToLocalTime().ToString("dd/MM/yyyy hh:mm tt"));
        }
        if (resp.isVerifiedByBankID && !resp.isBankIdReverificationNeeded && resp.isVerifiedByHall)
        {
            UIManager.Instance.profilePanel.verifiedTxt.gameObject.SetActive(true);
            UIManager.Instance.profilePanel.BankId_Btn.gameObject.SetActive(false);
            UIManager.Instance.profilePanel.BankId_Reverification_Btn.gameObject.SetActive(false);
        }
        else
        {
            UIManager.Instance.profilePanel.verifiedTxt.gameObject.SetActive(false);
        }

        // Handle Bank ID verification display logic
        if (resp.isVerifiedByBankID && !resp.isBankIdReverificationNeeded)
        {
            // Show "Bank Id" - Bank ID is verified and no reverification needed
            UIManager.Instance.profilePanel.BankId_Btn.gameObject.SetActive(true);
            UIManager.Instance.profilePanel.BankId_Reverification_Btn.gameObject.SetActive(false);
        }
        else if (resp.isVerifiedByBankID && resp.isBankIdReverificationNeeded)
        {
            // Show "Re verify BankId" - Bank ID is verified but reverification is needed
            UIManager.Instance.profilePanel.BankId_Btn.gameObject.SetActive(false);
            UIManager.Instance.profilePanel.BankId_Reverification_Btn.gameObject.SetActive(true);
        }
        else
        {
            // Bank ID is not verified - show regular Bank ID button
            UIManager.Instance.profilePanel.BankId_Btn.gameObject.SetActive(true);
            UIManager.Instance.profilePanel.BankId_Reverification_Btn.gameObject.SetActive(false);
        }

        // Handle Hall verification
        UIManager.Instance.profilePanel.Img_Btn.gameObject.SetActive(!resp.isVerifiedByHall);
        UIManager.Instance.profilePanel.idExpiryDateTxt.gameObject.SetActive(resp.isVerifiedByHall);
        // resp.idExpiryDate = Utility.Instance.GetDateTimeLocal(resp.idExpiryDate).ToString();
        // UIManager.Instance.profilePanel.idExpiryDateTxt.text = resp.idExpiryDate.ToString("dd/MM/yyyy");
        if (!string.IsNullOrEmpty(resp.idExpiryDate))
        {
            // UIManager.Instance.profilePanel.idExpiryDateTxt.text = $"ID Expiry Date: {DateTime.Parse(resp.idExpiryDate).ToLocalTime().ToString("dd/MM/yyyy hh:mm tt")}";
            UIManager.Instance.profilePanel.idExpiryDateTxt.GetComponent<LocalizationParamsManager>().SetParameterValue("value", DateTime.Parse(resp.idExpiryDate).ToLocalTime().ToString("dd/MM/yyyy hh:mm tt"));
        }
        // UIManager.Instance.profilePanel.BankId_Btn.gameObject.SetActive(resp.isVerifiedByBankID);
        // UIManager.Instance.profilePanel.BankId_Reverification_Btn.gameObject.SetActive(!resp.isBankIdReverificationNeeded);
    }

    #endregion

    #region COROUTINES
    IEnumerator CallProfileEvent()
    {
        while (true)
        {
            if (UIManager.Instance.gameAssetData.IsLoggedIn)
            {
                PlayerUpdateIntervalCall();
            }
            yield return new WaitForSeconds(12);
        }
    }

    // public void StartBreakCheck()
    // {
    //     // Prevent multiple invokes
    //     if (IsInvoking(nameof(CheckBreakTime)))
    //         CancelInvoke(nameof(CheckBreakTime));

    //     InvokeRepeating(nameof(CheckBreakTime), 1f, 1f); // start after 1 sec, repeat every 1 sec
    // }

    // // Stop invoking the check
    // public void StopBreakCheck()
    // {
    //     CancelInvoke(nameof(CheckBreakTime));
    // }

    // // Called every second
    // private void CheckBreakTime()
    // {
    //     // Compare current time with UIManager.Instance.startBreakTime and endBreakTime
    //     if (UIManager.Instance.isBreak &&
    //         System.DateTimeOffset.UtcNow >= UIManager.Instance.startBreakTime &&
    //         System.DateTimeOffset.UtcNow <= UIManager.Instance.endBreakTime)
    //     {
    //         EventManager.Instance.CheckPlayerBreakTime(_gameType, (socket, packet, args) =>
    //                             {
    //                                 Debug.Log($"CheckPlayerBreakTime Response: {packet}");

    //                                 EventResponse<CheckBreakTime> breakTime = JsonUtility.FromJson<EventResponse<CheckBreakTime>>(
    //                                     Utility.Instance.GetPacketString(packet));

    //                                 UIManager.Instance.isBreak = breakTime.result.isBreak;
    //                                 if (breakTime.status == EventStatus.SUCCESS)
    //                                 {
    //                                     if (!string.IsNullOrEmpty(breakTime.result.startBreakTime) && !string.IsNullOrEmpty(breakTime.result.endBreakTime))
    //                                     {
    //                                         UIManager.Instance.startBreakTime = DateTimeOffset.Parse(
    //                                             breakTime.result.startBreakTime,
    //                                             CultureInfo.InvariantCulture,
    //                                             DateTimeStyles.AssumeUniversal);

    //                                         UIManager.Instance.endBreakTime = DateTimeOffset.Parse(
    //                                             breakTime.result.endBreakTime,
    //                                             CultureInfo.InvariantCulture,
    //                                             DateTimeStyles.AssumeUniversal);

    //                                         UIManager.Instance.breakTimePopup.OpenPanel("null");
    //                                     }
    //                                 }
    //                                 else
    //                                 {
    //                                     UIManager.Instance.isBreak = false;
    //                                 }
    //                             });
    //     }
    // }

    public IEnumerator CheckBreakTime()
    {
        // Debug.LogError("check break time");
        DateTimeOffset? lastCheckedTime = null;
        DateTimeOffset? lastProcessedBreakTime = null;

        while (true)
        {
            // Debug.LogError("in while");
            DateTimeOffset currentTime = DateTimeOffset.UtcNow;

            // Direct access without null check (since DateTimeOffset is a struct)
            if (!UIManager.Instance.isBreak && UIManager.Instance.startBreakTime != default)
            {
                // Debug.LogError("in if not isbreak");

                bool isBreakTimeReached = currentTime >= UIManager.Instance.startBreakTime;
                bool isNewBreakSchedule = UIManager.Instance.startBreakTime != lastCheckedTime;
                bool isSameBreakTimeAsLastProcessed = lastProcessedBreakTime.HasValue &&
                                                     UIManager.Instance.startBreakTime == lastProcessedBreakTime.Value;

                //Debug.LogError($"isBreakTimeReached: {isBreakTimeReached} - isNewBreakSchedule: {isNewBreakSchedule} - isSameBreakTimeAsLastProcessed: {isSameBreakTimeAsLastProcessed}");

                if (isBreakTimeReached && isNewBreakSchedule && !isSameBreakTimeAsLastProcessed)
                {
                    //Debug.LogError("in if isBreakTimeReached && isNewBreakSchedule");

                    _gameType = true switch
                    {
                        bool _ when UIManager.Instance.isGame2 => "Game2",
                        bool _ when UIManager.Instance.isGame3 => "Game3",
                        bool _ when UIManager.Instance.isGame4 => "Game4",
                        bool _ when UIManager.Instance.isGame5 => "Game5",
                        _ => "",
                    };
                    EventManager.Instance.CheckPlayerBreakTime(_gameType, (socket, packet, args) =>
                    {
                        Debug.Log($"CheckPlayerBreakTime Response: {packet}");

                        EventResponse<CheckBreakTime> breakTime = JsonUtility.FromJson<EventResponse<CheckBreakTime>>(
                            Utility.Instance.GetPacketString(packet));

                        UIManager.Instance.isBreak = breakTime.result.isBreak;
                        if (breakTime.status == EventStatus.SUCCESS)
                        {
                            if (!string.IsNullOrEmpty(breakTime.result.startBreakTime) && !string.IsNullOrEmpty(breakTime.result.endBreakTime))
                            {
                                UIManager.Instance.startBreakTime = DateTimeOffset.Parse(
                                    breakTime.result.startBreakTime,
                                    CultureInfo.InvariantCulture,
                                    DateTimeStyles.AssumeUniversal);

                                UIManager.Instance.endBreakTime = DateTimeOffset.Parse(
                                    breakTime.result.endBreakTime,
                                    CultureInfo.InvariantCulture,
                                    DateTimeStyles.AssumeUniversal);

                                // lastCheckedTime = null;
                                lastProcessedBreakTime = UIManager.Instance.startBreakTime;
                                UIManager.Instance.breakTimePopup.OpenPanel("null");
                                // Debug.Log($"Break time activated at {currentTime:o}");
                                return;
                            }
                        }
                        else
                        {
                            UIManager.Instance.isBreak = false;
                            return;
                        }
                    });
                    //yield break;
                    lastCheckedTime = UIManager.Instance.startBreakTime;
                    // Debug.LogError($"lastCheckedTime : {lastCheckedTime}");
                }


            }

            yield return new WaitForSeconds(1);
        }
    }
    #endregion

    #region GETTER_SETTER
    #endregion
}