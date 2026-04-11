using System;
using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class PrefabNotificationMessagePanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    #endregion

    #region PRIVATE_VARIABLES
    [Header("Text")]
    [SerializeField] private TextMeshProUGUI txtNotificationMessage;

    [Header("Image")]
    [SerializeField] private Image imgViewIcon;
    public NotificationsData data = new NotificationsData();
    private DateTime gameStartedTime;
    #endregion

    #region UNITY_CALLBACKS
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void OnClick()
    {
        UIManager.Instance.notificationPanel.notificationDetailPanel.Open();

        if (data.notificationType == "winning")
        {

            Debug.Log(1);
            UIManager.Instance.notificationPanel.notificationDetailPanel.OpenNotificationWithMessag(data.notificationType, data.message);
        }
        else if (data.notificationType.Equals("purchasedTickets"))
        {
            Debug.Log(2);
            DateTime utcDate = DateTime.Parse(data.date, null, System.Globalization.DateTimeStyles.AssumeUniversal);
            DateTime localDate = utcDate.ToLocalTime();
            string formattedDate = localDate.ToString("dd/MM/yyyy HH:mm");
            //gameStartedTime = formattedDate;
            //gameStartedTime = Utility.Instance.GetDateTimeLocal(this.data.date);
            UIManager.Instance.notificationPanel.notificationDetailPanel.SetData(data.ticketMessage, localDate.ToString("hh:mm tt"), data.price.ToString());
            //UIManager.Instance.notificationPanel.notificationDetailPanel.SetData(data.ticketMessage, gameStartedTime.ToString("hh:mm tt"), data.price.ToString());
        }
        else
        {
            Debug.Log(3);
            UIManager.Instance.notificationPanel.notificationDetailPanel.OpenNotificationWithMessag(data.notificationType, data.message);
        }
    }
    public void SetData(NotificationsData data)
    {
        //if (data.notificationType.Equals("purchasedTickets") || data.notificationType.Equals("winning"))
        //{
        //    imgViewIcon.Open();
        //}
        //else
        //{
        //    imgViewIcon.Close();
        //}
        DateTime utcDate = DateTime.Parse(data.notificationDateAndTime, null, System.Globalization.DateTimeStyles.AssumeUniversal);
        DateTime localDate = utcDate.ToLocalTime();
        string formattedDate = localDate.ToString("dd/MM/yyyy HH:mm");
        imgViewIcon.Open();
        txtNotificationMessage.text = formattedDate + data.message.ToString();
        //this.data.message = data.message;
        //this.data.date = data.date;
        //this.data.price = data.price;
        //this.data.notificationType = data.notificationType;
        this.data = data;
    }
    #endregion

    #region PRIVATE_METHODS
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    #endregion
}
