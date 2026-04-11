using I2.Loc;
using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class PrefabBingoGame1Pattern : MonoBehaviour
{
    #region PUBLIC_VARIABLES

    public string Pattern_ID = "";
    public string Pattern_Name = "";
    public int Pattern_Design = 0;
    public List<int> Pattern_Indexes;

    #endregion

    #region PRIVATE_VARIABLES
    [Header("Text")]
    [SerializeField] private TextMeshProUGUI txtAmount;
    [SerializeField] private TextMeshProUGUI txtRow;

    [Header("Image")]
    [SerializeField] private List<Image> imgPatternBlocks;

    [Header("Sprite")]
    [SerializeField] private Sprite bevelImg;

    [Header("Colors")]
    [SerializeField] private Color32 colorPatternFill;
    [SerializeField] private Color32 colorPatternNormal;

    #endregion

    #region UNITY_CALLBACKS
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS

    public void SetData(PatternData patternData, int Rowindex)
    {
        txtAmount.text = $"{patternData.amount} kr";
        Rowindex++;

        Pattern_ID = patternData._id;
        Pattern_Name = patternData.name;
        Pattern_Design = patternData.patternDesign;

        if (Pattern_Name == "Row 1" || Pattern_Name == "Row 2" || Pattern_Name == "Row 3" || Pattern_Name == "Row 4")
        {
            txtRow.text = I2.Loc.LocalizationManager.GetTranslation("TextDataSubRow") + " " + Rowindex;
        }
        else if (Pattern_Name == "Picture")
        {
            txtRow.text = I2.Loc.LocalizationManager.GetTranslation("TextDataSubPicture");
        }
        else if (Pattern_Name == "Frame")
        {
            txtRow.text = I2.Loc.LocalizationManager.GetTranslation("TextDataSubFrame");
        }
        else if (Pattern_Name == "Full House")
        {
            txtRow.text = I2.Loc.LocalizationManager.GetTranslation("TextDataSubRow") + " 5";
        }
        else
        {
            txtRow.text = I2.Loc.LocalizationManager.GetTranslation("TextDataSubRow");
        }

        switch (patternData.patternDesign)
        {
            case 0:
                Pattern_Indexes.Clear();
                for (int i = 0; i < patternData.patternDataList.Count; i++)
                {
                    if (patternData.patternDataList[i] == 1 && i != 12)
                    {
                        imgPatternBlocks[i].color = colorPatternFill;
                        imgPatternBlocks[i].sprite = bevelImg;
                        LeanTween.scale(imgPatternBlocks[i].gameObject, Vector3.one * 1.06f, 0.5f)
                            .setEase(LeanTweenType.easeInOutSine)
                            .setLoopPingPong(-1);
                        Pattern_Indexes.Add(i);
                    }
                }
                break;
            case 1:
                StartCoroutine(One_Row_Animation());
                break;
            case 2:
                StartCoroutine(Two_Row_Animation());
                break;
            case 3:
                StartCoroutine(Three_Row_Animation());
                break;
            case 4:
                StartCoroutine(Four_Row_Animation());
                break;
        }

    }

    internal void Update_Pattern_Amount(double amount)
    {
        txtAmount.text = $"{amount} kr";
    }

    #endregion

    #region Row Animations

    IEnumerator One_Row_Animation()
    {
    there:;
        for (int i = 0; i < 5; i++)
        {
            for (int k = 0; k < 25; k++)
            {
                imgPatternBlocks[k].color = colorPatternNormal;
                imgPatternBlocks[k].sprite = null;
            }
            for (int j = 0; j < 5; j++)
            {
                if ((i * 5) + j != 12)
                {
                    imgPatternBlocks[(i * 5) + j].color = colorPatternFill;
                    imgPatternBlocks[(i * 5) + j].sprite = bevelImg;
                    LeanTween.scale(imgPatternBlocks[(i * 5) + j].gameObject, Vector3.one * 1.06f, 0.5f)
                         .setEase(LeanTweenType.easeInOutSine)
                         .setLoopPingPong(1);
                }
            }
            yield return new WaitForSeconds(1f);
        }
        for (int i = 0; i < 5; i++)
        {
            for (int k = 0; k < 25; k++)
            {
                imgPatternBlocks[k].color = colorPatternNormal;
                imgPatternBlocks[k].sprite = null;
            }
            for (int j = 0; j < 5; j++)
            {
                if ((i * 5) + j != 12)
                {
                    imgPatternBlocks[(j * 5) + i].color = colorPatternFill;
                    imgPatternBlocks[(j * 5) + i].sprite = bevelImg;
                    LeanTween.scale(imgPatternBlocks[(j * 5) + i].gameObject, Vector3.one * 1.06f, 0.5f)
                                .setEase(LeanTweenType.easeInOutSine)
                                .setLoopPingPong(1);
                }
            }
            yield return new WaitForSeconds(1f);
        }
        goto there;
    }

    IEnumerator Two_Row_Animation()
    {
    there:;
        for (int l = 0; l < 4; l++)
        {
            for (int i = l + 1; i < 5; i++)
            {
                for (int j = 0; j < 5; j++)
                {
                    for (int k = 0; k < 5; k++)
                    {
                        if (5 * j + k != 12)
                        {
                            //imgPatternBlocks[5 * j + k].color = (j == l || j == i) ? colorPatternFill : colorPatternNormal;
                            if (j == l || j == i)
                            {
                                imgPatternBlocks[5 * j + k].color = colorPatternFill;
                                imgPatternBlocks[5 * j + k].sprite = bevelImg;
                                LeanTween.scale(imgPatternBlocks[5 * j + k].gameObject, Vector3.one * 1.06f, 0.5f)
                                         .setEase(LeanTweenType.easeInOutSine)
                                         .setLoopPingPong(1);
                            }
                            else
                            {
                                imgPatternBlocks[5 * j + k].color = colorPatternNormal;
                                imgPatternBlocks[5 * j + k].sprite = null;
                            }
                        }
                    }
                }
                yield return new WaitForSeconds(1f);
            }
        }
        goto there;
    }

    IEnumerator Three_Row_Animation()
    {
    there:;
        for (int l = 0; l < 3; l++)
        {
            for (int m = l + 1; m < 5; m++)
            {
                for (int i = m + 1; i < 5; i++)
                {
                    for (int j = 0; j < 5; j++)
                    {
                        for (int k = 0; k < 5; k++)
                        {
                            if (5 * j + k != 12)
                            {
                                //imgPatternBlocks[5 * j + k].color = (j == l || j == i || j == m) ? colorPatternFill : colorPatternNormal;
                                if (j == l || j == i || j == m)
                                {
                                    imgPatternBlocks[5 * j + k].color = colorPatternFill;
                                    imgPatternBlocks[5 * j + k].sprite = bevelImg;
                                    LeanTween.scale(imgPatternBlocks[5 * j + k].gameObject, Vector3.one * 1.06f, 0.5f)
         .setEase(LeanTweenType.easeInOutSine)
         .setLoopPingPong(1);
                                }
                                else
                                {
                                    imgPatternBlocks[5 * j + k].color = colorPatternNormal;
                                    imgPatternBlocks[5 * j + k].sprite = null;
                                }
                            }
                        }
                    }
                    yield return new WaitForSeconds(1f);
                }
            }
        }
        goto there;
    }

    IEnumerator Four_Row_Animation()
    {
    there:;
        for (int i = 4; i > -1; i--)
        {
            for (int k = 0; k < 25; k++)
            {
                if (k != 12)
                {
                    imgPatternBlocks[k].color = colorPatternFill;
                    imgPatternBlocks[k].sprite = bevelImg;
                                        LeanTween.scale(imgPatternBlocks[k].gameObject, Vector3.one * 1.06f, 0.5f)
                    .setEase(LeanTweenType.easeInOutSine)
                    .setLoopPingPong(1);
                }
            }
            for (int j = 0; j < 5; j++)
            {
                imgPatternBlocks[(i * 5) + j].color = colorPatternNormal;
                imgPatternBlocks[(i * 5) + j].sprite = null;
            }
            yield return new WaitForSeconds(1f);
        }
        goto there;
    }

    #endregion

    #region PRIVATE_METHODS
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    public long Amount
    {
        set
        {
            txtAmount.text = value.ToString();
        }
    }
    #endregion
}
