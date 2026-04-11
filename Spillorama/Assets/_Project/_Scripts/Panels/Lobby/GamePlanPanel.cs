using System;
using System.Collections.Generic;
using System.Globalization;
using BestHTTP.SocketIO;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class GamePlanPanel : GamePlanTicket
{
    #region PUBLIC_VARIABLES
    #endregion

    #region PRIVATE_VARIABLES

    [Header("Text")]
    [SerializeField] private TextMeshProUGUI txtRecordsNotFound;

    [Header("Buttons")]
    [SerializeField] private Button btnGame1;
    [SerializeField] private Button btnGame2;
    [SerializeField] private Button btnGame3;

    [Header("Transform")]
    [SerializeField] private Transform transformContainer;

    [Header("Prefabs")]
    [SerializeField] private PrefabGamePlan1Ticket prefabGamePlan1Ticket;
    [SerializeField] private PrefabGamePlan2Ticket prefabGamePlan2Ticket;
    [SerializeField] private PrefabGamePlan3Ticket prefabGamePlan3Ticket;

    [Header("Dropdown")]
    [SerializeField] private TMP_Dropdown dropdownHall;

    private List<GamePlanTicket> gamePlanList = new List<GamePlanTicket>();
    private int selectedGameOption = 0;
    private string selectedGameType = "";
    float eventRefreshIntervalTime = 10;

    bool Show_Msg;

    #endregion

    #region UNITY_CALLBACKS    

    private void OnEnable()
    {
        GameSocketManager.OnSocketReconnected += Reconnect;
        RefreshHallListDropdown();
        if (selectedGameOption != 2)
            RefreshGamePlanList();
        EnableBroadcasts();
    }

    private void OnDisable()
    {
        GameSocketManager.OnSocketReconnected -= Reconnect;
        CancelInvoke();
        DisableBroadcasts();
    }
    #endregion

    #region DELEGATE_CALLBACKS    
    #endregion

    #region PUBLIC_METHODS

    public void RefreshGamePlanList()
    {
        if (selectedGameOption == 1)
            OnGame1ButtonTap();
        else if (selectedGameOption == 2)
            OnGame2ButtonTap();
        else if (selectedGameOption == 3)
            OnGame3ButtonTap();
    }

    public void OnGame1ButtonTap()
    {
        /*
        selectedGameType = dropdownHall.options[dropdownHall.value].text;
        selectedGameOption = 1;
        ResetGamePlan();
        btnGame1.interactable = false;
        btnGame1.GetComponentInChildren<TextMeshProUGUI>().color = Utility.Instance.GetYellowColor();
        dropdownHall.Open();
        UIManager.Instance.DisplayLoader(true);
        EventManager.Instance.GamePlanList(1, selectedGameType, GamePlanListResponse);
        //if (selectedGameOption != 1)
            CallGetApprovedHallListEvent();
        */
        Game1();
        // UIManager.Instance.DisplayLoader(true);
    }

    internal void Game1(bool showMsg = true)
    {
        Show_Msg = showMsg;
        GameSocketManager.SetSocketGame1Namespace = "Game1";
        selectedGameType = UIManager.Instance.Player_Hall_ID;
        selectedGameOption = 1;
        btnGame1.interactable = false;
        btnGame1.GetComponentInChildren<TextMeshProUGUI>().color = Utility.Instance.GetYellowColor();
        EventManager.Instance.Game1Room(1, UIManager.Instance.Player_Hall_ID, Game1Room_Response);
    }

    public void OnGame2ButtonTap()
    {
        Game2();
        // UIManager.Instance.DisplayLoader(true);
    }

    internal void Game2(bool showMsg = true)
    {
        Show_Msg = showMsg;
        selectedGameOption = 2;
        btnGame2.interactable = false;
        btnGame2.GetComponentInChildren<TextMeshProUGUI>().color = Utility.Instance.GetYellowColor();
        // UIManager.Instance.DisplayLoader(true);
        EventManager.Instance.Game2Room(2, UIManager.Instance.Player_Hall_ID, Game2Room_Response);
    }

    public void OnGame3ButtonTap()
    {
        //selectedGameOption = 3;
        //ResetGamePlan();
        //btnGame3.interactable = false;
        //btnGame3.GetComponentInChildren<TextMeshProUGUI>().color = Utility.Instance.GetYellowColor();
        //UIManager.Instance.DisplayLoader(true);
        //EventManager.Instance.GamePlanList(3, "", GamePlanListResponse);
        Game3();
    }

    internal void Game3(bool showMsg = true)
    {
        Show_Msg = showMsg;
        selectedGameOption = 3;
        btnGame3.interactable = false;
        btnGame3.GetComponentInChildren<TextMeshProUGUI>().color = Utility.Instance.GetYellowColor();
        // UIManager.Instance.DisplayLoader(true);
        EventManager.Instance.Game3Room(3, UIManager.Instance.Player_Hall_ID, Game3Room_Response);
    }

    #endregion

    #region BROADCAST_HANDLING
    /// <summary>
    /// Enable all required broadcasts, which is usefull for game play
    /// </summary>
    private void EnableBroadcasts()
    {
        GameSocketManager.socketManager.Socket.On(Constants.BroadcastName.GameListRefresh, OnGameListRefresh);
    }

    /// <summary>
    /// Disable all broadcasts
    /// </summary>
    private void DisableBroadcasts()
    {
        GameSocketManager.socketManager.Socket.Off(Constants.BroadcastName.GameListRefresh);
    }

    private void OnGameListRefresh(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("OnGameListRefresh: " + packet.ToString());

        GameListRefresh data = JsonUtility.FromJson<GameListRefresh>(Utility.Instance.GetPacketString(packet));

        if (selectedGameOption == data.gameType)
            RefreshList();
    }
    #endregion

    #region PRIVATE_METHODS
    private void GamePlanListResponse(Socket socket, Packet packet, object[] args)
    {
        Debug.Log($"GamePlanListResponse: {packet}");
        UIManager.Instance.DisplayLoader(false);

        EventResponseList<GamePlanRoomData> response = JsonUtility.FromJson<EventResponseList<GamePlanRoomData>>(Utility.Instance.GetPacketString(packet));
        if (response.status == Constants.EventStatus.SUCCESS)
        {
            if (gamePlanList.Count != response.result.Count)
                ClearGamePlanList();

            txtRecordsNotFound.gameObject.SetActive(response.result.Count == 0);

            foreach (GamePlanRoomData roomData in response.result)
            {
                GamePlanTicket newGamePlanTicket = GetGamePlanTicket(roomData.gameId);

                if (newGamePlanTicket == null)
                {
                    if (selectedGameOption == 1)
                        newGamePlanTicket = Instantiate(prefabGamePlan1Ticket, transformContainer);
                    else if (selectedGameOption == 2)
                        newGamePlanTicket = Instantiate(prefabGamePlan2Ticket, transformContainer);
                    else
                        newGamePlanTicket = Instantiate(prefabGamePlan3Ticket, transformContainer);

                    gamePlanList.Add(newGamePlanTicket);
                }
                newGamePlanTicket.SetData(roomData);
            }
        }
        else
        {
            if (this.isActiveAndEnabled)
                UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
        }

        //if (this.isActiveAndEnabled && UIManager.Instance.gameAssetData.IsLoggedIn)
        if (this.isActiveAndEnabled && UIManager.Instance.gameAssetData.IsLoggedIn && selectedGameOption != 2)
            Invoke(nameof(RefreshList), eventRefreshIntervalTime);
    }

    void Game1Room_Response(Socket socket, Packet packet, object[] args)
    {
        print($"Game 1 : {packet.ToString()}");
        EventResponse<Game1Room> response = JsonUtility.FromJson<EventResponse<Game1Room>>(Utility.Instance.GetPacketString(packet));

        if (response.status.ToLower() == "success")
        {
            Game1Data gameData = new Game1Data();

            bool runningGame = response.result.runningGame.gameId != null;

            //if (response.result.runningGame != null)
            if (runningGame)
            {
                UIManager.Instance.game1Panel.Is_Upcoming_Game = false;
                gameData.SetGame1Data(response.result.runningGame.gameId, response.result.runningGame.gameName, response.result.runningGame.gameType, response.result.runningGame.purchasedTickets, response.result.runningGame.maxPurchaseTicket);
            }
            else if (response.result.upcomingGame.gameId != null)
            {
                UIManager.Instance.game1Panel.Is_Upcoming_Game = true;
                gameData.SetGame1Data(response.result.upcomingGame.gameId, response.result.upcomingGame.gameName, response.result.upcomingGame.gameType, response.result.upcomingGame.purchasedTickets, response.result.upcomingGame.maxPurchaseTicket);
            }
            UIManager.Instance.game1Panel.game1GamePlayPanel.Is_AnyGame_Running = runningGame;
            if (!runningGame)
            {
                UIManager.Instance.game1Panel.game1GamePlayPanel.Upcoming_Game_Data = response.result.upcomingGame;
                UIManager.Instance.splitScreenGameManager.game1Panel.game1GamePlayPanel.Upcoming_Game_Data = response.result.upcomingGame;
                //UIManager.Instance.game1Panel.game1GamePlayPanel.Upcoming_Game1_Ticket_Set_Up(response.result.upcomingGame);
            }
            OpenGame1(gameData);
        }
        else
        {
            UIManager.Instance.DisplayLoader(false);
            UIManager.Instance.topBarPanel.OnGamesButtonTap();
            if (Show_Msg)
                UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
        }
    }

    void OpenGame1(Game1Data gameData)
    {
        GameSocketManager.SetSocketGame1Namespace = "Game1";
        // UIManager.Instance.DisplayLoader(true);
        UIManager.Instance.lobbyPanel.Close();
        UIManager.Instance.CloseAllSubPanels();

        UIManager.Instance.game1Panel.Game_1_Data = gameData;
        UIManager.Instance.splitScreenGameManager.game1Panel.Game_1_Data = gameData;

        if (Utility.Instance.IsSplitScreenSupported)
        {
            if (UIManager.Instance.splitScreenGameManager.game1Panel.isActiveAndEnabled)
                UIManager.Instance.splitScreenGameManager.game1Panel.Close();

            UIManager.Instance.splitScreenGameManager.OpenGamePlay1(GetGameData(), gameData.gameId);
            UIManager.Instance.game1Panel.Close();
        }
        else
        {
            UIManager.Instance.game1Panel.OpenGamePlayPanel(GetGameData(), gameData.gameId);
        }
    }

    void Game2Room_Response(Socket socket, Packet packet, object[] args)
    {
        print("Game2Room_Response: "+packet.ToString());
        EventResponse<Game2Data> response = JsonUtility.FromJson<EventResponse<Game2Data>>(Utility.Instance.GetPacketString(packet));

        if (response.status.ToLower() == "success")
        {
            Debug.Log($"Game2Room ID : {response.result.gameId}");
            UIManager.Instance.isBreak = response.result.isBreak;
            if (response.result.startBreakTime != null && response.result.endBreakTime != null)
            {
                UIManager.Instance.startBreakTime = DateTime.Parse(response.result.startBreakTime, CultureInfo.CurrentCulture);
                UIManager.Instance.endBreakTime = DateTime.Parse(response.result.endBreakTime, CultureInfo.CurrentCulture);
            }
            Debug.Log(response.result.endBreakTime);
            Debug.Log(UIManager.Instance.endBreakTime);
            OpenGame2(response.result);
        }
        else
        {
            UIManager.Instance.DisplayLoader(false);
            UIManager.Instance.topBarPanel.OnGamesButtonTap();
            if (Show_Msg)
                UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
        }
    }

    void OpenGame2(Game2Data gameData)
    {
        GameSocketManager.SetSocketGame2Namespace = "Game2";
        // UIManager.Instance.DisplayLoader(true);
        UIManager.Instance.lobbyPanel.Close();
        UIManager.Instance.CloseAllSubPanels();

        UIManager.Instance.game2Panel.Game_2_Data = gameData;
        UIManager.Instance.splitScreenGameManager.game2Panel.Game_2_Data = gameData;

        if (Utility.Instance.IsSplitScreenSupported)
        {
            if (UIManager.Instance.splitScreenGameManager.game2Panel.isActiveAndEnabled)
                UIManager.Instance.splitScreenGameManager.game2Panel.Close();

            UIManager.Instance.splitScreenGameManager.OpenGamePlay2(GetGameData(), gameData.gameId);
            UIManager.Instance.game2Panel.Close();
        }
        else
        {
            UIManager.Instance.game2Panel.OpenGamePlayPanel(GetGameData(), gameData.gameId);
        }
    }

    void Game3Room_Response(Socket socket, Packet packet, object[] args)
    {
        print("Game3Room_Response: " + packet.ToString());
        EventResponse<Game3Data> response = JsonUtility.FromJson<EventResponse<Game3Data>>(Utility.Instance.GetPacketString(packet));
        UIManager.Instance.topBarPanel.miniGamePlanPanel.ClosePanel();
        UIManager.Instance.DisplayLoader(false);
        if (response.status.ToLower() == "success")
        {
            Debug.Log($"Game3Room ID : {response.result.gameId}");
            UIManager.Instance.isBreak = response.result.isBreak;
            if (response.result.startBreakTime != null && response.result.endBreakTime != null)
            {
                UIManager.Instance.startBreakTime = DateTime.Parse(response.result.startBreakTime, CultureInfo.CurrentCulture);
                UIManager.Instance.endBreakTime = DateTime.Parse(response.result.endBreakTime, CultureInfo.CurrentCulture);
            }
            OpenGame3(response.result);
        }
        else
        {
            UIManager.Instance.topBarPanel.OnGamesButtonTap();
            if (Show_Msg)
                UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
        }
    }

    void OpenGame3(Game3Data gameData)
    {
        GameSocketManager.SetSocketGame3Namespace = "Game3";
        // UIManager.Instance.DisplayLoader(true);
        UIManager.Instance.lobbyPanel.Close();
        UIManager.Instance.CloseAllSubPanels();

        UIManager.Instance.game3Panel.Game_3_Data = gameData;
        UIManager.Instance.splitScreenGameManager.game3Panel.Game_3_Data = gameData;
        if (Utility.Instance.IsSplitScreenSupported)
        {
            if (UIManager.Instance.splitScreenGameManager.game3Panel.isActiveAndEnabled)
                UIManager.Instance.splitScreenGameManager.game3Panel.Close();

            UIManager.Instance.splitScreenGameManager.OpenGamePlay3(GetGameData(), gameData.gameId);
            UIManager.Instance.game3Panel.Close();
        }
        else
        {
            UIManager.Instance.game3Panel.OpenGamePlayPanel(GetGameData(), gameData.gameId);
        }
    }

    private void Reconnect()
    {
        CancelInvoke();
        RefreshList();
    }

    public void RefreshList()
    {
        if (selectedGameOption == 2)
            EventManager.Instance.Game2PlanList(2, UIManager.Instance.Player_Hall_ID, UIManager.Instance.topBarPanel.miniGamePlanPanel.Game2PlanListResponse);
        else
            EventManager.Instance.GamePlanList(selectedGameOption, selectedGameOption == 1 ? selectedGameType : "", GamePlanListResponse);
    }

    private GamePlanTicket GetGamePlanTicket(string gameId)
    {
        foreach (GamePlanTicket gamePlan in gamePlanList)
        {
            if (gamePlan.GameId == gameId)
                return gamePlan;
        }

        return null;
    }

    private void RefreshHallListDropdown(bool refreshCurrentValue = true)
    {
        dropdownHall.ClearOptions();
        List<string> hallNameList = new List<string>();
        hallNameList.Add("All");
        foreach (string hallName in UIManager.Instance.gameAssetData.HallList)
        {
            hallNameList.Add(hallName);
        }
        dropdownHall.AddOptions(hallNameList);

        if (refreshCurrentValue)
            dropdownHall.value = 0;
    }

    private void ResetGamePlan()
    {
        if (!this.isActiveAndEnabled)
            this.Open();

        btnGame1.interactable = true;
        btnGame2.interactable = true;
        btnGame3.interactable = true;

        btnGame1.GetComponentInChildren<TextMeshProUGUI>().color = Color.white;
        btnGame2.GetComponentInChildren<TextMeshProUGUI>().color = Color.white;
        btnGame3.GetComponentInChildren<TextMeshProUGUI>().color = Color.white;

        CancelInvoke("RefreshList");
        dropdownHall.Close();
        txtRecordsNotFound.Close();
        ClearGamePlanList();
    }

    private void CallGetApprovedHallListEvent()
    {
        EventManager.Instance.GetApprovedHallList((socket, packet, args) =>
        {
            Debug.Log("GetApprovedHallList: " + packet.ToString());
            EventResponseList<string> response = JsonUtility.FromJson<EventResponseList<string>>(Utility.Instance.GetPacketString(packet));
            //if (response.result.Count > 0)
            //{
            bool update = false;
            if (UIManager.Instance.gameAssetData.HallList.Count == response.result.Count)
            {
                List<string> hallList = UIManager.Instance.gameAssetData.HallList;
                for (int i = 0; i < hallList.Count; i++)
                {
                    if (hallList[i] != response.result[i])
                    {
                        update = true;
                    }
                }
            }
            else
                update = true;

            if (update)
            {
                UIManager.Instance.gameAssetData.HallList = response.result;
                RefreshHallListDropdown(false);
            }
            //}
        });
    }

    private void DisplayDummyList(GameObject prefab, int count = 2)
    {
        ClearGamePlanList();

        //for (int i=0; i< count; i++)
        //{
        //    GameObject newObject = Instantiate(prefab, transformContainer);
        //    gamePlanList.Add(newObject);
        //}
    }

    private void ClearGamePlanList()
    {
        foreach (GamePlanTicket gamePlan in gamePlanList)
            Destroy(gamePlan.gameObject);

        gamePlanList.Clear();
    }

    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    #endregion
}
