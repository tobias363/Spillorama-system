using System;
using System.Collections;
using System.Collections.Generic;
using I2.Loc;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class PrefabTransactionHistoryDetail : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    [SerializeField] private VerticalLayoutGroup vLayoutGroup;
    [SerializeField] private GameObject gameObjectReference;
    #endregion

    #region PRIVATE_VARIABLES
    [Header("Text")]
    [SerializeField] private TextMeshProUGUI txtTransactionAmount;
    [SerializeField] private TextMeshProUGUI txtTransactionType;
    [SerializeField] private TextMeshProUGUI txtTransactionStatus;

    [SerializeField] private LocalizationParamsManager localizationTextTransactionId;
    [SerializeField] private LocalizationParamsManager localizationTextTicketPurchaseFrom;
    [SerializeField] private LocalizationParamsManager localizationTextTransactionDateTime;
    [SerializeField] private LocalizationParamsManager localizationTextTransactionStatus;
    [SerializeField] private LocalizationParamsManager localizationTextReference;

    public TransactionHistory transactionHistory;
    #endregion

    #region UNITY_CALLBACKS
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void SetData(TransactionHistory data)
    {
        transactionHistory = data;
        if (data.status.Equals("Pending"))
        {
            Amountpending = data.amount;
            localizationTextTransactionStatus.SetParameterValue("value", Constants.LanguageKey.PendingMessage);
        }
        else if (data.status.Equals("Success"))
        {
            Amount = data.amount;
            localizationTextTransactionStatus.SetParameterValue("value", Constants.LanguageKey.SuccessMessage);
        }
        else if (data.status.Equals("Rejected"))
        {
            AmountRejected = data.amount;
            localizationTextTransactionStatus.SetParameterValue("value", Constants.LanguageKey.RejectedMessage);
        }
        else if (data.status.Equals("Refunded"))
        {
            Amount = data.amount;
            localizationTextTransactionStatus.SetParameterValue("value", Constants.LanguageKey.RefundedMessage);
        }
        if (!string.IsNullOrEmpty(data.uniqueReference))
        {
            gameObjectReference.SetActive(true);
            vLayoutGroup.spacing = 5;
            localizationTextReference.SetParameterValue("value", data.uniqueReference);
        }
        else
        {
            gameObjectReference.SetActive(false);
            vLayoutGroup.spacing = 20;
        }

#if UNITY_WEBGL
        //        txtTransactionType.text = data.type;
        if (UIManager.Instance.isGameWebGL)
        {
            txtTransactionType.text = data.type;
            // txtTransactionStatus.GetComponent<LocalizationParamsManager>().SetParameterValue("value", data.status);
            localizationTextTransactionId.SetParameterValue("VALUE", data.id.ToString());
            localizationTextTicketPurchaseFrom.SetParameterValue("VALUE", data.purchasedFrom);
            localizationTextTransactionDateTime.SetParameterValue("VALUE", Utility.Instance.GetDateTimeLocal(data.dateAndTime).ToString("MMMM-dd-yyyy hh:mm tt"));
        }

#else
        //        txtTransactionType.text = LocalizationManager.GetTranslation("Transaction Type/" + data.type);

        txtTransactionType.text = data.type;
        // txtTransactionStatus.text = data.status;
        localizationTextTransactionId.SetParameterValue("VALUE", data.id.ToString());
        localizationTextTicketPurchaseFrom.SetParameterValue("VALUE", data.purchasedFrom);
        localizationTextTransactionDateTime.SetParameterValue("VALUE", Utility.Instance.GetDateTimeLocal(data.dateAndTime).ToString("MMMM-dd-yyyy hh:mm tt"));
#endif
    }
    #endregion

    #region PRIVATE_METHODS
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    private float Amount
    {
        set
        {
            txtTransactionAmount.text = Constants.StringClass.currencySymbol;
            if (value > 0)
                txtTransactionAmount.text += $" <color=green>+{value}</color>";
            else
                txtTransactionAmount.text += $" <color=red>{value}</color>";
        }
    }
    private float Amountpending
    {
        set
        {
            txtTransactionAmount.text = Constants.StringClass.currencySymbol;
            if (value > 0)
                txtTransactionAmount.text += $" <color=orange>+{value}</color>";
            else
                txtTransactionAmount.text += $" <color=orange>{value}</color>";
        }
    }
    private float AmountRejected
    {
        set
        {
            txtTransactionAmount.text = Constants.StringClass.currencySymbol;
            if (value > 0)
                txtTransactionAmount.text += $" <color=red>+{value}</color>";
            else
                txtTransactionAmount.text += $" <color=red>{value}</color>";
        }
    }
    #endregion
}
