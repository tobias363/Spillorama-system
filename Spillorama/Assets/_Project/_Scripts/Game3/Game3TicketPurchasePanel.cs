using System;
using I2.Loc;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class Game3TicketPurchasePanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES    
    #endregion

    #region PRIVATE_VARIABLES

    [Header("LocalizationParamsManager")]
    [SerializeField] private LocalizationParamsManager localizationParamsManagerPrice;
    [SerializeField] private LocalizationParamsManager localizationParamsManagerNote;

    [Header("Buttons")]
    [SerializeField] private Button btnIncreaseTicket;
    [SerializeField] private Button btnDecreaseTicket;

    [Header("Text")]
    [SerializeField] private TextMeshProUGUI txtTicketCount;

    [Header("Data")]
    [SerializeField] private GameData gameData;

    private int minTicketPurchaseCount = 1;
    private int maxTicketPurchaseCount = 30;

    private int ticketCount = 5;
    private double ticketPrice = 10;
    #endregion

    #region UNITY_CALLBACKS
    private void Awake()
    {
        txtTicketCount.text = ticketCount.ToString();
        SingleTicketPrice = ticketPrice;
        TotalTicketsPrice = ticketCount * ticketPrice;
    }
    #endregion

    #region DELEGATE_CALLBACKS
    private void OnEnable()
    {
        UIManager.Instance.selectPurchaseTypePanel.Close();
        // Spillorama handles reconnection via SpilloramaSocketManager

        if (Utility.Instance.IsStandAloneVersion())
        {
            Transform transformLobbyPanel = UIManager.Instance.lobbyPanel.transform;
            UIManager.Instance.game3Panel.transform.SetParent(transformLobbyPanel.parent);
            UIManager.Instance.game3Panel.transform.SetSiblingIndex(transformLobbyPanel.GetSiblingIndex() + 1);
            //UIManager.Instance.multipleGameScreenManager.RefreshPage();
            Utility.Instance.StretchAllZero(UIManager.Instance.game3Panel.GetComponent<RectTransform>());
        }
    }

    private void OnDisable()
    {
        UIManager.Instance.selectPurchaseTypePanel.Close();
    }
    #endregion

    #region PUBLIC_METHODS    

    public void OpenPanel(GameData gameData)
    {
        this.Open();
        this.gameData = gameData;

        //Invoke("CallGame3PurchaseDataEvent", 0.1f);
        CallGame3PurchaseDataEvent();
    }

    public void OnBuyButtonTap()
    {
        SelectPurchaseType();
    }

    public void ModifyTicketCount(bool incrementAction)
    {
        if (incrementAction)
            ticketCount++;
        else
            ticketCount--;

        Refresh();
    }

    public void ClosePanel()
    {
        UIManager.Instance.selectPurchaseTypePanel.Close();
        UIManager.Instance.game3Panel.Close();
        UIManager.Instance.lobbyPanel.OpenGamePlanPanel();
    }
    #endregion

    #region PRIVATE_METHODS
    private void Refresh()
    {
        btnDecreaseTicket.interactable = true;
        btnIncreaseTicket.interactable = true;

        if (ticketCount == minTicketPurchaseCount)
        {
            btnDecreaseTicket.interactable = false;
        }

        if (ticketCount == maxTicketPurchaseCount)
        {
            btnIncreaseTicket.interactable = false;
        }

        txtTicketCount.text = ticketCount.ToString();
        SingleTicketPrice = ticketPrice;
        TotalTicketsPrice = (ticketCount * ticketPrice);
    }

    private void CallGame3PurchaseDataEvent()
    {
        UIManager.Instance.selectPurchaseTypePanel.Close();
        // TODO: Replace with Spillorama REST endpoint for Game3 purchase data
        Debug.LogWarning("[Game3] CallGame3PurchaseDataEvent: Spillorama endpoint not yet implemented");
        UIManager.Instance.DisplayLoader(false);
    }

    private void SelectPurchaseType()
    {
        CallPurchaseEvent("realMoney", "");
    }

    private void CallPurchaseEvent(string purchaseType, string voucherCode = "")
    {
        // TODO: Replace with Spillorama REST endpoint for Game3 ticket purchase
        Debug.LogWarning("[Game3] CallPurchaseEvent: Spillorama endpoint not yet implemented");
        UIManager.Instance.DisplayLoader(false);
    }
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    public double SingleTicketPrice
    {
        set
        {
#if !UNITY_WEBGL
            localizationParamsManagerPrice.SetParameterValue("VALUE2", value + "kr");
#endif
        }
    }

    public double TotalTicketsPrice
    {
        set
        {
#if !UNITY_WEBGL
            localizationParamsManagerPrice.SetParameterValue("VALUE1", value + "kr");
            localizationParamsManagerNote.SetParameterValue("VALUE1", value + "kr");
#endif
        }
    }
    #endregion
}