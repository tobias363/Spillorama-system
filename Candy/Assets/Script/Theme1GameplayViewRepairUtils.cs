using System;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public static class Theme1GameplayViewRepairUtils
{
    private sealed class ImageTemplateSnapshot
    {
        public Sprite Sprite;
        public Color Color = Color.white;
        public Material Material;
        public Image.Type Type;
        public bool PreserveAspect;
        public bool FillCenter = true;
        public Image.FillMethod FillMethod;
        public float FillAmount = 1f;
        public bool FillClockwise = true;
        public int FillOrigin;

        public static ImageTemplateSnapshot Capture(GameObject templateObject)
        {
            Image image = templateObject != null ? templateObject.GetComponent<Image>() : null;
            if (image == null)
            {
                return null;
            }

            return new ImageTemplateSnapshot
            {
                Sprite = image.sprite,
                Color = image.color,
                Material = image.material,
                Type = image.type,
                PreserveAspect = image.preserveAspect,
                FillCenter = image.fillCenter,
                FillMethod = image.fillMethod,
                FillAmount = image.fillAmount,
                FillClockwise = image.fillClockwise,
                FillOrigin = image.fillOrigin
            };
        }
    }

    private const string CardNumberLayerName = "RealtimeCardNumbers";
    private const string CardNumberHostPrefix = "RealtimeCardCell_";
    private const string CardNumberLabelName = "RealtimeCardNumberLabel";
    private const string CardNumberVisibleLabelName = "RealtimeCardNumberVisibleLabel";
    private const string SelectionMarkerName = "RealtimeSelectionMarker";
    private const string MissingOverlayName = "RealtimeMissingOverlay";
    private const string MatchedOverlayName = "RealtimeMatchedOverlay";
    private const string CreditValueLabelName = "RealtimeCreditValueLabel";
    private const string WinningsValueLabelName = "RealtimeWinningsValueLabel";
    private const string BetValueLabelName = "RealtimeBetValueLabel";
    private const string VisibleLabelSuffix = "_Visible";
    private const string BallNumberLabelName = "RealtimeBallNumberLabel";
    private const string BigBallNumberLabelName = "RealtimeBigBallNumberLabel";
    private const string CardBackgroundName = "CardBg";
    private const int TotalCardCellCount = 15;
    private const int VisibleCardCellCount = 15;
    private const int VisibleCardRows = 3;
    private const int VisibleCardColumns = 5;
    private const float CardGridWidthRatio = 0.8886719f;
    private const float CardGridHeightRatio = 0.5292969f;
    private const float CardGridOffsetXRatio = 0f;
    private const float CardGridOffsetYRatio = -0.03076172f;

    private enum RuntimeCardLabelKind
    {
        CardIndex,
        Stake,
        Win
    }

    public static void EnsureCardNumberTargets(NumberGenerator generator)
    {
        if (generator?.cardClasses == null)
        {
            return;
        }

        for (int cardIndex = 0; cardIndex < generator.cardClasses.Length; cardIndex++)
        {
            CardClass card = generator.cardClasses[cardIndex];
            if (card == null)
            {
                continue;
            }

            List<ImageTemplateSnapshot> selectionTemplates = SnapshotOverlayTemplates(card.selectionImg);
            List<ImageTemplateSnapshot> missingTemplates = SnapshotOverlayTemplates(card.missingPatternImg);
            List<ImageTemplateSnapshot> matchedTemplates = SnapshotOverlayTemplates(card.matchPatternImg);
            Transform cardRoot = ResolveCardRoot(card);
            RectTransform visibleGrid = EnsureDedicatedVisibleGrid(cardRoot);
            if (visibleGrid == null)
            {
                continue;
            }

            card.num_text ??= new List<TextMeshProUGUI>(TotalCardCellCount);
            card.selectionImg ??= new List<GameObject>(TotalCardCellCount);
            card.missingPatternImg ??= new List<GameObject>(TotalCardCellCount);
            card.matchPatternImg ??= new List<GameObject>(TotalCardCellCount);
            EnsureListCapacity(card.num_text, TotalCardCellCount);
            EnsureListCapacity(card.selectionImg, TotalCardCellCount);
            EnsureListCapacity(card.missingPatternImg, TotalCardCellCount);
            EnsureListCapacity(card.matchPatternImg, TotalCardCellCount);
            for (int cellIndex = 0; cellIndex < TotalCardCellCount; cellIndex++)
            {
                RectTransform cellRoot = ResolveDedicatedCellRoot(visibleGrid, cellIndex);
                if (cellRoot == null)
                {
                    continue;
                }

                Vector2 preferredSize = ResolvePreferredCellSize(cellRoot);
                TextMeshProUGUI label = ResolveOrCreateTextLabel(
                    cellRoot,
                    CardNumberLabelName,
                    preferredSize,
                    GameplayTextSurface.CardNumber,
                    new Color32(184, 51, 99, 255),
                    fontSizeMin: 20f,
                    fontSizeMax: 72f);
                if (label == null)
                {
                    continue;
                }

                PlaceCardNumberLabel(label.rectTransform, cellRoot);
                EnsureVisibleTextMirror(label, CardNumberVisibleLabelName, new Color32(184, 51, 99, 255), hideWhenBlank: false);
                DeactivateLegacyTextLabels(cellRoot, label);
                GameObject selectionMarker = EnsureCardCellOverlay(
                    cellRoot,
                    SelectionMarkerName,
                    GetTemplateSnapshot(selectionTemplates, cellIndex),
                    stretchToCell: true);
                GameObject missingOverlay = EnsureCardCellOverlay(
                    cellRoot,
                    MissingOverlayName,
                    GetTemplateSnapshot(missingTemplates, cellIndex),
                    stretchToCell: true);
                GameObject matchedOverlay = EnsureCardCellOverlay(
                    cellRoot,
                    MatchedOverlayName,
                    GetTemplateSnapshot(matchedTemplates, cellIndex),
                    stretchToCell: true);

                bool isVisibleCell = cellIndex < VisibleCardCellCount;
                cellRoot.gameObject.SetActive(isVisibleCell);
                SetActiveIfNeeded(selectionMarker, false);
                SetActiveIfNeeded(missingOverlay, false);
                SetActiveIfNeeded(matchedOverlay, false);
                card.num_text[cellIndex] = label;
                card.selectionImg[cellIndex] = selectionMarker;
                card.missingPatternImg[cellIndex] = missingOverlay;
                card.matchPatternImg[cellIndex] = matchedOverlay;
            }

            PromoteCardNumberLayer(visibleGrid);
        }
    }

    public static void EnsureBallNumberTargets(BallManager ballManager)
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

                RectTransform rootRect = root.GetComponent<RectTransform>();
                Vector2 preferredSize = rootRect != null && rootRect.rect.width > 1f && rootRect.rect.height > 1f
                    ? rootRect.rect.size
                    : new Vector2(84f, 84f);
                TextMeshProUGUI label = ResolveOrCreateTextLabel(
                    root.transform,
                    BallNumberLabelName,
                    preferredSize,
                    GameplayTextSurface.BallNumber,
                    Color.white,
                    fontSizeMin: 14f,
                    fontSizeMax: 40f);
                if (label == null)
                {
                    continue;
                }

                PlaceBallNumberLabel(label.rectTransform, preferredSize);
                DeactivateLegacyTextLabels(root.transform, label);
            }
        }

        if (ballManager.bigBallImg != null)
        {
            RectTransform bigBallRect = ballManager.bigBallImg.rectTransform;
            Vector2 preferredSize = bigBallRect != null && bigBallRect.rect.width > 1f && bigBallRect.rect.height > 1f
                ? bigBallRect.rect.size
                : new Vector2(160f, 160f);
            TextMeshProUGUI label = ResolveOrCreateTextLabel(
                ballManager.bigBallImg.transform,
                BigBallNumberLabelName,
                preferredSize,
                GameplayTextSurface.BallNumber,
                Color.white,
                fontSizeMin: 40f,
                fontSizeMax: 72f);
            if (label != null)
            {
                PlaceBallNumberLabel(label.rectTransform, preferredSize);
                DeactivateLegacyTextLabels(ballManager.bigBallImg.transform, label);
            }
        }
    }

    public static void EnsureCardDisplayTextBindings(CandyCardViewBindingSet cardBindings, GameManager gameManager)
    {
        if (cardBindings?.Cards == null)
        {
            return;
        }

        List<TextMeshProUGUI> resolvedBetLabels = new List<TextMeshProUGUI>(cardBindings.Cards.Count);
        List<TextMeshProUGUI> resolvedWinLabels = new List<TextMeshProUGUI>(cardBindings.Cards.Count);

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
                RuntimeCardLabelKind.CardIndex,
                gameManager != null ? gameManager.GetCardIndexLabel(cardIndex) : $"Bong - {cardIndex + 1}");
            TextMeshProUGUI bet = EnsureDedicatedCardLabel(
                cardRoot,
                $"RealtimeCardBetLabel_{cardIndex + 1}",
                RuntimeCardLabelKind.Stake,
                gameManager != null ? gameManager.GetCardStakeLabel() : "Innsats - 0 kr");
            TextMeshProUGUI win = EnsureDedicatedCardLabel(
                cardRoot,
                $"RealtimeCardWinLabel_{cardIndex + 1}",
                RuntimeCardLabelKind.Win,
                gameManager != null ? gameManager.FormatCardWinLabel(0) : "Gevinst - 0 kr");

            ApplyOverlayLabelDefault(header, gameManager != null ? gameManager.GetCardIndexLabel(cardIndex) : $"Bong - {cardIndex + 1}");
            ApplyOverlayLabelDefault(bet, gameManager != null ? gameManager.GetCardStakeLabel() : "Innsats - 0 kr");
            ApplyOverlayLabelDefault(win, gameManager != null ? gameManager.FormatCardWinLabel(0) : "Gevinst - 0 kr");
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
        }
    }

    public static CandyCardViewBinding BuildDedicatedCardBinding(CardClass card, int cardIndex, GameManager gameManager)
    {
        if (card == null)
        {
            return null;
        }

        CandyCardViewBinding binding = new CandyCardViewBinding();
        binding.CopyFrom(card, $"Card {cardIndex + 1}");

        Transform cardRoot = ResolveCardRoot(card);
        if (cardRoot == null)
        {
            return binding;
        }

        string headerText = gameManager != null
            ? gameManager.GetCardIndexLabel(cardIndex)
            : GameManager.FormatTheme1CardHeaderLabel(cardIndex);
        string betText = gameManager != null
            ? gameManager.GetCardStakeLabel()
            : GameManager.FormatTheme1CardStakeLabel(0);
        int cardWinAmount = gameManager != null ? gameManager.GetCardWinAmount(cardIndex) : 0;
        string winText = gameManager != null
            ? gameManager.FormatCardWinLabel(cardWinAmount)
            : GameManager.FormatTheme1CardWinLabel(cardWinAmount);

        TextMeshProUGUI header = EnsureDedicatedCardLabel(
            cardRoot,
            $"RealtimeCardHeaderLabel_{cardIndex + 1}",
            RuntimeCardLabelKind.CardIndex,
            headerText);
        TextMeshProUGUI bet = EnsureDedicatedCardLabel(
            cardRoot,
            $"RealtimeCardBetLabel_{cardIndex + 1}",
            RuntimeCardLabelKind.Stake,
            betText);
        TextMeshProUGUI win = EnsureDedicatedCardLabel(
            cardRoot,
            $"RealtimeCardWinLabel_{cardIndex + 1}",
            RuntimeCardLabelKind.Win,
            winText);

        ApplyOverlayLabelDefault(header, headerText);
        ApplyOverlayLabelDefault(bet, betText);
        ApplyOverlayLabelDefault(win, winText);
        if (win != null)
        {
            win.gameObject.SetActive(cardWinAmount > 0);
        }

        DeactivateLegacyCardLabelContainers(cardRoot, header, bet, win);
        binding.SetDisplayTexts(header, bet, win);
        card.win = win;
        return binding;
    }

    public static void EnsureHudValueTargets(GameManager gameManager)
    {
        if (gameManager == null)
        {
            return;
        }

        gameManager.displayTotalMoney = EnsureDedicatedHudValueTarget(
            gameManager.displayTotalMoney,
            CreditValueLabelName,
            gameManager.CreditBalance.ToString());
        gameManager.winAmtText = EnsureDedicatedHudValueTarget(
            gameManager.winAmtText,
            WinningsValueLabelName,
            gameManager.RoundWinnings.ToString());
        gameManager.displayCurrentBets = EnsureDedicatedHudValueTarget(
            gameManager.displayCurrentBets,
            BetValueLabelName,
            gameManager.currentBet.ToString());

        ApplyOverlayLabelDefault(gameManager.displayTotalMoney, gameManager.CreditBalance.ToString());
        ApplyOverlayLabelDefault(gameManager.winAmtText, gameManager.RoundWinnings.ToString());
        ApplyOverlayLabelDefault(gameManager.displayCurrentBets, gameManager.currentBet.ToString());
    }

    public static TextMeshProUGUI FindDedicatedCardNumberLabel(GameObject selectionOverlay)
    {
        RectTransform cellRoot = ResolveCardCellRoot(selectionOverlay);
        return FindNamedTextLabel(cellRoot, CardNumberLabelName);
    }

    public static TextMeshProUGUI FindDedicatedBallNumberLabel(GameObject root)
    {
        return root == null ? null : FindNamedTextLabel(root.transform, BallNumberLabelName);
    }

    public static TextMeshProUGUI FindDedicatedBigBallNumberLabel(Image bigBallImage)
    {
        return bigBallImage == null ? null : FindNamedTextLabel(bigBallImage.transform, BigBallNumberLabelName);
    }

    public static bool IsDedicatedCardNumberLabel(TextMeshProUGUI label, GameObject selectionOverlay)
    {
        return label != null &&
               string.Equals(label.gameObject.name, CardNumberLabelName, StringComparison.Ordinal) &&
               IsTextLocalToSelectionOverlay(label, selectionOverlay);
    }

    public static bool IsDedicatedBallNumberLabel(TextMeshProUGUI label, GameObject root)
    {
        return label != null &&
               string.Equals(label.gameObject.name, BallNumberLabelName, StringComparison.Ordinal) &&
               IsTextLocalToBallRoot(label, root);
    }

    public static bool IsDedicatedBigBallNumberLabel(TextMeshProUGUI label, Image bigBallImage)
    {
        return label != null &&
               bigBallImage != null &&
               string.Equals(label.gameObject.name, BigBallNumberLabelName, StringComparison.Ordinal) &&
               label.transform.IsChildOf(bigBallImage.transform);
    }

    public static bool IsTextLocalToSelectionOverlay(TextMeshProUGUI label, GameObject selectionOverlay)
    {
        if (label == null || selectionOverlay == null)
        {
            return false;
        }

        RectTransform cellRoot = ResolveCardCellRoot(selectionOverlay);
        return cellRoot != null &&
               label.transform.parent == cellRoot &&
               cellRoot.parent != null &&
               string.Equals(cellRoot.parent.name, CardNumberLayerName, StringComparison.Ordinal);
    }

    public static bool IsTextLocalToBallRoot(TextMeshProUGUI label, GameObject root)
    {
        return label != null && root != null && label.transform.IsChildOf(root.transform);
    }

    private static void EnsureListCapacity<T>(List<T> items, int requiredCount)
    {
        if (items == null)
        {
            return;
        }

        while (items.Count < requiredCount)
        {
            items.Add(default);
        }
    }

    private static Transform ResolveCardRoot(CardClass card)
    {
        if (card == null)
        {
            return null;
        }

        if (card.selectionImg != null)
        {
            for (int i = 0; i < card.selectionImg.Count; i++)
            {
                Transform resolved = ResolveCardRoot(card.selectionImg[i]);
                if (resolved != null)
                {
                    return resolved;
                }
            }
        }

        if (card.num_text != null)
        {
            for (int i = 0; i < card.num_text.Count; i++)
            {
                Transform resolved = ResolveCardRoot(card.num_text[i] != null ? card.num_text[i].transform : null);
                if (resolved != null)
                {
                    return resolved;
                }
            }
        }

        if (card.win != null)
        {
            Transform resolved = ResolveCardRoot(card.win.transform);
            if (resolved != null)
            {
                return resolved;
            }
        }

        if (card.paylineObj != null)
        {
            for (int i = 0; i < card.paylineObj.Count; i++)
            {
                Transform resolved = ResolveCardRoot(card.paylineObj[i] != null ? card.paylineObj[i].transform : null);
                if (resolved != null)
                {
                    return resolved;
                }
            }
        }

        return null;
    }

    private static Transform ResolveCardRoot(CandyCardViewBinding binding)
    {
        if (binding == null)
        {
            return null;
        }

        IReadOnlyList<GameObject> selectionOverlays = binding.SelectionOverlays;
        if (selectionOverlays != null)
        {
            for (int i = 0; i < selectionOverlays.Count; i++)
            {
                Transform resolved = ResolveCardRoot(selectionOverlays[i] != null ? selectionOverlays[i].transform : null);
                if (resolved != null)
                {
                    return resolved;
                }
            }
        }

        IReadOnlyList<TextMeshProUGUI> numberTexts = binding.NumberTexts;
        if (numberTexts != null)
        {
            for (int i = 0; i < numberTexts.Count; i++)
            {
                Transform resolved = ResolveCardRoot(numberTexts[i] != null ? numberTexts[i].transform : null);
                if (resolved != null)
                {
                    return resolved;
                }
            }
        }

        return null;
    }

    private static Transform ResolveCardRoot(GameObject selectionOverlay)
    {
        return ResolveCardRoot(selectionOverlay != null ? selectionOverlay.transform : null);
    }

    private static Transform ResolveCardRoot(Transform source)
    {
        if (source == null)
        {
            return null;
        }

        Transform current = source;
        while (current != null)
        {
            if (string.Equals(current.name, CardNumberLayerName, StringComparison.Ordinal) && current.parent != null)
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

    private static RectTransform EnsureDedicatedVisibleGrid(Transform cardRoot)
    {
        if (!(cardRoot is RectTransform cardRect))
        {
            return null;
        }

        RectTransform dedicatedGrid = cardRoot.Find(CardNumberLayerName) as RectTransform;
        if (dedicatedGrid == null)
        {
            GameObject gridObject = new GameObject(CardNumberLayerName, typeof(RectTransform));
            gridObject.layer = cardRoot.gameObject.layer;
            gridObject.transform.SetParent(cardRoot, false);
            dedicatedGrid = gridObject.GetComponent<RectTransform>();
        }

        if (dedicatedGrid == null)
        {
            return null;
        }

        dedicatedGrid.SetParent(cardRect, false);
        ConfigureDedicatedGridRect(dedicatedGrid, cardRoot);
        dedicatedGrid.gameObject.SetActive(true);
        dedicatedGrid.SetSiblingIndex(Mathf.Clamp(cardRoot.childCount - 4, 0, Mathf.Max(0, cardRoot.childCount - 1)));
        RebuildDedicatedGridCells(dedicatedGrid);

        DeactivateLegacyCardGrids(cardRoot, dedicatedGrid);
        return dedicatedGrid;
    }

    private static void ConfigureDedicatedGridRect(RectTransform gridRoot, Transform cardRoot)
    {
        if (gridRoot == null)
        {
            return;
        }

        RectTransform cardBackground = ResolveCardBackgroundRect(cardRoot);
        Vector2 baseSize = cardBackground != null && cardBackground.rect.width > 1f && cardBackground.rect.height > 1f
            ? cardBackground.rect.size
            : new Vector2(585f, 325f);
        Vector2 basePosition = cardBackground != null ? cardBackground.anchoredPosition : new Vector2(2f, -5f);

        gridRoot.anchorMin = new Vector2(0.5f, 0.5f);
        gridRoot.anchorMax = new Vector2(0.5f, 0.5f);
        gridRoot.pivot = new Vector2(0.5f, 0.5f);
        gridRoot.localScale = Vector3.one;
        gridRoot.localRotation = Quaternion.identity;
        gridRoot.sizeDelta = new Vector2(baseSize.x * CardGridWidthRatio, baseSize.y * CardGridHeightRatio);
        gridRoot.anchoredPosition = new Vector2(
            basePosition.x + (baseSize.x * CardGridOffsetXRatio),
            basePosition.y + (baseSize.y * CardGridOffsetYRatio));

        GridLayoutGroup legacyGrid = gridRoot.GetComponent<GridLayoutGroup>();
        if (legacyGrid != null)
        {
            DestroyComponentImmediate(legacyGrid);
        }

        Image gridImage = gridRoot.GetComponent<Image>();
        if (gridImage != null)
        {
            DestroyComponentImmediate(gridImage);
        }
    }

    private static void RebuildDedicatedGridCells(RectTransform gridRoot)
    {
        if (gridRoot == null)
        {
            return;
        }

        Vector2 gridSize = gridRoot.rect.width > 1f && gridRoot.rect.height > 1f
            ? gridRoot.rect.size
            : new Vector2(520f, 191f);
        float cellWidth = gridSize.x / VisibleCardColumns;
        float cellHeight = gridSize.y / VisibleCardRows;

        for (int cellIndex = 0; cellIndex < TotalCardCellCount; cellIndex++)
        {
            RectTransform cellRoot = cellIndex < gridRoot.childCount
                ? gridRoot.GetChild(cellIndex) as RectTransform
                : null;
            if (cellRoot == null)
            {
                GameObject cellObject = new GameObject(CardNumberHostPrefix + (cellIndex + 1).ToString("00"), typeof(RectTransform));
                cellObject.layer = gridRoot.gameObject.layer;
                cellObject.transform.SetParent(gridRoot, false);
                cellRoot = cellObject.GetComponent<RectTransform>();
            }

            if (cellRoot == null)
            {
                continue;
            }

            cellRoot.gameObject.name = CardNumberHostPrefix + (cellIndex + 1).ToString("00");
            cellRoot.gameObject.layer = gridRoot.gameObject.layer;
            ConfigureDedicatedCellRoot(cellRoot, cellIndex, cellWidth, cellHeight, gridSize);
        }

        for (int childIndex = TotalCardCellCount; childIndex < gridRoot.childCount; childIndex++)
        {
            Transform extraChild = gridRoot.GetChild(childIndex);
            if (extraChild != null)
            {
                extraChild.gameObject.SetActive(false);
            }
        }
    }

    private static void ConfigureDedicatedCellRoot(RectTransform cellRoot, int cellIndex, float cellWidth, float cellHeight, Vector2 gridSize)
    {
        if (cellRoot == null)
        {
            return;
        }

        cellRoot.anchorMin = new Vector2(0.5f, 0.5f);
        cellRoot.anchorMax = new Vector2(0.5f, 0.5f);
        cellRoot.pivot = new Vector2(0.5f, 0.5f);
        cellRoot.localScale = Vector3.one;
        cellRoot.localRotation = Quaternion.identity;

        if (cellIndex < VisibleCardCellCount)
        {
            int column = cellIndex / VisibleCardRows;
            int row = cellIndex % VisibleCardRows;
            float x = (-gridSize.x * 0.5f) + (column * cellWidth) + (cellWidth * 0.5f);
            float y = (gridSize.y * 0.5f) - (row * cellHeight) - (cellHeight * 0.5f);
            cellRoot.anchoredPosition = new Vector2(x, y);
            cellRoot.sizeDelta = new Vector2(cellWidth, cellHeight);
            cellRoot.gameObject.SetActive(true);
        }
        else
        {
            float overflowY = (-gridSize.y * 0.5f) - cellHeight - ((cellIndex - VisibleCardCellCount) * (cellHeight + 8f));
            cellRoot.anchoredPosition = new Vector2(0f, overflowY);
            cellRoot.sizeDelta = new Vector2(cellWidth, cellHeight);
            cellRoot.gameObject.SetActive(false);
        }
    }

    private static RectTransform ResolveDedicatedCellRoot(RectTransform gridRoot, int cellIndex)
    {
        if (gridRoot == null || cellIndex < 0 || cellIndex >= gridRoot.childCount)
        {
            return null;
        }

        return gridRoot.GetChild(cellIndex) as RectTransform;
    }

    private static RectTransform ResolveCardCellRoot(GameObject overlay)
    {
        if (overlay == null)
        {
            return null;
        }

        Transform current = overlay.transform;
        while (current != null)
        {
            if (current is RectTransform cellRoot &&
                current.parent != null &&
                (current.parent.GetComponent<GridLayoutGroup>() != null ||
                 string.Equals(current.parent.name, CardNumberLayerName, StringComparison.Ordinal)))
            {
                return cellRoot;
            }

            current = current.parent;
        }

        return null;
    }

    private static GameObject EnsureCardCellOverlay(
        RectTransform cellRoot,
        string objectName,
        ImageTemplateSnapshot templateImage,
        bool stretchToCell)
    {
        if (cellRoot == null)
        {
            return null;
        }

        Transform existingChild = cellRoot.Find(objectName);
        GameObject overlayObject = existingChild != null
            ? existingChild.gameObject
            : new GameObject(objectName, typeof(RectTransform), typeof(Image));
        if (overlayObject.transform.parent != cellRoot)
        {
            overlayObject.transform.SetParent(cellRoot, false);
        }

        overlayObject.name = objectName;
        overlayObject.layer = cellRoot.gameObject.layer;
        overlayObject.SetActive(true);
        Image overlayImage = overlayObject.GetComponent<Image>();
        if (overlayImage == null)
        {
            overlayImage = overlayObject.AddComponent<Image>();
        }

        ApplyImageTemplate(overlayImage, templateImage);

        RectTransform rect = overlayObject.GetComponent<RectTransform>();
        if (stretchToCell)
        {
            rect.anchorMin = Vector2.zero;
            rect.anchorMax = Vector2.one;
            rect.offsetMin = Vector2.zero;
            rect.offsetMax = Vector2.zero;
            rect.pivot = new Vector2(0.5f, 0.5f);
        }
        else
        {
            rect.anchorMin = new Vector2(0.5f, 0.5f);
            rect.anchorMax = new Vector2(0.5f, 0.5f);
            rect.pivot = new Vector2(0.5f, 0.5f);
            rect.anchoredPosition = Vector2.zero;
            rect.sizeDelta = ResolvePreferredCellSize(cellRoot);
        }

        rect.localScale = Vector3.one;
        overlayObject.transform.SetAsLastSibling();
        return overlayObject;
    }

    private static void ApplyImageTemplate(Image target, Image template)
    {
        if (target == null)
        {
            return;
        }

        if (template != null)
        {
            target.sprite = template.sprite;
            target.color = template.color;
            target.material = template.material;
            target.type = template.type;
            target.preserveAspect = template.preserveAspect;
            target.fillCenter = template.fillCenter;
            target.fillMethod = template.fillMethod;
            target.fillAmount = template.fillAmount;
            target.fillClockwise = template.fillClockwise;
            target.fillOrigin = template.fillOrigin;
        }

        target.raycastTarget = false;
        target.enabled = true;
    }

    private static void ApplyImageTemplate(Image target, ImageTemplateSnapshot template)
    {
        if (target == null)
        {
            return;
        }

        if (template != null)
        {
            target.sprite = template.Sprite;
            target.color = template.Color;
            target.material = template.Material;
            target.type = template.Type;
            target.preserveAspect = template.PreserveAspect;
            target.fillCenter = template.FillCenter;
            target.fillMethod = template.FillMethod;
            target.fillAmount = template.FillAmount;
            target.fillClockwise = template.FillClockwise;
            target.fillOrigin = template.FillOrigin;
        }

        target.raycastTarget = false;
        target.enabled = true;
    }

    private static List<ImageTemplateSnapshot> SnapshotOverlayTemplates(IReadOnlyList<GameObject> templates)
    {
        List<ImageTemplateSnapshot> images = new List<ImageTemplateSnapshot>(templates != null ? templates.Count : 0);
        if (templates == null)
        {
            return images;
        }

        for (int i = 0; i < templates.Count; i++)
        {
            images.Add(ImageTemplateSnapshot.Capture(templates[i]));
        }

        return images;
    }

    private static ImageTemplateSnapshot GetTemplateSnapshot(IReadOnlyList<ImageTemplateSnapshot> templates, int index)
    {
        if (templates == null || index < 0 || index >= templates.Count)
        {
            return null;
        }

        return templates[index];
    }

    private static void DeactivateLegacyCardGrids(Transform cardRoot, RectTransform keepGrid)
    {
        if (cardRoot == null)
        {
            return;
        }

        for (int i = 0; i < cardRoot.childCount; i++)
        {
            Transform child = cardRoot.GetChild(i);
            if (child == null || child == keepGrid)
            {
                continue;
            }

            bool isLegacyOverlay =
                string.Equals(child.name, "SelectedCard", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(child.name, "MissingCard", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(child.name, "MatchCard", StringComparison.OrdinalIgnoreCase);
            bool isLegacyVisibleGrid =
                string.Equals(child.name, "CardNumbers", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(child.name, "Image", StringComparison.OrdinalIgnoreCase) ||
                (child.GetComponent<GridLayoutGroup>() != null &&
                 string.Equals(child.name, CardNumberLayerName, StringComparison.OrdinalIgnoreCase));
            bool isLegacyCardLabel =
                child.GetComponent<TextMeshProUGUI>() != null &&
                !string.Equals(child.name, "RealtimeCardHeaderLabel_1", StringComparison.Ordinal) &&
                !string.Equals(child.name, "RealtimeCardHeaderLabel_2", StringComparison.Ordinal) &&
                !string.Equals(child.name, "RealtimeCardHeaderLabel_3", StringComparison.Ordinal) &&
                !string.Equals(child.name, "RealtimeCardHeaderLabel_4", StringComparison.Ordinal) &&
                !string.Equals(child.name, "RealtimeCardBetLabel_1", StringComparison.Ordinal) &&
                !string.Equals(child.name, "RealtimeCardBetLabel_2", StringComparison.Ordinal) &&
                !string.Equals(child.name, "RealtimeCardBetLabel_3", StringComparison.Ordinal) &&
                !string.Equals(child.name, "RealtimeCardBetLabel_4", StringComparison.Ordinal) &&
                !string.Equals(child.name, "RealtimeCardWinLabel_1", StringComparison.Ordinal) &&
                !string.Equals(child.name, "RealtimeCardWinLabel_2", StringComparison.Ordinal) &&
                !string.Equals(child.name, "RealtimeCardWinLabel_3", StringComparison.Ordinal) &&
                !string.Equals(child.name, "RealtimeCardWinLabel_4", StringComparison.Ordinal);
            if (isLegacyOverlay || isLegacyVisibleGrid)
            {
                child.gameObject.SetActive(false);
            }
            else if (isLegacyCardLabel)
            {
                child.gameObject.SetActive(false);
            }
        }

        DeactivateNestedCardNumberDuplicates(cardRoot, keepGrid);
    }

    private static void DeactivateNestedCardNumberDuplicates(Transform cardRoot, RectTransform keepGrid)
    {
        if (cardRoot == null)
        {
            return;
        }

        TextMeshProUGUI[] labels = cardRoot.GetComponentsInChildren<TextMeshProUGUI>(true);
        for (int i = 0; i < labels.Length; i++)
        {
            TextMeshProUGUI candidate = labels[i];
            if (candidate == null || !string.Equals(candidate.gameObject.name, CardNumberLabelName, StringComparison.Ordinal))
            {
                continue;
            }

            bool belongsToKeepGrid =
                keepGrid != null &&
                candidate.transform.parent != null &&
                candidate.transform.parent.parent == keepGrid;
            if (belongsToKeepGrid)
            {
                continue;
            }

            candidate.text = string.Empty;
            candidate.enabled = false;
            candidate.gameObject.SetActive(false);
        }
    }

    private static void PromoteCardNumberLayer(RectTransform visibleGrid)
    {
        if (visibleGrid == null)
        {
            return;
        }

        visibleGrid.gameObject.SetActive(true);
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

        return target ?? template;
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
        label.gameObject.SetActive(true);
        label.enabled = true;
        label.raycastTarget = false;
        label.alpha = 1f;
        label.text = !string.IsNullOrWhiteSpace(ReadText(label, string.Empty))
            ? ReadText(label, string.Empty)
            : (!string.IsNullOrWhiteSpace(ReadText(template, string.Empty)) ? ReadText(template, string.Empty) : defaultText);
        label.transform.SetAsLastSibling();
        DeactivateNestedDuplicateLabels(parent, objectName, label);
        RealtimeTextStyleUtils.ApplyGameplayTextPresentation(label, CandyTypographyRole.Label, surface);
        EnsureVisibleTextMirror(label, objectName + VisibleLabelSuffix, fallbackColor, hideWhenBlank: false);
        return label;
    }

    private static void ApplyOverlayLabelDefault(TextMeshProUGUI label, string value)
    {
        if (label == null)
        {
            return;
        }

        label.text = value ?? string.Empty;
        label.alpha = 1f;
        label.enabled = true;
        if (!label.gameObject.activeSelf)
        {
            label.gameObject.SetActive(true);
        }

        SyncVisibleTextMirror(label);
    }

    private static TextMeshProUGUI EnsureDedicatedCardLabel(
        Transform cardRoot,
        string objectName,
        RuntimeCardLabelKind labelKind,
        string defaultText)
    {
        if (!(cardRoot is RectTransform))
        {
            return null;
        }

        TextMeshProUGUI label = FindNamedTextLabel(cardRoot, objectName);
        if (label == null)
        {
            GameObject labelObject = new GameObject(objectName, typeof(RectTransform), typeof(TextMeshProUGUI));
            labelObject.layer = cardRoot.gameObject.layer;
            labelObject.transform.SetParent(cardRoot, false);
            label = labelObject.GetComponent<TextMeshProUGUI>();
        }

        if (label == null)
        {
            return null;
        }

        RectTransform cardBackground = ResolveCardBackgroundRect(cardRoot);
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
            case RuntimeCardLabelKind.Stake:
                rect.anchoredPosition = new Vector2(
                    basePosition.x - (baseSize.x * 0.18f),
                    basePosition.y + (baseSize.y * 0.405f));
                rect.sizeDelta = new Vector2(Mathf.Max(180f, baseSize.x * 0.34f), 38f);
                label.alignment = TextAlignmentOptions.Center;
                RealtimeTextStyleUtils.ApplyGameplayTextPresentation(label, CandyTypographyRole.Label, GameplayTextSurface.HudLabel);
                break;
            case RuntimeCardLabelKind.Win:
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

        EnsureVisibleTextMirror(
            label,
            objectName + VisibleLabelSuffix,
            Color.white,
            hideWhenBlank: labelKind == RuntimeCardLabelKind.Win);
        label.transform.SetAsLastSibling();
        DeactivateNestedDuplicateLabels(cardRoot, objectName, label);
        return label;
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

            child.gameObject.SetActive(false);
        }
    }

    private static void DeactivateSiblingTextTargets(Transform parent, TextMeshProUGUI keepLabel)
    {
        if (parent == null || keepLabel == null)
        {
            return;
        }

        TextMeshProUGUI[] labels = parent.GetComponentsInChildren<TextMeshProUGUI>(true);
        for (int i = 0; i < labels.Length; i++)
        {
            TextMeshProUGUI candidate = labels[i];
            if (candidate == null || candidate == keepLabel)
            {
                continue;
            }

            if (candidate.transform.parent != parent)
            {
                continue;
            }

            candidate.gameObject.SetActive(false);
        }
    }

    private static void DeactivateNestedDuplicateLabels(Transform parent, string objectName, TextMeshProUGUI keepLabel)
    {
        if (parent == null || string.IsNullOrWhiteSpace(objectName) || keepLabel == null)
        {
            return;
        }

        TextMeshProUGUI[] labels = parent.GetComponentsInChildren<TextMeshProUGUI>(true);
        for (int i = 0; i < labels.Length; i++)
        {
            TextMeshProUGUI candidate = labels[i];
            if (candidate == null || candidate == keepLabel)
            {
                continue;
            }

            if (!string.Equals(candidate.gameObject.name, objectName, StringComparison.Ordinal))
            {
                continue;
            }

            candidate.gameObject.SetActive(false);
        }
    }

    private static string ReadText(TMP_Text target, string fallback)
    {
        if (target == null)
        {
            return fallback ?? string.Empty;
        }

        return string.IsNullOrWhiteSpace(target.text) ? (fallback ?? string.Empty) : target.text;
    }

    private static void DestroyGameObjectImmediate(GameObject target)
    {
        if (target == null)
        {
            return;
        }

        if (Application.isPlaying)
        {
            UnityEngine.Object.Destroy(target);
        }
        else
        {
            UnityEngine.Object.DestroyImmediate(target);
        }
    }

    private static void DestroyComponentImmediate(Component target)
    {
        if (target == null)
        {
            return;
        }

        if (Application.isPlaying)
        {
            UnityEngine.Object.Destroy(target);
        }
        else
        {
            UnityEngine.Object.DestroyImmediate(target);
        }
    }

    private static void SetActiveIfNeeded(GameObject target, bool active)
    {
        if (target != null && target.activeSelf != active)
        {
            target.SetActive(active);
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
        target.sizeDelta = source.sizeDelta;
        target.localRotation = Quaternion.identity;
        target.localScale = Vector3.one;
    }

    private static Vector2 ResolvePreferredCellSize(Transform cellRoot)
    {
        if (cellRoot is RectTransform rect && rect.rect.width > 1f && rect.rect.height > 1f)
        {
            return rect.rect.size;
        }

        GridLayoutGroup grid = FindAncestor<GridLayoutGroup>(cellRoot);
        if (grid != null && grid.cellSize.x > 1f && grid.cellSize.y > 1f)
        {
            return grid.cellSize;
        }

        return new Vector2(96f, 72f);
    }

    private static RectTransform ResolveCardBackgroundRect(Transform cardRoot)
    {
        if (cardRoot == null)
        {
            return null;
        }

        Transform direct = cardRoot.Find(CardBackgroundName);
        if (direct is RectTransform directRect)
        {
            return directRect;
        }

        for (int i = 0; i < cardRoot.childCount; i++)
        {
            Transform child = cardRoot.GetChild(i);
            if (!(child is RectTransform rect))
            {
                continue;
            }

            if (string.Equals(child.name, CardBackgroundName, StringComparison.OrdinalIgnoreCase))
            {
                return rect;
            }
        }

        return null;
    }

    private static T FindAncestor<T>(Transform start) where T : Component
    {
        Transform current = start;
        while (current != null)
        {
            T component = current.GetComponent<T>();
            if (component != null)
            {
                return component;
            }

            current = current.parent;
        }

        return null;
    }

    private static TextMeshProUGUI ResolveOrCreateTextLabel(
        Transform parent,
        string objectName,
        Vector2 preferredSize,
        GameplayTextSurface surface,
        Color preferredColor,
        float fontSizeMin,
        float fontSizeMax)
    {
        if (parent == null)
        {
            return null;
        }

        TextMeshProUGUI label = FindNamedTextLabel(parent, objectName);

        if (label == null)
        {
            GameObject child = new GameObject(objectName, typeof(RectTransform), typeof(TextMeshProUGUI));
            child.layer = parent.gameObject.layer;
            child.transform.SetParent(parent, false);
            label = child.GetComponent<TextMeshProUGUI>();
        }

        if (label == null)
        {
            return null;
        }

        if (!parent.gameObject.activeSelf)
        {
            parent.gameObject.SetActive(true);
        }

        label.gameObject.name = objectName;
        label.gameObject.layer = parent.gameObject.layer;
        if (!label.gameObject.activeSelf)
        {
            label.gameObject.SetActive(true);
        }
        label.enabled = true;
        label.raycastTarget = false;
        label.color = preferredColor;
        label.alpha = 1f;
        label.enableAutoSizing = true;
        label.fontSizeMin = fontSizeMin;
        label.fontSizeMax = Mathf.Max(fontSizeMin, fontSizeMax);
        label.overflowMode = TextOverflowModes.Overflow;
        label.alignment = TextAlignmentOptions.Center;
        label.textWrappingMode = TextWrappingModes.NoWrap;
        RealtimeTextStyleUtils.ApplyGameplayTextPresentation(
            label,
            surface == GameplayTextSurface.BallNumber ? CandyTypographyRole.Number : CandyTypographyRole.Number,
            surface,
            preserveExistingFont: false);

        RectTransform rect = label.rectTransform;
        rect.localScale = Vector3.one;
        rect.sizeDelta = preferredSize;
        label.transform.SetAsLastSibling();
        return label;
    }

    private static TextMeshProUGUI FindNamedTextLabel(Transform parent, string objectName)
    {
        if (parent == null || string.IsNullOrWhiteSpace(objectName))
        {
            return null;
        }

        Transform namedChild = parent.Find(objectName);
        if (namedChild == null)
        {
            return null;
        }

        return namedChild.GetComponent<TextMeshProUGUI>();
    }

    private static void DeactivateLegacyTextLabels(Transform root, TextMeshProUGUI keepLabel)
    {
        if (root == null)
        {
            return;
        }

        TextMeshProUGUI[] labels = root.GetComponentsInChildren<TextMeshProUGUI>(true);
        if (labels == null || labels.Length == 0)
        {
            return;
        }

        for (int i = 0; i < labels.Length; i++)
        {
            TextMeshProUGUI label = labels[i];
            if (label == null || label == keepLabel)
            {
                continue;
            }

            label.enabled = false;
            label.text = string.Empty;
            if (label.transform != root && label.gameObject.activeSelf)
            {
                label.gameObject.SetActive(false);
            }
        }
    }

    private static void PlaceCardNumberLabel(RectTransform rect, Transform cellRoot)
    {
        if (rect == null || cellRoot == null)
        {
            return;
        }

        rect.SetParent(cellRoot, false);
        rect.anchorMin = new Vector2(0.5f, 0.5f);
        rect.anchorMax = new Vector2(0.5f, 0.5f);
        rect.pivot = new Vector2(0.5f, 0.5f);
        rect.anchoredPosition = Vector2.zero;
        if (cellRoot is RectTransform parentRect)
        {
            float width = parentRect.rect.width > 1f ? parentRect.rect.width : 96f;
            float height = parentRect.rect.height > 1f ? parentRect.rect.height : 72f;
            rect.sizeDelta = new Vector2(width, height);
        }
        else
        {
            rect.sizeDelta = new Vector2(96f, 72f);
        }
    }

    private static void PlaceBallNumberLabel(RectTransform rect, Vector2 preferredSize)
    {
        if (rect == null)
        {
            return;
        }

        rect.anchorMin = new Vector2(0.5f, 0.5f);
        rect.anchorMax = new Vector2(0.5f, 0.5f);
        rect.pivot = new Vector2(0.5f, 0.5f);
        rect.anchoredPosition = Vector2.zero;
        rect.sizeDelta = preferredSize;
    }

    private static void EnsureVisibleTextMirror(TMP_Text source, string mirrorName, Color preferredColor, bool hideWhenBlank)
    {
        if (source == null || source.transform.parent == null || string.IsNullOrWhiteSpace(mirrorName))
        {
            return;
        }

        Transform parent = source.transform.parent;
        Theme1VisibleTextBridge bridge = parent.Find(mirrorName)?.GetComponent<Theme1VisibleTextBridge>();
        if (bridge == null)
        {
            GameObject mirrorObject = new GameObject(mirrorName, typeof(RectTransform), typeof(Text), typeof(Theme1VisibleTextBridge));
            mirrorObject.layer = parent.gameObject.layer;
            mirrorObject.transform.SetParent(parent, false);
            bridge = mirrorObject.GetComponent<Theme1VisibleTextBridge>();
        }

        if (bridge == null)
        {
            return;
        }

        RectTransform sourceRect = source.rectTransform;
        RectTransform mirrorRect = bridge.GetComponent<RectTransform>();
        mirrorRect.anchorMin = sourceRect.anchorMin;
        mirrorRect.anchorMax = sourceRect.anchorMax;
        mirrorRect.pivot = sourceRect.pivot;
        mirrorRect.anchoredPosition = sourceRect.anchoredPosition;
        mirrorRect.sizeDelta = sourceRect.sizeDelta;
        mirrorRect.localScale = Vector3.one;
        mirrorRect.localRotation = Quaternion.identity;
        bridge.Bind(source, hideWhenBlank, preferredColor);
        PositionVisibleTextMirror(parent, bridge.transform, source.transform);
    }

    private static void SyncVisibleTextMirror(TMP_Text source)
    {
        if (source == null || source.transform.parent == null)
        {
            return;
        }

        Theme1VisibleTextBridge[] bridges = source.transform.parent.GetComponentsInChildren<Theme1VisibleTextBridge>(true);
        for (int i = 0; i < bridges.Length; i++)
        {
            if (bridges[i] != null && bridges[i].Source == source)
            {
                bridges[i].SyncNow();
            }
        }
    }

    private static void PositionVisibleTextMirror(Transform parent, Transform mirror, Transform source)
    {
        if (parent == null || mirror == null || source == null)
        {
            return;
        }

        int targetIndex = source.GetSiblingIndex();
        for (int childIndex = 0; childIndex < parent.childCount; childIndex++)
        {
            Transform child = parent.GetChild(childIndex);
            if (child == null)
            {
                continue;
            }

            bool isOverlay =
                string.Equals(child.name, SelectionMarkerName, StringComparison.Ordinal) ||
                string.Equals(child.name, MissingOverlayName, StringComparison.Ordinal) ||
                string.Equals(child.name, MatchedOverlayName, StringComparison.Ordinal);
            if (isOverlay)
            {
                targetIndex = Mathf.Min(targetIndex, childIndex);
                break;
            }
        }

        mirror.SetSiblingIndex(Mathf.Clamp(targetIndex, 0, Mathf.Max(0, parent.childCount - 1)));
    }
}
