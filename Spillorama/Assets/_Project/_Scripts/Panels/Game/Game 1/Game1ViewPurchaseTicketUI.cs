using System.Collections;
using System.Collections.Generic;
using UnityEngine;

[System.Serializable]
public class View_Ticket_Data
{
    public string Ticket_Number, ID;
    public int Price;
    public List<int> Bingo_Numbers;

    public View_Ticket_Data() { }
    public View_Ticket_Data(string id, string ticket_Number, int price, List<int> bingo_Number)
    {
        ID = id;
        Ticket_Number = ticket_Number;
        Price = price;
        Bingo_Numbers = bingo_Number;
    }
}

public class Game1ViewPurchaseTicketUI : MonoBehaviour
{
    #region Variables

    public RectTransform View_Ticket_Parent;
    public string Game_ID;

    public Game1ViewPurchaseTicket View_Single_Ticket_Prefab;
    public Game1ViewPurchaseThreeTickets View_Three_Tickets_Prefab;
    public Game1ViewPurchaseElvisTicket View_Elvis_Tickets_Prefab;

    public List<GameObject> Tickets;

    float x = 10f, y = -10f;
    Game1ViewPurchaseTicket Single_Ticket;
    Game1ViewPurchaseThreeTickets Three_Tickets;
    Game1ViewPurchaseElvisTicket Elvis_Ticket;

    [Header("Replace Elvis Tickets")]
    public int Replace_Amount;
    public string Elvis_Replace_Ticket_Id1, Elvis_Replace_Ticket_Id2;

    #endregion

    #region Unity Methods

    void OnDisable()
    {
        Game_ID = UIManager.Instance.game1Panel.Game_1_Data.gameId;
        Replace_Amount = UIManager.Instance.game1Panel.game1GamePlayPanel.Replace_Amount;
    }

    #endregion

    #region View Tickets

    internal void Open_Game_1_View_Purchased_Ticket_UI(List<Game1TicketView> tickets, string gameType, string gameId, int amount)
    {
        Game_ID = gameId;
        int length = Tickets.Count;
        for (int i = 0; i < length; i++)
            Destroy(Tickets[i]);
        Tickets.Clear();

        Replace_Amount = amount;

        x = 10f;
        y = -10f;

        switch (gameType)
        {
            case "color":
                Color_Game_Tickets(tickets);
                break;
            case "traffic-light":
                Traffic_Light_Tickets(tickets);
                break;
            case "elvis":
                Elvis_Game_Tickets(tickets);
                break;
        }

        View_Ticket_Parent.sizeDelta = new Vector2(View_Ticket_Parent.rect.width, Mathf.Abs(Tickets[^1].GetComponent<RectTransform>().anchoredPosition.y - Tickets[^1].GetComponent<RectTransform>().rect.height - 10f));
        View_Ticket_Parent.anchoredPosition = Vector2.zero;

        gameObject.SetActive(true);
    }

    void Color_Game_Tickets(List<Game1TicketView> tickets)
    {
        int length = tickets.Count;
        //List<Game1TicketView> mini_tickets = new List<Game1TicketView>();
        for (int i = 0; i < length; i++)
        {
            Add_Single_Ticket(tickets[i]);
            //if (tickets[i].ticketColor.ToLower().Contains("small"))
            //    Add_Single_Ticket(tickets[i]);
            //else if (tickets[i].ticketColor.ToLower().Contains("large"))
            //{
            //    mini_tickets.Clear();
            //    for (int j = 0; j < 3; j++)
            //        mini_tickets.Add(tickets[i + j]);
            //    Add_Three_Tickets(mini_tickets);
            //    i += 2;
            //}
        }
    }

    void Traffic_Light_Tickets(List<Game1TicketView> tickets)
    {
        int length = tickets.Count;
        //List<Game1TicketView> mini_tickets = new List<Game1TicketView>();
        //for (int i = 0; i < length; i += 3)
        for (int i = 0; i < length; i++)
        {
            Add_Single_Ticket(tickets[i]);
            //mini_tickets.Clear();
            //for (int j = 0; j < 3; j++)
            //    mini_tickets.Add(tickets[i + j]);
            //Add_Three_Tickets(mini_tickets);
        }
    }

    void Add_Single_Ticket(Game1TicketView ticket)
    {
        Single_Ticket = Instantiate(View_Single_Ticket_Prefab, View_Ticket_Parent);
        Single_Ticket.Set_Ticket(new View_Ticket_Data(ticket.id, ticket.ticketNumber, ticket.ticketPrice, ticket.ticketCellNumberList), TicketColorManager.Instance.Get_Ticket_Color(ticket.ticketColor));
        Tickets.Add(Single_Ticket.gameObject);
        Get_XY(Single_Ticket.RT);
        Single_Ticket.RT.anchoredPosition = new Vector2(x, y);
        x += Single_Ticket.RT.rect.width + 10f;
    }

