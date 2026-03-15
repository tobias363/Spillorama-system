using System;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

internal static class Theme1CardBoardBuilder
{
    internal static RectTransform EnsureDedicatedVisibleGrid(Transform cardRoot)
    {
        if (!(cardRoot is RectTransform cardRect))
        {
            return null;
        }

        RectTransform dedicatedGrid = cardRoot.Find(Theme1GameplayViewRepairUtils.CardNumberLayerName) as RectTransform;
        if (dedicatedGrid == null)
        {
            GameObject gridObject = new GameObject(Theme1GameplayViewRepairUtils.CardNumberLayerName, typeof(RectTransform));
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

    internal static RectTransform ResolveDedicatedCellRoot(RectTransform gridRoot, int cellIndex)
    {
        if (gridRoot == null || cellIndex < 0 || cellIndex >= gridRoot.childCount)
        {
            return null;
        }

        return gridRoot.GetChild(cellIndex) as RectTransform;
    }

    internal static void EnsureDedicatedCardBoard(Transform cardRoot, RectTransform visibleGrid)
    {
        if (!(cardRoot is RectTransform cardRect) || visibleGrid == null)
        {
            return;
        }

        RectTransform cardBackground = ResolveCardBackgroundRect(cardRoot);
        Vector2 baseSize = cardBackground != null && cardBackground.rect.width > 1f && cardBackground.rect.height > 1f
            ? cardBackground.rect.size
            : new Vector2(585f, 325f);
        Vector2 basePosition = cardBackground != null ? cardBackground.anchoredPosition : new Vector2(2f, -5f);

        RectTransform boardRoot = EnsureRectTransformChild(cardRoot, Theme1GameplayViewRepairUtils.CardBoardRootName);
        boardRoot.anchorMin = new Vector2(0.5f, 0.5f);
        boardRoot.anchorMax = new Vector2(0.5f, 0.5f);
        boardRoot.pivot = new Vector2(0.5f, 0.5f);
        boardRoot.sizeDelta = baseSize;
        boardRoot.anchoredPosition = basePosition;
        boardRoot.localScale = Vector3.one;
        boardRoot.localRotation = Quaternion.identity;
        boardRoot.gameObject.SetActive(true);

        Sprite compositeShellSprite = Theme1RuntimeAssetCatalog.GetBongShellSprite();
        bool useCompositeShellSprite = compositeShellSprite != null;

        Image shell = EnsureImageChild(boardRoot, Theme1GameplayViewRepairUtils.CardShellName, useCompositeShellSprite ? compositeShellSprite : Theme1RuntimeShapeCatalog.GetBoardShellGradientSprite());
        ConfigureFullStretch(shell.rectTransform, 0f, 0f, 0f, 0f);
        shell.type = useCompositeShellSprite ? Image.Type.Simple : Image.Type.Sliced;
        shell.color = Color.white;
        SetOutlineState(shell, !useCompositeShellSprite, Theme1BongStyle.ShellOutlineColor, Theme1BongStyle.ShellOutlineDistance);

        Image shellInner = EnsureImageChild(boardRoot, Theme1GameplayViewRepairUtils.CardShellInnerName, Theme1RuntimeShapeCatalog.GetRoundedRectSprite());
        ConfigureFullStretch(shellInner.rectTransform, 12f, 12f, 12f, 12f);
        shellInner.type = Image.Type.Sliced;
        shellInner.color = Theme1BongStyle.ShellInnerColor;
        SetGraphicState(shellInner, !useCompositeShellSprite);
        SetOutlineState(shellInner, !useCompositeShellSprite, Theme1BongStyle.ShellInnerOutlineColor, Theme1BongStyle.ShellInnerOutlineDistance);

        Image shellChromeOuter = EnsureImageChild(boardRoot, Theme1GameplayViewRepairUtils.CardShellChromeOuterName, Theme1RuntimeShapeCatalog.GetRoundedRectSprite());
        ConfigureFullStretch(
            shellChromeOuter.rectTransform,
            ScaleBoardY(baseSize, Theme1BongStyle.ShellChromeOuterInset),
            ScaleBoardX(baseSize, Theme1BongStyle.ShellChromeOuterInset),
            ScaleBoardY(baseSize, Theme1BongStyle.ShellChromeOuterInset),
            ScaleBoardX(baseSize, Theme1BongStyle.ShellChromeOuterInset));
        shellChromeOuter.type = Image.Type.Sliced;
        shellChromeOuter.color = new Color(1f, 1f, 1f, 0f);
        SetGraphicState(shellChromeOuter, !useCompositeShellSprite);
        SetOutlineState(shellChromeOuter, !useCompositeShellSprite, Theme1BongStyle.ShellChromeOuterColor, new Vector2(2f, -2f));

        Image shellChromeInner = EnsureImageChild(boardRoot, Theme1GameplayViewRepairUtils.CardShellChromeInnerName, Theme1RuntimeShapeCatalog.GetRoundedRectSprite());
        ConfigureFullStretch(
            shellChromeInner.rectTransform,
            ScaleBoardY(baseSize, Theme1BongStyle.ShellChromeInnerInset),
            ScaleBoardX(baseSize, Theme1BongStyle.ShellChromeInnerInset),
            ScaleBoardY(baseSize, Theme1BongStyle.ShellChromeInnerInset),
            ScaleBoardX(baseSize, Theme1BongStyle.ShellChromeInnerInset));
        shellChromeInner.type = Image.Type.Sliced;
        shellChromeInner.color = new Color(1f, 1f, 1f, 0f);
        SetGraphicState(shellChromeInner, !useCompositeShellSprite);
        SetOutlineState(shellChromeInner, !useCompositeShellSprite, Theme1BongStyle.ShellChromeInnerColor, new Vector2(1f, -1f));

        Image shellGloss = EnsureImageChild(boardRoot, Theme1GameplayViewRepairUtils.CardShellGlossName, Theme1RuntimeShapeCatalog.GetVerticalFadeSprite());
        RectTransform shellGlossRect = shellGloss.rectTransform;
        shellGlossRect.anchorMin = new Vector2(0f, 1f);
        shellGlossRect.anchorMax = new Vector2(1f, 1f);
        shellGlossRect.pivot = new Vector2(0.5f, 1f);
        shellGlossRect.offsetMin = new Vector2(ScaleBoardX(baseSize, 18f), -ScaleBoardY(baseSize, 132f));
        shellGlossRect.offsetMax = new Vector2(-ScaleBoardX(baseSize, 18f), -ScaleBoardY(baseSize, 18f));
        shellGloss.color = Theme1BongStyle.ShellGlossColor;
        shellGloss.type = Image.Type.Simple;
        SetGraphicState(shellGloss, !useCompositeShellSprite);

        Image topPanel = EnsureImageChild(boardRoot, Theme1GameplayViewRepairUtils.CardTopPanelName, Theme1RuntimeShapeCatalog.GetRoundedRectSprite());
        RectTransform topRect = topPanel.rectTransform;
        topRect.anchorMin = new Vector2(0.5f, 1f);
        topRect.anchorMax = new Vector2(0.5f, 1f);
        topRect.pivot = new Vector2(0.5f, 1f);
        float topHorizontalInset = ScaleBoardX(baseSize, Theme1BongStyle.TopPanelHorizontalInset);
        float topPanelHeight = ScaleBoardY(baseSize, Theme1BongStyle.TopPanelHeight);
        float topPanelOffset = ScaleBoardY(baseSize, Theme1BongStyle.TopPanelTopOffset);
        topRect.sizeDelta = new Vector2(baseSize.x - (topHorizontalInset * 2f), topPanelHeight);
        topRect.anchoredPosition = new Vector2(0f, -topPanelOffset);
        topPanel.type = Image.Type.Sliced;
        topPanel.color = Theme1BongStyle.TopPanelColor;
        SetGraphicState(topPanel, !useCompositeShellSprite);
        SetOutlineState(topPanel, !useCompositeShellSprite, Theme1BongStyle.TopPanelOutlineColor, Theme1BongStyle.TopPanelOutlineDistance);

        Image topPanelGloss = EnsureImageChild(topRect, Theme1GameplayViewRepairUtils.CardTopPanelGlossName, Theme1RuntimeShapeCatalog.GetVerticalFadeSprite());
        ConfigureFullStretch(topPanelGloss.rectTransform, 2f, 2f, 2f, 16f);
        topPanelGloss.type = Image.Type.Simple;
        topPanelGloss.color = Theme1BongStyle.TopPanelGlossColor;
        SetGraphicState(topPanelGloss, !useCompositeShellSprite);

        Image bottomPanel = EnsureImageChild(boardRoot, Theme1GameplayViewRepairUtils.CardBottomPanelName, Theme1RuntimeShapeCatalog.GetFooterGradientSprite());
        RectTransform bottomRect = bottomPanel.rectTransform;
        bottomRect.anchorMin = new Vector2(0.5f, 0f);
        bottomRect.anchorMax = new Vector2(0.5f, 0f);
        bottomRect.pivot = new Vector2(0.5f, 0f);
        float bottomHorizontalInset = ScaleBoardX(baseSize, Theme1BongStyle.BottomPanelHorizontalInset);
        float bottomPanelHeight = ScaleBoardY(baseSize, Theme1BongStyle.BottomPanelHeight);
        float bottomPanelOffset = ScaleBoardY(baseSize, Theme1BongStyle.BottomPanelBottomOffset);
        bottomRect.sizeDelta = new Vector2(baseSize.x - (bottomHorizontalInset * 2f), bottomPanelHeight);
        bottomRect.anchoredPosition = new Vector2(0f, bottomPanelOffset);
        bottomPanel.type = Image.Type.Sliced;
        bottomPanel.color = Color.white;
        SetGraphicState(bottomPanel, !useCompositeShellSprite);
        SetOutlineState(bottomPanel, !useCompositeShellSprite, Theme1BongStyle.BottomPanelOutlineColor, Theme1BongStyle.BottomPanelOutlineDistance);

        Image bottomPanelGloss = EnsureImageChild(bottomRect, Theme1GameplayViewRepairUtils.CardBottomPanelGlossName, Theme1RuntimeShapeCatalog.GetVerticalFadeSprite());
        ConfigureFullStretch(bottomPanelGloss.rectTransform, 2f, 2f, 2f, 18f);
        bottomPanelGloss.type = Image.Type.Simple;
        bottomPanelGloss.color = Theme1BongStyle.BottomPanelGlossColor;
        SetGraphicState(bottomPanelGloss, !useCompositeShellSprite);

        Image bottomTab = EnsureImageChild(boardRoot, Theme1GameplayViewRepairUtils.CardBottomTabName, Theme1RuntimeShapeCatalog.GetRoundedRectSprite());
        RectTransform bottomTabRect = bottomTab.rectTransform;
        bottomTabRect.anchorMin = new Vector2(0.5f, 0f);
        bottomTabRect.anchorMax = new Vector2(0.5f, 0f);
        bottomTabRect.pivot = new Vector2(0.5f, 0f);
        bottomTabRect.sizeDelta = new Vector2(ScaleBoardX(baseSize, Theme1BongStyle.BottomTabWidth), ScaleBoardY(baseSize, Theme1BongStyle.BottomTabHeight));
        bottomTabRect.anchoredPosition = new Vector2(0f, ScaleBoardY(baseSize, Theme1BongStyle.BottomTabBottomOffset));
        bottomTab.type = Image.Type.Sliced;
        bottomTab.color = Theme1BongStyle.BottomTabColor;
        SetGraphicState(bottomTab, !useCompositeShellSprite);
        SetOutlineState(bottomTab, !useCompositeShellSprite, Theme1BongStyle.BottomTabOutlineColor, Theme1BongStyle.BottomTabOutlineDistance);

        RectTransform gridFrame = EnsureRectTransformChild(boardRoot, Theme1GameplayViewRepairUtils.CardGridFrameName);
        Vector2 localGridOffset = visibleGrid.anchoredPosition - boardRoot.anchoredPosition;
        gridFrame.anchorMin = new Vector2(0.5f, 0.5f);
        gridFrame.anchorMax = new Vector2(0.5f, 0.5f);
        gridFrame.pivot = new Vector2(0.5f, 0.5f);
        gridFrame.sizeDelta = visibleGrid.sizeDelta + new Vector2(Theme1BongStyle.GridFramePadding * 2f, Theme1BongStyle.GridFramePadding * 2f);
        gridFrame.anchoredPosition = localGridOffset;
        gridFrame.localScale = Vector3.one;
        gridFrame.localRotation = Quaternion.identity;

        Image gridFrameImage = EnsureImageComponent(gridFrame.gameObject, Theme1RuntimeShapeCatalog.GetRoundedRectSprite());
        gridFrameImage.type = Image.Type.Sliced;
        gridFrameImage.color = Theme1BongStyle.GridFrameColor;
        SetGraphicState(gridFrameImage, !useCompositeShellSprite);
        SetOutlineState(gridFrameImage, !useCompositeShellSprite, Theme1BongStyle.GridFrameOutlineColor, Theme1BongStyle.GridFrameOutlineDistance);

        if (cardBackground != null)
        {
            cardBackground.gameObject.SetActive(false);
        }

        int visibleGridIndex = visibleGrid.GetSiblingIndex();
        boardRoot.SetSiblingIndex(Mathf.Max(0, visibleGridIndex - 1));
        visibleGrid.SetSiblingIndex(Mathf.Min(cardRect.childCount - 1, boardRoot.GetSiblingIndex() + 1));
    }

    internal static RectTransform EnsureDedicatedPatternOverlayRoot(Transform cardRoot, RectTransform visibleGrid)
    {
        if (!(cardRoot is RectTransform))
        {
            return null;
        }

        RectTransform overlayRoot = EnsureRectTransformChild(cardRoot, Theme1GameplayViewRepairUtils.CardPatternOverlayRootName);
        overlayRoot.anchorMin = new Vector2(0.5f, 0.5f);
        overlayRoot.anchorMax = new Vector2(0.5f, 0.5f);
        overlayRoot.pivot = new Vector2(0.5f, 0.5f);
        overlayRoot.sizeDelta = visibleGrid != null ? visibleGrid.sizeDelta : new Vector2(520f, 191f);
        overlayRoot.anchoredPosition = visibleGrid != null ? visibleGrid.anchoredPosition : Vector2.zero;
        overlayRoot.localScale = Vector3.one;
        overlayRoot.localRotation = Quaternion.identity;
        overlayRoot.gameObject.SetActive(true);
        overlayRoot.SetSiblingIndex(Mathf.Min(cardRoot.childCount - 1, visibleGrid != null ? visibleGrid.GetSiblingIndex() + 1 : cardRoot.childCount - 1));
        return overlayRoot;
    }

    internal static void EnsureDedicatedPaylineObjects(CardClass card, RectTransform patternOverlayRoot, IReadOnlyList<Patterns> patternList)
    {
        if (card == null)
        {
            return;
        }

        int patternCount = patternList != null && patternList.Count > 0 ? patternList.Count : 16;
        card.paylineObj ??= new List<GameObject>(patternCount);
        Theme1RuntimeViewCommon.EnsureListCapacity(card.paylineObj, patternCount);
        Theme1RuntimeViewCommon.EnsureListCapacity(card.paylineindex, patternCount);

        for (int patternIndex = 0; patternIndex < patternCount; patternIndex++)
        {
            GameObject paylineObject = card.paylineObj[patternIndex];
            if (paylineObject == null)
            {
                paylineObject = new GameObject(Theme1GameplayViewRepairUtils.CardPaylineObjectPrefix + (patternIndex + 1), typeof(RectTransform));
                card.paylineObj[patternIndex] = paylineObject;
            }

            if (patternOverlayRoot != null && paylineObject.transform.parent != patternOverlayRoot)
            {
                paylineObject.transform.SetParent(patternOverlayRoot, false);
            }

            paylineObject.layer = patternOverlayRoot != null ? patternOverlayRoot.gameObject.layer : paylineObject.layer;
            paylineObject.SetActive(false);
            RectTransform paylineRect = paylineObject.GetComponent<RectTransform>();
            paylineRect.anchorMin = Vector2.zero;
            paylineRect.anchorMax = Vector2.one;
            paylineRect.offsetMin = Vector2.zero;
            paylineRect.offsetMax = Vector2.zero;
            paylineRect.pivot = new Vector2(0.5f, 0.5f);

            if (patternList != null && patternIndex < patternList.Count)
            {
                BuildFallbackPaylineSegments(paylineRect, patternList[patternIndex]?.pattern);
            }

            paylineObject.transform.SetAsLastSibling();
        }

        for (int patternIndex = patternCount; patternIndex < card.paylineObj.Count; patternIndex++)
        {
            GameObject paylineObject = card.paylineObj[patternIndex];
            if (paylineObject != null)
            {
                paylineObject.SetActive(false);
            }
        }
    }

    internal static void EnsureDedicatedCellVisuals(RectTransform cellRoot, TextMeshProUGUI label)
    {
        if (cellRoot == null)
        {
            return;
        }

        Theme1CellPulseController pulseController = cellRoot.GetComponent<Theme1CellPulseController>();
        if (pulseController == null)
        {
            pulseController = cellRoot.gameObject.AddComponent<Theme1CellPulseController>();
        }

        Image glow = EnsureImageChild(cellRoot, Theme1GameplayViewRepairUtils.CardCellGlowName, Theme1RuntimeAssetCatalog.GetOneToGoGlowSprite() ?? Theme1RuntimeShapeCatalog.GetCellGlowSprite());
        RectTransform glowRect = glow.rectTransform;
        glowRect.anchorMin = new Vector2(0.5f, 0.5f);
        glowRect.anchorMax = new Vector2(0.5f, 0.5f);
        glowRect.pivot = new Vector2(0.5f, 0.5f);
        glowRect.sizeDelta = cellRoot.sizeDelta + new Vector2(Theme1BongStyle.CellGlowWidthPadding, Theme1BongStyle.CellGlowHeightPadding);
        glowRect.anchoredPosition = Vector2.zero;
        glow.preserveAspect = true;
        glow.color = new Color(Theme1BongStyle.SoftGlowColor.r / 255f, Theme1BongStyle.SoftGlowColor.g / 255f, Theme1BongStyle.SoftGlowColor.b / 255f, 0f);
        glow.raycastTarget = false;
        glow.enabled = false;
        Theme1RuntimeMaterialCatalog.EnsureCellGlowMaterial(glow);

        Image background = EnsureImageChild(cellRoot, Theme1GameplayViewRepairUtils.CardCellBackgroundName, Theme1RuntimeShapeCatalog.GetSolidSprite());
        ConfigureFullStretch(background.rectTransform, 1f, 1f, 1f, 1f);
        background.type = Image.Type.Sliced;
        background.color = Theme1BongStyle.NormalCellColor;
        ApplyOutline(background, Theme1BongStyle.CellBorderColor, Theme1BongStyle.CellOutlineDistance);

        if (label != null)
        {
            Theme1BongTypography.ApplyCardNumber(label);
            label.transform.SetAsLastSibling();
        }

        TextMeshProUGUI prizeLabel = Theme1RuntimeTextTargetBuilder.FindNamedTextLabel(cellRoot, Theme1GameplayViewRepairUtils.CardCellPrizeLabelName);
        if (prizeLabel == null)
        {
            GameObject prizeObject = new GameObject(Theme1GameplayViewRepairUtils.CardCellPrizeLabelName, typeof(RectTransform), typeof(TextMeshProUGUI));
            prizeObject.layer = cellRoot.gameObject.layer;
            prizeObject.transform.SetParent(cellRoot, false);
            prizeLabel = prizeObject.GetComponent<TextMeshProUGUI>();
        }

        if (prizeLabel != null)
        {
            prizeLabel.gameObject.SetActive(false);
            prizeLabel.raycastTarget = false;
            prizeLabel.maskable = false;
            prizeLabel.color = Theme1BongStyle.PrizeTextColor;
            prizeLabel.alpha = 1f;
            prizeLabel.enableAutoSizing = true;
            prizeLabel.fontSizeMin = 8f;
            prizeLabel.fontSizeMax = 18f;
            prizeLabel.textWrappingMode = TextWrappingModes.NoWrap;
            prizeLabel.overflowMode = TextOverflowModes.Overflow;
            prizeLabel.alignment = TextAlignmentOptions.Bottom;
            RealtimeTextStyleUtils.ApplyGameplayTextPresentation(prizeLabel, CandyTypographyRole.Label, GameplayTextSurface.HudLabel);
            Theme1BongTypography.ApplyPrizeLabel(prizeLabel);
            RectTransform prizeRect = prizeLabel.rectTransform;
            prizeRect.anchorMin = new Vector2(0.5f, 0f);
            prizeRect.anchorMax = new Vector2(0.5f, 0f);
            prizeRect.pivot = new Vector2(0.5f, 0f);
            prizeRect.sizeDelta = Theme1BongStyle.PrizeLabelSize;
            prizeRect.anchoredPosition = Theme1BongStyle.PrizeLabelBottomCenter;
            Theme1VisibleTextMirrorFactory.EnsureVisibleTextMirror(
                prizeLabel,
                Theme1GameplayViewRepairUtils.CardCellPrizeLabelName + Theme1GameplayViewRepairUtils.VisibleLabelSuffix,
                Theme1BongStyle.PrizeTextColor,
                hideWhenBlank: true);
        }

        background.transform.SetSiblingIndex(0);
        glow.transform.SetSiblingIndex(1);
        if (label != null)
        {
            label.transform.SetAsLastSibling();
        }

        pulseController.Bind(label, prizeLabel, glow);
    }

    internal static GameObject EnsureCardCellStateToken(RectTransform cellRoot, string objectName)
    {
        if (cellRoot == null || string.IsNullOrWhiteSpace(objectName))
        {
            return null;
        }

        Transform existingChild = cellRoot.Find(objectName);
        GameObject token = existingChild != null
            ? existingChild.gameObject
            : new GameObject(objectName, typeof(RectTransform));
        if (token.transform.parent != cellRoot)
        {
            token.transform.SetParent(cellRoot, false);
        }

        token.name = objectName;
        token.layer = cellRoot.gameObject.layer;
        RectTransform rect = token.GetComponent<RectTransform>();
        rect.anchorMin = new Vector2(0.5f, 0.5f);
        rect.anchorMax = new Vector2(0.5f, 0.5f);
        rect.pivot = new Vector2(0.5f, 0.5f);
        rect.sizeDelta = Vector2.zero;
        rect.anchoredPosition = Vector2.zero;
        token.SetActive(false);
        return token;
    }

    internal static void PromoteCardNumberLayer(RectTransform visibleGrid)
    {
        if (visibleGrid == null)
        {
            return;
        }

        visibleGrid.gameObject.SetActive(true);
    }

    internal static Vector2 ResolvePreferredCellSize(Transform cellRoot)
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

    internal static RectTransform ResolveCardBackgroundRect(Transform cardRoot)
    {
        if (cardRoot == null)
        {
            return null;
        }

        Transform direct = cardRoot.Find(Theme1GameplayViewRepairUtils.CardBackgroundName);
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

            if (string.Equals(child.name, Theme1GameplayViewRepairUtils.CardBackgroundName, StringComparison.OrdinalIgnoreCase))
            {
                return rect;
            }
        }

        return FindAncestor<RectTransform>(cardRoot);
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
        float leftInset = ScaleBoardX(baseSize, Theme1BongStyle.GridLeftInset);
        float rightInset = ScaleBoardX(baseSize, Theme1BongStyle.GridRightInset);
        float topInset = ScaleBoardY(baseSize, Theme1BongStyle.GridTopInset);
        float bottomInset = ScaleBoardY(baseSize, Theme1BongStyle.GridBottomInset);
        float width = Mathf.Max(120f, baseSize.x - leftInset - rightInset);
        float height = Mathf.Max(90f, baseSize.y - topInset - bottomInset);
        gridRoot.sizeDelta = new Vector2(width, height);
        gridRoot.anchoredPosition = new Vector2(
            basePosition.x + ((leftInset - rightInset) * 0.5f),
            basePosition.y + ((bottomInset - topInset) * 0.5f));

        GridLayoutGroup legacyGrid = gridRoot.GetComponent<GridLayoutGroup>();
        if (legacyGrid != null)
        {
            DestroyComponentImmediate(legacyGrid);
        }

        Image gridImage = EnsureImageComponent(gridRoot.gameObject, Theme1RuntimeShapeCatalog.GetRoundedRectSprite());
        gridImage.type = Image.Type.Sliced;
        gridImage.color = Theme1BongStyle.GridFrameColor;
        ApplyOutline(gridImage, Theme1BongStyle.GridFrameOutlineColor, Theme1BongStyle.GridFrameOutlineDistance);
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
        float rawCellWidth = gridSize.x / Theme1GameplayViewRepairUtils.VisibleCardColumns;
        float rawCellHeight = gridSize.y / Theme1GameplayViewRepairUtils.VisibleCardRows;
        float cellWidth = Mathf.Max(8f, rawCellWidth - Theme1BongStyle.GridGap);
        float cellHeight = Mathf.Max(8f, rawCellHeight - Theme1BongStyle.GridGap);

        for (int cellIndex = 0; cellIndex < Theme1GameplayViewRepairUtils.TotalCardCellCount; cellIndex++)
        {
            RectTransform cellRoot = cellIndex < gridRoot.childCount
                ? gridRoot.GetChild(cellIndex) as RectTransform
                : null;
            if (cellRoot == null)
            {
                GameObject cellObject = new GameObject(Theme1GameplayViewRepairUtils.CardNumberHostPrefix + (cellIndex + 1).ToString("00"), typeof(RectTransform));
                cellObject.layer = gridRoot.gameObject.layer;
                cellObject.transform.SetParent(gridRoot, false);
                cellRoot = cellObject.GetComponent<RectTransform>();
            }

            if (cellRoot == null)
            {
                continue;
            }

            cellRoot.gameObject.name = Theme1GameplayViewRepairUtils.CardNumberHostPrefix + (cellIndex + 1).ToString("00");
            cellRoot.gameObject.layer = gridRoot.gameObject.layer;
            ConfigureDedicatedCellRoot(cellRoot, cellIndex, cellWidth, cellHeight, rawCellWidth, rawCellHeight, gridSize);
        }

        for (int childIndex = Theme1GameplayViewRepairUtils.TotalCardCellCount; childIndex < gridRoot.childCount; childIndex++)
        {
            Transform extraChild = gridRoot.GetChild(childIndex);
            if (extraChild != null)
            {
                extraChild.gameObject.SetActive(false);
            }
        }
    }

    private static void ConfigureDedicatedCellRoot(
        RectTransform cellRoot,
        int cellIndex,
        float cellWidth,
        float cellHeight,
        float rawCellWidth,
        float rawCellHeight,
        Vector2 gridSize)
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

        if (cellIndex < Theme1GameplayViewRepairUtils.VisibleCardCellCount)
        {
            int column = cellIndex / Theme1GameplayViewRepairUtils.VisibleCardRows;
            int row = cellIndex % Theme1GameplayViewRepairUtils.VisibleCardRows;
            float x = (-gridSize.x * 0.5f) + (column * rawCellWidth) + (rawCellWidth * 0.5f);
            float y = (gridSize.y * 0.5f) - (row * rawCellHeight) - (rawCellHeight * 0.5f);
            cellRoot.anchoredPosition = new Vector2(x, y);
            cellRoot.sizeDelta = new Vector2(cellWidth, cellHeight);
            cellRoot.gameObject.SetActive(true);
        }
        else
        {
            float overflowY = (-gridSize.y * 0.5f) - cellHeight - ((cellIndex - Theme1GameplayViewRepairUtils.VisibleCardCellCount) * (cellHeight + 8f));
            cellRoot.anchoredPosition = new Vector2(0f, overflowY);
            cellRoot.sizeDelta = new Vector2(cellWidth, cellHeight);
            cellRoot.gameObject.SetActive(false);
        }
    }

