using System;
using System.Text;
using TMPro;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.UI;

[InitializeOnLoad]
public static class CandyTheme1BindingTools
{
    private const string Theme1ScenePath = "Assets/Scenes/Theme1.unity";
    private const string ValidationPrefix = "[CandyTheme1Validator]";
    private const int RealtimeBallColumns = 15;
    private const float RealtimeBallSize = 84f;
    private const float RealtimeBallSpacingX = 86f;
    private const float RealtimeBallRowTopY = -350f;
    private const float RealtimeBallRowBottomY = -258f;

    static CandyTheme1BindingTools()
    {
        EditorApplication.playModeStateChanged += HandlePlayModeStateChanged;
    }

    [MenuItem("Candy/Bindings/Install Or Refresh Theme1 Bindings")]
    public static void InstallOrRefreshTheme1BindingsMenu()
    {
        InstallOrRefreshTheme1Bindings(openSceneIfNeeded: true, saveScene: true, logSummary: true);
    }

    [MenuItem("Candy/Bindings/Validate Theme1 Bindings")]
    public static void ValidateTheme1BindingsMenu()
    {
        bool valid = ValidateTheme1Bindings(openSceneIfNeeded: true, logSummary: true, out string report);
        if (!valid)
        {
            throw new InvalidOperationException(report);
        }
    }

    public static void InstallOrRefreshTheme1BindingsCli()
    {
        InstallOrRefreshTheme1Bindings(openSceneIfNeeded: true, saveScene: true, logSummary: true);
    }

    public static void ValidateTheme1BindingsCli()
    {
        bool valid = ValidateTheme1Bindings(openSceneIfNeeded: true, logSummary: true, out string report);
        if (!valid)
        {
            throw new InvalidOperationException(report);
        }
    }

    private static void HandlePlayModeStateChanged(PlayModeStateChange state)
    {
        if (state != PlayModeStateChange.ExitingEditMode)
        {
            return;
        }

        Scene activeScene = SceneManager.GetActiveScene();
        if (!string.Equals(activeScene.path, Theme1ScenePath, StringComparison.Ordinal))
        {
            return;
        }

        bool valid = ValidateTheme1Bindings(openSceneIfNeeded: false, logSummary: false, out string report);
        if (valid)
        {
            return;
        }

        Debug.LogError($"{ValidationPrefix} Play Mode blokkert:{Environment.NewLine}{report}");
        EditorApplication.isPlaying = false;
    }

