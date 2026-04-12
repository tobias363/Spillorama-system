using System;
using System.Collections.Generic;
using System.Reflection;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

public static class GamePanelWiringSmokeTests
{
    private const string ScenePath = "Assets/_Project/_Scenes/Game.unity";

    public static void RunGamePanelSceneWiringSmokeTest()
    {
        try
        {
            var scene = EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
            if (!scene.IsValid() || !scene.isLoaded)
            {
                throw new Exception($"Could not open scene: {ScenePath}");
            }

            var uiManager = UnityEngine.Object.FindFirstObjectByType<UIManager>(FindObjectsInactive.Include);
            if (uiManager == null)
            {
                throw new Exception("UIManager component not found in Game scene.");
            }

            var failures = new List<string>();

            CheckObject("UIManager.game1Panel", uiManager.game1Panel, failures);
            CheckObject("UIManager.game2Panel", uiManager.game2Panel, failures);
            CheckObject("UIManager.game3Panel", uiManager.game3Panel, failures);
            CheckObject("UIManager.game4Panel", uiManager.game4Panel, failures);
            CheckObject("UIManager.game5Panel", uiManager.game5Panel, failures);

            if (uiManager.game1Panel != null)
            {
                CheckObject("Game1Panel.game1TicketPurchasePanel", uiManager.game1Panel.game1TicketPurchasePanel, failures);
                CheckObject("Game1Panel.game1GamePlayPanel", uiManager.game1Panel.game1GamePlayPanel, failures);
            }

            if (uiManager.game2Panel != null)
            {
                CheckObject("Game2Panel.game2TicketPurchasePanel", uiManager.game2Panel.game2TicketPurchasePanel, failures);
                CheckObject("Game2Panel.game2PlayPanel", uiManager.game2Panel.game2PlayPanel, failures);
            }

            if (uiManager.game3Panel != null)
            {
                CheckObject("Game3Panel.game3TicketPurchasePanel", uiManager.game3Panel.game3TicketPurchasePanel, failures);
                CheckObject("Game3Panel.game3GamePlayPanel", uiManager.game3Panel.game3GamePlayPanel, failures);
            }

            if (uiManager.game4Panel != null)
            {
                CheckObject("Game4Panel.game4ThemeSelectionPanel", uiManager.game4Panel.game4ThemeSelectionPanel, failures);
                CheckObject("Game4Panel.game4GamePlayPanel", uiManager.game4Panel.game4GamePlayPanel, failures);
            }

            if (uiManager.game5Panel != null)
            {
                CheckObject("Game5Panel.game5GamePlayPanel", uiManager.game5Panel.game5GamePlayPanel, failures);
            }

            ValidateGame1(uiManager.game1Panel?.game1GamePlayPanel, failures);
            ValidateGame2(uiManager.game2Panel?.game2PlayPanel, failures);
            ValidateGame3(uiManager.game3Panel?.game3GamePlayPanel, failures);
            ValidateGame4(uiManager.game4Panel?.game4GamePlayPanel, failures);
            ValidateGame5(uiManager.game5Panel?.game5GamePlayPanel, failures);

            if (failures.Count > 0)
            {
                throw new Exception("Game panel wiring failures: " + string.Join(", ", failures));
            }

            Debug.Log("[GamePanelWiringSmoke] PASS");
            EditorApplication.Exit(0);
        }
        catch (Exception ex)
        {
            Debug.LogError("[GamePanelWiringSmoke] FAIL " + ex);
            EditorApplication.Exit(1);
        }
    }

    private static void ValidateGame1(Game1GamePlayPanel panel, List<string> failures)
    {
        CheckObject("Game1GamePlayPanel", panel, failures);
        if (panel == null)
            return;

        CheckObject("Game1GamePlayPanel.changeMarkerBackgroundPanel", panel.changeMarkerBackgroundPanel, failures);
        CheckObject("Game1GamePlayPanel.PanelRowDetails", panel.PanelRowDetails, failures);
        CheckField(panel, "selectLuckyNumberPanel", failures);
        CheckField(panel, "bingoBallPanelManager", failures);
        CheckField(panel, "chatPanel", failures);
        CheckObject("Game1GamePlayPanel.newFortuneWheelManager", panel.newFortuneWheelManager, failures);
        CheckObject("Game1GamePlayPanel.treasureChestPanel", panel.treasureChestPanel, failures);
        CheckObject("Game1GamePlayPanel.mysteryGamePanel", panel.mysteryGamePanel, failures);
        CheckObject("Game1GamePlayPanel.colorDraftGamePanel", panel.colorDraftGamePanel, failures);
    }

