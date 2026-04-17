using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using TMPro;
using System.Text;

public class AdminTVScreenWinners : MonoBehaviour
{
    #region Variables

    public RectTransform RT;
    public TMP_Text Patterns_Txt, Winner_Count_Txt, Won_amount_Txt, Hall_Specific_Winner_Txt, ticketid__Winings_Txt;


    // Your list of integers
    int[] myIntList = { 0, 1, 2, 3, 4, 5, 6, 7, 8, 9 };
    // Counter to keep track of iterations
    int counter = 0;

    #endregion

    internal void Set_Admin_TV_Screen_Winner(string pattern, string count, string finalWonAmount, List<string> halls, List<PlayerIdArray> playerIdArray)
    {
        // Patterns_Txt.text = pattern;
        if (pattern == "Row 1" || pattern == "Row 2" || pattern == "Row 3" || pattern == "Row 4")
        {
            Patterns_Txt.text = I2.Loc.LocalizationManager.GetTranslation("TextDataSubRow") + " " + pattern.Split(' ')[1];
        }
        else if (pattern == "Picture")
        {
            Patterns_Txt.text = I2.Loc.LocalizationManager.GetTranslation("TextDataSubPicture");
        }
        else if (pattern == "Frame")
        {
            Patterns_Txt.text = I2.Loc.LocalizationManager.GetTranslation("TextDataSubFrame");
        }
        else if (pattern == "Full House")
        {
            Patterns_Txt.text = I2.Loc.LocalizationManager.GetTranslation("Full House");
        }
        Winner_Count_Txt.text = count;
        Won_amount_Txt.text = finalWonAmount;
        // Join the elements of the halls list with the separator "|"
        string hallsText = string.Join(" | ", halls);
        Hall_Specific_Winner_Txt.text = hallsText;


        // Create a StringBuilder to build the text for ticket numbers and won amounts
        StringBuilder playerIdArrayText = new StringBuilder();
        foreach (var player in playerIdArray)
        {
            playerIdArrayText.AppendLine($"Id : {player.ticketNumber} ({player.wonAmount} kr) ({player.userType})");
        }

        // Set the text of the appropriate text field
        ticketid__Winings_Txt.text = playerIdArrayText.ToString();

        UpdateColumn(playerIdArray);
    }



    //internal void Set_Admin_TV_Screen_Winner(string pattern, string count, string hall_Specific_Winner)
    //{
    //    Patterns_Txt.text = pattern;
    //    Winner_Count_Txt.text = count;
    //    Hall_Specific_Winner_Txt.text = hall_Specific_Winner;
    //}

    #region PRIVATE_METHODS

    private void UpdateColumn(List<PlayerIdArray> playerIdArray)
    {
        int counter = 0;
        foreach (var playerArray in playerIdArray)
        {
            if (++counter > 2)
            {
                RT.sizeDelta = new Vector2(RT.sizeDelta.x, RT.sizeDelta.y + 80f);
                counter = 0;
            }
        }
    }

    #endregion
}
