using UnityEngine;

public static class Theme1GameplayViewContractRefresher
{
    public static void RefreshVisibleContractFromScene(Theme1GameplayViewRoot root)
    {
        if (root == null)
        {
            return;
        }

        NumberGenerator generator = Object.FindFirstObjectByType<NumberGenerator>(FindObjectsInactive.Include);
        GameManager gameManager = GameManager.instance != null
            ? GameManager.instance
            : Object.FindFirstObjectByType<GameManager>(FindObjectsInactive.Include);
        APIManager apiManager = APIManager.instance != null
            ? APIManager.instance
            : Object.FindFirstObjectByType<APIManager>(FindObjectsInactive.Include);
        UIManager uiManager = Object.FindFirstObjectByType<UIManager>(FindObjectsInactive.Include);
        TopperManager topperManager = Object.FindFirstObjectByType<TopperManager>(FindObjectsInactive.Include);
        CandyCardViewBindingSet cardBindings = Object.FindFirstObjectByType<CandyCardViewBindingSet>(FindObjectsInactive.Include);
        CandyBallViewBindingSet ballBindings = Object.FindFirstObjectByType<CandyBallViewBindingSet>(FindObjectsInactive.Include);
        CandyTheme1HudBindingSet hudBindings = Object.FindFirstObjectByType<CandyTheme1HudBindingSet>(FindObjectsInactive.Include);
        if (generator != null)
        {
            generator.ApplyExplicitRealtimeCardViewBindingsFromComponent();
        }

        if (cardBindings != null && ballBindings != null && hudBindings != null)
        {
            hudBindings.PullFrom(generator, gameManager);
            root.PullFrom(cardBindings, ballBindings, hudBindings, topperManager, uiManager);
        }

        root.ReplaceRuntimeSceneReferences(generator, gameManager, apiManager, uiManager);
        root.ApplyRuntimeBindings(generator, gameManager, apiManager, uiManager);
        gameManager?.ReapplyTheme1HudState();
    }
}
