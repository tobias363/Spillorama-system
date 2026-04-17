using System.Collections;
using System.Collections.Generic;
using BestHTTP.SocketIO;
using UnityEngine;
using UnityEngine.UI;
using TMPro;
using I2.Loc;

public class withdrawbankPanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    public TextMeshProUGUI AmountDetail;
    public TextMeshProUGUI AccountDetail;

    #endregion

    #region PRIVATE_VARIABLES
    [SerializeField] double _amount;
    [SerializeField] VerifyPasswordResponse VerifyPasswordResponseData;
    [SerializeField] string Pass;
    #endregion

    #region UNITY_CALLBACKS


    private void OnDisable()
    {
        AmountDetail.text = "";
        AccountDetail.text = "";
        Pass = "";

    }
    #endregion

    #region DELEGATE_CALLBACKS
    private void WithDrawResponse(Socket socket, Packet packet, object[] args)
    {
        UIManager.Instance.DisplayLoader(false);
        Debug.Log($"WithDrawResponse : {packet}");
        EventResponse response = JsonUtility.FromJson<EventResponse>(Utility.Instance.GetPacketString(packet));
        UIManager.Instance.DisplayLoader(false);
        if (response.status == Constants.EventStatus.SUCCESS)
        {
            UIManager.Instance.topBarPanel.OnGamesButtonTap();
            UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
        }
        else
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
        }
    }
    #endregion

    #region PUBLIC_METHODS
    public void SetDataOpen(double Amount, string vpass, VerifyPasswordResponse Resp)
    {
        _amount = Amount;
        Pass = vpass;
        //AmountDetail.text = "An amount of " + Amount + " KR is transferred to a bank account";
        AmountDetail.GetComponent<LocalizationParamsManager>().SetParameterValue("value", Amount.ToString());

        AccountDetail.text = Resp.bankAccountNumber;
        VerifyPasswordResponseData = Resp;
        this.Open();
    }
    public void ConfirmButtonTap()
    {
        // UIManager.Instance.DisplayLoader(true);

        EventManager.Instance.WithdrawMoney(_amount, "bank", Pass, WithDrawResponse);
    }
    public void OnBackButtonTap()
    {
        this.Close();
        UIManager.Instance.lobbyPanel.walletPanel.balancePanel.Open();
    }
    #endregion

    #region PRIVATE_METHODS
    
    
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    #endregion
}
