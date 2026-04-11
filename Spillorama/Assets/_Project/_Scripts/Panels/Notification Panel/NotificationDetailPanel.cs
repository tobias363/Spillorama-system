using I2.Loc;
using System;
using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;

public class NotificationDetailPanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    #endregion

    #region PRIVATE_VARIABLES
    [Header("Text")]
    [SerializeField] private TextMeshProUGUI txtTitle;
    [SerializeField] private TextMeshProUGUI txtTicketData;
    [SerializeField] private TextMeshProUGUI txtLongMessage;
    [SerializeField] private TextMeshProUGUI txtPrice;

    [Header("Scrollview")]
    [SerializeField] private GameObject panelScrollview;

    private DateTime gameStartedTime;
    #endregion

    #region UNITY_CALLBACKS
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void ClosePanel()
    {
        this.Close();
    }

    public void SetData(string msg, string title, string price)
    {
        Reset();

        string startTimeTranslation = LocalizationManager.GetTranslation("Start Time");
        string prizeTranslation = LocalizationManager.GetTranslation("Price");
        txtTicketData.text = msg.ToString();


        // Display the message, title, and price with proper formatting
        txtTicketData.text = msg.ToString(); // Assuming msg is defined somewhere
        txtTitle.text = $"{startTimeTranslation.ToUpper()} : {title.ToString()}";
        txtPrice.text = $"{prizeTranslation.ToUpper()} : {price.ToString()}";
    }

    public void OpenNotificationWithMessag(string title, string message)
    {
        Reset();
        panelScrollview.Open();
        txtTitle.text = Constants.LanguageKey.GetTranslation(title).ToUpper();
        txtLongMessage.text = message;
    }
    #endregion

    #region PRIVATE_METHODS
    private void Reset()
    {
        panelScrollview.Close();
        txtTicketData.text = "";
        txtLongMessage.text = "";
        txtPrice.text = "";
        txtTitle.text = "";
    }
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    #endregion
}
