using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class Game1ViewPurchaseThreeTickets : MonoBehaviour
{
    #region Variables

    public RectTransform RT;
    public List<Game1ViewPurchaseTicket> Mini_Tickets;
    public Image Ticket_BG;

    #endregion

    internal void Set_Data(List<View_Ticket_Data> tickets, List<Tickets_Color> color)
    {
        Ticket_BG.color = color[0].Large_BG_Color;
        int length = Mini_Tickets.Count;
        for (int i = 0; i < length; i++)
            Mini_Tickets[i].Set_Ticket(tickets[i], color[i]);
    }

}
