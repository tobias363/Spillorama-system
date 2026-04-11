using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using TMPro;
using BestHTTP.SocketIO;
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

        //Tickets_Cancle_Txt.GetComponent<LocalizationParamsManager>().SetParameterValue("Value", game.purchasedTickets.ToString());

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
        print($"Cancel Tickets : {Game_Data.gameId}");
        EventManager.Instance.Game1CancelTickets(Game_Data.gameId);
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

    #endregion

}
