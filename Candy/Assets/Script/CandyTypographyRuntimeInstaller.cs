using System.Collections;
using TMPro;
using UnityEngine;
using UnityEngine.SceneManagement;

public sealed class CandyTypographyRuntimeInstaller : MonoBehaviour
{
    private static CandyTypographyRuntimeInstaller instance;

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
    private static void Bootstrap()
    {
        if (instance != null)
        {
            instance.ApplyToLoadedGameplayScenes();
            return;
        }

        GameObject root = new GameObject("CandyTypographyRuntimeInstaller");
        DontDestroyOnLoad(root);
        instance = root.AddComponent<CandyTypographyRuntimeInstaller>();
        instance.ApplyToLoadedGameplayScenes();
    }

    private void Awake()
    {
        if (instance != null && instance != this)
        {
            Destroy(gameObject);
            return;
        }

        instance = this;
        DontDestroyOnLoad(gameObject);
        SceneManager.sceneLoaded += HandleSceneLoaded;
    }

    private void OnDestroy()
    {
        if (instance == this)
        {
            SceneManager.sceneLoaded -= HandleSceneLoaded;
            instance = null;
        }
    }

    private void HandleSceneLoaded(Scene scene, LoadSceneMode mode)
    {
        if (!CandyTypographySystem.IsGameplayScene(scene))
        {
            return;
        }

        StartCoroutine(ApplySeveralPasses());
    }

    public void ApplyToLoadedGameplayScenes()
    {
        StartCoroutine(ApplySeveralPasses());
    }

    private IEnumerator ApplySeveralPasses()
    {
        for (int pass = 0; pass < 10; pass++)
        {
            Scene activeScene = SceneManager.GetActiveScene();
            if (!CandyTypographySystem.IsGameplayScene(activeScene))
            {
                yield return null;
                continue;
            }

            if (ContainsDedicatedTheme1Presentation(activeScene))
            {
                yield return null;
                continue;
            }

            CandyTypographySystem.ApplyToScene(activeScene);
            ApplyDynamicButtonLabels();
            yield return null;
        }
    }

    private static bool ContainsDedicatedTheme1Presentation(Scene scene)
    {
        if (!scene.IsValid() || !scene.isLoaded)
        {
            return false;
        }

        GameObject[] roots = scene.GetRootGameObjects();
        for (int i = 0; i < roots.Length; i++)
        {
            Theme1GameplayViewRoot viewRoot = roots[i].GetComponentInChildren<Theme1GameplayViewRoot>(true);
            if (viewRoot == null)
            {
                continue;
            }

            return true;
        }

        return false;
    }

    private static void ApplyDynamicButtonLabels()
    {
        TMP_Text[] labels = FindObjectsByType<TMP_Text>(FindObjectsInactive.Include, FindObjectsSortMode.None);
        for (int i = 0; i < labels.Length; i++)
        {
            TMP_Text label = labels[i];
            if (label == null || label.gameObject == null)
            {
                continue;
            }

            Scene scene = label.gameObject.scene;
            if (!CandyTypographySystem.IsGameplayScene(scene))
            {
                continue;
            }

            if (Theme1ManagedTypographyRegistry.Contains(label))
            {
                continue;
            }

            if (Theme1ManagedTypographyRegistry.BelongsToTheme1Presentation(label))
            {
                continue;
            }

            CandyTypographySystem.ApplyGameplayRole(
                label,
                CandyTypographySystem.Classify(label),
                RealtimeTextStyleUtils.ClassifyGameplaySurface(label));
        }
    }
}
