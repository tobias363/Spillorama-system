using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using TMPro;
using I2.Loc;

public class Game1ViewPurchaseElvisTicket : MonoBehaviour
{
    #region Variables

    public TMP_Text Ticket_Name_Txt, Replace_Amount_Txt;

    public RectTransform RT;
    public List<Game1ViewPurchaseTicket> Mini_Tickets;
    public Image Ticket_BG;
    public Button deleteBtn;

    #endregion

    internal void Set_Data(List<View_Ticket_Data> tickets, Tickets_Color color, string ticket_Name, int replace_Amount)
    {
        Ticket_BG.color = color.Large_BG_Color;
        int length = Mini_Tickets.Count;
        for (int i = 0; i < length; i++)
            Mini_Tickets[i].Set_Ticket(tickets[i], color);

        Ticket_Name_Txt.text = ticket_Name;
        //Replace_Amount_Txt.text = $"Replace: {replace_Amount}kr";
        Replace_Amount_Txt.GetComponent<LocalizationParamsManager>().SetParameterValue("value", replace_Amount.ToString());
    }

    public void Replace_Anount_Btn()
    {
        UIManager.Instance.messagePopup.DisplayConfirmationPopup(Constants.LanguageKey.ReplaceTicketConfirmationMessage, (result) =>
        {
            if (result)
            {
                UIManager.Instance.topBarPanel.hallGameListPanel.game1ViewPurchaseTicket.Set_Replacing_Elvis_Tickets(Mini_Tickets[0].Ticket_ID, Mini_Tickets[1].Ticket_ID);
                UIManager.Instance.topBarPanel.hallGameListPanel.game1ViewPurchaseTicket.Open_Replace_Payment_Option();
            }
            else
            {
                UIManager.Instance.messagePopup.Close();
            }
        });
    }

    public void DeleteBtnTap()
    {
        this.deleteBtn.gameObject.SetActive(false);
        UIManager.Instance.deleteMessagePopup.grid.cellSize = new Vector2(550f, 310f);
        UIManager.Instance.deleteMessagePopup.DisplayDeleteConfirmationPopup(Constants.LanguageKey.DeleteTicketConfirmationMessage,
            (result) =>
            {
                if (result)
                {
                    string id1 = Mini_Tickets[0].Ticket_ID;
                    string id2 = Mini_Tickets[1].Ticket_ID;
                    Debug.LogError(id1);
                    Debug.LogError(id2);
                    // TODO: Replace with Spillorama REST endpoint for cancel ticket
                    Debug.LogWarning("[Game1] CancelTicketGame1: Spillorama endpoint not yet implemented");
                    UIManager.Instance.lobbyPanel.gamePlanPanel.OnGame1ButtonTap();
                    Debug.Log("Ticket Deleted.");
                }
            },
            (result) =>
            {
                if (result)
                {
                    this.deleteBtn.gameObject.SetActive(true);
                }
            },
            this.gameObject, null);
    }
}
