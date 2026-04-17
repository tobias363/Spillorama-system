using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using TMPro;
using I2.Loc;
using BestHTTP.SocketIO;

public class TransactionTypePanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    public TextMeshProUGUI AmountDetail;

    #endregion

    #region PRIVATE_VARIABLES
    [SerializeField] double _amount;
    #endregion

    #region UNITY_CALLBACKS

    private void OnEnable()
    {
        UIManager.Instance.webViewManager.CloseWebs();
    }

    private void OnDisable()
    {
        AmountDetail.text = "";
    }
    #endregion

    #region DELEGATE_CALLBACKS
    private void DepositMoneyResponse(Socket socket, Packet packet, object[] args)
    {
        UIManager.Instance.DisplayLoader(false);
        Debug.Log($"DepositMoneyResponse: {packet}");
        EventResponse response = JsonUtility.FromJson<EventResponse>(Utility.Instance.GetPacketString(packet));
        UIManager.Instance.DisplayLoader(false);
        if (response.status == Constants.EventStatus.SUCCESS)
        {
#if UNITY_STANDALONE_WIN
            UIManager.Instance.webViewManager.SetdataOpenrlStandlone(response.result);
#elif UNITY_ANDROID
        UIManager.Instance.webViewManager.ShowUrlPopupMarginsFULLSCREEN(response.result);  
#elif UNITY_IOS
        UIManager.Instance.webViewManager.ShowUrlPopupMargins(response.result);
#elif UNITY_STANDALONE_LINUX
            Utility.Instance.OpenLink(response.result);
#elif UNITY_WEBGL && !UNITY_EDITOR
		//ExternalCallClass.Instance.OpenUrl(response.result);
        UIManager.Instance.webViewManager.SetdataOpenrlStandlone(response.result);
#endif
        }
        else if (response.status == Constants.EventStatus.OFFLINESUCCESS)
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
        }
        else
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
        }
    }
    #endregion

    #region PUBLIC_METHODS
    public void SetDataOpen(double Amount)
    {
        _amount = Amount;
        AmountDetail.GetComponent<LocalizationParamsManager>().SetParameterValue("value", _amount.ToString());
        this.Open();
    }
    public void PayButttonTap(string operation)
    {
        // UIManager.Instance.DisplayLoader(true);
        EventManager.Instance.DepositMoney(_amount, operation, UIManager.Instance.webViewManager.ua, DepositMoneyResponse);
    }
    public void OnBackButtonTap()
    {
        this.Close();
        UIManager.Instance.lobbyPanel.walletPanel.depositMoney.Open();
    }
    #endregion

    #region PRIVATE_METHODS
    private void CloseAllPanels()
    {


    }
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    #endregion
}
