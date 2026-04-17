using System;
using BestHTTP.SocketIO;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class PrefabGamePlan3Ticket : GamePlanTicket
{
    #region PUBLIC_VARIABLES
    #endregion

    #region PRIVATE_VARIABLES
    #endregion

    #region UNITY_CALLBACKS
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void OnBuyButtonTap()
    {
        GameSocketManager.SetSocketGame3Namespace = GetGameData().namespaceString;
        // UIManager.Instance.DisplayLoader(true);
        UIManager.Instance.lobbyPanel.Close();
        UIManager.Instance.CloseAllSubPanels();
        UIManager.Instance.game3Panel.OpenTicketPurchasePanel(GetGameData());
    }

    public void OnPlayButtonTap()
    {
        //GameSocketManager.SetSocketGame3Namespace = GetGameData().namespaceString;
        GameSocketManager.SetSocketGame3Namespace = "Game3";
        // UIManager.Instance.DisplayLoader(true);        
        UIManager.Instance.lobbyPanel.Close();
        UIManager.Instance.CloseAllSubPanels();
        
        if (Utility.Instance.IsSplitScreenSupported)
        {
            if (UIManager.Instance.splitScreenGameManager.game3Panel.isActiveAndEnabled)
                UIManager.Instance.splitScreenGameManager.game3Panel.Close();

            UIManager.Instance.splitScreenGameManager.OpenGamePlay3(GetGameData(), GetGameData().gameId);
            UIManager.Instance.game3Panel.Close();
        }
        else
        {
            UIManager.Instance.game3Panel.OpenGamePlayPanel(GetGameData(), GetGameData().gameId);
        }
    }
    #endregion

    #region PRIVATE_METHODS
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    #endregion
}
