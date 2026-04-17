using UnityEngine;
using TMPro;
using I2.Loc;

public class MissedWinningClaimsData : MonoBehaviour
{
    [SerializeField] TextMeshProUGUI txtWinningPattern;
    [SerializeField] TextMeshProUGUI txtLastMatchedBall;
    [SerializeField] TextMeshProUGUI txtDrawCountWhenPatternMissed;
    [SerializeField] TextMeshProUGUI txtTotalDrawCount;

    public void SetData(UnclaimedWinners data)
    {
        if (data.lineType == "Row 1" || data.lineType == "Row 2" || data.lineType == "Row 3" || data.lineType == "Row 4")
        {
            txtWinningPattern.text = I2.Loc.LocalizationManager.GetTranslation("TextDataSubRow") + " " + data.lineType.Split(' ')[1];
        }
        else if (data.lineType == "Picture")
        {
            txtWinningPattern.text = I2.Loc.LocalizationManager.GetTranslation("TextDataSubPicture");
        }
        else if (data.lineType == "Frame")
        {
            txtWinningPattern.text = I2.Loc.LocalizationManager.GetTranslation("TextDataSubFrame");
        }
        else if (data.lineType == "Full House")
        {
            txtWinningPattern.text = I2.Loc.LocalizationManager.GetTranslation("Full House");
        }
        txtLastMatchedBall.text = data.withdrawBall.ToString();
        txtDrawCountWhenPatternMissed.text = data.withdrawBallCount.ToString();
        txtTotalDrawCount.text = data.totalWithdrawCount.ToString();
    }
}
