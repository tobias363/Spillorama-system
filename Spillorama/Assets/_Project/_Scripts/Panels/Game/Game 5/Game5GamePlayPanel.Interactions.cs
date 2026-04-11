using UnityEngine;

public partial class Game5GamePlayPanel
{
    public void OnPlayButtonTap()
    {
        btnPlay.interactable = false;
        CallGame5PlayEvent();
    }

    public void DisplayLoader(bool showLoader)
    {
        if (loaderPanel && Utility.Instance.IsSplitScreenSupported && UIManager.Instance.splitScreenGameManager.SplitScreenRunningGameCount() > 1)
        {
            if (showLoader)
            {
                loaderPanel.ShowLoader();
            }
            else
            {
                loaderPanel.HideLoader();
                UIManager.Instance.DisplayLoader(false);
            }
        }
    }

    private void CloseMiniGames()
    {
        game5FreeSpinJackpot.Close();
        game5JackpotRouletteWheel.Close();
    }
}