    private static void ValidateGame2(Game2GamePlayPanel panel, List<string> failures)
    {
        CheckObject("Game2GamePlayPanel", panel, failures);
        if (panel == null)
            return;

        CheckObject("Game2GamePlayPanel.changeMarkerBackgroundPanel", panel.changeMarkerBackgroundPanel, failures);
        CheckObject("Game2GamePlayPanel.prefabGame2UpcomingGames", panel.prefabGame2UpcomingGames, failures);
        CheckField(panel, "bingoBallPanelManager", failures);
        CheckField(panel, "chatPanel", failures);
        CheckField(panel, "toggleAutoPlay", failures);
    }

    private static void ValidateGame3(Game3GamePlayPanel panel, List<string> failures)
    {
        CheckObject("Game3GamePlayPanel", panel, failures);
        if (panel == null)
            return;

        CheckObject("Game3GamePlayPanel.changeMarkerBackgroundPanel", panel.changeMarkerBackgroundPanel, failures);
        CheckObject("Game3GamePlayPanel.PanelRowDetails", panel.PanelRowDetails, failures);
        CheckField(panel, "selectLuckyNumberPanel", failures);
        CheckField(panel, "bingoBallPanelManager", failures);
        CheckField(panel, "chatPanel", failures);
    }

    private static void ValidateGame4(Game4GamePlayPanel panel, List<string> failures)
    {
        CheckObject("Game4GamePlayPanel", panel, failures);
        if (panel == null)
            return;

        CheckObject("Game4GamePlayPanel.themeBtn1", panel.themeBtn1, failures);
        CheckObject("Game4GamePlayPanel.themeBtn2", panel.themeBtn2, failures);
        CheckObject("Game4GamePlayPanel.themeBtn3", panel.themeBtn3, failures);
        CheckObject("Game4GamePlayPanel.themeBtn4", panel.themeBtn4, failures);
        CheckObject("Game4GamePlayPanel.themeBtn5", panel.themeBtn5, failures);
        CheckObject("Game4GamePlayPanel.fortuneWheelManager", panel.fortuneWheelManager, failures);
        CheckObject("Game4GamePlayPanel.treasureChestPanel", panel.treasureChestPanel, failures);
        CheckObject("Game4GamePlayPanel.mysteryGamePanel", panel.mysteryGamePanel, failures);
        CheckField(panel, "prefabBingoBall", failures);
    }

    private static void ValidateGame5(Game5GamePlayPanel panel, List<string> failures)
    {
        CheckObject("Game5GamePlayPanel", panel, failures);
        if (panel == null)
            return;

        CheckObject("Game5GamePlayPanel.game5FreeSpinJackpot", panel.game5FreeSpinJackpot, failures);
        CheckObject("Game5GamePlayPanel.game5JackpotRouletteWheel", panel.game5JackpotRouletteWheel, failures);
        CheckObject("Game5GamePlayPanel.rouletteSpinner", panel.rouletteSpinner, failures);
        CheckObject("Game5GamePlayPanel.rouletteWheel", panel.rouletteWheel, failures);
        CheckObject("Game5GamePlayPanel.rouletteSpinnerElements", panel.rouletteSpinnerElements, failures);
        if (panel.balls == null || panel.balls.Length == 0)
        {
            failures.Add("Game5GamePlayPanel.balls");
        }
    }

    private static void CheckObject(string owner, UnityEngine.Object value, List<string> failures)
    {
        if (value == null)
        {
            failures.Add(owner);
        }
    }

    private static void CheckField(object instance, string fieldName, List<string> failures)
    {
        var flags = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
        var field = instance.GetType().GetField(fieldName, flags);
        if (field == null)
        {
            failures.Add(instance.GetType().Name + "." + fieldName + " (missing field)");
            return;
        }

        var value = field.GetValue(instance);
        if (value == null)
        {
            failures.Add(instance.GetType().Name + "." + fieldName);
        }
    }
}
