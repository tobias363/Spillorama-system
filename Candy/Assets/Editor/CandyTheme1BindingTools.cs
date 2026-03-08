using System;
using System.Collections.Generic;
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
    private const string SkipPlayModeValidationSessionKey = "Candy.SkipTheme1PlayModeValidation";
    private const int RealtimeBallColumns = 15;
    private const float RealtimeBallSize = 84f;
    private const float RealtimeBallSpacingX = 86f;
    private const float RealtimeBallRowTopY = -350f;
    private const float RealtimeBallRowBottomY = -258f;
    private const string CardBackgroundName = "CardBg";
    private const string LegacyCardNameObject = "Name";
    private const string LegacyCardBetObject = "Bet";
    private const string LegacyCardWinObject = "Win";

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

        if (SessionState.GetBool(SkipPlayModeValidationSessionKey, false))
        {
            return;
        }

        Scene activeScene = SceneManager.GetActiveScene();
        if (!string.Equals(activeScene.path, Theme1ScenePath, StringComparison.Ordinal))
        {
            return;
        }

        try
        {
            InstallOrRefreshTheme1Bindings(openSceneIfNeeded: false, saveScene: true, logSummary: false);
        }
        catch (Exception ex)
        {
            Debug.LogError($"{ValidationPrefix} Klarte ikke auto-refreshe Theme1 før Play Mode. {ex}");
            EditorApplication.isPlaying = false;
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

    public static void SetSkipPlayModeValidation(bool skip)
    {
        SessionState.SetBool(SkipPlayModeValidationSessionKey, skip);
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

        GameManager gameManager = UnityEngine.Object.FindObjectOfType<GameManager>(true);
        TopperManager topperManager = UnityEngine.Object.FindObjectOfType<TopperManager>(true);

        CandyCardViewBindingSet cardBindings = generator.GetComponent<CandyCardViewBindingSet>();
        if (cardBindings == null)
        {
            cardBindings = Undo.AddComponent<CandyCardViewBindingSet>(generator.gameObject);
        }
        NormalizeCardNumberTargets(generator);
        cardBindings.PullFrom(generator);
        ApplyCardDisplayTextBindings(cardBindings, gameManager);
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
        hudBindings.PullFrom(generator, gameManager);
        if (!hudBindings.TryApplyTo(generator, apiManager, gameManager, out string hudApplyError))
        {
            throw new InvalidOperationException($"{ValidationPrefix} Klarte ikke anvende HUD bindings: {hudApplyError}");
        }

        NormalizeTopperPrizeTargets(topperManager, gameManager);

        Theme1GameplayViewRoot dedicatedViewRoot = apiManager.GetComponent<Theme1GameplayViewRoot>();
        if (dedicatedViewRoot == null)
        {
            dedicatedViewRoot = Undo.AddComponent<Theme1GameplayViewRoot>(apiManager.gameObject);
        }

        dedicatedViewRoot.PullFrom(cardBindings, ballBindings, hudBindings, topperManager);
        SerializedObject serializedApiManager = new SerializedObject(apiManager);
        SerializedProperty dedicatedViewRootProperty = serializedApiManager.FindProperty("theme1GameplayViewRoot");
        if (dedicatedViewRootProperty != null)
        {
            dedicatedViewRootProperty.objectReferenceValue = dedicatedViewRoot;
        }

        SerializedProperty numberGeneratorProperty = serializedApiManager.FindProperty("theme1NumberGenerator");
        if (numberGeneratorProperty != null)
        {
            numberGeneratorProperty.objectReferenceValue = generator;
        }

        SerializedProperty gameManagerProperty = serializedApiManager.FindProperty("theme1GameManager");
        if (gameManagerProperty != null)
        {
            gameManagerProperty.objectReferenceValue = gameManager;
        }

        SerializedProperty topperManagerProperty = serializedApiManager.FindProperty("theme1TopperManager");
        if (topperManagerProperty != null)
        {
            topperManagerProperty.objectReferenceValue = topperManager;
        }

        SerializedProperty ballManagerProperty = serializedApiManager.FindProperty("ballManager");
        if (ballManagerProperty != null)
        {
            ballManagerProperty.objectReferenceValue = ballManager;
        }

        SerializedProperty renderModeProperty = serializedApiManager.FindProperty("theme1RealtimeViewMode");
        if (renderModeProperty != null)
        {
            renderModeProperty.enumValueIndex = 1;
        }
        serializedApiManager.ApplyModifiedPropertiesWithoutUndo();
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
            SerializedProperty hidePerCardWinLabels = serializedGameManager.FindProperty("hidePerCardWinLabels");
            if (hidePerCardWinLabels != null)
            {
                hidePerCardWinLabels.boolValue = false;
            }
            serializedGameManager.ApplyModifiedPropertiesWithoutUndo();
            EditorUtility.SetDirty(gameManager);
        }

        EditorUtility.SetDirty(cardBindings);
        EditorUtility.SetDirty(ballBindings);
        EditorUtility.SetDirty(hudBindings);
        EditorUtility.SetDirty(dedicatedViewRoot);
        EditorUtility.SetDirty(apiManager);
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

        if (!CandyBallVisualCatalog.TryValidateComplete(out string ballCatalogError))
        {
            builder.AppendLine(ballCatalogError);
            isValid = false;
        }

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

            if (ballBindings != null)
            {
                int validBallTextTargets = ballBindings.CountValidBallTextTargets();
                if (validBallTextTargets != 0 && validBallTextTargets != 30)
                {
                    builder.AppendLine($"Ball bindings har ugyldig antall gyldige tallfelt. Forventet 0 eller 30. Fikk {validBallTextTargets}.");
                    isValid = false;
                }
            }

            if (generator.autoSpinRemainingPlayText == null)
            {
                builder.AppendLine("NumberGenerator.autoSpinRemainingPlayText mangler.");
                isValid = false;
            }
        }

        Theme1GameplayViewRoot dedicatedViewRoot = apiManager.GetComponent<Theme1GameplayViewRoot>();
        if (dedicatedViewRoot == null)
        {
            builder.AppendLine("Theme1GameplayViewRoot mangler på APIManager.");
            isValid = false;
        }
        else if (!dedicatedViewRoot.ValidateContract(out string dedicatedViewReport))
        {
            isValid = false;
            builder.AppendLine(dedicatedViewReport);
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

    private static void ApplyCardDisplayTextBindings(CandyCardViewBindingSet cardBindings, GameManager gameManager)
    {
        if (cardBindings?.Cards == null)
        {
            return;
        }

        List<TextMeshProUGUI> resolvedBetLabels = new List<TextMeshProUGUI>();
        List<TextMeshProUGUI> resolvedWinLabels = new List<TextMeshProUGUI>();
        for (int cardIndex = 0; cardIndex < cardBindings.Cards.Count; cardIndex++)
        {
            CandyCardViewBinding binding = cardBindings.Cards[cardIndex];
            if (binding == null)
            {
                resolvedBetLabels.Add(null);
                resolvedWinLabels.Add(null);
                continue;
            }

            Transform cardRoot = ResolveCardRoot(binding);
            TextMeshProUGUI header = EnsureDedicatedCardLabel(
                cardRoot,
                $"RealtimeCardHeaderLabel_{cardIndex + 1}",
                CardLabelKind.CardIndex,
                $"Bong - {cardIndex + 1}");
            TextMeshProUGUI bet = EnsureDedicatedCardLabel(
                cardRoot,
                $"RealtimeCardBetLabel_{cardIndex + 1}",
                CardLabelKind.Stake,
                "Innsats - 0 kr");
            TextMeshProUGUI win = EnsureDedicatedCardLabel(
                cardRoot,
                $"RealtimeCardWinLabel_{cardIndex + 1}",
                CardLabelKind.Win,
                "Gevinst - 0 kr");

            string headerText = gameManager != null ? gameManager.GetCardIndexLabel(cardIndex) : $"Bong - {cardIndex + 1}";
            string betText = gameManager != null ? gameManager.GetCardStakeLabel() : "Innsats - 0 kr";
            string winText = gameManager != null ? gameManager.FormatCardWinLabel(0) : "Gevinst - 0 kr";
            ApplyOverlayLabelDefault(header, headerText);
            ApplyOverlayLabelDefault(bet, betText);
            ApplyOverlayLabelDefault(win, winText);
            if (win != null)
            {
                win.gameObject.SetActive(false);
            }

            DeactivateLegacyCardLabelContainers(cardRoot, header, bet, win);
            binding.SetDisplayTexts(header, bet, win);
            resolvedBetLabels.Add(bet);
            resolvedWinLabels.Add(win);
        }

        if (gameManager != null)
        {
            gameManager.CardBets = resolvedBetLabels;
            gameManager.displayCardWinPoints = resolvedWinLabels;
            EditorUtility.SetDirty(gameManager);
        }
    }

    private static TextMeshProUGUI ResolveByIndex(IReadOnlyList<TextMeshProUGUI> labels, int index)
    {
        if (labels == null || index < 0 || index >= labels.Count)
        {
            return null;
        }

        return labels[index];
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
            RealtimeTextStyleUtils.ApplyGameplayTextPresentation(
                label,
                CandyTypographyRole.Label,
                GameplayTextSurface.HudLabel);
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

        Theme1GameplayViewRepairUtils.EnsureCardNumberTargets(generator);
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

                RectTransform cellRoot = target.transform.parent as RectTransform;
                grid ??= target.transform.parent != null
                    ? target.transform.parent.GetComponentInParent<GridLayoutGroup>()
                    : null;
                Vector2 preferredSize = cellRoot != null && cellRoot.rect.width > 1f && cellRoot.rect.height > 1f
                    ? cellRoot.rect.size
                    : (grid != null ? grid.cellSize : new Vector2(96f, 72f));
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

        Theme1GameplayViewRepairUtils.EnsureBallNumberTargets(ballManager);
        if (ballManager.balls != null)
        {
            for (int i = 0; i < ballManager.balls.Count; i++)
            {
                GameObject root = ballManager.balls[i];
                if (root == null)
                {
                    continue;
                }

                TextMeshProUGUI label = Theme1GameplayViewRepairUtils.FindDedicatedBallNumberLabel(root);
                RectTransform rootRect = root.GetComponent<RectTransform>();
                Vector2 preferredSize = rootRect != null && rootRect.rect.size.x > 1f && rootRect.rect.size.y > 1f
                    ? rootRect.rect.size
                    : new Vector2(40f, 40f);
                NormalizeTextTarget(label, preferredSize, minWidth: 28f, minHeight: 28f);
            }
        }

        if (ballManager.bigBallImg != null)
        {
            TextMeshProUGUI bigBallText = Theme1GameplayViewRepairUtils.FindDedicatedBigBallNumberLabel(ballManager.bigBallImg);
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

        GameManager gameManager = UnityEngine.Object.FindObjectOfType<GameManager>(true);
        if (gameManager != null)
        {
            gameManager.displayTotalMoney = EnsureDedicatedHudValueTarget(
                gameManager.displayTotalMoney,
                "RealtimeCreditValueLabel",
                gameManager.totalMoney.ToString());
            gameManager.winAmtText = EnsureDedicatedHudValueTarget(
                gameManager.winAmtText,
                "RealtimeWinningsValueLabel",
                GameManager.winAmt.ToString());
            gameManager.displayCurrentBets = EnsureDedicatedHudValueTarget(
                gameManager.displayCurrentBets,
                "RealtimeBetValueLabel",
                gameManager.currentBet.ToString());
            ApplyOverlayLabelDefault(gameManager.displayTotalMoney, gameManager.totalMoney.ToString());
            ApplyOverlayLabelDefault(gameManager.winAmtText, GameManager.winAmt.ToString());
            ApplyOverlayLabelDefault(gameManager.displayCurrentBets, gameManager.currentBet.ToString());
            if (gameManager.displayTotalMoney != null)
            {
                gameManager.displayTotalMoney.gameObject.SetActive(true);
                DeactivateSiblingTextTargets(gameManager.displayTotalMoney.transform.parent, gameManager.displayTotalMoney);
            }
            if (gameManager.winAmtText != null)
            {
                gameManager.winAmtText.gameObject.SetActive(true);
                DeactivateSiblingTextTargets(gameManager.winAmtText.transform.parent, gameManager.winAmtText);
            }
            if (gameManager.displayCurrentBets != null)
            {
                gameManager.displayCurrentBets.gameObject.SetActive(true);
                DeactivateSiblingTextTargets(gameManager.displayCurrentBets.transform.parent, gameManager.displayCurrentBets);
            }
            EditorUtility.SetDirty(gameManager);
        }
    }

    private static void NormalizeTopperPrizeTargets(TopperManager topperManager, GameManager gameManager)
    {
        if (topperManager?.prizes == null)
        {
            return;
        }

        List<TextMeshProUGUI> dedicatedLabels = new List<TextMeshProUGUI>(topperManager.prizes.Count);
        for (int i = 0; i < topperManager.prizes.Count; i++)
        {
            TextMeshProUGUI template = topperManager.prizes[i];
            string defaultText = gameManager != null && gameManager.TryGetFormattedPayoutLabel(i, out string payoutLabel)
                ? payoutLabel
                : ReadText(template, "0 kr");
            TextMeshProUGUI dedicated = EnsureDedicatedOverlayLabel(
                template != null ? template.transform.parent : null,
                $"RealtimeTopperPrizeLabel_{i + 1}",
                template,
                defaultText,
                GameplayTextSurface.TopperValue,
                template != null ? template.color : Color.white,
                fallbackSize: new Vector2(168f, 36f));
            dedicatedLabels.Add(dedicated);
        }

        topperManager.prizes = dedicatedLabels;
        if (gameManager != null)
        {
            gameManager.displayCurrentPoints = new List<TextMeshProUGUI>(dedicatedLabels);
            EditorUtility.SetDirty(gameManager);
        }

        EditorUtility.SetDirty(topperManager);
    }

    private static TextMeshProUGUI EnsureDedicatedHudValueTarget(TextMeshProUGUI template, string objectName, string defaultText)
    {
        Transform parent = template != null ? template.transform.parent : null;
        TextMeshProUGUI target = EnsureDedicatedOverlayLabel(
            parent,
            objectName,
            template,
            defaultText,
            GameplayTextSurface.HudLabel,
            Color.white,
            fallbackSize: new Vector2(200f, 50f));
        if (target != null)
        {
            DeactivateSiblingTextTargets(parent, target);
        }

        return target;
    }

    private static TextMeshProUGUI EnsureDedicatedOverlayLabel(
        Transform parent,
        string objectName,
        TextMeshProUGUI template,
        string defaultText,
        GameplayTextSurface surface,
        Color fallbackColor,
        Vector2 fallbackSize)
    {
        if (parent == null)
        {
            return template;
        }

        TextMeshProUGUI label = FindNamedTextLabel(parent, objectName);
        if (label == null)
        {
            GameObject labelObject = new GameObject(objectName, typeof(RectTransform), typeof(TextMeshProUGUI));
            Undo.RegisterCreatedObjectUndo(labelObject, $"Create {objectName}");
            labelObject.transform.SetParent(parent, false);
            labelObject.layer = parent.gameObject.layer;
            label = labelObject.GetComponent<TextMeshProUGUI>();
        }

        if (label == null)
        {
            return template;
        }

        RectTransform rect = label.rectTransform;
        if (template != null)
        {
            CopyRectTransform(template.rectTransform, rect, fallbackSize);
            label.color = template.color;
            label.fontSize = template.fontSize;
            label.enableAutoSizing = template.enableAutoSizing;
            label.fontSizeMin = template.fontSizeMin;
            label.fontSizeMax = template.fontSizeMax;
            label.alignment = template.alignment;
            label.fontStyle = template.fontStyle;
            label.fontWeight = template.fontWeight;
        }
        else
        {
            rect.anchorMin = new Vector2(0.5f, 0.5f);
            rect.anchorMax = new Vector2(0.5f, 0.5f);
            rect.pivot = new Vector2(0.5f, 0.5f);
            rect.anchoredPosition = Vector2.zero;
            rect.sizeDelta = fallbackSize;
            label.color = fallbackColor;
            label.enableAutoSizing = true;
            label.fontSizeMin = 18f;
            label.fontSizeMax = 48f;
            label.alignment = TextAlignmentOptions.Center;
        }

        label.gameObject.name = objectName;
        label.gameObject.layer = parent.gameObject.layer;
        label.enabled = true;
        label.raycastTarget = false;
        label.alpha = 1f;
        label.text = !string.IsNullOrWhiteSpace(ReadText(label, string.Empty))
            ? ReadText(label, string.Empty)
            : (!string.IsNullOrWhiteSpace(ReadText(template, string.Empty)) ? ReadText(template, string.Empty) : defaultText);
        label.transform.SetAsLastSibling();
        DeactivateNestedDuplicateLabels(parent, objectName, label);
        RealtimeTextStyleUtils.ApplyGameplayTextPresentation(
            label,
            surface == GameplayTextSurface.CardHeader ? CandyTypographyRole.Label : CandyTypographyRole.Label,
            surface,
            preserveExistingFont: false);
        EditorUtility.SetDirty(label);
        EditorUtility.SetDirty(rect);
        return label;
    }

    private static void ApplyOverlayLabelDefault(TextMeshProUGUI label, string value)
    {
        if (label == null)
        {
            return;
        }

        label.text = value ?? string.Empty;
        EditorUtility.SetDirty(label);
    }

    private static Transform ResolveCardRoot(CandyCardViewBinding binding)
    {
        if (binding == null)
        {
            return null;
        }

        if (binding.SelectionOverlays != null)
        {
            for (int i = 0; i < binding.SelectionOverlays.Count; i++)
            {
                Transform resolved = ResolveCardRoot(binding.SelectionOverlays[i] != null ? binding.SelectionOverlays[i].transform : null);
                if (resolved != null)
                {
                    return resolved;
                }
            }
        }

        if (binding.NumberTexts != null)
        {
            for (int i = 0; i < binding.NumberTexts.Count; i++)
            {
                Transform resolved = ResolveCardRoot(binding.NumberTexts[i] != null ? binding.NumberTexts[i].transform : null);
                if (resolved != null)
                {
                    return resolved;
                }
            }
        }

        return null;
    }

    private static Transform ResolveCardRoot(Transform source)
    {
        Transform current = source;
        while (current != null)
        {
            if (string.Equals(current.name, "RealtimeCardNumbers", StringComparison.Ordinal) && current.parent != null)
            {
                return current.parent;
            }

            if (current.GetComponent<GridLayoutGroup>() != null && current.parent != null)
            {
                return current.parent;
            }

            current = current.parent;
        }

        return null;
    }

    private enum CardLabelKind
    {
        CardIndex,
        Stake,
        Win
    }

    private static TextMeshProUGUI EnsureDedicatedCardLabel(Transform cardRoot, string objectName, CardLabelKind labelKind, string defaultText)
    {
        if (!(cardRoot is RectTransform))
        {
            return null;
        }

        TextMeshProUGUI label = FindNamedTextLabel(cardRoot, objectName);
        if (label == null)
        {
            GameObject labelObject = new GameObject(objectName, typeof(RectTransform), typeof(TextMeshProUGUI));
            Undo.RegisterCreatedObjectUndo(labelObject, $"Create {objectName}");
            labelObject.layer = cardRoot.gameObject.layer;
            labelObject.transform.SetParent(cardRoot, false);
            label = labelObject.GetComponent<TextMeshProUGUI>();
        }

        if (label == null)
        {
            return null;
        }

        RectTransform cardBackground = ResolveDirectChildRect(cardRoot, CardBackgroundName);
        Vector2 baseSize = cardBackground != null && cardBackground.rect.width > 1f && cardBackground.rect.height > 1f
            ? cardBackground.rect.size
            : new Vector2(585f, 325f);
        Vector2 basePosition = cardBackground != null ? cardBackground.anchoredPosition : new Vector2(2f, -5f);
        RectTransform rect = label.rectTransform;
        rect.anchorMin = new Vector2(0.5f, 0.5f);
        rect.anchorMax = new Vector2(0.5f, 0.5f);
        rect.pivot = new Vector2(0.5f, 0.5f);
        rect.localScale = Vector3.one;
        rect.localRotation = Quaternion.identity;

        label.gameObject.name = objectName;
        label.gameObject.layer = cardRoot.gameObject.layer;
        label.gameObject.SetActive(true);
        label.enabled = true;
        label.raycastTarget = false;
        label.alpha = 1f;
        label.enableAutoSizing = true;
        label.fontSizeMin = 18f;
        label.fontSizeMax = 56f;
        label.fontWeight = FontWeight.SemiBold;
        label.fontStyle = FontStyles.Normal;
        label.color = Color.white;
        label.text = defaultText;

        switch (labelKind)
        {
            case CardLabelKind.Stake:
                rect.anchoredPosition = new Vector2(
                    basePosition.x - (baseSize.x * 0.18f),
                    basePosition.y + (baseSize.y * 0.405f));
                rect.sizeDelta = new Vector2(Mathf.Max(180f, baseSize.x * 0.34f), 38f);
                label.alignment = TextAlignmentOptions.Center;
                RealtimeTextStyleUtils.ApplyGameplayTextPresentation(label, CandyTypographyRole.Label, GameplayTextSurface.HudLabel);
                break;
            case CardLabelKind.Win:
                rect.anchoredPosition = new Vector2(
                    basePosition.x + (baseSize.x * 0.245f),
                    basePosition.y + (baseSize.y * 0.405f));
                rect.sizeDelta = new Vector2(Mathf.Max(180f, baseSize.x * 0.34f), 38f);
                label.alignment = TextAlignmentOptions.Center;
                RealtimeTextStyleUtils.ApplyGameplayTextPresentation(label, CandyTypographyRole.Label, GameplayTextSurface.HudLabel);
                break;
            default:
                rect.anchoredPosition = new Vector2(
                    basePosition.x,
                    basePosition.y - (baseSize.y * 0.44f));
                rect.sizeDelta = new Vector2(Mathf.Max(180f, baseSize.x * 0.34f), 38f);
                label.alignment = TextAlignmentOptions.Center;
                RealtimeTextStyleUtils.ApplyGameplayTextPresentation(label, CandyTypographyRole.Label, GameplayTextSurface.CardHeader);
                break;
        }

        label.transform.SetAsLastSibling();
        DeactivateNestedDuplicateLabels(cardRoot, objectName, label);
        EditorUtility.SetDirty(label);
        EditorUtility.SetDirty(rect);
        return label;
    }

    private static TextMeshProUGUI FindNamedTextLabel(Transform parent, string objectName)
    {
        if (parent == null || string.IsNullOrWhiteSpace(objectName))
        {
            return null;
        }

        Transform child = parent.Find(objectName);
        return child != null ? child.GetComponent<TextMeshProUGUI>() : null;
    }

    private static RectTransform ResolveDirectChildRect(Transform parent, string childName)
    {
        if (parent == null || string.IsNullOrWhiteSpace(childName))
        {
            return null;
        }

        return parent.Find(childName) as RectTransform;
    }

    private static void DeactivateLegacyCardLabelContainers(Transform cardRoot, params TextMeshProUGUI[] keepLabels)
    {
        if (cardRoot == null)
        {
            return;
        }

        HashSet<Transform> keepTransforms = new HashSet<Transform>();
        for (int keepIndex = 0; keepIndex < keepLabels.Length; keepIndex++)
        {
            if (keepLabels[keepIndex] != null)
            {
                keepTransforms.Add(keepLabels[keepIndex].transform);
            }
        }

        for (int childIndex = 0; childIndex < cardRoot.childCount; childIndex++)
        {
            Transform child = cardRoot.GetChild(childIndex);
            if (child == null || keepTransforms.Contains(child))
            {
                continue;
            }

            TextMeshProUGUI directLabel = child.GetComponent<TextMeshProUGUI>();
            if (directLabel == null)
            {
                continue;
            }

            directLabel.text = string.Empty;
            directLabel.enabled = false;
            child.gameObject.SetActive(false);
        }
    }

    private static void DeactivateNestedDuplicateLabels(Transform parent, string objectName, TextMeshProUGUI keepLabel)
    {
        if (parent == null || string.IsNullOrWhiteSpace(objectName))
        {
            return;
        }

        TextMeshProUGUI[] labels = parent.GetComponentsInChildren<TextMeshProUGUI>(true);
        for (int i = 0; i < labels.Length; i++)
        {
            TextMeshProUGUI candidate = labels[i];
            if (candidate == null || candidate == keepLabel || !string.Equals(candidate.gameObject.name, objectName, StringComparison.Ordinal))
            {
                continue;
            }

            if (candidate.transform.parent != parent)
            {
                candidate.text = string.Empty;
                candidate.enabled = false;
                candidate.gameObject.SetActive(false);
            }
        }
    }

    private static void DeactivateSiblingTextTargets(Transform parent, TextMeshProUGUI keepLabel)
    {
        if (parent == null)
        {
            return;
        }

        for (int i = 0; i < parent.childCount; i++)
        {
            Transform child = parent.GetChild(i);
            if (child == null)
            {
                continue;
            }

            TextMeshProUGUI siblingLabel = child.GetComponent<TextMeshProUGUI>();
            if (siblingLabel == null || siblingLabel == keepLabel)
            {
                continue;
            }

            siblingLabel.text = string.Empty;
            siblingLabel.enabled = false;
            child.gameObject.SetActive(false);
        }
    }

    private static void CopyRectTransform(RectTransform source, RectTransform target, Vector2 fallbackSize)
    {
        if (target == null)
        {
            return;
        }

        if (source == null)
        {
            target.anchorMin = new Vector2(0.5f, 0.5f);
            target.anchorMax = new Vector2(0.5f, 0.5f);
            target.pivot = new Vector2(0.5f, 0.5f);
            target.anchoredPosition = Vector2.zero;
            target.sizeDelta = fallbackSize;
            target.localScale = Vector3.one;
            return;
        }

        target.anchorMin = source.anchorMin;
        target.anchorMax = source.anchorMax;
        target.pivot = source.pivot;
        target.anchoredPosition = source.anchoredPosition;
        target.sizeDelta = source.rect.size.x > 1f && source.rect.size.y > 1f
            ? source.rect.size
            : fallbackSize;
        target.localScale = Vector3.one;
        target.localRotation = Quaternion.identity;
    }

    private static string ReadText(TMP_Text label, string fallback)
    {
        string value = label != null ? (label.text ?? string.Empty) : string.Empty;
        return string.IsNullOrWhiteSpace(value) ? fallback : value;
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

        CandyTypographyRole role = CandyTypographySystem.Classify(label);
        RealtimeTextStyleUtils.ApplyGameplayTextPresentation(
            label,
            role,
            RealtimeTextStyleUtils.ClassifyGameplaySurface(label));

        LayoutRebuilder.ForceRebuildLayoutImmediate(rect);
        EditorUtility.SetDirty(rect);
        EditorUtility.SetDirty(label);
    }
}