    private static void InstallOrRefreshTheme1Bindings(bool openSceneIfNeeded, bool saveScene, bool logSummary)
    {
        Scene scene = EnsureTheme1SceneLoaded(openSceneIfNeeded);
        if (!scene.IsValid())
        {
            throw new InvalidOperationException($"{ValidationPrefix} Klarte ikke laste Theme1.");
        }

        NumberGenerator generator = UnityEngine.Object.FindObjectOfType<NumberGenerator>(true);
        BallManager ballManager = UnityEngine.Object.FindObjectOfType<BallManager>(true);
        APIManager apiManager = UnityEngine.Object.FindObjectOfType<APIManager>(true);
        if (generator == null || ballManager == null || apiManager == null)
        {
            throw new InvalidOperationException($"{ValidationPrefix} Fant ikke NumberGenerator, BallManager eller APIManager i Theme1.");
        }

        CandyCardViewBindingSet cardBindings = generator.GetComponent<CandyCardViewBindingSet>();
        if (cardBindings == null)
        {
            cardBindings = Undo.AddComponent<CandyCardViewBindingSet>(generator.gameObject);
        }
        NormalizeCardNumberTargets(generator);
        cardBindings.PullFrom(generator);
        if (!cardBindings.TryApplyTo(generator, out string cardApplyError))
        {
            throw new InvalidOperationException($"{ValidationPrefix} Klarte ikke anvende card bindings: {cardApplyError}");
        }

        CandyBallViewBindingSet ballBindings = ballManager.GetComponent<CandyBallViewBindingSet>();
        if (ballBindings == null)
        {
            ballBindings = Undo.AddComponent<CandyBallViewBindingSet>(ballManager.gameObject);
        }
        NormalizeRealtimeBallLayout(ballManager);
        NormalizeBallTextTargets(ballManager);
        ballBindings.PullFrom(ballManager);
        ballManager.ApplyExplicitRealtimeViewBindingsFromComponent();

        CandyTheme1HudBindingSet hudBindings = apiManager.GetComponent<CandyTheme1HudBindingSet>();
        if (hudBindings == null)
        {
            hudBindings = Undo.AddComponent<CandyTheme1HudBindingSet>(apiManager.gameObject);
        }

        EnsureRealtimeRoomPlayerCountLabel(generator, apiManager);
        NormalizeHudTargets(generator, apiManager);
        hudBindings.PullFrom(generator);
        if (!hudBindings.TryApplyTo(generator, apiManager, out string hudApplyError))
        {
            throw new InvalidOperationException($"{ValidationPrefix} Klarte ikke anvende HUD bindings: {hudApplyError}");
        }

        GameManager gameManager = UnityEngine.Object.FindObjectOfType<GameManager>(true);
        if (gameManager != null)
        {
            SerializedObject serializedGameManager = new SerializedObject(gameManager);
            SerializedProperty increaseSpeed = serializedGameManager.FindProperty("increaseGameSpeedInTesting");
            SerializedProperty speedMultiplier = serializedGameManager.FindProperty("testingSpeedMultiplier");
            if (increaseSpeed != null)
            {
                increaseSpeed.boolValue = false;
            }
            if (speedMultiplier != null)
            {
                speedMultiplier.floatValue = 1f;
            }
            serializedGameManager.ApplyModifiedPropertiesWithoutUndo();
            EditorUtility.SetDirty(gameManager);
        }

        EditorUtility.SetDirty(cardBindings);
        EditorUtility.SetDirty(ballBindings);
        EditorUtility.SetDirty(hudBindings);
        EditorSceneManager.MarkSceneDirty(scene);

        bool valid = ValidateTheme1Bindings(openSceneIfNeeded: false, logSummary: logSummary, out string report);
        if (!valid)
        {
            throw new InvalidOperationException(report);
        }

        if (saveScene)
        {
            EditorSceneManager.SaveScene(scene);
            AssetDatabase.SaveAssets();
        }

        if (logSummary)
        {
            Debug.Log($"{ValidationPrefix} Theme1 bindings oppdatert og validert.");
        }
    }

    private static bool ValidateTheme1Bindings(bool openSceneIfNeeded, bool logSummary, out string report)
    {
        Scene scene = EnsureTheme1SceneLoaded(openSceneIfNeeded);
        if (!scene.IsValid())
        {
            report = $"{ValidationPrefix} Klarte ikke laste Theme1.";
            return false;
        }

        NumberGenerator generator = UnityEngine.Object.FindObjectOfType<NumberGenerator>(true);
        BallManager ballManager = UnityEngine.Object.FindObjectOfType<BallManager>(true);
        APIManager apiManager = UnityEngine.Object.FindObjectOfType<APIManager>(true);
        if (generator == null || ballManager == null || apiManager == null)
        {
            report = $"{ValidationPrefix} Mangler NumberGenerator, BallManager eller APIManager i Theme1.";
            return false;
        }

        StringBuilder builder = new StringBuilder();
        bool isValid = true;

        CandyCardViewBindingSet cardBindings = generator.GetComponent<CandyCardViewBindingSet>();
        if (cardBindings == null)
        {
            builder.AppendLine("CandyCardViewBindingSet mangler på NumberGenerator.");
            isValid = false;
        }
        else if (!cardBindings.Validate(out string cardReport))
        {
            isValid = false;
            builder.AppendLine(cardReport);
        }

        CandyBallViewBindingSet ballBindings = ballManager.GetComponent<CandyBallViewBindingSet>();
        if (ballBindings == null)
        {
            builder.AppendLine("CandyBallViewBindingSet mangler på BallManager.");
            isValid = false;
        }
        else if (!ballBindings.Validate(out string ballReport))
        {
            isValid = false;
            builder.AppendLine(ballReport);
        }

        CandyTheme1HudBindingSet hudBindings = apiManager.GetComponent<CandyTheme1HudBindingSet>();
        if (hudBindings == null)
        {
            builder.AppendLine("CandyTheme1HudBindingSet mangler på APIManager.");
            isValid = false;
        }
        else if (!hudBindings.Validate(out string hudReport))
        {
            isValid = false;
            builder.AppendLine(hudReport);
        }

        if (apiManager.UseRealtimeBackend && apiManager.enabled)
        {
            if (cardBindings != null && cardBindings.CountValidNumberTargets() != 60)
            {
                builder.AppendLine($"Card bindings har ikke 60 gyldige tallfelt. Fikk {cardBindings.CountValidNumberTargets()}.");
                isValid = false;
            }

            if (ballBindings != null && ballBindings.CountValidBallTextTargets() != 30)
            {
                builder.AppendLine($"Ball bindings har ikke 30 gyldige tallfelt. Fikk {ballBindings.CountValidBallTextTargets()}.");
                isValid = false;
            }

            if (generator.autoSpinRemainingPlayText == null)
            {
                builder.AppendLine("NumberGenerator.autoSpinRemainingPlayText mangler.");
                isValid = false;
            }
        }

        report = builder.Length == 0
            ? $"{ValidationPrefix} OK"
            : $"{ValidationPrefix}{Environment.NewLine}{builder}";

        if (logSummary)
        {
            if (isValid)
            {
                Debug.Log(report);
            }
            else
            {
                Debug.LogError(report);
            }
        }

        return isValid;
    }

