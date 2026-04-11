using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;

public class BingoResultPanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    #endregion

    #region PRIVATE_VARIABLES
    [SerializeField] private Transform transformThumb;
    [SerializeField] private TextMeshProUGUI txtBingoTextMessage;
    public TextMeshProUGUI txtWonAmount;

    private bool isTicketCompleted = false;
    #endregion

    #region UNITY_CALLBACKS
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void TicketCompleteAction()
    {
        isTicketCompleted = true;
        txtBingoTextMessage.text = "BINGO";
        this.Open();
        // StopAllCoroutines();
        if (UIManager.Instance.game1Panel.game1GamePlayPanel.gameObject.activeSelf || UIManager.Instance.splitScreenGameManager.game1Panel.game1GamePlayPanel.gameObject.activeSelf)
        {
            if (this.gameObject.activeSelf)
            {
                StopCoroutine("PatternWinningAnimation");
                StartCoroutine(PatternWinningAnimation());
            }
        }
    }

    public void PatternWinningAction(string patternName)
    {
        if (isTicketCompleted)
            return;

        if (patternName == "")
        {
            txtBingoTextMessage.text = "";
            this.Open();
            // StopAllCoroutines();
            if (this.gameObject.activeSelf)
            {
                StopCoroutine("PatternWinningAnimation");
                StartCoroutine(PatternWinningAnimation());
            }
        }
        else
        {
            // txtBingoTextMessage.text = Constants.LanguageKey.Bingo + "\n" + "(" + patternName.ToUpper() + ")";
            if (patternName.Equals("Row 1") || patternName.Equals("Row 2") || patternName.Equals("Row 3") || patternName.Equals("Row 4"))
            {
                txtBingoTextMessage.text = Constants.LanguageKey.Bingo + "\n" + "(" + patternName.ToUpper() + ")";
            }
            else if (patternName.Equals("Picture"))
            {
                txtBingoTextMessage.text = Constants.LanguageKey.Bingo + "\n" + "(" + patternName.ToUpper() + ")";
            }
            else if (patternName.Equals("Frame"))
            {
                txtBingoTextMessage.text = Constants.LanguageKey.Bingo + "\n" + "(" + patternName.ToUpper() + ")";
            }
            else if (patternName.Equals("Full House"))
            {
                txtBingoTextMessage.text = Constants.LanguageKey.Bingo + "\n" + "(" + patternName.ToUpper() + ")";
            }
            this.Open();
            // StopAllCoroutines();
            if (this.gameObject.activeSelf)
            {
                StartCoroutine(PatternWinningAnimation());
            }
        }
    }

    //public void PatternWinningAction(string patternName)
    //{
    //    if (isTicketCompleted)
    //        return;

    //    txtBingoTextMessage.text = "BINGO" + "\n" + "(" + patternName.ToUpper() + ")";
    //    this.Open();
    //    StopAllCoroutines();
    //    StartCoroutine(PatternWinningAnimation());
    //}


    #endregion

    #region PRIVATE_METHODS
    #endregion

    #region COROUTINES
    IEnumerator PatternWinningAnimation()
    {
        yield return new WaitForSeconds(2);
        this.Close();
    }
    #endregion

    #region GETTER_SETTER
    public string WonAmount
    {
        get { if (txtWonAmount != null) return txtWonAmount.text.ToString(); else return ""; }
        set { if (txtWonAmount != null) txtWonAmount.text = value; }
    }
    #endregion
}
