using UnityEngine;

public class PrefabGamePlan1Ticket : GamePlanTicket
{
    public void OnBuyButtonTap()
    {
        CallGame1PurchaseDataEvent();
        Invoke("CallGame1PurchaseDataEvent", 0.2f);
    }

    public void OnPlayButtonTap()
    {
        UIManager.Instance.lobbyPanel.Close();
        UIManager.Instance.CloseAllSubPanels();

        if (Utility.Instance.IsSplitScreenSupported)
        {
            if (UIManager.Instance.splitScreenGameManager.game1Panel.isActiveAndEnabled)
                UIManager.Instance.splitScreenGameManager.game1Panel.Close();

            UIManager.Instance.splitScreenGameManager.OpenGamePlay1(GetGameData(), GetGameData().gameId);
            UIManager.Instance.game1Panel.Close();
        }
        else
        {
            UIManager.Instance.game1Panel.OpenGamePlayPanel(GetGameData(), GetGameData().gameId);
        }
    }

    private void CallGame1PurchaseDataEvent()
    {
        // TODO: Replace with Spillorama REST endpoint for Game 1 purchase data
        Debug.LogWarning("[Game1] CallGame1PurchaseDataEvent: Spillorama endpoint not yet implemented");
        UIManager.Instance.DisplayLoader(false);
    }
}
