using System;
using System.Collections;
using System.Collections.Generic;
using BestHTTP.SocketIO;
#if !UNITY_WEBGL
using I2.Loc;
#endif
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class DepositMoney : MonoBehaviour
{
    #region PUBLIC_VARIABLES

    public Button Decreament_Btn;

    #endregion

    #region PRIVATE_VARIABLES

    [Header("Input Field")]
    [SerializeField] private TMP_InputField inputAmount;

    #endregion

    #region UNITY_CALLBACKS
    private void OnEnable()
    {
        inputAmount.text = "";
        Decreament_Btn.interactable = false;
    }
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS

    public void OnBackButtonTap()
    {
        this.Close();
        UIManager.Instance.lobbyPanel.walletPanel.balancePanel.Open();
    }

    public void OnProceedToPayButtonTap()
    {        
        double amount = 0;
        double.TryParse(inputAmount.text, out amount);
        if (amount > 0)
        {
            UIManager.Instance.lobbyPanel.walletPanel.payTypePanel.SetDataOpen(amount);
            //EventManager.Instance.DepositMoney(amount, DepositMoneyResponse);
        }
    }    

    public void PositiveValueValidation()
    {
        inputAmount.text = inputAmount.text.Replace("-", "");
        Change_Withdraw_Amount(0);
    }

    public void Change_Withdraw_Amount(int value)
    {
        int amount = 0;
        try
        {
            if (inputAmount.text == "" && value == 1)
                inputAmount.text = "0";
            amount = int.Parse(inputAmount.text);
            if (value != 0)
            {
                amount += value;
                inputAmount.text = amount != 0 ? amount.ToString() : "";
            }
            else if (amount == 0 && value != 0)
                inputAmount.text = "";
        }
        catch
        {
            inputAmount.text = "";
        }
        Decreament_Btn.interactable = amount > 0;
    }

    #endregion

    #region PRIVATE_METHODS
    private void DepositMoneyResponse(Socket socket, Packet packet, object[] args)
    {
        UIManager.Instance.DisplayLoader(false);
        Debug.Log($"DepositMoneyResponse: {packet}");
        EventResponse response = JsonUtility.FromJson<EventResponse>(Utility.Instance.GetPacketString(packet));

        if (response.status == Constants.EventStatus.SUCCESS)
        {
#if UNITY_WEBGL
            UIManager.Instance.messagePopup.DisplayConfirmationPopup("Redirecting to secure payment server", "Proceed", "Cancel", ()=>{
#else
            UIManager.Instance.messagePopup.DisplayConfirmationPopup("Redirecting to secure payment server", LocalizationManager.GetTranslation("Proceed"), LocalizationManager.GetTranslation("Cancel"), ()=>{
#endif
                inputAmount.text = "";
                Utility.Instance.OpenLink(response.result);
            }, null);
        }
        else
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
        }
    }
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    #endregion
}
