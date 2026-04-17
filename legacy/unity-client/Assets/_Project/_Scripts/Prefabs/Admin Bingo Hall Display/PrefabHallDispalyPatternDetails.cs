using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;
using I2.Loc;

public class PrefabHallDispalyPatternDetails : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    #endregion

    #region PRIVATE_VARIABLES
    [Header("Text")]
    [SerializeField] public TextMeshProUGUI patternName;
    [SerializeField] private TextMeshProUGUI playerCount;
    [SerializeField] private TextMeshProUGUI prize;
    [SerializeField] private TextMeshProUGUI jackpotDrawCount;
    public Image HighLight;
    public Button btn;

    public AdminDashboardWinningData data;
    private Coroutine prizeAnimationCoroutine;
    #endregion

    #region UNITY_CALLBACKS
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void SetData(AdminDashboardWinningData data)
    {
        this.data = data;

        // patternName.text = data.displayName;

        if (data.displayName == "Row 1" || data.displayName == "Row 2" || data.displayName == "Row 3" || data.displayName == "Row 4")
        {
            patternName.text = I2.Loc.LocalizationManager.GetTranslation("TextDataSubRow") + " " + data.displayName.Split(' ')[1];
        }
        else if (data.displayName == "Picture")
        {
            patternName.text = I2.Loc.LocalizationManager.GetTranslation("TextDataSubPicture");
        }
        else if (data.displayName == "Frame")
        {
            patternName.text = I2.Loc.LocalizationManager.GetTranslation("TextDataSubFrame");
        }
        else if (data.displayName == "Full House")
        {
            patternName.text = I2.Loc.LocalizationManager.GetTranslation("Full House");
        }

        playerCount.text = data.winnerCount.ToString();
        prize.text = data.prize.ToString() + " kr";
    }

    public void SetJackPotData(JackPotData Data)
    {
        if (this.Id.Equals("Full House"))
        {
            if (UIManager.Instance.bingoHallDisplayPanel.gameHistory.gameName.Equals("Innsatsen") || UIManager.Instance.bingoHallDisplayPanel.gameHistory.gameName.Equals("Oddsen 57")
                 || UIManager.Instance.bingoHallDisplayPanel.gameHistory.gameName.Equals("Oddsen 58") || UIManager.Instance.bingoHallDisplayPanel.gameHistory.gameName.Equals("Oddsen 56")
                 || UIManager.Instance.bingoHallDisplayPanel.gameHistory.gameName.Equals("Jackpot"))
            {
                jackpotDrawCount.gameObject.SetActive(UIManager.Instance.bingoHallDisplayPanel.jackPotData.isDisplay);
                jackpotDrawCount.text = Data.draw.ToString();
                // prize.text = Data.tvScreenWinningAmount.ToString() + " kr";
                // Stop previous animation if running
                if (prizeAnimationCoroutine != null)
                    StopCoroutine(prizeAnimationCoroutine);

                // Start new animation if prizeArray has values
                if (Data.prizeArray != null && Data.prizeArray.Count > 0)
                {
                    prizeAnimationCoroutine = StartCoroutine(AnimatePrizeText(Data.prizeArray));
                }
                else
                {
                    prize.text = Data.tvScreenWinningAmount.ToString() + " kr";
                }
            }
            else
            {
                jackpotDrawCount.gameObject.SetActive(false);
            }
        }
    }
    #endregion

    #region PRIVATE_METHODS
    private IEnumerator AnimatePrizeText(List<int> prizeArray)
    {
        int index = 0;

        while (true) // continuous loop
        {
            prize.text = prizeArray[index].ToString() + " kr";

            index = (index + 1) % prizeArray.Count; // loop back to start
            yield return new WaitForSeconds(2f); // wait 2 seconds before next update
        }
    }
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    public string Id
    {
        get
        {
            return data.id;
        }
    }
    #endregion
}
