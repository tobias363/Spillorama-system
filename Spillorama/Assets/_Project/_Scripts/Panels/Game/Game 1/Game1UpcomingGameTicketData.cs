using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using TMPro;
using I2.Loc;

public class Game1UpcomingGameTicketData : MonoBehaviour
{
    #region Variables

    internal double Price_Per_Ticket;
    [SerializeField]
    internal int Ticket_Weight, Number_Of_Tickets_To_Buy;

    public TMP_Text Ticket_Name_Txt;
    public TMP_Text Price_Per_Ticket_Txt;
    public TMP_Text Tickets_Purchase_Price_Txt;
    public TMP_Text Number_Of_Tickets_Txt;

    public Button Increase_Btn, Decrease_Btn;

    public RectTransform RT;

    #endregion

    #region Set Data

    internal void Set_Data(Game1_TicketType ticket, int weight)
    {
        Ticket_Name_Txt.text = ticket.name;

        Price_Per_Ticket = ticket.price;
        //Price_Per_Ticket_Txt.text = $"Price : {ticket.price} kr";

        var localManager = Price_Per_Ticket_Txt.GetComponent<LocalizationParamsManager>();
        localManager.SetParameterValue("Price", ticket.price.ToString());

        Ticket_Weight = weight;
        Number_Of_Tickets_To_Buy = 0;
        Tickets_Purchase_Price_Txt.text = Number_Of_Tickets_Txt.text = "";

        Update_Remaining_Tickets(0);
    }

    #endregion

    #region Ticket

    public void Update_Remaining_Tickets(int direction)
    {
        Number_Of_Tickets_To_Buy += direction;

        Decrease_Btn.interactable = Number_Of_Tickets_To_Buy != 0;

        Number_Of_Tickets_Txt.text = Number_Of_Tickets_To_Buy.ToString();
        Tickets_Purchase_Price_Txt.text = Number_Of_Tickets_To_Buy == 0 ? "" : $"{Number_Of_Tickets_To_Buy * Price_Per_Ticket} kr";

        UIManager.Instance.topBarPanel.hallGameListPanel.game1PurchaseTicket.Check_Max_Tickets();
    }

    #endregion

}
