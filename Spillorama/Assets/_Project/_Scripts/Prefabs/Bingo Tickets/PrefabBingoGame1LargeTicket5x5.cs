using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class PrefabBingoGame1LargeTicket5x5 : MonoBehaviour
{
    public List<PrefabBingoGame1Ticket5x5> Mini_Tickets;

    public Image imageBG;

    internal void Set_Ticket_Color()
    {
        int length = Mini_Tickets.Count;
        for (int i = 0; i < length; i++)
        {
            Tickets_Color color = TicketColorManager.Instance.Get_Ticket_Color(Mini_Tickets[i].gameTicketData.ticketColor);
            Mini_Tickets[i].imgTicket.color = color.BG_Color;
            int length1 = Mini_Tickets[i].ticketCellList.Count;
            for (int j = 0; j < length1; j++)
                Mini_Tickets[i].ticketCellList[j].imgCell.color = color.Block_Color;
            Mini_Tickets[i].Bingo_BG.color = Mini_Tickets[i].Current_Color = Mini_Tickets[i].imgTicket.color;
            if (color.name.Contains("Elvis"))
                Mini_Tickets[i].Ticket_Icon.sprite = UIManager.Instance.Elvis_Icon;
        }
    }

    public void SetData(GameTicketData gameTicketData, TicketMarkerCellData markerData)
    {
        int length = Mini_Tickets.Count;
        for (int i = 0; i < length; i++)
        {
            Mini_Tickets[i].SetData(gameTicketData, markerData);
        }
    }

    public void Game_1_12()
    {
        int length = Mini_Tickets.Count;
        for (int i = 0; i < length; i++)
        {
            Mini_Tickets[i].ticketCellList[12].isNumberSelected = true;
        }
    }
}