using System;
using System.Reflection;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

public static class GamePanelLifecycleSmokeTests
{
    private const string ScenePath = "Assets/_Project/_Scenes/Game.unity";
    private const BindingFlags Flags =
        BindingFlags.Instance | BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic;

    public static void RunGamePanelLifecycleSmokeTest()
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

            InitializeSingletons(uiManager);

            var originalBreak = uiManager.isBreak;
            uiManager.isBreak = true;

            try
            {
                ValidateGame1(uiManager);
                ValidateGame2(uiManager);
                ValidateGame3(uiManager);
                ValidateGame4(uiManager);
                ValidateGame5(uiManager);
            }
            finally
            {
                uiManager.isBreak = originalBreak;
            }

            Debug.Log("[GamePanelLifecycleSmoke] PASS");
            EditorApplication.Exit(0);
        }
        catch (Exception ex)
        {
            Debug.LogError("[GamePanelLifecycleSmoke] FAIL " + ex);
            EditorApplication.Exit(1);
        }
    }

    private static void ValidateGame1(UIManager uiManager)
    {
        var gameData = new GameData
        {
            gameId = "smoke-game-1",
            gameName = "Smoke Game 1",
            namespaceString = "Game1"
        };

        uiManager.game1Panel.game1GamePlayPanel.OpenPanel(gameData, gameData.gameId);

        RequireActive(uiManager.game1Panel.game1GamePlayPanel.gameObject, "Game1GamePlayPanel");
        Require(GetCurrentGameNumber(uiManager) == 1, "Game1 should set Current_Game_Number=1");

        uiManager.game1Panel.game1GamePlayPanel.Close();
        uiManager.game1Panel.Close();
    }

    private static void ValidateGame2(UIManager uiManager)
    {
        var gameData = new GameData
        {
            gameId = "smoke-game-2",
            gameName = "Smoke Game 2",
            namespaceString = "Game2"
        };

        uiManager.game2Panel.game2PlayPanel.OpenPanel(gameData, gameData.gameId);

        RequireActive(uiManager.game2Panel.game2PlayPanel.gameObject, "Game2GamePlayPanel");
        Require(GetCurrentGameNumber(uiManager) == 2, "Game2 should set Current_Game_Number=2");
        Require(uiManager.isGame2, "Game2 should set UIManager.isGame2=true");

        uiManager.game2Panel.game2PlayPanel.Close();
        uiManager.game2Panel.Close();
        uiManager.isGame2 = false;
    }

    private static void ValidateGame3(UIManager uiManager)
    {
        var gameData = new GameData
        {
            gameId = "smoke-game-3",
            gameName = "Smoke Game 3",
            namespaceString = "Game3"
        };

        uiManager.game3Panel.game3GamePlayPanel.OpenPanel(gameData, gameData.gameId);

        RequireActive(uiManager.game3Panel.game3GamePlayPanel.gameObject, "Game3GamePlayPanel");
        Require(GetCurrentGameNumber(uiManager) == 3, "Game3 should set Current_Game_Number=3");
        Require(uiManager.isGame3, "Game3 should set UIManager.isGame3=true");

        uiManager.game3Panel.game3GamePlayPanel.Close();
        uiManager.game3Panel.Close();
        uiManager.isGame3 = false;
    }

    private static void ValidateGame4(UIManager uiManager)
    {
        uiManager.game4Panel.OpenPanel();

        RequireActive(uiManager.game4Panel.gameObject, "Game4Panel");
        RequireActive(uiManager.game4Panel.game4ThemeSelectionPanel.gameObject, "Game4ThemeSelectionPanel");
        Require(uiManager.isGame4, "Game4 should set UIManager.isGame4=true");

        uiManager.game4Panel.game4ThemeSelectionPanel.Close();
        uiManager.game4Panel.game4GamePlayPanel.Close();
        uiManager.game4Panel.Close();
        uiManager.isGame4 = false;
    }

    private static void ValidateGame5(UIManager uiManager)
    {
        uiManager.game5Panel.OpenPanel();

        RequireActive(uiManager.game5Panel.gameObject, "Game5Panel");
        RequireActive(uiManager.game5Panel.game5GamePlayPanel.gameObject, "Game5GamePlayPanel");
        Require(uiManager.isGame5, "Game5 should set UIManager.isGame5=true");

        uiManager.game5Panel.game5GamePlayPanel.Close();
        uiManager.game5Panel.Close();
        uiManager.isGame5 = false;
    }

    private static void Require(bool condition, string message)
    {
        if (!condition)
        {
            throw new Exception(message);
        }
    }

    private static void RequireActive(GameObject gameObject, string label)
    {
        if (gameObject == null || !gameObject.activeSelf)
        {
            throw new Exception(label + " is not active.");
        }
    }

    private static int GetCurrentGameNumber(UIManager uiManager)
    {
        var field = typeof(UIManager).GetField("Current_Game_Number", Flags);
        if (field == null)
        {
            throw new Exception("UIManager.Current_Game_Number field not found.");
        }

        return (int)field.GetValue(uiManager);
    }

    private static void InitializeSingletons(UIManager uiManager)
    {
        UIManager.Instance = uiManager;

        var utility = UnityEngine.Object.FindFirstObjectByType<Utility>(FindObjectsInactive.Include);
        if (utility != null)
        {
            Utility.Instance = utility;
        }

        var soundManager = UnityEngine.Object.FindFirstObjectByType<SoundManager>(FindObjectsInactive.Include);
        if (soundManager != null)
        {
            SoundManager.Instance = soundManager;
        }

        var gameSocketManager = UnityEngine.Object.FindFirstObjectByType<GameSocketManager>(FindObjectsInactive.Include);
        if (gameSocketManager != null)
        {
            GameSocketManager.Instance = gameSocketManager;
        }

        var eventManager = UnityEngine.Object.FindFirstObjectByType<EventManager>(FindObjectsInactive.Include);
        if (eventManager != null)
        {
            EventManager.Instance = eventManager;
        }
    }
}
