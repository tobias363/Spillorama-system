using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Events;
using UnityEngine.UI;

public static class Theme2SmokeTests
{
    private const string Theme2ScenePath = "Assets/Scenes/Theme2.unity";

    [MenuItem("Tools/Candy/Tests/Run Theme2 Play Smoke Test")]
    public static void RunTheme2PlaySmokeTest()
    {
        SceneAsset sceneAsset = AssetDatabase.LoadAssetAtPath<SceneAsset>(Theme2ScenePath);
        if (sceneAsset == null)
        {
            throw new System.Exception("[Theme2Smoke] Fant ikke scene: " + Theme2ScenePath);
        }

        EditorSceneManager.OpenScene(Theme2ScenePath, OpenSceneMode.Single);

        UIManager uiManager = Object.FindObjectOfType<UIManager>(true);
        if (uiManager == null)
        {
            throw new System.Exception("[Theme2Smoke] Fant ikke UIManager i Theme2.");
        }

        Button playButton = uiManager.playBtn;
        if (playButton == null)
        {
            throw new System.Exception("[Theme2Smoke] UIManager.playBtn er ikke satt.");
        }

        if (!playButton.gameObject.activeInHierarchy)
        {
            throw new System.Exception("[Theme2Smoke] Play-knappen er ikke aktiv i hierarchy.");
        }

        if (!playButton.interactable)
        {
            throw new System.Exception("[Theme2Smoke] Play-knappen er ikke interactable.");
        }

        if (!HasPersistentOnClickBinding(playButton, uiManager, "Play"))
        {
            throw new System.Exception("[Theme2Smoke] Play-knappen mangler persistent onClick-binding til UIManager.Play.");
        }

        Image playImage = playButton.GetComponent<Image>();
        if (playImage == null || playImage.sprite == null)
        {
            throw new System.Exception("[Theme2Smoke] Play-knappen mangler sprite.");
        }

        Debug.Log("[Theme2Smoke] PASS: Theme2 Play-knappen er aktiv, interactable og korrekt koblet.");
    }

    private static bool HasPersistentOnClickBinding(Button button, Object target, string methodName)
    {
        int persistentCount = button.onClick.GetPersistentEventCount();
        for (int i = 0; i < persistentCount; i++)
        {
            Object persistentTarget = button.onClick.GetPersistentTarget(i);
            string persistentMethod = button.onClick.GetPersistentMethodName(i);
            UnityEventCallState state = button.onClick.GetPersistentListenerState(i);

            if (persistentTarget == target &&
                string.Equals(persistentMethod, methodName, System.StringComparison.Ordinal) &&
                state != UnityEventCallState.Off)
            {
                return true;
            }
        }

        return false;
    }
}
