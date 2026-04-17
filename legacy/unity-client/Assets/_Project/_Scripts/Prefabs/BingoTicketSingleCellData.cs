using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class BingoTicketSingleCellData : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    public bool isNumberSelected = false;
    public bool isLuckyNumberSelected = false;
    public bool isNumberBlink = false;
    #endregion

    #region PRIVATE_VARIABLES
    [Header("Image")]
    [SerializeField] internal Image imgCell;
    [SerializeField] internal Image imgCellOneToGo;
    [SerializeField] private Image imgNumberSelectionMarker;
    [SerializeField] private Image imgNumberSelectionLuckyNumberMarker;

    [Header("Text")]
    [SerializeField] public TextMeshProUGUI txtNumber;

    private bool cellColorDataAvailable = false;

    private Color32 colorNormalText;
    private Color32 colorMarkerNumber;
    private Color32 colorLuckyNumber;

    private TicketThemeData theme;
    public LTDescr BlinkTween;
    private int _number = 0;
    #endregion

    #region UNITY_CALLBACKS
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS

    private void Start()
    {

    }

    public void SetTheme(TicketThemeData theme)
    {
        this.theme = theme;

        colorNormalText = theme.normalTextColor;
        colorMarkerNumber = theme.markerTextColor;

        imgNumberSelectionMarker.color = theme.markerColor;
        this.GetComponent<Image>().color = theme.gridCellColor;

        txtNumber.color = theme.normalTextColor;

        if (imgCell)
            imgCell.color = theme.gridCellColor;
    }

    public void CellNumber(string number)
    {
        int.TryParse(number, out this._number);
        txtNumber.text = number;
    }

    public void CellNumber(string number, Color32 colorNumberText)
    {
        int.TryParse(number, out this._number);
        txtNumber.text = number;
        txtNumber.color = colorNumberText;
    }

    public void CellNumber(string number, Color32 colorNormalText, Color32 colorMarkerNumber, Color32 colorLuckyNumber)
    {
        int.TryParse(number, out this._number);
        if (number == "-1" || number == "0")
        {
            _number = -1;
            txtNumber.text = "F";
        }
        else
        {
            txtNumber.text = number;
        }
        this.colorNormalText = colorNormalText;
        this.colorMarkerNumber = colorMarkerNumber;
        this.colorLuckyNumber = colorLuckyNumber;
        cellColorDataAvailable = true;
        UpdateMissingCellColor();
    }

    public void ApplyNormalMarkerTheme(TicketMarkerCellData markerData, bool ignoreMarkerColor = false)
    {
        imgNumberSelectionMarker.Open();
        imgNumberSelectionMarker.sprite = markerData.spriteTicketMarker;
        if (!ignoreMarkerColor)
        {
            imgNumberSelectionMarker.color = markerData.colorMarker;
            txtNumber.color = markerData.colorMarkerText;
        }
        else
        {
            txtNumber.color = colorMarkerNumber;
        }
    }

    public void ModifyGridAndTextColor(Color32 colorGrid, Color32 colorNormalText, Color32 colorMarkerNumber, Color32 colorLuckyNumber, Color32 markerColor)
    {
        this.colorNormalText = colorNormalText;
        this.colorMarkerNumber = colorMarkerNumber;
        this.colorLuckyNumber = colorLuckyNumber;

        imgCell.color = colorGrid;
        txtNumber.color = colorNormalText;
        imgNumberSelectionMarker.color = markerColor;
    }

    //public void ApplyLuckyNumberMarkerTheme(Color32 colorMarkerText)
    //{
    //    imgNumberSelectionLuckyNumberMarker.Open();
    //    txtNumber.color = colorMarkerText;
    //}

    public void UpdateMissingCellColor()
    {
        if (imgCellOneToGo != null)
        {
            imgCellOneToGo.color = TicketColorManager.Instance.Get_1_to_go_Color();
        }
    }

    public void HighlightLuckyNumber(bool highlight)
    {
        imgNumberSelectionLuckyNumberMarker.gameObject.SetActive(highlight);
        isLuckyNumberSelected = highlight;

        if (highlight || isNumberSelected)
            txtNumber.color = colorLuckyNumber;
        else
            txtNumber.color = colorNormalText;
    }

    public void HighlightLuckyNumber(bool highlight, bool ticketSelected)
    {
        imgNumberSelectionLuckyNumberMarker.gameObject.SetActive(highlight);
        isLuckyNumberSelected = highlight;

        if (highlight || ticketSelected)
            txtNumber.color = colorLuckyNumber;
        else
            txtNumber.color = colorNormalText;
    }

    public void HighlightNormalNumber(bool highlight, TicketMarkerCellData markerData = null, bool ignoreMarkerColor = false)
    {
        imgNumberSelectionMarker.gameObject.SetActive(highlight);

        if (highlight)
        {
            txtNumber.color = colorMarkerNumber;
            ApplyNormalMarkerTheme(markerData, ignoreMarkerColor);
        }
        else
            txtNumber.color = colorNormalText;
    }

    public void HighlightCell(Color32 highlightCellColor)
    {
        imgNumberSelectionMarker.Close();
        imgCell.color = highlightCellColor;

    }

    public void ResetCell()
    {
        isNumberSelected = false;
        imgNumberSelectionMarker.Close();

        if (imgCell)
            imgCell.color = theme.gridCellColor;

    }

    public void ResetMissingHighlightCell()
    {
        if (imgCell)
            imgCell.color = theme.gridCellColor;
    }

    internal void Stop_NumberBlink()
    {
        //Debug.Log("Stop_NumberBlink");
        LeanTween.cancel(txtNumber.gameObject);
        isNumberBlink = false;
        BlinkTween = null;
        txtNumber.transform.localScale = Vector2.one;
        if (imgCellOneToGo != null)
            imgCellOneToGo.Close();

    }

    internal void Start_NumberBlink()
    {
        isNumberBlink = true;
        if (imgCellOneToGo != null)
            imgCellOneToGo.Open();
        BlinkTween = LeanTween.scale(txtNumber.gameObject, new Vector3(1.5f, 1.5f), 1.0f).setEase(LeanTweenType.punch).setLoopCount(-1);

    }
    #endregion

    #region PRIVATE_METHODS
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    public int Number
    {
        get
        {
            return _number;
        }
    }
    #endregion
}