    private static void BuildFallbackPaylineSegments(RectTransform paylineRoot, IReadOnlyList<byte> patternMask)
    {
        if (paylineRoot == null)
        {
            return;
        }

        List<int> cells = ExtractPatternCells(patternMask);
        if (cells.Count == 0)
        {
            return;
        }

        List<Vector2> points = BuildFallbackOverlayPoints(cells, paylineRoot.rect.size);
        int requiredSegments = Mathf.Max(0, points.Count - 1);
        for (int segmentIndex = 0; segmentIndex < requiredSegments; segmentIndex++)
        {
            RectTransform segment = EnsureRectTransformChild(paylineRoot, "Segment_" + segmentIndex);
            Image image = EnsureImageComponent(segment.gameObject, Theme1RuntimeShapeCatalog.GetRoundedRectSprite());
            image.type = Image.Type.Sliced;
            image.color = Theme1BongStyle.PaylineColor;
            ConfigureSegment(segment, points[segmentIndex], points[segmentIndex + 1], Theme1BongStyle.PaylineThickness);
            segment.gameObject.SetActive(true);
        }

        for (int extraIndex = requiredSegments; extraIndex < paylineRoot.childCount; extraIndex++)
        {
            Transform extra = paylineRoot.GetChild(extraIndex);
            if (extra != null)
            {
                extra.gameObject.SetActive(false);
            }
        }
    }

