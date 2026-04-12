using System.Collections.Generic;
using TMPro;
using UnityEngine;

public class NotificationPanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    public NotificationDetailPanel notificationDetailPanel;
    #endregion

    #region PRIVATE_VARIABLES
    [Header("Text")]
    [SerializeField] private TextMeshProUGUI txtRecordNotFound;

    [Header("Transform")]
    [SerializeField] private Transform transformTransactionContainer;

    [Header("Prefabs")]
    [SerializeField] private PrefabNotificationMessagePanel prefabNotificationDetail;
    #endregion

    #region UNITY_CALLBACKS
    private void OnEnable()
    {
        Reset();
        notificationDetailPanel.Close();
        FetchNotifications_Spillorama();
    }
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void OnBackButtonTap()
    {
        this.Close();
        // Reopen previously active game panel if it exists
        if (UIManager.Instance.previouslyActiveGamePanel != null)
        {
            if (UIManager.Instance.previouslyActiveGamePanel.Equals(UIManager.Instance.game1Panel))
            {
                UIManager.Instance.lobbyPanel.gamePlanPanel.OnGame1ButtonTap();
                // UIManager.Instance.game1Panel.Open();
                // UIManager.Instance.game1Panel.game1GamePlayPanel.CallSubscribeRoom();
            }
            else if (UIManager.Instance.previouslyActiveGamePanel.Equals(UIManager.Instance.game2Panel))
            {
                UIManager.Instance.lobbyPanel.gamePlanPanel.OnGame2ButtonTap();
                // UIManager.Instance.game2Panel.Open();
                // UIManager.Instance.game2Panel.game2PlayPanel.CallSubscribeRoom();
            }
            else if (UIManager.Instance.previouslyActiveGamePanel.Equals(UIManager.Instance.game3Panel))
            {
                UIManager.Instance.lobbyPanel.gamePlanPanel.OnGame3ButtonTap();
                // UIManager.Instance.game3Panel.Open();
                // UIManager.Instance.game3Panel.game3GamePlayPanel.CallSubscribeRoom();
            }
            else if (UIManager.Instance.previouslyActiveGamePanel.Equals(UIManager.Instance.game4Panel))
            {
                UIManager.Instance.game4Panel.OpenPanel();
                switch (true)
                {
                    case true when UIManager.Instance.previouslyActiveGame4Theme1:
                        UIManager.Instance.game4Panel.game4GamePlayPanel.themeBtn1.OnButtonTap();
                        break;
                    case true when UIManager.Instance.previouslyActiveGame4Theme2:
                        UIManager.Instance.game4Panel.game4GamePlayPanel.themeBtn2.OnButtonTap();
                        break;
                    case true when UIManager.Instance.previouslyActiveGame4Theme3:
                        UIManager.Instance.game4Panel.game4GamePlayPanel.themeBtn3.OnButtonTap();
                        break;
                    case true when UIManager.Instance.previouslyActiveGame4Theme4:
                        UIManager.Instance.game4Panel.game4GamePlayPanel.themeBtn4.OnButtonTap();
                        break;
                    case true when UIManager.Instance.previouslyActiveGame4Theme5:
                        UIManager.Instance.game4Panel.game4GamePlayPanel.themeBtn5.OnButtonTap();
                        break;
                }
            }
            else if (UIManager.Instance.previouslyActiveGamePanel.Equals(UIManager.Instance.game5Panel))
            {
                UIManager.Instance.game5Panel.OpenPanel();
                // UIManager.Instance.game5Panel.game5GamePlayPanel.CallSubscribeRoom();
            }
            else
            {
                UIManager.Instance.lobbyPanel.OpenGameSelectionPanel();
            }
            if (UIManager.Instance.isBreak)
            {
                UIManager.Instance.breakTimePopup.Open();
            }
            UIManager.Instance.ActiveAllGameElements();
            UIManager.Instance.previouslyActiveGamePanel = null;
        }
        else
        {
            UIManager.Instance.lobbyPanel.OpenGameSelectionPanel();
        }
        // if (!UIManager.Instance.topBarPanel.RunningGamesButtonEnable && (UIManager.Instance.game1Panel.isActiveAndEnabled || UIManager.Instance.game2Panel.isActiveAndEnabled ||
        //     UIManager.Instance.game3Panel.isActiveAndEnabled ||
        //     UIManager.Instance.game4Panel.isActiveAndEnabled || UIManager.Instance.game5Panel.isActiveAndEnabled))
        // {
        //     this.Close();
        //     if (UIManager.Instance.isBreak)
        //     {
        //         UIManager.Instance.breakTimePopup.Open();
        //         UIManager.Instance.ActiveAllGameElements();
        //     }
        //     else
        //     {
        //         UIManager.Instance.ActiveAllGameElements();
        //     }
        // }
        // else
        // {
        //     this.Close();
        //     UIManager.Instance.lobbyPanel.OpenGameSelectionPanel();
        // }
    }

    #endregion

    private void FetchNotifications_Spillorama()
    {
        if (SpilloramaApiClient.Instance == null)
        {
            txtRecordNotFound.gameObject.SetActive(true);
            return;
        }

        SpilloramaApiClient.Instance.GetNotifications(
            (SpilloramaNotificationItem[] items) =>
            {
                Reset();
                txtRecordNotFound.gameObject.SetActive(items == null || items.Length == 0);

                if (items == null) return;

                foreach (SpilloramaNotificationItem item in items)
                {
                    NotificationsData mapped = new NotificationsData
                    {
                        notificationType = item.notificationType ?? "",
                        message = item.message ?? "",
                        notificationDateAndTime = item.notificationDateAndTime ?? "",
                        ticketMessage = item.ticketMessage ?? "",
                        price = item.price ?? "",
                        date = item.date ?? ""
                    };
                    PrefabNotificationMessagePanel tDetail = Instantiate(prefabNotificationDetail, transformTransactionContainer);
                    tDetail.SetData(mapped);
                    tDetail.Open();
                }
            },
            (string code, string message) =>
            {
                Debug.LogWarning($"[NotificationPanel] Spillorama fetch failed: {code} — {message}");
                txtRecordNotFound.gameObject.SetActive(true);
            }
        );
    }

    #region PRIVATE_METHODS
    private void Reset()
    {
        txtRecordNotFound.Close();

        foreach (Transform child in transformTransactionContainer)
        {
            Destroy(child.gameObject);
        }
        if (UIManager.Instance.breakTimePopup.isActiveAndEnabled)
        {
            UIManager.Instance.breakTimePopup.Close();
        }
    }
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    #endregion
}
