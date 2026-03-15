using System;
using TMPro;
using UnityEngine;

internal static class Theme1OverlayLabelFactory
{
    internal static TextMeshProUGUI EnsureDedicatedHudValueTarget(TextMeshProUGUI template, string objectName, string defaultText)
    {
        Transform parent = template != null ? template.transform.parent : null;
        TextMeshProUGUI target = EnsureDedicatedOverlayLabel(
            parent,
            objectName,
            template,
            defaultText,
            GameplayTextSurface.HudLabel,
            Color.white,
            new Vector2(200f, 50f));
        if (target != null)
        {
            DeactivateSiblingTextTargets(parent, target);
        }

        return target ?? template;
    }

    internal static TextMeshProUGUI EnsureDedicatedOverlayLabel(
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

        TextMeshProUGUI label = Theme1RuntimeTextTargetBuilder.FindNamedTextLabel(parent, objectName);
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
        label.maskable = false;
        label.raycastTarget = false;
        label.alpha = 1f;
        string existingText = ReadText(label, string.Empty);
        string templateText = ReadText(template, string.Empty);
        label.text = !string.IsNullOrWhiteSpace(existingText)
            ? existingText
            : (!string.IsNullOrWhiteSpace(templateText) ? templateText : defaultText);
        label.transform.SetAsLastSibling();
        DeactivateNestedDuplicateLabels(parent, objectName, label);
        RealtimeTextStyleUtils.ApplyGameplayTextPresentation(label, CandyTypographyRole.Label, surface);
        if (!Theme1ManagedTypographyRegistry.BelongsToTheme1Presentation(label) &&
            !(label.gameObject.scene.IsValid() && string.Equals(label.gameObject.scene.name, "Theme1", StringComparison.Ordinal)))
        {
            Theme1VisibleTextMirrorFactory.EnsureVisibleTextMirror(label, objectName + Theme1GameplayViewRepairUtils.VisibleLabelSuffix, fallbackColor, hideWhenBlank: false);
        }
        return label;
    }

    internal static void ApplyOverlayLabelDefault(TextMeshProUGUI label, string value)
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
    }

    internal static void DeactivateSiblingTextTargets(Transform parent, TextMeshProUGUI keepLabel)
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

    internal static string ReadText(TMP_Text target, string fallback)
    {
        if (target == null)
        {
            return fallback ?? string.Empty;
        }

        return string.IsNullOrWhiteSpace(target.text) ? (fallback ?? string.Empty) : target.text;
    }

    internal static void CopyRectTransform(RectTransform source, RectTransform target, Vector2 fallbackSize)
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

    internal static void DeactivateNestedDuplicateLabels(Transform parent, string objectName, TextMeshProUGUI keepLabel)
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
}