    private static List<int> ExtractPatternCells(IReadOnlyList<byte> patternMask)
    {
        List<int> cells = new List<int>();
        if (patternMask == null)
        {
            return cells;
        }

        for (int i = 0; i < patternMask.Count; i++)
        {
            if (patternMask[i] == 1)
            {
                cells.Add(i);
            }
        }

        return cells;
    }

    private static List<Vector2> BuildFallbackOverlayPoints(IReadOnlyList<int> cells, Vector2 size)
    {
        List<Vector2> points = new List<Vector2>();
        if (cells == null || cells.Count == 0)
        {
            return points;
        }

        if (TryBuildSingleRowPoints(cells, size, points) ||
            TryBuildSingleColumnPoints(cells, size, points))
        {
            return points;
        }

        List<int> sortedCells = new List<int>(cells);
        sortedCells.Sort((left, right) =>
        {
            int leftRow = left % Theme1GameplayViewRepairUtils.VisibleCardRows;
            int rightRow = right % Theme1GameplayViewRepairUtils.VisibleCardRows;
            if (leftRow != rightRow)
            {
                return leftRow.CompareTo(rightRow);
            }

            int leftColumn = left / Theme1GameplayViewRepairUtils.VisibleCardRows;
            int rightColumn = right / Theme1GameplayViewRepairUtils.VisibleCardRows;
            return leftColumn.CompareTo(rightColumn);
        });

        for (int i = 0; i < sortedCells.Count; i++)
        {
            points.Add(GetCellCenter(sortedCells[i], size));
        }

        return points;
    }

