using System.Collections;
using System.Collections.Generic;
using BestHTTP.SocketIO;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class WithdrawMoney : MonoBehaviour
{
    #region PUBLIC_VARIABLES

    //public Button Increament_Btn, Decreament_Btn;

    #endregion

    #region PRIVATE_VARIABLES
    [Header("Input Field")]
    [SerializeField] private TMP_InputField inputAmount;
    [SerializeField] string Pass;
    [SerializeField] VerifyPasswordResponse VerifyPasswordResponseData;

    #endregion

    #region UNITY_CALLBACKS
    private void OnEnable()
    {
        Reset();
    }
    private void OnDisable()
    {
        Pass = "";
    }
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void Setdatapen(string Data,VerifyPasswordResponse resp)
    {
        Pass = Data;
        VerifyPasswordResponseData = resp;
        this.Open();
    }
    public void OnBackButtonTap()
    {
        this.Close();
        UIManager.Instance.lobbyPanel.walletPanel.balancePanel.Open();
    }

    public void OnWithdrawButtonTap()
    {
        //for testing
        //UIManager.Instance.messagePopup.DisplayMessagePopup("We have accepted your withdrawal request and it will be credited to your account in 3-4 business days.");

        double amount = 0;
        double.TryParse(inputAmount.text, out amount);
        if (amount > 0)
        {
            //UIManager.Instance.DisplayLoader(true);

            UIManager.Instance.lobbyPanel.walletPanel.withdrawPayPanel.SetDataOpen(amount, Pass,VerifyPasswordResponseData);
            this.Close();
            //EventManager.Instance.WithdrawMoney(amount, WithdrawMoneyResponse);
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
        //Decreament_Btn.interactable = amount > 0;
        //Increament_Btn.interactable = int.Parse(UIManager.Instance.gameAssetData.playerGameData._realMoney) > amount;   // (int)UIManager.Instance.gameAssetData.playerGameData._realMoney > amount;
    }

    #endregion

    #region PRIVATE_METHODS
    private void WithdrawMoneyResponse(Socket socket, Packet packet, params object[] args)
    {
        Debug.Log($"WithdrawMoneyResponse: {packet}");
        UIManager.Instance.DisplayLoader(false);

        EventResponse response = JsonUtility.FromJson<EventResponse>(Utility.Instance.GetPacketString(packet));

        if (response.status == Constants.EventStatus.SUCCESS)
        {            
            BackgroundManager.Instance.PlayerUpdateIntervalCall();
            Reset();
        }

        UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
    }

    private void Reset()
    {
        inputAmount.text = "";
        //Increament_Btn.interactable = true;
        //Decreament_Btn.interactable = false;
    }
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    #endregion
}
