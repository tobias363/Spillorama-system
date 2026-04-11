using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using TMPro;
using BestHTTP.SocketIO;
using I2.Loc;

public class Game1PurchaseTicket : MonoBehaviour
{
    #region Variables

    public Game1 Game_Data;

    public TMP_Text Game_Name_Txt, Tickets_Purchased_Txt, Tickets_Buy_Txt;
    public Button Tickets_Purchased_Btn, Ticket_Buy_Btn;

    public Transform Ticket_Parent;
    public Game1UpcomingGameTicketData Ticket_Prefab;
    public List<Game1UpcomingGameTicketData> Tickets_List;

    public GameObject Upcoming_Game_Ticket_Devider;

    public List<GameObject> DeviderObjects;
    #endregion

    internal void Open_Ticket_Buy_UI(Game1 gameData)
    {
        Game_Data = gameData;

        Game_Name_Txt.text = Game_Data.gameName;
        Ticket_Buy_Btn.interactable = false;
        Tickets_Purchased_Txt.text = $"Ticket purchased : {gameData.purchasedTickets}";

      //  Tickets_Buy_Txt.GetComponent<LocalizationParamsManager>().SetParameterValue("TicketPurchased", game.purchasedTickets.ToString());

        Tickets_Purchased_Btn.interactable = gameData.purchasedTickets > 0;
        CreateTickets(gameData.ticketTypes);
        gameObject.SetActive(true);
    }

    void CreateTickets(List<Game1_TicketType> tickets)
    {
        int length = Tickets_List.Count;
        for (int i = 0; i < length; i++)
            Destroy(Tickets_List[i].gameObject);
        Tickets_List.Clear();       
        
        
        for (int i = 0; i < DeviderObjects.Count; i++)
            Destroy(DeviderObjects[i].gameObject);
        DeviderObjects.Clear();


        Game1UpcomingGameTicketData ticket;
        length = tickets.Count;
        for (int i = 0; i < length; i++)
        {

            GameObject DevObject = Instantiate(Upcoming_Game_Ticket_Devider, Vector3.zero, Quaternion.identity, Ticket_Parent);
            DeviderObjects.Add(DevObject);
            ticket = Instantiate(Ticket_Prefab, Ticket_Parent);
            Tickets_List.Add(ticket);
            ticket.Set_Data(tickets[i], Game_Data.gameType == "traffic-light" ? 3 : Game_Data.gameType == "elvis" ? 2 : Game_Data.gameType == "color" ? tickets[i].name.ToLower().Contains("large") ? 3 : 1 : 1);
            ticket.RT.anchoredPosition = new Vector2(0f, -((i * ticket.RT.rect.height) + (i * 10f) + 10f));
        }

    }

    internal void Check_Max_Tickets()
    {
        int tickets = Game_Data.purchasedTickets;
        double ticketTotalCounts = 0;
        double NumberOfTicketsBuy = 0;
        int length = Tickets_List.Count;
        for (int i = 0; i < length; i++)
        {
            tickets += (Tickets_List[i].Number_Of_Tickets_To_Buy * Tickets_List[i].Ticket_Weight);
            ticketTotalCounts += Tickets_List[i].Number_Of_Tickets_To_Buy * Tickets_List[i].Price_Per_Ticket;
            NumberOfTicketsBuy += Tickets_List[i].Number_Of_Tickets_To_Buy;
        }


        var localManager = Tickets_Buy_Txt.GetComponent<LocalizationParamsManager>();
        localManager.SetParameterValue("Tickets", NumberOfTicketsBuy.ToString());
        localManager.SetParameterValue("TotalCost", ticketTotalCounts.ToString());

        Ticket_Buy_Btn.interactable = tickets - Game_Data.purchasedTickets > 0;

        int remaining_Tickets = Game_Data.maxPurchaseTicket - tickets;
        for (int i = 0; i < length; i++)
        {
            Tickets_List[i].Increase_Btn.interactable = Tickets_List[i].Ticket_Weight <= remaining_Tickets;
        }

        //Debug.LogError("Check_Max_Tickets");
        //Debug.LogError("Check_Max_Tickets : tickets" + tickets);
    }

    public void Back_Btn()
    {
        gameObject.SetActive(false);
        UIManager.Instance.topBarPanel.OnHallGameListPanelButtonTap();
    }

    public void Buy_Tickets_Btn()
    {
        List<Game1TicketPurchase> tickets = new List<Game1TicketPurchase>();
        int length = Tickets_List.Count;
        for (int i = 0; i < length; i++)
        {
            print($"{Tickets_List[i].Ticket_Name_Txt.text} : {Tickets_List[i].Number_Of_Tickets_To_Buy}");
            if (Tickets_List[i].Number_Of_Tickets_To_Buy > 0)
                tickets.Add(new Game1TicketPurchase(Tickets_List[i].Ticket_Name_Txt.text, Tickets_List[i].Number_Of_Tickets_To_Buy));
        }

        UIManager.Instance.game1Panel.Set_Game_1_Purchase_Data(Game_Data.gameId, Game_Data.luckyNumber, tickets);
        UIManager.Instance.game1Panel.Open_Buy_Option();
    }

    public void View_Purchased_Ticket()
    {
        // UIManager.Instance.DisplayLoader(true);
        EventManager.Instance.View_Game_1_Purchased_Tickets(Game_Data.gameId, (Socket socket, Packet packet, object[] args) =>
        {
            print($"ViewPurchasedTickets response : {packet.ToString()}");

            EventResponseList<Game1TicketView> response = JsonUtility.FromJson<EventResponseList<Game1TicketView>>(Utility.Instance.GetPacketString(packet));
            UIManager.Instance.topBarPanel.hallGameListPanel.game1ViewPurchaseTicket.Open_Game_1_View_Purchased_Ticket_UI(response.result, Game_Data.gameType, Game_Data.gameId, Game_Data.replaceAmount);
            UIManager.Instance.DisplayLoader(false);
        });
    }

}
