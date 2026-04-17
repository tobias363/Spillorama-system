using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class Game5TicketSingleCellData : MonoBehaviour
{
    [Header("Text")]
    [SerializeField] private TextMeshProUGUI txtCellNo;

    [Header("Images")]
    [SerializeField] private Image imgCell;

    [Header("Colors")]
    [SerializeField] private Color32 colorMarkerNormal;
    [SerializeField] private Color32 colorMarkerHighLight;

    public int Number;
    public bool isNumberSelected = false;

    public void SetTheme(int ticketCell)
    {
        txtCellNo.text = ticketCell.ToString();
        Number = ticketCell;
    }

    public void HighlightNormalNumber(bool highlight)
    {
        imgCell.color = highlight ? colorMarkerHighLight : colorMarkerNormal;
    }
}