    private static bool TryBuildSingleRowPoints(IReadOnlyList<int> cells, Vector2 size, List<Vector2> points)
    {
        int row = cells[0] % Theme1GameplayViewRepairUtils.VisibleCardRows;
        int minColumn = int.MaxValue;
        int maxColumn = int.MinValue;
        for (int i = 0; i < cells.Count; i++)
        {
            if (cells[i] % Theme1GameplayViewRepairUtils.VisibleCardRows != row)
            {
                return false;
            }

            int column = cells[i] / Theme1GameplayViewRepairUtils.VisibleCardRows;
            minColumn = Mathf.Min(minColumn, column);
            maxColumn = Mathf.Max(maxColumn, column);
        }

        if (maxColumn < minColumn)
        {
            return false;
        }

        points.Add(GetCellCenter((minColumn * Theme1GameplayViewRepairUtils.VisibleCardRows) + row, size));
        points.Add(GetCellCenter((maxColumn * Theme1GameplayViewRepairUtils.VisibleCardRows) + row, size));
        return true;
    }

    private static bool TryBuildSingleColumnPoints(IReadOnlyList<int> cells, Vector2 size, List<Vector2> points)
    {
        int column = cells[0] / Theme1GameplayViewRepairUtils.VisibleCardRows;
        int minRow = int.MaxValue;
        int maxRow = int.MinValue;
        for (int i = 0; i < cells.Count; i++)
        {
            if (cells[i] / Theme1GameplayViewRepairUtils.VisibleCardRows != column)
            {
                return false;
            }

            int row = cells[i] % Theme1GameplayViewRepairUtils.VisibleCardRows;
            minRow = Mathf.Min(minRow, row);
            maxRow = Mathf.Max(maxRow, row);
        }

        if (maxRow < minRow)
        {
            return false;
        }

        points.Add(GetCellCenter((column * Theme1GameplayViewRepairUtils.VisibleCardRows) + minRow, size));
        points.Add(GetCellCenter((column * Theme1GameplayViewRepairUtils.VisibleCardRows) + maxRow, size));
        return true;
    }

