using TMPro;
using UnityEngine;

public static class Theme1BongTypography
{
    public static TMP_FontAsset GetMediumFontAsset()
    {
        return CandyTypographySystem.GetFont(CandyTypographyRole.Number);
    }

    public static void ApplyCardNumber(TextMeshProUGUI target)
    {
        Apply(target, CandyTypographyRole.Number, GameplayTextSurface.CardNumber);
    }

    public static void ApplyPrizeLabel(TextMeshProUGUI target)
    {
        Apply(target, CandyTypographyRole.Label, GameplayTextSurface.HudLabel);
    }

    private static void Apply(TextMeshProUGUI target, CandyTypographyRole role, GameplayTextSurface surface)
    {
        if (target == null)
        {
            return;
        }

        CandyTypographySystem.ApplyGameplayRole(target, role, surface, preserveColor: true, preserveExistingFont: false);
        if (surface == GameplayTextSurface.CardNumber &&
            target.font != null &&
            target.font.material != null &&
            target.fontSharedMaterial != target.font.material)
        {
            target.fontSharedMaterial = target.font.material;
        }
        target.havePropertiesChanged = true;
        target.SetVerticesDirty();
        target.SetMaterialDirty();
    }
}
