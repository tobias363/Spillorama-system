using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class PrefabBingoGame4Pattern : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    #endregion

    #region PRIVATE_VARIABLES
    [Header("Text")]
    [SerializeField] private TextMeshProUGUI txtPatternName;
    [SerializeField] private TextMeshProUGUI txtAmount;
    [SerializeField] private Text txtExtra;

    [Header("Image")]
    [SerializeField] private Image imgPatternBackground;
    [SerializeField] private List<Image> imgPatternBlocks;

    [SerializeField] private Color32 colorPatternNormal;
    [SerializeField] private Color32 colorPatternFill;
    [SerializeField] private Color32 colorExtraText;
    [SerializeField] private Color32 colorExtraOutline;

    [Header("Sprites")]
    [SerializeField] private GameObject L_Object;
    [SerializeField]private Sprite _1L_Sorite;
    [SerializeField] private Sprite _2L_Sorite;

    public Game4PatternData patternData;
    public bool highlightEnable = false;
    private float blinkAnimationTime = 0.25f;

    public List<PrefabBingoGame4Ticket5x3> MissingTickets = new List<PrefabBingoGame4Ticket5x3>();

    public List<int> missingIndices;
    #endregion

    #region UNITY_CALLBACKS
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void SetData(Game4PatternData patternData)
    {
        this.patternData = patternData;

        txtPatternName.text = patternData.patternName;
        if (patternData.patternName.ToLower() == "jackpot")
            txtAmount.text = patternData.patternName.ToUpper();
        else
            txtAmount.text = patternData.prize.ToString();
        txtExtra.text = patternData.extra;


        if(patternData.extra == "1L")
        {
            L_Object.SetActive(true);
            L_Object.GetComponent<Image>().sprite = _1L_Sorite;
        }
        else if (patternData.extra == "2L")
        {
            L_Object.SetActive(true);
            L_Object.GetComponent<Image>().sprite = _2L_Sorite;
        }
        else
        {
            L_Object.SetActive(false);
        }

            ModifyCellColor();
    }

    public void ApplyTheme(Color32 colorText, Color32 colorBackground, Color32 colorPatternNormal, Color32 colorPatternFill, Color32 colorExtraText, Color32 colorExtraOutline)
    {
        this.colorPatternNormal = colorPatternNormal;
        this.colorPatternFill = colorPatternFill;
        this.colorExtraText = colorExtraText;
        this.colorExtraOutline = colorExtraOutline;

        imgPatternBackground.color = colorBackground;

        txtPatternName.color = colorText;
        txtAmount.color = colorText;
        txtExtra.color = colorExtraText;
        txtExtra.GetComponent<Outline>().effectColor = colorExtraOutline;
    }

    public void HighlightPattern(bool highlight)
    {
        if (highlight && !highlightEnable)
        {
            StartCoroutine(HighlightAction());
        }
        else if (!highlight)
        {
            highlightEnable = false;
            StopAllCoroutines();
            ModifyCellColor();
        }

        

    }

    public void HighlightMissingPattern(bool highlight, int number)
    {
        if (highlight && !highlightEnable)
        {
            StartCoroutine(HighlightMissingAction(number));
        }
        else if (!highlight)
        {
            highlightEnable = false;
            StopAllCoroutines();
            ModifyCellColor();
        }
    }

    #endregion

    #region PRIVATE_METHODS
    private void ModifyCellColor()
    {
        for (int i = 0; i < patternData.patternDataList.Count; i++)
        {
            if (patternData.patternDataList[i] == 1 && patternData.extra == "")
                imgPatternBlocks[i].color = colorPatternFill;
            else
                imgPatternBlocks[i].color = colorPatternNormal;
        }

        if(patternData.extra == "1L" || patternData.extra == "2L")
        {
            L_Object.GetComponent<Image>().color = colorPatternFill;

        }


        txtExtra.color = colorExtraText;
    }
    #endregion

    #region COROUTINES    
    private IEnumerator HighlightAction()
    {
        List<Image> cellList = new List<Image>();


        if (patternData.extra == "1L" || patternData.extra == "2L")
        {

            cellList.Add(L_Object.GetComponent<Image>());

        }
        else
        {
            for (int i = 0; i < patternData.patternDataList.Count; i++)
            {
                if (patternData.patternDataList[i] == 1)
                    cellList.Add(imgPatternBlocks[i]);
            }
        }

        bool blink = true;

        while (true)
        {
            foreach (Image cell in cellList)
            {
                if(patternData.extra == "")
                {
                    if (patternData.extra == "")
                        cell.color = blink == true ? colorPatternNormal : colorPatternFill;
                    else
                        txtExtra.color = blink == true ? colorExtraText : colorPatternNormal;

                    cell.color = blink == true ? colorPatternNormal : colorPatternFill;
                }
                else
                {
                    if (patternData.extra == "1L" || patternData.extra == "2L")
                        cell.color = blink == true ? colorPatternNormal : colorPatternFill;
                    else
                        txtExtra.color = blink == true ? colorExtraText : colorPatternNormal;

                    cell.color = blink == true ? colorPatternNormal : colorPatternFill;
                }


                
            }
            blink = !blink;
            yield return new WaitForSeconds(blinkAnimationTime);
        }
    }

    private IEnumerator HighlightMissingAction(int number)
    {
        List<Image> cellList = new List<Image>();
        for (int i = 0; i < patternData.patternDataList.Count; i++)
        {
            if (i == number)
                cellList.Add(imgPatternBlocks[i]);
        }

        bool blink = true;

        while (true)
        {
            foreach (Image cell in cellList)
            {
                cell.color = blink == true ? colorPatternNormal : colorPatternFill;

                //if (patternData.extra == "")
                //    cell.color = blink == true ? colorPatternNormal : colorPatternFill;
                //else
                //    txtExtra.color = blink == true ? colorExtraText : colorPatternNormal;
            }
            blink = !blink;
            yield return new WaitForSeconds(blinkAnimationTime);
        }
    }

    #endregion

    #region GETTER_SETTER
    public List<int> PatternDataList
    {
        get
        {
            return patternData.patternDataList;
        }
    }

    public string PatternId
    {
        get
        {
            return patternData.id;
        }
    }

    public int Qty
    {
        get
        {
            return patternData.qty;
        }
    }

    public int Prize
    {
        get
        {
            return patternData.prize;
        }
    }
    #endregion
}
