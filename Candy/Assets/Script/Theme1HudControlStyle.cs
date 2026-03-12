using TMPro;
using UnityEngine;

public static class Theme1HudControlStyle
{
    public const float ReferenceWidth = 824f;
    public const float ReferenceHeight = 496f;

    public static readonly Vector2 SaldoSize = new(86f, 44f);
    public static readonly Vector2 SaldoPosition = new(-200f, 34f);
    public static readonly Vector2 GevinstSize = new(90f, 44f);
    public static readonly Vector2 GevinstPosition = new(-104f, 34f);
    public static readonly Vector2 ShuffleSize = new(78f, 44f);
    public static readonly Vector2 ShufflePosition = new(-6f, 34f);
    public static readonly Vector2 StakePanelSize = new(152f, 50f);
    public static readonly Vector2 StakePanelPosition = new(170f, 34f);
    public static readonly Vector2 PlaceBetSize = new(128f, 50f);
    public static readonly Vector2 PlaceBetPosition = new(296f, 34f);
    public static readonly Vector2 NextDrawSize = new(158f, 88f);
    public static readonly Vector2 NextDrawPosition = new(0f, 124f);

    public static readonly Vector2 MiniValueSize = new(106f, 32f);
    public static readonly Vector2 StakeValueSize = new(122f, 38.4f);
    public static readonly Vector2 StakeValueOffset = new(0f, -3f);
    public static readonly Vector2 StakeMinusSize = new(36f, 36f);
    public static readonly Vector2 StakeMinusOffset = new(-50f, 0f);
    public static readonly Vector2 StakePlusSize = new(36f, 36f);
    public static readonly Vector2 StakePlusOffset = new(50f, 0f);

    public static readonly Vector2 SaldoValueOffset = new(0f, -2f);
    public static readonly Vector2 GevinstValueOffset = new(0f, -2f);

    public static readonly Vector2 NextDrawTitleOffset = new(0f, 16f);
    public static readonly Vector2 NextDrawTitleSize = new(122f, 20f);
    public static readonly Vector2 NextDrawSubtitleOffset = new(0f, -1f);
    public static readonly Vector2 NextDrawSubtitleSize = new(122f, 20f);
    public static readonly Vector2 NextDrawCountdownOffset = new(0f, -25f);
    public static readonly Vector2 NextDrawCountdownSize = new(180f, 35.2f);
    public static readonly Vector2 NextDrawPlayerCountOffset = new(0f, -28f);
    public static readonly Vector2 NextDrawPlayerCountSize = new(185.6f, 22.4f);

    public static readonly Color32 HudValueColor = new(255, 255, 255, 255);
    public static readonly Color32 CountdownColor = new(255, 255, 255, 255);
    public static readonly Color32 PlayerCountColor = new(255, 235, 250, 208);
    public static readonly Color32 PressedTint = new(255, 255, 255, 245);
    public static readonly Color32 DisabledTint = new(255, 255, 255, 168);

    public const float ButtonPressedScale = 0.965f;
    public const float ButtonPressedYOffset = -2f;

    public static float ResolveScale(RectTransform root)
    {
        if (root == null)
        {
            return 1f;
        }

        Rect rect = root.rect;
        float width = rect.width > 1f ? rect.width : ReferenceWidth;
        float height = rect.height > 1f ? rect.height : ReferenceHeight;
        float widthScale = width / ReferenceWidth;
        float heightScale = height / ReferenceHeight;
        return Mathf.Clamp(Mathf.Min(widthScale, heightScale), 0.75f, 1.6f);
    }

    public static Vector2 Scale(RectTransform root, Vector2 value)
    {
        return value * ResolveScale(root);
    }

    public static float Scale(RectTransform root, float value)
    {
        return value * ResolveScale(root);
    }

    public static void ApplyHudValueStyle(TextMeshProUGUI target, Color color, float minSize, float maxSize)
    {
        if (target == null)
        {
            return;
        }

        Theme1BongTypography.ApplyPrizeLabel(target);
        target.color = color;
        target.alpha = 1f;
        target.alignment = TextAlignmentOptions.Center;
        target.enableAutoSizing = true;
        target.fontSizeMin = minSize;
        target.fontSizeMax = Mathf.Max(minSize, maxSize);
        target.fontWeight = FontWeight.Medium;
        target.fontStyle = FontStyles.Normal;
        target.enableExtraPadding = true;
        target.textWrappingMode = TextWrappingModes.NoWrap;
        target.overflowMode = TextOverflowModes.Overflow;
        target.raycastTarget = false;
        target.enabled = true;
    }

    public static void ApplyHudBarStyles(Theme1HudBarView hudBar)
    {
        if (hudBar == null)
        {
            return;
        }

        ApplyHudValueStyle(hudBar.CountdownText, CountdownColor, 22f, 72f);
        ApplyHudValueStyle(hudBar.RoomPlayerCountText, PlayerCountColor, 16f, 30f);
        ApplyHudValueStyle(hudBar.CreditText, HudValueColor, 20f, 40f);
        ApplyHudValueStyle(hudBar.WinningsText, HudValueColor, 20f, 40f);
        ApplyHudValueStyle(hudBar.BetText, HudValueColor, 22f, 44f);
    }
}
