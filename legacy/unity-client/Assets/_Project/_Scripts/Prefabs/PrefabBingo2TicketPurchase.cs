using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class PrefabBingo2TicketPurchase : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    #endregion

    #region PRIVATE_VARIABLES
    [Header("Canvas")]
    [SerializeField] private CanvasGroup canvasGroup;

    [Header("Text")]
    [SerializeField] private TextMeshProUGUI txtTicketNumber;
    [SerializeField] private TextMeshProUGUI txtTicketPrice;

    [Header("Images")]
    [SerializeField] private Image imgTicketSelection;
    [SerializeField] private List<BingoTicketSingleCellData> cellDataList;

    [Header("Colors")]
    [SerializeField] private Color32 colorNormalText;
    [SerializeField] private Color32 colorMarkerNumberText;
    [SerializeField] private Color32 colorLuckyNumberText;    

    private bool _isSelected;
    private bool _isAlreadySelected;

    [SerializeField] private Game2TicketData gameTicketData;
    #endregion

    #region UNITY_CALLBACKS
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void SetData(Game2TicketData gameTicketData)
    {
        ResetTicket();
        this.gameTicketData = gameTicketData;

        txtTicketNumber.text = gameTicketData.ticketNumber;
        txtTicketPrice.text = gameTicketData.ticketPrice + Constants.StringClass.currencySymbol;

        for(int i=0; i< gameTicketData.ticketCellNumberList.Count; i++)
        {
            cellDataList[i].CellNumber(gameTicketData.ticketCellNumberList[i].ToString(), colorNormalText, colorMarkerNumberText, colorLuckyNumberText);
        }
    }

    public void HighlightLuckyNumber(int luckyNumber)
    {        
        foreach (BingoTicketSingleCellData cellData in cellDataList)
        {            
            cellData.HighlightLuckyNumber(cellData.Number == luckyNumber, IsSelected || IsAlreadySelected);
        }
    }

    public void SelectTicket()
    {
        if (IsSelected == false && (UIManager.Instance.game2Panel.game2TicketPurchasePanel.TotalSelectedTickets >= 30))
            return;

        IsSelected = !IsSelected;

        if (IsSelected)
        {            
            //UIManager.Instance.game2Panel.game2TicketPurchasePanel.TicketSelected(true);
            UIManager.Instance.game2Panel.game2TicketPurchasePanel.AddTicketInWishList(gameTicketData.id);
        }
        else
        {
            //UIManager.Instance.game2Panel.game2TicketPurchasePanel.TicketUnSelected(true);
            UIManager.Instance.game2Panel.game2TicketPurchasePanel.RemoveTicketFromWishList(gameTicketData.id);
        }
    }

    public void SoldOutTicket(bool occupied, string playerIdOfPurchaser="")
    {
        gameObject.GetComponent<Button>().enabled = !occupied;
        if (occupied)
        {
            //UIManager.Instance.game2Panel.game2TicketPurchasePanel.TicketSelected(false);
            IsAlreadySelected = true;
            imgTicketSelection.GetComponent<CanvasGroup>().ignoreParentGroups = (playerIdOfPurchaser == UIManager.Instance.gameAssetData.PlayerId);
        }
        else
        {
            //UIManager.Instance.game2Panel.game2TicketPurchasePanel.TicketUnSelected(false);
            IsAlreadySelected = false;
            imgTicketSelection.GetComponent<CanvasGroup>().interactable = true;
        }
    }

    public void ResetTicket()
    {
        gameObject.GetComponent<Button>().enabled = true;
        foreach (BingoTicketSingleCellData cellData in cellDataList)        
            cellData.HighlightLuckyNumber(false);
        
        IsSelected = false;
        IsAlreadySelected = false;        
    }
    #endregion

    #region PRIVATE_METHODS
    private void ApplyTicketSelectionUI(bool isSelected)
    {
        imgTicketSelection.gameObject.SetActive(isSelected);

        Color32 colorGridCell;
        Color32 colorGridText;

        if(isSelected)
        {
            colorGridCell = new Color32(128, 1, 31, 255);
            colorGridText = new Color32(255, 214, 167, 255);
        }
        else
        {
            colorGridCell = new Color32(255,214,167,255);
            colorGridText = new Color32(2, 1, 2, 255);
        }

        foreach (BingoTicketSingleCellData cellData in cellDataList)
        {
            cellData.GetComponent<Image>().color = colorGridCell;

            if(!cellData.isLuckyNumberSelected)
                cellData.GetComponentInChildren<TextMeshProUGUI>().color = colorGridText;
        }
    }
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    public string TicketNumber
    {
        get
        {
            return gameTicketData.ticketNumber;
        }
    }

    public bool IsSelected
    {
        set
        {
            _isSelected = value;
            ApplyTicketSelectionUI(value);
        }
        get
        {
            return _isSelected;
        }
    }

    public bool IsAlreadySelected
    {
        set
        {
            _isAlreadySelected = value;
            ApplyTicketSelectionUI(value);

            if (value)
                canvasGroup.alpha = 0.5f;
            else
                canvasGroup.alpha = 1f;
        }
        get
        {
            return _isAlreadySelected;
        }
    }

    public string TicketId
    {
        get
        {
            return gameTicketData.id;
        }
    }
    #endregion
}
