using System;
using System.Collections.Generic;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

public static class Theme2SmokeTests
{
    private const string ScenePath = "Assets/_Project/_Scenes/Game.unity";

    public static void RunTheme2PlaySmokeTest()
    {
        try
        {
            var scene = EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
            if (!scene.IsValid() || !scene.isLoaded)
            {
                throw new Exception($"Could not open scene: {ScenePath}");
            }

            var requiredNames = new[]
            {
                "Main Camera",
                "Socket And Event Manager",
                "UIManager",
                "Panel - Login",
                "Panel - Lobby",
                "Panel - Lobby Game Selection",
                "Panel - Game 2",
                "Panel - Game 2 Game Play",
                "Panel - Game 3",
                "Panel - Game 3 Game Play",
                "Panel - Game 4",
                "Panel - Game 5"
            };

            var sceneObjectsByName = GetSceneObjectsByName(scene);

            var missingNames = requiredNames
                .Where(name => !sceneObjectsByName.Contains(name))
                .ToList();

            if (missingNames.Count > 0)
            {
                throw new Exception("Missing required GameObjects: " + string.Join(", ", missingNames));
            }

            var uiManager = UnityEngine.Object.FindFirstObjectByType<UIManager>(FindObjectsInactive.Include);
            if (uiManager == null)
            {
                throw new Exception("UIManager component not found in Game scene.");
            }

            var fieldFailures = new List<string>();
            CheckField(nameof(UIManager.gameAssetData), uiManager.gameAssetData, fieldFailures);
            CheckField(nameof(UIManager.splashScreenPanel), uiManager.splashScreenPanel, fieldFailures);
            CheckField(nameof(UIManager.loginPanel), uiManager.loginPanel, fieldFailures);
            CheckField(nameof(UIManager.topBarPanel), uiManager.topBarPanel, fieldFailures);
            CheckField(nameof(UIManager.lobbyPanel), uiManager.lobbyPanel, fieldFailures);
            CheckField(nameof(UIManager.messagePopup), uiManager.messagePopup, fieldFailures);
            CheckField(nameof(UIManager.game1Panel), uiManager.game1Panel, fieldFailures);
            CheckField(nameof(UIManager.game2Panel), uiManager.game2Panel, fieldFailures);
            CheckField(nameof(UIManager.game3Panel), uiManager.game3Panel, fieldFailures);
            CheckField(nameof(UIManager.game4Panel), uiManager.game4Panel, fieldFailures);
            CheckField(nameof(UIManager.game5Panel), uiManager.game5Panel, fieldFailures);

            if (fieldFailures.Count > 0)
            {
                throw new Exception("UIManager missing references: " + string.Join(", ", fieldFailures));
            }

            var rootObjects = scene.GetRootGameObjects();
            Debug.Log($"[Theme2Smoke] PASS scene={scene.name} roots={rootObjects.Length}");
            EditorApplication.Exit(0);
        }
        catch (Exception ex)
        {
            Debug.LogError("[Theme2Smoke] FAIL " + ex);
            EditorApplication.Exit(1);
        }
    }

    private static void CheckField(string owner, UnityEngine.Object value, List<string> failures)
    {
        if (value == null)
        {
            failures.Add(owner);
        }
    }

    private static HashSet<string> GetSceneObjectsByName(Scene scene)
    {
        var names = new HashSet<string>(StringComparer.Ordinal);
        foreach (var root in scene.GetRootGameObjects())
        {
            CollectNames(root.transform, names);
        }

        return names;
    }

    private static void CollectNames(Transform current, HashSet<string> names)
    {
        names.Add(current.name);
        for (var i = 0; i < current.childCount; i++)
        {
            CollectNames(current.GetChild(i), names);
        }
    }
}
