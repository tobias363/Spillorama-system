using System.Collections;
using System.Collections.Generic;
using BestHTTP.SocketIO;
using TMPro;
using UnityEngine;

public class HallGameListPanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES

    [Header("Game 1")]
    public GameObject Game1List_Prefab;
    public List<GameObject> Game1_Plan_List;

    public Game1PurchaseTicket game1PurchaseTicket;
    public Game1ViewPurchaseTicketUI game1ViewPurchaseTicket;

    #endregion

    #region PRIVATE_VARIABLES
    [Header("Text")]
    [SerializeField] private TextMeshProUGUI txtRecordsNotFound;

    [Header("Transform")]
    [SerializeField] private Transform transformContainer;

    [Header("Prefabs")]
    [SerializeField] private PrefabHallGameListButton prefabHallGameListButton;

    [Header("Panel")]
    [SerializeField] private UtilityLoaderPanel utilityLoaderPanel;

    private List<PrefabHallGameListButton> hallGameList = new List<PrefabHallGameListButton>();    
    float eventRefreshIntervalTime = 10;
    #endregion

    #region UNITY_CALLBACKS
    private void OnEnable()
    {
        GameSocketManager.OnSocketReconnected += Reconnect;
        GameSocketManager.SocketGame1.On(Constants.BroadcastName.refreshUpcomingGames, refreshUpcomingGamesResponce);
    }


    private void refreshUpcomingGamesResponce(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("refreshUpcomingGames Responce : " + packet.ToString());
        RefreshList();
    }

    private void OnDisable()
    {
        GameSocketManager.OnSocketReconnected -= Reconnect;
        GameSocketManager.SocketGame1.Off(Constants.BroadcastName.refreshUpcomingGames);
        CancelInvoke();
    }
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void ClosePanel()
    {
        this.Close();
    }

    public void OpenHallGameList()
    {
        this.Open();
        ResetHallGame();
        // utilityLoaderPanel.ShowLoader();
        RefreshList();
    }

    public void Upcoming_Game_1_List()
    {
        // utilityLoaderPanel.ShowLoader();
        txtRecordsNotFound.Close();
        Clear_Upcoming_Game_List();
        this.Open();

        EventManager.Instance.Game1List(Game1PlanListResponse);
    }

    internal void Game1PlanListResponse(Socket socket, Packet packet, object[] args)
    {
        print($"Game 1 List : {packet}");
        txtRecordsNotFound.gameObject.SetActive(false);
        utilityLoaderPanel.Close();
        UIManager.Instance.game1Panel.game1GamePlayPanel.Close_Panels();

        Clear_Upcoming_Game_List();
        EventResponseList<Game1> response = JsonUtility.FromJson<EventResponseList<Game1>>(Utility.Instance.GetPacketString(packet));

        if (response.status == Constants.EventStatus.SUCCESS)
        {
            GameObject obj;
            int length = response.result.Count;

            for (int i = 0; i < length; i++)
            {
                obj = Instantiate(Game1List_Prefab, transformContainer);
                obj.GetComponent<PrefabGame1UpcomingGame>().Set_Data(response.result[i] , true);
                Game1_Plan_List.Add(obj);
            }
        }
        else
        {
            txtRecordsNotFound.gameObject.SetActive(true);
        }
    }

    void Clear_Upcoming_Game_List()
    {
        int length = Game1_Plan_List.Count;
        for (int i = length - 1; i > -1; i--)
            Destroy(Game1_Plan_List[i]);
        Game1_Plan_List.Clear();
    }

    #endregion

    #region PRIVATE_METHODS
    private void HallGameListResponse(Socket socket, Packet packet, object[] args)
    {
        Debug.Log($"HallGameListResponse: {packet}");
        utilityLoaderPanel.Close();

        EventResponseList<GamePlanRoomData> response = JsonUtility.FromJson<EventResponseList<GamePlanRoomData>>(Utility.Instance.GetPacketString(packet));
        if(response.status == Constants.EventStatus.SUCCESS)
        {
            if (hallGameList.Count != response.result.Count)
                ClearHallGameList();

            txtRecordsNotFound.gameObject.SetActive(response.result.Count == 0);

            foreach(GamePlanRoomData data in response.result)
            {
                PrefabHallGameListButton newHallGameButton = GetHallGameButton(data.gameId);

                if(newHallGameButton == null)
                {
                    newHallGameButton = Instantiate(prefabHallGameListButton, transformContainer);
                    hallGameList.Add(newHallGameButton);
                }
                newHallGameButton.SetData(data);
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
        //Game1Panel game1Panel = UIManager.Instance.game1Panel.isActiveAndEnabled ? UIManager.Instance.game1Panel : UIManager.Instance.splitScreenGameManager.game1Panel;
        //EventManager.Instance.HallGameList(game1Panel.GameId, HallGameListResponse);
        Upcoming_Game_1_List();
    }

    private PrefabHallGameListButton GetHallGameButton(string gameId)
    {
        foreach (PrefabHallGameListButton hallGameButton in hallGameList)
        {
            if (hallGameButton.GameId == gameId)
                return hallGameButton;
        }

        return null;
    }

    private void ResetHallGame()
    {
        if (!this.isActiveAndEnabled)
            this.Open();

        CancelInvoke("RefreshList");
        txtRecordsNotFound.Close();
        ClearHallGameList();
    }

    private void ClearHallGameList()
    {
        foreach (PrefabHallGameListButton hallGame in hallGameList)
            Destroy(hallGame.gameObject);

        hallGameList.Clear();
    }
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    #endregion
}
