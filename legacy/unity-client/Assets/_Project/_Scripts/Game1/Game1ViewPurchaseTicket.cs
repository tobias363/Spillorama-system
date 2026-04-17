using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using TMPro;

public class Game1ViewPurchaseTicket : MonoBehaviour
{
    #region Variables

    public RectTransform RT;

    public TMP_Text Ticket_Number_Txt, Ticket_Price_Txt;
    public List<TMP_Text> Ticket_Bingo_Number_Txt;

    public List<Image> Ticket_Bingo_Blocks;
    public Image Ticket_BG;
    public string Ticket_ID;

    #endregion

    internal void Set_Ticket(View_Ticket_Data ticket_Data, Tickets_Color color)
    {
        Ticket_ID = ticket_Data.ID;
        Ticket_Number_Txt.text = ticket_Data.Ticket_Number;
        Ticket_Price_Txt.text = $"{ticket_Data.Price} kr";

        int length = Ticket_Bingo_Number_Txt.Count;
        for (int i = 0; i < length; i++)
            Ticket_Bingo_Number_Txt[i].text = $"{ticket_Data.Bingo_Numbers[i]}";

        length = Ticket_Bingo_Blocks.Count;
        for (int i = 0; i < length; i++)
            Ticket_Bingo_Blocks[i].color = color.Block_Color;
        Ticket_BG.color = color.BG_Color;
    }

}
