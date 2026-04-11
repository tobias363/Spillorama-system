using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class Game5TicketSingleCellData : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    #endregion

    #region PRIVATE_VARIABLES

    [Header("Text")]
    [SerializeField] private TextMeshProUGUI txtCellNo;

    [Header("Images")]
    [SerializeField] private Image imgCell;

    [Header("colors")]
    public Color32 colorMarkerNoraml;
    public Color32 colorMarkerHighLight;

    public int Number;
    public bool isNumberSelected = false;


    #endregion

    #region UNITY_CALLBACKS
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS   
    public void SetTheme(int TicketList)
    {
        txtCellNo.text = TicketList.ToString();
        Number = TicketList;
    }
    public void HighlightNormalNumber(bool highlight)
    {
        if (highlight)
            imgCell.color = colorMarkerHighLight;
        else
            imgCell.color = colorMarkerNoraml;
    }

    #endregion

    #region PRIVATE_METHODS
    #endregion

    #region COROUTINES    
    #endregion

    #region GETTER_SETTER    
    #endregion
}
