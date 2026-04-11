using UnityEngine;
using TMPro;
using I2.Loc;

public class RowWinningData : MonoBehaviour
{
    [SerializeField] TextMeshProUGUI txtRowWinning;
    [SerializeField] TextMeshProUGUI txtRowWinningAmount;

    public void SetData(string rowWinning, string rowWinningAmount, bool showPrize)
    {
        if (rowWinning == "Row 1" || rowWinning == "Row 2" || rowWinning == "Row 3" || rowWinning == "Row 4")
        {
            txtRowWinning.text = I2.Loc.LocalizationManager.GetTranslation("TextDataSubRow") + " " + rowWinning.Split(' ')[1];
        }
        else if (rowWinning == "Picture")
        {
            txtRowWinning.text = I2.Loc.LocalizationManager.GetTranslation("TextDataSubPicture");
        }
        else if (rowWinning == "Frame")
        {
            txtRowWinning.text = I2.Loc.LocalizationManager.GetTranslation("TextDataSubFrame");
        }
        else if (rowWinning == "Full House")
        {
            txtRowWinning.text = I2.Loc.LocalizationManager.GetTranslation("Full House");
        }

        if (!showPrize)
        {
            txtRowWinning.fontStyle = FontStyles.Underline | FontStyles.Bold;
            txtRowWinningAmount.fontStyle = FontStyles.Bold | FontStyles.Underline;
            txtRowWinningAmount.text = $"{Constants.LanguageKey.Processing}";
        }
        else
        {
            txtRowWinning.fontStyle = FontStyles.Normal;
            txtRowWinningAmount.text = $"{rowWinningAmount} kr";
        }
    }
}
