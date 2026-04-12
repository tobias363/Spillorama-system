using UnityEngine;

public partial class Game1GamePlayPanel
{
    public void Reconnect()
    {
        UIManager.Instance.lobbyPanel.gamePlanPanel.OnGame1ButtonTap();
    }

    public void OnLuckyNumberTap()
    {
        selectLuckyNumberPanel.Open();
    }

    internal void Close_Panels()
    {
        selectLuckyNumberPanel.Close();
        changeMarkerBackgroundPanel.Close();
    }

    public void OpenChangeMarkerBackgroundPanel()
    {
        changeMarkerBackgroundPanel.Open();
    }

    public void OnLuckyNumberSelection(int luckyNumber)
    {
        if (LuckyNumber == luckyNumber)
            return;

        // TODO: Replace with Spillorama REST endpoint for Game1 lucky number selection
        Debug.LogWarning("[Game1] OnLuckyNumberSelection: Spillorama endpoint not yet implemented");
        LuckyNumber = luckyNumber;
        HighlightLuckyNumber();
        DisplayLoader(false);
    }

    public void OpenWithdrawNumberHistoryPanel()
    {
        UIManager.Instance.withdrawNumberHistoryPanel.Open();
    }

    public UtilityMessagePanel GetUtilityMessagePanel()
    {
        if (
            loaderPanel
            && Utility.Instance.IsSplitScreenSupported
            && UIManager.Instance.splitScreenGameManager.SplitScreenRunningGameCount() > 1
        )
            return messagePopup;

        return UIManager.Instance.messagePopup;
    }

    public void DisplayLoader(bool showLoader)
    {
        if (
            loaderPanel
            && Utility.Instance.IsSplitScreenSupported
            && UIManager.Instance.splitScreenGameManager.SplitScreenRunningGameCount() > 1
        )
        {
            if (showLoader)
                loaderPanel.ShowLoader();
            else
            {
                loaderPanel.HideLoader();
                UIManager.Instance.DisplayLoader(false);
            }
        }
    }
}
