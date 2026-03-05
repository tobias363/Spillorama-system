using System;
using TMPro;
using UnityEngine;

public static class RealtimeTextStyleUtils
{
    private static readonly Color DefaultCardNumberColor = new Color32(184, 51, 99, 255);
    private static readonly Color DefaultBallNumberColor = Color.black;
    private const string PreferredFontKeyword = "Fredoka";
    private static TMP_FontAsset cachedPreferredFontAsset;

    public static TMP_FontAsset ResolveFallbackFont()
    {
        TMP_FontAsset preferred = ResolvePreferredGameFont();
        if (preferred != null)
        {
            return preferred;
        }

        GameManager gm = GameManager.instance;
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

        NumberGenerator generator = gm != null ? gm.numberGenerator : UnityEngine.Object.FindObjectOfType<NumberGenerator>();
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
        if (cachedPreferredFontAsset != null)
        {
            return cachedPreferredFontAsset;
        }

        TMP_FontAsset[] loadedFonts = Resources.FindObjectsOfTypeAll<TMP_FontAsset>();
        if (loadedFonts == null || loadedFonts.Length == 0)
        {
            return null;
        }

        for (int i = 0; i < loadedFonts.Length; i++)
        {
            TMP_FontAsset candidate = loadedFonts[i];
            if (candidate == null || string.IsNullOrWhiteSpace(candidate.name))
            {
                continue;
            }

            if (candidate.name.IndexOf(PreferredFontKeyword, StringComparison.OrdinalIgnoreCase) >= 0)
            {
                cachedPreferredFontAsset = candidate;
                return candidate;
            }
        }

        return null;
    }

    public static void ApplyCardNumber(TextMeshProUGUI target, string value, TMP_FontAsset fallbackFont = null)
    {
        Apply(target, value, DefaultCardNumberColor, fallbackFont);
    }

    public static void ApplyBallNumber(TextMeshProUGUI target, string value, TMP_FontAsset fallbackFont = null)
    {
        Apply(target, value, DefaultBallNumberColor, fallbackFont);
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
        if (resolvedFont != null && !ReferenceEquals(target.font, resolvedFont))
        {
            target.font = resolvedFont;
            if (resolvedFont.material != null)
            {
                target.fontSharedMaterial = resolvedFont.material;
            }
        }

        target.enableWordWrapping = false;
        target.enableAutoSizing = true;
        target.fontSizeMin = Mathf.Clamp(minFontSize, 10f, 72f);
        target.fontSizeMax = Mathf.Clamp(maxFontSize, target.fontSizeMin, 96f);
        target.overflowMode = TextOverflowModes.Overflow;
    }

    private static void Apply(TextMeshProUGUI target, string value, Color preferredColor, TMP_FontAsset fallbackFont)
    {
        if (target == null)
        {
            return;
        }

        target.enabled = true;
        if (!target.gameObject.activeSelf)
        {
            target.gameObject.SetActive(true);
        }

        TMP_FontAsset resolvedFallback = fallbackFont != null ? fallbackFont : ResolveFallbackFont();
        if (resolvedFallback != null && !ReferenceEquals(target.font, resolvedFallback))
        {
            target.font = resolvedFallback;
            if (resolvedFallback.material != null)
            {
                target.fontSharedMaterial = resolvedFallback.material;
            }
        }
        else if (target.font != null && target.fontSharedMaterial == null && target.font.material != null)
        {
            target.fontSharedMaterial = target.font.material;
        }

        Color color = preferredColor;
        color.a = 1f;
        target.color = color;

        target.alpha = 1f;
        target.enableWordWrapping = false;
        target.overflowMode = TextOverflowModes.Overflow;
        target.text = value;
        target.ForceMeshUpdate();
    }
}