    private static Scene EnsureTheme1SceneLoaded(bool openSceneIfNeeded)
    {
        Scene activeScene = SceneManager.GetActiveScene();
        if (string.Equals(activeScene.path, Theme1ScenePath, StringComparison.Ordinal))
        {
            return activeScene;
        }

        if (!openSceneIfNeeded)
        {
            return default;
        }

        return EditorSceneManager.OpenScene(Theme1ScenePath, OpenSceneMode.Single);
    }

    private static void EnsureRealtimeRoomPlayerCountLabel(NumberGenerator generator, APIManager apiManager)
    {
        if (generator == null || generator.autoSpinRemainingPlayText == null || apiManager == null)
        {
            return;
        }

        TextMeshProUGUI label = CandyTheme1HudBindingSet.FindExistingPlayerCountText(generator.autoSpinRemainingPlayText);
        if (label == null)
        {
            Transform parent = generator.autoSpinRemainingPlayText.transform.parent;
            if (parent == null)
            {
                return;
            }

            GameObject labelObject = new GameObject("RealtimeRoomPlayerCountText");
            Undo.RegisterCreatedObjectUndo(labelObject, "Create RealtimeRoomPlayerCountText");
            labelObject.transform.SetParent(parent, false);

            RectTransform countdownRect = generator.autoSpinRemainingPlayText.rectTransform;
            RectTransform rect = labelObject.AddComponent<RectTransform>();
            rect.anchorMin = countdownRect.anchorMin;
            rect.anchorMax = countdownRect.anchorMax;
            rect.pivot = countdownRect.pivot;
            rect.anchoredPosition = countdownRect.anchoredPosition + new Vector2(0f, -208f);
            rect.sizeDelta = new Vector2(Mathf.Max(220f, countdownRect.rect.width), Mathf.Max(30f, countdownRect.rect.height * 0.52f));

            label = labelObject.AddComponent<TextMeshProUGUI>();
            label.alignment = TextAlignmentOptions.Center;
            label.enableAutoSizing = true;
            label.fontSizeMin = 16f;
            label.fontSizeMax = 30f;
            label.fontSize = Mathf.Max(18f, generator.autoSpinRemainingPlayText.fontSize * 0.42f);
            label.color = generator.autoSpinRemainingPlayText.color;
            label.text = "Spillere i rommet: 0";
            if (generator.autoSpinRemainingPlayText.font != null)
            {
                label.font = generator.autoSpinRemainingPlayText.font;
            }
            if (generator.autoSpinRemainingPlayText.fontSharedMaterial != null)
            {
                label.fontSharedMaterial = generator.autoSpinRemainingPlayText.fontSharedMaterial;
            }
        }

        NormalizeHudTextTarget(label, generator.autoSpinRemainingPlayText.rectTransform.rect.size);

        SerializedObject serializedApi = new SerializedObject(apiManager);
        SerializedProperty playerCountTextProperty = serializedApi.FindProperty("realtimeRoomPlayerCountText");
        if (playerCountTextProperty != null)
        {
            playerCountTextProperty.objectReferenceValue = label;
            serializedApi.ApplyModifiedPropertiesWithoutUndo();
            EditorUtility.SetDirty(apiManager);
        }
    }

