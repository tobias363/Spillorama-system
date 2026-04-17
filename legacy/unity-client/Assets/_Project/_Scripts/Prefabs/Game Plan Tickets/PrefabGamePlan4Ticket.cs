using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class PrefabGamePlan4Ticket : GamePlanTicket
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
    public void OnEnterButtonTap()
    {
        UIManager.Instance.lobbyPanel.Close();
        UIManager.Instance.game4Panel.OpenPanel();
    }
    #endregion

    #region PRIVATE_METHODS
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    #endregion
}
