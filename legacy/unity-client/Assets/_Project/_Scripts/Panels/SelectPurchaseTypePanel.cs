using BestHTTP.SocketIO;
using TMPro;
using I2.Loc;
using UnityEngine;

public class SelectPurchaseTypePanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    #endregion

    #region PRIVATE_VARIABLES
    [Header("Game Object")]
    [SerializeField] private GameObject panelRealMoney;
    [SerializeField] private GameObject panelTodaysBalance;

    [Header("Text")]
    [SerializeField] private TextMeshProUGUI txtPoints;
    [SerializeField] private TextMeshProUGUI txtRealMoney;
    [SerializeField] private TextMeshProUGUI txtTodaysBalance;

    [Header("LocalizationParamsManager")]
    [SerializeField] private LocalizationParamsManager localizationParamsManagerCodeAppliedMessage;

    [Header("Input Field")]
    [SerializeField] private TMP_InputField inputVoucherCode;

    private string gameId = "";
    private string Sub_Game_ID = "";
    private int ticketQty = 0;
    private Socket socket;
    #endregion

    #region UNITY_EVENT
    [Header("Unity Events")]
    public CustomUnityEventString eventPurchaseByPoints;
    public CustomUnityEventString eventPurchaseByRealMoney;
    public CustomUnityEventString eventPurchaseByTodaysBalance;
    #endregion

    #region UNITY_CALLBACKS
    private void OnEnable()
    {
        Reset();
        eventPurchaseByPoints.RemoveAllListeners();
        eventPurchaseByRealMoney.RemoveAllListeners();
        eventPurchaseByTodaysBalance.RemoveAllListeners();

        if (Utility.Instance.IsStandAloneVersion())
            StandaloneBuildValidation();

        GameSocketManager.OnSocketReconnected += Reconnect;
    }

    private void OnDisable()
    {
        eventPurchaseByPoints.RemoveAllListeners();
        eventPurchaseByRealMoney.RemoveAllListeners();
        eventPurchaseByTodaysBalance.RemoveAllListeners();

        GameSocketManager.OnSocketReconnected -= Reconnect;
    }
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void Open(string gameId, int ticketQty, Socket socket)
    {
        this.gameId = gameId;
        this.ticketQty = ticketQty;
        this.socket = socket;
        this.Open();
    }

    public void Open(string parent_Game_ID, string sub_Game_ID, int ticketQty, Socket socket)
    {
        this.gameId = parent_Game_ID;
        Sub_Game_ID = sub_Game_ID;
        this.ticketQty = ticketQty;
        this.socket = socket;
        this.Open();
    }

    public void Open(Socket socket)
    {
        this.socket = socket;
        this.Open();
    }

    public void OnCloseButtonTap()
    {
        this.Close();
    }

    public void OnPointsButtonTap()
    {
        eventPurchaseByPoints.Invoke(inputVoucherCode.text);
    }

    public void OnRealMoneyButtonTap()
    {        
        eventPurchaseByRealMoney.Invoke(inputVoucherCode.text);
    }

    public void OnTodaysBalanceButtonTap()
    {
        eventPurchaseByTodaysBalance.Invoke(inputVoucherCode.text);
    }

    public void OnPayButtonTap()
    {
        if (inputVoucherCode.text == "")
        {
#if UNITY_WEBGL
            if (UIManager.Instance.isGameWebGL)
            {
                UIManager.Instance.messagePopup.DisplayMessagePopup(LocalizationManager.GetTranslation("Validation/VoucherCodeInvalid"));
            }
            else
            {
            UIManager.Instance.messagePopup.DisplayMessagePopup("Voucher Code Invalid");
            }
#else
            UIManager.Instance.messagePopup.DisplayMessagePopup(LocalizationManager.GetTranslation("Validation/VoucherCodeInvalid"));
#endif
            return;
        }        
    }

    public void OnApplyButtonTap()
    {
        if (inputVoucherCode.text == "")
        {
#if UNITY_WEBGL
            if (UIManager.Instance.isGameWebGL)
            {
                UIManager.Instance.messagePopup.DisplayMessagePopup(LocalizationManager.GetTranslation("Validation/VoucherCodeInvalid"));
            }
            else
            {
            UIManager.Instance.messagePopup.DisplayMessagePopup("Voucher Code Invalid");
            }
#else
            UIManager.Instance.messagePopup.DisplayMessagePopup(LocalizationManager.GetTranslation("Validation/VoucherCodeInvalid"));
#endif
            return;
        }

        // UIManager.Instance.DisplayLoader(true);
        EventManager.Instance.ApplyVoucherCode(socket, gameId, ticketQty, inputVoucherCode.text, ApplyVoucherCodeHandler);        
    }

    private void ApplyVoucherCodeHandler(Socket socket, Packet packet, object[] args)
    {
        UIManager.Instance.DisplayLoader(false);
        Debug.Log("ApplyVoucherCodeHandler: " + packet.ToString());

        EventResponse<ApplyVoucherCodeResponse> response = JsonUtility.FromJson<EventResponse<ApplyVoucherCodeResponse>>(Utility.Instance.GetPacketString(packet));

        if(response.status == Constants.EventStatus.SUCCESS)
        {
#if !UNITY_WEBGL
            localizationParamsManagerCodeAppliedMessage.SetParameterValue("VALUE1", response.result.percentageOff.ToString());
            localizationParamsManagerCodeAppliedMessage.Open();
#endif
        }
        else
        {            
            inputVoucherCode.text = "";
#if !UNITY_WEBGL
            localizationParamsManagerCodeAppliedMessage.Close();
#endif
            UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
        }

    }

    public void Reconnect()
    {
        
    }

    public void Reset()
    {
        inputVoucherCode.text = "";
#if !UNITY_WEBGL
        localizationParamsManagerCodeAppliedMessage.Close();
#endif
    }
#endregion

#region PRIVATE_METHODS
    private void StandaloneBuildValidation()
    {
        bool isUniqueIdPlayer = UIManager.Instance.gameAssetData.IsUniqueIdPlayer;
        panelRealMoney.SetActive(!isUniqueIdPlayer);
        panelTodaysBalance.SetActive(isUniqueIdPlayer);
    }
#endregion

#region COROUTINES
#endregion

#region GETTER_SETTER
    public string Points
    {
        set
        {
            txtPoints.text = value.ToString();
        }
    }

    public string RealMoney
    {
        set
        {
            txtRealMoney.text = value.ToString();
        }
    }

    public string TodaysBalance
    {
        set
        {
            txtTodaysBalance.text = value.ToString();
        }
    }
#endregion
}
