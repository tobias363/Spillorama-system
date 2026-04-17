using System.Collections.Generic;
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

    bool Show_Msg;

    #endregion

    #region UNITY_CALLBACKS    

    private void OnEnable()
    {
        // In WebGL/Spillorama mode, game entry is handled by the web shell — not this panel.
        if (UIManager.Instance != null && UIManager.Instance.isGameWebGL)
        {
            txtRecordsNotFound.gameObject.SetActive(true);
            return;
        }

        RefreshHallListDropdown();
        if (selectedGameOption != 2)
            RefreshGamePlanList();
    }

    private void OnDisable()
    {
        CancelInvoke();
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
        Game1();
    }

    internal void Game1(bool showMsg = true)
    {
        Show_Msg = showMsg;
        selectedGameType = UIManager.Instance.Player_Hall_ID;
        selectedGameOption = 1;
        btnGame1.interactable = false;
        btnGame1.GetComponentInChildren<TextMeshProUGUI>().color = Utility.Instance.GetYellowColor();

        // Spillorama path: open game panel directly.
        // CallSubscribeRoom in SocketFlow will populate data via SpilloramaGameBridge.
        Game1Data gameData = new Game1Data();
        gameData.gameId = "spillorama-room";
        gameData.gameName = "Bingo";
        gameData.gameType = "1";
        OpenGame1(gameData);
    }

    public void OnGame2ButtonTap()
    {
        Game2();
    }

    internal void Game2(bool showMsg = true)
    {
        Show_Msg = showMsg;
        selectedGameOption = 2;
        btnGame2.interactable = false;
        btnGame2.GetComponentInChildren<TextMeshProUGUI>().color = Utility.Instance.GetYellowColor();

        Game2Data gameData = new Game2Data();
        gameData.gameId = "spillorama-room";
        gameData.gameName = "Rocket Bingo";
        OpenGame2(gameData);
    }

    public void OnGame3ButtonTap()
    {
        Game3();
    }

    internal void Game3(bool showMsg = true)
    {
        Show_Msg = showMsg;
        selectedGameOption = 3;
        btnGame3.interactable = false;
        btnGame3.GetComponentInChildren<TextMeshProUGUI>().color = Utility.Instance.GetYellowColor();

        Game3Data gameData = new Game3Data();
        gameData.gameId = "spillorama-room";
        gameData.gameName = "Monster Bingo";
        OpenGame3(gameData);
    }

    #endregion

    #region BROADCAST_HANDLING
    // AIS broadcast handling removed — Spillorama uses SpilloramaGameBridge events.
    #endregion

    #region PRIVATE_METHODS

    void OpenGame1(Game1Data gameData)
    {
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

    void OpenGame2(Game2Data gameData)
    {
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

    void OpenGame3(Game3Data gameData)
    {
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

    public void RefreshList()
    {
        // AIS socket refresh removed — Spillorama backend pushes updates via SpilloramaGameBridge.
        Debug.Log("[GamePlanPanel] RefreshList: no-op (Spillorama path)");
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

    // CallGetApprovedHallListEvent removed — hall list is managed by the Spillorama web shell.

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
