using System.Collections.Generic;
using TMPro;
using UnityEngine;

public class Game1TicketPurchasePanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    #endregion

    #region PRIVATE_VARIABLES
    [Header("Data")]
    [SerializeField] private GameData gameData;

    [Header("Game Object")]
    [SerializeField] private GameObject panelPurchasePopup;

    [Header("Text")]
    [SerializeField] private TextMeshProUGUI txtHeader;

    [Header("Prefab")]
    [SerializeField] private PrefabGame1TicketPurchaseSubType prefabTicketPurchaseSubType;

    [Header("Transform")]    
    [SerializeField] private Transform transformTicketContainer;

    [Header("RectTransform")]
    [SerializeField] private RectTransform rectTransformPopup;

    [Header("List")]
    [SerializeField] private List<PrefabGame1TicketPurchaseSubType> listTicketPurchaseType;

    [Header("Data")]
    [SerializeField] private Game1PurchaseDataResponse purchaseDataResponse;

    public int totalSelectedTicketCount = 0;
    public string Game1PurchaseDataJsonString = "";

    private int defaultPopupHeight = 412;
    #endregion

    #region UNITY_CALLBACKS
    private void OnEnable()
    {
        panelPurchasePopup.Close();
        UIManager.Instance.selectPurchaseTypePanel.Close();
        // Spillorama handles reconnection via SpilloramaSocketManager

        if (Utility.Instance.IsStandAloneVersion())
        {
            Transform transformLobbyPanel = UIManager.Instance.lobbyPanel.transform;
            UIManager.Instance.game1Panel.transform.SetParent(transformLobbyPanel.parent);
            UIManager.Instance.game1Panel.transform.SetSiblingIndex(transformLobbyPanel.GetSiblingIndex() + 1);
            //UIManager.Instance.multipleGameScreenManager.RefreshPage();
            Utility.Instance.StretchAllZero(UIManager.Instance.game1Panel.GetComponent<RectTransform>());
        }
    }

    private void OnDisable()
    {
        UIManager.Instance.selectPurchaseTypePanel.Close();
    }
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void OpenPanel(GameData gameData)
    {        
        this.gameData = gameData;
        this.Open();

        txtHeader.text = gameData.gameName;
        CallGame1PurchaseDataEvent();
        //Invoke("CallGame1PurchaseDataEvent", 0.1f);
    }

    public void OpenPanel(GameData gameData, Game1PurchaseDataResponse result)
    {
        this.gameData = gameData;
        this.Open();

        txtHeader.text = gameData.gameName;
        SetEventResponseData(result);
    }

    public void OnBuyButtonTap()
    {
        if (GetTotalTicketQty() > 0)
            SelectPurchaseType();
        else
            UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.SelectAtLeastOneTicketMessage);
    }

    public void RefreshTotalTicketCount()
    {
        totalSelectedTicketCount = 0;
        foreach(PrefabGame1TicketPurchaseSubType ticketSubType in listTicketPurchaseType)
        {
            totalSelectedTicketCount += ticketSubType.CurrentQty;
        }

        int remainingTicketCount = purchaseDataResponse.playerMaxQty - totalSelectedTicketCount;
        bool allowPurchase = remainingTicketCount > 0;
        foreach (PrefabGame1TicketPurchaseSubType ticketSubType in listTicketPurchaseType)
        {
            ticketSubType.AllowMorePurchase(allowPurchase);
        }
    }

    public void ClosePanel()
    {
        UIManager.Instance.selectPurchaseTypePanel.Close();
        UIManager.Instance.game1Panel.Close();
        UIManager.Instance.lobbyPanel.OpenGamePlanPanel();
    }
    #endregion

    #region PRIVATE_METHODS
    private void CallGame1PurchaseDataEvent()
    {
        // TODO: Replace with Spillorama REST endpoint for Game1 purchase data
        Debug.LogWarning("[Game1] CallGame1PurchaseDataEvent: Spillorama endpoint not yet implemented");
        UIManager.Instance.DisplayLoader(false);
    }

    private void SetEventResponseData(Game1PurchaseDataResponse result)
    {
        Reset();
        panelPurchasePopup.Open();
        purchaseDataResponse = result;
        GenerateTicketTypeData(result.ticketTypeList);
        RefreshTotalTicketCount();

        if (result.ticketTypeList.Count == 0)
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.TicketNotAvailableMessage, () =>
            {
                ClosePanel();
            });
        }
    }

    private void GenerateTicketTypeData(List<Game1TicketType> ticketTypeList)
    {
        foreach(Game1TicketType ticketData in ticketTypeList)
        {
            PrefabGame1TicketPurchaseSubType prefabTicket = Instantiate(prefabTicketPurchaseSubType, transformTicketContainer);
            prefabTicket.SetData(ticketData);
            listTicketPurchaseType.Add(prefabTicket);
        }

        ModifyPopupHeight(ticketTypeList.Count);
    }

    private void ModifyPopupHeight(int ticketCount)
    {
        int newPopupHeight;
        int ticketHeightAndYSpace = 98;
        int maxOnScreenTicketCount = 8;
        int safeSize = 88;

        if (ticketCount >= maxOnScreenTicketCount)        
            newPopupHeight = (defaultPopupHeight - safeSize) + ((maxOnScreenTicketCount/2) * ticketHeightAndYSpace);    
        else        
        {
            int rows = ticketCount % 2 == 0 ? (ticketCount / 2) : ((ticketCount + 1) / 2);
            newPopupHeight = (defaultPopupHeight - safeSize) + (rows * ticketHeightAndYSpace);
        }
        
        rectTransformPopup.sizeDelta = new Vector2(rectTransformPopup.sizeDelta.x, newPopupHeight);
    }

    private void SelectPurchaseType()
    {
        CallPurchaseEvent("realMoney", "");
    }

    private void CallPurchaseEvent(string purchaseType, string voucherCode = "")
    {
        // TODO: Replace with Spillorama REST endpoint for Game1 ticket purchase
        Debug.LogWarning("[Game1] CallPurchaseEvent: Spillorama endpoint not yet implemented");
        UIManager.Instance.DisplayLoader(false);
    }    

    private List<Game1TicketType> GetTicketPurchaseDataList()
    {
        List<Game1TicketType> list = new List<Game1TicketType>();

        foreach (PrefabGame1TicketPurchaseSubType ticket in listTicketPurchaseType)
        {
            if(ticket.TicketData.currentQty > 0)
                list.Add(ticket.TicketData);
        }

        return list;
    }

    private int GetTotalTicketQty()
    {
        int totalTicketQty = 0;

        foreach (PrefabGame1TicketPurchaseSubType ticket in listTicketPurchaseType)
        {
            if (ticket.TicketData.currentQty > 0)
                totalTicketQty++;
        }

        return totalTicketQty;
    }

    private void Reset()
    {
        foreach(PrefabGame1TicketPurchaseSubType ticket in listTicketPurchaseType)        
            Destroy(ticket.gameObject);
        listTicketPurchaseType.Clear();
    }
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    #endregion
}
