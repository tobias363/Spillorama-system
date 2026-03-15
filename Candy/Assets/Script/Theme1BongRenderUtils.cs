using System;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public static class Theme1BongRenderUtils
{
    private const string AdditionalPrizeLabelPrefix = Theme1GameplayViewRepairUtils.CardCellPrizeLabelName + "_";

    public static void ApplyCellVisual(Theme1CardCellView cellView, Theme1CardCellRenderState cellState)
    {
        if (cellView == null)
        {
            return;
        }

        Theme1CardCellVisualState visualState = ResolveVisualState(cellState);
        Theme1CellPrizeLabelRenderState[] visiblePrizeLabels = ResolveVisiblePrizeLabels(cellState, visualState);
        bool showPrize = visiblePrizeLabels.Length > 0;

        ConfigureBackground(cellView.Background, visualState, cellState.IsSelected);
        ConfigureNumberLabel(cellView.PreferredRenderLabel, showPrize);
        ConfigurePrizeLabels(cellView, visiblePrizeLabels);
        ConfigureGlow(cellView.Glow);
        ConfigurePulse(cellView, visualState == Theme1CardCellVisualState.NearTarget);

        TextMeshProUGUI inactiveNumberLabel = cellView.LegacyNumberLabel == cellView.PreferredRenderLabel
            ? cellView.VisibleNumberLabel
            : cellView.LegacyNumberLabel;
        if (inactiveNumberLabel != null)
        {
            inactiveNumberLabel.text = string.Empty;
            inactiveNumberLabel.enabled = false;
            inactiveNumberLabel.alpha = 0f;
            if (inactiveNumberLabel.gameObject.activeSelf)
            {
                inactiveNumberLabel.gameObject.SetActive(false);
            }
        }
    }

    public static void ApplyPaylineVisuals(Theme1CardGridView view, Theme1CardRenderState state)
    {
        if (view?.PaylineObjects == null)
        {
            return;
        }

        bool[] active = new bool[view.PaylineObjects.Length];
        if (state?.CompletedPatterns != null)
        {
            for (int i = 0; i < state.CompletedPatterns.Length; i++)
            {
                Theme1CompletedPatternRenderState pattern = state.CompletedPatterns[i];
                if (pattern != null &&
                    pattern.RawPatternIndex >= 0 &&
                    pattern.RawPatternIndex < active.Length)
                {
                    active[pattern.RawPatternIndex] = true;
                }
            }
        }

        for (int paylineIndex = 0; paylineIndex < view.PaylineObjects.Length; paylineIndex++)
        {
            GameObject payline = view.PaylineObjects[paylineIndex];
            if (payline != null && payline.activeSelf != active[paylineIndex])
            {
                payline.SetActive(active[paylineIndex]);
            }
        }
    }

    public static Theme1CardCellVisualState ResolveVisualState(Theme1CardCellRenderState cellState)
    {
        if (cellState.IsPrizeCell)
        {
            return Theme1CardCellVisualState.WonPrize;
        }

        if (cellState.IsNearTargetCell)
        {
            return Theme1CardCellVisualState.NearTarget;
        }

        if (cellState.VisualState != Theme1CardCellVisualState.Normal)
        {
            return cellState.VisualState;
        }

        if (cellState.IsMatched && HasPrizeLabels(cellState))
        {
            return Theme1CardCellVisualState.WonPrize;
        }

        if (cellState.IsMatched)
        {
            return Theme1CardCellVisualState.WonHit;
        }

        if (cellState.IsMissing)
        {
            return Theme1CardCellVisualState.NearTarget;
        }

        return Theme1CardCellVisualState.Normal;
    }

    private static void ConfigureBackground(Image background, Theme1CardCellVisualState visualState, bool isSelected)
    {
        if (background == null)
        {
            return;
        }

        background.sprite = Theme1RuntimeShapeCatalog.GetSolidSprite();
        background.type = Image.Type.Sliced;
        background.color = Color.white;
        switch (visualState)
        {
            case Theme1CardCellVisualState.NearHit:
            case Theme1CardCellVisualState.WonHit:
                background.sprite = Theme1RuntimeShapeCatalog.GetHighlightCellGradientSprite();
                background.type = Image.Type.Simple;
                background.color = Color.white;
                break;
            case Theme1CardCellVisualState.NearTarget:
            case Theme1CardCellVisualState.WonPrize:
                background.sprite = Theme1RuntimeShapeCatalog.GetPrizeCellGradientSprite();
                background.type = Image.Type.Simple;
                background.color = Color.white;
                break;
            default:
                background.sprite = Theme1RuntimeShapeCatalog.GetSolidSprite();
                background.type = Image.Type.Sliced;
                background.color = isSelected ? Theme1BongStyle.SelectedCellColor : Theme1BongStyle.NormalCellColor;
                break;
        }
    }

    private static void ConfigureNumberLabel(TextMeshProUGUI label, bool showPrize)
    {
        if (label == null)
        {
            return;
        }

        Theme1BongTypography.ApplyCardNumber(label);
        label.color = Theme1BongStyle.NumberColor;
        label.maskable = false;
        label.raycastTarget = false;
        label.alpha = 1f;
        label.enabled = true;
        label.enableAutoSizing = false;
        if (!label.gameObject.activeSelf)
        {
            label.gameObject.SetActive(true);
        }
        RectTransform rect = label.rectTransform;
        rect.anchorMin = new Vector2(0.5f, 0.5f);
        rect.anchorMax = new Vector2(0.5f, 0.5f);
        rect.pivot = new Vector2(0.5f, 0.5f);
        rect.anchoredPosition = showPrize ? new Vector2(0f, 10f) : Vector2.zero;
        RectTransform parentRect = label.transform.parent as RectTransform;
        float referenceSize = parentRect != null
            ? Mathf.Min(parentRect.rect.width, parentRect.rect.height)
            : Mathf.Min(rect.rect.width, rect.rect.height);
        label.fontSize = Mathf.Clamp(referenceSize * 0.58f, 24f, 42f);
        label.transform.SetAsLastSibling();
    }

    private static void ConfigurePrizeLabels(Theme1CardCellView cellView, Theme1CellPrizeLabelRenderState[] prizeLabels)
    {
        if (cellView?.PrizeLabel == null || cellView.CellRoot == null)
        {
            return;
        }

        List<TextMeshProUGUI> labels = CollectPrizeLabels(cellView);
        while (labels.Count < prizeLabels.Length)
        {
            labels.Add(CreateAdditionalPrizeLabel(cellView, labels.Count));
        }

        for (int i = 0; i < labels.Count; i++)
        {
            if (i < prizeLabels.Length && !string.IsNullOrWhiteSpace(prizeLabels[i].Text))
            {
                ConfigurePrizeLabelInstance(labels[i], prizeLabels[i], i);
            }
            else
            {
                HidePrizeLabel(labels[i]);
            }
        }
    }

    private static void ConfigurePrizeLabelInstance(
        TextMeshProUGUI label,
        Theme1CellPrizeLabelRenderState prizeLabel,
        int stackIndex)
    {
        if (label == null)
        {
            return;
        }

        if (!label.gameObject.activeSelf)
        {
            label.gameObject.SetActive(true);
        }

        label.text = prizeLabel.Text ?? string.Empty;
        Theme1BongTypography.ApplyPrizeLabel(label);
        label.color = Theme1BongStyle.PrizeTextColor;
        label.alpha = 1f;
        label.enabled = true;
        label.enableAutoSizing = true;
        label.fontSizeMin = 10f;
        label.fontSizeMax = 22f;
        label.raycastTarget = false;
        label.textWrappingMode = TextWrappingModes.NoWrap;
        label.overflowMode = TextOverflowModes.Overflow;

        RectTransform rect = label.rectTransform;
        rect.anchorMin = rect.anchorMax = prizeLabel.Anchor switch
        {
            Theme1WinLabelAnchor.BottomLeft => new Vector2(0f, 0f),
            Theme1WinLabelAnchor.BottomRight => new Vector2(1f, 0f),
            _ => new Vector2(0.5f, 0f)
        };
        rect.pivot = prizeLabel.Anchor switch
        {
            Theme1WinLabelAnchor.BottomLeft => new Vector2(0f, 0f),
            Theme1WinLabelAnchor.BottomRight => new Vector2(1f, 0f),
            _ => new Vector2(0.5f, 0f)
        };
        rect.sizeDelta = Theme1BongStyle.PrizeLabelSize;
        Vector2 basePosition = prizeLabel.Anchor switch
        {
            Theme1WinLabelAnchor.BottomLeft => Theme1BongStyle.PrizeLabelBottomLeft,
            Theme1WinLabelAnchor.BottomRight => Theme1BongStyle.PrizeLabelBottomRight,
            _ => Theme1BongStyle.PrizeLabelBottomCenter
        };
        rect.anchoredPosition = basePosition + new Vector2(0f, -Theme1BongStyle.PrizeLabelStackOffsetY * stackIndex);
        label.alignment = prizeLabel.Anchor switch
        {
            Theme1WinLabelAnchor.BottomLeft => TextAlignmentOptions.BottomLeft,
            Theme1WinLabelAnchor.BottomRight => TextAlignmentOptions.BottomRight,
            _ => TextAlignmentOptions.Bottom
        };
        label.transform.SetAsLastSibling();
    }

    private static List<TextMeshProUGUI> CollectPrizeLabels(Theme1CardCellView cellView)
    {
        List<TextMeshProUGUI> labels = new List<TextMeshProUGUI> { cellView.PrizeLabel };
        RectTransform cellRoot = cellView.CellRoot;
        if (cellRoot == null)
        {
            return labels;
        }

        List<(int index, TextMeshProUGUI label)> extras = new List<(int index, TextMeshProUGUI label)>();
        for (int i = 0; i < cellRoot.childCount; i++)
        {
            Transform child = cellRoot.GetChild(i);
            if (child == null ||
                !child.name.StartsWith(AdditionalPrizeLabelPrefix, StringComparison.Ordinal))
            {
                continue;
            }

            TextMeshProUGUI extra = child.GetComponent<TextMeshProUGUI>();
            if (extra == null)
            {
                continue;
            }

            extras.Add((ParseAdditionalPrizeLabelIndex(child.name), extra));
        }

        extras.Sort((left, right) => left.index.CompareTo(right.index));
        for (int i = 0; i < extras.Count; i++)
        {
            labels.Add(extras[i].label);
        }

        return labels;
    }

    private static TextMeshProUGUI CreateAdditionalPrizeLabel(Theme1CardCellView cellView, int labelIndex)
    {
        TextMeshProUGUI template = cellView?.PrizeLabel;
        RectTransform cellRoot = cellView?.CellRoot;
        if (template == null || cellRoot == null)
        {
            return null;
        }

        TextMeshProUGUI copy = UnityEngine.Object.Instantiate(template, cellRoot, false);
        copy.name = AdditionalPrizeLabelPrefix + labelIndex;
        copy.gameObject.SetActive(false);
        copy.text = string.Empty;
        copy.alpha = 1f;
        copy.enabled = true;
        copy.transform.SetAsLastSibling();
        return copy;
    }

    private static void HidePrizeLabel(TextMeshProUGUI label)
    {
        if (label == null)
        {
            return;
        }

        if (label.gameObject.activeSelf)
        {
            label.gameObject.SetActive(false);
        }

        label.text = string.Empty;
        label.alpha = 1f;
        label.enabled = true;
    }

    private static Theme1CellPrizeLabelRenderState[] ResolveVisiblePrizeLabels(
        Theme1CardCellRenderState cellState,
        Theme1CardCellVisualState visualState)
    {
        if (visualState != Theme1CardCellVisualState.NearTarget &&
            visualState != Theme1CardCellVisualState.WonPrize)
        {
            return Array.Empty<Theme1CellPrizeLabelRenderState>();
        }

        if (cellState.PrizeLabels != null && cellState.PrizeLabels.Length > 0)
        {
            return cellState.PrizeLabels;
        }

        if (string.IsNullOrWhiteSpace(cellState.PrizeLabel))
        {
            return Array.Empty<Theme1CellPrizeLabelRenderState>();
        }

        return new[]
        {
            new Theme1CellPrizeLabelRenderState(
                cellState.PrizeLabel,
                cellState.PrizeAnchor,
                0,
                cellState.NearWinPatternIndex)
        };
    }

    private static bool HasPrizeLabels(Theme1CardCellRenderState cellState)
    {
        return (cellState.PrizeLabels != null && cellState.PrizeLabels.Length > 0) ||
               !string.IsNullOrWhiteSpace(cellState.PrizeLabel);
    }

    private static int ParseAdditionalPrizeLabelIndex(string name)
    {
        if (string.IsNullOrWhiteSpace(name) ||
            !name.StartsWith(AdditionalPrizeLabelPrefix, StringComparison.Ordinal))
        {
            return int.MaxValue;
        }

        string suffix = name.Substring(AdditionalPrizeLabelPrefix.Length);
        return int.TryParse(suffix, out int parsed) ? parsed : int.MaxValue;
    }

    private static void ConfigureGlow(Image glow)
    {
        if (glow == null)
        {
            return;
        }

        glow.sprite = Theme1RuntimeAssetCatalog.GetOneToGoGlowSprite() ?? Theme1RuntimeShapeCatalog.GetCellGlowSprite();
        glow.type = Image.Type.Simple;
        glow.preserveAspect = true;
        glow.color = Theme1BongStyle.SoftGlowColor;
        glow.enabled = false;
        Theme1RuntimeMaterialCatalog.EnsureCellGlowMaterial(glow);
    }

    private static void ConfigurePulse(Theme1CardCellView cellView, bool pulsing)
    {
        if (cellView == null)
        {
            return;
        }

        Theme1CellPulseController pulseController = cellView.PulseController;
        if (pulseController == null)
        {
            return;
        }

        pulseController.Bind(cellView.PreferredRenderLabel, cellView.PrizeLabel, cellView.Glow);
        pulseController.SetPulsing(pulsing);
    }
}