    private static Vector2 GetCellCenter(int cellIndex, Vector2 size)
    {
        float cellWidth = size.x / Theme1GameplayViewRepairUtils.VisibleCardColumns;
        float cellHeight = size.y / Theme1GameplayViewRepairUtils.VisibleCardRows;
        int column = cellIndex / Theme1GameplayViewRepairUtils.VisibleCardRows;
        int row = cellIndex % Theme1GameplayViewRepairUtils.VisibleCardRows;
        float x = (-size.x * 0.5f) + (column * cellWidth) + (cellWidth * 0.5f);
        float y = (size.y * 0.5f) - (row * cellHeight) - (cellHeight * 0.5f);
        return new Vector2(x, y);
    }

    private static void ConfigureSegment(RectTransform rect, Vector2 start, Vector2 end, float thickness)
    {
        Vector2 delta = end - start;
        float length = delta.magnitude;
        rect.anchorMin = new Vector2(0.5f, 0.5f);
        rect.anchorMax = new Vector2(0.5f, 0.5f);
        rect.pivot = new Vector2(0.5f, 0.5f);
        rect.sizeDelta = new Vector2(length, thickness);
        rect.anchoredPosition = start + (delta * 0.5f);
        rect.localRotation = Quaternion.Euler(0f, 0f, Mathf.Atan2(delta.y, delta.x) * Mathf.Rad2Deg);
        rect.localScale = Vector3.one;
    }

