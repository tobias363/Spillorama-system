using System;
using TMPro;
using UnityEngine;

public static class RealtimeTextStyleUtils
{
    private static readonly Color DefaultCardNumberColor = new Color32(184, 51, 99, 255);
    private static readonly Color DefaultBallNumberColor = Color.black;
    private const string ProblematicFontName = "FredokaOne-Regular SDF";

    public static TMP_FontAsset ResolveFallbackFont()
    {
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

    public static void ApplyCardNumber(TextMeshProUGUI target, string value, TMP_FontAsset fallbackFont = null)
    {
        Apply(target, value, DefaultCardNumberColor, fallbackFont);
    }

    public static void ApplyBallNumber(TextMeshProUGUI target, string value, TMP_FontAsset fallbackFont = null)
    {
        Apply(target, value, DefaultBallNumberColor, fallbackFont);
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
        if (resolvedFallback != null && ShouldReplaceFont(target.font, resolvedFallback))
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

    private static bool ShouldReplaceFont(TMP_FontAsset current, TMP_FontAsset fallback)
    {
        if (current == null)
        {
            return true;
        }

        if (ReferenceEquals(current, fallback))
        {
            return false;
        }

        string currentName = current.name ?? string.Empty;
        return currentName.IndexOf(ProblematicFontName, StringComparison.OrdinalIgnoreCase) >= 0;
    }
}
