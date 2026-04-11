using UnityEngine;

public partial class UIManager
{
    public Sprite GetBackgroundSprite(int id)
    {
        switch (id)
        {
            case GameId.ID2:
                return spriteBackground2;
            case GameId.ID3:
                return spriteBackground3;
            case GameId.ID4:
                return spriteBackground4;
            case GameId.ID5:
                return spriteBackground5;
            default:
                return spriteBackground1;
        }
    }

    public TicketMarkerCellData GetMarkerData(int id)
    {
        switch (id)
        {
            case GameId.ID2:
                return marker2Data;
            case GameId.ID3:
                return marker3Data;
            case GameId.ID4:
                return marker4Data;
            case GameId.ID5:
                return marker5Data;
            case GameId.ID6:
                return marker6Data;
            default:
                return marker1Data;
        }
    }

    public Sprite GetEmoji(int id)
    {
        if (id < 0 || id >= emojiSpriteList.Count)
            id = 0;

        return emojiSpriteList[id];
    }

    public void BingoButtonColor(bool isPaused)
    {
        bingoBtnLoginPanel.sprite = bingoBtnYellow;
        bingoBtnTopBarPanel.sprite = bingoBtnYellow;
    }

    public bool Game5ActiveElementAction()
    {
        if (UIManager.Instance.profilePanel.isActiveAndEnabled
            || UIManager.Instance.settingPanel.isActiveAndEnabled
            || UIManager.Instance.notificationPanel.isActiveAndEnabled
            || UIManager.Instance.game5Panel.game5GamePlayPanel.game5FreeSpinJackpot.isActiveAndEnabled
            || UIManager.Instance.game5Panel.game5GamePlayPanel.game5JackpotRouletteWheel.isActiveAndEnabled)
        {
            return false;
        }

        return true;
    }

    public void DisplayLoader(bool showLoader)
    {
        if (showLoader)
            loaderPanel.ShowLoader();
        else
            loaderPanel.HideLoader();
    }
}