    private static RectTransform EnsureRectTransformChild(Transform parent, string objectName)
    {
        if (parent == null || string.IsNullOrWhiteSpace(objectName))
        {
            return null;
        }

        Transform existing = parent.Find(objectName);
        GameObject child = existing != null
            ? existing.gameObject
            : new GameObject(objectName, typeof(RectTransform));
        if (child.transform.parent != parent)
        {
            child.transform.SetParent(parent, false);
        }

        child.name = objectName;
        child.layer = parent.gameObject.layer;
        return child.GetComponent<RectTransform>();
    }

    private static Image EnsureImageChild(Transform parent, string objectName, Sprite sprite)
    {
        RectTransform rect = EnsureRectTransformChild(parent, objectName);
        if (rect == null)
        {
            return null;
        }

        Image image = EnsureImageComponent(rect.gameObject, sprite);
        image.raycastTarget = false;
        image.enabled = true;
        return image;
    }

    private static Image EnsureImageComponent(GameObject target, Sprite sprite)
    {
        if (target == null)
        {
            return null;
        }

        Image image = target.GetComponent<Image>();
        if (image == null)
        {
            image = target.AddComponent<Image>();
        }

        image.sprite = sprite;
        image.type = Image.Type.Sliced;
        image.raycastTarget = false;
        image.enabled = true;
        return image;
    }