    void Add_Three_Tickets(List<Game1TicketView> tickets)
    {
        Three_Tickets = Instantiate(View_Three_Tickets_Prefab, View_Ticket_Parent);
        List<View_Ticket_Data> mini_Tickets = new List<View_Ticket_Data>();
        List<Tickets_Color> ticket_Colors = new List<Tickets_Color>();
        int length = tickets.Count;
        for (int i = 0; i < length; i++)
        {
            mini_Tickets.Add(new View_Ticket_Data(tickets[i].id, tickets[i].ticketNumber, tickets[i].ticketPrice, tickets[i].ticketCellNumberList));
            ticket_Colors.Add(TicketColorManager.Instance.Get_Ticket_Color(tickets[i].ticketColor));
        }
        Three_Tickets.Set_Data(mini_Tickets, ticket_Colors);
        Tickets.Add(Three_Tickets.gameObject);
        Get_XY(Three_Tickets.RT);
        Three_Tickets.RT.anchoredPosition = new Vector2(x, y);
        x += Three_Tickets.RT.rect.width + 10f;
    }

    void Elvis_Game_Tickets(List<Game1TicketView> tickets)
    {
        int length = tickets.Count;
        List<View_Ticket_Data> mini_tickets = new List<View_Ticket_Data>();
        for (int i = 0; i < length; i += 2)
        {
            Elvis_Ticket = Instantiate(View_Elvis_Tickets_Prefab, View_Ticket_Parent);
            
            mini_tickets.Clear();
            for (int j = 0; j < 2; j++)
                mini_tickets.Add(new View_Ticket_Data(tickets[i + j].id, tickets[i + j].ticketNumber, tickets[i + j].ticketPrice, tickets[i + j].ticketCellNumberList));
            Elvis_Ticket.Set_Data(mini_tickets, TicketColorManager.Instance.Get_Ticket_Color(tickets[i].ticketColor), tickets[i].ticketColor, Replace_Amount);
            Tickets.Add(Elvis_Ticket.gameObject);
            Get_XY(Elvis_Ticket.RT);
            Elvis_Ticket.RT.anchoredPosition = new Vector2(x, y);
            x += Elvis_Ticket.RT.rect.width + 10f;
        }
    }

    public void Back_Btn()
    {
        gameObject.SetActive(false);
    }

    void Get_XY(RectTransform rt)
    {
        if (View_Ticket_Parent.rect.width - rt.rect.width - x < 0f)
        {
            x = 10f;
            y = (y - Tickets[^1].GetComponent<RectTransform>().rect.height) - 10f;
        }
    }

    #endregion

    #region Replace Elvis Tickets

    internal void Set_Replacing_Elvis_Tickets(string id1, string id2)
    {
        Elvis_Replace_Ticket_Id1 = id1;
        Elvis_Replace_Ticket_Id2 = id2;
    }

    internal void Open_Replace_Payment_Option()
    {

        EventManager.Instance.Replace_Elvis_Tickets(Game_ID, Elvis_Replace_Ticket_Id1, Elvis_Replace_Ticket_Id2, Replace_Amount, "realMoney", "");

        //UIManager.Instance.selectPurchaseTypePanel.Open(GameSocketManager.SocketGame1);

        //UIManager.Instance.selectPurchaseTypePanel.eventPurchaseByPoints.AddListener((string voucherCode) => {
        //    EventManager.Instance.Replace_Elvis_Tickets(Game_ID, Elvis_Replace_Ticket_Id1, Elvis_Replace_Ticket_Id2, Replace_Amount, "points", voucherCode);
        //});

        //UIManager.Instance.selectPurchaseTypePanel.eventPurchaseByRealMoney.AddListener((string voucherCode) => {
        //    EventManager.Instance.Replace_Elvis_Tickets(Game_ID, Elvis_Replace_Ticket_Id1, Elvis_Replace_Ticket_Id2, Replace_Amount, "realMoney", voucherCode);
        //});

        //UIManager.Instance.selectPurchaseTypePanel.eventPurchaseByTodaysBalance.AddListener((string voucherCode) => {
        //    EventManager.Instance.Replace_Elvis_Tickets(Game_ID, Elvis_Replace_Ticket_Id1, Elvis_Replace_Ticket_Id2, Replace_Amount, "realMoney", voucherCode);
        //});
    }

    #endregion

}
