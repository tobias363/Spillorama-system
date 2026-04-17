using BestHTTP.SocketIO;
using I2.Loc;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class Game1Panel : MonoBehaviour
{
    #region PUBLIC_VARIABLES

    public Game1Data Game_1_Data;

    [Header("Panels")]
    public Game1TicketPurchasePanel game1TicketPurchasePanel;
    public Game1GamePlayPanel game1GamePlayPanel;

    [Header("Image")]
    [SerializeField] private Image imgBackground;

    [Header("Tickets Buy Data")]
    public string Blind_GameID;
    public int Blind_Lucky_Number;
    public List<Game1TicketPurchase> Blind_Tickets;

    internal bool Is_Upcoming_Game;

    #endregion

    #region PRIVATE_VARIABLES
    private GameData gameData = new GameData();
    #endregion

    #region UNITY_CALLBACKS
    private void OnEnable()
    {
        GameBackgroundId = PlayerPrefs.GetInt("Game_Background", 0);
    }
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void OpenTicketPurchasePanel(GameData gameData)
    {
        GameBackgroundId = PlayerPrefs.GetInt("Game_Background", 0);

        this.gameData = gameData;
        Reset();
        this.Open();

        if (game1TicketPurchasePanel)
            game1TicketPurchasePanel.OpenPanel(gameData);
    }

    public void OpenTicketPurchasePanel(GameData gameData, Game1PurchaseDataResponse result)
    {
        GameBackgroundId = PlayerPrefs.GetInt("Game_Background", 0);

        this.gameData = gameData;
        Reset();
        this.Open();

        if (game1TicketPurchasePanel)
            game1TicketPurchasePanel.OpenPanel(gameData, result);
    }

    public void OpenGamePlayPanel(GameData gameData)
    {
        if (GameId != gameData.gameId)
            GameBackgroundId = PlayerPrefs.GetInt("Game_Background", 0);

        this.gameData = gameData;
        Reset();
        this.Open();
        game1GamePlayPanel.OpenPanel(gameData, gameData.gameId);
    }

    public void OpenGamePlayPanel(GameData gameData, string gameID)
    {
        if (GameId != gameData.gameId)
            GameBackgroundId = PlayerPrefs.GetInt("Game_Background", 0);

        this.gameData = gameData;
        Reset();
        this.Open();
        game1GamePlayPanel.OpenPanel(gameData, gameID);
    }

    public void ClosePanel()
    {
        Transform transformLobbyPanel = UIManager.Instance.lobbyPanel.transform;
        this.transform.SetParent(transformLobbyPanel.parent);
        this.transform.SetSiblingIndex(transformLobbyPanel.GetSiblingIndex() + 1);
        Utility.Instance.StretchAllZero(this.GetComponent<RectTransform>());
        this.Close();
    }
    #endregion

    #region Upcoimg Game Ticket Purchase

    public void Upcoming_Game_Ticket_Purchase_Submit_Btn()
    {
        List<Game1TicketPurchase> tickets = new List<Game1TicketPurchase>();
        int length = game1GamePlayPanel.Upcoming_Game_Tickets.Count;
        for (int i = 0; i < length; i++)
        {
            //print($"{game1GamePlayPanel.Upcoming_Game_Tickets[i].Ticket_Name_Txt.text} : {game1GamePlayPanel.Upcoming_Game_Tickets[i].Number_Of_Tickets_To_Buy}");
            if (game1GamePlayPanel.Upcoming_Game_Tickets[i].Number_Of_Tickets_To_Buy > 0)
                tickets.Add(new Game1TicketPurchase(game1GamePlayPanel.Upcoming_Game_Tickets[i].Ticket_Name_Txt.text, game1GamePlayPanel.Upcoming_Game_Tickets[i].Number_Of_Tickets_To_Buy));
        }

        Set_Game_1_Purchase_Data(Game_1_Data.gameId, 0, tickets);
        Open_Buy_Option();
    }

    internal void Check_Max_Tickets()
    {
        int tickets = Game_1_Data.purchasedTickets;
        double ticketTotalCounts = 0;
        double NumberOfTicketsBuy = 0;
        int length = game1GamePlayPanel.Upcoming_Game_Tickets.Count;

        for (int i = 0; i < length; i++)
        {
            tickets += (game1GamePlayPanel.Upcoming_Game_Tickets[i].Number_Of_Tickets_To_Buy * game1GamePlayPanel.Upcoming_Game_Tickets[i].Ticket_Weight);
            ticketTotalCounts += game1GamePlayPanel.Upcoming_Game_Tickets[i].Number_Of_Tickets_To_Buy * game1GamePlayPanel.Upcoming_Game_Tickets[i].Price_Per_Ticket;
            NumberOfTicketsBuy += game1GamePlayPanel.Upcoming_Game_Tickets[i].Number_Of_Tickets_To_Buy;
        }

        var localManager = game1GamePlayPanel.Upcoming_Game_Buy_Ticket_Txt.GetComponent<LocalizationParamsManager>();
        localManager.SetParameterValue("Tickets", NumberOfTicketsBuy.ToString());
        localManager.SetParameterValue("TotalCost", ticketTotalCounts.ToString());

        if (tickets > 0)
            game1GamePlayPanel.Btn_Upcoming_Game_Buy_Tickets.interactable = true;
        else
            game1GamePlayPanel.Btn_Upcoming_Game_Buy_Tickets.interactable = false;

        int remaining_Tickets = Game_1_Data.maxPurchaseTicket - tickets;
        for (int i = 0; i < length; i++)
            game1GamePlayPanel.Upcoming_Game_Tickets[i].Increase_Btn.interactable = game1GamePlayPanel.Upcoming_Game_Tickets[i].Ticket_Weight <= remaining_Tickets;
    }

    internal void Set_Game_1_Purchase_Data(string gameID, int lucky_Number, List<Game1TicketPurchase> tickets)
    {
        Blind_GameID = gameID;
        Blind_Tickets = tickets;
        Blind_Lucky_Number = lucky_Number == 0 && UIManager.Instance.settingPanel.Game_1_Lucky_Number_TG.isOn ? UIManager.Instance.settingPanel.Game_1_Lucky_Number : lucky_Number;
    }

    internal void Open_Buy_Option()
    {
        UIManager.Instance.game1Panel.game1GamePlayPanel.Btn_Upcoming_Game_Buy_Tickets.interactable = false;
        EventManager.Instance.Blind_PurchaseGame1Tickets(Blind_GameID, Blind_Lucky_Number, Blind_Tickets, "realMoney", "");

        //UIManager.Instance.selectPurchaseTypePanel.Open(GameSocketManager.SocketGame1);

        //UIManager.Instance.selectPurchaseTypePanel.eventPurchaseByPoints.AddListener((string voucherCode) => {
        //    EventManager.Instance.Blind_PurchaseGame1Tickets(Blind_GameID, Blind_Lucky_Number, Blind_Tickets, "points", voucherCode);
        //});

        //UIManager.Instance.selectPurchaseTypePanel.eventPurchaseByRealMoney.AddListener((string voucherCode) => {
        //    EventManager.Instance.Blind_PurchaseGame1Tickets(Blind_GameID, Blind_Lucky_Number, Blind_Tickets, "realMoney", voucherCode);
        //});

        //UIManager.Instance.selectPurchaseTypePanel.eventPurchaseByTodaysBalance.AddListener((string voucherCode) => {
        //    EventManager.Instance.Blind_PurchaseGame1Tickets(Blind_GameID, Blind_Lucky_Number, Blind_Tickets, "realMoney", voucherCode);
        //});
    }

    #endregion

    #region PRIVATE_METHODS
    private void Reset()
    {
        if (game1TicketPurchasePanel)
            game1TicketPurchasePanel.Close();
        game1GamePlayPanel.Close();
    }
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER

    public int GameBackgroundId
    {
        set
        {
            PlayerPrefs.SetInt("Game_Background", value);
            imgBackground.sprite = UIManager.Instance.GetBackgroundSprite(value);
        }
    }

    public string GameId
    {
        get
        {
            return gameData.gameId;
        }
    }

    public Sprite BackgroundSprite
    {
        get
        {
            return imgBackground.sprite;
        }
    }

    #endregion
}