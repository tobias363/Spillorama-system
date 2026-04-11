using System.Collections;
using System.Collections.Generic;
using BestHTTP.SocketIO;
using TMPro;
using UnityEngine;
using UnityEngine.Playables;

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
        GameSocketManager.OnSocketReconnected += Reconnect;
        notificationDetailPanel.Close();
        NotificationsCall();
    }

    private void OnDisable()
    {
        GameSocketManager.OnSocketReconnected -= Reconnect;
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

    public void NotificationsCall()
    {
        // UIManager.Instance.DisplayLoader(true);
        EventManager.Instance.PlayerNotifications(NotificationsResponse);
    }
    public void NotificationsResponse(Socket socket, Packet packet, params object[] args)
    {
        Debug.Log($"NotificationsResponse: {packet}");
        UIManager.Instance.DisplayLoader(false);

        EventResponseList<NotificationsData> response = JsonUtility.FromJson<EventResponseList<NotificationsData>>(Utility.Instance.GetPacketString(packet));

        if (response.status == Constants.EventStatus.SUCCESS)
        {
            Reset();
            txtRecordNotFound.gameObject.SetActive(response.result.Count == 0);
            foreach (NotificationsData tNotifications in response.result)
            {
                PrefabNotificationMessagePanel tDetail = Instantiate(prefabNotificationDetail, transformTransactionContainer);
                tDetail.SetData(tNotifications);
                tDetail.Open();
            }
        }
        else
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup("", response.message);
        }
    }
    #endregion

    #region PRIVATE_METHODS
    private void Reconnect()
    {
        CancelInvoke();

        NotificationsCall();
    }
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
