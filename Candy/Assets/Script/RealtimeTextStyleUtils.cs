using System;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public static class RealtimeTextStyleUtils
{
    private static readonly Color DefaultCardNumberColor = new Color32(184, 51, 99, 255);
    private static readonly Color DefaultBallNumberColor = Color.white;
    private static readonly Color DefaultHudTextColor = Color.white;

    public static TMP_FontAsset ResolveFallbackFont()
    {
        GameManager gm = GameManager.instance;
        NumberGenerator generator = gm != null ? gm.numberGenerator : UnityEngine.Object.FindObjectOfType<NumberGenerator>();
        if (generator != null && generator.cardClasses != null)
        {
            for (int cardIndex = 0; cardIndex < generator.cardClasses.Length; cardIndex++)
            {
                CardClass card = generator.cardClasses[cardIndex];
                if (card?.num_text == null)
                {
                    continue;
                }

                for (int textIndex = 0; textIndex < card.num_text.Count; textIndex++)
                {
                    TextMeshProUGUI label = card.num_text[textIndex];
                    if (label != null && label.font != null)
                    {
                        return label.font;
                    }
                }
            }
        }

        if (gm != null)
        {
            if (gm.displayCurrentBets != null && gm.displayCurrentBets.font != null)
            {
                return gm.displayCurrentBets.font;
            }

            if (gm.displayTotalMoney != null && gm.displayTotalMoney.font != null)
            {
                return gm.displayTotalMoney.font;
            }

            if (gm.winAmtText != null && gm.winAmtText.font != null)
            {
                return gm.winAmtText.font;
            }
        }

        if (generator != null)
        {
            if (generator.autoSpinRemainingPlayText != null && generator.autoSpinRemainingPlayText.font != null)
            {
                return generator.autoSpinRemainingPlayText.font;
            }

            if (generator.extraBallCountText != null && generator.extraBallCountText.font != null)
            {
                return generator.extraBallCountText.font;
            }
        }

        return TMP_Settings.defaultFontAsset;
    }

    public static TMP_FontAsset ResolvePreferredGameFont()
    {
        return ResolveFallbackFont();
    }

    public static TMP_FontAsset ResolveStableFallbackFont()
    {
        return TMP_Settings.defaultFontAsset != null
            ? TMP_Settings.defaultFontAsset
            : ResolveFallbackFont();
    }

    public static void ApplyCardNumber(TextMeshProUGUI target, string value, TMP_FontAsset fallbackFont = null)
    {
        Apply(target, value, DefaultCardNumberColor, fallbackFont, forceStableFallback: true);
    }

    public static void ApplyBallNumber(TextMeshProUGUI target, string value, TMP_FontAsset fallbackFont = null)
    {
        Apply(target, value, DefaultBallNumberColor, fallbackFont, forceStableFallback: true);
    }

    public static void ApplyHudText(
        TextMeshProUGUI target,
        string value,
        TMP_FontAsset fallbackFont = null,
        Color? preferredColor = null)
    {
        Color color = preferredColor ?? DefaultHudTextColor;
        if (Mathf.Approximately(color.a, 0f))
        {
            color.a = 1f;
        }

        Apply(target, value, color, fallbackFont, forceStableFallback: true);
    }

    public static void ApplyReadableTypography(
        TextMeshProUGUI target,
        TMP_FontAsset preferredFont = null,
        float minFontSize = 18f,
        float maxFontSize = 56f)
    {
        if (target == null)
        {
            return;
        }

        TMP_FontAsset resolvedFont = preferredFont != null ? preferredFont : ResolveFallbackFont();
        if (target.font == null && resolvedFont != null)
        {
            target.font = resolvedFont;
            if (resolvedFont.material != null)
            {
                target.fontSharedMaterial = resolvedFont.material;
            }
        }

        if (target.font == null)
        {
            target.enableWordWrapping = false;
            target.enableAutoSizing = true;
            target.fontSizeMin = Mathf.Clamp(minFontSize, 10f, 72f);
            target.fontSizeMax = Mathf.Clamp(maxFontSize, target.fontSizeMin, 96f);
            target.overflowMode = TextOverflowModes.Overflow;
        }
    }

    private static void Apply(
        TextMeshProUGUI target,
        string value,
        Color preferredColor,
        TMP_FontAsset fallbackFont,
        bool forceStableFallback)
    {
        if (target == null)
        {
            return;
        }

        EnsureReasonableRect(target);
        target.enabled = true;
        if (!target.gameObject.activeSelf)
        {
            target.gameObject.SetActive(true);
        }

        TMP_FontAsset resolvedFallback = forceStableFallback
            ? ResolveStableFallbackFont()
            : (fallbackFont != null ? fallbackFont : ResolveFallbackFont());

        if (resolvedFallback != null)
        {
            if (target.font != resolvedFallback)
            {
                target.font = resolvedFallback;
            }

            if (resolvedFallback.material != null && target.fontSharedMaterial != resolvedFallback.material)
            {
                target.fontSharedMaterial = resolvedFallback.material;
            }
        }
        else if (target.font != null && target.font.material != null)
        {
            target.fontSharedMaterial = target.font.material;
        }

        Color color = preferredColor;
        color.a = 1f;
        target.color = color;

        target.alpha = 1f;
        target.text = value;
        target.havePropertiesChanged = true;
        target.SetVerticesDirty();
        target.SetMaterialDirty();
        target.SetLayoutDirty();
        ForceRefresh(target, forceTextReparsing: true);

        if (ShouldForceStableFallback(target, value))
        {
            TMP_FontAsset stableFallback = ResolveStableFallbackFont();
            if (stableFallback != null && target.font != stableFallback)
            {
                target.font = stableFallback;
                if (stableFallback.material != null)
                {
                    target.fontSharedMaterial = stableFallback.material;
                }

                ForceRefresh(target, forceTextReparsing: true);
            }
        }
    }

    public static string BuildHealthSummary(TextMeshProUGUI target)
    {
        if (target == null)
        {
            return "target=null";
        }

        string fontName = target.font != null ? target.font.name : "null";
        string materialName = target.fontSharedMaterial != null ? target.fontSharedMaterial.name : "null";
        string rectSize = target.rectTransform != null
            ? $"{target.rectTransform.rect.width:0.#}x{target.rectTransform.rect.height:0.#}"
            : "no-rect";
        string value = target.text ?? string.Empty;
        if (value.Length > 24)
        {
            value = value.Substring(0, 24) + "...";
        }

        int characterCount = 0;
        try
        {
            target.ForceMeshUpdate(ignoreActiveState: true, forceTextReparsing: false);
            characterCount = target.textInfo != null ? target.textInfo.characterCount : 0;
        }
        catch
        {
            characterCount = -1;
        }

        return
            $"name={target.gameObject.name} active={target.gameObject.activeInHierarchy} enabled={target.enabled} " +
            $"alpha={target.alpha:0.##} color={target.color.r:0.##}/{target.color.g:0.##}/{target.color.b:0.##}/{target.color.a:0.##} " +
            $"font={fontName} material={materialName} rect={rectSize} autosize={target.enableAutoSizing} " +
            $"chars={characterCount} text='{value}'";
    }

    private static void ForceRefresh(TextMeshProUGUI target, bool forceTextReparsing)
    {
        if (target == null)
        {
            return;
        }

        target.ForceMeshUpdate(ignoreActiveState: true, forceTextReparsing: forceTextReparsing);
        if (target.rectTransform != null)
        {
            LayoutRebuilder.ForceRebuildLayoutImmediate(target.rectTransform);
        }

        Canvas.ForceUpdateCanvases();
        target.ForceMeshUpdate(ignoreActiveState: true, forceTextReparsing: false);
    }

    private static bool ShouldForceStableFallback(TextMeshProUGUI target, string value)
    {
        if (target == null || string.IsNullOrWhiteSpace(value))
        {
            return false;
        }

        if (target.textInfo == null || target.textInfo.characterCount > 0)
        {
            return false;
        }

        return true;
    }

    private static void EnsureReasonableRect(TextMeshProUGUI target)
    {
        if (target == null || target.rectTransform == null)
        {
            return;
        }

        RectTransform rect = target.rectTransform;
        Rect currentRect = rect.rect;
        if (currentRect.width > 1f && currentRect.height > 1f)
        {
            return;
        }

        Vector2 preferredSize = Vector2.zero;
        if (rect.parent != null)
        {
            GridLayoutGroup grid = rect.parent.GetComponent<GridLayoutGroup>();
            if (grid != null)
            {
                preferredSize = grid.cellSize;
            }

            if (preferredSize.x <= 1f || preferredSize.y <= 1f)
            {
                RectTransform parentRect = rect.parent as RectTransform;
                if (parentRect != null && parentRect.rect.width > 1f && parentRect.rect.height > 1f)
                {
                    preferredSize = parentRect.rect.size;
                }
            }
        }

        if (preferredSize.x <= 1f)
        {
            preferredSize.x = 36f;
        }

        if (preferredSize.y <= 1f)
        {
            preferredSize.y = 24f;
        }

        rect.sizeDelta = preferredSize;
        rect.localScale = Vector3.one;
    }
}
