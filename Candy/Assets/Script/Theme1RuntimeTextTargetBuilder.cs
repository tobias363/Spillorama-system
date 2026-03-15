using System;
using System.Collections.Generic;
using TMPro;
using UnityEngine;

internal static class Theme1RuntimeTextTargetBuilder
{
    internal enum RuntimeCardLabelKind
    {
        CardIndex,
        Stake,
        Win
    }

    internal static TextMeshProUGUI EnsureDedicatedCardLabel(
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

        RectTransform cardBackground = Theme1CardBoardBuilder.ResolveCardBackgroundRect(cardRoot);
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
        label.maskable = false;
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
                    basePosition.x,
                    basePosition.y - (baseSize.y * 0.435f));
                rect.sizeDelta = new Vector2(Mathf.Max(150f, baseSize.x * 0.3f), 34f);
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

        if (!Application.isPlaying)
        {
            Theme1VisibleTextMirrorFactory.EnsureVisibleTextMirror(
                label,
                objectName + Theme1GameplayViewRepairUtils.VisibleLabelSuffix,
                Color.white,
                hideWhenBlank: labelKind == RuntimeCardLabelKind.Win);
        }
        label.transform.SetAsLastSibling();
        Theme1OverlayLabelFactory.DeactivateNestedDuplicateLabels(cardRoot, objectName, label);
        return label;
    }

    internal static void DeactivateLegacyCardLabelContainers(Transform cardRoot, params TextMeshProUGUI[] keepLabels)
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

    internal static TextMeshProUGUI ResolveOrCreateTextLabel(
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
        label.maskable = false;
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
            CandyTypographyRole.Number,
            surface,
            preserveExistingFont: false);
        if (surface == GameplayTextSurface.CardNumber)
        {
            Theme1BongTypography.ApplyCardNumber(label);
        }

        RectTransform rect = label.rectTransform;
        rect.localScale = Vector3.one;
        rect.sizeDelta = preferredSize;
        label.transform.SetAsLastSibling();
        return label;
    }

    internal static TextMeshProUGUI EnsureDedicatedVisibleCardNumberLabel(RectTransform cellRoot, TextMeshProUGUI sourceLabel)
    {
        if (cellRoot == null)
        {
            return null;
        }

        TextMeshProUGUI label = FindNamedTextLabel(cellRoot, Theme1GameplayViewRepairUtils.CardNumberVisibleLabelName);
        if (label == null)
        {
            GameObject child = new GameObject(
                Theme1GameplayViewRepairUtils.CardNumberVisibleLabelName,
                typeof(RectTransform),
                typeof(TextMeshProUGUI));
            child.layer = cellRoot.gameObject.layer;
            child.transform.SetParent(cellRoot, false);
            label = child.GetComponent<TextMeshProUGUI>();
        }

        if (label == null)
        {
            return null;
        }

        label.gameObject.name = Theme1GameplayViewRepairUtils.CardNumberVisibleLabelName;
        label.gameObject.layer = cellRoot.gameObject.layer;
        if (!label.gameObject.activeSelf)
        {
            label.gameObject.SetActive(true);
        }

        label.enabled = true;
        label.maskable = false;
        label.raycastTarget = false;
        label.alpha = 1f;
        label.enableAutoSizing = true;
        label.fontSizeMin = sourceLabel != null && sourceLabel.fontSizeMin > 0f ? sourceLabel.fontSizeMin : 20f;
        label.fontSizeMax = sourceLabel != null && sourceLabel.fontSizeMax >= label.fontSizeMin ? sourceLabel.fontSizeMax : 72f;
        label.overflowMode = TextOverflowModes.Overflow;
        label.alignment = TextAlignmentOptions.Center;
        label.textWrappingMode = TextWrappingModes.NoWrap;
        label.text = sourceLabel != null ? (sourceLabel.text ?? string.Empty) : string.Empty;
        RealtimeTextStyleUtils.ApplyGameplayTextPresentation(
            label,
            CandyTypographyRole.Number,
            GameplayTextSurface.CardNumber,
            preserveExistingFont: false);
        Theme1BongTypography.ApplyCardNumber(label);

        RectTransform rect = label.rectTransform;
        rect.localScale = Vector3.one;
        rect.localRotation = Quaternion.identity;
        if (sourceLabel != null)
        {
            RectTransform sourceRect = sourceLabel.rectTransform;
            rect.anchorMin = sourceRect.anchorMin;
            rect.anchorMax = sourceRect.anchorMax;
            rect.pivot = sourceRect.pivot;
            rect.anchoredPosition = sourceRect.anchoredPosition;
            rect.sizeDelta = sourceRect.sizeDelta;
        }
        else
        {
            PlaceCardNumberLabel(rect, cellRoot);
        }

        label.transform.SetAsLastSibling();
        return label;
    }

    internal static TextMeshProUGUI FindNamedTextLabel(Transform parent, string objectName)
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

    internal static void DeactivateLegacyTextLabels(Transform root, TextMeshProUGUI keepLabel)
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

    internal static void PlaceCardNumberLabel(RectTransform rect, Transform cellRoot)
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

    internal static void PlaceBallNumberLabel(RectTransform rect, Vector2 preferredSize)
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
}
