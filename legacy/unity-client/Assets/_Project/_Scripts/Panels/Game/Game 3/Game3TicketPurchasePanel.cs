using System;
using BestHTTP.SocketIO;
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
        GameSocketManager.OnSocketReconnected += Reconnect;

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
        GameSocketManager.OnSocketReconnected -= Reconnect;
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

    private void Game3PurchaseDataResponse(Socket socket, Packet packet, object[] args)
    {
        Debug.Log("Game3PurchaseDataResponse: " + packet.ToString());
        UIManager.Instance.DisplayLoader(false);

        EventResponse<GetGame3PurchaseDataResponse> response = JsonUtility.FromJson<EventResponse<GetGame3PurchaseDataResponse>>(Utility.Instance.GetPacketString(packet));

        if (response.status == Constants.EventStatus.SUCCESS)
        {
            ticketCount = response.result.minQty;
            minTicketPurchaseCount = response.result.minQty;
            maxTicketPurchaseCount = response.result.maxQty;
            ticketPrice = response.result.price;
            Refresh();

            if (ticketCount == 0)
            {
                UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.TicketNotAvailableMessage, () =>
                {
                    ClosePanel();
                });
            }
        }
        else
        {
            if (response.messageType == Constants.MessageType.SomethingWentWrong)
            {
                UIManager.Instance.messagePopup.DisplayMessagePopup(response.messageType);
                UIManager.Instance.topBarPanel.OnGamesButtonTap();
                return;
            }

            UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
        }
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

    private void Reconnect()
    {
        CallGame3PurchaseDataEvent();
    }

    private void CallGame3PurchaseDataEvent()
    {
        // UIManager.Instance.DisplayLoader(true);
        UIManager.Instance.selectPurchaseTypePanel.Close();
        EventManager.Instance.GetGame3PurchaseData(gameData.gameId, Game3PurchaseDataResponse);
    }

    private void SelectPurchaseType()
    {
        UIManager.Instance.selectPurchaseTypePanel.Open(gameData.gameId, ticketCount, GameSocketManager.SocketGame3);

        UIManager.Instance.selectPurchaseTypePanel.eventPurchaseByPoints.AddListener((string voucherCode) =>
        {
            CallPurchaseEvent("points", voucherCode);
        });

        UIManager.Instance.selectPurchaseTypePanel.eventPurchaseByRealMoney.AddListener((string voucherCode) =>
        {
            CallPurchaseEvent("realMoney", voucherCode);
        });

        UIManager.Instance.selectPurchaseTypePanel.eventPurchaseByTodaysBalance.AddListener((string voucherCode) =>
        {
            CallPurchaseEvent("realMoney", voucherCode);
        });
    }

    private void CallPurchaseEvent(string purchaseType, string voucherCode = "")
    {
        // UIManager.Instance.DisplayLoader(true);
        EventManager.Instance.PurchaseGame3Tickets(gameData.gameId, ticketCount, purchaseType, voucherCode, PurchaseGame3TicketsResponse);
    }

    private void PurchaseGame3TicketsResponse(Socket socket, Packet packet, object[] args)
    {
        Debug.Log($"PurchaseGame3TicketsResponse: {packet}");
        UIManager.Instance.DisplayLoader(false);
        UIManager.Instance.selectPurchaseTypePanel.Close();

        EventResponse response = JsonUtility.FromJson<EventResponse>(Utility.Instance.GetPacketString(packet));

        if (response.status == Constants.EventStatus.SUCCESS)
            BackgroundManager.Instance.PlayerUpdateIntervalCall();
        else
        {
            if (response.messageType == Constants.MessageType.SomethingWentWrong)
            {
                UIManager.Instance.messagePopup.DisplayMessagePopup(response.messageType);
                UIManager.Instance.topBarPanel.OnGamesButtonTap();
                return;
            }

            UIManager.Instance.selectPurchaseTypePanel.Reset();
        }

        UIManager.Instance.messagePopup.DisplayMessagePopup(response.message, () =>
        {
            ClosePanel();
        });
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