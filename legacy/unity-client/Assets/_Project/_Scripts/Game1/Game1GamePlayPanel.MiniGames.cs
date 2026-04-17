using UnityEngine;

public partial class Game1GamePlayPanel
{
    private void CallWheelOfFortuneEvent(BingoGame1History gameHistory = null, bool isForceShow = false)
    {
        // TODO: Spillorama mini-game endpoint
        Debug.LogWarning("[Game1] CallWheelOfFortuneEvent: Spillorama mini-game endpoint not yet implemented");
        DisplayLoader(false);
    }

    private void CallTreasureChestEvent()
    {
        // TODO: Spillorama mini-game endpoint
        Debug.LogWarning("[Game1] CallTreasureChestEvent: Spillorama mini-game endpoint not yet implemented");
        DisplayLoader(false);
    }

    private void CallMysteryGameEvent()
    {
        // TODO: Spillorama mini-game endpoint
        Debug.LogWarning("[Game1] CallMysteryGameEvent: Spillorama mini-game endpoint not yet implemented");
        DisplayLoader(false);
    }

    private void CallColorDraftGameEvent()
    {
        // TODO: Spillorama mini-game endpoint
        Debug.LogWarning("[Game1] CallColorDraftGameEvent: Spillorama mini-game endpoint not yet implemented");
        DisplayLoader(false);
    }

    private void CloseMiniGames()
    {
        fortuneWheelManager.Close();
        newFortuneWheelManager.Close();
        treasureChestPanel.Close();
        mysteryGamePanel.Close();
        colorDraftGamePanel.Close();
    }
}
