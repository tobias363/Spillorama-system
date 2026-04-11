using System.Collections;
using System.Collections.Generic;
using BestHTTP.SocketIO;
using UnityEngine;
using UnityEngine.UI;
using TMPro;
using I2.Loc;

public class withdrawPayPanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    public TextMeshProUGUI AmountDetail;

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
    public void SetDataOpen(double Amount,string vpass,VerifyPasswordResponse Resp)
    {
        _amount = Amount;
        Pass = vpass;
        //AmountDetail.text = "Withdraw " + Amount + " amount";
        AmountDetail.GetComponent<LocalizationParamsManager>().SetParameterValue("value", Amount.ToString());
        VerifyPasswordResponseData = Resp;
        this.Open();
    }
    public void PayButttonTap(string operation)
    {
        if (operation.Equals("hall"))
        {
            // UIManager.Instance.DisplayLoader(true);
            EventManager.Instance.WithdrawMoney(_amount, operation, Pass, WithDrawResponse);
        }
        else
        {
            UIManager.Instance.lobbyPanel.walletPanel.withdrawbank.SetDataOpen(_amount, Pass, VerifyPasswordResponseData);
            this.Close();
        }
    }
    public void OnBackButtonTap()
    {
        this.Close();
        UIManager.Instance.lobbyPanel.walletPanel.balancePanel.Open();
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