    private static void ConfigureFullStretch(RectTransform rect, float left, float right, float top, float bottom)
    {
        if (rect == null)
        {
            return;
        }

        rect.anchorMin = Vector2.zero;
        rect.anchorMax = Vector2.one;
        rect.pivot = new Vector2(0.5f, 0.5f);
        rect.offsetMin = new Vector2(left, bottom);
        rect.offsetMax = new Vector2(-right, -top);
        rect.localScale = Vector3.one;
        rect.localRotation = Quaternion.identity;
    }

    private static void ApplyOutline(Graphic target, Color effectColor, Vector2 effectDistance)
    {
        if (target == null)
        {
            return;
        }

        Outline outline = target.GetComponent<Outline>();
        if (outline == null)
        {
            outline = target.gameObject.AddComponent<Outline>();
        }

        outline.effectColor = effectColor;
        outline.effectDistance = effectDistance;
        outline.useGraphicAlpha = false;
    }

    private static void SetOutlineState(Graphic target, bool enabled, Color effectColor, Vector2 effectDistance)
    {
        if (target == null)
        {
            return;
        }

        ApplyOutline(target, effectColor, effectDistance);
        Outline outline = target.GetComponent<Outline>();
        if (outline != null)
        {
            outline.enabled = enabled;
        }
    }

    private static void SetGraphicState(Graphic target, bool enabled)
    {
        if (target == null)
        {
            return;
        }

        target.enabled = enabled;
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
                 string.Equals(child.name, Theme1GameplayViewRepairUtils.CardNumberLayerName, StringComparison.OrdinalIgnoreCase));
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
            if (isLegacyOverlay || isLegacyVisibleGrid || isLegacyCardLabel)
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
            if (candidate == null || !string.Equals(candidate.gameObject.name, Theme1GameplayViewRepairUtils.CardNumberLabelName, StringComparison.Ordinal))
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

    private static float ScaleBoardX(Vector2 baseSize, float designPixels)
    {
        return baseSize.x * (designPixels / Theme1BongStyle.ReferenceBoardWidth);
    }

    private static float ScaleBoardY(Vector2 baseSize, float designPixels)
    {
        return baseSize.y * (designPixels / Theme1BongStyle.ReferenceBoardHeight);
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
}
