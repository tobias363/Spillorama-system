using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class PrefabGamePlan2Ticket : GamePlanTicket
{
    #region PUBLIC_VARIABLES

    public static PrefabGamePlan2Ticket Instance;

    #endregion

    #region PRIVATE_VARIABLES
    #endregion

    #region UNITY_CALLBACKS

    void Awake()
    {
        Instance = this;
    }

    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void OnBuyButtonTap()
    {
        // Spillorama: namespace handled by SpilloramaSocketManager
        // UIManager.Instance.DisplayLoader(true);
        UIManager.Instance.lobbyPanel.Close();
        UIManager.Instance.CloseAllSubPanels();
        UIManager.Instance.game2Panel.OpenTicketBuyPanel(GetGameData());        
    }

    public void OnPlayButtonTap()
    {
        // Spillorama: namespace handled by SpilloramaSocketManager
        // UIManager.Instance.DisplayLoader(true);
        UIManager.Instance.lobbyPanel.Close();
        UIManager.Instance.CloseAllSubPanels();        

        if(Utility.Instance.IsSplitScreenSupported)
        {
            if (UIManager.Instance.splitScreenGameManager.game2Panel.isActiveAndEnabled)
                UIManager.Instance.splitScreenGameManager.game2Panel.Close();

            UIManager.Instance.splitScreenGameManager.OpenGamePlay2(GetGameData(), GetGameData().gameId);
            UIManager.Instance.game2Panel.Close();
        }
        else
        {
            UIManager.Instance.game2Panel.OpenGamePlayPanel(GetGameData(), GetGameData().gameId);
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
