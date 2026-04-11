using System.Collections;
using System.Collections.Generic;
using I2.Loc;
using TMPro;
using UnityEngine;

public partial class Game1GamePlayPanel
{
    public void Upcoming_Game1_Ticket_Set_Up_Open()
    {
        if (!Is_AnyGame_Running)
            Upcoming_Game1_Ticket_Set_Up(true);
        else
            Upcoming_Game_Purchase_UI.SetActive(false);

        Btn_Upcoming_Game_Buy_Tickets.interactable =
            UIManager.Instance.game1Panel.Game_1_Data.maxPurchaseTicket
            != UIManager.Instance.game1Panel.Game_1_Data.purchasedTickets;
    }

    public void Upcoming_Game1_Ticket_Set_Up_Close()
    {
        Upcoming_Game_Purchase_UI.SetActive(false);
    }

    internal void Upcoming_Game1_Ticket_Set_Up(bool isforce = false)
    {
        if (!isforce)
        {
            EditLuckyNumberEnable = false;
        }

        buyMoreTicket.interactable = true;
        selectLuckyNumberPanel.ClosePanel();
        int length = Upcoming_Game_Tickets.Count;
        if (length > 0)
        {
            for (int i = 0; i < length; i++)
                Destroy(Upcoming_Game_Tickets[i].gameObject);
            Upcoming_Game_Tickets.Clear();
        }

        if (instantiatedObjects.Count > 0)
        {
            for (int i = 0; i < instantiatedObjects.Count; i++)
                Destroy(instantiatedObjects[i].gameObject);
            instantiatedObjects.Clear();
        }

        length = Upcoming_Game_Data.ticketTypes.Count;
        var localManager = Upcoming_Game_Purchased_Ticket_Txt.GetComponent<LocalizationParamsManager>();
        localManager.SetParameterValue("value", Upcoming_Game_Data.purchasedTickets.ToString());

        Upcoming_Game_Name_Txt
            .GetComponent<LocalizationParamsManager>()
            .SetParameterValue("value", Upcoming_Game_Data.gameName);
        Upcoming_Game_Purchase_UI.SetActive(true);

        for (int i = 0; i < length; i++)
        {
            Game1PurchaseTicketData ticket = Instantiate(
                Upcoming_Game_Ticket_Prefab,
                Vector3.zero,
                Quaternion.identity,
                Upcoming_Game_Ticket_Parent
            );
            Upcoming_Game_Tickets.Add(ticket);
            ticket.Set_Data(
                Upcoming_Game_Data.ticketTypes[i],
                Get_Ticket_Weight(
                    Upcoming_Game_Data.gameType,
                    Upcoming_Game_Data.ticketTypes[i].name
                )
            );

            GameObject newObject = Instantiate(
                Prefab_Devider,
                Vector3.zero,
                Quaternion.identity,
                Upcoming_Game_Ticket_Parent
            );
            instantiatedObjects.Add(newObject);
        }

        if (instantiatedObjects.Count > 0)
        {
            GameObject lastObject = instantiatedObjects[instantiatedObjects.Count - 1];
            instantiatedObjects.RemoveAt(instantiatedObjects.Count - 1);
            Destroy(lastObject);
        }

        Upcoming_Game_Purchase_UI.SetActive(false);
        Upcoming_Game_CSF.enabled = false;
        Invoke(nameof(Enable_Upcoming_UI), 0.25f);
    }

    int Get_Ticket_Weight(string game_Type, string ticket_name)
    {
        switch (game_Type)
        {
            default:
                return 1;
            case "traffic-light":
                return 3;
            case "elvis":
                return 2;
            case "color":
                if (ticket_name.ToLower().Contains("large"))
                    return 3;
                return 1;
        }
    }

    void Enable_Upcoming_UI()
    {
        buyMoreTicket.interactable = true;
        Upcoming_Game_Purchase_UI.SetActive(true);
        StartCoroutine(Refresh_Upcoming_UI());
    }

    IEnumerator Refresh_Upcoming_UI()
    {
        Upcoming_Game_CSF.enabled = true;
        yield return new WaitForSeconds(0.1f);
        Upcoming_Game_CSF.enabled = false;
        yield return new WaitForSeconds(0.1f);
        Upcoming_Game_CSF.enabled = true;
    }

    void Elvis_Game_Tickets(List<GameTicketData> tickets)
    {
        int length = tickets.Count;
        List<View_Ticket_Data> mini_tickets = new List<View_Ticket_Data>();
        for (int i = 0; i < length; i += 2)
        {
            Elvis_Ticket = Instantiate(View_Elvis_Tickets_Prefab, View_Ticket_Parent);
            mini_tickets.Clear();
            for (int j = 0; j < 2; j++)
                mini_tickets.Add(
                    new View_Ticket_Data(
                        tickets[i + j].id,
                        tickets[i + j].ticketNumber,
                        int.Parse(tickets[i + j].ticketPrice),
                        tickets[i + j].ticketCellNumberList
                    )
                );
            Elvis_Ticket.Set_Data(
                mini_tickets,
                TicketColorManager.Instance.Get_Ticket_Color(tickets[i].ticketColor),
                tickets[i].ticketColor,
                Replace_Amount
            );
            Elvis_Tickets.Add(Elvis_Ticket.gameObject);
        }
    }

    private PrefabBingoGame1Ticket5x5 GetTicketById(string ticketId)
    {
        foreach (PrefabBingoGame1Ticket5x5 ticket in ticketList)
        {
            if (ticket.TicketId == ticketId)
                return ticket;
        }

        return null;
    }
}
