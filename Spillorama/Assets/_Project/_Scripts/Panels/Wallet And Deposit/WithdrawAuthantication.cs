using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using TMPro;
using BestHTTP.SocketIO;

public class WithdrawAuthantication : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    #endregion

    #region PRIVATE_VARIABLES
    [Header("Text")]
    [SerializeField] private TMP_InputField txtPassword;

    #endregion

    #region UNITY_CALLBACKS
    private void OnEnable()
    {
        txtPassword.text = "";
    }
    private void OnDisable()
    {
        txtPassword.text = "";
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

    public void OnSubmitButtonTap()
    {
        if (!Validate())
        {
            print("Validation Fail");
            return;
        }
        EventManager.Instance.VerifyPassword(txtPassword.text, VerifyPasswordResponse);
          
    }
    //Setdatapen
    #endregion

    #region PRIVATE_METHODS
    private void VerifyPasswordResponse(Socket socket, Packet packet, object[] args)
    {
        UIManager.Instance.DisplayLoader(false);
        Debug.Log($"VerifyPasswordResponse: {packet}");
        EventResponse<VerifyPasswordResponse> response = JsonUtility.FromJson<EventResponse<VerifyPasswordResponse>>(Utility.Instance.GetPacketString(packet));
        UIManager.Instance.DisplayLoader(false);
        if (response.status == Constants.EventStatus.SUCCESS)
        {
            UIManager.Instance.lobbyPanel.walletPanel.withdrawMoney.Setdatapen(txtPassword.text,response.result);
            this.Close();
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
    private bool Validate()
    {
         
        string password = txtPassword.text; 

        if (password == "")
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.PleaseEnterPasswordMessage);
            return false;
        }
        else if (password.Length < Constants.InputData.minimumPasswordLength)
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.MinimumPasswordLengthMessage +" " + Constants.InputData.minimumPasswordLength);
            return false;
        }
         
        return true;
    }
    #endregion
}