    private static void NormalizeCardNumberTargets(NumberGenerator generator)
    {
        if (generator?.cardClasses == null)
        {
            return;
        }

        for (int cardIndex = 0; cardIndex < generator.cardClasses.Length; cardIndex++)
        {
            CardClass card = generator.cardClasses[cardIndex];
            if (card?.num_text == null)
            {
                continue;
            }

            GridLayoutGroup grid = null;
            for (int cellIndex = 0; cellIndex < card.num_text.Count; cellIndex++)
            {
                TextMeshProUGUI target = card.num_text[cellIndex];
                if (target == null)
                {
                    continue;
                }

                grid ??= target.transform.parent != null
                    ? target.transform.parent.GetComponent<GridLayoutGroup>()
                    : null;
                Vector2 preferredSize = grid != null ? grid.cellSize : new Vector2(96f, 72f);
                NormalizeTextTarget(target, preferredSize, minWidth: 72f, minHeight: 52f);
            }

            if (card.win != null)
            {
                NormalizeTextTarget(card.win, new Vector2(96f, 40f), minWidth: 72f, minHeight: 28f);
            }
        }
    }

    private static void NormalizeBallTextTargets(BallManager ballManager)
    {
        if (ballManager == null)
        {
            return;
        }

        if (ballManager.balls != null)
        {
            for (int i = 0; i < ballManager.balls.Count; i++)
            {
                GameObject root = ballManager.balls[i];
                if (root == null)
                {
                    continue;
                }

                TextMeshProUGUI label = root.GetComponentInChildren<TextMeshProUGUI>(true);
                RectTransform rootRect = root.GetComponent<RectTransform>();
                Vector2 preferredSize = rootRect != null && rootRect.rect.size.x > 1f && rootRect.rect.size.y > 1f
                    ? rootRect.rect.size
                    : new Vector2(40f, 40f);
                NormalizeTextTarget(label, preferredSize, minWidth: 28f, minHeight: 28f);
            }
        }

        if (ballManager.bigBallImg != null)
        {
            TextMeshProUGUI bigBallText = ballManager.bigBallImg.GetComponentInChildren<TextMeshProUGUI>(true);
            RectTransform bigBallRect = ballManager.bigBallImg.rectTransform;
            Vector2 preferredSize = bigBallRect != null && bigBallRect.rect.size.x > 1f && bigBallRect.rect.size.y > 1f
                ? bigBallRect.rect.size
                : new Vector2(96f, 96f);
            NormalizeTextTarget(bigBallText, preferredSize, minWidth: 72f, minHeight: 72f);
        }
    }

    private static void NormalizeRealtimeBallLayout(BallManager ballManager)
    {
        if (ballManager?.balls == null || ballManager.balls.Count == 0)
        {
            return;
        }

        for (int i = 0; i < ballManager.balls.Count; i++)
        {
            GameObject root = ballManager.balls[i];
            if (root == null)
            {
                continue;
            }

            RectTransform rect = root.GetComponent<RectTransform>();
            if (rect == null)
            {
                continue;
            }

            int row = i / RealtimeBallColumns;
            int col = i % RealtimeBallColumns;
            float x = (col - ((RealtimeBallColumns - 1) * 0.5f)) * RealtimeBallSpacingX;
            float y = row == 0 ? RealtimeBallRowTopY : RealtimeBallRowBottomY;

            rect.anchorMin = new Vector2(0.5f, 0.5f);
            rect.anchorMax = new Vector2(0.5f, 0.5f);
            rect.pivot = new Vector2(0.5f, 0.5f);
            rect.anchoredPosition = new Vector2(x, y);
            rect.sizeDelta = new Vector2(RealtimeBallSize, RealtimeBallSize);
            rect.localScale = Vector3.one;

            Image image = root.GetComponent<Image>();
            if (image != null)
            {
                image.preserveAspect = true;
            }

            EditorUtility.SetDirty(root);
        }
    }

