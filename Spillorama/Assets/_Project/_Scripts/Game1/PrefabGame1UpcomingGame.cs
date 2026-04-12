using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using TMPro;
using I2.Loc;

public class PrefabGame1UpcomingGame : MonoBehaviour
{
    #region Variables

    public Game1 Game_Data;

    public TMP_Text Game_Name_Txt, Tickets_Purchased_Txt , Tickets_Cancle_Txt;
    public Button View_Purchased_Ticket_Btn, Cancel_Btn, Buy_Ticket_Btn;
        
    #endregion

    #region Tickets

    internal void Set_Data(Game1 game , bool isUpcomingGame = false)
    {
        Game_Data = game;
        Game_Name_Txt.text = game.gameName;
        Tickets_Purchased_Txt.text = $"Ticket purchased : {game.purchasedTickets}";

        if (isUpcomingGame)
            Tickets_Cancle_Txt.text = game.purchasedTickets > 0 ? LocalizationManager.GetTranslation("Delete Purchased Tickets") + "(" + game.purchasedTickets + ")" : LocalizationManager.GetTranslation("Tickets purchased");
        else
            Tickets_Cancle_Txt.GetComponent<LocalizationParamsManager>().SetParameterValue("TicketPurchased", game.purchasedTickets.ToString());

        View_Purchased_Ticket_Btn.interactable = game.purchasedTickets > 0;
        Cancel_Btn.interactable = game.isCancelAllowed = game.purchasedTickets > 0;
        Buy_Ticket_Btn.interactable = !game.isTestGame;
    }

    public void Open_Ticket_Buy_UI()
    {
        UIManager.Instance.topBarPanel.hallGameListPanel.game1PurchaseTicket.Open_Ticket_Buy_UI(Game_Data);
    }

    public void Cancel_Tickets_Btn()
    {
        // TODO: Replace with Spillorama REST endpoint
        Debug.LogWarning("[Game1] Game1CancelTickets: Spillorama endpoint not yet implemented");
    }

    public void View_Purchased_Ticket()
    {
        // UIManager.Instance.DisplayLoader(true);
        // TODO: Replace with Spillorama REST endpoint for viewing purchased tickets
        Debug.LogWarning("[Game1] View_Game_1_Purchased_Tickets: Spillorama endpoint not yet implemented");
        UIManager.Instance.DisplayLoader(false);
    }

    #endregion

}
