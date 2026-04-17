using System.Collections;
using System.Collections.Generic;
using BestHTTP.SocketIO;
using TMPro;
using UnityEngine;

public class MiniGamePlanPanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES

    [Header("Game 2")]
    public GameObject Game2List_Prefab;
    public List<GameObject> Game2_Plan_List;

    [Header("Game 3")]
    public GameObject Game3List_Prefab;
    public List<GameObject> Game3_Plan_List;

    public RectTransform gamePlanListingPopup;

    #endregion

    #region PRIVATE_VARIABLES
    [Header("Text")]
    [SerializeField] private TextMeshProUGUI txtRecordsNotFound;

    [Header("Transform")]
    [SerializeField] private Transform transformContainer;

    [Header("Prefabs")]
    [SerializeField] private PrefabGamePlan1Ticket miniPrefabGamePlan1Ticket;
    [SerializeField] private PrefabGamePlan2Ticket miniPrefabGamePlan2Ticket;
    [SerializeField] private PrefabGamePlan3Ticket miniPrefabGamePlan3Ticket;

    [Header("Dropdown")]
    [SerializeField] private TMP_Dropdown dropdownHall;

    [Header("Panel")]
    [SerializeField] private UtilityLoaderPanel utilityLoaderPanel;

    private List<GamePlanTicket> gamePlanList = new List<GamePlanTicket>();
    private int selectedGameOption = 1;
    private string selectedGameType = "";
    float eventRefreshIntervalTime = 10;
    #endregion

    #region UNITY_CALLBACKS
    private void Awake()
    {
        RefreshHallListDropdown();
    }

    private void RefreshHallListDropdown()
    {
        dropdownHall.ClearOptions();
        List<string> hallNameList = new List<string>();
        hallNameList.Add("All");
        foreach (HallData hallData in UIManager.Instance.gameAssetData.hallDataList)
        {
            if (hallData.status == "approved")
                hallNameList.Add(hallData.name);
        }
        dropdownHall.AddOptions(hallNameList);
        dropdownHall.value = 0;
    }

    private void OnEnable()
    {
        GameSocketManager.OnSocketReconnected += Reconnect;
    }

    private void OnDisable()
    {
        GameSocketManager.OnSocketReconnected -= Reconnect;
        CancelInvoke();
    }
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void RefreshGamePlanList()
    {
        if (selectedGameOption == 1)
            OpenGame1List();
        else if (selectedGameOption == 2)
            OpenGame2List();
        else
            OpenGame3List();
    }

    public void OpenPanel()
    {
        this.Open();

        if (UIManager.Instance.game1Panel.isActiveAndEnabled)
        {
            OpenGame1List();
        }
        //else if(UIManager.Instance.game2Panel.game2PlayPanel.isActiveAndEnabled)
        else if (UIManager.Instance.game2Panel.isActiveAndEnabled)
        {
            OpenGame2List();
        }
        else if (UIManager.Instance.game3Panel.game3GamePlayPanel.isActiveAndEnabled)
        {
            OpenGame3List();
        }
    }

    public void ClosePanel()
    {
        this.Close();
    }

    public void OpenGame1List()
    {
        UIManager.Instance.topBarPanel.OnHallGameListPanelButtonTap();
        /*
        selectedGameType = dropdownHall.options[dropdownHall.value].text;
        selectedGameOption = 1;
        ResetGamePlan();
        utilityLoaderPanel.ShowLoader();
        print("Mini Open Game 1");
        //EventManager.Instance.GamePlanList(1, selectedGameType, GamePlanListResponse);
        EventManager.Instance.Game1List(Game1PlanListResponse);
        */
    }

    internal void Game1PlanListResponse(Socket socket, Packet packet, object[] args)
    {
        /*
        print($"Game 1 List : {packet}");
        txtRecordsNotFound.gameObject.SetActive(false);
        utilityLoaderPanel.Close();

        Clear_Upcoming_Game_List();
        EventResponseList<Game1> response = JsonUtility.FromJson<EventResponseList<Game1>>(Utility.Instance.GetPacketString(packet));

        if (response.status == Constants.EventStatus.SUCCESS)
        {
            GameObject obj;
            int length = response.result.Count;

            for (int i = 0; i < length; i++)
            {
                obj = Instantiate(Game1List_Prefab, transformContainer);
                obj.GetComponent<PrefabGame1UpcomingGame>().Set_Data(response.result[i]);
                Game1_Plan_List.Add(obj);
            }
        }
        else
        {
            txtRecordsNotFound.gameObject.SetActive(true);
        }
        */
    }

    public void OpenGame2List()
    {
        selectedGameOption = 2;
        ResetGamePlan();
        utilityLoaderPanel.ShowLoader();
        EventManager.Instance.Game2List(Game2PlanListResponse);
        //EventManager.Instance.GamePlanList(2, "", GamePlanListResponse);
    }

    internal void Game2PlanListResponse(Socket socket, Packet packet, object[] args)
    {
        print($"Game 2 List : {packet}");
        txtRecordsNotFound.gameObject.SetActive(false);
        utilityLoaderPanel.Close();

        Clear_Upcoming_Game_List();

        EventResponse<Game2PlanList> response = JsonUtility.FromJson<EventResponse<Game2PlanList>>(Utility.Instance.GetPacketString(packet));
        if (response.status == Constants.EventStatus.SUCCESS)
        {
            GameObject obj;
            int length = response.result.upcomingGames.Count;

            for (int i = 0; i < length; i++)
            {
                obj = Instantiate(Game2List_Prefab, transformContainer);
                obj.GetComponent<PrefabGame2UpcomingGames>().Set_Data(response.result.upcomingGames[i], true);
                Game2_Plan_List.Add(obj);
            }
        }
        else
        {
            txtRecordsNotFound.gameObject.SetActive(true);
        }
    }

    public void OpenGame3List()
    {
        selectedGameOption = 3;
        ResetGamePlan();
        utilityLoaderPanel.ShowLoader();
        EventManager.Instance.Game3List(Game3PlanListResponse);
    }

    internal void Game3PlanListResponse(Socket socket, Packet packet, object[] args)
    {
        print($"Game 3 List : {packet}");
        txtRecordsNotFound.gameObject.SetActive(false);
        utilityLoaderPanel.Close();

        Clear_Upcoming_Game_List();

        EventResponse<Game3PlanList> response = JsonUtility.FromJson<EventResponse<Game3PlanList>>(Utility.Instance.GetPacketString(packet));
        if (response.status == Constants.EventStatus.SUCCESS)
        {
            GameObject obj;
            int length = response.result.upcomingGames.Count;

            for (int i = 0; i < length; i++)
            {
                obj = Instantiate(Game3List_Prefab, transformContainer);
                obj.GetComponent<PrefabGame3UpcomingGame>().Set_Data(response.result.upcomingGames[i], true);
                Game3_Plan_List.Add(obj);
            }
        }
        else
        {
            txtRecordsNotFound.gameObject.SetActive(true);
        }
    }

    void Clear_Upcoming_Game_List()
    {
        int length = Game2_Plan_List.Count;
        for (int i = length - 1; i > -1; i--)
            Destroy(Game2_Plan_List[i]);
        Game2_Plan_List.Clear();

        length = Game3_Plan_List.Count;
        for (int i = length - 1; i > -1; i--)
            Destroy(Game3_Plan_List[i]);
        Game3_Plan_List.Clear();
    }

    #endregion

    #region PRIVATE_METHODS
    private void GamePlanListResponse(Socket socket, Packet packet, object[] args)
    {
        Debug.Log($"GamePlanListResponse: {packet}");
        utilityLoaderPanel.Close();

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
                        newGamePlanTicket = Instantiate(miniPrefabGamePlan1Ticket, transformContainer);
                    else if (selectedGameOption == 2)
                        newGamePlanTicket = Instantiate(miniPrefabGamePlan2Ticket, transformContainer);
                    else
                        newGamePlanTicket = Instantiate(miniPrefabGamePlan3Ticket, transformContainer);

                    gamePlanList.Add(newGamePlanTicket);
                }
                newGamePlanTicket.SetData(roomData);
            }
        }
        else
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
        }

        Invoke("RefreshList", eventRefreshIntervalTime);
    }

    private void Reconnect()
    {
        CancelInvoke();
        RefreshList();
    }

    public void RefreshList()
    {
        if (selectedGameOption == 2)
        {
            UIManager.Instance.topBarPanel.miniGamePlanPanel.Close();
        }
        else
        {
            EventManager.Instance.GamePlanList(selectedGameOption, selectedGameOption == 1 ? selectedGameType : "", GamePlanListResponse);
        }
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

    private void ResetGamePlan()
    {
        if (!this.isActiveAndEnabled)
            this.Open();

        CancelInvoke("RefreshList");
        txtRecordsNotFound.Close();
        ClearGamePlanList();
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