    private static void NormalizeHudTargets(NumberGenerator generator, APIManager apiManager)
    {
        if (generator?.autoSpinRemainingPlayText != null)
        {
            NormalizeHudTextTarget(generator.autoSpinRemainingPlayText, generator.autoSpinRemainingPlayText.rectTransform.rect.size);
        }

        SerializedObject serializedApi = apiManager != null ? new SerializedObject(apiManager) : null;
        SerializedProperty playerCountProperty = serializedApi?.FindProperty("realtimeRoomPlayerCountText");
        TextMeshProUGUI roomPlayerCountText = playerCountProperty?.objectReferenceValue as TextMeshProUGUI;
        if (roomPlayerCountText == null && generator?.autoSpinRemainingPlayText != null)
        {
            roomPlayerCountText = CandyTheme1HudBindingSet.FindExistingPlayerCountText(generator.autoSpinRemainingPlayText);
        }

        if (roomPlayerCountText != null)
        {
            Vector2 countdownSize = generator?.autoSpinRemainingPlayText != null
                ? generator.autoSpinRemainingPlayText.rectTransform.rect.size
                : new Vector2(240f, 42f);
            NormalizeHudTextTarget(roomPlayerCountText, new Vector2(Mathf.Max(220f, countdownSize.x), Mathf.Max(26f, countdownSize.y * 0.52f)));
        }
    }

    private static void NormalizeHudTextTarget(TextMeshProUGUI label, Vector2 preferredSize)
    {
        NormalizeTextTarget(label, preferredSize, minWidth: 180f, minHeight: 24f);
        if (label == null)
        {
            return;
        }

        label.alignment = TextAlignmentOptions.Center;
        label.enableAutoSizing = true;
        label.fontSizeMin = Mathf.Max(14f, label.fontSizeMin);
        label.fontSizeMax = Mathf.Max(label.fontSizeMin + 4f, label.fontSizeMax);
        label.raycastTarget = false;
        label.color = Color.white;
        label.alpha = 1f;
        EditorUtility.SetDirty(label);
    }

    private static void NormalizeTextTarget(TextMeshProUGUI label, Vector2 preferredSize, float minWidth, float minHeight)
    {
        if (label == null)
        {
            return;
        }

        RectTransform rect = label.rectTransform;
        if (rect == null)
        {
            return;
        }

        float width = preferredSize.x > 1f ? preferredSize.x : minWidth;
        float height = preferredSize.y > 1f ? preferredSize.y : minHeight;
        width = Mathf.Max(minWidth, width);
        height = Mathf.Max(minHeight, height);

        rect.sizeDelta = new Vector2(width, height);
        rect.localScale = Vector3.one;

        label.raycastTarget = false;
        label.enabled = true;
        label.enableWordWrapping = false;
        label.overflowMode = TextOverflowModes.Overflow;
        label.alignment = TextAlignmentOptions.Center;
        label.alpha = 1f;
        label.enableAutoSizing = true;
        label.fontSizeMin = Mathf.Max(16f, label.fontSizeMin);
        label.fontSizeMax = Mathf.Max(label.fontSizeMin + 8f, Mathf.Min(48f, height * 0.72f));

        if (TMP_Settings.defaultFontAsset != null)
        {
            label.font = TMP_Settings.defaultFontAsset;
            if (TMP_Settings.defaultFontAsset.material != null)
            {
                label.fontSharedMaterial = TMP_Settings.defaultFontAsset.material;
            }
        }
        else if (label.font != null && label.font.material != null)
        {
            label.fontSharedMaterial = label.font.material;
        }

        LayoutRebuilder.ForceRebuildLayoutImmediate(rect);
        EditorUtility.SetDirty(label);
    }
}
