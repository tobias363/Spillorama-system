using System.Collections;
using System.Collections.Generic;
using BestHTTP.SocketIO;
using I2.Loc;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class AddCardDetailsPanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    #endregion

    #region PRIVATE_VARIABLES
    [Header("Input Field")]
    [SerializeField] private TMP_InputField inputCardHolderName;
    [SerializeField] private TMP_InputField inputCardNumber;
    [SerializeField] private TMP_InputField inputCardExpiryMMYY;    
    [SerializeField] private TMP_InputField inputCardCVV;

    [Header("Text")]
    [SerializeField] private TextMeshProUGUI inputCardExpiryMMYYOutputView;

    [Header("Toggle")]
    [SerializeField] private Toggle toggleSaveCardDetails;
    #endregion

    #region UNITY_CALLBACKS
    private void OnEnable()
    {
        Reset();
        //UIManager.Instance.DisplayLoader(true);
        //EventManager.instance.GetCardDetails(GetCardDetailsResponse);
    }
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void OnBackButtonTap()
    {
        this.Close();
        UIManager.Instance.lobbyPanel.walletPanel.depositMoney.Open();
    }

    public void RefreshExpiryDate()
    {
        string actualString = inputCardExpiryMMYY.text;
        string outputString = "";

        if (actualString.Length == 0)
            outputString = "--/--";
        else if(actualString.Length == 1)
            outputString = actualString + "-/--";
        else if (actualString.Length == 2)
            outputString = actualString + "/--";
        else if (actualString.Length == 3)
            outputString = actualString.Substring(0,2) + "/" + actualString.Substring(2, 1) + "-";
        else if (actualString.Length == 4)
            outputString = actualString.Substring(0, 2) + "/" + actualString.Substring(2, 2);

        inputCardExpiryMMYYOutputView.text = outputString;
    }

    public void OnPayButtonTap()
    {
        if(ValidateAllFields())
        {
            //UIManager.Instance.DisplayLoader(true);
            //EventManager.instance.DepositMoney(toggleSaveCardDetails.isOn, inputCardHolderName.text, inputCardNumber.text,
            //    inputCardExpiryMMYYOutputView.text, inputCardCVV.text, UIManager.Instance.lobbyPanel.walletPanel.depositMoney.Amount, DepositMoneyResponse);
            Application.OpenURL("www.google.com");
        }
    }
    #endregion

    #region PRIVATE_METHODS
    private void Reset()
    {
        inputCardHolderName.text = "";
        inputCardNumber.text = "";
        inputCardExpiryMMYY.text = "";
        RefreshExpiryDate();
        inputCardCVV.text = "";
    }

    private bool ValidateAllFields()
    {
        if (inputCardHolderName.text.Length == 0)
        {
#if UNITY_WEBGL
            if (UIManager.Instance.isGameWebGL)
            {
                UIManager.Instance.messagePopup.DisplayMessagePopup(LocalizationManager.GetTranslation("Validation/CardHolderNameInvalid"));
            }
            else
            {
            UIManager.Instance.messagePopup.DisplayMessagePopup("Card Holder Name Invalid");
            }
#else
            UIManager.Instance.messagePopup.DisplayMessagePopup(LocalizationManager.GetTranslation("Validation/CardHolderNameInvalid"));
#endif
            return false;
        }
        else if (inputCardNumber.text.Length == 0)
        {
#if UNITY_WEBGL
            if (UIManager.Instance.isGameWebGL)
            {
                UIManager.Instance.messagePopup.DisplayMessagePopup(LocalizationManager.GetTranslation("Validation/CardNumberInvalid"));
            }
            else
            {
            UIManager.Instance.messagePopup.DisplayMessagePopup("Card Number Invalid");
            }
#else
            UIManager.Instance.messagePopup.DisplayMessagePopup(LocalizationManager.GetTranslation("Validation/CardNumberInvalid"));
#endif
            return false;
        }
        else if (inputCardExpiryMMYY.text.Length != 4)
        {
#if UNITY_WEBGL
            if (UIManager.Instance.isGameWebGL)
            {
                UIManager.Instance.messagePopup.DisplayMessagePopup(LocalizationManager.GetTranslation("Validation/CardExpiryDateInvalid"));
            }
            else
            {
            UIManager.Instance.messagePopup.DisplayMessagePopup("Card Expiry Date Invalid");
            }
#else
            UIManager.Instance.messagePopup.DisplayMessagePopup(LocalizationManager.GetTranslation("Validation/CardExpiryDateInvalid"));
#endif
            return false;
        }
        else if (inputCardCVV.text.Length != 3)
        {
#if UNITY_WEBGL
            if (UIManager.Instance.isGameWebGL)
            {
                UIManager.Instance.messagePopup.DisplayMessagePopup(LocalizationManager.GetTranslation("Validation/CVVInvalid"));
            }
            else
            {
            UIManager.Instance.messagePopup.DisplayMessagePopup("CVV Invalid");
            }
#else
            UIManager.Instance.messagePopup.DisplayMessagePopup(LocalizationManager.GetTranslation("Validation/CVVInvalid"));
#endif
            return false;
        }

        return true;
    }

    private void DepositMoneyResponse(Socket socket, Packet packet, params object[] args)
    {
        Debug.Log($"DepositMoneyResponse: {packet}");
        UIManager.Instance.DisplayLoader(false);

        EventResponse response = JsonUtility.FromJson<EventResponse>(Utility.Instance.GetPacketString(packet));

        if (response.status == Constants.EventStatus.SUCCESS)
        {
            Application.OpenURL(response.result);
        }
        else
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
        }
    }

    private void GetCardDetailsResponse(Socket socket, Packet packet, params object[] args)
    {
        Debug.Log($"GetCardDetailsResponse: {packet}");
        UIManager.Instance.DisplayLoader(false);

        EventResponse<GetCardDetailsResponse> response = JsonUtility.FromJson<EventResponse<GetCardDetailsResponse>>(Utility.Instance.GetPacketString(packet));

        if (response.status == Constants.EventStatus.SUCCESS)
        {
            toggleSaveCardDetails.isOn = response.result.cardSaved;

            inputCardHolderName.text = response.result.cardHolderName;
            inputCardNumber.text = response.result.cardNumber;
            inputCardExpiryMMYY.text = response.result.cardExpiry;
            RefreshExpiryDate();
            inputCardCVV.text = response.result.cvv;
        }
    }
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    #endregion
}
